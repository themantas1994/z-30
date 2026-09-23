"""Run: python audit/2026-09-23-vnext/poc/numba_ldpc.py <corpus dir>   (needs `pip install numba`)

Numba port of z30_dsp/ldpc.py decode_min_sum for the language PoC.

On-disk caching is OFF by default. With Z30_NUMBA_CACHE=1 the first run compiles and writes the
cache and the SECOND run segfaults while loading it (reproduced three times on numba 0.67.0 / NumPy
2.2.6 / Python 3.11); the recursive `pairwise_sum` is the likely trigger. Without the cache every
start pays the JIT compile (7.4 s measured).

Same transcription rules as the Rust port (src/ldpc.rs): f32 state, constants rounded to f32
before use, (1 - damping) formed in f64, dither added in f64, NumPy pairwise f32 summation for
correlations. Numba does NOT follow NEP 50 - a bare Python float literal is f64 and silently
promotes f32 arithmetic - so every constant below is an explicit np.float32.
"""
import math
import os
import sys
import time

import numpy as np
from numba import njit

CACHE = os.environ.get("Z30_NUMBA_CACHE") == "1"

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
from z30_dsp.ldpc import Z30_CHECK_TO_INFO  # noqa: E402

N, K, M = 216, 77, 139
TABLE = np.asarray(Z30_CHECK_TO_INFO, dtype=np.int64)
_edge_var = []
_edge_lo = [0]
for c in range(M):
    vs = sorted(Z30_CHECK_TO_INFO[c]) + ([K + c - 1] if c > 0 else []) + [K + c]
    _edge_var.extend(vs)
    _edge_lo.append(len(_edge_var))
EDGE_VAR = np.asarray(_edge_var, dtype=np.int64)
EDGE_LO = np.asarray(_edge_lo, dtype=np.int64)
# mode 0 = NMS, 1 = SPA, 2 = DITHER; columns: mode, alpha, beta, damping, reverse, iters
SCHED = np.array([[0, 0.82, 0.08, 0.88, 0, 45], [1, 0.95, 0.00, 0.85, 0, 40],
                  [0, 0.74, 0.04, 0.90, 1, 35], [2, 0.80, 0.06, 0.85, 0, 30]], dtype=np.float64)


@njit(cache=CACHE)
def crc14(bits, n):
    crc = 0x2757
    for i in range(n):
        msb = (crc >> 13) & 1
        crc = ((crc << 1) & 0x3FFF) ^ (0x2443 if (msb ^ (bits[i] & 1)) else 0)
    return crc & 0x3FFF


@njit(cache=CACHE)
def bits_to_int(bits, lo, hi):
    v = 0
    for i in range(lo, hi):
        v = (v << 1) | (bits[i] & 1)
    return v


@njit(cache=CACHE)
def syndrome_weight(cw, edge_var, edge_lo):
    w = 0
    for c in range(M):
        s = 0
        for e in range(edge_lo[c], edge_lo[c + 1]):
            s ^= cw[edge_var[e]]
        w += s
    return w


@njit(cache=CACHE)
def reaccumulate(info, table, cw):
    for i in range(K):
        cw[i] = info[i]
    p = 0
    for c in range(M):
        s = 0
        for j in range(5):
            s ^= info[table[c, j]]
        p ^= s
        cw[K + c] = p


@njit(cache=CACHE)
def pairwise_sum(a, lo, n):
    if n < 8:
        res = np.float32(0.0)
        for i in range(lo, lo + n):
            res += a[i]
        return res
    elif n <= 128:
        r = np.empty(8, dtype=np.float32)
        for j in range(8):
            r[j] = a[lo + j]
        i = 8
        while i < n - (n % 8):
            for j in range(8):
                r[j] += a[lo + i + j]
            i += 8
        res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]))
        while i < n:
            res += a[lo + i]
            i += 1
        return res
    else:
        n2 = n // 2
        n2 -= n2 % 8
        return pairwise_sum(a, lo, n2) + pairwise_sum(a, lo + n2, n - n2)


@njit(cache=CACHE)
def correlation(cw, llr, prod):
    for i in range(N):
        prod[i] = llr[i] if cw[i] == 0 else -llr[i]
    return pairwise_sum(prod, 0, N)


@njit(cache=CACHE)
def dither_vector(llr):
    h = np.uint32(0x811C9DC5)
    for i in range(N):
        q = np.uint32(np.int64(math.floor(np.float64(llr[i]) * 64.0 + 0.5)) & 0xFFFFFFFF)
        for shift in (0, 8, 16, 24):
            h = np.uint32(h ^ ((q >> np.uint32(shift)) & np.uint32(0xFF)))
            h = np.uint32((np.uint64(h) * np.uint64(0x01000193)) & np.uint64(0xFFFFFFFF))
    state = np.uint64(h if h != 0 else 0x9E3779B9)
    out = np.empty(N, dtype=np.float64)
    m = np.uint64(0xFFFFFFFF)
    for i in range(N):
        state = (state + np.uint64(0x6D2B79F5)) & m
        t = state
        t = ((t ^ (t >> np.uint64(15))) * (t | np.uint64(1))) & m
        t = (t ^ ((t + ((t ^ (t >> np.uint64(7))) * (t | np.uint64(61)))) & m)) & m
        unit = np.float64((t ^ (t >> np.uint64(14))) & m) / 4294967296.0
        out[i] = (unit - 0.5) * 0.45
    return out


@njit(cache=CACHE)
def box_plus(x, y):
    sign_y = np.float32(1.0) if y >= np.float32(0.0) else np.float32(-1.0)
    s = sign_y if x >= np.float32(0.0) else -sign_y
    base = min(abs(x), abs(y)) * s
    a = -abs(x + y)
    b = -abs(x - y)
    ca = np.float32(math.log1p(np.float32(math.exp(a)))) if a > np.float32(-30.0) else np.float32(0.0)
    cb = np.float32(math.log1p(np.float32(math.exp(b)))) if b > np.float32(-30.0) else np.float32(0.0)
    return (base + ca) - cb


@njit(cache=CACHE)
def decode(llr_in, edge_var, edge_lo, table, sched):
    inp = llr_in.astype(np.float32)
    hard = np.empty(N, dtype=np.int64)
    for i in range(N):
        hard[i] = 1 if inp[i] < np.float32(0.0) else 0
    if crc14(hard, 63) == bits_to_int(hard, 63, 77) and syndrome_weight(hard, edge_var, edge_lo) == 0:
        return True, hard[:K].copy(), 1
    msgs = np.zeros(edge_var.size, dtype=np.float32)
    total = np.empty(N, dtype=np.float32)
    best_total = inp.copy()
    best_cw = np.zeros(N, dtype=np.int64)
    ira = np.zeros(N, dtype=np.int64)
    prod = np.empty(N, dtype=np.float32)
    vals = np.empty(8, dtype=np.float32)
    acc = np.empty(8, dtype=np.float32)
    aux = np.empty(8, dtype=np.float32)
    newm = np.empty(8, dtype=np.float32)
    min_syn = 999
    total_iters = 0
    for si in range(4):
        mode = int(sched[si, 0])
        alpha = np.float32(sched[si, 1])
        beta = np.float32(sched[si, 2])
        c_old = np.float32(1.0 - sched[si, 3])
        c_new = np.float32(sched[si, 3])
        reverse = sched[si, 4] != 0.0
        iters = int(sched[si, 5])
        for i in range(N):
            total[i] = inp[i]
        if mode == 2:
            dv = dither_vector(inp)
            for i in range(N):
                total[i] = np.float32(np.float64(total[i]) + dv[i])
        msgs[:] = np.float32(0.0)
        for _it in range(iters):
            total_iters += 1
            for idx in range(M):
                c = M - 1 - idx if reverse else idx
                lo = edge_lo[c]
                d = edge_lo[c + 1] - lo
                min1 = np.float32(999999.0)
                min2 = np.float32(999999.0)
                min1_idx = -1
                prod_sign = np.float32(1.0)
                for i in range(d):
                    v = edge_var[lo + i]
                    val = total[v] - msgs[lo + i]
                    vals[i] = val
                    prod_sign *= np.float32(1.0) if val >= np.float32(0.0) else np.float32(-1.0)
                    mag = abs(val)
                    if mag < min1:
                        min2 = min1
                        min1 = mag
                        min1_idx = i
                    elif mag < min2:
                        min2 = mag
                if mode == 1:
                    for i in range(d):
                        acc[i] = np.float32(0.0)
                    for j in range(d):
                        y = vals[j]
                        if j == 0:
                            for i in range(1, d):
                                acc[i] = y
                            continue
                        for i in range(d):
                            aux[i] = box_plus(acc[i], y)
                        if j == 1:
                            for i in range(2, d):
                                acc[i] = aux[i]
                            acc[0] = y
                        else:
                            for i in range(d):
                                if i != j:
                                    acc[i] = aux[i]
                    for i in range(d):
                        x = acc[i] * alpha
                        newm[i] = min(max(x, np.float32(-20.0)), np.float32(20.0))
                for i in range(d):
                    v = edge_var[lo + i]
                    if mode == 1:
                        new_msg = newm[i]
                    else:
                        self_sign = np.float32(1.0) if vals[i] >= np.float32(0.0) else np.float32(-1.0)
                        min_mag = min2 if i == min1_idx else min1
                        mm = alpha * min_mag - beta
                        new_msg = prod_sign * self_sign * (mm if mm > np.float32(0.0) else np.float32(0.0))
                    old = msgs[lo + i]
                    damped = c_old * old + c_new * new_msg
                    msgs[lo + i] = damped
                    total[v] += damped - old
            for i in range(N):
                hard[i] = 1 if total[i] < np.float32(0.0) else 0
            w = syndrome_weight(hard, edge_var, edge_lo)
            if w < min_syn:
                min_syn = w
                best_cw[:] = hard
                best_total[:] = total
            crc_calc = crc14(hard, 63)
            crc_rcvd = bits_to_int(hard, 63, 77)
            if w == 0 and crc_calc == crc_rcvd:
                return True, hard[:K].copy(), total_iters
            if crc_calc == crc_rcvd:
                reaccumulate(hard, table, ira)
                corr = correlation(ira, inp, prod)
                diff = 0
                for i in range(N):
                    diff += 1 if ira[i] != hard[i] else 0
                if corr > np.float32(0.0) and diff <= 12:
                    return True, hard[:K].copy(), total_iters
        if min_syn == 0 and crc14(best_cw, 63) == bits_to_int(best_cw, 63, 77):
            return True, best_cw[:K].copy(), total_iters
    if min_syn <= 14:
        ranked = np.argsort(np.abs(best_total[:63]), kind="mergesort")
        test = ranked[:14]
        cand = np.zeros(K, dtype=np.int64)
        cw = np.zeros(N, dtype=np.int64)
        best = np.zeros(N, dtype=np.int64)
        found = False
        max_corr = 0.0
        base = best_cw[:63].copy()
        for order in range(3):
            for i in range(14 if order > 0 else 1):
                for j in range(i + 1 if order == 2 else 0, 14 if order == 2 else 1):
                    for b in range(63):
                        cand[b] = base[b]
                    if order >= 1:
                        cand[test[i]] ^= 1
                    if order == 2:
                        cand[test[j]] ^= 1
                    crc = crc14(cand, 63)
                    for b in range(14):
                        cand[63 + b] = (crc >> (13 - b)) & 1
                    reaccumulate(cand, table, cw)
                    corr = np.float64(correlation(cw, inp, prod))
                    diff = 0
                    for q in range(N):
                        diff += 1 if cw[q] != best_cw[q] else 0
                    if corr > 20.0 and corr > max_corr and diff <= 16:
                        max_corr = corr
                        best[:] = cw
                        found = True
        if found:
            return True, best[:K].copy(), total_iters
    return False, best_cw[:K].copy(), total_iters


if __name__ == "__main__":
    d = sys.argv[1]
    llrs = np.fromfile(d + "/corpus.bin", dtype="<f4").reshape(-1, N)
    refs = [line.split("\t") for line in open(d + "/corpus_ref.tsv").read().splitlines()]
    t0 = time.perf_counter()
    decode(llrs[0], EDGE_VAR, EDGE_LO, TABLE, SCHED)
    print(f"numba first call (JIT compile or cache load): {time.perf_counter() - t0:.2f} s")
    same = [0, 0, 0]
    t_ok, t_fail = [], []
    for f in range(llrs.shape[0]):
        t0 = time.perf_counter()
        ok, info, iters = decode(llrs[f], EDGE_VAR, EDGE_LO, TABLE, SCHED)
        ms = (time.perf_counter() - t0) * 1000
        (t_ok if ok else t_fail).append(ms)
        bits = "".join(str(int(b)) for b in info)
        same[0] += (ok == (refs[f][0] == "1"))
        same[1] += (bits == refs[f][2])
        same[2] += (iters == int(refs[f][1]))
    for name, v in (("success", t_ok), ("failure", t_fail)):
        v = np.sort(np.array(v))
        print(f"NUMBA {name}: n={v.size} mean={v.mean():.3f}ms p50={np.median(v):.3f}ms "
              f"p99={v[int(0.99 * (v.size - 1))]:.3f}ms max={v.max():.3f}ms")
    print(f"NUMBA agreement: same_success={same[0]} same_info={same[1]} same_iters={same[2]} of {llrs.shape[0]}")
