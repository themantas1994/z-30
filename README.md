<div align="center">

# z-30

**An experimental amateur radio 16-MFSK weak-signal digital transceiver & DSP suite.**

50 Hz occupied bandwidth · 30-second UTC cycles · rate-0.356 LDPC · 3-pass interference cancellation
Web/PWA transceiver + native Python DSP package · Hamlib CAT · 9 PTT keying methods

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![Platform](https://img.shields.io/badge/platform-Android%20|%20Ubuntu%20|%20Arch%20|%20Windows%20|%20Linux%20|%20Raspberry%20Pi-brightgreen.svg)]()
[![Radio Mode](https://img.shields.io/badge/mode-16--MFSK%20|%20LDPC--SIC%20|%2030s%20Cycle-orange.svg)]()
[![PWA Ready](https://img.shields.io/badge/PWA-Installable%20Offline-blueviolet.svg)]()
[![Status](https://img.shields.io/badge/status-experimental%20(alpha)-red.svg)]()

### 📖 **[The wiki is the documentation.](wiki/Home.md)** &nbsp;·&nbsp; [Install](wiki/09-Cross-Platform-Build-&-Packaging.md) &nbsp;·&nbsp; [First QSO](wiki/01-New-User-Guide-&-First-Steps.md) &nbsp;·&nbsp; [Before you transmit](wiki/13-Operating-Safety-Compliance-&-Security.md)

</div>

---

z-30 packs a 77-bit QSO exchange into a 24-second, 50 Hz-wide continuous-phase 16-tone FSK
frame, protects it with a rate-0.356 irregular repeat-accumulate LDPC code and a 14-bit CRC,
and pulls colliding stations apart with three passes of successive interference cancellation.

It ships as two halves of the same specification: an **interactive Web/PWA transceiver** (60 FPS
waterfall, Web Audio DSP, live S-meter, ADIF logbook) and a **native Python 3 package**
(`z30_dsp`) with Hamlib CAT control, nine PTT keying methods, six auto-reply strategies, and RF
clock calibration against WWV, CHU, DCF77, MSF, WWVB and JJY — no internet required.

> **This README is the front page.** Every specification, procedure and measurement lives in
> **[the wiki](wiki/Home.md)**, which is the project's source of truth and is also served inside
> the app itself. If this page and a wiki page disagree, the wiki is right.

---

## 📊 At a glance

| | |
| :--- | :--- |
| **Modulation** | 16-MFSK, continuous phase, Gaussian frequency-pulse shaped ($BT = 2.0$) |
| **Occupied bandwidth** | 50.0 Hz nominal — **49.8 Hz measured** at 99% occupancy, 66 Hz at -40 dB |
| **Cycle** | 30.0 s UTC slots · 24.0 s active TX (75 symbols) · 6.0 s decode + guard |
| **FEC** | IRA-LDPC (216, 77), rate ≈ 0.356, with CRC-14 |
| **Decode threshold (AWGN, blind acquisition)** | **-21.1 dB SNR at 50%**, -18.0 dB at 90% (2500 Hz reference) |
| **Decode threshold (CCIR moderate fading)** | -18.8 dB at 50% |
| **Collision recovery** | 3-pass successive interference cancellation |
| **Platforms** | Android (PWA & Termux), Ubuntu/Debian, Arch, Windows 10/11, Raspberry Pi, generic Linux |

### About that sensitivity figure

-21.1 dB is measured the way other modes publish theirs: random carrier offset, random timing
offset, and a receiver handed nothing but audio, which finds the frame and estimates the noise
floor itself. **On AWGN that puts z-30 level with FT8, not ahead of it.** An earlier version of
this project claimed a "+4.0 dB advantage" by comparing its own genie-aided bound against FT8's
on-air number; that claim was withdrawn. The genie-aided bound (-24.6 dB) is still reported, but
separately, because 3.5 dB of it is simply the cost of *finding* the signal.

Where z-30 does differ is occupied bandwidth, multi-pass SIC, and behaviour on a disturbed path.
The full curves, the seeds, and the commands to reproduce them are in
**[16. Benchmarking, Testing & CI](wiki/16-Benchmarking-Testing-&-CI.md)**.

---

## 🚀 Quick start

Full, per-platform instructions — including PKGBUILD, PyInstaller `.exe`, Termux field
deployment and DigiPi — are in
**[09. Cross-Platform Build & Packaging](wiki/09-Cross-Platform-Build-&-Packaging.md)**.

**Linux (Ubuntu / Debian / Mint / Pop!\_OS / Raspberry Pi OS)**
```bash
git clone https://github.com/themantas1994/z-30.git && cd z-30
chmod +x install_ubuntu.sh && ./install_ubuntu.sh
z30
```

**Arch Linux / Manjaro / EndeavourOS / CachyOS**
```bash
git clone https://github.com/themantas1994/z-30.git && cd z-30
chmod +x install_arch.sh && ./install_arch.sh     # or: makepkg -si
z30
```

**Windows 10 / 11** — install Python 3.9+ with *Add python.exe to PATH*, clone the repository,
then double-click `run_windows.bat`.

**Android** — install the PWA from the browser menu (*Install app*), or run
`install_android_termux.sh` under Termux for USB-OTG audio and CAT in the field.

**Any platform, from source**
```bash
pip install -r requirements.txt
npm install && npm run build
python3 -m z30_dsp.main
```

Then work through **[01. New User Guide & First Steps](wiki/01-New-User-Guide-&-First-Steps.md)**:
setup wizard → audio levels → time sync → first QSO.

---

## ⚠️ Before you key a transmitter

z-30 keys real radios over serial, CM108, GPIO and VOX. Four things are worth knowing before
you do, and all four are covered in
**[13. Operating Safety, Compliance & Local Security](wiki/13-Operating-Safety-Compliance-&-Security.md)**:

- **The transmit gate fails closed.** No valid non-placeholder callsign, no regulatory region
  and licence class, or a dial-plus-audio frequency outside a segment your class holds, and
  nothing is radiated. The refusal names the condition.
- **Three independent stuck-transmitter layers**: a 40 s browser-side ceiling, a server-side
  dead-man switch on the GPIO line, and signal handlers that release every pin on exit.
- **The local API is authenticated.** Loopback is not an authentication boundary, so every
  `/api/` request needs a per-start bearer token plus matching `Origin` and `Host`.
- **Your ALC is still your problem.** Capture your transmitter's actual output on a spectrum
  analyser before going on the air — clipping and ALC re-broaden a clean signal.

z-30 is an experimental mode and is not coordinated with any band plan authority.

---

## 📚 Documentation

| Page | What it covers |
| :--- | :--- |
| [Wiki Home](wiki/Home.md) | Index, navigation matrix, project overview |
| [01. New User Guide & First Steps](wiki/01-New-User-Guide-&-First-Steps.md) | Wizard, audio levels, time sync, first QSO |
| [02. Developer Setup & Contributing](wiki/02-Developer-Setup-&-Contributing.md) | Environments, architecture, docs policy, PR checklist |
| [03. DSP & Physical Layer Specification](wiki/03-DSP-&-Physical-Layer-Specification.md) | Signal chain, waveform maths, Costas sync, slot timing |
| [04. Forward Error Correction & LDPC](wiki/04-Forward-Error-Correction-&-LDPC.md) | Message packing, CRC-14, (216, 77) code, min-sum decoding |
| [05. Successive Interference Cancellation](wiki/05-Successive-Interference-Cancellation-(SIC).md) | The 3-pass co-channel recovery engine |
| [06. Transceiver CAT Control & PTT Wiring](wiki/06-Transceiver-CAT-Control-&-PTT-Wiring.md) | `rigctld`, wiring diagrams for all 9 keying methods |
| [07. RF Time Synchronization Engine](wiki/07-RF-Time-Synchronization-Engine.md) | WWV/CHU/DCF77/MSF/WWVB/JJY calibration without NTP |
| [08. Web & PWA Architecture](wiki/08-Web-&-PWA-Architecture.md) | React 19, Web Audio pipeline, canvas waterfall, service worker |
| [09. Cross-Platform Build & Packaging](wiki/09-Cross-Platform-Build-&-Packaging.md) | Every install and packaging path |
| [10. Troubleshooting & FAQ](wiki/10-Troubleshooting-&-FAQ.md) | No decodes, ALC, serial permissions, PTT, clock offset |
| [11. Physics & Comparative Analysis](wiki/11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) | Shannon limits, mode comparison table, what z-30 can honestly claim |
| [12. Software Updates & GitHub Sync](wiki/12-Software-Updates-&-GitHub-Sync.md) | Update channels per platform |
| [13. Operating Safety & Compliance](wiki/13-Operating-Safety-Compliance-&-Security.md) | Transmit gate, TX watchdogs, API auth, clock and logbook handling |
| [14. UI & Operation Reference](wiki/14-User-Interface-&-Operation-Reference.md) | Waterfall, QSO macros, auto-reply, band manager, logbook |
| [15. Command-Line Tools & Configuration](wiki/15-Command-Line-Tools-&-Configuration.md) | `z30` subcommands, file locations, environment variables |
| [16. Benchmarking, Testing & CI](wiki/16-Benchmarking-Testing-&-CI.md) | Both benchmark modes, measured curves, test suite, CI checks |

Working on z-30 with a coding assistant? **[`AGENTS.md`](AGENTS.md)** is the architecture,
invariants and house rules on one page.

---

## 🛠️ Development

```bash
pip install -r requirements.txt pytest && python -m pytest tests -v   # Python DSP suite
npm ci && npm run lint && npm run test:ts                             # Typecheck + TS tests
npm run build                                                         # Production web bundle
python -m z30_dsp.benchmark --mode realistic --frames 40              # Decode threshold
```

The repository holds two implementations of one specification — `z30_dsp/` (Python/NumPy) and
`src/dsp/` (TypeScript/Web Audio) — plus `src/components/` for the UI, `wiki/` for the
documentation, and `tests/` for the suite that keeps the two stacks bit-compatible.

Two files under `src/data/` are generated from the Python sources and the wiki markdown; run
`npm run generate` after editing either, or CI will tell you. Setup, architecture, conventions
and the pull request checklist are in
**[02. Developer Setup & Contributing](wiki/02-Developer-Setup-&-Contributing.md)**.

---

## 🤝 Contributing & licence

Contributions, bug reports and hardware test reports are welcome — whether you are optimising
LDPC decoding kernels, testing a new rig, or fixing a wrong number in the wiki. Start with
[02. Developer Setup & Contributing](wiki/02-Developer-Setup-&-Contributing.md), and open an
issue or a pull request.

Distributed under the **MIT Licence**. See [`LICENSE`](LICENSE).

---

<div align="center">

*73 — z-30 is experimental software. Verify your signal before you trust it on the air.*

</div>
