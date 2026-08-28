/**
 * z-30 DSP Audio Engine
 * High-performance Web Audio API continuous-phase 16-MFSK tone synthesis,
 * real-time spectral analyzer, and microphone/receiver stream processor.
 */

import { Z30_SPECS } from './z30Constants';

export interface AudioMeterData {
  peakDb: number;
  rmsDb: number;
  isClipping: boolean;
}

class Z30AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private txGain: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private activeTxNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private isTxActive: boolean = false;
  private isMuted: boolean = false;
  private fftBuffer: Uint8Array<ArrayBuffer> | null = null;
  private floatFftBuffer: Float32Array<ArrayBuffer> | null = null;

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
      
      this.noiseGain = this.ctx.createGain();
      this.noiseGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      this.noiseGain.connect(this.masterGain);

      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.fftBuffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.floatFftBuffer = new Float32Array(this.analyser.frequencyBinCount);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
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
    // 0 dB -> 1.0, -20 dB -> 0.1, -40 dB -> 0.01
    const linear = Math.pow(10, db / 20);
    this.setTxVolume(linear);
  }

  private liveFrames: {
    freqHz: number;
    text: string;
    symbols: number[];
    timestamp: number;
    snrDb: number;
  }[] = [];

  /**
   * Register a real transmitted or soundcard 16-MFSK audio frame
   */
  public registerActiveSignal(freqHz: number, text: string, symbols: number[], snrDb: number = 0) {
    this.liveFrames.push({
      freqHz,
      text,
      symbols,
      timestamp: Date.now(),
      snrDb,
    });
    // Keep only recent 30-second window frames
    const cutoff = Date.now() - 35000;
    this.liveFrames = this.liveFrames.filter(f => f.timestamp >= cutoff);
  }

  public getActiveSignalsInWindow(): typeof this.liveFrames {
    const cutoff = Date.now() - 35000;
    return this.liveFrames.filter(f => f.timestamp >= cutoff);
  }

  public clearSignalHistory() {
    this.liveFrames = [];
  }

  /**
   * Start synthetic atmospheric RF background noise (AWGN) - Only if explicitly requested
   */
  public startBackgroundRfNoise(level: number = 0.05) {
    if (!this.ctx) this.initAudioContext();
    if (!this.ctx || !this.noiseGain) return;

    try {
      this.stopBackgroundRfNoise();
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      
      // Pink/Brownian shaped HF band noise
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        const pink = b0 + b1 + b2 + white * 0.5362;
        output[i] = pink * 0.11;
      }

      this.noiseNode = this.ctx.createBufferSource();
      this.noiseNode.buffer = noiseBuffer;
      this.noiseNode.loop = true;
      this.noiseNode.connect(this.noiseGain);
      this.noiseGain.gain.setValueAtTime(level, this.ctx.currentTime);
      this.noiseNode.start();
    } catch (e) {
      console.warn('Could not start RF noise audio generator:', e);
    }
  }

  public stopBackgroundRfNoise() {
    if (this.noiseNode) {
      try {
        this.noiseNode.stop();
        this.noiseNode.disconnect();
      } catch {
        // ignore
      }
      this.noiseNode = null;
    }
  }

  /**
   * Synthesize Continuous-Phase 16-MFSK (CPFSK) symbols with raised-cosine envelope
   */
  public play16MfskSequence(
    baseFreqHz: number,
    symbolIndices: number[],
    onProgress?: (symbolIdx: number, total: number) => void,
    onComplete?: () => void
  ) {
    this.initAudioContext();
    if (!this.ctx || !this.txGain) return;

    this.stopTransmission();
    this.isTxActive = true;

    const startTime = this.ctx.currentTime + 0.05;
    const toneSpacing = Z30_SPECS.TONE_SPACING_HZ; // 3.125 Hz
    const symDuration = Z30_SPECS.SYMBOL_DURATION_SEC; // 0.320 s
    const rampTime = 0.008; // 8ms raised-cosine transition ramp to prevent key clicks

    // Schedule oscillators for symbols
    for (let i = 0; i < symbolIndices.length; i++) {
      const toneNum = symbolIndices[i];
      const toneFreq = baseFreqHz + toneNum * toneSpacing;
      const symStartTime = startTime + i * symDuration;
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
      gain.connect(this.txGain);

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

    const totalDurationMs = (startTime - this.ctx.currentTime + symbolIndices.length * symDuration) * 1000;
    setTimeout(() => {
      if (this.isTxActive) {
        this.isTxActive = false;
        if (onComplete) onComplete();
      }
    }, totalDurationMs);
  }

  /**
   * Play single CW / Tune tone for transmitter alignment
   */
  public startTuneTone(freqHz: number) {
    this.initAudioContext();
    if (!this.ctx || !this.txGain) return;
    this.stopTransmission();
    this.isTxActive = true;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);

    osc.connect(gain);
    gain.connect(this.txGain);
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
   * Enable real microphone input for receiver testing
   */
  public async enableMicrophone(): Promise<boolean> {
    try {
      this.initAudioContext();
      if (!this.ctx || !this.analyser) return false;

      if (this.micStream) {
        this.disableMicrophone();
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.analyser);
      return true;
    } catch (e) {
      console.warn('Microphone access not granted or unavailable:', e);
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
      return { peakDb: -100, rmsDb: -100, isClipping: false };
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
      isClipping: peak >= 0.98,
    };
  }
}

export const audioEngine = new Z30AudioEngine();
