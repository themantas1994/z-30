"""
Worker-count invariance for the Monte Carlo sweep.

`z30_dsp.benchmark` can spread frame decoding across processes (`--workers`). The whole
justification for that is that it changes wall-clock time and nothing else, so the claim needs a
test rather than a comment: a sweep run on N processes must produce the same curve as the same
sweep run on one, to the last bit, at the same seed.

AGENTS.md's determinism rule already says CI runs the same seeded sweep twice and asserts
identical results. Run-to-run invariance is the weaker half. These tests assert the stronger
one - invariance across worker counts, across batch boundaries, and across the order results
come back in - because a pool is exactly the thing that can satisfy the weaker half while
quietly failing the stronger one.

Nothing here compares with a tolerance and nothing here asserts against a stored constant. Each
test computes both sides from the same code on the same inputs and requires them to agree
exactly; the expected values are whatever the DSP actually produced.
"""

import contextlib
import io
from concurrent.futures import Executor

import numpy as np
import pytest

from z30_dsp import benchmark
from z30_dsp.benchmark import (
    DEFAULT_BENCHMARK_SEED,
    FrameOutcome,
    PreparedFrame,
    _decode_batch,
    _prepare_frame,
    decode_prepared_frame,
    resolve_worker_count,
    run_monte_carlo_snr_sweep,
)
from z30_dsp.channel import ChannelImpairments
from z30_dsp.ldpc import LDPC_MAX_ITERATIONS, Z30LdpcCodec
from z30_dsp.modem import Z30Config, Z30Modulator

#: Fields a sweep result carries that are not part of the curve: a stopwatch reading, and the
#: worker count itself. Everything else must match across worker counts.
NON_CURVE_FIELDS = {"elapsed_sec", "workers"}

SAMPLE_RATE_HZ = 6000


def _sweep(**kwargs):
    """Runs a sweep with its console output swallowed, and strips the non-curve fields."""
    with contextlib.redirect_stdout(io.StringIO()):
        rows = run_monte_carlo_snr_sweep(**kwargs)
    return [{k: v for k, v in row.items() if k not in NON_CURVE_FIELDS} for row in rows]


def _assert_curves_identical(serial, parallel, label):
    assert len(serial) == len(parallel), f"{label}: different number of SNR points"
    for row_a, row_b in zip(serial, parallel):
        assert row_a.keys() == row_b.keys(), f"{label}: different result fields"
        for key in sorted(row_a):
            assert row_a[key] == row_b[key], (
                f"{label}: {key} at {row_a['snr_db']:+.1f} dB changed with the worker count: "
                f"{row_a[key]!r} (serial) vs {row_b[key]!r} (parallel)"
            )


def _build_frames(count, snr_db, mode, fading, seed):
    """Prepares `count` frames the way the sweep does, and returns them with a fresh receiver."""
    cfg = Z30Config(sample_rate_hz=SAMPLE_RATE_HZ)
    codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)
    modulator = Z30Modulator(cfg)
    impairments = ChannelImpairments(max_freq_offset_hz=5.0, max_time_offset_sec=0.5, fading=fading)
    rng = np.random.default_rng(seed)
    frames = [
        _prepare_frame(i, snr_db, codec, cfg, modulator, rng, mode, impairments, 0.5)[0]
        for i in range(count)
    ]
    return frames, cfg, codec


class _ReverseOrderExecutor(Executor):
    """
    An executor that really decodes, but hands the results back last-finished-first.

    A `ProcessPoolExecutor` is free to complete tasks in any order; `concurrent.futures.map`
    happens to re-impose the input order, which means a sweep that (incorrectly) accumulated in
    arrival order would still look right in CI and only misbehave under some other executor.
    This one removes that accident so the "file by index" rule is tested rather than assumed.
    The outcomes it yields are computed by the real decoder - only their order is contrived.
    """

    def __init__(self, cfg, codec):
        self._cfg = cfg
        self._codec = codec

    def map(self, _fn, jobs, *args, **kwargs):
        results = [decode_prepared_frame(job, self._cfg, self._codec) for job in jobs]
        return iter(reversed(results))


def test_realistic_sweep_is_identical_across_worker_counts():
    """
    The headline invariant, on the mode that produces the published thresholds.

    Run below the documented -23.1 dB threshold on purpose: down here frames fail to converge
    early and run the whole four-schedule decode cascade, including the dithered schedule whose
    perturbation is derived from the LLRs. That schedule is the one that was genuinely
    non-deterministic once, and a sweep that never reaches it cannot notice.
    """
    case = dict(min_snr_db=-25.0, max_snr_db=-25.0, step_snr_db=1.0, frames_per_snr=3,
                sample_rate_hz=SAMPLE_RATE_HZ, seed=DEFAULT_BENCHMARK_SEED,
                mode="realistic", fading="none")

    serial = _sweep(workers=1, **case)
    parallel = _sweep(workers=2, **case)

    # Guard against a vacuous pass: if this point ever stopped exercising the later schedules,
    # the comparison above would still succeed while covering much less than it claims to.
    assert serial[0]["avg_iters"] > 100.0, (
        "the sweep point stopped reaching the later decode schedules; "
        "worker-count invariance is no longer being tested over the dithered path"
    )
    _assert_curves_identical(serial, parallel, "realistic sweep")


def test_ideal_sweep_is_identical_across_worker_counts():
    """
    The same invariant in `ideal` mode, whose frames take a different path through the receiver.

    Realistic frames go through blind acquisition; ideal frames are handed sigma, carrier and
    timing. Three workers over two frames also puts more workers in the pool than there is work
    for it, which is the case a pool is most likely to mis-handle.
    """
    case = dict(min_snr_db=-25.0, max_snr_db=-25.0, step_snr_db=1.0, frames_per_snr=2,
                sample_rate_hz=SAMPLE_RATE_HZ, seed=4242, mode="ideal", fading="none")

    serial = _sweep(workers=1, **case)
    parallel = _sweep(workers=3, **case)

    _assert_curves_identical(serial, parallel, "ideal sweep")


def test_frame_preparation_does_not_depend_on_batch_size():
    """
    Frames are generated sequentially and dispatched in batches sized by the worker count. The
    batching must move only *when* a frame is built, never which random numbers build it.

    Compares the actual generated audio, sample for sample, across three different batch sizes -
    one of which does not divide the frame count, so the final short batch is covered too.
    """
    frame_count = 5
    reference = None
    for batch_size in (1, 3, 5):
        cfg = Z30Config(sample_rate_hz=SAMPLE_RATE_HZ)
        codec = Z30LdpcCodec(max_iterations=LDPC_MAX_ITERATIONS)
        modulator = Z30Modulator(cfg)
        impairments = ChannelImpairments(fading="moderate")
        rng = np.random.default_rng(31337)

        produced = []
        first = 0
        while first < frame_count:
            count = min(batch_size, frame_count - first)
            for index in range(first, first + count):
                job, true_start, true_foff = _prepare_frame(
                    index, -22.0, codec, cfg, modulator, rng, "realistic", impairments, 0.5
                )
                produced.append((job, true_start, true_foff))
            first += count

        if reference is None:
            reference = produced
            # A frame made of silence, or a channel that never moved it, would compare equal
            # across batch sizes while testing nothing.
            assert float(np.std(produced[0][0].noisy_wave)) > 0.0
            assert len({t for _, t, _ in produced}) > 1, "the channel applied no timing spread"
            continue

        for (job_a, start_a, foff_a), (job_b, start_b, foff_b) in zip(reference, produced):
            assert job_a.index == job_b.index
            assert np.array_equal(job_a.noisy_wave, job_b.noisy_wave), (
                f"batch size {batch_size} changed the audio of frame {job_a.index}"
            )
            assert np.array_equal(job_a.payload_63, job_b.payload_63)
            assert (start_a, foff_a) == (start_b, foff_b)


def test_decoding_a_frame_is_pure():
    """
    The receive chain must be a pure function of the prepared frame, or a pool is unsound.

    Decodes the same frame twice from the same process and requires an identical outcome, and
    checks the input buffer is byte-for-byte unchanged afterwards - a worker that mutated its
    input would corrupt whatever the parent still held a reference to.
    """
    frames, cfg, codec = _build_frames(1, -22.0, "realistic", "none", 777)
    job = frames[0]
    before = job.noisy_wave.copy()

    first = decode_prepared_frame(job, cfg, codec)
    after_first = job.noisy_wave.copy()
    second = decode_prepared_frame(job, cfg, codec)

    assert first == second, "the same frame decoded differently on a second call"
    assert np.array_equal(before, after_first), "decoding mutated the frame it was given"
    assert np.array_equal(before, job.noisy_wave)
    # Not a vacuous comparison: the acquisition fields carry real, frame-dependent values.
    assert first.base_freq_hz != 0.0
    assert first.index == job.index


def test_decode_order_does_not_change_any_frame_outcome():
    """
    Two frames decoded in the opposite order must give the same per-frame answers.

    A pool decides its own ordering, so any state carried between decodes - a cached matrix, a
    generator, an accumulated estimate - would show up here as an order-dependent result.
    """
    frames, cfg, codec = _build_frames(2, -22.0, "realistic", "none", 555)

    forward = {oc.index: oc for oc in (decode_prepared_frame(j, cfg, codec) for j in frames)}
    reverse = {oc.index: oc for oc in (decode_prepared_frame(j, cfg, codec) for j in reversed(frames))}

    assert forward == reverse
    assert set(forward) == {0, 1}


def test_results_are_filed_by_frame_index_not_by_arrival_order():
    """
    `_decode_batch` must place each outcome in its own frame's slot however the executor
    returns them. Driven here by an executor that deliberately yields results in reverse.
    """
    frames, cfg, codec = _build_frames(2, -18.0, "ideal", "none", 8080)
    expected = [decode_prepared_frame(job, cfg, codec) for job in frames]

    slots = [None, None]
    _decode_batch(frames, slots, _ReverseOrderExecutor(cfg, codec), cfg, codec)

    assert slots == expected, "results were filed in arrival order rather than by frame index"
    assert all(slot.index == i for i, slot in enumerate(slots))


def test_serial_and_pooled_batches_agree_on_the_same_frames():
    """`_decode_batch` with a real process pool must match the same batch decoded in-process."""
    from concurrent.futures import ProcessPoolExecutor

    frames, cfg, codec = _build_frames(2, -18.0, "ideal", "none", 2024)

    in_process = [None, None]
    _decode_batch(frames, in_process, None, cfg, codec)

    pooled = [None, None]
    with ProcessPoolExecutor(
        max_workers=2,
        initializer=benchmark._init_decode_worker,
        initargs=(cfg.sample_rate_hz, codec.max_iterations),
    ) as pool:
        _decode_batch(frames, pooled, pool, cfg, codec)

    assert in_process == pooled
    assert all(outcome is not None for outcome in pooled)


@pytest.mark.parametrize("requested", [None, 0, -1, -99])
def test_non_positive_worker_counts_mean_one_per_cpu(requested):
    """`--workers 0` (and anything below it) is documented as one process per CPU."""
    import os

    assert resolve_worker_count(requested) == (os.cpu_count() or 1)


@pytest.mark.parametrize("requested", [1, 2, 7])
def test_explicit_worker_counts_are_taken_literally(requested):
    assert resolve_worker_count(requested) == requested


def test_prepared_frame_carries_no_receiver_state():
    """
    A `PreparedFrame` crosses a process boundary, so it must stay a plain data record: a codec
    or a modulator travelling with it would be reconstructed per frame and could diverge.
    """
    frames, _cfg, _codec = _build_frames(1, -22.0, "realistic", "none", 606)
    job = frames[0]

    assert isinstance(job, PreparedFrame)
    for name in job.__dataclass_fields__:
        value = getattr(job, name)
        assert isinstance(value, (int, float, bool, np.ndarray, type(None))), (
            f"PreparedFrame.{name} carries a {type(value).__name__}, which does not belong in a "
            "record that is pickled to a worker"
        )
    # Frozen, so a worker cannot edit a frame the parent still trusts.
    with pytest.raises(Exception):
        job.index = 99
    assert isinstance(FrameOutcome(0, True, 1, 0, 0.0).index, int)
