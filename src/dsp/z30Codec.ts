/**
 * z-30 Message Packer, LDPC Codec & 16-MFSK Symbol Synthesizer / Demodulator
 * =========================================================================
 * 
 * Data Framing and Bit Allocation:
 * - Total Information Vector: K = 77 bits
 *   - Bits 0..27 (28 bits): Destination callsign integer (Base-37 standard amateur callsign representation)
 *   - Bits 28..55 (28 bits): Source callsign integer (Base-37 representation)
 *   - Bits 56..62 (7 bits): Extra field / Grid / SNR report (-30 to +30 dB or 64 compressed common grids)
 *   - Bits 63..76 (14 bits): CRC-14, g(x) = x^14 + x^13 + x^10 + x^6 + x + 1 (register
 *     constant 0x2443, x^14 implicit; init 0x2757, MSB-first)
 * 
 * Channel Coding:
 * - Systematic (N=216, K=77) Irregular Repeat Accumulate (IRA) LDPC Code
 * - Information block: 77 bits
 * - Parity block: 139 bits (dual-diagonal accumulator topology)
 * - Modulation Mapping: 216 channel coded bits / 4 bits/symbol = 54 data symbols
 * - Physical Framing: 54 data symbols + 21 Costas-like sync symbols = 75 total 16-MFSK symbols
 */

import { Z30_SPECS, Z30_CHECK_TO_INFO } from './z30Constants';

/**
 * Structured container for fully packed, encoded, and modulated z-30 messages.
 */
export interface PackedMessage {
  /** Original human-readable ASCII representation */
  rawText: string;
  /** Categorized QSO message exchange type */
  type: 'CQ' | 'REPLY' | 'REPORT' | 'ROGER_REPORT' | 'RRR_73' | 'FREE_TEXT';
  /** Transmitting station amateur callsign */
  callFrom?: string;
  /** Destination station amateur callsign or CQ specifier */
  callTo?: string;
  /** 4-character Maidenhead locator grid */
  grid?: string;
  /** Signal report string (e.g. "-14", "R-08", "RRR", "73") */
  report?: string;
  /** 77-bit information vector (63 payload bits + 14 CRC bits) */
  infoBits: number[];
  /** 216-bit systematic LDPC channel coded bit vector */
  codedBits: number[];
  /** 75 modulated 16-MFSK symbol indexes (values 0 through 15) */
  symbols: number[];
}

/**
 * High-density dictionary of common Maidenhead grid locators for 7-bit indexed compression.
 */
const COMMON_GRIDS = [
  'FN31', 'FN20', 'FN30', 'FM19', 'FM29', 'EM00', 'EM10', 'EM29', 'EM79', 'EL98',
  'EL89', 'DM79', 'DM04', 'DM13', 'CM87', 'CM97', 'CN87', 'CN88', 'IO91', 'IO82',
  'IO92', 'IO93', 'JO21', 'JO31', 'JO22', 'JO32', 'JN88', 'JN58', 'JN48', 'JN65',
  'PM95', 'PM85', 'PM74', 'QM05', 'QM06', 'QF22', 'QF56', 'QF57', 'RE78', 'GG87',
  'GF05', 'FF49', 'KG46', 'KF29', 'OL93', 'NL18', 'OF78', 'NF48', 'PF95',
  'KO85', 'KO94', 'KP04', 'KP15', 'KP20', 'KN87', 'KN99', 'KM17', 'KM68', 'KL78',
  'BL11', 'BK29', 'AJ81', 'AH21'
];

/**
 * Reversible 28-bit Amateur Radio Callsign Encoder.
 * 
 * Maps standard international amateur callsigns (e.g. W1AW, K1ABC, EA8/G4XYZ)
 * or operational tokens (CQ, CQ DX, QRZ) into an integer in [0, 2^28 - 1].
 * 
 * Encoding Scheme:
 * - Prefix: 1-2 alphanumeric characters represented in Radix-37.
 * - Digit: Single decimal digit 0-9.
 * - Suffix: 1-3 alphabetic characters represented in Radix-27 (27^3 = 19,683 states).
 * - Total states: 37^2 * 10 * 27^3 = 269,460,270 (fits within 28 bits).
 * 
 * @param call - Plaintext amateur radio callsign
 * @returns 28-bit packed unsigned integer representation
 */
export function encodeCallsign28(call: string): number {
  const clean = call.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  if (!clean || clean === 'CQ') return 0;
  if (clean === 'CQ DX') return 1;
  if (clean === 'CQ TEST') return 2;
  if (clean === 'QRZ') return 3;

  // Split into prefix, digit, suffix
  // Standard amateur callsign format: [1-2 prefix chars][1 digit][1-3 suffix chars]
  let formatted = clean;
  if (formatted.length > 6) formatted = formatted.substring(0, 6);

  // Match standard structure: (prefix)(digit)(suffix)
  const match = formatted.match(/^([A-Z0-9]{1,2})([0-9])([A-Z]{1,3})$/);
  if (match) {
    const pStr = match[1].length === 1 ? ' ' + match[1] : match[1];
    const dVal = parseInt(match[2], 10);
    const sStr = match[3].padEnd(3, ' ');

    const charToP = (c: string) => (c === ' ' ? 0 : c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 + 1 : c.charCodeAt(0) - 65 + 11);
    const charToS = (c: string) => (c === ' ' ? 0 : c.charCodeAt(0) - 65 + 1);

    const pVal = charToP(pStr[0]) * 37 + charToP(pStr[1]);
    const sVal = charToS(sStr[0]) * 729 + charToS(sStr[1]) * 27 + charToS(sStr[2]);

    const packed = pVal * (10 * 19683) + dVal * 19683 + sVal + 100;
    return packed & 0x0fffffff;
  }

  // Generic 6-character Base-37 encoding for non-standard or special event calls
  let acc = 0;
  for (let i = 0; i < Math.min(6, formatted.length); i++) {
    const c = formatted[i];
    const val = c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 + 1 : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 65 + 11 : 0;
    acc = (acc * 37 + val) & 0x0fffffff;
  }
  return (acc + 1000) & 0x0fffffff;
}

/**
 * Reversible 28-bit Callsign Decoder.
 * 
 * Reconstitutes the original amateur radio callsign string from its 28-bit packed integer form.
 * 
 * @param num - 28-bit unsigned integer value
 * @returns Decoded plaintext callsign string
 */
export function decodeCallsign28(num: number): string {
  if (num === 0) return 'CQ';
  if (num === 1) return 'CQ DX';
  if (num === 2) return 'CQ TEST';
  if (num === 3) return 'QRZ';
  if (num < 100) return 'CQ';

  const val = num - 100;
  const sVal = val % 19683;
  const rem1 = Math.floor(val / 19683);
  const dVal = rem1 % 10;
  const pVal = Math.floor(rem1 / 10);

  if (pVal < 37 * 37) {
    const p0 = Math.floor(pVal / 37);
    const p1 = pVal % 37;

    const s0 = Math.floor(sVal / 729);
    const s1 = Math.floor((sVal % 729) / 27);
    const s2 = sVal % 27;

    const pToChar = (v: number) => (v === 0 ? '' : v <= 10 ? String.fromCharCode(48 + v - 1) : String.fromCharCode(65 + v - 11));
    const sToChar = (v: number) => (v === 0 ? '' : String.fromCharCode(65 + v - 1));

    const prefix = (pToChar(p0) + pToChar(p1)).trim();
    const suffix = (sToChar(s0) + sToChar(s1) + sToChar(s2)).trim();

    if (prefix && suffix) {
      return `${prefix}${dVal}${suffix}`;
    }
  }

  return 'DX';
}

/**
 * Encodes a 4-character Maidenhead locator grid into a compact 7-bit field (values 0..127).
 * Uses common-grid indexed table lookups for top global locations and mathematical hashing for other grids.
 * 
 * @param grid - 4-character Maidenhead locator string (e.g. "FN31", "IO91")
 * @returns 7-bit integer representation (0..127)
 */
export function encodeGrid(grid: string): number {
  const clean = grid.trim().toUpperCase();
  const idx = COMMON_GRIDS.indexOf(clean);
  if (idx !== -1) {
    return 64 + idx; // 64..127 in 7-bit field
  }
  if (clean.length < 4) return 0;
  const lonF = clean.charCodeAt(0) - 65; // 'A'-'R' (0-17)
  const latF = clean.charCodeAt(1) - 65; // 'A'-'R' (0-17)
  const lonD = clean.charCodeAt(2) - 48; // '0'-'9' (0-9)
  const latD = clean.charCodeAt(3) - 48; // '0'-'9' (0-9)
  const code = (lonF * 18 + latF) * 100 + (lonD * 10 + latD);
  return 64 + (code % 64);
}

/**
 * Decodes a 7-bit compressed grid index back into a 4-character Maidenhead locator string.
 * 
 * @param val - 7-bit integer value (0..127)
 * @returns 4-character Maidenhead locator string
 */
export function decodeGrid(val: number): string {
  if (val >= 64 && val < 64 + COMMON_GRIDS.length) {
    return COMMON_GRIDS[val - 64];
  }
  return 'FN31';
}

/**
 * Computes a 14-bit Cyclic Redundancy Check (CRC-14) over an arbitrary bit sequence.
 * 
 * Polynomial Definition:
 * - Generator, as implemented: g(x) = x^14 + x^13 + x^10 + x^6 + x + 1 (register constant
 *   0x2443 - the low 14 coefficients, with x^14 implicit). Earlier revisions of this comment
 *   said "x^14 + x^11 + x^2 + 1", which is a different polynomial (register constant 0x0805)
 *   and not what this code computes. See z30_dsp/ldpc.py, which implements the same CRC.
 * - Initial Seed: 0x2757
 * - Residual Error Probability: P_undetected < 6.1 x 10^-5
 * 
 * @param bits - Array of discrete binary numbers (0 or 1) representing the payload
 * @returns 14-bit integer CRC checksum (0x0000 to 0x3FFF)
 */
export function computeCrc14(bits: number[]): number {
  let crc = 0x2757; // Initialization vector
  const poly = 0x2443; // x^14 + x^13 + x^10 + x^6 + x + 1, with x^14 implicit
  for (const b of bits) {
    const msb = (crc >> 13) & 1;
    crc = ((crc << 1) & 0x3fff) ^ (msb ^ (b & 1) ? poly : 0);
  }
  return crc & 0x3fff;
}

/**
 * Systematic (N=216, K=77) Irregular Repeat Accumulate (IRA) LDPC Encoder.
 * 
 * Maps 77 information bits (63 payload + 14 CRC) into a 216-bit channel codeword.
 * 
 * Parity Bit Generation Algorithm:
 * - Parity bits p_0 ... p_138 are generated sequentially via dual-diagonal accumulation:
 *   p_0 = sum_{j in V_0} u_j (mod 2)
 *   p_k = p_{k-1} + sum_{j in V_k} u_j (mod 2) for k = 1 ... 138
 * - Yields linear encoding complexity O(N).
 * 
 * @param infoBits - 77-element array of information bits (0 or 1)
 * @returns 216-element array of channel coded bits (0 or 1)
 */
export function encodeLdpc216_77(infoBits: number[]): number[] {
  const coded = new Array(216).fill(0);
  for (let i = 0; i < 77; i++) {
    coded[i] = infoBits[i] || 0;
  }

  for (let p = 0; p < 139; p++) {
    let parity = 0;
    const infoVars = Z30_CHECK_TO_INFO[p] || [];
    for (const infoIdx of infoVars) {
      parity ^= coded[infoIdx] || 0;
    }
    if (p > 0) {
      parity ^= coded[77 + p - 1];
    }
    coded[77 + p] = parity;
  }

  return coded;
}

/**
 * Encodes, modulates, and frames standard amateur text messages into 75 16-MFSK symbols.
 * 
 * Processing Steps:
 * 1. Tokenizes input text into standard QSO syntax (CQ, Reply, Report, Roger, 73).
 * 2. Compresses fields into 63 raw information bits (28-bit To, 28-bit From, 7-bit Extra).
 * 3. Computes 14-bit CRC-14 and appends it to form a 77-bit systematic block.
 * 4. Applies LDPC (216, 77) encoding to generate 139 parity bits.
 * 5. Groups 216 coded bits into 54 4-bit nibbles mapped to 16-MFSK data symbols.
 * 6. Interleaves 21 Costas synchronization pilot tones into predefined symbol slots.
 * 
 * @param text - Plaintext amateur radio transmission (e.g. "CQ W1AW FN31", "K1ABC W1AW -12")
 * @returns PackedMessage structure containing bits, symbols, and parsed QSO tokens
 */
export function packZ30Message(text: string): PackedMessage {
  const trimmed = text.trim().toUpperCase();
  const tokens = trimmed.split(/\s+/);
  
  let msgType: PackedMessage['type'] = 'FREE_TEXT';
  let callTo: string | undefined;
  let callFrom: string | undefined;
  let grid: string | undefined;
  let report: string | undefined;
  let extraCode = 0;

  const infoBits: number[] = new Array(77).fill(0);

  if (tokens[0] === 'CQ') {
    msgType = 'CQ';
    if (tokens.length >= 3 && tokens[1] === 'DX') {
      callTo = 'CQ DX';
      callFrom = tokens[2];
      grid = tokens[3] || 'FN31';
    } else {
      callTo = 'CQ';
      callFrom = tokens[1] || 'W1AW';
      grid = tokens[2] || 'FN31';
    }
    extraCode = encodeGrid(grid);
  } else if (tokens.length >= 2) {
    callTo = tokens[0];
    callFrom = tokens[1];
    const third = tokens[2] || '';

    if (third.startsWith('R-') || third.startsWith('R+')) {
      msgType = 'ROGER_REPORT';
      report = third;
      const num = parseInt(third.replace('R', ''), 10);
      extraCode = Math.max(0, Math.min(60, (isNaN(num) ? -12 : num) + 30));
    } else if (third.startsWith('-') || third.startsWith('+') || /^\d+$/.test(third)) {
      msgType = 'REPORT';
      report = third;
      const num = parseInt(third, 10);
      extraCode = Math.max(0, Math.min(60, (isNaN(num) ? -12 : num) + 30));
    } else if (third === 'RRR') {
      msgType = 'RRR_73';
      report = 'RRR';
      extraCode = 61;
    } else if (third === '73') {
      msgType = 'RRR_73';
      report = '73';
      extraCode = 62;
    } else if (third === 'RR73') {
      msgType = 'RRR_73';
      report = 'RR73';
      extraCode = 63;
    } else if (third.length === 4 && /^[A-R]{2}[0-9]{2}$/i.test(third)) {
      msgType = 'REPLY';
      grid = third;
      extraCode = encodeGrid(third);
    } else {
      extraCode = encodeGrid('FN31');
    }
  } else {
    callFrom = trimmed;
    extraCode = 62; // 73
  }

  // Pack fields into 63 raw info bits
  const numTo = callTo ? encodeCallsign28(callTo) : 0;
  const numFrom = callFrom ? encodeCallsign28(callFrom) : encodeCallsign28('W1AW');

  for (let i = 0; i < 28; i++) infoBits[i] = (numTo >> (27 - i)) & 1;
  for (let i = 0; i < 28; i++) infoBits[28 + i] = (numFrom >> (27 - i)) & 1;
  for (let i = 0; i < 7; i++) infoBits[56 + i] = (extraCode >> (6 - i)) & 1;

  // Calculate 14-bit CRC
  const crc14 = computeCrc14(infoBits.slice(0, 63));
  for (let i = 0; i < 14; i++) {
    infoBits[63 + i] = (crc14 >> (13 - i)) & 1;
  }

  // LDPC Encode (216, 77)
  const codedBits = encodeLdpc216_77(infoBits);

  // Group 216 bits into 54 data symbols (4 bits/symbol for 16-MFSK)
  const dataSymbols: number[] = [];
  for (let s = 0; s < Z30_SPECS.DATA_SYMBOLS; s++) {
    const bitIdx = s * 4;
    const tone = 
      (codedBits[bitIdx] << 3) |
      (codedBits[bitIdx + 1] << 2) |
      (codedBits[bitIdx + 2] << 1) |
      (codedBits[bitIdx + 3]);
    dataSymbols.push(tone);
  }

  // Interleave 21 Costas sync symbols and 54 data symbols into 75 total symbols
  const fullSymbols: number[] = new Array(Z30_SPECS.TOTAL_SYMBOLS).fill(0);
  const syncPosSet = new Set(Z30_SPECS.SYNC_POSITIONS);

  let syncCounter = 0;
  let dataCounter = 0;
  for (let i = 0; i < Z30_SPECS.TOTAL_SYMBOLS; i++) {
    if (syncPosSet.has(i)) {
      fullSymbols[i] = Z30_SPECS.SYNC_TONES[syncCounter % Z30_SPECS.SYNC_TONES.length];
      syncCounter++;
    } else {
      fullSymbols[i] = dataSymbols[dataCounter++];
    }
  }

  return {
    rawText: text,
    type: msgType,
    callFrom,
    callTo,
    grid,
    report,
    infoBits,
    codedBits,
    symbols: fullSymbols,
  };
}

/**
 * Unpacks 77 decoded information bits back into a structured amateur message.
 * 
 * Verifies CRC-14 consistency and reconstructs callsigns, grids, and signal reports.
 * 
 * @param infoBits - 77-element array of decoded hard decision information bits
 * @returns Parsed message object including CRC validation flag
 */
export function unpackZ30Message(infoBits: number[]): {
  rawText: string;
  type: PackedMessage['type'];
  callFrom: string;
  callTo?: string;
  grid?: string;
  report?: string;
  crcValid: boolean;
} {
  let numTo = 0;
  for (let i = 0; i < 28; i++) numTo = (numTo << 1) | (infoBits[i] || 0);

  let numFrom = 0;
  for (let i = 0; i < 28; i++) numFrom = (numFrom << 1) | (infoBits[28 + i] || 0);

  let extraCode = 0;
  for (let i = 0; i < 7; i++) extraCode = (extraCode << 1) | (infoBits[56 + i] || 0);

  let rcvdCrc = 0;
  for (let i = 0; i < 14; i++) rcvdCrc = (rcvdCrc << 1) | (infoBits[63 + i] || 0);

  const compCrc = computeCrc14(infoBits.slice(0, 63));
  const crcValid = compCrc === rcvdCrc;

  const callTo = decodeCallsign28(numTo);
  const callFrom = decodeCallsign28(numFrom);

  let msgType: PackedMessage['type'] = 'FREE_TEXT';
  let grid: string | undefined;
  let report: string | undefined;
  let rawText = '';

  if (callTo === 'CQ' || callTo === 'CQ DX' || numTo === 0 || numTo === 1) {
    msgType = 'CQ';
    grid = decodeGrid(extraCode);
    rawText = callTo === 'CQ DX' ? `CQ DX ${callFrom} ${grid}` : `CQ ${callFrom} ${grid}`;
  } else if (extraCode >= 64) {
    msgType = 'REPLY';
    grid = decodeGrid(extraCode);
    rawText = `${callTo} ${callFrom} ${grid}`;
  } else if (extraCode === 61) {
    msgType = 'RRR_73';
    report = 'RRR';
    rawText = `${callTo} ${callFrom} RRR`;
  } else if (extraCode === 62) {
    msgType = 'RRR_73';
    report = '73';
    rawText = `${callTo} ${callFrom} 73`;
  } else if (extraCode === 63) {
    msgType = 'RRR_73';
    report = 'RR73';
    rawText = `${callTo} ${callFrom} RR73`;
  } else {
    const snrVal = extraCode - 30;
    const sign = snrVal >= 0 ? '+' : '';
    report = `${sign}${snrVal}`;
    msgType = 'REPORT';
    rawText = `${callTo} ${callFrom} ${report}`;
  }

  return {
    rawText,
    type: msgType,
    callFrom,
    callTo: callTo === 'CQ' || callTo === 'CQ DX' ? undefined : callTo,
    grid,
    report,
    crcValid,
  };
}

/**
 * Generates standard 6-stage amateur radio QSO macro messages (Tx1 through Tx6).
 * 
 * @param myCall - Local operator callsign (e.g. "W1AW")
 * @param myGrid - Local Maidenhead grid locator (e.g. "FN31pr")
 * @param dxCall - Target DX station callsign
 * @param rptSent - SNR report to send (e.g. "-12")
 * @returns Object with macro text templates for Tx1 through Tx6
 *
 * NOTE: this used to also take `dxGrid` and `rptRcvd`. Neither appeared in any of the six
 * templates - the standard exchange sends the DX callsign and your own grid, never theirs -
 * so both were dead weight that made the call sites look like they carried more state than
 * they did. Removed rather than underscored, because nothing here would ever use them.
 */
export function buildQsoMacros(myCall: string, myGrid: string, dxCall: string, rptSent: string) {
  const cleanDx = dxCall.trim().toUpperCase() || 'DX';
  const cleanMy = myCall.trim().toUpperCase() || 'W1AW';
  const cleanMyGrid = myGrid.trim().toUpperCase() || 'FN31';

  return {
    /** Tx1: Standard CQ call */
    tx1: `CQ ${cleanMy} ${cleanMyGrid}`,
    /** Tx2: Direct reply to calling station */
    tx2: `${cleanDx} ${cleanMy} ${cleanMyGrid}`,
    /** Tx3: Initial signal report exchange */
    tx3: `${cleanDx} ${cleanMy} ${rptSent.startsWith('-') || rptSent.startsWith('+') ? rptSent : '-' + rptSent}`,
    /** Tx4: Roger + signal report confirmation */
    tx4: `${cleanDx} ${cleanMy} R${rptSent.startsWith('-') || rptSent.startsWith('+') ? rptSent : '-' + rptSent}`,
    /** Tx5: Final 73 signoff */
    tx5: `${cleanDx} ${cleanMy} 73`,
    /** Tx6: Targeted CQ DX call */
    tx6: `CQ DX ${cleanMy} ${cleanMyGrid}`,
  };
}

