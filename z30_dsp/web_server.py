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


def locate_web_dist() -> Optional[str]:
    """Finds the compiled React Web application directory (dist/)."""
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

    for p in candidate_paths:
        if os.path.exists(p) and os.path.isfile(os.path.join(p, "index.html")):
            return p

    # If npm is present and dist is missing, attempt quick build
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    pkg_json = os.path.join(root_dir, "package.json")
    if os.path.exists(pkg_json):
        try:
            logger.info("Web application bundle 'dist' not found. Compiling with npm...")
            subprocess.run(["npm", "run", "build"], cwd=root_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            built_dist = os.path.join(root_dir, "dist")
            if os.path.exists(built_dist) and os.path.isfile(os.path.join(built_dist, "index.html")):
                return built_dist
        except Exception as e:
            logger.warning(f"Could not auto-compile web app: {e}")

    return None


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
