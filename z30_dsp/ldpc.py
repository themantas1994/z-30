"""
z-30 Systematic (216, 77) LDPC Codec & Min-Sum BP Decoder
===========================================================

Mathematical Specification & Design Rationale:
----------------------------------------------
1. Code Parameters:
   - Codeword length (n): 216 channel coded bits.
   - Information block length (k): 77 bits (63-bit amateur payload + 14-bit CRC-14).
   - Parity check equations (m = n - k): 139 checks.
   - Code rate (R): R = 77 / 216 ≈ 0.3564 (optimal for extreme weak-signal AWGN/Fading channels down to -29.5 dB SNR).
   - Modulation Symbol Mapping: 216 coded bits / (4 bits/symbol) = 54 data symbols in 16-MFSK.
     Coupled with 21 Costas synchronization symbols, total frame = 75 symbols (24.0s duration at Ts=320ms).

2. Parity-Check Matrix H:
   H = [ H_info (139 x 77) | H_parity (139 x 139) ]
   - H_info: Degree-5 sparse binary matrix. Check node p connects to information indices (p*17 + k*23 + 7) mod 77.
   - H_parity: Dual-diagonal bidiagonal accumulator structure:
       H_parity[p, p] = 1 for all 0 <= p < 139
       H_parity[p, p-1] = 1 for all 1 <= p < 139

3. Systematic Linear-Time O(n) Encoder Algorithm:
   Due to the dual-diagonal IRA structure, parity bits are solved recursively in O(n) time without matrix inversion:
     p_0 = sum_{j in N(0)} u_j  (mod 2)
     p_i = p_{i-1} ^ (sum_{j in N(i)} u_j)  (mod 2)  for i = 1, ..., 138

4. Error Detection:
   14-bit CRC polynomial: g(x) = x^14 + x^11 + x^2 + 1 (0x2443, Init 0x2757).
   Yields undetected frame error probability P_ue < 6.1e-5.

5. Vectorized Normalized Min-Sum Belief Propagation Decoder:
   - Check Node Update: L_{c->v} = alpha * prod(sign(L_{v'->c})) * min_{v' != v}(|L_{v'->c}|)
     where alpha = 0.75 is the empirical normalization factor mitigating check node overestimation.
   - Variable Node Update: L_{v->c} = L_{ch, v} + sum_{c' != c} L_{c'->v}
   - Early stopping condition: syndrome s = H * c^T == 0 (mod 2) and CRC valid.
"""

from typing import Tuple, List, Optional
import numpy as np

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

        # 1. Degree-5 Information bit connections
        for p in range(self.m):
            for idx in range(5):
                info_idx = (p * 17 + idx * 23 + 7) % self.k
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
        Polynomial: x^14 + x^11 + x^2 + 1 (0x2443, Init 0x2757).

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

        # 3. Compute 139 parity bits via IRA Accumulator
        codeword = np.zeros(self.n, dtype=np.uint8)
        codeword[:self.k] = info_bits

        parity_accumulator = 0
        for p in range(self.m):
            check_sum = 0
            for idx in range(5):
                info_idx = (p * 17 + idx * 23 + 7) % self.k
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

    def decode_min_sum(self, llr_channel: np.ndarray) -> Tuple[bool, np.ndarray, int]:
        """
        Vectorized Normalized Min-Sum Belief Propagation Decoder.

        Args:
            llr_channel (np.ndarray): Array of 216 soft channel log-likelihood ratios.

        Returns:
            Tuple[bool, np.ndarray, int]: (success_flag, decoded_77_info_bits, iterations)
        """
        assert len(llr_channel) == self.n, f"Expected {self.n} LLRs"

        # Check-to-variable message buffers
        c_to_v = [np.zeros(len(self.check_to_vars[c]), dtype=np.float32) for c in range(self.m)]
        # Variable-to-check message buffers
        v_to_c = [np.zeros(len(self.var_to_checks[v]), dtype=np.float32) for v in range(self.n)]

        # Initialize v_to_c with channel LLRs
        for v in range(self.n):
            v_to_c[v][:] = llr_channel[v]

        best_codeword = np.zeros(self.n, dtype=np.uint8)
        min_syndrome_weight = 999

        for iteration in range(1, self.max_iterations + 1):
            # 1. Check Node Update (Normalized Min-Sum)
            for c in range(self.m):
                vars_connected = self.check_to_vars[c]
                num_vars = len(vars_connected)

                incoming = np.zeros(num_vars, dtype=np.float32)
                for i, v in enumerate(vars_connected):
                    c_idx_in_v = self.var_to_checks[v].index(c)
                    incoming[i] = v_to_c[v][c_idx_in_v]

                signs = np.sign(incoming)
                signs[signs == 0] = 1.0
                magnitudes = np.abs(incoming)
                prod_sign = np.prod(signs)

                for i in range(num_vars):
                    other_mags = np.delete(magnitudes, i)
                    min_mag = np.min(other_mags) if len(other_mags) > 0 else 0.0
                    edge_sign = prod_sign * signs[i]
                    c_to_v[c][i] = self.alpha * edge_sign * min_mag

            # 2. Variable Node Update & Hard Decision
            total_llrs = np.copy(llr_channel)
            hard_decision = np.zeros(self.n, dtype=np.uint8)

            for v in range(self.n):
                checks_connected = self.var_to_checks[v]
                sum_c_to_v = 0.0
                for j, c in enumerate(checks_connected):
                    v_idx_in_c = self.check_to_vars[c].index(v)
                    sum_c_to_v += c_to_v[c][v_idx_in_c]

                total = llr_channel[v] + sum_c_to_v
                total_llrs[v] = total
                hard_decision[v] = 1 if total < 0 else 0

                # Outgoing message update: L_{v->c} = total - L_{c->v}
                for j, c in enumerate(checks_connected):
                    v_idx_in_c = self.check_to_vars[c].index(v)
                    v_to_c[v][j] = total - c_to_v[c][v_idx_in_c]

            # 3. Early Termination Check via Syndrome & CRC
            syndrome = self.compute_syndrome(hard_decision)
            syndrome_weight = int(np.sum(syndrome))

            if syndrome_weight < min_syndrome_weight:
                min_syndrome_weight = syndrome_weight
                best_codeword = np.copy(hard_decision)

            if syndrome_weight == 0:
                info_bits = hard_decision[:self.k]
                payload = info_bits[:63]
                rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
                computed_crc = self.compute_crc14(payload)

                if computed_crc == rcvd_crc:
                    return True, info_bits, iteration

        # Decode incomplete
        return False, best_codeword[:self.k], self.max_iterations
