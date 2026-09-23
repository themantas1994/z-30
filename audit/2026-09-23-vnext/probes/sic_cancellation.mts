// Run: npx tsx audit/2026-09-23-vnext/probes/sic_cancellation.mts
// Probe: how much of a decoded signal does the shipped SIC subtraction actually remove?
// Replays exactly the cancellation step of realReceiver.runSicMultiPass on a known frame
// (the frame's own symbols, so decoding is not in question) and measures the power left in the
// signal's 50 Hz band. Compared against a least-squares cancellation that fits the complex
// amplitude (gain AND carrier phase) of the correct, shipped GFSK waveform.
import {
  refineTimingAndFreq, refineFineFrequency, pilotAmplitude, synthesizeReplica,
} from '../../../src/dsp/realReceiver.ts';
import { packZ30Message } from '../../../src/dsp/z30Codec.ts';
import { instantaneousFrequency } from '../../../src/dsp/z30Waveform.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';

const FS = 6000, MAX_DT = 1.5, NSPS = 1920, FRAME = 75 * NSPS;
const L = Math.round((24 + 2 * MAX_DT) * FS);
const rng = createSeededRandom(4242);

/** Hann-windowed periodogram power summed over [lo, hi] Hz (radix-2 FFT, zero-padded). Relative measure. */
function bandPower(x: Float32Array, lo: number, hi: number): number {
  let n = 1; while (n < x.length) n <<= 1; n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len; const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const a = i + k, b = a + len / 2; const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
      re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  let tot = 0;
  for (let k = Math.floor((lo * n) / FS); k <= Math.ceil((hi * n) / FS); k++) tot += re[k] * re[k] + im[k] * im[k];
  return tot;
}

/** The shipped GFSK frame (z30Waveform's frequency trajectory) at an arbitrary carrier phase. */
function gfskFrame(symbols: number[], f0: number, phase0: number): { sin: Float64Array; cos: Float64Array } {
  const fr = instantaneousFrequency(symbols, f0, NSPS, 3.125);
  const s = new Float64Array(FRAME), c = new Float64Array(FRAME);
  let ph = 0;
  for (let i = 0; i < FRAME; i++) {
    ph += (2 * Math.PI * fr[i]) / FS;
    s[i] = Math.sin(ph + phase0);
    c[i] = Math.cos(ph + phase0);
  }
  return { sin: s, cos: c };
}

const db = (x: number) => Number((10 * Math.log10(x)).toFixed(1));
for (let trial = 0; trial < 8; trial++) {
  const msg = packZ30Message('CQ K1ABC FN31');
  const f0 = 800 + rng.next() * 1200;
  const dt = (rng.next() * 2 - 1) * 0.5;
  const phase0 = rng.next() * 2 * Math.PI; // a real channel's carrier phase is arbitrary

  const tx = gfskFrame(msg.symbols, f0, phase0).sin;
  const buf = new Float32Array(L);
  for (let i = 0; i < L; i++) buf[i] = 0.02 * rng.normal(); // strong signal: cancellation quality dominates
  const start = Math.round((MAX_DT + dt) * FS);
  for (let i = 0; i < FRAME; i++) buf[start + i] += tx[i];
  const before = bandPower(buf.subarray(start, start + FRAME), f0 - 3, f0 + 50);

  // Shipped cancellation, verbatim from runSicMultiPass (candidate given at a tone of the comb).
  const { frameStartSample, baseFreqHz } = refineTimingAndFreq(buf, FS, f0 + 7 * 3.125, MAX_DT);
  const view = buf.subarray(frameStartSample, frameStartSample + FRAME);
  const ff = refineFineFrequency(view, FS, baseFreqHz);
  const shipped = new Float32Array(buf);
  const synth = synthesizeReplica(msg.symbols, ff, FS);
  const amp = pilotAmplitude(view, FS, ff);
  for (let i = 0; i < synth.length; i++) shipped[frameStartSample + i] -= amp * synth[i];
  const afterShipped = bandPower(shipped.subarray(start, start + FRAME), f0 - 3, f0 + 50);

  // Reference: least-squares fit of gain and phase of the correct GFSK waveform at the same
  // estimated frequency and timing.
  const ref = gfskFrame(msg.symbols, ff, 0);
  let ss = 0, cc = 0, sc = 0, xs = 0, xc = 0;
  for (let i = 0; i < FRAME; i++) {
    const x = buf[frameStartSample + i];
    ss += ref.sin[i] ** 2; cc += ref.cos[i] ** 2; sc += ref.sin[i] * ref.cos[i];
    xs += x * ref.sin[i]; xc += x * ref.cos[i];
  }
  const det = ss * cc - sc * sc;
  const a = (xs * cc - xc * sc) / det, b = (xc * ss - xs * sc) / det;
  const ls = new Float32Array(buf);
  for (let i = 0; i < FRAME; i++) ls[frameStartSample + i] -= a * ref.sin[i] + b * ref.cos[i];
  const afterLs = bandPower(ls.subarray(start, start + FRAME), f0 - 3, f0 + 50);

  console.log(JSON.stringify({
    trial, carrierPhaseDeg: Math.round((phase0 * 180) / Math.PI),
    timingErrMs: Math.round(((frameStartSample - start) / FS) * 1000),
    freqErrHz: Number((ff - f0).toFixed(3)),
    shippedSuppressionDb: db(before / afterShipped),
    leastSquaresSuppressionDb: db(before / afterLs),
  }));
}
