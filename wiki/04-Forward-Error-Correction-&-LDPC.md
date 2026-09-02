# 04. Forward Error Correction & LDPC

This document details the source coding, message compression, Low-Density Parity-Check (LDPC) forward error correction matrix, and belief-propagation decoding algorithm used in **z-30**.

---

## 📦 Message Structure & 63-Bit Source Packing

Amateur radio transmissions in z-30 encode structured contact messages into a compact **63-bit information vector** (`z30Codec.ts:encodeCallsign28`, `z30_dsp/ldpc.py`), structured as follows:

| Field | Bit Length | Representation / Compression |
| :--- | :--- | :--- |
| **Callsign 1 (Destination)** | 28 bits | Radix-37 prefix + digit + Radix-27 suffix packing |
| **Callsign 2 (Source)** | 28 bits | Radix-37 prefix + digit + Radix-27 suffix packing |
| **Grid / Report / Extra** | 7 bits | 4-char Maidenhead grid (indexed table + hashed fallback) or SNR report, 0-127 states |
| **Total Information Bits ($K$)** | **63 bits** | Encodes standard QSO exchanges with zero ambiguity |

### Radix-37 / Radix-27 Callsign Encoding
Standard amateur callsigns (e.g., `W1AW`, `K1ABC`, `EA8/G4XYZ`) are decomposed into a 1-2 character prefix, a single digit, and a 1-3 character alphabetic suffix:

$$N = \big( (p \cdot 37 + p') \cdot 10 + d \big) \cdot 27^3 + (s_0 \cdot 27^2 + s_1 \cdot 27 + s_2) + 4$$

Where $p, p'$ are Radix-37 prefix characters (`[A-Z0-9 ]`), $d$ is the decimal digit, and $s_0, s_1, s_2$ are Radix-27 suffix characters (`[A-Z ]`). Total addressable states: $37^2 \times 10 \times 27^3 = 269{,}460{,}270$, fitting within 28 bits ($2^{28} = 268{,}435{,}456$ ceiling is exceeded only by reserved low tokens `CQ`/`CQ DX`/`CQ TEST`/`QRZ`, which are assigned dedicated values 0-3).

### 7-Bit Grid / Report Field
4-character Maidenhead grids are looked up in a 64-entry table of common global locators (values 64-127); grids outside the table hash to the same 64-127 range. Signal reports and modifiers (`RR73`, `73`, etc.) use the same 7-bit field via a separate encoding path.

---

## 🛡️ 14-Bit Cyclic Redundancy Check (CRC-14)

To eliminate false decodes under severe noise conditions, the 63-bit information vector is appended with a **14-bit CRC**:

$$P(x) = x^{14} + x^{13} + x^{10} + x^{6} + x + 1 \quad (\text{register constant } \mathtt{0x2443}\text{, } x^{14} \text{ implicit; initial seed } \mathtt{0x2757}\text{, MSB-first})$$

> Earlier revisions of this page, and of both source implementations, wrote this as
> $x^{14} + x^{11} + x^2 + 1$ - a different polynomial (register constant `0x0805`). The two
> shipped implementations agreed with each other so nothing broke, but a third implementation
> written from that specification would have produced a CRC failing against both.
> `tests/vectors/crc14_vectors.json` now pins the answer for every implementation.

- **Protected Codeword Size**: $K_{\text{total}} = 63 + 14 = 77 \text{ bits}$ (no padding required).
- **False Decode Probability**: $P_{\text{false}} \approx 2^{-14} \approx 6.1 \times 10^{-5}$ per candidate for random errors. Costas coherence validation rejects further candidates on top of this, but the combined figure has not been measured and no number is claimed for it here.

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
> `z30_dsp/ldpc.py::decode_min_sum` and `src/dsp/ldpcCodec.ts::decodeMinSum` have always run the
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
the mechanism the paired benchmark above measured. `LDPC_MAX_ITERATIONS` (TypeScript) and the
`max_iterations` constructor argument (Python) both refer to schedule 1's cap (45); it is what
`SpecsModal` quotes, since it is also the number a well-formed frame converges within almost
always.

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
   the table runs on a fresh copy of the channel LLRs. If schedule 4 also fails to produce a
   CRC-valid codeword, the frame is flagged for SIC processing (see
   [05. Successive Interference Cancellation](05-Successive-Interference-Cancellation-(SIC).md)) or marked unresolvable.

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
