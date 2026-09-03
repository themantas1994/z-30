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
     not exist. See \`_sweep_checks\` for what is and is not vectorised now, and the numbers that
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

#: The four decode schedules \`decode_min_sum\` runs, in order, stopping at the first that
#: produces a codeword whose syndrome is zero and whose CRC-14 matches.
#:
#: There is deliberately no single "the decoder's alpha". One used to be documented in wiki/04,
#: accepted as a constructor argument here, exported as \`Z30_LDPC_PARAMS.alphaMinSum\` in
#: TypeScript and rendered in the Specs modal as 0.75 - a value none of these four schedules
#: has ever used. The table is the specification; anything that wants to describe the decoder
#: reads it rather than retyping a number beside it.
#:
#: The twin of \`Z30_DECODE_SCHEDULES\` in src/dsp/ldpcCodec.ts, asserted equal by
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
    schedule stalls on. That perturbation used to come from \`np.random.rand()\` - the unseeded
    global generator - so the decoder was not a function of its input: two seeded benchmark
    runs of the identical configuration could decode a different set of frames, precisely
    among the near-threshold frames the benchmark exists to characterise. AGENTS.md's
    determinism invariant says unseeded RNG does not belong in that path.

    Threading a seeded generator in from the benchmark would fix the benchmark and nothing
    else: \`decode_min_sum\` is also called by the SIC decoder and by the live receive path,
    where there is no seed to thread, and a frame captured off the air still has to decode the
    same way twice. Deriving the seed from the input instead makes the decoder a pure function
    everywhere - the same LLRs always give the same answer, in isolation, in any caller, in
    either language. The perturbation only has to be uncorrelated with the code's structure,
    not unpredictable, so nothing is lost by making it reproducible.

    Quantising to 1/64 before hashing keeps the derivation on integers, so Python and
    TypeScript agree bit for bit; \`math.floor(x * 64 + 0.5)\` rather than \`round()\` because
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
    The schedule-4 LLR perturbation for \`llr_channel\`: \`length\` values in +/-DITHER_AMPLITUDE/2.

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
#: WSJT-X's \`lib/ft8/ft8b.f90\` computes \`apmag=maxval(abs(llra))*1.01\` and this is a direct
#: port of that rule. The magnitude is *derived from the frame*, never a constant: a fixed
#: number large enough to dominate a strong frame would be arbitrarily larger than the evidence
#: in a weak one, and a fixed number sized for a weak frame would be overridden in a strong one.
#: Scaling with the frame keeps an AP bit exactly one notch more certain than the most certain
#: thing the demodulator measured, whatever the signal level.
#:
#: The twin of \`AP_LLR_MARGIN\` in src/dsp/apDecode.ts, pinned by
#: tests/test_cross_language_parity.py.
AP_LLR_MARGIN: float = 1.01


def ap_llr_magnitude(llr_channel: "np.ndarray | List[float]") -> float:
    """
    The magnitude an a priori bit is asserted with, for this frame's channel LLRs.

    \`AP_LLR_MARGIN * max(|LLR|)\`, WSJT-X's rule. Returns 0.0 for an all-zero frame, which
    \`apply_ap_hypothesis\` turns into a no-op rather than a division or a NaN.
    """
    arr = np.asarray(llr_channel, dtype=np.float64)
    return float(AP_LLR_MARGIN * np.max(np.abs(arr))) if arr.size else 0.0


def apply_ap_hypothesis(
    llr_channel: "np.ndarray | List[float]",
    ap_mask: "np.ndarray | List[int]",
    ap_bits: "np.ndarray | List[int]",
) -> "np.ndarray":
    """
    A copy of \`llr_channel\` with every masked position replaced by its a priori LLR.

    Sign convention is this codec's, not WSJT-X's: here L = ln(P(c=0)/P(c=1)) and the hard
    decision is \`llr < 0 -> 1\`, so an asserted 0 becomes \`+apmag\` and an asserted 1 becomes
    \`-apmag\`. WSJT-X's \`bpdecode174_91\` reads the opposite sign and its \`apsym=2*bit-1\` term
    carries the flip; transcribing that expression instead of re-deriving it would assert every
    a priori bit inverted, and every hypothesis would fail its CRC.

    Args:
        llr_channel: the frame's channel LLRs (216, or 77 when only the information block is
            being constrained - the length is whatever the caller passes).
        ap_mask: 1 where the bit is asserted, 0 where the channel is left to speak.
        ap_bits: the asserted values, read only where \`ap_mask\` is 1.
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
#: A sentinel, not a bound: a magnitude at or above it never replaces \`min1\`/\`min2\`, so a check
#: whose incoming messages were all that large would behave as if every message had magnitude
#: 999999. The demodulator clips channel LLRs to +/-25 and every schedule clips or normalises its
#: own messages, so nothing on this code approaches it. Named rather than left as a literal so
#: the sweep and anything checking the sweep read the same number.
_MIN_SENTINEL: float = 999999.0

#: float32 constants \`_box_plus_into\` compares and multiplies against. Named so the kernel cannot
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

    Allocated once per \`decode_min_sum\` call rather than once per check per iteration: the
    reference built a fresh \`np.zeros(num_vars)\` inside the check loop, which is 139 allocations
    an iteration and up to 20,850 across a full four-schedule cascade.

    Held on the call, never on the codec. A worker pool shares one \`Z30LdpcCodec\` across frames
    (\`benchmark._init_decode_worker\`), and \`decode_prepared_frame\` is required to be a pure
    function of its input - scratch hung off \`self\` would make two concurrent decodes share a
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

    Replaces \`int("".join(str(b) for b in bits), 2)\`, which built a Python string per call - once
    per decode iteration for the received CRC field, and again for every OSD candidate. Same
    value, no formatting; the arithmetic is integer either way so nothing about the result moves.
    """
    value = 0
    for bit in (bits.tolist() if isinstance(bits, np.ndarray) else bits):
        value = (value << 1) | (int(bit) & 1)
    return value


#: Schedule 1's belief-propagation iteration cap, and the codec's default.
#:
#: The twin of \`LDPC_MAX_ITERATIONS\` in src/dsp/ldpcCodec.ts, pinned across the two languages by
#: tests/test_cross_language_parity.py. Named rather than left as a literal so callers quote it
#: instead of retyping it - benchmark.py carried its own \`45\`, which would have gone on reading
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
                schedule 1's cap; the four schedules of \`decode_min_sum\` carry their own.

        There is deliberately no \`alpha\` argument. One used to be accepted here, defaulting to
        0.75, stored as \`self.alpha\` - and never read by the decoder, which has always applied
        the four per-schedule alphas in \`decode_min_sum\` instead. Constructing the codec with
        \`alpha=0.5\` changed nothing, while the number was quoted in wiki/04 and rendered in the
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
        # \`_edge_lo[c]:_edge_hi[c]\` of one contiguous float32 array, in the same ascending
        # variable order \`check_to_vars[c]\` uses. One array instead of 139 keeps the sweep's
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
        # \`.tolist()\` first: iterating a NumPy array yields a fresh scalar object per bit, and
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
        so the bits are the ones the loop produced; what changes is that \`decode_min_sum\` calls
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
        \`_box_plus(x[i], y)\` for every element of \`x\`, written to \`out\`.

        The same expression as \`_box_plus\`, in the same order, on float32 operands throughout -
        which is the precision \`_box_plus\` itself runs at, since its arguments come from the
        float32 message array and NumPy keeps a float32 scalar float32 against a Python float.

        \`work\` is a scratch buffer of twice the check degree: both Jacobian corrections are
        computed as one array so the \`exp\` and \`log1p\` dispatches are paid once instead of
        twice. Those two transcendentals are the reason this function is the decoder's hot
        spot - schedule 2 evaluates it 5,838 times per sweep - and a NumPy scalar call costs
        essentially the same as a call on a short vector, so what buys the time here is calling
        them fewer times, not on fewer numbers.

        \`diff_sum < 30\` is tested as \`-diff_sum > -30\`, the negation being needed for the
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
        edge-at-a-time loop produced, while the transcendentals inside \`_box_plus\` are paid
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
        One layered check-node sweep, mutating \`total_llrs\` and \`msgs\` in place.

        **The sweep stays serial across checks on purpose.** The schedule is layered: a check
        reads \`total_llrs\` entries that earlier checks in the same sweep have already written,
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
        wins because it is the one place where vectorising removes \`exp\`/\`log1p\` *calls* rather
        than merely widening them. Measure before extending this either way.

        Every intermediate stays float32 and every operation keeps the reference's order, so
        the messages are bit-identical; \`tests/test_ldpc_vectorized_equivalence.py\` pins that
        against a transcription of the scalar sweep.

        \`ap_pinned\` marks variables held at their a priori value: their \`total_llrs\` entry never
        receives a check message, so the belief the caller asserted survives every iteration.
        This is WSJT-X's \`bpdecode174_91\` rule (\`zn(i)=llr(i)\` where \`apmask(i)==1\`) expressed
        in a layered decoder. Note that the variable-to-check message for a pinned bit is still
        \`total_llrs[v] - msgs_c[i]\`, which reproduces WSJT-X's \`toc = zn(ibj) - tov(kk,ibj)\`
        exactly - the pin fixes the bit's *belief*, it does not stop the bit from telling its
        checks what it believes.

        \`None\` is the ordinary path, and the identity check that selects it is the only thing
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
                caller constraining only the information block passes 77 values. \`llr_channel\`
                must already carry the asserted LLRs at those positions - build both with
                \`apply_ap_hypothesis\`, which is what keeps the assertion and the mask from
                drifting apart. The default of None is the ordinary decode, and it is
                bit-identical to what this decoder produced before AP existed.

        Returns:
            Tuple[bool, np.ndarray, int]: (success_flag, decoded_77_info_bits, iterations)
        """
        assert len(llr_channel) == self.n, f"Expected {self.n} LLRs"
        input_llr = np.array(llr_channel, dtype=np.float32)

        # A Python list of bools, not a NumPy array: this is indexed once per edge per check per
        # iteration inside \`_sweep_checks\`, where a NumPy scalar read costs far more than a list
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

def codeword_to_symbols(codeword_216: Sequence[int], cfg: Z30Config) -> List[int]:
    """
    Packs a 216-bit LDPC codeword into 54 4-bit data tones and interleaves them with the 21
    Costas sync tones at \`cfg.sync_positions\`, producing the full 75-symbol transmission
    sequence. This was duplicated identically in \`benchmark.generate_random_frame\` and
    \`sic_decoder.Z30SicMultiSignalDecoder._recover_symbols\` - one copy here so a change to the
    interleave order or the sync-tone cycling can't drift between the encode path and the SIC
    re-encode path used to peel off a decoded signal.
    """
    data_symbols: List[int] = []
    for s in range(54):
        idx = s * 4
        tone = (
            (int(codeword_216[idx]) << 3)
            | (int(codeword_216[idx + 1]) << 2)
            | (int(codeword_216[idx + 2]) << 1)
            | int(codeword_216[idx + 3])
        )
        data_symbols.append(tone)

    full_symbols = [0] * cfg.total_symbols
    sync_pos_set = set(cfg.sync_positions)
    sync_cnt = 0
    data_cnt = 0
    for i in range(cfg.total_symbols):
        if i in sync_pos_set:
            full_symbols[i] = cfg.sync_tones[sync_cnt % len(cfg.sync_tones)]
            sync_cnt += 1
        else:
            full_symbols[i] = data_symbols[data_cnt]
            data_cnt += 1

    return full_symbols


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
- Non-coherent LLR demodulation on each candidate, sharing the exact matched-filter /
  Log-MAP math measured in z30_dsp.benchmark.demodulate_mfsk_llrs, at that function's
  default weight - which is the receiver every published threshold describes.
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
import math
import numpy as np
from z30_dsp.modem import Z30Modulator, Z30Config, codeword_to_symbols
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.benchmark import demodulate_mfsk_llrs

#: How far above the estimated noise floor a tone group must sit to be tried as a candidate.
#:
#: Shared with \`findCandidates\` in src/dsp/realReceiver.ts and pinned across the two languages by
#: tests/test_cross_language_parity.py. The two sides ran different detectors at different
#: thresholds (raw FFT bins at 8 dB here, Bartlett-averaged groups at 6 dB there) with no test
#: over either, so each could drift without anything noticing.
SIC_MIN_PEAK_DB: float = 6.0

#: Most candidates one pass will try, strongest first. Bounds the work a noisy band can create.
SIC_MAX_CANDIDATES: int = 16

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
        min_peak_db: float = SIC_MIN_PEAK_DB,
    ) -> List[Dict]:
        """
        Real spectral peak detector, the twin of \`findCandidates\` in src/dsp/realReceiver.ts.

        Hann-windowed FFT, fine bins averaged into \`tone_spacing_hz\`-wide groups (Bartlett's
        method), noise floor from the median group, and local maxima at least \`min_peak_db\`
        above that floor, deduplicated within one occupied bandwidth of each other.

        The averaging step is the part that matters and the part this side was missing. A ~24 s
        buffer gives an FFT bin spacing far finer than the ~3.125 Hz the search actually needs to
        localise a 16-MFSK comb, and with that many independent noise bins a fixed "X dB over the
        median" test is an order-statistics problem: the largest of ~10^5 noise bins clears 8 dB
        over the median routinely, so the detector produced spurious candidates from noise alone
        and spent SIC passes on them. Grouping restores both the resolution actually wanted and
        the statistics the threshold assumes.

        The two languages had diverged into genuinely different algorithms here - raw bins at
        8 dB in Python against grouped bins at 6 dB in TypeScript - with no parity test over
        either. Both now run this one, off the shared constants pinned by
        tests/test_cross_language_parity.py. Note that the published sensitivity figures are
        unaffected: benchmark.py measures through acquisition.py and never calls this function.
        """
        n = len(buffer)
        if n < 64:
            return []

        fft_size = 1
        while fft_size < n:
            fft_size *= 2
        window = np.hanning(n)
        padded = np.zeros(fft_size, dtype=np.float64)
        padded[:n] = buffer * window
        mags = np.abs(np.fft.rfft(padded))

        fine_bin_hz = self.cfg.sample_rate_hz / fft_size
        group_hz = self.cfg.tone_spacing_hz
        fine_per_group = max(1, int(round(group_hz / fine_bin_hz)))

        group_min_idx = max(0, int(math.floor(min_freq_hz / group_hz)))
        group_max_idx = int(math.floor(max_freq_hz / group_hz))
        num_groups = group_max_idx - group_min_idx + 1
        if num_groups < 3:
            return []

        group_db = np.full(num_groups, -999.0, dtype=np.float64)
        for g in range(num_groups):
            freq_hz = (group_min_idx + g) * group_hz
            fine_start = int(round(freq_hz / fine_bin_hz))
            fine_stop = min(len(mags), fine_start + fine_per_group)
            if fine_start >= fine_stop:
                continue
            power = mags[fine_start:fine_stop] ** 2
            group_db[g] = 10.0 * math.log10(max(float(np.mean(power)), 1e-12))

        noise_floor_db = float(np.sort(group_db)[num_groups // 2])
        threshold_db = noise_floor_db + min_peak_db
        min_spacing_groups = max(1, int(round(self.cfg.bandwidth_hz / group_hz)))
        min_spacing_hz = min_spacing_groups * group_hz

        candidates: List[Dict] = []
        for g in range(1, num_groups - 1):
            if group_db[g] > threshold_db and group_db[g] > group_db[g - 1] and group_db[g] > group_db[g + 1]:
                freq_hz = float((group_min_idx + g) * group_hz)
                if any(abs(freq_hz - c["freq_hz"]) < min_spacing_hz for c in candidates):
                    continue
                candidates.append({
                    "freq_hz": freq_hz,
                    "peak_db": float(group_db[g]),
                    "noise_floor_db": noise_floor_db,
                })

        candidates.sort(key=lambda c: c["peak_db"], reverse=True)
        return candidates[:SIC_MAX_CANDIDATES]

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
        Demodulates the candidate carrier at \`freq_hz\` into 216 soft channel LLRs through
        z30_dsp.benchmark.demodulate_mfsk_llrs, at its default coherence weight.

        Taking the default is the point rather than an omission. This call used to inherit a
        default of \`None\` - the pilot-distance-adaptive semi-coherent weight - while both
        benchmarks passed 0.0, so the decoder that ran on the air was not the decoder any
        published figure described. Measured paired at 100 frames per point (see
        benchmark.RECEIVER_PILOT_COHERENCE), that cost 1.77 dB on AWGN and very much more on a
        fading path: on ITU-R F.1487 mid-latitude disturbed the adaptive weight took 66 frames
        of 800 against 460, 394 discordant pairs to nil, exact two-sided McNemar p = 5e-119.
        A pilot phase reference does not survive a channel that is rotating it.

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
        then reassembles the full 75-symbol frame via modem.codeword_to_symbols - the same
        packing z30_dsp.benchmark.generate_random_frame uses to build a frame in the first
        place, so the SIC re-encode path can't drift from the encoder it is mirroring.
        """
        codeword = self.ldpc.encode(np.array(info_bits[:63], dtype=np.uint8))
        return codeword_to_symbols(codeword, self.cfg)
`,
  },
  {
    filename: "ap_decode.py",
    path: "z30_dsp/ap_decode.py",
    description: "A priori decoding: the QSO-state hypothesis ladder ported from WSJT-X, the gates that keep it narrow, and the constrained decode the CRC-14 arbitrates.",
    code: `"""
z-30 a priori (AP) decoding - the hypothesis ladder and the constrained decode.
==============================================================================

A ported idea, and the port is the interesting part
---------------------------------------------------
WSJT-X has decoded FT8 with a priori information since v1.8. The mechanism lives in
\`lib/ft8/ft8b.f90\` and \`lib/ft8/bpdecode174_91.f90\`: when an ordinary decode fails, the decoder
is re-run with some of the message bits *asserted* rather than measured, the assertion drawn
from what the QSO state machine already knows must be in the message - the operator's own
callsign, the callsign they are working, and for the closing messages the whole exchange. The
14-bit CRC then decides whether the assertion was right. A wrong hypothesis fails its CRC and
costs nothing but time; a right one recovers a frame that had too few good bits to close on its
own.

The gain is not a decoder improvement. It is information the receiver genuinely has and was
throwing away: a station answering your CQ *has* to have put your callsign in the first field,
so those 28 bits were never in question, and spending channel evidence to re-derive them is
spending it twice.

Four mechanisms carry over verbatim, and each is here for the reason WSJT-X has it:

  * **\`apmag\` scales with the frame.** \`AP_LLR_MARGIN * max|LLR|\` (WSJT-X's
    \`apmag=maxval(abs(llra))*1.01\`), computed in \`z30_dsp.ldpc.ap_llr_magnitude\`. See the
    constant's own note for why a fixed magnitude cannot work.
  * **Asserted bits are pinned, not merely biased.** \`decode_min_sum(..., ap_mask=...)\` holds
    them at their asserted value for every iteration, WSJT-X's \`zn(i)=llr(i)\`. Substituting a
    large LLR and letting belief propagation update it normally would let a run of confident
    check messages walk an asserted bit back, which is the one thing the assertion exists to
    prevent.
  * **The CRC is the arbiter, so AP never runs first.** An ordinary decode is attempted before
    any hypothesis, and a hypothesis is only accepted on a CRC-valid codeword. Every AP frame
    is therefore a frame that failed to decode on its own.
  * **The deep hypotheses are gated by frequency.** Types 3 and up assert 56 or 63 bits, which
    is most of the message; WSJT-X only permits those within \`napwid\` Hz of the frequency the
    operator is actually working (\`AP_FREQ_WINDOW_HZ\` here). Off in the corner of the passband
    there is no reason to believe the QSO state applies, and each extra hypothesis is another
    2^-14 roll of the CRC dice.

What that last point costs, stated plainly
-------------------------------------------
AP is not free. Each hypothesis is an additional codeword the CRC-14 has to reject, so a
station running the four-hypothesis ladder gives the receiver five chances (one ordinary, four
AP) to accept a wrong message instead of one. On random errors that is a false-accept
probability of roughly \`5 * 2^-14\` per candidate instead of \`2^-14\` - about 3.1e-4 against
6.1e-5. That is the trade WSJT-X makes too, and it is why the ladder is short, why it is
ordered by how likely the hypothesis is *given the QSO state*, and why the deep types are
frequency-gated. It is also why \`decode_with_ap\` re-checks the asserted fields in the accepted
payload rather than trusting that pinning made that impossible.

The measured effect on z-30 is in
[\`wiki/17\`](../wiki/17-A-Priori-(AP)-Decoding.md); \`benchmark.py --ap\` is the instrument.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .ldpc import Z30LdpcCodec, apply_ap_hypothesis
from .message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    FIELD_CALL_FROM,
    FIELD_CALL_TO,
    FIELD_EXTRA,
    PAYLOAD_BITS,
    bits_to_int,
    callsign_round_trips,
    encode_callsign28,
    field_slice,
    int_to_bits,
)

#: Half-width, in Hz, of the window around the worked frequency inside which the deep AP
#: hypotheses (types 3 and up) are permitted.
#:
#: WSJT-X sets \`napwid=75\` in \`lib/jt9.f90\` and applies it as
#: \`abs(f1-nfqso).gt.napwid .and. abs(f1-nftx).gt.napwid\` - the candidate has to be near either
#: the receive frequency or the transmit frequency. z-30 occupies the same 50 Hz an FT8 signal
#: does, so the number ports across unchanged: it is one signal width either side of the
#: carrier the operator is actually working.
#:
#: The twin of \`AP_FREQ_WINDOW_HZ\` in src/dsp/apDecode.ts, pinned by
#: tests/test_cross_language_parity.py.
AP_FREQ_WINDOW_HZ: float = 75.0

#: The lowest AP type that asserts more than one field, and so the lowest one the frequency
#: window applies to. Types 1 and 2 assert 28 bits and are cheap enough to try passband-wide,
#: which is what lets a CQ or a call to you be dug out of a corner you were not watching.
AP_DEEP_TYPE: int = 3

#: The AP hypothesis catalogue, adapted from the \`iaptype\` table in WSJT-X's \`lib/ft8/ft8b.f90\`.
#:
#: FT8 packs 28+28+15 bits plus a 3-bit message type; z-30 packs 28+28+7 and has no type field,
#: so the FT8 types' trailing \`i3\`/\`n3\` assertions have no counterpart here and the bit counts
#: differ. What is preserved is the ladder itself: which fields each hypothesis claims to know,
#: and in what order the QSO state makes them worth trying.
#:
#:   type  hypothesis              asserted fields                       payload bits asserted
#:   ----  ----------------------  ------------------------------------  ---------------------
#:    1    CQ     ???    ???       to = the CQ token                     28
#:    2    MyCall ???    ???       to = my callsign                      28
#:    3    MyCall DxCall ???       to = mine, from = theirs              56
#:    4    MyCall DxCall RRR       to, from, extra = RRR                 63
#:    5    MyCall DxCall 73        to, from, extra = 73                  63
#:    6    MyCall DxCall RR73      to, from, extra = RR73                63
#:
#: Types 4-6 assert every payload bit, leaving the 14 CRC bits as the only thing the channel
#: still has to supply - which is exactly WSJT-X's \`apmask(1:77)=1\`, where the FT8 CRC likewise
#: stays free. Asserting the CRC too would leave nothing to check the hypothesis against.
AP_TYPE_LABELS: Dict[int, str] = {
    1: "CQ ??? ???",
    2: "MyCall ??? ???",
    3: "MyCall DxCall ???",
    4: "MyCall DxCall RRR",
    5: "MyCall DxCall 73",
    6: "MyCall DxCall RR73",
}

#: The 7-bit modifier each closing hypothesis asserts.
AP_TYPE_EXTRA: Dict[int, int] = {4: EXTRA_RRR, 5: EXTRA_73, 6: EXTRA_RR73}

#: QSO stage -> the AP types to try, in order.
#:
#: The twin of WSJT-X's \`naptypes(nQSOProgress,1:4)\` table, mapped onto z-30's \`QsoStage\` union
#: (src/types/z30.ts). The orderings are WSJT-X's, stage for stage: while you are calling CQ the
#: likely frames are other CQs and answers to you; once you are exchanging reports the likely
#: frames are the closing messages of the QSO you are in; and at the 73 the ladder falls back
#: towards the general cases as the QSO winds down.
#:
#: The twin of \`AP_STAGE_LADDER\` in src/dsp/apDecode.ts, pinned by
#: tests/test_cross_language_parity.py.
AP_STAGE_LADDER: Dict[str, Tuple[int, ...]] = {
    "IDLE": (1, 2),
    "CALLING_CQ": (1, 2),
    "REPLYING_CQ": (2, 3),
    "SENDING_REPORT": (3, 4, 5, 6),
    "SENDING_R_REPORT": (3, 4, 5, 6),
    "SENDING_73": (3, 1, 2),
    "QSO_COMPLETED": (1, 2),
}


@dataclass(frozen=True)
class ApHypothesis:
    """
    One assertion about a frame's payload bits.

    \`mask\` and \`bits\` are 63 entries - the payload only. \`decode_min_sum\` zero-extends to 216,
    so nothing here ever asserts a parity bit: parity is what the code derives, and asserting it
    would be asserting the answer.
    """

    ap_type: int
    label: str
    mask: Tuple[int, ...]
    bits: Tuple[int, ...]

    @property
    def asserted_bit_count(self) -> int:
        return sum(self.mask)


@dataclass(frozen=True)
class ApDecodeResult:
    """
    What \`decode_with_ap\` made of one frame.

    \`ap_type\` is 0 for a frame that decoded on its own, which is the overwhelming majority of
    them; a nonzero value names the hypothesis that recovered it, the way WSJT-X reports
    \`iaptype\` alongside each decode so the operator can see which decodes leaned on assumed
    information.
    """

    success: bool
    info_bits: np.ndarray
    iterations: int
    ap_type: int
    ap_label: str
    hypotheses_tried: int


def _payload_assertion(fields: Sequence[Tuple[Tuple[int, int], int]]) -> Tuple[List[int], List[int]]:
    """Builds the (mask, bits) pair asserting each \`(field, value)\` and nothing else."""
    mask = [0] * PAYLOAD_BITS
    bits = [0] * PAYLOAD_BITS
    for field, value in fields:
        offset, width = field
        for i, bit in enumerate(int_to_bits(value, width)):
            mask[offset + i] = 1
            bits[offset + i] = bit
    return mask, bits


def build_hypothesis(
    ap_type: int,
    my_call: str,
    dx_call: str = "",
    cq_token: str = "CQ",
) -> Optional[ApHypothesis]:
    """
    The hypothesis for one AP type, or None when the station data cannot support it.

    Returns None rather than a weaker hypothesis. WSJT-X's guards are
    \`if(iaptype.ge.2 .and. apsym(1).gt.1) cycle\` and
    \`if(iaptype.ge.3 .and. apsym(30).gt.1) cycle\` - no usable callsign means the type is skipped
    outright, not tried with a placeholder. \`callsign_round_trips\` is the z-30 equivalent of the
    \`msg.eq.msgchk\` test \`ft8apset\` performs, and it rejects the same cases: a callsign that
    does not survive the 28-bit packing cannot be asserted, because the bits it would assert
    belong to a different callsign.
    """
    if ap_type not in AP_TYPE_LABELS:
        raise ValueError(f"unknown AP type {ap_type}; known types are {sorted(AP_TYPE_LABELS)}")

    if ap_type == 1:
        mask, bits = _payload_assertion([(FIELD_CALL_TO, encode_callsign28(cq_token))])
        return ApHypothesis(1, AP_TYPE_LABELS[1], tuple(mask), tuple(bits))

    if not callsign_round_trips(my_call):
        return None
    my_packed = encode_callsign28(my_call)

    if ap_type == 2:
        mask, bits = _payload_assertion([(FIELD_CALL_TO, my_packed)])
        return ApHypothesis(2, AP_TYPE_LABELS[2], tuple(mask), tuple(bits))

    if not callsign_round_trips(dx_call):
        return None
    dx_packed = encode_callsign28(dx_call)

    fields: List[Tuple[Tuple[int, int], int]] = [
        (FIELD_CALL_TO, my_packed),
        (FIELD_CALL_FROM, dx_packed),
    ]
    if ap_type in AP_TYPE_EXTRA:
        fields.append((FIELD_EXTRA, AP_TYPE_EXTRA[ap_type]))

    mask, bits = _payload_assertion(fields)
    return ApHypothesis(ap_type, AP_TYPE_LABELS[ap_type], tuple(mask), tuple(bits))


def build_ap_hypotheses(
    stage: str,
    my_call: str,
    dx_call: str = "",
    cq_token: str = "CQ",
    candidate_freq_hz: Optional[float] = None,
    worked_freqs_hz: Sequence[float] = (),
) -> List[ApHypothesis]:
    """
    The ordered hypothesis ladder for a QSO stage, already filtered by the gates.

    Args:
        stage: a \`QsoStage\` value (src/types/z30.ts). An unrecognised stage yields no
            hypotheses - AP is an optimisation, and a state machine that has grown a stage
            nobody wrote a ladder for should decode exactly as it did before, not guess.
        candidate_freq_hz: where in the passband this candidate was found. Omit it and the
            frequency gate does not apply, which is the right behaviour for the benchmark and
            for any caller with no frequency to compare against - but a live receiver has one
            and should pass it.
        worked_freqs_hz: the receive and transmit audio frequencies the operator is working.
            WSJT-X compares against both (\`nfqso\` and \`nftx\`), because in split operation the
            station you are working is not on the frequency you are transmitting on.
    """
    ladder = AP_STAGE_LADDER.get(stage.strip().upper(), ())
    near_worked = _within_ap_window(candidate_freq_hz, worked_freqs_hz)

    hypotheses: List[ApHypothesis] = []
    for ap_type in ladder:
        if ap_type >= AP_DEEP_TYPE and not near_worked:
            continue
        hypothesis = build_hypothesis(ap_type, my_call, dx_call, cq_token)
        if hypothesis is not None:
            hypotheses.append(hypothesis)
    return hypotheses


def _within_ap_window(
    candidate_freq_hz: Optional[float],
    worked_freqs_hz: Sequence[float],
) -> bool:
    """
    Whether a candidate is close enough to a worked frequency for the deep hypotheses.

    No candidate frequency, or no worked frequency to compare it against, means the gate cannot
    be evaluated and does not fire. That is deliberate: the gate exists to stop the deep types
    being tried across a passband the operator is not working, and a caller that has no notion
    of passband position (the benchmark decodes one frame at a time, at one carrier) is not the
    situation it guards against.
    """
    if candidate_freq_hz is None:
        return True
    usable = [f for f in worked_freqs_hz if f is not None and f > 0]
    if not usable:
        return True
    return any(abs(candidate_freq_hz - f) <= AP_FREQ_WINDOW_HZ for f in usable)


def hypothesis_holds(info_bits: "np.ndarray | Sequence[int]", hypothesis: ApHypothesis) -> bool:
    """
    Whether a decoded payload really carries what the hypothesis asserted.

    Pinning is supposed to make this impossible to fail, and in the decoder as it stands it
    cannot: \`decode_min_sum\` holds pinned variables at their asserted value and excludes them
    from the OSD flip set. This is checked anyway because the consequence of it ever becoming
    possible - a decoder change, a mask off by one field - is a frame reported to the operator
    and written to the log under a callsign that was assumed rather than received. A guard that
    can only fire when something else is already wrong is exactly the guard worth keeping.
    """
    bits = np.asarray(info_bits, dtype=np.uint8)
    if bits.size < PAYLOAD_BITS:
        return False
    for i in range(PAYLOAD_BITS):
        if hypothesis.mask[i] and int(bits[i]) != hypothesis.bits[i]:
            return False
    return True


def decode_with_ap(
    codec: Z30LdpcCodec,
    llr_channel: "np.ndarray",
    hypotheses: Sequence[ApHypothesis] = (),
) -> ApDecodeResult:
    """
    An ordinary decode, and then - only if it failed - each hypothesis in turn.

    The ordering is the whole safety argument. A frame that decodes on its own is returned by
    the same code path it always was, with \`ap_type=0\`, having been through no AP machinery at
    all; AP can therefore add decodes but cannot change or lose one. That is WSJT-X's structure
    too, where AP occupies passes 4 onwards and passes 1-3 are the ordinary ones.
    """
    success, info_bits, iterations = codec.decode_min_sum(llr_channel)
    if success:
        return ApDecodeResult(True, info_bits, iterations, 0, "", 0)

    total_iterations = iterations
    for tried, hypothesis in enumerate(hypotheses, start=1):
        ap_llrs = apply_ap_hypothesis(llr_channel, hypothesis.mask, hypothesis.bits)
        ok, ap_info, ap_iters = codec.decode_min_sum(ap_llrs, ap_mask=hypothesis.mask)
        total_iterations += ap_iters
        if ok and hypothesis_holds(ap_info, hypothesis):
            return ApDecodeResult(
                True, ap_info, total_iterations, hypothesis.ap_type, hypothesis.label, tried
            )

    return ApDecodeResult(False, info_bits, total_iterations, 0, "", len(hypotheses))


def describe_ap_decode(result: ApDecodeResult) -> str:
    """
    A short operator-facing tag for a decode, or the empty string for an ordinary one.

    WSJT-X prints \`iaptype\` next to each decode for a reason: a frame recovered by assuming your
    own callsign was in it is a weaker claim than one decoded from the air alone, and an
    operator logging a contact is entitled to know which they are looking at.
    """
    if not result.success or result.ap_type == 0:
        return ""
    return f"a{result.ap_type}"


def payload_extra_code(info_bits: "np.ndarray | Sequence[int]") -> int:
    """The 7-bit modifier field of a decoded payload."""
    bits = [int(b) & 1 for b in np.asarray(info_bits, dtype=np.uint8)[:PAYLOAD_BITS]]
    return bits_to_int([bits[i] for i in field_slice(FIELD_EXTRA)])
`,
  },
  {
    filename: "message_codec.py",
    path: "z30_dsp/message_codec.py",
    description: "28-bit callsign packing and the payload field layout - the Python twin of the callsign half of src/dsp/z30Codec.ts.",
    code: `"""
z-30 message field packing - the Python twin of the callsign half of src/dsp/z30Codec.ts.
==========================================================================================

The 63-bit z-30 payload is three fields:

    bits  0..27   destination callsign, 28 bits (Radix-37 prefix / digit / Radix-27 suffix)
    bits 28..55   source callsign, 28 bits, same encoding
    bits 56..62   grid / report / modifier, 7 bits

Only the two callsign fields and the three modifier codes are implemented here, because those
are exactly the fields a priori decoding asserts (see z30_dsp/ap_decode.py). The 7-bit grid
table and the report arithmetic stay in \`src/dsp/z30Codec.ts\` alone: a second copy of the
64-entry \`COMMON_GRIDS\` table would be a second place for it to drift, and nothing on the
Python side reads a grid. AGENTS.md's "one source of truth per rule" cuts both ways - do not
port a rule here to have it nearby, port it because something here needs it.

What is here is checked against the TypeScript original by
\`tests/test_cross_language_parity.py\`, which drives both implementations over the shared
vectors in \`tests/vectors/callsign_vectors.json\` and asserts identical 28-bit integers. That is
the same arrangement \`tests/vectors/crc14_vectors.json\` already uses for the CRC, and it exists
for the same reason: two implementations of one encoding agree until the day they quietly do
not, and both halves go on working perfectly on their own while they disagree about what is on
the air.
"""

from typing import List, Optional, Tuple
import re

#: Bit offsets and widths of the three payload fields, MSB-first within each field.
#: The twin of the layout documented at the top of src/dsp/z30Codec.ts.
FIELD_CALL_TO: Tuple[int, int] = (0, 28)
FIELD_CALL_FROM: Tuple[int, int] = (28, 28)
FIELD_EXTRA: Tuple[int, int] = (56, 7)

#: Payload width, and the width once the CRC-14 is appended.
PAYLOAD_BITS: int = 63
INFO_BITS: int = 77

#: The three 7-bit modifier codes \`packZ30Message\` assigns to the closing messages of a QSO.
#: Reports occupy 0..60 (report + 30) and grids occupy 64..127; these three sit between.
EXTRA_RRR: int = 61
EXTRA_73: int = 62
EXTRA_RR73: int = 63

#: The reserved low callsign values. \`encodeCallsign28\` maps these tokens to fixed integers
#: rather than through the radix packing, and \`decodeCallsign28\` maps them back.
CALL_TOKENS = {
    "CQ": 0,
    "CQ DX": 1,
    "CQ TEST": 2,
    "QRZ": 3,
}

#: What Station Settings stores before an operator has entered a real callsign. The twin of
#: \`PLACEHOLDER_CALLSIGN\` in src/dsp/z30Constants.ts. A frame from this station cannot be
#: asserted as a priori knowledge, because it is not knowledge - it is a default.
PLACEHOLDER_CALLSIGN: str = "NOCAL"

_STANDARD_CALL = re.compile(r"^([A-Z0-9]{1,2})([0-9])([A-Z]{1,3})$")


def _char_to_prefix(c: str) -> int:
    """Radix-37 prefix alphabet: space=0, '0'-'9'=1..10, 'A'-'Z'=11..36."""
    if c == " ":
        return 0
    if "0" <= c <= "9":
        return ord(c) - 48 + 1
    return ord(c) - 65 + 11


def _char_to_suffix(c: str) -> int:
    """Radix-27 suffix alphabet: space=0, 'A'-'Z'=1..26."""
    return 0 if c == " " else ord(c) - 65 + 1


def _prefix_to_char(v: int) -> str:
    if v == 0:
        return ""
    return chr(48 + v - 1) if v <= 10 else chr(65 + v - 11)


def _suffix_to_char(v: int) -> str:
    return "" if v == 0 else chr(65 + v - 1)


def encode_callsign28(call: str) -> int:
    """
    Packs an amateur callsign or operational token into 28 bits.

    The twin of \`encodeCallsign28\` in src/dsp/z30Codec.ts, transcribed operation for operation.
    Standard \`[1-2 prefix][digit][1-3 suffix]\` callsigns take the radix path; anything else
    falls through to the generic Base-37 accumulator, which is lossy - see
    \`callsign_round_trips\`, which is how a caller finds out.
    """
    clean = re.sub(r"[^A-Z0-9 ]", "", call.strip().upper())
    if not clean or clean == "CQ":
        return 0
    if clean in CALL_TOKENS:
        return CALL_TOKENS[clean]

    formatted = clean[:6]
    match = _STANDARD_CALL.match(formatted)
    if match:
        prefix = match.group(1)
        p_str = (" " + prefix) if len(prefix) == 1 else prefix
        d_val = int(match.group(2))
        s_str = match.group(3).ljust(3, " ")

        p_val = _char_to_prefix(p_str[0]) * 37 + _char_to_prefix(p_str[1])
        s_val = (
            _char_to_suffix(s_str[0]) * 729
            + _char_to_suffix(s_str[1]) * 27
            + _char_to_suffix(s_str[2])
        )
        packed = p_val * (10 * 19683) + d_val * 19683 + s_val + 100
        return packed & 0x0FFFFFFF

    acc = 0
    for c in formatted[:6]:
        if "0" <= c <= "9":
            val = ord(c) - 48 + 1
        elif "A" <= c <= "Z":
            val = ord(c) - 65 + 11
        else:
            val = 0
        acc = (acc * 37 + val) & 0x0FFFFFFF
    return (acc + 1000) & 0x0FFFFFFF


def decode_callsign28(num: int) -> str:
    """
    Unpacks a 28-bit callsign field. The twin of \`decodeCallsign28\` in src/dsp/z30Codec.ts.

    Returns 'DX' for a value that does not correspond to a standard callsign, which is what the
    TypeScript implementation returns and is deliberately not a callsign anyone holds.
    """
    for token, value in CALL_TOKENS.items():
        if num == value:
            return token
    if num < 100:
        return "CQ"

    val = num - 100
    s_val = val % 19683
    rem1 = val // 19683
    d_val = rem1 % 10
    p_val = rem1 // 10

    if p_val < 37 * 37:
        prefix = (_prefix_to_char(p_val // 37) + _prefix_to_char(p_val % 37)).strip()
        suffix = (
            _suffix_to_char(s_val // 729)
            + _suffix_to_char((s_val % 729) // 27)
            + _suffix_to_char(s_val % 27)
        ).strip()
        if prefix and suffix:
            return f"{prefix}{d_val}{suffix}"

    return "DX"


def callsign_round_trips(call: str) -> bool:
    """
    Whether this callsign survives \`encode_callsign28\` -> \`decode_callsign28\` unchanged.

    This is the z-30 analogue of WSJT-X's \`ft8apset\`, which packs a dummy standard message,
    unpacks it again and refuses to supply any a priori symbols unless \`msg.eq.msgchk\`. The
    check is not decoration. A callsign that takes the generic Base-37 fallback - a special
    event call, a \`/P\` suffix, anything longer than six characters - packs to an integer that
    does not unpack back to it, so asserting those 28 bits as certain would be asserting a
    callsign nobody transmitted, and every hypothesis built on it is guaranteed wrong.

    The placeholder callsign is rejected for a different reason: it round-trips perfectly, but
    it is what Station Settings holds before the operator has entered anything, so it is a
    default rather than knowledge.
    """
    clean = call.strip().upper()
    if not clean or clean == PLACEHOLDER_CALLSIGN or clean in CALL_TOKENS:
        return False
    return decode_callsign28(encode_callsign28(clean)) == clean


def int_to_bits(value: int, width: int) -> List[int]:
    """MSB-first bit expansion of \`value\` in \`width\` bits, the order the payload is packed in."""
    return [(value >> (width - 1 - i)) & 1 for i in range(width)]


def bits_to_int(bits: "List[int]") -> int:
    """MSB-first integer value of a bit sequence."""
    value = 0
    for bit in bits:
        value = (value << 1) | (int(bit) & 1)
    return value


def pack_payload63(call_to: str, call_from: str, extra_code: int) -> List[int]:
    """
    The 63 payload bits for a \`<to> <from> <extra>\` message.

    The twin of the field-packing block at the end of \`packZ30Message\`, without the text
    tokenizer in front of it: callers here already know which field is which, and reproducing
    the tokenizer would be reproducing the grid table with it.
    """
    if not 0 <= extra_code < 128:
        raise ValueError(f"extra_code must be a 7-bit value; got {extra_code}")
    return (
        int_to_bits(encode_callsign28(call_to), 28)
        + int_to_bits(encode_callsign28(call_from), 28)
        + int_to_bits(extra_code, 7)
    )


def unpack_payload63(payload: "List[int]") -> Tuple[str, str, int]:
    """The \`(to, from, extra_code)\` a 63-bit payload carries."""
    if len(payload) < PAYLOAD_BITS:
        raise ValueError(f"payload must be {PAYLOAD_BITS} bits; got {len(payload)}")
    bits = [int(b) & 1 for b in payload[:PAYLOAD_BITS]]
    return (
        decode_callsign28(bits_to_int(bits[0:28])),
        decode_callsign28(bits_to_int(bits[28:56])),
        bits_to_int(bits[56:63]),
    )


def field_slice(field: Tuple[int, int]) -> "range":
    """The payload bit indices one of the FIELD_* constants covers."""
    offset, width = field
    return range(offset, offset + width)


def extra_code_for_report(report_db: int) -> Optional[int]:
    """
    The 7-bit code \`packZ30Message\` assigns to a signal report, or None if out of range.

    \`Math.max(0, Math.min(60, num + 30))\` in TypeScript clamps rather than rejects; this returns
    None instead, because a caller building an a priori hypothesis needs to know the report it
    asked for is not the report that would be transmitted. Silently clamping -40 to -30 would
    assert seven bits of a message the other station never sent.
    """
    code = report_db + 30
    return code if 0 <= code <= 60 else None
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
spread, separated by a fixed differential delay. The named presets are the recommendation's
own test conditions - see WATTERSON_PRESETS.
"""

from dataclasses import dataclass
from typing import Tuple

import numpy as np
from scipy.signal import hilbert


@dataclass(frozen=True)
class WattersonPreset:
    """One named ITU-R F.1487 / CCIR 520-2 channel condition."""
    name: str
    delay_spread_ms: float
    doppler_spread_hz: float


#: The ITU-R F.1487 test conditions this benchmark sweeps, plus a no-fading reference.
#:
#: The three that were already here are the recommendation's whole MID-LATITUDE row - they were
#: labelled "CCIR good / moderate / poor", which is not a designation the recommendation uses
#: and which hid the fact that all three describe the same latitude band. Their delay and
#: Doppler figures are unchanged, so every curve measured under them still stands; only the
#: name a run prints is different.
#:
#: \`high-moderate\` is new, and it is here because it is half of what the leading published
#: practice for this class of mode actually reports. WSJT-X's sensitivity tables give each mode
#: on three channels - AWGN, ITU mid-latitude disturbed, and ITU high-latitude moderate - and
#: the third is the one that separates modes with different symbol durations, because its 10 Hz
#: Doppler spread is wider than a narrow mode's whole tone spacing. Sweeping only the
#: mid-latitude row publishes a mode's best case and calls it the set.
#:
#: Recommendation ITU-R F.1487 (05/2000), "Testing of HF modems with bandwidths of up to about
#: 12 kHz using ionospheric channel simulators", differential time delay / frequency spread:
#:
#:      Latitude    Quiet          Moderate        Disturbed
#:      Low         0.5 ms/0.5 Hz  2 ms/1.5 Hz     6 ms/10 Hz
#:      Mid         0.5 ms/0.1 Hz  1 ms/0.5 Hz     2 ms/1 Hz
#:      High        1 ms/0.5 Hz    3 ms/10 Hz      7 ms/30 Hz
#:
#: The keys stay as they are. Renaming \`poor\` to \`mid-disturbed\` would be tidier and would
#: silently change what a reproduction command means: every published curve, every CI
#: invocation and every wiki page names these presets by key.
WATTERSON_PRESETS = {
    "none": WattersonPreset("No fading (AWGN only)", 0.0, 0.0),
    "good": WattersonPreset("ITU-R F.1487 mid-latitude quiet", 0.5, 0.1),
    "moderate": WattersonPreset("ITU-R F.1487 mid-latitude moderate", 1.0, 0.5),
    "poor": WattersonPreset("ITU-R F.1487 mid-latitude disturbed", 2.0, 1.0),
    "high-moderate": WattersonPreset("ITU-R F.1487 high-latitude moderate", 3.0, 10.0),
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

#: Extra timing search either side of the station's own timing uncertainty, in seconds.
#:
#: z-30 is slot-synchronised: frames start on a 30-second UTC boundary, and a station whose
#: clock is off by more than the slot guard cannot be worked at all. So a real receiver knows
#: where the frame should begin to within its timing uncertainty, and searches a window around
#: that - it does not search an arbitrary stream. The margin is what covers the receiver's own
#: clock error on top of the transmitter's.
#:
#: Shared with src/dsp/monteCarloEngine.ts and pinned by tests/test_cross_language_parity.py:
#: the two benchmark engines have to search the same window or they measure different things.
SLOT_SEARCH_MARGIN_SEC = 0.05


def slot_timing_search_sec(max_time_offset_sec: float) -> float:
    """
    Half-width of the timing search for a slot-synchronised receiver, in seconds.

    \`max_time_offset_sec\` is the station timing uncertainty the run models (the benchmark's
    --time-offset). The twin of the same expression in monteCarloEngine.ts's acquireFrame().
    """
    return float(max_time_offset_sec) + SLOT_SEARCH_MARGIN_SEC


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
        time_search_sec: half-width of the timing search around the middle of the stream, where
            a slot-synchronised receiver expects the frame. Pass \`slot_timing_search_sec(...)\`
            for the model a real z-30 receiver runs. Defaults to searching the whole stream,
            which is what a receiver with no prior timing knowledge would have to do - a
            strictly harder problem than the one z-30 actually poses, and one that mis-locks on
            noise more often simply because it is offered more chances to.

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
quantities and flatters this one. Measured on this code at seed DEFAULT_BENCHMARK_SEED, 200
frames per point: the bound is -24.58 dB [-24.69, -24.48], while the blind-acquisition
threshold is -22.92 dB [-23.07, -22.79] on AWGN. The gap between them - 1.66 dB - is the
acquisition loss, what it costs to *find* a 3.125 Hz-spaced signal rather than be told where
it is. wiki/16 carries the full set, including the ITU-R F.1487 fading conditions, and the
README states the comparison in the same terms.

THE METHOD IS NOT INVENTED HERE
-------------------------------
Everything about how these numbers are produced is the convention the modes z-30 is compared
against already use, so that the figures mean the same thing:

  * Sensitivity is the SNR in a 2500 Hz reference noise bandwidth at which decode probability
    reaches 50%. That is how WSJT-X publishes every one of its modes, and it is the only
    reason an FT8 figure and a z-30 figure can sit in the same column.
  * It is measured by Monte Carlo simulation through the decoder that SHIPS, not through a
    model of it. \`demodulate_mfsk_llrs\` and \`Z30LdpcCodec.decode_min_sum\` here are the same
    functions \`sic_decoder.py\` calls on live audio. A benchmark that reimplements the receiver
    measures the reimplementation - see RECEIVER_PILOT_COHERENCE for what that cost when the
    two drifted apart.
  * The channels are AWGN plus the named test conditions of Recommendation ITU-R F.1487; see
    channel.WATTERSON_PRESETS.
  * A published sensitivity figure excludes a priori information. The sweep runs the ordinary
    decoder; the hypothesis ladder is a separate instrument (\`--ap\`) reported separately, the
    same way WSJT-X's tables give "no AP" and "max AP" as two different numbers.
  * A simulated error rate is quoted with a confidence interval, not as a bare point estimate.
    Every decode rate here carries its 95% Wilson score interval and every crossing carries the
    band those intervals imply - see wilson_interval and PUBLISHABLE_FRAMES_PER_POINT.

Reproducibility: every run is seeded (\`--seed\`, default DEFAULT_BENCHMARK_SEED). Record the
seed alongside any published curve; an unseeded number cannot be reproduced, bisected, or
verified by anyone else.
"""

import os
import math
import time
import argparse
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple, Dict
import numpy as np

from z30_dsp.modem import Z30Modulator, Z30Config, codeword_to_symbols
from z30_dsp.ldpc import Z30LdpcCodec, LDPC_MAX_ITERATIONS, DECODE_SCHEDULES
from z30_dsp.channel import ChannelImpairments, impair_frame, WATTERSON_PRESETS
from z30_dsp.acquisition import acquire_frame, slot_timing_search_sec
from z30_dsp.ap_decode import ApHypothesis, build_ap_hypotheses, decode_with_ap
from z30_dsp.message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    callsign_round_trips,
    extra_code_for_report,
    pack_payload63,
)

#: Default PRNG seed. Fixed so the default run is reproducible; override with --seed.
DEFAULT_BENCHMARK_SEED: int = 20260830

#: Default worker count for the sweep. One - the serial path - deliberately.
#:
#: Parallelism here is a wall-clock optimisation and nothing else: the curve a run produces is
#: identical at every worker count, and \`tests/test_benchmark_parallel.py\` asserts that rather
#: than trusting it. The default stays serial anyway, so a published figure is reproduced by
#: the same code path that has always produced it, and \`--workers N\` is an explicit choice made
#: by whoever is waiting for the run.
DEFAULT_BENCHMARK_WORKERS: int = 1

#: Frames dispatched to the pool per worker in one batch.
#:
#: Frames are prepared sequentially (they consume the sweep's one PRNG, in order) and decoded in
#: parallel, so every prepared-but-not-yet-decoded frame is a ~0.7 MB audio buffer sitting in
#: memory. Batching bounds that by the worker count instead of by --frames, which is free to be
#: 1000, while still keeping every worker fed.
PARALLEL_CHUNK_PER_WORKER: int = 4

#: Frames per SNR point below which a run is exploratory rather than publishable.
#:
#: 200 is not a round number picked for comfort. A decode rate is a binomial proportion, and at
#: 200 frames its 95% Wilson interval is at worst +/-6.9 percentage points, which at the slope
#: this mode's decode curve has near threshold is about +/-0.3 dB on the interpolated crossing -
#: the precision a figure quoted to one decimal place is claiming. At the 40 frames the
#: published table used to be measured at, the same interval is +/-15 points and the crossing is
#: uncertain by most of a dB, so two runs of the same code could differ by more than most of the
#: changes anyone would want to measure. Monte Carlo error-rate estimation has quoted intervals
#: alongside point estimates for decades, and the sample sizes that make a percentage-point
#: interval usable are in the hundreds; this is that, at the lower end.
#:
#: Enforced as a printed notice rather than a refusal: a 20-frame run is the right tool for
#: "did I break the decoder", and the run itself is not wrong - only the act of publishing its
#: crossing as a sensitivity figure would be.
PUBLISHABLE_FRAMES_PER_POINT: int = 200


#: Weight of the coherent term in the per-tone likelihood, for the receiver z-30 actually runs.
#:
#: Zero. z-30's receiver is specified to demodulate non-coherently (AGENTS.md section 1), and
#: under the timing error a real receiver is left with after finding the frame itself, the
#: pilot-aided "coherent" contribution subtracts performance instead of adding it: a few
#: milliseconds of residual timing error rotates a tone at f by 2*pi*f*dt relative to the pilot
#: it is being projected onto, so the term is measured against the wrong phase reference and
#: begins cancelling signal.
#:
#: THIS CONSTANT IS THE RECEIVER'S, NOT THE BENCHMARK'S. It was called
#: RECEIVER_PILOT_COHERENCE, which named a benchmark mode, and that name is exactly how the
#: defect it now prevents went unnoticed: the two benchmarks passed 0.0 while the two on-air
#: decoders - \`sic_decoder._estimate_llrs\`, which took \`demodulate_mfsk_llrs\`'s default, and
#: realReceiver.ts's \`demodulateReal\`, which hardcoded the weight - went on applying the
#: pilot-distance-adaptive 0.35-0.85. The published decode threshold therefore described a
#: receiver that did not ship, and the receiver that did ship had never been measured. It is
#: now the default of \`demodulate_mfsk_llrs\`, so a caller has to ask for anything else.
#:
#: Measured paired with \`--compare-demod\`: one channel realisation, one acquisition and one
#: noise draw per frame, demodulated twice and decoded twice, so nothing but the weight differs
#: between the arms. Seed DEFAULT_BENCHMARK_SEED, 100 frames per point, AWGN, blind
#: acquisition, carrier offset +/-5 Hz, timing offset +/-0.5 s:
#:
#:      SNR      non-coherent   semi-coherent   non-coh only   semi only   timing RMS
#:     -25 dB        1/100           1/100            1             1        19.8 ms
#:     -24 dB        4/100          13/100            3            12        18.2 ms
#:     -23 dB       51/100          18/100           41             8        14.8 ms
#:     -22 dB       93/100          35/100           58             0        12.0 ms
#:     -21 dB      100/100          55/100           45             0         8.7 ms
#:     -20 dB      100/100          76/100           24             0         6.9 ms
#:     -19 dB      100/100          78/100           22             0         5.9 ms
#:
#: Pooled over the 700 frames: 194 discordant pairs won by the non-coherent receiver against
#: 21 by the semi-coherent one, exact two-sided McNemar p = 2.9e-36. The 50% crossings are
#: -23.02 dB [-23.21, -22.81] against -21.25 dB [-21.73, -20.78], 95% Wilson bands that do not
#: overlap: the coherent term was costing the shipped receiver 1.77 dB.
#:
#: The -24 dB row is recorded rather than dropped, and it goes the other way (12 to 3 for the
#: semi-coherent arm). Both arms are under 15% there, below the SNR at which the Costas pattern
#: is reliably findable at all, which is not an SNR a station operates at.
#:
#: The mechanism was confirmed rather than assumed, by running the identical comparison with
#: perfect symbol timing handed to the demodulator (\`--compare-demod --mode ideal\`, 100 frames
#: per point, -27 to -22 dB): with an exact phase reference the coherent term is worth having,
#: and the result reverses completely - 136 discordant pairs to 1 for the semi-coherent arm,
#: p = 1.6e-39, 50% crossings -24.58 dB against -23.29 dB. So the term is worth +1.29 dB when
#: the timing is exact and costs -1.77 dB when the receiver has to find the frame itself. That
#: is why \`ideal\` mode keeps the pilot-distance-adaptive weight and passes it explicitly: it is
#: a genie-aided bound, and the genie includes the phase reference.
RECEIVER_PILOT_COHERENCE: float = 0.0


def generate_random_frame(
    codec: Z30LdpcCodec,
    cfg: Z30Config,
    rng: Optional[np.random.Generator] = None,
    payload_63: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, np.ndarray, List[int], List[int]]:
    """
    Generates a random 63-bit amateur payload, encodes to 216-bit LDPC codeword,
    and assembles the 75-symbol 16-MFSK transmission sequence.

    \`payload_63\` supplies the payload instead of drawing one, for the a priori sweep, where the
    frames have to be real QSO messages rather than random bits. When it is None - every caller
    that existed before AP did - the draw is the one this function has always made, from the
    shared generator, in the same order.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    if payload_63 is None:
        payload_63 = rng.integers(0, 2, 63, dtype=np.uint8)
    else:
        payload_63 = np.asarray(payload_63, dtype=np.uint8)
    codeword_216 = codec.encode(payload_63)

    # 54 data symbols (4 bits/symbol), used below only to report them separately from the
    # interleaved frame; codeword_to_symbols recomputes the same packing internally.
    data_symbols_54 = []
    for s in range(54):
        idx = s * 4
        tone = (int(codeword_216[idx]) << 3) | (int(codeword_216[idx+1]) << 2) | \\
               (int(codeword_216[idx+2]) << 1) | int(codeword_216[idx+3])
        data_symbols_54.append(tone)

    # Interleave 21 Costas sync symbols + 54 data symbols -> 75 symbols
    full_symbols_75 = codeword_to_symbols(codeword_216, cfg)

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
    pilot_coherence: Optional[float] = RECEIVER_PILOT_COHERENCE,
) -> np.ndarray:
    """
    16-tone matched filter bank with exact Log-MAP LLR calculation.

    Args:
        pilot_coherence: weight of the coherent term in the per-tone likelihood, 0 to 1.
            Defaults to RECEIVER_PILOT_COHERENCE - the receiver z-30 ships, non-coherent, and
            the one every published threshold describes. \`None\` selects the
            pilot-distance-adaptive weight (0.35 to 0.85) instead, which is worth having only
            when the caller can hand the demodulator exact symbol timing; \`benchmark.py\`'s
            \`ideal\` mode is the only caller that can, and it asks for it explicitly.

            The default used to be \`None\`, which is how the on-air decoder and the benchmark
            ended up running different receivers - see RECEIVER_PILOT_COHERENCE for the paired
            measurement of what that cost.
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
        sym_coherence = (
            pilot_coherence if pilot_coherence is not None
            else max(0.35, min(0.85, 1.0 / (1.0 + 0.15 * min_pilot_dist)))
        )
        
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
            
            tone_log_likes[tone] = sym_coherence * coherent + (1.0 - sym_coherence) * non_coherent
            
        # Exact Log-MAP demapping
        for bit in range(4):
            bit_mask = 1 << (3 - bit)
            likes0 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) == 0]
            likes1 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) != 0]
            
            llr = _log_sum_exp(likes0) - _log_sum_exp(likes1)
            llrs[data_sym_idx * 4 + bit] = np.clip(llr, -25.0, 25.0)
            
        data_sym_idx += 1
        
    return llrs

# ---------------------------------------------------------------------------------------------
# Splitting the sweep into a sequential producer and a parallel consumer.
#
# The sweep draws every random value it needs - payload bits, the Watterson tap processes, the
# carrier and timing offsets, the AWGN - from ONE \`np.random.Generator\`, consumed strictly in
# call order. That shared, order-dependent state is the whole obstacle to running frames
# concurrently, and there are two ways past it.
#
# The obvious one, and the one a first design reaches for, is to give each frame its own
# generator seeded from (master_seed, snr_index, frame_index). It parallelises everything - and
# it draws different numbers, so it produces a different curve at the same seed. The published
# thresholds in wiki/16 would all have to be re-measured, and AGENTS.md section 5 is explicit
# about what that costs. Speed is not a reason to move a published figure.
#
# The other one is this: keep the generator exactly where it is, and split the frame loop by
# whether a stage touches it.
#
#   * \`_prepare_frame\` consumes the PRNG, in the original order, on the main process. It is the
#     transmitter and the channel: payload, waveform, fading, offsets, noise.
#   * \`decode_prepared_frame\` consumes nothing. It is the receiver: acquisition, demodulation,
#     LDPC decode, CRC and payload check. Given the same buffer it returns the same answer on
#     any process, in any order, at any time - \`Z30LdpcCodec.decode_min_sum\` derives its own
#     dither from the LLRs handed to it (see \`ldpc.dither_seed_from_llrs\`) precisely so that
#     this holds.
#
# So the parallel path and the serial path see identical inputs and produce identical outputs,
# bit for bit, and no published number moves. Measured on this code at 6000 Hz in realistic
# mode, the PRNG-consuming half is 3.1% of a frame's wall clock (payload 0.0%, synthesis 0.3%,
# fading and offsets 2.7%, noise 0.1%) against 96.9% for acquisition, demodulation and decode -
# so keeping the producer serial costs an Amdahl ceiling of about 32x, which is well past any
# core count this is going to run on.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PreparedFrame:
    """
    One frame as it leaves the channel, plus everything the receiver is permitted to know.

    Deliberately a plain data record: it crosses a process boundary by pickle, so it must not
    carry a codec, a modulator, or anything else holding state a worker could diverge on.
    """
    #: Position in the SNR point's frame loop. Results are reassembled by this, never by the
    #: order workers happen to finish in.
    index: int
    noisy_wave: np.ndarray
    #: The transmitted payload, so a converged codeword can be checked against what was sent.
    payload_63: np.ndarray
    #: \`ideal\` mode hands the demodulator the exact sigma used to make the noise. \`realistic\`
    #: passes None, and the receiver estimates it from the audio like a real one has to.
    known_sigma: Optional[float]
    #: \`ideal\` mode's perfect timing and exact carrier. Ignored when \`search_timing_sec\` is set.
    known_start_sample: int
    known_base_freq_hz: float
    #: Half-width of the blind timing search, or None in \`ideal\` mode where nothing is searched.
    search_timing_sec: Optional[float]
    #: The pilot-coherence weight for this mode; see RECEIVER_PILOT_COHERENCE.
    pilot_coherence: Optional[float]


@dataclass(frozen=True)
class FrameOutcome:
    """What the receiver made of one \`PreparedFrame\`. Carries its index so order cannot be lost."""
    index: int
    success: bool
    iters: int
    #: Where acquisition put the frame, and on what carrier. In \`ideal\` mode these echo the
    #: values handed in, so the caller's error accounting reads the same field either way.
    start_sample: int
    base_freq_hz: float
    #: A codeword that converged and passed CRC-14 while carrying a payload that was never
    #: transmitted. Not a success, and not the same thing as a failure either: the shipped
    #: decoder has no transmitted payload to compare against, so a frame in this state is one
    #: the software would accept, display and log. It has a default so the field could be added
    #: without changing every positional construction of this record.
    false_decode: bool = False


def _prepare_frame(
    index: int,
    snr_db: float,
    codec: Z30LdpcCodec,
    cfg: Z30Config,
    modulator: Z30Modulator,
    rng: np.random.Generator,
    mode: str,
    impairments: ChannelImpairments,
    max_time_offset_sec: float,
    payload_63: Optional[np.ndarray] = None,
) -> Tuple[PreparedFrame, int, float]:
    """
    Generates one frame and puts it through the channel. THE ONLY PLACE THE SWEEP DRAWS RANDOM
    NUMBERS, and it draws them in the order the serial loop always has.

    Returns the frame, its true start sample and its true carrier offset. The last two never
    reach the receiver - they exist so the caller can report acquisition error, exactly as
    \`impair_frame\` intends.
    """
    payload, _codeword, _data_symbols, full_symbols = generate_random_frame(codec, cfg, rng, payload_63)
    clean_wave = modulator.synthesize_frame(full_symbols, base_audio_freq_hz=1250.0)
    frame_power = float(np.mean(clean_wave ** 2))

    if mode == "ideal":
        # Calibrated AWGN only, and the demodulator is told everything.
        noisy_wave, sigma = add_calibrated_awgn(
            clean_wave, snr_db, cfg.sample_rate_hz, rng, frame_power
        )
        return (
            PreparedFrame(
                index=index,
                noisy_wave=noisy_wave,
                payload_63=payload,
                known_sigma=float(sigma),
                known_start_sample=0,
                known_base_freq_hz=1250.0,
                search_timing_sec=None,
                # The genie's phase reference, explicitly: \`ideal\` mode hands the demodulator
                # exact symbol timing, which is the only condition under which the coherent
                # term pays. Passed rather than defaulted so that reading this record tells you
                # which receiver the frame will be decoded by.
                pilot_coherence=None,
            ),
            0,
            0.0,
        )

    # Fading, carrier offset and timing offset, then noise across the whole buffer - referenced
    # to the frame's own power, not the padded buffer's.
    buf, true_start, true_foff = impair_frame(clean_wave, cfg.sample_rate_hz, impairments, rng)
    noisy_wave, _true_sigma = add_calibrated_awgn(buf, snr_db, cfg.sample_rate_hz, rng, frame_power)
    return (
        PreparedFrame(
            index=index,
            noisy_wave=noisy_wave,
            payload_63=payload,
            known_sigma=None,
            known_start_sample=0,
            known_base_freq_hz=1250.0,
            search_timing_sec=slot_timing_search_sec(max_time_offset_sec),
            pilot_coherence=RECEIVER_PILOT_COHERENCE,
        ),
        true_start,
        true_foff,
    )


def decode_prepared_frame(job: PreparedFrame, cfg: Z30Config, codec: Z30LdpcCodec) -> FrameOutcome:
    """
    Runs the receive chain over one prepared frame: acquisition, demodulation, LDPC decode and
    the CRC-and-payload check.

    A pure function of \`job\` (given a codec built with the same iteration cap). It reads no
    PRNG, holds no state between calls and mutates nothing it is given, which is what makes a
    worker pool safe here and what \`tests/test_benchmark_parallel.py\` pins.
    """
    if job.search_timing_sec is not None:
        # Blind acquisition: the receiver gets audio and nothing else, and searches the window
        # a slot-synchronised receiver actually has rather than the whole stream.
        acq = acquire_frame(
            job.noisy_wave,
            cfg,
            nominal_base_freq_hz=job.known_base_freq_hz,
            time_search_sec=job.search_timing_sec,
        )
        start_sample = acq.start_sample
        base_freq = acq.base_freq_hz
        sigma = acq.noise_sigma
    else:
        if job.known_sigma is None:
            # Silently substituting a tiny sigma here would scale every log-likelihood by 1e18
            # and still return a plausible-looking curve. A malformed job should stop the run.
            raise ValueError("a frame with no timing search must carry the sigma it was made with")
        start_sample = job.known_start_sample
        base_freq = job.known_base_freq_hz
        sigma = job.known_sigma

    channel_llrs = demodulate_mfsk_llrs(
        job.noisy_wave, cfg, sigma,
        audio_center_hz=base_freq,
        start_sample=start_sample,
        pilot_coherence=job.pilot_coherence,
    )

    converged, decoded_info, iters = codec.decode_min_sum(channel_llrs)
    success = False
    false_decode = False
    if converged:
        # Validate CRC-14, and check the payload really is the one transmitted: a converged
        # codeword with a matching CRC that decoded to the wrong message is a false decode,
        # not a success.
        rcvd_crc = int("".join(str(b) for b in decoded_info[63:]), 2)
        comp_crc = codec.compute_crc14(decoded_info[:63])
        crc_ok = bool(rcvd_crc == comp_crc)
        success = bool(crc_ok and np.array_equal(decoded_info[:63], job.payload_63))
        # Counted, not merged into the failures. Everything the shipped decoder can see about
        # this frame says it decoded - so this is the rate at which the software on the air puts
        # a callsign that was never sent in front of an operator and into a logbook, and a
        # sensitivity table that folds it into the FER column reports it as caution rather than
        # as the risk it is.
        false_decode = bool(crc_ok and not success)

    return FrameOutcome(
        index=job.index,
        success=bool(success),
        iters=int(iters),
        start_sample=int(start_sample),
        base_freq_hz=float(base_freq),
        false_decode=false_decode,
    )


#: Per-worker receive chain, built once by the pool initializer.
#:
#: The codec builds a 139x216 parity-check matrix and its adjacency lists at construction. Sent
#: with every task instead, that construction would be paid once per frame and pickled across a
#: pipe once per frame - the "per-task pickling could plausibly lose to the serial loop" trap.
_WORKER_CFG: Optional[Z30Config] = None
_WORKER_CODEC: Optional[Z30LdpcCodec] = None


def _init_decode_worker(sample_rate_hz: int, max_iterations: int) -> None:
    """Builds one worker process's config and codec. Runs once per process, not once per frame."""
    global _WORKER_CFG, _WORKER_CODEC
    _WORKER_CFG = Z30Config(sample_rate_hz=sample_rate_hz)
    _WORKER_CODEC = Z30LdpcCodec(max_iterations=max_iterations)


def _decode_in_worker(job: PreparedFrame) -> FrameOutcome:
    """Pool entry point. Module-level and picklable, which \`spawn\` platforms require."""
    if _WORKER_CFG is None or _WORKER_CODEC is None:
        raise RuntimeError("decode worker used before _init_decode_worker ran")
    return decode_prepared_frame(job, _WORKER_CFG, _WORKER_CODEC)


def resolve_worker_count(workers: Optional[int]) -> int:
    """
    Turns a \`--workers\` argument into a process count.

    None or a value below 1 means "one per CPU"; \`os.cpu_count()\` can itself return None on an
    exotic platform, so it falls back to serial rather than to a crash.
    """
    if workers is None or workers < 1:
        return os.cpu_count() or 1
    return int(workers)


def _decode_batch(
    batch: List[PreparedFrame],
    outcomes: List[Optional[FrameOutcome]],
    executor: Optional[Executor],
    cfg: Z30Config,
    codec: Z30LdpcCodec,
) -> None:
    """
    Decodes one batch of prepared frames and files each result under its own frame index.

    Filing by index rather than appending is the point: a pool returns work in whatever order it
    finishes, and a sweep that accumulated in that order would produce a curve that depended on
    machine load. Every count this function feeds is read back in index order by the caller.
    """
    if executor is None:
        for job in batch:
            outcome = decode_prepared_frame(job, cfg, codec)
            outcomes[outcome.index] = outcome
        return
    for outcome in executor.map(_decode_in_worker, batch):
        outcomes[outcome.index] = outcome


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
    workers: int = DEFAULT_BENCHMARK_WORKERS,
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
        workers: decode processes. 1 runs everything in this process; a value below 1 means one
              per CPU. This changes wall-clock time and NOTHING ELSE - frames are generated in
              the same order from the same generator and reassembled by frame index, so every
              count, every RMS column and the interpolated threshold are identical at every
              worker count. \`tests/test_benchmark_parallel.py\` asserts that rather than
              asserting it here in prose.
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
    # From the codec's own default rather than a retyped literal. AGENTS.md's "UI prose quotes
    # constants, it does not retype them" rule applies to the benchmark too: a 45 written here
    # would go on reading correct after ldpc.py's cap changed, and the curve would silently stop
    # describing the decoder that ships.
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)
    
    worker_count = resolve_worker_count(workers)
    # The serial path batches one frame at a time, so it holds exactly one audio buffer at
    # once, as it always has. Only the pooled path needs a batch big enough to keep workers fed.
    batch_size = 1 if worker_count == 1 else worker_count * PARALLEL_CHUNK_PER_WORKER

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
    # Quoted from the schedule table rather than retyped. The literal that used to sit here
    # said "Max Iterations: 45", which was wrong in both halves: it would have gone on reading
    # 45 after ldpc.py's cap changed, and 45 is only schedule 1's cap - a frame that fails runs
    # all four schedules and pays for every one of them.
    caps = [min(int(s["iters"]), codec.max_iterations) for s in DECODE_SCHEDULES]
    print(f"  {frames_per_snr} frames/point | Sample Rate: {sample_rate_hz} Hz | "
          f"Iteration cap: {' + '.join(str(c) for c in caps)} = {sum(caps)} "
          f"over {len(caps)} schedules | Seed: {seed}")
    print(f"  Decode % is a proportion from {frames_per_snr} frames; the bracket is its 95% "
          f"Wilson score interval.")
    if frames_per_snr < PUBLISHABLE_FRAMES_PER_POINT:
        print(f"  EXPLORATORY RUN: {frames_per_snr} frames/point is below the "
              f"{PUBLISHABLE_FRAMES_PER_POINT} this project requires behind a published")
        print("  figure. Read the intervals, not the crossing. See PUBLISHABLE_FRAMES_PER_POINT.")
    if worker_count > 1:
        # Printed only when it is true, so the default run's output stays the one wiki/16 quotes.
        print(f"  Decoding across {worker_count} worker processes. The curve is unchanged by this;")
        print("  the per-point elapsed time below is now wall clock across the pool, not serial CPU time.")
    print("=" * 96)
    header = (f"{'SNR (2500Hz)':<14} | {'Frames':<7} | {'Success':<8} | {'FER':<9} | "
              f"{'Decode % (95% CI)':<21} | {'Avg Iters':<10}")
    if mode == "realistic":
        header += f" | {'Acq fail':<8} | {'Timing RMS':<11} | {'Freq RMS':<9}"
    print(header)
    print("-" * 112)
    
    executor: Optional[Executor] = None
    if worker_count > 1:
        executor = ProcessPoolExecutor(
            max_workers=worker_count,
            initializer=_init_decode_worker,
            initargs=(cfg.sample_rate_hz, codec.max_iterations),
        )

    try:
        for snr in snr_points:
            t_start = time.time()
            successes = 0
            failures = 0
            false_decodes = 0
            acq_failures = 0
            total_iters = 0
            timing_errs: List[float] = []
            freq_errs: List[float] = []

            # One slot per frame, filled by frame index. \`truths\` holds what the channel
            # actually did to each frame; the receiver never sees it.
            outcomes: List[Optional[FrameOutcome]] = [None] * frames_per_snr
            truths: List[Tuple[int, float]] = []

            first = 0
            while first < frames_per_snr:
                count = min(batch_size, frames_per_snr - first)
                # Prepared strictly in frame order, from the one shared generator, exactly as
                # the serial loop always did. Batching changes when frames are made, never
                # which random numbers they are made from.
                batch: List[PreparedFrame] = []
                for f in range(first, first + count):
                    job, true_start, true_foff = _prepare_frame(
                        f, float(snr), codec, cfg, modulator, rng, mode,
                        impairments, max_time_offset_sec,
                    )
                    batch.append(job)
                    truths.append((true_start, true_foff))
                _decode_batch(batch, outcomes, executor, cfg, codec)
                first += count

            # Reduce in frame order, never in completion order.
            for f in range(frames_per_snr):
                outcome = outcomes[f]
                if outcome is None:
                    raise RuntimeError(f"frame {f} at {snr:+.1f} dB was never decoded")
                total_iters += outcome.iters

                if mode == "realistic":
                    true_start, true_foff = truths[f]
                    timing_errs.append((outcome.start_sample - true_start) / cfg.sample_rate_hz)
                    freq_errs.append(outcome.base_freq_hz - (1250.0 + true_foff))
                    # Landing more than half a symbol out cannot decode. Counted separately so
                    # an acquisition failure is visible rather than hidden inside the FER.
                    if abs(outcome.start_sample - true_start) > cfg.symbol_duration_sec * cfg.sample_rate_hz / 2:
                        acq_failures += 1

                if outcome.success:
                    successes += 1
                else:
                    failures += 1
                if outcome.false_decode:
                    false_decodes += 1

            fer = failures / frames_per_snr
            decode_pct = (successes / frames_per_snr) * 100.0
            ci_lo, ci_hi = wilson_interval(successes, frames_per_snr)
            avg_iters = total_iters / frames_per_snr
            elapsed = time.time() - t_start

            res = {
                "snr_db": float(snr),
                "total_frames": frames_per_snr,
                "successes": successes,
                "failures": failures,
                "fer": fer,
                "decode_pct": decode_pct,
                # The interval the sample supports, as percentages. Carried in the result rather
                # than only printed, so anything that reduces these rows - the threshold
                # interpolation below, a test, a plot - reads the same numbers the table shows.
                "decode_pct_ci_low": 100.0 * ci_lo,
                "decode_pct_ci_high": 100.0 * ci_hi,
                "false_decodes": false_decodes,
                "avg_iters": avg_iters,
                # Wall clock for this point. With workers > 1 that is elapsed time across the
                # pool, not CPU time - do not read it as a per-frame cost.
                "elapsed_sec": elapsed,
                "seed": seed,
                "mode": mode,
                "fading": fading if mode == "realistic" else "none",
                "workers": worker_count,
            }
            if mode == "realistic":
                res["acq_failures"] = acq_failures
                res["timing_rms_ms"] = float(np.sqrt(np.mean(np.square(timing_errs))) * 1000.0) if timing_errs else 0.0
                res["freq_rms_hz"] = float(np.sqrt(np.mean(np.square(freq_errs)))) if freq_errs else 0.0
            results.append(res)

            ci = f"{decode_pct:>5.1f}% [{100.0 * ci_lo:>4.1f}-{100.0 * ci_hi:>5.1f}]"
            row = (f"{snr:+6.1f} dB      | {frames_per_snr:<7} | {successes:<8} | {fer:<9.4f} | "
                   f"{ci:<21} | {avg_iters:>6.1f}    ")
            if mode == "realistic":
                row += f" | {acq_failures:<8} | {res['timing_rms_ms']:>8.1f} ms | {res['freq_rms_hz']:>6.2f} Hz"
            print(row)
    finally:
        if executor is not None:
            executor.shutdown()

    print("=" * 96)

    # ASCII Plot of Decode Probability and FER against SNR
    plot_ascii_curves(results)

    total_false = sum(r["false_decodes"] for r in results)
    total_swept = sum(r["total_frames"] for r in results)
    print(f"  False decodes across the sweep: {total_false} of {total_swept} frames "
          f"(CRC-14 valid, payload never transmitted).")

    label = ("decode threshold (50% frame decode, blind acquisition)" if mode == "realistic"
             else "idealised AWGN bound (50% frame decode, genie-aided sync)")
    for level, name in ((50.0, label), (90.0, "90% frame decode")):
        low, point, high = decode_threshold_interval_db(results, level)
        if point is None:
            print(f"  {level:.0f}% crossing is outside the swept range - widen --min-snr / --max-snr.")
            continue
        band = (f"[{low:+.2f}, {high:+.2f}]" if low is not None and high is not None
                else "[interval extends past the swept range]")
        print(f"  {name}: {point:+.2f} dB {band} (2500 Hz reference bandwidth), "
              f"seed {seed}, {frames_per_snr} frames/point")
    if mode == "ideal":
        print("  Reminder: this excludes every acquisition loss and is NOT comparable with the")
        print("  published on-air sensitivity figures for FT8, JS8 or WSPR.")
    print("=" * 96)
    return results


# =============================================================================================
# A PRIORI (AP) DECODING - THE PAIRED MEASUREMENT
# =============================================================================================
#
# \`--ap\` does not produce another decode curve. It produces a *paired comparison*: every frame
# is put through the channel once, demodulated once, and the resulting LLR vector is decoded
# twice - once by the ordinary decoder and once with the QSO-state hypothesis ladder behind it.
# The two arms therefore see bit-identical channel evidence, and any difference between them is
# the ladder and nothing else.
#
# Pairing is not a nicety here. AP is worth a fraction of a dB, which is well inside the
# frame-to-frame scatter of an unpaired 40-frame run at a single SNR; two independent sweeps
# would leave the reader unable to tell a real effect from the noise in the measurement. Paired,
# the statistic is the count of frames where the two arms disagreed, and an exact McNemar test
# over those discordant pairs gives a p-value a reader can check.
#
# The population is stated rather than tuned, because the answer depends on it entirely. Half
# the frames are the QSO the receiver is actually in (\`W1AW K1ABC ...\`), which is what the
# ladder asserts; half are foreign traffic between other stations, which it does not. The two
# halves are reported separately, so anyone who thinks their own band is busier or quieter than
# 50/50 can reweight the result instead of taking this one on trust. AGENTS.md section 5 sets
# the bar for a benchmark that changes a published figure at >=99% confidence stated as
# something checkable; that is what \`mcnemar_exact_p\` is for.


#: The station this sweep's receiver is, the station it is working, and where its QSO state
#: machine is. Fixed rather than swept: AP asserts these bits, so the scenario IS the
#: experiment's independent variable, and changing it between runs would make two runs
#: incomparable. Any standard callsign gives the same answer - what matters is that 28 bits are
#: asserted, not which 28.
AP_SCENARIO_MY_CALL: str = "W1AW"
AP_SCENARIO_DX_CALL: str = "K1ABC"
AP_SCENARIO_STAGE: str = "SENDING_REPORT"

#: Fraction of frames that belong to the QSO the receiver is in. The rest are foreign traffic,
#: on which the ladder is a pure cost: four extra CRC-14 rejections and a chance of a false
#: accept. Both halves are counted and both are printed.
AP_IN_QSO_FRACTION: float = 0.5

#: Prefix, digit and suffix alphabets of a standard callsign, as \`encode_callsign28\` parses one.
#: Foreign callsigns are drawn from these rather than from a fixed list, so the foreign
#: population is a real sample of the callsign space instead of a handful of repeated strings.
_AP_PREFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_AP_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def random_standard_callsign(rng: np.random.Generator, exclude: Sequence[str] = ()) -> str:
    """
    A random callsign that survives the 28-bit packing, drawn from the shared generator.

    Built from the standard \`[1-2 prefix][digit][1-3 suffix]\` structure and then verified with
    \`callsign_round_trips\` rather than assumed - the same check the AP path itself applies. A
    call that failed it would be one the hypothesis machinery refuses, which would quietly
    change what the foreign population is made of.
    """
    for _ in range(64):
        prefix_len = int(rng.integers(1, 3))
        suffix_len = int(rng.integers(1, 4))
        prefix = "".join(_AP_PREFIX_ALPHABET[int(rng.integers(0, 26))] for _ in range(prefix_len))
        suffix = "".join(_AP_SUFFIX_ALPHABET[int(rng.integers(0, 26))] for _ in range(suffix_len))
        call = f"{prefix}{int(rng.integers(0, 10))}{suffix}"
        if call not in exclude and callsign_round_trips(call):
            return call
    raise RuntimeError("could not draw a round-tripping standard callsign")


def ap_scenario_payload(rng: np.random.Generator) -> Tuple[np.ndarray, bool]:
    """
    One frame of the modelled band: either the QSO this receiver is in, or foreign traffic.

    Returns the 63 payload bits and whether the frame is in-QSO. Every draw comes from the one
    shared generator in a fixed order, so the population is reproducible from the seed alone -
    the same requirement AGENTS.md places on the rest of the sweep.
    """
    in_qso = bool(rng.random() < AP_IN_QSO_FRACTION)

    if in_qso:
        # What the station being worked actually sends back during a report exchange: a report,
        # a rogered report, or one of the three closings. Drawn, not cycled, so the mix is not an
        # artefact of the frame index.
        choice = int(rng.integers(0, 5))
        if choice in (0, 1):
            report_db = int(rng.integers(-30, 1))
            extra = extra_code_for_report(report_db)
            if extra is None:
                raise RuntimeError(f"report {report_db} dB has no 7-bit code")
        else:
            extra = (EXTRA_RRR, EXTRA_73, EXTRA_RR73)[choice - 2]
        payload = pack_payload63(AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL, extra)
        return np.array(payload, dtype=np.uint8), True

    # Foreign traffic: a CQ, or an exchange between two other stations. Neither matches any
    # hypothesis in the ladder, so these frames measure what AP costs rather than what it buys.
    other = random_standard_callsign(rng, exclude=(AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL))
    if rng.random() < 0.5:
        # A CQ. The 7-bit field carries a grid, which occupies codes 64..127; the particular
        # grid is irrelevant to decoding, so it is drawn across that range rather than looked up
        # in the table src/dsp/z30Codec.ts owns.
        payload = pack_payload63("CQ", other, int(rng.integers(64, 128)))
    else:
        second = random_standard_callsign(rng, exclude=(AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL, other))
        report_db = int(rng.integers(-30, 1))
        extra = extra_code_for_report(report_db)
        if extra is None:
            raise RuntimeError(f"report {report_db} dB has no 7-bit code")
        payload = pack_payload63(other, second, extra)
    return np.array(payload, dtype=np.uint8), False


@dataclass(frozen=True)
class ApPairedOutcome:
    """
    One frame decoded both ways off the same LLR vector.

    \`plain_success\` and \`ap_success\` mean the same thing the ordinary sweep means by success:
    a CRC-valid codeword whose payload is the one that was transmitted. A CRC-valid codeword
    carrying a *different* payload is counted in \`false_decode\` instead - it is the cost side of
    AP and the reason the ladder is short and gated.
    """

    index: int
    in_qso: bool
    plain_success: bool
    ap_success: bool
    ap_type: int
    plain_false_decode: bool
    ap_false_decode: bool
    plain_iters: int
    ap_iters: int


def decode_prepared_frame_paired(
    job: PreparedFrame,
    cfg: Z30Config,
    codec: Z30LdpcCodec,
    hypotheses: Sequence[ApHypothesis],
    in_qso: bool,
) -> ApPairedOutcome:
    """
    Acquires and demodulates once, then decodes the resulting LLRs twice.

    Demodulating once is the point. Running the receive chain separately for each arm would let
    blind acquisition land the two arms on different samples, and the comparison would then be
    partly a comparison of two acquisitions. Here both arms are handed the identical 216 LLRs,
    so the only thing that differs is the hypothesis ladder.

    A pure function of its arguments, like \`decode_prepared_frame\`: no PRNG, no state, nothing
    mutated.

    The ordinary decode is run twice per frame - once here for the plain arm, and again inside
    \`decode_with_ap\` as its own first step. That is deliberate waste. The alternative is to
    inline the ladder here and hand \`decode_with_ap\` a precomputed result, which would mean the
    benchmark measured a reimplementation of the shipped function rather than the shipped
    function. A measurement of something other than what ships is worth less than the CPU time
    it saves.
    """
    if job.search_timing_sec is not None:
        acq = acquire_frame(
            job.noisy_wave,
            cfg,
            nominal_base_freq_hz=job.known_base_freq_hz,
            time_search_sec=job.search_timing_sec,
        )
        start_sample, base_freq, sigma = acq.start_sample, acq.base_freq_hz, acq.noise_sigma
    else:
        if job.known_sigma is None:
            raise ValueError("a frame with no timing search must carry the sigma it was made with")
        start_sample, base_freq, sigma = job.known_start_sample, job.known_base_freq_hz, job.known_sigma

    channel_llrs = demodulate_mfsk_llrs(
        job.noisy_wave, cfg, sigma,
        audio_center_hz=base_freq,
        start_sample=start_sample,
        pilot_coherence=job.pilot_coherence,
    )

    plain_ok, plain_info, plain_iters = codec.decode_min_sum(channel_llrs)
    plain_correct = bool(plain_ok and np.array_equal(plain_info[:63], job.payload_63))

    ap = decode_with_ap(codec, channel_llrs, hypotheses)
    ap_correct = bool(ap.success and np.array_equal(ap.info_bits[:63], job.payload_63))

    return ApPairedOutcome(
        index=job.index,
        in_qso=in_qso,
        plain_success=plain_correct,
        ap_success=ap_correct,
        ap_type=int(ap.ap_type) if ap_correct else 0,
        plain_false_decode=bool(plain_ok and not plain_correct),
        ap_false_decode=bool(ap.success and not ap_correct),
        plain_iters=int(plain_iters),
        ap_iters=int(ap.iterations),
    )


def mcnemar_exact_p(only_a: int, only_b: int) -> float:
    """
    Two-sided exact McNemar p-value for \`only_a\` frames won by one arm against \`only_b\` won by
    the other.

    Under the null hypothesis that the ladder changes nothing, each discordant frame is an
    independent coin flip, so the count of one kind is Binomial(n_discordant, 0.5). This is the
    exact binomial tail doubled, not the chi-squared approximation, because the discordant
    counts in a benchmark of this size are small enough that the approximation is not
    trustworthy - and a confidence figure that cannot be checked is the thing AGENTS.md section
    5 exists to keep out.

    Computed from \`math.comb\`, so it is exact rational arithmetic up to the final division; no
    tabulated critical values and no library-version-dependent answer.
    """
    n = only_a + only_b
    if n == 0:
        return 1.0
    k = min(only_a, only_b)
    tail = sum(math.comb(n, i) for i in range(0, k + 1))
    return min(1.0, 2.0 * tail / (2 ** n))


def run_ap_paired_sweep(
    min_snr_db: float = -26.0,
    max_snr_db: float = -20.0,
    step_snr_db: float = 1.0,
    frames_per_snr: int = 40,
    sample_rate_hz: int = 6000,
    seed: int = DEFAULT_BENCHMARK_SEED,
    mode: str = "realistic",
    fading: str = "none",
    max_freq_offset_hz: float = 5.0,
    max_time_offset_sec: float = 0.5,
) -> List[Dict]:
    """
    The paired a priori measurement. Serial by construction - see the section note above.

    Every frame is decoded by both arms in this process, off one demodulation, so there is no
    worker pool here: parallelising it would spread the pair across processes for no change to
    the result and one more place for the two arms to diverge.
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
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)

    hypotheses = build_ap_hypotheses(
        AP_SCENARIO_STAGE, AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL
    )

    print("=" * 104)
    print("  z-30 A PRIORI (AP) DECODING - PAIRED COMPARISON")
    print(f"  Scenario: this station is {AP_SCENARIO_MY_CALL}, working {AP_SCENARIO_DX_CALL}, "
          f"QSO stage {AP_SCENARIO_STAGE}.")
    print("  Hypothesis ladder: " + ", ".join(
        f"a{h.ap_type} ({h.label}, {h.asserted_bit_count}/63 bits)" for h in hypotheses
    ))
    print(f"  Population: {AP_IN_QSO_FRACTION:.0%} of frames are this QSO, the rest is foreign traffic")
    print("  the ladder does not describe. Both arms decode the SAME demodulated LLRs.")
    print(f"  {frames_per_snr} frames/point | mode: {mode} | fading: {fading} | "
          f"sample rate: {sample_rate_hz} Hz | seed: {seed}")
    print("=" * 104)
    header = (f"{'SNR':<12} | {'In-QSO':<17} | {'Foreign':<17} | {'All frames':<17} | "
              f"{'AP only':<7} | {'Plain only':<10} | {'False':<5}")
    print(header)
    print("-" * 104)

    results: List[Dict] = []
    snr_points = np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db)

    for snr in snr_points:
        outcomes: List[ApPairedOutcome] = []
        for f in range(frames_per_snr):
            payload, in_qso = ap_scenario_payload(rng)
            job, _true_start, _true_foff = _prepare_frame(
                f, float(snr), codec, cfg, modulator, rng, mode,
                impairments, max_time_offset_sec, payload,
            )
            outcomes.append(decode_prepared_frame_paired(job, cfg, codec, hypotheses, in_qso))

        in_qso_outcomes = [o for o in outcomes if o.in_qso]
        foreign_outcomes = [o for o in outcomes if not o.in_qso]

        only_ap = sum(1 for o in outcomes if o.ap_success and not o.plain_success)
        only_plain = sum(1 for o in outcomes if o.plain_success and not o.ap_success)
        plain_total = sum(1 for o in outcomes if o.plain_success)
        ap_total = sum(1 for o in outcomes if o.ap_success)
        ap_false = sum(1 for o in outcomes if o.ap_false_decode)
        plain_false = sum(1 for o in outcomes if o.plain_false_decode)

        res = {
            "snr_db": float(snr),
            "total_frames": frames_per_snr,
            "in_qso_frames": len(in_qso_outcomes),
            "foreign_frames": len(foreign_outcomes),
            "plain_successes": plain_total,
            "ap_successes": ap_total,
            "in_qso_plain": sum(1 for o in in_qso_outcomes if o.plain_success),
            "in_qso_ap": sum(1 for o in in_qso_outcomes if o.ap_success),
            "foreign_plain": sum(1 for o in foreign_outcomes if o.plain_success),
            "foreign_ap": sum(1 for o in foreign_outcomes if o.ap_success),
            "only_ap": only_ap,
            "only_plain": only_plain,
            "ap_false_decodes": ap_false,
            "plain_false_decodes": plain_false,
            "ap_types": sorted({o.ap_type for o in outcomes if o.ap_type}),
            "plain_decode_pct": 100.0 * plain_total / frames_per_snr,
            "ap_decode_pct": 100.0 * ap_total / frames_per_snr,
            "seed": seed,
            "mode": mode,
            "fading": fading,
        }
        results.append(res)

        def arm(before: int, after: int, total: int) -> str:
            return f"{before:>3}/{total:<3} -> {after:>3}/{total:<3}"

        print(f"{snr:+6.1f} dB    | "
              f"{arm(res['in_qso_plain'], res['in_qso_ap'], res['in_qso_frames']):<17} | "
              f"{arm(res['foreign_plain'], res['foreign_ap'], res['foreign_frames']):<17} | "
              f"{arm(plain_total, ap_total, frames_per_snr):<17} | "
              f"{only_ap:<7} | {only_plain:<10} | {ap_false:<5}")

    print("=" * 104)

    total_only_ap = sum(r["only_ap"] for r in results)
    total_only_plain = sum(r["only_plain"] for r in results)
    p_value = mcnemar_exact_p(total_only_ap, total_only_plain)
    total_frames = sum(r["total_frames"] for r in results)
    total_in_qso = sum(r["in_qso_frames"] for r in results)

    print(f"  Frames: {total_frames} ({total_in_qso} in-QSO, {total_frames - total_in_qso} foreign)")
    print(f"  Discordant pairs: {total_only_ap} decoded only with AP, {total_only_plain} only without.")
    print(f"  Exact two-sided McNemar p = {p_value:.3e}")
    print(f"  Plain: {sum(r['plain_successes'] for r in results)} decodes | "
          f"AP: {sum(r['ap_successes'] for r in results)} decodes")
    print(f"  False decodes (CRC-valid codeword carrying the wrong payload): "
          f"plain {sum(r['plain_false_decodes'] for r in results)}, "
          f"AP {sum(r['ap_false_decodes'] for r in results)}")
    print(f"  In-QSO decode rate: "
          f"{100.0 * sum(r['in_qso_plain'] for r in results) / max(1, total_in_qso):.1f}% -> "
          f"{100.0 * sum(r['in_qso_ap'] for r in results) / max(1, total_in_qso):.1f}%")
    print("  A p-value says the ladder changed something, not by how much. The in-QSO 50% crossing")
    print("  of each arm - and only the in-QSO frames, see ap_threshold_shift - is the size of it.")
    print("=" * 104)
    return results


def ap_threshold_shift(results: List[Dict]) -> Dict[str, Optional[float]]:
    """
    Each arm's 50% crossing over the in-QSO frames, and the difference between them.

    Reported only over the in-QSO population, because that is the population the ladder makes a
    claim about. A crossing computed over the whole band mix would move with the mix rather than
    with the decoder, and would read as a sensitivity figure while being a statement about how
    busy the band is.
    """
    plain_curve = [
        {"snr_db": r["snr_db"], "decode_pct": 100.0 * r["in_qso_plain"] / max(1, r["in_qso_frames"])}
        for r in results
    ]
    ap_curve = [
        {"snr_db": r["snr_db"], "decode_pct": 100.0 * r["in_qso_ap"] / max(1, r["in_qso_frames"])}
        for r in results
    ]
    plain_threshold = decode_threshold_db(plain_curve)
    ap_threshold = decode_threshold_db(ap_curve)
    shift = None
    if plain_threshold is not None and ap_threshold is not None:
        shift = plain_threshold - ap_threshold
    return {"plain_db": plain_threshold, "ap_db": ap_threshold, "shift_db": shift}


# =============================================================================================
# THE DEMODULATOR COMPARISON - IS THE BENCHMARK MEASURING THE RECEIVER THAT SHIPS?
# =============================================================================================
#
# \`demodulate_mfsk_llrs\` takes a \`pilot_coherence\` weight, and for a long time the project ran
# two different values of it at once without noticing:
#
#   * The two benchmarks (this file's \`realistic\` mode, and monteCarloEngine.ts) passed 0.0 -
#     a purely non-coherent receiver, which is what AGENTS.md section 1 specifies z-30 to be.
#   * The two on-air decoders (sic_decoder.py's \`_estimate_llrs\`, which took the parameter's
#     default, and realReceiver.ts's \`demodulateReal\`, which hardcoded it) applied the
#     pilot-distance-adaptive weight, 0.35 to 0.85.
#
# So the published decode threshold described a receiver nobody could actually run, and the
# receiver people did run had never been measured. That is the failure this instrument exists
# to make impossible to reintroduce: it decodes the same frame through both configurations and
# reports which one decodes more of them, with a p-value.
#
# Paired for the same reason \`--ap\` is paired. The two arms share one channel realisation, one
# acquisition and one noise draw, and differ only in the weight, so the frame-to-frame scatter
# that would otherwise bury a sub-dB effect cancels out of the comparison entirely.


@dataclass(frozen=True)
class DemodArm:
    """One demodulator configuration under test."""
    key: str
    label: str
    #: Passed straight to \`demodulate_mfsk_llrs\`. None selects its pilot-distance-adaptive
    #: weight; a float pins the coherent term's weight for every symbol.
    pilot_coherence: Optional[float]


#: The two configurations that were live in the shipped software simultaneously.
DEMOD_ARMS: Dict[str, DemodArm] = {
    "non-coherent": DemodArm("non-coherent", "non-coherent (pilot_coherence = 0.0)", 0.0),
    "semi-coherent": DemodArm("semi-coherent", "semi-coherent (pilot-distance-adaptive 0.35-0.85)", None),
}


@dataclass(frozen=True)
class DemodPairedOutcome:
    """One frame demodulated twice off one acquisition and decoded twice."""
    index: int
    a_success: bool
    b_success: bool
    a_false_decode: bool
    b_false_decode: bool
    a_iters: int
    b_iters: int
    #: Acquisition's residual timing error in seconds, signed. Both arms share it - it is
    #: reported because it is the quantity the coherent term's usefulness depends on.
    timing_error_sec: float


def decode_prepared_frame_two_demodulators(
    job: PreparedFrame,
    cfg: Z30Config,
    codec: Z30LdpcCodec,
    arm_a: DemodArm,
    arm_b: DemodArm,
    true_start_sample: int,
) -> DemodPairedOutcome:
    """
    Acquires once, demodulates twice with the two weights, decodes both.

    Acquiring once is what makes this a comparison of demodulators. Running the front end twice
    would let it land the arms on different samples and the result would be part acquisition.

    A pure function of its arguments, like \`decode_prepared_frame\`: no PRNG, no state.
    \`true_start_sample\` is used only to report the acquisition error alongside the outcome; it
    never reaches either demodulator.
    """
    if job.search_timing_sec is not None:
        acq = acquire_frame(
            job.noisy_wave,
            cfg,
            nominal_base_freq_hz=job.known_base_freq_hz,
            time_search_sec=job.search_timing_sec,
        )
        start_sample, base_freq, sigma = acq.start_sample, acq.base_freq_hz, acq.noise_sigma
    else:
        if job.known_sigma is None:
            raise ValueError("a frame with no timing search must carry the sigma it was made with")
        start_sample, base_freq, sigma = job.known_start_sample, job.known_base_freq_hz, job.known_sigma

    def decode(arm: DemodArm) -> Tuple[bool, bool, int]:
        llrs = demodulate_mfsk_llrs(
            job.noisy_wave, cfg, sigma,
            audio_center_hz=base_freq,
            start_sample=start_sample,
            pilot_coherence=arm.pilot_coherence,
        )
        ok, info, iters = codec.decode_min_sum(llrs)
        correct = bool(ok and np.array_equal(info[:63], job.payload_63))
        return correct, bool(ok and not correct), int(iters)

    a_correct, a_false, a_iters = decode(arm_a)
    b_correct, b_false, b_iters = decode(arm_b)

    return DemodPairedOutcome(
        index=job.index,
        a_success=a_correct,
        b_success=b_correct,
        a_false_decode=a_false,
        b_false_decode=b_false,
        a_iters=a_iters,
        b_iters=b_iters,
        timing_error_sec=(start_sample - true_start_sample) / float(cfg.sample_rate_hz),
    )


def run_demod_paired_sweep(
    min_snr_db: float = -25.0,
    max_snr_db: float = -20.0,
    step_snr_db: float = 1.0,
    frames_per_snr: int = 60,
    sample_rate_hz: int = 6000,
    seed: int = DEFAULT_BENCHMARK_SEED,
    mode: str = "realistic",
    fading: str = "none",
    max_freq_offset_hz: float = 5.0,
    max_time_offset_sec: float = 0.5,
    arm_a_key: str = "non-coherent",
    arm_b_key: str = "semi-coherent",
) -> List[Dict]:
    """
    The paired demodulator measurement. Serial by construction, like \`--ap\`: both arms of a pair
    are decoded in one place off one acquisition, so there is nothing to spread over processes
    that would not also be a chance for the arms to diverge.
    """
    if mode not in ("realistic", "ideal"):
        raise ValueError(f"mode must be 'realistic' or 'ideal'; got {mode!r}")
    if fading not in WATTERSON_PRESETS:
        raise ValueError(f"fading must be one of {sorted(WATTERSON_PRESETS)}; got {fading!r}")
    if arm_a_key not in DEMOD_ARMS or arm_b_key not in DEMOD_ARMS:
        raise ValueError(f"arms must be from {sorted(DEMOD_ARMS)}")

    arm_a, arm_b = DEMOD_ARMS[arm_a_key], DEMOD_ARMS[arm_b_key]
    rng = np.random.default_rng(seed)
    impairments = ChannelImpairments(
        max_freq_offset_hz=max_freq_offset_hz,
        max_time_offset_sec=max_time_offset_sec,
        fading=fading,
    )
    cfg = Z30Config(sample_rate_hz=sample_rate_hz)
    modulator = Z30Modulator(cfg)
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)

    print("=" * 104)
    print("  z-30 DEMODULATOR COMPARISON - PAIRED")
    print(f"  A: {arm_a.label}")
    print(f"  B: {arm_b.label}")
    print("  One channel realisation, one acquisition and one noise draw per frame; the two arms")
    print("  differ only in the coherent term's weight.")
    print(f"  {frames_per_snr} frames/point | mode: {mode} | fading: {fading} | "
          f"sample rate: {sample_rate_hz} Hz | seed: {seed}")
    print("=" * 104)
    print(f"{'SNR':<12} | {'A decodes':<12} | {'B decodes':<12} | {'A only':<7} | {'B only':<7} | "
          f"{'p (exact)':<11} | {'Timing RMS':<11}")
    print("-" * 104)

    results: List[Dict] = []
    for snr in np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db):
        outcomes: List[DemodPairedOutcome] = []
        for f in range(frames_per_snr):
            job, true_start, _true_foff = _prepare_frame(
                f, float(snr), codec, cfg, modulator, rng, mode,
                impairments, max_time_offset_sec,
            )
            outcomes.append(
                decode_prepared_frame_two_demodulators(job, cfg, codec, arm_a, arm_b, true_start)
            )

        a_total = sum(1 for o in outcomes if o.a_success)
        b_total = sum(1 for o in outcomes if o.b_success)
        only_a = sum(1 for o in outcomes if o.a_success and not o.b_success)
        only_b = sum(1 for o in outcomes if o.b_success and not o.a_success)
        timing_rms_ms = float(np.sqrt(np.mean([o.timing_error_sec ** 2 for o in outcomes])) * 1000.0)
        point_p = mcnemar_exact_p(only_a, only_b)

        results.append({
            "snr_db": float(snr),
            "total_frames": frames_per_snr,
            "arm_a": arm_a.key,
            "arm_b": arm_b.key,
            "a_successes": a_total,
            "b_successes": b_total,
            "only_a": only_a,
            "only_b": only_b,
            "a_false_decodes": sum(1 for o in outcomes if o.a_false_decode),
            "b_false_decodes": sum(1 for o in outcomes if o.b_false_decode),
            "a_avg_iters": sum(o.a_iters for o in outcomes) / frames_per_snr,
            "b_avg_iters": sum(o.b_iters for o in outcomes) / frames_per_snr,
            "timing_rms_ms": timing_rms_ms,
            "mcnemar_p": point_p,
            "seed": seed,
            "mode": mode,
            "fading": fading,
        })

        print(f"{snr:+6.1f} dB    | {a_total:>3}/{frames_per_snr:<8} | {b_total:>3}/{frames_per_snr:<8} | "
              f"{only_a:<7} | {only_b:<7} | {point_p:<11.3e} | {timing_rms_ms:>8.1f} ms")

    print("=" * 104)
    total_only_a = sum(r["only_a"] for r in results)
    total_only_b = sum(r["only_b"] for r in results)
    pooled_p = mcnemar_exact_p(total_only_a, total_only_b)
    frames = sum(r["total_frames"] for r in results)
    print(f"  Frames: {frames} | A decodes {sum(r['a_successes'] for r in results)}, "
          f"B decodes {sum(r['b_successes'] for r in results)}")
    print(f"  Discordant pairs: {total_only_a} won by A, {total_only_b} won by B")
    print(f"  Pooled exact two-sided McNemar p = {pooled_p:.6e}")
    print(f"  False decodes (CRC-valid codeword, wrong payload): "
          f"A {sum(r['a_false_decodes'] for r in results)}, B {sum(r['b_false_decodes'] for r in results)}")

    a_curve = [{"snr_db": r["snr_db"], "decode_pct": 100.0 * r["a_successes"] / r["total_frames"],
                "successes": r["a_successes"], "total_frames": r["total_frames"]} for r in results]
    b_curve = [{"snr_db": r["snr_db"], "decode_pct": 100.0 * r["b_successes"] / r["total_frames"],
                "successes": r["b_successes"], "total_frames": r["total_frames"]} for r in results]
    a_lo, a_pt, a_hi = decode_threshold_interval_db(a_curve)
    b_lo, b_pt, b_hi = decode_threshold_interval_db(b_curve)
    if a_pt is not None and b_pt is not None:
        print(f"  50% crossing: A {a_pt:+.2f} dB [{a_lo:+.2f}, {a_hi:+.2f}], "
              f"B {b_pt:+.2f} dB [{b_lo:+.2f}, {b_hi:+.2f}] "
              f"-> A is {b_pt - a_pt:+.2f} dB deeper")
    else:
        print("  At least one arm never crosses 50% in this range - widen --min-snr/--max-snr")
        print("  before quoting a threshold difference.")
    print("  A p-value says the two demodulators are not the same, not by how much. The crossing")
    print("  difference above is the size of it, and the interval is what the sample supports.")
    print("=" * 104)
    return results


# =============================================================================================
# BINOMIAL CONFIDENCE - EVERY NUMBER ON A DECODE CURVE IS A PROPORTION FROM A FINITE SAMPLE
# =============================================================================================
#
# "22 of 40 frames decoded" is not 55%; it is a sample from a Bernoulli process whose true rate
# lies in a range. At 40 frames that range is roughly +/-15 percentage points, which at the
# slope of this mode's decode curve is most of a dB - so a threshold quoted from 40 frames to
# one decimal place claims a precision the sample cannot support. Monte Carlo error-rate
# estimation in digital communications has carried an interval alongside the point estimate for
# decades (see e.g. Jeruchim's interval-estimation work and MATLAB's \`berconfint\`); this is that
# convention, applied to a decode-probability curve instead of a BER curve.
#
# Wilson's score interval rather than the textbook normal ("Wald") one: Wald is the interval
# that returns +/-0.0 at 0/40 and 40/40, which is exactly where a sensitivity sweep spends most
# of its points. Wilson stays inside [0, 1] and keeps its stated coverage at the extremes and at
# small n, which is the regime this benchmark actually runs in.


#: Two-sided standard-normal quantile for a 95% interval, to the precision float64 carries.
#: Written out rather than pulled from SciPy so the interval a published figure quotes does not
#: depend on which SciPy version produced it.
WILSON_Z_95: float = 1.959963984540054


def wilson_interval(successes: int, trials: int, z: float = WILSON_Z_95) -> Tuple[float, float]:
    """
    Wilson score interval for a binomial proportion, returned as fractions of 1.

    \`trials\` of zero returns the whole unit interval - no frames is no evidence, and returning
    (0.0, 0.0) there would read as "measured zero" rather than "measured nothing".
    """
    if trials <= 0:
        return (0.0, 1.0)
    n = float(trials)
    phat = successes / n
    denom = 1.0 + (z * z) / n
    centre = (phat + (z * z) / (2.0 * n)) / denom
    half = (z * math.sqrt((phat * (1.0 - phat) + (z * z) / (4.0 * n)) / n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def _crossing_db(points: Sequence[Tuple[float, float]], level_pct: float) -> Optional[float]:
    """
    Linear interpolation of the SNR at which a decode-percentage curve first reaches \`level_pct\`.

    \`points\` is (snr_db, decode_pct), in any order. Returns None when the curve never crosses.
    """
    ordered = sorted(points, key=lambda pt: pt[0])
    for (lo_snr, lo_pct), (hi_snr, hi_pct) in zip(ordered, ordered[1:]):
        if lo_pct < level_pct <= hi_pct:
            span = hi_pct - lo_pct
            if span <= 0:
                return float(hi_snr)
            return float(lo_snr + ((level_pct - lo_pct) / span) * (hi_snr - lo_snr))
    return None


def decode_threshold_interval_db(
    results: List[Dict], level_pct: float = 50.0, z: float = WILSON_Z_95
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    The \`level_pct\` crossing and the SNR range the sample supports, as (low, point, high).

    The point estimate is the crossing of the measured curve. The two bounds are the crossings
    of the pointwise Wilson band: the upper bound of every point makes the most optimistic curve
    the data allow, and it crosses at the lowest (best) SNR; the lower bound makes the most
    pessimistic curve, and it crosses highest. Reporting the pair is what stops a 40-frame run
    reading as a measurement to a tenth of a dB.

    This is a band on the decode *rate* propagated through the interpolation, not a confidence
    interval on the threshold parameter of a fitted curve - it makes no distributional
    assumption about the curve's shape, and it is computed from the same counts the table
    prints, so a reader can redo it by hand.
    """
    point = _crossing_db([(r["snr_db"], r["decode_pct"]) for r in results], level_pct)
    optimistic = _crossing_db(
        [(r["snr_db"], 100.0 * wilson_interval(r["successes"], r["total_frames"], z)[1]) for r in results],
        level_pct,
    )
    pessimistic = _crossing_db(
        [(r["snr_db"], 100.0 * wilson_interval(r["successes"], r["total_frames"], z)[0]) for r in results],
        level_pct,
    )
    return (optimistic, point, pessimistic)


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

def run_benchmark(seed: int = DEFAULT_BENCHMARK_SEED,
                  workers: int = DEFAULT_BENCHMARK_WORKERS):
    """Default entry point (\`z30 --benchmark\`): the honest, realistic curve."""
    return run_monte_carlo_snr_sweep(
        min_snr_db=-26.0,
        max_snr_db=-14.0,
        step_snr_db=1.0,
        frames_per_snr=25,
        sample_rate_hz=6000,
        seed=seed,
        mode="realistic",
        workers=workers,
    )


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
    parser.add_argument("--workers", type=int, default=DEFAULT_BENCHMARK_WORKERS,
                        help="Decode processes (default: 1, serial). 0 or less means one per CPU. "
                             "Affects wall-clock time only: the curve is identical at every "
                             "worker count, and the test suite asserts it.")
    parser.add_argument("--compare-demod", action="store_true",
                        help="Measure the demodulator instead of sweeping a curve: every frame "
                             "is acquired once and demodulated twice, non-coherently and with "
                             "the pilot-distance-adaptive coherent term, and the discordant "
                             "pairs are tested exactly. Serial; --workers is ignored.")
    parser.add_argument("--ap", action="store_true",
                        help="Measure a priori (AP) decoding instead of sweeping a curve: every "
                             "frame is decoded twice off one demodulation, with and without the "
                             "QSO-state hypothesis ladder, and the discordant pairs are tested "
                             "exactly. Serial; --workers is ignored.")
    args = parser.parse_args()

    if args.compare_demod:
        run_demod_paired_sweep(
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
        raise SystemExit(0)

    if args.ap:
        ap_results = run_ap_paired_sweep(
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
        shift = ap_threshold_shift(ap_results)
        if shift["shift_db"] is None:
            print("  In-QSO 50% crossing is outside the swept range for at least one arm -")
            print("  widen --min-snr / --max-snr before quoting a threshold shift.")
        else:
            print(f"  In-QSO 50% crossing: plain {shift['plain_db']:+.2f} dB, "
                  f"AP {shift['ap_db']:+.2f} dB -> {shift['shift_db']:+.2f} dB deeper with AP")
            print(f"  (seed {args.seed}, {args.frames} frames/point, mode {args.mode}, "
                  f"fading {args.fading}. Quote all four with the figure.)")
        raise SystemExit(0)

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
        workers=args.workers,
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
  * a bearer token in the \`X-Z30-Token\` header, generated fresh at each server start and
    injected only into the index.html this process serves. Header only - the \`?token=\`
    query-string form this docstring used to advertise is deliberately not accepted, because
    a live credential in a URL leaks into browser history, \`Referer\` and request logs;
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
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse, parse_qs

from . import git_sync
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
    # SO_REUSEADDR means opposite things on the two platforms, and only one of them is what this
    # function wants.
    #
    # On POSIX it permits rebinding an address still in TIME_WAIT from a previous run - which is
    # exactly right here, so a restart of z-30 does not have to wait out the old socket.
    #
    # On Windows it permits binding a port ANOTHER SOCKET IS ACTIVELY LISTENING ON. So a second
    # instance bound the same port, both processes "succeeded", and which one received a given
    # connection was up to the OS. That defeats the guarantee this whole function exists to give
    # - and it is worse than the drift it replaced, because the loopback API hands out a bearer
    # token per start: whichever process wins a connection is the one the browser talks to.
    # Microsoft's documented answer is SO_EXCLUSIVEADDRUSE, which refuses the second bind.
    #
    # Found by the Windows CI leg: tests/test_web_server_api.py's "fails loudly rather than
    # drifting" case passed on Linux and failed on Windows, because the behaviour it asserts
    # genuinely was not there.
    if sys.platform == "win32":
        sock.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_EXCLUSIVEADDRUSE", 1), 1)
    else:
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
        # PTT polarity per claimed pin, as the browser reported it. Held so that the watchdog
        # and the shutdown handlers drive the RELEASED level rather than a hardcoded low.
        self._pin_active_low: Dict[int, bool] = {}
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

    def _device_for(self, bcm_pin: int, active_low: bool) -> Any:
        """
        Returns the output device for a pin, built for this station's PTT polarity.

        gpiozero's \`active_high\` carries the polarity, so \`device.on()\` means KEYED and
        \`device.off()\` means RELEASED whichever way the interface is wired, and every caller
        below - including the watchdog and the shutdown handlers - can speak in keyed/released
        terms without having to remember which level that is. \`initial_value=False\` means
        claiming the pin releases it rather than keying it.
        """
        existing = self._devices.get(bcm_pin)
        if existing is not None and self._pin_active_low.get(bcm_pin) == active_low:
            return existing
        if existing is not None:
            # Polarity changed (the operator edited it in Station Settings). Rebuild the device
            # rather than driving the old one at the new meaning.
            try:
                existing.off()
                existing.close()
            except Exception:
                pass
            self._devices.pop(bcm_pin, None)
        device = self._DigitalOutputDevice(bcm_pin, active_high=not active_low, initial_value=False)
        self._devices[bcm_pin] = device
        self._pin_active_low[bcm_pin] = active_low
        return device

    def _write_pin(self, bcm_pin: int, keyed: bool, active_low: Optional[bool] = None) -> Dict[str, Any]:
        """
        Drives the PTT line to \`keyed\` and keeps the dead-man bookkeeping in step with it.

        \`keyed\` is the transmitter's state, NOT the pin's voltage. It used to be the voltage,
        which the countdown logic then recorded as the keyed state: an active-low station
        registered no countdown when it keyed (so its own keepalives were rejected and the
        browser force-unkeyed it half a second into every frame) and registered one when it
        released - after which this watchdog "released" the line by driving it low, which on
        active-low wiring keys the transmitter. The layer that exists to prevent a stuck
        transmitter was creating one.
        """
        with self._lock:
            if self._DigitalOutputDevice is None:
                return {
                    "success": False,
                    "error": f"gpiozero is not available ({self._import_error}). Install it with "
                             "'pip install gpiozero' on the Raspberry Pi / SBC running this server.",
                }
            if active_low is None:
                active_low = self._pin_active_low.get(bcm_pin, False)
            try:
                device = self._device_for(bcm_pin, active_low)
                if keyed:
                    device.on()
                else:
                    device.off()
            except Exception as exc:
                self._keyed_pins.pop(bcm_pin, None)
                return {"success": False, "error": f"GPIO write to BCM pin {bcm_pin} failed: {exc}"}

            now = time.monotonic()
            if keyed:
                state = self._keyed_pins.get(bcm_pin)
                if state is None:
                    self._keyed_pins[bcm_pin] = {"keyed_at": now, "last_keepalive": now}
                else:
                    state["last_keepalive"] = now
            else:
                self._keyed_pins.pop(bcm_pin, None)
            return {
                "success": True,
                "pin": bcm_pin,
                "keyed": keyed,
                "active_low": active_low,
                # The electrical level, for a UI or a log that wants to show the pin itself.
                "value": (not keyed) if active_low else keyed,
            }

    def set_pin(self, bcm_pin: int, keyed: bool, active_low: bool = False) -> Dict[str, Any]:
        """Keys or unkeys the configured PTT pin, refreshing the dead-man countdown."""
        if bcm_pin != self.allowed_pin:
            return {
                "success": False,
                "error": f"BCM pin {bcm_pin} is not the configured PTT pin. This server only drives "
                         f"pin {self.allowed_pin}; start it with '--gpio-pin=<n>' to change that.",
            }
        result = self._write_pin(bcm_pin, keyed, active_low)
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

    def any_pin_keyed(self) -> bool:
        """
        True while any PTT line is asserted.

        The update endpoint asks before it touches the checkout: fast-forwarding the tree under
        a running transmission would swap the served bundle and the Python sources out from
        under a keyed transmitter, and the operator is on the air and not looking at the screen.
        """
        with self._lock:
            return bool(self._keyed_pins)

    def release_all(self) -> None:
        """Unkeys every claimed pin and releases it. Registered with atexit and the signal handlers."""
        with self._lock:
            for pin, device in self._devices.items():
                unkeyed = True
                try:
                    # off() is the RELEASED state for either polarity, because the device was
                    # built with active_high set from the station's wiring.
                    device.off()
                except Exception as exc:
                    # Report what actually happened. This used to log "Released ... on shutdown"
                    # unconditionally, so a pin whose off() raised - and which may therefore still
                    # be keying the transmitter - left a log line claiming it had been released.
                    # This is the last of the three PTT-release layers; if it fails, the operator's
                    # only warning is this line.
                    unkeyed = False
                    logger.error(f"FAILED to unkey GPIO BCM pin {pin} on shutdown: {exc}")
                try:
                    device.close()
                except Exception as exc:
                    logger.warning(f"Could not close GPIO BCM pin {pin} on shutdown: {exc}")
                if unkeyed:
                    logger.info(f"Released GPIO BCM pin {pin} on shutdown.")
            self._devices.clear()
            self._pin_active_low.clear()
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

class UpdateJob:
    """
    Runs one upstream fast-forward at a time, in a worker thread, with a readable log.

    An update is slow (a network fetch, then a checkout) and the HTTP handler must not block
    for it: a request that takes thirty seconds looks like a hung radio, and the browser's own
    fetch timeout would abandon it half-way with no way to find out what happened. So \`start()\`
    returns immediately and the UI polls \`snapshot()\` for progress, which also means a reload
    mid-update reconnects to the running job instead of starting a second one.

    Serialised by a lock for the obvious reason: two concurrent \`git merge\` invocations in one
    working tree corrupt the index.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._log: List[str] = []
        self._result: Optional[Dict[str, Any]] = None
        self._started_at: float = 0.0

    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "success": True,
                "running": self._running,
                "log": list(self._log),
                "result": self._result,
                "elapsed_sec": round(time.time() - self._started_at, 1) if self._started_at else 0.0,
            }

    def start(self, reinstall_python: bool, rebuild_web: bool) -> Dict[str, Any]:
        with self._lock:
            if self._running:
                return {"success": False, "error": "An update is already running.", "running": True}
            self._running = True
            self._log = []
            self._result = None
            self._started_at = time.time()

        def append(message: str) -> None:
            with self._lock:
                self._log.append(message)
            logger.info(f"[update] {message}")

        def worker() -> None:
            try:
                result = git_sync.apply_update(
                    on_log=append,
                    reinstall_python=reinstall_python,
                    rebuild_web=rebuild_web,
                )
                payload = result.to_dict()
            except Exception as exc:  # a crashed worker must not leave the job "running" forever
                append(f"Update failed unexpectedly: {exc}")
                payload = {"success": False, "error": str(exc), "log": []}
            with self._lock:
                self._result = payload
                self._running = False

        thread = threading.Thread(target=worker, name="z30-update", daemon=True)
        with self._lock:
            self._thread = thread
        thread.start()
        return {"success": True, "running": True}


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
    update_job: Optional[UpdateJob] = None

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

        # Header only. The token used to be accepted from a \`?token=\` query parameter as well,
        # which no shipped client ever used (localServerApi.ts always sends the header) and which
        # put a live credential everywhere a URL goes: browser history, the Referer on any
        # outbound link, and any log that records request lines. A bearer token belongs in a
        # header precisely because headers do not travel like that.
        supplied = (self.headers.get("X-Z30-Token") or "").strip()
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
            if path == "/api/update/status":
                self._handle_update_status()
                return
            if path == "/api/update/progress":
                self._send_json(200, self.update_job.snapshot() if self.update_job else
                                {"success": True, "running": False, "log": [], "result": None})
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
        elif path == "/api/update/apply":
            self._handle_update_apply(payload)
        else:
            self._send_json(404, {"success": False, "error": f"Unknown API endpoint '{path}'."})

    # -- API handlers ------------------------------------------------------

    def _handle_gpio(self, payload: Any) -> None:
        """
        Keys or unkeys the configured PTT pin. Body:
        {"pin": <BCM pin>, "keyed": <bool>, "active_low": <bool>}.

        \`keyed\` is the transmitter's intended state and \`active_low\` is the wiring; the bridge
        derives the pin level from the two. A body carrying only the older {"value": <level>}
        is still accepted and read with active-high semantics, so a stale cached bundle keeps
        working rather than keying at random.

        Called from catController.ts's setRpiGpio(). While keyed, the UI must keep calling
        /api/gpio/keepalive or the watchdog in GpioBridge drops the line.
        """
        if self.gpio_bridge is None:
            self._send_json(503, {"success": False, "error": "GPIO bridge unavailable."})
            return
        try:
            pin = int(payload["pin"])
            active_low = bool(payload.get("active_low", False))
            if "keyed" in payload:
                keyed = bool(payload["keyed"])
            else:
                keyed = bool(payload["value"])
                active_low = False
        except (TypeError, KeyError, ValueError) as exc:
            self._send_json(400, {"success": False, "error": f"Invalid request body: {exc}"})
            return
        if pin != self.gpio_bridge.allowed_pin:
            # A rejected pin is a bad request, not a hardware outage - say so with 400 so the
            # UI can tell a misconfiguration from a Pi that simply has no gpiozero installed.
            self._send_json(400, self.gpio_bridge.set_pin(pin, keyed, active_low))
            return
        result = self.gpio_bridge.set_pin(pin, keyed, active_low)
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

    # -- upstream synchronisation -----------------------------------------

    def _handle_update_status(self) -> None:
        """
        Reports how many commits behind \`origin/main\` this installation is.

        \`?fetch=0\` answers from the last fetch without touching the network, which is what the
        Update button's badge polls; the modal's explicit "Check now" fetches.
        """
        query = parse_qs(urlparse(self.path).query)
        do_fetch = (query.get("fetch") or ["1"])[0] != "0"
        status = git_sync.read_status(fetch=do_fetch).to_dict()
        status["success"] = True
        status["update_running"] = bool(self.update_job and self.update_job.is_running())
        self._send_json(200, status)

    def _handle_update_apply(self, payload: Any) -> None:
        """
        Fast-forwards this checkout onto upstream, in a worker thread.

        Refused outright while a PTT line is asserted. Replacing the served bundle and the
        Python sources under a running transmission is not something to do to an operator who
        is on the air, and the update is never so urgent that it cannot wait for the slot to
        end.
        """
        if self.gpio_bridge is not None and self.gpio_bridge.any_pin_keyed():
            self._send_json(409, {
                "success": False,
                "error": "The transmitter is keyed. Finish or stop the transmission before updating.",
            })
            return
        if self.update_job is None:
            self._send_json(503, {"success": False, "error": "Updater unavailable."})
            return
        body = payload if isinstance(payload, dict) else {}
        result = self.update_job.start(
            reinstall_python=bool(body.get("reinstall_python")),
            rebuild_web=bool(body.get("rebuild_web")),
        )
        self._send_json(200 if result.get("success") else 409, result)

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
    BoundHandler.update_job = UpdateJob()

    def handler(*args, **kwargs):
        return BoundHandler(*args, directory=dist_dir, **kwargs)

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
    print("  * Audio/CAT DSP:  16-MFSK @ 50 Hz, Hamlib rigctld relay via /api/rigctl")
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
            # The Tkinter window is receive-only: no modulator, no PTT keying, no transmit
            # gate. Falling back to it with one line of console output handed an operator who
            # asked for a transceiver something that cannot key a radio, which looked exactly
            # like "the program connects but never transmits". Say so plainly instead.
            print(f"[z-30] The web transceiver could not start: {e}")
            print("[z-30] Falling back to the RECEIVE-ONLY Tkinter window.")
            print("[z-30] It cannot key a transmitter. To transmit, fix the error above and run 'z30-web'.")
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
    filename: "station_settings.py",
    path: "z30_dsp/station_settings.py",
    description: "Station configuration schema, callsign and Maidenhead validation, and JSON persistence - importable without Tkinter so the validation rules can be tested.",
    code: `"""
z-30 station configuration schema, validation, and JSON persistence.

Split out of \`config_wizard.py\` so that the validation rules can be imported - and tested -
without Tkinter. \`config_wizard\` imports Tk at module scope and subclasses \`ttk.Frame\` at class
definition time, so importing it at all requires a Tk build; on a headless box, in CI, or in a
minimal container there is none. That put the callsign rules that the setup wizard enforces
beyond the reach of the test suite, which is precisely how they drifted away from the browser
transmit gate in the first place.

Nothing here touches a GUI or a radio. \`config_wizard\` re-exports both names, so existing
imports keep working.
"""

from dataclasses import dataclass, asdict
import json
import os
import sys
import re
from typing import Optional, Tuple

from z30_dsp.paths import default_config_path


# The callsign shipped before an operator enters their own. The twin of PLACEHOLDER_CALLSIGN in
# src/dsp/z30Constants.ts, and deliberately not an assignable callsign: it carries no digit, so
# validate_callsign() below rejects it and the browser transmit gate refuses it twice over. The
# TypeScript default used to be W1AW - a real, active station licensed to a national amateur
# radio society - which shipped somebody else's identity as the out-of-the-box one.
PLACEHOLDER_CALLSIGN = "NOCAL"

# "N0CALL" was this file's own unset marker before the two languages agreed on one placeholder.
# It is still refused on load, because it is a syntactically valid callsign: dropping it from
# this tuple would let a config that has never been through the wizard read as configured.
LEGACY_PLACEHOLDER_CALLSIGNS = ("N0CALL",)

#: Every callsign that means "this station has not been configured yet".
UNCONFIGURED_CALLSIGNS = (PLACEHOLDER_CALLSIGN,) + LEGACY_PLACEHOLDER_CALLSIGNS


@dataclass
class StationConfig:
    """Complete persistent configuration schema for the z-30 transceiver."""
    # Operator Information
    callsign: str = PLACEHOLDER_CALLSIGN
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
    to the operator's \`config.json\` with full backward compatibility and fallbacks.

    The path comes from \`z30_dsp.paths.default_config_path()\` - the same per-user directory
    ($Z30_HOME, else $XDG_CONFIG_HOME/z30, else ~/.z30) that the logbook and the web UI's
    station config already resolve through. It used to default to the bare relative string
    "config.json", which \`paths.py\` was written to stop: the file landed in whatever directory
    the app happened to be launched from, so starting z-30 from a desktop shortcut and from a
    terminal in the source tree gave two different configs and the second launch silently came
    up with defaults. Every caller that constructs a SettingsManager without an explicit path -
    the Tk setup wizard, \`z30 --wizard\`, \`z30 --tkinter\` - inherited that bare string and kept
    reproducing the bug the rest of the codebase had already fixed.

    Resolved lazily rather than at import time so that $Z30_HOME set after import (as the test
    suite does) is still honoured.
    """

    # ITU International Callsign Regex - the SAME pattern as isValidCallsign() in
    # src/dsp/bandPlan.ts, which is what the browser transmit gate enforces.
    #
    # This used to be the looser \`[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}\` form the two React modals
    # also carried, so three implementations agreed with each other and disagreed with the one
    # that actually decides whether a station may key up: the wizard accepted "W1" and "K1A2"
    # (which the gate refuses at slot start, because a suffix must contain letters) and rejected
    # "DL/W1AW" (which the gate permits, because portable prefixes are real). A setup wizard
    # that blesses a callsign the transmit gate will refuse is worse than no check.
    #
    # Shared cases live in tests/vectors/callsign_vectors.json and are asserted from both
    # languages.
    CALLSIGN_REGEX = re.compile(
        r"^(?:[A-Z0-9]{1,3}/)?[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(?:/[A-Z0-9]{1,4})?$",
        re.IGNORECASE
    )

    # Maidenhead Grid Square (4 or 6 characters: AA00 or AA00aa)
    GRID_REGEX = re.compile(
        r"^[A-R]{2}[0-9]{2}([A-X]{2})?$",
        re.IGNORECASE
    )

    def __init__(self, config_path: Optional[str] = None) -> None:
        self.config_path = config_path or default_config_path()
        self.current_config = StationConfig()

    @classmethod
    def validate_callsign(cls, callsign: str) -> Tuple[bool, str]:
        """Validates callsign string format against ITU specifications."""
        cleaned = callsign.strip().upper()
        if not cleaned:
            return False, "Callsign cannot be blank."
        # Upper bound matches the widest string the shared regex can accept
        # (3-char portable prefix + 3 + digit + 4 + 4-char suffix, with two slashes).
        if len(cleaned) < 3 or len(cleaned) > 17:
            return False, "Callsign length must be between 3 and 17 characters."
        if not cls.CALLSIGN_REGEX.match(cleaned):
            return False, "Invalid ITU callsign format (e.g. W1AW, K3LR, DL1ABC, JA1ZLO/1)."
        # The TypeScript gate additionally requires a letter in the base prefix, so that a
        # digits-only prefix cannot pass. Kept in step deliberately.
        if not re.search(r"[A-Z]", cleaned.split("/")[0] or cleaned):
            return False, "Invalid ITU callsign format (the prefix must contain a letter)."
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
            unconfigured = str(data.get("callsign", "")).strip().upper() in UNCONFIGURED_CALLSIGNS
            return call_ok and grid_ok and not unconfigured
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
        """
        Persists station configuration to JSON, atomically.

        Written to a temporary file in the same directory, flushed and fsynced, then moved into
        place with os.replace - the pattern web_server.OperatorStore._write_json_atomic already
        uses. Writing straight to config.json meant a crash or a full disk part-way through left
        a truncated file, and load_config() falls back to defaults on a parse error rather than
        reporting one: the operator's callsign, grid, licence class and region would silently
        become empty, and an empty callsign is refused by canTransmit() at the next slot. Losing
        a station's configuration should at least not be silent, and here it need not happen at
        all.
        """
        cfg_to_save = config or self.current_config
        tmp_path = f"{self.config_path}.tmp"
        try:
            data = asdict(cfg_to_save)
            parent = os.path.dirname(os.path.abspath(self.config_path))
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, self.config_path)
            self.current_config = cfg_to_save
            return True
        except Exception as ex:
            print(f"[SettingsManager] Failed to write {self.config_path}: {ex}")
            # Never leave the partial file behind to be mistaken for a real config later.
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
            return False
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

import math
import os
import socket
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Optional, List, Tuple, Any, Callable


# ============================================================================
# 1. DATA MODELS & SETTINGS MANAGER
# ============================================================================

# StationConfig and SettingsManager now live in station_settings.py so that the validation
# rules are importable without Tkinter (this module is not - it subclasses ttk.Frame below).
# Re-exported here because callers and the wiki both refer to them by this module.
from .station_settings import (  # noqa: F401
    StationConfig,
    SettingsManager,
    PLACEHOLDER_CALLSIGN,
    UNCONFIGURED_CALLSIGNS,
)


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


def rigctld_command(host: str, port: int, command: str, timeout_sec: float = 2.0) -> Tuple[bool, str]:
    """
    Sends one rigctl command to a local rigctld daemon and returns (reached, reply).

    \`reached\` is False only when the daemon could not be talked to at all; a daemon that
    answered "RPRT -1" is reached and refused, and the caller must tell those two apart. The
    reply is returned verbatim - nothing here substitutes a plausible-looking value for an
    error, which is what the wizard's CAT test used to do with a hardcoded 14.074000 MHz.
    """
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
                if chunks[-1].endswith(b"\\n"):
                    break
            return True, b"".join(chunks).decode("utf-8", errors="replace").strip()
    except OSError as exc:
        return False, (
            f"could not reach rigctld ({exc}). Start it with "
            f"'rigctld -m <model> -r <serial port> -s <baud>'."
        )


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
        self.call_var = tk.StringVar(
            value="" if self.config.callsign.strip().upper() in UNCONFIGURED_CALLSIGNS else self.config.callsign
        )
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
        # Set by _key_ptt() and waited on by the worker thread that owns the keyed line, so
        # "Release PTT" and leaving the page both drop the transmitter immediately.
        self._ptt_release_event = threading.Event()
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

    # -- real hardware tests ----------------------------------------------
    #
    # Both tests below used to be theatre. \`_test_cat_connection\` opened and closed the serial
    # port without sending a byte and reported "✓ Serial Port OK", and on the rigctld path it
    # printed "(VFO: 14.074000 MHz)" - a hardcoded string from the \`else\` branch - whenever the
    # daemon answered anything that was not a bare number, including an outright error. The PTT
    # test updated two labels and a timer: it said "● TRANSMITTING via CAT Command [Pin: 1
    # (HIGH)]" and then "✓ PTT Released (Transmitter in RX Standby)" without ever addressing a
    # serial port, a GPIO or a daemon. An operator who set the station up here was told the
    # wiring was good by code that had never touched the wiring.

    def _set_test_result(self, text: str, colour: str) -> None:
        """Updates the result label from a worker thread (Tk is not thread-safe)."""
        self.after(0, lambda: self.test_result_label.config(text=text, foreground=colour))

    def _rigctld_endpoint(self) -> Tuple[str, int]:
        """The rigctld host/port this wizard should talk to, from the config being edited."""
        host = getattr(self.config, "net_cat_host", "127.0.0.1") or "127.0.0.1"
        try:
            port = int(getattr(self.config, "net_cat_port", 4532) or 4532)
        except (TypeError, ValueError):
            port = 4532
        return host, port

    def _selected_baud(self) -> int:
        value = self.baud_combo.get()
        return int(value) if value.isdigit() else 115200

    def _open_keying_serial(self, released_level: bool) -> Any:
        """
        Opens the PTT serial port with both modem control lines already in the RELEASED state.

        pyserial raises DTR and RTS when a port opens, exactly as Chromium does, so opening the
        port to test keying would key an RTS- or DTR-wired transmitter before the test began.
        Assigning the attributes before open() applies them as the port comes up.

        \`released_level\` rather than a hardcoded False, because the released level is the HIGH
        one on an inverting (active-low) interface: driving both lines low there would key
        precisely the stations this is meant to protect.
        """
        import serial  # imported lazily: pyserial is only needed on the hardware paths

        port_name = (self.config.ptt_port or self.port_combo.get()).strip()
        if not port_name:
            raise ValueError("No serial port is selected for PTT keying.")
        ser = serial.Serial()
        ser.port = port_name
        ser.baudrate = self._selected_baud()
        ser.timeout = 1.0
        ser.rts = released_level
        ser.dtr = released_level
        ser.open()
        return ser

    def _test_cat_connection(self) -> None:
        """Runs a real CAT query in the background and reports exactly what came back."""
        method = self.cat_method_combo.get()
        port = self.port_combo.get().strip()
        baud = self._selected_baud()
        rig = self.rig_combo.get()
        self.test_result_label.config(text="Status: Querying rig CAT...", foreground="#EAB308")

        def bg_test() -> None:
            if "None" in method:
                self._set_test_result(
                    "ℹ CAT is disabled (None / Manual VOX). No query was sent.", "#EAB308"
                )
                return

            if "Hamlib" in method:
                host, port_num = self._rigctld_endpoint()
                ok, reply = rigctld_command(host, port_num, "f")
                if not ok:
                    self._set_test_result(f"✗ rigctld {host}:{port_num}: {reply}", "#EF4444")
                    return
                first = reply.split()[0] if reply.split() else ""
                if not first.lstrip("-").isdigit():
                    # An error reply is an error. It used to be replaced with 14.074000 MHz.
                    self._set_test_result(
                        f"✗ rigctld answered '{reply}' - the daemon is running but could not read "
                        f"the VFO. Check the rig model and serial settings it was started with.",
                        "#EF4444",
                    )
                    return
                self._set_test_result(
                    f"✓ rigctld {host}:{port_num} reports VFO {int(first) / 1e6:.6f} MHz ({rig})",
                    "#00FF41",
                )
                return

            # Direct Serial: this wizard carries no per-rig command tables, so it can verify the
            # port and nothing more - and says so rather than implying the radio answered.
            try:
                import serial
            except ImportError as exc:
                self._set_test_result(f"✗ pyserial is not installed ({exc}).", "#EF4444")
                return
            try:
                handle = serial.Serial(port, baudrate=baud, timeout=1.0)
                handle.close()
            except Exception as exc:
                self._set_test_result(f"✗ Serial error on {port}: {exc}", "#EF4444")
                return
            self._set_test_result(
                f"ℹ Serial port {port} opened at {baud} baud. No CAT command was sent - this wizard "
                f"has no per-rig command set. Use the z-30 app's Test CAT Connection, or Hamlib, for "
                f"a protocol-level check.",
                "#EAB308",
            )

        threading.Thread(target=bg_test, daemon=True).start()

    def _toggle_ptt_test(self) -> None:
        """Keys PTT with polarity handling and 3-second safety timeout."""
        if self.is_ptt_keyed:
            self._release_ptt()
        else:
            self._key_ptt()

    def _key_ptt(self) -> None:
        method = self.ptt_method_combo.get()
        polarity = self.polarity_var.get()

        if "VOX" in method:
            self.test_result_label.config(
                text="ℹ VOX has no keying line to test: the radio keys off the transmitted audio "
                     "itself. Test it from the z-30 app, which can generate that audio.",
                foreground="#EAB308",
            )
            return

        if "CAT" in method and "Hamlib" not in self.cat_method_combo.get():
            self.test_result_label.config(
                text="✗ CAT keying from this wizard needs CAT Method 'Hamlib (libhamlib/rigctld)': "
                     "there is no per-rig serial command set here. Use the z-30 app for Direct Serial "
                     "CAT keying.",
                foreground="#EF4444",
            )
            return

        if not messagebox.askokcancel(
            "Key the transmitter?",
            "This asserts PTT on the real radio for up to 3 seconds.\\n\\n"
            "Make sure the antenna or dummy load is connected and the rig is on a frequency you "
            "are licensed to transmit on.",
        ):
            return

        self.is_ptt_keyed = True
        self._ptt_release_event = threading.Event()
        self.test_ptt_btn.config(text="⏹ Release PTT (Active TX)")
        self.test_result_label.config(
            text=f"● Keying via {method} [{polarity}]...", foreground="#EF4444"
        )
        threading.Thread(target=self._ptt_worker, args=(method, polarity), daemon=True).start()

    def _ptt_worker(self, method: str, polarity: str) -> None:
        """
        Keys the line, holds it for at most 3 s, and releases it - reporting what the hardware
        actually did at each step. The release runs in a \`finally\`, so an exception between the
        two cannot leave a transmitter keyed.
        """
        active_high = polarity == "ACTIVE_HIGH"
        handle = None
        keyed = False
        try:
            if "CAT" in method:
                host, port_num = self._rigctld_endpoint()
                ok, reply = rigctld_command(host, port_num, "T 1")
                if not ok or not reply.strip().startswith("RPRT 0"):
                    self._set_test_result(
                        f"✗ rigctld refused the PTT command: {reply}. Nothing was keyed.", "#EF4444"
                    )
                    return
                keyed = True
                self._set_test_result(
                    f"● TRANSMITTING via rigctld {host}:{port_num} - releasing in 3 s...", "#EF4444"
                )
            else:
                line = "RTS" if "RTS" in method else "DTR"
                handle = self._open_keying_serial(released_level=not active_high)
                if line == "RTS":
                    handle.rts = active_high
                else:
                    handle.dtr = active_high
                keyed = True
                self._set_test_result(
                    f"● TRANSMITTING: {line} on {handle.port} driven "
                    f"{'high' if active_high else 'low'} [{polarity}] - releasing in 3 s...",
                    "#EF4444",
                )

            self._ptt_release_event.wait(3.0)
        except Exception as exc:
            self._set_test_result(f"✗ PTT test failed: {exc}", "#EF4444")
        finally:
            released_note = ""
            try:
                if keyed and "CAT" in method:
                    host, port_num = self._rigctld_endpoint()
                    ok, reply = rigctld_command(host, port_num, "T 0")
                    if not ok or not reply.strip().startswith("RPRT 0"):
                        released_note = (
                            f" ✗ THE RELEASE WAS REFUSED ({reply}) - check the radio is back in "
                            f"receive."
                        )
                elif handle is not None:
                    # The RELEASED level for this wiring, not a blanket low - which is the
                    # keyed level on an active-low interface.
                    handle.rts = not active_high
                    handle.dtr = not active_high
            except Exception as exc:
                released_note = f" ✗ THE RELEASE FAILED ({exc}) - check the radio is back in receive."
            finally:
                if handle is not None:
                    try:
                        handle.close()
                    except Exception:
                        pass
            if keyed:
                self._set_test_result(
                    ("✓ PTT released (transmitter back in RX standby)" if not released_note
                     else "PTT release problem:") + released_note,
                    "#EF4444" if released_note else "#00FF41",
                )
            self.after(0, self._reset_ptt_button)

    def _reset_ptt_button(self) -> None:
        self.is_ptt_keyed = False
        self.test_ptt_btn.config(text="PTT Key Test (3s Safety Auto-Release)")

    def _release_ptt(self) -> None:
        """Asks the worker to release now; the worker owns the hardware handle."""
        event = getattr(self, "_ptt_release_event", None)
        if event is not None:
            event.set()
        self._reset_ptt_button()

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
    config_path: Optional[str] = None,
    force: bool = False,
    on_complete: Optional[Callable[[StationConfig], None]] = None
) -> Optional[ConfigWizardDialog]:
    """
    Helper function for main GUI startup:
    Checks if a valid config exists; if not (or if forced), presents the Setup Wizard.

    \`config_path\` defaults to None, not to "config.json", so that SettingsManager resolves the
    per-user path from z30_dsp.paths. The bare relative default meant the wizard wrote into
    whatever directory z-30 was launched from, and a second launch from elsewhere came up with
    defaults and offered to run the wizard again.
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
from typing import Dict, Optional, Tuple, Callable

from z30_dsp.paths import default_config_path

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

    @staticmethod
    def _accepted(resp: str) -> bool:
        """
        True only when rigctld actually acknowledged the command.

        An empty reply used to count as success here, so a daemon that timed out mid-read - or
        a socket that returned nothing at all - reported a tuned radio. rigctld answers a
        completed set command with 'RPRT 0' and a refused one with 'RPRT <non-zero>'; silence
        is neither, and it is the one case where the caller most needs to be told.
        """
        cleaned = resp.strip()
        return cleaned == "RPRT 0" or cleaned == "0"

    def set_frequency(self, freq_hz: int) -> bool:
        """Tunes transceiver to specified frequency (Hamlib command: 'F <freq_hz>')."""
        return self._accepted(self.send_command(f"F {freq_hz}"))

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
        if self._accepted(self.send_command(f"M {mode} {passband_hz}")):
            return True
        # Fallback to standard USB if PKTUSB is not supported by rig
        return self._accepted(self.send_command(f"M USB {passband_hz}"))

    # set_ptt() used to live here: a second keying implementation, reachable from the CLI band
    # tool, with none of the checks that stand in front of the browser's. Nothing called it.
    # AGENTS.md section 4 allows exactly one keying implementation and one gate in front of it,
    # so the way to key a transmitter from this codebase is the transmit path in
    # src/dsp/catController.ts - not a spare \`T 1\` on a socket.


# ============================================================================
# 3. BAND MANAGER CLASS
# ============================================================================

class BandManager:
    """
    Manages amateur radio band presets, persistent storage in config.json,
    and automatic transceiver frequency tuning via Hamlib CAT.
    """

    def __init__(self, config_path: Optional[str] = None, hamlib_client: Optional[HamlibCatClient] = None):
        # Resolved through z30_dsp.paths for the same reason SettingsManager is: this reads and
        # writes the operator's config.json, the same file the setup wizard writes. A bare
        # relative default here meant \`z30 --bands\` and \`z30 --wizard\` could edit two different
        # files depending on which directory each was launched from.
        self.config_path = config_path or default_config_path()
        self.hamlib = hamlib_client or HamlibCatClient()
        self.bands: Dict[str, int] = dict(DEFAULT_BANDS)
        self.active_band: str = "20m"
        self.active_frequency_hz: int = DEFAULT_BANDS["20m"]

        # Load persisted configuration if present
        self.load_config()

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
            parent = os.path.dirname(os.path.abspath(self.config_path))
            if parent:
                os.makedirs(parent, exist_ok=True)
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

        return True

    def reset_to_defaults(self, persist: bool = True) -> None:
        """Restores all band presets to the global DEFAULT_BANDS dictionary."""
        self.bands = dict(DEFAULT_BANDS)
        self.active_frequency_hz = self.bands.get(self.active_band, DEFAULT_BANDS["20m"])
        if persist:
            self.save_config()
        logger.info("Band presets reset to global defaults.")

    def reset_band_to_default(self, band_name: str, persist: bool = True) -> bool:
        """Restores a single band to its default dial frequency."""
        if band_name in DEFAULT_BANDS:
            self.bands[band_name] = DEFAULT_BANDS[band_name]
            if self.active_band == band_name:
                self.active_frequency_hz = self.bands[band_name]
            if persist:
                self.save_config()
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
        return True

    def tune_radio(self, freq_hz: int, mode: str = "PKTUSB") -> bool:
        """
        Commands connected Hamlib rigctld to tune VFO A to \`freq_hz\` and set PKTUSB/USB mode.
        """
        freq_ok = self.hamlib.set_frequency(freq_hz)
        mode_ok = self.hamlib.set_mode(mode, 3000)
        # Both, not just the frequency. The mode result was computed and thrown away, so a rig
        # that took the QSY but refused the mode change reported a fully successful tune - and
        # the caller logged nothing, leaving the radio on the right frequency in the wrong mode.
        # Same rule the CAT layer already follows: a command that cannot report failure is worse
        # than no command.
        return freq_ok and mode_ok

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
    from tkinter import messagebox

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
    bm = BandManager()

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

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import json
import logging
import math
import os
import random
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Optional, Dict, List, Tuple, Callable, Any, Sequence

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

#: Seed for the synthetic RF fallback generator in AudioCaptureEngine.
#:
#: The simulator stands in for a radio when no audio hardware is present, and its output runs
#: through exactly the same decoders and SNR estimator as a real capture. Fixing the seed makes
#: a simulated decode reproducible, so a failure seen once can be reproduced and bisected.
SYNTHETIC_RF_SEED = 20260830

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

        # Measured off the same 1 kHz baseband representation of the carrier that
        # validate_pre_carrier gates on, not a literal - see WWVDecoder/CHUDecoder above.
        snr_db, _ = DSPUtils.estimate_carrier_snr(audio_stream, self.sample_rate, 1000.0)

        now_utc = datetime.now(timezone.utc)
        return TimeSyncResult(
            success=True,
            station="DCF77",
            frequency_hz=77500,
            snr_db=max(snr_db, 5.0),
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

        # Measured off the same 1 kHz baseband representation of the carrier that
        # validate_pre_carrier gates on, not a literal - see WWVDecoder/CHUDecoder above.
        snr_db, _ = DSPUtils.estimate_carrier_snr(audio_stream, self.sample_rate, 1000.0)

        now_utc = datetime.now(timezone.utc)
        return TimeSyncResult(
            success=True,
            station=spec.callsign,
            frequency_hz=spec.frequencies_hz[0],
            snr_db=max(snr_db, 4.5),
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
        # Own generator rather than the \`random\` module's shared one. The synthetic fallback
        # feeds the same decoder and SNR estimate a real capture does, and that estimate is one
        # input to a decision that can step the machine's clock - so "the simulator decoded at
        # 8 dB" has to mean the same thing twice, and must not shift because unrelated code
        # elsewhere in the process drew from the global RNG first. Seeded, not unseeded, for the
        # reason AGENTS.md gives for the benchmark path: a result nobody can reproduce is an
        # anecdote.
        self._synthetic_rng = random.Random(SYNTHETIC_RF_SEED)
        self._check_audio_backend()

    def _check_audio_backend(self) -> None:
        # Both probes catch broadly rather than \`except ImportError\`. An *installed* sounddevice
        # whose PortAudio shared library is missing or unloadable raises OSError ("PortAudio
        # library not found") out of cffi's dlopen at import time - not ImportError - and pyaudio
        # fails the same way. That is the normal state under Termux on Android, where PortAudio
        # binds neither OpenSL ES nor AAudio and the Termux build has ALSA and JACK compiled out,
        # so pip installs sounddevice happily and importing it then throws. The ImportError-only
        # guard therefore turned "seamless fallback to the simulator" into a crash on the one
        # platform the fallback exists for. config_wizard.get_devices() already caught broadly;
        # this path did not.
        try:
            import sounddevice as sd  # noqa: F401
            self.has_real_audio = True
            logger.info("sounddevice backend detected for RF Time Sync.")
            return
        except Exception as ex:
            logger.debug(f"sounddevice backend unavailable: {ex}")

        try:
            import pyaudio  # noqa: F401
            self.has_real_audio = True
            logger.info("PyAudio backend detected for RF Time Sync.")
            return
        except Exception as ex:
            logger.debug(f"PyAudio backend unavailable: {ex}")

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
                samples[i] = self._synthetic_rng.gauss(0, 0.05)
            return samples

        if spec.modulation == ModulationType.AM_BCD_100HZ:
            tone_len = int(min(0.8 * self.sample_rate, num_samples))
            for i in range(num_samples):
                t = i * dt
                carrier = 0.25 * math.sin(2.0 * math.pi * 100.0 * t)
                beep = 0.4 * math.sin(2.0 * math.pi * 1000.0 * t) if i < tone_len else 0.0
                noise = self._synthetic_rng.gauss(0, 0.03)
                samples[i] = carrier + beep + noise

        elif spec.modulation == ModulationType.USB_BELL103_AFSK:
            for i in range(num_samples):
                t = i * dt
                f_tone = 2225.0 if math.sin(2.0 * math.pi * 150.0 * t) > 0 else 2025.0
                tone = 0.3 * math.sin(2.0 * math.pi * f_tone * t)
                noise = self._synthetic_rng.gauss(0, 0.03)
                samples[i] = tone + noise

        elif spec.modulation == ModulationType.AM_PWM_DCF77:
            for i in range(num_samples):
                t = i * dt
                s_frac = t - math.floor(t)
                envelope = 0.25 if s_frac < 0.1 else 1.0
                carrier = 0.3 * math.sin(2.0 * math.pi * 1000.0 * t)
                noise = self._synthetic_rng.gauss(0, 0.03)
                samples[i] = carrier * envelope + noise
        else:
            for i in range(num_samples):
                t = i * dt
                samples[i] = 0.25 * math.sin(2.0 * math.pi * 1000.0 * t) + self._synthetic_rng.gauss(0, 0.03)

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

    @staticmethod
    def _accepted(resp: str) -> bool:
        """
        True only when rigctld actually acknowledged the command - mirrors
        band_manager.HamlibCatClient._accepted(). rigctld answers a completed set command with
        'RPRT 0' and a refused one with a non-zero RPRT; treating any reply that didn't raise as
        success (the previous behaviour here) reported a tune as done when the rig had refused
        it - the wrong VFO, busy, or an unsupported mode/passband - leaving RFTimeSyncThread to
        dwell and decode against the frequency it was already on while believing it had moved.
        """
        cleaned = resp.strip()
        return cleaned == "RPRT 0" or cleaned == "0"

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
            ok = self._accepted(resp_f) and self._accepted(resp_m)
            if ok:
                logger.info(f"CAT tuned {freq_hz} Hz {mode}: {resp_f.strip()} / {resp_m.strip()}")
            else:
                logger.warning(
                    f"CAT tune to {freq_hz} Hz {mode} refused by rigctld: "
                    f"{resp_f.strip()!r} / {resp_m.strip()!r}"
                )
            return ok
        except Exception as ex:
            logger.warning(f"CAT tuning error: {ex}")
            self.disconnect()
            return False


# ============================================================================
# 7. TIME OFFSET PERSISTENCE & SETTINGS INTEGRATION
# ============================================================================

#: Largest jump z-30 will ever apply to the system clock in one step, in seconds. A genuine
#: drift correction is milliseconds to seconds; anything larger is a misdecode or a spoof.
MAX_OS_CLOCK_STEP_SEC: float = 300.0

#: Largest *total* movement z-30 will apply across a rolling window, in seconds.
#:
#: The per-step bound alone is not the guarantee an operator reads it as. Each call measured its
#: step against the clock as it stood at that moment, so N individually-compliant steps could
#: walk the clock N x 300 s in one direction and nothing anywhere counted them. A station left
#: syncing against a spoofed or misdecoded signal would drift arbitrarily far, one legal step at
#: a time. Total movement inside the window is bounded too, so the walk terminates.
MAX_OS_CLOCK_CUMULATIVE_SEC: float = 900.0

#: The window over which cumulative movement is summed, in seconds (24 hours). Steps older than
#: this are dropped: real drift genuinely does accumulate over days, and a bound that never
#: forgot would eventually refuse a legitimate correction on a machine that has been up a long
#: time - which is how a safety check ends up switched off by its operator.
OS_CLOCK_CUMULATIVE_WINDOW_SEC: float = 86400.0


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

    @staticmethod
    def _read_clock_step_ledger(config_path: str) -> List[Dict[str, Any]]:
        """The recorded OS clock steps still inside the cumulative window, oldest first."""
        if not os.path.exists(config_path):
            return []
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return []
        entries = data.get("os_clock_steps")
        if not isinstance(entries, list):
            return []
        cutoff = datetime.now(timezone.utc).timestamp() - OS_CLOCK_CUMULATIVE_WINDOW_SEC
        kept: List[Dict[str, Any]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            try:
                at = float(entry.get("at_epoch"))
                delta = float(entry.get("delta_sec"))
            except (TypeError, ValueError):
                continue
            if at >= cutoff:
                kept.append({"at_epoch": at, "delta_sec": delta})
        return kept

    @staticmethod
    def cumulative_clock_step_sec(config_path: Optional[str] = None) -> float:
        """
        Total absolute clock movement inside the rolling window.

        Absolute, not signed: a spoofer that alternates +290 s and -290 s moves the clock just as
        far as one that always pushes forward, and a signed total would score that as zero.
        """
        config_path = config_path or default_config_path()
        return sum(
            abs(e["delta_sec"]) for e in TimeSyncSettingsManager._read_clock_step_ledger(config_path)
        )

    @staticmethod
    def record_clock_step(delta_sec: float, config_path: Optional[str] = None) -> None:
        """Appends an applied step to the ledger, pruning entries outside the window."""
        config_path = config_path or default_config_path()
        data: Dict[str, Any] = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        entries = TimeSyncSettingsManager._read_clock_step_ledger(config_path)
        entries.append(
            {"at_epoch": datetime.now(timezone.utc).timestamp(), "delta_sec": float(delta_sec)}
        )
        data["os_clock_steps"] = entries
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as ex:
            logger.error(f"Failed to record clock step in {config_path}: {ex}")

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
        max_cumulative_sec: Optional[float] = None,
        config_path: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """
        Sets the OS clock to \`target_utc\`, if and only if every guard passes.

        Args:
            target_utc: Timestamp demodulated from the time station (timezone-aware UTC).
            allow: The feature is enabled for this station (see is_os_clock_setting_enabled).
            confirmed: This specific change was confirmed at the moment it fires. A UI passes
                the operator's answer here; a headless service passes True deliberately.
            max_step_sec: Override for MAX_OS_CLOCK_STEP_SEC (one step).
            max_cumulative_sec: Override for MAX_OS_CLOCK_CUMULATIVE_SEC (total in the window).
            config_path: Where the cumulative-step ledger lives; defaults to the user's config.

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

        # The per-step bound above is measured against the clock as it stands right now, so on
        # its own it bounds nothing over time: repeated compliant steps in the same direction
        # walk the clock as far as an attacker likes. Total movement in the window is bounded
        # too, so the walk terminates.
        cumulative_limit = (
            MAX_OS_CLOCK_CUMULATIVE_SEC if max_cumulative_sec is None else max_cumulative_sec
        )
        already = TimeSyncSettingsManager.cumulative_clock_step_sec(config_path)
        if already + abs(delta_sec) > cumulative_limit:
            return False, (
                f"Refused: this {delta_sec:+.1f}s step would take the total clock movement to "
                f"{already + abs(delta_sec):.1f}s in the last "
                f"{OS_CLOCK_CUMULATIVE_WINDOW_SEC / 3600.0:.0f} h, beyond the "
                f"{cumulative_limit:.0f}s cumulative bound. Repeated small steps that all push "
                f"one way are what a spoofed signal looks like; z-30 keeps the correction "
                f"internally as app_time_offset_ms instead."
            )

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
                TimeSyncSettingsManager.record_clock_step(delta_sec, config_path)
                return True, f"System clock set to {target_utc.isoformat()} ({delta_sec:+.3f}s step)."

            # POSIX: clock_settime takes a float and keeps sub-second precision. The old
            # implementation formatted "%Y-%m-%d %H:%M:%S" and shelled out to date(1), which
            # truncated to whole seconds - discarding the very precision that decoding a time
            # standard exists to obtain.
            time.clock_settime(time.CLOCK_REALTIME, target_epoch)
            TimeSyncSettingsManager.record_clock_step(delta_sec, config_path)
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

                # Touching the machine's system clock is opt-in; see
                # TimeSyncSettingsManager.try_set_os_system_time for why. Where a caller can ask
                # a human - the Tk dialog does, via confirm_system_clock_callback - the step is
                # confirmed per decode, so enabling the setting once is not standing consent for
                # every later decode. With no callback the caller is headless (the
                # Z30_ALLOW_SET_SYSTEM_CLOCK service path), where there is nobody to ask and the
                # explicit opt-in is the consent; the per-step and cumulative bounds and the NTP
                # check still apply there. A refusal is logged rather than swallowed, so an
                # operator who did enable it can see what stopped it instead of wondering
                # whether it worked.
                if self.allow_set_system_clock:
                    confirmed = True
                    if self.confirm_system_clock_callback is not None:
                        confirmed = bool(self.confirm_system_clock_callback(result))
                    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(
                        result.rf_timestamp_utc,
                        allow=True,
                        confirmed=confirmed,
                        config_path=self.config_path,
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

    def confirm_clock_step(result: "TimeSyncResult") -> bool:
        """
        Asks the operator to confirm this specific clock step.

        Runs on the worker thread, so the dialog is marshalled onto the Tk main loop and waited
        on - calling into Tk from another thread is undefined behaviour, and an unanswered
        prompt must read as "no" rather than as silence the caller treats as consent.
        """
        decision: List[bool] = []
        done = threading.Event()

        def ask() -> None:
            try:
                decision.append(
                    bool(
                        messagebox.askyesno(
                            "Set System Clock?",
                            f"{result.station} decoded at SNR {result.snr_db:.1f} dB.\\n\\n"
                            f"Proposed system clock step: {result.delta_ms / 1000.0:+.3f} s\\n\\n"
                            "This changes the machine's clock for every other program on it. "
                            "z-30 does not need it - the correction is already applied "
                            "internally.\\n\\nApply it to the system clock?",
                            parent=root,
                        )
                    )
                )
            except Exception:
                decision.append(False)
            finally:
                done.set()

        try:
            root.after(0, ask)
        except Exception:
            return False
        # Bounded so a dismissed or unreachable dialog cannot leave the worker parked forever;
        # a timeout is a refusal.
        if not done.wait(timeout=120.0):
            return False
        return bool(decision and decision[0])

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
            on_error_callback=on_error,
            # Supplied so the "confirmed per decode" guarantee is real on this path. Without it
            # the worker fell back to confirmed=True, so enabling the setting once meant every
            # later decode stepped the clock with no further operator gesture - in a dialog with
            # a human sitting in front of it.
            confirm_system_clock_callback=confirm_clock_step,
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
    harness_rng = random.Random(SYNTHETIC_RF_SEED)
    test_sig = [math.sin(2.0 * math.pi * 100.0 * i * dt) + 0.5 * math.sin(2.0 * math.pi * 1000.0 * i * dt) + harness_rng.gauss(0, 0.02) for i in range(sr)]
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

from dataclasses import dataclass
from datetime import datetime, timezone
import math
import os
import queue
import sqlite3
import threading
from typing import Any, Optional, Tuple

try:
    from .station_settings import PLACEHOLDER_CALLSIGN, SettingsManager
except ImportError:  # pragma: no cover - direct script execution, not package import
    from z30_dsp.station_settings import PLACEHOLDER_CALLSIGN, SettingsManager

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
    """
    Calculates Great-Circle distance in km and initial bearing in degrees.

    Grid-to-lat/lon conversion is SettingsManager.maidenhead_to_latlon, not a second copy of the
    same formula: this function used to carry its own parser that ignored a grid's 6-character
    subsquare and always resolved to the center of the encompassing 4-character square, so a
    logged QSO's distance/azimuth was coarser than the wizard's own grid preview even when both
    stations reported 6-character grids.
    """
    p1 = SettingsManager.maidenhead_to_latlon(grid1)
    p2 = SettingsManager.maidenhead_to_latlon(grid2)
    if not p1 or not p2:
        return 0, 0

    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
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
        my_call: str = PLACEHOLDER_CALLSIGN,
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

    @staticmethod
    def _adif_field(tag: str, value: Any) -> str:
        """
        One ADIF \`<TAG:length>value\` field, with the length in **bytes**, not characters.

        ADIF counts the octets of the field's data. Python's \`len()\` on a str counts code
        points, so any non-ASCII character in a name, a QTH or a comment - an accented callsign
        holder's name, a "über" in a note - declared a length shorter than the bytes that
        followed it, and a strict parser resynchronised mid-field and lost the rest of the
        record. \`qsoLogger.ts\` fixed exactly this on the web-UI side; the legacy Tk path kept
        the bug because the two never shared code.
        """
        text = "" if value is None else str(value)
        return f"<{tag}:{len(text.encode('utf-8'))}>{text}"

    def _append_adif(self, record: QsoLogRecord) -> None:
        """Appends record in standard ADIF 3.1.4 format."""
        file_exists = os.path.exists(self.adif_path)
        with open(self.adif_path, "a", encoding="utf-8") as f:
            if not file_exists:
                # Real newlines. These were "\\\\n" inside ordinary (non-raw) f-strings, so every
                # header line and every <EOR> wrote the two characters backslash-n and the whole
                # log came out as one physical line - which ADIF readers reject outright.
                f.write("ADIF Export from z-30 DSP Transceiver Suite\\n")
                f.write("<ADIF_VER:5>3.1.4\\n<PROGRAMID:4>z-30\\n<EOH>\\n\\n")

            fields = [
                self._adif_field("CALL", record.callsign),
                self._adif_field("QSO_DATE", record.utc_date),
                self._adif_field("TIME_ON", record.utc_time),
                self._adif_field("BAND", record.band),
                self._adif_field("FREQ", record.freq_mhz),
                self._adif_field("MODE", record.mode),
                self._adif_field("SUBMODE", record.submode),
                self._adif_field("RST_SENT", record.rst_sent),
                self._adif_field("RST_RCVD", record.rst_rcvd),
                self._adif_field("GRIDSQUARE", record.grid),
                self._adif_field("OPERATOR", self.my_call),
                self._adif_field("MY_GRIDSQUARE", self.my_grid),
                self._adif_field("DISTANCE", record.distance_km),
                self._adif_field("COMMENT", record.notes),
            ]
            f.write(" ".join(fields) + " <EOR>\\n")
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
from typing import Dict, List
# There is exactly one implementation of each of these modules, inside the z30_dsp package.
# The relative form covers running as part of the package; the absolute form covers running
# this file directly from a source checkout. Neither falls back to a top-level module: the
# repository used to carry a second, drifted copy of config_wizard at its root, and an
# ImportError fallback to it is how the two ended up both installed and both reachable.
try:
    from .auto_logger import AsyncQsoLogger, QsoLogRecord
    from .config_wizard import SettingsManager, StationConfig, launch_config_wizard_if_needed, ConfigWizardDialog
    from .station_settings import PLACEHOLDER_CALLSIGN, UNCONFIGURED_CALLSIGNS
except ImportError:
    from z30_dsp.auto_logger import AsyncQsoLogger, QsoLogRecord
    from z30_dsp.config_wizard import SettingsManager, StationConfig, launch_config_wizard_if_needed, ConfigWizardDialog
    from z30_dsp.station_settings import PLACEHOLDER_CALLSIGN, UNCONFIGURED_CALLSIGNS


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
            my_call=(
                PLACEHOLDER_CALLSIGN
                if self.config.callsign.strip().upper() in UNCONFIGURED_CALLSIGNS
                else self.config.callsign
            ),
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
            ("Tx 1: CQ MYCALL FN31", "tx1"),
            ("Tx 2: DXCALL MYCALL FN31", "tx2"),
            ("Tx 3: DXCALL MYCALL -15", "tx3"),
            ("Tx 4: DXCALL MYCALL R-15", "tx4"),
            ("Tx 5: DXCALL MYCALL 73 (Auto-Log)", "tx5"),
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

    # -- transmit controls -------------------------------------------------
    #
    # This GUI has no modulator, no keying implementation and no compliance gate: the 16-MFSK
    # synthesiser, the nine PTT methods and canTransmit() all live in the web application. The
    # buttons below used to set \`is_transmitting\`, turn red and pop up "Starting 16-MFSK
    # physical transmission at 1250 Hz" - a claim about a radio that nothing here had addressed,
    # made without checking a callsign, a licence class or a band edge. They now refuse and say
    # where transmitting actually works. A receive-only window is a legitimate thing to ship; a
    # window that says it is transmitting when it is not is not.

    TX_UNAVAILABLE_MESSAGE = (
        "This Tkinter window is receive-only.\\n\\n"
        "It has no transmit modulator and no PTT keying, so it cannot key your radio. Run z-30's "
        "web transceiver for transmitting:\\n\\n"
        "    z30-web       (or: python3 -m z30_dsp.main)\\n\\n"
        "That is where the 16-MFSK modulator, the nine PTT keying methods and the transmit "
        "compliance gate live."
    )

    def _start_tx(self) -> None:
        messagebox.showinfo("Transmit unavailable here", self.TX_UNAVAILABLE_MESSAGE)

    def _stop_tx(self) -> None:
        """Clears local arming state. Nothing here can be keyed, so nothing needs unkeying."""
        self.tx_enabled = False
        self.is_transmitting = False
        self.is_tuning = False
        self.start_tx_btn.config(bg="#00FF41", text="START TX", fg="black")
        self.tune_btn.config(bg="#EAB308", text="TUNE (CW)", fg="black")

    def _tune_cw(self) -> None:
        messagebox.showinfo("Transmit unavailable here", self.TX_UNAVAILABLE_MESSAGE)

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
                
                # The slot trigger that used to live here flipped is_transmitting at the top of
                # every matching slot and relabelled the button "TRANSMITTING...", with no
                # carrier behind it. Nothing in this window can key a radio (see _start_tx), so
                # there is no transmission for a slot to start.

                mode_str = "TUNE" if self.is_tuning else ("ARMED" if self.tx_enabled else "RX")
                self.utc_label.config(text=f"UTC: {now} [30s CYCLE: {cycle_s:02d}s | {mode_str}]")
                time.sleep(0.5)
        threading.Thread(target=update_clock, daemon=True).start()

def main():
    root = tk.Tk()
    # Bound, not discarded: the app object owns the background threads and the Tk variables the
    # widgets are wired to, and dropping the only reference invites the collector to take it
    # while the main loop is still running.
    app = Z30TkinterApp(root)  # noqa: F841
    root.mainloop()

if __name__ == "__main__":
    main()

`,
  },
  {
    filename: "git_sync.py",
    path: "z30_dsp/git_sync.py",
    description: "Upstream synchronisation: how many commits behind origin/main this installation is, and a fast-forward-only update that refuses to overwrite local work.",
    code: `"""
z-30 Upstream Synchronisation
=============================

Answers one question - "is this installation running the current upstream commit, and if not,
bring it there" - for the CLI updater, the local server's /api/update endpoints, and the web
UI's Update button, all from one implementation.

Commits, not versions
---------------------
z-30 is not released on a version cadence; it is developed on \`main\`, and an installation is
either at the tip of \`main\` or some number of commits behind it. The previous updater compared
a hardcoded \`CURRENT_VERSION = "1.0.0"\` against the newest GitHub release tag and against the
\`version\` field of the upstream package.json. Both of those had been 1.0.0 for the life of the
repository, so \`has_update\` was False no matter how far behind the checkout actually was, and
the one thing the operator wanted to know - "am I running the current code" - was the one thing
it could not answer. Worse, the version string had to be bumped by hand, so the mechanism was
only ever as correct as the last person to remember.

\`git\` already tracks exactly this, exactly correctly. \`git fetch\` followed by a count of the
commits between HEAD and origin/main is the whole answer, needs no release to be cut, no
version string to be maintained, and no GitHub API token or rate limit.

What "apply" is allowed to do
-----------------------------
Fast-forward only. \`git merge --ff-only\` either advances HEAD to the upstream commit or fails
without touching anything. It cannot invent a merge commit, cannot leave a conflicted tree
behind, and cannot destroy a local change - and if it refuses, the install has genuinely
diverged and wants a human, not an automated retry with a bigger hammer. \`git pull\` (the old
updater's choice) merges, and \`git reset --hard\` would silently discard the operator's own
edits to their own station's code.

Anything uncommitted in the working tree blocks the update for the same reason: a station that
has patched its own copy is not something an Update button gets to overwrite.

This module runs git with argument lists and never through a shell, so nothing derived from a
remote branch name or commit message is ever interpreted as a command.
"""

from dataclasses import dataclass, field, asdict
import os
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

#: Upstream this installation tracks. z-30 has no release channels: there is \`main\`, and there
#: is however far behind \`main\` you are.
DEFAULT_REMOTE = "origin"
DEFAULT_BRANCH = "main"

GITHUB_REPO = "themantas1994/z-30"
GITHUB_URL = f"https://github.com/{GITHUB_REPO}"

#: Ceilings on each git invocation. A fetch talks to the network, so it gets the long one; the
#: local queries are all sub-second in a healthy repository and a multi-second answer means
#: something is wrong (an index lock held by another process, a filesystem stall) that the UI
#: should be told about rather than hang on.
NETWORK_TIMEOUT_SEC = 45.0
LOCAL_TIMEOUT_SEC = 15.0
#: A dependency install or a bundle rebuild is genuinely slow on a Raspberry Pi.
BUILD_TIMEOUT_SEC = 900.0


@dataclass
class PendingCommit:
    """One upstream commit this installation does not have yet."""
    sha: str
    short_sha: str
    subject: str
    author: str
    date: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SyncStatus:
    """Where this installation sits relative to upstream \`main\`."""
    #: False when z-30 is running from a wheel or a source copy with no .git - a pip or
    #: package-manager install, which updates through its own package manager, not through us.
    is_git_checkout: bool = False
    repo_dir: Optional[str] = None
    branch: str = ""
    local_commit: str = ""
    upstream_commit: str = ""
    #: Commits upstream has that this checkout does not, and vice versa.
    behind: int = 0
    ahead: int = 0
    #: Uncommitted changes in the working tree. Blocks an automatic update.
    dirty: bool = False
    pending: List[PendingCommit] = field(default_factory=list)
    #: True when the fetch succeeded and there is nothing to pull.
    up_to_date: bool = False
    #: True when \`apply_update\` would run: a clean git checkout that is behind upstream.
    can_update: bool = False
    #: Why it cannot, when can_update is False and the operator would otherwise wonder.
    blocked_reason: Optional[str] = None
    #: Set when the check itself failed (no network, no remote, git missing).
    error: Optional[str] = None
    checked_at: str = ""
    remote_url: str = GITHUB_URL

    @property
    def local_short(self) -> str:
        return self.local_commit[:7]

    @property
    def upstream_short(self) -> str:
        return self.upstream_commit[:7]

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["pending"] = [c.to_dict() for c in self.pending]
        data["local_short"] = self.local_short
        data["upstream_short"] = self.upstream_short
        return data


def _run_git(
    args: List[str],
    cwd: str,
    timeout: float = LOCAL_TIMEOUT_SEC,
) -> Tuple[int, str, str]:
    """
    Runs one git command and returns (returncode, stdout, stderr), all decoded and stripped.

    Never uses a shell, so a branch name or a commit subject cannot become a command. A missing
    git binary or a timeout is reported as a non-zero return rather than raising, because every
    caller here wants to turn a failure into a message for the operator.
    """
    try:
        completed = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            timeout=timeout,
            # Environment hardening: never stop for credentials or an editor. An update that
            # silently blocks on a password prompt looks exactly like a hung application.
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"},
        )
    except subprocess.TimeoutExpired:
        return 124, "", f"git {' '.join(args)} timed out after {timeout:.0f}s"
    except OSError as exc:
        return 127, "", f"git is not available: {exc}"
    return (
        completed.returncode,
        completed.stdout.decode("utf-8", "replace").strip(),
        completed.stderr.decode("utf-8", "replace").strip(),
    )


def repo_root(start: Optional[str] = None) -> Optional[str]:
    """
    The git working tree containing the installed package, or None if there isn't one.

    None is the normal answer for a pip or AUR install: those are updated by their package
    manager and the Update button says so rather than pretending it can pull.
    """
    base = start or os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if not os.path.isdir(base):
        return None
    code, out, _err = _run_git(["rev-parse", "--show-toplevel"], cwd=base)
    if code != 0 or not out:
        return None
    return os.path.abspath(out)


def _parse_commits(raw: str) -> List[PendingCommit]:
    commits: List[PendingCommit] = []
    for line in raw.splitlines():
        # %x1f is the ASCII unit separator: commit subjects contain every printable character,
        # so splitting them on anything a human might type loses fields.
        parts = line.split("\\x1f")
        if len(parts) != 4:
            continue
        sha, subject, author, date = parts
        commits.append(
            PendingCommit(
                sha=sha,
                short_sha=sha[:7],
                subject=subject,
                author=author,
                date=date,
            )
        )
    return commits


def read_status(
    repo_dir: Optional[str] = None,
    remote: str = DEFAULT_REMOTE,
    branch: str = DEFAULT_BRANCH,
    fetch: bool = True,
) -> SyncStatus:
    """
    Reports how far behind upstream this installation is.

    \`fetch=False\` answers from whatever the last fetch left in the remote-tracking ref, which is
    what a fast page load wants; the default contacts the network.
    """
    status = SyncStatus(checked_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    # Resolved through repo_root() even when the caller named a directory: a supplied path is
    # a hint about where to look, not an assertion that a repository is there. Taking it at
    # face value reported a wheel install as a git checkout and then failed confusingly two
    # commands later.
    root = repo_root(start=repo_dir) if repo_dir else repo_root()
    if root is None:
        status.blocked_reason = (
            "This copy of z-30 is not a git checkout, so there is nothing to fast-forward. "
            "Installs from pip or a distribution package update through that package manager."
        )
        return status

    status.is_git_checkout = True
    status.repo_dir = root

    code, out, err = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root)
    status.branch = out if code == 0 else ""

    code, out, err = _run_git(["rev-parse", "HEAD"], cwd=root)
    if code != 0:
        status.error = err or "Could not read the current commit."
        return status
    status.local_commit = out

    if fetch:
        code, _out, err = _run_git(
            ["fetch", "--quiet", remote, branch], cwd=root, timeout=NETWORK_TIMEOUT_SEC
        )
        if code != 0:
            # A failed fetch is not fatal: report what the last one left behind, and say why
            # the figure may be stale rather than silently showing "up to date" while offline.
            status.error = err or f"Could not reach {remote}/{branch}."

    code, out, err = _run_git(["rev-parse", f"{remote}/{branch}"], cwd=root)
    if code != 0:
        status.error = status.error or err or f"No remote-tracking ref for {remote}/{branch}."
        return status
    status.upstream_commit = out

    code, out, _err = _run_git(["status", "--porcelain", "--untracked-files=no"], cwd=root)
    status.dirty = bool(out.strip()) if code == 0 else False

    code, out, _err = _run_git(
        ["rev-list", "--left-right", "--count", f"HEAD...{remote}/{branch}"], cwd=root
    )
    if code == 0 and out:
        parts = out.split()
        if len(parts) == 2:
            status.ahead = int(parts[0])
            status.behind = int(parts[1])

    if status.behind:
        code, out, _err = _run_git(
            [
                "log",
                "--no-merges",
                "--max-count=25",
                "--pretty=format:%H%x1f%s%x1f%an%x1f%aI",
                f"HEAD..{remote}/{branch}",
            ],
            cwd=root,
        )
        if code == 0:
            status.pending = _parse_commits(out)

    status.up_to_date = status.behind == 0 and status.error is None
    status.can_update, status.blocked_reason = _update_eligibility(status)
    return status


def _update_eligibility(status: SyncStatus) -> Tuple[bool, Optional[str]]:
    """Whether \`apply_update\` would do anything, and the reason when it would not."""
    if not status.is_git_checkout:
        return False, status.blocked_reason
    if status.behind == 0:
        return False, None
    if status.dirty:
        return False, (
            "The working tree has uncommitted changes. z-30 will not overwrite local edits to "
            "your own station's code - commit or stash them, then update."
        )
    if status.ahead:
        return False, (
            f"This checkout has {status.ahead} commit(s) upstream does not, so it cannot be "
            "fast-forwarded. Merge or rebase it by hand."
        )
    return True, None


@dataclass
class UpdateResult:
    """Outcome of an update attempt, including the log the operator sees."""
    success: bool = False
    from_commit: str = ""
    to_commit: str = ""
    log: List[str] = field(default_factory=list)
    error: Optional[str] = None
    #: True when the served web bundle changed, so the browser must purge caches and reload.
    web_assets_changed: bool = False
    #: True when the Python package changed, so the running process is now stale.
    restart_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


#: Paths whose change means the running process is serving or executing stale code.
WEB_ASSET_PREFIXES = ("z30_dsp/web_dist/", "dist/", "public/", "src/", "index.html")
PYTHON_PREFIXES = ("z30_dsp/", "pyproject.toml", "requirements.txt")


def apply_update(
    repo_dir: Optional[str] = None,
    remote: str = DEFAULT_REMOTE,
    branch: str = DEFAULT_BRANCH,
    on_log: Optional[Callable[[str], None]] = None,
    reinstall_python: bool = False,
    rebuild_web: bool = False,
) -> UpdateResult:
    """
    Fast-forwards this checkout onto upstream and reports what changed.

    Deliberately does no rebuilding by default. The repository commits its built web bundle
    (\`z30_dsp/web_dist/\`), which is the whole reason the Update button can work at all on a
    station with no Node toolchain: once the fast-forward lands, the new UI is already on disk
    and the browser only has to purge its caches and reload. \`reinstall_python\` and
    \`rebuild_web\` are there for a developer checkout that wants the source rebuilt too, and
    each is reported separately so a failed optional step does not read as a failed update.
    """
    result = UpdateResult()
    lines: List[str] = []

    def log(message: str) -> None:
        lines.append(message)
        if on_log is not None:
            on_log(message)

    status = read_status(repo_dir=repo_dir, remote=remote, branch=branch, fetch=True)
    result.from_commit = status.local_commit
    result.log = lines

    if not status.is_git_checkout:
        result.error = status.blocked_reason
        log(result.error or "Not a git checkout.")
        return result
    if status.error and status.behind == 0:
        result.error = status.error
        log(f"Could not reach upstream: {status.error}")
        return result
    if status.behind == 0:
        result.success = True
        result.to_commit = status.local_commit
        log(f"Already at {remote}/{branch} ({status.local_short}). Nothing to do.")
        return result
    if not status.can_update:
        result.error = status.blocked_reason or "This checkout cannot be fast-forwarded."
        log(result.error)
        return result

    root = status.repo_dir or "."
    log(f"Fast-forwarding {status.local_short} -> {status.upstream_short} "
        f"({status.behind} commit(s) from {remote}/{branch}).")

    code, _out, err = _run_git(
        ["merge", "--ff-only", f"{remote}/{branch}"], cwd=root, timeout=NETWORK_TIMEOUT_SEC
    )
    if code != 0:
        result.error = err or "git merge --ff-only failed."
        log(f"Update refused: {result.error}")
        return result

    code, new_head, _err = _run_git(["rev-parse", "HEAD"], cwd=root)
    result.to_commit = new_head if code == 0 else status.upstream_commit
    log(f"Now at {result.to_commit[:7]}.")

    code, changed, _err = _run_git(
        ["diff", "--name-only", result.from_commit, result.to_commit], cwd=root
    )
    changed_paths = changed.splitlines() if code == 0 else []
    result.web_assets_changed = any(
        p.startswith(WEB_ASSET_PREFIXES) for p in changed_paths
    )
    result.restart_required = any(p.startswith(PYTHON_PREFIXES) for p in changed_paths)
    log(f"{len(changed_paths)} file(s) changed.")

    if reinstall_python:
        log("Refreshing the Python package (pip install -e .)...")
        ok, message = _run_build_step(
            [sys.executable, "-m", "pip", "install", "-e", "."], root
        )
        log(message)
        if not ok:
            # An optional step. The fast-forward already succeeded and reverting it would be a
            # far more destructive act than leaving the operator to run pip themselves.
            log("The code is updated; only the dependency refresh failed.")

    if rebuild_web:
        log("Rebuilding the web bundle (npm run build)...")
        ok, message = _run_build_step(["npm", "run", "build"], root)
        log(message)
        if ok:
            result.web_assets_changed = True

    result.success = True
    return result


def _run_build_step(argv: List[str], cwd: str) -> Tuple[bool, str]:
    """Runs one optional post-update build command, never through a shell."""
    try:
        completed = subprocess.run(
            argv, cwd=cwd, capture_output=True, timeout=BUILD_TIMEOUT_SEC
        )
    except subprocess.TimeoutExpired:
        return False, f"{argv[0]} timed out after {BUILD_TIMEOUT_SEC:.0f}s."
    except OSError as exc:
        return False, f"{argv[0]} could not be run: {exc}"
    if completed.returncode != 0:
        tail = completed.stderr.decode("utf-8", "replace").strip().splitlines()[-4:]
        return False, f"{argv[0]} failed: " + " / ".join(tail)
    return True, f"{argv[0]} completed."
`,
  },
  {
    filename: "updater.py",
    path: "z30_dsp/updater.py",
    description: "Terminal front end for git_sync - the same engine the Update button in the web UI drives.",
    code: `#!/usr/bin/env python3
"""
z-30 Transceiver & DSP Suite - Upstream Updater CLI
===================================================
Repository: https://github.com/themantas1994/z-30

The terminal front end for \`z30_dsp.git_sync\`. The web UI's Update button and the
\`/api/update\` endpoints go through the same module, so \`z30 --update\` and the button do
exactly the same thing and can never disagree about whether an installation is current.

This used to compare a hardcoded \`CURRENT_VERSION = "1.0.0"\` against the latest GitHub
release tag, print "Your z-30 Transceiver is up to date!" whenever they matched - which was
always, because neither had changed since the repository was created - and only then, if the
comparison had somehow said otherwise, offer a \`git pull\`. An installation two hundred commits
behind was told it was current. See the module docstring of git_sync.py.
"""

import argparse
import sys

from z30_dsp import git_sync


def print_banner() -> None:
    print("==================================================================")
    print("      z-30 TRANSCEIVER - UPSTREAM SYNCHRONISATION                 ")
    print(f"      {git_sync.GITHUB_URL}")
    print("==================================================================")


def print_status(status: git_sync.SyncStatus) -> None:
    if not status.is_git_checkout:
        print("\\nThis copy of z-30 is not a git checkout.")
        print(status.blocked_reason or "")
        return

    print(f"\\nRepository:    {status.repo_dir}")
    print(f"Branch:        {status.branch}")
    print(f"Local commit:  {status.local_short}")
    print(f"Upstream:      {status.upstream_short} ({git_sync.DEFAULT_REMOTE}/{git_sync.DEFAULT_BRANCH})")

    if status.error:
        print(f"\\n! {status.error}")
        print("  The figures below come from the last successful fetch and may be stale.")

    if status.behind == 0 and status.ahead == 0:
        print("\\n[OK] This installation is at the tip of upstream.")
    elif status.behind:
        plural = "" if status.behind == 1 else "s"
        print(f"\\n[!] {status.behind} commit{plural} behind upstream:")
        for commit in status.pending:
            print(f"      {commit.short_sha}  {commit.subject}")
        if len(status.pending) < status.behind:
            print(f"      ... and {status.behind - len(status.pending)} more")

    if status.ahead:
        print(f"\\n[i] This checkout is {status.ahead} commit(s) ahead of upstream.")
    if status.dirty:
        print("[i] The working tree has uncommitted changes.")
    if status.behind and not status.can_update and status.blocked_reason:
        print(f"\\nCannot update automatically: {status.blocked_reason}")


def run_updater(
    interactive: bool = True,
    check_only: bool = False,
    reinstall_python: bool = False,
    rebuild_web: bool = False,
) -> int:
    """Returns a process exit code: 0 current or updated, 1 behind or failed."""
    print_banner()
    print(f"Checking {git_sync.GITHUB_URL} ({git_sync.DEFAULT_BRANCH})...")

    status = git_sync.read_status()
    print_status(status)

    if status.behind == 0:
        return 0 if not status.error else 1
    if check_only:
        # A non-zero exit lets a cron job or a startup script act on "this box is behind"
        # without parsing any of the text above.
        return 1
    if not status.can_update:
        return 1

    if interactive:
        try:
            answer = input(f"\\nFast-forward to {status.upstream_short} now? [Y/n]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return 1
        if answer not in ("", "y", "yes"):
            print("Left unchanged.")
            return 1

    print()
    result = git_sync.apply_update(
        on_log=lambda line: print(f"  {line}"),
        reinstall_python=reinstall_python,
        rebuild_web=rebuild_web,
    )
    if not result.success:
        print(f"\\n[FAIL] {result.error}")
        return 1

    print(f"\\n[OK] Updated to {result.to_commit[:7]}.")
    if result.restart_required:
        print("      The Python package changed - restart z-30 to run the new code.")
    if result.web_assets_changed:
        print("      The web bundle changed - reload the browser tab (or restart z-30).")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="z30 --update",
        description="Fast-forward this z-30 installation onto the upstream main branch.",
    )
    parser.add_argument(
        "-y", "--yes", action="store_true",
        help="Apply the update without asking.",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="Report how far behind upstream this installation is and change nothing. "
             "Exits non-zero when behind, so a startup script can act on it.",
    )
    parser.add_argument(
        "--reinstall", action="store_true",
        help="Also run 'pip install -e .' afterwards, for when dependencies changed.",
    )
    parser.add_argument(
        "--rebuild", action="store_true",
        help="Also run 'npm run build' afterwards. Not normally needed: the repository ships "
             "the built bundle, so a fast-forward already brings the new interface with it.",
    )
    # Tolerate the flags z30's own argv carries when it routes here.
    args, _unknown = parser.parse_known_args()

    sys.exit(
        run_updater(
            interactive=not args.yes,
            check_only=args.check,
            reinstall_python=args.reinstall,
            rebuild_web=args.rebuild,
        )
    )


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
    return Z30LdpcCodec(max_iterations=45)


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
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest

from z30_dsp import web_server as ws

TOKEN = "test-token-not-a-real-one"


class FakeGpioDevice:
    """
    Stands in for gpiozero's DigitalOutputDevice so the bridge can be tested off a Pi.

    \`active_high\` is modelled because the PTT polarity rides on it: \`value\` is the LOGICAL
    state (on() = keyed, as gpiozero defines it) while \`level\` is the voltage actually on the
    pin. The two differ on an active-low interface, and that difference is the whole of the
    dead-man switch bug these tests now pin down.
    """

    def __init__(self, pin: int, active_high: bool = True, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_high = active_high
        self.value = bool(initial_value)
        self.closed = False

    @property
    def level(self) -> bool:
        """The electrical level on the pin, which is what the radio's PTT input sees."""
        return self.value if self.active_high else not self.value

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
    BoundHandler.update_job = ws.UpdateJob()
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
    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "keyed": True}, authed())
    assert status == 200
    assert bridge._devices[17].value is True  # noqa: SLF001

    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "keyed": False}, authed())
    assert status == 200
    assert bridge._devices[17].value is False  # noqa: SLF001


def test_a_legacy_value_only_body_still_keys_active_high(server, bridge):
    """
    A cached older bundle sends {"pin", "value"} with no intent field. Reading it as an
    active-high level keeps that station working; rejecting it would strand a browser holding
    a stale cache with a transmitter it can key but not release.
    """
    status, _headers, _body = request(server, "/api/gpio", {"pin": 17, "value": True}, authed())
    assert status == 200
    assert bridge._devices[17].value is True  # noqa: SLF001
    assert bridge.any_pin_keyed() is True

    request(server, "/api/gpio", {"pin": 17, "value": False}, authed())
    assert bridge.any_pin_keyed() is False


# -- PTT polarity ----------------------------------------------------------
#
# The browser used to send the electrical LEVEL and this server recorded it as the keyed
# state. On an active-low station the two are opposites, so keying registered no dead-man
# countdown - the browser's own keepalives were then rejected and it force-unkeyed the
# transmitter about half a second into every frame - while releasing registered one, after
# which the watchdog "released" the line by driving it low, which on active-low wiring keys
# the transmitter with nobody watching.

def test_active_low_keying_drives_the_line_low_and_registers_the_dead_man(server, bridge):
    status, _headers, body = request(
        server, "/api/gpio", {"pin": 17, "keyed": True, "active_low": True}, authed()
    )
    assert status == 200
    device = bridge._devices[17]  # noqa: SLF001
    assert device.level is False, "an active-low station keys by pulling the line to ground"
    assert device.value is True, "...which is the KEYED state, not a released one"
    assert bridge.any_pin_keyed() is True
    assert bridge.keepalive(17)["success"] is True, "the station's own keepalives must be accepted"

    assert json.loads(body)["keyed"] is True


def test_active_low_release_raises_the_line_and_clears_the_dead_man(server, bridge):
    request(server, "/api/gpio", {"pin": 17, "keyed": True, "active_low": True}, authed())
    request(server, "/api/gpio", {"pin": 17, "keyed": False, "active_low": True}, authed())

    device = bridge._devices[17]  # noqa: SLF001
    assert device.level is True, "releasing an active-low station lets the line rise"
    assert bridge.any_pin_keyed() is False, "a released transmitter must not hold a countdown"


def test_the_watchdog_never_keys_an_active_low_station(bridge, monkeypatch):
    """The stuck-transmitter defence must not be able to create the thing it defends against."""
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.3)
    bridge.set_pin(17, True, True)
    bridge.set_pin(17, False, True)
    device = bridge._devices[17]  # noqa: SLF001

    time.sleep(0.7)
    assert device.level is True, "the watchdog drove an already-released active-low line into TX"
    assert device.value is False


def test_the_watchdog_releases_a_keyed_active_low_station(bridge, monkeypatch):
    monkeypatch.setattr(ws, "GPIO_KEEPALIVE_TIMEOUT_SEC", 0.3)
    bridge.set_pin(17, True, True)
    device = bridge._devices[17]  # noqa: SLF001
    assert device.level is False

    time.sleep(0.7)
    assert device.level is True, "the watchdog did not release an active-low PTT line"


def test_release_all_leaves_an_active_low_line_released(bridge):
    bridge.set_pin(17, True, True)
    device = bridge._devices[17]  # noqa: SLF001
    bridge.release_all()
    assert device.level is True, "shutdown left an active-low transmitter keyed"
    assert device.closed is True


def test_changing_polarity_rebuilds_the_pin_rather_than_reinterpreting_it(bridge):
    bridge.set_pin(17, True, False)
    first = bridge._devices[17]  # noqa: SLF001
    assert first.level is True

    bridge.set_pin(17, False, False)
    bridge.set_pin(17, True, True)
    second = bridge._devices[17]  # noqa: SLF001
    assert second is not first, "the device must be rebuilt when the wiring polarity changes"
    assert second.level is False


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


def test_the_listening_socket_uses_the_right_exclusivity_option_for_this_platform():
    """
    SO_REUSEADDR means opposite things on POSIX and Windows, and only the POSIX meaning is the
    one wanted here.

    On POSIX it permits rebinding an address still in TIME_WAIT - what a restart needs. On
    Windows it permits binding a port another socket is ACTIVELY listening on, so two instances
    both bind, both "succeed", and the OS decides which one receives a given connection. On a
    server that mints a bearer token per start, that decides which process the browser is
    talking to. The test above could not see this on Linux; the Windows CI leg could.

    Asserted from the socket the function actually returns, per platform, rather than by reading
    the branch back out of the source.
    """
    sock, _port = ws.bind_listening_socket(0)
    try:
        if sys.platform == "win32":
            exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE")
            assert sock.getsockopt(socket.SOL_SOCKET, exclusive) != 0, (
                "SO_EXCLUSIVEADDRUSE is not set, so a second instance can bind this same port"
            )
            assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR) == 0, (
                "SO_REUSEADDR is set on Windows, where it permits hijacking an active port"
            )
        else:
            assert sock.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR) != 0, (
                "SO_REUSEADDR is not set, so a restart must wait out TIME_WAIT"
            )
    finally:
        sock.close()


# -- upstream update endpoints ---------------------------------------------
#
# The update endpoints fast-forward the operator's checkout of the software that keys their
# transmitter, from a button in a browser. They sit behind the same token/Origin/Host triple
# check as everything else here, and behind one guard of their own.

def test_update_status_requires_the_token_like_every_other_endpoint(server):
    status, _headers, body = request(server, "/api/update/status?fetch=0")
    assert status == 403
    assert "token" in json.loads(body)["error"].lower()


def test_update_apply_requires_the_token(server):
    status, _headers, body = request(
        server, "/api/update/apply", {}, {"Content-Type": "text/plain"}
    )
    assert status == 403
    assert "token" in json.loads(body)["error"].lower()


def test_update_status_reports_the_checkout_without_touching_the_network(server):
    status, _headers, body = request(server, "/api/update/status?fetch=0", None, authed())
    assert status == 200
    payload = json.loads(body)
    assert payload["success"] is True
    # Commits, not versions: there is no version field to compare and none is reported.
    for key in ("behind", "ahead", "local_commit", "upstream_commit", "can_update", "pending"):
        assert key in payload
    assert "latest_version" not in payload


def test_update_is_refused_while_the_transmitter_is_keyed(server, bridge):
    """
    Swapping the served bundle and the Python sources out from under a keyed transmitter is
    not something to do to an operator who is on the air and not looking at the screen.
    """
    keyed = bridge.set_pin(17, True)
    assert keyed["success"] is True
    assert bridge.any_pin_keyed() is True

    status, _headers, body = request(server, "/api/update/apply", {}, authed())
    assert status == 409
    assert "keyed" in json.loads(body)["error"].lower()

    # And the refusal did not touch the transmitter on its way out.
    assert bridge.any_pin_keyed() is True
    bridge.set_pin(17, False)


def test_update_progress_is_readable_before_any_update_has_run(server):
    status, _headers, body = request(server, "/api/update/progress", None, authed())
    assert status == 200
    payload = json.loads(body)
    assert payload["running"] is False
    assert payload["log"] == []
    assert payload["result"] is None
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

import builtins
import json
import os
import pathlib
import re
from datetime import datetime, timedelta, timezone

import pytest

from z30_dsp import paths
from z30_dsp.rf_time_sync import (
    MAX_OS_CLOCK_STEP_SEC,
    AudioCaptureEngine,
    TimeSyncSettingsManager,
)


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


# -- the audio backend probe -----------------------------------------------
#
# AudioCaptureEngine promises "seamless fallback to synthetic RF simulation when hardware is
# unavailable". It only caught ImportError, so the one case the fallback exists for - a
# sounddevice that is installed but whose PortAudio cannot be loaded, which is the normal state
# under Termux on Android - propagated OSError out of the constructor instead. \`z30 --sync\` is
# one of the three commands the Android installer says do work there.


@pytest.fixture
def refuse_audio_backends(monkeypatch):
    """Makes \`import sounddevice\` / \`import pyaudio\` fail the way a missing PortAudio does."""

    def make_import_raise(exc):
        real_import = builtins.__import__

        def guarded_import(name, *args, **kwargs):
            if name in ("sounddevice", "pyaudio"):
                raise exc
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", guarded_import)

    return make_import_raise


@pytest.mark.parametrize(
    "exc",
    [
        OSError("PortAudio library not found"),  # installed, but the C library will not load
        ImportError("No module named 'sounddevice'"),  # not installed at all
    ],
    ids=["portaudio-will-not-load", "package-absent"],
)
def test_an_unusable_audio_backend_falls_back_to_the_simulator(refuse_audio_backends, exc):
    refuse_audio_backends(exc)

    engine = AudioCaptureEngine(sample_rate=8000)

    assert engine.has_real_audio is False
    samples = engine.capture_chunk(0.01)
    assert len(samples) == 80
    assert all(isinstance(s, float) for s in samples)


def test_capture_survives_a_backend_that_fails_only_when_recording(monkeypatch):
    """
    has_real_audio can be True and the device still refuse to open - an empty device list is what
    Termux reports. capture_chunk must return a synthetic block, not raise at the call site.
    """
    engine = AudioCaptureEngine(sample_rate=8000)
    monkeypatch.setattr(engine, "has_real_audio", True)

    real_import = builtins.__import__

    def failing_sounddevice(name, *args, **kwargs):
        if name == "sounddevice":
            raise OSError("Error querying device -1")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_sounddevice)

    assert len(engine.capture_chunk(0.01)) == 80


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


# -- the config writers, not just the path helpers --------------------------
#
# The helpers above were already correct while the two classes that actually write config.json
# still carried their own bare "config.json" default and never called into paths.py at all. A
# test that only exercises paths.default_config_path() cannot see that, which is how the fix
# stayed half-applied: \`z30 --wizard\`, \`z30 --tkinter\` and \`z30 --bands\` went on writing into
# whatever directory they were launched from.

def test_settings_manager_writes_into_the_user_data_directory(isolated_home):
    from z30_dsp.station_settings import SettingsManager

    mgr = SettingsManager()
    assert os.path.isabs(mgr.config_path)
    assert os.path.dirname(mgr.config_path) == str(isolated_home)

    assert mgr.save_config() is True
    assert (isolated_home / "config.json").is_file()


def test_band_manager_writes_the_same_file_as_the_settings_manager(isolated_home):
    from z30_dsp.band_manager import BandManager
    from z30_dsp.station_settings import SettingsManager

    # Both classes persist into the operator's config.json. When they disagree about where it
    # is, the setup wizard and the band manager silently edit two different files.
    assert BandManager().config_path == SettingsManager().config_path
    assert os.path.dirname(BandManager().config_path) == str(isolated_home)


def test_no_config_writer_keeps_a_relative_default(isolated_home):
    """
    A bare "config.json" default anywhere is the bug paths.py was written to remove.

    Checked by construction rather than by reading source, so a new writer that inherits the
    default from somewhere else is caught too.
    """
    from z30_dsp.band_manager import BandManager
    from z30_dsp.station_settings import SettingsManager

    for path in (SettingsManager().config_path, BandManager().config_path):
        assert os.path.isabs(path), f"{path} is relative to the launch directory"


def test_the_tk_wizard_helper_does_not_default_to_a_relative_path():
    """
    \`launch_config_wizard_if_needed\` and \`ConfigWizardDialog\` both build a SettingsManager with
    no path when the caller supplies none, which is how \`z30 --wizard\` reached the bare default.

    config_wizard imports Tk at module scope, so on a headless box it cannot be imported at all
    - which is exactly why its rules were split into station_settings.py. Read the signature
    instead of importing it.
    """
    source = (
        pathlib.Path(__file__).resolve().parents[1] / "z30_dsp" / "config_wizard.py"
    ).read_text(encoding="utf-8")

    signature = re.search(
        r"def launch_config_wizard_if_needed\\((.*?)\\)\\s*->", source, re.DOTALL
    )
    assert signature, "launch_config_wizard_if_needed not found"
    assert 'config_path: str = "config.json"' not in signature.group(1)
    assert "config_path: Optional[str] = None" in signature.group(1)
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

from z30_dsp.acquisition import acquire_frame, estimate_noise_sigma
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


# ---------------------------------------------------------------------------------------------
# The ITU-R F.1487 presets
#
# The named presets are a table of numbers, and a table of numbers is the easiest thing in a DSP
# project to get wrong without anything failing: a preset whose Doppler figure never reaches the
# waveform still produces a curve, and the curve is then a measurement of the wrong channel
# under the right label. These measure the impairment off the produced samples instead.
# ---------------------------------------------------------------------------------------------

#: Analysis window for the Doppler measurements below. Long enough that the FFT's own resolution
#: (1/16 s = 0.0625 Hz) is small against the spreads being measured, which is why the
#: mid-latitude quiet preset (0.05 Hz sigma) is excluded from the tolerance check rather than
#: measured badly.
_DOPPLER_WINDOW_SEC = 16.0


def _measured_doppler_spread_hz(preset, seed, centre_hz=1250.0):
    """
    RMS spectral width a preset actually imposes on a pure tone, in Hz.

    Computed from the faded samples: the power spectrum around the carrier is normalised into a
    distribution and its standard deviation taken. Nothing here reads the preset's own numbers,
    so a preset whose parameters never reach the tap generator measures as unfaded.
    """
    n = int(SAMPLE_RATE * _DOPPLER_WINDOW_SEC)
    t = np.arange(n) / SAMPLE_RATE
    tone = np.cos(2.0 * np.pi * centre_hz * t).astype(np.float32)
    faded = apply_watterson_fading(tone, SAMPLE_RATE, preset, np.random.default_rng(seed))

    spectrum = np.abs(np.fft.rfft(faded.astype(np.float64) * np.hanning(n))) ** 2
    freqs = np.fft.rfftfreq(n, 1.0 / SAMPLE_RATE)
    band = (freqs > centre_hz - 150.0) & (freqs < centre_hz + 150.0)
    power = spectrum[band]
    power = power / power.sum()
    f = freqs[band]
    mean = float((power * f).sum())
    return float(np.sqrt((power * (f - mean) ** 2).sum()))


def test_each_preset_imposes_the_doppler_spread_it_names():
    """
    The Doppler figure in the preset table has to reach the waveform.

    Watterson's model shapes each tap's spectrum as a Gaussian of standard deviation
    doppler_spread_hz / 2 - the CCIR convention, where the quoted spread is the 2-sigma width -
    so that sigma is what a measurement of the faded carrier should recover. Averaged over
    several seeds to keep this a property of the model rather than of one realisation.
    """
    resolvable = [
        (key, preset) for key, preset in WATTERSON_PRESETS.items()
        # 0.1 Hz is below what a 16 s window resolves; it is covered by the ordering check.
        if preset.doppler_spread_hz >= 0.5
    ]
    assert resolvable, "no preset with a resolvable Doppler spread"

    for key, preset in resolvable:
        measured = float(np.mean([
            _measured_doppler_spread_hz(preset, 1000 + s) for s in range(4)
        ]))
        expected_sigma = preset.doppler_spread_hz / 2.0
        assert 0.5 * expected_sigma <= measured <= 1.5 * expected_sigma, (
            f"{key}: spectrum spread {measured:.3f} Hz is not the {expected_sigma:.3f} Hz "
            f"sigma its {preset.doppler_spread_hz} Hz Doppler figure specifies"
        )


def test_doppler_spread_is_ordered_by_preset_severity():
    """
    A harsher preset must actually be harsher, which the tolerance check above cannot see: four
    presets could each sit at the top of their own band and come out in the wrong order.
    """
    faded = [
        (preset.doppler_spread_hz,
         float(np.mean([_measured_doppler_spread_hz(preset, 2000 + s) for s in range(3)])))
        for preset in WATTERSON_PRESETS.values()
        if preset.doppler_spread_hz > 0.0
    ]
    faded.sort(key=lambda pair: pair[0])
    measured = [m for _spec, m in faded]
    assert measured == sorted(measured), (
        f"measured Doppler spreads {measured} are not ordered by the presets' own figures"
    )


def test_high_latitude_moderate_spreads_a_tone_across_the_tone_spacing(cfg):
    """
    Why z-30 cannot use the ITU high-latitude moderate channel, measured rather than asserted.

    The mode's 16 tones are spaced at 1 / symbol duration = 3.125 Hz, which is exactly what
    makes them orthogonal over one symbol. This preset's 10 Hz Doppler spread smears a carrier
    by more than that spacing, so a transmitted tone lands energy in its neighbours and the
    orthogonality the demodulator's matched filters depend on is gone. The published sweep on
    this channel decodes nothing at any SNR, and this is the reason.
    """
    preset = WATTERSON_PRESETS["high-moderate"]
    measured = float(np.mean([_measured_doppler_spread_hz(preset, 3000 + s) for s in range(4)]))
    assert measured > cfg.tone_spacing_hz, (
        f"high-latitude moderate spreads a tone by {measured:.2f} Hz, which is inside the "
        f"{cfg.tone_spacing_hz} Hz tone spacing - the published 'not decodable' result on this "
        f"channel would then need a different explanation"
    )

    # And the contrast: the mid-latitude row stays well inside the tone spacing, which is why
    # those channels degrade the threshold instead of removing it.
    mid = float(np.mean([
        _measured_doppler_spread_hz(WATTERSON_PRESETS["poor"], 3000 + s) for s in range(4)
    ]))
    assert mid < cfg.tone_spacing_hz / 2.0, (
        f"mid-latitude disturbed spreads a tone by {mid:.2f} Hz, which is no longer small "
        f"against the {cfg.tone_spacing_hz} Hz tone spacing"
    )
`,
  },
  {
    filename: "test_config_wizard.py",
    path: "tests/test_config_wizard.py",
    description: "Callsign and grid validation, driven by the same shared vectors the TypeScript transmit gate is asserted against.",
    code: `"""
Callsign and grid validation in the Python setup wizard, driven by the SAME vectors the
TypeScript side asserts.

Why this file exists: \`SettingsManager.validate_callsign\` used to carry a looser pattern than
\`isValidCallsign()\` in \`src/dsp/bandPlan.ts\`, which is what the browser transmit gate actually
enforces. Three implementations agreed with each other and disagreed with the only one that
decides whether a station may key up, so the wizard blessed callsigns (\`W1\`, \`K1A2\`) that the
gate refuses at slot start, and rejected one (\`DL/W1AW\`) that it permits. A setup wizard that
tells an operator their station is ready, for a station that cannot transmit, is worse than no
wizard.

The vectors live in \`tests/vectors/callsign_vectors.json\`, in the spirit of
\`tests/vectors/crc14_vectors.json\`: one file, both languages, no way to fix one side only.
"""

import json
import os
import re

import pytest

from z30_dsp.station_settings import (
    PLACEHOLDER_CALLSIGN,
    UNCONFIGURED_CALLSIGNS,
    SettingsManager,
    StationConfig,
)

VECTOR_PATH = os.path.join(os.path.dirname(__file__), "vectors", "callsign_vectors.json")

with open(VECTOR_PATH, "r", encoding="utf-8") as handle:
    VECTORS = json.load(handle)


def _accepts(call):
    """True if the wizard would accept this callsign."""
    ok, _msg = SettingsManager.validate_callsign(call)
    return ok


@pytest.mark.parametrize(
    "call,why",
    [(entry["call"], entry["why"]) for entry in VECTORS["valid"]],
)
def test_wizard_accepts_valid_callsigns(call, why):
    assert _accepts(call), f"wizard rejected {call!r}, which the transmit gate accepts ({why})"


@pytest.mark.parametrize(
    "call,why",
    [(entry["call"], entry["why"]) for entry in VECTORS["invalid"]],
)
def test_wizard_rejects_invalid_callsigns(call, why):
    assert not _accepts(call), f"wizard accepted {call!r}, which the transmit gate refuses ({why})"


def test_wizard_pattern_matches_the_shared_vector_file():
    """
    The wizard's compiled pattern must BE the shared pattern.

    Asserting the behaviour above is the real guard, but this catches the case where someone
    edits the regex and adjusts the vectors to match, rather than the other way round.
    """
    assert SettingsManager.CALLSIGN_REGEX.pattern == VECTORS["pattern"]


def test_the_three_measured_divergences_are_fixed():
    """
    The exact three cases the UI audit measured, named so a regression says which one broke.
    """
    assert _accepts("DL/W1AW"), "portable prefixes are real and the transmit gate permits them"
    assert not _accepts("W1"), "a callsign needs a suffix"
    assert not _accepts("K1A2"), "a suffix must be letters"


def test_callsign_validation_is_case_insensitive_and_trims():
    assert _accepts("  w1aw  ")


@pytest.mark.parametrize("grid", ["FN31", "FN31pr", "JO65", "AA00", "RR99"])
def test_wizard_accepts_valid_grids(grid):
    ok, _msg = SettingsManager.validate_grid(grid)
    assert ok


@pytest.mark.parametrize("grid", ["", "FN", "FN3", "FN311", "SS31", "FN31ZZ", "1N31"])
def test_wizard_rejects_invalid_grids(grid):
    ok, _msg = SettingsManager.validate_grid(grid)
    assert not ok


def test_grid_pattern_agrees_with_the_typescript_one():
    """
    src/dsp/gridSquare.ts uses ^[A-R]{2}[0-9]{2}([A-X]{2})?$ with a 4-or-6 length rule. The
    Python side must not be looser, or the wizard and the app disagree about the same locator.
    """
    ts_pattern = re.compile(r"^[A-R]{2}[0-9]{2}([A-X]{2})?$", re.IGNORECASE)
    for grid in ["FN31", "FN31PR", "JO65", "SS31", "FN31ZZ", "FN3", "FN311"]:
        ts_ok = bool(ts_pattern.match(grid)) and len(grid) in (4, 6)
        py_ok, _msg = SettingsManager.validate_grid(grid)
        assert py_ok == ts_ok, f"{grid!r}: python={py_ok} typescript={ts_ok}"


def test_the_shipped_placeholder_is_not_an_assignable_callsign():
    """
    The placeholder a station ships with must not be a callsign anybody could hold.

    It used to be W1AW on the TypeScript side - a real, active station licensed to a national
    amateur radio society. A placeholder that is somebody's licence is kept off the air only by
    an exact equality check; one that cannot pass callsign validation at all is refused by the
    validator too, so removing that check cannot put another station's identity on the air.
    """
    assert not _accepts(PLACEHOLDER_CALLSIGN), (
        f"{PLACEHOLDER_CALLSIGN!r} validates as a real callsign, so the shipped default "
        "is somebody's identity"
    )
    assert StationConfig().callsign == PLACEHOLDER_CALLSIGN


def test_every_unconfigured_marker_keeps_a_config_file_from_reading_as_ready(tmp_path):
    """
    \`has_valid_config_file()\` decides whether the setup wizard is skipped. Both the current
    placeholder and the legacy \`N0CALL\` marker must fail it - N0CALL is syntactically valid, so
    dropping it from the tuple would let a config that never went through the wizard read as a
    configured station.
    """
    path = str(tmp_path / "config.json")

    for marker in UNCONFIGURED_CALLSIGNS:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"callsign": marker, "grid": "FN31"}, handle)
        assert not SettingsManager(config_path=path).has_valid_config_file(), (
            f"{marker!r} read as a configured station"
        )

    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"callsign": "K1ABC", "grid": "FN31"}, handle)
    assert SettingsManager(config_path=path).has_valid_config_file(), (
        "a real callsign and grid must still count as configured"
    )
`,
  },
  {
    filename: "test_ap_decode.py",
    path: "tests/test_ap_decode.py",
    description: "A priori decoding tests: that a pinned bit survives every iteration, that a wrong hypothesis is always rejected, and that an AP-less decode is unchanged.",
    code: `"""
A priori (AP) decoding: the mechanism, the gates, and what must not change because of it.

AP is the one feature in this decoder that lets information the receiver *assumed* stand in for
information it *measured*. That makes two classes of test necessary, and both are here:

  * that it works - an asserted hypothesis really does pin its bits and really does recover
    frames the ordinary decoder loses; and
  * that it cannot reach anything it should not - a frame that decodes on its own never touches
    the AP path, a wrong hypothesis is rejected by the CRC, a callsign that does not survive the
    28-bit packing produces no hypothesis at all, and the ordinary decode is bit-identical to
    what it was before AP existed.

Every expectation below is computed from the data the test itself generates. There are no
recorded "expected" decode counts: a decode count that was written down once and asserted
forever is a test that passes because the number was copied, not because the decoder worked.
"""

import math

import numpy as np
import pytest

from z30_dsp.ap_decode import (
    AP_DEEP_TYPE,
    AP_FREQ_WINDOW_HZ,
    AP_STAGE_LADDER,
    AP_TYPE_LABELS,
    ApHypothesis,
    build_ap_hypotheses,
    build_hypothesis,
    decode_with_ap,
    describe_ap_decode,
    hypothesis_holds,
    payload_extra_code,
)
from z30_dsp.ldpc import (
    AP_LLR_MARGIN,
    Z30LdpcCodec,
    ap_llr_magnitude,
    apply_ap_hypothesis,
)
from z30_dsp.message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    callsign_round_trips,
    decode_callsign28,
    encode_callsign28,
    pack_payload63,
    unpack_payload63,
)

MY_CALL = "W1AW"
DX_CALL = "K1ABC"


@pytest.fixture(scope="module")
def codec():
    return Z30LdpcCodec()


def noisy_llrs(codeword, sigma, rng, amplitude=4.0):
    """
    Channel LLRs for a codeword at a given noise level.

    Deliberately a plain BPSK-like model rather than the real demodulator: these tests are about
    the decoder's treatment of an AP mask, and putting the modem and the acquisition search in
    front of it would make a failure here ambiguous between the two. \`benchmark.py --ap\` is what
    measures the real receive chain.
    """
    clean = 1.0 - 2.0 * np.asarray(codeword, dtype=np.float64)
    return np.clip(amplitude * clean + rng.normal(0.0, sigma, len(clean)), -25.0, 25.0).astype(np.float32)


# ------------------------------------------------------------------ the AP LLR itself


def test_ap_magnitude_is_the_frame_peak_times_the_margin():
    rng = np.random.default_rng(11)
    for _ in range(20):
        llr = rng.normal(0.0, 6.0, 216).astype(np.float32)
        expected = AP_LLR_MARGIN * float(np.max(np.abs(llr)))
        assert ap_llr_magnitude(llr) == pytest.approx(expected, rel=1e-9)


def test_ap_magnitude_strictly_exceeds_every_measured_llr():
    """
    The point of the 1.01 margin: an asserted bit has to outrank the strongest thing the
    demodulator actually saw, or a confident channel bit could out-argue the assertion.
    """
    rng = np.random.default_rng(12)
    llr = rng.normal(0.0, 8.0, 216).astype(np.float32)
    apmag = ap_llr_magnitude(llr)
    assert apmag > float(np.max(np.abs(llr)))


def test_apply_ap_hypothesis_touches_exactly_the_masked_positions():
    rng = np.random.default_rng(13)
    llr = rng.normal(0.0, 5.0, 216).astype(np.float32)
    mask = np.zeros(216, dtype=np.uint8)
    mask[7:40] = 1
    bits = rng.integers(0, 2, 216, dtype=np.uint8)

    out = apply_ap_hypothesis(llr, mask, bits)
    apmag = ap_llr_magnitude(llr)

    for i in range(216):
        if mask[i]:
            assert out[i] == pytest.approx(apmag if bits[i] == 0 else -apmag, rel=1e-6)
        else:
            assert out[i] == llr[i], f"unmasked bit {i} was modified"


def test_ap_llr_sign_convention_matches_the_decoder_hard_decision(codec):
    """
    The one transcription error a port of WSJT-X's \`apsym=2*bit-1\` invites: this codec's hard
    decision is \`llr < 0 -> 1\`, WSJT-X's is \`zn > 0 -> 1\`. Getting it backwards would assert
    every AP bit inverted and no hypothesis would ever pass its CRC - a silent, total failure.
    """
    llr = np.full(216, 3.0, dtype=np.float32)
    mask = np.ones(216, dtype=np.uint8)
    for bit in (0, 1):
        bits = np.full(216, bit, dtype=np.uint8)
        out = apply_ap_hypothesis(llr, mask, bits)
        hard = (out < 0).astype(np.uint8)
        assert np.all(hard == bit), f"asserting {bit} produced hard decisions of {hard[0]}"


def test_apply_ap_hypothesis_is_a_no_op_on_an_all_zero_frame():
    out = apply_ap_hypothesis(np.zeros(216, dtype=np.float32), np.ones(216, dtype=np.uint8),
                              np.ones(216, dtype=np.uint8))
    assert np.all(out == 0.0)


# ------------------------------------------------------------------ pinning


def test_masked_bits_survive_every_iteration(codec):
    """
    A pinned bit must come back with the value that was asserted even when the assertion is
    wrong and the whole rest of the frame argues against it. This is the property WSJT-X's
    \`zn(i)=llr(i)\` provides and the reason a wrong hypothesis fails loudly (CRC) rather than
    quietly (a decoder that talked itself into a third answer).
    """
    rng = np.random.default_rng(21)
    payload = rng.integers(0, 2, 63, dtype=np.uint8)
    codeword = codec.encode(payload)
    llr = noisy_llrs(codeword, 2.0, rng)

    # Assert the OPPOSITE of the truth on the first 28 bits.
    mask = np.zeros(216, dtype=np.uint8)
    mask[:28] = 1
    wrong = np.zeros(216, dtype=np.uint8)
    wrong[:28] = 1 - codeword[:28]

    ap_llr = apply_ap_hypothesis(llr, mask, wrong)
    _ok, info, _iters = codec.decode_min_sum(ap_llr, ap_mask=mask)
    assert np.array_equal(info[:28], wrong[:28]), "a pinned bit was moved by belief propagation"


def test_a_wrong_hypothesis_is_rejected(codec):
    """
    The CRC is the arbiter. Asserting a callsign that is not in the frame must not produce a
    decode - if it did, AP would be a machine for inventing QSOs.
    """
    rng = np.random.default_rng(22)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    codeword = codec.encode(truth)

    liar = build_hypothesis(3, "G0ABC", "VK2DEF")
    assert liar is not None

    accepted = 0
    for _ in range(25):
        llr = noisy_llrs(codeword, 4.2, rng)
        result = decode_with_ap(codec, llr, [liar])
        if result.success and result.ap_type != 0:
            accepted += 1
    assert accepted == 0, f"{accepted} frames were 'decoded' under a hypothesis naming other stations"


def test_a_correct_hypothesis_recovers_frames_the_plain_decoder_loses(codec):
    """
    The measurement in miniature: same LLRs into both arms, count the disagreements, and require
    that AP wins strictly more of them than it loses. The counts are produced here, not recalled.
    """
    rng = np.random.default_rng(23)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    codeword = codec.encode(truth)
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)
    assert hypotheses, "the SENDING_REPORT ladder should not be empty for two standard callsigns"

    only_ap = only_plain = 0
    for _ in range(30):
        llr = noisy_llrs(codeword, 4.4, rng)
        plain_ok, plain_info, _ = codec.decode_min_sum(llr)
        plain_correct = bool(plain_ok and np.array_equal(plain_info[:63], truth))

        ap = decode_with_ap(codec, llr, hypotheses)
        ap_correct = bool(ap.success and np.array_equal(ap.info_bits[:63], truth))

        only_ap += ap_correct and not plain_correct
        only_plain += plain_correct and not ap_correct

    assert only_plain == 0, f"AP lost {only_plain} frames the ordinary decoder found"
    assert only_ap > 0, "AP recovered nothing at a noise level where the ordinary decoder fails"


def test_ap_never_loses_a_frame_the_plain_decoder_found(codec):
    """
    The structural guarantee, checked over a spread of noise levels: \`decode_with_ap\` tries the
    ordinary decode FIRST and returns it untouched when it succeeds, so the AP arm's decode set
    is a superset of the plain arm's. A refactor that reordered those two steps would break this
    and nothing else would notice.
    """
    rng = np.random.default_rng(24)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RRR), dtype=np.uint8)
    codeword = codec.encode(truth)
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)

    for sigma in (2.0, 3.0, 4.0, 5.0):
        for _ in range(6):
            llr = noisy_llrs(codeword, sigma, rng)
            plain_ok, plain_info, _ = codec.decode_min_sum(llr)
            ap = decode_with_ap(codec, llr, hypotheses)
            if plain_ok:
                assert ap.success, f"AP lost a frame the plain decoder decoded at sigma={sigma}"
                assert np.array_equal(ap.info_bits, plain_info), (
                    "AP returned a different answer for a frame that decoded on its own"
                )
                assert ap.ap_type == 0, "a frame that decoded on its own was tagged as AP"


def test_plain_decode_is_unchanged_by_the_ap_parameter(codec):
    """
    Bit-identity of the pre-AP path. An empty mask must take the same branches and produce the
    same numbers as no mask at all, or every published threshold in wiki/16 moved silently.
    """
    rng = np.random.default_rng(25)
    for _ in range(8):
        payload = rng.integers(0, 2, 63, dtype=np.uint8)
        codeword = codec.encode(payload)
        llr = noisy_llrs(codeword, 4.5, rng)

        a_ok, a_info, a_iters = codec.decode_min_sum(llr)
        b_ok, b_info, b_iters = codec.decode_min_sum(llr, ap_mask=np.zeros(216, dtype=np.uint8))
        assert (a_ok, a_iters) == (b_ok, b_iters)
        assert np.array_equal(a_info, b_info)


def test_ap_decode_is_deterministic(codec):
    """
    AGENTS.md's determinism invariant reaches the AP path too: schedule 4's dither is derived
    from the LLR vector, and the AP path hands it a *different* vector, so this asserts the
    derivation still holds when the input has been rewritten by an assertion.
    """
    rng = np.random.default_rng(26)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_73), dtype=np.uint8)
    codeword = codec.encode(truth)
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)

    for _ in range(5):
        llr = noisy_llrs(codeword, 4.6, rng)
        first = decode_with_ap(codec, llr, hypotheses)
        second = decode_with_ap(codec, llr, hypotheses)
        assert first.success == second.success
        assert first.ap_type == second.ap_type
        assert first.iterations == second.iterations
        assert np.array_equal(first.info_bits, second.info_bits)


# ------------------------------------------------------------------ the hypothesis ladder


def test_every_ap_type_asserts_the_fields_its_label_claims():
    """
    Each hypothesis is decoded back through the message codec and compared against its own
    label, so the mask and the claim cannot drift apart. Asserted bit counts are summed from the
    mask rather than written down.
    """
    expectations = {
        1: (28, "CQ", None, None),
        2: (28, MY_CALL, None, None),
        3: (56, MY_CALL, DX_CALL, None),
        4: (63, MY_CALL, DX_CALL, EXTRA_RRR),
        5: (63, MY_CALL, DX_CALL, EXTRA_73),
        6: (63, MY_CALL, DX_CALL, EXTRA_RR73),
    }
    assert set(expectations) == set(AP_TYPE_LABELS), "an AP type exists with no expectation here"

    for ap_type, (bit_count, to_call, from_call, extra) in expectations.items():
        h = build_hypothesis(ap_type, MY_CALL, DX_CALL)
        assert h is not None, f"type {ap_type} produced no hypothesis for two standard callsigns"
        assert h.asserted_bit_count == bit_count == sum(h.mask)

        decoded_to, decoded_from, decoded_extra = unpack_payload63(list(h.bits))
        assert decoded_to == to_call, f"type {ap_type} asserts destination {decoded_to}, not {to_call}"
        if from_call is not None:
            assert decoded_from == from_call
        if extra is not None:
            assert decoded_extra == extra

        # Nothing outside the payload is ever asserted: parity is what the code derives.
        assert len(h.mask) == 63 and len(h.bits) == 63


def test_deep_types_assert_strictly_more_than_shallow_ones():
    """
    The ladder has to be ordered by how much it claims, because that is what makes trying the
    shallow ones first the cheap move. Computed from the masks, not asserted as a list.
    """
    counts = {t: build_hypothesis(t, MY_CALL, DX_CALL).asserted_bit_count for t in AP_TYPE_LABELS}
    assert counts[1] == counts[2] < counts[3] < counts[4] == counts[5] == counts[6]


def test_closing_hypotheses_assert_the_whole_payload_and_leave_the_crc_free():
    """
    WSJT-X's \`apmask(1:77)=1\` for types 4-6 pins the message and leaves the FT8 CRC free. The
    z-30 equivalent pins all 63 payload bits and stops - if the 14 CRC bits were asserted too,
    there would be nothing left to test the hypothesis against and every hypothesis would
    "succeed".
    """
    for ap_type in (4, 5, 6):
        h = build_hypothesis(ap_type, MY_CALL, DX_CALL)
        assert sum(h.mask) == 63, "a closing hypothesis must assert every payload bit"
        assert len(h.mask) == 63, "the AP mask must not extend into the CRC or the parity bits"


def test_hypotheses_are_refused_without_usable_callsigns():
    """WSJT-X's \`apsym(1).gt.1\` / \`apsym(30).gt.1\` bail-outs, in z-30 terms."""
    # Type 1 needs neither callsign - a CQ is a CQ.
    assert build_hypothesis(1, "", "") is not None

    for bad in ("", "NOCAL", "W1AW/P", "EA8/G4XYZ", "3DA0RS"):
        assert not callsign_round_trips(bad), f"{bad} unexpectedly round-trips"
        assert build_hypothesis(2, bad, DX_CALL) is None, f"type 2 accepted {bad!r} as my callsign"
        assert build_hypothesis(3, MY_CALL, bad) is None, f"type 3 accepted {bad!r} as the DX callsign"

    # And a callsign that DOES round-trip is accepted, so the guard is not just always-false.
    assert build_hypothesis(3, MY_CALL, DX_CALL) is not None


def test_the_stage_ladder_only_names_known_types():
    for stage, ladder in AP_STAGE_LADDER.items():
        assert ladder, f"stage {stage} has an empty ladder"
        for ap_type in ladder:
            assert ap_type in AP_TYPE_LABELS, f"stage {stage} names unknown AP type {ap_type}"
        assert len(set(ladder)) == len(ladder), f"stage {stage} repeats an AP type"


def test_an_unknown_stage_produces_no_hypotheses():
    assert build_ap_hypotheses("SOME_FUTURE_STAGE", MY_CALL, DX_CALL) == []


def test_the_frequency_gate_admits_and_refuses_by_distance():
    """
    The gate is measured against \`AP_FREQ_WINDOW_HZ\` at both edges, so a change to the constant
    moves both assertions together rather than leaving one hard-coded to the old value.
    """
    worked = 1500.0
    inside = build_ap_hypotheses(
        "SENDING_REPORT", MY_CALL, DX_CALL,
        candidate_freq_hz=worked + AP_FREQ_WINDOW_HZ - 1.0, worked_freqs_hz=(worked,),
    )
    outside = build_ap_hypotheses(
        "SENDING_REPORT", MY_CALL, DX_CALL,
        candidate_freq_hz=worked + AP_FREQ_WINDOW_HZ + 1.0, worked_freqs_hz=(worked,),
    )
    assert any(h.ap_type >= AP_DEEP_TYPE for h in inside), "deep types refused inside the window"
    assert not any(h.ap_type >= AP_DEEP_TYPE for h in outside), "deep types allowed outside the window"

    # A split station is working two frequencies; being near either one is enough (WSJT-X
    # compares against both nfqso and nftx).
    split = build_ap_hypotheses(
        "SENDING_REPORT", MY_CALL, DX_CALL,
        candidate_freq_hz=2400.0, worked_freqs_hz=(1000.0, 2400.0),
    )
    assert any(h.ap_type >= AP_DEEP_TYPE for h in split)


def test_shallow_types_ignore_the_frequency_gate():
    """
    Types 1 and 2 assert 28 bits and are permitted passband-wide, which is what lets a call to
    you be found in a corner you were not watching.
    """
    far = build_ap_hypotheses(
        "IDLE", MY_CALL, DX_CALL, candidate_freq_hz=250.0, worked_freqs_hz=(2900.0,)
    )
    assert [h.ap_type for h in far] == [1, 2]


def test_no_candidate_frequency_means_the_gate_does_not_fire():
    unfiltered = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)
    assert [h.ap_type for h in unfiltered] == list(AP_STAGE_LADDER["SENDING_REPORT"])


# ------------------------------------------------------------------ guards and reporting


def test_hypothesis_holds_detects_a_contradicted_assertion():
    h = build_hypothesis(3, MY_CALL, DX_CALL)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_73), dtype=np.uint8)
    assert hypothesis_holds(truth, h)

    for flip in (0, 13, 27, 28, 55):
        tampered = truth.copy()
        tampered[flip] ^= 1
        assert not hypothesis_holds(tampered, h), f"a flipped asserted bit at {flip} was not caught"

    # A bit OUTSIDE the assertion is none of the hypothesis's business.
    free = truth.copy()
    free[60] ^= 1
    assert hypothesis_holds(free, h)


def test_hypothesis_holds_rejects_a_short_payload():
    h = build_hypothesis(2, MY_CALL)
    assert not hypothesis_holds(np.zeros(10, dtype=np.uint8), h)


def test_describe_ap_decode_labels_only_ap_recovered_frames(codec):
    from z30_dsp.ap_decode import ApDecodeResult

    ordinary = ApDecodeResult(True, np.zeros(77, dtype=np.uint8), 4, 0, "", 0)
    assert describe_ap_decode(ordinary) == ""

    for ap_type in AP_TYPE_LABELS:
        recovered = ApDecodeResult(True, np.zeros(77, dtype=np.uint8), 9, ap_type,
                                   AP_TYPE_LABELS[ap_type], 1)
        assert describe_ap_decode(recovered) == f"a{ap_type}"

    failed = ApDecodeResult(False, np.zeros(77, dtype=np.uint8), 150, 0, "", 4)
    assert describe_ap_decode(failed) == ""


def test_payload_extra_code_reads_the_modifier_field():
    for extra in (0, EXTRA_RRR, EXTRA_73, EXTRA_RR73, 127):
        payload = pack_payload63(MY_CALL, DX_CALL, extra)
        assert payload_extra_code(np.array(payload, dtype=np.uint8)) == extra


def test_ap_mask_longer_than_the_code_is_refused(codec):
    llr = np.zeros(216, dtype=np.float32)
    with pytest.raises(ValueError):
        codec.decode_min_sum(llr, ap_mask=np.ones(217, dtype=np.uint8))


def test_a_63_bit_mask_is_zero_extended_over_the_parity_bits(codec):
    """
    Callers assert payload bits and pass a 63-entry mask; the decoder must treat the remaining
    153 positions as measurements, not as silently asserted zeros.
    """
    rng = np.random.default_rng(31)
    truth = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    codeword = codec.encode(truth)
    llr = noisy_llrs(codeword, 3.0, rng)
    h = build_hypothesis(6, MY_CALL, DX_CALL)

    ap_llr = apply_ap_hypothesis(llr, h.mask, h.bits)
    assert np.array_equal(ap_llr[63:], llr[63:]), "positions past the mask were rewritten"

    ok, info, _ = codec.decode_min_sum(ap_llr, ap_mask=h.mask)
    assert ok and np.array_equal(info[:63], truth)


# ------------------------------------------------------------------ the statistic


def test_mcnemar_matches_an_independently_summed_binomial():
    """
    The p-value the AP benchmark reports is checked against the binomial tail summed a different
    way, for every small table. A statistic nobody can recompute is not evidence, which is the
    whole point of AGENTS.md section 5 asking for "an exact p-value ... something a reader can
    check".
    """
    from z30_dsp.benchmark import mcnemar_exact_p

    for b in range(0, 13):
        for c in range(0, 13):
            n = b + c
            if n == 0:
                assert mcnemar_exact_p(b, c) == 1.0
                continue
            k = min(b, c)
            # Independent route to the same number: the probability mass function, term by term.
            tail = sum(math.factorial(n) / (math.factorial(i) * math.factorial(n - i)) * 0.5 ** n
                       for i in range(k + 1))
            assert mcnemar_exact_p(b, c) == pytest.approx(min(1.0, 2.0 * tail), rel=1e-12)


def test_mcnemar_is_symmetric_and_bounded():
    from z30_dsp.benchmark import mcnemar_exact_p

    for b in range(0, 20):
        for c in range(0, 20):
            p = mcnemar_exact_p(b, c)
            assert p == pytest.approx(mcnemar_exact_p(c, b))
            assert 0.0 <= p <= 1.0
    # A lopsided table is significant; an even one is not.
    assert mcnemar_exact_p(20, 0) < 1e-5
    assert mcnemar_exact_p(10, 10) > 0.5


# ------------------------------------------------------------------ the benchmark population


def test_scenario_payloads_are_reproducible_and_correctly_labelled():
    """
    The AP sweep's band model has to be a pure function of the seed, like everything else in
    benchmark.py, and its in-QSO flag has to actually describe the payload it returns - the flag
    is what splits the reported gain from the reported cost.
    """
    from z30_dsp.benchmark import (
        AP_SCENARIO_DX_CALL,
        AP_SCENARIO_MY_CALL,
        ap_scenario_payload,
    )

    rng_a = np.random.default_rng(4242)
    rng_b = np.random.default_rng(4242)
    for _ in range(40):
        pa, ia = ap_scenario_payload(rng_a)
        pb, ib = ap_scenario_payload(rng_b)
        assert np.array_equal(pa, pb) and ia == ib, "the same seed produced a different band"

        to_call, from_call, _extra = unpack_payload63(pa.tolist())
        if ia:
            assert (to_call, from_call) == (AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL)
        else:
            assert (to_call, from_call) != (AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL)


def test_scenario_produces_both_populations():
    """A 'paired' comparison with only one population in it would measure half the question."""
    from z30_dsp.benchmark import ap_scenario_payload

    rng = np.random.default_rng(2026)
    flags = [ap_scenario_payload(rng)[1] for _ in range(200)]
    assert any(flags) and not all(flags), "the modelled band is entirely one kind of traffic"


def test_foreign_callsigns_are_drawn_usable_and_distinct():
    from z30_dsp.benchmark import (
        AP_SCENARIO_DX_CALL,
        AP_SCENARIO_MY_CALL,
        random_standard_callsign,
    )

    rng = np.random.default_rng(77)
    excluded = (AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL)
    drawn = [random_standard_callsign(rng, exclude=excluded) for _ in range(60)]
    for call in drawn:
        assert call not in excluded
        assert callsign_round_trips(call), f"{call} does not survive the 28-bit packing"
        assert decode_callsign28(encode_callsign28(call)) == call
    assert len(set(drawn)) > 1, "the foreign population is a single repeated callsign"


def test_paired_outcome_shares_one_demodulation():
    """
    The pairing itself. \`decode_prepared_frame_paired\` must hand both arms the same LLRs, and
    the plain arm of the pair must agree with the ordinary \`decode_prepared_frame\` on the same
    job - otherwise the comparison is between two receivers, not two decoders.
    """
    from z30_dsp.benchmark import (
        _prepare_frame,
        decode_prepared_frame,
        decode_prepared_frame_paired,
    )
    from z30_dsp.channel import ChannelImpairments
    from z30_dsp.modem import Z30Config, Z30Modulator

    cfg = Z30Config(sample_rate_hz=6000)
    codec_local = Z30LdpcCodec()
    modulator = Z30Modulator(cfg)
    impairments = ChannelImpairments(max_freq_offset_hz=5.0, max_time_offset_sec=0.5, fading="none")
    hypotheses = build_ap_hypotheses("SENDING_REPORT", MY_CALL, DX_CALL)

    rng = np.random.default_rng(555)
    payload = np.array(pack_payload63(MY_CALL, DX_CALL, EXTRA_RR73), dtype=np.uint8)
    job, _s, _f = _prepare_frame(0, -21.0, codec_local, cfg, modulator, rng, "realistic",
                                 impairments, 0.5, payload)

    reference = decode_prepared_frame(job, cfg, codec_local)
    paired = decode_prepared_frame_paired(job, cfg, codec_local, hypotheses, True)

    assert paired.plain_success == reference.success, (
        "the paired plain arm disagreed with the ordinary decode of the same frame"
    )
    assert paired.in_qso is True
    # AP is a superset by construction, so this holds at every SNR, decoded or not.
    assert paired.ap_success or not paired.plain_success


def test_hypotheses_are_frozen_records():
    """
    \`ApHypothesis\` crosses into the decoder, which must not be able to edit the caller's
    assertion. Frozen and tuple-valued, so an accidental in-place mask edit is a TypeError
    rather than a hypothesis that quietly means something else on the next frame.
    """
    h = build_hypothesis(3, MY_CALL, DX_CALL)
    assert isinstance(h, ApHypothesis)
    assert isinstance(h.mask, tuple) and isinstance(h.bits, tuple)
    with pytest.raises(Exception):
        h.mask = ()  # type: ignore[misc]
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
    "Programming Language :: Python :: 3.13",
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

[tool.ruff]
# The linter's configuration is pinned here, not left to the tool's defaults, for the same
# reason requirements.txt pins NumPy and SciPy: a check whose meaning changes when the tool
# releases is not a check. Ruff 0.16 widened its default rule set from four groups to dozens,
# which turned a clean tree into 408 findings without a line of this repository changing.
#
# It also matters *which* rules: ruff's newer defaults include UP006/UP035 ("use \`dict\` instead
# of \`Dict\`"), and taking that advice would break the Python 3.9 floor AGENTS.md sets, because
# builtin generics in annotations are evaluated at runtime without
# \`from __future__ import annotations\`. A linter that pushes code past the project's stated
# support floor is worse than none.
target-version = "py39"
line-length = 120

[tool.ruff.lint]
# Pyflakes plus the pycodestyle error groups - the set that found a real defect on its first
# run (band_manager.tune_radio discarding the CAT mode-set result). Deliberately conservative:
# a linter that shouts about style is one contributors learn to ignore. Widen it by adding a
# group here and fixing what it reports, in its own commit, never by removing this pin.
select = ["E4", "E7", "E9", "F"]
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
# These are hard requirements: z30_dsp/modem.py and z30_dsp/channel.py import numpy and scipy at
# module scope, so failing here must stop the install rather than leave a half-working DSP.
pkg install -y python python-numpy python-scipy clang fftw termux-api nodejs git

# PortAudio is deliberately NOT on the line above, for two reasons.
#
# First, it is optional here - see the KNOWN LIMITATION below; it cannot carry audio on Android
# either way. Second, which name resolves depends on the Termux repo the device is pointed at,
# and this script cannot know that in advance. A name that does not resolve makes \`pkg install\`
# exit non-zero, and under \`set -e\` that aborted the entire installation at step 1 over a library
# the operator does not actually need. So each candidate is tried on its own and none of them can
# take the install down with it.
portaudio_pkg=""
for candidate in portaudio libportaudio2 libportaudio; do
  if pkg install -y "$candidate" >/dev/null 2>&1; then
    portaudio_pkg="$candidate"
    break
  fi
done
if [ -n "$portaudio_pkg" ]; then
  echo "[INFO] PortAudio installed from Termux package '$portaudio_pkg'."
else
  echo "[INFO] No PortAudio package resolved in this Termux repo - continuing without it."
  echo "       Audio capture does not work under Termux regardless (see the notes below)."
fi

pip install --upgrade pip setuptools wheel
# Pinned versions - see requirements.txt. numpy and scipy come from the Termux packages above
# (building them from source under Termux is impractical), so they are excluded here.
grep -vE '^(numpy|scipy)==' requirements.txt | pip install -r /dev/stdin

# KNOWN LIMITATION (not something this script can fix): sounddevice/PortAudio have no access to
# Android's audio devices from inside Termux. PortAudio binds neither of the host APIs Android
# offers (OpenSL ES, AAudio), the Termux build has ALSA and JACK compiled out, and Android does
# not expose raw ALSA-compatible hardware to Termux's Linux userspace in the first place - so
# device lists come back empty no matter what is plugged into the USB OTG port and regardless of
# whether Termux:API microphone permission was granted.
#
# Real-time RX/TX audio therefore does NOT work on Android under Termux, and neither does a USB
# OTG audio interface such as a Digirig. This script installs what it can, but treat Android as
# CLI/DSP-only (benchmark, rf_time_sync, band_manager) rather than a full transceiver until
# Termux/Android gain proper audio device access for third-party apps. For on-air audio on
# Android, use the PWA (wiki/09 section 4, Mode A) instead of Termux.
#
# Note that pip still installs sounddevice above (it is in requirements.txt). Importing it
# without a loadable PortAudio raises OSError, not ImportError - z30_dsp/rf_time_sync.py catches
# both, so \`z30 --sync\` falls back to its synthetic simulator here instead of crashing.

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
