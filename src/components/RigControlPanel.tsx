/**
 * Hamlib / rigctl CAT Transceiver Controller & S-Meter Panel
 */

import React, { useState } from 'react';
import { HAM_BANDS } from '../dsp/z30Constants';
import { rigctl } from '../dsp/catController';
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
  onOpenBandManager?: () => void;
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
  onOpenBandManager,
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

  // Format frequency to 14.076.000 MHz
  const formatMhz = (hz: number) => {
    const mhz = hz / 1e6;
    return mhz.toFixed(6);
  };

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
      <div className="p-2 space-y-1.5 flex-1 flex flex-col justify-between text-xs bg-[#0F0F0F] select-none">
        {/* Big Amber VFO Digital Readout */}
        <div className="bg-[#050505] border border-[#333] p-2 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="text-[9px] text-[#888] tracking-widest uppercase mb-0.5">
            VFO A • PKT-USB • 3.0 kHz PASSBAND
          </div>
          
          <div className="text-2xl sm:text-3xl font-bold tracking-widest text-[#FACC15] drop-shadow-[0_0_8px_rgba(250,204,21,0.3)]">
            {formatMhz(dialFreqHz)} <span className="text-xs text-[#FACC15]/70 font-normal">MHz</span>
          </div>

          <div className="flex items-center justify-between w-full mt-1 pt-1 border-t border-[#222] text-[9px] text-[#888] uppercase">
            <span>Rig: <strong className="text-[#D4D4D4]">{config.rigModel.split('(')[0]}</strong></span>
            <span>Band: <strong className="text-cyan-400">{currentBand.name}</strong></span>
            <div className="flex items-center space-x-1.5">
              <span>PTT: <strong className={isTransmitting ? 'text-red-400 font-bold' : isTuning ? 'text-yellow-400 font-bold' : 'text-[#00FF41]'}>{isTransmitting ? 'TX' : isTuning ? 'CW' : 'RX'}</strong></span>
            </div>
          </div>
        </div>

        {/* Quick Rig Telemetry Card */}
        <div className="bg-[#050505] p-1.5 border border-[#222] flex items-center justify-between text-[9px] text-[#888]">
          <div>
            <span>Port: </span>
            <strong className="text-[#D4D4D4]">{config.catPort || '127.0.0.1:4532'}</strong>
          </div>
          <div>
            <span>Baud: </span>
            <strong className="text-[#D4D4D4]">{config.baudRate}</strong>
          </div>
          <div>
            <span>PTT: </span>
            <strong className="text-cyan-400">{config.pttMethod}</strong>
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
                  placeholder="e.g. f, F 14076000, m, t, T 1, help"
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
