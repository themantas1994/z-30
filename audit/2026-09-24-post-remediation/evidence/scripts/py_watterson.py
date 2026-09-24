"""Independent check of the frozen Python oracle's Watterson model (legacy/python-oracle/z30_dsp/channel.py)."""
import json, sys
import numpy as np
sys.path.insert(0, '.')
from z30_dsp.channel import apply_watterson_fading, WATTERSON_PRESETS
from scipy.signal import hilbert

fs = 6000.0
n = 144000
t = np.arange(n) / fs
tone = np.cos(2 * np.pi * 1000.0 * t).astype(np.float32)
ref = hilbert(tone.astype(np.float64))
out = {}
print("presets:", {k: (v.delay_spread_ms, v.doppler_spread_hz) for k, v in WATTERSON_PRESETS.items()})
lags = {"good": [2.0, 4.0], "moderate": [0.4, 0.8], "poor": [0.2, 0.4]}
for name, pr in WATTERSON_PRESETS.items():
    if pr.doppler_spread_hz <= 0:
        continue
    L = lags.get(name, [0.02, 0.04] if pr.doppler_spread_hz >= 5 else [0.4, 0.8])
    powers, acs, r0, taps = [], [[], []], [], []
    for s in range(300):
        rng = np.random.default_rng(10_000 + s)
        y = apply_watterson_fading(tone, fs, pr, rng)
        ya = hilbert(y.astype(np.float64))
        g = ya[3000:-3000] / ref[3000:-3000]
        powers.append(np.mean(np.abs(ya[3000:-3000]) ** 2) / np.mean(np.abs(ref[3000:-3000]) ** 2))
        r0.append(np.mean(np.abs(g) ** 2))
        taps.append(g[len(g) // 2])
        for k, lag in enumerate(L):
            l = int(lag * fs)
            acs[k].append(np.mean(g[:-l] * np.conj(g[l:])))
    p = np.array(powers)
    res = {"nominal_2sigma_spread_hz": pr.doppler_spread_hz, "delay_ms": pr.delay_spread_ms,
           "frame_power_mean": float(p.mean()), "frame_power_cv": float(p.std() / p.mean()),
           "frac_below_minus10db": float(np.mean(p < 0.1)), "tap_mean_abs2": float(np.mean(np.abs(taps) ** 2)), "spreads": []}
    for k, lag in enumerate(L):
        rho = abs(np.mean(acs[k])) / np.mean(r0)
        s_ = np.sqrt(-np.log(rho)) / (np.sqrt(2) * np.pi * lag)
        res["spreads"].append({"lag_s": lag, "rho": float(rho), "two_sigma_spread_hz": float(2 * s_)})
    out[name] = res
    print(name, json.dumps(res))
json.dump(out, open(sys.argv[1], "w"), indent=2)
