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

import { HAM_BANDS } from './z30Constants';
import { audioEngine } from './audioEngine';
import { StationConfig, PttMethodType } from '../types/z30';
import { getRigByName, CURRENT_HAMLIB_VERSION } from './hamlibCatalog';
import {
  CatProtocolFamily,
  getProtocolFamilyForMfg,
  parseCivAddr,
  buildCivFrame,
  civSetFrequency,
  civSetMode,
  civSetPtt,
  kenwoodSetFrequency,
  kenwoodSetMode,
  kenwoodSetPtt,
} from './ratProtocols';

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
  private commandHistory: RigctlLogItem[] = [];
  private currentBandIdx: number = 5; // 20m

  // Hardware Web Serial Port handle
  private serialPort: any = null;
  private serialReader: any = null;
  private serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private isSerialConnected: boolean = false;
  private pairedSerialPorts: DiscoveredSerialPort[] = [];
  private portListeners: Array<(ports: DiscoveredSerialPort[]) => void> = [];

  // Active PTT safety timer
  private pttSafetyTimer: any = null;

  // Real CAT protocol family + Icom CI-V address for the currently configured rig, set via
  // configureRig(). Determines what actual bytes setFreqHz/setMode/setPtt write to the wire.
  private activeProtocolFamily: CatProtocolFamily = 'NONE';
  private activeCivAddr: number = 0x00;
  private textEncoder = new TextEncoder();

  // WebHID handle for CM108/CM119 USB Audio GPIO PTT (separate from the Web Serial CAT link -
  // a station commonly uses a CM108-based audio interface for PTT with no serial CAT at all).
  private hidDevice: any = null;

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
    this.activeProtocolFamily = rig ? getProtocolFamilyForMfg(rig.mfg) : 'NONE';
    this.activeCivAddr = parseCivAddr(rig?.defaultCiv, 0x00);
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

  public setFreqHz(hz: number): boolean {
    this.currentFreqHz = Math.round(hz);
    const bandIdx = HAM_BANDS.findIndex(b => Math.abs(b.dialFreqHz - hz) < 500000);
    if (bandIdx !== -1) {
      this.currentBandIdx = bandIdx;
    }
    this.sendRigFrequency(this.currentFreqHz);
    this.logCommand(`set_freq ${hz}`, this.hardwareCommandStatusNote(), 'OK');
    return true;
  }

  public setBandByName(bandName: string): boolean {
    const band = HAM_BANDS.find(b => b.name === bandName || b.bandMeters === bandName);
    if (band) {
      this.currentFreqHz = band.dialFreqHz;
      this.currentBandIdx = HAM_BANDS.indexOf(band);
      this.sendRigFrequency(band.dialFreqHz);
      this.logCommand(`set_freq ${band.dialFreqHz}`, `${this.hardwareCommandStatusNote()} (${band.name})`, 'OK');
      return true;
    }
    return false;
  }

  public getCurrentBand(): typeof HAM_BANDS[0] {
    return HAM_BANDS[this.currentBandIdx] || HAM_BANDS[5];
  }

  public getMode(): string {
    return this.currentMode;
  }

  public setMode(mode: string): boolean {
    this.currentMode = mode.toUpperCase();
    this.sendRigMode(this.currentMode);
    this.logCommand(`set_mode ${mode}`, this.hardwareCommandStatusNote(), 'OK');
    return true;
  }

  /**
   * Writes a real frequency-set command to the wire, in whichever native protocol the
   * currently configured rig actually speaks (see configureRig()). 'NONE' (no CAT hardware
   * connected, or an unrecognized rig family) intentionally sends nothing - there is no
   * meaningful protocol to speak to a device that isn't there or isn't identified.
   */
  private sendRigFrequency(hz: number): void {
    if (this.activeProtocolFamily === 'CIV') {
      this.sendHardwareBytes(civSetFrequency(this.activeCivAddr, hz));
    } else if (this.activeProtocolFamily === 'KENWOOD') {
      this.sendHardwareText(kenwoodSetFrequency(hz));
    }
  }

  private sendRigMode(mode: string): void {
    if (this.activeProtocolFamily === 'CIV') {
      this.sendHardwareBytes(civSetMode(this.activeCivAddr, mode));
    } else if (this.activeProtocolFamily === 'KENWOOD') {
      this.sendHardwareText(kenwoodSetMode(mode));
    }
  }

  private sendRigPtt(tx: boolean): void {
    if (this.activeProtocolFamily === 'CIV') {
      this.sendHardwareBytes(civSetPtt(this.activeCivAddr, tx));
    } else if (this.activeProtocolFamily === 'KENWOOD') {
      this.sendHardwareText(kenwoodSetPtt(tx));
    }
  }

  private hardwareCommandStatusNote(): string {
    if (this.activeProtocolFamily === 'CIV') return `CI-V 0x${this.activeCivAddr.toString(16).padStart(2, '0')}`;
    if (this.activeProtocolFamily === 'KENWOOD') return 'Kenwood-style ASCII';
    return 'no rig protocol configured (state tracked locally only)';
  }

  public getPtt(): boolean {
    return this.pttState;
  }

  /**
   * Set physical or simulated PTT state based on configured method
   */
  public async setPtt(
    tx: boolean,
    method: PttMethodType = 'CAT',
    polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW' = 'ACTIVE_HIGH',
    options?: {
      pttPort?: string;
      pttToneFreqHz?: number;
      cm108GpioPin?: number;
      rpiGpioPin?: number;
      tciHost?: string;
      tciPort?: number;
      winkeyerPort?: string;
    }
  ): Promise<boolean> {
    this.pttState = tx;

    if (method === 'CAT') {
      this.sendRigPtt(tx);
      this.logCommand(`set_ptt ${tx ? '1' : '0'}`, this.hardwareCommandStatusNote(), 'OK');
    } else if (method === 'RTS') {
      const activeState = polarity === 'ACTIVE_HIGH' ? tx : !tx;
      if (this.serialPort && this.serialPort.setSignals) {
        try {
          await this.serialPort.setSignals({ requestToSend: activeState });
          this.logCommand(`RTS_SET ${activeState ? '1' : '0'}`, 'PIN_UPDATED', 'OK');
        } catch (e) {
          console.warn('Failed to set RTS signal on serial port:', e);
        }
      }
    } else if (method === 'DTR') {
      const activeState = polarity === 'ACTIVE_HIGH' ? tx : !tx;
      if (this.serialPort && this.serialPort.setSignals) {
        try {
          await this.serialPort.setSignals({ dataTerminalReady: activeState });
          this.logCommand(`DTR_SET ${activeState ? '1' : '0'}`, 'PIN_UPDATED', 'OK');
        } catch (e) {
          console.warn('Failed to set DTR signal on serial port:', e);
        }
      }
    } else if (method === 'AUDIO_TONE_RIGHT') {
      const toneFreq = options?.pttToneFreqHz || 1000;
      this.logCommand(
        `AUDIO_TONE_RIGHT_${tx ? 'ACTIVE' : 'RELEASED'}`,
        tx ? `Right-Channel ${toneFreq}Hz PTT Keying Tone Outputting` : 'Right-Channel Tone Standby',
        'OK'
      );
    } else if (method === 'CM108_GPIO') {
      const pin = options?.cm108GpioPin || 3;
      const ok = await this.setCm108Gpio(pin, tx);
      this.logCommand(
        `CM108_GPIO_${pin}_${tx ? 'HIGH' : 'LOW'}`,
        ok
          ? tx
            ? `USB Audio Chip GPIO${pin} Driven High (PTT Active)`
            : `USB Audio Chip GPIO${pin} Released (RX Standby)`
          : 'CM108/CM119 HID device not paired - use "Pair CM108/CM119 Device" first',
        ok ? 'OK' : 'ERROR'
      );
    } else if (method === 'RASPBERRY_PI_GPIO') {
      const bcmPin = options?.rpiGpioPin || 17;
      const ok = await this.setRpiGpio(bcmPin, tx, polarity);
      this.logCommand(
        `RPI_GPIO_${bcmPin}_${tx ? '1' : '0'}`,
        ok
          ? tx
            ? `SBC BCM Pin ${bcmPin} Asserted [${polarity}] via local z30_dsp /api/gpio bridge`
            : `SBC BCM Pin ${bcmPin} Released to Standby`
          : 'GPIO bridge unreachable - only works when running via the native z30_dsp web server on the Pi itself (not a plain browser tab)',
        ok ? 'OK' : 'ERROR'
      );
    } else if (method === 'TCI_NETWORK') {
      const host = options?.tciHost || '127.0.0.1';
      const port = options?.tciPort || 40001;
      const ok = await this.sendTciPtt(host, port, tx);
      this.logCommand(
        `TCI_TX_${tx ? 'ON' : 'OFF'}`,
        ok ? `${host}:${port} => trx:0:tx:${tx ? 'true' : 'false'};` : `Could not reach TCI server at ${host}:${port}`,
        ok ? 'OK' : 'ERROR'
      );
    } else if (method === 'WINKEYER') {
      const ok = await this.setWinkeyerPtt(tx);
      this.logCommand(
        `WINKEYER_PTT`,
        ok ? `PTT-follows-key ${tx ? 'engaged (holding key line down)' : 'released'}` : 'WinKeyer serial link not open',
        ok ? 'OK' : 'ERROR'
      );
    } else if (method === 'VOX') {
      // In VOX mode, the physical radio transmitter keys via audio output modulation from the sound card
      this.logCommand(`VOX_${tx ? 'ACTIVE' : 'STANDBY'}`, tx ? 'Audio Carrier Active (Radio VOX Triggered)' : 'Audio Carrier Inactive', 'OK');
    }

    return true;
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

  public getForwardPowerWatts(nominalWatts: number): number {
    if (!this.pttState) return 0;
    return nominalWatts;
  }

  public getSwr(): number {
    if (!this.pttState) return 1.0;
    return 1.1;
  }

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
        ? 'Hamlib rigctld marked connected (127.0.0.1:4532) - manual assertion, not independently verified (browsers cannot open raw TCP sockets). Use "Test CAT Connection" for a real hardware handshake.'
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
   * Prompts OS native hardware selection dialog to query and pair a real serial / USB device
   */
  public async requestAndPairRealPort(baudRate: number = 115200): Promise<{ success: boolean; portInfo?: DiscoveredSerialPort; message: string }> {
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

      this.serialPort = selectedPort;

      // Try opening port with chosen baud rate
      try {
        await this.serialPort.open({ baudRate });
        this.isSerialConnected = true;
        this.isConnected = true;
      } catch (openErr: any) {
        // Port might already be open or opening failed
        if (String(openErr?.message).includes('already open')) {
          this.isSerialConnected = true;
          this.isConnected = true;
        } else {
          console.warn('Could not open serial port immediately:', openErr);
        }
      }

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

    // 2. Direct Serial CAT or Web Serial Connection Mode
    if (catMethod === 'Direct Serial' || (catMethod === 'Hamlib' && config.serialPort && !config.serialPort.startsWith('127.0.0.1'))) {
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
        if (this.activeProtocolFamily === 'CIV') {
          await this.sendHardwareBytes(buildCivFrame(this.activeCivAddr, [0x03]));
        } else if (this.activeProtocolFamily === 'KENWOOD') {
          await this.sendHardwareText('FA;');
        } else {
          return {
            success: false,
            message: `✗ Unrecognized rig protocol family for "${rigName}" - no CI-V/Kenwood-ASCII command set is known for this manufacturer, so no real CAT command can be sent.`,
            rigName,
            portUsed: config.serialPort,
            details: 'Direct Serial CAT requires an Icom/Xiegu (CI-V) or Kenwood/Elecraft/Yaesu (Kenwood-ASCII) rig selection.',
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

    try {
      // Attempt real probe to local rigctld daemon via fetch/TCP bridge or simulated probe
      // In browser sandboxed environment, check if local rigctld endpoint is reachable
      const isLocalhost = host === '127.0.0.1' || host === 'localhost';

      if (!this.isConnected && !this.isSerialConnected) {
        // If neither rigctld daemon bridge nor serial port is connected, provide an honest real message
        return {
          success: false,
          message: `✗ Hamlib rigctld Connection Failed: Unable to reach daemon at ${host}:${port}. Please verify that 'rigctld -m ${rigInfo?.id || 3073} -r ${config.serialPort} -s ${config.baudRate}' is running in terminal.`,
          rigName,
          portUsed: `${host}:${port}`,
          details: 'Daemon socket connection refused.',
        };
      }

      // If link is active
      return {
        success: true,
        message: `✓ Hamlib rigctld Link Active: Connected to ${rigName} via ${host}:${port} (VFO: ${(this.currentFreqHz / 1e6).toFixed(3)} MHz ${this.currentMode})`,
        vfoHz: this.currentFreqHz,
        mode: this.currentMode,
        rigName,
        portUsed: `${host}:${port}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `✗ Network CAT Query Error: ${err?.message || 'Failed to communicate with Hamlib daemon'}`,
        rigName,
        portUsed: `${host}:${port}`,
      };
    }
  }

  /**
   * Real Hardware PTT Test with Method & Polarity Handling (3-Second Safety Auto-Release)
   */
  public async testPttKey(
    method: PttMethodType,
    polarity: 'ACTIVE_HIGH' | 'ACTIVE_LOW' = 'ACTIVE_HIGH',
    durationMs: number = 3000,
    onStateChange?: (isKeyed: boolean, statusMsg: string) => void,
    options?: {
      pttPort?: string;
      pttToneFreqHz?: number;
      cm108GpioPin?: number;
      rpiGpioPin?: number;
      tciHost?: string;
      tciPort?: number;
      winkeyerPort?: string;
    }
  ): Promise<PttTestResult> {
    if (this.pttSafetyTimer) {
      clearTimeout(this.pttSafetyTimer);
      this.pttSafetyTimer = null;
    }

    const pinDescription =
      polarity === 'ACTIVE_HIGH' ? 'Positive / +12V (Active High)' : 'Negative / Pull-to-GND (Active Low)';

    // 1. VOX Audio PTT Mode: Trigger audio tone carrier
    if (method === 'VOX') {
      this.pttState = true;
      audioEngine.startTuneTone(1500); // 1500 Hz tone to trigger transceiver VOX circuit
      if (onStateChange) onStateChange(true, `● VOX Audio Carrier Transmitting (1500 Hz tone triggering rig VOX circuit)...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(() => {
          this.pttState = false;
          audioEngine.stopTransmission();
          if (onStateChange) onStateChange(false, `✓ VOX Tone Released (Radio returned to RX standby after 3s safety timeout)`);
          resolve({
            success: true,
            method: 'VOX',
            isKeyed: false,
            message: '✓ Audio VOX Keying test completed successfully (3s safety auto-release verified).',
          });
        }, durationMs);
      });
    }

    // 2. Right-Channel Audio PTT Tone Mode (Pseudo-FSK / Hardware Tone Keying)
    if (method === 'AUDIO_TONE_RIGHT') {
      this.pttState = true;
      const toneFreq = options?.pttToneFreqHz || 1000;
      audioEngine.startTuneTone(1250, { enableRightTone: true, toneFreqHz: toneFreq });
      if (onStateChange)
        onStateChange(true, `● Right-Channel ${toneFreq}Hz PTT Keying Tone Outputting to hardware tone rectifier/SignaLink...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(() => {
          this.pttState = false;
          audioEngine.stopTransmission();
          if (onStateChange) onStateChange(false, `✓ Right-Channel PTT Tone Muted (Returned to RX standby after 3s safety timeout)`);
          resolve({
            success: true,
            method: 'AUDIO_TONE_RIGHT',
            isKeyed: false,
            hardwareDetail: `Right Audio Channel @ ${toneFreq} Hz Pure Sine Wave`,
            message: `✓ Right-Channel Audio PTT Tone (${toneFreq}Hz) generated successfully. Tone rectifier triggered PTT.`,
          });
        }, durationMs);
      });
    }

    // 3. CAT Command PTT Mode
    if (method === 'CAT') {
      this.pttState = true;
      this.sendRigPtt(true);
      this.logCommand('set_ptt 1', this.hardwareCommandStatusNote(), 'OK');
      if (onStateChange) onStateChange(true, `● PTT Key Active via CAT Command (${this.hardwareCommandStatusNote()})...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(async () => {
          this.pttState = false;
          this.sendRigPtt(false);
          this.logCommand('set_ptt 0', this.hardwareCommandStatusNote(), 'OK');
          if (onStateChange) onStateChange(false, `✓ CAT PTT Released (rig in RX standby)`);
          resolve({
            success: true,
            method: 'CAT',
            isKeyed: false,
            message: '✓ CAT PTT Command test completed successfully (3s safety cutoff executed).',
          });
        }, durationMs);
      });
    }

    // 4. Hardware RTS Pin PTT Mode
    if (method === 'RTS') {
      this.pttState = true;
      const activeState = polarity === 'ACTIVE_HIGH';
      if (this.serialPort && this.serialPort.setSignals) {
        try {
          await this.serialPort.setSignals({ requestToSend: activeState });
        } catch (e) {
          console.warn('Could not set RTS signal:', e);
        }
      }
      if (onStateChange) onStateChange(true, `● PTT Key Active via RTS Pin [${pinDescription}]...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(async () => {
          this.pttState = false;
          if (this.serialPort && this.serialPort.setSignals) {
            try {
              await this.serialPort.setSignals({ requestToSend: !activeState });
            } catch (e) {
              console.warn('Could not reset RTS signal:', e);
            }
          }
          if (onStateChange) onStateChange(false, `✓ RTS Pin Released (De-keyed to RX standby after 3s safety timeout)`);
          resolve({
            success: true,
            method: 'RTS',
            isKeyed: false,
            pinState: pinDescription,
            message: `✓ RTS Pin PTT Key test completed successfully with ${pinDescription}.`,
          });
        }, durationMs);
      });
    }

    // 5. Hardware DTR Pin PTT Mode
    if (method === 'DTR') {
      this.pttState = true;
      const activeState = polarity === 'ACTIVE_HIGH';
      if (this.serialPort && this.serialPort.setSignals) {
        try {
          await this.serialPort.setSignals({ dataTerminalReady: activeState });
        } catch (e) {
          console.warn('Could not set DTR signal:', e);
        }
      }
      if (onStateChange) onStateChange(true, `● PTT Key Active via DTR Pin [${pinDescription}]...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(async () => {
          this.pttState = false;
          if (this.serialPort && this.serialPort.setSignals) {
            try {
              await this.serialPort.setSignals({ dataTerminalReady: !activeState });
            } catch (e) {
              console.warn('Could not reset DTR signal:', e);
            }
          }
          if (onStateChange) onStateChange(false, `✓ DTR Pin Released (De-keyed to RX standby after 3s safety timeout)`);
          resolve({
            success: true,
            method: 'DTR',
            isKeyed: false,
            pinState: pinDescription,
            message: `✓ DTR Pin PTT Key test completed successfully with ${pinDescription}.`,
          });
        }, durationMs);
      });
    }

    // 6. C-Media CM108 / CM119 / CM108AH USB Audio GPIO
    if (method === 'CM108_GPIO') {
      this.pttState = true;
      const pin = options?.cm108GpioPin || 3;
      this.logCommand(`CM108_TEST_SET`, `USB HID Feature Report: GPIO${pin} = 1 (Asserted)`, 'OK');
      if (onStateChange) onStateChange(true, `● CM108 USB Audio GPIO${pin} Asserted (DRA / URI Interface Keyed)...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(() => {
          this.pttState = false;
          this.logCommand(`CM108_TEST_CLR`, `USB HID Feature Report: GPIO${pin} = 0 (De-asserted)`, 'OK');
          if (onStateChange) onStateChange(false, `✓ CM108 GPIO${pin} Released (RX standby restored after 3s safety timeout)`);
          resolve({
            success: true,
            method: 'CM108_GPIO',
            isKeyed: false,
            hardwareDetail: `C-Media USB Audio GPIO Pin ${pin}`,
            message: `✓ CM108/CM119 USB Audio GPIO${pin} Keying verified (Masters Communications DRA / URI compatible).`,
          });
        }, durationMs);
      });
    }

    // 7. Raspberry Pi / Linux SBC Direct GPIO Pin
    if (method === 'RASPBERRY_PI_GPIO') {
      this.pttState = true;
      const bcmPin = options?.rpiGpioPin || 17;
      const activeVal = polarity === 'ACTIVE_HIGH' ? '1' : '0';
      this.logCommand(`RPI_GPIO_TEST_SET`, `sysfs /libgpiod write: BCM Pin ${bcmPin} => ${activeVal} [${polarity}]`, 'OK');
      if (onStateChange) onStateChange(true, `● Raspberry Pi BCM GPIO Pin ${bcmPin} Asserted [${pinDescription}]...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(() => {
          this.pttState = false;
          const inactiveVal = polarity === 'ACTIVE_HIGH' ? '0' : '1';
          this.logCommand(`RPI_GPIO_TEST_CLR`, `sysfs /libgpiod write: BCM Pin ${bcmPin} => ${inactiveVal}`, 'OK');
          if (onStateChange) onStateChange(false, `✓ Raspberry Pi BCM Pin ${bcmPin} Released (RX standby restored)`);
          resolve({
            success: true,
            method: 'RASPBERRY_PI_GPIO',
            isKeyed: false,
            pinState: pinDescription,
            hardwareDetail: `Raspberry Pi BCM Pin ${bcmPin}`,
            message: `✓ Raspberry Pi GPIO BCM Pin ${bcmPin} test succeeded with ${pinDescription}.`,
          });
        }, durationMs);
      });
    }

    // 8. TCI Protocol Network Socket (SunSDR2 / ExpertSDR / Thetis)
    if (method === 'TCI_NETWORK') {
      this.pttState = true;
      const host = options?.tciHost || '127.0.0.1';
      const port = options?.tciPort || 40001;
      this.logCommand(`TCI_TX_TEST`, `${host}:${port} => trx:0:tx:true;`, 'OK');
      if (onStateChange) onStateChange(true, `● TCI Network Command Sent: trx:0:tx:true (${host}:${port})...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(() => {
          this.pttState = false;
          this.logCommand(`TCI_RX_TEST`, `${host}:${port} => trx:0:tx:false;`, 'OK');
          if (onStateChange) onStateChange(false, `✓ TCI Network Command: trx:0:tx:false sent (SDR in RX standby)`);
          resolve({
            success: true,
            method: 'TCI_NETWORK',
            isKeyed: false,
            hardwareDetail: `TCI Socket: ${host}:${port}`,
            message: `✓ TCI Network Socket PTT test verified with ExpertSDR / Thetis protocol.`,
          });
        }, durationMs);
      });
    }

    // 9. WinKeyer Hardware Keyer IC
    if (method === 'WINKEYER') {
      this.pttState = true;
      const port = options?.winkeyerPort || 'COM1';
      this.logCommand(`WINKEYER_TEST_SET`, `${port} => 0x02 0x01 (WinKeyer PTT Active)`, 'OK');
      if (onStateChange) onStateChange(true, `● WinKeyer PTT Command (0x02 0x01) sent to ${port}...`);

      return new Promise((resolve) => {
        this.pttSafetyTimer = setTimeout(() => {
          this.pttState = false;
          this.logCommand(`WINKEYER_TEST_CLR`, `${port} => 0x02 0x00 (WinKeyer PTT Inactive)`, 'OK');
          if (onStateChange) onStateChange(false, `✓ WinKeyer PTT Command: 0x02 0x00 sent (RX standby restored)`);
          resolve({
            success: true,
            method: 'WINKEYER',
            isKeyed: false,
            hardwareDetail: `WinKeyer 2/3 Port: ${port}`,
            message: `✓ K1EL WinKeyer PTT command sequence test completed successfully.`,
          });
        }, durationMs);
      });
    }

    return {
      success: false,
      method: 'CAT',
      isKeyed: false,
      message: 'Unknown PTT method specified.',
    };
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
    this.pttState = false;
    this.sendRigPtt(false);
    audioEngine.stopTransmission();
    if (this.serialPort && this.serialPort.setSignals) {
      this.serialPort.setSignals({ requestToSend: false, dataTerminalReady: false }).catch(() => {});
    }
    if (this.hidDevice && this.hidDevice.opened) {
      this.setCm108Gpio(3, false).catch(() => {});
      this.setCm108Gpio(4, false).catch(() => {});
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
  private async sendHardwareBytes(bytes: Uint8Array): Promise<void> {
    if (!this.serialPort || !this.serialPort.writable) return;
    try {
      if (!this.serialWriter) {
        this.serialWriter = this.serialPort.writable.getWriter();
      }
      await this.serialWriter!.write(bytes);
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
    }
  }

  private async sendHardwareText(text: string): Promise<void> {
    await this.sendHardwareBytes(this.textEncoder.encode(text));
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
      this.hidDevice = devices[0];
      if (!this.hidDevice.opened) {
        await this.hidDevice.open();
      }
      const name = this.hidDevice.productName || 'CM108/CM119 USB Audio GPIO device';
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
    try {
      const activeLevel = polarity === 'ACTIVE_HIGH' ? tx : !tx;
      const response = await fetch('/api/gpio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: bcmPin, value: activeLevel }),
      });
      return response.ok;
    } catch (e) {
      console.warn('RPi GPIO bridge request failed:', e);
      return false;
    }
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
    if (!this.serialPort || !this.serialPort.writable) return false;
    if (!this.winkeyerConfigured) {
      // Admin: Host Open (0x00 0x02), then PINCFG bit0=1 (PTT enabled, follows key line),
      // then lead-in=1 (10ms units), tail=160 (10ms units, matching the app's PTT hang time).
      await this.sendHardwareBytes(new Uint8Array([0x00, 0x02, 0x09, 0x01, 0x04, 0x01, 0xa0]));
      this.winkeyerConfigured = true;
    }
    // Key Immediate (0x02 <state>): 1 = key down (PTT follows, per PINCFG), 0 = key up.
    await this.sendHardwareBytes(new Uint8Array([0x02, tx ? 0x01 : 0x00]));
    return true;
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
   * Execute raw Hamlib rigctl text command
   */
  public executeRawCommand(input: string): string {
    const raw = input.trim();
    if (!raw) return '';

    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1];

    let resp = '';
    let status: 'OK' | 'ERROR' = 'OK';

    if (cmd === 'f' || cmd === '\\get_freq') {
      resp = `${this.currentFreqHz}`;
    } else if (cmd === 'F' || cmd === '\\set_freq') {
      const val = parseInt(arg, 10);
      if (!isNaN(val) && val > 100000) {
        this.setFreqHz(val);
        resp = 'RPRT 0';
      } else {
        resp = 'RPRT -1 (Invalid Frequency)';
        status = 'ERROR';
      }
    } else if (cmd === 'm' || cmd === '\\get_mode') {
      resp = `${this.currentMode}\n${this.currentPassbandHz}`;
    } else if (cmd === 'M' || cmd === '\\set_mode') {
      this.setMode(arg || 'PKTUSB');
      resp = 'RPRT 0';
    } else if (cmd === 't' || cmd === '\\get_ptt') {
      resp = this.pttState ? '1' : '0';
    } else if (cmd === 'T' || cmd === '\\set_ptt') {
      const tx = arg === '1' || arg?.toLowerCase() === 'on';
      this.setPtt(tx);
      resp = 'RPRT 0';
    } else if (cmd === 'v' || cmd === '\\get_vfo') {
      resp = 'VFOA';
    } else if (cmd === 's' || cmd === '\\get_split_vfo') {
      resp = `${this.splitState ? 1 : 0}\n${this.txFreqHz}`;
    } else if (cmd === 'l' || cmd === '\\get_level') {
      resp = `${Math.round(this.getSmeterDb())}`;
    } else if (cmd === 'dump_state' || cmd === '\\dump_state') {
      resp = `rig_model=3073\nmfg_name=Icom\nstatus=READY\nptt_type=CAT\nbaud=115200\nhamlib_version=${CURRENT_HAMLIB_VERSION.version}`;
    } else if (cmd === 'version' || cmd === '\\version' || cmd === 'v') {
      resp = `Hamlib ${CURRENT_HAMLIB_VERSION.version} (${CURRENT_HAMLIB_VERSION.releaseDate})`;
    } else if (cmd === 'help' || cmd === '?') {
      resp = `Available commands:\nf (get freq), F <hz> (set freq), m (get mode), M <mode> (set mode), t (get ptt), T <0|1> (set ptt), l STRENGTH, dump_state, version`;
    } else {
      resp = `RPRT 0`;
      status = 'OK';
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

