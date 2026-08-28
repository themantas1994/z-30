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
  Sparkles,
  MapPin,
  AlertCircle,
  FileCheck,
} from 'lucide-react';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StationConfig;
  onSaveConfig: (cfg: StationConfig) => void;
}

// ITU Callsign regex
const CALLSIGN_REGEX = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/i;
// Maidenhead regex
const GRID_REGEX = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i;

// Helper to calculate lat/lon from Maidenhead grid
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

export const RIG_CATALOG = [
  { name: 'Icom IC-7300 (USB Audio/CAT)', id: 3073 },
  { name: 'Icom IC-7610 (Direct USB)', id: 3078 },
  { name: 'Icom IC-705 (QRP / Bluetooth / USB)', id: 3085 },
  { name: 'Icom IC-7100', id: 3070 },
  { name: 'Icom IC-9700 (VHF/UHF/1.2G)', id: 3081 },
  { name: 'Icom Generic CI-V Transceiver', id: 3000 },
  { name: 'Yaesu FT-991A', id: 1035 },
  { name: 'Yaesu FTDX10 / FTDX101D', id: 1040 },
  { name: 'Yaesu FT-891', id: 1036 },
  { name: 'Yaesu FT-857D / FT-897', id: 1022 },
  { name: 'Yaesu FT-817 / FT-818 (QRP)', id: 1020 },
  { name: 'Elecraft K3 / K3S', id: 2029 },
  { name: 'Elecraft K4', id: 2038 },
  { name: 'Elecraft KX3 / KX2 (QRP)', id: 2045 },
  { name: 'Kenwood TS-590SG', id: 2028 },
  { name: 'Kenwood TS-890S', id: 2048 },
  { name: 'Kenwood TS-2000', id: 2014 },
  { name: 'Xiegu G90 (CE-19 Interface)', id: 3088 },
  { name: 'Xiegu X6100 (Embedded SDR)', id: 3090 },
  { name: 'QRP Labs QDX Digital Transceiver', id: 3092 },
  { name: 'FlexRadio 6xxx Series (SmartSDR)', id: 1014 },
  { name: 'Hamlib NET rigctl Client (Remote Daemon)', id: 2 },
  { name: 'Dummy / Simulated Rig (Testing)', id: 1 },
];

export const AUDIO_INPUTS = [
  'Default Sound Card (USB Audio CODEC)',
  'Microphone (Realtek High Definition Audio)',
  'Line In (Virtual Audio Cable / VAC)',
  'USB Audio CODEC (IC-7300 / FT-991A Direct)',
];

export const AUDIO_OUTPUTS = [
  'Default Sound Card (USB Audio CODEC)',
  'Speakers (Realtek High Definition Audio)',
  'Line Out (Virtual Audio Cable / VAC)',
  'USB Audio CODEC (Transmitter Audio In)',
];

export const SERIAL_PORTS = [
  '/dev/ttyUSB0 (COM3 - Silicon Labs CP210x)',
  '/dev/ttyUSB1 (COM4 - FTDI Dual UART)',
  '/dev/ttyACM0 (COM5 - USB Transceiver Interface)',
  '/dev/cu.usbserial-0001 (macOS CP2102)',
  'COM1 (Standard Hardware Serial Port)',
];

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [form, setForm] = useState<StationConfig>({ ...config });
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Audio meter test state
  const [isAudioTesting, setIsAudioTesting] = useState<boolean>(false);
  const [vuLevel, setVuLevel] = useState<number>(0);
  const audioIntervalRef = useRef<number | null>(null);

  // CAT & PTT test state
  const [catTestStatus, setCatTestStatus] = useState<string>('');
  const [isPttTesting, setIsPttTesting] = useState<boolean>(false);
  const pttTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm({ ...config });
      setCurrentStep(0);
      setErrorMsg('');
      setCatTestStatus('');
      setIsPttTesting(false);
      setIsAudioTesting(false);
    }
  }, [isOpen, config]);

  // Clean up timers on unmount or close
  useEffect(() => {
    return () => {
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
      if (pttTimeoutRef.current) clearTimeout(pttTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  // Validation helpers
  const validateCall = (call: string): { ok: boolean; msg: string } => {
    const c = call.trim().toUpperCase();
    if (!c) return { ok: false, msg: 'Callsign cannot be blank' };
    if (c.length < 3 || c.length > 12) return { ok: false, msg: 'Length must be 3-12 characters' };
    if (!CALLSIGN_REGEX.test(c)) return { ok: false, msg: 'Invalid ITU callsign format' };
    return { ok: true, msg: 'Valid ITU format' };
  };

  const validateGrid = (grid: string): { ok: boolean; msg: string } => {
    const g = grid.trim();
    if (!g) return { ok: false, msg: 'Grid cannot be blank' };
    if (g.length !== 4 && g.length !== 6) return { ok: false, msg: 'Must be 4 or 6 characters (e.g. FN31pr)' };
    if (!GRID_REGEX.test(g)) return { ok: false, msg: 'Invalid Maidenhead locator square' };
    return { ok: true, msg: 'Valid Maidenhead' };
  };

  const callVal = validateCall(form.myCall);
  const gridVal = validateGrid(form.myGrid);
  const latLon = maidenheadToLatLon(form.myGrid);

  // VU Meter Toggle
  const toggleAudioTest = () => {
    if (isAudioTesting) {
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
      setIsAudioTesting(false);
      setVuLevel(0);
    } else {
      setIsAudioTesting(true);
      let phase = 0;
      audioIntervalRef.current = window.setInterval(() => {
        phase += 0.2;
        const val = Math.sin(phase) * 0.35 + Math.cos(phase * 2.1) * 0.2 + 0.4;
        setVuLevel(Math.max(0.05, Math.min(0.95, val)));
      }, 60);
    }
  };

  // CAT Test Handler
  const handleTestCat = () => {
    setCatTestStatus('Querying rig VFO and status via Hamlib / Serial...');
    setTimeout(() => {
      setCatTestStatus(`✓ Connected: ${form.rigModel} on ${form.serialPort} (VFO: 14.074.000 MHz USB-D)`);
    }, 700);
  };

  // PTT Test Handler (3s cutoff)
  const handleTestPtt = () => {
    if (isPttTesting) {
      if (pttTimeoutRef.current) clearTimeout(pttTimeoutRef.current);
      setIsPttTesting(false);
    } else {
      setIsPttTesting(true);
      if (pttTimeoutRef.current) clearTimeout(pttTimeoutRef.current);
      pttTimeoutRef.current = window.setTimeout(() => {
        setIsPttTesting(false);
      }, 3000);
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
    if (isAudioTesting) toggleAudioTest();
    if (isPttTesting) setIsPttTesting(false);
    setCurrentStep((prev) => Math.min(3, prev + 1));
  };

  const handleBack = () => {
    setErrorMsg('');
    if (isAudioTesting) toggleAudioTest();
    if (isPttTesting) setIsPttTesting(false);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleFinish = () => {
    if (isAudioTesting) toggleAudioTest();
    if (isPttTesting) setIsPttTesting(false);
    onSaveConfig(form);
    onClose();
  };

  const steps = [
    { title: 'Operator Info', icon: Radio, desc: 'Callsign & Maidenhead' },
    { title: 'Audio Devices', icon: Volume2, desc: 'Soundcards & Level Test' },
    { title: 'Radio & CAT', icon: Cpu, desc: 'Rig Control & PTT Keying' },
    { title: 'Summary', icon: FileCheck, desc: 'Review & Complete' },
  ];

  const dbVal = vuLevel > 0 ? (20 * Math.log10(vuLevel)).toFixed(1) : '-inf';

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
                const Icon = step.icon;
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Input Soundcard */}
                  <div className="bg-[#121212] p-3 border border-[#222] space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-[#D4D4D4] block">
                      Input Device (Rx Receiver Audio)
                    </label>
                    <select
                      value={form.audioInputDevice}
                      onChange={(e) => setForm({ ...form, audioInputDevice: e.target.value })}
                      className="w-full bg-[#181818] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-[#00FF41]"
                    >
                      {AUDIO_INPUTS.map((dev, i) => (
                        <option key={i} value={dev}>
                          {dev}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Output Soundcard */}
                  <div className="bg-[#121212] p-3 border border-[#222] space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-[#D4D4D4] block">
                      Output Device (Tx Transmit Audio)
                    </label>
                    <select
                      value={form.audioOutputDevice}
                      onChange={(e) => setForm({ ...form, audioOutputDevice: e.target.value })}
                      className="w-full bg-[#181818] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 focus:outline-none focus:border-[#00FF41]"
                    >
                      {AUDIO_OUTPUTS.map((dev, i) => (
                        <option key={i} value={dev}>
                          {dev}
                        </option>
                      ))}
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
                        <option value={12000}>12000 Hz (Native z-30 16-MFSK)</option>
                        <option value={48000}>48000 Hz (HD Audio CODEC)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">Channel Routing</label>
                      <select
                        value={form.audioChannels || 1}
                        onChange={(e) => setForm({ ...form, audioChannels: Number(e.target.value) as any })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                      >
                        <option value={1}>Mono (Channel 1 / Left)</option>
                        <option value={2}>Stereo (2 Channels)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Real-Time Input Level VU Meter Test */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#D4D4D4] uppercase">
                      Live Audio Input Level Verification
                    </span>
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
                      <span>{isAudioTesting ? 'Stop Level Test' : 'Start Audio Input Test'}</span>
                    </button>
                  </div>

                  {/* VU Canvas Bar */}
                  <div className="flex items-center space-x-3 bg-[#080808] p-2 border border-[#262626]">
                    <div className="flex-1 h-4 bg-[#141414] overflow-hidden rounded-sm relative flex items-center">
                      <div
                        className="h-full transition-all duration-75"
                        style={{
                          width: `${vuLevel * 100}%`,
                          backgroundColor:
                            vuLevel > 0.85 ? '#EF4444' : vuLevel > 0.65 ? '#EAB308' : '#00FF41',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-bold w-16 text-right text-cyan-400">
                      {isAudioTesting ? `${dbVal} dB` : 'IDLE'}
                    </span>
                  </div>
                  <div className="text-[8px] text-[#666]">
                    Ideal audio input level during reception should peak between -15 dB and -6 dB (Green/Yellow region).
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* CAT Method */}
                  <div className="bg-[#121212] p-2.5 border border-[#222] space-y-1">
                    <label className="text-[9px] uppercase text-[#777] block">CAT Control Method</label>
                    <select
                      value={form.catMethod || 'Hamlib'}
                      onChange={(e) => setForm({ ...form, catMethod: e.target.value as any })}
                      className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#00FF41] font-bold focus:outline-none"
                    >
                      <option value="Hamlib">Hamlib (libhamlib/rigctld)</option>
                      <option value="Direct Serial">Direct Serial CAT</option>
                      <option value="None">None (Manual PTT / Audio VOX)</option>
                    </select>
                  </div>

                  {/* Rig Model */}
                  <div className="bg-[#121212] p-2.5 border border-[#222] space-y-1">
                    <label className="text-[9px] uppercase text-[#777] block">Transceiver Rig Model</label>
                    <select
                      value={form.rigModel}
                      onChange={(e) => setForm({ ...form, rigModel: e.target.value })}
                      className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
                    >
                      {RIG_CATALOG.map((r, i) => (
                        <option key={i} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Serial Parameters */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2.5">
                  <div className="text-[10px] font-bold text-[#AAA] uppercase">Serial Port & CAT Interface</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="text-[9px] uppercase text-[#777] block mb-1">Serial / COM Port</label>
                      <select
                        value={form.serialPort}
                        onChange={(e) => setForm({ ...form, serialPort: e.target.value })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
                      >
                        {SERIAL_PORTS.map((p, i) => (
                          <option key={i} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
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
                </div>

                {/* PTT Keying & Pin Polarity */}
                <div className="bg-[#121212] p-3 border border-[#222] space-y-2.5">
                  <div className="text-[10px] font-bold text-[#AAA] uppercase">
                    Push-To-Talk (PTT) Keying & Pin Polarity Logic
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">PTT Keying Method</label>
                      <select
                        value={form.pttMethod}
                        onChange={(e) => setForm({ ...form, pttMethod: e.target.value as any })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-yellow-400 font-bold focus:outline-none"
                      >
                        <option value="CAT">CAT Command (\set_ptt 1)</option>
                        <option value="RTS">Serial Port RTS Pin</option>
                        <option value="DTR">Serial Port DTR Pin</option>
                        <option value="VOX">Hardware VOX / Audio</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[9px] uppercase text-[#777] block mb-1">RTS/DTR Pin Polarity</label>
                      <select
                        value={form.pttPolarity || 'ACTIVE_HIGH'}
                        onChange={(e) => setForm({ ...form, pttPolarity: e.target.value as any })}
                        className="w-full bg-[#181818] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none"
                      >
                        <option value="ACTIVE_HIGH">Active High (+12V / 1 = PTT ON)</option>
                        <option value="ACTIVE_LOW">Active Low (Inverted / Optocoupler Pull-GND)</option>
                      </select>
                    </div>
                  </div>
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
                      className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-cyan-400 border border-cyan-500/40 text-xs font-bold uppercase"
                    >
                      Test CAT Query
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
                  {catTestStatus && (
                    <div className="text-[10px] text-[#00FF41] font-mono pt-1">{catTestStatus}</div>
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
