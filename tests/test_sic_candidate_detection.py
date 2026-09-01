"""
The SIC candidate detector, on the Python side.

This detector had genuinely diverged from its TypeScript twin: Python scanned raw FFT bins at
8 dB over the median while `findCandidates` in src/dsp/realReceiver.ts scanned Bartlett-averaged
tone groups at 6 dB. Both were the shipped default on their own side, and no test compared them
or exercised either, so each could drift further without anything noticing.

Python now runs the grouped detector too. `test_cross_language_parity.py` pins the two constants
to each other; this file checks the behaviour those constants configure, on real synthesised
z-30 waveforms. Every expectation is computed from the generated signal - the carrier the test
injected, the noise floor the detector measured - rather than compared against a recorded value.

Note that none of this moves the published sensitivity figures: `benchmark.py` measures through
`acquisition.py` and never calls `_find_candidates`.
"""

import numpy as np
import pytest

from z30_dsp.modem import Z30Modulator, Z30Config
from z30_dsp.sic_decoder import Z30SicMultiSignalDecoder, SIC_MIN_PEAK_DB, SIC_MAX_CANDIDATES

SEED = 20260830


def _symbols():
    """A reproducible 75-symbol frame, derived arithmetically rather than recorded."""
    cfg = Z30Config()
    return [(i * 7 + 3) % cfg.num_tones for i in range(cfg.total_symbols)]


def _clean_frame(freq_hz=1500.0):
    mod = Z30Modulator()
    return np.asarray(mod.synthesize_frame(_symbols(), base_audio_freq_hz=freq_hz), dtype=np.float32)


def _noisy(clean, sigma, seed=SEED):
    rng = np.random.default_rng(seed)
    return (clean + rng.normal(0.0, sigma, size=len(clean))).astype(np.float32)


def test_detector_is_deterministic():
    """The same buffer must give the same candidate list; nothing here may consult an RNG."""
    decoder = Z30SicMultiSignalDecoder()
    buffer = _noisy(_clean_frame(), 0.05)
    first = decoder._find_candidates(buffer)
    second = decoder._find_candidates(buffer)
    assert [c["freq_hz"] for c in first] == [c["freq_hz"] for c in second]
    assert [c["peak_db"] for c in first] == [c["peak_db"] for c in second]


@pytest.mark.parametrize("carrier_hz", [800.0, 1500.0, 2200.0])
def test_finds_the_injected_carrier(carrier_hz):
    """
    The strongest candidate must land on the carrier the test put there, within one occupied
    bandwidth - the tolerance the detector's own dedup spacing uses.
    """
    decoder = Z30SicMultiSignalDecoder()
    buffer = _noisy(_clean_frame(carrier_hz), 0.05)
    candidates = decoder._find_candidates(buffer)
    assert candidates, f"no candidate found for a clean carrier at {carrier_hz} Hz"
    best = candidates[0]["freq_hz"]
    assert abs(best - carrier_hz) <= decoder.cfg.bandwidth_hz, (
        f"strongest candidate {best:.1f} Hz is not the injected {carrier_hz:.1f} Hz"
    )


def test_every_candidate_clears_the_threshold_it_documents():
    decoder = Z30SicMultiSignalDecoder()
    buffer = _noisy(_clean_frame(), 0.05)
    for cand in decoder._find_candidates(buffer):
        assert cand["peak_db"] >= cand["noise_floor_db"] + SIC_MIN_PEAK_DB


def test_candidate_list_is_capped():
    decoder = Z30SicMultiSignalDecoder()
    buffer = _noisy(_clean_frame(), 0.05)
    assert len(decoder._find_candidates(buffer)) <= SIC_MAX_CANDIDATES


def test_pure_noise_does_not_manufacture_carriers():
    """
    The reason the grouping step exists. On raw fine bins, the largest of ~10^5 independent noise
    bins clears a fixed "X dB over the median" test routinely, so the old detector invented
    candidates from noise and spent SIC passes on them.

    Asserted across several independent noise seeds so a single lucky draw cannot pass it.
    """
    decoder = Z30SicMultiSignalDecoder()
    length = len(_clean_frame())
    counts = []
    for seed in range(SEED, SEED + 5):
        rng = np.random.default_rng(seed)
        noise = rng.normal(0.0, 0.1, size=length).astype(np.float32)
        counts.append(len(decoder._find_candidates(noise)))
    assert max(counts) <= 3, f"noise-only candidate counts were {counts}"


def test_dedup_keeps_candidates_at_least_one_bandwidth_apart():
    """Two real carriers well apart are both found, and neither is reported twice."""
    decoder = Z30SicMultiSignalDecoder()
    a = _clean_frame(900.0)
    b = _clean_frame(2000.0)
    n = min(len(a), len(b))
    buffer = _noisy((a[:n] + b[:n]).astype(np.float32), 0.05)
    candidates = decoder._find_candidates(buffer)
    freqs = sorted(c["freq_hz"] for c in candidates)
    for lo, hi in zip(freqs, freqs[1:]):
        assert hi - lo >= decoder.cfg.bandwidth_hz, f"candidates {lo} and {hi} are closer than one bandwidth"
    assert any(abs(f - 900.0) <= decoder.cfg.bandwidth_hz for f in freqs), freqs
    assert any(abs(f - 2000.0) <= decoder.cfg.bandwidth_hz for f in freqs), freqs
