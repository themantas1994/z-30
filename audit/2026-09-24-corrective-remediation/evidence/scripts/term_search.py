#!/usr/bin/env python3
"""Lists every occurrence of the audit's suspicious terms in PRODUCTION Rust code: crates/*/src,
with `#[cfg(test)] mod ...` blocks (to the end of the file, the repository's convention) removed.
Usage: python3 term_search.py <repo root>  -> prints `term<TAB>file:line<TAB>code`."""
import os, re, sys

TERMS = ["W1AW", "FN31", r"-16\b", r"14[._]?076", "N0CALL", "NOCAL", "fake", "simulat", "synthetic", "mock", "dummy",
         "placeholder", "hardcod", "confidence", "accuracy", "sensitivity", "expected", "golden", r"unwrap_or\(0", "unwrap_or_default",
         r"Doppler|doppler", r"\bsnr\b|SNR", "benchmark"]
root = sys.argv[1]
for dirpath, _, files in os.walk(os.path.join(root, "crates")):
    if os.sep + "src" not in dirpath:
        continue
    for f in sorted(files):
        if not f.endswith(".rs"):
            continue
        path = os.path.join(dirpath, f)
        lines = open(path, encoding="utf-8").read().split("\n")
        end = len(lines)
        for i, l in enumerate(lines):
            if l.strip() == "#[cfg(test)]" and i + 1 < len(lines) and re.match(r"\s*mod \w+", lines[i + 1]):
                end = i
                break
        for i, l in enumerate(lines[:end]):
            for t in TERMS:
                if re.search(t, l, re.IGNORECASE if t.islower() else 0):
                    print(f"{t}\t{os.path.relpath(path, root)}:{i + 1}\t{l.strip()[:150]}")
