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
     synchronisation, the seeded benchmark crosses 50% decode at -24.58 dB SNR and 90% at
     -23.48 dB (2500 Hz reference bandwidth, seed 20260830, 200 frames/point). That is a bound
     on the code under ideal detection,
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

5. Multi-Schedule Belief Propagation Decoder:
   - Check Node Update: L_{c->v} = alpha * prod(sign(L_{v'->c})) * min_{v' != v}(|L_{v'->c}|)
     where alpha is the schedule's own empirical normalization factor mitigating check node
     overestimation - see DECODE_SCHEDULES; there is no single alpha for the decoder.
   - Variable Node Update: L_{v->c} = L_{ch, v} + sum_{c' != c} L_{c'->v}
   - Early stopping condition: syndrome s = H * c^T == 0 (mod 2) and CRC valid.
   - The sweep is layered and stays serial across checks; only schedule 2's box-plus fold is
     vectorised, and only because measurement said so. This heading read "Vectorized Normalized
     Min-Sum" for years while every message was computed one edge at a time in NumPy scalar
     arithmetic - the slowest way to do it - so the name described an implementation that did
     not exist. See `_sweep_checks` for what is and is not vectorised now, and the numbers that
     decided it.
"""

from typing import Any, Dict, List, Tuple
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


#: How far an a priori LLR is pushed beyond the strongest evidence the channel actually
#: supplied, as a multiple of max|LLR| over the frame.
#:
#: WSJT-X's `lib/ft8/ft8b.f90` computes `apmag=maxval(abs(llra))*1.01` and this is a direct
#: port of that rule. The magnitude is *derived from the frame*, never a constant: a fixed
#: number large enough to dominate a strong frame would be arbitrarily larger than the evidence
#: in a weak one, and a fixed number sized for a weak frame would be overridden in a strong one.
#: Scaling with the frame keeps an AP bit exactly one notch more certain than the most certain
#: thing the demodulator measured, whatever the signal level.
#:
#: The twin of `AP_LLR_MARGIN` in src/dsp/apDecode.ts, pinned by
#: tests/test_cross_language_parity.py.
AP_LLR_MARGIN: float = 1.01


def ap_llr_magnitude(llr_channel: "np.ndarray | List[float]") -> float:
    """
    The magnitude an a priori bit is asserted with, for this frame's channel LLRs.

    `AP_LLR_MARGIN * max(|LLR|)`, WSJT-X's rule. Returns 0.0 for an all-zero frame, which
    `apply_ap_hypothesis` turns into a no-op rather than a division or a NaN.
    """
    arr = np.asarray(llr_channel, dtype=np.float64)
    return float(AP_LLR_MARGIN * np.max(np.abs(arr))) if arr.size else 0.0


def apply_ap_hypothesis(
    llr_channel: "np.ndarray | List[float]",
    ap_mask: "np.ndarray | List[int]",
    ap_bits: "np.ndarray | List[int]",
) -> "np.ndarray":
    """
    A copy of `llr_channel` with every masked position replaced by its a priori LLR.

    Sign convention is this codec's, not WSJT-X's: here L = ln(P(c=0)/P(c=1)) and the hard
    decision is `llr < 0 -> 1`, so an asserted 0 becomes `+apmag` and an asserted 1 becomes
    `-apmag`. WSJT-X's `bpdecode174_91` reads the opposite sign and its `apsym=2*bit-1` term
    carries the flip; transcribing that expression instead of re-deriving it would assert every
    a priori bit inverted, and every hypothesis would fail its CRC.

    Args:
        llr_channel: the frame's channel LLRs (216, or 77 when only the information block is
            being constrained - the length is whatever the caller passes).
        ap_mask: 1 where the bit is asserted, 0 where the channel is left to speak.
        ap_bits: the asserted values, read only where `ap_mask` is 1.
    """
    out = np.array(llr_channel, dtype=np.float32)
    mask = np.asarray(ap_mask, dtype=bool)
    bits = np.asarray(ap_bits, dtype=np.uint8)
    if mask.size > out.size or bits.size < mask.size:
        raise ValueError("ap_mask/ap_bits must not be longer than the LLR vector")
    apmag = ap_llr_magnitude(out)
    if apmag <= 0.0:
        return out
    idx = np.nonzero(mask)[0]
    out[idx] = np.where(bits[idx] == 0, np.float32(apmag), np.float32(-apmag))
    return out


#: Magnitude the check-node scan initialises its two running minima to.
#:
#: A sentinel, not a bound: a magnitude at or above it never replaces `min1`/`min2`, so a check
#: whose incoming messages were all that large would behave as if every message had magnitude
#: 999999. The demodulator clips channel LLRs to +/-25 and every schedule clips or normalises its
#: own messages, so nothing on this code approaches it. Named rather than left as a literal so
#: the sweep and anything checking the sweep read the same number.
_MIN_SENTINEL: float = 999999.0

#: float32 constants `_box_plus_into` compares and multiplies against. Named so the kernel cannot
#: quietly acquire a float64 operand: NumPy keeps a float32 array float32 against a Python float,
#: but an intermediate that widens to float64 and back rounds differently from the edge-at-a-time
#: box-plus it has to match, which is what the equivalence test exists to catch.
_F32_ZERO = np.float32(0.0)
_F32_ONE = np.float32(1.0)
_F32_NEG_ONE = np.float32(-1.0)
_F32_NEG_THIRTY = np.float32(-30.0)


class _SweepScratch:
    """
    Per-decode working buffers for the check-node sweep, sized to the largest check degree.

    Allocated once per `decode_min_sum` call rather than once per check per iteration: the
    reference built a fresh `np.zeros(num_vars)` inside the check loop, which is 139 allocations
    an iteration and up to 20,850 across a full four-schedule cascade.

    Held on the call, never on the codec. A worker pool shares one `Z30LdpcCodec` across frames
    (`benchmark._init_decode_worker`), and `decode_prepared_frame` is required to be a pure
    function of its input - scratch hung off `self` would make two concurrent decodes share a
    buffer and would make the codec carry state between frames.
    """

    __slots__ = ("vals", "msg", "acc", "aux", "work")

    def __init__(self, degree: int) -> None:
        self.vals = np.zeros(degree, dtype=np.float32)
        self.msg = np.zeros(degree, dtype=np.float32)
        self.acc = np.zeros(degree, dtype=np.float32)
        self.aux = np.zeros(degree, dtype=np.float32)
        self.work = np.zeros(2 * degree, dtype=np.float32)


def _bits_to_int(bits: "np.ndarray | List[int]") -> int:
    """
    MSB-first integer value of a bit sequence.

    Replaces `int("".join(str(b) for b in bits), 2)`, which built a Python string per call - once
    per decode iteration for the received CRC field, and again for every OSD candidate. Same
    value, no formatting; the arithmetic is integer either way so nothing about the result moves.
    """
    value = 0
    for bit in (bits.tolist() if isinstance(bits, np.ndarray) else bits):
        value = (value << 1) | (int(bit) & 1)
    return value


#: Schedule 1's belief-propagation iteration cap, and the codec's default.
#:
#: The twin of `LDPC_MAX_ITERATIONS` in src/dsp/ldpcCodec.ts, pinned across the two languages by
#: tests/test_cross_language_parity.py. Named rather than left as a literal so callers quote it
#: instead of retyping it - benchmark.py carried its own `45`, which would have gone on reading
#: correct after this one changed, leaving the published curve describing a decoder that no
#: longer ships. Same rule AGENTS.md states for UI prose quoting constants.
LDPC_MAX_ITERATIONS: int = 45


class Z30LdpcCodec:
    """
    Production-grade Systematic (216, 77) LDPC Codec.
    Implements IRA forward-substitution encoding and normalized Min-Sum belief propagation.
    """

    def __init__(self, max_iterations: int = LDPC_MAX_ITERATIONS) -> None:
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

        check_rows, var_cols = np.nonzero(self.H)
        for c, v in zip(check_rows.tolist(), var_cols.tolist()):
            self.check_to_vars[c].append(v)
            self.var_to_checks[v].append(c)

        # Flat edge layout for the check-node sweep: the messages of check c occupy
        # `_edge_lo[c]:_edge_hi[c]` of one contiguous float32 array, in the same ascending
        # variable order `check_to_vars[c]` uses. One array instead of 139 keeps the sweep's
        # per-check work to slice views, and lets a decode allocate its message state once
        # rather than once per check per iteration.
        degrees = np.array([len(vars_c) for vars_c in self.check_to_vars], dtype=np.intp)
        self._edge_hi: np.ndarray = np.cumsum(degrees)
        self._edge_lo: np.ndarray = self._edge_hi - degrees
        self._n_edges: int = int(self._edge_hi[-1]) if self.m else 0
        self._max_check_degree: int = int(degrees.max()) if self.m else 0
        self._check_order_forward: List[int] = list(range(self.m))
        self._check_order_reverse: List[int] = list(range(self.m))[::-1]

        # (139, 5) view of the connection table, so the IRA parity accumulation is a pair of
        # array reductions rather than a 139x5 Python loop. Re-derived from the same table the
        # matrix is built from, not from H, so a table edit reaches both.
        self._info_index_table: np.ndarray = np.asarray(Z30_CHECK_TO_INFO, dtype=np.intp)

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
        # `.tolist()` first: iterating a NumPy array yields a fresh scalar object per bit, and
        # this runs twice per decode iteration and once per OSD candidate. The register maths
        # below is integer either way, so the value is unchanged.
        for b in (bits.tolist() if isinstance(bits, np.ndarray) else bits):
            msb = (crc >> 13) & 1
            crc = ((crc << 1) & 0x3FFF) ^ (poly if (msb ^ (int(b) & 1)) else 0)
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
        codeword[self.k:] = self._accumulate_parity(info_bits)

        return codeword

    def _accumulate_parity(self, info_bits_77: np.ndarray) -> np.ndarray:
        """
        The dual-diagonal IRA parity bits for 77 information bits.

        p_i = p_{i-1} ^ (sum_{j in N(i)} u_j), which is a running XOR of the per-check
        information sums - one gather, one row-wise XOR reduction and one cumulative XOR,
        instead of the 139x5 scalar loop this replaces. Integer XOR is exact and associative,
        so the bits are the ones the loop produced; what changes is that `decode_min_sum` calls
        this up to a hundred times per failing frame from the OSD-2 search.
        """
        info_sums = np.bitwise_xor.reduce(
            np.asarray(info_bits_77, dtype=np.uint8)[self._info_index_table], axis=1
        )
        return np.bitwise_xor.accumulate(info_sums)

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
        codeword[self.k:] = self._accumulate_parity(codeword[:self.k])
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

    @staticmethod
    def _box_plus_into(x: np.ndarray, y: "np.float32", out: np.ndarray, work: np.ndarray) -> None:
        """
        `_box_plus(x[i], y)` for every element of `x`, written to `out`.

        The same expression as `_box_plus`, in the same order, on float32 operands throughout -
        which is the precision `_box_plus` itself runs at, since its arguments come from the
        float32 message array and NumPy keeps a float32 scalar float32 against a Python float.

        `work` is a scratch buffer of twice the check degree: both Jacobian corrections are
        computed as one array so the `exp` and `log1p` dispatches are paid once instead of
        twice. Those two transcendentals are the reason this function is the decoder's hot
        spot - schedule 2 evaluates it 5,838 times per sweep - and a NumPy scalar call costs
        essentially the same as a call on a short vector, so what buys the time here is calling
        them fewer times, not on fewer numbers.

        `diff_sum < 30` is tested as `-diff_sum > -30`, the negation being needed for the
        exponent anyway; the comparison is exact either way. The branch is kept rather than left
        to underflow: at |x+y| just past 30 the correction is ~9e-14, below float32 resolution
        beside a message of order 1 but *not* beside a message of order 0, so dropping the mask
        would change the smallest messages.
        """
        degree = x.size
        sign_y = _F32_ONE if y >= _F32_ZERO else _F32_NEG_ONE
        head = work[:degree]
        tail = work[degree:]

        # sign_prod * min(|x|, |y|)
        np.abs(x, out=out)
        np.minimum(out, abs(y), out=out)
        np.multiply(out, np.where(x >= _F32_ZERO, sign_y, -sign_y), out=out)

        # log1p(exp(-|x + y|)) and log1p(exp(-|x - y|)), together
        np.add(x, y, out=head)
        np.subtract(x, y, out=tail)
        np.abs(work, out=work)
        np.negative(work, out=work)
        keep = work > _F32_NEG_THIRTY
        np.exp(work, out=work)
        np.log1p(work, out=work)
        np.multiply(work, keep, out=work)

        np.add(out, head, out=out)
        np.subtract(out, tail, out=out)

    def _spa_messages(
        self,
        vals: np.ndarray,
        degree: int,
        alpha: float,
        out: np.ndarray,
        scratch: "_SweepScratch",
    ) -> None:
        """
        The log-domain sum-product (box-plus) check-to-variable messages for one check.

        Schedule 2 folds, for each edge i, over the other edges in increasing j - so the fold
        order differs per edge, and box-plus is not associative in floating point. The usual
        leave-one-out shortcut (a forward/backward cumulative pair) folds the suffix from the
        right and lands a few ULP away, which is a different decoder rather than a faster one,
        so it is not used here.

        What is used instead: run the d folds as d lanes stepping j together. Every lane still
        consumes j in increasing order, so each lane's fold order is exactly the one the
        edge-at-a-time loop produced, while the transcendentals inside `_box_plus` are paid
        once per step instead of once per (edge, step) pair.

        Lane i skips step j == i, so at j == 0 every lane but lane 0 takes its first value, and
        at j == 1 lane 0 takes its own first value while the rest are already folding.
        """
        acc = scratch.acc[:degree]
        aux = scratch.aux[:degree]
        acc.fill(_F32_ZERO)

        for j in range(degree):
            y = vals[j]
            if j == 0:
                acc[1:] = y
                continue
            self._box_plus_into(acc, y, aux, scratch.work[:2 * degree])
            if j == 1:
                acc[2:] = aux[2:]
                acc[0] = y
            else:
                acc[:j] = aux[:j]
                acc[j + 1:] = aux[j + 1:]

        np.multiply(acc, alpha, out=out)
        np.clip(out, -20.0, 20.0, out=out)

    def _sweep_checks(
        self,
        total_llrs: np.ndarray,
        msgs: np.ndarray,
        scratch: "_SweepScratch",
        alpha: float,
        beta: float,
        damping: float,
        spa: bool,
        reverse: bool,
        ap_pinned: "List[bool] | None" = None,
    ) -> None:
        """
        One layered check-node sweep, mutating `total_llrs` and `msgs` in place.

        **The sweep stays serial across checks on purpose.** The schedule is layered: a check
        reads `total_llrs` entries that earlier checks in the same sweep have already written,
        so updating all 139 checks from one snapshot is the *flooding* schedule instead - a
        different decoder, which converges differently and would move every threshold in
        wiki/16. There is no order-preserving way around it either: the dual-diagonal parity
        structure puts checks p and p+1 on a shared parity bit, so consecutive checks always
        conflict, and no reordering into independent groups exists.

        **Only schedule 2's box-plus fold is vectorised, because only it is worth vectorising.**
        Measured per sweep on this code: the min-sum schedules cost 2.1 ms and schedule 2 costs
        34.4 ms, so the sum-product fold is ~86% of a full cascade. Rewriting the min-sum edge
        loop in NumPy was tried and made it *slower* (3.8 ms against 2.1 ms): at a check degree
        of 6 or 7, a ufunc dispatch costs more than the scalar arithmetic it replaces. The fold
        wins because it is the one place where vectorising removes `exp`/`log1p` *calls* rather
        than merely widening them. Measure before extending this either way.

        Every intermediate stays float32 and every operation keeps the reference's order, so
        the messages are bit-identical; `tests/test_ldpc_vectorized_equivalence.py` pins that
        against a transcription of the scalar sweep.

        `ap_pinned` marks variables held at their a priori value: their `total_llrs` entry never
        receives a check message, so the belief the caller asserted survives every iteration.
        This is WSJT-X's `bpdecode174_91` rule (`zn(i)=llr(i)` where `apmask(i)==1`) expressed
        in a layered decoder. Note that the variable-to-check message for a pinned bit is still
        `total_llrs[v] - msgs_c[i]`, which reproduces WSJT-X's `toc = zn(ibj) - tov(kk,ibj)`
        exactly - the pin fixes the bit's *belief*, it does not stop the bit from telling its
        checks what it believes.

        `None` is the ordinary path, and the identity check that selects it is the only thing
        that path pays: no arithmetic here changes, so an AP-less decode is bit-identical to
        the one this function performed before AP existed.
        """
        check_order = self._check_order_reverse if reverse else self._check_order_forward

        for c in check_order:
            vars_connected = self.check_to_vars[c]
            num_vars = len(vars_connected)
            lo = int(self._edge_lo[c])
            msgs_c = msgs[lo:lo + num_vars]

            v_to_c_vals = scratch.vals[:num_vars]
            min1, min2 = _MIN_SENTINEL, _MIN_SENTINEL
            min1_idx = -1
            prod_sign = 1.0

            for i, v in enumerate(vars_connected):
                val = total_llrs[v] - msgs_c[i]
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

            if spa:
                self._spa_messages(v_to_c_vals, num_vars, alpha, scratch.msg[:num_vars], scratch)

            for i, v in enumerate(vars_connected):
                if spa:
                    new_msg = scratch.msg[i]
                else:
                    val = v_to_c_vals[i]
                    self_sign = 1.0 if val >= 0 else -1.0
                    edge_sign = prod_sign * self_sign
                    min_mag = min2 if i == min1_idx else min1
                    new_msg = edge_sign * max(0.0, alpha * min_mag - beta)

                damped_msg = (1.0 - damping) * msgs_c[i] + damping * new_msg
                diff = damped_msg - msgs_c[i]
                msgs_c[i] = damped_msg
                if ap_pinned is None or not ap_pinned[v]:
                    total_llrs[v] += diff

    def decode_min_sum(
        self,
        llr_channel: np.ndarray,
        ap_mask: "np.ndarray | List[int] | None" = None,
    ) -> Tuple[bool, np.ndarray, int]:
        """
        Ultra-Sensitive Multi-Schedule Damped Log-SPA & Layered Normalized Min-Sum LDPC Decoder
        with Trellis-IRA Re-Accumulation and OSD-2 Chase Reliability Search.

        Args:
            llr_channel (np.ndarray): Array of 216 soft channel log-likelihood ratios.
            ap_mask: optional a priori mask, 1 where the corresponding LLR is an asserted belief
                rather than a measurement. Shorter than 216 is accepted and zero-extended, so a
                caller constraining only the information block passes 77 values. `llr_channel`
                must already carry the asserted LLRs at those positions - build both with
                `apply_ap_hypothesis`, which is what keeps the assertion and the mask from
                drifting apart. The default of None is the ordinary decode, and it is
                bit-identical to what this decoder produced before AP existed.

        Returns:
            Tuple[bool, np.ndarray, int]: (success_flag, decoded_77_info_bits, iterations)
        """
        assert len(llr_channel) == self.n, f"Expected {self.n} LLRs"
        input_llr = np.array(llr_channel, dtype=np.float32)

        # A Python list of bools, not a NumPy array: this is indexed once per edge per check per
        # iteration inside `_sweep_checks`, where a NumPy scalar read costs far more than a list
        # element read. Built once per decode.
        ap_pinned: "List[bool] | None" = None
        pinned_indices: np.ndarray = np.zeros(0, dtype=np.intp)
        if ap_mask is not None:
            mask_arr = np.zeros(self.n, dtype=bool)
            supplied = np.asarray(ap_mask, dtype=bool)
            if supplied.size > self.n:
                raise ValueError(f"ap_mask has {supplied.size} entries; the code has {self.n} bits")
            mask_arr[:supplied.size] = supplied
            if mask_arr.any():
                ap_pinned = mask_arr.tolist()
                pinned_indices = np.nonzero(mask_arr)[0]

        # 1. Check if raw channel hard decisions already form a valid codeword
        raw_hard = (input_llr < 0).astype(np.uint8)
        raw_payload = raw_hard[:63]
        raw_crc = _bits_to_int(raw_hard[63:77])
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
        scratch = _SweepScratch(self._max_check_degree)

        for sched in schedules:
            total_llrs = np.copy(input_llr)
            if sched['mode'] == 'DITHER':
                # Derived from the channel LLRs, not from the unseeded global RNG - see
                # dither_vector(). This is what keeps a seeded benchmark reproducible.
                total_llrs += dither_vector(input_llr, self.n)
                # A pinned bit is an assertion, not a measurement, so there is nothing there for
                # stochastic resonance to shake loose. The dither vector itself is still drawn
                # over all 216 positions from the same seed, so schedule 4 perturbs the
                # unpinned bits by exactly the values it would have without a mask.
                total_llrs[pinned_indices] = input_llr[pinned_indices]

            # Check-to-variable messages, one flat array indexed by _edge_lo/_edge_hi.
            c_to_v = np.zeros(self._n_edges, dtype=np.float32)
            is_spa = sched['mode'] == 'SPA'

            for iteration in range(1, sched['iters'] + 1):
                total_iterations += 1

                # Layered Schedule Check-Node Sweep
                self._sweep_checks(
                    total_llrs,
                    c_to_v,
                    scratch,
                    sched['alpha'],
                    sched['beta'],
                    sched['damping'],
                    is_spa,
                    sched['reverse'],
                    ap_pinned,
                )

                # Hard decisions
                hard_decision = (total_llrs < 0).astype(np.uint8)
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
                    rcvd_crc = _bits_to_int(info_bits[63:])
                    if self.compute_crc14(payload) == rcvd_crc:
                        return True, info_bits, total_iterations

                # Trellis-IRA Parity Check when payload CRC matches received CRC
                tentative_payload = hard_decision[:63]
                tentative_crc = self.compute_crc14(tentative_payload)
                rcvd_crc = _bits_to_int(hard_decision[63:77])

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
                rcvd_crc = _bits_to_int(info_bits[63:])
                if self.compute_crc14(payload) == rcvd_crc:
                    return True, info_bits, total_iterations

        # =====================================================================
        # POST-PROCESSING: CRC-14-Constrained OSD-2 / Chase Reliability Search
        # =====================================================================
        if min_syndrome_weight <= 14:
            base_payload = best_codeword[:63]
            # A pinned bit is never a flip candidate. In practice it would not be chosen anyway
            # - it carries the largest magnitude in the frame by construction, so it sorts last
            # - but "never" and "not in practice" are different guarantees, and the difference
            # matters here: flipping one would hand back a codeword that contradicts the very
            # hypothesis whose CRC is being used to decide the hypothesis was right.
            flip_candidates = (
                range(63) if ap_pinned is None
                else [i for i in range(63) if not ap_pinned[i]]
            )
            ranked_indices = sorted(flip_candidates, key=lambda i: abs(best_total_llrs[i]))
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
                rcvd_crc = _bits_to_int(info_bits[63:])
                if self.compute_crc14(payload) == rcvd_crc:
                    return True, info_bits, total_iterations

        return False, best_codeword[:self.k], total_iterations
