/**
 * Station Configuration & Hardware Setup Modal
 * Full Transceiver Settings with all Wizard Options & Re-run Wizard Action
 */

import React, { useState, useEffect, useRef } from 'react';
import { StationConfig } from '../types/z30';
import {
  Settings,
  X,
  Save,
  Shield,
  Radio,
  Volume2,
  Cpu,
  Wand2,
  Play,
  Square,
  MapPin,
  RefreshCw,
  Sliders,
  CheckCircle2,
  RotateCcw,
  Globe,
  Clock,
  FlaskConical,
  Activity,
  Sparkles,
  Zap,
  PlayCircle,
  Trash2,
  HelpCircle,
  Check,
  Lock,
  Unlock,
  ShieldAlert,
} from 'lucide-react';
import { RIG_CATALOG } from './SetupWizardModal';
import { AUTO_REPLY_OPTIONS, PTT_METHODS_CATALOG, Z30_SPECS } from '../dsp/z30Constants';
import { audioEngine, SystemAudioDevice, AudioSystemDiagnostics } from '../dsp/audioEngine';
import { sicDecoderEngine } from '../dsp/sicDecoder';
import {
  TIMEZONE_CATALOG,
  formatUtcTime,
  formatTimeInTimezone,
  getTimezoneOffsetString,
  resolveEffectiveTimezone,
} from '../dsp/timeUtils';
import {
  HAMLIB_ALL_RIGS,
  CURRENT_HAMLIB_VERSION,
  searchHamlibRigs,
  getHamlibManufacturers,
  updateHamlibLibrary,
  getRigByName,
} from '../dsp/hamlibCatalog';
import { catController, DiscoveredSerialPort } from '../dsp/catController';
import { DownloadCloud, CheckCircle, AlertTriangle, Terminal, Cable, Radio as RadioIcon } from 'lucide-react';

interface StationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StationConfig;
  onSaveConfig: (cfg: StationConfig) => void;
  onOpenWizard?: () => void;
  onExecuteDecodeNow?: () => void;
  onOpenUpdate?: () => void;
}

// Helpers for validation
const CALLSIGN_REGEX = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/i;
const GRID_REGEX = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i;

function maidenheadToLatLon(grid: string): { lat: number; lon: number } | null {
  const g = grid.trim().toUpperCase();
  if (g.length < 4) return null;
  try {
    let lon = (g.charCodeAt(0) - 65) * 20 - 180 + parseInt(g[2], 10) * 2;
    let lat = (g.charCodeAt(1) - 65) * 10 - 90 + parseInt(g[3], 10) * 1;
    if (g.length >= 6) {
      lon += (g.charCodeAt(4) - 65 + 0.5) * (5.0 / 60.0);
      lat += (g.charCodeAt(5) - 65 + 0.5) * (2.5 / 60.0);
    } else {
      lon += 1.0;
      lat += 0.5;
    }
    return { lat, lon };
  } catch {
    return null;
  }
}

export const StationSettingsModal: React.FC<StationSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onOpenWizard,
  onExecuteDecodeNow,
  onOpenUpdate,
}) => {
  const [form, setForm] = useState<StationConfig>({ ...config });
  const [activeTab, setActiveTab] = useState<'STATION' | 'AUDIO' | 'RADIO' | 'AUTOMATION' | 'TESTING'>('STATION');

  // Experimental Testing & Signal Generation State (Guarded / Locked by Default)
  const [isExperimentalUnlocked, setIsExperimentalUnlocked] = useState<boolean>(() => audioEngine.isExperimentalModeEnabled());
  const [riskAgreementChecked, setRiskAgreementChecked] = useState<boolean>(false);
  const [testPreset, setTestPreset] = useState<string>('S9_CQ_JA1ABC');
  const [testCustomMsg, setTestCustomMsg] = useState<string>('CQ W1AW FN31');
  const [testFreqHz, setTestFreqHz] = useState<number>(1250);
  const [testSnrDb, setTestSnrDb] = useState<number>(6);
  const [testPlayAudio, setTestPlayAudio] = useState<boolean>(true);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);
  const [testDecodeResult, setTestDecodeResult] = useState<{
    timestamp: string;
    decodedCount: number;
    signals: Array<{ freq: number; snr: number; message: string; sicPass: number; isCq?: boolean; callFrom?: string }>;
  } | null>(null);
  const [isInjectingSignal, setIsInjectingSignal] = useState<boolean>(false);
  const [isVerifyingDecode, setIsVerifyingDecode] = useState<boolean>(false);

  // Real System Audio Devices & Diagnostics
  const [systemInputs, setSystemInputs] = useState<SystemAudioDevice[]>([]);
  const [systemOutputs, setSystemOutputs] = useState<SystemAudioDevice[]>([]);
  const [isScanningDevices, setIsScanningDevices] = useState<boolean>(false);
  const [audioPermissionGranted, setAudioPermissionGranted] = useState<boolean>(false);
  const [diagnostics, setDiagnostics] = useState<AudioSystemDiagnostics | null>(null);

  // Audio test meter state
  const [isAudioTesting, setIsAudioTesting] = useState<boolean>(false);
  const [vuLevel, setVuLevel] = useState<number>(0);
  const [peakDb, setPeakDb] = useState<number>(-100);
  const [rmsDb, setRmsDb] = useState<number>(-100);
  const [isClipping, setIsClipping] = useState<boolean>(false);
  const audioAnimRef = useRef<number | null>(null);

  // CAT & PTT test state
  const [catTestStatus, setCatTestStatus] = useState<string>('');
  const [catTestSuccess, setCatTestSuccess] = useState<boolean | null>(null);
  const [isCatTesting, setIsCatTesting] = useState<boolean>(false);
  const [isPttTesting, setIsPttTesting] = useState<boolean>(false);
  const [pttTestMsg, setPttTestMsg] = useState<string>('');
  const pttTimeoutRef = useRef<number | null>(null);

  // Hamlib Library Version & Catalog State
  const [hamlibLibVersion, setHamlibLibVersion] = useState<string>(CURRENT_HAMLIB_VERSION.version);
  const [hamlibReleaseDate, setHamlibReleaseDate] = useState<string>(CURRENT_HAMLIB_VERSION.releaseDate);
  const [isUpdatingHamlib, setIsUpdatingHamlib] = useState<boolean>(false);
  const [hamlibUpdateMsg, setHamlibUpdateMsg] = useState<string>('');
  const [hamlibSearch, setHamlibSearch] = useState<string>('');
  const [hamlibMfg, setHamlibMfg] = useState<string>('ALL');
  const [isConnectingSerial, setIsConnectingSerial] = useState<boolean>(false);
  const [serialFeedback, setSerialFeedback] = useState<string>('');
  const [discoveredPorts, setDiscoveredPorts] = useState<DiscoveredSerialPort[]>([]);
  const [isQueryingSerial, setIsQueryingSerial] = useState<boolean>(false);
  const [isCustomPortMode, setIsCustomPortMode] = useState<boolean>(false);

  // Scan system serial ports from browser hardware layer
  const scanSerialPorts = async () => {
    setIsQueryingSerial(true);
    try {
      const ports = await catController.queryRealSerialPorts();
      setDiscoveredPorts(ports);
    } catch (e) {
      console.warn('Failed to query serial ports in settings:', e);
    } finally {
      setIsQueryingSerial(false);
    }
  };

  // Scan system audio devices
  const scanSystemDevices = async (requestPermission = false) => {
    setIsScanningDevices(true);
    try {
      if (requestPermission) {
        const permRes = await audioEngine.requestSystemAudioPermission();
        if (permRes.success) {
          setSystemInputs(permRes.inputs);
          setSystemOutputs(permRes.outputs);
          setAudioPermissionGranted(true);
        }
      } else {
        const res = await audioEngine.getSystemAudioDevices();
        setSystemInputs(res.inputs);
        setSystemOutputs(res.outputs);
        setAudioPermissionGranted(res.hasPermission);
      }
      const diag = await audioEngine.getDiagnostics();
      setDiagnostics(diag);
    } catch (e) {
      console.warn('Failed to query system audio devices:', e);
    } finally {
      setIsScanningDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setForm({ ...config });
      setIsAudioTesting(false);
      setIsPttTesting(false);
      setPttTestMsg('');
      setCatTestStatus('');
      setCatTestSuccess(null);
      setHamlibUpdateMsg('');
      setSerialFeedback('');
      scanSystemDevices(false);
      scanSerialPorts();

      // Subscribe to real-time USB plug/unplug events
      const unsubscribe = catController.subscribeToPortChanges((ports) => {
        setDiscoveredPorts(ports);
      });
      return () => {
        unsubscribe();
      };
    } else {
      if (isAudioTesting) {
        stopAudioTest();
      }
      if (isPttTesting) {
        catController.releasePttEmergency();
        setIsPttTesting(false);
      }
    }
  }, [isOpen, config]);

  useEffect(() => {
    return () => {
      if (audioAnimRef.current) cancelAnimationFrame(audioAnimRef.current);
      if (pttTimeoutRef.current) clearTimeout(pttTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    setIsAudioTesting(false);
    if (isPttTesting) {
      catController.releasePttEmergency();
      setIsPttTesting(false);
    }
    // Keep/activate the selected audio receiver stream running for the station
    await audioEngine.enableMicrophone(form.audioInputDevice);
    onSaveConfig(form);
    onClose();
  };

  const handleLaunchWizard = () => {
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    setIsAudioTesting(false);
    if (isPttTesting) {
      catController.releasePttEmergency();
      setIsPttTesting(false);
    }
    onClose();
    if (onOpenWizard) {
      onOpenWizard();
    }
  };

  // Live Real Audio VU Meter
  const startAudioTest = async () => {
    setIsAudioTesting(true);
    // Find device ID matching selected device string
    const matchingInput = systemInputs.find(
      (d) => d.label === form.audioInputDevice || d.deviceId === form.audioInputDevice
    );
    const success = await audioEngine.enableMicrophone(matchingInput?.deviceId);
    if (!success) {
      // Prompt permission if needed
      await scanSystemDevices(true);
    }

    const updateMeter = () => {
      const meter = audioEngine.getAudioMeter();
      setPeakDb(meter.peakDb);
      setRmsDb(meter.rmsDb);
      setVuLevel(meter.linearLevel);
      setIsClipping(meter.isClipping);
      audioAnimRef.current = requestAnimationFrame(updateMeter);
    };
    audioAnimRef.current = requestAnimationFrame(updateMeter);
  };

  const stopAudioTest = () => {
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    audioEngine.disableMicrophone();
    setIsAudioTesting(false);
    setVuLevel(0);
    setPeakDb(-100);
    setRmsDb(-100);
    setIsClipping(false);
  };

  const toggleAudioTest = () => {
    if (isAudioTesting) {
      stopAudioTest();
    } else {
      startAudioTest();
    }
  };

  // Update Hamlib Library Handler
  const handleUpdateHamlib = async () => {
    setIsUpdatingHamlib(true);
    setHamlibUpdateMsg('Connecting to Hamlib upstream repository to update transceiver models & CI-V tables...');
    try {
      const res = await updateHamlibLibrary();
      setHamlibLibVersion(res.version);
      setHamlibReleaseDate(res.releaseDate);
      setHamlibUpdateMsg(res.message);
    } catch (e: any) {
      setHamlibUpdateMsg(`✗ Hamlib update failed: ${e?.message || 'Network timeout'}`);
    } finally {
      setIsUpdatingHamlib(false);
    }
  };

  // Real Web Serial Hardware Pairing Handler
  const handleConnectSerial = async () => {
    setIsConnectingSerial(true);
    setSerialFeedback('Querying OS native USB/Serial hardware devices...');
    try {
      const res = await catController.requestAndPairRealPort(form.baudRate || 115200);
      if (res.success && res.portInfo) {
        setSerialFeedback(`✓ ${res.message}`);
        setForm((prev) => ({ ...prev, serialPort: res.portInfo!.displayName || res.portInfo!.path }));
        await scanSerialPorts();
      } else {
        setSerialFeedback(`✗ ${res.message}`);
      }
    } catch (e: any) {
      setSerialFeedback(`✗ Serial error: ${e?.message || 'Hardware device query cancelled'}`);
    } finally {
      setIsConnectingSerial(false);
    }
  };

  // REAL CAT Query Test Handler (NO FALSE PASS)
  const handleTestCat = async () => {
    setIsCatTesting(true);
    setCatTestStatus('Executing hardware query to rig (checking Web Serial & Hamlib daemon)...');
    setCatTestSuccess(null);

    try {
      const result = await catController.testCatConnection(form);
      setCatTestSuccess(result.success);
      setCatTestStatus(result.message);
    } catch (err: any) {
      setCatTestSuccess(false);
      setCatTestStatus(`✗ CAT Query Failed: ${err?.message || 'Unexpected communication exception'}`);
    } finally {
      setIsCatTesting(false);
    }
  };

  // REAL PTT Test Handler with 9 Hardware Keying Methods & 3s Safety Auto-Cutoff
  const handleTestPtt = async () => {
    if (isPttTesting) {
      catController.releasePttEmergency();
      setIsPttTesting(false);
      setPttTestMsg('PTT disarmed manually.');
      return;
    }

    setIsPttTesting(true);
    setPttTestMsg(`Keying transmitter via ${form.pttMethod || 'CAT'}...`);

    try {
      await catController.testPttKey(
        form.pttMethod || 'CAT',
        form.pttPolarity || 'ACTIVE_HIGH',
        3000,
        (keyed, msg) => {
          setIsPttTesting(keyed);
          setPttTestMsg(msg);
        },
        {
          pttPort: form.pttPort,
          pttToneFreqHz: form.pttToneFreqHz,
          cm108GpioPin: form.cm108GpioPin,
          rpiGpioPin: form.rpiGpioPin,
          tciHost: form.tciHost,
          tciPort: form.tciPort,
          winkeyerPort: form.winkeyerPort,
        }
      );
    } catch (e: any) {
      setIsPttTesting(false);
      setPttTestMsg(`✗ PTT Test Error: ${e?.message || 'Failed to key transmitter'}`);
    }
  };

  const isCallValid = CALLSIGN_REGEX.test(form.myCall.trim());
  const isGridValid = GRID_REGEX.test(form.myGrid.trim()) && (form.myGrid.trim().length === 4 || form.myGrid.trim().length === 6);
  const latLon = maidenheadToLatLon(form.myGrid);
  const dbVal = rmsDb > -99 ? `${rmsDb.toFixed(1)} dB` : '-inf dB';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono select-none">
      <div className="bg-[#141414] border border-[#333] w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0F0F0F] border-b border-[#333]">
          <div className="flex items-center space-x-2">
            <Settings className="w-4 h-4 text-[#00FF41]" />
            <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
              Station & Hardware Settings (Full Configuration)
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {/* Quick Re-Run Wizard Button */}
            <button
              type="button"
              onClick={handleLaunchWizard}
              className="px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#282828] text-[#00FF41] border border-[#00FF41]/40 text-[10px] font-bold uppercase flex items-center space-x-1.5 transition-colors"
              title="Run the step-by-step Setup Wizard again"
            >
              <Wand2 className="w-3 h-3" />
              <span>Run Setup Wizard</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#262626] bg-[#0A0A0A] px-3 pt-2 gap-1 text-[11px] font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('STATION')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase ${
              activeTab === 'STATION'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>1. Station & Operator</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('AUDIO')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase ${
              activeTab === 'AUDIO'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>2. Audio & DSP</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('RADIO')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase ${
              activeTab === 'RADIO'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>3. Radio & CAT</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('AUTOMATION')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase ${
              activeTab === 'AUTOMATION'
                ? 'bg-[#141414] border-[#00FF41] text-[#00FF41]'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>4. Automation & Safety</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('TESTING')}
            className={`px-3 py-1.5 border-t border-x flex items-center space-x-1.5 uppercase ${
              activeTab === 'TESTING'
                ? 'bg-[#141414] border-cyan-400 text-cyan-400'
                : 'bg-[#0D0D0D] border-transparent text-[#888] hover:text-[#CCC]'
            }`}
          >
            {isExperimentalUnlocked ? (
              <Unlock className="w-3.5 h-3.5 text-yellow-400" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-zinc-500" />
            )}
            <span>5. Experimental Testing</span>
            {isExperimentalUnlocked && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 flex-1 overflow-y-auto text-xs bg-[#0F0F0F] space-y-3">
          {/* TAB 1: STATION & OPERATOR IDENTITY */}
          {activeTab === 'STATION' && (
            <div className="space-y-3">
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                  <Radio className="w-3.5 h-3.5 text-[#00FF41]" />
                  <span>Amateur Operator Identification</span>
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">
                      My Callsign <span className="text-[#00FF41]">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.myCall}
                      onChange={(e) => setForm({ ...form, myCall: e.target.value.toUpperCase() })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
                      required
                    />
                    <span className={`text-[8px] block mt-0.5 ${isCallValid ? 'text-[#00FF41]' : 'text-red-400'}`}>
                      {isCallValid ? '✓ Valid ITU Callsign' : '✗ Invalid Callsign format'}
                    </span>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">
                      Maidenhead Grid Locator <span className="text-[#00FF41]">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.myGrid}
                      onChange={(e) => setForm({ ...form, myGrid: e.target.value.toUpperCase() })}
                      maxLength={6}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
                      required
                    />
                    <span className={`text-[8px] block mt-0.5 ${isGridValid ? 'text-[#00FF41]' : 'text-red-400'}`}>
                      {isGridValid ? '✓ Valid 4/6-char Grid' : '✗ 4 or 6 chars (e.g. FN31pr)'}
                    </span>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Nominal TX Power (Watts)</label>
                    <input
                      type="number"
                      min="1"
                      max="1500"
                      value={form.txPowerWatts}
                      onChange={(e) => setForm({ ...form, txPowerWatts: Number(e.target.value) })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-red-400 font-bold focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                </div>

                {latLon && (
                  <div className="bg-[#0b160e] border border-[#16381d] p-2 text-[10px] flex items-center space-x-2 text-cyan-300">
                    <MapPin className="w-3.5 h-3.5 text-[#00FF41] flex-shrink-0" />
                    <span>
                      Grid Coordinates: <strong>{Math.abs(latLon.lat).toFixed(2)}° {latLon.lat >= 0 ? 'N' : 'S'}</strong>,{' '}
                      <strong>{Math.abs(latLon.lon).toFixed(2)}° {latLon.lon >= 0 ? 'E' : 'W'}</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Station Metadata */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-2.5">
                <span className="font-bold text-[#D4D4D4] uppercase text-[11px] block">
                  Station Location & Operator Details
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Operator Name</label>
                    <input
                      type="text"
                      value={form.operatorName || ''}
                      onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
                      placeholder="e.g. Hiram Percy Maxim"
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">QTH / Station City</label>
                    <input
                      type="text"
                      value={form.qthDescription || ''}
                      onChange={(e) => setForm({ ...form, qthDescription: e.target.value })}
                      placeholder="e.g. Newington, CT"
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                </div>
              </div>

              {/* Operating Timezone & UTC Master Clock Reference */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                    <Globe className="w-3.5 h-3.5 text-[#00FF41]" />
                    <span>Station Timezone & Clock Configuration</span>
                  </span>
                  <span className="text-[9px] text-zinc-400 bg-[#141414] px-2 py-0.5 border border-[#333]">
                    Protocol Reference: <strong className="text-[#00FF41]">UTC (Universal Time)</strong>
                  </span>
                </div>

                <div>
                  <label className="text-[9px] uppercase text-[#888] block mb-1">
                    Operating Station Timezone
                  </label>
                  <select
                    id="settings-timezone-select"
                    value={form.timezone || 'UTC'}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 font-mono focus:outline-none focus:border-[#00FF41]"
                  >
                    <optgroup label="Standard Radio Protocol">
                      <option value="UTC">UTC (Coordinated Universal Time / GMT) - Default Digital Mode Standard</option>
                      <option value="SYSTEM_LOCAL">System Local Time (Auto-detect OS/Browser timezone)</option>
                    </optgroup>
                    <optgroup label="North America">
                      {TIMEZONE_CATALOG.filter(t => t.region === 'North America').map(t => (
                        <option key={t.id} value={t.id}>{t.label} [{t.baseUtcOffset}]</option>
                      ))}
                    </optgroup>
                    <optgroup label="South America">
                      {TIMEZONE_CATALOG.filter(t => t.region === 'South America').map(t => (
                        <option key={t.id} value={t.id}>{t.label} [{t.baseUtcOffset}]</option>
                      ))}
                    </optgroup>
                    <optgroup label="Europe">
                      {TIMEZONE_CATALOG.filter(t => t.region === 'Europe').map(t => (
                        <option key={t.id} value={t.id}>{t.label} [{t.baseUtcOffset}]</option>
                      ))}
                    </optgroup>
                    <optgroup label="Asia & Middle East">
                      {TIMEZONE_CATALOG.filter(t => t.region === 'Asia & Middle East').map(t => (
                        <option key={t.id} value={t.id}>{t.label} [{t.baseUtcOffset}]</option>
                      ))}
                    </optgroup>
                    <optgroup label="Oceania & Pacific">
                      {TIMEZONE_CATALOG.filter(t => t.region === 'Oceania & Pacific').map(t => (
                        <option key={t.id} value={t.id}>{t.label} [{t.baseUtcOffset}]</option>
                      ))}
                    </optgroup>
                    <optgroup label="Africa">
                      {TIMEZONE_CATALOG.filter(t => t.region === 'Africa').map(t => (
                        <option key={t.id} value={t.id}>{t.label} [{t.baseUtcOffset}]</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {/* Dual Clock Live Readout */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-2 bg-[#0A0A0A] border border-[#222]">
                  <div className="space-y-0.5">
                    <span className="text-[9px] uppercase text-[#777] block flex items-center gap-1">
                      <Clock className="w-3 h-3 text-[#00FF41]" />
                      <span>True Master Protocol Clock (UTC)</span>
                    </span>
                    <div className="font-mono text-sm font-bold text-[#00FF41]">
                      {formatUtcTime(new Date())} <span className="text-[10px] text-zinc-400 font-normal">UTC (+00:00)</span>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[9px] uppercase text-[#777] block flex items-center gap-1">
                      <Globe className="w-3 h-3 text-cyan-400" />
                      <span>Selected Station Local Display</span>
                    </span>
                    <div className="font-mono text-sm font-bold text-cyan-400">
                      {formatTimeInTimezone(new Date(), form.timezone || 'UTC').timeStr}{' '}
                      <span className="text-[10px] text-zinc-400 font-normal">
                        ({formatTimeInTimezone(new Date(), form.timezone || 'UTC').tzAbbr} / {getTimezoneOffsetString(form.timezone || 'UTC')})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Clarification callout */}
                <div className="text-[10px] text-zinc-400 bg-[#0A0A0A] p-2 border border-[#222] leading-relaxed flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1 flex-shrink-0" />
                  <div>
                    <strong className="text-zinc-200">Time Sync & Slot Behavior:</strong> All 30-second z-30 digital mode frames and RF standard time calibrations (WWV, CHU, DCF77, JJY) always synchronize strictly against <strong>Universal Coordinated Time (UTC)</strong>. Selecting a local timezone customizes station clock displays and log timestamps while keeping RF synchronization grounded to UTC second zero.
                  </div>
                </div>
              </div>

              {/* Software Version & GitHub Upstream Update Synchronizer */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#D4D4D4] uppercase text-[11px] flex items-center space-x-1.5">
                    <DownloadCloud className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Software Version & Upstream Repository</span>
                  </span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/30 font-bold font-mono">
                    Installed: v1.0.0
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-[#0A0A0A] border border-[#222]">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-zinc-300 font-mono">
                      Upstream: <a href="https://github.com/themantas1994/z-30" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">github.com/themantas1994/z-30</a>
                    </div>
                    <div className="text-[9px] text-[#777]">
                      Sync with latest GitHub releases, git commits, or update native soundcard DSP modules.
                    </div>
                  </div>

                  {onOpenUpdate && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenUpdate();
                      }}
                      className="px-3 py-1.5 bg-[#141414] hover:bg-[#202020] text-[#00FF41] border border-[#00FF41]/40 text-[10px] font-bold uppercase flex items-center space-x-1.5 flex-shrink-0 transition-colors"
                    >
                      <DownloadCloud className="w-3 h-3 text-[#00FF41]" />
                      <span>Check / Apply Updates</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUDIO & DSP SOUND CARD */}
          {activeTab === 'AUDIO' && (
            <div className="space-y-3">
              {/* System Sound Card Detection & Permission Bar */}
              <div className="bg-[#080808] p-3 border border-[#2A2A2A] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Volume2 className="w-4 h-4 text-[#00FF41]" />
                    <span className="font-bold text-[#D4D4D4] uppercase text-[11px]">
                      Operating System Audio Detection
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        audioPermissionGranted
                          ? 'bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/40'
                          : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                      }`}
                    >
                      {audioPermissionGranted ? '✓ Devices Authorized' : '⚠ Limited Labels (Need Access)'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {!audioPermissionGranted && (
                      <button
                        type="button"
                        onClick={() => scanSystemDevices(true)}
                        disabled={isScanningDevices}
                        className="px-2.5 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/50 text-[10px] font-bold uppercase flex items-center space-x-1"
                        title="Prompt browser to allow audio device access so real soundcard names are visible"
                      >
                        <Shield className="w-3 h-3" />
                        <span>Authorize Sound Cards</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => scanSystemDevices(false)}
                      disabled={isScanningDevices}
                      className="px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#282828] text-[#00FF41] border border-[#333] text-[10px] font-bold uppercase flex items-center space-x-1"
                      title="Re-query system for newly connected USB soundcards, VAC virtual cables, or transceivers"
                    >
                      <RefreshCw className={`w-3 h-3 ${isScanningDevices ? 'animate-spin' : ''}`} />
                      <span>{isScanningDevices ? 'Scanning...' : 'Scan System Devices'}</span>
                    </button>
                  </div>
                </div>

                {/* Diagnostics Status Pills */}
                {diagnostics && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[9px]">
                    <div className="bg-[#121212] p-1.5 border border-[#222]">
                      <span className="text-[#666] block uppercase">Context Rate</span>
                      <span className="text-cyan-400 font-bold">{diagnostics.sampleRate} Hz</span>
                    </div>
                    <div className="bg-[#121212] p-1.5 border border-[#222]">
                      <span className="text-[#666] block uppercase">Detected Inputs</span>
                      <span className="text-[#00FF41] font-bold">{systemInputs.length || 1} Device(s)</span>
                    </div>
                    <div className="bg-[#121212] p-1.5 border border-[#222]">
                      <span className="text-[#666] block uppercase">Detected Outputs</span>
                      <span className="text-yellow-400 font-bold">{systemOutputs.length || 1} Device(s)</span>
                    </div>
                    <div className="bg-[#121212] p-1.5 border border-[#222]">
                      <span className="text-[#666] block uppercase">Audio Subsystem</span>
                      <span className="text-purple-400 font-bold">{diagnostics.contextState.toUpperCase()}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Sound Card Audio Interfaces */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                  <Sliders className="w-3.5 h-3.5 text-[#00FF41]" />
                  <span>Configured Sound Card Interfaces (Rx Demod / Tx Mod)</span>
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] uppercase text-[#888]">
                        Input Device (Rx Demodulator) <span className="text-[#00FF41]">*</span>
                      </label>
                      <span className="text-[8px] text-cyan-400">
                        {systemInputs.length > 0 ? `${systemInputs.length} detected` : 'Generic'}
                      </span>
                    </div>
                    <select
                      value={form.audioInputDevice}
                      onChange={(e) => setForm({ ...form, audioInputDevice: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-[#00FF41]"
                    >
                      {systemInputs.length > 0 ? (
                        systemInputs.map((dev, i) => (
                          <option key={`sys-in-${i}`} value={dev.label || dev.deviceId}>
                            {dev.label || `Audio Input ${i + 1} (${dev.deviceId.substring(0, 8)}...)`}
                          </option>
                        ))
                      ) : (
                        <option value="Default System Audio Device">Default System Audio Input</option>
                      )}
                      {form.audioInputDevice &&
                        !systemInputs.some((d) => (d.label || d.deviceId) === form.audioInputDevice) &&
                        form.audioInputDevice !== 'Default System Audio Device' && (
                          <option value={form.audioInputDevice}>{form.audioInputDevice}</option>
                        )}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] uppercase text-[#888]">
                        Output Device (Tx Modulator) <span className="text-yellow-400">*</span>
                      </label>
                      <span className="text-[8px] text-yellow-400">
                        {systemOutputs.length > 0 ? `${systemOutputs.length} detected` : 'Generic'}
                      </span>
                    </div>
                    <select
                      value={form.audioOutputDevice}
                      onChange={(e) => setForm({ ...form, audioOutputDevice: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 focus:outline-none focus:border-[#00FF41]"
                    >
                      {systemOutputs.length > 0 ? (
                        systemOutputs.map((dev, i) => (
                          <option key={`sys-out-${i}`} value={dev.label || dev.deviceId}>
                            {dev.label || `Audio Output ${i + 1} (${dev.deviceId.substring(0, 8)}...)`}
                          </option>
                        ))
                      ) : (
                        <option value="Default System Audio Device">Default System Audio Output</option>
                      )}
                      {form.audioOutputDevice &&
                        !systemOutputs.some((d) => (d.label || d.deviceId) === form.audioOutputDevice) &&
                        form.audioOutputDevice !== 'Default System Audio Device' && (
                          <option value={form.audioOutputDevice}>{form.audioOutputDevice}</option>
                        )}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Native DSP Sample Rate</label>
                    <select
                      value={form.sampleRateHz || 12000}
                      onChange={(e) => setForm({ ...form, sampleRateHz: Number(e.target.value) })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value={12000}>12000 Hz (Native z-30 16-MFSK Bandwidth)</option>
                      <option value={48000}>48000 Hz (Standard 24-bit HD Audio CODEC)</option>
                      <option value={44100}>44100 Hz (Legacy Soundcard Sample Rate)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Channel Configuration</label>
                    <select
                      value={form.audioChannels || 1}
                      onChange={(e) => setForm({ ...form, audioChannels: Number(e.target.value) as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value={1}>Mono (Channel 1 / Left Rx Audio)</option>
                      <option value={2}>Stereo (Dual Channel I/Q or Stereo)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Real-Time Audio Input Level VU Meter */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-[#D4D4D4] uppercase text-[11px]">
                      Live Audio Input Level VU Meter (Hardware Test)
                    </span>
                    {isClipping && (
                      <span className="px-1.5 py-0.2 text-[8px] bg-red-600 text-white font-bold animate-pulse">
                        CLIPPING
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={toggleAudioTest}
                    className={`px-3 py-1 text-xs font-bold uppercase flex items-center space-x-1.5 border transition-all ${
                      isAudioTesting
                        ? 'bg-red-500/20 border-red-500 text-red-400 hover:bg-red-500/30'
                        : 'bg-[#00FF41]/20 border-[#00FF41] text-[#00FF41] hover:bg-[#00FF41]/30'
                    }`}
                  >
                    {isAudioTesting ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    <span>{isAudioTesting ? 'Stop Level Test' : 'Test Selected Input'}</span>
                  </button>
                </div>

                <div className="flex items-center space-x-3 bg-[#080808] p-2 border border-[#222]">
                  <div className="flex-1 h-3.5 bg-[#141414] overflow-hidden rounded-sm relative flex items-center">
                    <div
                      className="h-full transition-all duration-75"
                      style={{
                        width: `${Math.min(100, Math.max(2, vuLevel * 100))}%`,
                        backgroundColor:
                          vuLevel > 0.85 ? '#EF4444' : vuLevel > 0.65 ? '#EAB308' : '#00FF41',
                      }}
                    />
                  </div>
                  <div className="flex items-center space-x-2 text-[10px] font-bold">
                    <span className="text-cyan-400 w-16 text-right">{isAudioTesting ? dbVal : '0.0 dB'}</span>
                    <span className="text-[#666] text-[8px] hidden sm:inline">
                      {isAudioTesting ? `(Peak: ${peakDb.toFixed(1)} dB)` : ''}
                    </span>
                  </div>
                </div>

                <div className="text-[8px] text-[#666] flex justify-between px-1">
                  <span>-60 dB (Noise Floor)</span>
                  <span>-30 dB (Weak Signal)</span>
                  <span>-10 dB (Optimal)</span>
                  <span className="text-red-400">0 dB (Clip)</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RADIO & CAT / PTT CONTROL */}
          {activeTab === 'RADIO' && (
            <div className="space-y-3">
              {/* Hamlib Library Version Banner & Upstream Update Control */}
              <div className="bg-[#0D0D0D] p-3 border border-[#00FF41]/30 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Cpu className="w-4 h-4 text-[#00FF41]" />
                      <span className="text-xs font-bold text-[#D4D4D4] uppercase">
                        Hamlib Library Engine
                      </span>
                      <span className="px-2 py-0.5 text-[9px] font-bold bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/30 rounded">
                        v{hamlibLibVersion}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#888] mt-0.5">
                      Current Hamlib Version: <span className="text-cyan-400 font-semibold">libhamlib-{hamlibLibVersion} ({hamlibReleaseDate})</span> • {HAMLIB_ALL_RIGS.length} Transceiver Models Loaded
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleUpdateHamlib}
                    disabled={isUpdatingHamlib}
                    className="px-3 py-1.5 bg-[#181818] hover:bg-[#252525] text-[#00FF41] border border-[#00FF41]/40 text-xs font-bold uppercase flex items-center justify-center space-x-1.5 transition-colors disabled:opacity-50"
                    title="Check upstream repository and update Hamlib transceiver definitions"
                  >
                    <DownloadCloud className={`w-3.5 h-3.5 ${isUpdatingHamlib ? 'animate-bounce' : ''}`} />
                    <span>{isUpdatingHamlib ? 'Updating Hamlib...' : 'Update Hamlib Library'}</span>
                  </button>
                </div>

                {hamlibUpdateMsg && (
                  <div className="text-[10px] bg-[#141414] p-2 border border-[#333] text-[#00FF41] flex items-center space-x-1.5">
                    <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{hamlibUpdateMsg}</span>
                  </div>
                )}
              </div>

              {/* Transceiver & CAT Setup */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                  <RadioIcon className="w-3.5 h-3.5 text-[#00FF41]" />
                  <span>Transceiver Rig Model & Control Interface</span>
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">CAT Control Method</label>
                    <select
                      value={form.catMethod || 'Hamlib'}
                      onChange={(e) => setForm({ ...form, catMethod: e.target.value as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#00FF41] font-bold focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value="Hamlib">Hamlib (libhamlib/rigctld TCP Daemon)</option>
                      <option value="Direct Serial">Direct Serial CAT (Web Serial / COM Port)</option>
                      <option value="None">None (Manual Frequency / Audio VOX Mode)</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] uppercase text-[#888]">Transceiver Rig Model</label>
                      <span className="text-[8px] text-cyan-400">
                        {searchHamlibRigs(hamlibSearch, hamlibMfg).length} models available
                      </span>
                    </div>

                    <div className="flex gap-1.5 mb-1.5">
                      <input
                        type="text"
                        placeholder="Filter rigs (e.g. 7300, FT-991, K4, G90)..."
                        value={hamlibSearch}
                        onChange={(e) => setHamlibSearch(e.target.value)}
                        className="flex-1 bg-[#101010] border border-[#2A2A2A] px-2 py-0.5 text-[10px] text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      />
                      <select
                        value={hamlibMfg}
                        onChange={(e) => setHamlibMfg(e.target.value)}
                        className="bg-[#101010] border border-[#2A2A2A] px-1.5 py-0.5 text-[10px] text-[#00FF41] focus:outline-none"
                      >
                        {getHamlibManufacturers().map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <select
                      value={form.rigModel}
                      onChange={(e) => {
                        const selectedName = e.target.value;
                        const rig = getRigByName(selectedName);
                        setForm({
                          ...form,
                          rigModel: selectedName,
                          baudRate: rig?.defaultBaud || form.baudRate || 115200,
                        });
                      }}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      {searchHamlibRigs(hamlibSearch, hamlibMfg).map((r) => (
                        <option key={`${r.id}-${r.name}`} value={r.name}>
                          [{r.id}] {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Real Serial / COM Hardware Query & Web Serial Pairing */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-[#AAA] uppercase flex items-center space-x-1.5">
                      <span>Real Hardware Serial / COM Interface</span>
                      {discoveredPorts.length > 0 && (
                        <span className="text-[8px] bg-green-950/80 text-green-400 border border-green-700/50 px-1 py-0.2 rounded font-mono">
                          {discoveredPorts.length} Real Port{discoveredPorts.length > 1 ? 's' : ''} Detected
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={scanSerialPorts}
                        disabled={isQueryingSerial}
                        className="text-[9px] text-[#888] hover:text-[#D4D4D4] flex items-center space-x-1"
                        title="Re-query system serial ports"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isQueryingSerial ? 'animate-spin' : ''}`} />
                        <span>{isQueryingSerial ? 'Querying...' : 'Scan Ports'}</span>
                      </button>

                      {catController.isWebSerialSupported() && (
                        <button
                          type="button"
                          onClick={handleConnectSerial}
                          disabled={isConnectingSerial}
                          className="text-[9px] bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#00FF41] border border-[#00FF41]/40 px-1.5 py-0.5 flex items-center space-x-1 font-bold"
                        >
                          <Cable className="w-2.5 h-2.5" />
                          <span>{catController.getIsSerialConnected() ? '✓ Serial Active' : 'Query & Pair Hardware Port'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[9px] uppercase text-[#888]">Serial / COM Port</label>
                        <button
                          type="button"
                          onClick={() => setIsCustomPortMode(!isCustomPortMode)}
                          className="text-[9px] text-cyan-400 hover:underline"
                        >
                          {isCustomPortMode ? '← Choose from Detected Ports' : '+ Enter Custom Port Path'}
                        </button>
                      </div>

                      {isCustomPortMode ? (
                        <input
                          type="text"
                          value={form.serialPort}
                          onChange={(e) => setForm({ ...form, serialPort: e.target.value })}
                          placeholder="/dev/ttyUSB0, COM3, /dev/ttyACM0, /dev/cu.usbserial..."
                          className="w-full bg-[#181818] border border-cyan-500/50 px-2.5 py-1 text-xs text-[#00FF41] font-mono focus:outline-none"
                        />
                      ) : (
                        <select
                          value={form.serialPort}
                          onChange={(e) => {
                            if (e.target.value === '__CUSTOM__') {
                              setIsCustomPortMode(true);
                            } else {
                              setForm({ ...form, serialPort: e.target.value });
                            }
                          }}
                          className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                        >
                          {discoveredPorts.length > 0 && (
                            <optgroup label="Real Queried Physical Hardware Ports">
                              {discoveredPorts.map((p) => (
                                <option key={p.id} value={p.displayName || p.path}>
                                  {p.displayName}
                                </option>
                              ))}
                            </optgroup>
                          )}

                          <optgroup label="Network Daemon CAT Socket">
                            <option value="TCP: 127.0.0.1:4532 (rigctld daemon / SmartSDR)">
                              TCP: 127.0.0.1:4532 (Hamlib rigctld Daemon)
                            </option>
                          </optgroup>

                          {discoveredPorts.length === 0 && (
                            <optgroup label="Physical Serial Status">
                              <option value="" disabled>
                                No paired USB serial ports detected. Click &quot;Query &amp; Pair Hardware Port&quot; above.
                              </option>
                            </optgroup>
                          )}

                          <option value="__CUSTOM__">+ Enter custom port path (/dev/ttyUSB*, COM*, etc.)...</option>
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="text-[9px] uppercase text-[#888] block mb-1">Baud Rate</label>
                      <select
                        value={form.baudRate}
                        onChange={(e) => setForm({ ...form, baudRate: Number(e.target.value) })}
                        className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      >
                        {[4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                          <option key={b} value={b}>
                            {b} baud
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {serialFeedback && (
                    <div className="text-[9px] text-yellow-400 font-mono bg-[#0D0D0D] p-1.5 border border-[#222]">
                      {serialFeedback}
                    </div>
                  )}
                </div>

                {/* Hamlib Network Daemon Parameters */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Hamlib rigctld Host</label>
                    <input
                      type="text"
                      value={form.hamlibHost || '127.0.0.1'}
                      onChange={(e) => setForm({ ...form, hamlibHost: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Hamlib rigctld Port</label>
                    <input
                      type="number"
                      value={form.hamlibPort || 4532}
                      onChange={(e) => setForm({ ...form, hamlibPort: Number(e.target.value) })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                </div>
              </div>

              {/* PTT Keying & Pin Polarity */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#D4D4D4] uppercase text-[11px] block">
                    Push-To-Talk (PTT) Keying Architecture (Universal Rig Compatibility)
                  </span>
                  <span className="text-[9px] text-[#00FF41] bg-green-950/60 border border-green-700/50 px-1.5 py-0.5 rounded font-bold">
                    9 Methods Supported
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">
                      PTT Keying Method <span className="text-yellow-400">*</span>
                    </label>
                    <select
                      value={form.pttMethod}
                      onChange={(e) => setForm({ ...form, pttMethod: e.target.value as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 font-bold focus:outline-none focus:border-[#00FF41]"
                    >
                      <optgroup label="CAT / Serial Commands">
                        <option value="CAT">CAT Command (\set_ptt 1 / T 1 / CI-V)</option>
                        <option value="WINKEYER">K1EL WinKeyer 2/3 Serial PTT (0x02 0x01)</option>
                      </optgroup>
                      <optgroup label="Direct Hardware Serial Control Lines">
                        <option value="RTS">Serial Port RTS Pin (Request-To-Send)</option>
                        <option value="DTR">Serial Port DTR Pin (Data-Terminal-Ready)</option>
                      </optgroup>
                      <optgroup label="Audio Tone & VOX Keying">
                        <option value="AUDIO_TONE_RIGHT">Right-Channel Audio PTT Tone (1000/1500Hz Sine)</option>
                        <option value="VOX">Transceiver Audio VOX (Voice-Operated Exchange)</option>
                      </optgroup>
                      <optgroup label="Embedded Soundcard & SBC GPIO">
                        <option value="CM108_GPIO">C-Media CM108/CM119 USB Audio GPIO (DRA/URI)</option>
                        <option value="RASPBERRY_PI_GPIO">Raspberry Pi / Linux SBC Direct GPIO Pin</option>
                      </optgroup>
                      <optgroup label="Network & SDR Protocol">
                        <option value="TCI_NETWORK">TCI Network Protocol (ExpertSDR / SunSDR / Thetis)</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* Polarity selector for RTS, DTR, RPi GPIO */}
                  {(form.pttMethod === 'RTS' || form.pttMethod === 'DTR' || form.pttMethod === 'RASPBERRY_PI_GPIO') && (
                    <div>
                      <label className="text-[9px] uppercase text-[#888] block mb-1">Pin Polarity</label>
                      <select
                        value={form.pttPolarity || 'ACTIVE_HIGH'}
                        onChange={(e) => setForm({ ...form, pttPolarity: e.target.value as any })}
                        className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value="ACTIVE_HIGH">Active High (+12V / Logic 1 = PTT ON)</option>
                        <option value="ACTIVE_LOW">Active Low (Inverted / Optocoupler Pull-to-GND)</option>
                      </select>
                    </div>
                  )}

                  {/* Right-Channel Audio PTT Settings */}
                  {form.pttMethod === 'AUDIO_TONE_RIGHT' && (
                    <div>
                      <label className="text-[9px] uppercase text-[#888] block mb-1">PTT Tone Frequency</label>
                      <select
                        value={form.pttToneFreqHz || 1000}
                        onChange={(e) => setForm({ ...form, pttToneFreqHz: Number(e.target.value) })}
                        className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 font-bold focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value={1000}>1000 Hz Pure Sine (Standard SignaLink / Rigblaster Tone Rectifier)</option>
                        <option value={1500}>1500 Hz Pure Sine (High-Q Hardware Tone Detector)</option>
                        <option value={2000}>2000 Hz Pure Sine (Low-Latency Discriminator)</option>
                      </select>
                    </div>
                  )}

                  {/* CM108 GPIO Pin */}
                  {form.pttMethod === 'CM108_GPIO' && (
                    <div>
                      <label className="text-[9px] uppercase text-[#888] block mb-1">CM108 / CM119 GPIO Pin</label>
                      <select
                        value={form.cm108GpioPin || 3}
                        onChange={(e) => setForm({ ...form, cm108GpioPin: Number(e.target.value) })}
                        className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 font-bold focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value={3}>GPIO 3 (Pin 13 on CM108/CM119 - Masters Communications DRA-50 / URI standard)</option>
                        <option value={4}>GPIO 4 (Pin 14 - Digirig CM108 / custom)</option>
                        <option value={1}>GPIO 1 (Pin 11 - Alternate RIM interface)</option>
                      </select>
                    </div>
                  )}

                  {/* Raspberry Pi GPIO Pin */}
                  {form.pttMethod === 'RASPBERRY_PI_GPIO' && (
                    <div>
                      <label className="text-[9px] uppercase text-[#888] block mb-1">Linux SBC BCM GPIO Pin</label>
                      <select
                        value={form.rpiGpioPin || 17}
                        onChange={(e) => setForm({ ...form, rpiGpioPin: Number(e.target.value) })}
                        className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-green-400 font-bold focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value={17}>BCM Pin 17 (Header Pin 11 - Standard Ham Radio HAT / TNC-Pi)</option>
                        <option value={27}>BCM Pin 27 (Header Pin 13)</option>
                        <option value={22}>BCM Pin 22 (Header Pin 15)</option>
                        <option value={23}>BCM Pin 23 (Header Pin 16)</option>
                        <option value={4}>BCM Pin 4 (Header Pin 7)</option>
                      </select>
                    </div>
                  )}

                  {/* TCI SDR Host & Port */}
                  {form.pttMethod === 'TCI_NETWORK' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] uppercase text-[#888] block mb-1">TCI Host</label>
                        <input
                          type="text"
                          value={form.tciHost || '127.0.0.1'}
                          onChange={(e) => setForm({ ...form, tciHost: e.target.value })}
                          className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase text-[#888] block mb-1">TCI Port</label>
                        <input
                          type="number"
                          value={form.tciPort || 40001}
                          onChange={(e) => setForm({ ...form, tciPort: Number(e.target.value) })}
                          className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                        />
                      </div>
                    </div>
                  )}

                  {/* WinKeyer Port */}
                  {form.pttMethod === 'WINKEYER' && (
                    <div>
                      <label className="text-[9px] uppercase text-[#888] block mb-1">WinKeyer Port</label>
                      <input
                        type="text"
                        value={form.winkeyerPort || 'COM1'}
                        onChange={(e) => setForm({ ...form, winkeyerPort: e.target.value })}
                        placeholder="COM1, /dev/ttyUSB1..."
                        className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-yellow-400 font-mono focus:outline-none focus:border-[#00FF41]"
                      />
                    </div>
                  )}
                </div>

                {/* Timing Delays (Lead-In & Hang Time) */}
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#1E1E1E]">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] flex items-center justify-between mb-1">
                      <span>PTT Lead-In Time (Pre-Tx Buffer)</span>
                      <span className="text-cyan-400 font-bold">{form.pttLeadInMs || 20} ms</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="500"
                      step="10"
                      value={form.pttLeadInMs || 20}
                      onChange={(e) => setForm({ ...form, pttLeadInMs: Number(e.target.value) })}
                      className="w-full h-1 bg-[#222] accent-[#00FF41] rounded"
                    />
                    <div className="text-[8px] text-[#666] flex justify-between">
                      <span>0ms (Instant)</span>
                      <span>50ms (Relay/QSK)</span>
                      <span>500ms (Slow Amp)</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] flex items-center justify-between mb-1">
                      <span>PTT Hangover / Tail Time</span>
                      <span className="text-yellow-400 font-bold">{form.pttHangTimeMs || 30} ms</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="500"
                      step="10"
                      value={form.pttHangTimeMs || 30}
                      onChange={(e) => setForm({ ...form, pttHangTimeMs: Number(e.target.value) })}
                      className="w-full h-1 bg-[#222] accent-yellow-400 rounded"
                    />
                    <div className="text-[8px] text-[#666] flex justify-between">
                      <span>0ms (Sharp Cutoff)</span>
                      <span>30ms (Smooth Break)</span>
                      <span>500ms (Repeater Hold)</span>
                    </div>
                  </div>
                </div>

                {/* Dynamic Hardware Method Guidance & Transceiver Wiring Guide */}
                {(() => {
                  const meta = PTT_METHODS_CATALOG.find((m) => m.id === form.pttMethod) || PTT_METHODS_CATALOG[0];
                  return (
                    <div className="text-[9px] text-[#BBB] bg-[#0E0E0E] p-2.5 border border-[#222] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-cyan-400 uppercase tracking-wide">
                          Method Details: {meta.name}
                        </span>
                        <span className="text-[8px] text-yellow-400 bg-yellow-950/60 px-1 py-0.2 border border-yellow-800/40">
                          {meta.recommendedFor}
                        </span>
                      </div>
                      <p className="text-[#AAA] leading-relaxed">{meta.description}</p>
                      <div className="text-[8px] text-[#00FF41] bg-[#141414] p-1.5 border border-[#262626]">
                        <span className="text-[#888] font-bold uppercase mr-1">Wiring & Interface Setup:</span>
                        {meta.wiringTips}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#1C1C1C]">
                        <span className="text-[#666] uppercase text-[8px]">Supported Transceivers / Hardware:</span>
                        <span className="text-gray-300 font-mono text-[8px]">{meta.supportedRigs}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Hardware Verification Controls */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#222]">
                  <button
                    type="button"
                    onClick={handleTestCat}
                    disabled={isCatTesting}
                    className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-cyan-400 border border-cyan-500/40 text-xs font-bold uppercase flex items-center space-x-1.5 transition-colors disabled:opacity-50"
                  >
                    <Terminal className="w-3 h-3" />
                    <span>{isCatTesting ? 'Querying Radio...' : 'Test CAT Query'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTestPtt}
                    className={`px-3 py-1 text-xs font-bold uppercase border transition-all ${
                      isPttTesting
                        ? 'bg-red-600 text-white border-red-500 animate-pulse'
                        : 'bg-[#1A1A1A] hover:bg-[#262626] text-red-400 border-red-500/40'
                    }`}
                  >
                    {isPttTesting ? '● PTT Key Active (3s Auto-Cutoff)' : `Test ${form.pttMethod || 'CAT'} Key (3s Cutoff)`}
                  </button>
                </div>

                {/* Real Diagnostic Message (NO FALSE PASS) */}
                {catTestStatus && (
                  <div
                    className={`text-[10px] font-mono p-2 border flex items-start space-x-2 ${
                      catTestSuccess === true
                        ? 'bg-[#00FF41]/10 border-[#00FF41]/40 text-[#00FF41]'
                        : catTestSuccess === false
                        ? 'bg-red-950/40 border-red-500/40 text-red-400'
                        : 'bg-[#1A1A1A] border-[#333] text-cyan-400'
                    }`}
                  >
                    {catTestSuccess === true ? (
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-bold">{catTestStatus}</div>
                      {catTestSuccess === false && form.catMethod !== 'None' && (
                        <div className="text-[9px] text-[#AAA] mt-1">
                          Diagnostic tip: Check that the transceiver is powered on, USB cable is connected, and baud rate matches the radio menu setting.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {pttTestMsg && (
                  <div className="text-[10px] text-yellow-400 font-mono bg-[#141414] p-2 border border-[#333]">
                    {pttTestMsg}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: AUTOMATION & SAFETY */}
          {activeTab === 'AUTOMATION' && (
            <div className="space-y-3">
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  <span>QSO Automation & Watchdog Safety Controls</span>
                </span>

                <div className="space-y-2.5">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.autoSeq}
                      onChange={(e) => setForm({ ...form, autoSeq: e.target.checked })}
                      className="w-4 h-4 bg-[#141414] border-[#333] text-[#00FF41] focus:ring-0 accent-[#00FF41]"
                    />
                    <span className="text-[#D4D4D4]">
                      Auto-Sequence (Automatically progress through standard QSO stages: CQ → Report → R-Report → 73)
                    </span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.call1st}
                      onChange={(e) => setForm({ ...form, call1st: e.target.checked })}
                      className="w-4 h-4 bg-[#141414] border-[#333] text-[#00FF41] focus:ring-0 accent-[#00FF41]"
                    />
                    <span className="text-[#D4D4D4]">
                      Auto-Reply / Call 1st (Automatically answer decoded stations responding to your CQ call)
                    </span>
                  </label>

                  {/* Auto-Reply Priority Rule Selection */}
                  <div className="bg-[#0A0A0A] p-2.5 border border-[#262626] space-y-2 ml-6">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase font-bold text-[#00FF41] block">
                        Auto-Reply Priority Rule (Pileup Resolution)
                      </label>
                      <span className="text-[9px] text-[#888]">
                        Active: <span className="text-[#00FF41] font-bold">{form.autoReplyPriority || 'FIRST'}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {AUTO_REPLY_OPTIONS.map((opt) => {
                        const isSelected = (form.autoReplyPriority || 'FIRST') === opt.id;
                        return (
                          <div
                            key={opt.id}
                            onClick={() => setForm({ ...form, autoReplyPriority: opt.id })}
                            className={`p-2 border cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#D4D4D4]'
                                : 'bg-[#141414] border-[#2A2A2A] text-[#888] hover:bg-[#1A1A1A] hover:text-[#CCC]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-[11px] font-bold ${isSelected ? 'text-[#00FF41]' : 'text-[#CCC]'}`}>
                                {opt.shortLabel}
                              </span>
                              <span className="text-[9px] px-1 py-0.2 bg-[#050505] border border-[#333] font-mono text-[#AAA]">
                                {opt.tag}
                              </span>
                            </div>
                            <p className="text-[10px] text-[#777] leading-tight">{opt.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.holdTxFreq}
                      onChange={(e) => setForm({ ...form, holdTxFreq: e.target.checked })}
                      className="w-4 h-4 bg-[#141414] border-[#333] text-[#00FF41] focus:ring-0 accent-[#00FF41]"
                    />
                    <span className="text-[#D4D4D4]">
                      Hold TX Frequency (Do not shift transmit audio carrier when double-clicking signals)
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#222]">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">
                      TX Watchdog Timer (Cycles before auto-disarm)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={form.watchdogCycles}
                      onChange={(e) => setForm({ ...form, watchdogCycles: Number(e.target.value) })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">
                      Default TX Slot Schedule
                    </label>
                    <select
                      value={form.defaultTxSlot || 'EVEN'}
                      onChange={(e) => setForm({ ...form, defaultTxSlot: e.target.value as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value="EVEN">Even (:00 / :30 UTC)</option>
                      <option value="ODD">Odd (:15 / :45 UTC)</option>
                      <option value="MANUAL">Manual (Any Cycle)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: EXPERIMENTAL TESTING & CALIBRATION */}
          {activeTab === 'TESTING' && (
            <div className="space-y-3" id="experimental-testing-tab">
              {/* Security Lock Header Banner */}
              {!isExperimentalUnlocked ? (
                <div className="bg-[#0D0B05] p-4 border-2 border-yellow-700/60 space-y-3">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                    <span className="font-bold text-yellow-400 text-xs uppercase tracking-wider">
                      Experimental Testing & Synthetic Signal Harness Locked
                    </span>
                  </div>

                  <p className="text-[#CCC] text-xs leading-relaxed">
                    By default, this station operates exclusively on <strong>real physical RF audio signals</strong> captured from your transceiver soundcard or line-in receiver. Synthetic signal injection and diagnostic test frames bypass live physical receiver monitoring and could interfere with live SDR/transceiver decoding.
                  </p>

                  <div className="bg-[#050505] p-3 border border-yellow-900/40 text-[11px] text-[#AAA] space-y-2">
                    <p className="font-semibold text-yellow-300 uppercase text-[10px]">
                      Operational Risk Notice:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-[#999]">
                      <li>Synthetic test signals will temporarily populate the waterfall spectrum and audio decoder buffer.</li>
                      <li>Injected signals simulate artificial SNR/S-meter readings and are intended solely for offline receiver bench calibration.</li>
                      <li>Live soundcard capture remains active in parallel, but test signals can mask faint real RF stations.</li>
                    </ul>
                  </div>

                  <label className="flex items-start space-x-2.5 pt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      id="risk-agreement-checkbox"
                      checked={riskAgreementChecked}
                      onChange={(e) => setRiskAgreementChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 bg-[#141414] border-yellow-600 text-yellow-400 focus:ring-0 accent-yellow-400 cursor-pointer"
                    />
                    <span className="text-xs text-yellow-200 font-medium">
                      I understand the risks and request to unlock the experimental testing harness for receiver calibration and offline bench testing.
                    </span>
                  </label>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      id="unlock-experimental-btn"
                      disabled={!riskAgreementChecked}
                      onClick={() => {
                        audioEngine.setExperimentalModeEnabled(true);
                        setIsExperimentalUnlocked(true);
                      }}
                      className={`px-4 py-2 text-xs font-bold uppercase flex items-center space-x-2 transition-all ${
                        riskAgreementChecked
                          ? 'bg-yellow-500 hover:bg-yellow-400 text-black shadow-[0_0_12px_rgba(234,179,8,0.4)] cursor-pointer active:scale-95'
                          : 'bg-[#1C1C1C] text-[#555] border border-[#333] cursor-not-allowed'
                      }`}
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Unlock Experimental Testing</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-[#08120D] p-3 border border-[#00FF41]/40 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Unlock className="w-4 h-4 text-[#00FF41] animate-pulse" />
                    <div>
                      <span className="text-xs font-bold text-[#00FF41] uppercase tracking-wide block">
                        Experimental Mode Active (Authorized by Operator)
                      </span>
                      <span className="text-[10px] text-[#888]">
                        Synthetic signal generator & manual decoder harness are unlocked.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      audioEngine.setExperimentalModeEnabled(false);
                      setIsExperimentalUnlocked(false);
                      setRiskAgreementChecked(false);
                    }}
                    className="px-3 py-1 bg-[#1A1A1A] hover:bg-red-950/60 text-[#AAA] hover:text-red-300 border border-[#333] hover:border-red-600 text-xs font-bold uppercase flex items-center space-x-1.5 transition-all"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock & Secure Mode</span>
                  </button>
                </div>
              )}

              {/* Only show generator and verifier if unlocked */}
              {isExperimentalUnlocked && (
                <>
                  {/* 1. Test Signal Generator */}
                  <div className="bg-[#050505] p-3 border border-cyan-900/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-400 flex items-center space-x-1.5 uppercase text-[11px]">
                        <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                        <span>16-MFSK Test Signal Generator & DSP Injector</span>
                      </span>
                      <span className="text-[9px] text-[#888] bg-[#141414] px-1.5 py-0.5 border border-[#333]">
                        WebAudio Physical Layer Synthesizer
                      </span>
                    </div>

                    <p className="text-[#888] text-[11px] leading-relaxed">
                      Synthesize real continuous-phase 16-tone MFSK audio waveforms directly into the soundcard
                      pipeline to verify the S-meter response, waterfall display, LDPC error correction, and SIC
                      multi-station interference cancellation.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="text-[9px] uppercase text-[#888] block mb-1">
                          Signal Scenario Preset
                        </label>
                        <select
                          id="modal-test-preset-select"
                          value={testPreset}
                          onChange={(e) => setTestPreset(e.target.value)}
                          className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-400"
                        >
                          <option value="S9_CQ_JA1ABC">S9 Standard: CQ JA1ABC PM95 (+6 dB / 1250 Hz)</option>
                          <option value="S9_PLUS_G4XYZ">S9+10dB Strong DX: CQ DX G4XYZ IO91 (+16 dB / 1500 Hz)</option>
                          <option value="WEAK_VK3XYZ">Weak S3 Signal: VK3XYZ -22 dB (1800 Hz)</option>
                          <option value="SIC_COLLISION">SIC 2-Station Overlap Pileup (1400 Hz)</option>
                          <option value="CUSTOM">Custom Message & Custom Carrier</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] uppercase text-[#888] block mb-1">
                          Audio Frequency (Hz) & Bandwidth
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            min="200"
                            max="2800"
                            step="25"
                            value={testFreqHz}
                            onChange={(e) => setTestFreqHz(Number(e.target.value))}
                            className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#D4D4D4] focus:outline-none focus:border-cyan-400"
                          />
                          <span className="text-[10px] text-[#666] whitespace-nowrap">50 Hz BW</span>
                        </div>
                      </div>
                    </div>

                    {testPreset === 'CUSTOM' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="text-[9px] uppercase text-[#888] block mb-1">
                            Custom 77-Bit Message Payload
                          </label>
                          <input
                            type="text"
                            maxLength={13}
                            value={testCustomMsg}
                            onChange={(e) => setTestCustomMsg(e.target.value.toUpperCase())}
                            placeholder="e.g. CQ W1AW FN31"
                            className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#00FF41] focus:outline-none focus:border-[#00FF41]"
                          />
                        </div>

                        <div>
                          <label className="text-[9px] uppercase text-[#888] block mb-1">
                            Relative SNR Level
                          </label>
                          <select
                            value={testSnrDb}
                            onChange={(e) => setTestSnrDb(Number(e.target.value))}
                            className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#D4D4D4] focus:outline-none focus:border-cyan-400"
                          >
                            <option value="16">+16 dB (S9+10dB - Very Strong)</option>
                            <option value="6">+6 dB (S9 Standard)</option>
                            <option value="0">0 dB (S7 Moderate)</option>
                            <option value="-10">-10 dB (S5 Weak)</option>
                            <option value="-22">-22 dB (S3 Deep Weak)</option>
                            <option value="-28">-28 dB (Threshold Limit)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#222]">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={testPlayAudio}
                          onChange={(e) => setTestPlayAudio(e.target.checked)}
                          className="w-4 h-4 bg-[#141414] border-[#333] text-cyan-400 focus:ring-0 accent-cyan-400"
                        />
                        <span className="text-[11px] text-[#CCC]">
                          Play Synthesized Audio through Local Speakers / Soundcard
                        </span>
                      </label>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          id="modal-inject-test-signal-btn"
                          onClick={() => {
                            let textToUse: string | undefined = undefined;
                            if (testPreset === 'CUSTOM') {
                              textToUse = testCustomMsg.trim().toUpperCase() || 'CQ W1AW FN31';
                            }
                            const res = audioEngine.injectTestSignal(testPreset, {
                              freqHz: testFreqHz,
                              snrDb: testSnrDb,
                              playAudio: testPlayAudio,
                              customText: textToUse,
                            });
                            if (res.text) {
                              setTestFeedback(
                                `Injected: ${res.text} @ ${res.freqHz} Hz (${res.snrDb >= 0 ? '+' : ''}${res.snrDb} dB SNR / S9)`
                              );
                              setTimeout(() => setTestFeedback(null), 5000);
                            }
                          }}
                          className="px-3 py-1.5 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 hover:text-white border border-cyan-700 text-xs font-bold uppercase flex items-center space-x-1.5 transition-all shadow-[0_0_8px_rgba(6,182,212,0.2)] active:scale-95"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-cyan-300" />
                          <span>Inject Test Signal</span>
                        </button>
                      </div>
                    </div>

                    {testFeedback && (
                      <div className="p-2 bg-[#0A1A14] border border-[#00FF41]/40 text-[#00FF41] text-[11px] flex items-center space-x-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF41] flex-shrink-0" />
                        <span>{testFeedback}</span>
                      </div>
                    )}
                  </div>

                  {/* 2. Audio Decode Verifier */}
                  <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                        <Sparkles className="w-3.5 h-3.5 text-[#00FF41]" />
                        <span>Audio Decode Verifier & Multi-Pass SIC Diagnostics</span>
                      </span>
                      <button
                        type="button"
                        id="modal-run-decode-verifier-btn"
                        onClick={() => {
                          setIsVerifyingDecode(true);
                          const result = sicDecoderEngine.runSicDecodeCycle(
                            14074000,
                            form.myCall,
                            form.myGrid,
                            false
                          );
                          setTestDecodeResult({
                            timestamp: new Date().toISOString().substring(11, 19) + ' UTC',
                            decodedCount: result.decodes.length,
                            signals: result.decodes.map((d) => ({
                              freq: d.freq,
                              snr: d.snr,
                              message: d.message,
                              sicPass: d.sicPass,
                              isCq: d.isCq,
                              callFrom: d.callFrom,
                            })),
                          });
                          if (onExecuteDecodeNow) {
                            onExecuteDecodeNow();
                          }
                          setTimeout(() => setIsVerifyingDecode(false), 400);
                        }}
                        className="px-3 py-1.5 bg-[#00FF41] hover:bg-[#00FF41]/90 text-black text-xs font-bold uppercase flex items-center space-x-1.5 shadow-[0_0_10px_rgba(0,255,65,0.3)] active:scale-95"
                      >
                        <PlayCircle className="w-3.5 h-3.5 text-black" />
                        <span>{isVerifyingDecode ? 'Decoding...' : 'Run Decode Verifier Now'}</span>
                      </button>
                    </div>

                    <p className="text-[#888] text-[11px] leading-relaxed">
                      Executes the full LDPC(174,91) belief-propagation decoder and 3-pass Successive Interference
                      Cancellation on the current soundcard audio buffer. All decoded station callsigns automatically
                      expire after 60 seconds.
                    </p>

                    {/* Decode Result Table */}
                    {testDecodeResult ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[10px] text-[#888]">
                          <span>Cycle Decoded @ {testDecodeResult.timestamp}</span>
                          <span className="text-[#00FF41] font-bold">
                            {testDecodeResult.decodedCount} Signal(s) Decoded
                          </span>
                        </div>

                        {testDecodeResult.signals.length === 0 ? (
                          <div className="p-3 bg-[#111] border border-[#222] text-center text-[#666] text-xs">
                            No active carriers decoded in current audio buffer. Click "Inject Test Signal" above, then run verifier again.
                          </div>
                        ) : (
                          <div className="border border-[#333] divide-y divide-[#222] bg-[#0A0A0A]">
                            {testDecodeResult.signals.map((sig, idx) => (
                              <div key={idx} className="p-2 flex items-center justify-between text-xs">
                                <div className="flex items-center space-x-2">
                                  <span className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#888] text-[10px] font-mono border border-[#333]">
                                    {sig.freq} Hz
                                  </span>
                                  <span className="font-bold text-[#00FF41]">{sig.message}</span>
                                  {sig.isCq && (
                                    <span className="px-1 py-0.2 bg-[#00FF41]/20 text-[#00FF41] text-[9px] font-bold border border-[#00FF41]/40">
                                      CQ
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-[10px] text-cyan-300 font-mono">
                                    {sig.snr >= 0 ? `+${sig.snr}` : sig.snr} dB
                                  </span>
                                  <span className="px-1.5 py-0.5 bg-[#141414] text-purple-300 text-[9px] font-bold border border-purple-800">
                                    Pass {sig.sicPass}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-2.5 bg-[#0F0F0F] border border-[#262626] text-[11px] text-[#777] flex items-center justify-between">
                        <span>Decoder state ready. Click "Run Decode Verifier Now" to process the receiver buffer.</span>
                        <button
                          type="button"
                          onClick={() => {
                            sicDecoderEngine.clearHistory();
                            if (onExecuteDecodeNow) onExecuteDecodeNow();
                          }}
                          className="px-2 py-1 bg-[#1A1A1A] hover:bg-red-950/60 text-[#888] hover:text-red-300 border border-[#333] text-[10px] font-bold uppercase flex items-center space-x-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Flush History</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 3. Physical Layer Protocol Verification */}
                  <div className="bg-[#050505] p-3 border border-[#333] space-y-2">
                    <span className="font-bold text-[#D4D4D4] uppercase text-[11px] block">
                      Protocol Physical Layer Calibration Specifications
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div className="bg-[#111] p-2 border border-[#222]">
                        <span className="text-[#666] block">Tone Spacing</span>
                        <span className="font-bold text-[#00FF41]">3.125 Hz (CPFSK)</span>
                      </div>
                      <div className="bg-[#111] p-2 border border-[#222]">
                        <span className="text-[#666] block">Total Channel BW</span>
                        <span className="font-bold text-[#00FF41]">50.0 Hz (16-Tone)</span>
                      </div>
                      <div className="bg-[#111] p-2 border border-[#222]">
                        <span className="text-[#666] block">Symbol Duration</span>
                        <span className="font-bold text-cyan-300">320.0 ms (3.125 Bd)</span>
                      </div>
                      <div className="bg-[#111] p-2 border border-[#222]">
                        <span className="text-[#666] block">Error Correction</span>
                        <span className="font-bold text-purple-300">LDPC (174, 91)</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Save & Wizard Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-[#262626]">
            {/* Re-Run Wizard Trigger */}
            <button
              type="button"
              onClick={handleLaunchWizard}
              className="px-3 py-1.5 bg-[#141414] hover:bg-[#202020] text-[#00FF41] border border-[#00FF41]/40 text-xs font-bold uppercase flex items-center space-x-1.5"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Run Setup Wizard Again</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333] uppercase font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-[#00FF41] hover:bg-[#00FF41]/90 text-black font-bold uppercase text-xs flex items-center space-x-1.5 shadow-[0_0_10px_rgba(0,255,65,0.3)]"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Settings</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
