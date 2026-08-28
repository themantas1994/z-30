/**
 * Interactive Systematic (216, 77) IRA LDPC Codec Laboratory & Testbench
 * =====================================================================
 * Features:
 * - Real-time encoder for custom message text and payload bits
 * - 14-bit CRC (0x2443) computation and syndrome inspection
 * - Parity Check Matrix H (139 x 216) Tanner graph visualization
 * - Configurable bit corruption engine (BSC Bit Flips & AWGN LLR noise)
 * - Step-by-step & Auto-run Normalized Min-Sum Belief Propagation Decoder
 * - Real-time convergence telemetry (Syndrome weight, average LLR magnitude)
 */

import React, { useState, useMemo } from 'react';
import { ldpcCodec, Z30_LDPC_PARAMS, LdpcEncodeResult, LdpcDecodeResult } from '../dsp/ldpcCodec';
import { packZ30Message } from '../dsp/z30Codec';
import {
  Cpu,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  FileCode2,
  X,
  Shuffle,
  ShieldCheck,
} from 'lucide-react';

interface LdpcLabModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LdpcLabModal: React.FC<LdpcLabModalProps> = ({ isOpen, onClose }) => {
  const [inputText, setInputText] = useState<string>('CQ W1AW FN31');
  const [noiseModel, setNoiseModel] = useState<'BSC' | 'AWGN'>('BSC');
  const [errorCount, setErrorCount] = useState<number>(8);
  const [snrDb, setSnrDb] = useState<number>(-22);
  const [maxIterations, setMaxIterations] = useState<number>(30);

  // Encode input message
  const encodeResult: LdpcEncodeResult = useMemo(() => {
    const packed = packZ30Message(inputText);
    const payload63 = packed.infoBits.slice(0, 63);
    return ldpcCodec.encode(payload63);
  }, [inputText]);

  // Channel simulation state
  const [channelData, setChannelData] = useState<{
    corruptedBits: number[];
    llrChannel: Float32Array;
    bitFlips: number[];
  } | null>(null);

  // Decode result state
  const [decodeResult, setDecodeResult] = useState<LdpcDecodeResult | null>(null);

  if (!isOpen) return null;

  // Run Noise Injection
  const handleCorruptChannel = () => {
    const corrupted = ldpcCodec.corruptCodeword(
      encodeResult.codeword,
      errorCount,
      noiseModel,
      snrDb
    );
    setChannelData(corrupted);
    setDecodeResult(null);
  };

  // Run Min-Sum BP Decoder
  const handleRunDecoder = () => {
    let llrToDecode: Float32Array;
    if (channelData) {
      llrToDecode = channelData.llrChannel;
    } else {
      // Default BSC corruption
      const corrupted = ldpcCodec.corruptCodeword(encodeResult.codeword, errorCount, noiseModel, snrDb);
      setChannelData(corrupted);
      llrToDecode = corrupted.llrChannel;
    }

    const res = ldpcCodec.decodeMinSum(llrToDecode, maxIterations);
    setDecodeResult(res);
  };

  const handleReset = () => {
    setChannelData(null);
    setDecodeResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-mono select-none" id="z30-ldpc-lab-modal">
      <div className="bg-[#141414] border border-[#333] w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0F0F0F] border-b border-[#333]">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-[#00FF41]" />
            <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
              Systematic IRA (216, 77) LDPC Codec & Min-Sum BP Testbench
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-4 flex-1 overflow-y-auto text-xs space-y-4 bg-[#0F0F0F]">
          {/* Theoretical Specifications Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-[#050505] p-2.5 border border-[#333] text-[11px]">
            <div>
              <span className="text-[9px] text-[#888] uppercase block">CODE LENGTH (n)</span>
              <span className="font-bold text-[#00FF41]">216 Bits (54 16-MFSK)</span>
            </div>
            <div>
              <span className="text-[9px] text-[#888] uppercase block">INFO BITS (k)</span>
              <span className="font-bold text-cyan-400">77 Bits (63 Data + 14 CRC)</span>
            </div>
            <div>
              <span className="text-[9px] text-[#888] uppercase block">PARITY CHECKS (m)</span>
              <span className="font-bold text-purple-400">139 Accumulator Checks</span>
            </div>
            <div>
              <span className="text-[9px] text-[#888] uppercase block">CODE RATE (R)</span>
              <span className="font-bold text-yellow-400">R = 0.3564 (77/216)</span>
            </div>
            <div>
              <span className="text-[9px] text-[#888] uppercase block">DECODER SCALING</span>
              <span className="font-bold text-emerald-400">Min-Sum α = 0.75</span>
            </div>
          </div>

          {/* Step 1: Systematic Message Encoding */}
          <div className="bg-[#141414] border border-[#333] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="w-5 h-5 bg-[#00FF41] text-black font-bold flex items-center justify-center text-xs">1</span>
                <span className="text-xs font-bold text-[#D4D4D4] uppercase">Message Packing & Systematic IRA Encoding</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setInputText(['CQ JA1ABC PM95', 'W1AW JA1ABC -12', 'JA1ABC W1AW R-15', 'JA1ABC W1AW 73'][Math.floor(Math.random() * 4)])}
                  className="flex items-center space-x-1 px-2 py-0.5 bg-[#1A1A1A] hover:bg-[#262626] border border-[#333] text-[10px] text-[#888] hover:text-[#D4D4D4]"
                >
                  <Shuffle className="w-2.5 h-2.5" />
                  <span>Random QSO Macro</span>
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 bg-[#050505] border border-[#333] px-2.5 py-1 text-xs text-[#00FF41] font-bold focus:border-[#00FF41]"
                placeholder="Enter standard amateur radio message (e.g. CQ W1AW FN31)"
              />
              <span className="text-[#888] text-[11px]">
                CRC-14: <strong className="text-cyan-400">0x{encodeResult.crc14.toString(16).toUpperCase().padStart(4, '0')}</strong>
              </span>
            </div>

            {/* Systematic Bits Breakdown Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-[#888]">
                <span>Information Payload (63 Bits)</span>
                <span>CRC-14 (14 Bits)</span>
                <span>Dual-Diagonal Parity Checks (139 Bits)</span>
              </div>
              <div className="flex h-3 w-full border border-[#333] overflow-hidden">
                <div className="bg-cyan-500/80 h-full" style={{ width: `${(63 / 216) * 100}%` }} title="63 Payload Bits" />
                <div className="bg-yellow-500/80 h-full" style={{ width: `${(14 / 216) * 100}%` }} title="14-bit CRC-14" />
                <div className="bg-purple-500/80 h-full" style={{ width: `${(139 / 216) * 100}%` }} title="139 Parity Bits" />
              </div>
            </div>

            {/* Codeword Bitstream Preview */}
            <div className="bg-[#050505] p-2 border border-[#262626] font-mono text-[10px] break-all leading-relaxed max-h-16 overflow-y-auto">
              <span className="text-[#888] block mb-0.5 text-[9px] uppercase font-bold">216-Bit Systematic Codeword (c = [u | p]):</span>
              <span className="text-cyan-400">{encodeResult.payloadBits.join('')}</span>
              <span className="text-yellow-400 font-bold">{encodeResult.crcBits.join('')}</span>
              <span className="text-purple-400">{encodeResult.parityBits.join('')}</span>
            </div>
          </div>

          {/* Step 2: Channel Noise & Bit Corruption Simulation */}
          <div className="bg-[#141414] border border-[#333] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="w-5 h-5 bg-yellow-400 text-black font-bold flex items-center justify-center text-xs">2</span>
                <span className="text-xs font-bold text-[#D4D4D4] uppercase">RF Channel Corruption & Log-Likelihood Ratio (LLR) Generation</span>
              </div>

              <button
                onClick={handleCorruptChannel}
                className="flex items-center space-x-1 px-2.5 py-1 bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-xs"
              >
                <Zap className="w-3 h-3" />
                <span>Inject Noise</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-[#888] block">CHANNEL MODEL</label>
                <select
                  value={noiseModel}
                  onChange={(e) => setNoiseModel(e.target.value as 'BSC' | 'AWGN')}
                  className="w-full bg-[#050505] border border-[#333] px-2 py-1 text-xs text-[#D4D4D4]"
                >
                  <option value="BSC">Binary Symmetric Channel (BSC Bit Flips)</option>
                  <option value="AWGN">AWGN BPSK Channel (Soft LLRs)</option>
                </select>
              </div>

              {noiseModel === 'BSC' ? (
                <div>
                  <label className="text-[10px] text-[#888] block">BIT FLIP ERRORS: {errorCount} Bits</label>
                  <input
                    type="range"
                    min="1"
                    max="28"
                    value={errorCount}
                    onChange={(e) => setErrorCount(Number(e.target.value))}
                    className="w-full h-1 bg-[#333] accent-yellow-400 cursor-pointer"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-[#888] block">CHANNEL SNR: {snrDb} dB</label>
                  <input
                    type="range"
                    min="-30"
                    max="-10"
                    value={snrDb}
                    onChange={(e) => setSnrDb(Number(e.target.value))}
                    className="w-full h-1 bg-[#333] accent-yellow-400 cursor-pointer"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] text-[#888] block">MAX BP ITERATIONS: {maxIterations}</label>
                <input
                  type="range"
                  min="5"
                  max="60"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Number(e.target.value))}
                  className="w-full h-1 bg-[#333] accent-[#00FF41] cursor-pointer"
                />
              </div>
            </div>

            {channelData && (
              <div className="bg-[#050505] p-2 border border-[#262626] text-[10px]">
                <span className="text-yellow-400 font-bold">
                  Injected {channelData.bitFlips.length} bit errors across 216 channel bits:
                </span>{' '}
                <span className="text-[#888]">
                  [Indices: {channelData.bitFlips.slice(0, 12).join(', ')}{channelData.bitFlips.length > 12 ? '...' : ''}]
                </span>
              </div>
            )}
          </div>

          {/* Step 3: Normalized Min-Sum Belief Propagation Decoding */}
          <div className="bg-[#141414] border border-[#333] p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="w-5 h-5 bg-purple-400 text-black font-bold flex items-center justify-center text-xs">3</span>
                <span className="text-xs font-bold text-[#D4D4D4] uppercase">Iterative Normalized Min-Sum Decoder Execution</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  id="run-min-sum-btn"
                  onClick={handleRunDecoder}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-[#00FF41] hover:bg-[#00e63a] text-black font-bold text-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-black" />
                  <span>Execute Min-Sum BP Decoder</span>
                </button>
                <button
                  onClick={handleReset}
                  className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333]"
                  title="Reset Decoder State"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {decodeResult && (
              <div className="space-y-3">
                {/* Status Callout */}
                <div
                  className={`p-3 border flex items-center justify-between ${
                    decodeResult.success
                      ? 'bg-[#00FF41]/10 border-[#00FF41] text-[#00FF41]'
                      : 'bg-red-950/20 border-red-800 text-red-400'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-bold text-xs">
                    {decodeResult.success ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-[#00FF41]" />
                        <span>DECODE SUCCESS: Converged in {decodeResult.iterations} BP iterations with zero syndrome error!</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span>DECODE INCOMPLETE: Reached max {decodeResult.iterations} iterations (Syndrome weight: {decodeResult.syndromeWeight})</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 text-[10px]">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>CRC-14: <strong>{decodeResult.crcValid ? 'PASSED' : 'FAILED'}</strong></span>
                  </div>
                </div>

                {/* Iteration Convergence Table */}
                <div className="bg-[#050505] p-2 border border-[#333] max-h-36 overflow-y-auto">
                  <div className="text-[10px] text-[#888] font-bold uppercase mb-1 flex justify-between">
                    <span>Iteration Convergence Trace</span>
                    <span>Early stopping condition: s = H * c^T == 0</span>
                  </div>
                  <table className="w-full text-left text-[10px]">
                    <thead>
                      <tr className="border-b border-[#222] text-[#888]">
                        <th className="py-0.5">Iter</th>
                        <th className="py-0.5">Syndrome Weight (s)</th>
                        <th className="py-0.5">Avg |LLR|</th>
                        <th className="py-0.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1A1A1A]">
                      {decodeResult.iterationHistory.map((h) => (
                        <tr key={h.iteration} className={h.syndromeWeight === 0 ? 'text-[#00FF41] font-bold' : 'text-[#D4D4D4]'}>
                          <td className="py-0.5">{h.iteration}</td>
                          <td className="py-0.5">{h.syndromeWeight} check failures</td>
                          <td className="py-0.5">{h.avgLlrMagnitude}</td>
                          <td className="py-0.5">
                            {h.syndromeWeight === 0 ? (
                              <span className="px-1 bg-[#00FF41]/20 text-[#00FF41] text-[9px]">CONVERGED</span>
                            ) : (
                              <span className="text-[#666]">Iterating...</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-[#0F0F0F] border-t border-[#333] flex justify-between items-center text-[10px] text-[#888]">
          <span>z-30 DSP Specification • IRA (216, 77) LDPC Codec Engine</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D4] border border-[#333]"
          >
            Close Lab
          </button>
        </div>
      </div>
    </div>
  );
};
