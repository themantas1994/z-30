"""
z-30 Physical Layer Waveform Generator, AWGN Calibrator & LDPC Decoder Benchmark
================================================================================
1. Generates continuous-phase 16-MFSK physical waveforms with GFSK frequency shaping.
2. Injects calibrated Gaussian noise (AWGN) referenced to standard 2500 Hz audio bandwidth:
     sigma = sqrt( P_signal / ( 10^(SNR_dB / 10) * (5000 / Fs) ) )
3. Demodulates noisy waveforms using 16-tone matched filters and calculates soft channel LLRs.
4. Executes the actual Systematic (216, 77) Normalized Min-Sum LDPC Belief Propagation Decoder.
5. Counts decode successes, failures, empirical Frame Error Rate (FER), and plots FER vs SNR.

TWO MEASUREMENT MODES, AND THE DIFFERENCE BETWEEN THEM IS THE POINT
-------------------------------------------------------------------
`--mode realistic` (default) measures a **decode threshold**. Every frame gets a random
carrier offset, a random timing offset and Watterson HF fading; the receiver is then handed
nothing but audio and must find the frame itself (`z30_dsp.acquisition`), estimate the noise
level itself, and decode from whatever it found. This is the number that is comparable with
other modes' published on-air figures.

`--mode ideal` measures a **genie-aided idealised AWGN bound**, which is NOT an over-the-air
decode threshold. The demodulator is handed things a real receiver has to work out for itself:

  * the exact noise sigma used to generate the frame;
  * the exact carrier frequency (no frequency error, no AFC, no Doppler);
  * perfect symbol timing - `start_samp = f * samples_per_symbol`, zero offset, because the
    same code generated the waveform;
  * a clean channel: no fading, no interference, no band noise, no ALC.

Every one of those is a real loss in a real contact, and none of them is present in `ideal`.
Quoting that figure beside a mode's published over-the-air threshold - FT8's -21 dB, say,
which is WSJT-X's measured number and *includes* all of those losses - compares two different
quantities and flatters this one. Measured on this code, the gap between the two modes is
about 3.7 dB on AWGN, and about 7 dB once moderate fading is present: the bound is -24.7 dB
while the blind-acquisition threshold is -21.0 dB on AWGN and -17.6 dB on a CCIR-moderate
path. The README states the comparison in exactly these terms.

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
from z30_dsp.channel import ChannelImpairments, impair_frame, WATTERSON_PRESETS
from z30_dsp.acquisition import acquire_frame

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
    signal_power: Optional[float] = None,
) -> Tuple[np.ndarray, float]:
    """
    Adds calibrated AWGN to reach a known SNR referenced to 2500 Hz noise bandwidth.

    `signal_power` may be given explicitly when `clean_wave` contains silent guard padding, as
    it does in realistic mode where the frame sits somewhere inside a longer buffer. Averaging
    over that padding would understate the signal power and so overstate the SNR - the frame
    would quietly be tested easier than the label on the curve claims.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    signal_power = float(signal_power) if signal_power is not None else float(np.mean(clean_wave ** 2))
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

def demodulate_mfsk_llrs(
    noisy_wave: np.ndarray,
    cfg: Z30Config,
    sigma: float,
    audio_center_hz: float = 1250.0,
    start_sample: int = 0,
) -> np.ndarray:
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
        start_samp = start_sample + f * samples_per_symbol
        segment = noisy_wave[start_samp:start_samp + samples_per_symbol]
        if segment.size < samples_per_symbol:
            segment = np.pad(segment, (0, samples_per_symbol - segment.size))
        
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
        
        start_samp = start_sample + frame_sym_idx * samples_per_symbol
        segment = noisy_wave[start_samp:start_samp + samples_per_symbol]
        if segment.size < samples_per_symbol:
            segment = np.pad(segment, (0, samples_per_symbol - segment.size))
        
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
    mode: str = "realistic",
    fading: str = "moderate",
    max_freq_offset_hz: float = 5.0,
    max_time_offset_sec: float = 0.5,
) -> List[Dict]:
    """
    Runs waveform generation, channel impairment, acquisition and LDPC decoding across SNR.

    Args:
        mode: "realistic" - random carrier/timing offsets and Watterson fading, with blind
              acquisition and blind noise estimation. This yields a decode threshold.
              "ideal" - exact sigma, exact carrier, perfect timing, no impairments. This
              yields a bound, not a threshold. See the module docstring.
        fading: Watterson preset for realistic mode: none / good / moderate / poor.
        seed: master seed. The same seed and configuration always produce the same curve.
    """
    if mode not in ("realistic", "ideal"):
        raise ValueError(f"mode must be 'realistic' or 'ideal'; got {mode!r}")
    if fading not in WATTERSON_PRESETS:
        raise ValueError(f"fading must be one of {sorted(WATTERSON_PRESETS)}; got {fading!r}")

    rng = np.random.default_rng(seed)
    impairments = ChannelImpairments(
        max_freq_offset_hz=max_freq_offset_hz,
        max_time_offset_sec=max_time_offset_sec,
        fading=fading,
    )
    cfg = Z30Config(sample_rate_hz=sample_rate_hz)
    modulator = Z30Modulator(cfg)
    codec = Z30LdpcCodec(max_iterations=45, alpha=0.75)
    
    snr_points = np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db)
    results = []
    
    print("=" * 96)
    if mode == "ideal":
        print("  z-30 IDEALISED AWGN BOUND (genie-aided)")
        print("  Exact noise sigma, exact carrier frequency and perfect symbol timing are given to")
        print("  the demodulator. No frequency error, timing error, Doppler, fading or interference.")
        print("  This is NOT an over-the-air decode threshold and is NOT comparable with the")
        print("  published on-air figures for FT8 or other modes.")
    else:
        preset = impairments.preset
        print("  z-30 DECODE THRESHOLD (blind acquisition through the real receive chain)")
        print(f"  Carrier offset +/-{max_freq_offset_hz:.1f} Hz | timing offset +/-{max_time_offset_sec:.2f} s | "
              f"fading: {preset.name} ({preset.delay_spread_ms:.1f} ms / {preset.doppler_spread_hz:.1f} Hz)")
        print("  The receiver is given only audio: it finds the frame and estimates the noise itself.")
    print(f"  {frames_per_snr} frames/point | Sample Rate: {sample_rate_hz} Hz | "
          f"Max Iterations: 45 | Seed: {seed}")
    print("=" * 96)
    header = (f"{'SNR (2500Hz)':<14} | {'Frames':<7} | {'Success':<8} | {'FER':<9} | "
              f"{'Decode %':<9} | {'Avg Iters':<10}")
    if mode == "realistic":
        header += f" | {'Acq fail':<8} | {'Timing RMS':<11} | {'Freq RMS':<9}"
    print(header)
    print("-" * 96)
    
    for snr in snr_points:
        t_start = time.time()
        successes = 0
        failures = 0
        acq_failures = 0
        total_iters = 0
        timing_errs: List[float] = []
        freq_errs: List[float] = []

        for f in range(frames_per_snr):
            # 1. Generate real random payload and symbols
            payload, codeword, data_symbols, full_symbols = generate_random_frame(codec, cfg, rng)

            # 2. Synthesize physical continuous-phase 16-MFSK waveform
            clean_wave = modulator.synthesize_frame(full_symbols, base_audio_freq_hz=1250.0)
            frame_power = float(np.mean(clean_wave ** 2))

            if mode == "ideal":
                # 3a. Calibrated AWGN only, and the demodulator is told everything.
                noisy_wave, sigma = add_calibrated_awgn(
                    clean_wave, snr, cfg.sample_rate_hz, rng, frame_power
                )
                start_sample = 0
                base_freq = 1250.0
            else:
                # 3b. Fading, carrier offset and timing offset, then noise across the whole
                #     buffer - referenced to the frame's own power, not the padded buffer's.
                buf, true_start, true_foff = impair_frame(
                    clean_wave, cfg.sample_rate_hz, impairments, rng
                )
                noisy_wave, _true_sigma = add_calibrated_awgn(
                    buf, snr, cfg.sample_rate_hz, rng, frame_power
                )

                # 4b. Blind acquisition: the receiver gets audio and nothing else.
                acq = acquire_frame(noisy_wave, cfg, nominal_base_freq_hz=1250.0)
                start_sample = acq.start_sample
                base_freq = acq.base_freq_hz
                sigma = acq.noise_sigma
                timing_errs.append((start_sample - true_start) / cfg.sample_rate_hz)
                freq_errs.append(base_freq - (1250.0 + true_foff))
                # Landing more than half a symbol out cannot decode. Counted separately so an
                # acquisition failure is visible rather than hidden inside the FER.
                if abs(start_sample - true_start) > cfg.symbol_duration_sec * cfg.sample_rate_hz / 2:
                    acq_failures += 1

            # 5. Demodulate via 16-tone matched filters -> Soft LLRs
            channel_llrs = demodulate_mfsk_llrs(
                noisy_wave, cfg, sigma, audio_center_hz=base_freq, start_sample=start_sample
            )

            # 6. Run actual Systematic (216, 77) Normalized Min-Sum LDPC Decoder
            success, decoded_info, iters = codec.decode_min_sum(channel_llrs)
            total_iters += iters

            if success:
                # Validate CRC-14, and check the payload really is the one transmitted: a
                # converged codeword with a matching CRC that decoded to the wrong message is
                # a false decode, not a success.
                rcvd_crc = int("".join(str(b) for b in decoded_info[63:]), 2)
                comp_crc = codec.compute_crc14(decoded_info[:63])
                if rcvd_crc == comp_crc and np.array_equal(decoded_info[:63], payload):
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
            "mode": mode,
            "fading": fading if mode == "realistic" else "none",
        }
        if mode == "realistic":
            res["acq_failures"] = acq_failures
            res["timing_rms_ms"] = float(np.sqrt(np.mean(np.square(timing_errs))) * 1000.0) if timing_errs else 0.0
            res["freq_rms_hz"] = float(np.sqrt(np.mean(np.square(freq_errs)))) if freq_errs else 0.0
        results.append(res)

        row = (f"{snr:+6.1f} dB      | {frames_per_snr:<7} | {successes:<8} | {fer:<9.4f} | "
               f"{decode_pct:>7.1f}%  | {avg_iters:>6.1f}    ")
        if mode == "realistic":
            row += f" | {acq_failures:<8} | {res['timing_rms_ms']:>8.1f} ms | {res['freq_rms_hz']:>6.2f} Hz"
        print(row)

    print("=" * 96)

    # ASCII Plot of Decode Probability and FER against SNR
    plot_ascii_curves(results)

    threshold = decode_threshold_db(results)
    label = ("decode threshold (50% frame decode, blind acquisition)" if mode == "realistic"
             else "idealised AWGN bound (50% frame decode, genie-aided sync)")
    if threshold is None:
        print("  50% crossing is outside the swept range - widen --min-snr / --max-snr.")
    else:
        print(f"  {label}: {threshold:+.1f} dB (2500 Hz reference bandwidth), seed {seed}")
    if mode == "ideal":
        print("  Reminder: this excludes every acquisition loss and is NOT comparable with the")
        print("  published on-air sensitivity figures for FT8, JS8 or WSPR.")
    print("=" * 96)
    return results


def decode_threshold_db(results: List[Dict]) -> Optional[float]:
    """
    The SNR at which 50% of frames decode, linearly interpolated between the two swept points
    that bracket the crossing. Returns None when the sweep never crosses 50%.
    """
    ordered = sorted(results, key=lambda r: r["snr_db"])
    for lower, upper in zip(ordered, ordered[1:]):
        if lower["decode_pct"] < 50.0 <= upper["decode_pct"]:
            span = upper["decode_pct"] - lower["decode_pct"]
            if span <= 0:
                return float(upper["snr_db"])
            frac = (50.0 - lower["decode_pct"]) / span
            return float(lower["snr_db"] + frac * (upper["snr_db"] - lower["snr_db"]))
    return None

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
    """Default entry point (`z30 --benchmark`): the honest, realistic curve."""
    return run_monte_carlo_snr_sweep(
        min_snr_db=-26.0,
        max_snr_db=-14.0,
        step_snr_db=1.0,
        frames_per_snr=25,
        sample_rate_hz=6000,
        seed=seed,
        mode="realistic",
    )


run_self_test = run_benchmark
main = run_benchmark

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="z-30 Monte Carlo waveform, channel and LDPC decoder benchmark.",
        epilog="realistic mode measures a decode threshold; ideal mode measures a genie-aided bound.",
    )
    parser.add_argument("--mode", choices=("realistic", "ideal"), default="realistic",
                        help="realistic: random carrier/timing offsets, Watterson fading and blind "
                             "acquisition (default). ideal: exact sigma/carrier/timing, no "
                             "impairments - a bound, not a threshold.")
    parser.add_argument("--fading", choices=sorted(WATTERSON_PRESETS), default="moderate",
                        help="Watterson channel preset for realistic mode (default: moderate).")
    parser.add_argument("--freq-offset", type=float, default=5.0,
                        help="Maximum random carrier offset in Hz (default: 5.0).")
    parser.add_argument("--time-offset", type=float, default=0.5,
                        help="Maximum random timing offset in seconds (default: 0.5).")
    parser.add_argument("--min-snr", type=float, default=-26.0, help="Minimum SNR in dB (2500Hz reference)")
    parser.add_argument("--max-snr", type=float, default=-14.0, help="Maximum SNR in dB (2500Hz reference)")
    parser.add_argument("--step", type=float, default=1.0, help="SNR step in dB")
    parser.add_argument("--frames", type=int, default=30, help="Frames per SNR test point")
    parser.add_argument("--sample-rate", type=int, default=6000, help="Simulation sample rate in Hz")
    parser.add_argument("--seed", type=int, default=DEFAULT_BENCHMARK_SEED,
                        help="PRNG seed. Record it with any published result.")
    args = parser.parse_args()

    run_monte_carlo_snr_sweep(
        min_snr_db=args.min_snr,
        max_snr_db=args.max_snr,
        step_snr_db=args.step,
        frames_per_snr=args.frames,
        sample_rate_hz=args.sample_rate,
        seed=args.seed,
        mode=args.mode,
        fading=args.fading,
        max_freq_offset_hz=args.freq_offset,
        max_time_offset_sec=args.time_offset,
    )
