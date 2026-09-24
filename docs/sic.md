# Successive interference cancellation

`crates/z30-dsp/src/sic.rs`. After every decode pass, each new decode is regenerated and
subtracted from the slot's residual. The next pass then searches what is left.

## Why it was rebuilt

The shipped SIC subtracted `amp · replica`, where the replica was the obsolete
per-symbol-ramped waveform the transmitter had stopped sending, and the carrier phase was
assumed to be zero. Measured, it *added* 2.6 dB of the station's power on average, and later
passes re-decoded the same station (audit C3).

## How it works

1. **Replica.** The decoded information bits are re-encoded to the 75 channel symbols and
   passed through **the** modulator (`z30_protocol::gfsk::Modulator::analytic`) at the decoded
   frequency and drift. This is the analytic (complex) form of the exact waveform a z-30
   transmitter sends, and `gfsk::tests::the_analytic_replica_is_the_transmitted_waveform`
   pins it to the transmitted samples within 1e-6.
2. **Gain by least squares.** The received signal is modelled as x = Re(g(t) c(t)) + n, with a
   slowly varying complex gain g covering amplitude, carrier phase, residual frequency error and
   fading. Since `x c* = g |c|²/2 + (a term at twice the carrier)`, a low-pass of `x c*` divided
   by a low-pass of `|c|²/2` is the least-squares estimate of g. This is WSJT-X's
   `subtractft8` construction. The low-pass is a triangular window of 0.4 s
   (`SicParams::window_sec`), made from two boxcars. g(t) is estimated on 20-sample (3.3 ms)
   blocks and interpolated linearly between block centres, because it varies far more slowly
   than the tracking window and computing it per sample costs memory traffic for nothing.
3. **Timing.** Starting from the fine-sync estimate, the start sample is refined by descent on
   the residual energy: steps of 2 samples while that improves, then ±1, bounded by ±16
   samples (`timing_search`). One sample at 6 kHz is 0.17 ms. This is typically about five
   fits.
4. **Subtract** Re(g c), then fit the same component again to the residual to measure what is
   left. The difference is `Subtraction::suppression_db`, reported per subtraction in
   `PassStats::suppression_db`.

Within a pass, the timing searches (the expensive half, `sic::plan`) run in parallel against
the same residual. The fits and subtractions (`sic::apply`) then run in decode order, each on
what the previous one left, so overlapping stations are removed sequentially.

## Measured (gate G2.5)

`channel_scenarios::sic_suppresses_a_decoded_station_by_more_than_20_db_and_reveals_the_one_underneath`
runs six trials on `z30-channel` bands, each with a +10 dB station:

- **Suppression against the true clean waveform** is measured on the actual signal removed,
  not the fitted estimate, so an estimate that fooled itself would not pass: 31.4, 38.9, 39.2,
  38.3, 26.4 and 39.1 dB. The test asserts ≥ 20 dB in every trial.
- **A weak station 20 Hz away and 22 dB down**, overlapping in time and frequency, is decoded
  in pass 2 or later in at least 5 of the 6 trials (asserted), and never in pass 1, which is
  what shows SIC revealed it.
- **No duplicates.** The strong station is never decoded twice. The busy-band test asserts the
  same at K = 5 and K = 20.

## Cost

Per subtraction on the 4-vCPU reference host, single-threaded: replica ~9.5 ms, plan
(replica + timing descent) ~14 ms, apply ~2 ms (`cargo run --release -p z30-dsp --example
sictime`). At K = 50, the 46 subtractions of pass 1 take ~0.86 s single-threaded. See
[benchmarking.md](benchmarking.md#performance-gate-g27) for the whole-slot figures.

The replica's floor is the per-sample `sin_cos`: on this host an f64 `sin_cos` costs about
6 ms per 144 000-sample frame on its own. A phasor recurrence was tried and measured no faster,
while breaking the constant-envelope test, so it was not kept.

## What SIC does not claim

The legacy wiki's collision decode-rate table (98.7 / 95.2 / 91.4 / 84.6 %) and its
"−31.5 dB" recovery figure were withdrawn on 2026-09-01 because no instrument had produced
them. vNext measures suppression and the recovery of a buried station in the scenarios above.
It has **no** seeded collision sweep with confidence intervals yet, so collision performance
as a function of the power differential remains **not measured**.
