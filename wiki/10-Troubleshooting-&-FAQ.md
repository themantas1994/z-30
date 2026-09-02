# 10. Troubleshooting & FAQ

This document addresses common questions, operating issues, hardware setup challenges, and error recovery steps for **z-30**.

---

## ❓ Frequently Asked Questions (FAQ)

### Q1: Why does z-30 use a 30-second cycle instead of 15 seconds like FT8?
**A**: Doubling the cycle to 30.0 seconds and halving the symbol rate from 6.25 to 3.125 baud doubles the energy per symbol, and a rate-0.356 code over 75 symbols spends considerably more redundancy per information bit than FT8's rate-0.52 (174, 91). Both buy coding gain.

z-30's benchmark measures the on-air case directly: with random carrier and timing offsets, blind acquisition and non-coherent demodulation, 50% decode is at **-22.9 dB SNR** on AWGN and **-21.4 dB** on the ITU-R F.1487 mid-latitude moderate path (seed 20260830, 200 frames per point). FT8's published -21 dB is measured the same way, so **z-30 decodes about 1.9 dB deeper than FT8 on AWGN** - but it transmits for 24.0 s against FT8's 12.64 s (2.8 dB more energy) and carries 14 fewer message bits, so it buys that depth with airtime rather than with a better code. **And on a fast-fading path it loses outright:** on ITU-R F.1487 high-latitude moderate (3 ms / 10 Hz) z-30 decodes essentially nothing at any signal level, because 10 Hz of Doppler spread is wider than its whole 3.125 Hz tone spacing. If you are working polar paths or an active aurora, that is the number that matters, not the AWGN one. The genie-aided bound is -24.58 dB; comparing that with anyone's on-air figure is invalid. Earlier revisions of this page claimed "+4.0 dB over FT8" on exactly that invalid comparison, and it stays withdrawn - the 1.9 dB above is blind-acquisition on both sides.

### Q2: Why is the occupied bandwidth only 50 Hz?
**A**: 16 orthogonal tones spaced at $3.125\text{ Hz}$ occupy exactly $16 \times 3.125 = 50.0\text{ Hz}$. This allows up to **50 simultaneous contacts** inside a standard 2.7 kHz SSB transceiver passband without mutual interference.

### Q3: What does the purple "SIC 2" or "SIC 3" badge mean in my decodes?
**A**: This indicates that the message was recovered through **Successive Interference Cancellation**. A stronger local station was initially masking the signal; z-30 synthesized and subtracted the strong carrier waveform in Pass 1, unmasking this weaker DX contact in Pass 2 or Pass 3.

---

## 🛠️ Common Issues & Solutions

### 1. No Decodes on the Waterfall (Audio RX Troubleshooting)
- **Check Audio Level**: Ensure the background noise floor on the waterfall is visible (dark blue with speckles) and that the VU meter registers between 30% and 60%.
- **Check Mode**: Ensure your transceiver is set to **`USB`** (Upper Sideband) or **`USB-D` / `PKT-USB` (Data mode)**. Never use LSB on digital modes.
- **Check Filter Bandwidth**: Open your radio's IF filter to maximum width (e.g., $3.0\text{ kHz}$ or $3.6\text{ kHz}$) so the entire audio waterfall is received.
- **Microphone Permissions**: In browser/PWA mode, ensure microphone permission is granted in browser site settings.

### 2. High ALC / Distorted TX Audio (Transmitter Overdriving)
- **Symptom**: Radio ALC meter is pegged in the red zone; other stations report distorted or wide tones.
- **Solution**: Lower your computer or USB soundcard output volume until the radio's ALC meter shows **zero deflection** or 1 bar maximum. Digital 16-MFSK requires a pure linear amplification chain.

### 3. CAT Serial Port Permission Denied on Linux (`/dev/ttyUSB0`)
- **Symptom**: `PermissionError: [Errno 13] Permission denied: '/dev/ttyUSB0'`
- **Solution**: Add your user to the `dialout` (Ubuntu/Debian) or `uucp` (Arch Linux) group:
  ```bash
  # On Ubuntu / Debian:
  sudo usermod -a -G dialout $USER

  # On Arch Linux / Manjaro:
  sudo usermod -a -G uucp $USER

  # Log out and log back in for changes to take effect!
  ```

### 4. Transceiver Does Not Key into Transmit (PTT Issues)

**Read the rig control log first.** Every keying attempt writes a line there, and a command that
could not be sent is recorded as an `ERROR` naming the missing piece — no port open, no protocol
for this rig, `rigctld` refused, HID device not paired. A refused transmission also appears in the
transmit banner, and no audio is generated when keying fails.

- **CAT Mode**: Verify baud rate matches the radio menu setting. Check that the radio is in `Data Mode` (e.g., `USB-D`).
- **CAT Mode, Yaesu, Direct Serial**: only the FT-991/991A, FTDX10, FTDX101, FT-710 and FT-891 are
  driven directly. Any other Yaesu — the FT-817/857/897 included — needs `rigctld`; z-30 refuses
  rather than sending a command set it cannot verify for your model.
- **CAT Mode, "Hamlib"**: `rigctld` is only reachable when z-30 runs through its native server
  (`z30-web`). From a plain page there is no relay and CAT keying will refuse.
- **`rigctld` answers `RPRT -1`**: the daemon is running but refused the command. A daemon started
  with `-P NONE` has no PTT to key — restart it with the right `-P` for your interface.
- **Digirig / RTS Mode**: Ensure PTT Method is set to **`RTS`** on the proper COM/tty port. If the
  keying line is on a *second* cable, pair it with **Pair PTT Port** in Station Settings → PTT;
  otherwise keying goes to the CAT port.
- **Polarity**: if the radio transmits while receiving and stays silent while transmitting, the
  `ACTIVE_HIGH` / `ACTIVE_LOW` setting is inverted for your interface.
- **SignaLink USB Mode**: If using Right-Channel audio tone, ensure PTT method is set to **`Audio Tone (Right Channel)`** and soundcard balance is centered.
- **`z30 --tkinter`**: that window is receive-only — it has no modulator and no keying. Transmit
  from the web transceiver (`z30-web`).

### 5. High Time Offset ($\Delta t > 1.5\text{ s}$)
- **Symptom**: Transmissions start late; decodes show high $\Delta t$.
- **Solution**:
  - If internet is available: Synchronize Windows/Linux clock via NTP.
  - If offline: Click **`SYNC TIME`** in the z-30 header, tune to WWV/CHU/DCF77, and click **Calibrate** to apply zero-admin DSP clock calibration.
