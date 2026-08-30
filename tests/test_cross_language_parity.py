"""
Cross-language parity between the Python and TypeScript codecs.

z-30 is a two-language protocol project: the Python suite and the browser app must be able to
decode each other's frames. Drift between two implementations of the same codec is the classic
way that fails, and it fails silently - both halves keep working perfectly on their own.

These tests compare the artefacts that have to be byte-identical:
  * the 139-row LDPC connection table,
  * the CRC-14 register constant and initial value,
  * the modem's GFSK shaping constants,
  * and the shared known-answer CRC vectors.

`tests/crc14.test.mjs` runs the same vectors through the actual TypeScript implementation; this
file checks the constants without needing a JavaScript runtime, so a Python-only environment
still catches a drifted table.
"""

import json
import os
import re

import numpy as np
import pytest

from z30_dsp.ldpc import Z30LdpcCodec, Z30_CHECK_TO_INFO
from z30_dsp.modem import Z30Config

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TS_CONSTANTS = os.path.join(REPO_ROOT, "src", "dsp", "z30Constants.ts")
TS_CODEC = os.path.join(REPO_ROOT, "src", "dsp", "ldpcCodec.ts")
TS_WAVEFORM = os.path.join(REPO_ROOT, "src", "dsp", "z30Waveform.ts")
VECTORS = os.path.join(os.path.dirname(__file__), "vectors", "crc14_vectors.json")


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def parse_ts_check_table() -> list:
    """Extracts Z30_CHECK_TO_INFO from the TypeScript source as a list of lists of ints."""
    source = read(TS_CONSTANTS)
    match = re.search(r"export const Z30_CHECK_TO_INFO:\s*number\[\]\[\]\s*=\s*\[(.*?)\n\];", source, re.S)
    assert match, "Z30_CHECK_TO_INFO not found in src/dsp/z30Constants.ts"
    body = match.group(1)
    return [
        [int(n) for n in row.split(",")]
        for row in re.findall(r"\[([0-9,\s]+)\]", body)
    ]


def test_connection_tables_are_identical():
    ts_table = parse_ts_check_table()
    assert len(ts_table) == len(Z30_CHECK_TO_INFO), (
        f"TypeScript has {len(ts_table)} checks, Python has {len(Z30_CHECK_TO_INFO)}"
    )
    for idx, (ts_row, py_row) in enumerate(zip(ts_table, Z30_CHECK_TO_INFO)):
        assert ts_row == list(py_row), f"connection table row {idx} differs: TS {ts_row} vs Python {py_row}"


def test_crc_constants_match():
    ts_source = read(TS_CODEC)
    assert re.search(r"const\s+poly\s*=\s*0x2443\b", ts_source), "TypeScript CRC polynomial constant changed"
    assert re.search(r"let\s+crc\s*=\s*0x2757\b", ts_source), "TypeScript CRC initial value changed"

    py_source = read(os.path.join(REPO_ROOT, "z30_dsp", "ldpc.py"))
    assert re.search(r"poly\s*=\s*0x2443\b", py_source)
    assert re.search(r"crc\s*=\s*0x2757\b", py_source)


def test_waveform_shaping_constants_match():
    """
    The two transmitters must emit the same signal. A mismatch in the GFSK bandwidth-time
    product would put a measurably different spectrum on the air depending on which half of the
    app the operator happened to transmit from.
    """
    ts_source = read(TS_WAVEFORM)
    bt_match = re.search(r"export const Z30_GFSK_BT\s*=\s*([0-9.]+)", ts_source)
    ramp_match = re.search(r"export const Z30_FRAME_RAMP_SEC\s*=\s*([0-9.]+)", ts_source)
    assert bt_match and ramp_match, "GFSK constants not found in src/dsp/z30Waveform.ts"

    cfg = Z30Config()
    assert float(bt_match.group(1)) == pytest.approx(cfg.gfsk_bt)
    assert float(ramp_match.group(1)) == pytest.approx(cfg.frame_ramp_sec)


def test_shared_crc_vectors_match_the_python_implementation():
    """
    The vector file is the contract the TypeScript side is checked against. If Python and the
    file disagree, one of them moved and the whole cross-language guarantee is void.
    """
    with open(VECTORS, "r", encoding="utf-8") as handle:
        document = json.load(handle)

    codec = Z30LdpcCodec()
    assert document["width_bits"] == 14
    assert document["register_constant"] == "0x2443"
    assert document["init"] == "0x2757"
    assert len(document["vectors"]) >= 10

    for vector in document["vectors"]:
        payload = np.array(vector["payload"], dtype=np.uint8)
        assert payload.size == 63, f"{vector['name']}: payload must be 63 bits"
        computed = codec.compute_crc14(payload)
        assert computed == vector["crc14"], (
            f"{vector['name']}: Python computed {computed:#06x}, vector says {vector['crc14']:#06x}"
        )


def test_frame_geometry_constants_match():
    """Symbol count, tone count, spacing and duration must agree across both implementations."""
    ts_source = read(TS_CONSTANTS)
    cfg = Z30Config()
    for name, expected in (
        ("NUM_TONES", cfg.num_tones),
        ("TONE_SPACING_HZ", cfg.tone_spacing_hz),
        ("SYMBOL_DURATION_SEC", cfg.symbol_duration_sec),
        ("TOTAL_SYMBOLS", cfg.total_symbols),
    ):
        match = re.search(rf"\b{name}:\s*([0-9.]+)", ts_source)
        assert match, f"{name} not found in src/dsp/z30Constants.ts"
        assert float(match.group(1)) == pytest.approx(float(expected)), (
            f"{name}: TypeScript says {match.group(1)}, Python says {expected}"
        )
