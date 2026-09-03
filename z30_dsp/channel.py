"""
z-30 Propagation Channel Impairment Models
==========================================

Everything between an antenna and a decoder that a bench measurement leaves out: carrier
frequency offset, symbol timing offset, and HF fading.

A benchmark that omits these measures how well a decoder performs when it is handed the exact
noise sigma, the exact carrier frequency and perfect symbol timing. That is a bound on the
code's performance under ideal detection - a useful number, but not a decode threshold, and
not comparable to the published over-the-air figures of modes like FT8, which include all the
acquisition losses this used to exclude.

Fading follows the Watterson model (CCIR 520-2 / ITU-R F.1487): two independent paths, each
multiplied by a complex Gaussian tap whose spectrum is Gaussian with a specified Doppler
spread, separated by a fixed differential delay. The named presets are the recommendation's
own test conditions - see WATTERSON_PRESETS.
"""

from dataclasses import dataclass
from typing import Tuple

import numpy as np
from scipy.signal import hilbert


@dataclass(frozen=True)
class WattersonPreset:
    """One named ITU-R F.1487 / CCIR 520-2 channel condition."""
    name: str
    delay_spread_ms: float
    doppler_spread_hz: float


#: The ITU-R F.1487 test conditions this benchmark sweeps, plus a no-fading reference.
#:
#: The three that were already here are the recommendation's whole MID-LATITUDE row - they were
#: labelled "CCIR good / moderate / poor", which is not a designation the recommendation uses
#: and which hid the fact that all three describe the same latitude band. Their delay and
#: Doppler figures are unchanged, so every curve measured under them still stands; only the
#: name a run prints is different.
#:
#: `high-moderate` is new, and it is here because it is half of what the leading published
#: practice for this class of mode actually reports. WSJT-X's sensitivity tables give each mode
#: on three channels - AWGN, ITU mid-latitude disturbed, and ITU high-latitude moderate - and
#: the third is the one that separates modes with different symbol durations, because its 10 Hz
#: Doppler spread is wider than a narrow mode's whole tone spacing. Sweeping only the
#: mid-latitude row publishes a mode's best case and calls it the set.
#:
#: Recommendation ITU-R F.1487 (05/2000), "Testing of HF modems with bandwidths of up to about
#: 12 kHz using ionospheric channel simulators", differential time delay / frequency spread:
#:
#:      Latitude    Quiet          Moderate        Disturbed
#:      Low         0.5 ms/0.5 Hz  2 ms/1.5 Hz     6 ms/10 Hz
#:      Mid         0.5 ms/0.1 Hz  1 ms/0.5 Hz     2 ms/1 Hz
#:      High        1 ms/0.5 Hz    3 ms/10 Hz      7 ms/30 Hz
#:
#: The keys stay as they are. Renaming `poor` to `mid-disturbed` would be tidier and would
#: silently change what a reproduction command means: every published curve, every CI
#: invocation and every wiki page names these presets by key.
WATTERSON_PRESETS = {
    "none": WattersonPreset("No fading (AWGN only)", 0.0, 0.0),
    "good": WattersonPreset("ITU-R F.1487 mid-latitude quiet", 0.5, 0.1),
    "moderate": WattersonPreset("ITU-R F.1487 mid-latitude moderate", 1.0, 0.5),
    "poor": WattersonPreset("ITU-R F.1487 mid-latitude disturbed", 2.0, 1.0),
    "high-moderate": WattersonPreset("ITU-R F.1487 high-latitude moderate", 3.0, 10.0),
}


@dataclass(frozen=True)
class ChannelImpairments:
    """
    What to inject before the receiver sees the frame.

    Defaults describe a realistic weak-signal HF contact: a couple of Hz of dial error between
    two stations, up to half a second of timing error between two clocks synchronised only by
    NTP or an operator's wristwatch, and a moderately disturbed ionospheric path.
    """
    max_freq_offset_hz: float = 5.0
    max_time_offset_sec: float = 0.5
    fading: str = "moderate"

    @property
    def preset(self) -> WattersonPreset:
        if self.fading not in WATTERSON_PRESETS:
            raise ValueError(f"Unknown fading preset '{self.fading}'; choose from {sorted(WATTERSON_PRESETS)}")
        return WATTERSON_PRESETS[self.fading]


def apply_frequency_offset(wave: np.ndarray, offset_hz: float, sample_rate_hz: float) -> np.ndarray:
    """
    Shifts a real passband waveform by `offset_hz`, via its analytic signal so that only the
    positive-frequency image moves (naively multiplying a real signal by a cosine would create
    a second, mirrored copy).
    """
    if offset_hz == 0.0:
        return wave.astype(np.float32)
    analytic = hilbert(wave.astype(np.float64))
    n = np.arange(wave.size, dtype=np.float64)
    shifted = analytic * np.exp(2j * np.pi * offset_hz * n / sample_rate_hz)
    return np.real(shifted).astype(np.float32)


def apply_time_offset(wave: np.ndarray, offset_sec: float, sample_rate_hz: float,
                      pad_sec: float = 3.0) -> Tuple[np.ndarray, int]:
    """
    Places the frame inside a longer buffer, displaced by `offset_sec` from the nominal start.

    Returns the padded buffer and the TRUE start sample, which the receiver must find for
    itself and which the caller must not pass to the demodulator.
    """
    pad = int(round(pad_sec * sample_rate_hz))
    true_start = pad + int(round(offset_sec * sample_rate_hz))
    if true_start < 0:
        raise ValueError(f"time offset {offset_sec}s exceeds the {pad_sec}s guard padding")
    buf = np.zeros(wave.size + 2 * pad, dtype=np.float32)
    buf[true_start:true_start + wave.size] = wave
    return buf, true_start


def apply_watterson_fading(
    wave: np.ndarray,
    sample_rate_hz: float,
    preset: WattersonPreset,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Two-path Watterson fading channel.

    Each path is multiplied by an independent complex-Gaussian tap process whose power spectrum
    is Gaussian with standard deviation `doppler_spread_hz / 2` (the CCIR convention, where the
    quoted spread is the 2-sigma width). The taps are generated by filtering white complex
    Gaussian noise with the corresponding Gaussian impulse response, then normalised so the
    channel neither adds nor removes average power - the SNR the caller asked for stays the SNR
    the receiver sees.
    """
    if preset.doppler_spread_hz <= 0.0 and preset.delay_spread_ms <= 0.0:
        return wave.astype(np.float32)

    n = wave.size
    analytic = hilbert(wave.astype(np.float64))

    def gaussian_tap() -> np.ndarray:
        """One complex tap process with the requested Doppler spread."""
        white = (rng.standard_normal(n) + 1j * rng.standard_normal(n)) / np.sqrt(2.0)
        sigma_f = max(preset.doppler_spread_hz / 2.0, 1e-6)
        # Gaussian shaping in the frequency domain is exact and avoids a long time-domain FIR.
        freqs = np.fft.fftfreq(n, d=1.0 / sample_rate_hz)
        shape = np.exp(-0.5 * (freqs / sigma_f) ** 2)
        shaped = np.fft.ifft(np.fft.fft(white) * shape)
        power = np.mean(np.abs(shaped) ** 2)
        return shaped / np.sqrt(power) if power > 0 else shaped

    delay_samples = int(round(preset.delay_spread_ms * 1e-3 * sample_rate_hz))
    tap_a = gaussian_tap()
    faded = analytic * tap_a

    if delay_samples > 0:
        tap_b = gaussian_tap()
        delayed = np.zeros_like(analytic)
        delayed[delay_samples:] = analytic[:-delay_samples]
        faded = faded + delayed * tap_b
        # Two equal-power independent paths double the average power; renormalise.
        faded /= np.sqrt(2.0)

    return np.real(faded).astype(np.float32)


def impair_frame(
    clean_wave: np.ndarray,
    sample_rate_hz: float,
    impairments: ChannelImpairments,
    rng: np.random.Generator,
) -> Tuple[np.ndarray, int, float]:
    """
    Applies fading, then a random carrier offset, then a random timing offset.

    Returns (buffer, true_start_sample, true_freq_offset_hz). The receiver is given only the
    buffer; the true values are returned solely so a test can report acquisition error.
    """
    faded = apply_watterson_fading(clean_wave, sample_rate_hz, impairments.preset, rng)

    freq_offset = float(rng.uniform(-impairments.max_freq_offset_hz, impairments.max_freq_offset_hz))
    shifted = apply_frequency_offset(faded, freq_offset, sample_rate_hz)

    time_offset = float(rng.uniform(-impairments.max_time_offset_sec, impairments.max_time_offset_sec))
    buf, true_start = apply_time_offset(shifted, time_offset, sample_rate_hz)
    return buf, true_start, freq_offset
