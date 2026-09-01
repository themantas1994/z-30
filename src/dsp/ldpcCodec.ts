/**
 * z-30 Systematic Irregular Repeat-Accumulate (IRA) LDPC Codec
 * =============================================================
 * 
 * Mathematical Specification & Design Rationale:
 * 
 * 1. Code Rate & Dimension Parameters:
 *    - Code length (n) = 216 channel coded bits
 *    - Information block length (k) = 77 bits (63 payload bits + 14-bit CRC)
 *    - Parity check equations (m = n - k) = 139 checks
 *    - Code Rate R = 77 / 216 ≈ 0.3564. Against an idealised AWGN channel with perfect
 *      synchronisation, the seeded benchmark crosses 50% decode near -24.6 dB SNR and 90% near
 *      -23.4 dB (2500 Hz reference bandwidth). That is a bound on the code under ideal
 *      detection, not an over-the-air threshold - see z30_dsp/benchmark.py.
 *    - Modulation Symbol Mapping: 216 coded bits / (4 bits/symbol) = 54 data symbols in 16-MFSK.
 *      With 21 Costas synchronization symbols, total frame length = 75 symbols (24.0s duration at Ts=320ms).
 * 
 * 2. Parity Check Matrix H Structure:
 *    H = [ H_info (139 x 77) | H_parity (139 x 139) ]
 *    - H_info: Sparse binary matrix where each check node is connected to 5 information bits (Degree-5).
 *      Variable node degree distribution averages d_v ≈ 9.03, providing rapid belief propagation convergence.
 *    - H_parity: Dual-diagonal bidiagonal staircase matrix (IRA structure):
 *        H_parity[p, p] = 1 for all 0 <= p < 139
 *        H_parity[p, p-1] = 1 for all 1 <= p < 139
 * 
 * 3. Systematic Linear-Time O(n) Encoder Algorithm:
 *    Because of the dual-diagonal accumulator structure in H_parity, parity bits are solved via forward substitution:
 *      p_0 = sum_{j in N(0)} u_j  (mod 2)
 *      p_i = p_{i-1} ^ (sum_{j in N(i)} u_j)  (mod 2)  for i = 1, ..., 138
 *    This allows zero-latency encoding without computing or storing a dense generator matrix G.
 * 
 * 4. Error Detection (CRC-14):
 *    Generator polynomial, as implemented: g(x) = x^14 + x^13 + x^10 + x^6 + x + 1.
 *    Register constant 0x2443 (the low 14 coefficients; x^14 is implicit), Init 0x2757,
 *    MSB-first. This comment, its counterpart in z30_dsp/ldpc.py, and the README previously
 *    stated "x^14 + x^11 + x^2 + 1" - a different polynomial (register constant 0x0805). Both
 *    shipped implementations agreed with each other so nothing broke, but a third
 *    implementation written from that specification would have failed against both.
 *    Undetected frame error probability P_ue ~= 2^-14 = 6.1e-5 for random errors.
 * 
 * 5. Vectorized Normalized Min-Sum Belief Propagation Decoder:
 *    - Check node update: L_{c->v} = alpha * prod(sign(L_{v'->c})) * min_{v' != v}(|L_{v'->c}|)
 *      where alpha is the schedule's own empirical normalization factor mitigating check
 *      over-estimation - see Z30_DECODE_SCHEDULES; there is no single alpha for the decoder.
 *    - Variable node update: L_{v->c} = L_{ch, v} + sum_{c' != c} L_{c'->v}
 *    - Total aposteriori LLR: L_total(v) = L_{ch, v} + sum_{all c} L_{c->v}
 *    - Early termination when syndrome s = H * c^T == 0 (mod 2) and CRC passes.
 */

import { LdpcCodeParameters } from '../types/z30';
import { Z30_CHECK_TO_INFO } from './z30Constants';

export const Z30_LDPC_PARAMS: LdpcCodeParameters = {
  n: 216,
  k: 77,
  m: 139,
  rate: 77 / 216,
  crcBits: 14,
  modulationAlphabet: 16,
  dataSymbols: 54,
  syncSymbols: 21,
  totalSymbols: 75,
};

/**
 * The four decode schedules `decodeMinSum` runs, in order, stopping at the first that produces
 * a codeword whose syndrome is zero and whose CRC-14 matches.
 *
 * Exported because the Specs modal has to describe the decoder, and there is no single alpha
 * to describe it with. `Z30_LDPC_PARAMS` used to carry `alphaMinSum: 0.75`, wiki/04 documented
 * that one figure, and the modal rendered it - while the decoder applied the four alphas below
 * and had never applied 0.75 at all. The benchmark modal even offered an input box for it. The
 * cure for a constant that no longer describes the code is to export the thing that does.
 *
 * The twin of `DECODE_SCHEDULES` in z30_dsp/ldpc.py, asserted equal by
 * tests/test_cross_language_parity.py.
 */
export interface LdpcDecodeSchedule {
  /** 'NMS' normalized min-sum, 'SPA' box-plus sum-product, 'DITHER' NMS on perturbed LLRs. */
  readonly mode: 'NMS' | 'SPA' | 'DITHER';
  readonly alpha: number;
  readonly beta: number;
  readonly damping: number;
  /** Check nodes are swept in reverse order, to escape asymmetric cycle traps. */
  readonly reverse: boolean;
  readonly iters: number;
}

export const Z30_DECODE_SCHEDULES: readonly LdpcDecodeSchedule[] = [
  { mode: 'NMS', alpha: 0.82, beta: 0.08, damping: 0.88, reverse: false, iters: 45 },
  { mode: 'SPA', alpha: 0.95, beta: 0.0, damping: 0.85, reverse: false, iters: 40 },
  { mode: 'NMS', alpha: 0.74, beta: 0.04, damping: 0.9, reverse: true, iters: 35 },
  { mode: 'DITHER', alpha: 0.8, beta: 0.06, damping: 0.85, reverse: false, iters: 30 },
];

/**
 * Default iteration ceiling for the min-sum decoder, and the number the UI must quote.
 *
 * It is the default of `decodeMinSum` below and of the Python decoder (`z30_dsp/ldpc.py`).
 * Exported so that prose reads it instead of retyping it: SpecsModal said "up to 50
 * iterations" while both implementations have always stopped at 45.
 */
export const LDPC_MAX_ITERATIONS = 45;

export interface LdpcEncodeResult {
  infoBits: number[]; // 77 bits
  payloadBits: number[]; // 63 bits
  crc14: number; // 14-bit integer
  crcBits: number[]; // 14 bits
  parityBits: number[]; // 139 bits
  codeword: number[]; // 216 bits
  syndrome: number[]; // 139 bits (should be all 0)
  isValidCodeword: boolean;
}

export interface LdpcDecodeResult {
  success: boolean;
  infoBits: number[];
  codeword: number[];
  iterations: number;
  syndromeWeight: number;
  crcValid: boolean;
  bitErrorsCorrected: number;
  iterationHistory: Array<{
    iteration: number;
    syndromeWeight: number;
    hardErrorCount: number;
    avgLlrMagnitude: number;
  }>;
}

/**
 * Peak-to-peak amplitude of the LLR perturbation applied by decode schedule 4 ("DITHER").
 * The twin of `DITHER_AMPLITUDE` in z30_dsp/ldpc.py; pinned by tests/crc14.test.mjs.
 */
export const DITHER_AMPLITUDE = 0.45;

/**
 * Derives a 32-bit seed from the channel LLRs themselves (FNV-1a over 1/64-LLR quanta).
 *
 * Schedule 4 perturbs the channel LLRs to break the symmetric trapping sets a deterministic
 * schedule stalls on. That perturbation used to come from `Math.random()`, so the decoder was
 * not a function of its input: two runs of the benchmark at the identical seed could decode a
 * different set of frames, precisely among the near-threshold frames the benchmark exists to
 * characterise. AGENTS.md's determinism invariant says `Math.random()` does not belong in that
 * path.
 *
 * Handing the engine's seeded `RandomSource` in from the benchmark would fix the benchmark and
 * nothing else: `decodeMinSum` is also called by sicDecoder.ts and realReceiver.ts, where
 * there is no seed to hand it, and a frame captured off the air still has to decode the same
 * way twice. Deriving the seed from the input instead makes the decoder a pure function
 * everywhere - the same LLRs always give the same answer, in isolation, in any caller, in
 * either language. The perturbation only has to be uncorrelated with the code's structure, not
 * unpredictable, so nothing is lost by making it reproducible.
 *
 * Quantising to 1/64 before hashing keeps the derivation on integers, so TypeScript and Python
 * agree bit for bit; `Math.floor(x * 64 + 0.5)` rather than `Math.round()` because Python
 * rounds halves to even and JavaScript rounds them up.
 */
export function ditherSeedFromLlrs(llrChannel: Float32Array | number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < llrChannel.length; i++) {
    const quantum = Math.floor(llrChannel[i] * 64.0 + 0.5) >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      h = (h ^ ((quantum >>> shift) & 0xff)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/**
 * The schedule-4 LLR perturbation for `llrChannel`: `length` values in +/-DITHER_AMPLITUDE/2.
 *
 * mulberry32, the generator of src/dsp/seededRandom.ts, reproduced in z30_dsp/ldpc.py in
 * unsigned 32-bit arithmetic so that both languages emit an identical sequence.
 */
export function ditherVector(llrChannel: Float32Array | number[], length: number): Float64Array {
  let state = ditherSeedFromLlrs(llrChannel) || 0x9e3779b9;
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * DITHER_AMPLITUDE;
  }
  return out;
}

export class Z30LdpcEngine {
  private readonly n = Z30_LDPC_PARAMS.n;
  private readonly k = Z30_LDPC_PARAMS.k;
  private readonly m = Z30_LDPC_PARAMS.m;
  // The min-sum normalisation factor is not a single constant: decodeMinSum() runs the four
  // schedules of Z30_DECODE_SCHEDULES, each with its own alpha (0.74 to 0.95).

  // Parity check matrix sparse graph representation
  // checkToVarEdges[c] = array of variable node indices connected to check c
  private checkToVarEdges: number[][] = [];
  // varToCheckEdges[v] = array of check node indices connected to variable v
  private varToCheckEdges: number[][] = [];
  // Dense matrix for visualization & syndrome check
  private H_matrix: Uint8Array[];

  constructor() {
    this.H_matrix = this.buildParityCheckMatrix();
  }

  /**
   * Constructs the (139 x 216) IRA parity check matrix H with Girth-6 structure.
   * 
   * Graph Topology:
   * - Check Nodes: M = 139
   * - Variable Nodes: N = 216 (77 information bits + 139 parity accumulator bits)
   * - Adjacency: checkToVarEdges and varToCheckEdges arrays store sparse edge connectivity.
   * 
   * @returns Dense 2D byte array representation for matrix analysis and visualization
   */
  private buildParityCheckMatrix(): Uint8Array[] {
    const H: Uint8Array[] = Array.from({ length: this.m }, () => new Uint8Array(this.n));
    this.checkToVarEdges = Array.from({ length: this.m }, () => []);
    this.varToCheckEdges = Array.from({ length: this.n }, () => []);

    for (let p = 0; p < this.m; p++) {
      // 1. Information bit connections from Girth-6 (0 4-cycles) table
      const infoVars = Z30_CHECK_TO_INFO[p] || [];
      for (const infoIdx of infoVars) {
        H[p][infoIdx] = 1;
        this.checkToVarEdges[p].push(infoIdx);
        this.varToCheckEdges[infoIdx].push(p);
      }

      // 2. Dual-diagonal parity accumulator connections
      const parityCol1 = this.k + p;
      H[p][parityCol1] = 1;
      this.checkToVarEdges[p].push(parityCol1);
      this.varToCheckEdges[parityCol1].push(p);

      if (p > 0) {
        const parityCol0 = this.k + p - 1;
        H[p][parityCol0] = 1;
        this.checkToVarEdges[p].push(parityCol0);
        this.varToCheckEdges[parityCol0].push(p);
      }
    }

    return H;
  }

  /**
   * Retrieves the full 139 x 216 binary parity-check matrix H.
   * 
   * @returns 2D array of Uint8Arrays representing H
   */
  public getParityCheckMatrix(): Uint8Array[] {
    return this.H_matrix;
  }

  /**
   * 14-bit CRC computation for 63-bit amateur payload.
   * Polynomial: g(x) = x^14 + x^13 + x^10 + x^6 + x + 1 (register constant 0x2443, x^14 implicit; Init 0x2757)
   *
   * A second copy of the same register/init/poly math as z30Codec.computeCrc14 - not merged
   * into one function, because tests/test_cross_language_parity.py::test_crc_constants_match
   * greps this file for the literal `const poly = 0x2443` / `let crc = 0x2757` as its
   * TypeScript-side half of the Python/TypeScript CRC parity pin, and a delegating version
   * (correct, and verified byte-identical against the shared vectors) makes that grep fail by
   * having nowhere to find the literal. AGENTS.md section 4 lists CRC-14 as protected precisely
   * so a change like that is wrong rather than a test to loosen. The two copies were checked
   * against the shared `tests/vectors/crc14_vectors.json` KAT vectors and agree bit-for-bit.
   *
   * @param bits - Array or TypedArray of binary payload bits
   * @returns 14-bit integer CRC checksum (0x0000 to 0x3FFF)
   */
  public computeCrc14(bits: number[] | Uint8Array): number {
    let crc = 0x2757;
    const poly = 0x2443;
    const len = Math.min(63, bits.length);
    for (let i = 0; i < len; i++) {
      const msb = (crc >> 13) & 1;
      crc = ((crc << 1) & 0x3fff) ^ (msb ^ (bits[i] & 1) ? poly : 0);
    }
    return crc & 0x3fff;
  }

  /**
   * Systematic IRA LDPC Encoder.
   * Encodes 63 payload bits (or 77 info bits including CRC) into 216-bit codeword.
   * 
   * @param payloadBits63 - 63-bit user information bit array
   * @returns Complete encoding breakdown including CRC, parity bits, and codeword
   */
  public encode(payloadBits63: number[]): LdpcEncodeResult {
    // 1. Pack 63 bits
    const payload = new Array(63).fill(0);
    for (let i = 0; i < Math.min(63, payloadBits63.length); i++) {
      payload[i] = payloadBits63[i] ? 1 : 0;
    }

    // 2. Compute 14-bit CRC
    const crc = this.computeCrc14(payload);
    const crcBits: number[] = [];
    for (let i = 13; i >= 0; i--) {
      crcBits.push((crc >> i) & 1);
    }

    // 3. Assemble 77 info bits
    const infoBits = [...payload, ...crcBits];

    // 4. Generate 139 parity bits using IRA Accumulator over Girth-6 edges
    const parityBits = new Array(this.m).fill(0);
    for (let p = 0; p < this.m; p++) {
      let sum = 0;
      const infoVars = Z30_CHECK_TO_INFO[p] || [];
      for (const infoIdx of infoVars) {
        sum ^= infoBits[infoIdx] || 0;
      }
      if (p > 0) {
        sum ^= parityBits[p - 1];
      }
      parityBits[p] = sum;
    }

    const codeword = [...infoBits, ...parityBits];
    const syndrome = this.computeSyndrome(codeword);
    const isValidCodeword = syndrome.every((s) => s === 0);

    return {
      infoBits,
      payloadBits: payload,
      crc14: crc,
      crcBits,
      parityBits,
      codeword,
      syndrome,
      isValidCodeword,
    };
  }

  /**
   * Computes parity check syndrome vector s = H * c^T (mod 2).
   * 
   * @param codeword - 216-bit candidate binary vector
   * @returns 139-element syndrome vector (all zeros indicates valid codeword)
   */
  public computeSyndrome(codeword: number[] | Uint8Array): number[] {
    const s = new Array(this.m).fill(0);
    for (let p = 0; p < this.m; p++) {
      let sum = 0;
      const edges = this.checkToVarEdges[p];
      for (let i = 0; i < edges.length; i++) {
        sum ^= codeword[edges[i]] || 0;
      }
      s[p] = sum;
    }
    return s;
  }

  /**
   * Fast Trellis-IRA Parity Reconstruction.
   * Re-accumulates all 139 parity bits from 77 information bits in linear time O(m).
   * 
   * @param infoBits77 - 77-element array of information + CRC bits
   * @returns 216-element valid systematic IRA codeword
   */
  public reaccumulateIraCodeword(infoBits77: number[] | Uint8Array): number[] {
    const codeword = new Array(this.n).fill(0);
    for (let i = 0; i < this.k; i++) {
      codeword[i] = infoBits77[i] & 1;
    }
    for (let p = 0; p < this.m; p++) {
      let sum = 0;
      const infoVars = Z30_CHECK_TO_INFO[p] || [];
      for (let i = 0; i < infoVars.length; i++) {
        sum ^= codeword[infoVars[i]];
      }
      if (p > 0) {
        sum ^= codeword[this.k + p - 1];
      }
      codeword[this.k + p] = sum;
    }
    return codeword;
  }

  /**
   * Exact Box-Plus (Jacobian Logarithm) check node function.
   * 
   * Mathematical Definition:
   * f(x, y) = ln((1 + e^(x+y)) / (e^x + e^y))
   *         = sgn(x)*sgn(y)*min(|x|,|y|) + ln(1 + e^-|x+y|) - ln(1 + e^-|x-y|)
   * 
   * @param x - LLR incoming from variable node 1
   * @param y - LLR incoming from variable node 2
   * @returns Combined parity check LLR
   */
  private boxPlus(x: number, y: number): number {
    const signX = x >= 0 ? 1.0 : -1.0;
    const signY = y >= 0 ? 1.0 : -1.0;
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const minVal = Math.min(absX, absY);
    const signProd = signX * signY;

    // Jacobian correction terms
    const diffSum = Math.abs(x + y);
    const diffDiff = Math.abs(x - y);
    const corrSum = diffSum < 30 ? Math.log1p(Math.exp(-diffSum)) : 0;
    const corrDiff = diffDiff < 30 ? Math.log1p(Math.exp(-diffDiff)) : 0;

    return signProd * minVal + corrSum - corrDiff;
  }

  /**
   * Ultra-Sensitive Multi-Schedule Damped Log-SPA & Layered Normalized Min-Sum LDPC Decoder.
   * 
   * Algorithmic Architecture:
   * 1. Check direct hard decisions for instant zero-iteration decode.
   * 2. Schedule 1: Layered Damped Normalized Min-Sum (fast convergence, alpha=0.82, beta=0.08).
   * 3. Schedule 2: Full Log-SPA with Jacobian correction for deep sub-noise decode.
   * 4. Schedule 3: Reverse-order Layering to escape asymmetric cycle traps.
   * 5. Schedule 4: Dithered Stochastic Resonance injection to resolve symmetric pseudocodewords.
   * 6. Post-Processing: CRC-14-Constrained Ordered Statistics Decoding (OSD-2 / Chase reliability search).
   * 
   * @param llrChannel - Array or Float32Array of 216 channel soft LLRs (L = ln(P(c=0)/P(c=1)))
   * @param maxIterations - Maximum iterative message-passing steps per pass
   * @returns Complete decoding result with success flag, payload, syndrome, and iteration telemetry
   */
  public decodeMinSum(
    llrChannel: Float32Array | number[],
    maxIterations: number = LDPC_MAX_ITERATIONS
  ): LdpcDecodeResult {
    const inputLlr = Float32Array.from(llrChannel);
    const iterationHistory: LdpcDecodeResult['iterationHistory'] = [];

    let initialErrorCount = 0;
    for (let i = 0; i < this.n; i++) {
      if (inputLlr[i] < 0) initialErrorCount++;
    }

    // 1. Check if raw channel hard decisions already form a valid codeword
    {
      const rawHard = new Array(this.n);
      for (let v = 0; v < this.n; v++) rawHard[v] = inputLlr[v] < 0 ? 1 : 0;
      const rawPayload = rawHard.slice(0, 63);
      const rawCrc = rawHard.slice(63, 77).reduce((acc, b) => (acc << 1) | b, 0);
      if (this.computeCrc14(rawPayload) === rawCrc) {
        const rawSyn = this.computeSyndrome(rawHard);
        if (rawSyn.every((s) => s === 0)) {
          return {
            success: true,
            infoBits: rawHard.slice(0, this.k),
            codeword: rawHard,
            iterations: 1,
            syndromeWeight: 0,
            crcValid: true,
            bitErrorsCorrected: 0,
            iterationHistory: [{
              iteration: 1,
              syndromeWeight: 0,
              hardErrorCount: rawHard.slice(0, this.k).reduce((a: number, b: number) => a + b, 0),
              avgLlrMagnitude: 10.0,
            }],
          };
        }
      }
    }

    // Multi-Schedule Decoding Passes:
    // Pass 1: Layered Damped Offset-Normalized Min-Sum (Fast convergence)
    // Pass 2: Exact Log-SPA / Box-Plus Belief Propagation with Jacobian Correction (Ultimate weak SNR)
    // Pass 3: Reversed Layer Schedule with Lower Alpha (Trapping set escape)
    // Pass 4: Noise Dithered Perturbation (Stochastic resonance)
    const passSchedules = Z30_DECODE_SCHEDULES.map((sched) => ({
      ...sched,
      iters: Math.min(sched.iters, maxIterations),
    }));

    let overallBestDecoded = new Array(this.n).fill(0);
    let overallBestSyndromeWeight = 999;
    let totalIterationsRun = 0;
    let bestTotalLlrs = new Float32Array(this.n);

    for (let sIdx = 0; sIdx < passSchedules.length; sIdx++) {
      const sched = passSchedules[sIdx];

      // Total aposteriori LLR array initialized with channel observations
      const totalLlrs = new Float32Array(this.n);
      totalLlrs.set(inputLlr);

      if (sched.mode === 'DITHER') {
        // Perturbation derived from the channel LLRs, not from Math.random() - see
        // ditherVector(). This is what keeps a seeded benchmark run reproducible.
        const dither = ditherVector(inputLlr, this.n);
        for (let i = 0; i < this.n; i++) {
          totalLlrs[i] += dither[i];
        }
      }

      // Check-to-variable message buffers: checkToVarMsg[c][idxInCheck]
      const checkToVarMsg: Float32Array[] = this.checkToVarEdges.map((vars) => new Float32Array(vars.length));

      // Build check node iteration ordering
      const checkOrder = new Int32Array(this.m);
      for (let c = 0; c < this.m; c++) {
        checkOrder[c] = sched.reverse ? this.m - 1 - c : c;
      }

      for (let iter = 1; iter <= sched.iters; iter++) {
        totalIterationsRun++;

        // Layered Schedule: Process check nodes sequentially and update variable beliefs immediately
        for (let idx = 0; idx < this.m; idx++) {
          const c = checkOrder[idx];
          const connectedVars = this.checkToVarEdges[c];
          const numVars = connectedVars.length;

          // Compute incoming variable-to-check messages: L_{v->c} = L_total(v) - L_{c->v}^{old}
          const vToCMsg = new Float32Array(numVars);
          let min1 = 999999.0;
          let min2 = 999999.0;
          let min1Idx = -1;
          let prodSign = 1.0;

          for (let i = 0; i < numVars; i++) {
            const v = connectedVars[i];
            const val = totalLlrs[v] - checkToVarMsg[c][i];
            vToCMsg[i] = val;

            const sign = val >= 0 ? 1.0 : -1.0;
            prodSign *= sign;
            const mag = Math.abs(val);

            if (mag < min1) {
              min2 = min1;
              min1 = mag;
              min1Idx = i;
            } else if (mag < min2) {
              min2 = mag;
            }
          }

          // Check node calculation & instantaneous variable node update
          for (let i = 0; i < numVars; i++) {
            const v = connectedVars[i];
            const val = vToCMsg[i];
            const selfSign = val >= 0 ? 1.0 : -1.0;
            const edgeSign = prodSign * selfSign;
            const minMag = i === min1Idx ? min2 : min1;

            let newCtoV = 0.0;
            if (sched.mode === 'SPA') {
              // Exact Box-Plus check calculation with Jacobian Logarithm
              let boxAcc = 999.0;
              let isFirst = true;
              for (let j = 0; j < numVars; j++) {
                if (j !== i) {
                  if (isFirst) {
                    boxAcc = vToCMsg[j];
                    isFirst = false;
                  } else {
                    boxAcc = this.boxPlus(boxAcc, vToCMsg[j]);
                  }
                }
              }
              newCtoV = Math.max(-20.0, Math.min(20.0, sched.alpha * boxAcc));
            } else {
              // Offset-Normalized Min-Sum update
              newCtoV = edgeSign * Math.max(0.0, sched.alpha * minMag - sched.beta);
            }

            // Damped message update: L_{c->v}^{new} = (1-gamma)*L_{c->v}^{old} + gamma*L_{c->v}^{calc}
            const dampedCtoV = (1.0 - sched.damping) * checkToVarMsg[c][i] + sched.damping * newCtoV;
            const diff = dampedCtoV - checkToVarMsg[c][i];
            checkToVarMsg[c][i] = dampedCtoV;

            // Layered update of variable node total LLR
            totalLlrs[v] += diff;
          }
        }

        // Hard decision from total LLRs
        const hardDecision = new Array(this.n);
        let avgLlr = 0;
        for (let v = 0; v < this.n; v++) {
          hardDecision[v] = totalLlrs[v] < 0 ? 1 : 0;
          avgLlr += Math.abs(totalLlrs[v]);
        }
        avgLlr /= this.n;

        // Fast Syndrome Verification
        const syndrome = this.computeSyndrome(hardDecision);
        let synWeight = 0;
        for (let i = 0; i < this.m; i++) {
          if (syndrome[i] !== 0) synWeight++;
        }

        if (synWeight < overallBestSyndromeWeight) {
          overallBestSyndromeWeight = synWeight;
          overallBestDecoded = [...hardDecision];
          bestTotalLlrs.set(totalLlrs);
        }

        // Early stopping condition: zero syndrome and CRC valid
        if (synWeight === 0) {
          const decodedInfo = hardDecision.slice(0, this.k);
          const payload = decodedInfo.slice(0, 63);
          const receivedCrc = decodedInfo.slice(63).reduce((acc, b) => (acc << 1) | b, 0);
          const computedCrc = this.computeCrc14(payload);

          if (computedCrc === receivedCrc) {
            return {
              success: true,
              infoBits: decodedInfo,
              codeword: hardDecision,
              iterations: totalIterationsRun,
              syndromeWeight: 0,
              crcValid: true,
              bitErrorsCorrected: initialErrorCount,
              iterationHistory,
            };
          }
        }

        // Trellis-IRA Parity Check when payload CRC matches received CRC
        const tentativePayload = hardDecision.slice(0, 63);
        const computedCrc = this.computeCrc14(tentativePayload);
        const receivedCrc = hardDecision.slice(63, 77).reduce((acc, b) => (acc << 1) | b, 0);

        if (computedCrc === receivedCrc) {
          const tentativeCrcBits: number[] = [];
          for (let b = 13; b >= 0; b--) tentativeCrcBits.push((computedCrc >> b) & 1);
          const tentativeInfo = [...tentativePayload, ...tentativeCrcBits];
          const iraCodeword = this.reaccumulateIraCodeword(tentativeInfo);
          const iraSyndrome = this.computeSyndrome(iraCodeword);

          if (iraSyndrome.every((s) => s === 0)) {
            // Check correlation with channel observations
            let corr = 0;
            let diffFromHard = 0;
            for (let i = 0; i < this.n; i++) {
              corr += (iraCodeword[i] === 0 ? 1 : -1) * inputLlr[i];
              if (iraCodeword[i] !== hardDecision[i]) diffFromHard++;
            }

            if (corr > 0 && diffFromHard <= 12) {
              return {
                success: true,
                infoBits: tentativeInfo,
                codeword: iraCodeword,
                iterations: totalIterationsRun,
                syndromeWeight: 0,
                crcValid: true,
                bitErrorsCorrected: initialErrorCount,
                iterationHistory,
              };
            }
          }
        }

        iterationHistory.push({
          iteration: totalIterationsRun,
          syndromeWeight: synWeight,
          hardErrorCount: hardDecision.slice(0, this.k).reduce((a: number, b: number) => a + b, 0),
          avgLlrMagnitude: Number(avgLlr.toFixed(2)),
        });
      }

      // If syndrome weight is already 0 or low, check if we found a valid codeword
      if (overallBestSyndromeWeight === 0) {
        const decodedInfo = overallBestDecoded.slice(0, this.k);
        const payload = decodedInfo.slice(0, 63);
        const receivedCrc = decodedInfo.slice(63).reduce((acc, b) => (acc << 1) | b, 0);
        if (this.computeCrc14(payload) === receivedCrc) {
          return {
            success: true,
            infoBits: decodedInfo,
            codeword: overallBestDecoded,
            iterations: totalIterationsRun,
            syndromeWeight: 0,
            crcValid: true,
            bitErrorsCorrected: initialErrorCount,
            iterationHistory,
          };
        }
      }
    }

    // =========================================================================
    // POST-PROCESSING: CRC-14-Constrained Ordered Statistics Decoding (OSD-2 / Chase)
    // =========================================================================
    // When belief propagation terminates near threshold with small residual syndrome (<= 14),
    // OSD tests candidate bit flips on the lowest reliability positions of the 63 payload bits.
    if (overallBestSyndromeWeight <= 14) {
      const llrSource = bestTotalLlrs.length === this.n ? bestTotalLlrs : inputLlr;
      const basePayload = overallBestDecoded.slice(0, 63);

      // Rank 63 payload bit positions by absolute LLR magnitude (reliability)
      const rankedIndices: number[] = [];
      for (let i = 0; i < 63; i++) rankedIndices.push(i);
      rankedIndices.sort((a, b) => Math.abs(llrSource[a]) - Math.abs(llrSource[b]));

      const numLeastReliable = Math.min(14, rankedIndices.length);
      const testIndices = rankedIndices.slice(0, numLeastReliable);

      let bestOsdCandidate: number[] | null = null;
      let maxCorrelation = 0.0;

      const evaluateCandidate = (candidatePayload: number[]) => {
        const crc = this.computeCrc14(candidatePayload);
        const crcBits: number[] = [];
        for (let b = 13; b >= 0; b--) crcBits.push((crc >> b) & 1);
        const info77 = [...candidatePayload, ...crcBits];
        const fullCodeword = this.reaccumulateIraCodeword(info77);

        // Verify syndrome
        const syn = this.computeSyndrome(fullCodeword);
        if (syn.every((s) => s === 0)) {
          // Compute codeword correlation with channel LLRs: sum (1 - 2*c_i) * L_{ch, i}
          let corr = 0;
          let diffCount = 0;
          for (let i = 0; i < this.n; i++) {
            const b = fullCodeword[i];
            corr += (b === 0 ? 1 : -1) * inputLlr[i];
            if (b !== overallBestDecoded[i]) diffCount++;
          }
          // Accept only if correlation exceeds threshold and distance is reasonable
          if (corr > 20.0 && corr > maxCorrelation && diffCount <= 16) {
            maxCorrelation = corr;
            bestOsdCandidate = fullCodeword;
          }
        }
      };

      // Order-0: Test base hard decision
      evaluateCandidate(basePayload);

      // Order-1: Single bit flips on top least reliable positions
      for (let i = 0; i < testIndices.length; i++) {
        const cand = [...basePayload];
        cand[testIndices[i]] ^= 1;
        evaluateCandidate(cand);
      }

      // Order-2: Two bit flips on least reliable pairs
      for (let i = 0; i < testIndices.length; i++) {
        for (let j = i + 1; j < testIndices.length; j++) {
          const cand = [...basePayload];
          cand[testIndices[i]] ^= 1;
          cand[testIndices[j]] ^= 1;
          evaluateCandidate(cand);
        }
      }

      if (bestOsdCandidate) {
        const candidateArr = bestOsdCandidate as number[];
        const decodedInfo = candidateArr.slice(0, this.k);
        const payload = decodedInfo.slice(0, 63);
        const receivedCrc = decodedInfo.slice(63).reduce((acc, b) => (acc << 1) | b, 0);
        if (this.computeCrc14(payload) === receivedCrc) {
          return {
            success: true,
            infoBits: decodedInfo,
            codeword: candidateArr,
            iterations: totalIterationsRun,
            syndromeWeight: 0,
            crcValid: true,
            bitErrorsCorrected: initialErrorCount,
            iterationHistory,
          };
        }
      }
    }

    // Decoder did not converge to valid codeword
    const decodedInfo = overallBestDecoded.slice(0, this.k);
    const payload = decodedInfo.slice(0, 63);
    const receivedCrc = decodedInfo.slice(63).reduce((acc, b) => (acc << 1) | b, 0);
    const computedCrc = this.computeCrc14(payload);

    return {
      success: false,
      infoBits: decodedInfo,
      codeword: overallBestDecoded,
      iterations: totalIterationsRun,
      syndromeWeight: overallBestSyndromeWeight,
      crcValid: computedCrc === receivedCrc,
      bitErrorsCorrected: 0,
      iterationHistory,
    };
  }
}

export const ldpcCodec = new Z30LdpcEngine();
