// Run: npx tsx audit/2026-09-23-vnext/probes/live_rx_trigger.mts
// Probe: does the SHIPPED live receive path (App.tsx trigger -> sicDecoder.runSicDecodeCycle ->
// audioEngine.getCaptureWindow -> realReceiver.runSicMultiPass) ever get an audio window?
//
// Reproduces App.tsx's trigger timing exactly: the 100 ms interval fires executeDecodeCycle()
// once per cycle, the first time cycleSec >= 24.0. We populate the real audioEngine singleton's
// capture ring buffer as a live AudioWorklet would (48 kHz, 4096-sample blocks, samples arriving
// in real time) with noise plus one strong z-30 frame, then call runSicDecodeCycle at the moment
// App.tsx would, and again 1.6 s later.
import { audioEngine } from '../../../src/dsp/audioEngine.ts';
import { sicDecoderEngine } from '../../../src/dsp/sicDecoder.ts';
import { packZ30Message } from '../../../src/dsp/z30Codec.ts';
import { synthesizeFrameSamples } from '../../../src/dsp/z30Waveform.ts';
import { createSeededRandom } from '../../../src/dsp/seededRandom.ts';

const FS = 48000;
const BLOCK = 4096; // the worklet's transfer block
const rng = createSeededRandom(1234);

// Wall clock: capture started at an arbitrary UTC instant; the slot of interest starts 60 s later.
const captureStartMs = Date.UTC(2026, 8, 23, 12, 0, 5, 250);
const slotStartMs = Date.UTC(2026, 8, 23, 12, 1, 0, 0); // an even 30 s boundary
const frameDtSec = 0.2; // transmitter keyed 200 ms late: well inside the +/-1.5 s search

// Build 90 s of "air": noise + one frame, then feed it to the ring buffer only up to `now`.
const totalSec = 90;
const air = new Float32Array(totalSec * FS);
const noiseSigma = 0.05;
for (let i = 0; i < air.length; i++) air[i] = noiseSigma * rng.normal();
const msg = packZ30Message('CQ K1ABC FN42');
const frame = synthesizeFrameSamples(msg.symbols, 1500, FS, 0.5); // strong: ~0 dB SNR in 2500 Hz
const frameStart = Math.round(((slotStartMs - captureStartMs) / 1000 + frameDtSec) * FS);
for (let i = 0; i < frame.length; i++) air[frameStart + i] += frame[i];

function primeCapture(nowMs: number): void {
  const e = audioEngine as any;
  e.captureSampleRateHz = FS;
  e.captureRingLength = Math.ceil(FS * 40);
  e.captureRingBuffer = new Float32Array(e.captureRingLength);
  e.captureAnchorUtcMs = captureStartMs;
  e.captureActive = true;
  // Samples that have ARRIVED by `nowMs`: whole worklet blocks only.
  const arrived = Math.floor((((nowMs - captureStartMs) / 1000) * FS) / BLOCK) * BLOCK;
  e.captureTotalSamplesWritten = 0;
  for (let off = 0; off < arrived; off += BLOCK) {
    e.appendCapturedSamples(air.subarray(off, off + BLOCK));
  }
}

const realNow = Date.now;
for (const cycleSec of [24.05, 25.3, 25.65]) {
  const nowMs = slotStartMs + cycleSec * 1000;
  primeCapture(nowMs);
  Date.now = () => nowMs;
  const t0 = performance.now();
  const r = sicDecoderEngine.runSicDecodeCycle(14_080_000, 'W1AW', 'FN31', false, undefined, 0, undefined);
  const ms = performance.now() - t0;
  Date.now = realNow;
  console.log(
    `trigger at cycleSec=${cycleSec.toFixed(2)}s -> decodes=${r.decodes.length} ` +
      `[${r.decodes.map((d) => d.message).join(' | ')}] ` +
      `step0="${r.steps[0]?.description}" (${ms.toFixed(0)} ms)`
  );
}
