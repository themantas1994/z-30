/**
 * z-30 Band Manager & CAT Preset Tuning Modal
 * Provides interactive band preset configuration, custom frequency persistence,
 * and Hamlib CAT transceiver tuning.
 */

import React, { useState } from 'react';
import { HAM_BANDS, DEFAULT_BANDS } from '../dsp/z30Constants';
import { StationConfig } from '../types/z30';
import { rigctl } from '../dsp/catController';
import { Radio, RotateCcw, Save, X, Cpu } from 'lucide-react';

interface BandManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StationConfig;
  currentBandName: string;
  currentDialFreqHz: number;
  onSelectBandAndFreq: (bandName: string, freqHz: number) => void;
  onSaveConfig: (updatedConfig: StationConfig) => void;
}

export const BandManagerModal: React.FC<BandManagerModalProps> = ({
  isOpen,
  onClose,
  config,
  currentBandName,
  currentDialFreqHz,
  onSelectBandAndFreq,
  onSaveConfig,
}) => {
  // Local state for band frequencies
  const [bandFrequencies, setBandFrequencies] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    HAM_BANDS.forEach((b) => {
      initial[b.name] = config.customBands?.[b.name] || b.dialFreqHz;
    });
    return initial;
  });

  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'info' } | null>(null);

  if (!isOpen) return null;

  const showNotification = (msg: string, type: 'success' | 'info' = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleFrequencyChange = (bandName: string, valStr: string) => {
    const numeric = parseInt(valStr.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(numeric)) {
      setBandFrequencies((prev) => ({
        ...prev,
        [bandName]: numeric,
      }));
    }
  };

  const handleTune = (bandName: string) => {
    const targetHz = bandFrequencies[bandName] || DEFAULT_BANDS[bandName] || 14076000;
    // Set frequency in rigctl
    rigctl.setFreqHz(targetHz);
    rigctl.setBandByName(bandName);
    onSelectBandAndFreq(bandName, targetHz);

    // Save active state to config
    const updated: StationConfig = {
      ...config,
      customBands: bandFrequencies,
    };
    onSaveConfig(updated);

    showNotification(`CAT Tuned to ${bandName} @ ${(targetHz / 1e6).toFixed(6)} MHz`);
  };

  const handleResetBand = (bandName: string) => {
    const defaultHz = DEFAULT_BANDS[bandName] || 14076000;
    setBandFrequencies((prev) => ({
      ...prev,
      [bandName]: defaultHz,
    }));
    showNotification(`Reset ${bandName} to standard ${defaultHz.toLocaleString()} Hz`, 'info');
  };

  const handleResetAll = () => {
    const defaults: Record<string, number> = {};
    HAM_BANDS.forEach((b) => {
      defaults[b.name] = DEFAULT_BANDS[b.name] || b.dialFreqHz;
    });
    setBandFrequencies(defaults);
    const updated: StationConfig = {
      ...config,
      customBands: defaults,
    };
    onSaveConfig(updated);
    showNotification('All 13 bands reset to global z-30 standard presets!', 'info');
  };

  const handleSaveAll = () => {
    const updated: StationConfig = {
      ...config,
      customBands: bandFrequencies,
    };
    onSaveConfig(updated);
    showNotification('Band presets saved to config.json and active profile.');
    setTimeout(() => onClose(), 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 font-mono">
      <div
        className="bg-[#0D0D0D] border border-[#333] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        id="band-manager-modal"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#141414] border-b border-[#2A2A2A]">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-[#00FF41]" />
            <span className="text-sm font-bold text-[#E5E5E5] tracking-wider uppercase">
              Band Manager & Global Presets (`band_manager.py`)
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {notification && (
              <span className="text-[11px] px-2 py-0.5 bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/30 animate-pulse">
                {notification.msg}
              </span>
            )}
            <button
              onClick={onClose}
              className="p-1 text-[#888] hover:text-[#FFF] hover:bg-[#222] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-[#050505] px-4 py-2 border-b border-[#222] flex items-center justify-between text-xs text-[#888]">
          <div>
            Active Band: <strong className="text-cyan-400">{currentBandName}</strong> • Dial Frequency:{' '}
            <strong className="text-[#FACC15]">{(currentDialFreqHz / 1e6).toFixed(6)} MHz</strong>
          </div>
          <div className="flex items-center space-x-1.5 text-[11px] text-[#00FF41]">
            <Cpu className="w-3.5 h-3.5" />
            <span>Hamlib CAT Direct VFO Sync</span>
          </div>
        </div>

        {/* Scrollable Band Table */}
        <div className="p-4 flex-1 overflow-y-auto space-y-2 bg-[#0A0A0A]">
          <div className="text-[11px] text-[#777] mb-2">
            Standard global USB dial frequencies for <strong>z-30</strong> (16-MFSK, 50 Hz occupied bandwidth, 30s synchronous UTC slots).
            Click <strong>Tune CAT</strong> to command the transceiver via Hamlib rigctl.
          </div>

          <div className="border border-[#262626] overflow-hidden bg-[#0F0F0F]">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-[#141414] text-[#888] border-b border-[#262626] text-[10px] uppercase">
                  <th className="py-2 px-3 font-bold">Band</th>
                  <th className="py-2 px-3 font-bold">Dial Frequency (Hz)</th>
                  <th className="py-2 px-3 font-bold">Frequency (MHz)</th>
                  <th className="py-2 px-3 font-bold">Default z-30</th>
                  <th className="py-2 px-3 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F1F1F]">
                {HAM_BANDS.map((band) => {
                  const isCurrent = band.name === currentBandName;
                  const currentHz = bandFrequencies[band.name] ?? band.dialFreqHz;
                  const defaultHz = DEFAULT_BANDS[band.name] ?? band.dialFreqHz;
                  const isModified = currentHz !== defaultHz;

                  return (
                    <tr
                      key={band.name}
                      className={`hover:bg-[#141414] transition-colors ${
                        isCurrent ? 'bg-[#00FF41]/5' : ''
                      }`}
                    >
                      {/* Band Name */}
                      <td className="py-2 px-3">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`font-bold text-xs ${
                              isCurrent ? 'text-[#00FF41]' : 'text-[#E5E5E5]'
                            }`}
                          >
                            {band.name}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] px-1 py-0.2 bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/40 uppercase font-bold">
                              ACTIVE
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Freq Input in Hz */}
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={currentHz}
                          onChange={(e) => handleFrequencyChange(band.name, e.target.value)}
                          className={`bg-[#050505] border px-2 py-1 text-xs w-32 font-mono focus:outline-none focus:border-[#00FF41] ${
                            isModified
                              ? 'border-yellow-500/60 text-yellow-300'
                              : 'border-[#333] text-[#FACC15]'
                          }`}
                        />
                      </td>

                      {/* MHz Readout */}
                      <td className="py-2 px-3 text-[#AAA]">
                        {(currentHz / 1e6).toFixed(6)} MHz
                      </td>

                      {/* Default Readout */}
                      <td className="py-2 px-3 text-[#666] text-[11px]">
                        {(defaultHz / 1e6).toFixed(6)} MHz
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleTune(band.name)}
                            title={`Tune transceiver to ${band.name} via Hamlib`}
                            className={`px-2.5 py-1 text-[11px] font-bold uppercase transition-all flex items-center space-x-1 ${
                              isCurrent
                                ? 'bg-[#00FF41] text-black shadow-[0_0_8px_rgba(0,255,65,0.4)]'
                                : 'bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#00FF41] border border-[#00FF41]/40'
                            }`}
                          >
                            <span>Tune CAT</span>
                          </button>

                          {isModified && (
                            <button
                              type="button"
                              onClick={() => handleResetBand(band.name)}
                              title="Reset this band to standard z-30 default frequency"
                              className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#CCC] border border-[#333]"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#141414] border-t border-[#2A2A2A]">
          <button
            type="button"
            onClick={handleResetAll}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#1F1F1F] hover:bg-[#292929] text-red-400 border border-red-900/50 text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset All to Defaults</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-[#1F1F1F] hover:bg-[#292929] text-[#D4D4D4] border border-[#333] text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              className="flex items-center space-x-1.5 px-4 py-1.5 bg-[#00FF41] hover:bg-[#00E53A] text-black font-bold text-xs uppercase shadow-[0_0_10px_rgba(0,255,65,0.3)] transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save & Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
