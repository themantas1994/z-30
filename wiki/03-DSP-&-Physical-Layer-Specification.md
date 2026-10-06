# 03. DSP & Physical Layer Specification

This page summarises the waveform and the receiver. The normative text is
[`SPEC.md`](../SPEC.md); the code is `crates/z30-protocol` (transmit) and `crates/z30-dsp`
(receive), described in [`docs/`](../docs/README.md). Where this page and the code disagree, the
code is right and the page is a bug.

## Physical layer parameters

| Parameter | Value | Notes |
| :--- | :--- | :--- |
| Modulation | 16-GFSK, continuous phase | Gaussian frequency pulse, BT = 2.0 |
| Tone spacing | 3.125 Hz | = 1 / symbol time |
| Symbol time | 320 ms | 1920 samples at the receiver's 6 kHz |
| Tone span | 46.9 Hz | tone 0 to tone 15 |
| Occupied bandwidth (audio waveform) | 99%: ≈ 50.5 Hz; −40 dB: 65.9–66.7 Hz | `z30 --loopback-test` at `8a98bbc` (software, no noise; four runs at 48 and 44.1 kHz; not recorded under `research/results/`): Welch PSD, Hann, 8192 points at 6 kHz (0.73 Hz bins), 50% overlap. Ideal waveform only; transmitter and ALC effects are not measured |
| Symbols per frame | 75 = 54 data + 21 sync | |
| Frame | 24.00 s | starts on a 30 s UTC boundary (even or odd slot) |
| Message | **63 bits** | two 28-bit call fields + 7-bit extra field |
| Information bits | 77 = 63 + 14-bit CRC | CRC-14, g(x) = x¹⁴+x¹³+x¹⁰+x⁶+x+1, init 0x2757 |
| FEC | IRA-LDPC (216, 77), rate 0.356 | dual-diagonal parity, degree-5 connection table ([04](04-Forward-Error-Correction-&-LDPC.md)) |
| Symbol mapping | natural binary, 4 bits/symbol, MSB first | not Gray-coded; the loss against Gray has not been measured |
| Receiver timing window | slot − 1.5 s … slot + 25.5 s | DT search ±1.5 s, hard edge |
| Sideband | USB assumed | radiated = dial + audio. A radio that reports a non-USB mode over CAT is refused; without CAT the mode is not checked |

Sensitivity figures, each with its conditions, are on [16](16-Benchmarking-Testing-&-CI.md) and
[11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md). None is a hardware or on-air measurement.

## Transmit

```text
message text -> v1 codec (refuses anything it cannot carry exactly) -> 63 bits
             -> CRC-14 -> 77 bits -> LDPC (216,77) -> 54 data symbols (natural binary)
             -> interleave 21 sync symbols -> 75 tones -> GFSK modulator (one phase accumulator,
                BT 2.0, constant envelope, 20 ms raised-cosine ramp at each end) -> audio
```

`z30_protocol::gfsk::Modulator` is the only waveform generator in the project. The transmitter,
the SIC replica ([05](05-Successive-Interference-Cancellation-(SIC).md)) and the benchmark's test
signals all use it. Its output is checked against golden waveforms frozen in `fixtures/golden/`
at 6, 12 and 48 kHz, within 1e-6 per stored sample: numerically equivalent to the reference that
produced them, not bit-identical (`crates/z30-protocol/tests/golden.rs`, run in CI).

Two properties matter for the signal on the air. The phase is **continuous**, because a phase
step at a symbol boundary would splatter across the passband. The envelope is **constant**: the
only amplitude shaping is one ramp at each end of the frame. A per-symbol amplitude ramp would be
amplitude keying at 3.125 baud.

## Frame layout

```text
SSS DDDD SSS DDDDDDD SSS DDDDDDD SSS DDDDDDD SSS DDDDDDD SSS DDDDDDDDDDDDDDDDDDDDDDD SSS
sync positions: 0-2, 7-9, 17-19, 27-29, 37-39, 47-49, 72-74
sync tones:     3 11 7 | 14 2 9 | 5 12 1 | 15 6 10 | 4 8 13 | 0 9 3 | 14 6 11
```

Seven clusters of three sync symbols. The pattern uses all 16 tones, and for any non-zero shift
in time and tone at most 3 of the 21 sync symbols coincide (an early audit, E011, checked this).
Strictly it is not a Costas array, because tones repeat; acquisition does not need that.

## Slot timing

| Span (relative to the slot boundary) | What |
| :--- | :--- |
| −1.5 s … +25.5 s | the receive window for that slot (27 s): the 24 s frame plus the ±1.5 s DT search |
| +25.5 s | the earliest moment the window is complete; the scheduler decodes then, never before |
| +25.5 s … +30 s | the decode budget: 4.5 s before the next slot starts |

A slot is decoded when the audio sample counter reaches the end of its window, not when a timer
fires ([`docs/synchronization.md`](../docs/synchronization.md)). A decoder triggered earlier would
run on a window that does not yet contain the end of the frame.

## Receive (`decode_slot`)

`decode_slot` is the only receive path. The GUI, the CLI, `--decode` and the benchmarks all call
it. For one slot of audio it does the following.

1. **Slot spectrum.** One real FFT of the 162 000-sample window (6 kHz).
2. **Coarse sync.** A Hann-windowed spectrogram (one symbol long, zero-padded 4× to 0.78 Hz
   bins, hopped every 40 ms) over 200–2800 Hz. For every DT in ±1.5 s and every tone-0 bin, the
   sync metric is the power at the 21 sync tones divided by the power in all 16 tone bins at
   those instants, normalised by the map's median. Local maxima above 1.5 are kept, with
   non-maximum suppression and at most 50 candidates per pass.
3. **Per-candidate baseband.** 5400 bins around the candidate, a raised-cosine taper beyond
   ±85 Hz, and one inverse FFT give complex baseband at 200 Hz, where tone k is bin k of a
   64-point FFT.
4. **Fine sync.** Timing (5 ms grid plus parabolic interpolation), frequency (to 0.02 Hz) and a
   linear drift hypothesis up to ±4 Hz across the frame, all from the sync symbols only.
5. **Demodulation.** A 64-point FFT per symbol after de-rotating frequency and drift. Noise is
   taken from the median of off-signal bins and raised per tone where something stationary sits
   (whitening against carriers). The metric is the exact non-coherent Rician
   `ln I0(a|r|/σ²) − a²/(2σ²)` with the pilot-mean amplitude, and exact Log-MAP demapping
   produces 216 LLRs. The demodulator is **non-coherent**: it tracks no carrier phase or phase
   trajectory, which 16-FSK with 320 ms symbols does not need.
6. **LDPC.** Four belief-propagation schedules (at most 150 iterations in total), then an OSD
   whose candidates must carry a matching received CRC field, and optionally AP
   ([17](17-A-Priori-(AP)-Decoding.md)). The CRC decides ([04](04-Forward-Error-Correction-&-LDPC.md)).
7. **Measurements.** DT is the least-squares placement of the decoded frame's replica, to one
   6 kHz sample. SNR is measured against the residual after that replica is removed. Both are
   checked against the truth from −22 to +30 dB ([16](16-Benchmarking-Testing-&-CI.md)).
8. **SIC.** Each decode is regenerated with the modulator, fitted with a slowly varying complex
   gain by least squares, timing-refined and subtracted. Passes 2 and 3 search what is left
   ([05](05-Successive-Interference-Cancellation-(SIC).md)).

`decode_slot` is a pure function of its input and configuration, and gives identical results at
any thread count.

## Measured tolerances (simulation)

Measured through `decode_slot` by `z30 --benchmark suite` at `672cef9`: single stations, AWGN,
200 frames per point, suite seed 20260830, Wilson 95% intervals, software simulation with no
hardware (`research/results/672cef9b3cdb/`). Full tables are on
[16](16-Benchmarking-Testing-&-CI.md).

- **Timing:** 200/200 at every DT up to ±1.5 s at −20 dB; 3.5% / 11.5% at +1.6 / −1.6 s
  (`timing.json`). Beyond ±1.5 s the frame leaves the window.
- **Frequency:** the benchmarks place tone 0 uniformly over 210–2740 Hz. The search covers tone 0
  from 200 Hz up to where tone 15 reaches 2800 Hz.
- **Drift:** at −22 dB, 92.5% with no drift and 78.0–79.5% at ±4 Hz of linear drift across the
  frame (`drift.json`). Beyond that decoding degrades quickly.
- **Sound-card clock error:** at −20 dB, 200/200 at every point to ±3000 ppm and ≥ 99.5% at
  ±5000 ppm (`clock.json`).
- **Fading:** decodes on slow and moderate Watterson paths. On the ITU-R F.1487 high-latitude
  moderate path (10 Hz Doppler spread) it does not decode at any SNR, because the Doppler spread
  is wider than the 3.125 Hz tone spacing.
