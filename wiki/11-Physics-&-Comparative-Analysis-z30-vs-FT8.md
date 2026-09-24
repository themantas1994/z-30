# 11. Physics & Comparative Analysis: z-30 vs FT8

This page compares z-30 with FT8, the mode most operators will judge it against. Every row
says what kind of evidence stands behind it, because an earlier version of this page mixed
measured figures, arithmetic, published figures for another mode and numbers nobody had
measured. Two of those claims had to be withdrawn (see the end of this page).

**Evidence classes**

| Tag | Meaning |
| :--- | :--- |
| **[M]** | measured here, in seeded **software simulation** through the production receiver `decode_slot`; the result file is named |
| **[D]** | derived by arithmetic from protocol parameters or from an [M] figure; the working is shown |
| **[P]** | a published figure or documented behaviour of FT8/WSJT-X; **not reproduced here** — no FT8 decoder was run on z-30's channels |
| **[N]** | not measured |

Nothing on this page is a hardware or on-air measurement. **Real-radio validation: not yet
performed.**

## 1. The parameters

| | z-30 | FT8 | Class |
| :--- | :--- | :--- | :---: |
| Cycle / transmission | 30 s / 24.0 s | 15 s / 12.64 s | [D] |
| Modulation | 16-GFSK, BT 2.0, 3.125 Hz spacing, 3.125 baud | 8-GFSK, BT 2.0, 6.25 Hz spacing, 6.25 baud | [D] / [P] |
| Occupied bandwidth | ≈ 50 Hz (99%), ≈ 66 Hz (−40 dB) of the audio waveform | ≈ 50 Hz | [M] in software (`loopback::tests`, `z30 --loopback-test`; no transmitter measured) / [P] |
| Message bits | **63** | **77** | [D] |
| Information bits into the code (message + CRC-14) | 77 | 91 | [D] |
| Code | IRA-LDPC (216, 77), rate 0.356 | LDPC (174, 91), rate 0.523 | [D] |
| Sync | 21 symbols: 7 groups of 3 (positions 0–2, 7–9, 17–19, 27–29, 37–39, 47–49, 72–74) | 21 Costas symbols (3 groups of 7) | [D] |
| Interference cancellation | subtract and re-decode, up to 3 passes | subtract and re-decode (`subtractft8`), multiple passes | [M] / [P] |
| A priori decoding | yes, off by default ([17](17-A-Priori-(AP)-Decoding.md)) | yes | [D] / [P] |

## 2. Sensitivity, and what it costs

| | z-30 | FT8 | Class |
| :--- | ---: | ---: | :---: |
| 50% decode, AWGN, SNR in 2500 Hz | **−23.03 dB [−23.13, −22.89]** | −21 dB | [M] / [P] |
| 90% decode, AWGN | −22.06 dB [−22.15, −21.80] | [N] here | [M] |
| Transmit time per message | 24.0 s | 12.64 s | [D]: 2.78 dB more energy for z-30 |
| Message bit rate R<sub>b</sub> | 63 / 24.0 = 2.63 bit/s | 77 / 12.64 = 6.09 bit/s | [D] |
| **Eb/N0 per message bit at 50%** | **6.76 dB** | **5.13 dB** | [D]: z-30 needs **1.63 dB more** |
| Shannon limit, SNR in 2500 Hz (Eb/N0 = −1.59 dB) | −31.38 dB | −27.72 dB | [D] |
| Distance from own Shannon limit | 8.35 dB | 6.72 dB | [D] |

The z-30 figures: `research/results/672cef9b3cdb/awgn.json` — blind acquisition (tone 0 uniform
over 210–2740 Hz, DT uniform over ±1.4 s, random carrier phase, random payload), success = the
decoded 63 payload bits equal the transmitted ones, 200 frames per SNR point, suite seed
20260830, Wilson 95% intervals. The FT8 figure is from Franke, Somerville & Taylor, "The FT4 and
FT8 Communication Protocols", *QEX*, July/August 2020, a simulation figure whose exact
conditions (acquisition range, AP use, success criterion) are not identical to these.

Eb/N0 = SNR<sub>2500</sub> + 10 log<sub>10</sub>(2500 / R<sub>b</sub>). For z-30:
−23.03 + 29.79 = 6.76 dB. For FT8: −21.0 + 26.13 = 5.13 dB.

**Read the three together.** z-30 decodes about 2 dB deeper per transmission. It does so by
transmitting 1.9 times as long (2.78 dB) and carrying 14 fewer message bits. Per message bit it
is **less** energy-efficient than FT8, by about 1.6 dB, and it sits further from its own
Shannon limit. The extra depth is bought, not gained. Quoting the −23 dB figure without the
airtime and the bit count is the error this page used to make.

## 3. Fading

| | z-30 | FT8 | Class |
| :--- | :--- | :--- | :---: |
| 50% decode, ITU-R F.1487 good / moderate / poor (Watterson, average SNR) | −20.94 / −21.37 / −20.88 dB | [N] here | [M] |
| 50% decode, high-latitude moderate (3 ms / 10 Hz) | none: 0 of 800 frames from −20 to +10 dB | [N] here | [M] |

| ITU-R F.1487 preset (delay / Doppler 2σ) | −22 dB | −20 dB | −18 dB | −16 dB | −14 dB | −10 dB | 50% crossing |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| good (0.5 ms / 0.1 Hz) | 32.0% | 66.0% | 87.5% | 92.0% | 96.0% | 99.5% | −20.94 dB [−21.33, −20.55] |
| moderate (1 ms / 0.5 Hz) | 34.5% | 83.5% | 98.5% | 100% | 100% | 100% | −21.37 dB [−21.63, −21.12] |
| poor (2 ms / 1 Hz) | 18.5% | 75.0% | 98.5% | 100% | 100% | 100% | −20.88 dB [−21.09, −20.68] |
| high-latitude moderate (3 ms / 10 Hz) | — | 0% | — | — | — | 0% (and 0% at 0 and +10 dB) | **no decode at any SNR** |

Against AWGN (−23.03 dB), fading costs z-30 about 1.7–2.2 dB at the 50% point. On the slowest
channel ("good", 0.1 Hz Doppler) the cost grows toward high decode rates: a frame whose whole
24 s falls in a fade is lost whatever the average SNR, so 96% is reached only at −14 dB and
99.5% at −10 dB. On the faster "poor" channel the fading averages out within a frame and 98.5%
is reached at −18 dB, but its 50% point is the worst of the three (its coherence time,
1/(2πσ_D) ≈ 0.32 s, is one symbol long; why that costs this much has not been isolated).

Source: `research/results/672cef9b3cdb/fading.json`; `z30_channel::Watterson`, two independent
equal-power paths with complex Gaussian taps whose Doppler **power** spectrum is Gaussian with
standard deviation σ_D = spread / 2 (the ITU-R F.1487 2σ spread), normalised to unit power over
the ensemble (so an individual frame fades as the channel dictates); SNR is the average SNR;
200 frames per point; seed 20260830. Software simulation, no hardware. [M]

**Previous figures corrected.** The fading rows published before 2026-09-24 (−20.79 / −21.31 /
−21.07 dB) were measured with a channel model whose taps had 1/√2 of the labelled Doppler
spread (both the Rust model and the Python oracle; post-remediation audit N-01). They described
0.071 / 0.35 / 0.71 / 7.1 Hz channels, not the presets named, and are withdrawn. The corrected
model's spread is measured by tests that fail on the old one (`z30-channel`,
`legacy/python-oracle/tests/test_watterson_doppler.py`).

**On a path with 10 Hz of Doppler spread z-30 does not decode at any SNR.** The spread is wider
than the 3.125 Hz tone spacing, so the tones are no longer separable; the long, narrow symbol
that buys the AWGN depth is what loses this channel. FT8's 6.25 Hz spacing is also narrower
than 10 Hz; how FT8 fares on the same channel is **[N]** — no FT8 decoder was run here.

## 4. Timing, drift and clock error

| | z-30 | FT8 | Class |
| :--- | :--- | :--- | :---: |
| Timing window | ±1.5 s, a hard edge: 100% at ±1.5 s, 3.5% / 11.5% at +1.6 / −1.6 s, 0% at ±2.0 s (at −20 dB) | operators are asked to keep clocks within about 1 s of UTC | [M] `timing.json` / [P] |
| Linear frequency drift across the frame | tracked to ±4 Hz (~79% at −22 dB); 58.5% at ±5 Hz; ~3% at ±8 Hz | [N] | [M] `drift.json` |
| Sound-card clock error | ≥ 99.5% to ±5000 ppm; 72.5% / 81.5% at +10000 / −10000 ppm (−20 dB) | [N] | [M] `clock.json` |

z-30 has no built-in time source. The operating system's clock, kept by NTP or GPS, is the
reference ([07](07-RF-Time-Synchronization-Engine.md)).

## 5. Crowded bands and collisions

| | z-30 | FT8 | Class |
| :--- | :--- | :--- | :---: |
| 40 stations at random, overlapping positions, −20…0 dB | 98.8% [98.2, 99.2] decoded, 0 false | [N] | [M] `busy.json` |
| Two-station collisions, SIC on vs off | table in [05](05-Successive-Interference-Cancellation-(SIC).md) | [N] | [M] `sic.json` |
| False decodes | 0 in 2000 slots of five kinds of non-z-30 audio (white noise, CW carriers, 16-FSK without Costas, FT8-like 8-FSK, impulses) | [N] | [M] `false.json` |

Both modes subtract decoded signals and search again. The claim this page used to make — that
FT8 "fails" on collisions and z-30 alone recovers them — was wrong on the FT8 side and
unmeasured on the z-30 side.

## 6. What z-30 cannot do that FT8 can

- **Interoperate.** z-30 is not FT8: it cannot decode FT8 and FT8 software cannot decode it. No
  other software speaks z-30, there are no agreed z-30 frequencies, and nobody else is known to
  be on the air with it.
- **Carry the same messages.** v1 carries two standard callsigns and one 7-bit field: a report
  (−30…+30 dB), `RRR`, `73`, `RR73`, or one of **63 grid squares**. It has no roger bit (no
  `R-12`), no portable or compound callsigns, no contest or free-text messages, and no
  arbitrary grid. The software refuses such messages rather than sending something else.
- **Turn around quickly.** A 30 s cycle means a minimal QSO takes twice as long.
- **Spot.** There is no PSK Reporter or other spotting-network upload.

## 7. Withdrawn claims

These appeared on this page or elsewhere in the project and are withdrawn. None is replaced by
anything but the measured figures above.

- **"+4.0 dB advantage over FT8."** It subtracted FT8's published figure from z-30's
  genie-aided bound (a receiver told the frequency, timing and noise level). A bound is not a
  threshold.
- **"z-30 is level with FT8"** (2026-08-31), from a legacy benchmark that applied a
  demodulator term the receiver does not use. Superseded by the vNext measurement above.
- **"FT8: no collision recovery"** and the SIC decode-rate table (98.7 / 95.2 / 91.4 / 84.6 %),
  "Pass 3 reaches −27.5 dB", "recovery down to −31.5 dB". No instrument produced them.
- **"50 QSOs per 2.7 kHz"** and similar spectral-density figures, and the FT4/WSPR/JS8Call
  comparison table, whose figures were not sourced.
- **"Resists polar and auroral flutter"**, "tracks Doppler ±1.5 Hz" and "zero-admin RF time
  calibration". The measurement above shows the opposite on high-Doppler paths, and the RF time
  receiver was retired with the browser runtime.
- **"+2.4 dB coding gain" and "+3 dB predetection gain"** as net advantages. They are real
  properties of the parameters, but the Eb/N0 row in section 2 is what the whole chain delivers
  per message bit, and it is behind FT8.
