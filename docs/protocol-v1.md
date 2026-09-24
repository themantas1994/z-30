# Protocol v1

`SPEC.md` is normative; `crates/z30-protocol` is its executable form; `fixtures/golden/` pins
both against the frozen Python/TypeScript oracle. This page is the guided tour. **Nothing in
this crate may change without a protocol decision:** every station on the air stops decoding
you.

## The frame at a glance

| Quantity | Value | Where |
| :--- | :--- | :--- |
| Modulation | 16-FSK, continuous phase, GFSK BT = 2.0, constant envelope | `gfsk.rs` |
| Tone spacing / symbol | 3.125 Hz / 0.320 s | `lib.rs` |
| Symbols | 75 = 21 Costas sync + 54 data (4 bits each) | `SYNC_POSITIONS`, `DATA_POSITIONS` |
| Frame / slot | 24.0 s in a 30 s UTC slot, starting at the slot boundary | `FRAME_SEC`, `SLOT_SEC` |
| Amplitude shaping | one 20 ms raised-cosine ramp at each end, nothing per symbol | `FRAME_RAMP_SEC` |
| Occupied bandwidth | ~50 Hz nominal; the gate uses the measured -40 dB width, 66 Hz | `OCCUPIED_40DB_HZ` |
| Information | 77 bits = 63 payload + 14 CRC | `K`, `PAYLOAD_BITS`, `CRC_BITS` |
| CRC-14 | register 0x2443, init 0x2757, MSB-first | `crc.rs` |
| FEC | IRA LDPC (216, 77), dual-diagonal parity, degree-5 checks | `ldpc.rs` |

Costas positions: `0 1 2 7 8 9 17 18 19 27 28 29 37 38 39 47 48 49 72 73 74`. The tones at
those positions are fixed in `SYNC_TONES`. `tests/test_cross_language_parity.py` and
`crates/z30-protocol/tests/golden.rs` both pin them.

## Golden parity (gate G2.1)

`crates/z30-protocol/tests/golden.rs` and `crates/z30-dsp/tests/golden_ldpc.rs` assert against
`fixtures/golden/`:

- codec bits, CRC, LDPC encoding and symbol mapping: **bit-exact**;
- the waveform at 6, 12 and 48 kHz: **within 1e-6** of the oracle;
- the LDPC decoder: the same verdict, the same 77 bits and the same iteration count on all 540
  corpus frames, the 7-frame OSD corpus and the AP corpus (see [ldpc.md](ldpc.md)).

CI regenerates the vectors from the oracle and fails if they differ by a byte
(`reference/golden/generate.py --check`).

## The codec's one rule

**A message that cannot round-trip through the codec exactly is never encoded.**
`Message::encode` re-decodes its own output before returning it. The transmit gate checks again
(`MessageNotEncodable`, `MessageNotFromStation`).

The shipped TypeScript packer accepted anything and transmitted whatever its lossy paths
produced:

- another station's callsign: `ZY2ABC` went out as `24BWE` and `EA8/G4XYZ` as `Y43OAP` (C5);
- a different real grid: `FN42` went out as `RE78` (H2);
- a report without its roger: `R-12` went out as `-12` (H3);
- free text turned into callsign fields (M6).

vNext refuses each of these with a reason the operator can act on (`CodecError`):

| Refusal | Example |
| :--- | :--- |
| `NotStandardCallsign` | `G4XYZ/P`, `EA8/G4XYZ`, `3DA0XYZ`, `K1ABCD` |
| `CallsignOutOfRange` | `ZY2ABC` (prefixes `ZV` upward wrap the 28-bit field) |
| `PlaceholderCallsign` | `NOCAL` |
| `MalformedGrid` / `GridNotInTable` | `FN4`, `FN42` |
| `BadReport` | `-31`, `+35` |
| `RogerNotRepresentable` | `R-12` |
| `Unparseable` | `HELLO WORLD` |

On receive the rule runs the other way. A field value that is not the canonical encoding of
anything (call values 4–99, a prefix index ≥ 1369, a suffix with interior padding, extra code
127) is reported as unrepresentable. It is never rendered as a plausible callsign or grid.

The property tests in `crates/z30-protocol/tests/properties.rs` generate arbitrary standard
callsigns, grids and reports. They check that every accepted message round-trips and every
refused one is refused for the stated reason.

## What v1 cannot carry

These are limits of the wire format, not of the software, and the software says so:

- **No roger bit.** A report sent in reply to a report carries the roger by its place in the
  sequence (see `z30_engine::qso`). The GUI never displays an `R` that was not sent.
- **63 grids.** The grid table in `SPEC.md` section 6.2 is all v1 has. A station outside it
  cannot send its grid, and v1 has no "no grid" code either, so vNext refuses the CQ rather
  than sending a different grid. Assigning code 127 as "no grid" would be a wire change, since
  old receivers decode 127 as `FN31`. That decision belongs to the operator.
- **Standard callsigns only**, with prefixes below `ZV`. No portable or compound calls.

## Protocol v2

Not implemented. `SPEC.md` section 12 sets out the options: 86 bits with a roger flag and an
FT8-style grid/report field. The (216, 77) code cannot carry that payload, so v2 means either
a rate-0.40 code in the same 54 data symbols or 60 data symbols. Either is a wire-format break,
needs a measured trade study with a candidate code, and needs operator approval.
