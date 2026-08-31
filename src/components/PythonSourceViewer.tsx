/**
 * Python DSP source inspector and exporter.
 *
 * Renders `src/data/pythonSource.ts`, which `npm run generate:python-source` produces from the
 * real `z30_dsp/*.py` files and CI's `check:generated` gate keeps in step with them. The
 * browser cannot read the repository, so the strings are the only way to show an operator the
 * DSP they are running.
 *
 * Two things were wrong with this file. It had **zero references anywhere in src/** - nothing
 * rendered it - so the repository was regenerating and CI-guarding a ~3,000-line artifact that
 * no component displayed, while AGENTS.md documented the viewer as a live feature. And it
 * carried a SECOND benchmark runner on its own MonteCarloSimulationEngine instance, with its
 * own output format: two benchmark UIs over one engine, one of them unreachable. The viewer is
 * now reachable from Station Settings, and the benchmark lives in exactly one place -
 * MonteCarloBenchmarkModal - which is also the only one that can measure a decode threshold
 * rather than a bound.
 */

import React, { useState } from 'react';
import { PYTHON_SOURCE_FILES, PythonFile } from '../data/pythonSource';
import { Code2, Copy, Check, Download, FileCode } from 'lucide-react';

export const PythonSourceViewer: React.FC = () => {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

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

      {/* Code Viewer */}
      <div className="flex-1 overflow-y-auto bg-[#050505] p-3 text-xs text-[#D4D4D4] select-text leading-relaxed">
        {/* Code Content */}
        <pre className="text-[11px] text-[#D4D4D4] whitespace-pre overflow-x-auto">
          <code>{activeFile.code}</code>
        </pre>
      </div>
    </div>
  );
};
