"""Settings dialogs with validation, import/export, and restore defaults."""

from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from z30_app.audio.manager import AudioManager
from z30_app.config.defaults import RADIO_MODEL_NAMES, default_config
from z30_app.config.manager import ConfigManager
from z30_app.config.validators import validate_config
from z30_app.constants import WATERFALL_PALETTES
from z30_app.stability.exceptions import ConfigError


class SettingsDialog(tk.Toplevel):
    def __init__(self, parent: tk.Tk, config_mgr: ConfigManager, on_saved):
        super().__init__(parent)
        self.config_mgr = config_mgr
        self.on_saved = on_saved
        self.title("Z-30 Settings")
        self.geometry("640x520")
        self.transient(parent)

        self._draft = self._clone(config_mgr.config)
        self._vars: dict[str, tk.Variable] = {}

        notebook = ttk.Notebook(self)
        notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        tabs = {
            "General": self._build_general,
            "Operator": self._build_operator,
            "Audio": self._build_audio,
            "Radio": self._build_radio,
            "Network": self._build_network,
            "Decoder": self._build_decoder,
            "Waterfall": self._build_waterfall,
            "Colors": self._build_colors,
            "Advanced DSP": self._build_advanced_dsp,
        }
        for name, builder in tabs.items():
            frame = ttk.Frame(notebook)
            notebook.add(frame, text=name)
            builder(frame)

        btn = ttk.Frame(self)
        btn.pack(fill=tk.X, padx=8, pady=8)
        ttk.Button(btn, text="Import...", command=self._import).pack(side=tk.LEFT, padx=4)
        ttk.Button(btn, text="Export...", command=self._export).pack(side=tk.LEFT, padx=4)
        ttk.Button(btn, text="Restore Defaults", command=self._restore).pack(side=tk.LEFT, padx=4)
        ttk.Button(btn, text="Cancel", command=self.destroy).pack(side=tk.RIGHT, padx=4)
        ttk.Button(btn, text="Save", command=self._save).pack(side=tk.RIGHT, padx=4)

    def _clone(self, cfg: dict) -> dict:
        import copy

        return copy.deepcopy(cfg)

    def _var(self, key: str, value, section: str | None = None) -> tk.Variable:
        if isinstance(value, bool):
            v = tk.BooleanVar(value=value)
        elif isinstance(value, int):
            v = tk.IntVar(value=value)
        elif isinstance(value, float):
            v = tk.DoubleVar(value=value)
        else:
            v = tk.StringVar(value=str(value) if value is not None else "")
        self._vars[f"{section}.{key}" if section else key] = v
        return v

    def _section(self, cfg: dict, name: str) -> dict:
        return cfg.setdefault(name, {})

    def _build_general(self, parent: ttk.Frame) -> None:
        g = self._section(self._draft, "general")
        self._row(parent, "Callsign", self._var("callsign", g.get("callsign", "N0CALL"), "general"))
        self._row(parent, "Locator", self._var("locator", g.get("locator", "FN20"), "general"))

    def _build_operator(self, parent: ttk.Frame) -> None:
        o = self._section(self._draft, "operator")
        self._row(parent, "My Call", self._var("my_call", o.get("my_call", ""), "operator"))
        self._row(parent, "My Grid", self._var("my_grid", o.get("my_grid", ""), "operator"))

    def _build_audio(self, parent: ttk.Frame) -> None:
        a = self._section(self._draft, "audio")
        devices = AudioManager.list_devices()
        names = ["Default"] + [f"{d['index']}: {d['name']}" for d in devices]
        in_var = tk.StringVar()
        out_var = tk.StringVar()
        in_dev = a.get("input_device")
        out_dev = a.get("output_device")
        in_var.set("Default" if in_dev is None else next((n for n in names if n.startswith(f"{in_dev}:")), "Default"))
        out_var.set("Default" if out_dev is None else next((n for n in names if n.startswith(f"{out_dev}:")), "Default"))
        self._vars["audio.input_device_name"] = in_var
        self._vars["audio.output_device_name"] = out_var
        self._row(parent, "Input Device", in_var, widget="combo", values=names)
        self._row(parent, "Output Device", out_var, widget="combo", values=names)
        self._row(parent, "Input Gain", self._var("input_gain", a.get("input_gain", 1.0), "audio"))
        self._row(parent, "Output Gain", self._var("output_gain", a.get("output_gain", 1.0), "audio"))
        self._row(parent, "Monitor", self._var("monitor_enabled", a.get("monitor_enabled", False), "audio"), widget="check")

    def _build_radio(self, parent: ttk.Frame) -> None:
        r = self._section(self._draft, "radio")
        self._row(parent, "Connection", self._var("connection_type", r.get("connection_type", "Network (rigctld)"), "radio"),
                  widget="combo", values=["Network (rigctld)", "1 - Dummy"])
        self._row(parent, "Model", self._var("model", r.get("model", RADIO_MODEL_NAMES[0]), "radio"), widget="combo", values=RADIO_MODEL_NAMES)
        self._row(parent, "Host", self._var("host", r.get("host", "127.0.0.1"), "radio"))
        self._row(parent, "Port", self._var("port", r.get("port", 4532), "radio"))
        self._row(parent, "Track Frequency", self._var("track_frequency", r.get("track_frequency", True), "radio"), widget="check")

    def _build_network(self, parent: ttk.Frame) -> None:
        n = self._section(self._draft, "network")
        self._row(parent, "rigctld Host", self._var("rigctld_host", n.get("rigctld_host", "127.0.0.1"), "network"))
        self._row(parent, "rigctld Port", self._var("rigctld_port", n.get("rigctld_port", 4532), "network"))

    def _build_decoder(self, parent: ttk.Frame) -> None:
        d = self._section(self._draft, "decoder")
        self._row(parent, "SIC Iterations", self._var("sic_iterations", d.get("sic_iterations", 5), "decoder"))
        self._row(parent, "SIC Layers", self._var("sic_layers", d.get("sic_layers", 3), "decoder"))
        self._row(parent, "LDPC Max Iter", self._var("ldpc_max_iter", d.get("ldpc_max_iter", 30), "decoder"))
        self._row(parent, "LDPC Algorithm", self._var("ldpc_algorithm", d.get("ldpc_algorithm", "normalized_min_sum"), "decoder"),
                  widget="combo", values=["normalized_min_sum", "offset_min_sum"])
        self._row(parent, "SNR Threshold", self._var("snr_threshold", d.get("snr_threshold", 8.0), "decoder"))
        self._row(parent, "Early Stop", self._var("early_stop", d.get("early_stop", True), "decoder"), widget="check")

    def _build_waterfall(self, parent: ttk.Frame) -> None:
        w = self._section(self._draft, "waterfall")
        self._row(parent, "Palette", self._var("palette", w.get("palette", WATERFALL_PALETTES[0]), "waterfall"), widget="combo", values=list(WATERFALL_PALETTES))
        self._row(parent, "Gain", self._var("gain", w.get("gain", 1.0), "waterfall"))
        self._row(parent, "Contrast", self._var("contrast", w.get("contrast", 1.0), "waterfall"))
        self._row(parent, "Speed", self._var("speed", w.get("speed", 2), "waterfall"))

    def _build_colors(self, parent: ttk.Frame) -> None:
        c = self._section(self._draft, "colors")
        for key in ("cq", "directed", "worked", "new_dxcc", "rr73", "73", "new_grid"):
            self._row(parent, key, self._var(key, c.get(key, "#ffffff"), "colors"))

    def _build_advanced_dsp(self, parent: ttk.Frame) -> None:
        a = self._section(self._draft, "advanced_dsp")
        self._row(parent, "Freq Search Step", self._var("freq_search_step", a.get("freq_search_step", 10.0), "advanced_dsp"))
        self._row(parent, "Monte Carlo Seed", self._var("monte_carlo_seed", a.get("monte_carlo_seed", 3030), "advanced_dsp"))

    def _row(self, parent, label, var, widget="entry", values=None) -> None:
        row = ttk.Frame(parent)
        row.pack(fill=tk.X, padx=6, pady=3)
        ttk.Label(row, text=label, width=18).pack(side=tk.LEFT)
        if widget == "combo":
            ttk.Combobox(row, textvariable=var, values=values or [], width=36).pack(side=tk.LEFT, fill=tk.X, expand=True)
        elif widget == "check":
            ttk.Checkbutton(row, variable=var).pack(side=tk.LEFT)
        else:
            ttk.Entry(row, textvariable=var, width=40).pack(side=tk.LEFT, fill=tk.X, expand=True)

    def _parse_device(self, name: str):
        if name == "Default" or not name:
            return None
        try:
            return int(name.split(":", 1)[0])
        except ValueError:
            return None

    def _collect(self) -> dict:
        cfg = self._clone(self._draft)
        for k, var in self._vars.items():
            if "." in k:
                section, key = k.split(".", 1)
                if section == "audio" and key.endswith("_device_name"):
                    continue
                cfg.setdefault(section, {})[key] = var.get()
            else:
                cfg[k] = var.get()
        cfg["audio"]["input_device"] = self._parse_device(self._vars["audio.input_device_name"].get())
        cfg["audio"]["output_device"] = self._parse_device(self._vars["audio.output_device_name"].get())
        cfg["callsign"] = cfg["general"]["callsign"]
        cfg["locator"] = cfg["general"]["locator"]
        cfg["audio_in"] = cfg["audio"]["input_device"]
        cfg["audio_out"] = cfg["audio"]["output_device"]
        return cfg

    def _save(self) -> None:
        cfg = self._collect()
        errors = validate_config(cfg)
        if errors:
            messagebox.showerror("Validation Error", "\n".join(errors), parent=self)
            return
        try:
            self.config_mgr.save(cfg)
            self.on_saved(cfg)
            self.destroy()
        except ConfigError as exc:
            messagebox.showerror("Save Error", str(exc), parent=self)

    def _import(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            self.config_mgr.import_from(path)
            self._draft = self._clone(self.config_mgr.config)
            messagebox.showinfo("Import", "Settings imported successfully.", parent=self)
            self.destroy()
            SettingsDialog(self.master, self.config_mgr, self.on_saved)
        except ConfigError as exc:
            messagebox.showerror("Import Error", str(exc), parent=self)

    def _export(self) -> None:
        path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            self.config_mgr.export_to(path)
            messagebox.showinfo("Export", f"Exported to {path}", parent=self)
        except OSError as exc:
            messagebox.showerror("Export Error", str(exc), parent=self)

    def _restore(self) -> None:
        if messagebox.askyesno("Restore Defaults", "Reset all settings to defaults?", parent=self):
            self.config_mgr.restore_defaults()
            self._draft = self._clone(default_config())
            messagebox.showinfo("Restore", "Defaults restored. Reopen settings to edit.", parent=self)
            self.destroy()
            SettingsDialog(self.master, self.config_mgr, self.on_saved)
