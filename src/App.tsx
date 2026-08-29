/**
 * z-30 Digital Mode Transceiver Station & Production DSP Suite
 * 16-MFSK / 50 Hz Bandwidth / 30s Sync Cycle / LDPC + SIC
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DecodedSignal, LogEntry, StationConfig } from './types/z30';
import { DEFAULT_STATION_CONFIG, HAM_BANDS, Z30_SPECS, evaluateSlotTiming } from './dsp/z30Constants';
import { audioEngine } from './dsp/audioEngine';
import { packZ30Message } from './dsp/z30Codec';
import { sicDecoderEngine } from './dsp/sicDecoder';
import { qsoEngine, QsoState } from './dsp/qsoEngine';
import { qsoLogger } from './dsp/qsoLogger';
import { rigctl } from './dsp/catController';

import { Header } from './components/Header';
import { WaterfallDisplay } from './components/WaterfallDisplay';
import { ActivityLogTable } from './components/ActivityLogTable';
import { QsoController } from './components/QsoController';
import { QsoMacrosTransmitPanel } from './components/QsoMacrosTransmitPanel';
import { RigControlPanel } from './components/RigControlPanel';
import { LogbookModal } from './components/LogbookModal';
import { StationSettingsModal } from './components/StationSettingsModal';
import { SetupWizardModal } from './components/SetupWizardModal';
import { SpecsModal } from './components/SpecsModal';
import { BandManagerModal } from './components/BandManagerModal';
import { RfTimeSyncModal } from './components/RfTimeSyncModal';
import { WikiModal } from './components/WikiModal';
import { UpdateModal } from './components/UpdateModal';
import { MonteCarloBenchmarkModal } from './components/MonteCarloBenchmarkModal';
import { updateEngine } from './dsp/updateEngine';

export default function App() {
  // Station & Hardware Config (Initialized from LocalStorage if available)
  const [config, setConfig] = useState<StationConfig>(() => {
    try {
      const saved = localStorage.getItem('z30_station_config');
      if (saved) {
        return { ...DEFAULT_STATION_CONFIG, ...JSON.parse(saved) };
      }
    } catch {
      // fallback
    }
    return DEFAULT_STATION_CONFIG;
  });

  const [currentBandIdx, setCurrentBandIdx] = useState<number>(5); // 20m default (14.076 MHz)
  const [dialFreqHz, setDialFreqHz] = useState<number>(HAM_BANDS[5].dialFreqHz);
  const [timeOffsetMs, setTimeOffsetMs] = useState<number>(0);

  // QSO State Machine
  const [qsoState, setQsoState] = useState<QsoState>(qsoEngine.getState());

  // Modals (Setup Wizard opens automatically on first startup if not configured yet)
  const [isLogbookOpen, setIsLogbookOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(() => {
    try {
      const isCompleted = localStorage.getItem('z30_wizard_completed');
      const saved = localStorage.getItem('z30_station_config');
      return !isCompleted && !saved;
    } catch {
      return true;
    }
  });
  const [isSpecsOpen, setIsSpecsOpen] = useState<boolean>(false);
  const [isWikiOpen, setIsWikiOpen] = useState<boolean>(false);
  const [wikiSlug, setWikiSlug] = useState<string>('Home');
  const [isBandManagerOpen, setIsBandManagerOpen] = useState<boolean>(false);
  const [isTimeSyncOpen, setIsTimeSyncOpen] = useState<boolean>(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState<boolean>(false);
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState<boolean>(false);

  // Background update check on application startup
  useEffect(() => {
    try {
      const autoCheck = localStorage.getItem('z30_auto_check_updates') !== 'false';
      if (autoCheck) {
        // Run update check in background without blocking startup
        setTimeout(() => {
          updateEngine.checkForUpdates('STABLE', false).catch(() => {});
        }, 2500);
      }
    } catch {
      // ignore
    }
  }, []);

  // Auto-connect audio receiver if system permission was already granted
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((res) => {
          if (res.state === 'granted' && !audioEngine.getIsMicrophoneActive()) {
            audioEngine.enableMicrophone(config.audioInputDevice);
          }
        })
        .catch(() => {
          // ignore
        });
    }
  }, [config.audioInputDevice]);

  // QSOs, Logs & Band Activity Filter
  const [activityFilter, setActivityFilter] = useState<'ALL' | 'CQ' | 'MYCALL' | 'SIC'>('ALL');
  const [decodes, setDecodes] = useState<DecodedSignal[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>(qsoLogger.getEntries());

  // Subscribe to asynchronous QSO Logger events
  useEffect(() => {
    setLogEntries(qsoLogger.getEntries());
    const unsubscribe = qsoLogger.subscribe((_entry, all) => {
      setLogEntries(all);
    });
    return unsubscribe;
  }, []);

  // Transmitter & Audio Real-Time State
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [isTuning, setIsTuning] = useState<boolean>(false);
  const [cycleProgressSec, setCycleProgressSec] = useState<number>(0);
  const [fwdWatts, setFwdWatts] = useState<number>(0);
  const [swr, setSwr] = useState<number>(1.0);

  // Track if decode was already run for the current 30s cycle
  const lastDecodedCycleRef = useRef<number>(-1);

  // Update Band selection
  const handleBandChange = (bandName: string) => {
    const bandIdx = HAM_BANDS.findIndex((b) => b.name === bandName);
    if (bandIdx !== -1) {
      const band = HAM_BANDS[bandIdx];
      const targetHz = config.customBands?.[bandName] || band.dialFreqHz;
      setCurrentBandIdx(bandIdx);
      setDialFreqHz(targetHz);
      rigctl.setFreqHz(targetHz);
      rigctl.setBandByName(bandName);
    }
  };

  // Perform a full 30s SIC Decode Cycle on real received audio (self-decoding inhibited)
  const executeDecodeCycle = useCallback(() => {
    const result = sicDecoderEngine.runSicDecodeCycle(
      dialFreqHz,
      config.myCall,
      config.myGrid,
      isTransmitting,
      qsoState.txFreqHz
    );

    setDecodes(sicDecoderEngine.getHistory());

    // Process through QSO auto-sequencing state machine if decodes arrived
    if (result.decodes.length > 0) {
      const autoResult = qsoEngine.processDecodesForAutoSeq(
        result.decodes,
        config,
        HAM_BANDS[currentBandIdx].name,
        dialFreqHz
      );

      setQsoState(qsoEngine.getState());

      if (autoResult.autoLogged) {
        qsoLogger.logQsoAsync(autoResult.autoLogged);
      }
    }
  }, [dialFreqHz, config, isTransmitting, qsoState.txFreqHz, currentBandIdx]);

  const tuneTimeoutRef = useRef<number | null>(null);

  // Helper to start the 24.0s 16-MFSK physical transmission
  const startActiveTransmission = useCallback(() => {
    if (isTransmitting) return;
    if (isTuning) {
      if (tuneTimeoutRef.current) clearTimeout(tuneTimeoutRef.current);
      tuneTimeoutRef.current = null;
      setIsTuning(false);
      audioEngine.stopTransmission();
    }

    const currentState = qsoEngine.getState();
    const txText = qsoEngine.getCurrentTxMessage(config);
    const packed = packZ30Message(txText);

    setIsTransmitting(true);
    rigctl.setPtt(true, config.pttMethod, config.pttPolarity, {
      pttPort: config.pttPort,
      pttToneFreqHz: config.pttToneFreqHz,
      cm108GpioPin: config.cm108GpioPin,
      rpiGpioPin: config.rpiGpioPin,
      tciHost: config.tciHost,
      tciPort: config.tciPort,
      winkeyerPort: config.winkeyerPort,
    });
    setFwdWatts(config.txPowerWatts);
    setSwr(1.18);

    // Register active signal into local audio frame history with isLocalTx = true (for waterfall display only, not for decoder)
    audioEngine.registerActiveSignal(currentState.txFreqHz, txText, packed.symbols, 6, true);

    audioEngine.play16MfskSequence(
      currentState.txFreqHz,
      packed.symbols,
      undefined,
      () => {
        setIsTransmitting(false);
        rigctl.setPtt(false, config.pttMethod, config.pttPolarity);
        setFwdWatts(0);
        setSwr(1.0);
      },
      {
        enableRightTone: config.pttMethod === 'AUDIO_TONE_RIGHT',
        toneFreqHz: config.pttToneFreqHz || 1000,
        leadInMs: config.pttLeadInMs || 20,
        hangTimeMs: config.pttHangTimeMs || 30,
      }
    );
  }, [config, isTransmitting, isTuning]);

  // Main Synchronous 30-Second Cycle Clock Engine
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date(Date.now() + (timeOffsetMs || 0));
      const seconds = now.getUTCSeconds() + now.getUTCMilliseconds() / 1000.0;
      const cycleSec = seconds % Z30_SPECS.CYCLE_DURATION_SEC; // 0.0 to 30.0
      const cycleNumber = Math.floor(now.getTime() / 30000);
      const isEvenCycle = Math.floor(now.getUTCSeconds() / 30) % 2 === 0;

      setCycleProgressSec(cycleSec);

      // 1. Transmit Initiation Check
      const currentState = qsoEngine.getState();
      const slotMatches =
        currentState.txSlot === 'MANUAL' ||
        (currentState.txSlot === 'EVEN' && isEvenCycle) ||
        (currentState.txSlot === 'ODD' && !isEvenCycle);

      if (currentState.txEnabled && slotMatches && cycleSec < 0.5 && !isTransmitting && !isTuning) {
        startActiveTransmission();
      }

      // 2. Decode Window Trigger (At 24.0s when Tx finishes and Rx window ends)
      if (cycleSec >= 24.0 && lastDecodedCycleRef.current !== cycleNumber) {
        lastDecodedCycleRef.current = cycleNumber;
        executeDecodeCycle();
      }
    }, 100);

    return () => clearInterval(timer);
  }, [config, timeOffsetMs, isTransmitting, isTuning, executeDecodeCycle, startActiveTransmission]);

  // Handle Double-Clicking a Decoded Signal: Arms TX for next cycle
  const handleSelectSignal = (signal: DecodedSignal) => {
    qsoEngine.selectSignalToCall(signal, config);
    setQsoState(qsoEngine.getState());
  };

  // Handle Arming TX at a specific frequency (e.g. from waterfall double-click)
  const handleArmTxAtFreq = (freqHz: number) => {
    qsoEngine.setRxFreq(freqHz, false);
    qsoEngine.setTxFreq(freqHz);
    qsoEngine.setTxEnabled(true);
    setQsoState(qsoEngine.getState());
  };

  // Start Transmission: Checks if within selected slot, otherwise arms station to transmit when slot begins
  const handleStartTx = () => {
    if (isTransmitting) return;
    if (isTuning) handleStopTune();

    // 1. Enable & Arm TX in state machine
    qsoEngine.setTxEnabled(true);
    const updatedState = qsoEngine.getState();
    setQsoState(updatedState);

    // If starting a CQ transmission or in CALLING_CQ stage, auto-switch main decodes view to MY CALL
    const txMsg = qsoEngine.getCurrentTxMessage(config);
    if (txMsg.startsWith('CQ') || updatedState.stage === 'CALLING_CQ' || updatedState.currentTxMacro === 'tx1' || updatedState.currentTxMacro === 'tx6') {
      setActivityFilter('MYCALL');
    }

    // 2. Check if currently at beginning of selected slot (0.0 to 1.5s)
    const slotInfo = evaluateSlotTiming(updatedState.txSlot, new Date());

    if (slotInfo.canTransmitImmediately) {
      startActiveTransmission();
    }
  };

  // Stop / Abort Transmission Immediately (Halt TX / Disarm)
  const handleStopTx = () => {
    audioEngine.stopTransmission();
    if (tuneTimeoutRef.current) {
      clearTimeout(tuneTimeoutRef.current);
      tuneTimeoutRef.current = null;
    }
    setIsTransmitting(false);
    setIsTuning(false);
    rigctl.setPtt(false, config.pttMethod, config.pttPolarity);
    setFwdWatts(0);
    setSwr(1.0);
    qsoEngine.setTxEnabled(false);
    setQsoState(qsoEngine.getState());
  };

  // Toggle Transmit Armed State
  const handleToggleTx = () => {
    const nextVal = !qsoState.txEnabled;
    qsoEngine.setTxEnabled(nextVal);
    setQsoState(qsoEngine.getState());

    if (!nextVal && isTransmitting) {
      handleStopTx();
    }
  };

  // Tune Tone (CW Carrier for antenna matching with 15s auto-safety cutoff)
  const handleStartTune = () => {
    if (isTransmitting) {
      audioEngine.stopTransmission();
      setIsTransmitting(false);
    }
    setIsTuning(true);
    rigctl.setPtt(true, config.pttMethod, config.pttPolarity, {
      pttPort: config.pttPort,
      pttToneFreqHz: config.pttToneFreqHz,
      cm108GpioPin: config.cm108GpioPin,
      rpiGpioPin: config.rpiGpioPin,
      tciHost: config.tciHost,
      tciPort: config.tciPort,
      winkeyerPort: config.winkeyerPort,
    });
    setFwdWatts(config.txPowerWatts);
    setSwr(1.15);
    audioEngine.startTuneTone(qsoState.txFreqHz, {
      enableRightTone: config.pttMethod === 'AUDIO_TONE_RIGHT',
      toneFreqHz: config.pttToneFreqHz || 1000,
    });

    if (tuneTimeoutRef.current) clearTimeout(tuneTimeoutRef.current);
    tuneTimeoutRef.current = window.setTimeout(() => {
      handleStopTune();
    }, 15000);
  };

  const handleStopTune = () => {
    if (tuneTimeoutRef.current) {
      clearTimeout(tuneTimeoutRef.current);
      tuneTimeoutRef.current = null;
    }
    setIsTuning(false);
    rigctl.setPtt(false, config.pttMethod, config.pttPolarity);
    setFwdWatts(0);
    setSwr(1.0);
    audioEngine.stopTransmission();
  };

  // Frequency Updates
  const handleSetRxFreq = (freqHz: number) => {
    qsoEngine.setRxFreq(freqHz, !config.holdTxFreq);
    setQsoState(qsoEngine.getState());
  };

  const handleSetTxFreq = (freqHz: number) => {
    qsoEngine.setTxFreq(freqHz);
    setQsoState(qsoEngine.getState());
  };

  // Called whenever user initiates CQ or selects CQ macro
  const handleCallingCq = useCallback(() => {
    setActivityFilter('MYCALL');
  }, []);

  const handleSaveStationConfig = useCallback((newCfg: StationConfig) => {
    setConfig(newCfg);
    try {
      localStorage.setItem('z30_station_config', JSON.stringify(newCfg));
      localStorage.setItem('z30_wizard_completed', 'true');
    } catch {
      // ignore
    }
    // Reconnect/activate the audio receiver stream with the chosen soundcard input
    audioEngine.enableMicrophone(newCfg.audioInputDevice);
  }, []);

  const handleUpdateConfig = useCallback((partial: Partial<StationConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem('z30_station_config', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleUpdateQsoState = (partial: Partial<QsoState>) => {
    Object.assign(qsoState, partial);
    if (
      partial.stage === 'CALLING_CQ' ||
      partial.currentTxMacro === 'tx1' ||
      partial.currentTxMacro === 'tx6'
    ) {
      setActivityFilter('MYCALL');
    }
    setQsoState({ ...qsoState });
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0A0A] text-[#D4D4D4] font-mono select-none overflow-hidden">
      {/* Top Header & 30s Cycle Clock */}
      <Header
        config={config}
        currentBandName={HAM_BANDS[currentBandIdx].name}
        dialFreqHz={dialFreqHz}
        isTransmitting={isTransmitting}
        isTuning={isTuning}
        txEnabled={qsoState.txEnabled}
        txSlot={qsoState.txSlot}
        onOpenLogbook={() => setIsLogbookOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWizard={() => setIsWizardOpen(true)}
        onOpenSpecs={() => setIsSpecsOpen(true)}
        onOpenBenchmark={() => setIsBenchmarkOpen(true)}
        onOpenWiki={(slug) => {
          if (slug) setWikiSlug(slug);
          setIsWikiOpen(true);
        }}
        onOpenTimeSync={() => setIsTimeSyncOpen(true)}
        onOpenUpdate={() => setIsUpdateOpen(true)}
        timeOffsetMs={timeOffsetMs}
        onTriggerDecode={executeDecodeCycle}
        onStartTx={handleStartTx}
        onStopTx={handleStopTx}
        onStartTune={handleStartTune}
        onStopTune={handleStopTune}
        cycleProgressSec={cycleProgressSec}
      />

      {/* Main Workspace */}
      <main className="flex-1 overflow-hidden p-1.5 sm:p-2 w-full flex flex-col min-h-0">
        <div className="flex flex-col h-full space-y-1.5 sm:space-y-2 min-h-0 flex-1 overflow-hidden">
          {/* Top: 60 FPS Spectral Waterfall & Spectrogram */}
          <div className="flex-shrink-0">
            <WaterfallDisplay
              rxFreqHz={qsoState.rxFreqHz}
              txFreqHz={qsoState.txFreqHz}
              onSetRxFreq={handleSetRxFreq}
              onSetTxFreq={handleSetTxFreq}
              onDoubleClickSignal={handleSelectSignal}
              onArmTxAtFreq={handleArmTxAtFreq}
              isTransmitting={isTransmitting}
              isTuning={isTuning}
              decodes={decodes}
              currentBand={HAM_BANDS[currentBandIdx]}
              dialFreqHz={dialFreqHz}
              onBandChange={handleBandChange}
              onOpenBandManager={() => setIsBandManagerOpen(true)}
              fwdWatts={fwdWatts}
              swr={swr}
            />
          </div>

          {/* Bottom Grid: 3 Dedicated Windows (Activity Decodes, QSO Macros/PTT Sequencer, DX Target & CAT Rig) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-1.5 sm:gap-2 flex-1 min-h-0 overflow-hidden">
            {/* Window 1 (lg:col-span-5): Band Activity & Multi-Pass SIC Decodes (Scrollable) */}
            <div className="lg:col-span-5 h-full min-h-[220px] lg:min-h-0 flex flex-col overflow-hidden">
              <ActivityLogTable
                decodes={decodes}
                myCall={config.myCall}
                filterType={activityFilter}
                onFilterChange={setActivityFilter}
                onSelectSignal={handleSelectSignal}
                onClearHistory={() => {
                  sicDecoderEngine.clearHistory();
                  setDecodes([]);
                }}
              />
            </div>

            {/* Window 2 (lg:col-span-4): Standard QSO Macros, Auto-Reply Rule & PTT Action Sequencer */}
            <div className="lg:col-span-4 h-full min-h-[240px] lg:min-h-0 flex flex-col overflow-y-auto">
              <QsoMacrosTransmitPanel
                qsoState={qsoState}
                config={config}
                currentBand={HAM_BANDS[currentBandIdx].name}
                isTransmitting={isTransmitting}
                isTuning={isTuning}
                onUpdateState={handleUpdateQsoState}
                onUpdateConfig={handleUpdateConfig}
                onCallingCq={handleCallingCq}
                onToggleTx={handleToggleTx}
                onStartTx={handleStartTx}
                onStopTx={handleStopTx}
                onStartTune={handleStartTune}
                onStopTune={handleStopTune}
              />
            </div>

            {/* Window 3 (lg:col-span-3): Target DX Station & Rig CAT Controller */}
            <div className="lg:col-span-3 h-full min-h-[240px] lg:min-h-0 flex flex-col space-y-1.5 sm:space-y-2 overflow-y-auto">
              {/* Target DX Station State */}
              <div className="flex-1 min-h-[140px]">
                <QsoController
                  qsoState={qsoState}
                  config={config}
                  currentBand={HAM_BANDS[currentBandIdx].name}
                  isTransmitting={isTransmitting}
                  onUpdateState={handleUpdateQsoState}
                  onUpdateConfig={handleUpdateConfig}
                  fwdWatts={fwdWatts}
                  swr={swr}
                  isTuning={isTuning}
                />
              </div>

              {/* Rig VFO & CAT Status */}
              <div className="h-40 sm:h-44 flex-shrink-0">
                <RigControlPanel
                  currentBand={HAM_BANDS[currentBandIdx]}
                  dialFreqHz={dialFreqHz}
                  config={config}
                  onBandChange={handleBandChange}
                  onFreqChange={(hz) => {
                    setDialFreqHz(hz);
                    rigctl.setFreqHz(hz);
                  }}
                  isTransmitting={isTransmitting}
                  isTuning={isTuning}
                  onStartTune={handleStartTune}
                  onStopTune={handleStopTune}
                  onOpenBandManager={() => setIsBandManagerOpen(true)}
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      <BandManagerModal
        isOpen={isBandManagerOpen}
        onClose={() => setIsBandManagerOpen(false)}
        config={config}
        currentBandName={HAM_BANDS[currentBandIdx].name}
        currentDialFreqHz={dialFreqHz}
        onSelectBandAndFreq={(bandName, freqHz) => {
          const idx = HAM_BANDS.findIndex((b) => b.name === bandName);
          if (idx !== -1) {
            setCurrentBandIdx(idx);
            setDialFreqHz(freqHz);
          }
        }}
        onSaveConfig={(updated) => handleUpdateConfig(updated)}
      />

      <LogbookModal
        isOpen={isLogbookOpen}
        onClose={() => setIsLogbookOpen(false)}
        entries={logEntries}
        myCall={config.myCall}
        myGrid={config.myGrid}
      />

      <StationSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSaveConfig={handleSaveStationConfig}
        onExecuteDecodeNow={executeDecodeCycle}
        onOpenUpdate={() => setIsUpdateOpen(true)}
        onOpenWizard={() => {
          setIsSettingsOpen(false);
          setIsWizardOpen(true);
        }}
      />

      <SetupWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        config={config}
        onSaveConfig={handleSaveStationConfig}
      />

      <SpecsModal
        isOpen={isSpecsOpen}
        onClose={() => setIsSpecsOpen(false)}
        onOpenBenchmark={() => setIsBenchmarkOpen(true)}
      />

      <MonteCarloBenchmarkModal
        isOpen={isBenchmarkOpen}
        onClose={() => setIsBenchmarkOpen(false)}
      />

      <WikiModal
        isOpen={isWikiOpen}
        onClose={() => setIsWikiOpen(false)}
        initialArticleSlug={wikiSlug}
      />

      <RfTimeSyncModal
        isOpen={isTimeSyncOpen}
        onClose={() => setIsTimeSyncOpen(false)}
        config={config}
        currentOffsetMs={timeOffsetMs}
        onApplyOffset={(offsetMs) => {
          setTimeOffsetMs(offsetMs);
          handleUpdateConfig({ appTimeOffsetMs: offsetMs });
        }}
      />

      <UpdateModal
        isOpen={isUpdateOpen}
        onClose={() => setIsUpdateOpen(false)}
      />
    </div>
  );
}
