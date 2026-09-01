# 05. Successive Interference Cancellation (SIC)

A fundamental challenge in digital weak-signal amateur radio is **packet collisions**: when two or more stations transmit inside the same frequency slice during the same time slot, conventional decoders (such as standard FT8) suffer destructive interference and fail to decode either signal.

**z-30** implements a **3-pass Successive Interference Cancellation (SIC)** DSP engine that solves this problem.

---

## 🎯 The Co-Channel Collision Problem

In typical HF conditions, a local kilowatt station transmitting at $+10\text{ dB SNR}$ will completely drown out a distant DX station at $-25\text{ dB SNR}$ if their carrier frequencies overlap within the same 50 Hz channel bandwidth:

$$\text{SINR}_{\text{DX}} = \frac{P_{\text{DX}}}{P_{\text{local}} + N_0} \approx \frac{-25\text{ dB}}{+10\text{ dB}} = -35\text{ dB} \quad (\text{Far below decodable threshold})$$

---

## ⚙️ The 3-Pass SIC Pipeline

```
   Raw Audio Buffer
         │
    [ PASS 1 ] ──> Dominant Signals Decoded (High SNR)
         │
   [ Parameter Estimation ] (Exact Amplitude A, Center Freq f0, Phase phi0, Time Offset dt)
         │
   [ Waveform Synthesis ] (Generate continuous-phase 16-MFSK replica s_hat(t))
         │
   [ Time-Domain Subtraction ]  x_residual(t) = x(t) - s_hat(t)
         │
    [ PASS 2 ] ──> Medium Weak Signals Decoded (Unmasked from Pass 1)
         │
   [ Secondary Subtraction ]
         │
    [ PASS 3 ] ──> Deep DX Signals Decoded (unmasked from Pass 2)
```

---

## 🔬 Mathematical Formulation

### 1. Complex Envelope Parameter Estimation
When station $i$ is decoded in Pass 1, its known symbol sequence $\mathbf{S}^{(i)} = [S_0, S_1, \dots, S_{74}]$ is known with $100\%$ certainty due to the 14-bit CRC check. The DSP engine estimates four physical parameters using Maximum Likelihood:
- $\hat{f}_0$: Exact carrier frequency (precision $< 0.05\text{ Hz}$).
- $\hat{\Delta t}$: Symbol start time delay (precision $< 1\text{ ms}$).
- $\hat{A}(t)$: Time-varying amplitude trajectory.
- $\hat{\phi}(t)$: Ionospheric phase trajectory over the 24-second frame.

### 2. Time-Domain Signal Synthesis
The clean synthetic replica $\hat{s}_i(t)$ is generated at the native audio sampling rate ($F_s = 12000\text{ Hz}$ or $48000\text{ Hz}$):

$$\hat{s}_i(t) = \hat{A}(t) \cdot \cos\left( 2\pi \hat{f}_0 (t - \hat{\Delta t}) + 2\pi \Delta f \int_{0}^{t} \sum_{k=0}^{74} S_k^{(i)} g(\tau - k T_s - \hat{\Delta t})\, d\tau + \hat{\phi}(t) \right)$$

### 3. Coherent Subtraction
The synthetic replica is subtracted from the digitized audio buffer:

$$x_{\text{residual}}^{(1)}(t) = x_{\text{received}}(t) - \sum_{i \in \text{Pass 1}} \hat{s}_i(t)$$

### 4. Iterative Re-Decoding
$x_{\text{residual}}^{(1)}(t)$ is transformed back through the STDFT filterbank, and the LDPC belief-propagation decoder is executed on the residual energy. Any newly decoded packets are similarly synthesized, subtracted ($x_{\text{residual}}^{(2)}(t)$), and passed to Pass 3.

---

## 🔍 Candidate detection: one algorithm, two languages

Each pass starts by finding candidate carriers in the residual spectrum. Until 2026-09-01 the
two implementations did this differently, and both were the shipped default on their own side:

| | Before | Now |
| :--- | :--- | :--- |
| `z30_dsp/sic_decoder.py` | local maxima on **raw FFT bins**, 8 dB over the median | Bartlett-averaged tone groups, `SIC_MIN_PEAK_DB` |
| `src/dsp/realReceiver.ts` | Bartlett-averaged tone groups, 6 dB over the median | unchanged |

The averaging step is the part that matters. A ~24 s buffer gives an FFT bin spacing far finer
than the ~3.125 Hz needed to localise a 16-MFSK comb, and with that many independent noise bins
a fixed "X dB over the median" test becomes an order-statistics problem: the largest of ~10⁵
noise bins clears the threshold routinely. Measured on this repository, over five independent
noise seeds at the frame length the decoder actually uses, the raw-bin detector returned
**52, 52, 52, 52 and 53 candidates from pure Gaussian noise** — carriers that do not exist, each
costing a refinement and decode attempt. The grouped detector returned **0** on all five.

Python now runs the grouped detector too. `SIC_MIN_PEAK_DB` and `SIC_MAX_CANDIDATES` are
declared in both languages and pinned to each other by `tests/test_cross_language_parity.py`;
`tests/test_sic_candidate_detection.py` covers the behaviour on real synthesised frames.

> This does not move any published sensitivity figure. `benchmark.py` measures through
> `acquisition.py` and never calls `_find_candidates`, so the −23.1 / −21.7 dB AWGN threshold is
> untouched by this change.

---

## 📊 Benchmark Extraction Performance

> **Retraction (2026-09-01): the collision decode-rate table that stood here is withdrawn.**
>
> It reported four z-30 SIC decode rates (98.7% / 95.2% / 91.4% / 84.6% at 5/12/20/26 dB
> collision differentials) against four FT8 rates, and the pipeline diagram above claimed Pass 3
> reaches "-27.5 dB SNR". None of those eight numbers came from any instrument in this
> repository. `z30_dsp/benchmark.py` - the reference instrument, and per `AGENTS.md` §5 the only
> sanctioned source of a sensitivity figure - has no collision or SIC mode at all: it sweeps a
> single frame against AWGN and Watterson fading. The figures appear nowhere in `z30_dsp/`,
> `src/` or `tests/`, and no seed, frame count or method was ever recorded beside them.
>
> This is the same shape of claim as the withdrawn "+4.0 dB advantage", which `AGENTS.md` says
> must never recur. Publishing an unmeasured decode rate for the collision case is worse than
> publishing nothing: an operator plans an antenna or a band choice around it.
>
> **What would be needed to restore it:** a collision mode in `benchmark.py` that synthesises
> two or more overlapping frames at a controlled power differential and frequency separation,
> runs them through `sic_decoder.py`, and reports decode rate per pass - then a seeded sweep
> quoted with its seed, frame count, channel model and a confidence figure a reader can check,
> at the ≥95% bar `AGENTS.md` §5 sets for a documentation claim. Until that exists, the
> collision performance of z-30's SIC pipeline **is not measured**.

The mechanism described above is implemented and exercised - `z30_dsp/sic_decoder.py` and
`src/dsp/sicDecoder.ts` run the three passes, and `tests/test_sic_candidate_detection.py` covers
the candidate detector both languages now share. What is absent is a *quantitative* claim about
how often it succeeds, not the pipeline itself.

In the z-30 user interface, signals decoded via SIC are clearly indicated with a purple badge (**`SIC 2`** or **`SIC 3`**) in the Activity Log and Waterfall.
