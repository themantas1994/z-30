# 03. DSP & Physical Layer Specification

This document provides the complete mathematical and signal processing specification for the **z-30** physical transmission layer.

---

## 📊 Physical Layer Parameters Summary

| Parameter | Notation | Value | Notes |
| :--- | :--- | :--- | :--- |
| **Modulation** | — | **16-MFSK (CPFSK)** | Continuous-Phase Frequency Shift Keying |
| **Tone Count** | $M$ | **16 tones** | Alphabet $\{0, 1, 2, \dots, 15\}$ |
| **Tone Spacing** | $\Delta f$ | **3.125 Hz** | $\Delta f = 1 / T_s$ (Orthogonal condition) |
| **Symbol Duration** | $T_s$ | **320.0 ms** | $T_s = 0.320\text{ s}$ |
| **Occupied Bandwidth** | $B$ | **50.0 Hz** | $B = 16 \times 3.125\text{ Hz}$ |
| **Frame Symbol Count** | $N_{\text{sym}}$ | **75 symbols** | 54 Data Symbols + 21 Costas Sync Symbols |
| **Active TX Duration** | $T_{\text{tx}}$ | **24.0 s** | $75 \times 0.320\text{ s} = 24.0\text{ s}$ |
| **Cycle Duration** | $T_{\text{cycle}}$ | **30.0 s** | Synchronized to UTC :00 / :30 |
| **Guard / Processing Time** | $T_{\text{guard}}$ | **6.0 s** | FFT Framing + 3-Pass SIC + LDPC decode |
| **Bits per Symbol** | $\log_2(M)$ | **4 bits/symbol** | $54 \times 4 = 216$ coded channel bits |
| **FEC Code** | — | **IRA-LDPC (216, 77)** | Rate $R \approx 0.356$, dual-diagonal parity |
| **AWGN Decode Threshold** | — | **-22.9 dB SNR (50%) / -22.1 dB SNR (90%)** | In a $2500\text{ Hz}$ noise bandwidth, through blind acquisition with random carrier ($\pm5$ Hz) and timing ($\pm0.5$ s) offsets, demodulated non-coherently. Seed 20260830, 200 frames/point; 95% intervals $[-23.07, -22.79]$ and $[-22.16, -22.01]$. Comparable with the published on-air figures for FT8 and FT4. |
| **Idealised AWGN Bound** | — | -24.58 dB SNR (50%) / -23.48 dB SNR (90%) | Exact noise sigma, exact carrier and perfect symbol timing given to the demodulator. A bound on the code, **not** an on-air threshold. The 1.66 dB gap is the acquisition loss. |
| **ITU-R F.1487 high-latitude moderate** | — | **does not decode** (3 frames in 1,400, $-10$ to $+20\text{ dB}$) | 3 ms delay spread, 10 Hz Doppler spread. The Doppler spread is wider than the $3.125\text{ Hz}$ tone spacing, so tone orthogonality is destroyed; acquisition still finds the frame. See [16](16-Benchmarking-Testing-&-CI.md#the-channel-z-30-cannot-use). |

---

## 🔄 End-to-End Signal Chain

```
                                      z-30 DSP Transmit / Receive Flow
                                      ================================

       [ Structured QSO Message ]                           [ Raw Audio In (12 / 48 kHz / 16-bit) ]
                 |                                                          |
       [ 63-bit Radix-37/27 Packing ]                             [ Audio Buffer (24.0s Window) ]
                 |                                                          |
       [ 14-bit CRC Parity Insertion ]                             [ Downsample & Matched Filter ]
                 |                                                          |
       [ R=0.356 IRA-LDPC Encoder (216, 77) ]                     [ FFT Energy Binning (16 Tones) ]
                 |                                                          |
       [ 21-Symbol Costas Synchronization ]                        [ Costas Array Sync Detection ]
                 |                                                          |
       [ 16-MFSK Continuous Phase FSK ]                            [ Non-Coherent Metric Slicer ]
                 |                                                          |
       [ Gaussian Frequency-Pulse Shaping ]                        [ Log-Likelihood Ratio (LLR) ]
                 |                                                          |
       [ Transceiver Soundcard / CAT ]                            [ Belief Propagation LDPC Decoder ]
                                                                            |
                                                                   +--------+--------+
                                                                 Valid CRC?       Corrupt / Clash?
                                                                   |                 |
                                                            [ Output Decode ]   [ SIC Engine ]
                                                                                     |
                                                                           (Subtract & Re-decode)
```

The transmit path is implemented twice, once per stack, and the two must stay bit-exact:
`z30_dsp/modem.py` and `src/dsp/z30Waveform.ts`. `tests/test_cross_language_parity.py` and
`tests/crc14.test.mjs` hold them together against shared known-answer vectors.

---

## 🌊 Waveform Synthesis & Keying

The transmitted continuous-phase baseband signal $s(t)$ over the frame duration $0 \le t \le 24.0\text{ s}$ is defined as:

$$s(t) = A(t) \cdot \cos\left( 2\pi f_{\text{carrier}} t + 2\pi \Delta f \int_{0}^{t} \sum_{k=0}^{74} S_k \cdot g(\tau - k T_s)\, d\tau + \phi_0 \right)$$

Where:
- $S_k \in \{0, 1, \dots, 15\}$ is the integer tone index for symbol $k$.
- $\Delta f = 3.125\text{ Hz}$ is the tone spacing.
- $T_s = 0.320\text{ s}$ is the symbol period.
- $g(t)$ is a **Gaussian frequency pulse** with bandwidth-time product $BT = 2.0$ — the value
  WSJT-X uses for FT8. The piecewise-constant tone sequence is convolved with $g(t)$ *before*
  it is integrated into phase.
- $A(t)$ is the envelope: **unity throughout the frame**, with a single 20 ms raised-cosine
  ramp at the start ($t=0$) and at the end ($t=24.0\text{ s}$).

Two properties define this waveform, and both are load-bearing:

1. **Continuous phase.** One phase accumulator runs across the entire frame. A phase
   discontinuity at a symbol boundary is an impulse in frequency and radiates across the whole
   passband.
2. **Constant amplitude.** Smoothing the *frequency* narrows the spectrum; smoothing the
   *amplitude* per symbol is amplitude keying at 3.125 baud laid over the tone sequence, and
   widens it. An earlier modulator did exactly that — an 8 ms ramp on every one of the 75
   symbols — and discarded the benefit of the phase accumulator sitting next to it.

Lowering $BT$ to 1.0 buys back roughly 6 Hz of -40 dB occupied bandwidth but costs about 2 dB
of decode threshold, because the extra smoothing is inter-symbol interference the per-symbol
matched-filter demodulator does not model. That is a bad trade for a weak-signal mode.
`tests/test_modem_spectrum.py` asserts the 99% occupied bandwidth (**49.8 Hz** measured) and
the -40 dB bandwidth (**66 Hz**) against fixed budgets, and asserts that the old per-symbol
gated waveform *fails* them — so the test can demonstrably tell the difference.

---

## ⏱️ Synchronous 30-Second Cycle Timing

The UTC clock is divided into even and odd 30-second transmission slots:

- **`EVEN` slot**: begins exactly at `:00` of each UTC minute (span `:00`–`:30`).
- **`ODD` slot**: begins exactly at `:30` of each UTC minute (span `:30`–`:00`).

Within a slot:

| Window | Span | Purpose |
| :--- | :--- | :--- |
| **Active transmission** | $0.00\text{ s}$ – $24.00\text{ s}$ | The 75-symbol frame |
| **Decode & SIC processing** | $24.00\text{ s}$ – $28.50\text{ s}$ | $4.50\text{ s}$ compute budget for FFT framing, LDPC and 3-pass SIC |
| **Sequencing & CAT guard** | $28.50\text{ s}$ – $30.00\text{ s}$ | $1.50\text{ s}$ of rig turnaround |

Slot alignment is what makes the mode work at all; see
[07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md) for how z-30
calibrates its clock without internet access.

---

## 🎯 Synchronization & Costas Array Pattern

To enable robust detection under severe polar flutter, multi-path delay spread, and Doppler drift, z-30 embeds **21 synchronization symbols** distributed across the 75-symbol frame.

### Sync Positions in Frame:
```
Indices: [0, 1, 2,  7, 8, 9,  17, 18, 19,  27, 28, 29,  37, 38, 39,  47, 48, 49,  72, 73, 74]
```

### Costas Tone Pattern:
```
Sync Tones: [3, 11, 7,  14, 2, 9,  5, 12, 1,  15, 6, 10,  4, 8, 13,  0, 9, 3,  14, 6, 11]
```

### Purpose of Interleaved Sync:
1. **Time Offset ($\Delta t$) Estimation**: Normalized cross-correlation against the known 21-symbol sequence estimates frame arrival time with sub-10ms precision across a $\pm 1.5\text{ s}$ search window.
2. **Frequency Offset ($\Delta f$) Tracking**: Estimates fine carrier frequency errors down to $\pm 0.1\text{ Hz}$.
3. **Phase Trajectory Tracking**: Tracks ionospheric phase rotation across the 24-second transmission frame for coherent multi-pass SIC reconstruction.

---

## 📈 Demodulation & Non-Coherent Metric Slicing

1. **Downsampling & Filtering**: Input audio (at 12 kHz or 48 kHz) is filtered through a 128-tap Kaiser-windowed bandpass filter matching the active channel bandwidth.
2. **Short-Time Discrete Fourier Transform (STDFT)**:
   For each symbol interval $k \in [0, 74]$, the power spectral density across all 16 candidate tone frequencies $f_m = f_{\text{base}} + m \cdot \Delta f$ is computed:
   $$P_k(m) = \left| \sum_{n=0}^{N-1} x[n + k N] \cdot w[n] \cdot e^{-j 2\pi \frac{m n}{N}} \right|^2, \quad m \in \{0, 1, \dots, 15\}$$
3. **Log-Likelihood Ratio (LLR) Generation**:
   For each of the 4 bits $b_{k,j}$ ($j \in \{0, 1, 2, 3\}$) mapped by Gray-coding into tone index $m$:
   $$\text{LLR}(b_{k,j}) = \ln \left( \frac{\sum_{m \in S_{j,0}} \exp\left( \frac{P_k(m)}{\sigma^2} \right)}{\sum_{m \in S_{j,1}} \exp\left( \frac{P_k(m)}{\sigma^2} \right)} \right)$$
   Where $S_{j,0}$ and $S_{j,1}$ are the tone subsets having bit $j$ equal to 0 and 1, respectively.
