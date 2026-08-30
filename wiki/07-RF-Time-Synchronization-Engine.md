# 07. RF Time Synchronization Engine

Synchronous digital modes like z-30 rely on strict **30-second UTC slot alignment**. When operating in remote field locations (such as SOTA, POTA, maritime mobile, or emergency disaster response) without internet NTP or GPS time receivers, system clocks drift quickly.

**z-30** includes an embedded DSP tool (`z30_dsp/rf_time_sync.py` and the in-app **`SYNC TIME`** workbench) that synchronizes the clock directly against international HF and LF time standard stations over the air.

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

```
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
```

---

## 🎛️ Using RF Time Sync in the Application

### 1. In the Web / PWA Interface:
1. Click the **`SYNC TIME`** button in the header (or in the Setup Wizard / Settings).
2. Choose your preferred standard station (e.g., **WWV 10.000 MHz** or **CHU 7.850 MHz**).
3. Tune your receiver dial to the frequency in **USB** mode.
4. Click **"Calibrate Time Offset"**.
5. Watch the live correlation peak curve. Once locked, click **"Apply Offset to Station"**. z-30's own slot timing adjusts immediately, without root or administrative permissions - the machine's system clock is left alone unless you have explicitly opted in (see the note below).

### 2. From the Python CLI:
```bash
# Run the automated RF time calibration scanner
z30-sync

# or via the unified z30 CLI:
z30 --sync
```

> **The system clock is not touched by default.** A time station is an unauthenticated
> broadcast: anyone can transmit a WWV-shaped signal, and a marginal decode can produce a wrong
> timestamp with no adversary at all. z-30 therefore applies the correction internally as
> `app_time_offset_ms`, which is all the decoder needs, and never steps the machine's clock
> unless you explicitly opt in - by setting `"allow_set_system_clock": true` in
> `~/.z30/config.json` or exporting `Z30_ALLOW_SET_SYSTEM_CLOCK=1`. Even then, a proposed step
> of more than 5 minutes is refused as a misdecode or a spoof, and z-30 declines to fight an
> NTP daemon that already owns the clock.

Output example:
```
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
```
