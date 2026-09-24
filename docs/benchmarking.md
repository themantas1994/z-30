# Benchmarking and measured results

Every figure here names the result file it came from. The standard is `AGENTS.md` section 5:
a figure carries its conditions and interval, a comparison between two receivers or settings is
paired and quotes the exact McNemar p-value, and nothing unmeasured is reported as if it were.

> **All of this is software simulation.** No radio, sound card or RF path was involved in any
> figure on this page. Real-radio validation: not yet performed
> ([hardware-validation.md](hardware-validation.md)).

## The instrument is the receiver

`z30 --benchmark <name>` (`crates/z30-cli/src/suite.rs`) is compiled into the shipped `z30`
binary. For every frame it:

1. draws a station — payload, tone-0 frequency, DT, carrier phase — from a generator seeded
   with `SUITE_SEED (20260830) ^ (benchmark << 40) ^ (point << 20) ^ frame` (ChaCha8);
2. synthesises the 27 s receive window with `z30_channel::synthesize` (the transmitter's own
   modulator, real white Gaussian noise with σ = 1 at 6 kHz, and the benchmark's impairment);
3. calls **`Receiver::decode_slot(&audio, &RxConfig::default())`** — the station's receive
   entry point, with the station's configuration — and gets back a `SlotReport`;
4. only then compares the report with the transmitted payloads.

The receiver never sees the ground truth, and nothing in `crates/z30-dsp` knows it is being
benchmarked. There is no second receive path to measure (see
[architecture.md](architecture.md#one-receiver)). Frames are decoded in parallel on rayon; the
counts do not depend on thread count or order, because each frame's generator depends only on
its index.

**Definitions** (recorded in every JSON file):

| | |
| :--- | :--- |
| SNR | SPEC §10: frame signal power over noise power in 2500 Hz; with σ = 1 per sample at 6 kHz, SNR = P / (5000 / 6000) |
| Success | a decode whose 63 payload bits equal the transmitted payload |
| False decode | a CRC-valid decode whose payload was not transmitted in that slot |
| Duplicates | "dropped": the receiver itself discarded a repeat of an already-decoded payload (`PassStats::duplicates`); "emitted": the same payload in the output twice (must be 0) |
| Interval | Wilson score 95%; a zero count is bounded by the exact one-sided Clopper–Pearson 95% limit |
| Paired test | exact two-sided McNemar over the discordant frames |
| Crossing | linear interpolation between adjacent points, of the rate and of its Wilson bounds |
| Latency | wall-clock `decode_slot` time while other slots decode concurrently: indicative only. Controlled latency is `z30 --benchmark perf` |

**Blind placement**, unless a benchmark says otherwise: tone 0 uniform over 210–2740 Hz, DT
uniform over ±1.4 s, carrier phase uniform, payload uniform over 63 bits, no drift.

**Provenance.** Each JSON records the commit, build profile, `rustc`, target, OS, CPU and
logical CPUs, rayon threads, start time, elapsed time, the full `RxConfig`, the channel, the
placement, the seed rule and the definitions. A binary built from a dirty tree warns that its
results are not publishable, and fewer than 100 frames per point is marked exploratory.
`research/summarize_suite.py <dir> --write` renders the directory as `SUMMARY.md`; the tables
below are pasted from it.

## Current results: `research/results/d8983eeef66e/`

Release build of commit `d8983ee`, rustc 1.98.1, x86_64-unknown-linux-gnu, 4 logical CPUs
(Intel Xeon @ 2.10 GHz), 2026-09-24. The receiver (`z30-dsp`, `z30-protocol`, `z30-channel`) is
unchanged between that commit and the end of the remediation; only the CLI's loopback command
and a configuration test were added afterwards. Full tables:
[`SUMMARY.md`](../research/results/d8983eeef66e/SUMMARY.md).

### AWGN decode threshold

`awgn.json`, 200 frames per point, blind placement.

| SNR (2500 Hz) | Decoded (Wilson 95%) | False | Dups dropped / emitted |
| :--- | :--- | ---: | :---: |
| −26.0 dB | 0/200 = 0.0% [0.0, 1.9] | 0 | 0 / 0 |
| −25.0 dB | 0/200 = 0.0% [0.0, 1.9] | 0 | 0 / 0 |
| −24.0 dB | 12/200 = 6.0% [3.5, 10.2] | 0 | 0 / 0 |
| −23.5 dB | 33/200 = 16.5% [12.0, 22.3] | 0 | 0 / 0 |
| −23.0 dB | 105/200 = 52.5% [45.6, 59.3] | 0 | 0 / 0 |
| −22.5 dB | 144/200 = 72.0% [65.4, 77.8] | 0 | 0 / 0 |
| −22.0 dB | 185/200 = 92.5% [88.0, 95.4] | 0 | 2 / 0 |
| −21.0 dB | 200/200 = 100.0% [98.1, 100.0] | 0 | 0 / 0 |
| −20.0 dB | 200/200 = 100.0% [98.1, 100.0] | 0 | 0 / 0 |

**50% at −23.03 dB [−23.13, −22.89]; 90% at −22.06 dB [−22.15, −21.80].** The 2026-09-24
audit's independent seeds put the 50% point at ≈ −23.0 dB (E013); the earlier paired harness
(below) measured −23.01 dB. All three agree.

### Reported SNR, DT and frequency

`snr.json`, 100 frames per point, blind placement.

| True SNR | Decoded | SNR bias / sd (dB) | SNR error min / max (dB) | DT bias / sd (ms) | f bias / sd (Hz) |
| ---: | :--- | :---: | :---: | :---: | :---: |
| −25 dB | 0/100 | n/a | n/a | n/a | n/a |
| −22 dB | 89/100 | −0.08 / 0.38 | −0.94 / +0.78 | +0.38 / 5.55 | −0.016 / 0.173 |
| −20 dB | 100/100 | −0.03 / 0.33 | −0.70 / +0.93 | +0.45 / 3.05 | −0.023 / 0.124 |
| −15 dB | 100/100 | +0.01 / 0.21 | −0.48 / +0.67 | +0.15 / 1.28 | −0.022 / 0.074 |
| −10 dB | 100/100 | +0.00 / 0.16 | −0.31 / +0.49 | −0.02 / 0.62 | −0.015 / 0.040 |
| −6 dB | 100/100 | +0.01 / 0.15 | −0.46 / +0.36 | −0.17 / 0.43 | −0.009 / 0.027 |
| +0 dB | 100/100 | −0.04 / 0.12 | −0.36 / +0.22 | −0.04 / 0.22 | −0.005 / 0.018 |
| +5 dB | 100/100 | −0.06 / 0.12 | −0.40 / +0.25 | −0.11 / 0.13 | −0.006 / 0.014 |
| +10 dB | 100/100 | −0.06 / 0.13 | −0.33 / +0.20 | −0.08 / 0.08 | −0.007 / 0.013 |
| +20 dB | 100/100 | −0.08 / 0.13 | −0.44 / +0.31 | −0.09 / 0.06 | −0.007 / 0.014 |
| +30 dB | 100/100 | −0.25 / 0.24 | −1.17 / +0.17 | −0.09 / 0.05 | −0.008 / 0.012 |

The audit measured the previous estimator reading 4.6 dB low at +10 dB, 13.3 dB low at +20 dB
and saturating near +6.6 dB (M-07), with a +2.8 ms DT bias. The least-squares replica fit
([receiver.md](receiver.md)) removes both. The validated range is −22 to +30 dB; outside it the
GUI and CLI display `<-22` or `>+30`, and a report is never derived from an unmeasured value.
At −25 dB nothing decodes, so nothing is measured.

### Timing

`timing.json`, −20 dB, 200 frames per point, blind frequency and phase. **100% at every DT
from 0 to ±1.5 s; 3.5% at +1.6 s, 11.5% at −1.6 s; 0% at ±2.0 s.** The ±1.5 s search window is
a hard edge. Everything between the two stations' clocks and audio paths has to fit inside it
([synchronization.md](synchronization.md)).

### Frequency drift

`drift.json`, linear drift across the 24 s frame, 200 frames per point.

| Drift | 0 | ±1 | ±2 | ±3 | ±4 | ±5 | ±6 | ±8 Hz |
| :--- | --: | --: | --: | --: | --: | --: | --: | --: |
| −22 dB | 92.5% | 90.5 / 88.5% | 86.5 / 90.0% | 85.5 / 85.5% | 79.5 / 78.0% | 58.5 / 58.5% | 34.0 / 39.0% | 3.0 / 2.5% |
| −20 dB | 100% | 100 / 100% | 100 / 100% | 100 / 100% | 100 / 99.5% | 89.0 / 92.5% | 65.5 / 73.5% | 31.0 / 32.0% |

The receiver searches drift to ±4 Hz (`RxConfig::max_drift_hz`); beyond that it degrades
quickly. Near threshold (−22 dB), ±4 Hz costs about 14 points against no drift.

### Sound-card clock error

`clock.json`, −20 dB: ≥ 99.5% from −5000 to +5000 ppm; 72.5% at +10000 ppm and 81.5% at
−10000 ppm.

### Audio impairments

`impair.json`, −20 dB: 100% through a hard clip at 3× and 1× RMS, 8-bit quantisation (full
scale 4× RMS), and 0.5 s and 2 s dropouts mid-frame. **36.5% [30.1, 43.4] with 200 impulses at
50× RMS**: there is no impulse blanker.

### Busy band

`busy.json`, stations placed uniformly at random over the band and ±1.4 s, overlapping freely
(audit M-06: the earlier test used non-overlapping placement).

| Band | Decoded (Wilson 95%) | False | Dups emitted |
| :--- | :--- | ---: | ---: |
| K = 5, −20…0 dB | 249/250 = 99.6% [97.8, 99.9] | 0 | 0 |
| K = 10, −20…0 dB | 499/500 = 99.8% [98.9, 100.0] | 0 | 0 |
| K = 20, −20…0 dB | 997/1000 = 99.7% [99.1, 99.9] | 0 | 0 |
| K = 40, −20…0 dB | 1976/2000 = 98.8% [98.2, 99.2] | 0 | 0 |
| K = 20, −22…−16 dB | 976/1000 = 97.6% [96.5, 98.4] | 0 | 0 |

### False decodes

`false.json`, 400 slots of each kind of content, no z-30 frame present.

| Content | Slots | False | LDPC attempts |
| :--- | ---: | ---: | ---: |
| white noise only | 400 | 0 | 250 |
| 20 CW carriers, −10…+20 dB | 400 | 0 | 2394 |
| 8 random 16-FSK signals without the Costas pattern, 0 dB | 400 | 0 | 25 976 |
| 8 FT8-like 8-FSK signals, 0 dB | 400 | 0 | 27 536 |
| 500 impulses up to 40 σ | 400 | 0 | 331 |
| **Pooled** | 2000 | **0** | — |

Pooled 95% upper bound: 1.5 × 10⁻³ false decodes per slot. Real recorded non-z-30 audio
(speech, real FT8 or RTTY, real QRN) has not been tried: no recordings exist yet.

### Collisions: SIC on versus off

`sic.json`: two stations in AWGN. The strong one is at tone 0 f (uniform over 300–2600 Hz),
DT uniform over −1.0…+0.6 s. The weak one is at −18 dB, at f + df and DT + dDT, 3, 10 or 20 dB
below the strong one. Payloads and phases are random. The same audio is decoded with the
default 3 passes (SIC) and with 1 pass. 100 trials per cell.

| dP (dB) | df (Hz) | dDT (s) | Strong decoded | Weak with SIC | Weak without SIC | Discordant (SIC only : single only) | McNemar p | False |
| ---: | ---: | ---: | :---: | :--- | :--- | :---: | ---: | ---: |
| 3 | 0 | 0.0 | 100/100 | 0/100 | 0/100 | 0 : 0 | 1.0e+00 | 0 |
| 3 | 0 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 3 | 5 | 0.0 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 3 | 5 | 0.4 | 100/100 | 100/100 | 4/100 | 96 : 0 | 2.5e-29 | 0 |
| 3 | 20 | 0.0 | 100/100 | 100/100 | 50/100 | 50 : 0 | 1.8e-15 | 0 |
| 3 | 20 | 0.4 | 100/100 | 100/100 | 66/100 | 34 : 0 | 1.2e-10 | 0 |
| 3 | 50 | 0.0 | 100/100 | 100/100 | 100/100 | 0 : 0 | 1.0e+00 | 0 |
| 3 | 50 | 0.4 | 100/100 | 100/100 | 100/100 | 0 : 0 | 1.0e+00 | 0 |
| 10 | 0 | 0.0 | 100/100 | 0/100 | 0/100 | 0 : 0 | 1.0e+00 | 0 |
| 10 | 0 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 10 | 5 | 0.0 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 10 | 5 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 10 | 20 | 0.0 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 10 | 20 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 10 | 50 | 0.0 | 100/100 | 100/100 | 100/100 | 0 : 0 | 1.0e+00 | 0 |
| 10 | 50 | 0.4 | 100/100 | 100/100 | 100/100 | 0 : 0 | 1.0e+00 | 0 |
| 20 | 0 | 0.0 | 100/100 | 0/100 | 0/100 | 0 : 0 | 1.0e+00 | 0 |
| 20 | 0 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 20 | 5 | 0.0 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 20 | 5 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 20 | 20 | 0.0 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 20 | 20 | 0.4 | 100/100 | 100/100 | 0/100 | 100 : 0 | 1.6e-30 | 0 |
| 20 | 50 | 0.0 | 100/100 | 100/100 | 100/100 | 0 : 0 | 1.0e+00 | 0 |
| 20 | 50 | 0.4 | 100/100 | 100/100 | 30/100 | 70 : 0 | 1.7e-21 | 0 |

- With SIC the weak station is decoded in **100/100 in every cell except exact co-location**
  (df = 0 Hz, dDT = 0.0 s), where neither arm ever decodes it. Every cell where the arms
  differ has p ≤ 1.2 × 10⁻¹⁰. The single-pass-only discordant count is 0 in every cell: SIC
  never lost a decode.
- Strong station decoded in 2400/2400 trials. 0 false decodes and 0 duplicates emitted.
- **Why exact co-location fails** (read from the code, not separately measured): the two
  frames' Costas symbols coincide in tone and time. The least-squares gain fit for the strong
  station therefore absorbs the weak station's sync symbols, and subtracting it leaves no sync
  pattern for the weak station to be acquired from. The boundary between this case and 5 Hz or
  0.4 s separation has not been mapped.
- `PassStats::suppression_db` is not reported: it is a receiver-internal fit ratio, which the
  audit measured overstating the true suppression by 9–12 dB. Physical suppression measured
  against the true waveform is in [sic.md](sic.md).
- Not measured: three or more colliding stations as a function of power (see the busy band),
  fading channels, real recordings.

### Fading

`fading.json`: `z30_channel::Watterson`, two equal-power paths, complex Gaussian taps with a
Gaussian Doppler spectrum, normalised to unit power **over the ensemble** (so individual frames
fade as a Rayleigh channel does; audit H-10). The SNR is the average SNR. Blind placement,
200 frames per point.

| Preset, SNR | Decoded (Wilson 95%) | False |
| :--- | :--- | ---: |
| good −24 dB | 25/200 = 12.5% [8.6, 17.8] | 0 |
| good −22 dB | 68/200 = 34.0% [27.8, 40.8] | 0 |
| good −20 dB | 121/200 = 60.5% [53.6, 67.0] | 0 |
| good −18 dB | 160/200 = 80.0% [73.9, 85.0] | 0 |
| good −16 dB | 183/200 = 91.5% [86.8, 94.6] | 0 |
| good −14 dB | 190/200 = 95.0% [91.0, 97.3] | 0 |
| good −10 dB | 197/200 = 98.5% [95.7, 99.5] | 0 |
| moderate −24 dB | 12/200 = 6.0% [3.5, 10.2] | 0 |
| moderate −22 dB | 69/200 = 34.5% [28.3, 41.3] | 0 |
| moderate −20 dB | 159/200 = 79.5% [73.4, 84.5] | 0 |
| moderate −18 dB | 192/200 = 96.0% [92.3, 98.0] | 0 |
| moderate −16 dB | 198/200 = 99.0% [96.4, 99.7] | 0 |
| moderate −14 dB | 200/200 = 100.0% [98.1, 100.0] | 0 |
| moderate −10 dB | 200/200 = 100.0% [98.1, 100.0] | 0 |
| poor −24 dB | 1/200 = 0.5% [0.1, 2.8] | 0 |
| poor −22 dB | 54/200 = 27.0% [21.3, 33.5] | 0 |
| poor −20 dB | 153/200 = 76.5% [70.2, 81.8] | 0 |
| poor −18 dB | 198/200 = 99.0% [96.4, 99.7] | 0 |
| poor −16 dB | 200/200 = 100.0% [98.1, 100.0] | 0 |
| poor −14 dB | 200/200 = 100.0% [98.1, 100.0] | 0 |
| poor −10 dB | 200/200 = 100.0% [98.1, 100.0] | 0 |
| high-latitude moderate −20 dB | 0/200 = 0.0% [0.0, 1.9] | 0 |
| high-latitude moderate −10 dB | 0/200 = 0.0% [0.0, 1.9] | 0 |
| high-latitude moderate +0 dB | 0/200 = 0.0% [0.0, 1.9] | 0 |
| high-latitude moderate +10 dB | 0/200 = 0.0% [0.0, 1.9] | 0 |

| Preset | Delay / Doppler | 50% crossing |
| :--- | :--- | :--- |
| good | 0.5 ms / 0.1 Hz | −20.79 dB [−21.30, −20.28] |
| moderate | 1.0 ms / 0.5 Hz | −21.31 dB [−21.60, −21.04] |
| poor | 2.0 ms / 1.0 Hz | −21.07 dB [−21.32, −20.83] |
| high-latitude moderate | 3.0 ms / 10 Hz | none: 0 of 800 frames from −20 to +10 dB |

- Fading costs 1.7–2.2 dB at the 50% point against AWGN.
- **Slow fading has a tail.** On "good" (0.1 Hz) a whole frame can sit in a fade, so 95% needs
  −14 dB and 98.5% needs −10 dB. On "poor" (1 Hz) the fading averages within the frame and 99%
  is reached at −18 dB. The per-realisation normalisation that the audit found (H-10) hid
  exactly this tail. The audit's independent ensemble model gave 53% (good) and 76% (moderate)
  at −20 dB over 100 frames; these runs give 60.5% and 79.5% over 200, and the intervals
  overlap.
- **High-latitude moderate: no decode at any SNR.** 10 Hz of Doppler spread is wider than the
  3.125 Hz tone spacing.
- The old figure "mid-latitude −21.4 dB" came from the per-realisation model and the oracle
  receiver. It is withdrawn, and is not replaced by the moderate row above, which measures a
  different receiver on a different model.
- This is the project's own channel model. No independent channel simulator and no recording
  of a real path were used.

## Earlier instruments

These were measured before the suite existed. They remain valid for what they measured and
are kept with the commit they were measured at.

### Paired oracle vs vNext, AWGN (`awgn_paired_200`)

`research/paired_receiver.py`, AWGN, the oracle benchmark's `--mode realistic` frame producer
(carrier ±5 Hz, timing ±0.5 s), seed 20260830, 200 frames per point, −28…−17 dB. Each buffer
is decoded by both the frozen oracle receiver and `decode_slot`. Measured at `f180122` and
re-run at `83b1b70`, reproducing frame for frame.

| | 50% crossing | 90% crossing |
| :--- | :--- | :--- |
| vNext `decode_slot` | −23.01 dB [−23.18, −22.86] | −22.10 dB [−22.17, −22.01] |
| oracle | −22.92 dB [−23.07, −22.79] | −22.09 dB [−22.16, −22.01] |

Discordant frames: 34 vNext-only against 17 oracle-only; exact McNemar p = 0.024. vNext's
blind receiver is **not worse** than the oracle's windowed one. p = 0.024 does not reach the
99% bar, so it does not establish that vNext is better. The oracle is told the nominal carrier
and timing and searches ±12 Hz / ±0.55 s. vNext is told nothing.

### Whitening A/B (`whitening_ab_200`)

Per-tone interference whitening on vs off, same buffers, 200 frames per point, −25…−21 dB:
0 discordant of 1000, p = 1. Costs nothing on AWGN.

### False decodes with the fine-sync gate off (`false_decodes_2000`)

2000 noise-only slots with every candidate forced through LDPC: 0 false decodes in 133 911
attempts (95% upper bound 2.24 × 10⁻⁵ per attempt). With the production configuration: 0 in
2000 slots.

### OSD, fixed vs legacy

In a 4000-frame pool with 3004 BP failures, the legacy and fixed OSD each recovered the same 7
frames: 0 discordant (measured during the 2026-09-23 rebuild; the fixed rule is pinned by `golden_ldpc.rs::legacy_osd_path_is_bit_exact_and_the_fixed_rule_agrees_on_it`).

### Performance (gate G2.7)

`z30 --benchmark perf --frames 20` (`perf_k.txt`): 20 seeded slots per K, stations at −20…0 dB
spread over 200–2750 Hz (evenly spaced: this is a latency measurement, not a decode-rate one),
idle 4-vCPU Xeon @ 2.80 GHz.

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

K = 50 on 4 threads: p99 863 ms, under the < 1 s target. On one thread: p99 2525 ms, **over**
the ≤ 2 s target, but inside the real-time budget of 4.5 s (the window closes at slot + 25.5 s;
the next slot starts at + 30 s).

## History

The retired Python benchmark (`legacy/python-oracle/z30_dsp/benchmark.py`) and the browser's
Monte Carlo engine measured the oracle receiver, not the one that ships. Three findings from
that period shaped the current instrument:

- **The coherence weight.** Both old benchmarks passed a pilot coherence weight of 0.0 while
  both on-air decoders applied 0.35–0.85. The published threshold described a receiver nobody
  ran; measured paired, the difference was 1.77 dB on AWGN (p = 2.9 × 10⁻³⁶).
- **The browser engine's analytic receive path.** It drew per-tone Gaussians against an
  assumed signalling model instead of synthesising and demodulating a waveform, and read about
  2 dB optimistic.
- **Per-realisation fading normalisation** (audit H-10). It removed the frame-to-frame power
  variation of slow fading and made the good and moderate channels read optimistic. Both
  channel models now normalise over the ensemble, and the fading figures above are the first
  measured that way.

The old benchmark's figures (−22.92 dB realistic, −24.58 dB genie-aided, mid-latitude
−21.4 dB) describe the retired oracle receiver and old channel model. They are not quoted as
z-30's performance. Their full account is in the git history of `wiki/16` up to `224b2fc`.

## Not measured

Stated so that nobody fills the gap with a plausible number:

- **Any hardware.** Real sound cards (timing, clock error, levels), every PTT adapter against a
  real radio, the GUI's frame rate on a real display, and any on-air path. See
  [hardware-validation.md](hardware-validation.md).
- **Real recordings** of non-z-30 signals for false decodes.
- **Collisions of three or more stations** as a function of power difference; only the
  random busy band covers many-station overlap.
- **FT8 on the same channels.** Every FT8 figure in the documentation is published, not
  reproduced.
- **Gray against natural-binary symbol mapping** (audit L-05).
- **Single-thread K = 50 latency** misses its target (above).
- **Windows and macOS** are verified by CI build and test, not by operating a station.
- **Protocol v2.** Its measured half needs a candidate v2 code, which is a protocol decision
  reserved for the operator.
