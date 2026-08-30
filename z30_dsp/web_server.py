"""
z-30 Amateur Radio Digital Transceiver - Web DSP & UI Application Server
========================================================================

Launches and serves the full React Web DSP interface with:
- 60 FPS Canvas Spectral Waterfall
- LDPC-SIC Live Decoders & Signal Tracking Overlays
- Hamlib CAT Rig Control integration (rigctld)
- Automated QSO Sequencer & ADIF Logger
- Native Application Window Launcher (Chrome/Chromium/Edge/Brave/Firefox App Mode)
"""

import os
import sys
import json
import time
import socket
import logging
import shutil
import subprocess
import webbrowser
import threading
from typing import Optional, Dict, Any
from http.server import HTTPServer, SimpleHTTPRequestHandler
import socketserver

logging.basicConfig(level=logging.INFO, format="[z-30 WebUI] %(message)s")
logger = logging.getLogger("z30.WebServer")


def find_free_port(preferred_port: int = 3000) -> int:
    """Checks if preferred port is available, otherwise finds the next open port."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", preferred_port))
            return preferred_port
    except OSError:
        # Preferred port busy, allocate ephemeral port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            return s.getsockname()[1]


def _is_source_newer_than_bundle(root_dir: str, index_html_path: str) -> bool:
    """
    Checks whether package.json or any file under src/ was modified after `index_html_path`
    was built, meaning the cached bundle is stale and must be rebuilt.
    """
    try:
        dist_mtime = os.path.getmtime(index_html_path)
    except OSError:
        return True  # Can't stat it; treat as stale rather than risk serving nothing.

    pkg_json = os.path.join(root_dir, "package.json")
    if os.path.exists(pkg_json) and os.path.getmtime(pkg_json) > dist_mtime:
        return True

    src_dir = os.path.join(root_dir, "src")
    if os.path.isdir(src_dir):
        for dirpath, _dirnames, filenames in os.walk(src_dir):
            for fname in filenames:
                try:
                    if os.path.getmtime(os.path.join(dirpath, fname)) > dist_mtime:
                        return True
                except OSError:
                    continue

    return False


def locate_web_dist() -> Optional[str]:
    """
    Finds the compiled React Web application directory (dist/).

    When a source tree (package.json + src/) and npm are both available, rebuilds whenever the
    source is newer than the best-matching cached bundle, instead of unconditionally trusting
    whichever pre-built dist/ happens to exist first. A prior version of this function always
    served the first bundle found even if it predated the most recent source changes - which is
    exactly what made "z-30 still opens the old version after updating" possible: after a
    `git pull` or a fresh zip extract, any leftover dist/ from a previous build (in the repo
    root, or z30_dsp/web_dist, or ~/.z30/web_dist) would keep being served forever, since
    nothing ever re-checked whether it was still current. A frozen PyInstaller build has no
    source tree or npm available, so this check naturally no-ops there and it keeps using
    whatever bundle was baked in at build time, as intended.
    """
    candidate_paths = [
        # Current working directory dist
        os.path.abspath("dist"),
        # Relative to z30_dsp package directory
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist")),
        # Embedded in z30_dsp/web_dist
        os.path.abspath(os.path.join(os.path.dirname(__file__), "web_dist")),
        # User home .z30 directory
        os.path.expanduser("~/.z30/web_dist"),
        os.path.expanduser("~/.z30/dist"),
    ]

    found: Optional[str] = None
    for p in candidate_paths:
        if os.path.exists(p) and os.path.isfile(os.path.join(p, "index.html")):
            found = p
            break

    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    pkg_json = os.path.join(root_dir, "package.json")
    can_rebuild = os.path.exists(pkg_json) and shutil.which("npm") is not None

    if found and can_rebuild and _is_source_newer_than_bundle(root_dir, os.path.join(found, "index.html")):
        logger.info(f"Cached web bundle at '{found}' predates the source tree - rebuilding...")
        found = None

    if found:
        return found

    if can_rebuild:
        try:
            logger.info("Compiling Web UI bundle with npm (missing or stale)...")
            subprocess.run(["npm", "run", "build"], cwd=root_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            built_dist = os.path.join(root_dir, "dist")
            if os.path.exists(built_dist) and os.path.isfile(os.path.join(built_dist, "index.html")):
                return built_dist
        except Exception as e:
            logger.warning(f"Could not auto-compile web app: {e}")

    # Rebuild failed or wasn't possible - fall back to any cached bundle rather than nothing.
    for p in candidate_paths:
        if os.path.exists(p) and os.path.isfile(os.path.join(p, "index.html")):
            return p

    return None


class GpioBridge:
    """
    Real Raspberry Pi / Linux SBC GPIO control for PTT keying, exposed to the browser UI via
    the /api/gpio endpoint below. Browser JavaScript has no Web API that can write to Linux
    GPIO directly (no navigator.gpio exists) - a prior version of the app's PTT code faked
    this entirely client-side, logging a claimed "sysfs /libgpiod write" that never actually
    touched any hardware. This runs server-side, in the real native Python process, using
    gpiozero (a soft dependency - only required if RASPBERRY_PI_GPIO PTT is actually used).

    One DigitalOutputDevice is created per BCM pin number and reused across calls, since
    gpiozero raises if you try to claim the same pin twice without releasing it first.
    """

    def __init__(self) -> None:
        self._devices: Dict[int, Any] = {}
        self._import_error: Optional[str] = None
        try:
            from gpiozero import DigitalOutputDevice  # noqa: F401
            self._DigitalOutputDevice = DigitalOutputDevice
        except Exception as e:
            self._DigitalOutputDevice = None
            self._import_error = str(e)

    def set_pin(self, bcm_pin: int, active: bool) -> Dict[str, Any]:
        if self._DigitalOutputDevice is None:
            return {
                "success": False,
                "error": f"gpiozero is not available ({self._import_error}). Install it with "
                         "'pip install gpiozero' on the Raspberry Pi / SBC running this server.",
            }
        try:
            if bcm_pin not in self._devices:
                self._devices[bcm_pin] = self._DigitalOutputDevice(bcm_pin)
            device = self._devices[bcm_pin]
            if active:
                device.on()
            else:
                device.off()
            return {"success": True, "pin": bcm_pin, "value": active}
        except Exception as e:
            return {"success": False, "error": f"GPIO write to BCM pin {bcm_pin} failed: {e}"}

    def release_all(self) -> None:
        for device in self._devices.values():
            try:
                device.close()
            except Exception:
                pass
        self._devices.clear()


_gpio_bridge = GpioBridge()


class SpaRequestHandler(SimpleHTTPRequestHandler):
    """
    HTTP Request Handler that supports Single Page Application (SPA) routing,
    MIME types for modern JS/WASM/CSS, and optional Hamlib / DSP REST APIs.
    """

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def guess_type(self, path):
        mtype = super().guess_type(path)
        if path.endswith(".js") or path.endswith(".mjs"):
            return "application/javascript"
        if path.endswith(".css"):
            return "text/css"
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".svg"):
            return "image/svg+xml"
        if path.endswith(".json"):
            return "application/json"
        return mtype

    def do_GET(self):
        # API endpoints
        if self.path.startswith("/api/status"):
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            status_data = {
                "system": "z-30 Transceiver",
                "version": "1.0.0",
                "protocol": "16-MFSK / LDPC-SIC",
                "status": "ONLINE",
                "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            self.wfile.write(json.dumps(status_data).encode("utf-8"))
            return

        # SPA Routing: If file does not exist, serve index.html
        requested_file = self.translate_path(self.path)
        if not os.path.exists(requested_file) and not os.path.isdir(requested_file):
            index_path = os.path.join(self.directory, "index.html")
            if os.path.exists(index_path):
                self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/gpio"):
            self._handle_gpio_post()
            return
        self.send_error(404, "Not Found")

    def _handle_gpio_post(self) -> None:
        """
        Real Raspberry Pi / Linux SBC GPIO write for RASPBERRY_PI_GPIO PTT keying, called from
        catController.ts's setRpiGpio(). Body: {"pin": <BCM pin number>, "value": <bool>}.
        This server only binds to 127.0.0.1 (see run_web_app), so this is not reachable over
        the network - only from the browser tab this same process served.
        """
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw_body.decode("utf-8"))
            pin = int(payload["pin"])
            value = bool(payload["value"])
        except Exception as e:
            self.send_response(400)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": f"Invalid request body: {e}"}).encode("utf-8"))
            return

        result = _gpio_bridge.set_pin(pin, value)
        self.send_response(200 if result.get("success") else 503)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode("utf-8"))

    def log_message(self, format, *args):
        # Suppress noisy HTTP asset logs unless in debug mode
        pass


def launch_native_app_window(url: str):
    """
    Attempts to launch the web application in a dedicated, distraction-free
    native app window using Chrome, Chromium, Brave, Edge, or Firefox.
    Falls back to standard default browser tab.
    """
    # Wait for server to start accepting connections
    time.sleep(0.35)

    # 1. Try launching in application window mode (--app=URL)
    app_browsers = [
        # Linux / BSD
        ["google-chrome", f"--app={url}"],
        ["google-chrome-stable", f"--app={url}"],
        ["chromium", f"--app={url}"],
        ["chromium-browser", f"--app={url}"],
        ["brave-browser", f"--app={url}"],
        ["brave", f"--app={url}"],
        ["microsoft-edge", f"--app={url}"],
        ["microsoft-edge-stable", f"--app={url}"],
        ["firefox", "--new-window", url],
        # macOS
        ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", f"--app={url}"],
        ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", f"--app={url}"],
        ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", f"--app={url}"],
    ]

    for cmd in app_browsers:
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            logger.info(f"Launched native application window using: {cmd[0]}")
            return
        except (FileNotFoundError, PermissionError, Exception):
            continue

    # 2. Windows specific start commands
    if sys.platform.startswith("win"):
        try:
            os.system(f'start msedge --app="{url}"')
            logger.info("Launched application window in Microsoft Edge")
            return
        except Exception:
            try:
                os.system(f'start chrome --app="{url}"')
                logger.info("Launched application window in Google Chrome")
                return
            except Exception:
                pass

    # 3. Fallback to standard system browser
    logger.info(f"Opening z-30 in default web browser: {url}")
    webbrowser.open(url)


def run_web_app(port: Optional[int] = None, no_browser: bool = False):
    """
    Main entry point for starting the z-30 Web DSP application server.
    """
    dist_dir = locate_web_dist()
    if not dist_dir:
        logger.error("Could not locate compiled 'dist' directory containing index.html.")
        logger.info("Please run 'npm run build' first or ensure the package is built.")
        sys.exit(1)

    app_port = port if port else find_free_port(3000)
    url = f"http://127.0.0.1:{app_port}"

    class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True

    handler = lambda *args, **kwargs: SpaRequestHandler(*args, directory=dist_dir, **kwargs)

    try:
        httpd = ThreadedHTTPServer(("127.0.0.1", app_port), handler)
    except Exception as e:
        logger.error(f"Failed to start HTTP server on 127.0.0.1:{app_port}: {e}")
        sys.exit(1)

    print("==================================================================")
    print("      z-30 TRANSCEIVER & DSP SUITE (16-MFSK / LDPC-SIC)           ")
    print("==================================================================")
    print(f"  ● Web UI Engine:  {url}")
    print(f"  ● Dist Bundle:    {dist_dir}")
    print(f"  ● Audio/CAT DSP:  16-MFSK @ 50 Hz, Hamlib rigctld (127.0.0.1:4532)")
    print("==================================================================")
    print("  Press Ctrl+C in this terminal to shut down the transceiver.")
    print("==================================================================")

    if not no_browser:
        t = threading.Thread(target=launch_native_app_window, args=(url,), daemon=True)
        t.start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[z-30] Shutting down transceiver server...")
        httpd.server_close()
        sys.exit(0)


def main():
    port = None
    no_browser = "--no-browser" in sys.argv or "-n" in sys.argv
    for arg in sys.argv:
        if arg.startswith("--port="):
            try:
                port = int(arg.split("=")[1])
            except ValueError:
                pass
    run_web_app(port=port, no_browser=no_browser)


if __name__ == "__main__":
    main()
