/**
 * Determinism guards for the DSP paths AGENTS.md section 4 requires to be reproducible.
 *
 * The invariant: nothing the decode path can reach may draw from an unseeded generator. It has
 * been broken twice now in the same shape - first in the LDPC dither (fixed by deriving the
 * seed from the channel LLRs), then again in `addCalibratedAwgn`, which fed unseeded Box-Muller
 * noise into the Experimental Testing self-test and from there into the real
 * demodulate -> decodeMinSum chain. Both were invisible to every existing test, because a test
 * that only asserts "this decodes" passes just as well on a decoder that is not a function of
 * its input.
 *
 * Every assertion here computes its expectation from the arrays under test - byte-for-byte
 * comparison of two independent runs, and statistics measured off the produced samples. There
 * are no recorded golden values to go stale.
 *
 * Run with:  npx tsx tests/dspDeterminism.test.mjs
 */

import {
  addCalibratedAwgn,
  awgnSeedFromWaveform,
  findCandidates,
  measureNoiseFloorDb,
  runSicMultiPass,
  SIC_MIN_PEAK_DB,
  SIC_MAX_CANDIDATES,
} from '../src/dsp/realReceiver.ts';
import { createSeededRandom } from '../src/dsp/seededRandom.ts';
import { synthesizeFrameSamples } from '../src/dsp/z30Waveform.ts';

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

function identical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Sample mean, computed from the array rather than assumed. */
function mean(xs) {
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) total += xs[i];
  return total / xs.length;
}

/** Sample variance about the measured mean. */
function variance(xs) {
  const mu = mean(xs);
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) total += (xs[i] - mu) * (xs[i] - mu);
  return total / (xs.length - 1);
}

const SAMPLE_RATE = 12000;
// A real z-30 waveform, not a synthetic stand-in, so the function under test sees what it sees
// in production. Symbols derived arithmetically so the vector is reproducible by inspection.
const SYMBOLS = Array.from({ length: 75 }, (_, i) => (i * 7 + 3) % 16);
const CLEAN = synthesizeFrameSamples(SYMBOLS, 1500, SAMPLE_RATE);

// ------------------------------------------------------------------ D1: the B1 regression

group('addCalibratedAwgn is a function of its input (B1)');

{
  const a = addCalibratedAwgn(CLEAN, -20, SAMPLE_RATE);
  const b = addCalibratedAwgn(CLEAN, -20, SAMPLE_RATE);
  check('two calls with the same arguments produce identical samples', identical(a, b));
  check('...and the output is not simply the input echoed back', !identical(a, CLEAN));

  // A different SNR must give different noise, or "seeded" would have been achieved by
  // returning a constant.
  const c = addCalibratedAwgn(CLEAN, -14, SAMPLE_RATE);
  check('a different SNR gives a different realisation', !identical(a, c));

  // ...and so must a different signal, so every injected test signal is not handed the same
  // noise sequence.
  const otherSymbols = SYMBOLS.map((s) => (s + 1) % 16);
  const otherClean = synthesizeFrameSamples(otherSymbols, 1500, SAMPLE_RATE);
  const d = addCalibratedAwgn(otherClean, -20, SAMPLE_RATE);
  check('a different waveform gives a different realisation', !identical(a, d));
}

{
  // The seed derivation itself: same input, same seed; changed input, changed seed.
  const s1 = awgnSeedFromWaveform(CLEAN, -20);
  const s2 = awgnSeedFromWaveform(CLEAN, -20);
  const s3 = awgnSeedFromWaveform(CLEAN, -20.5);
  check('the derived seed is stable for one input', s1 === s2, `${s1} vs ${s2}`);
  check('...and moves when the SNR does', s1 !== s3);
  check('...and is a 32-bit unsigned value', Number.isInteger(s1) && s1 >= 0 && s1 <= 0xffffffff, String(s1));
}

{
  // An explicitly supplied source must be honoured - this is the parameter benchmark.py's twin
  // threads through, and the path a seeded caller uses.
  const withSeedA = addCalibratedAwgn(CLEAN, -20, SAMPLE_RATE, createSeededRandom(12345));
  const withSeedB = addCalibratedAwgn(CLEAN, -20, SAMPLE_RATE, createSeededRandom(12345));
  const withSeedC = addCalibratedAwgn(CLEAN, -20, SAMPLE_RATE, createSeededRandom(54321));
  check('an explicit seed reproduces exactly', identical(withSeedA, withSeedB));
  check('...and a different explicit seed does not', !identical(withSeedA, withSeedC));
}

// ------------------------------------------------- D2: the noise is actually calibrated noise

group('the added noise has the power the SNR asks for');

{
  // Reproducibility is worthless if the generator stopped producing noise. The residual is
  // measured against the closed-form sigma the function documents, both computed here from the
  // arrays rather than quoted.
  const snrDb = -18;
  const noisy = addCalibratedAwgn(CLEAN, snrDb, SAMPLE_RATE);
  const residual = new Float32Array(CLEAN.length);
  for (let i = 0; i < CLEAN.length; i += 1) residual[i] = noisy[i] - CLEAN[i];

  const signalPower = mean(Array.from(CLEAN, (x) => x * x));
  const snrLinear = Math.pow(10, snrDb / 10);
  const bandwidthFactor = 5000.0 / SAMPLE_RATE;
  const expectedSigma = Math.sqrt(signalPower / (snrLinear * bandwidthFactor));

  const measuredSigma = Math.sqrt(variance(residual));
  const ratio = measuredSigma / expectedSigma;
  check(
    'the residual standard deviation matches the calibration formula',
    ratio > 0.97 && ratio < 1.03,
    `measured/expected = ${ratio.toFixed(4)}`
  );

  const measuredMean = mean(residual);
  check(
    'the noise is zero-mean to within sampling error',
    Math.abs(measuredMean) < 4 * (measuredSigma / Math.sqrt(residual.length)),
    `mean ${measuredMean.toExponential(3)}, sigma ${measuredSigma.toExponential(3)}`
  );

  // A Box-Muller pair bug (writing only cosines, say) shows up as a variance that is right but
  // a distribution that is not. Roughly 68% of samples inside one sigma is the Gaussian
  // signature, counted here rather than assumed.
  let within = 0;
  for (let i = 0; i < residual.length; i += 1) if (Math.abs(residual[i] - measuredMean) <= measuredSigma) within += 1;
  const fraction = within / residual.length;
  check(
    'the residual is Gaussian-shaped (~68% within one sigma)',
    fraction > 0.64 && fraction < 0.72,
    `${(fraction * 100).toFixed(1)}%`
  );
}

// --------------------------------------------------------- D3: the SIC detector is seedless

group('the SIC candidate detector is deterministic and shares its constants (B2)');

{
  const noisy = addCalibratedAwgn(CLEAN, -10, SAMPLE_RATE);
  const first = findCandidates(noisy, SAMPLE_RATE);
  const second = findCandidates(noisy, SAMPLE_RATE);
  check(
    'the same buffer yields the same candidate list',
    first.length === second.length && first.every((c, i) => c.freqHz === second[i].freqHz && c.peakDb === second[i].peakDb),
    `${first.length} vs ${second.length}`
  );
  check('a real signal is found at all', first.length > 0);
  check(
    'the strongest candidate lands on the injected carrier',
    first.length > 0 && Math.abs(first[0].freqHz - 1500) <= 50,
    first.length > 0 ? String(first[0].freqHz) : 'none'
  );
  check(
    'the candidate list respects its own cap',
    first.length <= SIC_MAX_CANDIDATES,
    String(first.length)
  );
  check(
    'every returned candidate clears the documented threshold',
    first.every((c) => c.peakDb >= c.noiseFloorDb + SIC_MIN_PEAK_DB),
    JSON.stringify(first.slice(0, 3))
  );
}

{
  // Pure noise must not produce a confident carrier. This is the property the Bartlett
  // averaging exists for: on raw fine bins, the largest of ~10^5 noise bins clears a fixed
  // "X dB over the median" test routinely.
  const rng = createSeededRandom(0xbeef);
  const noiseOnly = new Float32Array(CLEAN.length);
  for (let i = 0; i < noiseOnly.length; i += 1) noiseOnly[i] = rng.normal() * 0.1;
  const spurious = findCandidates(noiseOnly, SAMPLE_RATE);
  check(
    'pure noise produces few or no candidates',
    spurious.length <= 3,
    `${spurious.length} candidates from noise alone`
  );
}

// ------------------------------------------- D4: the SIC residual floor is a real measurement

group('the SIC residual floor is measured off the buffer, not invented (B3)');

{
  // The SIC pass diagnostics used to carry `-14.2 - (pass - 1) * 14.3` - an arithmetic
  // progression shaped like a measurement. These checks derive their expectations from the
  // arrays under test, so a constant (or any formula ignoring the buffer) cannot satisfy them.
  const rng = createSeededRandom(0x51c);
  const noise = new Float32Array(CLEAN.length);
  for (let i = 0; i < noise.length; i += 1) noise[i] = rng.normal() * 0.05;

  const floorDb = measureNoiseFloorDb(noise, SAMPLE_RATE);
  check('a real buffer yields a finite measurement', Number.isFinite(floorDb), String(floorDb));

  // Scaling every sample by k raises a genuine power measurement by exactly 20*log10(k) dB.
  // The expectation comes from the scale factor applied to the data, not from a recorded value.
  const scale = 2;
  const louder = new Float32Array(noise.length);
  for (let i = 0; i < noise.length; i += 1) louder[i] = noise[i] * scale;
  const measuredShift = measureNoiseFloorDb(louder, SAMPLE_RATE) - floorDb;
  const expectedShift = 20 * Math.log10(scale);
  check(
    'scaling the buffer moves the measurement by exactly that scaling in dB',
    Math.abs(measuredShift - expectedShift) < 0.01,
    `expected ${expectedShift.toFixed(4)} dB, measured ${measuredShift.toFixed(4)} dB`
  );

  const quieter = new Float32Array(noise.length);
  for (let i = 0; i < noise.length; i += 1) quieter[i] = noise[i] * 0.25;
  check('a quieter buffer measures a lower floor', measureNoiseFloorDb(quieter, SAMPLE_RATE) < floorDb);

  check(
    'a buffer too short to measure reports null rather than a number',
    measureNoiseFloorDb(new Float32Array(16), SAMPLE_RATE) === null
  );
}

{
  // Nothing decodes out of pure noise, so pass 1 leaves the residual untouched - the floor it
  // reports must therefore equal an independent measurement of the very buffer it scanned.
  const rng = createSeededRandom(0xf100);
  const noise = new Float32Array(CLEAN.length);
  for (let i = 0; i < noise.length; i += 1) noise[i] = rng.normal() * 0.05;

  const result = runSicMultiPass(noise, SAMPLE_RATE, 3, 200, 3000, 1.5);
  check('the result reports the passes that ran', result.passes.length >= 1, JSON.stringify(result.passes));
  check('no frame decodes out of pure noise', result.frames.length === 0, String(result.frames.length));
  check(
    'pass 1 reports the measured floor of the buffer it scanned',
    result.passes[0].residualFloorDb === measureNoiseFloorDb(noise, SAMPLE_RATE),
    `${result.passes[0].residualFloorDb} vs ${measureNoiseFloorDb(noise, SAMPLE_RATE)}`
  );

  const reproducesWithdrawn = result.passes.some(
    (p, i) => p.residualFloorDb !== null && Math.abs(p.residualFloorDb - (-14.2 - i * 14.3)) < 1e-9
  );
  check('no pass reports the withdrawn hardcoded progression', !reproducesWithdrawn, JSON.stringify(result.passes));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll DSP determinism checks passed.');
