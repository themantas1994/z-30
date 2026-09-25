# 05. Successive Interference Cancellation (SIC)

When two stations transmit in the same slot on overlapping frequencies, the stronger one can
hide the weaker. z-30's receiver decodes what it can, **subtracts** each decoded station from
the audio, and searches the remainder again — up to three passes in total. FT8's decoder in
WSJT-X does the same thing (`subtractft8`, three passes); this is not something z-30 has and FT8
lacks. The developer description of the code is [`docs/sic.md`](../docs/sic.md).

## What happens in a slot

```
 slot audio ──► pass 1: search 200–2800 Hz, ±1.5 s ──► decodes
                   │
                   ▼  for each decode: rebuild its exact waveform, fit its gain, subtract
 residual  ──► pass 2: search again ──► decodes (shown as "pass 2")
                   │
                   ▼  subtract those
 residual  ──► pass 3 ──► decodes (shown as "pass 3")
```

1. **Replica.** The decoded 77 bits are re-encoded to the 75 channel symbols and passed through
   the same modulator the transmitter uses, at the decoded frequency and drift. Because the
   CRC has already passed, the symbols are known exactly.
2. **Gain.** Amplitude, carrier phase, residual frequency error and slow fading are all folded
   into one slowly varying complex gain, estimated by least squares over a 0.4 s window — the
   same construction as WSJT-X's `subtractft8`.
3. **Timing.** The start sample is refined by a short descent on the residual energy (±16
   samples at 6 kHz, i.e. ±2.7 ms).
4. **Subtract**, then search the residual. Stations decoded in a later pass are labelled
   `pass 2` / `pass 3` in the decode list.

A decode that repeats a payload already found in the slot is dropped, so a station is never
reported twice.

## What has been measured

All of this is **software simulation** (AWGN, two synthetic stations). No collision on a real
band has been recorded or measured.

The paired sweep `z30 --benchmark sic` decodes the *same* audio with SIC (3 passes) and without
(1 pass), for a weak station at −18 dB and a stronger one 3, 10 or 20 dB above it, at frequency
separations of 0–50 Hz and timing separations of 0 and 0.4 s, 100 trials per cell, and gives
the exact McNemar p-value per cell:

Weak station decoded, out of 100 trials per cell (with SIC / single pass; results from
`sic.json`):

| Separation | dP +3 dB: SIC / 1 pass | dP +10 dB: SIC / 1 pass | dP +20 dB: SIC / 1 pass |
| :--- | :---: | :---: | :---: |
| 0 Hz, 0.0 s | 0 / 0 | 0 / 0 | 0 / 0 |
| 0 Hz, 0.4 s | 100 / 0 | 100 / 0 | 100 / 0 |
| 5 Hz, 0.0 s | 100 / 0 | 100 / 0 | 100 / 0 |
| 5 Hz, 0.4 s | 100 / 4 | 100 / 0 | 100 / 0 |
| 20 Hz, 0.0 s | 100 / 50 | 100 / 0 | 100 / 0 |
| 20 Hz, 0.4 s | 100 / 66 | 100 / 0 | 100 / 0 |
| 50 Hz, 0.0 s | 100 / 100 | 100 / 100 | 100 / 100 |
| 50 Hz, 0.4 s | 100 / 100 | 100 / 100 | 100 / 30 |

- **With SIC, the weak station was decoded in every trial of every cell except exact
  co-location** (the same frequency and the same DT). There it was never decoded, with or
  without SIC. Where the two arms differ, the exact McNemar p-value is 1.2 × 10⁻¹⁰ or smaller,
  and in no trial did the single pass find a station that SIC missed.
- **Without SIC**, a station 5–20 Hz from a stronger one is mostly lost, and a +20 dB
  neighbour 50 Hz away (adjacent, not overlapping) still hid it in 70 of 100 trials.
- The strong station was decoded in all 2400 trials. There were **0 false decodes and 0
  duplicate reports** (false decodes counted over both arms: 4800 decoder runs on 2400 slots).
- **Exact co-location** is a limit. The two stations' Costas sync symbols then coincide in
  tone and time, so fitting and subtracting the stronger station also removes the weaker one's
  sync, and it can no longer be acquired. That mechanism is read from the code, not separately
  measured. The boundary between exact co-location and 5 Hz or 0.4 s apart has not been mapped.

Full per-cell results, including the strong station's decode rate, false decodes and duplicates:
[`docs/benchmarking.md`](../docs/benchmarking.md#collisions-sic-on-versus-off) and
[`research/results/672cef9b3cdb/sic.json`](../research/results/672cef9b3cdb/sic.json) (identical to the first run at `d8983ee`).

Unit-level checks (`crates/z30-dsp/tests/`): measured against the true transmitted waveform, a
+10 dB station is suppressed by 26–39 dB; a subtraction never adds energy; subtracting a frame
that is not there removes only its noise projection (< 0.5% of the slot) and decodes nothing;
and SIC never loses a decode that a single pass found.

## What is not claimed

- **The internal "suppression" figure is not physical suppression.** The receiver reports, per
  subtraction, the ratio of its own fit before and after. The 2026-09-24 audit measured that
  ratio overstating the true suppression by about 9–12 dB; it is a diagnostic and is not quoted
  anywhere as how much of a station was removed.
- **Withdrawn figures stay withdrawn.** An earlier version of this page carried collision
  decode rates (98.7 / 95.2 / 91.4 / 84.6 %), a "Pass 3 reaches −27.5 dB" claim and a
  "−31.5 dB" recovery figure. No instrument produced any of them; they were withdrawn on
  2026-09-01 and are not replaced by anything but the measured table above.
- Collisions of more than two stations are measured only as the busy-band benchmark (K = 5–40
  stations at random positions, [16](16-Benchmarking-Testing-&-CI.md)), not as a function of
  power difference.
