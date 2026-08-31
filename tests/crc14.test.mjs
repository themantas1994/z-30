/**
 * Runs the shared CRC-14 known-answer vectors through the real TypeScript codec.
 *
 * The Python side checks the same file in tests/test_cross_language_parity.py. Between them,
 * the two implementations of the codec cannot drift apart without a test going red - which
 * matters because drift here is silent: each half keeps working perfectly on its own while
 * quietly losing the ability to decode the other.
 *
 * Run with:  npx tsx tests/crc14.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ldpcCodec,
  Z30LdpcEngine,
  DITHER_AMPLITUDE,
  ditherSeedFromLlrs,
  ditherVector,
} from '../src/dsp/ldpcCodec.ts';
import { Z30_CHECK_TO_INFO } from '../src/dsp/z30Constants.ts';

const here = dirname(fileURLToPath(import.meta.url));
const document = JSON.parse(readFileSync(join(here, 'vectors', 'crc14_vectors.json'), 'utf8'));

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

console.log('CRC-14 known-answer vectors (TypeScript implementation)');
for (const vector of document.vectors) {
  const computed = ldpcCodec.computeCrc14(vector.payload);
  check(
    `crc14(${vector.name})`,
    computed === vector.crc14,
    `computed 0x${computed.toString(16).padStart(4, '0')}, expected 0x${vector.crc14.toString(16).padStart(4, '0')}`
  );
}

console.log('Structural invariants');
check('139 check nodes', Z30_CHECK_TO_INFO.length === 139, `got ${Z30_CHECK_TO_INFO.length}`);
check(
  'every check node has degree 5 with distinct information bits',
  Z30_CHECK_TO_INFO.every((row) => row.length === 5 && new Set(row).size === 5)
);
check(
  'CRC values stay inside 14 bits',
  document.vectors.every((v) => ldpcCodec.computeCrc14(v.payload) <= 0x3fff)
);

console.log('Encoder / parity-check agreement');
{
  // Rebuild H = [H_info | H_parity] and confirm the encoder produces a zero syndrome, the same
  // property tests/test_ldpc_codec.py asserts on the Python side.
  const engine = new Z30LdpcEngine();
  const k = 77;
  const m = 139;
  let allZero = true;
  for (let trial = 0; trial < 20; trial++) {
    const payload = [];
    // A small deterministic LCG: this test must give the same answer on every run.
    let state = (trial + 1) * 2654435761 % 4294967296;
    for (let i = 0; i < 63; i++) {
      state = (state * 1664525 + 1013904223) % 4294967296;
      payload.push(state % 2);
    }
    const encoded = engine.encode(payload);
    const codeword = encoded.codeword ?? encoded;
    for (let check = 0; check < m; check++) {
      let sum = 0;
      for (const bit of Z30_CHECK_TO_INFO[check]) sum ^= codeword[bit];
      sum ^= codeword[k + check];
      if (check >= 1) sum ^= codeword[k + check - 1];
      if (sum !== 0) allZero = false;
    }
  }
  check('encoder satisfies its own parity-check matrix', allZero);
}

// ---------------------------------------------------------------------------------------
// Deterministic schedule-4 (DITHER) perturbation, against the shared vectors.
//
// Both languages used to draw this from unseeded global RNG (`Math.random()` here,
// `np.random.rand()` in Python), which made the decoder not a function of its input: two
// seeded benchmark runs of the same configuration could decode a different set of frames, and
// only near threshold - exactly where the curve is measured. The Python side asserts the same
// file in tests/test_cross_language_parity.py.
{
  const doc = JSON.parse(readFileSync(join(here, 'vectors', 'dither_vectors.json'), 'utf8'));
  const llrs = Float32Array.from(doc.llrs);

  check('DITHER_AMPLITUDE matches the shared vectors', DITHER_AMPLITUDE === doc.amplitude);
  const seed = ditherSeedFromLlrs(llrs);
  check(
    'ditherSeedFromLlrs matches the Python implementation',
    seed === doc.seed,
    `got 0x${seed.toString(16)}, expected 0x${doc.seed.toString(16)}`
  );

  const produced = ditherVector(llrs, doc.dither.length);
  let firstMismatch = -1;
  for (let i = 0; i < doc.dither.length; i++) {
    if (produced[i] !== doc.dither[i]) {
      firstMismatch = i;
      break;
    }
  }
  check(
    'ditherVector matches the Python implementation bit for bit',
    firstMismatch === -1,
    firstMismatch >= 0
      ? `index ${firstMismatch}: got ${produced[firstMismatch]}, expected ${doc.dither[firstMismatch]}`
      : ''
  );
}

// The decoder must be a pure function even for a frame that never converges, which is the
// only way the dithered fourth schedule runs at all.
{
  const engine = new Z30LdpcEngine();
  const llrs = new Float32Array(216);
  let state = 987654321;
  for (let i = 0; i < 216; i++) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    llrs[i] = (state / 4294967296 - 0.5) * 1.4;
  }
  const first = engine.decodeMinSum(llrs);
  const second = engine.decodeMinSum(llrs);
  // 45 + 40 + 35 + 30: every schedule ran, so the dithered one did too.
  check(
    'an undecodable frame runs the whole four-schedule cascade',
    first.iterations === 150,
    `iterations = ${first.iterations}`
  );
  check(
    'decodeMinSum is reproducible through the dithered schedule',
    first.success === second.success &&
      first.iterations === second.iterations &&
      first.infoBits.every((b, i) => b === second.infoBits[i])
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll TypeScript codec checks passed.');
