/**
 * Regression guard for a defect invisible without real audio hardware attached: on an output
 * device that only exposes one physical channel, Web Audio downmixes a 2-channel buffer by
 * summing L+R. The Right-Channel Audio PTT Tone method puts 16-MFSK data on the left channel and
 * a continuous, unmodulated keying tone (0.9 peak) on the right; summed onto a data channel
 * peaking at 0.5, the tone dominates the transmitted audio, so the radio radiates what looks like
 * a fixed tone at the keying frequency instead of the frame - exactly the class of hardware
 * (CM108 audio fobs, HT audio cables, SignaLink jumpers) this PTT method's own catalog entry
 * names as its targets.
 *
 * `Z30AudioEngine.supportsStereoOutput()` and the refusals in `play16MfskSequence()` and
 * `startTuneTone()` are meant to fail closed on that hardware rather than transmit it silently.
 * This test drives the real audioEngine module against a minimal fake AudioContext/destination -
 * everything a real browser would provide, with `maxChannelCount` set to what a mono or stereo
 * device would actually report - and asserts on samples the engine actually rendered, not on a
 * hardcoded expectation of what the fix should look like.
 *
 * Run with:  npx tsx tests/audioChannelSafety.test.mjs
 */

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

/**
 * A fake Web Audio graph node: records connect() targets and lets channelCount be read back,
 * which is all the engine's own logic actually depends on.
 */
function makeNode(extra = {}) {
  const node = {
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    connections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect() {},
    ...extra,
  };
  return node;
}

function makeFakeAudioContext({ maxChannelCount, sampleRate = 12000 } = {}) {
  const buffers = [];
  const oscillators = [];
  const sources = [];

  const destination = makeNode({ maxChannelCount });

  const ctx = {
    sampleRate,
    currentTime: 0,
    state: 'running',
    destination,
    resume() {},
    createGain() {
      return makeNode({ gain: { setValueAtTime() {} } });
    },
    createAnalyser() {
      return makeNode({ fftSize: 2048, frequencyBinCount: 1024 });
    },
    createStereoPanner() {
      return makeNode({ pan: { setValueAtTime() {} } });
    },
    createOscillator() {
      const osc = makeNode({ type: 'sine', frequency: { setValueAtTime() {} }, started: false, stopped: false });
      osc.start = () => { osc.started = true; };
      osc.stop = () => { osc.stopped = true; };
      oscillators.push(osc);
      return osc;
    },
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buf = { numberOfChannels: channels, length, sampleRate: rate, getChannelData: (i) => data[i] };
      buffers.push(buf);
      return buf;
    },
    createBufferSource() {
      const src = makeNode({ buffer: null, started: false, stopped: false, onended: null });
      src.start = () => { src.started = true; };
      src.stop = () => { src.stopped = true; if (src.onended) src.onended(); };
      sources.push(src);
      return src;
    },
  };

  return { ctx, buffers, oscillators, sources };
}

async function freshAudioEngine(fakeCtx) {
  // Each test needs its own module instance because Z30AudioEngine caches `this.ctx` for the
  // life of the module: import with a cache-busting query so a prior test's context can't leak.
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.AudioContext = function FakeAudioContext() {
    return fakeCtx;
  };
  const mod = await import(`../src/dsp/audioEngine.ts?probe=${Math.random()}`);
  return mod.audioEngine;
}

function peakAbs(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

function realSymbols() {
  // A real Costas+data symbol pattern (all zero data payload is still a valid, structurally
  // correct 75-symbol frame) so synthesizeFrameSamples() runs its normal path rather than
  // rejecting the input.
  const symbols = new Array(75).fill(0);
  return symbols;
}

async function run() {
  group('supportsStereoOutput reports what the destination actually offers');
  {
    const { ctx: monoCtx } = makeFakeAudioContext({ maxChannelCount: 1 });
    const monoEngine = await freshAudioEngine(monoCtx);
    check('a 1-channel destination is reported as not stereo-capable', monoEngine.supportsStereoOutput() === false);

    const { ctx: stereoCtx } = makeFakeAudioContext({ maxChannelCount: 2 });
    const stereoEngine = await freshAudioEngine(stereoCtx);
    check('a 2-channel destination is reported as stereo-capable', stereoEngine.supportsStereoOutput() === true);
  }

  group('play16MfskSequence refuses the right-channel tone on mono hardware');
  {
    const { ctx: monoCtx, buffers } = makeFakeAudioContext({ maxChannelCount: 1 });
    const engine = await freshAudioEngine(monoCtx);
    const started = engine.play16MfskSequence(1250, realSymbols(), undefined, undefined, {
      enableRightTone: true,
      toneFreqHz: 1000,
    });
    check('the frame refuses to start', started === false);
    check('no buffer was ever handed to the sound card', buffers.length === 0);
  }

  group('play16MfskSequence still transmits real data on mono hardware when the tone is not requested');
  {
    const { ctx: monoCtx, buffers } = makeFakeAudioContext({ maxChannelCount: 1 });
    const engine = await freshAudioEngine(monoCtx);
    const started = engine.play16MfskSequence(1250, realSymbols(), undefined, undefined, {
      enableRightTone: false,
    });
    check('the frame starts', started === true);
    check('exactly one mono buffer was rendered', buffers.length === 1 && buffers[0].numberOfChannels === 1);
    const rendered = buffers[0].getChannelData(0);
    const peak = peakAbs(rendered);
    check('the rendered channel actually carries the modulated frame, not silence', peak > 0.1, `peak=${peak}`);
  }

  group('play16MfskSequence keeps working with the tone on genuinely stereo hardware');
  {
    const { ctx: stereoCtx, buffers } = makeFakeAudioContext({ maxChannelCount: 2 });
    const engine = await freshAudioEngine(stereoCtx);
    const started = engine.play16MfskSequence(1250, realSymbols(), undefined, undefined, {
      enableRightTone: true,
      toneFreqHz: 1000,
    });
    check('the frame starts', started === true);
    check('a 2-channel buffer was rendered', buffers.length === 1 && buffers[0].numberOfChannels === 2);
    const left = buffers[0].getChannelData(0);
    const right = buffers[0].getChannelData(1);
    const leftPeak = peakAbs(left);
    const rightPeak = peakAbs(right);
    check('the left (data) channel carries the frame', leftPeak > 0.1, `leftPeak=${leftPeak}`);
    check('the right (tone) channel carries the keying tone', rightPeak > 0.1, `rightPeak=${rightPeak}`);
  }

  group('startTuneTone refuses the right-channel tone on mono hardware');
  {
    const { ctx: monoCtx, oscillators } = makeFakeAudioContext({ maxChannelCount: 1 });
    const engine = await freshAudioEngine(monoCtx);
    const started = engine.startTuneTone(1250, { enableRightTone: true, toneFreqHz: 1000 });
    check('the tune carrier refuses to start', started === false);
    check('no oscillator was ever started', oscillators.every((o) => !o.started));
  }

  group('startTuneTone still tunes on mono hardware when the tone is not requested');
  {
    const { ctx: monoCtx, oscillators } = makeFakeAudioContext({ maxChannelCount: 1 });
    const engine = await freshAudioEngine(monoCtx);
    const started = engine.startTuneTone(1250, { enableRightTone: false });
    check('the tune carrier starts', started === true);
    check('exactly one oscillator was started', oscillators.filter((o) => o.started).length === 1);
  }

  console.log(failures === 0 ? '\nAll audio-channel safety checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
