"""Professional waterfall display with palettes, zoom, and markers."""

from __future__ import annotations

import tkinter as tk
from typing import Callable

import numpy as np

from z30_app.constants import FREQ_MAX_HZ, FREQ_MIN_HZ


def _palette_wsjtx() -> np.ndarray:
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i in range(256):
        lut[i] = [min(255, int(i * 2.5)), min(255, int(i * 1.5)), max(0, 255 - i * 2)]
    return lut


def _palette_dark_sdr() -> np.ndarray:
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i in range(256):
        v = int(i * 0.9)
        lut[i] = [v // 4, v // 3, v]
    return lut


def _palette_gray() -> np.ndarray:
    v = np.arange(256, dtype=np.uint8)
    return np.stack([v, v, v], axis=1)


def _palette_inferno() -> np.ndarray:
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i in range(256):
        t = i / 255.0
        r = int(255 * min(1.0, max(0.0, 1.4 * t - 0.2)))
        g = int(255 * min(1.0, max(0.0, 2.2 * t - 0.4)))
        b = int(255 * min(1.0, max(0.0, 3.0 * t - 1.2)))
        lut[i] = [r, g, b]
    return lut


def _palette_viridis() -> np.ndarray:
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i in range(256):
        t = i / 255.0
        lut[i] = [int(255 * (0.15 + 0.7 * t)), int(255 * (0.05 + 0.8 * t * t)), int(255 * (0.4 + 0.3 * (1 - t)))]
    return lut


PALETTES = {
    "WSJT-X Style": _palette_wsjtx,
    "Dark SDR": _palette_dark_sdr,
    "Gray Scale": _palette_gray,
    "Inferno": _palette_inferno,
    "Viridis": _palette_viridis,
}


class WaterfallWidget:
    def __init__(
        self,
        parent: tk.Widget,
        height: int = 180,
        on_tune: Callable[[int], None] | None = None,
    ):
        self.parent = parent
        self.height = height
        self.on_tune = on_tune
        self.gain = 1.0
        self.contrast = 1.0
        self.speed = 2
        self.zoom = 1.0
        self.pan_hz = 0.0
        self.palette_name = "WSJT-X Style"
        self.rx_freq = 1500
        self.tx_freq = 1500
        self.decode_markers: list[tuple[float, str]] = []

        self._display_width = 800
        self._history = np.zeros((height, self._display_width), dtype=np.uint8)
        self._photo: tk.PhotoImage | None = None
        self._dragging = False

        self.scale_canvas = tk.Canvas(parent, height=22, bg="#1e1e1e", highlightthickness=0)
        self.scale_canvas.pack(fill=tk.X)
        self.scale_canvas.bind("<Configure>", self._on_scale_resize)

        self.canvas = tk.Canvas(parent, height=height, bg="black", highlightthickness=1, highlightbackground="#333")
        self.canvas.pack(fill=tk.X)
        self.canvas.bind("<Button-1>", self._on_click)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<MouseWheel>", self._on_wheel)
        self.canvas.bind("<Configure>", self._on_resize)

        self._image_id = None
        self._init_image()

    def _init_image(self) -> None:
        try:
            self._photo = tk.PhotoImage(width=self._display_width, height=self.height)
            self._image_id = self.canvas.create_image(0, 0, image=self._photo, anchor=tk.NW)
        except tk.TclError:
            self._display_width = min(1200, self._display_width)
            self._photo = tk.PhotoImage(width=self._display_width, height=self.height)
            self._history = np.zeros((self.height, self._display_width), dtype=np.uint8)
            self._image_id = self.canvas.create_image(0, 0, image=self._photo, anchor=tk.NW)

    def _on_resize(self, event) -> None:
        if event.width > 50 and event.width != self._display_width:
            old = self._history
            self._display_width = event.width
            self._history = np.zeros((self.height, self._display_width), dtype=np.uint8)
            copy_w = min(old.shape[1], self._display_width)
            self._history[:, :copy_w] = old[:, -copy_w:]
            self._init_image()
            if self._image_id:
                self.canvas.itemconfigure(self._image_id, image=self._photo)

    def _on_scale_resize(self, event) -> None:
        self._draw_scale(event.width)

    def _freq_range(self) -> tuple[float, float]:
        span = FREQ_MAX_HZ / self.zoom
        center = self.pan_hz + FREQ_MAX_HZ / 2
        f0 = max(FREQ_MIN_HZ, center - span / 2)
        f1 = min(FREQ_MAX_HZ, center + span / 2)
        return f0, f1

    def _x_to_freq(self, x: int) -> int:
        w = max(1, self.canvas.winfo_width())
        f0, f1 = self._freq_range()
        return int(f0 + (x / w) * (f1 - f0))

    def _freq_to_x(self, freq: float) -> int:
        w = max(1, self.canvas.winfo_width())
        f0, f1 = self._freq_range()
        if f1 <= f0:
            return 0
        return int(((freq - f0) / (f1 - f0)) * w)

    def _draw_scale(self, width: int) -> None:
        self.scale_canvas.delete("all")
        f0, f1 = self._freq_range()
        step = 500 if (f1 - f0) > 1500 else 200
        f = int(f0 // step) * step
        while f <= f1:
            x = int(((f - f0) / max(1, f1 - f0)) * width)
            self.scale_canvas.create_text(x, 8, text=str(f), fill="#aaa")
            self.scale_canvas.create_line(x, 15, x, 22, fill="#aaa")
            f += step

    def _on_click(self, event) -> None:
        self._dragging = True
        freq = self._x_to_freq(event.x)
        if self.on_tune:
            self.on_tune(freq)

    def _on_drag(self, event) -> None:
        if self._dragging:
            freq = self._x_to_freq(event.x)
            if self.on_tune:
                self.on_tune(freq)

    def _on_release(self, _event) -> None:
        self._dragging = False

    def _on_wheel(self, event) -> None:
        delta = 1.1 if event.delta > 0 else 0.9
        self.zoom = min(10.0, max(1.0, self.zoom * delta))
        self._draw_scale(self.scale_canvas.winfo_width())

    def set_palette(self, name: str) -> None:
        if name in PALETTES:
            self.palette_name = name

    def push_spectrum(self, magnitudes: np.ndarray) -> None:
        if self._photo is None:
            return
        w = self._display_width
        mags = np.asarray(magnitudes, dtype=np.float64)
        if mags.size < 8:
            return
        stretched = np.interp(np.linspace(0, mags.size - 1, w), np.arange(mags.size), mags[: mags.size])
        stretched = stretched * self.gain
        if self.contrast != 1.0:
            stretched = np.sign(stretched) * (np.abs(stretched) ** self.contrast)
        mx = np.max(stretched) + 1e-9
        row = np.clip((stretched / mx) * 255, 0, 255).astype(np.uint8)

        scroll = max(1, int(self.speed))
        self._history = np.roll(self._history, scroll, axis=0)
        self._history[:scroll, :] = row

        lut = PALETTES.get(self.palette_name, _palette_wsjtx)()
        rgb = lut[self._history]
        self._blit_rgb(rgb)
        self._draw_overlays()

    def _blit_rgb(self, rgb: np.ndarray) -> None:
        h, w, _ = rgb.shape
        hex_lines = []
        for y in range(h):
            line = "{" + " ".join(f"#{r:02x}{g:02x}{b:02x}" for r, g, b in rgb[y]) + "}"
            hex_lines.append(line)
        try:
            self._photo.tk.call(self._photo, "copy", self._photo, "-from", 0, 0, w, h - 1, "-to", 0, 1)
            self._photo.put(hex_lines[0], (0, 0))
            for y in range(1, h):
                self._photo.put(hex_lines[y], (0, y))
        except tk.TclError:
            pass

    def _draw_overlays(self) -> None:
        self.canvas.delete("marker")
        h = self.height
        for freq, label in (
            (self.rx_freq, "RX"),
            (self.tx_freq, "TX"),
        ):
            x = self._freq_to_x(freq)
            color = "#00ff00" if label == "RX" else "#ff4444"
            self.canvas.create_line(x, 0, x, h, fill=color, width=2, tags="marker")
            self.canvas.create_text(x + 2, 10, text=label, fill=color, anchor=tk.NW, tags="marker")
        for freq, call in self.decode_markers[-20:]:
            x = self._freq_to_x(freq)
            self.canvas.create_line(x, 0, x, h, fill="#ffff00", width=1, tags="marker")
            if call:
                self.canvas.create_text(x + 2, h - 12, text=call[:8], fill="#ffff00", anchor=tk.NW, tags="marker")

    def set_frequencies(self, rx: int, tx: int) -> None:
        self.rx_freq = rx
        self.tx_freq = tx

    def set_decode_markers(self, markers: list[tuple[float, str]]) -> None:
        self.decode_markers = markers
