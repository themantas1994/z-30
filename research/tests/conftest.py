"""Shared fixtures for the research tooling tests: `python -m pytest research/tests -q`
(standard library + pytest only). Result directories are synthetic and built in a temp dir; the
published directories are only read."""

import copy
import json
import os
import subprocess
import sys

import pytest

RESEARCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(RESEARCH)
sys.path.insert(0, RESEARCH)

from suite_results import BENCHMARKS, PUBLISHABLE_SIZE, SUITE_SEED  # noqa: E402

SIZE_KEY = {"busy": "slots_per_point", "false": "slots_per_point", "sic": "trials_per_cell"}


def minimal(name, commit="0123456789ab", seed=SUITE_SEED, replicate=0, frames=None, instrument="a" * 64, status=None, decoded=5):
    """A small, schema-shaped result for one benchmark."""
    frames = PUBLISHABLE_SIZE[name] if frames is None else frames
    doc = {
        "benchmark": name,
        "title": f"{name} (synthetic)",
        SIZE_KEY.get(name, "frames_per_point"): frames,
        "points": [{"label": "p0", "param": 0, "decoded": decoded, "frames": frames, "latency_ms": {"p50": 1.0}}],
        "provenance": {"git_commit": commit, "build_profile": "release", "rustc": "rustc 1.95.0", "target": "x86_64"},
        "seed": {"suite_seed": seed, "replicate": replicate},
    }
    if instrument is not None:
        doc["provenance"]["instrument"] = {"sha256": instrument, "files": {"crates/z30-cli/src/suite.rs": instrument}}
    if status is not None:
        doc["status"] = status
    return doc


def write_dir(path, docs):
    os.makedirs(path, exist_ok=True)
    for name, doc in docs.items():
        with open(os.path.join(path, name + ".json"), "w", encoding="utf-8") as h:
            json.dump(doc, h)
    return str(path)


@pytest.fixture
def suite_dir(tmp_path):
    """Builds a directory of all ten benchmarks, each optionally modified."""
    def make(sub="run", **kw):
        return write_dir(tmp_path / sub, {n: minimal(n, **kw) for n in BENCHMARKS})
    return make


def run(script, *args):
    """Runs a research script; returns (exit code, stdout, stderr)."""
    p = subprocess.run([sys.executable, os.path.join(RESEARCH, script), *map(str, args)], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def published_copy(tmp_path, sub="copy"):
    """A copy of the published 672cef9b3cdb results to mutate."""
    src = os.path.join(REPO, "research", "results", "672cef9b3cdb")
    docs = {}
    for n in BENCHMARKS:
        with open(os.path.join(src, n + ".json"), encoding="utf-8") as h:
            docs[n] = json.load(h)
    return docs, lambda d, s=sub: write_dir(tmp_path / s, copy.deepcopy(d))
