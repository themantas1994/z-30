// Run: npx tsx audit/2026-09-23-vnext/poc/ts_corpus.mts <corpus dir written by make_corpus.py>
// TypeScript (V8) arm of the language PoC: the shipped decoder (ldpcCodec.decodeMinSum) and the
// shipped demodulator (realReceiver.demodulateReal) on the same corpus and test vector as the
// Python, Numba and Rust arms.
import { readFileSync } from 'node:fs';
import { ldpcCodec } from '../../../src/dsp/ldpcCodec.ts';
import { demodulateReal } from '../../../src/dsp/realReceiver.ts';

const dir = process.argv[2];
const raw = readFileSync(`${dir}/corpus.bin`);
const llrs = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const refs = readFileSync(`${dir}/corpus_ref.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const n = refs.length;
const stats = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return `n=${s.length} mean=${mean.toFixed(3)}ms p50=${s[Math.floor(s.length / 2)].toFixed(3)}ms p99=${s[Math.floor(0.99 * (s.length - 1))].toFixed(3)}ms max=${s[s.length - 1].toFixed(3)}ms`;
};
// Warm the JIT on a few frames first, as a long-running app would be.
for (let w = 0; w < 5; w++) ldpcCodec.decodeMinSum(llrs.subarray(w * 216, (w + 1) * 216));
let sameOk = 0, sameInfo = 0, sameIters = 0;
const tOk: number[] = [], tFail: number[] = [];
for (let f = 0; f < n; f++) {
  const v = llrs.subarray(f * 216, (f + 1) * 216);
  const t0 = performance.now();
  const r = ldpcCodec.decodeMinSum(v);
  const ms = performance.now() - t0;
  (r.success ? tOk : tFail).push(ms);
  const ok = r.success && r.crcValid;
  if (ok === (refs[f][0] === '1')) sameOk++;
  if (r.infoBits.join('') === refs[f][2]) sameInfo++;
  if (r.iterations === Number(refs[f][1])) sameIters++;
}
console.log(`TS LDPC agreement with Python reference: same_success=${sameOk} same_info=${sameInfo} same_iters=${sameIters} of ${n}`);
console.log(`TS LDPC success: ${stats(tOk)}`);
console.log(`TS LDPC failure: ${stats(tFail)}`);

const w = readFileSync(`${dir}/demod_wave.bin`);
const wave = new Float32Array(w.buffer, w.byteOffset, w.byteLength / 4);
const [fs, sigma, f0] = readFileSync(`${dir}/demod_meta.txt`, 'utf8').trim().split(/\s+/).map(Number);
const pyRaw = readFileSync(`${dir}/demod_llr_py.bin`);
const py = new Float32Array(pyRaw.buffer, pyRaw.byteOffset, pyRaw.byteLength / 4);
let out = demodulateReal(wave, fs, f0, sigma);
let maxDiff = 0;
for (let i = 0; i < 216; i++) maxDiff = Math.max(maxDiff, Math.abs(out[i] - py[i]));
const td: number[] = [];
for (let r = 0; r < 20; r++) { const t0 = performance.now(); out = demodulateReal(wave, fs, f0, sigma); td.push(performance.now() - t0); }
console.log(`TS DEMOD fs=${fs} max|LLR_ts - LLR_python| = ${maxDiff.toExponential(3)}  ${stats(td)}`);
