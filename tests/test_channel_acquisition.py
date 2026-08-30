"""
Channel-impairment and blind-acquisition tests.

These cover the machinery that turns the benchmark from a genie-aided bound into a decode
threshold: the Watterson fading model, the carrier and timing offsets, and the acquisition
stage that has to undo them knowing only the audio.

The property that matters most here is that acquisition is HONEST - that it is not
accidentally being handed the answer. `test_acquisition_uses_only_the_audio` is the guard
against the whole point of the exercise being quietly undone again.
"""

import numpy as np
import pytest

from z30_dsp.acquisition import Acquisition, acquire_frame, estimate_noise_sigma
from z30_dsp.benchmark import add_calibrated_awgn, generate_random_frame
from z30_dsp.channel import (
    WATTERSON_PRESETS,
    ChannelImpairments,
    apply_frequency_offset,
    apply_time_offset,
    apply_watterson_fading,
    impair_frame,
)
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.modem import Z30Config, Z30Modulator

SAMPLE_RATE = 6000


@pytest.fixture(scope="module")
def cfg():
    return Z30Config(sample_rate_hz=SAMPLE_RATE)


@pytest.fixture(scope="module")
def modulator(cfg):
    return Z30Modulator(cfg)


@pytest.fixture(scope="module")
def codec():
    return Z30LdpcCodec()


def make_frame(codec, cfg, modulator, rng):
    """A real frame, with the Costas sync symbols in their proper positions."""
    _payload, _cw, _data, symbols = generate_random_frame(codec, cfg, rng)
    return modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)


class TestFrequencyOffset:
    def test_shifts_the_tone_and_does_not_mirror_it(self):
        """A naive cosine multiply would create a second image at -offset; the analytic-signal
        method must not."""
        fs = SAMPLE_RATE
        n = fs * 4
        tone = np.sin(2 * np.pi * 1000.0 * np.arange(n) / fs).astype(np.float32)
        shifted = apply_frequency_offset(tone, 25.0, fs)

        spectrum = np.abs(np.fft.rfft(shifted * np.hanning(n)))
        freqs = np.fft.rfftfreq(n, 1.0 / fs)
        peak_hz = float(freqs[int(np.argmax(spectrum))])
        assert peak_hz == pytest.approx(1025.0, abs=1.0)

        # No significant energy left at the original frequency.
        original_bin = int(np.argmin(np.abs(freqs - 1000.0)))
        peak_bin = int(np.argmax(spectrum))
        assert spectrum[original_bin] < 0.05 * spectrum[peak_bin]

    def test_zero_offset_is_a_no_op(self):
        wave = np.sin(np.linspace(0, 100, 4096)).astype(np.float32)
        np.testing.assert_allclose(apply_frequency_offset(wave, 0.0, SAMPLE_RATE), wave)


class TestTimeOffset:
    def test_frame_lands_where_the_reported_true_start_says(self):
        wave = np.ones(1000, dtype=np.float32)
        buf, true_start = apply_time_offset(wave, 0.25, SAMPLE_RATE, pad_sec=1.0)
        np.testing.assert_allclose(buf[true_start:true_start + wave.size], wave)
        assert buf[:true_start].max() == 0.0, "guard region before the frame is not silent"
        assert buf[true_start + wave.size:].max() == 0.0, "guard region after the frame is not silent"

    def test_offset_beyond_the_guard_padding_raises(self):
        with pytest.raises(ValueError):
            apply_time_offset(np.ones(10, dtype=np.float32), -5.0, SAMPLE_RATE, pad_sec=1.0)


class TestWattersonFading:
    @pytest.mark.parametrize("preset_name", sorted(WATTERSON_PRESETS))
    def test_average_power_is_preserved(self, preset_name):
        """
        The channel must neither add nor remove average power, or the SNR the caller asked for
        is not the SNR the receiver sees and every point on the curve is mislabelled.
        """
        rng = np.random.default_rng(4)
        wave = np.sin(2 * np.pi * 1250.0 * np.arange(SAMPLE_RATE * 20) / SAMPLE_RATE).astype(np.float32)
        faded = apply_watterson_fading(wave, SAMPLE_RATE, WATTERSON_PRESETS[preset_name], rng)
        ratio = float(np.mean(faded ** 2)) / float(np.mean(wave ** 2))
        assert 0.5 < ratio < 2.0, f"{preset_name} changed average power by {ratio:.2f}x"

    def test_no_fading_preset_is_a_no_op(self):
        rng = np.random.default_rng(0)
        wave = np.sin(np.linspace(0, 500, 8192)).astype(np.float32)
        np.testing.assert_allclose(
            apply_watterson_fading(wave, SAMPLE_RATE, WATTERSON_PRESETS["none"], rng), wave
        )

    def test_more_disturbed_presets_fade_faster(self):
        """
        The presets differ in Doppler SPREAD, which is a rate, not a depth: a 'poor' path
        (1.0 Hz) decorrelates in about a second, a 'good' one (0.1 Hz) in about ten. Measuring
        block-to-block RMS variance would get this backwards - at a one-second block size the
        fast channel averages out inside each block and looks *steadier* than the slow one.
        What distinguishes them is how quickly the envelope decorrelates.
        """
        wave = np.sin(2 * np.pi * 1250.0 * np.arange(SAMPLE_RATE * 60) / SAMPLE_RATE).astype(np.float32)
        block = SAMPLE_RATE // 10  # 100 ms, short relative to even the fastest preset

        def decorrelation_lag_sec(name: str) -> float:
            rng = np.random.default_rng(11)
            faded = apply_watterson_fading(wave, SAMPLE_RATE, WATTERSON_PRESETS[name], rng)
            blocks = faded[: (faded.size // block) * block].reshape(-1, block)
            envelope = np.sqrt(np.mean(blocks ** 2, axis=1))
            envelope = envelope - envelope.mean()
            acf = np.correlate(envelope, envelope, mode="full")[envelope.size - 1:]
            acf /= acf[0]
            below = np.flatnonzero(acf < 0.5)
            lag_blocks = int(below[0]) if below.size else envelope.size
            return lag_blocks * block / SAMPLE_RATE

        fast = decorrelation_lag_sec("poor")
        slow = decorrelation_lag_sec("good")
        assert fast < slow, (
            f"the 'poor' preset (1.0 Hz Doppler) decorrelates in {fast:.2f}s, which is not "
            f"faster than 'good' (0.1 Hz Doppler) at {slow:.2f}s - the presets are inert"
        )

    def test_unknown_preset_is_rejected(self):
        with pytest.raises(ValueError):
            ChannelImpairments(fading="tropical").preset


class TestAcquisition:
    def test_finds_a_clean_frame_precisely(self, cfg, modulator, codec):
        rng = np.random.default_rng(5)
        wave = make_frame(codec, cfg, modulator, rng)
        buf, true_start = apply_time_offset(wave, 0.17, cfg.sample_rate_hz)
        acq = acquire_frame(buf, cfg)

        timing_err_ms = abs(acq.start_sample - true_start) / cfg.sample_rate_hz * 1000
        assert timing_err_ms < 10.0, f"clean-frame timing error {timing_err_ms:.1f} ms"
        assert abs(acq.base_freq_hz - 1250.0) < 0.2

    def test_recovers_carrier_and_timing_offsets_at_usable_snr(self, cfg, modulator, codec):
        rng = np.random.default_rng(20260830)
        impairments = ChannelImpairments(fading="none")
        timing_errors, freq_errors = [], []

        for _ in range(6):
            wave = make_frame(codec, cfg, modulator, rng)
            buf, true_start, true_foff = impair_frame(wave, cfg.sample_rate_hz, impairments, rng)
            noisy, _ = add_calibrated_awgn(
                buf, -18.0, cfg.sample_rate_hz, rng, float(np.mean(wave ** 2))
            )
            acq = acquire_frame(noisy, cfg)
            timing_errors.append(abs(acq.start_sample - true_start) / cfg.sample_rate_hz)
            freq_errors.append(abs(acq.base_freq_hz - (1250.0 + true_foff)))

        # Well inside what the 320 ms symbol and 3.125 Hz tone spacing can tolerate.
        assert max(timing_errors) < 0.05, f"worst timing error {max(timing_errors) * 1000:.0f} ms"
        assert max(freq_errors) < 0.5, f"worst frequency error {max(freq_errors):.2f} Hz"

    def test_acquisition_uses_only_the_audio(self, cfg, modulator, codec):
        """
        Acquisition must depend on nothing but the samples it is given. If it is ever
        accidentally handed the true offsets - the defect this whole module exists to fix -
        shifting the buffer would not shift the answer by the same amount.
        """
        rng = np.random.default_rng(3)
        wave = make_frame(codec, cfg, modulator, rng)
        buf, true_start = apply_time_offset(wave, 0.0, cfg.sample_rate_hz)
        first = acquire_frame(buf, cfg)

        extra = 1000
        shifted = np.concatenate([np.zeros(extra, dtype=np.float32), buf])
        second = acquire_frame(shifted, cfg)

        assert second.start_sample - first.start_sample == pytest.approx(extra, abs=cfg.sample_rate_hz // 32), \
            "acquisition did not track a known shift in the input - it is not reading the audio"

    def test_reports_no_detection_on_pure_noise(self, cfg):
        rng = np.random.default_rng(2)
        noise = rng.normal(0.0, 1.0, cfg.sample_rate_hz * 30).astype(np.float32)
        acq = acquire_frame(noise, cfg)
        # Pure noise must not produce a confident sync score. The exact peak position is
        # arbitrary; what matters is that it does not stand out from the search-grid floor.
        assert acq.sync_score_db < 6.0, f"pure noise scored {acq.sync_score_db:.1f} dB"

    def test_noise_estimate_tracks_the_real_noise_level(self, cfg):
        for true_sigma in (0.05, 0.2, 1.0):
            rng = np.random.default_rng(8)
            noise = rng.normal(0.0, true_sigma, cfg.sample_rate_hz * 20).astype(np.float32)
            estimated = estimate_noise_sigma(noise, cfg, signal_centre_hz=1250.0)
            ratio = estimated / true_sigma
            assert 0.5 < ratio < 2.0, \
                f"noise estimate {estimated:.4f} vs true {true_sigma:.4f} (ratio {ratio:.2f})"


class TestEndToEnd:
    def test_a_strong_frame_decodes_through_the_full_blind_chain(self, cfg, modulator, codec):
        """
        The whole point: impairments in, blind acquisition, blind noise estimate, real decode.
        At a comfortable SNR this must work, or the realistic benchmark mode measures nothing.
        """
        from z30_dsp.benchmark import demodulate_mfsk_llrs

        rng = np.random.default_rng(20260830)
        impairments = ChannelImpairments(fading="none")
        decoded = 0
        trials = 5

        for _ in range(trials):
            payload, _cw, _data, symbols = generate_random_frame(codec, cfg, rng)
            wave = modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)
            buf, _true_start, _true_foff = impair_frame(wave, cfg.sample_rate_hz, impairments, rng)
            noisy, _ = add_calibrated_awgn(
                buf, -14.0, cfg.sample_rate_hz, rng, float(np.mean(wave ** 2))
            )

            acq = acquire_frame(noisy, cfg)
            llrs = demodulate_mfsk_llrs(
                noisy, cfg, acq.noise_sigma,
                audio_center_hz=acq.base_freq_hz, start_sample=acq.start_sample,
            )
            success, info, _iters = codec.decode_min_sum(llrs)
            if success and np.array_equal(info[:63], payload):
                decoded += 1

        assert decoded == trials, f"only {decoded}/{trials} strong frames survived the blind chain"
