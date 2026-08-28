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
| **FEC Code** | — | **QC-LDPC (216, 77)** | Rate $R \approx 0.356$ |
| **AWGN Sensitivity Limit** | — | **-29.5 dB SNR** | In standard $2500\text{ Hz}$ noise bandwidth |

---

## 🌊 Waveform Synthesis & Keying

The transmitted continuous-phase baseband signal $s(t)$ over the frame duration $0 \le t \le 24.0\text{ s}$ is defined as:

$$s(t) = A(t) \cdot \cos\left( 2\pi f_{\text{carrier}} t + 2\pi \Delta f \int_{0}^{t} \sum_{k=0}^{74} S_k \cdot g(\tau - k T_s)\, d\tau + \phi_0 \right)$$

Where:
- $S_k \in \{0, 1, \dots, 15\}$ is the integer tone index for symbol $k$.
- $\Delta f = 3.125\text{ Hz}$ is the tone spacing.
- $T_s = 0.320\text{ s}$ is the symbol period.
- $g(t)$ is a raised-cosine shaping filter with roll-off factor $\beta = 0.20$ to suppress sideband splatter.
- $A(t)$ is the envelope amplitude with a 20 ms raised-cosine ramp at the start ($t=0$) and end ($t=24.0\text{ s}$) to prevent key clicks.

---

## 🎯 Synchronization & Costas Array Pattern

To enable robust detection under severe polar flutter, multi-path delay spread, and Doppler drift, z-30 embeds **21 synchronization symbols** distributed across the 75-symbol frame.

### Sync Positions in Frame:
```
Indices: [0, 1, 2,  7, 8, 9,  17, 18, 19,  27, 28, 29,  37, 38, 39,  47, 48, 49,  72, 73, 74]
```

### Costas Tone Pattern:
```
Sync Tones: [3, 14, 1,  9, 6, 12,  2, 11, 5,  13, 0, 8,  4, 15, 7,  10, 3, 14,  1, 9, 6]
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
