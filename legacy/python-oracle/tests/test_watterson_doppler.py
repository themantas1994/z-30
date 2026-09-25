"""
The oracle's Watterson channel produces the Doppler spread its presets are labelled with.

ITU-R F.1487 quotes a path's Doppler spread as the 2-sigma width of its Gaussian Doppler POWER
spectrum. Until 2026-09-24 apply_watterson_fading shaped the tap's amplitude with the power
spectrum's formula, so the power spectrum was narrower by sqrt(2) and every preset ran at 0.707
of its label (post-remediation audit N-01). The Rust channel model, crates/z30-channel, had the
same defect; its tests measure the same two quantities with the same method and tolerances.

A constant tone at an integer number of cycles per frame is faded. The analytic signal of the
result divided by the tone's is the channel gain g(t), and the ensemble-averaged periodogram of
g gives the power spectrum directly. On independent seed batches of 150 realisations the
estimate scatters by up to 2.2% for "good" (0.1 Hz, about 1.2 FFT bins of 1/24 Hz) and under 2%
for the others; the tolerances are about three to four times that. The defect is -29.3%.
"""

import numpy as np
import pytest
from scipy.signal import hilbert

from z30_dsp.channel import WATTERSON_PRESETS, apply_watterson_fading

FS = 6000.0
N = 144_000  # 24 s: 24 000 cycles of 1000 Hz, so the tone's analytic signal is exact and periodic.
TONE = np.cos(2 * np.pi * 1000.0 * np.arange(N) / FS).astype(np.float32)
REF = hilbert(TONE.astype(np.float64))


def measured(name, realisations, seed0):
    """(2-sigma spread from the averaged periodogram, ensemble power of g)."""
    preset = WATTERSON_PRESETS[name]
    psd = np.zeros(N)
    power = 0.0
    for k in range(realisations):
        faded = apply_watterson_fading(TONE, FS, preset, np.random.default_rng(seed0 + k))
        g = hilbert(faded.astype(np.float64)) / REF
        psd += np.abs(np.fft.fft(g)) ** 2
        power += np.mean(np.abs(g) ** 2)
    f = np.fft.fftfreq(N, d=1.0 / FS)
    keep = np.abs(f) <= 4.0 * max(preset.doppler_spread_hz, 0.05)
    sigma = np.sqrt(np.sum(f[keep] ** 2 * psd[keep]) / np.sum(psd[keep]))
    return 2.0 * sigma, power / realisations


@pytest.mark.parametrize("name,tol", [("good", 0.07), ("moderate", 0.04), ("poor", 0.04), ("high-moderate", 0.04)])
def test_generated_taps_have_the_labelled_doppler_spread(name, tol):
    label = WATTERSON_PRESETS[name].doppler_spread_hz
    spread, power = measured(name, 150, 3_000_000)
    assert abs(spread / label - 1.0) < tol, f"{name}: measured 2-sigma spread {spread:.4f} Hz, labelled {label} Hz"
    # Unit ensemble power (audit H-10), on the same taps.
    assert abs(power - 1.0) < 0.12, f"{name}: ensemble power {power:.3f}"

