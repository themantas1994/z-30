/**
 * z-30 RF / DSP Physical Layer Specifications & Constants
 * =======================================================
 * 
 * Physical Layer Architecture Overview:
 * - Modulation: 16-MFSK (16-ary Multiple Frequency-Shift Keying) with Continuous-Phase Frequency Shift Keying (CPFSK).
 * - Occupied Bandwidth: Strict 50.0 Hz channel bandwidth (16 orthogonal tones spaced by 3.125 Hz).
 * - Tone Duration: 0.320 seconds (320 ms) per symbol, satisfying exact orthogonality: Delta f = 1 / Ts = 1 / 0.320 = 3.125 Hz.
 * - Time Synchronization: Synchronous 30.0-second UTC time frames (Even/Odd slot pairing).
 * - Frame Layout: 75 total symbols = 21 Costas-like synchronization pilot symbols + 54 data symbols.
 * - Active Transmission Duration: 75 * 0.320 s = 24.0 seconds, leaving a 6.0-second processing window for propagation delay,
 *   Successive Interference Cancellation (SIC) iterations, and normalized Min-Sum LDPC belief propagation.
 * - Channel Coding: Systematic Irregular Repeat Accumulate (IRA) Low-Density Parity-Check code: (N=216, K=77), rate R = 77/216 ~ 0.356.
 * - Payload: 63 user information bits + a 14-bit CRC, g(x) = x^14 + x^13 + x^10 + x^6 + x + 1
 *   (register constant 0x2443 with x^14 implicit, init 0x2757, MSB-first).
 * - Sensitivity: the seeded AWGN benchmark crosses 50% decode at -22.92 dB SNR in a 2500 Hz
 *   reference bandwidth through blind acquisition (seed 20260830, 200 frames/point) - the figure
 *   comparable with FT8's published -21.0 dB, because both include the acquisition, AFC and
 *   timing losses. With perfect synchronisation handed to the demodulator it crosses at
 *   -24.58 dB; that is an idealised bound, not an over-the-air threshold, and must never be
 *   quoted beside another mode's. On the ITU-R F.1487 high-latitude moderate channel
 *   (3 ms / 10 Hz) it does not decode at any SNR - 10 Hz of Doppler spread is wider than the
 *   3.125 Hz tone spacing. See wiki/16.
 */

import { BandDef, TxSlot } from '../types/z30';

/**
 * Fundamental physical layer and DSP constants governing the z-30 amateur digital mode protocol.
 */
/**
 * FT8's published over-the-air decode threshold: 50% decode probability at this SNR in a
 * 2500 Hz reference noise bandwidth, from WSJT-X's own measurements.
 *
 * Named rather than typed into prose because the z-30-vs-FT8 delta is the single number this
 * project has had to retract before, and a delta computed from two literals in two different
 * files is a delta nobody can check. Anything that states the comparison subtracts
 * `Z30_SPECS.SNR_THRESHOLD_AWGN` from this, so the two move together.
 *
 * It is an ON-AIR figure and may only ever be compared against z-30's on-air figure. Computing
 * a delta from `SNR_IDEAL_BOUND_AWGN` is what produced the withdrawn "+4.0 dB advantage"
 * claim - see AGENTS.md section 5.
 */
export const FT8_ONAIR_THRESHOLD_DB = -21.0;

export const Z30_SPECS = {
  /** Mode identifier string */
  MODE_NAME: 'z-30',
  /** Full descriptive title */
  DESCRIPTION: '30-Second 16-MFSK Extreme Weak-Signal Amateur Radio Digital Mode with LDPC & SIC',
  
  // ---------------------------------------------------------------------------
  // Modulation & Framing Parameters
  // ---------------------------------------------------------------------------
  /** Number of discrete MFSK tones in the modulation alphabet (M = 16) */
  NUM_TONES: 16,
  /** Total occupied RF audio bandwidth in Hertz (50.0 Hz) */
  TOTAL_BANDWIDTH_HZ: 50.0,
  /** Tone spacing in Hertz for orthogonal non-coherent demodulation (Delta f = 1 / Ts = 3.125 Hz) */
  TONE_SPACING_HZ: 3.125,
  /** Duration of an individual 16-MFSK tone symbol in seconds (320 ms) */
  SYMBOL_DURATION_SEC: 0.320,
  /** Total duration of one synchronous transmission cycle slot in seconds */
  CYCLE_DURATION_SEC: 30.0,
  /** Total number of 16-MFSK symbols transmitted per frame */
  TOTAL_SYMBOLS: 75,
  /** Total active RF transmission duration: 75 symbols * 0.320 s = 24.0 s */
  ACTIVE_TX_DURATION_SEC: 75 * 0.320,
  /** Processing window duration in seconds (30.0 s - 24.0 s = 6.0 s) for DSP, SIC passes, and UI updates */
  RX_PROCESSING_WINDOW_SEC: 6.0,
  
  // ---------------------------------------------------------------------------
  // Synchronization Pilot Symbols (21 Costas-like symbols)
  // ---------------------------------------------------------------------------
  /**
   * Exact symbol index positions (0 through 74) designated for Costas synchronization tones.
   * Distributed across the preamble, midamble clusters, and postamble for robust Doppler and time drift tracking.
   */
  SYNC_POSITIONS: [
    0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29, 
    37, 38, 39, 47, 48, 49, 72, 73, 74
  ],
  /**
   * Tone frequency indexes (0 to 15) corresponding to the 21 synchronization positions.
   * Optimized Costas array property ensures impulse-like two-dimensional auto-correlation in delay and Doppler.
   */
  SYNC_TONES: [
    3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10,
    4, 8, 13, 0, 9, 3, 14, 6, 11
  ],
  
  // ---------------------------------------------------------------------------
  // Channel Coding & Data Capacity
  // ---------------------------------------------------------------------------
  /** Number of data symbols carrying encoded payload per frame (75 total - 21 sync = 54 data symbols) */
  DATA_SYMBOLS: 54,
  /** Number of information bits modulated per 16-MFSK symbol (log2(16) = 4 bits) */
  BITS_PER_SYMBOL: 4,
  /** Total channel-coded bits per frame: 54 symbols * 4 bits/symbol = 216 bits */
  TOTAL_CODE_BITS: 54 * 4,
  /** Total information bit vector length including 63 payload bits and 14 CRC bits (K = 77 bits) */
  PAYLOAD_BITS: 77,
  /** Systematic LDPC code rate representation string: Rate = K/N = 77/216 (~0.356) */
  LDPC_CODE_RATE: '77/216',
  
  // ---------------------------------------------------------------------------
  // Empirical Performance & Sensitivity Benchmarks
  // ---------------------------------------------------------------------------
  // The measured decode thresholds, seed 20260830, 200 frames per point, referenced to a
  // 2500 Hz noise bandwidth. Copied from wiki/16, which is the source of truth: if a DSP change
  // moves the curve, the wiki table and these move together or one of them is lying. They held
  // -25.0 / -24.0 / -22.5 for years - values from no run anyone can identify, contradicting
  // every other figure in the project - which they could, because nothing reads them.
  //
  // Rounded to one decimal from the crossings wiki/16 publishes with their 95% intervals. The
  // intervals are the reason these are quoted to one decimal and not two: at 200 frames a point
  // the AWGN 50% crossing is -22.92 dB [-23.07, -22.79], and a second decimal here would be
  // claiming a precision the sample does not carry.
  /** 50% decode, AWGN, blind acquisition. The figure comparable with other modes' on-air numbers. */
  SNR_THRESHOLD_AWGN: -22.9,
  /** 90% decode, AWGN, blind acquisition. */
  SNR_THRESHOLD_90_AWGN: -22.1,
  /** 50% decode under ITU-R F.1487 mid-latitude moderate fading (1.0 ms delay / 0.5 Hz Doppler). */
  SNR_THRESHOLD_RAYLEIGH: -21.4,
  /**
   * 50% decode with exact noise sigma, carrier and timing handed to the demodulator.
   * A genie-aided BOUND, never an on-air threshold: never subtract another mode's published
   * figure from this one. See AGENTS.md section 5.
   */
  SNR_IDEAL_BOUND_AWGN: -24.6,
  /**
   * 90% decode with the same genie-aided synchronisation. A BOUND, like the line above.
   */
  SNR_IDEAL_BOUND_90_AWGN: -23.5,
  // No FT8_COMPARISON_GAIN_DB. It held 4.0 - the retracted "+4.0 dB advantage over FT8", which
  // was obtained by subtracting FT8's published on-air threshold from z-30's genie-aided bound,
  // two different quantities. AGENTS.md section 5 names a "Gain vs FT8" tile computed that way
  // as how the claim came back into the app after the wiki had already withdrawn it, and
  // forbids computing any mode-to-mode delta from an ideal-mode figure. The constant was
  // unreferenced, but leaving it here is leaving the claim loaded for whoever wires it up next.
  // The like-for-like comparison lives in wiki/11, computed from realistic-mode measurements.

  
  // ---------------------------------------------------------------------------
  // Audio DSP & Baseband Sampling Specifications
  // ---------------------------------------------------------------------------
  /** Standard audio baseband sample rate in Hertz (12.0 kHz) */
  SAMPLE_RATE: 12000,
  /** Discrete sample count per 16-MFSK tone symbol at 12 kHz: 12000 Hz * 0.320 s = 3840 samples */
  SAMPLES_PER_SYMBOL: 12000 * 0.320,
  /** FFT transform block size for sub-Hertz frequency binning (12000 / 4096 = 2.929 Hz bin resolution) */
  FFT_SIZE: 4096,
  /** Lower frequency boundary for waterfall display spectrum in Hertz */
  WATERFALL_MIN_FREQ: 0,
  /** Upper frequency boundary for waterfall display spectrum in Hertz */
  WATERFALL_MAX_FREQ: 3000,
  /** Default audio baseband center frequency in Hertz (1250 Hz) */
  DEFAULT_AUDIO_FREQ: 1250,
};

/**
 * Standard global dial frequencies (Hz) for z-30 across all amateur HF/VHF/UHF bands.
 * Frequencies are USB dial frequencies aligned with international weak-signal digital sub-bands.
 */
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

/**
 * Array of structured amateur radio band definitions for UI selectors, CAT tuning, and band management.
 */
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

/**
 * The callsign this software ships with, before an operator has entered their own.
 *
 * It is deliberately NOT an assignable callsign: `NOCAL` carries no digit, so
 * `isValidCallsign()` in bandPlan.ts rejects it and the transmit gate refuses it on the
 * syntax rule as well as on the placeholder rule. The shipped default used to be `W1AW`, a
 * real and active station licensed to a national amateur radio society, which made the
 * out-of-the-box identity somebody else's: every path that falls back to it - an ADIF or
 * Cabrillo export with no `myCall`, a QSO macro, an injected test frame - wrote that
 * organisation's call into the field, and only an exact equality check in `canTransmit()`
 * stood between it and the air. A placeholder that cannot be a licence cannot be transmitted
 * under even if that check is ever removed.
 *
 * Every fallback that stands in for an unset operator callsign uses this constant, so there is
 * one place to change and nothing to keep in step by inspection.
 */
export const PLACEHOLDER_CALLSIGN = 'NOCAL';

/**
 * Default station configuration for initializing the transceiver suite on first launch.
 */
export const DEFAULT_STATION_CONFIG: import('../types/z30').StationConfig = {
  myCall: PLACEHOLDER_CALLSIGN,
  myGrid: 'FN31pr',
  operatorName: 'Unconfigured Operator',
  qthDescription: 'Unconfigured QTH',
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
  // Off on first launch: AP buys decodes at the cost of extra CRC-14 rolls per frame, and an
  // operator should turn that on knowingly. See src/dsp/apDecode.ts.
  apDecodeEnabled: false,
  call1st: true,
  autoReplyPriority: 'FIRST',
  watchdogCycles: 4,
  holdTxFreq: true,
  splitTx: false,
  defaultTxSlot: 'EVEN',
  timezone: 'UTC',
};

/**
 * Comprehensive metadata and wiring guide for all supported PTT hardware interfaces.
 */
export interface PttMethodDescriptor {
  /** Internal PTT method identifier */
  id: import('../types/z30').PttMethodType;
  /** Human-readable display name */
  name: string;
  /** High-level interface category */
  category: 'CAT / Software' | 'Serial Hardware' | 'Audio Hardware' | 'GPIO / Embedded' | 'Network / SDR';
  /** One-line summary */
  summary: string;
  /** Detailed technical description */
  description: string;
  /** Examples of supported radios and interfaces */
  supportedRigs: string;
  /** Visual badge label */
  badge: string;
  /** Primary recommendation context */
  recommendedFor: string;
  /** Hardware wiring and setup instructions */
  wiringTips: string;
}

/**
 * Catalog of all supported Push-To-Talk (PTT) keying methods with wiring guidelines.
 */
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
    description: 'Sends real-time high-speed binary/text control frames (`trx:0:tx:true\\n`) over a dedicated local or remote TCP/WebSocket connection directly to SDR software engines.',
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

/**
 * Multi-caller pileup auto-reply priority criteria for automated QSO sequencing.
 */
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

/**
 * Real-time UTC slot timing evaluation result.
 */
export interface SlotTimingInfo {
  /** Fractional seconds past the current UTC minute (0.000 to 59.999) */
  utcSeconds: number;
  /** Seconds elapsed in the current 30-second slot cycle (0.000 to 29.999) */
  cycleSec: number;
  /** True if the current time falls in an Even slot (0-29s of minute), false if Odd (30-59s) */
  isEvenSlot: boolean;
  /** True if the current slot matches the configured operator transmission slot */
  isMatchingSlot: boolean;
  /** True if the clock is within the initial 1.5-second guard window of slot initiation */
  isSlotBeginning: boolean;
  /** True if the transmitter can immediately begin RF modulation */
  canTransmitImmediately: boolean;
  /** Integer seconds countdown until the next valid transmission slot boundary */
  secondsUntilTargetSlot: number;
  /** Human-readable slot label */
  targetSlotLabel: string;
}

/**
 * Evaluates current UTC clock against the 30-second synchronous z-30 digital mode slot timing.
 * 
 * @param txSlot - The station's assigned transmission slot ('EVEN', 'ODD', or 'MANUAL')
 * @param date - The reference timestamp (defaults to current system time)
 * @returns Comprehensive slot timing metrics and countdown
 */
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

/**
 * Standard Deterministic Girth-6 IRA LDPC (216, 77) Edge Mapping Table (Parity-Check Bipartite Graph).
 * 
 * Matrix Dimensions:
 * - Parity Checks: M = 139 check nodes (rows 0 to 138).
 * - Information Bits: K = 77 variable nodes (columns 0 to 76).
 * - Parity Bits: M = 139 dual-diagonal accumulator nodes.
 * - Total Codeword Length: N = K + M = 77 + 139 = 216 bits.
 * 
 * Degree Distribution:
 * - Constant check degree d_c = 5 on all 139 rows.
 * - Irregular variable degree d_v in {8, 9, 10} optimized via Progressive Edge Growth (PEG).
 * - Guarantees bipartite girth g >= 6 (strictly eliminates length-4 cycles) for rapid belief propagation.
 */
export const Z30_CHECK_TO_INFO: number[][] = [
  [2,1,3,4,6],[7,8,5,10,9],[11,0,12,13,14],[17,16,15,20,19],[22,23,21,25,18],
  [27,28,24,30,26],[29,32,34,31,36],[33,38,37,35,41],[42,39,44,43,40],[47,46,45,48,51],
  [52,53,49,54,55],[50,57,59,58,60],[62,63,61,56,66],[64,65,69,68,70],[72,73,67,75,71],
  [0,1,74,76,8],[3,9,12,15,18],[2,5,11,19,22],[7,13,16,21,24],[6,10,14,23,17],
  [4,25,26,31,33],[27,32,35,40,46],[29,28,20,38,43],[36,30,41,39,47],[42,37,48,50,34],
  [44,45,49,57,61],[53,58,56,65,51],[55,59,63,68,71],[60,54,66,69,67],[52,70,62,74,75],
  [73,64,76,3,10],[1,5,12,17,72],[2,0,7,18,26],[8,4,14,19,21],[11,6,15,24,29],
  [16,9,25,27,36],[20,23,31,30,37],[22,13,32,28,39],[34,33,43,46,49],[35,45,52,56,50],
  [41,42,53,57,62],[38,44,51,55,64],[40,54,48,59,70],[60,47,61,71,76],[65,66,74,72,2],
  [63,67,58,3,0],[68,75,1,7,11],[73,69,4,5,13],[8,6,16,18,31],[10,15,21,28,35],
  [12,20,25,34,40],[9,19,24,23,38],[17,22,26,29,42],[14,27,33,45,39],[36,44,46,50,62],
  [37,32,47,43,52],[30,49,48,60,64],[51,57,54,63,73],[41,55,56,69,74],[53,61,59,67,4],
  [58,66,68,76,5],[71,70,1,10,16],[65,75,3,14,20],[0,9,17,28,31],[72,6,13,19,27],
  [8,2,15,25,32],[12,7,29,33,23],[11,18,30,38,42],[22,35,36,24,49],[21,26,34,44,52],
  [37,45,54,62,58],[39,46,55,57,67],[40,41,51,50,66],[48,53,63,72,76],[43,56,60,73,70],
  [59,47,65,1,13],[64,71,74,6,5],[69,61,0,75,10],[3,7,22,27,31],[2,9,68,14,30],
  [4,12,16,28,37],[11,20,8,26,35],[15,33,40,36,55],[18,24,17,34,41],[19,32,44,53,66],
  [23,39,48,56,75],[29,45,21,60,63],[25,38,46,54,61],[42,49,47,67,74],[43,51,59,72,0],
  [57,65,76,52,4],[50,68,6,12,21],[62,69,1,15,14],[64,58,8,22,40],[71,3,11,25,28],
  [2,73,17,35,39],[5,18,70,27,37],[10,20,13,36,48],[9,26,41,32,49],[16,30,34,51,61],
  [7,42,46,52,59],[23,44,54,65,5],[19,33,47,56,57],[24,45,53,64,31],[38,58,71,2,13],
  [29,55,66,73,8],[60,72,3,16,62],[50,63,43,69,7],[70,67,6,76,9],[75,15,22,34,38],
  [68,0,4,24,39],[10,74,11,32,50],[1,19,25,35,29],[12,27,43,48,55],[18,20,44,33,58],
  [17,30,40,21,56],[14,26,37,51,36],[23,28,41,52,63],[31,42,61,65,12],[46,64,72,9,20],
  [45,59,69,3,19],[53,60,68,10,18],[49,70,0,66,21],[47,62,4,17,7],[67,1,23,26,40],
  [54,74,13,15,31],[73,6,28,33,53],[57,71,8,24,43],[2,76,27,29,75],[14,22,16,41,44],
  [25,37,49,56,72],[11,34,45,66,4],[32,38,5,57,48],[35,30,55,62,0],[42,51,69,2,21],
  [39,50,54,76,18],[47,63,64,75,12],[52,58,73,1,36],[59,74,16,26,39],
];
