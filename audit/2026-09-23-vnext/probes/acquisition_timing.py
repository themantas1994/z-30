# Run: python audit/2026-09-23-vnext/probes/acquisition_timing.py
import sys
import time
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
import numpy as np
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.benchmark import generate_random_frame, add_calibrated_awgn
from z30_dsp.acquisition import acquire_frame
from z30_dsp.channel import apply_time_offset
for fs in (6000, 12000):
    cfg = Z30Config(sample_rate_hz=fs)
    rng = np.random.default_rng(3)
    _, _, _, syms = generate_random_frame(Z30LdpcCodec(), cfg, rng)
    w = Z30Modulator(cfg).synthesize_frame(syms, 1250.0)
    buf, true_start = apply_time_offset(w, 0.2, fs, pad_sec=1.5)
    noisy, _ = add_calibrated_awgn(buf, -20.0, fs, rng, float(np.mean(w ** 2)))
    for label, kw in (("benchmark window (+/-12 Hz, +/-0.55 s)", dict(freq_search_hz=12.0, time_search_sec=0.55)),
                      ("whole passband (200-2800 Hz, +/-1.5 s)", dict(nominal_base_freq_hz=1500.0, freq_search_hz=1300.0, time_search_sec=1.5))):
        kw.setdefault("nominal_base_freq_hz", 1250.0)
        t0 = time.perf_counter()
        a = acquire_frame(noisy, cfg, **kw)
        ms = (time.perf_counter() - t0) * 1000
        print(f"PYTHON acquire_frame fs={fs} {label}: {ms:.0f} ms  found start err={(a.start_sample-true_start)/fs*1000:.1f} ms f={a.base_freq_hz:.2f} Hz")
