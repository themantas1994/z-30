/**
 * Hamlib rigctl & Web Serial CAT Hardware Transceiver Controller
 * =============================================================
 * 
 * Direct hardware transceiver interface supporting:
 * - Web Serial API for native browser-to-radio UART serial communications
 * - Physical RS-232 / USB UART pin keying (RTS & DTR)
 * - Audio Right-Channel PTT Tone generation (Pseudo-FSK hardware keying)
 * - CM108 / C-Media USB soundcard GPIO PTT keying
 * - Raspberry Pi & SBC direct GPIO BCM keying
 * - TCI (Transceiver Control Interface) network protocol for Expert Electronics SDRs
 * - WinKeyer hardware CW / PTT keyer interface
 * - Hamlib rigctl TCP daemon protocol (127.0.0.1:4532)
 */

import { HAM_BANDS, DEFAULT_STATION_CONFIG, Z30_SPECS } from './z30Constants';
import {
  BAND_PLANS,
  findPermittedSegment,
  nearestPermittedSegment,
  isValidCallsign,
  LicenseClass,
  RegulatoryRegion,
} from './bandPlan';
import { audioEngine } from './audioEngine';
import {
  isLocalServerAvailable,
  keepAliveGpioPin,
  sendRigctlCommand,
  setGpioPin,
} from './localServerApi';
import { StationConfig, PttMethodType } from '../types/z30';
import { getRigByName, CURRENT_HAMLIB_VERSION } from './hamlibCatalog';
import {
  CatProtocolFamily,
  getProtocolFamilyForRig,
  parseCivAddr,
  buildCivFrame,
  civSetFrequency,
  civSetMode,
  civSetPtt,
  kenwoodSetFrequency,
  kenwoodSetMode,
  kenwoodSetPtt,
  yaesuSetFrequency,
  yaesuSetMode,
  yaesuSetPtt,
} from './ratProtocols';

/**
 * Hard ceiling on a single keyed period on the production PTT path, in seconds.
 *
 * One frame is 24 s of carrier within a 30 s slot, plus lead-in and hang time. 40 s therefore
 * leaves generous margin for a complete transmission while still bounding a stuck one. Before
 * this existed, `setPtt` had no timeout of any kind: a crashed tab, a thrown exception, or a
 * machine that slept mid-transmission left PTT asserted indefinitely - an unattended
 * transmission, a burnt PA, and a licence problem. The server-side GPIO dead-man switch (see
 * z30_dsp/web_server.py) is the second layer; this is the first.
 */
export const MAX_TX_SECONDS = 40;

/**
 * Hardware addressing for a keying method: which pin, which host, which port.
 *
 * Declared once and shared by `setPtt`, `testPttKey` and the watchdog context, because the
 * release path must be able to reproduce exactly what the key path drove. See the note on
 * `lastPttContext` in `setPtt`.
 */
export interface PttHardwareOptions {
  pttPort?: string;
  pttToneFreqHz?: number;
  cm108GpioPin?: number;
  rpiGpioPin?: number;
  tciHost?: string;
  tciPort?: number;
  winkeyerPort?: string;
}

/**
 * What the raw rigctl console needs before it is allowed to key a transmitter.
 *
 * The console is a fourth transmit path, and AGENTS.md permits exactly one gate in front of
 * every path. Rather than reach for the station config itself (which it has no access to), the
 * console is handed the caller's already-wired gate plus the operator's real keying method, so
 * `T 1` behaves identically to pressing Start TX.
 */
export interface RawConsoleTransmitContext {
  /** The compliance gate. Must be canTransmit()/assertCanTransmit, not a local re-check. */
  assertCanTransmit: (audioOffsetHz: number) => boolean;
  /** Audio offset the station would transmit on, so the band-plan check sees the real RF. */
  txAudioOffsetHz: number;
  /** The operator's configured keying method - not a CAT default. */
  pttMethod: PttMethodType;
  /** The operator's configured polarity - not an ACTIVE_HIGH default. */
  pttPolarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW';
  pttOptions?: PttHardwareOptions;
}

/** Fallbacks used only when neither the caller nor the last key gave us an address. */
const DEFAULT_CM108_GPIO_PIN = 3;
const DEFAULT_RPI_BCM_PIN = 17;
const DEFAULT_TCI_HOST = '127.0.0.1';
const DEFAULT_TCI_PORT = 40001;

/** How often the browser re-asserts the server-side GPIO dead-man switch while keyed. */
const GPIO_KEEPALIVE_INTERVAL_MS = 500;

/**
 * Result of the pre-transmit compliance gate. See `canTransmit`.
 */
export interface TransmitPermission {
  /** True only if every condition passed. Callers must treat any false as a hard stop. */
  allowed: boolean;
  /** Every condition that failed, in the order they were checked. */
  violations: string[];
  /** The evaluated transmit frequency (dial + audio offset) in Hz, when it could be computed. */
  txFrequencyHz?: number;
  /** Name of the band segment the transmit frequency fell inside, if any. */
  bandSegment?: string;
}

/**
 * Diagnostic log item recording rigctl or serial hardware interactions.
 */
export interface RigctlLogItem {
  /** Unique log entry identifier */
  id: string;
  /** ISO UTC timestamp string */
  timestamp: string;
  /** Command stream direction ('IN' for rig response, 'OUT' for host command) */
  direction: 'IN' | 'OUT';
  /** Exact rigctl or raw ASCII command sent/received */
  command: string;
  /** Radio response or status message */
  response: string;
  /** Execution status */
  status: 'OK' | 'ERROR' | 'TIMEOUT';
}

/**
 * Diagnostic result of a transceiver CAT link verification probe.
 */
export interface CatTestResult {
  /** True if transceiver responded correctly to CAT frequency/mode queries */
  success: boolean;
  /** Human-readable explanation of CAT test outcome */
  message: string;
  /** Verified VFO dial frequency in Hertz if read from radio */
  vfoHz?: number;
  /** Verified operating mode (e.g. 'PKTUSB', 'USB-D') */
  mode?: string;
  /** Verified radio model name */
  rigName?: string;
  /** Serial port or TCP host:port used for communication */
  portUsed?: string;
  /** Extended hardware diagnostic details */
  details?: string;
}

/**
 * Diagnostic result of a PTT line keying test.
 */
export interface PttTestResult {
  /** True if PTT line was successfully asserted */
  success: boolean;
  /** Descriptive test outcome message */
  message: string;
  /** Active PTT method tested */
  method: PttMethodType;
  /** True if transmitter line is currently asserted */
  isKeyed: boolean;
  /** Logic level or voltage state of physical pin */
  pinState?: string;
  /** Specific hardware interface details */
  hardwareDetail?: string;
}

/**
 * Minimal structural types for the Web Serial and WebHID surfaces this controller uses.
 *
 * Neither API is in TypeScript's DOM lib, so the calls used to be made through `any` - on the
 * exact code paths where a type error becomes a hardware command. These describe only the
 * members z-30 actually touches, which is enough to catch a typo or a wrong argument shape
 * without pretending to model the full specifications.
 */
export interface WebSerialSignals {
  requestToSend?: boolean;
  dataTerminalReady?: boolean;
}

/** UART line settings the operator configures, as passed to `SerialPort.open()`. */
export interface SerialLineSettings {
  dataBits?: number;
  stopBits?: number;
  /** "None", "Hardware (RTS/CTS)" or "Software (XON/XOFF)", as the settings modals word it. */
  handshake?: string;
}

export interface WebSerialPortLike {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    flowControl?: string;
  }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: WebSerialSignals): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

export interface WebHidDeviceLike {
  opened: boolean;
  productName?: string;
  vendorId?: number;
  productId?: number;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

/**
 * Enumerated hardware serial communication port.
 */
export interface DiscoveredSerialPort {
  /** System identifier or path */
  id: string;
  /** COM port or dev node path (e.g. 'COM3', '/dev/ttyUSB0') */
  path: string;
  /** User-friendly hardware display name */
  displayName: string;
  /** USB Vendor ID (e.g. 0x10C4 for Silicon Labs) */
  vendorId?: number;
  /** USB Product ID */
  productId?: number;
  /** Recognized manufacturer name */
  vendorName?: string;
  /** True if discovered via browser Web Serial API */
  isWebSerial: boolean;
  /** True if user has authorized access to this port */
  isPaired: boolean;
  /** True if port is actively opened */
  isOpen: boolean;
  /** Raw browser SerialPort reference */
  nativePort?: any;
}

// Known USB vendor IDs commonly used in amateur radio CAT interfaces & transceivers
const USB_VENDOR_MAP: Record<number, string> = {
  0x10c4: 'Silicon Labs (CP210x / Icom / Yaesu USB CAT)',
  0x0403: 'FTDI (FT232R / microHAM / Rigblaster CAT)',
  0x1a86: 'WCH (CH340 / CH341 USB-to-UART)',
  0x067b: 'Prolific (PL2303 USB-to-Serial)',
  0x0483: 'STMicroelectronics (STM32 USB CDC / Xiegu)',
  0x2341: 'Arduino (USB Transceiver CDC Interface)',
  0x2e8a: 'Raspberry Pi (RP2040 / Pico UART Interface)',
  0x0d28: 'ARM DAPLink / mbed CMSIS-DAP CDC',
  0x16c0: 'Van Ooijen / Teensy USB Serial',
  0x04d8: 'Microchip Technology USB Serial',
  0x303a: 'Espressif Systems (ESP32 USB-JTAG/Serial)',
};

/**
 * CAT (Computer-Aided Transceiver) controller and hardware keying manager.
 */
export class CatController {
  private currentFreqHz: number = 14076000; // 20m z-30 default
  private currentMode: string = 'PKTUSB';
  private currentPassbandHz: number = 3000;
  private pttState: boolean = false;
  private splitState: boolean = false;
  private txFreqHz: number = 14076000;
  private isConnected: boolean = false; // Initially false until real link established
  private hamlibHost: string = '127.0.0.1';
  private hamlibPort: number = 4532;
  private hamlibRelayEnabled: boolean = false;
  private commandHistory: RigctlLogItem[] = [];
  private currentBandIdx: number = 5; // 20m

  // Hardware Web Serial Port handle
  private serialPort: WebSerialPortLike | null = null;
  private serialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private isSerialConnected: boolean = false;
  private pairedSerialPorts: DiscoveredSerialPort[] = [];
  private portListeners: Array<(ports: DiscoveredSerialPort[]) => void> = [];

  // A second, optional serial port used only for keying: RTS/DTR PTT and WinKeyer. Stations
  // with CAT on one cable and PTT on another (Digirig, a second FTDI, a homebrew optocoupler
  // box) had no way to say so - `config.pttPort` was displayed in the PTT message and then
  // ignored, and the line was driven on the CAT port instead. Null means "key on the CAT
  // port", which is the common single-cable case and stays the default.
  private pttSerialPort: WebSerialPortLike | null = null;
  private pttSerialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private pttSerialPortLabel: string | null = null;
  private serialLineSettings: SerialLineSettings | null = null;
  /** Keying polarity, so an opened port lands in the released state for this station. */
  private keyingPolarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW' = 'ACTIVE_HIGH';

  // Active PTT safety timer
  private pttSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Hard maximum-transmission timer on the production PTT path. A z-30 frame is 24 s of
   * carrier plus lead-in and hang time; anything past MAX_TX_SECONDS means something failed
   * and the transmitter must come down by itself.
   */
  private txWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  /** Repeating keepalive that holds the server-side GPIO dead-man switch open while keyed. */
  private gpioKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastPttContext: {
    method: PttMethodType;
    polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW';
    options?: PttHardwareOptions;
  } | null = null;
  /**
   * What the most recent setPtt() hardware call actually did. testPttKey() reports from this
   * rather than assuming success, so a test can only pass if the line was really driven.
   */
  private lastPttHardwareOutcome: {
    ok: boolean;
    hardwareDetail?: string;
    failureNote?: string;
  } = { ok: true };

  // Real CAT protocol family + Icom CI-V address for the currently configured rig, set via
  // configureRig(). Determines what actual bytes setFreqHz/setMode/setPtt write to the wire.
  private activeProtocolFamily: CatProtocolFamily = 'NONE';
  private activeCivAddr: number = 0x00;
  private textEncoder = new TextEncoder();

  // WebHID handle for CM108/CM119 USB Audio GPIO PTT (separate from the Web Serial CAT link -
  // a station commonly uses a CM108-based audio interface for PTT with no serial CAT at all).
  private hidDevice: WebHidDeviceLike | null = null;

  // TCI (Transceiver Control Interface) WebSocket handle for Expert Electronics SDRs.
  private tciSocket: WebSocket | null = null;
  private tciConnecting: Promise<WebSocket> | null = null;

  constructor() {
    this.currentFreqHz = HAM_BANDS[5].dialFreqHz;
    this.txFreqHz = HAM_BANDS[5].dialFreqHz;
    this.initWebSerialListeners();
  }

  /**
   * Configures which real CAT protocol family (Icom CI-V / Kenwood-style ASCII / none)
   * subsequent setFreqHz/setMode/setPtt calls speak, based on the selected rig's
   * manufacturer, plus that rig's CI-V address if applicable. Must be called whenever the
   * station's configured rig model changes (App.tsx does this on config.rigModel changes).
   */
  public configureRig(rigModelName: string): void {
    const rig = getRigByName(rigModelName);
    this.activeProtocolFamily = rig ? getProtocolFamilyForRig(rig.mfg, rig.model) : 'NONE';
    this.activeCivAddr = parseCivAddr(rig?.defaultCiv, 0x00);
  }

  /**
   * Points the controller at a Hamlib rigctld daemon, so frequency, mode and PTT commands go
   * to the radio through the native server's TCP relay.
   *
   * Before the relay existed, selecting "Hamlib" as the CAT method sent nothing at all: the
   * browser had no way to reach the daemon, so the mode tracked state locally and looked like
   * it was working. It is still the default choice in the setup wizard, which is why making it
   * actually function matters more than hiding it.
   */
  public configureHamlibEndpoint(host: string, port: number, enabled: boolean): void {
    this.hamlibHost = host || '127.0.0.1';
    this.hamlibPort = port || 4532;
    this.hamlibRelayEnabled = enabled;
  }

  /**
   * True when rigctl commands should be relayed to a daemon rather than written to serial.
   *
   * The operator's chosen CAT method decides the transport, and nothing else. This used to
   * also require `!this.isSerialConnected`, so pairing a serial port for RTS keying silently
   * moved CAT off the daemon and onto raw CI-V/Kenwood bytes written to that port - a port
   * which, on a Hamlib station, rigctld already owns. Two programs writing one UART is not a
   * configuration anybody chose; it just looked like "CAT stopped working".
   */
  private useHamlibRelay(): boolean {
    return this.hamlibRelayEnabled && isLocalServerAvailable();
  }

  /**
   * Sends one rigctl command to the daemon, records the reply in the diagnostic log, and
   * reports whether the DAEMON accepted it - not merely whether the relay reached it.
   *
   * `result.success` only means the HTTP relay completed a TCP exchange. rigctld answers a
   * refused command with `RPRT <non-zero>`, which this used to log green: a `T 1` refused by a
   * daemon started with `-P NONE`, or against a rig whose PTT is not on the CAT link, showed
   * in the rig log as OK while the transmitter stayed in receive. The rig log is the only
   * diagnostic surface an operator has here, so it has to be able to say no.
   */
  private async relayRigctl(command: string, timeoutSec = 2.0): Promise<boolean> {
    const result = await sendRigctlCommand(command, this.hamlibHost, this.hamlibPort, timeoutSec);
    if (!result.success) {
      this.logCommand(command, result.error || 'rigctld relay failed', 'ERROR');
      return false;
    }
    const response = (result.data?.response || '').trim();
    const rprt = /^RPRT\s+(-?\d+)/.exec(response);
    if (rprt && rprt[1] !== '0') {
      this.logCommand(command, `${response} (rigctld refused the command)`, 'ERROR');
      return false;
    }
    this.logCommand(command, response || 'OK', 'OK');
    return true;
  }

  /**
   * Listen to real OS USB serial hardware connect/disconnect events
   */
  private initWebSerialListeners(): void {
    if (typeof navigator !== 'undefined' && (navigator as any).serial) {
      try {
        (navigator as any).serial.addEventListener('connect', (event: any) => {
          console.info('Hardware serial device connected:', event.target);
          this.queryRealSerialPorts();
        });
        (navigator as any).serial.addEventListener('disconnect', (event: any) => {
          console.info('Hardware serial device disconnected:', event.target);
          if (this.serialPort === event.target) {
            this.disconnectWebSerial();
          }
          this.queryRealSerialPorts();
        });
      } catch (e) {
        console.warn('Web Serial event listeners not supported on this platform:', e);
      }
    }
  }

  public subscribeToPortChanges(callback: (ports: DiscoveredSerialPort[]) => void): () => void {
    this.portListeners.push(callback);
    // Fire immediately with current state
    this.queryRealSerialPorts().then(callback).catch(() => {});
    return () => {
      this.portListeners = this.portListeners.filter(cb => cb !== callback);
    };
  }

  private notifyPortListeners(ports: DiscoveredSerialPort[]) {
    this.portListeners.forEach(cb => {
      try {
        cb(ports);
      } catch (e) {
        console.error('Error notifying port listener:', e);
      }
    });
  }

  public getFreqHz(): number {
    return this.currentFreqHz;
  }

  public async setFreqHz(hz: number): Promise<boolean> {
    this.currentFreqHz = Math.round(hz);
    const bandIdx = HAM_BANDS.findIndex(b => Math.abs(b.dialFreqHz - hz) < 500000);
    if (bandIdx !== -1) {
      this.currentBandIdx = bandIdx;
    }
    const sent = await this.sendRigFrequency(this.currentFreqHz);
    // Logged from the outcome, not from the intent. A dial the radio never received used to
    // appear in the rig log as a successful set_freq, so an operator comparing the app's VFO
    // with the radio's had nothing to tell them which one was real.
    this.logCommand(
      `set_freq ${this.currentFreqHz}`,
      sent ? this.hardwareCommandStatusNote() : `not sent: ${this.catUnavailableReason()}`,
      sent ? 'OK' : 'ERROR'
    );
    return sent;
  }

  /**
   * Selects a band and tunes to its dial frequency.
   *
   * `dialFreqHz` exists so that a caller with a custom dial for this band (Band Manager
   * presets) can pass it. Without it, App.tsx had to call setFreqHz() for the custom dial and
   * then setBandByName() for the band, which sent a SECOND frequency - the stock one - a
   * moment later. The radio ended up on the stock dial while the app, and therefore the
   * transmit gate's band-plan check, believed it was on the custom one.
   */
  public async setBandByName(bandName: string, dialFreqHz?: number): Promise<boolean> {
    const band = HAM_BANDS.find(b => b.name === bandName || b.bandMeters === bandName);
    if (!band) return false;
    const targetHz = Math.round(dialFreqHz ?? band.dialFreqHz);
    this.currentFreqHz = targetHz;
    this.currentBandIdx = HAM_BANDS.indexOf(band);
    const sent = await this.sendRigFrequency(targetHz);
    this.logCommand(
      `set_freq ${targetHz}`,
      sent
        ? `${this.hardwareCommandStatusNote()} (${band.name})`
        : `not sent: ${this.catUnavailableReason()}`,
      sent ? 'OK' : 'ERROR'
    );
    return sent;
  }

  public getCurrentBand(): typeof HAM_BANDS[0] {
    return HAM_BANDS[this.currentBandIdx] || HAM_BANDS[5];
  }

  public getMode(): string {
    return this.currentMode;
  }

  /** Receiver passband in Hz, as reported on the rig faceplate and by `\get_mode`. */
  public getPassbandHz(): number {
    return this.currentPassbandHz;
  }

  public async setMode(mode: string): Promise<boolean> {
    this.currentMode = mode.toUpperCase();
    const sent = await this.sendRigMode(this.currentMode);
    this.logCommand(
      `set_mode ${mode}`,
      sent ? this.hardwareCommandStatusNote() : `not sent: ${this.catUnavailableReason()}`,
      sent ? 'OK' : 'ERROR'
    );
    return sent;
  }

  /**
   * Writes a real frequency-set command to the wire, in whichever native protocol the
   * currently configured rig actually speaks (see configureRig()). 'NONE' (no CAT hardware
   * connected, or an unrecognized rig family) intentionally sends nothing - there is no
   * meaningful protocol to speak to a device that isn't there or isn't identified.
   */
  private async sendRigFrequency(hz: number): Promise<boolean> {
    if (this.useHamlibRelay()) {
      return this.relayRigctl(`F ${Math.round(hz)}`);
    }
    if (this.activeProtocolFamily === 'CIV') {
      return this.sendHardwareBytes(civSetFrequency(this.activeCivAddr, hz));
    }
    if (this.activeProtocolFamily === 'KENWOOD') {
      return this.sendHardwareText(kenwoodSetFrequency(hz));
    }
    if (this.activeProtocolFamily === 'YAESU') {
      return this.sendHardwareText(yaesuSetFrequency(hz));
    }
    return false;
  }

  private async sendRigMode(mode: string): Promise<boolean> {
    if (this.useHamlibRelay()) {
      // rigctld takes a mode name plus a passband in Hz; 0 asks it to use the rig's default.
      return this.relayRigctl(`M ${mode} 0`);
    }
    if (this.activeProtocolFamily === 'CIV') {
      return this.sendHardwareBytes(civSetMode(this.activeCivAddr, mode));
    }
    if (this.activeProtocolFamily === 'KENWOOD') {
      return this.sendHardwareText(kenwoodSetMode(mode));
    }
    if (this.activeProtocolFamily === 'YAESU') {
      return this.sendHardwareText(yaesuSetMode(mode));
    }
    return false;
  }

  /**
   * Writes a real PTT command and reports whether it reached the radio.
   *
   * This returned `void`, and `setPtt`'s CAT branch reported success regardless. All three of
   * its ways of doing nothing - no protocol configured for the selected rig, no open serial
   * port, a write that threw - were silent, so "Test PTT" answered "✓ CAT PTT verified" for a
   * transmitter that had never been addressed, and the sequencer transmitted a full frame into
   * a radio sitting in receive. A keying function that cannot say "no" is worse than none.
   */
  private async sendRigPtt(tx: boolean): Promise<boolean> {
    if (this.useHamlibRelay()) {
      // A shorter deadline than the other relayed commands, because the transmit path waits on
      // this one: keying happens in the first half-second of the slot, and a frame is 24 s of a
      // 30 s slot. A daemon that has not answered a PTT command within a second is not going to
      // key the radio in time for this slot, and reporting that beats eating the slot's margin.
      return this.relayRigctl(`T ${tx ? 1 : 0}`, 1.0);
    }
    if (this.activeProtocolFamily === 'CIV') {
      return this.sendHardwareBytes(civSetPtt(this.activeCivAddr, tx));
    }
    if (this.activeProtocolFamily === 'KENWOOD') {
      return this.sendHardwareText(kenwoodSetPtt(tx));
    }
    if (this.activeProtocolFamily === 'YAESU') {
      return this.sendHardwareText(yaesuSetPtt(tx));
    }
    return false;
  }

  private hardwareCommandStatusNote(): string {
    if (this.useHamlibRelay()) return `Hamlib rigctld relay ${this.hamlibHost}:${this.hamlibPort}`;
    if (this.activeProtocolFamily === 'CIV') return `CI-V 0x${this.activeCivAddr.toString(16).padStart(2, '0')}`;
    if (this.activeProtocolFamily === 'KENWOOD') return 'Kenwood-style ASCII';
    if (this.activeProtocolFamily === 'YAESU') return 'Yaesu new-CAT ASCII';
    return 'no rig protocol configured';
  }

  /**
   * Why a CAT command could not be sent, in words an operator can act on. Only called once
   * something has already failed, so it names the missing piece rather than describing success.
   */
  private catUnavailableReason(): string {
    // The transport in use decides the diagnosis. Checking the serial port first would tell a
    // Hamlib operator whose daemon is down to go and pair a serial port, which is the wrong
    // cable and the wrong fix.
    if (this.useHamlibRelay()) {
      return (
        `rigctld at ${this.hamlibHost}:${this.hamlibPort} did not accept the command - check that it ` +
        'is running, that it was started for this rig, and that its PTT type is not "none" ' +
        '(see the rig control log for the daemon\'s own reply)'
      );
    }
    if (this.activeProtocolFamily === 'NONE') {
      return this.hamlibRelayEnabled
        ? 'CAT is set to Hamlib but the native z-30 server is not backing this page, so no rigctld relay exists - ' +
            'launch z-30 with "z30-web", or switch CAT Method to Direct Serial'
        : 'no Direct Serial CAT protocol is known for the selected rig - choose a supported model, ' +
            'or switch CAT Method to Hamlib and run rigctld, which carries per-model command tables';
    }
    if (!this.serialPort || !this.serialPort.writable) {
      return 'no serial port is open - pair the radio with "Connect Serial Port" before using CAT keying';
    }
    return 'the serial port rejected the CAT command';
  }

  /**
   * The single compliance gate every transmit entry point must pass before a carrier exists.
   *
   * Nothing used to check any of this. There was no band-edge check, no privilege model, and
   * no requirement that the operator had even entered a callsign - `band_manager.py` held band
   * data that the transmit path never consulted. The consequences of getting it wrong are the
   * operator's licence, so the gate fails closed: an unconfigured station cannot transmit, and
   * every refusal names the condition that failed rather than just saying no.
   *
   * @param config - The current station configuration.
   * @param audioOffsetHz - Audio-passband offset of the transmitted signal, added to the dial
   *   frequency to obtain the frequency actually radiated.
   * @param dialFreqHz - Dial frequency in Hz; defaults to the controller's tracked VFO.
   */
  public canTransmit(
    config: StationConfig,
    audioOffsetHz: number = 0,
    dialFreqHz?: number
  ): TransmitPermission {
    const violations: string[] = [];

    // 1. Callsign. An empty or malformed callsign means an unidentified transmission.
    const call = (config.myCall || '').trim().toUpperCase();
    if (!call) {
      violations.push('No callsign is configured. Enter your callsign in Station Settings before transmitting.');
    } else if (!isValidCallsign(call)) {
      violations.push(`"${call}" is not a syntactically valid amateur callsign.`);
    } else if (call === DEFAULT_STATION_CONFIG.myCall.toUpperCase()) {
      violations.push(
        `The callsign is still the shipped placeholder "${call}". Set your own callsign in Station Settings - ` +
        'transmitting under another station\'s call is not yours to do.'
      );
    }

    // 2. Regulatory region and licence class must both be chosen. Guessing either one on the
    //    operator's behalf is exactly the kind of silent assumption this gate exists to stop.
    const region = config.regulatoryRegion as RegulatoryRegion | undefined;
    const licenseClass = config.licenseClass as LicenseClass | undefined;
    const plan = region ? BAND_PLANS[region] : undefined;
    if (!region || !plan) {
      violations.push('No regulatory region is configured. Choose your region in Station Settings.');
    }
    if (!licenseClass) {
      violations.push('No licence class is configured. Choose your licence class in Station Settings.');
    } else if (plan && !plan.licenseClasses.includes(licenseClass)) {
      violations.push(`Licence class "${licenseClass}" does not apply in ${plan.displayName}.`);
    }

    // 3. The frequency actually radiated: dial plus audio offset.
    const dial = dialFreqHz ?? this.currentFreqHz;
    const txFrequencyHz = Number.isFinite(dial) && Number.isFinite(audioOffsetHz) ? dial + audioOffsetHz : NaN;
    let bandSegment: string | undefined;

    if (!Number.isFinite(txFrequencyHz) || txFrequencyHz <= 0) {
      violations.push('The transmit frequency could not be determined from the dial frequency and audio offset.');
    } else if (plan && licenseClass) {
      // Checked against the emission's edges, not its centre: a z-30 signal is 50 Hz wide, so
      // a centre sitting 10 Hz inside a band edge still puts most of the power outside it.
      const occupiedHz = Z30_SPECS.TOTAL_BANDWIDTH_HZ;
      const segment = findPermittedSegment(plan.region, licenseClass, txFrequencyHz, occupiedHz);
      if (!segment) {
        const halfHz = occupiedHz / 2;
        const nearest = nearestPermittedSegment(plan.region, licenseClass, txFrequencyHz);
        const nearestNote = nearest
          ? nearest.distanceHz === 0
            ? ` The signal straddles the edge of ${nearest.segment.band} ` +
              `${(nearest.segment.startHz / 1e6).toFixed(3)}-${(nearest.segment.endHz / 1e6).toFixed(3)} MHz: ` +
              `its centre is inside, but a ${occupiedHz.toFixed(0)} Hz emission is not. ` +
              `Move at least ${halfHz.toFixed(0)} Hz further in.`
            : ` The nearest permitted segment is ${nearest.segment.band} ` +
              `${(nearest.segment.startHz / 1e6).toFixed(3)}-${(nearest.segment.endHz / 1e6).toFixed(3)} MHz, ` +
              `${(nearest.distanceHz / 1000).toFixed(1)} kHz away.`
          : '';
        violations.push(
          `${((txFrequencyHz - halfHz) / 1e6).toFixed(6)}-${((txFrequencyHz + halfHz) / 1e6).toFixed(6)} MHz ` +
          `(dial ${(dial / 1e6).toFixed(6)} MHz + ${audioOffsetHz.toFixed(0)} Hz audio, ${occupiedHz.toFixed(0)} Hz wide) ` +
          `is not inside any data-mode segment available to a ${licenseClass} licensee in ${plan.displayName}.` +
          nearestNote
        );
      } else {
        bandSegment = `${segment.band} ${(segment.startHz / 1e6).toFixed(3)}-${(segment.endHz / 1e6).toFixed(3)} MHz`;
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      txFrequencyHz: Number.isFinite(txFrequencyHz) ? txFrequencyHz : undefined,
      bandSegment,
    };
  }

  public getPtt(): boolean {
    return this.pttState;
  }

  /**
   * Why the last keying attempt failed, or null if it succeeded. The transmit path in App.tsx
   * puts this in front of the operator instead of starting a frame into a radio that never
   * left receive.
   */
  public getLastPttFailure(): string | null {
    return this.lastPttHardwareOutcome.ok ? null : this.lastPttHardwareOutcome.failureNote || 'the hardware did not accept the keying command';
  }

  /**
   * Drives the PTT line for the configured keying method.
   *
   * The single hardware keying implementation: the sequencer, manual TX, tune and the wiring
   * test all come through here. Returns whether the hardware actually accepted the command -
   * `false` means nothing was keyed (or nothing was released), and a caller reporting success
   * from this method's return value will not be reporting a fiction.
   *
   * NOTE: this is NOT the compliance gate. `canTransmit()` is, and callers must run it before
   * keying; see `assertCanTransmit` in App.tsx.
   */
  public async setPtt(
    tx: boolean,
    method: PttMethodType = 'CAT',
    polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW' = 'ACTIVE_HIGH',
    options?: PttHardwareOptions
  ): Promise<boolean> {
    this.pttState = tx;

    // The release path must drive the SAME pin/host the key path drove. Callers that unkey
    // without repeating the options object used to fall straight through to the hardcoded
    // defaults below: a station keyed on CM108 GPIO 4 was released on GPIO 3 and stayed
    // transmitting, a station keyed on BCM 27 was released on BCM 17, and a remote TCI SDR was
    // never told to stop because the release went to 127.0.0.1. Only the Pi path had a
    // backstop (the server dead-man switch); CM108 and TCI had none.
    //
    // Captured BEFORE armTxWatchdog()/disarmTxWatchdog(), both of which overwrite or clear
    // lastPttContext.
    const effectiveOptions = options ?? this.lastPttContext?.options;

    // Arm (or disarm) the maximum-transmission watchdog before doing anything else, so an
    // exception thrown by the keying code below still leaves a timer that will unkey.
    if (tx) {
      this.armTxWatchdog(method, polarity, effectiveOptions);
    } else {
      this.disarmTxWatchdog();
    }

    // Every branch records whether the hardware actually accepted the command, so callers -
    // notably testPttKey() - can report a real outcome instead of assuming success. Four of the
    // nine methods used to have a second, parallel implementation inside testPttKey() that only
    // wrote to the command log; an operator wiring a DRA, a DigiPi, a SunSDR2 or a WinKeyer got
    // a green tick from hardware that had never been addressed.
    let hardwareOk = true;
    let hardwareDetail: string | undefined;
    let failureNote: string | undefined;

    if (method === 'CAT') {
      hardwareOk = await this.sendRigPtt(tx);
      hardwareDetail = `CAT command (${this.hardwareCommandStatusNote()})`;
      if (!hardwareOk) failureNote = this.catUnavailableReason();
      this.logCommand(
        `set_ptt ${tx ? '1' : '0'}`,
        hardwareOk ? this.hardwareCommandStatusNote() : `not sent: ${failureNote!}`,
        hardwareOk ? 'OK' : 'ERROR'
      );
    } else if (method === 'RTS' || method === 'DTR') {
      const activeState = polarity === 'ACTIVE_HIGH' ? tx : !tx;
      const signal = method === 'RTS' ? 'requestToSend' : 'dataTerminalReady';
      // The keying port, which is the separately paired PTT port when the operator has one -
      // a Digirig or a second FTDI cable alongside a CAT link. `pttPort` was collected in
      // Station Settings, printed in this very message, and then never used: the line was
      // always driven on whichever single port happened to be paired for CAT.
      const keyingPort = this.pttSerialPort || this.serialPort;
      const portLabel = this.pttSerialPort
        ? this.pttSerialPortLabel || 'the paired PTT port'
        : 'the paired CAT serial port';
      hardwareDetail = `${method} pin on ${portLabel}`;
      if (keyingPort && keyingPort.setSignals) {
        try {
          await keyingPort.setSignals({ [signal]: activeState });
          this.logCommand(`${method}_SET ${activeState ? '1' : '0'}`, `PIN_UPDATED on ${portLabel}`, 'OK');
        } catch (e) {
          console.warn(`Failed to set ${method} signal on serial port:`, e);
          hardwareOk = false;
          failureNote = `Serial port rejected the ${method} signal change`;
          this.logCommand(`${method}_SET ${activeState ? '1' : '0'}`, failureNote, 'ERROR');
        }
      } else {
        // No open port is a failure, not a no-op: nothing was keyed.
        hardwareOk = false;
        failureNote =
          `No serial port is open for ${method} keying - pair one with "Connect Serial Port", or ` +
          '"Pair PTT Port" if PTT is on a different cable from CAT';
        this.logCommand(`${method}_SET ${activeState ? '1' : '0'}`, failureNote, 'ERROR');
      }
    } else if (method === 'AUDIO_TONE_RIGHT') {
      const toneFreq = effectiveOptions?.pttToneFreqHz || 1000;
      hardwareDetail = `Right audio channel @ ${toneFreq} Hz`;
      this.logCommand(
        `AUDIO_TONE_RIGHT_${tx ? 'ACTIVE' : 'RELEASED'}`,
        tx ? `Right-Channel ${toneFreq}Hz PTT Keying Tone Outputting` : 'Right-Channel Tone Standby',
        'OK'
      );
    } else if (method === 'CM108_GPIO') {
      const pin = effectiveOptions?.cm108GpioPin || DEFAULT_CM108_GPIO_PIN;
      // Polarity applies here exactly as it does on the Pi's GPIO. It used to be dropped on
      // the way in, so an active-low DRA/URI interface was driven backwards in both
      // directions - no carrier while transmitting, PTT asserted while receiving - and the
      // wiring test still reported "Negative / Pull-to-GND (Active Low)" and a pass, because
      // that string was built from the argument rather than from what was driven.
      const activeState = polarity === 'ACTIVE_HIGH' ? tx : !tx;
      hardwareDetail = `C-Media USB Audio GPIO pin ${pin} [${polarity}]`;
      hardwareOk = await this.setCm108Gpio(pin, activeState);
      if (!hardwareOk) {
        failureNote = 'CM108/CM119 HID device not paired - use "Pair CM108/CM119 Device" first';
      }
      this.logCommand(
        `CM108_GPIO_${pin}_${activeState ? 'HIGH' : 'LOW'}`,
        hardwareOk
          ? tx
            ? `USB Audio Chip GPIO${pin} driven ${activeState ? 'high' : 'low'} (PTT active, ${polarity})`
            : `USB Audio Chip GPIO${pin} released to ${activeState ? 'high' : 'low'} (RX standby, ${polarity})`
          : failureNote!,
        hardwareOk ? 'OK' : 'ERROR'
      );
    } else if (method === 'RASPBERRY_PI_GPIO') {
      const bcmPin = effectiveOptions?.rpiGpioPin || DEFAULT_RPI_BCM_PIN;
      hardwareDetail = `Raspberry Pi BCM pin ${bcmPin}`;
      hardwareOk = await this.setRpiGpio(bcmPin, tx, polarity);
      if (!hardwareOk) {
        failureNote =
          'GPIO bridge unreachable - only works when running via the native z30_dsp web server on the Pi itself (not a plain browser tab)';
      }
      this.logCommand(
        `RPI_GPIO_${bcmPin}_${tx ? '1' : '0'}`,
        hardwareOk
          ? tx
            ? `SBC BCM Pin ${bcmPin} Asserted [${polarity}] via local z30_dsp /api/gpio bridge`
            : `SBC BCM Pin ${bcmPin} Released to Standby`
          : failureNote!,
        hardwareOk ? 'OK' : 'ERROR'
      );
    } else if (method === 'TCI_NETWORK') {
      const host = effectiveOptions?.tciHost || DEFAULT_TCI_HOST;
      const port = effectiveOptions?.tciPort || DEFAULT_TCI_PORT;
      hardwareDetail = `TCI socket ${host}:${port}`;
      hardwareOk = await this.sendTciPtt(host, port, tx);
      if (!hardwareOk) {
        failureNote = `Could not reach TCI server at ${host}:${port}`;
      }
      this.logCommand(
        `TCI_TX_${tx ? 'ON' : 'OFF'}`,
        hardwareOk ? `${host}:${port} => trx:0:tx:${tx ? 'true' : 'false'};` : failureNote!,
        hardwareOk ? 'OK' : 'ERROR'
      );
    } else if (method === 'WINKEYER') {
      hardwareDetail = `K1EL WinKeyer on ${effectiveOptions?.winkeyerPort || 'the paired serial port'}`;
      hardwareOk = await this.setWinkeyerPtt(tx);
      if (!hardwareOk) {
        failureNote = 'WinKeyer serial link not open';
      }
      this.logCommand(
        `WINKEYER_PTT`,
        hardwareOk ? `PTT-follows-key ${tx ? 'engaged (holding key line down)' : 'released'}` : failureNote!,
        hardwareOk ? 'OK' : 'ERROR'
      );
    } else if (method === 'VOX') {
      // In VOX mode, the physical radio transmitter keys via audio output modulation from the sound card
      hardwareDetail = 'Sound-card audio carrier (radio VOX circuit)';
      this.logCommand(`VOX_${tx ? 'ACTIVE' : 'STANDBY'}`, tx ? 'Audio Carrier Active (Radio VOX Triggered)' : 'Audio Carrier Inactive', 'OK');
    } else {
      hardwareOk = false;
      failureNote = `Unknown PTT method "${method}"`;
    }

    this.lastPttHardwareOutcome = { ok: hardwareOk, hardwareDetail, failureNote };

    // A key that never reached the hardware must not leave the app believing it is keyed - the
    // header, the sequencer and the watchdog all read pttState.
    if (tx && !hardwareOk) {
      this.pttState = false;
      this.disarmTxWatchdog();
    }

    return hardwareOk;
  }

  /**
   * Arms the hard maximum-transmission timer, and - for the GPIO PTT path - the repeating
   * keepalive that holds the server's dead-man switch open.
   *
   * Two layers, deliberately. The browser-side timer catches an exception or a stuck state
   * machine inside this app. The server-side dead-man switch catches the cases this timer
   * cannot: a crashed tab, a killed renderer, a machine that sleeps mid-transmission. Neither
   * layer can be relied on alone, because the failure mode being defended against is precisely
   * "this JavaScript stopped running".
   */
  private armTxWatchdog(
    method: PttMethodType,
    polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW',
    options?: PttHardwareOptions
  ): void {
    this.disarmTxWatchdog();
    this.lastPttContext = { method, polarity, options };

    this.txWatchdogTimer = setTimeout(() => {
      this.txWatchdogTimer = null;
      if (!this.pttState) return;
      this.logCommand(
        'PTT_WATCHDOG_RELEASE',
        `Transmitter was still keyed after ${MAX_TX_SECONDS}s - forcing PTT off. A z-30 frame is ` +
          '24s, so this means the transmit sequence did not finish normally.',
        'ERROR'
      );
      void this.forceUnkey();
    }, MAX_TX_SECONDS * 1000);

    if (method === 'RASPBERRY_PI_GPIO' && isLocalServerAvailable()) {
      const pin = options?.rpiGpioPin || DEFAULT_RPI_BCM_PIN;
      this.gpioKeepaliveTimer = setInterval(() => {
        void keepAliveGpioPin(pin).then((result) => {
          if (!result.success && this.pttState) {
            // The server already dropped the line; stop pretending we are keyed.
            this.logCommand('PTT_DEADMAN_EXPIRED', result.error || 'GPIO dead-man switch released the PTT line.', 'ERROR');
            void this.forceUnkey();
          }
        });
      }, GPIO_KEEPALIVE_INTERVAL_MS);
    }
  }

  private disarmTxWatchdog(): void {
    if (this.txWatchdogTimer) {
      clearTimeout(this.txWatchdogTimer);
      this.txWatchdogTimer = null;
    }
    if (this.gpioKeepaliveTimer) {
      clearInterval(this.gpioKeepaliveTimer);
      this.gpioKeepaliveTimer = null;
    }
    this.lastPttContext = null;
  }

  /**
   * Unkeys the transmitter through every path that might be holding it, and silences the audio
   * carrier. Called by the watchdog, by the dead-man expiry, and on page unload.
   */
  public async forceUnkey(): Promise<void> {
    const context = this.lastPttContext;
    if (context) {
      try {
        await this.setPtt(false, context.method, context.polarity, context.options);
      } catch (e) {
        console.error('Failed to release PTT during forced unkey:', e);
      }
    }
    // Belt and braces: drop every other keying path too, in case the configured method was
    // not the one actually holding the line.
    this.releasePttEmergency();
  }

  public getSplit(): boolean {
    return this.splitState;
  }

  /**
   * NOTE: not currently wired to any UI control (z-30 keeps TX/RX on the same audio passband
   * rather than using true split-VFO operation), so this only tracks state locally. Real
   * split-VFO CAT commands differ meaningfully between CI-V (0x07/0x0F) and Kenwood-style
   * (SP0;/SP1;/FB;) and are not implemented until an actual split-operation UI needs them.
   */
  public setSplit(split: boolean, txFreqHz?: number) {
    this.splitState = split;
    if (txFreqHz) this.txFreqHz = txFreqHz;
    this.logCommand(`set_split ${split ? '1' : '0'}`, 'state tracked locally (no split CAT command sent)', 'OK');
  }

  public getSmeterDb(rxFreqHz: number = 1500): number {
    if (this.pttState) return 0;
    return audioEngine.getChannelSmeterDb(rxFreqHz).rfDb;
  }

  public getSmeterInfo(rxFreqHz: number = 1500) {
    if (this.pttState) {
      return {
        rfDb: 0,
        sUnit: 'TX',
        sMeterPercent: 100,
        audioDb: 0,
      };
    }
    return audioEngine.getChannelSmeterDb(rxFreqHz);
  }

  // getSwr() and getForwardPowerWatts() used to live here. Neither measured anything:
  // getSwr() returned a hardcoded 1.1 whenever PTT was asserted, and getForwardPowerWatts()
  // echoed back whatever nominal wattage it was handed. A plausible-looking 1.1 tells an
  // operator their antenna is fine when nothing looked at the antenna. If real readings are
  // wanted, query the rig for them over CAT (Icom CI-V 0x15 0x12 / Kenwood "RM";) and report
  // only what the radio answers.

  public getIsConnected(): boolean {
    return this.isConnected || this.isSerialConnected;
  }

  /**
   * Manually marks the Hamlib rigctld network daemon link as connected or disconnected.
   *
   * Browsers cannot open a raw TCP socket to a local rigctld daemon (only WebSocket, HTTP/fetch,
   * and the Web Serial/USB/Bluetooth APIs are available), so this network mode has no way to be
   * verified from here the way Direct Serial mode can be (see testCatConnection's real
   * sendHardwareBytes() handshake for that path). This toggle is a user assertion that they
   * have started rigctld externally, not a live probe result - callers must not present it as
   * a verified connection.
   */
  public toggleConnection(): boolean {
    this.isConnected = !this.isConnected;
    this.logCommand(
      this.isConnected ? 'CONNECT' : 'DISCONNECT',
      this.isConnected
        ? 'Hamlib rigctld marked connected (127.0.0.1:4532) - a manual assertion, not a probe result. Use "Test CAT Connection" to actually query the daemon through the native server\'s TCP relay.'
        : 'Hamlib rigctld marked disconnected',
      'OK'
    );
    return this.isConnected;
  }

  public getIsSerialConnected(): boolean {
    return this.isSerialConnected;
  }

  /**
   * Check if Web Serial API is supported in browser
   */
  public isWebSerialSupported(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as any).serial;
  }

  /**
   * Query all real authorized physical/virtual serial ports from the system via Web Serial API
   */
  public async queryRealSerialPorts(): Promise<DiscoveredSerialPort[]> {
    if (!this.isWebSerialSupported()) {
      return [];
    }

    try {
      const rawPorts: any[] = await (navigator as any).serial.getPorts();
      const discovered: DiscoveredSerialPort[] = rawPorts.map((port: any, idx: number) => {
        const info = port.getInfo ? port.getInfo() : {};
        const vid = info.usbVendorId;
        const pid = info.usbProductId;
        const vendorHex = vid !== undefined ? `0x${vid.toString(16).padStart(4, '0').toUpperCase()}` : undefined;
        const prodHex = pid !== undefined ? `0x${pid.toString(16).padStart(4, '0').toUpperCase()}` : undefined;
        const vendorName = vid !== undefined && USB_VENDOR_MAP[vid] ? USB_VENDOR_MAP[vid] : undefined;

        let displayName = '';
        if (vendorName) {
          displayName = `[USB Serial] ${vendorName} (VID:${vendorHex} PID:${prodHex})`;
        } else if (vendorHex && prodHex) {
          displayName = `[USB Serial] Device (VID:${vendorHex} PID:${prodHex})`;
        } else {
          displayName = `[Hardware Serial] Interface #${idx + 1}`;
        }

        const id = `webserial:${vendorHex || 'raw'}:${prodHex || idx}`;
        const isCurrentOpen = this.serialPort === port && this.isSerialConnected;

        return {
          id,
          path: id,
          displayName: isCurrentOpen ? `${displayName} (ACTIVE)` : displayName,
          vendorId: vid,
          productId: pid,
          vendorName,
          isWebSerial: true,
          isPaired: true,
          isOpen: isCurrentOpen,
          nativePort: port,
        };
      });

      this.pairedSerialPorts = discovered;
      this.notifyPortListeners(discovered);
      return discovered;
    } catch (err) {
      console.warn('Failed to query Web Serial ports from browser:', err);
      return [];
    }
  }

  public getPairedSerialPorts(): DiscoveredSerialPort[] {
    return this.pairedSerialPorts;
  }

  /**
   * Line settings for `SerialPort.open()`, from the operator's configuration.
   *
   * `dataBits`, `stopBits` and `handshake` are collected by both settings modals and were
   * never passed to the browser, so every port opened 8-N-1 with no flow control regardless of
   * what the operator had configured. A rig set to two stop bits, or an interface that needs
   * hardware handshake, saw framing errors instead of commands - "connected, but the radio
   * ignores everything".
   */
  private serialPortOptions(baudRate: number, line?: SerialLineSettings): {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    flowControl?: string;
  } {
    const settings = line ?? this.serialLineSettings;
    const handshake = (settings?.handshake || '').toLowerCase();
    return {
      baudRate,
      dataBits: settings?.dataBits === 7 ? 7 : 8,
      stopBits: settings?.stopBits === 2 ? 2 : 1,
      parity: 'none',
      // Web Serial only models hardware (RTS/CTS) flow control; XON/XOFF is a software
      // convention the browser does not implement, so it stays "none" rather than being
      // silently mapped onto the RTS line this app also uses for PTT.
      flowControl: handshake.includes('hardware') ? 'hardware' : 'none',
    };
  }

  /**
   * Puts RTS and DTR into the RELEASED state for this station's wiring on a freshly opened port.
   *
   * Chromium asserts both lines when a port opens. On an active-high RTS- or DTR-keyed station
   * that is a transmit command: the radio keyed the moment the operator pressed "Connect Serial
   * Port", before any compliance check had run, and stayed keyed until something else lowered
   * the line.
   *
   * The released state is NOT simply "both low", which is why this takes the polarity: on an
   * active-low interface (an inverting optocoupler) a low line is the keyed one, and blanket
   * de-assertion would key exactly the stations it was meant to protect. ACTIVE_HIGH is the
   * default because it is the commoner wiring and the safer guess when nothing is configured.
   */
  private async deassertKeyingLines(port: WebSerialPortLike): Promise<void> {
    if (!port.setSignals) return;
    const released = this.keyingPolarity !== 'ACTIVE_LOW' ? false : true;
    try {
      await port.setSignals({ requestToSend: released, dataTerminalReady: released });
    } catch (e) {
      // A port that refuses signal control cannot be keyed on RTS/DTR either; setPtt reports
      // that when the operator actually tries.
      console.warn('Could not put RTS/DTR into the released state after opening the port:', e);
    }
  }

  /**
   * Tells the controller which keying polarity the operator has configured, so that opening a
   * port leaves the line in the released state for THIS station rather than a hardcoded low.
   * App.tsx calls this whenever the config changes; the settings modals call it from the form
   * before pairing, because a port can be paired before the config is saved.
   */
  public configureKeying(polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW'): void {
    this.keyingPolarity = polarity;
  }

  /**
   * Prompts OS native hardware selection dialog to query and pair a real serial / USB device
   */
  public async requestAndPairRealPort(
    baudRate: number = 115200,
    line?: SerialLineSettings
  ): Promise<{ success: boolean; portInfo?: DiscoveredSerialPort; message: string }> {
    if (line) this.serialLineSettings = line;
    if (!this.isWebSerialSupported()) {
      return {
        success: false,
        message: 'Web Serial API is not supported in this browser. Please use Google Chrome, MS Edge, or standard Hamlib TCP daemon (127.0.0.1:4532).',
      };
    }

    try {
      const selectedPort = await (navigator as any).serial.requestPort();
      if (!selectedPort) {
        return { success: false, message: 'No serial port selected by user.' };
      }

      // Close previously active port if any
      if (this.serialPort && this.serialPort !== selectedPort) {
        await this.disconnectWebSerial();
      }

      const port: WebSerialPortLike = selectedPort;
      this.serialPort = port;

      // Try opening the port with the configured line settings. A failure here is reported as
      // a failure: this used to warn to the console and then return "✓ Real Serial Hardware
      // Paired" anyway, which is what an operator saw when rigctld, WSJT-X or a stale process
      // already held the port. Every later CAT write then hit a port with no writable stream
      // and did nothing, silently.
      try {
        await port.open(this.serialPortOptions(baudRate));
        this.isSerialConnected = true;
        this.isConnected = true;
      } catch (openErr: any) {
        // "already open" means this page opened it earlier - that is still a usable port.
        if (String(openErr?.message).toLowerCase().includes('already open')) {
          this.isSerialConnected = true;
          this.isConnected = true;
        } else {
          this.serialPort = null;
          this.isSerialConnected = false;
          this.isConnected = false;
          const detail = String(openErr?.message || openErr || 'unknown error');
          this.logCommand('SERIAL_PAIR_FAIL', detail, 'ERROR');
          return {
            success: false,
            message:
              `✗ Serial port could not be opened at ${baudRate} baud: ${detail}. ` +
              'If Hamlib rigctld, WSJT-X or another program already has this port, close it first - ' +
              'only one program can hold a serial port.',
          };
        }
      }

      // Leave the keying lines de-asserted. Chromium asserts DTR and RTS when a port opens, so
      // on an RTS- or DTR-keyed station simply connecting the cable put the radio into
      // transmit until something else happened to lower the line.
      await this.deassertKeyingLines(port);

      const allPorts = await this.queryRealSerialPorts();
      const matched = allPorts.find(p => p.nativePort === selectedPort) || {
        id: 'webserial:paired',
        path: 'webserial:paired',
        displayName: `[Hardware Serial] Paired COM/USB Port @ ${baudRate} baud`,
        isWebSerial: true,
        isPaired: true,
        isOpen: this.isSerialConnected,
        nativePort: selectedPort,
      };

      this.logCommand('SERIAL_PAIR_OK', `Paired real serial hardware @ ${baudRate} baud`, 'OK');
      return {
        success: true,
        portInfo: matched,
        message: `✓ Real Serial Hardware Paired: ${matched.displayName}`,
      };
    } catch (e: any) {
      if (e?.name === 'NotFoundError') {
        return { success: false, message: 'Hardware pairing cancelled: No serial port selected.' };
      }
      return { success: false, message: String(e?.message || 'Failed to query / pair serial port') };
    }
  }

  /**
   * Connect to physical transceiver via Web Serial API
   */
  public async connectWebSerial(baudRate: number = 115200): Promise<{ success: boolean; message: string }> {
    return this.requestAndPairRealPort(baudRate);
  }

  /**
   * Pairs a SECOND serial port used only for keying - RTS/DTR PTT and WinKeyer.
   *
   * For the common single-cable station this is unnecessary: PTT rides the CAT port and
   * nothing here needs to be paired. It exists for the wiring `wiki/06` §2 describes, where
   * PTT is on its own cable (a Digirig, a second FTDI, an optocoupler box) - and where the app
   * previously drove the CAT port's RTS line instead, keying nothing while reporting the
   * configured PTT port's name.
   *
   * The port is opened at 9600 baud because no data is sent on it for RTS/DTR keying; only the
   * modem control lines matter, and they are driven by setSignals() regardless of baud. Both
   * lines are dropped immediately after opening, for the reason in deassertKeyingLines().
   */
  public async requestAndPairPttPort(
    baudRate: number = 9600
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isWebSerialSupported()) {
      return {
        success: false,
        message: 'Web Serial API is not supported in this browser. Use Chrome or Edge on the desktop.',
      };
    }
    try {
      const selected = await (navigator as any).serial.requestPort();
      if (!selected) return { success: false, message: 'No PTT serial port selected.' };
      if (selected === this.serialPort) {
        return {
          success: false,
          message:
            'That is the port already paired for CAT. Leave the PTT port unpaired to key on the CAT ' +
            'port - a separate PTT port is only for stations whose keying line is on a different cable.',
        };
      }

      const port: WebSerialPortLike = selected;
      try {
        await port.open({ baudRate });
      } catch (openErr: any) {
        if (!String(openErr?.message).toLowerCase().includes('already open')) {
          const detail = String(openErr?.message || openErr || 'unknown error');
          this.logCommand('PTT_PORT_PAIR_FAIL', detail, 'ERROR');
          return { success: false, message: `✗ PTT port could not be opened: ${detail}` };
        }
      }
      await this.deassertKeyingLines(port);

      this.pttSerialPort = port;
      const info = port.getInfo ? port.getInfo() : {};
      const vid = info.usbVendorId;
      this.pttSerialPortLabel =
        (vid !== undefined && USB_VENDOR_MAP[vid]) ||
        (vid !== undefined ? `USB serial device 0x${vid.toString(16).padStart(4, '0')}` : 'the paired PTT port');
      this.logCommand('PTT_PORT_PAIR_OK', `Keying port paired: ${this.pttSerialPortLabel}`, 'OK');
      return { success: true, message: `✓ PTT keying port paired: ${this.pttSerialPortLabel}` };
    } catch (e: any) {
      if (e?.name === 'NotFoundError') {
        return { success: false, message: 'PTT port pairing cancelled: no port selected.' };
      }
      return { success: false, message: String(e?.message || 'Failed to pair the PTT port') };
    }
  }

  /** True when keying goes to its own port rather than to the CAT port. */
  public isPttPortPaired(): boolean {
    return !!this.pttSerialPort;
  }

  public getPttPortLabel(): string | null {
    return this.pttSerialPortLabel;
  }

  /** Drops the separate keying port back to "key on the CAT port". */
  public async releasePttPort(): Promise<void> {
    const port = this.pttSerialPort;
    this.pttSerialPort = null;
    this.pttSerialPortLabel = null;
    if (this.pttSerialWriter) {
      try {
        await this.pttSerialWriter.close();
      } catch {
        // ignore
      }
      this.pttSerialWriter = null;
    }
    if (port) {
      // Never leave a keying line asserted on a port being handed back to the OS.
      await this.deassertKeyingLines(port);
      try {
        await port.close();
      } catch {
        // ignore
      }
      this.logCommand('PTT_PORT_RELEASED', 'Keying returns to the CAT serial port', 'OK');
    }
  }

  public async disconnectWebSerial(): Promise<void> {
    try {
      if (this.serialReader) {
        await this.serialReader.cancel();
        this.serialReader = null;
      }
      if (this.serialWriter) {
        await this.serialWriter.close();
        this.serialWriter = null;
      }
      if (this.serialPort) {
        await this.serialPort.close();
        this.serialPort = null;
      }
      this.isSerialConnected = false;
      this.isConnected = false;
      this.winkeyerConfigured = false;
      this.logCommand('SERIAL_CLOSE', 'Physical serial port closed', 'OK');
    } catch (e) {
      console.warn('Error closing serial port:', e);
    }
  }

  /**
   * Real CAT Query Hardware & Network Validation Engine (NO FALSE PASS)
   */
  public async testCatConnection(config: StationConfig): Promise<CatTestResult> {
    const catMethod = config.catMethod || 'Hamlib';
    const rigInfo = getRigByName(config.rigModel);
    const rigName = rigInfo ? rigInfo.name : config.rigModel;
    this.configureRig(config.rigModel);

    // 1. If CAT Method is "None" (Audio VOX only)
    if (catMethod === 'None') {
      return {
        success: false,
        message: 'ℹ CAT is disabled (Set to "None / Manual VOX"). No serial or network query executed. Radio will key via audio VOX and dial frequency is set manually.',
        rigName,
        details: 'VOX Mode Active',
      };
    }

    // 2. Direct Serial CAT.
    //
    // Routed on the CAT METHOD the operator chose, which is what the transmit path routes on
    // too (see useHamlibRelay). This used to branch on whether `config.serialPort` looked like
    // a device path - and the shipped default is '/dev/ttyUSB0 (COM3)' - so a Hamlib station
    // that never edited that field had its CAT link tested over Web Serial while frequency,
    // mode and PTT went to the rigctld relay. The test and the radio disagreed about which
    // cable was under test.
    if (catMethod === 'Direct Serial') {
      // If physical Web Serial port is NOT connected
      if (!this.isSerialConnected || !this.serialPort) {
        // Test if port is open in browser
        return {
          success: false,
          message: `✗ CAT Port Not Open: Serial port (${config.serialPort || 'COM3'}) is not currently connected. Click "Connect Serial Port" to pair your USB/CI-V transceiver interface or verify COM cable.`,
          rigName,
          portUsed: config.serialPort,
          details: 'Physical serial stream is not opened in browser.',
        };
      }

      // Write a real, protocol-appropriate frequency query (CI-V command 0x03 with no data,
      // or Kenwood-style "FA;") - this app does not implement a serial read/parse loop, so
      // this only verifies the write itself succeeds, not that the rig actually answered.
      try {
        let written = false;
        if (this.activeProtocolFamily === 'CIV') {
          written = await this.sendHardwareBytes(buildCivFrame(this.activeCivAddr, [0x03]));
        } else if (this.activeProtocolFamily === 'KENWOOD') {
          written = await this.sendHardwareText('FA;');
        } else if (this.activeProtocolFamily === 'YAESU') {
          written = await this.sendHardwareText('FA;');
        } else {
          return {
            success: false,
            message:
              `✗ No Direct Serial command set is implemented for "${rigName}". Icom and Xiegu (CI-V), ` +
              'Kenwood and Elecraft (Kenwood ASCII) and the modern Yaesu new-CAT rigs are supported ' +
              'directly; everything else - including the FT-817/857/897 and the 1990s Yaesu rigs, whose ' +
              'CAT is a different binary protocol per family - must go through Hamlib rigctld, which ' +
              'carries the per-model tables. Switch CAT Method to "Hamlib" and start rigctld.',
            rigName,
            portUsed: config.serialPort,
            details: 'No command set is guessed at for an unsupported model; a wrong command would be sent silently.',
          };
        }

        if (!written) {
          return {
            success: false,
            message: `✗ CAT Write Failed: the frequency query could not be written to ${config.serialPort}. The port is paired but not writable - re-pair it, and check that no other program holds it.`,
            rigName,
            portUsed: config.serialPort,
          };
        }

        return {
          success: true,
          message: `✓ CAT Query Sent: ${rigName} frequency query written to ${config.serialPort} @ ${config.baudRate} baud via ${this.hardwareCommandStatusNote()} (response not parsed - this confirms the write succeeded, not that the rig replied).`,
          vfoHz: this.currentFreqHz,
          mode: this.currentMode,
          rigName,
          portUsed: config.serialPort,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `✗ Serial Query Failed: Error writing to ${config.serialPort} (${err?.message || 'Device I/O error'}). Check baud rate and CI-V address.`,
          rigName,
          portUsed: config.serialPort,
        };
      }
    }

    // 3. Hamlib Network Daemon Mode (rigctld at hamlibHost:hamlibPort)
    const host = config.hamlibHost || '127.0.0.1';
    const port = config.hamlibPort || 4532;

    // A real probe: ask the daemon for the VFO frequency through the native server's TCP
    // relay and report what the radio actually answered.
    //
    // This used to return "✓ Hamlib rigctld Link Active" based solely on `this.isConnected` -
    // a boolean the operator flips with a manual toggle - and printed back the app's own
    // internal frequency as though the rig had reported it. No socket was ever opened; the
    // browser cannot open one. toggleConnection()'s own docstring said as much, and this
    // function contradicted it.
    if (!isLocalServerAvailable()) {
      return {
        success: false,
        message:
          `✗ Hamlib rigctld Unavailable In This Browser: a web page cannot open a raw TCP socket to ` +
          `${host}:${port}. Launch z-30 through its native server ("z30-web") so CAT commands can be ` +
          `relayed, or switch CAT Method to "Direct Serial" and pair the radio over Web Serial.`,
        rigName,
        portUsed: `${host}:${port}`,
        details: 'No local relay is backing this page.',
      };
    }

    const probe = await sendRigctlCommand('f', host, port);
    if (!probe.success) {
      return {
        success: false,
        message:
          `✗ Hamlib rigctld Connection Failed: ${probe.error || 'no response'}. Verify that ` +
          `'rigctld -m ${rigInfo?.id || 3073} -r ${config.serialPort} -s ${config.baudRate}' is running.`,
        rigName,
        portUsed: `${host}:${port}`,
        details: probe.error,
      };
    }

    const raw = (probe.data?.response || '').trim();
    this.logCommand('f', raw || '(empty response)', raw ? 'OK' : 'ERROR');

    // rigctld answers a bare frequency, or "RPRT <n>" on error.
    const reported = Number.parseInt(raw.split(/\s+/)[0] || '', 10);
    if (!Number.isFinite(reported) || raw.startsWith('RPRT')) {
      return {
        success: false,
        message: `✗ rigctld Responded With An Error: "${raw}". The daemon is running but could not read the VFO - check the rig model and serial settings it was started with.`,
        rigName,
        portUsed: `${host}:${port}`,
        details: raw,
      };
    }

    this.currentFreqHz = reported;
    this.isConnected = true;
    return {
      success: true,
      message: `✓ Hamlib rigctld Link Verified: ${rigName} at ${host}:${port} reported VFO ${(reported / 1e6).toFixed(6)} MHz.`,
      vfoHz: reported,
      mode: this.currentMode,
      rigName,
      portUsed: `${host}:${port}`,
      details: `Daemon reply: ${raw}`,
    };
  }

  /**
   * Keys the transmitter for `durationMs` as a wiring test, then releases it.
   *
   * This is deliberately a thin wrapper around setPtt() rather than a second implementation of
   * the nine keying methods. It used to be the latter, and four of those nine branches - CM108,
   * Raspberry Pi GPIO, TCI and WinKeyer - only wrote a line to the command log describing bytes
   * they never sent, then returned "verified". An operator wiring a DRA, a DigiPi, a SunSDR2 or
   * a WinKeyer got a green tick from hardware that was never addressed, and concluded the wiring
   * was good. Going through setPtt() means the test drives exactly what a real transmission
   * drives, gets the same watchdog and dead-man coverage, and cannot silently drift from it
   * again.
   *
   * VOX and right-channel tone keying additionally need an audio carrier to key anything at all:
   * on the production path that carrier is the frame itself, so the test supplies a tone.
   */
  public async testPttKey(
    method: PttMethodType,
    polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW' = 'ACTIVE_HIGH',
    durationMs: number = 3000,
    onStateChange?: (isKeyed: boolean, statusMsg: string) => void,
    options?: PttHardwareOptions
  ): Promise<PttTestResult> {
    if (this.pttSafetyTimer) {
      clearTimeout(this.pttSafetyTimer);
      this.pttSafetyTimer = null;
    }

    const pinDescription =
      polarity === 'ACTIVE_HIGH' ? 'Positive / +12V (Active High)' : 'Negative / Pull-to-GND (Active Low)';
    const usesAudioCarrier = method === 'VOX' || method === 'AUDIO_TONE_RIGHT';
    const toneFreq = options?.pttToneFreqHz || 1000;

    if (usesAudioCarrier) {
      // VOX keys off the audio itself; the right-channel method needs the tone its rectifier
      // watches. Neither keys anything without a carrier, so a silent test would prove nothing -
      // and a carrier that failed to start must fail the test rather than pass it quietly.
      const carrierStarted = audioEngine.startTuneTone(method === 'VOX' ? 1500 : 1250, {
        enableRightTone: method === 'AUDIO_TONE_RIGHT',
        toneFreqHz: toneFreq,
      });
      if (!carrierStarted) {
        const reason =
          'the audio carrier could not be started, and this method keys the radio with audio - ' +
          'check the output device in Station Settings';
        if (onStateChange) onStateChange(false, `✗ PTT test failed: ${reason}`);
        return {
          success: false,
          method,
          isKeyed: false,
          pinState: pinDescription,
          message: `✗ ${method} PTT test failed - ${reason}. The transmitter was not keyed.`,
        };
      }
    }

    const keyed = await this.setPtt(true, method, polarity, options);
    const keyOutcome = this.lastPttHardwareOutcome;
    const hardwareDetail = keyOutcome.hardwareDetail;

    if (!keyed) {
      if (usesAudioCarrier) audioEngine.stopTransmission();
      const reason = keyOutcome.failureNote || 'the hardware did not accept the keying command';
      if (onStateChange) onStateChange(false, `✗ PTT test failed: ${reason}`);
      return {
        success: false,
        method,
        isKeyed: false,
        pinState: pinDescription,
        hardwareDetail,
        message: `✗ ${method} PTT test failed - ${reason}. The transmitter was not keyed.`,
      };
    }

    if (onStateChange) {
      onStateChange(true, `● PTT keyed via ${hardwareDetail || method} [${pinDescription}] - releasing in ${(durationMs / 1000).toFixed(0)}s...`);
    }

    return new Promise((resolve) => {
      this.pttSafetyTimer = setTimeout(async () => {
        this.pttSafetyTimer = null;
        const released = await this.setPtt(false, method, polarity, options);
        const releaseOutcome = this.lastPttHardwareOutcome;
        if (usesAudioCarrier) audioEngine.stopTransmission();

        if (!released) {
          // Keyed but could not be released: the worst outcome of the three, and the one an
          // operator most needs told. Fall back to the all-paths emergency release.
          this.releasePttEmergency();
          const reason = releaseOutcome.failureNote || 'the release command was not accepted';
          if (onStateChange) onStateChange(false, `✗ PTT release failed: ${reason}`);
          resolve({
            success: false,
            method,
            isKeyed: false,
            pinState: pinDescription,
            hardwareDetail,
            message:
              `✗ ${method} keyed but the release failed - ${reason}. An emergency release was ` +
              'issued across every keying path; verify the radio is back in receive.',
          });
          return;
        }

        if (onStateChange) onStateChange(false, `✓ PTT released after ${(durationMs / 1000).toFixed(0)}s safety timeout`);
        resolve({
          success: true,
          method,
          isKeyed: false,
          pinState: pinDescription,
          hardwareDetail,
          message:
            `✓ ${method} PTT verified: ${hardwareDetail || 'the keying line'} was asserted and ` +
            `released after the ${(durationMs / 1000).toFixed(0)}s safety cutoff.`,
        });
      }, durationMs);
    });
  }

  /**
   * Releases PTT across every hardware path this controller might have engaged, regardless of
   * which PTT method is currently configured - a safety net for component-unmount / page-close
   * handlers where the exact active method may not be known to the caller.
   */
  public releasePttEmergency(): void {
    if (this.pttSafetyTimer) {
      clearTimeout(this.pttSafetyTimer);
      this.pttSafetyTimer = null;
    }
    const context = this.lastPttContext;
    const activeLow = context?.polarity === 'ACTIVE_LOW';
    this.disarmTxWatchdog();
    this.pttState = false;
    void this.sendRigPtt(false);
    audioEngine.stopTransmission();
    // Drop the SBC GPIO line explicitly. The server's dead-man switch would release it within
    // a couple of seconds anyway, but a couple of seconds of unintended carrier is exactly
    // what an emergency release exists to avoid.
    if (context?.method === 'RASPBERRY_PI_GPIO') {
      const pin = context.options?.rpiGpioPin || DEFAULT_RPI_BCM_PIN;
      void setGpioPin(pin, false, activeLow);
    }
    // Both serial ports: on a station keyed from a separate PTT cable, dropping only the CAT
    // port's lines leaves the transmitter keyed.
    for (const port of [this.serialPort, this.pttSerialPort]) {
      if (port && port.setSignals) {
        port.setSignals({ requestToSend: false, dataTerminalReady: false }).catch(() => {});
      }
    }
    if (this.hidDevice && this.hidDevice.opened) {
      // 3 and 4 are the two pins the common DRA/URI wiring uses; the configured pin is added
      // in case this station is on one of the others. The level written is the RELEASED one
      // for this station's polarity - writing a hardcoded low released an active-high
      // interface and keyed an active-low one.
      const cm108Pins = new Set<number>([3, 4]);
      if (context?.options?.cm108GpioPin) cm108Pins.add(context.options.cm108GpioPin);
      for (const pin of cm108Pins) {
        this.setCm108Gpio(pin, activeLow).catch(() => {});
      }
    }
    if (this.tciSocket && this.tciSocket.readyState === WebSocket.OPEN) {
      try {
        this.tciSocket.send('trx:0:tx:false;');
      } catch {
        // ignore
      }
    }
    this.logCommand('EMERGENCY_DISARM', 'PTT released immediately across all hardware paths', 'OK');
  }

  /**
   * Writes raw bytes to the open Web Serial port using a PERSISTENT writer, acquired once and
   * reused. A prior version created a fresh TextEncoderStream and piped it to serialPort.writable
   * on every single call WITHOUT `{ preventClose: true }` - which closes the underlying
   * writable stream when that pipe completes. In practice this meant only the very FIRST CAT
   * command sent in a session actually reached the radio; every command after that silently
   * no-op'd because serialPort.writable had already been closed, with no visible error.
   */
  private async sendHardwareBytes(bytes: Uint8Array): Promise<boolean> {
    if (!this.serialPort || !this.serialPort.writable) return false;
    try {
      if (!this.serialWriter) {
        this.serialWriter = this.serialPort.writable.getWriter();
      }
      await this.serialWriter!.write(bytes);
      return true;
    } catch (e) {
      console.warn('Web Serial write error:', e);
      // The writer may have become invalid (e.g. port closed externally) - drop it so the
      // next call attempts to re-acquire a fresh one instead of failing forever.
      try {
        this.serialWriter?.releaseLock();
      } catch {
        // ignore
      }
      this.serialWriter = null;
      return false;
    }
  }

  private async sendHardwareText(text: string): Promise<boolean> {
    return this.sendHardwareBytes(this.textEncoder.encode(text));
  }

  /**
   * Writes to the separately paired PTT port, for keyers that live on their own cable.
   * Returns false when that port is not paired or the write failed, so a keying caller can
   * report a real outcome rather than assuming one.
   */
  private async sendPttPortBytes(bytes: Uint8Array): Promise<boolean> {
    const port = this.pttSerialPort || this.serialPort;
    if (!port || !port.writable) return false;
    if (port === this.serialPort) return this.sendHardwareBytes(bytes);
    try {
      if (!this.pttSerialWriter) {
        this.pttSerialWriter = port.writable.getWriter();
      }
      await this.pttSerialWriter!.write(bytes);
      return true;
    } catch (e) {
      console.warn('PTT port write error:', e);
      try {
        this.pttSerialWriter?.releaseLock();
      } catch {
        // ignore
      }
      this.pttSerialWriter = null;
      return false;
    }
  }

  /**
   * Real WebHID CM108/CM119 GPIO write. Report format verified against Hamlib's actual
   * cm108.c source: a 5-byte HID output report [reportId=0x00, 0x00, gpioData, gpioDirMask,
   * 0x00], where gpioData/gpioDirMask each have bit (1 << (pin-1)) set for the chosen GPIO
   * pin (1-4). WebHID's sendReport(reportId, data) takes the report ID as a separate argument
   * from the 4 remaining bytes.
   */
  private async setCm108Gpio(pin: number, active: boolean): Promise<boolean> {
    if (!this.hidDevice || !this.hidDevice.opened) return false;
    const bit = 1 << (Math.max(1, Math.min(4, pin)) - 1);
    const reportData = new Uint8Array([0x00, active ? bit : 0x00, bit, 0x00]);
    try {
      await this.hidDevice.sendReport(0x00, reportData);
      return true;
    } catch (e) {
      console.warn('CM108 HID sendReport failed:', e);
      return false;
    }
  }

  /**
   * Pairs a real CM108/CM119-class USB Audio HID device via the WebHID API. Filters on
   * C-Media Electronics' USB vendor ID (0x0D8C), which covers the CM108/CM108AH/CM119/CM119A
   * chips used in common cheap PTT interfaces (DRA-30/50/70, URI, RB-USB RIM, etc.).
   */
  public async requestAndPairCm108Device(): Promise<{ success: boolean; message: string }> {
    if (typeof navigator === 'undefined' || !(navigator as any).hid) {
      return {
        success: false,
        message: 'WebHID API is not supported in this browser. Use a desktop Chromium-based browser (Chrome/Edge).',
      };
    }
    try {
      const devices: any[] = await (navigator as any).hid.requestDevice({ filters: [{ vendorId: 0x0d8c }] });
      if (!devices || devices.length === 0) {
        return { success: false, message: 'No CM108/CM119 HID device selected.' };
      }
      const device: WebHidDeviceLike = devices[0];
      this.hidDevice = device;
      if (!device.opened) {
        await device.open();
      }
      const name = device.productName || 'CM108/CM119 USB Audio GPIO device';
      this.logCommand('CM108_HID_PAIR', `Paired ${name}`, 'OK');
      return { success: true, message: `✓ CM108/CM119 HID device paired: ${name}` };
    } catch (e: any) {
      return { success: false, message: String(e?.message || 'Failed to pair CM108/CM119 HID device') };
    }
  }

  public isCm108Paired(): boolean {
    return !!(this.hidDevice && this.hidDevice.opened);
  }

  /**
   * Real GPIO write for a Raspberry Pi / Linux SBC, via the local z30_dsp web server's
   * /api/gpio endpoint (see web_server.py). Browser JS has no Web API that can touch Linux
   * GPIO directly - this only works when the app is being served by the native z30_dsp Python
   * backend running ON the Pi itself, not e.g. a plain static web deployment.
   */
  private async setRpiGpio(bcmPin: number, tx: boolean, polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW'): Promise<boolean> {
    // The server is told the INTENT (keyed / not keyed) plus the polarity, and derives the
    // level itself. It used to be handed the level alone, which it then recorded as the keyed
    // state: on an active-low station keying registered no dead-man countdown (so the browser
    // keepalive failed and force-unkeyed the transmitter half a second into every frame),
    // while releasing registered one - and the watchdog's "release" two seconds later drove
    // the line low, which on active-low wiring keys the transmitter with nobody watching.
    const result = await setGpioPin(bcmPin, tx, polarity === 'ACTIVE_LOW');
    if (!result.success) {
      console.warn('RPi GPIO bridge request failed:', result.error);
    }
    return result.success;
  }

  /**
   * Real WinKeyer serial PTT. WinKeyer's PTT is NOT a simple manual on/off toggle (a prior
   * version of this code sent a fabricated "0x02 0x01"/"0x02 0x00" that isn't a real WinKeyer
   * command) - it is driven by the PINCFG register (Admin command 0x09 <nn>, bit0 = PTT
   * enabled) synced to the CW key line, with lead-in/tail timing set via command 0x04
   * <lead><tail>. This sends the verified PINCFG + lead/tail setup once, then holds/releases
   * the key line via the Key Immediate command. WinKeyer is fundamentally a CW keyer - for a
   * non-CW digital mode like z-30, RTS/DTR/CM108/VOX are a more natural PTT fit; this exists
   * for operators who already have a WinKeyer in their signal chain.
   */
  private winkeyerConfigured = false;
  private async setWinkeyerPtt(tx: boolean): Promise<boolean> {
    const port = this.pttSerialPort || this.serialPort;
    if (!port || !port.writable) return false;
    if (!this.winkeyerConfigured) {
      // Admin: Host Open (0x00 0x02), then PINCFG bit0=1 (PTT enabled, follows key line),
      // then lead-in=1 (10ms units), tail=160 (10ms units, matching the app's PTT hang time).
      const opened = await this.sendPttPortBytes(new Uint8Array([0x00, 0x02, 0x09, 0x01, 0x04, 0x01, 0xa0]));
      if (!opened) return false;
      this.winkeyerConfigured = true;
    }
    // Key Immediate (0x02 <state>): 1 = key down (PTT follows, per PINCFG), 0 = key up.
    // The write result is the return value: it used to be discarded and `true` returned
    // regardless, so a keyer that had been unplugged still reported a verified key.
    return this.sendPttPortBytes(new Uint8Array([0x02, tx ? 0x01 : 0x00]));
  }

  /**
   * Real TCI (Transceiver Control Interface) WebSocket connection for Expert Electronics
   * SunSDR2/ExpertSDR/Thetis. Opens the connection once and reuses it.
   */
  private async ensureTciSocket(host: string, port: number): Promise<WebSocket | null> {
    if (this.tciSocket && this.tciSocket.readyState === WebSocket.OPEN) {
      return this.tciSocket;
    }
    if (!this.tciConnecting) {
      this.tciConnecting = new Promise<WebSocket>((resolve, reject) => {
        try {
          const ws = new WebSocket(`ws://${host}:${port}`);
          const timeout = setTimeout(() => reject(new Error('TCI WebSocket connect timed out')), 4000);
          ws.onopen = () => {
            clearTimeout(timeout);
            this.tciSocket = ws;
            resolve(ws);
          };
          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('TCI WebSocket connection failed'));
          };
          ws.onclose = () => {
            if (this.tciSocket === ws) this.tciSocket = null;
          };
        } catch (e) {
          reject(e);
        }
      });
    }
    try {
      return await this.tciConnecting;
    } catch (e) {
      console.warn('TCI WebSocket connection error:', e);
      return null;
    } finally {
      this.tciConnecting = null;
    }
  }

  private async sendTciPtt(host: string, port: number, tx: boolean): Promise<boolean> {
    const ws = await this.ensureTciSocket(host, port);
    if (!ws) return false;
    try {
      ws.send(`trx:0:tx:${tx ? 'true' : 'false'};`);
      return true;
    } catch (e) {
      console.warn('TCI WebSocket send failed:', e);
      return false;
    }
  }

  public getCommandLogs(): RigctlLogItem[] {
    return this.commandHistory;
  }

  /**
   * Executes one raw Hamlib rigctl command from the diagnostic console.
   *
   * Two things here are load-bearing and were previously wrong.
   *
   * **Case is significant.** rigctl's short verbs are case-paired: `f` reads the frequency,
   * `F` sets it; `m`/`M`, `t`/`T` likewise. This method used to lowercase the verb before
   * matching, so every uppercase branch was unreachable and `F 14076000` silently fell through
   * to the `f` getter - the console answered with the current frequency and changed nothing,
   * while the input placeholder advertised it as a setter. Only the long `\set_*` forms worked.
   *
   * **Keying needs the gate.** `T 1` / `\set_ptt 1` is a transmit path, and AGENTS.md allows
   * exactly one: `canTransmit()`. Before, it called `setPtt(tx)` bare - no callsign check, no
   * region or licence check, no band-plan check on dial + audio offset - and with the method
   * and polarity defaulted to CAT/ACTIVE_HIGH rather than the operator's configured ones, so an
   * RTS or GPIO station got CI-V bytes it was never wired for. It now refuses unless the caller
   * supplies the gate, and fails closed when none is wired.
   */
  public async executeRawCommand(input: string, txContext?: RawConsoleTransmitContext): Promise<string> {
    const raw = input.trim();
    if (!raw) return '';

    const parts = raw.split(/\s+/);
    // Short verbs match case-sensitively (f = get, F = set); the long backslash forms are
    // matched case-insensitively, the way rigctl itself accepts them.
    const verb = parts[0];
    const long = verb.toLowerCase();
    const arg = parts[1];

    let resp = '';
    let status: 'OK' | 'ERROR' = 'OK';

    if (verb === 'f' || long === '\\get_freq') {
      resp = `${this.currentFreqHz}`;
    } else if (verb === 'F' || long === '\\set_freq') {
      const val = parseInt(arg, 10);
      if (!isNaN(val) && val > 100000) {
        // RPRT 0 is rigctl's "the command succeeded", so it is reported from the hardware
        // outcome rather than from having called the setter.
        const sent = await this.setFreqHz(val);
        resp = sent ? 'RPRT 0' : `RPRT -1 (frequency not sent: ${this.catUnavailableReason()})`;
        status = sent ? 'OK' : 'ERROR';
      } else {
        resp = 'RPRT -1 (Invalid Frequency)';
        status = 'ERROR';
      }
    } else if (verb === 'm' || long === '\\get_mode') {
      resp = `${this.currentMode}\n${this.currentPassbandHz}`;
    } else if (verb === 'M' || long === '\\set_mode') {
      if (!arg) {
        resp = 'RPRT -1 (set_mode needs a mode, e.g. M PKTUSB)';
        status = 'ERROR';
      } else {
        const sent = await this.setMode(arg);
        resp = sent ? 'RPRT 0' : `RPRT -1 (mode not sent: ${this.catUnavailableReason()})`;
        status = sent ? 'OK' : 'ERROR';
      }
    } else if (verb === 't' || long === '\\get_ptt') {
      resp = this.pttState ? '1' : '0';
    } else if (verb === 'T' || long === '\\set_ptt') {
      const tx = arg === '1' || arg?.toLowerCase() === 'on';
      if (!tx) {
        // Unkeying is always allowed - refusing to stop transmitting is not a safety property.
        const released = await this.setPtt(
          false,
          txContext?.pttMethod ?? this.lastPttContext?.method ?? 'CAT',
          txContext?.pttPolarity ?? this.lastPttContext?.polarity ?? 'ACTIVE_HIGH',
          txContext?.pttOptions
        );
        // A release that the hardware refused is the one outcome an operator must not read as
        // "RPRT 0"; the emergency path is the answer to it, not a green reply.
        if (!released) this.releasePttEmergency();
        resp = released
          ? 'RPRT 0'
          : `RPRT -1 (release refused: ${this.getLastPttFailure()} - an emergency release was issued across every keying path)`;
        status = released ? 'OK' : 'ERROR';
      } else if (!txContext) {
        // Fail closed: a console with no gate wired to it does not get to key a transmitter.
        resp = 'RPRT -1 (PTT refused: no transmit gate is wired to this console)';
        status = 'ERROR';
      } else if (!txContext.assertCanTransmit(txContext.txAudioOffsetHz)) {
        resp = 'RPRT -1 (PTT refused by the transmit gate - see the blocked-transmit banner)';
        status = 'ERROR';
      } else {
        const keyed = await this.setPtt(true, txContext.pttMethod, txContext.pttPolarity, txContext.pttOptions);
        resp = keyed ? 'RPRT 0' : `RPRT -1 (PTT not keyed: ${this.getLastPttFailure()})`;
        status = keyed ? 'OK' : 'ERROR';
      }
    } else if (verb === 'v' || long === '\\get_vfo') {
      resp = 'VFOA';
    } else if (verb === 's' || long === '\\get_split_vfo') {
      resp = `${this.splitState ? 1 : 0}\n${this.txFreqHz}`;
    } else if (verb === 'l' || long === '\\get_level') {
      resp = `${Math.round(this.getSmeterDb())}`;
    } else if (long === 'dump_state' || long === '\\dump_state') {
      resp = `rig_model=3073\nmfg_name=Icom\nstatus=READY\nptt_type=CAT\nbaud=115200\nhamlib_version=${CURRENT_HAMLIB_VERSION.version}`;
    } else if (long === 'version' || long === '\\version') {
      // 'v' deliberately NOT accepted here: it is \get_vfo above, and claiming it made this
      // branch dead code.
      resp = `Hamlib ${CURRENT_HAMLIB_VERSION.version} (${CURRENT_HAMLIB_VERSION.releaseDate})`;
    } else if (long === 'help' || long === '?') {
      resp =
        'Available commands (case matters: lower = get, upper = set):\n' +
        'f / \\get_freq, F <hz> / \\set_freq <hz>, m / \\get_mode, M <mode> / \\set_mode <mode>,\n' +
        't / \\get_ptt, T <0|1> / \\set_ptt <0|1> (runs the transmit gate), v / \\get_vfo,\n' +
        's / \\get_split_vfo, l / \\get_level, dump_state, version, help';
    } else {
      // An unrecognised verb used to answer "RPRT 0" - success - which made a typo
      // indistinguishable from a command that ran.
      resp = `RPRT -1 (unknown command "${verb}" - type help)`;
      status = 'ERROR';
    }

    // NOTE: no raw hardware forward here - the individual handlers above (setFreqHz/setMode/
    // setPtt) already dispatch real protocol-appropriate bytes via sendRigFrequency/
    // sendRigMode/sendRigPtt. Forwarding the raw rigctl-syntax text itself (as a prior version
    // of this method did) would send meaningless bytes to the actual radio a second time.
    this.logCommand(raw, resp, status);
    return resp;
  }

  private logCommand(cmd: string, resp: string, status: 'OK' | 'ERROR' | 'TIMEOUT') {
    const item: RigctlLogItem = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      timestamp: new Date().toTimeString().substring(0, 8),
      direction: 'OUT',
      command: cmd,
      response: resp,
      status,
    };
    this.commandHistory = [item, ...this.commandHistory].slice(0, 50);
  }
}

export const catController = new CatController();
export const rigctl = catController;

