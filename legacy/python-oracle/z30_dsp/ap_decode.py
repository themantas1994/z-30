"""
z-30 a priori (AP) decoding - the hypothesis ladder and the constrained decode.
==============================================================================

A ported idea, and the port is the interesting part
---------------------------------------------------
WSJT-X has decoded FT8 with a priori information since v1.8. The mechanism lives in
`lib/ft8/ft8b.f90` and `lib/ft8/bpdecode174_91.f90`: when an ordinary decode fails, the decoder
is re-run with some of the message bits *asserted* rather than measured, the assertion drawn
from what the QSO state machine already knows must be in the message - the operator's own
callsign, the callsign they are working, and for the closing messages the whole exchange. The
14-bit CRC then decides whether the assertion was right. A wrong hypothesis fails its CRC and
costs nothing but time; a right one recovers a frame that had too few good bits to close on its
own.

The gain is not a decoder improvement. It is information the receiver genuinely has and was
throwing away: a station answering your CQ *has* to have put your callsign in the first field,
so those 28 bits were never in question, and spending channel evidence to re-derive them is
spending it twice.

Four mechanisms carry over verbatim, and each is here for the reason WSJT-X has it:

  * **`apmag` scales with the frame.** `AP_LLR_MARGIN * max|LLR|` (WSJT-X's
    `apmag=maxval(abs(llra))*1.01`), computed in `z30_dsp.ldpc.ap_llr_magnitude`. See the
    constant's own note for why a fixed magnitude cannot work.
  * **Asserted bits are pinned, not merely biased.** `decode_min_sum(..., ap_mask=...)` holds
    them at their asserted value for every iteration, WSJT-X's `zn(i)=llr(i)`. Substituting a
    large LLR and letting belief propagation update it normally would let a run of confident
    check messages walk an asserted bit back, which is the one thing the assertion exists to
    prevent.
  * **The CRC is the arbiter, so AP never runs first.** An ordinary decode is attempted before
    any hypothesis, and a hypothesis is only accepted on a CRC-valid codeword. Every AP frame
    is therefore a frame that failed to decode on its own.
  * **The deep hypotheses are gated by frequency.** Types 3 and up assert 56 or 63 bits, which
    is most of the message; WSJT-X only permits those within `napwid` Hz of the frequency the
    operator is actually working (`AP_FREQ_WINDOW_HZ` here). Off in the corner of the passband
    there is no reason to believe the QSO state applies, and each extra hypothesis is another
    2^-14 roll of the CRC dice.

What that last point costs, stated plainly
-------------------------------------------
AP is not free. Each hypothesis is an additional codeword the CRC-14 has to reject, so a
station running the four-hypothesis ladder gives the receiver five chances (one ordinary, four
AP) to accept a wrong message instead of one. On random errors that is a false-accept
probability of roughly `5 * 2^-14` per candidate instead of `2^-14` - about 3.1e-4 against
6.1e-5. That is the trade WSJT-X makes too, and it is why the ladder is short, why it is
ordered by how likely the hypothesis is *given the QSO state*, and why the deep types are
frequency-gated. It is also why `decode_with_ap` re-checks the asserted fields in the accepted
payload rather than trusting that pinning made that impossible.

The measured effect on z-30 is in
[`wiki/17`](../wiki/17-A-Priori-(AP)-Decoding.md); `benchmark.py --ap` is the instrument.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .ldpc import Z30LdpcCodec, apply_ap_hypothesis
from .message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    FIELD_CALL_FROM,
    FIELD_CALL_TO,
    FIELD_EXTRA,
    PAYLOAD_BITS,
    bits_to_int,
    callsign_round_trips,
    encode_callsign28,
    field_slice,
    int_to_bits,
)

#: Half-width, in Hz, of the window around the worked frequency inside which the deep AP
#: hypotheses (types 3 and up) are permitted.
#:
#: WSJT-X sets `napwid=75` in `lib/jt9.f90` and applies it as
#: `abs(f1-nfqso).gt.napwid .and. abs(f1-nftx).gt.napwid` - the candidate has to be near either
#: the receive frequency or the transmit frequency. z-30 occupies the same 50 Hz an FT8 signal
#: does, so the number ports across unchanged: it is one signal width either side of the
#: carrier the operator is actually working.
#:
#: The twin of `AP_FREQ_WINDOW_HZ` in src/dsp/apDecode.ts, pinned by
#: tests/test_cross_language_parity.py.
AP_FREQ_WINDOW_HZ: float = 75.0

#: The lowest AP type that asserts more than one field, and so the lowest one the frequency
#: window applies to. Types 1 and 2 assert 28 bits and are cheap enough to try passband-wide,
#: which is what lets a CQ or a call to you be dug out of a corner you were not watching.
AP_DEEP_TYPE: int = 3

#: The AP hypothesis catalogue, adapted from the `iaptype` table in WSJT-X's `lib/ft8/ft8b.f90`.
#:
#: FT8 packs 28+28+15 bits plus a 3-bit message type; z-30 packs 28+28+7 and has no type field,
#: so the FT8 types' trailing `i3`/`n3` assertions have no counterpart here and the bit counts
#: differ. What is preserved is the ladder itself: which fields each hypothesis claims to know,
#: and in what order the QSO state makes them worth trying.
#:
#:   type  hypothesis              asserted fields                       payload bits asserted
#:   ----  ----------------------  ------------------------------------  ---------------------
#:    1    CQ     ???    ???       to = the CQ token                     28
#:    2    MyCall ???    ???       to = my callsign                      28
#:    3    MyCall DxCall ???       to = mine, from = theirs              56
#:    4    MyCall DxCall RRR       to, from, extra = RRR                 63
#:    5    MyCall DxCall 73        to, from, extra = 73                  63
#:    6    MyCall DxCall RR73      to, from, extra = RR73                63
#:
#: Types 4-6 assert every payload bit, leaving the 14 CRC bits as the only thing the channel
#: still has to supply - which is exactly WSJT-X's `apmask(1:77)=1`, where the FT8 CRC likewise
#: stays free. Asserting the CRC too would leave nothing to check the hypothesis against.
AP_TYPE_LABELS: Dict[int, str] = {
    1: "CQ ??? ???",
    2: "MyCall ??? ???",
    3: "MyCall DxCall ???",
    4: "MyCall DxCall RRR",
    5: "MyCall DxCall 73",
    6: "MyCall DxCall RR73",
}

#: The 7-bit modifier each closing hypothesis asserts.
AP_TYPE_EXTRA: Dict[int, int] = {4: EXTRA_RRR, 5: EXTRA_73, 6: EXTRA_RR73}

#: QSO stage -> the AP types to try, in order.
#:
#: The twin of WSJT-X's `naptypes(nQSOProgress,1:4)` table, mapped onto z-30's `QsoStage` union
#: (src/types/z30.ts). The orderings are WSJT-X's, stage for stage: while you are calling CQ the
#: likely frames are other CQs and answers to you; once you are exchanging reports the likely
#: frames are the closing messages of the QSO you are in; and at the 73 the ladder falls back
#: towards the general cases as the QSO winds down.
#:
#: The twin of `AP_STAGE_LADDER` in src/dsp/apDecode.ts, pinned by
#: tests/test_cross_language_parity.py.
AP_STAGE_LADDER: Dict[str, Tuple[int, ...]] = {
    "IDLE": (1, 2),
    "CALLING_CQ": (1, 2),
    "REPLYING_CQ": (2, 3),
    "SENDING_REPORT": (3, 4, 5, 6),
    "SENDING_R_REPORT": (3, 4, 5, 6),
    "SENDING_73": (3, 1, 2),
    "QSO_COMPLETED": (1, 2),
}


@dataclass(frozen=True)
class ApHypothesis:
    """
    One assertion about a frame's payload bits.

    `mask` and `bits` are 63 entries - the payload only. `decode_min_sum` zero-extends to 216,
    so nothing here ever asserts a parity bit: parity is what the code derives, and asserting it
    would be asserting the answer.
    """

    ap_type: int
    label: str
    mask: Tuple[int, ...]
    bits: Tuple[int, ...]

    @property
    def asserted_bit_count(self) -> int:
        return sum(self.mask)


@dataclass(frozen=True)
class ApDecodeResult:
    """
    What `decode_with_ap` made of one frame.

    `ap_type` is 0 for a frame that decoded on its own, which is the overwhelming majority of
    them; a nonzero value names the hypothesis that recovered it, the way WSJT-X reports
    `iaptype` alongside each decode so the operator can see which decodes leaned on assumed
    information.
    """

    success: bool
    info_bits: np.ndarray
    iterations: int
    ap_type: int
    ap_label: str
    hypotheses_tried: int


def _payload_assertion(fields: Sequence[Tuple[Tuple[int, int], int]]) -> Tuple[List[int], List[int]]:
    """Builds the (mask, bits) pair asserting each `(field, value)` and nothing else."""
    mask = [0] * PAYLOAD_BITS
    bits = [0] * PAYLOAD_BITS
    for field, value in fields:
        offset, width = field
        for i, bit in enumerate(int_to_bits(value, width)):
            mask[offset + i] = 1
            bits[offset + i] = bit
    return mask, bits


def build_hypothesis(
    ap_type: int,
    my_call: str,
    dx_call: str = "",
    cq_token: str = "CQ",
) -> Optional[ApHypothesis]:
    """
    The hypothesis for one AP type, or None when the station data cannot support it.

    Returns None rather than a weaker hypothesis. WSJT-X's guards are
    `if(iaptype.ge.2 .and. apsym(1).gt.1) cycle` and
    `if(iaptype.ge.3 .and. apsym(30).gt.1) cycle` - no usable callsign means the type is skipped
    outright, not tried with a placeholder. `callsign_round_trips` is the z-30 equivalent of the
    `msg.eq.msgchk` test `ft8apset` performs, and it rejects the same cases: a callsign that
    does not survive the 28-bit packing cannot be asserted, because the bits it would assert
    belong to a different callsign.
    """
    if ap_type not in AP_TYPE_LABELS:
        raise ValueError(f"unknown AP type {ap_type}; known types are {sorted(AP_TYPE_LABELS)}")

    if ap_type == 1:
        mask, bits = _payload_assertion([(FIELD_CALL_TO, encode_callsign28(cq_token))])
        return ApHypothesis(1, AP_TYPE_LABELS[1], tuple(mask), tuple(bits))

    if not callsign_round_trips(my_call):
        return None
    my_packed = encode_callsign28(my_call)

    if ap_type == 2:
        mask, bits = _payload_assertion([(FIELD_CALL_TO, my_packed)])
        return ApHypothesis(2, AP_TYPE_LABELS[2], tuple(mask), tuple(bits))

    if not callsign_round_trips(dx_call):
        return None
    dx_packed = encode_callsign28(dx_call)

    fields: List[Tuple[Tuple[int, int], int]] = [
        (FIELD_CALL_TO, my_packed),
        (FIELD_CALL_FROM, dx_packed),
    ]
    if ap_type in AP_TYPE_EXTRA:
        fields.append((FIELD_EXTRA, AP_TYPE_EXTRA[ap_type]))

    mask, bits = _payload_assertion(fields)
    return ApHypothesis(ap_type, AP_TYPE_LABELS[ap_type], tuple(mask), tuple(bits))


def build_ap_hypotheses(
    stage: str,
    my_call: str,
    dx_call: str = "",
    cq_token: str = "CQ",
    candidate_freq_hz: Optional[float] = None,
    worked_freqs_hz: Sequence[float] = (),
) -> List[ApHypothesis]:
    """
    The ordered hypothesis ladder for a QSO stage, already filtered by the gates.

    Args:
        stage: a `QsoStage` value (src/types/z30.ts). An unrecognised stage yields no
            hypotheses - AP is an optimisation, and a state machine that has grown a stage
            nobody wrote a ladder for should decode exactly as it did before, not guess.
        candidate_freq_hz: where in the passband this candidate was found. Omit it and the
            frequency gate does not apply, which is the right behaviour for the benchmark and
            for any caller with no frequency to compare against - but a live receiver has one
            and should pass it.
        worked_freqs_hz: the receive and transmit audio frequencies the operator is working.
            WSJT-X compares against both (`nfqso` and `nftx`), because in split operation the
            station you are working is not on the frequency you are transmitting on.
    """
    ladder = AP_STAGE_LADDER.get(stage.strip().upper(), ())
    near_worked = _within_ap_window(candidate_freq_hz, worked_freqs_hz)

    hypotheses: List[ApHypothesis] = []
    for ap_type in ladder:
        if ap_type >= AP_DEEP_TYPE and not near_worked:
            continue
        hypothesis = build_hypothesis(ap_type, my_call, dx_call, cq_token)
        if hypothesis is not None:
            hypotheses.append(hypothesis)
    return hypotheses


def _within_ap_window(
    candidate_freq_hz: Optional[float],
    worked_freqs_hz: Sequence[float],
) -> bool:
    """
    Whether a candidate is close enough to a worked frequency for the deep hypotheses.

    No candidate frequency, or no worked frequency to compare it against, means the gate cannot
    be evaluated and does not fire. That is deliberate: the gate exists to stop the deep types
    being tried across a passband the operator is not working, and a caller that has no notion
    of passband position (the benchmark decodes one frame at a time, at one carrier) is not the
    situation it guards against.
    """
    if candidate_freq_hz is None:
        return True
    usable = [f for f in worked_freqs_hz if f is not None and f > 0]
    if not usable:
        return True
    return any(abs(candidate_freq_hz - f) <= AP_FREQ_WINDOW_HZ for f in usable)


def hypothesis_holds(info_bits: "np.ndarray | Sequence[int]", hypothesis: ApHypothesis) -> bool:
    """
    Whether a decoded payload really carries what the hypothesis asserted.

    Pinning is supposed to make this impossible to fail, and in the decoder as it stands it
    cannot: `decode_min_sum` holds pinned variables at their asserted value and excludes them
    from the OSD flip set. This is checked anyway because the consequence of it ever becoming
    possible - a decoder change, a mask off by one field - is a frame reported to the operator
    and written to the log under a callsign that was assumed rather than received. A guard that
    can only fire when something else is already wrong is exactly the guard worth keeping.
    """
    bits = np.asarray(info_bits, dtype=np.uint8)
    if bits.size < PAYLOAD_BITS:
        return False
    for i in range(PAYLOAD_BITS):
        if hypothesis.mask[i] and int(bits[i]) != hypothesis.bits[i]:
            return False
    return True


def decode_with_ap(
    codec: Z30LdpcCodec,
    llr_channel: "np.ndarray",
    hypotheses: Sequence[ApHypothesis] = (),
) -> ApDecodeResult:
    """
    An ordinary decode, and then - only if it failed - each hypothesis in turn.

    The ordering is the whole safety argument. A frame that decodes on its own is returned by
    the same code path it always was, with `ap_type=0`, having been through no AP machinery at
    all; AP can therefore add decodes but cannot change or lose one. That is WSJT-X's structure
    too, where AP occupies passes 4 onwards and passes 1-3 are the ordinary ones.
    """
    success, info_bits, iterations = codec.decode_min_sum(llr_channel)
    if success:
        return ApDecodeResult(True, info_bits, iterations, 0, "", 0)

    total_iterations = iterations
    for tried, hypothesis in enumerate(hypotheses, start=1):
        ap_llrs = apply_ap_hypothesis(llr_channel, hypothesis.mask, hypothesis.bits)
        ok, ap_info, ap_iters = codec.decode_min_sum(ap_llrs, ap_mask=hypothesis.mask)
        total_iterations += ap_iters
        if ok and hypothesis_holds(ap_info, hypothesis):
            return ApDecodeResult(
                True, ap_info, total_iterations, hypothesis.ap_type, hypothesis.label, tried
            )

    return ApDecodeResult(False, info_bits, total_iterations, 0, "", len(hypotheses))


def describe_ap_decode(result: ApDecodeResult) -> str:
    """
    A short operator-facing tag for a decode, or the empty string for an ordinary one.

    WSJT-X prints `iaptype` next to each decode for a reason: a frame recovered by assuming your
    own callsign was in it is a weaker claim than one decoded from the air alone, and an
    operator logging a contact is entitled to know which they are looking at.
    """
    if not result.success or result.ap_type == 0:
        return ""
    return f"a{result.ap_type}"


def payload_extra_code(info_bits: "np.ndarray | Sequence[int]") -> int:
    """The 7-bit modifier field of a decoded payload."""
    bits = [int(b) & 1 for b in np.asarray(info_bits, dtype=np.uint8)[:PAYLOAD_BITS]]
    return bits_to_int([bits[i] for i in field_slice(FIELD_EXTRA)])
