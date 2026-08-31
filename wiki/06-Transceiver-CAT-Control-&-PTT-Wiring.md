# 06. Transceiver CAT Control & PTT Wiring

z-30 provides complete, hardware-agnostic transceiver control via **Hamlib (`rigctld`)**, direct serial communication, and 9 distinct Push-To-Talk (PTT) keying architectures.

---

## 🎛️ Hamlib `rigctld` Daemon Architecture

Hamlib allows z-30 to communicate with over 200+ amateur radio transceivers over a standard TCP network socket (default port: `4532`).

### Starting `rigctld` Manually:
```bash
# Example: Icom IC-7300 (Model 3073) on /dev/ttyUSB0 at 19200 baud
rigctld -m 3073 -r /dev/ttyUSB0 -s 19200 -T 127.0.0.1 -t 4532

# Example: Yaesu FT-991A (Model 1035) on COM4 at 38400 baud (Windows)
rigctld -m 1035 -r COM4 -s 38400

# Example: Elecraft K3/K4 (Model 2029) on /dev/ttyUSB0 at 38400 baud
rigctld -m 2029 -r /dev/ttyUSB0 -s 38400
```

---

---

## 🔌 Which transport carries your CAT commands

The **CAT Method** you choose in Station Settings decides this, and nothing else does:

| CAT Method | Frequency, mode and CAT keying go to |
| :--- | :--- |
| `Hamlib` | The `rigctld` daemon, through the native server's TCP relay (`/api/rigctl`) |
| `Direct Serial` | The paired Web Serial port, as that rig family's own native protocol |
| `None` | Nowhere — VOX or hardware keying only, and you tune the radio yourself |

Two consequences worth knowing:

- **Hamlib mode needs the native server.** A browser cannot open a TCP socket to a daemon, so
  `rigctld` is only reachable when z-30 is launched through `z30-web`. Opened as a plain page,
  Hamlib mode has nowhere to send a command, and the app now refuses and says so rather than
  reporting a set that never left the browser.
- **Pairing a serial port no longer changes your CAT transport.** It used to: pairing a port
  for RTS keying silently moved CAT off the daemon and onto raw bytes written to that port —
  a port `rigctld` already had open.

**A CAT command that could not be sent is reported as a failure** — in the rig log, in the raw
console's `RPRT` reply, and in the transmit banner. Nothing answers "OK" for a command the radio
never received.

### Direct Serial protocol coverage

`Direct Serial` speaks each family's real protocol, and only where that protocol is known:

| Rigs | Protocol | PTT command |
| :--- | :--- | :--- |
| Icom, Xiegu | CI-V (`FE FE <addr> E0 …`) | `1C 00 01` / `1C 00 00` |
| Kenwood, Elecraft | Kenwood ASCII, 11-digit `FA` | `TX;` / `RX;` |
| Yaesu FT-991/991A, FTDX10, FTDX101, FT-710, FT-891 | Yaesu new-CAT ASCII, **9-digit** `FA`, `MD0x;` | **`TX1;` / `TX0;`** |
| Everything else — including FT-817/857/897 and the 1990s Yaesu rigs | *not implemented* | use `rigctld` |

Yaesu is **not** Kenwood, despite the family resemblance: `TX;` is Yaesu's PTT *read* command and
keys nothing, there is no `RX;` in the Yaesu set, and `FA` takes nine digits rather than eleven.
z-30 sent the Kenwood forms to every Yaesu rig until this was fixed, which meant a Yaesu station
passed its CAT test and then never keyed.

For any rig outside that table, `Direct Serial` refuses and names `rigctld` instead of guessing a
command set. Hamlib carries per-model command tables; this app does not duplicate them.

**A Direct Serial CAT test confirms the write, not the radio's answer.** There is no serial read
loop in `catController.ts` — the reader handle is only ever cancelled, never assigned — so in
`Direct Serial` mode a passing "Test CAT Connection" means the bytes left the port, not that the
rig understood them. Reading replies means a per-rig response parser for every family, which is
what `rigctld` already is; Hamlib mode therefore verifies the rig's actual reply and Direct Serial
mode does not. If you need a CAT link proven end to end, test it in Hamlib mode.

---

## ⚡ 9 Supported PTT Keying Architectures

### 1. CAT Software Command (`CAT`)
- **How it works**: Sends the rig family's own PTT command (see the table above) over the serial
  link, or `T 1` / `T 0` to `rigctld` in Hamlib mode.
- **Best for**: Radios with built-in USB interfaces (Icom IC-7300, IC-705, Yaesu FT-710, FT-991A, Kenwood TS-590SG, Elecraft K4, Xiegu G90/X6100).
- **Pros**: Zero extra cables or hardware required.
- **Reports failure**: if no protocol is configured for your rig, no port is open, or `rigctld`
  refuses the command, keying fails visibly and no audio is transmitted.

### 2. RTS Hardware Serial Line (`RTS`)
- **How it works**: Toggles the Request To Send (RTS) pin on an RS-232 or USB-to-UART bridge (CP2102, FTDI FT232, CH340).
- **Best for**: **Digirig Mobile**, **Rigblaster**, **microHAM**, and homebrew optocoupler interfaces.
- **Wiring Pinout**:
  ```
  PC USB/Serial Port RTS (Pin 7 on DB9) ──[ 1kΩ Resistor ]── Base of 2N2222 / 2N3904 (or Optocoupler Pin 1)
  PC Ground (Pin 5 on DB9) ──────────────────────────────── Emitter (or Optocoupler Pin 2)
  Radio PTT Line ────────────────────────────────────────── Collector (or Optocoupler Pin 4)
  Radio Ground ──────────────────────────────────────────── Emitter Ground (or Optocoupler Pin 3)
  ```

### 3. DTR Hardware Serial Line (`DTR`)
- **How it works**: Toggles the Data Terminal Ready (DTR) line (Pin 4 on DB9).
- **Best for**: Legacy interfaces, dual-channel CW/PTT keyers, or interfaces using DTR for PTT and RTS for CW keying.

#### If PTT is on a different cable from CAT

`RTS`, `DTR` and `WINKEYER` key the **CAT port** by default, which is what a single-cable station
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

`ACTIVE_LOW` inverts what is driven, on **RTS, DTR, CM108/CM119 and Raspberry Pi GPIO alike**.
CM108 keying used to ignore the setting entirely, so an active-low DRA or URI interface was driven
backwards — no carrier while transmitting, PTT asserted while receiving — while the wiring test
printed "Active Low" and reported a pass.

### 4. Right-Channel Audio PTT Tone (`AUDIO_TONE_RIGHT`)
- **How it works**: Modulates the Left stereo channel with the 16-MFSK data audio while outputting a continuous 1000 Hz or 1500 Hz sinusoidal tone on the Right stereo channel during transmission.
- **Best for**: **SignaLink USB** (in tone-trigger mode), handheld transceivers (Baofeng, Anytone, Yaesu FT-65 via phone audio jacks), and field smartphone/tablet operations.
- **Hardware Circuit**: The right audio channel is rectified using a Schottky diode bridge ($1\text{N}5711$), smoothed with a $10\,\mu\text{F}$ capacitor, and drives a switching transistor or VOX circuit.

### 5. C-Media CM108 / CM119 USB GPIO (`CM108_GPIO`)
- **How it works**: Sends raw USB HID feature reports to toggle GPIO3 (Pin 13) or GPIO4 (Pin 14) directly inside C-Media USB soundcard chips without needing a serial UART port.
- **Best for**: Masters Communications **DRA-30 / DRA-50 / DRA-70**, Repeater-Builder RIM boards, URIxB interfaces.
- **Wiring**: GPIO3 is pulled high (Active High) or low (Active Low) to drive the PTT MOSFET.

### 6. Raspberry Pi / Linux SBC Direct GPIO (`RASPBERRY_PI_GPIO`)
- **How it works**: Toggles Linux sysfs/libgpiod pins directly on Raspberry Pi (3B, 4B, 5, Zero 2W, Orange Pi).
- **Default Pin**: BCM Pin 17 (Physical Pin 11) or BCM Pin 27 (Physical Pin 13).
- **Circuit**: Pi GPIO Pin $\to 1\text{k}\Omega \to$ Gate of 2N7000 MOSFET $\to$ Radio PTT line.

### 7. Voice-Operated Transmit (`VOX`)
- **How it works**: Transmits audio directly and relies on the transceiver internal VOX or SignaLink Auto-VOX circuit to trip PTT.
- **Note**: Ensure transceiver VOX Anti-Trip and Delay settings are adjusted to prevent premature dropout.

### 8. TCI Network Protocol (`TCI_NETWORK`)
- **How it works**: High-speed bidirectional WebSocket network protocol for modern Software Defined Radios (Expert Electronics SunSDR2 PRO, SunSDR2 DX, MB1).
- **Default Port**: `40001` or `50001`. Supports zero-latency frequency, mode, S-meter, and PTT streaming.

### 9. K1EL WinKeyer 2/3 (`WINKEYER`)
- **How it works**: Communicates with K1EL WK2/WK3 ICs over serial to execute timed hardware PTT assertion with configurable lead-in ($20\text{ ms}$) and tail hangover ($30\text{ ms}$) delays.
