"""
A priori (AP) decoding: the mechanism, the gates, and what must not change because of it.

AP is the one feature in this decoder that lets information the receiver *assumed* stand in for
information it *measured*. That makes two classes of test necessary, and both are here:

  * that it works - an asserted hypothesis really does pin its bits and really does recover
    frames the ordinary decoder loses; and
  * that it cannot reach anything it should not - a frame that decodes on its own never touches
    the AP path, a wrong hypothesis is rejected by the CRC, a callsign that does not survive the
    28-bit packing produces no hypothesis at all, and the ordinary decode is bit-identical to
    what it was before AP existed.

Every expectation below is computed from the data the test itself generates. There are no
recorded "expected" decode counts: a decode count that was written down once and asserted
forever is a test that passes because the number was copied, not because the decoder worked.
"""

import math

import numpy as np
import pytest

from z30_dsp.ap_decode import (
    AP_DEEP_TYPE,
    AP_FREQ_WINDOW_HZ,
    AP_STAGE_LADDER,
    AP_TYPE_LABELS,
    ApHypothesis,
    build_ap_hypotheses,
    build_hypothesis,
    decode_with_ap,
    describe_ap_decode,
    hypothesis_holds,
    payload_extra_code,
)
from z30_dsp.ldpc import (
    AP_LLR_MARGIN,
    Z30LdpcCodec,
    ap_llr_magnitude,
    apply_ap_hypothesis,
)
from z30_dsp.message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    callsign_round_trips,
    decode_callsign28,
    encode_callsign28,
    pack_payload63,
    unpack_payload63,
)

MY_CALL = "W1AW"
DX_CALL = "K1ABC"


@pytest.fixture(scope="module")
def codec():
    return Z30LdpcCodec()


def noisy_llrs(codeword, sigma, rng, amplitude=4.0):
    """
    Channel LLRs for a codeword at a given noise level.

    Deliberately a plain BPSK-like model rather than the real demodulator: these tests are about
    the decoder's treatment of an AP mask, and putting the modem and the acquisition search in
    front of it would make a failure here ambiguous between the two. `benchmark.py --ap` is what
    measures the real receive chain.
    """
    clean = 1.0 - 2.0 * np.asarray(codeword, dtype=np.float64)
    return np.clip(amplitude * clean + rng.normal(0.0, sigma, len(clean)), -25.0, 25.0).astype(np.float32)


# ------------------------------------------------------------------ the AP LLR itself


def test_ap_magnitude_is_the_frame_peak_times_the_margin():
    rng = np.random.default_rng(11)
    for _ in range(20):
        llr = rng.normal(0.0, 6.0, 216).astype(np.float32)
        expected = AP_LLR_MARGIN * float(np.max(np.abs(llr)))
        assert ap_llr_magnitude(llr) == pytest.approx(expected, rel=1e-9)


def test_ap_magnitude_strictly_exceeds_every_measured_llr():
    """
    The point of the 1.01 margin: an asserted bit has to outrank the strongest thing the
    demodulator actually saw, or a confident channel bit could out-argue the assertion.
    """
    rng = np.random.default_rng(12)
    llr = rng.normal(0.0, 8.0, 216).astype(np.float32)
    apmag = ap_llr_magnitude(llr)
    assert apmag > float(np.max(np.abs(llr)))


def test_apply_ap_hypothesis_touches_exactly_the_masked_positions():
    rng = np.random.default_rng(13)
    llr = rng.normal(0.0, 5.0, 216).astype(np.float32)
    mask = np.zeros(216, dtype=np.uint8)
    mask[7:40] = 1
    bits = rng.integers(0, 2, 216, dtype=np.uint8)

    out = apply_ap_hypothesis(llr, mask, bits)
    apmag = ap_llr_magnitude(llr)

    for i in range(216):
        if mask[i]:
            assert out[i] == pytest.approx(apmag if bits[i] == 0 else -apmag, rel=1e-6)
        else:
            assert out[i] == llr[i], f"unmasked bit {i} was modified"


def test_ap_llr_sign_convention_matches_the_decoder_hard_decision(codec):
    """
    The one transcription error a port of WSJT-X's `apsym=2*bit-1` invites: this codec's hard
    decision is `llr < 0 -> 1`, WSJT-X's is `zn > 0 -> 1`. Getting it backwards would assert
    every AP bit inverted and no hypothesis would ever pass its CRC - a silent, total failure.
    """
    llr = np.full(216, 3.0, dtype=np.float32)
    mask = np.ones(216, dtype=np.uint8)
    for bit in (0, 1):
        bits = np.full(216, bit, dtype=np.uint8)
        out = apply_ap_hypothesis(llr, mask, bits)
        hard = (out < 0).astype(np.uint8)
        assert np.all(hard == bit), f"asserting {bit} produced hard decisions of {hard[0]}"


def test_apply_ap_hypothesis_is_a_no_op_on_an_all_zero_frame():
    out = apply_ap_hypothesis(np.zeros(216, dtype=np.float32), np.ones(216, dtype=np.uint8),
                              np.ones(216, dtype=np.uint8))
    assert np.all(out == 0.0)


# ------------------------------------------------------------------ pinning


def test_masked_bits_survive_every_iteration(codec):
    """
    A pinned bit must come back with the value that was asserted even when the assertion is
    wrong and the whole rest of the frame argues against it. This is the property WSJT-X's
    `zn(i)=llr(i)` provides and the reason a wrong hypothesis fails loudly (CRC) rather than
    quietly (a decoder that talked itself into a third answer).
    """
    rng = np.random.default_rng(21)
    payload = rng.integers(0, 2, 63, dtype=np.uint8)
    codeword = codec.encode(payload)
    llr = noisy_llrs(codeword, 2.0, rng)

    # Assert the OPPOSITE of the truth on the first 28 bits.
    mask = np.zeros(216, dtype=np.uint8)
    mask[:28] = 1
    wrong = np.zeros(216, dtype=np.uint8)
    wrong[:28] = 1 - codeword[:28]

    ap_llr = apply_ap_hypothesis(llr, mask, wrong)
    _ok, info, _iters = codec.decode_min_sum(ap_llr, ap_mask=mask)
    assert np.array_equal(info[:28], wrong[:28]), "a pinned bit was moved by belief propagation"


def test_a_wrong_hypothesis_is_rejected(codec):
    """
    The CRC is the arbiter. Asserting a callsign that is not in the frame must not produce a
    decode - if it did, AP would be a machine for inventing QSOs.
    """
    rng = np.random.default_rng(22)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    codeword = codec.encode(truth)

    liar = build_hypothesis(3, "G0ABC", "VK2DEF")
    assert liar is not None

    accepted = 0
    for _ in range(25):
        llr = noisy_llrs(codeword, 4.2, rng)
        result = decode_with_ap(codec, llr, [liar])
        if result.success and result.ap_type != 0:
            accepted += 1
    assert accepted == 0, f"{accepted} frames were 'decoded' under a hypothesis naming other stations"


def test_a_correct_hypothesis_recovers_frames_the_plain_decoder_loses(codec):
    """
    The measurement in miniature: same LLRs into both arms, count the disagreements, and require
    that AP wins strictly more of them than it loses. The counts are produced here, not recalled.
    """
    rng = np.random.default_rng(23)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    codeword = codec.encode(truth)
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)
    assert hypotheses, "the SENDING_REPORT ladder should not be empty for two standard callsigns"

    only_ap = only_plain = 0
    for _ in range(30):
        llr = noisy_llrs(codeword, 4.4, rng)
        plain_ok, plain_info, _ = codec.decode_min_sum(llr)
        plain_correct = bool(plain_ok and np.array_equal(plain_info[:63], truth))

        ap = decode_with_ap(codec, llr, hypotheses)
        ap_correct = bool(ap.success and np.array_equal(ap.info_bits[:63], truth))

        only_ap += ap_correct and not plain_correct
        only_plain += plain_correct and not ap_correct

    assert only_plain == 0, f"AP lost {only_plain} frames the ordinary decoder found"
    assert only_ap > 0, "AP recovered nothing at a noise level where the ordinary decoder fails"


def test_ap_never_loses_a_frame_the_plain_decoder_found(codec):
    """
    The structural guarantee, checked over a spread of noise levels: `decode_with_ap` tries the
    ordinary decode FIRST and returns it untouched when it succeeds, so the AP arm's decode set
    is a superset of the plain arm's. A refactor that reordered those two steps would break this
    and nothing else would notice.
    """
    rng = np.random.default_rng(24)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RRR), dtype=np.uint8)
    codeword = codec.encode(truth)
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)

    for sigma in (2.0, 3.0, 4.0, 5.0):
        for _ in range(6):
            llr = noisy_llrs(codeword, sigma, rng)
            plain_ok, plain_info, _ = codec.decode_min_sum(llr)
            ap = decode_with_ap(codec, llr, hypotheses)
            if plain_ok:
                assert ap.success, f"AP lost a frame the plain decoder decoded at sigma={sigma}"
                assert np.array_equal(ap.info_bits, plain_info), (
                    "AP returned a different answer for a frame that decoded on its own"
                )
                assert ap.ap_type == 0, "a frame that decoded on its own was tagged as AP"


def test_plain_decode_is_unchanged_by_the_ap_parameter(codec):
    """
    Bit-identity of the pre-AP path. An empty mask must take the same branches and produce the
    same numbers as no mask at all, or every published threshold in wiki/16 moved silently.
    """
    rng = np.random.default_rng(25)
    for _ in range(8):
        payload = rng.integers(0, 2, 63, dtype=np.uint8)
        codeword = codec.encode(payload)
        llr = noisy_llrs(codeword, 4.5, rng)

        a_ok, a_info, a_iters = codec.decode_min_sum(llr)
        b_ok, b_info, b_iters = codec.decode_min_sum(llr, ap_mask=np.zeros(216, dtype=np.uint8))
        assert (a_ok, a_iters) == (b_ok, b_iters)
        assert np.array_equal(a_info, b_info)


def test_ap_decode_is_deterministic(codec):
    """
    AGENTS.md's determinism invariant reaches the AP path too: schedule 4's dither is derived
    from the LLR vector, and the AP path hands it a *different* vector, so this asserts the
    derivation still holds when the input has been rewritten by an assertion.
    """
    rng = np.random.default_rng(26)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_73), dtype=np.uint8)
    codeword = codec.encode(truth)
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)

    for _ in range(5):
        llr = noisy_llrs(codeword, 4.6, rng)
        first = decode_with_ap(codec, llr, hypotheses)
        second = decode_with_ap(codec, llr, hypotheses)
        assert first.success == second.success
        assert first.ap_type == second.ap_type
        assert first.iterations == second.iterations
        assert np.array_equal(first.info_bits, second.info_bits)


# ------------------------------------------------------------------ the hypothesis ladder


def test_every_ap_type_asserts_the_fields_its_label_claims():
    """
    Each hypothesis is decoded back through the message codec and compared against its own
    label, so the mask and the claim cannot drift apart. Asserted bit counts are summed from the
    mask rather than written down.
    """
    expectations = {
        1: (28, "CQ", None, None),
        2: (28, MY_CALL, None, None),
        3: (56, MY_CALL, DX_CALL, None),
        4: (63, MY_CALL, DX_CALL, EXTRA_RRR),
        5: (63, MY_CALL, DX_CALL, EXTRA_73),
        6: (63, MY_CALL, DX_CALL, EXTRA_RR73),
    }
    assert set(expectations) == set(AP_TYPE_LABELS), "an AP type exists with no expectation here"

    for ap_type, (bit_count, to_call, from_call, extra) in expectations.items():
        h = build_hypothesis(ap_type, MY_CALL, DX_CALL)
        assert h is not None, f"type {ap_type} produced no hypothesis for two standard callsigns"
        assert h.asserted_bit_count == bit_count == sum(h.mask)

        decoded_to, decoded_from, decoded_extra = unpack_payload63(list(h.bits))
        assert decoded_to == to_call, f"type {ap_type} asserts destination {decoded_to}, not {to_call}"
        if from_call is not None:
            assert decoded_from == from_call
        if extra is not None:
            assert decoded_extra == extra

        # Nothing outside the payload is ever asserted: parity is what the code derives.
        assert len(h.mask) == 63 and len(h.bits) == 63


def test_deep_types_assert_strictly_more_than_shallow_ones():
    """
    The ladder has to be ordered by how much it claims, because that is what makes trying the
    shallow ones first the cheap move. Computed from the masks, not asserted as a list.
    """
    counts = {t: build_hypothesis(t, MY_CALL, DX_CALL).asserted_bit_count for t in AP_TYPE_LABELS}
    assert counts[1] == counts[2] < counts[3] < counts[4] == counts[5] == counts[6]


def test_closing_hypotheses_assert_the_whole_payload_and_leave_the_crc_free():
    """
    WSJT-X's `apmask(1:77)=1` for types 4-6 pins the message and leaves the FT8 CRC free. The
    z-30 equivalent pins all 63 payload bits and stops - if the 14 CRC bits were asserted too,
    there would be nothing left to test the hypothesis against and every hypothesis would
    "succeed".
    """
    for ap_type in (4, 5, 6):
        h = build_hypothesis(ap_type, MY_CALL, DX_CALL)
        assert sum(h.mask) == 63, "a closing hypothesis must assert every payload bit"
        assert len(h.mask) == 63, "the AP mask must not extend into the CRC or the parity bits"


def test_hypotheses_are_refused_without_usable_callsigns():
    """WSJT-X's `apsym(1).gt.1` / `apsym(30).gt.1` bail-outs, in z-30 terms."""
    # Type 1 needs neither callsign - a CQ is a CQ.
    assert build_hypothesis(1, "", "") is not None

    for bad in ("", "NOCAL", "W1AW/P", "EA8/G4XYZ", "3DA0RS"):
        assert not callsign_round_trips(bad), f"{bad} unexpectedly round-trips"
        assert build_hypothesis(2, bad, DX_CALL) is None, f"type 2 accepted {bad!r} as my callsign"
        assert build_hypothesis(3, MY_CALL, bad) is None, f"type 3 accepted {bad!r} as the DX callsign"

    # And a callsign that DOES round-trip is accepted, so the guard is not just always-false.
    assert build_hypothesis(3, MY_CALL, DX_CALL) is not None


def test_the_stage_ladder_only_names_known_types():
    for stage, ladder in AP_STAGE_LADDER.items():
        assert ladder, f"stage {stage} has an empty ladder"
        for ap_type in ladder:
            assert ap_type in AP_TYPE_LABELS, f"stage {stage} names unknown AP type {ap_type}"
        assert len(set(ladder)) == len(ladder), f"stage {stage} repeats an AP type"


def test_an_unknown_stage_produces_no_hypotheses():
    assert build_ap_hypotheses("SOME_FUTURE_STAGE", MY_CALL, DX_CALL) == []


def test_the_frequency_gate_admits_and_refuses_by_distance():
    """
    The gate is measured against `AP_FREQ_WINDOW_HZ` at both edges, so a change to the constant
    moves both assertions together rather than leaving one hard-coded to the old value.
    """
    worked = 1500.0
    inside = build_ap_hypotheses(
        "SENDING_REPORT", MY_CALL, DX_CALL,
        candidate_freq_hz=worked + AP_FREQ_WINDOW_HZ - 1.0, worked_freqs_hz=(worked,),
    )
    outside = build_ap_hypotheses(
        "SENDING_REPORT", MY_CALL, DX_CALL,
        candidate_freq_hz=worked + AP_FREQ_WINDOW_HZ + 1.0, worked_freqs_hz=(worked,),
    )
    assert any(h.ap_type >= AP_DEEP_TYPE for h in inside), "deep types refused inside the window"
    assert not any(h.ap_type >= AP_DEEP_TYPE for h in outside), "deep types allowed outside the window"

    # A split station is working two frequencies; being near either one is enough (WSJT-X
    # compares against both nfqso and nftx).
    split = build_ap_hypotheses(
        "SENDING_REPORT", MY_CALL, DX_CALL,
        candidate_freq_hz=2400.0, worked_freqs_hz=(1000.0, 2400.0),
    )
    assert any(h.ap_type >= AP_DEEP_TYPE for h in split)


def test_shallow_types_ignore_the_frequency_gate():
    """
    Types 1 and 2 assert 28 bits and are permitted passband-wide, which is what lets a call to
    you be found in a corner you were not watching.
    """
    far = build_ap_hypotheses(
        "IDLE", MY_CALL, DX_CALL, candidate_freq_hz=250.0, worked_freqs_hz=(2900.0,)
    )
    assert [h.ap_type for h in far] == [1, 2]


def test_no_candidate_frequency_means_the_gate_does_not_fire():
    unfiltered = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)
    assert [h.ap_type for h in unfiltered] == list(AP_STAGE_LADDER["SENDING_REPORT"])


# ------------------------------------------------------------------ guards and reporting


def test_hypothesis_holds_detects_a_contradicted_assertion():
    h = build_hypothesis(3, MY_CALL, DX_CALL)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_73), dtype=np.uint8)
    assert hypothesis_holds(truth, h)

    for flip in (0, 13, 27, 28, 55):
        tampered = truth.copy()
        tampered[flip] ^= 1
        assert not hypothesis_holds(tampered, h), f"a flipped asserted bit at {flip} was not caught"

    # A bit OUTSIDE the assertion is none of the hypothesis's business.
    free = truth.copy()
    free[60] ^= 1
    assert hypothesis_holds(free, h)


def test_hypothesis_holds_rejects_a_short_payload():
    h = build_hypothesis(2, MY_CALL)
    assert not hypothesis_holds(np.zeros(10, dtype=np.uint8), h)


def test_describe_ap_decode_labels_only_ap_recovered_frames(codec):
    from z30_dsp.ap_decode import ApDecodeResult

    ordinary = ApDecodeResult(True, np.zeros(77, dtype=np.uint8), 4, 0, "", 0)
    assert describe_ap_decode(ordinary) == ""

    for ap_type in AP_TYPE_LABELS:
        recovered = ApDecodeResult(True, np.zeros(77, dtype=np.uint8), 9, ap_type,
                                   AP_TYPE_LABELS[ap_type], 1)
        assert describe_ap_decode(recovered) == f"a{ap_type}"

    failed = ApDecodeResult(False, np.zeros(77, dtype=np.uint8), 150, 0, "", 4)
    assert describe_ap_decode(failed) == ""


def test_payload_extra_code_reads_the_modifier_field():
    for extra in (0, EXTRA_RRR, EXTRA_73, EXTRA_RR73, 127):
        payload = pack_payload63(MY_CALL, DX_CALL, extra)
        assert payload_extra_code(np.array(payload, dtype=np.uint8)) == extra


def test_ap_mask_longer_than_the_code_is_refused(codec):
    llr = np.zeros(216, dtype=np.float32)
    with pytest.raises(ValueError):
        codec.decode_min_sum(llr, ap_mask=np.ones(217, dtype=np.uint8))


def test_a_63_bit_mask_is_zero_extended_over_the_parity_bits(codec):
    """
    Callers assert payload bits and pass a 63-entry mask; the decoder must treat the remaining
    153 positions as measurements, not as silently asserted zeros.
    """
    rng = np.random.default_rng(31)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    codeword = codec.encode(truth)
    llr = noisy_llrs(codeword, 3.0, rng)
    h = build_hypothesis(6, MY_CALL, DX_CALL)

    ap_llr = apply_ap_hypothesis(llr, h.mask, h.bits)
    assert np.array_equal(ap_llr[63:], llr[63:]), "positions past the mask were rewritten"

    ok, info, _ = codec.decode_min_sum(ap_llr, ap_mask=h.mask)
    assert ok and np.array_equal(info[:63], truth)


# ------------------------------------------------------------------ the statistic


def test_mcnemar_matches_an_independently_summed_binomial():
    """
    The p-value the AP benchmark reports is checked against the binomial tail summed a different
    way, for every small table. A statistic nobody can recompute is not evidence, which is the
    whole point of AGENTS.md section 5 asking for "an exact p-value ... something a reader can
    check".
    """
    from z30_dsp.benchmark import ap_mcnemar_exact_p

    for b in range(0, 13):
        for c in range(0, 13):
            n = b + c
            if n == 0:
                assert ap_mcnemar_exact_p(b, c) == 1.0
                continue
            k = min(b, c)
            # Independent route to the same number: the probability mass function, term by term.
            tail = sum(math.factorial(n) / (math.factorial(i) * math.factorial(n - i)) * 0.5 ** n
                       for i in range(k + 1))
            assert ap_mcnemar_exact_p(b, c) == pytest.approx(min(1.0, 2.0 * tail), rel=1e-12)


def test_mcnemar_is_symmetric_and_bounded():
    from z30_dsp.benchmark import ap_mcnemar_exact_p

    for b in range(0, 20):
        for c in range(0, 20):
            p = ap_mcnemar_exact_p(b, c)
            assert p == pytest.approx(ap_mcnemar_exact_p(c, b))
            assert 0.0 <= p <= 1.0
    # A lopsided table is significant; an even one is not.
    assert ap_mcnemar_exact_p(20, 0) < 1e-5
    assert ap_mcnemar_exact_p(10, 10) > 0.5


# ------------------------------------------------------------------ the benchmark population


def test_scenario_payloads_are_reproducible_and_correctly_labelled():
    """
    The AP sweep's band model has to be a pure function of the seed, like everything else in
    benchmark.py, and its in-QSO flag has to actually describe the payload it returns - the flag
    is what splits the reported gain from the reported cost.
    """
    from z30_dsp.benchmark import (
        AP_SCENARIO_DX_CALL,
        AP_SCENARIO_MY_CALL,
        ap_scenario_payload,
    )

    first = [ap_scenario_payload(np.random.default_rng(4242)) for _ in range(1)]
    rng_a = np.random.default_rng(4242)
    rng_b = np.random.default_rng(4242)
    for _ in range(40):
        pa, ia = ap_scenario_payload(rng_a)
        pb, ib = ap_scenario_payload(rng_b)
        assert np.array_equal(pa, pb) and ia == ib, "the same seed produced a different band"

        to_call, from_call, _extra = unpack_payload63(pa.tolist())
        if ia:
            assert (to_call, from_call) == (AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL)
        else:
            assert (to_call, from_call) != (AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL)
    assert first  # the single draw above is only here to prove a fresh generator is usable


def test_scenario_produces_both_populations():
    """A 'paired' comparison with only one population in it would measure half the question."""
    from z30_dsp.benchmark import ap_scenario_payload

    rng = np.random.default_rng(2026)
    flags = [ap_scenario_payload(rng)[1] for _ in range(200)]
    assert any(flags) and not all(flags), "the modelled band is entirely one kind of traffic"


def test_foreign_callsigns_are_drawn_usable_and_distinct():
    from z30_dsp.benchmark import (
        AP_SCENARIO_DX_CALL,
        AP_SCENARIO_MY_CALL,
        random_standard_callsign,
    )

    rng = np.random.default_rng(77)
    excluded = (AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL)
    drawn = [random_standard_callsign(rng, exclude=excluded) for _ in range(60)]
    for call in drawn:
        assert call not in excluded
        assert callsign_round_trips(call), f"{call} does not survive the 28-bit packing"
        assert decode_callsign28(encode_callsign28(call)) == call
    assert len(set(drawn)) > 1, "the foreign population is a single repeated callsign"


def test_paired_outcome_shares_one_demodulation():
    """
    The pairing itself. `decode_prepared_frame_paired` must hand both arms the same LLRs, and
    the plain arm of the pair must agree with the ordinary `decode_prepared_frame` on the same
    job - otherwise the comparison is between two receivers, not two decoders.
    """
    from z30_dsp.benchmark import (
        _prepare_frame,
        decode_prepared_frame,
        decode_prepared_frame_paired,
    )
    from z30_dsp.channel import ChannelImpairments
    from z30_dsp.modem import Z30Config, Z30Modulator

    cfg = Z30Config(sample_rate_hz=6000)
    codec_local = Z30LdpcCodec()
    modulator = Z30Modulator(cfg)
    impairments = ChannelImpairments(max_freq_offset_hz=5.0, max_time_offset_sec=0.5, fading="none")
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)

    rng = np.random.default_rng(555)
    payload = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    job, _s, _f = _prepare_frame(0, -21.0, codec_local, cfg, modulator, rng, "realistic",
                                 impairments, 0.5, payload)

    reference = decode_prepared_frame(job, cfg, codec_local)
    paired = decode_prepared_frame_paired(job, cfg, codec_local, hypotheses, True)

    assert paired.plain_success == reference.success, (
        "the paired plain arm disagreed with the ordinary decode of the same frame"
    )
    assert paired.in_qso is True
    # AP is a superset by construction, so this holds at every SNR, decoded or not.
    assert paired.ap_success or not paired.plain_success


def test_hypotheses_are_frozen_records():
    """
    `ApHypothesis` crosses into the decoder, which must not be able to edit the caller's
    assertion. Frozen and tuple-valued, so an accidental in-place mask edit is a TypeError
    rather than a hypothesis that quietly means something else on the next frame.
    """
    h = build_hypothesis(3, MY_CALL, DX_CALL)
    assert isinstance(h, ApHypothesis)
    assert isinstance(h.mask, tuple) and isinstance(h.bits, tuple)
    with pytest.raises(Exception):
        h.mask = ()  # type: ignore[misc]
