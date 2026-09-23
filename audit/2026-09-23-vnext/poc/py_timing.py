# Run: python audit/2026-09-23-vnext/poc/py_timing.py <corpus dir>
"""Python arm of the language PoC: the shipped z30_dsp decoder and demodulator, timed on the same
corpus and test vector as the Numba, TypeScript and Rust arms. Plus a vectorised-NumPy demodulator
(tone tables + one matrix product) to separate algorithmic cost from interpreter cost."""
import sys
import time
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
import numpy as np
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.modem import Z30Config
from z30_dsp.benchmark import demodulate_mfsk_llrs
from scipy.special import i0e

d = sys.argv[1]
llrs = np.fromfile(d + "/corpus.bin", dtype="<f4").reshape(-1, 216)
refs = [line.split("\t") for line in open(d + "/corpus_ref.tsv").read().splitlines()]
codec = Z30LdpcCodec()
t_ok, t_fail = [], []
for f in range(llrs.shape[0]):
    t0 = time.perf_counter()
    ok, info, it = codec.decode_min_sum(llrs[f])
    ms = (time.perf_counter() - t0) * 1000
    (t_ok if ok else t_fail).append(ms)
def st(v):
    v = np.sort(np.asarray(v))
    return f"n={v.size} mean={v.mean():.2f}ms p50={np.median(v):.2f}ms p99={v[int(0.99*(v.size-1))]:.2f}ms max={v.max():.2f}ms"
print("PYTHON LDPC success:", st(t_ok))
print("PYTHON LDPC failure:", st(t_fail))

wave = np.fromfile(d + "/demod_wave.bin", dtype="<f4")
fs, sigma, f0, start = [float(x) for x in open(d + "/demod_meta.txt").read().split()]
cfg = Z30Config(sample_rate_hz=int(fs))
ref = np.fromfile(d + "/demod_llr_py.bin", dtype="<f4")
td = []
for _ in range(5):
    t0 = time.perf_counter()
    out = demodulate_mfsk_llrs(wave, cfg, sigma, audio_center_hz=f0, start_sample=int(start))
    td.append((time.perf_counter()-t0)*1000)
print("PYTHON DEMOD (shipped) fs=%d:" % fs, st(td))

# Vectorised NumPy: same maths, tone tables built once, all 75 symbols x 16 tones in one GEMM.
def demod_vec(wave, cfg, sigma, f0, start):
    n = int(cfg.sample_rate_hz * cfg.symbol_duration_sec)
    t = np.arange(n) / cfg.sample_rate_hz
    ref_c = np.exp(-2j * np.pi * (f0 + 3.125 * np.arange(16))[:, None] * t[None, :])  # 16 x n
    segs = wave[start:start + 75 * n].astype(np.float64).reshape(75, n)
    corr = segs @ ref_c.T                                                          # 75 x 16
    env = np.abs(corr)
    sync = np.array(cfg.sync_positions)
    tones = np.array(cfg.sync_tones)
    amp = max(0.01, float(np.mean(env[sync, tones] / (n / 2.0))))
    s_corr = (amp * n / 2.0) / max(1e-12, sigma * sigma * n / 2.0)
    z = env * s_corr
    ll = np.where(z > 15, z - 0.5 * np.log(np.maximum(1.0, 2 * np.pi * z)), np.log(np.maximum(1e-12, i0e(z))) + z)
    data = np.array([k for k in range(75) if k not in set(cfg.sync_positions)])
    ll = ll[data]                                                                  # 54 x 16
    out = np.empty(216, dtype=np.float32)
    tone_idx = np.arange(16)

    def lse(a):
        return a.max(1) + np.log(np.exp(a - a.max(1, keepdims=True)).sum(1))

    for b in range(4):
        m = 1 << (3 - b)
        l0 = ll[:, (tone_idx & m) == 0]
        l1 = ll[:, (tone_idx & m) != 0]
        out[b::4] = np.clip(lse(l0) - lse(l1), -25, 25)
    return out
tv = []
for _ in range(50):
    t0 = time.perf_counter()
    v = demod_vec(wave, cfg, sigma, f0, int(start))
    tv.append((time.perf_counter()-t0)*1000)
print("NUMPY-VECTORISED DEMOD fs=%d: max|diff vs shipped| = %.3e  %s" % (fs, float(np.max(np.abs(v - ref))), st(tv)))
