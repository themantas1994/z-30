"""Z-30 16-MFSK modem with Costas sync and iterative SIC."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import scipy.signal as signal

from z30_app.constants import CHAR_TO_VAL, M_TONES, SAMPLE_RATE, VAL_TO_CHAR
from z30_app.dsp.crc import CRC16_CCITT
from z30_app.dsp.ldpc import OptimizedLDPCCodec
from z30_app.dsp.metrics import DSPMetrics


def logsumexp(a: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float64)
    if a.size == 0:
        return -np.inf
    a_max = np.max(a)
    if not np.isfinite(a_max):
        return float(a_max)
    return float(a_max + np.log(np.sum(np.exp(a - a_max))))


@dataclass
class DecodeResult:
    frequency_hz: float
    time_offset_samples: int
    snr_db: float
    message: str
    dt_seconds: float


class Z30AdvancedModem:
    def __init__(self, sample_rate: int = SAMPLE_RATE, decoder_config: dict | None = None):
        self.fs = sample_rate
        self.baud = 3.125
        self.tone_spacing = 3.125
        self.m_tones = M_TONES
        self.sym_len = int(self.fs / self.baud)
        self.num_symbols = 88
        self.decoder_config = decoder_config or {}

        self.costas = np.array([2, 0, 4, 3, 6, 1, 5], dtype=int)
        self.sync_indices = list(range(0, 7)) + list(range(40, 47)) + list(range(81, 88))
        self.data_indices = [i for i in range(self.num_symbols) if i not in self.sync_indices]

        alpha = float(self.decoder_config.get("ldpc_alpha", 0.8))
        beta = float(self.decoder_config.get("ldpc_beta", 0.5))
        self.ldpc = OptimizedLDPCCodec(alpha=alpha, beta=beta)

        seed = int(self.decoder_config.get("monte_carlo_seed", 3030))
        rng = np.random.default_rng(seed)
        self.interleaver = rng.permutation(268)
        self.bit_masks = [(np.arange(16) & (1 << (3 - b))) > 0 for b in range(4)]
        self.metrics = DSPMetrics()
        self._sync_ref_cache: np.ndarray | None = None

    def string_to_bits(self, text: str) -> np.ndarray:
        text = text.upper().strip()
        bits: list[int] = []
        for char in text[:12]:
            if char in CHAR_TO_VAL:
                bits.extend(int(b) for b in f"{CHAR_TO_VAL[char]:06b}")
        while len(bits) < 75:
            bits.append(0)
        return np.array(bits[:75], dtype=np.int8)

    def bits_to_string(self, bits) -> str:
        bits = np.asarray(bits).ravel()
        text = ""
        for i in range(0, max(0, len(bits) - 5), 6):
            chunk = bits[i : i + 6]
            val = int("".join(str(int(b)) for b in chunk), 2)
            if val in VAL_TO_CHAR:
                text += VAL_TO_CHAR[val]
        return text.strip()

    def modulate(self, payload_75bit, base_freq: float = 1500.0, initial_phase: float = 0.0) -> np.ndarray:
        payload = np.asarray(payload_75bit, dtype=np.int8).ravel()[:75]
        msg_with_crc = CRC16_CCITT.append(payload)
        codeword = self.ldpc.encode(msg_with_crc)
        interleaved = np.zeros(268, dtype=np.int8)
        interleaved[self.interleaver] = codeword

        data_syms = []
        for i in range(0, 268, 4):
            val = (interleaved[i] << 3) | (interleaved[i + 1] << 2) | (interleaved[i + 2] << 1) | interleaved[i + 3]
            data_syms.append(val)

        frame = np.zeros(self.num_symbols, dtype=int)
        frame[0:7] = self.costas
        frame[40:47] = self.costas
        frame[81:88] = self.costas

        for idx, sym_i in enumerate(self.data_indices):
            frame[sym_i] = data_syms[idx]

        freq_profile = np.repeat(base_freq + (frame * self.tone_spacing), self.sym_len)
        phases = initial_phase + 2.0 * np.pi * np.cumsum(freq_profile) / self.fs
        return np.exp(1j * phases)

    def generate_sync_reference(self, base_freq: float = 0.0) -> np.ndarray:
        if base_freq == 0.0 and self._sync_ref_cache is not None:
            return self._sync_ref_cache

        frame = np.zeros(self.num_symbols, dtype=int)
        frame[0:7] = self.costas
        frame[40:47] = self.costas
        frame[81:88] = self.costas
        waveform = np.zeros(self.num_symbols * self.sym_len, dtype=np.complex64)
        t = np.arange(self.sym_len, dtype=np.float64) / self.fs
        for idx in self.sync_indices:
            f = base_freq + frame[idx] * self.tone_spacing
            waveform[idx * self.sym_len : (idx + 1) * self.sym_len] = np.exp(1j * 2 * np.pi * f * t)
        if base_freq == 0.0:
            self._sync_ref_cache = waveform
        return waveform

    def _symbol_energies(self, chunk: np.ndarray, base_freq: float) -> np.ndarray:
        """Non-coherent tone energy via local FFT (robust for continuous-phase MFSK)."""
        real = np.asarray(np.real(chunk), dtype=np.float64)
        windowed = real * np.hanning(len(real))
        spectrum = np.fft.rfft(windowed)
        freqs = np.fft.rfftfreq(len(chunk), d=1.0 / self.fs)
        energies = np.zeros(self.m_tones)
        bin_hz = self.fs / len(chunk)
        for m in range(self.m_tones):
            f_target = base_freq + m * self.tone_spacing
            idx = int(round(f_target / bin_hz))
            idx = min(max(idx, 0), len(spectrum) - 1)
            lo = max(0, idx - 1)
            hi = min(len(spectrum), idx + 2)
            energies[m] = float(np.sum(np.abs(spectrum[lo:hi]) ** 2))
        return energies

    def acquire(self, rx_complex: np.ndarray) -> tuple[int, float, float]:
        ref_sync = self.generate_sync_reference(0)
        best_snr, best_dt, best_df = -99.0, 0, 0.0
        step = float(self.decoder_config.get("freq_search_step", 10.0))

        rx_len = len(rx_complex)
        time_axis = np.arange(rx_len, dtype=np.float64) / self.fs
        ref_ds = ref_sync[::-4].conj()

        for df in np.arange(200, 3000, step):
            shifted = rx_complex * np.exp(-1j * 2 * np.pi * df * time_axis)
            corr = np.abs(signal.fftconvolve(shifted[::4], ref_ds, mode="valid"))
            if corr.size == 0:
                continue
            peak_idx = int(np.argmax(corr))
            snr_metric = 20 * math.log10(corr[peak_idx] / (np.median(corr) + 1e-6))
            if snr_metric > best_snr:
                best_snr = snr_metric
                best_dt = peak_idx * 4
                best_df = float(df)

        self.metrics.sync_score = best_snr
        best_dt = self._refine_timing(rx_complex, best_dt, best_df)
        return best_dt, best_df, best_snr

    def _refine_timing(self, rx_complex: np.ndarray, coarse_dt: int, df: float) -> int:
        """Fine-align symbol boundary by maximizing sync symbol energy."""
        best_dt = coarse_dt
        best_score = -1.0
        lo = max(0, coarse_dt - self.sym_len)
        hi = min(len(rx_complex) - self.sym_len, coarse_dt + self.sym_len)
        for dt in range(lo, hi, 4):
            score = 0.0
            for block_start, costas_block in ((0, self.costas), (40, self.costas), (81, self.costas)):
                for j, tone in enumerate(costas_block):
                    start = dt + (block_start + j) * self.sym_len
                    end = start + self.sym_len
                    if end > len(rx_complex):
                        continue
                    e = self._symbol_energies(rx_complex[start:end], df)
                    score += e[int(tone)]
            if score > best_score:
                best_score = score
                best_dt = dt
        return best_dt

    def _decode_one(self, residual_audio: np.ndarray) -> tuple[DecodeResult | None, np.ndarray]:
        dt, df, snr_metric = self.acquire(residual_audio)
        threshold = float(self.decoder_config.get("snr_threshold", 8.0))
        if snr_metric < threshold:
            return None, residual_audio

        N0 = np.var(residual_audio) * (self.tone_spacing / self.fs) + 1e-12
        llrs: list[float] = []

        for i in self.data_indices:
            idx_start = dt + i * self.sym_len
            if idx_start + self.sym_len > len(residual_audio):
                break
            chunk = residual_audio[idx_start : idx_start + self.sym_len]
            energies = self._symbol_energies(chunk, df)
            z = energies / (2 * N0)
            for b in range(4):
                llrs.append(logsumexp(z[~self.bit_masks[b]]) - logsumexp(z[self.bit_masks[b]]))

        if len(llrs) < 268:
            return None, residual_audio

        channel_llrs = np.asarray(llrs, dtype=np.float64)
        codeword_llrs = channel_llrs[self.interleaver]
        hard_bits = self.ldpc.decode(
            codeword_llrs,
            max_iter=int(self.decoder_config.get("ldpc_max_iter", 30)),
            algorithm=self.decoder_config.get("ldpc_algorithm", "normalized_min_sum"),
            early_stop=bool(self.decoder_config.get("early_stop", True)),
        )
        payload = hard_bits[:75]
        crc_received = hard_bits[75:91]

        if not CRC16_CCITT.verify(payload, crc_received):
            self.metrics.crc_failures += 1
            return None, residual_audio

        msg_str = self.bits_to_string(payload)
        es = (10 ** (snr_metric / 20)) ** 2
        noise_var = np.var(residual_audio) * 2500 + 1e-12
        snr_db = 10 * math.log10((es / (self.sym_len / self.fs)) / noise_var)

        result = DecodeResult(
            frequency_hz=df,
            time_offset_samples=dt,
            snr_db=round(snr_db, 1),
            message=msg_str,
            dt_seconds=dt / self.fs,
        )

        ideal = self.modulate(payload, base_freq=df)
        end = min(dt + len(ideal), len(residual_audio))
        rx_chunk = residual_audio[dt:end]
        ideal = ideal[: len(rx_chunk)]
        denom = np.vdot(ideal, ideal)
        if abs(denom) > 1e-12:
            h = np.vdot(ideal, rx_chunk) / denom
            residual_audio = residual_audio.copy()
            residual_audio[dt:end] -= h * ideal

        return result, residual_audio

    def sic_decode_loop(self, rx_audio: np.ndarray) -> list[DecodeResult]:
        audio = np.asarray(rx_audio, dtype=np.float64)
        if audio.size == 0:
            return []

        if np.isrealobj(audio):
            rx_complex = signal.hilbert(audio)
        else:
            rx_complex = audio.astype(np.complex128)

        self.metrics.noise_floor_db = 10 * math.log10(np.var(rx_complex) + 1e-20)
        self.metrics.reset_cycle()

        outer_iters = int(self.decoder_config.get("sic_iterations", 5))
        max_layers = int(self.decoder_config.get("sic_layers", 3))
        decoded: list[DecodeResult] = []
        residual = rx_complex.copy()

        for outer in range(outer_iters):
            layer_found = 0
            for _ in range(max_layers):
                one, residual = self._decode_one(residual)
                if one is None:
                    break
                decoded.append(one)
                layer_found += 1
                self.metrics.decode_count += 1
            self.metrics.sic_layers = max(self.metrics.sic_layers, layer_found)
            self.metrics.sic_iterations = outer + 1
            if layer_found == 0:
                break

        if decoded:
            self.metrics.last_snr = decoded[0].snr_db
        return decoded

    def sic_decode_loop_legacy(self, rx_audio: np.ndarray) -> list[tuple[float, int, float, str]]:
        """Backward-compatible tuple format."""
        return [
            (r.frequency_hz, r.time_offset_samples, r.snr_db, r.message)
            for r in self.sic_decode_loop(rx_audio)
        ]
