# Benchmark results

Every benchmark the remediation brief asked to re-run (its section 24) was re-run through
the shipped `z30` binary, which calls `decode_slot` with its default configuration. The
results are machine-readable, in
[`research/results/d8983eeef66e/`](../../research/results/d8983eeef66e/SUMMARY.md). They are
beside the 2026-09-24 audit's own measurements where it made them.

**Software simulation only. No hardware was involved in any figure here.**

## Provenance

| | |
| :--- | :--- |
| Binary | `z30` (z30-cli) 0.9.0, **release** build of commit `d8983eeef66e` (clean tree), built 2026-09-24T02:52:21Z |
| Toolchain | rustc 1.98.1 (48a229cea 2026-09-01), target x86_64-unknown-linux-gnu |
| Host | Linux 6.18, Intel Xeon @ 2.10 GHz, 4 logical CPUs, 4 rayon threads |
| Receiver | `z30_dsp::slot::Receiver::decode_slot`, `RxConfig::default()`: band 200–2800 Hz, 50 candidates, sync threshold 1.5, 3 passes, drift ±4 Hz, min fine sync 2.5, whitening on, AP off, SIC window 0.4 s, timing search 16 |
| Channel | `z30_channel::synthesize`: the transmitter's modulator, real white Gaussian noise σ = 1 at 6 kHz |
| SNR | SPEC §10, 2500 Hz reference |
| Seeds | suite seed **20260830**; frame seed = seed ^ (benchmark << 40) ^ (point << 20) ^ frame, ChaCha8 |
| Success / false | the decoded 63 payload bits equal a transmitted payload / a CRC-valid decode of anything not transmitted |
| Intervals | Wilson 95%; zero counts by exact Clopper–Pearson 95%; pairs by exact McNemar |
| Run | 2026-09-24, 02:52–@@RUN_END@@ UTC; wall-clock per benchmark in each JSON |
| Receiver since | `z30-dsp`, `z30-protocol` and `z30-channel` are byte-identical between `d8983ee` and the remediation's final commit |

## Sample counts

| Benchmark | Points | Frames per point | Total frames or slots |
| :--- | ---: | ---: | ---: |
| awgn | 9 | 200 | 1800 |
| snr | 11 | 100 | 1100 |
| drift | 30 | 200 | 6000 |
| timing | 11 | 200 | 2200 |
| clock | 11 | 200 | 2200 |
| impair | 7 | 200 | 1400 |
| busy | 5 | 50 slots (K × 50 = 250–2000 stations) | 250 slots, 5750 stations |
| false | 5 | 400 slots | 2000 slots |
| sic | 24 cells | 100 paired trials | 2400 trials (4800 decodes) |
| fading | 25 | 200 | 5000 |

## Results, against the audit

| Benchmark | Audit (`224b2fc`, independent seeds) | Now (`d8983ee`, suite seed) |
| :--- | :--- | :--- |
| AWGN 50% | ≈ −23.0 dB (E013) | **−23.03 dB [−23.13, −22.89]** |
| AWGN 90% | ≈ −22.0 dB (91.0% at −22) | −22.06 dB [−22.15, −21.80] |
| SNR bias at +10 / +20 dB | −4.64 / −13.34 dB (saturated near +6.6 dB) | **−0.06 / −0.08 dB** |
| SNR bias at +30 dB | (+40: −33.4 dB) | −0.25 dB, sd 0.24 |
| DT bias | +2.8 ms | within ±0.5 ms at every SNR |
| Drift ±4 Hz | 100% at −20 dB | 100 / 99.5% at −20 dB; 79.5 / 78.0% at −22 dB |
| Drift ±8 Hz | 32% at −20 dB | 31.0 / 32.0% at −20 dB |
| Timing ±1.5 / +1.6 / −1.6 / ±2.0 s, −20 dB | 100% / 8% / 12% / 0% (E016, 100 frames) | 100% / 3.5% / 11.5% / 0% |
| Clock +5000 / +10000 ppm | 99% / 77% (E018, 100 frames) | 99.5% / 72.5% (−10000: 81.5%) |
| 200 impulses at 50× RMS | 24% [16.7, 33.2] (E019, 100 frames) | 36.5% [30.1, 43.4] (independent draws; the intervals overlap) |
| Busy band K = 40, random placement | 97.8% [96.5, 98.6] (E023, DT ±1.0 s) | 98.8% [98.2, 99.2] (DT ±1.4 s) |
| False decodes | 0 in 2100 slots of seven kinds (E024) | 0 in 2000 slots of five kinds |
| SIC, two stations | not measured by a sweep | 24 paired cells × 100: weak decoded 100/100 with SIC except exact co-location (0/100 both arms); single-pass-only decodes 0; 0 false, 0 duplicates |
| Fading, good −20 dB | 87% (per-frame normalised) → 53% (ensemble, audit's model) | @@FADING_GOOD@@ |
| Fading, moderate −20 dB | 92% → 76% | @@FADING_MOD@@ |
| Fading, high-latitude moderate | 1 of 800 | @@FADING_HIGH@@ |

The drift, timing, clock and impairment grids follow the brief's section 24. The per-point
tables with latency and duplicate counts are in `SUMMARY.md`.

## Reproducing

```bash
git checkout d8983ee
cargo build --release -p z30-cli
./target/release/z30 --benchmark suite --out /tmp/rerun
python3 research/summarize_suite.py /tmp/rerun
```

Every decoded count reproduces exactly on any machine: each frame depends only on its seed,
and the receiver is deterministic across thread counts
(`sic_regression.rs::a_busy_band_decodes_identically_on_one_thread_and_on_many`). Latency will
differ.

## Integrity checks

- The benchmark calls `decode_slot` with `RxConfig::default()`. `grep -rn "benchmark" crates/z30-dsp/src`
  finds only doc comments; the receiver has no benchmark mode and no access to the truth.
- No result was edited. The documentation's tables are pasted from `summarize_suite.py`.
- No seed, sample size, SNR grid or criterion was changed after a result was seen. The grids
  are the brief's. The AWGN grid was fixed before the run.
- CI (`rust.yml` benchmark-suite job) runs every benchmark at exploratory size through the
  release binary and checks that each JSON names the commit, the receiver, the seed and its
  definitions.
- The `false` benchmark's content includes structured interference, not only noise. Real
  recordings were not available.
