"""
Occupied-bandwidth and envelope tests for the 16-MFSK modulator.

This is the acceptance criterion for the transmitter fix, and the guard that stops it
regressing. z-30's entire premise is a 50 Hz signal; a mode this narrow that splatters is a
worse neighbour than the wideband modes it means to improve on.

The reference implementation of the old, broken waveform is reproduced verbatim in
`legacy_gated_frame` below and asserted to FAIL these budgets, so the test proves it can tell
the difference rather than merely passing.

Software correctness is necessary, not sufficient: a clean waveform still has to survive the
sound card and the rig's ALC. Measure the transmitter's actual output before going on the air.
"""

import numpy as np
import pytest
from scipy.signal import welch

from z30_dsp.modem import Z30Config, Z30Modulator

#: ITU-style 99 % occupied bandwidth budget. The nominal figure for the mode is 50 Hz and the
#: tones themselves span 15 x 3.125 = 46.875 Hz, so this is a tight budget with a little
#: measurement headroom.
OCCUPIED_BW_99_BUDGET_HZ = 52.0

#: -40 dB bandwidth budget. Wider than the 99 % figure by construction: it counts the shoulders
#: two orders of magnitude down, which is what a neighbouring station 50 Hz away actually hears.
BANDWIDTH_40DB_BUDGET_HZ = 72.0

SEED = 20260830
SAMPLE_RATE_HZ = 12000


def power_spectrum(waveform: np.ndarray, sample_rate_hz: int):
    freqs, psd = welch(
        np.asarray(waveform, dtype=np.float64),
        fs=sample_rate_hz,
        nperseg=1 << 15,
        noverlap=1 << 14,
        window="hann",
    )
    return freqs, psd


def bandwidth_at_floor(waveform: np.ndarray, sample_rate_hz: int, floor_db: float) -> float:
    """Width of the band in which the PSD stays above `floor_db` relative to its peak."""
    freqs, psd = power_spectrum(waveform, sample_rate_hz)
    psd_db = 10.0 * np.log10(psd / np.max(psd) + 1e-30)
    above = np.where(psd_db >= floor_db)[0]
    return float(freqs[above[-1]] - freqs[above[0]])


def occupied_bandwidth_99(waveform: np.ndarray, sample_rate_hz: int) -> float:
    """ITU-R SM.328 occupied bandwidth: the band containing 99 % of the total mean power."""
    freqs, psd = power_spectrum(waveform, sample_rate_hz)
    cumulative = np.cumsum(psd)
    cumulative /= cumulative[-1]
    low = freqs[int(np.searchsorted(cumulative, 0.005))]
    high = freqs[int(np.searchsorted(cumulative, 0.995))]
    return float(high - low)


def legacy_gated_frame(symbols, cfg: Z30Config, base_hz: float = 1250.0) -> np.ndarray:
    """
    The pre-fix waveform, reproduced exactly: a phase accumulator across symbols (correct), but
    with an 8 ms raised-cosine amplitude ramp applied to EVERY symbol, taking the envelope to
    zero 3.125 times a second. That is amplitude keying at the symbol rate laid over the tone
    sequence, and it is what these budgets exist to catch.
    """
    sps = int(cfg.sample_rate_hz * cfg.symbol_duration_sec)
    time_vector = np.linspace(0, cfg.symbol_duration_sec, sps, endpoint=False)
    ramp_len = int(0.008 * cfg.sample_rate_hz)
    envelope = np.ones(sps)
    ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len) / ramp_len))
    envelope[:ramp_len] = ramp
    envelope[-ramp_len:] = ramp[::-1]

    waveform = np.zeros(len(symbols) * sps)
    phase = 0.0
    for idx, tone in enumerate(symbols):
        freq = base_hz + tone * cfg.tone_spacing_hz
        inst_phase = 2.0 * np.pi * freq * time_vector + phase
        waveform[idx * sps:(idx + 1) * sps] = np.sin(inst_phase) * envelope
        phase = (inst_phase[-1] + 2.0 * np.pi * freq / cfg.sample_rate_hz) % (2.0 * np.pi)
    return waveform / np.max(np.abs(waveform))


@pytest.fixture(scope="module")
def config() -> Z30Config:
    return Z30Config(sample_rate_hz=SAMPLE_RATE_HZ)


@pytest.fixture(scope="module")
def modulator(config) -> Z30Modulator:
    return Z30Modulator(config)


def random_symbols(seed: int, count: int = 75):
    return list(np.random.default_rng(seed).integers(0, 16, count))


@pytest.mark.parametrize("seed", [SEED, SEED + 1, SEED + 2])
def test_occupied_bandwidth_within_budget(modulator, config, seed):
    waveform = modulator.synthesize_frame(random_symbols(seed))
    occupied = occupied_bandwidth_99(waveform, config.sample_rate_hz)
    assert occupied <= OCCUPIED_BW_99_BUDGET_HZ, (
        f"99% occupied bandwidth {occupied:.1f} Hz exceeds the {OCCUPIED_BW_99_BUDGET_HZ} Hz budget"
    )


@pytest.mark.parametrize("seed", [SEED, SEED + 1, SEED + 2])
def test_forty_db_bandwidth_within_budget(modulator, config, seed):
    waveform = modulator.synthesize_frame(random_symbols(seed))
    bandwidth = bandwidth_at_floor(waveform, config.sample_rate_hz, -40.0)
    assert bandwidth <= BANDWIDTH_40DB_BUDGET_HZ, (
        f"-40 dB bandwidth {bandwidth:.1f} Hz exceeds the {BANDWIDTH_40DB_BUDGET_HZ} Hz budget"
    )


def test_legacy_per_symbol_gating_fails_the_budget(config):
    """
    The old waveform must fail, or these budgets are not measuring anything. Its -40 dB
    bandwidth was over 200 Hz - more than four times the mode's nominal occupied bandwidth.
    """
    legacy = legacy_gated_frame(random_symbols(SEED), config)
    legacy_bw = bandwidth_at_floor(legacy, config.sample_rate_hz, -40.0)
    assert legacy_bw > BANDWIDTH_40DB_BUDGET_HZ * 2, (
        f"the per-symbol-gated reference waveform measured only {legacy_bw:.1f} Hz, so this test "
        "is no longer able to detect the defect it exists to detect"
    )


def test_envelope_is_constant_between_the_frame_edge_ramps(modulator, config):
    """
    No per-symbol amplitude gating: away from the single start/end ramp the envelope must never
    dip. This is the property that keeps the sidebands where they belong.
    """
    waveform = modulator.synthesize_frame(random_symbols(SEED))
    ramp_samples = int(config.frame_ramp_sec * config.sample_rate_hz)
    interior = waveform[ramp_samples * 2:-ramp_samples * 2]

    # Envelope via the analytic signal magnitude.
    from scipy.signal import hilbert
    envelope = np.abs(hilbert(interior.astype(np.float64)))
    # Ignore the very edges of the Hilbert transform, which ring by construction.
    envelope = envelope[len(envelope) // 50: -len(envelope) // 50]

    assert envelope.min() > 0.9, f"envelope dipped to {envelope.min():.3f} inside the frame"
    assert envelope.max() < 1.1, f"envelope rose to {envelope.max():.3f} inside the frame"


def test_frame_edges_are_ramped(modulator, config):
    """A hard switch-on is a key click; the frame must start and end at zero amplitude."""
    waveform = modulator.synthesize_frame(random_symbols(SEED))
    assert abs(waveform[0]) < 1e-3
    assert abs(waveform[-1]) < 1e-2


def test_instantaneous_frequency_hits_each_tone_at_symbol_centre(modulator, config):
    """
    GFSK smoothing must move the frequency between tones without moving where it lands. At the
    centre of a symbol the instantaneous frequency should equal that symbol's tone.
    """
    symbols = random_symbols(SEED + 7)
    freq = modulator.instantaneous_frequency(symbols, 1250.0)
    sps = modulator.samples_per_symbol
    for idx, tone in enumerate(symbols):
        centre = idx * sps + sps // 2
        expected = 1250.0 + tone * config.tone_spacing_hz
        assert abs(freq[centre] - expected) < 0.5, (
            f"symbol {idx}: frequency at centre was {freq[centre]:.2f} Hz, expected {expected:.2f} Hz"
        )


def test_rejects_malformed_symbol_sequences(modulator, config):
    """
    These were bare `assert`s, which vanish under `python -O`. A malformed symbol list would
    then have produced a silently malformed emission on a real antenna.
    """
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 74)
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 74 + [16])
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 74 + [-1])
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 75, base_audio_freq_hz=0.0)


def test_output_is_finite_and_normalised(modulator):
    waveform = modulator.synthesize_frame(random_symbols(SEED + 3))
    assert np.all(np.isfinite(waveform)), "NaN or Inf samples would be undefined behaviour on a sound card"
    assert 0.99 <= float(np.max(np.abs(waveform))) <= 1.0
