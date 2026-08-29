/**
 * z-30 Asynchronous Amateur Radio QSO Logging Engine
 * =================================================
 * Features:
 * - Non-blocking asynchronous logging queue
 * - ADIF 3.1.4 Standard Specification compliant generation and parsing
 * - RFC 4180 compliant CSV export
 * - SQLite SQL schema generation & data dump
 * - Persistent browser localStorage caching
 * - Subscription event listeners for real-time UI synchronization
 */

import { LogEntry, AutoLogConfig } from '../types/z30';

const STORAGE_KEY = 'z30_qso_logbook_v1';
const CONFIG_STORAGE_KEY = 'z30_autolog_config_v1';

export const DEFAULT_AUTOLOG_CONFIG: AutoLogConfig = {
  enabled: true,
  triggerMode: 'AUTO_73',
  autoExportAdif: false,
  saveToLocalStorage: true,
  includeSicPassNotes: true,
};

type LogListener = (entry: LogEntry, allEntries: LogEntry[]) => void;

export class Z30QsoLogger {
  private entries: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private config: AutoLogConfig = { ...DEFAULT_AUTOLOG_CONFIG };
  private queue: LogEntry[] = [];
  private isProcessingQueue: boolean = false;

  constructor() {
    this.loadFromStorage();
  }

  public getConfig(): AutoLogConfig {
    return { ...this.config };
  }

  public setConfig(newConfig: Partial<AutoLogConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.config));
      } catch (e) {
        console.warn('Failed to save auto-log config to localStorage:', e);
      }
    }
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Asynchronously enqueue a newly completed QSO record.
   * Dispatches asynchronously via Promise / microtask to ensure zero audio glitch or UI stutter.
   */
  public logQsoAsync(entry: Omit<LogEntry, 'id'> & { id?: string }): Promise<LogEntry> {
    return new Promise((resolve) => {
      const fullEntry: LogEntry = {
        ...entry,
        id: entry.id || `qso-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        mode: entry.mode || 'z-30',
        submode: entry.submode || '16-MFSK',
      };

      this.queue.push(fullEntry);
      this.processQueue();
      resolve(fullEntry);
    });
  }

  private async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    this.isProcessingQueue = true;

    // Use asynchronous microtask to process without blocking
    await new Promise((r) => setTimeout(r, 0));

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;

      // Deduplicate by callsign + date + band within 1 minute
      const isDuplicate = this.entries.some(
        (e) =>
          e.callsign.toUpperCase() === entry.callsign.toUpperCase() &&
          e.band === entry.band &&
          e.utcDate === entry.utcDate &&
          Math.abs(this.timeToSeconds(e.utcTime) - this.timeToSeconds(entry.utcTime)) < 60
      );

      if (!isDuplicate) {
        this.entries.unshift(entry);
        this.saveToStorage();
        this.notifyListeners(entry);
      }
    }

    this.isProcessingQueue = false;
  }

  public addManualEntry(entry: LogEntry) {
    this.entries.unshift(entry);
    this.saveToStorage();
    this.notifyListeners(entry);
  }

  public updateEntry(id: string, updated: Partial<LogEntry>) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.entries[idx] = { ...this.entries[idx], ...updated };
      this.saveToStorage();
      this.notifyListeners(this.entries[idx]);
    }
  }

  public deleteEntry(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.saveToStorage();
  }

  public clearAll() {
    this.entries = [];
    this.saveToStorage();
  }

  private notifyListeners(entry: LogEntry) {
    this.listeners.forEach((fn) => {
      try {
        fn(entry, [...this.entries]);
      } catch (err) {
        console.error('Error in QSO Log listener:', err);
      }
    });
  }

  private timeToSeconds(timeStr: string): number {
    const clean = timeStr.replace(/[^0-9]/g, '');
    if (clean.length >= 6) {
      const h = parseInt(clean.substring(0, 2), 10) || 0;
      const m = parseInt(clean.substring(2, 4), 10) || 0;
      const s = parseInt(clean.substring(4, 6), 10) || 0;
      return h * 3600 + m * 60 + s;
    }
    return 0;
  }

  private saveToStorage() {
    if (!this.config.saveToLocalStorage) return;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
      } catch (e) {
        console.warn('Failed to save QSO logbook to localStorage:', e);
      }
    }
  }

  private loadFromStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const savedLog = localStorage.getItem(STORAGE_KEY);
        if (savedLog) {
          this.entries = JSON.parse(savedLog);
        }
        const savedCfg = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (savedCfg) {
          this.config = { ...this.config, ...JSON.parse(savedCfg) };
        }
      } catch (e) {
        console.warn('Failed to load QSO logbook from localStorage:', e);
      }
    }
  }

  /**
   * Generates ADIF 3.1.4 standard compliant text string.
   * 
   * @param entriesToExport - Optional array of entries to serialize (defaults to all logbook entries)
   * @returns Formatted ADIF text payload with header and EOR delimiters
   */
  public exportToAdif(entriesToExport?: LogEntry[]): string {
    const data = entriesToExport || this.entries;
    const now = new Date().toISOString().replace(/[-:T]/g, '').substring(0, 14);

    let adif = `ADIF Export from z-30 DSP Transceiver Suite
Generated on: ${new Date().toUTCString()}
<ADIF_VER:5>3.1.4
<PROGRAMID:4>z-30
<PROGRAMVERSION:5>1.0.0
<CREATED_TIMESTAMP:14>${now}
<EOH>

`;

    for (const e of data) {
      const cleanDate = e.utcDate.replace(/[^0-9]/g, ''); // YYYYMMDD
      const cleanTime = e.utcTime.replace(/[^0-9]/g, '').padEnd(6, '0').substring(0, 6); // HHMMSS
      const call = e.callsign.toUpperCase();
      const grid = (e.grid || '').toUpperCase();
      const band = (e.band || '20m').toUpperCase();
      const freq = e.freqMhz ? e.freqMhz.toFixed(6) : '14.074000';
      const rstSent = e.rstSent || '-15';
      const rstRcvd = e.rstRcvd || '-15';
      const mode = 'z-30';
      const submode = '16-MFSK';
      const myCall = (e.myCall || 'W1AW').toUpperCase();
      const myGrid = (e.myGrid || 'FN31').toUpperCase();
      const comment = e.notes || `z-30 16-MFSK LDPC / SIC Pass ${e.sicPass || 1}`;

      adif += `<CALL:${call.length}>${call} `;
      adif += `<QSO_DATE:${cleanDate.length}>${cleanDate} `;
      adif += `<TIME_ON:${cleanTime.length}>${cleanTime} `;
      adif += `<TIME_OFF:${cleanTime.length}>${cleanTime} `;
      adif += `<BAND:${band.length}>${band} `;
      adif += `<FREQ:${freq.length}>${freq} `;
      adif += `<MODE:${mode.length}>${mode} `;
      adif += `<SUBMODE:${submode.length}>${submode} `;
      adif += `<RST_SENT:${rstSent.length}>${rstSent} `;
      adif += `<RST_RCVD:${rstRcvd.length}>${rstRcvd} `;
      if (grid) adif += `<GRIDSQUARE:${grid.length}>${grid} `;
      if (myCall) adif += `<OPERATOR:${myCall.length}>${myCall} <STATION_CALLSIGN:${myCall.length}>${myCall} `;
      if (myGrid) adif += `<MY_GRIDSQUARE:${myGrid.length}>${myGrid} `;
      if (e.distanceKm) adif += `<DISTANCE:${e.distanceKm.toString().length}>${e.distanceKm} `;
      if (e.azimuthDeg !== undefined) adif += `<ANT_AZ:${e.azimuthDeg.toString().length}>${e.azimuthDeg} `;
      if (e.txPowerWatts) adif += `<TX_PWR:${e.txPowerWatts.toString().length}>${e.txPowerWatts} `;
      adif += `<COMMENT:${comment.length}>${comment} `;
      adif += `<EOR>\n`;
    }

    return adif;
  }

  /**
   * Generates standard RFC 4180 CSV string.
   * 
   * @param entriesToExport - Optional array of entries to serialize
   * @returns Formatted comma-separated values text with escaped quotes
   */
  public exportToCsv(entriesToExport?: LogEntry[]): string {
    const data = entriesToExport || this.entries;
    const headers = [
      'Date',
      'TimeUTC',
      'Callsign',
      'Grid',
      'Band',
      'FreqMHz',
      'AudioFreqHz',
      'RstSent',
      'RstRcvd',
      'DistanceKm',
      'AzimuthDeg',
      'TxWatts',
      'MyCall',
      'MyGrid',
      'SicPass',
      'LdpcIters',
      'Notes',
    ];

    const rows = data.map((e) => [
      `"${e.utcDate}"`,
      `"${e.utcTime}"`,
      `"${e.callsign}"`,
      `"${e.grid || ''}"`,
      `"${e.band}"`,
      e.freqMhz ? e.freqMhz.toFixed(6) : '',
      e.audioFreqHz || '',
      `"${e.rstSent}"`,
      `"${e.rstRcvd}"`,
      e.distanceKm || '',
      e.azimuthDeg !== undefined ? e.azimuthDeg : '',
      e.txPowerWatts || '',
      `"${e.myCall || ''}"`,
      `"${e.myGrid || ''}"`,
      e.sicPass || 1,
      e.ldpcIterations || 0,
      `"${(e.notes || '').replace(/"/g, '""')}"`,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Generates SQLite SQL Table schema & INSERT statements.
   * 
   * @param entriesToExport - Optional array of entries to export
   * @returns SQL script creating table and indexes and inserting records inside a single transaction
   */
  public exportToSqliteDump(entriesToExport?: LogEntry[]): string {
    const data = entriesToExport || this.entries;
    let sql = `-- z-30 Amateur Radio Electronic Logbook SQL Schema & Data Dump
-- Generated: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS qso_records (
    id TEXT PRIMARY KEY,
    utc_date TEXT NOT NULL,
    utc_time TEXT NOT NULL,
    callsign TEXT NOT NULL,
    grid TEXT,
    mode TEXT DEFAULT 'z-30',
    submode TEXT DEFAULT '16-MFSK',
    band TEXT NOT NULL,
    freq_mhz REAL NOT NULL,
    audio_freq_hz INTEGER,
    rst_sent TEXT,
    rst_rcvd TEXT,
    distance_km INTEGER,
    azimuth_deg INTEGER,
    tx_power_watts INTEGER,
    my_call TEXT,
    my_grid TEXT,
    sic_pass INTEGER DEFAULT 1,
    ldpc_iterations INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qso_call ON qso_records(callsign);
CREATE INDEX IF NOT EXISTS idx_qso_date ON qso_records(utc_date);
CREATE INDEX IF NOT EXISTS idx_qso_band ON qso_records(band);

BEGIN TRANSACTION;
`;

    for (const e of data) {
      const id = e.id.replace(/'/g, "''");
      const date = e.utcDate.replace(/'/g, "''");
      const time = e.utcTime.replace(/'/g, "''");
      const call = e.callsign.toUpperCase().replace(/'/g, "''");
      const grid = (e.grid || '').replace(/'/g, "''");
      const band = e.band.replace(/'/g, "''");
      const freq = e.freqMhz || 14.074;
      const audioFreq = e.audioFreqHz || 1250;
      const rstS = (e.rstSent || '').replace(/'/g, "''");
      const rstR = (e.rstRcvd || '').replace(/'/g, "''");
      const dist = e.distanceKm || 0;
      const az = e.azimuthDeg || 0;
      const pwr = e.txPowerWatts || 50;
      const myCall = (e.myCall || 'W1AW').replace(/'/g, "''");
      const myGrid = (e.myGrid || 'FN31').replace(/'/g, "''");
      const sic = e.sicPass || 1;
      const iters = e.ldpcIterations || 0;
      const notes = (e.notes || '').replace(/'/g, "''");

      sql += `INSERT OR REPLACE INTO qso_records (id, utc_date, utc_time, callsign, grid, mode, submode, band, freq_mhz, audio_freq_hz, rst_sent, rst_rcvd, distance_km, azimuth_deg, tx_power_watts, my_call, my_grid, sic_pass, ldpc_iterations, notes) VALUES ('${id}', '${date}', '${time}', '${call}', '${grid}', 'z-30', '16-MFSK', '${band}', ${freq}, ${audioFreq}, '${rstS}', '${rstR}', ${dist}, ${az}, ${pwr}, '${myCall}', '${myGrid}', ${sic}, ${iters}, '${notes}');\n`;
    }

    sql += `COMMIT;\n`;
    return sql;
  }

  /**
   * Imports QSOs from standard ADIF text string.
   */
  public importFromAdif(adifText: string): number {
    const headerEndIdx = adifText.toUpperCase().indexOf('<EOH>');
    const body = headerEndIdx !== -1 ? adifText.substring(headerEndIdx + 5) : adifText;
    const records = body.split(/<EOR>/i);
    let importedCount = 0;

    for (const rec of records) {
      if (!rec.trim()) continue;
      const callMatch = rec.match(/<CALL:\d+>([^<\s]+)/i);
      if (!callMatch) continue;

      const dateMatch = rec.match(/<QSO_DATE:\d+>([^<\s]+)/i);
      const timeMatch = rec.match(/<TIME_ON:\d+>([^<\s]+)/i);
      const bandMatch = rec.match(/<BAND:\d+>([^<\s]+)/i);
      const freqMatch = rec.match(/<FREQ:\d+>([^<\s]+)/i);
      const rstSentMatch = rec.match(/<RST_SENT:\d+>([^<\s]+)/i);
      const rstRcvdMatch = rec.match(/<RST_RCVD:\d+>([^<\s]+)/i);
      const gridMatch = rec.match(/<GRIDSQUARE:\d+>([^<\s]+)/i);
      const commentMatch = rec.match(/<COMMENT:\d+>([^<]+)/i);

      let dateStr = new Date().toISOString().substring(0, 10);
      if (dateMatch && dateMatch[1].length === 8) {
        dateStr = `${dateMatch[1].substring(0, 4)}-${dateMatch[1].substring(4, 6)}-${dateMatch[1].substring(6, 8)}`;
      }

      let timeStr = '00:00:00';
      if (timeMatch && timeMatch[1].length >= 4) {
        const t = timeMatch[1].padEnd(6, '0');
        timeStr = `${t.substring(0, 2)}:${t.substring(2, 4)}:${t.substring(4, 6)}`;
      }

      const newEntry: LogEntry = {
        id: `import-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        utcDate: dateStr,
        utcTime: timeStr,
        callsign: callMatch[1].toUpperCase(),
        grid: gridMatch ? gridMatch[1].toUpperCase() : '',
        mode: 'z-30',
        submode: '16-MFSK',
        band: bandMatch ? bandMatch[1].toUpperCase() : '20m',
        freqMhz: freqMatch ? parseFloat(freqMatch[1]) : 14.074,
        rstSent: rstSentMatch ? rstSentMatch[1] : '-15',
        rstRcvd: rstRcvdMatch ? rstRcvdMatch[1] : '-15',
        distanceKm: 0,
        azimuthDeg: 0,
        notes: commentMatch ? commentMatch[1] : 'Imported from ADIF',
      };

      this.entries.push(newEntry);
      importedCount++;
    }

    if (importedCount > 0) {
      this.saveToStorage();
      if (this.entries.length > 0) {
        this.notifyListeners(this.entries[0]);
      }
    }

    return importedCount;
  }
}

export const qsoLogger = new Z30QsoLogger();
