/**
 * Target DX Station Controller & QSO State Machine Interface
 * Designed to fit completely within its viewport without requiring scrolling.
 */

import React from 'react';
import { StationConfig } from '../types/z30';
import { QsoState } from '../dsp/qsoEngine';
import { Send, Compass, MapPin } from 'lucide-react';

interface QsoControllerProps {
  qsoState: QsoState;
  config: StationConfig;
  currentBand: string;
  isTransmitting: boolean;
  onUpdateState: (partial: Partial<QsoState>) => void;
  onUpdateConfig?: (partial: Partial<StationConfig>) => void;
  onCallingCq?: () => void;
  onToggleTx?: () => void;
  onStartTx?: () => void;
  onStopTx?: () => void;
  onStartTune?: () => void;
  onStopTune?: () => void;
  isTuning?: boolean;
  fwdWatts?: number;
}

export const QsoController: React.FC<QsoControllerProps> = ({
  qsoState,
  config,
  currentBand,
  isTransmitting,
  onUpdateState,
  fwdWatts = 50.0,
  isTuning = false,
}) => {

  // Approximate distance calculation between grids if both exist
  const calculateDistanceKm = (grid1: string, grid2: string): number | null => {
    if (!grid1 || !grid2 || grid1.length < 4 || grid2.length < 4) return null;
    const g1 = grid1.toUpperCase();
    const g2 = grid2.toUpperCase();
    const lon1 = (g1.charCodeAt(0) - 65) * 20 + parseInt(g1[2], 10) * 2 - 180 + 1;
    const lat1 = (g1.charCodeAt(1) - 65) * 10 + parseInt(g1[3], 10) * 1 - 90 + 0.5;
    const lon2 = (g2.charCodeAt(0) - 65) * 20 + parseInt(g2[2], 10) * 2 - 180 + 1;
    const lat2 = (g2.charCodeAt(1) - 65) * 10 + parseInt(g2[3], 10) * 1 - 90 + 0.5;
    
    const R = 6371; // km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  };

  const distKm = calculateDistanceKm(config.myGrid, qsoState.targetDxGrid);

  return (
    <div
      className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono select-none"
      id="qso-target-station-window"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333] flex-shrink-0">
        <div className="flex items-center space-x-2">
          <Send className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            Target DX Station & State
          </span>
        </div>

        {/* Slot Selector */}
        <div className="flex items-center space-x-1.5 bg-[#050505] px-2 py-0.5 border border-[#333] text-xs">
          <span className="text-[#888] text-[9px]">SLOT:</span>
          <button
            id="slot-even-btn"
            type="button"
            onClick={() => onUpdateState({ txSlot: 'EVEN' })}
            className={`px-1.5 py-0.2 text-[9px] font-bold uppercase transition-colors ${
              qsoState.txSlot === 'EVEN' ? 'bg-[#00FF41] text-black shadow-[0_0_6px_rgba(0,255,65,0.4)]' : 'text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            Even (00s)
          </button>
          <button
            id="slot-odd-btn"
            type="button"
            onClick={() => onUpdateState({ txSlot: 'ODD' })}
            className={`px-1.5 py-0.2 text-[9px] font-bold uppercase transition-colors ${
              qsoState.txSlot === 'ODD' ? 'bg-[#00FF41] text-black shadow-[0_0_6px_rgba(0,255,65,0.4)]' : 'text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            Odd (30s)
          </button>
        </div>
      </div>

      {/* Main Content (Compact, No Scrolling Needed) */}
      <div className="p-2 space-y-2 flex-1 flex flex-col justify-between text-xs bg-[#0F0F0F]">
        {/* DX Station Info 4-Column Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-[#050505] p-2 border border-[#333]">
          <div>
            <label className="text-[9px] uppercase font-bold text-[#888] block mb-0.5">DX Call</label>
            <input
              id="dx-call-input"
              type="text"
              value={qsoState.targetDxCall}
              onChange={(e) => onUpdateState({ targetDxCall: e.target.value.toUpperCase() })}
              placeholder="e.g. VK3XYZ"
              className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-cyan-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase font-bold text-[#888] block mb-0.5">DX Grid</label>
            <input
              id="dx-grid-input"
              type="text"
              value={qsoState.targetDxGrid}
              onChange={(e) => onUpdateState({ targetDxGrid: e.target.value.toUpperCase() })}
              placeholder="e.g. QF22"
              maxLength={6}
              className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-yellow-400 font-bold uppercase focus:outline-none focus:border-[#00FF41]"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase font-bold text-[#888] block mb-0.5">Sent SNR (dB)</label>
            <input
              id="sent-snr-input"
              type="text"
              value={qsoState.mySentReport}
              onChange={(e) => onUpdateState({ mySentReport: e.target.value })}
              placeholder="-18"
              className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-[#00FF41] font-bold focus:outline-none focus:border-[#00FF41]"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase font-bold text-[#888] block mb-0.5">Rcvd SNR (dB)</label>
            <input
              id="rcvd-snr-input"
              type="text"
              value={qsoState.myRcvdReport}
              onChange={(e) => onUpdateState({ myRcvdReport: e.target.value })}
              placeholder="-22"
              className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] font-bold focus:outline-none focus:border-[#00FF41]"
            />
          </div>
        </div>

        {/* Carrier Audio Frequency & Lock Settings */}
        <div className="bg-[#050505] p-2 border border-[#333] grid grid-cols-2 gap-2 text-xs">
          {/* RX Audio Freq */}
          <div className="flex items-center justify-between bg-[#111] px-2 py-1 border border-[#222]">
            <span className="text-[9px] uppercase text-[#888] font-bold">RX AUDIO:</span>
            <span className="text-xs font-bold text-[#00FF41]">{qsoState.rxFreqHz} Hz</span>
          </div>

          {/* TX Audio Freq */}
          <div className="flex items-center justify-between bg-[#111] px-2 py-1 border border-[#222]">
            <span className="text-[9px] uppercase text-[#888] font-bold">TX AUDIO:</span>
            <span className="text-xs font-bold text-red-400">{qsoState.txFreqHz} Hz</span>
          </div>
        </div>

        {/* Telemetry & Geographic Distance Card */}
        <div className="bg-[#050505] p-2 border border-[#333] flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1 text-[#AAA]">
              <MapPin className="w-3 h-3 text-yellow-400" />
              <span>
                DX:{' '}
                <strong className="text-[#FFF]">{qsoState.targetDxCall || 'None'}</strong>
                {distKm !== null && <span className="text-yellow-400 font-bold ml-1">({distKm.toLocaleString()} km)</span>}
              </span>
            </div>
            <div className="flex items-center space-x-1 text-[#AAA]">
              <Compass className="w-3 h-3 text-cyan-400" />
              <span>Band: <strong className="text-[#00FF41]">{currentBand}</strong></span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div title="The transmit power configured in Station Settings. z-30 does not read power from the radio, so this is what you told it, not what the PA is producing.">
              <span>PWR (set): </span>
              <strong className="text-red-400 font-bold">
                {isTransmitting || isTuning ? `${fwdWatts.toFixed(0)}W` : '0W'}
              </strong>
            </div>
            <div title="Nothing in this signal path measures SWR. A soundcard and a serial CAT link have no reflected-power sensor, and inventing a plausible figure would tell you your antenna is fine when nothing looked at it. Read SWR from the radio's own meter.">
              <span>SWR: </span>
              <strong className="text-[#666] font-bold">not measured</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

