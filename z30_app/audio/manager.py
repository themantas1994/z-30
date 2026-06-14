"""Audio capture, playback, metering, and file I/O."""

from __future__ import annotations

import queue
import threading
import wave
from pathlib import Path
from typing import Callable

import numpy as np
import sounddevice as sd

from z30_app.constants import SAMPLE_RATE
from z30_app.stability.exceptions import AudioError
from z30_app.stability.logging_setup import get_logger

logger = get_logger(__name__)


class AudioManager:
    def __init__(self, config: dict):
        self.config = config
        self.sample_rate = SAMPLE_RATE
        self.input_device = config.get("audio", {}).get("input_device", config.get("audio_in"))
        self.output_device = config.get("audio", {}).get("output_device", config.get("audio_out"))
        self.input_gain = float(config.get("audio", {}).get("input_gain", 1.0))
        self.output_gain = float(config.get("audio", {}).get("output_gain", 1.0))

        self.audio_queue: queue.Queue = queue.Queue()
        self.input_level = 0.0
        self.output_level = 0.0
        self.agc_level = 1.0
        self.stream: sd.InputStream | None = None
        self._running = False
        self._is_transmitting = False
        self._monitor_enabled = bool(config.get("audio", {}).get("monitor_enabled", False))
        self._record_buffer: list[np.ndarray] = []
        self._recording = False
        self.status_message = "Not initialized"
        self.last_error: str | None = None

    @staticmethod
    def list_devices() -> list[dict]:
        try:
            devices = sd.query_devices()
            return [
                {
                    "index": i,
                    "name": d["name"],
                    "inputs": d["max_input_channels"],
                    "outputs": d["max_output_channels"],
                }
                for i, d in enumerate(devices)
            ]
        except Exception as exc:
            logger.error("Cannot query audio devices: %s", exc)
            return []

    @staticmethod
    def default_input() -> int | None:
        try:
            return sd.default.device[0]
        except Exception:
            return None

    @staticmethod
    def default_output() -> int | None:
        try:
            return sd.default.device[1]
        except Exception:
            return None

    def start(self, on_error: Callable[[str], None] | None = None) -> bool:
        self.stop()
        try:
            self.stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype=np.int16,
                blocksize=4096,
                callback=self._callback,
                device=self.input_device,
            )
            self.stream.start()
            self._running = True
            self.status_message = "Audio input active"
            self.last_error = None
            logger.info("Audio stream started (device=%s)", self.input_device)
            return True
        except Exception as exc:
            self.last_error = str(exc)
            self.status_message = f"Audio unavailable: {exc}"
            logger.warning("Audio start failed: %s", exc)
            if on_error:
                on_error(self.status_message)
            return False

    def stop(self) -> None:
        self._running = False
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception as exc:
                logger.debug("Audio stop: %s", exc)
            self.stream = None

    def set_transmitting(self, state: bool) -> None:
        self._is_transmitting = state

    def _callback(self, indata, frames, time_info, status) -> None:
        if status:
            logger.debug("Audio status: %s", status)
        if self._is_transmitting:
            return
        chunk = indata[:, 0].astype(np.float32) * self.input_gain
        peak = float(np.max(np.abs(chunk))) / 32768.0 if chunk.size else 0.0
        self.input_level = 0.85 * self.input_level + 0.15 * peak
        if self.config.get("audio", {}).get("agc_enabled", True):
            target = 0.25
            if peak > 1e-6:
                self.agc_level = min(4.0, max(0.25, target / peak))
        if self._recording:
            self._record_buffer.append(chunk.copy())
        self.audio_queue.put(chunk.astype(np.int16))

    def play(self, audio: np.ndarray) -> None:
        data = np.asarray(audio, dtype=np.float32) * self.output_gain
        peak = float(np.max(np.abs(data))) if data.size else 0.0
        self.output_level = peak
        sd.play(data, samplerate=self.sample_rate, device=self.output_device)
        sd.wait()
        self.output_level = 0.0

    def start_recording(self) -> None:
        self._record_buffer = []
        self._recording = True

    def stop_recording(self, path: str | Path) -> Path:
        self._recording = False
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not self._record_buffer:
            raise AudioError("No audio captured")
        audio = np.concatenate(self._record_buffer)
        pcm = np.clip(audio, -32768, 32767).astype(np.int16)
        with wave.open(str(path), "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(pcm.tobytes())
        logger.info("Saved recording to %s", path)
        return path

    def save_iq(self, iq: np.ndarray, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, iq=np.asarray(iq))
        return path

    def load_audio_file(self, path: str | Path) -> np.ndarray:
        path = Path(path)
        if path.suffix.lower() == ".npz":
            data = np.load(path)
            arr = data["iq"] if "iq" in data else data[data.files[0]]
            return np.real(arr).astype(np.float64)
        with wave.open(str(path), "r") as wf:
            frames = wf.readframes(wf.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float64)
        return audio

    def drain_queue(self) -> list[np.ndarray]:
        chunks = []
        while True:
            try:
                chunks.append(self.audio_queue.get_nowait())
            except queue.Empty:
                break
        return chunks
