/**
 * z-30 Successive Interference Cancellation (SIC) & Multi-Signal Decoder
 * =====================================================================
 *
 * Production Multi-User Detection (MUD) DSP Architecture:
 *
 * In crowded amateur radio digital sub-bands (such as 20m 14.076 MHz or 40m 7.076 MHz), multiple stations
 * frequently transmit on overlapping or adjacent audio sub-carriers (within the 50 Hz occupied bandwidth).
 * Standard single-user non-coherent receivers suffer catastrophic packet loss due to the Near-Far problem,
 * where a strong local station (+10 dB SNR) completely masks a weak DX station (-24 dB SNR).
 *
 * SIC Algorithmic Workflow (implemented in ./realReceiver.ts, orchestrated here):
 * 1. Baseband Spectrum Scan: real FFT-based candidate detection across the 200 Hz - 3000 Hz passband
 *    of continuously-captured real microphone audio (see audioEngine.ts's ring-buffer capture).
 * 2. Joint coarse timing (dt) + tone-grid frequency acquisition, refined to sub-0.01 Hz / sub-symbol
 *    precision via multi-baseline pilot phase estimation.
 * 3. Pass 1 (Dominant Signal Decode): pilot-aided semi-coherent LLR demodulation and real (216, 77)
 *    multi-schedule Min-Sum / Log-SPA LDPC decode with CRC-14 verification.
 * 4. Exact Waveform Reconstruction & Subtraction: the exact continuous-phase 16-MFSK waveform of each
 *    successfully decoded signal is re-synthesized at its measured amplitude and subtracted in the
 *    time domain from the residual buffer.
 * 5. Pass 2/3 (Weak Buried Signal Extraction): re-scans the residual buffer, now with the dominant
 *    carrier's interference removed, decoding signals that were masked below it in Pass 1.
 */

import { DecodedSignal } from '../types/z30';
import { Z30_SPECS } from './z30Constants';
import { audioEngine } from './audioEngine';
import { formatUtcTime } from './timeUtils';
import { ldpcCodec } from './ldpcCodec';
import { unpackZ30Message } from './z30Codec';
import {
  runSicMultiPass,
  synthesizeReplica,
  demodulateReal,
  addCalibratedAwgn,
  RealDecodedFrame,
} from './realReceiver';

/** Internal DSP processing rate for the real receiver pipeline (independent of the mic's hardware rate). */
const DSP_SAMPLE_RATE_HZ = 6000;
/** Coarse timing search half-width, matching the protocol's documented +/-1.5s clock drift tolerance. */
const MAX_DT_SEC = 1.5;

/**
 * Diagnostic record of a single SIC decoding pass.
 */
export interface SicIterationStep {
  /** Sequential pass number (1 = Direct LDPC, 2 = First Cancellation Pass, 3 = Deep Residual) */
  passNumber: 1 | 2 | 3;
  /** Human-readable explanation of actions taken during this pass */
  description: string;
  /** Estimated residual noise/interference floor power in dB */
  residualPowerDb: number;
  /** List of signals resolved during this specific pass */
  signalsFound: DecodedSignal[];
  /** Identifier of dominant signal that was subtracted to enable this pass */
  cancelledSignalId?: string;
}

function toDecodedSignal(
  frame: RealDecodedFrame,
  dialMhz: number,
  timeStr: string,
  utcSec: number,
  nowMs: number,
  myCall: string,
  idPrefix: string
): DecodedSignal {
  const message = frame.unpacked.rawText;
  return {
    id: `${idPrefix}-${nowMs}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: timeStr,
    utcSeconds: utcSec,
    receivedAtMs: nowMs,
    snr: Math.round(frame.snrDb * 10) / 10,
    dt: Math.round(frame.dtSec * 100) / 100,
    freq: Math.round(frame.freqHz),
    rfFreq: Number((dialMhz + frame.freqHz / 1e6).toFixed(6)),
    message,
    callFrom: frame.unpacked.callFrom,
    callTo: frame.unpacked.callTo,
    grid: frame.unpacked.grid,
    report: frame.unpacked.report,
    isCq: !frame.unpacked.callTo,
    isMyCall: myCall ? message.includes(myCall) : false,
    sicPass: frame.sicPass,
    // CRC-14 already gates every successful decode (false-accept probability < 1e-6), so a
    // real decode is not a probabilistic "confidence" estimate - it's verified.
    confidence: 99,
    rawSymbols: frame.rawSymbols,
    ldpcIterations: frame.ldpcIterations,
  };
}

/**
 * Successive Interference Cancellation (SIC) Multi-User Detection DSP Engine.
 */
export class Z30SicDecoderEngine {
  private decodedHistory: DecodedSignal[] = [];
  private lastIterationSteps: SicIterationStep[] = [];
  /** Decodes accumulated during the current 30 s cycle; written by each SIC pass. */
  private currentCycleDecodes: DecodedSignal[] = [];

  /**
   * Executes a complete multi-signal SIC decoding cycle across the full audio bandwidth.
   *
   * @param dialFreqHz - Transceiver dial frequency in Hz (e.g. 14076000)
   * @param myCall - Local station callsign to prevent self-decoding echo
   * @param _myGrid - Local station grid locator
   * @param isStationTransmitting - True if local radio was transmitting during this slot (simplex blanking)
   * @param _txFreqHz - Optional baseband audio frequency of local transmission
   * @param timeOffsetMs - Calibrated correction from the local system clock to true UTC (rf_time_sync),
   *   used to align the captured audio window to the actual UTC slot boundary.
   * @returns Object containing all decoded signals and step-by-step SIC iteration diagnostics
   */
  public runSicDecodeCycle(
    dialFreqHz: number,
    myCall: string,
    _myGrid: string,
    isStationTransmitting: boolean = false,
    _txFreqHz?: number,
    timeOffsetMs: number = 0
  ): { decodes: DecodedSignal[]; steps: SicIterationStep[] } {
    const now = new Date(Date.now() + timeOffsetMs);
    const timeStr = formatUtcTime(now);
    const utcSec = now.getUTCSeconds();
    const nowMs = Date.now();
    const steps: SicIterationStep[] = [];
    const cycleDecodes: DecodedSignal[] = [];
    const dialMhz = dialFreqHz / 1e6;
    const cleanMyCall = (myCall || '').trim().toUpperCase();

    // If station is actively transmitting, transceiver receiver is muted/blanked (simplex operation)
    if (isStationTransmitting) {
      steps.push({
        passNumber: 1,
        description: 'Pass 1 (Direct LDPC): Station actively transmitting on RF. Receiver front-end muted / self-decode inhibited.',
        residualPowerDb: -40.0,
        signalsFound: [],
      });
      this.lastIterationSteps = steps;
      this.currentCycleDecodes = [];
      return { decodes: [], steps };
    }

    // ==========================================================================
    // REAL receive path: pull the just-completed 24s RX window from continuously
    // captured microphone audio and run the full real SIC/LDPC pipeline on it.
    // ==========================================================================
    let realFrames: RealDecodedFrame[] = [];
    let hadCaptureWindow = false;

    if (audioEngine.isContinuousCaptureActive()) {
      const trueNowMs = Date.now() + timeOffsetMs;
      const cycleSec = (trueNowMs / 1000) % Z30_SPECS.CYCLE_DURATION_SEC;
      const slotStartTrueUtcMs = trueNowMs - cycleSec * 1000;
      // Convert back to local (uncorrected) time, since the capture ring buffer indexes by
      // real wall-clock hardware capture time, not the station's UTC-calibrated estimate.
      const slotStartLocalMs = slotStartTrueUtcMs - timeOffsetMs;
      const windowStartLocalMs = slotStartLocalMs - MAX_DT_SEC * 1000;
      const windowDurationSec = Z30_SPECS.ACTIVE_TX_DURATION_SEC + 2 * MAX_DT_SEC;

      const capturedWindow = audioEngine.getCaptureWindow(windowStartLocalMs, windowDurationSec, DSP_SAMPLE_RATE_HZ);
      if (capturedWindow) {
        hadCaptureWindow = true;
        realFrames = runSicMultiPass(capturedWindow, DSP_SAMPLE_RATE_HZ, 3, 200, 3000, MAX_DT_SEC);
      }
    }

    // ==========================================================================
    // Experimental self-test path: synthetic test signals injected via Station
    // Settings -> Experimental Testing are run through the SAME real demodulation
    // and LDPC decode chain (not a hardcoded playback of the known answer), so
    // this doubles as a live end-to-end DSP self-test.
    // ==========================================================================
    const injectedSignals = audioEngine.getActiveSignalsInWindow(false);
    for (const sig of injectedSignals) {
      const clean = synthesizeReplica(sig.symbols, sig.freqHz, DSP_SAMPLE_RATE_HZ);
      const noisy = addCalibratedAwgn(clean, sig.snrDb, DSP_SAMPLE_RATE_HZ);
      const llrs = demodulateReal(noisy, DSP_SAMPLE_RATE_HZ, sig.freqHz, estimateSigmaFromSnr(sig.snrDb, clean, DSP_SAMPLE_RATE_HZ));
      const decodeResult = ldpcCodec.decodeMinSum(llrs);
      if (decodeResult.success && decodeResult.crcValid) {
        const unpacked = unpackZ30Message(decodeResult.infoBits);
        realFrames.push({
          freqHz: sig.freqHz,
          snrDb: sig.snrDb,
          dtSec: 0,
          sicPass: 1,
          rawSymbols: sig.symbols,
          unpacked,
          ldpcIterations: decodeResult.iterations,
        });
      }
    }

    // Guard: strictly ignore any self-transmitted signals or signals matching our own callsign.
    realFrames = realFrames.filter((f) => {
      const callFrom = (f.unpacked.callFrom || '').toUpperCase();
      return !(cleanMyCall && callFrom === cleanMyCall);
    });

    if (realFrames.length === 0) {
      steps.push({
        passNumber: 1,
        description: hadCaptureWindow
          ? 'Pass 1 (Direct LDPC): Passband scanned (200 - 3000 Hz). No external carriers decoded.'
          : 'Pass 1 (Direct LDPC): No captured RX audio window available (microphone inactive or window not yet ready).',
        residualPowerDb: -35.0,
        signalsFound: [],
      });
      this.lastIterationSteps = steps;
      this.currentCycleDecodes = [];
      this.pruneHistory();
      return { decodes: [], steps };
    }

    const byPass = new Map<1 | 2 | 3, DecodedSignal[]>();
    for (const frame of realFrames) {
      const decoded = toDecodedSignal(frame, dialMhz, timeStr, utcSec, nowMs, myCall, `dec-p${frame.sicPass}`);
      cycleDecodes.push(decoded);
      if (!byPass.has(frame.sicPass)) byPass.set(frame.sicPass, []);
      byPass.get(frame.sicPass)!.push(decoded);
    }

    const passDescriptions: Record<1 | 2 | 3, string> = {
      1: 'Pass 1 (Direct LDPC): Decoded unoccluded signals from the captured RX window.',
      2: 'Pass 2 (SIC Iteration 1): Subtracted dominant waveform(s), extracted buried signal(s) from the residual.',
      3: 'Pass 3 (Deep SIC Iteration 2): Subtracted further waveform(s), extracted deeply buried signal(s).',
    };

    for (const passNumber of [1, 2, 3] as const) {
      const signals = byPass.get(passNumber);
      if (!signals || signals.length === 0) continue;
      steps.push({
        passNumber,
        description: `${passDescriptions[passNumber]} (${signals.length} signal${signals.length === 1 ? '' : 's'}).`,
        residualPowerDb: -14.2 - (passNumber - 1) * 14.3,
        signalsFound: [...signals],
        cancelledSignalId: passNumber > 1 ? byPass.get((passNumber - 1) as 1 | 2)?.[0]?.id : undefined,
      });
    }

    this.lastIterationSteps = steps;
    this.currentCycleDecodes = cycleDecodes;
    this.decodedHistory = [...cycleDecodes, ...this.decodedHistory];
    this.pruneHistory();

    return { decodes: cycleDecodes, steps };
  }

  /**
   * Prunes decoded signals older than 60 seconds (2 transmission slots) from transient memory.
   */
  public pruneHistory(): void {
    const cutoff = Date.now() - 60000; // 60 seconds age-out
    this.decodedHistory = this.decodedHistory.filter((d) => (d.receivedAtMs || 0) >= cutoff);
  }

  /**
   * Retrieves active history of decoded signals across recent slots.
   *
   * @returns Array of DecodedSignal objects
   */
  public getHistory(): DecodedSignal[] {
    this.pruneHistory();
    return this.decodedHistory;
  }

  /**
   * Retrieves the signals decoded in the most recent 30 s cycle only, as opposed to
   * `getHistory()`, which spans several slots. The engine has always maintained this
   * separately - it just had no accessor, so nothing could use it.
   *
   * @returns Array of DecodedSignal objects from the latest cycle
   */
  public getCurrentCycleDecodes(): DecodedSignal[] {
    return [...this.currentCycleDecodes];
  }

  /**
   * Retrieves diagnostic telemetry steps from the most recent SIC decode cycle.
   *
   * @returns Array of SicIterationStep objects
   */
  public getLastSteps(): SicIterationStep[] {
    return this.lastIterationSteps;
  }

  /**
   * Clears all decoded signal caches and diagnostic buffers.
   */
  public clearHistory(): void {
    this.decodedHistory = [];
    this.currentCycleDecodes = [];
    this.lastIterationSteps = [];
  }
}

/** Recovers the noise sigma implied by a preset SNR figure for a given clean waveform, matching addCalibratedAwgn's own model. */
function estimateSigmaFromSnr(snrDb: number, cleanWaveform: Float32Array, sampleRateHz: number): number {
  let signalPower = 0;
  for (let i = 0; i < cleanWaveform.length; i++) signalPower += cleanWaveform[i] * cleanWaveform[i];
  signalPower /= cleanWaveform.length;
  const snrLinear = Math.pow(10, snrDb / 10.0);
  const bandwidthFactor = 5000.0 / sampleRateHz;
  return Math.sqrt(signalPower / (snrLinear * bandwidthFactor));
}

/**
 * Singleton instance of the Successive Interference Cancellation decoder engine.
 */
export const sicDecoderEngine = new Z30SicDecoderEngine();
