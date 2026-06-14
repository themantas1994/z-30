"""Hamlib/rigctld rig control."""

from __future__ import annotations

import socket
import time

from z30_app.stability.logging_setup import get_logger

logger = get_logger(__name__)


class RigController:
    def __init__(self, config: dict):
        self.config = config
        self.connected = False
        self.last_error: str | None = None
        self.frequency_hz = 0
        self.mode = "USB"
        self.power = 0
        self.ptt = False

    def _radio_cfg(self) -> dict:
        return self.config.get("radio", self.config)

    def _host(self) -> str:
        r = self._radio_cfg()
        return str(r.get("host", self.config.get("radio_host", "127.0.0.1")))

    def _port(self) -> int:
        r = self._radio_cfg()
        return int(r.get("port", self.config.get("radio_port", 4532)))

    def _connection_type(self) -> str:
        r = self._radio_cfg()
        return str(r.get("connection_type", self.config.get("rig_connection_type", "Network (rigctld)")))

    def _command(self, cmd: str, timeout: float = 1.0) -> str:
        mode = self._connection_type()
        if mode == "1 - Dummy" or mode.startswith("Dummy"):
            self.connected = True
            return "OK"
        if mode not in ("Network (rigctld)", "2 - NET rigctl") and "rigctl" not in mode.lower():
            self.last_error = f"Unsupported rig mode: {mode}"
            return ""

        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                sock.connect((self._host(), self._port()))
                sock.sendall(f"{cmd}\n".encode("utf-8"))
                resp = sock.recv(256).decode("utf-8", errors="replace").strip()
                self.connected = True
                self.last_error = None
                return resp
        except OSError as exc:
            self.connected = False
            self.last_error = str(exc)
            logger.debug("Rig command '%s' failed: %s", cmd, exc)
            return ""

    def probe(self) -> tuple[bool, str]:
        resp = self._command("\\chk_vfo", timeout=0.5)
        if self.connected:
            return True, "Rig control connected"
        return False, self.last_error or "Rig control unavailable"

    def set_ptt(self, state: bool) -> None:
        self.ptt = state
        self._command("T 1" if state else "T 0")

    def get_frequency(self) -> int:
        resp = self._command("f")
        try:
            self.frequency_hz = int(float(resp.split()[0]))
        except (ValueError, IndexError):
            pass
        return self.frequency_hz

    def set_frequency(self, hz: int) -> None:
        self._command(f"F {hz}")
        self.frequency_hz = hz

    def get_mode(self) -> str:
        resp = self._command("m")
        if resp:
            self.mode = resp.split()[0] if resp else self.mode
        return self.mode

    def status_text(self) -> str:
        if self.connected:
            return f"{self.frequency_hz/1e6:.3f} MHz {self.mode} PTT={'ON' if self.ptt else 'OFF'}"
        return self.last_error or "Not connected"

    def sync_at_tx(self) -> None:
        if not self._radio_cfg().get("track_frequency", True):
            return
        self.get_frequency()
        self.get_mode()
