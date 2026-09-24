/**
 * Station Configuration Persistence & Validation
 * ==============================================
 *
 * The station config feeds the transmit path: callsign, band plan, PTT method, GPIO pin,
 * frequencies. It used to be read back with a bare `JSON.parse` whose output was spread
 * straight into the live config object, so a truncated write, a schema change between
 * versions, or hand-edited browser storage produced a config whose fields were the wrong type
 * - and then those fields keyed a radio.
 *
 * Everything loaded from disk or browser storage now goes through `validateStationConfig`,
 * which keeps only fields of the expected type and falls back to the default for the rest, and
 * carries a schema version so an older shape can be migrated rather than trusted.
 */

import { StationConfig } from '../types/z30';
import { DEFAULT_STATION_CONFIG } from './z30Constants';
import {
  isLocalServerAvailable,
  readServerStationConfig,
  writeServerStationConfig,
} from './localServerApi';

export const STATION_CONFIG_STORAGE_KEY = 'z30_station_config';
export const STATION_CONFIG_VERSION_KEY = 'z30_station_config_version';

/** Bump when the shape changes in a way that needs migration in `migrateStationConfig`. */
export const STATION_CONFIG_SCHEMA_VERSION = 2;

type FieldKind = 'string' | 'number' | 'boolean';

/** Expected primitive type of every scalar field, used to reject wrong-typed stored values. */
const FIELD_KINDS: Partial<Record<keyof StationConfig, FieldKind>> = {
  myCall: 'string',
  myGrid: 'string',
  operatorName: 'string',
  qthDescription: 'string',
  regulatoryRegion: 'string',
  licenseClass: 'string',
  txPowerWatts: 'number',
  audioInputDevice: 'string',
  audioOutputDevice: 'string',
  sampleRateHz: 'number',
  audioChannels: 'number',
  catMethod: 'string',
  catEnabled: 'boolean',
  hamlibHost: 'string',
  hamlibPort: 'number',
  rigModel: 'string',
  serialPort: 'string',
  baudRate: 'number',
  dataBits: 'number',
  stopBits: 'number',
  handshake: 'string',
  pttMethod: 'string',
  pttPort: 'string',
  pttPolarity: 'string',
  pttToneFreqHz: 'number',
  pttToneChannel: 'string',
  cm108GpioPin: 'number',
  rpiGpioPin: 'number',
  tciHost: 'string',
  tciPort: 'number',
  winkeyerPort: 'string',
  pttLeadInMs: 'number',
  pttHangTimeMs: 'number',
  autoSeq: 'boolean',
  call1st: 'boolean',
  autoReplyPriority: 'string',
  watchdogCycles: 'number',
  holdTxFreq: 'boolean',
  splitTx: 'boolean',
  defaultTxSlot: 'string',
  appTimeOffsetMs: 'number',
  timezone: 'string',
};

export interface ValidationOutcome {
  config: StationConfig;
  /** Fields that were present but the wrong type, and were therefore discarded. */
  rejectedFields: string[];
}

/**
 * Returns a station config built from `DEFAULT_STATION_CONFIG` overlaid with every field of
 * `raw` that is present and of the expected type. Fields of the wrong type are dropped and
 * named in `rejectedFields` rather than silently coerced.
 */
export function validateStationConfig(raw: unknown): ValidationOutcome {
  const config: StationConfig = { ...DEFAULT_STATION_CONFIG };
  const rejectedFields: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config, rejectedFields: raw === undefined || raw === null ? [] : ['<root>'] };
  }

  const source = raw as Record<string, unknown>;
  for (const [key, kind] of Object.entries(FIELD_KINDS) as [keyof StationConfig, FieldKind][]) {
    if (!(key in source)) continue;
    const value = source[key as string];
    if (value === undefined || value === null) continue;

    const typeOk =
      (kind === 'string' && typeof value === 'string') ||
      (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (kind === 'boolean' && typeof value === 'boolean');

    if (typeOk) {
      (config as unknown as Record<string, unknown>)[key as string] = value;
    } else {
      rejectedFields.push(key as string);
    }
  }

  // customBands is a free-form map of band name -> dial frequency in Hz.
  const customBands = source.customBands;
  if (customBands && typeof customBands === 'object' && !Array.isArray(customBands)) {
    const cleaned: Record<string, number> = {};
    for (const [band, hz] of Object.entries(customBands as Record<string, unknown>)) {
      if (typeof hz === 'number' && Number.isFinite(hz) && hz > 0) cleaned[band] = hz;
      else rejectedFields.push(`customBands.${band}`);
    }
    config.customBands = cleaned;
  } else if (customBands !== undefined) {
    rejectedFields.push('customBands');
  }

  return { config, rejectedFields };
}

/**
 * Brings a stored config forward from an older schema version.
 *
 * Version 1 predates the regulatory region and licence class fields. There is no safe way to
 * infer them - band edges and sub-band privileges differ by country and by class - so they are
 * left unset, and the transmit gate asks the operator for them once.
 */
export function migrateStationConfig(raw: unknown, storedVersion: number): unknown {
  if (storedVersion >= STATION_CONFIG_SCHEMA_VERSION) return raw;
  return raw;
}

function readStoredVersion(): number {
  try {
    const stored = localStorage.getItem(STATION_CONFIG_VERSION_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : 1;
    return Number.isFinite(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

/** Loads and validates the browser-side station config. Never throws. */
export function loadStationConfigFromBrowser(): ValidationOutcome {
  try {
    const saved = localStorage.getItem(STATION_CONFIG_STORAGE_KEY);
    if (!saved) return { config: { ...DEFAULT_STATION_CONFIG }, rejectedFields: [] };
    const migrated = migrateStationConfig(JSON.parse(saved), readStoredVersion());
    const outcome = validateStationConfig(migrated);
    if (outcome.rejectedFields.length > 0) {
      console.warn(
        `[StationConfig] Ignored ${outcome.rejectedFields.length} stored field(s) of the wrong type:`,
        outcome.rejectedFields
      );
    }
    return outcome;
  } catch (err) {
    console.warn('[StationConfig] Stored configuration could not be parsed; using defaults.', err);
    return { config: { ...DEFAULT_STATION_CONFIG }, rejectedFields: ['<parse>'] };
  }
}

/** Persists the station config to browser storage and, when available, to a file on disk. */
export function saveStationConfig(config: StationConfig): void {
  try {
    localStorage.setItem(STATION_CONFIG_STORAGE_KEY, JSON.stringify(config));
    localStorage.setItem(STATION_CONFIG_VERSION_KEY, String(STATION_CONFIG_SCHEMA_VERSION));
  } catch (err) {
    console.warn('[StationConfig] Browser storage write failed:', err);
  }
  if (isLocalServerAvailable()) {
    void writeServerStationConfig(config as unknown as Record<string, unknown>).then((result) => {
      if (!result.success) {
        console.warn('[StationConfig] Server-side write failed:', result.error);
      }
    });
  }
}

/**
 * Loads the config the native server holds on disk, if there is one. The server copy outlives
 * cleared browsing data and a changed port number, both of which lose localStorage.
 */
export async function loadStationConfigFromServer(): Promise<StationConfig | null> {
  if (!isLocalServerAvailable()) return null;
  const result = await readServerStationConfig();
  if (!result.success || !result.data?.config || Object.keys(result.data.config).length === 0) {
    return null;
  }
  return validateStationConfig(result.data.config).config;
}
