"""
Reading `z30 --benchmark` result files, for the research scripts that summarise, compare and
pair them. Standard library only.

Every function here fails closed: a result that cannot be shown to be what it claims is an
error, never a silent skip. The summariser and comparison tool used to render or compare
whatever files happened to be present, so a directory missing a benchmark, or holding a
replicate in place of the published run, looked complete and ordinary (audit 2026-09-28
RES-04 / RES-10, F-14 / F-38).
"""

import json
import os

BENCHMARKS = ["awgn", "snr", "drift", "timing", "clock", "impair", "busy", "false", "sic", "fading"]
SUITE_SEED = 20260830

# Frames per point behind any sensitivity crossing (AGENTS.md section 5; crates/z30-cli/src/suite.rs
# CROSSING_MIN_FRAMES). The size each benchmark is published at, in its own unit (frames per
# point; slots per point for busy and false; trials per cell for sic), mirrors
# `suite::publishable_size`; below it a result is exploratory.
CROSSING_MIN_FRAMES = 200
PUBLISHABLE_SIZE = {
    "awgn": CROSSING_MIN_FRAMES, "fading": CROSSING_MIN_FRAMES,
    "drift": 200, "timing": 200, "clock": 200, "impair": 200,
    "snr": 100, "sic": 100, "busy": 50, "false": 400,
}
STATUSES = ("published", "replicate", "exploratory", "dirty", "not_the_published_run")

# Keys that describe rather than measure. They are not compared as measurements.
DESCRIPTIVE = {"latency_ms", "provenance", "seed", "definitions", "channel", "title", "doppler_definition",
               "doppler_fix", "ms", "status_reasons", "frames_policy", "not_the_published_run", "exploratory",
               "per_frame_file", "interferer_levels", "note", "not_tested"}


class ResultError(Exception):
    """A result, or a set of results, that cannot be used as asked. The message says why."""


def load(directory, name):
    """The parsed `<name>.json` in `directory`, or None if the file does not exist."""
    path = os.path.join(directory, name + ".json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        try:
            doc = json.load(handle)
        except json.JSONDecodeError as e:
            raise ResultError(f"{path}: not valid JSON ({e})")
    if not isinstance(doc, dict) or doc.get("benchmark") != name:
        raise ResultError(f"{path}: holds benchmark {doc.get('benchmark') if isinstance(doc, dict) else None!r}, not {name!r}")
    return doc


def size_of(doc):
    """Frames per point (slots for busy/false, trials per cell for sic)."""
    for key in ("frames_per_point", "slots_per_point", "trials_per_cell"):
        if key in doc:
            return doc[key]
    raise ResultError(f"{doc.get('benchmark')}: no frames_per_point / slots_per_point / trials_per_cell")


def commit_of(doc):
    p = doc.get("provenance")
    if not isinstance(p, dict) or not p.get("git_commit"):
        raise ResultError(f"{doc.get('benchmark')}: no provenance.git_commit")
    return p["git_commit"]


def is_clean_commit(label):
    return bool(label) and label != "unknown" and not label.endswith("-dirty")


def seed_of(doc):
    s = doc.get("seed")
    if not isinstance(s, dict) or "suite_seed" not in s:
        raise ResultError(f"{doc.get('benchmark')}: no seed.suite_seed")
    return s["suite_seed"]


def replicate_of(doc):
    return doc.get("seed", {}).get("replicate", 0)


def instrument_of(doc):
    """The instrument's sha256, or None for results written before it was recorded."""
    return (doc.get("provenance", {}).get("instrument") or {}).get("sha256")


def status_of(doc):
    """The result's status. Files written before `status` existed are classified from the
    markers they do carry, the stricter reading winning: a dirty commit, then too few frames,
    then a replicate or other non-published seed."""
    if "status" in doc:
        if doc["status"] not in STATUSES:
            raise ResultError(f"{doc.get('benchmark')}: unknown status {doc['status']!r}")
        return doc["status"]
    if not is_clean_commit(commit_of(doc)):
        return "dirty"
    if doc.get("exploratory") or size_of(doc) < PUBLISHABLE_SIZE.get(doc.get("benchmark"), 0):
        return "exploratory"
    if doc.get("not_the_published_run") or seed_of(doc) != SUITE_SEED:
        return "replicate" if replicate_of(doc) else "not_the_published_run"
    return "published"


def status_line(doc):
    """One line saying what a non-published result is and why."""
    st = status_of(doc)
    why = doc.get("status_reasons") or [doc.get("not_the_published_run") or doc.get("exploratory") or
                                        ("derived from the file's markers (written before results carried a status)")]
    return f"{doc['benchmark']}: {st.upper()} ({'; '.join(str(w) for w in why)})"


def check_set(docs, what):
    """All results of one run agree on the commit, seed, replicate, status, build profile and
    instrument. A directory mixing runs is refused rather than summarised as if it were one."""
    keys = {
        "git_commit": commit_of,
        "suite_seed": seed_of,
        "replicate": replicate_of,
        "status": status_of,
        "build_profile": lambda d: d["provenance"].get("build_profile"),
        "instrument": instrument_of,
    }
    for key, get in keys.items():
        values = {name: get(doc) for name, doc in docs.items()}
        if len(set(map(json.dumps, values.values()))) > 1:
            listing = ", ".join(f"{n}={v}" for n, v in values.items())
            raise ResultError(f"{what}: the results are not from one run: {key} differs ({listing})")


def load_set(directory, names=None, allow_partial=False):
    """Loads the named benchmarks (all ten by default). A missing one is an error unless
    `allow_partial`; with it, at least one must exist. Returns {name: doc}."""
    wanted = names or BENCHMARKS
    docs, missing = {}, []
    for n in wanted:
        if n not in BENCHMARKS:
            raise ResultError(f"unknown benchmark {n!r}")
        d = load(directory, n)
        if d is None:
            missing.append(n)
        else:
            docs[n] = d
    if missing and not allow_partial:
        raise ResultError(f"{directory}: missing {', '.join(missing)} (pass --partial to summarise only what is there, which the output then says)")
    if not docs:
        raise ResultError(f"{directory}: no result files")
    check_set(docs, directory)
    return docs, missing
