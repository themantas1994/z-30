"""
Foundational tests for the (216, 77) LDPC codec.

The codec, the modem and the decoder are exactly the kind of code where a subtle regression
produces plausible-looking output that is quietly wrong, so these assert the properties that
make the code a code at all: the encoder satisfies its own parity-check matrix, the structure
has the girth it claims, and a frame survives the round trip at a working SNR.
"""

import numpy as np
import pytest

from z30_dsp.ldpc import Z30LdpcCodec, Z30_CHECK_TO_INFO
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp import benchmark

SEED = 20260830


@pytest.fixture(scope="module")
def codec() -> Z30LdpcCodec:
    return Z30LdpcCodec(max_iterations=45, alpha=0.75)


def build_parity_check_matrix() -> np.ndarray:
    """
    Reconstructs H = [H_info | H_parity] from the published connection table and the
    dual-diagonal accumulator structure described in z30_dsp/ldpc.py.
    """
    m, k = 139, 77
    h = np.zeros((m, k + m), dtype=np.uint8)
    for check, info_bits in enumerate(Z30_CHECK_TO_INFO):
        for bit in info_bits:
            h[check, bit] ^= 1
        h[check, k + check] = 1
        if check >= 1:
            h[check, k + check - 1] = 1
    return h


def test_connection_table_shape():
    """139 checks of degree 5, with no repeated information bit inside a row."""
    assert len(Z30_CHECK_TO_INFO) == 139
    for check, row in enumerate(Z30_CHECK_TO_INFO):
        assert len(row) == 5, f"check {check} has degree {len(row)}"
        assert len(set(row)) == 5, f"check {check} repeats an information bit: {row}"
        assert all(0 <= bit < 77 for bit in row), f"check {check} indexes outside 0..76: {row}"


def test_no_length_four_cycles_on_information_side():
    """
    Girth 6 on the information side: no two checks may share more than one information bit.
    Two shared bits would close a length-4 cycle, and length-4 cycles are what make belief
    propagation exchange correlated messages and stall short of the code's real threshold.
    """
    sets = [set(row) for row in Z30_CHECK_TO_INFO]
    for i in range(len(sets)):
        for j in range(i + 1, len(sets)):
            shared = sets[i] & sets[j]
            assert len(shared) <= 1, f"checks {i} and {j} share {sorted(shared)} - length-4 cycle"


def test_information_bit_degrees_are_near_regular():
    degrees = [0] * 77
    for row in Z30_CHECK_TO_INFO:
        for bit in row:
            degrees[bit] += 1
    assert min(degrees) >= 8
    assert max(degrees) <= 10


def test_encoder_satisfies_its_own_parity_check_matrix(codec):
    """Every codeword the encoder produces must have a zero syndrome under H."""
    h = build_parity_check_matrix()
    rng = np.random.default_rng(SEED)
    for _ in range(50):
        payload = rng.integers(0, 2, 63, dtype=np.uint8)
        codeword = codec.encode(payload)
        assert codeword.shape == (216,)
        syndrome = (h @ codeword) % 2
        assert not syndrome.any(), "non-zero syndrome: the encoder disagrees with H"


def test_crc14_round_trip(codec):
    """The CRC is embedded at bits 63..76 of the information block and must survive encoding."""
    rng = np.random.default_rng(SEED + 1)
    for _ in range(20):
        payload = rng.integers(0, 2, 63, dtype=np.uint8)
        codeword = codec.encode(payload)
        embedded = int("".join(str(int(b)) for b in codeword[63:77]), 2)
        assert embedded == codec.compute_crc14(payload)


def test_crc14_detects_single_bit_errors(codec):
    """A one-bit change in the payload must change the CRC."""
    rng = np.random.default_rng(SEED + 2)
    payload = rng.integers(0, 2, 63, dtype=np.uint8)
    baseline = codec.compute_crc14(payload)
    for bit in range(63):
        corrupted = payload.copy()
        corrupted[bit] ^= 1
        assert codec.compute_crc14(corrupted) != baseline, f"CRC blind to a flip at bit {bit}"


@pytest.mark.parametrize("snr_db", [-20.0, -18.0])
def test_end_to_end_round_trip_at_working_snr(codec, snr_db):
    """
    Full path: payload -> LDPC -> 16-MFSK waveform -> AWGN -> matched-filter LLRs -> decode.

    Run at SNRs comfortably above threshold, so this is a functional check that the chain is
    wired together correctly rather than a sensitivity measurement. Seeded, so a failure here
    is reproducible.
    """
    cfg = Z30Config(sample_rate_hz=6000)
    modulator = Z30Modulator(cfg)
    rng = np.random.default_rng(SEED + int(abs(snr_db)))

    successes = 0
    trials = 6
    for _ in range(trials):
        payload, _codeword, _data, symbols = benchmark.generate_random_frame(codec, cfg, rng)
        clean = modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)
        noisy, sigma = benchmark.add_calibrated_awgn(clean, snr_db, cfg.sample_rate_hz, rng)
        llrs = benchmark.demodulate_mfsk_llrs(noisy, cfg, sigma, audio_center_hz=1250.0)
        ok, info, _iters = codec.decode_min_sum(llrs)
        if ok and np.array_equal(np.asarray(info[:63], dtype=np.uint8), payload):
            successes += 1

    assert successes == trials, f"only {successes}/{trials} frames decoded at {snr_db} dB"


def test_decoder_is_deterministic_for_a_given_input(codec):
    """Same LLRs in, same decision out - a decoder with hidden state cannot be reasoned about."""
    cfg = Z30Config(sample_rate_hz=6000)
    modulator = Z30Modulator(cfg)
    rng = np.random.default_rng(SEED + 9)
    _payload, _cw, _ds, symbols = benchmark.generate_random_frame(codec, cfg, rng)
    clean = modulator.synthesize_frame(symbols, base_audio_freq_hz=1250.0)
    noisy, sigma = benchmark.add_calibrated_awgn(clean, -18.0, cfg.sample_rate_hz, rng)
    llrs = benchmark.demodulate_mfsk_llrs(noisy, cfg, sigma, audio_center_hz=1250.0)

    first = codec.decode_min_sum(llrs)
    second = codec.decode_min_sum(llrs)
    assert first[0] == second[0]
    assert np.array_equal(first[1], second[1])
    assert first[2] == second[2]
