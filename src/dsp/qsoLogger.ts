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
import { PLACEHOLDER_CALLSIGN } from './z30Constants';
import { isLocalServerAvailable, readServerLogbook, writeServerLogbook } from './localServerApi';

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

/** How a storage write ended, for the UI to surface rather than the console to swallow. */
export interface StorageStatus {
  /** True if the most recent persist attempt reached at least one durable store. */
  ok: boolean;
  /** True if the QSO log is mirrored to a file through the native server. */
  serverBacked: boolean;
  /** Human-readable description of the most recent failure, if any. */
  error?: string;
  /** Where the server-side copy lives, when there is one. */
  serverPath?: string;
}

type StorageStatusListener = (status: StorageStatus) => void;

export class Z30QsoLogger {
  private entries: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private config: AutoLogConfig = { ...DEFAULT_AUTOLOG_CONFIG };
  private queue: LogEntry[] = [];
  private isProcessingQueue: boolean = false;
  private storageStatus: StorageStatus = { ok: true, serverBacked: false };
  private storageListeners: Set<StorageStatusListener> = new Set();
  private serverSyncInFlight: Promise<void> | null = null;

  constructor() {
    this.loadFromStorage();
    // The server-side copy is authoritative when it exists: it survives cleared browsing data,
    // a private window, a different browser, and a different port number - all of which lose
    // localStorage. See the comment on loadFromServer().
    void this.loadFromServer();
  }

  /** Subscribe to persistence outcomes so the UI can show a failed save instead of hiding it. */
  public subscribeToStorageStatus(listener: StorageStatusListener): () => void {
    this.storageListeners.add(listener);
    listener(this.storageStatus);
    return () => {
      this.storageListeners.delete(listener);
    };
  }

  public getStorageStatus(): StorageStatus {
    return { ...this.storageStatus };
  }

  private setStorageStatus(status: StorageStatus): void {
    this.storageStatus = status;
    this.storageListeners.forEach((fn) => {
      try {
        fn({ ...status });
      } catch (err) {
        console.error('Error in storage status listener:', err);
      }
    });
  }

  /**
   * Loads the logbook from the native server, replacing the browser-side copy when the server
   * holds more contacts.
   *
   * The logbook used to live in localStorage and nowhere else. That is the most volatile store
   * on the machine, and it is partitioned by origin - and the port number is part of the
   * origin. So the one time something else already held port 3000 and the app came up
   * somewhere else, the operator was shown an empty logbook and an unconfigured station while
   * the real data sat unreachable under the old origin. A file under the z-30 user data
   * directory has none of those failure modes.
   */
  private async loadFromServer(): Promise<void> {
    if (!isLocalServerAvailable()) return;
    const result = await readServerLogbook();
    if (!result.success || !Array.isArray(result.data?.entries)) return;

    const serverEntries = (result.data!.entries as LogEntry[]).filter(
      (e) => e && typeof e === 'object' && typeof (e as LogEntry).callsign === 'string'
    );
    this.setStorageStatus({ ok: true, serverBacked: true, serverPath: result.data?.path });

    if (serverEntries.length > this.entries.length) {
      this.entries = serverEntries;
      this.saveToStorage();
      const latest = this.entries[0];
      if (latest) this.notifyListeners(latest);
    } else if (this.entries.length > serverEntries.length) {
      // The browser copy is ahead (first run after this feature landed, say) - push it up.
      void this.syncToServer();
    }
  }

  /**
   * Mirrors the logbook to the native server: JSON as the source of truth, plus an ADIF export
   * written beside it after every logged QSO so the operator always has a file ready to submit.
   */
  private async syncToServer(): Promise<void> {
    if (!isLocalServerAvailable()) return;
    if (this.serverSyncInFlight) return;
    const snapshot = [...this.entries];
    const adif = this.exportToAdif(snapshot);
    this.serverSyncInFlight = writeServerLogbook(snapshot, adif)
      .then((result) => {
        if (result.success) {
          this.setStorageStatus({ ok: true, serverBacked: true, serverPath: result.data?.path });
        } else {
          this.setStorageStatus({
            ok: false,
            serverBacked: false,
            error: `Could not write the logbook to disk: ${result.error}`,
          });
        }
      })
      .finally(() => {
        this.serverSyncInFlight = null;
      });
    await this.serverSyncInFlight;
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

  /**
   * Persists the logbook.
   *
   * A quota-exceeded localStorage write used to be caught, logged to the console, and
   * otherwise indistinguishable from a successful save - so an operator could log contacts
   * all evening into a store that was silently discarding them. Failures now reach
   * `subscribeToStorageStatus` and the UI.
   */
  private saveToStorage() {
    let browserOk = false;
    let browserError: string | undefined;

    if (this.config.saveToLocalStorage && typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
        browserOk = true;
      } catch (e) {
        browserError =
          e instanceof Error && e.name === 'QuotaExceededError'
            ? 'Browser storage is full; the logbook could not be cached in this browser.'
            : `Browser storage write failed: ${e instanceof Error ? e.message : String(e)}`;
        console.warn('Failed to save QSO logbook to localStorage:', e);
      }
    }

    if (isLocalServerAvailable()) {
      void this.syncToServer();
    } else if (!browserOk) {
      this.setStorageStatus({
        ok: false,
        serverBacked: false,
        error: browserError || 'The logbook is not being persisted anywhere.',
      });
    } else {
      this.setStorageStatus({
        ok: true,
        serverBacked: false,
        error:
          'The logbook is only cached in this browser. Clearing browsing data, a private window, ' +
          'or a different browser loses it - launch z-30 through its native server to keep a file copy.',
      });
    }
  }

  /**
   * Loads the browser-side copy, validating its shape rather than trusting it.
   *
   * `JSON.parse` output used to be assigned straight to `this.entries`. A truncated write, a
   * schema change between versions, or hand-edited storage then produced entries whose fields
   * were the wrong type - and those fields feed ADIF export and the QSO sequencer.
   */
  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const savedLog = localStorage.getItem(STORAGE_KEY);
      if (savedLog) {
        const parsed: unknown = JSON.parse(savedLog);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((e) => Z30QsoLogger.isPlausibleLogEntry(e)) as LogEntry[];
          if (valid.length !== parsed.length) {
            console.warn(
              `[QsoLogger] Discarded ${parsed.length - valid.length} malformed logbook entries from browser storage.`
            );
          }
          this.entries = valid;
        } else {
          console.warn('[QsoLogger] Stored logbook was not an array; ignoring it.');
        }
      }
      const savedCfg = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (savedCfg) {
        const parsedCfg: unknown = JSON.parse(savedCfg);
        if (parsedCfg && typeof parsedCfg === 'object' && !Array.isArray(parsedCfg)) {
          this.config = { ...this.config, ...(parsedCfg as Partial<AutoLogConfig>) };
        }
      }
    } catch (e) {
      console.warn('Failed to load QSO logbook from localStorage:', e);
    }
  }

  /** Minimal structural check: the fields the rest of the app dereferences must be strings. */
  private static isPlausibleLogEntry(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    return (
      typeof entry.callsign === 'string' &&
      entry.callsign.length > 0 &&
      typeof entry.utcDate === 'string' &&
      typeof entry.utcTime === 'string'
    );
  }

  /**
   * ADIF length prefixes are BYTE counts of the UTF-8 encoded value.
   *
   * JavaScript's `String.prototype.length` returns UTF-16 code units, so any non-ASCII
   * character in a name, QTH or comment - an accented letter, a Japanese callsign note, an
   * em dash - used to emit a length shorter than the bytes that followed, and a conforming
   * ADIF parser then mis-read the remainder of the record.
   */
  private static adifByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  /** Builds one `<FIELD:len>value ` ADIF tag with a correct byte-count prefix. */
  private static adifField(name: string, value: string | number | undefined | null): string {
    if (value === undefined || value === null) return '';
    const text = String(value);
    if (text.length === 0) return '';
    return `<${name}:${Z30QsoLogger.adifByteLength(text)}>${text} `;
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
<CREATED_TIMESTAMP:${Z30QsoLogger.adifByteLength(now)}>${now}
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
      // ADIF 3.1.4's MODE field is a closed enumeration - "z-30" is not a member of it, and
      // logging software (LoTW, QRZ, Club Log, N1MM, etc.) will reject or mis-file any record
      // whose MODE isn't in that list. "MFSK" is the correct parent mode for this protocol
      // (16-tone continuous-phase MFSK); SUBMODE is free text and is where the specific
      // variant belongs, per the same convention WSJT-X used for FT8 before it got its own
      // top-level ADIF MODE entry.
      const mode = 'MFSK';
      const submode = 'Z30';
      const myCall = (e.myCall || PLACEHOLDER_CALLSIGN).toUpperCase();
      const myGrid = (e.myGrid || 'FN31').toUpperCase();
      const comment = e.notes || `z-30 16-MFSK LDPC / SIC Pass ${e.sicPass || 1}`;

      const field = Z30QsoLogger.adifField;
      adif += field('CALL', call);
      adif += field('QSO_DATE', cleanDate);
      adif += field('TIME_ON', cleanTime);
      adif += field('TIME_OFF', cleanTime);
      adif += field('BAND', band);
      adif += field('FREQ', freq);
      adif += field('MODE', mode);
      adif += field('SUBMODE', submode);
      adif += field('RST_SENT', rstSent);
      adif += field('RST_RCVD', rstRcvd);
      adif += field('GRIDSQUARE', grid);
      if (myCall) {
        adif += field('OPERATOR', myCall);
        adif += field('STATION_CALLSIGN', myCall);
      }
      adif += field('MY_GRIDSQUARE', myGrid);
      if (e.distanceKm) adif += field('DISTANCE', e.distanceKm);
      if (e.azimuthDeg !== undefined) adif += field('ANT_AZ', e.azimuthDeg);
      if (e.txPowerWatts) adif += field('TX_PWR', e.txPowerWatts);
      adif += field('COMMENT', comment);
      adif += `<EOR>\n`;
    }

    return adif;
  }

  /**
   * Serialises the log as a Cabrillo v3.0 contest submission.
   *
   * wiki/14 titles this section "ADIF 3.1.4 Logbook & Contest Export" and promises ADIF,
   * Cabrillo, JSON and CSV. Cabrillo is *the* contest format - it is what every contest robot
   * accepts - so its absence was a real gap in the documented feature rather than a doc typo.
   *
   * Cabrillo QSO lines are column-oriented and the fields are positional, so they are padded
   * rather than joined: a robot parsing this reads by offset. Frequency is in kHz for HF, as
   * the specification requires. The header fields a submission needs but the log cannot know
   * (contest name, category, club, operator name and address) are emitted as empty tags for
   * the operator to complete - a submission with invented values is worse than one that is
   * visibly incomplete.
   *
   * @param entriesToExport - Optional array of entries to serialize
   * @param options - Station identity and contest metadata for the header
   * @returns Cabrillo v3.0 text
   */
  public exportToCabrillo(
    entriesToExport?: LogEntry[],
    options?: { myCall?: string; myGrid?: string; contestName?: string; category?: string }
  ): string {
    const data = entriesToExport || this.entries;
    const myCall = (options?.myCall || data[0]?.myCall || PLACEHOLDER_CALLSIGN).toUpperCase();
    const myGrid = (options?.myGrid || data[0]?.myGrid || '').toUpperCase();

    const lines: string[] = [];
    lines.push('START-OF-LOG: 3.0');
    lines.push('CREATED-BY: z-30 DSP Transceiver Suite 1.0.0');
    lines.push(`CONTEST: ${options?.contestName || ''}`);
    lines.push(`CALLSIGN: ${myCall}`);
    lines.push(`CATEGORY-OPERATOR: ${options?.category || 'SINGLE-OP'}`);
    lines.push('CATEGORY-BAND: ALL');
    lines.push('CATEGORY-MODE: DIGI');
    lines.push('CATEGORY-POWER: LOW');
    lines.push('CATEGORY-STATION: FIXED');
    lines.push('CATEGORY-TRANSMITTER: ONE');
    lines.push(`GRID-LOCATOR: ${myGrid}`);
    lines.push('CLAIMED-SCORE: ');
    lines.push('OPERATORS: ');
    lines.push('NAME: ');
    lines.push('ADDRESS: ');
    lines.push('SOAPBOX: Worked with z-30, a 16-MFSK LDPC weak-signal mode (24 s frame, 50 Hz).');

    for (const e of data) {
      const dateIso = Z30QsoLogger.normaliseIsoDate(e.utcDate);
      const time = (e.utcTime || '').replace(/[^0-9]/g, '').padEnd(6, '0').substring(0, 4);
      // Cabrillo wants kHz for HF/MF and MHz above 50 MHz; z-30's bands are HF, so kHz.
      const freqKhz = String(Math.round((e.freqMhz || 0) * 1000));
      lines.push(
        'QSO: ' +
          freqKhz.padStart(5, ' ') + ' ' +
          'DG ' +
          dateIso + ' ' +
          time + ' ' +
          myCall.padEnd(13, ' ') + ' ' +
          (e.rstSent || '-15').padEnd(6, ' ') + ' ' +
          (e.myGrid || myGrid).toUpperCase().padEnd(6, ' ') + ' ' +
          (e.callsign || '').toUpperCase().padEnd(13, ' ') + ' ' +
          (e.rstRcvd || '-15').padEnd(6, ' ') + ' ' +
          (e.grid || '').toUpperCase().padEnd(6, ' ')
      );
    }

    lines.push('END-OF-LOG:');
    return lines.join('\n') + '\n';
  }

  /**
   * Serialises the log as JSON.
   *
   * The other three formats are all lossy in their own way - ADIF flattens z-30's SIC pass and
   * LDPC iteration count into a comment, CSV loses types, Cabrillo keeps only what a contest
   * robot scores. This one round-trips every field a LogEntry carries, which is what makes it
   * the useful format for anyone processing their own log.
   *
   * @param entriesToExport - Optional array of entries to serialize
   * @returns Pretty-printed JSON with a small provenance header
   */
  public exportToJson(entriesToExport?: LogEntry[]): string {
    const data = entriesToExport || this.entries;
    return JSON.stringify(
      {
        format: 'z30-logbook',
        formatVersion: 1,
        generatedUtc: new Date().toISOString(),
        programId: 'z-30',
        programVersion: '1.0.0',
        qsoCount: data.length,
        qsos: data,
      },
      null,
      2
    ) + '\n';
  }

  /**
   * Normalises a stored date to Cabrillo/ISO `YYYY-MM-DD`.
   *
   * LogEntry.utcDate is documented as "YYYY-MM-DD or YYYYMMDD", and both shapes really do
   * occur in stored logs, so every consumer has to handle both.
   */
  private static normaliseIsoDate(raw: string): string {
    const digits = (raw || '').replace(/[^0-9]/g, '');
    if (digits.length >= 8) {
      return `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`;
    }
    return raw || '';
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
      const myCall = (e.myCall || PLACEHOLDER_CALLSIGN).replace(/'/g, "''");
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
        mode: 'MFSK',
        submode: 'Z30',
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
