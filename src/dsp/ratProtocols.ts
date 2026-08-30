/**
 * z-30 Amateur Radio CAT Protocol Builders
 * =========================================
 *
 * Real, verified transceiver control command builders - NOT Hamlib rigctld's own text
 * protocol. A prior version of catController.ts sent strings like "F 14076000" and "T 1"
 * directly over the Web Serial connection to what's supposed to be a real radio's serial
 * port. That text IS a real protocol - it's the syntax `rigctld` (a TCP daemon) accepts on
 * its network socket - but no actual Icom/Yaesu/Kenwood/Elecraft radio understands it on a
 * serial line. A real radio needs its own native CAT protocol.
 *
 * CI-V (Icom, and Icom CI-V-compatible Xiegu radios): frame structure verified against
 * Icom's published CI-V Reference Guides - general command structure
 * `FE FE <to-addr> <from-addr> <cmd> [sub-cmd] [data...] FD`. Frequency BCD encoding follows
 * the standard CI-V convention of 2 decimal digits packed per byte, least-significant byte
 * first (a mechanical, unambiguous algorithm, not a memorized magic sequence).
 *
 * Kenwood-style ASCII (Kenwood, Elecraft, and modern "new CAT" Yaesu rigs - FT-991A, FTDX10,
 * FTDX101, FT-891, FT-710): semicolon-terminated ASCII commands (FA/MD/TX/RX), verified
 * against the decades-stable Kenwood TS-2000 command set that Elecraft and modern Yaesu CAT
 * protocols are built on.
 *
 * Older Yaesu ("old CAT", 5-byte binary frames used by e.g. FT-747/FT-757/FT-1000/FT-920) is
 * NOT implemented here - it's a materially different binary protocol per rig family, and is
 * intentionally left as a known gap rather than guessed at.
 */

export type CatProtocolFamily = 'CIV' | 'KENWOOD' | 'NONE';

// ---------------------------------------------------------------------------
// Icom CI-V
// ---------------------------------------------------------------------------

const CIV_PREAMBLE = 0xfe;
const CIV_TERMINATOR = 0xfd;

/** Standard PC controller address used by virtually all CAT software (Hamlib's default too). */
export const CIV_CONTROLLER_ADDR = 0xe0;

const CIV_CMD_SET_FREQ = 0x05;
const CIV_CMD_SET_MODE = 0x06;
const CIV_CMD_TRANSCEIVE = 0x1c;
const CIV_SUBCMD_PTT = 0x00;

/** CI-V operating mode codes (data byte 1 of command 0x06). */
const CIV_MODE_CODES: Record<string, number> = {
  LSB: 0x00,
  USB: 0x01,
  AM: 0x02,
  CW: 0x03,
  RTTY: 0x04,
  FM: 0x05,
  WFM: 0x06,
  CWR: 0x07,
  RTTYR: 0x08,
};

/**
 * Packs a frequency in Hz into the CI-V 5-byte BCD format: 2 decimal digits per byte,
 * least-significant byte first (e.g. 14,076,000 Hz -> [0x00, 0x60, 0x07, 0x14, 0x00]).
 */
export function civFrequencyBcd(hz: number): number[] {
  let remaining = Math.max(0, Math.round(hz));
  const bytes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const twoDigits = remaining % 100;
    const bcd = ((Math.floor(twoDigits / 10) << 4) | (twoDigits % 10)) & 0xff;
    bytes.push(bcd);
    remaining = Math.floor(remaining / 100);
  }
  return bytes;
}

/** Builds a complete CI-V frame: FE FE <to-addr> <from-addr> <cmd/data...> FD. */
export function buildCivFrame(toAddr: number, cmdAndData: number[], fromAddr: number = CIV_CONTROLLER_ADDR): Uint8Array {
  return new Uint8Array([CIV_PREAMBLE, CIV_PREAMBLE, toAddr & 0xff, fromAddr & 0xff, ...cmdAndData, CIV_TERMINATOR]);
}

export function civSetFrequency(toAddr: number, hz: number): Uint8Array {
  return buildCivFrame(toAddr, [CIV_CMD_SET_FREQ, ...civFrequencyBcd(hz)]);
}

/**
 * Sets the CI-V base operating mode (e.g. USB). NOTE: toggling the "DATA" sub-mode digital
 * modes need (USB-D / PKT-USB on the radio's own display) uses a separate, rig-generation-
 * specific command (0x1A 0x06 on many modern Icoms, differently on others) that varies enough
 * between models to risk being wrong if guessed - it is intentionally not attempted here.
 * Operators should select DATA/PKT mode on the radio's own front panel, exactly as most
 * WSJT-X/JS8Call users already do for FT8/FT4.
 */
export function civSetMode(toAddr: number, mode: string): Uint8Array {
  const code = CIV_MODE_CODES[mode.toUpperCase()] ?? CIV_MODE_CODES.USB;
  return buildCivFrame(toAddr, [CIV_CMD_SET_MODE, code]);
}

export function civSetPtt(toAddr: number, tx: boolean): Uint8Array {
  return buildCivFrame(toAddr, [CIV_CMD_TRANSCEIVE, CIV_SUBCMD_PTT, tx ? 0x01 : 0x00]);
}

/** Parses a hex address string like "0x94" or "94" into a number. */
export function parseCivAddr(hex: string | undefined, fallback: number = 0x00): number {
  if (!hex) return fallback;
  const cleaned = hex.trim().replace(/^0x/i, '');
  const parsed = parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Kenwood-style ASCII (Kenwood / Elecraft / modern Yaesu "new CAT")
// ---------------------------------------------------------------------------

export function kenwoodSetFrequency(hz: number): string {
  return `FA${Math.max(0, Math.round(hz)).toString().padStart(11, '0')};`;
}

/** Kenwood-style single-digit mode codes: 1=LSB 2=USB 3=CW 4=FM 5=AM 6=FSK(RTTY) 7=CW-R 9=FSK-R. */
const KENWOOD_MODE_CODES: Record<string, string> = {
  LSB: '1',
  USB: '2',
  CW: '3',
  FM: '4',
  AM: '5',
  RTTY: '6',
  CWR: '7',
  RTTYR: '9',
};

/**
 * Sets the Kenwood-style base mode (e.g. USB). As with CI-V, selecting a dedicated DATA
 * sub-mode is rig-specific (e.g. some rigs expose "MD9;"/"DA" style commands instead) and is
 * intentionally left to the operator's front-panel selection rather than guessed at.
 */
export function kenwoodSetMode(mode: string): string {
  const code = KENWOOD_MODE_CODES[mode.toUpperCase()] ?? KENWOOD_MODE_CODES.USB;
  return `MD${code};`;
}

export function kenwoodSetPtt(tx: boolean): string {
  return tx ? 'TX;' : 'RX;';
}

// ---------------------------------------------------------------------------
// Family classification
// ---------------------------------------------------------------------------

/**
 * Derives the real CAT protocol family from a rig's manufacturer. Xiegu radios (G90, X5105,
 * X6100, G106, G1M) are documented CI-V-compatible interfaces, hence grouped with Icom.
 * Elecraft (K3/K3S/K4/KX2/KX3/K2) use the Kenwood TS-2000-derived command set, as do modern
 * "new CAT" Yaesu rigs.
 */
export function getProtocolFamilyForMfg(mfg: string): CatProtocolFamily {
  const m = mfg.toLowerCase();
  if (m === 'icom' || m === 'xiegu') return 'CIV';
  if (m === 'kenwood' || m === 'elecraft' || m === 'yaesu') return 'KENWOOD';
  return 'NONE';
}
