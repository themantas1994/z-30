#!/usr/bin/env python3
"""
Pairs two per-frame outcome files (`z30 --benchmark <name> --per-frame` writes
`<name>.frames.jsonl`) frame by frame and reports the exact two-sided McNemar test.

    python research/paired_mcnemar.py <baseline.frames.jsonl> <candidate.frames.jsonl>
        [--bootstrap N --bootstrap-seed S] [--allow-dirty] [--json OUT]

Two commits run the same seeded frames, so the suite's frames can be paired - but only the
per-point counts were kept, and a count cannot say which frames changed (audit 2026-09-28
RES-01 / F-11). A frame is identified by (benchmark, point, frame index, station, seed); the
seed is the frame's generator seed, so a pair is the same audio on both sides.

It refuses (exit 2) rather than pair what is not the same set of frames: different benchmarks,
suite seeds, replicates, frames per point or instrument identities in the headers; a frame on
one side only; a frame recorded twice; the same frame under a different condition. A dirty
build on either side is refused unless --allow-dirty, and is then reported as such.

Output, per point and pooled over all points: n pairs, successes on each side, the discordant
counts b (baseline only) and c (candidate only), and the exact two-sided McNemar p-value
(binomial, p = 1/2, over b + c). Across points the Holm-adjusted p-values are given (the
per-point acceptance statistic of docs/research-process.md section 2a). With --bootstrap, for
each rate curve that has a numeric x (awgn, fading: SNR), the 50% crossing of each side and a
paired bootstrap percentile 95% interval of the crossing delta (candidate - baseline): frames
are resampled with replacement within each point, the same draw for both sides. The bootstrap
seed must be fixed before the run (pre-registered); it is printed with the result.

Standard library only. Exit status 0 when the pairing succeeded (whatever it found), 2 refused.
"""

import json
import math
import random
import sys
from fractions import Fraction


class PairingError(Exception):
    pass


def mcnemar_exact(b, c):
    """Exact two-sided McNemar p-value: 2 * P(X <= min(b, c)), X ~ Bin(b + c, 1/2), capped at 1."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = Fraction(sum(math.comb(n, i) for i in range(k + 1)), 2 ** n)
    return float(min(Fraction(1), 2 * tail))


def holm(pvalues):
    """Holm step-down adjusted p-values, in the input order."""
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def read_frames(path):
    header, frames = None, {}
    with open(path, "r", encoding="utf-8") as handle:
        for n, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError as e:
                raise PairingError(f"{path}:{n}: not JSON ({e})")
            if r.get("kind") == "header":
                if header is not None:
                    raise PairingError(f"{path}:{n}: a second header")
                header = r
                continue
            key = (r.get("benchmark"), r.get("point"), r.get("frame"), r.get("station"), r.get("seed"))
            if None in key[:3] or key[4] is None:
                raise PairingError(f"{path}:{n}: a frame record without benchmark/point/frame/seed")
            if key in frames:
                raise PairingError(f"{path}:{n}: frame {key} recorded twice")
            # A boolean, nothing else: bool("false") is True, and a missing field was a traceback
            # (research-engineer review finding 6).
            if not isinstance(r.get("correct"), bool):
                raise PairingError(f"{path}:{n}: frame {key} has no boolean 'correct' ({r.get('correct')!r})")
            frames[key] = r
    if header is None:
        raise PairingError(f"{path}: no header line (was it written by z30 --per-frame?)")
    return header, frames


def check_counts(path, header, frames):
    """Every point holds the frames the header declares: two equally truncated files used to pair
    without complaint (research-engineer review finding 6). Checked after the headers and frame
    sets, whose own refusals say more."""
    want = header.get("frames_per_point")
    if isinstance(want, int):
        per_point = {}
        for k in frames:
            per_point.setdefault(k[1], set()).add(k[2])
        short = {p: len(s) for p, s in per_point.items() if len(s) != want}
        if short:
            raise PairingError(f"{path}: the header declares {want} frames per point, but points {short} hold other counts")


def check_headers(ha, hb, allow_dirty):
    for key in ("benchmark", "suite_seed", "replicate", "frames_per_point", "instrument_sha256"):
        if ha.get(key) != hb.get(key):
            raise PairingError(f"headers differ in {key}: {ha.get(key)!r} vs {hb.get(key)!r}"
                               + (" (an instrument change needs its own proposal and a re-baselined baseline)" if key == "instrument_sha256" else ""))
    for side, h in (("baseline", ha), ("candidate", hb)):
        if h.get("status") == "dirty" and not allow_dirty:
            raise PairingError(f"the {side} was built from a dirty tree ({h.get('git_commit')}); pass --allow-dirty to pair it anyway")


def pair(fa, fb):
    only_a, only_b = set(fa) - set(fb), set(fb) - set(fa)
    if only_a or only_b:
        raise PairingError(f"the frame sets differ: {len(only_a)} only in the baseline, {len(only_b)} only in the candidate "
                           f"(e.g. {sorted(only_a or only_b, key=str)[0]})")
    for k in fa:
        for field in ("condition", "x", "curve"):
            if fa[k].get(field) != fb[k].get(field):
                raise PairingError(f"frame {k}: {field} differs ({fa[k].get(field)!r} vs {fb[k].get(field)!r})")
    points = {}
    for k in sorted(fa, key=lambda k: (k[1], k[2], k[3] if k[3] is not None else -1)):
        points.setdefault(k[1], []).append((bool(fa[k]["correct"]), bool(fb[k]["correct"]), fa[k]))
    return points


def summarise(rows):
    a = sum(r[0] for r in rows)
    b_ = sum(r[1] for r in rows)
    b = sum(1 for r in rows if r[0] and not r[1])
    c = sum(1 for r in rows if r[1] and not r[0])
    return {"n": len(rows), "baseline_correct": a, "candidate_correct": b_, "b_baseline_only": b, "c_candidate_only": c,
            "mcnemar_exact_p": mcnemar_exact(b, c)}


def crossing(curve, target=50.0):
    """Linear interpolation of where (x, k, n) points cross `target` percent, as the suite does."""
    for (x0, k0, n0), (x1, k1, n1) in zip(curve, curve[1:]):
        y0, y1 = 100.0 * k0 / n0, 100.0 * k1 / n1
        if (y0 - target) * (y1 - target) <= 0 and y0 != y1:
            return x0 + (target - y0) * (x1 - x0) / (y1 - y0)
    return None


def bootstrap(points, draws, seed):
    """Paired bootstrap of the 50% crossing delta, per curve. Returns {curve: {...}}."""
    curves = {}
    for p, rows in points.items():
        rec = rows[0][2]
        if not isinstance(rec.get("x"), (int, float)):
            continue
        curves.setdefault(rec.get("curve") or rec["benchmark"], []).append((rec["x"], rows))
    rng = random.Random(seed)
    out = {}
    for name, pts in curves.items():
        pts.sort(key=lambda t: t[0])

        def cross(sample):
            ca = crossing([(x, sum(r[0] for r in rs), len(rs)) for x, rs in sample])
            cb = crossing([(x, sum(r[1] for r in rs), len(rs)) for x, rs in sample])
            return ca, cb

        base, cand = cross(pts)
        deltas, undefined = [], 0
        for _ in range(draws):
            sample = [(x, [rs[rng.randrange(len(rs))] for _ in rs]) for x, rs in pts]
            ca, cb = cross(sample)
            if ca is None or cb is None:
                undefined += 1
            else:
                deltas.append(cb - ca)
        deltas.sort()
        res = {"baseline_crossing_50": base, "candidate_crossing_50": cand,
               "delta": None if base is None or cand is None else cand - base,
               "draws": draws, "seed": seed, "undefined_draws": undefined}
        # A percentile interval is reported only when (almost) every draw brackets 50% on both
        # sides; otherwise the interval would describe a conditional distribution.
        if deltas and undefined <= 0.025 * draws:
            res["delta_95"] = [deltas[int(0.025 * (len(deltas) - 1))], deltas[int(math.ceil(0.975 * (len(deltas) - 1)))]]
        else:
            res["delta_95"] = None
        out[name] = res
    return out


KNOWN_FLAGS = ("--bootstrap", "--bootstrap-seed", "--json", "--allow-dirty")


def main(argv):
    # An unknown or misspelt flag (`--bootstrap=2000`) used to be ignored silently.
    unknown = [a for a in argv if a.startswith("--") and a not in KNOWN_FLAGS]
    if unknown:
        print(f"paired_mcnemar.py: unknown option {unknown[0]} (options: {', '.join(KNOWN_FLAGS)})", file=sys.stderr)
        return 2
    args = [a for a in argv if not a.startswith("--")]
    opt = {}
    for flag in ("--bootstrap", "--bootstrap-seed", "--json"):
        if flag in argv:
            i = argv.index(flag)
            if i + 1 >= len(argv) or argv[i + 1].startswith("--"):
                print(f"paired_mcnemar.py: {flag} needs a value", file=sys.stderr)
                return 2
            opt[flag] = argv[i + 1]
            args.remove(argv[i + 1])
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    if "--bootstrap" in opt and "--bootstrap-seed" not in opt:
        print("paired_mcnemar.py: --bootstrap needs a pre-registered --bootstrap-seed", file=sys.stderr)
        return 2
    try:
        ha, fa = read_frames(args[0])
        hb, fb = read_frames(args[1])
        check_headers(ha, hb, "--allow-dirty" in argv)
        points = pair(fa, fb)
        check_counts(args[0], ha, fa)
    except (PairingError, OSError) as e:
        print(f"paired_mcnemar.py: refused: {e}", file=sys.stderr)
        return 2
    per_point = {p: summarise(rows) for p, rows in points.items()}
    adjusted = holm([v["mcnemar_exact_p"] for v in per_point.values()])
    for v, h in zip(per_point.values(), adjusted):
        v["holm_p"] = h
    pooled = summarise([r for rows in points.values() for r in rows])
    result = {"benchmark": ha["benchmark"], "baseline": {k: ha.get(k) for k in ("git_commit", "status")},
              "candidate": {k: hb.get(k) for k in ("git_commit", "status")}, "suite_seed": ha["suite_seed"],
              "replicate": ha.get("replicate"), "instrument_sha256": ha["instrument_sha256"],
              "points": per_point, "pooled": pooled}
    if "--bootstrap" in opt:
        result["crossing_bootstrap"] = bootstrap(points, int(opt["--bootstrap"]), int(opt["--bootstrap-seed"]))

    print(f"{ha['benchmark']}: baseline {ha.get('git_commit')} ({ha.get('status')}) vs candidate {hb.get('git_commit')} ({hb.get('status')}); "
          f"suite seed {ha['suite_seed']}, replicate {ha.get('replicate')}, instrument {str(ha['instrument_sha256'])[:12]}")
    for side, h in (("baseline", ha), ("candidate", hb)):
        if h.get("status") != "published":
            print(f"  NOTE: the {side} is {str(h.get('status')).upper()}, not a published run")
    print(f"{'point':>5} {'condition':>36} {'n':>6} {'base':>6} {'cand':>6} {'b':>5} {'c':>5} {'p (exact)':>10} {'Holm p':>10}")
    for p, v in per_point.items():
        cond = points[p][0][2].get("condition", "")
        print(f"{p:>5} {cond[:36]:>36} {v['n']:>6} {v['baseline_correct']:>6} {v['candidate_correct']:>6} "
              f"{v['b_baseline_only']:>5} {v['c_candidate_only']:>5} {v['mcnemar_exact_p']:>10.3g} {v['holm_p']:>10.3g}")
    print(f"pooled: n {pooled['n']}, b {pooled['b_baseline_only']} : c {pooled['c_candidate_only']}, exact two-sided p = {pooled['mcnemar_exact_p']:.3g}")
    for name, r in result.get("crossing_bootstrap", {}).items():
        ci = r["delta_95"]
        print(f"crossing {name}: baseline {r['baseline_crossing_50']}, candidate {r['candidate_crossing_50']}, delta {r['delta']}; "
              f"paired bootstrap 95% {'[%.3f, %.3f]' % tuple(ci) if ci else 'not defined'} ({r['draws']} draws, seed {r['seed']}, "
              f"{r['undefined_draws']} without a crossing)")
    if "--json" in opt:
        with open(opt["--json"], "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
