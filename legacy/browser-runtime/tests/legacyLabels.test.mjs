/**
 * Regression guards for audit 2026-09-24 H-03, M-02 and M-03 (legacy runtime only).
 *
 * - H-03: a self-test frame was pushed into the decode list looking exactly like a reception.
 * - M-03: every decode carried `confidence: 99`, a constant presented as a measurement.
 * - M-02: all 139 catalogue rigs were "STABLE", with a "last updated" date of whenever the page
 *   was opened. No radio has been tested with z-30.
 *
 * Run with:  npx tsx tests/legacyLabels.test.mjs
 */

import { toDecodedSignal } from '../src/dsp/sicDecoder.ts';
import { CURRENT_HAMLIB_VERSION, HAMLIB_ALL_RIGS } from '../src/dsp/hamlibCatalog.ts';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const frame = (synthetic) => ({
  freqHz: 1250,
  snrDb: -12,
  dtSec: 0.1,
  sicPass: 1,
  rawSymbols: [],
  unpacked: { rawText: 'CQ K1ABC FN42', callFrom: 'K1ABC', callTo: '', grid: 'FN42', report: '' },
  ldpcIterations: 7,
  synthetic,
});

console.log('decode labelling');
const test = toDecodedSignal(frame(true), 14.074, '000000', 0, 0, 'N0CALL', 't');
const live = toDecodedSignal(frame(false), 14.074, '000000', 0, 0, 'N0CALL', 't');
check('a self-test decode says SYNTHETIC TEST in its text', test.message.startsWith('SYNTHETIC TEST: '), test.message);
check('a self-test decode is sourced as synthetic', test.source === 'synthetic-self-test', test.source);
check('a live decode is sourced as live audio and not relabelled', live.source === 'live-audio' && live.message === 'CQ K1ABC FN42');
check('no decode carries a confidence figure', !('confidence' in test) && !('confidence' in live));

console.log('Hamlib catalogue');
check('no rig is claimed tested', HAMLIB_ALL_RIGS.every((r) => r.status === 'UNTESTED'),
  [...new Set(HAMLIB_ALL_RIGS.map((r) => r.status))].join(','));
check('the rig count is the array, not a claim', CURRENT_HAMLIB_VERSION.totalSupportedRigs === HAMLIB_ALL_RIGS.length);
check('no freshness date is generated at runtime', Number.isNaN(Date.parse(CURRENT_HAMLIB_VERSION.lastUpdated)));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
