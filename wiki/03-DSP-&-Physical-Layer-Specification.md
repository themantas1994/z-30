# 03. DSP & Physical Layer Specification

The normative text is [`SPEC.md`](../SPEC.md); the implementation is `crates/z30-protocol`
(transmit) and `crates/z30-dsp` (receive), documented in [`docs/`](../docs/README.md). This page
summarises both and must agree with them. Every statement about the receiver below describes
code that exists; nothing here describes intended behaviour.

## Physical layer parameters

| Parameter | Value | Notes |
| :--- | :--- | :--- |
| Modulation | 16-GFSK, continuous phase | Gaussian frequency pulse, BT = 2.0 |
| Tone spacing | 3.125 Hz | = 1 / symbol time |
| Symbol time | 320 ms | 1920 samples at the receiver's 6 kHz |
| Tone span | 46.9 Hz | tone 0 to tone 15 |
| Occupied bandwidth (audio waveform) | 99%: ≈ 49–50 Hz; −40 dB: ≈ 66 Hz | Welch PSD, Hann, 8192 points at 6 kHz (0.73 Hz bins), 50% overlap (`z30 --loopback-test` uses the same method); ideal waveform only — transmitter and ALC effects not measured |
| Symbols per frame | 75 = 54 data + 21 sync | |
| Frame | 24.00 s | starts on a 30 s UTC boundary (even or odd slot) |
| Message | **63 bits** | two 28-bit call fields + 7-bit extra field |
| Information bits | 77 = 63 + 14-bit CRC | CRC-14, g(x) = x¹⁴+x¹³+x¹⁰+x⁶+x+1, init 0x2757 |
| FEC | IRA-LDPC (216, 77), rate 0.356 | dual-diagonal parity, degree-5 connection table |
| Symbol mapping | **natural binary**, 4 bits/symbol, MSB first | not Gray-coded; the loss against Gray has not been measured |
| Receiver timing window | slot − 1.5 s … slot + 25.5 s | DT search ±1.5 s, hard edge |
| Sideband | USB assumed | radiated = dial + audio; LSB is not modelled |

The sensitivity figures are on [16](16-Benchmarking-Testing-&-CI.md) and
[11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md), each with its conditions. None is a
hardware or on-air measurement.

## Transmit

```text
message text -> v1 codec (refuses anything it cannot carry exactly) -> 63 bits
             -> CRC-14 -> 77 bits -> LDPC (216,77) -> 54 data symbols (natural binary)
             -> interleave 21 Costas symbols -> 75 tones -> GFSK modulator (one phase accumulator,
                BT 2.0, constant envelope, 20 ms raised-cosine ramp at each end) -> audio
```

The modulator is `z30_protocol::gfsk::Modulator`; the same one generates the SIC replica and
the benchmark's test signals. It is bit-exact with the frozen Python oracle on the golden
waveforms at 6, 12 and 48 kHz, and an independent re-implementation from `SPEC.md` alone
reproduced it exactly (2026-09-24 audit, E007).

Two properties are load-bearing: **continuous phase** (a phase step at a symbol boundary would
splatter across the passband) and **constant amplitude** (the only amplitude shaping is one
ramp at each end of the frame; a per-symbol amplitude ramp, which an early version had, is
amplitude keying at 3.125 baud).

## Frame layout

```text
SSS DDDD SSS DDDDDDD SSS DDDDDDD SSS DDDDDDD SSS DDDDDDD SSS DDDDDDDDDDDDDDDDDDDDDDD SSS
sync positions: 0-2, 7-9, 17-19, 27-29, 37-39, 47-49, 72-74
sync tones:     3 11 7 | 14 2 9 | 5 12 1 | 15 6 10 | 4 8 13 | 0 9 3 | 14 6 11
```

Seven clusters of three. The pattern uses all 16 tones; for any non-zero shift in time and tone,
at most 3 of the 21 sync symbols coincide (audit E011). Strictly it is not a Costas array (tones
repeat), which acquisition does not need.

## Slot timing

| Span (relative to the slot boundary) | What |
| :--- | :--- |
| −1.5 s … +25.5 s | the receive window for that slot (27 s): the frame (24 s) plus the ±1.5 s DT search |
| +25.5 s | the earliest moment the window is complete; the scheduler decodes then, never before |
| +25.5 s … +30 s | the decode budget: 4.5 s before the next slot starts |

The decode is triggered by the audio sample counter reaching the end of the window, not by a
timer ([`docs/synchronization.md`](../docs/synchronization.md)). The retired browser app
triggered at +24.0 s, before its window existed, and never retried (audit C-01). The old
statement on this page that decoding runs from +24.0 s to +28.5 s was that defect written down.

## Receive (`decode_slot`)

1. **Slot spectrum.** One real FFT of the 162 000-sample window (6 kHz).
2. **Coarse sync.** A Hann-windowed spectrogram (one symbol long, zero-padded 4× to 0.78 Hz
   bins, hopped every 40 ms) over 200–2800 Hz. For every DT in ±1.5 s and every tone-0 bin, the
   Costas metric is the power at the 21 sync tones over the power in all 16 tone bins at those
   instants, normalised by the map's median. Local maxima above 1.5, non-maximum suppression,
   at most 50 candidates per pass.
3. **Per-candidate baseband.** 5400 bins around the candidate, a raised-cosine taper beyond
   ±85 Hz, one inverse FFT: complex baseband at 200 Hz, where tone k is bin k of a 64-point FFT.
4. **Fine sync.** Timing (5 ms grid + parabolic interpolation), frequency (to 0.02 Hz) and a
   linear drift hypothesis up to ±4 Hz across the frame, all on the sync symbols only.
5. **Demodulation.** 64-point FFT per symbol after de-rotating frequency and drift; noise from
   the median of off-signal bins; per-tone noise raised where something stationary sits
   (whitening against carriers); the exact non-coherent Rician metric
   `ln I0(a|r|/σ²) − a²/(2σ²)` with the pilot-mean amplitude; exact Log-MAP demapping to 216
   LLRs. **Non-coherent**: there is no carrier-phase or phase-trajectory tracking, and none is
   needed for 16-FSK with 320 ms symbols.
6. **LDPC.** Four belief-propagation schedules (≤ 150 iterations in total), then an OSD whose
   candidates must carry a matching received CRC field; optional AP ([17](17-A-Priori-(AP)-Decoding.md)).
   The CRC decides.
7. **Measurements.** DT is the least-squares placement of the decoded frame's replica (to one
   6 kHz sample); SNR is measured against the residual after that replica is removed; both are
   checked against the truth from −22 to +30 dB ([16](16-Benchmarking-Testing-&-CI.md)).
8. **SIC.** Each decode is regenerated with the modulator, fitted with a slowly varying complex
   gain by least squares, timing-refined and subtracted; passes 2 and 3 search what is left
   ([05](05-Successive-Interference-Cancellation-(SIC).md)).

There is no Kaiser-window bandpass filter, no "normalised cross-correlation" with sub-10 ms
precision, no phase-trajectory tracking and no Gray demapping anywhere in the receiver. Earlier
versions of this page described all four; none was ever implemented (audit E051).

## Measured tolerances (simulation)

Measured through `decode_slot`, single stations, AWGN; full tables on
[16](16-Benchmarking-Testing-&-CI.md):

- **Timing:** decodes at DT up to ±1.5 s; beyond it the frame leaves the window.
- **Frequency:** tone 0 anywhere from 200 Hz to 2753 Hz (tone 15 ≤ 2800 Hz).
- **Drift:** linear drift up to about ±4 Hz across the frame is tracked; beyond that decoding
  degrades quickly.
- **Sound-card clock error:** ±3000 ppm costs nothing measurable.
- **Fading:** decodes on slow and moderate Watterson paths; on ITU-R F.1487 high-latitude
  moderate (10 Hz Doppler spread) it **does not decode at any SNR** — the Doppler spread is
  wider than the 3.125 Hz tone spacing.
