/**
 * z-30 Automatic RF Time Synchronization Modal & Production DSP Suite
 * ====================================================================
 * Genuine Audio DSP Demodulation, Tone Analysis, Cross-Correlation, and Timing Synchronization:
 * - Scans international standard time stations (WWV/WWVH, CHU, DCF77, MSF, WWVB, JJY)
 * - Captures real audio buffers from Live Soundcard / Receiver Line-In or in-band RF Test Beacon
 * - Filters passband audio using 61-tap Windowed-Sinc FIR Bandpass filter
 * - Calculates true SNR (Goertzel tone power vs noise floor)
 * - Normalized cross-correlation matches 800ms / 500ms / 1Hz minute pulses
 * - Calculates exact arrival offset: Delta t = T_RF - T_System in milliseconds
 * - Network Atomic NTP UTC Reference validation for high-precision independent ground truth
 */

import React, { useState, useEffect, useRef } from 'react';
import { StationConfig } from '../types/z30';
import {
  Clock,
  Radio,
  Zap,
  Play,
  Square,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Compass,
  X,
  Sparkles,
  Cpu,
  Sliders,
  Terminal,
  Activity,
  Mic,
  MicOff,
  Volume2,
  Globe,
  SlidersHorizontal,
  Lock,
} from 'lucide-react';
import { audioEngine } from '../dsp/audioEngine';
import { rigctl } from '../dsp/catController';
import {
  RF_TIME_STATIONS,
  PRIORITY_REGIONS_PRESETS,
  rfTimeSyncEngine,
  RfSignalGenerator,
  RfDecodeResult,
  NetworkTimeSync,
} from '../dsp/rfTimeSyncEngine';
import {
  formatUtcTime,
  formatTimeInTimezone,
  getTimezoneOffsetString,
} from '../dsp/timeUtils';

interface RfTimeSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StationConfig;
  currentOffsetMs: number;
  onApplyOffset: (offsetMs: number) => void;
}

type AudioSourceMode = 'LIVE_SOUNDCARD' | 'RF_TEST_BEACON' | 'ATOMIC_NTP';

export const RfTimeSyncModal: React.FC<RfTimeSyncModalProps> = ({
  isOpen,
  onClose,
  config,
  currentOffsetMs,
  onApplyOffset,
}) => {
  // Input Source & Scan Configuration
  const [audioSource, setAudioSource] = useState<AudioSourceMode>('LIVE_SOUNDCARD');
  const [selectedRegion, setSelectedRegion] = useState<string>('North America (Default)');
  const [scanSpeed, setScanSpeed] = useState<'QUICK_DSP' | 'FULL_DWELL'>('QUICK_DSP');
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(audioEngine.getIsMicrophoneActive());

  // Test Beacon Parameters
  const [beaconStation, setBeaconStation] = useState<string>('WWV');
  const [beaconSnrDb, setBeaconSnrDb] = useState<number>(14);
  const [beaconDriftMs, setBeaconDriftMs] = useState<number>(-12.4);
  const [playAudioToSpeaker, setPlayAudioToSpeaker] = useState<boolean>(true);

  // Scan & DSP Demodulation State
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [currentStation, setCurrentStation] = useState<string>('');
  const [currentFreqHz, setCurrentFreqHz] = useState<number>(0);
  const [currentSnrDb, setCurrentSnrDb] = useState<number>(-30);
  const [scanProgressPct, setScanProgressPct] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('Ready for RF standard time signal demodulation.');

  // Demodulation Results
  const [lastResult, setLastResult] = useState<RfDecodeResult | null>(null);
  const [lastResultOffsetMs, setLastResultOffsetMs] = useState<number | null>(null);

  // Network Atomic Reference
  const [isQueryingNtp, setIsQueryingNtp] = useState<boolean>(false);
  const [ntpOffsetMs, setNtpOffsetMs] = useState<number | null>(null);
  const [ntpRttMs, setNtpRttMs] = useState<number | null>(null);
  const [ntpServerTime, setNtpServerTime] = useState<string>('');

  // Event Logs
  const [scanLogs, setScanLogs] = useState<
    Array<{ id: string; time: string; level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR'; text: string }>
  >([]);

  // Waveform visualization data
  const [envelopePoints, setEnvelopePoints] = useState<number[]>([]);

  const abortScanRef = useRef<boolean>(false);
  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Keep microphone status in sync
  useEffect(() => {
    setIsMicEnabled(audioEngine.getIsMicrophoneActive());
  }, [isOpen]);

  // Scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [scanLogs]);

  // Real-Time Canvas Oscilloscope Rendering
  useEffect(() => {
    if (!isOpen) return;
    let animId: number;

    const renderOsc = () => {
      const canvas = oscCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;

          // Clear dark phosphor background
          ctx.fillStyle = '#060B08';
          ctx.fillRect(0, 0, w, h);

          // Grid lines
          ctx.strokeStyle = 'rgba(0, 255, 65, 0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = 0; x < w; x += 40) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          }
          for (let y = 0; y < h; y += 16) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
          }
          ctx.stroke();

          // Center reference axis
          ctx.strokeStyle = 'rgba(0, 255, 65, 0.3)';
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          if (envelopePoints.length > 1) {
            // Plot demodulated envelope curve
            ctx.beginPath();
            ctx.strokeStyle = '#00FF41';
            ctx.lineWidth = 2;
            const maxVal = Math.max(0.01, ...envelopePoints);

            for (let i = 0; i < envelopePoints.length; i++) {
              const x = (i / (envelopePoints.length - 1)) * w;
              const normalized = envelopePoints[i] / maxVal;
              const y = h - 6 - normalized * (h - 12);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Highlight pulse arrival peak
            const peakIdx = envelopePoints.indexOf(maxVal);
            if (peakIdx >= 0) {
              const px = (peakIdx / (envelopePoints.length - 1)) * w;
              ctx.strokeStyle = '#EAB308';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(px, 0);
              ctx.lineTo(px, h);
              ctx.stroke();

              ctx.fillStyle = '#EAB308';
              ctx.font = '10px monospace';
              ctx.fillText('DETECTED PULSE MARKER', Math.min(w - 140, Math.max(10, px - 60)), 14);
            }
          } else if (isScanning) {
            // Live scanning animation waveform
            ctx.beginPath();
            ctx.strokeStyle = '#EAB308';
            ctx.lineWidth = 1.5;
            const time = performance.now() / 100;
            for (let x = 0; x < w; x++) {
              const freq = currentStation === 'CHU' ? 0.08 : 0.04;
              const y = h / 2 + Math.sin(x * freq + time) * 14 + (Math.random() - 0.5) * 4;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          } else {
            // Quiet standby baseline
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.4)';
            ctx.lineWidth = 1;
            for (let x = 0; x < w; x++) {
              const y = h / 2 + (Math.random() - 0.5) * 4;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(renderOsc);
    };

    animId = requestAnimationFrame(renderOsc);
    return () => cancelAnimationFrame(animId);
  }, [isOpen, isScanning, envelopePoints, currentStation]);

  const addLog = (text: string, level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' = 'INFO') => {
    const now = new Date();
    const timeStr = now.toTimeString().substring(0, 8);
    setScanLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random()}`,
        time: timeStr,
        level,
        text,
      },
    ]);
  };

  const handleToggleMicrophone = async () => {
    if (audioEngine.getIsMicrophoneActive()) {
      audioEngine.disableMicrophone();
      setIsMicEnabled(false);
      addLog('Audio input / microphone disabled.', 'WARN');
    } else {
      const ok = await audioEngine.enableMicrophone(config.audioInputDevice);
      setIsMicEnabled(ok);
      if (ok) {
        addLog(`Audio input active from device: ${config.audioInputDevice || 'Default System Line-In'}`, 'SUCCESS');
      } else {
        addLog('Could not initialize audio input device. Ensure microphone permission is granted.', 'ERROR');
      }
    }
  };

  /**
   * Main DSP Demodulation Scan Routine
   */
  const handleStartScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    abortScanRef.current = false;
    setScanProgressPct(0);
    setEnvelopePoints([]);
    setLastResult(null);
    setLastResultOffsetMs(null);

    const sampleRate = 12000;
    const captureDurationSec = scanSpeed === 'QUICK_DSP' ? 4.0 : 8.0;

    if (audioSource === 'LIVE_SOUNDCARD') {
      // Ensure microphone/audio input is running
      if (!audioEngine.getIsMicrophoneActive()) {
        const ok = await audioEngine.enableMicrophone(config.audioInputDevice);
        setIsMicEnabled(ok);
      }
    }

    const targets = PRIORITY_REGIONS_PRESETS[selectedRegion] || PRIORITY_REGIONS_PRESETS['North America (Default)'];
    const tzInfo = formatTimeInTimezone(new Date(), config.timezone || 'UTC');
    addLog(`Initiating DSP RF Time Demodulation Scan (${selectedRegion} - ${targets.length} targets)...`, 'INFO');
    addLog(`Station Timezone: ${config.timezone || 'UTC'} [${tzInfo.tzAbbr} / ${tzInfo.offsetStr}] — Correcting master clock strictly to UTC (Universal Time).`, 'INFO');
    addLog(`Audio Source: ${audioSource === 'LIVE_SOUNDCARD' ? 'Live Soundcard / Rig Line-In' : 'RF Standard Signal Generator (Test Beacon)'}`, 'INFO');
    addLog(`DSP Architecture: 61-tap Windowed-Sinc FIR Bandpass Filter, Goertzel SNR Detector, & Slicer.`, 'INFO');

    let syncAchieved = false;

    for (let idx = 0; idx < targets.length; idx++) {
      if (abortScanRef.current) {
        addLog('Scan cancelled by operator.', 'WARN');
        break;
      }

      const { station, freqHz } = targets[idx];
      const spec = RF_TIME_STATIONS[station] || RF_TIME_STATIONS.WWV;
      const freqMhz = (freqHz / 1e6).toFixed(4);
      const targetPct = (idx / targets.length) * 100;

      setCurrentStation(station);
      setCurrentFreqHz(freqHz);
      setScanProgressPct(targetPct);
      setStatusMessage(`Tuning ${station} @ ${freqMhz} MHz (${idx + 1}/${targets.length})...`);
      addLog(`[CAT] Tuning radio to ${freqMhz} MHz (${spec.mode}, ${spec.passbandHz} Hz BW)...`, 'INFO');

      // Command rig via CAT
      rigctl.setFreqHz(freqHz);

      // Settle time for receiver AGC / CAT
      await new Promise((r) => setTimeout(r, 400));
      if (abortScanRef.current) break;

      // Acquire real audio buffer
      setStatusMessage(`Acquiring audio & running FIR bandpass filter for ${station}...`);
      let audioSamples: Float32Array;
      let bufferStartUtcMs = Date.now();

      if (audioSource === 'LIVE_SOUNDCARD') {
        const captured = await audioEngine.captureAudioBuffer(captureDurationSec, sampleRate);
        audioSamples = captured.samples;
        bufferStartUtcMs = captured.bufferStartUtcMs;
      } else {
        // Generate authentic modulated RF standard station audio with configured SNR and drift
        audioSamples = RfSignalGenerator.generateStationAudio(station, captureDurationSec, sampleRate, {
          snrDb: beaconSnrDb,
          driftOffsetMs: beaconDriftMs,
        });
        bufferStartUtcMs = Date.now();

        if (playAudioToSpeaker) {
          audioEngine.playAudioBuffer(audioSamples, sampleRate);
        }
      }

      if (abortScanRef.current) break;

      // Phase 1: Pre-validation of carrier and SNR
      const pre = rfTimeSyncEngine.preValidateCarrier(audioSamples, spec);
      setCurrentSnrDb(pre.snrDb);

      addLog(
        `Carrier Analysis: ${station} @ ${freqMhz} MHz -> Measured Goertzel SNR: ${pre.snrDb.toFixed(1)} dB (Modulation: ${spec.modulation})`,
        pre.hasCarrier ? 'INFO' : 'WARN'
      );

      if (!pre.hasCarrier && audioSource === 'LIVE_SOUNDCARD') {
        addLog(`Carrier SNR (${pre.snrDb.toFixed(1)} dB) below minimum 2.5 dB threshold. Advancing to next frequency.`, 'WARN');
        continue;
      }

      // Phase 2: Full DSP Demodulation & Pulse Cross-Correlation
      setStatusMessage(`Demodulating ${spec.modulation} timing frame on ${station}...`);
      setScanProgressPct(targetPct + (100 / targets.length) * 0.7);

      const decodeResult = rfTimeSyncEngine.demodulateTimeSignal(audioSamples, spec, bufferStartUtcMs);

      if (decodeResult.success) {
        setEnvelopePoints(decodeResult.envelopeCurve);
        setLastResult(decodeResult);
        setLastResultOffsetMs(decodeResult.deltaMs);
        setScanProgressPct(100);
        setCurrentSnrDb(decodeResult.snrDb);
        setStatusMessage(
          `DEMODULATION SUCCESS: Locked ${station} @ ${freqMhz} MHz | Clock Offset Δt: ${decodeResult.deltaMs >= 0 ? '+' : ''}${decodeResult.deltaMs.toFixed(2)} ms`
        );

        addLog(
          `SYNC SUCCESS: Demodulated ${spec.callsign} (${spec.location})!`,
          'SUCCESS'
        );
        addLog(
          `DSP Outcome: ${decodeResult.details}`,
          'SUCCESS'
        );
        addLog(
          `Measured Clock Drift: Δt = ${decodeResult.deltaMs >= 0 ? '+' : ''}${decodeResult.deltaMs.toFixed(2)} ms (Jitter: <${decodeResult.jitterMs.toFixed(1)} ms, SNR: ${decodeResult.snrDb.toFixed(1)} dB, Conf: ${(decodeResult.confidence * 100).toFixed(0)}%)`,
          'SUCCESS'
        );

        syncAchieved = true;
        break;
      } else {
        addLog(`Demodulation failed: ${decodeResult.details}`, 'WARN');
      }
    }

    if (!syncAchieved && !abortScanRef.current) {
      setStatusMessage('Scan cycle complete. No standard time station signals met SNR demodulation threshold.');
      addLog('Scan finished without locking timing pulse. Try switching antenna, enabling RF Test Beacon, or running Network Atomic Reference.', 'WARN');
    }

    setIsScanning(false);
  };

  const handleAbortScan = () => {
    abortScanRef.current = true;
    setIsScanning(false);
    setStatusMessage('Scan aborted by user.');
    addLog('Operator aborted active scanning loop.', 'WARN');
  };

  /**
   * Run High-Precision Network Atomic UTC Reference Query
   */
  const handleQueryNtpReference = async () => {
    setIsQueryingNtp(true);
    addLog('Querying Atomic UTC Time Server via low-latency multi-RTT HTTP SNTP protocol...', 'INFO');

    const result = await NetworkTimeSync.queryAtomicUtcOffset();
    setIsQueryingNtp(false);

    if (result.success) {
      setNtpOffsetMs(result.offsetMs);
      setNtpRttMs(result.rttMs);
      setNtpServerTime(result.serverTimeUtc);
      addLog(
        `Atomic UTC Reference Success: Server Time ${result.serverTimeUtc.substring(11, 19)} UTC | RTT Latency: ${result.rttMs.toFixed(1)} ms`,
        'SUCCESS'
      );
      addLog(
        `System Clock Drift (Atomic Reference): Δt = ${result.offsetMs >= 0 ? '+' : ''}${result.offsetMs.toFixed(2)} ms`,
        'SUCCESS'
      );
    } else {
      addLog(`Atomic Reference query failed: ${result.error || 'Connection error'}`, 'ERROR');
    }
  };

  const handleApply = (offsetToApply?: number) => {
    const val = offsetToApply !== undefined ? offsetToApply : lastResultOffsetMs;
    if (val !== null && val !== undefined) {
      onApplyOffset(val);
      addLog(`Applied application clock offset ${val >= 0 ? '+' : ''}${val.toFixed(2)} ms to station config!`, 'SUCCESS');
      setTimeout(() => {
        onClose();
      }, 400);
    }
  };

  const handleManualCalibrateZero = () => {
    onApplyOffset(0.0);
    setLastResultOffsetMs(0.0);
    addLog('Clock offset reset to 0.00 ms (System Raw UTC).', 'INFO');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 font-mono select-none animate-in fade-in duration-200">
      <div className="bg-[#121212] border border-[#333] w-full max-w-4xl shadow-2xl flex flex-col max-h-[94vh] overflow-hidden text-[#D4D4D4]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#0A0A0A] border-b border-[#2A2A2A]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 bg-yellow-500/10 border border-yellow-500/40 flex items-center justify-center text-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.2)]">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-yellow-400 tracking-wider">
                  RF TIME DEMODULATION & SYNCHRONIZATION SUITE
                </span>
                <span className="text-[10px] bg-[#1F1F1F] text-yellow-300 border border-yellow-700/60 px-1.5 py-0.2">
                  DSP CORE
                </span>
                <span className="text-[10px] bg-[#1F1F1F] text-[#00FF41] border border-[#00FF41]/40 px-1.5 py-0.2">
                  AUTHENTIC DECODER
                </span>
              </div>
              <p className="text-[10px] text-[#888]">
                Real Audio DSP Demodulation: FIR Bandpass Filtering, Tone Envelope Detection, & Sub-Second Cross-Correlation.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#222] text-[#888] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0F0F0F] text-xs">
          {/* Timezone & UTC Reference Notification Bar */}
          <div className="bg-[#080808] border border-[#262626] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center space-x-2">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-zinc-400">Station Timezone:</span>
              <span className="font-bold text-cyan-300">
                {config.timezone || 'UTC'} [{formatTimeInTimezone(new Date(), config.timezone || 'UTC').tzAbbr} / {getTimezoneOffsetString(config.timezone || 'UTC')}]
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41]" />
              <span className="text-zinc-400">Sync Master Target:</span>
              <span className="font-bold text-[#00FF41]">UTC Second Zero (Universal Coordinated Time)</span>
              <span className="text-[10px] text-zinc-500 hidden sm:inline">({formatUtcTime(new Date())} UTC)</span>
            </div>
          </div>

          {/* Top Readout Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {/* Card 1: Current Active Offset */}
            <div className="bg-[#080808] border border-[#222] p-3 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-[#888] uppercase tracking-wider flex items-center justify-between">
                <span>Active App Clock Offset</span>
                <Clock className="w-3 h-3 text-yellow-400" />
              </div>
              <div className="text-2xl font-bold text-yellow-400 my-1 font-mono tracking-tight drop-shadow-[0_0_8px_rgba(234,179,8,0.3)]">
                {currentOffsetMs >= 0 ? '+' : ''}{currentOffsetMs.toFixed(2)} <span className="text-xs text-[#888]">ms</span>
              </div>
              <div className="text-[10px] text-[#666]">
                30s Sync Target: <strong className="text-[#00FF41]">&lt;20 ms drift</strong>
              </div>
            </div>

            {/* Card 2: Last Decoded RF Station */}
            <div className="bg-[#080808] border border-[#222] p-3 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-[#888] uppercase tracking-wider flex items-center justify-between">
                <span>Decoded RF Reference</span>
                <Radio className="w-3 h-3 text-cyan-400" />
              </div>
              <div className="text-xl font-bold text-cyan-400 my-1 truncate">
                {lastResult ? `${lastResult.station} (${lastResult.snrDb.toFixed(1)} dB)` : 'No Signal Locked'}
              </div>
              <div className="text-[10px] text-[#666]">
                {lastResult ? (
                  <>
                    Confidence: <strong className="text-[#00FF41]">{(lastResult.confidence * 100).toFixed(0)}%</strong> • Jitter: <strong className="text-[#AAA]">&lt;{lastResult.jitterMs.toFixed(1)} ms</strong>
                  </>
                ) : (
                  <span>Ready to demodulate audio stream</span>
                )}
              </div>
            </div>

            {/* Card 3: Network Atomic Verification */}
            <div className="bg-[#080808] border border-[#222] p-3 flex flex-col justify-between">
              <div className="text-[10px] font-bold text-[#888] uppercase tracking-wider flex items-center justify-between">
                <span>Atomic Reference (HTTP)</span>
                <Globe className="w-3 h-3 text-[#00FF41]" />
              </div>
              <div className="text-xl font-bold text-[#00FF41] my-1 font-mono tracking-tight">
                {ntpOffsetMs !== null ? `${ntpOffsetMs >= 0 ? '+' : ''}${ntpOffsetMs.toFixed(2)} ms` : 'Unchecked'}
              </div>
              <div className="text-[10px] text-[#666] flex items-center justify-between">
                <span>{ntpRttMs !== null ? `RTT: ${ntpRttMs.toFixed(1)}ms` : 'Independent UTC Check'}</span>
                <button
                  onClick={handleQueryNtpReference}
                  disabled={isQueryingNtp}
                  className="text-cyan-400 hover:underline flex items-center space-x-1"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isQueryingNtp ? 'animate-spin' : ''}`} />
                  <span>Verify</span>
                </button>
              </div>
            </div>
          </div>

          {/* Audio Input Source Selector */}
          <div className="bg-[#141414] border border-[#262626] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A2A2A] pb-2">
              <div className="flex items-center space-x-2">
                <SlidersHorizontal className="w-4 h-4 text-yellow-400" />
                <span className="text-[11px] font-bold text-[#E5E5E5] uppercase">Demodulator Audio Source:</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setAudioSource('LIVE_SOUNDCARD')}
                  className={`px-2.5 py-1 text-[11px] font-bold uppercase transition-all flex items-center space-x-1.5 ${
                    audioSource === 'LIVE_SOUNDCARD'
                      ? 'bg-yellow-500 text-black shadow-[0_0_8px_rgba(234,179,8,0.4)]'
                      : 'bg-[#080808] text-[#888] border border-[#333] hover:text-[#CCC]'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Live Receiver Audio (Mic / Line-In)</span>
                </button>

                <button
                  onClick={() => {
                    if (!audioEngine.isExperimentalModeEnabled()) {
                      addLog(
                        'RF Calibration Test Beacon is LOCKED. To enable synthetic test signals, open Station Settings -> Experimental Testing, accept the risk agreement, and unlock the testing harness.',
                        'WARN'
                      );
                      return;
                    }
                    setAudioSource('RF_TEST_BEACON');
                  }}
                  className={`px-2.5 py-1 text-[11px] font-bold uppercase transition-all flex items-center space-x-1.5 ${
                    audioSource === 'RF_TEST_BEACON'
                      ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                      : 'bg-[#080808] text-[#888] border border-[#333] hover:text-[#CCC]'
                  }`}
                >
                  {audioEngine.isExperimentalModeEnabled() ? (
                    <Sparkles className="w-3.5 h-3.5" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                  <span>RF Calibration Test Beacon</span>
                  {!audioEngine.isExperimentalModeEnabled() && (
                    <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1 py-0.2 ml-1">LOCKED</span>
                  )}
                </button>
              </div>
            </div>

            {/* Audio Source Specific Controls */}
            {audioSource === 'LIVE_SOUNDCARD' ? (
              <div className="flex flex-wrap items-center justify-between text-xs bg-[#080808] p-2 border border-[#222] gap-2">
                <div className="flex items-center space-x-2">
                  <span className="text-[#888]">Active Line-In Device:</span>
                  <strong className="text-[#D4D4D4]">{config.audioInputDevice || 'Default System Audio Capture'}</strong>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleToggleMicrophone}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase flex items-center space-x-1 border ${
                      isMicEnabled
                        ? 'bg-green-900/30 border-green-500 text-green-300'
                        : 'bg-red-900/30 border-red-500 text-red-300'
                    }`}
                  >
                    {isMicEnabled ? <Mic className="w-3 h-3 text-green-400" /> : <MicOff className="w-3 h-3 text-red-400" />}
                    <span>{isMicEnabled ? 'Receiver Input Active' : 'Enable Audio Input'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[#080808] p-2 border border-[#222] text-xs">
                {/* Station Selection */}
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] text-[#888] uppercase font-bold">Standard Station:</label>
                  <select
                    value={beaconStation}
                    onChange={(e) => setBeaconStation(e.target.value)}
                    className="bg-[#121212] border border-[#333] px-2 py-1 text-xs text-[#E5E5E5]"
                  >
                    {Object.keys(RF_TIME_STATIONS).map((k) => (
                      <option key={k} value={k}>
                        {k} ({RF_TIME_STATIONS[k].modulation})
                      </option>
                    ))}
                  </select>
                </div>

                {/* SNR Simulation Slider */}
                <div className="flex flex-col space-y-1">
                  <div className="flex justify-between text-[10px] text-[#888] font-bold">
                    <span>RF Carrier SNR:</span>
                    <span className="text-cyan-400">{beaconSnrDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min={-6}
                    max={26}
                    step={1}
                    value={beaconSnrDb}
                    onChange={(e) => setBeaconSnrDb(Number(e.target.value))}
                    className="accent-cyan-400 w-full"
                  />
                </div>

                {/* Clock Drift Offset Slider */}
                <div className="flex flex-col space-y-1">
                  <div className="flex justify-between text-[10px] text-[#888] font-bold">
                    <span>Injected Drift Offset:</span>
                    <span className="text-yellow-400">{beaconDriftMs >= 0 ? '+' : ''}{beaconDriftMs.toFixed(1)} ms</span>
                  </div>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={0.5}
                    value={beaconDriftMs}
                    onChange={(e) => setBeaconDriftMs(Number(e.target.value))}
                    className="accent-yellow-400 w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Regional Settings & Scanner Controls */}
          <div className="bg-[#141414] border border-[#262626] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A2A2A] pb-2">
              {/* Region Selector */}
              <div className="flex items-center space-x-2">
                <Compass className="w-4 h-4 text-yellow-400" />
                <label className="text-[11px] font-bold text-[#D4D4D4] uppercase">Regional Priority Preset:</label>
                <select
                  id="time-sync-region-select"
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  disabled={isScanning}
                  className="bg-[#050505] text-[#D4D4D4] border border-[#333] px-2.5 py-1 text-xs focus:outline-none focus:border-yellow-400"
                >
                  {Object.keys(PRIORITY_REGIONS_PRESETS).map((r) => (
                    <option key={r} value={r}>
                      {r} ({PRIORITY_REGIONS_PRESETS[r].length} frequencies)
                    </option>
                  ))}
                </select>
              </div>

              {/* RF Scan Speed */}
              <div className="flex items-center space-x-2">
                <span className="text-[11px] text-[#888]">Dwell Window:</span>
                <div className="flex items-center bg-[#050505] p-0.5 border border-[#333]">
                  <button
                    onClick={() => setScanSpeed('QUICK_DSP')}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                      scanSpeed === 'QUICK_DSP' ? 'bg-yellow-500 text-black' : 'text-[#888] hover:text-[#D4D4D4]'
                    }`}
                  >
                    Quick DSP (4s)
                  </button>
                  <button
                    onClick={() => setScanSpeed('FULL_DWELL')}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                      scanSpeed === 'FULL_DWELL' ? 'bg-yellow-500 text-black' : 'text-[#888] hover:text-[#D4D4D4]'
                    }`}
                  >
                    Full 8s Dwell
                  </button>
                </div>
              </div>
            </div>

            {/* Live Status Readout */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className={`inline-block w-2 h-2 rounded-full ${isScanning ? 'bg-yellow-400 animate-ping' : 'bg-[#00FF41]'}`}></span>
                <span className="font-bold text-[#E5E5E5]">{statusMessage}</span>
              </div>
              {currentFreqHz > 0 && (
                <div className="text-[11px] text-[#888] flex items-center space-x-2">
                  <span>CAT: <strong className="text-cyan-400">{(currentFreqHz / 1e6).toFixed(4)} MHz</strong></span>
                  <span>•</span>
                  <span>SNR: <strong className="text-[#00FF41]">{currentSnrDb.toFixed(1)} dB</strong></span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            <div className="relative w-full h-2 bg-[#050505] border border-[#333] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-500 to-[#00FF41] transition-all duration-300 shadow-[0_0_8px_rgba(234,179,8,0.5)]"
                style={{ width: `${scanProgressPct}%` }}
              />
            </div>

            {/* Demodulation Oscilloscope & Correlation Peak Canvas */}
            <div className="relative h-20 w-full bg-[#050505] border border-[#262626] overflow-hidden">
              <canvas
                ref={oscCanvasRef}
                width={740}
                height={80}
                className="w-full h-full block"
              />
              <div className="absolute top-1 left-2 text-[9px] text-[#AAA] pointer-events-none flex items-center space-x-2">
                <Activity className="w-3 h-3 text-yellow-400" />
                <span>Real-Time FIR Bandpass Demodulated Envelope & Normalized Cross-Correlation</span>
              </div>
            </div>
          </div>

          {/* Supported Global Standard Time Stations Grid */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase text-[#888] tracking-wider flex items-center space-x-1.5">
              <Radio className="w-3.5 h-3.5 text-yellow-400" />
              <span>Standard Time Stations Demodulation Profiles</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {Object.values(RF_TIME_STATIONS).map((stn) => {
                const isCurrent = currentStation === stn.callsign;
                return (
                  <div
                    key={stn.callsign}
                    className={`p-2 border transition-all text-[11px] ${
                      isCurrent
                        ? 'bg-yellow-950/30 border-yellow-500 text-yellow-300 shadow-[0_0_8px_rgba(234,179,8,0.3)]'
                        : 'bg-[#080808] border-[#222] text-[#AAA]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span className={isCurrent ? 'text-yellow-400' : 'text-[#D4D4D4]'}>{stn.callsign}</span>
                      <span className="text-[9px] text-[#666]">{stn.mode}</span>
                    </div>
                    <div className="text-[10px] text-[#888] truncate mt-0.5">
                      {stn.frequenciesHz.map((f) => f >= 1e6 ? `${(f / 1e6).toFixed(0)}M` : `${(f / 1e3).toFixed(1)}k`).join(', ')}
                    </div>
                    <div className="text-[9px] text-cyan-400 truncate mt-0.5">
                      {stn.modulation}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Scanner Log Terminal */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-bold text-[#888] uppercase tracking-wider">
              <div className="flex items-center space-x-1.5">
                <Terminal className="w-3 h-3 text-yellow-400" />
                <span>DSP Demodulation & Calibration Event Log</span>
              </div>
              <button
                onClick={() => setScanLogs([])}
                className="text-[9px] text-[#666] hover:text-[#AAA]"
              >
                Clear Log
              </button>
            </div>
            <div
              ref={logContainerRef}
              className="h-28 bg-[#050505] border border-[#262626] p-2 overflow-y-auto space-y-0.5 font-mono text-[10px]"
            >
              {scanLogs.length === 0 ? (
                <div className="text-[#555] italic">Standby. Click 'Start DSP Demodulation Scan' to begin real signal acquisition.</div>
              ) : (
                scanLogs.map((log) => (
                  <div key={log.id} className="leading-tight">
                    <span className="text-[#666]">[{log.time}] </span>
                    <span
                      className={
                        log.level === 'SUCCESS'
                          ? 'text-[#00FF41] font-bold'
                          : log.level === 'WARN'
                          ? 'text-yellow-400'
                          : log.level === 'ERROR'
                          ? 'text-red-400'
                          : 'text-[#BBB]'
                      }
                    >
                      {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-[#0A0A0A] border-t border-[#2A2A2A] gap-2">
          <div className="flex items-center space-x-2">
            {!isScanning ? (
              <button
                id="modal-start-rf-sync-btn"
                onClick={handleStartScan}
                className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-bold uppercase text-xs flex items-center space-x-1.5 shadow-[0_0_10px_rgba(234,179,8,0.4)] transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Start DSP Demodulation Scan</span>
              </button>
            ) : (
              <button
                id="modal-abort-rf-sync-btn"
                onClick={handleAbortScan}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold uppercase text-xs flex items-center space-x-1.5 shadow-[0_0_10px_rgba(239,68,68,0.4)] transition-all animate-pulse"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Abort Scan</span>
              </button>
            )}

            {lastResultOffsetMs !== null && (
              <button
                id="modal-apply-offset-btn"
                onClick={() => handleApply()}
                className="px-3 py-1.5 bg-[#00FF41] hover:bg-[#00DD38] text-black font-bold uppercase text-xs flex items-center space-x-1.5 shadow-[0_0_10px_rgba(0,255,65,0.4)] transition-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Apply Decoded Offset ({lastResultOffsetMs >= 0 ? '+' : ''}{lastResultOffsetMs.toFixed(2)} ms)</span>
              </button>
            )}

            {ntpOffsetMs !== null && lastResultOffsetMs === null && (
              <button
                onClick={() => handleApply(ntpOffsetMs)}
                className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold uppercase text-xs flex items-center space-x-1.5 shadow-[0_0_10px_rgba(6,182,212,0.4)] transition-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Apply Atomic NTP Offset ({ntpOffsetMs >= 0 ? '+' : ''}{ntpOffsetMs.toFixed(2)} ms)</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleManualCalibrateZero}
              className="px-2.5 py-1.5 bg-[#1F1F1F] hover:bg-[#2A2A2A] text-[#888] hover:text-[#D4D4D4] text-xs transition-colors"
            >
              Reset to 0.0 ms
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-[#1F1F1F] hover:bg-[#2A2A2A] text-[#D4D4D4] text-xs font-bold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
