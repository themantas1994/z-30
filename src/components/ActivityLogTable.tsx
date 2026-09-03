/**
 * Band Activity & Multi-Signal LDPC/SIC Decoded Messages Table
 */

import React, { useState, useMemo, useEffect } from 'react';
import { DecodedSignal } from '../types/z30';
import { apTag } from '../dsp/apDecode';
import { Radio, Sparkles, Search, Trash2, ArrowUpRight, ShieldCheck, Zap } from 'lucide-react';

interface ActivityLogTableProps {
  decodes: DecodedSignal[];
  myCall: string;
  filterType?: 'ALL' | 'CQ' | 'MYCALL' | 'SIC';
  onFilterChange?: (tab: 'ALL' | 'CQ' | 'MYCALL' | 'SIC') => void;
  onSelectSignal: (signal: DecodedSignal) => void;
  onClearHistory: () => void;
}

export const ActivityLogTable: React.FC<ActivityLogTableProps> = ({
  decodes,
  myCall,
  filterType: controlledFilterType,
  onFilterChange,
  onSelectSignal,
  onClearHistory,
}) => {
  const [internalFilterType, setInternalFilterType] = useState<'ALL' | 'CQ' | 'MYCALL' | 'SIC'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(Date.now());

  // 1-second clock tick to auto-age out decoded signals after 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const filterType = controlledFilterType !== undefined ? controlledFilterType : internalFilterType;

  const handleSetFilter = (newFilter: 'ALL' | 'CQ' | 'MYCALL' | 'SIC') => {
    if (onFilterChange) {
      onFilterChange(newFilter);
    }
    setInternalFilterType(newFilter);
  };

  const filteredDecodes = useMemo(() => {
    const upperMyCall = myCall.toUpperCase().trim();
    const cutoff = currentTimeMs - 60000; // 60 seconds maximum age

    return decodes.filter((item) => {
      // 60-second age out filter
      if (item.receivedAtMs && item.receivedAtMs < cutoff) {
        return false;
      }

      // Tab filter
      if (filterType === 'CQ' && !item.isCq) return false;
      if (filterType === 'MYCALL') {
        const isAddressedToUs =
          item.isMyCall ||
          item.callTo === upperMyCall ||
          item.message.startsWith(`${upperMyCall} `) ||
          item.message.includes(` ${upperMyCall} `) ||
          item.message.endsWith(` ${upperMyCall}`);
        if (!isAddressedToUs) return false;
      }
      if (filterType === 'SIC' && item.sicPass === 1) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesMsg = item.message.toLowerCase().includes(q);
        const matchesFreq = item.freq.toString().includes(q);
        const matchesGrid = item.grid?.toLowerCase().includes(q);
        if (!matchesMsg && !matchesFreq && !matchesGrid) return false;
      }
      return true;
    });
  }, [decodes, filterType, searchQuery, myCall, currentTimeMs]);

  const getSnrBadge = (snr: number) => {
    if (snr >= -10) return 'bg-[#00FF41]/15 text-[#00FF41] border-[#00FF41]/40';
    if (snr >= -20) return 'bg-cyan-950/60 text-cyan-300 border-cyan-800';
    if (snr >= -26) return 'bg-yellow-950/60 text-yellow-300 border-yellow-800';
    return 'bg-purple-950/80 text-purple-300 border-purple-700 font-bold animate-pulse';
  };

  const getSicPassBadge = (pass: number) => {
    if (pass === 1) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-mono bg-[#1A1A1A] text-[#888] border border-[#333]">
          P1 Direct
        </span>
      );
    }
    if (pass === 2) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-700">
          <Sparkles className="w-2.5 h-2.5 mr-1" />
          P2 SIC
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-mono bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-700">
        <Zap className="w-2.5 h-2.5 mr-1" />
        P3 Deep
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] border border-[#333] overflow-hidden font-mono" id="activity-log-card">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#0F0F0F] border-b border-[#333] gap-2">
        <div className="flex items-center space-x-2">
          <Radio className="w-3.5 h-3.5 text-[#00FF41]" />
          <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider">
            Band Activity & Decodes ({filteredDecodes.length})
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1">
          <button
            id="filter-all-btn"
            onClick={() => handleSetFilter('ALL')}
            className={`px-2 py-0.5 text-[11px] font-bold uppercase transition-colors ${
              filterType === 'ALL' ? 'bg-[#00FF41] text-black' : 'bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333]'
            }`}
          >
            All
          </button>
          <button
            id="filter-cq-btn"
            onClick={() => handleSetFilter('CQ')}
            className={`px-2 py-0.5 text-[11px] font-bold uppercase transition-colors ${
              filterType === 'CQ' ? 'bg-[#00FF41] text-black' : 'bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333]'
            }`}
          >
            CQ Only
          </button>
          <button
            id="filter-mycall-btn"
            onClick={() => handleSetFilter('MYCALL')}
            className={`px-2 py-0.5 text-[11px] font-bold uppercase transition-colors ${
              filterType === 'MYCALL' ? 'bg-yellow-500 text-black shadow-[0_0_8px_rgba(234,179,8,0.4)]' : 'bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333]'
            }`}
          >
            My Call ({myCall})
          </button>
          <button
            id="filter-sic-btn"
            onClick={() => handleSetFilter('SIC')}
            className={`px-2 py-0.5 text-[11px] font-bold uppercase transition-colors ${
              filterType === 'SIC' ? 'bg-purple-600 text-white' : 'bg-[#1A1A1A] text-[#888] hover:text-[#D4D4D4] border border-[#333]'
            }`}
          >
            SIC Extracted
          </button>
        </div>

        {/* Search & Clear */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-2 text-[#666]" />
            <input
              id="activity-search-input"
              type="text"
              placeholder="Search call, grid..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#050505] border border-[#333] pl-7 pr-2 py-0.5 text-xs text-[#D4D4D4] placeholder-[#666] focus:outline-none focus:border-[#00FF41] w-36"
            />
          </div>

          <button
            id="activity-clear-btn"
            onClick={onClearHistory}
            title="Clear decodes"
            className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333]"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-y-auto text-xs select-text bg-[#0F0F0F]">
        {filteredDecodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#666] space-y-2">
            <Radio className="w-8 h-8 opacity-40 animate-pulse text-[#00FF41]" />
            <p className="text-xs">Listening on 30s synchronous UTC cycle...</p>
            <p className="text-[11px] text-[#555]">Double-click any decoded signal to arm QSO auto-sequencing.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse" id="activity-decodes-table">
            <thead className="bg-[#050505] sticky top-0 border-b border-[#333] text-[11px] text-[#888]">
              <tr>
                <th className="py-1 px-2.5 font-medium">UTC</th>
                <th className="py-1 px-2 font-medium">SNR</th>
                <th className="py-1 px-2 font-medium">DT</th>
                <th className="py-1 px-2 font-medium">Audio Freq</th>
                <th className="py-1 px-2 font-medium">SIC</th>
                <th className="py-1 px-3 font-medium">Decoded Payload</th>
                <th className="py-1 px-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {filteredDecodes.map((d) => {
                const isTarget = d.isMyCall;
                const isCq = d.isCq;

                return (
                  <tr
                    key={d.id}
                    onDoubleClick={() => onSelectSignal(d)}
                    className={`hover:bg-[#1A1A1A] transition-colors cursor-pointer group ${
                      isTarget
                        ? 'bg-yellow-950/20'
                        : isCq
                        ? 'bg-[#00FF41]/5'
                        : ''
                    }`}
                  >
                    {/* Timestamp */}
                    <td className="py-1 px-2.5 text-[#666] text-[11px] whitespace-nowrap">
                      {d.timestamp}
                    </td>

                    {/* SNR */}
                    <td className="py-1 px-2 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.2 text-[10px] font-bold border ${getSnrBadge(d.snr)}`}>
                        {d.snr >= 0 ? `+0${d.snr}` : d.snr} dB
                      </span>
                    </td>

                    {/* DT */}
                    <td className="py-1 px-2 text-[#888] whitespace-nowrap">
                      {d.dt >= 0 ? `+${d.dt.toFixed(1)}` : d.dt.toFixed(1)}
                    </td>

                    {/* Frequency */}
                    <td className="py-1 px-2 text-cyan-400 font-semibold whitespace-nowrap">
                      {d.freq} Hz
                    </td>

                    {/* SIC Pass */}
                    <td className="py-1 px-2 whitespace-nowrap">
                      {getSicPassBadge(d.sicPass)}
                    </td>

                    {/* Payload Message */}
                    <td className="py-1 px-3">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`font-semibold tracking-wide ${
                            isTarget
                              ? 'text-yellow-400 font-bold'
                              : isCq
                              ? 'text-[#00FF41]'
                              : 'text-[#D4D4D4]'
                          }`}
                        >
                          {d.message}
                        </span>
                        {/*
                          A frame recovered by assuming what must be in it is a weaker claim
                          than one decoded from the air alone, so it is labelled rather than
                          shown identically. WSJT-X prints its `iaptype` for the same reason.
                        */}
                        {!!d.apType && (
                          <span
                            className="text-[10px] font-bold text-amber-400 border border-amber-400/40 px-1"
                            title={`Recovered with a priori information: ${d.apLabel || `type ${d.apType}`}`}
                          >
                            {apTag(d.apType)}
                          </span>
                        )}
                        {d.ldpcIterations && (
                          <span className="text-[10px] text-[#666]">
                            ({d.ldpcIterations} iters)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Call Button */}
                    <td className="py-1 px-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSignal(d);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 bg-[#00FF41] text-black font-bold uppercase text-[9px] flex items-center ml-auto"
                      >
                        Call
                        <ArrowUpRight className="w-2.5 h-2.5 ml-0.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom Status bar */}
      <div className="px-3 py-1 bg-[#050505] border-t border-[#333] text-[11px] text-[#888] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-3.5 h-3.5 text-[#00FF41]" />
          <span>Vectorized (216, 77) LDPC & 14-bit CRC Parity Active</span>
        </div>
        <span className="text-[#666]">Double-click row to reply</span>
      </div>
    </div>
  );
};
