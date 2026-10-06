# 17. A Priori (AP) Decoding

A priori decoding lets the receiver spend channel evidence only on the bits it does not already
know. When an ordinary decode fails, the decoder runs again with some message bits *asserted*
rather than measured, taken from what the QSO state already implies must be in the frame. The
14-bit CRC decides whether the assertion was right.

The mechanism is a port of the one WSJT-X has used for FT8 since v1.8 (`lib/ft8/ft8b.f90`,
`lib/ft8/bpdecode174_91.f90`), adapted to z-30's message layout. This page covers what was
ported, what had to change, what it was measured to be worth and what it costs.

The implementation is [`crates/z30-dsp/src/ap.rs`](../crates/z30-dsp/src/ap.rs), on top of the
AP mask path in [`crates/z30-dsp/src/ldpc.rs`](../crates/z30-dsp/src/ldpc.rs). `decode_slot`
calls it when `ap_enabled` is set, which it is not by default.

> **Whose measurements these are.** The figures under "Measured effect" were taken on an earlier
> reference receiver, not on the production `decode_slot`. The Rust port is checked against that
> receiver's recorded outputs instead: the hypothesis ladders match, AP decoding on the recorded
> corpus gives the same results bit for bit, an empty mask decodes identically to no mask
> (`crates/z30-dsp/tests/golden_ldpc.rs`), the CRC bits are never asserted and the deep types
> are frequency-gated (`ap.rs` unit tests). The paired AP effect has **not** been re-measured
> through `decode_slot`. Read the numbers below as that reference receiver's, in simulation.

## Why it works

The 63-bit payload has three fields:

| Bits | Field | Width |
| :--- | :--- | :--- |
| 0–27 | destination callsign | 28 |
| 28–55 | source callsign | 28 |
| 56–62 | grid / report / modifier | 7 |

A station that has just answered your CQ must have put your callsign in bits 0–27, or it is not
answering you. Those 28 bits were never in doubt, yet the ordinary decoder spends channel
evidence re-deriving them. The (216, 77) code still has 216 channel observations, but with
bits asserted it resolves 49 unknowns (or 21, or 14) instead of 77, and the parity checks that
touch an asserted bit become easier for the rest.

It also says when AP does nothing: a frame between two other stations asserts nothing true, so
every hypothesis fails its CRC and the frame is lost as it would have been anyway. AP helps in
proportion to how much of what you hear is the QSO you are in.

## The hypothesis ladder

The ladder follows the `iaptype` table in `lib/ft8/ft8b.f90`. FT8 packs 28+28+15 bits plus a
3-bit message type; z-30 packs 28+28+7 and has no type field, so FT8's trailing `i3`/`n3`
assertions have no counterpart and the bit counts differ. What carries over is which fields each
hypothesis claims to know.

| Type | Hypothesis | Asserted fields | Payload bits asserted |
| :--- | :--- | :--- | :--- |
| **a1** | `CQ ??? ???` | destination = the CQ token | 28 / 63 |
| **a2** | `MyCall ??? ???` | destination = your callsign | 28 / 63 |
| **a3** | `MyCall DxCall ???` | destination and source | 56 / 63 |
| **a4** | `MyCall DxCall RRR` | both callsigns + the RRR modifier | 63 / 63 |
| **a5** | `MyCall DxCall 73` | both callsigns + the 73 modifier | 63 / 63 |
| **a6** | `MyCall DxCall RR73` | both callsigns + the RR73 modifier | 63 / 63 |

Types a4–a6 assert every payload bit and leave only the 14 CRC bits for the channel to supply.
That is deliberate, as in WSJT-X's `apmask(1:77)=1`: the CRC must stay free because it is the
only thing testing the hypothesis. Asserting it too would leave nothing to check against, and
every hypothesis would "succeed".

### Which ladder runs

The order is WSJT-X's `naptypes(nQSOProgress, 1:4)` table mapped onto the QSO stages:

| QSO stage | Ladder |
| :--- | :--- |
| `IDLE`, `CALLING_CQ`, `QSO_COMPLETED` | a1, a2 |
| `REPLYING_CQ` | a2, a3 |
| `SENDING_REPORT`, `SENDING_R_REPORT` | a3, a4, a5, a6 |
| `SENDING_73` | a3, a1, a2 |

While you call CQ, the likely frames are other CQs and answers to you. Once reports are being
exchanged, the likely frames are the closing messages of your own QSO. At the 73 the ladder
falls back towards the general cases.

`golden_ldpc.rs::ap_ladders_match_the_oracle` pins this table, membership and order, against the
ladders recorded in `fixtures/golden/ap.json`. `ApStage::ladder` is an exhaustive `match`, so a
stage added to the state machine does not compile until its ladder is decided, instead of
silently getting no AP.

## Four mechanisms and what each is for

### 1. `apmag` scales with the frame

```
apmag = AP_LLR_MARGIN * max|LLR|          AP_LLR_MARGIN = 1.01
```

This is WSJT-X's `apmag = maxval(abs(llra))*1.01`. The magnitude comes from the frame, not from a
constant: a fixed value large enough to dominate a strong frame would dwarf the evidence in a
weak one, and one sized for a weak frame would be overridden in a strong one. Scaling keeps an
asserted bit one notch more certain than the most certain thing the demodulator measured,
whatever the signal level.

**The sign convention is z-30's, not WSJT-X's.** Here $L = \ln(P(c{=}0)/P(c{=}1))$ and the hard
decision is `llr < 0 → 1`. WSJT-X's `bpdecode174_91` reads the opposite sign, and its
`apsym = 2*bit-1` term carries the flip. Copying that expression instead of re-deriving it would
assert every AP bit inverted, and every hypothesis would fail its CRC with no error anywhere.
`ap_decode_is_bit_exact_on_the_corpus` would catch it.

### 2. Asserted bits are pinned, not just biased

A large LLR is not enough. In WSJT-X's flooding decoder, `zn(i) = llr(i)` wherever
`apmask(i) == 1`, so an asserted bit never receives a check message. z-30's decoder is layered,
so the same rule takes another form: the variable's running total is simply not updated
(`ldpc.rs`, in `sweep`, behind `pinned.is_none_or(|p| !p[v])`). The bit still *sends* messages to
its checks; the pin fixes what the bit believes, not what it says. Without it, a run of
confident check messages could walk an asserted bit back, which is the one thing the assertion
exists to prevent.

Two consequences are enforced:

- **Schedule 4's dither skips pinned bits.** A pinned bit is an assertion, not a measurement,
  so there is nothing for the perturbation to shake loose. The dither vector is still drawn
  over all 216 positions from the same derived seed, so unpinned bits get exactly the values
  they would have had without a mask, and determinism is unaffected.
- **The OSD search cannot flip a pinned bit.** In practice it would never choose one, because
  they carry the largest magnitudes and sort last. "Never" and "not in practice" are different
  guarantees, and flipping one would return a codeword that contradicts the hypothesis whose
  CRC was used to accept it.

### 3. The CRC arbitrates, so AP never runs first

`decode_with_ap` attempts an ordinary decode before any hypothesis and returns it untouched when
it succeeds. **AP can add decodes; it cannot change or lose one.** Per candidate this holds by
construction, so every AP-recovered frame is one that had already failed to decode on its own.

Across SIC passes it is **not guaranteed, and no test exercises it yet.** An AP-only decode is
subtracted, which changes the residual and the pass-2/3 candidate set (both passes can reach the
50-candidate limit), so another station's later plain decode could in principle be displaced.
The busy-band test in `ap_production.rs` never puts a plain decode at risk, because its AP
decodes all land in pass 2, so it is no evidence either way. WSJT-X has the same structure, with
AP in decoding passes 4 onward and passes 1–3 ordinary.

### 4. Deep hypotheses are frequency-gated

`AP_FREQ_WINDOW_HZ = 75.0` is WSJT-X's `napwid`, applied as
`abs(f1-nfqso) > napwid .and. abs(f1-nftx) > napwid → skip`. z-30 occupies the same 50 Hz an FT8
signal does, so the number carries over: one signal width either side of the frequency being
worked, checked against both the receive and transmit frequencies because a split station does
not work the frequency it transmits on.

Types a1 and a2 assert 28 bits and are cheap enough to try across the whole passband, which
lets a CQ, or a call to you, be found in a corner you were not watching. Types a3 and up assert
56 or 63 bits, most of the message, and far from the worked frequency there is no reason to
believe the QSO state applies.

### A gate of z-30's own: callsigns must round-trip

WSJT-X's `ft8apset` packs a dummy message, unpacks it and supplies no a priori symbols unless the
two match. In z-30 the `Callsign` type gives the same guarantee: it can only be constructed for a
callsign v1 carries exactly, so a portable prefix, a `/P` suffix or a special-event call never
reaches an AP hypothesis. Asserting 28 bits that unpack to a callsign nobody transmitted would
make every hypothesis built on them wrong. The placeholder `NOCAL` is refused for a different
reason: it round-trips, but it is a placeholder, not knowledge.
`tests/vectors/callsign_pack_vectors.json` pins the packing.

## What it costs

Each hypothesis is one more codeword the CRC-14 has to reject. A station on the four-hypothesis
`SENDING_REPORT` ladder gives the receiver **five** chances to accept a wrong message where it
previously had one. On random errors that is a false-accept probability of roughly
$5 \times 2^{-14} \approx 3.1 \times 10^{-4}$ per candidate, against
$2^{-14} \approx 6.1 \times 10^{-5}$ without AP. This is analysis, not a measurement.

WSJT-X makes the same trade, which is why:

- the ladder is short (at most four entries),
- it is ordered by how likely each hypothesis is given the QSO state,
- the deep types are frequency-gated, and
- `decode_with_ap` re-checks the asserted fields in the accepted payload instead of trusting that
  pinning made a mismatch impossible. A guard that can only fire when something else is already
  wrong is the kind worth keeping.

It is also why **AP is off by default**: `ap_enabled = false` in `[receiver]` of `config.toml`
(GUI: Settings → Receiver → "A priori decoding"). Turn it on knowingly. `z30 --migrate` carries
the old application's setting over and lists it under **Imported** as "a priori decoding =
true/false", so check Settings → Receiver after migrating.

AP-recovered decodes are tagged **a1**…**a6** in the activity log, as WSJT-X prints its
`iaptype`. A frame that closed only because the receiver assumed your callsign was in it is a
weaker claim than one that closed unaided, and an operator logging a contact should be able to
see which one they have.

## Measured effect

The measurement is a **paired comparison**, not another decode curve. Each frame goes through the
channel once and is demodulated once, and the resulting 216 LLRs are decoded twice, once by the
ordinary decoder and once with the ladder behind it. Both arms see identical channel evidence, so
any difference is the ladder alone. The statistic is the count of frames where the arms
disagreed, and an exact McNemar test over those discordant pairs gives a p-value that can be
recomputed by hand.

### The modelled band

The answer depends on this, so it is stated rather than tuned:

- This station is **W1AW**, working **K1ABC**, at QSO stage **`SENDING_REPORT`** (ladder a3–a6).
- **50%** of frames are that QSO: `W1AW K1ABC <report | R-report | RRR | 73 | RR73>`, drawn from
  the seeded generator.
- **50%** are foreign traffic the ladder does not describe: CQs and exchanges between other
  stations, on random callsigns verified to survive the 28-bit packing.

The two halves are reported separately, so anyone whose band is busier or quieter than 50/50 can
reweight the result.

### Results

Three seeded paired sweeps on the earlier reference receiver, measured 2026-09-02, each frame
decoded twice from one demodulation. **Exploratory:** 60–80 frames per point (about 35–40 in-QSO
frames per point), below the 200 frames per point a published crossing needs, and no file under
`research/results/` holds them. The `moderate` row used a Watterson model that has since been
corrected and whose results are withdrawn ([`docs/benchmarking.md`](../docs/benchmarking.md)); it
is kept as history only. None of this has been re-measured through `decode_slot`.

| Channel | Seed | Frames / point | Total frames (in-QSO) | Discordant (AP : plain) | Exact McNemar *p* |
| :--- | ---: | ---: | ---: | ---: | ---: |
| AWGN | 20260830 | 80 | 880 (444) | **150 : 0** | 1.4 × 10⁻⁴⁵ |
| Watterson `moderate` (withdrawn channel model) | 20260830 | 60 | 540 (280) | **132 : 0** | 3.7 × 10⁻⁴⁰ |
| AWGN | 7 | 60 | 420 (197) | **92 : 0** | 4.0 × 10⁻²⁸ |

Not one frame in 1,840 was decoded by the ordinary arm and lost by the AP arm. That is the
structural guarantee showing up in data: `decode_with_ap` returns an ordinary decode untouched,
so the AP arm's decode set is a superset by construction.

The 50% crossing, over the in-QSO frames only, because they are the population the ladder makes
a claim about:

| Channel | Seed | Plain | With AP | Shift | In-QSO decode rate |
| :--- | ---: | ---: | ---: | ---: | :--- |
| AWGN | 20260830 | −22.88 dB | −24.76 dB | **1.88 dB deeper** | 31.3% → 65.1% |
| AWGN | 7 | −22.93 dB | −24.75 dB | **1.82 dB deeper** | 33.5% → 80.2% |
| Watterson `moderate` (withdrawn channel model) | 20260830 | −20.90 dB | −23.83 dB | 2.93 dB deeper | 32.1% → 79.3% |

Two seeds put the AWGN shift at 1.8–1.9 dB. That is the earlier receiver's figure, exploratory
(about 40 in-QSO frames per point), and has not been measured through `decode_slot`. The
fading row comes from the withdrawn channel model, whose errors (no slow power variation,
historical audit finding H-10; 0.71× the labelled Doppler spread, N-01) both make fading milder,
which flatters any claim that AP's gain survives fading. It is not evidence of anything, and **no
AP figure exists on the corrected fading model**.

### What the figure is not

**It is not a new decode threshold for z-30 and must not be quoted as one.** The published
threshold ([16](16-Benchmarking-Testing-&-CI.md)) is measured over arbitrary traffic with no a
priori information. This figure is measured over the frames of one QSO, with the receiver in that
QSO and AP on. A station hearing a band that is 10% its own QSO gets a tenth of its frames
improved, not a 1.9 dB better receiver. The honest sentence is: *"On an earlier reference
receiver, in simulation, AP recovered frames the ordinary decoder lost, and for the frames it
describes moved the 50% point by 1.8–1.9 dB on AWGN (exploratory: about 40 in-QSO frames per
point; not re-measured through `decode_slot`)."* The halves belong together, as with the FT8
comparison in [`docs/benchmarking.md`](../docs/benchmarking.md). The plain arm's own in-QSO
crossing (−22.88 dB) is estimated from about 40 frames per point and revises no published
figure.

### The cost side

**Foreign traffic was untouched in all 27 rows of all three sweeps**: the AP arm decoded exactly
the same foreign frames as the plain arm. A frame between two other stations satisfies no
hypothesis, the CRC rejects each one, and nothing changes. It also means the whole measured gain
came from frames the hypothesis described.

**Zero false decodes**, meaning no CRC-valid codeword with a payload other than the transmitted
one, on either arm in 1,840 frames. That is not a measurement of the false-accept rate and
should not be reported as one. 1,266 frames failed the ordinary decode and were offered at most
four hypotheses each, so at most about 5,060 attempts. With zero events, the rule of three puts
the 95% upper bound at **5.9 × 10⁻⁴ per attempt**, an order of magnitude *above* the analytic
$2^{-14} \approx 6.1 \times 10^{-5}$. The sweep is consistent with the analytic figure and has
nowhere near the power to confirm or refute it. A sweep large enough to test it has not been run.

### Confidence

[`docs/benchmarking.md`](../docs/benchmarking.md#reporting-rules) asks of a result that
challenges the documentation a controlled, seeded, paired measurement at a realistic operating
point with a stated confidence figure: at least 95% to challenge, at least 99% before it is
treated as settled. The primary sweep is paired at the LLR vector, and the exact two-sided
McNemar test over 150 discordant pairs gives *p* = 1.4 × 10⁻⁴⁵. A replication at an independent
seed lands within 0.06 dB. But the instrument was the earlier receiver's `realistic` mode
(windowed acquisition, ±12 Hz and ±0.55 s around the nominal carrier and timing, noise estimation
in that receiver), not the shipped `decode_slot`; the sweep is below 200 frames per point; and no
result file holds it. It is evidence about that receiver, not a published z-30 figure.

The remaining threat to real-world comparability is the population model, not the statistics:
whether half your traffic is really your own QSO. That is why the two halves are reported
separately and the shift is quoted over the in-QSO half alone.

The sweep cannot be rerun from this tree, because the reference receiver that ran it no longer
exists. It was last present at commit `acfce5e`.

## What the tests guard

| File | What it pins |
| :--- | :--- |
| `crates/z30-dsp/tests/golden_ldpc.rs`, `crates/z30-dsp/src/ap.rs` | The Rust port: ladders identical to the recorded ones (membership and order), AP decoding bit-exact on the corpus, empty mask bit-identical to no mask, CRC bits never asserted, deep types frequency-gated. |
| `crates/z30-dsp/tests/ap_production.rs` | Through `decode_slot`, on the frames and bands it draws: every plain decode is still in the AP report, AP decodes are labelled and are the frame that was sent, a wrong assumption cannot produce the assumed call, AP does not decode noise, and the frequency gate narrows AP's attempts. It does not exercise the cross-pass case in mechanism 3. |
| `crates/z30-protocol/tests/golden.rs`, `shared_vectors.rs` | The packing the ladders assume: whole messages (including `73`) against the frozen `messages.json`, and the shared callsign packing vectors. |

The production tests compute every expectation from the data they generate. They hold no
recorded "expected" decode counts, because a count written down once and asserted forever passes
by having been copied, not by the decoder working. The golden tests compare frame by frame
against recorded outputs, which is what bit-exactness means.

## Related: no roger bit

`R-12` and `-12` would pack to the same 7-bit code (18), because v1 has no roger bit. There is no
spare code point (0–60 reports, 61 RRR, 62 `73`, 63 RR73, 64–126 grids, 127 unassigned but
reserved by `SPEC.md`), and changing the field is a protocol break. z-30 refuses `R-12` and
carries the roger by the report's place in the sequence
([14](14-User-Interface-&-Operation-Reference.md#qso-sequencing)). This does not affect AP, since
no hypothesis asserts a report value. `K1ABC W1AW 73` packs to extra code 62, pinned by
`golden.rs` against `messages.json`.

## See also

- [04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md): the decoder AP
  constrains, and the CRC-14 that arbitrates every hypothesis.
- [05. Successive Interference Cancellation (SIC)](05-Successive-Interference-Cancellation-(SIC).md):
  the other way the receiver recovers frames a single pass loses. AP and SIC compose: the ladder
  is offered to every SIC pass's candidates.
- [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md): the measurement standard
  these numbers are held to.
