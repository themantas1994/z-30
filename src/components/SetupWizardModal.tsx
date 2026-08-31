/**
 * z-30 Digital Mode - Setup & Hardware Configuration Wizard Modal
 * Complete 4-Step Interactive Transceiver Setup
 */

import React, { useState, useEffect, useRef } from 'react';
import { StationConfig } from '../types/z30';
import {
  Wand2,
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Radio,
  Volume2,
  Cpu,
  Shield,
  RefreshCw,
  Play,
  Square,
  MapPin,
  AlertCircle,
  FileCheck,
  DownloadCloud,
  CheckCircle,
  AlertTriangle,
  Terminal,
  Cable,
  Radio as Globe,
  } from 'lucide-react';
import { audioEngine, SystemAudioDevice, AudioSystemDiagnostics } from '../dsp/audioEngine';
import { PTT_METHODS_CATALOG } from '../dsp/z30Constants';
import {
  TIMEZONE_CATALOG,
  getTimezoneOffsetString,
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
// The transmit gate's own callsign validator and the one grid decoder, imported rather than
// re-implemented. Both modals used to carry a looser CALLSIGN_REGEX than canTransmit() does,
// so the wizard showed "Valid ITU Callsign" for calls the gate refuses at slot start (W1, K1A2)
// and "Invalid" for ones it permits (DL/W1AW).
import { isValidCallsign } from '../dsp/bandPlan';
import { isValidGrid, maidenheadToLatLon } from '../dsp/gridSquare';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StationConfig;
  onSaveConfig: (cfg: StationConfig) => void;
}

// Re-export full Hamlib rig catalog as RIG_CATALOG for backward compatibility
export const RIG_CATALOG = HAMLIB_ALL_RIGS;

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [form, setForm] = useState<StationConfig>({ ...config });
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Real System Audio Devices & Diagnostics
  const [systemInputs, setSystemInputs] = useState<SystemAudioDevice[]>([]);
  const [systemOutputs, setSystemOutputs] = useState<SystemAudioDevice[]>([]);
  const [isScanningDevices, setIsScanningDevices] = useState<boolean>(false);
  const [audioPermissionGranted, setAudioPermissionGranted] = useState<boolean>(false);
  const [diagnostics, setDiagnostics] = useState<AudioSystemDiagnostics | null>(null);

  // Real Hardware Serial / COM Ports
  const [discoveredPorts, setDiscoveredPorts] = useState<DiscoveredSerialPort[]>([]);
  const [isQueryingSerial, setIsQueryingSerial] = useState<boolean>(false);
  const [isCustomPortMode, setIsCustomPortMode] = useState<boolean>(false);

  // Audio meter test state
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
      console.warn('Failed to query system audio devices in wizard:', e);
    } finally {
      setIsScanningDevices(false);
    }
  };

  // Scan system serial ports from browser hardware layer
  const scanSerialPorts = async () => {
    setIsQueryingSerial(true);
    try {
      const ports = await catController.queryRealSerialPorts();
      setDiscoveredPorts(ports);
    } catch (e) {
      console.warn('Failed to query serial ports in wizard:', e);
    } finally {
      setIsQueryingSerial(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setForm({ ...config });
      setCurrentStep(0);
      setErrorMsg('');
      setCatTestStatus('');
      setCatTestSuccess(null);
      setPttTestMsg('');
      setHamlibUpdateMsg('');
      setSerialFeedback('');
      setIsPttTesting(false);
      setIsAudioTesting(false);
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

  // Clean up timers on unmount or close
  useEffect(() => {
    return () => {
      if (audioAnimRef.current) cancelAnimationFrame(audioAnimRef.current);
      if (pttTimeoutRef.current) clearTimeout(pttTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  // Validation helpers
  const validateCall = (call: string): { ok: boolean; msg: string } => {
    const c = call.trim().toUpperCase();
    if (!c) return { ok: false, msg: 'Callsign cannot be blank' };
    // 17 = the widest string isValidCallsign() can accept (3-char portable prefix + base +
    // 4-char suffix). A tighter bound here would reject callsigns the transmit gate permits,
    // which is the disagreement this whole change exists to remove.
    if (c.length < 3 || c.length > 17) return { ok: false, msg: 'Length must be 3-17 characters' };
    if (!isValidCallsign(c)) return { ok: false, msg: 'Invalid ITU callsign format' };
    return { ok: true, msg: 'Valid ITU format' };
  };

  const validateGrid = (grid: string): { ok: boolean; msg: string } => {
    const g = grid.trim();
    if (!g) return { ok: false, msg: 'Grid cannot be blank' };
    if (g.length !== 4 && g.length !== 6) return { ok: false, msg: 'Must be 4 or 6 characters (e.g. FN31pr)' };
    if (!isValidGrid(g)) return { ok: false, msg: 'Invalid Maidenhead locator square' };
    return { ok: true, msg: 'Valid Maidenhead' };
  };

  const callVal = validateCall(form.myCall);
  const gridVal = validateGrid(form.myGrid);
  const latLon = maidenheadToLatLon(form.myGrid);

  // Live Real Audio VU Meter
  const startAudioTest = async () => {
    setIsAudioTesting(true);
    const matchingInput = systemInputs.find(
      (d) => d.label === form.audioInputDevice || d.deviceId === form.audioInputDevice
    );
    const success = await audioEngine.enableMicrophone(matchingInput?.deviceId);
    if (!success) {
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
    setHamlibUpdateMsg('Checking Hamlib upstream repository for the latest release version...');
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
      setSerialFeedback(`✗ Serial error: ${e?.message || 'Connection cancelled'}`);
    } finally {
      setIsConnectingSerial(false);
    }
  };

  // REAL CAT Test Handler (NO FALSE PASS)
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

  // REAL PTT Test Handler (9 Methods with 3s Safety Auto-Cutoff)
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

  const handleNext = () => {
    setErrorMsg('');
    if (currentStep === 0) {
      if (!callVal.ok) {
        setErrorMsg(callVal.msg);
        return;
      }
      if (!gridVal.ok) {
        setErrorMsg(gridVal.msg);
        return;
      }
    }
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    setIsAudioTesting(false);
    if (isPttTesting) setIsPttTesting(false);
    setCurrentStep((prev) => Math.min(3, prev + 1));
  };

  const handleBack = () => {
    setErrorMsg('');
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    setIsAudioTesting(false);
    if (isPttTesting) setIsPttTesting(false);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleFinish = async () => {
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    setIsAudioTesting(false);
    if (isPttTesting) setIsPttTesting(false);

    try {
      localStorage.setItem('z30_wizard_completed', 'true');
    } catch {
      // ignore
    }

    // Keep/activate the selected audio receiver stream running for the station
    await audioEngine.enableMicrophone(form.audioInputDevice);
    onSaveConfig(form);
    onClose();
  };

  const steps = [
    { title: 'Operator Info', icon: Radio, desc: 'Callsign & Maidenhead' },
    { title: 'Audio Devices', icon: Volume2, desc: 'Soundcards & Level Test' },
    { title: 'Radio & CAT', icon: Cpu, desc: 'Rig Control & PTT Keying' },
    { title: 'Summary', icon: FileCheck, desc: 'Review & Complete' },
  ];


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono select-none">
      <div className="bg-[#141414] border border-[#333] w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0F0F0F] border-b border-[#333]">
          <div className="flex items-center space-x-2">
            <Wand2 className="w-4 h-4 text-[#00FF41]" />
            <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
              z-30 Transceiver Setup & Hardware Configuration Wizard
            </span>
          </div>
          <button
            onClick={() => {
              if (isAudioTesting) toggleAudioTest();
              if (isPttTesting) setIsPttTesting(false);
              onClose();
            }}
            className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content Container with Sidebar & Pages */}
        <div className="flex flex-1 min-h-0 bg-[#0A0A0A]">
          {/* Left Sidebar Steps */}
          <div className="w-48 bg-[#0D0D0D] border-r border-[#222] p-3 flex flex-col justify-between hidden sm:flex">
            <div className="space-y-1.5">
              <div className="pb-2 border-b border-[#222]">
                <span className="text-[10px] font-bold text-[#00FF41] uppercase tracking-widest block">
                  Setup Progress
                </span>
                <span className="text-[9px] text-[#666]">Step {currentStep + 1} of 4</span>
              </div>

              {steps.map((step, idx) => {
                const isActive = currentStep === idx;
                const isDone = currentStep > idx;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (isDone) setCurrentStep(idx);
                    }}
                    disabled={!isDone && !isActive}
                    className={`w-full text-left p-2 border flex items-center space-x-2 transition-all ${
                      isActive
                        ? 'bg-[#181818] border-[#00FF41] text-[#00FF41]'
                        : isDone
                        ? 'bg-[#111] border-[#333] text-cyan-400 cursor-pointer hover:bg-[#161616]'
                        : 'bg-transparent border-transparent text-[#555] cursor-not-allowed'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isActive
                          ? 'bg-[#00FF41] text-black'
                          : isDone
                          ? 'bg-cyan-500 text-black'
                          : 'bg-[#222] text-[#666]'
                      }`}
                    >
                      {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold truncate leading-tight">{step.title}</div>
                      <div className="text-[8px] text-[#777] truncate">{step.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="p-2 bg-[#121212] border border-[#222] text-[9px] text-[#777] space-y-1">
              <div className="text-[#00FF41] font-bold uppercase">16-MFSK Protocol</div>
              <div>50 Hz Occupied BW</div>
              <div>30s Sync Cycle</div>
              <div>LDPC(216,77) + SIC</div>
            </div>
          </div>

          {/* Right Main Page */}
          <div className="flex-1 p-4 overflow-y-auto flex flex-col justify-between">
            {/* Step 1: Operator Station Identification */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <div className="border-b border-[#222] pb-2">
                  <h3 className="text-xs font-bold text-[#00FF41] uppercase flex items-center space-x-1.5">
                    <Radio className="w-4 h-4" />
                    <span>Step 1: Operator Station Identification</span>
                  </h3>
                  <p className="text-[10px] text-[#888]">
                    Enter your official callsign and Maidenhead grid locator square for z-30 transmission.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Callsign */}
                  <div className="bg-[#121212] p-3 border border-[#222] space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-[#D4D4D4] block">
                      My Callsign <span className="text-[#00FF41]">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.myCall}
                      onChange={(e) => setForm({ ...form, myCall: e.target.value.toUpperCase() })}
                      placeholder="e.g. W1AW, DL1ABC"
                      className="w-full bg-[#181818] border border-[#333] px-3 py-1.5 text-sm text-cyan-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
                      autoFocus
                    />
                    <div className="flex items-center space-x-1 text-[9px]">
                      <span className={callVal.ok ? 'text-[#00FF41]' : 'text-red-400'}>
                        {callVal.ok ? '✓ ' : '✗ '}
                        {callVal.msg}
                      </span>
                    </div>
                  </div>

                  {/* Grid */}
                  <div className="bg-[#121212] p-3 border border-[#222] space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-[#D4D4D4] block">
                      Maidenhead Grid Locator <span className="text-[#00FF41]">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.myGrid}
                      onChange={(e) => setForm({ ...form, myGrid: e.target.value.toUpperCase() })}
                      placeholder="e.g. FN31pr"
                      maxLength={6}
                      className="w-full bg-[#181818] border border-[#333] px-3 py-1.5 text-sm text-yellow-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
                    />
                    <div className="flex items-center space-x-1 text-[9px]">
                      <span className={gridVal.ok ? 'text-[#00FF41]' : 'text-red-400'}>
                        {gridVal.ok ? '✓ ' : '✗ '}
                        {gridVal.msg}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Location Preview Banner */}
                {latLon && (
                  <div className="bg-[#0c1810] border border-[#1b3d22] p-2.5 text-[10px] flex items-center space-x-2 text-cyan-300">
                    <MapPin className="w-3.5 h-3.5 text-[#00FF41] flex-shrink-0" />
                    <span>
                      Computed QTH Coordinates: <strong>{Math.abs(latLon.lat).toFixed(2)}° {latLon.lat >= 0 ? 'N' : 'S'}</strong>,{' '}
                      <strong>{Math.abs(latLon.lon).toFixed(2)}° {latLon.lon >= 0 ? 'E' : 'W'}</strong>
                    </span>
                  </div>
                )}

                {/* Additional Station Details */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2.5">
                  <div className="text-[10px] font-bold text-[#AAA] uppercase">Optional Station Details</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">Operator Name</label>
                      <input
                        type="text"
                        value={form.operatorName || ''}
                        onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
                        placeholder="e.g. Maxim"
                        className="w-full bg-[#181818] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">QTH / City</label>
                      <input
                        type="text"
                        value={form.qthDescription || ''}
                        onChange={(e) => setForm({ ...form, qthDescription: e.target.value })}
                        placeholder="e.g. Newington, CT"
                        className="w-full bg-[#181818] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">TX Power (Watts)</label>
                      <input
                        type="number"
                        min="1"
                        max="1500"
                        value={form.txPowerWatts}
                        onChange={(e) => setForm({ ...form, txPowerWatts: Number(e.target.value) })}
                        className="w-full bg-[#181818] border border-[#333] px-2.5 py-1 text-xs text-red-400 font-bold focus:outline-none focus:border-[#00FF41]"
                      />
                    </div>
                  </div>
                </div>

                {/* Operating Timezone & UTC Master Reference */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-[#AAA] uppercase flex items-center space-x-1.5">
                      <Globe className="w-3.5 h-3.5 text-[#00FF41]" />
                      <span>Station Timezone & Universal Clock Reference</span>
                    </div>
                    <span className="text-[8px] text-zinc-400 bg-[#0A0A0A] px-1.5 py-0.5 border border-[#222]">
                      Protocol: <strong className="text-[#00FF41]">UTC Master</strong>
                    </span>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#777] block mb-1">Station Timezone</label>
                    <select
                      value={form.timezone || 'UTC'}
                      onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                      className="w-full bg-[#181818] border border-[#333] px-2.5 py-1 text-xs text-cyan-400 font-mono focus:outline-none focus:border-[#00FF41]"
                    >
                      <optgroup label="Standard Radio Protocol">
                        <option value="UTC">UTC (Coordinated Universal Time / GMT) - Default</option>
                        <option value="SYSTEM_LOCAL">System Local Time (Browser / OS)</option>
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

                  <div className="text-[9px] text-zinc-400 bg-[#0A0A0A] p-2 border border-[#1A1A1A] leading-tight">
                    <strong className="text-zinc-200">Note:</strong> All z-30 30-second digital transmission cycles, QSO timestamps, and RF standard time synchronizations are calculated in <strong>Universal Coordinated Time (UTC)</strong>. Local timezone is used for station display formatting.
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Audio Device & DSP Configuration */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="border-b border-[#222] pb-2">
                  <h3 className="text-xs font-bold text-[#00FF41] uppercase flex items-center space-x-1.5">
                    <Volume2 className="w-4 h-4" />
                    <span>Step 2: Sound Card & Audio DSP Configuration</span>
                  </h3>
                  <p className="text-[10px] text-[#888]">
                    Configure audio input (Rx demodulator) and output (Tx modulator) sound interfaces.
                  </p>
                </div>

                {/* System Audio Hardware Scanner Bar */}
                <div className="bg-[#0b0b0b] p-3 border border-[#262626] space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <Volume2 className="w-3.5 h-3.5 text-[#00FF41]" />
                      <span className="text-[10px] font-bold uppercase text-[#D4D4D4]">
                        Operating System Audio Detection
                      </span>
                      <span
                        className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          audioPermissionGranted
                            ? 'bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/40'
                            : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                        }`}
                      >
                        {audioPermissionGranted ? '✓ Authorized' : '⚠ Limited Labels'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {!audioPermissionGranted && (
                        <button
                          type="button"
                          onClick={() => scanSystemDevices(true)}
                          disabled={isScanningDevices}
                          className="px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/50 text-[9px] font-bold uppercase flex items-center space-x-1"
                        >
                          <Shield className="w-2.5 h-2.5" />
                          <span>Authorize Devices</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => scanSystemDevices(false)}
                        disabled={isScanningDevices}
                        className="px-2 py-1 bg-[#1A1A1A] hover:bg-[#282828] text-[#00FF41] border border-[#333] text-[9px] font-bold uppercase flex items-center space-x-1"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isScanningDevices ? 'animate-spin' : ''}`} />
                        <span>{isScanningDevices ? 'Scanning...' : 'Scan System Devices'}</span>
                      </button>
                    </div>
                  </div>

                  {diagnostics && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[8px]">
                      <div className="bg-[#141414] p-1.5 border border-[#222]">
                        <span className="text-[#666] block uppercase">Sample Rate</span>
                        <span className="text-cyan-400 font-bold">{diagnostics.sampleRate} Hz</span>
                      </div>
                      <div className="bg-[#141414] p-1.5 border border-[#222]">
                        <span className="text-[#666] block uppercase">OS Inputs</span>
                        <span className="text-[#00FF41] font-bold">{systemInputs.length || 1} Detected</span>
                      </div>
                      <div className="bg-[#141414] p-1.5 border border-[#222]">
                        <span className="text-[#666] block uppercase">OS Outputs</span>
                        <span className="text-yellow-400 font-bold">{systemOutputs.length || 1} Detected</span>
                      </div>
                      <div className="bg-[#141414] p-1.5 border border-[#222]">
                        <span className="text-[#666] block uppercase">Web Audio Subsystem</span>
                        <span className="text-purple-400 font-bold">{diagnostics.contextState.toUpperCase()}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Input Soundcard */}
                  <div className="bg-[#121212] p-3 border border-[#222] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase font-bold text-[#D4D4D4]">
                        Input Device (Rx Demodulator Audio)
                      </label>
                      <span className="text-[8px] text-cyan-400">
                        {systemInputs.length > 0 ? `${systemInputs.length} detected` : 'Generic'}
                      </span>
                    </div>
                    <select
                      value={form.audioInputDevice}
                      onChange={(e) => setForm({ ...form, audioInputDevice: e.target.value })}
                      className="w-full bg-[#181818] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-[#00FF41]"
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

                  {/* Output Soundcard */}
                  <div className="bg-[#121212] p-3 border border-[#222] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase font-bold text-[#D4D4D4]">
                        Output Device (Tx Modulator Audio)
                      </label>
                      <span className="text-[8px] text-yellow-400">
                        {systemOutputs.length > 0 ? `${systemOutputs.length} detected` : 'Generic'}
                      </span>
                    </div>
                    <select
                      value={form.audioOutputDevice}
                      onChange={(e) => setForm({ ...form, audioOutputDevice: e.target.value })}
                      className="w-full bg-[#181818] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 focus:outline-none focus:border-[#00FF41]"
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

                {/* DSP Sample Rate & Channels */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2">
                  <div className="text-[10px] font-bold text-[#AAA] uppercase">Audio DSP Parameters</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">Native DSP Sample Rate</label>
                      <select
                        value={form.sampleRateHz || 12000}
                        onChange={(e) => setForm({ ...form, sampleRateHz: Number(e.target.value) })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value={12000}>12000 Hz (Native z-30 16-MFSK Bandwidth)</option>
                        <option value={48000}>48000 Hz (Standard 24-bit HD Audio CODEC)</option>
                        <option value={44100}>44100 Hz (Legacy Soundcard Sample Rate)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">Channel Routing</label>
                      <select
                        value={form.audioChannels || 1}
                        onChange={(e) => setForm({ ...form, audioChannels: Number(e.target.value) as any })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value={1}>Mono (Channel 1 / Left Rx Audio)</option>
                        <option value={2}>Stereo (Dual Channel I/Q or Stereo)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Real-Time Input Level VU Meter Test */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-bold text-[#D4D4D4] uppercase">
                        Live Audio Input Level Verification (Hardware Test)
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

                  {/* VU Canvas Bar */}
                  <div className="flex items-center space-x-3 bg-[#080808] p-2 border border-[#262626]">
                    <div className="flex-1 h-4 bg-[#141414] overflow-hidden rounded-sm relative flex items-center">
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
                      <span className="text-cyan-400 w-16 text-right">
                        {isAudioTesting ? (rmsDb > -99 ? `${rmsDb.toFixed(1)} dB` : '-inf dB') : '0.0 dB'}
                      </span>
                      <span className="text-[#666] text-[8px] hidden sm:inline">
                        {isAudioTesting ? `(Peak: ${peakDb.toFixed(1)} dB)` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="text-[8px] text-[#666] flex justify-between px-1">
                    <span>-60 dB (Noise Floor)</span>
                    <span>-30 dB (Weak Signal)</span>
                    <span>-10 dB (Optimal Receiver Level)</span>
                    <span className="text-red-400">0 dB (Clip)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Transceiver CAT & PTT Control Configuration */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="border-b border-[#222] pb-2">
                  <h3 className="text-xs font-bold text-[#00FF41] uppercase flex items-center space-x-1.5">
                    <Cpu className="w-4 h-4" />
                    <span>Step 3: Transceiver CAT & PTT Hardware Control</span>
                  </h3>
                  <p className="text-[10px] text-[#888]">
                    Configure Hamlib / Serial transceiver control, RTS/DTR PTT keying, and test hardware lines.
                  </p>
                </div>

                {/* Hamlib Library Version Banner & Upstream Update Control */}
                <div className="bg-[#101010] p-3 border border-[#00FF41]/30 space-y-2">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* CAT Method */}
                  <div className="bg-[#121212] p-2.5 border border-[#222] space-y-1">
                    <label className="text-[9px] uppercase text-[#777] block">CAT Control Method</label>
                    <select
                      value={form.catMethod || 'Hamlib'}
                      onChange={(e) => setForm({ ...form, catMethod: e.target.value as any })}
                      className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#00FF41] font-bold focus:outline-none"
                    >
                      <option value="Hamlib">Hamlib (libhamlib/rigctld TCP Daemon)</option>
                      <option value="Direct Serial">Direct Serial CAT (Web Serial / COM Port)</option>
                      <option value="None">None (Manual PTT / Audio VOX Mode)</option>
                    </select>
                  </div>

                  {/* Rig Model with Hamlib Search/Filter */}
                  <div className="bg-[#121212] p-2.5 border border-[#222] space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] uppercase text-[#777]">Transceiver Rig Model</label>
                      <span className="text-[8px] text-cyan-400">
                        {searchHamlibRigs(hamlibSearch, hamlibMfg).length} models available
                      </span>
                    </div>

                    <div className="flex gap-1 mb-1">
                      <input
                        type="text"
                        placeholder="Search rigs (e.g. 7300, FT-991, K4)..."
                        value={hamlibSearch}
                        onChange={(e) => setHamlibSearch(e.target.value)}
                        className="flex-1 bg-[#181818] border border-[#333] px-2 py-0.5 text-[9px] text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      />
                      <select
                        value={hamlibMfg}
                        onChange={(e) => setHamlibMfg(e.target.value)}
                        className="bg-[#181818] border border-[#333] px-1.5 py-0.5 text-[9px] text-[#00FF41] focus:outline-none"
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
                      className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
                    >
                      {searchHamlibRigs(hamlibSearch, hamlibMfg).map((r) => (
                        <option key={`${r.id}-${r.name}`} value={r.name}>
                          [{r.id}] {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Serial Parameters & Web Serial Pairing */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2.5">
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

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[9px] uppercase text-[#777]">Serial / COM Port</label>
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
                          className="w-full bg-[#181818] border border-cyan-500/50 px-2 py-1 text-xs text-[#00FF41] font-mono focus:outline-none"
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
                          className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
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
                      <label className="text-[9px] uppercase text-[#777] block mb-1">Baud Rate</label>
                      <select
                        value={form.baudRate}
                        onChange={(e) => setForm({ ...form, baudRate: Number(e.target.value) })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
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

                {/* PTT Keying & Pin Polarity */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-[#AAA] uppercase">
                      Push-To-Talk (PTT) Keying Architecture (Universal Rig Support)
                    </div>
                    <span className="text-[8px] text-[#00FF41] bg-green-950/60 border border-green-700/50 px-1 py-0.2 rounded font-bold">
                      9 Methods
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">
                        PTT Keying Method <span className="text-yellow-400">*</span>
                      </label>
                      <select
                        value={form.pttMethod}
                        onChange={(e) => setForm({ ...form, pttMethod: e.target.value as any })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-yellow-400 font-bold focus:outline-none"
                      >
                        <optgroup label="CAT / Serial Commands">
                          <option value="CAT">CAT Command (\set_ptt 1 / T 1 / CI-V)</option>
                          <option value="WINKEYER">K1EL WinKeyer 2/3 Serial PTT</option>
                        </optgroup>
                        <optgroup label="Direct Hardware Serial Control Lines">
                          <option value="RTS">Serial Port RTS Pin (Request-To-Send)</option>
                          <option value="DTR">Serial Port DTR Pin (Data-Terminal-Ready)</option>
                        </optgroup>
                        <optgroup label="Audio Tone & VOX Keying">
                          <option value="AUDIO_TONE_RIGHT">Right-Channel Audio PTT Tone (1000/1500Hz Sine)</option>
                          <option value="VOX">Transceiver Audio VOX</option>
                        </optgroup>
                        <optgroup label="Embedded Soundcard & SBC GPIO">
                          <option value="CM108_GPIO">C-Media CM108/CM119 USB Audio GPIO (DRA/URI)</option>
                          <option value="RASPBERRY_PI_GPIO">Raspberry Pi / Linux SBC Direct GPIO</option>
                        </optgroup>
                        <optgroup label="Network & SDR Protocol">
                          <option value="TCI_NETWORK">TCI Network Protocol (ExpertSDR / SunSDR / Thetis)</option>
                        </optgroup>
                      </select>
                    </div>

                    {/* Method-specific options */}
                    {(form.pttMethod === 'RTS' || form.pttMethod === 'DTR' || form.pttMethod === 'RASPBERRY_PI_GPIO') && (
                      <div>
                        <label className="text-[9px] uppercase text-[#777] block mb-1">Pin Polarity</label>
                        <select
                          value={form.pttPolarity || 'ACTIVE_HIGH'}
                          onChange={(e) => setForm({ ...form, pttPolarity: e.target.value as any })}
                          className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
                        >
                          <option value="ACTIVE_HIGH">Active High (+12V / Logic 1 = PTT ON)</option>
                          <option value="ACTIVE_LOW">Active Low (Inverted / Optocoupler Pull-GND)</option>
                        </select>
                      </div>
                    )}

                    {form.pttMethod === 'AUDIO_TONE_RIGHT' && (
                      <div>
                        <label className="text-[9px] uppercase text-[#777] block mb-1">PTT Tone Frequency</label>
                        <select
                          value={form.pttToneFreqHz || 1000}
                          onChange={(e) => setForm({ ...form, pttToneFreqHz: Number(e.target.value) })}
                          className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-yellow-400 font-bold focus:outline-none"
                        >
                          <option value={1000}>1000 Hz Sine (SignaLink / Rigblaster Tone Rectifier)</option>
                          <option value={1500}>1500 Hz Sine (High-Q Hardware Tone Detector)</option>
                          <option value={2000}>2000 Hz Sine (Low-Latency Discriminator)</option>
                        </select>
                      </div>
                    )}

                    {form.pttMethod === 'CM108_GPIO' && (
                      <div>
                        <label className="text-[9px] uppercase text-[#777] block mb-1">CM108 / CM119 GPIO Pin</label>
                        <select
                          value={form.cm108GpioPin || 3}
                          onChange={(e) => setForm({ ...form, cm108GpioPin: Number(e.target.value) })}
                          className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-cyan-400 font-bold focus:outline-none"
                        >
                          <option value={3}>GPIO 3 (Pin 13 - Masters Communications DRA / URI standard)</option>
                          <option value={4}>GPIO 4 (Pin 14 - Digirig CM108 / custom)</option>
                        </select>
                      </div>
                    )}

                    {form.pttMethod === 'RASPBERRY_PI_GPIO' && (
                      <div>
                        <label className="text-[9px] uppercase text-[#777] block mb-1">BCM GPIO Pin</label>
                        <select
                          value={form.rpiGpioPin || 17}
                          onChange={(e) => setForm({ ...form, rpiGpioPin: Number(e.target.value) })}
                          className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-green-400 font-bold focus:outline-none"
                        >
                          <option value={17}>BCM 17 (Header Pin 11 - Standard TNC-Pi HAT)</option>
                          <option value={27}>BCM 27 (Header Pin 13)</option>
                          <option value={22}>BCM 22 (Header Pin 15)</option>
                          <option value={23}>BCM 23 (Header Pin 16)</option>
                        </select>
                      </div>
                    )}

                    {form.pttMethod === 'TCI_NETWORK' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] uppercase text-[#777] block mb-1">TCI Host</label>
                          <input
                            type="text"
                            value={form.tciHost || '127.0.0.1'}
                            onChange={(e) => setForm({ ...form, tciHost: e.target.value })}
                            className="w-full bg-[#181818] border border-[#333] px-2 py-0.5 text-xs text-[#D4D4D4] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] uppercase text-[#777] block mb-1">TCI Port</label>
                          <input
                            type="number"
                            value={form.tciPort || 40001}
                            onChange={(e) => setForm({ ...form, tciPort: Number(e.target.value) })}
                            className="w-full bg-[#181818] border border-[#333] px-2 py-0.5 text-xs text-[#D4D4D4] focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {form.pttMethod === 'WINKEYER' && (
                      <div>
                        <label className="text-[9px] uppercase text-[#777] block mb-1">WinKeyer Port</label>
                        <input
                          type="text"
                          value={form.winkeyerPort || 'COM1'}
                          onChange={(e) => setForm({ ...form, winkeyerPort: e.target.value })}
                          placeholder="COM1, /dev/ttyUSB1..."
                          className="w-full bg-[#181818] border border-[#333] px-2 py-0.5 text-xs text-yellow-400 font-mono focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* Method Guidance Card */}
                  {(() => {
                    const meta = PTT_METHODS_CATALOG.find((m) => m.id === form.pttMethod) || PTT_METHODS_CATALOG[0];
                    return (
                      <div className="text-[9px] text-[#BBB] bg-[#0A0A0A] p-2 border border-[#1E1E1E] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-cyan-400">{meta.name}</span>
                          <span className="text-[8px] text-yellow-400">{meta.recommendedFor}</span>
                        </div>
                        <p className="text-[#888]">{meta.description}</p>
                        <div className="text-[8px] text-[#00FF41]">
                          Compatible: {meta.supportedRigs}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Interactive Hardware Test Buttons */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2">
                  <div className="text-[10px] font-bold text-[#D4D4D4] uppercase">
                    Hardware Verification & Keying Safety Test
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                      {isPttTesting ? '● Keying PTT (3s Safety Auto-Cutoff)' : 'PTT Key Test (3s Auto-Release)'}
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

            {/* Step 4: Summary & Confirmation */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="border-b border-[#222] pb-2">
                  <h3 className="text-xs font-bold text-[#00FF41] uppercase flex items-center space-x-1.5">
                    <FileCheck className="w-4 h-4" />
                    <span>Step 4: Configuration Review & Summary</span>
                  </h3>
                  <p className="text-[10px] text-[#888]">
                    Review your station parameters. Click "Finish & Save" to apply settings to the z-30 transceiver.
                  </p>
                </div>

                <div className="bg-[#0D0D0D] border border-[#262626] overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-[#181818] text-[9px] uppercase text-[#888] border-b border-[#262626]">
                      <tr>
                        <th className="p-2">Configuration Parameter</th>
                        <th className="p-2">Configured Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1D1D1D] text-[10px]">
                      <tr>
                        <td className="p-2 text-[#888]">Operator Callsign</td>
                        <td className="p-2 text-cyan-400 font-bold">{form.myCall}</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Maidenhead Grid Locator</td>
                        <td className="p-2 text-yellow-400 font-bold">{form.myGrid}</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Operator & QTH</td>
                        <td className="p-2 text-[#D4D4D4]">
                          {form.operatorName || 'N/A'} ({form.qthDescription || 'N/A'})
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Station Timezone</td>
                        <td className="p-2 text-cyan-400 font-mono">
                          {form.timezone || 'UTC'} [{getTimezoneOffsetString(form.timezone || 'UTC')}] (Master Clock: UTC)
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Audio Rx Input</td>
                        <td className="p-2 text-[#D4D4D4]">{form.audioInputDevice}</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Audio Tx Output</td>
                        <td className="p-2 text-[#D4D4D4]">{form.audioOutputDevice}</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Sample Rate / Channels</td>
                        <td className="p-2 text-[#D4D4D4]">
                          {form.sampleRateHz || 12000} Hz / {form.audioChannels === 2 ? 'Stereo' : 'Mono'}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">CAT Control / Rig Model</td>
                        <td className="p-2 text-[#00FF41]">
                          {form.catMethod || 'Hamlib'} : {form.rigModel}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Serial Port & Baud</td>
                        <td className="p-2 text-[#D4D4D4]">
                          {form.serialPort} @ {form.baudRate} baud
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">PTT Keying & Polarity</td>
                        <td className="p-2 text-red-400 font-bold">
                          {form.pttMethod} ({form.pttPolarity || 'ACTIVE_HIGH'})
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">Auto-Reply Priority Rule</td>
                        <td className="p-2 text-[#00FF41] font-bold">
                          {form.autoReplyPriority || 'FIRST'} (Nearest, Farthest, First, Last, Strongest, Weakest)
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-[#888]">z-30 Protocol Standard</td>
                        <td className="p-2 text-[#38BDF8]">
                          16-MFSK / 50 Hz BW / 30s Slot / LDPC(216,77) + SIC
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="bg-red-950/40 border border-red-500 text-red-400 p-2 text-xs flex items-center space-x-1.5 mt-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Bottom Navigation Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-[#222] mt-4">
              <button
                type="button"
                onClick={() => {
                  if (isAudioTesting) toggleAudioTest();
                  if (isPttTesting) setIsPttTesting(false);
                  onClose();
                }}
                className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333] uppercase font-bold text-xs"
              >
                Cancel
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={currentStep === 0}
                  className={`px-3 py-1 uppercase font-bold text-xs flex items-center space-x-1 border ${
                    currentStep === 0
                      ? 'bg-transparent text-[#555] border-transparent cursor-not-allowed'
                      : 'bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D4] border-[#333]'
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>

                {currentStep < 3 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="px-4 py-1 bg-[#00FF41] hover:bg-[#00FF41]/90 text-black font-bold uppercase text-xs flex items-center space-x-1"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="px-4 py-1 bg-[#00FF41] hover:bg-[#00FF41]/90 text-black font-bold uppercase text-xs flex items-center space-x-1.5 shadow-[0_0_10px_rgba(0,255,65,0.4)]"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Finish & Save</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
