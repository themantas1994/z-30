# 10. Troubleshooting & FAQ

This document addresses common questions, operating issues, hardware setup challenges, and error recovery steps for **z-30**.

---

## ❓ Frequently Asked Questions (FAQ)

### Q1: Why does z-30 use a 30-second cycle instead of 15 seconds like FT8?
**A**: Doubling the cycle to 30.0 seconds and halving the symbol rate from 6.25 to 3.125 baud doubles the energy per symbol, and a rate-0.356 code over 75 symbols spends considerably more redundancy per information bit than FT8's rate-0.52 (174, 91). Both buy coding gain.

z-30's benchmark measures the on-air case directly: with random carrier and timing offsets, blind acquisition and non-coherent demodulation, 50% decode is at **-23.1 dB SNR** on AWGN and **-21.3 dB** on a CCIR-moderate path. FT8's published -21 dB is measured the same way, so **z-30 decodes about 2.1 dB deeper than FT8 on AWGN** - but it transmits for 24.0 s against FT8's 12.64 s (2.8 dB more energy) and carries 14 fewer message bits, so it buys that depth with airtime rather than with a better code. The genie-aided bound is -24.6 dB; comparing that with anyone's on-air figure is invalid. Earlier revisions of this page claimed "+4.0 dB over FT8" on exactly that invalid comparison, and it stays withdrawn - the 2.1 dB above is blind-acquisition on both sides.

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
- **CAT Mode**: Verify baud rate matches the radio menu setting. Check that the radio is in `Data Mode` (e.g., `USB-D`).
- **Digirig / RTS Mode**: Ensure PTT Method is set to **`RTS`** on the proper COM/tty port.
- **SignaLink USB Mode**: If using Right-Channel audio tone, ensure PTT method is set to **`Audio Tone (Right Channel)`** and soundcard balance is centered.

### 5. High Time Offset ($\Delta t > 1.5\text{ s}$)
- **Symptom**: Transmissions start late; decodes show high $\Delta t$.
- **Solution**:
  - If internet is available: Synchronize Windows/Linux clock via NTP.
  - If offline: Click **`SYNC TIME`** in the z-30 header, tune to WWV/CHU/DCF77, and click **Calibrate** to apply zero-admin DSP clock calibration.
