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

Spectral containment
--------------------
An ultra-narrow mode that splatters is a worse neighbour than the wideband modes it means to
improve on, so containment is the whole premise of this waveform, not a finishing touch.

Two properties produce it, and both are load-bearing:

  1. **Phase continuity.** A single phase accumulator runs across the entire frame, so no
     symbol boundary introduces a phase discontinuity. A step in phase is an impulse in
     frequency and radiates energy across the whole passband.
  2. **A constant amplitude envelope.** The carrier is at full amplitude from the first symbol
     to the last; the only amplitude shaping is one raised-cosine ramp at the very start and
     end of the transmission.

Property 2 is the one that used to be violated here. An earlier version of this modulator kept
the phase accumulator but then multiplied every symbol by an 8 ms up/down ramp, driving the
envelope to zero at each of the 75 symbol boundaries - amplitude keying at 3.125 baud laid over
the tone sequence, whose sidebands extend far beyond 50 Hz no matter how narrow the tone
spacing is. It discarded the benefit of the phase accumulator it was sitting next to.

The frequency transition between symbols is smoothed instead of the amplitude, GFSK-style, the
same technique WSJT-X uses for FT8/FT4: the piecewise-constant tone sequence is convolved with
a Gaussian-shaped frequency pulse before it is integrated into phase. Smoothing frequency
narrows the spectrum; smoothing amplitude per symbol widens it.

`tests/test_modem_spectrum.py` measures the occupied bandwidth of a generated frame and asserts
it against a fixed budget, so this cannot silently regress.
"""

from dataclasses import dataclass
from typing import List, Sequence, Tuple, Optional
import numpy as np
from scipy.special import erf

@dataclass(frozen=True)
class Z30Config:
    num_tones: int = 16
    bandwidth_hz: float = 50.0
    tone_spacing_hz: float = 3.125
    symbol_duration_sec: float = 0.320
    sample_rate_hz: int = 12000
    total_symbols: int = 75
    #: Gaussian frequency-pulse bandwidth-time product. Lower values smooth the tone
    #: transitions more aggressively (narrower spectrum, more inter-symbol interference);
    #: higher values approach unshaped CPFSK, whose abrupt tone steps widen the spectrum.
    #: 2.0 is the value WSJT-X uses for FT8. Measured over random frames it gives ~66 Hz of
    #: -40 dB occupied bandwidth (tests/test_modem_spectrum.py asserts the budget). Dropping
    #: to 1.0 buys about 6 Hz of that back but costs roughly 2 dB of decode threshold against
    #: the per-symbol matched filter demodulator, because the extra smoothing is inter-symbol
    #: interference the demodulator does not model - a bad trade for a weak-signal mode.
    gfsk_bt: float = 2.0
    #: Raised-cosine amplitude ramp applied once at the start and once at the end of the whole
    #: frame - never per symbol.
    frame_ramp_sec: float = 0.020
    sync_positions: Tuple[int, ...] = (
        0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29,
        37, 38, 39, 47, 48, 49, 72, 73, 74
    )
    sync_tones: Tuple[int, ...] = (
        3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10,
        4, 8, 13, 0, 9, 3, 14, 6, 11
    )

def codeword_to_symbols(codeword_216: Sequence[int], cfg: Z30Config) -> List[int]:
    """
    Packs a 216-bit LDPC codeword into 54 4-bit data tones and interleaves them with the 21
    Costas sync tones at `cfg.sync_positions`, producing the full 75-symbol transmission
    sequence. This was duplicated identically in `benchmark.generate_random_frame` and
    `sic_decoder.Z30SicMultiSignalDecoder._recover_symbols` - one copy here so a change to the
    interleave order or the sync-tone cycling can't drift between the encode path and the SIC
    re-encode path used to peel off a decoded signal.
    """
    data_symbols: List[int] = []
    for s in range(54):
        idx = s * 4
        tone = (
            (int(codeword_216[idx]) << 3)
            | (int(codeword_216[idx + 1]) << 2)
            | (int(codeword_216[idx + 2]) << 1)
            | int(codeword_216[idx + 3])
        )
        data_symbols.append(tone)

    full_symbols = [0] * cfg.total_symbols
    sync_pos_set = set(cfg.sync_positions)
    sync_cnt = 0
    data_cnt = 0
    for i in range(cfg.total_symbols):
        if i in sync_pos_set:
            full_symbols[i] = cfg.sync_tones[sync_cnt % len(cfg.sync_tones)]
            sync_cnt += 1
        else:
            full_symbols[i] = data_symbols[data_cnt]
            data_cnt += 1

    return full_symbols


def gfsk_frequency_pulse(bt: float, samples_per_symbol: int) -> np.ndarray:
    """
    Gaussian-smoothed rectangular frequency pulse, three symbols long.

    This is the integral of a Gaussian over one symbol period: the convolution of a rectangular
    symbol pulse with a Gaussian of bandwidth-time product `bt`. Successive copies spaced one
    symbol apart sum to exactly 1.0 across the interior of the frame, so the instantaneous
    frequency lands on each symbol's tone at the centre of that symbol and slews smoothly
    between them rather than stepping.
    """
    if samples_per_symbol <= 0:
        raise ValueError("samples_per_symbol must be positive")
    if bt <= 0:
        raise ValueError("gfsk_bt must be positive")
    t = (np.arange(3 * samples_per_symbol, dtype=np.float64) - 1.5 * samples_per_symbol) / samples_per_symbol
    c = np.pi * np.sqrt(2.0 / np.log(2.0))
    return 0.5 * (erf(c * bt * (t + 0.5)) - erf(c * bt * (t - 0.5)))

class Z30Modulator:
    """Vectorized Continuous-Phase 16-MFSK (CPFSK/GFSK) Tone Generator."""

    def __init__(self, config: Optional[Z30Config] = None) -> None:
        self.cfg = config or Z30Config()
        self.samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)  # 3840 samples

    def instantaneous_frequency(self, symbol_sequence: Sequence[int], base_audio_freq_hz: float) -> np.ndarray:
        """
        Returns the instantaneous frequency in Hz for every sample of the frame.

        The first and last symbols are extended by one symbol period beyond the frame so the
        overlapping pulses still sum to 1.0 at the edges; without that the frequency would sag
        toward DC over the first and last symbol, which is a chirp, not a tone.
        """
        nsps = self.samples_per_symbol
        nsym = len(symbol_sequence)
        pulse = gfsk_frequency_pulse(self.cfg.gfsk_bt, nsps)

        tones = np.asarray(symbol_sequence, dtype=np.float64)
        freqs = base_audio_freq_hz + tones * self.cfg.tone_spacing_hz

        # One symbol of guard at each end; the frame itself occupies [nsps, (nsym+1)*nsps).
        extended = np.zeros((nsym + 2) * nsps, dtype=np.float64)
        extended[0:2 * nsps] += freqs[0] * pulse[nsps:]
        for j in range(nsym):
            start = j * nsps
            extended[start:start + 3 * nsps] += freqs[j] * pulse
        extended[(nsym + 1) * nsps:] += freqs[-1] * pulse[:nsps]

        return extended[nsps:(nsym + 1) * nsps]

    def frame_envelope(self, total_samples: int) -> np.ndarray:
        """
        Amplitude envelope for a whole frame: unity throughout, with a single raised-cosine
        ramp at the start and at the end to avoid a key click at switch-on and switch-off.
        """
        envelope = np.ones(total_samples, dtype=np.float64)
        ramp_len = int(self.cfg.frame_ramp_sec * self.cfg.sample_rate_hz)
        ramp_len = max(0, min(ramp_len, total_samples // 2))
        if ramp_len == 0:
            return envelope
        ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len) / ramp_len))
        envelope[:ramp_len] = ramp
        envelope[-ramp_len:] = ramp[::-1]
        return envelope

    def synthesize_frame(self, symbol_sequence: List[int], base_audio_freq_hz: float = 1250.0) -> np.ndarray:
        """
        Synthesizes a complete 75-symbol z-30 transmission frame as one continuous,
        constant-envelope waveform.

        Raises:
            ValueError: if the symbol count is wrong, a symbol index is outside 0..15, or the
                base frequency is not positive. These were bare `assert`s, which vanish under
                `python -O` - and a frame silently synthesized from a malformed symbol list is
                a malformed emission on a real antenna.
        """
        if len(symbol_sequence) != self.cfg.total_symbols:
            raise ValueError(
                f"Expected {self.cfg.total_symbols} symbols, got {len(symbol_sequence)}"
            )
        symbols = np.asarray(symbol_sequence)
        if not np.issubdtype(symbols.dtype, np.integer):
            if not np.all(symbols == np.round(symbols)):
                raise ValueError("Symbol indices must be integers")
            symbols = symbols.astype(np.int64)
        if symbols.min() < 0 or symbols.max() >= self.cfg.num_tones:
            raise ValueError(
                f"Symbol indices must be within 0..{self.cfg.num_tones - 1}; "
                f"got range {int(symbols.min())}..{int(symbols.max())}"
            )
        if base_audio_freq_hz <= 0.0:
            raise ValueError(f"base_audio_freq_hz must be positive, got {base_audio_freq_hz}")

        freq_hz = self.instantaneous_frequency(symbols, base_audio_freq_hz)

        # A single phase accumulator over the whole frame: phase(t) = 2*pi * integral f dt.
        phase = 2.0 * np.pi * np.cumsum(freq_hz) / self.cfg.sample_rate_hz
        waveform = np.sin(phase) * self.frame_envelope(freq_hz.size)

        peak = float(np.max(np.abs(waveform)))
        if peak < 1e-9:
            # Cannot happen for a valid symbol sequence, but dividing by this peak would hand
            # NaN samples to a sound card, which is undefined behaviour on real hardware.
            raise ValueError("Synthesized waveform is degenerate (zero amplitude)")
        return (waveform / peak).astype(np.float32)
