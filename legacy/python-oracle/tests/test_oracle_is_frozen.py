"""
The oracle is frozen: its sources may change only deliberately.

The golden vectors in fixtures/golden/ are generated from this package, and vNext's Rust
implementation is tested bit-for-bit against them. An edit here that nobody meant would move
the reference the production receiver is checked against. So every oracle source file is pinned
by hash in FROZEN.sha256, and changing one means changing that file too, in the same commit, with
the reason in the commit message - after `python reference/golden/generate.py --check` shows
whether the golden vectors moved (if they did, that is a protocol change, see SPEC.md).

The last deliberate change: channel.py, 2026-09-24, Watterson taps normalised to unit ensemble
power instead of per realisation (audit H-10). No golden vector depends on the fading model.
"""

import hashlib
import os

ORACLE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _manifest():
    with open(os.path.join(ORACLE_ROOT, "FROZEN.sha256"), "r", encoding="utf-8") as handle:
        return dict(reversed(line.split()) for line in handle if line.strip())


def test_every_oracle_source_matches_its_pinned_hash():
    pinned = _manifest()
    package = os.path.join(ORACLE_ROOT, "z30_dsp")
    present = sorted(name for name in os.listdir(package) if name.endswith(".py"))
    assert present == sorted(pinned), "oracle files added or removed without updating FROZEN.sha256"
    for name in present:
        with open(os.path.join(package, name), "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
        assert digest == pinned[name], (
            f"{name} changed. The oracle is frozen: if the change is deliberate, update "
            "FROZEN.sha256 in the same commit and say why."
        )


def test_the_oracle_has_no_application_entry_points():
    # It is a reference, not a program an operator runs: no console scripts, no server, no
    # audio device, no transmitter.
    with open(os.path.join(ORACLE_ROOT, "pyproject.toml"), "r", encoding="utf-8") as handle:
        assert "[project.scripts]" not in handle.read()
    package = os.path.join(ORACLE_ROOT, "z30_dsp")
    for name in os.listdir(package):
        if name.endswith(".py"):
            with open(os.path.join(package, name), "r", encoding="utf-8") as handle:
                source = handle.read()
            for forbidden in ("import sounddevice", "import serial", "http.server", "import requests"):
                assert forbidden not in source, f"{name} imports {forbidden!r}: the oracle does no I/O"
