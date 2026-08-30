/**
 * Node-side tests for the pure browser modules: the band-plan transmit gate, the seeded PRNG,
 * the waveform generator, and station-config validation.
 *
 * These modules are the ones where a defect reaches hardware or loses operator data, and all
 * four are free of DOM dependencies, so they can be exercised directly.
 *
 * Run with:  npx tsx tests/frontend.test.mjs
 */

import {
  findPermittedSegment,
  nearestPermittedSegment,
  isValidCallsign,
  BAND_PLANS,
} from '../src/dsp/bandPlan.ts';
import { createSeededRandom, DEFAULT_MONTE_CARLO_SEED } from '../src/dsp/seededRandom.ts';
import { synthesizeFrameSamples, instantaneousFrequency, Z30_GFSK_BT } from '../src/dsp/z30Waveform.ts';
import { validateStationConfig } from '../src/dsp/stationConfigStore.ts';
import { Z30_SPECS } from '../src/dsp/z30Constants.ts';

let failures = 0;
let section = '';

function group(name) {
  section = name;
  console.log(name);
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${section} / ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- band plan

group('Band plan and transmit privileges');
check(
  'US General is permitted on 20 m at 14.076 MHz',
  findPermittedSegment('US', 'US_GENERAL', 14076000) !== null
);
check(
  'US General is NOT permitted below the 20 m data sub-band edge',
  findPermittedSegment('US', 'US_GENERAL', 14010000) === null
);
check(
  'US Extra IS permitted at 14.010 MHz where General is not',
  findPermittedSegment('US', 'US_EXTRA', 14010000) !== null
);
check(
  'US Technician has no 20 m data privileges',
  findPermittedSegment('US', 'US_TECHNICIAN', 14076000) === null
);
check(
  'US Technician does have 10 m data privileges',
  findPermittedSegment('US', 'US_TECHNICIAN', 28076000) !== null
);

group('Band edges are checked against the emission, not its centre');
// A z-30 signal is 50 Hz wide. A station whose CENTRE sits just inside a band edge is still
// radiating more than half its power outside the band - the exact mistake made by an operator
// tuning right up to the edge of a segment.
const BW = Z30_SPECS.TOTAL_BANDWIDTH_HZ;
check(
  'a 50 Hz emission centred 10 Hz inside the 14.150 MHz upper edge is refused',
  findPermittedSegment('US', 'US_GENERAL', 14149990, BW) === null
);
check(
  'the same centre frequency passes when width is ignored (the old, wrong behaviour)',
  findPermittedSegment('US', 'US_GENERAL', 14149990, 0) !== null
);
check(
  'a 50 Hz emission 30 Hz below the upper edge fits',
  findPermittedSegment('US', 'US_GENERAL', 14149970, BW) !== null
);
check(
  'a 50 Hz emission centred 10 Hz above the 14.025 MHz lower edge is refused',
  findPermittedSegment('US', 'US_GENERAL', 14025010, BW) === null
);
check(
  'a 50 Hz emission 30 Hz above the lower edge fits',
  findPermittedSegment('US', 'US_GENERAL', 14025030, BW) !== null
);
check(
  'nearest-segment lookup reports the distance to an out-of-band frequency',
  nearestPermittedSegment('US', 'US_GENERAL', 14010000)?.distanceHz === 15000,
  `got ${nearestPermittedSegment('US', 'US_GENERAL', 14010000)?.distanceHz}`
);
check(
  'nearest-segment lookup reports zero distance for a straddling centre',
  nearestPermittedSegment('US', 'US_GENERAL', 14149990)?.distanceHz === 0
);
check(
  'a frequency between bands is refused',
  findPermittedSegment('IARU_R1', 'FULL', 12000000) === null
);
check(
  'Region 1 stops at the 3.800 MHz 80 m edge',
  findPermittedSegment('IARU_R1', 'FULL', 3900000) === null &&
    findPermittedSegment('IARU_R2', 'FULL', 3900000) !== null,
  'Region 1 and Region 2 must not share the 80 m upper edge'
);
check(
  'every plan declares when it was last verified',
  Object.values(BAND_PLANS).every((plan) => /^\d{4}-\d{2}-\d{2}$/.test(plan.verifiedOn))
);
check(
  'every segment has a positive width and at least one licence class',
  Object.values(BAND_PLANS).every((plan) =>
    plan.segments.every((s) => s.endHz > s.startHz && s.classes.length > 0)
  )
);

group('Callsign validation');
for (const call of ['W1AW', 'G4XYZ', 'JA1ABC', 'VK3ABC', 'DL1ABC', 'W1AW/P', 'F/W1AW']) {
  check(`accepts ${call}`, isValidCallsign(call));
}
for (const call of ['', '   ', 'HELLO', '12345', 'CALLSIGN', '!!!']) {
  check(`rejects ${JSON.stringify(call)}`, !isValidCallsign(call));
}

// ------------------------------------------------------------ seeded PRNG

group('Seeded PRNG reproducibility');
{
  const a = createSeededRandom(12345);
  const b = createSeededRandom(12345);
  const seqA = Array.from({ length: 200 }, () => a.next());
  const seqB = Array.from({ length: 200 }, () => b.next());
  check('the same seed produces the same sequence', seqA.every((v, i) => v === seqB[i]));

  const c = createSeededRandom(12346);
  const seqC = Array.from({ length: 200 }, () => c.next());
  check('a different seed produces a different sequence', seqA.some((v, i) => v !== seqC[i]));

  check('all draws are in [0, 1)', seqA.every((v) => v >= 0 && v < 1));

  const mean = seqA.reduce((sum, v) => sum + v, 0) / seqA.length;
  check(`uniform mean is near 0.5 (got ${mean.toFixed(3)})`, Math.abs(mean - 0.5) < 0.06);

  const normalSource = createSeededRandom(999);
  const normals = Array.from({ length: 20000 }, () => normalSource.normal());
  const nMean = normals.reduce((s, v) => s + v, 0) / normals.length;
  const nVar = normals.reduce((s, v) => s + (v - nMean) ** 2, 0) / normals.length;
  check(`normal mean is near 0 (got ${nMean.toFixed(3)})`, Math.abs(nMean) < 0.05);
  check(`normal variance is near 1 (got ${nVar.toFixed(3)})`, Math.abs(nVar - 1) < 0.06);

  const zeroSeeded = createSeededRandom(0);
  const zeroDraws = Array.from({ length: 50 }, () => zeroSeeded.next());
  check('seed 0 does not degenerate into a constant', new Set(zeroDraws).size === zeroDraws.length);
  check('the default seed is recorded on the source', createSeededRandom().seed === DEFAULT_MONTE_CARLO_SEED);
}

// -------------------------------------------------------------- waveform

group('Waveform generation');
{
  const sampleRate = 12000;
  const symbols = Array.from({ length: 75 }, (_, i) => (i * 7 + 3) % 16);
  const samples = synthesizeFrameSamples(symbols, 1250, sampleRate, 0.5);

  const expectedLength = 75 * Math.round(sampleRate * Z30_SPECS.SYMBOL_DURATION_SEC);
  check(`renders ${expectedLength} samples`, samples.length === expectedLength, `got ${samples.length}`);
  check('all samples are finite', samples.every((v) => Number.isFinite(v)));
  check('amplitude stays within the requested peak', samples.every((v) => Math.abs(v) <= 0.5001));

  // Constant envelope away from the frame-edge ramps: sample the local peak over each symbol.
  const sps = Math.round(sampleRate * Z30_SPECS.SYMBOL_DURATION_SEC);
  let minSymbolPeak = Infinity;
  for (let s = 1; s < 74; s++) {
    let peak = 0;
    for (let i = s * sps; i < (s + 1) * sps; i++) peak = Math.max(peak, Math.abs(samples[i]));
    minSymbolPeak = Math.min(minSymbolPeak, peak);
  }
  check(
    `no symbol is amplitude-gated (weakest symbol peak ${minSymbolPeak.toFixed(4)})`,
    minSymbolPeak > 0.49,
    'a per-symbol envelope would show up as a symbol whose peak never reaches full amplitude'
  );

  check('the frame starts ramped from zero', Math.abs(samples[0]) < 1e-3);
  check('the frame ends ramped to zero', Math.abs(samples[samples.length - 1]) < 1e-2);

  const freq = instantaneousFrequency(symbols, 1250, sps, Z30_SPECS.TONE_SPACING_HZ, Z30_GFSK_BT);
  let worstError = 0;
  for (let s = 0; s < symbols.length; s++) {
    const expected = 1250 + symbols[s] * Z30_SPECS.TONE_SPACING_HZ;
    worstError = Math.max(worstError, Math.abs(freq[s * sps + Math.floor(sps / 2)] - expected));
  }
  check(`instantaneous frequency lands on each tone at symbol centre (worst ${worstError.toFixed(3)} Hz)`, worstError < 0.5);

  let threw = false;
  try {
    synthesizeFrameSamples([16, 0, 0], 1250, sampleRate);
  } catch {
    threw = true;
  }
  check('an out-of-range symbol index is rejected', threw);
}

// ------------------------------------------------------- config validation

group('Station config validation');
{
  const clean = validateStationConfig({ myCall: 'G4XYZ', txPowerWatts: 30, catEnabled: false });
  check('accepts well-typed fields', clean.config.myCall === 'G4XYZ' && clean.config.txPowerWatts === 30);
  check('accepts a false boolean rather than treating it as absent', clean.config.catEnabled === false);
  check('reports nothing rejected for a clean config', clean.rejectedFields.length === 0);

  const dirty = validateStationConfig({ myCall: 12345, txPowerWatts: 'lots', rpiGpioPin: null });
  check('rejects a numeric callsign', typeof dirty.config.myCall === 'string' && dirty.config.myCall !== 12345);
  check('rejects a string power', typeof dirty.config.txPowerWatts === 'number');
  check('names the rejected fields', dirty.rejectedFields.includes('myCall') && dirty.rejectedFields.includes('txPowerWatts'));

  check('a null config falls back to defaults', typeof validateStationConfig(null).config.myCall === 'string');
  check('an array config falls back to defaults', validateStationConfig([1, 2, 3]).rejectedFields.includes('<root>'));
  check('NaN is not accepted as a number', validateStationConfig({ hamlibPort: NaN }).rejectedFields.includes('hamlibPort'));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll frontend module checks passed.');
