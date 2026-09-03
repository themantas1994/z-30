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
 *
 * Every one of those steps runs on a real waveform. There is exactly one receive path here, and
 * it is the shipped one: there was a second, faster path that drew per-tone Gaussians against
 * an assumed signalling model, it was the default, and it measured about 2 dB better than the
 * software anyone actually runs. See the note where `generateChannelLlrsFast` used to be, and
 * the verification pass in wiki/16.
 *
 * This is a bench instrument, not the reference benchmark. `z30_dsp/benchmark.py` is what CI
 * runs and what the published tables are copied from; this one exists to show which way a
 * change moved the curve without leaving the app. It models calibrated AWGN only - the ITU-R
 * F.1487 conditions belong to `z30_dsp/channel.py`, which implements them.
 */

import { createSeededRandom, DEFAULT_MONTE_CARLO_SEED, RandomSource } from './seededRandom';
import { synthesizeFrameSamples } from './z30Waveform';
import { Z30_SPECS } from './z30Constants';
import { Z30LdpcEngine } from './ldpcCodec';
import { encodeLdpc216_77, computeCrc14 } from './z30Codec';
import { RECEIVER_PILOT_COHERENCE } from './realReceiver';

/**
 * The channel this engine models: calibrated AWGN, and nothing else.
 *
 * It used to offer `RAYLEIGH_FADING` and `CO_CHANNEL_QRM` as well, and neither was what its
 * name said:
 *
 *  - `RAYLEIGH_FADING` ran `applyRayleighFading`, whose own comments called it a "two-path
 *    Watterson model" and "ITU-R F.1487". It was neither. Each path's gain was
 *    `0.8 + 0.4*sin(phase)` and `0.5 + 0.3*cos(phase)` - a deterministic sinusoid bounded away
 *    from zero, so the channel had no deep fades, no Rayleigh-distributed envelope, and no
 *    complex tap at all, which means it never rotated the carrier phase and so never spread a
 *    tone in frequency. Doppler spread is the one parameter this waveform can actually see
 *    (wiki/16), and that model did not produce it. z30_dsp/channel.py has the real thing:
 *    independent complex-Gaussian taps with a Gaussian Doppler spectrum, and the
 *    recommendation's own named test conditions. Fading belongs to the reference instrument.
 *  - `CO_CHANNEL_QRM` was selectable in the type and carried two configuration fields, and no
 *    code anywhere read either of them. Choosing it ran a plain AWGN sweep and labelled the
 *    result co-channel interference. That is the same defect AGENTS.md section 5 records
 *    against the withdrawn SIC collision figures: a number for a condition no instrument here
 *    measures.
 */
export type ChannelModelType = 'AWGN';

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

export interface SnrPointResult {
  snrDb: number; // in 2500 Hz reference bandwidth
  totalFrames: number;
  successCount: number;
  failureCount: number;
  frameErrorRate: number; // FER = failureCount / totalFrames
  decodeSuccessRate: number; // Success % = successCount / totalFrames * 100
  /**
   * Pre-LDPC uncoded bit error rate, post-LDPC residual bit error rate, and mean decoder
   * iterations - all averaged over `demodulatedFrames`, not over `totalFrames`.
   *
   * A realistic-mode frame the acquisition stage never found produces no LLRs, so it has no
   * bit errors and no iteration count. It used to be given 108 raw errors, 39 post-LDPC errors
   * and a full iteration cap - plausible values, measured by nothing - which put invented
   * numbers into these three columns at exactly the SNRs where acquisition is failing and the
   * columns are most read. Those frames are counted as failures in `frameErrorRate` and
   * `decodeSuccessRate`, which have `totalFrames` underneath them; they are simply absent from
   * these averages.
   */
  rawChannelBer: number;
  postLdpcBer: number;
  avgLdpcIterations: number;
  /** Frames that reached the demodulator: `totalFrames` minus `acquisitionFailures`. */
  demodulatedFrames: number;
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
  /** Calibrated AWGN. The only channel this engine models - see ChannelModelType. */
  channelModel: ChannelModelType;
  // No simulationMode. `MATCHED_FILTER_CORRELATOR_BANK` was the DEFAULT, and it never
  // synthesized a waveform or ran the shipped demodulator: it drew per-tone complex Gaussians
  // against an assumed 16-ary orthogonal signalling model and built its own pilot-phase-error
  // and pilot-weight schedule out of Es/N0. Measured against the physical chain at seed
  // 20260830, ideal mode, 200 frames a point, it decoded 334/600 frames from -26 to -24 dB
  // against the physical chain's 148/600 - a 50% crossing of -25.20 dB against -24.13 dB,
  // Fisher exact two-sided p = 3.7e-28 - and it is the source of the browser engine's
  // -25.28 dB "genie-aided bound" that wiki/16 could not reconcile with the Python one.
  // AGENTS.md
  // section 4 puts it plainly: a benchmark that reimplements the receiver measures the
  // reimplementation. There is now one path, and it is the physical one.
  //
  // No maxLdpcIterations either. It was a 10-120 input box wired straight into
  // `decodeMinSum`'s iteration cap, so a benchmark run could measure a decoder with a cap the
  // shipped receiver does not use - `decodeWithAp` in realReceiver.ts takes
  // LDPC_MAX_ITERATIONS and offers no way to change it. The Python benchmark reads the same
  // constant rather than taking one. Same reasoning that removed the alphaMinSum slider, which
  // at least could not move the curve; this one could.
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

/**
 * Sweep range that brackets the documented AWGN threshold, for the realistic mode.
 * The old default (-32 .. -22 dB) brackets the genie-aided bound instead, and in realistic
 * mode would sit almost entirely below the point where the sync pattern is findable at all.
 */
export const REALISTIC_SWEEP_DEFAULTS = { minSnrDb: -26.0, maxSnrDb: -16.0 };
/** Sweep range that brackets the genie-aided bound, for the ideal mode. */
export const IDEAL_SWEEP_DEFAULTS = { minSnrDb: -30.0, maxSnrDb: -20.0 };

/**
 * Frames per SNR point below which a run is exploratory rather than publishable.
 *
 * The twin of `PUBLISHABLE_FRAMES_PER_POINT` in z30_dsp/benchmark.py, pinned across the two
 * languages by tests/test_cross_language_parity.py. The Python benchmark has printed an
 * `EXPLORATORY RUN` notice below this figure for as long as the figure has existed; the
 * browser engine, which defaults to a quarter of it and offers a "Start Quick Sweep (25
 * frames/pt)" button, printed nothing at all and reported its crossing to two decimal places
 * either way. A decode rate is a binomial proportion: at 200 frames its 95% Wilson interval is
 * at worst +/-6.9 points, and at 25 it is +/-20, which is more than a dB on the crossing.
 */
export const PUBLISHABLE_FRAMES_PER_POINT = 200;

/**
 * Two-sided standard-normal quantile for a 95% interval, to the precision float64 carries.
 *
 * The twin of `WILSON_Z_95` in z30_dsp/benchmark.py, pinned by
 * tests/test_cross_language_parity.py. This side used to use a rounded 1.96, so the two
 * engines put slightly different intervals on the same counts - and the intervals are what
 * wiki/16 compares when it reports the two engines landing 0.10 dB apart.
 */
export const WILSON_Z_95 = 1.959963984540054;

export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  // Bracketing the default MODE's crossing, not the other one's. This used to be -32 .. -22,
  // which is the ideal-mode range: opening the modal and pressing Run swept nine points below
  // the SNR at which the Costas pattern is findable at all and one above it, so the default
  // run could not produce a crossing to interpolate.
  ...REALISTIC_SWEEP_DEFAULTS,
  snrStepDb: 1.0,
  framesPerPoint: 50,
  sampleRateHz: 6000, // 6 kHz fast high-res simulation rate (sub-Nyquist over 50Hz audio band)
  audioCenterFreqHz: 1250,
  channelModel: 'AWGN',
  // The honest default, matching `python -m z30_dsp.benchmark`'s own default. A benchmark
  // whose default mode produces a bound, presented in a modal that calls the result a
  // threshold, is how the retracted "+4 dB over FT8" claim happened the first time.
  measurementMode: 'realistic',
  carrierOffsetHz: 5.0,
  timingOffsetSec: 0.5,
  seed: DEFAULT_MONTE_CARLO_SEED,
};

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
   * Three things the ideal path does not do, and which together cost about 1.2 dB in this
   * engine (measured 2026-09-03: this engine's 50% crossings are -22.93 dB realistic against
   * -24.13 dB ideal, 200 frames a point, seed 20260830; the Python benchmark's own acquisition
   * loss is 1.66 dB, and wiki/16 records that the two engines' BOUNDS differ by 0.51 dB while
   * their thresholds differ by 0.10 dB). This used to read 2.3 dB, against an ideal crossing of
   * -25.28 dB that came from the removed analytic receive path rather than from this one:
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
    const clean = this.synthesizePhysicalWaveform(symbols75, sampleRateHz, trueCentreFreqHz);

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

  // No applyRayleighFading. It was headed "Applies Rayleigh / ITU-R F.1487 Ionospheric
  // Multipath Fading" and commented "Two-path Watterson model", and it was none of those: its
  // two path gains were `0.8 + 0.4*sin(phase)` and `0.5 + 0.3*cos(phase)`, real-valued
  // sinusoids bounded away from zero. A Watterson tap is a complex Gaussian process - Rayleigh
  // envelope, uniform phase, Gaussian Doppler spectrum - and the phase half is the half that
  // matters here, because Doppler spread against a 3.125 Hz tone spacing is the mechanism
  // wiki/16 records as the reason this mode loses the high-latitude channel. A real-valued
  // gain cannot spread a tone at all, so the model could not produce the one effect it was
  // there to produce, while its output was labelled with the recommendation's number.
  // z30_dsp/channel.py implements the real model against ITU-R F.1487's own test conditions;
  // fading is measured there.

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

  // No generateChannelLlrsFast. It was headed "Exact Matched-Filter Bank & Log-MAP Soft LLR
  // Demodulator" and was the DEFAULT simulation path, and it never touched a waveform: it drew
  // per-tone complex Gaussians against an assumed 16-ary orthogonal signalling model
  // (Y_t = delta * sqrt(2 Es/N0) e^{j theta} + N_t) and applied a pilot-phase-error standard
  // deviation and a pilot weight of its own invention - `esN0/(esN0 + 1.5)`, clamped to
  // 0.2..0.95 - neither of which exists anywhere in the shipped receiver.
  //
  // Measured at seed 20260830, ideal mode, AWGN, 200 frames a point over -26/-25/-24 dB, with
  // the removed path run from its own file as it stood in git: the analytic path decoded 30,
  // 117 and 187 of 200 where the physical chain decoded 5, 33 and 110. 50% crossings -25.20 dB
  // against -24.13 dB, pooled Fisher exact two-sided p = 3.7e-28 - unpaired, because the
  // analytic path never synthesizes a waveform and so has no channel realisation to share.
  // -25.20 dB is where wiki/16's "browser genie-aided bound of -25.28 dB", the figure it could
  // not reconcile with the Python benchmark's -24.58 dB, actually came from.
  //
  // AGENTS.md section 4 states the rule this broke: a sensitivity figure is a claim about the
  // program someone downloads, so the benchmark must run the receive chain that ships. The
  // same section records the last time this failed and what it cost (1.77 dB, p = 2.9e-36).
  // The engine now has one path, and it synthesizes a waveform and demodulates it.

  /**
   * Calculates 95% Wilson Score Confidence Interval for binomial proportion
   */
  public calculateWilsonConfidenceInterval(successes: number, total: number): [number, number] {
    if (total === 0) return [0, 0];
    const p = successes / total;
    // The exact two-sided 95% quantile, shared with z30_dsp/benchmark.py's WILSON_Z_95 and
    // pinned across the two languages. A rounded 1.96 used to live here, so the two engines
    // put measurably different intervals on identical counts - and the intervals are what
    // wiki/16 compares when it reports the engines landing 0.10 dB apart.
    const z = WILSON_Z_95;
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
      // Frames that actually reached the demodulator and the decoder, and so actually produced
      // a bit-error count and an iteration count. Equal to framesPerPoint everywhere except a
      // realistic-mode point where acquisition failed on some frames; those frames are still
      // failures in the FER, they simply have no per-bit or per-iteration measurement to
      // average. See the acquisition-failure branch below.
      let demodulatedCount = 0;

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

        const realistic = config.measurementMode === 'realistic';

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
            //
            // And counted ONLY as a failed frame. This used to add 108 raw bit errors
            // (216/2), 39 post-LDPC bit errors (77/2) and a full iteration cap to the running
            // totals, on the reasoning that a frame nobody found carries no information. Those
            // are three numbers nothing measured: no demodulator ran on this frame, so it has
            // no bit errors and no iteration count, and writing in the value they "should"
            // have had put invented data into two published columns. At -25 dB on AWGN, where
            // 4 frames in 40 fail to acquire, the fill was moving the reported raw BER by
            // about a point and the post-LDPC BER by more.
            //
            // The frame is still a failure - it counts in failureCount, in the FER and in the
            // decode rate, all of which have the full frame count as their denominator. It is
            // the per-bit and per-iteration averages that now run over the frames that
            // actually produced a bit and an iteration, which is the convention timingRmsMs
            // and freqRmsHz have always used for the same reason.
            acquisitionFailures++;
            failureCount++;

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
            const decResult = customCodec.decodeMinSum(channelLlrs);
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
        } else {
          // Synthesize physical 16-MFSK continuous-phase waveform
          const cleanWaveform = this.synthesizePhysicalWaveform(
            fullSymbols75,
            config.sampleRateHz,
            config.audioCenterFreqHz
          );

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

            const decResult = customCodec.decodeMinSum(channelLlrs);

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
        }

        totalRawBitErrors += rawErrors;
        demodulatedCount++;

        // 3. Run the shipped Systematic (216, 77) LDPC decoder, at the iteration cap the
        // shipped receiver uses. `decodeMinSum` defaults to LDPC_MAX_ITERATIONS, which is what
        // realReceiver.ts's decode path takes and what z30_dsp/benchmark.py reads from
        // ldpc.py. Passing a cap from the run configuration is how a benchmark ends up
        // measuring a decoder nobody runs.
        const decodeResult = customCodec.decodeMinSum(channelLlrs);

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
      // Per-bit and per-iteration averages over the frames that produced them; FER and the
      // decode rate keep the full frame count, because an unacquired frame IS a failed frame.
      const rawBer = demodulatedCount > 0 ? totalRawBitErrors / (demodulatedCount * 216) : 0;
      const postBer = demodulatedCount > 0 ? totalPostLdpcBitErrors / (demodulatedCount * 77) : 0;
      const avgIter = demodulatedCount > 0 ? totalIterations / demodulatedCount : 0;
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
        demodulatedFrames: demodulatedCount,
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
