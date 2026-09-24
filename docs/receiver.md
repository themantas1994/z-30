# The receiver: `decode_slot`

```rust
let rx = z30_dsp::slot::Receiver::new();          // plans FFTs, builds tables; reuse it
let report = rx.decode_slot(&samples, &RxConfig::default());
```

`samples` is the slot window **[slot − 1.5 s, slot + 25.5 s] at 6 kHz**: 162 000 samples, with
the UTC slot boundary at index 9 000 (`SLOT_ZERO_INDEX`). A frame that starts anywhere from
1.5 s early to 1.5 s late lies entirely inside it. The engine builds this window from the audio
stream by sample index (see [audio.md](audio.md)). `z30 --capture-slots` writes it to disk, and
`z30 --decode` reads it back.

## The chain

```
slot window, 6 kHz
 └─ one real FFT of the whole window (per pass)                 baseband.rs
 └─ symbol-rate spectrogram, Costas sync map, local maxima, NMS  sync.rs      synchronization.md
 └─ per candidate (parallel):
      5400-bin slice -> IFFT -> complex baseband at 200 Hz       baseband.rs  demodulation.md
      fine dt / f / drift search on the 21 Costas symbols        sync.rs      synchronization.md
      fine-sync gate
      75 symbol spectra, noise estimate, Log-MAP LLRs            demod.rs     demodulation.md
      LDPC cascade -> corrected OSD -> CRC; AP if configured     ldpc.rs, ap.rs   ldpc.md
 └─ de-duplicate, then least-squares SIC of every new decode    sic.rs       sic.md
 └─ next pass over the residual, near what was subtracted
```

There is no carrier PLL, no Gardner timing loop and no RRC filter. z-30 is non-coherent FSK
with 320 ms symbols. Frame timing comes once per frame from the Costas array, and the
per-symbol tone decision needs no carrier phase. The audit (section C.4) and the plan both
record why none of those blocks belongs here.

## Configuration (`RxConfig`)

| Field | Default | Meaning |
| :--- | :--- | :--- |
| `band_lo_hz`, `band_hi_hz` | 200, 2800 | Audio band searched for tone 0 |
| `max_candidates` | 50 | Candidates per pass, strongest first |
| `sync_threshold` | 1.5 | Coarse normalised Costas metric to become a candidate (~1 on noise) |
| `passes` | 3 | Decode passes; 1 disables SIC |
| `max_drift_hz` | 4 | Largest linear drift across the frame the fine search tries |
| `drift_gain` | 1.05 | A drifted hypothesis is decoded too only if its sync metric beats zero-drift by this factor |
| `min_fine_sync` | 2.5 | Fine-sync gate: best metric over the bin noise; candidates below it never reach the decoder |
| `whiten` | true | Per-tone interference whitening in the demodulator |
| `ap` | `None` | A priori context (own call, partner, QSO state). Off unless supplied |
| `sic` | window 0.4 s, timing ±16 samples | SIC tuning |

All defaults are the values the paired measurements in [benchmarking.md](benchmarking.md) were
taken with. Changing one changes the receiver. Only a paired comparison
(`research/paired_receiver.py --arm-b`) can say whether it helped.

## Passes

Pass 1 searches the whole band. After it, every new decode is subtracted from the residual.
Timing searches for all of them run in parallel against the same residual, then the fits and
subtractions are applied in decode order, each on what the previous one left.

Passes 2 and 3 search again, with two restrictions that change the cost without changing the
result:

- only candidates within 60 Hz of something subtracted in the previous pass are tried.
  Everywhere else the residual is unchanged, and a deterministic decoder would fail there
  exactly as it did before;
- a candidate sitting on a decoded station's own residue (±1.6 Hz, ±0.1 s) is skipped. It
  could only decode as the station already decoded.

A decode whose 77 information bits equal an earlier decode's is counted as a duplicate and
dropped. `PassStats::duplicates` reports how many were dropped, and the channel-scenario tests
assert zero duplicates on busy bands.

## The report (`SlotReport`)

- `decodes`: one `Decode` per station, carrying the message (`DecodedMessage`, where every
  field is either a canonical value or marked unrepresentable), the information bits, SNR
  (2500 Hz reference), DT, frequency, drift, sync metric, LDPC iterations, the method (BP
  schedule or OSD), `ap_type` (`a1`…`a6` when AP closed the frame) and the pass that found it;
- `passes`: per pass, the candidates tried, the LDPC attempts, new decodes, duplicates, the
  SIC suppression of each subtraction, and timings for the spectra, the candidates and SIC;
- `elapsed_ms`.

## Determinism

`decode_slot` is a pure function of its input and configuration. Candidates run in parallel
through rayon, but results are collected in candidate order and every candidate's work is
independent, so the report is identical at any thread count.
`channel_scenarios::decode_slot_is_deterministic` asserts it. The LDPC dither is derived from
the LLRs themselves, the pattern `AGENTS.md` section 4 prescribes.

## Scenario tests (`crates/z30-dsp/tests/channel_scenarios.rs`)

All of them go through `decode_slot` on `z30-channel` bands:

| Test | Asserts |
| :--- | :--- |
| `clean_plus_10_db_decodes_everything_everywhere` | across band, DT and phase |
| `moderate_minus_18_db_across_band_timing_and_phase` | decodes at -18 dB |
| `weak_minus_22_db_decodes_most_frames` | most frames at -22 dB |
| `frequency_drift_up_to_4_hz_is_tracked_h9` | 0–4 Hz linear drift recovered (audit H9) |
| `sound_card_clock_error_of_1000_ppm_costs_nothing_at_minus_18_db` | ±1000 ppm |
| `a_strong_cw_carrier_inside_the_signal_does_not_stop_the_decode` | whitening |
| `a_busy_band_decodes_every_station_once_with_no_false_decodes` | K = 5 and 20 |
| `sic_suppresses_a_decoded_station_by_more_than_20_db_and_reveals_the_one_underneath` | gate G2.5 |
| `fading_is_reported_not_gated` | Watterson moderate, reported only |
| `noise_only_slots_produce_no_decodes` | no false decodes |
| `decode_slot_is_deterministic` | byte-identical reports |
