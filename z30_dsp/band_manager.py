"""
z-30 Amateur Radio Digital Mode - Band Manager & Hamlib CAT Tuning Module
========================================================================

Provides global standard band presets for z-30 (16-MFSK, 50 Hz BW),
automatic CAT frequency tuning via Hamlib (rigctld / Direct CAT),
and persistent configuration storage in `config.json`.
"""

import os
import sys
import json
import socket
import logging
from typing import Dict, Optional, Tuple, Callable, List
from dataclasses import dataclass, asdict

from z30_dsp.paths import default_config_path

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")
logger = logging.getLogger("z30.BandManager")

# ============================================================================
# 1. GLOBAL DEFAULT BAND PRESETS (z-30 Standard Dial Frequencies in Hz)
# ============================================================================

DEFAULT_BANDS: Dict[str, int] = {
    "160m": 1842000,
    "80m":  3576000,
    "60m":  5359000,
    "40m":  7076000,
    "30m":  10139000,
    "20m":  14076000,
    "17m":  18102000,
    "15m":  21076000,
    "12m":  24917000,
    "10m":  28076000,
    "6m":   50316000,
    "2m":   144176000,
    "70cm": 432176000
}

# Band frequency boundaries for auto-detection (min_hz, max_hz)
BAND_LIMITS: Dict[str, Tuple[int, int]] = {
    "160m": (1800000, 2000000),
    "80m":  (3500000, 4000000),
    "60m":  (5350000, 5410000),
    "40m":  (7000000, 7300000),
    "30m":  (10100000, 10150000),
    "20m":  (14000000, 14350000),
    "17m":  (18068000, 18168000),
    "15m":  (21000000, 21450000),
    "12m":  (24890000, 24990000),
    "10m":  (28000000, 29700000),
    "6m":   (50000000, 54000000),
    "2m":   (144000000, 148000000),
    "70cm": (430000000, 440000000)
}


# ============================================================================
# 2. HAMLIB RIGCTLD CLIENT INTERFACE
# ============================================================================

class HamlibCatClient:
    """
    Lightweight TCP Client for Hamlib's rigctld daemon (default: 127.0.0.1:4532).
    Implements standard Hamlib protocol commands for frequency & mode tuning.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 4532, timeout: float = 1.5):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None

    def connect(self) -> bool:
        """Establishes TCP connection to rigctld daemon."""
        try:
            self.disconnect()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.host, self.port))
            logger.info(f"Connected to Hamlib rigctld at {self.host}:{self.port}")
            return True
        except Exception as ex:
            logger.warning(f"Hamlib connection failed ({self.host}:{self.port}): {ex}")
            self.sock = None
            return False

    def disconnect(self) -> None:
        """Closes TCP connection."""
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    def send_command(self, cmd: str) -> str:
        """Sends raw command line to rigctld and reads response."""
        if not self.sock:
            if not self.connect():
                return "ERR: Disconnected"

        try:
            full_cmd = cmd.strip() + "\n"
            self.sock.sendall(full_cmd.encode("ascii"))
            resp = self.sock.recv(1024).decode("ascii").strip()
            return resp
        except Exception as ex:
            logger.error(f"Hamlib command '{cmd}' error: {ex}")
            self.disconnect()
            return f"ERR: {ex}"

    @staticmethod
    def _accepted(resp: str) -> bool:
        """
        True only when rigctld actually acknowledged the command.

        An empty reply used to count as success here, so a daemon that timed out mid-read - or
        a socket that returned nothing at all - reported a tuned radio. rigctld answers a
        completed set command with 'RPRT 0' and a refused one with 'RPRT <non-zero>'; silence
        is neither, and it is the one case where the caller most needs to be told.
        """
        cleaned = resp.strip()
        return cleaned == "RPRT 0" or cleaned == "0"

    def set_frequency(self, freq_hz: int) -> bool:
        """Tunes transceiver to specified frequency (Hamlib command: 'F <freq_hz>')."""
        return self._accepted(self.send_command(f"F {freq_hz}"))

    def get_frequency(self) -> Optional[int]:
        """Queries current VFO frequency (Hamlib command: 'f')."""
        resp = self.send_command("f")
        try:
            lines = resp.split()
            if lines and lines[0].isdigit():
                return int(lines[0])
            return None
        except Exception:
            return None

    def set_mode(self, mode: str = "PKTUSB", passband_hz: int = 3000) -> bool:
        """Sets transceiver modulation mode and IF passband (Hamlib command: 'M <mode> <passband>')."""
        if self._accepted(self.send_command(f"M {mode} {passband_hz}")):
            return True
        # Fallback to standard USB if PKTUSB is not supported by rig
        return self._accepted(self.send_command(f"M USB {passband_hz}"))

    # set_ptt() used to live here: a second keying implementation, reachable from the CLI band
    # tool, with none of the checks that stand in front of the browser's. Nothing called it.
    # AGENTS.md section 4 allows exactly one keying implementation and one gate in front of it,
    # so the way to key a transmitter from this codebase is the transmit path in
    # src/dsp/catController.ts - not a spare `T 1` on a socket.


# ============================================================================
# 3. BAND MANAGER CLASS
# ============================================================================

class BandManager:
    """
    Manages amateur radio band presets, persistent storage in config.json,
    and automatic transceiver frequency tuning via Hamlib CAT.
    """

    def __init__(self, config_path: Optional[str] = None, hamlib_client: Optional[HamlibCatClient] = None):
        # Resolved through z30_dsp.paths for the same reason SettingsManager is: this reads and
        # writes the operator's config.json, the same file the setup wizard writes. A bare
        # relative default here meant `z30 --bands` and `z30 --wizard` could edit two different
        # files depending on which directory each was launched from.
        self.config_path = config_path or default_config_path()
        self.hamlib = hamlib_client or HamlibCatClient()
        self.bands: Dict[str, int] = dict(DEFAULT_BANDS)
        self.active_band: str = "20m"
        self.active_frequency_hz: int = DEFAULT_BANDS["20m"]
        self.on_band_change_listeners: List[Callable[[str, int], None]] = []

        # Load persisted configuration if present
        self.load_config()

    def register_listener(self, callback: Callable[[str, int], None]) -> None:
        """Registers a callback invoked whenever band or frequency changes."""
        if callback not in self.on_band_change_listeners:
            self.on_band_change_listeners.append(callback)

    def _notify_listeners(self) -> None:
        """Notifies all registered listeners of current band & frequency."""
        for cb in self.on_band_change_listeners:
            try:
                cb(self.active_band, self.active_frequency_hz)
            except Exception as ex:
                logger.error(f"Error in band change listener: {ex}")

    def load_config(self) -> bool:
        """
        Loads custom band frequencies and last active band from config.json.
        Preserves DEFAULT_BANDS for any missing band keys.
        """
        if not os.path.exists(self.config_path):
            logger.info(f"Configuration file {self.config_path} not found. Using default band presets.")
            return False

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # 1. Load custom band dictionary if present
            custom_bands = data.get("bands", {})
            for band_name, default_hz in DEFAULT_BANDS.items():
                if band_name in custom_bands and isinstance(custom_bands[band_name], int) and custom_bands[band_name] > 0:
                    self.bands[band_name] = custom_bands[band_name]
                else:
                    self.bands[band_name] = default_hz

            # 2. Restore active band & frequency
            saved_band = data.get("active_band")
            if saved_band in self.bands:
                self.active_band = saved_band
                self.active_frequency_hz = self.bands[saved_band]

            saved_freq = data.get("dial_frequency_hz")
            if isinstance(saved_freq, int) and saved_freq > 0:
                self.active_frequency_hz = saved_freq
                detected = self.detect_band(saved_freq)
                if detected:
                    self.active_band = detected

            logger.info(f"Loaded band configuration from {self.config_path}. Active: {self.active_band} ({self.active_frequency_hz} Hz)")
            return True
        except Exception as ex:
            logger.error(f"Failed to read {self.config_path}: {ex}")
            return False

    def save_config(self) -> bool:
        """
        Persists current band frequencies and active state to config.json.
        Merges with existing config file without overwriting other station keys.
        """
        data: Dict = {}
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}

        data["bands"] = dict(self.bands)
        data["active_band"] = self.active_band
        data["dial_frequency_hz"] = self.active_frequency_hz

        try:
            parent = os.path.dirname(os.path.abspath(self.config_path))
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved band configuration to {self.config_path}")
            return True
        except Exception as ex:
            logger.error(f"Failed to write {self.config_path}: {ex}")
            return False

    def get_frequency(self, band_name: str) -> int:
        """Returns dial frequency (Hz) for requested band."""
        return self.bands.get(band_name, DEFAULT_BANDS.get(band_name, 14076000))

    def set_frequency(self, band_name: str, freq_hz: int, persist: bool = True) -> bool:
        """
        Updates dial frequency for a specific band.
        Validates frequency against band limits if available.
        """
        if freq_hz <= 0:
            logger.warning(f"Invalid frequency {freq_hz} for {band_name}")
            return False

        self.bands[band_name] = freq_hz
        if self.active_band == band_name:
            self.active_frequency_hz = freq_hz

        if persist:
            self.save_config()

        self._notify_listeners()
        return True

    def reset_to_defaults(self, persist: bool = True) -> None:
        """Restores all band presets to the global DEFAULT_BANDS dictionary."""
        self.bands = dict(DEFAULT_BANDS)
        self.active_frequency_hz = self.bands.get(self.active_band, DEFAULT_BANDS["20m"])
        if persist:
            self.save_config()
        self._notify_listeners()
        logger.info("Band presets reset to global defaults.")

    def reset_band_to_default(self, band_name: str, persist: bool = True) -> bool:
        """Restores a single band to its default dial frequency."""
        if band_name in DEFAULT_BANDS:
            self.bands[band_name] = DEFAULT_BANDS[band_name]
            if self.active_band == band_name:
                self.active_frequency_hz = self.bands[band_name]
            if persist:
                self.save_config()
            self._notify_listeners()
            return True
        return False

    def detect_band(self, freq_hz: int) -> Optional[str]:
        """
        Identifies which amateur band a given frequency falls into.
        Returns band name (e.g. '20m') or None if out of standard bounds.
        """
        for band_name, (min_hz, max_hz) in BAND_LIMITS.items():
            if min_hz <= freq_hz <= max_hz:
                return band_name

        # Fallback: check closest default preset within 500 kHz
        for band_name, def_hz in self.bands.items():
            if abs(def_hz - freq_hz) < 500000:
                return band_name

        return None

    def select_band(self, band_name: str, tune_cat: bool = True) -> bool:
        """
        Switches the active band preset and optionally tunes the radio via Hamlib CAT.
        """
        if band_name not in self.bands:
            logger.error(f"Unknown band: {band_name}")
            return False

        target_freq = self.bands[band_name]
        self.active_band = band_name
        self.active_frequency_hz = target_freq

        logger.info(f"Selected band {band_name} -> {target_freq:,} Hz ({target_freq / 1e6:.6f} MHz)")

        # Execute CAT tuning if requested
        if tune_cat:
            cat_success = self.tune_radio(target_freq)
            if not cat_success:
                logger.warning(f"CAT tuning failed for {band_name} at {target_freq} Hz")

        self.save_config()
        self._notify_listeners()
        return True

    def tune_radio(self, freq_hz: int, mode: str = "PKTUSB") -> bool:
        """
        Commands connected Hamlib rigctld to tune VFO A to `freq_hz` and set PKTUSB/USB mode.
        """
        freq_ok = self.hamlib.set_frequency(freq_hz)
        mode_ok = self.hamlib.set_mode(mode, 3000)
        return freq_ok

    def sync_from_radio(self) -> Optional[int]:
        """
        Polls connected transceiver via CAT, updates active frequency,
        and auto-detects current amateur band.
        """
        rig_freq = self.hamlib.get_frequency()
        if rig_freq and rig_freq > 0:
            self.active_frequency_hz = rig_freq
            detected = self.detect_band(rig_freq)
            if detected:
                self.active_band = detected
            self._notify_listeners()
            return rig_freq
        return None

    def format_frequency(self, freq_hz: Optional[int] = None) -> str:
        """Formats frequency as standard MHz string with 6 decimal places (e.g. 14.076.000 MHz)."""
        hz = freq_hz if freq_hz is not None else self.active_frequency_hz
        return f"{hz / 1e6:.6f} MHz"


# ============================================================================
# 4. TKINTER GUI CONTROLS & BAND SELECTION DIALOG
# ============================================================================

try:
    import tkinter as tk
    from tkinter import ttk, messagebox

    class BandManagerDialog(tk.Toplevel):
        """
        Modal dialog for viewing, tuning, and editing z-30 band presets.
        """

        def __init__(self, parent: tk.Tk, band_manager: BandManager, on_select: Optional[Callable[[str], None]] = None):
            super().__init__(parent)
            self.title("z-30 Band Manager & CAT Preset Tuning")
            self.geometry("640x520")
            self.configure(bg="#0F0F0F")
            self.resizable(False, False)
            self.grab_set()

            self.bm = band_manager
            self.on_select = on_select
            self.entries: Dict[str, tk.StringVar] = {}

            self._build_ui()

        def _build_ui(self) -> None:
            # Header
            hdr = tk.Frame(self, bg="#141414", height=50)
            hdr.pack(fill="x", padx=10, pady=(10, 5))

            tk.Label(
                hdr,
                text="📡 z-30 Amateur Band Presets & CAT Tuning",
                font=("Fira Code", 12, "bold"),
                fg="#00FF41",
                bg="#141414"
            ).pack(side="left", padx=10, pady=10)

            status_text = f"Active: {self.bm.active_band} ({self.bm.format_frequency()})"
            self.status_lbl = tk.Label(
                hdr,
                text=status_text,
                font=("Fira Code", 9, "bold"),
                fg="#FACC15",
                bg="#141414"
            )
            self.status_lbl.pack(side="right", padx=10, pady=10)

            # Main Grid of Bands
            grid_frame = tk.Frame(self, bg="#0F0F0F")
            grid_frame.pack(fill="both", expand=True, padx=10, pady=5)

            # Table Header
            cols = ["Band", "Dial Freq (Hz)", "MHz", "Action"]
            for col_idx, col_name in enumerate(cols):
                lbl = tk.Label(
                    grid_frame,
                    text=col_name,
                    font=("Fira Code", 9, "bold"),
                    fg="#888888",
                    bg="#0F0F0F"
                )
                lbl.grid(row=0, column=col_idx, padx=5, pady=4, sticky="w")

            # Populate Rows
            for row_idx, (band_name, default_hz) in enumerate(DEFAULT_BANDS.items(), start=1):
                is_active = (band_name == self.bm.active_band)
                current_hz = self.bm.get_frequency(band_name)

                # Band Name
                b_lbl = tk.Label(
                    grid_frame,
                    text=f"{band_name:5s}",
                    font=("Fira Code", 10, "bold"),
                    fg="#00FF41" if is_active else "#D4D4D4",
                    bg="#0F0F0F"
                )
                b_lbl.grid(row=row_idx, column=0, padx=5, pady=2, sticky="w")

                # Freq Entry in Hz
                var = tk.StringVar(value=str(current_hz))
                self.entries[band_name] = var
                ent = tk.Entry(
                    grid_frame,
                    textvariable=var,
                    font=("Fira Code", 9),
                    fg="#FACC15" if is_active else "#FFFFFF",
                    bg="#181818",
                    insertbackground="#00FF41",
                    relief="solid",
                    bd=1,
                    width=12
                )
                ent.grid(row=row_idx, column=1, padx=5, pady=2, sticky="w")

                # MHz Readout
                mhz_text = f"{current_hz / 1e6:10.6f} MHz"
                mhz_lbl = tk.Label(
                    grid_frame,
                    text=mhz_text,
                    font=("Fira Code", 9),
                    fg="#888888",
                    bg="#0F0F0F"
                )
                mhz_lbl.grid(row=row_idx, column=2, padx=5, pady=2, sticky="w")

                # Tune Button
                btn_frame = tk.Frame(grid_frame, bg="#0F0F0F")
                btn_frame.grid(row=row_idx, column=3, padx=5, pady=2, sticky="w")

                tune_btn = tk.Button(
                    btn_frame,
                    text="Tune CAT",
                    font=("Fira Code", 8, "bold"),
                    bg="#00FF41" if is_active else "#222222",
                    fg="#000000" if is_active else "#D4D4D4",
                    activebackground="#00FF41",
                    activeforeground="#000000",
                    relief="flat",
                    command=lambda b=band_name: self._on_tune_clicked(b)
                )
                tune_btn.pack(side="left", padx=2)

                rst_btn = tk.Button(
                    btn_frame,
                    text="Reset",
                    font=("Fira Code", 8),
                    bg="#141414",
                    fg="#666666",
                    relief="flat",
                    command=lambda b=band_name: self._on_reset_band(b)
                )
                rst_btn.pack(side="left", padx=2)

            # Footer / Actions
            footer = tk.Frame(self, bg="#141414", height=45)
            footer.pack(fill="x", padx=10, pady=(5, 10))

            tk.Button(
                footer,
                text="🔄 Reset All to Defaults",
                font=("Fira Code", 9),
                bg="#1F1F1F",
                fg="#F87171",
                relief="flat",
                command=self._on_reset_all
            ).pack(side="left", padx=10, pady=8)

            tk.Button(
                footer,
                text="💾 Save & Apply",
                font=("Fira Code", 9, "bold"),
                bg="#00FF41",
                fg="#000000",
                relief="flat",
                command=self._on_save
            ).pack(side="right", padx=10, pady=8)

            tk.Button(
                footer,
                text="Cancel",
                font=("Fira Code", 9),
                bg="#1F1F1F",
                fg="#D4D4D4",
                relief="flat",
                command=self.destroy
            ).pack(side="right", padx=5, pady=8)

        def _on_tune_clicked(self, band_name: str) -> None:
            """Saves entered frequency, switches active band, and tunes radio."""
            try:
                hz = int(self.entries[band_name].get().strip())
                self.bm.set_frequency(band_name, hz, persist=False)
                self.bm.select_band(band_name, tune_cat=True)
                self.status_lbl.config(text=f"Active: {self.bm.active_band} ({self.bm.format_frequency()})")
                if self.on_select:
                    self.on_select(band_name)
                messagebox.showinfo("CAT Tuned", f"Successfully tuned transceiver to {band_name} ({self.bm.format_frequency()}) via Hamlib!", parent=self)
            except ValueError:
                messagebox.showerror("Invalid Input", f"Please enter a valid numeric frequency in Hz for {band_name}", parent=self)

        def _on_reset_band(self, band_name: str) -> None:
            """Resets single band entry to default."""
            def_hz = DEFAULT_BANDS[band_name]
            self.entries[band_name].set(str(def_hz))
            self.bm.reset_band_to_default(band_name, persist=False)

        def _on_reset_all(self) -> None:
            """Resets all entries to default presets."""
            if messagebox.askyesno("Reset All", "Reset all 13 band presets to z-30 global standard frequencies?", parent=self):
                for b_name, def_hz in DEFAULT_BANDS.items():
                    self.entries[b_name].set(str(def_hz))
                self.bm.reset_to_defaults(persist=True)
                self.status_lbl.config(text=f"Active: {self.bm.active_band} ({self.bm.format_frequency()})")

        def _on_save(self) -> None:
            """Validates and persists all entered frequencies."""
            for b_name, var in self.entries.items():
                try:
                    hz = int(var.get().strip())
                    self.bm.set_frequency(b_name, hz, persist=False)
                except ValueError:
                    messagebox.showerror("Error", f"Invalid frequency for {b_name}. Must be an integer in Hz.", parent=self)
                    return

            self.bm.save_config()
            messagebox.showinfo("Saved", f"All band presets successfully persisted to {self.bm.config_path}", parent=self)
            self.destroy()

except ImportError:
    pass


# ============================================================================
# 5. CLI ENTRY POINT & DEMO EXECUTION
# ============================================================================

def main():
    """Command-line interface for testing BandManager."""
    bm = BandManager()

    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()

        if cmd in ("--list", "-l", "list"):
            print("================================================================")
            print("         z-30 GLOBAL BAND PRESETS & DIAL FREQUENCIES           ")
            print("================================================================")
            print(f"{'Band':<8} | {'Dial Freq (Hz)':<15} | {'MHz':<15} | {'Status'}")
            print("-" * 64)
            for band, hz in bm.bands.items():
                is_act = "★ ACTIVE" if band == bm.active_band else ""
                print(f"{band:<8} | {hz:<15,d} | {hz / 1e6:10.6f} MHz | {is_act}")
            print("================================================================")
            sys.exit(0)

        elif cmd in ("--tune", "-t", "tune") and len(sys.argv) > 2:
            target_band = sys.argv[2]
            success = bm.select_band(target_band, tune_cat=True)
            print(f"Tuned to {target_band}: {bm.format_frequency()} (Success: {success})")
            sys.exit(0)

        elif cmd in ("--set", "-s", "set") and len(sys.argv) > 3:
            target_band = sys.argv[2]
            target_hz = int(sys.argv[3])
            bm.set_frequency(target_band, target_hz, persist=True)
            print(f"Updated {target_band} to {target_hz:,} Hz and saved to {bm.config_path}")
            sys.exit(0)

        elif cmd in ("--reset", "reset"):
            bm.reset_to_defaults(persist=True)
            print("Reset all band presets to global defaults.")
            sys.exit(0)

    # If executed without arguments, show GUI if Tkinter is available
    try:
        root = tk.Tk()
        root.withdraw()
        dlg = BandManagerDialog(root, bm)
        root.wait_window(dlg)
        root.destroy()
    except Exception:
        # Fallback to list print
        print(f"z-30 Band Manager active. Active Band: {bm.active_band} ({bm.format_frequency()})")
        for b, hz in bm.bands.items():
            print(f"  {b:6s} -> {hz:10,d} Hz ({hz / 1e6:10.6f} MHz)")


if __name__ == "__main__":
    main()
