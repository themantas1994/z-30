#!/usr/bin/env python3
"""
Paired comparison: the frozen oracle receiver (z30_dsp) against the vNext production receiver
(z30.Receiver.decode_slot, the Rust code that ships), on IDENTICAL audio.

    pip install maturin && (cd crates/z30-py && maturin build --release) && pip install target/wheels/z30-*.whl
    python research/paired_receiver.py --min-snr -28 --max-snr -17 --frames 200 --workers 4 --out results.json

Every frame comes from the oracle benchmark's own producer (`benchmark._prepare_frame`) with
the oracle's generator, seed and sweep order, so the oracle arm reproduces the published
`--mode realistic` table frame for frame (the harness checks that against the published counts
when asked to with --expect-published). Each buffer is then decoded by both receivers:

  * oracle: `benchmark.decode_prepared_frame` - acquisition in a +-12 Hz / +-0.55 s window
    around the known nominal carrier and slot timing, the reference demodulator and decoder;
  * vNext: the 27 s slot window [slot - 1.5 s, slot + 25.5 s] cut from the same buffer and
    handed to `decode_slot` with its defaults - whole-band (200-2800 Hz), full +-1.5 s DT
    search, multi-candidate, drift search, SIC. It is told nothing the oracle was told.

A frame is a success for an arm when that arm produces a CRC-valid decode carrying the
transmitted payload; any other CRC-valid decode is a false decode and is counted separately.

The comparison is paired, so it reports the discordant frames and the exact two-sided McNemar
p-value, the project's standard (AGENTS.md section 5), together with each arm's Wilson
intervals and crossings.
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from multiprocessing import Pool

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ.setdefault("RAYON_NUM_THREADS", "1")

import numpy as np  # noqa: E402

from z30_dsp.benchmark import (  # noqa: E402
    DEFAULT_BENCHMARK_SEED,
    PUBLISHABLE_FRAMES_PER_POINT,
    _prepare_frame,
    decode_prepared_frame,
    decode_threshold_interval_db,
    mcnemar_exact_p,
    wilson_interval,
)
from z30_dsp.channel import ChannelImpairments  # noqa: E402
from z30_dsp.ldpc import LDPC_MAX_ITERATIONS, Z30LdpcCodec  # noqa: E402
from z30_dsp.modem import Z30Config, Z30Modulator  # noqa: E402

FS = 6000
PAD_SEC = 3.0  # channel.apply_time_offset's guard padding: the nominal frame start
SLOT_LO = int((PAD_SEC - 1.5) * FS)
SLOT_HI = int((PAD_SEC + 25.5) * FS)

_W = {}


def _init(run_oracle, rx_kwargs):
    import z30

    _W["cfg"] = Z30Config(sample_rate_hz=FS)
    _W["codec"] = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)
    _W["rx"] = z30.Receiver()
    _W["oracle"] = run_oracle
    _W["rx_kwargs"] = rx_kwargs


def _decode(job):
    payload = "".join(str(int(b)) for b in job.payload_63)
    out = {"index": job.index}
    if _W["oracle"]:
        o = decode_prepared_frame(job, _W["cfg"], _W["codec"])
        out["oracle"] = bool(o.success)
        out["oracle_false"] = bool(o.false_decode)
    window = np.asarray(job.noisy_wave[SLOT_LO:SLOT_HI], dtype="<f4")
    t0 = time.perf_counter()
    rep = _W["rx"].decode_slot(window.tobytes(), **_W["rx_kwargs"])
    out["vnext_ms"] = (time.perf_counter() - t0) * 1000.0
    hits = [d for d in rep["decodes"] if d["payload"] == payload]
    out["vnext"] = bool(hits)
    out["vnext_false"] = sum(1 for d in rep["decodes"] if d["payload"] != payload)
    out["vnext_decodes"] = len(rep["decodes"])
    return out


def _git():
    try:
        return subprocess.check_output(["git", "-C", ROOT, "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:  # noqa: BLE001 - provenance is best effort, never fatal
        return "unknown"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--min-snr", type=float, default=-28.0)
    ap.add_argument("--max-snr", type=float, default=-17.0)
    ap.add_argument("--step", type=float, default=1.0)
    ap.add_argument("--frames", type=int, default=PUBLISHABLE_FRAMES_PER_POINT)
    ap.add_argument("--seed", type=int, default=DEFAULT_BENCHMARK_SEED)
    ap.add_argument("--fading", default="none")
    ap.add_argument("--freq-offset", type=float, default=5.0)
    ap.add_argument("--time-offset", type=float, default=0.5)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--vnext-only", action="store_true", help="skip the (slow) oracle arm")
    ap.add_argument("--rx", default="{}", help="JSON of decode_slot keyword overrides")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    import z30

    rx_kwargs = json.loads(args.rx)
    rng = np.random.default_rng(args.seed)
    impairments = ChannelImpairments(max_freq_offset_hz=args.freq_offset, max_time_offset_sec=args.time_offset, fading=args.fading)
    cfg = Z30Config(sample_rate_hz=FS)
    modulator = Z30Modulator(cfg)
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)
    snrs = np.arange(args.min_snr, args.max_snr + 1e-4, args.step)
    run_oracle = not args.vnext_only

    print(f"paired receiver comparison | seed {args.seed} | {args.frames} frames/point | fading {args.fading} | "
          f"carrier +-{args.freq_offset} Hz | timing +-{args.time_offset} s | vNext {z30.version()} @ {_git()}")
    if args.frames < PUBLISHABLE_FRAMES_PER_POINT:
        print(f"EXPLORATORY RUN: below the {PUBLISHABLE_FRAMES_PER_POINT} frames/point a published figure needs.")
    rows = []
    t_start = time.time()
    with Pool(args.workers, initializer=_init, initargs=(run_oracle, rx_kwargs)) as pool:
        for snr in snrs:
            # Sequential, in the oracle's order: this is the only place the PRNG is consumed.
            jobs = [_prepare_frame(f, float(snr), codec, cfg, modulator, rng, "realistic", impairments, args.time_offset)[0]
                    for f in range(args.frames)]
            res = sorted(pool.map(_decode, jobs, chunksize=4), key=lambda r: r["index"])
            v = sum(r["vnext"] for r in res)
            row = {"snr_db": float(snr), "frames": args.frames, "vnext": v,
                   "vnext_false": sum(r["vnext_false"] for r in res),
                   "vnext_ms_mean": float(np.mean([r["vnext_ms"] for r in res])),
                   "vnext_ms_max": float(np.max([r["vnext_ms"] for r in res]))}
            if run_oracle:
                o = sum(r["oracle"] for r in res)
                row.update({"oracle": o, "oracle_false": sum(r["oracle_false"] for r in res),
                            "only_oracle": sum(r["oracle"] and not r["vnext"] for r in res),
                            "only_vnext": sum(r["vnext"] and not r["oracle"] for r in res)})
            rows.append(row)
            vlo, vhi = wilson_interval(v, args.frames)
            line = f"{snr:+6.1f} dB  vNext {v:4d}/{args.frames} [{100*vlo:5.1f}-{100*vhi:5.1f}%]"
            if run_oracle:
                olo, ohi = wilson_interval(row["oracle"], args.frames)
                line += (f"  oracle {row['oracle']:4d} [{100*olo:5.1f}-{100*ohi:5.1f}%]"
                         f"  discordant vNext-only {row['only_vnext']:3d} oracle-only {row['only_oracle']:3d}")
            line += f"  false v/o {row['vnext_false']}/{row.get('oracle_false', '-')}  {row['vnext_ms_mean']:.0f} ms/slot (1 thread)"
            print(line, flush=True)

    def curve(key):
        return [{"snr_db": r["snr_db"], "successes": r[key], "total_frames": r["frames"],
                 "decode_pct": 100.0 * r[key] / r["frames"]} for r in rows]

    summary = {"seed": args.seed, "frames_per_point": args.frames, "fading": args.fading, "git": _git(),
               "z30_version": z30.version(), "host": platform.processor() or platform.machine(),
               "elapsed_sec": time.time() - t_start, "rows": rows, "rx_overrides": rx_kwargs}
    for key in (["vnext", "oracle"] if run_oracle else ["vnext"]):
        for level in (50.0, 90.0):
            lo, pt, hi = decode_threshold_interval_db(curve(key), level)
            summary[f"{key}_{int(level)}"] = [lo, pt, hi]
            fmt = lambda x: "n/a" if x is None else f"{x:+.2f}"  # noqa: E731
            print(f"{key:>6} {level:.0f}% crossing: {fmt(pt)} dB [{fmt(lo)}, {fmt(hi)}]")
    if run_oracle:
        a = sum(r["only_vnext"] for r in rows)
        b = sum(r["only_oracle"] for r in rows)
        p = mcnemar_exact_p(a, b)
        summary.update({"only_vnext": a, "only_oracle": b, "mcnemar_p": p})
        print(f"pooled discordant pairs: vNext-only {a}, oracle-only {b}; exact two-sided McNemar p = {p:.3g}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(summary, f, indent=1)


if __name__ == "__main__":
    main()
