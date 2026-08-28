"""
z-30 16-MFSK Continuous-Phase Modulator & Demodulator
=====================================================
RF & DSP Specifications:
- Alphabet size: M = 16 tones
- Occupied Bandwidth: B = 50.0 Hz
- Tone spacing: Delta_f = 50 / 16 = 3.125 Hz
- Symbol duration: T_s = 1 / Delta_f = 0.320 seconds (320 ms)
- Sample Rate: F_s = 12000 Hz
- Frame length: 75 symbols (24.0 s active Tx within 30.0 s synchronous slot)
"""

from dataclasses import dataclass
from typing import List, Tuple, Optional
import numpy as np
import scipy.signal as signal

@dataclass(frozen=True)
class Z30Config:
    num_tones: int = 16
    bandwidth_hz: float = 50.0
    tone_spacing_hz: float = 3.125
    symbol_duration_sec: float = 0.320
    sample_rate_hz: int = 12000
    total_symbols: int = 75
    sync_positions: Tuple[int, ...] = (
        0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29,
        37, 38, 39, 47, 48, 49, 72, 73, 74
    )
    sync_tones: Tuple[int, ...] = (
        3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10,
        4, 8, 13, 0, 9, 3, 14, 6, 11
    )

class Z30Modulator:
    """Vectorized Continuous-Phase 16-MFSK (CPFSK) Tone Generator."""

    def __init__(self, config: Optional[Z30Config] = None) -> None:
        self.cfg = config or Z30Config()
        self.samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)  # 3840 samples

    def synthesize_frame(self, symbol_sequence: List[int], base_audio_freq_hz: float = 1250.0) -> np.ndarray:
        """
        Synthesizes a complete 75-symbol z-30 transmission frame with phase continuity
        and raised-cosine pulse smoothing to enforce strict 50 Hz spectral containment.
        """
        assert len(symbol_sequence) == self.cfg.total_symbols, f"Expected {self.cfg.total_symbols} symbols"
        
        total_samples = len(symbol_sequence) * self.samples_per_symbol
        time_vector = np.linspace(0, self.cfg.symbol_duration_sec, self.samples_per_symbol, endpoint=False)
        
        ramp_len = int(0.008 * self.cfg.sample_rate_hz)  # 96 samples (8ms ramp)
        envelope = np.ones(self.samples_per_symbol, dtype=np.float32)
        ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len) / ramp_len))
        envelope[:ramp_len] = ramp
        envelope[-ramp_len:] = ramp[::-1]

        waveform = np.zeros(total_samples, dtype=np.float32)
        current_phase = 0.0

        for idx, tone_idx in enumerate(symbol_sequence):
            tone_freq = base_audio_freq_hz + (tone_idx * self.cfg.tone_spacing_hz)
            inst_phase = 2.0 * np.pi * tone_freq * time_vector + current_phase
            sym_wave = np.sin(inst_phase).astype(np.float32) * envelope
            
            start_sample = idx * self.samples_per_symbol
            end_sample = start_sample + self.samples_per_symbol
            waveform[start_sample:end_sample] = sym_wave
            
            current_phase = (inst_phase[-1] + 2.0 * np.pi * tone_freq * (1.0 / self.cfg.sample_rate_hz)) % (2.0 * np.pi)

        return waveform / np.max(np.abs(waveform))
