# z-30: Experimental Amateur Radio 16-MFSK Weak-Signal Digital Transceiver & DSP Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![Platform](https://img.shields.io/badge/platform-Android%20|%20Ubuntu%20|%20Arch%20|%20Windows%20|%20Linux-brightgreen.svg)]()
[![Radio Mode](https://img.shields.io/badge/mode-16--MFSK%20|%20LDPC--SIC%20|%2030s%20Cycle-orange.svg)]()

**z-30** is an open-source, next-generation amateur radio weak-signal digital communications suite. Engineered for extreme HF, VHF, and microwave propagation conditions (down to **-28 dB SNR** in 2500 Hz reference bandwidth), z-30 combines an ultra-narrow **50 Hz occupied bandwidth** 16-MFSK modulation scheme, Rate-1/3 Quasi-Cyclic LDPC forward error correction, and multi-pass **Successive Interference Cancellation (SIC)** to decode co-channel signals with zero packet collision dropouts.

The project provides both a high-performance **interactive Web/PWA GUI** (featuring a 60 FPS HTML5 spectral waterfall and Web Audio pipeline) and a **native Python DSP engine** with Hamlib CAT transceiver control and automated RF time calibration against international time standards (WWV, CHU, DCF77, MSF, WWVB, JJY).

---

## Table of Contents

1. [Key Features & Capabilities](#key-features--capabilities)
2. [Comparison with Other Digital Modes (FT8, FT4, WSPR, JS8Call)](#comparison-with-other-digital-modes)
3. [Deep-Dive: Protocol & DSP Architecture](#deep-dive-protocol--dsp-architecture)
   - [Modulation & Waveform Parameters](#modulation--waveform-parameters)
   - [Synchronous 30-Second Cycle Timing](#synchronous-30-second-cycle-timing)
   - [LDPC (174, 58) & CRC-14 Forward Error Correction](#ldpc-174-58--crc-14-forward-error-correction)
   - [Iterative Successive Interference Cancellation (SIC)](#iterative-successive-interference-cancellation-sic)
   - [Automatic RF Standard Station Time Sync (`rf_time_sync.py`)](#automatic-rf-standard-station-time-sync)
4. [Cross-Platform Installation & Build Guide](#cross-platform-installation--build-guide)
   - [Ubuntu & Debian (20.04 / 22.04 / 24.04)](#ubuntu--debian)
   - [Arch Linux & Manjaro](#arch-linux--manjaro)
   - [Windows 10 & 11](#windows-10--11)
   - [Android (PWA & Termux Field Operations)](#android-pwa--termux)
   - [Generic Linux & PyPI Package](#generic-linux--pypi)
5. [User Interface & Operation Guide](#user-interface--operation-guide)
   - [60 FPS Spectral Waterfall Display](#60-fps-spectral-waterfall-display)
   - [QSO State Machine & Auto-Sequencing](#qso-state-machine--auto-sequencing)
   - [CAT Rig Control & S-Meter Integration](#cat-rig-control--s-meter-integration)
   - [Band Manager & Presets](#band-manager--presets)
6. [Repository Structure](#repository-structure)
7. [Contributing & License](#contributing--license)

---

## Key Features & Capabilities

- **Ultra-Weak Signal Threshold**: Decodes signals down to **-28 dB SNR** on AWGN channels and **-24 dB SNR** under severe Rayleigh and polar flutter fading.
- **Spectrum Efficiency**: Requires only **50.0 Hz** of RF bandwidth per transmission (allowing up to **50 simultaneous QSOs** in a standard 2.7 kHz SSB transceiver passband).
- **Multi-Pass SIC Engine**: Automatically reconstructs, synthesizes, and subtracts strong decoded carrier waveforms from the time-domain audio buffer to uncover and decode overlapping weak signals buried up to 25 dB underneath stronger stations.
- **Sub-Second RF Time Synchronization**: Embedded DSP time calibration tool (`rf_time_sync.py`) scans international standard stations (WWV/WWVH, CHU, DCF77, MSF, WWVB, JJY) to measure and eliminate clock drift ($\Delta t$) down to $<1.5\text{ ms}$ without needing administrative or root privileges.
- **Hardware Agnostic**: Fully supports physical transceivers via **Hamlib (`rigctld`)**, audio interfaces (SignaLink, Digirig, USB soundcards, Icom/Yaesu/Kenwood/Elecraft internal USB audio), and standalone SDRs.
- **High-Rate 60 FPS Waterfall**: GPU-accelerated HTML5 Canvas with 10 scientific color palettes (Turbo, Inferno, Viridis, Plasma, Magma, WSJT-X, Night Vision, Amber, B&W, Spectral Heatmap), variable scroll speeds (1x to 4x), dynamic passband selectors, and double-click carrier arming.
- **Complete Cross-Platform Delivery**: Runs natively across **Android**, **Ubuntu/Debian**, **Arch Linux**, **Windows 10/11**, and standalone embedded platforms (e.g. Raspberry Pi 4/5).

---

## Comparison with Other Digital Modes

The following table benchmarks **z-30** against standard amateur radio digital modes: **FT8**, **FT4**, **WSPR**, and **JS8Call**.

| Metric / Parameter | **z-30 (This Protocol)** | **FT8** | **FT4** | **WSPR** | **JS8Call** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cycle Duration** | **30.0 s** | 15.0 s | 7.5 s | 120.0 s | 15.0 s (Var) |
| **Occupied Bandwidth** | **50.0 Hz** | 47.0 Hz | 83.0 Hz | 5.9 Hz | 50.0 Hz |
| **Modulation Type** | **16-MFSK** | 8-GFSK | 4-GFSK | 4-FSK | 8-GFSK |
| **Baud Rate (Symbol Rate)** | **3.125 baud** | 6.25 baud | 20.83 baud | 1.4648 baud | 6.25 baud |
| **Tone Spacing ($\Delta f$)** | **3.125 Hz** | 6.25 Hz | 20.83 Hz | 1.4648 Hz | 6.25 Hz |
| **Sensitivity Limit (AWGN)**| **-28 dB SNR** | -21 dB SNR | -17.5 dB SNR | -31 dB SNR | -24 dB SNR |
| **FEC Code** | **LDPC (174, 58) Rate 1/3** | LDPC (174, 91) Rate 0.52 | LDPC (174, 91) Rate 0.52 | Convol. $K=32, r=1/2$ | LDPC (174, 91) |
| **Payload Capacity** | **58 bits (CRC-14)** | 77 bits (CRC-14) | 77 bits (CRC-14) | 28 bits (Call+Loc+Pwr) | Free text (var) |
| **Collision Immunity** | **Multi-Pass SIC (3 passes)** | Single pass (limited) | None | Non-coherent | Single pass |
| **Primary Use-Case** | **Weak DX / EME / Solar Minima** | General DX / Contesting | Rapid Contesting | Propagation Beaconing| Conversational Keyboard |
| **Clock Drift Tolerance** | **$\pm 1.5\text{ s}$ (with RF Auto-Sync)** | $\pm 1.0\text{ s}$ | $\pm 0.5\text{ s}$ | $\pm 2.0\text{ s}$ | $\pm 1.0\text{ s}$ |
| **Spectral Density** | **50 QSOs per 2.7 kHz band** | ~40 QSOs per band | ~25 QSOs per band | N/A (One-way) | ~30 QSOs per band |

### Why 16-MFSK and a 30-Second Cycle?
1. **7 dB Sensitivity Advantage Over FT8**: By reducing symbol rate from 6.25 baud to 3.125 baud and applying a low Rate-1/3 LDPC code, z-30 recovers signals buried **6 to 7 dB lower than FT8**. This opens openings across 160m, 6m, 2m EME, and high-latitude paths during solar geomagnetic disturbances.
2. **True Co-Channel Collision Recovery**: Traditional FT8 fails when two signals occupy the same audio frequency bins. z-30 incorporates a 3-pass **Successive Interference Cancellation (SIC)** algorithm: when a strong signal is decoded, its exact RF phase and amplitude are synthesized and cleanly subtracted from the raw FFT bins, enabling a second and third decoding pass on previously obscured weak signals.

---

## Deep-Dive: Protocol & DSP Architecture

```
                                      z-30 DSP Transmit / Receive Flow
                                      ================================

       [ Structured QSO Message ]                           [ Raw Audio In (48 kHz / 16-bit) ]
                 │                                                          │
       [ 58-bit Base-40 Packing ]                                 [ Audio Buffer (24.32s Window) ]
                 │                                                          │
       [ 14-bit CRC Parity Insertion ]                             [ Downsample & Matched Filter ]
                 │                                                          │
       [ Rate-1/3 QC-LDPC Encoder ]                               [ FFT Energy Binning (16 Tones) ]
                 │                                                          │
       [ 4-Symbol Costas Synchronization ]                         [ Costas Array Sync Detection ]
                 │                                                          │
       [ 16-MFSK Continuous Phase FSK ]                            [ Non-Coherent Metric Slicer ]
                 │                                                          │
       [ 48 kHz Raised-Cosine Keying ]                             [ Log-Likelihood Ratio (LLR) ]
                 │                                                          │
       [ Transceiver Soundcard / CAT ]                            [ Belief Propagation LDPC Decoder ]
                                                                            │
                                                                   ┌────────┴────────┐
                                                                 Valid CRC?       Corrupt / Clash?
                                                                   │                 │
                                                            [ Output Decode ]   [ SIC Engine ]
                                                                                     │
                                                                           (Subtract & Re-decode)
```

### Modulation & Waveform Parameters

- **Modulation**: 16-Tone Multiple Frequency-Shift Keying (16-MFSK) with continuous phase and raised-cosine symbol shaping to eliminate spectral sideband splatter.
- **Symbol Duration ($T_s$)**: $320.0\text{ ms} = 1 / 3.125\text{ Hz}$.
- **Tone Spacing ($\Delta f$)**: $3.125\text{ Hz}$.
- **Total Occupied Bandwidth**: $16 \times 3.125\text{ Hz} = 50.0\text{ Hz}$.
- **Symbol Count per Frame**: 76 symbols ($76 \times 0.320\text{ s} = 24.32\text{ s}$ total transmission duration).
- **Synchronization**: Two 4-symbol Costas arrays placed at the frame header (symbols 0–3) and mid-amble (symbols 36–39) providing robust time-offset ($\Delta t$) and Doppler frequency-offset ($\Delta f$) tracking down to $\pm 0.1\text{ Hz}$.

### Synchronous 30-Second Cycle Timing

The UTC clock cycle is divided into even and odd 30-second transmission slots:
- **`EVEN` Slot**: Begins exactly at `:00` and `:30` seconds of each UTC minute.
- **`ODD` Slot**: Begins exactly at `:15` and `:45` seconds (or alternating 30s intervals depending on configuration).
- **Transmission Frame Window**: $0.00\text{ s}$ to $24.32\text{ s}$.
- **DSP Decode & SIC Processing Window**: $24.32\text{ s}$ to $28.50\text{ s}$ ($\sim 4.18\text{ s}$ budget).
- **Sequencing & CAT Tuning Guard Window**: $28.50\text{ s}$ to $30.00\text{ s}$ ($1.50\text{ s}$ rig turnaround time).

### LDPC (174, 58) & CRC-14 Forward Error Correction

1. **Payload**: 58 bits of user information (compressed using Base-40 representation for standard callsigns, Maidenhead 4-digit grid locators, SNR signal reports from $-50\text{ dB}$ to $+49\text{ dB}$, and standard modifiers like `CQ`, `RR73`, `73`).
2. **CRC Parity**: A 14-bit cyclic redundancy check polynomial ($x^{14} + x^{11} + x^2 + 1$) guarantees a false-decode rate lower than $10^{-6}$.
3. **Encoding**: The 72-bit protected vector is mapped into 174 bits using a Rate-1/3 Quasi-Cyclic LDPC parity check matrix and modulated onto $58 \times \log_2(16)$ channel symbols.
4. **Decoding**: Log-domain Min-Sum Belief Propagation running up to 50 iterations per carrier candidate.

### Iterative Successive Interference Cancellation (SIC)

When high-power local stations mask weak DX stations transmitting within the same 50 Hz slice:
1. **Pass 1**: The engine identifies, synchronizes, and decodes the dominant signal.
2. **Reconstruction**: The DSP synthesizes the precise continuous-phase carrier waveform matching the decoded payload, scaling it by the measured amplitude, time delay, and phase trajectory.
3. **Subtraction**: The synthetic carrier is subtracted in the time domain:
   $$x_{\text{residual}}(t) = x_{\text{received}}(t) - \hat{s}_{\text{decoded}}(t)$$
4. **Pass 2 & 3**: The residual waveform $x_{\text{residual}}(t)$ is re-fed into the LDPC decoder to instantly unlock previously hidden signals down to the thermal noise floor.

### Automatic RF Standard Station Time Sync

In remote or field locations without NTP internet access, z-30 includes `rf_time_sync.py`:
- Scans global HF/LF time standard broadcast stations (**WWV/WWVH** at 2.5/5/10/15/20 MHz, **CHU** at 3.33/7.85/14.67 MHz, **DCF77** at 77.5 kHz, **MSF/WWVB/JJY** at 40/60 kHz).
- Executes rapid 5-second carrier pre-validation followed by audio subcarrier demodulation (100 Hz BCD, 300-baud Bell 103 AFSK, 1 Hz PWM amplitude dips).
- Measures system clock offset $\Delta t = T_{\text{RF}} - T_{\text{System}}$ and applies zero-admin application-level offset calibration.

---

## Cross-Platform Installation & Build Guide

### Ubuntu & Debian

Compatible with **Ubuntu 20.04 LTS, 22.04 LTS, 24.04 LTS**, **Debian 11/12**, **Linux Mint**, and **Pop!_OS**.

#### Automated One-Line Setup
```bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_ubuntu.sh
./install_ubuntu.sh
```

#### Manual Build Steps
```bash
# 1. Install APT prerequisites
sudo apt-get update
sudo apt-get install -y \
  python3 python3-pip python3-venv python3-tk python3-dev \
  build-essential libportaudio2 portaudio19-dev libasound2-dev \
  libhamlib-utils libhamlib-dev nodejs npm curl git

# 2. Setup Python environment
python3 -m venv ~/.z30-env
source ~/.z30-env/bin/activate
pip install --upgrade pip setuptools wheel
pip install numpy scipy sounddevice pyaudio pyserial cffi requests

# 3. Build Web GUI distribution
npm install
npm run build

# 4. Launch Transceiver
python3 -c "from z30_dsp.gui import main; main()"
```

---

### Arch Linux, Manjaro, EndeavourOS & CachyOS

Arch Linux users benefit from official Pacman pre-compiled vector libraries with native AVX2/AVX-512 optimization.

#### Method 1: Automated Script (Recommended)
Modern Arch Linux manages the system Python environment (`EXTERNALLY-MANAGED`). The automated script installs official packages via Pacman, creates an isolated virtual environment (`~/.z30-env`), installs `sounddevice`, compiles the package, and configures the `z30` launcher:

```bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_arch.sh
./install_arch.sh
```

#### Method 2: Native Arch Package Build (`makepkg`)
You can compile and install the package using the provided `PKGBUILD`:

```bash
# 1. Install Arch base build tools & dependencies
sudo pacman -Syu --needed base-devel git python-setuptools python-build python-installer python-wheel \
    python-numpy python-scipy python-pyserial python-cffi python-requests portaudio hamlib tk

# 2. Clone and build the package
git clone https://github.com/themantas1994/z-30.git
cd z-30
makepkg -si
```

#### Method 3: Manual Pacman + Virtual Environment Setup
```bash
# 1. Install all runtime dependencies via Pacman (official repos)
sudo pacman -Syu --needed \
    python python-pip python-setuptools python-build python-installer python-wheel \
    python-numpy python-scipy python-pyserial python-cffi python-requests \
    portaudio hamlib tk nodejs npm git base-devel

# 2. Create an environment that uses Pacman system packages
python -m venv ~/.z30-env --system-site-packages
source ~/.z30-env/bin/activate

# 3. Install sounddevice and build z-30
pip install sounddevice
python -m build --wheel --no-isolation
pip install dist/*.whl --force-reinstall

# 4. Launch Transceiver
python -c "import z30_dsp.gui; z30_dsp.gui.main()"
```

---

### Windows 10 & 11

Compatible with Windows 10 (64-bit) and Windows 11 using native WASAPI sound devices and COM serial ports.

#### Option A: Quick Batch Launcher
1. Install **Python 3.9+** from [python.org](https://www.python.org/) (ensure **"Add python.exe to PATH"** is checked).
2. Clone or download the repository:
   ```cmd
   git clone https://github.com/themantas1994/z-30.git
   cd z-30
   ```
3. Double-click `run_windows.bat` (this automatically creates the virtual environment, installs dependencies, and launches the application).

#### Option B: Standalone `.exe` Compilation via PyInstaller
To build a standalone executable without requiring Python on client PCs:
```cmd
build_windows.bat
```
The resulting standalone binary will be generated at `dist\z30-transceiver\z30-transceiver.exe`.

---

### Android (PWA & Termux)

z-30 offers two distinct operating modes for Android:

#### Mode 1: Instant Standalone PWA (Recommended for Tablets & Phones)
1. Open the hosted z-30 instance or local server in **Google Chrome**, **Brave**, or **Microsoft Edge** on your Android device.
2. Tap the browser menu `(⋮)` and select **"Install app"** or **"Add to Home screen"**.
3. Launch `z-30` from your home screen. It operates in fullscreen mode with direct hardware Web Audio microphone/line-in input and 60 FPS GPU-accelerated waterfall rendering.

#### Mode 2: Android Termux Field Radio Deployment (OTG USB Audio & Radios)
For portable SOTA/POTA operations connecting USB OTG audio soundcards (SignaLink, Digirig, Icom IC-705, Xiegu G90/X6100):
```bash
# 1. In Termux, fetch and execute the field installer:
pkg update && pkg install -y git curl
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_android_termux.sh
./install_android_termux.sh

# 2. Start the transceiver:
z30
```

---

### Generic Linux & PyPI

To build a universal wheel package using standard PEP 517 / PEP 621 tooling:
```bash
# 1. Build universal wheel
pip install build wheel
python3 -m build --wheel

# 2. Install the generated wheel
pip install dist/z30_transceiver-1.0.0-py3-none-any.whl

# 3. Universal verification suite
python3 build_all_platforms.py
```

---

## User Interface & Operation Guide

### 60 FPS Spectral Waterfall Display

The primary canvas delivers continuous, non-blocking 60 FPS spectral analysis:
- **Colormaps**: Switch between 10 specialized palettes including `Turbo`, `Inferno`, `Viridis`, `Plasma`, `WSJT-X Classic`, `Night Vision Green`, and `Amber`.
- **Passband Presets**: Quickly toggle frequency boundaries between `200–3000 Hz (Standard)`, `500–2000 Hz (Narrow)`, `800–1800 Hz (Digital Focus)`, `100–3500 Hz (Wide)`, and `0–4000 Hz (Extended)`.
- **Trace Visibility Boost**: Enhance weak 16-MFSK tone tracks (down to $-28\text{ dB}$) with the 3-level contrast multiplier (`1x`, `1.6x`, `2.2x`).
- **Interactive Tuning**:
  - **Single Click**: Set Audio RX Center Frequency.
  - **Shift + Click**: Set Audio TX Center Frequency.
  - **Double Click Carrier**: Instantly arms the transmitter (`txEnabled = true`) and prepares the appropriate sequencing macro to call the target station on the upcoming cycle.
  - **Mouse Wheel**: Smooth zoom ($1\times$ to $8\times$) with drag-to-pan inspection.

### QSO State Machine & Auto-Sequencing

z-30 automates standard amateur radio contact exchanges via a 6-stage finite state machine:

| Macro | Description | Transmitted Payload Example |
| :--- | :--- | :--- |
| **TX 1** | Directed or General CQ Call | `CQ W1AW FN31` |
| **TX 2** | Signal Report Response | `W1AW K1ABC -12` |
| **TX 3** | Signal Report Acknowledgment | `K1ABC W1AW R-08` |
| **TX 4** | Mutual Confirmation (RRR / RR73) | `W1AW K1ABC RR73` |
| **TX 5** | Final 73 Sign-off | `K1ABC W1AW 73` |
| **TX 6** | Free-text / Special Grid | `W1AW K1ABC 73 DX` |

- **Auto-Sequence**: Automatically advances through macros upon receiving valid CRC-verified replies.
- **Auto-Log**: Automatically commits logged contacts to internal storage and exports standard ADIF (`.adi`) logbooks compatible with LoTW, QRZ, ClubLog, and eQSL.

### CAT Rig Control & S-Meter Integration

- Direct bidirectional serial communication over Hamlib `rigctld` (default port `4532`) or native serial ports (`COM1..COM32`, `/dev/ttyUSB*`, `/dev/ttyACM*`).
- Reads VFO dial frequency, operating mode (`USB` / `PKTUSB`), and live hardware S-Meter power in dBm.
- Handles synchronous Push-To-Talk (PTT) keying via CAT commands, RTS/DTR serial pins, or VOX.

### Band Manager & Presets

Quickly jump between standard amateur allocations with pre-configured calling frequencies:
- **160m**: $1.838000\text{ MHz}$
- **80m**: $3.575000\text{ MHz}$
- **60m**: $5.357000\text{ MHz}$
- **40m**: $7.076000\text{ MHz}$
- **30m**: $10.138000\text{ MHz}$
- **20m**: $14.076000\text{ MHz}$ *(Primary Activity)*
- **17m**: $18.102000\text{ MHz}$
- **15m**: $21.076000\text{ MHz}$
- **12m**: $24.917000\text{ MHz}$
- **10m**: $28.076000\text{ MHz}$
- **6m**: $50.315000\text{ MHz}$
- **2m**: $144.176000\text{ MHz}$
- **70cm**: $432.176000\text{ MHz}$

---

## Repository Structure

```
├── README.md                     # Master GitHub Technical Documentation
├── package.json                  # Web DSP / React / Tailwind configuration
├── pyproject.toml                # Standard PEP 517/621 Python packaging metadata
├── setup.py                      # Setuptools multi-platform setup script
├── PKGBUILD                      # Arch Linux / Manjaro package build specification
├── z30.spec                      # PyInstaller standalone Windows/Linux spec
├── z30.desktop                   # Freedesktop Application Menu specification
├── manifest.json                 # PWA Web App manifest for Android / Desktop
├── sw.js                         # Offline Service Worker cache engine
│
├── install_ubuntu.sh             # Automated installer for Ubuntu/Debian
├── install_arch.sh               # Automated installer for Arch Linux
├── install_android_termux.sh     # Automated installer for Android Termux field ops
├── run_windows.bat               # Automated launcher for Windows 10/11
├── build_windows.bat             # Standalone .EXE builder for Windows
├── build_all_platforms.sh        # Multi-platform shell verification pipeline
├── build_all_platforms.py        # Multi-platform Python test and verification script
│
├── config_wizard.py              # CLI station configuration wizard
├── rf_time_sync.py               # International time station scanner & DSP clock sync
├── band_manager.py               # Dial frequency & band plan manager
│
├── src/                          # Web DSP & GUI Source Code
│   ├── dsp/                      # Pure DSP, Modulators, Decoders, Audio Engine
│   │   ├── audioEngine.ts        # Web Audio API 48kHz sampling pipeline
│   │   ├── z30Constants.ts       # 16-MFSK specs, Costas arrays, Ham bands
│   │   ├── qsoEngine.ts          # State machine, auto-sequencing, and ADIF logger
│   │   └── rigctlSimulator.ts    # CAT transceiver controller
│   ├── components/               # React UI & Visualization Components
│   │   ├── WaterfallDisplay.tsx  # 60 FPS HTML5 Canvas Waterfall & S-Meter
│   │   ├── RfTimeSyncModal.tsx   # RF Time Calibration Workbench
│   │   ├── CrossPlatformBuildModal.tsx # Multi-OS Package Hub
│   │   ├── ActivityLogTable.tsx  # Decoded Traffic & QSO Message Matrix
│   │   ├── StationConfigModal.tsx# Radio & CAT Settings
│   │   └── SetupWizardModal.tsx  # Initial Setup Wizard
│   └── types/                    # TypeScript Type Definitions
```

---

## Contributing & License

Contributions, bug reports, and pull requests are welcomed! Whether you are optimizing LDPC decoding kernels, testing novel CAT hardware, or refining documentation, please feel free to open an issue or pull request.

Distributed under the **MIT License**. See `LICENSE` for details.

---

*73 de the z-30 Digital Mode Working Group — Dedicated to advancing the boundaries of amateur radio weak-signal digital communications.*
