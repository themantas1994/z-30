// Run: npx tsx audit/2026-09-23-vnext/probes/acquisition_timing.mts
import { findCandidates, refineTimingAndFreq, refineFineFrequency } from '../../../src/dsp/realReceiver.ts';
import { packZ30Message } from '../../../src/dsp/z30Codec.ts';
import { synthesizeFrameSamples } from '../../../src/dsp/z30Waveform.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';
for (const FS of [6000, 12000]) {
  const rng = createSeededRandom(3);
  const L = Math.round(27 * FS), buf = new Float32Array(L);
  for (let i = 0; i < L; i++) buf[i] = rng.normal();
  const clean = synthesizeFrameSamples(packZ30Message('CQ K1ABC FN31').symbols, 1250, FS, 3.0);
  const st = Math.round(1.7 * FS); for (let i = 0; i < clean.length; i++) buf[st + i] += clean[i];
  let t0 = performance.now(); const c = findCandidates(buf, FS); const tFind = performance.now() - t0;
  t0 = performance.now(); const r = refineTimingAndFreq(buf, FS, c[0]?.freqHz ?? 1270, 1.5); const tRef = performance.now() - t0;
  const view = buf.subarray(r.frameStartSample, r.frameStartSample + 75 * Math.round(FS * 0.32));
  t0 = performance.now(); refineFineFrequency(view, FS, r.baseFreqHz); const tFine = performance.now() - t0;
  console.log(`TS fs=${FS}: findCandidates ${tFind.toFixed(0)} ms (${c.length} cands) | refineTimingAndFreq per candidate ${tRef.toFixed(0)} ms | refineFineFrequency ${tFine.toFixed(0)} ms`);
}
