#!/usr/bin/env python3
"""
Compares two suite result directories benchmark by benchmark: are the measurements identical?

    python research/compare_results.py <baseline dir> <candidate dir> [benchmark ...]
        [--legacy-provenance] [--reproduction]

Latency (wall clock, machine-load dependent), provenance, the seed description, definitions and
other descriptive text are not measurements and are not compared. Everything else - every
count, rate, interval, crossing and error statistic - must match exactly for IDENTICAL.

It first refuses (exit 2) to compare what is not comparable, instead of reporting only the
counts that happen to differ (audit 2026-09-28 RES-10 / F-38; the earlier script, kept as
evidence at audit/2026-09-24-corrective-remediation/evidence/scripts/compare_results.py, read
only the candidate's file list and ignored the seed):

- a benchmark missing from either side (all ten are required unless benchmarks are named);
- a different suite seed or replicate, frames per point, status (published, replicate,
  exploratory, dirty, not_the_published_run) or build profile;
- a different instrument identity (the harness, channel models and frame encoder and modulator
  the binary was built with). Results written before the instrument was recorded carry none, and are compared
  only with --legacy-provenance, under a banner saying the instrument could not be checked.

--reproduction: the candidate is an independent rerun of the baseline's published run (QA,
docs/research-process.md §3). Such a rerun is written with --out, so the suite labels it
`not_the_published_run`; this flag accepts exactly that status pair (baseline `published`,
candidate `not_the_published_run`) and nothing else. Seed, replicate, frames, build profile and
instrument are still checked, a dirty or exploratory candidate is still refused, and every
measurement must still match. Without it the tool could not certify a reproduction at all
(post-remediation QA finding QA-A).

A label that changed while the measurements did not (false.json's 16-FSK row is now labelled
-3 dB, the level it always ran at: DSP-07) is reported as a note, not as a difference. A field
only the candidate has is a schema addition and is reported as a note; a measured field the
candidate lost is a difference.

Exit status: 0 all IDENTICAL, 1 some DIFFERENT, 2 refused.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from suite_results import (BENCHMARKS, DESCRIPTIVE, ResultError, instrument_of, load,  # noqa: E402
                           replicate_of, seed_of, size_of, status_of)


def strip(v):
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k not in DESCRIPTIVE and not k.endswith("_ms")}
    if isinstance(v, list):
        return [strip(x) for x in v]
    return v


def diff(a, b, path="", notes=None):
    """Differences between baseline `a` and candidate `b`. Labels and fields only the candidate
    has go to `notes`."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            p = f"{path}.{k}"
            if k not in a:
                notes.append(f"{p}: added in the candidate (not compared)")
            elif k not in b:
                out.append(f"{p}: missing from the candidate")
            elif k == "label" and a[k] != b[k] and isinstance(a[k], str):
                notes.append(f"{p}: label {a[k]!r} -> {b[k]!r}")
            else:
                out += diff(a[k], b[k], p, notes)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f"{path}[{i}]", notes)
    elif type(a) is not type(b) or a != b:
        out.append(f"{path}: {a!r} != {b!r}")
    return out


REPRODUCTION_STATUSES = ("published", "not_the_published_run")


def comparable(name, a, b, legacy, reproduction=False):
    """Raises ResultError unless the two results measured the same thing the same way. Returns
    notes to print."""
    notes = []
    # Seed, replicate and size first: a file written before `status` existed has its status
    # derived from them, so a seed difference must be reported as one, not as a status.
    for what, get in [("suite seed", seed_of), ("replicate", replicate_of), ("frames per point", size_of)]:
        va, vb = get(a), get(b)
        if va != vb:
            raise ResultError(f"{name}: {what} differs ({va!r} vs {vb!r})")
    sa, sb = status_of(a), status_of(b)
    if reproduction:
        if (sa, sb) != REPRODUCTION_STATUSES:
            raise ResultError(f"{name}: --reproduction compares a published result with a rerun of it "
                              f"(status {REPRODUCTION_STATUSES[0]!r} vs {REPRODUCTION_STATUSES[1]!r}), not {sa!r} vs {sb!r}")
        notes.append(f"{name}: REPRODUCTION of the published run (status {sa!r} vs {sb!r} accepted)")
    elif sa != sb:
        raise ResultError(f"{name}: status differs ({sa!r} vs {sb!r})")
    checks = [("build profile", lambda d: d["provenance"].get("build_profile"))]
    for what, get in checks:
        va, vb = get(a), get(b)
        if va != vb:
            raise ResultError(f"{name}: {what} differs ({va!r} vs {vb!r})")
    ia, ib = instrument_of(a), instrument_of(b)
    if ia is None or ib is None:
        if not legacy:
            raise ResultError(f"{name}: instrument identity not recorded in the "
                              f"{'baseline' if ia is None else 'candidate'} (pass --legacy-provenance to compare files written before it was)")
        notes.append(f"{name}: INSTRUMENT NOT CHECKED (legacy provenance): the harness, channel models and frame encoder may differ")
    elif ia != ib:
        fa = a["provenance"]["instrument"].get("files", {})
        fb = b["provenance"]["instrument"].get("files", {})
        changed = sorted(k for k in set(fa) | set(fb) if fa.get(k) != fb.get(k))
        raise ResultError(f"{name}: instrument differs ({ia[:12]} vs {ib[:12]}; changed: {', '.join(changed) or 'channel dependencies'}): "
                          "an instrument change needs its own proposal and a re-baselined baseline")
    return notes


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    legacy = "--legacy-provenance" in sys.argv
    reproduction = "--reproduction" in sys.argv
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    old, new = args[0], args[1]
    names = args[2:] or BENCHMARKS
    try:
        pairs = []
        for n in names:
            if n not in BENCHMARKS:
                raise ResultError(f"unknown benchmark {n!r}")
            a, b = load(old, n), load(new, n)
            missing = [d for d, doc in ((old, a), (new, b)) if doc is None]
            if missing:
                raise ResultError(f"{n}: missing from {', '.join(missing)}")
            pairs.append((n, a, b, comparable(n, a, b, legacy, reproduction)))
    except (ResultError, OSError, KeyError) as e:
        print(f"compare_results.py: refused: {e}", file=sys.stderr)
        return 2
    if args[2:]:
        print(f"SUBSET: only {', '.join(names)} compared")
    worst = 0
    for n, a, b, notes in pairs:
        extra = []
        sa, sb = strip(a), strip(b)
        if reproduction:
            # The status pair was checked above; it is a label of the run, not a measurement.
            sa.pop("status", None)
            sb.pop("status", None)
        d = diff(sa, sb, notes=extra)
        print(f"{n}: {'IDENTICAL (every count, rate, interval, error statistic)' if not d else 'DIFFERENT, ' + str(len(d)) + ' fields'}")
        for x in d[:8]:
            print("   ", x)
        for x in notes + extra:
            print("    note:", x)
        worst = max(worst, 1 if d else 0)
    return worst


if __name__ == "__main__":
    sys.exit(main())
