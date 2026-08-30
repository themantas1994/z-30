# 02. Developer Setup & Contributing

Welcome to the **z-30 developer community**! Whether you are interested in improving the Low-Density Parity-Check (LDPC) belief-propagation decoder, optimizing the 60 FPS WebGL/Canvas waterfall, integrating new Hamlib CAT transceivers, or enhancing the Python DSP engine, this guide has everything you need.

---

## 🏛️ System Architecture Overview

z-30 is engineered as a **dual-stack architecture**:

```
                                  z-30 Project Architecture
                                  ==========================

   ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
   │        Client / Web GUI Layer                │  │         Native Python DSP Package            │
   │        (TypeScript + React 19 + Vite)        │  │         (Python 3.9+ / NumPy / SciPy)        │
   ├──────────────────────────────────────────────┤  ├──────────────────────────────────────────────┤
   │ • Web Audio API 12/48 kHz Audio Pipeline     │  │ • z30_dsp/modem.py (16-MFSK CPFSK Mod/Demod) │
   │ • 60 FPS HTML5 Canvas Spectral Waterfall     │  │ • z30_dsp/ldpc.py (QC-LDPC (216, 77) Engine) │
   │ • dsp/ldpcCodec.ts (TS Min-Sum LDPC Engine)  │  │ • z30_dsp/sic_decoder.py (3-Pass SIC)        │
   │ • dsp/sicDecoder.ts (3-Pass SIC Subtraction) │  │ • z30_dsp/rf_time_sync.py (FIR Time Sync)    │
   │ • dsp/catController.ts (Rigctl TCP client)   │  │ • z30_dsp/auto_logger.py (ADIF 3.1.4 Engine) │
   │ • Progressive Web App (PWA) / Service Worker │  │ • z30_dsp/web_server.py (Embedded Server)    │
   └──────────────────────────────────────────────┘  └──────────────────────────────────────────────┘
```

Both environments implement the exact same physical-layer mathematical specification, allowing algorithms to be developed and tested in Python and ported/verified in TypeScript.

---

## 💻 Developer Prerequisites

- **Node.js**: `v18.0.0` or higher (`v20+` recommended)
- **Python**: `3.9` or higher (`3.10+` recommended)
- **Audio Headers & Libraries**:
  - Debian/Ubuntu: `libportaudio2 portaudio19-dev libasound2-dev libhamlib-dev`
  - Arch Linux: `portaudio hamlib`
  - Windows: Visual C++ Redistributable, PortAudio (bundled in wheels)
  - macOS: `brew install portaudio hamlib`

---

## 🛠️ Step-by-Step Environment Setup

### 1. Clone the Repository
```bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
```

### 2. Configure Python DSP Development Environment
```bash
# Create an isolated virtual environment
python3 -m venv .venv

# Activate the virtual environment
# On Linux / macOS:
source .venv/bin/activate
# On Windows (PowerShell):
# .venv\Scripts\Activate.ps1

# Upgrade build tools and install dependencies
pip install --upgrade pip setuptools wheel build
pip install -r requirements.txt || pip install numpy scipy sounddevice pyaudio pyserial cffi requests
pip install -e .
```

### 3. Configure Web GUI Development Environment
```bash
# Install NPM packages
npm install

# Start the Vite development server
npm run dev
```
The live web transceiver GUI will be accessible at `http://localhost:3000`.

---

## 🧪 Running Verification & Test Suites

### 1. TypeScript & React Linting / Type Checking
```bash
# Verify TypeScript types across all components and DSP engines
npm run lint
# or: npx tsc --noEmit
```

### 2. Frontend Production Build Verification
```bash
# Compile optimized production bundle to dist/
npm run build
```

### 3. Python Monte Carlo Simulation & FT8 Comparison Benchmark
Run the built-in channel simulation to verify BER/FER curves and AWGN decoding thresholds:
```bash
# Run the benchmark suite
python3 -m z30_dsp.benchmark
# or using the CLI command:
z30 --benchmark
```

### 4. Universal Cross-Platform Test Suite
```bash
# Run automated verification across all platforms
python3 build_all_platforms.py
```

---

## 📁 Repository Directory Structure

```
├── .github/                      # GitHub Actions CI/CD workflows
├── wiki/                         # Master GitHub Wiki markdown documentation
├── PKGBUILD                      # Arch Linux / Manjaro package build specification
├── pyproject.toml                # Standard PEP 517/621 Python packaging metadata
├── requirements.txt              # Pinned Python runtime dependencies
├── z30.spec                      # PyInstaller standalone Windows/Linux spec
│
├── z30_dsp/                      # Native Python DSP Package
│   ├── __init__.py               # Package metadata and version info
│   ├── main.py                   # Master entrypoint router (CLI & GUI)
│   ├── modem.py                  # 16-MFSK continuous-phase modulator & demodulator
│   ├── ldpc.py                   # IRA LDPC (216, 77) parity matrices & Min-Sum decoder
│   ├── sic_decoder.py            # 3-Pass Successive Interference Cancellation
│   ├── rf_time_sync.py           # FIR matched filter time station demodulator
│   ├── paths.py                  # Per-user config / logbook directory resolution
│   ├── auto_logger.py            # ADIF 3.1.4 logbook engine
│   ├── benchmark.py              # Monte Carlo AWGN/Rayleigh simulation suite
│   ├── gui_tkinter.py            # Zero-dependency desktop GUI
│   └── web_server.py             # Local HTTP server: token-authed hardware API, rigctld relay
│
├── tests/                        # pytest suite (codec, spectrum, local API, time-sync guards)
├── public/                       # Static PWA assets copied verbatim into the build
│
└── src/                          # Web DSP & GUI Source Code (TypeScript + React)
    ├── App.tsx                   # Master transceiver workspace orchestrator
    ├── types/
    │   └── z30.ts                # TypeScript interfaces and type definitions
    ├── dsp/                      # Pure Web Audio & DSP algorithms
    │   ├── audioEngine.ts        # Web Audio API 12/48 kHz pipeline & synthesis
    │   ├── z30Constants.ts       # Mathematical constants, Costas arrays, band plans
    │   ├── z30Codec.ts           # 63-bit Radix-37/27 message packing & CRC-14 engine
    │   ├── ldpcCodec.ts          # Systematic (216, 77) Belief Propagation decoder
    │   ├── sicDecoder.ts         # Multi-pass Successive Interference Cancellation
    │   ├── rfTimeSyncEngine.ts   # Audio DSP time station cross-correlation engine
    │   ├── qsoEngine.ts          # 6-stage QSO state machine & auto-sequencer
    │   ├── qsoLogger.ts          # ADIF 3.1.4 / Cabrillo / CSV / JSON logger
    │   └── catController.ts      # Hamlib rigctld & serial CAT controller
    └── components/               # UI components
        ├── Header.tsx            # UTC clock, 30s cycle progress bar, TX/Tune
        ├── WaterfallDisplay.tsx  # 60 FPS HTML5 Canvas spectral waterfall
        ├── ActivityLogTable.tsx  # Band activity traffic matrix & decode filters
        ├── QsoMacrosTransmitPanel.tsx # 6 TX macros & auto-reply sequencer
        ├── QsoController.tsx     # DX target contact manager & S-meter gauges
        ├── RigControlPanel.tsx   # Hamlib VFO dial & live CAT terminal
        ├── SetupWizardModal.tsx  # 4-step interactive hardware setup wizard
        ├── StationSettingsModal.tsx # Station configuration & CAT parameters
        └── RfTimeSyncModal.tsx   # RF time calibration & beacon workbench
```

---

## 🤝 Contribution Guidelines

We welcome contributions of all kinds! Please follow these standards:

### Branch Naming Conventions
- `feature/add-doppler-correction`
- `fix/ldpc-simd-acceleration`
- `docs/update-wiki-pinouts`

### Commit Message Format
Please use Conventional Commits:
- `feat(dsp): implement AVX2 SIMD acceleration in ldpc.py`
- `fix(cat): handle Yaesu FT-710 extended PTT response`
- `docs(wiki): add Raspberry Pi DigiPi wiring guide`

### Pull Request Checklist
1. All TypeScript code must pass `npm run lint` without errors or warnings.
2. Production bundle must build cleanly via `npm run build`.
3. Python modifications must maintain compatibility with Python 3.9 through 3.13.
4. If modifying DSP code, run `python3 -m z30_dsp.benchmark` to verify decoding threshold does not regress below **-25.0 dB SNR (50%) / -24.0 dB SNR (90%)**.
