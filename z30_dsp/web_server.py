"""
z-30 Amateur Radio Digital Transceiver - Web DSP & UI Application Server
========================================================================

Launches and serves the compiled React Web DSP interface with:
- 60 FPS Canvas Spectral Waterfall
- LDPC-SIC Live Decoders & Signal Tracking Overlays
- Hamlib CAT Rig Control integration (a real rigctld TCP relay - see RigctlRelay)
- Raspberry Pi / SBC GPIO PTT keying with a dead-man watchdog
- Automated QSO Sequencer & ADIF Logger, persisted to disk under the user data directory
- Native Application Window Launcher (Chrome/Chromium/Edge/Brave/Firefox App Mode)

Security model
--------------
The server binds 127.0.0.1 only, but loopback is NOT an authentication boundary: any web page
in any tab can issue a `fetch()` to http://127.0.0.1:<port>/api/... , and a `text/plain` POST
is a CORS "simple request" that is sent without a preflight. A previous version of this file
answered every /api/ request with `Access-Control-Allow-Origin: *` and no other check, which
meant an advertisement in an unrelated tab could key the operator's transmitter.

Every /api/ request must now satisfy all of:
  * a bearer token (`X-Z30-Token`, or `?token=`) generated fresh at each server start and
    injected only into the index.html this process serves;
  * an `Origin` header that is either absent or exactly this server's own origin;
  * a `Host` header naming this server's own loopback address and port (blocks DNS rebinding).
No wildcard CORS header is sent anywhere.
"""

import argparse
import atexit
import json
import logging
import os
import secrets
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse, parse_qs

from . import git_sync
from .paths import logbook_adif_path, logbook_json_path, station_config_path

logging.basicConfig(level=logging.INFO, format="[z-30 WebUI] %(message)s")
logger = logging.getLogger("z30.WebServer")

DEFAULT_PORT = 3000
DEFAULT_GPIO_PTT_PIN = 17
# The browser must re-assert PTT at least this often while transmitting, or the GPIO line is
# dropped automatically. One z-30 frame is 24 s of continuous carrier, so the keepalive
# interval has to be far shorter than a frame: the UI sends one every ~500 ms.
GPIO_KEEPALIVE_TIMEOUT_SEC = 2.0
# Absolute ceiling on a single keyed period regardless of keepalives. One frame is 24 s plus
# lead-in and hang time; 40 s leaves generous margin while still bounding a stuck transmitter.
GPIO_MAX_KEYED_SEC = 40.0

MAX_API_BODY_BYTES = 4 * 1024 * 1024  # QSO logbooks are small; refuse anything absurd.


# ============================================================================
# 1. LISTENING SOCKET
# ============================================================================

def bind_listening_socket(port: int) -> Tuple[socket.socket, int]:
    """
    Binds the real listening socket on 127.0.0.1 once and returns it together with its port.

    The previous implementation probed a throwaway socket, closed it, then bound a second one
    - a race anything else on the machine could win - and, when the preferred port was busy,
    silently drifted to a random ephemeral port. That drift is not cosmetic: localStorage is
    partitioned by origin and the port is part of the origin, so a single launch on a
    different port presented the operator with an empty logbook and an unconfigured station
    while the real data sat unreachable under the old origin. Failing loudly is the correct
    behaviour; `--port` is there for the rare case where 3000 really must be avoided.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", port))
    except OSError as exc:
        sock.close()
        raise OSError(
            f"Could not bind 127.0.0.1:{port} ({exc}). Another program - most likely another "
            f"copy of z-30 - is already using it. Close that one, or start this instance with "
            f"'--port=<other port>'. Note that the logbook and station settings the web UI "
            f"keeps in browser storage are tied to the port number, so a different port starts "
            f"from an empty browser-side store (the server-side copy under the z-30 user data "
            f"directory is unaffected)."
        ) from exc
    sock.listen(16)
    return sock, sock.getsockname()[1]


# ============================================================================
# 2. WEB BUNDLE LOCATION
# ============================================================================

def locate_web_dist(rebuild: bool = False) -> Optional[str]:
    """
    Finds the compiled React Web application directory (dist/).

    Serving is a read-only operation: it never triggers a build. An earlier version stat'ed
    every file under src/ on each launch and, if anything looked newer than the cached bundle,
    ran `npm run build` as a subprocess with stdout and stderr discarded. That made starting a
    radio execute the whole npm dependency graph's build scripts, made startup latency
    proportional to source-tree size, and turned a failed build into a silent slow start with a
    stale UI. Developers who do want that pass `--rebuild`, which runs the build in the
    foreground with its output on the terminal where they can read it.
    """
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    if rebuild:
        pkg_json = os.path.join(root_dir, "package.json")
        if not os.path.exists(pkg_json):
            logger.error("--rebuild requires the source tree (package.json not found next to the package).")
            return None
        if shutil.which("npm") is None:
            logger.error("--rebuild requires npm on PATH.")
            return None
        logger.info("Rebuilding the web UI bundle with 'npm run build'...")
        try:
            subprocess.run(["npm", "run", "build"], cwd=root_dir, check=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            logger.error(f"Web UI rebuild failed: {exc}")
            return None

    candidate_paths = [
        os.path.abspath("dist"),
        os.path.abspath(os.path.join(root_dir, "dist")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "web_dist")),
        os.path.expanduser("~/.z30/web_dist"),
        os.path.expanduser("~/.z30/dist"),
    ]
    for path in candidate_paths:
        if os.path.isfile(os.path.join(path, "index.html")):
            return path
    return None


# ============================================================================
# 3. GPIO PTT BRIDGE WITH DEAD-MAN WATCHDOG
# ============================================================================

class GpioBridge:
    """
    Real Raspberry Pi / Linux SBC GPIO control for PTT keying, exposed to the browser UI via
    the /api/gpio endpoint. Browser JavaScript has no Web API that can write to Linux GPIO
    directly (no navigator.gpio exists), so this runs server-side in the native Python
    process using gpiozero (a soft dependency, only needed for RASPBERRY_PI_GPIO PTT).

    The bridge is a dead-man switch, not a plain setter. `set_pin(pin, True)` keys the line
    and starts a countdown; the browser must repeat the call (or POST a keepalive) at least
    every GPIO_KEEPALIVE_TIMEOUT_SEC or the watchdog thread drops the line by itself. A
    separate hard ceiling of GPIO_MAX_KEYED_SEC bounds a single keyed period even if
    keepalives keep arriving. A crashed tab, a sleeping machine or a hung renderer therefore
    unkeys the transmitter within about two seconds instead of leaving it keyed indefinitely -
    an unattended transmission, a burnt PA, and a licence problem.

    Only the single configured PTT pin is writable. Accepting any integer let a caller claim
    and drive an arbitrary BCM pin on the board.
    """

    def __init__(self, allowed_pin: int = DEFAULT_GPIO_PTT_PIN) -> None:
        self.allowed_pin = allowed_pin
        self._devices: Dict[int, Any] = {}
        # PTT polarity per claimed pin, as the browser reported it. Held so that the watchdog
        # and the shutdown handlers drive the RELEASED level rather than a hardcoded low.
        self._pin_active_low: Dict[int, bool] = {}
        self._lock = threading.RLock()
        self._keyed_pins: Dict[int, Dict[str, float]] = {}
        self._import_error: Optional[str] = None
        self._stop_event = threading.Event()
        try:
            from gpiozero import DigitalOutputDevice  # noqa: F401
            self._DigitalOutputDevice = DigitalOutputDevice
        except Exception as exc:  # gpiozero is optional and import-fails on non-SBC hosts
            self._DigitalOutputDevice = None
            self._import_error = str(exc)

        self._watchdog = threading.Thread(target=self._watchdog_loop, name="z30-gpio-watchdog", daemon=True)
        self._watchdog.start()

    # -- watchdog ----------------------------------------------------------

    def _watchdog_loop(self) -> None:
        while not self._stop_event.wait(0.1):
            now = time.monotonic()
            expired = []
            with self._lock:
                for pin, state in list(self._keyed_pins.items()):
                    if now - state["last_keepalive"] > GPIO_KEEPALIVE_TIMEOUT_SEC:
                        expired.append((pin, "keepalive timeout - browser stopped asserting PTT"))
                    elif now - state["keyed_at"] > GPIO_MAX_KEYED_SEC:
                        expired.append((pin, f"maximum keyed time of {GPIO_MAX_KEYED_SEC:.0f}s exceeded"))
            for pin, reason in expired:
                logger.warning(f"PTT watchdog released BCM pin {pin}: {reason}")
                self._write_pin(pin, False)

    # -- pin access --------------------------------------------------------

    def _device_for(self, bcm_pin: int, active_low: bool) -> Any:
        """
        Returns the output device for a pin, built for this station's PTT polarity.

        gpiozero's `active_high` carries the polarity, so `device.on()` means KEYED and
        `device.off()` means RELEASED whichever way the interface is wired, and every caller
        below - including the watchdog and the shutdown handlers - can speak in keyed/released
        terms without having to remember which level that is. `initial_value=False` means
        claiming the pin releases it rather than keying it.
        """
        existing = self._devices.get(bcm_pin)
        if existing is not None and self._pin_active_low.get(bcm_pin) == active_low:
            return existing
        if existing is not None:
            # Polarity changed (the operator edited it in Station Settings). Rebuild the device
            # rather than driving the old one at the new meaning.
            try:
                existing.off()
                existing.close()
            except Exception:
                pass
            self._devices.pop(bcm_pin, None)
        device = self._DigitalOutputDevice(bcm_pin, active_high=not active_low, initial_value=False)
        self._devices[bcm_pin] = device
        self._pin_active_low[bcm_pin] = active_low
        return device

    def _write_pin(self, bcm_pin: int, keyed: bool, active_low: Optional[bool] = None) -> Dict[str, Any]:
        """
        Drives the PTT line to `keyed` and keeps the dead-man bookkeeping in step with it.

        `keyed` is the transmitter's state, NOT the pin's voltage. It used to be the voltage,
        which the countdown logic then recorded as the keyed state: an active-low station
        registered no countdown when it keyed (so its own keepalives were rejected and the
        browser force-unkeyed it half a second into every frame) and registered one when it
        released - after which this watchdog "released" the line by driving it low, which on
        active-low wiring keys the transmitter. The layer that exists to prevent a stuck
        transmitter was creating one.
        """
        with self._lock:
            if self._DigitalOutputDevice is None:
                return {
                    "success": False,
                    "error": f"gpiozero is not available ({self._import_error}). Install it with "
                             "'pip install gpiozero' on the Raspberry Pi / SBC running this server.",
                }
            if active_low is None:
                active_low = self._pin_active_low.get(bcm_pin, False)
            try:
                device = self._device_for(bcm_pin, active_low)
                if keyed:
                    device.on()
                else:
                    device.off()
            except Exception as exc:
                self._keyed_pins.pop(bcm_pin, None)
                return {"success": False, "error": f"GPIO write to BCM pin {bcm_pin} failed: {exc}"}

            now = time.monotonic()
            if keyed:
                state = self._keyed_pins.get(bcm_pin)
                if state is None:
                    self._keyed_pins[bcm_pin] = {"keyed_at": now, "last_keepalive": now}
                else:
                    state["last_keepalive"] = now
            else:
                self._keyed_pins.pop(bcm_pin, None)
            return {
                "success": True,
                "pin": bcm_pin,
                "keyed": keyed,
                "active_low": active_low,
                # The electrical level, for a UI or a log that wants to show the pin itself.
                "value": (not keyed) if active_low else keyed,
            }

    def set_pin(self, bcm_pin: int, keyed: bool, active_low: bool = False) -> Dict[str, Any]:
        """Keys or unkeys the configured PTT pin, refreshing the dead-man countdown."""
        if bcm_pin != self.allowed_pin:
            return {
                "success": False,
                "error": f"BCM pin {bcm_pin} is not the configured PTT pin. This server only drives "
                         f"pin {self.allowed_pin}; start it with '--gpio-pin=<n>' to change that.",
            }
        result = self._write_pin(bcm_pin, keyed, active_low)
        if result.get("success"):
            result["keepalive_timeout_sec"] = GPIO_KEEPALIVE_TIMEOUT_SEC
            result["max_keyed_sec"] = GPIO_MAX_KEYED_SEC
        return result

    def keepalive(self, bcm_pin: int) -> Dict[str, Any]:
        """
        Refreshes the dead-man countdown without re-issuing a write. Returns success only
        while the pin is actually keyed, so the UI can tell that the watchdog has already
        dropped the line underneath it.
        """
        if bcm_pin != self.allowed_pin:
            return {"success": False, "error": f"BCM pin {bcm_pin} is not the configured PTT pin."}
        with self._lock:
            state = self._keyed_pins.get(bcm_pin)
            if state is None:
                return {"success": False, "error": f"BCM pin {bcm_pin} is not keyed.", "keyed": False}
            state["last_keepalive"] = time.monotonic()
            held_for = time.monotonic() - state["keyed_at"]
        return {
            "success": True,
            "pin": bcm_pin,
            "keyed": True,
            "held_for_sec": round(held_for, 3),
            "max_keyed_sec": GPIO_MAX_KEYED_SEC,
        }

    def any_pin_keyed(self) -> bool:
        """
        True while any PTT line is asserted.

        The update endpoint asks before it touches the checkout: fast-forwarding the tree under
        a running transmission would swap the served bundle and the Python sources out from
        under a keyed transmitter, and the operator is on the air and not looking at the screen.
        """
        with self._lock:
            return bool(self._keyed_pins)

    def release_all(self) -> None:
        """Unkeys every claimed pin and releases it. Registered with atexit and the signal handlers."""
        with self._lock:
            for pin, device in self._devices.items():
                try:
                    # off() is the RELEASED state for either polarity, because the device was
                    # built with active_high set from the station's wiring.
                    device.off()
                except Exception:
                    pass
                try:
                    device.close()
                except Exception:
                    pass
                logger.info(f"Released GPIO BCM pin {pin} on shutdown.")
            self._devices.clear()
            self._pin_active_low.clear()
            self._keyed_pins.clear()

    def shutdown(self) -> None:
        self._stop_event.set()
        self.release_all()


# ============================================================================
# 4. HAMLIB rigctld TCP RELAY
# ============================================================================

class RigctlRelay:
    """
    Relays rigctl commands to a local Hamlib rigctld daemon over TCP.

    Browsers cannot open raw TCP sockets, which is why the app's Hamlib network mode used to
    be a toggle the operator flipped by hand while "Test CAT Connection" reported a verified
    link that had never been probed. This relay closes that gap: the UI POSTs a rigctl command
    string here, the native process talks to rigctld, and the daemon's actual reply is
    returned - so a failure is a failure and a reported frequency is the radio's, not the
    app's own state echoed back.

    Only loopback daemons are reachable. Relaying to arbitrary hosts would turn this endpoint
    into a general-purpose TCP client for anything that got past the API token.
    """

    ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}

    @classmethod
    def send(cls, host: str, port: int, command: str, timeout_sec: float = 2.0) -> Dict[str, Any]:
        if host not in cls.ALLOWED_HOSTS:
            return {"success": False, "error": f"Only loopback rigctld daemons may be relayed to (got '{host}')."}
        if not 1 <= port <= 65535:
            return {"success": False, "error": f"Invalid rigctld port {port}."}
        payload = command if command.endswith("\n") else command + "\n"
        try:
            with socket.create_connection((host, port), timeout=timeout_sec) as sock:
                sock.settimeout(timeout_sec)
                sock.sendall(payload.encode("ascii", errors="ignore"))
                chunks = []
                deadline = time.monotonic() + timeout_sec
                while time.monotonic() < deadline:
                    try:
                        chunk = sock.recv(4096)
                    except socket.timeout:
                        break
                    if not chunk:
                        break
                    chunks.append(chunk)
                    # rigctld terminates every response with a newline; one is enough.
                    if chunks[-1].endswith(b"\n"):
                        break
                response = b"".join(chunks).decode("utf-8", errors="replace")
        except OSError as exc:
            return {
                "success": False,
                "error": f"Could not reach rigctld at {host}:{port} ({exc}). Start it with "
                         f"'rigctld -m <model> -r <serial port> -s <baud>'.",
            }
        return {"success": True, "host": host, "port": port, "command": payload.strip(), "response": response}


# ============================================================================
# 5. OPERATOR DATA STORE (LOGBOOK & STATION CONFIG)
# ============================================================================

class OperatorStore:
    """
    Durable, server-side storage for the QSO logbook and station configuration.

    The web UI keeps its working copy in localStorage for speed, but localStorage is the most
    volatile place on the machine: clearing browsing data, a private window, a different
    browser, or simply a different port number all lose the whole logbook. Contacts are
    records an operator may need years later, so they are mirrored here to real files - JSON as
    the source of truth plus an ADIF export written next to it, ready to hand to LoTW, QRZ or
    Club Log without an extra step.
    """

    _lock = threading.Lock()

    @staticmethod
    def _read_json(path: str, default: Any) -> Any:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return default

    @staticmethod
    def _write_json_atomic(path: str, data: Any) -> None:
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)

    @classmethod
    def read_logbook(cls) -> Dict[str, Any]:
        with cls._lock:
            entries = cls._read_json(logbook_json_path(), [])
        if not isinstance(entries, list):
            entries = []
        return {"success": True, "entries": entries, "path": logbook_json_path()}

    @classmethod
    def write_logbook(cls, entries: Any, adif: Optional[str]) -> Dict[str, Any]:
        if not isinstance(entries, list):
            return {"success": False, "error": "Logbook payload must be a JSON array of entries."}
        try:
            with cls._lock:
                cls._write_json_atomic(logbook_json_path(), entries)
                if isinstance(adif, str) and adif:
                    tmp_adif = f"{logbook_adif_path()}.tmp"
                    with open(tmp_adif, "w", encoding="utf-8") as handle:
                        handle.write(adif)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(tmp_adif, logbook_adif_path())
        except OSError as exc:
            return {"success": False, "error": f"Could not write the logbook: {exc}"}
        return {
            "success": True,
            "count": len(entries),
            "path": logbook_json_path(),
            "adif_path": logbook_adif_path() if adif else None,
        }

    @classmethod
    def read_station_config(cls) -> Dict[str, Any]:
        with cls._lock:
            config = cls._read_json(station_config_path(), {})
        if not isinstance(config, dict):
            config = {}
        return {"success": True, "config": config, "path": station_config_path()}

    @classmethod
    def write_station_config(cls, config: Any) -> Dict[str, Any]:
        if not isinstance(config, dict):
            return {"success": False, "error": "Station configuration payload must be a JSON object."}
        try:
            with cls._lock:
                cls._write_json_atomic(station_config_path(), config)
        except OSError as exc:
            return {"success": False, "error": f"Could not write the station configuration: {exc}"}
        return {"success": True, "path": station_config_path()}


# ============================================================================
# 6. HTTP REQUEST HANDLER
# ============================================================================

class UpdateJob:
    """
    Runs one upstream fast-forward at a time, in a worker thread, with a readable log.

    An update is slow (a network fetch, then a checkout) and the HTTP handler must not block
    for it: a request that takes thirty seconds looks like a hung radio, and the browser's own
    fetch timeout would abandon it half-way with no way to find out what happened. So `start()`
    returns immediately and the UI polls `snapshot()` for progress, which also means a reload
    mid-update reconnects to the running job instead of starting a second one.

    Serialised by a lock for the obvious reason: two concurrent `git merge` invocations in one
    working tree corrupt the index.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._log: List[str] = []
        self._result: Optional[Dict[str, Any]] = None
        self._started_at: float = 0.0

    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "success": True,
                "running": self._running,
                "log": list(self._log),
                "result": self._result,
                "elapsed_sec": round(time.time() - self._started_at, 1) if self._started_at else 0.0,
            }

    def start(self, reinstall_python: bool, rebuild_web: bool) -> Dict[str, Any]:
        with self._lock:
            if self._running:
                return {"success": False, "error": "An update is already running.", "running": True}
            self._running = True
            self._log = []
            self._result = None
            self._started_at = time.time()

        def append(message: str) -> None:
            with self._lock:
                self._log.append(message)
            logger.info(f"[update] {message}")

        def worker() -> None:
            try:
                result = git_sync.apply_update(
                    on_log=append,
                    reinstall_python=reinstall_python,
                    rebuild_web=rebuild_web,
                )
                payload = result.to_dict()
            except Exception as exc:  # a crashed worker must not leave the job "running" forever
                append(f"Update failed unexpectedly: {exc}")
                payload = {"success": False, "error": str(exc), "log": []}
            with self._lock:
                self._result = payload
                self._running = False

        thread = threading.Thread(target=worker, name="z30-update", daemon=True)
        with self._lock:
            self._thread = thread
        thread.start()
        return {"success": True, "running": True}


class SpaRequestHandler(SimpleHTTPRequestHandler):
    """
    Serves the compiled single-page application plus the local hardware/storage APIs.

    Every /api/ route is authenticated (see the module docstring). Static asset serving is
    unauthenticated, exactly as it must be for the browser to load the app at all - the bundle
    is public code, not operator data.
    """

    # Injected by run_web_app before the server starts.
    api_token: str = ""
    allowed_origin: str = ""
    allowed_hosts: Set[str] = set()
    gpio_bridge: Optional[GpioBridge] = None
    update_job: Optional[UpdateJob] = None

    server_version = "z30-web"
    sys_version = ""

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

    # -- helpers -----------------------------------------------------------

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # Deliberately no Access-Control-Allow-Origin: these endpoints drive real hardware and
        # hold operator data, and nothing outside this app's own origin may read them.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _authorize_api(self) -> Optional[str]:
        """
        Returns None when the request may proceed, or a human-readable rejection reason.

        Three independent checks, all of which a cross-origin attacker fails:
          * Host must name this server (a DNS-rebinding victim's request carries the
            attacker's hostname here, not 127.0.0.1:<port>);
          * Origin, when present, must be exactly this server's origin;
          * the bearer token must match the one minted at startup and handed only to the
            index.html this process served.
        """
        host_header = (self.headers.get("Host") or "").strip().lower()
        if host_header not in self.allowed_hosts:
            return f"Host header '{host_header}' is not this server's address."

        origin = (self.headers.get("Origin") or "").strip()
        if origin and origin.lower() != self.allowed_origin.lower():
            return f"Origin '{origin}' is not permitted."

        # Header only. The token used to be accepted from a `?token=` query parameter as well,
        # which no shipped client ever used (localServerApi.ts always sends the header) and which
        # put a live credential everywhere a URL goes: browser history, the Referer on any
        # outbound link, and any log that records request lines. A bearer token belongs in a
        # header precisely because headers do not travel like that.
        supplied = (self.headers.get("X-Z30-Token") or "").strip()
        if not supplied or not secrets.compare_digest(supplied, self.api_token):
            return "Missing or invalid API token."
        return None

    def _read_json_body(self) -> Tuple[Optional[Any], Optional[str]]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "Invalid Content-Length header."
        if length < 0 or length > MAX_API_BODY_BYTES:
            return None, f"Request body must be between 0 and {MAX_API_BODY_BYTES} bytes."
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8")), None
        except (ValueError, UnicodeDecodeError) as exc:
            return None, f"Invalid JSON body: {exc}"

    def _serve_index_with_token(self) -> None:
        """
        Serves index.html with the per-run API token injected.

        The token has to reach the app somehow, and the one channel an attacker's page cannot
        read is the document this server hands to the browser itself: cross-origin script has
        no access to another origin's DOM or globals.
        """
        index_path = os.path.join(self.directory, "index.html")
        try:
            with open(index_path, "r", encoding="utf-8") as handle:
                html = handle.read()
        except OSError:
            self.send_error(404, "index.html not found")
            return
        injection = (
            "<script>window.__Z30_API_TOKEN__="
            f"{json.dumps(self.api_token)};</script>"
        )
        if "</head>" in html:
            html = html.replace("</head>", f"{injection}</head>", 1)
        else:
            html = injection + html
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The shell carries a single-run credential, so it must never be cached or shared.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        path = urlparse(self.path).path

        if path.startswith("/api/"):
            denial = self._authorize_api()
            if denial:
                self._send_json(403, {"success": False, "error": denial})
                return
            if path == "/api/status":
                self._send_json(200, {
                    "system": "z-30 Transceiver",
                    "version": "1.0.0",
                    "protocol": "16-MFSK / LDPC-SIC",
                    "status": "ONLINE",
                    "gpio_ptt_pin": self.gpio_bridge.allowed_pin if self.gpio_bridge else None,
                    "gpio_keepalive_timeout_sec": GPIO_KEEPALIVE_TIMEOUT_SEC,
                    "gpio_max_keyed_sec": GPIO_MAX_KEYED_SEC,
                    "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                return
            if path == "/api/logbook":
                self._send_json(200, OperatorStore.read_logbook())
                return
            if path == "/api/station-config":
                self._send_json(200, OperatorStore.read_station_config())
                return
            if path == "/api/update/status":
                self._handle_update_status()
                return
            if path == "/api/update/progress":
                self._send_json(200, self.update_job.snapshot() if self.update_job else
                                {"success": True, "running": False, "log": [], "result": None})
                return
            self._send_json(404, {"success": False, "error": f"Unknown API endpoint '{path}'."})
            return

        # The app shell is served from memory so the API token can be injected into it.
        if path in ("/", "/index.html"):
            self._serve_index_with_token()
            return

        # SPA routing: an unknown path that is not a real file is a client-side route.
        requested_file = self.translate_path(self.path)
        if not os.path.exists(requested_file) and not os.path.isdir(requested_file):
            self._serve_index_with_token()
            return

        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            self.send_error(404, "Not Found")
            return

        denial = self._authorize_api()
        if denial:
            self._send_json(403, {"success": False, "error": denial})
            return

        payload, error = self._read_json_body()
        if error is not None:
            self._send_json(400, {"success": False, "error": error})
            return

        if path == "/api/gpio":
            self._handle_gpio(payload)
        elif path == "/api/gpio/keepalive":
            self._handle_gpio_keepalive(payload)
        elif path == "/api/rigctl":
            self._handle_rigctl(payload)
        elif path == "/api/logbook":
            self._handle_logbook_write(payload)
        elif path == "/api/station-config":
            self._handle_station_config_write(payload)
        elif path == "/api/update/apply":
            self._handle_update_apply(payload)
        else:
            self._send_json(404, {"success": False, "error": f"Unknown API endpoint '{path}'."})

    # -- API handlers ------------------------------------------------------

    def _handle_gpio(self, payload: Any) -> None:
        """
        Keys or unkeys the configured PTT pin. Body:
        {"pin": <BCM pin>, "keyed": <bool>, "active_low": <bool>}.

        `keyed` is the transmitter's intended state and `active_low` is the wiring; the bridge
        derives the pin level from the two. A body carrying only the older {"value": <level>}
        is still accepted and read with active-high semantics, so a stale cached bundle keeps
        working rather than keying at random.

        Called from catController.ts's setRpiGpio(). While keyed, the UI must keep calling
        /api/gpio/keepalive or the watchdog in GpioBridge drops the line.
        """
        if self.gpio_bridge is None:
            self._send_json(503, {"success": False, "error": "GPIO bridge unavailable."})
            return
        try:
            pin = int(payload["pin"])
            active_low = bool(payload.get("active_low", False))
            if "keyed" in payload:
                keyed = bool(payload["keyed"])
            else:
                keyed = bool(payload["value"])
                active_low = False
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        if pin != self.gpio_bridge.allowed_pin:
            # A rejected pin is a bad request, not a hardware outage - say so with 400 so the
            # UI can tell a misconfiguration from a Pi that simply has no gpiozero installed.
            self._send_json(400, self.gpio_bridge.set_pin(pin, keyed, active_low))
            return
        result = self.gpio_bridge.set_pin(pin, keyed, active_low)
        self._send_json(200 if result.get("success") else 503, result)

    def _handle_gpio_keepalive(self, payload: Any) -> None:
        if self.gpio_bridge is None:
            self._send_json(503, {"success": False, "error": "GPIO bridge unavailable."})
            return
        try:
            pin = int(payload["pin"])
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        result = self.gpio_bridge.keepalive(pin)
        self._send_json(200 if result.get("success") else 409, result)

    def _handle_rigctl(self, payload: Any) -> None:
        try:
            command = str(payload["command"])
            host = str(payload.get("host", "127.0.0.1"))
            port = int(payload.get("port", 4532))
            timeout = float(payload.get("timeout_sec", 2.0))
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        if host not in RigctlRelay.ALLOWED_HOSTS or not 1 <= port <= 65535:
            self._send_json(400, RigctlRelay.send(host, port, command))
            return
        result = RigctlRelay.send(host, port, command, max(0.1, min(timeout, 10.0)))
        self._send_json(200 if result.get("success") else 502, result)

    def _handle_logbook_write(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            self._send_json(400, {"success": False, "error": "Expected a JSON object."})
            return
        result = OperatorStore.write_logbook(payload.get("entries"), payload.get("adif"))
        self._send_json(200 if result.get("success") else 500, result)

    def _handle_station_config_write(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            self._send_json(400, {"success": False, "error": "Expected a JSON object."})
            return
        result = OperatorStore.write_station_config(payload.get("config"))
        self._send_json(200 if result.get("success") else 500, result)

    # -- upstream synchronisation -----------------------------------------

    def _handle_update_status(self) -> None:
        """
        Reports how many commits behind `origin/main` this installation is.

        `?fetch=0` answers from the last fetch without touching the network, which is what the
        Update button's badge polls; the modal's explicit "Check now" fetches.
        """
        query = parse_qs(urlparse(self.path).query)
        do_fetch = (query.get("fetch") or ["1"])[0] != "0"
        status = git_sync.read_status(fetch=do_fetch).to_dict()
        status["success"] = True
        status["update_running"] = bool(self.update_job and self.update_job.is_running())
        self._send_json(200, status)

    def _handle_update_apply(self, payload: Any) -> None:
        """
        Fast-forwards this checkout onto upstream, in a worker thread.

        Refused outright while a PTT line is asserted. Replacing the served bundle and the
        Python sources under a running transmission is not something to do to an operator who
        is on the air, and the update is never so urgent that it cannot wait for the slot to
        end.
        """
        if self.gpio_bridge is not None and self.gpio_bridge.any_pin_keyed():
            self._send_json(409, {
                "success": False,
                "error": "The transmitter is keyed. Finish or stop the transmission before updating.",
            })
            return
        if self.update_job is None:
            self._send_json(503, {"success": False, "error": "Updater unavailable."})
            return
        body = payload if isinstance(payload, dict) else {}
        result = self.update_job.start(
            reinstall_python=bool(body.get("reinstall_python")),
            rebuild_web=bool(body.get("rebuild_web")),
        )
        self._send_json(200 if result.get("success") else 409, result)

    def log_message(self, format, *args):
        # Suppress noisy per-asset HTTP logs.
        pass


# ============================================================================
# 7. BROWSER LAUNCH
# ============================================================================

def launch_native_app_window(url: str) -> None:
    """
    Opens the web UI in a dedicated app window (Chrome/Chromium/Brave/Edge/Firefox), falling
    back to the default browser.

    Each candidate is checked with shutil.which() before launching, because Popen returning
    without raising only means the binary existed - and the previous Windows path used
    os.system('start ...'), which never raises at all, so every fallback beneath it was
    unreachable. Only OSError is caught; a bare `except Exception` here hid real bugs.
    """
    time.sleep(0.35)

    app_browsers = [
        ["google-chrome", f"--app={url}"],
        ["google-chrome-stable", f"--app={url}"],
        ["chromium", f"--app={url}"],
        ["chromium-browser", f"--app={url}"],
        ["brave-browser", f"--app={url}"],
        ["brave", f"--app={url}"],
        ["microsoft-edge", f"--app={url}"],
        ["microsoft-edge-stable", f"--app={url}"],
        ["firefox", "--new-window", url],
        ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", f"--app={url}"],
        ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", f"--app={url}"],
        ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", f"--app={url}"],
    ]
    if sys.platform.startswith("win"):
        app_browsers = [
            ["msedge", f"--app={url}"],
            ["chrome", f"--app={url}"],
            ["brave", f"--app={url}"],
        ] + app_browsers

    for cmd in app_browsers:
        executable = shutil.which(cmd[0]) if not os.path.isabs(cmd[0]) else (cmd[0] if os.path.exists(cmd[0]) else None)
        if not executable:
            continue
        try:
            subprocess.Popen([executable] + cmd[1:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            logger.debug(f"Could not launch {cmd[0]}: {exc}")
            continue
        logger.info(f"Launched native application window using: {cmd[0]}")
        return

    logger.info(f"Opening z-30 in default web browser: {url}")
    webbrowser.open(url)


# ============================================================================
# 8. SERVER ENTRY POINT
# ============================================================================

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, listening_socket: socket.socket, handler_class):
        # The listening socket is already bound and listening (see bind_listening_socket), so
        # bind_and_activate is off and the socket is adopted as-is - no second bind, no race.
        HTTPServer.__init__(self, listening_socket.getsockname(), handler_class, bind_and_activate=False)
        self.socket.close()
        self.socket = listening_socket


def run_web_app(
    port: Optional[int] = None,
    no_browser: bool = False,
    rebuild: bool = False,
    gpio_pin: int = DEFAULT_GPIO_PTT_PIN,
) -> None:
    """Main entry point for starting the z-30 Web DSP application server."""
    dist_dir = locate_web_dist(rebuild=rebuild)
    if not dist_dir:
        logger.error("Could not locate a compiled 'dist' directory containing index.html.")
        logger.info("Run 'npm run build' (or start this server with --rebuild) and try again.")
        sys.exit(1)

    if not 1 <= gpio_pin <= 27:
        logger.error(f"--gpio-pin must be a BCM pin number between 1 and 27 (got {gpio_pin}).")
        sys.exit(1)

    try:
        listening_socket, app_port = bind_listening_socket(port or DEFAULT_PORT)
    except OSError as exc:
        logger.error(str(exc))
        sys.exit(1)

    url = f"http://127.0.0.1:{app_port}"

    gpio_bridge = GpioBridge(allowed_pin=gpio_pin)
    atexit.register(gpio_bridge.shutdown)

    class BoundHandler(SpaRequestHandler):
        api_token = secrets.token_urlsafe(32)
        allowed_origin = url
        allowed_hosts = {f"127.0.0.1:{app_port}", f"localhost:{app_port}"}

    BoundHandler.gpio_bridge = gpio_bridge
    BoundHandler.update_job = UpdateJob()

    def handler(*args, **kwargs):
        return BoundHandler(*args, directory=dist_dir, **kwargs)

    try:
        httpd = ThreadedHTTPServer(listening_socket, handler)
    except OSError as exc:
        logger.error(f"Failed to start HTTP server on {url}: {exc}")
        gpio_bridge.shutdown()
        sys.exit(1)

    def _shutdown(signum, _frame):
        # Releasing the PTT line is the first thing that happens on a signal: a killed server
        # must never leave a radio keyed.
        logger.info(f"Signal {signum} received - releasing PTT and shutting down.")
        gpio_bridge.shutdown()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _shutdown)
        except (ValueError, OSError):
            # Not the main thread, or the platform lacks the signal; atexit still covers us.
            pass

    print("==================================================================")
    print("      z-30 TRANSCEIVER & DSP SUITE (16-MFSK / LDPC-SIC)           ")
    print("==================================================================")
    print(f"  * Web UI Engine:  {url}")
    print(f"  * Dist Bundle:    {dist_dir}")
    print(f"  * PTT GPIO Pin:   BCM {gpio_pin} (dead-man release after {GPIO_KEEPALIVE_TIMEOUT_SEC:.1f}s)")
    print("  * Audio/CAT DSP:  16-MFSK @ 50 Hz, Hamlib rigctld relay via /api/rigctl")
    print("==================================================================")
    print("  Open the URL above in a browser on this machine. The local API is")
    print("  token-authenticated, and the token is issued only to that page.")
    print("  Press Ctrl+C in this terminal to shut down the transceiver.")
    print("==================================================================")

    if not no_browser:
        threading.Thread(target=launch_native_app_window, args=(url,), daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("\n[z-30] Shutting down transceiver server...")
        gpio_bridge.shutdown()
        httpd.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="z-30 Web DSP transceiver UI server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"TCP port to bind on 127.0.0.1 (default {DEFAULT_PORT}). "
                             "The server fails rather than silently moving to another port.")
    parser.add_argument("--no-browser", "-n", action="store_true", help="Do not open a browser window.")
    parser.add_argument("--rebuild", action="store_true",
                        help="Run 'npm run build' before serving (developers only; needs the source tree).")
    parser.add_argument("--gpio-pin", type=int, default=DEFAULT_GPIO_PTT_PIN,
                        help=f"BCM pin number the GPIO PTT bridge is allowed to drive (default {DEFAULT_GPIO_PTT_PIN}).")
    args, _unknown = parser.parse_known_args()

    run_web_app(port=args.port, no_browser=args.no_browser, rebuild=args.rebuild, gpio_pin=args.gpio_pin)


if __name__ == "__main__":
    main()
