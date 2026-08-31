# 09. Cross-Platform Build & Packaging

This document provides packaging and build instructions for deploying **z-30** across **Ubuntu/Debian**, **Arch Linux**, **Windows 10/11**, **Android (Termux & PWA)**, **Raspberry Pi (DigiPi)**, and **PyPI / Universal Wheel** packages.

---

## 🐧 1. Ubuntu & Debian (20.04 / 22.04 / 24.04 / Mint / Pop!_OS)

### Automated Setup Script:
```bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_ubuntu.sh
./install_ubuntu.sh
```

The script:
1. Installs system packages via `apt-get` (`libportaudio2`, `libhamlib-utils`, `python3-venv`, `nodejs`, `npm`).
2. Creates an isolated virtual environment at `~/.z30-env`.
3. Compiles the web GUI into embedded distribution files.
4. Generates a desktop launcher in `~/.local/share/applications/z30.desktop`.

---

## 🏹 2. Arch Linux, Manjaro, EndeavourOS & CachyOS

### Method A: Automated Script (`install_arch.sh`)
```bash
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_arch.sh
./install_arch.sh
```

### Method B: Native Arch Package (`PKGBUILD` + `makepkg`)
```bash
# Build and install package via pacman:
makepkg -si
```

---

## 🪟 3. Windows 10 & 11 (64-Bit)

### Option A: One-Click Batch Launcher
1. Install Python 3.9+ from [python.org](https://www.python.org/) with **"Add python.exe to PATH"** checked.
2. Clone or download the repository.
3. Double-click `run_windows.bat`.

### Option B: PyInstaller Standalone `.EXE` Build
To build a standalone executable without requiring Python on client computers:
```cmd
build_windows.bat
```
Output executable: `dist\z30-transceiver\z30-transceiver.exe`

---

## 🤖 4. Android (PWA & Termux Field Operations)

**Mode A is the only Android mode that carries live audio.** Mode B gives you the Python CLI and
the DSP tools, not a transceiver — see the limitation below before planning a portable station
around it.

### Mode A: Progressive Web App (Instant Install)
1. Open the z-30 URL in **Chrome** or **Brave** on your Android tablet or smartphone. The address
   must be **`https://`**, or **`http://localhost`** / **`http://127.0.0.1`** when the server runs
   on the same device.
2. Tap `(⋮)` $\to$ **"Install app"** or **"Add to Home screen"**.
3. Runs in standalone fullscreen, taking receive audio from the browser via `getUserMedia`.

> **A plain `http://` LAN address does not work**, and it fails quietly. Pointing the phone at a
> PC's local IP (`http://192.168.x.x:3000`, the Vite dev server) is not a
> [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), so
> Chrome offers no install prompt, the service worker registration in `src/main.tsx` is rejected,
> and `getUserMedia()` never grants the microphone. The app loads and then cannot hear anything,
> which looks like a broken decoder rather than a URL scheme problem. Serve it over HTTPS, or open
> it on the device that is running it.
>
> Note also that the service worker only registers in a production build (it is gated on
> `import.meta.env.PROD`), so `npm run dev` gives no offline support even over HTTPS.

### Mode B: Termux Linux Field Environment (CLI & DSP tools)
Runs the Python side — `--benchmark`, `--sync`, `--bands` — on the phone itself:
```bash
pkg update && pkg install -y git curl python nodejs
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_android_termux.sh
./install_android_termux.sh
z30
```

> **Termux carries no audio, and this is not a configuration problem.** PortAudio binds neither
> host API Android offers (OpenSL ES, AAudio), the Termux PortAudio build has ALSA and JACK
> compiled out, and Android does not expose raw ALSA-compatible hardware to Termux's Linux
> userspace at all. `sounddevice` and PyAudio therefore return an empty device list no matter what
> is plugged into the USB OTG port and regardless of Termux:API microphone permission.
>
> Real-time RX/TX audio does not work under Termux, and neither does a USB OTG audio interface
> such as a Digirig. `install_android_termux.sh` installs what it can and `z30 --sync` falls back
> to its synthetic RF simulator, but treat Android/Termux as CLI/DSP-only rather than a full
> transceiver. Use **Mode A** for on-air audio.
>
> USB OTG *serial* CAT depends on the same unrooted device-node access and should not be assumed
> to work either — verify it against your own radio before relying on it in the field.

---

## 🥧 5. Raspberry Pi & Embedded Linux (DigiPi / SBCs)

Tested on **Raspberry Pi 3B+, 4B, 5, and Zero 2W** running Raspberry Pi OS (32-bit & 64-bit):
```bash
sudo apt-get update && sudo apt-get install -y python3-pip python3-venv libportaudio2 portaudio19-dev libhamlib-utils nodejs npm
git clone https://github.com/themantas1994/z-30.git
cd z-30
./install_ubuntu.sh
```
- **Hardware PTT**: Configure PTT Method to **`Raspberry Pi GPIO`** in the setup wizard (default: BCM Pin 17).

---

## 📦 6. Universal Python PEP 517 / 621 Wheel Packaging

To build a universal distributable Python wheel:
```bash
pip install build wheel
python3 -m build --wheel
pip install dist/*.whl
```
