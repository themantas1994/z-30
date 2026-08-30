"""
z-30 Multi-Signal Successive Interference Cancellation (SIC) Decoder
=====================================================================
Pipeline:
- Real FFT-based candidate carrier peak detection across the 200 - 3000 Hz passband.
- Pilot-aided semi-coherent LLR demodulation on each candidate, sharing the exact
  matched-filter / Log-MAP math validated in z30_dsp.benchmark.demodulate_mfsk_llrs.
- Real Systematic (216, 77) multi-schedule Min-Sum / Log-SPA LDPC decode with CRC-14
  verification (z30_dsp.ldpc.Z30LdpcCodec).
- Reconstructs decoded signals (carrier frequency, amplitude, phase-continuous waveform)
  and subtracts them in the time domain from the composite baseband buffer.
- Re-runs candidate detection and LLR demodulation on the residual buffer (up to 3 passes).

Callsign / grid / report unpacking mirrors the Radix-37/27 + 7-bit grid/report codec
implemented in src/dsp/z30Codec.ts (encodeCallsign28 / decodeCallsign28 / decodeGrid),
so a real decoded frame round-trips to the same human-readable message on both stacks.

NOTE: `process_buffer` assumes the input buffer is already aligned to the 30.0s UTC
slot boundary (the RX window described in modem.py / README.md); frame timing relies
on the station clock discipline provided by rf_time_sync.py, not blind search.
"""

from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
import numpy as np
from z30_dsp.modem import Z30Modulator, Z30Config
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.benchmark import demodulate_mfsk_llrs

# ---------------------------------------------------------------------------
# Message codec: Radix-37/27 callsign + 7-bit grid/report field.
# Mirrors src/dsp/z30Codec.ts (decodeCallsign28 / decodeGrid / unpackZ30Message)
# exactly, so both stacks decode an identical frame to an identical message.
# ---------------------------------------------------------------------------

COMMON_GRIDS = [
    'FN31', 'FN20', 'FN30', 'FM19', 'FM29', 'EM00', 'EM10', 'EM29', 'EM79', 'EL98',
    'EL89', 'DM79', 'DM04', 'DM13', 'CM87', 'CM97', 'CN87', 'CN88', 'IO91', 'IO82',
    'IO92', 'IO93', 'JO21', 'JO31', 'JO22', 'JO32', 'JN88', 'JN58', 'JN48', 'JN65',
    'PM95', 'PM85', 'PM74', 'QM05', 'QM06', 'QF22', 'QF56', 'QF57', 'RE78', 'GG87',
    'GF05', 'FF49', 'KG46', 'KF29', 'OL93', 'NL18', 'OF78', 'NF48', 'PF95',
    'KO85', 'KO94', 'KP04', 'KP15', 'KP20', 'KN87', 'KN99', 'KM17', 'KM68', 'KL78',
    'BL11', 'BK29', 'AJ81', 'AH21',
]


def decode_callsign28(num: int) -> str:
    """Reverses z30Codec.ts:encodeCallsign28 (Radix-37 prefix/digit + Radix-27 suffix)."""
    if num == 0:
        return 'CQ'
    if num == 1:
        return 'CQ DX'
    if num == 2:
        return 'CQ TEST'
    if num == 3:
        return 'QRZ'
    if num < 100:
        return 'CQ'

    val = num - 100
    s_val = val % 19683
    rem1 = val // 19683
    d_val = rem1 % 10
    p_val = rem1 // 10

    if p_val < 37 * 37:
        p0, p1 = p_val // 37, p_val % 37
        s0 = s_val // 729
        s1 = (s_val % 729) // 27
        s2 = s_val % 27

        def p_to_char(v: int) -> str:
            if v == 0:
                return ''
            return chr(48 + v - 1) if v <= 10 else chr(65 + v - 11)

        def s_to_char(v: int) -> str:
            return '' if v == 0 else chr(65 + v - 1)

        prefix = (p_to_char(p0) + p_to_char(p1)).strip()
        suffix = (s_to_char(s0) + s_to_char(s1) + s_to_char(s2)).strip()
        if prefix and suffix:
            return f"{prefix}{d_val}{suffix}"

    return 'DX'


def decode_grid(val: int) -> str:
    """Reverses z30Codec.ts:encodeGrid's indexed common-grid table path."""
    if 64 <= val < 64 + len(COMMON_GRIDS):
        return COMMON_GRIDS[val - 64]
    return 'FN31'


def unpack_z30_message(info_bits: np.ndarray) -> Dict[str, Optional[str]]:
    """Reverses z30Codec.ts:unpackZ30Message. Reconstructs a human-readable QSO message from 77 decoded info bits."""
    bits = [int(b) & 1 for b in info_bits[:77]]

    num_to = 0
    for b in bits[0:28]:
        num_to = (num_to << 1) | b
    num_from = 0
    for b in bits[28:56]:
        num_from = (num_from << 1) | b
    extra_code = 0
    for b in bits[56:63]:
        extra_code = (extra_code << 1) | b

    call_to = decode_callsign28(num_to)
    call_from = decode_callsign28(num_from)

    grid: Optional[str] = None
    report: Optional[str] = None

    if call_to in ('CQ', 'CQ DX') or num_to in (0, 1):
        grid = decode_grid(extra_code)
        raw_text = f"CQ DX {call_from} {grid}" if call_to == 'CQ DX' else f"CQ {call_from} {grid}"
    elif extra_code >= 64:
        grid = decode_grid(extra_code)
        raw_text = f"{call_to} {call_from} {grid}"
    elif extra_code == 61:
        report = 'RRR'
        raw_text = f"{call_to} {call_from} RRR"
    elif extra_code == 62:
        report = '73'
        raw_text = f"{call_to} {call_from} 73"
    elif extra_code == 63:
        report = 'RR73'
        raw_text = f"{call_to} {call_from} RR73"
    else:
        snr_val = extra_code - 30
        report = f"{'+' if snr_val >= 0 else ''}{snr_val}"
        raw_text = f"{call_to} {call_from} {report}"

    return {
        'raw_text': raw_text,
        'call_to': None if call_to in ('CQ', 'CQ DX') else call_to,
        'call_from': call_from,
        'grid': grid,
        'report': report,
    }


@dataclass
class DecodedCarrier:
    call_from: str
    freq_hz: float
    snr_db: float
    dt_sec: float
    sic_pass: int
    raw_symbols: List[int]
    message: str


class Z30SicMultiSignalDecoder:
    """Iterative 3-Pass Successive Interference Cancellation Pipeline."""

    def __init__(self, max_passes: int = 3, config: Optional[Z30Config] = None) -> None:
        self.max_passes = max_passes
        self.cfg = config or Z30Config()
        self.modulator = Z30Modulator(self.cfg)
        self.ldpc = Z30LdpcCodec()

    def process_buffer(
        self,
        baseband_audio: np.ndarray,
        base_dial_hz: float = 14074000,
        min_freq_hz: float = 200.0,
        max_freq_hz: float = 3000.0,
    ) -> List[DecodedCarrier]:
        """
        Executes multi-pass SIC decoding across the min_freq_hz - max_freq_hz audio spectrum.
        `baseband_audio` must already be sampled at self.cfg.sample_rate_hz and aligned to
        the 24.0s active-TX window of a 30.0s UTC slot.
        """
        residual_buffer = np.array(baseband_audio, dtype=np.float32, copy=True)
        all_decodes: List[DecodedCarrier] = []

        for current_pass in range(1, self.max_passes + 1):
            # 1. Detect candidate carrier peaks in residual spectrum
            candidates = self._find_candidates(residual_buffer, min_freq_hz, max_freq_hz)
            if not candidates:
                break

            pass_new_decodes = 0
            for cand in candidates:
                # 2a. Snap the rough FFT peak to the true tone-0 (comb base) frequency by
                #     testing which of the 16 possible tone offsets maximizes pilot correlation.
                base_freq_hz = self._refine_base_freq(residual_buffer, cand["freq_hz"])

                # 2b. Fine carrier-frequency-offset correction via pilot phase-slope across the
                #     7 Costas clusters. The coarse FFT-bin estimate above (~0.02-0.2 Hz) is
                #     already good enough for tone detection, but coherent time-domain SIC
                #     cancellation over a 24s frame needs sub-0.01 Hz accuracy or the
                #     synthesized replica drifts out of phase and fails to cancel cleanly.
                base_freq_hz = self._refine_fine_frequency(residual_buffer, base_freq_hz)

                # 2c. Pilot-aided matched filter demodulation -> soft LLRs + amplitude/noise estimate
                llrs, pilot_amp, sigma_est = self._estimate_llrs(residual_buffer, base_freq_hz)

                # 3. Attempt multi-schedule Min-Sum / Log-SPA LDPC decode
                success, info_bits, iters = self.ldpc.decode_min_sum(llrs)
                if success:
                    # 4. Reconstruct clean signal waveform and cancel from residual
                    symbols = self._recover_symbols(info_bits)
                    synth_wave = self.modulator.synthesize_frame(symbols, base_freq_hz)

                    n = min(len(residual_buffer), len(synth_wave))
                    residual_buffer[:n] -= pilot_amp * synth_wave[:n]

                    unpacked = unpack_z30_message(info_bits)
                    snr_db = self._estimate_snr_db(pilot_amp, sigma_est)

                    carrier = DecodedCarrier(
                        call_from=unpacked['call_from'] or 'DX',
                        freq_hz=base_freq_hz,
                        snr_db=snr_db,
                        dt_sec=0.0,
                        sic_pass=current_pass,
                        raw_symbols=symbols,
                        message=unpacked['raw_text'],
                    )
                    all_decodes.append(carrier)
                    pass_new_decodes += 1

            if pass_new_decodes == 0:
                # No additional signals decoded this pass
                break

        return all_decodes

    def _find_candidates(
        self,
        buffer: np.ndarray,
        min_freq_hz: float = 200.0,
        max_freq_hz: float = 3000.0,
        min_peak_db: float = 8.0,
    ) -> List[Dict]:
        """
        Real spectral peak detector: windowed FFT of the buffer, noise-floor estimation via
        the median bin magnitude, and local-maxima extraction at least `min_peak_db` above
        that floor, deduplicated within one occupied bandwidth (50 Hz) of each other.
        """
        n = len(buffer)
        if n < 64:
            return []

        window = np.hanning(n)
        spectrum = np.fft.rfft(buffer * window)
        mag_db = 20.0 * np.log10(np.maximum(np.abs(spectrum), 1e-12))
        freqs = np.fft.rfftfreq(n, d=1.0 / self.cfg.sample_rate_hz)

        band_idx = np.where((freqs >= min_freq_hz) & (freqs <= max_freq_hz))[0]
        if len(band_idx) < 3:
            return []

        noise_floor_db = float(np.median(mag_db[band_idx]))
        threshold_db = noise_floor_db + min_peak_db
        min_spacing_hz = self.cfg.bandwidth_hz

        candidates: List[Dict] = []
        for i in band_idx[1:-1]:
            if mag_db[i] > threshold_db and mag_db[i] > mag_db[i - 1] and mag_db[i] > mag_db[i + 1]:
                freq_hz = float(freqs[i])
                if any(abs(freq_hz - c["freq_hz"]) < min_spacing_hz for c in candidates):
                    continue
                candidates.append({
                    "freq_hz": freq_hz,
                    "peak_db": float(mag_db[i]),
                    "noise_floor_db": noise_floor_db,
                })

        candidates.sort(key=lambda c: c["peak_db"], reverse=True)
        return candidates

    def _pilot_amplitude(self, buffer: np.ndarray, base_freq_hz: float) -> float:
        """
        Coherent matched-filter amplitude estimate averaged over the 21 known Costas sync
        pilot tones, assuming `base_freq_hz` is the tone-0 frequency of the 16-tone comb
        (same convention as Z30Modulator.synthesize_frame / audioEngine.ts:play16MfskSequence).
        """
        samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)
        dt = 1.0 / self.cfg.sample_rate_hz
        time_vec = np.arange(samples_per_symbol) * dt
        amps: List[float] = []
        for p_idx, f in enumerate(self.cfg.sync_positions):
            tone_idx = self.cfg.sync_tones[p_idx % len(self.cfg.sync_tones)]
            tone_freq = base_freq_hz + tone_idx * self.cfg.tone_spacing_hz
            start = f * samples_per_symbol
            segment = buffer[start:start + samples_per_symbol]
            if len(segment) < samples_per_symbol:
                continue
            corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * time_vec)))
            corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * time_vec)))
            amps.append(np.sqrt(corr_cos ** 2 + corr_sin ** 2) / (samples_per_symbol / 2.0))
        return max(1e-6, float(np.mean(amps))) if amps else 1e-6

    def _refine_base_freq(self, buffer: np.ndarray, rough_peak_freq_hz: float) -> float:
        """
        A raw FFT peak lands on whichever tone happened to carry the most energy, not
        necessarily tone-0. Tests all 16 possible tone-0 offsets from the peak and keeps
        the one maximizing Costas pilot correlation - a standard coarse-acquisition step.
        """
        best_freq = rough_peak_freq_hz
        best_amp = -1.0
        for k in range(self.cfg.num_tones):
            candidate_base = rough_peak_freq_hz - k * self.cfg.tone_spacing_hz
            amp = self._pilot_amplitude(buffer, candidate_base)
            if amp > best_amp:
                best_amp = amp
                best_freq = candidate_base
        return best_freq

    def _refine_fine_frequency(self, buffer: np.ndarray, base_freq_hz: float) -> float:
        """
        Sub-0.01 Hz carrier-frequency-offset (CFO) correction via multi-baseline pilot
        correlator phase-difference estimation across the 21 Costas sync positions (7
        triplets spread across the full 24s frame). This is what wiki/03's "+/-0.1 Hz
        frequency offset tracking" claim actually requires implementing.

        A single long-baseline phase-slope fit aliases once the true CFO exceeds
        1/(2*baseline): triplets are up to 8s apart, so a naive fit over the whole frame
        wraps and converges to the wrong answer for any CFO above ~0.06 Hz. This proceeds
        in stages instead - short intra-triplet baselines first (unambiguous up to the
        coarse tone-grid search's +/-1.5625 Hz residual bound), then progressively longer
        baselines, each safe only once the prior stage has shrunk the residual CFO below
        that stage's ambiguity-free range.
        """
        samples_per_symbol = int(self.cfg.sample_rate_hz * self.cfg.symbol_duration_sec)
        dt = 1.0 / self.cfg.sample_rate_hz

        def measure_phases(freq: float) -> Tuple[np.ndarray, np.ndarray]:
            # NOTE: the correlator reference must use the sample's GLOBAL time-since-frame-
            # start, not a window-local t=0..T reset. A per-symbol-local reference makes a
            # constant-Hz frequency error look like the same small phase offset at every
            # symbol (no visible slope vs. time - the bug that made the first version of
            # this method a no-op), because it throws away exactly the frame-position
            # information a CFO estimate needs. The continuous-phase modulator, and the
            # residual this is meant to null out, both accumulate phase against absolute
            # frame time, so the estimator must measure phase the same way.
            times: List[float] = []
            phases: List[float] = []
            for p_idx, f in enumerate(self.cfg.sync_positions):
                tone_idx = self.cfg.sync_tones[p_idx % len(self.cfg.sync_tones)]
                tone_freq = freq + tone_idx * self.cfg.tone_spacing_hz
                start = f * samples_per_symbol
                segment = buffer[start:start + samples_per_symbol]
                if len(segment) < samples_per_symbol:
                    continue
                t_abs = (start + np.arange(samples_per_symbol)) * dt
                corr_cos = float(np.sum(segment * np.cos(2.0 * np.pi * tone_freq * t_abs)))
                corr_sin = float(np.sum(segment * np.sin(2.0 * np.pi * tone_freq * t_abs)))
                times.append(f * self.cfg.symbol_duration_sec)
                phases.append(np.arctan2(corr_sin, corr_cos))
            return np.array(times), np.array(phases)

        freq = base_freq_hz
        for max_baseline_sec in (1.0, 4.0, 30.0):
            for _ in range(3):
                times, phases = measure_phases(freq)
                if len(times) < 2:
                    break

                slopes: List[float] = []
                weights: List[float] = []
                for i in range(len(times)):
                    for j in range(i + 1, len(times)):
                        baseline = times[j] - times[i]
                        if baseline <= 0 or baseline > max_baseline_sec:
                            continue
                        dphi = (phases[j] - phases[i] + np.pi) % (2.0 * np.pi) - np.pi
                        slopes.append(dphi / baseline)
                        weights.append(baseline)  # longer safe baselines resolve frequency more precisely

                if not slopes:
                    continue

                delta_f = float(np.average(slopes, weights=weights)) / (2.0 * np.pi)
                freq -= delta_f
                if abs(delta_f) < 0.003:
                    break

        return freq

    def _estimate_llrs(self, buffer: np.ndarray, freq_hz: float) -> Tuple[np.ndarray, float, float]:
        """
        Demodulates the candidate carrier at `freq_hz` into 216 soft channel LLRs using the
        same pilot-aided semi-coherent matched-filter bank validated in
        z30_dsp.benchmark.demodulate_mfsk_llrs.

        Noise sigma is estimated robustly from the whole-buffer sample statistics (median
        absolute deviation), consistent with `sigma` in benchmark.py's calibrated-AWGN model:
        at the weak-signal SNRs this receiver targets, wideband buffer energy is dominated by
        the noise floor, making this a standard first-order noise estimator.

        Returns (channel_llrs, pilot_amplitude_estimate, sigma_estimate).
        """
        mad = float(np.median(np.abs(buffer - np.median(buffer))))
        sigma_est = max(1e-6, mad / 0.6744897501960817)  # MAD -> Gaussian sigma

        llrs = demodulate_mfsk_llrs(buffer, self.cfg, sigma_est, audio_center_hz=freq_hz)
        pilot_amp = self._pilot_amplitude(buffer, freq_hz)
        return llrs, pilot_amp, sigma_est

    @staticmethod
    def _estimate_snr_db(pilot_amp: float, sigma_est: float) -> float:
        """Converts the pilot-tone amplitude / noise-sigma ratio into an approximate SNR figure in dB."""
        if sigma_est <= 0:
            return 0.0
        snr_linear = max(1e-6, (pilot_amp ** 2) / (2.0 * sigma_est ** 2))
        return float(np.clip(10.0 * np.log10(snr_linear), -40.0, 40.0))

    def _recover_symbols(self, info_bits: np.ndarray) -> List[int]:
        """
        Re-encodes the 77 decoded information bits back into the exact 216-bit LDPC codeword,
        then reassembles the full 75-symbol frame (54 data tones interleaved with the 21
        Costas sync tones), mirroring z30_dsp.benchmark.generate_random_frame's assembly.
        """
        codeword = self.ldpc.encode(np.array(info_bits[:63], dtype=np.uint8))

        data_symbols: List[int] = []
        for s in range(54):
            idx = s * 4
            tone = (
                (int(codeword[idx]) << 3)
                | (int(codeword[idx + 1]) << 2)
                | (int(codeword[idx + 2]) << 1)
                | int(codeword[idx + 3])
            )
            data_symbols.append(tone)

        full_symbols = [0] * self.cfg.total_symbols
        sync_pos_set = set(self.cfg.sync_positions)
        sync_cnt = 0
        data_cnt = 0
        for i in range(self.cfg.total_symbols):
            if i in sync_pos_set:
                full_symbols[i] = self.cfg.sync_tones[sync_cnt % len(self.cfg.sync_tones)]
                sync_cnt += 1
            else:
                full_symbols[i] = data_symbols[data_cnt]
                data_cnt += 1

        return full_symbols
