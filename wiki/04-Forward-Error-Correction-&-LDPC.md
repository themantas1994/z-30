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

$$P(x) = x^{14} + x^{11} + x^2 + 1 \quad (\text{Hex polynomial: } \mathtt{0x2443}, \text{ initial seed } \mathtt{0x2757})$$

- **Protected Codeword Size**: $K_{\text{total}} = 63 + 14 = 77 \text{ bits}$ (no padding required).
- **False Decode Probability**: $P_{\text{false}} \le 2^{-14} \approx 6.1 \times 10^{-5}$ per candidate, and $< 10^{-6}$ after Costas coherence validation.

---

## 🔢 Quasi-Cyclic LDPC (216, 77) Code

The forward error correction engine uses a systematic **Rate-0.356 Irregular Repeat-Accumulate (IRA) Low-Density Parity-Check code**:
- **Codeword Length ($N$)**: 216 channel bits ($54 \text{ data symbols} \times 4 \text{ bits/symbol}$).
- **Information Bits ($K$)**: 77 bits ($63 \text{ payload} + 14 \text{ CRC}$).
- **Parity Equations ($M$)**: $216 - 77 = 139$ parity-check constraints.
- **Code Rate ($R$)**: $77 / 216 \approx 0.356$.

### Parity Check Matrix $H$:
The matrix $H = [H_d \mid H_p]$ consists of a sparse information matrix $H_d$ ($139 \times 77$) and a dual-diagonal parity structure $H_p$ ($139 \times 139$), ensuring linear-time $O(N)$ encoding.

---

## 🧠 Normalized Min-Sum Belief Propagation Decoder

The receiver performs iterative message passing between Variable Nodes ($V_n$) and Check Nodes ($C_m$) on the bipartite Tanner graph:

```
 Variable Nodes (LLRs)         Check Nodes (Parity Equations)
    [ V_0 ] ────────┬──────────── [ C_0 ]
    [ V_1 ] ───────┼───────────── [ C_1 ]
    [ V_2 ] ──────┼────────────── [ C_2 ]
      ...          │                ...
   [ V_215 ] ──────┴───────────── [ C_138 ]
```

### Algorithm Steps:
1. **Initialization**: Initialize variable-to-check messages $L_{n \to m} = \text{LLR}_n$.
2. **Check Node Update (Normalized Min-Sum)**:
   $$L_{m \to n} = \alpha \cdot \left( \prod_{n' \in N(m) \setminus \{n\}} \text{sgn}(L_{n' \to m}) \right) \cdot \min_{n' \in N(m) \setminus \{n\}} |L_{n' \to m}|$$
   Where $\alpha = 0.75$ is the empirical attenuation factor compensating for magnitude overestimation in the Min-Sum approximation.
3. **Variable Node Update**:
   $$L_{n \to m} = \text{LLR}_n + \sum_{m' \in M(n) \setminus \{m\}} L_{m' \to n}$$
4. **Hard Decision & CRC Parity Check**:
   $$\hat{c}_n = \begin{cases} 0 & \text{if } \text{LLR}_n + \sum_{m \in M(n)} L_{m \to n} \ge 0 \\ 1 & \text{if } \text{LLR}_n + \sum_{m \in M(n)} L_{m \to n} < 0 \end{cases}$$
   If $H \cdot \hat{\mathbf{c}}^T = \mathbf{0} \pmod 2$ and the 14-bit CRC polynomial matches, decoding terminates with **SUCCESS** immediately (often in 3 to 12 iterations).
5. **Iteration Limit**: If CRC fails after 50 iterations, the candidate is flagged for subsequent SIC processing or marked unresolvable.
