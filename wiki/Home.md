# z-30 GitHub Wiki

Welcome to the official technical documentation and developer wiki for **z-30**: an experimental open-source amateur radio 16-MFSK weak-signal digital transceiver and digital signal processing (DSP) suite.

---

## 🧭 Navigation Matrix

| 👤 I am a... | 🚀 Start Here | 📖 Key Documents |
| :--- | :--- | :--- |
| **New Ham Operator / User** | [Getting Started & First Steps](01-New-User-Guide-&-First-Steps.md) | [CAT & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md), [Time Synchronization](07-RF-Time-Synchronization-Engine.md), [Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md) |
| **DSP / Protocol Developer** | [Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md) | [Physics & FT8 Comparison](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md), [DSP & Physical Layer Specs](03-DSP-&-Physical-Layer-Specification.md), [LDPC FEC](04-Forward-Error-Correction-&-LDPC.md), [SIC Co-Channel Engine](05-Successive-Interference-Cancellation-(SIC).md) |
| **Advanced Ham / RF Engineer** | [Physics & FT8 Comparison](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) | [DSP Specs](03-DSP-&-Physical-Layer-Specification.md), [SIC Engine](05-Successive-Interference-Cancellation-(SIC).md), [RF Time Sync](07-RF-Time-Synchronization-Engine.md) |
| **Hardware & Rig Integrator** | [CAT & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md) | [Hamlib Setup](06-Transceiver-CAT-Control-&-PTT-Wiring.md), [Raspberry Pi / DigiPi](09-Cross-Platform-Build-&-Packaging.md), [RF Time Sync](07-RF-Time-Synchronization-Engine.md) |
| **Frontend / Web Developer** | [Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md) | [Web & PWA Architecture](08-Web-&-PWA-Architecture.md), [Cross-Platform Packaging](09-Cross-Platform-Build-&-Packaging.md) |

---

## ⚡ What is z-30?

**z-30** is engineered for extreme HF, VHF, and microwave weak-signal amateur radio communications. Operating in synchronous **30.0-second UTC slots**, z-30's seeded benchmark - run through its real acquisition path, with random carrier and timing offsets and no knowledge of the noise level - crosses 50% decode at **-21.1 dB SNR** on AWGN and **-18.8 dB** on a CCIR-moderate fading path, in a 2500 Hz reference bandwidth. That is level with FT8's published -21 dB, measured the same way. The genie-aided bound, with exact carrier, timing and noise level handed to the demodulator, is 3.5 dB better at -24.6 dB; it is reported separately because no other mode's published figure is measured that way.

### Key Technical Innovations
1. **Ultra-Narrowband 16-MFSK**: Continuous-Phase 16-Tone Frequency Shift Keying occupying only **50.0 Hz** of RF bandwidth.
2. **Rate-0.356 IRA-LDPC + CRC-14**: Systematic (216, 77) irregular repeat-accumulate Low-Density Parity-Check forward error correction with a dual-diagonal parity structure, plus a 14-bit CRC whose undetected-error probability is $2^{-14} \approx 6.1 \times 10^{-5}$. (Earlier revisions called the code quasi-cyclic, which it is not, and quoted $< 10^{-6}$ for the CRC, which is about sixty times better than a 14-bit CRC can be.)
3. **Multi-Pass Successive Interference Cancellation (SIC)**: 3-pass DSP cancellation engine that synthesizes and subtracts strong decoded carrier waveforms to recover hidden co-channel DX signals.
4. **Sub-Millisecond RF Time Calibration (`z30_dsp/rf_time_sync.py`)**: Embedded FIR matched-filter receiver that calibrates clock drift ($\Delta t$) against global standard stations (**WWV, WWVH, CHU, DCF77, MSF, WWVB, JJY**) without needing internet or administrator privileges.
5. **Universal Cross-Platform Architecture**: Dual-stack engine featuring an interactive Web Audio 60 FPS HTML5/PWA GUI and a native Python 3 DSP package (`z30_dsp`) with Hamlib CAT and 9 PTT keying methods.

---

## 📚 Complete Wiki Table of Contents

1. [01. New User Guide & First Steps](01-New-User-Guide-&-First-Steps.md)
2. [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md)
3. [03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md)
4. [04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md)
5. [05. Successive Interference Cancellation (SIC)](05-Successive-Interference-Cancellation-(SIC).md)
6. [06. Transceiver CAT Control & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md)
7. [07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md)
8. [08. Web & PWA Architecture](08-Web-&-PWA-Architecture.md)
9. [09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md)
10. [10. Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md)
11. [11. Physics & Comparative Analysis: z-30 vs. FT8](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md)

---

## 🤝 Community & Support

- **GitHub Repository**: [https://github.com/themantas1994/z-30](https://github.com/themantas1994/z-30)
- **Issue Tracker**: Bug reports, feature suggestions, and hardware test reports.
- **License**: Distributed under the permissive [MIT License](../README.md#contributing--license).
