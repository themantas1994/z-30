/**
 * Dedicated Window for Standard QSO Macros, Auto-Reply Rule & PTT Action Controls
 * Designed to fit completely within its viewport window without requiring scrolling.
 */

import React, { useState } from 'react';
import { AutoReplyPriority, StationConfig, TxSlot } from '../types/z30';
import { QsoState } from '../dsp/qsoEngine';
import { buildQsoMacros } from '../dsp/z30Codec';
import { AUTO_REPLY_OPTIONS, evaluateSlotTiming } from '../dsp/z30Constants';
import { Radio, Power, Zap, Send, Sparkles, Square, MessageSquareText, SlidersHorizontal } from 'lucide-react';

interface QsoMacrosTransmitPanelProps {
  qsoState: QsoState;
  config: StationConfig;
  currentBand: string;
  isTransmitting: boolean;
  isTuning: boolean;
  onUpdateState: (partial: Partial<QsoState>) => void;
  onUpdateConfig?: (partial: Partial<StationConfig>) => void;
  onCallingCq?: () => void;
  onToggleTx: () => void;
  onStartTx?: () => void;
  onStopTx?: () => void;
  onStartTune: () => void;
  onStopTune: () => void;
}

export const QsoMacrosTransmitPanel: React.FC<QsoMacrosTransmitPanelProps> = ({
  qsoState,
  config,
  currentBand,
  isTransmitting,
  isTuning,
  onUpdateState,
  onUpdateConfig,
  onCallingCq,
  onToggleTx,
  onStartTx,
  onStopTx,
  onStartTune,
  onStopTune,
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

  const slotTiming = evaluateSlotTiming(qsoState.txSlot);

  return (
    <div
      className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono select-none"
      id="qso-macros-transmit-window"
    >
      {/* Window Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333] flex-shrink-0">
        <div className="flex items-center space-x-2">
          <MessageSquareText className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            Standard QSO Macros & Transmit Sequencer
          </span>
        </div>

        {/* Live Slot & Tx Status Tag */}
        <div className="flex items-center space-x-2">
          <span className="text-[10px] text-[#888]">
            SLOT: <strong className="text-[#00FF41]">{slotTiming.targetSlotLabel}</strong>
          </span>
          <span
            className={`px-1.5 py-0.2 text-[9px] font-bold uppercase ${
              isTransmitting
                ? 'bg-red-950 text-red-400 border border-red-800 animate-pulse'
                : isTuning
                ? 'bg-yellow-950 text-yellow-300 border border-yellow-800 animate-pulse'
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
              ? `ARMED (${slotTiming.secondsUntilTargetSlot}s)`
              : 'OFF'}
          </span>
        </div>
      </div>

      {/* Main Container - Non-Scrolling Grid */}
      <div className="p-2 space-y-2 flex-1 flex flex-col justify-between text-xs bg-[#0F0F0F]">
        {/* 1. Standard 16-MFSK QSO Macros List */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#888]">
            <span>STANDARD QSO MACROS (16-MFSK / 75 SYMBOLS):</span>
            <span className="text-[#666] text-[9px] font-normal">Click to arm next frame</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {[
              { key: 'tx1' as const, label: 'Tx 1 (CQ):', text: macros.tx1 },
              { key: 'tx2' as const, label: 'Tx 2 (Reply):', text: macros.tx2 },
              { key: 'tx3' as const, label: 'Tx 3 (Report):', text: macros.tx3 },
              { key: 'tx4' as const, label: 'Tx 4 (R+Rpt):', text: macros.tx4 },
              { key: 'tx5' as const, label: 'Tx 5 (73):', text: macros.tx5 },
              { key: 'tx6' as const, label: 'Tx 6 (CQ DX):', text: macros.tx6 },
            ].map((item) => {
              const isSelected = qsoState.currentTxMacro === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  id={`macro-btn-${item.key}`}
                  onClick={() => handleMacroSelect(item.key)}
                  className={`flex items-center justify-between px-2 py-1 border transition-all text-left w-full ${
                    isSelected
                      ? 'bg-red-950/60 border-red-500 text-red-200 shadow-[0_0_8px_rgba(239,68,68,0.3)]'
                      : 'bg-[#050505] border-[#222] text-[#888] hover:bg-[#1A1A1A] hover:text-[#D4D4D4]'
                  }`}
                >
                  <div className="flex items-center space-x-1.5 truncate mr-1">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isSelected ? 'bg-red-400 animate-pulse' : 'bg-[#444]'
                      }`}
                    />
                    <span className="text-[10px] font-bold uppercase text-[#BBB]">{item.label}</span>
                  </div>
                  <span className="text-[11px] font-bold text-cyan-300 truncate">{item.text}</span>
                </button>
              );
            })}
          </div>

          {/* Free Text Queue Input */}
          <form onSubmit={handleCustomMsgSubmit} className="flex items-center space-x-1.5 pt-0.5">
            <input
              id="custom-tx-msg-input"
              type="text"
              placeholder="Free text (up to 13 chars)..."
              value={customMsgInput}
              onChange={(e) => setCustomMsgInput(e.target.value)}
              maxLength={13}
              className="flex-1 bg-[#050505] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] placeholder-[#666] focus:outline-none focus:border-[#00FF41]"
            />
            <button
              type="submit"
              id="queue-custom-msg-btn"
              className="px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D4] hover:text-white border border-[#333] text-[11px] font-bold uppercase"
            >
              Queue
            </button>
          </form>
        </div>

        {/* 2. Auto-Reply Priority Rule (CQ Pileup Filter) */}
        <div className="bg-[#050505] p-1.5 border border-[#333] space-y-1" id="auto-reply-panel">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-[#888] flex items-center space-x-1.5">
              <Sparkles className="w-3 h-3 text-[#00FF41]" />
              <span>AUTO-REPLY RULE (CQ PILEUP FILTER)</span>
            </span>
            <span className="text-[9px] text-[#00FF41] font-bold bg-[#00FF41]/10 px-1.5 py-0.2 border border-[#00FF41]/30">
              Active: {AUTO_REPLY_OPTIONS.find((o) => o.id === (config.autoReplyPriority || 'FIRST'))?.tag || 'First'}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
            {AUTO_REPLY_OPTIONS.map((opt) => {
              const isSelected = (config.autoReplyPriority || 'FIRST') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  id={`auto-reply-${opt.id.toLowerCase()}-btn`}
                  onClick={() => onUpdateConfig?.({ autoReplyPriority: opt.id })}
                  title={opt.description}
                  className={`px-1 py-1 text-[10px] font-bold uppercase border transition-all text-center flex flex-col items-center justify-center ${
                    isSelected
                      ? 'bg-[#00FF41] text-black border-[#00FF41] shadow-[0_0_6px_rgba(0,255,65,0.4)]'
                      : 'bg-[#121212] hover:bg-[#1C1C1C] text-[#888] hover:text-[#D4D4D4] border-[#2A2A2A]'
                  }`}
                >
                  <span className="leading-tight">{opt.shortLabel}</span>
                  <span className={`text-[7px] leading-none ${isSelected ? 'text-black font-semibold' : 'text-[#666]'}`}>
                    {opt.id === 'NEAREST' || opt.id === 'FARTHEST'
                      ? 'Dist'
                      : opt.id === 'STRONGEST' || opt.id === 'WEAKEST'
                      ? 'SNR'
                      : 'Arrival'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Primary PTT Controls: START TX, STOP TX, AUTO-SEQ, TUNE (CW) */}
        <div className="space-y-1.5 pt-0.5">
          {/* Main Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            {/* Start TX */}
            <button
              id="start-tx-btn"
              type="button"
              onClick={onStartTx}
              disabled={isTransmitting}
              title={
                qsoState.txEnabled && !isTransmitting
                  ? `TX Armed: Will begin at ${slotTiming.targetSlotLabel} in ${slotTiming.secondsUntilTargetSlot}s`
                  : `Enable & Start TX on ${slotTiming.targetSlotLabel} slot`
              }
              className={`py-2 px-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all border ${
                isTransmitting
                  ? 'bg-red-950/60 text-red-300 border-red-800 cursor-not-allowed'
                  : qsoState.txEnabled
                  ? 'bg-[#00FF41] text-black border-[#00FF41] shadow-[0_0_15px_rgba(0,255,65,0.6)] animate-pulse'
                  : 'bg-[#00FF41] hover:bg-[#00E038] text-black border-[#00FF41] shadow-[0_0_12px_rgba(0,255,65,0.4)] active:scale-[0.98]'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>
                {isTransmitting
                  ? 'TRANSMITTING...'
                  : qsoState.txEnabled
                  ? `TX ARMED (${slotTiming.secondsUntilTargetSlot}s)`
                  : `START TX (${slotTiming.targetSlotLabel})`}
              </span>
            </button>

            {/* Stop TX */}
            <button
              id="stop-tx-btn"
              type="button"
              onClick={onStopTx}
              title="Stop / Abort Active Transmission or Disarm TX"
              className={`py-2 px-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all border ${
                isTransmitting || isTuning || qsoState.txEnabled
                  ? 'bg-red-600 hover:bg-red-700 text-white border-red-500 animate-pulse shadow-[0_0_15px_#EF4444]'
                  : 'bg-[#1A1A1A] hover:bg-red-950/80 text-[#888] hover:text-red-400 border border-[#333]'
              }`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{isTransmitting ? 'STOP TX (HALT)' : qsoState.txEnabled ? 'DISARM TX' : 'STOP TX'}</span>
            </button>
          </div>

          {/* Secondary Controls: Auto-Seq Arm & CW Tune */}
          <div className="grid grid-cols-2 gap-2">
            {/* Auto-Sequence Arm Toggle */}
            <button
              id="enable-tx-toggle-btn"
              type="button"
              onClick={onToggleTx}
              className={`py-1.5 px-2 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all border ${
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
              type="button"
              onClick={isTuning ? onStopTune : onStartTune}
              title="Key transmitter with unmodulated CW tone for antenna tuner calibration"
              className={`py-1.5 px-2 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-colors border ${
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
