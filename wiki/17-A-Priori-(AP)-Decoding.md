# 17. A Priori (AP) Decoding

**A priori decoding lets the receiver spend channel evidence on the bits it does not already
know.** When an ordinary decode fails, the decoder is run again with some of the message bits
*asserted* rather than measured — asserted from what the QSO state machine already implies must
be in the frame. The 14-bit CRC decides whether the assertion was right.

This is a port of the mechanism WSJT-X has used for FT8 since v1.8 (`lib/ft8/ft8b.f90`,
`lib/ft8/bpdecode174_91.f90`). This page documents what was ported, what was adapted for z-30's
different message layout, what it was measured to be worth, and what it costs.

Implementation: [`z30_dsp/ap_decode.py`](../z30_dsp/ap_decode.py) and
[`src/dsp/apDecode.ts`](../src/dsp/apDecode.ts), on top of the AP mask path in
[`z30_dsp/ldpc.py`](../z30_dsp/ldpc.py) and [`src/dsp/ldpcCodec.ts`](../src/dsp/ldpcCodec.ts).

---

## 🧠 Why it works at all

z-30's 63-bit payload is three fields:

| Bits | Field | Width |
| :--- | :--- | :--- |
| 0–27 | destination callsign | 28 |
| 28–55 | source callsign | 28 |
| 56–62 | grid / report / modifier | 7 |

Consider a station that has just answered your CQ. Whatever else that frame contains, bits 0–27
**are your callsign** — a station answering you has to address you, or it is not answering you.
Those 28 bits were never genuinely in doubt, and the ordinary decoder spends channel evidence
re-deriving them anyway. AP stops paying for them twice.

The gain therefore is not a better decoder. It is a smaller problem: the (216, 77) code still
has 216 channel observations to work with, but instead of resolving 77 unknowns it resolves 49
(or 21, or 14). The parity checks that touch an asserted bit become that much easier for the
remaining ones.

That also says exactly when AP does **nothing**: a frame between two other stations asserts
nothing true, so the hypothesis fails its CRC and the frame is lost as it would have been
anyway. AP is worth something in proportion to how much of what you hear is the QSO you are in.

---

## 🪜 The hypothesis ladder

Adapted from the `iaptype` table in `lib/ft8/ft8b.f90`. FT8 packs 28+28+15 bits plus a 3-bit
message type; z-30 packs 28+28+7 and has no type field, so the FT8 types' trailing `i3`/`n3`
assertions have no counterpart and the bit counts differ. What carries over is the ladder
itself — which fields each hypothesis claims to know.

| Type | Hypothesis | Asserted fields | Payload bits asserted |
| :--- | :--- | :--- | :--- |
| **a1** | `CQ ??? ???` | destination = the CQ token | 28 / 63 |
| **a2** | `MyCall ??? ???` | destination = your callsign | 28 / 63 |
| **a3** | `MyCall DxCall ???` | destination and source | 56 / 63 |
| **a4** | `MyCall DxCall RRR` | both callsigns + the RRR modifier | 63 / 63 |
| **a5** | `MyCall DxCall 73` | both callsigns + the 73 modifier | 63 / 63 |
| **a6** | `MyCall DxCall RR73` | both callsigns + the RR73 modifier | 63 / 63 |

Types a4–a6 assert **every payload bit**, leaving only the 14 CRC bits for the channel to
supply. That is deliberate and it is WSJT-X's `apmask(1:77)=1` — the CRC has to stay free,
because it is the only thing testing the hypothesis. Asserting it too would leave nothing to
check against and every hypothesis would "succeed".

### Which ladder runs, and when

The ordering is WSJT-X's `naptypes(nQSOProgress, 1:4)` table mapped onto z-30's `QsoStage`
union, stage for stage:

| QSO stage | Ladder |
| :--- | :--- |
| `IDLE`, `CALLING_CQ`, `QSO_COMPLETED` | a1, a2 |
| `REPLYING_CQ` | a2, a3 |
| `SENDING_REPORT`, `SENDING_R_REPORT` | a3, a4, a5, a6 |
| `SENDING_73` | a3, a1, a2 |

While you are calling CQ, the likely frames are other CQs and answers to you. Once you are
exchanging reports, the likely frames are the closing messages of the QSO you are in. At the 73
the ladder falls back towards the general cases as the QSO winds down.

`tests/test_cross_language_parity.py` pins this table across both implementations, and pins that
**every** stage in the `QsoStage` union has a ladder — so a stage added to the state machine
cannot silently fall through to "no AP" without someone deciding that.

---

## ⚙️ The four mechanisms, and why each is there

### 1. `apmag` scales with the frame

```
apmag = AP_LLR_MARGIN * max|LLR|          AP_LLR_MARGIN = 1.01
```

WSJT-X's `apmag = maxval(abs(llra))*1.01`. The magnitude is derived from the frame, never a
constant: a fixed number large enough to dominate a strong frame would be arbitrarily larger
than the evidence in a weak one, and a fixed number sized for a weak frame would be overridden
in a strong one. Scaling with the frame keeps an asserted bit exactly one notch more certain
than the most certain thing the demodulator measured, whatever the signal level.

**Sign convention is z-30's, not WSJT-X's.** Here $L = \ln(P(c{=}0)/P(c{=}1))$ and the hard
decision is `llr < 0 → 1`; WSJT-X's `bpdecode174_91` reads the opposite sign and its
`apsym = 2*bit-1` term carries the flip. Transcribing that expression rather than re-deriving it
would assert every AP bit inverted, and every hypothesis would fail its CRC — a silent, total
failure with no error message anywhere. `tests/test_ap_decode.py` pins the convention directly.

### 2. Asserted bits are pinned, not merely biased

A large LLR is not enough. In WSJT-X's flooding decoder the rule is `zn(i) = llr(i)` wherever
`apmask(i) == 1`: the asserted bit's belief never receives a check message at all. z-30's
decoder is *layered* rather than flooding, so the same rule takes a different form — the
variable's running total simply does not receive the update:

```python
if ap_pinned is None or not ap_pinned[v]:
    total_llrs[v] += diff
```

The bit still *sends* messages to its checks (`total_llrs[v] - msgs_c[i]`, reproducing WSJT-X's
`toc = zn(ibj) - tov(kk,ibj)`); the pin fixes what the bit believes, not what it says. Without
this, a run of confident check messages could walk an asserted bit back, which is the one thing
the assertion exists to prevent.

Two consequences follow and both are enforced:

* **Schedule 4's dither skips pinned bits.** A pinned bit is an assertion, not a measurement, so
  there is nothing there for stochastic resonance to shake loose. The dither vector is still
  drawn over all 216 positions from the same derived seed, so the unpinned bits are perturbed by
  exactly the values they would have been without a mask — determinism is unaffected.
* **The OSD-2 / Chase search cannot flip a pinned bit.** In practice it would never choose one
  (they carry the largest magnitude in the frame by construction, so they sort last), but
  "never" and "not in practice" are different guarantees. Flipping one would hand back a
  codeword contradicting the hypothesis whose CRC was used to accept it.

### 3. The CRC is the arbiter, so AP never runs first

`decode_with_ap` attempts an ordinary decode before any hypothesis, and returns it untouched
when it succeeds. **AP can add decodes; it cannot change or lose one.** That is WSJT-X's
structure too, where AP occupies decoding passes 4 onwards and passes 1–3 are the ordinary ones.

Every AP-recovered frame is therefore a frame that had already failed to decode on its own.

### 4. The deep hypotheses are gated by frequency

`AP_FREQ_WINDOW_HZ = 75.0` — WSJT-X's `napwid`, applied as
`abs(f1-nfqso) > napwid .and. abs(f1-nftx) > napwid → skip`. z-30 occupies the same 50 Hz an FT8
signal does, so the number ports across unchanged: one signal width either side of the carrier
being worked, checked against **both** the receive and transmit frequencies because a split
station is not working the frequency it transmits on.

Types a1 and a2 assert 28 bits and are cheap enough to try passband-wide, which is what lets a
CQ, or a call to you, be dug out of a corner you were not watching. Types a3 and up assert 56 or
63 — most of the message — and off in the corner of the passband there is no reason to believe
the QSO state applies.

### And one gate that is z-30's own: the callsign must round-trip

WSJT-X's `ft8apset` packs a dummy standard message, unpacks it, and refuses to supply any a
priori symbols unless `msg.eq.msgchk`. The z-30 equivalent is `callsign_round_trips` /
`apCallsignUsable`: a callsign that does not survive the 28-bit packing — a portable prefix, a
`/P` suffix, a special event call, anything that falls through to the generic Base-37 encoder —
packs to an integer that unpacks to something else. Asserting those 28 bits would assert a
callsign nobody transmitted, and every hypothesis built on it is guaranteed wrong.

The placeholder callsign is refused for a different reason: it round-trips perfectly, but it is
what Station Settings holds before the operator has entered anything, so it is a default rather
than knowledge.

`tests/vectors/callsign_pack_vectors.json` pins the packing and the round-trip verdict for both
languages.

---

## 💸 What it costs, stated plainly

AP is not free, and the honest form of the claim includes this half.

Each hypothesis is an additional codeword the CRC-14 has to reject. A station running the
four-hypothesis `SENDING_REPORT` ladder gives the receiver **five** chances to accept a wrong
message where it previously had one. On random errors that is a false-accept probability of
roughly $5 \times 2^{-14} \approx 3.1 \times 10^{-4}$ per candidate, against
$2^{-14} \approx 6.1 \times 10^{-5}$ without AP.

That is the same trade WSJT-X makes, and it is why:

* the ladder is short (at most four entries),
* it is ordered by how likely each hypothesis is *given the QSO state*,
* the deep types are frequency-gated, and
* `decode_with_ap` re-checks the asserted fields in the accepted payload rather than trusting
  that pinning made that impossible — a guard that can only fire when something else is already
  wrong is exactly the guard worth keeping.

It is also why **AP is off by default**. `apDecodeEnabled` in Station Settings → Automation is
unchecked on first launch. An operator should take that trade knowingly.

AP-recovered decodes are tagged **a1**…**a6** in the activity log, for the same reason WSJT-X
prints its `iaptype`: a frame that only closed because the receiver assumed your callsign was in
it is a weaker claim than one that closed without help, and an operator logging a contact is
entitled to see which they are looking at.

---

## 📊 Measured effect

`z30_dsp/benchmark.py --ap` is the instrument. It does not produce another decode curve — it
produces a **paired comparison**: every frame goes through the channel once, is demodulated
once, and the resulting 216 LLRs are decoded twice, once by the ordinary decoder and once with
the ladder behind it. Both arms therefore see bit-identical channel evidence, and any difference
between them is the ladder and nothing else.

Pairing is not a nicety. Two independent sweeps would leave a reader unable to separate a real
effect from frame-to-frame scatter. Paired, the statistic is the count of frames where the two
arms disagreed, and an exact McNemar test over those discordant pairs gives a p-value that can
be recomputed by hand.

### The modelled band

Stated rather than tuned, because the answer depends on it entirely:

* This station is **W1AW**, working **K1ABC**, QSO stage **`SENDING_REPORT`** (ladder a3–a6).
* **50%** of frames are that QSO — `W1AW K1ABC <report | R-report | RRR | 73 | RR73>`, drawn
  from the seeded generator.
* **50%** are foreign traffic the ladder does not describe: CQs and exchanges between other
  stations, on randomly drawn callsigns that are verified to survive the 28-bit packing.

The two halves are reported separately, so anyone whose band is busier or quieter than 50/50 can
reweight the result instead of taking this one on trust.

<!-- RESULTS TABLE -->

---

## 🔁 Reproducing it

```bash
python -m z30_dsp.benchmark --ap --mode realistic --fading none \
    --min-snr -26.5 --max-snr -21.5 --step 0.5 --frames 80 --seed 20260830
```

Serial by construction: both arms decode in one process off one demodulation, so there is no
worker pool. Parallelising it would spread the pair across processes for no change to the result
and one more place for the two arms to diverge.

---

## 🧪 What the tests guard

| File | What it pins |
| :--- | :--- |
| `tests/test_ap_decode.py` | The mechanism (pinning survives every iteration, sign convention, magnitude), the gates (callsign round-trip, frequency window, unknown stage), that AP never loses a frame the ordinary decoder found, that a wrong hypothesis is always rejected, determinism through the rewritten LLR vector, and that the pre-AP decode path is bit-identical with an empty mask. |
| `tests/apDecode.test.mjs` | The same, plus the packing vectors and the closing-modifier branch order that `packZ30Message` depends on. |
| `tests/test_cross_language_parity.py` | `AP_LLR_MARGIN`, `AP_FREQ_WINDOW_HZ`, `AP_DEEP_TYPE`, the type catalogue, the stage ladder (membership **and** order), the closing-modifier codes, and the shared callsign packing vectors. |

Every expectation in those files is computed from the data the test itself generates. There are
no recorded "expected" decode counts — a count written down once and asserted forever passes
because it was copied, not because the decoder worked.

---

## 🐞 A defect this feature found

Building the a5 hypothesis surfaced a live bug in the message packer. `packZ30Message` tested
its numeric-report branch before its modifier branches, and `/^\d+$/` matches `'73'` — so the
`third === '73'` arm was **unreachable**, and every sign-off packed as
`extraCode = min(60, 73 + 30) = 60`, a **+30 dB signal report**. The Tx5 macro is
`<dx> <me> 73`, so every z-30 QSO ended by transmitting a report of +30 dB, and the unpacker
faithfully rendered it back as `+30`.

The 7-bit allocation always reserved 62 for `73` and the unpacker has always decoded 62 as `73`;
only the packer never emitted it. Emitting it now is a fix rather than a wire-format change — an
existing receiver already understands the value. `tests/apDecode.test.mjs` guards the branch
order, and `tests/test_cross_language_parity.py` guards it a second way by asserting the
positions of the two branches in the source.

### A related defect that is *not* fixed here

`R-12` and `-12` pack to the **same** 7-bit code (18). `packZ30Message` sets
`type: 'ROGER_REPORT'` for the first and `type: 'REPORT'` for the second, but the R is not
carried in the payload, so `unpackZ30Message` renders both as `-12` and Tx4 is indistinguishable
on the air from Tx3.

This one cannot be fixed without changing the wire format: all 128 states of the 7-bit field are
allocated (0–60 reports, 61 RRR, 62 73, 63 RR73, 64–127 grids), so there is no spare code point
for the R flag. `AGENTS.md` names a codec change as a protocol break — "every station on the air
stops decoding you" — so it is recorded here rather than made. It does not affect AP: no
hypothesis in the ladder asserts a report value.

---

## 🔗 Related

* [04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md) — the decoder AP
  constrains, and the CRC-14 that arbitrates every hypothesis.
* [05. Successive Interference Cancellation (SIC)](05-Successive-Interference-Cancellation-(SIC).md)
  — the other way this receiver recovers frames an ordinary single-pass decode loses. AP and SIC
  compose: the ladder is offered to every SIC pass's candidates.
* [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md) — the measurement standard
  this page's numbers are held to.
