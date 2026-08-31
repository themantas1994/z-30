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

from z30_dsp.ldpc import (
    DECODE_SCHEDULES,
    DITHER_AMPLITUDE,
    Z30LdpcCodec,
    Z30_CHECK_TO_INFO,
    dither_seed_from_llrs,
    dither_vector,
)
from z30_dsp.modem import Z30Config
from z30_dsp import acquisition, benchmark

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


DITHER_VECTORS = os.path.join(os.path.dirname(__file__), "vectors", "dither_vectors.json")


def test_shared_dither_vectors_match_the_python_implementation():
    """
    The schedule-4 perturbation must be identical in both languages, and reproducible.

    It used to be drawn from unseeded global RNG in both (`np.random.rand`, `Math.random`),
    which made the decoder not a function of its input: two seeded benchmark runs of the same
    configuration could decode a different set of frames, and only near threshold - exactly
    where the curve is measured. `tests/crc14.test.mjs` runs this same file through the
    TypeScript implementation.
    """
    with open(DITHER_VECTORS, "r", encoding="utf-8") as handle:
        document = json.load(handle)

    llrs = np.array(document["llrs"], dtype=np.float32)
    assert dither_seed_from_llrs(llrs) == document["seed"]
    assert DITHER_AMPLITUDE == document["amplitude"]

    produced = dither_vector(llrs, len(document["dither"]))
    np.testing.assert_array_equal(produced, np.array(document["dither"], dtype=np.float64))


def test_dither_amplitude_matches_the_typescript_constant():
    source = read(TS_CODEC)
    match = re.search(r"export const DITHER_AMPLITUDE\s*=\s*([0-9.]+);", source)
    assert match, "DITHER_AMPLITUDE not found in src/dsp/ldpcCodec.ts"
    assert float(match.group(1)) == DITHER_AMPLITUDE


def test_decoder_reaches_the_dither_schedule_and_stays_reproducible():
    """
    Decodes an undecodable frame twice, so the run is forced through all four schedules.

    The pre-existing determinism test used a -18 dB frame, which converges in schedule 1 and so
    never reached the dithered pass at all - the unseeded draw sat behind it, untested, for as
    long as it existed. Anything that cannot decode exercises the whole cascade.
    """
    codec = Z30LdpcCodec()
    rng = np.random.default_rng(4242)
    llrs = rng.normal(0.0, 0.35, 216).astype(np.float32)

    first = codec.decode_min_sum(llrs)
    second = codec.decode_min_sum(llrs)

    # 45 + 40 + 35 + 30: every schedule ran, so the dithered one did too.
    assert first[2] == 150, f"expected the full cascade, got {first[2]} iterations"
    assert first[0] == second[0]
    assert first[2] == second[2]
    np.testing.assert_array_equal(first[1], second[1])


def test_decode_schedule_tables_are_identical():
    """
    The four-schedule cascade is the decoder's specification, and it exists twice.

    A schedule that drifts in one language and not the other changes which frames decode, near
    threshold only, with both halves still passing their own tests - the exact silent-drift
    failure this file exists to catch. wiki/04 tabulates these same values.
    """
    source = read(TS_CODEC)
    block = re.search(
        r"export const Z30_DECODE_SCHEDULES:[^=]*=\s*\[(.*?)\];", source, re.DOTALL
    )
    assert block, "Z30_DECODE_SCHEDULES not found in src/dsp/ldpcCodec.ts"

    ts_schedules = []
    for row in re.finditer(r"\{([^}]*)\}", block.group(1)):
        fields = dict(
            re.findall(r"(\w+)\s*:\s*'?([A-Za-z0-9.]+)'?", row.group(1))
        )
        ts_schedules.append({
            "mode": fields["mode"],
            "alpha": float(fields["alpha"]),
            "beta": float(fields["beta"]),
            "damping": float(fields["damping"]),
            "reverse": fields["reverse"] == "true",
            "iters": int(fields["iters"]),
        })

    py_schedules = [
        {
            "mode": s["mode"],
            "alpha": float(s["alpha"]),
            "beta": float(s["beta"]),
            "damping": float(s["damping"]),
            "reverse": bool(s["reverse"]),
            "iters": int(s["iters"]),
        }
        for s in DECODE_SCHEDULES
    ]

    assert ts_schedules == py_schedules
    # 45 + 40 + 35 + 30 = 150, the figure wiki/04 quotes as the cascade's total.
    assert sum(s["iters"] for s in py_schedules) == 150


def test_no_alpha_constructor_argument_survives():
    """
    `Z30LdpcCodec(alpha=...)` was accepted and never read, so tuning it did nothing.

    A dead knob is worse than no knob: wiki/04 documented the value, the Specs modal rendered
    it, and the browser benchmark offered an input box for it, all describing a number the
    decoder had never applied.
    """
    with pytest.raises(TypeError):
        Z30LdpcCodec(alpha=0.5)  # type: ignore[call-arg]

    assert not hasattr(Z30LdpcCodec(), "alpha")

    # And the TypeScript twin no longer exports it as a live parameter either (the prose
    # explaining why it went is allowed to name it; the value is not).
    params = re.search(
        r"export const Z30_LDPC_PARAMS[^=]*=\s*\{(.*?)\};", read(TS_CODEC), re.DOTALL
    )
    assert params, "Z30_LDPC_PARAMS not found in src/dsp/ldpcCodec.ts"
    assert "alphaMinSum" not in params.group(1)
    engine = read(os.path.join(REPO_ROOT, "src", "dsp", "monteCarloEngine.ts"))
    assert "alphaMinSum:" not in engine, "the browser benchmark still carries a dead alpha knob"


def test_benchmark_receiver_model_constants_match():
    """
    The two benchmark engines must model the same receiver, or they measure different things.

    wiki/16 used to publish a table showing the Python and browser thresholds disagreeing by
    1.8 dB, and named the acquisition search width as the cause. Measured paired, the search
    width accounted for none of it (0 discordant decodes in 200 frames) and the demodulator's
    coherent weight accounted for all of it. Both constants are now shared, and pinned here so
    the engines cannot drift apart into two incomparable numbers again.
    """
    engine = read(os.path.join(REPO_ROOT, "src", "dsp", "monteCarloEngine.ts"))

    margin = re.search(r"export const SLOT_SEARCH_MARGIN_SEC\s*=\s*([0-9.]+);", engine)
    assert margin, "SLOT_SEARCH_MARGIN_SEC not found in monteCarloEngine.ts"
    assert float(margin.group(1)) == acquisition.SLOT_SEARCH_MARGIN_SEC

    coherence = re.search(r"export const REALISTIC_PILOT_COHERENCE\s*=\s*([0-9.]+);", engine)
    assert coherence, "REALISTIC_PILOT_COHERENCE not found in monteCarloEngine.ts"
    assert float(coherence.group(1)) == benchmark.REALISTIC_PILOT_COHERENCE

    # The window itself, not just the margin, so an off-by-one in either expression shows up.
    assert acquisition.slot_timing_search_sec(0.5) == pytest.approx(0.55)
