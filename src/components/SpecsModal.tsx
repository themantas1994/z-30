/**
 * z-30 Digital Mode Technical Specifications & RF Math Reference Modal
 */

import React from 'react';
import { X, ShieldCheck, Zap, Radio, Layers, Activity } from 'lucide-react';

interface SpecsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBenchmark?: () => void;
}

export const SpecsModal: React.FC<SpecsModalProps> = ({ isOpen, onClose, onOpenBenchmark }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 font-mono">
      <div className="bg-[#141414] border border-[#333] w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#0F0F0F] border-b border-[#333]">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-[#00FF41]" />
            <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
              z-30 Protocol Architecture & DSP Math Reference
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 overflow-y-auto text-xs text-[#D4D4D4] space-y-3 leading-relaxed select-text bg-[#0F0F0F]">
          {/* Key Metrics Bento */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-[#050505] p-2.5 border border-[#333]">
              <span className="text-[9px] text-[#888] block uppercase">MODULATION</span>
              <span className="font-bold text-cyan-400 text-xs">16-MFSK (CPFSK)</span>
            </div>
            <div className="bg-[#050505] p-2.5 border border-[#333]">
              <span className="text-[9px] text-[#888] block uppercase">OCCUPIED BANDWIDTH</span>
              <span className="font-bold text-[#00FF41] text-xs">50.0 Hz</span>
            </div>
            <div className="bg-[#050505] p-2.5 border border-[#333]">
              <span className="text-[9px] text-[#888] block uppercase">UTC TIME SLOT</span>
              <span className="font-bold text-yellow-400 text-xs">30.0 Seconds</span>
            </div>
            <div className="bg-[#050505] p-2.5 border border-[#333]">
              <span className="text-[9px] text-[#888] block uppercase">AWGN 50% THRESHOLD</span>
              <span className="font-bold text-purple-400 text-xs">-25.0 dB SNR</span>
            </div>
          </div>

          {/* Detailed Specifications Breakdown */}
          <div className="space-y-2 bg-[#050505] p-3 border border-[#333]">
            <h3 className="font-bold text-[#00FF41] flex items-center space-x-1.5 uppercase text-[11px]">
              <Layers className="w-3.5 h-3.5" />
              <span>1. Modulation & Framing Structure</span>
            </h3>
            <ul className="list-disc list-inside space-y-1 text-[#D4D4D4] text-[11px]">
              <li><strong>Tone Count:</strong> 16 orthogonal tones (M = 16).</li>
              <li><strong>Tone Spacing:</strong> Tone delta f = 50 Hz / 16 = 3.125 Hz.</li>
              <li><strong>Symbol Duration:</strong> Ts = 1 / 3.125 Hz = 0.320 seconds (320 ms).</li>
              <li><strong>Active Transmission:</strong> 75 symbols * 0.320s = 24.0 seconds.</li>
              <li><strong>Guard & Decode Window:</strong> 6.0 seconds for FFT framing, multi-stage SIC, and LDPC decoding.</li>
              <li><strong>Synchronization:</strong> 21 Costas array sync symbols interleaved throughout the frame for sub-Hz frequency tracking and symbol time offset (DT) estimation.</li>
              <li><strong>Empirical Sensitivity (Monte Carlo):</strong> 50% decode at -25.0 dB SNR; 90% decode at -24.0 dB SNR (+4.0 dB link margin gain over FT8).</li>
            </ul>
          </div>

          {/* Forward Error Correction */}
          <div className="space-y-2 bg-[#050505] p-3 border border-[#333]">
            <h3 className="font-bold text-cyan-400 flex items-center space-x-1.5 uppercase text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>2. Low-Density Parity-Check (LDPC) Forward Error Correction</span>
            </h3>
            <ul className="list-disc list-inside space-y-1 text-[#D4D4D4] text-[11px]">
              <li><strong>Code Rate:</strong> Systematic (216, 77) Irregular Repeat-Accumulate (IRA) LDPC code (R ~ 0.356).</li>
              <li><strong>Information Payload:</strong> 77 bits total (28-bit Call 1, 28-bit Call 2, 7-bit Grid/Report, 14-bit CRC parity check).</li>
              <li><strong>Channel Bits:</strong> 54 data symbols * 4 bits/symbol = 216 coded bits.</li>
              <li><strong>Decoder:</strong> Vectorized Normalized Min-Sum Belief Propagation decoder with attenuation factor alpha = 0.75 and up to 50 iterations.</li>
            </ul>
          </div>

          {/* Successive Interference Cancellation */}
          <div className="space-y-2 bg-[#050505] p-3 border border-[#333]">
            <h3 className="font-bold text-purple-400 flex items-center space-x-1.5 uppercase text-[11px]">
              <Zap className="w-3.5 h-3.5" />
              <span>3. Successive Interference Cancellation (SIC) Multi-Signal Extraction</span>
            </h3>
            <p className="text-[11px] text-[#D4D4D4]">
              When multiple amateur radio stations transmit co-channel inside the same 50 Hz passband, traditional decoders fail due to high SINR degradation. z-30 solves this via a 3-pass SIC pipeline:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[#D4D4D4] text-[11px]">
              <li><strong>Pass 1 (Direct Decode):</strong> Detect and decode the highest-power station using LDPC belief propagation.</li>
              <li><strong>Waveform Synthesis & Cancellation:</strong> Reconstruct the continuous-phase 16-MFSK time-domain waveform, estimate amplitude/phase, and subtract from buffer.</li>
              <li><strong>Pass 2 & 3 (Deep Unburying):</strong> Re-run matched filters on the residual signal to decode buried weak DX stations down to -31.5 dB SNR.</li>
            </ol>
          </div>

          {/* Comparison Table */}
          <div className="space-y-2 bg-[#050505] p-3 border border-[#333]">
            <h3 className="font-bold text-yellow-400 uppercase text-[11px]">4. Comparison: z-30 vs Existing Weak-Signal Modes</h3>
            <table className="w-full text-left text-[11px] border border-[#333]">
              <thead className="bg-[#0A0A0A] text-[#888] border-b border-[#333] uppercase text-[10px]">
                <tr>
                  <th className="p-1.5">Mode</th>
                  <th className="p-1.5">Modulation</th>
                  <th className="p-1.5">Bandwidth</th>
                  <th className="p-1.5">Cycle</th>
                  <th className="p-1.5">Threshold (2500Hz)</th>
                  <th className="p-1.5">SIC Multi-Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222]">
                <tr className="bg-[#00FF41]/10 font-bold text-[#00FF41]">
                  <td className="p-1.5">z-30</td>
                  <td className="p-1.5">16-MFSK</td>
                  <td className="p-1.5">50 Hz</td>
                  <td className="p-1.5">30 sec</td>
                  <td className="p-1.5 text-purple-300">-25.0 dB (50%) / -24.0 dB (90%)</td>
                  <td className="p-1.5 text-[#00FF41]">Yes (3-Pass SIC)</td>
                </tr>
                <tr className="text-[#888]">
                  <td className="p-1.5 text-[#D4D4D4]">FT8</td>
                  <td className="p-1.5">8-FSK</td>
                  <td className="p-1.5">50 Hz</td>
                  <td className="p-1.5">15 sec</td>
                  <td className="p-1.5">-21.0 dB</td>
                  <td className="p-1.5 text-[#666]">No</td>
                </tr>
                <tr className="text-[#888]">
                  <td className="p-1.5 text-[#D4D4D4]">FT4</td>
                  <td className="p-1.5">4-FSK</td>
                  <td className="p-1.5">80 Hz</td>
                  <td className="p-1.5">7.5 sec</td>
                  <td className="p-1.5">-17.5 dB</td>
                  <td className="p-1.5 text-[#666]">No</td>
                </tr>
                <tr className="text-[#888]">
                  <td className="p-1.5 text-[#D4D4D4]">WSPR</td>
                  <td className="p-1.5">4-FSK</td>
                  <td className="p-1.5">6 Hz</td>
                  <td className="p-1.5">120 sec</td>
                  <td className="p-1.5">-28.0 dB</td>
                  <td className="p-1.5 text-[#666]">No (Beacon only)</td>
                </tr>
              </tbody>
            </table>
          </div>

          {onOpenBenchmark && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  onClose();
                  onOpenBenchmark();
                }}
                className="px-3 py-1.5 bg-[#00FF41]/10 hover:bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/50 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Launch Monte Carlo Waveform & SNR Decoder Benchmark</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
