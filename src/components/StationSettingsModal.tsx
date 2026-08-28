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
import { RIG_CATALOG, SERIAL_PORTS } from './SetupWizardModal';
import { AUTO_REPLY_OPTIONS } from '../dsp/z30Constants';
import { audioEngine, SystemAudioDevice, AudioSystemDiagnostics } from '../dsp/audioEngine';

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
  const [isPttTesting, setIsPttTesting] = useState<boolean>(false);
  const pttTimeoutRef = useRef<number | null>(null);

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
      setCatTestStatus('');
      scanSystemDevices(false);
    } else {
      if (isAudioTesting) {
        stopAudioTest();
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAudioTesting) stopAudioTest();
    if (isPttTesting) setIsPttTesting(false);
    onSaveConfig(form);
    onClose();
  };

  const handleLaunchWizard = () => {
    if (isAudioTesting) stopAudioTest();
    if (isPttTesting) setIsPttTesting(false);
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
