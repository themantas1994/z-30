"""
The vectorised check-node sweep decodes exactly what the scalar one did.

`Z30LdpcCodec._sweep_checks` replaced a per-edge scalar loop with per-check NumPy arithmetic.
That is a pure speed change and it has to stay one: the four schedules, their alpha/beta/damping
triples, the layered check order and every rounding step are what the published -23.1 dB / -21.7 dB
thresholds in wiki/16 were measured through. A decoder that is 1 ULP different near threshold is a
decoder that decodes a different set of marginal frames, and the curve moves.

So this file carries a transcription of the scalar sweep the vectorised kernel replaced, and pins
the two together **bit for bit** - not "close", not "same decodes on the frames we tried":
`np.array_equal` on the float32 message state after every sweep. The transcription reads its
alpha/beta/damping from `DECODE_SCHEDULES`, so retuning a schedule moves both sides together and
only a change to the *kernel* can break the pin.

Every LLR vector here comes out of the real chain - real payload, real modulator, real calibrated
AWGN, real demodulator - because the arithmetic that has to agree is the arithmetic that runs on
real signals: message magnitudes near the min-sum clip, sign patterns from real noise, and the
saturated LLRs that a frame below threshold actually produces.
"""

import numpy as np
import pytest

from z30_dsp.ldpc import (
    DECODE_SCHEDULES,
    Z30LdpcCodec,
    _SweepScratch,
    dither_vector,
)
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp import benchmark

SEED = 20260830


@pytest.fixture(scope="module")
def codec() -> Z30LdpcCodec:
    return Z30LdpcCodec()


def reference_sweep(codec: Z30LdpcCodec, total_llrs, c_to_v, sched) -> None:
    """
    The scalar layered check-node sweep, transcribed from the implementation that stood before
    the vectorised kernel, and left in its original shape on purpose - this is the specification
    the kernel is measured against, so it is not tidied, renamed or "improved".

    `total_llrs` is a float32 array and `c_to_v` a list of float32 arrays, one per check, in the
    ascending variable order `check_to_vars` uses; both are mutated in place.
    """
    check_order = list(range(codec.m))[::-1] if sched['reverse'] else list(range(codec.m))

    for c in check_order:
        vars_connected = codec.check_to_vars[c]
        num_vars = len(vars_connected)

        v_to_c_vals = np.zeros(num_vars, dtype=np.float32)
        min1, min2 = 999999.0, 999999.0
        min1_idx = -1
        prod_sign = 1.0

        for i, v in enumerate(vars_connected):
            val = total_llrs[v] - c_to_v[c][i]
            v_to_c_vals[i] = val
            sign = 1.0 if val >= 0 else -1.0
            prod_sign *= sign
            mag = abs(val)
            if mag < min1:
                min2 = min1
                min1 = mag
                min1_idx = i
            elif mag < min2:
                min2 = mag

        for i, v in enumerate(vars_connected):
            val = v_to_c_vals[i]
            self_sign = 1.0 if val >= 0 else -1.0
            edge_sign = prod_sign * self_sign
            min_mag = min2 if i == min1_idx else min1

            if sched['mode'] == 'SPA':
                box_acc = 999.0
                first = True
                for j in range(num_vars):
                    if j != i:
                        if first:
                            box_acc = v_to_c_vals[j]
                            first = False
                        else:
                            box_acc = codec._box_plus(box_acc, v_to_c_vals[j])
                new_msg = np.clip(sched['alpha'] * box_acc, -20.0, 20.0)
            else:
                new_msg = edge_sign * max(0.0, sched['alpha'] * min_mag - sched['beta'])

            damped_msg = (1.0 - sched['damping']) * c_to_v[c][i] + sched['damping'] * new_msg
            diff = damped_msg - c_to_v[c][i]
            c_to_v[c][i] = damped_msg
            total_llrs[v] += diff


def real_channel_llrs(snr_db: float, frames: int, seed: int = SEED):
    """
    Yields `frames` channel-LLR vectors produced by the real transmit and receive chain at
    `snr_db`, so the equivalence pin runs on the arithmetic real signals produce rather than on
    synthetic values chosen to be easy.
    """
    cfg = Z30Config()
    codec = Z30LdpcCodec()
    modulator = Z30Modulator(cfg)
    rng = np.random.default_rng(seed)

    for _ in range(frames):
        _payload, _codeword, _data_symbols, full_symbols = benchmark.generate_random_frame(
            codec, cfg, rng
        )
        clean = modulator.synthesize_frame(full_symbols, base_audio_freq_hz=1250.0)
        noisy, sigma = benchmark.add_calibrated_awgn(
            clean, snr_db, cfg.sample_rate_hz, rng, float(np.mean(clean ** 2))
        )
        yield benchmark.demodulate_mfsk_llrs(
            noisy, cfg, sigma, audio_center_hz=1250.0, start_sample=0, pilot_coherence=None
        )


def sweep_both(codec: Z30LdpcCodec, llrs: np.ndarray, sched, sweeps: int):
    """
    Runs `sweeps` consecutive sweeps of one schedule through both implementations from the same
    start state, comparing after every sweep.

    Consecutive sweeps matter: a single sweep can agree by luck on a frame whose messages never
    reach an interesting magnitude, but the schedules run up to 45 of them and any divergence
    compounds, so the later sweeps are the ones that would expose a mismatched rounding step.
    """
    vec_llrs = np.array(llrs, dtype=np.float32)
    vec_msgs = np.zeros(codec._n_edges, dtype=np.float32)
    scratch = _SweepScratch(codec._max_check_degree)

    ref_llrs = np.array(llrs, dtype=np.float32)
    ref_msgs = [
        np.zeros(len(codec.check_to_vars[c]), dtype=np.float32) for c in range(codec.m)
    ]

    for sweep in range(sweeps):
        codec._sweep_checks(
            vec_llrs,
            vec_msgs,
            scratch,
            sched['alpha'],
            sched['beta'],
            sched['damping'],
            sched['mode'] == 'SPA',
            sched['reverse'],
        )
        reference_sweep(codec, ref_llrs, ref_msgs, sched)

        assert np.array_equal(vec_llrs, ref_llrs), (
            f"total LLRs diverged on sweep {sweep + 1} of schedule {sched['mode']}: "
            f"max |delta| {float(np.max(np.abs(vec_llrs - ref_llrs)))}"
        )
        flat_ref = np.concatenate(ref_msgs)
        assert np.array_equal(vec_msgs, flat_ref), (
            f"check-to-variable messages diverged on sweep {sweep + 1} of "
            f"schedule {sched['mode']}: max |delta| "
            f"{float(np.max(np.abs(vec_msgs - flat_ref)))}"
        )


@pytest.mark.parametrize("sched", DECODE_SCHEDULES, ids=[s['mode'] for s in DECODE_SCHEDULES])
@pytest.mark.parametrize("snr_db", [-19.0, -23.0, -26.0])
def test_sweep_is_bit_identical_to_the_scalar_reference(codec, sched, snr_db):
    """
    Every schedule, on real frames from a decodable SNR down to one well below threshold.

    -26 dB is the important row: there the messages never converge, so the sweep runs on
    saturated, sign-flipping LLRs for its whole cap - the regime where a normalisation applied in
    the wrong precision, or a min1/min2 tie broken the other way, shows up.
    """
    for llrs in real_channel_llrs(snr_db, frames=2):
        sweep_both(codec, llrs, sched, sweeps=6)


def test_dithered_schedule_start_state_is_swept_identically(codec):
    """
    Schedule 4 perturbs the channel LLRs before sweeping, so its start state is the one place
    where the two implementations could be handed different numbers rather than compute them
    differently. The perturbation is derived from the LLRs themselves (`dither_vector`), so both
    sides must see the same start, and the sweep on it must still agree.
    """
    sched = next(s for s in DECODE_SCHEDULES if s['mode'] == 'DITHER')
    for llrs in real_channel_llrs(-24.0, frames=2):
        start = np.array(llrs, dtype=np.float32)
        start += dither_vector(np.array(llrs, dtype=np.float32), len(start))
        sweep_both(codec, start, sched, sweeps=6)


@pytest.mark.parametrize("snr_db", [-18.0, -21.0, -23.0, -25.0])
def test_full_decode_matches_a_reference_cascade(codec, snr_db):
    """
    End to end: the shipped decoder against a cascade built from the scalar reference sweep.

    This covers the parts outside the sweep that were rewritten alongside it - the hard-decision
    slice, the integer CRC-field extraction and the prefix-XOR parity accumulation - by requiring
    the same success flag, the same 77 information bits and the same iteration count. The
    iteration count is the strict half: it is where the early exits fired, so two decoders that
    agree on it agreed at every syndrome and CRC test along the way.
    """
    for llrs in real_channel_llrs(snr_db, frames=3):
        got_ok, got_bits, got_iters = codec.decode_min_sum(llrs)
        want_ok, want_bits, want_iters = reference_decode(codec, llrs)

        assert got_ok == want_ok
        assert got_iters == want_iters
        assert np.array_equal(np.asarray(got_bits), np.asarray(want_bits))


def reference_decode(codec: Z30LdpcCodec, llr_channel: np.ndarray):
    """
    `decode_min_sum` driven by `reference_sweep`: the same cascade, the same early exits, the
    same OSD-2 Chase search, with the scalar sweep in place of the vectorised one.

    The integer-only helpers (`compute_crc14`, `compute_syndrome`, `reaccumulate_ira_codeword`)
    are called on the codec rather than re-transcribed - XOR and a CRC register are exact in any
    implementation, and `tests/test_ldpc_codec.py` already holds them to the parity-check matrix.
    """
    input_llr = np.array(llr_channel, dtype=np.float32)

    raw_hard = np.array([1 if x < 0 else 0 for x in input_llr], dtype=np.uint8)
    raw_crc = int("".join(str(b) for b in raw_hard[63:77]), 2)
    if codec.compute_crc14(raw_hard[:63]) == raw_crc:
        if np.all(codec.compute_syndrome(raw_hard) == 0):
            return True, raw_hard[:codec.k], 1

    schedules = [
        dict(sched, iters=min(sched['iters'], codec.max_iterations))
        for sched in DECODE_SCHEDULES
    ]

    best_codeword = np.zeros(codec.n, dtype=np.uint8)
    min_syndrome_weight = 999
    total_iterations = 0
    best_total_llrs = np.copy(input_llr)

    for sched in schedules:
        total_llrs = np.copy(input_llr)
        if sched['mode'] == 'DITHER':
            total_llrs += dither_vector(input_llr, codec.n)

        c_to_v = [np.zeros(len(codec.check_to_vars[c]), dtype=np.float32) for c in range(codec.m)]

        for _iteration in range(1, sched['iters'] + 1):
            total_iterations += 1
            reference_sweep(codec, total_llrs, c_to_v, sched)

            hard_decision = np.array([1 if x < 0 else 0 for x in total_llrs], dtype=np.uint8)
            syndrome = codec.compute_syndrome(hard_decision)
            syn_weight = int(np.sum(syndrome))

            if syn_weight < min_syndrome_weight:
                min_syndrome_weight = syn_weight
                best_codeword = np.copy(hard_decision)
                best_total_llrs = np.copy(total_llrs)

            if syn_weight == 0:
                info_bits = hard_decision[:codec.k]
                rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
                if codec.compute_crc14(info_bits[:63]) == rcvd_crc:
                    return True, info_bits, total_iterations

            tentative_payload = hard_decision[:63]
            tentative_crc = codec.compute_crc14(tentative_payload)
            rcvd_crc = int("".join(str(b) for b in hard_decision[63:77]), 2)

            if tentative_crc == rcvd_crc:
                crc_bits = np.array([(tentative_crc >> (13 - b)) & 1 for b in range(14)], dtype=np.uint8)
                tentative_info = np.concatenate([tentative_payload, crc_bits])
                ira_cw = codec.reaccumulate_ira_codeword(tentative_info)
                if np.all(codec.compute_syndrome(ira_cw) == 0):
                    corr = np.sum((1.0 - 2.0 * ira_cw.astype(np.float32)) * input_llr)
                    diff_from_hard = np.sum(ira_cw != hard_decision)
                    if corr > 0 and diff_from_hard <= 12:
                        return True, tentative_info, total_iterations

        if min_syndrome_weight == 0:
            info_bits = best_codeword[:codec.k]
            rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
            if codec.compute_crc14(info_bits[:63]) == rcvd_crc:
                return True, info_bits, total_iterations

    if min_syndrome_weight <= 14:
        base_payload = best_codeword[:63]
        ranked_indices = sorted(range(63), key=lambda i: abs(best_total_llrs[i]))
        test_indices = ranked_indices[:min(14, len(ranked_indices))]

        best_osd_cw = None
        max_correlation = 0.0

        def eval_candidate(candidate_payload: np.ndarray):
            nonlocal best_osd_cw, max_correlation
            crc = codec.compute_crc14(candidate_payload)
            crc_bits = np.array([(crc >> (13 - b)) & 1 for b in range(14)], dtype=np.uint8)
            info77 = np.concatenate([candidate_payload, crc_bits])
            cw = codec.reaccumulate_ira_codeword(info77)
            if np.all(codec.compute_syndrome(cw) == 0):
                corr = float(np.sum((1.0 - 2.0 * cw.astype(np.float32)) * input_llr))
                diff_count = int(np.sum(cw != best_codeword))
                if corr > 20.0 and corr > max_correlation and diff_count <= 16:
                    max_correlation = corr
                    best_osd_cw = cw

        eval_candidate(base_payload)
        for i in range(len(test_indices)):
            c1 = np.copy(base_payload)
            c1[test_indices[i]] ^= 1
            eval_candidate(c1)

        for i in range(len(test_indices)):
            for j in range(i + 1, len(test_indices)):
                c2 = np.copy(base_payload)
                c2[test_indices[i]] ^= 1
                c2[test_indices[j]] ^= 1
                eval_candidate(c2)

        if best_osd_cw is not None:
            info_bits = best_osd_cw[:codec.k]
            rcvd_crc = int("".join(str(b) for b in info_bits[63:]), 2)
            if codec.compute_crc14(info_bits[:63]) == rcvd_crc:
                return True, info_bits, total_iterations

    return False, best_codeword[:codec.k], total_iterations
