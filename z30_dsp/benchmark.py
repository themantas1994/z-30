"""
z-30 Physical Layer Waveform Generator, AWGN Calibrator & LDPC Decoder Benchmark
================================================================================
1. Generates continuous-phase 16-MFSK physical waveforms with GFSK frequency shaping.
2. Injects calibrated Gaussian noise (AWGN) referenced to standard 2500 Hz audio bandwidth:
     sigma = sqrt( P_signal / ( 10^(SNR_dB / 10) * (5000 / Fs) ) )
3. Demodulates noisy waveforms using 16-tone matched filters and calculates soft channel LLRs.
4. Executes the actual Systematic (216, 77) Normalized Min-Sum LDPC Belief Propagation Decoder.
5. Counts decode successes, failures, empirical Frame Error Rate (FER), and plots FER vs SNR.

WHAT THIS NUMBER IS, AND WHAT IT IS NOT
---------------------------------------
This is a **genie-aided idealised AWGN bound**, not an over-the-air decode threshold. The
demodulator is handed things a real receiver has to work out for itself:

  * the exact noise sigma used to generate the frame;
  * the exact carrier frequency (no frequency error, no AFC, no Doppler);
  * perfect symbol timing - `start_samp = f * samples_per_symbol`, zero offset, because the
    same code generated the waveform;
  * a clean channel: no fading, no interference, no band noise, no ALC.

Every one of those is a real loss in a real contact, and none of them is present here. Quoting
this figure beside a mode's published over-the-air threshold - FT8's -21 dB, say, which is
WSJT-X's measured number and *includes* all of those losses - compares two different
quantities and flatters this one. The README states the comparison in exactly these terms.

Reproducibility: every run is seeded (`--seed`, default DEFAULT_BENCHMARK_SEED). Record the
seed alongside any published curve; an unseeded number cannot be reproduced, bisected, or
verified by anyone else.
"""

import time
import argparse
from typing import List, Optional, Tuple, Dict
import numpy as np

from z30_dsp.modem import Z30Modulator, Z30Config
from z30_dsp.ldpc import Z30LdpcCodec

#: Default PRNG seed. Fixed so the default run is reproducible; override with --seed.
DEFAULT_BENCHMARK_SEED: int = 20260830


def generate_random_frame(
    codec: Z30LdpcCodec,
    cfg: Z30Config,
    rng: Optional[np.random.Generator] = None,
) -> Tuple[np.ndarray, np.ndarray, List[int], List[int]]:
    """
    Generates a random 63-bit amateur payload, encodes to 216-bit LDPC codeword,
    and assembles the 75-symbol 16-MFSK transmission sequence.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    payload_63 = rng.integers(0, 2, 63, dtype=np.uint8)
    codeword_216 = codec.encode(payload_63)
    
    # 54 data symbols (4 bits/symbol)
    data_symbols_54 = []
    for s in range(54):
        idx = s * 4
        tone = (int(codeword_216[idx]) << 3) | (int(codeword_216[idx+1]) << 2) | \
               (int(codeword_216[idx+2]) << 1) | int(codeword_216[idx+3])
        data_symbols_54.append(tone)
        
    # Interleave 21 Costas sync symbols + 54 data symbols -> 75 symbols
    full_symbols_75 = [0] * cfg.total_symbols
    sync_pos_set = set(cfg.sync_positions)
    sync_cnt = 0
    data_cnt = 0
    
    for i in range(cfg.total_symbols):
        if i in sync_pos_set:
            full_symbols_75[i] = cfg.sync_tones[sync_cnt % len(cfg.sync_tones)]
            sync_cnt += 1
        else:
            full_symbols_75[i] = data_symbols_54[data_cnt]
            data_cnt += 1
            
    return payload_63, codeword_216, data_symbols_54, full_symbols_75

def add_calibrated_awgn(
    clean_wave: np.ndarray,
    snr_2500hz_db: float,
    sample_rate_hz: int,
    rng: Optional[np.random.Generator] = None,
) -> Tuple[np.ndarray, float]:
    """
    Adds calibrated AWGN to reach a known SNR referenced to 2500 Hz noise bandwidth.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    signal_power = np.mean(clean_wave ** 2)
    snr_linear = 10.0 ** (snr_2500hz_db / 10.0)
    # Bandwidth correction factor: 2500 Hz noise bandwidth relative to Nyquist (Fs/2)
    bw_factor = 5000.0 / sample_rate_hz
    sigma = np.sqrt(signal_power / (snr_linear * bw_factor))
    
    noise = rng.normal(0.0, sigma, size=len(clean_wave)).astype(np.float32)
    noisy_wave = clean_wave + noise
    return noisy_wave, sigma

def _log_sum_exp(vals: List[float] | np.ndarray) -> float:
    arr = np.array(vals, dtype=np.float64)
    max_val = np.max(arr)
    return float(max_val + np.log(np.sum(np.exp(arr - max_val))))

def demodulate_mfsk_llrs(noisy_wave: np.ndarray, cfg: Z30Config, sigma: float, audio_center_hz: float = 1250.0) -> np.ndarray:
    """
    Pilot-Aided Semi-Coherent 16-tone matched filter bank with exact Log-MAP LLR calculation.
    """
    samples_per_symbol = int(cfg.sample_rate_hz * cfg.symbol_duration_sec)
    sync_positions = cfg.sync_positions
    sync_pos_set = set(sync_positions)
    sync_tones = cfg.sync_tones
    llrs = np.zeros(216, dtype=np.float32)
    
    dt = 1.0 / cfg.sample_rate_hz
    time_vec = np.arange(samples_per_symbol) * dt
    
    # 1. Pilot phase & channel tracking across 21 Costas sync symbols
    pilot_frames = []
    pilot_phases = []
    pilot_amps = []
    
    for p_idx, f in enumerate(sync_positions):
        tone_idx = sync_tones[p_idx % len(sync_tones)]
        tone_freq = audio_center_hz + tone_idx * cfg.tone_spacing_hz
        start_samp = f * samples_per_symbol
        segment = noisy_wave[start_samp:start_samp + samples_per_symbol]
        
        corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * time_vec)))
        corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * time_vec)))
        
        amp = np.sqrt(corr_cos ** 2 + corr_sin ** 2) / (samples_per_symbol / 2.0)
        phase = np.arctan2(corr_sin, corr_cos)
        
        pilot_frames.append(f)
        pilot_phases.append(phase)
        pilot_amps.append(amp)
        
    quad_noise_var = max(1e-12, ((sigma ** 2) * samples_per_symbol) / 2.0)
    est_sig_amp = max(0.01, float(np.mean(pilot_amps)))
    s_corr = (est_sig_amp * samples_per_symbol / 2.0) / quad_noise_var

    # Continuous-phase FSK carries phase across symbol boundaries: each symbol advances the
    # modulator's phase accumulator by 2*pi*tone_freq*symbol_duration mod 2*pi. Because
    # tone_spacing_hz is exactly 1/symbol_duration_sec by construction, that increment is
    # IDENTICAL for every tone (the per-tone term is always a whole number of cycles) - it
    # only depends on audio_center_hz. So the phase gap between a pilot and a nearby data
    # symbol is fully predictable and must be added back in before projecting onto the
    # pilot's raw phase, or the "coherent" LLR term is measured against the wrong reference
    # for any audio_center_hz that isn't an exact multiple of tone_spacing_hz.
    base_phase_step = (2.0 * np.pi * audio_center_hz * cfg.symbol_duration_sec) % (2.0 * np.pi)

    data_sym_idx = 0
    for frame_sym_idx in range(cfg.total_symbols):
        if frame_sym_idx in sync_pos_set:
            continue

        # Interpolate pilot phase, propagated to this symbol's position via the known
        # per-symbol continuous-phase increment.
        closest_p = np.argmin(np.abs(np.array(pilot_frames) - frame_sym_idx))
        raw_phase = pilot_phases[closest_p] - base_phase_step * (frame_sym_idx - pilot_frames[closest_p])
        interp_phase = np.arctan2(np.sin(raw_phase), np.cos(raw_phase))
        min_pilot_dist = abs(pilot_frames[closest_p] - frame_sym_idx)
        pilot_coherence = max(0.35, min(0.85, 1.0 / (1.0 + 0.15 * min_pilot_dist)))
        
        start_samp = frame_sym_idx * samples_per_symbol
        segment = noisy_wave[start_samp:start_samp + samples_per_symbol]
        
        tone_log_likes = np.zeros(16, dtype=np.float64)
        for tone in range(16):
            tone_freq = audio_center_hz + tone * cfg.tone_spacing_hz
            corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * time_vec)))
            corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * time_vec)))
            raw_energy = corr_cos ** 2 + corr_sin ** 2
            
            envelope = np.sqrt(raw_energy)
            z = envelope * s_corr
            # log(I0(z)) approximation
            non_coherent = z - 0.5 * np.log(max(1.0, 2.0 * np.pi * z)) if z > 15 else np.log(max(1e-12, np.i0(z)))
            
            proj = corr_cos * np.cos(interp_phase) + corr_sin * np.sin(interp_phase)
            coherent = proj * s_corr
            
            tone_log_likes[tone] = pilot_coherence * coherent + (1.0 - pilot_coherence) * non_coherent
            
        # Exact Log-MAP demapping
        for bit in range(4):
            bit_mask = 1 << (3 - bit)
            likes0 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) == 0]
            likes1 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) != 0]
            
            llr = _log_sum_exp(likes0) - _log_sum_exp(likes1)
            llrs[data_sym_idx * 4 + bit] = np.clip(llr, -25.0, 25.0)
            
        data_sym_idx += 1
        
    return llrs

def run_monte_carlo_snr_sweep(
    min_snr_db: float = -33.0,
    max_snr_db: float = -23.0,
    step_snr_db: float = 1.0,
    frames_per_snr: int = 50,
    sample_rate_hz: int = 6000,
    seed: int = DEFAULT_BENCHMARK_SEED,
) -> List[Dict]:
    """
    Runs physical waveform generation, calibrated AWGN, and LDPC decoding across SNR points.

    See the module docstring: this measures an idealised AWGN bound with perfect
    synchronisation, not an over-the-air decode threshold.
    """
    rng = np.random.default_rng(seed)
    cfg = Z30Config(sample_rate_hz=sample_rate_hz)
    modulator = Z30Modulator(cfg)
    codec = Z30LdpcCodec(max_iterations=45, alpha=0.75)
    
    snr_points = np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db)
    results = []
    
    print("=" * 80)
    print("  z-30 PHYSICAL WAVEFORM & CALIBRATED AWGN MONTE CARLO DECODER BENCHMARK")
    print(f"  Configuration: {frames_per_snr} frames/point | Sample Rate: {sample_rate_hz} Hz | "
          f"Max Iterations: 45 | Seed: {seed}")
    print("  IDEALISED AWGN BOUND: exact noise sigma, exact carrier frequency and perfect symbol")
    print("  timing are given to the demodulator. No frequency error, timing error, Doppler,")
    print("  fading or interference. This is NOT an over-the-air decode threshold and is not")
    print("  comparable with the published on-air figures for FT8 or other modes.")
    print("=" * 80)
    print(f"{'SNR (2500Hz)':<14} | {'Frames':<8} | {'Success':<8} | {'Failed':<8} | {'FER':<10} | {'Decode %':<10} | {'Avg Iters':<10}")
    print("-" * 80)
    
    for snr in snr_points:
        t_start = time.time()
        successes = 0
        failures = 0
        total_iters = 0
        
        for f in range(frames_per_snr):
            # 1. Generate real random payload and symbols
            payload, codeword, data_symbols, full_symbols = generate_random_frame(codec, cfg, rng)
            
            # 2. Synthesize physical continuous-phase 16-MFSK waveform
            clean_wave = modulator.synthesize_frame(full_symbols, base_audio_freq_hz=1250.0)
            
            # 3. Add calibrated Gaussian noise (AWGN in 2500 Hz reference BW)
            noisy_wave, sigma = add_calibrated_awgn(clean_wave, snr, cfg.sample_rate_hz, rng)
            
            # 4. Demodulate via 16-tone matched filters -> Soft LLRs
            channel_llrs = demodulate_mfsk_llrs(noisy_wave, cfg, sigma, audio_center_hz=1250.0)
            
            # 5. Run actual Systematic (216, 77) Normalized Min-Sum LDPC Decoder
            success, decoded_info, iters = codec.decode_min_sum(channel_llrs)
            total_iters += iters
            
            if success:
                # Validate CRC-14
                rcvd_crc = int("".join(str(b) for b in decoded_info[63:]), 2)
                comp_crc = codec.compute_crc14(decoded_info[:63])
                if rcvd_crc == comp_crc:
                    successes += 1
                else:
                    failures += 1
            else:
                failures += 1
                
        fer = failures / frames_per_snr
        decode_pct = (successes / frames_per_snr) * 100.0
        avg_iters = total_iters / frames_per_snr
        elapsed = time.time() - t_start
        
        res = {
            "snr_db": float(snr),
            "total_frames": frames_per_snr,
            "successes": successes,
            "failures": failures,
            "fer": fer,
            "decode_pct": decode_pct,
            "avg_iters": avg_iters,
            "elapsed_sec": elapsed,
            "seed": seed,
        }
        results.append(res)
        
        print(f"{snr:+6.1f} dB      | {frames_per_snr:<8} | {successes:<8} | {failures:<8} | {fer:<10.4f} | {decode_pct:>7.1f}%   | {avg_iters:>6.1f} iters")
        
    print("=" * 80)
    
    # ASCII Plot of Decode Probability and FER against SNR
    plot_ascii_curves(results)
    return results

def plot_ascii_curves(results: List[Dict]):
    """Renders ASCII plots for Decode Probability (%) and Frame Error Rate (FER) vs SNR."""
    print("\n" + "=" * 80)
    print("                      DECODE PROBABILITY (%) vs SNR (dB)")
    print("=" * 80)
    
    plot_height = 12
    plot_width = len(results)
    
    # Y-axis from 100% down to 0%
    for y_step in range(plot_height, -1, -1):
        pct_threshold = (y_step / plot_height) * 100.0
        row_str = f"{pct_threshold:5.0f}% | "
        for res in results:
            val = res["decode_pct"]
            if val >= pct_threshold:
                row_str += "  #  "
            elif val >= pct_threshold - (100.0 / (plot_height * 2)):
                row_str += "  :  "
            else:
                row_str += "  .  "
        print(row_str)
        
    print("       +" + "-----" * plot_width)
    snr_header = " SNR:   "
    for res in results:
        snr_header += f"{res['snr_db']:+4.0f} "
    print(snr_header + " (dB / 2500Hz)")
    print("=" * 80)
    
    print("\n" + "=" * 80)
    print("                      FRAME ERROR RATE (FER) vs SNR (dB)")
    print("=" * 80)
    
    fer_levels = [1.0, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05, 0.01, 0.001, 0.0]
    for lvl in fer_levels:
        row_str = f"{lvl:5.3f} | "
        for res in results:
            fer_val = res["fer"]
            if fer_val >= lvl:
                row_str += "  X  "
            else:
                row_str += "  .  "
        print(row_str)
        
    print("       +" + "-----" * plot_width)
    print(snr_header + " (dB / 2500Hz)")
    print("=" * 80 + "\n")

def run_benchmark(seed: int = DEFAULT_BENCHMARK_SEED):
    run_monte_carlo_snr_sweep(
        min_snr_db=-30.0,
        max_snr_db=-20.0,
        step_snr_db=1.0,
        frames_per_snr=25,
        sample_rate_hz=6000,
        seed=seed,
    )

run_self_test = run_benchmark
main = run_benchmark

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="z-30 Monte Carlo Physical Waveform & SNR Decoder Benchmark")
    parser.add_argument("--min-snr", type=float, default=-30.0, help="Minimum SNR in dB (2500Hz reference)")
    parser.add_argument("--max-snr", type=float, default=-20.0, help="Maximum SNR in dB (2500Hz reference)")
    parser.add_argument("--step", type=float, default=1.0, help="SNR step in dB")
    parser.add_argument("--frames", type=int, default=30, help="Frames per SNR test point")
    parser.add_argument("--seed", type=int, default=DEFAULT_BENCHMARK_SEED,
                        help="PRNG seed. Record it with any published result.")
    args = parser.parse_args()

    run_monte_carlo_snr_sweep(
        min_snr_db=args.min_snr,
        max_snr_db=args.max_snr,
        step_snr_db=args.step,
        frames_per_snr=args.frames,
        seed=args.seed,
    )
