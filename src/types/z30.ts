/**
 * z-30 Experimental Amateur Radio Digital Mode Types & Interfaces
 * 16-MFSK / 50 Hz Bandwidth / 30s Sync Cycle / LDPC + SIC
 */

export type QsoStage = 
  | 'IDLE'
  | 'CALLING_CQ'
  | 'REPLYING_CQ'
  | 'SENDING_REPORT'
  | 'SENDING_R_REPORT'
  | 'SENDING_73'
  | 'QSO_COMPLETED';

export type TxSlot = 'EVEN' | 'ODD' | 'MANUAL';

export type AutoReplyPriority =
  | 'FIRST'
  | 'LAST'
  | 'STRONGEST'
  | 'WEAKEST'
  | 'NEAREST'
  | 'FARTHEST';

export interface DecodedSignal {
  id: string;
  timestamp: string; // HH:MM:SS
  utcSeconds: number;
  receivedAtMs: number; // Epoch timestamp for 60-second automatic age-out expiration
  snr: number; // dB in 2500 Hz reference bandwidth (-32 dB to +15 dB)
  dt: number; // Time offset in seconds (-1.5s to +1.5s)
  freq: number; // Audio frequency in Hz (200 - 3000 Hz)
  rfFreq: number; // Center dial frequency + audio freq in MHz
  message: string;
  callFrom?: string;
  callTo?: string;
  grid?: string;
  report?: string;
  isCq: boolean;
  isMyCall: boolean;
  sicPass: 1 | 2 | 3; // 1 = Direct decode, 2 = 1st SIC cancellation pass, 3 = Deep SIC
  confidence: number; // 0 - 100%
  rawSymbols?: number[];
  ldpcIterations?: number;
}

export type PttMethodType =
  | 'CAT'
  | 'RTS'
  | 'DTR'
  | 'VOX'
  | 'AUDIO_TONE_RIGHT'
  | 'CM108_GPIO'
  | 'RASPBERRY_PI_GPIO'
  | 'TCI_NETWORK'
  | 'WINKEYER';

export interface StationConfig {
  myCall: string;
  myGrid: string;
  /**
   * Regulatory framework the operator is licensed under. Required before the app will
   * transmit: `canTransmit()` fails closed without it, because band edges are not the same
   * everywhere and guessing on the operator's behalf is how you end up out of band.
   */
  regulatoryRegion?: import('../dsp/bandPlan').RegulatoryRegion;
  /** Licence class within that region. Also required before transmitting. */
  licenseClass?: import('../dsp/bandPlan').LicenseClass;
  operatorName?: string;
  qthDescription?: string;
  txPowerWatts: number;
  audioInputDevice: string;
  audioOutputDevice: string;
  sampleRateHz?: number;
  audioChannels?: number;
  catMethod?: 'Hamlib' | 'Direct Serial' | 'None';
  catEnabled: boolean;
  hamlibHost: string;
  hamlibPort: number;
  rigModel: string;
  serialPort: string;
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  handshake?: string;
  // PTT Keying Hardware Configuration (All Transceiver Types)
  pttMethod: PttMethodType;
  pttPort?: string; // Optional separate dedicated PTT COM/serial port
  pttPolarity?: 'ACTIVE_HIGH' | 'ACTIVE_LOW';
  pttToneFreqHz?: number; // Frequency for Right-Channel PTT Tone (default 1000 Hz)
  pttToneChannel?: 'RIGHT' | 'LEFT' | 'BOTH';
  cm108GpioPin?: number; // C-Media CM108/CM119 GPIO pin (e.g. 3 or 4)
  rpiGpioPin?: number; // Raspberry Pi / Linux SBC BCM GPIO pin (e.g. 17 or 27)
  tciHost?: string; // TCI Network Host (e.g. 127.0.0.1)
  tciPort?: number; // TCI Network Port (e.g. 40001)
  winkeyerPort?: string; // WinKeyer COM port if using external keyer
  pttLeadInMs?: number; // Lead-in PTT pre-key delay in ms (e.g. 20ms)
  pttHangTimeMs?: number; // Tail hangover release delay in ms (e.g. 30ms)
  autoSeq: boolean;
  call1st: boolean;
  autoReplyPriority?: AutoReplyPriority;
  watchdogCycles: number;
  holdTxFreq: boolean;
  splitTx: boolean;
  defaultTxSlot?: TxSlot;
  customBands?: Record<string, number>;
  appTimeOffsetMs?: number;
  timezone?: string; // Timezone identifier (e.g. 'UTC', 'SYSTEM_LOCAL', 'America/New_York')
}

export interface BandDef {
  name: string;
  dialFreqHz: number;
  bandMeters: string;
}

export type ColorPaletteName = 
  | 'turbo' 
  | 'inferno' 
  | 'viridis' 
  | 'plasma' 
  | 'magma' 
  | 'wsjtx' 
  | 'nightGreen' 
  | 'amber' 
  | 'highContrast' 
  | 'spectral';

export interface LogEntry {
  id: string;
  utcDate: string; // YYYY-MM-DD or YYYYMMDD
  utcTime: string; // HH:MM:SS or HHMMSS
  callsign: string;
  grid: string;
  mode: string; // 'z-30'
  submode?: string; // '16-MFSK'
  band: string;
  freqMhz: number;
  audioFreqHz?: number;
  rstSent: string;
  rstRcvd: string;
  distanceKm: number;
  azimuthDeg: number;
  txPowerWatts?: number;
  myCall?: string;
  myGrid?: string;
  sicPass?: 1 | 2 | 3;
  ldpcIterations?: number;
  snrDb?: number;
  dtSec?: number;
  notes?: string;
}

export interface AutoLogConfig {
  enabled: boolean;
  triggerMode: 'AUTO_73' | 'AUTO_RR73' | 'PROMPT' | 'MANUAL';
  autoExportAdif: boolean;
  saveToLocalStorage: boolean;
  includeSicPassNotes: boolean;
}

export interface LdpcCodeParameters {
  n: number; // 216 total codeword length
  k: number; // 77 information bits
  m: number; // 139 parity equations
  rate: number; // 77/216 = 0.356
  crcBits: number; // 14 bits CRC-14 (0x2443)
  modulationAlphabet: number; // 16-MFSK (4 bits/symbol)
  dataSymbols: number; // 54 data symbols
  syncSymbols: number; // 21 Costas array symbols
  totalSymbols: number; // 75 symbols per frame
  alphaMinSum: number; // 0.75 normalization factor
}
