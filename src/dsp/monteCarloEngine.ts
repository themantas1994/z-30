/**
 * z-30 Physical Layer Waveform Generator, AWGN Channel Calibrator & Monte Carlo Decoder Engine
 * ==========================================================================================
 * 
 * End-to-end DSP simulation pipeline:
 * 1. Generates authentic z-30 (216, 77) LDPC frames + 21 Costas sync symbols.
 * 2. Synthesizes physical 16-MFSK continuous-phase waveforms with GFSK frequency shaping and a
 *    constant amplitude envelope (see src/dsp/z30Waveform.ts).
 * 3. Injects calibrated Gaussian Noise (AWGN) calibrated strictly to the amateur standard 2500 Hz reference bandwidth:
 *      SNR_2500Hz = 10 * log10( P_signal / ( N0 * 2500 Hz ) )
 *      sigma^2 = P_signal / ( 10^(SNR_dB / 10) * (5000 / Fs) )
 * 4. Demodulates noisy waveforms via non-coherent 16-tone matched filter correlators / energy detectors.
 * 5. Calculates Max-Log soft channel Log-Likelihood Ratios (LLRs) for all 216 channel coded bits.
 * 6. Runs the actual Systematic (216, 77) Normalized Min-Sum LDPC Belief Propagation Decoder.
 * 7. Measures and tallies real decode successes, failures, Frame Error Rate (FER), pre/post-LDPC BER,
 *    and LDPC iteration convergence across user-configured SNR sweeps.
 */

import { createSeededRandom, DEFAULT_MONTE_CARLO_SEED, RandomSource } from './seededRandom';
import { synthesizeFrameSamples } from './z30Waveform';
import { Z30_SPECS } from './z30Constants';
import { Z30LdpcEngine } from './ldpcCodec';
import { encodeLdpc216_77, computeCrc14 } from './z30Codec';
import { RECEIVER_PILOT_COHERENCE } from './realReceiver';

export type ChannelModelType = 'AWGN' | 'RAYLEIGH_FADING' | 'CO_CHANNEL_QRM';

/**
 * What the run measures. The distinction is the whole of wiki/16's opening section, and it is
 * the difference between a number that may be compared with FT8's published -21.0 dB and one
 * that may not.
 *
 * - `realistic` measures a **decode threshold**. Every frame gets a random carrier offset and
 *   a random timing offset; the receiver is handed nothing but audio and must find the frame
 *   from the 21 Costas symbols and estimate its own noise floor. Comparable with other modes'
 *   on-air figures.
 * - `ideal` measures a **genie-aided bound**, which is not a threshold. The demodulator is
 *   handed the exact noise sigma, the exact carrier and perfect symbol timing. It bounds what
 *   the code can do under ideal detection and nothing more; never quote it against another
 *   mode's on-air number.
 *
 * The browser engine only had the `ideal` path, while the modal labelled its output a
 * "50% Empirical Decode Threshold" and drew an FT8 reference line next to it.
 */
export type MeasurementModeType = 'ideal' | 'realistic';
export type SimulationModeType = 'MATCHED_FILTER_CORRELATOR_BANK' | 'FULL_PHYSICAL_DSP';

export interface SnrPointResult {
  snrDb: number; // in 2500 Hz reference bandwidth
  totalFrames: number;
  successCount: number;
  failureCount: number;
  frameErrorRate: number; // FER = failureCount / totalFrames
  decodeSuccessRate: number; // Success % = successCount / totalFrames * 100
  rawChannelBer: number; // Pre-LDPC uncoded bit error rate
  postLdpcBer: number; // Residual post-LDPC bit error rate
  avgLdpcIterations: number;
  minIterations: number;
  maxIterations: number;
  confidenceInterval95: [number, number]; // [lower %, upper %] Wilson score interval
  elapsedMs: number;
  /**
   * Acquisition-stage diagnostics, populated in realistic mode only (all zero in ideal mode,
   * where acquisition does not happen). These are the `Acq fail`, `Timing RMS` and `Freq RMS`
   * columns of the Python benchmark's table: below roughly -24 dB the Costas pattern stops
   * being findable at all, and that shows up here rather than being hidden inside the FER.
   */
  acquisitionFailures: number;
  timingRmsMs: number;
  freqRmsHz: number;
}

export interface MonteCarloProgress {
  isRunning: boolean;
  isPaused: boolean;
  currentSnrIdx: number;
  totalSnrPoints: number;
  currentFrameInPoint: number;
  totalFramesPerPoint: number;
  overallProgressPercent: number;
  currentSnrDb: number;
  currentResults: SnrPointResult[];
  latestWaveformPreview?: {
    timeDomainClean: Float32Array;
    timeDomainNoisy: Float32Array;
    noiseOnly: Float32Array;
    spectrumFreqs: number[];
    spectrumMagnitudesDb: number[];
    correlatorEnergies: number[][]; // 54 symbols x 16 tones
    transmittedSymbols: number[];
    demodulatedSymbols: number[];
    channelLlrs: Float32Array;
    snrDb: number;
    decodedSuccess: boolean;
    iterations: number;
  };
}

export interface MonteCarloConfig {
  minSnrDb: number;
  maxSnrDb: number;
  snrStepDb: number;
  framesPerPoint: number;
  sampleRateHz: number;
  audioCenterFreqHz: number;
  channelModel: ChannelModelType;
  simulationMode: SimulationModeType;
  fadingDopplerHz?: number; // e.g. 0.5 Hz for ITU-R F.1487
  qrmOffsetHz?: number; // e.g. +12.5 Hz co-channel interference
  qrmSirDb?: number; // Signal to Interference Ratio in dB
  maxLdpcIterations: number;
  // No alphaMinSum. It was a live input in the benchmark modal that fed a decoder which has
  // never read it: the four schedules of Z30_DECODE_SCHEDULES carry their own alphas. Moving
  // the slider changed the curve's label and nothing about the curve.
  /**
   * `realistic` (default) measures a decode threshold; `ideal` measures a genie-aided bound.
   * See MeasurementModeType. Mirrors the Python benchmark's `--mode` flag.
   */
  measurementMode: MeasurementModeType;
  /** Half-width of the uniform random carrier offset, in Hz. Realistic mode only. */
  carrierOffsetHz?: number;
  /** Half-width of the uniform random timing offset, in seconds. Realistic mode only. */
  timingOffsetSec?: number;
  /**
   * PRNG seed for the payloads, the noise and the fading process.
   *
   * Both benchmark engines used to draw from unseeded `Math.random()`, so two runs of the same
   * configuration gave different curves and no published number could be reproduced, bisected
   * or independently checked. Record this seed alongside any result you publish.
   */
  seed?: number;
}

/**
 * How far above the median search-grid score the winning acquisition hypothesis must sit
 * before the receiver believes it has found a frame.
 *
 * Chosen from the measured distribution of the statistic, not tuned to flatter the result.
 * Summing 21 exponentially distributed tone powers over a few thousand hypotheses puts the
 * peak well above the median even on pure noise, so the bar has to clear that. Measured over
 * 15 streams per point at the default settings:
 *
 *     pure noise (-70 dB)  max 3.1 dB      -25 dB SNR   min 4.2 dB
 *     -30 dB SNR           max 3.6 dB      -22 dB SNR   min 5.3 dB
 *
 * 4.0 dB sits in the gap: noise does not reach it, and a frame that is present from about
 * -25 dB upwards always does. Between roughly -27 and -26 dB the two distributions genuinely
 * overlap, and frames there are genuinely sometimes not findable - that is the acquisition
 * limit the benchmark exists to expose, and it belongs in the Acq Fail column rather than
 * being smoothed away by a lower bar.
 */
const ACQUISITION_SYNC_THRESHOLD_DB = 4.0;

/**
 * Extra timing search either side of the station's own timing uncertainty, in seconds.
 *
 * z-30 is slot-synchronised: frames start on a 30-second UTC boundary, so a real receiver
 * knows where the frame should begin to within its timing uncertainty and searches a window
 * around that rather than an arbitrary stream. The margin covers the receiver's own clock
 * error on top of the transmitter's.
 *
 * The twin of `SLOT_SEARCH_MARGIN_SEC` in z30_dsp/acquisition.py, pinned by
 * tests/test_cross_language_parity.py. The Python benchmark used to search its whole buffer
 * instead, and wiki/16 named that difference as the reason the two engines' thresholds
 * disagreed by 1.8 dB. It was not: measured paired over 200 frames from -26 to -22 dB, the two
 * search widths produced zero discordant decodes. The engines now search the same window, and
 * the real cause of the gap turned out to be the demodulator - see RECEIVER_PILOT_COHERENCE.
 */
export const SLOT_SEARCH_MARGIN_SEC = 0.05;

/**
 * The benchmark demodulates with the weight the shipped receiver uses, and reads it from the
 * shipped receiver rather than declaring its own.
 *
 * This constant used to be declared here, in the benchmark, under the name
 * RECEIVER_PILOT_COHERENCE - and that is precisely how realReceiver.ts's `demodulateReal` and
 * sic_decoder.py went on applying a different weight for months without anything noticing: a
 * benchmark that owns the receiver's parameters can be perfectly self-consistent while
 * measuring software nobody runs. Importing it in this direction makes that impossible.
 * `ideal` mode still applies the pilot-distance-adaptive weight, because it is handed exact
 * symbol timing and is a bound rather than a threshold.
 */
export { RECEIVER_PILOT_COHERENCE };

export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  minSnrDb: -32.0,
  maxSnrDb: -22.0,
  snrStepDb: 1.0,
  framesPerPoint: 50,
  sampleRateHz: 6000, // 6 kHz fast high-res simulation rate (sub-Nyquist over 50Hz audio band)
  audioCenterFreqHz: 1250,
  channelModel: 'AWGN',
  simulationMode: 'MATCHED_FILTER_CORRELATOR_BANK',
  fadingDopplerHz: 0.5,
  qrmOffsetHz: 15.0,
  qrmSirDb: -6.0,
  maxLdpcIterations: 45,
  // The honest default, matching `python -m z30_dsp.benchmark`'s own default. A benchmark
  // whose default mode produces a bound, presented in a modal that calls the result a
  // threshold, is how the retracted "+4 dB over FT8" claim happened the first time.
  measurementMode: 'realistic',
  carrierOffsetHz: 5.0,
  timingOffsetSec: 0.5,
  seed: DEFAULT_MONTE_CARLO_SEED,
};

/**
 * Sweep range that brackets the documented AWGN threshold, for the realistic mode.
 * The old default (-32 .. -22 dB) brackets the genie-aided bound instead, and in realistic
 * mode would sit almost entirely below the point where the sync pattern is findable at all.
 */
export const REALISTIC_SWEEP_DEFAULTS = { minSnrDb: -26.0, maxSnrDb: -16.0 };
/** Sweep range that brackets the genie-aided bound, for the ideal mode. */
export const IDEAL_SWEEP_DEFAULTS = { minSnrDb: -30.0, maxSnrDb: -20.0 };

export class MonteCarloSimulationEngine {
  /**
   * Random source for the current run. Re-seeded at the start of every `runSimulation` call,
   * so a given seed always produces the same curve.
   */
  private rng: RandomSource = createSeededRandom();
  private isCancelled: boolean = false;
  private isPaused: boolean = false;
  private currentProgress: MonteCarloProgress = {
    isRunning: false,
    isPaused: false,
    currentSnrIdx: 0,
    totalSnrPoints: 0,
    currentFrameInPoint: 0,
    totalFramesPerPoint: 0,
    overallProgressPercent: 0,
    currentSnrDb: 0,
    currentResults: [],
  };
  private progressListeners: Array<(p: MonteCarloProgress) => void> = [];

  public subscribe(callback: (p: MonteCarloProgress) => void): () => void {
    this.progressListeners.push(callback);
    callback(this.currentProgress);
    return () => {
      this.progressListeners = this.progressListeners.filter((cb) => cb !== callback);
    };
  }

  private notify() {
    for (const listener of this.progressListeners) {
      listener({ ...this.currentProgress });
    }
  }

  public clearResults() {
    this.currentProgress = {
      isRunning: false,
      isPaused: false,
      currentSnrIdx: 0,
      totalSnrPoints: 0,
      currentFrameInPoint: 0,
      totalFramesPerPoint: 0,
      overallProgressPercent: 0,
      currentSnrDb: 0,
      currentResults: [],
      latestWaveformPreview: undefined,
    };
    this.notify();
  }

  public stop() {
    this.isCancelled = true;
    this.isPaused = false;
    this.currentProgress.isRunning = false;
    this.currentProgress.isPaused = false;
    this.notify();
  }

  public pause() {
    this.isPaused = true;
    this.currentProgress.isPaused = true;
    this.notify();
  }

  public resume() {
    this.isPaused = false;
    this.currentProgress.isPaused = false;
    this.notify();
  }

/**
 * Generates a random 63-bit amateur payload from the run's seeded PRNG.
 *
 * @returns 63-element binary array (0 or 1)
 */
public generateRandomPayload(): number[] {
  const payload = new Array(63);
  for (let i = 0; i < 63; i++) {
    payload[i] = this.rng.next() < 0.5 ? 0 : 1;
  }
  return payload;
}

/**
 * Encodes 63 payload bits -> CRC-14 -> 77 info bits -> (216, 77) LDPC -> 54 16-MFSK symbols -> 75 frame symbols.
 * 
 * Frame Assembly Rationale:
 * - 63 payload bits + 14-bit CRC = 77 information bits
 * - (216, 77) Systematic IRA LDPC generates 139 parity bits = 216 channel coded bits
 * - 216 bits / 4 bits-per-symbol = 54 16-MFSK data symbols
 * - 21 Costas synchronization symbols are interleaved at fixed positions
 * - Total transmitted frame length = 75 symbols (24.0s @ 320ms/sym)
 * 
 * @param payload63 - 63-bit input information sequence
 * @returns Object containing all intermediate stages of the physical encoding pipeline
 */
public assembleFrameSymbols(payload63: number[]): {
  infoBits: number[];
  codeword216: number[];
  dataSymbols54: number[];
  fullSymbols75: number[];
} {
  // 1. Calculate 14-bit CRC
  const crc = computeCrc14(payload63);
  const crcBits: number[] = [];
  for (let i = 13; i >= 0; i--) {
    crcBits.push((crc >> i) & 1);
  }
  const infoBits = [...payload63, ...crcBits];

  // 2. Systematic (216, 77) LDPC Encode
  const codeword216 = encodeLdpc216_77(infoBits);

  // 3. 4 bits per symbol for 16-MFSK -> 54 data symbols
  const dataSymbols54: number[] = [];
  for (let s = 0; s < 54; s++) {
    const idx = s * 4;
    const tone =
      (codeword216[idx] << 3) |
      (codeword216[idx + 1] << 2) |
      (codeword216[idx + 2] << 1) |
      codeword216[idx + 3];
    dataSymbols54.push(tone);
  }

  // 4. Interleave 21 Costas sync tones + 54 data tones -> 75 symbols
  const fullSymbols75: number[] = new Array(75).fill(0);
  const syncPosSet = new Set(Z30_SPECS.SYNC_POSITIONS);
  let syncCount = 0;
  let dataCount = 0;

  for (let i = 0; i < 75; i++) {
    if (syncPosSet.has(i)) {
      fullSymbols75[i] = Z30_SPECS.SYNC_TONES[syncCount % Z30_SPECS.SYNC_TONES.length];
      syncCount++;
    } else {
      fullSymbols75[i] = dataSymbols54[dataCount++];
    }
  }

  return {
    infoBits,
    codeword216,
    dataSymbols54,
    fullSymbols75,
  };
}

/**
 * Synthesizes the physical continuous-phase 16-MFSK baseband waveform for a frame.
 *
 * Delegates to the shared generator in src/dsp/z30Waveform.ts, which is the same code the
 * transmitter uses and the twin of z30_dsp/modem.py. This function used to contain a third
 * copy of the modulator carrying the same defect the other two did: an 8 ms raised-cosine ramp
 * applied to *every symbol*, taking the envelope to zero at each of the 75 symbol boundaries.
 * That is amplitude keying at 3.125 baud on top of the tone sequence, and it widens the
 * spectrum far beyond 50 Hz - so the benchmark was measuring a waveform the protocol does not
 * describe and the transmitter no longer emits. Frequency transitions are GFSK-shaped instead;
 * the only amplitude shaping is one ramp at the start and end of the frame.
 *
 * @param symbols75 - 75-element array of 16-MFSK symbol indexes (0 to 15)
 * @param sampleRateHz - Audio sample rate (e.g. 6000 Hz for DSP simulation, 48000 Hz for soundcard)
 * @param audioCenterFreqHz - Centre frequency of the 16-tone grid in Hertz (e.g. 1250 Hz)
 * @returns Floating-point PCM waveform buffer
 */
public synthesizePhysicalWaveform(
  symbols75: number[],
  sampleRateHz: number = 6000,
  audioCenterFreqHz: number = 1250
): Float32Array {
    // The benchmark centres the tone grid on audioCenterFreqHz, so tone 0 sits 7.5 spacings
    // below it; the generator takes the frequency of tone 0 directly.
    const baseFreqHz = audioCenterFreqHz - 7.5 * Z30_SPECS.TONE_SPACING_HZ;
    return synthesizeFrameSamples(symbols75, baseFreqHz, sampleRateHz, 1.0);
  }

  /**
   * Injects calibrated Gaussian noise (AWGN) referenced to standard 2500 Hz audio bandwidth
   */
  public addCalibratedAwgn(
    cleanWaveform: Float32Array,
    snr2500HzDb: number,
    sampleRateHz: number = 6000
  ): { noisyWaveform: Float32Array; noiseOnly: Float32Array; sigma: number } {
    const len = cleanWaveform.length;
    let signalEnergy = 0.0;
    for (let i = 0; i < len; i++) {
      signalEnergy += cleanWaveform[i] * cleanWaveform[i];
    }
    const signalPower = signalEnergy / len;

    // In amateur radio digital modes (WSJT-X / FT8 / z-30):
    // SNR is referenced to 2500 Hz noise bandwidth.
    // Over Nyquist bandwidth Fs/2, total noise power is sigma^2.
    // Noise power in 2500 Hz = sigma^2 * (2500 / (Fs / 2)) = sigma^2 * (5000 / Fs)
    // SNR_linear = signalPower / (sigma^2 * (5000 / Fs))
    // sigma = sqrt( signalPower / ( 10^(snrDb / 10) * (5000 / Fs) ) )
    const snrLinear = Math.pow(10, snr2500HzDb / 10.0);
    const bandwidthFactor = 5000.0 / sampleRateHz;
    const sigma = Math.sqrt(signalPower / (snrLinear * bandwidthFactor));

    const noisyWaveform = new Float32Array(len);
    const noiseOnly = new Float32Array(len);

    // Box-Muller Gaussian Noise Generator
    for (let i = 0; i < len; i += 2) {
      const u1 = Math.max(1e-12, this.rng.next());
      const u2 = this.rng.next();
      const mag = sigma * Math.sqrt(-2.0 * Math.log(u1));
      const z0 = mag * Math.cos(2.0 * Math.PI * u2);
      const z1 = mag * Math.sin(2.0 * Math.PI * u2);

      noiseOnly[i] = z0;
      noisyWaveform[i] = cleanWaveform[i] + z0;

      if (i + 1 < len) {
        noiseOnly[i + 1] = z1;
        noisyWaveform[i + 1] = cleanWaveform[i + 1] + z1;
      }
    }

    return { noisyWaveform, noiseOnly, sigma };
  }

  /**
   * Builds the audio stream a receiver would actually be handed in realistic mode.
   *
   * Three things the ideal path does not do, and which together cost about 2.3 dB in this
   * engine (measured: this engine's 50% crossings are -22.94 dB realistic against -25.28 dB
   * ideal, 200 frames a point, seed 20260830; the Python benchmark's own gap is 1.66 dB, and
   * wiki/16 records that the two engines' BOUNDS differ by 0.70 dB while their thresholds
   * differ by 0.02 dB):
   *   - the frame sits at a RANDOM carrier offset, not exactly on the nominal centre;
   *   - it starts at a RANDOM time, not at sample zero;
   *   - it is surrounded by noise-only audio, so the receiver has to find it.
   *
   * Offsets are drawn from the run's seeded PRNG, so a realistic run is as reproducible as an
   * ideal one.
   */
  public synthesizeReceivedStream(
    symbols75: number[],
    snr2500HzDb: number,
    config: MonteCarloConfig
  ): {
    stream: Float32Array;
    trueStartSample: number;
    trueCentreFreqHz: number;
    sigma: number;
  } {
    const sampleRateHz = config.sampleRateHz;
    const carrierHalfHz = config.carrierOffsetHz ?? 5.0;
    const timingHalfSec = config.timingOffsetSec ?? 0.5;

    const carrierOffsetHz = (this.rng.next() * 2 - 1) * carrierHalfHz;
    const timingOffsetSec = (this.rng.next() * 2 - 1) * timingHalfSec;

    const trueCentreFreqHz = config.audioCenterFreqHz + carrierOffsetHz;
    let clean = this.synthesizePhysicalWaveform(symbols75, sampleRateHz, trueCentreFreqHz);

    if (config.channelModel === 'RAYLEIGH_FADING') {
      clean = this.applyRayleighFading(clean, sampleRateHz, config.fadingDopplerHz || 0.5);
    }

    // Guard either side, wide enough that the true start can move by the full timing offset
    // and still leave noise-only audio at both ends - which is what gives the search
    // somewhere to be wrong, and the noise estimator somewhere to look.
    const guardSamples = Math.round((timingHalfSec + 0.25) * sampleRateHz);
    const trueStartSample = guardSamples + Math.round(timingOffsetSec * sampleRateHz);
    const totalLen = clean.length + 2 * guardSamples;

    const padded = new Float32Array(totalLen);
    padded.set(clean, trueStartSample);

    // Noise is calibrated against the SIGNAL's own power, not the padded stream's mean power
    // (which the guard would drag down and so quietly raise the true SNR).
    let signalEnergy = 0.0;
    for (let i = 0; i < clean.length; i++) signalEnergy += clean[i] * clean[i];
    const signalPower = signalEnergy / clean.length;
    const snrLinear = Math.pow(10, snr2500HzDb / 10.0);
    const bandwidthFactor = 5000.0 / sampleRateHz;
    const sigma = Math.sqrt(signalPower / (snrLinear * bandwidthFactor));

    for (let i = 0; i < totalLen; i += 2) {
      const u1 = Math.max(1e-12, this.rng.next());
      const u2 = this.rng.next();
      const mag = sigma * Math.sqrt(-2.0 * Math.log(u1));
      padded[i] += mag * Math.cos(2.0 * Math.PI * u2);
      if (i + 1 < totalLen) padded[i + 1] += mag * Math.sin(2.0 * Math.PI * u2);
    }

    return { stream: padded, trueStartSample, trueCentreFreqHz, sigma };
  }

  /**
   * Estimates the per-sample noise standard deviation from the stream itself.
   *
   * A real receiver is not told the noise floor. This measures it the way one must: correlate
   * the audio against a set of probe frequencies well away from the 50 Hz-wide signal, and
   * take the MEDIAN of the resulting powers. For real Gaussian noise of standard deviation
   * sigma, the in-phase and quadrature correlator outputs over N samples each have variance
   * sigma^2 * N / 2, so E[I^2 + Q^2] = sigma^2 * N.
   *
   * The median rather than the mean, so a strong carrier sitting on one probe frequency does
   * not inflate the estimate; and divided by ln(2), because the median of an exponentially
   * distributed periodogram sits below its mean by exactly that factor.
   */
  public estimateNoiseSigma(
    stream: Float32Array,
    sampleRateHz: number,
    signalCentreHz: number
  ): number {
    const windowLen = Math.min(stream.length, Math.round(sampleRateHz * Z30_SPECS.SYMBOL_DURATION_SEC));
    if (windowLen < 64) return 1e-9;

    // Probes spread across the audio passband, skipping a 250 Hz guard around the signal.
    const probes: number[] = [];
    for (let f = 300; f <= Math.min(2600, sampleRateHz / 2 - 200); f += 47) {
      if (Math.abs(f - signalCentreHz) > 250) probes.push(f);
    }
    if (probes.length === 0) return 1e-9;

    // A few windows spread through the stream, so a transient does not dominate.
    const windowStarts: number[] = [];
    const maxStart = stream.length - windowLen;
    for (let w = 0; w < 4; w++) {
      windowStarts.push(Math.max(0, Math.round((maxStart * w) / 3)));
    }

    const powers: number[] = [];
    for (const start of windowStarts) {
      for (const freq of probes) {
        let re = 0.0;
        let im = 0.0;
        const step = (2.0 * Math.PI * freq) / sampleRateHz;
        for (let n = 0; n < windowLen; n++) {
          const sample = stream[start + n];
          re += sample * Math.cos(step * n);
          im += sample * Math.sin(step * n);
        }
        powers.push(re * re + im * im);
      }
    }

    powers.sort((a, b) => a - b);
    const median = powers[Math.floor(powers.length / 2)];
    const meanPower = median / Math.LN2;
    return Math.max(1e-9, Math.sqrt(meanPower / windowLen));
  }

  /**
   * Finds a z-30 frame in a stream using only the 21 Costas sync symbols.
   *
   * The twin of z30_dsp/acquisition.py, and the reason a realistic run in this engine measures
   * about 2.3 dB worse than its genie-aided bound. Two stages, because a search fine enough to be useful is
   * too large to run directly:
   *   1. Coarse: a grid over start time (one fifth of a symbol) and carrier offset (1 Hz),
   *      scored by summing the matched-filter power at the 21 known sync tones.
   *   2. Fine: a local grid around the coarse peak, refining timing to ~5 ms and frequency to
   *      0.1 Hz - comfortably inside what 3.125 Hz tone spacing needs.
   *
   * `found` is false when nothing in the search space stands out from the noise floor. That is
   * the honest answer at low SNR, and the caller counts it as a decode failure rather than
   * papering over it by demodulating at the nominal position anyway.
   */
  public acquireFrame(
    stream: Float32Array,
    config: MonteCarloConfig
  ): {
    found: boolean;
    startSample: number;
    centreFreqHz: number;
    syncScoreDb: number;
  } {
    const sampleRateHz = config.sampleRateHz;
    const nsps = Math.round(sampleRateHz * Z30_SPECS.SYMBOL_DURATION_SEC);
    const syncPositions = Z30_SPECS.SYNC_POSITIONS;
    const syncTones = Z30_SPECS.SYNC_TONES;
    const spacing = Z30_SPECS.TONE_SPACING_HZ;
    const frameSamples = Z30_SPECS.TOTAL_SYMBOLS * nsps;

    const nominalStart = Math.round(((config.timingOffsetSec ?? 0.5) + 0.25) * sampleRateHz);
    const timingSearch = Math.round(
      ((config.timingOffsetSec ?? 0.5) + SLOT_SEARCH_MARGIN_SEC) * sampleRateHz
    );
    // Deliberately much wider than the offset actually applied: a receiver does not know how
    // far off the transmitter is, and a search that only just covers the true range flatters
    // the result. z30_dsp/acquisition.py searches +/-12 Hz by default; this matches it.
    const freqSearch = Math.max(12.0, (config.carrierOffsetHz ?? 5.0) + 1.5);

    // Sums the sync-tone matched-filter power for one (start, centre) hypothesis.
    const scoreCandidate = (start: number, centreHz: number): number => {
      if (start < 0 || start + frameSamples > stream.length) return -Infinity;
      let total = 0.0;
      for (let k = 0; k < syncPositions.length; k++) {
        const toneFreq = centreHz + (syncTones[k] - 7.5) * spacing;
        const base = start + syncPositions[k] * nsps;
        const step = (2.0 * Math.PI * toneFreq) / sampleRateHz;
        let re = 0.0;
        let im = 0.0;
        for (let n = 0; n < nsps; n++) {
          const sample = stream[base + n];
          const theta = step * n;
          re += sample * Math.cos(theta);
          im += sample * Math.sin(theta);
        }
        total += re * re + im * im;
      }
      return total;
    };

    // ---- coarse stage ----
    const coarseTimeStep = Math.max(1, Math.round(nsps / 5));
    const coarseFreqStep = 1.0;
    let bestScore = -Infinity;
    let bestStart = nominalStart;
    let bestFreq = config.audioCenterFreqHz;
    const coarseScores: number[] = [];

    for (let dt = -timingSearch; dt <= timingSearch; dt += coarseTimeStep) {
      for (let df = -freqSearch; df <= freqSearch + 1e-9; df += coarseFreqStep) {
        const score = scoreCandidate(nominalStart + dt, config.audioCenterFreqHz + df);
        if (!Number.isFinite(score)) continue;
        coarseScores.push(score);
        if (score > bestScore) {
          bestScore = score;
          bestStart = nominalStart + dt;
          bestFreq = config.audioCenterFreqHz + df;
        }
      }
    }

    if (coarseScores.length === 0 || !Number.isFinite(bestScore)) {
      return { found: false, startSample: nominalStart, centreFreqHz: config.audioCenterFreqHz, syncScoreDb: -Infinity };
    }

    // ---- fine stage ----
    const fineTimeStep = Math.max(1, Math.round(nsps / 64));
    for (let dt = -coarseTimeStep; dt <= coarseTimeStep; dt += fineTimeStep) {
      for (let df = -coarseFreqStep; df <= coarseFreqStep + 1e-9; df += 0.1) {
        const score = scoreCandidate(bestStart + dt, bestFreq + df);
        if (score > bestScore) {
          bestScore = score;
          bestStart = bestStart + dt;
          bestFreq = bestFreq + df;
        }
      }
    }

    // How far the winner stands above a typical point in the search space. A frame that is
    // present lifts its own hypothesis well clear of the field; noise alone does not.
    coarseScores.sort((a, b) => a - b);
    const floor = coarseScores[Math.floor(coarseScores.length / 2)];
    const syncScoreDb = floor > 0 ? 10.0 * Math.log10(bestScore / floor) : -Infinity;

    return {
      found: syncScoreDb > ACQUISITION_SYNC_THRESHOLD_DB,
      startSample: bestStart,
      centreFreqHz: bestFreq,
      syncScoreDb,
    };
  }

  /**
   * Applies Rayleigh / ITU-R F.1487 Ionospheric Multipath Fading
   */
  public applyRayleighFading(
    cleanWaveform: Float32Array,
    sampleRateHz: number = 6000,
    dopplerHz: number = 0.5,
    delayMs: number = 1.0
  ): Float32Array {
    const len = cleanWaveform.length;
    const delaySamples = Math.max(1, Math.round((delayMs / 1000.0) * sampleRateHz));
    const faded = new Float32Array(len);

    // Two-path Watterson model: Direct path + Delayed path with slow random Rayleigh amplitude & phase
    let phase1 = this.rng.next() * 2 * Math.PI;
    let phase2 = this.rng.next() * 2 * Math.PI;
    let gain1 = 1.0;
    let gain2 = 0.7;

    const dt = 1.0 / sampleRateHz;
    const dPhi = 2 * Math.PI * dopplerHz * dt;

    for (let i = 0; i < len; i++) {
      phase1 += dPhi * (0.8 + 0.4 * this.rng.next());
      phase2 += dPhi * 1.3 * (0.8 + 0.4 * this.rng.next());
      gain1 = 0.8 + 0.4 * Math.sin(phase1);
      gain2 = 0.5 + 0.3 * Math.cos(phase2);

      const path1 = cleanWaveform[i] * gain1;
      const path2 = (i >= delaySamples ? cleanWaveform[i - delaySamples] : 0.0) * gain2;
      faded[i] = (path1 + path2) * 0.707;
    }

    return faded;
  }

  /**
   * High-Precision Abramowitz-Stegun Log Modified Bessel Function of the First Kind ln(I0(x))
   */
  private logBesselI0(z: number): number {
    const x = Math.abs(z);
    if (x < 3.75) {
      const y = (x / 3.75) * (x / 3.75);
      const val = 1.0 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
      return Math.log(Math.max(1e-15, val));
    } else {
      const y = 3.75 / x;
      const poly = 0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377)))))));
      return x + Math.log(Math.max(1e-15, poly / Math.sqrt(x)));
    }
  }

  /**
   * Numerically Stable Log-Sum-Exp operator: ln(e^a + e^b) = max(a,b) + ln(1 + e^-|a-b|)
   */
  private logSumExpPair(a: number, b: number): number {
    const maxVal = Math.max(a, b);
    const minVal = Math.min(a, b);
    const diff = minVal - maxVal;
    if (diff < -40.0) return maxVal;
    return maxVal + Math.log1p(Math.exp(diff));
  }

  private logSumExpArray(values: number[]): number {
    if (values.length === 0) return -1e9;
    let acc = values[0];
    for (let i = 1; i < values.length; i++) {
      acc = this.logSumExpPair(acc, values[i]);
    }
    return acc;
  }

  /**
   * Demodulates physical noisy 16-MFSK waveform via matched-filter correlator bank
   * with Pilot-Aided Semi-Coherent Channel Tracking from 21 Costas Sync Symbols
   * Extracts optimal Log-MAP soft channel Log-Likelihood Ratios (LLRs) for all 216 LDPC bits
   */
  public demodulateToLlrs(
    noisyWaveform: Float32Array,
    sampleRateHz: number = 6000,
    audioCenterFreqHz: number = 1250,
    sigma: number = 1.0,
    /**
     * Sample index where the frame starts. Zero on the ideal path, where the frame is at the
     * top of the buffer by construction; in realistic mode this is whatever the acquisition
     * stage decided, which is the point - a receiver demodulates where it BELIEVES the frame
     * is, and pays for being wrong.
     */
    frameStartSample: number = 0,
    /**
     * Weight given to the pilot-derived COHERENT phase reference, 0..1, or `null` to use the
     * built-in distance-weighted schedule.
     *
     * Pass 0 for purely non-coherent detection. The coherent term buys a little on a clean,
     * perfectly-timed buffer, but its reference is a phase, and a timing error of a few
     * milliseconds rotates each tone by 2*pi*f*dt - by up to several radians across the 50 Hz
     * tone span. Once that happens the "coherent" term is subtracting signal rather than
     * adding it, which showed up as frames failing at 12 ms of timing error even at -12 dB SNR
     * where nothing should fail. A receiver that has just found the frame blind cannot trust
     * its timing to that precision, which is why z-30's receiver is specified as
     * non-coherent (AGENTS.md §1).
     */
    coherentWeight: number | null = null
  ): {
    channelLlrs: Float32Array; // 216 soft LLRs
    correlatorEnergies: number[][]; // 54 data symbols x 16 tone energies
    detectedDataSymbols: number[];
  } {
    const symbolDurationSec = Z30_SPECS.SYMBOL_DURATION_SEC;
    const toneSpacingHz = Z30_SPECS.TONE_SPACING_HZ;
    const samplesPerSymbol = Math.round(sampleRateHz * symbolDurationSec);
    const syncPositions = Z30_SPECS.SYNC_POSITIONS;
    const syncPosSet = new Set(syncPositions);
    const syncTones = Z30_SPECS.SYNC_TONES;

    const channelLlrs = new Float32Array(216);
    const correlatorEnergies: number[][] = [];
    const detectedDataSymbols: number[] = [];

    // 1. First pass: Measure complex channel response & phase on all 21 Costas sync pilots
    const pilotFrames: number[] = [];
    const pilotPhases: number[] = [];
    const pilotAmps: number[] = [];

    let syncCount = 0;
    for (let f = 0; f < 75; f++) {
      if (syncPosSet.has(f)) {
        const toneIdx = syncTones[syncCount % syncTones.length];
        syncCount++;
        const toneFreq = audioCenterFreqHz + (toneIdx - 7.5) * toneSpacingHz;
        const startSamp = frameStartSample + f * samplesPerSymbol;

        let re = 0.0;
        let im = 0.0;
        for (let n = 0; n < samplesPerSymbol; n++) {
          const sample = noisyWaveform[startSamp + n] || 0.0;
          const theta = (2.0 * Math.PI * toneFreq * n) / sampleRateHz;
          re += sample * Math.cos(theta);
          im += sample * Math.sin(theta);
        }

        const amp = Math.sqrt(re * re + im * im) / (samplesPerSymbol / 2.0);
        const phase = Math.atan2(im, re);

        pilotFrames.push(f);
        pilotPhases.push(phase);
        pilotAmps.push(amp);
      }
    }

    // Standard noise variance of real/imag correlator quadrature: sigma0^2 = (sigma^2 * N) / 2
    const quadNoiseVar = Math.max(1e-12, (sigma * sigma * samplesPerSymbol) / 2.0);
    // Estimated signal peak amplitude in matched filter
    const estSigAmp = Math.max(0.01, pilotAmps.reduce((a, b) => a + b, 0) / Math.max(1, pilotAmps.length));
    const sCorr = (estSigAmp * samplesPerSymbol / 2.0) / quadNoiseVar;

    // Continuous-phase FSK carries phase across symbol boundaries: each symbol advances the
    // synthesizer's phase accumulator by 2*pi*toneFreq*symbolDuration mod 2*pi. Because
    // toneSpacingHz is exactly 1/symbolDurationSec by construction, that increment is
    // IDENTICAL for every tone (the per-tone term is always a whole number of cycles, plus
    // a fixed extra pi from the -7.5 center offset here) - it only depends on
    // audioCenterFreqHz. The phase gap between a pilot and a nearby data symbol is therefore
    // fully predictable and must be added back in before projecting onto the pilot's raw
    // phase, or the "coherent" LLR term is measured against the wrong reference for any
    // audioCenterFreqHz that isn't an exact multiple of toneSpacingHz.
    const nominalPhaseStep = ((2.0 * Math.PI * audioCenterFreqHz * symbolDurationSec) + Math.PI) % (2.0 * Math.PI);

    // The nominal step above is only exact when the demodulator sits on the EXACT carrier.
    // After blind acquisition it does not: a residual of a few tenths of a Hz leaves a phase
    // error of 2*pi*df*Ts per symbol, which accumulates over the gap to the nearest pilot and
    // wrecks the coherent term - several dB, and invisible in ideal mode where the residual is
    // zero by construction.
    //
    // So measure the real per-symbol phase increment from the pilots instead of assuming it.
    // Adjacent Costas pilots (the clusters at 0,1,2 / 7,8,9 / ... are one symbol apart) give
    // an unambiguous estimate: over one symbol the residual cannot wrap. Averaged as unit
    // vectors so that the average is a circular mean rather than a wrap-broken arithmetic one.
    // This is ordinary pilot-aided AFC - it uses only what the receiver actually received.
    let driftRe = 0.0;
    let driftIm = 0.0;
    for (let p = 1; p < pilotFrames.length; p++) {
      if (pilotFrames[p] - pilotFrames[p - 1] !== 1) continue;
      const residual = pilotPhases[p] - pilotPhases[p - 1] + nominalPhaseStep;
      driftRe += Math.cos(residual);
      driftIm += Math.sin(residual);
    }
    const perSymbolDrift = driftRe === 0 && driftIm === 0 ? 0 : Math.atan2(driftIm, driftRe);
    const basePhaseStep = nominalPhaseStep - perSymbolDrift;

    let dataSymbolIdx = 0;

    for (let frameSymIdx = 0; frameSymIdx < 75; frameSymIdx++) {
      if (syncPosSet.has(frameSymIdx)) {
        // Skip sync symbols for data payload LLR calculation
        continue;
      }

      // Interpolate pilot phase for current data symbol, propagated via the known
      // per-symbol continuous-phase increment.
      let closestPilotIdx = 0;
      let minPilotDist = 999;
      for (let p = 0; p < pilotFrames.length; p++) {
        const dist = Math.abs(pilotFrames[p] - frameSymIdx);
        if (dist < minPilotDist) {
          minPilotDist = dist;
          closestPilotIdx = p;
        }
      }
      const rawPhase = (pilotPhases[closestPilotIdx] || 0.0) - basePhaseStep * (frameSymIdx - pilotFrames[closestPilotIdx]);
      const interpPhase = Math.atan2(Math.sin(rawPhase), Math.cos(rawPhase));
      const pilotCoherence =
        coherentWeight !== null
          ? coherentWeight
          : Math.max(0.35, Math.min(0.85, 1.0 / (1.0 + 0.15 * minPilotDist)));

      const startSamp = frameStartSample + frameSymIdx * samplesPerSymbol;
      const energies = new Float32Array(16);
      const toneLogLikes: number[] = new Array(16).fill(0);

      // 16-tone matched filter correlator
      for (let tone = 0; tone < 16; tone++) {
        const toneFreq = audioCenterFreqHz + (tone - 7.5) * toneSpacingHz;
        let realCorr = 0.0;
        let imagCorr = 0.0;

        for (let n = 0; n < samplesPerSymbol; n++) {
          const sample = noisyWaveform[startSamp + n] || 0.0;
          const theta = (2.0 * Math.PI * toneFreq * n) / sampleRateHz;
          realCorr += sample * Math.cos(theta);
          imagCorr += sample * Math.sin(theta);
        }

        // Raw energy
        const rawEnergy = realCorr * realCorr + imagCorr * imagCorr;
        energies[tone] = rawEnergy;

        // Non-coherent envelope: R = sqrt(rawEnergy)
        const envelope = Math.sqrt(rawEnergy);
        const z = envelope * sCorr;
        const nonCoherentPart = this.logBesselI0(z);

        // Coherent projection onto interpolated pilot phase
        const proj = realCorr * Math.cos(interpPhase) + imagCorr * Math.sin(interpPhase);
        const coherentPart = proj * sCorr;

        // Semi-coherent joint log-likelihood
        toneLogLikes[tone] = pilotCoherence * coherentPart + (1.0 - pilotCoherence) * nonCoherentPart;
      }

      correlatorEnergies.push(Array.from(energies));

      // Find max energy tone for raw hard decision
      let maxTone = 0;
      let maxEnergy = energies[0];
      for (let t = 1; t < 16; t++) {
        if (energies[t] > maxEnergy) {
          maxEnergy = energies[t];
          maxTone = t;
        }
      }
      detectedDataSymbols.push(maxTone);

      // Exact Log-MAP demapping from 16 tone log-likelihoods to 4 soft bit LLRs
      for (let bit = 0; bit < 4; bit++) {
        const bitMask = 1 << (3 - bit);
        const logLikes0: number[] = [];
        const logLikes1: number[] = [];

        for (let tone = 0; tone < 16; tone++) {
          if ((tone & bitMask) === 0) {
            logLikes0.push(toneLogLikes[tone]);
          } else {
            logLikes1.push(toneLogLikes[tone]);
          }
        }

        const lse0 = this.logSumExpArray(logLikes0);
        const lse1 = this.logSumExpArray(logLikes1);
        const llrVal = lse0 - lse1;

        // Clamp LLRs for numerical stability
        const clampedLlr = Math.max(-25.0, Math.min(25.0, llrVal));
        channelLlrs[dataSymbolIdx * 4 + bit] = clampedLlr;
      }

      dataSymbolIdx++;
    }

    return {
      channelLlrs,
      correlatorEnergies,
      detectedDataSymbols,
    };
  }

  /**
   * Exact Matched-Filter Bank & Log-MAP Soft LLR Demodulator (High-Throughput Rigorous Monte Carlo)
   * Implements the exact 16-ary orthogonal signaling matched filter receiver model (Proakis):
   *   Y_t = delta_{t, tx} * sqrt(2 * Es/N0) * exp(j*theta) + N_t, where N_t ~ CN(0, 2)
   *   Es/N0 = SNR_2500_linear * 2500 * Ts = SNR_2500_linear * 800
   *   Exact Log-MAP bit LLRs via Log-Sum-Exp over 16-tone log-likelihoods.
   */
  public generateChannelLlrsFast(
    codeword216: number[],
    dataSymbols54: number[],
    snr2500HzDb: number,
    channelModel: ChannelModelType = 'AWGN'
  ): { channelLlrs: Float32Array; rawBitErrors: number } {
    // Amateur radio standard: SNR is referenced to 2500 Hz audio bandwidth.
    // Symbol duration Ts = 0.320 s (Tone spacing df = 3.125 Hz).
    // Matched filter processing gain = 2500 * 0.320 = 800 (+29.0309 dB).
    const snrLinear = Math.pow(10, snr2500HzDb / 10.0);
    const esN0Linear = Math.max(1e-9, snrLinear * 800.0);
    const signalAmp = Math.sqrt(2.0 * esN0Linear);

    const channelLlrs = new Float32Array(216);
    let rawBitErrors = 0;

    for (let s = 0; s < 54; s++) {
      const txTone = dataSymbols54[s];
      const toneLogLikes: number[] = new Array(16).fill(0);

      // Fading channel amplitude multiplier: Rayleigh distribution
      let fadeAmp = 1.0;
      if (channelModel === 'RAYLEIGH_FADING') {
        const g1 = Math.max(1e-12, this.rng.next());
        const g2 = this.rng.next();
        const rI = Math.sqrt(-Math.log(g1)) * Math.cos(2.0 * Math.PI * g2);
        const rQ = Math.sqrt(-Math.log(g1)) * Math.sin(2.0 * Math.PI * g2);
        fadeAmp = Math.sqrt(rI * rI + rQ * rQ);
      }

      const effAmp = signalAmp * fadeAmp;
      // Carrier phase on current symbol
      const carrierPhase = this.rng.next() * 2.0 * Math.PI;

      // Pilot phase estimation tracking variance from 21 Costas sync symbols
      const pilotPhaseErrorStd = 1.0 / Math.sqrt(Math.max(0.1, 2.0 * esN0Linear * 1.5));
      const estCarrierPhase = carrierPhase + (this.rng.next() - 0.5) * 2.0 * pilotPhaseErrorStd;
      const pilotWeight = Math.max(0.2, Math.min(0.95, esN0Linear / (esN0Linear + 1.5)));

      for (let t = 0; t < 16; t++) {
        // Complex circular Gaussian noise: N_I, N_Q ~ N(0, 1)
        const u1 = Math.max(1e-12, this.rng.next());
        const u2 = this.rng.next();
        const u3 = Math.max(1e-12, this.rng.next());
        const u4 = this.rng.next();

        const nI = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const nQ = Math.sqrt(-2.0 * Math.log(u3)) * Math.sin(2.0 * Math.PI * u4);

        const isTx = t === txTone;
        const sI = isTx ? effAmp * Math.cos(carrierPhase) : 0.0;
        const sQ = isTx ? effAmp * Math.sin(carrierPhase) : 0.0;

        const totalI = sI + nI;
        const totalQ = sQ + nQ;

        // Non-coherent envelope: R = sqrt(I^2 + Q^2)
        const envelope = Math.sqrt(totalI * totalI + totalQ * totalQ);
        const nonCoherentMetric = this.logBesselI0(envelope * effAmp);

        // Pilot-aided coherent projection: Re{ Y * exp(-j*estCarrierPhase) }
        const coherentProj = totalI * Math.cos(estCarrierPhase) + totalQ * Math.sin(estCarrierPhase);
        const coherentMetric = coherentProj * effAmp;

        // Joint log-likelihood metric
        toneLogLikes[t] = pilotWeight * coherentMetric + (1.0 - pilotWeight) * nonCoherentMetric;
      }

      // Exact Log-MAP demapping from 16 tone log-likelihoods to 4 soft bit LLRs
      for (let b = 0; b < 4; b++) {
        const bitIdx = s * 4 + b;
        const bitMask = 1 << (3 - b);
        const logLikes0: number[] = [];
        const logLikes1: number[] = [];

        for (let t = 0; t < 16; t++) {
          if ((t & bitMask) === 0) {
            logLikes0.push(toneLogLikes[t]);
          } else {
            logLikes1.push(toneLogLikes[t]);
          }
        }

        const lse0 = this.logSumExpArray(logLikes0);
        const lse1 = this.logSumExpArray(logLikes1);
        const llr = lse0 - lse1;

        channelLlrs[bitIdx] = Math.max(-30.0, Math.min(30.0, llr));

        const hardDecision = llr < 0 ? 1 : 0;
        if (hardDecision !== codeword216[bitIdx]) {
          rawBitErrors++;
        }
      }
    }

    return { channelLlrs, rawBitErrors };
  }

  /**
   * Calculates 95% Wilson Score Confidence Interval for binomial proportion
   */
  public calculateWilsonConfidenceInterval(successes: number, total: number): [number, number] {
    if (total === 0) return [0, 0];
    const p = successes / total;
    const z = 1.96; // 95% confidence
    const z2 = z * z;
    const denominator = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / denominator;
    const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
    return [
      Math.max(0, Number(((center - margin) * 100).toFixed(2))),
      Math.min(100, Number(((center + margin) * 100).toFixed(2))),
    ];
  }

  /**
   * Executes complete Monte Carlo simulation across user-defined SNR points
   */
  public async runSimulation(config: MonteCarloConfig = DEFAULT_MONTE_CARLO_CONFIG): Promise<SnrPointResult[]> {
    // Re-seed at the top of every run so the same configuration always produces the same
    // curve, whatever ran before it in this session.
    this.rng = createSeededRandom(config.seed ?? DEFAULT_MONTE_CARLO_SEED);
    this.isCancelled = false;
    this.isPaused = false;

    const customCodec = new Z30LdpcEngine();

    // Generate SNR grid
    const snrPoints: number[] = [];
    for (let snr = config.minSnrDb; snr <= config.maxSnrDb + 1e-4; snr += config.snrStepDb) {
      snrPoints.push(Number(snr.toFixed(2)));
    }

    const results: SnrPointResult[] = [];
    this.currentProgress = {
      isRunning: true,
      isPaused: false,
      currentSnrIdx: 0,
      totalSnrPoints: snrPoints.length,
      currentFrameInPoint: 0,
      totalFramesPerPoint: config.framesPerPoint,
      overallProgressPercent: 0,
      currentSnrDb: snrPoints[0],
      currentResults: [],
    };
    this.notify();

    const totalFramesAll = snrPoints.length * config.framesPerPoint;
    let completedFramesOverall = 0;

    for (let ptIdx = 0; ptIdx < snrPoints.length; ptIdx++) {
      if (this.isCancelled) break;

      const snr = snrPoints[ptIdx];
      const tStart = performance.now();

      let successCount = 0;
      let failureCount = 0;
      let totalRawBitErrors = 0;
      let totalPostLdpcBitErrors = 0;
      let totalIterations = 0;
      let minIter = 999;
      let maxIter = 0;
      let acquisitionFailures = 0;
      let timingSqErrSumMs = 0;
      let freqSqErrSumHz = 0;
      let acquiredCount = 0;

      // Update progress state
      this.currentProgress.currentSnrIdx = ptIdx;
      this.currentProgress.currentSnrDb = snr;
      this.currentProgress.currentFrameInPoint = 0;

      for (let f = 0; f < config.framesPerPoint; f++) {
        if (this.isCancelled) break;

        // Handle pause
        while (this.isPaused && !this.isCancelled) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // 1. Generate random 63-bit payload
        const payload63 = this.generateRandomPayload();

        // 2. Assemble (216, 77) LDPC Codeword and 16-MFSK Symbols
        const { infoBits, codeword216, dataSymbols54, fullSymbols75 } = this.assembleFrameSymbols(payload63);

        let channelLlrs: Float32Array;
        let rawErrors = 0;

        // Realistic mode always runs the full physical chain: the fast correlator-bank path
        // models an ideal matched-filter receiver analytically and has nowhere to put an
        // acquisition stage, so it cannot produce a threshold - only a bound.
        const realistic = config.measurementMode === 'realistic';
        const runFullDsp = realistic || config.simulationMode === 'FULL_PHYSICAL_DSP' || f === 0;

        if (realistic) {
          const { stream, trueStartSample, trueCentreFreqHz } = this.synthesizeReceivedStream(
            fullSymbols75,
            snr,
            config
          );

          const acq = this.acquireFrame(stream, config);
          // The receiver measures the noise floor itself, at wherever it thinks the signal is.
          const estimatedSigma = this.estimateNoiseSigma(stream, config.sampleRateHz, acq.centreFreqHz);

          if (!acq.found) {
            // Nothing found. Counted as a failed frame, not retried at the true position -
            // that retry is exactly the gift that turns a threshold back into a bound.
            acquisitionFailures++;
            failureCount++;
            totalRawBitErrors += 108; // half of 216 bits: no information was recovered
            totalPostLdpcBitErrors += 39;
            totalIterations += config.maxLdpcIterations;
            if (config.maxLdpcIterations > maxIter) maxIter = config.maxLdpcIterations;
            if (config.maxLdpcIterations < minIter) minIter = config.maxLdpcIterations;

            completedFramesOverall++;
            this.currentProgress.currentFrameInPoint = f + 1;
            this.currentProgress.overallProgressPercent = Number(
              ((completedFramesOverall / totalFramesAll) * 100).toFixed(1)
            );
            if (f % 5 === 0 || f === config.framesPerPoint - 1) {
              this.notify();
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
            continue;
          }

          acquiredCount++;
          const timingErrMs = ((acq.startSample - trueStartSample) / config.sampleRateHz) * 1000;
          const freqErrHz = acq.centreFreqHz - trueCentreFreqHz;
          timingSqErrSumMs += timingErrMs * timingErrMs;
          freqSqErrSumHz += freqErrHz * freqErrHz;

          const demod = this.demodulateToLlrs(
            stream,
            config.sampleRateHz,
            acq.centreFreqHz,
            estimatedSigma,
            acq.startSample,
            // See RECEIVER_PILOT_COHERENCE. z30_dsp/benchmark.py applies the same weight in
            // realistic mode, which is what makes the two engines measure the same quantity.
            RECEIVER_PILOT_COHERENCE
          );
          channelLlrs = demod.channelLlrs;

          for (let i = 0; i < 216; i++) {
            const hardDec = channelLlrs[i] < 0 ? 1 : 0;
            if (hardDec !== codeword216[i]) rawErrors++;
          }

          if (f === 0) {
            const decResult = customCodec.decodeMinSum(channelLlrs, config.maxLdpcIterations);
            const previewStart = acq.startSample;
            this.currentProgress.latestWaveformPreview = {
              timeDomainClean: stream.slice(previewStart, previewStart + 300),
              timeDomainNoisy: stream.slice(previewStart, previewStart + 300),
              noiseOnly: stream.slice(0, 300),
              spectrumFreqs: [],
              spectrumMagnitudesDb: [],
              correlatorEnergies: demod.correlatorEnergies.slice(0, 12),
              transmittedSymbols: dataSymbols54.slice(0, 12),
              demodulatedSymbols: demod.detectedDataSymbols.slice(0, 12),
              channelLlrs: channelLlrs.slice(0, 32),
              snrDb: snr,
              decodedSuccess: decResult.success,
              iterations: decResult.iterations,
            };
          }
        } else if (runFullDsp) {
          // Synthesize physical 16-MFSK continuous-phase waveform
          let cleanWaveform = this.synthesizePhysicalWaveform(
            fullSymbols75,
            config.sampleRateHz,
            config.audioCenterFreqHz
          );

          if (config.channelModel === 'RAYLEIGH_FADING') {
            cleanWaveform = this.applyRayleighFading(
              cleanWaveform,
              config.sampleRateHz,
              config.fadingDopplerHz || 0.5
            );
          }

          // Add calibrated Gaussian noise (AWGN in 2500 Hz reference bandwidth)
          const { noisyWaveform, noiseOnly, sigma } = this.addCalibratedAwgn(
            cleanWaveform,
            snr,
            config.sampleRateHz
          );

          // Demodulate physical waveform via 16-tone matched filters
          const demod = this.demodulateToLlrs(
            noisyWaveform,
            config.sampleRateHz,
            config.audioCenterFreqHz,
            sigma
          );
          channelLlrs = demod.channelLlrs;

          // Count uncoded raw bit errors
          for (let i = 0; i < 216; i++) {
            const hardDec = channelLlrs[i] < 0 ? 1 : 0;
            if (hardDec !== codeword216[i]) rawErrors++;
          }

          // Provide visualizer preview for the first frame of the SNR point
          if (f === 0) {
            const previewSamples = Math.min(2048, noisyWaveform.length);
            const freqs: number[] = [];
            const magsDb: number[] = [];
            for (let k = 0; k < 64; k++) {
              const freq = config.audioCenterFreqHz - 60 + (k * 120) / 64;
              let re = 0.0;
              let im = 0.0;
              for (let n = 0; n < previewSamples; n++) {
                const angle = (2 * Math.PI * freq * n) / config.sampleRateHz;
                re += noisyWaveform[n] * Math.cos(angle);
                im += noisyWaveform[n] * Math.sin(angle);
              }
              const pwr = (re * re + im * im) / (previewSamples * previewSamples);
              freqs.push(Math.round(freq));
              magsDb.push(Number((10 * Math.log10(Math.max(1e-9, pwr))).toFixed(1)));
            }

            const decResult = customCodec.decodeMinSum(channelLlrs, config.maxLdpcIterations);

            this.currentProgress.latestWaveformPreview = {
              timeDomainClean: cleanWaveform.slice(0, 300),
              timeDomainNoisy: noisyWaveform.slice(0, 300),
              noiseOnly: noiseOnly.slice(0, 300),
              spectrumFreqs: freqs,
              spectrumMagnitudesDb: magsDb,
              correlatorEnergies: demod.correlatorEnergies.slice(0, 12),
              transmittedSymbols: dataSymbols54.slice(0, 12),
              demodulatedSymbols: demod.detectedDataSymbols.slice(0, 12),
              channelLlrs: channelLlrs.slice(0, 32),
              snrDb: snr,
              decodedSuccess: decResult.success,
              iterations: decResult.iterations,
            };
          }
        } else {
          // Accelerated Exact Matched-Filter Correlator Bank
          const fastRes = this.generateChannelLlrsFast(
            codeword216,
            dataSymbols54,
            snr,
            config.channelModel
          );
          channelLlrs = fastRes.channelLlrs;
          rawErrors = fastRes.rawBitErrors;
        }

        totalRawBitErrors += rawErrors;

        // 3. Run Actual Systematic (216, 77) Normalized Min-Sum LDPC Decoder
        const decodeResult = customCodec.decodeMinSum(channelLlrs, config.maxLdpcIterations);

        totalIterations += decodeResult.iterations;
        if (decodeResult.iterations < minIter) minIter = decodeResult.iterations;
        if (decodeResult.iterations > maxIter) maxIter = decodeResult.iterations;

        if (decodeResult.success && decodeResult.crcValid) {
          successCount++;
        } else {
          failureCount++;
          // Count residual post-LDPC errors in 77 info bits
          let postErrors = 0;
          for (let b = 0; b < 77; b++) {
            if (decodeResult.infoBits[b] !== infoBits[b]) postErrors++;
          }
          totalPostLdpcBitErrors += postErrors;
        }

        completedFramesOverall++;
        this.currentProgress.currentFrameInPoint = f + 1;
        this.currentProgress.overallProgressPercent = Number(
          ((completedFramesOverall / totalFramesAll) * 100).toFixed(1)
        );

        // Yield execution to browser event loop periodically to maintain UI responsiveness
        if (f % 5 === 0 || f === config.framesPerPoint - 1) {
          this.notify();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const elapsed = performance.now() - tStart;
      const fer = failureCount / config.framesPerPoint;
      const successRate = (successCount / config.framesPerPoint) * 100;
      const rawBer = totalRawBitErrors / (config.framesPerPoint * 216);
      const postBer = totalPostLdpcBitErrors / (config.framesPerPoint * 77);
      const avgIter = totalIterations / config.framesPerPoint;
      const ci = this.calculateWilsonConfidenceInterval(successCount, config.framesPerPoint);

      const pointResult: SnrPointResult = {
        snrDb: snr,
        totalFrames: config.framesPerPoint,
        successCount,
        failureCount,
        frameErrorRate: Number(fer.toFixed(4)),
        decodeSuccessRate: Number(successRate.toFixed(2)),
        rawChannelBer: Number(rawBer.toFixed(4)),
        postLdpcBer: Number(postBer.toFixed(5)),
        avgLdpcIterations: Number(avgIter.toFixed(1)),
        minIterations: minIter === 999 ? 0 : minIter,
        maxIterations: maxIter,
        confidenceInterval95: ci,
        elapsedMs: Math.round(elapsed),
        acquisitionFailures,
        timingRmsMs: acquiredCount > 0 ? Number(Math.sqrt(timingSqErrSumMs / acquiredCount).toFixed(1)) : 0,
        freqRmsHz: acquiredCount > 0 ? Number(Math.sqrt(freqSqErrSumHz / acquiredCount).toFixed(2)) : 0,
      };

      results.push(pointResult);
      this.currentProgress.currentResults = [...results];
      this.notify();
    }

    this.currentProgress.isRunning = false;
    this.currentProgress.isPaused = false;
    this.notify();
    return results;
  }
}

export const monteCarloEngine = new MonteCarloSimulationEngine();
