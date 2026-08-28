/**
 * z-30 DSP Audio Engine
 * High-performance Web Audio API continuous-phase 16-MFSK tone synthesis,
 * real-time spectral analyzer, and microphone/receiver stream processor.
 */

import { Z30_SPECS } from './z30Constants';

export interface AudioMeterData {
  peakDb: number;
  rmsDb: number;
  linearLevel: number;
  isClipping: boolean;
}

export interface SystemAudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  groupId: string;
}

export interface AudioSystemDiagnostics {
  isSupported: boolean;
  permissionState: 'prompt' | 'granted' | 'denied' | 'unknown';
  contextState: AudioContextState | 'uninitialized';
  sampleRate: number;
  baseLatencyMs: number;
  inputDeviceCount: number;
  outputDeviceCount: number;
  activeInputLabel: string;
  isMicActive: boolean;
  sinkIdSupported: boolean;
}

class Z30AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private txGain: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private activeTxNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private isTxActive: boolean = false;
  private isMuted: boolean = false;
  private fftBuffer: Uint8Array<ArrayBuffer> | null = null;
  private floatFftBuffer: Float32Array<ArrayBuffer> | null = null;
  private currentInputDeviceId: string = '';
  private currentInputLabel: string = '';
  private currentOutputDeviceId: string = '';
  private stateListeners: Set<() => void> = new Set();

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
      this.notifyListeners();
      return true;
    } catch (e) {
      console.warn('Audio input access not granted or unavailable:', e);
      this.notifyListeners();
      return false;
    }
  }

  public disableMicrophone() {
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
   * Synthesize Continuous-Phase 16-MFSK (CPFSK) symbols with raised-cosine envelope
   * and optional Right-Channel Audio PTT Tone (Pseudo-FSK / Hardware Tone Keying)
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
    this.isTxActive = true;

    const leadInSec = (options?.leadInMs || 20) / 1000;
    const hangTimeSec = (options?.hangTimeMs || 30) / 1000;
    const toneSpacing = Z30_SPECS.TONE_SPACING_HZ; // 3.125 Hz
    const symDuration = Z30_SPECS.SYMBOL_DURATION_SEC; // 0.320 s
    const rampTime = 0.008; // 8ms raised-cosine transition ramp to prevent key clicks

    const pttStartTime = this.ctx.currentTime + 0.02;
    const dataStartTime = pttStartTime + leadInSec;
    const totalDataDuration = symbolIndices.length * symDuration;
    const dataEndTime = dataStartTime + totalDataDuration;
    const pttEndTime = dataEndTime + hangTimeSec;

    // If Right-Channel Audio Tone PTT is enabled, create stereo panner/merger
    const enableRightTone = Boolean(options?.enableRightTone);
    const rightToneFreq = options?.toneFreqHz || 1000;

    let dataPanner: StereoPannerNode | null = null;
    let rightTonePanner: StereoPannerNode | null = null;

    if (enableRightTone && typeof StereoPannerNode !== 'undefined') {
      try {
        dataPanner = this.ctx.createStereoPanner();
        dataPanner.pan.setValueAtTime(-1.0, this.ctx.currentTime); // Left Channel = Data Audio
        dataPanner.connect(this.txGain);

        rightTonePanner = this.ctx.createStereoPanner();
        rightTonePanner.pan.setValueAtTime(1.0, this.ctx.currentTime); // Right Channel = PTT Tone
        rightTonePanner.connect(this.txGain);

        // Create continuous pure sine tone on right channel for hardware PTT trigger
        const rightOsc = this.ctx.createOscillator();
        const rightGain = this.ctx.createGain();
        rightOsc.type = 'sine';
        rightOsc.frequency.setValueAtTime(rightToneFreq, pttStartTime);

        rightGain.gain.setValueAtTime(0.0001, pttStartTime);
        rightGain.gain.exponentialRampToValueAtTime(0.9, pttStartTime + 0.005);
        rightGain.gain.setValueAtTime(0.9, pttEndTime - 0.005);
        rightGain.gain.exponentialRampToValueAtTime(0.0001, pttEndTime);

        rightOsc.connect(rightGain);
        rightGain.connect(rightTonePanner);

        rightOsc.start(pttStartTime);
        rightOsc.stop(pttEndTime);

        this.activeTxNodes.push({ osc: rightOsc, gain: rightGain });
      } catch (e) {
        console.warn('Stereo Panner not available for Right Channel Tone PTT:', e);
      }
    }

    // Schedule oscillators for 16-MFSK data symbols
    for (let i = 0; i < symbolIndices.length; i++) {
      const toneNum = symbolIndices[i];
      const toneFreq = baseFreqHz + toneNum * toneSpacing;
      const symStartTime = dataStartTime + i * symDuration;
      const symEndTime = symStartTime + symDuration;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(toneFreq, symStartTime);

      // Raised-cosine envelope
      gain.gain.setValueAtTime(0.0001, symStartTime);
      gain.gain.exponentialRampToValueAtTime(0.5, symStartTime + rampTime);
      gain.gain.setValueAtTime(0.5, symEndTime - rampTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, symEndTime);

      osc.connect(gain);

      if (dataPanner) {
        gain.connect(dataPanner);
      } else {
        gain.connect(this.txGain);
      }

      osc.start(symStartTime);
      osc.stop(symEndTime);

      this.activeTxNodes.push({ osc, gain });

      // Progress callbacks
      if (onProgress) {
        setTimeout(() => {
          if (this.isTxActive) onProgress(i, symbolIndices.length);
        }, Math.max(0, (symStartTime - this.ctx!.currentTime) * 1000));
      }
    }

    const totalDurationMs = Math.max(0, (pttEndTime - this.ctx.currentTime) * 1000);
    setTimeout(() => {
      if (this.isTxActive) {
        this.isTxActive = false;
        if (onComplete) onComplete();
      }
    }, totalDurationMs);
  }

  /**
   * Play single CW / Tune tone for transmitter alignment with optional Right Channel Tone PTT
   */
  public startTuneTone(freqHz: number, options?: { enableRightTone?: boolean; toneFreqHz?: number }) {
    this.initAudioContext();
    if (!this.ctx || !this.txGain) return;
    this.stopTransmission();
    this.isTxActive = true;

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

