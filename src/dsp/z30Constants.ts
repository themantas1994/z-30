/**
 * z-30 RF / DSP Physical Layer Specifications & Constants
 */

import { BandDef, TxSlot } from '../types/z30';

export const Z30_SPECS = {
  MODE_NAME: 'z-30',
  DESCRIPTION: '30-Second 16-MFSK Extreme Weak-Signal Amateur Radio Digital Mode with LDPC & SIC',
  
  // Modulation & Framing
  NUM_TONES: 16, // 16-MFSK
  TOTAL_BANDWIDTH_HZ: 50.0, // Strict 50 Hz occupied bandwidth per signal
  TONE_SPACING_HZ: 3.125, // 50 Hz / 16 = 3.125 Hz
  SYMBOL_DURATION_SEC: 0.320, // 1 / 3.125 Hz = 320 ms
  CYCLE_DURATION_SEC: 30.0, // 30-second synchronous UTC slot
  TOTAL_SYMBOLS: 75,
  ACTIVE_TX_DURATION_SEC: 75 * 0.320, // 24.0 seconds active transmission
  RX_PROCESSING_WINDOW_SEC: 6.0, // Buffer for propagation, SIC passes, and LDPC iterations
  
  // Frame layout (75 symbols total)
  // Sync positions: 21 Costas-like sync symbols interleaved throughout the frame
  SYNC_POSITIONS: [
    0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29, 
    37, 38, 39, 47, 48, 49, 72, 73, 74
  ],
  // Costas sync tone pattern (0 to 15)
  SYNC_TONES: [
    3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10,
    4, 8, 13, 0, 9, 3, 14, 6, 11
  ],
  
  // Channel Coding & Data
  DATA_SYMBOLS: 54, // 75 total - 21 sync = 54 data symbols
  BITS_PER_SYMBOL: 4, // log2(16) = 4 bits per symbol
  TOTAL_CODE_BITS: 54 * 4, // 216 channel coded bits
  PAYLOAD_BITS: 77, // 77 information bits (including 14-bit CRC)
  LDPC_CODE_RATE: '216/77', // Rate ~0.356 Low-Density Parity-Check code
  
  // Performance Benchmarks
  SNR_THRESHOLD_AWGN: -29.5, // dB in 2500 Hz noise bandwidth (50% decode probability)
  SNR_THRESHOLD_RAYLEIGH: -27.0, // dB with ionospheric fading
  FT8_COMPARISON_GAIN_DB: 8.5, // ~8.5 dB more sensitive than FT8 (-21 dB)
  
  // Audio & DSP Sampling
  SAMPLE_RATE: 12000, // 12 kHz standard audio sample rate
  SAMPLES_PER_SYMBOL: 12000 * 0.320, // 3840 samples per symbol at 12 kHz
  FFT_SIZE: 4096, // High resolution FFT for sub-Hz tone binning
  WATERFALL_MIN_FREQ: 200, // Hz
  WATERFALL_MAX_FREQ: 3000, // Hz
  DEFAULT_AUDIO_FREQ: 1250, // Hz default center frequency
};

export const DEFAULT_BANDS: Record<string, number> = {
  '160m': 1842000,
  '80m':  3576000,
  '60m':  5359000,
  '40m':  7076000,
  '30m':  10139000,
  '20m':  14076000,
  '17m':  18102000,
  '15m':  21076000,
  '12m':  24917000,
  '10m':  28076000,
  '6m':   50316000,
  '2m':   144176000,
  '70cm': 432176000,
};

export const HAM_BANDS: BandDef[] = [
  { name: '160m', dialFreqHz: 1842000, bandMeters: '160m' },
  { name: '80m',  dialFreqHz: 3576000, bandMeters: '80m' },
  { name: '60m',  dialFreqHz: 5359000, bandMeters: '60m' },
  { name: '40m',  dialFreqHz: 7076000, bandMeters: '40m' },
  { name: '30m',  dialFreqHz: 10139000, bandMeters: '30m' },
  { name: '20m',  dialFreqHz: 14076000, bandMeters: '20m' },
  { name: '17m',  dialFreqHz: 18102000, bandMeters: '17m' },
  { name: '15m',  dialFreqHz: 21076000, bandMeters: '15m' },
  { name: '12m',  dialFreqHz: 24917000, bandMeters: '12m' },
  { name: '10m',  dialFreqHz: 28076000, bandMeters: '10m' },
  { name: '6m',   dialFreqHz: 50316000, bandMeters: '6m' },
  { name: '2m',   dialFreqHz: 144176000, bandMeters: '2m' },
  { name: '70cm', dialFreqHz: 432176000, bandMeters: '70cm' },
];

export const DEFAULT_STATION_CONFIG: import('../types/z30').StationConfig = {
  myCall: 'W1AW',
  myGrid: 'FN31pr',
  operatorName: 'ARRL Maxim Memorial Station',
  qthDescription: 'Newington, CT, USA',
  txPowerWatts: 25,
  audioInputDevice: 'Default System Audio Device',
  audioOutputDevice: 'Default System Audio Device',
  sampleRateHz: 12000,
  audioChannels: 1,
  catMethod: 'Hamlib',
  catEnabled: true,
  hamlibHost: '127.0.0.1',
  hamlibPort: 4532,
  rigModel: 'Icom IC-7300 (USB Audio/CAT)',
  serialPort: '/dev/ttyUSB0 (COM3)',
  baudRate: 19200,
  dataBits: 8,
  stopBits: 1,
  handshake: 'None',
  pttMethod: 'CAT',
  pttPolarity: 'ACTIVE_HIGH',
  autoSeq: true,
  call1st: true,
  autoReplyPriority: 'FIRST',
  watchdogCycles: 4,
  holdTxFreq: true,
  splitTx: false,
  defaultTxSlot: 'EVEN',
};

export const AUTO_REPLY_OPTIONS: {
  id: import('../types/z30').AutoReplyPriority;
  label: string;
  shortLabel: string;
  description: string;
  tag: string;
}[] = [
  {
    id: 'FIRST',
    label: 'First Decoded (Chrono)',
    shortLabel: 'First',
    description: 'Answers the first decoded caller in the current time slot (Standard WSJT-X Call 1st behavior).',
    tag: 'Arrival Order',
  },
  {
    id: 'LAST',
    label: 'Last Decoded',
    shortLabel: 'Last',
    description: 'Answers the last decoded caller in the sequence.',
    tag: 'Arrival Tail',
  },
  {
    id: 'STRONGEST',
    label: 'Strongest Signal (Max SNR)',
    shortLabel: 'Strongest',
    description: 'Answers the loudest calling station with the highest SNR (e.g. -4 dB before -24 dB).',
    tag: 'Highest SNR',
  },
  {
    id: 'WEAKEST',
    label: 'Weakest Signal (Deep DX)',
    shortLabel: 'Weakest',
    description: 'Answers the weakest station near the LDPC noise threshold (e.g. -28 dB before -6 dB).',
    tag: 'Lowest SNR',
  },
  {
    id: 'NEAREST',
    label: 'Nearest Station (Closest km)',
    shortLabel: 'Nearest',
    description: 'Answers the geographically closest station based on Maidenhead grid distance.',
    tag: 'Min Distance',
  },
  {
    id: 'FARTHEST',
    label: 'Farthest DX (Max Distance)',
    shortLabel: 'Farthest',
    description: 'Answers the station with the greatest Maidenhead great-circle distance (furthest DX).',
    tag: 'Max Distance',
  },
];

export interface SlotTimingInfo {
  utcSeconds: number;
  cycleSec: number;
  isEvenSlot: boolean;
  isMatchingSlot: boolean;
  isSlotBeginning: boolean;
  canTransmitImmediately: boolean;
  secondsUntilTargetSlot: number;
  targetSlotLabel: string;
}

export function evaluateSlotTiming(txSlot: TxSlot = 'EVEN', date: Date = new Date()): SlotTimingInfo {
  const utcSeconds = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000.0;
  const isEvenSlot = Math.floor(utcSeconds / 30) % 2 === 0;
  const cycleSec = utcSeconds % 30.0;
  
  const isMatchingSlot = txSlot === 'MANUAL' || (txSlot === 'EVEN' && isEvenSlot) || (txSlot === 'ODD' && !isEvenSlot);
  const isSlotBeginning = cycleSec <= 1.5;
  const canTransmitImmediately = txSlot === 'MANUAL' || (isMatchingSlot && isSlotBeginning);

  let secondsUntilTargetSlot = 0;
  if (txSlot === 'MANUAL') {
    secondsUntilTargetSlot = 0;
  } else if (txSlot === 'EVEN') {
    secondsUntilTargetSlot = (60.0 - utcSeconds) % 60.0;
    if (secondsUntilTargetSlot === 0 && utcSeconds > 1.5) secondsUntilTargetSlot = 60.0;
  } else if (txSlot === 'ODD') {
    secondsUntilTargetSlot = utcSeconds < 30.0 ? 30.0 - utcSeconds : 90.0 - utcSeconds;
  }

  return {
    utcSeconds,
    cycleSec,
    isEvenSlot,
    isMatchingSlot,
    isSlotBeginning,
    canTransmitImmediately,
    secondsUntilTargetSlot: Math.max(0, Math.ceil(secondsUntilTargetSlot)),
    targetSlotLabel: txSlot === 'EVEN' ? 'Even (:00)' : txSlot === 'ODD' ? 'Odd (:30)' : 'Manual',
  };
}
