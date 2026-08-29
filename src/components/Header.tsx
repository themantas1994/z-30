/**
 * Top Navigation Header, UTC Synchronous Cycle Clock & Global Controls
 */

import React, { useEffect, useState } from 'react';
import { StationConfig, TxSlot } from '../types/z30';
import { Z30_SPECS, evaluateSlotTiming } from '../dsp/z30Constants';
import { audioEngine } from '../dsp/audioEngine';
import { formatUtcTime, formatTimeInTimezone } from '../dsp/timeUtils';
import { Radio, Mic, MicOff, Volume2, VolumeX, BookOpen, Settings, HelpCircle, Sparkles, Activity, Play, Cpu, Square, Zap, Clock, Wand2, Maximize2, Minimize2, Globe, DownloadCloud, BarChart2 } from 'lucide-react';
import { updateEngine, UpdateCheckResult } from '../dsp/updateEngine';

interface HeaderProps {
  config: StationConfig;
  currentBandName: string;
  dialFreqHz: number;
  isTransmitting: boolean;
  isTuning?: boolean;
  txEnabled?: boolean;
  txSlot?: TxSlot;
  onOpenLogbook: () => void;
  onOpenSettings: () => void;
  onOpenWizard?: () => void;
  onOpenSpecs: () => void;
  onOpenBenchmark?: () => void;
  onOpenWiki?: (slug?: string) => void;
  onOpenTimeSync?: () => void;
  onOpenUpdate?: () => void;
  timeOffsetMs?: number;
  onTriggerDecode: () => void;
  onStartTx?: () => void;
  onStopTx?: () => void;
  onStartTune?: () => void;
  onStopTune?: () => void;
  cycleProgressSec: number; // 0.0 to 30.0
}

export const Header: React.FC<HeaderProps> = ({
  config,
  currentBandName,
  dialFreqHz,
  isTransmitting,
  isTuning = false,
  txEnabled = false,
  txSlot = 'EVEN',
  onOpenLogbook,
  onOpenSettings,
  onOpenWizard,
  onOpenSpecs,
  onOpenBenchmark,
  onOpenWiki,
  onOpenTimeSync,
  onOpenUpdate,
  timeOffsetMs = 0,
  onTriggerDecode,
  onStartTx,
  onStopTx,
  onStartTune,
  onStopTune,
  cycleProgressSec,
}) => {
  const [utcTimeStr, setUtcTimeStr] = useState<string>('00:00:00');
  const [localTimeInfo, setLocalTimeInfo] = useState<{ timeStr: string; tzAbbr: string; offsetStr: string } | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(() => audioEngine.getIsMuted());
  const [micEnabled, setMicEnabled] = useState<boolean>(() => audioEngine.getIsMicrophoneActive());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(() => updateEngine.getCachedResult());

  useEffect(() => {
    const unsub = updateEngine.subscribe((res) => {
      setUpdateInfo(res);
    });
    return unsub;
  }, []);

  // Synchronize mic and mute state with audioEngine
  useEffect(() => {
    setMicEnabled(audioEngine.getIsMicrophoneActive());
    setIsMuted(audioEngine.getIsMuted());

    const unsubscribe = audioEngine.subscribe(() => {
      setMicEnabled(audioEngine.getIsMicrophoneActive());
      setIsMuted(audioEngine.getIsMuted());
    });
    return unsubscribe;
  }, []);

  const slotInfo = evaluateSlotTiming((txSlot || 'EVEN') as TxSlot);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const root = document.documentElement;
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if ((root as any).webkitRequestFullscreen) {
          await (root as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date(Date.now() + (timeOffsetMs || 0));
      // True UTC Time
      setUtcTimeStr(formatUtcTime(now));

      // Local Station Timezone if configured
      if (config.timezone && config.timezone !== 'UTC') {
        const info = formatTimeInTimezone(now, config.timezone);
        setLocalTimeInfo({
          timeStr: info.timeStr,
          tzAbbr: info.tzAbbr,
          offsetStr: info.offsetStr,
        });
      } else {
        setLocalTimeInfo(null);
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 200);
    return () => clearInterval(interval);
  }, [timeOffsetMs, config.timezone]);

  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    audioEngine.setMute(nextMute);
  };

  const handleToggleMic = async () => {
    if (micEnabled) {
      audioEngine.disableMicrophone();
    } else {
      await audioEngine.enableMicrophone(config.audioInputDevice);
    }
  };

  // 30-second cycle calculation
  const cyclePercent = (cycleProgressSec / Z30_SPECS.CYCLE_DURATION_SEC) * 100;
  const isTxRxPhase = cycleProgressSec < Z30_SPECS.ACTIVE_TX_DURATION_SEC; // 0 - 24s
  const isSicDecodePhase = !isTxRxPhase; // 24 - 30s

  return (
    <header className="bg-[#141414] border-b border-[#333] text-[#D4D4D4] select-none sticky top-0 z-40 font-mono">
      {/* 30-Second Cycle High-Precision Progress Bar */}
      <div className="relative w-full h-1.5 bg-[#050505] overflow-hidden">
        {/* Active Phase Bar */}
        <div
          className={`h-full transition-all duration-100 ${
            isTransmitting
              ? 'bg-red-500 shadow-[0_0_8px_#EF4444]'
              : isSicDecodePhase
              ? 'bg-purple-500 shadow-[0_0_8px_#A855F7]'
              : 'bg-[#00FF41] shadow-[0_0_8px_#00FF41]'
          }`}
          style={{ width: `${cyclePercent}%` }}
        />
        {/* 24.0s mark divider */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-[#444] z-10"
          style={{ left: `${(24.0 / 30.0) * 100}%` }}
          title="24.0s: Active Frame End -> SIC Decoding Phase Starts"
        />
      </div>

      <div className="w-full px-2 sm:px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* Left: App Logo & Mode Identity */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 bg-[#050505] border border-[#333] flex items-center justify-center text-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.2)]">
              <Radio className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[#00FF41] font-bold tracking-tighter text-base">Z-30 EXPERIMENTAL</span>
                <span className="text-[9px] uppercase px-1.5 py-0.5 bg-[#050505] text-[#00FF41] border border-[#00FF41]/40">
                  16-MFSK
                </span>
                <span className="text-[9px] uppercase px-1.5 py-0.5 bg-[#050505] text-purple-400 border border-purple-800">
                  LDPC+SIC
                </span>
              </div>
              <div className="flex space-x-3 text-[9px] uppercase text-[#888] hidden sm:flex items-center mt-0.5">
                <span className="flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] mr-1.5"></span>CAT: {config.rigModel.split(' ')[0]}</span>
                <span className="flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] mr-1.5"></span>BW: 50Hz</span>
                <span className="flex items-center"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500 mr-1.5"></span>SYNC: 30s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Live UTC Clock & Synchronous Cycle Readout */}
        <div className="flex items-center space-x-2 bg-[#050505] px-2.5 py-1 border border-[#333] text-xs">
          {/* UTC Clock (Radio Protocol Standard) */}
          <div className="flex items-center space-x-1.5" title="Universal Coordinated Time (UTC) - 30-second digital mode synchronization reference">
            <span className="text-[#666] text-[10px]">UTC:</span>
            <span className="font-bold text-[#00FF41] tracking-wider text-sm">{utcTimeStr}</span>
          </div>

          {/* Optional Operator Local Timezone Readout */}
          {localTimeInfo && (
            <div
              className="flex items-center space-x-1 px-1.5 py-0.5 bg-[#141414] border border-[#333] text-[10px] text-zinc-300 hidden md:flex"
              title={`Operator Local Time: ${localTimeInfo.timeStr} (${localTimeInfo.tzAbbr} / ${localTimeInfo.offsetStr}) - Protocol slots synchronize strictly to UTC`}
            >
              <Globe className="w-2.5 h-2.5 text-zinc-400 mr-0.5" />
              <span className="text-zinc-400 font-mono">{localTimeInfo.tzAbbr}:</span>
              <span className="font-mono text-zinc-200 font-bold">{localTimeInfo.timeStr}</span>
            </div>
          )}

          {/* Time Sync Button */}
          {onOpenTimeSync && (
            <button
              id="header-time-sync-btn"
              type="button"
              onClick={onOpenTimeSync}
              title="Activate Automatic RF Time Synchronization Engine (WWV, CHU, DCF77, MSF, WWVB, JJY)"
              className="px-2 py-0.5 bg-yellow-500/15 hover:bg-yellow-500 text-yellow-400 hover:text-black border border-yellow-500/40 text-[10px] font-bold uppercase tracking-wider flex items-center space-x-1 transition-all shadow-[0_0_8px_rgba(234,179,8,0.15)] group"
            >
              <Clock className="w-3 h-3 text-yellow-400 group-hover:text-black animate-pulse" />
              <span>SYNC TIME</span>
              {timeOffsetMs !== undefined && timeOffsetMs !== 0 && (
                <span className="text-[9px] bg-[#141414] group-hover:bg-black group-hover:text-yellow-400 px-1 py-0.2 border border-yellow-700/60 text-yellow-300 font-mono">
                  {timeOffsetMs >= 0 ? '+' : ''}{timeOffsetMs.toFixed(1)}ms
                </span>
              )}
            </button>
          )}

          <span className="text-[#444]">|</span>

          {/* Cycle Countdown */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[#666] text-[10px]">SLOT:</span>
            <span className="font-bold text-cyan-400">{cycleProgressSec.toFixed(1)}s</span>
            <span
              className={`px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                isTransmitting
                  ? 'bg-red-900/50 text-red-400 border border-red-700 animate-pulse'
                  : isSicDecodePhase
                  ? 'bg-purple-950/60 text-purple-300 border border-purple-700'
                  : 'bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/40'
              }`}
            >
              {isTransmitting ? 'TX ACTIVE' : isSicDecodePhase ? 'SIC DECODE' : 'RX WINDOW'}
            </span>
          </div>
        </div>

        {/* Right: View Navigation Tabs & Station Actions */}
        <div className="flex items-center space-x-2">
          {/* Start / Stop / Tune Transmission Controls in Header */}
          <div className="flex items-center space-x-1 bg-[#050505] p-0.5 border border-[#333]">
            {/* Start TX Button */}
            <button
              id="header-start-tx-btn"
              onClick={onStartTx}
              disabled={isTransmitting}
              title={
                txEnabled && !isTransmitting
                  ? `TX Armed: Will transmit at start of slot (${slotInfo.targetSlotLabel} in ${slotInfo.secondsUntilTargetSlot}s)`
                  : 'Enable & Start 16-MFSK Transmission in selected slot'
              }
              className={`px-2 py-1 text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1 transition-all ${
                isTransmitting
                  ? 'bg-red-600/30 text-red-300 border border-red-500/50 cursor-not-allowed'
                  : txEnabled
                  ? 'bg-[#00FF41] text-black shadow-[0_0_12px_rgba(0,255,65,0.6)] animate-pulse'
                  : 'bg-[#00FF41]/20 hover:bg-[#00FF41] text-[#00FF41] hover:text-black border border-[#00FF41]/50'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>
                {isTransmitting
                  ? 'TX Active'
                  : txEnabled
                  ? `Armed (${slotInfo.secondsUntilTargetSlot}s)`
                  : 'Start TX'}
              </span>
            </button>

            {/* Stop TX Button */}
            <button
              id="header-stop-tx-btn"
              onClick={onStopTx}
              title="Stop / Abort Transmission or Disarm Immediately"
              className={`px-2 py-1 text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1 transition-all ${
                isTransmitting || isTuning || txEnabled
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.6)]'
                  : 'bg-[#141414] hover:bg-red-950/60 text-[#888] hover:text-red-400 border border-[#333]'
              }`}
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              <span>Stop TX</span>
            </button>

            {/* Dedicated Radio Tune Button */}
            <button
              id="header-tune-btn"
              onClick={isTuning ? onStopTune : onStartTune}
              title={isTuning ? 'Stop CW Carrier Tone' : 'Key Transmitter with Continuous Pure Carrier Tone for Antenna Matching'}
              className={`px-2 py-1 text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1 transition-all border ${
                isTuning
                  ? 'bg-yellow-500 text-black border-yellow-400 animate-pulse shadow-[0_0_12px_rgba(234,179,8,0.6)]'
                  : 'bg-[#141414] hover:bg-[#202020] text-cyan-400 hover:text-cyan-300 border-cyan-900/80'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>{isTuning ? 'TUNING...' : 'TUNE (CW)'}</span>
            </button>
          </div>

          {/* Audio Mute */}
          <button
            id="audio-mute-btn"
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            className={`p-1.5 border text-xs transition-colors ${
              isMuted ? 'bg-red-950/60 border-red-800 text-red-400' : 'bg-[#141414] border-[#333] text-[#888] hover:text-[#D4D4D4] hover:bg-[#1A1A1A]'
            }`}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Microphone Real Audio Input */}
          <button
            id="audio-mic-btn"
            onClick={handleToggleMic}
            title={micEnabled ? 'Disable Live Microphone' : 'Enable Live Microphone Input'}
            className={`p-1.5 border text-xs transition-colors ${
              micEnabled ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41]' : 'bg-[#141414] border-[#333] text-[#888] hover:text-[#D4D4D4] hover:bg-[#1A1A1A]'
            }`}
          >
            {micEnabled ? <Mic className="w-3.5 h-3.5 text-[#00FF41]" /> : <MicOff className="w-3.5 h-3.5" />}
          </button>

          {/* Logbook */}
          <button
            id="open-logbook-btn"
            onClick={onOpenLogbook}
            title="Open ADIF Logbook"
            className="p-1.5 bg-[#141414] hover:bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333] text-xs flex items-center space-x-1"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline text-[11px]">Logbook</span>
          </button>

          {/* Setup Wizard */}
          {onOpenWizard && (
            <button
              id="open-wizard-btn"
              onClick={onOpenWizard}
              title="Station Setup & Hardware Wizard"
              className="p-1.5 bg-[#141414] hover:bg-[#1A1A1A] text-[#00FF41] hover:text-[#00FF41] border border-[#00FF41]/40 text-xs flex items-center space-x-1"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span className="hidden lg:inline text-[11px] font-bold">Wizard</span>
            </button>
          )}

          {/* Monte Carlo Physical Waveform & SNR Decoder Benchmark */}
          {onOpenBenchmark && (
            <button
              id="open-benchmark-btn"
              onClick={onOpenBenchmark}
              title="Monte Carlo Physical Waveform Generator, AWGN Calibrator & LDPC Decoder Benchmark"
              className="p-1.5 bg-[#141414] hover:bg-[#1A1A1A] text-[#00FF41] hover:text-white border border-[#00FF41]/40 text-xs flex items-center space-x-1 shadow-[0_0_8px_rgba(0,255,65,0.15)]"
            >
              <BarChart2 className="w-3.5 h-3.5 text-[#00FF41]" />
              <span className="hidden md:inline text-[11px] font-bold text-[#00FF41]">Benchmark</span>
            </button>
          )}

          {/* GitHub Wiki & Documentation */}
          {onOpenWiki && (
            <button
              id="open-wiki-btn"
              onClick={() => onOpenWiki('Home')}
              title="Open GitHub Wiki & Documentation Browser"
              className="p-1.5 bg-[#141414] hover:bg-[#1A1A1A] text-yellow-400 hover:text-yellow-300 border border-yellow-500/40 text-xs flex items-center space-x-1 shadow-[0_0_8px_rgba(234,179,8,0.1)]"
            >
              <BookOpen className="w-3.5 h-3.5 text-yellow-400" />
              <span className="hidden md:inline text-[11px] font-bold text-yellow-400">Wiki</span>
            </button>
          )}

          {/* GitHub Upstream Update & Sync */}
          {onOpenUpdate && (
            <button
              id="open-update-btn"
              onClick={onOpenUpdate}
              title={
                updateInfo?.hasUpdate
                  ? `Update Available: v${updateInfo.latestVersion} on https://github.com/themantas1994/z-30`
                  : 'Check for Updates from https://github.com/themantas1994/z-30'
              }
              className={`p-1.5 border text-xs flex items-center space-x-1 transition-all ${
                updateInfo?.hasUpdate
                  ? 'bg-[#00FF41]/20 hover:bg-[#00FF41]/30 text-[#00FF41] border-[#00FF41] shadow-[0_0_10px_rgba(0,255,65,0.4)] animate-pulse'
                  : 'bg-[#141414] hover:bg-[#1A1A1A] text-cyan-400 hover:text-cyan-300 border-cyan-900/60'
              }`}
            >
              <DownloadCloud className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline text-[11px] font-bold">
                {updateInfo?.hasUpdate ? 'Update Available' : 'Update'}
              </span>
              {updateInfo?.hasUpdate && (
                <span className="w-2 h-2 rounded-full bg-[#00FF41] animate-ping ml-0.5" />
              )}
            </button>
          )}

          {/* Settings */}
          <button
            id="open-settings-btn"
            onClick={onOpenSettings}
            title="Station & CAT Settings"
            className="p-1.5 bg-[#141414] hover:bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333] text-xs flex items-center space-x-1"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Settings</span>
          </button>

          {/* Specs / Help */}
          <button
            id="open-specs-btn"
            onClick={onOpenSpecs}
            title="z-30 Physical Layer Specifications"
            className="p-1.5 bg-[#141414] hover:bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333] text-xs"
          >
            <HelpCircle className="w-3.5 h-3.5 text-purple-400" />
          </button>

          {/* Fullscreen Mode Toggle */}
          <button
            id="toggle-fullscreen-btn"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (F11 / Esc)' : 'Enter Fullscreen Window (F11)'}
            className={`p-1.5 border text-xs transition-colors flex items-center space-x-1 ${
              isFullscreen
                ? 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.4)]'
                : 'bg-[#141414] hover:bg-[#1A1A1A] text-[#888] hover:text-[#00FF41] border-[#333]'
            }`}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden 2xl:inline text-[11px] font-bold">
              {isFullscreen ? 'Exit Full' : 'Fullscreen'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
