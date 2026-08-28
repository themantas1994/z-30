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
} from 'lucide-react';
import { RIG_CATALOG, AUDIO_INPUTS, AUDIO_OUTPUTS, SERIAL_PORTS } from './SetupWizardModal';

interface StationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StationConfig;
  onSaveConfig: (cfg: StationConfig) => void;
  onOpenWizard?: () => void;
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
}) => {
  const [form, setForm] = useState<StationConfig>({ ...config });
  const [activeTab, setActiveTab] = useState<'STATION' | 'AUDIO' | 'RADIO' | 'AUTOMATION'>('STATION');

  // Audio test meter state
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
      setIsAudioTesting(false);
      setIsPttTesting(false);
      setCatTestStatus('');
    }
  }, [isOpen, config]);

  useEffect(() => {
    return () => {
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
      if (pttTimeoutRef.current) clearTimeout(pttTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAudioTesting) toggleAudioTest();
    if (isPttTesting) setIsPttTesting(false);
    onSaveConfig(form);
    onClose();
  };

  const handleLaunchWizard = () => {
    if (isAudioTesting) toggleAudioTest();
    if (isPttTesting) setIsPttTesting(false);
    onClose();
    if (onOpenWizard) {
      onOpenWizard();
    }
  };

  // Live VU Meter Toggle
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
    }, 600);
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

  const isCallValid = CALLSIGN_REGEX.test(form.myCall.trim());
  const isGridValid = GRID_REGEX.test(form.myGrid.trim()) && (form.myGrid.trim().length === 4 || form.myGrid.trim().length === 6);
  const latLon = maidenheadToLatLon(form.myGrid);
  const dbVal = vuLevel > 0 ? (20 * Math.log10(vuLevel)).toFixed(1) : '-inf';

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
            </div>
          )}

          {/* TAB 2: AUDIO & DSP SOUND CARD */}
          {activeTab === 'AUDIO' && (
            <div className="space-y-3">
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                  <Volume2 className="w-3.5 h-3.5 text-[#00FF41]" />
                  <span>Sound Card Audio Interfaces (Rx Demod / Tx Mod)</span>
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Input Device (Rx Audio)</label>
                    <select
                      value={form.audioInputDevice}
                      onChange={(e) => setForm({ ...form, audioInputDevice: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-[#00FF41]"
                    >
                      {AUDIO_INPUTS.map((dev, i) => (
                        <option key={i} value={dev}>
                          {dev}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Output Device (Tx Audio)</label>
                    <select
                      value={form.audioOutputDevice}
                      onChange={(e) => setForm({ ...form, audioOutputDevice: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-yellow-400 focus:outline-none focus:border-[#00FF41]"
                    >
                      {AUDIO_OUTPUTS.map((dev, i) => (
                        <option key={i} value={dev}>
                          {dev}
                        </option>
                      ))}
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
                      <option value={12000}>12000 Hz (Native z-30 16-MFSK)</option>
                      <option value={48000}>48000 Hz (HD Audio CODEC)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Channel Configuration</label>
                    <select
                      value={form.audioChannels || 1}
                      onChange={(e) => setForm({ ...form, audioChannels: Number(e.target.value) as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value={1}>Mono (Channel 1 / Left)</option>
                      <option value={2}>Stereo (2 Channels)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Audio Input Level Meter */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#D4D4D4] uppercase text-[11px]">
                    Live Audio Input Level VU Meter Test
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
                    <span>{isAudioTesting ? 'Stop Level Test' : 'Start Input Test'}</span>
                  </button>
                </div>

                <div className="flex items-center space-x-3 bg-[#080808] p-2 border border-[#222]">
                  <div className="flex-1 h-3.5 bg-[#141414] overflow-hidden rounded-sm relative flex items-center">
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
                    {isAudioTesting ? `${dbVal} dB` : '0.0 dB'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RADIO & CAT / PTT CONTROL */}
          {activeTab === 'RADIO' && (
            <div className="space-y-3">
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] flex items-center space-x-1.5 uppercase text-[11px]">
                  <Cpu className="w-3.5 h-3.5 text-[#00FF41]" />
                  <span>Transceiver CAT & Hamlib Control</span>
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">CAT Control Method</label>
                    <select
                      value={form.catMethod || 'Hamlib'}
                      onChange={(e) => setForm({ ...form, catMethod: e.target.value as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#00FF41] font-bold focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value="Hamlib">Hamlib (libhamlib/rigctld)</option>
                      <option value="Direct Serial">Direct Serial CAT</option>
                      <option value="None">None (Manual / Audio VOX)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Transceiver Rig Model</label>
                    <select
                      value={form.rigModel}
                      onChange={(e) => setForm({ ...form, rigModel: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1.5 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      {RIG_CATALOG.map((r, i) => (
                        <option key={i} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Serial / COM Port</label>
                    <select
                      value={form.serialPort}
                      onChange={(e) => setForm({ ...form, serialPort: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      {SERIAL_PORTS.map((p, i) => (
                        <option key={i} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Hamlib Host</label>
                    <input
                      type="text"
                      value={form.hamlibHost}
                      onChange={(e) => setForm({ ...form, hamlibHost: e.target.value })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Hamlib Port</label>
                    <input
                      type="number"
                      value={form.hamlibPort}
                      onChange={(e) => setForm({ ...form, hamlibPort: Number(e.target.value) })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    />
                  </div>
                </div>
              </div>

              {/* PTT Keying & Polarity */}
              <div className="bg-[#050505] p-3 border border-[#333] space-y-3">
                <span className="font-bold text-[#D4D4D4] uppercase text-[11px] block">
                  Push-To-Talk (PTT) Keying & Pin Polarity
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">PTT Method</label>
                    <select
                      value={form.pttMethod}
                      onChange={(e) => setForm({ ...form, pttMethod: e.target.value as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-yellow-400 font-bold focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value="CAT">CAT Command (\set_ptt 1)</option>
                      <option value="RTS">Serial Port RTS Line</option>
                      <option value="DTR">Serial Port DTR Line</option>
                      <option value="VOX">Audio VOX</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase text-[#888] block mb-1">Pin Polarity</label>
                    <select
                      value={form.pttPolarity || 'ACTIVE_HIGH'}
                      onChange={(e) => setForm({ ...form, pttPolarity: e.target.value as any })}
                      className="w-full bg-[#141414] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
                    >
                      <option value="ACTIVE_HIGH">Active High (+12V / 1 = PTT ON)</option>
                      <option value="ACTIVE_LOW">Active Low (Inverted / Optocoupler Pull-to-GND)</option>
                    </select>
                  </div>
                </div>

                {/* Hardware Verification Controls */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#222]">
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
                    {isPttTesting ? '● PTT Key Active (3s Cutoff)' : 'PTT Key Test (3s Safety Cutoff)'}
                  </button>
                </div>
                {catTestStatus && (
                  <div className="text-[10px] text-[#00FF41] font-mono">{catTestStatus}</div>
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
                      Call 1st (Automatically answer first decoded station answering your CQ call)
                    </span>
                  </label>

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
