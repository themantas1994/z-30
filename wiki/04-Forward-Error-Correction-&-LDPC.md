# 04. Forward Error Correction & LDPC

This document details the source coding, message compression, Low-Density Parity-Check (LDPC) forward error correction matrix, and belief-propagation decoding algorithm used in **z-30**.

---

## 📦 Message Structure & 63-Bit Source Packing

A z-30 v1 frame carries a **63-bit message** (`crates/z30-protocol/src/codec.rs`; `SPEC.md` §6):

| Field | Bits | Contents |
| :--- | :--- | :--- |
| To | 28 | a callsign, or one of the tokens `CQ`, `CQ DX`, `CQ TEST`, `QRZ` |
| From | 28 | a callsign |
| Extra | 7 | a report −30…+30 dB (codes 0–60), `RRR` (61), `73` (62), `RR73` (63), a grid from the 63-square v1 table (64–126); 127 unassigned |
| **Message** | **63** | |

Plus the 14-bit CRC below: 77 information bits. (Earlier text called this a "77-bit QSO
exchange"; the message is 63 bits. FT8 carries 77 message bits.)

### Callsigns

A callsign v1 can carry is a 1–2 character prefix, one digit and a 1–3 letter suffix, packed as

$$N = ig( (p \cdot 37 + p') \cdot 10 + d ig) \cdot 27^3 + (s_0 \cdot 27^2 + s_1 \cdot 27 + s_2) + 100$$

($p, p'$ over `[ 0-9A-Z]`, $s_i$ over `[ A-Z]`). The full space exceeds $2^{28}$, so prefixes from
`ZV` upward would wrap onto other callsigns. **z-30 refuses them**, and refuses portable (`/P`),
compound (`EA8/G4XYZ`) and 3-character-prefix calls, rather than transmitting something else.
The retired browser packer did transmit something else — `ZY2ABC` as `24BWE`, `G4XYZ/P` as
`EY6ACQ` (audit C-06).

### The extra field

There is **no roger bit**: `R-12` cannot be sent, and a report sent in reply to a report carries
the roger by its place in the sequence. Only the 63 grid squares in the v1 table can be sent; any
other square is refused. The retired packer hashed other squares onto the table and transmitted
a different grid (`FN42` went out as `RE78`, audit C-06).

**The rule, enforced at encode time and again by the transmit gate:** a message is sent only if
its encoded frame reads back — symbols, parity, CRC, fields and text — as exactly the message
requested (`EncodedMessage::verify_round_trip`). `crates/z30-protocol/tests/round_trip.rs` checks
every one of the 32,400 Maidenhead squares, every report and 40,000 sampled callsigns.

---

## 🛡️ 14-Bit Cyclic Redundancy Check (CRC-14)

To eliminate false decodes under severe noise conditions, the 63-bit information vector is appended with a **14-bit CRC**:

$$P(x) = x^{14} + x^{13} + x^{10} + x^{6} + x + 1 \quad (\text{register constant } \mathtt{0x2443}\text{, } x^{14} \text{ implicit; initial seed } \mathtt{0x2757}\text{, MSB-first})$$

> Earlier revisions of this page, and of both legacy implementations, wrote this as
> $x^{14} + x^{11} + x^2 + 1$ - a different polynomial (register constant `0x0805`). The two
> legacy implementations agreed with each other so nothing broke, but a third implementation
> written from that specification would have produced a CRC failing against both.
> `tests/vectors/crc14_vectors.json` now pins the answer for every implementation. The original
> audit reported an independent re-implementation from `SPEC.md` reproducing all golden vectors
> (E007); that evidence is not in this repository.

- **Protected block**: $K = 63 + 14 = 77$ bits.
- **False accepts**: a CRC-14 passes a random wrong word with probability $2^{-14} \approx 6.1 \times 10^{-5}$.
  What reaches the CRC is not random, and how many candidates are tried matters, so the rate
  that matters is measured, not derived: see the false-decode rows on
  [16](16-Benchmarking-Testing-&-CI.md) (no false decode has been observed in any vNext run).

---

## 🔢 Irregular Repeat-Accumulate LDPC (216, 77) Code

The forward error correction engine uses a systematic **Rate-0.356 Irregular Repeat-Accumulate (IRA) Low-Density Parity-Check code**:
- **Codeword Length ($N$)**: 216 channel bits ($54 \text{ data symbols} \times 4 \text{ bits/symbol}$).
- **Information Bits ($K$)**: 77 bits ($63 \text{ payload} + 14 \text{ CRC}$).
- **Parity Equations ($M$)**: $216 - 77 = 139$ parity-check constraints.
- **Code Rate ($R$)**: $77 / 216 \approx 0.356$.

### Parity Check Matrix $H$:
The matrix $H = [H_d \mid H_p]$ consists of a sparse information matrix $H_d$ ($139 \times 77$) and a dual-diagonal parity structure $H_p$ ($139 \times 139$), ensuring linear-time $O(N)$ encoding.

---

## 🧠 Multi-Schedule Min-Sum / Sum-Product Belief Propagation Decoder

The receiver performs iterative message passing between Variable Nodes ($V_n$) and Check Nodes ($C_m$) on the bipartite Tanner graph:

```
 Variable Nodes (LLRs)         Check Nodes (Parity Equations)
    [ V_0 ] ────────┬──────────── [ C_0 ]
    [ V_1 ] ───────┼───────────── [ C_1 ]
    [ V_2 ] ──────┼────────────── [ C_2 ]
      ...          │                ...
   [ V_215 ] ──────┴───────────── [ C_138 ]
```

> **Correction (2026-08-31):** every earlier revision of this page described a single normalized
> min-sum schedule with a fixed $\alpha = 0.75$. That was never what either implementation ran.
> the oracle's `decode_min_sum` and the legacy `decodeMinSum` have always run the
> four-schedule cascade documented below, identically in both languages. A paired benchmark
> (240 frames across SNR −24/−25/−26 dB, same frame and channel noise decoded by both the real
> cascade and a from-scratch reimplementation of the single-schedule description this page used
> to carry) found the cascade decodes strictly more frames at every point tested — 23 of 23
> disagreements went to the cascade, 0 to the single schedule (exact McNemar test, p ≈ 4×10⁻⁷,
> i.e. **>99.9999% confidence**). Per the benchmark-integrity rule in `AGENTS.md` §5, that clears
> the bar to correct the documentation rather than the code. See
> [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md) for the method.

### The four decode schedules

A candidate is tried against up to four schedules in order, stopping the instant any of them
produces a hard-decision codeword whose syndrome is zero **and** whose 14-bit CRC matches:

| # | Mode | $\alpha$ | $\beta$ | Damping | Check order | Iteration cap |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | Normalized min-sum (layered) | 0.82 | 0.08 | 0.88 | forward | 45 |
| 2 | Log-domain sum-product (exact box-plus, Jacobian-corrected) | 0.95 | — | 0.85 | forward | 40 |
| 3 | Normalized min-sum (layered) | 0.74 | 0.04 | 0.90 | **reverse** | 35 |
| 4 | Dithered normalized min-sum (random LLR perturbation before decoding) | 0.80 | 0.06 | 0.85 | forward | 30 |

That is a maximum of 150 total iterations across all four schedules for one candidate, though a
typical clean frame converges within the first schedule in single digits of iterations. Schedule
3's reverse check-node order and schedule 4's random perturbation exist to escape the trapping
sets / pseudocodewords a single deterministic schedule can stall on near the decode threshold —
the mechanism the paired benchmark above measured. The Rust decoder (`crates/z30-dsp/src/ldpc.rs`)
is bit-exact with the oracle on the recorded corpus: the same verdict, the same information
bits and the same iteration count on all 540 frames (`tests/golden_ldpc.rs`).

There is no single $\alpha$ for "the decoder" any more than there is a single schedule — the
$0.75$ figure this page carried for years was nominal, never live. Each schedule's own
$\alpha$/$\beta$/damping triple above is what is actually applied at every check-node update:

$$L_{m \to n} = \left( \prod_{n' \in N(m) \setminus \{n\}} \text{sgn}(L_{n' \to m}) \right) \cdot \max\!\big(0,\ \alpha \cdot \min_{n' \in N(m) \setminus \{n\}} |L_{n' \to m}| - \beta\big)$$

for the three normalized-min-sum schedules, or the box-plus (Jacobian-corrected) combination for
schedule 2's sum-product pass. Every check-node update is damped: the applied message is a
weighted blend of the freshly computed value and the previous iteration's message,
`(1 − damping) × old + damping × new`. A damping of 0.85–0.90 still moves most of the way to the
new value each iteration, just not all the way, which is what keeps the reverse-order and
dithered passes from oscillating.

### Algorithm steps (per schedule)

1. **Initialization**: Initialize variable-to-check messages $L_{n \to m} = \text{LLR}_n$ (schedule 4 additionally adds a small uniform random perturbation to every channel LLR first).
2. **Check Node Update**: per the table above, in the schedule's check order (forward, or reversed for schedule 3).
3. **Variable Node Update**:
   $$L_{n \to m} = \text{LLR}_n + \sum_{m' \in M(n) \setminus \{m\}} L_{m' \to n}$$
4. **Hard Decision & CRC Parity Check**:
   $$\hat{c}_n = \begin{cases} 0 & \text{if } \text{LLR}_n + \sum_{m \in M(n)} L_{m \to n} \ge 0 \\ 1 & \text{if } \text{LLR}_n + \sum_{m \in M(n)} L_{m \to n} < 0 \end{cases}$$
   If $H \cdot \hat{\mathbf{c}}^T = \mathbf{0} \pmod 2$ and the 14-bit CRC matches, decoding terminates with **SUCCESS** immediately (often in single digits of iterations for a clean frame).
5. **Trellis-IRA re-check**: independently of the syndrome, whenever a candidate's *payload* CRC
   already matches its received CRC, the 139 parity bits are re-derived from those 77 information
   bits directly (the same forward-substitution the encoder uses) and checked against the
   syndrome — this catches a codeword whose information bits are already correct but whose noisy
   parity bits haven't converged, without spending more iterations on them.
6. **Escalation**: if a schedule's iteration cap is reached without success, the next schedule in
   the table runs on a fresh copy of the channel LLRs.
7. **OSD**: if all four fail, ordered-statistics post-processing (up to 2 bit flips on the most
   reliable basis) proposes codewords. In z-30 a proposal is accepted only if its CRC field
   matches the **received** CRC bits as well as its own payload — the legacy check compared a
   codeword's CRC with the CRC computed from that same codeword, which is always true (a
   tautology; audit H-09 / M1), so the legacy OSD's only real test was the syndrome. The union
   bound on a false OSD accept is about $106 \times 2^{-14} \approx 6.5 \times 10^{-3}$ per
   invocation *before* the fine-sync gate and the CRC-field match, and 0 false decodes have been
   observed in any measured run (`docs/ldpc.md`).
8. Otherwise the candidate fails. A failed candidate is **not** passed to SIC: SIC subtracts only
   frames that decoded ([05](05-Successive-Interference-Cancellation-(SIC).md)).

---

## 🎯 Decoding with information the receiver already has

Everything above treats all 77 information bits as unknowns. When the receiver is in a QSO it is
not: a station answering your CQ has to have put your callsign in the first 28 bits, or it is
not answering you. **A priori (AP) decoding** asserts those bits instead of measuring them, and
lets the CRC-14 decide whether the assertion was right.

The whole cascade above runs first and unchanged — AP is only attempted on a frame that has
already failed every schedule, so it can add decodes but cannot change or lose one. An asserted
bit is *pinned*: its belief is held at the asserted value for every iteration rather than merely
initialised there, so no run of confident check messages can walk it back.

The mechanism, the hypothesis ladder, the gates that keep it from being tried where the QSO
state does not apply, the measured effect and the false-accept cost are all in
[17. A Priori (AP) Decoding](17-A-Priori-(AP)-Decoding.md).
