/**
 * z-30 Continuous-Phase 16-MFSK Waveform Generator
 * ================================================
 *
 * The browser-side twin of `z30_dsp/modem.py`. Both transmitters must emit the same signal,
 * so the shaping rules live in one place here rather than being re-derived inside the audio
 * graph.
 *
 * Two properties give the mode its 50 Hz occupied bandwidth, and both are load-bearing:
 *
 *   1. **Phase continuity.** One phase accumulator runs across the whole frame. A phase step at
 *      a symbol boundary is an impulse in frequency and radiates across the entire passband.
 *   2. **A constant amplitude envelope.** Full carrier from the first symbol to the last, with
 *      one raised-cosine ramp at the very start and end of the transmission and nowhere else.
 *
 * The previous browser transmitter violated both. It created a separate `OscillatorNode` per
 * symbol - and a Web Audio oscillator starts at phase zero when it is started, so consecutive
 * symbols had no phase relationship at all - then ramped each symbol's gain from 0.0001 up to
 * 0.5 and back down to 0.0001, taking the envelope to near-silence 3.125 times a second. That
 * is amplitude keying at the symbol rate laid over the tone sequence; its sidebands extend far
 * beyond 50 Hz regardless of how narrow the tone spacing is, and the phase discontinuities add
 * more on top. An ultra-narrow mode that splatters is a worse neighbour than the modes it means
 * to improve on.
 *
 * What is smoothed instead is the *frequency* transition between symbols, GFSK-style, exactly
 * as WSJT-X does: the piecewise-constant tone sequence is convolved with a Gaussian-shaped
 * frequency pulse before being integrated into phase.
 *
 * Verify before on-air use: capture the transmitter's audio output and confirm the occupied
 * bandwidth on a spectrum analyser. `tests/test_modem_spectrum.py` asserts the Python side
 * against a fixed budget; the two generators share these constants so they stay in step.
 */

import { Z30_SPECS } from './z30Constants';

/**
 * Gaussian frequency-pulse bandwidth-time product. Lower smooths tone transitions harder
 * (narrower spectrum, more inter-symbol interference); higher approaches unshaped CPFSK.
 * Must match `Z30Config.gfsk_bt` in z30_dsp/modem.py - the two transmitters have to emit the
 * same signal for the two halves of the app to decode each other.
 */
export const Z30_GFSK_BT = 2.0;

/** Raised-cosine ramp applied once at the start and end of a transmission - never per symbol. */
export const Z30_FRAME_RAMP_SEC = 0.02;

/**
 * Gaussian-smoothed rectangular frequency pulse, three symbols long.
 *
 * Copies spaced one symbol apart sum to exactly 1.0 across the interior of the frame, so the
 * instantaneous frequency sits on each symbol's tone at the centre of that symbol and slews
 * smoothly between them instead of stepping.
 */
export function gfskFrequencyPulse(bt: number, samplesPerSymbol: number): Float64Array {
  const n = 3 * samplesPerSymbol;
  const pulse = new Float64Array(n);
  const c = Math.PI * Math.sqrt(2.0 / Math.log(2.0));
  for (let i = 0; i < n; i++) {
    const t = (i - 1.5 * samplesPerSymbol) / samplesPerSymbol;
    pulse[i] = 0.5 * (erf(c * bt * (t + 0.5)) - erf(c * bt * (t - 0.5)));
  }
  return pulse;
}

/**
 * Abramowitz & Stegun 7.1.26 error-function approximation (|error| < 1.5e-7).
 * JavaScript has no Math.erf, and the pulse shape only needs single-precision accuracy.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Instantaneous frequency in Hz for every sample of the frame.
 *
 * The first and last symbols are extended one symbol period beyond the frame so the overlapping
 * pulses still sum to 1.0 at the edges; without that the frequency sags toward DC over the
 * first and last symbol, which is a chirp rather than a tone.
 */
export function instantaneousFrequency(
  symbolIndices: number[],
  baseFreqHz: number,
  samplesPerSymbol: number,
  toneSpacingHz: number,
  bt: number = Z30_GFSK_BT
): Float64Array {
  const nsym = symbolIndices.length;
  const pulse = gfskFrequencyPulse(bt, samplesPerSymbol);
  const extended = new Float64Array((nsym + 2) * samplesPerSymbol);

  const toneHz = (idx: number) => baseFreqHz + symbolIndices[idx] * toneSpacingHz;

  const firstHz = toneHz(0);
  for (let i = 0; i < 2 * samplesPerSymbol; i++) {
    extended[i] += firstHz * pulse[samplesPerSymbol + i];
  }
  for (let j = 0; j < nsym; j++) {
    const hz = toneHz(j);
    const start = j * samplesPerSymbol;
    for (let i = 0; i < pulse.length; i++) {
      extended[start + i] += hz * pulse[i];
    }
  }
  const lastHz = toneHz(nsym - 1);
  const tailStart = (nsym + 1) * samplesPerSymbol;
  for (let i = 0; i < samplesPerSymbol; i++) {
    extended[tailStart + i] += lastHz * pulse[i];
  }

  return extended.subarray(samplesPerSymbol, (nsym + 1) * samplesPerSymbol);
}

/**
 * Renders a complete frame as one continuous, constant-envelope waveform.
 *
 * @param symbolIndices - Tone indices, each 0..15.
 * @param baseFreqHz - Audio frequency of tone 0.
 * @param sampleRateHz - Output sample rate (the AudioContext's rate).
 * @param amplitude - Peak amplitude of the rendered carrier.
 * @returns Float32 samples covering exactly `symbolIndices.length` symbol periods.
 */
export function synthesizeFrameSamples(
  symbolIndices: number[],
  baseFreqHz: number,
  sampleRateHz: number,
  amplitude: number = 0.5
): Float32Array {
  if (symbolIndices.length === 0) {
    throw new Error('synthesizeFrameSamples: symbol sequence is empty');
  }
  for (const s of symbolIndices) {
    if (!Number.isInteger(s) || s < 0 || s >= Z30_SPECS.NUM_TONES) {
      throw new Error(`synthesizeFrameSamples: symbol index ${s} is outside 0..${Z30_SPECS.NUM_TONES - 1}`);
    }
  }
  if (!(baseFreqHz > 0) || !(sampleRateHz > 0)) {
    throw new Error('synthesizeFrameSamples: base frequency and sample rate must be positive');
  }

  const samplesPerSymbol = Math.round(sampleRateHz * Z30_SPECS.SYMBOL_DURATION_SEC);
  const freq = instantaneousFrequency(
    symbolIndices,
    baseFreqHz,
    samplesPerSymbol,
    Z30_SPECS.TONE_SPACING_HZ
  );

  const out = new Float32Array(freq.length);
  const twoPiOverFs = (2 * Math.PI) / sampleRateHz;
  let phase = 0;
  for (let i = 0; i < freq.length; i++) {
    phase += twoPiOverFs * freq[i];
    // Keep the accumulator bounded so single-precision rounding never creeps in over a 24 s
    // frame; the sine is unchanged by whole turns.
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    out[i] = amplitude * Math.sin(phase);
  }

  applyEdgeRamp(out, sampleRateHz);
  return out;
}

/**
 * Applies the single raised-cosine ramp at the start and end of a rendered transmission. This
 * is the only amplitude shaping in the whole signal path.
 */
export function applyEdgeRamp(samples: Float32Array, sampleRateHz: number, rampSec = Z30_FRAME_RAMP_SEC): void {
  const rampLen = Math.min(Math.round(rampSec * sampleRateHz), Math.floor(samples.length / 2));
  if (rampLen <= 0) return;
  for (let i = 0; i < rampLen; i++) {
    const w = 0.5 * (1 - Math.cos((Math.PI * i) / rampLen));
    samples[i] *= w;
    samples[samples.length - 1 - i] *= w;
  }
}
