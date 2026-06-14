"""Startup subsystem diagnostics."""

from __future__ import annotations

import platform
import sys
import tkinter as tk
from tkinter import ttk
from typing import Callable

import numpy as np

from z30_app.audio.manager import AudioManager
from z30_app.config.manager import ConfigManager
from z30_app.rig.controller import RigController
from z30_app.stability.logging_setup import get_logger

logger = get_logger(__name__)


class StartupDiagnostics:
    def __init__(self):
        self.items: list[tuple[str, str, str]] = []  # name, status, detail
        self.ok = True

    def check_python(self) -> None:
        ver = sys.version.replace("\n", " ")
        self._add("Python", "OK", ver)

    def check_numpy(self) -> None:
        try:
            import numpy

            self._add("NumPy", "OK", numpy.__version__)
        except ImportError as exc:
            self._add("NumPy", "FAIL", str(exc), fail=True)

    def check_scipy(self) -> None:
        try:
            import scipy

            self._add("SciPy", "OK", scipy.__version__)
        except ImportError as exc:
            self._add("SciPy", "FAIL", str(exc), fail=True)

    def check_sounddevice(self) -> None:
        try:
            import sounddevice as sd

            self._add("SoundDevice", "OK", f"PortAudio {sd.get_portaudio_version('text')}")
        except Exception as exc:
            self._add("SoundDevice", "FAIL", str(exc), fail=True)

    def check_config(self, config_mgr: ConfigManager) -> None:
        config_mgr.load()
        if config_mgr.errors:
            self._add("Configuration", "WARN", "; ".join(config_mgr.errors))
        else:
            self._add("Configuration", "OK", str(config_mgr.config_path))

    def check_audio(self, config: dict) -> None:
        mgr = AudioManager(config)
        devices = mgr.list_devices()
        if not devices:
            self._add("Audio Devices", "WARN", "No audio devices found")
            return
        started = mgr.start()
        if started:
            mgr.stop()
            self._add("Audio Input", "OK", f"{len(devices)} device(s) available")
        else:
            self._add("Audio Input", "WARN", mgr.status_message)

    def check_rig(self, config: dict) -> None:
        rig = RigController(config)
        ok, msg = rig.probe()
        status = "OK" if ok else "WARN"
        self._add("Rig Control", status, msg)

    def check_modem(self) -> None:
        try:
            from z30_app.dsp.modem import Z30AdvancedModem

            modem = Z30AdvancedModem()
            bits = modem.string_to_bits("CQ TEST FN20")
            wf = modem.modulate(bits, 1500)
            if wf.size > 0:
                self._add("DSP Modem", "OK", f"Frame {wf.size} samples")
            else:
                self._add("DSP Modem", "FAIL", "Empty waveform", fail=True)
        except Exception as exc:
            self._add("DSP Modem", "FAIL", str(exc), fail=True)

    def check_gui(self, root: tk.Tk) -> None:
        try:
            _ = tk.PhotoImage(width=16, height=16)
            self._add("Tkinter GUI", "OK", f"Tcl/Tk {root.tk.call('info', 'patchlevel')}")
        except tk.TclError as exc:
            self._add("Tkinter GUI", "FAIL", str(exc), fail=True)

    def _add(self, name: str, status: str, detail: str, fail: bool = False) -> None:
        self.items.append((name, status, detail))
        if fail:
            self.ok = False

    def run_all(self, root: tk.Tk, config_mgr: ConfigManager) -> None:
        self.items.clear()
        self.ok = True
        self.check_python()
        self.check_numpy()
        self.check_scipy()
        self.check_sounddevice()
        self.check_config(config_mgr)
        self.check_audio(config_mgr.config)
        self.check_rig(config_mgr.config)
        self.check_modem()
        self.check_gui(root)


class DiagnosticsWindow(tk.Toplevel):
    def __init__(self, master: tk.Tk, diagnostics: StartupDiagnostics, on_continue: Callable[[], None], on_abort: Callable[[], None]):
        super().__init__(master)
        self.title("Z-30 Startup Diagnostics")
        self.geometry("720x420")
        self.transient(master)
        self.grab_set()

        ttk.Label(self, text="Z-30 Startup Diagnostics", font=("Consolas", 12, "bold")).pack(pady=8)
        frame = ttk.Frame(self)
        frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        cols = ("Subsystem", "Status", "Details")
        tree = ttk.Treeview(frame, columns=cols, show="headings", height=12)
        for c in cols:
            tree.heading(c, text=c)
            tree.column(c, width=120 if c != "Details" else 420, anchor=tk.W)
        tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scroll = ttk.Scrollbar(frame, orient=tk.VERTICAL, command=tree.yview)
        tree.configure(yscrollcommand=scroll.set)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)

        for name, status, detail in diagnostics.items:
            tag = "ok" if status == "OK" else ("warn" if status == "WARN" else "fail")
            tree.insert("", tk.END, values=(name, status, detail), tags=(tag,))
        tree.tag_configure("ok", foreground="#4caf50")
        tree.tag_configure("warn", foreground="#ffeb3b")
        tree.tag_configure("fail", foreground="#f44336")

        btn_frame = ttk.Frame(self)
        btn_frame.pack(pady=10)
        if diagnostics.ok:
            ttk.Button(btn_frame, text="Continue", command=lambda: self._close(on_continue)).pack(side=tk.LEFT, padx=5)
        else:
            ttk.Label(btn_frame, text="Critical failures detected. You may still continue with reduced functionality.").pack()
            ttk.Button(btn_frame, text="Continue Anyway", command=lambda: self._close(on_continue)).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_frame, text="Exit", command=lambda: self._close(on_abort)).pack(side=tk.LEFT, padx=5)

    def _close(self, cb: Callable[[], None]) -> None:
        self.grab_release()
        self.destroy()
        cb()
