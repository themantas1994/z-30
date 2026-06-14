"""Main Z-30 application window."""

from __future__ import annotations

import datetime
import queue
import threading
import time
from dataclasses import dataclass

import numpy as np
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

try:
    import psutil
except ImportError:
    psutil = None

from z30_app.audio.manager import AudioManager
from z30_app.config.manager import ConfigManager
from z30_app.constants import CYCLE_SECONDS, SAMPLE_RATE
from z30_app.dxcc.lookup import bearing_deg, distance_km, lookup_call
from z30_app.dsp.modem import Z30AdvancedModem
from z30_app.gui.settings import SettingsDialog
from z30_app.gui.waterfall import WaterfallWidget
from z30_app.logbook.adif import AdifLogger, LogEntry
from z30_app.logbook.worked import WorkedTracker
from z30_app.qso.parser import extract_call_grid, message_category
from z30_app.qso.sequencer import AutoSequencer, QSOState
from z30_app.rig.controller import RigController
from z30_app.stability.logging_setup import get_logger

logger = get_logger(__name__)


@dataclass
class ActivityRow:
    time: str
    snr: float
    dt: float
    freq: float
    call: str
    grid: str
    distance: str
    dxcc: str
    country: str
    message: str
    tag: str


class Z30MainWindow:
    def __init__(self, root: tk.Tk, config_mgr: ConfigManager):
        self.root = root
        self.config_mgr = config_mgr
        self.config = config_mgr.config

        general = self.config.get("general", {})
        self.my_call = str(general.get("callsign", self.config.get("callsign", "N0CALL"))).upper()
        self.my_grid = str(general.get("locator", self.config.get("locator", "FN20"))).upper()

        self.root.title(f"Z-30 Transceiver v3.0 - {self.my_call}")
        self.root.geometry("1200x860")

        self.modem = Z30AdvancedModem(decoder_config=self.config.get("decoder", {}))
        self.audio = AudioManager(self.config)
        self.rig = RigController(self.config)
        paths = self.config.get("paths", {})
        self.logbook = AdifLogger(paths.get("logbook", "z30_log.adi"))
        self.worked = WorkedTracker(paths.get("worked_db", "z30_worked.json"))
        self.sequencer = AutoSequencer(self.config.get("auto_sequence", {}).get("enabled", True))
        self.sequencer.set_operator(self.my_call, self.my_grid)

        freqs = self.config.get("frequencies", {})
        self.tx_freq = tk.IntVar(value=int(freqs.get("tx_freq", 1500)))
        self.rx_freq = tk.IntVar(value=int(freqs.get("rx_freq", 1500)))
        self.tx_msg_var = tk.IntVar(value=1)
        self.tx_enabled = tk.BooleanVar(value=False)
        self.auto_seq = tk.BooleanVar(value=self.sequencer.enabled)
        self.filter_var = tk.StringVar(value="")

        self.running = True
        self.is_transmitting = False
        self.tx_triggered_this_cycle = False
        self.decode_queue: queue.Queue = queue.Queue()
        self.tx_trigger_queue: queue.Queue = queue.Queue()
        self.rx_buffer = np.array([], dtype=np.int16)
        self.activity_rows: list[ActivityRow] = []
        self.msgs: dict[int, ttk.Entry] = {}

        self._apply_theme()
        self._build_menus()
        self._build_layout()
        self._start_subsystems()
        self._start_threads()
        self.update_loop()

    def _apply_theme(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        bg, fg, accent = "#1e1e1e", "#d4d4d4", "#007acc"
        self.root.configure(bg=bg)
        style.configure(".", background=bg, foreground=fg, font=("Consolas", 10))
        style.configure("TFrame", background=bg)
        style.configure("TLabel", background=bg, foreground=fg)
        style.configure("Treeview", background="#252526", fieldbackground="#252526", foreground=fg, rowheight=22)
        style.configure("Treeview.Heading", background="#333333", foreground=fg, font=("Consolas", 10, "bold"))
        style.map("Treeview", background=[("selected", accent)])

    def _build_menus(self) -> None:
        menubar = tk.Menu(self.root)
        config_menu = tk.Menu(menubar, tearoff=0)
        config_menu.add_command(label="Settings...", command=self.open_settings)
        config_menu.add_command(label="Startup Diagnostics...", command=self.show_diagnostics)
        menubar.add_cascade(label="Configuration", menu=config_menu)

        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Load Audio/IQ...", command=self.load_capture)
        file_menu.add_command(label="Save Recording...", command=self.save_recording)
        menubar.add_cascade(label="File", menu=file_menu)

        log_menu = tk.Menu(menubar, tearoff=0)
        log_menu.add_command(label="Export ADIF...", command=self.export_adif)
        log_menu.add_command(label="Import ADIF...", command=self.import_adif)
        menubar.add_cascade(label="Logbook", menu=log_menu)
        self.root.config(menu=menubar)

    def _build_layout(self) -> None:
        top = tk.Frame(self.root, bg="black")
        top.pack(fill=tk.X, padx=5, pady=(5, 0))

        self.lbl_timer = tk.Label(top, text="T-00s", font=("Consolas", 14, "bold"), bg="black", fg="#00ff00")
        self.lbl_timer.pack(anchor=tk.W)

        self.waterfall = WaterfallWidget(top, on_tune=self._on_waterfall_tune)
        wf_cfg = self.config.get("waterfall", {})
        self.waterfall.set_palette(wf_cfg.get("palette", "WSJT-X Style"))
        self.waterfall.gain = float(wf_cfg.get("gain", 1.0))
        self.waterfall.contrast = float(wf_cfg.get("contrast", 1.0))
        self.waterfall.speed = int(wf_cfg.get("speed", 2))

        meter_frame = ttk.Frame(top)
        meter_frame.pack(fill=tk.X, pady=2)
        self.lbl_input_meter = ttk.Label(meter_frame, text="IN: ----")
        self.lbl_input_meter.pack(side=tk.LEFT, padx=6)
        self.lbl_output_meter = ttk.Label(meter_frame, text="OUT: ----")
        self.lbl_output_meter.pack(side=tk.LEFT, padx=6)
        self.lbl_agc = ttk.Label(meter_frame, text="AGC: 1.00")
        self.lbl_agc.pack(side=tk.LEFT, padx=6)
        self.lbl_rig = ttk.Label(meter_frame, text="Rig: --")
        self.lbl_rig.pack(side=tk.LEFT, padx=6)
        self.lbl_dsp = ttk.Label(meter_frame, text="DSP: --")
        self.lbl_dsp.pack(side=tk.LEFT, padx=6)

        activity = ttk.Frame(self.root)
        activity.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        filter_row = ttk.Frame(activity)
        filter_row.pack(fill=tk.X)
        ttk.Label(filter_row, text="Filter:").pack(side=tk.LEFT)
        ttk.Entry(filter_row, textvariable=self.filter_var, width=30).pack(side=tk.LEFT, padx=4)
        ttk.Button(filter_row, text="Apply", command=self._refresh_tree).pack(side=tk.LEFT)

        cols = ("Time", "SNR", "DT", "Freq", "Call", "Grid", "Dist", "DXCC", "Country", "Message")
        self.tree = ttk.Treeview(activity, columns=cols, show="headings", selectmode="browse")
        widths = {"Time": 55, "SNR": 40, "DT": 45, "Freq": 55, "Call": 80, "Grid": 55, "Dist": 55, "DXCC": 45, "Country": 90, "Message": 260}
        for c in cols:
            self.tree.heading(c, text=c, command=lambda col=c: self._sort_by(col))
            self.tree.column(c, width=widths.get(c, 60), anchor=tk.W if c == "Message" else tk.CENTER)
        scroll = ttk.Scrollbar(activity, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)

        colors = self.config.get("colors", {})
        self.tree.tag_configure("cq", foreground=colors.get("cq", "#4caf50"))
        self.tree.tag_configure("directed", foreground=colors.get("directed", "#ffeb3b"))
        self.tree.tag_configure("worked", foreground=colors.get("worked", "#9e9e9e"))
        self.tree.tag_configure("new_dxcc", foreground=colors.get("new_dxcc", "#e040fb"))
        self.tree.tag_configure("rr73", foreground=colors.get("rr73", "#2196f3"))
        self.tree.tag_configure("73", foreground=colors.get("73", "#00bcd4"))
        self.tree.tag_configure("new_grid", foreground=colors.get("new_grid", "#ff9800"))

        self.tree.bind("<Double-1>", self.on_decode_click)
        self.tree.bind("<Button-3>", self._context_menu)

        control = ttk.Frame(self.root)
        control.pack(fill=tk.X, padx=5, pady=8)

        info = ttk.Frame(control)
        info.pack(side=tk.LEFT, padx=8)
        ttk.Label(info, text="DX Call:").grid(row=0, column=0, sticky=tk.W)
        self.ent_dx_call = ttk.Entry(info, width=12)
        self.ent_dx_call.grid(row=0, column=1, padx=4)
        ttk.Label(info, text="DX Grid:").grid(row=1, column=0, sticky=tk.W)
        self.ent_dx_grid = ttk.Entry(info, width=12)
        self.ent_dx_grid.grid(row=1, column=1, padx=4)
        ttk.Label(info, text="Rx Freq:").grid(row=2, column=0, sticky=tk.W, pady=(6, 0))
        ttk.Spinbox(info, from_=0, to=3000, increment=10, textvariable=self.rx_freq, width=8).grid(row=2, column=1)
        ttk.Label(info, text="Tx Freq:").grid(row=3, column=0, sticky=tk.W)
        ttk.Spinbox(info, from_=0, to=3000, increment=10, textvariable=self.tx_freq, width=8).grid(row=3, column=1)

        seq = ttk.Frame(control)
        seq.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=12)
        labels = ["TX1 CQ", "TX2 Reply", "TX3 Report", "TX4 R+Rep", "TX5 RR73", "TX6 73"]
        for i, text in enumerate(labels):
            ttk.Radiobutton(seq, text=text, variable=self.tx_msg_var, value=i + 1).grid(row=i // 2, column=(i % 2) * 2, sticky=tk.W, padx=4)
            e = ttk.Entry(seq, width=28)
            e.grid(row=i // 2, column=(i % 2) * 2 + 1, padx=4, pady=2)
            self.msgs[i + 1] = e
        self.lbl_seq_state = ttk.Label(seq, text="State: CQ")
        self.lbl_seq_state.grid(row=3, column=0, columnspan=4, sticky=tk.W, pady=4)
        self.update_tx_messages()

        btn = ttk.Frame(control)
        btn.pack(side=tk.RIGHT, padx=8)
        ttk.Checkbutton(btn, text="Auto Seq", variable=self.auto_seq, command=self._toggle_auto_seq).pack(anchor=tk.W)
        self.btn_enable = tk.Button(btn, text="Enable TX", width=12, bg="#333", fg="white", command=self.toggle_tx)
        self.btn_enable.pack(pady=2)
        ttk.Button(btn, text="Halt TX", command=self.halt_tx).pack(pady=2)

        self.debug_console = tk.Text(self.root, height=4, bg="#111", fg="#8f8", font=("Consolas", 9))
        self.debug_console.pack(fill=tk.X, padx=5, pady=(0, 5))

    def _start_subsystems(self) -> None:
        started = self.audio.start(on_error=lambda m: self._log_debug(m))
        if not started:
            self._log_debug(f"Audio: {self.audio.status_message}")
        self.rig.probe()

    def _start_threads(self) -> None:
        threading.Thread(target=self.tx_worker, daemon=True, name="z30-tx").start()

    def shutdown(self) -> None:
        self.running = False
        self.audio.stop()
        logger.info("Main window shutdown complete")

    def _log_debug(self, msg: str) -> None:
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        self.debug_console.insert(tk.END, f"[{ts}] {msg}\n")
        self.debug_console.see(tk.END)

    def _on_waterfall_tune(self, freq: int) -> None:
        self.rx_freq.set(freq)
        self.tx_freq.set(freq)
        self.waterfall.set_frequencies(freq, freq)

    def open_settings(self) -> None:
        SettingsDialog(self.root, self.config_mgr, on_saved=self._on_settings_saved)

    def _on_settings_saved(self, cfg: dict) -> None:
        self.config = cfg
        self.my_call = cfg["general"]["callsign"].upper()
        self.my_grid = cfg["general"]["locator"].upper()
        self.sequencer.set_operator(self.my_call, self.my_grid)
        self.modem = Z30AdvancedModem(decoder_config=cfg.get("decoder", {}))
        self.audio.stop()
        self.audio = AudioManager(cfg)
        self.audio.start()
        self.rig = RigController(cfg)
        self.update_tx_messages()
        self._log_debug("Settings applied")

    def show_diagnostics(self) -> None:
        from z30_app.gui.diagnostics import DiagnosticsWindow, StartupDiagnostics

        diag = StartupDiagnostics()
        diag.run_all(self.root, self.config_mgr)
        DiagnosticsWindow(self.root, diag, on_continue=lambda: None, on_abort=self.root.destroy)

    def update_tx_messages(self, _event=None) -> None:
        dx_call = self.ent_dx_call.get().strip().upper()
        dx_grid = self.ent_dx_grid.get().strip().upper()
        self.sequencer.set_dx(dx_call, dx_grid)
        composed = self.sequencer.compose_messages()
        for i in range(1, 7):
            self.msgs[i].delete(0, tk.END)
            self.msgs[i].insert(0, composed.get(i, ""))
        self.lbl_seq_state.config(text=f"State: {self.sequencer.state.value} | Next: {self.sequencer.next_tx_message()[:40]}")

    def toggle_tx(self) -> None:
        self.tx_enabled.set(not self.tx_enabled.get())
        self.btn_enable.config(bg="#007acc" if self.tx_enabled.get() else "#333")

    def halt_tx(self) -> None:
        self.tx_enabled.set(False)
        self.btn_enable.config(bg="#333")

    def _toggle_auto_seq(self) -> None:
        self.sequencer.enabled = self.auto_seq.get()

    def advance_auto_seq(self) -> None:
        if not self.auto_seq.get():
            return
        self.sequencer.advance()
        self.tx_msg_var.set(self.sequencer.tx_slot())
        self.update_tx_messages()
        if self.sequencer.state == QSOState.SEVENTY_THREE:
            self.toggle_tx()

    def on_decode_click(self, _event) -> None:
        sel = self.tree.selection()
        if not sel:
            return
        vals = self.tree.item(sel[0])["values"]
        if len(vals) < 10:
            return
        freq, call, grid, msg = vals[3], vals[4], vals[5], vals[9]
        try:
            self.rx_freq.set(int(float(freq)))
            self.tx_freq.set(int(float(freq)))
        except ValueError:
            pass
        if call:
            self.ent_dx_call.delete(0, tk.END)
            self.ent_dx_call.insert(0, call)
        if grid:
            self.ent_dx_grid.delete(0, tk.END)
            self.ent_dx_grid.insert(0, grid)
        self.sequencer.on_decode(str(msg))
        self.tx_msg_var.set(self.sequencer.tx_slot())
        self.update_tx_messages()

    def _context_menu(self, event) -> None:
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label="Copy Message", command=self._copy_selected)
        menu.add_command(label="Set RX from selection", command=lambda: self.on_decode_click(event))
        menu.tk_popup(event.x_root, event.y_root)

    def _copy_selected(self) -> None:
        sel = self.tree.selection()
        if not sel:
            return
        vals = self.tree.item(sel[0])["values"]
        if len(vals) >= 10:
            self.root.clipboard_clear()
            self.root.clipboard_append(str(vals[9]))

    def _sort_by(self, col: str) -> None:
        idx = list(self.tree["columns"]).index(col)
        self.activity_rows.sort(key=lambda r: list(r.__dict__.values())[idx] if idx < 10 else r.message)
        self._refresh_tree()

    def _classify_row(self, call: str, grid: str, msg: str) -> str:
        cat = message_category(msg, self.my_call)
        if cat in ("cq", "directed", "rr73", "73"):
            base = cat
        else:
            base = "default"
        if call and self.worked.is_worked(call):
            return "worked"
        info = lookup_call(call) if call else None
        if info and info.dxcc and not self.worked.is_dxcc_worked(info.dxcc):
            return "new_dxcc"
        if grid and not self.worked.is_grid_worked(grid):
            return "new_grid"
        return base if base != "default" else ""

    def _refresh_tree(self) -> None:
        filt = self.filter_var.get().upper()
        for item in self.tree.get_children():
            self.tree.delete(item)
        for row in self.activity_rows:
            if filt and filt not in row.message.upper() and filt not in row.call.upper():
                continue
            self.tree.insert(
                "",
                tk.END,
                values=(row.time, row.snr, row.dt, row.freq, row.call, row.grid, row.distance, row.dxcc, row.country, row.message),
                tags=(row.tag,) if row.tag else (),
            )

    def update_loop(self) -> None:
        if not self.running:
            return
        now = datetime.datetime.now(datetime.timezone.utc)
        wait_time = CYCLE_SECONDS - ((now.second + now.microsecond / 1_000_000.0) % CYCLE_SECONDS)
        self.lbl_timer.config(text=f"T-{int(wait_time):02d}s")

        for chunk in self.audio.drain_queue():
            self.rx_buffer = np.append(self.rx_buffer, chunk)
            if chunk.size >= 1024:
                fft_mags = np.abs(np.fft.rfft(chunk[:1024].astype(np.float64) * np.hanning(1024)))
                self.waterfall.push_spectrum(fft_mags)

        self.lbl_input_meter.config(text=f"IN: {self.audio.input_level * 100:4.0f}%")
        self.lbl_output_meter.config(text=f"OUT: {self.audio.output_level * 100:4.0f}%")
        self.lbl_agc.config(text=f"AGC: {self.audio.agc_level:4.2f}")
        self.lbl_rig.config(text=f"Rig: {self.rig.status_text()[:40]}")

        m = self.modem.metrics
        if psutil is not None:
            proc = psutil.Process()
            m.cpu_percent = proc.cpu_percent()
            m.memory_mb = proc.memory_info().rss / (1024 * 1024)
        self.lbl_dsp.config(
            text=f"DSP NF:{m.noise_floor_db:5.1f} Sync:{m.sync_score:4.1f} Dec:{m.decode_count} CRC:{m.crc_failures} SIC:{m.sic_layers}"
        )

        self.waterfall.set_frequencies(self.rx_freq.get(), self.tx_freq.get())

        if wait_time <= 0.5 and len(self.rx_buffer) > SAMPLE_RATE * 5 and not self.is_transmitting:
            threading.Thread(target=self._run_decoder, args=(self.rx_buffer.copy(),), daemon=True, name="z30-decode").start()
            self.rx_buffer = np.array([], dtype=np.int16)

        while not self.decode_queue.empty():
            ts, decodes = self.decode_queue.get()
            markers = []
            for result in decodes:
                call, grid = extract_call_grid(result.message)
                info = lookup_call(call) if call else lookup_call("")
                dist = distance_km(self.my_grid, grid) if grid else None
                dist_s = f"{int(dist)}" if dist else ""
                tag = self._classify_row(call, grid, result.message)
                row = ActivityRow(
                    time=ts,
                    snr=result.snr_db,
                    dt=round(result.dt_seconds, 2),
                    freq=round(result.frequency_hz, 1),
                    call=call,
                    grid=grid,
                    distance=dist_s,
                    dxcc=str(info.dxcc) if info else "",
                    country=info.country if info else "",
                    message=result.message,
                    tag=tag,
                )
                self.activity_rows.append(row)
                markers.append((result.frequency_hz, call))
                if call and ("RR73" in result.message.upper() or result.message.strip().endswith("73")):
                    band = self.config.get("band", "UNKNOWN")
                    self.worked.record(call, grid, band, "Z30", info.dxcc if info else 0)
                    d, t = AdifLogger.now_fields()
                    self.logbook.add_qso(
                        LogEntry(d, t, call, grid, band, "Z30", result.snr_db, dist, result.message)
                    )
            self.waterfall.set_decode_markers(markers)
            self._refresh_tree()

            if decodes and self.auto_seq.get() and self.sequencer.state == QSOState.CQ:
                self.sequencer.on_decode(decodes[0].message)
                self.tx_msg_var.set(self.sequencer.tx_slot())
                self.ent_dx_call.delete(0, tk.END)
                self.ent_dx_call.insert(0, self.sequencer.context.dx_call)
                self.ent_dx_grid.delete(0, tk.END)
                self.ent_dx_grid.insert(0, self.sequencer.context.dx_grid)
                self.update_tx_messages()
                if not self.tx_enabled.get():
                    self.toggle_tx()

        if wait_time <= 0.2 and not self.tx_triggered_this_cycle:
            self.tx_triggered_this_cycle = True
            if self.tx_enabled.get():
                msg_text = self.msgs[self.tx_msg_var.get()].get()
                if msg_text:
                    self.tx_trigger_queue.put((msg_text, self.tx_freq.get()))

        if wait_time > 1.0:
            self.tx_triggered_this_cycle = False

        self.root.after(100, self.update_loop)

    def _run_decoder(self, audio_data: np.ndarray) -> None:
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%H%M%S")
        try:
            decodes = self.modem.sic_decode_loop(audio_data)
            self.decode_queue.put((ts, decodes))
        except Exception as exc:
            logger.exception("Decoder error")
            self.decode_queue.put((ts, []))
            self.root.after(0, lambda: self._log_debug(f"Decode error: {exc}"))

    def tx_worker(self) -> None:
        while self.running:
            try:
                msg_text, freq = self.tx_trigger_queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                bits = self.modem.string_to_bits(msg_text)
                audio_complex = self.modem.modulate(bits, freq)
                audio_float = np.real(audio_complex).astype(np.float32)
                self.is_transmitting = True
                self.audio.set_transmitting(True)
                self.rig.sync_at_tx()
                self.rig.set_ptt(True)
                time.sleep(0.15)
                self.audio.play(audio_float)
            except Exception as exc:
                logger.exception("TX error")
                self.root.after(0, lambda: messagebox.showerror("TX Error", str(exc)))
            finally:
                self.rig.set_ptt(False)
                self.audio.set_transmitting(False)
                self.is_transmitting = False
            self.root.after(0, self.advance_auto_seq)

    def load_capture(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("Audio", "*.wav"), ("IQ", "*.npz"), ("All", "*.*")])
        if not path:
            return
        try:
            audio = self.audio.load_audio_file(path)
            self._run_decoder(audio.astype(np.int16))
            self._log_debug(f"Loaded {path}")
        except Exception as exc:
            messagebox.showerror("Load Error", str(exc))

    def save_recording(self) -> None:
        path = filedialog.asksaveasfilename(defaultextension=".wav")
        if not path:
            return
        try:
            self.audio.start_recording()
            messagebox.showinfo("Recording", "Recording started. Press OK after one cycle to stop.")
            self.audio.stop_recording(path)
        except Exception as exc:
            messagebox.showerror("Recording Error", str(exc))

    def export_adif(self) -> None:
        path = filedialog.asksaveasfilename(defaultextension=".adi")
        if path:
            self.logbook.export_adif(path)

    def import_adif(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("ADIF", "*.adi *.adif")])
        if path:
            n = self.logbook.import_adif(path)
            messagebox.showinfo("Import", f"Imported {n} records")
