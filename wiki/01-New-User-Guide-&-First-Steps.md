# 01. New User Guide & First Steps

Welcome to **z-30**! This guide is designed to take you from a fresh installation to completing your first 30-second weak-signal contact on the air.

---

## 📋 Prerequisites & Station Requirements

To operate z-30 on HF/VHF bands, you need:
1. **Amateur Radio Transceiver**: An SSB transceiver (HF 160m–10m, VHF 6m/2m, or UHF 70cm).
2. **Audio Interface**:
   - Built-in USB soundcard (e.g., Icom IC-7300/705, Yaesu FT-991A/FT-710, Kenwood TS-590SG, Xiegu G90/X6100).
   - External audio interface (e.g., Digirig Mobile, SignaLink USB, microHAM, DRA-30/50, or CM108/CM119 USB interface).
   - Line-In / Line-Out jacks on your PC or smartphone.
3. **Accurate Clock**: Digital modes require your system clock to be synchronized within $\pm 1.0\text{ s}$ of UTC. (z-30 includes a built-in RF Time Sync tool if internet NTP is unavailable).
4. **Resonant or Tuned Antenna**: A matched antenna system (SWR $< 1.5:1$).

---

## 🛠️ Step 1: Initial Setup Wizard

When you launch z-30 for the first time (or click the **`Wizard`** button in the top navigation bar), the 4-step setup wizard will guide you through configuration:

### Step 1.1: Station Identity
- **Callsign**: Enter your legal amateur radio callsign (e.g., `W1AW`, `G4ABC`, `DL1XYZ`).
- **Maidenhead Grid Locator**: Enter your 4 or 6-character grid locator (e.g., `FN31`, `JO21xx`). Click **"Use Geolocation"** if using a GPS-equipped device to auto-fill your grid.
- **Operator Name & QTH**: (Optional) Friendly info used for logging.
- **Timezone**: Select your local timezone or keep default UTC.

### Step 1.2: Audio Soundcard I/O
- **Input Device (RX)**: Select the soundcard receiving audio from your radio (e.g., `USB Audio CODEC`, `Microphone (Digirig)`).
- **Output Device (TX)**: Select the soundcard routing audio to your radio transmitter.
- **Audio Levels**: Watch the live VU meter while listening to the radio. Adjust your radio RF Gain or PC input volume so background band noise rests around **30% to 50%** on the green scale.

### Step 1.3: Rig Control (Hamlib CAT)
- **Model**: Select your transceiver from the searchable catalog of 200+ rigs.
- **Connection Type**: Choose `Hamlib rigctld` (default port `4532`) or `Direct Serial`.
- **Serial Port & Baud Rate**: E.g., `COM3` on Windows or `/dev/ttyUSB0` on Linux, matching your radio's internal menu baud rate (e.g., `19200` or `38400`).

### Step 1.4: PTT Keying Method
Select how your station keys the transmitter:
- **`CAT Command`**: Sends digital keying commands through the serial/USB cable.
- **`RTS Line` / `DTR Line`**: Hardware pin toggling used by Digirig, Rigblaster, and microHAM.
- **`Audio Tone (Right Channel)`**: Plays an inaudible 1000/1500 Hz tone on the right audio channel to trigger an auto-VOX interface (e.g., SignaLink USB, HT cables, phones).
- **`CM108/CM119 GPIO`**: Drives GPIO pin 3/4 on dedicated radio soundcards (DRA-30/50).
- **`Raspberry Pi GPIO`**: Uses BCM pin 17/27 for field SBC setups.

Click **"Test PTT"** to verify that your radio keys into transmit and returns to receive cleanly.

---

## ⏱️ Step 2: UTC Time Synchronization

z-30 transmissions synchronize to exact **30.0-second UTC slots**:
- **Even Slot**: Transmissions start at `:00` and `:30` of each UTC minute.
- **Active TX Window**: $24.0\text{ s}$ duration.
- **Decode Window**: $24.0\text{ s}$ to $30.0\text{ s}$.

### If you have internet access:
Your operating system's NTP client will keep your clock in sync automatically.

### If you are in the field (SOTA / POTA / Offline):
1. Click the **`SYNC TIME`** button in the header.
2. Tune your radio to a standard time broadcast station (**WWV** at 5/10/15 MHz, **CHU** at 3.33/7.85/14.67 MHz, **DCF77** at 77.5 kHz, etc.).
3. The built-in DSP receiver will demodulate the audio subcarrier pulses, calculate the exact millisecond offset $\Delta t$, and apply an application-level offset without requiring administrator privileges.

---

## 📻 Step 3: Setting Audio Levels & Waterfall Tuning

1. **Select a Band**: Click the band selector dropdown (e.g., **20m** - `14.076 MHz`).
2. **Audio RX Level**: Ensure the waterfall shows a dark blue/purple background with distinct signal tracks in yellow/green/cyan.
3. **Audio TX Level / ALC**:
   - In digital modes, **never overdrive your radio into heavy ALC compression**.
   - Set your PC audio output volume so that your transceiver indicates **zero ALC** or minimal deflection (1-2 bars max).
   - Digital 16-MFSK requires a linear RF amplifier stage. Excessive audio level causes intermodulation distortion (splatter) and reduces decode reliability.

---

## 🎯 Step 4: Making Your First QSO

### Scenario A: Calling CQ (You start the contact)
1. **Find a Clear Frequency**: Look at the waterfall and select an open 50 Hz slot. Click on the waterfall to set your RX and TX audio center frequencies (e.g., `1500 Hz`).
2. **Select Transmit Slot**: Choose **`EVEN`** or **`ODD`**.
3. **Select Macro TX 1**: The message will display `CQ <MYCALL> <MYGRID>` (e.g., `CQ W1AW FN31`).
4. **Click `Start TX`**: The station will arm and automatically key the transmitter at the start of the next 30-second slot.
5. **Auto-Sequencing**:
   - When a distant station responds (e.g., `W1AW K1ABC -12`), z-30 will automatically advance to **TX 3** (`K1ABC W1AW R-08`).
   - When the station confirms with **RR73** or **RRR**, z-30 transmits **TX 5** (`K1ABC W1AW 73`) and automatically commits the QSO to your logbook!

### Scenario B: Answering Another Station's CQ
1. **Monitor Activity**: Watch the **Activity Log** or the **Waterfall**.
2. **Double-Click a CQ Message**: Double-clicking any decoded CQ in the Activity table or waterfall will:
   - Tune your RX and TX frequencies to the calling station.
   - Switch your transmit slot to the opposite slot (if they called on `EVEN`, you transmit on `ODD`).
   - Arm macro **TX 2** (`<THEIRCALL> <MYCALL> <MYGRID>`).
   - Automatically begin transmitting when the slot starts.

---

## 📖 Step 5: Logbook & ADIF Export

- Click **`Logbook`** in the header to view all logged contacts with calculated great-circle distance (km/miles) and beam headings (azimuth).
- Click **`Export ADIF`** to download a standard `.adi` file ready for upload to:
  - **ARRL Logbook of The World (LoTW)**
  - **QRZ.com**
  - **ClubLog**
  - **eQSL.cc**
- You can also export to **Cabrillo** (for contests), **CSV**, or **JSON**.
