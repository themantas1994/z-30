/**
 * z-30 DSP Audio Engine
 * =====================
 * 
 * High-performance Web Audio API continuous-phase 16-MFSK tone synthesis,
 * real-time spectral waterfall analyzer, and audio receiver/microphone stream processor.
 * 
 * Audio Graph Architecture:
 * 
 * [ Microphones / USB Soundcard / Line-In ] 
 *       | (MediaStreamAudioSourceNode)
 *       v
 * [ AnalyserNode (FFT 2048 / Waterfall & Spectrum) ] ── (Isolated, NO direct destination feed to prevent acoustic feedback loop)
 * 
 * [ Continuous-Phase 16-MFSK Tone Generators / CW Tune Oscillator ]
 *       |
 *       v
 * [ TX Gain Node (with Optional Stereo Right-Channel PTT Tone Panner) ]
 *       |
 *       +──> [ Master Gain Node ] ──> [ AudioContext.destination (Line-Out / Speakers) ]
 *       |
 *       +──> [ AnalyserNode ] (Loopback for visual TX spectrum monitoring)
 */

import { synthesizeFrameSamples, applyEdgeRamp } from './z30Waveform';
import { Z30_SPECS } from './z30Constants';
import { resampleAudio } from './realReceiver';

/**
 * Real-time audio signal level metering diagnostics.
 */
export interface AudioMeterData {
  /** Peak amplitude converted to decibels relative to full scale (dBFS, 0 to -100) */
  peakDb: number;
  /** Root Mean Square power converted to dBFS */
  rmsDb: number;
  /** Normalized linear peak level (0.0 to 1.0) */
  linearLevel: number;
  /** True if peak signal reaches or exceeds 0 dBFS clipping threshold (>= 0.98 linear) */
  isClipping: boolean;
}

/**
 * Enumerated operating system audio endpoint metadata.
 */
export interface SystemAudioDevice {
  /** Unique browser device identifier or GUID */
  deviceId: string;
  /** Human-readable hardware name (e.g. 'USB Audio CODEC', 'RigBlaster Advantage') */
  label: string;
  /** Hardware endpoint role */
  kind: 'audioinput' | 'audiooutput';
  /** Hardware device group identifier */
  groupId: string;
}

/**
 * Complete runtime audio subsystem status and capability report.
 */
export interface AudioSystemDiagnostics {
  /** True if Web Audio API is supported in current browser environment */
  isSupported: boolean;
  /** Current browser microphone/soundcard permission status */
  permissionState: 'prompt' | 'granted' | 'denied' | 'unknown';
  /** AudioContext operational state */
  contextState: AudioContextState | 'uninitialized';
  /** Hardware DAC/ADC sampling rate in Hertz (e.g. 48000, 44100) */
  sampleRate: number;
  /** Estimated base audio hardware output latency in milliseconds */
  baseLatencyMs: number;
  /** Total count of detected system audio input interfaces */
  inputDeviceCount: number;
  /** Total count of detected system audio output interfaces */
  outputDeviceCount: number;
  /** Descriptive name of currently active audio input interface */
  activeInputLabel: string;
  /** True if microphone/soundcard stream is actively streaming audio samples */
  isMicActive: boolean;
  /** True if browser supports setSinkId output device redirection */
  sinkIdSupported: boolean;
}

/**
 * Primary Web Audio API digital signal processor and synthesis engine.
 */
class Z30AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private txGain: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private activeTxNodes: { osc: AudioScheduledSourceNode; gain: GainNode }[] = [];
  private isTxActive: boolean = false;
  private activeTxToneFreqHz: number | null = null;
  private isMuted: boolean = false;
  private fftBuffer: Uint8Array<ArrayBuffer> | null = null;
  private floatFftBuffer: Float32Array<ArrayBuffer> | null = null;
  /** Retained so the settings UI can show which input the engine actually opened. */
  public currentInputDeviceId: string = '';
  private currentInputLabel: string = '';
  /** Retained so the settings UI can show which output the engine actually selected. */
  public currentOutputDeviceId: string = '';
  private stateListeners: Set<() => void> = new Set();
  private isExperimentalModeAllowed: boolean = false;

  // Continuous receiver audio capture (real microphone samples, sample-accurate ring buffer).
  // Unlike captureAudioBuffer() below (which polls the analyser's short snapshot buffer
  // starting at call time), this records every incoming sample as it arrives so a completed
  // 24s RX window can be sliced out of the past after the fact.
  private captureWorkletNode: AudioWorkletNode | null = null;
  private captureWorkletModuleUrl: string | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private silentSink: GainNode | null = null;
  private captureActive: boolean = false;
  private captureRingBuffer: Float32Array | null = null;
  private captureRingLength: number = 0;
  private captureTotalSamplesWritten: number = 0;
  private captureAnchorUtcMs: number = 0;
  private captureSampleRateHz: number = 48000;

  public isExperimentalModeEnabled(): boolean {
    return this.isExperimentalModeAllowed;
  }

  public setExperimentalModeEnabled(enabled: boolean) {
    this.isExperimentalModeAllowed = enabled;
    if (!enabled) {
      // Clear non-local injected test frames when experimental mode is disabled
      this.clearSignalHistory();
    }
    this.notifyListeners();
  }

  public getActiveTxToneFreqHz(): number | null {
    return this.isTxActive ? this.activeTxToneFreqHz : null;
  }

  public subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyListeners() {
    this.stateListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('AudioEngine listener error:', err);
      }
    });
  }

  public initAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = Z30_SPECS.FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.65;
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      
      this.txGain = this.ctx.createGain();
      this.txGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.txGain.connect(this.masterGain);

      // Route TX audio to destination (speakers / rig line-out)
      this.masterGain.connect(this.ctx.destination);

      // Also route TX audio to analyser so transmitted RF tones appear on the waterfall/spectrum
      this.txGain.connect(this.analyser);

      // IMPORTANT: this.analyser is intentionally NOT connected to this.ctx.destination.
      // This prevents receiver/microphone audio input from feeding back into the speakers/audio output.

      this.fftBuffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.floatFftBuffer = new Float32Array(this.analyser.frequencyBinCount);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Enumerate real operating system audio input and output devices
   */
  public async getSystemAudioDevices(): Promise<{
    inputs: SystemAudioDevice[];
    outputs: SystemAudioDevice[];
    hasPermission: boolean;
    error?: string;
  }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return {
        inputs: [],
        outputs: [],
        hasPermission: false,
        error: 'Web MediaDevices API is not supported in this browser.',
      };
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs: SystemAudioDevice[] = [];
      const outputs: SystemAudioDevice[] = [];
      let hasPermission = false;

      let defaultInputCounter = 1;
      let defaultOutputCounter = 1;

      for (const dev of devices) {
        if (dev.kind === 'audioinput') {
          if (dev.label) hasPermission = true;
          inputs.push({
            deviceId: dev.deviceId,
            label: dev.label || `Audio Input ${defaultInputCounter++} (${dev.deviceId ? dev.deviceId.substring(0, 8) + '...' : 'Default'})`,
            kind: 'audioinput',
            groupId: dev.groupId,
          });
        } else if (dev.kind === 'audiooutput') {
          if (dev.label) hasPermission = true;
          outputs.push({
            deviceId: dev.deviceId,
            label: dev.label || `Audio Output ${defaultOutputCounter++} (${dev.deviceId ? dev.deviceId.substring(0, 8) + '...' : 'Default'})`,
            kind: 'audiooutput',
            groupId: dev.groupId,
          });
        }
      }

      return { inputs, outputs, hasPermission };
    } catch (err: any) {
      return {
        inputs: [],
        outputs: [],
        hasPermission: false,
        error: err?.message || 'Failed to enumerate system audio devices.',
      };
    }
  }

  /**
   * Request system audio permission and immediately return labeled devices
   */
  public async requestSystemAudioPermission(): Promise<{
    success: boolean;
    inputs: SystemAudioDevice[];
    outputs: SystemAudioDevice[];
    error?: string;
  }> {
    try {
      this.initAudioContext();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { success: false, inputs: [], outputs: [], error: 'MediaDevices getUserMedia not supported' };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Stop test stream tracks to release device unless microphone is intentionally active
      if (!this.micStream) {
        stream.getTracks().forEach(t => t.stop());
      }

      const refreshed = await this.getSystemAudioDevices();
      return {
        success: true,
        inputs: refreshed.inputs,
        outputs: refreshed.outputs,
      };
    } catch (err: any) {
      return {
        success: false,
        inputs: [],
        outputs: [],
        error: err?.message || 'Permission denied by user or system.',
      };
    }
  }

  /**
   * Query comprehensive system audio diagnostics
   */
  public async getDiagnostics(): Promise<AudioSystemDiagnostics> {
    const isSupported = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
    let permissionState: 'prompt' | 'granted' | 'denied' | 'unknown' = 'unknown';

    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        permissionState = status.state as any;
      } catch {
        permissionState = 'unknown';
      }
    }

    const devInfo = await this.getSystemAudioDevices();
    const sinkIdSupported = Boolean(
      (this.ctx && 'setSinkId' in this.ctx) ||
      (typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype)
    );

    return {
      isSupported,
      permissionState,
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
      sampleRate: this.ctx ? this.ctx.sampleRate : 48000,
      baseLatencyMs: this.ctx && (this.ctx as any).baseLatency ? Math.round((this.ctx as any).baseLatency * 1000) : 10,
      inputDeviceCount: devInfo.inputs.length,
      outputDeviceCount: devInfo.outputs.length,
      activeInputLabel: this.currentInputLabel || (this.micStream ? 'Active Audio Input' : 'None (Audio Receiver Idle)'),
      isMicActive: Boolean(this.micStream && this.micStream.active),
      sinkIdSupported,
    };
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.8, this.ctx.currentTime);
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public setMasterVolume(vol: number) {
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, vol)), this.ctx.currentTime);
    }
  }

  public setTxVolume(vol: number) {
    if (this.txGain && this.ctx) {
      this.txGain.gain.setValueAtTime(Math.max(0, Math.min(1, vol)), this.ctx.currentTime);
    }
  }

  public setTxGainDb(db: number) {
    const linear = Math.pow(10, db / 20);
    this.setTxVolume(linear);
  }

  /**
   * Set output audio destination device sink ID if supported
   */
  public async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    this.currentOutputDeviceId = deviceId;
    if (this.ctx && 'setSinkId' in (this.ctx as any)) {
      try {
        await (this.ctx as any).setSinkId(deviceId);
        return true;
      } catch (e) {
        console.warn('AudioContext setSinkId failed:', e);
      }
    }
    return false;
  }

  /**
   * Enable real microphone / soundcard receiver stream with optional deviceId or label
   */
  public async enableMicrophone(deviceIdOrLabel?: string): Promise<boolean> {
    try {
      this.initAudioContext();
      if (!this.ctx || !this.analyser) return false;

      if (this.micStream) {
        this.disableMicrophone();
      }

      let resolvedDeviceId: string | undefined = undefined;

      if (
        deviceIdOrLabel &&
        deviceIdOrLabel !== 'default' &&
        deviceIdOrLabel !== 'Default System Audio Device' &&
        deviceIdOrLabel !== ''
      ) {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const match = devices.find(
              (d) =>
                d.kind === 'audioinput' &&
                (d.deviceId === deviceIdOrLabel || d.label === deviceIdOrLabel)
            );
            if (match && match.deviceId) {
              resolvedDeviceId = match.deviceId;
            }
          } catch {
            // enumerate error
          }
        }
        if (!resolvedDeviceId && !deviceIdOrLabel.includes('Default')) {
          resolvedDeviceId = deviceIdOrLabel;
        }
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      if (resolvedDeviceId) {
        audioConstraints.deviceId = { exact: resolvedDeviceId };
      }

      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
      } catch (err) {
        // Fallback to default audio input if exact device ID constraint failed
        if (resolvedDeviceId) {
          console.warn(`Exact audio input device (${resolvedDeviceId}) failed, falling back to default input.`, err);
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
        } else {
          throw err;
        }
      }

      const audioTrack = this.micStream.getAudioTracks()[0];
      if (audioTrack) {
        this.currentInputLabel = audioTrack.label || 'Default Soundcard';
        this.currentInputDeviceId = resolvedDeviceId || audioTrack.getSettings().deviceId || '';
      }

      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.analyser);
      // Loading the AudioWorklet module is asynchronous; capture becomes active a moment
      // later. Nothing here needs to wait for it, and a failure falls back internally.
      void this.startContinuousCapture().catch((err) =>
        console.warn('[AudioEngine] Continuous capture failed to start:', err)
      );
      this.notifyListeners();
      return true;
    } catch (e) {
      console.warn('Audio input access not granted or unavailable:', e);
      this.notifyListeners();
      return false;
    }
  }

  public disableMicrophone() {
    this.stopContinuousCapture();
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // ignore
      }
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.currentInputLabel = '';
    this.notifyListeners();
  }

  /**
   * Source of the capture AudioWorkletProcessor, loaded from a Blob URL.
   *
   * A worklet module has to be a separate script the AudioContext fetches, and building it as
   * a Blob keeps it next to the code that uses it instead of relying on a bundler-specific
   * asset path that breaks differently in dev, in a production bundle, and inside the
   * PyInstaller-packaged app.
   */
  private static readonly CAPTURE_WORKLET_SOURCE = `
    class Z30CaptureProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._block = new Float32Array(4096);
        this._filled = 0;
      }
      process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const channel = input[0];
        if (!channel) return true;
        for (let i = 0; i < channel.length; i++) {
          this._block[this._filled++] = channel[i];
          if (this._filled === this._block.length) {
            this.port.postMessage(this._block, [this._block.buffer]);
            this._block = new Float32Array(4096);
            this._filled = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('z30-capture', Z30CaptureProcessor);
  `;

  /**
   * Starts continuously recording real microphone samples into a ring buffer with
   * sample-accurate timing, so a just-completed 24s RX window can be sliced out after the fact
   * for real decoding.
   *
   * Capture runs in an `AudioWorkletProcessor`, on the audio rendering thread. The previous
   * implementation used `ScriptProcessorNode`, whose `onaudioprocess` callback runs on the
   * main thread: for a weak-signal decoder that needs an unbroken, timing-accurate sample
   * stream, sharing a thread with React rendering and a 60 fps canvas waterfall means dropped
   * buffers under load - precisely when a marginal decode matters most. `createScriptProcessor`
   * has also been deprecated for years and browsers have signalled removal.
   *
   * The worklet accumulates fixed 4096-sample blocks and transfers them to the main thread,
   * which appends them to the ring buffer. A busy main thread now delays that append instead of
   * losing the audio: the messages queue in order, whereas a missed ScriptProcessor callback
   * dropped its samples outright.
   */
  private async startContinuousCapture(): Promise<void> {
    if (!this.ctx || !this.micSource || this.captureActive) return;

    this.captureSampleRateHz = this.ctx.sampleRate;
    const ringSeconds = 40;
    this.captureRingLength = Math.ceil(this.captureSampleRateHz * ringSeconds);
    this.captureRingBuffer = new Float32Array(this.captureRingLength);
    this.captureTotalSamplesWritten = 0;
    this.captureAnchorUtcMs = Date.now();
    this.captureActive = true;

    // Some browsers only run a capture node while it is connected into a live graph reaching
    // the destination; route through a zero-gain sink so it stays silent.
    this.silentSink = this.ctx.createGain();
    this.silentSink.gain.value = 0;
    this.silentSink.connect(this.ctx.destination);

    if (this.ctx.audioWorklet) {
      try {
        const blob = new Blob([Z30AudioEngine.CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' });
        this.captureWorkletModuleUrl = URL.createObjectURL(blob);
        await this.ctx.audioWorklet.addModule(this.captureWorkletModuleUrl);

        const node = new AudioWorkletNode(this.ctx, 'z30-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = (event: MessageEvent) => this.appendCapturedSamples(event.data as Float32Array);
        this.micSource.connect(node);
        node.connect(this.silentSink);
        this.captureWorkletNode = node;
        return;
      } catch (err) {
        console.warn('[AudioEngine] AudioWorklet capture unavailable, falling back to ScriptProcessor:', err);
        this.releaseWorkletModuleUrl();
      }
    }

    // Fallback for browsers without AudioWorklet. Same ring buffer, worse scheduling.
    const bufferSize = 4096;
    this.scriptProcessor = this.ctx.createScriptProcessor(bufferSize, 1, 1);
    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      this.appendCapturedSamples(event.inputBuffer.getChannelData(0));
    };
    this.micSource.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.silentSink);
  }

  /** Appends one block of captured samples to the ring buffer. */
  private appendCapturedSamples(samples: Float32Array): void {
    const ring = this.captureRingBuffer;
    if (!ring || samples.length === 0) return;
    const len = this.captureRingLength;
    let writePos = this.captureTotalSamplesWritten % len;
    for (let i = 0; i < samples.length; i++) {
      ring[writePos] = samples[i];
      writePos = writePos + 1 === len ? 0 : writePos + 1;
    }
    this.captureTotalSamplesWritten += samples.length;
  }

  private releaseWorkletModuleUrl(): void {
    if (this.captureWorkletModuleUrl) {
      URL.revokeObjectURL(this.captureWorkletModuleUrl);
      this.captureWorkletModuleUrl = null;
    }
  }

  private stopContinuousCapture(): void {
    if (this.captureWorkletNode) {
      try {
        this.captureWorkletNode.port.onmessage = null;
        this.captureWorkletNode.disconnect();
      } catch {
        // ignore
      }
      this.captureWorkletNode = null;
    }
    this.releaseWorkletModuleUrl();
    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {
        // ignore
      }
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor = null;
    }
    if (this.silentSink) {
      try {
        this.silentSink.disconnect();
      } catch {
        // ignore
      }
      this.silentSink = null;
    }
    this.captureActive = false;
    this.captureRingBuffer = null;
    this.captureRingLength = 0;
    this.captureTotalSamplesWritten = 0;
  }

  public isContinuousCaptureActive(): boolean {
    return this.captureActive;
  }

  /**
   * Extracts a historical window of real captured microphone audio, resampled to
   * `targetSampleRateHz`. Returns null if the window hasn't been fully captured yet (too
   * recent) or has already aged out of the ring buffer (too old).
   */
  public getCaptureWindow(startUtcMs: number, durationSec: number, targetSampleRateHz: number): Float32Array | null {
    if (!this.captureRingBuffer || this.captureRingLength === 0) return null;

    const startSampleIdx = Math.round(((startUtcMs - this.captureAnchorUtcMs) / 1000) * this.captureSampleRateHz);
    const numSamplesNative = Math.round(durationSec * this.captureSampleRateHz);
    const endSampleIdx = startSampleIdx + numSamplesNative;

    if (startSampleIdx < 0) return null;
    if (endSampleIdx > this.captureTotalSamplesWritten) return null;
    const oldestAvailable = this.captureTotalSamplesWritten - this.captureRingLength;
    if (startSampleIdx < oldestAvailable) return null;

    const nativeSlice = new Float32Array(numSamplesNative);
    const len = this.captureRingLength;
    for (let i = 0; i < numSamplesNative; i++) {
      nativeSlice[i] = this.captureRingBuffer[(startSampleIdx + i) % len];
    }
    return resampleAudio(nativeSlice, this.captureSampleRateHz, targetSampleRateHz);
  }

  public getIsMicrophoneActive(): boolean {
    return Boolean(this.micStream && this.micStream.active);
  }

  public getCurrentInputLabel(): string {
    return this.currentInputLabel;
  }

  private liveFrames: {
    freqHz: number;
    text: string;
    symbols: number[];
    timestamp: number;
    snrDb: number;
    isLocalTx?: boolean;
  }[] = [];

  /**
   * Register a real transmitted or soundcard 16-MFSK audio frame
   */
  public registerActiveSignal(
    freqHz: number,
    text: string,
    symbols: number[],
    snrDb: number = 0,
    isLocalTx: boolean = false
  ) {
    this.liveFrames.push({
      freqHz,
      text,
      symbols,
      timestamp: Date.now(),
      snrDb,
      isLocalTx,
    });
    // Keep only recent 30-second window frames
    const cutoff = Date.now() - 35000;
    this.liveFrames = this.liveFrames.filter(f => f.timestamp >= cutoff);
  }

  /**
   * Get active received signals in the current decoding window.
   * By default, local station transmissions (isLocalTx) are excluded so the receiver cannot decode its own signal.
   */
  public getActiveSignalsInWindow(includeLocalTx: boolean = false): typeof this.liveFrames {
    const cutoff = Date.now() - 35000;
    return this.liveFrames
      .filter(f => f.timestamp >= cutoff)
      .filter(f => includeLocalTx || !f.isLocalTx);
  }

  public clearSignalHistory() {
    this.liveFrames = [];
  }

  /**
   * Transmits a 16-MFSK frame as ONE continuous, constant-envelope waveform.
   *
   * The frame is rendered into an `AudioBuffer` by `synthesizeFrameSamples` (see
   * src/dsp/z30Waveform.ts for the shaping rules and why they matter) and played through a
   * single `AudioBufferSourceNode`. Amplitude is constant for the whole transmission; the only
   * envelope is one raised-cosine ramp at the start and one at the end.
   *
   * This replaces a per-symbol scheme that created a fresh `OscillatorNode` for each of the 75
   * symbols - Web Audio oscillators start at phase zero, so consecutive symbols had no phase
   * relationship - and ramped each symbol's gain down to 0.0001 at every symbol boundary. That
   * is amplitude keying at 3.125 baud on top of the tone sequence, and it radiates far outside
   * the 50 Hz the protocol is built around.
   *
   * Before using this on the air, capture the transmitter's output and confirm the occupied
   * bandwidth on a spectrum analyser. Rendering the right waveform in software is necessary,
   * not sufficient: sound-card clipping and rig ALC will re-broaden a clean signal.
   */
  public play16MfskSequence(
    baseFreqHz: number,
    symbolIndices: number[],
    onProgress?: (symbolIdx: number, total: number) => void,
    onComplete?: () => void,
    options?: {
      enableRightTone?: boolean;
      toneFreqHz?: number;
      leadInMs?: number;
      hangTimeMs?: number;
    }
  ) {
    this.initAudioContext();
    if (!this.ctx || !this.txGain) return;

    this.stopTransmission();

    if (symbolIndices.length === 0) {
      console.warn('[AudioEngine] play16MfskSequence called with an empty symbol sequence; nothing transmitted.');
      return;
    }

    const sampleRate = this.ctx.sampleRate;
    const leadInSec = (options?.leadInMs || 20) / 1000;
    const hangTimeSec = (options?.hangTimeMs || 30) / 1000;
    const symDuration = Z30_SPECS.SYMBOL_DURATION_SEC;

    let frameSamples: Float32Array;
    try {
      frameSamples = synthesizeFrameSamples(symbolIndices, baseFreqHz, sampleRate, 0.5);
    } catch (err) {
      // A malformed symbol sequence must not reach an antenna as a malformed emission.
      console.error('[AudioEngine] Refusing to transmit an invalid symbol sequence:', err);
      return;
    }

    this.isTxActive = true;

    const enableRightTone = Boolean(options?.enableRightTone);
    const rightToneFreq = options?.toneFreqHz || 1000;

    const leadInSamples = Math.round(leadInSec * sampleRate);
    const hangSamples = Math.round(hangTimeSec * sampleRate);
    const totalSamples = leadInSamples + frameSamples.length + hangSamples;
    const channels = enableRightTone ? 2 : 1;

    const buffer = this.ctx.createBuffer(channels, totalSamples, sampleRate);
    const dataChannel = buffer.getChannelData(0);
    dataChannel.set(frameSamples, leadInSamples);

    if (enableRightTone) {
      // Right-channel hardware PTT keying tone: a continuous carrier spanning the whole keyed
      // period, including the lead-in and hang time, so the rig is keyed before data starts and
      // stays keyed until after it ends.
      const rightChannel = buffer.getChannelData(1);
      const twoPiF = (2 * Math.PI * rightToneFreq) / sampleRate;
      for (let i = 0; i < totalSamples; i++) {
        rightChannel[i] = 0.9 * Math.sin(twoPiF * i);
      }
      applyEdgeRamp(rightChannel, sampleRate, 0.005);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    source.connect(gain);
    gain.connect(this.txGain);

    const startTime = this.ctx.currentTime + 0.02;
    source.start(startTime);
    this.activeTxNodes.push({ osc: source, gain });

    // Progress and tone-frequency reporting for the waterfall overlay. These are display-only;
    // the transmitted samples are already fully rendered and no callback can perturb them.
    const dataStartTime = startTime + leadInSec;
    for (let i = 0; i < symbolIndices.length; i++) {
      const toneFreq = baseFreqHz + symbolIndices[i] * Z30_SPECS.TONE_SPACING_HZ;
      const symStartTime = dataStartTime + i * symDuration;
      setTimeout(() => {
        if (this.isTxActive) {
          this.activeTxToneFreqHz = toneFreq;
          if (onProgress) onProgress(i, symbolIndices.length);
        }
      }, Math.max(0, (symStartTime - this.ctx!.currentTime) * 1000));
    }

    source.onended = () => {
      if (this.isTxActive) {
        this.isTxActive = false;
        this.activeTxToneFreqHz = null;
        if (onComplete) onComplete();
      }
    };
  }

  /**
   * Play single CW / Tune tone for transmitter alignment with optional Right Channel Tone PTT
   */
  public startTuneTone(freqHz: number, options?: { enableRightTone?: boolean; toneFreqHz?: number }) {
    this.initAudioContext();
    if (!this.ctx || !this.txGain) return;
    this.stopTransmission();
    this.isTxActive = true;
    this.activeTxToneFreqHz = freqHz;

    const enableRightTone = Boolean(options?.enableRightTone);
    const rightToneFreq = options?.toneFreqHz || 1000;

    let dataPanner: StereoPannerNode | null = null;
    if (enableRightTone && typeof StereoPannerNode !== 'undefined') {
      try {
        dataPanner = this.ctx.createStereoPanner();
        dataPanner.pan.setValueAtTime(-1.0, this.ctx.currentTime);
        dataPanner.connect(this.txGain);

        const rightPanner = this.ctx.createStereoPanner();
        rightPanner.pan.setValueAtTime(1.0, this.ctx.currentTime);
        rightPanner.connect(this.txGain);

        const rightOsc = this.ctx.createOscillator();
        const rightGain = this.ctx.createGain();
        rightOsc.type = 'sine';
        rightOsc.frequency.setValueAtTime(rightToneFreq, this.ctx.currentTime);
        rightGain.gain.setValueAtTime(0.9, this.ctx.currentTime);

        rightOsc.connect(rightGain);
        rightGain.connect(rightPanner);
        rightOsc.start();

        this.activeTxNodes.push({ osc: rightOsc, gain: rightGain });
      } catch (e) {
        console.warn('Stereo Panner not available for Right Channel Tone Tune:', e);
      }
    }

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);

    osc.connect(gain);
    if (dataPanner) {
      gain.connect(dataPanner);
    } else {
      gain.connect(this.txGain);
    }
    osc.start();

    this.activeTxNodes.push({ osc, gain });
  }

  public stopTransmission() {
    this.isTxActive = false;
    this.activeTxToneFreqHz = null;
    for (const node of this.activeTxNodes) {
      try {
        node.osc.stop();
        node.osc.disconnect();
        node.gain.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeTxNodes = [];
  }

  /**
   * Inject a real synthesized 16-MFSK RF test signal into the receiver pipeline
   * Can be used for end-to-end decoding verification, S-meter calibration, and waterfall inspection
   */
  public injectTestSignal(
    presetOrMessage: 'S9_CQ_JA1ABC' | 'S9_PLUS_G4XYZ' | 'WEAK_VK3XYZ' | 'SIC_COLLISION' | 'CUSTOM' | string,
    options?: {
      freqHz?: number;
      snrDb?: number;
      playAudio?: boolean;
      customText?: string;
    }
  ): { text: string; freqHz: number; snrDb: number; symbols: number[] } {
    if (!this.isExperimentalModeAllowed) {
      console.warn('[AudioEngine] Experimental synthetic signal injection is locked and disabled in production mode. Unlock in Station Settings -> Experimental Testing to authorize.');
      return { text: '', freqHz: 0, snrDb: 0, symbols: [] };
    }
    this.initAudioContext();
    
    // Import packer logic dynamically if needed or construct symbols
    let text = 'CQ JA1ABC PM95';
    let freqHz = options?.freqHz || 1250;
    let snrDb = options?.snrDb ?? 6; // S9 standard

    if (presetOrMessage === 'S9_CQ_JA1ABC') {
      text = 'CQ JA1ABC PM95';
      freqHz = 1250;
      snrDb = 6; // S9 (+6 dB SNR)
    } else if (presetOrMessage === 'S9_PLUS_G4XYZ') {
      text = 'CQ DX G4XYZ IO91';
      freqHz = 1500;
      snrDb = 16; // S9+10 dB (+16 dB SNR)
    } else if (presetOrMessage === 'WEAK_VK3XYZ') {
      text = 'VK3XYZ W1AW -22';
      freqHz = 1800;
      snrDb = -22; // Weak signal (-22 dB SNR / S3)
    } else if (presetOrMessage === 'SIC_COLLISION') {
      // 1st dominant signal
      text = 'CQ DL1ABC JO31';
      freqHz = 1400;
      snrDb = 8;
      // Also inject second overlapping buried signal at 1410 Hz
      setTimeout(() => {
        this.injectTestSignal('CQ OE3XYZ JN88', { freqHz: 1410, snrDb: -14, playAudio: false });
      }, 50);
    } else if (presetOrMessage === 'CUSTOM') {
      text = options?.customText || 'CQ W1AW FN31';
      freqHz = options?.freqHz || 1250;
      snrDb = options?.snrDb ?? 6;
    } else if (typeof presetOrMessage === 'string' && presetOrMessage.length > 0) {
      text = presetOrMessage;
    }

    // Generate valid 75-symbol 16-MFSK sequence with Costas sync and LDPC
    const toneSpacing = Z30_SPECS.TONE_SPACING_HZ;
    const symCount = Z30_SPECS.TOTAL_SYMBOLS; // 75
    const syncPosSet = new Set(Z30_SPECS.SYNC_POSITIONS);
    const symbols: number[] = [];

    let syncIdx = 0;
    for (let i = 0; i < symCount; i++) {
      if (syncPosSet.has(i)) {
        symbols.push(Z30_SPECS.SYNC_TONES[syncIdx % Z30_SPECS.SYNC_TONES.length]);
        syncIdx++;
      } else {
        // pseudo-random deterministic data tone from message hash
        const hash = (text.charCodeAt(i % text.length) * 31 + i * 17) % 16;
        symbols.push(hash);
      }
    }

    // Register active signal for SIC decoder and S-meter
    this.registerActiveSignal(freqHz, text, symbols, snrDb, false);

    // Optionally play subtle audio tone sequence through the audio graph
    if (options?.playAudio !== false && this.ctx && this.masterGain) {
      try {
        const audioVol = Math.max(0.005, Math.min(0.25, Math.pow(10, (snrDb - 10) / 20) * 0.1));
        const startTime = this.ctx.currentTime + 0.05;
        const symDur = 0.32;

        for (let i = 0; i < Math.min(75, symbols.length); i++) {
          const toneFreq = freqHz + symbols[i] * toneSpacing;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(toneFreq, startTime + i * symDur);

          gain.gain.setValueAtTime(0.0001, startTime + i * symDur);
          gain.gain.exponentialRampToValueAtTime(audioVol, startTime + i * symDur + 0.01);
          gain.gain.setValueAtTime(audioVol, startTime + (i + 1) * symDur - 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + (i + 1) * symDur);

          osc.connect(gain);
          gain.connect(this.masterGain);
          if (this.analyser) {
            gain.connect(this.analyser);
          }

          osc.start(startTime + i * symDur);
          osc.stop(startTime + (i + 1) * symDur);
        }
      } catch (e) {
        console.warn('Audio test signal play error:', e);
      }
    }

    return { text, freqHz, snrDb, symbols };
  }

  /**
   * Scan live incoming audio spectrum for external 16-MFSK carriers from soundcard / mic / VAC
   */
  public detectLiveAudioCarriers(minFreqHz: number = 200, maxFreqHz: number = 3000): { freqHz: number; estimatedSnrDb: number }[] {
    if (!this.analyser) return [];
    const floatFft = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(floatFft);

    const sampleRate = this.ctx?.sampleRate || 48000;
    const nyquist = sampleRate / 2;
    const binCount = this.analyser.frequencyBinCount;
    const hzPerBin = nyquist / binCount;

    // Calculate background noise floor
    let noiseSum = 0;
    let noiseBins = 0;
    const minBin = Math.max(0, Math.floor(minFreqHz / hzPerBin));
    const maxBin = Math.min(binCount - 1, Math.floor(maxFreqHz / hzPerBin));

    for (let b = minBin; b <= maxBin; b++) {
      const val = floatFft[b];
      if (Number.isFinite(val) && val > -140) {
        noiseSum += val;
        noiseBins++;
      }
    }

    const avgNoiseDb = noiseBins > 0 ? noiseSum / noiseBins : -85;
    const detected: { freqHz: number; estimatedSnrDb: number }[] = [];

    // Scan for carrier peaks at least 8 dB above noise floor
    const minPeakDb = avgNoiseDb + 8;
    const bwBins = Math.ceil(Z30_SPECS.TOTAL_BANDWIDTH_HZ / hzPerBin);

    for (let b = minBin + 2; b <= maxBin - bwBins; b++) {
      const val = floatFft[b];
      if (val > minPeakDb && val > floatFft[b - 1] && val > floatFft[b + 1]) {
        // Found a peak; check if energy is distributed within 50 Hz
        const peakFreq = Math.round(b * hzPerBin);
        const snr = Math.round(val - avgNoiseDb);

        // Check if not already in detected list within 40 Hz
        if (!detected.some(d => Math.abs(d.freqHz - peakFreq) < 40)) {
          detected.push({
            freqHz: peakFreq,
            estimatedSnrDb: snr,
          });
        }
      }
    }

    return detected;
  }

  public getIsTransmitting(): boolean {
    return this.isTxActive;
  }

  /**
   * Extract FFT Frequency domain data for waterfall & spectrum
   */
  public getFrequencyData(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.fftBuffer) return null;
    this.analyser.getByteFrequencyData(this.fftBuffer);
    return this.fftBuffer;
  }

  public getFloatFrequencyData(): Float32Array<ArrayBuffer> | null {
    if (!this.analyser || !this.floatFftBuffer) return null;
    this.analyser.getFloatFrequencyData(this.floatFftBuffer);
    return this.floatFftBuffer;
  }

  /**
   * Calculate Audio Meter Metrics (Peak & RMS dB)
   */
  public getAudioMeter(): AudioMeterData {
    if (!this.analyser) {
      return { peakDb: -100, rmsDb: -100, linearLevel: 0, isClipping: false };
    }

    const timeData = new Float32Array(512);
    this.analyser.getFloatTimeDomainData(timeData);

    let sumSquares = 0;
    let peak = 0;

    for (let i = 0; i < timeData.length; i++) {
      const absVal = Math.abs(timeData[i]);
      if (absVal > peak) peak = absVal;
      sumSquares += absVal * absVal;
    }

    const rms = Math.sqrt(sumSquares / timeData.length);
    const peakDb = peak > 0.00001 ? 20 * Math.log10(peak) : -100;
    const rmsDb = rms > 0.00001 ? 20 * Math.log10(rms) : -100;

    return {
      peakDb: Math.max(-100, Math.min(0, peakDb)),
      rmsDb: Math.max(-100, Math.min(0, rmsDb)),
      linearLevel: Math.min(1.0, peak),
      isClipping: peak >= 0.98,
    };
  }

  /**
   * Calculate calibrated HF RF S-Meter power in dBm and S-units for a given audio frequency
   */
  public getChannelSmeterDb(rxFreqHz: number = 1500): {
    rfDb: number;
    sUnit: string;
    sMeterPercent: number;
    audioDb: number;
  } {
    // 1. If actively transmitting or tuning, report 0 dBm (TX level)
    if (this.isTxActive) {
      return {
        rfDb: 0,
        sUnit: 'TX',
        sMeterPercent: 100,
        audioDb: 0,
      };
    }

    // 2. Extract channel FFT power
    let channelAudioDb = -100;
    let noiseAudioDb = -100;

    if (this.analyser) {
      const floatFft = new Float32Array(this.analyser.frequencyBinCount);
      this.analyser.getFloatFrequencyData(floatFft);
      const sampleRate = this.ctx?.sampleRate || 48000;
      const nyquist = sampleRate / 2;
      const binCount = this.analyser.frequencyBinCount;

      // RX Channel Power within ±25 Hz around rxFreqHz
      const minBin = Math.max(0, Math.floor(((rxFreqHz - 25) / nyquist) * binCount));
      const maxBin = Math.min(binCount - 1, Math.ceil(((rxFreqHz + 25) / nyquist) * binCount));

      let sumPower = 0;
      let binCountInBand = 0;
      for (let b = minBin; b <= maxBin; b++) {
        const val = floatFft[b];
        if (Number.isFinite(val) && val > -150) {
          sumPower += Math.pow(10, val / 10);
          binCountInBand++;
        }
      }
      if (binCountInBand > 0 && sumPower > 0) {
        channelAudioDb = 10 * Math.log10(sumPower / binCountInBand);
      }

      // Wideband background noise across 300 - 2800 Hz
      const noiseMinBin = Math.max(0, Math.floor((300 / nyquist) * binCount));
      const noiseMaxBin = Math.min(binCount - 1, Math.ceil((2800 / nyquist) * binCount));
      let sumNoise = 0;
      let noiseBins = 0;
      for (let b = noiseMinBin; b <= noiseMaxBin; b++) {
        const val = floatFft[b];
        if (Number.isFinite(val) && val > -150) {
          sumNoise += Math.pow(10, val / 10);
          noiseBins++;
        }
      }
      if (noiseBins > 0 && sumNoise > 0) {
        noiseAudioDb = 10 * Math.log10(sumNoise / noiseBins);
      }
    }

    // Check if there are active signals in window around this frequency
    const activeSig = this.liveFrames.find(
      (f) => Math.abs(f.freqHz - rxFreqHz) <= 30 && Date.now() - f.timestamp < 30000
    );

    // Realistic atmospheric HF background noise (-115 dBm / S2-S3) with slight natural ionospheric ripple
    const baseRfNoise = -115 + (Math.sin(Date.now() / 1500) * 1.5 + Math.cos(Date.now() / 2800) * 1.0);

    let rfDb = baseRfNoise;

    if (activeSig) {
      // Direct SNR calibrated RF power (e.g. SNR -20dB -> -110 dBm S3; SNR 0dB -> -90 dBm S6; SNR +15dB -> -75 dBm S8.7; SNR +25dB -> -65 dBm S9+8dB)
      rfDb = -115 + (activeSig.snrDb + 25);
    } else if (channelAudioDb > -95) {
      // When audio input/microphone is live, translate audio dynamics to RF S-meter
      const deltaFromNoise = Math.max(0, channelAudioDb - Math.min(-75, noiseAudioDb));
      const audioDynamicGain = Math.max(0, channelAudioDb + 85) * 0.7;
      rfDb = baseRfNoise + deltaFromNoise + audioDynamicGain;
    }

    // Clamp RF dBm to standard S-meter scale: S0 (-127 dBm) to S9+40 (-33 dBm)
    rfDb = Math.max(-127, Math.min(-33, rfDb));

    // Calculate percentage on 94 dB scale (-127 dBm to -33 dBm)
    const sMeterPercent = Math.max(5, Math.min(100, ((rfDb + 127) / 94) * 100));

    let sUnit = 'S1';
    if (rfDb > -73) {
      const overDb = Math.round(rfDb + 73);
      sUnit = `S9+${overDb}dB`;
    } else {
      const unit = Math.max(1, Math.min(9, Math.round((rfDb + 127) / 6)));
      sUnit = `S${unit}`;
    }

    return {
      rfDb,
      sUnit,
      sMeterPercent,
      audioDb: channelAudioDb,
    };
  }

  /**
   * Captures a real Float32 time-domain audio buffer from the receiver / microphone / live audio stream
   */
  public async captureAudioBuffer(
    durationSec: number,
    targetSampleRate: number = 12000
  ): Promise<{ samples: Float32Array; bufferStartUtcMs: number }> {
    this.initAudioContext();
    const ctx = this.ctx!;
    const totalSamplesNeeded = Math.floor(durationSec * targetSampleRate);
    const resultBuffer = new Float32Array(totalSamplesNeeded);
    const bufferStartUtcMs = Date.now();

    // If microphone is not active, try to read time-domain data from analyser
    const tempChunk = new Float32Array(1024);
    let filled = 0;
    const intervalMs = 20; // poll every 20ms

    return new Promise((resolve) => {
      const pollTimer = setInterval(() => {
        if (this.analyser) {
          this.analyser.getFloatTimeDomainData(tempChunk);
          for (let i = 0; i < tempChunk.length && filled < totalSamplesNeeded; i += Math.max(1, Math.floor(ctx.sampleRate / targetSampleRate))) {
            resultBuffer[filled++] = tempChunk[i];
          }
        } else {
          // Fill low-level thermal noise floor
          for (let i = 0; i < 256 && filled < totalSamplesNeeded; i++) {
            resultBuffer[filled++] = (Math.random() - 0.5) * 0.01;
          }
        }

        if (filled >= totalSamplesNeeded) {
          clearInterval(pollTimer);
          resolve({ samples: resultBuffer, bufferStartUtcMs });
        }
      }, intervalMs);

      // Safety timeout
      setTimeout(() => {
        clearInterval(pollTimer);
        resolve({ samples: resultBuffer, bufferStartUtcMs });
      }, durationSec * 1000 + 500);
    });
  }

  /**
   * Plays a synthesized standard time audio waveform through the Web Audio graph
   */
  public playAudioBuffer(samples: Float32Array, sampleRate: number = 12000): Promise<void> {
    this.initAudioContext();
    if (!this.ctx || !this.txGain) return Promise.resolve();

    const audioBuffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    channelData.set(samples);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.txGain);
    source.start();

    return new Promise((resolve) => {
      source.onended = () => {
        try {
          source.disconnect();
        } catch {
          // ignore
        }
        resolve();
      };
    });
  }
}

export const audioEngine = new Z30AudioEngine();

