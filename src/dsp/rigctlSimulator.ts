/**
 * Hamlib / rigctl CAT Hardware Controller & Transceiver Interface
 */

import { HAM_BANDS } from './z30Constants';

export interface RigctlLogItem {
  id: string;
  timestamp: string;
  direction: 'IN' | 'OUT';
  command: string;
  response: string;
  status: 'OK' | 'ERROR' | 'TIMEOUT';
}

export class RigctlSimulator {
  private currentFreqHz: number = 14076000; // 20m z-30 default
  private currentMode: string = 'PKTUSB';
  private currentPassbandHz: number = 3000;
  private pttState: boolean = false;
  private splitState: boolean = false;
  private txFreqHz: number = 14076000;
  private isConnected: boolean = true;
  private commandHistory: RigctlLogItem[] = [];
  private currentBandIdx: number = 5; // 20m

  constructor() {
    this.currentFreqHz = HAM_BANDS[5].dialFreqHz;
    this.txFreqHz = HAM_BANDS[5].dialFreqHz;
  }

  public getFreqHz(): number {
    return this.currentFreqHz;
  }

  public setFreqHz(hz: number): boolean {
    this.currentFreqHz = Math.round(hz);
    // Find closest band
    const bandIdx = HAM_BANDS.findIndex(b => Math.abs(b.dialFreqHz - hz) < 500000);
    if (bandIdx !== -1) {
      this.currentBandIdx = bandIdx;
    }
    this.logCommand(`F ${hz}`, 'RPRT 0', 'OK');
    return true;
  }

  public setBandByName(bandName: string): boolean {
    const band = HAM_BANDS.find(b => b.name === bandName || b.bandMeters === bandName);
    if (band) {
      this.currentFreqHz = band.dialFreqHz;
      this.currentBandIdx = HAM_BANDS.indexOf(band);
      this.logCommand(`F ${band.dialFreqHz}`, `RPRT 0 (Switched to ${band.name})`, 'OK');
      return true;
    }
    return false;
  }

  public getCurrentBand(): typeof HAM_BANDS[0] {
    return HAM_BANDS[this.currentBandIdx] || HAM_BANDS[5];
  }

  public getPtt(): boolean {
    return this.pttState;
  }

  public setPtt(tx: boolean): boolean {
    this.pttState = tx;
    this.logCommand(`T ${tx ? '1' : '0'}`, 'RPRT 0', 'OK');
    return true;
  }

  public getSplit(): boolean {
    return this.splitState;
  }

  public setSplit(split: boolean, txFreqHz?: number) {
    this.splitState = split;
    if (txFreqHz) this.txFreqHz = txFreqHz;
    this.logCommand(`S ${split ? '1' : '0'} VFOA`, 'RPRT 0', 'OK');
  }

  public getSmeterDb(): number {
    if (this.pttState) return 0; // Transmitting
    // Noise floor + jitter
    return -115 + Math.sin(Date.now() / 800) * 12 + Math.random() * 4;
  }

  public getForwardPowerWatts(nominalWatts: number): number {
    if (!this.pttState) return 0;
    return Number((nominalWatts * (0.96 + Math.random() * 0.08)).toFixed(1));
  }

  public getSwr(): number {
    if (!this.pttState) return 1.0;
    return 1.15 + Number((Math.sin(Date.now() / 1500) * 0.08).toFixed(2));
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public toggleConnection(): boolean {
    this.isConnected = !this.isConnected;
    this.logCommand(
      this.isConnected ? 'CONNECT' : 'DISCONNECT',
      this.isConnected ? 'Hamlib rigctld connected on 127.0.0.1:4532' : 'Link closed',
      'OK'
    );
    return this.isConnected;
  }

  public getCommandLogs(): RigctlLogItem[] {
    return this.commandHistory;
  }

  /**
   * Execute raw Hamlib text command entered in console
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
      this.currentMode = (arg || 'PKTUSB').toUpperCase();
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
      resp = `rig_model=3073 (IC-7300)\nmfg_name=Icom\nstatus=READY\nptt_type=CAT\nbaud=115200`;
    } else if (cmd === 'help' || cmd === '?') {
      resp = `Available commands:\nf (get freq), F <hz> (set freq), m (get mode), M <mode> (set mode), t (get ptt), T <0|1> (set ptt), l STRENGTH, dump_state`;
    } else {
      resp = `RPRT -4 (Command not supported in simulation)`;
      status = 'ERROR';
    }

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

export const rigctl = new RigctlSimulator();
