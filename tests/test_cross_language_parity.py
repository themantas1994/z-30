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
    LDPC_MAX_ITERATIONS,
    Z30LdpcCodec,
    Z30_CHECK_TO_INFO,
    dither_seed_from_llrs,
    dither_vector,
)
from z30_dsp.ldpc import AP_LLR_MARGIN
from z30_dsp.ap_decode import (
    AP_DEEP_TYPE,
    AP_FREQ_WINDOW_HZ,
    AP_STAGE_LADDER,
    AP_TYPE_EXTRA,
    AP_TYPE_LABELS,
)
from z30_dsp.message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    decode_callsign28,
    encode_callsign28,
)
from z30_dsp.modem import Z30Config
from z30_dsp import acquisition, benchmark, sic_decoder

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TS_CONSTANTS = os.path.join(REPO_ROOT, "src", "dsp", "z30Constants.ts")
TS_CODEC = os.path.join(REPO_ROOT, "src", "dsp", "ldpcCodec.ts")
TS_WAVEFORM = os.path.join(REPO_ROOT, "src", "dsp", "z30Waveform.ts")
VECTORS = os.path.join(os.path.dirname(__file__), "vectors", "crc14_vectors.json")
TS_AP = os.path.join(REPO_ROOT, "src", "dsp", "apDecode.ts")
CALLSIGN_PACK_VECTORS = os.path.join(
    os.path.dirname(__file__), "vectors", "callsign_pack_vectors.json"
)


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


def test_costas_sync_pattern_matches():
    """
    The Costas sync pattern is what a receiver acquires on. AGENTS.md names changing it as a
    protocol break - "every station on the air stops decoding you" - and until this test the two
    copies agreed only because nobody had edited one of them. `test_waveform_shaping_constants`
    pinned two GFSK scalars and stopped there.
    """
    ts_source = read(TS_CONSTANTS)
    cfg = Z30Config()

    for name, expected in (("SYNC_POSITIONS", cfg.sync_positions), ("SYNC_TONES", cfg.sync_tones)):
        match = re.search(rf"\b{name}:\s*\[(.*?)\]", ts_source, re.S)
        assert match, f"{name} not found in src/dsp/z30Constants.ts"
        ts_values = [int(tok) for tok in re.findall(r"-?\d+", match.group(1))]
        assert ts_values == list(expected), (
            f"{name} differs: TypeScript {ts_values} vs Python {list(expected)}"
        )

    # Guards the pattern's own structure, computed from the array rather than asserted as a
    # literal: 21 sync symbols, every position inside the frame and distinct, every tone a legal
    # 16-MFSK tone index.
    assert len(cfg.sync_positions) == len(cfg.sync_tones) == 21
    assert len(set(cfg.sync_positions)) == len(cfg.sync_positions), "duplicate sync position"
    assert all(0 <= p < cfg.total_symbols for p in cfg.sync_positions)
    assert all(0 <= t < cfg.num_tones for t in cfg.sync_tones)


def test_ldpc_iteration_cap_matches():
    """
    Schedule 1's cap is quoted by SpecsModal and by the benchmark. Both now read it from a named
    constant; this pins the two constants to each other.
    """
    ts_source = read(TS_CODEC)
    match = re.search(r"export const LDPC_MAX_ITERATIONS\s*=\s*(\d+)", ts_source)
    assert match, "LDPC_MAX_ITERATIONS not found in src/dsp/ldpcCodec.ts"
    assert int(match.group(1)) == LDPC_MAX_ITERATIONS, (
        f"iteration cap differs: TypeScript {match.group(1)}, Python {LDPC_MAX_ITERATIONS}"
    )
    # And that the constant is what the codec actually defaults to, not just a number beside it.
    assert Z30LdpcCodec().max_iterations == LDPC_MAX_ITERATIONS


def test_osd_chase_search_thresholds_match():
    """
    The OSD-2 / Chase post-processing thresholds decide which re-encoded candidate is accepted
    after belief propagation stalls. They are magic numbers that happened to agree; a drift in
    either would change which marginal frames decode, in one language only, with every existing
    test still passing.
    """
    ts_source = read(TS_CODEC)
    py_source = read(os.path.join(REPO_ROOT, "z30_dsp", "ldpc.py"))

    ts_osd = re.search(r"corr > ([0-9.]+) && corr > maxCorrelation && diffCount <= (\d+)", ts_source)
    py_osd = re.search(r"corr > ([0-9.]+) and corr > max_correlation and diff_count <= (\d+)", py_source)
    assert ts_osd, "OSD-2 acceptance test not found in src/dsp/ldpcCodec.ts"
    assert py_osd, "OSD-2 acceptance test not found in z30_dsp/ldpc.py"
    assert ts_osd.groups() == py_osd.groups(), (
        f"OSD-2 thresholds differ: TypeScript {ts_osd.groups()}, Python {py_osd.groups()}"
    )

    ts_ira = re.search(r"corr > 0 && diffFromHard <= (\d+)", ts_source)
    py_ira = re.search(r"corr > 0 and diff_from_hard <= (\d+)", py_source)
    assert ts_ira, "Trellis-IRA acceptance test not found in src/dsp/ldpcCodec.ts"
    assert py_ira, "Trellis-IRA acceptance test not found in z30_dsp/ldpc.py"
    assert ts_ira.group(1) == py_ira.group(1), (
        f"Trellis-IRA distance bound differs: TypeScript {ts_ira.group(1)}, Python {py_ira.group(1)}"
    )


def test_sic_candidate_detection_constants_match():
    """
    The SIC candidate detector had genuinely diverged: Python scanned raw FFT bins at 8 dB over
    the median while TypeScript scanned Bartlett-averaged tone groups at 6 dB. Both were the
    shipped default on their own side and no test compared them. Python now runs the grouped
    detector too; this pins the constants so they cannot separate again.
    """
    ts_source = read(os.path.join(REPO_ROOT, "src", "dsp", "realReceiver.ts"))
    ts_peak = re.search(r"export const SIC_MIN_PEAK_DB\s*=\s*([0-9.]+)", ts_source)
    ts_max = re.search(r"export const SIC_MAX_CANDIDATES\s*=\s*(\d+)", ts_source)
    assert ts_peak and ts_max, "SIC detection constants not found in src/dsp/realReceiver.ts"
    assert float(ts_peak.group(1)) == pytest.approx(sic_decoder.SIC_MIN_PEAK_DB)
    assert int(ts_max.group(1)) == sic_decoder.SIC_MAX_CANDIDATES


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


# ---------------------------------------------------------------------------------------------
# A priori (AP) decoding
#
# AP is a two-language feature like everything else here, and it has an extra way to drift: a
# hypothesis is only useful if the bits it asserts are the bits the OTHER language's transmitter
# would emit. A Python benchmark measuring the gain of an assertion the browser never forms
# would be measuring nothing, and would look exactly like a measurement.
# ---------------------------------------------------------------------------------------------


def test_ap_llr_margin_matches():
    """WSJT-X's `apmag=maxval(abs(llra))*1.01`, in both languages."""
    ts_source = read(TS_CODEC)
    match = re.search(r"export const AP_LLR_MARGIN\s*=\s*([0-9.]+);", ts_source)
    assert match, "AP_LLR_MARGIN not found in src/dsp/ldpcCodec.ts"
    assert float(match.group(1)) == pytest.approx(AP_LLR_MARGIN)


def test_ap_frequency_window_matches():
    """
    WSJT-X's `napwid`. The deep hypotheses assert most of the message, and this is the only
    thing keeping them off a passband the operator is not working - so it has to be the same
    number on both sides, not merely a similar one.
    """
    ts_source = read(TS_AP)
    window = re.search(r"export const AP_FREQ_WINDOW_HZ\s*=\s*([0-9.]+);", ts_source)
    deep = re.search(r"export const AP_DEEP_TYPE\s*=\s*(\d+);", ts_source)
    assert window and deep, "AP window constants not found in src/dsp/apDecode.ts"
    assert float(window.group(1)) == pytest.approx(AP_FREQ_WINDOW_HZ)
    assert int(deep.group(1)) == AP_DEEP_TYPE


def test_ap_type_catalogue_matches():
    """The `iaptype` table itself: same types, same labels, in both languages."""
    ts_source = read(TS_AP)
    block = re.search(
        r"export const AP_TYPE_LABELS:[^=]*=\s*\{(.*?)\};", ts_source, re.S
    )
    assert block, "AP_TYPE_LABELS not found in src/dsp/apDecode.ts"
    ts_labels = {
        int(num): label
        for num, label in re.findall(r"(\d+):\s*'([^']*)'", block.group(1))
    }
    assert ts_labels == dict(AP_TYPE_LABELS), (
        f"AP type catalogue differs: TypeScript {ts_labels} vs Python {dict(AP_TYPE_LABELS)}"
    )


def test_ap_stage_ladder_matches():
    """
    WSJT-X's `naptypes(nQSOProgress,1:4)`, mapped onto z-30's QsoStage union.

    The ORDER matters as much as the membership: the ladder is tried in sequence and each entry
    is another 2^-14 roll of the CRC dice, so a reordering changes both which frames are
    recovered and how exposed the receiver is - in one language only.
    """
    ts_source = read(TS_AP)
    block = re.search(
        r"export const AP_STAGE_LADDER:[^=]*=\s*\{(.*?)\n\};", ts_source, re.S
    )
    assert block, "AP_STAGE_LADDER not found in src/dsp/apDecode.ts"
    ts_ladder = {
        stage: tuple(int(n) for n in re.findall(r"\d+", types))
        for stage, types in re.findall(r"(\w+):\s*\[([0-9,\s]*)\]", block.group(1))
    }
    assert ts_ladder == dict(AP_STAGE_LADDER), (
        f"AP stage ladder differs: TypeScript {ts_ladder} vs Python {dict(AP_STAGE_LADDER)}"
    )

    # And every stage in the TypeScript QsoStage union has a ladder, so a stage added there
    # cannot silently fall through to "no AP" without anyone deciding that.
    types_source = read(os.path.join(REPO_ROOT, "src", "types", "z30.ts"))
    union = re.search(r"export type QsoStage\s*=\s*(.*?);", types_source, re.S)
    assert union, "QsoStage union not found in src/types/z30.ts"
    # [A-Z0-9_], not [A-Z_]: SENDING_73 carries digits, and a pattern that quietly skipped it
    # would let this test pass while the very stage it exists to cover went unchecked.
    stages = set(re.findall(r"'([A-Z0-9_]+)'", union.group(1)))
    assert stages == set(AP_STAGE_LADDER), (
        f"QsoStage union {sorted(stages)} does not match the AP ladder {sorted(AP_STAGE_LADDER)}"
    )


def test_ap_closing_modifiers_match_the_packers_codes():
    r"""
    Types 4-6 assert a 7-bit modifier. Python names it by constant; TypeScript re-derives it by
    packing the message text, so this pins the two spellings to each other AND to the packer.

    The `73` code is the one that matters most: `packZ30Message` used to reach its numeric
    report branch first (`/^\d+$/` matches '73'), so the modifier branch was unreachable and
    every sign-off went out as a +30 dB report. AP type 5 asserted a message the transmitter
    could not produce.
    """
    ts_source = read(TS_AP)
    block = re.search(
        r"export const AP_TYPE_MODIFIER:[^=]*=\s*\{(.*?)\};", ts_source, re.S
    )
    assert block, "AP_TYPE_MODIFIER not found in src/dsp/apDecode.ts"
    ts_modifiers = {
        int(num): text for num, text in re.findall(r"(\d+):\s*'([^']*)'", block.group(1))
    }
    expected = {4: "RRR", 5: "73", 6: "RR73"}
    assert ts_modifiers == expected

    py_codes = {4: EXTRA_RRR, 5: EXTRA_73, 6: EXTRA_RR73}
    assert dict(AP_TYPE_EXTRA) == py_codes
    assert set(AP_TYPE_EXTRA) == set(ts_modifiers), "the two sides close a QSO with different types"

    # The TypeScript packer's own branch order, which is what makes those codes reachable.
    codec_source = read(os.path.join(REPO_ROOT, "src", "dsp", "z30Codec.ts"))
    modifier_at = codec_source.find("third === '73'")
    numeric_at = codec_source.find("/^\\d+$/.test(third)")
    assert modifier_at != -1 and numeric_at != -1
    assert modifier_at < numeric_at, (
        "packZ30Message tests the numeric report branch before the '73' branch again; "
        "'73' matches /^\\d+$/, so the sign-off would pack as a +30 dB report"
    )


def test_shared_callsign_packing_vectors_match_the_python_implementation():
    """
    The 28-bit callsign encoding, which is what AP asserts. `tests/apDecode.test.mjs` runs the
    same file through the TypeScript implementation.
    """
    with open(CALLSIGN_PACK_VECTORS, "r", encoding="utf-8") as handle:
        document = json.load(handle)

    assert document["field_width_bits"] == 28
    assert len(document["vectors"]) >= 10

    for vector in document["vectors"]:
        packed = encode_callsign28(vector["call"])
        assert packed == vector["packed"], (
            f"{vector['call']}: Python packed {packed}, vector says {vector['packed']}"
        )
        assert 0 <= packed <= 0x0FFFFFFF, f"{vector['call']}: packed value outside the 28-bit field"
        unpacked = decode_callsign28(packed)
        assert unpacked == vector["unpacked"], (
            f"{vector['call']}: Python unpacked {unpacked}, vector says {vector['unpacked']}"
        )
        # The round-trip flag is what decides whether a callsign may be asserted at all.
        assert (unpacked == vector["call"].strip().upper()) == vector["round_trips"]
