# 14. User Interface & Operation Reference

A reference for every control surface in the z-30 workspace: what it does, where it lives in
the source, and what it changes on the air. If you are setting a station up for the first time,
start at [01. New User Guide & First Steps](01-New-User-Guide-&-First-Steps.md) instead — this
page is the reference you come back to.

---

## 🌊 60 FPS Spectral Waterfall & Spectrogram

`src/components/WaterfallDisplay.tsx`

The primary canvas delivers continuous, non-blocking 60 FPS spectral analysis:

- **Colormaps**: 10 scientific palettes — `Turbo`, `Inferno`, `Viridis`, `Plasma`, `Magma`,
  `WSJT-X Classic`, `Night Vision Green`, `Amber CRT`, `High-Contrast B&W`, `Spectral Heatmap`.
- **Passband presets**: `200–3000 Hz (Standard)`, `500–2000 Hz (Narrow)`,
  `800–1800 Hz (Digital Focus)`, `100–3500 Hz (Wide)`, `0–4000 Hz (Extended)`.
- **Trace visibility boost**: a 3-level contrast multiplier (`1x`, `1.6x`, `2.2x`) that lifts
  weak 16-MFSK tone tracks down to about $-25.0\text{ dB}$ out of the background.
- **Interactive tuning**:
  - **Single click** — set the audio RX centre frequency.
  - **Shift + click** — set the audio TX centre frequency.
  - **Double click on a carrier** — arm the transmitter (`txEnabled = true`) and prepare the
    sequencing macro that calls that station on the upcoming cycle.
  - **Mouse wheel** — smooth zoom ($1\times$ to $8\times$), with drag-to-pan inspection.

Remember that the frequency you radiate is the dial frequency **plus** this audio offset. That
sum is what the transmit gate checks against the band plan — see
[13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md).

---

## 🔁 QSO State Machine & Auto-Sequencing

`src/dsp/qsoEngine.ts`, `src/components/QsoMacrosTransmitPanel.tsx`

z-30 automates standard amateur contact exchanges via a 6-stage finite state machine:

| Macro | Description | Transmitted payload example |
| :--- | :--- | :--- |
| **TX 1** | Directed or general CQ call | `CQ W1AW FN31` |
| **TX 2** | Signal report response | `W1AW K1ABC -12` |
| **TX 3** | Signal report acknowledgment | `K1ABC W1AW R-08` |
| **TX 4** | Mutual confirmation (RRR / RR73) | `W1AW K1ABC RR73` |
| **TX 5** | Final 73 sign-off | `K1ABC W1AW 73` |
| **TX 6** | Free text / special grid | `CQ DX W1AW FN31` |

- **Auto-sequence** advances through the macros on each valid CRC-verified reply.
- **Auto-log** commits the contact on RR73/73 and exports ADIF (`.adi`) accepted by LoTW, QRZ,
  ClubLog and eQSL.
- **Watchdog safety** disarms the transmitter after a configurable number of unanswered cycles
  (1 to 10), so an unattended station cannot call CQ indefinitely.

---

## 🎯 Auto-Reply Priority Strategies

When several stations answer your CQ inside the same 30-second slot, z-30 sorts the callers and
picks one according to the configured rule:

1. **First decoded (chrono)** — the first caller decoded in the slot (WSJT-X "Call 1st" behaviour).
2. **Last decoded** — the last caller decoded in the cycle.
3. **Strongest signal (max SNR)** — the loudest station first (e.g. $-4\text{ dB}$ before $-24\text{ dB}$).
4. **Weakest signal (deep DX)** — stations closest to the LDPC threshold first (e.g. $-24.5\text{ dB}$ before $-6\text{ dB}$).
5. **Nearest station (min distance)** — smallest Maidenhead great-circle distance.
6. **Farthest DX (max distance)** — greatest Maidenhead great-circle distance.

---

## 🎛️ CAT Rig Control & S-Meter Integration

`src/dsp/catController.ts`, `src/dsp/hamlibCatalog.ts`, `src/components/RigControlPanel.tsx`

- Bidirectional serial communication over Hamlib `rigctld` (default port `4532`) or native
  serial ports (`COM1..COM32`, `/dev/ttyUSB*`, `/dev/ttyACM*`).
- Reads VFO dial frequency, operating mode (`USB` / `PKTUSB`) and live hardware S-meter power
  in dBm.
- A live CAT terminal for raw Hamlib commands (`\get_freq`, `\set_freq`, `\get_mode`,
  `\set_ptt`, `\get_level`).
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
| 1 | **CAT command** (`\set_ptt 1` over USB/serial or the Hamlib TCP daemon) | Icom IC-7300/705/7610, Yaesu FT-991A/710/891, Kenwood TS-590SG, Elecraft K3/K4, Xiegu G90/X6100 |
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

`src/components/SetupWizardModal.tsx` (terminal equivalent: `z30 --wizard`)

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

`src/dsp/bandPlan.ts`, `src/components/BandManagerModal.tsx` (terminal equivalent: `z30 --bands`)

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

`src/dsp/qsoLogger.ts`, `src/components/LogbookModal.tsx`, `z30_dsp/auto_logger.py`

- Tabular logbook recording date, UTC time, callsign, band, dial frequency, mode (`Z-30`),
  sent/received reports, Maidenhead grid, distance (km/mi) and operator notes.
- One-click export to **ADIF 3.1.4 (`.adi`)**, **Cabrillo**, **JSON** and **CSV**.
- Search and filter by callsign, band or date range.
- The authoritative copy is the file on disk (`~/.z30/logbook.json` plus an ADIF export beside
  it); the browser store is a cache. See
  [13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md).
