# Benchmarking and measured results

Every figure here names the raw output in `research/results/` it came from, with the seed,
frame count, channel and interval. `research/results/README.md` gives the exact command and
host for each file. `AGENTS.md` section 5 is the standard: a decode **threshold** comes only
from the realistic condition, a paired comparison reports the exact McNemar p-value, and
nothing unmeasured is reported as if it were.

## The instrument is the receiver

Every vNext number comes through `decode_slot`, the function the station runs, with its
default `RxConfig`. The Python harness (`research/paired_receiver.py`) reaches it through the
`z30` bindings. `z30 --benchmark` calls it directly. There is no second receive path to
measure (see [architecture.md](architecture.md#one-receiver)).

## AWGN decode threshold (gate G2.2)

`research/paired_receiver.py`, AWGN, the oracle benchmark's own `--mode realistic` frame
producer (random carrier ±5 Hz and timing ±0.5 s), seed `20260830`, **200 frames/point**,
−28…−17 dB. Each buffer is decoded by both the frozen oracle receiver and vNext's
`decode_slot` (`awgn_paired_200.txt`). The oracle is told the nominal carrier and slot timing
and searches ±12 Hz / ±0.55 s. vNext is told nothing: it searches 200–2800 Hz and ±1.5 s with
its defaults.

| | 50% crossing | 90% crossing |
| :--- | :--- | :--- |
| vNext `decode_slot` | **−23.01 dB [−23.18, −22.86]** | −22.10 dB [−22.17, −22.01] |
| oracle (published figure) | −22.92 dB [−23.07, −22.79] | −22.09 dB [−22.16, −22.01] |

Pooled discordant frames: **34 vNext-only against 17 oracle-only; exact two-sided McNemar
p = 0.024.** No false decodes in either arm.

What this supports: vNext's whole-band, blind receiver is **not worse** than the oracle's
windowed one, and the oracle arm reproduces the published table frame for frame. What it does
**not** support is a claim that vNext is better. p = 0.024 clears 95% but not the 99% that
`AGENTS.md` section 5 requires before a result is treated as settled, and the crossings'
intervals overlap. The published threshold stays at the oracle's −22.92 dB until a larger
paired run settles the difference.

The figure applies to AWGN only. See "Not measured" below for fading, where the legacy
finding (no decode on F.1487 high-latitude moderate) still stands.

The file was first produced at `f180122`. It was re-run at `83b1b70`, after the fine-sync,
whitening and SIC changes, and every point from −28 to −20 dB reproduced frame for frame.

## Whitening A/B

Per-tone interference whitening on vs off, same buffers, 200 frames/point, −25…−21 dB:
**0 discordant of 1000**, McNemar p = 1 (`whitening_ab_200.txt`). It costs nothing on AWGN, and
the CW scenario test shows what it buys.

## False decodes (gate G2.4)

2000 noise-only slots, `z30 --benchmark false-decodes --frames 2000` (`false_decodes_2000.txt`):

- **fine-sync gate disabled**, so every one of the 100 000 candidates reaches the LDPC
  decoder: **0 false decodes in 133 911 LDPC attempts**. The exact one-sided 95% upper bound
  is 2.24 × 10⁻⁵ per attempt;
- **production configuration** on the same slots: 0 false decodes in 2000 slots (95% upper
  bound 1.5 × 10⁻³ per slot; 1130 LDPC attempts).

The fixed OSD's union bound is 6.5 × 10⁻³ per invocation before its correlation and distance
gates (see [ldpc.md](ldpc.md)). The measured rate is what the gates actually leave.

## OSD, fixed vs legacy (gate G2.3)

In a 4000-frame pool with 3004 BP failures, the legacy OSD recovered 7 frames and the fixed OSD
the same 7: **0 discordant**. Closing the tautology (audit M1) cost no decodes in this pool.

## SIC (gate G2.5)

At +10 dB, suppression measured against the true clean waveform was 31.4, 38.9, 39.2, 38.3,
26.4 and 39.1 dB (≥ 20 dB asserted). A station 22 dB down and 20 Hz away was revealed in pass 2
in ≥ 5 of 6 trials (asserted), with no duplicate decodes. See [sic.md](sic.md).

## Drift (gate G2.6)

`frequency_drift_up_to_4_hz_is_tracked_h9` asserts recovery with 0–4 Hz of linear drift across
the frame. The audit had measured the shipped receiver losing all but one of 37 decodes at 4 Hz.

## Performance (gate G2.7)

`z30 --benchmark perf --frames 20` (`perf_k.txt`): 20 seeded slots per K, stations at
−20…0 dB spread over 200–2750 Hz, on an idle 4-vCPU Xeon @ 2.80 GHz.

| K | threads | p50 ms | p95 ms | p99 ms | max ms | CPU s/slot | allocs/slot | found |
| --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 1 | 4 | 306 | 370 | 396 | 396 | 0.75 | 20 501 | 20/20 |
| 1 | 1 | 761 | 894 | 922 | 922 | 0.74 | 2 903 | 20/20 |
| 5 | 4 | 454 | 486 | 494 | 494 | 1.33 | 27 387 | 100/100 |
| 5 | 1 | 1321 | 1419 | 1441 | 1441 | 1.31 | 4 105 | 100/100 |
| 20 | 4 | 515 | 628 | 722 | 722 | 1.49 | 29 240 | 400/400 |
| 20 | 1 | 1410 | 1509 | 1537 | 1537 | 1.40 | 5 790 | 400/400 |
| 50 | 4 | 793 | 834 | 863 | 863 | 2.09 | 43 480 | 1000/1000 |
| 50 | 1 | 2079 | 2324 | 2525 | 2525 | 2.06 | 10 440 | 1000/1000 |

Against the audit's targets:

- **K = 50, 4 threads: p99 863 ms, under the < 1 s target (met).**
- **K = 50, one thread: p99 2525 ms, over the ≤ 2 s target (not met).**

The real-time budget is 4.5 s: the window closes at slot + 25.5 s, and the next slot starts at
+30 s. Single-threaded time at K = 50 is roughly 0.86 s in pass-1 SIC (46 subtractions), 0.8 s
in fine sync for the candidates of passes 2 and 3, and 0.3 s in pass 1's candidates.

Allocations are counted on the decode thread, which may allocate. The audio callback may not,
and `callback_alloc.rs` asserts zero there. The CI smoke run (2 slots per K on shared runners)
checks that the benchmark works, not the latency.

## Not measured, or not done

Stated so that nobody fills the gap with a plausible number:

- **Fading thresholds.** `fading_is_reported_not_gated` runs Watterson moderate at −15 dB (6/6),
  but there is no seeded 200-frame fading sweep through `decode_slot` yet. The legacy finding
  still stands until one exists: on ITU-R F.1487 high-latitude moderate (3 ms / 10 Hz), z-30
  does not decode at any SNR, because 10 Hz of Doppler spread exceeds the 3.125 Hz tone spacing.
- **Collision performance** as a function of power differential. No seeded collision sweep
  exists (see [sic.md](sic.md)).
- **Single-thread K = 50 latency** misses its target (above).
- **Hardware.** Audio timing on real sound cards, every PTT adapter against a real radio, and
  the GUI's frame rate on a real display. See [hardware.md](hardware.md#verification-status).
- **Windows and macOS** are verified by CI build and test, not by operating a station.
- **Protocol v2 trade study.** Its measured half needs a candidate v2 LDPC code, which is a
  protocol design decision reserved for the operator.
- **AP tag in the logbook.** Decodes carry `ap_type`, but log records do not yet say whether
  any exchange in the QSO was AP-assisted.
- **PTT methods from the legacy app not yet ported:** audio-tone (right channel), Raspberry Pi
  GPIO, TCI and WinKeyer.
- **CM108 in release artefacts.** The CI artefacts are built without `--features cm108`.
