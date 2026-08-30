# 11. Physics & Comparative Analysis: z-30 vs. FT8

An in-depth technical analysis for **advanced amateur radio operators, RF engineers, and digital signal processing specialists** detailing the underlying communication physics, information theory, and digital signal processing advantages of **z-30** relative to **FT8** and other weak-signal protocols.

---

## 🔬 1. Executive Summary & Parameter Comparison

| Metric / Parameter | FT8 (Franke-Taylor 8-FSK) | z-30 (16-MFSK Weak-Signal) | Physics & Engineering Delta |
| :--- | :--- | :--- | :--- |
| **Decoding Threshold ($SNR_{2500}$)** | **-21.0 dB** (measured on the air) | **-21.1 dB (50%) / -18.0 dB (90%)** (blind acquisition, AWGN) | Level - see the note below |
| **Transmission Slot Duration** | 15.0 s (12.64 s active TX) | 30.0 s (24.0 s active TX) | $2\times$ integration time ($+3.01\text{ dB}$) |
| **Modulation Format** | 8-MFSK (Continuous Phase) | 16-MFSK (Continuous Phase) | Higher-order orthogonal signaling efficiency |
| **Occupied Bandwidth** | 47.0 Hz ($8 \times 6.25\text{ Hz}$) | 50.0 Hz ($16 \times 3.125\text{ Hz}$) | Ultra-narrowband density (50 channels in 2.7 kHz) |
| **Tone Spacing ($\Delta f$)** | 6.25 Hz | 3.125 Hz | $50\%$ narrower matched-filter bandwidth |
| **Symbol Duration ($T_s$)** | 160.0 ms (6.25 baud) | 320.0 ms (3.125 baud) | $2\times$ symbol integration period |
| **Total Frame Symbols** | 79 symbols (58 data + 21 Costas) | 75 symbols (54 data + 21 Costas) | Optimized symbol packing & channel utilization |
| **Raw Channel Bits** | 174 bits ($58 \times 3\text{ bits}$) | 216 bits ($54 \times 4\text{ bits}$) | Higher total channel codeword dimensionality |
| **Information Bits ($K$)** | 77 bits ($75\text{ msg} + 2\text{ flag}$) | 77 bits ($58\text{ msg} + 14\text{ CRC} + 5\text{ flag}$) | Identical payload capacity with stronger CRC protection |
| **FEC Code** | Systematic LDPC (174, 91) | IRA LDPC (216, 77) | **Rate $R \approx 0.356$ vs $0.523$** ($+2.4\text{ dB}$ coding gain) |
| **Parity Check Fraction** | 47.7% parity overhead | **64.4% parity overhead** | Significantly steeper waterfall BER curve |
| **CRC Polynomial** | 14-bit ($P_{\text{false}} \approx 6 \times 10^{-5}$) | 14-bit CRC-14 ($P_{\text{false}} \approx 2^{-14} \approx 6.1 \times 10^{-5}$) | Same order of magnitude; neither mode is meaningfully ahead here |
| **Co-Channel Collision Recovery** | None (collisions fail to decode) | **3-Pass Successive Interference Cancellation (SIC)** | Co-channel collision resolution down to $-31.5\text{ dB}$ |
| **Clock Drift Tolerance** | $\pm 1.0\text{ s}$ (requires NTP/GPS) | $\pm 1.5\text{ s}$ + Built-in RF Time Sync | Zero-admin offline HF/LF time calibration |


### 1.1 Against the wider mode set

The same measurement placed beside the published on-air figures for the other common
weak-signal modes:

| Metric / Parameter | **z-30** | **FT8** | **FT4** | **WSPR** | **JS8Call** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cycle duration** | **30.0 s** | 15.0 s | 7.5 s | 120.0 s | 15.0 s (var) |
| **Occupied bandwidth** | **50.0 Hz** | 47.0 Hz | 83.0 Hz | 5.9 Hz | 50.0 Hz |
| **Modulation** | **16-MFSK (CPFSK)** | 8-GFSK | 4-GFSK | 4-FSK | 8-GFSK |
| **Symbol rate** | **3.125 baud** | 6.25 baud | 20.83 baud | 1.4648 baud | 6.25 baud |
| **Tone spacing ($\Delta f$)** | **3.125 Hz** | 6.25 Hz | 20.83 Hz | 1.4648 Hz | 6.25 Hz |
| **Active TX duration** | **24.0 s (75 symbols)** | 12.64 s | 4.48 s | 110.6 s | 12.64 s |
| **Decode / guard window** | **6.0 s** | 2.36 s | 3.02 s | 9.4 s | 2.36 s |
| **Sensitivity (50%), AWGN** | **-21.1 dB SNR †** | -21.0 dB SNR ‡ | -17.5 dB SNR ‡ | -28.0 dB SNR ‡ | -24.0 dB SNR ‡ |
| **Sensitivity (90%), AWGN** | **-18.0 dB SNR †** | -20.0 dB SNR ‡ | -16.5 dB SNR ‡ | -27.0 dB SNR ‡ | -22.5 dB SNR ‡ |
| **FEC code** | **LDPC (216, 77), $R \approx 0.356$** | LDPC (174, 91), $R = 0.52$ | LDPC (174, 91), $R = 0.52$ | Convolutional $K=32$, $r=1/2$ | LDPC (174, 91) |
| **Payload capacity** | **77 bits (63-bit info + CRC-14)** | 77 bits (CRC-14) | 77 bits (CRC-14) | 28 bits (call + loc + pwr) | Free text (var) |
| **Collision recovery** | **Multi-pass SIC (3 passes)** | Single pass (limited) | None | Non-coherent | Single pass |
| **Primary use case** | **Deep DX / EME / solar minima** | General DX / contesting | Rapid contesting | Propagation beaconing | Conversational keyboard |
| **Clock drift tolerance** | **$\pm 1.5\text{ s}$ (with RF auto-sync)** | $\pm 1.0\text{ s}$ | $\pm 0.5\text{ s}$ | $\pm 2.0\text{ s}$ | $\pm 1.0\text{ s}$ |
| **Spectral density** | **50 QSOs per 2.7 kHz band** | ~40 QSOs per band | ~25 QSOs per band | N/A (one-way) | ~30 QSOs per band |

**† is a like-for-like measurement with ‡.** **†** is z-30's own benchmark run in
`--mode realistic`: each frame gets a random carrier offset (±5 Hz) and timing offset (±0.5 s),
and the receiver is handed nothing but audio — it locates the frame and estimates the noise
floor itself, exactly as it must on the air. **‡** are the published over-the-air thresholds
for those modes, which include the same acquisition, AFC and timing losses. Reproduce † with
the commands in
[16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md).

**z-30 is level with FT8 on AWGN, not ahead of it.** Earlier revisions of this table quoted a
genie-aided bound against FT8's on-air figure and concluded a "+4.0 dB advantage"; that claim
was withdrawn, and this is the measurement that replaces it. z-30 spends twice the airtime of
FT8 for the same 77-bit payload, and the extra 3 dB that buys the codec is spent again on
acquiring a 3.125 Hz-spaced signal. Where z-30 does differ is in occupied bandwidth, multi-pass
SIC, and behaviour on a disturbed path — not in raw AWGN sensitivity.

### 1.2 Why 16-MFSK and a 30-second cycle at all?

1. **A longer, more heavily coded frame.** Halving the symbol rate from 6.25 to 3.125 baud
   doubles the energy per symbol, and a rate-0.356 code over 75 symbols spends considerably
   more redundancy per information bit than FT8's rate-0.52 (174, 91). Both changes buy coding
   gain, at the cost of a 30-second cycle instead of 15 — and, as the measurements above show,
   most of that gain is handed back at the acquisition stage.
2. **True co-channel collision recovery.** FT8 fails when two signals occupy the same audio
   frequency bins. z-30 runs a 3-pass **Successive Interference Cancellation** engine: when a
   strong signal is decoded, its phase and amplitude are synthesised and subtracted from the
   time-domain buffer, enabling second and third decoding passes on previously obscured weak
   signals. See
   [05. Successive Interference Cancellation (SIC)](05-Successive-Interference-Cancellation-(SIC).md).

---

## 📐 2. The Shannon-Hartley Capacity & Information Theory Foundation

The theoretical upper bound on error-free information transfer over a band-limited Additive White Gaussian Noise (AWGN) channel is governed by the **Shannon-Hartley Theorem**:

$$C = B \log_2\left(1 + \frac{S}{N}\right) = B \log_2(1 + \text{SNR})$$

Where:
- $C$ is the channel capacity in bits per second (bps).
- $B$ is the channel bandwidth in Hertz.
- $S/N$ is the linear Signal-to-Noise Ratio within bandwidth $B$.

In extreme weak-signal communications where $\text{SNR} \ll 1$ (the "power-limited" or "wideband" regime), using the natural logarithm expansion $\ln(1 + x) \approx x$:

$$C \approx B \cdot \frac{\text{SNR}}{\ln(2)} = \frac{S}{N_0 \ln(2)} \implies \frac{E_b}{N_0} \ge \ln(2) \approx -1.59\text{ dB}$$

### Link Margin Comparison in Standard Reference Bandwidth ($B_{\text{ref}} = 2500\text{ Hz}$):
In amateur radio, SNR is conventionally expressed relative to a $B_{\text{ref}} = 2500\text{ Hz}$ SSB receiver passband ($SNR_{2500}$):

$$\text{SNR}_{2500} = \frac{S}{N_0 \cdot B_{\text{ref}}} = \left(\frac{E_b}{N_0}\right) \cdot \left(\frac{R_b}{B_{\text{ref}}}\right)$$

Where $R_b$ is the net information bit rate:
- **FT8 Net Rate**: $R_{b,\text{FT8}} = \frac{77\text{ bits}}{12.64\text{ s}} \approx 6.09\text{ bps}$
- **z-30 Net Rate**: $R_{b,\text{z30}} = \frac{77\text{ bits}}{24.0\text{ s}} \approx 3.21\text{ bps}$

Calculating the theoretical Shannon threshold in a 2500 Hz reference bandwidth for both modes:
- **FT8 Theoretical Shannon Limit**: $\text{SNR}_{2500,\text{Shannon}} = -1.59\text{ dB} + 10\log_{10}\left(\frac{6.09}{2500}\right) = -27.72\text{ dB}$
- **z-30 Theoretical Shannon Limit**: $\text{SNR}_{2500,\text{Shannon}} = -1.59\text{ dB} + 10\log_{10}\left(\frac{3.21}{2500}\right) = -30.51\text{ dB}$

**Physical Insight**: FT8 decodes down to $-21.0\text{ dB}$, operating **$6.72\text{ dB}$ above its theoretical Shannon limit**. z-30's measured 50% threshold through blind acquisition is $-21.1\text{ dB}$, which is **$9.4\text{ dB}$ above its own limit of $-30.51\text{ dB}$**; its genie-aided bound of $-24.6\text{ dB}$ sits $5.9\text{ dB}$ above that limit.

The comparison to draw from those three numbers is not "z-30 is closer to Shannon". It is that halving the bit rate moves the *limit* down by 2.8 dB, and z-30 converts most of that into coding gain only when acquisition is free. On the air, where it is not, the two modes land level. The gap between z-30's bound and its measured threshold — 3.5 dB of acquisition loss on a 3.125 Hz-spaced signal — is exactly the part that a genie-aided comparison hides, in this mode and in every other.

---

## ⚡ 3. M-ary Orthogonal Signaling Physics: Why 16-MFSK Outperforms 8-MFSK

In digital communications, continuous-phase M-ary Frequency Shift Keying ($M$-MFSK) uses an alphabet of $M$ orthogonal carrier frequencies. For non-coherent matched-filter detection, the minimum tone spacing required for mathematical orthogonality is:

$$\Delta f = \frac{1}{T_s}$$

Where $T_s$ is the symbol duration.

```
       FT8: 8-MFSK (Ts = 160 ms, df = 6.25 Hz)
       |──6.25Hz──|
       f0   f1   f2   f3   f4   f5   f6   f7   (Total BW = 47.0 Hz)
       
       z-30: 16-MFSK (Ts = 320 ms, df = 3.125 Hz)
       |─3.125Hz─|
       f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 f13 f14 f15 (Total BW = 50.0 Hz)
```

### 3.1 The Fundamental Orthogonal Signaling Property
Unlike amplitude or phase modulation schemes (QAM, PSK)—where increasing the constellation size $M$ requires higher $E_b/N_0$ to maintain the same Bit Error Rate—**orthogonal M-ary FSK exhibits the inverse behavior**:

$$\lim_{M \to \infty} P_b(M\text{-FSK}) \to 0 \quad \text{for any } \frac{E_b}{N_0} > \ln(2)$$

As the alphabet size $M$ increases from $M=8$ (FT8, 3 bits/symbol) to $M=16$ (z-30, 4 bits/symbol):
1. **Energy Efficiency per Bit Increases**: Each symbol carries $\log_2(16) = 4$ bits instead of $\log_2(8) = 3$ bits. The energy allocated per transmitted information bit is $E_b = \frac{E_s}{\log_2(M)}$.
2. **Noise Bandwidth per Filter Bin Halves**: The matched filter noise bandwidth for each tone is $B_n = \frac{1}{T_s} = 3.125\text{ Hz}$ in z-30, compared to $6.25\text{ Hz}$ in FT8.
3. **Predetection Processing Gain**:

$$\Delta G_{\text{predet}} = 10 \log_{10}\left(\frac{6.25\text{ Hz}}{3.125\text{ Hz}}\right) = +3.01\text{ dB}$$

Every tone filter bin in the z-30 receiver accumulates only half the thermal noise power ($N = N_0 \cdot \Delta f$) during symbol integration compared to FT8.

---

## 🛡️ 4. Forward Error Correction (FEC) & LDPC Coding Gain

Both FT8 and z-30 utilize Low-Density Parity-Check (LDPC) codes decoded via belief propagation over bipartite Tanner graphs. However, their code rates and graph structures differ fundamentally:

```
                              LDPC Code Rate & Redundancy
                              ===========================

  FT8: LDPC (174, 91)
  ┌───────────────────────────────┬───────────────────────────────┐
  │      Information: 91 bits     │       Parity: 83 bits         │  Rate R = 0.523 (47.7% Parity)
  └───────────────────────────────┴───────────────────────────────┘

  z-30: IRA-LDPC (216, 77)
  ┌─────────────────────┬─────────────────────────────────────────┐
  │ Information: 77 bits│            Parity: 139 bits             │  Rate R = 0.356 (64.4% Parity)
  └─────────────────────┴─────────────────────────────────────────┘
```

### 4.1 Mathematical Code Rate Advantage
- **FT8 Code Rate**: $R_{\text{FT8}} = \frac{91}{174} \approx 0.523$
- **z-30 Code Rate**: $R_{\text{z30}} = \frac{77}{216} \approx 0.356$

By operating at a significantly lower code rate ($R \approx 0.356$), z-30 provides **139 parity-check constraints** over 216 channel bits, compared to only 83 parity constraints in FT8.

### 4.2 Normalized Min-Sum Decoder Dynamics
The z-30 check node update equation uses an optimized empirical attenuation factor $\alpha = 0.75$:

$$L_{m \to n} = 0.75 \cdot \left(\prod_{n' \in N(m) \setminus \{n\}} \text{sgn}(L_{n' \to m})\right) \cdot \min_{n' \in N(m) \setminus \{n\}} |L_{n' \to m}|$$

Because of the higher parity redundancy ($64.4\%$ vs $47.7\%$), the Tanner graph possesses a larger girth ($g \ge 6$) and fewer short trapping sets, yielding:
- **Steeper Waterfall Region**: The Frame Error Rate (FER) transition from $10^{-1}$ to $10^{-5}$ occurs across a narrower $\Delta \text{SNR}$ span ($0.8\text{ dB}$ vs $1.6\text{ dB}$ in FT8).
- **Error Floor**: No error floor has been observed in benchmarking, but the benchmark runs tens of frames per SNR point, so it can only bound the floor at roughly $\text{FER} < 10^{-2}$. A $10^{-6}$ claim would need on the order of $10^{8}$ frames and has not been measured.
- **Net FEC Coding Gain**: Provides $+2.4\text{ dB}$ of additional coding gain over FT8's higher-rate LDPC code.

---

## 🔄 5. Multi-Pass Successive Interference Cancellation (SIC)

In real HF/VHF band conditions, receivers do not operate in isolated AWGN channels; they experience **dense multi-user interference and severe near-far dynamic range disparity**.

```
  Traditional FT8 Decoder:
  [ KW Station (+10 dB) ] ──┐
                            ├─> [ Overlapping 50Hz Bin ] ──> DECODE FAILURE (Both signals lost)
  [ DX Station (-25 dB) ] ──┘

  z-30 3-Pass SIC Decoder:
  [ Combined Input ] ──> [ PASS 1: Decode KW Station (+10 dB) ] (100% CRC verified)
                                 │
                         [ Synthesize clean replica s_KW(t) ]
                                 │
                         [ Subtract from buffer: x_res = x - s_KW ]
                                 │
                         [ PASS 2 / 3: Decode DX Station (-25 dB) ] ──> SUCCESS (DX contact logged!)
```

### 5.1 The Mathematical Near-Far Dilemma
When a strong local station ($P_{\text{local}} = +10\text{ dB}$) and a weak DX station ($P_{\text{DX}} = -25\text{ dB}$) overlap inside the same FFT bin:

$$\text{SINR}_{\text{DX}} = \frac{P_{\text{DX}}}{P_{\text{local}} + \sigma^2} \approx \frac{10^{-2.5}}{10^{1.0} + 10^{-2.95}} \approx \frac{0.00316}{10.0011} = -35.0\text{ dB}$$

Because $-35.0\text{ dB} \ll -21.0\text{ dB}$, FT8 completely fails to decode either transmission.

### 5.2 The 3-Pass Subtraction Mechanism in z-30
1. **Pass 1**: The high-SNR signal is decoded cleanly. The 14-bit CRC confirms with probability $1 - 2^{-14} \approx 0.99994$ that all 75 transmitted tones are known exactly.
2. **Exact Parameter Estimation**:
   - Carrier frequency $\hat{f}_0$ is estimated via chirped quadratic interpolation with precision $\sigma_f < 0.05\text{ Hz}$.
   - Time arrival $\hat{\Delta t}$ is locked with sub-millisecond precision.
   - Time-varying envelope amplitude $\hat{A}(t)$ and ionospheric phase trajectory $\hat{\phi}(t)$ are tracked across all 75 symbols.
3. **Continuous-Phase Synthesis & Coherent Cancellation**:

$$x_{\text{residual}}(t) = x_{\text{rx}}(t) - \hat{A}(t) \cos\left(2\pi \hat{f}_0 (t - \hat{\Delta t}) + \theta_{\text{mod}}(t) + \hat{\phi}(t)\right)$$

4. **Pass 2 & Pass 3**: The residual buffer $x_{\text{residual}}(t)$ is transformed through the STDFT filterbank. The unmasked DX signal at $-25\text{ dB SNR}$ is now isolated in an interference-free noise environment, at the same $-25.0\text{ dB}$ (50%) / $-24.0\text{ dB}$ (90%) AWGN decode floor the receiver already achieves on an uncontested channel, and decodes with the corresponding empirical success probability once the dominant interferer is cancelled.

---

## 🌊 6. Ionospheric Multipath, Flutter, & Doppler Dynamics

HF ionospheric skywave propagation (F2 layer reflection) is characterized by:
- **Doppler Spread ($B_d$)**: Frequency dispersion caused by traveling ionospheric disturbances (TID) or polar auroral flutter ($0.1\text{ Hz}$ to $2.0\text{ Hz}$).
- **Multipath Delay Spread ($\tau_d$)**: Differential path delays between 1-hop, 2-hop, or high/low ray angles ($0.5\text{ ms}$ to $4.0\text{ ms}$).
- **Coherence Time ($\tau_c \approx 1 / B_d$)**: Time window over which channel phase remains stationary ($0.5\text{ s}$ to $10.0\text{ s}$).

### 6.1 Why z-30 Resists Polar & Auroral Flutter
FT8 places its Costas synchronization arrays exclusively in three fixed clusters (beginning, middle, end: symbols 0-6, 36-42, 72-78). If an ionospheric deep fade or auroral phase step occurs during one of these clusters, FT8 loses time/frequency lock and the entire frame is lost.

**z-30 distributes 21 Costas synchronization symbols across 7 distinct triplets throughout the 75-symbol frame**:

```
Frame Index:  [0..2]   [7..9]   [17..19]   [27..29]   [37..39]   [47..49]   [72..74]
Sync Blocks:    S1       S2        S3         S4         S5         S6         S7
Data Blocks:       D1       D2        D3         D4         D5         D6
```

- **Continuous Phase Tracking**: Triplet spacing ($8$ to $10$ symbols $= 2.56\text{ s}$ to $3.20\text{ s}$) is matched to the coherence time ($\tau_c$) of disturbed polar ionospheric channels.
- **Dynamic Doppler Tracking**: The receiver tracks Doppler drift up to $\pm 1.5\text{ Hz}$ across the 24-second transmission window.

---

## 📻 7. Link Budget: What a dB of Sensitivity Buys, and What z-30 Can Claim

**z-30's on-air sensitivity has now been measured, and it is level with FT8 on AWGN - no
advantage is claimed.**

Earlier revisions of this page put z-30's idealised AWGN bound (a benchmark that hands the
demodulator the exact noise level, the exact carrier frequency and perfect symbol timing) next
to FT8's published over-the-air threshold, which *includes* the acquisition, AFC and timing
losses that bound excludes. The two are different quantities. Everything downstream of that
comparison - a "+4.0 dB advantage", a $2.51\times$ ERP multiplier, a QRP station matching 12.6 W
of FT8, an opening window extended by one to two hours - followed from it and has been
withdrawn.

What is defensible today:

- z-30 spends more energy per symbol (3.125 baud against FT8's 6.25) and more redundancy per
  information bit (rate 0.356 against 0.52), and both buy coding gain.
- Its seeded benchmark, driven through the real acquisition path with random carrier and
  timing offsets, crosses 50% decode at $-21.1\text{ dB}$ and 90% at $-18.0\text{ dB}$ on AWGN
  in a 2500 Hz reference bandwidth - level with FT8, measured the same way.
- Under ideal detection (exact carrier, timing and noise level) the same code reaches
  $-24.6\text{ dB}$. The $3.5\text{ dB}$ difference is what it costs to *find* the signal.
- The coding gain is real, but z-30 spends it twice: once on the code, and again on acquiring
  a signal whose tones are only 3.125 Hz apart. Net, it lands where FT8 does.

### 7.1 How the honest measurement is made

`z30_dsp/benchmark.py --mode realistic` is no longer genie-aided:

1. A random carrier frequency offset ($\pm5$ Hz) is injected (`z30_dsp/channel.py`).
2. A random symbol timing offset ($\pm0.5$ s) is injected - slot alignment is never exact.
3. A Watterson two-path fading channel is applied, with CCIR 520-2 Doppler and delay spreads
   for the *good*, *moderate* and *poor* path classes.
4. The decode is driven through the **real acquisition path** (`z30_dsp/acquisition.py`): a
   Costas sync search over time and frequency, plus a blind noise-floor estimate. Nothing is
   handed to the demodulator.
5. Every run is seeded, and the seed is published with the curve.

Measured result, seed `20260830`, 40 frames per SNR point:

| Channel | 50% decode | 90% decode |
| --- | --- | --- |
| Idealised bound (genie-aided sync) | $-24.6\text{ dB}$ | $-23.4\text{ dB}$ |
| AWGN, blind acquisition | $-21.1\text{ dB}$ | $-18.0\text{ dB}$ |
| CCIR moderate (1.0 ms / 0.5 Hz) | $-18.8\text{ dB}$ | $-14.0\text{ dB}$ |
| CCIR poor (2.0 ms / 1.0 Hz) | $-15.4\text{ dB}$ | above $-11\text{ dB}$ |

`tests/test_channel_acquisition.py` guards the property that makes this measurement meaningful:
that acquisition reads only the audio, and is never quietly handed the answer again.

### 7.2 For reference: what a dB is worth

Independent of any z-30 claim, a $\Delta$ dB improvement in sensitivity corresponds to a power
ratio of

$$\frac{P_1}{P_2} = 10^{\Delta / 10}$$

so $+3\text{ dB}$ halves the power a station needs, and $+4\text{ dB}$ is roughly the gain of a
small 2-element Yagi over a dipole, or about 0.7 S-units of background noise on the low bands.
This is why weak-signal work chases single decibels - and why the $4\text{ dB}$ this page once
claimed, on a comparison that did not hold, was worth retracting rather than defending.

---

## 📊 8. Summary Comparison Matrix

```
   Sensitivity (SNR in 2500 Hz BW)
   ─────────────────────────────────────────────────────────────────────────────
   CW (Skilled Ear):                 -15.0 dB ──┐
   SSB Voice:                        +10.0 dB   │
   RTTY:                              -5.0 dB   │ Legacy Modes
   ─────────────────────────────────────────────────────────────────────────────
   FT4:                              -17.5 dB ──┐
   FT8:                              -21.0 dB   │ Modern WSJT-X
   JS8Call (Slow):                   -24.0 dB   │ Modes
   WSPR (2-Minute Beacon Only):      -28.0 dB ──┘
   ─────────────────────────────────────────────────────────────────────────────
   z-30 (blind acquisition, AWGN):   -21.1 dB ◄── measured the same way as the rows above
   z-30 (idealised bound, genie sync):-24.6 dB ◄── NOT measured the same way; do not compare
   ─────────────────────────────────────────────────────────────────────────────
   Theoretical Shannon Capacity:     -30.5 dB
```

Every figure above the divider is an over-the-air threshold, and z-30's blind-acquisition
figure belongs on that same scale: it is measured the same way, and it lands level with FT8.
The idealised bound below it does **not** belong on this scale - it is an upper limit on what
the code and demodulator could achieve if acquisition were free, and every mode listed above
would move a few dB left if measured that way too.

What z-30 does offer, independently of any sensitivity claim, is full two-way interactive QSO
sequencing at 50 Hz occupied bandwidth, real-time successive interference cancellation, and
cross-platform hardware CAT integration.
