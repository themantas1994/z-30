"""Run: python audit/2026-09-23-vnext/probes/drift_and_clock.py [snr_db]   (report used -20 and -22)

Sensitivity of the benchmarked receive chain (acquisition.py + shipped demod + LDPC) to
(a) a linear carrier drift across the 24 s frame and (b) a sound-card sample-clock error,
neither of which the receiver models. AWGN at SNR_DB,
blind timing +/-0.5 s, carrier offset +/-5 Hz, 6 kHz. Seeded; every arm sees the same payloads
and noise draws."""
import sys
import json
from multiprocessing import Pool
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
import numpy as np
from scipy.signal import hilbert, resample
from z30_dsp.benchmark import generate_random_frame, add_calibrated_awgn, demodulate_mfsk_llrs, RECEIVER_PILOT_COHERENCE
from z30_dsp.acquisition import acquire_frame, slot_timing_search_sec
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.channel import apply_time_offset

cfg = Z30Config(sample_rate_hz=6000)
codec = Z30LdpcCodec()
mod = Z30Modulator(cfg)
SNR_DB = float(sys.argv[1]) if len(sys.argv) > 1 else -22.0
def run(arm):
    kind, value = arm
    rng = np.random.default_rng(777)
    ok = 0
    n = 40
    for i in range(n):
        payload, _c, _d, syms = generate_random_frame(codec, cfg, rng)
        w = mod.synthesize_frame(syms, 1250.0).astype(np.float64)
        foff = rng.uniform(-5, 5)
        toff = rng.uniform(-0.5, 0.5)
        t = np.arange(w.size) / cfg.sample_rate_hz
        drift = value if kind == "drift_hz" else 0.0
        # instantaneous offset foff + drift * (t/T - 1/2): mean offset foff, total excursion `drift`
        phase = 2 * np.pi * (foff * t + drift * (t ** 2 / (2 * t[-1]) - t / 2))
        w = np.real(hilbert(w) * np.exp(1j * phase))
        if kind == "clock_ppm" and value:
            w = resample(w, int(round(w.size * (1 + value * 1e-6))))
        buf, _ = apply_time_offset(w.astype(np.float32), toff, cfg.sample_rate_hz)
        noisy, _ = add_calibrated_awgn(buf, SNR_DB, cfg.sample_rate_hz, rng, float(np.mean(w ** 2)))
        a = acquire_frame(noisy, cfg, nominal_base_freq_hz=1250.0, time_search_sec=slot_timing_search_sec(0.5))
        llr = demodulate_mfsk_llrs(noisy, cfg, a.noise_sigma, audio_center_hz=a.base_freq_hz,
                                   start_sample=a.start_sample, pilot_coherence=RECEIVER_PILOT_COHERENCE)
        s, info, _ = codec.decode_min_sum(llr)
        ok += bool(s and np.array_equal(np.asarray(info[:63]), payload))
    return kind, value, ok, n
if __name__ == "__main__":
    arms = [("drift_hz", 0.0), ("drift_hz", 0.5), ("drift_hz", 1.0), ("drift_hz", 2.0), ("drift_hz", 4.0),
            ("drift_hz", 6.0), ("clock_ppm", 100.0), ("clock_ppm", 1000.0), ("clock_ppm", 3000.0),
            ("clock_ppm", 5000.0)]
    with Pool(4) as p:
        for kind, value, ok, n in p.map(run, arms):
            print(json.dumps({kind: value, "snr_db": SNR_DB, "decoded": ok, "frames": n}))
