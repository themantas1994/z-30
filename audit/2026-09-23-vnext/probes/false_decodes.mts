// Run: npx tsx audit/2026-09-23-vnext/probes/false_decodes.mts <trials> <seed> 1   (report: 2500 trials x seeds 11-14)
// Probe: how often does the SHIPPED decoder (realReceiver.demodulateReal -> ldpcCodec.decodeMinSum,
// plus apDecode.decodeWithAp) report a CRC-valid decode from pure noise?
//
// Each trial is one candidate the live receiver would hand to the decoder: 24 s of Gaussian noise
// at the live DSP rate (6 kHz), demodulated at a random tone-0 frequency with the MAD sigma
// estimate the receiver uses. Successes are split by the stage that accepted them, identified
// from the iteration count: 150 iterations = every schedule exhausted = OSD post-processing.
import { demodulateReal, estimateSigma } from '../../../src/dsp/realReceiver.ts';
import { ldpcCodec } from '../../../src/dsp/ldpcCodec.ts';
import { buildApHypotheses, decodeWithAp } from '../../../src/dsp/apDecode.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';
import { unpackZ30Message } from '../../../src/dsp/z30Codec.ts';

const FS = 6000;
const N = 75 * Math.round(FS * 0.32);
const trials = Number(process.argv[2] ?? 200);
const seed = Number(process.argv[3] ?? 7);
const withAp = (process.argv[4] ?? '1') === '1';
const rng = createSeededRandom(seed);

const apCtx = {
  stage: 'SENDING_REPORT' as const,
  myCall: 'W1AW',
  dxCall: 'K1ABC',
  cqToken: 'CQ',
  rxFreqHz: 1500,
  txFreqHz: 1500,
};

let ordinaryOk = 0, ordinaryOsd = 0, ordinaryBp = 0, ordinaryRaw = 0;
let apOk = 0;
const apByType: Record<string, number> = {};
const times: number[] = [];
const apTimes: number[] = [];
const examples: string[] = [];
const buf = new Float32Array(N);
for (let t = 0; t < trials; t++) {
  for (let i = 0; i < N; i++) buf[i] = rng.normal();
  const f0 = 400 + rng.next() * 2000;
  const sigma = estimateSigma(buf);
  const llrs = demodulateReal(buf, FS, f0, sigma);
  const t0 = performance.now();
  const r = ldpcCodec.decodeMinSum(llrs);
  times.push(performance.now() - t0);
  if (r.success && r.crcValid) {
    ordinaryOk++;
    if (r.iterations === 1) ordinaryRaw++;
    else if (r.iterations >= 150) ordinaryOsd++;
    else ordinaryBp++;
    if (examples.length < 8) examples.push(`ordinary it=${r.iterations}: ${unpackZ30Message(r.infoBits).rawText}`);
  }
  if (withAp) {
    // The live receiver hands a failed ordinary decode to the ladder; candidate at the worked freq.
    const hyps = buildApHypotheses(apCtx, 1500);
    const t1 = performance.now();
    const o = decodeWithAp(llrs, hyps);
    apTimes.push(performance.now() - t1);
    if (o.result.success && o.result.crcValid && o.apType > 0) {
      apOk++;
      apByType[o.apLabel] = (apByType[o.apLabel] ?? 0) + 1;
      if (examples.length < 16) examples.push(`AP a${o.apType} it=${o.result.iterations}: ${unpackZ30Message(o.result.infoBits).rawText}`);
    }
  }
}
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(JSON.stringify({
  seed, trials,
  ordinary: { falseDecodes: ordinaryOk, viaOsd: ordinaryOsd, viaBpOrTrellis: ordinaryBp, viaRawHard: ordinaryRaw },
  ap: withAp ? { falseDecodes: apOk, byType: apByType } : null,
  decodeMs: { mean: times.reduce((a, b) => a + b, 0) / times.length, p50: pct(times, 0.5), p99: pct(times, 0.99), max: Math.max(...times) },
  apDecodeMs: withAp ? { mean: apTimes.reduce((a, b) => a + b, 0) / apTimes.length, p99: pct(apTimes, 0.99), max: Math.max(...apTimes) } : null,
  examples,
}));
