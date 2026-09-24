// Exports the shipped TypeScript message codec's behaviour into fixtures/golden/messages.json.
//
//     (cd legacy/browser-runtime && npm ci)
//     npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts            # write
//     npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts --check    # compare
//
// The legacy TypeScript codec is the reference for the v1 wire format of whole messages and
// nothing else: it is not production code, and its LOSSY packing (FN42 -> RE78, audit C-06) is
// exactly what `round_trips: false` records. vNext refuses every such message.
//
// The grid table and the text tokenizer exist only in legacy/browser-runtime/src/dsp/z30Codec.ts (message_codec.py
// deliberately stops at the callsign fields), so the v1 wire format for whole messages is
// defined by this file's oracle, not by the Python one. vNext reproduces every message that
// round-trips bit-exactly and REFUSES every one that does not; `round_trips` records which is
// which according to the shipped unpacker.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGrid, encodeGrid, packZ30Message, unpackZ30Message } from '../../legacy/browser-runtime/src/dsp/z30Codec.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'fixtures', 'golden', 'messages.json');

const texts = [
  'CQ W1AW FN31', 'CQ K1ABC FN20', 'CQ DX G4XYZ IO91', 'CQ JA1XYZ PM95', 'CQ W1AW FN42',
  'CQ W1AW', 'CQ DX W1AW', 'K1ABC W1AW FN31', 'K1ABC W1AW EM12', 'K1ABC W1AW -12', 'K1ABC W1AW +05',
  'K1ABC W1AW -30', 'K1ABC W1AW +30', 'K1ABC W1AW -35', 'K1ABC W1AW 12', 'K1ABC W1AW R-12',
  'K1ABC W1AW R+03', 'K1ABC W1AW RRR', 'K1ABC W1AW 73', 'K1ABC W1AW RR73', 'K1ABC W1AW HELLO',
  'K1ABC W1AW', 'W1AW', 'QRZ W1AW FN31', 'ZY2ABC W1AW -10', 'G4XYZ/P W1AW -10', 'K1ABC W1AW -X',
  'VK2ABC ZS6ABC RR73', 'CQ 9A1AA JN65', 'CQ ZU1AB KG46', 'K1ABC W1AW AH21', 'K1ABC W1AW BL11',
];

const messages = texts.map((text) => {
  const p = packZ30Message(text);
  const u = unpackZ30Message(p.infoBits);
  return {
    text,
    type: p.type,
    info_bits: p.infoBits.join(''),
    coded_bits: p.codedBits.join(''),
    symbols: p.symbols,
    unpacked_text: u.rawText,
    round_trips: u.rawText === text.trim().toUpperCase(),
  };
});

const gridCodes = [];
for (let code = 0; code < 128; code += 1) gridCodes.push({ code, grid: decodeGrid(code) });
const grids = ['FN31', 'FN42', 'JO01', 'EM12', 'GG66', 'IO91', 'AH21', 'RR99', 'AA00', 'KG46'].map((g) => ({
  grid: g,
  code: encodeGrid(g),
}));

const doc = {
  _comment:
    'Oracle: src/dsp/z30Codec.ts packZ30Message / unpackZ30Message / encodeGrid / decodeGrid. ' +
    'Regenerate with npx tsx reference/golden/generate_messages.mts',
  messages,
  decode_grid: gridCodes,
  encode_grid: grids,
};
const text = JSON.stringify(doc, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) {
    console.error('fixtures/golden/messages.json differs from the shipped TypeScript codec');
    process.exit(1);
  }
  console.log('messages.json reproduces');
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
