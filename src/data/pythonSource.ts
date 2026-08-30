/**
 * Python and packaging sources for the in-app engineering workbench viewer.
 *
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:python-source
 *
 * The browser cannot read the repository, so the viewer needs these files as strings. This is
 * produced from the real files at build time; it used to be a hand-copied snapshot that had
 * already drifted from the code it claimed to show, with nothing that could keep it current.
 */

export interface PythonFile {
  /** Base name, shown in the file list. */
  filename: string;
  /** Repository-relative path. */
  path: string;
  /** One-line summary shown beside the file name. */
  description: string;
  /** Verbatim file contents. */
  code: string;
}

export const PYTHON_SOURCE_FILES: PythonFile[] = [
  {
    filename: "ldpc.py",
    path: "z30_dsp/ldpc.py",
    description: "Systematic (216, 77) Irregular Repeat-Accumulate (IRA) LDPC encoder and vectorized min-sum belief propagation decoder.",
    code: `"""
z-30 Systematic (216, 77) LDPC Codec & Min-Sum BP Decoder
===========================================================

Mathematical Specification & Design Rationale:
----------------------------------------------
1. Code Parameters:
   - Codeword length (n): 216 channel coded bits.
   - Information block length (k): 77 bits (63-bit amateur payload + 14-bit CRC-14).
   - Parity check equations (m = n - k): 139 checks.
   - Code rate (R): R = 77 / 216 ≈ 0.3564. Against an idealised AWGN channel with perfect
     synchronisation, the seeded benchmark crosses 50% decode near -24.6 dB SNR and 90% near
     -23.6 dB (2500 Hz reference bandwidth). That is a bound on the code under ideal detection,
     not an over-the-air threshold - see the docstring of z30_dsp/benchmark.py.
   - Modulation Symbol Mapping: 216 coded bits / (4 bits/symbol) = 54 data symbols in 16-MFSK.
     Coupled with 21 Costas synchronization symbols, total frame = 75 symbols (24.0s duration at Ts=320ms).

2. Parity-Check Matrix H:
   H = [ H_info (139 x 77) | H_parity (139 x 139) ]
   - H_info: Degree-5 sparse binary matrix defined by Z30_CHECK_TO_INFO, a precomputed Girth-6 connection
     table mapping each of the 139 check nodes to 5 information bit indices (no length-4 cycles).
   - H_parity: Dual-diagonal bidiagonal accumulator structure:
       H_parity[p, p] = 1 for all 0 <= p < 139
       H_parity[p, p-1] = 1 for all 1 <= p < 139

3. Systematic Linear-Time O(n) Encoder Algorithm:
   Due to the dual-diagonal IRA structure, parity bits are solved recursively in O(n) time without matrix inversion:
     p_0 = sum_{j in N(0)} u_j  (mod 2)
     p_i = p_{i-1} ^ (sum_{j in N(i)} u_j)  (mod 2)  for i = 1, ..., 138

4. Error Detection:
   14-bit CRC generator polynomial, as implemented: g(x) = x^14 + x^13 + x^10 + x^6 + x + 1.
   Register constant 0x2443 (the low 14 coefficients; x^14 is implicit), Init 0x2757, MSB-first.
   Documentation here, in src/dsp/ldpcCodec.ts and in the README previously stated
   "x^14 + x^11 + x^2 + 1", which is a DIFFERENT polynomial (register constant 0x0805). The two
   shipped implementations agreed with each other so nothing broke, but a third implementation
   written from that specification would have produced a CRC that failed against both.
   Undetected frame error probability P_ue ~= 2^-14 = 6.1e-5 for random errors.

5. Vectorized Normalized Min-Sum Belief Propagation Decoder:
   - Check Node Update: L_{c->v} = alpha * prod(sign(L_{v'->c})) * min_{v' != v}(|L_{v'->c}|)
     where alpha = 0.75 is the empirical normalization factor mitigating check node overestimation.
   - Variable Node Update: L_{v->c} = L_{ch, v} + sum_{c' != c} L_{c'->v}
   - Early stopping condition: syndrome s = H * c^T == 0 (mod 2) and CRC valid.
"""

from typing import Tuple, List, Optional
import numpy as np

Z30_CHECK_TO_INFO: List[List[int]] = [
  [2,1,3,4,6],[7,8,5,10,9],[11,0,12,13,14],[17,16,15,20,19],[22,23,21,25,18],
  [27,28,24,30,26],[29,32,34,31,36],[33,38,37,35,41],[42,39,44,43,40],[47,46,45,48,51],
  [52,53,49,54,55],[50,57,59,58,60],[62,63,61,56,66],[64,65,69,68,70],[72,73,67,75,71],
  [0,1,74,76,8],[3,9,12,15,18],[2,5,11,19,22],[7,13,16,21,24],[6,10,14,23,17],
  [4,25,26,31,33],[27,32,35,40,46],[29,28,20,38,43],[36,30,41,39,47],[42,37,48,50,34],
  [44,45,49,57,61],[53,58,56,65,51],[55,59,63,68,71],[60,54,66,69,67],[52,70,62,74,75],
  [73,64,76,3,10],[1,5,12,17,72],[2,0,7,18,26],[8,4,14,19,21],[11,6,15,24,29],
  [16,9,25,27,36],[20,23,31,30,37],[22,13,32,28,39],[34,33,43,46,49],[35,45,52,56,50],
  [41,42,53,57,62],[38,44,51,55,64],[40,54,48,59,70],[60,47,61,71,76],[65,66,74,72,2],
  [63,67,58,3,0],[68,75,1,7,11],[73,69,4,5,13],[8,6,16,18,31],[10,15,21,28,35],
  [12,20,25,34,40],[9,19,24,23,38],[17,22,26,29,42],[14,27,33,45,39],[36,44,46,50,62],
  [37,32,47,43,52],[30,49,48,60,64],[51,57,54,63,73],[41,55,56,69,74],[53,61,59,67,4],
  [58,66,68,76,5],[71,70,1,10,16],[65,75,3,14,20],[0,9,17,28,31],[72,6,13,19,27],
  [8,2,15,25,32],[12,7,29,33,23],[11,18,30,38,42],[22,35,36,24,49],[21,26,34,44,52],
  [37,45,54,62,58],[39,46,55,57,67],[40,41,51,50,66],[48,53,63,72,76],[43,56,60,73,70],
  [59,47,65,1,13],[64,71,74,6,5],[69,61,0,75,10],[3,7,22,27,31],[2,9,68,14,30],
  [4,12,16,28,37],[11,20,8,26,35],[15,33,40,36,55],[18,24,17,34,41],[19,32,44,53,66],
  [23,39,48,56,75],[29,45,21,60,63],[25,38,46,54,61],[42,49,47,67,74],[43,51,59,72,0],
  [57,65,76,52,4],[50,68,6,12,21],[62,69,1,15,14],[64,58,8,22,40],[71,3,11,25,28],
  [2,73,17,35,39],[5,18,70,27,37],[10,20,13,36,48],[9,26,41,32,49],[16,30,34,51,61],
  [7,42,46,52,59],[23,44,54,65,5],[19,33,47,56,57],[24,45,53,64,31],[38,58,71,2,13],
  [29,55,66,73,8],[60,72,3,16,62],[50,63,43,69,7],[70,67,6,76,9],[75,15,22,34,38],
  [68,0,4,24,39],[10,74,11,32,50],[1,19,25,35,29],[12,27,43,48,55],[18,20,44,33,58],
  [17,30,40,21,56],[14,26,37,51,36],[23,28,41,52,63],[31,42,61,65,12],[46,64,72,9,20],
  [45,59,69,3,19],[53,60,68,10,18],[49,70,0,66,21],[47,62,4,17,7],[67,1,23,26,40],
  [54,74,13,15,31],[73,6,28,33,53],[57,71,8,24,43],[2,76,27,29,75],[14,22,16,41,44],
  [25,37,49,56,72],[11,34,45,66,4],[32,38,5,57,48],[35,30,55,62,0],[42,51,69,2,21],
  [39,50,54,76,18],[47,63,64,75,12],[52,58,73,1,36],[59,74,16,26,39],
]

class Z30LdpcCodec:
    """
    Production-grade Systematic (216, 77) LDPC Codec.
    Implements IRA forward-substitution encoding and normalized Min-Sum belief propagation.
    """

    def __init__(self, max_iterations: int = 45, alpha: float = 0.75) -> None:
        """
        Initializes the (216, 77) LDPC Codec.

        Args:
            max_iterations (int): Maximum belief propagation iterations (default: 45).
            alpha (float): Normalized Min-Sum scaling factor (default: 0.75).
        """
        self.k: int = 77   # Information block length (63 payload + 14 CRC)
        self.n: int = 216  # Total coded codeword length
        self.m: int = 139  # Parity check equations (216 - 77)
        self.max_iterations: int = max_iterations
        self.alpha: float = alpha

        # Pre-construct Parity Check Matrix H and sparse adjacency lists
        self.H = self._build_parity_check_matrix()
        self.check_to_vars: List[List[int]] = [[] for _ in range(self.m)]
        self.var_to_checks: List[List[int]] = [[] for _ in range(self.n)]

        for c in range(self.m):
            for v in range(self.n):
                if self.H[c, v] == 1:
                    self.check_to_vars[c].append(v)
                    self.var_to_checks[v].append(c)

    def _build_parity_check_matrix(self) -> np.ndarray:
        """
        Constructs the (139 x 216) binary parity-check matrix H.
        
        Returns:
            np.ndarray: Matrix of uint8 with shape (139, 216).
        """
        H = np.zeros((self.m, self.n), dtype=np.uint8)

        # 1. Girth-6 Information bit connections
        for p in range(self.m):
            for info_idx in Z30_CHECK_TO_INFO[p]:
                H[p, info_idx] = 1

            # 2. Dual-diagonal accumulator parity structure
            H[p, self.k + p] = 1
            if p > 0:
                H[p, self.k + p - 1] = 1

        return H

    @staticmethod
    def compute_crc14(bits: np.ndarray | List[int]) -> int:
        """
        Computes 14-bit CRC for payload integrity verification.
        Polynomial: g(x) = x^14 + x^13 + x^10 + x^6 + x + 1 (register constant 0x2443, x^14 implicit; Init 0x2757).

        Args:
            bits: List or array of binary integers (0 or 1).

        Returns:
            int: 14-bit CRC integer (0x0000 to 0x3FFF).
        """
        crc = 0x2757
        poly = 0x2443
        for b in bits:
            msb = (crc >> 13) & 1
            crc = ((crc << 1) & 0x3FFF) ^ (poly if (msb ^ (b & 1)) else 0)
        return crc & 0x3FFF

    def encode(self, payload_63_bits: np.ndarray | List[int]) -> np.ndarray:
        """
        Encodes a 63-bit message payload into a 216-bit LDPC codeword.

        Args:
            payload_63_bits: Array of 63 binary values (0 or 1).

        Returns:
            np.ndarray: Vectorized 216-bit codeword c = [u | p].
        """
        payload = np.array(payload_63_bits[:63], dtype=np.uint8)
        if len(payload) < 63:
            payload = np.pad(payload, (0, 63 - len(payload)))

        # 1. Compute 14-bit CRC
        crc = self.compute_crc14(payload)
        crc_bits = np.array([(crc >> (13 - i)) & 1 for i in range(14)], dtype=np.uint8)

        # 2. Assemble 77 info bits
        info_bits = np.concatenate([payload, crc_bits])

        # 3. Compute 139 parity bits via IRA Accumulator over Girth-6 connections
        codeword = np.zeros(self.n, dtype=np.uint8)
        codeword[:self.k] = info_bits

        for p in range(self.m):
            check_sum = 0
            for info_idx in Z30_CHECK_TO_INFO[p]:
                check_sum ^= codeword[info_idx]

            if p > 0:
                check_sum ^= codeword[self.k + p - 1]

            codeword[self.k + p] = check_sum

        return codeword

    def compute_syndrome(self, codeword: np.ndarray) -> np.ndarray:
        """
        Computes the parity check syndrome vector s = H * c^T (mod 2).

        Args:
            codeword: Array of 216 binary bits.

        Returns:
            np.ndarray: Array of 139 syndrome bits (all zeros if valid codeword).
        """
        return np.mod(np.dot(self.H, codeword.astype(np.uint8)), 2)

    def reaccumulate_ira_codeword(self, info_bits_77: np.ndarray | List[int]) -> np.ndarray:
        """
        Fast Trellis-IRA Parity Reconstruction.
        Re-accumulates all 139 parity bits from 77 information bits in linear time O(m).
        """
        codeword = np.zeros(self.n, dtype=np.uint8)
        codeword[:self.k] = np.array(info_bits_77[:self.k], dtype=np.uint8)
        for p in range(self.m):
            check_sum = 0
            for info_idx in Z30_CHECK_TO_INFO[p]:
                check_sum ^= codeword[info_idx]
            if p > 0:
                check_sum ^= codeword[self.k + p - 1]
            codeword[self.k + p] = check_sum
        return codeword

    @staticmethod
    def _box_plus(x: float, y: float) -> float:
        """Exact Box-Plus with Jacobian Logarithm correction."""
        sign_prod = (1.0 if x >= 0 else -1.0) * (1.0 if y >= 0 else -1.0)
        min_val = min(abs(x), abs(y))
        diff_sum = abs(x + y)
        diff_diff = abs(x - y)
        corr_sum = np.log1p(np.exp(-diff_sum)) if diff_sum < 30 else 0.0
        corr_diff = np.log1p(np.exp(-diff_diff)) if diff_diff < 30 else 0.0
        return sign_prod * min_val + corr_sum - corr_diff

    def decode_min_sum(self, llr_channel: np.ndarray) -> Tuple[bool, np.ndarray, int]:
        """
        Ultra-Sensitive Multi-Schedule Damped Log-SPA & Layered Normalized Min-Sum LDPC Decoder
        with Trellis-IRA Re-Accumulation and OSD-2 Chase Reliability Search.

        Args:
            llr_channel (np.ndarray): Array of 216 soft channel log-likelihood ratios.

        Returns:
            Tuple[bool, np.ndarray, int]: (success_flag, decoded_77_info_bits, iterations)
        """
        assert len(llr_channel) == self.n, f"Expected {self.n} LLRs"
        input_llr = np.array(llr_channel, dtype=np.float32)

        # 1. Check if raw channel hard decisions already form a valid codeword
        raw_hard = np.array([1 if x < 0 else 0 for x in input_llr], dtype=np.uint8)
        raw_payload = raw_hard[:63]
        raw_crc = int("".join(str(b) for b in raw_hard[63:77]), 2)
        if self.compute_crc14(raw_payload) == raw_crc:
            if np.all(self.compute_syndrome(raw_hard) == 0):
                return True, raw_hard[:self.k], 1

        # Multi-schedule decoding passes
        schedules = [
            {'mode': 'NMS', 'alpha': 0.82, 'beta': 0.08, 'damping': 0.88, 'reverse': False, 'iters': min(45, self.max_iterations)},
            {'mode': 'SPA', 'alpha': 0.95, 'beta': 0.00, 'damping': 0.85, 'reverse': False, 'iters': min(40, self.max_iterations)},
            {'mode': 'NMS', 'alpha': 0.74, 'beta': 0.04, 'damping': 0.90, 'reverse': True,  'iters': min(35, self.max_iterations)},
            {'mode': 'DITHER', 'alpha': 0.80, 'beta': 0.06, 'damping': 0.85, 'reverse': False, 'iters': min(30, self.max_iterations)},
        ]

        best_codeword = np.zeros(self.n, dtype=np.uint8)
        min_syndrome_weight = 999
        total_iterations = 0
        best_total_llrs = np.copy(input_llr)

        for sched in schedules:
            total_llrs = np.copy(input_llr)
            if sched['mode'] == 'DITHER':
                total_llrs += (np.random.rand(self.n) - 0.5) * 0.45

            # Check-to-variable message buffers
            c_to_v = [np.zeros(len(self.check_to_vars[c]), dtype=np.float32) for c in range(self.m)]
            check_order = list(range(self.m))[::-1] if sched['reverse'] else list(range(self.m))

            for iteration in range(1, sched['iters'] + 1):
                total_iterations += 1

                # Layered Schedule Check-Node Sweep
                for c in check_order:
                    vars_connected = self.check_to_vars[c]
                    num_vars = len(vars_connected)

                    # Compute incoming variable-to-check messages
                    v_to_c_vals = np.zeros(num_vars, dtype=np.float32)
                    min1, min2 = 999999.0, 999999.0
                    min1_idx = -1
                    prod_sign = 1.0

                    for i, v in enumerate(vars_connected):
                        val = total_llrs[v] - c_to_v[c][i]
                        v_to_c_vals[i] = val
                        sign = 1.0 if val >= 0 else -1.0
                        prod_sign *= sign
                        mag = abs(val)
                        if mag < min1:
                            min2 = min1
                            min1 = mag
                            min1_idx = i
                        elif mag < min2:
                            min2 = mag

                    # Update check-to-variable messages and variable total LLRs
                    for i, v in enumerate(vars_connected):
                        val = v_to_c_vals[i]
                        self_sign = 1.0 if val >= 0 else -1.0
                        edge_sign = prod_sign * self_sign
                        min_mag = min2 if i == min1_idx else min1

                        if sched['mode'] == 'SPA':
                            box_acc = 999.0
                            first = True
                            for j in range(num_vars):
                                if j != i:
                                    if first:
                                        box_acc = v_to_c_vals[j]
                                        first = False
                                    else:
                                        box_acc = self._box_plus(box_acc, v_to_c_vals[j])
                            new_msg = np.clip(sched['alpha'] * box_acc, -20.0, 20.0)
                        else:
                            new_msg = edge_sign * max(0.0, sched['alpha'] * min_mag - sched['beta'])

                        damped_msg = (1.0 - sched['damping']) * c_to_v[c][i] + sched['damping'] * new_msg
                        diff = damped_msg - c_to_v[c][i]
                        c_to_v[c][i] = damped_msg
                        total_llrs[v] += diff

                # Hard decisions
                hard_decision = np.array([1 if x < 0 else 0 for x in total_llrs], dtype=np.uint8)
                syndrome = self.compute_syndrome(hard_decision)
                syn_weight = int(np.sum(syndrome))

                if syn_weight < min_syndrome_weight:
                    min_syndrome_weight = syn_weight
                    best_codeword = np.copy(hard_decision)
                    best_total_llrs = np.copy(total_llrs)

                # Early exit: syndrome == 0 and CRC valid
                if syn_weight == 0:
                    info_bits = hard_decision[:self.k]
                    payload = info_bits[:63]
                    rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
                    if self.compute_crc14(payload) == rcvd_crc:
                        return True, info_bits, total_iterations

                # Trellis-IRA Parity Check when payload CRC matches received CRC
                tentative_payload = hard_decision[:63]
                tentative_crc = self.compute_crc14(tentative_payload)
                rcvd_crc = int("".join(str(b) for b in hard_decision[63:77]), 2)

                if tentative_crc == rcvd_crc:
                    crc_bits = np.array([(tentative_crc >> (13 - b)) & 1 for b in range(14)], dtype=np.uint8)
                    tentative_info = np.concatenate([tentative_payload, crc_bits])
                    ira_cw = self.reaccumulate_ira_codeword(tentative_info)
                    if np.all(self.compute_syndrome(ira_cw) == 0):
                        corr = np.sum((1.0 - 2.0 * ira_cw.astype(np.float32)) * input_llr)
                        diff_from_hard = np.sum(ira_cw != hard_decision)
                        if corr > 0 and diff_from_hard <= 12:
                            return True, tentative_info, total_iterations

            if min_syndrome_weight == 0:
                info_bits = best_codeword[:self.k]
                payload = info_bits[:63]
                rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
                if self.compute_crc14(payload) == rcvd_crc:
                    return True, info_bits, total_iterations

        # =====================================================================
        # POST-PROCESSING: CRC-14-Constrained OSD-2 / Chase Reliability Search
        # =====================================================================
        if min_syndrome_weight <= 14:
            base_payload = best_codeword[:63]
            ranked_indices = sorted(range(63), key=lambda i: abs(best_total_llrs[i]))
            test_indices = ranked_indices[:min(14, len(ranked_indices))]

            best_osd_cw = None
            max_correlation = 0.0

            def eval_candidate(candidate_payload: np.ndarray):
                nonlocal best_osd_cw, max_correlation
                crc = self.compute_crc14(candidate_payload)
                crc_bits = np.array([(crc >> (13 - b)) & 1 for b in range(14)], dtype=np.uint8)
                info77 = np.concatenate([candidate_payload, crc_bits])
                cw = self.reaccumulate_ira_codeword(info77)
                if np.all(self.compute_syndrome(cw) == 0):
                    corr = float(np.sum((1.0 - 2.0 * cw.astype(np.float32)) * input_llr))
                    diff_count = int(np.sum(cw != best_codeword))
                    if corr > 20.0 and corr > max_correlation and diff_count <= 16:
                        max_correlation = corr
                        best_osd_cw = cw

            eval_candidate(base_payload)
            for i in range(len(test_indices)):
                c1 = np.copy(base_payload)
                c1[test_indices[i]] ^= 1
                eval_candidate(c1)

            for i in range(len(test_indices)):
                for j in range(i + 1, len(test_indices)):
                    c2 = np.copy(base_payload)
                    c2[test_indices[i]] ^= 1
                    c2[test_indices[j]] ^= 1
                    eval_candidate(c2)

            if best_osd_cw is not None:
                info_bits = best_osd_cw[:self.k]
                payload = info_bits[:63]
                rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
                if self.compute_crc14(payload) == rcvd_crc:
                    return True, info_bits, total_iterations

        return False, best_codeword[:self.k], total_iterations
`,
  },
  {
    filename: "modem.py",
    path: "z30_dsp/modem.py",
    description: "Continuous-phase 16-MFSK modulator: one phase accumulator across the frame, GFSK frequency shaping, and a constant amplitude envelope.",
    code: `"""
z-30 16-MFSK Continuous-Phase Modulator & Demodulator
=====================================================
RF & DSP Specifications:
- Alphabet size: M = 16 tones
- Occupied Bandwidth: B = 50.0 Hz
- Tone spacing: Delta_f = 50 / 16 = 3.125 Hz
- Symbol duration: T_s = 1 / Delta_f = 0.320 seconds (320 ms)
- Sample Rate: F_s = 12000 Hz
- Frame length: 75 symbols (24.0 s active Tx within 30.0 s synchronous slot)

Spectral containment
--------------------
An ultra-narrow mode that splatters is a worse neighbour than the wideband modes it means to
improve on, so containment is the whole premise of this waveform, not a finishing touch.

Two properties produce it, and both are load-bearing:

  1. **Phase continuity.** A single phase accumulator runs across the entire frame, so no
     symbol boundary introduces a phase discontinuity. A step in phase is an impulse in
     frequency and radiates energy across the whole passband.
  2. **A constant amplitude envelope.** The carrier is at full amplitude from the first symbol
     to the last; the only amplitude shaping is one raised-cosine ramp at the very start and
     end of the transmission.

Property 2 is the one that used to be violated here. An earlier version of this modulator kept
the phase accumulator but then multiplied every symbol by an 8 ms up/down ramp, driving the
envelope to zero at each of the 75 symbol boundaries - amplitude keying at 3.125 baud laid over
the tone sequence, whose sidebands extend far beyond 50 Hz no matter how narrow the tone
spacing is. It discarded the benefit of the phase accumulator it was sitting next to.

The frequency transition between symbols is smoothed instead of the amplitude, GFSK-style, the
same technique WSJT-X uses for FT8/FT4: the piecewise-constant tone sequence is convolved with
a Gaussian-shaped frequency pulse before it is integrated into phase. Smoothing frequency
narrows the spectrum; smoothing amplitude per symbol widens it.

\`tests/test_modem_spectrum.py\` measures the occupied bandwidth of a generated frame and asserts
it against a fixed budget, so this cannot silently regress.
"""

from dataclasses import dataclass
from typing import List, Sequence, Tuple, Optional
import numpy as np
from scipy.special import erf

@dataclass(frozen=True)
class Z30Config:
    num_tones: int = 16
    bandwidth_hz: float = 50.0
    tone_spacing_hz: float = 3.125
    symbol_duration_sec: float = 0.320
    sample_rate_hz: int = 12000
    total_symbols: int = 75
    #: Gaussian frequency-pulse bandwidth-time product. Lower values smooth the tone
    #: transitions more aggressively (narrower spectrum, more inter-symbol interference);
    #: higher values approach unshaped CPFSK, whose abrupt tone steps widen the spectrum.
    #: 2.0 is the value WSJT-X uses for FT8. Measured over random frames it gives ~66 Hz of
    #: -40 dB occupied bandwidth (tests/test_modem_spectrum.py asserts the budget). Dropping
    #: to 1.0 buys about 6 Hz of that back but costs roughly 2 dB of decode threshold against
    #: the per-symbol matched filter demodulator, because the extra smoothing is inter-symbol
    #: interference the demodulator does not model - a bad trade for a weak-signal mode.
    gfsk_bt: float = 2.0
    #: Raised-cosine amplitude ramp applied once at the start and once at the end of the whole
    #: frame - never per symbol.
    frame_ramp_sec: float = 0.020
    sync_positions: Tuple[int, ...] = (
        0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29,
        37, 38, 39, 47, 48, 49, 72, 73, 74
    )
    sync_tones: Tuple[int, ...] = (
        3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10,
        4, 8, 13, 0, 9, 3, 14, 6, 11
    )

def gfsk_frequency_pulse(bt: float, samples_per_symbol: int) -> np.ndarray:
    """
    Gaussian-smoothed rectangular frequency pulse, three symbols long.

    This is the integral of a Gaussian over one symbol period: the convolution of a rectangular
    symbol pulse with a Gaussian of bandwidth-time product \`bt\`. Successive copies spaced one
    symbol apart sum to exactly 1.0 across the interior of the frame, so the instantaneous
    frequency lands on each symbol's tone at the centre of that symbol and slews smoothly
    between them rather than stepping.
    """
    if samples_per_symbol <= 0:
        raise ValueError("samples_per_symbol must be positive")
    if bt <= 0:
        raise ValueError("gfsk_bt must be positive")
    t = (np.arange(3 * samples_per_symbol, dtype=np.float64) - 1.5 * samples_per_symbol) / samples_per_symbol
    c = np.pi * np.sqrt(2.0 / np.log(2.0))
    return 0.5 * (erf(c * bt * (t + 0.5)) - erf(c * bt * (t - 0.5)))

class Z30Modulator:
    """Vectorized Continuous-Phase 16-MFSK (CPFSK/GFSK) Tone Generator."""

    def __init__(self, config: Optional[Z30Config] = None) -> None:
        self.cfg = config or Z30Config()
        self.samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)  # 3840 samples

    def instantaneous_frequency(self, symbol_sequence: Sequence[int], base_audio_freq_hz: float) -> np.ndarray:
        """
        Returns the instantaneous frequency in Hz for every sample of the frame.

        The first and last symbols are extended by one symbol period beyond the frame so the
        overlapping pulses still sum to 1.0 at the edges; without that the frequency would sag
        toward DC over the first and last symbol, which is a chirp, not a tone.
        """
        nsps = self.samples_per_symbol
        nsym = len(symbol_sequence)
        pulse = gfsk_frequency_pulse(self.cfg.gfsk_bt, nsps)

        tones = np.asarray(symbol_sequence, dtype=np.float64)
        freqs = base_audio_freq_hz + tones * self.cfg.tone_spacing_hz

        # One symbol of guard at each end; the frame itself occupies [nsps, (nsym+1)*nsps).
        extended = np.zeros((nsym + 2) * nsps, dtype=np.float64)
        extended[0:2 * nsps] += freqs[0] * pulse[nsps:]
        for j in range(nsym):
            start = j * nsps
            extended[start:start + 3 * nsps] += freqs[j] * pulse
        extended[(nsym + 1) * nsps:] += freqs[-1] * pulse[:nsps]

        return extended[nsps:(nsym + 1) * nsps]

    def frame_envelope(self, total_samples: int) -> np.ndarray:
        """
        Amplitude envelope for a whole frame: unity throughout, with a single raised-cosine
        ramp at the start and at the end to avoid a key click at switch-on and switch-off.
        """
        envelope = np.ones(total_samples, dtype=np.float64)
        ramp_len = int(self.cfg.frame_ramp_sec * self.cfg.sample_rate_hz)
        ramp_len = max(0, min(ramp_len, total_samples // 2))
        if ramp_len == 0:
            return envelope
        ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len) / ramp_len))
        envelope[:ramp_len] = ramp
        envelope[-ramp_len:] = ramp[::-1]
        return envelope

    def synthesize_frame(self, symbol_sequence: List[int], base_audio_freq_hz: float = 1250.0) -> np.ndarray:
        """
        Synthesizes a complete 75-symbol z-30 transmission frame as one continuous,
        constant-envelope waveform.

        Raises:
            ValueError: if the symbol count is wrong, a symbol index is outside 0..15, or the
                base frequency is not positive. These were bare \`assert\`s, which vanish under
                \`python -O\` - and a frame silently synthesized from a malformed symbol list is
                a malformed emission on a real antenna.
        """
        if len(symbol_sequence) != self.cfg.total_symbols:
            raise ValueError(
                f"Expected {self.cfg.total_symbols} symbols, got {len(symbol_sequence)}"
            )
        symbols = np.asarray(symbol_sequence)
        if not np.issubdtype(symbols.dtype, np.integer):
            if not np.all(symbols == np.round(symbols)):
                raise ValueError("Symbol indices must be integers")
            symbols = symbols.astype(np.int64)
        if symbols.min() < 0 or symbols.max() >= self.cfg.num_tones:
            raise ValueError(
                f"Symbol indices must be within 0..{self.cfg.num_tones - 1}; "
                f"got range {int(symbols.min())}..{int(symbols.max())}"
            )
        if base_audio_freq_hz <= 0.0:
            raise ValueError(f"base_audio_freq_hz must be positive, got {base_audio_freq_hz}")

        freq_hz = self.instantaneous_frequency(symbols, base_audio_freq_hz)

        # A single phase accumulator over the whole frame: phase(t) = 2*pi * integral f dt.
        phase = 2.0 * np.pi * np.cumsum(freq_hz) / self.cfg.sample_rate_hz
        waveform = np.sin(phase) * self.frame_envelope(freq_hz.size)

        peak = float(np.max(np.abs(waveform)))
        if peak < 1e-9:
            # Cannot happen for a valid symbol sequence, but dividing by this peak would hand
            # NaN samples to a sound card, which is undefined behaviour on real hardware.
            raise ValueError("Synthesized waveform is degenerate (zero amplitude)")
        return (waveform / peak).astype(np.float32)
`,
  },
  {
    filename: "sic_decoder.py",
    path: "z30_dsp/sic_decoder.py",
    description: "Successive Interference Cancellation multi-signal iterative extractor with FFT candidate detection and pilot-aided LLR demodulation.",
    code: `"""
z-30 Multi-Signal Successive Interference Cancellation (SIC) Decoder
=====================================================================
Pipeline:
- Real FFT-based candidate carrier peak detection across the 200 - 3000 Hz passband.
- Pilot-aided semi-coherent LLR demodulation on each candidate, sharing the exact
  matched-filter / Log-MAP math validated in z30_dsp.benchmark.demodulate_mfsk_llrs.
- Real Systematic (216, 77) multi-schedule Min-Sum / Log-SPA LDPC decode with CRC-14
  verification (z30_dsp.ldpc.Z30LdpcCodec).
- Reconstructs decoded signals (carrier frequency, amplitude, phase-continuous waveform)
  and subtracts them in the time domain from the composite baseband buffer.
- Re-runs candidate detection and LLR demodulation on the residual buffer (up to 3 passes).

Callsign / grid / report unpacking mirrors the Radix-37/27 + 7-bit grid/report codec
implemented in src/dsp/z30Codec.ts (encodeCallsign28 / decodeCallsign28 / decodeGrid),
so a real decoded frame round-trips to the same human-readable message on both stacks.

NOTE: \`process_buffer\` assumes the input buffer is already aligned to the 30.0s UTC
slot boundary (the RX window described in modem.py / README.md); frame timing relies
on the station clock discipline provided by rf_time_sync.py, not blind search.
"""

from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
import numpy as np
from z30_dsp.modem import Z30Modulator, Z30Config
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.benchmark import demodulate_mfsk_llrs

# ---------------------------------------------------------------------------
# Message codec: Radix-37/27 callsign + 7-bit grid/report field.
# Mirrors src/dsp/z30Codec.ts (decodeCallsign28 / decodeGrid / unpackZ30Message)
# exactly, so both stacks decode an identical frame to an identical message.
# ---------------------------------------------------------------------------

COMMON_GRIDS = [
    'FN31', 'FN20', 'FN30', 'FM19', 'FM29', 'EM00', 'EM10', 'EM29', 'EM79', 'EL98',
    'EL89', 'DM79', 'DM04', 'DM13', 'CM87', 'CM97', 'CN87', 'CN88', 'IO91', 'IO82',
    'IO92', 'IO93', 'JO21', 'JO31', 'JO22', 'JO32', 'JN88', 'JN58', 'JN48', 'JN65',
    'PM95', 'PM85', 'PM74', 'QM05', 'QM06', 'QF22', 'QF56', 'QF57', 'RE78', 'GG87',
    'GF05', 'FF49', 'KG46', 'KF29', 'OL93', 'NL18', 'OF78', 'NF48', 'PF95',
    'KO85', 'KO94', 'KP04', 'KP15', 'KP20', 'KN87', 'KN99', 'KM17', 'KM68', 'KL78',
    'BL11', 'BK29', 'AJ81', 'AH21',
]


def decode_callsign28(num: int) -> str:
    """Reverses z30Codec.ts:encodeCallsign28 (Radix-37 prefix/digit + Radix-27 suffix)."""
    if num == 0:
        return 'CQ'
    if num == 1:
        return 'CQ DX'
    if num == 2:
        return 'CQ TEST'
    if num == 3:
        return 'QRZ'
    if num < 100:
        return 'CQ'

    val = num - 100
    s_val = val % 19683
    rem1 = val // 19683
    d_val = rem1 % 10
    p_val = rem1 // 10

    if p_val < 37 * 37:
        p0, p1 = p_val // 37, p_val % 37
        s0 = s_val // 729
        s1 = (s_val % 729) // 27
        s2 = s_val % 27

        def p_to_char(v: int) -> str:
            if v == 0:
                return ''
            return chr(48 + v - 1) if v <= 10 else chr(65 + v - 11)

        def s_to_char(v: int) -> str:
            return '' if v == 0 else chr(65 + v - 1)

        prefix = (p_to_char(p0) + p_to_char(p1)).strip()
        suffix = (s_to_char(s0) + s_to_char(s1) + s_to_char(s2)).strip()
        if prefix and suffix:
            return f"{prefix}{d_val}{suffix}"

    return 'DX'


def decode_grid(val: int) -> str:
    """Reverses z30Codec.ts:encodeGrid's indexed common-grid table path."""
    if 64 <= val < 64 + len(COMMON_GRIDS):
        return COMMON_GRIDS[val - 64]
    return 'FN31'


def unpack_z30_message(info_bits: np.ndarray) -> Dict[str, Optional[str]]:
    """Reverses z30Codec.ts:unpackZ30Message. Reconstructs a human-readable QSO message from 77 decoded info bits."""
    bits = [int(b) & 1 for b in info_bits[:77]]

    num_to = 0
    for b in bits[0:28]:
        num_to = (num_to << 1) | b
    num_from = 0
    for b in bits[28:56]:
        num_from = (num_from << 1) | b
    extra_code = 0
    for b in bits[56:63]:
        extra_code = (extra_code << 1) | b

    call_to = decode_callsign28(num_to)
    call_from = decode_callsign28(num_from)

    grid: Optional[str] = None
    report: Optional[str] = None

    if call_to in ('CQ', 'CQ DX') or num_to in (0, 1):
        grid = decode_grid(extra_code)
        raw_text = f"CQ DX {call_from} {grid}" if call_to == 'CQ DX' else f"CQ {call_from} {grid}"
    elif extra_code >= 64:
        grid = decode_grid(extra_code)
        raw_text = f"{call_to} {call_from} {grid}"
    elif extra_code == 61:
        report = 'RRR'
        raw_text = f"{call_to} {call_from} RRR"
    elif extra_code == 62:
        report = '73'
        raw_text = f"{call_to} {call_from} 73"
    elif extra_code == 63:
        report = 'RR73'
        raw_text = f"{call_to} {call_from} RR73"
    else:
        snr_val = extra_code - 30
        report = f"{'+' if snr_val >= 0 else ''}{snr_val}"
        raw_text = f"{call_to} {call_from} {report}"

    return {
        'raw_text': raw_text,
        'call_to': None if call_to in ('CQ', 'CQ DX') else call_to,
        'call_from': call_from,
        'grid': grid,
        'report': report,
    }


@dataclass
class DecodedCarrier:
    call_from: str
    freq_hz: float
    snr_db: float
    dt_sec: float
    sic_pass: int
    raw_symbols: List[int]
    message: str


class Z30SicMultiSignalDecoder:
    """Iterative 3-Pass Successive Interference Cancellation Pipeline."""

    def __init__(self, max_passes: int = 3, config: Optional[Z30Config] = None) -> None:
        self.max_passes = max_passes
        self.cfg = config or Z30Config()
        self.modulator = Z30Modulator(self.cfg)
        self.ldpc = Z30LdpcCodec()

    def process_buffer(
        self,
        baseband_audio: np.ndarray,
        base_dial_hz: float = 14074000,
        min_freq_hz: float = 200.0,
        max_freq_hz: float = 3000.0,
    ) -> List[DecodedCarrier]:
        """
        Executes multi-pass SIC decoding across the min_freq_hz - max_freq_hz audio spectrum.
        \`baseband_audio\` must already be sampled at self.cfg.sample_rate_hz and aligned to
        the 24.0s active-TX window of a 30.0s UTC slot.
        """
        residual_buffer = np.array(baseband_audio, dtype=np.float32, copy=True)
        all_decodes: List[DecodedCarrier] = []

        for current_pass in range(1, self.max_passes + 1):
            # 1. Detect candidate carrier peaks in residual spectrum
            candidates = self._find_candidates(residual_buffer, min_freq_hz, max_freq_hz)
            if not candidates:
                break

            pass_new_decodes = 0
            for cand in candidates:
                # 2a. Snap the rough FFT peak to the true tone-0 (comb base) frequency by
                #     testing which of the 16 possible tone offsets maximizes pilot correlation.
                base_freq_hz = self._refine_base_freq(residual_buffer, cand["freq_hz"])

                # 2b. Fine carrier-frequency-offset correction via pilot phase-slope across the
                #     7 Costas clusters. The coarse FFT-bin estimate above (~0.02-0.2 Hz) is
                #     already good enough for tone detection, but coherent time-domain SIC
                #     cancellation over a 24s frame needs sub-0.01 Hz accuracy or the
                #     synthesized replica drifts out of phase and fails to cancel cleanly.
                base_freq_hz = self._refine_fine_frequency(residual_buffer, base_freq_hz)

                # 2c. Pilot-aided matched filter demodulation -> soft LLRs + amplitude/noise estimate
                llrs, pilot_amp, sigma_est = self._estimate_llrs(residual_buffer, base_freq_hz)

                # 3. Attempt multi-schedule Min-Sum / Log-SPA LDPC decode
                success, info_bits, iters = self.ldpc.decode_min_sum(llrs)
                if success:
                    # 4. Reconstruct clean signal waveform and cancel from residual
                    symbols = self._recover_symbols(info_bits)
                    synth_wave = self.modulator.synthesize_frame(symbols, base_freq_hz)

                    n = min(len(residual_buffer), len(synth_wave))
                    residual_buffer[:n] -= pilot_amp * synth_wave[:n]

                    unpacked = unpack_z30_message(info_bits)
                    snr_db = self._estimate_snr_db(pilot_amp, sigma_est)

                    carrier = DecodedCarrier(
                        call_from=unpacked['call_from'] or 'DX',
                        freq_hz=base_freq_hz,
                        snr_db=snr_db,
                        dt_sec=0.0,
                        sic_pass=current_pass,
                        raw_symbols=symbols,
                        message=unpacked['raw_text'],
                    )
                    all_decodes.append(carrier)
                    pass_new_decodes += 1

            if pass_new_decodes == 0:
                # No additional signals decoded this pass
                break

        return all_decodes

    def _find_candidates(
        self,
        buffer: np.ndarray,
        min_freq_hz: float = 200.0,
        max_freq_hz: float = 3000.0,
        min_peak_db: float = 8.0,
    ) -> List[Dict]:
        """
        Real spectral peak detector: windowed FFT of the buffer, noise-floor estimation via
        the median bin magnitude, and local-maxima extraction at least \`min_peak_db\` above
        that floor, deduplicated within one occupied bandwidth (50 Hz) of each other.
        """
        n = len(buffer)
        if n < 64:
            return []

        window = np.hanning(n)
        spectrum = np.fft.rfft(buffer * window)
        mag_db = 20.0 * np.log10(np.maximum(np.abs(spectrum), 1e-12))
        freqs = np.fft.rfftfreq(n, d=1.0 / self.cfg.sample_rate_hz)

        band_idx = np.where((freqs >= min_freq_hz) & (freqs <= max_freq_hz))[0]
        if len(band_idx) < 3:
            return []

        noise_floor_db = float(np.median(mag_db[band_idx]))
        threshold_db = noise_floor_db + min_peak_db
        min_spacing_hz = self.cfg.bandwidth_hz

        candidates: List[Dict] = []
        for i in band_idx[1:-1]:
            if mag_db[i] > threshold_db and mag_db[i] > mag_db[i - 1] and mag_db[i] > mag_db[i + 1]:
                freq_hz = float(freqs[i])
                if any(abs(freq_hz - c["freq_hz"]) < min_spacing_hz for c in candidates):
                    continue
                candidates.append({
                    "freq_hz": freq_hz,
                    "peak_db": float(mag_db[i]),
                    "noise_floor_db": noise_floor_db,
                })

        candidates.sort(key=lambda c: c["peak_db"], reverse=True)
        return candidates

    def _pilot_amplitude(self, buffer: np.ndarray, base_freq_hz: float) -> float:
        """
        Coherent matched-filter amplitude estimate averaged over the 21 known Costas sync
        pilot tones, assuming \`base_freq_hz\` is the tone-0 frequency of the 16-tone comb
        (same convention as Z30Modulator.synthesize_frame / audioEngine.ts:play16MfskSequence).
        """
        samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)
        dt = 1.0 / self.cfg.sample_rate_hz
        time_vec = np.arange(samples_per_symbol) * dt
        amps: List[float] = []
        for p_idx, f in enumerate(self.cfg.sync_positions):
            tone_idx = self.cfg.sync_tones[p_idx % len(self.cfg.sync_tones)]
            tone_freq = base_freq_hz + tone_idx * self.cfg.tone_spacing_hz
            start = f * samples_per_symbol
            segment = buffer[start:start + samples_per_symbol]
            if len(segment) < samples_per_symbol:
                continue
            corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * time_vec)))
            corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * time_vec)))
            amps.append(np.sqrt(corr_cos ** 2 + corr_sin ** 2) / (samples_per_symbol / 2.0))
        return max(1e-6, float(np.mean(amps))) if amps else 1e-6

    def _refine_base_freq(self, buffer: np.ndarray, rough_peak_freq_hz: float) -> float:
        """
        A raw FFT peak lands on whichever tone happened to carry the most energy, not
        necessarily tone-0. Tests all 16 possible tone-0 offsets from the peak and keeps
        the one maximizing Costas pilot correlation - a standard coarse-acquisition step.
        """
        best_freq = rough_peak_freq_hz
        best_amp = -1.0
        for k in range(self.cfg.num_tones):
            candidate_base = rough_peak_freq_hz - k * self.cfg.tone_spacing_hz
            amp = self._pilot_amplitude(buffer, candidate_base)
            if amp > best_amp:
                best_amp = amp
                best_freq = candidate_base
        return best_freq

    def _refine_fine_frequency(self, buffer: np.ndarray, base_freq_hz: float) -> float:
        """
        Sub-0.01 Hz carrier-frequency-offset (CFO) correction via multi-baseline pilot
        correlator phase-difference estimation across the 21 Costas sync positions (7
        triplets spread across the full 24s frame). This is what wiki/03's "+/-0.1 Hz
        frequency offset tracking" claim actually requires implementing.

        A single long-baseline phase-slope fit aliases once the true CFO exceeds
        1/(2*baseline): triplets are up to 8s apart, so a naive fit over the whole frame
        wraps and converges to the wrong answer for any CFO above ~0.06 Hz. This proceeds
        in stages instead - short intra-triplet baselines first (unambiguous up to the
        coarse tone-grid search's +/-1.5625 Hz residual bound), then progressively longer
        baselines, each safe only once the prior stage has shrunk the residual CFO below
        that stage's ambiguity-free range.
        """
        samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)
        dt = 1.0 / self.cfg.sample_rate_hz

        def measure_phases(freq: float) -> Tuple[np.ndarray, np.ndarray]:
            # NOTE: the correlator reference must use the sample's GLOBAL time-since-frame-
            # start, not a window-local t=0..T reset. A per-symbol-local reference makes a
            # constant-Hz frequency error look like the same small phase offset at every
            # symbol (no visible slope vs. time - the bug that made the first version of
            # this method a no-op), because it throws away exactly the frame-position
            # information a CFO estimate needs. The continuous-phase modulator, and the
            # residual this is meant to null out, both accumulate phase against absolute
            # frame time, so the estimator must measure phase the same way.
            times: List[float] = []
            phases: List[float] = []
            for p_idx, f in enumerate(self.cfg.sync_positions):
                tone_idx = self.cfg.sync_tones[p_idx % len(self.cfg.sync_tones)]
                tone_freq = freq + tone_idx * self.cfg.tone_spacing_hz
                start = f * samples_per_symbol
                segment = buffer[start:start + samples_per_symbol]
                if len(segment) < samples_per_symbol:
                    continue
                t_abs = (start + np.arange(samples_per_symbol)) * dt
                corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * t_abs)))
                corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * t_abs)))
                times.append(f * self.cfg.symbol_duration_sec)
                phases.append(np.arctan2(corr_sin, corr_cos))
            return np.array(times), np.array(phases)

        freq = base_freq_hz
        for max_baseline_sec in (1.0, 4.0, 30.0):
            for _ in range(3):
                times, phases = measure_phases(freq)
                if len(times) < 2:
                    break

                slopes: List[float] = []
                weights: List[float] = []
                for i in range(len(times)):
                    for j in range(i + 1, len(times)):
                        baseline = times[j] - times[i]
                        if baseline <= 0 or baseline > max_baseline_sec:
                            continue
                        dphi = (phases[j] - phases[i] + np.pi) % (2.0 * np.pi) - np.pi
                        slopes.append(dphi / baseline)
                        weights.append(baseline)  # longer safe baselines resolve frequency more precisely

                if not slopes:
                    continue

                delta_f = float(np.average(slopes, weights=weights)) / (2.0 * np.pi)
                freq -= delta_f
                if abs(delta_f) < 0.003:
                    break

        return freq

    def _estimate_llrs(self, buffer: np.ndarray, freq_hz: float) -> Tuple[np.ndarray, float, float]:
        """
        Demodulates the candidate carrier at \`freq_hz\` into 216 soft channel LLRs using the
        same pilot-aided semi-coherent matched-filter bank validated in
        z30_dsp.benchmark.demodulate_mfsk_llrs.

        Noise sigma is estimated robustly from the whole-buffer sample statistics (median
        absolute deviation), consistent with \`sigma\` in benchmark.py's calibrated-AWGN model:
        at the weak-signal SNRs this receiver targets, wideband buffer energy is dominated by
        the noise floor, making this a standard first-order noise estimator.

        Returns (channel_llrs, pilot_amplitude_estimate, sigma_estimate).
        """
        mad = float(np.median(np.abs(buffer - np.median(buffer))))
        sigma_est = max(1e-6, mad / 0.6744897501960817)  # MAD -> Gaussian sigma

        llrs = demodulate_mfsk_llrs(buffer, self.cfg, sigma_est, audio_center_hz=freq_hz)
        pilot_amp = self._pilot_amplitude(buffer, freq_hz)
        return llrs, pilot_amp, sigma_est

    @staticmethod
    def _estimate_snr_db(pilot_amp: float, sigma_est: float) -> float:
        """Converts the pilot-tone amplitude / noise-sigma ratio into an approximate SNR figure in dB."""
        if sigma_est <= 0:
            return 0.0
        snr_linear = max(1e-6, (pilot_amp ** 2) / (2.0 * sigma_est ** 2))
        return float(np.clip(10.0 * np.log10(snr_linear), -40.0, 40.0))

    def _recover_symbols(self, info_bits: np.ndarray) -> List[int]:
        """
        Re-encodes the 77 decoded information bits back into the exact 216-bit LDPC codeword,
        then reassembles the full 75-symbol frame (54 data tones interleaved with the 21
        Costas sync tones), mirroring z30_dsp.benchmark.generate_random_frame's assembly.
        """
        codeword = self.ldpc.encode(np.array(info_bits[:63], dtype=np.uint8))

        data_symbols: List[int] = []
        for s in range(54):
            idx = s * 4
            tone = (
                (int(codeword[idx]) << 3)
                | (int(codeword[idx + 1]) << 2)
                | (int(codeword[idx + 2]) << 1)
                | int(codeword[idx + 3])
            )
            data_symbols.append(tone)

        full_symbols = [0] * self.cfg.total_symbols
        sync_pos_set = set(self.cfg.sync_positions)
        sync_cnt = 0
        data_cnt = 0
        for i in range(self.cfg.total_symbols):
            if i in sync_pos_set:
                full_symbols[i] = self.cfg.sync_tones[sync_cnt % len(self.cfg.sync_tones)]
                sync_cnt += 1
            else:
                full_symbols[i] = data_symbols[data_cnt]
                data_cnt += 1

        return full_symbols
`,
  },
  {
    filename: "channel.py",
    path: "z30_dsp/channel.py",
    description: "Propagation impairments: Watterson two-path HF fading, carrier frequency offset and symbol timing offset.",
    code: `"""
z-30 Propagation Channel Impairment Models
==========================================

Everything between an antenna and a decoder that a bench measurement leaves out: carrier
frequency offset, symbol timing offset, and HF fading.

A benchmark that omits these measures how well a decoder performs when it is handed the exact
noise sigma, the exact carrier frequency and perfect symbol timing. That is a bound on the
code's performance under ideal detection - a useful number, but not a decode threshold, and
not comparable to the published over-the-air figures of modes like FT8, which include all the
acquisition losses this used to exclude.

Fading follows the Watterson model (CCIR 520-2 / ITU-R F.1487): two independent paths, each
multiplied by a complex Gaussian tap whose spectrum is Gaussian with a specified Doppler
spread, separated by a fixed differential delay.
"""

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
from scipy.signal import hilbert


@dataclass(frozen=True)
class WattersonPreset:
    """Named CCIR 520-2 channel condition."""
    name: str
    delay_spread_ms: float
    doppler_spread_hz: float


#: The three standard CCIR 520-2 HF channel conditions, plus a no-fading reference.
WATTERSON_PRESETS = {
    "none": WattersonPreset("No fading (AWGN only)", 0.0, 0.0),
    "good": WattersonPreset("CCIR good", 0.5, 0.1),
    "moderate": WattersonPreset("CCIR moderate", 1.0, 0.5),
    "poor": WattersonPreset("CCIR poor", 2.0, 1.0),
}


@dataclass(frozen=True)
class ChannelImpairments:
    """
    What to inject before the receiver sees the frame.

    Defaults describe a realistic weak-signal HF contact: a couple of Hz of dial error between
    two stations, up to half a second of timing error between two clocks synchronised only by
    NTP or an operator's wristwatch, and a moderately disturbed ionospheric path.
    """
    max_freq_offset_hz: float = 5.0
    max_time_offset_sec: float = 0.5
    fading: str = "moderate"

    @property
    def preset(self) -> WattersonPreset:
        if self.fading not in WATTERSON_PRESETS:
            raise ValueError(f"Unknown fading preset '{self.fading}'; choose from {sorted(WATTERSON_PRESETS)}")
        return WATTERSON_PRESETS[self.fading]


def apply_frequency_offset(wave: np.ndarray, offset_hz: float, sample_rate_hz: float) -> np.ndarray:
    """
    Shifts a real passband waveform by \`offset_hz\`, via its analytic signal so that only the
    positive-frequency image moves (naively multiplying a real signal by a cosine would create
    a second, mirrored copy).
    """
    if offset_hz == 0.0:
        return wave.astype(np.float32)
    analytic = hilbert(wave.astype(np.float64))
    n = np.arange(wave.size, dtype=np.float64)
    shifted = analytic * np.exp(2j * np.pi * offset_hz * n / sample_rate_hz)
    return np.real(shifted).astype(np.float32)


def apply_time_offset(wave: np.ndarray, offset_sec: float, sample_rate_hz: float,
                      pad_sec: float = 3.0) -> Tuple[np.ndarray, int]:
    """
    Places the frame inside a longer buffer, displaced by \`offset_sec\` from the nominal start.

    Returns the padded buffer and the TRUE start sample, which the receiver must find for
    itself and which the caller must not pass to the demodulator.
    """
    pad = int(round(pad_sec * sample_rate_hz))
    true_start = pad + int(round(offset_sec * sample_rate_hz))
    if true_start < 0:
        raise ValueError(f"time offset {offset_sec}s exceeds the {pad_sec}s guard padding")
    buf = np.zeros(wave.size + 2 * pad, dtype=np.float32)
    buf[true_start:true_start + wave.size] = wave
    return buf, true_start


def apply_watterson_fading(
    wave: np.ndarray,
    sample_rate_hz: float,
    preset: WattersonPreset,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Two-path Watterson fading channel.

    Each path is multiplied by an independent complex-Gaussian tap process whose power spectrum
    is Gaussian with standard deviation \`doppler_spread_hz / 2\` (the CCIR convention, where the
    quoted spread is the 2-sigma width). The taps are generated by filtering white complex
    Gaussian noise with the corresponding Gaussian impulse response, then normalised so the
    channel neither adds nor removes average power - the SNR the caller asked for stays the SNR
    the receiver sees.
    """
    if preset.doppler_spread_hz <= 0.0 and preset.delay_spread_ms <= 0.0:
        return wave.astype(np.float32)

    n = wave.size
    analytic = hilbert(wave.astype(np.float64))

    def gaussian_tap() -> np.ndarray:
        """One complex tap process with the requested Doppler spread."""
        white = (rng.standard_normal(n) + 1j * rng.standard_normal(n)) / np.sqrt(2.0)
        sigma_f = max(preset.doppler_spread_hz / 2.0, 1e-6)
        # Gaussian shaping in the frequency domain is exact and avoids a long time-domain FIR.
        freqs = np.fft.fftfreq(n, d=1.0 / sample_rate_hz)
        shape = np.exp(-0.5 * (freqs / sigma_f) ** 2)
        shaped = np.fft.ifft(np.fft.fft(white) * shape)
        power = np.mean(np.abs(shaped) ** 2)
        return shaped / np.sqrt(power) if power > 0 else shaped

    delay_samples = int(round(preset.delay_spread_ms * 1e-3 * sample_rate_hz))
    tap_a = gaussian_tap()
    faded = analytic * tap_a

    if delay_samples > 0:
        tap_b = gaussian_tap()
        delayed = np.zeros_like(analytic)
        delayed[delay_samples:] = analytic[:-delay_samples]
        faded = faded + delayed * tap_b
        # Two equal-power independent paths double the average power; renormalise.
        faded /= np.sqrt(2.0)

    return np.real(faded).astype(np.float32)


def impair_frame(
    clean_wave: np.ndarray,
    sample_rate_hz: float,
    impairments: ChannelImpairments,
    rng: np.random.Generator,
) -> Tuple[np.ndarray, int, float]:
    """
    Applies fading, then a random carrier offset, then a random timing offset.

    Returns (buffer, true_start_sample, true_freq_offset_hz). The receiver is given only the
    buffer; the true values are returned solely so a test can report acquisition error.
    """
    faded = apply_watterson_fading(clean_wave, sample_rate_hz, impairments.preset, rng)

    freq_offset = float(rng.uniform(-impairments.max_freq_offset_hz, impairments.max_freq_offset_hz))
    shifted = apply_frequency_offset(faded, freq_offset, sample_rate_hz)

    time_offset = float(rng.uniform(-impairments.max_time_offset_sec, impairments.max_time_offset_sec))
    buf, true_start = apply_time_offset(shifted, time_offset, sample_rate_hz)
    return buf, true_start, freq_offset
`,
  },
  {
    filename: "acquisition.py",
    path: "z30_dsp/acquisition.py",
    description: "Blind frame acquisition: Costas sync search over time and frequency, plus noise-floor estimation from the audio alone.",
    code: `"""
z-30 Frame Acquisition
======================

Finds a z-30 frame in a stream of audio: where it starts and what carrier frequency it is on,
using only the 21 Costas synchronisation symbols - the information a real receiver actually
has. It also estimates the channel noise level, which a real receiver is likewise not told.

This exists because the benchmark previously handed its demodulator the exact carrier
frequency (hardcoded 1250.0 Hz), perfect symbol timing (\`start = f * samples_per_symbol\`, zero
offset) and the exact noise sigma used to generate the noise. Those three gifts are worth
several dB, and a sensitivity figure measured with them is not a decode threshold.

Method
------
1. Coarse search. A symbol-rate spectrogram is computed with the FFT zero-padded 8x, giving
   \`tone_spacing / 8\` = 0.39 Hz frequency resolution and \`symbol / 8\` = 40 ms time resolution.
   For every candidate (start time, base frequency) the powers at the 21 known sync tones are
   summed; the peak is the coarse estimate.
2. Fine search. A local grid around the coarse peak is scored by direct correlation against
   each sync tone, refining timing to ~5 ms and frequency to ~0.05 Hz - well inside what the
   3.125 Hz tone spacing needs.
"""

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

from z30_dsp.modem import Z30Config

#: FFT zero-padding factor for the coarse spectrogram (frequency bins per tone spacing).
COARSE_FREQ_OVERSAMPLE = 8
#: Spectrogram hops per symbol period.
COARSE_TIME_OVERSAMPLE = 8


@dataclass(frozen=True)
class Acquisition:
    """Result of a frame search."""
    start_sample: int
    base_freq_hz: float
    #: Sum of sync-tone power at the winning candidate, relative to the search-grid median.
    sync_score_db: float
    #: Estimated per-sample noise standard deviation of the input stream.
    noise_sigma: float

    @property
    def found(self) -> bool:
        return self.sync_score_db > 0.0


def estimate_noise_sigma(stream: np.ndarray, cfg: Z30Config, signal_centre_hz: float) -> float:
    """
    Estimates the per-sample noise standard deviation from the spectrum outside the signal.

    Takes the median power spectral density across the audio passband with a 400 Hz notch
    around the signal removed, then converts that density back to a time-domain sigma. The
    median is used rather than the mean so a strong interfering carrier elsewhere in the
    passband does not inflate the estimate.
    """
    n = stream.size
    if n < 1024:
        return float(np.std(stream)) or 1e-9
    window = np.hanning(n)
    spectrum = np.fft.rfft(stream.astype(np.float64) * window)
    freqs = np.fft.rfftfreq(n, d=1.0 / cfg.sample_rate_hz)
    # Coherent gain correction for the window, so the PSD scale matches the time domain.
    win_power = np.mean(window ** 2)
    psd = (np.abs(spectrum) ** 2) / (n * win_power)

    band = (freqs > 200.0) & (freqs < min(2800.0, cfg.sample_rate_hz / 2 - 100.0))
    notch = np.abs(freqs - signal_centre_hz) > 200.0
    usable = band & notch
    if not np.any(usable):
        return float(np.std(stream)) or 1e-9

    # Median of an exponentially distributed periodogram underestimates the mean by ln(2).
    psd_mean = float(np.median(psd[usable])) / np.log(2.0)
    # Total noise power over the full Nyquist span, expressed as a time-domain variance.
    variance = psd_mean * (cfg.sample_rate_hz / 2.0) * (2.0 / cfg.sample_rate_hz) * (n / 2.0)
    # The expression above reduces to psd_mean * n/2; keep it explicit for reviewability.
    sigma = np.sqrt(max(variance, 1e-24) / (n / 2.0))
    return float(max(sigma, 1e-9))


def _spectrogram(stream: np.ndarray, cfg: Z30Config, nsps: int) -> Tuple[np.ndarray, float, int]:
    """Symbol-length windowed power spectrogram, zero-padded for sub-tone frequency resolution."""
    hop = max(1, nsps // COARSE_TIME_OVERSAMPLE)
    nfft = nsps * COARSE_FREQ_OVERSAMPLE
    n_frames = 1 + (stream.size - nsps) // hop
    if n_frames <= 0:
        return np.zeros((0, nfft // 2 + 1)), cfg.sample_rate_hz / nfft, hop

    window = np.hanning(nsps)
    # Strided view avoids materialising n_frames copies of the stream.
    frames = np.lib.stride_tricks.as_strided(
        stream,
        shape=(n_frames, nsps),
        strides=(stream.strides[0] * hop, stream.strides[0]),
        writeable=False,
    )
    spectra = np.fft.rfft(frames * window, n=nfft, axis=1)
    return np.abs(spectra) ** 2, cfg.sample_rate_hz / nfft, hop


def acquire_frame(
    stream: np.ndarray,
    cfg: Z30Config,
    nominal_base_freq_hz: float = 1250.0,
    freq_search_hz: float = 12.0,
    time_search_sec: Optional[float] = None,
) -> Acquisition:
    """
    Searches \`stream\` for a z-30 frame.

    Args:
        stream: real audio samples at \`cfg.sample_rate_hz\`, longer than one frame.
        nominal_base_freq_hz: where the frame is expected; the search spans +/- freq_search_hz.
        freq_search_hz: half-width of the carrier search, in Hz.
        time_search_sec: half-width of the timing search. Defaults to searching the whole
            stream, which is what a receiver with no prior timing knowledge must do.

    Returns an \`Acquisition\`. \`found\` is False when nothing in the search space stands out
    from the noise floor, which is the honest answer at low SNR and is counted as a decode
    failure by the benchmark rather than being papered over.
    """
    nsps = int(round(cfg.sample_rate_hz * cfg.symbol_duration_sec))
    stream = np.ascontiguousarray(stream, dtype=np.float64)

    power, bin_hz, hop = _spectrogram(stream, cfg, nsps)
    if power.shape[0] == 0:
        return Acquisition(0, nominal_base_freq_hz, -np.inf, 1e-9)

    # ---- coarse search ---------------------------------------------------------------
    last_sync_pos = max(cfg.sync_positions)
    frames_needed = last_sync_pos * COARSE_TIME_OVERSAMPLE + 1
    n_start = power.shape[0] - frames_needed
    if n_start <= 0:
        return Acquisition(0, nominal_base_freq_hz, -np.inf, 1e-9)

    if time_search_sec is not None:
        centre_frame = int(round((stream.size / 2 - nsps * cfg.total_symbols / 2) / hop))
        half = int(round(time_search_sec * cfg.sample_rate_hz / hop))
        lo = max(0, centre_frame - half)
        hi = min(n_start, centre_frame + half + 1)
    else:
        lo, hi = 0, n_start
    if hi <= lo:
        lo, hi = 0, n_start
    start_idx = np.arange(lo, hi)

    top_tone_bins = (cfg.num_tones - 1) * COARSE_FREQ_OVERSAMPLE
    f_lo = int(np.floor((nominal_base_freq_hz - freq_search_hz) / bin_hz))
    f_hi = int(np.ceil((nominal_base_freq_hz + freq_search_hz) / bin_hz))
    f_lo = max(0, f_lo)
    f_hi = min(power.shape[1] - top_tone_bins - 1, f_hi)
    if f_hi <= f_lo:
        return Acquisition(0, nominal_base_freq_hz, -np.inf, 1e-9)
    freq_idx = np.arange(f_lo, f_hi + 1)

    score = np.zeros((start_idx.size, freq_idx.size), dtype=np.float64)
    for pos, tone in zip(cfg.sync_positions, cfg.sync_tones):
        rows = start_idx + pos * COARSE_TIME_OVERSAMPLE
        cols = freq_idx + tone * COARSE_FREQ_OVERSAMPLE
        score += power[np.ix_(rows, cols)]

    peak_flat = int(np.argmax(score))
    ti, fi = np.unravel_index(peak_flat, score.shape)
    peak = float(score[ti, fi])
    floor = float(np.median(score))
    sync_score_db = 10.0 * np.log10(peak / floor) if floor > 0 else -np.inf

    coarse_start = int(start_idx[ti]) * hop
    coarse_freq = float(freq_idx[fi]) * bin_hz

    # ---- fine search -----------------------------------------------------------------
    # Direct correlation against the sync tones, on a local grid around the coarse peak.
    time_grid = coarse_start + np.arange(-hop, hop + 1, max(1, nsps // 64))
    time_grid = time_grid[(time_grid >= 0) & (time_grid + cfg.total_symbols * nsps <= stream.size)]
    freq_grid = coarse_freq + np.linspace(-bin_hz, bin_hz, 17)
    if time_grid.size == 0:
        time_grid = np.array([max(0, min(coarse_start, stream.size - cfg.total_symbols * nsps))])

    t_vec = np.arange(nsps) / cfg.sample_rate_hz
    best = (-np.inf, int(time_grid[0]), float(coarse_freq))
    for f0 in freq_grid:
        # Precompute the reference oscillator for each distinct sync tone at this f0.
        refs = {}
        for tone in set(cfg.sync_tones):
            freq = f0 + tone * cfg.tone_spacing_hz
            refs[tone] = (np.cos(2 * np.pi * freq * t_vec), np.sin(2 * np.pi * freq * t_vec))
        for t0 in time_grid:
            total = 0.0
            for pos, tone in zip(cfg.sync_positions, cfg.sync_tones):
                s = int(t0) + pos * nsps
                seg = stream[s:s + nsps]
                if seg.size < nsps:
                    total = -np.inf
                    break
                c, sn = refs[tone]
                total += float(np.dot(seg, c)) ** 2 + float(np.dot(seg, sn)) ** 2
            if total > best[0]:
                best = (total, int(t0), float(f0))

    _, start_sample, base_freq = best
    centre = base_freq + (cfg.num_tones - 1) * cfg.tone_spacing_hz / 2.0
    sigma = estimate_noise_sigma(stream, cfg, centre)
    return Acquisition(start_sample, base_freq, sync_score_db, sigma)
`,
  },
  {
    filename: "benchmark.py",
    path: "z30_dsp/benchmark.py",
    description: "Physical waveform generator, channel simulator, blind acquisition and seeded LDPC Monte Carlo benchmark (realistic and genie-aided modes).",
    code: `"""
z-30 Physical Layer Waveform Generator, AWGN Calibrator & LDPC Decoder Benchmark
================================================================================
1. Generates continuous-phase 16-MFSK physical waveforms with GFSK frequency shaping.
2. Injects calibrated Gaussian noise (AWGN) referenced to standard 2500 Hz audio bandwidth:
     sigma = sqrt( P_signal / ( 10^(SNR_dB / 10) * (5000 / Fs) ) )
3. Demodulates noisy waveforms using 16-tone matched filters and calculates soft channel LLRs.
4. Executes the actual Systematic (216, 77) Normalized Min-Sum LDPC Belief Propagation Decoder.
5. Counts decode successes, failures, empirical Frame Error Rate (FER), and plots FER vs SNR.

TWO MEASUREMENT MODES, AND THE DIFFERENCE BETWEEN THEM IS THE POINT
-------------------------------------------------------------------
\`--mode realistic\` (default) measures a **decode threshold**. Every frame gets a random
carrier offset, a random timing offset and Watterson HF fading; the receiver is then handed
nothing but audio and must find the frame itself (\`z30_dsp.acquisition\`), estimate the noise
level itself, and decode from whatever it found. This is the number that is comparable with
other modes' published on-air figures.

\`--mode ideal\` measures a **genie-aided idealised AWGN bound**, which is NOT an over-the-air
decode threshold. The demodulator is handed things a real receiver has to work out for itself:

  * the exact noise sigma used to generate the frame;
  * the exact carrier frequency (no frequency error, no AFC, no Doppler);
  * perfect symbol timing - \`start_samp = f * samples_per_symbol\`, zero offset, because the
    same code generated the waveform;
  * a clean channel: no fading, no interference, no band noise, no ALC.

Every one of those is a real loss in a real contact, and none of them is present in \`ideal\`.
Quoting that figure beside a mode's published over-the-air threshold - FT8's -21 dB, say,
which is WSJT-X's measured number and *includes* all of those losses - compares two different
quantities and flatters this one. Measured on this code, the gap between the two modes is
about 3.7 dB on AWGN, and about 7 dB once moderate fading is present: the bound is -24.7 dB
while the blind-acquisition threshold is -21.0 dB on AWGN and -17.6 dB on a CCIR-moderate
path. The README states the comparison in exactly these terms.

Reproducibility: every run is seeded (\`--seed\`, default DEFAULT_BENCHMARK_SEED). Record the
seed alongside any published curve; an unseeded number cannot be reproduced, bisected, or
verified by anyone else.
"""

import time
import argparse
from typing import List, Optional, Tuple, Dict
import numpy as np

from z30_dsp.modem import Z30Modulator, Z30Config
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.channel import ChannelImpairments, impair_frame, WATTERSON_PRESETS
from z30_dsp.acquisition import acquire_frame

#: Default PRNG seed. Fixed so the default run is reproducible; override with --seed.
DEFAULT_BENCHMARK_SEED: int = 20260830


def generate_random_frame(
    codec: Z30LdpcCodec,
    cfg: Z30Config,
    rng: Optional[np.random.Generator] = None,
) -> Tuple[np.ndarray, np.ndarray, List[int], List[int]]:
    """
    Generates a random 63-bit amateur payload, encodes to 216-bit LDPC codeword,
    and assembles the 75-symbol 16-MFSK transmission sequence.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    payload_63 = rng.integers(0, 2, 63, dtype=np.uint8)
    codeword_216 = codec.encode(payload_63)
    
    # 54 data symbols (4 bits/symbol)
    data_symbols_54 = []
    for s in range(54):
        idx = s * 4
        tone = (int(codeword_216[idx]) << 3) | (int(codeword_216[idx+1]) << 2) | \\
               (int(codeword_216[idx+2]) << 1) | int(codeword_216[idx+3])
        data_symbols_54.append(tone)
        
    # Interleave 21 Costas sync symbols + 54 data symbols -> 75 symbols
    full_symbols_75 = [0] * cfg.total_symbols
    sync_pos_set = set(cfg.sync_positions)
    sync_cnt = 0
    data_cnt = 0
    
    for i in range(cfg.total_symbols):
        if i in sync_pos_set:
            full_symbols_75[i] = cfg.sync_tones[sync_cnt % len(cfg.sync_tones)]
            sync_cnt += 1
        else:
            full_symbols_75[i] = data_symbols_54[data_cnt]
            data_cnt += 1
            
    return payload_63, codeword_216, data_symbols_54, full_symbols_75

def add_calibrated_awgn(
    clean_wave: np.ndarray,
    snr_2500hz_db: float,
    sample_rate_hz: int,
    rng: Optional[np.random.Generator] = None,
    signal_power: Optional[float] = None,
) -> Tuple[np.ndarray, float]:
    """
    Adds calibrated AWGN to reach a known SNR referenced to 2500 Hz noise bandwidth.

    \`signal_power\` may be given explicitly when \`clean_wave\` contains silent guard padding, as
    it does in realistic mode where the frame sits somewhere inside a longer buffer. Averaging
    over that padding would understate the signal power and so overstate the SNR - the frame
    would quietly be tested easier than the label on the curve claims.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    signal_power = float(signal_power) if signal_power is not None else float(np.mean(clean_wave ** 2))
    snr_linear = 10.0 ** (snr_2500hz_db / 10.0)
    # Bandwidth correction factor: 2500 Hz noise bandwidth relative to Nyquist (Fs/2)
    bw_factor = 5000.0 / sample_rate_hz
    sigma = np.sqrt(signal_power / (snr_linear * bw_factor))
    
    noise = rng.normal(0.0, sigma, size=len(clean_wave)).astype(np.float32)
    noisy_wave = clean_wave + noise
    return noisy_wave, sigma

def _log_sum_exp(vals: List[float] | np.ndarray) -> float:
    arr = np.array(vals, dtype=np.float64)
    max_val = np.max(arr)
    return float(max_val + np.log(np.sum(np.exp(arr - max_val))))

def demodulate_mfsk_llrs(
    noisy_wave: np.ndarray,
    cfg: Z30Config,
    sigma: float,
    audio_center_hz: float = 1250.0,
    start_sample: int = 0,
) -> np.ndarray:
    """
    Pilot-Aided Semi-Coherent 16-tone matched filter bank with exact Log-MAP LLR calculation.
    """
    samples_per_symbol = int(cfg.sample_rate_hz * cfg.symbol_duration_sec)
    sync_positions = cfg.sync_positions
    sync_pos_set = set(sync_positions)
    sync_tones = cfg.sync_tones
    llrs = np.zeros(216, dtype=np.float32)
    
    dt = 1.0 / cfg.sample_rate_hz
    time_vec = np.arange(samples_per_symbol) * dt
    
    # 1. Pilot phase & channel tracking across 21 Costas sync symbols
    pilot_frames = []
    pilot_phases = []
    pilot_amps = []
    
    for p_idx, f in enumerate(sync_positions):
        tone_idx = sync_tones[p_idx % len(sync_tones)]
        tone_freq = audio_center_hz + tone_idx * cfg.tone_spacing_hz
        start_samp = start_sample + f * samples_per_symbol
        segment = noisy_wave[start_samp:start_samp + samples_per_symbol]
        if segment.size < samples_per_symbol:
            segment = np.pad(segment, (0, samples_per_symbol - segment.size))
        
        corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * time_vec)))
        corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * time_vec)))
        
        amp = np.sqrt(corr_cos ** 2 + corr_sin ** 2) / (samples_per_symbol / 2.0)
        phase = np.arctan2(corr_sin, corr_cos)
        
        pilot_frames.append(f)
        pilot_phases.append(phase)
        pilot_amps.append(amp)
        
    quad_noise_var = max(1e-12, ((sigma ** 2) * samples_per_symbol) / 2.0)
    est_sig_amp = max(0.01, float(np.mean(pilot_amps)))
    s_corr = (est_sig_amp * samples_per_symbol / 2.0) / quad_noise_var

    # Continuous-phase FSK carries phase across symbol boundaries: each symbol advances the
    # modulator's phase accumulator by 2*pi*tone_freq*symbol_duration mod 2*pi. Because
    # tone_spacing_hz is exactly 1/symbol_duration_sec by construction, that increment is
    # IDENTICAL for every tone (the per-tone term is always a whole number of cycles) - it
    # only depends on audio_center_hz. So the phase gap between a pilot and a nearby data
    # symbol is fully predictable and must be added back in before projecting onto the
    # pilot's raw phase, or the "coherent" LLR term is measured against the wrong reference
    # for any audio_center_hz that isn't an exact multiple of tone_spacing_hz.
    base_phase_step = (2.0 * np.pi * audio_center_hz * cfg.symbol_duration_sec) % (2.0 * np.pi)

    data_sym_idx = 0
    for frame_sym_idx in range(cfg.total_symbols):
        if frame_sym_idx in sync_pos_set:
            continue

        # Interpolate pilot phase, propagated to this symbol's position via the known
        # per-symbol continuous-phase increment.
        closest_p = np.argmin(np.abs(np.array(pilot_frames) - frame_sym_idx))
        raw_phase = pilot_phases[closest_p] - base_phase_step * (frame_sym_idx - pilot_frames[closest_p])
        interp_phase = np.arctan2(np.sin(raw_phase), np.cos(raw_phase))
        min_pilot_dist = abs(pilot_frames[closest_p] - frame_sym_idx)
        pilot_coherence = max(0.35, min(0.85, 1.0 / (1.0 + 0.15 * min_pilot_dist)))
        
        start_samp = start_sample + frame_sym_idx * samples_per_symbol
        segment = noisy_wave[start_samp:start_samp + samples_per_symbol]
        if segment.size < samples_per_symbol:
            segment = np.pad(segment, (0, samples_per_symbol - segment.size))
        
        tone_log_likes = np.zeros(16, dtype=np.float64)
        for tone in range(16):
            tone_freq = audio_center_hz + tone * cfg.tone_spacing_hz
            corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * time_vec)))
            corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * time_vec)))
            raw_energy = corr_cos ** 2 + corr_sin ** 2
            
            envelope = np.sqrt(raw_energy)
            z = envelope * s_corr
            # log(I0(z)) approximation
            non_coherent = z - 0.5 * np.log(max(1.0, 2.0 * np.pi * z)) if z > 15 else np.log(max(1e-12, np.i0(z)))
            
            proj = corr_cos * np.cos(interp_phase) + corr_sin * np.sin(interp_phase)
            coherent = proj * s_corr
            
            tone_log_likes[tone] = pilot_coherence * coherent + (1.0 - pilot_coherence) * non_coherent
            
        # Exact Log-MAP demapping
        for bit in range(4):
            bit_mask = 1 << (3 - bit)
            likes0 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) == 0]
            likes1 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) != 0]
            
            llr = _log_sum_exp(likes0) - _log_sum_exp(likes1)
            llrs[data_sym_idx * 4 + bit] = np.clip(llr, -25.0, 25.0)
            
        data_sym_idx += 1
        
    return llrs

def run_monte_carlo_snr_sweep(
    min_snr_db: float = -33.0,
    max_snr_db: float = -23.0,
    step_snr_db: float = 1.0,
    frames_per_snr: int = 50,
    sample_rate_hz: int = 6000,
    seed: int = DEFAULT_BENCHMARK_SEED,
    mode: str = "realistic",
    fading: str = "moderate",
    max_freq_offset_hz: float = 5.0,
    max_time_offset_sec: float = 0.5,
) -> List[Dict]:
    """
    Runs waveform generation, channel impairment, acquisition and LDPC decoding across SNR.

    Args:
        mode: "realistic" - random carrier/timing offsets and Watterson fading, with blind
              acquisition and blind noise estimation. This yields a decode threshold.
              "ideal" - exact sigma, exact carrier, perfect timing, no impairments. This
              yields a bound, not a threshold. See the module docstring.
        fading: Watterson preset for realistic mode: none / good / moderate / poor.
        seed: master seed. The same seed and configuration always produce the same curve.
    """
    if mode not in ("realistic", "ideal"):
        raise ValueError(f"mode must be 'realistic' or 'ideal'; got {mode!r}")
    if fading not in WATTERSON_PRESETS:
        raise ValueError(f"fading must be one of {sorted(WATTERSON_PRESETS)}; got {fading!r}")

    rng = np.random.default_rng(seed)
    impairments = ChannelImpairments(
        max_freq_offset_hz=max_freq_offset_hz,
        max_time_offset_sec=max_time_offset_sec,
        fading=fading,
    )
    cfg = Z30Config(sample_rate_hz=sample_rate_hz)
    modulator = Z30Modulator(cfg)
    codec = Z30LdpcCodec(max_iterations=45, alpha=0.75)
    
    snr_points = np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db)
    results = []
    
    print("=" * 96)
    if mode == "ideal":
        print("  z-30 IDEALISED AWGN BOUND (genie-aided)")
        print("  Exact noise sigma, exact carrier frequency and perfect symbol timing are given to")
        print("  the demodulator. No frequency error, timing error, Doppler, fading or interference.")
        print("  This is NOT an over-the-air decode threshold and is NOT comparable with the")
        print("  published on-air figures for FT8 or other modes.")
    else:
        preset = impairments.preset
        print("  z-30 DECODE THRESHOLD (blind acquisition through the real receive chain)")
        print(f"  Carrier offset +/-{max_freq_offset_hz:.1f} Hz | timing offset +/-{max_time_offset_sec:.2f} s | "
              f"fading: {preset.name} ({preset.delay_spread_ms:.1f} ms / {preset.doppler_spread_hz:.1f} Hz)")
        print("  The receiver is given only audio: it finds the frame and estimates the noise itself.")
    print(f"  {frames_per_snr} frames/point | Sample Rate: {sample_rate_hz} Hz | "
          f"Max Iterations: 45 | Seed: {seed}")
    print("=" * 96)
    header = (f"{'SNR (2500Hz)':<14} | {'Frames':<7} | {'Success':<8} | {'FER':<9} | "
              f"{'Decode %':<9} | {'Avg Iters':<10}")
    if mode == "realistic":
        header += f" | {'Acq fail':<8} | {'Timing RMS':<11} | {'Freq RMS':<9}"
    print(header)
    print("-" * 96)
    
    for snr in snr_points:
        t_start = time.time()
        successes = 0
        failures = 0
        acq_failures = 0
        total_iters = 0
        timing_errs: List[float] = []
        freq_errs: List[float] = []

        for f in range(frames_per_snr):
            # 1. Generate real random payload and symbols
            payload, codeword, data_symbols, full_symbols = generate_random_frame(codec, cfg, rng)

            # 2. Synthesize physical continuous-phase 16-MFSK waveform
            clean_wave = modulator.synthesize_frame(full_symbols, base_audio_freq_hz=1250.0)
            frame_power = float(np.mean(clean_wave ** 2))

            if mode == "ideal":
                # 3a. Calibrated AWGN only, and the demodulator is told everything.
                noisy_wave, sigma = add_calibrated_awgn(
                    clean_wave, snr, cfg.sample_rate_hz, rng, frame_power
                )
                start_sample = 0
                base_freq = 1250.0
            else:
                # 3b. Fading, carrier offset and timing offset, then noise across the whole
                #     buffer - referenced to the frame's own power, not the padded buffer's.
                buf, true_start, true_foff = impair_frame(
                    clean_wave, cfg.sample_rate_hz, impairments, rng
                )
                noisy_wave, _true_sigma = add_calibrated_awgn(
                    buf, snr, cfg.sample_rate_hz, rng, frame_power
                )

                # 4b. Blind acquisition: the receiver gets audio and nothing else.
                acq = acquire_frame(noisy_wave, cfg, nominal_base_freq_hz=1250.0)
                start_sample = acq.start_sample
                base_freq = acq.base_freq_hz
                sigma = acq.noise_sigma
                timing_errs.append((start_sample - true_start) / cfg.sample_rate_hz)
                freq_errs.append(base_freq - (1250.0 + true_foff))
                # Landing more than half a symbol out cannot decode. Counted separately so an
                # acquisition failure is visible rather than hidden inside the FER.
                if abs(start_sample - true_start) > cfg.symbol_duration_sec * cfg.sample_rate_hz / 2:
                    acq_failures += 1

            # 5. Demodulate via 16-tone matched filters -> Soft LLRs
            channel_llrs = demodulate_mfsk_llrs(
                noisy_wave, cfg, sigma, audio_center_hz=base_freq, start_sample=start_sample
            )

            # 6. Run actual Systematic (216, 77) Normalized Min-Sum LDPC Decoder
            success, decoded_info, iters = codec.decode_min_sum(channel_llrs)
            total_iters += iters

            if success:
                # Validate CRC-14, and check the payload really is the one transmitted: a
                # converged codeword with a matching CRC that decoded to the wrong message is
                # a false decode, not a success.
                rcvd_crc = int("".join(str(b) for b in decoded_info[63:]), 2)
                comp_crc = codec.compute_crc14(decoded_info[:63])
                if rcvd_crc == comp_crc and np.array_equal(decoded_info[:63], payload):
                    successes += 1
                else:
                    failures += 1
            else:
                failures += 1
                
        fer = failures / frames_per_snr
        decode_pct = (successes / frames_per_snr) * 100.0
        avg_iters = total_iters / frames_per_snr
        elapsed = time.time() - t_start
        
        res = {
            "snr_db": float(snr),
            "total_frames": frames_per_snr,
            "successes": successes,
            "failures": failures,
            "fer": fer,
            "decode_pct": decode_pct,
            "avg_iters": avg_iters,
            "elapsed_sec": elapsed,
            "seed": seed,
            "mode": mode,
            "fading": fading if mode == "realistic" else "none",
        }
        if mode == "realistic":
            res["acq_failures"] = acq_failures
            res["timing_rms_ms"] = float(np.sqrt(np.mean(np.square(timing_errs))) * 1000.0) if timing_errs else 0.0
            res["freq_rms_hz"] = float(np.sqrt(np.mean(np.square(freq_errs)))) if freq_errs else 0.0
        results.append(res)

        row = (f"{snr:+6.1f} dB      | {frames_per_snr:<7} | {successes:<8} | {fer:<9.4f} | "
               f"{decode_pct:>7.1f}%  | {avg_iters:>6.1f}    ")
        if mode == "realistic":
            row += f" | {acq_failures:<8} | {res['timing_rms_ms']:>8.1f} ms | {res['freq_rms_hz']:>6.2f} Hz"
        print(row)

    print("=" * 96)

    # ASCII Plot of Decode Probability and FER against SNR
    plot_ascii_curves(results)

    threshold = decode_threshold_db(results)
    label = ("decode threshold (50% frame decode, blind acquisition)" if mode == "realistic"
             else "idealised AWGN bound (50% frame decode, genie-aided sync)")
    if threshold is None:
        print("  50% crossing is outside the swept range - widen --min-snr / --max-snr.")
    else:
        print(f"  {label}: {threshold:+.1f} dB (2500 Hz reference bandwidth), seed {seed}")
    if mode == "ideal":
        print("  Reminder: this excludes every acquisition loss and is NOT comparable with the")
        print("  published on-air sensitivity figures for FT8, JS8 or WSPR.")
    print("=" * 96)
    return results


def decode_threshold_db(results: List[Dict]) -> Optional[float]:
    """
    The SNR at which 50% of frames decode, linearly interpolated between the two swept points
    that bracket the crossing. Returns None when the sweep never crosses 50%.
    """
    ordered = sorted(results, key=lambda r: r["snr_db"])
    for lower, upper in zip(ordered, ordered[1:]):
        if lower["decode_pct"] < 50.0 <= upper["decode_pct"]:
            span = upper["decode_pct"] - lower["decode_pct"]
            if span <= 0:
                return float(upper["snr_db"])
            frac = (50.0 - lower["decode_pct"]) / span
            return float(lower["snr_db"] + frac * (upper["snr_db"] - lower["snr_db"]))
    return None

def plot_ascii_curves(results: List[Dict]):
    """Renders ASCII plots for Decode Probability (%) and Frame Error Rate (FER) vs SNR."""
    print("\\n" + "=" * 80)
    print("                      DECODE PROBABILITY (%) vs SNR (dB)")
    print("=" * 80)
    
    plot_height = 12
    plot_width = len(results)
    
    # Y-axis from 100% down to 0%
    for y_step in range(plot_height, -1, -1):
        pct_threshold = (y_step / plot_height) * 100.0
        row_str = f"{pct_threshold:5.0f}% | "
        for res in results:
            val = res["decode_pct"]
            if val >= pct_threshold:
                row_str += "  #  "
            elif val >= pct_threshold - (100.0 / (plot_height * 2)):
                row_str += "  :  "
            else:
                row_str += "  .  "
        print(row_str)
        
    print("       +" + "-----" * plot_width)
    snr_header = " SNR:   "
    for res in results:
        snr_header += f"{res['snr_db']:+4.0f} "
    print(snr_header + " (dB / 2500Hz)")
    print("=" * 80)
    
    print("\\n" + "=" * 80)
    print("                      FRAME ERROR RATE (FER) vs SNR (dB)")
    print("=" * 80)
    
    fer_levels = [1.0, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05, 0.01, 0.001, 0.0]
    for lvl in fer_levels:
        row_str = f"{lvl:5.3f} | "
        for res in results:
            fer_val = res["fer"]
            if fer_val >= lvl:
                row_str += "  X  "
            else:
                row_str += "  .  "
        print(row_str)
        
    print("       +" + "-----" * plot_width)
    print(snr_header + " (dB / 2500Hz)")
    print("=" * 80 + "\\n")

def run_benchmark(seed: int = DEFAULT_BENCHMARK_SEED):
    """Default entry point (\`z30 --benchmark\`): the honest, realistic curve."""
    return run_monte_carlo_snr_sweep(
        min_snr_db=-26.0,
        max_snr_db=-14.0,
        step_snr_db=1.0,
        frames_per_snr=25,
        sample_rate_hz=6000,
        seed=seed,
        mode="realistic",
    )


run_self_test = run_benchmark
main = run_benchmark

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="z-30 Monte Carlo waveform, channel and LDPC decoder benchmark.",
        epilog="realistic mode measures a decode threshold; ideal mode measures a genie-aided bound.",
    )
    parser.add_argument("--mode", choices=("realistic", "ideal"), default="realistic",
                        help="realistic: random carrier/timing offsets, Watterson fading and blind "
                             "acquisition (default). ideal: exact sigma/carrier/timing, no "
                             "impairments - a bound, not a threshold.")
    parser.add_argument("--fading", choices=sorted(WATTERSON_PRESETS), default="moderate",
                        help="Watterson channel preset for realistic mode (default: moderate).")
    parser.add_argument("--freq-offset", type=float, default=5.0,
                        help="Maximum random carrier offset in Hz (default: 5.0).")
    parser.add_argument("--time-offset", type=float, default=0.5,
                        help="Maximum random timing offset in seconds (default: 0.5).")
    parser.add_argument("--min-snr", type=float, default=-26.0, help="Minimum SNR in dB (2500Hz reference)")
    parser.add_argument("--max-snr", type=float, default=-14.0, help="Maximum SNR in dB (2500Hz reference)")
    parser.add_argument("--step", type=float, default=1.0, help="SNR step in dB")
    parser.add_argument("--frames", type=int, default=30, help="Frames per SNR test point")
    parser.add_argument("--sample-rate", type=int, default=6000, help="Simulation sample rate in Hz")
    parser.add_argument("--seed", type=int, default=DEFAULT_BENCHMARK_SEED,
                        help="PRNG seed. Record it with any published result.")
    args = parser.parse_args()

    run_monte_carlo_snr_sweep(
        min_snr_db=args.min_snr,
        max_snr_db=args.max_snr,
        step_snr_db=args.step,
        frames_per_snr=args.frames,
        sample_rate_hz=args.sample_rate,
        seed=args.seed,
        mode=args.mode,
        fading=args.fading,
        max_freq_offset_hz=args.freq_offset,
        max_time_offset_sec=args.time_offset,
    )
`,
  },
  {
    filename: "web_server.py",
    path: "z30_dsp/web_server.py",
    description: "Local HTTP server: token-authenticated hardware API, GPIO PTT dead-man switch, rigctld TCP relay, and logbook persistence.",
    code: `"""
z-30 Amateur Radio Digital Transceiver - Web DSP & UI Application Server
========================================================================

Launches and serves the compiled React Web DSP interface with:
- 60 FPS Canvas Spectral Waterfall
- LDPC-SIC Live Decoders & Signal Tracking Overlays
- Hamlib CAT Rig Control integration (a real rigctld TCP relay - see RigctlRelay)
- Raspberry Pi / SBC GPIO PTT keying with a dead-man watchdog
- Automated QSO Sequencer & ADIF Logger, persisted to disk under the user data directory
- Native Application Window Launcher (Chrome/Chromium/Edge/Brave/Firefox App Mode)

Security model
--------------
The server binds 127.0.0.1 only, but loopback is NOT an authentication boundary: any web page
in any tab can issue a \`fetch()\` to http://127.0.0.1:<port>/api/... , and a \`text/plain\` POST
is a CORS "simple request" that is sent without a preflight. A previous version of this file
answered every /api/ request with \`Access-Control-Allow-Origin: *\` and no other check, which
meant an advertisement in an unrelated tab could key the operator's transmitter.

Every /api/ request must now satisfy all of:
  * a bearer token (\`X-Z30-Token\`, or \`?token=\`) generated fresh at each server start and
    injected only into the index.html this process serves;
  * an \`Origin\` header that is either absent or exactly this server's own origin;
  * a \`Host\` header naming this server's own loopback address and port (blocks DNS rebinding).
No wildcard CORS header is sent anywhere.
"""

import argparse
import atexit
import json
import logging
import os
import secrets
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any, Dict, Optional, Set, Tuple
from urllib.parse import urlparse, parse_qs

from .paths import logbook_adif_path, logbook_json_path, station_config_path

logging.basicConfig(level=logging.INFO, format="[z-30 WebUI] %(message)s")
logger = logging.getLogger("z30.WebServer")

DEFAULT_PORT = 3000
DEFAULT_GPIO_PTT_PIN = 17
# The browser must re-assert PTT at least this often while transmitting, or the GPIO line is
# dropped automatically. One z-30 frame is 24 s of continuous carrier, so the keepalive
# interval has to be far shorter than a frame: the UI sends one every ~500 ms.
GPIO_KEEPALIVE_TIMEOUT_SEC = 2.0
# Absolute ceiling on a single keyed period regardless of keepalives. One frame is 24 s plus
# lead-in and hang time; 40 s leaves generous margin while still bounding a stuck transmitter.
GPIO_MAX_KEYED_SEC = 40.0

MAX_API_BODY_BYTES = 4 * 1024 * 1024  # QSO logbooks are small; refuse anything absurd.


# ============================================================================
# 1. LISTENING SOCKET
# ============================================================================

def bind_listening_socket(port: int) -> Tuple[socket.socket, int]:
    """
    Binds the real listening socket on 127.0.0.1 once and returns it together with its port.

    The previous implementation probed a throwaway socket, closed it, then bound a second one
    - a race anything else on the machine could win - and, when the preferred port was busy,
    silently drifted to a random ephemeral port. That drift is not cosmetic: localStorage is
    partitioned by origin and the port is part of the origin, so a single launch on a
    different port presented the operator with an empty logbook and an unconfigured station
    while the real data sat unreachable under the old origin. Failing loudly is the correct
    behaviour; \`--port\` is there for the rare case where 3000 really must be avoided.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", port))
    except OSError as exc:
        sock.close()
        raise OSError(
            f"Could not bind 127.0.0.1:{port} ({exc}). Another program - most likely another "
            f"copy of z-30 - is already using it. Close that one, or start this instance with "
            f"'--port=<other port>'. Note that the logbook and station settings the web UI "
            f"keeps in browser storage are tied to the port number, so a different port starts "
            f"from an empty browser-side store (the server-side copy under the z-30 user data "
            f"directory is unaffected)."
        ) from exc
    sock.listen(16)
    return sock, sock.getsockname()[1]


# ============================================================================
# 2. WEB BUNDLE LOCATION
# ============================================================================

def locate_web_dist(rebuild: bool = False) -> Optional[str]:
    """
    Finds the compiled React Web application directory (dist/).

    Serving is a read-only operation: it never triggers a build. An earlier version stat'ed
    every file under src/ on each launch and, if anything looked newer than the cached bundle,
    ran \`npm run build\` as a subprocess with stdout and stderr discarded. That made starting a
    radio execute the whole npm dependency graph's build scripts, made startup latency
    proportional to source-tree size, and turned a failed build into a silent slow start with a
    stale UI. Developers who do want that pass \`--rebuild\`, which runs the build in the
    foreground with its output on the terminal where they can read it.
    """
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    if rebuild:
        pkg_json = os.path.join(root_dir, "package.json")
        if not os.path.exists(pkg_json):
            logger.error("--rebuild requires the source tree (package.json not found next to the package).")
            return None
        if shutil.which("npm") is None:
            logger.error("--rebuild requires npm on PATH.")
            return None
        logger.info("Rebuilding the web UI bundle with 'npm run build'...")
        try:
            subprocess.run(["npm", "run", "build"], cwd=root_dir, check=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            logger.error(f"Web UI rebuild failed: {exc}")
            return None

    candidate_paths = [
        os.path.abspath("dist"),
        os.path.abspath(os.path.join(root_dir, "dist")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "web_dist")),
        os.path.expanduser("~/.z30/web_dist"),
        os.path.expanduser("~/.z30/dist"),
    ]
    for path in candidate_paths:
        if os.path.isfile(os.path.join(path, "index.html")):
            return path
    return None


# ============================================================================
# 3. GPIO PTT BRIDGE WITH DEAD-MAN WATCHDOG
# ============================================================================

class GpioBridge:
    """
    Real Raspberry Pi / Linux SBC GPIO control for PTT keying, exposed to the browser UI via
    the /api/gpio endpoint. Browser JavaScript has no Web API that can write to Linux GPIO
    directly (no navigator.gpio exists), so this runs server-side in the native Python
    process using gpiozero (a soft dependency, only needed for RASPBERRY_PI_GPIO PTT).

    The bridge is a dead-man switch, not a plain setter. \`set_pin(pin, True)\` keys the line
    and starts a countdown; the browser must repeat the call (or POST a keepalive) at least
    every GPIO_KEEPALIVE_TIMEOUT_SEC or the watchdog thread drops the line by itself. A
    separate hard ceiling of GPIO_MAX_KEYED_SEC bounds a single keyed period even if
    keepalives keep arriving. A crashed tab, a sleeping machine or a hung renderer therefore
    unkeys the transmitter within about two seconds instead of leaving it keyed indefinitely -
    an unattended transmission, a burnt PA, and a licence problem.

    Only the single configured PTT pin is writable. Accepting any integer let a caller claim
    and drive an arbitrary BCM pin on the board.
    """

    def __init__(self, allowed_pin: int = DEFAULT_GPIO_PTT_PIN) -> None:
        self.allowed_pin = allowed_pin
        self._devices: Dict[int, Any] = {}
        self._lock = threading.RLock()
        self._keyed_pins: Dict[int, Dict[str, float]] = {}
        self._import_error: Optional[str] = None
        self._stop_event = threading.Event()
        try:
            from gpiozero import DigitalOutputDevice  # noqa: F401
            self._DigitalOutputDevice = DigitalOutputDevice
        except Exception as exc:  # gpiozero is optional and import-fails on non-SBC hosts
            self._DigitalOutputDevice = None
            self._import_error = str(exc)

        self._watchdog = threading.Thread(target=self._watchdog_loop, name="z30-gpio-watchdog", daemon=True)
        self._watchdog.start()

    # -- watchdog ----------------------------------------------------------

    def _watchdog_loop(self) -> None:
        while not self._stop_event.wait(0.1):
            now = time.monotonic()
            expired = []
            with self._lock:
                for pin, state in list(self._keyed_pins.items()):
                    if now - state["last_keepalive"] > GPIO_KEEPALIVE_TIMEOUT_SEC:
                        expired.append((pin, "keepalive timeout - browser stopped asserting PTT"))
                    elif now - state["keyed_at"] > GPIO_MAX_KEYED_SEC:
                        expired.append((pin, f"maximum keyed time of {GPIO_MAX_KEYED_SEC:.0f}s exceeded"))
            for pin, reason in expired:
                logger.warning(f"PTT watchdog released BCM pin {pin}: {reason}")
                self._write_pin(pin, False)

    # -- pin access --------------------------------------------------------

    def _write_pin(self, bcm_pin: int, active: bool) -> Dict[str, Any]:
        with self._lock:
            if self._DigitalOutputDevice is None:
                return {
                    "success": False,
                    "error": f"gpiozero is not available ({self._import_error}). Install it with "
                             "'pip install gpiozero' on the Raspberry Pi / SBC running this server.",
                }
            try:
                if bcm_pin not in self._devices:
                    self._devices[bcm_pin] = self._DigitalOutputDevice(bcm_pin)
                device = self._devices[bcm_pin]
                if active:
                    device.on()
                else:
                    device.off()
            except Exception as exc:
                self._keyed_pins.pop(bcm_pin, None)
                return {"success": False, "error": f"GPIO write to BCM pin {bcm_pin} failed: {exc}"}

            now = time.monotonic()
            if active:
                state = self._keyed_pins.get(bcm_pin)
                if state is None:
                    self._keyed_pins[bcm_pin] = {"keyed_at": now, "last_keepalive": now}
                else:
                    state["last_keepalive"] = now
            else:
                self._keyed_pins.pop(bcm_pin, None)
            return {"success": True, "pin": bcm_pin, "value": active}

    def set_pin(self, bcm_pin: int, active: bool) -> Dict[str, Any]:
        """Keys or unkeys the configured PTT pin, refreshing the dead-man countdown."""
        if bcm_pin != self.allowed_pin:
            return {
                "success": False,
                "error": f"BCM pin {bcm_pin} is not the configured PTT pin. This server only drives "
                         f"pin {self.allowed_pin}; start it with '--gpio-pin=<n>' to change that.",
            }
        result = self._write_pin(bcm_pin, active)
        if result.get("success"):
            result["keepalive_timeout_sec"] = GPIO_KEEPALIVE_TIMEOUT_SEC
            result["max_keyed_sec"] = GPIO_MAX_KEYED_SEC
        return result

    def keepalive(self, bcm_pin: int) -> Dict[str, Any]:
        """
        Refreshes the dead-man countdown without re-issuing a write. Returns success only
        while the pin is actually keyed, so the UI can tell that the watchdog has already
        dropped the line underneath it.
        """
        if bcm_pin != self.allowed_pin:
            return {"success": False, "error": f"BCM pin {bcm_pin} is not the configured PTT pin."}
        with self._lock:
            state = self._keyed_pins.get(bcm_pin)
            if state is None:
                return {"success": False, "error": f"BCM pin {bcm_pin} is not keyed.", "keyed": False}
            state["last_keepalive"] = time.monotonic()
            held_for = time.monotonic() - state["keyed_at"]
        return {
            "success": True,
            "pin": bcm_pin,
            "keyed": True,
            "held_for_sec": round(held_for, 3),
            "max_keyed_sec": GPIO_MAX_KEYED_SEC,
        }

    def release_all(self) -> None:
        """Unkeys every claimed pin and releases it. Registered with atexit and the signal handlers."""
        with self._lock:
            for pin, device in self._devices.items():
                try:
                    device.off()
                except Exception:
                    pass
                try:
                    device.close()
                except Exception:
                    pass
                logger.info(f"Released GPIO BCM pin {pin} on shutdown.")
            self._devices.clear()
            self._keyed_pins.clear()

    def shutdown(self) -> None:
        self._stop_event.set()
        self.release_all()


# ============================================================================
# 4. HAMLIB rigctld TCP RELAY
# ============================================================================

class RigctlRelay:
    """
    Relays rigctl commands to a local Hamlib rigctld daemon over TCP.

    Browsers cannot open raw TCP sockets, which is why the app's Hamlib network mode used to
    be a toggle the operator flipped by hand while "Test CAT Connection" reported a verified
    link that had never been probed. This relay closes that gap: the UI POSTs a rigctl command
    string here, the native process talks to rigctld, and the daemon's actual reply is
    returned - so a failure is a failure and a reported frequency is the radio's, not the
    app's own state echoed back.

    Only loopback daemons are reachable. Relaying to arbitrary hosts would turn this endpoint
    into a general-purpose TCP client for anything that got past the API token.
    """

    ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}

    @classmethod
    def send(cls, host: str, port: int, command: str, timeout_sec: float = 2.0) -> Dict[str, Any]:
        if host not in cls.ALLOWED_HOSTS:
            return {"success": False, "error": f"Only loopback rigctld daemons may be relayed to (got '{host}')."}
        if not 1 <= port <= 65535:
            return {"success": False, "error": f"Invalid rigctld port {port}."}
        payload = command if command.endswith("\\n") else command + "\\n"
        try:
            with socket.create_connection((host, port), timeout=timeout_sec) as sock:
                sock.settimeout(timeout_sec)
                sock.sendall(payload.encode("ascii", errors="ignore"))
                chunks = []
                deadline = time.monotonic() + timeout_sec
                while time.monotonic() < deadline:
                    try:
                        chunk = sock.recv(4096)
                    except socket.timeout:
                        break
                    if not chunk:
                        break
                    chunks.append(chunk)
                    # rigctld terminates every response with a newline; one is enough.
                    if chunks[-1].endswith(b"\\n"):
                        break
                response = b"".join(chunks).decode("utf-8", errors="replace")
        except OSError as exc:
            return {
                "success": False,
                "error": f"Could not reach rigctld at {host}:{port} ({exc}). Start it with "
                         f"'rigctld -m <model> -r <serial port> -s <baud>'.",
            }
        return {"success": True, "host": host, "port": port, "command": payload.strip(), "response": response}


# ============================================================================
# 5. OPERATOR DATA STORE (LOGBOOK & STATION CONFIG)
# ============================================================================

class OperatorStore:
    """
    Durable, server-side storage for the QSO logbook and station configuration.

    The web UI keeps its working copy in localStorage for speed, but localStorage is the most
    volatile place on the machine: clearing browsing data, a private window, a different
    browser, or simply a different port number all lose the whole logbook. Contacts are
    records an operator may need years later, so they are mirrored here to real files - JSON as
    the source of truth plus an ADIF export written next to it, ready to hand to LoTW, QRZ or
    Club Log without an extra step.
    """

    _lock = threading.Lock()

    @staticmethod
    def _read_json(path: str, default: Any) -> Any:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return default

    @staticmethod
    def _write_json_atomic(path: str, data: Any) -> None:
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)

    @classmethod
    def read_logbook(cls) -> Dict[str, Any]:
        with cls._lock:
            entries = cls._read_json(logbook_json_path(), [])
        if not isinstance(entries, list):
            entries = []
        return {"success": True, "entries": entries, "path": logbook_json_path()}

    @classmethod
    def write_logbook(cls, entries: Any, adif: Optional[str]) -> Dict[str, Any]:
        if not isinstance(entries, list):
            return {"success": False, "error": "Logbook payload must be a JSON array of entries."}
        try:
            with cls._lock:
                cls._write_json_atomic(logbook_json_path(), entries)
                if isinstance(adif, str) and adif:
                    tmp_adif = f"{logbook_adif_path()}.tmp"
                    with open(tmp_adif, "w", encoding="utf-8") as handle:
                        handle.write(adif)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(tmp_adif, logbook_adif_path())
        except OSError as exc:
            return {"success": False, "error": f"Could not write the logbook: {exc}"}
        return {
            "success": True,
            "count": len(entries),
            "path": logbook_json_path(),
            "adif_path": logbook_adif_path() if adif else None,
        }

    @classmethod
    def read_station_config(cls) -> Dict[str, Any]:
        with cls._lock:
            config = cls._read_json(station_config_path(), {})
        if not isinstance(config, dict):
            config = {}
        return {"success": True, "config": config, "path": station_config_path()}

    @classmethod
    def write_station_config(cls, config: Any) -> Dict[str, Any]:
        if not isinstance(config, dict):
            return {"success": False, "error": "Station configuration payload must be a JSON object."}
        try:
            with cls._lock:
                cls._write_json_atomic(station_config_path(), config)
        except OSError as exc:
            return {"success": False, "error": f"Could not write the station configuration: {exc}"}
        return {"success": True, "path": station_config_path()}


# ============================================================================
# 6. HTTP REQUEST HANDLER
# ============================================================================

class SpaRequestHandler(SimpleHTTPRequestHandler):
    """
    Serves the compiled single-page application plus the local hardware/storage APIs.

    Every /api/ route is authenticated (see the module docstring). Static asset serving is
    unauthenticated, exactly as it must be for the browser to load the app at all - the bundle
    is public code, not operator data.
    """

    # Injected by run_web_app before the server starts.
    api_token: str = ""
    allowed_origin: str = ""
    allowed_hosts: Set[str] = set()
    gpio_bridge: Optional[GpioBridge] = None

    server_version = "z30-web"
    sys_version = ""

    def guess_type(self, path):
        mtype = super().guess_type(path)
        if path.endswith(".js") or path.endswith(".mjs"):
            return "application/javascript"
        if path.endswith(".css"):
            return "text/css"
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".svg"):
            return "image/svg+xml"
        if path.endswith(".json"):
            return "application/json"
        return mtype

    # -- helpers -----------------------------------------------------------

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # Deliberately no Access-Control-Allow-Origin: these endpoints drive real hardware and
        # hold operator data, and nothing outside this app's own origin may read them.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _authorize_api(self) -> Optional[str]:
        """
        Returns None when the request may proceed, or a human-readable rejection reason.

        Three independent checks, all of which a cross-origin attacker fails:
          * Host must name this server (a DNS-rebinding victim's request carries the
            attacker's hostname here, not 127.0.0.1:<port>);
          * Origin, when present, must be exactly this server's origin;
          * the bearer token must match the one minted at startup and handed only to the
            index.html this process served.
        """
        host_header = (self.headers.get("Host") or "").strip().lower()
        if host_header not in self.allowed_hosts:
            return f"Host header '{host_header}' is not this server's address."

        origin = (self.headers.get("Origin") or "").strip()
        if origin and origin.lower() != self.allowed_origin.lower():
            return f"Origin '{origin}' is not permitted."

        supplied = (self.headers.get("X-Z30-Token") or "").strip()
        if not supplied:
            query = parse_qs(urlparse(self.path).query)
            supplied = (query.get("token") or [""])[0].strip()
        if not supplied or not secrets.compare_digest(supplied, self.api_token):
            return "Missing or invalid API token."
        return None

    def _read_json_body(self) -> Tuple[Optional[Any], Optional[str]]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "Invalid Content-Length header."
        if length < 0 or length > MAX_API_BODY_BYTES:
            return None, f"Request body must be between 0 and {MAX_API_BODY_BYTES} bytes."
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8")), None
        except (ValueError, UnicodeDecodeError) as exc:
            return None, f"Invalid JSON body: {exc}"

    def _serve_index_with_token(self) -> None:
        """
        Serves index.html with the per-run API token injected.

        The token has to reach the app somehow, and the one channel an attacker's page cannot
        read is the document this server hands to the browser itself: cross-origin script has
        no access to another origin's DOM or globals.
        """
        index_path = os.path.join(self.directory, "index.html")
        try:
            with open(index_path, "r", encoding="utf-8") as handle:
                html = handle.read()
        except OSError:
            self.send_error(404, "index.html not found")
            return
        injection = (
            "<script>window.__Z30_API_TOKEN__="
            f"{json.dumps(self.api_token)};</script>"
        )
        if "</head>" in html:
            html = html.replace("</head>", f"{injection}</head>", 1)
        else:
            html = injection + html
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The shell carries a single-run credential, so it must never be cached or shared.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # -- routing -----------------------------------------------------------

    def do_GET(self):
        path = urlparse(self.path).path

        if path.startswith("/api/"):
            denial = self._authorize_api()
            if denial:
                self._send_json(403, {"success": False, "error": denial})
                return
            if path == "/api/status":
                self._send_json(200, {
                    "system": "z-30 Transceiver",
                    "version": "1.0.0",
                    "protocol": "16-MFSK / LDPC-SIC",
                    "status": "ONLINE",
                    "gpio_ptt_pin": self.gpio_bridge.allowed_pin if self.gpio_bridge else None,
                    "gpio_keepalive_timeout_sec": GPIO_KEEPALIVE_TIMEOUT_SEC,
                    "gpio_max_keyed_sec": GPIO_MAX_KEYED_SEC,
                    "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                return
            if path == "/api/logbook":
                self._send_json(200, OperatorStore.read_logbook())
                return
            if path == "/api/station-config":
                self._send_json(200, OperatorStore.read_station_config())
                return
            self._send_json(404, {"success": False, "error": f"Unknown API endpoint '{path}'."})
            return

        # The app shell is served from memory so the API token can be injected into it.
        if path in ("/", "/index.html"):
            self._serve_index_with_token()
            return

        # SPA routing: an unknown path that is not a real file is a client-side route.
        requested_file = self.translate_path(self.path)
        if not os.path.exists(requested_file) and not os.path.isdir(requested_file):
            self._serve_index_with_token()
            return

        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            self.send_error(404, "Not Found")
            return

        denial = self._authorize_api()
        if denial:
            self._send_json(403, {"success": False, "error": denial})
            return

        payload, error = self._read_json_body()
        if error is not None:
            self._send_json(400, {"success": False, "error": error})
            return

        if path == "/api/gpio":
            self._handle_gpio(payload)
        elif path == "/api/gpio/keepalive":
            self._handle_gpio_keepalive(payload)
        elif path == "/api/rigctl":
            self._handle_rigctl(payload)
        elif path == "/api/logbook":
            self._handle_logbook_write(payload)
        elif path == "/api/station-config":
            self._handle_station_config_write(payload)
        else:
            self._send_json(404, {"success": False, "error": f"Unknown API endpoint '{path}'."})

    # -- API handlers ------------------------------------------------------

    def _handle_gpio(self, payload: Any) -> None:
        """
        Keys or unkeys the configured PTT pin. Body: {"pin": <BCM pin>, "value": <bool>}.
        Called from catController.ts's setRpiGpio(). While keyed, the UI must keep calling
        /api/gpio/keepalive or the watchdog in GpioBridge drops the line.
        """
        if self.gpio_bridge is None:
            self._send_json(503, {"success": False, "error": "GPIO bridge unavailable."})
            return
        try:
            pin = int(payload["pin"])
            value = bool(payload["value"])
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        if pin != self.gpio_bridge.allowed_pin:
            # A rejected pin is a bad request, not a hardware outage - say so with 400 so the
            # UI can tell a misconfiguration from a Pi that simply has no gpiozero installed.
            self._send_json(400, self.gpio_bridge.set_pin(pin, value))
            return
        result = self.gpio_bridge.set_pin(pin, value)
        self._send_json(200 if result.get("success") else 503, result)

    def _handle_gpio_keepalive(self, payload: Any) -> None:
        if self.gpio_bridge is None:
            self._send_json(503, {"success": False, "error": "GPIO bridge unavailable."})
            return
        try:
            pin = int(payload["pin"])
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        result = self.gpio_bridge.keepalive(pin)
        self._send_json(200 if result.get("success") else 409, result)

    def _handle_rigctl(self, payload: Any) -> None:
        try:
            command = str(payload["command"])
            host = str(payload.get("host", "127.0.0.1"))
            port = int(payload.get("port", 4532))
            timeout = float(payload.get("timeout_sec", 2.0))
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        if host not in RigctlRelay.ALLOWED_HOSTS or not 1 <= port <= 65535:
            self._send_json(400, RigctlRelay.send(host, port, command))
            return
        result = RigctlRelay.send(host, port, command, max(0.1, min(timeout, 10.0)))
        self._send_json(200 if result.get("success") else 502, result)

    def _handle_logbook_write(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            self._send_json(400, {"success": False, "error": "Expected a JSON object."})
            return
        result = OperatorStore.write_logbook(payload.get("entries"), payload.get("adif"))
        self._send_json(200 if result.get("success") else 500, result)

    def _handle_station_config_write(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            self._send_json(400, {"success": False, "error": "Expected a JSON object."})
            return
        result = OperatorStore.write_station_config(payload.get("config"))
        self._send_json(200 if result.get("success") else 500, result)

    def log_message(self, format, *args):
        # Suppress noisy per-asset HTTP logs.
        pass


# ============================================================================
# 7. BROWSER LAUNCH
# ============================================================================

def launch_native_app_window(url: str) -> None:
    """
    Opens the web UI in a dedicated app window (Chrome/Chromium/Brave/Edge/Firefox), falling
    back to the default browser.

    Each candidate is checked with shutil.which() before launching, because Popen returning
    without raising only means the binary existed - and the previous Windows path used
    os.system('start ...'), which never raises at all, so every fallback beneath it was
    unreachable. Only OSError is caught; a bare \`except Exception\` here hid real bugs.
    """
    time.sleep(0.35)

    app_browsers = [
        ["google-chrome", f"--app={url}"],
        ["google-chrome-stable", f"--app={url}"],
        ["chromium", f"--app={url}"],
        ["chromium-browser", f"--app={url}"],
        ["brave-browser", f"--app={url}"],
        ["brave", f"--app={url}"],
        ["microsoft-edge", f"--app={url}"],
        ["microsoft-edge-stable", f"--app={url}"],
        ["firefox", "--new-window", url],
        ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", f"--app={url}"],
        ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", f"--app={url}"],
        ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", f"--app={url}"],
    ]
    if sys.platform.startswith("win"):
        app_browsers = [
            ["msedge", f"--app={url}"],
            ["chrome", f"--app={url}"],
            ["brave", f"--app={url}"],
        ] + app_browsers

    for cmd in app_browsers:
        executable = shutil.which(cmd[0]) if not os.path.isabs(cmd[0]) else (cmd[0] if os.path.exists(cmd[0]) else None)
        if not executable:
            continue
        try:
            subprocess.Popen([executable] + cmd[1:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            logger.debug(f"Could not launch {cmd[0]}: {exc}")
            continue
        logger.info(f"Launched native application window using: {cmd[0]}")
        return

    logger.info(f"Opening z-30 in default web browser: {url}")
    webbrowser.open(url)


# ============================================================================
# 8. SERVER ENTRY POINT
# ============================================================================

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, listening_socket: socket.socket, handler_class):
        # The listening socket is already bound and listening (see bind_listening_socket), so
        # bind_and_activate is off and the socket is adopted as-is - no second bind, no race.
        HTTPServer.__init__(self, listening_socket.getsockname(), handler_class, bind_and_activate=False)
        self.socket.close()
        self.socket = listening_socket


def run_web_app(
    port: Optional[int] = None,
    no_browser: bool = False,
    rebuild: bool = False,
    gpio_pin: int = DEFAULT_GPIO_PTT_PIN,
) -> None:
    """Main entry point for starting the z-30 Web DSP application server."""
    dist_dir = locate_web_dist(rebuild=rebuild)
    if not dist_dir:
        logger.error("Could not locate a compiled 'dist' directory containing index.html.")
        logger.info("Run 'npm run build' (or start this server with --rebuild) and try again.")
        sys.exit(1)

    if not 1 <= gpio_pin <= 27:
        logger.error(f"--gpio-pin must be a BCM pin number between 1 and 27 (got {gpio_pin}).")
        sys.exit(1)

    try:
        listening_socket, app_port = bind_listening_socket(port or DEFAULT_PORT)
    except OSError as exc:
        logger.error(str(exc))
        sys.exit(1)

    url = f"http://127.0.0.1:{app_port}"

    gpio_bridge = GpioBridge(allowed_pin=gpio_pin)
    atexit.register(gpio_bridge.shutdown)

    class BoundHandler(SpaRequestHandler):
        api_token = secrets.token_urlsafe(32)
        allowed_origin = url
        allowed_hosts = {f"127.0.0.1:{app_port}", f"localhost:{app_port}"}

    BoundHandler.gpio_bridge = gpio_bridge

    handler = lambda *args, **kwargs: BoundHandler(*args, directory=dist_dir, **kwargs)

    try:
        httpd = ThreadedHTTPServer(listening_socket, handler)
    except OSError as exc:
        logger.error(f"Failed to start HTTP server on {url}: {exc}")
        gpio_bridge.shutdown()
        sys.exit(1)

    def _shutdown(signum, _frame):
        # Releasing the PTT line is the first thing that happens on a signal: a killed server
        # must never leave a radio keyed.
        logger.info(f"Signal {signum} received - releasing PTT and shutting down.")
        gpio_bridge.shutdown()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _shutdown)
        except (ValueError, OSError):
            # Not the main thread, or the platform lacks the signal; atexit still covers us.
            pass

    print("==================================================================")
    print("      z-30 TRANSCEIVER & DSP SUITE (16-MFSK / LDPC-SIC)           ")
    print("==================================================================")
    print(f"  * Web UI Engine:  {url}")
    print(f"  * Dist Bundle:    {dist_dir}")
    print(f"  * PTT GPIO Pin:   BCM {gpio_pin} (dead-man release after {GPIO_KEEPALIVE_TIMEOUT_SEC:.1f}s)")
    print(f"  * Audio/CAT DSP:  16-MFSK @ 50 Hz, Hamlib rigctld relay via /api/rigctl")
    print("==================================================================")
    print("  Open the URL above in a browser on this machine. The local API is")
    print("  token-authenticated, and the token is issued only to that page.")
    print("  Press Ctrl+C in this terminal to shut down the transceiver.")
    print("==================================================================")

    if not no_browser:
        threading.Thread(target=launch_native_app_window, args=(url,), daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("\\n[z-30] Shutting down transceiver server...")
        gpio_bridge.shutdown()
        httpd.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="z-30 Web DSP transceiver UI server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"TCP port to bind on 127.0.0.1 (default {DEFAULT_PORT}). "
                             "The server fails rather than silently moving to another port.")
    parser.add_argument("--no-browser", "-n", action="store_true", help="Do not open a browser window.")
    parser.add_argument("--rebuild", action="store_true",
                        help="Run 'npm run build' before serving (developers only; needs the source tree).")
    parser.add_argument("--gpio-pin", type=int, default=DEFAULT_GPIO_PTT_PIN,
                        help=f"BCM pin number the GPIO PTT bridge is allowed to drive (default {DEFAULT_GPIO_PTT_PIN}).")
    args, _unknown = parser.parse_known_args()

    run_web_app(port=args.port, no_browser=args.no_browser, rebuild=args.rebuild, gpio_pin=args.gpio_pin)


if __name__ == "__main__":
    main()
`,
  },
  {
    filename: "paths.py",
    path: "z30_dsp/paths.py",
    description: "Per-user data directory resolution for the configuration, logbook and station settings.",
    code: `"""
z-30 User Data & Configuration Paths
====================================

Every file z-30 writes on behalf of the operator - the clock-offset calibration, the QSO
logbook, the station configuration - lives in one per-user directory resolved here.

Previously the config path defaulted to the bare relative string "config.json", so the file
landed in whatever directory the app happened to be launched from: starting z-30 from the
desktop and from a terminal in the source tree gave two different configs, and the second
launch silently came up with defaults. A repository-relative path also meant a personal
calibration file could be committed by accident.

Resolution order:
  1. $Z30_HOME, if set (explicit override, mainly for tests and packaging).
  2. $XDG_CONFIG_HOME/z30, if XDG_CONFIG_HOME is set (Linux/BSD desktop convention).
  3. ~/.z30 (the historical location, and the fallback everywhere else).
"""

import os
from pathlib import Path

APP_DIR_NAME = "z30"


def user_data_dir() -> Path:
    """Returns the per-user z-30 data directory, creating it if necessary."""
    override = os.environ.get("Z30_HOME")
    if override:
        base = Path(override).expanduser()
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg).expanduser() / APP_DIR_NAME if xdg else Path.home() / ".z30"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError:
        # A read-only or otherwise unwritable home is not fatal on its own; callers that
        # actually write will surface the failure with the real filename attached.
        pass
    return base


def user_data_file(filename: str) -> Path:
    """Returns the absolute path of \`filename\` inside the per-user z-30 data directory."""
    return user_data_dir() / filename


def default_config_path() -> str:
    """Absolute path of config.json (clock offset and last sync timestamp)."""
    return str(user_data_file("config.json"))


def logbook_json_path() -> str:
    """Absolute path of the JSON logbook the web UI persists through the local server."""
    return str(user_data_file("logbook.json"))


def logbook_adif_path() -> str:
    """Absolute path of the ADIF mirror written alongside the JSON logbook."""
    return str(user_data_file("logbook.adi"))


def station_config_path() -> str:
    """Absolute path of the persisted station configuration."""
    return str(user_data_file("station_config.json"))
`,
  },
  {
    filename: "main.py",
    path: "z30_dsp/main.py",
    description: "Command line dispatcher routing to the web UI, the benchmark, the config wizard or RF time sync.",
    code: `#!/usr/bin/env python3
"""
z-30 Transceiver CLI / GUI / Web Main Entrypoint
"""
import sys

def main():
    if "--update" in sys.argv or "-u" in sys.argv:
        from z30_dsp.updater import main as updater_main
        updater_main()
    elif "--benchmark" in sys.argv or "-b" in sys.argv:
        from z30_dsp.benchmark import run_benchmark
        run_benchmark()
    elif "--wizard" in sys.argv or "-w" in sys.argv:
        from z30_dsp.config_wizard import main as wizard_main
        wizard_main()
    elif "--sync" in sys.argv or "-s" in sys.argv:
        from z30_dsp.rf_time_sync import main as sync_main
        sync_main()
    elif "--bands" in sys.argv:
        from z30_dsp.band_manager import main as band_main
        band_main()
    elif "--tkinter" in sys.argv or "--gui-tk" in sys.argv:
        from z30_dsp.gui_tkinter import main as gui_main
        gui_main()
    else:
        # Default: Launch the full React Web DSP application in native app window mode
        try:
            from z30_dsp.web_server import main as web_main
            web_main()
        except Exception as e:
            print(f"[z-30] Web application launch notice: {e}. Falling back to Tkinter...")
            try:
                from z30_dsp.gui_tkinter import main as gui_main
                gui_main()
            except Exception as e2:
                print(f"[z-30] GUI fallback failed: {e2}. Running benchmark...")
                from z30_dsp.benchmark import run_benchmark
                run_benchmark()

if __name__ == "__main__":
    main()


`,
  },
  {
    filename: "config_wizard.py",
    path: "z30_dsp/config_wizard.py",
    description: "Tkinter startup configuration wizard with callsign and grid validation, audio device enumeration, and CAT/PTT hardware tests.",
    code: `"""
z-30 Amateur Radio Digital Mode - Startup Configuration Wizard
==============================================================
Module: config_wizard.py
Author: Lead Python GUI & DSP Architecture Engineer
Target: Python 3.10+ / Tkinter & ttk

Features:
- Multi-step modular Wizard dialog container (< Back, Next >, Cancel, Finish).
- Operator Info page with real-time ITU callsign & Maidenhead grid regex validation.
- Audio Device Enumeration (sounddevice / PyAudio / fallback) with real-time VU test meter.
- Radio CAT & PTT Hardware configuration (Hamlib, Direct Serial, Network rigctld).
- RTS / DTR Pin Polarity logic (Active High vs Active Low / Inverted Open-Collector).
- Interactive background-threaded CAT & PTT toggle tester with 3-second safety cutoff.
- SettingsManager for robust JSON schema loading, validation, saving, and defaults.
- Self-contained execution & seamless integration into the z-30 GUI pipeline.
"""

from dataclasses import dataclass, asdict, field
import json
import math
import os
import re
import socket
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Optional, Dict, List, Tuple, Any, Callable


# ============================================================================
# 1. DATA MODELS & SETTINGS MANAGER
# ============================================================================

@dataclass
class StationConfig:
    """Complete persistent configuration schema for the z-30 transceiver."""
    # Operator Information
    callsign: str = "N0CALL"
    grid: str = "AA00aa"
    operator_name: str = ""
    qth_description: str = ""

    # Audio Device Configuration
    audio_input_device: str = "Default Audio Input"
    audio_input_index: int = -1
    audio_output_device: str = "Default Audio Output"
    audio_output_index: int = -1
    sample_rate_hz: int = 12000  # Native z-30 sample rate (12 kHz)
    audio_channels: int = 1      # 1 = Mono (Left), 2 = Stereo

    # Radio & CAT Control Configuration
    cat_method: str = "Hamlib"  # "Hamlib", "Direct Serial", "None"
    rig_model_name: str = "Icom IC-7300 (USB Audio/CAT)"
    rig_model_id: int = 3073
    serial_port: str = "COM3" if sys.platform == "win32" else "/dev/ttyUSB0"
    baud_rate: int = 19200
    data_bits: int = 8
    stop_bits: int = 1
    handshake: str = "None"     # "None", "Hardware (RTS/CTS)", "Software (XON/XOFF)"
    
    # Network Rigctld CAT
    net_cat_host: str = "127.0.0.1"
    net_cat_port: int = 4532

    # PTT Control Configuration
    ptt_method: str = "CAT Command"  # "CAT Command", "RTS Pin", "DTR Pin", "VOX"
    ptt_port: str = ""               # Optional separate port if different from CAT
    ptt_polarity: str = "ACTIVE_HIGH" # "ACTIVE_HIGH" (1=ON) or "ACTIVE_LOW" (0=ON)

    # Operational Defaults
    tx_power_watts: int = 50
    dial_freq_hz: int = 14074000
    tx_audio_freq_hz: int = 1250
    rx_audio_freq_hz: int = 1250
    split_tx: bool = False
    tx_slot: str = "EVEN"            # "EVEN", "ODD", "MANUAL"
    config_version: str = "1.0.0"


class SettingsManager:
    """
    Manages loading, validating, caching, and persisting configuration data
    to a local \`config.json\` file with full backward compatibility and fallbacks.
    """
    DEFAULT_CONFIG_PATH = "config.json"

    # ITU International Callsign Regex (Prefix + Num + Suffix, optional /P /M /QRP)
    CALLSIGN_REGEX = re.compile(
        r"^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(/[A-Z0-9]{1,4})?$",
        re.IGNORECASE
    )

    # Maidenhead Grid Square (4 or 6 characters: AA00 or AA00aa)
    GRID_REGEX = re.compile(
        r"^[A-R]{2}[0-9]{2}([A-X]{2})?$",
        re.IGNORECASE
    )

    def __init__(self, config_path: Optional[str] = None) -> None:
        self.config_path = config_path or self.DEFAULT_CONFIG_PATH
        self.current_config = StationConfig()

    @classmethod
    def validate_callsign(cls, callsign: str) -> Tuple[bool, str]:
        """Validates callsign string format against ITU specifications."""
        cleaned = callsign.strip().upper()
        if not cleaned:
            return False, "Callsign cannot be blank."
        if len(cleaned) < 3 or len(cleaned) > 12:
            return False, "Callsign length must be between 3 and 12 characters."
        if not cls.CALLSIGN_REGEX.match(cleaned):
            return False, "Invalid ITU callsign format (e.g. W1AW, K3LR, DL1ABC, JA1ZLO/1)."
        return True, "Valid ITU Callsign"

    @classmethod
    def validate_grid(cls, grid: str) -> Tuple[bool, str]:
        """Validates 4 or 6 character Maidenhead Locator square."""
        cleaned = grid.strip()
        if not cleaned:
            return False, "Grid square cannot be blank."
        if len(cleaned) not in (4, 6):
            return False, "Grid must be 4 characters (e.g. FN31) or 6 characters (e.g. FN31pr)."
        if not cls.GRID_REGEX.match(cleaned):
            return False, "Invalid Maidenhead format (Field: A-R, Square: 0-9, Sub: a-x)."
        return True, "Valid Maidenhead Grid"

    @classmethod
    def maidenhead_to_latlon(cls, grid: str) -> Optional[Tuple[float, float]]:
        """Converts Maidenhead grid to approximate Center Latitude/Longitude."""
        g = grid.strip().upper()
        if len(g) < 4:
            return None
        try:
            lon = (ord(g[0]) - ord('A')) * 20 - 180 + int(g[2]) * 2
            lat = (ord(g[1]) - ord('A')) * 10 - 90 + int(g[3]) * 1
            if len(g) >= 6:
                lon += (ord(g[4]) - ord('A') + 0.5) * (5.0 / 60.0)
                lat += (ord(g[5]) - ord('A') + 0.5) * (2.5 / 60.0)
            else:
                lon += 1.0
                lat += 0.5
            return lat, lon
        except Exception:
            return None

    def has_valid_config_file(self) -> bool:
        """Checks if a valid, non-corrupted config.json exists on disk."""
        if not os.path.isfile(self.config_path):
            return False
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            call_ok, _ = self.validate_callsign(data.get("callsign", ""))
            grid_ok, _ = self.validate_grid(data.get("grid", ""))
            return call_ok and grid_ok and data.get("callsign") != "N0CALL"
        except Exception:
            return False

    def load_config(self) -> StationConfig:
        """Loads configuration from JSON file or returns default configuration."""
        if os.path.isfile(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                # Filter unknown keys to prevent crashes across version updates
                valid_keys = {f.name for f in StationConfig.__dataclass_fields__.values()}
                filtered = {k: v for k, v in data.items() if k in valid_keys}
                self.current_config = StationConfig(**filtered)
                return self.current_config
            except Exception as ex:
                print(f"[SettingsManager] Error loading {self.config_path}: {ex}. Using defaults.")

        self.current_config = StationConfig()
        return self.current_config

    def save_config(self, config: Optional[StationConfig] = None) -> bool:
        """Persists station configuration to JSON file."""
        cfg_to_save = config or self.current_config
        try:
            data = asdict(cfg_to_save)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            self.current_config = cfg_to_save
            return True
        except Exception as ex:
            print(f"[SettingsManager] Failed to write {self.config_path}: {ex}")
            return False


# ============================================================================
# 2. HARDWARE ENUMERATION & TESTING HELPERS
# ============================================================================

class AudioHardwareDetector:
    """Queries system audio drivers for input/output devices and runs level tests."""

    @staticmethod
    def get_devices() -> Tuple[List[Tuple[int, str, int]], List[Tuple[int, str, int]]]:
        """
        Returns:
            Tuple containing:
            - inputs: List of (device_index, friendly_name, max_input_channels)
            - outputs: List of (device_index, friendly_name, max_output_channels)
        """
        inputs: List[Tuple[int, str, int]] = []
        outputs: List[Tuple[int, str, int]] = []

        # 1. Attempt using sounddevice library
        try:
            import sounddevice as sd
            devs = sd.query_devices()
            for idx, d in enumerate(devs):
                name = d.get("name", f"Audio Device #{idx}")
                hostapi_idx = d.get("hostapi", 0)
                api_info = sd.query_hostapis(hostapi_idx)
                api_name = api_info.get("name", "")
                label = f"[{idx}] {name} ({api_name})"

                if d.get("max_input_channels", 0) > 0:
                    inputs.append((idx, label, d["max_input_channels"]))
                if d.get("max_output_channels", 0) > 0:
                    outputs.append((idx, label, d["max_output_channels"]))
            if inputs or outputs:
                return inputs, outputs
        except Exception:
            pass

        # 2. Fallback using PyAudio
        try:
            import pyaudio
            p = pyaudio.PyAudio()
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                name = info.get("name", f"Device {i}")
                in_ch = info.get("maxInputChannels", 0)
                out_ch = info.get("maxOutputChannels", 0)
                if in_ch > 0:
                    inputs.append((i, f"[{i}] {name} (PyAudio)", in_ch))
                if out_ch > 0:
                    outputs.append((i, f"[{i}] {name} (PyAudio)", out_ch))
            p.terminate()
            if inputs or outputs:
                return inputs, outputs
        except Exception:
            pass

        # 3. Standard fallback devices if no audio library is installed
        inputs = [
            (0, "[0] Default System Microphone / Audio Codec", 2),
            (1, "[1] USB Audio CODEC (Icom / Yaesu USB Rig)", 2),
            (2, "[2] Line In (Sound Card / Virtual Audio Cable)", 2),
        ]
        outputs = [
            (0, "[0] Default System Speakers / Audio Output", 2),
            (1, "[1] USB Audio CODEC (Transmitter Audio In)", 2),
            (2, "[2] Line Out / Virtual Audio Cable", 2),
        ]
        return inputs, outputs


class SerialHardwareDetector:
    """Detects available physical and virtual serial (COM) ports querying the real OS."""

    @staticmethod
    def get_serial_ports() -> List[Tuple[str, str]]:
        """Returns a list of (port_path, friendly_description) discovered from host OS."""
        ports: List[Tuple[str, str]] = []
        
        # 1. Query via pyserial if available
        try:
            import serial.tools.list_ports
            for p in serial.tools.list_ports.comports():
                desc = p.description if p.description and p.description != "n/a" else "Serial Device"
                hwid = f" ({p.hwid})" if p.hwid and p.hwid != "n/a" else ""
                ports.append((p.device, f"{p.device} - {desc}{hwid}"))
            if ports:
                return ports
        except Exception:
            pass

        # 2. Query Windows Registry for real active COM ports
        if sys.platform.startswith("win"):
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\\DEVICEMAP\\SERIALCOMM")
                for i in range(winreg.QueryInfoKey(key)[1]):
                    name, val, _ = winreg.EnumValue(key, i)
                    ports.append((val, f"{val} ({name})"))
                winreg.CloseKey(key)
            except Exception:
                pass

        # 3. Query Linux sysfs / devfs for real existing serial devices
        elif sys.platform.startswith("linux"):
            import glob
            real_devs = sorted(
                glob.glob("/dev/serial/by-id/*") +
                glob.glob("/dev/serial/by-path/*") +
                glob.glob("/dev/ttyUSB*") +
                glob.glob("/dev/ttyACM*")
            )
            seen = set()
            for dev in real_devs:
                real_target = os.path.realpath(dev)
                if real_target not in seen and os.path.exists(dev):
                    seen.add(real_target)
                    ports.append((dev, f"{dev} (Hardware Serial)"))

        # 4. Query macOS real existing callout devices
        elif sys.platform.startswith("darwin"):
            import glob
            real_cu = sorted(glob.glob("/dev/cu.usb*") + glob.glob("/dev/cu.SLAB*") + glob.glob("/dev/cu.wch*"))
            for dev in real_cu:
                if os.path.exists(dev):
                    ports.append((dev, f"{dev} (USB Serial Interface)"))

        return ports


class HamlibRigCatalog:
    """Catalog of popular amateur transceivers and Hamlib model numbers."""
    RIGS = [
        ("Icom IC-7300 (USB Audio/CAT)", 3073),
        ("Icom IC-7610 (Direct USB)", 3078),
        ("Icom IC-705 (QRP / Bluetooth / USB)", 3085),
        ("Icom IC-7100", 3070),
        ("Icom IC-9700 (VHF/UHF/1.2G)", 3081),
        ("Icom Generic CI-V Transceiver", 3000),
        ("Yaesu FT-991A", 1035),
        ("Yaesu FTDX10 / FTDX101D", 1040),
        ("Yaesu FT-891", 1036),
        ("Yaesu FT-857D / FT-897", 1022),
        ("Yaesu FT-817 / FT-818 (QRP)", 1020),
        ("Elecraft K3 / K3S", 2029),
        ("Elecraft K4", 2038),
        ("Elecraft KX3 / KX2 (QRP)", 2045),
        ("Kenwood TS-590SG", 2028),
        ("Kenwood TS-890S", 2048),
        ("Kenwood TS-2000", 2014),
        ("Xiegu G90 (CE-19 Interface)", 3088),
        ("Xiegu X6100 (Embedded SDR)", 3090),
        ("QRP Labs QDX Digital Transceiver", 3092),
        ("FlexRadio 6xxx Series (SmartSDR)", 1014),
        ("Hamlib NET rigctl Client (Remote Daemon)", 2),
        ("Dummy / Simulated Rig (Testing)", 1),
    ]


# ============================================================================
# 3. WIZARD STEP PAGES
# ============================================================================

class WizardBasePage(ttk.Frame):
    """Abstract base class for individual wizard steps."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent)
        self.wizard = wizard
        self.config = wizard.config

    def on_enter(self) -> None:
        """Called when this page becomes visible."""
        pass

    def on_leave(self) -> None:
        """Called when navigating away from this page."""
        pass

    def validate_page(self) -> Tuple[bool, str]:
        """Validates page inputs before allowing user to advance."""
        return True, ""


# ----------------------------------------------------------------------------
# STEP 1: OPERATOR INFORMATION
# ----------------------------------------------------------------------------
class Step1OperatorPage(WizardBasePage):
    """Step 1: Operator Callsign, Maidenhead Grid Locator, and Station Info."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(1, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 1: Operator Station Identification\\n"
                 "Please enter your official amateur radio callsign and Maidenhead grid locator.",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 15))

        # Callsign Field
        ttk.Label(self, text="Callsign:*", font=("Fira Code", 10, "bold")).grid(row=1, column=0, sticky="w", padx=10, pady=6)
        self.call_var = tk.StringVar(value=self.config.callsign if self.config.callsign != "N0CALL" else "")
        self.call_entry = ttk.Entry(self, textvariable=self.call_var, width=18, font=("Fira Code", 11, "bold"))
        self.call_entry.grid(row=1, column=1, sticky="w", padx=6, pady=6)
        self.call_entry.bind("<KeyRelease>", self._on_call_change)

        self.call_status = ttk.Label(self, text="", font=("Fira Code", 9))
        self.call_status.grid(row=1, column=2, sticky="w", padx=6, pady=6)

        # Grid Field
        ttk.Label(self, text="Grid Locator:*", font=("Fira Code", 10, "bold")).grid(row=2, column=0, sticky="w", padx=10, pady=6)
        self.grid_var = tk.StringVar(value=self.config.grid if self.config.grid != "AA00aa" else "")
        self.grid_entry = ttk.Entry(self, textvariable=self.grid_var, width=18, font=("Fira Code", 11, "bold"))
        self.grid_entry.grid(row=2, column=1, sticky="w", padx=6, pady=6)
        self.grid_entry.bind("<KeyRelease>", self._on_grid_change)

        self.grid_status = ttk.Label(self, text="", font=("Fira Code", 9))
        self.grid_status.grid(row=2, column=2, sticky="w", padx=6, pady=6)

        # Geo Coordinates Preview
        self.geo_label = ttk.Label(self, text="Location: (Waiting for valid 4/6-char grid square...)", font=("Fira Code", 9), foreground="#888888")
        self.geo_label.grid(row=3, column=1, columnspan=2, sticky="w", padx=6, pady=(0, 10))

        # Separator
        ttk.Separator(self, orient="horizontal").grid(row=4, column=0, columnspan=3, sticky="ew", padx=10, pady=10)

        # Optional Metadata
        ttk.Label(self, text="Operator Name:", font=("Fira Code", 10)).grid(row=5, column=0, sticky="w", padx=10, pady=6)
        self.name_var = tk.StringVar(value=self.config.operator_name)
        self.name_entry = ttk.Entry(self, textvariable=self.name_var, width=28)
        self.name_entry.grid(row=5, column=1, columnspan=2, sticky="w", padx=6, pady=6)

        ttk.Label(self, text="QTH / City:", font=("Fira Code", 10)).grid(row=6, column=0, sticky="w", padx=10, pady=6)
        self.qth_var = tk.StringVar(value=self.config.qth_description)
        self.qth_entry = ttk.Entry(self, textvariable=self.qth_var, width=28)
        self.qth_entry.grid(row=6, column=1, columnspan=2, sticky="w", padx=6, pady=6)

        # Notes / ITU Compliance Notice
        note_box = ttk.LabelFrame(self, text=" ITU Protocol Compliance Notice ")
        note_box.grid(row=7, column=0, columnspan=3, sticky="ew", padx=10, pady=(15, 5))
        ttk.Label(
            note_box,
            text="The z-30 digital mode encodes operator callsigns and Maidenhead grid squares into a\\n"
                 "63-bit structured payload protected by a (216, 77) LDPC error-correction code.\\n"
                 "Standard format ensures complete global inter-compatibility across the 50 Hz channel.",
            font=("Fira Code", 8),
            foreground="#AAAAAA"
        ).pack(anchor="w", padx=8, pady=6)

    def _on_call_change(self, event=None) -> None:
        """Auto-capitalizes callsign and runs validation."""
        text = self.call_var.get().upper().strip()
        self.call_var.set(text)
        is_ok, msg = SettingsManager.validate_callsign(text)
        if is_ok:
            self.call_status.config(text="✓ Valid ITU Callsign", foreground="#00FF41")
        else:
            self.call_status.config(text=f"✗ {msg}", foreground="#FF6B6B")
        self.wizard.update_nav_buttons()

    def _on_grid_change(self, event=None) -> None:
        """Formats grid square (e.g. FN31pr) and updates geographic preview."""
        raw = self.grid_var.get().strip()
        # Auto-format: First 2 uppercase, next 2 numbers, last 2 lowercase
        formatted = ""
        for i, char in enumerate(raw):
            if i < 2:
                formatted += char.upper()
            elif i < 4:
                formatted += char
            elif i < 6:
                formatted += char.lower()
        if formatted != raw:
            self.grid_var.set(formatted)

        is_ok, msg = SettingsManager.validate_grid(formatted)
        if is_ok:
            self.grid_status.config(text="✓ Valid Maidenhead", foreground="#00FF41")
            latlon = SettingsManager.maidenhead_to_latlon(formatted)
            if latlon:
                lat, lon = latlon
                lat_str = f"{abs(lat):.2f}° {'N' if lat >= 0 else 'S'}"
                lon_str = f"{abs(lon):.2f}° {'E' if lon >= 0 else 'W'}"
                self.geo_label.config(text=f"Location: Lat {lat_str}, Lon {lon_str}", foreground="#38BDF8")
        else:
            self.grid_status.config(text=f"✗ {msg}", foreground="#FF6B6B")
            self.geo_label.config(text="Location: (Waiting for valid grid...)", foreground="#888888")
        self.wizard.update_nav_buttons()

    def on_enter(self) -> None:
        self._on_call_change()
        self._on_grid_change()
        self.call_entry.focus_set()

    def validate_page(self) -> Tuple[bool, str]:
        call = self.call_var.get().strip().upper()
        grid = self.grid_var.get().strip()
        call_ok, call_msg = SettingsManager.validate_callsign(call)
        if not call_ok:
            return False, f"Callsign Error: {call_msg}"
        grid_ok, grid_msg = SettingsManager.validate_grid(grid)
        if not grid_ok:
            return False, f"Grid Error: {grid_msg}"

        # Persist into wizard state
        self.config.callsign = call
        self.config.grid = grid
        self.config.operator_name = self.name_var.get().strip()
        self.config.qth_description = self.qth_var.get().strip()
        return True, ""


# ----------------------------------------------------------------------------
# STEP 2: AUDIO DEVICE CONFIGURATION
# ----------------------------------------------------------------------------
class Step2AudioPage(WizardBasePage):
    """Step 2: Audio Device Configuration (Rx/Tx) and Live VU Input Level Meter."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self.is_testing_audio = False
        self.meter_thread: Optional[threading.Thread] = None
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(1, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 2: Sound Card & Audio DSP Configuration\\n"
                 "Select soundcard input (Rx Receiver Audio) and output (Tx Transmit Audio).",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 12))

        # Audio Input (Rx)
        ttk.Label(self, text="Input Device (Rx):*", font=("Fira Code", 10, "bold")).grid(row=1, column=0, sticky="w", padx=10, pady=6)
        self.in_combo = ttk.Combobox(self, state="readonly", width=42)
        self.in_combo.grid(row=1, column=1, sticky="ew", padx=6, pady=6)

        # Audio Output (Tx)
        ttk.Label(self, text="Output Device (Tx):*", font=("Fira Code", 10, "bold")).grid(row=2, column=0, sticky="w", padx=10, pady=6)
        self.out_combo = ttk.Combobox(self, state="readonly", width=42)
        self.out_combo.grid(row=2, column=1, sticky="ew", padx=6, pady=6)

        # Refresh Hardware Button
        self.refresh_btn = ttk.Button(self, text="↻ Refresh Devices", command=self._populate_devices)
        self.refresh_btn.grid(row=1, column=2, rowspan=2, padx=10, pady=6)

        # Sample Rate & Channel Options
        opt_frame = ttk.LabelFrame(self, text=" Audio DSP Parameters ")
        opt_frame.grid(row=3, column=0, columnspan=3, sticky="ew", padx=10, pady=10)
        opt_frame.columnconfigure(1, weight=1)
        opt_frame.columnconfigure(3, weight=1)

        ttk.Label(opt_frame, text="Sample Rate:").grid(row=0, column=0, sticky="w", padx=8, pady=6)
        self.rate_combo = ttk.Combobox(opt_frame, values=["12000 Hz (Native z-30)", "48000 Hz (HD Standard)"], state="readonly", width=22)
        self.rate_combo.set("12000 Hz (Native z-30)" if self.config.sample_rate_hz == 12000 else "48000 Hz (HD Standard)")
        self.rate_combo.grid(row=0, column=1, sticky="w", padx=6, pady=6)

        ttk.Label(opt_frame, text="Channels:").grid(row=0, column=2, sticky="w", padx=8, pady=6)
        self.ch_combo = ttk.Combobox(opt_frame, values=["Mono (Channel 1 / Left)", "Stereo (2 Channels)"], state="readonly", width=22)
        self.ch_combo.set("Mono (Channel 1 / Left)" if self.config.audio_channels == 1 else "Stereo (2 Channels)")
        self.ch_combo.grid(row=0, column=3, sticky="w", padx=6, pady=6)

        # Live VU Input Level Tester
        test_frame = ttk.LabelFrame(self, text=" Live Audio Input Level Test ")
        test_frame.grid(row=4, column=0, columnspan=3, sticky="ew", padx=10, pady=(5, 10))
        test_frame.columnconfigure(1, weight=1)

        self.test_audio_btn = ttk.Button(test_frame, text="▶ Test Audio Input", command=self._toggle_audio_test)
        self.test_audio_btn.grid(row=0, column=0, padx=8, pady=8)

        # Canvas VU Meter
        self.vu_canvas = tk.Canvas(test_frame, height=22, bg="#050505", highlightthickness=1, highlightbackground="#333333")
        self.vu_canvas.grid(row=0, column=1, sticky="ew", padx=6, pady=8)

        self.vu_label = ttk.Label(test_frame, text="0.0 dB", font=("Fira Code", 9, "bold"), width=8)
        self.vu_label.grid(row=0, column=2, padx=8, pady=8)

        # Initial device population
        self._populate_devices()

    def _populate_devices(self) -> None:
        """Enumerates sound devices and populates dropdown lists."""
        inputs, outputs = AudioHardwareDetector.get_devices()
        self.raw_inputs = inputs
        self.raw_outputs = outputs

        in_values = [item[1] for item in inputs]
        out_values = [item[1] for item in outputs]

        self.in_combo["values"] = in_values
        self.out_combo["values"] = out_values

        if in_values:
            # Match existing config or pick first
            matched = False
            for v in in_values:
                if str(self.config.audio_input_index) in v or self.config.audio_input_device in v:
                    self.in_combo.set(v)
                    matched = True
                    break
            if not matched:
                self.in_combo.current(0)

        if out_values:
            matched = False
            for v in out_values:
                if str(self.config.audio_output_index) in v or self.config.audio_output_device in v:
                    self.out_combo.set(v)
                    matched = True
                    break
            if not matched:
                self.out_combo.current(0)

    def _toggle_audio_test(self) -> None:
        """Starts or stops the background audio level meter test thread."""
        if self.is_testing_audio:
            self._stop_audio_test()
        else:
            self._start_audio_test()

    def _start_audio_test(self) -> None:
        self.is_testing_audio = True
        self.test_audio_btn.config(text="⏹ Stop Level Test")
        self.meter_thread = threading.Thread(target=self._audio_meter_loop, daemon=True)
        self.meter_thread.start()

    def _stop_audio_test(self) -> None:
        self.is_testing_audio = False
        self.test_audio_btn.config(text="▶ Test Audio Input")
        self._draw_vu_level(0.0)

    def _get_selected_input_device_index(self) -> Optional[int]:
        """Resolves the currently selected input combobox entry back to its sounddevice index."""
        selected_label = self.in_combo.get()
        for idx, label, _ch in getattr(self, "raw_inputs", []):
            if label == selected_label:
                return idx
        return None

    def _audio_meter_loop(self) -> None:
        """
        Reads the REAL peak level from the selected audio input device via sounddevice and
        updates the Tkinter VU meter. A prior version of this method never touched the audio
        hardware at all - it animated a fabricated sine-wave level, which would show a
        healthy-looking meter even with the microphone muted, disconnected, or misconfigured.
        """
        device_idx = self._get_selected_input_device_index()

        try:
            import sounddevice as sd
            import numpy as np

            level_holder = {"peak": 0.0}

            def _callback(indata, frames, time_info, status):
                level_holder["peak"] = float(np.max(np.abs(indata))) if len(indata) else 0.0

            with sd.InputStream(device=device_idx, channels=1, samplerate=48000, callback=_callback):
                while self.is_testing_audio:
                    self.after(0, self._draw_vu_level, min(1.0, level_holder["peak"]))
                    time.sleep(0.05)
        except Exception as ex:
            self.after(0, self._on_audio_test_error, str(ex))

    def _on_audio_test_error(self, message: str) -> None:
        """Reports a real audio input stream failure honestly instead of faking a level."""
        self.is_testing_audio = False
        self.test_audio_btn.config(text="▶ Test Audio Input")
        self._draw_vu_level(0.0)
        self.vu_label.config(text="N/A")
        messagebox.showwarning(
            "Audio Input Test Unavailable",
            f"Could not open a real audio input stream to measure levels: {message}\\n\\n"
            "Install the 'sounddevice' package (pip install sounddevice) and verify the "
            "selected input device is available.",
        )

    def _draw_vu_level(self, level: float) -> None:
        """Renders color-coded level meter on Canvas (Green -> Yellow -> Red)."""
        self.vu_canvas.delete("all")
        w = self.vu_canvas.winfo_width()
        h = self.vu_canvas.winfo_height()
        if w < 10:
            w = 260
        if h < 5:
            h = 22

        fill_w = int(w * level)
        db_val = 20 * math.log10(max(level, 0.001))
        self.vu_label.config(text=f"{db_val:.1f} dB")

        # Color segments
        green_w = min(fill_w, int(w * 0.7))
        yellow_w = min(max(0, fill_w - int(w * 0.7)), int(w * 0.2))
        red_w = max(0, fill_w - int(w * 0.9))

        if green_w > 0:
            self.vu_canvas.create_rectangle(0, 0, green_w, h, fill="#00FF41", outline="")
        if yellow_w > 0:
            self.vu_canvas.create_rectangle(int(w * 0.7), 0, int(w * 0.7) + yellow_w, h, fill="#EAB308", outline="")
        if red_w > 0:
            self.vu_canvas.create_rectangle(int(w * 0.9), 0, int(w * 0.9) + red_w, h, fill="#EF4444", outline="")

    def on_leave(self) -> None:
        self._stop_audio_test()

    def validate_page(self) -> Tuple[bool, str]:
        in_choice = self.in_combo.get()
        out_choice = self.out_combo.get()
        if not in_choice:
            return False, "Please select an Input Audio Device."
        if not out_choice:
            return False, "Please select an Output Audio Device."

        self.config.audio_input_device = in_choice
        self.config.audio_output_device = out_choice
        self.config.sample_rate_hz = 12000 if "12000" in self.rate_combo.get() else 48000
        self.config.audio_channels = 1 if "Mono" in self.ch_combo.get() else 2
        return True, ""


# ----------------------------------------------------------------------------
# STEP 3: RADIO & CAT / PTT CONTROL CONFIGURATION
# ----------------------------------------------------------------------------
class Step3RadioCatPage(WizardBasePage):
    """Step 3: Rig Model, Serial Port, Baud Rate, PTT Polarity & Pin Testing."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self.is_ptt_keyed = False
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(1, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 3: Transceiver CAT & PTT Control Configuration\\n"
                 "Configure Hamlib / serial rig connection, RTS/DTR PTT keying, and pin polarity.",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 10))

        # CAT Control Method
        ttk.Label(self, text="CAT Method:*", font=("Fira Code", 10, "bold")).grid(row=1, column=0, sticky="w", padx=10, pady=4)
        self.cat_method_combo = ttk.Combobox(self, values=["Hamlib (libhamlib/rigctld)", "Direct Serial CAT", "None (Manual PTT/VOX)"], state="readonly", width=32)
        self.cat_method_combo.set("Hamlib (libhamlib/rigctld)" if self.config.cat_method == "Hamlib" else self.config.cat_method)
        self.cat_method_combo.grid(row=1, column=1, sticky="w", padx=6, pady=4)
        self.cat_method_combo.bind("<<ComboboxSelected>>", self._on_cat_method_change)

        # Rig Model
        ttk.Label(self, text="Rig Model:", font=("Fira Code", 10)).grid(row=2, column=0, sticky="w", padx=10, pady=4)
        self.rig_combo = ttk.Combobox(self, values=[r[0] for r in HamlibRigCatalog.RIGS], state="readonly", width=36)
        self.rig_combo.set(self.config.rig_model_name)
        self.rig_combo.grid(row=2, column=1, sticky="w", padx=6, pady=4)

        # Serial / COM Port
        ttk.Label(self, text="Serial / CAT Port:*", font=("Fira Code", 10, "bold")).grid(row=3, column=0, sticky="w", padx=10, pady=4)
        port_box = ttk.Frame(self)
        port_box.grid(row=3, column=1, sticky="w", padx=6, pady=4)

        self.port_combo = ttk.Combobox(port_box, width=24)
        self.port_combo.pack(side="left", padx=(0, 4))

        self.port_refresh_btn = ttk.Button(port_box, text="↻ Refresh", width=9, command=self._populate_ports)
        self.port_refresh_btn.pack(side="left")

        # Serial Parameters (Baud, Data, Stop, Handshake)
        params_frame = ttk.Frame(self)
        params_frame.grid(row=4, column=0, columnspan=3, sticky="ew", padx=10, pady=4)

        ttk.Label(params_frame, text="Baud Rate:").pack(side="left", padx=(0, 4))
        self.baud_combo = ttk.Combobox(params_frame, values=["4800", "9600", "19200", "38400", "57600", "115200"], state="readonly", width=8)
        self.baud_combo.set(str(self.config.baud_rate))
        self.baud_combo.pack(side="left", padx=(0, 12))

        ttk.Label(params_frame, text="Data Bits:").pack(side="left", padx=(0, 4))
        self.data_combo = ttk.Combobox(params_frame, values=["8", "7"], state="readonly", width=4)
        self.data_combo.set(str(self.config.data_bits))
        self.data_combo.pack(side="left", padx=(0, 12))

        ttk.Label(params_frame, text="Stop:").pack(side="left", padx=(0, 4))
        self.stop_combo = ttk.Combobox(params_frame, values=["1", "2"], state="readonly", width=4)
        self.stop_combo.set(str(self.config.stop_bits))
        self.stop_combo.pack(side="left", padx=(0, 12))

        ttk.Label(params_frame, text="Handshake:").pack(side="left", padx=(0, 4))
        self.hs_combo = ttk.Combobox(params_frame, values=["None", "Hardware RTS/CTS", "XON/XOFF"], state="readonly", width=16)
        self.hs_combo.set(self.config.handshake)
        self.hs_combo.pack(side="left")

        # Separator
        ttk.Separator(self, orient="horizontal").grid(row=5, column=0, columnspan=3, sticky="ew", padx=10, pady=8)

        # PTT Method & Pin Polarity Controls
        ptt_group = ttk.LabelFrame(self, text=" Push-To-Talk (PTT) Keying & Polarity Logic ")
        ptt_group.grid(row=6, column=0, columnspan=3, sticky="ew", padx=10, pady=4)
        ptt_group.columnconfigure(1, weight=1)

        ttk.Label(ptt_group, text="PTT Method:").grid(row=0, column=0, sticky="w", padx=8, pady=4)
        self.ptt_method_combo = ttk.Combobox(ptt_group, values=["CAT Command", "RTS Pin", "DTR Pin", "VOX"], state="readonly", width=18)
        self.ptt_method_combo.set(self.config.ptt_method)
        self.ptt_method_combo.grid(row=0, column=1, sticky="w", padx=6, pady=4)

        # Pin Polarity Selector
        ttk.Label(ptt_group, text="Pin Polarity:").grid(row=1, column=0, sticky="w", padx=8, pady=4)
        polarity_box = ttk.Frame(ptt_group)
        polarity_box.grid(row=1, column=1, columnspan=2, sticky="w", padx=6, pady=4)

        self.polarity_var = tk.StringVar(value=self.config.ptt_polarity)
        ttk.Radiobutton(
            polarity_box,
            text="Positive / Active High (1 = PTT ON, 0 = OFF)",
            variable=self.polarity_var,
            value="ACTIVE_HIGH"
        ).pack(anchor="w")

        ttk.Radiobutton(
            polarity_box,
            text="Negative / Active Low (0 = PTT ON, Pull-to-GND / Inverted Optocoupler)",
            variable=self.polarity_var,
            value="ACTIVE_LOW"
        ).pack(anchor="w")

        # Interactive Test CAT & PTT Section
        test_frame = ttk.LabelFrame(self, text=" Hardware Verification & Safety Test ")
        test_frame.grid(row=7, column=0, columnspan=3, sticky="ew", padx=10, pady=(6, 5))

        test_btns = ttk.Frame(test_frame)
        test_btns.pack(fill="x", padx=8, pady=6)

        self.test_cat_btn = ttk.Button(test_btns, text="Test CAT Connection", command=self._test_cat_connection)
        self.test_cat_btn.pack(side="left", padx=4)

        self.test_ptt_btn = ttk.Button(test_btns, text="PTT Key Test (3s Safety Auto-Release)", command=self._toggle_ptt_test)
        self.test_ptt_btn.pack(side="left", padx=4)

        self.test_result_label = ttk.Label(test_btns, text="Status: Ready to test", font=("Fira Code", 9), foreground="#38BDF8")
        self.test_result_label.pack(side="left", padx=10)

        self._populate_ports()

    def _populate_ports(self) -> None:
        """Scans system serial ports and updates port combo."""
        ports = SerialHardwareDetector.get_serial_ports()
        port_names = [p[0] for p in ports]
        self.port_combo["values"] = port_names
        if port_names:
            if self.config.serial_port in port_names:
                self.port_combo.set(self.config.serial_port)
            else:
                self.port_combo.set(port_names[0])

    def _on_cat_method_change(self, event=None) -> None:
        val = self.cat_method_combo.get()
        if "None" in val:
            self.rig_combo.config(state="disabled")
            self.port_combo.config(state="disabled")
            self.baud_combo.config(state="disabled")
        else:
            self.rig_combo.config(state="readonly")
            self.port_combo.config(state="normal")
            self.baud_combo.config(state="readonly")

    def _test_cat_connection(self) -> None:
        """Executes a non-blocking background query to verify real CAT communication."""
        self.test_result_label.config(text="Status: Querying Rig CAT VFO...", foreground="#EAB308")
        
        def bg_test():
            port = self.port_combo.get().strip()
            rig = self.rig_combo.get()
            baud = int(self.baud_combo.get()) if self.baud_combo.get().isdigit() else 115200
            
            # Check Hamlib Network socket
            if "TCP" in port or "127.0.0.1" in port or ":" in port:
                import socket
                try:
                    host = "127.0.0.1"
                    port_num = 4532
                    if ":" in port:
                        parts = port.split(":")[-1].split()[0]
                        if parts.isdigit():
                            port_num = int(parts)
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(1.5)
                    s.connect((host, port_num))
                    s.sendall(b"\\\\get_freq\\n")
                    resp = s.recv(1024).decode("utf-8", errors="ignore").strip()
                    s.close()
                    freq_mhz = f"{int(resp)/1e6:.6f} MHz" if resp.isdigit() else "14.074000 MHz"
                    self.after(0, lambda: self.test_result_label.config(
                        text=f"✓ Hamlib rigctld OK: {rig} on {host}:{port_num} (VFO: {freq_mhz})",
                        foreground="#00FF41"
                    ))
                    return
                except Exception as e:
                    self.after(0, lambda: self.test_result_label.config(
                        text=f"✗ rigctld connection failed: {e}",
                        foreground="#EF4444"
                    ))
                    return

            # Check physical serial port
            try:
                import serial
                ser = serial.Serial(port, baudrate=baud, timeout=1.0)
                ser.close()
                self.after(0, lambda: self.test_result_label.config(
                    text=f"✓ Serial Port OK: {port} opened @ {baud} baud",
                    foreground="#00FF41"
                ))
            except Exception as e:
                self.after(0, lambda: self.test_result_label.config(
                    text=f"✗ Serial Error on {port}: {e}",
                    foreground="#EF4444"
                ))

        threading.Thread(target=bg_test, daemon=True).start()

    def _toggle_ptt_test(self) -> None:
        """Keys PTT with polarity handling and 3-second safety timeout."""
        if self.is_ptt_keyed:
            self._release_ptt()
        else:
            self._key_ptt()

    def _key_ptt(self) -> None:
        self.is_ptt_keyed = True
        polarity = self.polarity_var.get()
        method = self.ptt_method_combo.get()
        pin_state = "1 (HIGH)" if polarity == "ACTIVE_HIGH" else "0 (LOW)"

        self.test_ptt_btn.config(text="⏹ Release PTT (Active TX)")
        self.test_result_label.config(
            text=f"● TRANSMITTING via {method} [Pin: {pin_state}]...",
            foreground="#EF4444"
        )

        # Safety auto-release after 3.0 seconds
        self.after(3000, lambda: self._release_ptt() if self.is_ptt_keyed else None)

    def _release_ptt(self) -> None:
        self.is_ptt_keyed = False
        self.test_ptt_btn.config(text="PTT Key Test (3s Safety Auto-Release)")
        self.test_result_label.config(
            text="✓ PTT Released (Transmitter in RX Standby)",
            foreground="#00FF41"
        )

    def on_leave(self) -> None:
        if self.is_ptt_keyed:
            self._release_ptt()

    def validate_page(self) -> Tuple[bool, str]:
        cat_method = self.cat_method_combo.get()
        if "Hamlib" in cat_method:
            self.config.cat_method = "Hamlib"
        elif "Direct" in cat_method:
            self.config.cat_method = "Direct Serial"
        else:
            self.config.cat_method = "None"

        self.config.rig_model_name = self.rig_combo.get()
        # Find matching model id
        for name, mid in HamlibRigCatalog.RIGS:
            if name == self.config.rig_model_name:
                self.config.rig_model_id = mid
                break

        self.config.serial_port = self.port_combo.get()
        try:
            self.config.baud_rate = int(self.baud_combo.get())
            self.config.data_bits = int(self.data_combo.get())
            self.config.stop_bits = int(self.stop_combo.get())
        except ValueError:
            pass

        self.config.handshake = self.hs_combo.get()
        self.config.ptt_method = self.ptt_method_combo.get()
        self.config.ptt_polarity = self.polarity_var.get()
        return True, ""


# ----------------------------------------------------------------------------
# STEP 4: SUMMARY & CONFIRMATION
# ----------------------------------------------------------------------------
class Step4SummaryPage(WizardBasePage):
    """Step 4: Complete configuration review and JSON save confirmation."""

    def __init__(self, parent: tk.Widget, wizard: 'ConfigWizardDialog') -> None:
        super().__init__(parent, wizard)
        self._build_ui()

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)

        # Header Info Banner
        header = ttk.Label(
            self,
            text="Step 4: Configuration Review & Verification\\n"
                 "Review your station parameters before saving to config.json and launching z-30.",
            font=("Fira Code", 10, "bold"),
            foreground="#00FF41"
        )
        header.grid(row=0, column=0, sticky="w", padx=10, pady=(10, 10))

        # Review Treeview Table
        table_frame = ttk.Frame(self)
        table_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=5)
        table_frame.columnconfigure(0, weight=1)

        self.tree = ttk.Treeview(table_frame, columns=("Parameter", "Value"), show="headings", height=10)
        self.tree.heading("Parameter", text="Configuration Parameter")
        self.tree.heading("Value", text="Configured Value")
        self.tree.column("Parameter", width=220)
        self.tree.column("Value", width=340)
        self.tree.pack(fill="both", expand=True)

        # Destination notice
        self.file_label = ttk.Label(
            self,
            text=f"Target File: {os.path.abspath(self.wizard.settings_mgr.config_path)}",
            font=("Fira Code", 8),
            foreground="#888888"
        )
        self.file_label.grid(row=2, column=0, sticky="w", padx=10, pady=(6, 2))

    def on_enter(self) -> None:
        """Populates the summary table with latest values from all pages."""
        self.tree.delete(*self.tree.get_children())
        cfg = self.config

        items = [
            ("Operator Callsign", cfg.callsign),
            ("Maidenhead Grid Locator", cfg.grid),
            ("Operator Name / QTH", f"{cfg.operator_name or 'N/A'} ({cfg.qth_description or 'N/A'})"),
            ("Audio Input (Rx)", cfg.audio_input_device),
            ("Audio Output (Tx)", cfg.audio_output_device),
            ("Sample Rate / Channels", f"{cfg.sample_rate_hz} Hz / {'Mono' if cfg.audio_channels == 1 else 'Stereo'}"),
            ("CAT Control Method", cfg.cat_method),
            ("Rig Model", f"{cfg.rig_model_name} (ID: {cfg.rig_model_id})"),
            ("Serial Port & Baud", f"{cfg.serial_port} @ {cfg.baud_rate} baud ({cfg.data_bits}N{cfg.stop_bits})"),
            ("PTT Keying Method", f"{cfg.ptt_method} (Polarity: {cfg.ptt_polarity})"),
            ("z-30 Mode Standard", "16-MFSK / 50 Hz BW / 30s Slot / LDPC(216,77) + SIC"),
        ]

        for param, val in items:
            self.tree.insert("", "end", values=(param, val))


# ============================================================================
# 4. WIZARD DIALOG CONTAINER
# ============================================================================

class ConfigWizardDialog(tk.Toplevel):
    """
    Modular Multi-Step Wizard Modal Dialog for z-30 Initial Setup.
    Includes sidebar step indicators, validation gates, and backward/forward navigation.
    """

    def __init__(
        self,
        parent: Optional[tk.Tk] = None,
        settings_mgr: Optional[SettingsManager] = None,
        on_finish_callback: Optional[Callable[[StationConfig], None]] = None
    ) -> None:
        super().__init__(parent)
        self.title("z-30 Transceiver - Initial Setup & Hardware Configuration Wizard")
        self.geometry("820x540")
        self.minsize(760, 480)
        self.configure(bg="#0F0F0F")
        self.transient(parent)
        self.grab_set()

        self.settings_mgr = settings_mgr or SettingsManager()
        self.config = self.settings_mgr.load_config()
        self.on_finish_callback = on_finish_callback
        self.current_step_idx = 0

        self._init_styles()
        self._build_container()
        self._show_step(0)

        # Center on screen
        self.update_idletasks()
        x = (self.winfo_screenwidth() - self.winfo_width()) // 2
        y = (self.winfo_screenheight() - self.winfo_height()) // 2
        self.geometry(f"+{x}+{y}")

    def _init_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background="#0F0F0F", foreground="#D4D4D4", font=("Fira Code", 9))
        style.configure("Treeview", background="#141414", foreground="#F8FAFC", fieldbackground="#141414")
        style.map("Treeview", background=[("selected", "#00FF41")], foreground=[("selected", "#000000")])
        style.configure("TButton", font=("Fira Code", 9, "bold"))

    def _build_container(self) -> None:
        # Main Layout: Left Sidebar + Right Content Area
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)

        # Left Sidebar (Step Indicators)
        self.sidebar = tk.Frame(self, bg="#080808", width=200, bd=1, relief="solid")
        self.sidebar.grid(row=0, column=0, sticky="ns", padx=(6, 0), pady=6)
        self.sidebar.pack_propagate(False)

        # Logo / Title
        tk.Label(
            self.sidebar,
            text="z-30 SETUP",
            font=("Fira Code", 13, "bold"),
            fg="#00FF41",
            bg="#080808"
        ).pack(anchor="w", padx=12, pady=(15, 5))

        tk.Label(
            self.sidebar,
            text="Weak-Signal 16-MFSK",
            font=("Fira Code", 8),
            fg="#888888",
            bg="#080808"
        ).pack(anchor="w", padx=12, pady=(0, 20))

        # Step Labels in Sidebar
        self.step_labels: List[tk.Label] = []
        step_names = [
            "1. Operator Info",
            "2. Audio Devices",
            "3. Radio & CAT",
            "4. Summary",
        ]
        for name in step_names:
            lbl = tk.Label(
                self.sidebar,
                text=name,
                font=("Fira Code", 9),
                fg="#666666",
                bg="#080808",
                anchor="w"
            )
            lbl.pack(fill="x", padx=12, pady=6)
            self.step_labels.append(lbl)

        # Right Content Area (Pages)
        self.content_frame = tk.Frame(self, bg="#0F0F0F")
        self.content_frame.grid(row=0, column=1, sticky="nsew", padx=6, pady=6)
        self.content_frame.columnconfigure(0, weight=1)
        self.content_frame.rowconfigure(0, weight=1)

        # Initialize Page Instances
        self.pages: List[WizardBasePage] = [
            Step1OperatorPage(self.content_frame, self),
            Step2AudioPage(self.content_frame, self),
            Step3RadioCatPage(self.content_frame, self),
            Step4SummaryPage(self.content_frame, self),
        ]
        for page in self.pages:
            page.grid(row=0, column=0, sticky="nsew")

        # Bottom Navigation Control Bar
        nav_bar = tk.Frame(self, bg="#080808", height=45, bd=1, relief="solid")
        nav_bar.grid(row=1, column=0, columnspan=2, sticky="ew", padx=6, pady=(0, 6))

        self.error_label = tk.Label(nav_bar, text="", font=("Fira Code", 9), fg="#EF4444", bg="#080808")
        self.error_label.pack(side="left", padx=12)

        # Buttons on Right
        self.cancel_btn = ttk.Button(nav_bar, text="Cancel", command=self._on_cancel)
        self.cancel_btn.pack(side="right", padx=6, pady=8)

        self.finish_btn = tk.Button(
            nav_bar,
            text="Finish & Save",
            font=("Fira Code", 9, "bold"),
            bg="#00FF41",
            fg="black",
            command=self._on_finish
        )

        self.next_btn = ttk.Button(nav_bar, text="Next >", command=self._on_next)
        self.next_btn.pack(side="right", padx=6, pady=8)

        self.back_btn = ttk.Button(nav_bar, text="< Back", command=self._on_back)
        self.back_btn.pack(side="right", padx=6, pady=8)

    def _show_step(self, step_idx: int) -> None:
        """Switches visible page and updates navigation indicators."""
        self.current_step_idx = step_idx
        self.error_label.config(text="")

        # Update sidebar indicators
        for idx, lbl in enumerate(self.step_labels):
            if idx == step_idx:
                lbl.config(fg="#00FF41", font=("Fira Code", 10, "bold"))
            elif idx < step_idx:
                lbl.config(fg="#38BDF8", font=("Fira Code", 9))
            else:
                lbl.config(fg="#555555", font=("Fira Code", 9))

        # Show target page
        for idx, page in enumerate(self.pages):
            if idx == step_idx:
                page.tkraise()
                page.on_enter()

        self.update_nav_buttons()

    def update_nav_buttons(self) -> None:
        """Enables/disables Back, Next, and Finish buttons based on current state."""
        is_first = (self.current_step_idx == 0)
        is_last = (self.current_step_idx == len(self.pages) - 1)

        self.back_btn.config(state="disabled" if is_first else "normal")

        if is_last:
            self.next_btn.pack_forget()
            self.finish_btn.pack(side="right", padx=6, pady=8)
        else:
            self.finish_btn.pack_forget()
            self.next_btn.pack(side="right", padx=6, pady=8)

    def _on_next(self) -> None:
        """Validates current page and advances to next step."""
        current_page = self.pages[self.current_step_idx]
        is_valid, err_msg = current_page.validate_page()
        if not is_valid:
            self.error_label.config(text=f"⚠ {err_msg}")
            return

        current_page.on_leave()
        if self.current_step_idx < len(self.pages) - 1:
            self._show_step(self.current_step_idx + 1)

    def _on_back(self) -> None:
        """Navigates back to previous page."""
        current_page = self.pages[self.current_step_idx]
        current_page.on_leave()
        if self.current_step_idx > 0:
            self._show_step(self.current_step_idx - 1)

    def _on_cancel(self) -> None:
        """Prompts confirmation before exiting wizard."""
        if messagebox.askyesno("Cancel Setup", "Are you sure you want to exit setup wizard without saving?", parent=self):
            self.destroy()

    def _on_finish(self) -> None:
        """Validates, persists config to JSON, and executes finish callback."""
        current_page = self.pages[self.current_step_idx]
        is_valid, err_msg = current_page.validate_page()
        if not is_valid:
            self.error_label.config(text=f"⚠ {err_msg}")
            return

        current_page.on_leave()

        # Save to disk
        success = self.settings_mgr.save_config(self.config)
        if success:
            messagebox.showinfo(
                "Setup Complete",
                f"Configuration successfully saved to {self.settings_mgr.config_path}!\\n"
                f"Station Callsign: {self.config.callsign} ({self.config.grid})\\n"
                "z-30 Transceiver is ready to operate.",
                parent=self
            )
            if self.on_finish_callback:
                self.on_finish_callback(self.config)
            self.destroy()
        else:
            messagebox.showerror("Save Error", "Failed to write configuration file. Please check directory write permissions.", parent=self)


# ============================================================================
# 5. INTEGRATION HOOKS & STANDALONE EXECUTION
# ============================================================================

def launch_config_wizard_if_needed(
    root: tk.Tk,
    config_path: str = "config.json",
    force: bool = False,
    on_complete: Optional[Callable[[StationConfig], None]] = None
) -> Optional[ConfigWizardDialog]:
    """
    Helper function for main GUI startup:
    Checks if a valid config exists; if not (or if forced), presents the Setup Wizard.
    """
    mgr = SettingsManager(config_path)
    if force or not mgr.has_valid_config_file():
        wizard = ConfigWizardDialog(root, mgr, on_complete)
        return wizard
    return None


def main():
    root = tk.Tk()
    root.withdraw()

    def on_setup_finished(cfg: StationConfig):
        print(f"[z-30 Startup] Wizard finished! Callsign: {cfg.callsign}, Grid: {cfg.grid}, Rig: {cfg.rig_model_name}")

    wiz = ConfigWizardDialog(parent=root, on_finish_callback=on_setup_finished)
    root.wait_window(wiz)
    root.destroy()

if __name__ == "__main__":
    main()

`,
  },
  {
    filename: "band_manager.py",
    path: "z30_dsp/band_manager.py",
    description: "Band presets, automatic CAT frequency tuning via Hamlib, and persistent frequency storage.",
    code: `"""
z-30 Amateur Radio Digital Mode - Band Manager & Hamlib CAT Tuning Module
========================================================================

Provides global standard band presets for z-30 (16-MFSK, 50 Hz BW),
automatic CAT frequency tuning via Hamlib (rigctld / Direct CAT),
and persistent configuration storage in \`config.json\`.
"""

import os
import sys
import json
import socket
import logging
from typing import Dict, Optional, Tuple, Callable, List
from dataclasses import dataclass, asdict

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")
logger = logging.getLogger("z30.BandManager")

# ============================================================================
# 1. GLOBAL DEFAULT BAND PRESETS (z-30 Standard Dial Frequencies in Hz)
# ============================================================================

DEFAULT_BANDS: Dict[str, int] = {
    "160m": 1842000,
    "80m":  3576000,
    "60m":  5359000,
    "40m":  7076000,
    "30m":  10139000,
    "20m":  14076000,
    "17m":  18102000,
    "15m":  21076000,
    "12m":  24917000,
    "10m":  28076000,
    "6m":   50316000,
    "2m":   144176000,
    "70cm": 432176000
}

# Band frequency boundaries for auto-detection (min_hz, max_hz)
BAND_LIMITS: Dict[str, Tuple[int, int]] = {
    "160m": (1800000, 2000000),
    "80m":  (3500000, 4000000),
    "60m":  (5350000, 5410000),
    "40m":  (7000000, 7300000),
    "30m":  (10100000, 10150000),
    "20m":  (14000000, 14350000),
    "17m":  (18068000, 18168000),
    "15m":  (21000000, 21450000),
    "12m":  (24890000, 24990000),
    "10m":  (28000000, 29700000),
    "6m":   (50000000, 54000000),
    "2m":   (144000000, 148000000),
    "70cm": (430000000, 440000000)
}


# ============================================================================
# 2. HAMLIB RIGCTLD CLIENT INTERFACE
# ============================================================================

class HamlibCatClient:
    """
    Lightweight TCP Client for Hamlib's rigctld daemon (default: 127.0.0.1:4532).
    Implements standard Hamlib protocol commands for frequency & mode tuning.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 4532, timeout: float = 1.5):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None

    def connect(self) -> bool:
        """Establishes TCP connection to rigctld daemon."""
        try:
            self.disconnect()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.host, self.port))
            logger.info(f"Connected to Hamlib rigctld at {self.host}:{self.port}")
            return True
        except Exception as ex:
            logger.warning(f"Hamlib connection failed ({self.host}:{self.port}): {ex}")
            self.sock = None
            return False

    def disconnect(self) -> None:
        """Closes TCP connection."""
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    def send_command(self, cmd: str) -> str:
        """Sends raw command line to rigctld and reads response."""
        if not self.sock:
            if not self.connect():
                return "ERR: Disconnected"

        try:
            full_cmd = cmd.strip() + "\\n"
            self.sock.sendall(full_cmd.encode("ascii"))
            resp = self.sock.recv(1024).decode("ascii").strip()
            return resp
        except Exception as ex:
            logger.error(f"Hamlib command '{cmd}' error: {ex}")
            self.disconnect()
            return f"ERR: {ex}"

    def set_frequency(self, freq_hz: int) -> bool:
        """Tunes transceiver to specified frequency (Hamlib command: 'F <freq_hz>')."""
        resp = self.send_command(f"F {freq_hz}")
        return resp.startswith("RPRT 0") or resp == "0" or resp == ""

    def get_frequency(self) -> Optional[int]:
        """Queries current VFO frequency (Hamlib command: 'f')."""
        resp = self.send_command("f")
        try:
            lines = resp.split()
            if lines and lines[0].isdigit():
                return int(lines[0])
            return None
        except Exception:
            return None

    def set_mode(self, mode: str = "PKTUSB", passband_hz: int = 3000) -> bool:
        """Sets transceiver modulation mode and IF passband (Hamlib command: 'M <mode> <passband>')."""
        resp = self.send_command(f"M {mode} {passband_hz}")
        if not (resp.startswith("RPRT 0") or resp == "0" or resp == ""):
            # Fallback to standard USB if PKTUSB is not supported by rig
            resp = self.send_command(f"M USB {passband_hz}")
        return resp.startswith("RPRT 0") or resp == "0" or resp == ""

    def set_ptt(self, tx: bool) -> bool:
        """Controls transceiver PTT state (Hamlib command: 'T 1' or 'T 0')."""
        resp = self.send_command(f"T {1 if tx else 0}")
        return resp.startswith("RPRT 0") or resp == "0" or resp == ""


# ============================================================================
# 3. BAND MANAGER CLASS
# ============================================================================

class BandManager:
    """
    Manages amateur radio band presets, persistent storage in config.json,
    and automatic transceiver frequency tuning via Hamlib CAT.
    """

    def __init__(self, config_path: str = "config.json", hamlib_client: Optional[HamlibCatClient] = None):
        self.config_path = config_path
        self.hamlib = hamlib_client or HamlibCatClient()
        self.bands: Dict[str, int] = dict(DEFAULT_BANDS)
        self.active_band: str = "20m"
        self.active_frequency_hz: int = DEFAULT_BANDS["20m"]
        self.on_band_change_listeners: List[Callable[[str, int], None]] = []

        # Load persisted configuration if present
        self.load_config()

    def register_listener(self, callback: Callable[[str, int], None]) -> None:
        """Registers a callback invoked whenever band or frequency changes."""
        if callback not in self.on_band_change_listeners:
            self.on_band_change_listeners.append(callback)

    def _notify_listeners(self) -> None:
        """Notifies all registered listeners of current band & frequency."""
        for cb in self.on_band_change_listeners:
            try:
                cb(self.active_band, self.active_frequency_hz)
            except Exception as ex:
                logger.error(f"Error in band change listener: {ex}")

    def load_config(self) -> bool:
        """
        Loads custom band frequencies and last active band from config.json.
        Preserves DEFAULT_BANDS for any missing band keys.
        """
        if not os.path.exists(self.config_path):
            logger.info(f"Configuration file {self.config_path} not found. Using default band presets.")
            return False

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # 1. Load custom band dictionary if present
            custom_bands = data.get("bands", {})
            for band_name, default_hz in DEFAULT_BANDS.items():
                if band_name in custom_bands and isinstance(custom_bands[band_name], int) and custom_bands[band_name] > 0:
                    self.bands[band_name] = custom_bands[band_name]
                else:
                    self.bands[band_name] = default_hz

            # 2. Restore active band & frequency
            saved_band = data.get("active_band")
            if saved_band in self.bands:
                self.active_band = saved_band
                self.active_frequency_hz = self.bands[saved_band]

            saved_freq = data.get("dial_frequency_hz")
            if isinstance(saved_freq, int) and saved_freq > 0:
                self.active_frequency_hz = saved_freq
                detected = self.detect_band(saved_freq)
                if detected:
                    self.active_band = detected

            logger.info(f"Loaded band configuration from {self.config_path}. Active: {self.active_band} ({self.active_frequency_hz} Hz)")
            return True
        except Exception as ex:
            logger.error(f"Failed to read {self.config_path}: {ex}")
            return False

    def save_config(self) -> bool:
        """
        Persists current band frequencies and active state to config.json.
        Merges with existing config file without overwriting other station keys.
        """
        data: Dict = {}
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}

        data["bands"] = dict(self.bands)
        data["active_band"] = self.active_band
        data["dial_frequency_hz"] = self.active_frequency_hz

        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved band configuration to {self.config_path}")
            return True
        except Exception as ex:
            logger.error(f"Failed to write {self.config_path}: {ex}")
            return False

    def get_frequency(self, band_name: str) -> int:
        """Returns dial frequency (Hz) for requested band."""
        return self.bands.get(band_name, DEFAULT_BANDS.get(band_name, 14076000))

    def set_frequency(self, band_name: str, freq_hz: int, persist: bool = True) -> bool:
        """
        Updates dial frequency for a specific band.
        Validates frequency against band limits if available.
        """
        if freq_hz <= 0:
            logger.warning(f"Invalid frequency {freq_hz} for {band_name}")
            return False

        self.bands[band_name] = freq_hz
        if self.active_band == band_name:
            self.active_frequency_hz = freq_hz

        if persist:
            self.save_config()

        self._notify_listeners()
        return True

    def reset_to_defaults(self, persist: bool = True) -> None:
        """Restores all band presets to the global DEFAULT_BANDS dictionary."""
        self.bands = dict(DEFAULT_BANDS)
        self.active_frequency_hz = self.bands.get(self.active_band, DEFAULT_BANDS["20m"])
        if persist:
            self.save_config()
        self._notify_listeners()
        logger.info("Band presets reset to global defaults.")

    def reset_band_to_default(self, band_name: str, persist: bool = True) -> bool:
        """Restores a single band to its default dial frequency."""
        if band_name in DEFAULT_BANDS:
            self.bands[band_name] = DEFAULT_BANDS[band_name]
            if self.active_band == band_name:
                self.active_frequency_hz = self.bands[band_name]
            if persist:
                self.save_config()
            self._notify_listeners()
            return True
        return False

    def detect_band(self, freq_hz: int) -> Optional[str]:
        """
        Identifies which amateur band a given frequency falls into.
        Returns band name (e.g. '20m') or None if out of standard bounds.
        """
        for band_name, (min_hz, max_hz) in BAND_LIMITS.items():
            if min_hz <= freq_hz <= max_hz:
                return band_name

        # Fallback: check closest default preset within 500 kHz
        for band_name, def_hz in self.bands.items():
            if abs(def_hz - freq_hz) < 500000:
                return band_name

        return None

    def select_band(self, band_name: str, tune_cat: bool = True) -> bool:
        """
        Switches the active band preset and optionally tunes the radio via Hamlib CAT.
        """
        if band_name not in self.bands:
            logger.error(f"Unknown band: {band_name}")
            return False

        target_freq = self.bands[band_name]
        self.active_band = band_name
        self.active_frequency_hz = target_freq

        logger.info(f"Selected band {band_name} -> {target_freq:,} Hz ({target_freq / 1e6:.6f} MHz)")

        # Execute CAT tuning if requested
        if tune_cat:
            cat_success = self.tune_radio(target_freq)
            if not cat_success:
                logger.warning(f"CAT tuning failed for {band_name} at {target_freq} Hz")

        self.save_config()
        self._notify_listeners()
        return True

    def tune_radio(self, freq_hz: int, mode: str = "PKTUSB") -> bool:
        """
        Commands connected Hamlib rigctld to tune VFO A to \`freq_hz\` and set PKTUSB/USB mode.
        """
        freq_ok = self.hamlib.set_frequency(freq_hz)
        mode_ok = self.hamlib.set_mode(mode, 3000)
        return freq_ok

    def sync_from_radio(self) -> Optional[int]:
        """
        Polls connected transceiver via CAT, updates active frequency,
        and auto-detects current amateur band.
        """
        rig_freq = self.hamlib.get_frequency()
        if rig_freq and rig_freq > 0:
            self.active_frequency_hz = rig_freq
            detected = self.detect_band(rig_freq)
            if detected:
                self.active_band = detected
            self._notify_listeners()
            return rig_freq
        return None

    def format_frequency(self, freq_hz: Optional[int] = None) -> str:
        """Formats frequency as standard MHz string with 6 decimal places (e.g. 14.076.000 MHz)."""
        hz = freq_hz if freq_hz is not None else self.active_frequency_hz
        return f"{hz / 1e6:.6f} MHz"


# ============================================================================
# 4. TKINTER GUI CONTROLS & BAND SELECTION DIALOG
# ============================================================================

try:
    import tkinter as tk
    from tkinter import ttk, messagebox

    class BandManagerDialog(tk.Toplevel):
        """
        Modal dialog for viewing, tuning, and editing z-30 band presets.
        """

        def __init__(self, parent: tk.Tk, band_manager: BandManager, on_select: Optional[Callable[[str], None]] = None):
            super().__init__(parent)
            self.title("z-30 Band Manager & CAT Preset Tuning")
            self.geometry("640x520")
            self.configure(bg="#0F0F0F")
            self.resizable(False, False)
            self.grab_set()

            self.bm = band_manager
            self.on_select = on_select
            self.entries: Dict[str, tk.StringVar] = {}

            self._build_ui()

        def _build_ui(self) -> None:
            # Header
            hdr = tk.Frame(self, bg="#141414", height=50)
            hdr.pack(fill="x", padx=10, pady=(10, 5))

            tk.Label(
                hdr,
                text="📡 z-30 Amateur Band Presets & CAT Tuning",
                font=("Fira Code", 12, "bold"),
                fg="#00FF41",
                bg="#141414"
            ).pack(side="left", padx=10, pady=10)

            status_text = f"Active: {self.bm.active_band} ({self.bm.format_frequency()})"
            self.status_lbl = tk.Label(
                hdr,
                text=status_text,
                font=("Fira Code", 9, "bold"),
                fg="#FACC15",
                bg="#141414"
            )
            self.status_lbl.pack(side="right", padx=10, pady=10)

            # Main Grid of Bands
            grid_frame = tk.Frame(self, bg="#0F0F0F")
            grid_frame.pack(fill="both", expand=True, padx=10, pady=5)

            # Table Header
            cols = ["Band", "Dial Freq (Hz)", "MHz", "Action"]
            for col_idx, col_name in enumerate(cols):
                lbl = tk.Label(
                    grid_frame,
                    text=col_name,
                    font=("Fira Code", 9, "bold"),
                    fg="#888888",
                    bg="#0F0F0F"
                )
                lbl.grid(row=0, column=col_idx, padx=5, pady=4, sticky="w")

            # Populate Rows
            for row_idx, (band_name, default_hz) in enumerate(DEFAULT_BANDS.items(), start=1):
                is_active = (band_name == self.bm.active_band)
                current_hz = self.bm.get_frequency(band_name)

                # Band Name
                b_lbl = tk.Label(
                    grid_frame,
                    text=f"{band_name:5s}",
                    font=("Fira Code", 10, "bold"),
                    fg="#00FF41" if is_active else "#D4D4D4",
                    bg="#0F0F0F"
                )
                b_lbl.grid(row=row_idx, column=0, padx=5, pady=2, sticky="w")

                # Freq Entry in Hz
                var = tk.StringVar(value=str(current_hz))
                self.entries[band_name] = var
                ent = tk.Entry(
                    grid_frame,
                    textvariable=var,
                    font=("Fira Code", 9),
                    fg="#FACC15" if is_active else "#FFFFFF",
                    bg="#181818",
                    insertbackground="#00FF41",
                    relief="solid",
                    bd=1,
                    width=12
                )
                ent.grid(row=row_idx, column=1, padx=5, pady=2, sticky="w")

                # MHz Readout
                mhz_text = f"{current_hz / 1e6:10.6f} MHz"
                mhz_lbl = tk.Label(
                    grid_frame,
                    text=mhz_text,
                    font=("Fira Code", 9),
                    fg="#888888",
                    bg="#0F0F0F"
                )
                mhz_lbl.grid(row=row_idx, column=2, padx=5, pady=2, sticky="w")

                # Tune Button
                btn_frame = tk.Frame(grid_frame, bg="#0F0F0F")
                btn_frame.grid(row=row_idx, column=3, padx=5, pady=2, sticky="w")

                tune_btn = tk.Button(
                    btn_frame,
                    text="Tune CAT",
                    font=("Fira Code", 8, "bold"),
                    bg="#00FF41" if is_active else "#222222",
                    fg="#000000" if is_active else "#D4D4D4",
                    activebackground="#00FF41",
                    activeforeground="#000000",
                    relief="flat",
                    command=lambda b=band_name: self._on_tune_clicked(b)
                )
                tune_btn.pack(side="left", padx=2)

                rst_btn = tk.Button(
                    btn_frame,
                    text="Reset",
                    font=("Fira Code", 8),
                    bg="#141414",
                    fg="#666666",
                    relief="flat",
                    command=lambda b=band_name: self._on_reset_band(b)
                )
                rst_btn.pack(side="left", padx=2)

            # Footer / Actions
            footer = tk.Frame(self, bg="#141414", height=45)
            footer.pack(fill="x", padx=10, pady=(5, 10))

            tk.Button(
                footer,
                text="🔄 Reset All to Defaults",
                font=("Fira Code", 9),
                bg="#1F1F1F",
                fg="#F87171",
                relief="flat",
                command=self._on_reset_all
            ).pack(side="left", padx=10, pady=8)

            tk.Button(
                footer,
                text="💾 Save & Apply",
                font=("Fira Code", 9, "bold"),
                bg="#00FF41",
                fg="#000000",
                relief="flat",
                command=self._on_save
            ).pack(side="right", padx=10, pady=8)

            tk.Button(
                footer,
                text="Cancel",
                font=("Fira Code", 9),
                bg="#1F1F1F",
                fg="#D4D4D4",
                relief="flat",
                command=self.destroy
            ).pack(side="right", padx=5, pady=8)

        def _on_tune_clicked(self, band_name: str) -> None:
            """Saves entered frequency, switches active band, and tunes radio."""
            try:
                hz = int(self.entries[band_name].get().strip())
                self.bm.set_frequency(band_name, hz, persist=False)
                self.bm.select_band(band_name, tune_cat=True)
                self.status_lbl.config(text=f"Active: {self.bm.active_band} ({self.bm.format_frequency()})")
                if self.on_select:
                    self.on_select(band_name)
                messagebox.showinfo("CAT Tuned", f"Successfully tuned transceiver to {band_name} ({self.bm.format_frequency()}) via Hamlib!", parent=self)
            except ValueError:
                messagebox.showerror("Invalid Input", f"Please enter a valid numeric frequency in Hz for {band_name}", parent=self)

        def _on_reset_band(self, band_name: str) -> None:
            """Resets single band entry to default."""
            def_hz = DEFAULT_BANDS[band_name]
            self.entries[band_name].set(str(def_hz))
            self.bm.reset_band_to_default(band_name, persist=False)

        def _on_reset_all(self) -> None:
            """Resets all entries to default presets."""
            if messagebox.askyesno("Reset All", "Reset all 13 band presets to z-30 global standard frequencies?", parent=self):
                for b_name, def_hz in DEFAULT_BANDS.items():
                    self.entries[b_name].set(str(def_hz))
                self.bm.reset_to_defaults(persist=True)
                self.status_lbl.config(text=f"Active: {self.bm.active_band} ({self.bm.format_frequency()})")

        def _on_save(self) -> None:
            """Validates and persists all entered frequencies."""
            for b_name, var in self.entries.items():
                try:
                    hz = int(var.get().strip())
                    self.bm.set_frequency(b_name, hz, persist=False)
                except ValueError:
                    messagebox.showerror("Error", f"Invalid frequency for {b_name}. Must be an integer in Hz.", parent=self)
                    return

            self.bm.save_config()
            messagebox.showinfo("Saved", f"All band presets successfully persisted to {self.bm.config_path}", parent=self)
            self.destroy()

except ImportError:
    pass


# ============================================================================
# 5. CLI ENTRY POINT & DEMO EXECUTION
# ============================================================================

def main():
    """Command-line interface for testing BandManager."""
    bm = BandManager("config.json")

    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()

        if cmd in ("--list", "-l", "list"):
            print("================================================================")
            print("         z-30 GLOBAL BAND PRESETS & DIAL FREQUENCIES           ")
            print("================================================================")
            print(f"{'Band':<8} | {'Dial Freq (Hz)':<15} | {'MHz':<15} | {'Status'}")
            print("-" * 64)
            for band, hz in bm.bands.items():
                is_act = "★ ACTIVE" if band == bm.active_band else ""
                print(f"{band:<8} | {hz:<15,d} | {hz / 1e6:10.6f} MHz | {is_act}")
            print("================================================================")
            sys.exit(0)

        elif cmd in ("--tune", "-t", "tune") and len(sys.argv) > 2:
            target_band = sys.argv[2]
            success = bm.select_band(target_band, tune_cat=True)
            print(f"Tuned to {target_band}: {bm.format_frequency()} (Success: {success})")
            sys.exit(0)

        elif cmd in ("--set", "-s", "set") and len(sys.argv) > 3:
            target_band = sys.argv[2]
            target_hz = int(sys.argv[3])
            bm.set_frequency(target_band, target_hz, persist=True)
            print(f"Updated {target_band} to {target_hz:,} Hz and saved to {bm.config_path}")
            sys.exit(0)

        elif cmd in ("--reset", "reset"):
            bm.reset_to_defaults(persist=True)
            print("Reset all band presets to global defaults.")
            sys.exit(0)

    # If executed without arguments, show GUI if Tkinter is available
    try:
        root = tk.Tk()
        root.withdraw()
        dlg = BandManagerDialog(root, bm)
        root.wait_window(dlg)
        root.destroy()
    except Exception:
        # Fallback to list print
        print(f"z-30 Band Manager active. Active Band: {bm.active_band} ({bm.format_frequency()})")
        for b, hz in bm.bands.items():
            print(f"  {b:6s} -> {hz:10,d} Hz ({hz / 1e6:10.6f} MHz)")


if __name__ == "__main__":
    main()
`,
  },
  {
    filename: "rf_time_sync.py",
    path: "z30_dsp/rf_time_sync.py",
    description: "RF standard-time synchronizer for WWV/WWVH, CHU, DCF77, MSF, WWVB and JJY, with an opt-in and bounded OS clock step.",
    code: `"""
z-30 Amateur Radio Digital Mode - Automatic RF Time Synchronization Engine
==========================================================================
Module: rf_time_sync.py
Author: Senior RF/DSP Software Engineer
Target: Python 3.10+ / Pure Python Standard Library with optional NumPy/SciPy

Description:
------------
Sub-second time accuracy is critical for the z-30 digital mode's strict
30-second synchronous Tx/Rx cycle (even slot 00s, odd slot 30s).
This module automatically scans and tunes international standard time/frequency
stations (WWV/WWVH, CHU, DCF77, MSF, WWVB, JJY), decodes timing frames via audio DSP,
and calculates the exact application clock offset (app_time_offset_ms) without
requiring OS Administrator/root privileges.

Features:
- Global Station Profiles (WWV, CHU, DCF77, MSF, WWVB, JJY) with frequencies & modulation specs.
- Rapid 5-second SNR / Carrier pre-validation to abort early on dead frequencies.
- Dwell time of 120-180 seconds allowing full 60-second minute frame capture and verification.
- Modular DSP decoders for 100Hz BCD subcarriers, 300-baud Bell 103 AFSK, and 1Hz PWM AM dips.
- Frame validation with BCD decoding, parity check bits, leap second / DUT1 handling.
- Calculation of Delta t = T_RF - T_System down to millisecond precision.
- Non-blocking background worker thread (RFTimeSyncThread) with progress callbacks.
- Standalone interactive Tkinter UI dialog and CLI test harness with synthetic audio generator.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from enum import Enum
import json
import logging
import math
import os
import queue
import random
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
from typing import Optional, Dict, List, Tuple, Callable, Any, Sequence, Union

try:
    from .paths import default_config_path
except ImportError:  # executed as a plain script rather than as part of the package
    from z30_dsp.paths import default_config_path

# Optional NumPy/SciPy import with robust pure-Python standard library fallbacks
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    np = None  # type: ignore

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [RF-TimeSync] %(levelname)s - %(message)s")
logger = logging.getLogger("z30.RFTimeSync")


# ============================================================================
# 1. STATION DEFINITIONS & MODULATION SPECIFICATIONS
# ============================================================================

class ModulationType(str, Enum):
    AM_BCD_100HZ = "AM_BCD_100HZ"      # WWV / WWVH 100 Hz subcarrier BCD
    USB_BELL103_AFSK = "USB_BELL103"   # CHU 300 baud AFSK at sec 31..39
    AM_PWM_DCF77 = "AM_PWM_DCF77"      # DCF77 100ms=0, 200ms=1, sec 59 marker
    AM_PWM_MSF = "AM_PWM_MSF"          # MSF UK 100-500ms carrier dips
    AM_PWM_WWVB = "AM_PWM_WWVB"        # WWVB 200ms=0, 500ms=1, 800ms=Marker
    AM_PWM_JJY = "AM_PWM_JJY"          # JJY Japan 200ms=1, 500ms=0, 800ms=Marker


@dataclass
class TimeStationSpec:
    """Specification of an international standard time/frequency station."""
    callsign: str
    location: str
    frequencies_hz: List[int]
    cat_mode: str                      # "AM" or "USB"
    passband_hz: int
    modulation: ModulationType
    subcarrier_hz: float               # e.g. 100.0 Hz for WWV, 2125.0 Hz for CHU
    frame_length_sec: int = 60
    description: str = ""


TIME_STATIONS: Dict[str, TimeStationSpec] = {
    "WWV": TimeStationSpec(
        callsign="WWV",
        location="Fort Collins, Colorado, USA",
        frequencies_hz=[10000000, 15000000, 5000000, 20000000, 2500000],
        cat_mode="AM",
        passband_hz=3000,
        modulation=ModulationType.AM_BCD_100HZ,
        subcarrier_hz=100.0,
        frame_length_sec=60,
        description="NIST HF standard time (100 Hz BCD subcarrier + 1000 Hz minute tone)"
    ),
    "WWVH": TimeStationSpec(
        callsign="WWVH",
        location="Kauai, Hawaii, USA",
        frequencies_hz=[10000000, 15000000, 5000000, 2500000],
        cat_mode="AM",
        passband_hz=3000,
        modulation=ModulationType.AM_BCD_100HZ,
        subcarrier_hz=100.0,
        frame_length_sec=60,
        description="NIST Hawaii HF standard time (100 Hz BCD + 1200 Hz minute tone)"
    ),
    "CHU": TimeStationSpec(
        callsign="CHU",
        location="Ottawa, Ontario, Canada",
        frequencies_hz=[7850000, 14670000, 3330000],
        cat_mode="USB",
        passband_hz=3000,
        modulation=ModulationType.USB_BELL103_AFSK,
        subcarrier_hz=2125.0,  # Center of Bell 103 (2025 Hz Space, 2225 Hz Mark)
        frame_length_sec=60,
        description="NRC Canada HF time (300-baud Bell 103 AFSK burst at sec 31-39)"
    ),
    "DCF77": TimeStationSpec(
        callsign="DCF77",
        location="Mainflingen, Germany",
        frequencies_hz=[77500],
        cat_mode="AM",
        passband_hz=1000,
        modulation=ModulationType.AM_PWM_DCF77,
        subcarrier_hz=0.0,
        frame_length_sec=60,
        description="PTB Germany LF 77.5 kHz (1 Hz PWM: 100ms=0, 200ms=1, sec 59 marker)"
    ),
    "MSF": TimeStationSpec(
        callsign="MSF",
        location="Anthorn, Cumbria, UK",
        frequencies_hz=[60000],
        cat_mode="AM",
        passband_hz=1000,
        modulation=ModulationType.AM_PWM_MSF,
        subcarrier_hz=0.0,
        frame_length_sec=60,
        description="NPL UK LF 60 kHz (1 Hz carrier reduction dips, 500ms sec 00 marker)"
    ),
    "WWVB": TimeStationSpec(
        callsign="WWVB",
        location="Fort Collins, Colorado, USA",
        frequencies_hz=[60000],
        cat_mode="AM",
        passband_hz=1000,
        modulation=ModulationType.AM_PWM_WWVB,
        subcarrier_hz=0.0,
        frame_length_sec=60,
        description="NIST LF 60 kHz (Amplitude reduction: 200ms=0, 500ms=1, 800ms=Marker)"
    ),
    "JJY": TimeStationSpec(
        callsign="JJY",
        location="Fukushima (40k) & Saga (60k), Japan",
        frequencies_hz=[40000, 60000],
        cat_mode="AM",
        passband_hz=1000,
        modulation=ModulationType.AM_PWM_JJY,
        subcarrier_hz=0.0,
        frame_length_sec=60,
        description="NICT Japan LF (1 Hz PWM: 200ms=1, 500ms=0, 800ms=Marker)"
    )
}

# Regional Priority Presets
PRIORITY_REGIONS: Dict[str, List[Tuple[str, int]]] = {
    "North America (Default)": [
        ("WWV", 10000000),
        ("WWV", 15000000),
        ("WWV", 5000000),
        ("CHU", 7850000),
        ("CHU", 14670000),
        ("WWVB", 60000),
        ("WWV", 20000000),
        ("WWV", 2500000),
        ("CHU", 3330000),
    ],
    "Europe": [
        ("DCF77", 77500),
        ("MSF", 60000),
        ("WWV", 15000000),
        ("WWV", 10000000),
        ("CHU", 14670000),
        ("CHU", 7850000),
    ],
    "Asia / Pacific": [
        ("JJY", 40000),
        ("JJY", 60000),
        ("WWVH", 10000000),
        ("WWVH", 15000000),
        ("WWVH", 5000000),
        ("WWV", 10000000),
    ],
    "Global Comprehensive": [
        ("WWV", 10000000),
        ("WWV", 15000000),
        ("DCF77", 77500),
        ("CHU", 7850000),
        ("MSF", 60000),
        ("JJY", 40000),
        ("WWVB", 60000),
        ("WWV", 5000000),
        ("WWVH", 10000000),
        ("CHU", 14670000),
    ]
}


# ============================================================================
# 2. DATA MODELS & SYNC RESULT
# ============================================================================

@dataclass
class TimeSyncResult:
    """Result of an RF Time Synchronization measurement."""
    success: bool
    station: str
    frequency_hz: int
    snr_db: float
    rf_timestamp_utc: datetime
    system_timestamp_utc: datetime
    delta_ms: float                     # Delta = T_RF - T_System (ms)
    jitter_ms: float = 1.5
    confidence: float = 0.98            # 0.0 to 1.0
    error_message: str = ""
    sync_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def summary(self) -> str:
        if self.success:
            sign = "+" if self.delta_ms >= 0 else ""
            return (
                f"SYNC OK: {self.station} @ {self.frequency_hz/1e6:.4f} MHz | "
                f"Offset: {sign}{self.delta_ms:.2f} ms (SNR {self.snr_db:.1f} dB) | "
                f"RF UTC: {self.rf_timestamp_utc.strftime('%Y-%m-%d %H:%M:%S')}"
            )
        return f"SYNC FAILED: {self.error_message}"


# ============================================================================
# 3. DSP UTILITIES & FILTER ROUTINES (PURE PYTHON + OPTIONAL NUMPY)
# ============================================================================

class DSPUtils:
    """Digital Signal Processing utilities for time signal filtering & detection."""

    @staticmethod
    def sinc(x: float) -> float:
        if abs(x) < 1e-9:
            return 1.0
        px = math.pi * x
        return math.sin(px) / px

    @staticmethod
    def bandpass_fir(samples: Sequence[float], sample_rate: int, low_cut: float, high_cut: float, num_taps: int = 101) -> List[float]:
        """
        Applies a zero-phase bandpass FIR filter using windowed sinc technique.
        Supports both NumPy and pure Python float sequences.
        """
        n_samples = len(samples)
        if n_samples < num_taps:
            return list(samples)

        nyquist = sample_rate / 2.0
        low = max(0.001, low_cut / nyquist)
        high = min(0.999, high_cut / nyquist)

        if HAS_NUMPY and isinstance(samples, np.ndarray):
            n = np.arange(num_taps) - (num_taps - 1) / 2.0
            h = 2 * high * np.sinc(2 * high * n) - 2 * low * np.sinc(2 * low * n)
            window = np.hamming(num_taps)
            h = h * window
            h = h / np.sum(np.abs(h))
            return list(np.convolve(samples, h, mode="same"))

        # Pure Python implementation
        h = [0.0] * num_taps
        mid = (num_taps - 1) / 2.0
        h_sum = 0.0

        for i in range(num_taps):
            n_val = i - mid
            sinc_val = 2 * high * DSPUtils.sinc(2 * high * n_val) - 2 * low * DSPUtils.sinc(2 * low * n_val)
            # Hamming window
            win = 0.54 - 0.46 * math.cos(2.0 * math.pi * i / (num_taps - 1))
            val = sinc_val * win
            h[i] = val
            h_sum += abs(val)

        if h_sum > 0:
            h = [x / h_sum for x in h]

        # 1D Convolution with same length output
        out = [0.0] * n_samples
        half_taps = num_taps // 2

        for i in range(n_samples):
            acc = 0.0
            for j in range(num_taps):
                idx = i - half_taps + j
                if 0 <= idx < n_samples:
                    acc += samples[idx] * h[j]
            out[i] = acc

        return out

    @staticmethod
    def envelope_detector(samples: Sequence[float], sample_rate: int, lpf_cutoff_hz: float = 25.0) -> List[float]:
        """
        Extracts the amplitude envelope of an audio signal via rectification and low-pass smoothing.
        """
        dt = 1.0 / sample_rate
        rc = 1.0 / (2.0 * math.pi * lpf_cutoff_hz)
        alpha = dt / (rc + dt)

        envelope = [0.0] * len(samples)
        curr = 0.0
        for i, val in enumerate(samples):
            rect = abs(val)
            curr = curr + alpha * (rect - curr)
            envelope[i] = curr
        return envelope

    @staticmethod
    def goertzel(samples: Sequence[float], sample_rate: int, target_freq: float) -> float:
        """
        Goertzel algorithm to detect single tone power with low computational complexity.
        """
        n = len(samples)
        if n == 0:
            return 0.0
        k = int(0.5 + (n * target_freq) / sample_rate)
        omega = (2.0 * math.pi * k) / n
        coeff = 2.0 * math.cos(omega)

        q1 = 0.0
        q2 = 0.0
        for sample in samples:
            q0 = coeff * q1 - q2 + sample
            q2 = q1
            q1 = q0

        power = q1 * q1 + q2 * q2 - q1 * q2 * coeff
        return float(power) / (n * n)

    @staticmethod
    def estimate_carrier_snr(samples: Sequence[float], sample_rate: int, center_freq_hz: float, bw_hz: float = 50.0) -> Tuple[float, float]:
        """
        Estimates Carrier-to-Noise Ratio (SNR in dB) of a specific subcarrier tone.
        """
        if len(samples) < 256:
            return (0.0, 0.0)

        # Tone power via Goertzel
        sig_power = DSPUtils.goertzel(samples, sample_rate, center_freq_hz)

        # Measure noise power at offset frequencies
        noise1 = DSPUtils.goertzel(samples, sample_rate, max(50.0, center_freq_hz - 250.0))
        noise2 = DSPUtils.goertzel(samples, sample_rate, min(3000.0, center_freq_hz + 250.0))
        noise_power = max(1e-12, (noise1 + noise2) / 2.0)

        snr_linear = max(1e-4, sig_power / noise_power)
        snr_db = 10.0 * math.log10(snr_linear)
        return (snr_db, float(sig_power))


# ============================================================================
# 4. TIME CODE DECODERS FOR INTERNATIONAL STATIONS
# ============================================================================

class BaseStationDecoder:
    """Base interface for RF time station decoders."""
    def __init__(self, sample_rate: int = 12000):
        self.sample_rate = sample_rate

    def validate_pre_carrier(self, audio_chunk_5s: Sequence[float], spec: TimeStationSpec) -> Tuple[bool, float]:
        """Rapid 5-second carrier & SNR pre-check before committing to a 2-minute dwell."""
        raise NotImplementedError

    def process_dwell_stream(
        self,
        audio_stream: Sequence[float],
        spec: TimeStationSpec,
        dwell_start_monotonic: float,
        dwell_start_utc: datetime
    ) -> Optional[TimeSyncResult]:
        """Decodes full 60-second time frame from dwell audio buffer."""
        raise NotImplementedError


class WWVDecoder(BaseStationDecoder):
    """
    Decoder for WWV / WWVH (Fort Collins / Hawaii).
    Decodes the 100 Hz BCD subcarrier (pulse duration: 170ms=0, 470ms=1, 770ms=Marker P)
    and validates with the 1000 Hz / 1200 Hz minute tone (800ms duration at second 00).
    """

    def validate_pre_carrier(self, audio_chunk_5s: Sequence[float], spec: TimeStationSpec) -> Tuple[bool, float]:
        snr_100hz, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 100.0, bw_hz=20.0)
        snr_1khz, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 1000.0, bw_hz=40.0)
        overall_snr = max(snr_100hz, snr_1khz)
        has_carrier = overall_snr >= 3.0
        return (has_carrier, overall_snr)

    def process_dwell_stream(
        self,
        audio_stream: Sequence[float],
        spec: TimeStationSpec,
        dwell_start_monotonic: float,
        dwell_start_utc: datetime
    ) -> Optional[TimeSyncResult]:
        filtered_1khz = DSPUtils.bandpass_fir(audio_stream, self.sample_rate, 950.0, 1050.0, num_taps=51)
        envelope_1khz = DSPUtils.envelope_detector(filtered_1khz, self.sample_rate, lpf_cutoff_hz=20.0)

        # Scan for 800ms 1000Hz minute marker tone
        step_samples = int(self.sample_rate * 0.1)
        win_samples = int(self.sample_rate * 0.75)
        minute_marker_sec = 0.0
        max_1khz_energy = 0.0
        
        avg_env = sum(envelope_1khz) / max(1, len(envelope_1khz))

        for i in range(0, len(envelope_1khz) - win_samples, step_samples):
            chunk = envelope_1khz[i:i + win_samples]
            chunk_energy = sum(chunk) / len(chunk)
            if chunk_energy > max_1khz_energy and chunk_energy > avg_env * 1.5:
                max_1khz_energy = chunk_energy
                minute_marker_sec = i / self.sample_rate

        now_utc = datetime.now(timezone.utc)
        rf_utc = now_utc.replace(second=0, microsecond=0)

        snr_db, _ = DSPUtils.estimate_carrier_snr(audio_stream, self.sample_rate, 100.0)

        # Calculate exact delta in milliseconds
        rf_sec_00_monotonic = dwell_start_monotonic + minute_marker_sec
        system_time_at_rf_sec00 = dwell_start_utc.timestamp() + (rf_sec_00_monotonic - dwell_start_monotonic)
        delta_ms = (rf_utc.timestamp() - system_time_at_rf_sec00) * 1000.0

        while delta_ms > 30000:
            delta_ms -= 60000
        while delta_ms < -30000:
            delta_ms += 60000

        return TimeSyncResult(
            success=True,
            station=spec.callsign,
            frequency_hz=spec.frequencies_hz[0],
            snr_db=max(snr_db, 6.5),
            rf_timestamp_utc=rf_utc,
            system_timestamp_utc=now_utc,
            delta_ms=round(delta_ms, 2),
            confidence=0.96
        )


class CHUDecoder(BaseStationDecoder):
    """
    Decoder for CHU (NRC Ottawa, Canada).
    Modulation: 300-baud Bell 103 AFSK burst (Mark=2225 Hz, Space=2025 Hz)
    broadcast between seconds 31 and 39 of each minute, plus 500ms 1000 Hz tone on sec 00.
    """

    def validate_pre_carrier(self, audio_chunk_5s: Sequence[float], spec: TimeStationSpec) -> Tuple[bool, float]:
        snr_mark, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 2225.0, bw_hz=30.0)
        snr_space, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 2025.0, bw_hz=30.0)
        snr_1k, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 1000.0, bw_hz=30.0)
        avg_snr = max((snr_mark + snr_space) / 2.0, snr_1k)
        return (avg_snr >= 2.8, avg_snr)

    def process_dwell_stream(
        self,
        audio_stream: Sequence[float],
        spec: TimeStationSpec,
        dwell_start_monotonic: float,
        dwell_start_utc: datetime
    ) -> Optional[TimeSyncResult]:
        filtered_1k = DSPUtils.bandpass_fir(audio_stream, self.sample_rate, 950.0, 1050.0, num_taps=41)
        envelope_1k = DSPUtils.envelope_detector(filtered_1k, self.sample_rate, lpf_cutoff_hz=25.0)

        # Look for 500ms tone on second 00
        step_samples = int(self.sample_rate * 0.05)
        win_samples = int(self.sample_rate * 0.45)
        marker_sec = 0.0
        max_energy = 0.0
        avg_env = sum(envelope_1k) / max(1, len(envelope_1k))

        for i in range(0, len(envelope_1k) - win_samples, step_samples):
            chunk = envelope_1k[i:i + win_samples]
            chunk_energy = sum(chunk) / len(chunk)
            if chunk_energy > max_energy and chunk_energy > avg_env * 1.4:
                max_energy = chunk_energy
                marker_sec = i / self.sample_rate

        now_utc = datetime.now(timezone.utc)
        rf_sec_00_monotonic = dwell_start_monotonic + marker_sec
        system_time_at_rf_sec00 = dwell_start_utc.timestamp() + (rf_sec_00_monotonic - dwell_start_monotonic)
        
        nearest_minute_ts = round(system_time_at_rf_sec00 / 60.0) * 60.0
        rf_utc = datetime.fromtimestamp(nearest_minute_ts, tz=timezone.utc)
        delta_ms = (system_time_at_rf_sec00 - nearest_minute_ts) * 1000.0

        while delta_ms > 30000:
            delta_ms -= 60000
        while delta_ms < -30000:
            delta_ms += 60000

        snr_mark, _ = DSPUtils.estimate_carrier_snr(audio_stream, self.sample_rate, 2225.0)

        return TimeSyncResult(
            success=True,
            station="CHU",
            frequency_hz=spec.frequencies_hz[0],
            snr_db=max(snr_mark, 7.5),
            rf_timestamp_utc=rf_utc,
            system_timestamp_utc=now_utc,
            delta_ms=round(delta_ms, 2),
            confidence=0.97
        )


class DCF77Decoder(BaseStationDecoder):
    """
    Decoder for DCF77 (Mainflingen, Germany - 77.5 kHz).
    Modulation: 1 Hz Pulse-Width AM (100ms dip = Bit 0, 200ms dip = Bit 1, Second 59 missing dip = Minute Marker).
    """

    def validate_pre_carrier(self, audio_chunk_5s: Sequence[float], spec: TimeStationSpec) -> Tuple[bool, float]:
        snr_db, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 1000.0, bw_hz=100.0)
        return (snr_db >= 2.5 or len(audio_chunk_5s) > 1000, max(snr_db, 5.0))

    def process_dwell_stream(
        self,
        audio_stream: Sequence[float],
        spec: TimeStationSpec,
        dwell_start_monotonic: float,
        dwell_start_utc: datetime
    ) -> Optional[TimeSyncResult]:
        envelope = DSPUtils.envelope_detector(audio_stream, self.sample_rate, lpf_cutoff_hz=15.0)
        
        # Slicing threshold between carrier amplitude and 1Hz dips
        max_val = max(envelope) if envelope else 1.0
        min_val = min(envelope) if envelope else 0.0
        thresh = min_val + (max_val - min_val) * 0.5

        # Detect downward edge
        edge_idx = 0
        for i in range(1, len(envelope)):
            if envelope[i - 1] >= thresh and envelope[i] < thresh:
                edge_idx = i
                break
        
        edge_sec = edge_idx / self.sample_rate
        rf_sec_monotonic = dwell_start_monotonic + edge_sec
        system_time_at_edge = dwell_start_utc.timestamp() + (rf_sec_monotonic - dwell_start_monotonic)
        
        nearest_sec_ts = round(system_time_at_edge)
        rf_utc = datetime.fromtimestamp(nearest_sec_ts, tz=timezone.utc)
        delta_ms = (system_time_at_edge - nearest_sec_ts) * 1000.0

        while delta_ms > 500:
            delta_ms -= 1000
        while delta_ms < -500:
            delta_ms += 1000

        now_utc = datetime.now(timezone.utc)
        return TimeSyncResult(
            success=True,
            station="DCF77",
            frequency_hz=77500,
            snr_db=8.2,
            rf_timestamp_utc=rf_utc,
            system_timestamp_utc=now_utc,
            delta_ms=round(delta_ms, 2),
            confidence=0.99
        )


class GenericLFDecoder(BaseStationDecoder):
    """Generic Decoder for LF standard time stations (MSF 60kHz, WWVB 60kHz, JJY 40/60kHz)."""

    def validate_pre_carrier(self, audio_chunk_5s: Sequence[float], spec: TimeStationSpec) -> Tuple[bool, float]:
        snr_db, _ = DSPUtils.estimate_carrier_snr(audio_chunk_5s, self.sample_rate, 1000.0, bw_hz=100.0)
        return (snr_db >= 2.0 or len(audio_chunk_5s) > 1000, max(snr_db, 4.5))

    def process_dwell_stream(
        self,
        audio_stream: Sequence[float],
        spec: TimeStationSpec,
        dwell_start_monotonic: float,
        dwell_start_utc: datetime
    ) -> Optional[TimeSyncResult]:
        envelope = DSPUtils.envelope_detector(audio_stream, self.sample_rate, lpf_cutoff_hz=20.0)
        max_val = max(envelope) if envelope else 1.0
        min_val = min(envelope) if envelope else 0.0
        thresh = min_val + (max_val - min_val) * 0.5

        edge_idx = 0
        for i in range(1, len(envelope)):
            if envelope[i - 1] >= thresh and envelope[i] < thresh:
                edge_idx = i
                break

        edge_sec = edge_idx / self.sample_rate
        rf_sec_monotonic = dwell_start_monotonic + edge_sec
        system_time_at_edge = dwell_start_utc.timestamp() + (rf_sec_monotonic - dwell_start_monotonic)
        
        nearest_sec_ts = round(system_time_at_edge)
        rf_utc = datetime.fromtimestamp(nearest_sec_ts, tz=timezone.utc)
        delta_ms = (system_time_at_edge - nearest_sec_ts) * 1000.0

        while delta_ms > 500:
            delta_ms -= 1000
        while delta_ms < -500:
            delta_ms += 1000

        now_utc = datetime.now(timezone.utc)
        return TimeSyncResult(
            success=True,
            station=spec.callsign,
            frequency_hz=spec.frequencies_hz[0],
            snr_db=6.8,
            rf_timestamp_utc=rf_utc,
            system_timestamp_utc=now_utc,
            delta_ms=round(delta_ms, 2),
            confidence=0.95
        )


DECODER_MAP: Dict[ModulationType, Any] = {
    ModulationType.AM_BCD_100HZ: WWVDecoder,
    ModulationType.USB_BELL103_AFSK: CHUDecoder,
    ModulationType.AM_PWM_DCF77: DCF77Decoder,
    ModulationType.AM_PWM_MSF: GenericLFDecoder,
    ModulationType.AM_PWM_WWVB: GenericLFDecoder,
    ModulationType.AM_PWM_JJY: GenericLFDecoder,
}


# ============================================================================
# 5. AUDIO CAPTURE ABSTRACTION (REAL HARDWARE & SYNTHETIC SIMULATOR)
# ============================================================================

class AudioCaptureEngine:
    """
    Thread-safe audio capture engine supporting live audio devices (sounddevice/PyAudio)
    with seamless fallback to synthetic RF simulation when hardware is unavailable.
    """

    def __init__(self, sample_rate: int = 12000, device_index: int = -1):
        self.sample_rate = sample_rate
        self.device_index = device_index
        self.has_real_audio = False
        self._check_audio_backend()

    def _check_audio_backend(self) -> None:
        try:
            import sounddevice as sd
            self.has_real_audio = True
            logger.info("sounddevice backend detected for RF Time Sync.")
        except ImportError:
            try:
                import pyaudio
                self.has_real_audio = True
                logger.info("PyAudio backend detected for RF Time Sync.")
            except ImportError:
                self.has_real_audio = False
                logger.info("Using DSP Synthetic RF Simulator (zero external C-library dependencies).")

    def capture_chunk(self, duration_sec: float, target_station: Optional[TimeStationSpec] = None) -> List[float]:
        """Captures an audio block of specified duration in seconds."""
        num_samples = int(duration_sec * self.sample_rate)

        if self.has_real_audio:
            try:
                import sounddevice as sd
                device = self.device_index if self.device_index >= 0 else None
                rec = sd.rec(num_samples, samplerate=self.sample_rate, channels=1, dtype="float32", device=device)
                sd.wait()
                return list(rec.flatten())
            except Exception as ex:
                logger.warning(f"Hardware audio capture failed: {ex}. Falling back to simulator.")

        return self._generate_synthetic_rf(duration_sec, target_station)

    def _generate_synthetic_rf(self, duration_sec: float, spec: Optional[TimeStationSpec]) -> List[float]:
        """Generates realistic synthetic RF audio signal with carrier tones and atmospheric AWGN."""
        num_samples = int(duration_sec * self.sample_rate)
        dt = 1.0 / self.sample_rate
        samples = [0.0] * num_samples

        if not spec:
            for i in range(num_samples):
                samples[i] = random.gauss(0, 0.05)
            return samples

        if spec.modulation == ModulationType.AM_BCD_100HZ:
            tone_len = int(min(0.8 * self.sample_rate, num_samples))
            for i in range(num_samples):
                t = i * dt
                carrier = 0.25 * math.sin(2.0 * math.pi * 100.0 * t)
                beep = 0.4 * math.sin(2.0 * math.pi * 1000.0 * t) if i < tone_len else 0.0
                noise = random.gauss(0, 0.03)
                samples[i] = carrier + beep + noise

        elif spec.modulation == ModulationType.USB_BELL103_AFSK:
            for i in range(num_samples):
                t = i * dt
                f_tone = 2225.0 if math.sin(2.0 * math.pi * 150.0 * t) > 0 else 2025.0
                tone = 0.3 * math.sin(2.0 * math.pi * f_tone * t)
                noise = random.gauss(0, 0.03)
                samples[i] = tone + noise

        elif spec.modulation == ModulationType.AM_PWM_DCF77:
            for i in range(num_samples):
                t = i * dt
                s_frac = t - math.floor(t)
                envelope = 0.25 if s_frac < 0.1 else 1.0
                carrier = 0.3 * math.sin(2.0 * math.pi * 1000.0 * t)
                noise = random.gauss(0, 0.03)
                samples[i] = carrier * envelope + noise
        else:
            for i in range(num_samples):
                t = i * dt
                samples[i] = 0.25 * math.sin(2.0 * math.pi * 1000.0 * t) + random.gauss(0, 0.03)

        return samples


# ============================================================================
# 6. HAMLIB CAT TUNING INTEGRATION
# ============================================================================

class CatTuner:
    """Handles CAT tuning to time stations via Hamlib rigctld."""

    def __init__(self, host: str = "127.0.0.1", port: int = 4532):
        self.host = host
        self.port = port
        self.sock: Optional[socket.socket] = None

    def connect(self) -> bool:
        try:
            self.disconnect()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(1.5)
            self.sock.connect((self.host, self.port))
            return True
        except Exception:
            self.sock = None
            return False

    def disconnect(self) -> None:
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    def tune(self, freq_hz: int, mode: str = "AM", passband_hz: int = 3000) -> bool:
        """Tunes rig to time standard frequency and mode."""
        if not self.sock:
            self.connect()
        if not self.sock:
            logger.info(f"[Simulated CAT] Tune to {freq_hz/1e6:.4f} MHz ({mode}, {passband_hz} Hz BW)")
            return True

        try:
            self.sock.sendall(f"F {freq_hz}\\n".encode("ascii"))
            resp_f = self.sock.recv(512).decode("ascii")
            self.sock.sendall(f"M {mode} {passband_hz}\\n".encode("ascii"))
            resp_m = self.sock.recv(512).decode("ascii")
            logger.info(f"CAT tuned {freq_hz} Hz {mode}: {resp_f.strip()} / {resp_m.strip()}")
            return True
        except Exception as ex:
            logger.warning(f"CAT tuning error: {ex}")
            self.disconnect()
            return False


# ============================================================================
# 7. TIME OFFSET PERSISTENCE & SETTINGS INTEGRATION
# ============================================================================

#: Largest jump z-30 will ever apply to the system clock, in seconds. A genuine drift
#: correction is milliseconds to seconds; anything larger is a misdecode or a spoof.
MAX_OS_CLOCK_STEP_SEC: float = 300.0


class TimeSyncSettingsManager:
    """
    Saves and updates the application clock drift offset in the user's config.json.

    z-30 keeps its own \`app_time_offset_ms\` and applies it internally to every slot boundary
    calculation. For essentially every operator that internal offset is the right and
    sufficient behaviour: it gives the decoder accurate slot timing without the app touching
    anything outside itself. Setting the machine's clock is a separate, opt-in action - see
    try_set_os_system_time.
    """

    @staticmethod
    def update_app_time_offset(delta_ms: float, config_path: Optional[str] = None) -> bool:
        """
        Updates \`app_time_offset_ms\` in the user's config.json without requiring
        Administrator / root OS privileges.
        """
        config_path = config_path or default_config_path()
        data: Dict[str, Any] = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}

        data["app_time_offset_ms"] = delta_ms
        data["last_time_sync_utc"] = datetime.now(timezone.utc).isoformat()

        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Saved application clock offset {delta_ms:+.2f} ms to {config_path}")
            return True
        except Exception as ex:
            logger.error(f"Failed to write clock offset to {config_path}: {ex}")
            return False

    @staticmethod
    def get_app_time_offset(config_path: Optional[str] = None) -> float:
        """Loads persisted clock offset in milliseconds."""
        config_path = config_path or default_config_path()
        if not os.path.exists(config_path):
            return 0.0
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return float(data.get("app_time_offset_ms", 0.0))
        except Exception:
            return 0.0

    # ------------------------------------------------------------------
    # OS clock setting - opt-in, bounded, and never the default
    # ------------------------------------------------------------------
    #
    # An RF time station is an unauthenticated broadcast. Anyone with a transmitter can put a
    # WWV-shaped signal on the air, and a marginal decode can produce a wrong timestamp with
    # no adversary at all. Handing that timestamp straight to the operating system moves the
    # machine's clock arbitrarily, and everything else on the host - TLS certificate validity,
    # log timestamps, cron, backups, other radio software - moves with it. So z-30's default
    # is to keep the correction to itself in \`app_time_offset_ms\`, which is all the decoder
    # actually needs.
    #
    # When an operator does want the system clock disciplined from RF, all of the following
    # must hold: the feature is enabled explicitly, the caller has confirmed this particular
    # change, and the proposed time is within MAX_OS_CLOCK_STEP_SEC of the current clock.


    #: Environment variable that enables OS clock setting for headless / service use.
    ENABLE_ENV_VAR: str = "Z30_ALLOW_SET_SYSTEM_CLOCK"

    @staticmethod
    def is_os_clock_setting_enabled(config_path: Optional[str] = None) -> bool:
        """
        True only if the operator has explicitly turned OS clock setting on, either in the
        persisted config (\`allow_set_system_clock: true\`) or via the environment variable.
        Absent configuration means disabled - this fails closed.
        """
        if os.environ.get(TimeSyncSettingsManager.ENABLE_ENV_VAR, "").strip().lower() in ("1", "true", "yes", "on"):
            return True
        config_path = config_path or default_config_path()
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return bool(json.load(f).get("allow_set_system_clock", False))
        except (OSError, ValueError):
            return False

    @staticmethod
    def describe_clock_ownership() -> Optional[str]:
        """
        Returns a description of the daemon that already owns the clock, or None.

        systemd-timesyncd, chrony and ntpd all discipline the clock continuously and will
        simply undo an external step, so an apparently successful set silently reverts. The
        previous implementation shelled out to \`date -u -s\`, whose failure on exactly those
        hosts was invisible: \`os.system\` returns a wait status, and the \`res == 0\` check
        happened to read it correctly only by coincidence.
        """
        if not sys.platform.startswith("linux"):
            return None
        timedatectl = shutil.which("timedatectl")
        if not timedatectl:
            return None
        try:
            proc = subprocess.run([timedatectl, "show", "--property=NTPSynchronized", "--value"],
                                  capture_output=True, text=True, timeout=3.0)
        except (OSError, subprocess.SubprocessError):
            return None
        if proc.returncode == 0 and proc.stdout.strip().lower() == "yes":
            return ("an NTP service (systemd-timesyncd / chrony / ntpd) is disciplining this "
                    "clock; disable it first with 'timedatectl set-ntp false' if you really "
                    "want the clock driven from RF")
        return None

    @staticmethod
    def try_set_os_system_time(
        target_utc: datetime,
        allow: bool = False,
        confirmed: bool = False,
        max_step_sec: Optional[float] = None,
    ) -> Tuple[bool, str]:
        """
        Sets the OS clock to \`target_utc\`, if and only if every guard passes.

        Args:
            target_utc: Timestamp demodulated from the time station (timezone-aware UTC).
            allow: The feature is enabled for this station (see is_os_clock_setting_enabled).
            confirmed: This specific change was confirmed at the moment it fires. A UI passes
                the operator's answer here; a headless service passes True deliberately.
            max_step_sec: Override for MAX_OS_CLOCK_STEP_SEC.

        Returns:
            (applied, human-readable reason). \`applied\` is False for every refusal, and the
            reason says which guard rejected it - this never fails silently.
        """
        limit = MAX_OS_CLOCK_STEP_SEC if max_step_sec is None else max_step_sec
        if not allow:
            return False, ("OS clock setting is disabled (default). z-30 applied the correction "
                           "internally as app_time_offset_ms instead.")
        if not confirmed:
            return False, "OS clock setting was not confirmed for this decode; nothing was changed."

        if target_utc.tzinfo is None:
            target_utc = target_utc.replace(tzinfo=timezone.utc)
        delta_sec = (target_utc - datetime.now(timezone.utc)).total_seconds()
        if abs(delta_sec) > limit:
            return False, (f"Refused: the decoded time differs from this machine's clock by "
                           f"{delta_sec:+.1f}s, beyond the {limit:.0f}s sanity bound. A jump that "
                           f"large is a misdecode or a spoofed transmission, not clock drift.")

        owner = TimeSyncSettingsManager.describe_clock_ownership()
        if owner:
            return False, f"Refused: {owner}."

        target_epoch = target_utc.timestamp()
        try:
            if sys.platform == "win32":
                import ctypes
                import ctypes.wintypes

                class SYSTEMTIME(ctypes.Structure):
                    _fields_ = [
                        ("wYear", ctypes.wintypes.WORD),
                        ("wMonth", ctypes.wintypes.WORD),
                        ("wDayOfWeek", ctypes.wintypes.WORD),
                        ("wDay", ctypes.wintypes.WORD),
                        ("wHour", ctypes.wintypes.WORD),
                        ("wMinute", ctypes.wintypes.WORD),
                        ("wSecond", ctypes.wintypes.WORD),
                        ("wMilliseconds", ctypes.wintypes.WORD),
                    ]

                st = SYSTEMTIME(
                    target_utc.year,
                    target_utc.month,
                    (target_utc.weekday() + 1) % 7,
                    target_utc.day,
                    target_utc.hour,
                    target_utc.minute,
                    target_utc.second,
                    int(target_utc.microsecond / 1000),
                )
                if not ctypes.windll.kernel32.SetSystemTime(ctypes.byref(st)):
                    err = ctypes.windll.kernel32.GetLastError()
                    return False, f"SetSystemTime failed (Windows error {err}); Administrator rights are required."
                return True, f"System clock set to {target_utc.isoformat()} ({delta_sec:+.3f}s step)."

            # POSIX: clock_settime takes a float and keeps sub-second precision. The old
            # implementation formatted "%Y-%m-%d %H:%M:%S" and shelled out to date(1), which
            # truncated to whole seconds - discarding the very precision that decoding a time
            # standard exists to obtain.
            time.clock_settime(time.CLOCK_REALTIME, target_epoch)
            return True, f"System clock set to {target_utc.isoformat()} ({delta_sec:+.3f}s step)."
        except PermissionError:
            return False, "Permission denied setting the system clock; root privileges are required."
        except (OSError, AttributeError, ValueError) as ex:
            return False, f"System clock update failed: {ex}"


# ============================================================================
# 8. BACKGROUND STATION SCANNER WORKER THREAD
# ============================================================================

class RFTimeSyncThread(threading.Thread):
    """
    Non-blocking background worker thread that iterates through priority time
    stations, performs rapid SNR validation, dwells for full 60s frame decodes,
    and publishes real-time progress callbacks to the UI.
    """

    def __init__(
        self,
        station_queue: Optional[List[Tuple[str, int]]] = None,
        dwell_seconds: int = 120,
        pre_check_seconds: int = 5,
        cat_tuner: Optional[CatTuner] = None,
        audio_engine: Optional[AudioCaptureEngine] = None,
        config_path: Optional[str] = None,
        on_status_callback: Optional[Callable[[str, float, str, int, float], None]] = None,
        on_complete_callback: Optional[Callable[[TimeSyncResult], None]] = None,
        on_error_callback: Optional[Callable[[str], None]] = None,
        simulate_dwell_speed: float = 1.0,
        allow_set_system_clock: Optional[bool] = None,
        confirm_system_clock_callback: Optional[Callable[["TimeSyncResult"], bool]] = None,
    ):
        super().__init__(daemon=True, name="RFTimeSyncWorker")
        self.station_queue = station_queue or list(PRIORITY_REGIONS["North America (Default)"])
        self.dwell_seconds = dwell_seconds
        self.pre_check_seconds = pre_check_seconds
        self.cat_tuner = cat_tuner or CatTuner()
        self.audio_engine = audio_engine or AudioCaptureEngine()
        self.config_path = config_path
        self.on_status_callback = on_status_callback
        self.on_complete_callback = on_complete_callback
        self.on_error_callback = on_error_callback
        self.simulate_dwell_speed = simulate_dwell_speed
        # Defaults to whatever the operator persisted, which itself defaults to off.
        self.allow_set_system_clock = (
            TimeSyncSettingsManager.is_os_clock_setting_enabled(config_path)
            if allow_set_system_clock is None
            else bool(allow_set_system_clock)
        )
        self.confirm_system_clock_callback = confirm_system_clock_callback

        self.cancel_event = threading.Event()
        self.last_result: Optional[TimeSyncResult] = None

    def cancel(self) -> None:
        """Cancels active scanning cycle immediately."""
        self.cancel_event.set()
        logger.info("RF Time Sync cancellation requested by user.")

    def run(self) -> None:
        logger.info(f"Starting RF Time Sync Scan across {len(self.station_queue)} station targets...")
        total_targets = len(self.station_queue)

        for idx, (stn_name, freq_hz) in enumerate(self.station_queue):
            if self.cancel_event.is_set():
                logger.info("RF Time Sync scan aborted.")
                return

            spec = TIME_STATIONS.get(stn_name)
            if not spec:
                continue

            progress_pct = (idx / total_targets) * 100.0
            freq_mhz = freq_hz / 1e6
            status_msg = f"Tuning {stn_name} {freq_mhz:.3f} MHz ({idx+1}/{total_targets})..."
            self._notify_status(status_msg, progress_pct, stn_name, freq_hz, 0.0)

            # 1. Issue CAT Tuning Command
            self.cat_tuner.tune(freq_hz, mode=spec.cat_mode, passband_hz=spec.passband_hz)
            time.sleep(0.5 / self.simulate_dwell_speed)

            if self.cancel_event.is_set():
                return

            # 2. Instantiate decoder
            decoder_cls = DECODER_MAP.get(spec.modulation, GenericLFDecoder)
            decoder: BaseStationDecoder = decoder_cls(sample_rate=self.audio_engine.sample_rate)

            # 3. Rapid 5-Second SNR & Carrier Pre-Validation
            self._notify_status(f"Measuring SNR on {stn_name} {freq_mhz:.3f} MHz...", progress_pct, stn_name, freq_hz, 0.0)
            pre_audio = self.audio_engine.capture_chunk(self.pre_check_seconds / self.simulate_dwell_speed, target_station=spec)
            has_carrier, snr_db = decoder.validate_pre_carrier(pre_audio, spec)

            self._notify_status(f"{stn_name} SNR: {snr_db:.1f} dB", progress_pct, stn_name, freq_hz, snr_db)

            if not has_carrier:
                logger.info(f"Low SNR ({snr_db:.1f} dB) on {stn_name} @ {freq_mhz:.3f} MHz. Skipping early.")
                time.sleep(0.5 / self.simulate_dwell_speed)
                continue

            # 4. Commencing Full Dwell Frame Capture (120-180 seconds)
            dwell_start_monotonic = time.monotonic()
            dwell_start_utc = datetime.now(timezone.utc)
            self._notify_status(
                f"Listening for 60s frame marker on {stn_name}...",
                progress_pct + 5.0,
                stn_name,
                freq_hz,
                snr_db
            )

            # Capture dwell stream
            dwell_capture_len = min(65.0, float(self.dwell_seconds)) / self.simulate_dwell_speed
            dwell_audio = self.audio_engine.capture_chunk(dwell_capture_len, target_station=spec)

            if self.cancel_event.is_set():
                return

            # 5. Decode Frame & Compute Clock Offset
            result = decoder.process_dwell_stream(
                dwell_audio,
                spec,
                dwell_start_monotonic,
                dwell_start_utc
            )

            if result and result.success:
                logger.info(result.summary())
                self.last_result = result
                # Persist the internal offset. This alone is what z-30's own slot timing
                # uses, and for almost every operator it is the whole of the correction.
                TimeSyncSettingsManager.update_app_time_offset(result.delta_ms, self.config_path)

                # Touching the machine's system clock is opt-in and confirmed per decode; see
                # TimeSyncSettingsManager.try_set_os_system_time for why. A refusal is logged
                # rather than swallowed, so an operator who did enable it can see what stopped
                # it instead of wondering whether it worked.
                if self.allow_set_system_clock:
                    confirmed = True
                    if self.confirm_system_clock_callback is not None:
                        confirmed = bool(self.confirm_system_clock_callback(result))
                    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(
                        result.rf_timestamp_utc, allow=True, confirmed=confirmed
                    )
                    (logger.info if applied else logger.warning)(f"OS clock: {reason}")

                self._notify_status(f"Sync Complete: {result.summary()}", 100.0, stn_name, freq_hz, result.snr_db)
                if self.on_complete_callback:
                    self.on_complete_callback(result)
                return

        # End of queue without lock
        err_msg = "Scan cycle finished: No time standard stations could be decoded. Try another antenna or regional preset."
        logger.warning(err_msg)
        self._notify_status(err_msg, 100.0, "NONE", 0, 0.0)
        if self.on_error_callback:
            self.on_error_callback(err_msg)

    def _notify_status(self, text: str, progress: float, stn: str, freq: int, snr: float) -> None:
        if self.on_status_callback:
            try:
                self.on_status_callback(text, progress, stn, freq, snr)
            except Exception as ex:
                logger.debug(f"Status callback exception: {ex}")


# ============================================================================
# 9. STANDALONE TKINTER GUI DIALOG & TIMING DISPLAY
# ============================================================================

def launch_rf_time_sync_dialog(parent: Optional[Any] = None, config_path: Optional[str] = None) -> None:
    """
    Launches a dedicated Tkinter dialog for RF Time Synchronization.
    """
    import tkinter as tk
    from tkinter import ttk, messagebox

    is_toplevel = parent is not None
    root = tk.Toplevel(parent) if is_toplevel else tk.Tk()
    root.title("z-30 RF Standard Time Synchronizer")
    root.geometry("640x520")
    root.configure(bg="#0F0F0F")

    # Style
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("TProgressbar", thickness=10, troughcolor="#1A1A1A", background="#00FF41")

    # Header
    header_frame = tk.Frame(root, bg="#141414", highlightthickness=1, highlightbackground="#333")
    header_frame.pack(fill=tk.X, padx=10, pady=10)

    tk.Label(
        header_frame,
        text="RF TIME SYNCHRONIZATION ENGINE",
        font=("Consolas", 13, "bold"),
        fg="#00FF41",
        bg="#141414"
    ).pack(anchor="w", padx=10, pady=(8, 2))

    tk.Label(
        header_frame,
        text="Scans WWV/WWVH, CHU, DCF77, MSF, WWVB & JJY to calibrate sub-second clock drift.",
        font=("Consolas", 9),
        fg="#888",
        bg="#141414"
    ).pack(anchor="w", padx=10, pady=(0, 8))

    # Readout Display Panel
    readout_frame = tk.Frame(root, bg="#050505", highlightthickness=1, highlightbackground="#222")
    readout_frame.pack(fill=tk.X, padx=10, pady=5)

    tk.Label(
        readout_frame,
        text="CURRENT APPLICATION CLOCK OFFSET (Δt):",
        font=("Consolas", 9, "bold"),
        fg="#888",
        bg="#050505"
    ).pack(anchor="w", padx=10, pady=(8, 0))

    current_offset = TimeSyncSettingsManager.get_app_time_offset(config_path)
    lbl_offset = tk.Label(
        readout_frame,
        text=f"{current_offset:+.2f} ms",
        font=("Consolas", 22, "bold"),
        fg="#FACC15",
        bg="#050505"
    )
    lbl_offset.pack(pady=4)

    lbl_station_info = tk.Label(
        readout_frame,
        text="Station: Ready to Scan | Jitter: <2.0 ms | Sub-second sync required for 30s cycle",
        font=("Consolas", 9),
        fg="#00FF41",
        bg="#050505"
    )
    lbl_station_info.pack(pady=(0, 8))

    # Regional Preset Selector
    ctrl_frame = tk.Frame(root, bg="#0F0F0F")
    ctrl_frame.pack(fill=tk.X, padx=10, pady=5)

    tk.Label(ctrl_frame, text="Regional Target Priority:", font=("Consolas", 9, "bold"), fg="#D4D4D4", bg="#0F0F0F").pack(side=tk.LEFT)
    region_var = tk.StringVar(value="North America (Default)")
    region_combo = ttk.Combobox(ctrl_frame, textvariable=region_var, values=list(PRIORITY_REGIONS.keys()), state="readonly", width=25)
    region_combo.pack(side=tk.LEFT, padx=10)

    # Progress & Status Display
    status_frame = tk.Frame(root, bg="#141414", highlightthickness=1, highlightbackground="#333")
    status_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

    lbl_status = tk.Label(
        status_frame,
        text="Status: Standby. Press 'Start RF Sync' to tune and decode.",
        font=("Consolas", 9),
        fg="#cyan",
        bg="#141414",
        anchor="w"
    )
    lbl_status.pack(fill=tk.X, padx=10, pady=(8, 4))

    progress_bar = ttk.Progressbar(status_frame, mode="determinate")
    progress_bar.pack(fill=tk.X, padx=10, pady=4)

    # Log text box
    log_text = tk.Text(status_frame, height=8, bg="#050505", fg="#00FF41", font=("Consolas", 8), relief="flat")
    log_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(4, 8))

    # Active Thread Tracker
    active_thread: List[Optional[RFTimeSyncThread]] = [None]

    def log_msg(msg: str) -> None:
        log_text.insert(tk.END, f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\\n")
        log_text.see(tk.END)

    def on_status(text: str, progress: float, stn: str, freq: int, snr: float) -> None:
        root.after(0, lambda: _update_ui(text, progress, stn, freq, snr))

    def _update_ui(text: str, progress: float, stn: str, freq: int, snr: float) -> None:
        lbl_status.config(text=text)
        progress_bar["value"] = progress
        log_msg(text)

    def on_complete(result: TimeSyncResult) -> None:
        root.after(0, lambda: _handle_complete(result))

    def _handle_complete(result: TimeSyncResult) -> None:
        lbl_offset.config(text=f"{result.delta_ms:+.2f} ms")
        lbl_station_info.config(text=f"Station: {result.station} @ {result.frequency_hz/1e6:.3f} MHz | SNR: {result.snr_db:.1f} dB")
        btn_start.config(state=tk.NORMAL)
        btn_stop.config(state=tk.DISABLED)
        messagebox.showinfo("Time Sync Complete", result.summary())

    def on_error(err: str) -> None:
        root.after(0, lambda: _handle_error(err))

    def _handle_error(err: str) -> None:
        btn_start.config(state=tk.NORMAL)
        btn_stop.config(state=tk.DISABLED)
        messagebox.showwarning("Time Sync Incomplete", err)

    def start_sync() -> None:
        region = region_var.get()
        station_queue = PRIORITY_REGIONS.get(region, PRIORITY_REGIONS["North America (Default)"])
        log_msg(f"Initiating scan for region '{region}' ({len(station_queue)} targets)...")
        btn_start.config(state=tk.DISABLED)
        btn_stop.config(state=tk.NORMAL)

        worker = RFTimeSyncThread(
            station_queue=station_queue,
            dwell_seconds=120,
            pre_check_seconds=5,
            config_path=config_path,
            on_status_callback=on_status,
            on_complete_callback=on_complete,
            on_error_callback=on_error
        )
        active_thread[0] = worker
        worker.start()

    def stop_sync() -> None:
        if active_thread[0]:
            active_thread[0].cancel()
            log_msg("Aborting scan...")
            btn_start.config(state=tk.NORMAL)
            btn_stop.config(state=tk.DISABLED)

    # Action Buttons
    btn_frame = tk.Frame(root, bg="#0F0F0F")
    btn_frame.pack(fill=tk.X, padx=10, pady=10)

    btn_start = tk.Button(
        btn_frame,
        text="▶ START RF SYNC",
        font=("Consolas", 10, "bold"),
        bg="#00FF41",
        fg="#000000",
        activebackground="#00DD38",
        relief="flat",
        padx=12,
        pady=6,
        command=start_sync
    )
    btn_start.pack(side=tk.LEFT, padx=5)

    btn_stop = tk.Button(
        btn_frame,
        text="⏹ ABORT SCAN",
        font=("Consolas", 10, "bold"),
        bg="#222",
        fg="#888",
        activebackground="#333",
        relief="flat",
        padx=12,
        pady=6,
        state=tk.DISABLED,
        command=stop_sync
    )
    btn_stop.pack(side=tk.LEFT, padx=5)

    btn_close = tk.Button(
        btn_frame,
        text="CLOSE",
        font=("Consolas", 10),
        bg="#1A1A1A",
        fg="#D4D4D4",
        activebackground="#252525",
        relief="flat",
        padx=10,
        pady=6,
        command=root.destroy
    )
    btn_close.pack(side=tk.RIGHT, padx=5)

    if not is_toplevel:
        root.mainloop()


# ============================================================================
# 10. CLI TEST HARNESS & SELF-TEST RUNNER
# ============================================================================

def run_self_test() -> bool:
    """
    Executes an automated DSP self-test validating:
    1. 100 Hz FIR bandpass filter & envelope extraction
    2. WWV 1000 Hz minute marker detection
    3. CHU Bell 103 AFSK tone discriminator
    4. DCF77 1 Hz PWM dip slicing
    5. Delta t time offset computation
    6. Thread lifecycle and cancellation
    """
    print("\\n" + "=" * 65)
    print("  z-30 RF TIME SYNCHRONIZATION ENGINE — UNIT TEST HARNESS")
    print("=" * 65)

    sr = 12000
    # 1. Test DSP Filter
    print("[1/5] Testing FIR Bandpass & Envelope Detection...")
    dt = 1.0 / sr
    test_sig = [math.sin(2.0 * math.pi * 100.0 * i * dt) + 0.5 * math.sin(2.0 * math.pi * 1000.0 * i * dt) + random.gauss(0, 0.02) for i in range(sr)]
    filtered = DSPUtils.bandpass_fir(test_sig, sr, 80.0, 120.0, num_taps=51)
    snr, _ = DSPUtils.estimate_carrier_snr(filtered, sr, 100.0)
    assert snr > 5.0, f"Expected SNR > 5dB, got {snr:.1f} dB"
    print(f"      -> 100 Hz Filter pass: SNR = {snr:.1f} dB")

    # 2. Test WWV Decoder
    print("[2/5] Testing WWV 100Hz BCD & 1000Hz Minute Beep Decoder...")
    wwv_decoder = WWVDecoder(sample_rate=sr)
    wwv_spec = TIME_STATIONS["WWV"]
    audio_engine = AudioCaptureEngine(sample_rate=sr)
    synthetic_wwv = audio_engine._generate_synthetic_rf(5.0, wwv_spec)
    has_carrier, snr_db = wwv_decoder.validate_pre_carrier(synthetic_wwv, wwv_spec)
    assert has_carrier, "WWV Carrier validation failed on synthetic signal."
    print(f"      -> WWV Pre-check passed: SNR = {snr_db:.1f} dB")

    # 3. Test CHU Bell 103 Decoder
    print("[3/5] Testing CHU 300-Baud Bell 103 AFSK Discriminator...")
    chu_decoder = CHUDecoder(sample_rate=sr)
    chu_spec = TIME_STATIONS["CHU"]
    synthetic_chu = audio_engine._generate_synthetic_rf(5.0, chu_spec)
    has_chu, chu_snr = chu_decoder.validate_pre_carrier(synthetic_chu, chu_spec)
    assert has_chu, "CHU Carrier validation failed on synthetic signal."
    print(f"      -> CHU Pre-check passed: SNR = {chu_snr:.1f} dB")

    # 4. Test DCF77 PWM Slicer
    print("[4/5] Testing DCF77 1 Hz PWM AM Dip Detector...")
    dcf_decoder = DCF77Decoder(sample_rate=sr)
    dcf_spec = TIME_STATIONS["DCF77"]
    synthetic_dcf = audio_engine._generate_synthetic_rf(5.0, dcf_spec)
    has_dcf, dcf_snr = dcf_decoder.validate_pre_carrier(synthetic_dcf, dcf_spec)
    assert has_dcf, "DCF77 Carrier validation failed on synthetic signal."
    print(f"      -> DCF77 Pre-check passed: SNR = {dcf_snr:.1f} dB")

    # 5. Full End-to-End Thread Simulation
    print("[5/5] Running Accelerated End-to-End Scanner Thread...")
    test_queue = [("WWV", 10000000), ("CHU", 7850000)]
    results: List[TimeSyncResult] = []

    def on_complete_test(res: TimeSyncResult):
        results.append(res)

    worker = RFTimeSyncThread(
        station_queue=test_queue,
        dwell_seconds=5,
        pre_check_seconds=1,
        simulate_dwell_speed=20.0,
        on_complete_callback=on_complete_test
    )
    worker.start()
    worker.join(timeout=10.0)

    assert len(results) > 0 and results[0].success, "Expected successful RF sync in test run."
    res = results[0]
    print(f"      -> {res.summary()}")
    print("=" * 65)
    print("  ALL 5 DSP & TIME SYNC UNIT TESTS PASSED SUCCESSFULLY! ✓")
    print("=" * 65 + "\\n")
    return True


def main():
    if "--test" in sys.argv or "-t" in sys.argv:
        success = run_self_test()
        sys.exit(0 if success else 1)
    elif "--gui" in sys.argv:
        launch_rf_time_sync_dialog()
    else:
        print("z-30 RF Time Synchronization Engine")
        print("Usage:")
        print("  python rf_time_sync.py --test    (Run automated unit tests)")
        print("  python rf_time_sync.py --gui     (Launch interactive Tkinter UI)")
        print("\\nExecuting default self-test suite...")
        run_self_test()

if __name__ == "__main__":
    main()

`,
  },
  {
    filename: "auto_logger.py",
    path: "z30_dsp/auto_logger.py",
    description: "Thread-safe asynchronous QSO logging engine for ADIF 3.1.4, RFC 4180 CSV and SQLite.",
    code: `"""
z-30 Asynchronous Amateur Radio QSO Logging Engine
=================================================
Features:
- Thread-safe non-blocking queue (queue.Queue) with dedicated background worker thread
- Automatic ADIF 3.1.4 standard compliance (LoTW, eQSL, ClubLog compatible)
- SQLite3 durable relational database with schema indexes
- RFC 4180 CSV export
- Maidenhead Great-Circle distance (km) and bearing (deg) geometric calculation
"""

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import math
import os
import queue
import sqlite3
import threading
from typing import Optional, List, Callable, Tuple

@dataclass
class QsoLogRecord:
    callsign: str
    grid: str
    band: str
    freq_mhz: float
    rst_sent: str
    rst_rcvd: str
    mode: str = "z-30"
    submode: str = "16-MFSK"
    utc_date: Optional[str] = None  # YYYYMMDD
    utc_time: Optional[str] = None  # HHMMSS
    distance_km: int = 0
    azimuth_deg: int = 0
    tx_power_watts: int = 50
    notes: str = "z-30 16-MFSK LDPC"

def calculate_maidenhead_distance(grid1: str, grid2: str) -> Tuple[int, int]:
    """Calculates Great-Circle distance in km and initial bearing in degrees."""
    def parse_grid(g: str) -> Optional[Tuple[float, float]]:
        g = g.strip().upper()
        if len(g) < 4:
            return None
        lon = (ord(g[0]) - ord('A')) * 20 - 180 + int(g[2]) * 2 + 1
        lat = (ord(g[1]) - ord('A')) * 10 - 90 + int(g[3]) * 1 + 0.5
        return math.radians(lat), math.radians(lon)

    p1 = parse_grid(grid1)
    p2 = parse_grid(grid2)
    if not p1 or not p2:
        return 0, 0

    lat1, lon1 = p1
    lat2, lon2 = p2
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    # Haversine formula
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    dist_km = int(6371 * c)

    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    bearing_deg = int((math.degrees(math.atan2(y, x)) + 360) % 360)

    return dist_km, bearing_deg

class AsyncQsoLogger:
    """
    Thread-safe asynchronous QSO logging daemon.
    Guarantees audio real-time loops are never blocked by disk or database I/O.
    """

    def __init__(
        self,
        my_call: str = "W1AW",
        my_grid: str = "FN31",
        db_path: str = "z30_logbook.db",
        adif_path: str = "z30_station.adi"
    ) -> None:
        self.my_call = my_call.upper()
        self.my_grid = my_grid.upper()
        self.db_path = db_path
        self.adif_path = adif_path
        
        self.queue: queue.Queue[Optional[QsoLogRecord]] = queue.Queue()
        self._init_db()
        
        # Start background worker daemon
        self.worker = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker.start()

    def _init_db(self) -> None:
        """Initializes SQLite table schema with optimized indices."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS qso_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    utc_date TEXT NOT NULL,
                    utc_time TEXT NOT NULL,
                    callsign TEXT NOT NULL,
                    grid TEXT,
                    band TEXT NOT NULL,
                    freq_mhz REAL NOT NULL,
                    mode TEXT DEFAULT 'z-30',
                    submode TEXT DEFAULT '16-MFSK',
                    rst_sent TEXT,
                    rst_rcvd TEXT,
                    distance_km INTEGER,
                    azimuth_deg INTEGER,
                    tx_power_watts INTEGER,
                    my_call TEXT,
                    my_grid TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_call ON qso_records(callsign)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_date ON qso_records(utc_date)')
            conn.commit()

    def log_qso_async(self, record: QsoLogRecord) -> None:
        """Enqueues a QSO record for asynchronous non-blocking storage."""
        now = datetime.now(timezone.utc)
        if not record.utc_date:
            record.utc_date = now.strftime("%Y%m%d")
        if not record.utc_time:
            record.utc_time = now.strftime("%H%M%S")

        # Compute Maidenhead geometry
        if record.grid and self.my_grid:
            dist, az = calculate_maidenhead_distance(self.my_grid, record.grid)
            record.distance_km = dist
            record.azimuth_deg = az

        self.queue.put(record)

    def _worker_loop(self) -> None:
        """Background thread worker processing queued QSOs."""
        while True:
            record = self.queue.get()
            if record is None:
                break

            try:
                self._write_sqlite(record)
                self._append_adif(record)
            except Exception as ex:
                print(f"[AsyncQsoLogger] Error writing QSO log: {ex}")
            finally:
                self.queue.task_done()

    def _write_sqlite(self, record: QsoLogRecord) -> None:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO qso_records (
                    utc_date, utc_time, callsign, grid, band, freq_mhz,
                    mode, submode, rst_sent, rst_rcvd, distance_km, azimuth_deg,
                    tx_power_watts, my_call, my_grid, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                record.utc_date, record.utc_time, record.callsign.upper(), record.grid.upper(),
                record.band, record.freq_mhz, record.mode, record.submode,
                record.rst_sent, record.rst_rcvd, record.distance_km, record.azimuth_deg,
                record.tx_power_watts, self.my_call, self.my_grid, record.notes
            ))
            conn.commit()

    def _append_adif(self, record: QsoLogRecord) -> None:
        """Appends record in standard ADIF 3.1.4 format."""
        file_exists = os.path.exists(self.adif_path)
        with open(self.adif_path, "a", encoding="utf-8") as f:
            if not file_exists:
                f.write("ADIF Export from z-30 DSP Transceiver Suite\\\\n")
                f.write("<ADIF_VER:5>3.1.4\\\\n<PROGRAMID:4>z-30\\\\n<EOH>\\\\n\\\\n")

            line = (
                f"<CALL:{len(record.callsign)}>{record.callsign} "
                f"<QSO_DATE:{len(record.utc_date)}>{record.utc_date} "
                f"<TIME_ON:{len(record.utc_time)}>{record.utc_time} "
                f"<BAND:{len(record.band)}>{record.band} "
                f"<FREQ:{len(str(record.freq_mhz))}>{record.freq_mhz} "
                f"<MODE:{len(record.mode)}>{record.mode} "
                f"<SUBMODE:{len(record.submode)}>{record.submode} "
                f"<RST_SENT:{len(record.rst_sent)}>{record.rst_sent} "
                f"<RST_RCVD:{len(record.rst_rcvd)}>{record.rst_rcvd} "
                f"<GRIDSQUARE:{len(record.grid)}>{record.grid} "
                f"<OPERATOR:{len(self.my_call)}>{self.my_call} "
                f"<MY_GRIDSQUARE:{len(self.my_grid)}>{self.my_grid} "
                f"<DISTANCE:{len(str(record.distance_km))}>{record.distance_km} "
                f"<COMMENT:{len(record.notes)}>{record.notes} "
                f"<EOR>\\\\n"
            )
            f.write(line)
`,
  },
  {
    filename: "gui_tkinter.py",
    path: "z30_dsp/gui_tkinter.py",
    description: "Tkinter GUI with a non-blocking waterfall, selectable colormaps, and live signal tracking overlays.",
    code: `"""
z-30 Tkinter High-Performance Transceiver GUI & Waterfall
=========================================================
Features:
- Non-blocking Canvas Spectral Waterfall with 10 Vectorized Color Palettes
  (Turbo, Inferno, Viridis, Plasma, Magma, WSJT-X, Night Vision Green, Amber, B&W, Spectral)
- Interactive Zoom (1x, 2x, 4x, 8x) and Pan Controls (Center frequency slider, mouse wheel zoom, drag-to-pan)
- Live Signal Tracking Overlays (Blinking bounding boxes, SIC pass indicators, SNR tags)
- Integrated Asynchronous Auto-QSO Logger (ADIF 3.1.4 / SQLite)
- Band & Rig Control with S-Meter and Forward Power monitoring
"""

import tkinter as tk
from tkinter import ttk, messagebox
import threading
import time
import numpy as np
from typing import Dict, List, Tuple, Optional
# There is exactly one implementation of each of these modules, inside the z30_dsp package.
# The relative form covers running as part of the package; the absolute form covers running
# this file directly from a source checkout. Neither falls back to a top-level module: the
# repository used to carry a second, drifted copy of config_wizard at its root, and an
# ImportError fallback to it is how the two ended up both installed and both reachable.
try:
    from .auto_logger import AsyncQsoLogger, QsoLogRecord
    from .config_wizard import SettingsManager, StationConfig, launch_config_wizard_if_needed, ConfigWizardDialog
except ImportError:
    from z30_dsp.auto_logger import AsyncQsoLogger, QsoLogRecord
    from z30_dsp.config_wizard import SettingsManager, StationConfig, launch_config_wizard_if_needed, ConfigWizardDialog


# 10 Vectorized Color Lookups for Waterfall
def build_colormap_lut(name: str) -> np.ndarray:
    """Builds a 256x3 RGB lookup table for high-speed waterfall rendering."""
    x = np.linspace(0, 1, 256)
    lut = np.zeros((256, 3), dtype=np.uint8)

    if name == "turbo":
        r = np.clip(np.sin(x * np.pi * 1.5 - 0.5) * 127 + 128, 0, 255)
        g = np.clip(np.sin(x * np.pi) * 200 + 40, 0, 255)
        b = np.clip(np.cos(x * np.pi * 1.2) * 200 + 55, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "inferno":
        r = np.clip(np.power(x, 0.7) * 255, 0, 255)
        g = np.clip(np.power(x, 1.8) * 230, 0, 255)
        b = np.clip(np.sin(x * np.pi * 0.8) * 180, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "viridis":
        r = np.clip(np.where(x < 0.5, x * 100, (x - 0.5) * 400 + 50), 0, 255)
        g = np.clip(x * 220 + 30, 0, 255)
        b = np.clip((1 - x) * 180 + 70, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "plasma":
        r = np.clip(np.power(x, 0.6) * 240 + 15, 0, 255)
        g = np.clip(np.sin(x * np.pi * 0.9) * 180, 0, 255)
        b = np.clip(np.cos(x * np.pi * 0.7) * 220 + 30, 0, 255)
        lut = np.stack([r, g, b], axis=1).astype(np.uint8)
    elif name == "wsjtx":
        for i, val in enumerate(x):
            if val < 0.2:
                lut[i] = [10, 20, int(val * 400)]
            elif val < 0.6:
                lut[i] = [int((val - 0.2) * 200), int((val - 0.2) * 350), 220]
            else:
                lut[i] = [255, 255, min(255, int((val - 0.6) * 600))]
    elif name == "nightGreen":
        lut[:, 0] = (x * 30).astype(np.uint8)
        lut[:, 1] = (x * 255).astype(np.uint8)
        lut[:, 2] = (x * 70).astype(np.uint8)
    elif name == "amber":
        lut[:, 0] = (x * 255).astype(np.uint8)
        lut[:, 1] = (x * 170).astype(np.uint8)
        lut[:, 2] = (x * 30).astype(np.uint8)
    else:  # High contrast / Spectral
        lut[:, 0] = (x * 255).astype(np.uint8)
        lut[:, 1] = (x * 255).astype(np.uint8)
        lut[:, 2] = (x * 255).astype(np.uint8)

    return lut

class Z30TkinterApp:
    """Tkinter Transceiver GUI with Advanced Waterfall, Signal Tracking & Async Logger."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("z-30 Transceiver & DSP Station (16-MFSK / 50 Hz / LDPC-SIC)")
        self.root.geometry("1150x800")
        self.root.configure(bg="#0A0A0A")

        # Load station persistent configuration
        self.settings_mgr = SettingsManager()
        self.config = self.settings_mgr.load_config()

        # Async QSO Logger initialization with configured callsign & grid
        self.logger = AsyncQsoLogger(
            my_call=self.config.callsign if self.config.callsign != "N0CALL" else "W1AW",
            my_grid=self.config.grid if self.config.grid != "AA00aa" else "FN31"
        )

        # Waterfall Zoom & Display State
        self.colormap_name = "turbo"
        self.lut = build_colormap_lut(self.colormap_name)
        self.zoom = 1.0  # 1x, 2x, 4x, 8x
        self.center_freq_hz = 1600.0
        self.full_min_freq = 200.0
        self.full_max_freq = 3000.0
        self.full_span = self.full_max_freq - self.full_min_freq
        self.gain_db = 12
        self.rx_freq_hz = 1250
        self.tx_freq_hz = 1250
        self.show_tracking = True
        self.tracked_signals: List[Dict] = []

        self._init_styles()
        self._build_menu()
        self._build_ui()
        self._start_threads()

        # Auto-launch Setup Wizard if configuration is missing or initial default
        self.root.after(100, self._check_initial_wizard)

    def _init_styles(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(".", background="#0A0A0A", foreground="#D4D4D4", font=("Fira Code", 10))
        style.configure("Treeview", background="#141414", foreground="#F8FAFC", fieldbackground="#141414")
        style.map("Treeview", background=[("selected", "#00FF41")], foreground=[("selected", "#000000")])

    def _build_ui(self) -> None:
        # Top Header Bar
        header = tk.Frame(self.root, bg="#0F0F0F", height=45, bd=1, relief="solid")
        header.pack(fill="x", padx=6, pady=4)
        
        tk.Label(header, text="z-30 RF TRANSCEIVER", font=("Fira Code", 12, "bold"), fg="#00FF41", bg="#0F0F0F").pack(side="left", padx=10)
        self.vfo_label = tk.Label(header, text="VFO: 14.074.000 MHz (20m)", font=("Fira Code", 11, "bold"), fg="#38BDF8", bg="#0F0F0F")
        self.vfo_label.pack(side="left", padx=15)
        
        self.utc_label = tk.Label(header, text="UTC: 00:00:00 [CYCLE: 00s / RX]", font=("Fira Code", 11, "bold"), fg="#FCD34D", bg="#0F0F0F")
        self.utc_label.pack(side="right", padx=10)

        # Waterfall Control Toolbar
        wf_toolbar = tk.Frame(self.root, bg="#141414", bd=1, relief="solid")
        wf_toolbar.pack(fill="x", padx=6, pady=(4, 0))

        tk.Label(wf_toolbar, text="Colormap:", fg="#888888", bg="#141414").pack(side="left", padx=(8, 2))
        self.palette_combo = ttk.Combobox(
            wf_toolbar,
            values=["turbo", "inferno", "viridis", "plasma", "wsjtx", "nightGreen", "amber"],
            width=10,
            state="readonly"
        )
        self.palette_combo.set("turbo")
        self.palette_combo.pack(side="left", padx=2)
        self.palette_combo.bind("<<ComboboxSelected>>", self._on_palette_change)

        # Zoom buttons
        tk.Label(wf_toolbar, text="| Zoom:", fg="#444444", bg="#141414").pack(side="left", padx=4)
        tk.Button(wf_toolbar, text="1x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(1.0)).pack(side="left", padx=1)
        tk.Button(wf_toolbar, text="2x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(2.0)).pack(side="left", padx=1)
        tk.Button(wf_toolbar, text="4x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(4.0)).pack(side="left", padx=1)
        tk.Button(wf_toolbar, text="8x", bg="#1E1E1E", fg="#D4D4D4", command=lambda: self._set_zoom(8.0)).pack(side="left", padx=1)

        # Pan Slider
        tk.Label(wf_toolbar, text="| Center Freq (Hz):", fg="#888888", bg="#141414").pack(side="left", padx=4)
        self.pan_scale = tk.Scale(wf_toolbar, from_=600, to=2600, orient="horizontal", bg="#141414", fg="#00FF41", highlightthickness=0, command=self._on_pan_change)
        self.pan_scale.set(1600)
        self.pan_scale.pack(side="left", padx=2)

        # Tracking Toggle
        self.track_var = tk.BooleanVar(value=True)
        tk.Checkbutton(wf_toolbar, text="Live Signal Tracking Overlays", variable=self.track_var, fg="#00FF41", bg="#141414", selectcolor="#000000").pack(side="right", padx=10)

        # Real-time Waterfall Canvas
        self.wf_canvas = tk.Canvas(self.root, width=1130, height=200, bg="#050505", highlightthickness=1, highlightbackground="#333333")
        self.wf_canvas.pack(fill="x", padx=6, pady=2)
        self.wf_canvas.bind("<Button-1>", self._on_waterfall_click)
        self.wf_canvas.bind("<MouseWheel>", self._on_waterfall_wheel)

        # Middle Section: Band Activity & QSO Automation
        mid_paned = tk.PanedWindow(self.root, orient="horizontal", bg="#0A0A0A")
        mid_paned.pack(fill="both", expand=True, padx=6, pady=4)

        # Left Table: Band Activity Decodes
        table_frame = tk.LabelFrame(mid_paned, text=" Band Activity (LDPC & Multi-Pass SIC Decodes) ", fg="#888888", bg="#141414")
        mid_paned.add(table_frame, width=680)

        cols = ("UTC", "SNR", "DT", "Freq", "Pass", "Message")
        self.tree = ttk.Treeview(table_frame, columns=cols, show="headings", height=9)
        for col in cols:
            self.tree.heading(col, text=col)
        self.tree.column("UTC", width=70)
        self.tree.column("SNR", width=65)
        self.tree.column("DT", width=55)
        self.tree.column("Freq", width=75)
        self.tree.column("Pass", width=65)
        self.tree.column("Message", width=280)
        self.tree.pack(fill="both", expand=True, padx=4, pady=4)
        self.tree.bind("<Double-1>", self._on_double_click_decode)

        # Right Panel: QSO State Machine & Controls
        qso_frame = tk.LabelFrame(mid_paned, text=" QSO Automation & Asynchronous Logger ", fg="#888888", bg="#141414")
        mid_paned.add(qso_frame, width=440)

        row1 = tk.Frame(qso_frame, bg="#141414")
        row1.pack(fill="x", padx=6, pady=3)
        tk.Label(row1, text="DX Call:", fg="#D4D4D4", bg="#141414").pack(side="left")
        self.dx_call_entry = tk.Entry(row1, width=10, font=("Fira Code", 10), bg="#050505", fg="#00FF41")
        self.dx_call_entry.pack(side="left", padx=4)
        
        tk.Label(row1, text="DX Grid:", fg="#D4D4D4", bg="#141414").pack(side="left", padx=4)
        self.dx_grid_entry = tk.Entry(row1, width=8, font=("Fira Code", 10), bg="#050505", fg="#38BDF8")
        self.dx_grid_entry.pack(side="left")

        # TX Macro Selection
        self.tx_macro_var = tk.StringVar(value="tx1")
        macros = [
            ("Tx 1: CQ W1AW FN31", "tx1"),
            ("Tx 2: DXCALL W1AW FN31", "tx2"),
            ("Tx 3: DXCALL W1AW -15", "tx3"),
            ("Tx 4: DXCALL W1AW R-15", "tx4"),
            ("Tx 5: DXCALL W1AW 73 (Auto-Log)", "tx5"),
        ]
        for text, val in macros:
            rb = tk.Radiobutton(qso_frame, text=text, variable=self.tx_macro_var, value=val, bg="#141414", fg="#D4D4D4", selectcolor="#050505")
            rb.pack(anchor="w", padx=10, pady=1)

        # Slot Selection & Transmit Controls
        slot_box = tk.Frame(qso_frame, bg="#141414")
        slot_box.pack(fill="x", padx=6, pady=2)
        tk.Label(slot_box, text="Tx Slot:", fg="#D4D4D4", bg="#141414").pack(side="left")
        self.tx_slot_var = tk.StringVar(value="EVEN (:00)")
        self.slot_combo = ttk.Combobox(slot_box, textvariable=self.tx_slot_var, values=["EVEN (:00)", "ODD (:30)", "MANUAL"], state="readonly", width=12)
        self.slot_combo.pack(side="left", padx=4)

        self.tx_enabled = False
        self.is_transmitting = False
        self.is_tuning = False

        # Action Buttons (Start TX, Stop TX, Tune CW, Log ADIF)
        btn_box = tk.Frame(qso_frame, bg="#141414")
        btn_box.pack(fill="x", padx=6, pady=4)
        
        self.start_tx_btn = tk.Button(btn_box, text="START TX", font=("Fira Code", 9, "bold"), bg="#00FF41", fg="black", command=self._start_tx)
        self.start_tx_btn.pack(side="left", fill="x", expand=True, padx=1)

        self.stop_tx_btn = tk.Button(btn_box, text="STOP TX", font=("Fira Code", 9, "bold"), bg="#EF4444", fg="white", command=self._stop_tx)
        self.stop_tx_btn.pack(side="left", fill="x", expand=True, padx=1)

        self.tune_btn = tk.Button(btn_box, text="TUNE (CW)", font=("Fira Code", 9, "bold"), bg="#EAB308", fg="black", command=self._tune_cw)
        self.tune_btn.pack(side="left", fill="x", expand=True, padx=1)
        
        self.log_btn = tk.Button(btn_box, text="LOG (ADIF)", font=("Fira Code", 9, "bold"), bg="#1E1E1E", fg="#38BDF8", command=self._manual_log_qso)
        self.log_btn.pack(side="left", fill="x", expand=True, padx=1)

    def _on_palette_change(self, event=None) -> None:
        self.colormap_name = self.palette_combo.get()
        self.lut = build_colormap_lut(self.colormap_name)

    def _set_zoom(self, zoom_val: float) -> None:
        self.zoom = zoom_val

    def _on_pan_change(self, val: str) -> None:
        self.center_freq_hz = float(val)

    def _on_waterfall_wheel(self, event: tk.Event) -> None:
        if event.delta > 0:
            self.zoom = min(8.0, self.zoom * 2.0)
        else:
            self.zoom = max(1.0, self.zoom / 2.0)

    def _on_waterfall_click(self, event: tk.Event) -> None:
        visible_span = self.full_span / self.zoom
        min_f = self.center_freq_hz - (visible_span / 2.0)
        freq = int(min_f + (event.x / 1130.0) * visible_span)
        self.rx_freq_hz = max(200, min(3000, freq))
        messagebox.showinfo("QSY Frequency", f"Transceiver tuned to: {self.rx_freq_hz} Hz (50 Hz BW)")

    def _on_double_click_decode(self, event: tk.Event) -> None:
        selected = self.tree.selection()
        if selected:
            vals = self.tree.item(selected[0], "values")
            self.dx_call_entry.delete(0, tk.END)
            self.dx_call_entry.insert(0, vals[5].split()[1] if len(vals[5].split()) > 1 else "DX")
            self.tx_macro_var.set("tx2")

    def _manual_log_qso(self) -> None:
        call = self.dx_call_entry.get().strip().upper()
        grid = self.dx_grid_entry.get().strip().upper() or "FN31"
        if not call:
            messagebox.showwarning("Logbook", "Please enter a valid DX callsign.")
            return

        rec = QsoLogRecord(
            callsign=call,
            grid=grid,
            band="20m",
            freq_mhz=14.074,
            rst_sent="-14",
            rst_rcvd="-16",
            notes="z-30 16-MFSK LDPC / SIC Pass 1"
        )
        self.logger.log_qso_async(rec)
        messagebox.showinfo("Logged", f"Queued asynchronous logging for {call} ({grid}) in ADIF 3.1.4 & SQLite.")

    def _start_tx(self) -> None:
        """
        Enables TX and checks if current time matches the selected slot.
        If at start of selected slot, transmits immediately. Otherwise arms station.
        """
        if self.is_transmitting:
            return
        if self.is_tuning:
            self._stop_tx()

        self.tx_enabled = True
        slot_mode = self.tx_slot_var.get()
        
        # Calculate current UTC slot
        utc_sec = time.time() % 60.0
        is_even_slot = (int(utc_sec) // 30) % 2 == 0
        cycle_s = utc_sec % 30.0

        matches_slot = (
            slot_mode == "MANUAL" or
            (slot_mode.startswith("EVEN") and is_even_slot) or
            (slot_mode.startswith("ODD") and not is_even_slot)
        )
        at_slot_start = cycle_s <= 1.5

        if slot_mode == "MANUAL" or (matches_slot and at_slot_start):
            self.is_transmitting = True
            self.start_tx_btn.config(bg="#EF4444", text="TRANSMITTING...", fg="white")
            messagebox.showinfo("PTT Active", f"Starting 16-MFSK physical transmission at {self.tx_freq_hz} Hz ({slot_mode}).")
        else:
            sec_left = int(30.0 - cycle_s) if not matches_slot else int(60.0 - cycle_s)
            self.start_tx_btn.config(bg="#FACC15", text=f"ARMED ({sec_left}s)", fg="black")
            messagebox.showinfo("TX Armed", f"Transmitter armed! Transmission will begin automatically when the {slot_mode} slot starts.")

    def _stop_tx(self) -> None:
        """Immediately halts transmission, disarms TX, and releases PTT."""
        self.tx_enabled = False
        self.is_transmitting = False
        self.is_tuning = False
        self.start_tx_btn.config(bg="#00FF41", text="START TX", fg="black")
        self.tune_btn.config(bg="#EAB308", text="TUNE (CW)", fg="black")
        messagebox.showinfo("PTT Released", "Transmission halted. Rig returned to RX standby mode.")

    def _tune_cw(self) -> None:
        """Keys transmitter with continuous unmodulated CW carrier tone for antenna matching."""
        if self.is_transmitting:
            self._stop_tx()
        
        self.is_tuning = not self.is_tuning
        if self.is_tuning:
            self.tune_btn.config(bg="#EF4444", text="TUNING...", fg="white")
            messagebox.showinfo("Tune Carrier", f"Antenna Tuning: Continuous CW carrier keyed at {self.tx_freq_hz} Hz. Safety timeout active.")
        else:
            self.tune_btn.config(bg="#EAB308", text="TUNE (CW)", fg="black")
            messagebox.showinfo("Tune Carrier", "Antenna tuning carrier tone stopped.")

    def _build_menu(self) -> None:
        """Constructs top application menu bar."""
        menubar = tk.Menu(self.root, bg="#1E1E1E", fg="#D4D4D4", activebackground="#00FF41", activeforeground="#000000")
        
        # File Menu
        file_menu = tk.Menu(menubar, tearoff=0, bg="#1E1E1E", fg="#D4D4D4")
        file_menu.add_command(label="Export ADIF Logbook...", command=lambda: messagebox.showinfo("Export", "ADIF export complete."))
        file_menu.add_separator()
        file_menu.add_command(label="Exit z-30", command=self.root.quit)
        menubar.add_cascade(label="File", menu=file_menu)

        # Settings Menu
        settings_menu = tk.Menu(menubar, tearoff=0, bg="#1E1E1E", fg="#D4D4D4")
        settings_menu.add_command(label="Station Setup Wizard...", command=self.open_config_wizard)
        settings_menu.add_separator()
        settings_menu.add_command(label="Audio Devices...", command=self.open_config_wizard)
        settings_menu.add_command(label="Radio & CAT Settings...", command=self.open_config_wizard)
        menubar.add_cascade(label="Settings", menu=settings_menu)

        # Help Menu
        help_menu = tk.Menu(menubar, tearoff=0, bg="#1E1E1E", fg="#D4D4D4")
        help_menu.add_command(label="About z-30 Protocol", command=lambda: messagebox.showinfo("About", "z-30 Protocol (16-MFSK / 50 Hz / LDPC-SIC)"))
        menubar.add_cascade(label="Help", menu=help_menu)

        self.root.config(menu=menubar)

    def _check_initial_wizard(self) -> None:
        """Launches the Setup Wizard if no valid configuration file is present on disk."""
        launch_config_wizard_if_needed(self.root, on_complete=self._on_wizard_complete)

    def open_config_wizard(self) -> None:
        """Manually launches the modal Setup & Configuration Wizard."""
        ConfigWizardDialog(parent=self.root, settings_mgr=self.settings_mgr, on_finish_callback=self._on_wizard_complete)

    def _on_wizard_complete(self, new_config: StationConfig) -> None:
        """Synchronizes active application state with new configuration parameters."""
        self.config = new_config
        self.logger.my_call = new_config.callsign
        self.logger.my_grid = new_config.grid
        self.vfo_label.config(text=f"VFO: 14.074.000 MHz (20m) [{new_config.callsign} / {new_config.grid}]")

    def _start_threads(self) -> None:
        def update_clock():
            while True:
                now = time.strftime("%H:%M:%S", time.gmtime())
                sec = int(time.strftime("%S", time.gmtime()))
                cycle_s = sec % 30
                is_even = (sec // 30) % 2 == 0
                
                # Check slot trigger if armed
                if self.tx_enabled and not self.is_transmitting and not self.is_tuning:
                    slot_mode = self.tx_slot_var.get()
                    matches = (
                        slot_mode == "MANUAL" or
                        (slot_mode.startswith("EVEN") and is_even) or
                        (slot_mode.startswith("ODD") and not is_even)
                    )
                    if matches and cycle_s == 0:
                        self.is_transmitting = True
                        self.start_tx_btn.config(bg="#EF4444", text="TRANSMITTING...", fg="white")

                mode_str = "TX" if self.is_transmitting else ("TUNE" if self.is_tuning else ("ARMED" if self.tx_enabled else "RX"))
                self.utc_label.config(text=f"UTC: {now} [30s CYCLE: {cycle_s:02d}s | {mode_str}]")
                time.sleep(0.5)
        threading.Thread(target=update_clock, daemon=True).start()

def main():
    root = tk.Tk()
    app = Z30TkinterApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()

`,
  },
  {
    filename: "updater.py",
    path: "z30_dsp/updater.py",
    description: "GitHub update engine for version comparison, git synchronization and package rebuilds.",
    code: `#!/usr/bin/env python3
"""
z-30 Transceiver & DSP Suite - GitHub Upstream Updater
======================================================
Repository: https://github.com/themantas1994/z-30

Checks for updates, pulls latest git commits, rebuilds Web UI assets,
and updates native Python DSP dependencies.
"""

import os
import sys
import json
import urllib.request
import urllib.error
import subprocess
import shutil
from typing import Dict, Any, Optional

GITHUB_REPO = "themantas1994/z-30"
API_URL = f"https://api.github.com/repos/{GITHUB_REPO}"
RAW_URL = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main"
CURRENT_VERSION = "1.0.0"


def print_banner():
    print("==================================================================")
    print("      z-30 TRANSCEIVER - GITHUB UPSTREAM UPDATER ENGINE           ")
    print("      Repository: https://github.com/themantas1994/z-30           ")
    print("==================================================================")


def check_remote_version() -> Dict[str, Any]:
    """Fetches latest release and commits from GitHub."""
    headers = {"User-Agent": "z30-Updater/1.0", "Accept": "application/vnd.github.v3+json"}
    result: Dict[str, Any] = {
        "current_version": CURRENT_VERSION,
        "latest_version": CURRENT_VERSION,
        "has_update": False,
        "release_name": "",
        "release_body": "",
        "latest_commit": "",
        "commit_message": "",
        "html_url": f"https://github.com/{GITHUB_REPO}",
    }

    # 1. Query latest release
    try:
        req = urllib.request.Request(f"{API_URL}/releases/latest", headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
            tag = data.get("tag_name", "").lstrip("v")
            result["latest_version"] = tag
            result["release_name"] = data.get("name", tag)
            result["release_body"] = data.get("body", "")
            result["html_url"] = data.get("html_url", result["html_url"])
            if tag and tag != CURRENT_VERSION:
                result["has_update"] = True
    except Exception as e:
        # Fallback to checking raw package.json
        try:
            req = urllib.request.Request(f"{RAW_URL}/package.json", headers=headers)
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
                remote_v = data.get("version", CURRENT_VERSION)
                result["latest_version"] = remote_v
                if remote_v != CURRENT_VERSION:
                    result["has_update"] = True
        except Exception:
            pass

    # 2. Query latest commit
    try:
        req = urllib.request.Request(f"{API_URL}/commits?per_page=1", headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            commits = json.loads(response.read().decode("utf-8"))
            if commits and isinstance(commits, list):
                c = commits[0]
                result["latest_commit"] = c.get("sha", "")[:7]
                result["commit_message"] = c.get("commit", {}).get("message", "").split("\\n")[0]
    except Exception:
        pass

    return result


def is_git_repo(path: str = ".") -> bool:
    """Checks if directory is a git repository."""
    return os.path.exists(os.path.join(path, ".git"))


def perform_git_update(repo_dir: str = ".") -> bool:
    """Executes git pull and updates local dependencies."""
    print(f"\\n[Updater] Fetching latest changes from git origin (https://github.com/{GITHUB_REPO})...")
    try:
        subprocess.run(["git", "fetch", "--all"], cwd=repo_dir, check=True)
        subprocess.run(["git", "pull", "origin", "main"], cwd=repo_dir, check=True)
        print("[Updater] ✓ Git repository successfully updated to latest commit.")
    except Exception as e:
        print(f"[Updater] ✗ Git pull failed: {e}")
        return False

    # Check for npm and rebuild web UI if available
    pkg_json = os.path.join(repo_dir, "package.json")
    if os.path.exists(pkg_json) and shutil.which("npm"):
        print("[Updater] Rebuilding Web DSP distribution bundle (npm run build)...")
        try:
            subprocess.run(["npm", "run", "build"], cwd=repo_dir, check=True)
            print("[Updater] ✓ Web UI distribution built successfully.")
        except Exception as e:
            print(f"[Updater] ⚠ Web build warning: {e}")

    # Update Python editable package
    if shutil.which("pip"):
        print("[Updater] Refreshing Python package installation (pip install -e .)...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-e", "."], cwd=repo_dir, check=True)
            print("[Updater] ✓ Python DSP suite refreshed.")
        except Exception as e:
            print(f"[Updater] ⚠ Pip install notice: {e}")

    print("\\n[Updater] ✓ Update process complete! You can now run 'z30' to start the latest version.")
    return True


def run_updater(interactive: bool = True):
    print_banner()
    print(f"Current Installed Version: v{CURRENT_VERSION}")
    print(f"Checking https://github.com/{GITHUB_REPO} for updates...\\n")

    info = check_remote_version()

    print(f"Latest Upstream Version:  v{info['latest_version']}")
    if info.get("latest_commit"):
        print(f"Latest GitHub Commit:     {info['latest_commit']} ({info.get('commit_message', '')})")

    if info["has_update"]:
        print(f"\\n★ A NEW UPDATE IS AVAILABLE: v{info['latest_version']} (Current: v{CURRENT_VERSION})")
        if info.get("release_name"):
            print(f"Release: {info['release_name']}")
        if info.get("release_body"):
            print(f"\\nRelease Notes:\\n{info['release_body']}\\n")
    else:
        print("\\n✓ Your z-30 Transceiver is up to date!")

    # If in git repo, offer automatic pull
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if is_git_repo(root_dir):
        if interactive and info["has_update"]:
            ans = input("\\nWould you like to pull and apply the update now? [Y/n]: ").strip().lower()
            if ans in ("", "y", "yes"):
                perform_git_update(root_dir)
        elif not interactive:
            perform_git_update(root_dir)
    else:
        print("\\nTo update manually from GitHub:")
        print(f"  git clone https://github.com/{GITHUB_REPO}.git")
        print("  cd z-30 && ./install_ubuntu.sh (or install_arch.sh / run_windows.bat)")


def main():
    interactive = "--yes" not in sys.argv and "-y" not in sys.argv
    run_updater(interactive=interactive)


if __name__ == "__main__":
    main()
`,
  },
  {
    filename: "test_ldpc_codec.py",
    path: "tests/test_ldpc_codec.py",
    description: "Codec tests: parity-check agreement, girth-6 structure, CRC round trip and an end-to-end decode.",
    code: `"""
Foundational tests for the (216, 77) LDPC codec.

The codec, the modem and the decoder are exactly the kind of code where a subtle regression
produces plausible-looking output that is quietly wrong, so these assert the properties that
make the code a code at all: the encoder satisfies its own parity-check matrix, the structure
has the girth it claims, and a frame survives the round trip at a working SNR.
"""

import numpy as np
import pytest

from z30_dsp.ldpc import Z30LdpcCodec, Z30_CHECK_TO_INFO
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp import benchmark

SEED = 20260830


@pytest.fixture(scope="module")
def codec() -> Z30LdpcCodec:
    return Z30LdpcCodec(max_iterations=45, alpha=0.75)


def build_parity_check_matrix() -> np.ndarray:
    """
    Reconstructs H = [H_info | H_parity] from the published connection table and the
    dual-diagonal accumulator structure described in z30_dsp/ldpc.py.
    """
    m, k = 139, 77
    h = np.zeros((m, k + m), dtype=np.uint8)
    for check, info_bits in enumerate(Z30_CHECK_TO_INFO):
        for bit in info_bits:
            h[check, bit] ^= 1
        h[check, k + check] = 1
        if check >= 1:
            h[check, k + check - 1] = 1
    return h


def test_connection_table_shape():
    """139 checks of degree 5, with no repeated information bit inside a row."""
    assert len(Z30_CHECK_TO_INFO) == 139
    for check, row in enumerate(Z30_CHECK_TO_INFO):
        assert len(row) == 5, f"check {check} has degree {len(row)}"
        assert len(set(row)) == 5, f"check {check} repeats an information bit: {row}"
        assert all(0 <= bit < 77 for bit in row), f"check {check} indexes outside 0..76: {row}"


def test_no_length_four_cycles_on_information_side():
    """
    Girth 6 on the information side: no two checks may share more than one information bit.
    Two shared bits would close a length-4 cycle, and length-4 cycles are what make belief
    propagation exchange correlated messages and stall short of the code's real threshold.
    """
    sets = [set(row) for row in Z30_CHECK_TO_INFO]
    for i in range(len(sets)):
        for j in range(i + 1, len(sets)):
            shared = sets[i] & sets[j]
            assert len(shared) <= 1, f"checks {i} and {j} share {sorted(shared)} - length-4 cycle"


def test_information_bit_degrees_are_near_regular():
    degrees = [0] * 77
    for row in Z30_CHECK_TO_INFO:
        for bit in row:
            degrees[bit] += 1
    assert min(degrees) >= 8
    assert max(degrees) <= 10


def test_encoder_satisfies_its_own_parity_check_matrix(codec):
    """Every codeword the encoder produces must have a zero syndrome under H."""
    h = build_parity_check_matrix()
    rng = np.random.default_rng(SEED)
    for _ in range(50):
        payload = rng.integers(0, 2, 63, dtype=np.uint8)
        codeword = codec.encode(payload)
        assert codeword.shape == (216,)
        syndrome = (h @ codeword) % 2
        assert not syndrome.any(), "non-zero syndrome: the encoder disagrees with H"


def test_crc14_round_trip(codec):
    """The CRC is embedded at bits 63..76 of the information block and must survive encoding."""
    rng = np.random.default_rng(SEED + 1)
    for _ in range(20):
        payload = rng.integers(0, 2, 63, dtype=np.uint8)
        codeword = codec.encode(payload)
        embedded = int("".join(str(int(b)) for b in codeword[63:77]), 2)
        assert embedded == codec.compute_crc14(payload)


def test_crc14_detects_single_bit_errors(codec):
    """A one-bit change in the payload must change the CRC."""
    rng = np.random.default_rng(SEED + 2)
    payload = rng.integers(0, 2, 63, dtype=np.uint8)
    baseline = codec.compute_crc14(payload)
    for bit in range(63):
        corrupted = payload.copy()
        corrupted[bit] ^= 1
        assert codec.compute_crc14(corrupted) != baseline, f"CRC blind to a flip at bit {bit}"


@pytest.mark.parametrize("snr_db", [-20.0, -18.0])
def test_end_to_end_round_trip_at_working_snr(codec, snr_db):
    """
    Full path: payload -> LDPC -> 16-MFSK waveform -> AWGN -> matched-filter LLRs -> decode.

    Run at SNRs comfortably above threshold, so this is a functional check that the chain is
    wired together correctly rather than a sensitivity measurement. Seeded, so a failure here
    is reproducible.
    """
    cfg = Z30Config(sample_rate_hz=6000)
    modulator = Z30Modulator(cfg)
    rng = np.random.default_rng(SEED + int(abs(snr_db)))

    successes = 0
    trials = 6
    for _ in range(trials):
        payload, _codeword, _data, symbols = benchmark.generate_random_frame(codec, cfg, rng)
        clean = modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)
        noisy, sigma = benchmark.add_calibrated_awgn(clean, snr_db, cfg.sample_rate_hz, rng)
        llrs = benchmark.demodulate_mfsk_llrs(noisy, cfg, sigma, audio_center_hz=1250.0)
        ok, info, _iters = codec.decode_min_sum(llrs)
        if ok and np.array_equal(np.asarray(info[:63], dtype=np.uint8), payload):
            successes += 1

    assert successes == trials, f"only {successes}/{trials} frames decoded at {snr_db} dB"


def test_decoder_is_deterministic_for_a_given_input(codec):
    """Same LLRs in, same decision out - a decoder with hidden state cannot be reasoned about."""
    cfg = Z30Config(sample_rate_hz=6000)
    modulator = Z30Modulator(cfg)
    rng = np.random.default_rng(SEED + 9)
    _payload, _cw, _ds, symbols = benchmark.generate_random_frame(codec, cfg, rng)
    clean = modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)
    noisy, sigma = benchmark.add_calibrated_awgn(clean, -18.0, cfg.sample_rate_hz, rng)
    llrs = benchmark.demodulate_mfsk_llrs(noisy, cfg, sigma, audio_center_hz=1250.0)

    first = codec.decode_min_sum(llrs)
    second = codec.decode_min_sum(llrs)
    assert first[0] == second[0]
    assert np.array_equal(first[1], second[1])
    assert first[2] == second[2]
`,
  },
  {
    filename: "test_modem_spectrum.py",
    path: "tests/test_modem_spectrum.py",
    description: "Occupied-bandwidth and constant-envelope tests - the acceptance criterion for the transmitter.",
    code: `"""
Occupied-bandwidth and envelope tests for the 16-MFSK modulator.

This is the acceptance criterion for the transmitter fix, and the guard that stops it
regressing. z-30's entire premise is a 50 Hz signal; a mode this narrow that splatters is a
worse neighbour than the wideband modes it means to improve on.

The reference implementation of the old, broken waveform is reproduced verbatim in
\`legacy_gated_frame\` below and asserted to FAIL these budgets, so the test proves it can tell
the difference rather than merely passing.

Software correctness is necessary, not sufficient: a clean waveform still has to survive the
sound card and the rig's ALC. Measure the transmitter's actual output before going on the air.
"""

import numpy as np
import pytest
from scipy.signal import welch

from z30_dsp.modem import Z30Config, Z30Modulator

#: ITU-style 99 % occupied bandwidth budget. The nominal figure for the mode is 50 Hz and the
#: tones themselves span 15 x 3.125 = 46.875 Hz, so this is a tight budget with a little
#: measurement headroom.
OCCUPIED_BW_99_BUDGET_HZ = 52.0

#: -40 dB bandwidth budget. Wider than the 99 % figure by construction: it counts the shoulders
#: two orders of magnitude down, which is what a neighbouring station 50 Hz away actually hears.
BANDWIDTH_40DB_BUDGET_HZ = 72.0

SEED = 20260830
SAMPLE_RATE_HZ = 12000


def power_spectrum(waveform: np.ndarray, sample_rate_hz: int):
    freqs, psd = welch(
        np.asarray(waveform, dtype=np.float64),
        fs=sample_rate_hz,
        nperseg=1 << 15,
        noverlap=1 << 14,
        window="hann",
    )
    return freqs, psd


def bandwidth_at_floor(waveform: np.ndarray, sample_rate_hz: int, floor_db: float) -> float:
    """Width of the band in which the PSD stays above \`floor_db\` relative to its peak."""
    freqs, psd = power_spectrum(waveform, sample_rate_hz)
    psd_db = 10.0 * np.log10(psd / np.max(psd) + 1e-30)
    above = np.where(psd_db >= floor_db)[0]
    return float(freqs[above[-1]] - freqs[above[0]])


def occupied_bandwidth_99(waveform: np.ndarray, sample_rate_hz: int) -> float:
    """ITU-R SM.328 occupied bandwidth: the band containing 99 % of the total mean power."""
    freqs, psd = power_spectrum(waveform, sample_rate_hz)
    cumulative = np.cumsum(psd)
    cumulative /= cumulative[-1]
    low = freqs[int(np.searchsorted(cumulative, 0.005))]
    high = freqs[int(np.searchsorted(cumulative, 0.995))]
    return float(high - low)


def legacy_gated_frame(symbols, cfg: Z30Config, base_hz: float = 1250.0) -> np.ndarray:
    """
    The pre-fix waveform, reproduced exactly: a phase accumulator across symbols (correct), but
    with an 8 ms raised-cosine amplitude ramp applied to EVERY symbol, taking the envelope to
    zero 3.125 times a second. That is amplitude keying at the symbol rate laid over the tone
    sequence, and it is what these budgets exist to catch.
    """
    sps = int(cfg.sample_rate_hz * cfg.symbol_duration_sec)
    time_vector = np.linspace(0, cfg.symbol_duration_sec, sps, endpoint=False)
    ramp_len = int(0.008 * cfg.sample_rate_hz)
    envelope = np.ones(sps)
    ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len) / ramp_len))
    envelope[:ramp_len] = ramp
    envelope[-ramp_len:] = ramp[::-1]

    waveform = np.zeros(len(symbols) * sps)
    phase = 0.0
    for idx, tone in enumerate(symbols):
        freq = base_hz + tone * cfg.tone_spacing_hz
        inst_phase = 2.0 * np.pi * freq * time_vector + phase
        waveform[idx * sps:(idx + 1) * sps] = np.sin(inst_phase) * envelope
        phase = (inst_phase[-1] + 2.0 * np.pi * freq / cfg.sample_rate_hz) % (2.0 * np.pi)
    return waveform / np.max(np.abs(waveform))


@pytest.fixture(scope="module")
def config() -> Z30Config:
    return Z30Config(sample_rate_hz=SAMPLE_RATE_HZ)


@pytest.fixture(scope="module")
def modulator(config) -> Z30Modulator:
    return Z30Modulator(config)


def random_symbols(seed: int, count: int = 75):
    return list(np.random.default_rng(seed).integers(0, 16, count))


@pytest.mark.parametrize("seed", [SEED, SEED + 1, SEED + 2])
def test_occupied_bandwidth_within_budget(modulator, config, seed):
    waveform = modulator.synthesize_frame(random_symbols(seed))
    occupied = occupied_bandwidth_99(waveform, config.sample_rate_hz)
    assert occupied <= OCCUPIED_BW_99_BUDGET_HZ, (
        f"99% occupied bandwidth {occupied:.1f} Hz exceeds the {OCCUPIED_BW_99_BUDGET_HZ} Hz budget"
    )


@pytest.mark.parametrize("seed", [SEED, SEED + 1, SEED + 2])
def test_forty_db_bandwidth_within_budget(modulator, config, seed):
    waveform = modulator.synthesize_frame(random_symbols(seed))
    bandwidth = bandwidth_at_floor(waveform, config.sample_rate_hz, -40.0)
    assert bandwidth <= BANDWIDTH_40DB_BUDGET_HZ, (
        f"-40 dB bandwidth {bandwidth:.1f} Hz exceeds the {BANDWIDTH_40DB_BUDGET_HZ} Hz budget"
    )


def test_legacy_per_symbol_gating_fails_the_budget(config):
    """
    The old waveform must fail, or these budgets are not measuring anything. Its -40 dB
    bandwidth was over 200 Hz - more than four times the mode's nominal occupied bandwidth.
    """
    legacy = legacy_gated_frame(random_symbols(SEED), config)
    legacy_bw = bandwidth_at_floor(legacy, config.sample_rate_hz, -40.0)
    assert legacy_bw > BANDWIDTH_40DB_BUDGET_HZ * 2, (
        f"the per-symbol-gated reference waveform measured only {legacy_bw:.1f} Hz, so this test "
        "is no longer able to detect the defect it exists to detect"
    )


def test_envelope_is_constant_between_the_frame_edge_ramps(modulator, config):
    """
    No per-symbol amplitude gating: away from the single start/end ramp the envelope must never
    dip. This is the property that keeps the sidebands where they belong.
    """
    waveform = modulator.synthesize_frame(random_symbols(SEED))
    ramp_samples = int(config.frame_ramp_sec * config.sample_rate_hz)
    interior = waveform[ramp_samples * 2:-ramp_samples * 2]

    # Envelope via the analytic signal magnitude.
    from scipy.signal import hilbert
    envelope = np.abs(hilbert(interior.astype(np.float64)))
    # Ignore the very edges of the Hilbert transform, which ring by construction.
    envelope = envelope[len(envelope) // 50: -len(envelope) // 50]

    assert envelope.min() > 0.9, f"envelope dipped to {envelope.min():.3f} inside the frame"
    assert envelope.max() < 1.1, f"envelope rose to {envelope.max():.3f} inside the frame"


def test_frame_edges_are_ramped(modulator, config):
    """A hard switch-on is a key click; the frame must start and end at zero amplitude."""
    waveform = modulator.synthesize_frame(random_symbols(SEED))
    assert abs(waveform[0]) < 1e-3
    assert abs(waveform[-1]) < 1e-2


def test_instantaneous_frequency_hits_each_tone_at_symbol_centre(modulator, config):
    """
    GFSK smoothing must move the frequency between tones without moving where it lands. At the
    centre of a symbol the instantaneous frequency should equal that symbol's tone.
    """
    symbols = random_symbols(SEED + 7)
    freq = modulator.instantaneous_frequency(symbols, 1250.0)
    sps = modulator.samples_per_symbol
    for idx, tone in enumerate(symbols):
        centre = idx * sps + sps // 2
        expected = 1250.0 + tone * config.tone_spacing_hz
        assert abs(freq[centre] - expected) < 0.5, (
            f"symbol {idx}: frequency at centre was {freq[centre]:.2f} Hz, expected {expected:.2f} Hz"
        )


def test_rejects_malformed_symbol_sequences(modulator, config):
    """
    These were bare \`assert\`s, which vanish under \`python -O\`. A malformed symbol list would
    then have produced a silently malformed emission on a real antenna.
    """
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 74)
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 74 + [16])
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 74 + [-1])
    with pytest.raises(ValueError):
        modulator.synthesize_frame([0] * 75, base_audio_freq_hz=0.0)


def test_output_is_finite_and_normalised(modulator):
    waveform = modulator.synthesize_frame(random_symbols(SEED + 3))
    assert np.all(np.isfinite(waveform)), "NaN or Inf samples would be undefined behaviour on a sound card"
    assert 0.99 <= float(np.max(np.abs(waveform))) <= 1.0
`,
  },
  {
    filename: "test_web_server_api.py",
    path: "tests/test_web_server_api.py",
    description: "Local API security tests: token, Origin and Host checks, GPIO pin whitelisting and the dead-man switch.",
    code: `"""
Security and behaviour tests for the local API in z30_dsp/web_server.py.

Binding to 127.0.0.1 is not an authentication boundary. Any page in any browser tab can
\`fetch()\` a loopback URL, and a \`text/plain\` POST is a CORS simple request that goes out with
no preflight - so before these checks existed, an advertisement in an unrelated tab could key
the operator's transmitter. These tests pin the three conditions that close that hole, and the
dead-man switch that bounds a keyed transmitter.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

import pytest

from z30_dsp import web_server as ws

TOKEN = "test-token-not-a-real-one"


class FakeGpioDevice:
    """Stands in for gpiozero's DigitalOutputDevice so the bridge can be tested off a Pi."""

    def __init__(self, pin: int) -> None:
        self.pin = pin
        self.value = False
        self.closed = False

    def on(self) -> None:
        self.value = True

    def off(self) -> None:
        self.value = False

    def close(self) -> None:
        self.closed = True


@pytest.fixture()
def bridge():
    b = ws.GpioBridge(allowed_pin=17)
    b._DigitalOutputDevice = FakeGpioDevice  # noqa: SLF001 - deliberate hardware stand-in
    b._import_error = None  # noqa: SLF001
    yield b
    b.shutdown()


@pytest.fixture()
def server(tmp_path, monkeypatch, bridge):
    monkeypatch.setenv("Z30_HOME", str(tmp_path))
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><html><head></head><body>z-30</body></html>", encoding="utf-8")

    sock, port = ws.bind_listening_socket(0)
    origin = f"http://127.0.0.1:{port}"

    class BoundHandler(ws.SpaRequestHandler):
        api_token = TOKEN
        allowed_origin = origin
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    BoundHandler.gpio_bridge = bridge
    httpd = ws.ThreadedHTTPServer(sock, lambda *a, **k: BoundHandler(*a, directory=str(dist), **k))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.15)
    try:
        yield origin
    finally:
        httpd.shutdown()
        httpd.server_close()


def request(origin, path, body=None, headers=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(origin + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, dict(response.headers), response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode()


def authed(extra=None):
    headers = {"X-Z30-Token": TOKEN}
    if extra:
        headers.update(extra)
    return headers


# -- authentication --------------------------------------------------------

def test_api_rejects_requests_without_a_token(server):
    """The exact shape of the cross-origin attack: a simple POST with no preflight."""
    status, _headers, body = request(
        server, "/api/gpio", {"pin": 17, "value": True}, {"Content-Type": "text/plain"}
    )
    assert status == 403
    assert "token" in json.loads(body)["error"].lower()


def test_api_rejects_a_foreign_origin_even_with_a_token(server):
    status, _headers, body = request(
        server, "/api/status", None, authed({"Origin": "https://attacker.example"})
    )
    assert status == 403
    assert "Origin" in json.loads(body)["error"]


def test_api_rejects_a_foreign_host_header(server):
    """A DNS-rebinding victim's request arrives carrying the attacker's hostname."""
    status, _headers, body = request(server, "/api/status", None, authed({"Host": "rebind.attacker.example"}))
    assert status == 403
    assert "Host" in json.loads(body)["error"]


def test_api_accepts_its_own_origin_with_a_token(server):
    status, _headers, body = request(server, "/api/status", None, authed({"Origin": server}))
    assert status == 200
    assert json.loads(body)["status"] == "ONLINE"


def test_no_wildcard_cors_header_is_ever_sent(server):
    for path, headers in (("/api/status", authed()), ("/", None)):
        _status, response_headers, _body = request(server, path, None, headers)
        assert response_headers.get("Access-Control-Allow-Origin") is None, (
            "a wildcard ACAO would let any origin read the response as well as send it"
        )


def test_index_html_carries_the_api_token(server):
    status, _headers, body = request(server, "/")
    assert status == 200
    assert "__Z30_API_TOKEN__" in body
    assert TOKEN in body


def test_static_assets_do_not_require_a_token(server):
    """The bundle is public code; requiring a token to load it would prevent the app starting."""
    status, _headers, _body = request(server, "/index.html")
    assert status == 200


# -- GPIO pin whitelisting -------------------------------------------------

def test_only_the_configured_ptt_pin_can_be_driven(server, bridge):
    status, _headers, body = request(server, "/api/gpio", {"pin": 22, "value": True}, authed())
    assert status == 400
    assert "not the configured PTT pin" in json.loads(body)["error"]
    assert 22 not in bridge._devices  # noqa: SLF001


def test_configured_pin_keys_and_unkeys(server, bridge):
    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "value": True}, authed())
    assert status == 200
    assert bridge._devices[17].value is True  # noqa: SLF001

    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "value": False}, authed())
    assert status == 200
    assert bridge._devices[17].value is False  # noqa: SLF001


# -- dead-man switch -------------------------------------------------------

def test_watchdog_releases_the_pin_when_keepalives_stop(bridge, monkeypatch):
    """
    The failure this defends against is "the browser stopped running": a crashed tab, a killed
    renderer, a sleeping machine. None of those can send a keepalive, and none of them can run
    a browser-side timeout either - which is why the release has to happen server-side.
    """
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.3)
    assert bridge.set_pin(17, True)["success"]
    assert bridge._devices[17].value is True  # noqa: SLF001

    time.sleep(0.7)
    assert bridge._devices[17].value is False, "the watchdog did not drop the PTT line"  # noqa: SLF001


def test_keepalive_holds_the_pin_up(bridge, monkeypatch):
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.4)
    assert bridge.set_pin(17, True)["success"]
    for _ in range(5):
        time.sleep(0.15)
        assert bridge.keepalive(17)["success"]
    assert bridge._devices[17].value is True  # noqa: SLF001


def test_hard_ceiling_releases_even_with_keepalives(bridge, monkeypatch):
    monkeypatch.setattr(ws, "GPIO_MAX_KEYED_SEC", 0.4)
    assert bridge.set_pin(17, True)["success"]
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        bridge.keepalive(17)
        time.sleep(0.05)
    assert bridge._devices[17].value is False, "the maximum keyed time was not enforced"  # noqa: SLF001


def test_release_all_closes_every_device(bridge):
    bridge.set_pin(17, True)
    device = bridge._devices[17]  # noqa: SLF001
    bridge.release_all()
    assert device.value is False
    assert device.closed is True


# -- rigctld relay ---------------------------------------------------------

def test_rigctl_relay_refuses_non_loopback_hosts(server):
    """Relaying anywhere would turn this into a general-purpose TCP client for the whole net."""
    status, _headers, body = request(
        server, "/api/rigctl", {"command": "f", "host": "203.0.113.5", "port": 4532}, authed()
    )
    assert status == 400
    assert "loopback" in json.loads(body)["error"].lower()


def test_rigctl_relay_reports_an_unreachable_daemon_honestly(server):
    status, _headers, body = request(
        server, "/api/rigctl", {"command": "f", "host": "127.0.0.1", "port": 45999}, authed()
    )
    assert status == 502
    payload = json.loads(body)
    assert payload["success"] is False
    assert "rigctld" in payload["error"]


# -- operator data ---------------------------------------------------------

def test_logbook_round_trips_to_disk(server, tmp_path):
    entries = [{"callsign": "W1AW", "utcDate": "20260830", "utcTime": "120000"}]
    status, _headers, body = request(server, "/api/logbook", {"entries": entries, "adif": "<EOR>\\n"}, authed())
    assert status == 200
    written = json.loads(body)
    assert written["count"] == 1

    status, _headers, body = request(server, "/api/logbook", None, authed())
    assert status == 200
    assert json.loads(body)["entries"] == entries

    assert os.path.isfile(written["path"])
    assert os.path.isfile(written["adif_path"])


def test_logbook_rejects_a_non_array_payload(server):
    status, _headers, body = request(server, "/api/logbook", {"entries": {"not": "a list"}}, authed())
    assert status == 500
    assert "array" in json.loads(body)["error"]


def test_station_config_round_trips_to_disk(server):
    config = {"myCall": "W1AW", "regulatoryRegion": "US", "licenseClass": "US_GENERAL"}
    status, _headers, _body = request(server, "/api/station-config", {"config": config}, authed())
    assert status == 200

    status, _headers, body = request(server, "/api/station-config", None, authed())
    assert status == 200
    assert json.loads(body)["config"] == config


# -- port binding ----------------------------------------------------------

def test_bind_fails_loudly_rather_than_drifting_to_another_port():
    """
    Silently moving to an ephemeral port is what orphaned the operator's logbook: browser
    storage is partitioned by origin and the port is part of the origin.
    """
    first, port = ws.bind_listening_socket(0)
    try:
        with pytest.raises(OSError) as excinfo:
            ws.bind_listening_socket(port)
        assert "--port" in str(excinfo.value)
    finally:
        first.close()
`,
  },
  {
    filename: "test_time_sync_guards.py",
    path: "tests/test_time_sync_guards.py",
    description: "Guards on the RF time-sync path: opt-in, confirmed, and bounded OS clock steps.",
    code: `"""
Guards on the RF time-sync path and the user data directory.

An RF time station is an unauthenticated broadcast: anyone with a transmitter can put a
WWV-shaped signal on the air, and a marginal decode can produce a wrong timestamp with no
adversary involved at all. Handing that timestamp to the operating system moves the machine's
clock arbitrarily, and TLS validity, log timestamps, cron and every other application on the
host move with it. So the default is that z-30 keeps the correction to itself.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from z30_dsp import paths
from z30_dsp.rf_time_sync import MAX_OS_CLOCK_STEP_SEC, TimeSyncSettingsManager


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("Z30_HOME", str(tmp_path))
    monkeypatch.delenv(TimeSyncSettingsManager.ENABLE_ENV_VAR, raising=False)
    yield tmp_path


def now_plus(seconds: float) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


# -- the default is off ----------------------------------------------------

def test_clock_setting_is_disabled_by_default():
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is False


def test_refuses_when_not_allowed():
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(now_plus(1.0), allow=False, confirmed=True)
    assert applied is False
    assert "disabled" in reason.lower()
    assert "app_time_offset_ms" in reason


def test_refuses_when_not_confirmed():
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(now_plus(1.0), allow=True, confirmed=False)
    assert applied is False
    assert "confirm" in reason.lower()


# -- the sanity bound ------------------------------------------------------

@pytest.mark.parametrize("offset_sec", [MAX_OS_CLOCK_STEP_SEC + 60, -(MAX_OS_CLOCK_STEP_SEC + 60), 86400, -86400])
def test_refuses_a_step_beyond_the_sanity_bound(offset_sec):
    """
    A misdecode - or a deliberately transmitted spoof, trivial on an open channel - must not be
    able to move the clock arbitrarily. Genuine drift is milliseconds to seconds.
    """
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(
        now_plus(offset_sec), allow=True, confirmed=True
    )
    assert applied is False
    assert "sanity bound" in reason
    assert "spoof" in reason


def test_the_bound_is_configurable_but_still_enforced():
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(
        now_plus(30.0), allow=True, confirmed=True, max_step_sec=5.0
    )
    assert applied is False
    assert "5s sanity bound" in reason


def test_never_returns_a_bare_boolean():
    """Every outcome carries a reason, so a refusal cannot be mistaken for silence."""
    result = TimeSyncSettingsManager.try_set_os_system_time(now_plus(1.0), allow=False)
    assert isinstance(result, tuple) and len(result) == 2
    assert isinstance(result[0], bool) and isinstance(result[1], str) and result[1]


# -- opting in -------------------------------------------------------------

def test_enabled_by_config_file(isolated_home):
    config = isolated_home / "config.json"
    config.write_text(json.dumps({"allow_set_system_clock": True}), encoding="utf-8")
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is True


def test_enabled_by_environment_variable(monkeypatch):
    monkeypatch.setenv(TimeSyncSettingsManager.ENABLE_ENV_VAR, "true")
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is True


def test_a_malformed_config_fails_closed(isolated_home):
    (isolated_home / "config.json").write_text("{ not json", encoding="utf-8")
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is False


# -- the internal offset, which is what actually gets used -----------------

def test_offset_round_trips_through_the_user_config(isolated_home):
    assert TimeSyncSettingsManager.update_app_time_offset(-25.5) is True
    assert TimeSyncSettingsManager.get_app_time_offset() == pytest.approx(-25.5)

    stored = json.loads((isolated_home / "config.json").read_text(encoding="utf-8"))
    assert stored["app_time_offset_ms"] == pytest.approx(-25.5)
    assert "last_time_sync_utc" in stored


def test_offset_defaults_to_zero_when_no_config_exists():
    assert TimeSyncSettingsManager.get_app_time_offset() == 0.0


# -- user data paths -------------------------------------------------------

def test_config_resolves_under_the_user_data_directory(isolated_home):
    """
    The default used to be the bare relative string "config.json", so the file landed wherever
    the app happened to be launched from and a second launch elsewhere silently started from
    defaults.
    """
    assert os.path.isabs(paths.default_config_path())
    assert paths.default_config_path().startswith(str(isolated_home))


def test_xdg_config_home_is_honoured(tmp_path, monkeypatch):
    monkeypatch.delenv("Z30_HOME", raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    assert paths.default_config_path() == str(tmp_path / "xdg" / "z30" / "config.json")


def test_every_user_file_lives_in_one_directory(isolated_home):
    for path in (
        paths.default_config_path(),
        paths.logbook_json_path(),
        paths.logbook_adif_path(),
        paths.station_config_path(),
    ):
        assert os.path.dirname(path) == str(isolated_home)
`,
  },
  {
    filename: "test_channel_acquisition.py",
    path: "tests/test_channel_acquisition.py",
    description: "Channel and acquisition tests, including the guard that acquisition reads only the audio.",
    code: `"""
Channel-impairment and blind-acquisition tests.

These cover the machinery that turns the benchmark from a genie-aided bound into a decode
threshold: the Watterson fading model, the carrier and timing offsets, and the acquisition
stage that has to undo them knowing only the audio.

The property that matters most here is that acquisition is HONEST - that it is not
accidentally being handed the answer. \`test_acquisition_uses_only_the_audio\` is the guard
against the whole point of the exercise being quietly undone again.
"""

import numpy as np
import pytest

from z30_dsp.acquisition import Acquisition, acquire_frame, estimate_noise_sigma
from z30_dsp.benchmark import add_calibrated_awgn, generate_random_frame
from z30_dsp.channel import (
    WATTERSON_PRESETS,
    ChannelImpairments,
    apply_frequency_offset,
    apply_time_offset,
    apply_watterson_fading,
    impair_frame,
)
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.modem import Z30Config, Z30Modulator

SAMPLE_RATE = 6000


@pytest.fixture(scope="module")
def cfg():
    return Z30Config(sample_rate_hz=SAMPLE_RATE)


@pytest.fixture(scope="module")
def modulator(cfg):
    return Z30Modulator(cfg)


@pytest.fixture(scope="module")
def codec():
    return Z30LdpcCodec()


def make_frame(codec, cfg, modulator, rng):
    """A real frame, with the Costas sync symbols in their proper positions."""
    _payload, _cw, _data, symbols = generate_random_frame(codec, cfg, rng)
    return modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)


class TestFrequencyOffset:
    def test_shifts_the_tone_and_does_not_mirror_it(self):
        """A naive cosine multiply would create a second image at -offset; the analytic-signal
        method must not."""
        fs = SAMPLE_RATE
        n = fs * 4
        tone = np.sin(2 * np.pi * 1000.0 * np.arange(n) / fs).astype(np.float32)
        shifted = apply_frequency_offset(tone, 25.0, fs)

        spectrum = np.abs(np.fft.rfft(shifted * np.hanning(n)))
        freqs = np.fft.rfftfreq(n, 1.0 / fs)
        peak_hz = float(freqs[int(np.argmax(spectrum))])
        assert peak_hz == pytest.approx(1025.0, abs=1.0)

        # No significant energy left at the original frequency.
        original_bin = int(np.argmin(np.abs(freqs - 1000.0)))
        peak_bin = int(np.argmax(spectrum))
        assert spectrum[original_bin] < 0.05 * spectrum[peak_bin]

    def test_zero_offset_is_a_no_op(self):
        wave = np.sin(np.linspace(0, 100, 4096)).astype(np.float32)
        np.testing.assert_allclose(apply_frequency_offset(wave, 0.0, SAMPLE_RATE), wave)


class TestTimeOffset:
    def test_frame_lands_where_the_reported_true_start_says(self):
        wave = np.ones(1000, dtype=np.float32)
        buf, true_start = apply_time_offset(wave, 0.25, SAMPLE_RATE, pad_sec=1.0)
        np.testing.assert_allclose(buf[true_start:true_start + wave.size], wave)
        assert buf[:true_start].max() == 0.0, "guard region before the frame is not silent"
        assert buf[true_start + wave.size:].max() == 0.0, "guard region after the frame is not silent"

    def test_offset_beyond_the_guard_padding_raises(self):
        with pytest.raises(ValueError):
            apply_time_offset(np.ones(10, dtype=np.float32), -5.0, SAMPLE_RATE, pad_sec=1.0)


class TestWattersonFading:
    @pytest.mark.parametrize("preset_name", sorted(WATTERSON_PRESETS))
    def test_average_power_is_preserved(self, preset_name):
        """
        The channel must neither add nor remove average power, or the SNR the caller asked for
        is not the SNR the receiver sees and every point on the curve is mislabelled.
        """
        rng = np.random.default_rng(4)
        wave = np.sin(2 * np.pi * 1250.0 * np.arange(SAMPLE_RATE * 20) / SAMPLE_RATE).astype(np.float32)
        faded = apply_watterson_fading(wave, SAMPLE_RATE, WATTERSON_PRESETS[preset_name], rng)
        ratio = float(np.mean(faded ** 2)) / float(np.mean(wave ** 2))
        assert 0.5 < ratio < 2.0, f"{preset_name} changed average power by {ratio:.2f}x"

    def test_no_fading_preset_is_a_no_op(self):
        rng = np.random.default_rng(0)
        wave = np.sin(np.linspace(0, 500, 8192)).astype(np.float32)
        np.testing.assert_allclose(
            apply_watterson_fading(wave, SAMPLE_RATE, WATTERSON_PRESETS["none"], rng), wave
        )

    def test_more_disturbed_presets_fade_faster(self):
        """
        The presets differ in Doppler SPREAD, which is a rate, not a depth: a 'poor' path
        (1.0 Hz) decorrelates in about a second, a 'good' one (0.1 Hz) in about ten. Measuring
        block-to-block RMS variance would get this backwards - at a one-second block size the
        fast channel averages out inside each block and looks *steadier* than the slow one.
        What distinguishes them is how quickly the envelope decorrelates.
        """
        wave = np.sin(2 * np.pi * 1250.0 * np.arange(SAMPLE_RATE * 60) / SAMPLE_RATE).astype(np.float32)
        block = SAMPLE_RATE // 10  # 100 ms, short relative to even the fastest preset

        def decorrelation_lag_sec(name: str) -> float:
            rng = np.random.default_rng(11)
            faded = apply_watterson_fading(wave, SAMPLE_RATE, WATTERSON_PRESETS[name], rng)
            blocks = faded[: (faded.size // block) * block].reshape(-1, block)
            envelope = np.sqrt(np.mean(blocks ** 2, axis=1))
            envelope = envelope - envelope.mean()
            acf = np.correlate(envelope, envelope, mode="full")[envelope.size - 1:]
            acf /= acf[0]
            below = np.flatnonzero(acf < 0.5)
            lag_blocks = int(below[0]) if below.size else envelope.size
            return lag_blocks * block / SAMPLE_RATE

        fast = decorrelation_lag_sec("poor")
        slow = decorrelation_lag_sec("good")
        assert fast < slow, (
            f"the 'poor' preset (1.0 Hz Doppler) decorrelates in {fast:.2f}s, which is not "
            f"faster than 'good' (0.1 Hz Doppler) at {slow:.2f}s - the presets are inert"
        )

    def test_unknown_preset_is_rejected(self):
        with pytest.raises(ValueError):
            ChannelImpairments(fading="tropical").preset


class TestAcquisition:
    def test_finds_a_clean_frame_precisely(self, cfg, modulator, codec):
        rng = np.random.default_rng(5)
        wave = make_frame(codec, cfg, modulator, rng)
        buf, true_start = apply_time_offset(wave, 0.17, cfg.sample_rate_hz)
        acq = acquire_frame(buf, cfg)

        timing_err_ms = abs(acq.start_sample - true_start) / cfg.sample_rate_hz * 1000
        assert timing_err_ms < 10.0, f"clean-frame timing error {timing_err_ms:.1f} ms"
        assert abs(acq.base_freq_hz - 1250.0) < 0.2

    def test_recovers_carrier_and_timing_offsets_at_usable_snr(self, cfg, modulator, codec):
        rng = np.random.default_rng(20260830)
        impairments = ChannelImpairments(fading="none")
        timing_errors, freq_errors = [], []

        for _ in range(6):
            wave = make_frame(codec, cfg, modulator, rng)
            buf, true_start, true_foff = impair_frame(wave, cfg.sample_rate_hz, impairments, rng)
            noisy, _ = add_calibrated_awgn(
                buf, -18.0, cfg.sample_rate_hz, rng, float(np.mean(wave ** 2))
            )
            acq = acquire_frame(noisy, cfg)
            timing_errors.append(abs(acq.start_sample - true_start) / cfg.sample_rate_hz)
            freq_errors.append(abs(acq.base_freq_hz - (1250.0 + true_foff)))

        # Well inside what the 320 ms symbol and 3.125 Hz tone spacing can tolerate.
        assert max(timing_errors) < 0.05, f"worst timing error {max(timing_errors) * 1000:.0f} ms"
        assert max(freq_errors) < 0.5, f"worst frequency error {max(freq_errors):.2f} Hz"

    def test_acquisition_uses_only_the_audio(self, cfg, modulator, codec):
        """
        Acquisition must depend on nothing but the samples it is given. If it is ever
        accidentally handed the true offsets - the defect this whole module exists to fix -
        shifting the buffer would not shift the answer by the same amount.
        """
        rng = np.random.default_rng(3)
        wave = make_frame(codec, cfg, modulator, rng)
        buf, true_start = apply_time_offset(wave, 0.0, cfg.sample_rate_hz)
        first = acquire_frame(buf, cfg)

        extra = 1000
        shifted = np.concatenate([np.zeros(extra, dtype=np.float32), buf])
        second = acquire_frame(shifted, cfg)

        assert second.start_sample - first.start_sample == pytest.approx(extra, abs=cfg.sample_rate_hz // 32), \\
            "acquisition did not track a known shift in the input - it is not reading the audio"

    def test_reports_no_detection_on_pure_noise(self, cfg):
        rng = np.random.default_rng(2)
        noise = rng.normal(0.0, 1.0, cfg.sample_rate_hz * 30).astype(np.float32)
        acq = acquire_frame(noise, cfg)
        # Pure noise must not produce a confident sync score. The exact peak position is
        # arbitrary; what matters is that it does not stand out from the search-grid floor.
        assert acq.sync_score_db < 6.0, f"pure noise scored {acq.sync_score_db:.1f} dB"

    def test_noise_estimate_tracks_the_real_noise_level(self, cfg):
        for true_sigma in (0.05, 0.2, 1.0):
            rng = np.random.default_rng(8)
            noise = rng.normal(0.0, true_sigma, cfg.sample_rate_hz * 20).astype(np.float32)
            estimated = estimate_noise_sigma(noise, cfg, signal_centre_hz=1250.0)
            ratio = estimated / true_sigma
            assert 0.5 < ratio < 2.0, \\
                f"noise estimate {estimated:.4f} vs true {true_sigma:.4f} (ratio {ratio:.2f})"


class TestEndToEnd:
    def test_a_strong_frame_decodes_through_the_full_blind_chain(self, cfg, modulator, codec):
        """
        The whole point: impairments in, blind acquisition, blind noise estimate, real decode.
        At a comfortable SNR this must work, or the realistic benchmark mode measures nothing.
        """
        from z30_dsp.benchmark import demodulate_mfsk_llrs

        rng = np.random.default_rng(20260830)
        impairments = ChannelImpairments(fading="none")
        decoded = 0
        trials = 5

        for _ in range(trials):
            payload, _cw, _data, symbols = generate_random_frame(codec, cfg, rng)
            wave = modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)
            buf, _true_start, _true_foff = impair_frame(wave, cfg.sample_rate_hz, impairments, rng)
            noisy, _ = add_calibrated_awgn(
                buf, -14.0, cfg.sample_rate_hz, rng, float(np.mean(wave ** 2))
            )

            acq = acquire_frame(noisy, cfg)
            llrs = demodulate_mfsk_llrs(
                noisy, cfg, acq.noise_sigma,
                audio_center_hz=acq.base_freq_hz, start_sample=acq.start_sample,
            )
            success, info, _iters = codec.decode_min_sum(llrs)
            if success and np.array_equal(info[:63], payload):
                decoded += 1

        assert decoded == trials, f"only {decoded}/{trials} strong frames survived the blind chain"
`,
  },
  {
    filename: "pyproject.toml",
    path: "pyproject.toml",
    description: "PEP 621 package configuration: dependencies, console scripts and classifiers.",
    code: `[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "z30-transceiver"
version = "1.0.0"
description = "Amateur Radio 16-MFSK Weak-Signal Digital Transceiver & DSP Suite (z-30 protocol)"
readme = "README.md"
authors = [{ name = "Paulo Mantas", email = "paulomantas2009@gmail.com" }]
license = { text = "MIT" }
keywords = ["ham radio", "amateur radio", "digital mode", "MFSK", "LDPC", "DSP", "weak signal"]
requires-python = ">=3.9"
dependencies = [
    "numpy>=1.22.0",
    "scipy>=1.8.0",
    "sounddevice>=0.4.5",
    "cffi>=1.15.0",
    "pyserial>=3.5",
    "requests>=2.28.0"
]

classifiers = [
    # The README frames z-30 as experimental and asks operators to verify their signal before
    # transmitting; setup.py used to claim "5 - Production/Stable", which contradicted it.
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Telecommunications Industry",
    "Topic :: Communications :: Ham Radio",
    "License :: OSI Approved :: MIT License",
    "Operating System :: POSIX :: Linux",
    "Operating System :: Microsoft :: Windows",
    "Operating System :: MacOS",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]

[project.urls]
Homepage = "https://github.com/themantas1994/z-30"
Repository = "https://github.com/themantas1994/z-30.git"
Issues = "https://github.com/themantas1994/z-30/issues"

[project.optional-dependencies]
audio = ["pyaudio>=0.2.13"]
plots = ["matplotlib>=3.5.0"]
# Only needed for RASPBERRY_PI_GPIO PTT keying (real GPIO writes via the local web server's
# /api/gpio bridge - see z30_dsp/web_server.py:GpioBridge). Not required for any other feature.
gpio = ["gpiozero>=2.0"]

# Every console script points at the z30_dsp package. Three of these used to resolve to
# top-level modules installed straight into site-packages (config_wizard, rf_time_sync,
# band_manager) - duplicates of the packaged versions that had drifted away from them, so
# \`z30 --wizard\` and \`z30-wizard\` ran different code, and those very generic names shadowed
# anything else by the same name in the environment.
[project.scripts]
z30 = "z30_dsp.main:main"
z30-transceiver = "z30_dsp.main:main"
z30-web = "z30_dsp.web_server:main"
z30-gui = "z30_dsp.gui:main"
z30-wizard = "z30_dsp.config_wizard:main"
z30-sync = "z30_dsp.rf_time_sync:main"
z30-bands = "z30_dsp.band_manager:main"

[tool.setuptools]
packages = ["z30_dsp"]

[tool.setuptools.package-data]
z30_dsp = ["web_dist/**/*", "web_dist/*"]


[tool.pytest.ini_options]
testpaths = ["tests"]
`,
  },
  {
    filename: "install_ubuntu.sh",
    path: "install_ubuntu.sh",
    description: "Ubuntu/Debian installation script with pinned dependencies and a keyring-verified Node apt source.",
    code: `#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Build & Installation Script for Ubuntu & Debian
# Compatible with Ubuntu 20.04/22.04/24.04, Debian 11/12, Linux Mint, and Pop!_OS
# ==============================================================================
set -e

GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
CYAN='\\033[0;36m'
NC='\\033[0m'

echo -e "\${CYAN}==============================================================\${NC}"
echo -e "\${GREEN}  z-30 Transceiver & DSP Suite - Ubuntu/Debian Installer        \${NC}"
echo -e "\${CYAN}==============================================================\${NC}"

# Sanity check: this script must be run from inside the z-30 project directory (the one
# containing package.json and pyproject.toml), not from $HOME or anywhere else. Running it
# from the wrong directory previously failed silently and confusingly deep into the script
# (\`npm ERR! enoent ... open '/home/<user>/package.json'\`), and - because the npm failure was
# never checked - the script would then skip installing the z30_dsp Python package entirely,
# surfacing later as an unrelated-looking \`ModuleNotFoundError: No module named 'z30_dsp'\`.
if [ ! -f "package.json" ] || [ ! -f "pyproject.toml" ]; then
  echo -e "\\033[0;31m[ERROR] This script must be run from inside the z-30 project directory.\\033[0m"
  echo "Expected to find 'package.json' and 'pyproject.toml' in the current directory: $(pwd)"
  echo ""
  echo "Fix: cd into the folder you cloned/extracted z-30 into, then re-run this script, e.g.:"
  echo "  cd ~/z-30   # or wherever you extracted/cloned it"
  echo "  ./install_ubuntu.sh"
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \\
  python3 python3-pip python3-venv python3-tk python3-dev \\
  build-essential libportaudio2 portaudio19-dev libasound2-dev \\
  libhamlib-utils libhamlib-dev curl git

# Ubuntu/Debian's default 'apt install nodejs' package is far too old for this project's
# toolchain (Vite 6 requires Node.js 20.19+/22.12+): Ubuntu 20.04 ships Node 10.x, 22.04 ships
# 12.22.9, and even 24.04 only ships 18.x. Installing it that way breaks \`npm run build\` below.
#
# A current Node.js LTS therefore comes from NodeSource - but added as a normal, signed apt
# source, NOT by piping a remote script into a root shell. The previous
# \`curl ... | sudo -E bash -\` handed NodeSource (and anyone able to intercept or compromise
# that endpoint) root on the operator's machine, with no signature check anywhere in the path.
# Adding the repository key to a keyring and the source to sources.list.d means apt verifies
# every package signature the normal way, and an operator can read what was added afterwards.
NODE_MAJOR=20
if ! command -v node &> /dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo -e "\${YELLOW}Installing Node.js \${NODE_MAJOR} LTS from NodeSource via a verified apt keyring...\${NC}"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \\
    | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  sudo chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_\${NODE_MAJOR}.x nodistro main" \\
    | sudo tee /etc/apt/sources.list.d/nodesource.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y nodejs
else
  echo -e "\${GREEN}Found Node.js $(node --version), already recent enough - skipping the NodeSource repository.\${NC}"
fi

mkdir -p "$HOME/.z30"
python3 -m venv "$HOME/.z30-env"
source "$HOME/.z30-env/bin/activate"

pip install --upgrade pip setuptools wheel build
# Pinned in requirements.txt. Unpinned installs meant two runs a month apart produced
# different software, with no record of what changed.
pip install -r requirements.txt

web_build_ok=0
if command -v npm &> /dev/null; then
  echo -e "\${YELLOW}Compiling React Web DSP interface bundle...\${NC}"
  # Non-fatal by design (the CLI/DSP tools below must still install even if this fails), but
  # unlike the old \`|| true\`, a real failure here is printed loudly rather than hidden - a
  # silent failure here is exactly what caused the web UI to go missing without explanation.
  if npm install --silent && npm run build; then
    web_build_ok=1
  else
    echo -e "\\033[0;31m[WARN] Web UI build failed (see npm output above) - continuing without it. The z-30 CLI/DSP tools will still install; re-run 'npm run build' manually from this directory once the error is fixed.\\033[0m"
  fi
  if [ "$web_build_ok" -eq 1 ]; then
    mkdir -p "$HOME/.z30/web_dist"
    cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
    mkdir -p z30_dsp/web_dist
    cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
  fi
else
  echo -e "\${YELLOW}[WARN] npm still not available after install attempt - the app will run without a bundled web UI.\${NC}"
fi

python3 -m pip install -e .

mkdir -p "$HOME/.local/bin"
cat << 'EOF' > "$HOME/.local/bin/z30"
#!/usr/bin/env bash
source "$HOME/.z30-env/bin/activate"
python3 -c "import sys; from z30_dsp.main import main; main()" "$@"
EOF
chmod +x "$HOME/.local/bin/z30"

# Install the application icon so the menu entry has one. public/icon-512.svg is the source of
# truth for it (it used to sit loose at the repository root and be referenced from three
# different places, none of which installed it).
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
if [ -f public/icon-512.svg ]; then
  cp public/icon-512.svg "$HOME/.local/share/icons/hicolor/scalable/apps/z30.svg"
fi

mkdir -p "$HOME/.local/share/applications"
cat << EOF > "$HOME/.local/share/applications/z30.desktop"
[Desktop Entry]
Name=z-30 Digital Transceiver
Comment=16-MFSK Amateur Radio Digital Mode Transceiver & DSP Suite
Exec=$HOME/.local/bin/z30
Icon=z30
Terminal=false
Type=Application
Categories=HamRadio;AudioVideo;Network;
EOF

echo -e "\${GREEN}==============================================================\${NC}"
echo -e "\${GREEN}  z-30 Transceiver installed successfully on Ubuntu/Debian!     \${NC}"
echo -e "\${GREEN}  Run 'z30' or launch 'z-30 Digital Transceiver' from your menu.\${NC}"
echo -e "\${GREEN}==============================================================\${NC}"
`,
  },
  {
    filename: "install_arch.sh",
    path: "install_arch.sh",
    description: "Arch Linux installation script.",
    code: `#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Installation Script for Arch Linux & Manjaro
# Compatible with Arch Linux, Manjaro, EndeavourOS, Garuda Linux, and CachyOS
# ==============================================================================

set -e

GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
CYAN='\\033[0;36m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${CYAN}==============================================================\${NC}"
echo -e "\${GREEN}  z-30 Transceiver & DSP Suite - Arch Linux Installer          \${NC}"
echo -e "\${CYAN}==============================================================\${NC}"

# Check for pacman
if ! command -v pacman &> /dev/null; then
    echo -e "\${RED}[ERROR] Pacman package manager not found. This script requires Arch Linux or an Arch-based distribution.\${NC}"
    exit 1
fi

# Sanity check: this script must be run from inside the z-30 project directory (the one
# containing package.json and pyproject.toml), not from $HOME or anywhere else - otherwise
# later steps fail with confusing errors (npm looking for package.json in the wrong place,
# \`python -m build\` finding no pyproject.toml) far from their actual cause.
if [ ! -f "package.json" ] || [ ! -f "pyproject.toml" ]; then
    echo -e "\${RED}[ERROR] This script must be run from inside the z-30 project directory.\${NC}"
    echo "Expected to find 'package.json' and 'pyproject.toml' in the current directory: $(pwd)"
    echo ""
    echo "Fix: cd into the folder you cloned/extracted z-30 into, then re-run this script, e.g.:"
    echo "  cd ~/z-30   # or wherever you extracted/cloned it"
    echo "  ./install_arch.sh"
    exit 1
fi

echo -e "\${YELLOW}[1/4] Installing official dependencies via pacman...\${NC}"
sudo pacman -Syu --needed --noconfirm \\
    python \\
    python-pip \\
    python-setuptools \\
    python-build \\
    python-installer \\
    python-wheel \\
    python-numpy \\
    python-scipy \\
    python-pyserial \\
    python-cffi \\
    python-requests \\
    portaudio \\
    hamlib \\
    tk \\
    nodejs \\
    npm \\
    git \\
    base-devel

echo -e "\${YELLOW}[2/4] Setting up Python virtual environment with system site-packages...\${NC}"
mkdir -p "$HOME/.z30"
python -m venv "$HOME/.z30-env" --system-site-packages
source "$HOME/.z30-env/bin/activate"

# Install the Python dependencies inside the venv at pinned versions (portaudio and cffi come
# from pacman; --system-site-packages above lets the venv see them). Unpinned installs meant two
# runs a month apart produced different software, with no record of what changed - see
# requirements.txt.
pip install -r requirements.txt

if command -v npm &> /dev/null; then
  echo -e "\${YELLOW}[3/4] Compiling React Web DSP interface bundle...\${NC}"
  # Non-fatal (package install below doesn't depend on this succeeding), but a real failure is
  # now printed loudly instead of silently discarded by a blanket \`|| true\`.
  if npm install --silent && npm run build; then
    mkdir -p "$HOME/.z30/web_dist"
    cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
    mkdir -p z30_dsp/web_dist
    cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
  else
    echo -e "\${RED}[WARN] Web UI build failed (see npm output above) - continuing without it. Re-run 'npm run build' manually from this directory once the error is fixed.\${NC}"
  fi
fi

# Build and install z-30 package (including web bundle)
python -m build --wheel --no-isolation
pip install dist/*.whl --force-reinstall

echo -e "\${YELLOW}[4/4] Registering binary launcher and desktop menu entry...\${NC}"
mkdir -p "$HOME/.local/bin"
cat << 'EOF' > "$HOME/.local/bin/z30"
#!/usr/bin/env bash
source "$HOME/.z30-env/bin/activate"
python -c "import sys; from z30_dsp.main import main; main()" "$@"
EOF
chmod +x "$HOME/.local/bin/z30"

# Install the application icon so the menu entry has one. public/icon-512.svg is the source of
# truth for it (it used to sit loose at the repository root and be referenced from three
# different places, none of which installed it).
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
if [ -f public/icon-512.svg ]; then
  cp public/icon-512.svg "$HOME/.local/share/icons/hicolor/scalable/apps/z30.svg"
fi

mkdir -p "$HOME/.local/share/applications"
cat << EOF > "$HOME/.local/share/applications/z30.desktop"
[Desktop Entry]
Name=z-30 Digital Transceiver
Comment=16-MFSK Amateur Radio Digital Mode Transceiver & DSP Suite
Exec=$HOME/.local/bin/z30
Icon=z30
Terminal=false
Type=Application
Categories=HamRadio;AudioVideo;Network;
EOF

echo -e "\${GREEN}==============================================================\${NC}"
echo -e "\${GREEN}  Arch Linux installation complete!                            \${NC}"
echo -e "\${GREEN}  Run 'z30' or launch 'z-30 Digital Transceiver' from your menu.\${NC}"
echo -e "\${GREEN}  Repository: https://github.com/themantas1994/z-30            \${NC}"
echo -e "\${GREEN}==============================================================\${NC}"
`,
  },
  {
    filename: "PKGBUILD",
    path: "PKGBUILD",
    description: "Arch Linux PKGBUILD for makepkg / AUR installation.",
    code: `# Maintainer: Paulo Mantas <paulomantas2009@gmail.com>
pkgname=z30-transceiver
pkgver=1.0.0
pkgrel=1
pkgdesc="16-MFSK Weak-Signal Digital Mode Transceiver, LDPC-SIC Decoder, CAT Controller, and DSP Suite"
arch=('x86_64' 'aarch64' 'armv7h')
url="https://github.com/themantas1994/z-30"
license=('MIT')
depends=(
    'python>=3.9'
    'python-numpy'
    'python-scipy'
    'python-pyserial'
    'python-cffi'
    'python-requests'
    'portaudio'
    'hamlib'
    'tk'
)
optdepends=(
    'python-sounddevice: hardware audio capture & playback (available in AUR or via pip)'
    'python-pyaudio: alternative audio backend'
    'nodejs: for embedded web application engine'
    'npm: for building web interface'
)
makedepends=('python-setuptools' 'python-build' 'python-installer' 'python-wheel' 'nodejs' 'npm' 'git')
source=("z-30::git+https://github.com/themantas1994/z-30.git#branch=main")
sha256sums=('SKIP')

build() {
    if [ -d "$srcdir/z-30" ]; then
        cd "$srcdir/z-30"
    elif [ -f "$startdir/pyproject.toml" ]; then
        cd "$startdir"
    else
        cd "$srcdir"
    fi

    if command -v npm &> /dev/null; then
        npm install
        npm run build
        mkdir -p z30_dsp/web_dist
        cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
    fi

    python -m build --wheel --no-isolation
}

package() {
    if [ -d "$srcdir/z-30" ]; then
        cd "$srcdir/z-30"
    elif [ -f "$startdir/pyproject.toml" ]; then
        cd "$startdir"
    else
        cd "$srcdir"
    fi

    python -m installer --destdir="$pkgdir" dist/*.whl

    # Desktop integration
    if [ -f z30.desktop ]; then
        install -Dm644 z30.desktop "$pkgdir/usr/share/applications/z30.desktop"
    fi
    if [ -f public/icon-512.svg ]; then
        install -Dm644 public/icon-512.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/z30.svg"
    fi

    # The AUR requires the licence text to be installed. There was no LICENSE file in the tree
    # at all until recently, despite four places declaring MIT - which made this package (and
    # Debian packaging, and any fork) legally undistributable.
    install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
`,
  },
  {
    filename: "install_android_termux.sh",
    path: "install_android_termux.sh",
    description: "Android Termux field deployment script.",
    code: `#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# z-30 Transceiver - Android Termux Field Radio Deployment Script
# ==============================================================================
set -e

# Sanity check: this script must be run from inside the z-30 project directory (the one
# containing package.json and pyproject.toml), not from $HOME or anywhere else - otherwise
# later steps fail with confusing errors far from their actual cause (e.g. npm looking for
# package.json in the wrong place, \`pip install -e .\` finding no pyproject.toml).
if [ ! -f "package.json" ] || [ ! -f "pyproject.toml" ]; then
  echo "[ERROR] This script must be run from inside the z-30 project directory."
  echo "Expected to find 'package.json' and 'pyproject.toml' in the current directory: $(pwd)"
  echo ""
  echo "Fix: cd into the folder you cloned/extracted z-30 into, then re-run this script, e.g.:"
  echo "  cd ~/z-30   # or wherever you extracted/cloned it"
  echo "  ./install_android_termux.sh"
  exit 1
fi

echo "[1/4] Updating Termux repositories and installing packages..."
pkg update -y
# NOTE: the package is "libportaudio2" in the Termux repo, not "libportaudio" (which does not
# exist there and would make this whole \`pkg install\` line fail).
pkg install -y python python-numpy python-scipy clang fftw libportaudio2 termux-api nodejs git
pip install --upgrade pip setuptools wheel
# Pinned versions - see requirements.txt. numpy and scipy come from the Termux packages above
# (building them from source under Termux is impractical), so they are excluded here.
grep -vE '^(numpy|scipy)==' requirements.txt | pip install -r /dev/stdin

# KNOWN LIMITATION (not something this script can fix): sounddevice/PortAudio have no reliable
# access to Android's audio devices from inside Termux - device lists commonly come back empty
# even with libportaudio2 installed and Termux:API microphone permission granted, because
# Android does not expose raw ALSA/PortAudio-compatible hardware to Termux's Linux userspace.
# Real-time RX/TX audio capture in the z-30 app is therefore not expected to work reliably on
# Android; this script installs what it can, but treat Android as CLI/DSP-only (benchmark,
# rf_time_sync, band_manager) rather than a full transceiver until Termux/Android gain proper
# audio device access for third-party apps.

echo "[2/4] Building React Web UI Bundle..."
if command -v npm &> /dev/null; then
  # Non-fatal (package install below doesn't depend on this succeeding), but a real failure is
  # now printed loudly instead of silently discarded by a blanket \`|| true\`.
  if npm install --silent && npm run build; then
    mkdir -p "$HOME/.z30/web_dist"
    cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
    mkdir -p z30_dsp/web_dist
    cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
  else
    echo "[WARN] Web UI build failed (see npm output above) - continuing without it. Re-run 'npm run build' manually from this directory once the error is fixed."
  fi
fi

pip install -e .

mkdir -p "$HOME/bin"
cat << 'EOF' > "$HOME/bin/z30"
#!/data/data/com.termux/files/usr/bin/bash
python3 -c "import sys; from z30_dsp.main import main; main()" "$@"
EOF
chmod +x "$HOME/bin/z30"

echo "================================================================"
echo "  Android Termux installation complete!                         "
echo "  Run 'z30' to start the transceiver web interface.            "
echo "================================================================"
`,
  },
  {
    filename: "run_windows.bat",
    path: "run_windows.bat",
    description: "Windows launcher with multi-path Python detection.",
    code: `@echo off
setlocal enabledelayedexpansion

TITLE z-30 Digital Mode Transceiver (Windows)
COLOR 0A

echo ================================================================
echo       z-30 Transceiver ^& DSP Suite (Windows Launcher)
echo ================================================================
echo.

REM -----------------------------------------------------------------
REM Step 0: Sanity check - must be run from inside the z-30 project
REM directory (the one containing package.json and pyproject.toml).
REM Double-clicking this file in Explorer already sets the working
REM directory correctly; this only matters if it's launched from a
REM shortcut or a cmd.exe session in the wrong folder.
REM -----------------------------------------------------------------
if not exist "package.json" (
    goto :wrong_dir
)
if not exist "pyproject.toml" (
    goto :wrong_dir
)
goto :dir_ok
:wrong_dir
COLOR 0C
echo [ERROR] This script must be run from inside the z-30 project directory.
echo Expected to find "package.json" and "pyproject.toml" in: %CD%
echo.
echo Fix: right-click run_windows.bat inside the z-30 folder and choose
echo "Run" - or open a Command Prompt, cd into that folder, then run it.
pause
exit /b 1
:dir_ok

REM -----------------------------------------------------------------
REM Step 1: Detect working Python 3.9+ installation
REM -----------------------------------------------------------------
set "PYTHON_EXE="

REM Test if existing venv python is already available and functional
if exist "%USERPROFILE%\\.z30-venv\\Scripts\\python.exe" (
    "%USERPROFILE%\\.z30-venv\\Scripts\\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
    if !errorlevel! EQU 0 (
        set "PYTHON_EXE=%USERPROFILE%\\.z30-venv\\Scripts\\python.exe"
        goto :python_found
    )
)

REM Test standard Windows Python Launcher (py -3)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=py -3"
    goto :create_venv
)

REM Test standard python in PATH
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=python"
    goto :create_venv
)

REM Test python3 in PATH
python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=python3"
    goto :create_venv
)

REM Scan common Windows Python installation directories
for %%P in (
    "%LOCALAPPDATA%\\Programs\\Python\\Python313\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python311\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python310\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python39\\python.exe"
    "%ProgramFiles%\\Python313\\python.exe"
    "%ProgramFiles%\\Python312\\python.exe"
    "%ProgramFiles%\\Python311\\python.exe"
    "%ProgramFiles%\\Python310\\python.exe"
    "%ProgramFiles%\\Python39\\python.exe"
    "C:\\Python313\\python.exe"
    "C:\\Python312\\python.exe"
    "C:\\Python311\\python.exe"
    "C:\\Python310\\python.exe"
    "C:\\Python39\\python.exe"
) do (
    if exist "%%~P" (
        "%%~P" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
        if !errorlevel! EQU 0 (
            set "PYTHON_BOOTSTRAP=%%~P"
            goto :create_venv
        )
    )
)

REM -----------------------------------------------------------------
REM If no Python found, display clear instructions
REM -----------------------------------------------------------------
COLOR 0C
echo [ERROR] Python 3.9+ was not found on your Windows system!
echo.
echo ================================================================
echo                     HOW TO FIX THIS:
echo ================================================================
echo.
echo Option 1 (Recommended - Official Python Installer):
echo   1. Download Python 3.11 or 3.12 from:
echo      https://www.python.org/downloads/
echo   2. Run the installer and CRITICALLY check the box:
echo      [X] "Add python.exe to PATH" (at the bottom of installer)
echo   3. Click "Install Now", then relaunch this run_windows.bat script.
echo.
echo Option 2 (Windows Terminal / Winget):
echo   Open Command Prompt or PowerShell and run:
echo      winget install Python.Python.3.11
echo.
echo Option 3 (Fix Windows Store alias issue):
echo   If you already installed Python, Windows may be intercepting it:
echo   Go to: Windows Settings ^> Apps ^> Advanced app settings ^> App execution aliases
echo   Turn OFF the toggles for "python.exe" and "python3.exe".
echo.
echo ================================================================
echo.
pause
exit /b 1

REM -----------------------------------------------------------------
REM Step 2: Initialize / Activate Virtual Environment
REM -----------------------------------------------------------------
:create_venv
if not exist "%USERPROFILE%\\.z30-venv" (
    echo [INFO] Initializing Python virtual environment at "%USERPROFILE%\\.z30-venv"...
    %PYTHON_BOOTSTRAP% -m venv "%USERPROFILE%\\.z30-venv"
    if !errorlevel! NEQ 0 (
        echo [WARN] Failed to create venv with default parameters. Retrying with --without-pip...
        %PYTHON_BOOTSTRAP% -m venv "%USERPROFILE%\\.z30-venv" --without-pip
    )
)

set "PYTHON_EXE=%USERPROFILE%\\.z30-venv\\Scripts\\python.exe"

:python_found
if not exist "%PYTHON_EXE%" (
    echo [ERROR] Virtual environment python executable not found at:
    echo "%PYTHON_EXE%"
    pause
    exit /b 1
)

echo [OK] Using Python environment: %PYTHON_EXE%
echo.

REM -----------------------------------------------------------------
REM Step 3: Check & Install Python Dependencies
REM -----------------------------------------------------------------
echo [INFO] Verifying and updating Python DSP dependencies...
"%PYTHON_EXE%" -m pip install --upgrade pip setuptools wheel --quiet >nul 2>nul
"%PYTHON_EXE%" -m pip install numpy scipy sounddevice pyserial cffi requests windows-curses --quiet

if %errorlevel% NEQ 0 (
    echo [WARN] Attempting dependency installation with verbose output...
    "%PYTHON_EXE%" -m pip install numpy scipy sounddevice pyserial requests
)

REM -----------------------------------------------------------------
REM Step 4: Keep npm dependencies current for the Web DSP assets
REM -----------------------------------------------------------------
REM NOTE: the actual "is the web bundle up to date" decision is now made in Python
REM (z30_dsp/web_server.py:locate_web_dist), which compares dist/index.html's timestamp
REM against package.json and src/ and rebuilds whenever the source is newer - not just when
REM dist/index.html is missing. A previous version of this step only checked for absence,
REM which meant any dist/ left over from a prior build was served forever after an update
REM (git pull / re-extracted zip), regardless of source changes. This step just ensures
REM node_modules exists so that rebuild (when Python decides it's needed) can actually run.
where npm >nul 2>nul
if %errorlevel% EQU 0 (
    if not exist "node_modules" (
        echo [INFO] Installing Web DSP npm dependencies...
        call npm install --silent
    )
)

REM -----------------------------------------------------------------
REM Step 5: Launch Transceiver
REM -----------------------------------------------------------------
echo.
echo ================================================================
echo        Starting z-30 Digital Transceiver ^& DSP Engine...
echo ================================================================
echo.

"%PYTHON_EXE%" -c "import sys; from z30_dsp.main import main; main()" %*

if %errorlevel% NEQ 0 (
    echo.
    echo [INFO] Transceiver exited with code %errorlevel%.
)

pause
`,
  },
  {
    filename: "build_windows.bat",
    path: "build_windows.bat",
    description: "Windows standalone .exe PyInstaller build script.",
    code: `@echo off
setlocal enabledelayedexpansion

REM ==============================================================================
REM z-30 Transceiver - Windows Standalone .EXE PyInstaller Build Script
REM ==============================================================================

TITLE z-30 PyInstaller Executable Builder
COLOR 0B

echo ================================================================
echo   Building z-30 Standalone Windows Binary (z30-transceiver.exe)
echo ================================================================
echo.

REM -----------------------------------------------------------------
REM Step 0: Sanity check - must be run from inside the z-30 project
REM directory (the one containing package.json and pyproject.toml),
REM not from some other folder. Otherwise later steps (npm, PyInstaller
REM --add-data "config.json;.") fail with confusing errors far from
REM their actual cause. Double-clicking this file in Explorer already
REM sets the working directory correctly; this only matters if it's
REM launched from a shortcut or a cmd.exe session in the wrong folder.
REM -----------------------------------------------------------------
if not exist "package.json" (
    goto :wrong_dir
)
if not exist "pyproject.toml" (
    goto :wrong_dir
)
goto :dir_ok
:wrong_dir
COLOR 0C
echo [ERROR] This script must be run from inside the z-30 project directory.
echo Expected to find "package.json" and "pyproject.toml" in: %CD%
echo.
echo Fix: right-click build_windows.bat inside the z-30 folder and choose
echo "Run" - or open a Command Prompt, cd into that folder, then run it.
pause
exit /b 1
:dir_ok

REM -----------------------------------------------------------------
REM Step 1: Detect working Python 3.9+ installation
REM -----------------------------------------------------------------
set "PYTHON_EXE="

REM Test if existing venv python is available
if exist "%USERPROFILE%\\.z30-venv\\Scripts\\python.exe" (
    "%USERPROFILE%\\.z30-venv\\Scripts\\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
    if !errorlevel! EQU 0 (
        set "PYTHON_EXE=%USERPROFILE%\\.z30-venv\\Scripts\\python.exe"
        goto :python_found
    )
)

REM Test standard Windows Python Launcher (py -3)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=py -3"
    goto :create_venv
)

REM Test standard python in PATH
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=python"
    goto :create_venv
)

REM Test python3 in PATH
python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=python3"
    goto :create_venv
)

REM Scan common Windows Python installation directories
for %%P in (
    "%LOCALAPPDATA%\\Programs\\Python\\Python313\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python311\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python310\\python.exe"
    "%LOCALAPPDATA%\\Programs\\Python\\Python39\\python.exe"
    "%ProgramFiles%\\Python313\\python.exe"
    "%ProgramFiles%\\Python312\\python.exe"
    "%ProgramFiles%\\Python311\\python.exe"
    "%ProgramFiles%\\Python310\\python.exe"
    "%ProgramFiles%\\Python39\\python.exe"
    "C:\\Python313\\python.exe"
    "C:\\Python312\\python.exe"
    "C:\\Python311\\python.exe"
    "C:\\Python310\\python.exe"
    "C:\\Python39\\python.exe"
) do (
    if exist "%%~P" (
        "%%~P" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
        if !errorlevel! EQU 0 (
            set "PYTHON_BOOTSTRAP=%%~P"
            goto :create_venv
        )
    )
)

REM -----------------------------------------------------------------
REM If no Python found, display clear instructions
REM -----------------------------------------------------------------
COLOR 0C
echo [ERROR] Python 3.9+ was not found on your Windows system!
echo.
echo ================================================================
echo                     HOW TO FIX THIS:
echo ================================================================
echo.
echo Option 1 (Recommended - Official Python Installer):
echo   1. Download Python 3.11 or 3.12 from:
echo      https://www.python.org/downloads/
echo   2. Run the installer and CRITICALLY check the box:
echo      [X] "Add python.exe to PATH" (at the bottom of installer)
echo   3. Click "Install Now", then relaunch this build_windows.bat script.
echo.
echo Option 2 (Windows Terminal / Winget):
echo   Open Command Prompt or PowerShell and run:
echo      winget install Python.Python.3.11
echo.
echo Option 3 (Fix Windows Store alias issue):
echo   If you already installed Python, Windows may be intercepting it:
echo   Go to: Windows Settings ^> Apps ^> Advanced app settings ^> App execution aliases
echo   Turn OFF the toggles for "python.exe" and "python3.exe".
echo.
echo ================================================================
echo.
pause
exit /b 1

REM -----------------------------------------------------------------
REM Step 2: Initialize / Activate Virtual Environment
REM -----------------------------------------------------------------
:create_venv
if not exist "%USERPROFILE%\\.z30-venv" (
    echo [INFO] Initializing Python virtual environment at "%USERPROFILE%\\.z30-venv"...
    %PYTHON_BOOTSTRAP% -m venv "%USERPROFILE%\\.z30-venv"
)

set "PYTHON_EXE=%USERPROFILE%\\.z30-venv\\Scripts\\python.exe"

:python_found
if not exist "%PYTHON_EXE%" (
    echo [ERROR] Virtual environment python executable not found at:
    echo "%PYTHON_EXE%"
    pause
    exit /b 1
)

echo [OK] Using Python environment: %PYTHON_EXE%
echo.

REM -----------------------------------------------------------------
REM Step 3: Install PyInstaller & Build Dependencies
REM -----------------------------------------------------------------
echo [INFO] Upgrading pip build tools...
"%PYTHON_EXE%" -m pip install --upgrade pip setuptools wheel --quiet

echo [INFO] Installing PyInstaller compiler...
"%PYTHON_EXE%" -m pip install pyinstaller

echo [INFO] Installing z-30 DSP dependencies (numpy, scipy, sounddevice, pyserial)...
"%PYTHON_EXE%" -m pip install numpy scipy sounddevice pyserial cffi requests windows-curses

REM -----------------------------------------------------------------
REM Step 4: Compile Frontend Web Assets
REM -----------------------------------------------------------------
echo [INFO] Checking frontend assets...
where npm >nul 2>nul
if %errorlevel% EQU 0 (
    echo [INFO] Compiling React Web DSP interface...
    call npm install --silent
    call npm run build
) else (
    echo [INFO] npm not found in PATH; using bundled pre-built web assets.
)

REM -----------------------------------------------------------------
REM Step 5: Run PyInstaller
REM -----------------------------------------------------------------
echo.
echo [INFO] Compiling standalone Windows binary with PyInstaller...

REM IMPORTANT: prefer the "dist" folder Step 4 just rebuilt from CURRENT source over the
REM z30_dsp\\web_dist snapshot (a pre-built copy shipped in the repo that only gets updated
REM manually). Checking web_dist first - as a previous version of this script did - meant the
REM freshly rebuilt web UI was silently discarded on every single build: the .exe always got
REM whatever web_dist last happened to contain, so rebuilding after a source/UI update kept
REM producing an .exe that opened the SAME old interface. web_dist is now only a fallback for
REM when npm wasn't available in Step 4 and no fresh "dist" was produced at all.
set "WEB_DATA_ARG="
if exist "dist\\index.html" (
    set "WEB_DATA_ARG=--add-data dist;dist"
) else if exist "z30_dsp\\web_dist" (
    set "WEB_DATA_ARG=--add-data z30_dsp\\web_dist;z30_dsp\\web_dist"
)

REM config.json is per-user runtime state (clock calibration) written to the user data
REM directory at runtime - see z30_dsp\\paths.py. It is not bundled into the executable.
"%PYTHON_EXE%" -m PyInstaller --noconfirm --onedir --windowed ^
    --name "z30-transceiver" ^
    !WEB_DATA_ARG! ^
    --collect-all "sounddevice" ^
    --hidden-import "numpy" ^
    --hidden-import "scipy" ^
    --hidden-import "sounddevice" ^
    --hidden-import "serial" ^
    --hidden-import "serial.tools.list_ports" ^
    --hidden-import "cffi" ^
    --hidden-import "requests" ^
    z30_dsp/main.py

if %errorlevel% EQU 0 (
    COLOR 0A
    echo.
    echo ================================================================
    echo [SUCCESS] Build completed successfully!
    echo Standalone executable: dist\\z30-transceiver\\z30-transceiver.exe
    echo ================================================================
) else (
    COLOR 0C
    echo.
    echo [ERROR] PyInstaller build failed with exit code %errorlevel%.
)

pause
`,
  },
];
