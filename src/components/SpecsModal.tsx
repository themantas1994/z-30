/**
 * z-30 Digital Mode Technical Specifications & RF Math Reference Modal
 */

import React from 'react';
import { X, ShieldCheck, Zap, Radio, Layers } from 'lucide-react';
// Quoted from the codec itself rather than retyped: the prose here used to say 50 iterations
// while both implementations stopped at 45. The code geometry below is quoted the same way -
// it was still typed out by hand as "(216, 77)" and "R ~ 0.356", correct but unpinned, which
// is exactly how the iteration count drifted in the first place.
import { LDPC_MAX_ITERATIONS, Z30_DECODE_SCHEDULES, Z30_LDPC_PARAMS } from '../dsp/ldpcCodec';
// Same reasoning for the sensitivity figures below: Z30_SPECS is the source AGENTS.md section 5
// names for these numbers (wiki/16), and this modal used to retype them as literal JSX text
// instead of importing it - the exact failure mode the LDPC constants above were fixed for.
import { Z30_SPECS } from '../dsp/z30Constants';

interface SpecsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SpecsModal: React.FC<SpecsModalProps> = ({ isOpen, onClose }) => {
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
              <span
                className="font-bold text-[#00FF41] text-xs"
                title="99% occupied bandwidth measured on random frames from the generated waveform: 49.8 Hz (66 Hz at -40 dB). Verify your transmitter's actual output on a spectrum analyser - sound-card clipping and rig ALC will re-broaden a clean signal."
              >
                49.8 Hz (99%)
              </span>
            </div>
            <div className="bg-[#050505] p-2.5 border border-[#333]">
              <span className="text-[9px] text-[#888] block uppercase">UTC TIME SLOT</span>
              <span className="font-bold text-yellow-400 text-xs">30.0 Seconds</span>
            </div>
            {/* The tile used to print "-24.6 dB (bound)" under the word THRESHOLD - the two
                words contradict each other, and the bound is the one that must never be read
                as an on-air figure. The headline is now the blind-acquisition threshold, which
                is what "threshold" means in wiki/16, with the bound in the tooltip. */}
            <div className="bg-[#050505] p-2.5 border border-[#333]">
              <span className="text-[9px] text-[#888] block uppercase">AWGN 50% (BLIND ACQ.)</span>
              <span
                className="font-bold text-purple-400 text-xs"
                title={`Measured with random carrier and timing offsets through blind Costas acquisition, with the receiver estimating its own noise floor and demodulating non-coherently - the figure comparable with other modes' published on-air numbers. The genie-aided bound, with exact sigma, carrier and timing handed to the demodulator, is ${Z30_SPECS.SNR_IDEAL_BOUND_AWGN} dB; the 1.5 dB gap is acquisition loss.`}
              >
                {Z30_SPECS.SNR_THRESHOLD_AWGN} dB SNR
              </span>
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
              <li><strong>Waveform Shaping:</strong> one phase accumulator across the whole frame, Gaussian-shaped frequency transitions (GFSK, BT = 2.0), and a constant amplitude envelope with a single 20 ms raised-cosine ramp at the start and end of the transmission. Measured 99% occupied bandwidth 49.8 Hz, -40 dB bandwidth 66 Hz.</li>
              <li><strong>Tone Spacing:</strong> Tone delta f = 50 Hz / 16 = 3.125 Hz.</li>
              <li><strong>Symbol Duration:</strong> Ts = 1 / 3.125 Hz = 0.320 seconds (320 ms).</li>
              <li><strong>Active Transmission:</strong> 75 symbols * 0.320s = 24.0 seconds.</li>
              <li><strong>Guard & Decode Window:</strong> 6.0 seconds for FFT framing, multi-stage SIC, and LDPC decoding.</li>
              <li><strong>Synchronization:</strong> 21 Costas array sync symbols interleaved throughout the frame for sub-Hz frequency tracking and symbol time offset (DT) estimation.</li>
              <li><strong>Sensitivity (AWGN, blind acquisition, seeded Monte Carlo):</strong> 50% decode at <strong>{Z30_SPECS.SNR_THRESHOLD_AWGN} dB</strong> SNR; 90% at <strong>{Z30_SPECS.SNR_THRESHOLD_90_AWGN} dB</strong>. Each frame gets a random carrier offset (&plusmn;5 Hz) and timing offset (&plusmn;0.5 s), and the receiver is handed nothing but audio: it finds the frame from the 21 Costas symbols, estimates the noise floor itself, and demodulates non-coherently. This is the figure comparable with other modes' published on-air numbers &mdash; 2.1 dB deeper than FT8's -21.0 dB, bought with 1.9&times; the airtime.</li>
              <li><strong>Idealised bound (genie-aided, not a threshold):</strong> 50% at {Z30_SPECS.SNR_IDEAL_BOUND_AWGN} dB, 90% at -23.4 dB, measured with the exact noise level, carrier frequency and symbol timing handed to the demodulator. It bounds what the code can do under ideal detection and nothing more. The 1.5 dB gap between the two is what it costs to <em>find</em> a 3.125 Hz-spaced signal rather than be told where it is. Never compare it with another mode's on-air figure.</li>
            </ul>
          </div>

          {/* Forward Error Correction */}
          <div className="space-y-2 bg-[#050505] p-3 border border-[#333]">
            <h3 className="font-bold text-cyan-400 flex items-center space-x-1.5 uppercase text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>2. Low-Density Parity-Check (LDPC) Forward Error Correction</span>
            </h3>
            <ul className="list-disc list-inside space-y-1 text-[#D4D4D4] text-[11px]">
              <li><strong>Code Rate:</strong> Systematic ({Z30_LDPC_PARAMS.n}, {Z30_LDPC_PARAMS.k}) Irregular Repeat-Accumulate (IRA) LDPC code (R ~ {Z30_LDPC_PARAMS.rate.toFixed(3)}).</li>
              <li><strong>Information Payload:</strong> {Z30_LDPC_PARAMS.k} bits total (28-bit Call 1, 28-bit Call 2, 7-bit Grid/Report, {Z30_LDPC_PARAMS.crcBits}-bit CRC parity check).</li>
              <li><strong>Channel Bits:</strong> {Z30_LDPC_PARAMS.dataSymbols} data symbols * {Math.log2(Z30_LDPC_PARAMS.modulationAlphabet)} bits/symbol = {Z30_LDPC_PARAMS.n} coded bits.</li>
              <li>
                <strong>Decoder:</strong> a cascade of {Z30_DECODE_SCHEDULES.length} belief-propagation schedules, tried in order and stopped
                at the first whose hard decisions form a zero-syndrome codeword with a matching CRC-14. There is no single
                attenuation factor: each schedule carries its own. Schedule 1's cap, {LDPC_MAX_ITERATIONS} iterations, is what a
                well-formed frame converges within almost always.
                <ul className="list-none pl-4 pt-1 space-y-0.5 text-[10px] text-[#9A9A9A]">
                  {Z30_DECODE_SCHEDULES.map((sched, idx) => (
                    <li key={idx}>
                      {idx + 1}. {sched.mode === 'NMS' ? 'Normalized min-sum' : sched.mode === 'SPA' ? 'Log-domain sum-product (box-plus)' : 'Dithered normalized min-sum'}
                      {sched.reverse ? ', reverse check order' : ''} &mdash; &alpha; = {sched.alpha}, &beta; = {sched.beta}, damping {sched.damping}, up to {sched.iters} iterations.
                    </li>
                  ))}
                </ul>
              </li>
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
              <li><strong>Pass 2 & 3 (Deep Unburying):</strong> Re-run candidate detection and matched filters over the residual, decoding stations the cancelled carrier had masked in Pass 1.</li>
            </ol>
            <p className="text-[10px] text-[#9A9A9A]">
              Collision performance is <strong>not measured</strong>. A "down to -31.5 dB SNR" recovery figure stood
              here until 2026-09-01 and is withdrawn: it came from no instrument in this project, and
              z30_dsp/benchmark.py - the reference instrument - has no collision or SIC mode to produce it. The
              mechanism above is implemented and tested; its decode rate under collision is not a number this
              project currently has. See wiki/05.
            </p>
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
                  <td className="p-1.5 text-purple-300">{Z30_SPECS.SNR_THRESHOLD_AWGN} dB (50%) / {Z30_SPECS.SNR_THRESHOLD_90_AWGN} dB (90%)</td>
                  <td className="p-1.5 text-[#00FF41]">Yes (3-Pass SIC)</td>
                </tr>
                <tr className="text-[#888]">
                  <td className="p-1.5 text-[#D4D4D4]">FT8</td>
                  <td className="p-1.5">8-FSK</td>
                  <td className="p-1.5">47.0 Hz</td>
                  <td className="p-1.5">15 sec</td>
                  <td className="p-1.5">-21.0 dB</td>
                  <td className="p-1.5 text-[#666]">No</td>
                </tr>
                <tr className="text-[#888]">
                  <td className="p-1.5 text-[#D4D4D4]">FT4</td>
                  <td className="p-1.5">4-FSK</td>
                  <td className="p-1.5">83.0 Hz</td>
                  <td className="p-1.5">7.5 sec</td>
                  <td className="p-1.5">-17.5 dB</td>
                  <td className="p-1.5 text-[#666]">No</td>
                </tr>
                <tr className="text-[#888]">
                  <td className="p-1.5 text-[#D4D4D4]">WSPR</td>
                  <td className="p-1.5">4-FSK</td>
                  <td className="p-1.5">5.9 Hz</td>
                  <td className="p-1.5">120 sec</td>
                  <td className="p-1.5">-28.0 dB</td>
                  <td className="p-1.5 text-[#666]">No (Beacon only)</td>
                </tr>
              </tbody>
            </table>
            {/* Every figure in the Threshold column is an on-air / blind-acquisition number,
                so the column compares like with like. It used to carry z-30's genie-aided
                bound beside the other modes' measured on-air figures, which reads as an
                advantage that does not exist - the error wiki/11 §1.1 records as withdrawn.

                The 2.1 dB z-30 now shows over FT8 is a real like-for-like difference, and it
                is also less than the airtime it costs: 24.0 s against 12.64 s is 2.8 dB more
                energy per message, for 14 fewer payload bits. Per second on the air, z-30 is
                slightly behind FT8, and the text below says so rather than quoting the
                headline number on its own. */}
            <p className="text-[10px] text-[#888] leading-relaxed pt-1">
              All thresholds in this column are like-for-like: z-30's is its own blind-acquisition
              measurement, the others are published over-the-air figures, and both include the same
              acquisition, AFC and timing losses. z-30's genie-aided bound ({Z30_SPECS.SNR_IDEAL_BOUND_AWGN} dB) is deliberately
              <strong className="text-purple-300"> not</strong> in this table &mdash; it is 1.5 dB
              optimistic and belongs beside no other mode's on-air number.
              <strong className="text-[#D4D4D4]"> z-30 decodes 2.1 dB deeper than FT8 while transmitting
              for 1.9&times; as long (2.8 dB more energy) and carrying 14 fewer payload bits &mdash; so
              it buys depth with airtime, and is marginally behind FT8 per second on the air.</strong>
            </p>
          </div>

          {/* The Monte Carlo benchmark now has a single home: Station Settings ->
              5. Experimental Testing. It used to be reachable from here and from the header
              bar as well, which meant three routes to one modal and no obvious owner. */}
          <div className="pt-2 text-[10px] text-[#888] text-right">
            Empirical decoder curves: <span className="text-[#00FF41]">Station Settings &rarr; 5. Experimental Testing &rarr; Launch Benchmark Suite</span>
          </div>
        </div>
      </div>
    </div>
  );
};
