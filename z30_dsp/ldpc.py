"""
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
     where alpha is the schedule's own empirical normalization factor mitigating check node
     overestimation - see DECODE_SCHEDULES; there is no single alpha for the decoder.
   - Variable Node Update: L_{v->c} = L_{ch, v} + sum_{c' != c} L_{c'->v}
   - Early stopping condition: syndrome s = H * c^T == 0 (mod 2) and CRC valid.
"""

from typing import Any, Dict, List, Optional, Tuple
import math

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

#: The four decode schedules `decode_min_sum` runs, in order, stopping at the first that
#: produces a codeword whose syndrome is zero and whose CRC-14 matches.
#:
#: There is deliberately no single "the decoder's alpha". One used to be documented in wiki/04,
#: accepted as a constructor argument here, exported as `Z30_LDPC_PARAMS.alphaMinSum` in
#: TypeScript and rendered in the Specs modal as 0.75 - a value none of these four schedules
#: has ever used. The table is the specification; anything that wants to describe the decoder
#: reads it rather than retyping a number beside it.
#:
#: The twin of `Z30_DECODE_SCHEDULES` in src/dsp/ldpcCodec.ts, asserted equal by
#: tests/test_cross_language_parity.py.
DECODE_SCHEDULES: Tuple[Dict[str, Any], ...] = (
    {'mode': 'NMS', 'alpha': 0.82, 'beta': 0.08, 'damping': 0.88, 'reverse': False, 'iters': 45},
    {'mode': 'SPA', 'alpha': 0.95, 'beta': 0.00, 'damping': 0.85, 'reverse': False, 'iters': 40},
    {'mode': 'NMS', 'alpha': 0.74, 'beta': 0.04, 'damping': 0.90, 'reverse': True, 'iters': 35},
    {'mode': 'DITHER', 'alpha': 0.80, 'beta': 0.06, 'damping': 0.85, 'reverse': False, 'iters': 30},
)

#: Peak-to-peak amplitude of the LLR perturbation applied by decode schedule 4 ("DITHER").
#: Shared with src/dsp/ldpcCodec.ts and pinned by tests/test_cross_language_parity.py.
DITHER_AMPLITUDE: float = 0.45

_FNV32_OFFSET_BASIS = 0x811C9DC5
_FNV32_PRIME = 0x01000193
_UINT32_MASK = 0xFFFFFFFF


def dither_seed_from_llrs(llr_channel: "np.ndarray | List[float]") -> int:
    """
    Derives a 32-bit seed from the channel LLRs themselves (FNV-1a over 1/64-LLR quanta).

    Schedule 4 perturbs the channel LLRs to break the symmetric trapping sets a deterministic
    schedule stalls on. That perturbation used to come from `np.random.rand()` - the unseeded
    global generator - so the decoder was not a function of its input: two seeded benchmark
    runs of the identical configuration could decode a different set of frames, precisely
    among the near-threshold frames the benchmark exists to characterise. AGENTS.md's
    determinism invariant says unseeded RNG does not belong in that path.

    Threading a seeded generator in from the benchmark would fix the benchmark and nothing
    else: `decode_min_sum` is also called by the SIC decoder and by the live receive path,
    where there is no seed to thread, and a frame captured off the air still has to decode the
    same way twice. Deriving the seed from the input instead makes the decoder a pure function
    everywhere - the same LLRs always give the same answer, in isolation, in any caller, in
    either language. The perturbation only has to be uncorrelated with the code's structure,
    not unpredictable, so nothing is lost by making it reproducible.

    Quantising to 1/64 before hashing keeps the derivation on integers, so Python and
    TypeScript agree bit for bit; `math.floor(x * 64 + 0.5)` rather than `round()` because
    Python rounds halves to even and JavaScript rounds them up.
    """
    h = _FNV32_OFFSET_BASIS
    for value in llr_channel:
        quantum = math.floor(float(value) * 64.0 + 0.5) & _UINT32_MASK
        for shift in (0, 8, 16, 24):
            h ^= (quantum >> shift) & 0xFF
            h = (h * _FNV32_PRIME) & _UINT32_MASK
    return h


def dither_vector(llr_channel: "np.ndarray | List[float]", length: int) -> "np.ndarray":
    """
    The schedule-4 LLR perturbation for `llr_channel`: `length` values in +/-DITHER_AMPLITUDE/2.

    mulberry32, the same generator as src/dsp/seededRandom.ts, reproduced here in unsigned
    32-bit arithmetic so that both languages emit an identical sequence.
    """
    state = dither_seed_from_llrs(llr_channel) or 0x9E3779B9
    out = np.zeros(length, dtype=np.float64)
    for i in range(length):
        state = (state + 0x6D2B79F5) & _UINT32_MASK
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & _UINT32_MASK
        t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61)))) & _UINT32_MASK
        unit = ((t ^ (t >> 14)) & _UINT32_MASK) / 4294967296.0
        out[i] = (unit - 0.5) * DITHER_AMPLITUDE
    return out


class Z30LdpcCodec:
    """
    Production-grade Systematic (216, 77) LDPC Codec.
    Implements IRA forward-substitution encoding and normalized Min-Sum belief propagation.
    """

    def __init__(self, max_iterations: int = 45) -> None:
        """
        Initializes the (216, 77) LDPC Codec.

        Args:
            max_iterations (int): Maximum belief propagation iterations (default: 45). This is
                schedule 1's cap; the four schedules of `decode_min_sum` carry their own.

        There is deliberately no `alpha` argument. One used to be accepted here, defaulting to
        0.75, stored as `self.alpha` - and never read by the decoder, which has always applied
        the four per-schedule alphas in `decode_min_sum` instead. Constructing the codec with
        `alpha=0.5` changed nothing, while the number was quoted in wiki/04 and rendered in the
        Specs modal as though it were live. A parameter that cannot affect the result is worse
        than no parameter: it invites tuning that silently does nothing.
        """
        self.k: int = 77   # Information block length (63 payload + 14 CRC)
        self.n: int = 216  # Total coded codeword length
        self.m: int = 139  # Parity check equations (216 - 77)
        self.max_iterations: int = max_iterations

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
            dict(sched, iters=min(sched['iters'], self.max_iterations))
            for sched in DECODE_SCHEDULES
        ]

        best_codeword = np.zeros(self.n, dtype=np.uint8)
        min_syndrome_weight = 999
        total_iterations = 0
        best_total_llrs = np.copy(input_llr)

        for sched in schedules:
            total_llrs = np.copy(input_llr)
            if sched['mode'] == 'DITHER':
                # Derived from the channel LLRs, not from the unseeded global RNG - see
                # dither_vector(). This is what keeps a seeded benchmark reproducible.
                total_llrs += dither_vector(input_llr, self.n)

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
