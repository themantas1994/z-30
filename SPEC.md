# z-30 protocol specification, version 1

**Status:** frozen. **Derived from the code**, not from the wiki: `z30_dsp/modem.py`,
`z30_dsp/ldpc.py`, `z30_dsp/message_codec.py`, `z30_dsp/benchmark.py` (demodulator) and
`src/dsp/z30Codec.ts` (the text tokenizer and grid table, which exist only there), at the
audited commit `7661caa`. Those files now live, frozen, in `legacy/python-oracle/z30_dsp/` and
`legacy/browser-runtime/src/dsp/`; they are the reference, not the implementation, which is
`crates/`. Where the wiki says something else, this document is right and the wiki is the bug
(`audit/2026-09-23-vnext` §B.7 lists the known cases).

**Terminology.** A frame carries **63 message bits** (two 28-bit call fields and a 7-bit extra
field) plus a 14-bit CRC: **77 information bits**, LDPC-encoded to 216. Older text calling this
a "77-bit QSO exchange" overstated the message: FT8 carries 77 *message* bits (91 with its CRC).

The executable form of this specification is the golden-vector set in `fixtures/golden/`,
generated from those files by `reference/golden/`. The Rust implementation in `crates/z30-protocol`
and `crates/z30-dsp` is tested against it.

Conventions: bit strings are MSB-first; "bit *i*" of a field is its *i*-th transmitted bit.

---

## 1. Physical layer

| Quantity | Value | Source |
| :--- | :--- | :--- |
| Tones | M = 16 | `Z30Config.num_tones` |
| Tone spacing | Δf = 3.125 Hz exactly | `tone_spacing_hz` |
| Symbol duration | T = 0.320 s = 1/Δf exactly | `symbol_duration_sec` |
| Symbols per frame | 75 (21 sync + 54 data) | `total_symbols` |
| Frame duration | 24.000 s | 75 × 0.320 |
| Occupied tone span | 15 × 3.125 = 46.875 Hz (tone centres); 50 Hz nominal | |
| Base frequency | f₀ = frequency of tone 0; tone *k* is at f₀ + kΔf | `synthesize_frame(base_audio_freq_hz)` |
| Frequency shaping | GFSK, BT = 2.0 | `gfsk_bt` |
| Amplitude | constant envelope; one 20 ms raised-cosine ramp at each end of the frame only | `frame_ramp_sec` |

The waveform is defined for any sample rate `fs` at which `fs × 0.320` is an integer
(`nsps = int(fs × 0.320)`; 1920 at 6 kHz, 3840 at 12 kHz, 15360 at 48 kHz).

### 1.1 GFSK frequency pulse

For `t = (n − 1.5·nsps)/nsps`, `n = 0 … 3·nsps − 1`, `c = π·sqrt(2/ln 2)`:

    p[n] = 0.5 · ( erf(c·BT·(t + 0.5)) − erf(c·BT·(t − 0.5)) )

### 1.2 Instantaneous frequency

With `f_j = f₀ + tone_j · Δf` for the 75 symbols, build `ext` of length `(75 + 2)·nsps`, float64,
zero-initialised, and accumulate **in this order** (the order fixes the float64 rounding):

1. `ext[0 : 2·nsps] += f_0 · p[nsps : 3·nsps]`
2. for `j = 0 … 74`: `ext[j·nsps : j·nsps + 3·nsps] += f_j · p`
3. `ext[76·nsps : 77·nsps] += f_74 · p[0 : nsps]`

The frame's frequency is `f = ext[nsps : 76·nsps]` (75·nsps samples).

### 1.3 Waveform

    phase[n] = 2π · cumsum(f)[n] / fs        (float64, sequential cumulative sum)
    env[n]   = 1, except the first and last R = int(0.020·fs) samples:
               ramp[i] = 0.5·(1 − cos(π·i/R)), env[i] = ramp[i], env[N−R+i] = ramp[R−1−i]
    w[n]     = sin(phase[n]) · env[n]
    out[n]   = float32( w[n] / max|w| )

Tolerance for a reimplementation: |out − out_ref| ≤ 1e-6 (float32 output; `erf` from different
libraries differs in the last bit).

## 2. Frame structure (the Costas array)

Sync positions (symbol indices) and their tones, in order:

    positions: 0  1  2  7  8  9 17 18 19 27 28 29 37 38 39 47 48 49 72 73 74
    tones:     3 11  7 14  2  9  5 12  1 15  6 10  4  8 13  0  9  3 14  6 11

Seven clusters of three. The remaining 54 positions carry data symbols in increasing order.
This is a Costas *array* for time/frequency acquisition, not a carrier loop; the receiver is
non-coherent (§8).

## 3. Symbol mapping

Data symbol *s* (0 … 53) is the 4-bit natural-binary value of codeword bits `4s … 4s+3`, MSB
first: `tone = c[4s]·8 + c[4s+1]·4 + c[4s+2]·2 + c[4s+3]`. **Not Gray-coded** (wiki/03 used to say
Gray; the code never has been). The loss against a Gray map with this non-coherent Log-MAP
demapper has not been measured (audit L-05).

## 4. Information block

77 bits = 63 payload bits + 14 CRC bits.

| Bits | Width | Field |
| :--- | :--- | :--- |
| 0–27 | 28 | `to`: callsign or token (§6.1) |
| 28–55 | 28 | `from`: callsign (§6.1) |
| 56–62 | 7 | `extra`: report, acknowledgement or grid (§6.2) |
| 63–76 | 14 | CRC-14 of bits 0–62 |

## 5. CRC-14

    g(x) = x^14 + x^13 + x^10 + x^6 + x + 1     register constant 0x2443 (x^14 implicit)
    init 0x2757, MSB-first, no reflection, no final XOR
    for each bit b: msb = (crc >> 13) & 1; crc = ((crc << 1) & 0x3FFF) ^ (0x2443 if msb ^ b else 0)

Known answers: `fixtures/golden/codec.json`, `tests/vectors/crc14_vectors.json`.

## 6. Message codec (v1)

### 6.1 The 28-bit call field

Tokens: `CQ` = 0, `CQ DX` = 1, `CQ TEST` = 2, `QRZ` = 3.

A **standard callsign** matches `^([A-Z0-9]{1,2})([0-9])([A-Z]{1,3})$`. With the prefix
left-padded to two characters with a space and the suffix right-padded to three:

    P(c): space = 0, '0'-'9' = 1-10, 'A'-'Z' = 11-36        (radix 37)
    S(c): space = 0, 'A'-'Z' = 1-26                          (radix 27)
    p = P(pre[0])·37 + P(pre[1]);  s = S(suf[0])·729 + S(suf[1])·27 + S(suf[2])
    value = (p·196830 + digit·19683 + s + 100) mod 2^28

Decoding reverses this for `value ≥ 100` with `p < 1369`, stripping the padding.

**Representable callsigns (vNext rule).** A callsign is representable in v1 if and only if it is
a standard callsign **and** `decode(encode(call)) == call`. That excludes:

- prefixes `ZV`–`ZZ` (and the digit/letter prefixes above them): `p·196830 + … + 100 ≥ 2^28`,
  so the value wraps and decodes as a different callsign (`ZY2ABC` → `24BWE`);
- anything that is not a standard callsign — portable `/P`, compound `EA8/G4XYZ`, three-character
  prefixes (`3DA0XYZ`), four-letter suffixes, calls longer than six characters. The shipped
  TypeScript packer sends these through a lossy base-37 accumulator
  (`(acc + 1000) mod 2^28`) whose values land inside the standard range and decode as
  **other valid-looking callsigns** (`EA8/G4XYZ` → `Y43OAP`).

vNext never produces the base-37 path. A receiver cannot distinguish a base-37 value sent by an
old transmitter from a real standard callsign; this is a limit of v1, not of the decoder. A
received value that is not the canonical encoding of any callsign or token (values 4–99, `p ≥
1369`, or a suffix with interior padding) is reported as *unrepresentable* and never displayed as
a callsign.

### 6.2 The 7-bit extra field

| Code | Meaning | Text |
| :--- | :--- | :--- |
| 0–60 | signal report, `code − 30` dB (−30 … +30) | `-12`, `+05` |
| 61 | acknowledgement | `RRR` |
| 62 | sign-off | `73` |
| 63 | acknowledgement + sign-off | `RR73` |
| 64–126 | grid from the 63-entry table below, `code − 64` | `FN31` |
| 127 | unassigned | — |

Grid table (index 0 … 62):

    FN31 FN20 FN30 FM19 FM29 EM00 EM10 EM29 EM79 EL98 EL89 DM79 DM04 DM13 CM87 CM97
    CN87 CN88 IO91 IO82 IO92 IO93 JO21 JO31 JO22 JO32 JN88 JN58 JN48 JN65 PM95 PM85
    PM74 QM05 QM06 QF22 QF56 QF57 RE78 GG87 GF05 FF49 KG46 KF29 OL93 NL18 OF78 NF48
    PF95 KO85 KO94 KP04 KP15 KP20 KN87 KN99 KM17 KM68 KL78 BL11 BK29 AJ81 AH21

**v1 limits, stated plainly** (audit C5, H2, H3):

- **No roger flag.** The shipped TypeScript packer accepted `R-12` and transmitted `-12`. vNext
  refuses to *encode* `R-12`: a report sent in reply to a report carries the roger by its place
  in the sequence, and the software says so rather than displaying an `R` that was never sent.
- **63 grids.** The shipped packer hashed any other grid onto the table (`FN42` → `RE78`,
  `EM12` → `JN48`), so a *different real grid* was transmitted and logged. vNext refuses a grid
  not in the table. There is no "no grid" code; assigning 127 would be a wire-format change and is
  an operator decision (`VNEXT_IMPLEMENTATION_PLAN.md` §8).
- **Reports outside −30 … +30** were clamped by the shipped packer; vNext refuses them.
- **Free text** was silently turned into callsign fields (`HELLO` → a grid of `FN31`); vNext
  refuses it.

### 6.3 Messages vNext will encode

| Form | to | from | extra |
| :--- | :--- | :--- | :--- |
| `CQ <call> <grid>` | 0 | call | grid |
| `CQ DX <call> <grid>` | 1 | call | grid |
| `<to> <from> <grid>` | call or `QRZ` | call | grid |
| `<to> <from> <±NN>` | call | call | report |
| `<to> <from> RRR` / `73` / `RR73` | call | call | 61 / 62 / 63 |

The rule, applied at encode time and again by the transmit gate: **a message that does not
unpack to exactly the message the operator asked for is not transmitted.** Every accepted
message is round-trip tested; `fixtures/golden/messages.json` pins the bits for the shipped
packer's behaviour on representable messages.

## 7. LDPC (216, 77)

- **Code:** systematic IRA. H = [H_info (139 × 77) | H_parity (139 × 139)]. Row *p* of H_info
  has ones at the five indices `Z30_CHECK_TO_INFO[p]` (`legacy/python-oracle/z30_dsp/ldpc.py`, `crates/z30-protocol/src/ldpc.rs`; degree 5, girth 6).
  H_parity is dual-diagonal: `H[p, 77+p] = 1`, `H[p, 77+p−1] = 1` for p ≥ 1.
- **Encoder:** `c[0:77] = info`; `acc = 0`; for p in 0 … 138: `acc ^= XOR_{j in row p} info[j]`;
  `c[77+p] = acc`.
- **Decoder (the reference cascade, bit-exact):** four layered schedules run in order until
  one converges, then OSD.

  | # | Mode | α | β | damping γ | order | iterations |
  | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
  | 1 | normalised offset min-sum | 0.82 | 0.08 | 0.88 | forward | 45 |
  | 2 | sum-product (box-plus) | 0.95 | 0 | 0.85 | forward | 40 |
  | 3 | normalised offset min-sum | 0.74 | 0.04 | 0.90 | reverse | 35 |
  | 4 | min-sum on dithered LLRs | 0.80 | 0.06 | 0.85 | forward | 30 |

  Semantics required for bit-exactness (NumPy 2 / NEP 50, established by the audit PoC): every
  message and belief is float32; Python-float constants are rounded to float32 before use; the
  damping complement `1 − γ` is formed in float64 and then rounded; the dither is added in
  float64 and rounded; correlations use NumPy's pairwise float32 summation. Box-plus is
  `sign(x)sign(y)·min(|x|,|y|) + log1p(exp(−|x+y|)) − log1p(exp(−|x−y|))`, each correction
  zeroed when its argument is ≤ −30, evaluated lane-wise in increasing *j* per edge; SPA
  messages are scaled by α and clipped to ±20. Schedule 4's dither is mulberry32 seeded by
  FNV-1a over `floor(llr·64 + 0.5)` (as u32, little-endian bytes), amplitude 0.45 peak-to-peak.
- **Stopping:** after each iteration, success if the hard decision has zero syndrome and its
  CRC matches; or if the payload CRC matches the received CRC field and the re-encoded codeword
  has correlation > 0 with the channel LLRs and differs from the hard decision in ≤ 12 bits.
- **Iterations** are counted cumulatively across schedules (maximum 150). A decode that
  succeeds from the raw hard decision reports 1.
- **OSD (changed in vNext, §7.1).**

### 7.1 OSD: the reference defect and the vNext rule

The reference OSD flips up to two of the 14 least reliable *payload* bits of the best BP hard
decision, **recomputes** the CRC from the flipped payload, re-encodes and accepts the candidate
with the highest correlation > 20 differing from the BP decision in ≤ 16 bits. Recomputing the
CRC makes every candidate CRC-valid by construction, and its final "CRC check" compares a CRC
with itself (audit M1). The documented 2⁻¹⁴-per-candidate false-accept bound is therefore not
what the reference implements.

vNext OSD ranks all 77 information bits (payload **and** CRC field, excluding AP-pinned bits) by
BP reliability, flips up to two of the 14 least reliable, and **accepts a candidate only if its
received CRC field equals the CRC of its payload**, then applies the same correlation and
distance gates. Per OSD invocation this tests 106 candidates, so the union bound on a random
CRC pass is 106 × 2⁻¹⁴ ≈ 6.5 × 10⁻³ *before* the correlation and distance gates; the rate that
matters is the measured one (`docs/ldpc.md`).

## 8. Demodulation (reference metric)

Non-coherent orthogonal 16-FSK. For each data symbol and each tone *k*, the complex correlator
`r_k` over one symbol; `σ_c²` the per-dimension noise variance of the correlator output; `â` the
mean correlator magnitude over the 21 sync symbols at their known tones:

    L_k = ln I₀(z),  z = |r_k|·â/σ_c²            (z > 15: z − ½·ln(max(1, 2πz)))
    LLR(bit b) = logsumexp{L_k : bit b of k = 0} − logsumexp{L_k : bit b of k = 1}
    clipped to ±25, stored as float32; positive means bit 0

`ln I₀` uses the Cephes Chebyshev expansion (NumPy's `i0`). The coherence weight is 0
(`RECEIVER_PILOT_COHERENCE`). The reference computes `r_k` by direct correlation at the passband
sample rate; vNext computes the same quantity from an FFT of a decimated complex baseband
(`docs/demodulation.md`).

## 9. Slot timing

- Slots are 30 s, aligned to UTC: slot *n* starts at `30n` s since the Unix epoch. **Even** slots
  start at second 0 of the minute, **odd** slots at second 30.
- A transmission starts at the slot boundary and lasts 24.0 s.
- Receivers search DT ∈ [−1.5, +1.5] s, so the receive window of slot *n* is
  **[30n − 1.5 s, 30n + 25.5 s]** (27 s). The decode cannot start before 30n + 25.5 s (the
  published "decode budget from 24.0 s" contradicts this and was the root cause of C1). The
  next transmission starts at 30n + 30 s, leaving 4.5 s.

## 10. SNR reference

`SNR = 10·log10(P_signal / (σ² · 2500/(fs/2)))`: signal power over noise power in a 2500 Hz
bandwidth, for real white noise of per-sample variance σ² at sample rate fs.

Fading results (not part of the protocol, but quoted against it) use the ITU-R F.1487 Watterson
convention: a path's **Doppler spread** is `2σ_D`, where σ_D is the standard deviation of the
path tap's Gaussian Doppler **power** spectral density; the SNR is the average over the fading
ensemble. `z30_channel::Watterson` and the reference oracle's `channel.py` implement exactly this
(before 2026-09-24 both ran at 1/√2 of the stated spread; see `docs/benchmarking.md#fading`).

## 11. Numeric semantics summary

| Stage | Precision | Bit-exact with the reference? |
| :--- | :--- | :--- |
| Codec, CRC, LDPC encode, symbol mapping | integer | yes |
| GFSK modulator | float64, float32 output | ≤ 1e-6 |
| LDPC BP cascade | float32 per §7 | yes: verdict, information bits and iteration count |
| OSD | integer + float32 correlation | different rule (§7.1) |
| Demodulator LLRs | float64 internally, float32 output | production FFT path against the reference on the golden frame: 215/216 hard decisions, LLR correlation 0.998 (`crates/z30-dsp/tests/golden_demod.rs`, `docs/demodulation.md`) |

## 12. Protocol v2 (not adopted)

The audit sketches a v2 payload: 28 + 28 + 1 (roger) + 15 (grid/report, FT8-style) + 14 CRC =
86 bits. The (216, 77) code cannot carry it. The options are a rate-0.40 code in the same 54
data symbols (a coding-gain loss to be measured) or 60 data symbols (26.0 s frame, less decode
time). Neither is implemented. Adopting either is a wire-format break and requires operator
approval; if adopted, the protocol version must become explicit on the air.
