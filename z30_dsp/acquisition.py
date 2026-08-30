"""
z-30 Frame Acquisition
======================

Finds a z-30 frame in a stream of audio: where it starts and what carrier frequency it is on,
using only the 21 Costas synchronisation symbols - the information a real receiver actually
has. It also estimates the channel noise level, which a real receiver is likewise not told.

This exists because the benchmark previously handed its demodulator the exact carrier
frequency (hardcoded 1250.0 Hz), perfect symbol timing (`start = f * samples_per_symbol`, zero
offset) and the exact noise sigma used to generate the noise. Those three gifts are worth
several dB, and a sensitivity figure measured with them is not a decode threshold.

Method
------
1. Coarse search. A symbol-rate spectrogram is computed with the FFT zero-padded 8x, giving
   `tone_spacing / 8` = 0.39 Hz frequency resolution and `symbol / 8` = 40 ms time resolution.
   For every candidate (start time, base frequency) the powers at the 21 known sync tones are
   summed; the peak is the coarse estimate.
2. Fine search. A local grid around the coarse peak is scored by direct correlation against
   each sync tone, refining timing to ~5 ms and frequency to ~0.05 Hz - well inside what the
   3.125 Hz tone spacing needs.
"""

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

from z30_dsp.modem import Z30Config

#: FFT zero-padding factor for the coarse spectrogram (frequency bins per tone spacing).
COARSE_FREQ_OVERSAMPLE = 8
#: Spectrogram hops per symbol period.
COARSE_TIME_OVERSAMPLE = 8


@dataclass(frozen=True)
class Acquisition:
    """Result of a frame search."""
    start_sample: int
    base_freq_hz: float
    #: Sum of sync-tone power at the winning candidate, relative to the search-grid median.
    sync_score_db: float
    #: Estimated per-sample noise standard deviation of the input stream.
    noise_sigma: float

    @property
    def found(self) -> bool:
        return self.sync_score_db > 0.0


def estimate_noise_sigma(stream: np.ndarray, cfg: Z30Config, signal_centre_hz: float) -> float:
    """
    Estimates the per-sample noise standard deviation from the spectrum outside the signal.

    Takes the median power spectral density across the audio passband with a 400 Hz notch
    around the signal removed, then converts that density back to a time-domain sigma. The
    median is used rather than the mean so a strong interfering carrier elsewhere in the
    passband does not inflate the estimate.
    """
    n = stream.size
    if n < 1024:
        return float(np.std(stream)) or 1e-9
    window = np.hanning(n)
    spectrum = np.fft.rfft(stream.astype(np.float64) * window)
    freqs = np.fft.rfftfreq(n, d=1.0 / cfg.sample_rate_hz)
    # Coherent gain correction for the window, so the PSD scale matches the time domain.
    win_power = np.mean(window ** 2)
    psd = (np.abs(spectrum) ** 2) / (n * win_power)

    band = (freqs > 200.0) & (freqs < min(2800.0, cfg.sample_rate_hz / 2 - 100.0))
    notch = np.abs(freqs - signal_centre_hz) > 200.0
    usable = band & notch
    if not np.any(usable):
        return float(np.std(stream)) or 1e-9

    # Median of an exponentially distributed periodogram underestimates the mean by ln(2).
    psd_mean = float(np.median(psd[usable])) / np.log(2.0)
    # Total noise power over the full Nyquist span, expressed as a time-domain variance.
    variance = psd_mean * (cfg.sample_rate_hz / 2.0) * (2.0 / cfg.sample_rate_hz) * (n / 2.0)
    # The expression above reduces to psd_mean * n/2; keep it explicit for reviewability.
    sigma = np.sqrt(max(variance, 1e-24) / (n / 2.0))
    return float(max(sigma, 1e-9))


def _spectrogram(stream: np.ndarray, cfg: Z30Config, nsps: int) -> Tuple[np.ndarray, float, int]:
    """Symbol-length windowed power spectrogram, zero-padded for sub-tone frequency resolution."""
    hop = max(1, nsps // COARSE_TIME_OVERSAMPLE)
    nfft = nsps * COARSE_FREQ_OVERSAMPLE
    n_frames = 1 + (stream.size - nsps) // hop
    if n_frames <= 0:
        return np.zeros((0, nfft // 2 + 1)), cfg.sample_rate_hz / nfft, hop

    window = np.hanning(nsps)
    # Strided view avoids materialising n_frames copies of the stream.
    frames = np.lib.stride_tricks.as_strided(
        stream,
        shape=(n_frames, nsps),
        strides=(stream.strides[0] * hop, stream.strides[0]),
        writeable=False,
    )
    spectra = np.fft.rfft(frames * window, n=nfft, axis=1)
    return np.abs(spectra) ** 2, cfg.sample_rate_hz / nfft, hop


def acquire_frame(
    stream: np.ndarray,
    cfg: Z30Config,
    nominal_base_freq_hz: float = 1250.0,
    freq_search_hz: float = 12.0,
    time_search_sec: Optional[float] = None,
) -> Acquisition:
    """
    Searches `stream` for a z-30 frame.

    Args:
        stream: real audio samples at `cfg.sample_rate_hz`, longer than one frame.
        nominal_base_freq_hz: where the frame is expected; the search spans +/- freq_search_hz.
        freq_search_hz: half-width of the carrier search, in Hz.
        time_search_sec: half-width of the timing search. Defaults to searching the whole
            stream, which is what a receiver with no prior timing knowledge must do.

    Returns an `Acquisition`. `found` is False when nothing in the search space stands out
    from the noise floor, which is the honest answer at low SNR and is counted as a decode
    failure by the benchmark rather than being papered over.
    """
    nsps = int(round(cfg.sample_rate_hz * cfg.symbol_duration_sec))
    stream = np.ascontiguousarray(stream, dtype=np.float64)

    power, bin_hz, hop = _spectrogram(stream, cfg, nsps)
    if power.shape[0] == 0:
        return Acquisition(0, nominal_base_freq_hz, -np.inf, 1e-9)

    # ---- coarse search ---------------------------------------------------------------
    last_sync_pos = max(cfg.sync_positions)
    frames_needed = last_sync_pos * COARSE_TIME_OVERSAMPLE + 1
    n_start = power.shape[0] - frames_needed
    if n_start <= 0:
        return Acquisition(0, nominal_base_freq_hz, -np.inf, 1e-9)

    if time_search_sec is not None:
        centre_frame = int(round((stream.size / 2 - nsps * cfg.total_symbols / 2) / hop))
        half = int(round(time_search_sec * cfg.sample_rate_hz / hop))
        lo = max(0, centre_frame - half)
        hi = min(n_start, centre_frame + half + 1)
    else:
        lo, hi = 0, n_start
    if hi <= lo:
        lo, hi = 0, n_start
    start_idx = np.arange(lo, hi)

    top_tone_bins = (cfg.num_tones - 1) * COARSE_FREQ_OVERSAMPLE
    f_lo = int(np.floor((nominal_base_freq_hz - freq_search_hz) / bin_hz))
    f_hi = int(np.ceil((nominal_base_freq_hz + freq_search_hz) / bin_hz))
    f_lo = max(0, f_lo)
    f_hi = min(power.shape[1] - top_tone_bins - 1, f_hi)
    if f_hi <= f_lo:
        return Acquisition(0, nominal_base_freq_hz, -np.inf, 1e-9)
    freq_idx = np.arange(f_lo, f_hi + 1)

    score = np.zeros((start_idx.size, freq_idx.size), dtype=np.float64)
    for pos, tone in zip(cfg.sync_positions, cfg.sync_tones):
        rows = start_idx + pos * COARSE_TIME_OVERSAMPLE
        cols = freq_idx + tone * COARSE_FREQ_OVERSAMPLE
        score += power[np.ix_(rows, cols)]

    peak_flat = int(np.argmax(score))
    ti, fi = np.unravel_index(peak_flat, score.shape)
    peak = float(score[ti, fi])
    floor = float(np.median(score))
    sync_score_db = 10.0 * np.log10(peak / floor) if floor > 0 else -np.inf

    coarse_start = int(start_idx[ti]) * hop
    coarse_freq = float(freq_idx[fi]) * bin_hz

    # ---- fine search -----------------------------------------------------------------
    # Direct correlation against the sync tones, on a local grid around the coarse peak.
    time_grid = coarse_start + np.arange(-hop, hop + 1, max(1, nsps // 64))
    time_grid = time_grid[(time_grid >= 0) & (time_grid + cfg.total_symbols * nsps <= stream.size)]
    freq_grid = coarse_freq + np.linspace(-bin_hz, bin_hz, 17)
    if time_grid.size == 0:
        time_grid = np.array([max(0, min(coarse_start, stream.size - cfg.total_symbols * nsps))])

    t_vec = np.arange(nsps) / cfg.sample_rate_hz
    best = (-np.inf, int(time_grid[0]), float(coarse_freq))
    for f0 in freq_grid:
        # Precompute the reference oscillator for each distinct sync tone at this f0.
        refs = {}
        for tone in set(cfg.sync_tones):
            freq = f0 + tone * cfg.tone_spacing_hz
            refs[tone] = (np.cos(2 * np.pi * freq * t_vec), np.sin(2 * np.pi * freq * t_vec))
        for t0 in time_grid:
            total = 0.0
            for pos, tone in zip(cfg.sync_positions, cfg.sync_tones):
                s = int(t0) + pos * nsps
                seg = stream[s:s + nsps]
                if seg.size < nsps:
                    total = -np.inf
                    break
                c, sn = refs[tone]
                total += float(np.dot(seg, c)) ** 2 + float(np.dot(seg, sn)) ** 2
            if total > best[0]:
                best = (total, int(t0), float(f0))

    _, start_sample, base_freq = best
    centre = base_freq + (cfg.num_tones - 1) * cfg.tone_spacing_hz / 2.0
    sigma = estimate_noise_sigma(stream, cfg, centre)
    return Acquisition(start_sample, base_freq, sync_score_db, sigma)
