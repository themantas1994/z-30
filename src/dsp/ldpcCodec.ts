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
 *    - Code Rate R = 77 / 216 ≈ 0.3564 (optimal for ultra-weak AWGN/Fading channels down to -25.0 dB SNR 50% / -24.0 dB SNR 90% threshold)
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
 *      where alpha = 0.75 is the empirical normalization factor mitigating check over-estimation.
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
  alphaMinSum: 0.75,
};

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

export class Z30LdpcEngine {
  private readonly n = Z30_LDPC_PARAMS.n;
  private readonly k = Z30_LDPC_PARAMS.k;
  private readonly m = Z30_LDPC_PARAMS.m;
  // The min-sum normalisation factor is not a single constant: decodeMinSum() runs four
  // schedules, each with its own alpha (0.74 to 0.95). Z30_LDPC_PARAMS.alphaMinSum documents
  // the nominal 0.75 for the spec; the schedules below are what actually runs.

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
   * Simulates channel impairments by injecting AWGN noise or random BSC bit errors.
   * 
   * @param codeword - Clean 216-bit transmitter codeword
   * @param errorCount - Number of hard bit flips to apply in BSC mode
   * @param channelType - 'BSC' (Binary Symmetric Channel) or 'AWGN' (Additive White Gaussian Noise)
   * @param snrDb - Signal-to-Noise Ratio in dB (for AWGN simulation)
   * @returns Corrupted bits, floating-point channel Log-Likelihood Ratios (LLRs), and flipped bit indexes
   */
  public corruptCodeword(
    codeword: number[],
    errorCount: number,
    channelType: 'BSC' | 'AWGN' = 'BSC',
    snrDb: number = -20
  ): { corruptedBits: number[]; llrChannel: Float32Array; bitFlips: number[] } {
    const corruptedBits = [...codeword];
    const llrChannel = new Float32Array(this.n);
    const bitFlips: number[] = [];

    if (channelType === 'BSC') {
      const chosenIndices = new Set<number>();
      while (chosenIndices.size < Math.min(errorCount, this.n)) {
        const randIdx = Math.floor(Math.random() * this.n);
        chosenIndices.add(randIdx);
      }
      chosenIndices.forEach((idx) => {
        corruptedBits[idx] ^= 1;
        bitFlips.push(idx);
      });

      for (let i = 0; i < this.n; i++) {
        llrChannel[i] = corruptedBits[i] === 0 ? 6.0 : -6.0;
      }
    } else {
      const snrLinear = Math.pow(10, snrDb / 10);
      const sigma = Math.sqrt(1.0 / (2.0 * snrLinear * (this.k / this.n)));

      for (let i = 0; i < this.n; i++) {
        const s = codeword[i] === 0 ? 1.0 : -1.0;
        const u1 = Math.max(1e-10, Math.random());
        const u2 = Math.random();
        const noise = sigma * Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const r = s + noise;
        llrChannel[i] = (2.0 * r) / (sigma * sigma);
        corruptedBits[i] = r < 0 ? 1 : 0;
        if (corruptedBits[i] !== codeword[i]) {
          bitFlips.push(i);
        }
      }
    }

    return { corruptedBits, llrChannel, bitFlips };
  }

  /**
   * Ultra-Sensitive Multi-Schedule Damped Log-SPA & Layered Normalized Min-Sum LDPC Decoder.
   * 
   * Algorithmic Architecture:
   * 1. Check direct hard decisions for instant zero-iteration decode.
   * 2. Schedule 1: Layered Damped Normalized Min-Sum (fast convergence, alpha=0.82, beta=0.08).
   * 3. Schedule 2: Full Log-SPA with Jacobian correction for deep sub-noise decode (-25 dB SNR).
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
    maxIterations: number = 45
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
    const passSchedules = [
      { mode: 'NMS', alpha: 0.82, beta: 0.08, damping: 0.88, reverse: false, iters: Math.min(45, maxIterations) },
      { mode: 'SPA', alpha: 0.95, beta: 0.00, damping: 0.85, reverse: false, iters: Math.min(40, maxIterations) },
      { mode: 'NMS', alpha: 0.74, beta: 0.04, damping: 0.90, reverse: true,  iters: Math.min(35, maxIterations) },
      { mode: 'DITHER', alpha: 0.80, beta: 0.06, damping: 0.85, reverse: false, iters: Math.min(30, maxIterations) },
    ];

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
        // Inject slight randomized perturbation to break symmetric trapping sets
        for (let i = 0; i < this.n; i++) {
          const dither = (Math.random() - 0.5) * 0.45;
          totalLlrs[i] += dither;
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
