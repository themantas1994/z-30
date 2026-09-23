// Run: npx tsx audit/2026-09-23-vnext/probes/freq_snapping.mts
// Why does the shipped chain lose ~30% of frames even at -10 dB when the candidate IS detected?
// Measures the tone-0 frequency error after each shipped acquisition stage, from the candidate
// the detector actually returned, and whether that frame then decodes.
import { findCandidates, refineTimingAndFreq, refineFineFrequency, estimateSigma, demodulateReal } from '../../../src/dsp/realReceiver.ts';
import { ldpcCodec } from '../../../src/dsp/ldpcCodec.ts';
import { packZ30Message } from '../../../src/dsp/z30Codec.ts';
import { synthesizeFrameSamples } from '../../../src/dsp/z30Waveform.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';
const FS = 6000, L = 27 * FS, rng = createSeededRandom(31337);
const buckets: Record<string, [number, number]> = {};
for (let t = 0; t < 40; t++) {
  const msg = packZ30Message('CQ K1ABC FN31');
  const f0 = 400 + rng.next() * 2000, dt = (rng.next() * 2 - 1) * 0.5;
  const clean = synthesizeFrameSamples(msg.symbols, f0, FS, 0.5);
  let p = 0; for (const s of clean) p += s * s; p /= clean.length;
  const sigma = Math.sqrt(p / (Math.pow(10, -10 / 10) * (5000 / FS)));
  const buf = new Float32Array(L); for (let i = 0; i < L; i++) buf[i] = sigma * rng.normal();
  const st = Math.round((1.5 + dt) * FS); for (let i = 0; i < clean.length; i++) buf[st + i] += clean[i];
  const c = findCandidates(buf, FS).find((x) => x.freqHz >= f0 - 4 && x.freqHz <= f0 + 54);
  if (!c) continue;
  const r = refineTimingAndFreq(buf, FS, c.freqHz, 1.5);
  const view = buf.subarray(r.frameStartSample, r.frameStartSample + 75 * 1920);
  const ff = refineFineFrequency(view, FS, r.baseFreqHz);
  const ok = ldpcCodec.decodeMinSum(demodulateReal(view, FS, ff, estimateSigma(view))).success;
  const coarseErr = Math.abs(r.baseFreqHz - f0);
  const key = coarseErr < 0.78 ? '|coarse err| < 0.78 Hz' : '|coarse err| >= 0.78 Hz';
  buckets[key] = buckets[key] ?? [0, 0]; buckets[key][0]++; if (ok) buckets[key][1]++;
  console.log(JSON.stringify({ f0: +f0.toFixed(2), coarseErrHz: +(r.baseFreqHz - f0).toFixed(3), fineErrHz: +(ff - f0).toFixed(3), timingErrMs: Math.round((r.frameStartSample - st) / FS * 1000), decoded: ok }));
}
console.log('SUMMARY (frames, decoded):', JSON.stringify(buckets));
