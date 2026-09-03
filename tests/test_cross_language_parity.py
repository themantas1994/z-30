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

import ast
import json
import inspect
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
from z30_dsp.channel import WATTERSON_PRESETS
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


def strip_comments_ts(source: str) -> str:
    """
    TypeScript source with `//` and `/* */` comments removed.

    The tests below assert that a removed construct has not come back, and every removal in
    this project leaves a comment behind naming what went and why - so a naive substring search
    would match the tombstone and pass forever. Stripping first means the assertion is about
    the code.

    Deliberately simple: it does not know about `//` inside a string literal. Nothing in these
    two files has one, and a parser here would be more machinery than the check is worth.
    """
    without_block = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"//[^\n]*", "", without_block)


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

    # The window itself, not just the margin, so an off-by-one in either expression shows up.
    assert acquisition.slot_timing_search_sec(0.5) == pytest.approx(0.55)


def test_the_benchmark_demodulates_like_the_receiver_that_ships():
    """
    The coherent weight the benchmarks apply must be the one the ON-AIR decoders apply.

    This is the parity that was missing, and its absence was not visible from either side. Both
    benchmark engines declared 0.0 and agreed with each other perfectly, while
    `realReceiver.ts`'s `demodulateReal` hardcoded the pilot-distance-adaptive 0.35-0.85 and
    `sic_decoder.py` inherited it from `demodulate_mfsk_llrs`'s old default. Every published
    sensitivity figure therefore described a receiver that never decoded a frame off the air.
    Measured paired at 100 frames per point it was worth 1.77 dB on AWGN (p = 2.9e-36) and far
    more on a fading path (p = 5e-119); see benchmark.RECEIVER_PILOT_COHERENCE.

    So this asserts three things at once: that the constant is declared beside the shipped
    demodulator, that the Python default matches it, and that `demodulateReal` reads the
    constant rather than recomputing a weight of its own.
    """
    receiver = read(os.path.join(REPO_ROOT, "src", "dsp", "realReceiver.ts"))

    coherence = re.search(r"export const RECEIVER_PILOT_COHERENCE\s*=\s*([0-9.]+);", receiver)
    assert coherence, "RECEIVER_PILOT_COHERENCE not found in realReceiver.ts"
    assert float(coherence.group(1)) == benchmark.RECEIVER_PILOT_COHERENCE

    # The TypeScript demodulator must USE it, not merely declare it next to a literal. The
    # regex targets the assignment the defect lived in: any locally computed per-symbol weight.
    assert "RECEIVER_PILOT_COHERENCE * coherent" in receiver, (
        "demodulateReal no longer applies RECEIVER_PILOT_COHERENCE to the coherent term"
    )
    assert not re.search(r"const\s+pilotCoherence\s*=", receiver), (
        "demodulateReal computes its own coherence weight again - the exact shape of the "
        "defect this test exists to catch"
    )

    # And the Python demodulator's DEFAULT is that same weight, so a caller that does not ask
    # for anything (sic_decoder._estimate_llrs is one) gets the measured receiver.
    default = inspect.signature(benchmark.demodulate_mfsk_llrs).parameters["pilot_coherence"].default
    assert default == benchmark.RECEIVER_PILOT_COHERENCE, (
        "demodulate_mfsk_llrs defaults to something other than the shipped receiver's weight"
    )


def test_the_two_engines_agree_on_the_statistics_they_publish():
    """
    The confidence interval and the publishable sample size are one rule, not two.

    Both are printed next to a sensitivity figure, and wiki/16 compares the two engines' 95%
    bands directly when it reports them landing 0.02 dB apart - so a band computed from a
    rounded z on one side and the exact quantile on the other is a comparison of two slightly
    different statements. The browser engine used a hardcoded 1.96; the Python side has always
    written the quantile out in full precisely so the interval does not depend on which library
    version produced it.

    PUBLISHABLE_FRAMES_PER_POINT is pinned for the same reason. The Python benchmark has
    printed an EXPLORATORY notice below it for as long as it has existed; the browser engine
    defaults to a quarter of it and offers a 25-frame quick sweep, and used to print nothing.
    """
    engine = read(os.path.join(REPO_ROOT, "src", "dsp", "monteCarloEngine.ts"))

    z = re.search(r"export const WILSON_Z_95\s*=\s*([0-9.]+);", engine)
    assert z, "WILSON_Z_95 not found in monteCarloEngine.ts"
    assert float(z.group(1)) == benchmark.WILSON_Z_95

    frames = re.search(r"export const PUBLISHABLE_FRAMES_PER_POINT\s*=\s*([0-9]+);", engine)
    assert frames, "PUBLISHABLE_FRAMES_PER_POINT not found in monteCarloEngine.ts"
    assert int(frames.group(1)) == benchmark.PUBLISHABLE_FRAMES_PER_POINT

    # And the constant has to be the one the arithmetic uses, not a literal declared beside a
    # hardcoded 1.96. This is the shape the RECEIVER_PILOT_COHERENCE defect took.
    assert "const z = WILSON_Z_95;" in engine, (
        "calculateWilsonConfidenceInterval no longer reads WILSON_Z_95"
    )


def test_the_browser_engine_measures_the_receiver_that_ships():
    """
    The browser benchmark must run the waveform and the shipped demodulator, not a model.

    It used to default to a `MATCHED_FILTER_CORRELATOR_BANK` path that synthesized no waveform
    and called no demodulator: it drew per-tone complex Gaussians against an assumed 16-ary
    orthogonal signalling model and applied a pilot weight of its own (`esN0/(esN0 + 1.5)`,
    clamped). Measured at seed 20260830 in ideal mode over -26/-25/-24 dB, 20 frames a point,
    it decoded 6/11/19 of 20 where the physical chain decoded 0/2/11 - roughly 2 dB optimistic,
    and the origin of the browser "genie-aided bound" wiki/16 could not reconcile with the
    Python one.

    AGENTS.md section 4 states the rule: a benchmark that reimplements the receiver measures
    the reimplementation. This asserts the reimplementation is gone and cannot come back under
    its own name, and that the one surviving path still calls the real synthesiser and the real
    demodulator.
    """
    engine = read(os.path.join(REPO_ROOT, "src", "dsp", "monteCarloEngine.ts"))
    code = strip_comments_ts(engine)

    for banned in ("generateChannelLlrsFast", "MATCHED_FILTER_CORRELATOR_BANK", "SimulationModeType"):
        assert banned not in code, (
            f"{banned} is back in monteCarloEngine.ts: the browser benchmark can once again "
            f"measure an analytic model instead of the shipped receive chain"
        )

    # The surviving path synthesizes a waveform and demodulates it.
    assert "this.synthesizePhysicalWaveform(" in code
    assert "this.demodulateToLlrs(" in code


def test_the_browser_engine_claims_no_channel_it_does_not_model():
    """
    The browser engine models calibrated AWGN, and says so.

    It used to offer `RAYLEIGH_FADING`, whose implementation was headed "Rayleigh / ITU-R
    F.1487 Ionospheric Multipath Fading" and commented "Two-path Watterson model", and which
    multiplied each path by a REAL-VALUED sinusoid (`0.8 + 0.4*sin`, `0.5 + 0.3*cos`). A
    Watterson tap is a complex Gaussian process, and the complex half is the half that matters:
    a real gain cannot rotate the carrier, so it cannot spread a tone, and Doppler spread
    against the 3.125 Hz tone spacing is the entire mechanism wiki/16 records for this mode's
    behaviour on a disturbed path. It also offered `CO_CHANNEL_QRM`, which no code anywhere
    read - selecting it ran AWGN and labelled the result interference.

    z30_dsp/channel.py implements the recommendation properly, against its own named test
    conditions, and this test pins that the browser engine does not claim to.
    """
    engine = read(os.path.join(REPO_ROOT, "src", "dsp", "monteCarloEngine.ts"))
    code = strip_comments_ts(engine)

    for banned in ("applyRayleighFading", "RAYLEIGH_FADING", "CO_CHANNEL_QRM", "fadingDopplerHz"):
        assert banned not in code, (
            f"{banned} is back in monteCarloEngine.ts without the Watterson model behind it"
        )

    # The Python side, meanwhile, must still carry the real thing and the real presets - the
    # named conditions are what makes a fading figure comparable with anyone else's.
    assert set(WATTERSON_PRESETS) >= {"none", "good", "moderate", "poor", "high-moderate"}
    for key, preset in WATTERSON_PRESETS.items():
        if key == "none":
            continue
        assert "ITU-R F.1487" in preset.name, (
            f"fading preset {key!r} no longer names the recommendation it comes from"
        )


def test_the_browser_engine_uses_the_shipped_decoder_iteration_cap():
    """
    A benchmark may not choose the decoder's iteration cap.

    The modal had a 10-120 input box wired straight into `decodeMinSum`'s cap, so a run could
    measure a decoder the shipped receiver is not: `decodeWithAp` in realReceiver.ts takes
    LDPC_MAX_ITERATIONS and offers no way to override it, and z30_dsp/benchmark.py reads the
    same constant from ldpc.py rather than taking one. Same reasoning that removed the
    alphaMinSum slider, except that one could not move the curve and this one could.
    """
    engine = read(os.path.join(REPO_ROOT, "src", "dsp", "monteCarloEngine.ts"))
    modal = read(os.path.join(REPO_ROOT, "src", "components", "MonteCarloBenchmarkModal.tsx"))

    assert "maxLdpcIterations" not in strip_comments_ts(engine)
    assert "maxLdpcIterations" not in strip_comments_ts(modal)
    # Every decode in the engine takes the codec's own default.
    assert not re.search(r"decodeMinSum\(channelLlrs\s*,", engine), (
        "the browser benchmark passes an iteration cap to decodeMinSum again"
    )

    # The Python sweep does the same, from ldpc.py's constant rather than a retyped literal.
    source = inspect.getsource(benchmark.run_monte_carlo_snr_sweep)
    assert "Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)" in source


def test_the_ui_plots_no_curve_nothing_measured():
    """
    The decode-probability chart carries measured points and one sanctioned reference.

    It used to draw a "Shannon Capacity Limit", ON BY DEFAULT, as
    `100 * exp(1.8 * (snr + 30.51))`. Shannon's theorem gives an SNR below which no reliable
    code exists; it does not give a decode probability, and nothing in this repository derives
    that exponential, its slope or its intercept. A curve whose shape nobody computed, labelled
    a fundamental limit and drawn beside measured points, is the failure mode AGENTS.md
    section 5 is written against - the withdrawn "+4.0 dB advantage" came back into this same
    modal once already.

    The FT8 logistic stays because wiki/16 sanctions it under conditions this asserts: it is
    opt-in, and it defaults to off.
    """
    modal = read(os.path.join(REPO_ROOT, "src", "components", "MonteCarloBenchmarkModal.tsx"))
    code = strip_comments_ts(modal)

    for banned in ("shannonLimit", "includeShannonLimit", "ft4DecodePct"):
        assert banned not in code, f"{banned} is back in the benchmark modal"

    assert re.search(
        r"const \[includeFt8Comparison, setIncludeFt8Comparison\] = useState<boolean>\(false\)",
        code,
    ), "the FT8 reference overlay is no longer off by default"
    # And it is still drawn only behind that opt-in.
    assert "{includeFt8Comparison && (" in code


def test_the_crossing_rule_has_one_implementation_in_python():
    """
    "Where does this curve reach N%" is one rule, and `_crossing_db` is it.

    `decode_threshold_db` used to carry a second copy of the same interpolation, and the `--ap`
    instrument read that one while every published threshold read the other. They agreed by
    inspection, which is the state AGENTS.md's "one source of truth per rule" describes: two
    implementations agreeing today and drifting the day one of them meets a curve that dips.

    Asserted by construction rather than by reading: the two entry points are driven over
    randomly generated monotone curves and must return the same number every time.
    """
    assert "_crossing_db(" in inspect.getsource(benchmark.decode_threshold_db)

    rng = np.random.default_rng(20260903)
    for _ in range(200):
        n = int(rng.integers(3, 12))
        snrs = np.sort(rng.uniform(-30.0, -10.0, n))
        # A monotone decode curve with a genuine crossing somewhere inside it.
        pcts = np.sort(rng.uniform(0.0, 100.0, n))
        results = [
            {"snr_db": float(s), "decode_pct": float(p), "successes": int(round(p)), "total_frames": 100}
            for s, p in zip(snrs, pcts)
        ]
        via_helper = benchmark._crossing_db([(r["snr_db"], r["decode_pct"]) for r in results], 50.0)
        via_public = benchmark.decode_threshold_db(results)
        _lo, via_interval, _hi = benchmark.decode_threshold_interval_db(results, 50.0)
        assert via_public == via_helper
        assert via_interval == via_helper


def test_the_ap_instrument_reports_a_band_and_not_a_bare_crossing():
    """
    Every crossing this project prints carries the range its sample supports.

    `ap_threshold_shift` used to return three bare numbers, printed to two decimal places, off
    the IN-QSO half of a sweep - about half the frames the sweep ran, so a wider interval than
    the sweep's own and no interval shown at all. AGENTS.md section 5 asks for the interval
    rather than the crossing.

    The bands are checked for the property that defines them rather than against stored values:
    the optimistic curve (every point at its upper Wilson bound) must cross at or below the
    measured curve, and the pessimistic one at or above it. That is computed here from counts
    this test makes up, so it cannot be satisfied by a hardcoded return.
    """
    rng = np.random.default_rng(20260903)
    for _ in range(50):
        in_qso = int(rng.integers(20, 120))
        # A rising curve of in-QSO decode counts, with AP at least as good as plain.
        fractions = np.sort(rng.uniform(0.0, 1.0, 6))
        results = []
        for i, frac in enumerate(fractions):
            plain = int(round(frac * in_qso))
            ap = min(in_qso, plain + int(rng.integers(0, 4)))
            results.append({
                "snr_db": -27.0 + i,
                "in_qso_frames": in_qso,
                "in_qso_plain": plain,
                "in_qso_ap": ap,
            })

        shift = benchmark.ap_threshold_shift(results)
        for arm, counts_key in (("plain", "in_qso_plain"), ("ap", "in_qso_ap")):
            point, low, high = shift[f"{arm}_db"], shift[f"{arm}_low_db"], shift[f"{arm}_high_db"]

            # Recomputed here from the counts this test made up, through the same two public
            # helpers, so the assertion is arithmetic on real data rather than a stored answer.
            expected_point = benchmark._crossing_db(
                [(r["snr_db"], 100.0 * r[counts_key] / r["in_qso_frames"]) for r in results], 50.0
            )
            expected_low = benchmark._crossing_db(
                [(r["snr_db"],
                  100.0 * benchmark.wilson_interval(r[counts_key], r["in_qso_frames"])[1])
                 for r in results], 50.0
            )
            expected_high = benchmark._crossing_db(
                [(r["snr_db"],
                  100.0 * benchmark.wilson_interval(r[counts_key], r["in_qso_frames"])[0])
                 for r in results], 50.0
            )
            assert point == expected_point
            assert low == expected_low, f"{arm} optimistic bound is not the Wilson band's"
            assert high == expected_high, f"{arm} pessimistic bound is not the Wilson band's"

            if point is None:
                continue
            # A more optimistic curve crosses at a LOWER (better) SNR, and vice versa. When the
            # band's own crossing runs off the end of the sweep it is None, which is reported
            # rather than silently clipped to the point estimate.
            if low is not None:
                assert low <= point + 1e-9, f"{arm} optimistic bound is worse than the estimate"
            if high is not None:
                assert high >= point - 1e-9, f"{arm} pessimistic bound is better than the estimate"

        if shift["shift_db"] is not None:
            assert shift["shift_db"] == pytest.approx(shift["plain_db"] - shift["ap_db"])


def test_the_python_sources_stay_importable_on_the_supported_floor():
    """
    AGENTS.md section 7 puts the support floor at Python 3.9, and CI runs 3.10 and up.

    So nothing in CI evaluates a module-level annotation the way 3.9 would, and
    `benchmark._log_sum_exp` carried `List[float] | np.ndarray` unquoted for exactly that
    reason. PEP 604's `|` on `typing.List` and on a class object arrives in 3.10: on 3.9 that
    expression is evaluated at def time and raises TypeError, taking down the import of
    z30_dsp.benchmark and everything that imports it - the whole benchmark, on a supported
    interpreter, from an annotation.

    Scanned rather than asserted about one function, because the next one will be somewhere
    else. A file that opts in with `from __future__ import annotations` is exempt, since that
    is exactly what makes the form safe.
    """
    # Every tree ruff lints at target-version py39, not just the runtime package: a helper in
    # tests/ or scripts/ that cannot be imported on the floor is the same defect one step out.
    # Parsed rather than grepped, so the check cannot be fooled by a `|` inside a string or a
    # comment, and so a quoted annotation - which is never evaluated - correctly passes.
    offenders = []
    sources = [
        (directory, name)
        for directory in ("z30_dsp", "tests", "scripts")
        for name in sorted(os.listdir(os.path.join(REPO_ROOT, directory)))
        if name.endswith(".py")
    ]
    for directory, name in sources:
        source = read(os.path.join(REPO_ROOT, directory, name))
        if "from __future__ import annotations" in source:
            continue
        tree = ast.parse(source, filename=name)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.AnnAssign)):
                continue
            annotations = []
            if isinstance(node, ast.AnnAssign):
                annotations.append(node.annotation)
            else:
                annotations.append(node.returns)
                args = node.args
                for arg in (*args.posonlyargs, *args.args, *args.kwonlyargs,
                            args.vararg, args.kwarg):
                    if arg is not None:
                        annotations.append(arg.annotation)
            for annotation in annotations:
                if annotation is None:
                    continue
                # ast.BinOp with BitOr IS the runtime-evaluated PEP 604 union. A string
                # annotation parses as ast.Constant and is never evaluated.
                for sub in ast.walk(annotation):
                    if isinstance(sub, ast.BinOp) and isinstance(sub.op, ast.BitOr):
                        offenders.append(f"{directory}/{name}:{annotation.lineno}")

    assert len(sources) > 20, "the scan found almost no sources - it would pass vacuously"
    assert not offenders, (
        "PEP 604 `X | Y` annotations evaluated at runtime, which raises TypeError on the "
        f"Python 3.9 floor AGENTS.md section 7 sets: {offenders}. Quote them, as ldpc.py does."
    )


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
