/**
 * Wiki articles for the in-app documentation viewer.
 *
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Edit the markdown under wiki/ instead, then regenerate with: npm run generate:wiki
 *
 * The browser cannot read the repository, so the viewer needs the documentation as strings.
 * This is produced from wiki/ at build time; it used to be a hand-copied snapshot that had
 * drifted from the markdown it mirrored.
 */

export interface WikiArticle {
  /** Stable identifier. */
  id: string;
  /** Routing key used by in-app links; matches the GitHub wiki page name. */
  slug: string;
  /** Display title. */
  title: string;
  /** Grouping in the article list. */
  category: 'Getting Started' | 'Developer Guide' | 'Protocol & DSP' | 'Hardware & Rig Control' | 'Advanced & Packaging';
  /** One-line summary shown in the index. */
  description: string;
  /** Verbatim contents of the corresponding file in wiki/. */
  markdown: string;
  /** Free-text search keywords. */
  tags: string[];
}

export const WIKI_ARTICLES: WikiArticle[] = [
  {
    id: "home",
    slug: "Home",
    title: "Wiki Home & Overview",
    category: "Getting Started",
    description: "Master index, system overview, and quick navigation matrix for z-30.",
    tags: ["overview","index","navigation","summary","introduction"],
    markdown: `# z-30 Wiki — The Source of Truth

Welcome to the technical documentation for **z-30**: an experimental open-source amateur radio
16-MFSK weak-signal digital transceiver and DSP suite.

> **This wiki is the project's source of truth.** Protocol specifications, install procedures,
> operating reference, safety behaviour, measured figures and developer process all live here
> and are maintained here. The repository \`README.md\` is a front page that introduces z-30 and
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
| **DSP / protocol developer** | [Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md) | [DSP & Physical Layer Specs](03-DSP-&-Physical-Layer-Specification.md), [LDPC FEC](04-Forward-Error-Correction-&-LDPC.md), [SIC Engine](05-Successive-Interference-Cancellation-(SIC).md), [Benchmarking & CI](16-Benchmarking-Testing-&-CI.md) |
| **Advanced ham / RF engineer** | [Physics & FT8 Comparison](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) | [DSP Specs](03-DSP-&-Physical-Layer-Specification.md), [SIC Engine](05-Successive-Interference-Cancellation-(SIC).md), [Benchmarking & CI](16-Benchmarking-Testing-&-CI.md) |
| **Hardware & rig integrator** | [CAT & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md) | [Raspberry Pi / DigiPi](09-Cross-Platform-Build-&-Packaging.md), [RF Time Sync](07-RF-Time-Synchronization-Engine.md), [CLI & Configuration](15-Command-Line-Tools-&-Configuration.md) |
| **Frontend / web developer** | [Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md) | [Web & PWA Architecture](08-Web-&-PWA-Architecture.md), [Cross-Platform Packaging](09-Cross-Platform-Build-&-Packaging.md) |
| **Coding assistant / LLM** | \`AGENTS.md\` in the repository root | [Developer Setup](02-Developer-Setup-&-Contributing.md), [Operating Safety](13-Operating-Safety-Compliance-&-Security.md), [Benchmarking & CI](16-Benchmarking-Testing-&-CI.md) |

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
   $2^{-14} \\approx 6.1 \\times 10^{-5}$. (Earlier revisions called the code quasi-cyclic, which
   it is not, and quoted $< 10^{-6}$ for the CRC, which is about sixty times better than a
   14-bit CRC can be.)
3. **Multi-pass Successive Interference Cancellation**: a 3-pass engine that synthesises and
   subtracts strong decoded carriers to recover hidden co-channel DX signals.
4. **Sub-millisecond RF time calibration** (\`z30_dsp/rf_time_sync.py\`): an FIR matched-filter
   receiver that calibrates clock drift against global standard stations (**WWV, WWVH, CHU,
   DCF77, MSF, WWVB, JJY**) without internet or administrator privileges.
5. **Universal cross-platform architecture**: an interactive Web Audio 60 FPS HTML5/PWA GUI and
   a native Python 3 DSP package (\`z30_dsp\`) with Hamlib CAT and 9 PTT keying methods.

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
8. [11. Physics & Comparative Analysis: z-30 vs. FT8](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md)

### Hardware & rig control
9. [06. Transceiver CAT Control & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md)
10. [07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md)

### Development, build & packaging
11. [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md)
12. [08. Web & PWA Architecture](08-Web-&-PWA-Architecture.md)
13. [09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md)
14. [12. Software Updates & GitHub Sync](12-Software-Updates-&-GitHub-Sync.md)
15. [15. Command-Line Tools & Configuration](15-Command-Line-Tools-&-Configuration.md)
16. [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md)

---

## ✍️ Editing this wiki

These pages are files in the repository under \`wiki/\`, not a separately hosted GitHub wiki, so
they are edited by pull request like any other change.

- Edit the markdown under \`wiki/\`.
- Run \`npm run generate:wiki\` and commit the regenerated \`src/data/wikiArticles.ts\`; CI fails
  the build if the in-app copy is stale.
- Adding a page also means registering it in \`scripts/generate_wiki_articles.mjs\` and adding it
  to this page and to \`_Sidebar.md\`.

The full policy — including which content belongs in the README and which belongs here — is in
[02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md).

---

## 🤝 Community & Support

- **GitHub repository**: [https://github.com/themantas1994/z-30](https://github.com/themantas1994/z-30)
- **Issue tracker**: bug reports, feature suggestions, and hardware test reports.
- **License**: distributed under the permissive [MIT License](../LICENSE).
`,
  },
  {
    id: "first-steps",
    slug: "01-New-User-Guide-&-First-Steps",
    title: "01. New User Guide & First Steps",
    category: "Getting Started",
    description: "Step-by-step onboarding for new operators: setup wizard, audio calibration, time sync, and first QSO.",
    tags: ["new user","first steps","tutorial","qso","wizard","beginner","audio setup"],
    markdown: `# 01. New User Guide & First Steps

Welcome to **z-30**! This guide is designed to take you from a fresh installation to completing your first 30-second weak-signal contact on the air.

---

## 📋 Prerequisites & Station Requirements

To operate z-30 on HF/VHF bands, you need:
1. **Amateur Radio Transceiver**: An SSB transceiver (HF 160m–10m, VHF 6m/2m, or UHF 70cm).
2. **Audio Interface**:
   - Built-in USB soundcard (e.g., Icom IC-7300/705, Yaesu FT-991A/FT-710, Kenwood TS-590SG, Xiegu G90/X6100).
   - External audio interface (e.g., Digirig Mobile, SignaLink USB, microHAM, DRA-30/50, or CM108/CM119 USB interface).
   - Line-In / Line-Out jacks on your PC or smartphone.
3. **Accurate Clock**: Digital modes require your system clock to be synchronized within $\\pm 1.0\\text{ s}$ of UTC. (z-30 includes a built-in RF Time Sync tool if internet NTP is unavailable).
4. **Resonant or Tuned Antenna**: A matched antenna system (SWR $< 1.5:1$).

---

## 🛠️ Step 1: Initial Setup Wizard

When you launch z-30 for the first time (or click the **\`Wizard\`** button in the top navigation bar), the 4-step setup wizard will guide you through configuration:

### Step 1.1: Station Identity
- **Callsign**: Enter your legal amateur radio callsign (e.g., \`W1AW\`, \`G4ABC\`, \`DL1XYZ\`).
- **Maidenhead Grid Locator**: Enter your 4 or 6-character grid locator (e.g., \`FN31\`, \`JO21xx\`). Click **"Use Geolocation"** if using a GPS-equipped device to auto-fill your grid.
- **Operator Name & QTH**: (Optional) Friendly info used for logging.
- **Timezone**: Select your local timezone or keep default UTC.

### Step 1.2: Audio Soundcard I/O
- **Input Device (RX)**: Select the soundcard receiving audio from your radio (e.g., \`USB Audio CODEC\`, \`Microphone (Digirig)\`).
- **Output Device (TX)**: Select the soundcard routing audio to your radio transmitter.
- **Audio Levels**: Watch the live VU meter while listening to the radio. Adjust your radio RF Gain or PC input volume so background band noise rests around **30% to 50%** on the green scale.

### Step 1.3: Rig Control (Hamlib CAT)
- **Model**: Select your transceiver from the searchable catalog of 200+ rigs.
- **Connection Type**: Choose \`Hamlib rigctld\` (default port \`4532\`) or \`Direct Serial\`.
- **Serial Port & Baud Rate**: E.g., \`COM3\` on Windows or \`/dev/ttyUSB0\` on Linux, matching your radio's internal menu baud rate (e.g., \`19200\` or \`38400\`).

### Step 1.4: PTT Keying Method
Select how your station keys the transmitter:
- **\`CAT Command\`**: Sends digital keying commands through the serial/USB cable.
- **\`RTS Line\` / \`DTR Line\`**: Hardware pin toggling used by Digirig, Rigblaster, and microHAM.
- **\`Audio Tone (Right Channel)\`**: Plays an inaudible 1000/1500 Hz tone on the right audio channel to trigger an auto-VOX interface (e.g., SignaLink USB, HT cables, phones).
- **\`CM108/CM119 GPIO\`**: Drives GPIO pin 3/4 on dedicated radio soundcards (DRA-30/50).
- **\`Raspberry Pi GPIO\`**: Uses BCM pin 17/27 for field SBC setups.

Click **"Test PTT"** to verify that your radio keys into transmit and returns to receive cleanly.

---

## ⏱️ Step 2: UTC Time Synchronization

z-30 transmissions synchronize to exact **30.0-second UTC slots**:
- **Even Slot**: Transmissions start at \`:00\` and \`:30\` of each UTC minute.
- **Active TX Window**: $24.0\\text{ s}$ duration.
- **Decode Window**: $24.0\\text{ s}$ to $30.0\\text{ s}$.

### If you have internet access:
Your operating system's NTP client will keep your clock in sync automatically.

### If you are in the field (SOTA / POTA / Offline):
1. Click the **\`SYNC TIME\`** button in the header.
2. Tune your radio to a standard time broadcast station (**WWV** at 5/10/15 MHz, **CHU** at 3.33/7.85/14.67 MHz, **DCF77** at 77.5 kHz, etc.).
3. The built-in DSP receiver will demodulate the audio subcarrier pulses, calculate the exact millisecond offset $\\Delta t$, and apply an application-level offset without requiring administrator privileges.

---

## 📻 Step 3: Setting Audio Levels & Waterfall Tuning

1. **Select a Band**: Click the band selector dropdown (e.g., **20m** - \`14.076 MHz\`).
2. **Audio RX Level**: Ensure the waterfall shows a dark blue/purple background with distinct signal tracks in yellow/green/cyan.
3. **Audio TX Level / ALC**:
   - In digital modes, **never overdrive your radio into heavy ALC compression**.
   - Set your PC audio output volume so that your transceiver indicates **zero ALC** or minimal deflection (1-2 bars max).
   - Digital 16-MFSK requires a linear RF amplifier stage. Excessive audio level causes intermodulation distortion (splatter) and reduces decode reliability.

---

## 🎯 Step 4: Making Your First QSO

### Scenario A: Calling CQ (You start the contact)
1. **Find a Clear Frequency**: Look at the waterfall and select an open 50 Hz slot. Click on the waterfall to set your RX and TX audio center frequencies (e.g., \`1500 Hz\`).
2. **Select Transmit Slot**: Choose **\`EVEN\`** or **\`ODD\`**.
3. **Select Macro TX 1**: The message will display \`CQ <MYCALL> <MYGRID>\` (e.g., \`CQ W1AW FN31\`).
4. **Click \`Start TX\`**: The station will arm and automatically key the transmitter at the start of the next 30-second slot.
5. **Auto-Sequencing**:
   - When a distant station responds (e.g., \`W1AW K1ABC -12\`), z-30 will automatically advance to **TX 3** (\`K1ABC W1AW R-08\`).
   - When the station confirms with **RR73** or **RRR**, z-30 transmits **TX 5** (\`K1ABC W1AW 73\`) and automatically commits the QSO to your logbook!

### Scenario B: Answering Another Station's CQ
1. **Monitor Activity**: Watch the **Activity Log** or the **Waterfall**.
2. **Double-Click a CQ Message**: Double-clicking any decoded CQ in the Activity table or waterfall will:
   - Tune your RX and TX frequencies to the calling station.
   - Switch your transmit slot to the opposite slot (if they called on \`EVEN\`, you transmit on \`ODD\`).
   - Arm macro **TX 2** (\`<THEIRCALL> <MYCALL> <MYGRID>\`).
   - Automatically begin transmitting when the slot starts.

---

## 📖 Step 5: Logbook & ADIF Export

- Click **\`Logbook\`** in the header to view all logged contacts with calculated great-circle distance (km/miles) and beam headings (azimuth).
- Click **\`Export ADIF\`** to download a standard \`.adi\` file ready for upload to:
  - **ARRL Logbook of The World (LoTW)**
  - **QRZ.com**
  - **ClubLog**
  - **eQSL.cc**
- You can also export to **Cabrillo** (for contests), **CSV**, or **JSON**.
`,
  },
  {
    id: "developer-setup",
    slug: "02-Developer-Setup-&-Contributing",
    title: "02. Developer Setup & Contributing",
    category: "Developer Guide",
    description: "Development environment configuration, test suites, architecture, and contribution guidelines.",
    tags: ["developer","contributing","build","tests","setup","git","pull request","architecture"],
    markdown: `# 02. Developer Setup & Contributing

Welcome to the **z-30 developer community**! Whether you are interested in improving the Low-Density Parity-Check (LDPC) belief-propagation decoder, optimizing the 60 FPS WebGL/Canvas waterfall, integrating new Hamlib CAT transceivers, or enhancing the Python DSP engine, this guide has everything you need.

---

## 🏛️ System Architecture Overview

z-30 is engineered as a **dual-stack architecture**:

\`\`\`
                                  z-30 Project Architecture
                                  ==========================

   ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
   │        Client / Web GUI Layer                │  │         Native Python DSP Package            │
   │        (TypeScript + React 19 + Vite)        │  │         (Python 3.9+ / NumPy / SciPy)        │
   ├──────────────────────────────────────────────┤  ├──────────────────────────────────────────────┤
   │ • Web Audio API 12/48 kHz Audio Pipeline     │  │ • z30_dsp/modem.py (16-MFSK CPFSK Mod/Demod) │
   │ • 60 FPS HTML5 Canvas Spectral Waterfall     │  │ • z30_dsp/ldpc.py (IRA-LDPC (216,77) Engine) │
   │ • dsp/ldpcCodec.ts (TS Min-Sum LDPC Engine)  │  │ • z30_dsp/sic_decoder.py (3-Pass SIC)        │
   │ • dsp/sicDecoder.ts (3-Pass SIC Subtraction) │  │ • z30_dsp/rf_time_sync.py (FIR Time Sync)    │
   │ • dsp/catController.ts (Rigctl TCP client)   │  │ • z30_dsp/auto_logger.py (ADIF 3.1.4 Engine) │
   │ • Progressive Web App (PWA) / Service Worker │  │ • z30_dsp/web_server.py (Embedded Server)    │
   └──────────────────────────────────────────────┘  └──────────────────────────────────────────────┘
\`\`\`

Both environments implement the exact same physical-layer mathematical specification, allowing algorithms to be developed and tested in Python and ported/verified in TypeScript.

---

## 💻 Developer Prerequisites

- **Node.js**: \`v18.0.0\` or higher (\`v20+\` recommended)
- **Python**: \`3.9\` or higher (\`3.10+\` recommended)
- **Audio Headers & Libraries**:
  - Debian/Ubuntu: \`libportaudio2 portaudio19-dev libasound2-dev libhamlib-dev\`
  - Arch Linux: \`portaudio hamlib\`
  - Windows: Visual C++ Redistributable, PortAudio (bundled in wheels)
  - macOS: \`brew install portaudio hamlib\`

---

## 🛠️ Step-by-Step Environment Setup

### 1. Clone the Repository
\`\`\`bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
\`\`\`

### 2. Configure Python DSP Development Environment
\`\`\`bash
# Create an isolated virtual environment
python3 -m venv .venv

# Activate the virtual environment
# On Linux / macOS:
source .venv/bin/activate
# On Windows (PowerShell):
# .venv\\Scripts\\Activate.ps1

# Upgrade build tools and install dependencies
pip install --upgrade pip setuptools wheel build
pip install -r requirements.txt || pip install numpy scipy sounddevice pyaudio pyserial cffi requests
pip install -e .
\`\`\`

### 3. Configure Web GUI Development Environment
\`\`\`bash
# Install NPM packages
npm install

# Start the Vite development server
npm run dev
\`\`\`
The live web transceiver GUI will be accessible at \`http://localhost:3000\`.

---

## 🧪 Running Verification & Test Suites

### 1. TypeScript & React Linting / Type Checking
\`\`\`bash
# Verify TypeScript types across all components and DSP engines
npm run lint
# or: npx tsc --noEmit
\`\`\`

### 2. Frontend Production Build Verification
\`\`\`bash
# Compile optimized production bundle to dist/
npm run build
\`\`\`

### 3. Python Monte Carlo Simulation & FT8 Comparison Benchmark
Run the built-in channel simulation to verify BER/FER curves and AWGN decoding thresholds:
\`\`\`bash
# Run the benchmark suite
python3 -m z30_dsp.benchmark
# or using the CLI command:
z30 --benchmark
\`\`\`

### 4. Universal Cross-Platform Test Suite
\`\`\`bash
# Run automated verification across all platforms
python3 build_all_platforms.py
\`\`\`

---

## 📁 Repository Directory Structure

\`\`\`
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
\`\`\`

---

## 📚 Documentation: where things belong

**This wiki is the source of truth for z-30's documentation.** The repository \`README.md\` is a
front page: it introduces the project, gets a new operator to a working install, and links
here. It deliberately does not carry reference material.

| If you are writing... | It belongs in... |
| :--- | :--- |
| A protocol, DSP or FEC detail | \`wiki/03\`, \`wiki/04\`, \`wiki/05\` |
| Install or packaging steps for a platform | \`wiki/09\` |
| A UI control, macro or operating procedure | \`wiki/14\`, or \`wiki/01\` if it is onboarding |
| Hardware, CAT or PTT wiring | \`wiki/06\` |
| A safety, compliance or local-security behaviour | \`wiki/13\` |
| A CLI flag, config key or environment variable | \`wiki/15\` |
| A benchmark figure, test or CI check | \`wiki/16\` |
| A sentence that makes someone want to try z-30 | \`README.md\` |

Two rules follow from that:

1. **Do not duplicate reference material into the README.** If the README and a wiki page
   disagree, the wiki page is correct and the README is the bug. Link instead of copying.
2. **\`src/data/wikiArticles.ts\` is generated.** The in-app wiki viewer needs the documentation
   as JavaScript strings because the browser cannot read the repository. After editing anything
   under \`wiki/\`, run \`npm run generate:wiki\` (or \`npm run build\`, which does it first) and
   commit the regenerated file. CI runs \`npm run check:generated\` and fails if you forget. The
   same applies to \`src/data/pythonSource.ts\` and \`npm run generate:python-source\`.

Adding a **new** wiki page also means registering it in the \`ARTICLES\` list in
\`scripts/generate_wiki_articles.mjs\` (id, file, slug, title, category, description, tags), and
adding it to \`wiki/Home.md\` and \`wiki/_Sidebar.md\`. Existing \`slug\` values are routing keys for
in-app links — do not change one without changing every reference to it.

\`AGENTS.md\` in the repository root is the condensed version of all of this, written for coding
assistants and for anyone who wants the invariants on one page.

---

## 🤝 Contribution Guidelines

We welcome contributions of all kinds! Please follow these standards:

### Branch Naming Conventions
- \`feature/add-doppler-correction\`
- \`fix/ldpc-simd-acceleration\`
- \`docs/update-wiki-pinouts\`

### Commit Message Format
Please use Conventional Commits:
- \`feat(dsp): implement AVX2 SIMD acceleration in ldpc.py\`
- \`fix(cat): handle Yaesu FT-710 extended PTT response\`
- \`docs(wiki): add Raspberry Pi DigiPi wiring guide\`

### Pull Request Checklist
1. All TypeScript code must pass \`npm run lint\` without errors or warnings.
2. Production bundle must build cleanly via \`npm run build\`.
3. Python modifications must maintain compatibility with Python 3.9 through 3.13.
4. If modifying DSP code, run \`python -m pytest tests\` (which includes the codec round trip, the occupied-bandwidth budget, and the acquisition tests) and \`python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40 --seed 20260830\` to check the decode threshold has not regressed below **-23.1 dB SNR (50%) / -21.7 dB SNR (90%)**. That is measured through the real acquisition path with random carrier and timing offsets. \`--mode ideal\` gives the genie-aided bound (-24.6 dB / -23.4 dB) for comparison; it is not an on-air threshold.
5. Documentation changes go in \`wiki/\`, not the README, and the generated in-app copy is regenerated (\`npm run generate:wiki\`) and committed. See [Documentation: where things belong](#-documentation-where-things-belong).
6. Any change to the transmit gate, the local API, the GPIO bridge or the time-sync guards keeps its tests passing unchanged, or explains in the pull request why the guarantee in [13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md) is still met.
`,
  },
  {
    id: "dsp-spec",
    slug: "03-DSP-&-Physical-Layer-Specification",
    title: "03. DSP & Physical Layer Specification",
    category: "Protocol & DSP",
    description: "Complete physical layer mathematical specifications: 16-MFSK, 50 Hz bandwidth, 75-symbol frame, and Costas sync.",
    tags: ["dsp","physics","modulation","16-mfsk","costas","frequency","snr","awgn"],
    markdown: `# 03. DSP & Physical Layer Specification

This document provides the complete mathematical and signal processing specification for the **z-30** physical transmission layer.

---

## 📊 Physical Layer Parameters Summary

| Parameter | Notation | Value | Notes |
| :--- | :--- | :--- | :--- |
| **Modulation** | — | **16-MFSK (CPFSK)** | Continuous-Phase Frequency Shift Keying |
| **Tone Count** | $M$ | **16 tones** | Alphabet $\\{0, 1, 2, \\dots, 15\\}$ |
| **Tone Spacing** | $\\Delta f$ | **3.125 Hz** | $\\Delta f = 1 / T_s$ (Orthogonal condition) |
| **Symbol Duration** | $T_s$ | **320.0 ms** | $T_s = 0.320\\text{ s}$ |
| **Occupied Bandwidth** | $B$ | **50.0 Hz** | $B = 16 \\times 3.125\\text{ Hz}$ |
| **Frame Symbol Count** | $N_{\\text{sym}}$ | **75 symbols** | 54 Data Symbols + 21 Costas Sync Symbols |
| **Active TX Duration** | $T_{\\text{tx}}$ | **24.0 s** | $75 \\times 0.320\\text{ s} = 24.0\\text{ s}$ |
| **Cycle Duration** | $T_{\\text{cycle}}$ | **30.0 s** | Synchronized to UTC :00 / :30 |
| **Guard / Processing Time** | $T_{\\text{guard}}$ | **6.0 s** | FFT Framing + 3-Pass SIC + LDPC decode |
| **Bits per Symbol** | $\\log_2(M)$ | **4 bits/symbol** | $54 \\times 4 = 216$ coded channel bits |
| **FEC Code** | — | **IRA-LDPC (216, 77)** | Rate $R \\approx 0.356$, dual-diagonal parity |
| **AWGN Decode Threshold** | — | **-23.1 dB SNR (50%) / -21.7 dB SNR (90%)** | In a $2500\\text{ Hz}$ noise bandwidth, through blind acquisition with random carrier ($\\pm5$ Hz) and timing ($\\pm0.5$ s) offsets, demodulated non-coherently. Comparable with the published on-air figures for FT8 and FT4. |
| **Idealised AWGN Bound** | — | -24.6 dB SNR (50%) / -23.4 dB SNR (90%) | Exact noise sigma, exact carrier and perfect symbol timing given to the demodulator. A bound on the code, **not** an on-air threshold. The 1.5 dB gap is the acquisition loss. |

---

## 🔄 End-to-End Signal Chain

\`\`\`
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
\`\`\`

The transmit path is implemented twice, once per stack, and the two must stay bit-exact:
\`z30_dsp/modem.py\` and \`src/dsp/z30Waveform.ts\`. \`tests/test_cross_language_parity.py\` and
\`tests/crc14.test.mjs\` hold them together against shared known-answer vectors.

---

## 🌊 Waveform Synthesis & Keying

The transmitted continuous-phase baseband signal $s(t)$ over the frame duration $0 \\le t \\le 24.0\\text{ s}$ is defined as:

$$s(t) = A(t) \\cdot \\cos\\left( 2\\pi f_{\\text{carrier}} t + 2\\pi \\Delta f \\int_{0}^{t} \\sum_{k=0}^{74} S_k \\cdot g(\\tau - k T_s)\\, d\\tau + \\phi_0 \\right)$$

Where:
- $S_k \\in \\{0, 1, \\dots, 15\\}$ is the integer tone index for symbol $k$.
- $\\Delta f = 3.125\\text{ Hz}$ is the tone spacing.
- $T_s = 0.320\\text{ s}$ is the symbol period.
- $g(t)$ is a **Gaussian frequency pulse** with bandwidth-time product $BT = 2.0$ — the value
  WSJT-X uses for FT8. The piecewise-constant tone sequence is convolved with $g(t)$ *before*
  it is integrated into phase.
- $A(t)$ is the envelope: **unity throughout the frame**, with a single 20 ms raised-cosine
  ramp at the start ($t=0$) and at the end ($t=24.0\\text{ s}$).

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
\`tests/test_modem_spectrum.py\` asserts the 99% occupied bandwidth (**49.8 Hz** measured) and
the -40 dB bandwidth (**66 Hz**) against fixed budgets, and asserts that the old per-symbol
gated waveform *fails* them — so the test can demonstrably tell the difference.

---

## ⏱️ Synchronous 30-Second Cycle Timing

The UTC clock is divided into even and odd 30-second transmission slots:

- **\`EVEN\` slot**: begins exactly at \`:00\` of each UTC minute (span \`:00\`–\`:30\`).
- **\`ODD\` slot**: begins exactly at \`:30\` of each UTC minute (span \`:30\`–\`:00\`).

Within a slot:

| Window | Span | Purpose |
| :--- | :--- | :--- |
| **Active transmission** | $0.00\\text{ s}$ – $24.00\\text{ s}$ | The 75-symbol frame |
| **Decode & SIC processing** | $24.00\\text{ s}$ – $28.50\\text{ s}$ | $4.50\\text{ s}$ compute budget for FFT framing, LDPC and 3-pass SIC |
| **Sequencing & CAT guard** | $28.50\\text{ s}$ – $30.00\\text{ s}$ | $1.50\\text{ s}$ of rig turnaround |

Slot alignment is what makes the mode work at all; see
[07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md) for how z-30
calibrates its clock without internet access.

---

## 🎯 Synchronization & Costas Array Pattern

To enable robust detection under severe polar flutter, multi-path delay spread, and Doppler drift, z-30 embeds **21 synchronization symbols** distributed across the 75-symbol frame.

### Sync Positions in Frame:
\`\`\`
Indices: [0, 1, 2,  7, 8, 9,  17, 18, 19,  27, 28, 29,  37, 38, 39,  47, 48, 49,  72, 73, 74]
\`\`\`

### Costas Tone Pattern:
\`\`\`
Sync Tones: [3, 11, 7,  14, 2, 9,  5, 12, 1,  15, 6, 10,  4, 8, 13,  0, 9, 3,  14, 6, 11]
\`\`\`

### Purpose of Interleaved Sync:
1. **Time Offset ($\\Delta t$) Estimation**: Normalized cross-correlation against the known 21-symbol sequence estimates frame arrival time with sub-10ms precision across a $\\pm 1.5\\text{ s}$ search window.
2. **Frequency Offset ($\\Delta f$) Tracking**: Estimates fine carrier frequency errors down to $\\pm 0.1\\text{ Hz}$.
3. **Phase Trajectory Tracking**: Tracks ionospheric phase rotation across the 24-second transmission frame for coherent multi-pass SIC reconstruction.

---

## 📈 Demodulation & Non-Coherent Metric Slicing

1. **Downsampling & Filtering**: Input audio (at 12 kHz or 48 kHz) is filtered through a 128-tap Kaiser-windowed bandpass filter matching the active channel bandwidth.
2. **Short-Time Discrete Fourier Transform (STDFT)**:
   For each symbol interval $k \\in [0, 74]$, the power spectral density across all 16 candidate tone frequencies $f_m = f_{\\text{base}} + m \\cdot \\Delta f$ is computed:
   $$P_k(m) = \\left| \\sum_{n=0}^{N-1} x[n + k N] \\cdot w[n] \\cdot e^{-j 2\\pi \\frac{m n}{N}} \\right|^2, \\quad m \\in \\{0, 1, \\dots, 15\\}$$
3. **Log-Likelihood Ratio (LLR) Generation**:
   For each of the 4 bits $b_{k,j}$ ($j \\in \\{0, 1, 2, 3\\}$) mapped by Gray-coding into tone index $m$:
   $$\\text{LLR}(b_{k,j}) = \\ln \\left( \\frac{\\sum_{m \\in S_{j,0}} \\exp\\left( \\frac{P_k(m)}{\\sigma^2} \\right)}{\\sum_{m \\in S_{j,1}} \\exp\\left( \\frac{P_k(m)}{\\sigma^2} \\right)} \\right)$$
   Where $S_{j,0}$ and $S_{j,1}$ are the tone subsets having bit $j$ equal to 0 and 1, respectively.
`,
  },
  {
    id: "ldpc-fec",
    slug: "04-Forward-Error-Correction-&-LDPC",
    title: "04. Forward Error Correction & LDPC",
    category: "Protocol & DSP",
    description: "63-bit Radix-37/27 message packing, CRC-14 polynomial, and Systematic Rate-0.356 IRA LDPC (216, 77) Belief Propagation decoder.",
    tags: ["ldpc","fec","crc","radix-37","belief propagation","min-sum","tanner graph"],
    markdown: `# 04. Forward Error Correction & LDPC

This document details the source coding, message compression, Low-Density Parity-Check (LDPC) forward error correction matrix, and belief-propagation decoding algorithm used in **z-30**.

---

## 📦 Message Structure & 63-Bit Source Packing

Amateur radio transmissions in z-30 encode structured contact messages into a compact **63-bit information vector** (\`z30Codec.ts:encodeCallsign28\`, \`z30_dsp/ldpc.py\`), structured as follows:

| Field | Bit Length | Representation / Compression |
| :--- | :--- | :--- |
| **Callsign 1 (Destination)** | 28 bits | Radix-37 prefix + digit + Radix-27 suffix packing |
| **Callsign 2 (Source)** | 28 bits | Radix-37 prefix + digit + Radix-27 suffix packing |
| **Grid / Report / Extra** | 7 bits | 4-char Maidenhead grid (indexed table + hashed fallback) or SNR report, 0-127 states |
| **Total Information Bits ($K$)** | **63 bits** | Encodes standard QSO exchanges with zero ambiguity |

### Radix-37 / Radix-27 Callsign Encoding
Standard amateur callsigns (e.g., \`W1AW\`, \`K1ABC\`, \`EA8/G4XYZ\`) are decomposed into a 1-2 character prefix, a single digit, and a 1-3 character alphabetic suffix:

$$N = \\big( (p \\cdot 37 + p') \\cdot 10 + d \\big) \\cdot 27^3 + (s_0 \\cdot 27^2 + s_1 \\cdot 27 + s_2) + 4$$

Where $p, p'$ are Radix-37 prefix characters (\`[A-Z0-9 ]\`), $d$ is the decimal digit, and $s_0, s_1, s_2$ are Radix-27 suffix characters (\`[A-Z ]\`). Total addressable states: $37^2 \\times 10 \\times 27^3 = 269{,}460{,}270$, fitting within 28 bits ($2^{28} = 268{,}435{,}456$ ceiling is exceeded only by reserved low tokens \`CQ\`/\`CQ DX\`/\`CQ TEST\`/\`QRZ\`, which are assigned dedicated values 0-3).

### 7-Bit Grid / Report Field
4-character Maidenhead grids are looked up in a 64-entry table of common global locators (values 64-127); grids outside the table hash to the same 64-127 range. Signal reports and modifiers (\`RR73\`, \`73\`, etc.) use the same 7-bit field via a separate encoding path.

---

## 🛡️ 14-Bit Cyclic Redundancy Check (CRC-14)

To eliminate false decodes under severe noise conditions, the 63-bit information vector is appended with a **14-bit CRC**:

$$P(x) = x^{14} + x^{13} + x^{10} + x^{6} + x + 1 \\quad (\\text{register constant } \\mathtt{0x2443}\\text{, } x^{14} \\text{ implicit; initial seed } \\mathtt{0x2757}\\text{, MSB-first})$$

> Earlier revisions of this page, and of both source implementations, wrote this as
> $x^{14} + x^{11} + x^2 + 1$ - a different polynomial (register constant \`0x0805\`). The two
> shipped implementations agreed with each other so nothing broke, but a third implementation
> written from that specification would have produced a CRC failing against both.
> \`tests/vectors/crc14_vectors.json\` now pins the answer for every implementation.

- **Protected Codeword Size**: $K_{\\text{total}} = 63 + 14 = 77 \\text{ bits}$ (no padding required).
- **False Decode Probability**: $P_{\\text{false}} \\approx 2^{-14} \\approx 6.1 \\times 10^{-5}$ per candidate for random errors. Costas coherence validation rejects further candidates on top of this, but the combined figure has not been measured and no number is claimed for it here.

---

## 🔢 Irregular Repeat-Accumulate LDPC (216, 77) Code

The forward error correction engine uses a systematic **Rate-0.356 Irregular Repeat-Accumulate (IRA) Low-Density Parity-Check code**:
- **Codeword Length ($N$)**: 216 channel bits ($54 \\text{ data symbols} \\times 4 \\text{ bits/symbol}$).
- **Information Bits ($K$)**: 77 bits ($63 \\text{ payload} + 14 \\text{ CRC}$).
- **Parity Equations ($M$)**: $216 - 77 = 139$ parity-check constraints.
- **Code Rate ($R$)**: $77 / 216 \\approx 0.356$.

### Parity Check Matrix $H$:
The matrix $H = [H_d \\mid H_p]$ consists of a sparse information matrix $H_d$ ($139 \\times 77$) and a dual-diagonal parity structure $H_p$ ($139 \\times 139$), ensuring linear-time $O(N)$ encoding.

---

## 🧠 Multi-Schedule Min-Sum / Sum-Product Belief Propagation Decoder

The receiver performs iterative message passing between Variable Nodes ($V_n$) and Check Nodes ($C_m$) on the bipartite Tanner graph:

\`\`\`
 Variable Nodes (LLRs)         Check Nodes (Parity Equations)
    [ V_0 ] ────────┬──────────── [ C_0 ]
    [ V_1 ] ───────┼───────────── [ C_1 ]
    [ V_2 ] ──────┼────────────── [ C_2 ]
      ...          │                ...
   [ V_215 ] ──────┴───────────── [ C_138 ]
\`\`\`

> **Correction (2026-08-31):** every earlier revision of this page described a single normalized
> min-sum schedule with a fixed $\\alpha = 0.75$. That was never what either implementation ran.
> \`z30_dsp/ldpc.py::decode_min_sum\` and \`src/dsp/ldpcCodec.ts::decodeMinSum\` have always run the
> four-schedule cascade documented below, identically in both languages. A paired benchmark
> (240 frames across SNR −24/−25/−26 dB, same frame and channel noise decoded by both the real
> cascade and a from-scratch reimplementation of the single-schedule description this page used
> to carry) found the cascade decodes strictly more frames at every point tested — 23 of 23
> disagreements went to the cascade, 0 to the single schedule (exact McNemar test, p ≈ 4×10⁻⁷,
> i.e. **>99.9999% confidence**). Per the benchmark-integrity rule in \`AGENTS.md\` §5, that clears
> the bar to correct the documentation rather than the code. See
> [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md) for the method.

### The four decode schedules

A candidate is tried against up to four schedules in order, stopping the instant any of them
produces a hard-decision codeword whose syndrome is zero **and** whose 14-bit CRC matches:

| # | Mode | $\\alpha$ | $\\beta$ | Damping | Check order | Iteration cap |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | Normalized min-sum (layered) | 0.82 | 0.08 | 0.88 | forward | 45 |
| 2 | Log-domain sum-product (exact box-plus, Jacobian-corrected) | 0.95 | — | 0.85 | forward | 40 |
| 3 | Normalized min-sum (layered) | 0.74 | 0.04 | 0.90 | **reverse** | 35 |
| 4 | Dithered normalized min-sum (random LLR perturbation before decoding) | 0.80 | 0.06 | 0.85 | forward | 30 |

That is a maximum of 150 total iterations across all four schedules for one candidate, though a
typical clean frame converges within the first schedule in single digits of iterations. Schedule
3's reverse check-node order and schedule 4's random perturbation exist to escape the trapping
sets / pseudocodewords a single deterministic schedule can stall on near the decode threshold —
the mechanism the paired benchmark above measured. \`LDPC_MAX_ITERATIONS\` (TypeScript) and the
\`max_iterations\` constructor argument (Python) both refer to schedule 1's cap (45); it is what
\`SpecsModal\` quotes, since it is also the number a well-formed frame converges within almost
always.

There is no single $\\alpha$ for "the decoder" any more than there is a single schedule — the
$0.75$ figure this page carried for years was nominal, never live. Each schedule's own
$\\alpha$/$\\beta$/damping triple above is what is actually applied at every check-node update:

$$L_{m \\to n} = \\left( \\prod_{n' \\in N(m) \\setminus \\{n\\}} \\text{sgn}(L_{n' \\to m}) \\right) \\cdot \\max\\!\\big(0,\\ \\alpha \\cdot \\min_{n' \\in N(m) \\setminus \\{n\\}} |L_{n' \\to m}| - \\beta\\big)$$

for the three normalized-min-sum schedules, or the box-plus (Jacobian-corrected) combination for
schedule 2's sum-product pass. Every check-node update is damped: the applied message is a
weighted blend of the freshly computed value and the previous iteration's message,
\`(1 − damping) × old + damping × new\`. A damping of 0.85–0.90 still moves most of the way to the
new value each iteration, just not all the way, which is what keeps the reverse-order and
dithered passes from oscillating.

### Algorithm steps (per schedule)

1. **Initialization**: Initialize variable-to-check messages $L_{n \\to m} = \\text{LLR}_n$ (schedule 4 additionally adds a small uniform random perturbation to every channel LLR first).
2. **Check Node Update**: per the table above, in the schedule's check order (forward, or reversed for schedule 3).
3. **Variable Node Update**:
   $$L_{n \\to m} = \\text{LLR}_n + \\sum_{m' \\in M(n) \\setminus \\{m\\}} L_{m' \\to n}$$
4. **Hard Decision & CRC Parity Check**:
   $$\\hat{c}_n = \\begin{cases} 0 & \\text{if } \\text{LLR}_n + \\sum_{m \\in M(n)} L_{m \\to n} \\ge 0 \\\\ 1 & \\text{if } \\text{LLR}_n + \\sum_{m \\in M(n)} L_{m \\to n} < 0 \\end{cases}$$
   If $H \\cdot \\hat{\\mathbf{c}}^T = \\mathbf{0} \\pmod 2$ and the 14-bit CRC matches, decoding terminates with **SUCCESS** immediately (often in single digits of iterations for a clean frame).
5. **Trellis-IRA re-check**: independently of the syndrome, whenever a candidate's *payload* CRC
   already matches its received CRC, the 139 parity bits are re-derived from those 77 information
   bits directly (the same forward-substitution the encoder uses) and checked against the
   syndrome — this catches a codeword whose information bits are already correct but whose noisy
   parity bits haven't converged, without spending more iterations on them.
6. **Escalation**: if a schedule's iteration cap is reached without success, the next schedule in
   the table runs on a fresh copy of the channel LLRs. If schedule 4 also fails to produce a
   CRC-valid codeword, the frame is flagged for SIC processing (see
   [05. Successive Interference Cancellation](05-Successive-Interference-Cancellation-(SIC).md)) or marked unresolvable.
`,
  },
  {
    id: "sic-engine",
    slug: "05-Successive-Interference-Cancellation-(SIC)",
    title: "05. Successive Interference Cancellation (SIC)",
    category: "Protocol & DSP",
    description: "3-Pass Successive Interference Cancellation engine for recovering buried weak DX signals under co-channel kilowatt signals.",
    tags: ["sic","interference cancellation","co-channel","collision recovery","subtraction","dx"],
    markdown: `# 05. Successive Interference Cancellation (SIC)

A fundamental challenge in digital weak-signal amateur radio is **packet collisions**: when two or more stations transmit inside the same frequency slice during the same time slot, conventional decoders (such as standard FT8) suffer destructive interference and fail to decode either signal.

**z-30** implements a **3-pass Successive Interference Cancellation (SIC)** DSP engine that solves this problem.

---

## 🎯 The Co-Channel Collision Problem

In typical HF conditions, a local kilowatt station transmitting at $+10\\text{ dB SNR}$ will completely drown out a distant DX station at $-25\\text{ dB SNR}$ if their carrier frequencies overlap within the same 50 Hz channel bandwidth:

$$\\text{SINR}_{\\text{DX}} = \\frac{P_{\\text{DX}}}{P_{\\text{local}} + N_0} \\approx \\frac{-25\\text{ dB}}{+10\\text{ dB}} = -35\\text{ dB} \\quad (\\text{Far below decodable threshold})$$

---

## ⚙️ The 3-Pass SIC Pipeline

\`\`\`
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
    [ PASS 3 ] ──> Deep DX Signals Decoded (Down to -27.5 dB SNR)
\`\`\`

---

## 🔬 Mathematical Formulation

### 1. Complex Envelope Parameter Estimation
When station $i$ is decoded in Pass 1, its known symbol sequence $\\mathbf{S}^{(i)} = [S_0, S_1, \\dots, S_{74}]$ is known with $100\\%$ certainty due to the 14-bit CRC check. The DSP engine estimates four physical parameters using Maximum Likelihood:
- $\\hat{f}_0$: Exact carrier frequency (precision $< 0.05\\text{ Hz}$).
- $\\hat{\\Delta t}$: Symbol start time delay (precision $< 1\\text{ ms}$).
- $\\hat{A}(t)$: Time-varying amplitude trajectory.
- $\\hat{\\phi}(t)$: Ionospheric phase trajectory over the 24-second frame.

### 2. Time-Domain Signal Synthesis
The clean synthetic replica $\\hat{s}_i(t)$ is generated at the native audio sampling rate ($F_s = 12000\\text{ Hz}$ or $48000\\text{ Hz}$):

$$\\hat{s}_i(t) = \\hat{A}(t) \\cdot \\cos\\left( 2\\pi \\hat{f}_0 (t - \\hat{\\Delta t}) + 2\\pi \\Delta f \\int_{0}^{t} \\sum_{k=0}^{74} S_k^{(i)} g(\\tau - k T_s - \\hat{\\Delta t})\\, d\\tau + \\hat{\\phi}(t) \\right)$$

### 3. Coherent Subtraction
The synthetic replica is subtracted from the digitized audio buffer:

$$x_{\\text{residual}}^{(1)}(t) = x_{\\text{received}}(t) - \\sum_{i \\in \\text{Pass 1}} \\hat{s}_i(t)$$

### 4. Iterative Re-Decoding
$x_{\\text{residual}}^{(1)}(t)$ is transformed back through the STDFT filterbank, and the LDPC belief-propagation decoder is executed on the residual energy. Any newly decoded packets are similarly synthesized, subtracted ($x_{\\text{residual}}^{(2)}(t)$), and passed to Pass 3.

---

## 📊 Benchmark Extraction Performance

Across Monte Carlo simulations on fading channels with co-channel collisions (0 Hz to 25 Hz frequency separation):

| Collision Differential ($\\Delta P$) | Traditional Non-SIC FT8 Decode Rate | z-30 3-Pass SIC Decode Rate |
| :--- | :--- | :--- |
| **5 dB** (Minor overlap) | 38.2% | **98.7%** |
| **12 dB** (Moderate interference) | 9.4% | **95.2%** |
| **20 dB** (Heavy local interference) | 0.8% | **91.4%** |
| **26 dB** (Deep DX buried under local QRO) | 0.0% | **84.6%** |

In the z-30 user interface, signals decoded via SIC are clearly indicated with a purple badge (**\`SIC 2\`** or **\`SIC 3\`**) in the Activity Log and Waterfall.
`,
  },
  {
    id: "cat-ptt-wiring",
    slug: "06-Transceiver-CAT-Control-&-PTT-Wiring",
    title: "06. Transceiver CAT Control & PTT Wiring",
    category: "Hardware & Rig Control",
    description: "Hamlib rigctld setup, serial configurations, and comprehensive wiring diagrams for 9 supported PTT keying methods.",
    tags: ["cat","hamlib","ptt","wiring","digirig","signalink","gpio","raspberry pi","winkeyer","tci"],
    markdown: `# 06. Transceiver CAT Control & PTT Wiring

z-30 provides complete, hardware-agnostic transceiver control via **Hamlib (\`rigctld\`)**, direct serial communication, and 9 distinct Push-To-Talk (PTT) keying architectures.

---

## 🎛️ Hamlib \`rigctld\` Daemon Architecture

Hamlib allows z-30 to communicate with over 200+ amateur radio transceivers over a standard TCP network socket (default port: \`4532\`).

### Starting \`rigctld\` Manually:
\`\`\`bash
# Example: Icom IC-7300 (Model 3073) on /dev/ttyUSB0 at 19200 baud
rigctld -m 3073 -r /dev/ttyUSB0 -s 19200 -T 127.0.0.1 -t 4532

# Example: Yaesu FT-991A (Model 1035) on COM4 at 38400 baud (Windows)
rigctld -m 1035 -r COM4 -s 38400

# Example: Elecraft K3/K4 (Model 2029) on /dev/ttyUSB0 at 38400 baud
rigctld -m 2029 -r /dev/ttyUSB0 -s 38400
\`\`\`

---

---

## 🔌 Which transport carries your CAT commands

The **CAT Method** you choose in Station Settings decides this, and nothing else does:

| CAT Method | Frequency, mode and CAT keying go to |
| :--- | :--- |
| \`Hamlib\` | The \`rigctld\` daemon, through the native server's TCP relay (\`/api/rigctl\`) |
| \`Direct Serial\` | The paired Web Serial port, as that rig family's own native protocol |
| \`None\` | Nowhere — VOX or hardware keying only, and you tune the radio yourself |

Two consequences worth knowing:

- **Hamlib mode needs the native server.** A browser cannot open a TCP socket to a daemon, so
  \`rigctld\` is only reachable when z-30 is launched through \`z30-web\`. Opened as a plain page,
  Hamlib mode has nowhere to send a command, and the app now refuses and says so rather than
  reporting a set that never left the browser.
- **Pairing a serial port no longer changes your CAT transport.** It used to: pairing a port
  for RTS keying silently moved CAT off the daemon and onto raw bytes written to that port —
  a port \`rigctld\` already had open.

**A CAT command that could not be sent is reported as a failure** — in the rig log, in the raw
console's \`RPRT\` reply, and in the transmit banner. Nothing answers "OK" for a command the radio
never received.

### Direct Serial protocol coverage

\`Direct Serial\` speaks each family's real protocol, and only where that protocol is known:

| Rigs | Protocol | PTT command |
| :--- | :--- | :--- |
| Icom, Xiegu | CI-V (\`FE FE <addr> E0 …\`) | \`1C 00 01\` / \`1C 00 00\` |
| Kenwood, Elecraft | Kenwood ASCII, 11-digit \`FA\` | \`TX;\` / \`RX;\` |
| Yaesu FT-991/991A, FTDX10, FTDX101, FT-710, FT-891 | Yaesu new-CAT ASCII, **9-digit** \`FA\`, \`MD0x;\` | **\`TX1;\` / \`TX0;\`** |
| Everything else — including FT-817/857/897 and the 1990s Yaesu rigs | *not implemented* | use \`rigctld\` |

Yaesu is **not** Kenwood, despite the family resemblance: \`TX;\` is Yaesu's PTT *read* command and
keys nothing, there is no \`RX;\` in the Yaesu set, and \`FA\` takes nine digits rather than eleven.
z-30 sent the Kenwood forms to every Yaesu rig until this was fixed, which meant a Yaesu station
passed its CAT test and then never keyed.

For any rig outside that table, \`Direct Serial\` refuses and names \`rigctld\` instead of guessing a
command set. Hamlib carries per-model command tables; this app does not duplicate them.

**A Direct Serial CAT test confirms the write, not the radio's answer.** There is no serial read
loop in \`catController.ts\` — the reader handle is only ever cancelled, never assigned — so in
\`Direct Serial\` mode a passing "Test CAT Connection" means the bytes left the port, not that the
rig understood them. Reading replies means a per-rig response parser for every family, which is
what \`rigctld\` already is; Hamlib mode therefore verifies the rig's actual reply and Direct Serial
mode does not. If you need a CAT link proven end to end, test it in Hamlib mode — and see
[Reading the rig back](#-reading-the-rig-back) below for what that then buys you.

---

## 🔁 Reading the rig back

Sending a command is not the same as knowing where the radio is, and for most of this project's
life z-30 treated them as the same thing. \`setFreqHz()\` assigns the app's dial from its own
argument *before* anything reaches the wire and never revises it, so the dial the transmit gate
checked against the band plan was the dial the software had asked for — not the one the
transmitter was on. Four ordinary situations broke that assumption:

- a \`set_freq\` the daemon refused (\`RPRT -1\`) — logged as an error, but the app's dial had
  already moved;
- an operator who turned the VFO knob after the app last commanded it;
- a rig that quantises the dial and sits tens of Hz from the frequency it was given;
- \`rigctld\` still running while the radio behind it is switched off or unplugged.

In each of those the band-plan check was being run against a fiction, and then the transmitter
was keyed on it.

**The model is WSJT-X's**, ported from \`Transceiver/PollingTransceiver.cpp\` and
\`Transceiver/TransceiverBase.cpp\` into \`src/dsp/rigStateTracker.ts\`. WSJT-X keeps two states —
what the software requested, and what the rig reported when last read — polls the rig on an
interval, and lets only the reading be the truth. z-30 now keeps the same two, and the transmit
gate consults both.

| | Where it comes from | What it is for |
| :--- | :--- | :--- |
| **Commanded dial** | \`setFreqHz()\` / the band buttons | The app's own VFO, the UI, the band-plan check |
| **Reported dial** | \`f\` polled through the \`rigctld\` relay, once a second | Contradicting the above when the radio disagrees |

### What it refuses, and what it deliberately does not

The check adds refusals and removes none. It fires only on **positive evidence** of a mismatch,
and three cases that look like mismatches are not treated as any:

- **No readback at all is "unverified", not "wrong".** \`Direct Serial\` has no response parser,
  a VOX-keyed station has no CAT link, and a page opened without the native server has no relay.
  All of them transmit exactly as before. A gate that grounded every station that cannot read its
  rig back would be switched off by the first operator who met it.
- **A QSY still settling is not a disagreement.** A poll that crossed with the frequency command
  answers with the *old* dial. WSJT-X allows three polls for the rig to arrive
  (\`polls_to_stabilize\`); so does z-30. Refusing on that reading would refuse the very slot the
  band change was made for.
- **A difference the rig's own tuning resolution explains is not a disagreement.** See below.

Losing contact with the rig returns the station to *unverified* — it does not block it. A relay
hiccup must not ground a station, and it does not unkey one either: \`RigStateTracker.goOffline()\`
diverges from WSJT-X's \`offline()\` here on purpose. WSJT-X drops PTT on a rig it can no longer
talk to, because on WSJT-X the CAT link *is* the keying line. On z-30 it usually is not — the
line is on a CM108 GPIO, a Pi header pin, an RTS pin on a second cable, or a TCI socket — so a
failed CAT poll is not evidence about the transmitter, and unkeying on one would truncate a good
frame every time the local relay stuttered. Stuck-transmitter defence stays where it already is:
the browser watchdog, the server-side dead-man switch, and the \`atexit\` pin release.

### Your rig's tuning resolution is measured, not assumed

Plenty of radios do not tune where they are told. Ask for 14 076 055 Hz and a rig that truncates
to 100 Hz gives you 14 076 000 Hz — working exactly as designed, and 55 Hz from where the app
thinks it is. Treating that as a fault would put every such rig permanently out of compliance
with itself.

So z-30 measures it, using the probe from WSJT-X's \`HamlibTransceiver::do_start\`: command a
frequency ending in 55, read back what the rig made of it, and classify the difference.

| Read-back offset | Rig resolution |
| :--- | :--- |
| 0 Hz | 1 Hz — tunes exactly where told |
| −5 Hz | 10 Hz truncated |
| +5 Hz | 10 Hz rounded (a second probe separates this from 20 Hz rounded) |
| −15 Hz | 20 Hz truncated |
| −55 Hz | 100 Hz truncated |
| +45 Hz | 100 Hz rounded |

The probe runs when you press **Test CAT Connection** in Hamlib mode — it moves the VFO by a few
tens of Hz and puts it back, so it is behind a button you pressed rather than on an automatic
path that could fire mid-QSO. It never runs while keyed. Until it has run, the tolerance stays at
a strict 1 Hz; assuming 100 Hz for everybody would hand a 1 Hz rig 99 Hz of unearned slack at a
band edge.

Truncation is treated as one-sided: a rig that drops the remainder only ever lands *low*, so it
is granted no slack upwards.

### Polls are quiet and non-intrusive

Only \`f\` and \`t\` are polled — both are reads. Nothing here moves a VFO, so tuning the dial by
hand is not a fight with the software. Successful polls write **nothing** to the rig control log;
only the transitions do — contact lost, contact regained, and a dial that disagrees. WSJT-X
compiles its own poll tracing out by default (\`TRACE_CAT_POLL\`) for the same reason: a diagnostic
log that scrolls once a second is not one anybody reads.

Polling also stops for 100 ms either side of a PTT transition, and so does any frequency or mode
command. That number is WSJT-X's, from the sleep in \`TransceiverBase::set\`, and so is the reason:
*some rigs cannot process CAT commands while switching from Tx to Rx.*

---

## ⚡ 9 Supported PTT Keying Architectures

### 1. CAT Software Command (\`CAT\`)
- **How it works**: Sends the rig family's own PTT command (see the table above) over the serial
  link, or \`T 1\` / \`T 0\` to \`rigctld\` in Hamlib mode.
- **Best for**: Radios with built-in USB interfaces (Icom IC-7300, IC-705, Yaesu FT-710, FT-991A, Kenwood TS-590SG, Elecraft K4, Xiegu G90/X6100).
- **Pros**: Zero extra cables or hardware required.
- **Reports failure**: if no protocol is configured for your rig, no port is open, or \`rigctld\`
  refuses the command, keying fails visibly and no audio is transmitted.

### 2. RTS Hardware Serial Line (\`RTS\`)
- **How it works**: Toggles the Request To Send (RTS) pin on an RS-232 or USB-to-UART bridge (CP2102, FTDI FT232, CH340).
- **Best for**: **Digirig Mobile**, **Rigblaster**, **microHAM**, and homebrew optocoupler interfaces.
- **Wiring Pinout**:
  \`\`\`
  PC USB/Serial Port RTS (Pin 7 on DB9) ──[ 1kΩ Resistor ]── Base of 2N2222 / 2N3904 (or Optocoupler Pin 1)
  PC Ground (Pin 5 on DB9) ──────────────────────────────── Emitter (or Optocoupler Pin 2)
  Radio PTT Line ────────────────────────────────────────── Collector (or Optocoupler Pin 4)
  Radio Ground ──────────────────────────────────────────── Emitter Ground (or Optocoupler Pin 3)
  \`\`\`

### 3. DTR Hardware Serial Line (\`DTR\`)
- **How it works**: Toggles the Data Terminal Ready (DTR) line (Pin 4 on DB9).
- **Best for**: Legacy interfaces, dual-channel CW/PTT keyers, or interfaces using DTR for PTT and RTS for CW keying.

#### If PTT is on a different cable from CAT

\`RTS\`, \`DTR\` and \`WINKEYER\` key the **CAT port** by default, which is what a single-cable station
(a Digirig, a rig with one USB connection) wants. If your keying line is on a *second* cable, use
**Pair PTT Port** in Station Settings → PTT. Until that exists, the app drives the CAT port's line
— for a while it did that while printing the configured PTT port's name, so the message named one
cable and the hardware saw another.

#### Opening a port no longer keys your radio

Both Chromium's Web Serial and pyserial assert DTR and RTS when a port opens. On an RTS- or
DTR-keyed station that is a transmit command: connecting the cable put the radio into transmit
before any check had run. z-30 now drops both lines immediately after opening any port — the CAT
port, the PTT port, and the port the setup wizard opens for its keying test.

#### Polarity applies to the hardware, not just the label

\`ACTIVE_LOW\` inverts what is driven, on **RTS, DTR, CM108/CM119 and Raspberry Pi GPIO alike**.
CM108 keying used to ignore the setting entirely, so an active-low DRA or URI interface was driven
backwards — no carrier while transmitting, PTT asserted while receiving — while the wiring test
printed "Active Low" and reported a pass.

### 4. Right-Channel Audio PTT Tone (\`AUDIO_TONE_RIGHT\`)
- **How it works**: Modulates the Left stereo channel with the 16-MFSK data audio while outputting a continuous 1000 Hz or 1500 Hz sinusoidal tone on the Right stereo channel during transmission.
- **Best for**: **SignaLink USB** (in tone-trigger mode), handheld transceivers (Baofeng, Anytone, Yaesu FT-65 via phone audio jacks), and field smartphone/tablet operations.
- **Hardware Circuit**: The right audio channel is rectified using a Schottky diode bridge ($1\\text{N}5711$), smoothed with a $10\\,\\mu\\text{F}$ capacitor, and drives a switching transistor or VOX circuit.

### 5. C-Media CM108 / CM119 USB GPIO (\`CM108_GPIO\`)
- **How it works**: Sends raw USB HID feature reports to toggle GPIO3 (Pin 13) or GPIO4 (Pin 14) directly inside C-Media USB soundcard chips without needing a serial UART port.
- **Best for**: Masters Communications **DRA-30 / DRA-50 / DRA-70**, Repeater-Builder RIM boards, URIxB interfaces.
- **Wiring**: GPIO3 is pulled high (Active High) or low (Active Low) to drive the PTT MOSFET.

### 6. Raspberry Pi / Linux SBC Direct GPIO (\`RASPBERRY_PI_GPIO\`)
- **How it works**: Toggles Linux sysfs/libgpiod pins directly on Raspberry Pi (3B, 4B, 5, Zero 2W, Orange Pi).
- **Default Pin**: BCM Pin 17 (Physical Pin 11) or BCM Pin 27 (Physical Pin 13).
- **Circuit**: Pi GPIO Pin $\\to 1\\text{k}\\Omega \\to$ Gate of 2N7000 MOSFET $\\to$ Radio PTT line.

### 7. Voice-Operated Transmit (\`VOX\`)
- **How it works**: Transmits audio directly and relies on the transceiver internal VOX or SignaLink Auto-VOX circuit to trip PTT.
- **Note**: Ensure transceiver VOX Anti-Trip and Delay settings are adjusted to prevent premature dropout.

### 8. TCI Network Protocol (\`TCI_NETWORK\`)
- **How it works**: High-speed bidirectional WebSocket network protocol for modern Software Defined Radios (Expert Electronics SunSDR2 PRO, SunSDR2 DX, MB1).
- **Default Port**: \`40001\` or \`50001\`. Supports zero-latency frequency, mode, S-meter, and PTT streaming.

### 9. K1EL WinKeyer 2/3 (\`WINKEYER\`)
- **How it works**: Communicates with K1EL WK2/WK3 ICs over serial to execute timed hardware PTT assertion with configurable lead-in ($20\\text{ ms}$) and tail hangover ($30\\text{ ms}$) delays.
`,
  },
  {
    id: "rf-time-sync",
    slug: "07-RF-Time-Synchronization-Engine",
    title: "07. RF Time Synchronization Engine",
    category: "Hardware & Rig Control",
    description: "Sub-millisecond radio frequency time synchronization against international standards (WWV, CHU, DCF77, MSF, WWVB, JJY).",
    tags: ["time sync","wwv","chu","dcf77","msf","jjy","clock drift","fir filter","field ops"],
    markdown: `# 07. RF Time Synchronization Engine

Synchronous digital modes like z-30 rely on strict **30-second UTC slot alignment**. When operating in remote field locations (such as SOTA, POTA, maritime mobile, or emergency disaster response) without internet NTP or GPS time receivers, system clocks drift quickly.

**z-30** includes an embedded DSP tool (\`z30_dsp/rf_time_sync.py\` and the in-app **\`SYNC TIME\`** workbench) that synchronizes the clock directly against international HF and LF time standard stations over the air.

---

## 📡 Supported Time Standard Broadcast Stations

| Station | Location | Frequencies | Modulation & Timing Signals |
| :--- | :--- | :--- | :--- |
| **WWV / WWVH** | Fort Collins, Colorado / Kauai, Hawaii | 2.5, 5.0, 10.0, 15.0, 20.0 MHz | 1000 Hz / 1200 Hz tone bursts (5 ms tick), 100 Hz BCD subcarrier |
| **CHU** | Ottawa, Canada | 3.330, 7.850, 14.670 MHz | 1000 Hz second ticks (300 ms), 300-baud Bell 103 AFSK timecode on seconds 31–39 |
| **DCF77** | Mainflingen, Germany | 77.5 kHz (LF) | 1 Hz AM carrier dips (100 ms / 200 ms PWM) + PRBS phase modulation |
| **MSF** | Anthorn, United Kingdom | 60.0 kHz (LF) | Fast dual-pulse carrier on/off keying |
| **WWVB** | Fort Collins, Colorado | 60.0 kHz (LF) | 17 dB carrier power reductions (0.2s, 0.5s, 0.8s) + BPSK phase modulation |
| **JJY** | Fukushima / Saga, Japan | 40.0 kHz / 60.0 kHz (LF) | 1 Hz carrier amplitude keying |

---

## 🔬 DSP Time Calibration Pipeline

\`\`\`
   Radio Audio (Tuned to Time Station)
                │
   [ 5-Second Rapid Signal Pre-Validation ]
                │
   [ 61-Tap Windowed-Sinc FIR Bandpass Filter ] (e.g. Center: 1000 Hz, Q: 30)
                │
   [ Envelope Demodulation & Squaring ]
                │
   [ Normalized Cross-Correlation R_xy(tau) ] Against Reference Pulse
                │
   [ Peak Sub-Sample Quadratic Interpolation ]
                │
   [ Clock Offset Delta t = T_RF - T_System ] (Precision < 1.5 ms)
                │
   [ Apply Zero-Admin Offset Calibration ] (appTimeOffsetMs)
\`\`\`

---

## 🎛️ Using RF Time Sync in the Application

### 1. In the Web / PWA Interface:
1. Click the **\`SYNC TIME\`** button in the header (or in the Setup Wizard / Settings).
2. Choose your preferred standard station (e.g., **WWV 10.000 MHz** or **CHU 7.850 MHz**).
3. Tune your receiver dial to the frequency in **USB** mode.
4. Click **"Calibrate Time Offset"**.
5. Watch the live correlation peak curve. Once locked, click **"Apply Offset to Station"**. z-30's own slot timing adjusts immediately, without root or administrative permissions - the machine's system clock is left alone unless you have explicitly opted in (see the note below).

### 2. From the Python CLI:
\`\`\`bash
# Run the automated RF time calibration scanner
z30-sync

# or via the unified z30 CLI:
z30 --sync
\`\`\`

> **The system clock is not touched by default.** A time station is an unauthenticated
> broadcast: anyone can transmit a WWV-shaped signal, and a marginal decode can produce a wrong
> timestamp with no adversary at all. z-30 therefore applies the correction internally as
> \`app_time_offset_ms\`, which is all the decoder needs, and never steps the machine's clock
> unless you explicitly opt in - by setting \`"allow_set_system_clock": true\` in
> \`~/.z30/config.json\` or exporting \`Z30_ALLOW_SET_SYSTEM_CLOCK=1\`. Even then, a proposed step
> of more than 5 minutes is refused as a misdecode or a spoof, and z-30 declines to fight an
> NTP daemon that already owns the clock.

Output example:
\`\`\`
=============================================================
  z-30 RF Standard Station Time Synchronization Engine
=============================================================
[+] Scanning standard stations: WWV, CHU, DCF77, MSF, WWVB, JJY...
[+] Listening to audio stream (48000 Hz)...
[+] Station Detected: WWV (Fort Collins, CO) on 10.000 MHz
[+] FIR Filter: 61-tap Windowed-Sinc (Fc = 1000 Hz, BW = 40 Hz)
[+] Peak Correlation: 0.942 at sample offset +144
[+] Measured Time Offset (Delta t): +12.4 ms (+/- 0.8 ms)
[SUCCESS] Application clock calibrated: Delta t = +12.4 ms.
\`\`\`
`,
  },
  {
    id: "web-pwa",
    slug: "08-Web-&-PWA-Architecture",
    title: "08. Web & PWA Architecture",
    category: "Advanced & Packaging",
    description: "Frontend internals: React 19, TypeScript, Web Audio API 12/48 kHz DSP, 60 FPS HTML5 Canvas waterfall, and PWA caching.",
    tags: ["react","typescript","web audio","canvas","waterfall","pwa","service worker"],
    markdown: `# 08. Web & PWA Architecture

This document describes the modern web architecture of the **z-30** transceiver client, built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and the **HTML5 Web Audio & Canvas APIs**.

---

## 🏗️ Architecture & Component Hierarchy

\`\`\`
                                    App.tsx (Master Transceiver Hub)
                                                  │
   ┌──────────────────────┬───────────────────────┼───────────────────────┬──────────────────────┐
   │                      │                       │                       │                      │
[ Header.tsx ]    [ WaterfallDisplay.tsx ] [ ActivityLogTable.tsx ] [ QsoMacrosTransmitPanel.tsx ] [ QsoController.tsx ]
- UTC Clock       - 60 FPS Canvas          - Filter Matrix        - 6 TX Macros          - DX Target State
- 30s Progress    - 10 Scientific Palettes - Decodes History      - Auto-Reply Rules     - S-Meter / SWR
- TX/Tune Hooks   - Carrier Arming Hook    - SIC Pass Badges      - PTT Watchdog Timer   - Power Display
\`\`\`

---

## 🔊 Web Audio API Pipeline (\`src/dsp/audioEngine.ts\`)

The audio engine processes both synthesized transmission tones and digitized receiver audio in real-time:

### 1. Transmission Tone Synthesis
- **Sample Rate**: $48000\\text{ Hz}$ internal sampling rate.
- **Waveform**: Smooth continuous-phase sine synthesizer with raised-cosine windowing across symbol transitions:
  \`\`\`typescript
  // 320ms per symbol with phase continuity
  phase += 2 * Math.PI * currentToneFreqHz / sampleRate;
  \`\`\`
- **Stereo Routing**:
  - **Left Channel**: 16-MFSK Digital Audio modulation.
  - **Right Channel**: Optional 1000/1500 Hz sinusoidal PTT keying tone for audio-switched interfaces.

### 2. Live Receiver Audio Capture
- Uses \`navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })\` to obtain raw unadulterated RF audio.
- Routes through an \`AudioContext\` and \`AnalyserNode\` with an FFT size of $4096$ bins ($11.7\\text{ Hz/bin}$) for 60 FPS waterfall rendering.

---

## 🎨 60 FPS HTML5 Canvas Waterfall Engine (\`src/dsp/WaterfallDisplay.tsx\`)

- **High-Performance Direct Pixel Buffer**: Manipulates raw 32-bit \`Uint32Array\` pixel memory inside an \`ImageData\` buffer to achieve a continuous 60 frames per second with $< 2\\%$ CPU utilization.
- **10 Scientific Colormaps**: Precomputed 256-level RGB look-up tables (LUTs):
  1. \`Turbo\` (Google DeepMind Perceptually Uniform)
  2. \`Inferno\` (Matplotlib High-Contrast)
  3. \`Viridis\` (Optimal Dynamic Range)
  4. \`Plasma\` & \`Magma\`
  5. \`WSJT-X Classic\` (Familiar Ham Radio Palette)
  6. \`Night Vision Green\` & \`Amber CRT\` (Tactical / Field Palettes)
  7. \`High-Contrast B&W\` & \`Spectral Heatmap\`
- **Interactive Carrier Arming**: Double-clicking anywhere on the waterfall calculates the carrier audio frequency, arms TX, and matches the opposite transmit slot automatically.

---

## 📱 Progressive Web App (PWA) & Offline Capability

- **\`manifest.json\`**: Provides full Android and desktop PWA metadata with standalone fullscreen launch modes and 192px/512px vector icons.
- **\`sw.js\` (Service Worker)**: Caches application assets, font vectors, and DSP libraries to enable 100% offline field operation without internet access.
`,
  },
  {
    id: "packaging",
    slug: "09-Cross-Platform-Build-&-Packaging",
    title: "09. Cross-Platform Build & Packaging",
    category: "Advanced & Packaging",
    description: "Packaging and build instructions for Ubuntu, Arch Linux PKGBUILD, Windows .bat / .exe, Android Termux, and Raspberry Pi.",
    tags: ["packaging","ubuntu","arch linux","pkgbuild","windows","android","termux","raspberry pi","digipi"],
    markdown: `# 09. Cross-Platform Build & Packaging

This document provides packaging and build instructions for deploying **z-30** across **Ubuntu/Debian**, **Arch Linux**, **Windows 10/11**, **Android (Termux & PWA)**, **Raspberry Pi (DigiPi)**, and **PyPI / Universal Wheel** packages.

---

## 🐧 1. Ubuntu & Debian (20.04 / 22.04 / 24.04 / Mint / Pop!_OS)

### Automated Setup Script:
\`\`\`bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_ubuntu.sh
./install_ubuntu.sh
\`\`\`

The script:
1. Installs system packages via \`apt-get\` (\`libportaudio2\`, \`libhamlib-utils\`, \`python3-venv\`, \`nodejs\`, \`npm\`).
2. Creates an isolated virtual environment at \`~/.z30-env\`.
3. Compiles the web GUI into embedded distribution files.
4. Generates a desktop launcher in \`~/.local/share/applications/z30.desktop\`.

---

## 🏹 2. Arch Linux, Manjaro, EndeavourOS & CachyOS

### Method A: Automated Script (\`install_arch.sh\`)
\`\`\`bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_arch.sh
./install_arch.sh
\`\`\`

### Method B: Native Arch Package (\`PKGBUILD\` + \`makepkg\`)
\`\`\`bash
# Build and install package via pacman:
makepkg -si
\`\`\`

---

## 🪟 3. Windows 10 & 11 (64-Bit)

### Option A: One-Click Batch Launcher
1. Install Python 3.9+ from [python.org](https://www.python.org/) with **"Add python.exe to PATH"** checked.
2. Clone or download the repository.
3. Double-click \`run_windows.bat\`.

### Option B: PyInstaller Standalone \`.EXE\` Build
To build a standalone executable without requiring Python on client computers:
\`\`\`cmd
build_windows.bat
\`\`\`
Output executable: \`dist\\z30-transceiver\\z30-transceiver.exe\`

---

## 🤖 4. Android (PWA & Termux Field Operations)

**Mode A is the only Android mode that carries live audio.** Mode B gives you the Python CLI and
the DSP tools, not a transceiver — see the limitation below before planning a portable station
around it.

### Mode A: Progressive Web App (Instant Install)
1. Open the z-30 URL in **Chrome** or **Brave** on your Android tablet or smartphone. The address
   must be **\`https://\`**, or **\`http://localhost\`** / **\`http://127.0.0.1\`** when the server runs
   on the same device.
2. Tap \`(⋮)\` $\\to$ **"Install app"** or **"Add to Home screen"**.
3. Runs in standalone fullscreen, taking receive audio from the browser via \`getUserMedia\`.

> **A plain \`http://\` LAN address does not work**, and it fails quietly. Pointing the phone at a
> PC's local IP (\`http://192.168.x.x:3000\`, the Vite dev server) is not a
> [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), so
> Chrome offers no install prompt, the service worker registration in \`src/main.tsx\` is rejected,
> and \`getUserMedia()\` never grants the microphone. The app loads and then cannot hear anything,
> which looks like a broken decoder rather than a URL scheme problem. Serve it over HTTPS, or open
> it on the device that is running it.
>
> Note also that the service worker only registers in a production build (it is gated on
> \`import.meta.env.PROD\`), so \`npm run dev\` gives no offline support even over HTTPS.

### Mode B: Termux Linux Field Environment (CLI & DSP tools)
Runs the Python side — \`--benchmark\`, \`--sync\`, \`--bands\` — on the phone itself:
\`\`\`bash
pkg update && pkg install -y git curl python nodejs
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_android_termux.sh
./install_android_termux.sh
z30
\`\`\`

> **Termux carries no audio, and this is not a configuration problem.** PortAudio binds neither
> host API Android offers (OpenSL ES, AAudio), the Termux PortAudio build has ALSA and JACK
> compiled out, and Android does not expose raw ALSA-compatible hardware to Termux's Linux
> userspace at all. \`sounddevice\` and PyAudio therefore return an empty device list no matter what
> is plugged into the USB OTG port and regardless of Termux:API microphone permission.
>
> Real-time RX/TX audio does not work under Termux, and neither does a USB OTG audio interface
> such as a Digirig. \`install_android_termux.sh\` installs what it can and \`z30 --sync\` falls back
> to its synthetic RF simulator, but treat Android/Termux as CLI/DSP-only rather than a full
> transceiver. Use **Mode A** for on-air audio.
>
> USB OTG *serial* CAT depends on the same unrooted device-node access and should not be assumed
> to work either — verify it against your own radio before relying on it in the field.

---

## 🥧 5. Raspberry Pi & Embedded Linux (DigiPi / SBCs)

Tested on **Raspberry Pi 3B+, 4B, 5, and Zero 2W** running Raspberry Pi OS (32-bit & 64-bit):
\`\`\`bash
sudo apt-get update && sudo apt-get install -y python3-pip python3-venv libportaudio2 portaudio19-dev libhamlib-utils nodejs npm
git clone https://github.com/themantas1994/z-30.git
cd z-30
./install_ubuntu.sh
\`\`\`
- **Hardware PTT**: Configure PTT Method to **\`Raspberry Pi GPIO\`** in the setup wizard (default: BCM Pin 17).

---

## 📦 6. Universal Python PEP 517 / 621 Wheel Packaging

To build a universal distributable Python wheel:
\`\`\`bash
pip install build wheel
python3 -m build --wheel
pip install dist/*.whl
\`\`\`
`,
  },
  {
    id: "troubleshooting",
    slug: "10-Troubleshooting-&-FAQ",
    title: "10. Troubleshooting & FAQ",
    category: "Getting Started",
    description: "Frequently asked questions, common audio soundcard setup issues, Windows Python PATH fixes, CAT permission fixes, and ALC level calibration.",
    tags: ["faq","troubleshooting","errors","windows","python","audio","alc","permissions","dialout","linux"],
    markdown: `# 10. Troubleshooting & FAQ

This document addresses common questions, operating issues, hardware setup challenges, and error recovery steps for **z-30**.

---

## ❓ Frequently Asked Questions (FAQ)

### Q1: Why does z-30 use a 30-second cycle instead of 15 seconds like FT8?
**A**: Doubling the cycle to 30.0 seconds and halving the symbol rate from 6.25 to 3.125 baud doubles the energy per symbol, and a rate-0.356 code over 75 symbols spends considerably more redundancy per information bit than FT8's rate-0.52 (174, 91). Both buy coding gain.

z-30's benchmark measures the on-air case directly: with random carrier and timing offsets, blind acquisition and non-coherent demodulation, 50% decode is at **-23.1 dB SNR** on AWGN and **-21.3 dB** on a CCIR-moderate path. FT8's published -21 dB is measured the same way, so **z-30 decodes about 2.1 dB deeper than FT8 on AWGN** - but it transmits for 24.0 s against FT8's 12.64 s (2.8 dB more energy) and carries 14 fewer message bits, so it buys that depth with airtime rather than with a better code. The genie-aided bound is -24.6 dB; comparing that with anyone's on-air figure is invalid. Earlier revisions of this page claimed "+4.0 dB over FT8" on exactly that invalid comparison, and it stays withdrawn - the 2.1 dB above is blind-acquisition on both sides.

### Q2: Why is the occupied bandwidth only 50 Hz?
**A**: 16 orthogonal tones spaced at $3.125\\text{ Hz}$ occupy exactly $16 \\times 3.125 = 50.0\\text{ Hz}$. This allows up to **50 simultaneous contacts** inside a standard 2.7 kHz SSB transceiver passband without mutual interference.

### Q3: What does the purple "SIC 2" or "SIC 3" badge mean in my decodes?
**A**: This indicates that the message was recovered through **Successive Interference Cancellation**. A stronger local station was initially masking the signal; z-30 synthesized and subtracted the strong carrier waveform in Pass 1, unmasking this weaker DX contact in Pass 2 or Pass 3.

---

## 🛠️ Common Issues & Solutions

### 1. No Decodes on the Waterfall (Audio RX Troubleshooting)
- **Check Audio Level**: Ensure the background noise floor on the waterfall is visible (dark blue with speckles) and that the VU meter registers between 30% and 60%.
- **Check Mode**: Ensure your transceiver is set to **\`USB\`** (Upper Sideband) or **\`USB-D\` / \`PKT-USB\` (Data mode)**. Never use LSB on digital modes.
- **Check Filter Bandwidth**: Open your radio's IF filter to maximum width (e.g., $3.0\\text{ kHz}$ or $3.6\\text{ kHz}$) so the entire audio waterfall is received.
- **Microphone Permissions**: In browser/PWA mode, ensure microphone permission is granted in browser site settings.

### 2. High ALC / Distorted TX Audio (Transmitter Overdriving)
- **Symptom**: Radio ALC meter is pegged in the red zone; other stations report distorted or wide tones.
- **Solution**: Lower your computer or USB soundcard output volume until the radio's ALC meter shows **zero deflection** or 1 bar maximum. Digital 16-MFSK requires a pure linear amplification chain.

### 3. CAT Serial Port Permission Denied on Linux (\`/dev/ttyUSB0\`)
- **Symptom**: \`PermissionError: [Errno 13] Permission denied: '/dev/ttyUSB0'\`
- **Solution**: Add your user to the \`dialout\` (Ubuntu/Debian) or \`uucp\` (Arch Linux) group:
  \`\`\`bash
  # On Ubuntu / Debian:
  sudo usermod -a -G dialout $USER

  # On Arch Linux / Manjaro:
  sudo usermod -a -G uucp $USER

  # Log out and log back in for changes to take effect!
  \`\`\`

### 4. Transceiver Does Not Key into Transmit (PTT Issues)

**Read the rig control log first.** Every keying attempt writes a line there, and a command that
could not be sent is recorded as an \`ERROR\` naming the missing piece — no port open, no protocol
for this rig, \`rigctld\` refused, HID device not paired. A refused transmission also appears in the
transmit banner, and no audio is generated when keying fails.

- **CAT Mode**: Verify baud rate matches the radio menu setting. Check that the radio is in \`Data Mode\` (e.g., \`USB-D\`).
- **CAT Mode, Yaesu, Direct Serial**: only the FT-991/991A, FTDX10, FTDX101, FT-710 and FT-891 are
  driven directly. Any other Yaesu — the FT-817/857/897 included — needs \`rigctld\`; z-30 refuses
  rather than sending a command set it cannot verify for your model.
- **CAT Mode, "Hamlib"**: \`rigctld\` is only reachable when z-30 runs through its native server
  (\`z30-web\`). From a plain page there is no relay and CAT keying will refuse.
- **\`rigctld\` answers \`RPRT -1\`**: the daemon is running but refused the command. A daemon started
  with \`-P NONE\` has no PTT to key — restart it with the right \`-P\` for your interface.
- **Digirig / RTS Mode**: Ensure PTT Method is set to **\`RTS\`** on the proper COM/tty port. If the
  keying line is on a *second* cable, pair it with **Pair PTT Port** in Station Settings → PTT;
  otherwise keying goes to the CAT port.
- **Polarity**: if the radio transmits while receiving and stays silent while transmitting, the
  \`ACTIVE_HIGH\` / \`ACTIVE_LOW\` setting is inverted for your interface.
- **SignaLink USB Mode**: If using Right-Channel audio tone, ensure PTT method is set to **\`Audio Tone (Right Channel)\`** and soundcard balance is centered.
- **\`z30 --tkinter\`**: that window is receive-only — it has no modulator and no keying. Transmit
  from the web transceiver (\`z30-web\`).

### 5. High Time Offset ($\\Delta t > 1.5\\text{ s}$)
- **Symptom**: Transmissions start late; decodes show high $\\Delta t$.
- **Solution**:
  - If internet is available: Synchronize Windows/Linux clock via NTP.
  - If offline: Click **\`SYNC TIME\`** in the z-30 header, tune to WWV/CHU/DCF77, and click **Calibrate** to apply zero-admin DSP clock calibration.
`,
  },
  {
    id: "physics-vs-ft8",
    slug: "11-Physics-&-Comparative-Analysis-z30-vs-FT8",
    title: "11. Physics & Comparative Analysis: z-30 vs. FT8",
    category: "Protocol & DSP",
    description: "Communication physics, the Shannon limit, 16-MFSK against 8-MFSK, and an honest account of what z-30's benchmark does and does not measure.",
    tags: ["physics","ft8","shannon","snr","link budget","rf engineers","advanced","16-mfsk","ldpc","sic","polar flutter","coherence"],
    markdown: `# 11. Physics & Comparative Analysis: z-30 vs. FT8

An in-depth technical analysis for **advanced amateur radio operators, RF engineers, and digital signal processing specialists** detailing the underlying communication physics, information theory, and digital signal processing advantages of **z-30** relative to **FT8** and other weak-signal protocols.

---

## 🔬 1. Executive Summary & Parameter Comparison

| Metric / Parameter | FT8 (Franke-Taylor 8-FSK) | z-30 (16-MFSK Weak-Signal) | Physics & Engineering Delta |
| :--- | :--- | :--- | :--- |
| **Decoding Threshold ($SNR_{2500}$)** | **-21.0 dB** (measured on the air) | **-23.1 dB (50%) / -21.7 dB (90%)** (blind acquisition, AWGN) | $-2.1\\text{ dB}$, bought with $+2.8\\text{ dB}$ of airtime - see the note below |
| **Transmission Slot Duration** | 15.0 s (12.64 s active TX) | 30.0 s (24.0 s active TX) | $2\\times$ integration time ($+3.01\\text{ dB}$) |
| **Modulation Format** | 8-MFSK (Continuous Phase) | 16-MFSK (Continuous Phase) | Higher-order orthogonal signaling efficiency |
| **Occupied Bandwidth** | 47.0 Hz ($8 \\times 6.25\\text{ Hz}$) | 50.0 Hz ($16 \\times 3.125\\text{ Hz}$) | Ultra-narrowband density (50 channels in 2.7 kHz) |
| **Tone Spacing ($\\Delta f$)** | 6.25 Hz | 3.125 Hz | $50\\%$ narrower matched-filter bandwidth |
| **Symbol Duration ($T_s$)** | 160.0 ms (6.25 baud) | 320.0 ms (3.125 baud) | $2\\times$ symbol integration period |
| **Total Frame Symbols** | 79 symbols (58 data + 21 Costas) | 75 symbols (54 data + 21 Costas) | Optimized symbol packing & channel utilization |
| **Raw Channel Bits** | 174 bits ($58 \\times 3\\text{ bits}$) | 216 bits ($54 \\times 4\\text{ bits}$) | Higher total channel codeword dimensionality |
| **Information Bits ($K$)** | 91 bits ($77\\text{ msg} + 14\\text{ CRC}$) | 77 bits ($63\\text{ msg} + 14\\text{ CRC}$) | **z-30 carries 14 fewer message bits.** Earlier revisions of this row read "77 bits ($58\\text{ msg} + 14\\text{ CRC} + 5\\text{ flag}$)" against FT8's 77 and called the capacity identical; that compared z-30's post-CRC block against FT8's pre-CRC message field. See [04](04-Forward-Error-Correction-&-LDPC.md): z-30 packs 63 message bits, FT8 packs 77. |
| **FEC Code** | Systematic LDPC (174, 91) | IRA LDPC (216, 77) | **Rate $R \\approx 0.356$ vs $0.523$** ($+2.4\\text{ dB}$ coding gain) |
| **Parity Check Fraction** | 47.7% parity overhead | **64.4% parity overhead** | Significantly steeper waterfall BER curve |
| **CRC Polynomial** | 14-bit ($P_{\\text{false}} \\approx 6 \\times 10^{-5}$) | 14-bit CRC-14 ($P_{\\text{false}} \\approx 2^{-14} \\approx 6.1 \\times 10^{-5}$) | Same order of magnitude; neither mode is meaningfully ahead here |
| **Co-Channel Collision Recovery** | None (collisions fail to decode) | **3-Pass Successive Interference Cancellation (SIC)** | Co-channel collision resolution down to $-31.5\\text{ dB}$ |
| **Clock Drift Tolerance** | $\\pm 1.0\\text{ s}$ (requires NTP/GPS) | $\\pm 1.5\\text{ s}$ + Built-in RF Time Sync | Zero-admin offline HF/LF time calibration |


### 1.1 Against the wider mode set

The same measurement placed beside the published on-air figures for the other common
weak-signal modes:

| Metric / Parameter | **z-30** | **FT8** | **FT4** | **WSPR** | **JS8Call** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cycle duration** | **30.0 s** | 15.0 s | 7.5 s | 120.0 s | 15.0 s (var) |
| **Occupied bandwidth** | **50.0 Hz** | 47.0 Hz | 83.0 Hz | 5.9 Hz | 50.0 Hz |
| **Modulation** | **16-MFSK (CPFSK)** | 8-GFSK | 4-GFSK | 4-FSK | 8-GFSK |
| **Symbol rate** | **3.125 baud** | 6.25 baud | 20.83 baud | 1.4648 baud | 6.25 baud |
| **Tone spacing ($\\Delta f$)** | **3.125 Hz** | 6.25 Hz | 20.83 Hz | 1.4648 Hz | 6.25 Hz |
| **Active TX duration** | **24.0 s (75 symbols)** | 12.64 s | 4.48 s | 110.6 s | 12.64 s |
| **Decode / guard window** | **6.0 s** | 2.36 s | 3.02 s | 9.4 s | 2.36 s |
| **Sensitivity (50%), AWGN** | **-23.1 dB SNR †** | -21.0 dB SNR ‡ | -17.5 dB SNR ‡ | -28.0 dB SNR ‡ | -24.0 dB SNR ‡ |
| **Sensitivity (90%), AWGN** | **-21.7 dB SNR †** | -20.0 dB SNR ‡ | -16.5 dB SNR ‡ | -27.0 dB SNR ‡ | -22.5 dB SNR ‡ |
| **FEC code** | **LDPC (216, 77), $R \\approx 0.356$** | LDPC (174, 91), $R = 0.52$ | LDPC (174, 91), $R = 0.52$ | Convolutional $K=32$, $r=1/2$ | LDPC (174, 91) |
| **Payload capacity** | **63 message bits (+ CRC-14 = 77)** | 77 message bits (+ CRC-14 = 91) | 77 message bits (+ CRC-14 = 91) | 28 bits (call + loc + pwr) | Free text (var) |
| **Collision recovery** | **Multi-pass SIC (3 passes)** | Single pass (limited) | None | Non-coherent | Single pass |
| **Primary use case** | **Deep DX / EME / solar minima** | General DX / contesting | Rapid contesting | Propagation beaconing | Conversational keyboard |
| **Clock drift tolerance** | **$\\pm 1.5\\text{ s}$ (with RF auto-sync)** | $\\pm 1.0\\text{ s}$ | $\\pm 0.5\\text{ s}$ | $\\pm 2.0\\text{ s}$ | $\\pm 1.0\\text{ s}$ |
| **Spectral density** | **50 QSOs per 2.7 kHz band** | ~40 QSOs per band | ~25 QSOs per band | N/A (one-way) | ~30 QSOs per band |

**† is a like-for-like measurement with ‡.** **†** is z-30's own benchmark run in
\`--mode realistic\`: each frame gets a random carrier offset (±5 Hz) and timing offset (±0.5 s),
and the receiver is handed nothing but audio — it locates the frame and estimates the noise
floor itself, exactly as it must on the air. **‡** are the published over-the-air thresholds
for those modes, which include the same acquisition, AFC and timing losses. Reproduce † with
the commands in
[16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md).

**z-30 decodes 2.1 dB deeper than FT8 on AWGN, and it pays more than 2.1 dB for it.**

Take the three facts together before reading the headline number:

| | z-30 | FT8 | Difference |
| :--- | ---: | ---: | ---: |
| Decode threshold, 50%, measured the same way | $-23.1\\text{ dB}$ | $-21.0\\text{ dB}$ | $2.1\\text{ dB}$ deeper |
| Active transmission per message | $24.0\\text{ s}$ | $12.64\\text{ s}$ | $10\\log_{10}(24.0/12.64) = 2.8\\text{ dB}$ more energy |
| Message bits carried | 63 | 77 | 14 fewer |

z-30 spends $2.8\\text{ dB}$ of extra airtime and $14$ message bits to buy $2.1\\text{ dB}$ of
sensitivity. **Per second on the air it is therefore about $0.7\\text{ dB}$ behind FT8, while
being $2.1\\text{ dB}$ ahead per transmission.** Both statements are true and neither is the
whole picture; quoting the first without the second is how this page ended up with a withdrawn
claim once already.

> **Correction (2026-08-31, second revision):** the previous revision of this paragraph read
> "z-30 is level with FT8 on AWGN, not ahead of it", from a measured threshold of
> $-21.1\\text{ dB}$. That measurement was wrong - not the comparison method, which was sound,
> but the receiver being measured. \`z30_dsp/benchmark.py\` was applying a pilot-aided
> semi-coherent demodulator term through the whole realistic path, which under the timing error
> that blind acquisition actually leaves cancels signal rather than reinforcing it, and which
> z-30's receiver does not specify. Correcting it moved the threshold $2.0\\text{ dB}$ deeper.
> The paired measurement that settled it (59 discordant pairs, 55 to the non-coherent receiver,
> exact two-sided McNemar $p = 1.7\\times10^{-12}$) is in
> [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md).
>
> The still-withdrawn claim is the older one: a "+4.0 dB advantage" obtained by subtracting
> FT8's on-air figure from z-30's *genie-aided bound*. That comparison remains invalid and the
> $2.1\\text{ dB}$ above is not it - it is bound-to-bound-free, measured through blind
> acquisition on both sides of the comparison.

Where z-30 differs beyond sensitivity is occupied bandwidth, multi-pass SIC, and behaviour on a
disturbed path.

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

$$C = B \\log_2\\left(1 + \\frac{S}{N}\\right) = B \\log_2(1 + \\text{SNR})$$

Where:
- $C$ is the channel capacity in bits per second (bps).
- $B$ is the channel bandwidth in Hertz.
- $S/N$ is the linear Signal-to-Noise Ratio within bandwidth $B$.

In extreme weak-signal communications where $\\text{SNR} \\ll 1$ (the "power-limited" or "wideband" regime), using the natural logarithm expansion $\\ln(1 + x) \\approx x$:

$$C \\approx B \\cdot \\frac{\\text{SNR}}{\\ln(2)} = \\frac{S}{N_0 \\ln(2)} \\implies \\frac{E_b}{N_0} \\ge \\ln(2) \\approx -1.59\\text{ dB}$$

### Link Margin Comparison in Standard Reference Bandwidth ($B_{\\text{ref}} = 2500\\text{ Hz}$):
In amateur radio, SNR is conventionally expressed relative to a $B_{\\text{ref}} = 2500\\text{ Hz}$ SSB receiver passband ($SNR_{2500}$):

$$\\text{SNR}_{2500} = \\frac{S}{N_0 \\cdot B_{\\text{ref}}} = \\left(\\frac{E_b}{N_0}\\right) \\cdot \\left(\\frac{R_b}{B_{\\text{ref}}}\\right)$$

Where $R_b$ is the net **message** bit rate — the bits the operator actually sends, before the
CRC each mode adds on top:
- **FT8 Net Rate**: $R_{b,\\text{FT8}} = \\frac{77\\text{ bits}}{12.64\\text{ s}} \\approx 6.09\\text{ bps}$
- **z-30 Net Rate**: $R_{b,\\text{z30}} = \\frac{63\\text{ bits}}{24.0\\text{ s}} \\approx 2.63\\text{ bps}$

> **Correction (2026-08-31):** the z-30 rate here was previously computed as
> $77/24.0 \\approx 3.21\\text{ bps}$, reusing FT8's message-bit count. z-30 packs 63 message
> bits (see [04](04-Forward-Error-Correction-&-LDPC.md)); 77 is its post-CRC block, the
> $K$ of the LDPC code, and the corresponding figure for FT8 is 91, not 77. The error made
> z-30's Shannon limit look $0.87\\text{ dB}$ higher than it is.

Calculating the theoretical Shannon threshold in a 2500 Hz reference bandwidth for both modes:
- **FT8 Theoretical Shannon Limit**: $\\text{SNR}_{2500,\\text{Shannon}} = -1.59\\text{ dB} + 10\\log_{10}\\left(\\frac{6.09}{2500}\\right) = -27.72\\text{ dB}$
- **z-30 Theoretical Shannon Limit**: $\\text{SNR}_{2500,\\text{Shannon}} = -1.59\\text{ dB} + 10\\log_{10}\\left(\\frac{2.63}{2500}\\right) = -31.38\\text{ dB}$

**Physical Insight**: each mode's distance from *its own* limit is the only comparison this
arithmetic supports, because the two limits are different numbers:

| | Threshold | Own Shannon limit | Distance from limit |
| :--- | ---: | ---: | ---: |
| FT8, on the air | $-21.0\\text{ dB}$ | $-27.72\\text{ dB}$ | $6.72\\text{ dB}$ |
| z-30, blind acquisition | $-23.1\\text{ dB}$ | $-31.38\\text{ dB}$ | $8.28\\text{ dB}$ |
| z-30, genie-aided bound | $-24.6\\text{ dB}$ | $-31.38\\text{ dB}$ | $6.78\\text{ dB}$ |

The comparison to draw is **not** "z-30 is closer to Shannon" — it is further from its own limit
than FT8 is from its. Sending 63 bits in 24.0 s instead of 77 bits in 12.64 s moves the *limit*
down by $3.7\\text{ dB}$, and z-30's on-air threshold captures $2.1\\text{ dB}$ of that. Under
ideal detection its code sits $6.78\\text{ dB}$ from its limit, within a tenth of a dB of where
FT8's on-air figure sits from its own — so the codes are of comparable efficiency, and the
$1.5\\text{ dB}$ that separates z-30's bound from its measured threshold is acquisition loss on a
3.125 Hz-spaced signal. That loss is exactly the part a genie-aided comparison hides, in this
mode and in every other.

---

## ⚡ 3. M-ary Orthogonal Signaling Physics: Why 16-MFSK Outperforms 8-MFSK

In digital communications, continuous-phase M-ary Frequency Shift Keying ($M$-MFSK) uses an alphabet of $M$ orthogonal carrier frequencies. For non-coherent matched-filter detection, the minimum tone spacing required for mathematical orthogonality is:

$$\\Delta f = \\frac{1}{T_s}$$

Where $T_s$ is the symbol duration.

\`\`\`
       FT8: 8-MFSK (Ts = 160 ms, df = 6.25 Hz)
       |──6.25Hz──|
       f0   f1   f2   f3   f4   f5   f6   f7   (Total BW = 47.0 Hz)
       
       z-30: 16-MFSK (Ts = 320 ms, df = 3.125 Hz)
       |─3.125Hz─|
       f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 f13 f14 f15 (Total BW = 50.0 Hz)
\`\`\`

### 3.1 The Fundamental Orthogonal Signaling Property
Unlike amplitude or phase modulation schemes (QAM, PSK)—where increasing the constellation size $M$ requires higher $E_b/N_0$ to maintain the same Bit Error Rate—**orthogonal M-ary FSK exhibits the inverse behavior**:

$$\\lim_{M \\to \\infty} P_b(M\\text{-FSK}) \\to 0 \\quad \\text{for any } \\frac{E_b}{N_0} > \\ln(2)$$

As the alphabet size $M$ increases from $M=8$ (FT8, 3 bits/symbol) to $M=16$ (z-30, 4 bits/symbol):
1. **Energy Efficiency per Bit Increases**: Each symbol carries $\\log_2(16) = 4$ bits instead of $\\log_2(8) = 3$ bits. The energy allocated per transmitted information bit is $E_b = \\frac{E_s}{\\log_2(M)}$.
2. **Noise Bandwidth per Filter Bin Halves**: The matched filter noise bandwidth for each tone is $B_n = \\frac{1}{T_s} = 3.125\\text{ Hz}$ in z-30, compared to $6.25\\text{ Hz}$ in FT8.
3. **Predetection Processing Gain**:

$$\\Delta G_{\\text{predet}} = 10 \\log_{10}\\left(\\frac{6.25\\text{ Hz}}{3.125\\text{ Hz}}\\right) = +3.01\\text{ dB}$$

Every tone filter bin in the z-30 receiver accumulates only half the thermal noise power ($N = N_0 \\cdot \\Delta f$) during symbol integration compared to FT8.

---

## 🛡️ 4. Forward Error Correction (FEC) & LDPC Coding Gain

Both FT8 and z-30 utilize Low-Density Parity-Check (LDPC) codes decoded via belief propagation over bipartite Tanner graphs. However, their code rates and graph structures differ fundamentally:

\`\`\`
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
\`\`\`

### 4.1 Mathematical Code Rate Advantage
- **FT8 Code Rate**: $R_{\\text{FT8}} = \\frac{91}{174} \\approx 0.523$
- **z-30 Code Rate**: $R_{\\text{z30}} = \\frac{77}{216} \\approx 0.356$

By operating at a significantly lower code rate ($R \\approx 0.356$), z-30 provides **139 parity-check constraints** over 216 channel bits, compared to only 83 parity constraints in FT8.

### 4.2 Normalized Min-Sum Decoder Dynamics
The z-30 check node update equation uses an optimized empirical attenuation factor $\\alpha = 0.75$:

$$L_{m \\to n} = 0.75 \\cdot \\left(\\prod_{n' \\in N(m) \\setminus \\{n\\}} \\text{sgn}(L_{n' \\to m})\\right) \\cdot \\min_{n' \\in N(m) \\setminus \\{n\\}} |L_{n' \\to m}|$$

Because of the higher parity redundancy ($64.4\\%$ vs $47.7\\%$), the Tanner graph possesses a larger girth ($g \\ge 6$) and fewer short trapping sets, yielding:
- **Steeper Waterfall Region**: The Frame Error Rate (FER) transition from $10^{-1}$ to $10^{-5}$ occurs across a narrower $\\Delta \\text{SNR}$ span ($0.8\\text{ dB}$ vs $1.6\\text{ dB}$ in FT8).
- **Error Floor**: No error floor has been observed in benchmarking, but the benchmark runs tens of frames per SNR point, so it can only bound the floor at roughly $\\text{FER} < 10^{-2}$. A $10^{-6}$ claim would need on the order of $10^{8}$ frames and has not been measured.
- **Net FEC Coding Gain**: Provides $+2.4\\text{ dB}$ of additional coding gain over FT8's higher-rate LDPC code.

---

## 🔄 5. Multi-Pass Successive Interference Cancellation (SIC)

In real HF/VHF band conditions, receivers do not operate in isolated AWGN channels; they experience **dense multi-user interference and severe near-far dynamic range disparity**.

\`\`\`
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
\`\`\`

### 5.1 The Mathematical Near-Far Dilemma
When a strong local station ($P_{\\text{local}} = +10\\text{ dB}$) and a weak DX station ($P_{\\text{DX}} = -25\\text{ dB}$) overlap inside the same FFT bin:

$$\\text{SINR}_{\\text{DX}} = \\frac{P_{\\text{DX}}}{P_{\\text{local}} + \\sigma^2} \\approx \\frac{10^{-2.5}}{10^{1.0} + 10^{-2.95}} \\approx \\frac{0.00316}{10.0011} = -35.0\\text{ dB}$$

Because $-35.0\\text{ dB} \\ll -21.0\\text{ dB}$, FT8 completely fails to decode either transmission.

### 5.2 The 3-Pass Subtraction Mechanism in z-30
1. **Pass 1**: The high-SNR signal is decoded cleanly. The 14-bit CRC confirms with probability $1 - 2^{-14} \\approx 0.99994$ that all 75 transmitted tones are known exactly.
2. **Exact Parameter Estimation**:
   - Carrier frequency $\\hat{f}_0$ is estimated via chirped quadratic interpolation with precision $\\sigma_f < 0.05\\text{ Hz}$.
   - Time arrival $\\hat{\\Delta t}$ is locked with sub-millisecond precision.
   - Time-varying envelope amplitude $\\hat{A}(t)$ and ionospheric phase trajectory $\\hat{\\phi}(t)$ are tracked across all 75 symbols.
3. **Continuous-Phase Synthesis & Coherent Cancellation**:

$$x_{\\text{residual}}(t) = x_{\\text{rx}}(t) - \\hat{A}(t) \\cos\\left(2\\pi \\hat{f}_0 (t - \\hat{\\Delta t}) + \\theta_{\\text{mod}}(t) + \\hat{\\phi}(t)\\right)$$

4. **Pass 2 & Pass 3**: The residual buffer $x_{\\text{residual}}(t)$ is transformed through the STDFT filterbank. The unmasked DX signal at $-25\\text{ dB SNR}$ is now isolated in an interference-free noise environment, at the same $-25.0\\text{ dB}$ (50%) / $-24.0\\text{ dB}$ (90%) AWGN decode floor the receiver already achieves on an uncontested channel, and decodes with the corresponding empirical success probability once the dominant interferer is cancelled.

---

## 🌊 6. Ionospheric Multipath, Flutter, & Doppler Dynamics

HF ionospheric skywave propagation (F2 layer reflection) is characterized by:
- **Doppler Spread ($B_d$)**: Frequency dispersion caused by traveling ionospheric disturbances (TID) or polar auroral flutter ($0.1\\text{ Hz}$ to $2.0\\text{ Hz}$).
- **Multipath Delay Spread ($\\tau_d$)**: Differential path delays between 1-hop, 2-hop, or high/low ray angles ($0.5\\text{ ms}$ to $4.0\\text{ ms}$).
- **Coherence Time ($\\tau_c \\approx 1 / B_d$)**: Time window over which channel phase remains stationary ($0.5\\text{ s}$ to $10.0\\text{ s}$).

### 6.1 Why z-30 Resists Polar & Auroral Flutter
FT8 places its Costas synchronization arrays exclusively in three fixed clusters (beginning, middle, end: symbols 0-6, 36-42, 72-78). If an ionospheric deep fade or auroral phase step occurs during one of these clusters, FT8 loses time/frequency lock and the entire frame is lost.

**z-30 distributes 21 Costas synchronization symbols across 7 distinct triplets throughout the 75-symbol frame**:

\`\`\`
Frame Index:  [0..2]   [7..9]   [17..19]   [27..29]   [37..39]   [47..49]   [72..74]
Sync Blocks:    S1       S2        S3         S4         S5         S6         S7
Data Blocks:       D1       D2        D3         D4         D5         D6
\`\`\`

- **Continuous Phase Tracking**: Triplet spacing ($8$ to $10$ symbols $= 2.56\\text{ s}$ to $3.20\\text{ s}$) is matched to the coherence time ($\\tau_c$) of disturbed polar ionospheric channels.
- **Dynamic Doppler Tracking**: The receiver tracks Doppler drift up to $\\pm 1.5\\text{ Hz}$ across the 24-second transmission window.

---

## 📻 7. Link Budget: What a dB of Sensitivity Buys, and What z-30 Can Claim

**z-30's on-air sensitivity has been measured: 2.1 dB deeper than FT8 on AWGN, bought with
2.8 dB more airtime and 14 fewer message bits.**

Earlier revisions of this page put z-30's idealised AWGN bound (a benchmark that hands the
demodulator the exact noise level, the exact carrier frequency and perfect symbol timing) next
to FT8's published over-the-air threshold, which *includes* the acquisition, AFC and timing
losses that bound excludes. The two are different quantities. Everything downstream of that
comparison - a "+4.0 dB advantage", a $2.51\\times$ ERP multiplier, a QRP station matching 12.6 W
of FT8, an opening window extended by one to two hours - followed from it and has been
withdrawn.

What is defensible today:

- z-30 spends more energy per symbol (3.125 baud against FT8's 6.25) and more redundancy per
  information bit (rate 0.356 against 0.52), and both buy coding gain.
- Its seeded benchmark, driven through the real acquisition path with random carrier and
  timing offsets, crosses 50% decode at $-23.1\\text{ dB}$ and 90% at $-21.7\\text{ dB}$ on AWGN
  in a 2500 Hz reference bandwidth - $2.1\\text{ dB}$ deeper than FT8, measured the same way.
- Under ideal detection (exact carrier, timing and noise level) the same code reaches
  $-24.6\\text{ dB}$. The $1.5\\text{ dB}$ difference is what it costs to *find* the signal.
- The coding gain is real and it survives acquisition, but it is not free: the $2.1\\text{ dB}$
  costs $2.8\\text{ dB}$ of extra airtime and 14 message bits against FT8. z-30 is deeper per
  transmission and marginally shallower per second.

### 7.1 How the honest measurement is made

\`z30_dsp/benchmark.py --mode realistic\` is no longer genie-aided:

1. A random carrier frequency offset ($\\pm5$ Hz) is injected (\`z30_dsp/channel.py\`).
2. A random symbol timing offset ($\\pm0.5$ s) is injected - slot alignment is never exact.
3. A Watterson two-path fading channel is applied, with CCIR 520-2 Doppler and delay spreads
   for the *good*, *moderate* and *poor* path classes.
4. The decode is driven through the **real acquisition path** (\`z30_dsp/acquisition.py\`): a
   Costas sync search over the slot-synchronised timing window and the carrier range, plus a
   blind noise-floor estimate. Nothing is handed to the demodulator.
5. The demodulator is purely non-coherent, which is what z-30's receiver is specified to be and
   what a receiver that has just acquired blind can actually support.
6. Every run is seeded, and the seed is published with the curve.

Measured result, seed \`20260830\`:

| Channel | Frames/point | 50% decode | 90% decode |
| --- | ---: | --- | --- |
| Idealised bound (genie-aided sync) | 40 | $-24.6\\text{ dB}$ | $-23.4\\text{ dB}$ |
| AWGN, blind acquisition | 40 | $-23.1\\text{ dB}$ | $-21.7\\text{ dB}$ |
| CCIR moderate (1.0 ms / 0.5 Hz) | 100 | $-21.3\\text{ dB}$ | $-19.5\\text{ dB}$ |
| CCIR poor (2.0 ms / 1.0 Hz) | 100 | $-21.3\\text{ dB}$ | $-19.0\\text{ dB}$ |

The two fading presets are not separable at the 50% point at 100 frames each; see
[16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md) for the intervals.

\`tests/test_channel_acquisition.py\` guards the property that makes this measurement meaningful:
that acquisition reads only the audio, and is never quietly handed the answer again.

### 7.2 For reference: what a dB is worth

Independent of any z-30 claim, a $\\Delta$ dB improvement in sensitivity corresponds to a power
ratio of

$$\\frac{P_1}{P_2} = 10^{\\Delta / 10}$$

so $+3\\text{ dB}$ halves the power a station needs, and $+4\\text{ dB}$ is roughly the gain of a
small 2-element Yagi over a dipole, or about 0.7 S-units of background noise on the low bands.
This is why weak-signal work chases single decibels - and why the $4\\text{ dB}$ this page once
claimed, on a comparison that did not hold, was worth retracting rather than defending.

---

## 📊 8. Summary Comparison Matrix

\`\`\`
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
   z-30 (blind acquisition, AWGN):   -23.1 dB ◄── measured the same way as the rows above
   z-30 (idealised bound, genie sync):-24.6 dB ◄── NOT measured the same way; do not compare
   ─────────────────────────────────────────────────────────────────────────────
   z-30's own Shannon limit:         -31.4 dB   (63 bits / 24.0 s)
   FT8's own Shannon limit:          -27.7 dB   (77 bits / 12.64 s)
\`\`\`

Every figure above the divider is an over-the-air threshold, and z-30's blind-acquisition
figure belongs on that same scale: it is measured the same way, and it lands 2.1 dB below FT8 —
for 1.9x the airtime and 14 fewer message bits, which is why the two Shannon limits at the
bottom are different numbers and why neither mode's distance from the other's limit means
anything. The idealised bound does **not** belong on this scale either: it is an upper limit on
what the code and demodulator could achieve if acquisition were free, and every mode listed
above would move a few dB left if measured that way too.

What z-30 does offer, independently of any sensitivity claim, is full two-way interactive QSO
sequencing at 50 Hz occupied bandwidth, real-time successive interference cancellation, and
cross-platform hardware CAT integration.
`,
  },
  {
    id: "github-updates",
    slug: "12-Software-Updates-&-GitHub-Sync",
    title: "12. Software Updates & GitHub Upstream Sync",
    category: "Advanced & Packaging",
    description: "How to check for updates, sync upstream git commits from themantas1994/z-30, and perform zero-downtime updates across Linux, Windows, Android, and Web PWA.",
    tags: ["update","github","git","sync","upgrade","releases","pwa","termux","ubuntu","arch"],
    markdown: `# 🔄 Software Updates & Upstream Synchronisation

The **z-30 Amateur Radio Transceiver Suite** is developed on GitHub at
**[https://github.com/themantas1994/z-30](https://github.com/themantas1994/z-30)**.

---

## 📌 Commits, not versions

**z-30 has no release channels and no version to compare.** It is developed on \`main\`, and an
installation is either at the tip of \`main\` or some number of commits behind it. That number is
the whole of what the update mechanism reports, and \`git\` already tracks it exactly: a \`git
fetch\` and a count of the commits between \`HEAD\` and \`origin/main\`.

> **Correction (2026-08-31):** every earlier revision of this page described "two upstream
> update channels", Stable Releases and a Main Branch nightly, and the app carried a selector
> for them. Neither worked. Both the CLI updater and the web UI compared a hardcoded
> \`1.0.0\` against the newest release tag and the upstream \`package.json\` version - all three of
> which had been \`1.0.0\` since the repository was created - so the check answered "up to date"
> no matter how far behind the checkout was. The "development" channel compared against a
> hand-edited \`CURRENT_COMMIT_SHA\` that had itself gone stale. An installation two hundred
> commits behind was told it was current. Version strings nobody bumps are not version strings,
> and the channels they distinguished did not exist: there has only ever been \`main\`.

The version number that remains in \`package.json\` and \`pyproject.toml\` is packaging metadata.
Nothing in the update path reads it.

---

## 🖥️ 1. Updating from the app

**Click the Update button in the top navigation bar.** It shows how many commits behind
\`origin/main\` this installation is, lists what those commits are, and updates when you press
**Update now**.

When z-30 is started with the \`z30\` command, the native server is behind the page and does the
work itself:

1. \`git fetch origin main\` in the real checkout.
2. \`git merge --ff-only origin/main\`.
3. The result reports what changed, and the modal offers a reload when the interface moved.

**Fast-forward only.** The update either advances \`HEAD\` onto the upstream commit or refuses
and changes nothing. It cannot produce a merge commit, cannot leave a conflicted tree, and
cannot discard your work. It is refused, with the reason shown, when:

| Condition | Why |
| :--- | :--- |
| The working tree has uncommitted changes | A station that has patched its own copy is not something an Update button gets to overwrite. Commit or stash first. |
| The checkout has commits upstream does not | It cannot be fast-forwarded. Merge or rebase it by hand. |
| **The transmitter is keyed** | Replacing the served bundle and the Python sources under a running transmission, while the operator is on the air and not looking at the screen, is not something to do. Finish the slot first. |
| This is not a git checkout | A pip or distribution-package install updates through that package manager. |

The repository commits its built web bundle (\`z30_dsp/web_dist/\`), which is why the button
works on a station with no Node toolchain: once the fast-forward lands, the new interface is
already on disk and the browser only has to purge its caches and reload. Nothing is rebuilt by
default. When the Python package itself changed, the modal says so - restart z-30 so the server
runs the new code.

**Opened from static hosting or as a PWA with no native server behind it**, the modal can still
tell you how far behind you are - it compares the bundle's build-stamped commit against the
GitHub commits API - but it cannot update anything, says so, and gives you the one command to
run instead. The build stamp is injected by \`vite.config.ts\` from \`git rev-parse HEAD\` at build
time, so it cannot drift the way the hand-maintained constant did.

---

## ⚡ 2. Updating from the terminal (\`z30 --update\`)

The same \`z30_dsp/git_sync\` module, with a terminal front end. The button and the command can
never disagree about whether an installation is current, because they are the same code.

\`\`\`bash
# Report status, then ask before fast-forwarding.
z30 --update

# Apply without asking.
z30 --update -y

# Report only, change nothing. Exits non-zero when behind, so a startup script
# or a cron job can act on it without parsing any output.
z30 --update --check

# Also refresh dependencies / rebuild the bundle from source, for a developer checkout.
z30 --update -y --reinstall
z30 --update -y --rebuild
\`\`\`

Sample output:

\`\`\`
==================================================================
      z-30 TRANSCEIVER - UPSTREAM SYNCHRONISATION
      https://github.com/themantas1994/z-30
==================================================================
Checking https://github.com/themantas1994/z-30 (main)...

Repository:    /home/pi/z-30
Branch:        main
Local commit:  cf06ee7
Upstream:      a91d3f2 (origin/main)

[!] 3 commits behind upstream:
      a91d3f2  fix(cat): release the pin the key actually drove
      7c1e044  feat(dsp): seed the dithered decode schedule
      2b90aa1  docs(wiki): correct the decoder schedule count

Fast-forward to a91d3f2 now? [Y/n]:
\`\`\`

---

## 🔌 3. The local API

\`z30_dsp/web_server.py\` exposes the same information to the app over three endpoints, behind
the same token + \`Origin\` + \`Host\` triple check as every other \`/api/\` route (see
[13. Operating Safety, Compliance & Security](13-Operating-Safety-Compliance-&-Security.md)):

| Endpoint | Purpose |
| :--- | :--- |
| \`GET /api/update/status?fetch=1\` | How far behind upstream, what the pending commits are, whether a fast-forward would succeed. \`fetch=0\` answers from the last fetch without touching the network. |
| \`POST /api/update/apply\` | Starts the fast-forward in a worker thread. Returns immediately; refused with HTTP 409 while PTT is asserted, or if an update is already running. |
| \`GET /api/update/progress\` | The running log and the final outcome. Polled by the modal, so reloading the page mid-update reconnects to the running job instead of starting a second one. |

Every git invocation is an argument list, never a shell string - commit subjects and branch
names are attacker-influenceable on a repository anyone can open a pull request against.

---

## 🐧 4. Platform notes

The update *is* the fast-forward; the per-platform installer scripts exist to install
dependencies, not to update source. Re-run one only when dependencies changed - the updater
says so, or use \`--reinstall\`.

\`\`\`bash
# Any platform, in the z-30 checkout:
git pull --ff-only origin main

# Then, only if dependencies changed:
./install_ubuntu.sh          # Ubuntu / Debian / Raspberry Pi OS
./install_arch.sh            # Arch / Manjaro / EndeavourOS  (or: makepkg -si)
./install_android_termux.sh  # Android Termux
run_windows.bat              # Windows 10 / 11
pip install --upgrade -e .   # Generic Python
\`\`\`

See [09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md) for what
each installer does.
`,
  },
  {
    id: "operating-safety",
    slug: "13-Operating-Safety-Compliance-&-Security",
    title: "13. Operating Safety, Compliance & Local Security",
    category: "Getting Started",
    description: "The transmit gate, the three stuck-transmitter layers, local API authentication, system-clock and logbook handling - and what is still the operator's responsibility.",
    tags: ["safety","compliance","band plan","licence","transmit gate","ptt watchdog","security","api token","alc"],
    markdown: `# 13. Operating Safety, Compliance & Local Security

This application keys real transmitters over serial, CM108, GPIO and audio VOX, and it exposes
a local HTTP API to do it. The behaviours on this page are deliberate, they are covered by
tests, and they are not configurable away casually. If you are changing code that touches
transmit, the local API or the system clock, read this page first — every rule here exists
because the failure it prevents is expensive on the air.

---

## 🚦 Before z-30 will transmit at all

Every transmit entry point — the automatic QSO sequencer, the manual TX button, the tune
carrier, and the raw rigctl console's \`T 1\` / \`\\set_ptt 1\` — passes through a single gate
(\`canTransmit()\` in \`src/dsp/catController.ts\`). It **fails closed**, and any refusal names the
exact condition that failed:

| Condition | Why |
| :--- | :--- |
| A syntactically valid callsign that is not the shipped \`W1AW\` placeholder | An unidentified transmission, or one under someone else's call, is a licence problem |
| A configured regulatory region and licence class | Band edges and sub-band privileges differ by country and by class; there is no safe way to guess either |
| Dial frequency **plus audio offset** inside a data-mode segment your class holds | The radiated frequency is not the dial frequency, and this is what puts a station out of band |
| No contradiction from the radio itself, where the radio can be read back | The three checks above all reason about the dial the *software commanded*; if \`rigctld\` reports the VFO somewhere else, they were about a frequency the transmitter is not on |

The band plan lives in \`src/dsp/bandPlan.ts\` and covers IARU Regions 1–3 plus the FCC Part 97
sub-band structure, with the date each entry was last checked. National rules vary and change:
the gate catches a mistuned VFO or a wrong band button, it does not replace knowing your own
licence conditions.

The console reaches the gate through a transmit context its caller supplies; with none supplied
it refuses to key at all rather than defaulting to permitting. Unkeying is never gated — refusing
to stop transmitting is not a safety property.

**The last row only ever adds refusals.** A station whose rig cannot be read back — \`Direct
Serial\`, which has no response parser; a VOX-keyed station with no CAT link; a page opened
without the native server — is *unverified*, not *wrong*, and transmits exactly as it did before.
So is a station that has just lost contact with its relay. Nor does the check fire while a band
change is still settling, or over a few tens of Hz that the rig's own measured tuning resolution
accounts for. Each of those exclusions exists because the alternative is a safety check that
grounds working stations, and a safety check that grounds working stations gets switched off.
[wiki/06 → Reading the rig back](06-Transceiver-CAT-Control-&-PTT-Wiring.md#-reading-the-rig-back)
has the full model and where it came from.

**The two wiring tests are the deliberate exception.** The browser's "PTT Key Test" and the
\`z30 --wizard\` PTT test key the radio without running \`canTransmit()\`: they assert the line for a
few seconds with no modulation, after an explicit confirmation, and release it in a \`finally\`.
They exist to prove a cable before a callsign or a band plan has been configured, which is
precisely when the gate would refuse. Point the rig at a dummy load or a frequency you hold
before you run either — nothing else is checking.

---

## ⏱️ Stuck-transmitter protection

Three independent layers, because the failure being defended against is "the software stopped
running":

1. **Browser-side maximum-transmission timer.** A frame is 24 s; \`MAX_TX_SECONDS\` is 40 s.
   Past that, PTT is force-released across every keying path.
2. **Server-side dead-man switch on the GPIO PTT line.** The browser must re-assert PTT every
   ~500 ms; if it stops, \`z30_dsp/web_server.py\` drops the pin within about two seconds. A
   crashed tab, a killed renderer or a sleeping machine cannot send a keepalive — and cannot
   run a browser-side timer either, which is why this layer has to exist separately. A hard
   40 s ceiling applies even if keepalives keep arriving.

   The browser sends this layer the **intent** (\`keyed\`) plus the wiring (\`active_low\`), and the
   server derives the pin level from the two. It used to be sent the level alone and recorded
   that as the keyed state, which is the opposite of the truth on an active-low interface: such
   a station registered no countdown when it keyed — so its own keepalives came back rejected
   and the browser force-unkeyed it about half a second into every frame — and registered one
   when it *stopped*, after which the watchdog "released" the line by driving it low, keying the
   transmitter with nobody watching. A defence that can produce the failure it defends against
   is worse than no defence, because it is trusted.
3. **\`atexit\` and \`SIGTERM\`/\`SIGINT\` handlers** that release every claimed GPIO pin, so killing
   the server does not leave a radio keyed.

---

## 🔐 The local API is authenticated

\`z30_dsp/web_server.py\` binds \`127.0.0.1\` only, but **loopback is not an authentication
boundary**: any page in any browser tab can \`fetch()\` a loopback URL, and a \`text/plain\` POST
is a CORS simple request that is sent with no preflight. Every \`/api/\` request must therefore
satisfy all three of:

- a bearer token (\`X-Z30-Token\`) minted fresh at each server start and injected only into the
  \`index.html\` that this process serves;
- an \`Origin\` header that is absent or exactly this server's own origin;
- a \`Host\` header naming this server's own loopback address and port, which blocks DNS
  rebinding.

No wildcard \`Access-Control-Allow-Origin\` header is sent anywhere, only the single configured
BCM pin can be driven, and the rigctld relay will only talk to loopback daemons.

\`tests/test_web_server_api.py\` asserts every one of these. A change that makes any of them pass
without the token, from a foreign \`Origin\`, or against an arbitrary GPIO pin is a regression,
not a convenience.

---

## 🕐 The system clock

z-30 keeps its clock correction to itself as \`app_time_offset_ms\`, which is all its slot timing
needs. A time station is an unauthenticated broadcast; a marginal decode — or a deliberately
transmitted spoof — would otherwise move the host clock arbitrarily, taking TLS validity, log
timestamps and cron with it.

Stepping the machine's clock from a decoded time station is therefore:

- **opt-in** (\`"allow_set_system_clock": true\` in \`~/.z30/config.json\`, or
  \`Z30_ALLOW_SET_SYSTEM_CLOCK=1\`),
- **confirmed** interactively,
- **bounded to 5 minutes**, and
- **refused** when an NTP daemon already owns the clock.

\`tests/test_time_sync_guards.py\` guards the default and the bound. See
[07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md).

---

## 📓 Your logbook is a file

Contacts are mirrored to \`~/.z30/logbook.json\` with an ADIF export written beside them
(\`XDG_CONFIG_HOME\` is honoured; see \`z30_dsp/paths.py\` for the full resolution order). The
browser copy is a cache. Clearing browsing data, a private window, a different browser or a
different port number all lose \`localStorage\`; none of them touch the file. A failed save is
shown in the UI rather than logged to a console nobody reads.

---

## ⚠️ What is still on you

Rendering a clean waveform in software is necessary, not sufficient.

**Capture your transmitter's actual output and check the occupied bandwidth on a spectrum
analyser before using this on the air** — sound-card clipping and rig ALC will re-broaden a
clean signal, and no amount of correct DSP upstream prevents that.

z-30 is an experimental mode. It is not coordinated with any band plan authority, it has no
established calling-frequency convention beyond the defaults shipped in the Band Manager, and
you remain responsible for your licence conditions, your ALC levels, and everything your
station radiates.
`,
  },
  {
    id: "operation-reference",
    slug: "14-User-Interface-&-Operation-Reference",
    title: "14. User Interface & Operation Reference",
    category: "Getting Started",
    description: "Reference for every control surface: waterfall, QSO macros and auto-sequencing, auto-reply strategies, CAT and S-meter, setup wizard, band manager, and the ADIF logbook.",
    tags: ["ui","waterfall","qso","macros","auto reply","cat","s-meter","wizard","band manager","logbook","adif"],
    markdown: `# 14. User Interface & Operation Reference

A reference for every control surface in the z-30 workspace: what it does, where it lives in
the source, and what it changes on the air. If you are setting a station up for the first time,
start at [01. New User Guide & First Steps](01-New-User-Guide-&-First-Steps.md) instead — this
page is the reference you come back to.

---

## 🌊 60 FPS Spectral Waterfall & Spectrogram

\`src/components/WaterfallDisplay.tsx\`

The primary canvas delivers continuous, non-blocking 60 FPS spectral analysis:

- **Colormaps**: 10 scientific palettes — \`Turbo\`, \`Inferno\`, \`Viridis\`, \`Plasma\`, \`Magma\`,
  \`WSJT-X Classic\`, \`Night Vision Green\`, \`Amber CRT\`, \`High-Contrast B&W\`, \`Spectral Heatmap\`.
- **Passband presets**: \`200–3000 Hz (Standard)\`, \`500–2000 Hz (Narrow)\`,
  \`800–1800 Hz (Digital Focus)\`, \`100–3500 Hz (Wide)\`, \`0–4000 Hz (Extended)\`.
- **Trace visibility boost**: a 3-level contrast multiplier (\`1x\`, \`1.6x\`, \`2.2x\`) that lifts
  weak 16-MFSK tone tracks down to about $-25.0\\text{ dB}$ out of the background.
- **Interactive tuning**:
  - **Single click** — set the audio RX centre frequency.
  - **Shift + click** — set the audio TX centre frequency.
  - **Double click on a carrier** — arm the transmitter (\`txEnabled = true\`) and prepare the
    sequencing macro that calls that station on the upcoming cycle.
  - **Mouse wheel** — smooth zoom ($1\\times$ to $8\\times$), with drag-to-pan inspection.

Remember that the frequency you radiate is the dial frequency **plus** this audio offset. That
sum is what the transmit gate checks against the band plan — see
[13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md).

---

## 🔁 QSO State Machine & Auto-Sequencing

\`src/dsp/qsoEngine.ts\`, \`src/components/QsoMacrosTransmitPanel.tsx\`

z-30 automates standard amateur contact exchanges via a 6-stage finite state machine:

| Macro | Description | Transmitted payload example |
| :--- | :--- | :--- |
| **TX 1** | Directed or general CQ call | \`CQ W1AW FN31\` |
| **TX 2** | Signal report response | \`W1AW K1ABC -12\` |
| **TX 3** | Signal report acknowledgment | \`K1ABC W1AW R-08\` |
| **TX 4** | Mutual confirmation (RRR / RR73) | \`W1AW K1ABC RR73\` |
| **TX 5** | Final 73 sign-off | \`K1ABC W1AW 73\` |
| **TX 6** | Free text / special grid | \`CQ DX W1AW FN31\` |

- **Auto-sequence** advances through the macros on each valid CRC-verified reply.
- **Auto-log** commits the contact on RR73/73 and exports ADIF (\`.adi\`) accepted by LoTW, QRZ,
  ClubLog and eQSL.
- **Watchdog safety** disarms the transmitter after a configurable number of unanswered cycles
  (1 to 10), so an unattended station cannot call CQ indefinitely.

---

## 🎯 Auto-Reply Priority Strategies

When several stations answer your CQ inside the same 30-second slot, z-30 sorts the callers and
picks one according to the configured rule:

1. **First decoded (chrono)** — the first caller decoded in the slot (WSJT-X "Call 1st" behaviour).
2. **Last decoded** — the last caller decoded in the cycle.
3. **Strongest signal (max SNR)** — the loudest station first (e.g. $-4\\text{ dB}$ before $-24\\text{ dB}$).
4. **Weakest signal (deep DX)** — stations closest to the LDPC threshold first (e.g. $-24.5\\text{ dB}$ before $-6\\text{ dB}$).
5. **Nearest station (min distance)** — smallest Maidenhead great-circle distance.
6. **Farthest DX (max distance)** — greatest Maidenhead great-circle distance.

---

## 🎛️ CAT Rig Control & S-Meter Integration

\`src/dsp/catController.ts\`, \`src/dsp/hamlibCatalog.ts\`, \`src/components/RigControlPanel.tsx\`

- Bidirectional serial communication over Hamlib \`rigctld\` (default port \`4532\`) or native
  serial ports (\`COM1..COM32\`, \`/dev/ttyUSB*\`, \`/dev/ttyACM*\`).
- Reads and sets the VFO dial frequency (band selector, direct MHz entry, and +/-100 Hz /
  +/-1 kHz nudge buttons), and reads the operating mode (\`USB\` / \`PKTUSB\`) and passband live
  from the controller rather than displaying a fixed label.
- Keys the tune carrier and opens the band manager.
- **The S-meter readout is rendered in the waterfall header**, not in this panel, because that
  is where an operator watches the band; the reading itself comes from
  \`catController.getSmeterInfo()\`. The panel shows the rigctld endpoint, baud rate and the
  configured PTT method.
- A live CAT terminal for raw Hamlib commands. **Case is significant, as in real rigctl**:
  lower-case short verbs read, upper-case short verbs set — \`f\` / \`F <hz>\`, \`m\` / \`M <mode>\`,
  \`t\` / \`T <0|1>\` — alongside the long forms \`\\get_freq\`, \`\\set_freq\`, \`\\get_mode\`,
  \`\\set_mode\`, \`\\get_ptt\`, \`\\set_ptt\`, \`\\get_vfo\`, \`\\get_level\`, \`\\version\`,
  \`dump_state\` and \`help\`. An unrecognised verb returns a non-zero \`RPRT\`, not success.
- **\`T 1\` / \`\\set_ptt 1\` runs the same transmit gate as every other transmit path** and is
  refused, with the reason, if the station is not clear to transmit. It keys through the
  operator's configured PTT method and polarity, not a CAT default. See
  [13. Operating Safety, Compliance & Security](13-Operating-Safety-Compliance-&-Security.md).
- Synchronous PTT keying via CAT commands, RTS/DTR serial pins, or audio tones.

Full wiring, daemon invocation and per-rig notes live in
[06. Transceiver CAT Control & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md).

---

## ⚡ Supported PTT Keying Architectures

Nine keying methods are supported natively. The summary below is the index; the wiring diagrams
and per-method caveats are in
[06. Transceiver CAT Control & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md).

| # | Method | Typical hardware |
| :--- | :--- | :--- |
| 1 | **CAT command** (\`\\set_ptt 1\` over USB/serial or the Hamlib TCP daemon) | Icom IC-7300/705/7610, Yaesu FT-991A/710/891, Kenwood TS-590SG, Elecraft K3/K4, Xiegu G90/X6100 |
| 2 | **RTS serial pin** | Digirig, Rigblaster, microHAM |
| 3 | **DTR serial pin** | Dual-line and legacy interfaces |
| 4 | **Right-channel audio PTT tone** (1000/1500 Hz on R, data on L) | SignaLink USB, HT cables, smartphone audio jacks |
| 5 | **C-Media CM108 / CM119 USB GPIO** (GPIO3/GPIO4 via HID reports) | DRA-30/50/70, RIM, URIxB |
| 6 | **Raspberry Pi / SBC direct GPIO** (BCM 17/27) | DigiPi, backpack field boxes |
| 7 | **VOX** | Transceiver's internal voice-operated exchange |
| 8 | **TCI network socket** | ExpertSDR, SunSDR2 and other SDRs |
| 9 | **K1EL WinKeyer 2/3** | WinKeyer, microHAM CW Keyer |

---

## 🧭 Interactive Station Setup Wizard

\`src/components/SetupWizardModal.tsx\` (terminal equivalent: \`z30 --wizard\`)

Four guided steps:

1. **Station identity** — callsign format validation, 4/6-character Maidenhead locator
   resolution, operator name, QTH, timezone.
2. **Audio & soundcard I/O** — device enumeration, live VU meters, test-tone verification.
3. **Rig control & Hamlib** — a searchable catalogue of 200+ transceivers, daemon host/port,
   serial ports, baud rate, data bits.
4. **PTT keying & hardware test** — method selection, wiring guidance, polarity, lead-in and
   hang-time sliders, and a live PTT test trigger.

---

## 📡 Band Manager & Presets

\`src/dsp/bandPlan.ts\`, \`src/components/BandManagerModal.tsx\` (terminal equivalent: \`z30 --bands\`)

Default calling frequencies, all customisable:

| Band | Dial frequency | Band | Dial frequency |
| :--- | :--- | :--- | :--- |
| **160 m** | 1.842000 MHz | **17 m** | 18.102000 MHz |
| **80 m** | 3.576000 MHz | **15 m** | 21.076000 MHz |
| **60 m** | 5.359000 MHz | **12 m** | 24.917000 MHz |
| **40 m** | 7.076000 MHz | **10 m** | 28.076000 MHz |
| **30 m** | 10.139000 MHz | **6 m** | 50.316000 MHz |
| **20 m** | 14.076000 MHz *(primary activity)* | **2 m** | 144.176000 MHz |
| **70 cm** | 432.176000 MHz | | |

The same module supplies the band-edge and licence-class data the transmit gate enforces, so a
custom preset outside your privileges is refused at transmit time rather than silently keyed.

---

## 📒 ADIF 3.1.4 Logbook & Contest Export

\`src/dsp/qsoLogger.ts\`, \`src/components/LogbookModal.tsx\`, \`z30_dsp/auto_logger.py\`

- Tabular logbook recording date, UTC time, callsign, band, dial frequency, mode (\`Z-30\`),
  sent/received reports, Maidenhead grid, distance (km/mi) and operator notes.
- One-click export to five formats:
  - **ADIF 3.1.4 (\`.adi\`)** — for LoTW, eQSL, Club Log and contest loggers. \`MODE\` is \`MFSK\`
    with \`SUBMODE\` \`Z30\`, because ADIF's \`MODE\` is a closed enumeration and \`z-30\` is not in
    it; a record with an unlisted \`MODE\` gets rejected or mis-filed.
  - **Cabrillo v3.0 (\`.cbr\`)** — the contest submission format. The header fields the log
    cannot know (\`CONTEST\`, \`OPERATORS\`, \`NAME\`, \`ADDRESS\`, \`CLAIMED-SCORE\`) are emitted empty
    for you to complete: a submission with invented values is worse than a visibly incomplete
    one.
  - **JSON (\`.json\`)** — the only lossless format. ADIF flattens the SIC pass and LDPC
    iteration count into a comment, CSV loses types, and Cabrillo keeps only what a contest
    robot scores; this round-trips every field a QSO record carries.
  - **CSV (\`.csv\`)** — RFC 4180, for spreadsheets.
  - **SQLite dump (\`.sql\`)** — schema plus inserts, for anyone who would rather query their log
    than read it.
- Search and filter by callsign, grid or notes; by band; and by **UTC date range** (from/to,
  with a Clear button). Every export writes the **filtered** set, so the date range doubles as
  the contest-period selector for a Cabrillo submission.
- The authoritative copy is the file on disk (\`~/.z30/logbook.json\` plus an ADIF export beside
  it); the browser store is a cache. See
  [13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md).
`,
  },
  {
    id: "cli-configuration",
    slug: "15-Command-Line-Tools-&-Configuration",
    title: "15. Command-Line Tools & Configuration",
    category: "Advanced & Packaging",
    description: "The z30 command and its subcommands, where z-30 stores configuration and logs, the environment variables it honours, and how the local web server locates its bundle.",
    tags: ["cli","command line","z30","config","environment variables","xdg","paths","web server"],
    markdown: `# 15. Command-Line Tools & Configuration

Everything the \`z30_dsp\` package exposes from a terminal, plus where z-30 keeps its files and
which environment variables change its behaviour.

---

## 🖥️ The \`z30\` command

Installing the wheel (or any of the platform installers in
[09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md)) puts a single
\`z30\` entry point on the path. Every subcommand is also reachable as a module, which is what to
use from a source checkout without installing:

\`\`\`bash
# Launch the default web DSP transceiver application window
z30
# or: python3 -m z30_dsp.main

# Monte Carlo channel simulation and decode-threshold benchmark
z30 --benchmark
# or: python3 -m z30_dsp.benchmark

# Terminal station configuration wizard
z30 --wizard
# or: python3 -m z30_dsp.config_wizard

# RF standard station time sync scanner (WWV, CHU, DCF77, MSF, WWVB, JJY)
z30 --sync
# or: python3 -m z30_dsp.rf_time_sync

# CLI band preset manager
z30 --bands
# or: python3 -m z30_dsp.band_manager

# Native zero-dependency Tkinter desktop GUI
z30 --tkinter
# or: python3 -m z30_dsp.gui_tkinter

# Check for updates and sync from GitHub
z30 --update
# or: python3 -m z30_dsp.updater
# Non-interactive auto-pull:
z30 --update -y
\`\`\`

\`pyproject.toml\` also installs direct aliases for the same entry points, which are handy in
\`.desktop\` files and systemd units: \`z30-transceiver\`, \`z30-web\`, \`z30-gui\`, \`z30-wizard\`,
\`z30-sync\`, \`z30-bands\`.

---

## 📂 Where z-30 keeps your files

Resolved by \`z30_dsp/paths.py\`, in this order:

1. \`$Z30_HOME\`, if set — an explicit override, mainly for tests and packaging.
2. \`$XDG_CONFIG_HOME/z30\`, if \`XDG_CONFIG_HOME\` is set (Linux/BSD desktop convention).
3. \`~/.z30\` — the historical location, and the fallback everywhere else.

| File | Contents |
| :--- | :--- |
| \`config.json\` | Station configuration, clock calibration (\`app_time_offset_ms\`), CAT and PTT settings |
| \`logbook.json\` | The authoritative QSO log; the browser copy is only a cache |
| \`logbook.adi\` | ADIF 3.1.4 export written alongside the JSON log |
| \`web_dist/\` | An optional pre-built copy of the web GUI, searched before the packaged one |

A per-machine \`config.json\` is deliberately never repository-relative: an earlier version
defaulted to the bare string \`"config.json"\`, so the file landed wherever the app happened to
be launched from and a personal calibration file could be committed by accident.

---

## 🌱 Environment variables

| Variable | Effect |
| :--- | :--- |
| \`Z30_HOME\` | Overrides the per-user data directory entirely |
| \`XDG_CONFIG_HOME\` | Used as \`$XDG_CONFIG_HOME/z30\` when \`Z30_HOME\` is unset |
| \`Z30_ALLOW_SET_SYSTEM_CLOCK=1\` | Permits the opt-in, bounded, confirmed system-clock step described in [13. Operating Safety](13-Operating-Safety-Compliance-&-Security.md) |
| \`DISABLE_HMR=true\` | Turns off Vite HMR and file watching in development (used by automated tooling) |
| \`APP_URL\` | Public URL when the web UI is hosted somewhere other than the local \`127.0.0.1\` server; used for self-referential links only |

\`.env.example\` in the repository root documents anything else the build honours. Never commit a
real \`.env\`; \`.gitignore\` excludes it.

---

## 🌐 The local web server

\`z30_dsp/web_server.py\` serves the built web GUI and the hardware API that the browser cannot
reach on its own — serial CAT, CM108 HID, GPIO PTT and the \`rigctld\` relay.

- It binds \`127.0.0.1\` only, and every \`/api/\` request must carry the per-start bearer token
  plus a matching \`Origin\` and \`Host\`. Loopback is not an authentication boundary; see
  [13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md).
- It locates the web bundle in order: \`dist/\` (in the working directory, then next to the
  package), the packaged \`z30_dsp/web_dist/\`, then \`~/.z30/web_dist/\` and \`~/.z30/dist/\`. So a
  stale \`web_dist\` snapshot never wins over a bundle you just built. Serving is read-only and
  never triggers a build; pass \`--rebuild\` to run \`npm run build\` in the foreground first.
- The GPIO PTT line is held by a dead-man switch: the browser re-asserts it about every 500 ms
  and the pin drops within roughly two seconds of silence.

---

## 🔄 Updating

\`z30 --update\` wraps the git/pip update paths for each platform. Channel-by-channel
instructions — including the PWA and Termux — are in
[12. Software Updates & GitHub Sync](12-Software-Updates-&-GitHub-Sync.md).
`,
  },
  {
    id: "benchmarking-ci",
    slug: "16-Benchmarking-Testing-&-CI",
    title: "16. Benchmarking, Testing & CI",
    category: "Developer Guide",
    description: "The two benchmark modes and why the difference matters, the measured decode curves and how to reproduce them, what each test guards, and what CI enforces on every push.",
    tags: ["benchmark","monte carlo","snr","threshold","tests","pytest","ci","reproducibility","seed"],
    markdown: `# 16. Benchmarking, Testing & Continuous Integration

How z-30's numbers are produced, how to reproduce them, and what the test suite is defending.
**Any sensitivity figure quoted anywhere in this project must come from a seeded run of the
benchmark described here, and must say which mode produced it.**

---

## 🎲 The two benchmark modes, and why the difference matters

**\`--mode realistic\` (default) measures a decode threshold.** Every frame gets a random carrier
offset and a random timing offset, and optionally Watterson HF fading. The receiver is then
handed nothing but audio: it locates the frame using only the 21 Costas sync symbols
(\`z30_dsp/acquisition.py\`), estimates the noise floor from the spectrum itself, and decodes
from whatever it found. **This is the number that is comparable with other modes' published
on-air figures.**

**\`--mode ideal\` measures a genie-aided bound, which is not a threshold.** The demodulator is
handed the exact noise sigma, the exact carrier frequency and perfect symbol timing, on a clean
channel. It bounds what the code can do under ideal detection, and nothing more.

Earlier revisions of the project's documentation quoted the \`ideal\` number against FT8's on-air
-21 dB and concluded a "+4.0 dB link margin advantage". That comparison did not hold and has
been withdrawn. Both curves are now measured, and the gap between them is the answer to why.

---

## 📉 The measured set

Seed \`20260830\`, 2500 Hz reference bandwidth, carrier offset ±5 Hz, timing offset ±0.5 s:

| Channel | Frames/point | 50% decode | 90% decode |
| :--- | ---: | :--- | :--- |
| Idealised AWGN bound (genie-aided sync — **not** an on-air figure) | 40 | -24.6 dB | -23.4 dB |
| AWGN, blind acquisition | 40 | **-23.1 dB** | **-21.7 dB** |
| CCIR *moderate* fading (1.0 ms / 0.5 Hz), blind acquisition | 100 | -21.3 dB | -19.5 dB |
| CCIR *poor* fading (2.0 ms / 1.0 Hz), blind acquisition | 100 | -21.3 dB | -19.0 dB |

**1.5 dB of the bound is spent simply finding the signal.** That gap is the acquisition loss —
what it costs to *find* the signal rather than be told where it is. Any mode's genie-aided
bound is optimistic by a similar margin, which is why the two must never be compared across
that line. See
[11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) for what
this does and does not mean against FT8.

**The two fading presets are not separable at the 50% point, and the table says so rather than
printing two numbers that look different.** They were re-measured at 100 frames per point
precisely because 40 frames could not tell them apart: at -21 dB the moderate preset decoded
57/100 (Wilson 95% CI 47.2–66.3%) and the poor preset 65/100 (55.2–73.6%), intervals that
overlap across most of their range. Both interpolate to -21.3 dB. The 90% points do separate,
in the expected direction, by 0.5 dB.

Why the two presets are so close has **not** been measured and no mechanism is claimed here.
What can be said without measuring anything is arithmetic from the preset parameters: a 1.0 ms
and a 2.0 ms delay spread give coherence bandwidths of roughly 160 Hz and 80 Hz, both far wider
than z-30's 50 Hz occupied bandwidth, so neither preset is frequency-selective across this
signal. That leaves Doppler spread (0.5 vs 1.0 Hz) as the parameter that differs in a way the
waveform can see. Whether that accounts for the result is a question for a benchmark, not for
this paragraph.

---

## 🔁 Reproducing the curves

Every run is seeded, so these are reproducible rather than anecdotal — record the seed with any
figure you publish:

\`\`\`bash
# The honest curve (the default).
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40

# On a disturbed ionospheric path. 100 frames, because 40 could not separate the two presets.
python -m z30_dsp.benchmark --mode realistic --fading moderate --min-snr -23 --max-snr -17 --frames 100
python -m z30_dsp.benchmark --mode realistic --fading poor     --min-snr -23 --max-snr -17 --frames 100

# The genie-aided bound, for comparison only.
python -m z30_dsp.benchmark --mode ideal --min-snr -30 --max-snr -20 --frames 40
\`\`\`

Sample output from the default mode:

\`\`\`
================================================================================================
  z-30 DECODE THRESHOLD (blind acquisition through the real receive chain)
  Carrier offset +/-5.0 Hz | timing offset +/-0.50 s | fading: No fading (AWGN only) (0.0 ms / 0.0 Hz)
  The receiver is given only audio: it finds the frame and estimates the noise itself.
  40 frames/point | Sample Rate: 6000 Hz | Max Iterations: 45 | Seed: 20260830
================================================================================================
SNR (2500Hz)   | Frames  | Success  | FER       | Decode %  | Avg Iters  | Acq fail | Timing RMS  | Freq RMS
------------------------------------------------------------------------------------------------
 -28.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 15       |    311.3 ms |   4.61 Hz
 -27.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 3        |    190.0 ms |   2.41 Hz
 -26.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 1        |    124.4 ms |   2.24 Hz
 -25.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 1        |    144.7 ms |   0.83 Hz
 -24.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 0        |     17.8 ms |   0.32 Hz
 -23.0 dB      | 40      | 22       | 0.4500    |    55.0%  |   77.6     | 0        |     13.7 ms |   0.18 Hz  <-- 50% crossing interpolates to -23.1 dB
 -22.0 dB      | 40      | 34       | 0.1500    |    85.0%  |   24.9     | 0        |     13.5 ms |   0.18 Hz
 -21.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.2     | 0        |      9.6 ms |   0.14 Hz  <-- 90% crossing interpolates to -21.7 dB
 -20.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.1     | 0        |      7.2 ms |   0.12 Hz
 -19.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.0     | 0        |      7.5 ms |   0.10 Hz
 -18.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.0     | 0        |      4.4 ms |   0.09 Hz
 -17.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.0     | 0        |      3.9 ms |   0.07 Hz
================================================================================================
\`\`\`

The \`Acq fail\`, \`Timing RMS\` and \`Freq RMS\` columns report the acquisition stage's own error —
how often it landed more than half a symbol away, and how far off it was in time and frequency.
Below about -24 dB the sync pattern stops being findable at all, and that shows up in those
columns rather than being hidden inside the frame error rate.

---

## 🖥️ The in-app benchmark, and why it now agrees with the Python one

**Station Settings → 5. Experimental Testing → Launch Benchmark Suite** runs the same two modes
in the browser, over \`src/dsp/monteCarloEngine.ts\`. It has a **Measurement mode** selector, and
it defaults to \`realistic\` for the same reason the Python benchmark does.

In realistic mode the browser engine gives every frame a random carrier offset (±5 Hz) and
timing offset (±0.5 s), searches for the frame using only the 21 Costas symbols
(\`acquireFrame\`), estimates the noise floor from the audio itself (\`estimateNoiseSigma\`), and
counts a frame it cannot find as a failure. The \`Acq Fail\`, \`Timing RMS\` and \`Freq RMS\` columns
of the results table are the same diagnostics the Python table carries.

The two engines model the same receiver, and the two constants that say so are shared and
pinned by \`tests/test_cross_language_parity.py\`:

| Constant | Value | What it fixes |
| :--- | :--- | :--- |
| \`SLOT_SEARCH_MARGIN_SEC\` | 0.05 s | The timing search half-width is the station's timing uncertainty plus this margin — ±0.55 s at the default ±0.5 s offset. z-30 is slot-synchronised, so a real receiver knows where the frame should start and searches a window, not an arbitrary stream. |
| \`REALISTIC_PILOT_COHERENCE\` | 0.0 | Purely non-coherent demodulation, which is what z-30's receiver is specified to be. \`ideal\` mode keeps the pilot-adaptive weight, because it is handed perfect timing. |

Measured at seed \`20260830\`, 40 frames per point, AWGN:

| | Python (\`z30_dsp/benchmark.py\`) | Browser (\`monteCarloEngine.ts\`) |
| :--- | :--- | :--- |
| Genie-aided bound, 50% | -24.6 dB | ≈ -24.2 dB |
| AWGN blind acquisition, 50% | **-23.1 dB** | **-23.0 dB** |

> **Correction (2026-08-31, second revision):** this page used to publish that same row as
> **-21.1 dB** against **≈ -22.9 dB** and explain the 1.8 dB gap by saying the browser searched a
> narrower timing window. That explanation was wrong, and so was the Python figure.
>
> Both were tested paired — the identical frame, fading realisation, carrier offset, timing
> offset and noise decoded twice, changing one thing at a time:
>
> - **Timing search width** (full-stream vs slot-synchronised), 200 frames from -26 to -22 dB:
>   **zero discordant decodes**, exact two-sided McNemar p = 1. The search width accounted for
>   none of the gap.
> - **Demodulator coherent weight** (pilot-adaptive 0.35–0.85 vs zero), 160 frames from -24 to
>   -21 dB: **59 discordant pairs, 55 won by the non-coherent receiver and 4 by the
>   semi-coherent one**, exact two-sided McNemar p = 1.7×10⁻¹² — greater than 99.9999999%
>   confidence, clearing the ≥99% bar [\`AGENTS.md\` §5](../AGENTS.md#5-honest-numbers) sets for a
>   result that changes a published figure.
>
> The Python benchmark had been applying a pilot-aided semi-coherent term through the whole
> realistic path. Under the timing error that blind acquisition actually leaves, a few
> milliseconds rotates each tone by $2\\pi f \\Delta t$, so that term is measured against the wrong
> phase reference and cancels signal instead of reinforcing it. The browser engine had already
> been dropping it. **The Python benchmark was measuring a receiver worse than the one z-30
> specifies, and the published threshold was 2.0 dB pessimistic as a result.**
>
> The trade-off side is recorded rather than left out: at -24 dB, below the point where the
> Costas pattern is reliably findable, both receivers are near zero and the semi-coherent one
> took that point 3–0. The full per-point table is in the \`REALISTIC_PILOT_COHERENCE\` comment in
> \`z30_dsp/benchmark.py\`.

Both engines now run the same receiver model and land 0.1 dB apart on the threshold, which is
inside the sampling noise of 40 frames per point. **The Python benchmark is still the
reference**: it is the one CI runs, the one the seed defaults are pinned to, and the one whose
output the tables above are copied from. Use the browser engine to see which way a change moved
the curve without leaving the app; confirm with a seeded Python run before a number reaches
documentation.

One thing the browser engine is *not* free to differ on: \`ideal\` and \`realistic\` mean exactly
what they mean here. A browser run in \`ideal\` mode is a bound, is labelled a bound in the UI,
and the FT8 overlay is off by default and marked not-comparable when switched on.

---

## 🔬 A worked example: a benchmark challenging the wiki

This is the case the rule in [\`AGENTS.md\` §5](../AGENTS.md#5-honest-numbers) ("benchmarks and
test suites are the only challengers of the wiki") exists to generalise.

While auditing the mismatch corrected above, the question was: which is actually the better
decoder design - the single normalized min-sum schedule this page (wrongly) described, or the
four-schedule cascade both codebases actually ship? That is answerable, and it was answered with
a benchmark rather than an opinion:

- A faithful, from-scratch reimplementation of the single-schedule design ($\\alpha = 0.75$,
  layered, forward-order, 45-iteration cap, no SPA/reverse/dither/Trellis-IRA step) was built
  from this page's own prior text.
- It was run **paired** against the real \`Z30LdpcCodec.decode_min_sum\` - the identical frame,
  waveform and channel noise handed to both decoders in the same trial, seeded from
  \`DEFAULT_BENCHMARK_SEED\` (\`20260830\`) - at SNR −24, −25 and −26 dB (2500 Hz reference, ideal
  synchronisation), 80 frames per point.
- Pairing turns every trial where the two decoders disagree into one vote for whichever design
  decoded that frame. Across all three points: **23 disagreements, 23 of them won by the
  cascade, 0 won by the single schedule.**

| SNR | Frames | Cascade decode % | Single-schedule decode % | Cascade-only wins | Single-only wins |
| :-- | --: | --: | --: | --: | --: |
| −24 dB | 80 | 76.2% | 65.0% | 9 | 0 |
| −25 dB | 80 | 27.5% | 15.0% | 10 | 0 |
| −26 dB | 80 | 5.0% | 0.0% | 4 | 0 |

An exact two-sided McNemar test on the pooled 23 discordant pairs (23 vs. 0) gives
**p ≈ 4×10⁻⁷ — greater than 99.9999% confidence** that the cascade decodes more frames than the
single schedule at these operating points, comfortably clearing the ≥99% bar \`AGENTS.md\` §5 sets
for a result that changes the wiki. The trade-off side of that same result was recorded rather
than left out: the cascade also costs 2-3× more iterations per frame near threshold (an average
of 112.6 vs 40.5 iterations at −25 dB), which matters against the 4.5 s decode-plus-SIC budget in
[03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md).

The result: the wiki was corrected (this page and
[04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md)), not the decoder.
Nobody proposed reverting the code to match old documentation once the documentation was shown to
describe the worse design.

---

## 🧪 The test suite

\`\`\`bash
# Python DSP suite
pip install -r requirements.txt pytest
python -m pytest tests -v

# TypeScript: typecheck (strict mode is on, with noUnusedLocals AND noUnusedParameters) plus
# the codec, DSP module and transmit-path tests
npm ci
npm run lint
npm run test:ts

# Production web bundle (regenerates the embedded Python source and wiki articles first)
npm run build
\`\`\`

What the suite covers, and why each test is there:

| Test | Guards against |
| :--- | :--- |
| \`tests/test_ldpc_codec.py\` | An encoder that disagrees with its own parity-check matrix, a connection table that loses its girth-6 property, a CRC that stops detecting single-bit errors |
| \`tests/test_modem_spectrum.py\` | A transmitter that splatters. Asserts the 99% occupied bandwidth and the -40 dB bandwidth against fixed budgets, and asserts that the old per-symbol-gated waveform **fails** them, so the test can demonstrably tell the difference |
| \`tests/test_channel_acquisition.py\` | A channel model or acquisition stage that stops being reproducible under a fixed seed |
| \`tests/test_cross_language_parity.py\` and \`tests/crc14.test.mjs\` | The Python and TypeScript codecs silently drifting apart — each half keeps working perfectly on its own while losing the ability to decode the other. Shared known-answer vectors live in \`tests/vectors/crc14_vectors.json\` |
| \`tests/test_web_server_api.py\` | The local API losing its token, \`Origin\` or \`Host\` checks; the GPIO pin whitelist; the PTT dead-man switch actually releasing |
| \`tests/test_time_sync_guards.py\` | The system clock becoming settable by default, or an unbounded step from a spoofed time signal |
| \`tests/frontend.test.mjs\` | The transmit gate admitting an out-of-band frequency, an unseeded benchmark PRNG, an amplitude-gated waveform, unvalidated station config, Maidenhead decoding, and the browser benchmark's acquisition stage (that it finds a displaced frame, estimates its own noise floor, refuses to "find" one in pure noise, and reproduces its offsets from the seed) |
| \`tests/transmitPath.test.mjs\` | The three defects that only appear with a radio attached: a PTT release that drops a different pin than the key drove, a "Test PTT" that reports success without addressing the hardware, and the raw rigctl console keying without the transmit gate. Also the rigctl verb table, where case is significant |
| \`tests/test_config_wizard.py\` and \`tests/frontend.test.mjs\` | The Python setup wizard and the browser transmit gate disagreeing about which callsigns are valid — a wizard that blesses a callsign the gate will refuse at slot start. Shared vectors in \`tests/vectors/callsign_vectors.json\` |

---

## 🤖 What CI enforces

\`.github/workflows/ci.yml\` runs on every push and pull request:

- **Python DSP suite** on 3.10 and 3.12, plus a wheel build-and-import check.
- **Benchmark smoke test**: a short seeded sweep in both modes, run twice, asserting identical
  results. This catches non-determinism in the channel/acquisition path, which would otherwise
  only surface when someone tried to reproduce a published curve.
- **Generated sources are up to date** (\`npm run check:generated\`): \`src/data/pythonSource.ts\`
  and \`src/data/wikiArticles.ts\` are produced from the real Python files and the markdown in
  \`wiki/\`. Both were once hand-copied snapshots that drifted — the in-app wiki still showed
  retracted sensitivity claims long after the markdown was corrected.
- **Typecheck, TypeScript tests and the production web build.**
- **PWA assets**: \`sw.js\`, \`manifest.json\` and both icons must be present in the build, and the
  service-worker cache name must be build-stamped rather than left as the placeholder.
- **Repository hygiene**: a LICENSE file containing the MIT text, no tracked build artifacts or
  bytecode, and exactly one JavaScript lockfile.

---

## ✅ Before you publish a number

1. Run the benchmark seeded, and quote the seed, frame count and mode alongside the figure.
2. Never compare a \`--mode ideal\` figure with another mode's published on-air threshold.
3. If a DSP change moves the threshold, update **every** place the figure appears: this page,
   [03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md),
   [11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md),
   the pull request checklist in
   [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md),
   \`Home.md\`, and the summary line in the repository \`README.md\`.
4. Regenerate the in-app copy afterwards (\`npm run generate:wiki\`), or CI will fail.
`,
  },
];
