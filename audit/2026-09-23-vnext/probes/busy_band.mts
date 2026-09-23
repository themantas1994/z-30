// Run: npx tsx audit/2026-09-23-vnext/probes/busy_band.mts 1,5,10,20 2 99
// Probe: wall-clock cost and outcome of ONE live decode cycle (realReceiver.runSicMultiPass, the
// function sicDecoder.runSicDecodeCycle calls synchronously on the browser main thread) on a
// band with K simultaneous z-30 signals. The slot leaves 6.0 s between the end of the frame and
// the next slot's TX start; App.tsx's TX trigger only fires while cycleSec < 0.5.
//
// Also measures what SIC cancellation actually removes: the residual power in each decoded
// signal's 50 Hz band after runSicMultiPass subtracted it, relative to before.
import { runSicMultiPass } from '../../../src/dsp/realReceiver.ts';
import { packZ30Message } from '../../../src/dsp/z30Codec.ts';
import { synthesizeFrameSamples } from '../../../src/dsp/z30Waveform.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';

const FS = 6000, MAX_DT = 1.5;
const L = Math.round((24 + 2 * MAX_DT) * FS);
const ks = (process.argv[2] ?? '1,5,10').split(',').map(Number);
const trials = Number(process.argv[3] ?? 3);
const rng = createSeededRandom(Number(process.argv[4] ?? 99));
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randCall = () => 'W' + Math.floor(rng.next() * 10) + letters[Math.floor(rng.next() * 26)] + letters[Math.floor(rng.next() * 26)] + letters[Math.floor(rng.next() * 26)];

for (const K of ks) {
  for (let t = 0; t < trials; t++) {
    const noiseSigma = 1.0;
    const buf = new Float32Array(L);
    for (let i = 0; i < L; i++) buf[i] = noiseSigma * rng.normal();
    // K non-overlapping 50 Hz slots across 300-2700 Hz, SNR uniform in [-20, -5] dB (2500 Hz ref).
    const slots = Array.from({ length: 40 }, (_, i) => 300 + i * 60).sort(() => rng.next() - 0.5).slice(0, K);
    const sent: string[] = [];
    for (const f0 of slots) {
      const snrDb = -20 + rng.next() * 15;
      const msg = packZ30Message(`CQ ${randCall()} FN31`);
      const clean = synthesizeFrameSamples(msg.symbols, f0, FS, 1.0);
      let p = 0; for (const s of clean) p += s * s; p /= clean.length;
      // noise power in 2500 Hz is noiseSigma^2 * 2500/3000 at 6 kHz; scale the signal to hit snrDb
      const targetP = Math.pow(10, snrDb / 10) * noiseSigma * noiseSigma * (5000 / FS);
      const g = Math.sqrt(targetP / p);
      const start = Math.round((MAX_DT + (rng.next() * 2 - 1) * 0.5) * FS);
      for (let i = 0; i < clean.length; i++) buf[start + i] += g * clean[i];
      sent.push(msg.symbols.join(','));
    }
    const t0 = performance.now();
    const res = runSicMultiPass(buf, FS, 3, 200, 3000, MAX_DT);
    const ms = performance.now() - t0;
    const got = res.frames.map((f) => f.rawSymbols.join(','));
    const correct = new Set(got.filter((g) => sent.includes(g))).size;
    const dups = got.filter((g) => sent.includes(g)).length - correct;
    const falses = got.filter((g) => !sent.includes(g)).length;
    console.log(JSON.stringify({ K, trial: t, ms: Math.round(ms), uniqueCorrect: correct, duplicateDecodes: dups, falseDecodes: falses,
      passes: res.passes.map((p) => p.decodes) }));
  }
}
