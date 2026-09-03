/**
 * z-30 Monte Carlo Physical Waveform, Calibrated AWGN & Real LDPC Decoder Benchmark Modal
 * ======================================================================================
 * Interactive DSP instrumentation suite for measuring and plotting:
 * - Actual 16-MFSK waveform generation + calibrated Gaussian noise (AWGN in 2500 Hz reference BW)
 * - Real Systematic (216, 77) Normalized Min-Sum LDPC Belief Propagation Decoding
 * - Empirical Frame Error Rate (FER) & Decode Success Probability vs SNR curves
 * - Pre-LDPC raw channel BER vs Post-LDPC residual BER
 * - Average LDPC iteration convergence across user-configured SNR sweeps
 */

import React, { useState, useEffect } from 'react';
import {
  monteCarloEngine,
  MonteCarloConfig,
  DEFAULT_MONTE_CARLO_CONFIG,
  MonteCarloProgress,
  REALISTIC_SWEEP_DEFAULTS,
  IDEAL_SWEEP_DEFAULTS,
  PUBLISHABLE_FRAMES_PER_POINT,
  WILSON_Z_95,
} from '../dsp/monteCarloEngine';
import { DEFAULT_MONTE_CARLO_SEED } from '../dsp/seededRandom';
import { Z30_DECODE_SCHEDULES, LDPC_MAX_ITERATIONS } from '../dsp/ldpcCodec';
import {
  X,
  Play,
  Pause,
  Square,
  Activity,
  BarChart2,
  TrendingUp,
  Copy,
  Check,
  RotateCcw,
  ShieldCheck,
  Radio,
  FileSpreadsheet,
  Settings2,
  } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';

/**
 * Per-schedule iteration caps and their total, quoted from the decoder rather than retyped.
 *
 * The same computation z30_dsp/benchmark.py prints in its header: each schedule's own cap,
 * clamped by the decoder's LDPC_MAX_ITERATIONS. A frame that fails runs all four and pays for
 * every one, which is why the total and not the first cap is what bounds an iteration count.
 */
const SCHEDULE_CAPS = Z30_DECODE_SCHEDULES.map((sched) => Math.min(sched.iters, LDPC_MAX_ITERATIONS));
const TOTAL_CASCADE_ITERATIONS = SCHEDULE_CAPS.reduce((sum, cap) => sum + cap, 0);

/**
 * Wilson score interval for a binomial proportion, as percentages.
 *
 * The same arithmetic and the same z as `wilson_interval` in z30_dsp/benchmark.py and
 * `calculateWilsonConfidenceInterval` in the engine. It is repeated here rather than imported
 * from the engine only because this file needs it on counts the engine has already reduced
 * away; `tests/frontend.test.mjs` asserts the two agree to float precision on counts it
 * generates, so the repetition cannot drift into a second rule.
 */
const wilsonIntervalPct = (successes: number, trials: number): [number, number] => {
  if (trials <= 0) return [0, 100];
  const n = trials;
  const phat = successes / n;
  const z2 = WILSON_Z_95 * WILSON_Z_95;
  const denom = 1 + z2 / n;
  const centre = (phat + z2 / (2 * n)) / denom;
  const half = (WILSON_Z_95 * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / denom;
  return [Math.max(0, 100 * (centre - half)), Math.min(100, 100 * (centre + half))];
};

interface MonteCarloBenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MonteCarloBenchmarkModal: React.FC<MonteCarloBenchmarkModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [config, setConfig] = useState<MonteCarloConfig>(DEFAULT_MONTE_CARLO_CONFIG);
  const [progress, setProgress] = useState<MonteCarloProgress>({
    isRunning: false,
    isPaused: false,
    currentSnrIdx: 0,
    totalSnrPoints: 0,
    currentFrameInPoint: 0,
    totalFramesPerPoint: 0,
    overallProgressPercent: 0,
    currentSnrDb: 0,
    currentResults: [],
  });

  const [activeTab, setActiveTab] = useState<'CURVES' | 'FER' | 'BER' | 'WAVEFORM' | 'TABLE'>('CURVES');
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  // Off by default. An FT8 reference line drawn beside an ideal-mode curve invites exactly
  // the comparison wiki/11 records as withdrawn; even beside a realistic curve it is a
  // modelled logistic, not a measurement, so the operator opts in.
  const [includeFt8Comparison, setIncludeFt8Comparison] = useState<boolean>(false);

  // Subscribe to engine progress
  useEffect(() => {
    const unsub = monteCarloEngine.subscribe((p) => {
      setProgress(p);
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const handleStartSimulation = async (customConfig?: Partial<MonteCarloConfig>) => {
    const runCfg = { ...config, ...customConfig };
    setConfig(runCfg);
    try {
      await monteCarloEngine.runSimulation(runCfg);
    } catch (err) {
      console.error('Monte Carlo Simulation Error:', err);
    }
  };

  const handleStopSimulation = () => {
    monteCarloEngine.stop();
  };

  const handleTogglePause = () => {
    if (progress.isPaused) {
      monteCarloEngine.resume();
    } else {
      monteCarloEngine.pause();
    }
  };

  const handleClearResults = () => {
    monteCarloEngine.clearResults();
  };

  // The measured curve, plus the one reference overlay this project allows on the same axes.
  //
  // Two other series used to be computed here and are gone:
  //
  //  - A "Shannon theoretical capacity limit", drawn as `100 * exp(1.8 * (snr + 30.51))` and
  //    ON BY DEFAULT. Shannon's theorem gives a threshold SNR below which no reliable code
  //    exists; it does not give a decode probability, and there is no derivation anywhere in
  //    this repository for that exponential, its 1.8, or its -30.51 dB. It was a curve with a
  //    shape nobody had computed, labelled as a fundamental limit, drawn beside measured
  //    points and enabled without anyone asking for it. AGENTS.md section 5 exists because
  //    this project has already had to retract a comparison that was merely the WRONG measured
  //    number; an unmeasured one is worse.
  //  - An "FT4 reference model" logistic, computed on every render and rendered nowhere. tsc's
  //    noUnusedLocals does not see an unused object property.
  //
  // The FT8 logistic stays, because wiki/16 and AGENTS.md sanction it under conditions this
  // file meets: off by default, opt-in, labelled a modelled logistic rather than a
  // measurement, and marked not-comparable against an ideal-mode run. Its -21.0 dB centre is
  // WSJT-X's published on-air figure; only the slope is modelled, and the tooltip says so.
  const chartData = progress.currentResults.map((r) => {
    const ft8Prob = Number((100.0 / (1.0 + Math.exp(-1.4 * (r.snrDb - -21.0)))).toFixed(1));

    return {
      snrDb: r.snrDb,
      snrLabel: `${r.snrDb > 0 ? '+' : ''}${r.snrDb} dB`,
      z30DecodePct: r.decodeSuccessRate,
      z30Fer: r.frameErrorRate,
      z30FerLog: r.frameErrorRate > 0 ? Math.max(1e-4, r.frameErrorRate) : 1e-4,
      ciLower: r.confidenceInterval95[0],
      ciUpper: r.confidenceInterval95[1],
      ft8DecodePct: ft8Prob,
      rawBer: Number((r.rawChannelBer * 100).toFixed(2)),
      postBer: Number((r.postLdpcBer * 100).toFixed(3)),
      avgIters: r.avgLdpcIterations,
      totalFrames: r.totalFrames,
      successes: r.successCount,
      failures: r.failureCount,
    };
  });

  /**
   * Linear interpolation of the SNR at which a decode-percentage curve crosses `targetPct`.
   *
   * `curve` is (snrDb, decodePct) in sweep order. This used to report the first grid point
   * already at or above the target, which quantises the answer to snrStepDb - a full 1.0 dB by
   * default - and makes it incomparable with the Python benchmark, whose worked example in
   * wiki/16 interpolates (its AWGN 50% crossing interpolates to -22.92 dB). Returns null when
   * the curve never crosses, rather than reporting an endpoint as if it were a crossing.
   *
   * The twin of `_crossing_db` in z30_dsp/benchmark.py; `tests/frontend.test.mjs` asserts the
   * two agree on curves it generates rather than leaving that to inspection.
   */
  const interpolateCrossing = (
    curve: { snrDb: number; decodePct: number }[],
    targetPct: number
  ): number | null => {
    for (let i = 1; i < curve.length; i++) {
      const lo = curve[i - 1];
      const hi = curve[i];
      if (lo.decodePct < targetPct && hi.decodePct >= targetPct) {
        const span = hi.decodePct - lo.decodePct;
        if (span <= 0) return hi.snrDb;
        const frac = (targetPct - lo.decodePct) / span;
        return lo.snrDb + frac * (hi.snrDb - lo.snrDb);
      }
    }
    // The very first point may already be above the target - then the crossing is off the
    // bottom of the sweep and we do not know where it is.
    return null;
  };

  /**
   * The crossing, and the SNR range the sample supports for it.
   *
   * The band is `decode_threshold_interval_db`'s, ported: the upper Wilson bound of every
   * point makes the most optimistic curve the counts allow and crosses at the lowest (best)
   * SNR; the lower bounds make the most pessimistic curve and cross highest. This modal used
   * to print a bare crossing to two decimal places off as few as 25 frames a point, which is
   * the precision claim AGENTS.md section 5 says not to make - and the Python instrument has
   * printed the pair beside every crossing since before this run existed.
   */
  const crossingWithBand = (targetPct: number) => {
    const pts = progress.currentResults;
    const measured = pts.map((r) => ({ snrDb: r.snrDb, decodePct: r.decodeSuccessRate }));
    const optimistic = pts.map((r) => ({
      snrDb: r.snrDb,
      decodePct: wilsonIntervalPct(r.successCount, r.totalFrames)[1],
    }));
    const pessimistic = pts.map((r) => ({
      snrDb: r.snrDb,
      decodePct: wilsonIntervalPct(r.successCount, r.totalFrames)[0],
    }));
    return {
      point: interpolateCrossing(measured, targetPct),
      low: interpolateCrossing(optimistic, targetPct),
      high: interpolateCrossing(pessimistic, targetPct),
    };
  };

  const crossing50 = crossingWithBand(50);
  const crossing90 = crossingWithBand(90);
  const snr50Threshold = crossing50.point;
  const snr90Threshold = crossing90.point;
  /** `[-23.07, -22.79]`, or a note that the band runs off the end of the sweep. */
  const bandLabel = (c: { low: number | null; high: number | null }): string =>
    c.low !== null && c.high !== null
      ? `[${c.low.toFixed(2)}, ${c.high.toFixed(2)}]`
      : '[band extends past the swept range]';
  const isExploratory = config.framesPerPoint < PUBLISHABLE_FRAMES_PER_POINT;
  const isRealistic = config.measurementMode === 'realistic';
  /** What this run is entitled to be called. wiki/16 reserves "threshold" for realistic mode. */
  const resultNoun = isRealistic ? 'Decode Threshold' : 'Genie-Aided Bound';

  const exportCsv = () => {
    if (progress.currentResults.length === 0) return;
    const headers = [
      'SNR_2500Hz_dB',
      'Total_Frames',
      'Decode_Successes',
      'Decode_Failures',
      'FER',
      'Decode_Success_Pct',
      'Raw_Channel_BER',
      'Post_LDPC_BER',
      'Avg_LDPC_Iterations',
      'CI95_Lower_Pct',
      'CI95_Upper_Pct',
      'Elapsed_ms',
      'Acquisition_Failures',
      // The denominator of the three averages above. Exported so a reader of the CSV can
      // reconstruct the raw bit-error counts instead of having to assume one.
      'Demodulated_Frames',
      'Timing_RMS_ms',
      'Freq_RMS_Hz',
    ];
    const rows = progress.currentResults.map((r) => [
      r.snrDb,
      r.totalFrames,
      r.successCount,
      r.failureCount,
      r.frameErrorRate,
      r.decodeSuccessRate,
      r.rawChannelBer,
      r.postLdpcBer,
      r.avgLdpcIterations,
      r.confidenceInterval95[0],
      r.confidenceInterval95[1],
      r.elapsedMs,
      r.acquisitionFailures,
      r.demodulatedFrames,
      r.timingRmsMs,
      r.freqRmsHz,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `z30_empirical_monte_carlo_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyResultsText = () => {
    if (progress.currentResults.length === 0) return;
    let txt = 'z-30 Monte Carlo Physical Waveform & LDPC Decoder Benchmark Results\n';
    txt += '==============================================================================\n';
    // Seed, frame count and mode travel with the numbers or the numbers are unreproducible -
    // AGENTS.md §5. The seed used to be missing from this block entirely, despite
    // MonteCarloConfig.seed's own doc comment asking for it.
    txt += `Measurement mode: ${config.measurementMode.toUpperCase()} (${
      isRealistic
        ? 'random carrier + timing offsets, blind Costas acquisition, receiver-estimated noise floor'
        : 'GENIE-AIDED: exact sigma, carrier and timing handed to the demodulator'
    })\n`;
    txt += `Seed: ${config.seed ?? '(unseeded)'} | Frames/point: ${config.framesPerPoint} | Channel: AWGN (calibrated, 2500 Hz ref)\n`;
    txt += `Sim path: full continuous-phase waveform -> shipped demodulator | Sample rate: ${config.sampleRateHz} Hz | Ref BW: 2500 Hz\n`;
    txt += `FEC: Systematic IRA (216, 77) LDPC | Iteration cap: ${SCHEDULE_CAPS.join(' + ')} = ${TOTAL_CASCADE_ITERATIONS} over ${SCHEDULE_CAPS.length} schedules | Schedules: ${Z30_DECODE_SCHEDULES.map((s) => `${s.mode} a=${s.alpha}/${s.iters}it`).join(' -> ')}\n`;
    if (config.framesPerPoint < PUBLISHABLE_FRAMES_PER_POINT) {
      // The same notice z30_dsp/benchmark.py prints below the same figure, and for the same
      // reason: a crossing interpolated from a handful of frames a point is uncertain by more
      // than the two decimal places it is printed to.
      txt += `EXPLORATORY RUN: ${config.framesPerPoint} frames/point is below the ${PUBLISHABLE_FRAMES_PER_POINT} this\n`;
      txt += '  project requires behind a published figure. Read the intervals, not the crossing.\n';
    }
    if (isRealistic) {
      txt += `Carrier offset: +/-${(config.carrierOffsetHz ?? 5).toFixed(1)} Hz | Timing offset: +/-${(config.timingOffsetSec ?? 0.5).toFixed(2)} s\n`;
    }
    txt += '------------------------------------------------------------------------------\n';
    txt += 'SNR (dB) | Frames | Success | Failed | FER     | Decode % | Raw BER  | Avg Iters\n';
    txt += '------------------------------------------------------------------------------\n';
    for (const r of progress.currentResults) {
      txt += `${(r.snrDb >= 0 ? '+' : '') + r.snrDb.toFixed(1).padEnd(8)} | ${String(r.totalFrames).padEnd(6)} | ${String(r.successCount).padEnd(7)} | ${String(r.failureCount).padEnd(6)} | ${r.frameErrorRate.toFixed(4).padEnd(7)} | ${(r.decodeSuccessRate.toFixed(1) + '%').padEnd(8)} | ${(r.rawChannelBer * 100).toFixed(1)}%     | ${r.avgLdpcIterations.toFixed(1)}\n`;
    }
    txt += '==============================================================================\n';
    // The crossing AND the band the counts support, the way z30_dsp/benchmark.py reports it.
    if (snr50Threshold !== null) {
      txt += `50% ${resultNoun} (interpolated): ${snr50Threshold.toFixed(2)} dB ${bandLabel(crossing50)} (2500 Hz BW)\n`;
    }
    if (snr90Threshold !== null) {
      txt += `90% ${resultNoun} (interpolated): ${snr90Threshold.toFixed(2)} dB ${bandLabel(crossing90)} (2500 Hz BW)\n`;
    }
    txt += 'Brackets are the crossings of the pointwise 95% Wilson band, not an interval on a fitted curve.\n';
    if (!isRealistic) {
      txt += 'NOTE: an ideal-mode figure is a genie-aided BOUND, roughly 2.3 dB optimistic.\n';
      txt += '      Never quote it against another mode\'s published on-air threshold.\n';
    }

    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    // z-[60] rather than z-50: this modal is now launched from inside Station Settings, which
    // stays mounted underneath so the operator does not lose unsaved form state. Equal z-index
    // would leave the stacking order dependent on JSX order alone.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-2 sm:p-4 font-mono select-none">
      <div className="bg-[#101010] border border-[#333] w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-[#0A0A0A] border-b border-[#333]">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-[#141414] border border-[#00FF41]/40 flex items-center justify-center text-[#00FF41]">
              <Activity className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs sm:text-sm font-bold text-[#00FF41] tracking-wider uppercase">
                  z-30 Monte Carlo Benchmark Suite
                </span>
                <span className="text-[9px] px-1.5 py-0.2 bg-purple-950/80 text-purple-300 border border-purple-800 uppercase font-bold">
                  Scientific Rigor • Zero Pre-Baked Data
                </span>
              </div>
              <p className="text-[10px] text-[#888] hidden sm:block">
                Authentic 16-MFSK continuous-phase pulses + calibrated AWGN (2500 Hz Ref BW) + Normalized Min-Sum LDPC (216, 77)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowConfigDrawer(!showConfigDrawer)}
              className={`px-2 py-1 border text-xs flex items-center space-x-1 transition-colors ${
                showConfigDrawer
                  ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500'
                  : 'bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border-[#333]'
              }`}
              title="Configure Simulation Parameters"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase font-bold">Params</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Configuration Drawer (When toggled open) */}
        {showConfigDrawer && (
          <div className="bg-[#121212] border-b border-[#333] p-3 text-xs animate-fadeIn space-y-3">
            {/* The measurement mode comes first because it decides what the run MEANS, not
                just how long it takes. Switching it also moves the sweep range: measured at 200
                frames a point, this engine's two curves sit about 2.3 dB apart, so one range
                cannot bracket both. */}
            <div className="bg-[#0A0A0A] border border-[#333] p-2 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[10px] text-[#888] uppercase">Measurement mode:</span>
                {(['realistic', 'ideal'] as const).map((m) => (
                  <label key={m} className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="measurement-mode"
                      checked={config.measurementMode === m}
                      disabled={progress.isRunning}
                      onChange={() => {
                        const range = m === 'realistic' ? REALISTIC_SWEEP_DEFAULTS : IDEAL_SWEEP_DEFAULTS;
                        setConfig({ ...config, measurementMode: m, ...range });
                      }}
                      className="accent-[#00FF41]"
                    />
                    <span className={`text-[11px] font-bold ${config.measurementMode === m ? 'text-[#00FF41]' : 'text-[#888]'}`}>
                      {m === 'realistic' ? 'Realistic — decode threshold' : 'Ideal — genie-aided bound'}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[#888] leading-relaxed">
                {isRealistic ? (
                  <>
                    Every frame gets a random carrier offset (&plusmn;{(config.carrierOffsetHz ?? 5).toFixed(1)} Hz)
                    and timing offset (&plusmn;{(config.timingOffsetSec ?? 0.5).toFixed(2)} s). The receiver is
                    handed nothing but audio: it locates the frame from the 21 Costas symbols and estimates
                    its own noise floor, and a frame it cannot find counts as a failure. This is the only
                    mode whose result may be called a threshold or set beside another mode's published figure.
                    It runs the full physical chain, so it is substantially slower than ideal mode.
                  </>
                ) : (
                  <>
                    The demodulator is handed the exact noise sigma, the exact carrier and perfect symbol
                    timing. The result is a <strong className="text-yellow-300">bound</strong>, roughly 2.3 dB
                    optimistic, and is <strong className="text-yellow-300">not</strong> comparable with any
                    other mode's on-air number. Quoting one against FT8's -21.0 dB is the error wiki/11 §1.1
                    records as withdrawn.
                  </>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-[#888] uppercase block mb-1">Min SNR (dB):</label>
              <input
                type="number"
                step="0.5"
                min="-40"
                max="-10"
                value={config.minSnrDb}
                onChange={(e) => setConfig({ ...config, minSnrDb: parseFloat(e.target.value) || -32 })}
                disabled={progress.isRunning}
                className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-cyan-400 text-xs font-bold focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#888] uppercase block mb-1">Max SNR (dB):</label>
              <input
                type="number"
                step="0.5"
                min="-30"
                max="0"
                value={config.maxSnrDb}
                onChange={(e) => setConfig({ ...config, maxSnrDb: parseFloat(e.target.value) || -22 })}
                disabled={progress.isRunning}
                className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-cyan-400 text-xs font-bold focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#888] uppercase block mb-1">SNR Step (dB):</label>
              <input
                type="number"
                step="0.1"
                min="0.2"
                max="3.0"
                value={config.snrStepDb}
                onChange={(e) => setConfig({ ...config, snrStepDb: parseFloat(e.target.value) || 1.0 })}
                disabled={progress.isRunning}
                className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-cyan-400 text-xs font-bold focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#888] uppercase block mb-1">Frames / Point:</label>
              <input
                type="number"
                step="10"
                min="10"
                max="1000"
                value={config.framesPerPoint}
                onChange={(e) => setConfig({ ...config, framesPerPoint: parseInt(e.target.value, 10) || 50 })}
                disabled={progress.isRunning}
                className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-yellow-400 text-xs font-bold focus:outline-none focus:border-yellow-500"
              />
            </div>
            <div>
              {/* Not a selector. There were two options here: "Exact Matched Filter Bank
                  (Fast)", which was the default, never synthesized a waveform and never ran
                  the shipped demodulator - it drew per-tone Gaussians against an assumed
                  signalling model and measured about 2 dB better than the real receive chain -
                  and the physical path, which is now the only one. See the note in
                  monteCarloEngine.ts where generateChannelLlrsFast used to be. */}
              <label className="text-[10px] text-[#888] uppercase block mb-1">Receive Chain:</label>
              <div className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-[#00FF41] text-xs font-bold">
                Full continuous-phase waveform &rarr; shipped demodulator
              </div>
            </div>
            <div>
              {/* Not a selector either. "Rayleigh Fading (0.5 Hz Doppler)" ran a model that was
                  neither Rayleigh nor ITU-R F.1487 - two real-valued sinusoidal gains, no
                  complex tap, so no Doppler spread on the tones at all. Fading is measured by
                  the reference instrument, which implements the recommendation properly. */}
              <label className="text-[10px] text-[#888] uppercase block mb-1">Channel Model:</label>
              <div className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-purple-400 text-xs font-bold">
                Calibrated AWGN (2500 Hz ref)
              </div>
            </div>
            <div>
              {/* Not an input. It was a 10-120 box wired into the decoder's iteration cap, so a
                  run could measure a decoder with a cap the shipped receiver does not use. */}
              <label className="text-[10px] text-[#888] uppercase block mb-1">Max LDPC Iterations:</label>
              <div className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-zinc-300 text-xs font-bold">
                {LDPC_MAX_ITERATIONS} (shipped receiver)
              </div>
            </div>
            <div>
              {/* Not an input. There used to be a "Min-Sum Alpha Scale" box here, and nothing
                  in the decoder read it - decodeMinSum() applies the four alphas below. An
                  input that cannot move the curve is worse than no input. */}
              <label className="text-[10px] text-[#888] uppercase block mb-1">Decode Schedules:</label>
              <div className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-zinc-400 text-[10px] leading-tight">
                {Z30_DECODE_SCHEDULES.map((s, i) => (
                  <div key={i}>
                    {i + 1}. {s.mode} &alpha;={s.alpha} &le;{s.iters}it
                  </div>
                ))}
              </div>
            </div>
            <div>
              {/* Editable, and shown, because AGENTS.md §5 requires the seed to be quoted with
                  any figure - and because being able to re-run someone else's seed is the
                  whole point of seeding the run. */}
              <label className="text-[10px] text-[#888] uppercase block mb-1">PRNG Seed:</label>
              <input
                type="number"
                value={config.seed ?? DEFAULT_MONTE_CARLO_SEED}
                onChange={(e) => setConfig({ ...config, seed: parseInt(e.target.value, 10) || DEFAULT_MONTE_CARLO_SEED })}
                disabled={progress.isRunning}
                title="Same seed + same settings = same curve, every time. Quote it with any figure you publish."
                className="w-full bg-[#080808] border border-[#333] px-2 py-1 text-zinc-300 text-xs font-bold focus:outline-none"
              />
            </div>
            </div>
          </div>
        )}

        {/* Top Control Bar */}
        <div className="p-2 sm:p-3 bg-[#141414] border-b border-[#282828] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Run / Stop / Pause Controls */}
            {!progress.isRunning ? (
              <button
                onClick={() => handleStartSimulation()}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 border transition-all bg-[#00FF41] hover:bg-[#00FF41]/90 text-black border-[#00FF41] shadow-[0_0_12px_rgba(0,255,65,0.4)]"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Monte Carlo</span>
              </button>
            ) : (
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={handleTogglePause}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center space-x-1 border ${
                    progress.isPaused
                      ? 'bg-yellow-500 hover:bg-yellow-400 text-black border-yellow-400'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-yellow-400 border-zinc-600'
                  }`}
                >
                  {progress.isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{progress.isPaused ? 'Resume' : 'Pause'}</span>
                </button>
                <button
                  onClick={handleStopSimulation}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white border border-red-500 text-xs font-bold uppercase tracking-wider flex items-center space-x-1 animate-pulse"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            )}

            {/* Presets */}
            <div className="flex items-center space-x-1 border border-[#333] p-0.5 bg-[#0A0A0A]">
              {/* Ranges follow the active mode: the realistic curve and the genie-aided bound
                  sit about 1.5 dB apart, and the old hardcoded -30..-22 range brackets only the
                  bound - in realistic mode it would sit almost entirely below the point where
                  the sync pattern is findable at all, and report an all-zero sweep.
                  Realistic mode runs the full physical chain per frame, so its frame counts are
                  lower for the same wall-clock. */}
              <button
                onClick={() =>
                  handleStartSimulation({
                    ...(isRealistic ? REALISTIC_SWEEP_DEFAULTS : IDEAL_SWEEP_DEFAULTS),
                    snrStepDb: 1.0,
                    framesPerPoint: isRealistic ? 10 : 25,
                  })
                }
                disabled={progress.isRunning}
                className="px-2 py-1 bg-[#181818] hover:bg-[#252525] disabled:opacity-40 text-cyan-400 text-[10px] font-bold uppercase"
              >
                Quick ({isRealistic ? 10 : 25} f/pt)
              </button>
              <button
                onClick={() =>
                  handleStartSimulation({
                    ...(isRealistic ? REALISTIC_SWEEP_DEFAULTS : IDEAL_SWEEP_DEFAULTS),
                    snrStepDb: 1.0,
                    framesPerPoint: isRealistic ? 40 : 100,
                  })
                }
                disabled={progress.isRunning}
                className="px-2 py-1 bg-[#181818] hover:bg-[#252525] disabled:opacity-40 text-[#00FF41] text-[10px] font-bold uppercase"
              >
                Standard ({isRealistic ? 40 : 100} f/pt)
              </button>
              <button
                onClick={() =>
                  handleStartSimulation({
                    ...(isRealistic ? REALISTIC_SWEEP_DEFAULTS : IDEAL_SWEEP_DEFAULTS),
                    snrStepDb: 0.5,
                    framesPerPoint: isRealistic ? 100 : 300,
                  })
                }
                disabled={progress.isRunning}
                className="px-2 py-1 bg-[#181818] hover:bg-[#252525] disabled:opacity-40 text-purple-400 text-[10px] font-bold uppercase"
              >
                Deep ({isRealistic ? 100 : 300} f/pt)
              </button>
            </div>

            {/* Clear / Reset Data */}
            {progress.currentResults.length > 0 && (
              <button
                onClick={handleClearResults}
                disabled={progress.isRunning}
                className="px-2.5 py-1 bg-[#181818] hover:bg-[#252525] disabled:opacity-40 text-zinc-400 hover:text-zinc-200 border border-[#333] text-[11px] flex items-center space-x-1"
                title="Clear current benchmark data"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Export & Copy Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={exportCsv}
              disabled={progress.currentResults.length === 0}
              className="px-2 py-1 bg-[#181818] hover:bg-[#252525] disabled:opacity-40 text-cyan-400 border border-cyan-900/60 text-[11px] flex items-center space-x-1"
            >
              <FileSpreadsheet className="w-3 h-3" />
              <span>CSV</span>
            </button>
            <button
              onClick={copyResultsText}
              disabled={progress.currentResults.length === 0}
              className="px-2 py-1 bg-[#181818] hover:bg-[#252525] disabled:opacity-40 text-[#D4D4D4] border border-[#333] text-[11px] flex items-center space-x-1"
            >
              {copied ? <Check className="w-3 h-3 text-[#00FF41]" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Live Simulation Progress Readout */}
        <div className="px-3 py-1.5 bg-[#080808] border-b border-[#222] text-xs">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <div className="flex items-center space-x-3">
              <span className="flex items-center text-[#888]">
                <span
                  className={`w-2 h-2 rounded-full mr-1.5 ${
                    progress.isRunning
                      ? progress.isPaused
                        ? 'bg-yellow-400'
                        : 'bg-[#00FF41] animate-ping'
                      : progress.currentResults.length > 0
                      ? 'bg-cyan-400'
                      : 'bg-[#444]'
                  }`}
                />
                Status:{' '}
                {progress.isRunning
                  ? progress.isPaused
                    ? 'Paused'
                    : 'Running Monte Carlo Simulation'
                  : progress.currentResults.length > 0
                  ? 'Simulation Completed'
                  : 'Ready (Zero Pre-baked Data)'}
              </span>
              {progress.isRunning && (
                <>
                  <span className="text-yellow-400">
                    Testing SNR: <strong className="font-bold">{progress.currentSnrDb >= 0 ? '+' : ''}{progress.currentSnrDb} dB</strong>
                  </span>
                  <span className="text-cyan-400">
                    Frame: {progress.currentFrameInPoint} / {progress.totalFramesPerPoint}
                  </span>
                  <span className="text-zinc-400">
                    Point: {progress.currentSnrIdx + 1} / {progress.totalSnrPoints}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {snr50Threshold !== null && (
                <span className="text-purple-300 font-bold">
                  50% {resultNoun}: {snr50Threshold.toFixed(2)} dB
                </span>
              )}
              <span className="text-[#00FF41] font-bold">{progress.overallProgressPercent}%</span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-[#1A1A1A] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-[#00FF41] to-yellow-400 transition-all duration-150"
              style={{ width: `${progress.overallProgressPercent}%` }}
            />
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center px-3 bg-[#0D0D0D] border-b border-[#282828] text-xs space-x-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab('CURVES')}
            className={`px-3 py-2 border-b-2 font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors ${
              activeTab === 'CURVES'
                ? 'border-[#00FF41] text-[#00FF41] bg-[#141414]'
                : 'border-transparent text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Decode Prob (%) vs SNR</span>
          </button>

          <button
            onClick={() => setActiveTab('FER')}
            className={`px-3 py-2 border-b-2 font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors ${
              activeTab === 'FER'
                ? 'border-purple-400 text-purple-400 bg-[#141414]'
                : 'border-transparent text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Frame Error Rate (FER)</span>
          </button>

          <button
            onClick={() => setActiveTab('BER')}
            className={`px-3 py-2 border-b-2 font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors ${
              activeTab === 'BER'
                ? 'border-cyan-400 text-cyan-400 bg-[#141414]'
                : 'border-transparent text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>BER & LDPC Iterations</span>
          </button>

          <button
            onClick={() => setActiveTab('WAVEFORM')}
            className={`px-3 py-2 border-b-2 font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors ${
              activeTab === 'WAVEFORM'
                ? 'border-yellow-400 text-yellow-400 bg-[#141414]'
                : 'border-transparent text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Physical Waveform Inspector</span>
          </button>

          <button
            onClick={() => setActiveTab('TABLE')}
            className={`px-3 py-2 border-b-2 font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors ${
              activeTab === 'TABLE'
                ? 'border-white text-white bg-[#141414]'
                : 'border-transparent text-[#888] hover:text-[#D4D4D4]'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Detailed Results Table</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 p-3 bg-[#0A0A0A] overflow-y-auto select-text">
          {/* TAB 1: DECODE PROBABILITY (%) vs SNR (dB in 2500 Hz) */}
          {activeTab === 'CURVES' && (
            <div className="space-y-3 h-full flex flex-col">
              {/* Metrics Header Bento */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-[#121212] p-2 border border-[#282828]">
                  <span className="text-[9px] text-[#888] uppercase block">50% {resultNoun}</span>
                  <span className={`text-sm sm:text-base font-bold ${isRealistic ? 'text-[#00FF41]' : 'text-purple-400'}`}>
                    {snr50Threshold !== null ? `${snr50Threshold.toFixed(2)} dB` : '— (Pending Run)'}
                  </span>
                  {/* The band, next to the crossing, always. A crossing on its own reads as a
                      measurement to a hundredth of a dB whatever the sample size behind it. */}
                  <span className="text-[9px] text-[#666] block">
                    {snr50Threshold !== null ? `95% band ${bandLabel(crossing50)}` : ''}
                  </span>
                  <span className="text-[9px] text-[#666] block">
                    {isRealistic ? 'Interpolated, 2500 Hz ref BW' : 'Bound — not an on-air figure'}
                  </span>
                </div>
                {/* This tile used to read "Gain vs FT8 (-21.0 dB)" and print a dB delta and a
                    power multiplier: FT8's measured on-air figure minus a genie-aided bound,
                    presented as gain. That is the class of claim wiki/11 §1.1 records as
                    WITHDRAWN ("a '+4.0 dB advantage'; that claim was withdrawn"), reconstructed
                    in the UI. It is replaced by the 90% crossing, which is a measurement of
                    this mode and nothing else. */}
                <div className="bg-[#121212] p-2 border border-[#282828]">
                  <span className="text-[9px] text-[#888] uppercase block">90% {resultNoun}</span>
                  <span className={`text-sm sm:text-base font-bold ${isRealistic ? 'text-[#00FF41]' : 'text-purple-400'}`}>
                    {snr90Threshold !== null ? `${snr90Threshold.toFixed(2)} dB` : '—'}
                  </span>
                  <span className="text-[9px] text-[#666] block">
                    {snr90Threshold !== null ? `95% band ${bandLabel(crossing90)}` : 'Sweep did not reach 90%'}
                  </span>
                </div>
                <div className="bg-[#121212] p-2 border border-[#282828]">
                  <span className="text-[9px] text-[#888] uppercase block">Total Frames Tested</span>
                  <span className="text-sm sm:text-base font-bold text-cyan-400">
                    {progress.currentResults.reduce((acc, r) => acc + r.totalFrames, 0)} Frames
                  </span>
                  {/* The same EXPLORATORY notice z30_dsp/benchmark.py prints below the same
                      figure. This modal offers a 25-frame quick sweep and defaults to 50, and
                      said nothing about what that does to a crossing. */}
                  <span className={`text-[9px] block ${isExploratory ? 'text-yellow-400' : 'text-[#666]'}`}>
                    {isExploratory
                      ? `Exploratory: <${PUBLISHABLE_FRAMES_PER_POINT}/point`
                      : 'Empirical Monte Carlo'}
                  </span>
                </div>
                <div className="bg-[#121212] p-2 border border-[#282828]">
                  <span className="text-[9px] text-[#888] uppercase block">Channel Coding</span>
                  <span className="text-sm sm:text-base font-bold text-yellow-400">
                    (216, 77) LDPC R=0.356
                  </span>
                  <span className="text-[9px] text-[#666] block">16-MFSK (4 bits/sym)</span>
                </div>
              </div>

              {/* Chart Controls Checkboxes */}
              <div className="flex items-center justify-between text-xs bg-[#121212] px-3 py-1.5 border border-[#222]">
                <span className="text-[#888] text-[11px]">Reference Comparison Overlays:</span>
                {includeFt8Comparison && !isRealistic && (
                  <span className="text-[10px] text-yellow-300 bg-[#0D0B05] border border-yellow-800/60 px-1.5 py-0.5">
                    Not comparable: this run is a genie-aided bound, the FT8 line is an on-air figure.
                  </span>
                )}
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeFt8Comparison}
                      onChange={(e) => setIncludeFt8Comparison(e.target.checked)}
                      className="accent-[#00FF41]"
                    />
                    <span
                      className="text-red-400 text-[11px]"
                      title="FT8's published ON-AIR threshold, drawn as a modelled logistic. It is only a like-for-like comparison against a REALISTIC-mode run; an ideal-mode curve is a genie-aided bound roughly 1.5 dB optimistic, and comparing the two is the error wiki/11 §1.1 records as withdrawn."
                    >
                      FT8 on-air reference (-21.0 dB)
                    </span>
                  </label>
                </div>
              </div>

              {/* Main Recharts Line Chart */}
              <div className="flex-1 min-h-[320px] bg-[#0E0E0E] p-2 border border-[#282828]">
                {chartData.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#666]">
                    <Activity className="w-12 h-12 text-[#333] mb-3 animate-pulse" />
                    <p className="text-sm text-[#D4D4D4] font-bold">No Pre-Baked Data • Ready for Empirical Simulation</p>
                    <p className="text-xs text-[#888] max-w-lg mt-1.5 leading-relaxed">
                      Click <strong className="text-[#00FF41]">"Run Monte Carlo"</strong> above to launch live physical waveform synthesis or matched-filter decoding across the SNR sweep. Each frame generates authentic random bits, computes CRC-14, encodes LDPC, injects calibrated Gaussian noise, and executes Normalized Min-Sum belief propagation.
                    </p>
                    <div className="mt-4 flex items-center space-x-2">
                      <button
                        onClick={() => handleStartSimulation({ framesPerPoint: 25, snrStepDb: 1.0 })}
                        className="px-3 py-1.5 bg-[#00FF41] hover:bg-[#00FF41]/90 text-black text-xs font-bold uppercase tracking-wider"
                      >
                        Start Quick Sweep (25 frames/pt)
                      </button>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                      <XAxis
                        dataKey="snrDb"
                        stroke="#666"
                        label={{
                          value: 'SNR in Standard 2500 Hz Audio Noise Bandwidth (dB)',
                          position: 'insideBottom',
                          offset: -12,
                          fill: '#888',
                          fontSize: 11,
                        }}
                        tick={{ fill: '#888', fontSize: 10 }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        stroke="#666"
                        label={{
                          value: 'Decode Success Probability (%)',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#888',
                          fontSize: 11,
                        }}
                        tick={{ fill: '#888', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#141414', borderColor: '#333', fontSize: 11, color: '#D4D4D4' }}
                        formatter={(val: any, name?: string | number) => {
                          if (name === 'z30DecodePct') return [`${val}%`, isRealistic ? 'z-30 measured (blind acquisition)' : 'z-30 measured (genie-aided)'];
                          if (name === 'ft8DecodePct') return [`${val}%`, 'FT8 Reference Model'];
                          return [val, String(name ?? '')];
                        }}
                        labelFormatter={(label) => `SNR: ${label} dB / 2500 Hz`}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        formatter={(value) => {
                          if (value === 'z30DecodePct') return <span className="text-[#00FF41] font-bold">z-30 Live Measured LDPC Decode %</span>;
                          if (value === 'ft8DecodePct') return <span className="text-red-400">FT8 on-air ref (-21 dB)</span>;
                          return value;
                        }}
                      />
                      <ReferenceLine y={50} stroke="#666" strokeDasharray="3 3" label={{ value: '50% decode', fill: '#888', fontSize: 10 }} />
                      <ReferenceLine y={90} stroke="#444" strokeDasharray="3 3" label={{ value: '90% Waterfall', fill: '#666', fontSize: 10 }} />
                      {snr50Threshold !== null && (
                        <ReferenceLine
                          x={snr50Threshold}
                          stroke="#00FF41"
                          strokeDasharray="4 4"
                          label={{ value: `50% ${isRealistic ? 'threshold' : 'bound'} (${snr50Threshold.toFixed(2)}dB)`, fill: '#00FF41', fontSize: 10 }}
                        />
                      )}
                      {includeFt8Comparison && (
                        <ReferenceLine x={-21.0} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'FT8 (-21dB)', fill: '#EF4444', fontSize: 10 }} />
                      )}

                      {/* Actual z-30 Empirical Curve */}
                      <Line
                        type="monotone"
                        dataKey="z30DecodePct"
                        name="z30DecodePct"
                        stroke="#00FF41"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#00FF41' }}
                        activeDot={{ r: 7 }}
                      />

                      {includeFt8Comparison && (
                        <Line
                          type="monotone"
                          dataKey="ft8DecodePct"
                          name="ft8DecodePct"
                          stroke="#EF4444"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      )}

                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: FRAME ERROR RATE (FER) vs SNR (dB) */}
          {activeTab === 'FER' && (
            <div className="space-y-3 h-full flex flex-col">
              <div className="p-2.5 bg-[#121212] border border-[#282828] text-xs">
                <h4 className="font-bold text-purple-400 uppercase text-[11px] flex items-center space-x-1.5">
                  <BarChart2 className="w-3.5 h-3.5" />
                  <span>Frame Error Rate (FER) Waterfall Cliff Analysis</span>
                </h4>
                <p className="text-[11px] text-[#888] mt-0.5">
                  FER represents the fraction of frames that failed LDPC syndrome check or CRC-14 error detection: FER = Failures / Total Frames.
                </p>
              </div>

              <div className="flex-1 min-h-[340px] bg-[#0E0E0E] p-2 border border-[#282828]">
                {chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[#666]">
                    Run Monte Carlo simulation to view empirical FER curves.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                      <XAxis
                        dataKey="snrDb"
                        stroke="#666"
                        label={{
                          value: 'SNR in 2500 Hz Audio Noise Bandwidth (dB)',
                          position: 'insideBottom',
                          offset: -12,
                          fill: '#888',
                          fontSize: 11,
                        }}
                        tick={{ fill: '#888', fontSize: 10 }}
                      />
                      <YAxis
                        domain={[0, 1.0]}
                        stroke="#666"
                        label={{
                          value: 'Frame Error Rate (FER = 1 - P_decode)',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#888',
                          fontSize: 11,
                        }}
                        tick={{ fill: '#888', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#141414', borderColor: '#333', fontSize: 11, color: '#D4D4D4' }}
                        formatter={(val: any) => [val, 'Frame Error Rate']}
                        labelFormatter={(label) => `SNR: ${label} dB`}
                      />
                      <Line
                        type="monotone"
                        dataKey="z30Fer"
                        name="z30Fer"
                        stroke="#A855F7"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#A855F7' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: BER & LDPC ITERATIONS */}
          {activeTab === 'BER' && (
            <div className="space-y-3 h-full flex flex-col">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                {/* Pre-LDPC Channel BER vs Post-LDPC BER */}
                <div className="bg-[#0E0E0E] p-2.5 border border-[#282828] flex flex-col">
                  <h4 className="font-bold text-cyan-400 uppercase text-[11px] mb-1">
                    Pre-LDPC Channel BER vs Post-LDPC Coded BER (%)
                  </h4>
                  <div className="flex-1 min-h-[260px]">
                    {chartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[#666]">
                        No BER data yet. Run Monte Carlo simulation above.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 15 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                          <XAxis dataKey="snrDb" stroke="#666" tick={{ fill: '#888', fontSize: 10 }} />
                          <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 10 }} />
                          <Tooltip contentStyle={{ backgroundColor: '#141414', borderColor: '#333', fontSize: 11 }} />
                          <Legend verticalAlign="top" height={30} />
                          <Line type="monotone" dataKey="rawBer" name="Pre-LDPC Raw Channel BER (%)" stroke="#F59E0B" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="postBer" name="Post-LDPC Residual BER (%)" stroke="#00FF41" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Average LDPC Min-Sum Iterations */}
                <div className="bg-[#0E0E0E] p-2.5 border border-[#282828] flex flex-col">
                  <h4 className="font-bold text-yellow-400 uppercase text-[11px] mb-1">
                    Average LDPC Belief Propagation Iterations vs SNR
                  </h4>
                  <div className="flex-1 min-h-[260px]">
                    {chartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[#666]">
                        No iteration data yet. Run Monte Carlo simulation above.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 15 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                          <XAxis dataKey="snrDb" stroke="#666" tick={{ fill: '#888', fontSize: 10 }} />
                          {/* The whole cascade's cap, not one schedule's. This used to be
                              config.maxLdpcIterations (45), so every point near threshold -
                              where a failing frame runs all four schedules to 150 - was drawn
                              clipped against the top of the axis. */}
                          <YAxis stroke="#666" domain={[0, TOTAL_CASCADE_ITERATIONS]} tick={{ fill: '#888', fontSize: 10 }} />
                          <Tooltip contentStyle={{ backgroundColor: '#141414', borderColor: '#333', fontSize: 11 }} />
                          <Bar dataKey="avgIters" name="Avg BP Iterations" fill="#A855F7" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PHYSICAL WAVEFORM INSPECTOR */}
          {activeTab === 'WAVEFORM' && (
            <div className="space-y-3">
              <div className="p-2.5 bg-[#121212] border border-[#282828] text-xs">
                <h4 className="font-bold text-yellow-400 uppercase text-[11px] flex items-center space-x-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  <span>Physical 16-MFSK Continuous-Phase Waveform & Correlator Bank</span>
                </h4>
                <p className="text-[11px] text-[#888] mt-0.5">
                  Live time-domain inspection of the synthesized 75-symbol frame with calibrated Gaussian noise (AWGN) and non-coherent 16-tone matched filter detector outputs.
                </p>
              </div>

              {progress.latestWaveformPreview ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Clean vs Noisy Time-Domain Waveform */}
                  <div className="bg-[#0E0E0E] p-3 border border-[#282828] space-y-2">
                    <span className="text-[10px] uppercase font-bold text-cyan-400 block">
                      Time-Domain Waveform (First 300 samples @ Fs={config.sampleRateHz}Hz)
                    </span>
                    <div className="h-36 bg-[#050505] p-1 border border-[#222] relative overflow-hidden">
                      <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
                        {/* Grid lines */}
                        <line x1="0" y1="50" x2="300" y2="50" stroke="#333" strokeDasharray="2 2" />
                        {/* Noisy Waveform in Background */}
                        <path
                          d={progress.latestWaveformPreview.timeDomainNoisy.reduce(
                            (acc, v, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${i} ${50 - v * 20}`,
                            ''
                          )}
                          fill="none"
                          stroke="#EF4444"
                          strokeWidth="1"
                          opacity="0.6"
                        />
                        {/* Clean 16-MFSK Waveform in Foreground */}
                        <path
                          d={progress.latestWaveformPreview.timeDomainClean.reduce(
                            (acc, v, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${i} ${50 - v * 40}`,
                            ''
                          )}
                          fill="none"
                          stroke="#00FF41"
                          strokeWidth="1.5"
                        />
                      </svg>
                      <div className="absolute top-1 right-2 text-[9px] flex space-x-2 bg-black/60 px-1">
                        <span className="text-[#00FF41]">Clean Signal</span>
                        <span className="text-red-400">Signal + AWGN ({progress.latestWaveformPreview.snrDb} dB)</span>
                      </div>
                    </div>
                  </div>

                  {/* 16-Tone Correlator Heatmap */}
                  <div className="bg-[#0E0E0E] p-3 border border-[#282828] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-purple-400">
                        16-Tone Matched Filter Energy Matrix (First 12 Symbols)
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 border ${
                          progress.latestWaveformPreview.decodedSuccess
                            ? 'bg-[#00FF41]/20 text-[#00FF41] border-[#00FF41]'
                            : 'bg-red-950/60 text-red-400 border-red-800'
                        }`}
                      >
                        {progress.latestWaveformPreview.decodedSuccess ? 'DECODED (CRC PASS)' : 'DECODE FAILED'}
                      </span>
                    </div>

                    <div className="grid grid-cols-12 gap-1 bg-[#050505] p-2 border border-[#222]">
                      {progress.latestWaveformPreview.correlatorEnergies.map((tones, sIdx) => {
                        const maxE = Math.max(...tones, 1e-6);
                        const txTone = progress.latestWaveformPreview?.transmittedSymbols[sIdx];
                        return (
                          <div key={sIdx} className="flex flex-col space-y-0.5 items-center">
                            <span className="text-[8px] text-[#666]">S{sIdx}</span>
                            {tones.map((e, tIdx) => {
                              const norm = Math.min(1.0, e / maxE);
                              const isTx = tIdx === txTone;
                              return (
                                <div
                                  key={tIdx}
                                  title={`Sym ${sIdx}, Tone ${tIdx}: Energy ${(e).toFixed(2)}${isTx ? ' (TRANSMITTED)' : ''}`}
                                  className={`w-full h-2 rounded-[1px] ${
                                    isTx ? 'border border-cyan-400' : ''
                                  }`}
                                  style={{
                                    backgroundColor: `rgba(0, 255, 65, ${Math.max(0.08, norm)})`,
                                  }}
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-[#666] bg-[#0E0E0E] border border-[#222]">
                  Run simulation to capture physical waveform samples and matched filter correlator matrices.
                </div>
              )}
            </div>
          )}

          {/* TAB 5: DETAILED RESULTS TABLE */}
          {activeTab === 'TABLE' && (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-[#282828]">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="bg-[#121212] text-[#888] border-b border-[#333] uppercase text-[10px]">
                    <tr>
                      <th className="p-2">SNR (2500Hz)</th>
                      <th className="p-2">Frames</th>
                      <th className="p-2">Successes</th>
                      <th className="p-2">Failures</th>
                      <th className="p-2 text-purple-300">FER</th>
                      <th className="p-2 text-[#00FF41]">Decode %</th>
                      <th className="p-2 text-yellow-400">95% Wilson CI</th>
                      {/* Named for their denominator. The three columns to the right of this
                          one average over the frames that reached the demodulator, not over
                          every frame swept - a frame acquisition never found produced no bits
                          and ran no iterations. The count itself is the next column so the
                          denominator is visible rather than implied. */}
                      <th className="p-2">Raw BER<span className="text-[#555]"> /demod</span></th>
                      <th className="p-2">Post BER<span className="text-[#555]"> /demod</span></th>
                      <th className="p-2">Avg Iters<span className="text-[#555]"> /demod</span></th>
                      {isRealistic && <th className="p-2">Demod'd</th>}
                      {/* The Python benchmark's Acq fail / Timing RMS / Freq RMS columns. They
                          are how the acquisition stage's own error stays visible instead of
                          being absorbed into the frame error rate: below about -24 dB the
                          Costas pattern stops being findable at all, and that belongs in its
                          own column. Meaningless in ideal mode, where acquisition is a gift. */}
                      {isRealistic && <th className="p-2 text-orange-400">Acq Fail</th>}
                      {isRealistic && <th className="p-2 text-orange-400">Timing RMS</th>}
                      {isRealistic && <th className="p-2 text-orange-400">Freq RMS</th>}
                      <th className="p-2">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F1F1F]">
                    {progress.currentResults.map((r, idx) => (
                      <tr key={idx} className="hover:bg-[#181818] transition-colors">
                        <td className="p-2 font-bold text-cyan-400">
                          {r.snrDb >= 0 ? '+' : ''}{r.snrDb.toFixed(1)} dB
                        </td>
                        <td className="p-2 text-[#D4D4D4]">{r.totalFrames}</td>
                        <td className="p-2 text-[#00FF41] font-bold">{r.successCount}</td>
                        <td className="p-2 text-red-400">{r.failureCount}</td>
                        <td className="p-2 text-purple-300 font-bold">{r.frameErrorRate.toFixed(4)}</td>
                        <td className="p-2 font-bold text-[#00FF41]">{r.decodeSuccessRate.toFixed(1)}%</td>
                        <td className="p-2 text-[#888] text-[10px]">
                          [{r.confidenceInterval95[0]}%, {r.confidenceInterval95[1]}%]
                        </td>
                        <td className="p-2 text-[#AAA]">{(r.rawChannelBer * 100).toFixed(1)}%</td>
                        <td className="p-2 text-[#AAA]">{(r.postLdpcBer * 100).toFixed(2)}%</td>
                        <td className="p-2 text-[#D4D4D4]">{r.avgLdpcIterations.toFixed(1)}</td>
                        {isRealistic && <td className="p-2 text-[#AAA]">{r.demodulatedFrames}</td>}
                        {isRealistic && (
                          <td className={`p-2 font-bold ${r.acquisitionFailures > 0 ? 'text-orange-400' : 'text-[#666]'}`}>
                            {r.acquisitionFailures}
                          </td>
                        )}
                        {isRealistic && <td className="p-2 text-[#AAA]">{r.timingRmsMs.toFixed(1)} ms</td>}
                        {isRealistic && <td className="p-2 text-[#AAA]">{r.freqRmsHz.toFixed(2)} Hz</td>}
                        <td className="p-2 text-[#666]">{r.elapsedMs}ms</td>
                      </tr>
                    ))}
                    {progress.currentResults.length === 0 && (
                      <tr>
                        <td colSpan={isRealistic ? 15 : 11} className="p-6 text-center text-[#666]">
                          No simulation data yet. Click "Run Monte Carlo" above to execute real physical decodes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* This engine is NOT the reference instrument, and saying so is the whole point. The
            two share SLOT_SEARCH_MARGIN_SEC and RECEIVER_PILOT_COHERENCE and now run the same
            shape of receive chain, but agreement is not authority: the Python benchmark is what
            CI runs and what the published tables are copied from.

            The figure quoted below is 0.10 dB, re-measured on 2026-09-03 at 200 frames a
            point with both engines swept over the same three SNR points - the 0.02 dB it read
            before compared columns measured over different sweep extents, which draws
            different frames. Before
            that it said the two differed by 1.8 dB because the browser "searches a narrower
            timing window and runs a different decoder schedule" - both halves false, and both
            retracted in wiki/16 while this string kept the old claim. Quoting the wiki figure
            rather than a remembered one is the point of the constant-quoting rule in
            AGENTS.md section 4. */}
        <div className="px-4 py-2 bg-[#0D0B05] border-t border-yellow-900/60 text-[10px] text-yellow-200/80 leading-relaxed">
          <strong className="text-yellow-300">This is a bench instrument, not the reference benchmark.</strong>{' '}
          The project's published figures come from <code className="text-yellow-300">python -m z30_dsp.benchmark</code>{' '}
          (see wiki/16). Both run the same receiver model and land 0.10 dB apart on the AWGN
          threshold at the same seed, sweep extent and 200 frames a point, but a number only
          reaches
          documentation after a seeded Python run. Use this to see which way a change moved the
          curve. Fading is not modelled here at all — the ITU-R F.1487 conditions are the
          reference instrument's, which implements the recommendation.
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2 bg-[#0A0A0A] border-t border-[#333] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#888]">
          <div className="flex items-center space-x-3">
            <span>Mode: <strong>16-MFSK (50 Hz BW)</strong></span>
            <span>•</span>
            <span>FEC: <strong>(216, 77) LDPC</strong></span>
            <span>•</span>
            <span>CRC: <strong>CRC-14 (0x2443)</strong></span>
            <span>•</span>
            <span>Integration: <strong>30.0s UTC cycle</strong></span>
            <span>•</span>
            <span>Seed: <strong className="text-[#D4D4D4]">{config.seed ?? '(unseeded)'}</strong></span>
          </div>
          <div>
            <span>z-30 Experimental Digital Mode DSP Engine</span>
          </div>
        </div>
      </div>
    </div>
  );
};
