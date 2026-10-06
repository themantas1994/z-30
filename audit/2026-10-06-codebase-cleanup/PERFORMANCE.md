# Performance — 2026-10-06 cleanup (Phase F)

Method: measure, form a hypothesis, change one thing, prove the receiver bit-identical, measure
again. Host: 4 vCPU x86-64 VM, Linux 6.18, rustc 1.97.0, shared and noisy; hardware performance
counters are not available in the VM, so CPU cost is `perf stat -r N -e task-clock` (its ±
is the run-to-run spread) or the benchmark's own `cpu s/slot`. Nothing here is a radio or
sound-card measurement.

## 1. Where `decode_slot` spends its time (before)

`cargo run --release -p z30-dsp --example stages -- 20 1` (K = 20 stations, one thread), under
`perf record -g` at 2 kHz:

| Self time | Function | What it is |
| ---: | :--- | :--- |
| 20.4 % | `demod::replica_spectra` | the decoded frame's replica, for the DT fit and the SNR |
| 13.3 % | `sync::search` | fine dt/f/drift search (inherent: 1344 complex MACs per hypothesis) |
| 11.7 % | `log1pf` | `ln_1p(exp(x))` in the LDPC Jacobian correction (bit-exact to the golden corpus; not touched) |
| 7.6 % + 5.8 % | `sincos`, `sin` | from `Modulator::analytic` (SIC replica), `sync` weights, replica |
| 4.8 % | `Decoder::decode_bp` | LDPC |
| 4.3 % + 4.2 % | `sic::residual_energy`, `sic::gains` | SIC timing search and fit |
| 3.2 % | `Modulator::instantaneous_frequency` | GFSK convolution |

Per stage: pass 1 = spectra 39 ms + candidates 850 ms + SIC 261 ms; pass 2 = 177 ms.

## 2. The change: build the replica waveform once per decode

**Hypothesis.** `placed_replica` descends over the replica's 6 kHz offset (steps 4, 2, 1; at
least seven evaluations). Each evaluation called `replica_spectra`, which recomputed the frame's
instantaneous frequency (the GFSK convolution), its envelope and its 144 000-sample phase
accumulation. None of those depend on the offset; only the 4 800-point sampling and the 75
symbol FFTs do. Computing them once removes about six of every seven passes over 144 000
samples per decode, with the same operations in the same order, so the output cannot change.

**Change.** `demod::ReplicaWaveform` (offset-independent part), built once in `placed_replica`;
`replica_spectra` keeps its signature and wraps it. Commit `624fa9b`.

**Bit identity.** A temporary harness (not committed) dumped every field of every decode as raw
bits (info, message, DT, frequency, SNR, drift, sync, iterations, method, AP type, pass) and
every pass's candidates, LDPC attempts, duplicates and SIC suppression values, over 42 seeded
bands (K = 1, 2, 5, 12, 20, 35, 50; six seeds each; −24…+1 dB): 669 decodes, byte-identical
before and after. The whole `z30-dsp` test suite (golden LDPC/demod, SIC and thread-count
determinism, SNR accuracy, channel scenarios, AP) passes. The suite comparison in §4 checks it
again through the measurement instrument.

**Result.**

`perf stat -r 5/7 -e task-clock`, `stages 20 1` (two K = 20 decodes plus band synthesis):

| Build | task-clock |
| :--- | ---: |
| before (`e6cdfdd`…`2856fa6`) | 2819 ms ± 1.2 %; 2804 ms ± 2.2 % |
| after (`624fa9b`) | 2095 ms ± 1.3 % |

`z30 --benchmark perf --frames 20` (seeded bands, −20…0 dB, 200–2750 Hz; the same slots
before and after):

| K | threads | p50 ms before → after | p95 ms before → after | CPU s/slot before → after | alloc/slot before → after | found |
| ---: | ---: | :--- | :--- | :--- | :--- | :--- |
| 1 | 4 | 211 → 212 | 254 → 235 | 0.53 → 0.50 | 20 404 → 20 438 | 20/20 both |
| 1 | 1 | 512 → 509 | 635 → 600 | 0.50 → 0.47 | 2 960 → 2 882 | 20/20 both |
| 5 | 4 | 307 → 303 | 352 → 322 | 0.95 → 0.88 | 27 944 → 27 246 | 100/100 both |
| 5 | 1 | 969 → 879 | 1095 → 994 | 0.95 → 0.88 | 4 410 → 3 992 | 100/100 both |
| 20 | 4 | 571 → 351 | 669 → 384 | 1.66 → 1.02 | 30 764 → 28 968 | 400/400 both |
| 20 | 1 | 1351 → 957 | 1534 → 1022 | 1.34 → 0.95 | 7 132 → 5 504 | 400/400 both |
| 50 | 4 | 836 → 588 | 923 → 620 | 2.57 → 1.58 | 47 897 → 43 774 | 1000/1000 both |
| 50 | 1 | 2465 → 1485 | 2738 → 1579 | 2.43 → 1.45 | 14 479 → 10 356 | 1000/1000 both |

The saving grows with the number of decodes (it is per decode): none at K = 1, about 40 % of
CPU per slot at K = 20 and K = 50. Latency on a shared VM is indicative; CPU per slot and the
task-clock spread are the firmer numbers. The decode budget is 4.5 s per slot.

## 3. Tried and not kept

- **Skip `sync::step_factors` when the frequency grid has one point** (the four single-point
  searches per candidate in `with_frac` computed 1344 sincos they never used). Bit-identical,
  but measured 2075 ms ± 3.6 % against 2095 ms ± 1.3 % without it: inside the noise, so not
  demonstrated, so not kept.

## 4. Not changed, and why

- **`log1pf` in the LDPC check-node correction (12–16 % of the time after the change).** Any
  cheaper evaluation (table, approximation) changes the decoder's arithmetic, so it breaks the
  golden LDPC bit-exactness and moves every published figure: that is a receiver change for the
  research process (`docs/research-process.md`), not a cleanup.
- **`Modulator::analytic` in SIC (one 144 000-sample sincos pass per subtraction) and
  `instantaneous_frequency`.** One replica per subtraction is inherent, and `gfsk.rs` is inside
  the benchmark instrument's hashed files: editing it changes the instrument identity.
- **Allocations.** `alloc/slot` is dominated by per-candidate FFT scratch and rayon; with 4
  threads it is ~20 000 per slot even at K = 1. No measured latency or CPU problem traces to it,
  and the audio callback (the real-time path) is already allocation-free and tested
  (`z30-io/tests/callback_alloc.rs`), so it was left alone.
- **Audio callback, scheduler, GUI.** Not on the measured critical path; the callback is
  allocation-free by test; the GUI renders snapshots and runs no DSP. Not changed.

## 5. Through the measurement instrument

Both binaries ran the whole suite at exploratory size (`z30 --benchmark suite --frames 20 --out
…`, suite seed 20260830): `acfce5e` (before the cleanup) and `624fa9b` (after this change), each
built from a clean tree. `python research/compare_results.py <acfce5e> <624fa9b>`:

```
awgn: IDENTICAL   snr: IDENTICAL   drift: IDENTICAL   timing: IDENTICAL   clock: IDENTICAL
impair: IDENTICAL busy: IDENTICAL  false: IDENTICAL   sic: IDENTICAL      fading: IDENTICAL
exit 0
```

The tool refuses results whose instrument identity, seed, frames, status or build profile
differ, so this also shows the instrument identity is unchanged
(`424e6f0385e112e48a2adbcda5456e62fbad5995be73d3624982f5b8e0e0be90` on both). Suite CPU time:
27 min 6 s → 25 min 48 s user (−5 %; the suite is mostly one-station frames, where the saving is
small). Wall time is not compared: the second run shared the machine with other work.
