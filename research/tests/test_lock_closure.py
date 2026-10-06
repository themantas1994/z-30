"""lock_closure.py: unchanged closures pass (exit 0); a change inside a root's closure fails
(exit 1) and is named; a change outside every closure is reported and does not fail."""

import os
import subprocess
import sys

TOOL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lock_closure.py")

LOCK = """version = 4

[[package]]
name = "z30-cli"
version = "0.1.0"
dependencies = ["z30-dsp", "serde"]

[[package]]
name = "z30-dsp"
version = "0.1.0"
dependencies = ["rustfft"]

[[package]]
name = "rustfft"
version = "{rustfft}"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "unrelated"
version = "{unrelated}"
source = "registry+https://github.com/rust-lang/crates.io-index"
"""


def run(tmp_path, old, new):
    a, b = tmp_path / "old.lock", tmp_path / "new.lock"
    a.write_text(LOCK.format(**old))
    b.write_text(LOCK.format(**new))
    p = subprocess.run([sys.executable, TOOL, str(a), str(b)], capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def test_identical_closures_pass(tmp_path):
    code, out = run(tmp_path, {"rustfft": "6.4.1", "unrelated": "1.0.0"}, {"rustfft": "6.4.1", "unrelated": "1.0.0"})
    assert code == 0, out
    assert "z30-cli: closure IDENTICAL" in out and "z30-dsp: closure IDENTICAL" in out


def test_a_change_inside_the_receiver_closure_fails_and_is_named(tmp_path):
    code, out = run(tmp_path, {"rustfft": "6.4.1", "unrelated": "1.0.0"}, {"rustfft": "6.4.2", "unrelated": "1.0.0"})
    assert code == 1, out
    assert "closure DIFFERENT" in out and "+ rustfft 6.4.2" in out and "- rustfft 6.4.1" in out


def test_a_change_outside_every_closure_is_reported_and_passes(tmp_path):
    code, out = run(tmp_path, {"rustfft": "6.4.1", "unrelated": "1.0.0"}, {"rustfft": "6.4.1", "unrelated": "2.0.0"})
    assert code == 0, out
    assert "changed elsewhere" in out and "unrelated 2.0.0" in out
