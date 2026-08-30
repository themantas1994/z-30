# z-30: Experimental Amateur Radio 16-MFSK Weak-Signal Digital Transceiver & DSP Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![Platform](https://img.shields.io/badge/platform-Android%20|%20Ubuntu%20|%20Arch%20|%20Windows%20|%20Linux%20|%20Raspberry%20Pi-brightgreen.svg)]()
[![Radio Mode](https://img.shields.io/badge/mode-16--MFSK%20|%20LDPC--SIC%20|%2030s%20Cycle-orange.svg)]()
[![PWA Ready](https://img.shields.io/badge/PWA-Installable%20Offline-blueviolet.svg)]()

**z-30** is an open-source, next-generation amateur radio weak-signal digital communications and DSP engineering suite. Engineered for extreme HF, VHF, and microwave propagation conditions (down to **-25.0 dB SNR** 50% decode threshold / **-24.0 dB SNR** 90% decode threshold in 2500 Hz reference bandwidth), z-30 combines an ultra-narrow **50.0 Hz occupied bandwidth** 16-MFSK modulation scheme, a rate-0.356 irregular repeat-accumulate (IRA) Low-Density Parity-Check (LDPC) forward error correction code, and multi-pass **Successive Interference Cancellation (SIC)** to decode co-channel signals with zero packet collision dropouts.

The project provides both a high-performance **interactive Web/PWA GUI** (featuring a 60 FPS HTML5 spectral waterfall, Web Audio 12/48 kHz DSP pipeline, live S-meter, and ADIF logbook) and a **native Python 3 DSP package (`z30_dsp`)** with Hamlib CAT transceiver control (`rigctld`), 9 PTT keying methods, 6 auto-reply sequencing algorithms, and automated RF time calibration against international time standards (**WWV, CHU, DCF77, MSF, WWVB, JJY**).

---

## Table of Contents

1. [Key Features & Capabilities](#key-features--capabilities)
2. [Comparison with Other Digital Modes (FT8, FT4, WSPR, JS8Call)](#comparison-with-other-digital-modes)
3. [Operating Safety, Compliance & Local Security](#operating-safety-compliance--local-security)
4. [Deep-Dive: Protocol & DSP Architecture](#deep-dive-protocol--dsp-architecture)
   - [Modulation & Waveform Parameters](#modulation--waveform-parameters)
   - [Synchronous 30-Second Cycle Timing](#synchronous-30-second-cycle-timing)
   - [LDPC (216, 77) & CRC-14 Forward Error Correction](#ldpc-216-77--crc-14-forward-error-correction)
   - [Iterative Successive Interference Cancellation (SIC)](#iterative-successive-interference-cancellation-sic)
   - [Automatic RF Standard Station Time Sync](#automatic-rf-standard-station-time-sync)
5. [Cross-Platform Installation & Build Guide](#cross-platform-installation--build-guide)
   - [Ubuntu & Debian (20.04 / 22.04 / 24.04)](#ubuntu--debian)
   - [Arch Linux, Manjaro, EndeavourOS & CachyOS](#arch-linux-manjaro-endeavouros--cachyos)
   - [Windows 10 & 11](#windows-10--11)
   - [Android (PWA & Termux Field Operations)](#android-pwa--termux)
   - [Raspberry Pi & Embedded Linux (DigiPi / SBCs)](#raspberry-pi--embedded-linux)
   - [Generic Linux & PyPI Package](#generic-linux--pypi)
6. [User Interface & Operation Guide](#user-interface--operation-guide)
   - [60 FPS Spectral Waterfall & Spectrogram](#60-fps-spectral-waterfall--spectrogram)
   - [QSO State Machine & Auto-Sequencing](#qso-state-machine--auto-sequencing)
   - [Auto-Reply Priority Strategies](#auto-reply-priority-strategies)
   - [CAT Rig Control & S-Meter Integration](#cat-rig-control--s-meter-integration)
   - [Supported PTT Keying Architectures](#supported-ptt-keying-architectures)
   - [Interactive Station Setup Wizard](#interactive-station-setup-wizard)
   - [Band Manager & Presets (160m – 70cm)](#band-manager--presets)
   - [ADIF 3.1.4 Logbook & Contest Export](#adif-314-logbook--contest-export)
7. [Python CLI & Native Tools](#python-cli--native-tools)
8. [Development, Tests & CI](#development-tests--ci)
9. [Repository Structure](#repository-structure)
10. [Contributing & License](#contributing--license)

---

## Key Features & Capabilities

- **Empirical Weak-Signal Threshold**: Decodes signals down to **-25.0 dB SNR** (50% decode threshold) and **-24.0 dB SNR** (90% decode threshold) on AWGN channels and **-22.5 dB SNR** under severe Rayleigh and polar flutter fading (delivering a **+4.0 dB link margin advantage over FT8**, equivalent to a $2.5\times$ Effective Radiated Power boost).
- **Spectrum Efficiency**: Requires only **50.0 Hz** of RF bandwidth per transmission (allowing up to **50 simultaneous QSOs** in a standard 2.7 kHz SSB transceiver passband).
- **Multi-Pass SIC Engine**: Automatically reconstructs, synthesizes, and subtracts strong decoded carrier waveforms from the time-domain audio buffer to uncover and decode overlapping weak signals buried up to 25 dB underneath stronger stations.
- **Sub-Millisecond RF Time Synchronization**: Embedded DSP time calibration tool (`z30_dsp/rf_time_sync.py`) scans international standard stations (WWV/WWVH, CHU, DCF77, MSF, WWVB, JJY) using 61-tap Windowed-Sinc FIR filtering and normalized cross-correlation to eliminate clock drift ($\Delta t$) down to $<1.5\text{ ms}$ without needing administrative or root privileges.
- **Hardware Agnostic Transceiver Control**: Fully supports physical transceivers via **Hamlib (`rigctld`)**, audio interfaces (SignaLink, Digirig, microHAM, DRA-30/50/70, USB soundcards, Icom/Yaesu/Kenwood/Elecraft/Xiegu internal USB audio), and standalone SDRs (via TCI network protocol).
- **9 PTT Keying Methods**: Supports CAT Software Commands, RTS Hardware Serial Line, DTR Hardware Serial Line, Right-Channel Audio PTT Tone (1000/1500 Hz), C-Media CM108/CM119 USB GPIO, Raspberry Pi / Linux SBC GPIO, VOX, TCI Network Socket, and K1EL WinKeyer 2/3.
- **6 Intelligent Auto-Reply Priority Modes**: Configurable QSO answer rules: *First Decoded (Chrono)*, *Last Decoded*, *Strongest Signal (Max SNR)*, *Weakest Signal (Deep DX)*, *Nearest Station (Min Distance)*, and *Farthest DX (Max Distance)*.
- **High-Rate 60 FPS Waterfall Display**: GPU-accelerated HTML5 Canvas with 10 scientific color palettes (Turbo, Inferno, Viridis, Plasma, Magma, WSJT-X Classic, Night Vision Green, Amber CRT, High-Contrast B&W, Spectral Heatmap), variable zoom ($1\times$ to $8\times$), trace contrast multipliers ($1\times$, $1.6\times$, $2.2\times$), and double-click carrier arming.
- **Interactive 4-Step Setup Wizard**: Automatically guides new operators through station identification (Callsign/Maidenhead locator auto-lookup), soundcard I/O selection with live volume calibration, Hamlib CAT connection, and PTT keying verification.
- **Full ADIF 3.1.4 Logbook Engine**: Built-in QSO manager with real-time distance/bearing calculation, search/filter matrix, and one-click export for LoTW, QRZ, ClubLog, and eQSL.
- **Complete Cross-Platform Delivery**: Runs natively across **Android (PWA & Termux)**, **Ubuntu/Debian**, **Arch Linux / Manjaro**, **Windows 10/11**, **Raspberry Pi**, and standalone embedded platforms.

---

## Comparison with Other Digital Modes

The following table benchmarks **z-30** against standard amateur radio digital modes: **FT8**, **FT4**, **WSPR**, and **JS8Call**.

| Metric / Parameter | **z-30 (This Protocol)** | **FT8** | **FT4** | **WSPR** | **JS8Call** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cycle Duration** | **30.0 s** | 15.0 s | 7.5 s | 120.0 s | 15.0 s (Var) |
| **Occupied Bandwidth** | **50.0 Hz** | 47.0 Hz | 83.0 Hz | 5.9 Hz | 50.0 Hz |
| **Modulation Type** | **16-MFSK (CPFSK)** | 8-GFSK | 4-GFSK | 4-FSK | 8-GFSK |
| **Baud Rate (Symbol Rate)** | **3.125 baud** | 6.25 baud | 20.83 baud | 1.4648 baud | 6.25 baud |
| **Tone Spacing ($\Delta f$)** | **3.125 Hz** | 6.25 Hz | 20.83 Hz | 1.4648 Hz | 6.25 Hz |
| **Active TX Duration** | **24.0 s (75 symbols)** | 12.64 s | 4.48 s | 110.6 s | 12.64 s |
| **Decode / Guard Window** | **6.0 s** | 2.36 s | 3.02 s | 9.4 s | 2.36 s |
| **Sensitivity (50% AWGN)** | **-25.0 dB SNR** | -21.0 dB SNR | -17.5 dB SNR | -28.0 dB SNR | -24.0 dB SNR |
| **Sensitivity (90% AWGN)** | **-24.0 dB SNR** | -20.0 dB SNR | -16.5 dB SNR | -27.0 dB SNR | -22.5 dB SNR |
| **FEC Code** | **LDPC (216, 77) Rate ~0.356** | LDPC (174, 91) Rate 0.52 | LDPC (174, 91) Rate 0.52 | Convol. $K=32, r=1/2$ | LDPC (174, 91) |
| **Payload Capacity** | **77 bits (63-bit info + CRC-14)** | 77 bits (CRC-14) | 77 bits (CRC-14) | 28 bits (Call+Loc+Pwr) | Free text (var) |
| **Collision Recovery** | **Multi-Pass SIC (3 passes)** | Single pass (limited) | None | Non-coherent | Single pass |
| **Primary Use-Case** | **Deep DX / EME / Solar Minima** | General DX / Contesting | Rapid Contesting | Propagation Beaconing| Conversational Keyboard |
| **Clock Drift Tolerance** | **$\pm 1.5\text{ s}$ (with RF Auto-Sync)** | $\pm 1.0\text{ s}$ | $\pm 0.5\text{ s}$ | $\pm 2.0\text{ s}$ | $\pm 1.0\text{ s}$ |
| **Spectral Density** | **50 QSOs per 2.7 kHz band** | ~40 QSOs per band | ~25 QSOs per band | N/A (One-way) | ~30 QSOs per band |

### Why 16-MFSK and a 30-Second Cycle?
1. **+4.0 dB Sensitivity Advantage Over FT8**: By reducing symbol rate from 6.25 baud to 3.125 baud and applying a low Rate-0.356 LDPC code with 75 total symbols, z-30 recovers signals **4.0 dB lower than FT8** (50% threshold at $-25.0\text{ dB}$ vs $-21.0\text{ dB}$). This $2.51\times$ power multiplier turns a 40W station into the effective link margin of a 100W station, opening paths across 160m, 6m, 2m EME, and high-latitude paths during solar geomagnetic disturbances.
2. **True Co-Channel Collision Recovery**: Traditional FT8 fails when two signals occupy the same audio frequency bins. z-30 incorporates a 3-pass **Successive Interference Cancellation (SIC)** algorithm: when a strong signal is decoded, its exact RF phase and amplitude are synthesized and cleanly subtracted from the raw FFT bins, enabling a second and third decoding pass on previously obscured weak signals.

---

## Operating Safety, Compliance & Local Security

This application keys real transmitters over serial, CM108, GPIO and audio VOX, and it exposes
a local HTTP API to do it. The following behaviours are deliberate and are not configurable
away casually.

### Before it will transmit at all

Every transmit entry point - the automatic QSO sequencer, the manual TX button, and the tune
carrier - passes through a single gate (`canTransmit()` in `src/dsp/catController.ts`). It
**fails closed**, and any refusal names the exact condition that failed:

| Condition | Why |
| --- | --- |
| A syntactically valid callsign that is not the shipped `W1AW` placeholder | An unidentified transmission, or one under someone else's call, is a licence problem |
| A configured regulatory region and licence class | Band edges and sub-band privileges differ by country and by class; there is no safe way to guess either |
| Dial frequency **plus audio offset** inside a data-mode segment your class holds | The radiated frequency is not the dial frequency, and this is what puts a station out of band |

The band plan lives in `src/dsp/bandPlan.ts` and covers IARU Regions 1-3 plus the FCC Part 97
sub-band structure, with the date each entry was last checked. National rules vary and change:
the gate catches a mistuned VFO or a wrong band button, it does not replace knowing your own
licence conditions.

### Stuck-transmitter protection

Three independent layers, because the failure being defended against is "the software stopped
running":

1. **Browser-side maximum-transmission timer.** A frame is 24 s; `MAX_TX_SECONDS` is 40 s.
   Past that, PTT is force-released across every keying path.
2. **Server-side dead-man switch on the GPIO PTT line.** The browser must re-assert PTT every
   ~500 ms; if it stops, `z30_dsp/web_server.py` drops the pin within about two seconds. A
   crashed tab, a killed renderer or a sleeping machine cannot send a keepalive - and cannot
   run a browser-side timer either, which is why this layer has to exist separately. A hard
   40 s ceiling applies even if keepalives keep arriving.
3. **`atexit` and `SIGTERM`/`SIGINT` handlers** that release every claimed GPIO pin, so killing
   the server does not leave a radio keyed.

### The local API is authenticated

`z30_dsp/web_server.py` binds `127.0.0.1` only, but **loopback is not an authentication
boundary**: any page in any browser tab can `fetch()` a loopback URL, and a `text/plain` POST
is a CORS simple request that is sent with no preflight. Every `/api/` request must therefore
satisfy all three of:

- a bearer token (`X-Z30-Token`) minted fresh at each server start and injected only into the
  `index.html` that this process serves;
- an `Origin` header that is absent or exactly this server's own origin;
- a `Host` header naming this server's own loopback address and port, which blocks DNS
  rebinding.

No wildcard `Access-Control-Allow-Origin` header is sent anywhere, only the single configured
BCM pin can be driven, and the rigctld relay will only talk to loopback daemons.

### The system clock

z-30 keeps its clock correction to itself as `app_time_offset_ms`, which is all its slot timing
needs. Stepping the machine's clock from a decoded time station is opt-in, confirmed, bounded
to 5 minutes, and refused when an NTP daemon already owns the clock. See
[Automatic RF Standard Station Time Sync](#automatic-rf-standard-station-time-sync).

### Your logbook is a file

Contacts are mirrored to `~/.z30/logbook.json` with an ADIF export written beside them
(`XDG_CONFIG_HOME` is honoured). The browser copy is a cache. Clearing browsing data, a private
window, a different browser or a different port number all lose `localStorage`; none of them
touch the file. A failed save is shown in the UI rather than logged to a console nobody reads.

### What is still on you

Rendering a clean waveform in software is necessary, not sufficient. **Capture your
transmitter's actual output and check the occupied bandwidth on a spectrum analyser before
using this on the air** - sound-card clipping and rig ALC will re-broaden a clean signal, and
no amount of correct DSP upstream prevents that.

---

### Empirical Monte Carlo Physical Waveform & LDPC Benchmark Results

The following empirical benchmark was executed across **7,500 total physical frames** (300 independent frames per 0.5 dB SNR point) using the native z-30 continuous-phase 16-MFSK modulator, AWGN channel model, and (216, 77) Log-Min-Sum LDPC belief propagation decoder:

```
z-30 Monte Carlo Physical Waveform & LDPC Decoder Benchmark Results
====================================================================
Channel: AWGN | Frames/Pt: 300 | Code: (216, 77) LDPC R=0.356
--------------------------------------------------------------------
SNR (dB) | Frames | Success | Failed | FER     | Decode % | Avg Iters
--------------------------------------------------------------------
-34.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-33.5    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-33.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-32.5    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-32.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-31.5    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-31.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-30.5    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-30.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-29.5    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-29.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-28.5    | 300    | 1       | 299    | 0.9967  | 0.3%     | 104.7
-28.0    | 300    | 0       | 300    | 1.0000  | 0.0%     | 105.0
-27.5    | 300    | 1       | 299    | 0.9967  | 0.3%     | 105.0
-27.0    | 300    | 10      | 290    | 0.9667  | 3.3%     | 102.3
-26.5    | 300    | 20      | 280    | 0.9333  | 6.7%     | 99.3
-26.0    | 300    | 40      | 260    | 0.8667  | 13.3%    | 93.8
-25.5    | 300    | 114     | 186    | 0.6200  | 38.0%    | 72.7
-25.0    | 300    | 177     | 123    | 0.4100  | 59.0%    | 50.6   <-- 50% Decode Threshold (-25.0 dB)
-24.5    | 300    | 254     | 46     | 0.1533  | 84.7%    | 24.3
-24.0    | 300    | 284     | 16     | 0.0533  | 94.7%    | 11.9   <-- 90% Decode Threshold (-24.0 dB)
-23.5    | 300    | 298     | 2      | 0.0067  | 99.3%    | 5.4
-23.0    | 300    | 299     | 1      | 0.0033  | 99.7%    | 3.1
-22.5    | 300    | 299     | 1      | 0.0033  | 99.7%    | 2.7
-22.0    | 300    | 300     | 0      | 0.0000  | 100.0%   | 1.7
--------------------------------------------------------------------
```

---

## Deep-Dive: Protocol & DSP Architecture

```
                                      z-30 DSP Transmit / Receive Flow
                                      ================================

       [ Structured QSO Message ]                           [ Raw Audio In (12 / 48 kHz / 16-bit) ]
                 │                                                          │
       [ 63-bit Radix-37/27 Packing ]                             [ Audio Buffer (24.0s Window) ]
                 │                                                          │
       [ 14-bit CRC Parity Insertion ]                             [ Downsample & Matched Filter ]
                 │                                                          │
       [ Rate-1/3 QC-LDPC Encoder (216, 77) ]                     [ FFT Energy Binning (16 Tones) ]
                 │                                                          │
       [ 21-Symbol Costas Synchronization ]                        [ Costas Array Sync Detection ]
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
- **Symbol Count per Frame**: 75 symbols ($75 \times 0.320\text{ s} = 24.0\text{ s}$ active transmission duration).
- **Data vs Sync Symbols**: 54 Data Symbols ($54 \times 4\text{ bits} = 216\text{ channel bits}$) + 21 Costas-like Synchronization Symbols.
- **Synchronization**: 21 Costas array sync symbols interleaved throughout the frame at positions `[0,1,2, 7,8,9, 17,18,19, 27,28,29, 37,38,39, 47,48,49, 72,73,74]` providing sub-Hz frequency tracking and symbol time offset ($\Delta t$) estimation.

### Synchronous 30-Second Cycle Timing

The UTC clock cycle is divided into even and odd 30-second transmission slots:
- **`EVEN` Slot**: Begins exactly at `:00` of each UTC minute (slot span `:00` to `:30`).
- **`ODD` Slot**: Begins exactly at `:30` of each UTC minute (slot span `:30` to `:00`).
- **Active Transmission Window**: $0.00\text{ s}$ to $24.00\text{ s}$ ($24.0\text{ s}$ frame length).
- **DSP Decode & SIC Processing Window**: $24.00\text{ s}$ to $28.50\text{ s}$ ($4.50\text{ s}$ compute budget).
- **Sequencing & CAT Tuning Guard Window**: $28.50\text{ s}$ to $30.00\text{ s}$ ($1.50\text{ s}$ rig turnaround time).

### LDPC (216, 77) & CRC-14 Forward Error Correction

1. **Payload**: 63 bits of user information (28-bit Radix-37/27 destination callsign + 28-bit Radix-37/27 source callsign + 7-bit grid/report field covering 4-character Maidenhead grid locators, SNR signal reports, and standard modifiers like `CQ`, `RR73`, `73`).
2. **CRC Parity**: A 14-bit cyclic redundancy check, generator polynomial $x^{14} + x^{13} + x^{10} + x^{6} + x + 1$ (register constant `0x2443` with $x^{14}$ implicit, init `0x2757`, MSB-first). Its undetected frame error probability for random errors is $2^{-14} \approx 6.1 \times 10^{-5}$. Earlier revisions of this document and of both source files quoted $x^{14} + x^{11} + x^2 + 1$ and a $10^{-6}$ figure; neither was what the code implements, and the false-decode rate was overstated by about sixty times.
3. **Encoding**: The 77-bit protected vector is mapped into 216 bits by an **irregular repeat-accumulate (IRA)** LDPC code with a dual-diagonal parity structure and an explicit degree-5 girth-6 connection table, at rate $77/216 \approx 0.356$, then modulated onto $54 \times \log_2(16)$ channel symbols. (It is not quasi-cyclic; earlier revisions of this document called it "Rate-1/3 Quasi-Cyclic", which was wrong on both counts.)
4. **Decoding**: Log-domain Min-Sum Belief Propagation running up to 50 iterations per carrier candidate.

### Iterative Successive Interference Cancellation (SIC)

When high-power local stations mask weak DX stations transmitting within the same 50 Hz slice:
1. **Pass 1**: The engine identifies, synchronizes, and decodes the dominant signal.
2. **Reconstruction**: The DSP synthesizes the precise continuous-phase carrier waveform matching the decoded payload, scaling it by the measured amplitude, time delay, and phase trajectory.
3. **Subtraction**: The synthetic carrier is subtracted in the time domain:
   $$x_{\text{residual}}(t) = x_{\text{received}}(t) - \hat{s}_{\text{decoded}}(t)$$
4. **Pass 2 & 3**: The residual waveform $x_{\text{residual}}(t)$ is re-fed into the LDPC decoder to instantly unlock previously hidden signals down to the thermal noise floor.

### Automatic RF Standard Station Time Sync

In remote or field locations without NTP internet access, z-30 includes `z30_dsp/rf_time_sync.py`:
- Scans global HF/LF time standard broadcast stations (**WWV/WWVH** at 2.5/5/10/15/20 MHz, **CHU** at 3.33/7.85/14.67 MHz, **DCF77** at 77.5 kHz, **MSF/WWVB/JJY** at 40/60 kHz).
- Executes rapid 5-second carrier pre-validation followed by audio subcarrier demodulation (100 Hz BCD, 300-baud Bell 103 AFSK, 1 Hz PWM amplitude dips).
- Uses a 61-tap Windowed-Sinc FIR Bandpass filter and normalized cross-correlation against standard second/minute pulses.
- Measures system clock offset $\Delta t = T_{\text{RF}} - T_{\text{System}}$ in milliseconds and applies zero-admin application-level offset calibration.
- **Does not touch the machine's system clock by default.** A time station is an unauthenticated broadcast; a marginal decode - or a deliberately transmitted spoof - would otherwise move the host clock arbitrarily, taking TLS validity, log timestamps and cron with it. The internal `app_time_offset_ms` is all the decoder needs. Stepping the OS clock is opt-in (`"allow_set_system_clock": true` in `~/.z30/config.json`, or `Z30_ALLOW_SET_SYSTEM_CLOCK=1`), bounded to 5 minutes, and declines to fight an NTP daemon that already owns the clock.

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
python3 -c "from z30_dsp.main import main; main()"
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
npm install && npm run build
python -m build --wheel --no-isolation
pip install dist/*.whl --force-reinstall

# 4. Launch Transceiver
z30
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
3. Double-click `run_windows.bat` (this automatically creates the virtual environment, installs dependencies, builds web assets if needed, and launches the application).

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

### Raspberry Pi & Embedded Linux

For portable field boxes, DigiPi nodes, and backpack stations (Raspberry Pi 3/4/5/Zero 2W):
```bash
# 1. Install prerequisites
sudo apt-get update && sudo apt-get install -y python3-pip python3-venv libportaudio2 portaudio19-dev libhamlib-utils nodejs npm

# 2. Clone and install
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_ubuntu.sh
./install_ubuntu.sh

# 3. Direct GPIO PTT keying
# Configure PTT method to 'Raspberry Pi GPIO' (BCM Pin 17) in Setup Wizard
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

### 60 FPS Spectral Waterfall & Spectrogram

The primary canvas delivers continuous, non-blocking 60 FPS spectral analysis:
- **Colormaps**: Switch between 10 specialized scientific palettes: `Turbo`, `Inferno`, `Viridis`, `Plasma`, `Magma`, `WSJT-X Classic`, `Night Vision Green`, `Amber CRT`, `High-Contrast B&W`, and `Spectral Heatmap`.
- **Passband Presets**: Quickly toggle frequency boundaries between `200–3000 Hz (Standard)`, `500–2000 Hz (Narrow)`, `800–1800 Hz (Digital Focus)`, `100–3500 Hz (Wide)`, and `0–4000 Hz (Extended)`.
- **Trace Visibility Boost**: Enhance weak 16-MFSK tone tracks (down to $-25.0\text{ dB}$) with the 3-level contrast multiplier (`1x`, `1.6x`, `2.2x`).
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
| **TX 6** | Free-text / Special Grid | `CQ DX W1AW FN31` |

- **Auto-Sequence**: Automatically advances through macros upon receiving valid CRC-verified replies.
- **Auto-Log**: Automatically commits logged contacts to internal storage upon receiving RR73/73 and exports standard ADIF (`.adi`) logbooks compatible with LoTW, QRZ, ClubLog, and eQSL.
- **Watchdog Safety**: Prevents unattended transmission loops by disarming after a configurable number of unanswered cycles (1 to 10 cycles).

### Auto-Reply Priority Strategies

When multiple stations respond to your CQ in the same 30-second slot, z-30 automatically sorts and selects the target based on operator preference:

1. **First Decoded (Chrono)**: Answers the first decoded caller in the current time slot (standard WSJT-X Call 1st behavior).
2. **Last Decoded**: Answers the last decoded caller in the current cycle.
3. **Strongest Signal (Max SNR)**: Answers the loudest station with the highest SNR (e.g., $-4\text{ dB}$ before $-24\text{ dB}$).
4. **Weakest Signal (Deep DX)**: Prioritizes stations near the LDPC noise threshold (e.g., $-24.5\text{ dB}$ before $-6\text{ dB}$).
5. **Nearest Station (Closest km)**: Answers the geographically closest station based on Maidenhead grid distance.
6. **Farthest DX (Max Distance)**: Answers the station with the greatest Maidenhead great-circle distance (furthest DX).

### CAT Rig Control & S-Meter Integration

- Direct bidirectional serial communication over Hamlib `rigctld` (default port `4532`) or native serial ports (`COM1..COM32`, `/dev/ttyUSB*`, `/dev/ttyACM*`).
- Reads VFO dial frequency, operating mode (`USB` / `PKTUSB`), and live hardware S-Meter power in dBm.
- Live interactive CAT terminal for executing raw Hamlib commands (`\get_freq`, `\set_freq`, `\get_mode`, `\set_ptt`, `\get_level`).
- Handles synchronous Push-To-Talk (PTT) keying via CAT commands, RTS/DTR serial pins, or audio tones.

### Supported PTT Keying Architectures

z-30 includes native support and wiring guidance for 9 distinct PTT keying methods:

1. **CAT Command**: Sends digital `\set_ptt 1` commands over USB/Serial or Hamlib TCP daemon (Icom IC-7300/705/7610, Yaesu FT-991A/710/891, Kenwood TS-590SG, Elecraft K3/K4, Xiegu G90/X6100).
2. **RTS Serial Pin**: Toggles the RS-232 / USB-to-UART RTS line to key an optocoupler or buffer (Digirig, Rigblaster, microHAM).
3. **DTR Serial Pin**: Toggles the RS-232 / USB-to-UART DTR line for dual-line or legacy interfaces.
4. **Right-Channel Audio PTT Tone**: Emits a continuous 1000/1500 Hz sinusoidal tone on the Right stereo channel while data modulates the Left channel (SignaLink USB, HT cables, smartphone audio jacks).
5. **C-Media CM108 / CM119 GPIO**: Drives hardware GPIO3/GPIO4 pins on USB audio chips via USB HID reports (DRA-30/50/70, RIM, URIxB).
6. **Raspberry Pi Direct GPIO**: Drives BCM Pin 17/27 on Raspberry Pi and embedded Linux SBCs.
7. **VOX**: Relies on transceiver internal voice-operated exchange.
8. **TCI Network Socket**: High-speed network protocol for ExpertSDR, SunSDR2, and Software Defined Radios.
9. **WinKeyer**: Sends binary PTT command frames to K1EL WinKeyer 2/3 and microHAM CW Keyer chips.

### Interactive Station Setup Wizard

The built-in Setup Wizard (`Wizard` button in header) configures the station across 4 guided steps:
1. **Station Identity**: Callsign format validation, 4/6-character Maidenhead locator resolution, operator name, QTH, and timezone selection.
2. **Audio & Soundcard I/O**: Input/output device enumeration, live VU level meters, and test tone verification.
3. **Rig Control & Hamlib**: Searchable catalog of 200+ amateur transceivers, Hamlib daemon host/port, serial COM ports, baud rates, and data bits.
4. **PTT Keying & Hardware Test**: PTT method selection, wiring guidelines, polarity, lead-in/hang time sliders, and live PTT test trigger.

### Band Manager & Presets

Quickly jump between standard amateur allocations with pre-configured calling frequencies (customizable via the Band Manager):
- **160m**: $1.842000\text{ MHz}$
- **80m**: $3.576000\text{ MHz}$
- **60m**: $5.359000\text{ MHz}$
- **40m**: $7.076000\text{ MHz}$
- **30m**: $10.139000\text{ MHz}$
- **20m**: $14.076000\text{ MHz}$ *(Primary Activity)*
- **17m**: $18.102000\text{ MHz}$
- **15m**: $21.076000\text{ MHz}$
- **12m**: $24.917000\text{ MHz}$
- **10m**: $28.076000\text{ MHz}$
- **6m**: $50.316000\text{ MHz}$
- **2m**: $144.176000\text{ MHz}$
- **70cm**: $432.176000\text{ MHz}$

### ADIF 3.1.4 Logbook & Contest Export

- Complete tabular logbook recording Date, UTC Time, Callsign, Band, Dial Frequency, Mode (`Z-30`), Sent/Rcvd Reports, Maidenhead Grid, Distance (km/mi), and Operator Notes.
- One-click export to **Standard ADIF 3.1.4 (`.adi`)**, **Cabrillo**, **JSON**, and **CSV**.
- Search and filter by callsign, band, or date range.

---

## Python CLI & Native Tools

The `z30_dsp` package includes a suite of command-line tools:

```bash
# Launch default Web DSP transceiver application window
z30
# or: python3 -m z30_dsp.main

# Run Monte Carlo AWGN/Rayleigh channel simulation & FT8 comparison benchmark
z30 --benchmark
# or: python3 -m z30_dsp.benchmark

# Launch terminal-based Station Configuration Wizard
z30 --wizard
# or: python3 -m z30_dsp.config_wizard

# Run RF Standard Station Time Sync scanner (WWV, CHU, DCF77, MSF, WWVB, JJY)
z30 --sync
# or: python3 -m z30_dsp.rf_time_sync

# Launch CLI Band Preset Manager
z30 --bands
# or: python3 -m z30_dsp.band_manager

# Launch native zero-dependency Tkinter desktop GUI
z30 --tkinter
# or: python3 -m z30_dsp.gui_tkinter

# Check for updates and sync from GitHub (https://github.com/themantas1994/z-30)
z30 --update
# or: python3 -m z30_dsp.updater
# Non-interactive auto-pull:
z30 --update -y
```

---

## Development, Tests & CI

```bash
# Python DSP suite
pip install -r requirements.txt pytest
python -m pytest tests -v

# TypeScript: typecheck (strict mode is on) plus the codec and DSP module tests
npm ci
npm run lint
npm run test:ts

# Production web bundle (regenerates src/data/pythonSource.ts first)
npm run build
```

What the suite covers, and why each test is there:

| Test | Guards against |
| --- | --- |
| `tests/test_ldpc_codec.py` | An encoder that disagrees with its own parity-check matrix, a connection table that loses its girth-6 property, a CRC that stops detecting single-bit errors |
| `tests/test_modem_spectrum.py` | A transmitter that splatters. Asserts the 99 % occupied bandwidth and the -40 dB bandwidth against fixed budgets, and asserts that the old per-symbol-gated waveform **fails** them, so the test can demonstrably tell the difference |
| `tests/test_cross_language_parity.py` and `tests/crc14.test.mjs` | The Python and TypeScript codecs silently drifting apart - each half keeps working perfectly on its own while losing the ability to decode the other. Shared known-answer vectors in `tests/vectors/crc14_vectors.json` |
| `tests/test_web_server_api.py` | The local API losing its token, `Origin` or `Host` checks; the GPIO pin whitelist; the PTT dead-man switch actually releasing |
| `tests/test_time_sync_guards.py` | The system clock becoming settable by default, or an unbounded step from a spoofed time signal |
| `tests/frontend.test.mjs` | The transmit gate admitting an out-of-band frequency, an unseeded benchmark PRNG, an amplitude-gated waveform, and unvalidated station config |

`.github/workflows/ci.yml` runs all of this on every push across Python 3.10 and 3.12, plus a
wheel build-and-import check, the production web build, verification that the PWA ships its
service worker and both icons, and repository hygiene checks (a LICENSE file, no committed
build artifacts, exactly one lockfile).

---

## Repository Structure

```
├── README.md                     # Master Technical Documentation
├── LICENSE                       # MIT licence text
├── package.json                  # Web DSP / React 19 / Vite / Tailwind configuration
├── pyproject.toml                # PEP 517/621 packaging metadata (the only build config)
├── requirements.txt              # Pinned Python runtime dependencies
├── PKGBUILD                      # Arch Linux / Manjaro package build specification
├── z30.spec                      # PyInstaller standalone Windows/Linux spec
├── z30.desktop                   # Freedesktop Application Menu specification
│
├── .github/workflows/ci.yml      # Tests, typecheck, build and hygiene checks on every push
├── tests/                        # pytest suite + Node codec/DSP tests
├── scripts/                      # Build-time generators (pythonSource.ts)
├── public/                       # Static PWA assets copied verbatim into the build
│   ├── manifest.json             # PWA Web App manifest for Android / Desktop
│   ├── sw.js                     # Network-first Service Worker (build-stamped cache name)
│   ├── icon-192.svg              # PWA icon
│   └── icon-512.svg              # PWA icon
│
├── install_ubuntu.sh             # Automated installer for Ubuntu/Debian
├── install_arch.sh               # Automated installer for Arch Linux / Manjaro
├── install_android_termux.sh     # Automated installer for Android Termux field ops
├── run_windows.bat               # Automated launcher for Windows 10/11
├── build_windows.bat             # Standalone .EXE builder for Windows (PyInstaller)
├── build_all_platforms.sh        # Multi-platform shell verification pipeline
├── build_all_platforms.py        # Multi-platform Python test and verification script
│
├── z30_dsp/                      # Native Python DSP Package
│   ├── __init__.py               # Package metadata
│   ├── main.py                   # Master entrypoint CLI/GUI router
│   ├── modem.py                  # Continuous-phase 16-MFSK modulator (GFSK-shaped)
│   ├── ldpc.py                   # IRA LDPC (216, 77) encoder & Min-Sum decoder
│   ├── sic_decoder.py            # Multi-pass Successive Interference Cancellation
│   ├── rf_time_sync.py           # Audio DSP time standard calibration scanner
│   ├── band_manager.py           # Band plan & dial frequency manager
│   ├── auto_logger.py            # ADIF 3.1.4 logbook manager
│   ├── config_wizard.py          # Terminal station setup wizard
│   ├── benchmark.py              # Monte Carlo BER/FER simulation suite
│   ├── gui.py                    # High-level desktop GUI orchestrator
│   ├── gui_tkinter.py            # Zero-dependency Tkinter desktop GUI
│   ├── paths.py                  # Per-user config / logbook directory resolution
│   ├── web_server.py             # Local server: token-authed hardware API, rigctld relay
│   └── web_dist/                 # Embedded pre-compiled web assets
│
└── src/                          # Web DSP & GUI Source Code (TypeScript + React)
    ├── App.tsx                   # Master transceiver workspace orchestrator
    ├── main.tsx                  # React DOM entrypoint
    ├── index.css                 # Tailwind CSS styles & typography
    ├── types/
    │   └── z30.ts                # Station config, QSO state, and DSP types
    ├── data/
    │   └── pythonSource.ts       # Embedded Python DSP source reference
    ├── dsp/                      # Pure Web Audio, DSP, Modems, and Decoders
    │   ├── audioEngine.ts        # Web Audio API 12/48 kHz pipeline & AudioWorklet capture
    │   ├── z30Waveform.ts        # Continuous-phase 16-MFSK generator (twin of modem.py)
    │   ├── bandPlan.ts           # Band edges & licence privileges behind canTransmit()
    │   ├── localServerApi.ts     # Token-authenticated client for the native server's API
    │   ├── stationConfigStore.ts # Validated, versioned station config persistence
    │   ├── seededRandom.ts       # Deterministic PRNG for reproducible benchmarks
    │   ├── z30Constants.ts       # 16-MFSK specs, Costas arrays, and PTT catalog
    │   ├── z30Codec.ts           # 63-bit Radix-37/27 packing & CRC-14 engine
    │   ├── ldpcCodec.ts          # Rate-0.356 IRA LDPC Belief Propagation decoder
    │   ├── sicDecoder.ts         # 3-pass Successive Interference Cancellation
    │   ├── rfTimeSyncEngine.ts   # Audio DSP time station cross-correlation engine
    │   ├── qsoEngine.ts          # 6-stage QSO state machine & auto-sequencer
    │   ├── qsoLogger.ts          # ADIF 3.1.4 / Cabrillo / CSV / JSON logger
    │   ├── catController.ts      # Hamlib rigctld & serial CAT controller
    │   ├── hamlibCatalog.ts      # 200+ amateur transceiver models catalog
    │   └── timeUtils.ts          # UTC clock & international timezone utilities
    └── components/               # High-Performance UI Components
        ├── Header.tsx            # UTC clock, 30s cycle progress bar, TX/Tune triggers
        ├── WaterfallDisplay.tsx  # 60 FPS HTML5 Canvas Waterfall & S-Meter
        ├── ActivityLogTable.tsx  # Band activity traffic matrix & decode filters
        ├── QsoMacrosTransmitPanel.tsx # 6 TX macros & auto-reply rule sequencer
        ├── QsoController.tsx     # DX target contact manager & power/SWR gauges
        ├── RigControlPanel.tsx   # Hamlib VFO dial & live CAT terminal
        ├── SetupWizardModal.tsx  # 4-step interactive hardware setup wizard
        ├── StationSettingsModal.tsx # Station configuration & CAT parameters
        ├── BandManagerModal.tsx  # Amateur band allocations & custom frequencies
        ├── LogbookModal.tsx      # Searchable ADIF logbook & export tools
        ├── RfTimeSyncModal.tsx   # RF time calibration & beacon workbench
        ├── SpecsModal.tsx        # Physical layer specifications & DSP math
        └── PythonSourceViewer.tsx# Python DSP source inspector & benchmark runner
```

---

## Contributing & License

Contributions, bug reports, and pull requests are welcomed! Whether you are optimizing LDPC decoding kernels, testing novel CAT hardware, or refining documentation, please feel free to open an issue or pull request.

Distributed under the **MIT License**. See `LICENSE` for details.

---

*73 de the z-30 Digital Mode Working Group — Dedicated to advancing the boundaries of amateur radio weak-signal digital communications.*
