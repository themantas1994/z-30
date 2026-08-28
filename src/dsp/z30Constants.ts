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
  WATERFALL_MIN_FREQ: 0, // Hz
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
  pttPort: '',
  pttPolarity: 'ACTIVE_HIGH',
  pttToneFreqHz: 1000,
  pttToneChannel: 'RIGHT',
  cm108GpioPin: 3,
  rpiGpioPin: 17,
  tciHost: '127.0.0.1',
  tciPort: 40001,
  winkeyerPort: '',
  pttLeadInMs: 20,
  pttHangTimeMs: 30,
  autoSeq: true,
  call1st: true,
  autoReplyPriority: 'FIRST',
  watchdogCycles: 4,
  holdTxFreq: true,
  splitTx: false,
  defaultTxSlot: 'EVEN',
  timezone: 'UTC',
};

export interface PttMethodDescriptor {
  id: import('../types/z30').PttMethodType;
  name: string;
  category: 'CAT / Software' | 'Serial Hardware' | 'Audio Hardware' | 'GPIO / Embedded' | 'Network / SDR';
  summary: string;
  description: string;
  supportedRigs: string;
  badge: string;
  recommendedFor: string;
  wiringTips: string;
}

export const PTT_METHODS_CATALOG: PttMethodDescriptor[] = [
  {
    id: 'CAT',
    name: 'CAT Command (Hamlib \\set_ptt / CI-V / Kenwood / Yaesu)',
    category: 'CAT / Software',
    summary: 'Software CAT protocol commands sent over USB/Serial or Hamlib TCP daemon',
    description: 'Transmits digital CAT control commands (e.g. \\set_ptt 1 / T 1, CI-V 0x1C 0x00 0x01, TX;). Does not require separate hardware PTT wires.',
    supportedRigs: 'Icom (IC-7300, IC-705, IC-7610, IC-9700), Yaesu (FT-991A, FT-710, FTDX10, FT-891), Kenwood (TS-590SG, TS-890S), Elecraft (K3, K4), Xiegu (G90, X6100), FlexRadio.',
    badge: 'Standard Modern DSP',
    recommendedFor: 'Transceivers with built-in USB soundcards and CAT control over a single USB cable.',
    wiringTips: 'Single USB A-to-B or USB-C cable. Set radio menu: USB DATA mode, CI-V USB Port = Unlink from [REMOTE].',
  },
  {
    id: 'RTS',
    name: 'RTS Serial Pin (Request-To-Send Hardware Line)',
    category: 'Serial Hardware',
    summary: 'Hardware RTS control line toggling on dedicated or shared COM/USB port',
    description: 'Toggles the RS-232 / USB-to-UART RTS control pin to key an optocoupler, transistor switch, or interface buffer.',
    supportedRigs: 'Digirig Mobile, RigBlaster, microHAM USB Interface, BCI-500, Tigertronics SignaLink with RTS jumper, Homebrew 2N2222 / 4N35 optocoupler interfaces, Yaesu/Icom 8-pin mini-DIN packet ports.',
    badge: 'Hardware Serial Line',
    recommendedFor: 'Interfaces with hardware serial lines (Digirig, Rigblaster, microHAM) or vintage/QRP radios using optoisolated PTT.',
    wiringTips: 'Connect RTS (DB9 Pin 7 or USB-UART RTS pin) through 4N25/4N35 optocoupler to radio PTT + GND. Select Active High for standard NPN buffers.',
  },
  {
    id: 'DTR',
    name: 'DTR Serial Pin (Data-Terminal-Ready Hardware Line)',
    category: 'Serial Hardware',
    summary: 'Hardware DTR control line toggling on dedicated or shared COM/USB port',
    description: 'Toggles the RS-232 / USB-to-UART DTR control line to actuate external transmitter keying circuits.',
    supportedRigs: 'RigBlaster Nomic, Signalink USB DTR mods, Yaesu FT-817/818, FT-857D, Kenwood TS-480, CW/PTT dual-line dongles, Arduino PTT keys.',
    badge: 'Hardware Serial Line',
    recommendedFor: 'Dual-port interfaces or legacy rigs where RTS is reserved for CW keying or hardware flow control and DTR is used for PTT.',
    wiringTips: 'Connect DTR (DB9 Pin 4 or USB-UART DTR pin) to optoisolator circuit. Active High: +5V/+12V keys radio; Active Low: Pull-to-GND keys radio.',
  },
  {
    id: 'AUDIO_TONE_RIGHT',
    name: 'Right-Channel Audio PTT Tone (1000 Hz Burst / Pseudo-FSK)',
    category: 'Audio Hardware',
    summary: 'Continuous 1000/1500 Hz tone on Right Channel, 16-MFSK data modulation on Left Channel',
    description: 'Generates a pure sinusoidal tone (1000 Hz or 1500 Hz @ 0 dBFS) on the Right stereo audio channel for the exact duration of TX, while the Left channel transmits pure z-30 16-MFSK data. An external audio rectifier / tone detector circuit (or VOX box) uses the Right channel tone to key the transceiver PTT with complete ground isolation.',
    supportedRigs: 'SignaLink USB (jumpered or stereo), RigBlaster Advantage, RigBlaster Plug & Play, Masters Communications DRA, Baofeng/Kenwood/Yaesu HT audio cables, smartphones, VOX-less stereo soundcard isolators.',
    badge: 'Audio Tone Keying',
    recommendedFor: 'SignaLink USB, HT cables, soundcards without serial ports, laptops with stereo line out, and galvanically isolated audio interfaces.',
    wiringTips: 'Connect Stereo 3.5mm cable: Left = TX audio to rig MIC/DATA-IN; Right = Tone detector circuit / SignaLink Auto-PTT stage / VOX keyer.',
  },
  {
    id: 'CM108_GPIO',
    name: 'C-Media CM108 / CM119 / CM108AH USB Soundcard GPIO',
    category: 'GPIO / Embedded',
    summary: 'Hardware General Purpose I/O pin (GPIO3 / GPIO4) built into USB audio chips',
    description: 'Directly toggles the hardware GPIO pin (typically GPIO3 or GPIO4) on C-Media CM108, CM108AH, CM119, and SSS1629 USB audio chips via USB HID feature reports. Provides instantaneous hardware keying without requiring an extra COM port.',
    supportedRigs: 'Masters Communications DRA-30 / DRA-50 / DRA-70, DMK Engineering URI / URIxB, RIM (Radio Interface Module), Digirig CM108 edition, modified USB audio fobs.',
    badge: 'USB Soundcard GPIO',
    recommendedFor: 'Dedicated soundcard repeater and digital mode interfaces (DRA series, URI, RIM) featuring integrated C-Media GPIO keying.',
    wiringTips: 'CM108 Pin 13 (GPIO3) or Pin 14 (GPIO4) connected to 2N7002 / optocoupler to radio PTT. No serial COM port needed.',
  },
  {
    id: 'RASPBERRY_PI_GPIO',
    name: 'Raspberry Pi & Linux SBC Direct GPIO Pin (BCM 17 / 27)',
    category: 'GPIO / Embedded',
    summary: 'Direct hardware GPIO pin control for embedded Linux, Raspberry Pi, and DigiPi',
    description: 'Directly drives a processor GPIO pin (BCM Pin 17, 27, 22, etc.) using sysfs, libgpiod, or wiringPi. Ideal for all-in-one portable Raspberry Pi rigs, DigiPi nodes, and embedded transceivers.',
    supportedRigs: 'Raspberry Pi 3/4/5/Zero 2W, DigiPi, Orange Pi, QRP-Labs QDX, QCX-mini, uSDX, WSPRry Pi, Homebrew Raspberry Pi SDR hats.',
    badge: 'Linux SBC / RPi',
    recommendedFor: 'Raspberry Pi digital stations, portable field boxes, backpack stations, and headless digital mode nodes.',
    wiringTips: 'Raspberry Pi GPIO Pin 17 (Physical Pin 11) -> 1k resistor -> 2N2222 Base; Collector -> Radio PTT; Emitter -> GND. Add 1N4148 flyback diode.',
  },
  {
    id: 'VOX',
    name: 'Audio VOX (Transceiver Internal Voice-Operated Exchange)',
    category: 'Audio Hardware',
    summary: 'Transceiver internal audio detection circuit triggers transmission on audio input',
    description: 'Transceiver monitors its microphone or accessory audio line and automatically switches to TX whenever audio modulation is detected from the computer sound card.',
    supportedRigs: 'All transceivers with internal VOX (Icom IC-718, Yaesu FT-857, FT-897, FT-450D, Kenwood TS-440, Xiegu G1M, Baofeng UV-5R VOX mode, Lab599 Discovery TX-500).',
    badge: 'Universal Radio VOX',
    recommendedFor: 'Radios without CAT cables or serial interfaces where VOX is enabled in the radio menu settings.',
    wiringTips: 'Enable VOX in radio menu (VOX GAIN = medium, VOX DELAY = 100-200ms, ANTI-VOX = 0). Connect sound card line-out to radio mic or ACC jack.',
  },
  {
    id: 'TCI_NETWORK',
    name: 'TCI Protocol Network Socket (Transceiver Control Interface)',
    category: 'Network / SDR',
    summary: 'High-speed WebSocket/TCP protocol for ExpertSDR, SunSDR2, and Software Defined Radios',
    description: 'Sends real-time high-speed binary/text control frames (`trx:0:tx:true\n`) over a dedicated local or remote TCP/WebSocket connection directly to SDR software engines.',
    supportedRigs: 'Expert Electronics SunSDR2 PRO / DX / QRP, MB1, Thetis (Hermes-Lite 2, ANAN-G2, Apache Labs SDR), SDRUno / SDRConnect, OpenHPSDR.',
    badge: 'High-Speed SDR Socket',
    recommendedFor: 'Direct SDR operation with SunSDR, Hermes-Lite 2, ANAN, and ExpertSDR software stacks without virtual serial cables.',
    wiringTips: 'Default network socket: 127.0.0.1 port 40001 (TCI). Enable TCI in ExpertSDR / Thetis Options menu.',
  },
  {
    id: 'WINKEYER',
    name: 'K1EL WinKeyer 2/3 & microHAM Hardware Keyer PTT',
    category: 'Serial Hardware',
    summary: 'Hardware CW / PTT keyer command stream over dedicated serial interface',
    description: 'Transmits binary PTT command bytes (0x02 0x01 / 0x02 0x00) to K1EL WinKeyer 2/3, K1EL USB, or microHAM CW Keyer chips with hardware lead-in / tail timing control.',
    supportedRigs: 'K1EL WKmini, WKUSB, WinKeyer 3, microHAM Micro Keyer II / III, DigiKeyer, RigExpert Standard / TI-5000.',
    badge: 'Dedicated Keyer IC',
    recommendedFor: 'Operators with dedicated WinKeyer hardware devices wishing to use hardware keyer sequencing.',
    wiringTips: 'Connect WinKeyer USB/Serial port (typically 1200 or 9600 baud). PTT line output keys transceiver via rear PTT jack.',
  },
];

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
