/**
 * z-30 Automated QSO Sequencing Engine & Maidenhead Geometry
 * ==========================================================
 * 
 * Manages the amateur radio QSO state machine (Auto-Seq) for automated standard DX exchanges:
 * - Calling CQ -> CQ DX CALL GRID (TX1)
 * - Answering CQ -> DXCALL MYCALL MYGRID (TX2)
 * - Exchanging Signal Reports -> DXCALL MYCALL -15 (TX3)
 * - Roger + Report Confirmation -> DXCALL MYCALL R-15 (TX4)
 * - Final Confirmation & Logging -> DXCALL MYCALL RR73 / 73 (TX5/TX6)
 * - Automatic ADIF-compliant QSO logging upon receipt of final roger.
 * - Spherical Great Circle distance and initial true azimuth calculation between 4/6-character Maidenhead grid locators.
 * - Pileup resolution algorithm prioritizing callers by First, Last, Strongest, Weakest, Nearest, or Farthest.
 */

import { DecodedSignal, LogEntry, QsoStage, StationConfig, TxSlot } from '../types/z30';
import { buildQsoMacros } from './z30Codec';
import { maidenheadToLatLon } from './gridSquare';

/**
 * Transient state of the active QSO exchange and transceiver sequencing.
 */
export interface QsoState {
  /** Current phase of the amateur contact state machine */
  stage: QsoStage;
  /** Callsign of target remote station */
  targetDxCall: string;
  /** 4 or 6 character Maidenhead grid of target remote station */
  targetDxGrid: string;
  /** Signal report sent by DX station (e.g. '-12') */
  targetDxReport: string;
  /** Signal report sent from our station to DX (e.g. '-18') */
  mySentReport: string;
  /** Signal report received by our station from DX */
  myRcvdReport: string;
  /** Active transmission macro slot */
  currentTxMacro: 'tx1' | 'tx2' | 'tx3' | 'tx4' | 'tx5' | 'tx6' | 'free';
  /** Free-text message string for custom transmissions */
  customTxMessage: string;
  /** Master transmitter arming toggle */
  txEnabled: boolean;
  /** Synchronous even/odd transmission slot designation */
  txSlot: TxSlot;
  /** Baseband receiver audio carrier frequency in Hz (200 - 3000 Hz) */
  rxFreqHz: number;
  /** Baseband transmitter audio carrier frequency in Hz (200 - 3000 Hz) */
  txFreqHz: number;
  /** Consecutive decode cycles elapsed without a response from the target station */
  idleCyclesCount: number;
  /** Total consecutive transmissions sent without interruption */
  consecutiveTxCount: number;
  /** Most recently completed and logged QSO record */
  lastQsoLogged: LogEntry | null;
}

/**
 * Calculates Great Circle Distance (km) and initial True Azimuth bearing (degrees)
 * between two Maidenhead Grid Locators using the Haversine formula on the WGS-84 reference sphere.
 * 
 * @param grid1 - Origin station Maidenhead grid (4 or 6 characters, e.g. 'FN31pr')
 * @param grid2 - Destination station Maidenhead grid (4 or 6 characters, e.g. 'PM95')
 * @returns Object containing great-circle distance in kilometers and azimuth in degrees (0-359)
 */
export function calculateMaidenheadDistanceAndAzimuth(
  grid1: string,
  grid2: string
): { distanceKm: number; azimuthDeg: number } {
  const g1 = maidenheadToLatLon(grid1);
  const g2 = maidenheadToLatLon(grid2);

  if (!g1 || !g2) {
    return { distanceKm: 0, azimuthDeg: 0 };
  }

  const lat1Rad = (g1.lat * Math.PI) / 180;
  const lat2Rad = (g2.lat * Math.PI) / 180;
  const dLat = ((g2.lat - g1.lat) * Math.PI) / 180;
  const dLon = ((g2.lon - g1.lon) * Math.PI) / 180;

  // Haversine formula
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const earthRadiusKm = 6371;
  const distanceKm = Math.round(earthRadiusKm * c);

  // Initial bearing
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  let azimuthDeg = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);

  return { distanceKm, azimuthDeg };
}

export class Z30QsoEngine {
  private state: QsoState = {
    stage: 'IDLE',
    targetDxCall: '',
    targetDxGrid: '',
    targetDxReport: '-15',
    mySentReport: '-18',
    myRcvdReport: '',
    currentTxMacro: 'tx1',
    customTxMessage: '',
    txEnabled: false,
    txSlot: 'EVEN',
    rxFreqHz: 1250,
    txFreqHz: 1250,
    idleCyclesCount: 0,
    consecutiveTxCount: 0,
    lastQsoLogged: null,
  };

  public getState(): QsoState {
    return { ...this.state };
  }

  public setTxEnabled(enabled: boolean) {
    this.state.txEnabled = enabled;
    if (!enabled) {
      this.state.consecutiveTxCount = 0;
    }
  }

  public setTxSlot(slot: TxSlot) {
    this.state.txSlot = slot;
  }

  public setRxFreq(freqHz: number, syncTx: boolean = true) {
    this.state.rxFreqHz = Math.max(200, Math.min(2950, Math.round(freqHz)));
    if (syncTx) {
      this.state.txFreqHz = this.state.rxFreqHz;
    }
  }

  public setTxFreq(freqHz: number) {
    this.state.txFreqHz = Math.max(200, Math.min(2950, Math.round(freqHz)));
  }

  public setCustomTxMessage(msg: string) {
    this.state.customTxMessage = msg;
    this.state.currentTxMacro = 'free';
  }

  public selectTxMacro(macro: 'tx1' | 'tx2' | 'tx3' | 'tx4' | 'tx5' | 'tx6' | 'free') {
    this.state.currentTxMacro = macro;
  }

  /**
   * Double-click a decoded signal to initiate a contact
   */
  public selectSignalToCall(signal: DecodedSignal, config: StationConfig) {
    const caller = signal.callFrom || (signal.message.split(/\s+/)[1] || 'DX');
    const grid = signal.grid || '';
    const snrReport = signal.snr >= 0 ? `+0${signal.snr}` : `${signal.snr}`;

    this.state.targetDxCall = caller;
    this.state.targetDxGrid = grid;
    this.state.mySentReport = snrReport;
    this.state.rxFreqHz = signal.freq;

    if (!config.holdTxFreq) {
      this.state.txFreqHz = signal.freq;
    }

    if (signal.isCq) {
      // Replying to their CQ -> Send DxCall MyCall MyGrid (tx2)
      this.state.stage = 'REPLYING_CQ';
      this.state.currentTxMacro = 'tx2';
    } else if (signal.message.includes(config.myCall)) {
      // They called us or gave us a report
      if (signal.message.includes('RRR') || signal.message.includes('73') || signal.message.includes('RR73')) {
        this.state.stage = 'SENDING_73';
        this.state.currentTxMacro = 'tx5';
      } else if (signal.report?.startsWith('R') || signal.message.includes(' R-') || signal.message.includes(' R+')) {
        this.state.stage = 'SENDING_73';
        this.state.currentTxMacro = 'tx5';
      } else {
        this.state.stage = 'SENDING_R_REPORT';
        this.state.currentTxMacro = 'tx4';
      }
    } else {
      this.state.stage = 'REPLYING_CQ';
      this.state.currentTxMacro = 'tx2';
    }

    // Arm TX to transmit in the next synchronous cycle
    this.state.txEnabled = true;

    // Set TX slot to alternate with the received cycle
    const nowUtcSec = new Date().getUTCSeconds();
    const currentIsEven = Math.floor(nowUtcSec / 30) % 2 === 0;
    this.state.txSlot = currentIsEven ? 'ODD' : 'EVEN';
  }

  /**
   * Process newly decoded signals and update QSO state machine (Auto-Seq)
   */
  public processDecodesForAutoSeq(
    decodes: DecodedSignal[],
    config: StationConfig,
    currentBand: string,
    dialFreqHz: number
  ): { nextTxMessage: string; autoLogged?: LogEntry } {
    const myCall = config.myCall.toUpperCase();
    let autoLogged: LogEntry | undefined;

    // Check for all incoming messages addressed to our station
    const candidateMsgs = decodes.filter((d) => {
      if (d.callTo === myCall) return true;
      if (d.message.startsWith(`${myCall} `) || d.message === myCall) return true;
      if (d.message.includes(` ${myCall} `) || d.message.endsWith(` ${myCall}`)) return true;
      return false;
    });

    let targetedMsg: DecodedSignal | undefined;

    if (candidateMsgs.length > 0) {
      if (candidateMsgs.length === 1) {
        targetedMsg = candidateMsgs[0];
      } else {
        // Multi-caller pileup resolution based on Auto-Reply Priority Rule
        const priority = config.autoReplyPriority || 'FIRST';

        const scoredCandidates = candidateMsgs.map((c, originalIndex) => {
          // Extract grid if present in decode or message
          let grid = c.grid;
          if (!grid) {
            const parts = c.message.split(/\s+/);
            for (const p of parts) {
              if (/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(p) && p.toUpperCase() !== 'RR73') {
                grid = p.toUpperCase();
                break;
              }
            }
          }

          let distanceKm: number | null = null;
          if (grid && config.myGrid) {
            distanceKm = calculateMaidenheadDistanceAndAzimuth(config.myGrid, grid).distanceKm;
          }

          return {
            decode: c,
            index: originalIndex,
            snr: c.snr,
            distanceKm,
            grid,
          };
        });

        if (priority === 'FIRST') {
          targetedMsg = scoredCandidates[0].decode;
        } else if (priority === 'LAST') {
          targetedMsg = scoredCandidates[scoredCandidates.length - 1].decode;
        } else if (priority === 'STRONGEST') {
          scoredCandidates.sort((a, b) => b.snr - a.snr);
          targetedMsg = scoredCandidates[0].decode;
        } else if (priority === 'WEAKEST') {
          scoredCandidates.sort((a, b) => a.snr - b.snr);
          targetedMsg = scoredCandidates[0].decode;
        } else if (priority === 'NEAREST') {
          scoredCandidates.sort((a, b) => {
            const distA = a.distanceKm !== null ? a.distanceKm : 999999;
            const distB = b.distanceKm !== null ? b.distanceKm : 999999;
            return distA - distB;
          });
          targetedMsg = scoredCandidates[0].decode;
        } else if (priority === 'FARTHEST') {
          scoredCandidates.sort((a, b) => {
            const distA = a.distanceKm !== null ? a.distanceKm : -1;
            const distB = b.distanceKm !== null ? b.distanceKm : -1;
            return distB - distA;
          });
          targetedMsg = scoredCandidates[0].decode;
        } else {
          targetedMsg = candidateMsgs[0];
        }
      }
    }

    if (targetedMsg && config.autoSeq) {
      this.state.idleCyclesCount = 0;
      const dxCaller = targetedMsg.callFrom || targetedMsg.message.split(/\s+/)[1];
      this.state.targetDxCall = dxCaller;

      if (targetedMsg.grid) {
        this.state.targetDxGrid = targetedMsg.grid;
      }

      const incomingSnrStr = targetedMsg.snr >= 0 ? `+0${targetedMsg.snr}` : `${targetedMsg.snr}`;
      this.state.mySentReport = incomingSnrStr;

      // State transitions
      if (this.state.stage === 'CALLING_CQ' || this.state.stage === 'IDLE') {
        // Someone answered our CQ -> Send Report (tx3)
        this.state.stage = 'SENDING_REPORT';
        this.state.currentTxMacro = 'tx3';
      } else if (this.state.stage === 'REPLYING_CQ') {
        // They sent us their report -> Send Roger + Report (tx4)
        this.state.stage = 'SENDING_R_REPORT';
        this.state.currentTxMacro = 'tx4';
      } else if (this.state.stage === 'SENDING_REPORT' || this.state.stage === 'SENDING_R_REPORT') {
        // They sent RRR, RR73, or 73 -> Send 73 (tx5) and Log QSO
        if (targetedMsg.message.includes('RRR') || targetedMsg.message.includes('73') || targetedMsg.message.includes('RR73')) {
          this.state.stage = 'SENDING_73';
          this.state.currentTxMacro = 'tx5';

          // Create Log Entry
          const geom = calculateMaidenheadDistanceAndAzimuth(config.myGrid, this.state.targetDxGrid || 'EM00');
          const now = new Date();
          const logEntry: LogEntry = {
            id: `log-${Date.now()}`,
            utcDate: now.toISOString().substring(0, 10),
            utcTime: now.toTimeString().substring(0, 8),
            callsign: this.state.targetDxCall,
            grid: this.state.targetDxGrid || 'FN31',
            mode: 'z-30',
            band: currentBand,
            freqMhz: Number(((dialFreqHz + this.state.rxFreqHz) / 1e6).toFixed(6)),
            rstSent: this.state.mySentReport,
            rstRcvd: targetedMsg.report || '-16',
            distanceKm: geom.distanceKm,
            azimuthDeg: geom.azimuthDeg,
            notes: `z-30 16-MFSK LDPC / SIC Pass ${targetedMsg.sicPass}`,
          };
          autoLogged = logEntry;
          this.state.lastQsoLogged = logEntry;
        }
      } else if (this.state.stage === 'SENDING_73') {
        // Finished QSO, return to calling CQ or Idle
        this.state.stage = 'CALLING_CQ';
        this.state.currentTxMacro = 'tx1';
      }
    } else {
      this.state.idleCyclesCount++;
      if (this.state.idleCyclesCount >= config.watchdogCycles && config.watchdogCycles > 0) {
        // Safety Watchdog: disable Tx to prevent unattended transmitter burnout
        this.state.txEnabled = false;
      }
    }

    const currentMsg = this.getCurrentTxMessage(config);
    return { nextTxMessage: currentMsg, autoLogged };
  }

  /**
   * Resolve active text to transmit based on macro state
   */
  public getCurrentTxMessage(config: StationConfig): string {
    if (this.state.currentTxMacro === 'free') {
      return this.state.customTxMessage || `CQ ${config.myCall} ${config.myGrid}`;
    }

    const macros = buildQsoMacros(
      config.myCall,
      config.myGrid,
      this.state.targetDxCall || 'DX',
      this.state.mySentReport
    );

    return macros[this.state.currentTxMacro] || macros.tx1;
  }
}

export const qsoEngine = new Z30QsoEngine();
