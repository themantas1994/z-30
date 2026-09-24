# LDPC, CRC, OSD and AP

The code is defined in `crates/z30-protocol/src/ldpc.rs` (connection table, parity structure,
encoder). The decoder is in `crates/z30-dsp/src/ldpc.rs`, and a priori decoding in
`crates/z30-dsp/src/ap.rs`. `SPEC.md` section 7 is normative.

## The code

Systematic IRA (216, 77), rate 0.356. H = [H_info | H_parity]. Each of the 139 checks
touches five information bits (`CHECK_TO_INFO`, degree 5, girth 6), and H_parity is
dual-diagonal, so encoding is a running XOR. The 77 information bits are 63 payload bits and
the 14-bit CRC (register 0x2443, init 0x2757, MSB-first).

## The cascade (bit-exact with the oracle)

Four layered schedules run in order until one succeeds:

| # | Mode | α | β | damping | order | iterations |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | normalised offset min-sum | 0.82 | 0.08 | 0.88 | forward | 45 |
| 2 | sum-product | 0.95 | 0 | 0.85 | forward | 40 |
| 3 | normalised offset min-sum | 0.74 | 0.04 | 0.90 | reverse | 35 |
| 4 | min-sum on dithered LLRs | 0.80 | 0.06 | 0.85 | forward | 30 |

After every iteration a schedule succeeds in either of two ways. The hard decision has zero
syndrome and a matching CRC (`BeliefPropagation(n)`). Or the payload's CRC matches the received
CRC field, and the re-encoded codeword correlates positively with the channel LLRs and differs
from the hard decision in ≤ 12 bits (`Trellis(n)`). A frame whose raw hard decision is already
a valid codeword reports `HardDecision`. Iterations are counted cumulatively (at most 150).

**Bit-exact** means the same verdict, the same 77 bits and the same cumulative iteration count
as `Z30LdpcCodec.decode_min_sum` on every golden vector. Achieving that requires NumPy 2
(NEP 50) float semantics, which the audit's proof-of-concept established and `ldpc.rs`
transcribes:

- every message and belief is f32;
- Python-float constants are rounded to f32 before use;
- `1 − damping` is formed in f64 and then rounded;
- the dither is added in f64 and rounded;
- correlations use NumPy's pairwise f32 summation.

Schedule 4's dither is mulberry32, seeded by FNV-1a over the quantised LLRs. The decoder is
therefore a pure function of its input, which is the determinism rule in `AGENTS.md`
section 4.

Tests (`crates/z30-dsp/tests/golden_ldpc.rs`):

| Test | Corpus |
| :--- | :--- |
| `dither_matches_the_oracle` | the dither vector for fixed LLRs |
| `ldpc_cascade_is_bit_exact_on_the_corpus` | 540 frames across the waterfall region |
| `legacy_osd_path_is_bit_exact_and_the_fixed_rule_agrees_on_it` | 7 frames the oracle's OSD rescues |
| `production_decoder_never_accepts_a_crc_failure_and_agrees_with_bp` | the 540 frames |
| `ap_ladders_match_the_oracle`, `ap_decode_is_bit_exact_on_the_corpus` | the AP corpus |
| `an_empty_ap_mask_decodes_bit_identically_to_no_mask` | the 540 frames |

The decoder owns its scratch memory and allocates nothing per decode. `decode_slot` keeps one
`Decoder` per rayon worker.

## OSD: the defect, and the rule that replaced it

The reference's ordered-statistics step flipped up to two of the 14 least reliable **payload**
bits, then *recomputed* the CRC from the flipped payload. Every candidate was CRC-valid by
construction, and its final "CRC check" compared a CRC with itself (audit M1). The documented
2⁻¹⁴ false-accept bound was not what it implemented.

vNext OSD (`Decoder::osd`) runs only when BP got within syndrome weight 14. It ranks all 77
information bits (payload **and** CRC field, excluding AP-pinned bits) by reliability, flips
up to two of the 14 least reliable, re-encodes, and **accepts a candidate only if its CRC field
equals the CRC of its payload**. The correlation (> 20) and distance (≤ 16 bits) gates then
apply as before. There are 106 candidates per invocation, so the union bound on a random CRC
pass is 6.5 × 10⁻³ before those gates. The measured rate is in
[benchmarking.md](benchmarking.md).

**Gate G2.3, measured.** 4000 frames were drawn the way the golden generator draws them, and
3004 of them failed BP. The legacy OSD recovered 7; the corrected OSD recovered the same 7.
That is 0 discordant (`screen_osd_pool`, and `OSD_POOL_INDICES` in
`reference/golden/generate.py`). Closing the tautology cost no decodes. The golden OSD corpus
is those 7 frames, and the test asserts that where the corrected rule succeeds it returns the
oracle's bits.

`production_decoder_never_accepts_a_crc_failure_and_agrees_with_bp` asserts that no production
success ever has a failing CRC. Wherever the oracle succeeded without OSD, production returns
the identical bits and iteration count.

## A priori (AP) decoding (`ap.rs`)

This is WSJT-X's `ft8b.f90` ladder, a twin of `legacy/python-oracle/z30_dsp/ap_decode.py` (the design is in
`wiki/17`). AP asserts message bits the receiver did not measure, which makes it the one place
an assumption can become a logged QSO. Three rules keep it honest:

- **AP never runs first.** `decode_with_ap` attempts the ordinary decode and returns it
  untouched when it succeeds. AP may add decodes, never change or lose one.
- **A frame recovered by AP is labelled.** `ap_type` travels into `Decode` and the GUI's band
  activity shows `a1`…`a6`. (The logbook does not yet carry the tag: a QSO is a sequence of
  decodes, and which of them were AP-assisted is not stored per record. Listed in
  [benchmarking.md](benchmarking.md#not-measured).)
- **The gates only narrow.** Callsigns in a hypothesis must round-trip (the `Callsign` type
  cannot hold one that does not). Types 3 and up are confined to ±75 Hz of the frequencies
  being worked (`AP_FREQ_WINDOW_HZ`). AP is off unless the caller supplies an `ApContext`,
  and `RxConfig::default()` does not. The 14 CRC bits are never asserted, because the CRC is
  the only thing testing the hypothesis.

An empty AP mask decodes bit-identically to no mask: same verdict, bits, iterations, method and
minimum syndrome on all 540 corpus frames
(`an_empty_ap_mask_decodes_bit_identically_to_no_mask`). That is what keeps every published
threshold describing the decoder that ships.
