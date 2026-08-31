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
import {
  MonteCarloSimulationEngine,
  DEFAULT_MONTE_CARLO_CONFIG,
} from '../src/dsp/monteCarloEngine.ts';
import { isValidGrid, maidenheadToLatLon } from '../src/dsp/gridSquare.ts';
import { readFileSync } from 'node:fs';

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

// The shared vectors, so the UI, the transmit gate and the Python wizard cannot drift apart
// again. tests/test_config_wizard.py asserts the same file from the other side.
group('Callsign validation (shared vectors, cross-language)');
{
  const vectors = JSON.parse(readFileSync(new URL('./vectors/callsign_vectors.json', import.meta.url), 'utf8'));
  for (const { call, why } of vectors.valid) {
    check(`accepts ${JSON.stringify(call)} - ${why}`, isValidCallsign(call));
  }
  for (const { call, why } of vectors.invalid) {
    check(`rejects ${JSON.stringify(call)} - ${why}`, !isValidCallsign(call));
  }
}

// ------------------------------------------------------------ grid squares

group('Maidenhead grid locators');
{
  for (const grid of ['FN31', 'FN31PR', 'fn31pr', 'JO65', 'AA00', 'RR99']) {
    check(`accepts ${grid}`, isValidGrid(grid));
  }
  for (const grid of ['', 'FN', 'FN3', 'FN311', 'SS31', 'FN31ZZ', '1N31', 'FN31PRAA']) {
    check(`rejects ${JSON.stringify(grid)}`, !isValidGrid(grid));
  }

  const fn31 = maidenheadToLatLon('FN31');
  check('FN31 decodes to its square centre 41.5N 73W', fn31 !== null && Math.abs(fn31.lat - 41.5) < 0.01 && Math.abs(fn31.lon - -73.0) < 0.01,
    JSON.stringify(fn31));
  const jo65 = maidenheadToLatLon('JO65');
  check('JO65 decodes into the northern/eastern hemisphere', jo65 !== null && jo65.lat > 0 && jo65.lon > 0, JSON.stringify(jo65));
  check('a 6-character locator stays inside its 4-character square', (() => {
    const four = maidenheadToLatLon('FN31');
    const six = maidenheadToLatLon('FN31PR');
    return four !== null && six !== null && Math.abs(six.lat - four.lat) < 0.5 && Math.abs(six.lon - four.lon) < 1.0;
  })());
  check('out-of-range subsquare letters are rejected rather than plotted', maidenheadToLatLon('FN31ZZ') === null);
  check('a too-short locator returns null', maidenheadToLatLon('FN3') === null);
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

// --------------------------------------------------- Monte Carlo measurement modes

group('Monte Carlo measurement modes');
{
  const cfg = { ...DEFAULT_MONTE_CARLO_CONFIG };
  check(
    'the default measurement mode is realistic, matching the Python benchmark default',
    cfg.measurementMode === 'realistic',
    cfg.measurementMode
  );
  check('the default run is seeded', typeof cfg.seed === 'number' && Number.isFinite(cfg.seed));
  check(
    'realistic mode applies a non-zero carrier and timing offset',
    (cfg.carrierOffsetHz ?? 0) > 0 && (cfg.timingOffsetSec ?? 0) > 0
  );

  const engine = new MonteCarloSimulationEngine();

  // Acquisition must actually find a frame that is there, at an offset it was not told about.
  const payload = engine.generateRandomPayload();
  const { fullSymbols75 } = engine.assembleFrameSymbols(payload);
  const strong = engine.synthesizeReceivedStream(fullSymbols75, -10, cfg);
  const acq = engine.acquireFrame(strong.stream, cfg);
  check('a strong frame is acquired', acq.found, `syncScoreDb=${acq.syncScoreDb}`);
  check(
    'acquired timing lands within half a symbol of the truth',
    Math.abs(acq.startSample - strong.trueStartSample) < (cfg.sampleRateHz * 0.320) / 2,
    `off by ${acq.startSample - strong.trueStartSample} samples`
  );
  check(
    'acquired carrier lands within half a tone spacing of the truth',
    Math.abs(acq.centreFreqHz - strong.trueCentreFreqHz) < 1.5625,
    `off by ${(acq.centreFreqHz - strong.trueCentreFreqHz).toFixed(2)} Hz`
  );
  check(
    'the frame really was displaced, so the search was not trivially correct',
    strong.trueStartSample !== 0 && Math.abs(strong.trueCentreFreqHz - cfg.audioCenterFreqHz) > 0.05
  );

  // The receiver must estimate its own noise floor rather than being handed one.
  const estimated = engine.estimateNoiseSigma(strong.stream, cfg.sampleRateHz, acq.centreFreqHz);
  check(
    'the blind noise estimate is within 20% of the true sigma',
    Math.abs(estimated - strong.sigma) / strong.sigma < 0.2,
    `est=${estimated.toExponential(3)} true=${strong.sigma.toExponential(3)}`
  );

  // Pure noise must NOT produce a confident acquisition - a receiver that always finds a frame
  // reports a threshold that is really an artefact.
  const noiseOnly = engine.synthesizeReceivedStream(fullSymbols75, -60, cfg);
  const noiseAcq = engine.acquireFrame(noiseOnly.stream, cfg);
  check(
    'a frame buried far below the noise is NOT confidently acquired',
    !noiseAcq.found,
    `syncScoreDb=${noiseAcq.syncScoreDb.toFixed(1)}`
  );

  // Determinism: the realistic path draws its offsets from the seeded PRNG too.
  const runA = new MonteCarloSimulationEngine();
  const runB = new MonteCarloSimulationEngine();
  const seededCfg = { ...cfg, seed: 20260830 };
  const a1 = runA.synthesizeReceivedStream(fullSymbols75, -20, seededCfg);
  const b1 = runB.synthesizeReceivedStream(fullSymbols75, -20, seededCfg);
  check(
    'the same seed reproduces the same carrier and timing offsets',
    a1.trueStartSample === b1.trueStartSample && a1.trueCentreFreqHz === b1.trueCentreFreqHz
  );
  check('the same seed reproduces the same noise', a1.stream[5000] === b1.stream[5000]);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll frontend module checks passed.');
