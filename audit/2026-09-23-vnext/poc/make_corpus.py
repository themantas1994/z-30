# Run: python audit/2026-09-23-vnext/poc/make_corpus.py <out dir>
"""Builds a shared LLR corpus for the language PoC: channel LLR vectors from the shipped
Python demodulator at known timing (6 kHz, the benchmark's rate), plus the reference decoder's
verdict on each (Z30LdpcCodec.decode_min_sum). Output: corpus.bin (f32 216-vectors),
corpus_ref.json / corpus_ref.tsv (success, info bits, iterations, snr), and the 12 kHz demodulator
test vector (demod_wave.bin, demod_llr_py.bin, demod_meta.txt)."""
import json
import sys
import time
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
import numpy as np
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.benchmark import generate_random_frame, add_calibrated_awgn, demodulate_mfsk_llrs

out = sys.argv[1]
cfg = Z30Config(sample_rate_hz=6000)
mod = Z30Modulator(cfg)
codec = Z30LdpcCodec()
rng = np.random.default_rng(20260923)
llrs_all, refs = [], []
for snr in (-27.0, -26.0, -25.0, -24.0, -23.0, -22.0, -21.0):
    for f in range(40):
        payload, _cw, _ds, syms = generate_random_frame(codec, cfg, rng)
        wave = mod.synthesize_frame(syms, base_audio_freq_hz=1250.0)
        noisy, sigma = add_calibrated_awgn(wave, snr, cfg.sample_rate_hz, rng)
        llr = demodulate_mfsk_llrs(noisy, cfg, sigma, audio_center_hz=1250.0, start_sample=0)
        t0 = time.perf_counter()
        ok, info, iters = codec.decode_min_sum(llr)
        dt = time.perf_counter() - t0
        llrs_all.append(np.asarray(llr, dtype=np.float32))
        refs.append({"snr": snr, "success": bool(ok), "info": "".join(str(int(b)) for b in info[:77]),
                     "iters": int(iters), "correct": bool(ok and np.array_equal(np.asarray(info[:63]), payload)),
                     "py_ms": dt * 1000.0})
    print(snr, sum(r["success"] for r in refs[-40:]), "/40", flush=True)
np.stack(llrs_all).astype("<f4").tofile(out + "/corpus.bin")
json.dump(refs, open(out + "/corpus_ref.json", "w"))
with open(out + "/corpus_ref.tsv", "w") as f:
    for r in refs:
        f.write(f"{1 if r['success'] else 0}\t{r['iters']}\t{r['info']}\n")
print("frames:", len(refs))

# Demodulator test vector: one frame at 12 kHz (the rate the brief specifies) at -20 dB, known
# timing, plus the shipped Python demodulator's LLRs for it. Every PoC arm reads these three files.
cfg12 = Z30Config(sample_rate_hz=12000)
rng12 = np.random.default_rng(7)
_, _, _, syms12 = generate_random_frame(codec, cfg12, rng12)
wave12 = Z30Modulator(cfg12).synthesize_frame(syms12, base_audio_freq_hz=1250.0)
noisy12, sigma12 = add_calibrated_awgn(wave12, -20.0, cfg12.sample_rate_hz, rng12)
noisy12 = noisy12.astype("<f4")
llr12 = demodulate_mfsk_llrs(noisy12, cfg12, sigma12, audio_center_hz=1250.0, start_sample=0)
noisy12.tofile(out + "/demod_wave.bin")
np.asarray(llr12, dtype="<f4").tofile(out + "/demod_llr_py.bin")
# float(): NumPy 2's repr of a float64 scalar is "np.float64(...)", which the readers cannot parse.
open(out + "/demod_meta.txt", "w").write(f"12000 {float(sigma12)!r} 1250.0 0")
