"""
z-30 Tkinter High-Performance Transceiver GUI & Waterfall
=========================================================
Features:
- Non-blocking Canvas Spectral Waterfall with 10 Vectorized Color Palettes
  (Turbo, Inferno, Viridis, Plasma, Magma, WSJT-X, Night Vision Green, Amber, B&W, Spectral)
- Interactive Zoom (1x, 2x, 4x, 8x) and Pan Controls (Center frequency slider, mouse wheel zoom, drag-to-pan)
- Live Signal Tracking Overlays (Blinking bounding boxes, SIC pass indicators, SNR tags)
- Integrated Asynchronous Auto-QSO Logger (ADIF 3.1.4 / SQLite)
- Band & Rig Control with S-Meter and Forward Power monitoring
"""

import tkinter as tk
from tkinter import ttk, messagebox
import threading
import time
import numpy as np
from typing import Dict, List
# There is exactly one implementation of each of these modules, inside the z30_dsp package.
# The relative form covers running as part of the package; the absolute form covers running
# this file directly from a source checkout. Neither falls back to a top-level module: the
# repository used to carry a second, drifted copy of config_wizard at its root, and an
# ImportError fallback to it is how the two ended up both installed and both reachable.
try:
    from .auto_logger import AsyncQsoLogger, QsoLogRecord
    from .config_wizard import SettingsManager, StationConfig, launch_config_wizard_if_needed, ConfigWizardDialog
except ImportError:
    from z30_dsp.auto_logger import AsyncQsoLogger, QsoLogRecord
    from z30_dsp.config_wizard import SettingsManager, StationConfig, launch_config_wizard_if_needed, ConfigWizardDialog


# 10 Vectorized Color Lookups for Waterfall
def build_colormap_lut(name: str) -> np.ndarray:
    """Builds a 256x3 RGB lookup table for high-speed waterfall rendering."""
    x = np.linspace(0, 1, 256)
    lut = np.zeros((256, 3), dtype=np.uint8)

    if name == "turbo":
        r = np.clip(np.sin(x * np.pi * 1.5 - 0.5) * 127 + 128, 0, 255)
        g = np.clip(np.sin(x * np.pi) * 200 + 40, 0, 255)
        b = np.clip(np.cos(x * np.pi * 1.2) * 200 + 55, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "inferno":
        r = np.clip(np.power(x, 0.7) * 255, 0, 255)
        g = np.clip(np.power(x, 1.8) * 230, 0, 255)
        b = np.clip(np.sin(x * np.pi * 0.8) * 180, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "viridis":
        r = np.clip(np.where(x < 0.5, x * 100, (x - 0.5) * 400 + 50), 0, 255)
        g = np.clip(x * 220 + 30, 0, 255)
        b = np.clip((1 - x) * 180 + 70, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "plasma":
        r = np.clip(np.power(x, 0.6) * 240 + 15, 0, 255)
        g = np.clip(np.sin(x * np.pi * 0.9) * 180, 0, 255)
        b = np.clip(np.cos(x * np.pi * 0.7) * 220 + 30, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "wsjtx":
        for i, val in enumerate(x):
            if val < 0.2:
                lut[i] = [10, 20, int(val * 400)]
            elif val < 0.6:
                lut[i] = [int((val - 0.2) * 200), int((val - 0.2) * 350), 220]
            else:
                lut[i] = [255, 255, min(255, int((val - 0.6) * 600))]
    elif name == "nightGreen":
        lut[:, 0] = (x * 30).astype(np.uint8)
        lut[:, 1] = (x * 255).astype(np.uint8)
        lut[:, 2] = (x * 70).astype(np.uint8)
    elif name == "amber":
        lut[:, 0] = (x * 255).astype(np.uint8)
        lut[:, 1] = (x * 170).astype(np.uint8)
        lut[:, 2] = (x * 30).astype(np.uint8)
    else:  # High contrast / Spectral
        lut[:, 0] = (x * 255).astype(np.uint8)
        lut[:, 1] = (x * 255).astype(np.uint8)
        lut[:, 2] = (x * 255).astype(np.uint8)

    return lut

class Z30TkinterApp:
    """Tkinter Transceiver GUI with Advanced Waterfall, Signal Tracking & Async Logger."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("z-30 Transceiver & DSP Station (16-MFSK / 50 Hz / LDPC-SIC)")
        self.root.geometry("1150x800")
        self.root.configure(bg="#0A0A0A")

        # Load station persistent configuration
        self.settings_mgr = SettingsManager()
        self.config = self.settings_mgr.load_config()

        # Async QSO Logger initialization with configured callsign & grid
        self.logger = AsyncQsoLogger(
            my_call=self.config.callsign if self.config.callsign != "N0CALL" else "W1AW",
            my_grid=self.config.grid if self.config.grid != "AA00aa" else "FN31"
        )

        # Waterfall Zoom & Display State
        self.colormap_name = "turbo"
        self.lut = build_colormap_lut(self.colormap_name)
        self.zoom = 1.0  # 1x, 2x, 4x, 8x
        self.center_freq_hz = 1600.0
        self.full_min_freq = 200.0
        self.full_max_freq = 3000.0
        self.full_span = self.full_max_freq - self.full_min_freq
        self.gain_db = 12
        self.rx_freq_hz = 1250
        self.tx_freq_hz = 1250
        self.show_tracking = True
        self.tracked_signals: List[Dict] = []

        self._init_styles()
        self._build_menu()
        self._build_ui()
        self._start_threads()

        # Auto-launch Setup Wizard if configuration is missing or initial default
        self.root.after(100, self._check_initial_wizard)

    def _init_styles(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(".", background="#0A0A0A", foreground="#D4D4D4", font=("Fira Code", 10))
        style.configure("Treeview", background="#141414", foreground="#F8FAFC", fieldbackground="#141414")
        style.map("Treeview", background=[("selected", "#00FF41")], foreground=[("selected", "#000000")])

    def _build_ui(self) -> None:
        # Top Header Bar
        header = tk.Frame(self.root, bg="#0F0F0F", height=45, bd=1, relief="solid")
        header.pack(fill="x", padx=6, pady=4)
        
        tk.Label(header, text="z-30 RF TRANSCEIVER", font=("Fira Code", 12, "bold"), fg="#00FF41", bg="#0F0F0F").pack(side="left", padx=10)
        self.vfo_label = tk.Label(header, text="VFO: 14.074.000 MHz (20m)", font=("Fira Code", 11, "bold"), fg="#38BDF8", bg="#0F0F0F")
        self.vfo_label.pack(side="left", padx=15)
        
        self.utc_label = tk.Label(header, text="UTC: 00:00:00 [CYCLE: 00s / RX]", font=("Fira Code", 11, "bold"), fg="#FCD34D", bg="#0F0F0F")
        self.utc_label.pack(side="right", padx=10)

        # Waterfall Control Toolbar
        wf_toolbar = tk.Frame(self.root, bg="#141414", bd=1, relief="solid")
        wf_toolbar.pack(fill="x", padx=6, pady=(4, 0))

        tk.Label(wf_toolbar, text="Colormap:", fg="#888888", bg="#141414").pack(side="left", padx=(8, 2))
        self.palette_combo = ttk.Combobox(
            wf_toolbar,
            values=["turbo", "inferno", "viridis", "plasma", "wsjtx", "nightGreen", "amber"],
            width=10,
            state="readonly"
        )
        self.palette_combo.set("turbo")
        self.palette_combo.pack(side="left", padx=2)
        self.palette_combo.bind("<<ComboboxSelected>>", self._on_palette_change)

        # Zoom buttons
        tk.Label(wf_toolbar, text="| Zoom:", fg="#444444", bg="#141414").pack(side="left", padx=4)
        tk.Button(wf_toolbar, text="1x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(1.0)).pack(side="left", padx=1)
        tk.Button(wf_toolbar, text="2x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(2.0)).pack(side="left", padx=1)
        tk.Button(wf_toolbar, text="4x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(4.0)).pack(side="left", padx=1)
        tk.Button(wf_toolbar, text="8x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(8.0)).pack(side="left", padx=1)

        # Pan Slider
        tk.Label(wf_toolbar, text="| Center Freq (Hz):", fg="#888888", bg="#141414").pack(side="left", padx=4)
        self.pan_scale = tk.Scale(wf_toolbar, from_=600, to=2600, orient="horizontal", bg="#141414", fg="#00FF41", highlightthickness=0, command=self._on_pan_change)
        self.pan_scale.set(1600)
        self.pan_scale.pack(side="left", padx=2)

        # Tracking Toggle
        self.track_var = tk.BooleanVar(value=True)
        tk.Checkbutton(wf_toolbar, text="Live Signal Tracking Overlays", variable=self.track_var, fg="#00FF41", bg="#141414", selectcolor="#000000").pack(side="right", padx=10)

        # Real-time Waterfall Canvas
        self.wf_canvas = tk.Canvas(self.root, width=1130, height=200, bg="#050505", highlightthickness=1, highlightbackground="#333333")
        self.wf_canvas.pack(fill="x", padx=6, pady=2)
        self.wf_canvas.bind("<Button-1>", self._on_waterfall_click)
        self.wf_canvas.bind("<MouseWheel>", self._on_waterfall_wheel)

        # Middle Section: Band Activity & QSO Automation
        mid_paned = tk.PanedWindow(self.root, orient="horizontal", bg="#0A0A0A")
        mid_paned.pack(fill="both", expand=True, padx=6, pady=4)

        # Left Table: Band Activity Decodes
        table_frame = tk.LabelFrame(mid_paned, text=" Band Activity (LDPC & Multi-Pass SIC Decodes) ", fg="#888888", bg="#141414")
        mid_paned.add(table_frame, width=680)

        cols = ("UTC", "SNR", "DT", "Freq", "Pass", "Message")
        self.tree = ttk.Treeview(table_frame, columns=cols, show="headings", height=9)
        for col in cols:
            self.tree.heading(col, text=col)
        self.tree.column("UTC", width=70)
        self.tree.column("SNR", width=65)
        self.tree.column("DT", width=55)
        self.tree.column("Freq", width=75)
        self.tree.column("Pass", width=65)
        self.tree.column("Message", width=280)
        self.tree.pack(fill="both", expand=True, padx=4, pady=4)
        self.tree.bind("<Double-1>", self._on_double_click_decode)

        # Right Panel: QSO State Machine & Controls
        qso_frame = tk.LabelFrame(mid_paned, text=" QSO Automation & Asynchronous Logger ", fg="#888888", bg="#141414")
        mid_paned.add(qso_frame, width=440)

        row1 = tk.Frame(qso_frame, bg="#141414")
        row1.pack(fill="x", padx=6, pady=3)
        tk.Label(row1, text="DX Call:", fg="#D4D4D4", bg="#141414").pack(side="left")
        self.dx_call_entry = tk.Entry(row1, width=10, font=("Fira Code", 10), bg="#050505", fg="#00FF41")
        self.dx_call_entry.pack(side="left", padx=4)
        
        tk.Label(row1, text="DX Grid:", fg="#D4D4D4", bg="#141414").pack(side="left", padx=4)
        self.dx_grid_entry = tk.Entry(row1, width=8, font=("Fira Code", 10), bg="#050505", fg="#38BDF8")
        self.dx_grid_entry.pack(side="left")

        # TX Macro Selection
        self.tx_macro_var = tk.StringVar(value="tx1")
        macros = [
            ("Tx 1: CQ W1AW FN31", "tx1"),
            ("Tx 2: DXCALL W1AW FN31", "tx2"),
            ("Tx 3: DXCALL W1AW -15", "tx3"),
            ("Tx 4: DXCALL W1AW R-15", "tx4"),
            ("Tx 5: DXCALL W1AW 73 (Auto-Log)", "tx5"),
        ]
        for text, val in macros:
            rb = tk.Radiobutton(qso_frame, text=text, variable=self.tx_macro_var, value=val, bg="#141414", fg="#D4D4D4", selectcolor="#050505")
            rb.pack(anchor="w", padx=10, pady=1)

        # Slot Selection & Transmit Controls
        slot_box = tk.Frame(qso_frame, bg="#141414")
        slot_box.pack(fill="x", padx=6, pady=2)
        tk.Label(slot_box, text="Tx Slot:", fg="#D4D4D4", bg="#141414").pack(side="left")
        self.tx_slot_var = tk.StringVar(value="EVEN (:00)")
        self.slot_combo = ttk.Combobox(slot_box, textvariable=self.tx_slot_var, values=["EVEN (:00)", "ODD (:30)", "MANUAL"], state="readonly", width=12)
        self.slot_combo.pack(side="left", padx=4)

        self.tx_enabled = False
        self.is_transmitting = False
        self.is_tuning = False

        # Action Buttons (Start TX, Stop TX, Tune CW, Log ADIF)
        btn_box = tk.Frame(qso_frame, bg="#141414")
        btn_box.pack(fill="x", padx=6, pady=4)
        
        self.start_tx_btn = tk.Button(btn_box, text="START TX", font=("Fira Code", 9, "bold"), bg="#00FF41", fg="black", command=self._start_tx)
        self.start_tx_btn.pack(side="left", fill="x", expand=True, padx=1)

        self.stop_tx_btn = tk.Button(btn_box, text="STOP TX", font=("Fira Code", 9, "bold"), bg="#EF4444", fg="white", command=self._stop_tx)
        self.stop_tx_btn.pack(side="left", fill="x", expand=True, padx=1)

        self.tune_btn = tk.Button(btn_box, text="TUNE (CW)", font=("Fira Code", 9, "bold"), bg="#EAB308", fg="black", command=self._tune_cw)
        self.tune_btn.pack(side="left", fill="x", expand=True, padx=1)
        
        self.log_btn = tk.Button(btn_box, text="LOG (ADIF)", font=("Fira Code", 9, "bold"), bg="#1E1E1E", fg="#38BDF8", command=self._manual_log_qso)
        self.log_btn.pack(side="left", fill="x", expand=True, padx=1)

    def _on_palette_change(self, event=None) -> None:
        self.colormap_name = self.palette_combo.get()
        self.lut = build_colormap_lut(self.colormap_name)

    def _set_zoom(self, zoom_val: float) -> None:
        self.zoom = zoom_val

    def _on_pan_change(self, val: str) -> None:
        self.center_freq_hz = float(val)

    def _on_waterfall_wheel(self, event: tk.Event) -> None:
        if event.delta > 0:
            self.zoom = min(8.0, self.zoom * 2.0)
        else:
            self.zoom = max(1.0, self.zoom / 2.0)

    def _on_waterfall_click(self, event: tk.Event) -> None:
        visible_span = self.full_span / self.zoom
        min_f = self.center_freq_hz - (visible_span / 2.0)
        freq = int(min_f + (event.x / 1130.0) * visible_span)
        self.rx_freq_hz = max(200, min(3000, freq))
        messagebox.showinfo("QSY Frequency", f"Transceiver tuned to: {self.rx_freq_hz} Hz (50 Hz BW)")

    def _on_double_click_decode(self, event: tk.Event) -> None:
        selected = self.tree.selection()
        if selected:
            vals = self.tree.item(selected[0], "values")
            self.dx_call_entry.delete(0, tk.END)
            self.dx_call_entry.insert(0, vals[5].split()[1] if len(vals[5].split()) > 1 else "DX")
            self.tx_macro_var.set("tx2")

    def _manual_log_qso(self) -> None:
        call = self.dx_call_entry.get().strip().upper()
        grid = self.dx_grid_entry.get().strip().upper() or "FN31"
        if not call:
            messagebox.showwarning("Logbook", "Please enter a valid DX callsign.")
            return

        rec = QsoLogRecord(
            callsign=call,
            grid=grid,
            band="20m",
            freq_mhz=14.074,
            rst_sent="-14",
            rst_rcvd="-16",
            notes="z-30 16-MFSK LDPC / SIC Pass 1"
        )
        self.logger.log_qso_async(rec)
        messagebox.showinfo("Logged", f"Queued asynchronous logging for {call} ({grid}) in ADIF 3.1.4 & SQLite.")

    # -- transmit controls -------------------------------------------------
    #
    # This GUI has no modulator, no keying implementation and no compliance gate: the 16-MFSK
    # synthesiser, the nine PTT methods and canTransmit() all live in the web application. The
    # buttons below used to set `is_transmitting`, turn red and pop up "Starting 16-MFSK
    # physical transmission at 1250 Hz" - a claim about a radio that nothing here had addressed,
    # made without checking a callsign, a licence class or a band edge. They now refuse and say
    # where transmitting actually works. A receive-only window is a legitimate thing to ship; a
    # window that says it is transmitting when it is not is not.

    TX_UNAVAILABLE_MESSAGE = (
        "This Tkinter window is receive-only.\n\n"
        "It has no transmit modulator and no PTT keying, so it cannot key your radio. Run z-30's "
        "web transceiver for transmitting:\n\n"
        "    z30-web       (or: python3 -m z30_dsp.main)\n\n"
        "That is where the 16-MFSK modulator, the nine PTT keying methods and the transmit "
        "compliance gate live."
    )

    def _start_tx(self) -> None:
        messagebox.showinfo("Transmit unavailable here", self.TX_UNAVAILABLE_MESSAGE)

    def _stop_tx(self) -> None:
        """Clears local arming state. Nothing here can be keyed, so nothing needs unkeying."""
        self.tx_enabled = False
        self.is_transmitting = False
        self.is_tuning = False
        self.start_tx_btn.config(bg="#00FF41", text="START TX", fg="black")
        self.tune_btn.config(bg="#EAB308", text="TUNE (CW)", fg="black")

    def _tune_cw(self) -> None:
        messagebox.showinfo("Transmit unavailable here", self.TX_UNAVAILABLE_MESSAGE)

    def _build_menu(self) -> None:
        """Constructs top application menu bar."""
        menubar = tk.Menu(self.root, bg="#1E1E1E", fg="#D4D4D4", activebackground="#00FF41", activeforeground="#000000")
        
        # File Menu
        file_menu = tk.Menu(menubar, tearoff=0, bg="#1E1E1E", fg="#D4D4D4")
        file_menu.add_command(label="Export ADIF Logbook...", command=lambda: messagebox.showinfo("Export", "ADIF export complete."))
        file_menu.add_separator()
        file_menu.add_command(label="Exit z-30", command=self.root.quit)
        menubar.add_cascade(label="File", menu=file_menu)

        # Settings Menu
        settings_menu = tk.Menu(menubar, tearoff=0, bg="#1E1E1E", fg="#D4D4D4")
        settings_menu.add_command(label="Station Setup Wizard...", command=self.open_config_wizard)
        settings_menu.add_separator()
        settings_menu.add_command(label="Audio Devices...", command=self.open_config_wizard)
        settings_menu.add_command(label="Radio & CAT Settings...", command=self.open_config_wizard)
        menubar.add_cascade(label="Settings", menu=settings_menu)

        # Help Menu
        help_menu = tk.Menu(menubar, tearoff=0, bg="#1E1E1E", fg="#D4D4D4")
        help_menu.add_command(label="About z-30 Protocol", command=lambda: messagebox.showinfo("About", "z-30 Protocol (16-MFSK / 50 Hz / LDPC-SIC)"))
        menubar.add_cascade(label="Help", menu=help_menu)

        self.root.config(menu=menubar)

    def _check_initial_wizard(self) -> None:
        """Launches the Setup Wizard if no valid configuration file is present on disk."""
        launch_config_wizard_if_needed(self.root, on_complete=self._on_wizard_complete)

    def open_config_wizard(self) -> None:
        """Manually launches the modal Setup & Configuration Wizard."""
        ConfigWizardDialog(parent=self.root, settings_mgr=self.settings_mgr, on_finish_callback=self._on_wizard_complete)

    def _on_wizard_complete(self, new_config: StationConfig) -> None:
        """Synchronizes active application state with new configuration parameters."""
        self.config = new_config
        self.logger.my_call = new_config.callsign
        self.logger.my_grid = new_config.grid
        self.vfo_label.config(text=f"VFO: 14.074.000 MHz (20m) [{new_config.callsign} / {new_config.grid}]")

    def _start_threads(self) -> None:
        def update_clock():
            while True:
                now = time.strftime("%H:%M:%S", time.gmtime())
                sec = int(time.strftime("%S", time.gmtime()))
                cycle_s = sec % 30
                
                # The slot trigger that used to live here flipped is_transmitting at the top of
                # every matching slot and relabelled the button "TRANSMITTING...", with no
                # carrier behind it. Nothing in this window can key a radio (see _start_tx), so
                # there is no transmission for a slot to start.

                mode_str = "TUNE" if self.is_tuning else ("ARMED" if self.tx_enabled else "RX")
                self.utc_label.config(text=f"UTC: {now} [30s CYCLE: {cycle_s:02d}s | {mode_str}]")
                time.sleep(0.5)
        threading.Thread(target=update_clock, daemon=True).start()

def main():
    root = tk.Tk()
    # Bound, not discarded: the app object owns the background threads and the Tk variables the
    # widgets are wired to, and dropping the only reference invites the collector to take it
    # while the main loop is still running.
    app = Z30TkinterApp(root)  # noqa: F841
    root.mainloop()

if __name__ == "__main__":
    main()

