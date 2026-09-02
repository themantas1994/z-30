# z-30 Wiki — The Source of Truth

Welcome to the technical documentation for **z-30**: an experimental open-source amateur radio
16-MFSK weak-signal digital transceiver and DSP suite.

> **This wiki is the project's source of truth.** Protocol specifications, install procedures,
> operating reference, safety behaviour, measured figures and developer process all live here
> and are maintained here. The repository `README.md` is a front page that introduces z-30 and
> links back to these pages; where the two ever disagree, **the wiki is correct and the README
> is the bug**.
>
> The same markdown is served inside the application itself (the **Wiki** button in the header)
> — it is generated from these files at build time, so the in-app copy cannot drift from what
> the repository says.

---

## 🧭 Navigation Matrix

| 👤 I am a... | 🚀 Start here | 📖 Key documents |
| :--- | :--- | :--- |
| **New ham operator / user** | [Getting Started & First Steps](01-New-User-Guide-&-First-Steps.md) | [Operating Reference](14-User-Interface-&-Operation-Reference.md), [CAT & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md), [Time Synchronization](07-RF-Time-Synchronization-Engine.md), [Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md) |
| **Operator about to transmit** | [Operating Safety & Compliance](13-Operating-Safety-Compliance-&-Security.md) | [Operating Reference](14-User-Interface-&-Operation-Reference.md), [Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md) |
| **DSP / protocol developer** | [Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md) | [DSP & Physical Layer Specs](03-DSP-&-Physical-Layer-Specification.md), [LDPC FEC](04-Forward-Error-Correction-&-LDPC.md), [SIC Engine](05-Successive-Interference-Cancellation-(SIC).md), [AP Decoding](17-A-Priori-(AP)-Decoding.md), [Benchmarking & CI](16-Benchmarking-Testing-&-CI.md) |
| **Advanced ham / RF engineer** | [Physics & FT8 Comparison](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) | [DSP Specs](03-DSP-&-Physical-Layer-Specification.md), [SIC Engine](05-Successive-Interference-Cancellation-(SIC).md), [Benchmarking & CI](16-Benchmarking-Testing-&-CI.md) |
| **Hardware & rig integrator** | [CAT & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md) | [Raspberry Pi / DigiPi](09-Cross-Platform-Build-&-Packaging.md), [RF Time Sync](07-RF-Time-Synchronization-Engine.md), [CLI & Configuration](15-Command-Line-Tools-&-Configuration.md) |
| **Frontend / web developer** | [Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md) | [Web & PWA Architecture](08-Web-&-PWA-Architecture.md), [Cross-Platform Packaging](09-Cross-Platform-Build-&-Packaging.md) |
| **Coding assistant / LLM** | `AGENTS.md` in the repository root | [Developer Setup](02-Developer-Setup-&-Contributing.md), [Operating Safety](13-Operating-Safety-Compliance-&-Security.md), [Benchmarking & CI](16-Benchmarking-Testing-&-CI.md) |

---

## ⚡ What is z-30?

**z-30** is engineered for extreme HF, VHF, and microwave weak-signal amateur radio
communications. It operates in synchronous **30.0-second UTC slots**, occupies **50.0 Hz**, and
carries a 63-bit message plus a 14-bit CRC behind a rate-0.356 LDPC code.

Its seeded benchmark — run through the real acquisition path, with random carrier and timing
offsets, no knowledge of the noise level and non-coherent demodulation — crosses 50% decode at
**-23.1 dB SNR** on AWGN and **-21.3 dB** on a CCIR-moderate fading path, in a 2500 Hz
reference bandwidth. **That is 2.1 dB deeper than FT8's published -21 dB, measured the same
way — and it costs 24.0 s of airtime against FT8's 12.64 s (2.8 dB more energy) for 14 fewer
message bits, so z-30 buys depth with time rather than with a more efficient code.** The
genie-aided bound, with exact carrier, timing and noise level handed to the demodulator, is
1.5 dB better again at -24.6 dB; it is reported separately because no other mode's published
figure is measured that way. See
[16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md).

### Key technical innovations

1. **Ultra-narrowband 16-MFSK**: continuous-phase 16-tone FSK with Gaussian frequency-pulse
   shaping ($BT = 2.0$), occupying **50.0 Hz** (49.8 Hz measured at 99% occupancy).
2. **Rate-0.356 IRA-LDPC + CRC-14**: systematic (216, 77) irregular repeat-accumulate code with
   a dual-diagonal parity structure, plus a 14-bit CRC whose undetected-error probability is
   $2^{-14} \approx 6.1 \times 10^{-5}$. (Earlier revisions called the code quasi-cyclic, which
   it is not, and quoted $< 10^{-6}$ for the CRC, which is about sixty times better than a
   14-bit CRC can be.)
3. **Multi-pass Successive Interference Cancellation**: a 3-pass engine that synthesises and
   subtracts strong decoded carriers to recover hidden co-channel DX signals.
4. **Sub-millisecond RF time calibration** (`z30_dsp/rf_time_sync.py`): an FIR matched-filter
   receiver that calibrates clock drift against global standard stations (**WWV, WWVH, CHU,
   DCF77, MSF, WWVB, JJY**) without internet or administrator privileges.
5. **Universal cross-platform architecture**: an interactive Web Audio 60 FPS HTML5/PWA GUI and
   a native Python 3 DSP package (`z30_dsp`) with Hamlib CAT and 9 PTT keying methods.

---

## 📚 Complete Wiki Table of Contents

### Getting started & operating
1. [01. New User Guide & First Steps](01-New-User-Guide-&-First-Steps.md)
2. [10. Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md)
3. [13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md)
4. [14. User Interface & Operation Reference](14-User-Interface-&-Operation-Reference.md)

### Protocol & DSP core
5. [03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md)
6. [04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md)
7. [05. Successive Interference Cancellation (SIC)](05-Successive-Interference-Cancellation-(SIC).md)
8. [17. A Priori (AP) Decoding](17-A-Priori-(AP)-Decoding.md)
9. [11. Physics & Comparative Analysis: z-30 vs. FT8](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md)

### Hardware & rig control
10. [06. Transceiver CAT Control & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md)
11. [07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md)

### Development, build & packaging
12. [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md)
13. [08. Web & PWA Architecture](08-Web-&-PWA-Architecture.md)
14. [09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md)
15. [12. Software Updates & GitHub Sync](12-Software-Updates-&-GitHub-Sync.md)
16. [15. Command-Line Tools & Configuration](15-Command-Line-Tools-&-Configuration.md)
17. [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md)

---

## ✍️ Editing this wiki

These pages are files in the repository under `wiki/`, not a separately hosted GitHub wiki, so
they are edited by pull request like any other change.

- Edit the markdown under `wiki/`.
- Run `npm run generate:wiki` and commit the regenerated `src/data/wikiArticles.ts`; CI fails
  the build if the in-app copy is stale.
- Adding a page also means registering it in `scripts/generate_wiki_articles.mjs` and adding it
  to this page and to `_Sidebar.md`.

The full policy — including which content belongs in the README and which belongs here — is in
[02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md).

---

## 🤝 Community & Support

- **GitHub repository**: [https://github.com/themantas1994/z-30](https://github.com/themantas1994/z-30)
- **Issue tracker**: bug reports, feature suggestions, and hardware test reports.
- **License**: distributed under the permissive [MIT License](../LICENSE).
