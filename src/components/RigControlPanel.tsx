/**
 * Hamlib / rigctl CAT Transceiver Controller & S-Meter Panel
 */

import React, { useState } from 'react';
import { HAM_BANDS } from '../dsp/z30Constants';
import { rigctl } from '../dsp/rigctlSimulator';
import { StationConfig } from '../types/z30';
import { Radio, Terminal, Cpu, Activity, Zap, Check, AlertCircle } from 'lucide-react';

interface RigControlPanelProps {
  currentBand: typeof HAM_BANDS[0];
  dialFreqHz: number;
  config: StationConfig;
  onBandChange: (bandName: string) => void;
  onFreqChange: (freqHz: number) => void;
  isTransmitting: boolean;
  isTuning?: boolean;
  onStartTune?: () => void;
  onStopTune?: () => void;
}

export const RigControlPanel: React.FC<RigControlPanelProps> = ({
  currentBand,
  dialFreqHz,
  config,
  onBandChange,
  onFreqChange,
  isTransmitting,
  isTuning = false,
  onStartTune,
  onStopTune,
}) => {
  const [terminalInput, setTerminalInput] = useState<string>('');
  const [showTerminal, setShowTerminal] = useState<boolean>(false);
  const [terminalLogs, setTerminalLogs] = useState(rigctl.getCommandLogs());
  const [isConnected, setIsConnected] = useState<boolean>(rigctl.getIsConnected());

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (terminalInput.trim()) {
      rigctl.executeRawCommand(terminalInput);
      setTerminalLogs([...rigctl.getCommandLogs()]);
      setTerminalInput('');
    }
  };

  const handleToggleConnect = () => {
    const newState = rigctl.toggleConnection();
    setIsConnected(newState);
    setTerminalLogs([...rigctl.getCommandLogs()]);
  };

  // Format frequency to 14.074.000 MHz
  const formatMhz = (hz: number) => {
    const mhz = hz / 1e6;
    return mhz.toFixed(6);
  };

  // S-Meter calculation
  const sMeterDb = rigctl.getSmeterDb();
  // Map -120dB to 0%, -73dB (S9) to 60%, -33dB (S9+40) to 100%
  const sMeterPercent = Math.max(5, Math.min(100, ((sMeterDb + 130) / 100) * 100));

  return (
    <div className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono" id="rig-control-card">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333]">
        <div className="flex items-center space-x-2">
          <Cpu className="w-3.5 h-3.5 text-[#00FF41]" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            CAT Rig Control (Hamlib rigctl)
          </span>
        </div>

        {/* Connection status badge */}
        <button
          onClick={handleToggleConnect}
          className={`flex items-center space-x-1.5 px-2 py-0.5 text-[10px] font-mono border transition-colors ${
            isConnected
              ? 'bg-[#00FF41]/10 border-[#00FF41]/40 text-[#00FF41]'
              : 'bg-red-950/80 border-red-700 text-red-300'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#00FF41] animate-pulse' : 'bg-red-400'}`} />
          <span>{isConnected ? 'rigctld:4532 OK' : 'OFFLINE'}</span>
        </button>
      </div>

      {/* Main Rig Faceplate */}
      <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto text-xs bg-[#0F0F0F]">
        {/* Big Amber VFO Digital Readout */}
        <div className="bg-[#050505] border border-[#333] p-2.5 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="text-[9px] text-[#888] tracking-widest uppercase mb-0.5">
            VFO A • PKT-USB • 3.0 kHz IF PASSBAND
          </div>
          
          <div className="text-2xl sm:text-3xl font-bold tracking-widest text-[#FACC15] drop-shadow-[0_0_8px_rgba(250,204,21,0.3)]">
            {formatMhz(dialFreqHz)} <span className="text-xs text-[#FACC15]/70 font-normal">MHz</span>
          </div>

          <div className="flex items-center justify-between w-full mt-1.5 pt-1.5 border-t border-[#222] text-[9px] text-[#888] uppercase">
            <span>Rig: <strong className="text-[#D4D4D4]">{config.rigModel.split('(')[0]}</strong></span>
            <span>Band: <strong className="text-cyan-400">{currentBand.name}</strong></span>
            <div className="flex items-center space-x-1.5">
              <span>PTT: <strong className={isTransmitting ? 'text-red-400 font-bold' : isTuning ? 'text-yellow-400 font-bold' : 'text-[#00FF41]'}>{isTransmitting ? 'ACTIVE (TX)' : isTuning ? 'TUNE (CW)' : 'STANDBY (RX)'}</strong></span>
              {onStartTune && (
                <button
                  id="rig-tune-btn"
                  onClick={isTuning ? onStopTune : onStartTune}
                  title="Key CAT Transmitter with continuous CW carrier tone"
                  className={`px-1.5 py-0.2 text-[8px] font-bold uppercase rounded-none border transition-colors ${
                    isTuning
                      ? 'bg-yellow-500 text-black border-yellow-400 animate-pulse'
                      : 'bg-[#181818] hover:bg-[#252525] text-cyan-400 border-cyan-800'
                  }`}
                >
                  {isTuning ? 'TUNING' : 'TUNE'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Band Selector Grid */}
        <div>
          <label className="text-[9px] uppercase tracking-wider text-[#888] block mb-1">Amateur Band Selector:</label>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
            {HAM_BANDS.slice(0, 12).map((b) => {
              const isCurrent = b.name === currentBand.name;
              return (
                <button
                  key={b.name}
                  onClick={() => onBandChange(b.name)}
                  className={`py-0.5 px-1 text-center text-[11px] font-bold transition-colors border ${
                    isCurrent
                      ? 'bg-[#00FF41] text-black border-[#00FF41]'
                      : 'bg-[#050505] border-[#222] text-[#888] hover:text-[#D4D4D4] hover:bg-[#1A1A1A]'
                  }`}
                >
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* S-Meter Bar */}
        <div className="bg-[#050505] p-1.5 border border-[#333] space-y-1">
          <div className="flex items-center justify-between text-[9px] text-[#888] uppercase">
            <span>SIGNAL STRENGTH (S-METER)</span>
            <span className="text-cyan-400 font-bold">
              {isTransmitting ? 'TX POWER 100%' : `S${Math.min(9, Math.max(1, Math.round(sMeterPercent / 10)))} (${sMeterDb.toFixed(0)} dBm)`}
            </span>
          </div>

          <div className="relative w-full h-2.5 bg-[#141414] overflow-hidden border border-[#222]">
            <div
              className={`h-full transition-all duration-150 ${
                isTransmitting
                  ? 'bg-red-500'
                  : sMeterPercent > 60
                  ? 'bg-gradient-to-r from-[#00FF41] via-yellow-500 to-red-500'
                  : 'bg-[#00FF41]'
              }`}
              style={{ width: `${sMeterPercent}%` }}
            />
          </div>

          {/* S-Meter graduations */}
          <div className="flex justify-between text-[8px] text-[#666] px-0.5">
            <span>S1</span>
            <span>S3</span>
            <span>S5</span>
            <span>S7</span>
            <span>S9</span>
            <span className="text-yellow-500">+20</span>
            <span className="text-red-500">+40</span>
          </div>
        </div>

        {/* Hamlib Terminal Toggle */}
        <div>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className="w-full flex items-center justify-between py-1 px-2 bg-[#050505] hover:bg-[#1A1A1A] border border-[#333] text-[#888] hover:text-[#D4D4D4] text-xs font-mono"
          >
            <div className="flex items-center space-x-1.5">
              <Terminal className="w-3 h-3 text-[#00FF41]" />
              <span>Hamlib rigctl Raw Console</span>
            </div>
            <span className="text-[9px] text-[#666]">{showTerminal ? '▲ Hide' : '▼ Open'}</span>
          </button>

          {showTerminal && (
            <div className="mt-1.5 bg-[#050505] border border-[#333] p-1.5 space-y-1.5">
              <div className="h-24 overflow-y-auto font-mono text-[9px] text-[#D4D4D4] space-y-0.5 bg-[#0A0A0A] p-1.5 border border-[#222]">
                {terminalLogs.slice(0, 15).map((log) => (
                  <div key={log.id} className="leading-tight">
                    <span className="text-[#666]">[{log.timestamp}]</span>{' '}
                    <span className="text-[#00FF41]">&gt; {log.command}</span>{' '}
                    <span className="text-[#888]">=&gt; {log.response}</span>
                  </div>
                ))}
              </div>

              <form onSubmit={handleCommandSubmit} className="flex items-center space-x-1">
                <input
                  type="text"
                  placeholder="e.g. f, F 14074000, m, t, T 1, help"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  className="flex-1 bg-[#141414] border border-[#333] px-2 py-0.5 text-xs text-[#D4D4D4] placeholder-[#666] font-mono focus:outline-none focus:border-[#00FF41]"
                />
                <button
                  type="submit"
                  className="px-2.5 py-0.5 bg-[#00FF41] text-black font-bold uppercase text-xs font-mono"
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
