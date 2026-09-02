<div align="center">

# z-30

**An experimental amateur radio digital mode for weak-signal HF, VHF and microwave contacts —
open-source, cross-platform, and built for operators who want to see how it works.**

16-tone FSK · 50 Hz occupied bandwidth · 30-second UTC cycles · rate-0.356 LDPC · 3-pass
interference cancellation
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

## What is z-30?

z-30 is a weak-signal digital mode for amateur radio, in the same family as FT8 and JS8Call, plus
the software that runs it. Each transmission packs a 77-bit QSO exchange (callsigns, grid square,
report) into a 24-second, 50 Hz-wide, continuous-phase 16-tone FSK frame, protects it with a
rate-0.356 LDPC code and a 14-bit CRC, and — where two stations land on the same frequency at the
same time — pulls them apart with up to three passes of successive interference cancellation
(SIC).

It ships as two implementations of one specification, kept in lock-step by a shared test suite:

- An **interactive Web/PWA transceiver** — 60 FPS waterfall, Web Audio DSP, live S-meter, and a
  logbook that exports ADIF, Cabrillo, JSON, CSV or SQLite. Runs in a browser or installs as an
  offline app.
- A **native Python 3 package** (`z30_dsp`) — Hamlib CAT control, nine PTT keying methods, six
  auto-reply strategies, and RF clock calibration against WWV, WWVH, CHU, DCF77, MSF, WWVB and
  JJY, with no internet connection required.

> **This README is the front page.** Every specification, procedure and measurement lives in
> **[the wiki](wiki/Home.md)**, which is the project's source of truth and is also served inside
> the app itself. If this page and a wiki page disagree, the wiki is right.

New to digital modes or to z-30? **[01. New User Guide & First Steps](wiki/01-New-User-Guide-&-First-Steps.md)**
walks through the setup wizard, audio levels, time sync and your first contact in order.

---

## Why z-30

- **Deep weak-signal decoding.** -23.1 dB SNR at 50% decode probability on AWGN — see
  [the honest numbers below](#about-that-sensitivity-figure) for exactly what that does and does
  not mean next to other modes.
- **Narrow enough to pack a band.** 50.0 Hz nominal occupied bandwidth (49.8 Hz measured), so many
  signals fit in the space one SSB voice contact would use.
- **Recovers collisions, not just clean signals.** Three-pass SIC decodes co-channel stations that
  a single-pass receiver would drop entirely.
- **Runs anywhere.** The same protocol on a phone browser (PWA, works offline once installed) and
  on a Raspberry Pi with no GUI at all.
- **No internet required to run correctly.** UTC time sync can come from your OS's NTP client, or
  from the built-in RF receiver that reads WWV, WWVH, CHU, DCF77, MSF, WWVB or JJY off the air.
- **Talks to your existing rig.** Hamlib CAT control plus nine PTT keying methods (CAT command,
  RTS/DTR, audio-tone VOX, CM108/CM119 GPIO, Raspberry Pi GPIO, and more) — see
  [06. Transceiver CAT Control & PTT Wiring](wiki/06-Transceiver-CAT-Control-&-PTT-Wiring.md).
- **Open source, fully specified.** Every constant, every threshold and every measurement in this
  README is backed by a page in [the wiki](wiki/Home.md) and, where it's a number, a seeded,
  reproducible benchmark.

<details>
<summary><strong>New to the jargon? MFSK, LDPC and SIC in plain terms</strong></summary>

- **MFSK (multiple frequency-shift keying)** — instead of one tone per bit, z-30 sends one of 16
  tones per symbol, at a fixed cadence, without any amplitude change. That's what keeps the
  signal narrow and lets a receiver find it deep in the noise.
- **LDPC (low-density parity-check code)** — the forward error correction wrapped around the
  message. It adds redundant bits so the receiver can reconstruct the original 77 bits even when
  many of the received symbols were corrupted by noise.
- **SIC (successive interference cancellation)** — when two stations transmit on the same
  frequency in the same slot, the receiver decodes whichever one it can, synthesises that
  station's exact waveform, subtracts it from the recording, and tries again on what's left —
  up to three times.
</details>

---

## 📊 At a glance

| | |
| :--- | :--- |
| **Modulation** | 16-MFSK, continuous phase, Gaussian frequency-pulse shaped ($BT = 2.0$) |
| **Occupied bandwidth** | 50.0 Hz nominal — **49.8 Hz measured** at 99% occupancy, 66 Hz at -40 dB |
| **Cycle** | 30.0 s UTC slots · 24.0 s active TX (75 symbols) · 6.0 s decode + guard |
| **FEC** | IRA-LDPC (216, 77), rate ≈ 0.356, with CRC-14 |
| **Decode threshold (AWGN, blind acquisition)** | **-23.1 dB SNR at 50%**, -21.7 dB at 90% (2500 Hz reference) |
| **Decode threshold (CCIR moderate fading)** | -21.3 dB at 50% |
| **Collision recovery** | 3-pass successive interference cancellation |
| **Platforms** | Android (PWA & Termux), Ubuntu/Debian, Arch, Windows 10/11, Raspberry Pi, generic Linux |

### About that sensitivity figure

-23.1 dB is measured the way other modes publish theirs: random carrier offset, random timing
offset, non-coherent demodulation, and a receiver handed nothing but audio, which finds the
frame and estimates the noise floor itself. **On AWGN that is 2.1 dB deeper than FT8's published
-21.0 dB — and z-30 transmits for 24.0 s against FT8's 12.64 s, which is 2.8 dB more energy, to
carry 14 fewer message bits.** So it buys depth with airtime, not with a more efficient code;
per second on the air it is marginally behind FT8. Both halves of that belong in any quote of
the number.

An earlier version of this project claimed a "+4.0 dB advantage" by comparing its own
genie-aided bound against FT8's on-air number; that claim stays withdrawn, and the 2.1 dB above
is not a revival of it — it is blind-acquisition on both sides. The genie-aided bound (-24.6 dB)
is still reported, but separately, because 1.5 dB of it is simply the cost of *finding* the
signal.

Where z-30 also differs is occupied bandwidth, multi-pass SIC, and behaviour on a disturbed
path. The full curves, the seeds, and the commands to reproduce them are in
**[16. Benchmarking, Testing & CI](wiki/16-Benchmarking-Testing-&-CI.md)**.

---

## 🚀 Quick start

Pick your platform below for the fastest path to a running install. Full, per-platform
instructions — including PKGBUILD, PyInstaller `.exe`, Termux field deployment and DigiPi — are
in **[09. Cross-Platform Build & Packaging](wiki/09-Cross-Platform-Build-&-Packaging.md)**.

<details open>
<summary><strong>🐧 Linux — Ubuntu / Debian / Mint / Pop!_OS / Raspberry Pi OS</strong></summary>

```bash
git clone https://github.com/themantas1994/z-30.git && cd z-30
chmod +x install_ubuntu.sh && ./install_ubuntu.sh
z30
```
</details>

<details>
<summary><strong>🐧 Linux — Arch / Manjaro / EndeavourOS / CachyOS</strong></summary>

```bash
git clone https://github.com/themantas1994/z-30.git && cd z-30
chmod +x install_arch.sh && ./install_arch.sh     # or: makepkg -si
z30
```
</details>

<details>
<summary><strong>🪟 Windows 10 / 11</strong></summary>

1. Install Python 3.9+ and tick **Add python.exe to PATH** during setup.
2. Clone the repository.
3. Double-click `run_windows.bat`.
</details>

<details>
<summary><strong>📱 Android</strong></summary>

Install the PWA from your browser's menu (**Install app**) — the site must be served over HTTPS
or from `localhost`. For CLI and DSP tools only, `install_android_termux.sh` under Termux works,
but Android exposes no audio devices to Termux, so it can't act as a transceiver there.
</details>

<details>
<summary><strong>⚙️ Any platform, from source</strong></summary>

```bash
pip install -r requirements.txt
npm install && npm run build
python3 -m z30_dsp.main
```
</details>

Once it's running, work through
**[01. New User Guide & First Steps](wiki/01-New-User-Guide-&-First-Steps.md)**:
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
| [04. Forward Error Correction & LDPC](wiki/04-Forward-Error-Correction-&-LDPC.md) | Message packing, CRC-14, (216, 77) code, four-schedule min-sum/SPA decoding |
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
| [17. A Priori (AP) Decoding](wiki/17-A-Priori-(AP)-Decoding.md) | Constraining the decode with what the QSO state already implies, ported from WSJT-X |

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
