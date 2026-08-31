"""
z-30 Amateur Radio Digital Mode - Startup Configuration Wizard
==============================================================
Module: config_wizard.py
Author: Lead Python GUI & DSP Architecture Engineer
Target: Python 3.10+ / Tkinter & ttk

Features:
- Multi-step modular Wizard dialog container (< Back, Next >, Cancel, Finish).
- Operator Info page with real-time ITU callsign & Maidenhead grid regex validation.
- Audio Device Enumeration (sounddevice / PyAudio / fallback) with real-time VU test meter.
- Radio CAT & PTT Hardware configuration (Hamlib, Direct Serial, Network rigctld).
- RTS / DTR Pin Polarity logic (Active High vs Active Low / Inverted Open-Collector).
- Interactive background-threaded CAT & PTT toggle tester with 3-second safety cutoff.
- SettingsManager for robust JSON schema loading, validation, saving, and defaults.
- Self-contained execution & seamless integration into the z-30 GUI pipeline.
"""

from dataclasses import dataclass, asdict, field
import json
import math
import os
import re
import socket
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Optional, Dict, List, Tuple, Any, Callable


# ============================================================================
# 1. DATA MODELS & SETTINGS MANAGER
# ============================================================================

# StationConfig and SettingsManager now live in station_settings.py so that the validation
# rules are importable without Tkinter (this module is not - it subclasses ttk.Frame below).
# Re-exported here because callers and the wiki both refer to them by this module.
from .station_settings import StationConfig, SettingsManager  # noqa: F401


# ============================================================================
# 2. HARDWARE ENUMERATION & TESTING HELPERS
# ============================================================================

class AudioHardwareDetector:
    """Queries system audio drivers for input/output devices and runs level tests."""

    @staticmethod
    def get_devices() -> Tuple[List[Tuple[int, str, int]], List[Tuple[int, str, int]]]:
        """
        Returns:
            Tuple containing:
            - inputs: List of (device_index, friendly_name, max_input_channels)
            - outputs: List of (device_index, friendly_name, max_output_channels)
        """
        inputs: List[Tuple[int, str, int]] = []
        outputs: List[Tuple[int, str, int]] = []

        # 1. Attempt using sounddevice library
        try:
            import sounddevice as sd
            devs = sd.query_devices()
            for idx, d in enumerate(devs):
                name = d.get("name", f"Audio Device #{idx}")
                hostapi_idx = d.get("hostapi", 0)
                api_info = sd.query_hostapis(hostapi_idx)
                api_name = api_info.get("name", "")
                label = f"[{idx}] {name} ({api_name})"

                if d.get("max_input_channels", 0) > 0:
                    inputs.append((idx, label, d["max_input_channels"]))
                if d.get("max_output_channels", 0) > 0:
                    outputs.append((idx, label, d["max_output_channels"]))
            if inputs or outputs:
                return inputs, outputs
        except Exception:
            pass

        # 2. Fallback using PyAudio
        try:
            import pyaudio
            p = pyaudio.PyAudio()
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                name = info.get("name", f"Device {i}")
                in_ch = info.get("maxInputChannels", 0)
                out_ch = info.get("maxOutputChannels", 0)
                if in_ch > 0:
                    inputs.append((i, f"[{i}] {name} (PyAudio)", in_ch))
                if out_ch > 0:
                    outputs.append((i, f"[{i}] {name} (PyAudio)", out_ch))
            p.terminate()
            if inputs or outputs:
                return inputs, outputs
        except Exception:
            pass

        # 3. Standard fallback devices if no audio library is installed
        inputs = [
            (0, "[0] Default System Microphone / Audio Codec", 2),
            (1, "[1] USB Audio CODEC (Icom / Yaesu USB Rig)", 2),
            (2, "[2] Line In (Sound Card / Virtual Audio Cable)", 2),
        ]
        outputs = [
            (0, "[0] Default System Speakers / Audio Output", 2),
            (1, "[1] USB Audio CODEC (Transmitter Audio In)", 2),
            (2, "[2] Line Out / Virtual Audio Cable", 2),
        ]
        return inputs, outputs


def rigctld_command(host: str, port: int, command: str, timeout_sec: float = 2.0) -> Tuple[bool, str]:
    """
    Sends one rigctl command to a local rigctld daemon and returns (reached, reply).

    `reached` is False only when the daemon could not be talked to at all; a daemon that
    answered "RPRT -1" is reached and refused, and the caller must tell those two apart. The
    reply is returned verbatim - nothing here substitutes a plausible-looking value for an
    error, which is what the wizard's CAT test used to do with a hardcoded 14.074000 MHz.
    """
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
                if chunks[-1].endswith(b"\n"):
                    break
            return True, b"".join(chunks).decode("utf-8", errors="replace").strip()
    except OSError as exc:
        return False, (
            f"could not reach rigctld ({exc}). Start it with "
            f"'rigctld -m <model> -r <serial port> -s <baud>'."
        )


class SerialHardwareDetector:
    """Detects available physical and virtual serial (COM) ports querying the real OS."""

    @staticmethod
    def get_serial_ports() -> List[Tuple[str, str]]:
        """Returns a list of (port_path, friendly_description) discovered from host OS."""
        ports: List[Tuple[str, str]] = []
        
        # 1. Query via pyserial if available
        try:
            import serial.tools.list_ports
            for p in serial.tools.list_ports.comports():
                desc = p.description if p.description and p.description != "n/a" else "Serial Device"
                hwid = f" ({p.hwid})" if p.hwid and p.hwid != "n/a" else ""
                ports.append((p.device, f"{p.device} - {desc}{hwid}"))
            if ports:
                return ports
        except Exception:
            pass

        # 2. Query Windows Registry for real active COM ports
        if sys.platform.startswith("win"):
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\SERIALCOMM")
                for i in range(winreg.QueryInfoKey(key)[1]):
                    name, val, _ = winreg.EnumValue(key, i)
                    ports.append((val, f"{val} ({name})"))
                winreg.CloseKey(key)
            except Exception:
                pass

        # 3. Query Linux sysfs / devfs for real existing serial devices
        elif sys.platform.startswith("linux"):
            import glob
            real_devs = sorted(
                glob.glob("/dev/serial/by-id/*") +
                glob.glob("/dev/serial/by-path/*") +
                glob.glob("/dev/ttyUSB*") +
                glob.glob("/dev/ttyACM*")
            )
            seen = set()
            for dev in real_devs:
                real_target = os.path.realpath(dev)
                if real_target not in seen and os.path.exists(dev):
                    seen.add(real_target)
                    ports.append((dev, f"{dev} (Hardware Serial)"))

        # 4. Query macOS real existing callout devices
        elif sys.platform.startswith("darwin"):
            import glob
            real_cu = sorted(glob.glob("/dev/cu.usb*") + glob.glob("/dev/cu.SLAB*") + glob.glob("/dev/cu.wch*"))
            for dev in real_cu:
                if os.path.exists(dev):
                    ports.append((dev, f"{dev} (USB Serial Interface)"))

        return ports


class HamlibRigCatalog:
    """Catalog of popular amateur transceivers and Hamlib model numbers."""
    RIGS = [
        ("Icom IC-7300 (USB Audio/CAT)", 3073),
        ("Icom IC-7610 (Direct USB)", 3078),
        ("Icom IC-705 (QRP / Bluetooth / USB)", 3085),
        ("Icom IC-7100", 3070),
        ("Icom IC-9700 (VHF/UHF/1.2G)", 3081),
        ("Icom Generic CI-V Transceiver", 3000),
        ("Yaesu FT-991A", 1035),
        ("Yaesu FTDX10 / FTDX101D", 1040),
        ("Yaesu FT-891", 1036),
        ("Yaesu FT-857D / FT-897", 1022),
        ("Yaesu FT-817 / FT-818 (QRP)", 1020),
        ("Elecraft K3 / K3S", 2029),
        ("Elecraft K4", 2038),
        ("Elecraft KX3 / KX2 (QRP)", 2045),
        ("Kenwood TS-590SG", 2028),
        ("Kenwood TS-890S", 2048),
        ("Kenwood TS-2000", 2014),
        ("Xiegu G90 (CE-19 Interface)", 3088),
        ("Xiegu X6100 (Embedded SDR)", 3090),
        ("QRP Labs QDX Digital Transceiver", 3092),
        ("FlexRadio 6xxx Series (SmartSDR)", 1014),
        ("Hamlib NET rigctl Client (Remote Daemon)", 2),
        ("Dummy / Simulated Rig (Testing)", 1),
    ]


# ============================================================================
# 3. WIZARD STEP PAGES
# ============================================================================

class WizardBasePage(ttk.Frame):
    """Abstract base class for individual wizard steps."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent)
        self.wizard = wizard
        self.config = wizard.config

    def on_enter(self) -> None:
        """Called when this page becomes visible."""
        pass

    def on_leave(self) -> None:
        """Called when navigating away from this page."""
        pass

    def validate_page(self) -> Tuple[bool, str]:
        """Validates page inputs before allowing user to advance."""
        return True, ""


# ----------------------------------------------------------------------------
# STEP 1: OPERATOR INFORMATION
# ----------------------------------------------------------------------------
class Step1OperatorPage(WizardBasePage):
    """Step 1: Operator Callsign, Maidenhead Grid Locator, and Station Info."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(1, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 1: Operator Station Identification\n"
                 "Please enter your official amateur radio callsign and Maidenhead grid locator.",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 15))

        # Callsign Field
        ttk.Label(self, text="Callsign:*", font=("Fira Code", 10, "bold")).grid(row=1, column=0, sticky="w", padx=10, pady=6)
        self.call_var = tk.StringVar(value=self.config.callsign if self.config.callsign != "N0CALL" else "")
        self.call_entry = ttk.Entry(self, textvariable=self.call_var, width=18, font=("Fira Code", 11, "bold"))
        self.call_entry.grid(row=1, column=1, sticky="w", padx=6, pady=6)
        self.call_entry.bind("<KeyRelease>", self._on_call_change)

        self.call_status = ttk.Label(self, text="", font=("Fira Code", 9))
        self.call_status.grid(row=1, column=2, sticky="w", padx=6, pady=6)

        # Grid Field
        ttk.Label(self, text="Grid Locator:*", font=("Fira Code", 10, "bold")).grid(row=2, column=0, sticky="w", padx=10, pady=6)
        self.grid_var = tk.StringVar(value=self.config.grid if self.config.grid != "AA00aa" else "")
        self.grid_entry = ttk.Entry(self, textvariable=self.grid_var, width=18, font=("Fira Code", 11, "bold"))
        self.grid_entry.grid(row=2, column=1, sticky="w", padx=6, pady=6)
        self.grid_entry.bind("<KeyRelease>", self._on_grid_change)

        self.grid_status = ttk.Label(self, text="", font=("Fira Code", 9))
        self.grid_status.grid(row=2, column=2, sticky="w", padx=6, pady=6)

        # Geo Coordinates Preview
        self.geo_label = ttk.Label(self, text="Location: (Waiting for valid 4/6-char grid square...)", font=("Fira Code", 9), foreground="#888888")
        self.geo_label.grid(row=3, column=1, columnspan=2, sticky="w", padx=6, pady=(0, 10))

        # Separator
        ttk.Separator(self, orient="horizontal").grid(row=4, column=0, columnspan=3, sticky="ew", padx=10, pady=10)

        # Optional Metadata
        ttk.Label(self, text="Operator Name:", font=("Fira Code", 10)).grid(row=5, column=0, sticky="w", padx=10, pady=6)
        self.name_var = tk.StringVar(value=self.config.operator_name)
        self.name_entry = ttk.Entry(self, textvariable=self.name_var, width=28)
        self.name_entry.grid(row=5, column=1, columnspan=2, sticky="w", padx=6, pady=6)

        ttk.Label(self, text="QTH / City:", font=("Fira Code", 10)).grid(row=6, column=0, sticky="w", padx=10, pady=6)
        self.qth_var = tk.StringVar(value=self.config.qth_description)
        self.qth_entry = ttk.Entry(self, textvariable=self.qth_var, width=28)
        self.qth_entry.grid(row=6, column=1, columnspan=2, sticky="w", padx=6, pady=6)

        # Notes / ITU Compliance Notice
        note_box = ttk.LabelFrame(self, text=" ITU Protocol Compliance Notice ")
        note_box.grid(row=7, column=0, columnspan=3, sticky="ew", padx=10, pady=(15, 5))
        ttk.Label(
            note_box,
            text="The z-30 digital mode encodes operator callsigns and Maidenhead grid squares into a\n"
                 "63-bit structured payload protected by a (216, 77) LDPC error-correction code.\n"
                 "Standard format ensures complete global inter-compatibility across the 50 Hz channel.",
            font=("Fira Code", 8),
            foreground="#AAAAAA"
        ).pack(anchor="w", padx=8, pady=6)

    def _on_call_change(self, event=None) -> None:
        """Auto-capitalizes callsign and runs validation."""
        text = self.call_var.get().upper().strip()
        self.call_var.set(text)
        is_ok, msg = SettingsManager.validate_callsign(text)
        if is_ok:
            self.call_status.config(text="✓ Valid ITU Callsign", foreground="#00FF41")
        else:
            self.call_status.config(text=f"✗ {msg}", foreground="#FF6B6B")
        self.wizard.update_nav_buttons()

    def _on_grid_change(self, event=None) -> None:
        """Formats grid square (e.g. FN31pr) and updates geographic preview."""
        raw = self.grid_var.get().strip()
        # Auto-format: First 2 uppercase, next 2 numbers, last 2 lowercase
        formatted = ""
        for i, char in enumerate(raw):
            if i < 2:
                formatted += char.upper()
            elif i < 4:
                formatted += char
            elif i < 6:
                formatted += char.lower()
        if formatted != raw:
            self.grid_var.set(formatted)

        is_ok, msg = SettingsManager.validate_grid(formatted)
        if is_ok:
            self.grid_status.config(text="✓ Valid Maidenhead", foreground="#00FF41")
            latlon = SettingsManager.maidenhead_to_latlon(formatted)
            if latlon:
                lat, lon = latlon
                lat_str = f"{abs(lat):.2f}° {'N' if lat >= 0 else 'S'}"
                lon_str = f"{abs(lon):.2f}° {'E' if lon >= 0 else 'W'}"
                self.geo_label.config(text=f"Location: Lat {lat_str}, Lon {lon_str}", foreground="#38BDF8")
        else:
            self.grid_status.config(text=f"✗ {msg}", foreground="#FF6B6B")
            self.geo_label.config(text="Location: (Waiting for valid grid...)", foreground="#888888")
        self.wizard.update_nav_buttons()

    def on_enter(self) -> None:
        self._on_call_change()
        self._on_grid_change()
        self.call_entry.focus_set()

    def validate_page(self) -> Tuple[bool, str]:
        call = self.call_var.get().strip().upper()
        grid = self.grid_var.get().strip()
        call_ok, call_msg = SettingsManager.validate_callsign(call)
        if not call_ok:
            return False, f"Callsign Error: {call_msg}"
        grid_ok, grid_msg = SettingsManager.validate_grid(grid)
        if not grid_ok:
            return False, f"Grid Error: {grid_msg}"

        # Persist into wizard state
        self.config.callsign = call
        self.config.grid = grid
        self.config.operator_name = self.name_var.get().strip()
        self.config.qth_description = self.qth_var.get().strip()
        return True, ""


# ----------------------------------------------------------------------------
# STEP 2: AUDIO DEVICE CONFIGURATION
# ----------------------------------------------------------------------------
class Step2AudioPage(WizardBasePage):
    """Step 2: Audio Device Configuration (Rx/Tx) and Live VU Input Level Meter."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self.is_testing_audio = False
        self.meter_thread: Optional[threading.Thread] = None
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(1, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 2: Sound Card & Audio DSP Configuration\n"
                 "Select soundcard input (Rx Receiver Audio) and output (Tx Transmit Audio).",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 12))

        # Audio Input (Rx)
        ttk.Label(self, text="Input Device (Rx):*", font=("Fira Code", 10, "bold")).grid(row=1, column=0, sticky="w", padx=10, pady=6)
        self.in_combo = ttk.Combobox(self, state="readonly", width=42)
        self.in_combo.grid(row=1, column=1, sticky="ew", padx=6, pady=6)

        # Audio Output (Tx)
        ttk.Label(self, text="Output Device (Tx):*", font=("Fira Code", 10, "bold")).grid(row=2, column=0, sticky="w", padx=10, pady=6)
        self.out_combo = ttk.Combobox(self, state="readonly", width=42)
        self.out_combo.grid(row=2, column=1, sticky="ew", padx=6, pady=6)

        # Refresh Hardware Button
        self.refresh_btn = ttk.Button(self, text="↻ Refresh Devices", command=self._populate_devices)
        self.refresh_btn.grid(row=1, column=2, rowspan=2, padx=10, pady=6)

        # Sample Rate & Channel Options
        opt_frame = ttk.LabelFrame(self, text=" Audio DSP Parameters ")
        opt_frame.grid(row=3, column=0, columnspan=3, sticky="ew", padx=10, pady=10)
        opt_frame.columnconfigure(1, weight=1)
        opt_frame.columnconfigure(3, weight=1)

        ttk.Label(opt_frame, text="Sample Rate:").grid(row=0, column=0, sticky="w", padx=8, pady=6)
        self.rate_combo = ttk.Combobox(opt_frame, values=["12000 Hz (Native z-30)", "48000 Hz (HD Standard)"], state="readonly", width=22)
        self.rate_combo.set("12000 Hz (Native z-30)" if self.config.sample_rate_hz == 12000 else "48000 Hz (HD Standard)")
        self.rate_combo.grid(row=0, column=1, sticky="w", padx=6, pady=6)

        ttk.Label(opt_frame, text="Channels:").grid(row=0, column=2, sticky="w", padx=8, pady=6)
        self.ch_combo = ttk.Combobox(opt_frame, values=["Mono (Channel 1 / Left)", "Stereo (2 Channels)"], state="readonly", width=22)
        self.ch_combo.set("Mono (Channel 1 / Left)" if self.config.audio_channels == 1 else "Stereo (2 Channels)")
        self.ch_combo.grid(row=0, column=3, sticky="w", padx=6, pady=6)

        # Live VU Input Level Tester
        test_frame = ttk.LabelFrame(self, text=" Live Audio Input Level Test ")
        test_frame.grid(row=4, column=0, columnspan=3, sticky="ew", padx=10, pady=(5, 10))
        test_frame.columnconfigure(1, weight=1)

        self.test_audio_btn = ttk.Button(test_frame, text="▶ Test Audio Input", command=self._toggle_audio_test)
        self.test_audio_btn.grid(row=0, column=0, padx=8, pady=8)

        # Canvas VU Meter
        self.vu_canvas = tk.Canvas(test_frame, height=22, bg="#050505", highlightthickness=1, highlightbackground="#333333")
        self.vu_canvas.grid(row=0, column=1, sticky="ew", padx=6, pady=8)

        self.vu_label = ttk.Label(test_frame, text="0.0 dB", font=("Fira Code", 9, "bold"), width=8)
        self.vu_label.grid(row=0, column=2, padx=8, pady=8)

        # Initial device population
        self._populate_devices()

    def _populate_devices(self) -> None:
        """Enumerates sound devices and populates dropdown lists."""
        inputs, outputs = AudioHardwareDetector.get_devices()
        self.raw_inputs = inputs
        self.raw_outputs = outputs

        in_values = [item[1] for item in inputs]
        out_values = [item[1] for item in outputs]

        self.in_combo["values"] = in_values
        self.out_combo["values"] = out_values

        if in_values:
            # Match existing config or pick first
            matched = False
            for v in in_values:
                if str(self.config.audio_input_index) in v or self.config.audio_input_device in v:
                    self.in_combo.set(v)
                    matched = True
                    break
            if not matched:
                self.in_combo.current(0)

        if out_values:
            matched = False
            for v in out_values:
                if str(self.config.audio_output_index) in v or self.config.audio_output_device in v:
                    self.out_combo.set(v)
                    matched = True
                    break
            if not matched:
                self.out_combo.current(0)

    def _toggle_audio_test(self) -> None:
        """Starts or stops the background audio level meter test thread."""
        if self.is_testing_audio:
            self._stop_audio_test()
        else:
            self._start_audio_test()

    def _start_audio_test(self) -> None:
        self.is_testing_audio = True
        self.test_audio_btn.config(text="⏹ Stop Level Test")
        self.meter_thread = threading.Thread(target=self._audio_meter_loop, daemon=True)
        self.meter_thread.start()

    def _stop_audio_test(self) -> None:
        self.is_testing_audio = False
        self.test_audio_btn.config(text="▶ Test Audio Input")
        self._draw_vu_level(0.0)

    def _get_selected_input_device_index(self) -> Optional[int]:
        """Resolves the currently selected input combobox entry back to its sounddevice index."""
        selected_label = self.in_combo.get()
        for idx, label, _ch in getattr(self, "raw_inputs", []):
            if label == selected_label:
                return idx
        return None

    def _audio_meter_loop(self) -> None:
        """
        Reads the REAL peak level from the selected audio input device via sounddevice and
        updates the Tkinter VU meter. A prior version of this method never touched the audio
        hardware at all - it animated a fabricated sine-wave level, which would show a
        healthy-looking meter even with the microphone muted, disconnected, or misconfigured.
        """
        device_idx = self._get_selected_input_device_index()

        try:
            import sounddevice as sd
            import numpy as np

            level_holder = {"peak": 0.0}

            def _callback(indata, frames, time_info, status):
                level_holder["peak"] = float(np.max(np.abs(indata))) if len(indata) else 0.0

            with sd.InputStream(device=device_idx, channels=1, samplerate=48000, callback=_callback):
                while self.is_testing_audio:
                    self.after(0, self._draw_vu_level, min(1.0, level_holder["peak"]))
                    time.sleep(0.05)
        except Exception as ex:
            self.after(0, self._on_audio_test_error, str(ex))

    def _on_audio_test_error(self, message: str) -> None:
        """Reports a real audio input stream failure honestly instead of faking a level."""
        self.is_testing_audio = False
        self.test_audio_btn.config(text="▶ Test Audio Input")
        self._draw_vu_level(0.0)
        self.vu_label.config(text="N/A")
        messagebox.showwarning(
            "Audio Input Test Unavailable",
            f"Could not open a real audio input stream to measure levels: {message}\n\n"
            "Install the 'sounddevice' package (pip install sounddevice) and verify the "
            "selected input device is available.",
        )

    def _draw_vu_level(self, level: float) -> None:
        """Renders color-coded level meter on Canvas (Green -> Yellow -> Red)."""
        self.vu_canvas.delete("all")
        w = self.vu_canvas.winfo_width()
        h = self.vu_canvas.winfo_height()
        if w < 10:
            w = 260
        if h < 5:
            h = 22

        fill_w = int(w * level)
        db_val = 20 * math.log10(max(level, 0.001))
        self.vu_label.config(text=f"{db_val:.1f} dB")

        # Color segments
        green_w = min(fill_w, int(w * 0.7))
        yellow_w = min(max(0, fill_w - int(w * 0.7)), int(w * 0.2))
        red_w = max(0, fill_w - int(w * 0.9))

        if green_w > 0:
            self.vu_canvas.create_rectangle(0, 0, green_w, h, fill="#00FF41", outline="")
        if yellow_w > 0:
            self.vu_canvas.create_rectangle(int(w * 0.7), 0, int(w * 0.7) + yellow_w, h, fill="#EAB308", outline="")
        if red_w > 0:
            self.vu_canvas.create_rectangle(int(w * 0.9), 0, int(w * 0.9) + red_w, h, fill="#EF4444", outline="")

    def on_leave(self) -> None:
        self._stop_audio_test()

    def validate_page(self) -> Tuple[bool, str]:
        in_choice = self.in_combo.get()
        out_choice = self.out_combo.get()
        if not in_choice:
            return False, "Please select an Input Audio Device."
        if not out_choice:
            return False, "Please select an Output Audio Device."

        self.config.audio_input_device = in_choice
        self.config.audio_output_device = out_choice
        self.config.sample_rate_hz = 12000 if "12000" in self.rate_combo.get() else 48000
        self.config.audio_channels = 1 if "Mono" in self.ch_combo.get() else 2
        return True, ""


# ----------------------------------------------------------------------------
# STEP 3: RADIO & CAT / PTT CONTROL CONFIGURATION
# ----------------------------------------------------------------------------
class Step3RadioCatPage(WizardBasePage):
    """Step 3: Rig Model, Serial Port, Baud Rate, PTT Polarity & Pin Testing."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self.is_ptt_keyed = False
        # Set by _key_ptt() and waited on by the worker thread that owns the keyed line, so
        # "Release PTT" and leaving the page both drop the transmitter immediately.
        self._ptt_release_event = threading.Event()
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(1, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 3: Transceiver CAT & PTT Control Configuration\n"
                 "Configure Hamlib / serial rig connection, RTS/DTR PTT keying, and pin polarity.",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 10))

        # CAT Control Method
        ttk.Label(self, text="CAT Method:*", font=("Fira Code", 10, "bold")).grid(row=1, column=0, sticky="w", padx=10, pady=4)
        self.cat_method_combo = ttk.Combobox(self, values=["Hamlib (libhamlib/rigctld)", "Direct Serial CAT", "None (Manual PTT/VOX)"], state="readonly", width=32)
        self.cat_method_combo.set("Hamlib (libhamlib/rigctld)" if self.config.cat_method == "Hamlib" else self.config.cat_method)
        self.cat_method_combo.grid(row=1, column=1, sticky="w", padx=6, pady=4)
        self.cat_method_combo.bind("<<ComboboxSelected>>", self._on_cat_method_change)

        # Rig Model
        ttk.Label(self, text="Rig Model:", font=("Fira Code", 10)).grid(row=2, column=0, sticky="w", padx=10, pady=4)
        self.rig_combo = ttk.Combobox(self, values=[r[0] for r in HamlibRigCatalog.RIGS], state="readonly", width=36)
        self.rig_combo.set(self.config.rig_model_name)
        self.rig_combo.grid(row=2, column=1, sticky="w", padx=6, pady=4)

        # Serial / COM Port
        ttk.Label(self, text="Serial / CAT Port:*", font=("Fira Code", 10, "bold")).grid(row=3, column=0, sticky="w", padx=10, pady=4)
        port_box = ttk.Frame(self)
        port_box.grid(row=3, column=1, sticky="w", padx=6, pady=4)

        self.port_combo = ttk.Combobox(port_box, width=24)
        self.port_combo.pack(side="left", padx=(0, 4))

        self.port_refresh_btn = ttk.Button(port_box, text="↻ Refresh", width=9, command=self._populate_ports)
        self.port_refresh_btn.pack(side="left")

        # Serial Parameters (Baud, Data, Stop, Handshake)
        params_frame = ttk.Frame(self)
        params_frame.grid(row=4, column=0, columnspan=3, sticky="ew", padx=10, pady=4)

        ttk.Label(params_frame, text="Baud Rate:").pack(side="left", padx=(0, 4))
        self.baud_combo = ttk.Combobox(params_frame, values=["4800", "9600", "19200", "38400", "57600", "115200"], state="readonly", width=8)
        self.baud_combo.set(str(self.config.baud_rate))
        self.baud_combo.pack(side="left", padx=(0, 12))

        ttk.Label(params_frame, text="Data Bits:").pack(side="left", padx=(0, 4))
        self.data_combo = ttk.Combobox(params_frame, values=["8", "7"], state="readonly", width=4)
        self.data_combo.set(str(self.config.data_bits))
        self.data_combo.pack(side="left", padx=(0, 12))

        ttk.Label(params_frame, text="Stop:").pack(side="left", padx=(0, 4))
        self.stop_combo = ttk.Combobox(params_frame, values=["1", "2"], state="readonly", width=4)
        self.stop_combo.set(str(self.config.stop_bits))
        self.stop_combo.pack(side="left", padx=(0, 12))

        ttk.Label(params_frame, text="Handshake:").pack(side="left", padx=(0, 4))
        self.hs_combo = ttk.Combobox(params_frame, values=["None", "Hardware RTS/CTS", "XON/XOFF"], state="readonly", width=16)
        self.hs_combo.set(self.config.handshake)
        self.hs_combo.pack(side="left")

        # Separator
        ttk.Separator(self, orient="horizontal").grid(row=5, column=0, columnspan=3, sticky="ew", padx=10, pady=8)

        # PTT Method & Pin Polarity Controls
        ptt_group = ttk.LabelFrame(self, text=" Push-To-Talk (PTT) Keying & Polarity Logic ")
        ptt_group.grid(row=6, column=0, columnspan=3, sticky="ew", padx=10, pady=4)
        ptt_group.columnconfigure(1, weight=1)

        ttk.Label(ptt_group, text="PTT Method:").grid(row=0, column=0, sticky="w", padx=8, pady=4)
        self.ptt_method_combo = ttk.Combobox(ptt_group, values=["CAT Command", "RTS Pin", "DTR Pin", "VOX"], state="readonly", width=18)
        self.ptt_method_combo.set(self.config.ptt_method)
        self.ptt_method_combo.grid(row=0, column=1, sticky="w", padx=6, pady=4)

        # Pin Polarity Selector
        ttk.Label(ptt_group, text="Pin Polarity:").grid(row=1, column=0, sticky="w", padx=8, pady=4)
        polarity_box = ttk.Frame(ptt_group)
        polarity_box.grid(row=1, column=1, columnspan=2, sticky="w", padx=6, pady=4)

        self.polarity_var = tk.StringVar(value=self.config.ptt_polarity)
        ttk.Radiobutton(
            polarity_box,
            text="Positive / Active High (1 = PTT ON, 0 = OFF)",
            variable=self.polarity_var,
            value="ACTIVE_HIGH"
        ).pack(anchor="w")

        ttk.Radiobutton(
            polarity_box,
            text="Negative / Active Low (0 = PTT ON, Pull-to-GND / Inverted Optocoupler)",
            variable=self.polarity_var,
            value="ACTIVE_LOW"
        ).pack(anchor="w")

        # Interactive Test CAT & PTT Section
        test_frame = ttk.LabelFrame(self, text=" Hardware Verification & Safety Test ")
        test_frame.grid(row=7, column=0, columnspan=3, sticky="ew", padx=10, pady=(6, 5))

        test_btns = ttk.Frame(test_frame)
        test_btns.pack(fill="x", padx=8, pady=6)

        self.test_cat_btn = ttk.Button(test_btns, text="Test CAT Connection", command=self._test_cat_connection)
        self.test_cat_btn.pack(side="left", padx=4)

        self.test_ptt_btn = ttk.Button(test_btns, text="PTT Key Test (3s Safety Auto-Release)", command=self._toggle_ptt_test)
        self.test_ptt_btn.pack(side="left", padx=4)

        self.test_result_label = ttk.Label(test_btns, text="Status: Ready to test", font=("Fira Code", 9), foreground="#38BDF8")
        self.test_result_label.pack(side="left", padx=10)

        self._populate_ports()

    def _populate_ports(self) -> None:
        """Scans system serial ports and updates port combo."""
        ports = SerialHardwareDetector.get_serial_ports()
        port_names = [p[0] for p in ports]
        self.port_combo["values"] = port_names
        if port_names:
            if self.config.serial_port in port_names:
                self.port_combo.set(self.config.serial_port)
            else:
                self.port_combo.set(port_names[0])

    def _on_cat_method_change(self, event=None) -> None:
        val = self.cat_method_combo.get()
        if "None" in val:
            self.rig_combo.config(state="disabled")
            self.port_combo.config(state="disabled")
            self.baud_combo.config(state="disabled")
        else:
            self.rig_combo.config(state="readonly")
            self.port_combo.config(state="normal")
            self.baud_combo.config(state="readonly")

    # -- real hardware tests ----------------------------------------------
    #
    # Both tests below used to be theatre. `_test_cat_connection` opened and closed the serial
    # port without sending a byte and reported "✓ Serial Port OK", and on the rigctld path it
    # printed "(VFO: 14.074000 MHz)" - a hardcoded string from the `else` branch - whenever the
    # daemon answered anything that was not a bare number, including an outright error. The PTT
    # test updated two labels and a timer: it said "● TRANSMITTING via CAT Command [Pin: 1
    # (HIGH)]" and then "✓ PTT Released (Transmitter in RX Standby)" without ever addressing a
    # serial port, a GPIO or a daemon. An operator who set the station up here was told the
    # wiring was good by code that had never touched the wiring.

    def _set_test_result(self, text: str, colour: str) -> None:
        """Updates the result label from a worker thread (Tk is not thread-safe)."""
        self.after(0, lambda: self.test_result_label.config(text=text, foreground=colour))

    def _rigctld_endpoint(self) -> Tuple[str, int]:
        """The rigctld host/port this wizard should talk to, from the config being edited."""
        host = getattr(self.config, "net_cat_host", "127.0.0.1") or "127.0.0.1"
        try:
            port = int(getattr(self.config, "net_cat_port", 4532) or 4532)
        except (TypeError, ValueError):
            port = 4532
        return host, port

    def _selected_baud(self) -> int:
        value = self.baud_combo.get()
        return int(value) if value.isdigit() else 115200

    def _open_keying_serial(self, released_level: bool) -> Any:
        """
        Opens the PTT serial port with both modem control lines already in the RELEASED state.

        pyserial raises DTR and RTS when a port opens, exactly as Chromium does, so opening the
        port to test keying would key an RTS- or DTR-wired transmitter before the test began.
        Assigning the attributes before open() applies them as the port comes up.

        `released_level` rather than a hardcoded False, because the released level is the HIGH
        one on an inverting (active-low) interface: driving both lines low there would key
        precisely the stations this is meant to protect.
        """
        import serial  # imported lazily: pyserial is only needed on the hardware paths

        port_name = (self.config.ptt_port or self.port_combo.get()).strip()
        if not port_name:
            raise ValueError("No serial port is selected for PTT keying.")
        ser = serial.Serial()
        ser.port = port_name
        ser.baudrate = self._selected_baud()
        ser.timeout = 1.0
        ser.rts = released_level
        ser.dtr = released_level
        ser.open()
        return ser

    def _test_cat_connection(self) -> None:
        """Runs a real CAT query in the background and reports exactly what came back."""
        method = self.cat_method_combo.get()
        port = self.port_combo.get().strip()
        baud = self._selected_baud()
        rig = self.rig_combo.get()
        self.test_result_label.config(text="Status: Querying rig CAT...", foreground="#EAB308")

        def bg_test() -> None:
            if "None" in method:
                self._set_test_result(
                    "ℹ CAT is disabled (None / Manual VOX). No query was sent.", "#EAB308"
                )
                return

            if "Hamlib" in method:
                host, port_num = self._rigctld_endpoint()
                ok, reply = rigctld_command(host, port_num, "f")
                if not ok:
                    self._set_test_result(f"✗ rigctld {host}:{port_num}: {reply}", "#EF4444")
                    return
                first = reply.split()[0] if reply.split() else ""
                if not first.lstrip("-").isdigit():
                    # An error reply is an error. It used to be replaced with 14.074000 MHz.
                    self._set_test_result(
                        f"✗ rigctld answered '{reply}' - the daemon is running but could not read "
                        f"the VFO. Check the rig model and serial settings it was started with.",
                        "#EF4444",
                    )
                    return
                self._set_test_result(
                    f"✓ rigctld {host}:{port_num} reports VFO {int(first) / 1e6:.6f} MHz ({rig})",
                    "#00FF41",
                )
                return

            # Direct Serial: this wizard carries no per-rig command tables, so it can verify the
            # port and nothing more - and says so rather than implying the radio answered.
            try:
                import serial
            except ImportError as exc:
                self._set_test_result(f"✗ pyserial is not installed ({exc}).", "#EF4444")
                return
            try:
                handle = serial.Serial(port, baudrate=baud, timeout=1.0)
                handle.close()
            except Exception as exc:
                self._set_test_result(f"✗ Serial error on {port}: {exc}", "#EF4444")
                return
            self._set_test_result(
                f"ℹ Serial port {port} opened at {baud} baud. No CAT command was sent - this wizard "
                f"has no per-rig command set. Use the z-30 app's Test CAT Connection, or Hamlib, for "
                f"a protocol-level check.",
                "#EAB308",
            )

        threading.Thread(target=bg_test, daemon=True).start()

    def _toggle_ptt_test(self) -> None:
        """Keys PTT with polarity handling and 3-second safety timeout."""
        if self.is_ptt_keyed:
            self._release_ptt()
        else:
            self._key_ptt()

    def _key_ptt(self) -> None:
        method = self.ptt_method_combo.get()
        polarity = self.polarity_var.get()

        if "VOX" in method:
            self.test_result_label.config(
                text="ℹ VOX has no keying line to test: the radio keys off the transmitted audio "
                     "itself. Test it from the z-30 app, which can generate that audio.",
                foreground="#EAB308",
            )
            return

        if "CAT" in method and "Hamlib" not in self.cat_method_combo.get():
            self.test_result_label.config(
                text="✗ CAT keying from this wizard needs CAT Method 'Hamlib (libhamlib/rigctld)': "
                     "there is no per-rig serial command set here. Use the z-30 app for Direct Serial "
                     "CAT keying.",
                foreground="#EF4444",
            )
            return

        if not messagebox.askokcancel(
            "Key the transmitter?",
            "This asserts PTT on the real radio for up to 3 seconds.\n\n"
            "Make sure the antenna or dummy load is connected and the rig is on a frequency you "
            "are licensed to transmit on.",
        ):
            return

        self.is_ptt_keyed = True
        self._ptt_release_event = threading.Event()
        self.test_ptt_btn.config(text="⏹ Release PTT (Active TX)")
        self.test_result_label.config(
            text=f"● Keying via {method} [{polarity}]...", foreground="#EF4444"
        )
        threading.Thread(target=self._ptt_worker, args=(method, polarity), daemon=True).start()

    def _ptt_worker(self, method: str, polarity: str) -> None:
        """
        Keys the line, holds it for at most 3 s, and releases it - reporting what the hardware
        actually did at each step. The release runs in a `finally`, so an exception between the
        two cannot leave a transmitter keyed.
        """
        active_high = polarity == "ACTIVE_HIGH"
        handle = None
        keyed = False
        try:
            if "CAT" in method:
                host, port_num = self._rigctld_endpoint()
                ok, reply = rigctld_command(host, port_num, "T 1")
                if not ok or not reply.strip().startswith("RPRT 0"):
                    self._set_test_result(
                        f"✗ rigctld refused the PTT command: {reply}. Nothing was keyed.", "#EF4444"
                    )
                    return
                keyed = True
                self._set_test_result(
                    f"● TRANSMITTING via rigctld {host}:{port_num} - releasing in 3 s...", "#EF4444"
                )
            else:
                line = "RTS" if "RTS" in method else "DTR"
                handle = self._open_keying_serial(released_level=not active_high)
                if line == "RTS":
                    handle.rts = active_high
                else:
                    handle.dtr = active_high
                keyed = True
                self._set_test_result(
                    f"● TRANSMITTING: {line} on {handle.port} driven "
                    f"{'high' if active_high else 'low'} [{polarity}] - releasing in 3 s...",
                    "#EF4444",
                )

            self._ptt_release_event.wait(3.0)
        except Exception as exc:
            self._set_test_result(f"✗ PTT test failed: {exc}", "#EF4444")
        finally:
            released_note = ""
            try:
                if keyed and "CAT" in method:
                    host, port_num = self._rigctld_endpoint()
                    ok, reply = rigctld_command(host, port_num, "T 0")
                    if not ok or not reply.strip().startswith("RPRT 0"):
                        released_note = (
                            f" ✗ THE RELEASE WAS REFUSED ({reply}) - check the radio is back in "
                            f"receive."
                        )
                elif handle is not None:
                    # The RELEASED level for this wiring, not a blanket low - which is the
                    # keyed level on an active-low interface.
                    handle.rts = not active_high
                    handle.dtr = not active_high
            except Exception as exc:
                released_note = f" ✗ THE RELEASE FAILED ({exc}) - check the radio is back in receive."
            finally:
                if handle is not None:
                    try:
                        handle.close()
                    except Exception:
                        pass
            if keyed:
                self._set_test_result(
                    ("✓ PTT released (transmitter back in RX standby)" if not released_note
                     else "PTT release problem:") + released_note,
                    "#EF4444" if released_note else "#00FF41",
                )
            self.after(0, self._reset_ptt_button)

    def _reset_ptt_button(self) -> None:
        self.is_ptt_keyed = False
        self.test_ptt_btn.config(text="PTT Key Test (3s Safety Auto-Release)")

    def _release_ptt(self) -> None:
        """Asks the worker to release now; the worker owns the hardware handle."""
        event = getattr(self, "_ptt_release_event", None)
        if event is not None:
            event.set()
        self._reset_ptt_button()

    def on_leave(self) -> None:
        if self.is_ptt_keyed:
            self._release_ptt()

    def validate_page(self) -> Tuple[bool, str]:
        cat_method = self.cat_method_combo.get()
        if "Hamlib" in cat_method:
            self.config.cat_method = "Hamlib"
        elif "Direct" in cat_method:
            self.config.cat_method = "Direct Serial"
        else:
            self.config.cat_method = "None"

        self.config.rig_model_name = self.rig_combo.get()
        # Find matching model id
        for name, mid in HamlibRigCatalog.RIGS:
            if name == self.config.rig_model_name:
                self.config.rig_model_id = mid
                break

        self.config.serial_port = self.port_combo.get()
        try:
            self.config.baud_rate = int(self.baud_combo.get())
            self.config.data_bits = int(self.data_combo.get())
            self.config.stop_bits = int(self.stop_combo.get())
        except ValueError:
            pass

        self.config.handshake = self.hs_combo.get()
        self.config.ptt_method = self.ptt_method_combo.get()
        self.config.ptt_polarity = self.polarity_var.get()
        return True, ""


# ----------------------------------------------------------------------------
# STEP 4: SUMMARY & CONFIRMATION
# ----------------------------------------------------------------------------
class Step4SummaryPage(WizardBasePage):
    """Step 4: Complete configuration review and JSON save confirmation."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 4: Configuration Review & Verification\n"
                 "Review your station parameters before saving to config.json and launching z-30.",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, sticky="w", padx=10, pady=(10, 10))

        # Review Treeview Table
        table_frame = ttk.Frame(self)
        table_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=5)
        table_frame.columnconfigure(0, weight=1)

        self.tree = ttk.Treeview(table_frame, columns=("Parameter", "Value"), show="headings", height=10)
        self.tree.heading("Parameter", text="Configuration Parameter")
        self.tree.heading("Value", text="Configured Value")
        self.tree.column("Parameter", width=220)
        self.tree.column("Value", width=340)
        self.tree.pack(fill="both", expand=True)

        # Destination notice
        self.file_label = ttk.Label(
            self,
            text=f"Target File: {os.path.abspath(self.wizard.settings_mgr.config_path)}",
            font=("Fira Code", 8),
            foreground="#888888"
        )
        self.file_label.grid(row=2, column=0, sticky="w", padx=10, pady=(6, 2))

    def on_enter(self) -> None:
        """Populates the summary table with latest values from all pages."""
        self.tree.delete(*self.tree.get_children())
        cfg = self.config

        items = [
            ("Operator Callsign", cfg.callsign),
            ("Maidenhead Grid Locator", cfg.grid),
            ("Operator Name / QTH", f"{cfg.operator_name or 'N/A'} ({cfg.qth_description or 'N/A'})"),
            ("Audio Input (Rx)", cfg.audio_input_device),
            ("Audio Output (Tx)", cfg.audio_output_device),
            ("Sample Rate / Channels", f"{cfg.sample_rate_hz} Hz / {'Mono' if cfg.audio_channels == 1 else 'Stereo'}"),
            ("CAT Control Method", cfg.cat_method),
            ("Rig Model", f"{cfg.rig_model_name} (ID: {cfg.rig_model_id})"),
            ("Serial Port & Baud", f"{cfg.serial_port} @ {cfg.baud_rate} baud ({cfg.data_bits}N{cfg.stop_bits})"),
            ("PTT Keying Method", f"{cfg.ptt_method} (Polarity: {cfg.ptt_polarity})"),
            ("z-30 Mode Standard", "16-MFSK / 50 Hz BW / 30s Slot / LDPC(216,77) + SIC"),
        ]

        for param, val in items:
            self.tree.insert("", "end", values=(param, val))


# ============================================================================
# 4. WIZARD DIALOG CONTAINER
# ============================================================================

class ConfigWizardDialog(tk.Toplevel):
    """
    Modular Multi-Step Wizard Modal Dialog for z-30 Initial Setup.
    Includes sidebar step indicators, validation gates, and backward/forward navigation.
    """

    def __init__(
        self,
        parent: Optional[tk.Tk] = None,
        settings_mgr: Optional[SettingsManager] = None,
        on_finish_callback: Optional[Callable[[StationConfig], None]] = None
    ) -> None:
        super().__init__(parent)
        self.title("z-30 Transceiver - Initial Setup & Hardware Configuration Wizard")
        self.geometry("820x540")
        self.minsize(760, 480)
        self.configure(bg="#0F0F0F")
        self.transient(parent)
        self.grab_set()

        self.settings_mgr = settings_mgr or SettingsManager()
        self.config = self.settings_mgr.load_config()
        self.on_finish_callback = on_finish_callback
        self.current_step_idx = 0

        self._init_styles()
        self._build_container()
        self._show_step(0)

        # Center on screen
        self.update_idletasks()
        x = (self.winfo_screenwidth() - self.winfo_width()) // 2
        y = (self.winfo_screenheight() - self.winfo_height()) // 2
        self.geometry(f"+{x}+{y}")

    def _init_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background="#0F0F0F", foreground="#D4D4D4", font=("Fira Code", 9))
        style.configure("Treeview", background="#141414", foreground="#F8FAFC", fieldbackground="#141414")
        style.map("Treeview", background=[("selected", "#00FF41")], foreground=[("selected", "#000000")])
        style.configure("TButton", font=("Fira Code", 9, "bold"))

    def _build_container(self) -> None:
        # Main Layout: Left Sidebar + Right Content Area
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)

        # Left Sidebar (Step Indicators)
        self.sidebar = tk.Frame(self, bg="#080808", width=200, bd=1, relief="solid")
        self.sidebar.grid(row=0, column=0, sticky="ns", padx=(6, 0), pady=6)
        self.sidebar.pack_propagate(False)

        # Logo / Title
        tk.Label(
            self.sidebar,
            text="z-30 SETUP",
            font=("Fira Code", 13, "bold"),
            fg="#00FF41",
            bg="#080808"
        ).pack(anchor="w", padx=12, pady=(15, 5))

        tk.Label(
            self.sidebar,
            text="Weak-Signal 16-MFSK",
            font=("Fira Code", 8),
            fg="#888888",
            bg="#080808"
        ).pack(anchor="w", padx=12, pady=(0, 20))

        # Step Labels in Sidebar
        self.step_labels: List[tk.Label] = []
        step_names = [
            "1. Operator Info",
            "2. Audio Devices",
            "3. Radio & CAT",
            "4. Summary",
        ]
        for name in step_names:
            lbl = tk.Label(
                self.sidebar,
                text=name,
                font=("Fira Code", 9),
                fg="#666666",
                bg="#080808",
                anchor="w"
            )
            lbl.pack(fill="x", padx=12, pady=6)
            self.step_labels.append(lbl)

        # Right Content Area (Pages)
        self.content_frame = tk.Frame(self, bg="#0F0F0F")
        self.content_frame.grid(row=0, column=1, sticky="nsew", padx=6, pady=6)
        self.content_frame.columnconfigure(0, weight=1)
        self.content_frame.rowconfigure(0, weight=1)

        # Initialize Page Instances
        self.pages: List[WizardBasePage] = [
            Step1OperatorPage(self.content_frame, self),
            Step2AudioPage(self.content_frame, self),
            Step3RadioCatPage(self.content_frame, self),
            Step4SummaryPage(self.content_frame, self),
        ]
        for page in self.pages:
            page.grid(row=0, column=0, sticky="nsew")

        # Bottom Navigation Control Bar
        nav_bar = tk.Frame(self, bg="#080808", height=45, bd=1, relief="solid")
        nav_bar.grid(row=1, column=0, columnspan=2, sticky="ew", padx=6, pady=(0, 6))

        self.error_label = tk.Label(nav_bar, text="", font=("Fira Code", 9), fg="#EF4444", bg="#080808")
        self.error_label.pack(side="left", padx=12)

        # Buttons on Right
        self.cancel_btn = ttk.Button(nav_bar, text="Cancel", command=self._on_cancel)
        self.cancel_btn.pack(side="right", padx=6, pady=8)

        self.finish_btn = tk.Button(
            nav_bar,
            text="Finish & Save",
            font=("Fira Code", 9, "bold"),
            bg="#00FF41",
            fg="black",
            command=self._on_finish
        )

        self.next_btn = ttk.Button(nav_bar, text="Next >", command=self._on_next)
        self.next_btn.pack(side="right", padx=6, pady=8)

        self.back_btn = ttk.Button(nav_bar, text="< Back", command=self._on_back)
        self.back_btn.pack(side="right", padx=6, pady=8)

    def _show_step(self, step_idx: int) -> None:
        """Switches visible page and updates navigation indicators."""
        self.current_step_idx = step_idx
        self.error_label.config(text="")

        # Update sidebar indicators
        for idx, lbl in enumerate(self.step_labels):
            if idx == step_idx:
                lbl.config(fg="#00FF41", font=("Fira Code", 10, "bold"))
            elif idx < step_idx:
                lbl.config(fg="#38BDF8", font=("Fira Code", 9))
            else:
                lbl.config(fg="#555555", font=("Fira Code", 9))

        # Show target page
        for idx, page in enumerate(self.pages):
            if idx == step_idx:
                page.tkraise()
                page.on_enter()

        self.update_nav_buttons()

    def update_nav_buttons(self) -> None:
        """Enables/disables Back, Next, and Finish buttons based on current state."""
        is_first = (self.current_step_idx == 0)
        is_last = (self.current_step_idx == len(self.pages) - 1)

        self.back_btn.config(state="disabled" if is_first else "normal")

        if is_last:
            self.next_btn.pack_forget()
            self.finish_btn.pack(side="right", padx=6, pady=8)
        else:
            self.finish_btn.pack_forget()
            self.next_btn.pack(side="right", padx=6, pady=8)

    def _on_next(self) -> None:
        """Validates current page and advances to next step."""
        current_page = self.pages[self.current_step_idx]
        is_valid, err_msg = current_page.validate_page()
        if not is_valid:
            self.error_label.config(text=f"⚠ {err_msg}")
            return

        current_page.on_leave()
        if self.current_step_idx < len(self.pages) - 1:
            self._show_step(self.current_step_idx + 1)

    def _on_back(self) -> None:
        """Navigates back to previous page."""
        current_page = self.pages[self.current_step_idx]
        current_page.on_leave()
        if self.current_step_idx > 0:
            self._show_step(self.current_step_idx - 1)

    def _on_cancel(self) -> None:
        """Prompts confirmation before exiting wizard."""
        if messagebox.askyesno("Cancel Setup", "Are you sure you want to exit setup wizard without saving?", parent=self):
            self.destroy()

    def _on_finish(self) -> None:
        """Validates, persists config to JSON, and executes finish callback."""
        current_page = self.pages[self.current_step_idx]
        is_valid, err_msg = current_page.validate_page()
        if not is_valid:
            self.error_label.config(text=f"⚠ {err_msg}")
            return

        current_page.on_leave()

        # Save to disk
        success = self.settings_mgr.save_config(self.config)
        if success:
            messagebox.showinfo(
                "Setup Complete",
                f"Configuration successfully saved to {self.settings_mgr.config_path}!\n"
                f"Station Callsign: {self.config.callsign} ({self.config.grid})\n"
                "z-30 Transceiver is ready to operate.",
                parent=self
            )
            if self.on_finish_callback:
                self.on_finish_callback(self.config)
            self.destroy()
        else:
            messagebox.showerror("Save Error", "Failed to write configuration file. Please check directory write permissions.", parent=self)


# ============================================================================
# 5. INTEGRATION HOOKS & STANDALONE EXECUTION
# ============================================================================

def launch_config_wizard_if_needed(
    root: tk.Tk,
    config_path: Optional[str] = None,
    force: bool = False,
    on_complete: Optional[Callable[[StationConfig], None]] = None
) -> Optional[ConfigWizardDialog]:
    """
    Helper function for main GUI startup:
    Checks if a valid config exists; if not (or if forced), presents the Setup Wizard.

    `config_path` defaults to None, not to "config.json", so that SettingsManager resolves the
    per-user path from z30_dsp.paths. The bare relative default meant the wizard wrote into
    whatever directory z-30 was launched from, and a second launch from elsewhere came up with
    defaults and offered to run the wizard again.
    """
    mgr = SettingsManager(config_path)
    if force or not mgr.has_valid_config_file():
        wizard = ConfigWizardDialog(root, mgr, on_complete)
        return wizard
    return None


def main():
    root = tk.Tk()
    root.withdraw()

    def on_setup_finished(cfg: StationConfig):
        print(f"[z-30 Startup] Wizard finished! Callsign: {cfg.callsign}, Grid: {cfg.grid}, Rig: {cfg.rig_model_name}")

    wiz = ConfigWizardDialog(parent=root, on_finish_callback=on_setup_finished)
    root.wait_window(wiz)
    root.destroy()

if __name__ == "__main__":
    main()

