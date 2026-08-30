/**
 * Python 3.10+ Source Code Inspector, Interactive Benchmark & Exporter
 */

import React, { useState } from 'react';
import { PYTHON_SOURCE_FILES, PythonFile } from '../data/pythonSource';
import { Code2, Copy, Check, Download, Play, Terminal, FileCode } from 'lucide-react';
import { MonteCarloSimulationEngine } from '../dsp/monteCarloEngine';

export const PythonSourceViewer: React.FC = () => {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);
  const [benchmarkOutput, setBenchmarkOutput] = useState<string | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState<boolean>(false);

  const activeFile: PythonFile = PYTHON_SOURCE_FILES[selectedFileIdx] || PYTHON_SOURCE_FILES[0];

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([activeFile.code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    // Generate combined bundle
    let bundle = `"""\nz-30 Amateur Radio Digital Mode Python 3.10+ Engineering Package\n16-MFSK / 50 Hz Bandwidth / 30s Sync Cycle / LDPC + SIC\n"""\n\n`;
    PYTHON_SOURCE_FILES.forEach(f => {
      bundle += `\n# =========================================================\n# FILE: ${f.path}\n# =========================================================\n\n${f.code}\n`;
    });
    const blob = new Blob([bundle], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'z30_full_dsp_suite.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runBenchmarkAnalysis = async () => {
    setIsRunningBenchmark(true);
    setBenchmarkOutput('Initializing Monte Carlo testbench: synthesizing continuous-phase 16-MFSK frames...\nInjecting calibrated AWGN across SNR grid and running Normalized Min-Sum LDPC (216, 77) decoding...\n\n');

    try {
      const engine = new MonteCarloSimulationEngine();
      const snrPoints = [-30.0, -28.0, -26.0, -25.0, -24.0, -23.0, -22.0, -20.0];
      const framesPerPoint = 20;

      let out = `=========================================================================\n`;
      out += `   z-30 EMPIRICAL MONTE CARLO DSP & LDPC BENCHMARK (LIVE EXECUTION)      \n`;
      out += `=========================================================================\n`;
      out += `Channel: AWGN (2500 Hz Ref BW) | FEC: Systematic (216, 77) IRA LDPC\n`;
      out += `Frames per SNR point: ${framesPerPoint} | Decoder: Normalized Min-Sum BP (alpha=0.75)\n`;
      out += `-------------------------------------------------------------------------\n`;
      out += `SNR (dB)    | Tested | Success | FER      | Decode % | Raw BER  | Avg Iters\n`;
      out += `-------------------------------------------------------------------------\n`;

      for (const snr of snrPoints) {
        setBenchmarkOutput((prev) => prev + `Testing SNR: ${snr >= 0 ? '+' : ''}${snr.toFixed(1)} dB (running ${framesPerPoint} physical frames)...\n`);
        
        const ptResults = await engine.runSimulation({
          minSnrDb: snr,
          maxSnrDb: snr,
          snrStepDb: 1.0,
          framesPerPoint: framesPerPoint,
          sampleRateHz: 6000,
          audioCenterFreqHz: 1250,
          channelModel: 'AWGN',
          simulationMode: 'MATCHED_FILTER_CORRELATOR_BANK',
          maxLdpcIterations: 45,
          alphaMinSum: 0.75,
        });

        if (ptResults.length > 0) {
          const r = ptResults[0];
          const snrStr = `${r.snrDb >= 0 ? '+' : ''}${r.snrDb.toFixed(1)} dB`.padEnd(11);
          const framesStr = `${r.totalFrames}`.padStart(6);
          const succStr = `${r.successCount}`.padStart(7);
          const ferStr = `${r.frameErrorRate.toFixed(4)}`.padStart(8);
          const decStr = `${r.decodeSuccessRate.toFixed(1)}%`.padStart(8);
          const berStr = `${(r.rawChannelBer * 100).toFixed(1)}%`.padStart(8);
          const iterStr = `${r.avgLdpcIterations.toFixed(1)}`.padStart(9);
          out += `${snrStr} | ${framesStr} | ${succStr} | ${ferStr} | ${decStr} | ${berStr} | ${iterStr}\n`;
        }
      }

      out += `=========================================================================\n`;
      out += `[COMPLETED] Empirical Monte Carlo benchmark finished.\n`;
      out += `All results above are derived from live, real-time LDPC decodes and calibrated noise.\n`;

      setBenchmarkOutput(out);
    } catch (err) {
      setBenchmarkOutput((prev) => prev + `\n[ERROR] Benchmark execution failed: ${err}\n`);
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono" id="python-source-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333] gap-2">
        <div className="flex items-center space-x-2">
          <Code2 className="w-3.5 h-3.5 text-[#00FF41]" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            Python 3.10+ DSP Source Engine & Exporter
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            id="run-benchmark-btn"
            onClick={runBenchmarkAnalysis}
            disabled={isRunningBenchmark}
            className="flex items-center space-x-1 px-2 py-0.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold uppercase"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{isRunningBenchmark ? 'Calculating...' : 'BER Performance Specs'}</span>
          </button>

          <button
            id="copy-python-btn"
            onClick={handleCopyCode}
            className="flex items-center space-x-1 px-2 py-0.5 bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D4] border border-[#333] text-xs font-bold uppercase"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#00FF41]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            id="download-file-btn"
            onClick={handleDownloadFile}
            className="flex items-center space-x-1 px-2 py-0.5 bg-[#1A1A1A] hover:bg-[#262626] text-cyan-400 border border-cyan-800 text-xs font-bold uppercase"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .py</span>
          </button>

          <button
            id="download-all-btn"
            onClick={handleDownloadAll}
            className="flex items-center space-x-1 px-2 py-0.5 bg-[#00FF41] text-black font-bold uppercase text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Suite</span>
          </button>
        </div>
      </div>

      {/* File Navigation Tabs */}
      <div className="flex items-center space-x-1 px-3 py-1 bg-[#050505] border-b border-[#333] overflow-x-auto text-xs">
        {PYTHON_SOURCE_FILES.map((file, idx) => {
          const isSelected = idx === selectedFileIdx;
          return (
            <button
              key={file.filename}
              onClick={() => setSelectedFileIdx(idx)}
              className={`flex items-center space-x-1.5 px-2.5 py-0.5 transition-colors whitespace-nowrap text-[11px] font-bold ${
                isSelected
                  ? 'bg-[#141414] text-[#00FF41] border-t-2 border-t-[#00FF41] border-x border-[#333]'
                  : 'text-[#888] hover:text-[#D4D4D4]'
              }`}
            >
              <FileCode className="w-3 h-3 text-[#666]" />
              <span>{file.filename}</span>
            </button>
          );
        })}
      </div>

      {/* File Description Header */}
      <div className="px-3 py-1 bg-[#0F0F0F] border-b border-[#333] text-[10px] text-[#888] flex items-center justify-between">
        <span>Path: <strong className="text-cyan-400">{activeFile.path}</strong></span>
        <span className="text-[#666] truncate max-w-md">{activeFile.description}</span>
      </div>

      {/* Code Viewer & Benchmark Panel */}
      <div className="flex-1 overflow-y-auto bg-[#050505] p-3 text-xs text-[#D4D4D4] select-text leading-relaxed">
        {benchmarkOutput && (
          <div className="mb-4 bg-[#0F0F0F] border border-purple-800 p-3 text-purple-200 text-[11px] relative">
            <button
              onClick={() => setBenchmarkOutput(null)}
              className="absolute top-2 right-2 text-[#888] hover:text-[#D4D4D4] text-xs px-1.5 py-0.5 bg-[#1A1A1A] border border-[#333]"
            >
              ✕ Close
            </button>
            <div className="flex items-center space-x-2 text-purple-400 font-bold mb-1 uppercase">
              <Terminal className="w-3.5 h-3.5" />
              <span>Monte Carlo BER Benchmark Execution Result</span>
            </div>
            <pre className="whitespace-pre overflow-x-auto text-[10px] leading-snug text-[#00FF41] bg-[#050505] p-2 border border-[#222]">{benchmarkOutput}</pre>
          </div>
        )}

        {/* Code Content */}
        <pre className="text-[11px] text-[#D4D4D4] whitespace-pre overflow-x-auto">
          <code>{activeFile.code}</code>
        </pre>
      </div>
    </div>
  );
};
