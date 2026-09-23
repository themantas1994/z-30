// Run: npx tsx audit/2026-09-23-vnext/probes/shipped_threshold.mts <snr list, e.g. -24,-22,-20> <frames/point> <seed>
// Probe: the decode threshold of the receiver that SHIPS (realReceiver.runSicMultiPass), which
// neither benchmark engine exercises. Both benchmarks acquire with a Costas-correlation search
// told the carrier to within +/-12 Hz; the live receiver must first find the signal with
// findCandidates (tone-group energy >= SIC_MIN_PEAK_DB over the median) anywhere in 200-3000 Hz.
//
// Paired design: every buffer is decoded by two arms that share all code but one step.
//   SHIPPED  runSicMultiPass(buffer) - exactly what sicDecoder.runSicDecodeCycle calls.
//   GENIE    the same chain (refineTimingAndFreq -> refineFineFrequency -> estimateSigma ->
//            demodulateReal -> decodeMinSum) started from the TRUE tone-0 frequency, i.e. with
//            the candidate detector replaced by an oracle. The only difference is detection.
// Frames are synthesized with the shipped TX modulator (synthesizeFrameSamples) at the live DSP
// rate (6 kHz), calibrated AWGN in a 2500 Hz reference bandwidth, random tone-0 frequency in
// 400-2400 Hz and random timing offset in +/-0.5 s - the benchmark's own `realistic` model.
import {
  runSicMultiPass, findCandidates, refineTimingAndFreq, refineFineFrequency, estimateSigma, demodulateReal,
} from '../../../src/dsp/realReceiver.ts';
import { ldpcCodec } from '../../../src/dsp/ldpcCodec.ts';
import { packZ30Message } from '../../../src/dsp/z30Codec.ts';
import { synthesizeFrameSamples } from '../../../src/dsp/z30Waveform.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';

const FS = 6000;
const MAX_DT = 1.5;
const snrs = (process.argv[2] ?? '-22,-18').split(',').map(Number);
const framesPerPoint = Number(process.argv[3] ?? 20);
const seed = Number(process.argv[4] ?? 20260923);
const rng = createSeededRandom(seed);
const L = Math.round((24 + 2 * MAX_DT) * FS);
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randCall = () => 'K' + Math.floor(rng.next() * 10) + letters[Math.floor(rng.next() * 26)] + letters[Math.floor(rng.next() * 26)] + letters[Math.floor(rng.next() * 26)];

const out: any[] = [];
for (const snrDb of snrs) {
  let shipped = 0, genie = 0, detected = 0, falseShipped = 0, dupShipped = 0, onlyShipped = 0, onlyGenie = 0;
  const tShip: number[] = [];
  for (let f = 0; f < framesPerPoint; f++) {
    const msg = packZ30Message(`CQ ${randCall()} FN31`);
    const f0 = 400 + rng.next() * 2000;
    const dt = (rng.next() * 2 - 1) * 0.5;
    const clean = synthesizeFrameSamples(msg.symbols, f0, FS, 0.5);
    let p = 0; for (const s of clean) p += s * s; p /= clean.length;
    const sigma = Math.sqrt(p / (Math.pow(10, snrDb / 10) * (5000 / FS)));
    const buf = new Float32Array(L);
    const start = Math.round((MAX_DT + dt) * FS);
    for (let i = 0; i < L; i++) buf[i] = sigma * rng.normal();
    for (let i = 0; i < clean.length; i++) buf[start + i] += clean[i];
    const want = msg.symbols.join(',');

    // Does the candidate detector see it at all? (a candidate inside the signal's 50 Hz comb)
    const cands = findCandidates(buf, FS);
    if (cands.some((c) => c.freqHz >= f0 - 4 && c.freqHz <= f0 + 50 + 4)) detected++;

    const t0 = performance.now();
    const res = runSicMultiPass(buf, FS, 3, 200, 3000, MAX_DT);
    tShip.push(performance.now() - t0);
    const good = res.frames.filter((fr) => fr.rawSymbols.join(',') === want);
    const shippedOk = good.length > 0;
    if (shippedOk) shipped++;
    if (good.length > 1) dupShipped++;
    if (res.frames.some((fr) => fr.rawSymbols.join(',') !== want)) falseShipped++;

    // GENIE arm: identical chain from the true frequency.
    const { frameStartSample, baseFreqHz } = refineTimingAndFreq(buf, FS, f0, MAX_DT);
    const view = buf.subarray(frameStartSample, frameStartSample + 75 * 1920);
    const ff = refineFineFrequency(view, FS, baseFreqHz);
    const llrs = demodulateReal(view, FS, ff, estimateSigma(view));
    const r = ldpcCodec.decodeMinSum(llrs);
    const genieOk = r.success && r.crcValid && r.infoBits.join('') === msg.infoBits.join('');
    if (genieOk) genie++;
    if (shippedOk && !genieOk) onlyShipped++;
    if (genieOk && !shippedOk) onlyGenie++;
  }
  const s = [...tShip].sort((a, b) => a - b);
  out.push({ snrDb, frames: framesPerPoint, candidateDetected: detected, shippedDecoded: shipped, genieDecoded: genie,
    shippedDuplicates: dupShipped, shippedFalse: falseShipped, onlyShipped, onlyGenie,
    shippedMs: { p50: Math.round(s[Math.floor(s.length / 2)]), max: Math.round(s[s.length - 1]) } });
  console.log(JSON.stringify(out[out.length - 1]));
}

