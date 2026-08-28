/**
 * z-30 Successive Interference Cancellation (SIC) & Multi-Signal Decoder
 * Simulates vector LDPC belief-propagation and iterative signal subtraction
 */

import { DecodedSignal, RfChannelParams } from '../types/z30';
import { Z30_SPECS } from './z30Constants';
import { packZ30Message } from './z30Codec';

export interface SicIterationStep {
  passNumber: 1 | 2 | 3;
  description: string;
  residualPowerDb: number;
  signalsFound: DecodedSignal[];
  cancelledSignalId?: string;
}

// Preset realistic amateur radio DX stations for synthetic band simulation
const DX_CALL_POOL = [
  { call: 'VK3XYZ', grid: 'QF22', country: 'Australia', continent: 'OC', typicalSnr: -28 },
  { call: 'JA1ABC', grid: 'PM95', country: 'Japan', continent: 'AS', typicalSnr: -22 },
  { call: 'DL1BUG', grid: 'JO40', country: 'Germany', continent: 'EU', typicalSnr: -11 },
  { call: 'G4KLX', grid: 'IO91', country: 'England', continent: 'EU', typicalSnr: -8 },
  { call: 'PY2DS', grid: 'GG66', country: 'Brazil', continent: 'SA', typicalSnr: -19 },
  { call: 'ZS6BBI', grid: 'KG44', country: 'South Africa', continent: 'AF', typicalSnr: -25 },
  { call: 'VE3KCL', grid: 'FN03', country: 'Canada', continent: 'NA', typicalSnr: -4 },
  { call: 'K6AR', grid: 'CM87', country: 'United States', continent: 'NA', typicalSnr: -14 },
  { call: 'DP0GVN', grid: 'IB59', country: 'Antarctica (Neumayer III)', continent: 'AN', typicalSnr: -30 },
  { call: 'FR4OO', grid: 'LG79', country: 'Reunion Island', continent: 'AF', typicalSnr: -27 },
  { call: 'OE3WMA', grid: 'JN88', country: 'Austria', continent: 'EU', typicalSnr: -16 },
  { call: 'EA8DBM', grid: 'IL18', country: 'Canary Islands', continent: 'AF', typicalSnr: -21 },
  { call: 'KH6TU', grid: 'BL10', country: 'Hawaii', continent: 'OC', typicalSnr: -26 },
  { call: 'ZL1BQD', grid: 'RF73', country: 'New Zealand', continent: 'OC', typicalSnr: -29 },
  { call: 'OH2XX', grid: 'KP20', country: 'Finland', continent: 'EU', typicalSnr: -13 },
];

export class Z30SicDecoderEngine {
  private decodedHistory: DecodedSignal[] = [];
  private lastIterationSteps: SicIterationStep[] = [];
  private currentCycleDecodes: DecodedSignal[] = [];

  /**
   * Run full multi-signal SIC decoding cycle across the audio bandwidth
   */
  public runSicDecodeCycle(
    dialFreqHz: number,
    myCall: string,
    myGrid: string,
    channelParams: RfChannelParams,
    activeTxMessage?: string,
    activeTxFreq?: number
  ): { decodes: DecodedSignal[]; steps: SicIterationStep[] } {
    const now = new Date();
    const timeStr = now.toTimeString().substring(0, 8);
    const utcSec = now.getUTCSeconds();
    const steps: SicIterationStep[] = [];
    const cycleDecodes: DecodedSignal[] = [];

    // Base RF center dial in MHz
    const dialMhz = dialFreqHz / 1e6;

    // Pick 3 to 6 active stations transmitting in this 30s cycle
    const numStations = 3 + Math.floor(Math.random() * 4);
    const shuffled = [...DX_CALL_POOL].sort(() => Math.random() - 0.5);
    const selectedPool = shuffled.slice(0, numStations);

    // List of simulated candidates
    const rawCandidates: {
      call: string;
      grid: string;
      freq: number;
      snr: number;
      dt: number;
      message: string;
      isCq: boolean;
      packed: ReturnType<typeof packZ30Message>;
    }[] = [];

    // Frequencies spaced across 300 - 2700 Hz
    const usedFreqs: number[] = [];
    selectedPool.forEach((item, idx) => {
      let freq = 350 + Math.floor(Math.random() * 2300);
      // Ensure slight separation or deliberate collision for testing
      if (idx === 0 && channelParams.enableCoChannelInterference) {
        // Deliberate co-channel collision
        freq = (activeTxFreq || 1250) + channelParams.interfererDeltaFreqHz;
      }
      usedFreqs.push(freq);

      // SNR with channel noise modifier
      const baseSnr = item.typicalSnr + (Math.random() * 4 - 2);
      const effectiveSnr = Math.round(baseSnr + (channelParams.snrDb + 10) * 0.3);
      const dt = Number((Math.random() * 0.8 - 0.4).toFixed(2));

      // Decide message type
      const isCallingUs = (activeTxMessage?.startsWith('CQ') && idx < 3) || Math.random() > 0.6;
      const isCq = !isCallingUs && Math.random() > 0.35;
      let msg = '';
      if (isCq) {
        msg = `CQ ${item.call} ${item.grid}`;
      } else if (isCallingUs) {
        // Calling our station with grid or report
        if (Math.random() > 0.4) {
          msg = `${myCall} ${item.call} ${item.grid}`;
        } else {
          const rpt = effectiveSnr >= 0 ? `+0${effectiveSnr}` : `${effectiveSnr}`;
          msg = `${myCall} ${item.call} ${rpt}`;
        }
      } else {
        const targetCall = 'K6AR';
        const rpt = effectiveSnr >= 0 ? `+0${effectiveSnr}` : `${effectiveSnr}`;
        msg = `${targetCall} ${item.call} ${rpt}`;
      }

      const packed = packZ30Message(msg);
      rawCandidates.push({
        call: item.call,
        grid: item.grid,
        freq,
        snr: Math.max(-33, Math.min(10, effectiveSnr)),
        dt,
        message: msg,
        isCq,
        packed,
      });
    });

    // If co-channel interference is enabled, add a strong interfering station right over a weak one
    if (channelParams.enableCoChannelInterference) {
      const collisionFreq = (activeTxFreq || 1250) + channelParams.interfererDeltaFreqHz;
      const strongInterferer = {
        call: 'W3LPL',
        grid: 'FM19',
        freq: collisionFreq,
        snr: Math.round(channelParams.interfererSnrDb),
        dt: 0.1,
        message: `CQ DX W3LPL FM19`,
        isCq: true,
        packed: packZ30Message(`CQ DX W3LPL FM19`),
      };
      rawCandidates.unshift(strongInterferer);
    }

    // Sort candidates by power (highest SNR first) for SIC processing
    rawCandidates.sort((a, b) => b.snr - a.snr);

    // ==========================================
    // SIC PASS 1: Direct Decode of Strong / Isolated Signals
    // ==========================================
    const pass1Signals: DecodedSignal[] = [];
    const uncancelledCandidates: typeof rawCandidates = [];

    for (const cand of rawCandidates) {
      // Decode threshold: z-30 decodes down to -29.5 dB AWGN (-27 dB in fading)
      const threshold = channelParams.fadingModel === 'AWGN' ? Z30_SPECS.SNR_THRESHOLD_AWGN : Z30_SPECS.SNR_THRESHOLD_RAYLEIGH;
      
      // Check if occluded by a stronger signal within 50 Hz bandwidth
      const hasStrongCollision = rawCandidates.some(
        other => other !== cand && other.snr > cand.snr + 6 && Math.abs(other.freq - cand.freq) < Z30_SPECS.TOTAL_BANDWIDTH_HZ
      );

      if (cand.snr >= threshold && !hasStrongCollision) {
        const decoded: DecodedSignal = {
          id: `dec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: timeStr,
          utcSeconds: utcSec,
          snr: cand.snr,
          dt: cand.dt,
          freq: Math.round(cand.freq),
          rfFreq: Number((dialMhz + cand.freq / 1e6).toFixed(6)),
          message: cand.message,
          callFrom: cand.packed.callFrom,
          callTo: cand.packed.callTo,
          grid: cand.packed.grid,
          report: cand.packed.report,
          isCq: cand.isCq,
          isMyCall: cand.message.includes(myCall),
          sicPass: 1,
          confidence: Math.min(99, Math.round(85 + (cand.snr + 30) * 0.4)),
          rawSymbols: cand.packed.symbols,
          ldpcIterations: Math.max(3, Math.min(30, Math.round(25 - (cand.snr + 25) * 0.8))),
        };
        pass1Signals.push(decoded);
        cycleDecodes.push(decoded);
      } else {
        uncancelledCandidates.push(cand);
      }
    }

    steps.push({
      passNumber: 1,
      description: `Pass 1 (Direct LDPC): Decoded ${pass1Signals.length} unoccluded signals.`,
      residualPowerDb: -12.4,
      signalsFound: [...pass1Signals],
    });

    // ==========================================
    // SIC PASS 2: Successive Interference Cancellation (Subtract Pass 1 Strong signals)
    // ==========================================
    const pass2Signals: DecodedSignal[] = [];
    const remainingAfterPass2: typeof rawCandidates = [];

    for (const cand of uncancelledCandidates) {
      // In SIC Pass 2, with the strong interferer subtracted, the candidate's effective SINR increases
      const recoveredSnr = cand.snr;
      const threshold = Z30_SPECS.SNR_THRESHOLD_AWGN;

      if (recoveredSnr >= threshold) {
        const decoded: DecodedSignal = {
          id: `dec-sic2-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: timeStr,
          utcSeconds: utcSec,
          snr: cand.snr,
          dt: cand.dt,
          freq: Math.round(cand.freq),
          rfFreq: Number((dialMhz + cand.freq / 1e6).toFixed(6)),
          message: cand.message,
          callFrom: cand.packed.callFrom,
          callTo: cand.packed.callTo,
          grid: cand.packed.grid,
          report: cand.packed.report,
          isCq: cand.isCq,
          isMyCall: cand.message.includes(myCall),
          sicPass: 2,
          confidence: Math.min(96, Math.round(80 + (cand.snr + 30) * 0.45)),
          rawSymbols: cand.packed.symbols,
          ldpcIterations: Math.max(12, Math.min(40, Math.round(35 - (cand.snr + 25) * 0.7))),
        };
        pass2Signals.push(decoded);
        cycleDecodes.push(decoded);
      } else {
        remainingAfterPass2.push(cand);
      }
    }

    steps.push({
      passNumber: 2,
      description: `Pass 2 (SIC Iteration 1): Reconstructed & subtracted high-power waveforms. Extracted ${pass2Signals.length} buried signals.`,
      residualPowerDb: -26.8,
      signalsFound: [...pass2Signals],
      cancelledSignalId: pass1Signals[0]?.id,
    });

    // ==========================================
    // SIC PASS 3: Deep LDPC Min-Sum Iteration (Down to -31.5 dB)
    // ==========================================
    const pass3Signals: DecodedSignal[] = [];
    for (const cand of remainingAfterPass2) {
      if (cand.snr >= -31.5) {
        const decoded: DecodedSignal = {
          id: `dec-sic3-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: timeStr,
          utcSeconds: utcSec,
          snr: cand.snr,
          dt: cand.dt,
          freq: Math.round(cand.freq),
          rfFreq: Number((dialMhz + cand.freq / 1e6).toFixed(6)),
          message: cand.message,
          callFrom: cand.packed.callFrom,
          callTo: cand.packed.callTo,
          grid: cand.packed.grid,
          report: cand.packed.report,
          isCq: cand.isCq,
          isMyCall: cand.message.includes(myCall),
          sicPass: 3,
          confidence: Math.min(90, Math.round(75 + (cand.snr + 32) * 0.5)),
          rawSymbols: cand.packed.symbols,
          ldpcIterations: 48,
        };
        pass3Signals.push(decoded);
        cycleDecodes.push(decoded);
      }
    }

    steps.push({
      passNumber: 3,
      description: `Pass 3 (Deep SIC): 50-iteration LDPC Min-Sum decoding recovered ${pass3Signals.length} extreme weak DX signals (down to -31 dB).`,
      residualPowerDb: -33.2,
      signalsFound: [...pass3Signals],
    });

    // Update internal histories
    this.lastIterationSteps = steps;
    this.currentCycleDecodes = cycleDecodes;
    this.decodedHistory = [...cycleDecodes, ...this.decodedHistory].slice(0, 150);

    return { decodes: cycleDecodes, steps };
  }

  public getHistory(): DecodedSignal[] {
    return this.decodedHistory;
  }

  public getLastSteps(): SicIterationStep[] {
    return this.lastIterationSteps;
  }

  public clearHistory() {
    this.decodedHistory = [];
    this.currentCycleDecodes = [];
    this.lastIterationSteps = [];
  }
}

export const sicDecoderEngine = new Z30SicDecoderEngine();
