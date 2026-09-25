#!/usr/bin/env python3
"""Compares two suite result directories benchmark by benchmark, ignoring only what is not a
measurement of the receiver: latency (wall-clock, machine-load dependent), provenance, the seed
description, definitions and descriptive text. Prints IDENTICAL or the first differences.
Usage: compare_results.py <old dir> <new dir> [benchmark...]"""
import json, os, sys

IGNORE = {"latency_ms", "provenance", "seed", "definitions", "channel", "title", "doppler_definition", "doppler_fix", "ms"}


def strip(v):
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k not in IGNORE and not k.endswith("_ms")}
    if isinstance(v, list):
        return [strip(x) for x in v]
    return v


def diff(a, b, path=""):
    out = []
    if type(a) != type(b):
        return [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            out += diff(a.get(k), b.get(k), f"{path}.{k}")
    elif isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f"{path}[{i}]")
    elif a != b:
        out.append(f"{path}: {a!r} != {b!r}")
    return out


old, new = sys.argv[1], sys.argv[2]
names = sys.argv[3:] or sorted(f[:-5] for f in os.listdir(new) if f.endswith(".json"))
for n in names:
    a, b = (json.load(open(os.path.join(d, n + ".json"))) for d in (old, new))
    d = diff(strip(a), strip(b))
    print(f"{n}: {'IDENTICAL (every count, rate, interval, error statistic)' if not d else 'DIFFERENT, ' + str(len(d)) + ' fields'}")
    for x in d[:8]:
        print("   ", x)
