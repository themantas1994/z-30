"""
Callsign and grid validation in the Python setup wizard, driven by the SAME vectors the
TypeScript side asserts.

Why this file exists: `SettingsManager.validate_callsign` used to carry a looser pattern than
`isValidCallsign()` in `src/dsp/bandPlan.ts`, which is what the browser transmit gate actually
enforces. Three implementations agreed with each other and disagreed with the only one that
decides whether a station may key up, so the wizard blessed callsigns (`W1`, `K1A2`) that the
gate refuses at slot start, and rejected one (`DL/W1AW`) that it permits. A setup wizard that
tells an operator their station is ready, for a station that cannot transmit, is worse than no
wizard.

The vectors live in `tests/vectors/callsign_vectors.json`, in the spirit of
`tests/vectors/crc14_vectors.json`: one file, both languages, no way to fix one side only.
"""

import json
import os
import re

import pytest

from z30_dsp.station_settings import SettingsManager

VECTOR_PATH = os.path.join(os.path.dirname(__file__), "vectors", "callsign_vectors.json")

with open(VECTOR_PATH, "r", encoding="utf-8") as handle:
    VECTORS = json.load(handle)


def _accepts(call):
    """True if the wizard would accept this callsign."""
    ok, _msg = SettingsManager.validate_callsign(call)
    return ok


@pytest.mark.parametrize(
    "call,why",
    [(entry["call"], entry["why"]) for entry in VECTORS["valid"]],
)
def test_wizard_accepts_valid_callsigns(call, why):
    assert _accepts(call), f"wizard rejected {call!r}, which the transmit gate accepts ({why})"


@pytest.mark.parametrize(
    "call,why",
    [(entry["call"], entry["why"]) for entry in VECTORS["invalid"]],
)
def test_wizard_rejects_invalid_callsigns(call, why):
    assert not _accepts(call), f"wizard accepted {call!r}, which the transmit gate refuses ({why})"


def test_wizard_pattern_matches_the_shared_vector_file():
    """
    The wizard's compiled pattern must BE the shared pattern.

    Asserting the behaviour above is the real guard, but this catches the case where someone
    edits the regex and adjusts the vectors to match, rather than the other way round.
    """
    assert SettingsManager.CALLSIGN_REGEX.pattern == VECTORS["pattern"]


def test_the_three_measured_divergences_are_fixed():
    """
    The exact three cases the UI audit measured, named so a regression says which one broke.
    """
    assert _accepts("DL/W1AW"), "portable prefixes are real and the transmit gate permits them"
    assert not _accepts("W1"), "a callsign needs a suffix"
    assert not _accepts("K1A2"), "a suffix must be letters"


def test_callsign_validation_is_case_insensitive_and_trims():
    assert _accepts("  w1aw  ")


@pytest.mark.parametrize("grid", ["FN31", "FN31pr", "JO65", "AA00", "RR99"])
def test_wizard_accepts_valid_grids(grid):
    ok, _msg = SettingsManager.validate_grid(grid)
    assert ok


@pytest.mark.parametrize("grid", ["", "FN", "FN3", "FN311", "SS31", "FN31ZZ", "1N31"])
def test_wizard_rejects_invalid_grids(grid):
    ok, _msg = SettingsManager.validate_grid(grid)
    assert not ok


def test_grid_pattern_agrees_with_the_typescript_one():
    """
    src/dsp/gridSquare.ts uses ^[A-R]{2}[0-9]{2}([A-X]{2})?$ with a 4-or-6 length rule. The
    Python side must not be looser, or the wizard and the app disagree about the same locator.
    """
    ts_pattern = re.compile(r"^[A-R]{2}[0-9]{2}([A-X]{2})?$", re.IGNORECASE)
    for grid in ["FN31", "FN31PR", "JO65", "SS31", "FN31ZZ", "FN3", "FN311"]:
        ts_ok = bool(ts_pattern.match(grid)) and len(grid) in (4, 6)
        py_ok, _msg = SettingsManager.validate_grid(grid)
        assert py_ok == ts_ok, f"{grid!r}: python={py_ok} typescript={ts_ok}"
