/**
 * Hamlib / rigctl CAT Transceiver Controller Panel
 *
 * The CAT control surface described in wiki/14: band selection, VFO tuning, the tune carrier,
 * the band manager, and the raw rigctl console. Every one of those controls was previously
 * declared as a prop, wired up in App.tsx, and then never referenced - the panel rendered a
 * read-only faceplate while the handlers behind it sat unreachable. tsc does not flag unused
 * destructured props, which is why it survived; tsconfig now sets noUnusedParameters, and the
 * controls below are real.
 */

import React, { useState } from 'react';
import { HAM_BANDS } from '../dsp/z30Constants';
import { rigctl } from '../dsp/catController';
import { StationConfig } from '../types/z30';
import { Terminal, Cpu, Radio, Sliders } from 'lucide-react';

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
  /**
   * The station's transmit gate. The raw console's `T 1` is a transmit path like any other and
   * must run canTransmit() first; without this the console refuses to key at all.
   */
  onAssertCanTransmit?: (audioOffsetHz: number) => boolean;
  /** Audio offset the station would transmit on, so the gate sees the real radiated frequency. */
  txAudioOffsetHz: number;
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
  onAssertCanTransmit,
  txAudioOffsetHz,
}) => {
  const [terminalInput, setTerminalInput] = useState<string>('');
  const [showTerminal, setShowTerminal] = useState<boolean>(false);
  const [terminalLogs, setTerminalLogs] = useState(rigctl.getCommandLogs());
  const [isConnected, setIsConnected] = useState<boolean>(rigctl.getIsConnected());
  const [freqInput, setFreqInput] = useState<string>('');
  const [rigMode, setRigMode] = useState<string>(rigctl.getMode());

  const rigctldEndpoint = `${config.hamlibHost || '127.0.0.1'}:${config.hamlibPort || 4532}`;

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (terminalInput.trim()) {
      // Awaited: the console's RPRT reply is now the radio's answer, not an acknowledgement
      // that a function was called, so it can only be produced once the hardware has answered.
      await rigctl.executeRawCommand(
        terminalInput,
        onAssertCanTransmit
          ? {
              assertCanTransmit: onAssertCanTransmit,
              txAudioOffsetHz,
              pttMethod: config.pttMethod,
              pttPolarity: config.pttPolarity || 'ACTIVE_HIGH',
              pttOptions: {
                pttPort: config.pttPort,
                pttToneFreqHz: config.pttToneFreqHz,
                cm108GpioPin: config.cm108GpioPin,
                rpiGpioPin: config.rpiGpioPin,
                tciHost: config.tciHost,
                tciPort: config.tciPort,
                winkeyerPort: config.winkeyerPort,
              },
            }
          : undefined
      );
      setTerminalLogs([...rigctl.getCommandLogs()]);
      // A console command can change the mode or the dial; re-read rather than assume.
      setRigMode(rigctl.getMode());
      const consoleFreq = rigctl.getFreqHz();
      if (typeof consoleFreq === 'number' && consoleFreq !== dialFreqHz) onFreqChange(consoleFreq);
      setTerminalInput('');
    }
  };

  const handleToggleConnect = () => {
    const newState = rigctl.toggleConnection();
    setIsConnected(newState);
    setTerminalLogs([...rigctl.getCommandLogs()]);
  };

  const handleFreqSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mhz = parseFloat(freqInput);
    if (!Number.isFinite(mhz)) return;
    const hz = Math.round(mhz * 1e6);
    // Refuse obvious typos here rather than sending a nonsense dial to the radio. The transmit
    // gate is what decides whether the resulting frequency may be TRANSMITTED on; this only
    // stops a slipped decimal point from retuning the VFO to 1.4 MHz.
    if (hz < 100000 || hz > 500000000) return;
    onFreqChange(hz);
    setFreqInput('');
  };

  const nudgeFreq = (deltaHz: number) => onFreqChange(dialFreqHz + deltaHz);

  // Format frequency to 14.076000 MHz
  const formatMhz = (hz: number) => (hz / 1e6).toFixed(6);

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

        {/* Manual rigctld link marker - browsers cannot open a raw TCP socket to verify this
            daemon directly, so this is a user assertion, not a live probe result. Use "Test
            CAT Connection" in Station Settings for a real hardware handshake.
            The endpoint shown is the CONFIGURED one: this badge used to hardcode 4532 while
            the telemetry card below it showed the real port, so an operator on 4533 saw two
            different ports in one panel. */}
        <button
          onClick={handleToggleConnect}
          title='Manual marker only - browsers cannot verify a raw TCP rigctld socket. Use "Test CAT Connection" for a real hardware handshake.'
          className={`flex items-center space-x-1.5 px-2 py-0.5 text-[10px] font-mono border transition-colors ${
            isConnected
              ? 'bg-[#00FF41]/10 border-[#00FF41]/40 text-[#00FF41]'
              : 'bg-red-950/80 border-red-700 text-red-300'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#00FF41] animate-pulse' : 'bg-red-400'}`} />
          <span>{isConnected ? `rigctld ${rigctldEndpoint} (manual)` : 'OFFLINE'}</span>
        </button>
      </div>

      {/* Main Rig Faceplate */}
      <div className="p-2 space-y-1.5 flex-1 flex flex-col justify-between text-xs bg-[#0F0F0F]">
        {/* Big Amber VFO Digital Readout */}
        <div className="bg-[#050505] border border-[#333] p-2 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Read from the controller rather than hardcoded: a console \set_mode or a rig
              readback changes this, and a faceplate that always says PKT-USB is decoration. */}
          <div className="text-[9px] text-[#888] tracking-widest uppercase mb-0.5">
            VFO A • {rigMode} • {(rigctl.getPassbandHz() / 1000).toFixed(1)} kHz PASSBAND
          </div>

          <div className="text-2xl sm:text-3xl font-bold tracking-widest text-[#FACC15] drop-shadow-[0_0_8px_rgba(250,204,21,0.3)]">
            {formatMhz(dialFreqHz)} <span className="text-xs text-[#FACC15]/70 font-normal">MHz</span>
          </div>

          <div className="flex items-center justify-between w-full mt-1 pt-1 border-t border-[#222] text-[9px] text-[#888] uppercase select-none">
            <span>Rig: <strong className="text-[#D4D4D4]">{config.rigModel.split('(')[0]}</strong></span>
            <span>Band: <strong className="text-cyan-400">{currentBand.name}</strong></span>
            <div className="flex items-center space-x-1.5">
              <span>PTT: <strong className={isTransmitting ? 'text-red-400 font-bold' : isTuning ? 'text-yellow-400 font-bold' : 'text-[#00FF41]'}>{isTransmitting ? 'TX' : isTuning ? 'CW' : 'RX'}</strong></span>
            </div>
          </div>
        </div>

        {/* Band select + VFO tuning. Disabled while keyed: retuning a transmitting radio is
            how an out-of-band emission happens between two gate checks. */}
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex flex-col space-y-0.5">
            <span className="text-[9px] text-[#888] uppercase tracking-wider">Band</span>
            <select
              value={currentBand.name}
              disabled={isTransmitting || isTuning}
              onChange={(e) => onBandChange(e.target.value)}
              className="bg-[#050505] border border-[#333] px-1.5 py-0.5 text-[11px] text-[#D4D4D4] font-mono focus:outline-none focus:border-[#00FF41] disabled:opacity-40"
            >
              {HAM_BANDS.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} — {(b.dialFreqHz / 1e6).toFixed(3)} MHz
                </option>
              ))}
            </select>
          </label>

          <form onSubmit={handleFreqSubmit} className="flex flex-col space-y-0.5">
            <span className="text-[9px] text-[#888] uppercase tracking-wider">Set VFO (MHz)</span>
            <div className="flex items-center space-x-1">
              <input
                type="text"
                inputMode="decimal"
                placeholder={formatMhz(dialFreqHz)}
                value={freqInput}
                disabled={isTransmitting || isTuning}
                onChange={(e) => setFreqInput(e.target.value)}
                className="flex-1 min-w-0 bg-[#050505] border border-[#333] px-1.5 py-0.5 text-[11px] text-[#D4D4D4] placeholder-[#555] font-mono focus:outline-none focus:border-[#00FF41] disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={isTransmitting || isTuning}
                className="px-1.5 py-0.5 bg-[#1A1A1A] border border-[#333] text-[10px] text-[#D4D4D4] hover:border-[#00FF41] disabled:opacity-40"
              >
                SET
              </button>
            </div>
          </form>
        </div>

        <div className="flex items-center space-x-1">
          {[-1000, -100, 100, 1000].map((delta) => (
            <button
              key={delta}
              onClick={() => nudgeFreq(delta)}
              disabled={isTransmitting || isTuning}
              className="flex-1 py-0.5 bg-[#050505] border border-[#333] text-[10px] text-[#888] hover:text-[#D4D4D4] hover:border-[#00FF41] font-mono disabled:opacity-40"
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>

        {/* Tune carrier and band manager */}
        <div className="flex items-center space-x-1">
          {isTuning ? (
            <button
              onClick={onStopTune}
              className="flex-1 flex items-center justify-center space-x-1 py-1 bg-yellow-500 text-black text-[10px] font-bold uppercase font-mono"
            >
              <Radio className="w-3 h-3" />
              <span>Stop Tune</span>
            </button>
          ) : (
            <button
              onClick={onStartTune}
              disabled={isTransmitting || !onStartTune}
              className="flex-1 flex items-center justify-center space-x-1 py-1 bg-[#050505] border border-[#333] text-[10px] text-[#D4D4D4] uppercase font-mono hover:border-yellow-500 hover:text-yellow-400 disabled:opacity-40"
              title="Keys a steady carrier for antenna matching. Runs the transmit gate first and cuts out after 15 s."
            >
              <Radio className="w-3 h-3" />
              <span>Tune</span>
            </button>
          )}
          <button
            onClick={onOpenBandManager}
            disabled={!onOpenBandManager}
            className="flex-1 flex items-center justify-center space-x-1 py-1 bg-[#050505] border border-[#333] text-[10px] text-[#D4D4D4] uppercase font-mono hover:border-cyan-500 hover:text-cyan-400 disabled:opacity-40"
          >
            <Sliders className="w-3 h-3" />
            <span>Bands</span>
          </button>
        </div>

        {/* Quick Rig Telemetry Card */}
        <div className="bg-[#050505] p-1.5 border border-[#222] flex items-center justify-between text-[9px] text-[#888] select-none">
          <div>
            <span>Port: </span>
            <strong className="text-[#D4D4D4]">
              {config.catMethod === 'Direct Serial'
                ? config.serialPort || '(no serial port selected)'
                : rigctldEndpoint}
            </strong>
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
                    <span className={log.status === 'OK' ? 'text-[#888]' : 'text-red-400'}>=&gt; {log.response}</span>
                  </div>
                ))}
              </div>

              <form onSubmit={handleCommandSubmit} className="flex items-center space-x-1">
                <input
                  type="text"
                  placeholder="e.g. f, F 14076000, \get_mode, M PKTUSB, T 1, help"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  className="flex-1 min-w-0 bg-[#141414] border border-[#333] px-2 py-0.5 text-xs text-[#D4D4D4] placeholder-[#666] font-mono focus:outline-none focus:border-[#00FF41]"
                />
                <button
                  type="submit"
                  className="px-2.5 py-0.5 bg-[#00FF41] text-black font-bold uppercase text-xs font-mono"
                >
                  Send
                </button>
              </form>
              <p className="text-[9px] text-[#666] leading-tight">
                Case matters: lower-case verbs read, upper-case verbs set. <code>T 1</code> runs the
                same transmit gate as the Start TX button and is refused if the station is not
                clear to transmit.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
