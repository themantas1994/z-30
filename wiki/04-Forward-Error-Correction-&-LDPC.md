# 04. Forward Error Correction & LDPC

This page covers how a message becomes 216 coded bits and how the receiver turns noisy
log-likelihood ratios (LLRs) back into a message: the 63-bit message packing, the CRC-14, the
(216, 77) LDPC code and the decoder cascade. The code is `crates/z30-protocol` (codec, CRC,
encoder) and `crates/z30-dsp/src/ldpc.rs` (decoder); the developer account is
[`docs/ldpc.md`](../docs/ldpc.md).

## Message structure

A v1 frame carries a **63-bit message** (`crates/z30-protocol/src/codec.rs`; `SPEC.md` §6):

| Field | Bits | Contents |
| :--- | :--- | :--- |
| To | 28 | a callsign, or one of the tokens `CQ`, `CQ DX`, `CQ TEST`, `QRZ` |
| From | 28 | a callsign |
| Extra | 7 | a report −30…+30 dB (codes 0–60), `RRR` (61), `73` (62), `RR73` (63), a grid from the 63-square v1 table (64–126); 127 unassigned |
| **Message** | **63** | |

The 14-bit CRC below brings this to 77 information bits. FT8, for comparison, carries 77
message bits.

### Callsigns

A callsign v1 can carry is a 1–2 character prefix, one digit and a 1–3 letter suffix, packed as

$$N = \big( (p \cdot 37 + p') \cdot 10 + d \big) \cdot 27^3 + (s_0 \cdot 27^2 + s_1 \cdot 27 + s_2) + 100$$

($p, p'$ over `[ 0-9A-Z]`, $s_i$ over `[ A-Z]`). The full space exceeds $2^{28}$, so prefixes from
`ZV` upward would wrap onto other callsigns. The codec refuses them, and it refuses portable
(`/P`), compound (`EA8/G4XYZ`) and 3-character-prefix calls, rather than transmit something else.

### The extra field

There is **no roger bit**. `R-12` cannot be sent, and a report sent in reply to a report carries
the roger by its place in the sequence. Only the 63 grid squares in the v1 table can be sent;
any other square is refused instead of being mapped onto the table.

**The rule, enforced at encode time and again by the transmit gate:** a message is sent only if
its encoded frame reads back — symbols, parity, CRC, fields and text — as exactly the message
requested (`EncodedMessage::verify_round_trip`).
`crates/z30-protocol/tests/round_trip.rs` checks every one of the 32,400 Maidenhead squares,
every report and 40,000 sampled callsigns.

## CRC-14

The 63-bit message is followed by a 14-bit CRC so that the receiver can tell a decode from noise:

$$P(x) = x^{14} + x^{13} + x^{10} + x^{6} + x + 1 \quad (\text{register constant } \mathtt{0x2443}\text{, } x^{14} \text{ implicit; initial seed } \mathtt{0x2757}\text{, MSB-first})$$

`tests/vectors/crc14_vectors.json` pins the result for every implementation.

- **Protected block:** $K = 63 + 14 = 77$ bits.
- **False accepts:** a CRC-14 passes a random wrong word with probability
  $2^{-14} \approx 6.1 \times 10^{-5}$. What reaches the CRC is not random, and the number of
  candidates tried matters, so the rate that counts is measured, not derived. See the
  false-decode rows on [16](16-Benchmarking-Testing-&-CI.md); no false decode has been observed
  in any benchmark run.

## The (216, 77) LDPC code

The code is a systematic rate-0.356 irregular repeat-accumulate (IRA) LDPC code:

- **Codeword length $N$:** 216 channel bits (54 data symbols × 4 bits/symbol).
- **Information bits $K$:** 77 (63 payload + 14 CRC).
- **Parity equations $M$:** $216 - 77 = 139$.
- **Code rate $R$:** $77 / 216 \approx 0.356$.

The parity-check matrix is $H = [H_d \mid H_p]$: a sparse information part $H_d$
($139 \times 77$) and a dual-diagonal parity part $H_p$ ($139 \times 139$), which makes encoding
linear in $N$.

## Belief-propagation decoder

The decoder passes messages between variable nodes (the 216 LLRs) and check nodes (the 139
parity equations) on the code's Tanner graph. It does not run one schedule but a cascade of four.
A paired benchmark in 2026-08 (240 frames at −24, −25 and −26 dB, the same noise decoded by the
cascade and by a single normalised min-sum schedule) found 23 disagreements, all in the
cascade's favour (exact two-sided McNemar p ≈ 2.4 × 10⁻⁷). That run used the earlier reference
implementation and no result file was kept; the cascade has been in the code since.

### The four schedules

A candidate is tried against up to four schedules in order, stopping the moment one produces a
hard-decision codeword whose syndrome is zero **and** whose 14-bit CRC matches:

| # | Mode | $\alpha$ | $\beta$ | Damping | Check order | Iteration cap |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | Normalized min-sum (layered) | 0.82 | 0.08 | 0.88 | forward | 45 |
| 2 | Log-domain sum-product (exact box-plus, Jacobian-corrected) | 0.95 | — | 0.85 | forward | 40 |
| 3 | Normalized min-sum (layered) | 0.74 | 0.04 | 0.90 | **reverse** | 35 |
| 4 | Dithered normalized min-sum (LLR perturbation before decoding) | 0.80 | 0.06 | 0.85 | forward | 30 |

That is at most 150 iterations per candidate, though a clean frame converges in the first
schedule within single-digit iterations. Schedule 3's reverse check order and schedule 4's
perturbation exist to escape the trapping sets and pseudocodewords a single deterministic
schedule can stall on near the decode threshold. The perturbation is derived from the LLRs
themselves, so a decode is reproducible. The Rust decoder
(`crates/z30-dsp/src/ldpc.rs`) reproduces the frozen reference corpus exactly: the same verdict,
information bits and iteration count on all 540 frames (`tests/golden_ldpc.rs`).

Each schedule applies its own $\alpha$/$\beta$/damping triple at every check-node update:

$$L_{m \to n} = \left( \prod_{n' \in N(m) \setminus \{n\}} \text{sgn}(L_{n' \to m}) \right) \cdot \max\!\big(0,\ \alpha \cdot \min_{n' \in N(m) \setminus \{n\}} |L_{n' \to m}| - \beta\big)$$

for the three normalized-min-sum schedules, or the box-plus (Jacobian-corrected) combination for
schedule 2. Every update is damped: the applied message is a blend of the new value and the
previous iteration's message, `(1 − damping) × old + damping × new`. At 0.85–0.90 each iteration
still moves most of the way to the new value, which keeps the reverse-order and dithered passes
from oscillating.

### Steps per candidate

1. **Initialisation.** Variable-to-check messages start at the channel LLRs,
   $L_{n \to m} = \text{LLR}_n$. Schedule 4 first adds a small perturbation to every LLR.
2. **Check-node update** as in the table, in the schedule's check order.
3. **Variable-node update:**
   $$L_{n \to m} = \text{LLR}_n + \sum_{m' \in M(n) \setminus \{m\}} L_{m' \to n}$$
4. **Hard decision and CRC check:**
   $$\hat{c}_n = \begin{cases} 0 & \text{if } \text{LLR}_n + \sum_{m \in M(n)} L_{m \to n} \ge 0 \\ 1 & \text{if } \text{LLR}_n + \sum_{m \in M(n)} L_{m \to n} < 0 \end{cases}$$
   If $H \cdot \hat{\mathbf{c}}^T = \mathbf{0} \pmod 2$ and the 14-bit CRC matches, decoding stops
   with success.
5. **Re-encode check.** Independently of the syndrome, whenever the hard decision's payload CRC
   matches its received CRC field, its 77 information bits are re-encoded with the encoder's
   forward substitution. The result is accepted if that codeword correlates positively with the
   channel LLRs **and** differs from the hard decision in at most 12 bits (SPEC §7). This catches
   a codeword whose information bits are already right but whose noisy parity bits have not
   converged.
6. **Escalation.** If a schedule reaches its iteration cap without success, the next schedule
   runs on a fresh copy of the channel LLRs.
7. **OSD.** If all four fail, and only if the best BP iteration reached a syndrome weight of at
   most 14 (SPEC §7), ordered-statistics post-processing flips up to two of the 14 least
   reliable of all 77 information bits (payload **and** CRC field) of that iteration's hard
   decision and re-encodes. A candidate is accepted only if its CRC field equals the CRC of its
   own payload, and it then passes the correlation (> 20) and distance (≤ 16 bits) gates
   (SPEC §7.1). Before those two gates, the union bound on a random CRC pass is
   $106 \times 2^{-14} \approx 6.5 \times 10^{-3}$ per invocation. The measured false-decode
   figures are in [`docs/ldpc.md`](../docs/ldpc.md) and [16](16-Benchmarking-Testing-&-CI.md).
8. **Failure.** Otherwise the candidate fails. A failed candidate is not passed to SIC, which
   subtracts only frames that decoded ([05](05-Successive-Interference-Cancellation-(SIC).md)).

## Decoding with information the receiver already has

Everything above treats all 77 information bits as unknowns. In a QSO the receiver knows more:
a station answering your CQ has to have put your callsign in the first 28 bits, or it is not
answering you. **A priori (AP) decoding** asserts those bits instead of measuring them and lets
the CRC-14 decide whether the assertion was right.

The cascade above runs first and unchanged. AP is attempted only on a frame that has already
failed every schedule, so for that frame it can add a decode but cannot change or lose one
(across SIC passes the guarantee is weaker; see [17](17-A-Priori-(AP)-Decoding.md)). An asserted
bit is *pinned*: its belief is held at the asserted value on every iteration, so no run of
confident check messages can walk it back. The hypothesis ladder, the gates, the measured effect
and the false-accept cost are all on [17](17-A-Priori-(AP)-Decoding.md).
