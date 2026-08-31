/**
 * z-30 Digital Mode Transceiver Station & Production DSP Suite
 * 16-MFSK / 50 Hz Bandwidth / 30s Sync Cycle / LDPC + SIC
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DecodedSignal, LogEntry, StationConfig } from './types/z30';
import { HAM_BANDS, Z30_SPECS, evaluateSlotTiming } from './dsp/z30Constants';
import { audioEngine } from './dsp/audioEngine';
import { packZ30Message } from './dsp/z30Codec';
import { sicDecoderEngine } from './dsp/sicDecoder';
import { qsoEngine, QsoState } from './dsp/qsoEngine';
import { qsoLogger, StorageStatus } from './dsp/qsoLogger';
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
import {
  loadStationConfigFromBrowser,
  loadStationConfigFromServer,
  saveStationConfig,
} from './dsp/stationConfigStore';

export default function App() {
  // Station & Hardware Config (Initialized from LocalStorage if available)
  // Validated on load rather than spread in blind: these fields feed the transmit path, and a
  // truncated write or a hand-edited store must not put a wrong-typed value on that path.
  const [config, setConfig] = useState<StationConfig>(() => loadStationConfigFromBrowser().config);

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

  useEffect(() => qsoLogger.subscribeToStorageStatus(setStorageStatus), []);

  // The native server keeps a copy of the station config on disk. It outlives cleared browsing
  // data and a changed port number, both of which wipe localStorage, so prefer it on startup.
  useEffect(() => {
    let cancelled = false;
    void loadStationConfigFromServer().then((serverConfig) => {
      if (!cancelled && serverConfig) setConfig(serverConfig);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the CAT controller's active protocol family (CI-V / Kenwood-ASCII / none) and
  // CI-V address in sync with the configured rig model, so setFreqHz/setMode/setPtt send the
  // right real hardware protocol whenever the operator changes rigs.
  useEffect(() => {
    rigctl.configureRig(config.rigModel);
    // Hamlib network mode routes frequency/mode/PTT through the native server's rigctld TCP
    // relay, which is the only way a browser can reach the daemon at all.
    rigctl.configureHamlibEndpoint(
      config.hamlibHost,
      config.hamlibPort,
      config.catEnabled && config.catMethod === 'Hamlib'
    );
  }, [config.rigModel, config.hamlibHost, config.hamlibPort, config.catEnabled, config.catMethod]);

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
  /**
   * Reasons the last transmit attempt was refused by rigctl.canTransmit(). Non-empty means a
   * carrier was never generated - the gate runs before PTT is asserted, not after.
   */
  const [txBlockReasons, setTxBlockReasons] = useState<string[]>([]);
  /**
   * Where the logbook is actually being persisted, and whether the last write succeeded. A
   * quota-exceeded localStorage write used to be caught and logged to the console only, so an
   * operator could log contacts all evening into a store that was silently discarding them.
   */
  const [storageStatus, setStorageStatus] = useState<StorageStatus>(() => qsoLogger.getStorageStatus());

  // Mirrors isTransmitting/isTuning for the page-unload safety handler below, which needs to
  // read the CURRENT value at unload time without re-registering its listener on every change.
  const isTransmittingRef = useRef(false);
  const isTuningRef = useRef(false);
  useEffect(() => {
    isTransmittingRef.current = isTransmitting;
    isTuningRef.current = isTuning;
  }, [isTransmitting, isTuning]);

  // SAFETY: release PTT across every hardware path if the page is closed, reloaded, or
  // navigated away from while actively transmitting or tuning. Without this, closing the
  // browser tab (or a crash, or the OS sleeping the machine) mid-transmission leaves a real
  // transmitter keyed indefinitely - a regulatory violation and an equipment-damage risk that
  // this app previously had zero protection against; releasePttEmergency() existed but was
  // never actually wired to any page-lifecycle event.
  useEffect(() => {
    const releaseIfTransmitting = () => {
      if (isTransmittingRef.current || isTuningRef.current) {
        rigctl.releasePttEmergency();
        audioEngine.stopTransmission();
      }
    };
    window.addEventListener('beforeunload', releaseIfTransmitting);
    window.addEventListener('pagehide', releaseIfTransmitting);
    return () => {
      window.removeEventListener('beforeunload', releaseIfTransmitting);
      window.removeEventListener('pagehide', releaseIfTransmitting);
    };
  }, []);

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
      qsoState.txFreqHz,
      timeOffsetMs
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
  }, [dialFreqHz, config, isTransmitting, qsoState.txFreqHz, currentBandIdx, timeOffsetMs]);

  const tuneTimeoutRef = useRef<number | null>(null);

  /**
   * Hardware addressing for the configured PTT method, in one place.
   *
   * Every key AND every unkey passes this. An unkey that omitted it used to fall through to
   * catController's hardcoded defaults and release the wrong pin or host - see the note in
   * setPtt. The controller now also falls back to the keying context, so this is belt and
   * braces; keep both, because the two defend different callers.
   */
  const pttOptions = useMemo(
    () => ({
      pttPort: config.pttPort,
      pttToneFreqHz: config.pttToneFreqHz,
      cm108GpioPin: config.cm108GpioPin,
      rpiGpioPin: config.rpiGpioPin,
      tciHost: config.tciHost,
      tciPort: config.tciPort,
      winkeyerPort: config.winkeyerPort,
    }),
    [
      config.pttPort,
      config.pttToneFreqHz,
      config.cm108GpioPin,
      config.rpiGpioPin,
      config.tciHost,
      config.tciPort,
      config.winkeyerPort,
    ]
  );

  /**
   * The one gate every transmit path in this component goes through.
   *
   * Runs rigctl.canTransmit() and, on refusal, disarms TX and surfaces the reasons in the
   * banner rather than failing silently. Everything that can key a radio - the automatic QSO
   * sequencer, the manual TX button, and the tune carrier - calls this first, because a check
   * that only some transmit paths perform is not a check.
   */
  const assertCanTransmit = useCallback(
    (audioOffsetHz: number): boolean => {
      const permission = rigctl.canTransmit(config, audioOffsetHz, dialFreqHz);
      setTxBlockReasons(permission.allowed ? [] : permission.violations);
      if (!permission.allowed) {
        qsoEngine.setTxEnabled(false);
        setQsoState(qsoEngine.getState());
      }
      return permission.allowed;
    },
    [config, dialFreqHz]
  );

  // Helper to start the 24.0s 16-MFSK physical transmission
  const startActiveTransmission = useCallback(() => {
    if (isTransmitting) return;
    if (!assertCanTransmit(qsoEngine.getState().txFreqHz)) return;
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
    rigctl.setPtt(true, config.pttMethod, config.pttPolarity, pttOptions);
    setFwdWatts(config.txPowerWatts);

    // Register active signal into local audio frame history with isLocalTx = true (for waterfall display only, not for decoder)
    audioEngine.registerActiveSignal(currentState.txFreqHz, txText, packed.symbols, 6, true);

    audioEngine.play16MfskSequence(
      currentState.txFreqHz,
      packed.symbols,
      undefined,
      () => {
        setIsTransmitting(false);
        rigctl.setPtt(false, config.pttMethod, config.pttPolarity, pttOptions);
        setFwdWatts(0);
          },
      {
        enableRightTone: config.pttMethod === 'AUDIO_TONE_RIGHT',
        toneFreqHz: config.pttToneFreqHz || 1000,
        leadInMs: config.pttLeadInMs || 20,
        hangTimeMs: config.pttHangTimeMs || 30,
      }
    );
  }, [config, isTransmitting, isTuning, assertCanTransmit, pttOptions]);

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

  // Handle Arming TX at a specific frequency (e.g. from waterfall double-click).
  //
  // The gate runs here as well as before the carrier. It is not the safety check - that is
  // startActiveTransmission's assertCanTransmit, which is what actually stands between the app
  // and an out-of-band emission, and it has not moved. This one exists so that the header
  // stops showing a pulsing green "Armed (Ns)" countdown for a station that will be refused
  // the moment the slot opens: the operator finds out a cycle earlier, with the reasons.
  const handleArmTxAtFreq = (freqHz: number) => {
    qsoEngine.setRxFreq(freqHz, false);
    qsoEngine.setTxFreq(freqHz);
    if (!assertCanTransmit(freqHz)) {
      setQsoState(qsoEngine.getState());
      return;
    }
    qsoEngine.setTxEnabled(true);
    setQsoState(qsoEngine.getState());
  };

  // Start Transmission: Checks if within selected slot, otherwise arms station to transmit when slot begins
  const handleStartTx = () => {
    if (isTransmitting) return;
    if (isTuning) handleStopTune();

    // Surface a refusal at arm time rather than at slot start. See handleArmTxAtFreq: the
    // binding check is still the one in startActiveTransmission.
    if (!assertCanTransmit(qsoEngine.getState().txFreqHz)) {
      setQsoState(qsoEngine.getState());
      return;
    }

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
    rigctl.setPtt(false, config.pttMethod, config.pttPolarity, pttOptions);
    setFwdWatts(0);
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
    if (!assertCanTransmit(qsoState.txFreqHz)) return;
    if (isTransmitting) {
      audioEngine.stopTransmission();
      setIsTransmitting(false);
    }
    setIsTuning(true);
    rigctl.setPtt(true, config.pttMethod, config.pttPolarity, pttOptions);
    setFwdWatts(config.txPowerWatts);
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
    rigctl.setPtt(false, config.pttMethod, config.pttPolarity, pttOptions);
    setFwdWatts(0);
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
    saveStationConfig(newCfg);
    try {
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
      saveStationConfig(next);
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
      {/* Transmit refused: the gate ran before any carrier was generated. */}
      {txBlockReasons.length > 0 && (
        <div className="bg-[#3a1111] border-b-2 border-red-500 px-4 py-2 text-xs text-red-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <strong className="text-red-400">TRANSMIT BLOCKED — nothing was keyed.</strong>
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {txBlockReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="shrink-0 border border-red-500 px-2 py-0.5 hover:bg-red-900"
              onClick={() => setTxBlockReasons([])}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Logbook persistence: a failed or browser-only save is stated, not hidden. */}
      {(!storageStatus.ok || storageStatus.error) && (
        <div
          className={`px-4 py-1.5 text-[11px] border-b ${
            storageStatus.ok
              ? 'bg-[#1a1405] border-[#3a2f0a] text-yellow-200'
              : 'bg-[#3a1111] border-red-500 text-red-200'
          }`}
        >
          <strong>{storageStatus.ok ? 'LOGBOOK STORAGE' : 'LOGBOOK NOT SAVED'}:</strong>{' '}
          {storageStatus.error}
        </div>
      )}

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
                  fwdWatts={fwdWatts}
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
                  onAssertCanTransmit={assertCanTransmit}
                  txAudioOffsetHz={qsoState.txFreqHz}
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
        onOpenBenchmark={() => setIsBenchmarkOpen(true)}
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
