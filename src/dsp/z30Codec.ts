/**
 * z-30 Message Packer, LDPC Codec & 16-MFSK Symbol Synthesizer
 */

import { Z30_SPECS } from './z30Constants';

export interface PackedMessage {
  rawText: string;
  type: 'CQ' | 'REPLY' | 'REPORT' | 'ROGER_REPORT' | 'RRR_73' | 'FREE_TEXT';
  callFrom?: string;
  callTo?: string;
  grid?: string;
  report?: string;
  infoBits: number[]; // 77 bits
  codedBits: number[]; // 216 bits
  symbols: number[]; // 75 symbols (0-15)
}

// Compact hash/packer for amateur radio callsigns (28 bits standard)
function encodeCallsign(call: string): number {
  const clean = call.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 37 + clean.charCodeAt(i)) & 0x0fffffff;
  }
  return hash;
}

// Encode Maidenhead 4-char grid (15 bits)
function encodeGrid(grid: string): number {
  const clean = grid.trim().toUpperCase();
  if (clean.length < 4) return 0;
  const lonF = clean.charCodeAt(0) - 65; // 'A'-'R' (0-17)
  const latF = clean.charCodeAt(1) - 65; // 'A'-'R' (0-17)
  const lonD = clean.charCodeAt(2) - 48; // '0'-'9' (0-9)
  const latD = clean.charCodeAt(3) - 48; // '0'-'9' (0-9)
  return ((lonF * 18 + latF) * 100 + (lonD * 10 + latD)) & 0x7fff;
}

// 14-bit CRC polynomial for error detection
function computeCrc14(bits: number[]): number {
  let crc = 0x2757; // Init
  const poly = 0x2443; // x^14 + x^11 + x^2 + 1
  for (const b of bits) {
    const msb = (crc >> 13) & 1;
    crc = ((crc << 1) & 0x3fff) ^ (msb ^ b ? poly : 0);
  }
  return crc & 0x3fff;
}

/**
 * Systematic (216, 77) LDPC parity generator
 * Vectorized generator matrix mapping 77 information bits to 216 channel coded bits
 */
function encodeLdpc216_77(infoBits: number[]): number[] {
  const coded = new Array(216).fill(0);
  // First 77 bits are systematic information bits
  for (let i = 0; i < 77; i++) {
    coded[i] = infoBits[i] || 0;
  }

  // Generate 139 parity bits using pseudo-random circulant LDPC sparse graph
  for (let p = 0; p < 139; p++) {
    let parity = 0;
    // Connect 5 info bits to each check node (degree-5 left graph)
    for (let k = 0; k < 5; k++) {
      const infoIdx = (p * 17 + k * 23 + 7) % 77;
      parity ^= coded[infoIdx];
    }
    // Connect to previous parity for accumulator structure (IRA-LDPC)
    if (p > 0) {
      parity ^= coded[77 + p - 1];
    }
    coded[77 + p] = parity;
  }

  return coded;
}

/**
 * Pack natural text into 77-bit z-30 payload and 75-symbol 16-MFSK frame
 */
export function packZ30Message(text: string): PackedMessage {
  const trimmed = text.trim().toUpperCase();
  const tokens = trimmed.split(/\s+/);
  
  let msgType: PackedMessage['type'] = 'FREE_TEXT';
  let callTo: string | undefined;
  let callFrom: string | undefined;
  let grid: string | undefined;
  let report: string | undefined;

  const infoBits: number[] = new Array(77).fill(0);

  if (tokens[0] === 'CQ') {
    msgType = 'CQ';
    if (tokens.length >= 3 && tokens[1] === 'DX') {
      callFrom = tokens[2];
      grid = tokens[3] || 'FN31';
    } else {
      callFrom = tokens[1] || 'W1AW';
      grid = tokens[2] || 'FN31';
    }
  } else if (tokens.length >= 2) {
    callTo = tokens[0];
    callFrom = tokens[1];
    const third = tokens[2] || '';

    if (third.startsWith('R-') || third.startsWith('R+')) {
      msgType = 'ROGER_REPORT';
      report = third;
    } else if (third.startsWith('-') || third.startsWith('+') || /^\d+$/.test(third)) {
      msgType = 'REPORT';
      report = third;
    } else if (third === 'RRR' || third === '73' || third === 'RR73') {
      msgType = 'RRR_73';
      report = third;
    } else if (third.length === 4 && /^[A-R]{2}[0-9]{2}$/i.test(third)) {
      msgType = 'REPLY';
      grid = third;
    }
  }

  // Pack fields into 63 raw info bits
  const hashFrom = callFrom ? encodeCallsign(callFrom) : encodeCallsign(trimmed);
  const hashTo = callTo ? encodeCallsign(callTo) : 0;
  const hashGrid = grid ? encodeGrid(grid) : 0;

  for (let i = 0; i < 28; i++) infoBits[i] = (hashTo >> (27 - i)) & 1;
  for (let i = 0; i < 28; i++) infoBits[28 + i] = (hashFrom >> (27 - i)) & 1;
  for (let i = 0; i < 7; i++) infoBits[56 + i] = (hashGrid >> (6 - i)) & 1;

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
 * Format standard amateur radio QSO messages
 */
export function buildQsoMacros(myCall: string, myGrid: string, dxCall: string, dxGrid: string, rptSent: string, rptRcvd: string) {
  const cleanDx = dxCall.trim().toUpperCase() || 'DX';
  const cleanMy = myCall.trim().toUpperCase() || 'W1AW';
  const cleanGrid = dxGrid.trim().toUpperCase() || 'EM00';
  const cleanMyGrid = myGrid.trim().toUpperCase() || 'FN31';

  return {
    tx1: `CQ ${cleanMy} ${cleanMyGrid}`,
    tx2: `${cleanDx} ${cleanMy} ${cleanMyGrid}`,
    tx3: `${cleanDx} ${cleanMy} ${rptSent.startsWith('-') || rptSent.startsWith('+') ? rptSent : '-' + rptSent}`,
    tx4: `${cleanDx} ${cleanMy} R${rptSent.startsWith('-') || rptSent.startsWith('+') ? rptSent : '-' + rptSent}`,
    tx5: `${cleanDx} ${cleanMy} 73`,
    tx6: `CQ DX ${cleanMy} ${cleanMyGrid}`,
  };
}
