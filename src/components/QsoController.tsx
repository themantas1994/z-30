/**
 * Automated QSO State Machine Controller & Transmitter Interface
 */

import React, { useState } from 'react';
import { AutoReplyPriority, StationConfig, TxSlot } from '../types/z30';
import { QsoState } from '../dsp/qsoEngine';
import { buildQsoMacros } from '../dsp/z30Codec';
import { AUTO_REPLY_OPTIONS, evaluateSlotTiming } from '../dsp/z30Constants';
import { Radio, Power, Flame, Zap, CheckCircle2, RotateCcw, Send, Settings2, Sliders, Square, Clock, AlertTriangle, Sparkles } from 'lucide-react';

interface QsoControllerProps {
  qsoState: QsoState;
  config: StationConfig;
  currentBand: string;
  isTransmitting: boolean;
  onUpdateState: (partial: Partial<QsoState>) => void;
  onUpdateConfig?: (partial: Partial<StationConfig>) => void;
  onCallingCq?: () => void;
  onToggleTx: () => void;
  onStartTx?: () => void;
  onStopTx?: () => void;
  onStartTune: () => void;
  onStopTune: () => void;
  isTuning: boolean;
  fwdWatts: number;
  swr: number;
}

export const QsoController: React.FC<QsoControllerProps> = ({
  qsoState,
  config,
  currentBand,
  isTransmitting,
  onUpdateState,
  onUpdateConfig,
  onCallingCq,
  onToggleTx,
  onStartTx,
  onStopTx,
  onStartTune,
  onStopTune,
  isTuning,
  fwdWatts,
  swr,
}) => {
  const [customMsgInput, setCustomMsgInput] = useState<string>('');

  const macros = buildQsoMacros(
    config.myCall,
    config.myGrid,
    qsoState.targetDxCall || 'DX',
    qsoState.targetDxGrid || 'FN31',
    qsoState.mySentReport,
    qsoState.myRcvdReport
  );

  const handleMacroSelect = (macroKey: QsoState['currentTxMacro']) => {
    onUpdateState({ currentTxMacro: macroKey });
    if (macroKey === 'tx1' || macroKey === 'tx6') {
      onCallingCq?.();
    }
  };

  const handleCustomMsgSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMsgInput.trim()) {
      onUpdateState({
        customTxMessage: customMsgInput.trim().toUpperCase(),
        currentTxMacro: 'free',
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono" id="qso-controller-card">
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333]">
        <div className="flex items-center space-x-2">
          <Send className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            QSO Automation & State Machine
          </span>
        </div>

        {/* Tx Slot Selector */}
        <div className="flex items-center space-x-1.5 bg-[#050505] px-2 py-0.5 border border-[#333] text-xs">
          <span className="text-[#888] text-[10px]">SLOT:</span>
          <button
            id="slot-even-btn"
            onClick={() => onUpdateState({ txSlot: 'EVEN' })}
            className={`px-1.5 py-0.2 text-[10px] font-bold uppercase ${
              qsoState.txSlot === 'EVEN' ? 'bg-[#00FF41] text-black' : 'text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            Even (00s)
          </button>
          <button
            id="slot-odd-btn"
            onClick={() => onUpdateState({ txSlot: 'ODD' })}
            className={`px-1.5 py-0.2 text-[10px] font-bold uppercase ${
              qsoState.txSlot === 'ODD' ? 'bg-[#00FF41] text-black' : 'text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            Odd (30s)
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto text-xs bg-[#0F0F0F]">
        {/* DX Station Info Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#050505] p-2 border border-[#333]">
          <div>
            <label className="text-[9px] uppercase text-[#888] block mb-0.5">DX Call</label>
            <input
              id="dx-call-input"
              type="text"
              value={qsoState.targetDxCall}
              onChange={(e) => onUpdateState({ targetDxCall: e.target.value.toUpperCase() })}
              placeholder="e.g. VK3XYZ"
              className="w-full bg-[#141414] border border-[#333] px-2 py-0.5 text-xs text-cyan-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase text-[#888] block mb-0.5">DX Grid</label>
            <input
              id="dx-grid-input"
              type="text"
              value={qsoState.targetDxGrid}
              onChange={(e) => onUpdateState({ targetDxGrid: e.target.value.toUpperCase() })}
              placeholder="e.g. QF22"
              maxLength={6}
              className="w-full bg-[#141414] border border-[#333] px-2 py-0.5 text-xs text-yellow-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase text-[#888] block mb-0.5">Sent SNR (dB)</label>
            <input
              id="sent-snr-input"
              type="text"
              value={qsoState.mySentReport}
              onChange={(e) => onUpdateState({ mySentReport: e.target.value })}
              placeholder="-18"
              className="w-full bg-[#141414] border border-[#333] px-2 py-0.5 text-xs text-[#00FF41] font-bold focus:outline-none focus:border-[#00FF41]"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase text-[#888] block mb-0.5">Rcvd SNR (dB)</label>
            <input
              id="rcvd-snr-input"
              type="text"
              value={qsoState.myRcvdReport}
              onChange={(e) => onUpdateState({ myRcvdReport: e.target.value })}
              placeholder="-22"
              className="w-full bg-[#141414] border border-[#333] px-2 py-0.5 text-xs text-[#D4D4D4] font-bold focus:outline-none focus:border-[#00FF41]"
            />
          </div>
        </div>

        {/* Tx Macro Radio Sequence */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#888] block">
            Standard QSO Macros (16-MFSK / 75 Symbols):
          </span>

          {[
            { key: 'tx1' as const, label: 'Tx 1 (CQ):', text: macros.tx1, stage: 'CALLING_CQ' },
            { key: 'tx2' as const, label: 'Tx 2 (Reply):', text: macros.tx2, stage: 'REPLYING_CQ' },
            { key: 'tx3' as const, label: 'Tx 3 (Report):', text: macros.tx3, stage: 'SENDING_REPORT' },
            { key: 'tx4' as const, label: 'Tx 4 (R+Rpt):', text: macros.tx4, stage: 'SENDING_R_REPORT' },
            { key: 'tx5' as const, label: 'Tx 5 (73):', text: macros.tx5, stage: 'SENDING_73' },
            { key: 'tx6' as const, label: 'Tx 6 (CQ DX):', text: macros.tx6, stage: 'CALLING_CQ' },
          ].map((item) => {
            const isSelected = qsoState.currentTxMacro === item.key;
            return (
              <div
                key={item.key}
                onClick={() => handleMacroSelect(item.key)}
                className={`flex items-center justify-between px-2 py-1 border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-red-950/40 border-red-800 text-red-300'
                    : 'bg-[#050505] border-[#222] text-[#888] hover:bg-[#1A1A1A] hover:text-[#D4D4D4]'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-2.5 h-2.5 border flex items-center justify-center ${
                      isSelected ? 'border-red-400 bg-red-500' : 'border-[#444] bg-transparent'
                    }`}
                  >
                    {isSelected && <div className="w-1 h-1 bg-white" />}
                  </div>
                  <span className="text-[10px] font-bold uppercase">{item.label}</span>
                </div>
                <span className="text-xs font-semibold text-[#D4D4D4]">{item.text}</span>
              </div>
            );
          })}
        </div>

        {/* Free Text Message Option */}
        <form onSubmit={handleCustomMsgSubmit} className="flex items-center space-x-1.5 pt-0.5">
          <input
            id="custom-tx-msg-input"
            type="text"
            placeholder="Free text (up to 13 chars)..."
            value={customMsgInput}
            onChange={(e) => setCustomMsgInput(e.target.value)}
            maxLength={13}
            className="flex-1 bg-[#050505] border border-[#333] px-2.5 py-1 text-xs text-[#D4D4D4] placeholder-[#666] focus:outline-none focus:border-[#00FF41]"
          />
          <button
            type="submit"
            className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D4] border border-[#333] text-xs font-bold uppercase"
          >
            Queue
          </button>
        </form>

        {/* RF Power & SWR Bar Meter */}
        <div className="bg-[#050505] p-1.5 border border-[#333] flex items-center justify-between text-[10px] uppercase">
          <div className="flex items-center space-x-2">
            <span className="text-[#888]">PWR:</span>
            <span className="font-bold text-red-400">
              {isTransmitting || isTuning ? `${fwdWatts.toFixed(0)} W` : '0 W'}
            </span>
            <span className="text-[#444]">|</span>
            <span className="text-[#888]">SWR:</span>
            <span className={`font-bold ${swr > 1.8 ? 'text-yellow-400' : 'text-[#00FF41]'}`}>
              {isTransmitting || isTuning ? `1:${swr.toFixed(2)}` : '1:1.00'}
            </span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-[#888]">AUDIO:</span>
            <span className="text-cyan-400 font-bold">{qsoState.txFreqHz} Hz</span>
          </div>
        </div>

        {/* Auto-Reply Priority Rule Card */}
        <div className="bg-[#050505] p-2 border border-[#333] space-y-1.5" id="auto-reply-priority-panel">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-[#888] flex items-center space-x-1.5">
              <Sparkles className="w-3 h-3 text-[#00FF41]" />
              <span>Auto-Reply Rule (CQ Pileup Filter)</span>
            </span>
            <span className="text-[9px] text-[#00FF41] font-mono font-bold bg-[#00FF41]/10 px-1.5 py-0.2 border border-[#00FF41]/30">
              {AUTO_REPLY_OPTIONS.find(o => o.id === (config.autoReplyPriority || 'FIRST'))?.tag || 'First'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {AUTO_REPLY_OPTIONS.map((opt) => {
              const isSelected = (config.autoReplyPriority || 'FIRST') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  id={`auto-reply-${opt.id.toLowerCase()}-btn`}
                  onClick={() => onUpdateConfig?.({ autoReplyPriority: opt.id })}
                  title={opt.description}
                  className={`px-1 py-1 text-[10px] font-mono font-bold uppercase border transition-all text-center flex flex-col items-center justify-center ${
                    isSelected
                      ? 'bg-[#00FF41] text-black border-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.4)]'
                      : 'bg-[#141414] hover:bg-[#1C1C1C] text-[#888] hover:text-[#D4D4D4] border-[#2A2A2A]'
                  }`}
                >
                  <span>{opt.shortLabel}</span>
                  <span className={`text-[8px] opacity-80 ${isSelected ? 'text-black font-semibold' : 'text-[#666]'}`}>
                    {opt.id === 'NEAREST' || opt.id === 'FARTHEST'
                      ? 'Dist (km)'
                      : opt.id === 'STRONGEST' || opt.id === 'WEAKEST'
                      ? 'SNR (dB)'
                      : 'Arrival'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Transmit / Slot State Banner */}
        <div className="bg-[#050505] px-2 py-1 border border-[#333] flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isTransmitting
                  ? 'bg-red-500 animate-ping'
                  : isTuning
                  ? 'bg-yellow-400 animate-pulse'
                  : qsoState.txEnabled
                  ? 'bg-[#00FF41] animate-pulse'
                  : 'bg-[#444]'
              }`}
            />
            <span className="text-[#AAA] uppercase">
              {isTransmitting
                ? 'TX Active: 16-MFSK Frame'
                : isTuning
                ? 'Tune: Continuous CW Carrier'
                : qsoState.txEnabled
                ? `Armed: Waiting for ${evaluateSlotTiming(qsoState.txSlot).targetSlotLabel} slot (${evaluateSlotTiming(qsoState.txSlot).secondsUntilTargetSlot}s)`
                : `Standby: TX Disabled (${evaluateSlotTiming(qsoState.txSlot).targetSlotLabel})`}
            </span>
          </div>

          <span
            className={`px-1 py-0.2 text-[9px] font-bold uppercase ${
              isTransmitting
                ? 'bg-red-950 text-red-400 border border-red-800'
                : isTuning
                ? 'bg-yellow-950 text-yellow-300 border border-yellow-800'
                : qsoState.txEnabled
                ? 'bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/60'
                : 'bg-[#181818] text-[#777] border border-[#333]'
            }`}
          >
            {isTransmitting
              ? 'TRANSMITTING'
              : isTuning
              ? 'TUNING CW'
              : qsoState.txEnabled
              ? 'ARMED'
              : 'OFF'}
          </span>
        </div>

        {/* Main PTT & Transmit Controls */}
        <div className="space-y-1.5 pt-0.5">
          {/* Primary Action Buttons: Start TX and Stop TX */}
          <div className="grid grid-cols-2 gap-2">
            {/* Start Transmission Button */}
            <button
              id="start-tx-btn"
              onClick={onStartTx}
              disabled={isTransmitting}
              title={
                qsoState.txEnabled && !isTransmitting
                  ? `TX Armed: Will start transmission at ${evaluateSlotTiming(qsoState.txSlot).targetSlotLabel} in ${evaluateSlotTiming(qsoState.txSlot).secondsUntilTargetSlot}s`
                  : `Enable & Start TX on ${evaluateSlotTiming(qsoState.txSlot).targetSlotLabel} slot`
              }
              className={`py-2 px-3 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all ${
                isTransmitting
                  ? 'bg-red-950/60 text-red-300 border border-red-800 cursor-not-allowed'
                  : qsoState.txEnabled
                  ? 'bg-[#00FF41] text-black shadow-[0_0_15px_rgba(0,255,65,0.6)] animate-pulse'
                  : 'bg-[#00FF41] hover:bg-[#00E038] text-black shadow-[0_0_12px_rgba(0,255,65,0.4)] active:scale-[0.98]'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>
                {isTransmitting
                  ? 'TRANSMITTING...'
                  : qsoState.txEnabled
                  ? `TX ARMED (${evaluateSlotTiming(qsoState.txSlot).secondsUntilTargetSlot}s)`
                  : `START TX (${evaluateSlotTiming(qsoState.txSlot).targetSlotLabel})`}
              </span>
            </button>

            {/* Stop Transmission Button */}
            <button
              id="stop-tx-btn"
              onClick={onStopTx}
              title="Stop / Abort Active Transmission or Disarm TX"
              className={`py-2 px-3 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all ${
                isTransmitting || isTuning || qsoState.txEnabled
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse shadow-[0_0_15px_#EF4444]'
                  : 'bg-[#1A1A1A] hover:bg-red-950/80 text-[#888] hover:text-red-400 border border-[#333]'
              }`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{isTransmitting ? 'STOP TX (HALT)' : qsoState.txEnabled ? 'DISARM TX' : 'STOP TX'}</span>
            </button>
          </div>

          {/* Secondary Controls: Auto-Sequence Arm & CW Tune */}
          <div className="grid grid-cols-2 gap-2">
            {/* Auto-Sequence Arm Toggle */}
            <button
              id="enable-tx-toggle-btn"
              onClick={onToggleTx}
              className={`py-1.5 px-2 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all border ${
                qsoState.txEnabled
                  ? 'bg-[#00FF41]/15 border-[#00FF41] text-[#00FF41]'
                  : 'bg-[#141414] hover:bg-[#1A1A1A] text-[#777] hover:text-[#BBB] border-[#333]'
              }`}
            >
              <Power className="w-3 h-3" />
              <span>{qsoState.txEnabled ? 'AUTO-SEQ: ARMED' : 'AUTO-SEQ: OFF'}</span>
            </button>

            {/* Dedicated CW Antenna Tuning Button */}
            <button
              id="tune-cw-btn"
              onClick={isTuning ? onStopTune : onStartTune}
              title="Key transmitter with unmodulated CW tone for antenna tuner calibration"
              className={`py-1.5 px-2 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-colors border ${
                isTuning
                  ? 'bg-yellow-500 text-black border-yellow-400 animate-pulse shadow-[0_0_12px_rgba(234,179,8,0.5)]'
                  : 'bg-[#141414] hover:bg-[#1A1A1A] text-cyan-400 hover:text-cyan-300 border-cyan-900/60'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>{isTuning ? 'TUNING...' : 'TUNE (CW)'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
