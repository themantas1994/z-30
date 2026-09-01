/**
 * z-30 Real-Signal Receiver: Candidate Detection, Frequency Acquisition, LLR Demodulation
 * ==========================================================================================
 *
 * This is the genuine over-the-air receive path: it operates on an actually-captured audio
 * buffer (from audioEngine's continuous microphone capture), not on synthetic or self-injected
 * data. It mirrors z30_dsp/sic_decoder.py and z30_dsp/benchmark.py's demodulate_mfsk_llrs
 * exactly (including the fixes below), so both stacks decode identically.
 *
 * Frequency convention: tone0-anchored (toneFreq = baseFreqHz + toneIdx * toneSpacingHz),
 * matching the REAL transmit path in audioEngine.ts:play16MfskSequence and z30_dsp/modem.py -
 * NOT the center-referenced convention used internally by monteCarloEngine.ts's isolated
 * benchmark simulator. Mixing the two conventions between TX and RX silently breaks
 * demodulation (verified while building this module).
 *
 * Continuous-phase FSK carries phase across symbol boundaries. Because toneSpacingHz is
 * exactly 1/symbolDurationSec by construction, the per-symbol phase increment is identical
 * for every tone and depends only on the base frequency - so it's fully predictable and must
 * be added back in when projecting a data symbol's correlator onto a nearby pilot's measured
 * phase. Skipping this (as a first draft of this module did) causes ~20-25% bit errors at any
 * base frequency that isn't an exact multiple of toneSpacingHz, regardless of SNR - the
 * dominant real-world case, since operators tune to arbitrary audio frequencies.
 */

import { Z30_SPECS } from './z30Constants';
import { ldpcCodec } from './ldpcCodec';
import { unpackZ30Message } from './z30Codec';
import { createSeededRandom, type RandomSource } from './seededRandom';

export interface Candidate {
  freqHz: number;
  peakDb: number;
  noiseFloorDb: number;
}

const TONE_SPACING_HZ = Z30_SPECS.TONE_SPACING_HZ;

/**
 * How far above the estimated noise floor a tone group must sit to be tried as a candidate.
 *
 * The twin of `SIC_MIN_PEAK_DB` in z30_dsp/sic_decoder.py, pinned across the two languages by
 * tests/test_cross_language_parity.py. Until that test existed the two sides ran different
 * detectors at different thresholds - raw FFT bins at 8 dB in Python, Bartlett-averaged groups
 * at 6 dB here - and nothing would have caught either drifting further.
 */
export const SIC_MIN_PEAK_DB = 6.0;

/** Most candidates one SIC pass will try, strongest first. Twin of `SIC_MAX_CANDIDATES`. */
export const SIC_MAX_CANDIDATES = 16;
const SYMBOL_DURATION_SEC = Z30_SPECS.SYMBOL_DURATION_SEC;
const SYNC_POSITIONS = Z30_SPECS.SYNC_POSITIONS;
const SYNC_TONES = Z30_SPECS.SYNC_TONES;
const TOTAL_SYMBOLS = Z30_SPECS.TOTAL_SYMBOLS;
const NUM_TONES = Z30_SPECS.NUM_TONES;

function samplesPerSymbolFor(sampleRateHz: number): number {
  return Math.round(sampleRateHz * SYMBOL_DURATION_SEC);
}

/**
 * Synthesizes the exact continuous-phase 16-MFSK replica of a symbol sequence, tone0-anchored.
 * Used both as the SIC cancellation replica and (implicitly, via the modulator's phase model)
 * as the physical basis for the fine-frequency and pilot-amplitude estimators below.
 */
export function synthesizeReplica(symbols: number[], baseFreqHz: number, sampleRateHz: number): Float32Array {
  const samplesPerSymbol = samplesPerSymbolFor(sampleRateHz);
  const dt = 1.0 / sampleRateHz;
  const total = symbols.length * samplesPerSymbol;
  const waveform = new Float32Array(total);

  const rampLen = Math.round(0.008 * sampleRateHz);
  const envelope = new Float32Array(samplesPerSymbol).fill(1.0);
  for (let i = 0; i < rampLen; i++) {
    const taper = 0.5 * (1.0 - Math.cos((Math.PI * i) / rampLen));
    envelope[i] = taper;
    envelope[samplesPerSymbol - 1 - i] = taper;
  }

  let phase = 0.0;
  for (let sIdx = 0; sIdx < symbols.length; sIdx++) {
    const toneFreq = baseFreqHz + symbols[sIdx] * TONE_SPACING_HZ;
    const start = sIdx * samplesPerSymbol;
    for (let n = 0; n < samplesPerSymbol; n++) {
      const instPhase = 2.0 * Math.PI * toneFreq * (n * dt) + phase;
      waveform[start + n] = Math.sin(instPhase) * envelope[n];
    }
    // Carry phase across the symbol boundary (matches Z30Modulator.synthesize_frame).
    const lastLocal = (samplesPerSymbol - 1) * dt;
    phase = (2.0 * Math.PI * toneFreq * lastLocal + phase + 2.0 * Math.PI * toneFreq * dt) % (2.0 * Math.PI);
  }

  let maxAbs = 0;
  for (let i = 0; i < waveform.length; i++) maxAbs = Math.max(maxAbs, Math.abs(waveform[i]));
  if (maxAbs > 0) {
    for (let i = 0; i < waveform.length; i++) waveform[i] /= maxAbs;
  }
  return waveform;
}

/**
 * Real spectral peak detector over an arbitrary captured buffer: windowed FFT-equivalent
 * (Goertzel-free direct DFT magnitude via a real FFT is unnecessary at this resolution - a
 * plain O(N log N) FFT is used), noise floor from the median bin, local-maxima extraction at
 * least minPeakDb above it, deduplicated within one occupied bandwidth of each other.
 */
export function findCandidates(
  buffer: Float32Array,
  sampleRateHz: number,
  minFreqHz: number = 200,
  maxFreqHz: number = 3000,
  minPeakDb: number = SIC_MIN_PEAK_DB,
  maxCandidates: number = SIC_MAX_CANDIDATES
): Candidate[] {
  const n = buffer.length;
  if (n < 64) return [];

  // A zero-padded FFT of a ~24s buffer yields a very fine bin spacing (a small fraction of a
  // Hz) - far finer than needed (we only need to localize energy to within one 16-MFSK comb,
  // i.e. ~toneSpacingHz resolution) and, with that many independent noise bins, a fixed
  // "X dB over the median" threshold produces many spurious peaks by chance (order-statistics
  // of a large sample size). Averaging fine bins into toneSpacingHz-wide groups (a standard
  // periodogram-smoothing / Bartlett's-method step) both matches the resolution we actually
  // need and makes the noise-floor and peak-detection statistics reliable again.
  const { mags, fftSize } = realFftMagnitudes(buffer);
  const fineBinHz = sampleRateHz / fftSize;
  const groupHz = TONE_SPACING_HZ;
  const finePerGroup = Math.max(1, Math.round(groupHz / fineBinHz));

  const groupMinIdx = Math.max(0, Math.floor(minFreqHz / groupHz));
  const groupMaxIdx = Math.floor(maxFreqHz / groupHz);
  const numGroups = groupMaxIdx - groupMinIdx + 1;
  if (numGroups < 3) return [];

  const groupDb = new Float32Array(numGroups);
  for (let g = 0; g < numGroups; g++) {
    const freqHz = (groupMinIdx + g) * groupHz;
    const fineStart = Math.round(freqHz / fineBinHz);
    let powerSum = 0;
    let count = 0;
    for (let i = fineStart; i < Math.min(mags.length, fineStart + finePerGroup); i++) {
      powerSum += mags[i] * mags[i];
      count++;
    }
    groupDb[g] = count > 0 ? 10.0 * Math.log10(Math.max(powerSum / count, 1e-12)) : -999;
  }

  const sortedGroups = Array.from(groupDb).sort((a, b) => a - b);
  const noiseFloorDb = sortedGroups[Math.floor(sortedGroups.length / 2)];
  const thresholdDb = noiseFloorDb + minPeakDb;
  const minSpacingGroups = Math.max(1, Math.round(Z30_SPECS.TOTAL_BANDWIDTH_HZ / groupHz));

  const candidates: Candidate[] = [];
  for (let g = 1; g < numGroups - 1; g++) {
    if (groupDb[g] > thresholdDb && groupDb[g] > groupDb[g - 1] && groupDb[g] > groupDb[g + 1]) {
      const freqHz = (groupMinIdx + g) * groupHz;
      if (candidates.some((c) => Math.abs(c.freqHz - freqHz) < minSpacingGroups * groupHz)) continue;
      candidates.push({ freqHz, peakDb: groupDb[g], noiseFloorDb });
    }
  }

  candidates.sort((a, b) => b.peakDb - a.peakDb);
  return candidates.slice(0, maxCandidates);
}

/** Real-input FFT magnitude spectrum (radix-2 Cooley-Tukey, zero-padded to the next power of 2). */
function realFftMagnitudes(input: Float32Array): { mags: Float32Array; fftSize: number } {
  let size = 1;
  while (size < input.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  // Hann window to reduce spectral leakage in the peak search.
  for (let i = 0; i < input.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / (input.length - 1));
    re[i] = input[i] * w;
  }
  fftInPlace(re, im);
  const half = size / 2 + 1;
  const mags = new Float32Array(half);
  for (let i = 0; i < half; i++) mags[i] = Math.hypot(re[i], im[i]);
  return { mags, fftSize: size };
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2.0 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1.0;
      let curIm = 0.0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

/**
 * Coherent matched-filter amplitude estimate averaged over the 21 known Costas sync pilot
 * tones, assuming baseFreqHz is the tone-0 frequency of the 16-tone comb.
 */
export function pilotAmplitude(buffer: Float32Array, sampleRateHz: number, baseFreqHz: number): number {
  const samplesPerSymbol = samplesPerSymbolFor(sampleRateHz);
  const dt = 1.0 / sampleRateHz;
  const amps: number[] = [];
  for (let pIdx = 0; pIdx < SYNC_POSITIONS.length; pIdx++) {
    const f = SYNC_POSITIONS[pIdx];
    const toneIdx = SYNC_TONES[pIdx % SYNC_TONES.length];
    const toneFreq = baseFreqHz + toneIdx * TONE_SPACING_HZ;
    const start = f * samplesPerSymbol;
    if (start + samplesPerSymbol > buffer.length) continue;
    let corrCos = 0;
    let corrSin = 0;
    for (let n = 0; n < samplesPerSymbol; n++) {
      const sample = buffer[start + n];
      const theta = 2.0 * Math.PI * toneFreq * (n * dt);
      corrCos += sample * Math.cos(theta);
      corrSin += sample * Math.sin(theta);
    }
    amps.push(Math.hypot(corrCos, corrSin) / (samplesPerSymbol / 2.0));
  }
  if (amps.length === 0) return 1e-6;
  return Math.max(1e-6, amps.reduce((a, b) => a + b, 0) / amps.length);
}

/**
 * A raw FFT peak lands on whichever tone happened to carry the most energy, not necessarily
 * tone-0. Tests all 16 possible tone-0 offsets from the peak and keeps the one maximizing
 * Costas pilot correlation - a standard coarse-acquisition step.
 */
export function refineBaseFreq(buffer: Float32Array, sampleRateHz: number, roughPeakFreqHz: number): number {
  let bestFreq = roughPeakFreqHz;
  let bestAmp = -1;
  for (let k = 0; k < NUM_TONES; k++) {
    const candidateBase = roughPeakFreqHz - k * TONE_SPACING_HZ;
    const amp = pilotAmplitude(buffer, sampleRateHz, candidateBase);
    if (amp > bestAmp) {
      bestAmp = amp;
      bestFreq = candidateBase;
    }
  }
  return bestFreq;
}

/**
 * Sub-0.01 Hz carrier-frequency-offset (CFO) correction via multi-baseline pilot correlator
 * phase-difference estimation across the 21 Costas sync positions (7 triplets spread across
 * the full 24s frame). A single long-baseline phase-slope fit aliases once the true CFO
 * exceeds 1/(2*baseline): triplets are up to 8s apart, so this proceeds in stages instead -
 * short intra-triplet baselines first (unambiguous up to the coarse search's +/-1.5625 Hz
 * residual bound), then progressively longer baselines, each safe only once the prior stage
 * has shrunk the residual CFO below that stage's ambiguity-free range.
 */
export function refineFineFrequency(buffer: Float32Array, sampleRateHz: number, baseFreqHz: number): number {
  const samplesPerSymbol = samplesPerSymbolFor(sampleRateHz);
  const dt = 1.0 / sampleRateHz;

  const measurePhases = (freq: number): { times: number[]; phases: number[] } => {
    const times: number[] = [];
    const phases: number[] = [];
    for (let pIdx = 0; pIdx < SYNC_POSITIONS.length; pIdx++) {
      const f = SYNC_POSITIONS[pIdx];
      const toneIdx = SYNC_TONES[pIdx % SYNC_TONES.length];
      const toneFreq = freq + toneIdx * TONE_SPACING_HZ;
      const start = f * samplesPerSymbol;
      if (start + samplesPerSymbol > buffer.length) continue;
      let corrCos = 0;
      let corrSin = 0;
      for (let n = 0; n < samplesPerSymbol; n++) {
        const sample = buffer[start + n];
        // Global absolute-time reference: required to see CFO-induced drift at all (a
        // per-symbol-local reset makes a constant-Hz error look identical at every symbol).
        const tAbs = (start + n) * dt;
        const theta = 2.0 * Math.PI * toneFreq * tAbs;
        corrCos += sample * Math.cos(theta);
        corrSin += sample * Math.sin(theta);
      }
      times.push(f * SYMBOL_DURATION_SEC);
      phases.push(Math.atan2(corrSin, corrCos));
    }
    return { times, phases };
  };

  let freq = baseFreqHz;
  for (const maxBaselineSec of [1.0, 4.0, 30.0]) {
    for (let iter = 0; iter < 3; iter++) {
      const { times, phases } = measurePhases(freq);
      if (times.length < 2) break;

      let weightedSum = 0;
      let weightTotal = 0;
      for (let i = 0; i < times.length; i++) {
        for (let j = i + 1; j < times.length; j++) {
          const baseline = times[j] - times[i];
          if (baseline <= 0 || baseline > maxBaselineSec) continue;
          let dphi = phases[j] - phases[i];
          dphi = ((dphi + Math.PI) % (2.0 * Math.PI)) - Math.PI;
          if (dphi < -Math.PI) dphi += 2.0 * Math.PI;
          weightedSum += (dphi / baseline) * baseline;
          weightTotal += baseline;
        }
      }
      if (weightTotal === 0) continue;

      const slope = weightedSum / weightTotal;
      const deltaF = slope / (2.0 * Math.PI);
      freq -= deltaF;
      if (Math.abs(deltaF) < 0.003) break;
    }
  }

  return freq;
}

/**
 * Demodulates a captured carrier at baseFreqHz into 216 soft channel LLRs via a pilot-aided
 * semi-coherent matched-filter bank with exact Log-MAP demapping - the tone0-anchored,
 * phase-step-corrected TS counterpart of z30_dsp.benchmark.demodulate_mfsk_llrs.
 */
export function demodulateReal(
  buffer: Float32Array,
  sampleRateHz: number,
  baseFreqHz: number,
  sigma: number
): Float32Array {
  const samplesPerSymbol = samplesPerSymbolFor(sampleRateHz);
  const dt = 1.0 / sampleRateHz;
  const syncPosSet = new Set(SYNC_POSITIONS);
  const llrs = new Float32Array(216);

  const pilotFrames: number[] = [];
  const pilotPhases: number[] = [];
  const pilotAmps: number[] = [];

  for (let pIdx = 0; pIdx < SYNC_POSITIONS.length; pIdx++) {
    const f = SYNC_POSITIONS[pIdx];
    const toneIdx = SYNC_TONES[pIdx % SYNC_TONES.length];
    const toneFreq = baseFreqHz + toneIdx * TONE_SPACING_HZ;
    const start = f * samplesPerSymbol;
    let corrCos = 0;
    let corrSin = 0;
    for (let n = 0; n < samplesPerSymbol; n++) {
      const sample = start + n < buffer.length ? buffer[start + n] : 0;
      const theta = 2.0 * Math.PI * toneFreq * (n * dt);
      corrCos += sample * Math.cos(theta);
      corrSin += sample * Math.sin(theta);
    }
    pilotFrames.push(f);
    pilotPhases.push(Math.atan2(corrSin, corrCos));
    pilotAmps.push(Math.hypot(corrCos, corrSin) / (samplesPerSymbol / 2.0));
  }

  const quadNoiseVar = Math.max(1e-12, (sigma * sigma * samplesPerSymbol) / 2.0);
  const estSigAmp = Math.max(0.01, pilotAmps.reduce((a, b) => a + b, 0) / Math.max(1, pilotAmps.length));
  const sCorr = (estSigAmp * samplesPerSymbol / 2.0) / quadNoiseVar;

  // See module docstring: the per-symbol continuous-phase increment is identical for every
  // tone (tone spacing = 1/symbol duration exactly) and depends only on baseFreqHz.
  const basePhaseStep = ((2.0 * Math.PI * baseFreqHz * SYMBOL_DURATION_SEC) % (2.0 * Math.PI) + 2.0 * Math.PI) % (2.0 * Math.PI);

  let dataSymIdx = 0;
  for (let frameSymIdx = 0; frameSymIdx < TOTAL_SYMBOLS; frameSymIdx++) {
    if (syncPosSet.has(frameSymIdx)) continue;

    let closestP = 0;
    let minDist = Infinity;
    for (let p = 0; p < pilotFrames.length; p++) {
      const dist = Math.abs(pilotFrames[p] - frameSymIdx);
      if (dist < minDist) {
        minDist = dist;
        closestP = p;
      }
    }
    const rawPhase = pilotPhases[closestP] - basePhaseStep * (frameSymIdx - pilotFrames[closestP]);
    const interpPhase = Math.atan2(Math.sin(rawPhase), Math.cos(rawPhase));
    const pilotCoherence = Math.max(0.35, Math.min(0.85, 1.0 / (1.0 + 0.15 * minDist)));

    const start = frameSymIdx * samplesPerSymbol;
    const toneLogLikes = new Float64Array(NUM_TONES);
    for (let tone = 0; tone < NUM_TONES; tone++) {
      const toneFreq = baseFreqHz + tone * TONE_SPACING_HZ;
      let corrCos = 0;
      let corrSin = 0;
      for (let n = 0; n < samplesPerSymbol; n++) {
        const sample = start + n < buffer.length ? buffer[start + n] : 0;
        const theta = 2.0 * Math.PI * toneFreq * (n * dt);
        corrCos += sample * Math.cos(theta);
        corrSin += sample * Math.sin(theta);
      }
      const envelope = Math.hypot(corrCos, corrSin);
      const z = envelope * sCorr;
      const nonCoherent = z > 15 ? z - 0.5 * Math.log(Math.max(1.0, 2.0 * Math.PI * z)) : Math.log(Math.max(1e-12, besselI0(z)));

      const proj = corrCos * Math.cos(interpPhase) + corrSin * Math.sin(interpPhase);
      const coherent = proj * sCorr;

      toneLogLikes[tone] = pilotCoherence * coherent + (1.0 - pilotCoherence) * nonCoherent;
    }

    for (let bit = 0; bit < 4; bit++) {
      const bitMask = 1 << (3 - bit);
      const likes0: number[] = [];
      const likes1: number[] = [];
      for (let t = 0; t < NUM_TONES; t++) {
        if ((t & bitMask) === 0) likes0.push(toneLogLikes[t]);
        else likes1.push(toneLogLikes[t]);
      }
      const llr = logSumExp(likes0) - logSumExp(likes1);
      llrs[dataSymIdx * 4 + bit] = Math.max(-25.0, Math.min(25.0, llr));
    }
    dataSymIdx++;
  }

  return llrs;
}

function logSumExp(vals: number[]): number {
  if (vals.length === 0) return -1e9;
  let maxVal = -Infinity;
  for (const v of vals) if (v > maxVal) maxVal = v;
  let sum = 0;
  for (const v of vals) sum += Math.exp(v - maxVal);
  return maxVal + Math.log(sum);
}

/** Modified Bessel function of the first kind, order 0 (Abramowitz & Stegun polynomial approximation). */
function besselI0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = (ax / 3.75) * (ax / 3.75);
    return 1.0 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
  }
  const y = 3.75 / ax;
  const poly =
    0.39894228 +
    y *
      (0.01328592 +
        y *
          (0.00225319 +
            y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377)))))));
  return (Math.exp(ax) * poly) / Math.sqrt(ax);
}

/** Robust noise-sigma estimate from whole-buffer sample statistics (median absolute deviation -> Gaussian sigma). */
export function estimateSigma(buffer: Float32Array): number {
  const sorted = Array.from(buffer).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const absDevs = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDevs[Math.floor(absDevs.length / 2)];
  return Math.max(1e-6, mad / 0.6744897501960817);
}

/** Converts a pilot-tone amplitude / noise-sigma ratio into an approximate SNR figure in dB. */
export function estimateSnrDb(pilotAmp: number, sigma: number): number {
  if (sigma <= 0) return 0;
  const snrLinear = Math.max(1e-6, (pilotAmp * pilotAmp) / (2.0 * sigma * sigma));
  return Math.max(-40, Math.min(40, 10.0 * Math.log10(snrLinear)));
}

/**
 * Re-encodes 77 decoded information bits into the full 75-symbol frame (54 LDPC-coded data
 * tones interleaved with the 21 Costas sync tones), for SIC replica synthesis and cancellation.
 */
export function recoverSymbols(codeword216: number[]): number[] {
  const dataSymbols: number[] = [];
  for (let s = 0; s < 54; s++) {
    const idx = s * 4;
    const tone = (codeword216[idx] << 3) | (codeword216[idx + 1] << 2) | (codeword216[idx + 2] << 1) | codeword216[idx + 3];
    dataSymbols.push(tone);
  }

  const fullSymbols = new Array(TOTAL_SYMBOLS).fill(0);
  const syncPosSet = new Set(SYNC_POSITIONS);
  let syncCnt = 0;
  let dataCnt = 0;
  for (let i = 0; i < TOTAL_SYMBOLS; i++) {
    if (syncPosSet.has(i)) {
      fullSymbols[i] = SYNC_TONES[syncCnt % SYNC_TONES.length];
      syncCnt++;
    } else {
      fullSymbols[i] = dataSymbols[dataCnt++];
    }
  }
  return fullSymbols;
}

/**
 * Downsamples real captured microphone audio (typically 44.1/48 kHz hardware rate) to the
 * lower rate used by the DSP pipeline above. Applies a simple moving-average anti-alias
 * low-pass before linear-interpolation decimation - not audiophile-grade, but a genuine
 * anti-alias measure rather than naive point-decimation, and adequate here since the signal
 * of interest occupies a fixed, narrow 200-3000 Hz audio passband already band-limited by the
 * transceiver's own SSB filter well before it reaches the sound card.
 */
export function resampleAudio(input: Float32Array, fromRateHz: number, toRateHz: number): Float32Array {
  if (fromRateHz === toRateHz) return input;

  let source = input;
  const ratio = fromRateHz / toRateHz;
  if (ratio > 1) {
    const filterLen = Math.max(1, Math.round(ratio));
    const filtered = new Float32Array(input.length);
    let acc = 0;
    const window: number[] = [];
    for (let i = 0; i < input.length; i++) {
      window.push(input[i]);
      acc += input[i];
      if (window.length > filterLen) acc -= window.shift() as number;
      filtered[i] = acc / window.length;
    }
    source = filtered;
  }

  const outLen = Math.max(1, Math.round((source.length * toRateHz) / fromRateHz));
  const output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * fromRateHz) / toRateHz;
    const idx0 = Math.min(source.length - 1, Math.floor(srcPos));
    const idx1 = Math.min(source.length - 1, idx0 + 1);
    const frac = srcPos - idx0;
    output[i] = source[idx0] * (1 - frac) + source[idx1] * frac;
  }
  return output;
}

/**
 * Joint coarse timing (dt) + tone-grid frequency acquisition. Real transmissions don't arrive
 * exactly at the receiver's assumed 24.0s frame boundary (propagation delay plus remote clock
 * drift, up to +/-1.5 s per the protocol spec) - `paddedBuffer` must therefore span
 * [nominalSlotStart - maxDtSec, nominalSlotStart + 24.0 + maxDtSec]. This searches a coarse dt
 * grid using the cheap pilot-amplitude proxy (not a full LDPC decode, which is far too
 * expensive to run at every trial offset) jointly with the existing 16-tone-offset search, and
 * returns the frame-start sample index and base frequency to hand to the fine-frequency and
 * demodulation stages.
 */
export function refineTimingAndFreq(
  paddedBuffer: Float32Array,
  sampleRateHz: number,
  roughFreqHz: number,
  maxDtSec: number = 1.5,
  dtStepSec: number = 0.16
): { dtSec: number; frameStartSample: number; baseFreqHz: number } {
  const frameLength = TOTAL_SYMBOLS * samplesPerSymbolFor(sampleRateHz);

  const scanGrid = (
    center: number,
    span: number,
    step: number,
    freqCenter: number,
    searchAllTones: boolean
  ): { dtSec: number; freq: number; amp: number } => {
    let bestAmp = -1;
    let bestDtSec = center;
    let bestFreq = freqCenter;
    for (let dtSec = center - span; dtSec <= center + span + 1e-9; dtSec += step) {
      const frameStartSample = Math.round((maxDtSec + dtSec) * sampleRateHz);
      if (frameStartSample < 0 || frameStartSample + frameLength > paddedBuffer.length) continue;
      const frameView = paddedBuffer.subarray(frameStartSample, frameStartSample + frameLength);

      if (searchAllTones) {
        for (let k = 0; k < NUM_TONES; k++) {
          const candidateBase = freqCenter - k * TONE_SPACING_HZ;
          const amp = pilotAmplitude(frameView, sampleRateHz, candidateBase);
          if (amp > bestAmp) {
            bestAmp = amp;
            bestDtSec = dtSec;
            bestFreq = candidateBase;
          }
        }
      } else {
        const amp = pilotAmplitude(frameView, sampleRateHz, freqCenter);
        if (amp > bestAmp) {
          bestAmp = amp;
          bestDtSec = dtSec;
        }
      }
    }
    return { dtSec: bestDtSec, freq: bestFreq, amp: bestAmp };
  };

  // Stage 1: coarse dt grid (0.16s steps) jointly with the 16-tone-offset search - enough to
  // find the right frequency and get within one coarse step of the true frame boundary.
  const coarse = scanGrid(0, maxDtSec, dtStepSec, roughFreqHz, true);

  // Stage 2: fine dt refinement around the coarse estimate. A whole-symbol-scale dt error
  // still mixes samples from the adjacent true symbol into every correlator window (the
  // frame boundary itself must land within a small fraction of one symbol), so this narrows
  // down to sub-symbol precision before handing off to demodulation/decoding.
  const fine = scanGrid(coarse.dtSec, dtStepSec, dtStepSec / 16, coarse.freq, false);

  return {
    dtSec: fine.dtSec,
    frameStartSample: Math.round((maxDtSec + fine.dtSec) * sampleRateHz),
    baseFreqHz: coarse.freq,
  };
}

export interface RealDecodedFrame {
  freqHz: number;
  snrDb: number;
  dtSec: number;
  sicPass: 1 | 2 | 3;
  rawSymbols: number[];
  unpacked: ReturnType<typeof unpackZ30Message>;
  ldpcIterations: number;
}

/**
 * Full multi-pass Successive Interference Cancellation pipeline on a real captured audio
 * buffer: real FFT candidate detection, joint timing+frequency acquisition, pilot-aided LLR
 * demodulation, real (216, 77) LDPC decode, message unpacking, and time-domain waveform
 * cancellation of each successfully decoded signal before re-scanning the residual.
 *
 * `paddedBuffer` must span [nominalSlotStart - maxDtSec, nominalSlotStart + 24.0 + maxDtSec]
 * at sampleRateHz.
 */
export function runSicMultiPass(
  paddedBuffer: Float32Array,
  sampleRateHz: number,
  maxPasses: number = 3,
  minFreqHz: number = 200,
  maxFreqHz: number = 3000,
  maxDtSec: number = 1.5
): RealDecodedFrame[] {
  const residual = new Float32Array(paddedBuffer);
  const results: RealDecodedFrame[] = [];
  const frameLength = TOTAL_SYMBOLS * samplesPerSymbolFor(sampleRateHz);

  for (let pass = 1; pass <= maxPasses; pass++) {
    const candidates = findCandidates(residual, sampleRateHz, minFreqHz, maxFreqHz);
    if (candidates.length === 0) break;

    let newDecodes = 0;
    for (const cand of candidates) {
      const { dtSec, frameStartSample, baseFreqHz } = refineTimingAndFreq(residual, sampleRateHz, cand.freqHz, maxDtSec);
      if (frameStartSample + frameLength > residual.length) continue;
      const frameView = residual.subarray(frameStartSample, frameStartSample + frameLength);

      const fineFreqHz = refineFineFrequency(frameView, sampleRateHz, baseFreqHz);
      const sigma = estimateSigma(frameView);

      // Cheap pre-filter: skip the expensive multi-schedule LDPC decode (up to 150 iterations)
      // for candidates whose pilot-correlation SNR is implausibly far below the empirical
      // decode floor (~-24.6 dB, the idealised AWGN bound from the Monte Carlo benchmark; the
      // real on-air floor is higher) - they essentially never decode,
      // and without this a noisy buffer's dozen-odd surviving candidates can make one decode
      // cycle take far longer than the 6.0s guard window allows.
      const preSnrDb = estimateSnrDb(pilotAmplitude(frameView, sampleRateHz, fineFreqHz), sigma);
      if (preSnrDb < -30.0) continue;

      const llrs = demodulateReal(frameView, sampleRateHz, fineFreqHz, sigma);
      const decodeResult = ldpcCodec.decodeMinSum(llrs);

      if (decodeResult.success && decodeResult.crcValid) {
        const symbols = recoverSymbols(decodeResult.codeword);
        const synth = synthesizeReplica(symbols, fineFreqHz, sampleRateHz);
        const amp = pilotAmplitude(frameView, sampleRateHz, fineFreqHz);
        const n = Math.min(frameView.length, synth.length);
        for (let i = 0; i < n; i++) residual[frameStartSample + i] -= amp * synth[i];

        const unpacked = unpackZ30Message(decodeResult.infoBits);
        results.push({
          freqHz: fineFreqHz,
          snrDb: estimateSnrDb(amp, sigma),
          dtSec,
          sicPass: pass as 1 | 2 | 3,
          rawSymbols: symbols,
          unpacked,
          ldpcIterations: decodeResult.iterations,
        });
        newDecodes++;
      }
    }

    if (newDecodes === 0) break;
  }

  return results;
}

/**
 * Derives a 32-bit seed from a clean waveform and the SNR it is about to be buried at
 * (FNV-1a over 1/4096-amplitude quanta).
 *
 * Same reasoning as `ditherSeedFromLlrs` in ldpcCodec.ts, and the same bug class: the noise
 * `addCalibratedAwgn` adds used to come from `Math.random()`, so the Experimental Testing
 * self-test was not a function of its input. That path runs the real `demodulateReal` ->
 * `decodeMinSum` chain, so a frame that decoded on one run could fail on the next at the
 * identical configured SNR, which is precisely the near-threshold behaviour the self-test
 * exists to show. AGENTS.md's determinism invariant says `Math.random()` does not belong
 * anywhere the decode path can reach.
 *
 * `benchmark.py` threads an explicit seeded `rng` into its twin of this function, and callers
 * that have a seed should pass one here too. Deriving a seed from the input covers the callers
 * that have none - sicDecoder.ts injects signals that arrived from the UI, with no seed in
 * scope - so the function is reproducible in every caller rather than only the benchmark.
 * Different injected signals still get different noise, because the waveform and SNR they hash
 * differ; the same signal always gets the same noise.
 *
 * Quantising to 1/4096 before hashing keeps the derivation on integers so it cannot depend on
 * float formatting, and `Math.floor(x * 4096 + 0.5)` matches the rounding convention
 * `ditherSeedFromLlrs` already uses.
 */
export function awgnSeedFromWaveform(cleanWaveform: Float32Array, snr2500HzDb: number): number {
  let h = 0x811c9dc5;
  const mix = (value: number): void => {
    const quantum = Math.floor(value * 4096.0 + 0.5) >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      h = (h ^ ((quantum >>> shift) & 0xff)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (let i = 0; i < cleanWaveform.length; i++) mix(cleanWaveform[i]);
  mix(snr2500HzDb);
  return h >>> 0;
}

/**
 * Adds calibrated AWGN referenced to the standard 2500 Hz noise bandwidth.
 *
 * The twin of `add_calibrated_awgn` in z30_dsp/benchmark.py, including its `rng` parameter:
 * pass a seeded source and two runs of the same configuration give the same waveform. With no
 * source supplied the seed is derived from the input itself (see `awgnSeedFromWaveform`), so
 * the result is reproducible even for a caller that has no seed to hand it.
 *
 * Uses the shared `RandomSource.normal()` rather than a second Box-Muller: this function used
 * to carry its own copy, which is how it kept an unseeded `Math.random()` after the generator
 * beside it had been seeded.
 */
export function addCalibratedAwgn(
  cleanWaveform: Float32Array,
  snr2500HzDb: number,
  sampleRateHz: number,
  rng?: RandomSource
): Float32Array {
  let signalPower = 0;
  for (let i = 0; i < cleanWaveform.length; i++) signalPower += cleanWaveform[i] * cleanWaveform[i];
  signalPower /= cleanWaveform.length;

  const snrLinear = Math.pow(10, snr2500HzDb / 10.0);
  const bandwidthFactor = 5000.0 / sampleRateHz;
  const sigma = Math.sqrt(signalPower / (snrLinear * bandwidthFactor));

  const source = rng ?? createSeededRandom(awgnSeedFromWaveform(cleanWaveform, snr2500HzDb));
  const noisy = new Float32Array(cleanWaveform.length);
  for (let i = 0; i < cleanWaveform.length; i++) {
    noisy[i] = cleanWaveform[i] + sigma * source.normal();
  }
  return noisy;
}
