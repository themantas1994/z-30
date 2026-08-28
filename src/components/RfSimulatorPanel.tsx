/**
 * RF Channel Simulator & Successive Interference Cancellation (SIC) Testbench
 */

import React from 'react';
import { RfChannelParams } from '../types/z30';
import { SicIterationStep } from '../dsp/sicDecoder';
import { Sparkles, Sliders, ShieldAlert, Cpu, Activity, Play, RefreshCw, Zap } from 'lucide-react';

interface RfSimulatorPanelProps {
  channelParams: RfChannelParams;
  onUpdateParams: (partial: Partial<RfChannelParams>) => void;
  sicSteps: SicIterationStep[];
  onTriggerDecodeNow: () => void;
}

export const RfSimulatorPanel: React.FC<RfSimulatorPanelProps> = ({
  channelParams,
  onUpdateParams,
  sicSteps,
  onTriggerDecodeNow,
}) => {
  return (
    <div className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono" id="rf-simulator-card">
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333]">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            RF Channel & SIC Testbench
          </span>
        </div>

        <button
          id="trigger-decode-now-btn"
          onClick={onTriggerDecodeNow}
          className="flex items-center space-x-1 px-2.5 py-0.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold uppercase shadow-[0_0_10px_rgba(168,85,247,0.4)]"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Decode Cycle Now</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="p-3 space-y-3 flex-1 overflow-y-auto text-xs bg-[#0F0F0F]">
        {/* Channel Parameters Grid */}
        <div className="bg-[#050505] p-2.5 border border-[#333] space-y-2.5">
          <div className="text-[11px] font-bold text-[#D4D4D4] flex items-center justify-between uppercase">
            <span>IONOSPHERIC CHANNEL MODEL:</span>
            <span className="text-purple-400 font-bold">{channelParams.snrDb} dB SNR (2500 Hz Ref)</span>
          </div>

          {/* SNR Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-[#888] uppercase">
              <span>Channel AWGN Noise Floor:</span>
              <span className="text-cyan-400 font-bold">{channelParams.snrDb} dB</span>
            </div>
            <input
              id="rf-snr-slider"
              type="range"
              min="-35"
              max="5"
              step="1"
              value={channelParams.snrDb}
              onChange={(e) => onUpdateParams({ snrDb: Number(e.target.value) })}
              className="w-full h-1 bg-[#333] appearance-none cursor-pointer accent-[#00FF41]"
            />
            <div className="flex justify-between text-[9px] text-[#666]">
              <span>-35 dB (Extreme DX)</span>
              <span>-29.5 dB (z-30 Limit)</span>
              <span>-21 dB (FT8 Limit)</span>
              <span>0 dB (Strong)</span>
            </div>
          </div>

          {/* Fading Model Selection */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[9px] uppercase tracking-wider text-[#888] block mb-1">Fading Profile:</label>
              <select
                id="fading-profile-select"
                value={channelParams.fadingModel}
                onChange={(e) => onUpdateParams({ fadingModel: e.target.value as any })}
                className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
              >
                <option value="AWGN">AWGN (Gaussian White Noise)</option>
                <option value="RAYLEIGH_MILD">Rayleigh Mild (0.2 Hz Doppler)</option>
                <option value="RAYLEIGH_MODERATE">Rayleigh Moderate (1.0 Hz Doppler)</option>
                <option value="RICIAN">Rician (Line-of-Sight + Scatter)</option>
              </select>
            </div>

            <div>
              <label className="text-[9px] uppercase tracking-wider text-[#888] block mb-1">Doppler Drift Rate:</label>
              <select
                id="doppler-drift-select"
                value={channelParams.dopplerDriftHzPerSec}
                onChange={(e) => onUpdateParams({ dopplerDriftHzPerSec: Number(e.target.value) })}
                className="w-full bg-[#141414] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4] focus:outline-none focus:border-[#00FF41]"
              >
                <option value={0}>0.0 Hz/s (Stable)</option>
                <option value={0.2}>±0.2 Hz/s (Ionospheric)</option>
                <option value={0.8}>±0.8 Hz/s (Auroral/LEO)</option>
                <option value={1.5}>±1.5 Hz/s (Fast Doppler)</option>
              </select>
            </div>
          </div>

          {/* Co-Channel Collision Generator Toggle */}
          <div className="pt-2 border-t border-[#222] flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <input
                id="enable-collision-checkbox"
                type="checkbox"
                checked={channelParams.enableCoChannelInterference}
                onChange={(e) => onUpdateParams({ enableCoChannelInterference: e.target.checked })}
                className="w-3.5 h-3.5 bg-[#141414] border-[#333] text-[#00FF41] focus:ring-0 cursor-pointer accent-[#00FF41]"
              />
              <label htmlFor="enable-collision-checkbox" className="text-xs text-[#D4D4D4] font-medium cursor-pointer">
                Inject Co-Channel Colliding QRM
              </label>
            </div>
            <span className="text-[10px] text-purple-400 font-bold uppercase">
              {channelParams.enableCoChannelInterference ? '+3 dB QRM Active' : 'Off'}
            </span>
          </div>
        </div>

        {/* Live SIC Multi-Pass Execution Breakdown */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-[#D4D4D4] uppercase">
            <span>MULTI-STAGE SIC DECODER PIPELINE:</span>
            <span className="text-[#888] text-[10px]">{sicSteps.length} Passes Active</span>
          </div>

          {sicSteps.length === 0 ? (
            <div className="bg-[#050505] p-3 border border-[#333] text-center text-[#666] text-xs">
              Waiting for next 30-second cycle decode window...
            </div>
          ) : (
            <div className="space-y-1.5">
              {sicSteps.map((step) => {
                return (
                  <div
                    key={step.passNumber}
                    className="bg-[#050505] p-2 border border-[#333] space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            step.passNumber === 1
                              ? 'bg-[#00FF41]'
                              : step.passNumber === 2
                              ? 'bg-indigo-400'
                              : 'bg-fuchsia-400'
                          }`}
                        />
                        <span className="font-bold text-[#D4D4D4] uppercase">
                          Pass {step.passNumber}
                        </span>
                      </div>
                      <span className="text-[#888] text-[10px]">
                        Residual: <strong className="text-cyan-400">{step.residualPowerDb} dB</strong>
                      </span>
                    </div>

                    <p className="text-[11px] text-[#888] leading-tight">
                      {step.description}
                    </p>

                    {step.signalsFound.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1">
                        {step.signalsFound.map((sig) => (
                          <span
                            key={sig.id}
                            className="inline-flex items-center px-1.5 py-0.2 text-[10px] bg-[#141414] border border-[#333] text-[#D4D4D4]"
                          >
                            <strong className="text-cyan-400 mr-1">{sig.callFrom || sig.message.split(' ')[1]}</strong>
                            <span className="text-[#888]">({sig.snr}dB)</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
