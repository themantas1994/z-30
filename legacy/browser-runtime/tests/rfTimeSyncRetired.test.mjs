/**
 * Regression guard for audit 2026-09-24 C-03 / F-01 / F-09 (legacy runtime only).
 *
 * The retired browser runtime's RF time sync reported "SYNC OK" from pure noise and from its own
 * simulator, with an SNR floored by max() and a constant confidence, and the offset it reported
 * was persisted as app_time_offset_ms. Its network query parsed a zone-less time as local time.
 * Both entry points now always fail. These checks make sure nothing can bring back a success -
 * and therefore an offset the UI would offer to persist - without a decoded time code.
 *
 * The production application (crates/) has no RF or network time sync at all; it reads the OS
 * clock and reports the OS's own synchronisation status (crates/z30-io/src/wallclock.rs).
 *
 * Run with:  npx tsx tests/rfTimeSyncRetired.test.mjs
 */

import {
  RF_TIME_STATIONS,
  RF_TIME_SYNC_RETIRED,
  RfSignalGenerator,
  RfTimeSyncEngine,
  NetworkTimeSync,
} from '../src/dsp/rfTimeSyncEngine.ts';

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** A result that claims nothing: no success, no offset, no SNR, no confidence. */
function claimsNothing(r) {
  return r.success === false && r.deltaMs === 0 && Number.isNaN(r.snrDb) && r.confidence === 0;
}

const sampleRate = 12000;
const engine = new RfTimeSyncEngine(sampleRate);

// Seeded Gaussian noise (Box-Muller over an LCG): no Math.random in a test that must reproduce.
let state = 20260924;
const uniform = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return (state + 1) / 4294967297;
};
const noise = new Float32Array(sampleRate * 10);
for (let i = 0; i < noise.length; i++) {
  noise[i] = Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

console.log('RF time sync (retired)');
check('the retirement flag is set', RF_TIME_SYNC_RETIRED === true);

for (const [name, spec] of Object.entries(RF_TIME_STATIONS)) {
  const now = Date.now();
  check(`${name}: pure noise does not synchronise`, claimsNothing(engine.demodulateTimeSignal(noise, spec, now)));
  check(`${name}: missing audio does not synchronise`, claimsNothing(engine.demodulateTimeSignal(new Float32Array(0), spec, now)));
  // The old simulator path: its own synthetic station audio must not count as a sync either.
  let synthetic;
  try {
    synthetic = RfSignalGenerator.generateStationAudio(name, 10, sampleRate, {});
  } catch {
    synthetic = noise;
  }
  const r = engine.demodulateTimeSignal(synthetic, spec, now);
  check(`${name}: simulator audio does not synchronise`, claimsNothing(r), JSON.stringify({ success: r.success, deltaMs: r.deltaMs }));
}

const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = async () => {
  fetched += 1;
  throw new Error('network must not be contacted');
};
const net = await NetworkTimeSync.queryAtomicUtcOffset();
globalThis.fetch = realFetch;
check('network time query fails', net.success === false && net.offsetMs === 0);
check('network time query contacts nothing', fetched === 0, `${fetched} requests`);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
