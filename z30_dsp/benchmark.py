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
quantities and flatters this one. Measured on this code at seed DEFAULT_BENCHMARK_SEED, 200
frames per point: the bound is -24.58 dB [-24.69, -24.48], while the blind-acquisition
threshold is -22.92 dB [-23.07, -22.79] on AWGN. The gap between them - 1.66 dB - is the
acquisition loss, what it costs to *find* a 3.125 Hz-spaced signal rather than be told where
it is. wiki/16 carries the full set, including the ITU-R F.1487 fading conditions, and the
README states the comparison in the same terms.

THE METHOD IS NOT INVENTED HERE
-------------------------------
Everything about how these numbers are produced is the convention the modes z-30 is compared
against already use, so that the figures mean the same thing:

  * Sensitivity is the SNR in a 2500 Hz reference noise bandwidth at which decode probability
    reaches 50%. That is how WSJT-X publishes every one of its modes, and it is the only
    reason an FT8 figure and a z-30 figure can sit in the same column.
  * It is measured by Monte Carlo simulation through the decoder that SHIPS, not through a
    model of it. `demodulate_mfsk_llrs` and `Z30LdpcCodec.decode_min_sum` here are the same
    functions `sic_decoder.py` calls on live audio. A benchmark that reimplements the receiver
    measures the reimplementation - see RECEIVER_PILOT_COHERENCE for what that cost when the
    two drifted apart.
  * The channels are AWGN plus the named test conditions of Recommendation ITU-R F.1487; see
    channel.WATTERSON_PRESETS.
  * A published sensitivity figure excludes a priori information. The sweep runs the ordinary
    decoder; the hypothesis ladder is a separate instrument (`--ap`) reported separately, the
    same way WSJT-X's tables give "no AP" and "max AP" as two different numbers.
  * A simulated error rate is quoted with a confidence interval, not as a bare point estimate.
    Every decode rate here carries its 95% Wilson score interval and every crossing carries the
    band those intervals imply - see wilson_interval and PUBLISHABLE_FRAMES_PER_POINT.

Reproducibility: every run is seeded (`--seed`, default DEFAULT_BENCHMARK_SEED). Record the
seed alongside any published curve; an unseeded number cannot be reproduced, bisected, or
verified by anyone else.
"""

import os
import math
import time
import argparse
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple, Dict
import numpy as np

from z30_dsp.modem import Z30Modulator, Z30Config, codeword_to_symbols
from z30_dsp.ldpc import Z30LdpcCodec, LDPC_MAX_ITERATIONS, DECODE_SCHEDULES
from z30_dsp.channel import ChannelImpairments, impair_frame, WATTERSON_PRESETS
from z30_dsp.acquisition import acquire_frame, slot_timing_search_sec
from z30_dsp.ap_decode import ApHypothesis, build_ap_hypotheses, decode_with_ap
from z30_dsp.message_codec import (
    EXTRA_73,
    EXTRA_RR73,
    EXTRA_RRR,
    callsign_round_trips,
    extra_code_for_report,
    pack_payload63,
)

#: Default PRNG seed. Fixed so the default run is reproducible; override with --seed.
DEFAULT_BENCHMARK_SEED: int = 20260830

#: Default worker count for the sweep. One - the serial path - deliberately.
#:
#: Parallelism here is a wall-clock optimisation and nothing else: the curve a run produces is
#: identical at every worker count, and `tests/test_benchmark_parallel.py` asserts that rather
#: than trusting it. The default stays serial anyway, so a published figure is reproduced by
#: the same code path that has always produced it, and `--workers N` is an explicit choice made
#: by whoever is waiting for the run.
DEFAULT_BENCHMARK_WORKERS: int = 1

#: Frames dispatched to the pool per worker in one batch.
#:
#: Frames are prepared sequentially (they consume the sweep's one PRNG, in order) and decoded in
#: parallel, so every prepared-but-not-yet-decoded frame is a ~0.7 MB audio buffer sitting in
#: memory. Batching bounds that by the worker count instead of by --frames, which is free to be
#: 1000, while still keeping every worker fed.
PARALLEL_CHUNK_PER_WORKER: int = 4

#: Frames per SNR point below which a run is exploratory rather than publishable.
#:
#: 200 is not a round number picked for comfort. A decode rate is a binomial proportion, and at
#: 200 frames its 95% Wilson interval is at worst +/-6.9 percentage points, which at the slope
#: this mode's decode curve has near threshold is about +/-0.3 dB on the interpolated crossing -
#: the precision a figure quoted to one decimal place is claiming. At the 40 frames the
#: published table used to be measured at, the same interval is +/-15 points and the crossing is
#: uncertain by most of a dB, so two runs of the same code could differ by more than most of the
#: changes anyone would want to measure. Monte Carlo error-rate estimation has quoted intervals
#: alongside point estimates for decades, and the sample sizes that make a percentage-point
#: interval usable are in the hundreds; this is that, at the lower end.
#:
#: Enforced as a printed notice rather than a refusal: a 20-frame run is the right tool for
#: "did I break the decoder", and the run itself is not wrong - only the act of publishing its
#: crossing as a sensitivity figure would be.
PUBLISHABLE_FRAMES_PER_POINT: int = 200


#: Weight of the coherent term in the per-tone likelihood, for the receiver z-30 actually runs.
#:
#: Zero. z-30's receiver is specified to demodulate non-coherently (AGENTS.md section 1), and
#: under the timing error a real receiver is left with after finding the frame itself, the
#: pilot-aided "coherent" contribution subtracts performance instead of adding it: a few
#: milliseconds of residual timing error rotates a tone at f by 2*pi*f*dt relative to the pilot
#: it is being projected onto, so the term is measured against the wrong phase reference and
#: begins cancelling signal.
#:
#: THIS CONSTANT IS THE RECEIVER'S, NOT THE BENCHMARK'S. It was called
#: RECEIVER_PILOT_COHERENCE, which named a benchmark mode, and that name is exactly how the
#: defect it now prevents went unnoticed: the two benchmarks passed 0.0 while the two on-air
#: decoders - `sic_decoder._estimate_llrs`, which took `demodulate_mfsk_llrs`'s default, and
#: realReceiver.ts's `demodulateReal`, which hardcoded the weight - went on applying the
#: pilot-distance-adaptive 0.35-0.85. The published decode threshold therefore described a
#: receiver that did not ship, and the receiver that did ship had never been measured. It is
#: now the default of `demodulate_mfsk_llrs`, so a caller has to ask for anything else.
#:
#: Measured paired with `--compare-demod`: one channel realisation, one acquisition and one
#: noise draw per frame, demodulated twice and decoded twice, so nothing but the weight differs
#: between the arms. Seed DEFAULT_BENCHMARK_SEED, 100 frames per point, AWGN, blind
#: acquisition, carrier offset +/-5 Hz, timing offset +/-0.5 s:
#:
#:      SNR      non-coherent   semi-coherent   non-coh only   semi only   timing RMS
#:     -25 dB        1/100           1/100            1             1        19.8 ms
#:     -24 dB        4/100          13/100            3            12        18.2 ms
#:     -23 dB       51/100          18/100           41             8        14.8 ms
#:     -22 dB       93/100          35/100           58             0        12.0 ms
#:     -21 dB      100/100          55/100           45             0         8.7 ms
#:     -20 dB      100/100          76/100           24             0         6.9 ms
#:     -19 dB      100/100          78/100           22             0         5.9 ms
#:
#: Pooled over the 700 frames: 194 discordant pairs won by the non-coherent receiver against
#: 21 by the semi-coherent one, exact two-sided McNemar p = 2.9e-36. The 50% crossings are
#: -23.02 dB [-23.21, -22.81] against -21.25 dB [-21.73, -20.78], 95% Wilson bands that do not
#: overlap: the coherent term was costing the shipped receiver 1.77 dB.
#:
#: The -24 dB row is recorded rather than dropped, and it goes the other way (12 to 3 for the
#: semi-coherent arm). Both arms are under 15% there, below the SNR at which the Costas pattern
#: is reliably findable at all, which is not an SNR a station operates at.
#:
#: The mechanism was confirmed rather than assumed, by running the identical comparison with
#: perfect symbol timing handed to the demodulator (`--compare-demod --mode ideal`, 100 frames
#: per point, -27 to -22 dB): with an exact phase reference the coherent term is worth having,
#: and the result reverses completely - 136 discordant pairs to 1 for the semi-coherent arm,
#: p = 1.6e-39, 50% crossings -24.58 dB against -23.29 dB. So the term is worth +1.29 dB when
#: the timing is exact and costs -1.77 dB when the receiver has to find the frame itself. That
#: is why `ideal` mode keeps the pilot-distance-adaptive weight and passes it explicitly: it is
#: a genie-aided bound, and the genie includes the phase reference.
RECEIVER_PILOT_COHERENCE: float = 0.0


def generate_random_frame(
    codec: Z30LdpcCodec,
    cfg: Z30Config,
    rng: Optional[np.random.Generator] = None,
    payload_63: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, np.ndarray, List[int], List[int]]:
    """
    Generates a random 63-bit amateur payload, encodes to 216-bit LDPC codeword,
    and assembles the 75-symbol 16-MFSK transmission sequence.

    `payload_63` supplies the payload instead of drawing one, for the a priori sweep, where the
    frames have to be real QSO messages rather than random bits. When it is None - every caller
    that existed before AP did - the draw is the one this function has always made, from the
    shared generator, in the same order.
    """
    rng = rng if rng is not None else np.random.default_rng(DEFAULT_BENCHMARK_SEED)
    if payload_63 is None:
        payload_63 = rng.integers(0, 2, 63, dtype=np.uint8)
    else:
        payload_63 = np.asarray(payload_63, dtype=np.uint8)
    codeword_216 = codec.encode(payload_63)

    # 54 data symbols (4 bits/symbol), used below only to report them separately from the
    # interleaved frame; codeword_to_symbols recomputes the same packing internally.
    data_symbols_54 = []
    for s in range(54):
        idx = s * 4
        tone = (int(codeword_216[idx]) << 3) | (int(codeword_216[idx+1]) << 2) | \
               (int(codeword_216[idx+2]) << 1) | int(codeword_216[idx+3])
        data_symbols_54.append(tone)

    # Interleave 21 Costas sync symbols + 54 data symbols -> 75 symbols
    full_symbols_75 = codeword_to_symbols(codeword_216, cfg)

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

# Quoted, like the unions in ldpc.py. AGENTS.md section 7 puts the support floor at Python
# 3.9, where PEP 604's `X | Y` does not exist on `typing.List` or on a class object, so an
# unquoted union here is evaluated at def time and raises TypeError on import - taking the
# whole benchmark module, and everything that imports it, down on a supported interpreter.
# CI runs 3.10 and up, so nothing here would have caught it.
def _log_sum_exp(vals: "List[float] | np.ndarray") -> float:
    arr = np.array(vals, dtype=np.float64)
    max_val = np.max(arr)
    return float(max_val + np.log(np.sum(np.exp(arr - max_val))))

def demodulate_mfsk_llrs(
    noisy_wave: np.ndarray,
    cfg: Z30Config,
    sigma: float,
    audio_center_hz: float = 1250.0,
    start_sample: int = 0,
    pilot_coherence: Optional[float] = RECEIVER_PILOT_COHERENCE,
) -> np.ndarray:
    """
    16-tone matched filter bank with exact Log-MAP LLR calculation.

    Args:
        pilot_coherence: weight of the coherent term in the per-tone likelihood, 0 to 1.
            Defaults to RECEIVER_PILOT_COHERENCE - the receiver z-30 ships, non-coherent, and
            the one every published threshold describes. `None` selects the
            pilot-distance-adaptive weight (0.35 to 0.85) instead, which is worth having only
            when the caller can hand the demodulator exact symbol timing; `benchmark.py`'s
            `ideal` mode is the only caller that can, and it asks for it explicitly.

            The default used to be `None`, which is how the on-air decoder and the benchmark
            ended up running different receivers - see RECEIVER_PILOT_COHERENCE for the paired
            measurement of what that cost.
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
        sym_coherence = (
            pilot_coherence if pilot_coherence is not None
            else max(0.35, min(0.85, 1.0 / (1.0 + 0.15 * min_pilot_dist)))
        )
        
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
            
            tone_log_likes[tone] = sym_coherence * coherent + (1.0 - sym_coherence) * non_coherent
            
        # Exact Log-MAP demapping
        for bit in range(4):
            bit_mask = 1 << (3 - bit)
            likes0 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) == 0]
            likes1 = [tone_log_likes[t] for t in range(16) if (t & bit_mask) != 0]
            
            llr = _log_sum_exp(likes0) - _log_sum_exp(likes1)
            llrs[data_sym_idx * 4 + bit] = np.clip(llr, -25.0, 25.0)
            
        data_sym_idx += 1
        
    return llrs

# ---------------------------------------------------------------------------------------------
# Splitting the sweep into a sequential producer and a parallel consumer.
#
# The sweep draws every random value it needs - payload bits, the Watterson tap processes, the
# carrier and timing offsets, the AWGN - from ONE `np.random.Generator`, consumed strictly in
# call order. That shared, order-dependent state is the whole obstacle to running frames
# concurrently, and there are two ways past it.
#
# The obvious one, and the one a first design reaches for, is to give each frame its own
# generator seeded from (master_seed, snr_index, frame_index). It parallelises everything - and
# it draws different numbers, so it produces a different curve at the same seed. The published
# thresholds in wiki/16 would all have to be re-measured, and AGENTS.md section 5 is explicit
# about what that costs. Speed is not a reason to move a published figure.
#
# The other one is this: keep the generator exactly where it is, and split the frame loop by
# whether a stage touches it.
#
#   * `_prepare_frame` consumes the PRNG, in the original order, on the main process. It is the
#     transmitter and the channel: payload, waveform, fading, offsets, noise.
#   * `decode_prepared_frame` consumes nothing. It is the receiver: acquisition, demodulation,
#     LDPC decode, CRC and payload check. Given the same buffer it returns the same answer on
#     any process, in any order, at any time - `Z30LdpcCodec.decode_min_sum` derives its own
#     dither from the LLRs handed to it (see `ldpc.dither_seed_from_llrs`) precisely so that
#     this holds.
#
# So the parallel path and the serial path see identical inputs and produce identical outputs,
# bit for bit, and no published number moves. Measured on this code at 6000 Hz in realistic
# mode, the PRNG-consuming half is 3.1% of a frame's wall clock (payload 0.0%, synthesis 0.3%,
# fading and offsets 2.7%, noise 0.1%) against 96.9% for acquisition, demodulation and decode -
# so keeping the producer serial costs an Amdahl ceiling of about 32x, which is well past any
# core count this is going to run on.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PreparedFrame:
    """
    One frame as it leaves the channel, plus everything the receiver is permitted to know.

    Deliberately a plain data record: it crosses a process boundary by pickle, so it must not
    carry a codec, a modulator, or anything else holding state a worker could diverge on.
    """
    #: Position in the SNR point's frame loop. Results are reassembled by this, never by the
    #: order workers happen to finish in.
    index: int
    noisy_wave: np.ndarray
    #: The transmitted payload, so a converged codeword can be checked against what was sent.
    payload_63: np.ndarray
    #: `ideal` mode hands the demodulator the exact sigma used to make the noise. `realistic`
    #: passes None, and the receiver estimates it from the audio like a real one has to.
    known_sigma: Optional[float]
    #: `ideal` mode's perfect timing and exact carrier. Ignored when `search_timing_sec` is set.
    known_start_sample: int
    known_base_freq_hz: float
    #: Half-width of the blind timing search, or None in `ideal` mode where nothing is searched.
    search_timing_sec: Optional[float]
    #: The pilot-coherence weight for this mode; see RECEIVER_PILOT_COHERENCE.
    pilot_coherence: Optional[float]


@dataclass(frozen=True)
class FrameOutcome:
    """What the receiver made of one `PreparedFrame`. Carries its index so order cannot be lost."""
    index: int
    success: bool
    iters: int
    #: Where acquisition put the frame, and on what carrier. In `ideal` mode these echo the
    #: values handed in, so the caller's error accounting reads the same field either way.
    start_sample: int
    base_freq_hz: float
    #: A codeword that converged and passed CRC-14 while carrying a payload that was never
    #: transmitted. Not a success, and not the same thing as a failure either: the shipped
    #: decoder has no transmitted payload to compare against, so a frame in this state is one
    #: the software would accept, display and log. It has a default so the field could be added
    #: without changing every positional construction of this record.
    false_decode: bool = False


def _prepare_frame(
    index: int,
    snr_db: float,
    codec: Z30LdpcCodec,
    cfg: Z30Config,
    modulator: Z30Modulator,
    rng: np.random.Generator,
    mode: str,
    impairments: ChannelImpairments,
    max_time_offset_sec: float,
    payload_63: Optional[np.ndarray] = None,
) -> Tuple[PreparedFrame, int, float]:
    """
    Generates one frame and puts it through the channel. THE ONLY PLACE THE SWEEP DRAWS RANDOM
    NUMBERS, and it draws them in the order the serial loop always has.

    Returns the frame, its true start sample and its true carrier offset. The last two never
    reach the receiver - they exist so the caller can report acquisition error, exactly as
    `impair_frame` intends.
    """
    payload, _codeword, _data_symbols, full_symbols = generate_random_frame(codec, cfg, rng, payload_63)
    clean_wave = modulator.synthesize_frame(full_symbols, base_audio_freq_hz=1250.0)
    frame_power = float(np.mean(clean_wave ** 2))

    if mode == "ideal":
        # Calibrated AWGN only, and the demodulator is told everything.
        noisy_wave, sigma = add_calibrated_awgn(
            clean_wave, snr_db, cfg.sample_rate_hz, rng, frame_power
        )
        return (
            PreparedFrame(
                index=index,
                noisy_wave=noisy_wave,
                payload_63=payload,
                known_sigma=float(sigma),
                known_start_sample=0,
                known_base_freq_hz=1250.0,
                search_timing_sec=None,
                # The genie's phase reference, explicitly: `ideal` mode hands the demodulator
                # exact symbol timing, which is the only condition under which the coherent
                # term pays. Passed rather than defaulted so that reading this record tells you
                # which receiver the frame will be decoded by.
                pilot_coherence=None,
            ),
            0,
            0.0,
        )

    # Fading, carrier offset and timing offset, then noise across the whole buffer - referenced
    # to the frame's own power, not the padded buffer's.
    buf, true_start, true_foff = impair_frame(clean_wave, cfg.sample_rate_hz, impairments, rng)
    noisy_wave, _true_sigma = add_calibrated_awgn(buf, snr_db, cfg.sample_rate_hz, rng, frame_power)
    return (
        PreparedFrame(
            index=index,
            noisy_wave=noisy_wave,
            payload_63=payload,
            known_sigma=None,
            known_start_sample=0,
            known_base_freq_hz=1250.0,
            search_timing_sec=slot_timing_search_sec(max_time_offset_sec),
            pilot_coherence=RECEIVER_PILOT_COHERENCE,
        ),
        true_start,
        true_foff,
    )


def decode_prepared_frame(job: PreparedFrame, cfg: Z30Config, codec: Z30LdpcCodec) -> FrameOutcome:
    """
    Runs the receive chain over one prepared frame: acquisition, demodulation, LDPC decode and
    the CRC-and-payload check.

    A pure function of `job` (given a codec built with the same iteration cap). It reads no
    PRNG, holds no state between calls and mutates nothing it is given, which is what makes a
    worker pool safe here and what `tests/test_benchmark_parallel.py` pins.
    """
    if job.search_timing_sec is not None:
        # Blind acquisition: the receiver gets audio and nothing else, and searches the window
        # a slot-synchronised receiver actually has rather than the whole stream.
        acq = acquire_frame(
            job.noisy_wave,
            cfg,
            nominal_base_freq_hz=job.known_base_freq_hz,
            time_search_sec=job.search_timing_sec,
        )
        start_sample = acq.start_sample
        base_freq = acq.base_freq_hz
        sigma = acq.noise_sigma
    else:
        if job.known_sigma is None:
            # Silently substituting a tiny sigma here would scale every log-likelihood by 1e18
            # and still return a plausible-looking curve. A malformed job should stop the run.
            raise ValueError("a frame with no timing search must carry the sigma it was made with")
        start_sample = job.known_start_sample
        base_freq = job.known_base_freq_hz
        sigma = job.known_sigma

    channel_llrs = demodulate_mfsk_llrs(
        job.noisy_wave, cfg, sigma,
        audio_center_hz=base_freq,
        start_sample=start_sample,
        pilot_coherence=job.pilot_coherence,
    )

    converged, decoded_info, iters = codec.decode_min_sum(channel_llrs)
    success = False
    false_decode = False
    if converged:
        # Validate CRC-14, and check the payload really is the one transmitted: a converged
        # codeword with a matching CRC that decoded to the wrong message is a false decode,
        # not a success.
        rcvd_crc = int("".join(str(b) for b in decoded_info[63:]), 2)
        comp_crc = codec.compute_crc14(decoded_info[:63])
        crc_ok = bool(rcvd_crc == comp_crc)
        success = bool(crc_ok and np.array_equal(decoded_info[:63], job.payload_63))
        # Counted, not merged into the failures. Everything the shipped decoder can see about
        # this frame says it decoded - so this is the rate at which the software on the air puts
        # a callsign that was never sent in front of an operator and into a logbook, and a
        # sensitivity table that folds it into the FER column reports it as caution rather than
        # as the risk it is.
        false_decode = bool(crc_ok and not success)

    return FrameOutcome(
        index=job.index,
        success=bool(success),
        iters=int(iters),
        start_sample=int(start_sample),
        base_freq_hz=float(base_freq),
        false_decode=false_decode,
    )


#: Per-worker receive chain, built once by the pool initializer.
#:
#: The codec builds a 139x216 parity-check matrix and its adjacency lists at construction. Sent
#: with every task instead, that construction would be paid once per frame and pickled across a
#: pipe once per frame - the "per-task pickling could plausibly lose to the serial loop" trap.
_WORKER_CFG: Optional[Z30Config] = None
_WORKER_CODEC: Optional[Z30LdpcCodec] = None


def _init_decode_worker(sample_rate_hz: int, max_iterations: int) -> None:
    """Builds one worker process's config and codec. Runs once per process, not once per frame."""
    global _WORKER_CFG, _WORKER_CODEC
    _WORKER_CFG = Z30Config(sample_rate_hz=sample_rate_hz)
    _WORKER_CODEC = Z30LdpcCodec(max_iterations=max_iterations)


def _decode_in_worker(job: PreparedFrame) -> FrameOutcome:
    """Pool entry point. Module-level and picklable, which `spawn` platforms require."""
    if _WORKER_CFG is None or _WORKER_CODEC is None:
        raise RuntimeError("decode worker used before _init_decode_worker ran")
    return decode_prepared_frame(job, _WORKER_CFG, _WORKER_CODEC)


def resolve_worker_count(workers: Optional[int]) -> int:
    """
    Turns a `--workers` argument into a process count.

    None or a value below 1 means "one per CPU"; `os.cpu_count()` can itself return None on an
    exotic platform, so it falls back to serial rather than to a crash.
    """
    if workers is None or workers < 1:
        return os.cpu_count() or 1
    return int(workers)


def _decode_batch(
    batch: List[PreparedFrame],
    outcomes: List[Optional[FrameOutcome]],
    executor: Optional[Executor],
    cfg: Z30Config,
    codec: Z30LdpcCodec,
) -> None:
    """
    Decodes one batch of prepared frames and files each result under its own frame index.

    Filing by index rather than appending is the point: a pool returns work in whatever order it
    finishes, and a sweep that accumulated in that order would produce a curve that depended on
    machine load. Every count this function feeds is read back in index order by the caller.
    """
    if executor is None:
        for job in batch:
            outcome = decode_prepared_frame(job, cfg, codec)
            outcomes[outcome.index] = outcome
        return
    for outcome in executor.map(_decode_in_worker, batch):
        outcomes[outcome.index] = outcome


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
    workers: int = DEFAULT_BENCHMARK_WORKERS,
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
        workers: decode processes. 1 runs everything in this process; a value below 1 means one
              per CPU. This changes wall-clock time and NOTHING ELSE - frames are generated in
              the same order from the same generator and reassembled by frame index, so every
              count, every RMS column and the interpolated threshold are identical at every
              worker count. `tests/test_benchmark_parallel.py` asserts that rather than
              asserting it here in prose.
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
    # From the codec's own default rather than a retyped literal. AGENTS.md's "UI prose quotes
    # constants, it does not retype them" rule applies to the benchmark too: a 45 written here
    # would go on reading correct after ldpc.py's cap changed, and the curve would silently stop
    # describing the decoder that ships.
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)
    
    worker_count = resolve_worker_count(workers)
    # The serial path batches one frame at a time, so it holds exactly one audio buffer at
    # once, as it always has. Only the pooled path needs a batch big enough to keep workers fed.
    batch_size = 1 if worker_count == 1 else worker_count * PARALLEL_CHUNK_PER_WORKER

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
    # Quoted from the schedule table rather than retyped. The literal that used to sit here
    # said "Max Iterations: 45", which was wrong in both halves: it would have gone on reading
    # 45 after ldpc.py's cap changed, and 45 is only schedule 1's cap - a frame that fails runs
    # all four schedules and pays for every one of them.
    caps = [min(int(s["iters"]), codec.max_iterations) for s in DECODE_SCHEDULES]
    print(f"  {frames_per_snr} frames/point | Sample Rate: {sample_rate_hz} Hz | "
          f"Iteration cap: {' + '.join(str(c) for c in caps)} = {sum(caps)} "
          f"over {len(caps)} schedules | Seed: {seed}")
    print(f"  Decode % is a proportion from {frames_per_snr} frames; the bracket is its 95% "
          f"Wilson score interval.")
    if frames_per_snr < PUBLISHABLE_FRAMES_PER_POINT:
        print(f"  EXPLORATORY RUN: {frames_per_snr} frames/point is below the "
              f"{PUBLISHABLE_FRAMES_PER_POINT} this project requires behind a published")
        print("  figure. Read the intervals, not the crossing. See PUBLISHABLE_FRAMES_PER_POINT.")
    if worker_count > 1:
        # Printed only when it is true, so the default run's output stays the one wiki/16 quotes.
        print(f"  Decoding across {worker_count} worker processes. The curve is unchanged by this;")
        print("  the per-point elapsed time below is now wall clock across the pool, not serial CPU time.")
    print("=" * 96)
    header = (f"{'SNR (2500Hz)':<14} | {'Frames':<7} | {'Success':<8} | {'FER':<9} | "
              f"{'Decode % (95% CI)':<21} | {'Avg Iters':<10}")
    if mode == "realistic":
        header += f" | {'Acq fail':<8} | {'Timing RMS':<11} | {'Freq RMS':<9}"
    print(header)
    print("-" * 112)
    
    executor: Optional[Executor] = None
    if worker_count > 1:
        executor = ProcessPoolExecutor(
            max_workers=worker_count,
            initializer=_init_decode_worker,
            initargs=(cfg.sample_rate_hz, codec.max_iterations),
        )

    try:
        for snr in snr_points:
            t_start = time.time()
            successes = 0
            failures = 0
            false_decodes = 0
            acq_failures = 0
            total_iters = 0
            timing_errs: List[float] = []
            freq_errs: List[float] = []

            # One slot per frame, filled by frame index. `truths` holds what the channel
            # actually did to each frame; the receiver never sees it.
            outcomes: List[Optional[FrameOutcome]] = [None] * frames_per_snr
            truths: List[Tuple[int, float]] = []

            first = 0
            while first < frames_per_snr:
                count = min(batch_size, frames_per_snr - first)
                # Prepared strictly in frame order, from the one shared generator, exactly as
                # the serial loop always did. Batching changes when frames are made, never
                # which random numbers they are made from.
                batch: List[PreparedFrame] = []
                for f in range(first, first + count):
                    job, true_start, true_foff = _prepare_frame(
                        f, float(snr), codec, cfg, modulator, rng, mode,
                        impairments, max_time_offset_sec,
                    )
                    batch.append(job)
                    truths.append((true_start, true_foff))
                _decode_batch(batch, outcomes, executor, cfg, codec)
                first += count

            # Reduce in frame order, never in completion order.
            for f in range(frames_per_snr):
                outcome = outcomes[f]
                if outcome is None:
                    raise RuntimeError(f"frame {f} at {snr:+.1f} dB was never decoded")
                total_iters += outcome.iters

                if mode == "realistic":
                    true_start, true_foff = truths[f]
                    timing_errs.append((outcome.start_sample - true_start) / cfg.sample_rate_hz)
                    freq_errs.append(outcome.base_freq_hz - (1250.0 + true_foff))
                    # Landing more than half a symbol out cannot decode. Counted separately so
                    # an acquisition failure is visible rather than hidden inside the FER.
                    if abs(outcome.start_sample - true_start) > cfg.symbol_duration_sec * cfg.sample_rate_hz / 2:
                        acq_failures += 1

                if outcome.success:
                    successes += 1
                else:
                    failures += 1
                if outcome.false_decode:
                    false_decodes += 1

            fer = failures / frames_per_snr
            decode_pct = (successes / frames_per_snr) * 100.0
            ci_lo, ci_hi = wilson_interval(successes, frames_per_snr)
            avg_iters = total_iters / frames_per_snr
            elapsed = time.time() - t_start

            res = {
                "snr_db": float(snr),
                "total_frames": frames_per_snr,
                "successes": successes,
                "failures": failures,
                "fer": fer,
                "decode_pct": decode_pct,
                # The interval the sample supports, as percentages. Carried in the result rather
                # than only printed, so anything that reduces these rows - the threshold
                # interpolation below, a test, a plot - reads the same numbers the table shows.
                "decode_pct_ci_low": 100.0 * ci_lo,
                "decode_pct_ci_high": 100.0 * ci_hi,
                "false_decodes": false_decodes,
                "avg_iters": avg_iters,
                # Wall clock for this point. With workers > 1 that is elapsed time across the
                # pool, not CPU time - do not read it as a per-frame cost.
                "elapsed_sec": elapsed,
                "seed": seed,
                "mode": mode,
                "fading": fading if mode == "realistic" else "none",
                "workers": worker_count,
            }
            if mode == "realistic":
                res["acq_failures"] = acq_failures
                res["timing_rms_ms"] = float(np.sqrt(np.mean(np.square(timing_errs))) * 1000.0) if timing_errs else 0.0
                res["freq_rms_hz"] = float(np.sqrt(np.mean(np.square(freq_errs)))) if freq_errs else 0.0
            results.append(res)

            ci = f"{decode_pct:>5.1f}% [{100.0 * ci_lo:>4.1f}-{100.0 * ci_hi:>5.1f}]"
            row = (f"{snr:+6.1f} dB      | {frames_per_snr:<7} | {successes:<8} | {fer:<9.4f} | "
                   f"{ci:<21} | {avg_iters:>6.1f}    ")
            if mode == "realistic":
                row += f" | {acq_failures:<8} | {res['timing_rms_ms']:>8.1f} ms | {res['freq_rms_hz']:>6.2f} Hz"
            print(row)
    finally:
        if executor is not None:
            executor.shutdown()

    print("=" * 96)

    # ASCII Plot of Decode Probability and FER against SNR
    plot_ascii_curves(results)

    total_false = sum(r["false_decodes"] for r in results)
    total_swept = sum(r["total_frames"] for r in results)
    print(f"  False decodes across the sweep: {total_false} of {total_swept} frames "
          f"(CRC-14 valid, payload never transmitted).")

    label = ("decode threshold (50% frame decode, blind acquisition)" if mode == "realistic"
             else "idealised AWGN bound (50% frame decode, genie-aided sync)")
    for level, name in ((50.0, label), (90.0, "90% frame decode")):
        low, point, high = decode_threshold_interval_db(results, level)
        if point is None:
            print(f"  {level:.0f}% crossing is outside the swept range - widen --min-snr / --max-snr.")
            continue
        band = (f"[{low:+.2f}, {high:+.2f}]" if low is not None and high is not None
                else "[interval extends past the swept range]")
        print(f"  {name}: {point:+.2f} dB {band} (2500 Hz reference bandwidth), "
              f"seed {seed}, {frames_per_snr} frames/point")
    if mode == "ideal":
        print("  Reminder: this excludes every acquisition loss and is NOT comparable with the")
        print("  published on-air sensitivity figures for FT8, JS8 or WSPR.")
    print("=" * 96)
    return results


# =============================================================================================
# A PRIORI (AP) DECODING - THE PAIRED MEASUREMENT
# =============================================================================================
#
# `--ap` does not produce another decode curve. It produces a *paired comparison*: every frame
# is put through the channel once, demodulated once, and the resulting LLR vector is decoded
# twice - once by the ordinary decoder and once with the QSO-state hypothesis ladder behind it.
# The two arms therefore see bit-identical channel evidence, and any difference between them is
# the ladder and nothing else.
#
# Pairing is not a nicety here. AP is worth a fraction of a dB, which is well inside the
# frame-to-frame scatter of an unpaired 40-frame run at a single SNR; two independent sweeps
# would leave the reader unable to tell a real effect from the noise in the measurement. Paired,
# the statistic is the count of frames where the two arms disagreed, and an exact McNemar test
# over those discordant pairs gives a p-value a reader can check.
#
# The population is stated rather than tuned, because the answer depends on it entirely. Half
# the frames are the QSO the receiver is actually in (`W1AW K1ABC ...`), which is what the
# ladder asserts; half are foreign traffic between other stations, which it does not. The two
# halves are reported separately, so anyone who thinks their own band is busier or quieter than
# 50/50 can reweight the result instead of taking this one on trust. AGENTS.md section 5 sets
# the bar for a benchmark that changes a published figure at >=99% confidence stated as
# something checkable; that is what `mcnemar_exact_p` is for.


#: The station this sweep's receiver is, the station it is working, and where its QSO state
#: machine is. Fixed rather than swept: AP asserts these bits, so the scenario IS the
#: experiment's independent variable, and changing it between runs would make two runs
#: incomparable. Any standard callsign gives the same answer - what matters is that 28 bits are
#: asserted, not which 28.
AP_SCENARIO_MY_CALL: str = "W1AW"
AP_SCENARIO_DX_CALL: str = "K1ABC"
AP_SCENARIO_STAGE: str = "SENDING_REPORT"

#: Fraction of frames that belong to the QSO the receiver is in. The rest are foreign traffic,
#: on which the ladder is a pure cost: four extra CRC-14 rejections and a chance of a false
#: accept. Both halves are counted and both are printed.
AP_IN_QSO_FRACTION: float = 0.5

#: Prefix, digit and suffix alphabets of a standard callsign, as `encode_callsign28` parses one.
#: Foreign callsigns are drawn from these rather than from a fixed list, so the foreign
#: population is a real sample of the callsign space instead of a handful of repeated strings.
_AP_PREFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_AP_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def random_standard_callsign(rng: np.random.Generator, exclude: Sequence[str] = ()) -> str:
    """
    A random callsign that survives the 28-bit packing, drawn from the shared generator.

    Built from the standard `[1-2 prefix][digit][1-3 suffix]` structure and then verified with
    `callsign_round_trips` rather than assumed - the same check the AP path itself applies. A
    call that failed it would be one the hypothesis machinery refuses, which would quietly
    change what the foreign population is made of.
    """
    for _ in range(64):
        prefix_len = int(rng.integers(1, 3))
        suffix_len = int(rng.integers(1, 4))
        prefix = "".join(_AP_PREFIX_ALPHABET[int(rng.integers(0, 26))] for _ in range(prefix_len))
        suffix = "".join(_AP_SUFFIX_ALPHABET[int(rng.integers(0, 26))] for _ in range(suffix_len))
        call = f"{prefix}{int(rng.integers(0, 10))}{suffix}"
        if call not in exclude and callsign_round_trips(call):
            return call
    raise RuntimeError("could not draw a round-tripping standard callsign")


def ap_scenario_payload(rng: np.random.Generator) -> Tuple[np.ndarray, bool]:
    """
    One frame of the modelled band: either the QSO this receiver is in, or foreign traffic.

    Returns the 63 payload bits and whether the frame is in-QSO. Every draw comes from the one
    shared generator in a fixed order, so the population is reproducible from the seed alone -
    the same requirement AGENTS.md places on the rest of the sweep.
    """
    in_qso = bool(rng.random() < AP_IN_QSO_FRACTION)

    if in_qso:
        # What the station being worked actually sends back during a report exchange: a report,
        # a rogered report, or one of the three closings. Drawn, not cycled, so the mix is not an
        # artefact of the frame index.
        choice = int(rng.integers(0, 5))
        if choice in (0, 1):
            report_db = int(rng.integers(-30, 1))
            extra = extra_code_for_report(report_db)
            if extra is None:
                raise RuntimeError(f"report {report_db} dB has no 7-bit code")
        else:
            extra = (EXTRA_RRR, EXTRA_73, EXTRA_RR73)[choice - 2]
        payload = pack_payload63(AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL, extra)
        return np.array(payload, dtype=np.uint8), True

    # Foreign traffic: a CQ, or an exchange between two other stations. Neither matches any
    # hypothesis in the ladder, so these frames measure what AP costs rather than what it buys.
    other = random_standard_callsign(rng, exclude=(AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL))
    if rng.random() < 0.5:
        # A CQ. The 7-bit field carries a grid, which occupies codes 64..127; the particular
        # grid is irrelevant to decoding, so it is drawn across that range rather than looked up
        # in the table src/dsp/z30Codec.ts owns.
        payload = pack_payload63("CQ", other, int(rng.integers(64, 128)))
    else:
        second = random_standard_callsign(rng, exclude=(AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL, other))
        report_db = int(rng.integers(-30, 1))
        extra = extra_code_for_report(report_db)
        if extra is None:
            raise RuntimeError(f"report {report_db} dB has no 7-bit code")
        payload = pack_payload63(other, second, extra)
    return np.array(payload, dtype=np.uint8), False


@dataclass(frozen=True)
class ApPairedOutcome:
    """
    One frame decoded both ways off the same LLR vector.

    `plain_success` and `ap_success` mean the same thing the ordinary sweep means by success:
    a CRC-valid codeword whose payload is the one that was transmitted. A CRC-valid codeword
    carrying a *different* payload is counted in `false_decode` instead - it is the cost side of
    AP and the reason the ladder is short and gated.
    """

    index: int
    in_qso: bool
    plain_success: bool
    ap_success: bool
    ap_type: int
    plain_false_decode: bool
    ap_false_decode: bool
    plain_iters: int
    ap_iters: int


def decode_prepared_frame_paired(
    job: PreparedFrame,
    cfg: Z30Config,
    codec: Z30LdpcCodec,
    hypotheses: Sequence[ApHypothesis],
    in_qso: bool,
) -> ApPairedOutcome:
    """
    Acquires and demodulates once, then decodes the resulting LLRs twice.

    Demodulating once is the point. Running the receive chain separately for each arm would let
    blind acquisition land the two arms on different samples, and the comparison would then be
    partly a comparison of two acquisitions. Here both arms are handed the identical 216 LLRs,
    so the only thing that differs is the hypothesis ladder.

    A pure function of its arguments, like `decode_prepared_frame`: no PRNG, no state, nothing
    mutated.

    The ordinary decode is run twice per frame - once here for the plain arm, and again inside
    `decode_with_ap` as its own first step. That is deliberate waste. The alternative is to
    inline the ladder here and hand `decode_with_ap` a precomputed result, which would mean the
    benchmark measured a reimplementation of the shipped function rather than the shipped
    function. A measurement of something other than what ships is worth less than the CPU time
    it saves.
    """
    if job.search_timing_sec is not None:
        acq = acquire_frame(
            job.noisy_wave,
            cfg,
            nominal_base_freq_hz=job.known_base_freq_hz,
            time_search_sec=job.search_timing_sec,
        )
        start_sample, base_freq, sigma = acq.start_sample, acq.base_freq_hz, acq.noise_sigma
    else:
        if job.known_sigma is None:
            raise ValueError("a frame with no timing search must carry the sigma it was made with")
        start_sample, base_freq, sigma = job.known_start_sample, job.known_base_freq_hz, job.known_sigma

    channel_llrs = demodulate_mfsk_llrs(
        job.noisy_wave, cfg, sigma,
        audio_center_hz=base_freq,
        start_sample=start_sample,
        pilot_coherence=job.pilot_coherence,
    )

    plain_ok, plain_info, plain_iters = codec.decode_min_sum(channel_llrs)
    plain_correct = bool(plain_ok and np.array_equal(plain_info[:63], job.payload_63))

    ap = decode_with_ap(codec, channel_llrs, hypotheses)
    ap_correct = bool(ap.success and np.array_equal(ap.info_bits[:63], job.payload_63))

    return ApPairedOutcome(
        index=job.index,
        in_qso=in_qso,
        plain_success=plain_correct,
        ap_success=ap_correct,
        ap_type=int(ap.ap_type) if ap_correct else 0,
        plain_false_decode=bool(plain_ok and not plain_correct),
        ap_false_decode=bool(ap.success and not ap_correct),
        plain_iters=int(plain_iters),
        ap_iters=int(ap.iterations),
    )


def mcnemar_exact_p(only_a: int, only_b: int) -> float:
    """
    Two-sided exact McNemar p-value for `only_a` frames won by one arm against `only_b` won by
    the other.

    Under the null hypothesis that the ladder changes nothing, each discordant frame is an
    independent coin flip, so the count of one kind is Binomial(n_discordant, 0.5). This is the
    exact binomial tail doubled, not the chi-squared approximation, because the discordant
    counts in a benchmark of this size are small enough that the approximation is not
    trustworthy - and a confidence figure that cannot be checked is the thing AGENTS.md section
    5 exists to keep out.

    Computed from `math.comb`, so it is exact rational arithmetic up to the final division; no
    tabulated critical values and no library-version-dependent answer.
    """
    n = only_a + only_b
    if n == 0:
        return 1.0
    k = min(only_a, only_b)
    tail = sum(math.comb(n, i) for i in range(0, k + 1))
    return min(1.0, 2.0 * tail / (2 ** n))


def run_ap_paired_sweep(
    min_snr_db: float = -26.0,
    max_snr_db: float = -20.0,
    step_snr_db: float = 1.0,
    frames_per_snr: int = 40,
    sample_rate_hz: int = 6000,
    seed: int = DEFAULT_BENCHMARK_SEED,
    mode: str = "realistic",
    fading: str = "none",
    max_freq_offset_hz: float = 5.0,
    max_time_offset_sec: float = 0.5,
) -> List[Dict]:
    """
    The paired a priori measurement. Serial by construction - see the section note above.

    Every frame is decoded by both arms in this process, off one demodulation, so there is no
    worker pool here: parallelising it would spread the pair across processes for no change to
    the result and one more place for the two arms to diverge.
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
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)

    hypotheses = build_ap_hypotheses(
        AP_SCENARIO_STAGE, AP_SCENARIO_MY_CALL, AP_SCENARIO_DX_CALL
    )

    print("=" * 104)
    print("  z-30 A PRIORI (AP) DECODING - PAIRED COMPARISON")
    print(f"  Scenario: this station is {AP_SCENARIO_MY_CALL}, working {AP_SCENARIO_DX_CALL}, "
          f"QSO stage {AP_SCENARIO_STAGE}.")
    print("  Hypothesis ladder: " + ", ".join(
        f"a{h.ap_type} ({h.label}, {h.asserted_bit_count}/63 bits)" for h in hypotheses
    ))
    print(f"  Population: {AP_IN_QSO_FRACTION:.0%} of frames are this QSO, the rest is foreign traffic")
    print("  the ladder does not describe. Both arms decode the SAME demodulated LLRs.")
    print(f"  {frames_per_snr} frames/point | mode: {mode} | fading: {fading} | "
          f"sample rate: {sample_rate_hz} Hz | seed: {seed}")
    print("=" * 104)
    header = (f"{'SNR':<12} | {'In-QSO':<17} | {'Foreign':<17} | {'All frames':<17} | "
              f"{'AP only':<7} | {'Plain only':<10} | {'False':<5}")
    print(header)
    print("-" * 104)

    results: List[Dict] = []
    snr_points = np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db)

    for snr in snr_points:
        outcomes: List[ApPairedOutcome] = []
        for f in range(frames_per_snr):
            payload, in_qso = ap_scenario_payload(rng)
            job, _true_start, _true_foff = _prepare_frame(
                f, float(snr), codec, cfg, modulator, rng, mode,
                impairments, max_time_offset_sec, payload,
            )
            outcomes.append(decode_prepared_frame_paired(job, cfg, codec, hypotheses, in_qso))

        in_qso_outcomes = [o for o in outcomes if o.in_qso]
        foreign_outcomes = [o for o in outcomes if not o.in_qso]

        only_ap = sum(1 for o in outcomes if o.ap_success and not o.plain_success)
        only_plain = sum(1 for o in outcomes if o.plain_success and not o.ap_success)
        plain_total = sum(1 for o in outcomes if o.plain_success)
        ap_total = sum(1 for o in outcomes if o.ap_success)
        ap_false = sum(1 for o in outcomes if o.ap_false_decode)
        plain_false = sum(1 for o in outcomes if o.plain_false_decode)

        res = {
            "snr_db": float(snr),
            "total_frames": frames_per_snr,
            "in_qso_frames": len(in_qso_outcomes),
            "foreign_frames": len(foreign_outcomes),
            "plain_successes": plain_total,
            "ap_successes": ap_total,
            "in_qso_plain": sum(1 for o in in_qso_outcomes if o.plain_success),
            "in_qso_ap": sum(1 for o in in_qso_outcomes if o.ap_success),
            "foreign_plain": sum(1 for o in foreign_outcomes if o.plain_success),
            "foreign_ap": sum(1 for o in foreign_outcomes if o.ap_success),
            "only_ap": only_ap,
            "only_plain": only_plain,
            "ap_false_decodes": ap_false,
            "plain_false_decodes": plain_false,
            "ap_types": sorted({o.ap_type for o in outcomes if o.ap_type}),
            "plain_decode_pct": 100.0 * plain_total / frames_per_snr,
            "ap_decode_pct": 100.0 * ap_total / frames_per_snr,
            "seed": seed,
            "mode": mode,
            "fading": fading,
        }
        results.append(res)

        def arm(before: int, after: int, total: int) -> str:
            return f"{before:>3}/{total:<3} -> {after:>3}/{total:<3}"

        print(f"{snr:+6.1f} dB    | "
              f"{arm(res['in_qso_plain'], res['in_qso_ap'], res['in_qso_frames']):<17} | "
              f"{arm(res['foreign_plain'], res['foreign_ap'], res['foreign_frames']):<17} | "
              f"{arm(plain_total, ap_total, frames_per_snr):<17} | "
              f"{only_ap:<7} | {only_plain:<10} | {ap_false:<5}")

    print("=" * 104)

    total_only_ap = sum(r["only_ap"] for r in results)
    total_only_plain = sum(r["only_plain"] for r in results)
    p_value = mcnemar_exact_p(total_only_ap, total_only_plain)
    total_frames = sum(r["total_frames"] for r in results)
    total_in_qso = sum(r["in_qso_frames"] for r in results)

    print(f"  Frames: {total_frames} ({total_in_qso} in-QSO, {total_frames - total_in_qso} foreign)")
    print(f"  Discordant pairs: {total_only_ap} decoded only with AP, {total_only_plain} only without.")
    print(f"  Exact two-sided McNemar p = {p_value:.3e}")
    print(f"  Plain: {sum(r['plain_successes'] for r in results)} decodes | "
          f"AP: {sum(r['ap_successes'] for r in results)} decodes")
    print(f"  False decodes (CRC-valid codeword carrying the wrong payload): "
          f"plain {sum(r['plain_false_decodes'] for r in results)}, "
          f"AP {sum(r['ap_false_decodes'] for r in results)}")
    print(f"  In-QSO decode rate: "
          f"{100.0 * sum(r['in_qso_plain'] for r in results) / max(1, total_in_qso):.1f}% -> "
          f"{100.0 * sum(r['in_qso_ap'] for r in results) / max(1, total_in_qso):.1f}%")
    print("  A p-value says the ladder changed something, not by how much. The in-QSO 50% crossing")
    print("  of each arm - and only the in-QSO frames, see ap_threshold_shift - is the size of it.")
    print("=" * 104)
    return results


def ap_threshold_shift(results: List[Dict]) -> Dict[str, Optional[float]]:
    """
    Each arm's 50% crossing over the in-QSO frames, the band the sample supports for each, and
    the difference between the point estimates.

    Reported only over the in-QSO population, because that is the population the ladder makes a
    claim about. A crossing computed over the whole band mix would move with the mix rather than
    with the decoder, and would read as a sensitivity figure while being a statement about how
    busy the band is.

    The two bands are the same pointwise-Wilson propagation `decode_threshold_interval_db`
    applies to every other crossing this file reports. They are here because this function used
    to return three bare numbers and the `--ap` summary printed them to two decimal places: the
    in-QSO half of a sweep is HALF the frames, so its interval is wider than the sweep's, and a
    bare crossing off ~20 in-QSO frames a point claims a precision the sample cannot support.
    AGENTS.md section 5 asks for the interval rather than the crossing, and this is the one
    instrument in the file that was not giving one.

    `shift_db` is a difference of two point estimates and deliberately carries no interval of
    its own: the two arms are paired frame by frame, so the honest statement of whether the
    ladder changed anything is the exact McNemar p-value the sweep already prints, not a band
    built by differencing two curves' independent intervals.
    """
    def curve(successes_key: str) -> List[Dict]:
        return [
            {
                "snr_db": r["snr_db"],
                "decode_pct": 100.0 * r[successes_key] / max(1, r["in_qso_frames"]),
                # Wilson needs the counts, not the percentage it was derived from.
                "successes": r[successes_key],
                "total_frames": r["in_qso_frames"],
            }
            for r in results
        ]

    plain_lo, plain_pt, plain_hi = decode_threshold_interval_db(curve("in_qso_plain"))
    ap_lo, ap_pt, ap_hi = decode_threshold_interval_db(curve("in_qso_ap"))
    shift = None
    if plain_pt is not None and ap_pt is not None:
        shift = plain_pt - ap_pt
    return {
        "plain_db": plain_pt,
        "plain_low_db": plain_lo,
        "plain_high_db": plain_hi,
        "ap_db": ap_pt,
        "ap_low_db": ap_lo,
        "ap_high_db": ap_hi,
        "shift_db": shift,
    }


# =============================================================================================
# THE DEMODULATOR COMPARISON - IS THE BENCHMARK MEASURING THE RECEIVER THAT SHIPS?
# =============================================================================================
#
# `demodulate_mfsk_llrs` takes a `pilot_coherence` weight, and for a long time the project ran
# two different values of it at once without noticing:
#
#   * The two benchmarks (this file's `realistic` mode, and monteCarloEngine.ts) passed 0.0 -
#     a purely non-coherent receiver, which is what AGENTS.md section 1 specifies z-30 to be.
#   * The two on-air decoders (sic_decoder.py's `_estimate_llrs`, which took the parameter's
#     default, and realReceiver.ts's `demodulateReal`, which hardcoded it) applied the
#     pilot-distance-adaptive weight, 0.35 to 0.85.
#
# So the published decode threshold described a receiver nobody could actually run, and the
# receiver people did run had never been measured. That is the failure this instrument exists
# to make impossible to reintroduce: it decodes the same frame through both configurations and
# reports which one decodes more of them, with a p-value.
#
# Paired for the same reason `--ap` is paired. The two arms share one channel realisation, one
# acquisition and one noise draw, and differ only in the weight, so the frame-to-frame scatter
# that would otherwise bury a sub-dB effect cancels out of the comparison entirely.


@dataclass(frozen=True)
class DemodArm:
    """One demodulator configuration under test."""
    key: str
    label: str
    #: Passed straight to `demodulate_mfsk_llrs`. None selects its pilot-distance-adaptive
    #: weight; a float pins the coherent term's weight for every symbol.
    pilot_coherence: Optional[float]


#: The two configurations that were live in the shipped software simultaneously.
DEMOD_ARMS: Dict[str, DemodArm] = {
    "non-coherent": DemodArm("non-coherent", "non-coherent (pilot_coherence = 0.0)", 0.0),
    "semi-coherent": DemodArm("semi-coherent", "semi-coherent (pilot-distance-adaptive 0.35-0.85)", None),
}


@dataclass(frozen=True)
class DemodPairedOutcome:
    """One frame demodulated twice off one acquisition and decoded twice."""
    index: int
    a_success: bool
    b_success: bool
    a_false_decode: bool
    b_false_decode: bool
    a_iters: int
    b_iters: int
    #: Acquisition's residual timing error in seconds, signed. Both arms share it - it is
    #: reported because it is the quantity the coherent term's usefulness depends on.
    timing_error_sec: float


def decode_prepared_frame_two_demodulators(
    job: PreparedFrame,
    cfg: Z30Config,
    codec: Z30LdpcCodec,
    arm_a: DemodArm,
    arm_b: DemodArm,
    true_start_sample: int,
) -> DemodPairedOutcome:
    """
    Acquires once, demodulates twice with the two weights, decodes both.

    Acquiring once is what makes this a comparison of demodulators. Running the front end twice
    would let it land the arms on different samples and the result would be part acquisition.

    A pure function of its arguments, like `decode_prepared_frame`: no PRNG, no state.
    `true_start_sample` is used only to report the acquisition error alongside the outcome; it
    never reaches either demodulator.
    """
    if job.search_timing_sec is not None:
        acq = acquire_frame(
            job.noisy_wave,
            cfg,
            nominal_base_freq_hz=job.known_base_freq_hz,
            time_search_sec=job.search_timing_sec,
        )
        start_sample, base_freq, sigma = acq.start_sample, acq.base_freq_hz, acq.noise_sigma
    else:
        if job.known_sigma is None:
            raise ValueError("a frame with no timing search must carry the sigma it was made with")
        start_sample, base_freq, sigma = job.known_start_sample, job.known_base_freq_hz, job.known_sigma

    def decode(arm: DemodArm) -> Tuple[bool, bool, int]:
        llrs = demodulate_mfsk_llrs(
            job.noisy_wave, cfg, sigma,
            audio_center_hz=base_freq,
            start_sample=start_sample,
            pilot_coherence=arm.pilot_coherence,
        )
        ok, info, iters = codec.decode_min_sum(llrs)
        correct = bool(ok and np.array_equal(info[:63], job.payload_63))
        return correct, bool(ok and not correct), int(iters)

    a_correct, a_false, a_iters = decode(arm_a)
    b_correct, b_false, b_iters = decode(arm_b)

    return DemodPairedOutcome(
        index=job.index,
        a_success=a_correct,
        b_success=b_correct,
        a_false_decode=a_false,
        b_false_decode=b_false,
        a_iters=a_iters,
        b_iters=b_iters,
        timing_error_sec=(start_sample - true_start_sample) / float(cfg.sample_rate_hz),
    )


def run_demod_paired_sweep(
    min_snr_db: float = -25.0,
    max_snr_db: float = -20.0,
    step_snr_db: float = 1.0,
    frames_per_snr: int = 60,
    sample_rate_hz: int = 6000,
    seed: int = DEFAULT_BENCHMARK_SEED,
    mode: str = "realistic",
    fading: str = "none",
    max_freq_offset_hz: float = 5.0,
    max_time_offset_sec: float = 0.5,
    arm_a_key: str = "non-coherent",
    arm_b_key: str = "semi-coherent",
) -> List[Dict]:
    """
    The paired demodulator measurement. Serial by construction, like `--ap`: both arms of a pair
    are decoded in one place off one acquisition, so there is nothing to spread over processes
    that would not also be a chance for the arms to diverge.
    """
    if mode not in ("realistic", "ideal"):
        raise ValueError(f"mode must be 'realistic' or 'ideal'; got {mode!r}")
    if fading not in WATTERSON_PRESETS:
        raise ValueError(f"fading must be one of {sorted(WATTERSON_PRESETS)}; got {fading!r}")
    if arm_a_key not in DEMOD_ARMS or arm_b_key not in DEMOD_ARMS:
        raise ValueError(f"arms must be from {sorted(DEMOD_ARMS)}")

    arm_a, arm_b = DEMOD_ARMS[arm_a_key], DEMOD_ARMS[arm_b_key]
    rng = np.random.default_rng(seed)
    impairments = ChannelImpairments(
        max_freq_offset_hz=max_freq_offset_hz,
        max_time_offset_sec=max_time_offset_sec,
        fading=fading,
    )
    cfg = Z30Config(sample_rate_hz=sample_rate_hz)
    modulator = Z30Modulator(cfg)
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)

    print("=" * 104)
    print("  z-30 DEMODULATOR COMPARISON - PAIRED")
    print(f"  A: {arm_a.label}")
    print(f"  B: {arm_b.label}")
    print("  One channel realisation, one acquisition and one noise draw per frame; the two arms")
    print("  differ only in the coherent term's weight.")
    print(f"  {frames_per_snr} frames/point | mode: {mode} | fading: {fading} | "
          f"sample rate: {sample_rate_hz} Hz | seed: {seed}")
    print("=" * 104)
    print(f"{'SNR':<12} | {'A decodes':<12} | {'B decodes':<12} | {'A only':<7} | {'B only':<7} | "
          f"{'p (exact)':<11} | {'Timing RMS':<11}")
    print("-" * 104)

    results: List[Dict] = []
    for snr in np.arange(min_snr_db, max_snr_db + 1e-4, step_snr_db):
        outcomes: List[DemodPairedOutcome] = []
        for f in range(frames_per_snr):
            job, true_start, _true_foff = _prepare_frame(
                f, float(snr), codec, cfg, modulator, rng, mode,
                impairments, max_time_offset_sec,
            )
            outcomes.append(
                decode_prepared_frame_two_demodulators(job, cfg, codec, arm_a, arm_b, true_start)
            )

        a_total = sum(1 for o in outcomes if o.a_success)
        b_total = sum(1 for o in outcomes if o.b_success)
        only_a = sum(1 for o in outcomes if o.a_success and not o.b_success)
        only_b = sum(1 for o in outcomes if o.b_success and not o.a_success)
        timing_rms_ms = float(np.sqrt(np.mean([o.timing_error_sec ** 2 for o in outcomes])) * 1000.0)
        point_p = mcnemar_exact_p(only_a, only_b)

        results.append({
            "snr_db": float(snr),
            "total_frames": frames_per_snr,
            "arm_a": arm_a.key,
            "arm_b": arm_b.key,
            "a_successes": a_total,
            "b_successes": b_total,
            "only_a": only_a,
            "only_b": only_b,
            "a_false_decodes": sum(1 for o in outcomes if o.a_false_decode),
            "b_false_decodes": sum(1 for o in outcomes if o.b_false_decode),
            "a_avg_iters": sum(o.a_iters for o in outcomes) / frames_per_snr,
            "b_avg_iters": sum(o.b_iters for o in outcomes) / frames_per_snr,
            "timing_rms_ms": timing_rms_ms,
            "mcnemar_p": point_p,
            "seed": seed,
            "mode": mode,
            "fading": fading,
        })

        print(f"{snr:+6.1f} dB    | {a_total:>3}/{frames_per_snr:<8} | {b_total:>3}/{frames_per_snr:<8} | "
              f"{only_a:<7} | {only_b:<7} | {point_p:<11.3e} | {timing_rms_ms:>8.1f} ms")

    print("=" * 104)
    total_only_a = sum(r["only_a"] for r in results)
    total_only_b = sum(r["only_b"] for r in results)
    pooled_p = mcnemar_exact_p(total_only_a, total_only_b)
    frames = sum(r["total_frames"] for r in results)
    print(f"  Frames: {frames} | A decodes {sum(r['a_successes'] for r in results)}, "
          f"B decodes {sum(r['b_successes'] for r in results)}")
    print(f"  Discordant pairs: {total_only_a} won by A, {total_only_b} won by B")
    print(f"  Pooled exact two-sided McNemar p = {pooled_p:.6e}")
    print(f"  False decodes (CRC-valid codeword, wrong payload): "
          f"A {sum(r['a_false_decodes'] for r in results)}, B {sum(r['b_false_decodes'] for r in results)}")

    a_curve = [{"snr_db": r["snr_db"], "decode_pct": 100.0 * r["a_successes"] / r["total_frames"],
                "successes": r["a_successes"], "total_frames": r["total_frames"]} for r in results]
    b_curve = [{"snr_db": r["snr_db"], "decode_pct": 100.0 * r["b_successes"] / r["total_frames"],
                "successes": r["b_successes"], "total_frames": r["total_frames"]} for r in results]
    a_lo, a_pt, a_hi = decode_threshold_interval_db(a_curve)
    b_lo, b_pt, b_hi = decode_threshold_interval_db(b_curve)
    if a_pt is not None and b_pt is not None:
        print(f"  50% crossing: A {a_pt:+.2f} dB [{a_lo:+.2f}, {a_hi:+.2f}], "
              f"B {b_pt:+.2f} dB [{b_lo:+.2f}, {b_hi:+.2f}] "
              f"-> A is {b_pt - a_pt:+.2f} dB deeper")
    else:
        print("  At least one arm never crosses 50% in this range - widen --min-snr/--max-snr")
        print("  before quoting a threshold difference.")
    print("  A p-value says the two demodulators are not the same, not by how much. The crossing")
    print("  difference above is the size of it, and the interval is what the sample supports.")
    print("=" * 104)
    return results


# =============================================================================================
# BINOMIAL CONFIDENCE - EVERY NUMBER ON A DECODE CURVE IS A PROPORTION FROM A FINITE SAMPLE
# =============================================================================================
#
# "22 of 40 frames decoded" is not 55%; it is a sample from a Bernoulli process whose true rate
# lies in a range. At 40 frames that range is roughly +/-15 percentage points, which at the
# slope of this mode's decode curve is most of a dB - so a threshold quoted from 40 frames to
# one decimal place claims a precision the sample cannot support. Monte Carlo error-rate
# estimation in digital communications has carried an interval alongside the point estimate for
# decades (see e.g. Jeruchim's interval-estimation work and MATLAB's `berconfint`); this is that
# convention, applied to a decode-probability curve instead of a BER curve.
#
# Wilson's score interval rather than the textbook normal ("Wald") one: Wald is the interval
# that returns +/-0.0 at 0/40 and 40/40, which is exactly where a sensitivity sweep spends most
# of its points. Wilson stays inside [0, 1] and keeps its stated coverage at the extremes and at
# small n, which is the regime this benchmark actually runs in.


#: Two-sided standard-normal quantile for a 95% interval, to the precision float64 carries.
#: Written out rather than pulled from SciPy so the interval a published figure quotes does not
#: depend on which SciPy version produced it.
WILSON_Z_95: float = 1.959963984540054


def wilson_interval(successes: int, trials: int, z: float = WILSON_Z_95) -> Tuple[float, float]:
    """
    Wilson score interval for a binomial proportion, returned as fractions of 1.

    `trials` of zero returns the whole unit interval - no frames is no evidence, and returning
    (0.0, 0.0) there would read as "measured zero" rather than "measured nothing".
    """
    if trials <= 0:
        return (0.0, 1.0)
    n = float(trials)
    phat = successes / n
    denom = 1.0 + (z * z) / n
    centre = (phat + (z * z) / (2.0 * n)) / denom
    half = (z * math.sqrt((phat * (1.0 - phat) + (z * z) / (4.0 * n)) / n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def _crossing_db(points: Sequence[Tuple[float, float]], level_pct: float) -> Optional[float]:
    """
    Linear interpolation of the SNR at which a decode-percentage curve first reaches `level_pct`.

    `points` is (snr_db, decode_pct), in any order. Returns None when the curve never crosses.
    """
    ordered = sorted(points, key=lambda pt: pt[0])
    for (lo_snr, lo_pct), (hi_snr, hi_pct) in zip(ordered, ordered[1:]):
        if lo_pct < level_pct <= hi_pct:
            span = hi_pct - lo_pct
            if span <= 0:
                return float(hi_snr)
            return float(lo_snr + ((level_pct - lo_pct) / span) * (hi_snr - lo_snr))
    return None


def decode_threshold_interval_db(
    results: List[Dict], level_pct: float = 50.0, z: float = WILSON_Z_95
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    The `level_pct` crossing and the SNR range the sample supports, as (low, point, high).

    The point estimate is the crossing of the measured curve. The two bounds are the crossings
    of the pointwise Wilson band: the upper bound of every point makes the most optimistic curve
    the data allow, and it crosses at the lowest (best) SNR; the lower bound makes the most
    pessimistic curve, and it crosses highest. Reporting the pair is what stops a 40-frame run
    reading as a measurement to a tenth of a dB.

    This is a band on the decode *rate* propagated through the interpolation, not a confidence
    interval on the threshold parameter of a fitted curve - it makes no distributional
    assumption about the curve's shape, and it is computed from the same counts the table
    prints, so a reader can redo it by hand.
    """
    point = _crossing_db([(r["snr_db"], r["decode_pct"]) for r in results], level_pct)
    optimistic = _crossing_db(
        [(r["snr_db"], 100.0 * wilson_interval(r["successes"], r["total_frames"], z)[1]) for r in results],
        level_pct,
    )
    pessimistic = _crossing_db(
        [(r["snr_db"], 100.0 * wilson_interval(r["successes"], r["total_frames"], z)[0]) for r in results],
        level_pct,
    )
    return (optimistic, point, pessimistic)


def decode_threshold_db(results: List[Dict]) -> Optional[float]:
    """
    The SNR at which 50% of frames decode, linearly interpolated between the two swept points
    that bracket the crossing. Returns None when the sweep never crosses 50%.

    Delegates to `_crossing_db` rather than interpolating again. It used to carry its own copy
    of the same arithmetic, which is the shape AGENTS.md's "one source of truth per rule" is
    about: two implementations of "where does this curve cross 50%" agreeing today and drifting
    the day one of them learns about a curve that dips, or about points arriving out of order.
    The `--ap` instrument read this one and every published threshold read the other, so a
    divergence would have moved an AP result away from the sweep it is meant to be compared to.
    """
    return _crossing_db([(r["snr_db"], r["decode_pct"]) for r in results], 50.0)

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

def run_benchmark(seed: int = DEFAULT_BENCHMARK_SEED,
                  workers: int = DEFAULT_BENCHMARK_WORKERS):
    """Default entry point (`z30 --benchmark`): the honest, realistic curve."""
    return run_monte_carlo_snr_sweep(
        min_snr_db=-26.0,
        max_snr_db=-14.0,
        step_snr_db=1.0,
        frames_per_snr=25,
        sample_rate_hz=6000,
        seed=seed,
        mode="realistic",
        workers=workers,
    )


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
    parser.add_argument("--workers", type=int, default=DEFAULT_BENCHMARK_WORKERS,
                        help="Decode processes (default: 1, serial). 0 or less means one per CPU. "
                             "Affects wall-clock time only: the curve is identical at every "
                             "worker count, and the test suite asserts it.")
    # Mutually exclusive rather than first-one-wins. Both flags select a paired instrument
    # instead of a sweep, and passing both used to run --compare-demod and discard --ap in
    # silence - so a run asked for one measurement, was given a different one, and said nothing
    # about the substitution in its header or its output.
    paired = parser.add_mutually_exclusive_group()
    paired.add_argument("--compare-demod", action="store_true",
                        help="Measure the demodulator instead of sweeping a curve: every frame "
                             "is acquired once and demodulated twice, non-coherently and with "
                             "the pilot-distance-adaptive coherent term, and the discordant "
                             "pairs are tested exactly. Serial; --workers is ignored.")
    paired.add_argument("--ap", action="store_true",
                        help="Measure a priori (AP) decoding instead of sweeping a curve: every "
                             "frame is decoded twice off one demodulation, with and without the "
                             "QSO-state hypothesis ladder, and the discordant pairs are tested "
                             "exactly. Serial; --workers is ignored.")
    args = parser.parse_args()

    if args.compare_demod:
        run_demod_paired_sweep(
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
        raise SystemExit(0)

    if args.ap:
        ap_results = run_ap_paired_sweep(
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
        shift = ap_threshold_shift(ap_results)
        if shift["shift_db"] is None:
            print("  In-QSO 50% crossing is outside the swept range for at least one arm -")
            print("  widen --min-snr / --max-snr before quoting a threshold shift.")
        else:
            def band(low: Optional[float], high: Optional[float]) -> str:
                if low is None or high is None:
                    return "[interval extends past the swept range]"
                return f"[{low:+.2f}, {high:+.2f}]"

            print(f"  In-QSO 50% crossing: plain {shift['plain_db']:+.2f} dB "
                  f"{band(shift['plain_low_db'], shift['plain_high_db'])}, "
                  f"AP {shift['ap_db']:+.2f} dB "
                  f"{band(shift['ap_low_db'], shift['ap_high_db'])}")
            print(f"  -> {shift['shift_db']:+.2f} dB deeper with AP (a difference of two point")
            print("     estimates; the McNemar p above, not this number, is what says the ladder")
            print("     changed something. The brackets are 95% Wilson bands over the IN-QSO")
            print("     frames only, which are about half the frames the sweep ran.)")
            print(f"  (seed {args.seed}, {args.frames} frames/point, mode {args.mode}, "
                  f"fading {args.fading}. Quote all four with the figure.)")
        raise SystemExit(0)

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
        workers=args.workers,
    )
