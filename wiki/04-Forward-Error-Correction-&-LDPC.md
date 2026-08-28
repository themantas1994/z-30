# 04. Forward Error Correction & LDPC

This document details the source coding, message compression, Low-Density Parity-Check (LDPC) forward error correction matrix, and belief-propagation decoding algorithm used in **z-30**.

---

## 📦 Message Structure & 58-Bit Source Packing

Amateur radio transmissions in z-30 encode structured contact messages into a compact **58-bit information vector**, structured as follows:

| Field | Bit Length | Representation / Compression |
| :--- | :--- | :--- |
| **Callsign 1 (Sender / CQ)** | 28 bits | Base-40 alphanumeric character mapping |
| **Callsign 2 (Recipient)** | 28 bits | Base-40 alphanumeric character mapping |
| **Grid / Report / Modifiers** | 2 bits (or dynamic) | 4-char Maidenhead grid / SNR ($-50$ to $+49\text{ dB}$) / `RR73` / `73` |
| **Total Information Bits ($K$)** | **58 bits** | Encodes standard QSO exchanges with zero ambiguity |

### Base-40 Callsign Encoding
Standard amateur callsigns (e.g., `W1AW`, `3X4ABC`, `DL1XYZ/P`) use an alphabet of 40 symbols: `[0-9]`, `[A-Z]`, space, `/`, `.`, `-`.
A standard 6-character callsign $c_0 c_1 c_2 c_3 c_4 c_5$ is packed into an integer:

$$N = \sum_{i=0}^{5} c_i \cdot 40^{5-i} < 2^{28}$$

---

## 🛡️ 14-Bit Cyclic Redundancy Check (CRC-14)

To eliminate false decodes under severe noise conditions, the 58-bit information vector is appended with a **14-bit CRC**:

$$P(x) = x^{14} + x^{11} + x^2 + 1 \quad (\text{Hex polynomial: } \mathtt{0x2443})$$

- **Protected Codeword Size**: $K_{\text{total}} = 58 + 14 = 72 \text{ bits}$ (padded to 77 bits with 5 auxiliary signaling bits).
- **False Decode Probability**: $P_{\text{false}} \le 2^{-14} \approx 6.1 \times 10^{-5}$ per candidate, and $< 10^{-6}$ after Costas coherence validation.

---

## 🔢 Quasi-Cyclic LDPC (216, 77) Code

The forward error correction engine uses a systematic **Rate-0.356 Irregular Repeat-Accumulate (IRA) Low-Density Parity-Check code**:
- **Codeword Length ($N$)**: 216 channel bits ($54 \text{ data symbols} \times 4 \text{ bits/symbol}$).
- **Information Bits ($K$)**: 77 bits ($58 \text{ message} + 14 \text{ CRC} + 5 \text{ flag}$).
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
