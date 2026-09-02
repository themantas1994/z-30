"""
z-30 message field packing - the Python twin of the callsign half of src/dsp/z30Codec.ts.
==========================================================================================

The 63-bit z-30 payload is three fields:

    bits  0..27   destination callsign, 28 bits (Radix-37 prefix / digit / Radix-27 suffix)
    bits 28..55   source callsign, 28 bits, same encoding
    bits 56..62   grid / report / modifier, 7 bits

Only the two callsign fields and the three modifier codes are implemented here, because those
are exactly the fields a priori decoding asserts (see z30_dsp/ap_decode.py). The 7-bit grid
table and the report arithmetic stay in `src/dsp/z30Codec.ts` alone: a second copy of the
64-entry `COMMON_GRIDS` table would be a second place for it to drift, and nothing on the
Python side reads a grid. AGENTS.md's "one source of truth per rule" cuts both ways - do not
port a rule here to have it nearby, port it because something here needs it.

What is here is checked against the TypeScript original by
`tests/test_cross_language_parity.py`, which drives both implementations over the shared
vectors in `tests/vectors/callsign_vectors.json` and asserts identical 28-bit integers. That is
the same arrangement `tests/vectors/crc14_vectors.json` already uses for the CRC, and it exists
for the same reason: two implementations of one encoding agree until the day they quietly do
not, and both halves go on working perfectly on their own while they disagree about what is on
the air.
"""

from typing import List, Optional, Tuple
import re

#: Bit offsets and widths of the three payload fields, MSB-first within each field.
#: The twin of the layout documented at the top of src/dsp/z30Codec.ts.
FIELD_CALL_TO: Tuple[int, int] = (0, 28)
FIELD_CALL_FROM: Tuple[int, int] = (28, 28)
FIELD_EXTRA: Tuple[int, int] = (56, 7)

#: Payload width, and the width once the CRC-14 is appended.
PAYLOAD_BITS: int = 63
INFO_BITS: int = 77

#: The three 7-bit modifier codes `packZ30Message` assigns to the closing messages of a QSO.
#: Reports occupy 0..60 (report + 30) and grids occupy 64..127; these three sit between.
EXTRA_RRR: int = 61
EXTRA_73: int = 62
EXTRA_RR73: int = 63

#: The reserved low callsign values. `encodeCallsign28` maps these tokens to fixed integers
#: rather than through the radix packing, and `decodeCallsign28` maps them back.
CALL_TOKENS = {
    "CQ": 0,
    "CQ DX": 1,
    "CQ TEST": 2,
    "QRZ": 3,
}

#: What Station Settings stores before an operator has entered a real callsign. The twin of
#: `PLACEHOLDER_CALLSIGN` in src/dsp/z30Constants.ts. A frame from this station cannot be
#: asserted as a priori knowledge, because it is not knowledge - it is a default.
PLACEHOLDER_CALLSIGN: str = "NOCAL"

_STANDARD_CALL = re.compile(r"^([A-Z0-9]{1,2})([0-9])([A-Z]{1,3})$")


def _char_to_prefix(c: str) -> int:
    """Radix-37 prefix alphabet: space=0, '0'-'9'=1..10, 'A'-'Z'=11..36."""
    if c == " ":
        return 0
    if "0" <= c <= "9":
        return ord(c) - 48 + 1
    return ord(c) - 65 + 11


def _char_to_suffix(c: str) -> int:
    """Radix-27 suffix alphabet: space=0, 'A'-'Z'=1..26."""
    return 0 if c == " " else ord(c) - 65 + 1


def _prefix_to_char(v: int) -> str:
    if v == 0:
        return ""
    return chr(48 + v - 1) if v <= 10 else chr(65 + v - 11)


def _suffix_to_char(v: int) -> str:
    return "" if v == 0 else chr(65 + v - 1)


def encode_callsign28(call: str) -> int:
    """
    Packs an amateur callsign or operational token into 28 bits.

    The twin of `encodeCallsign28` in src/dsp/z30Codec.ts, transcribed operation for operation.
    Standard `[1-2 prefix][digit][1-3 suffix]` callsigns take the radix path; anything else
    falls through to the generic Base-37 accumulator, which is lossy - see
    `callsign_round_trips`, which is how a caller finds out.
    """
    clean = re.sub(r"[^A-Z0-9 ]", "", call.strip().upper())
    if not clean or clean == "CQ":
        return 0
    if clean in CALL_TOKENS:
        return CALL_TOKENS[clean]

    formatted = clean[:6]
    match = _STANDARD_CALL.match(formatted)
    if match:
        prefix = match.group(1)
        p_str = (" " + prefix) if len(prefix) == 1 else prefix
        d_val = int(match.group(2))
        s_str = match.group(3).ljust(3, " ")

        p_val = _char_to_prefix(p_str[0]) * 37 + _char_to_prefix(p_str[1])
        s_val = (
            _char_to_suffix(s_str[0]) * 729
            + _char_to_suffix(s_str[1]) * 27
            + _char_to_suffix(s_str[2])
        )
        packed = p_val * (10 * 19683) + d_val * 19683 + s_val + 100
        return packed & 0x0FFFFFFF

    acc = 0
    for c in formatted[:6]:
        if "0" <= c <= "9":
            val = ord(c) - 48 + 1
        elif "A" <= c <= "Z":
            val = ord(c) - 65 + 11
        else:
            val = 0
        acc = (acc * 37 + val) & 0x0FFFFFFF
    return (acc + 1000) & 0x0FFFFFFF


def decode_callsign28(num: int) -> str:
    """
    Unpacks a 28-bit callsign field. The twin of `decodeCallsign28` in src/dsp/z30Codec.ts.

    Returns 'DX' for a value that does not correspond to a standard callsign, which is what the
    TypeScript implementation returns and is deliberately not a callsign anyone holds.
    """
    for token, value in CALL_TOKENS.items():
        if num == value:
            return token
    if num < 100:
        return "CQ"

    val = num - 100
    s_val = val % 19683
    rem1 = val // 19683
    d_val = rem1 % 10
    p_val = rem1 // 10

    if p_val < 37 * 37:
        prefix = (_prefix_to_char(p_val // 37) + _prefix_to_char(p_val % 37)).strip()
        suffix = (
            _suffix_to_char(s_val // 729)
            + _suffix_to_char((s_val % 729) // 27)
            + _suffix_to_char(s_val % 27)
        ).strip()
        if prefix and suffix:
            return f"{prefix}{d_val}{suffix}"

    return "DX"


def callsign_round_trips(call: str) -> bool:
    """
    Whether this callsign survives `encode_callsign28` -> `decode_callsign28` unchanged.

    This is the z-30 analogue of WSJT-X's `ft8apset`, which packs a dummy standard message,
    unpacks it again and refuses to supply any a priori symbols unless `msg.eq.msgchk`. The
    check is not decoration. A callsign that takes the generic Base-37 fallback - a special
    event call, a `/P` suffix, anything longer than six characters - packs to an integer that
    does not unpack back to it, so asserting those 28 bits as certain would be asserting a
    callsign nobody transmitted, and every hypothesis built on it is guaranteed wrong.

    The placeholder callsign is rejected for a different reason: it round-trips perfectly, but
    it is what Station Settings holds before the operator has entered anything, so it is a
    default rather than knowledge.
    """
    clean = call.strip().upper()
    if not clean or clean == PLACEHOLDER_CALLSIGN or clean in CALL_TOKENS:
        return False
    return decode_callsign28(encode_callsign28(clean)) == clean


def int_to_bits(value: int, width: int) -> List[int]:
    """MSB-first bit expansion of `value` in `width` bits, the order the payload is packed in."""
    return [(value >> (width - 1 - i)) & 1 for i in range(width)]


def bits_to_int(bits: "List[int]") -> int:
    """MSB-first integer value of a bit sequence."""
    value = 0
    for bit in bits:
        value = (value << 1) | (int(bit) & 1)
    return value


def pack_payload63(call_to: str, call_from: str, extra_code: int) -> List[int]:
    """
    The 63 payload bits for a `<to> <from> <extra>` message.

    The twin of the field-packing block at the end of `packZ30Message`, without the text
    tokenizer in front of it: callers here already know which field is which, and reproducing
    the tokenizer would be reproducing the grid table with it.
    """
    if not 0 <= extra_code < 128:
        raise ValueError(f"extra_code must be a 7-bit value; got {extra_code}")
    return (
        int_to_bits(encode_callsign28(call_to), 28)
        + int_to_bits(encode_callsign28(call_from), 28)
        + int_to_bits(extra_code, 7)
    )


def unpack_payload63(payload: "List[int]") -> Tuple[str, str, int]:
    """The `(to, from, extra_code)` a 63-bit payload carries."""
    if len(payload) < PAYLOAD_BITS:
        raise ValueError(f"payload must be {PAYLOAD_BITS} bits; got {len(payload)}")
    bits = [int(b) & 1 for b in payload[:PAYLOAD_BITS]]
    return (
        decode_callsign28(bits_to_int(bits[0:28])),
        decode_callsign28(bits_to_int(bits[28:56])),
        bits_to_int(bits[56:63]),
    )


def field_slice(field: Tuple[int, int]) -> "range":
    """The payload bit indices one of the FIELD_* constants covers."""
    offset, width = field
    return range(offset, offset + width)


def extra_code_for_report(report_db: int) -> Optional[int]:
    """
    The 7-bit code `packZ30Message` assigns to a signal report, or None if out of range.

    `Math.max(0, Math.min(60, num + 30))` in TypeScript clamps rather than rejects; this returns
    None instead, because a caller building an a priori hypothesis needs to know the report it
    asked for is not the report that would be transmitted. Silently clamping -40 to -30 would
    assert seven bits of a message the other station never sent.
    """
    code = report_db + 30
    return code if 0 <= code <= 60 else None
