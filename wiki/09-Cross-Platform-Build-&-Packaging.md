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

### Mode A: Progressive Web App (Instant Install)
1. Open the hosted or local z-30 URL in **Chrome** or **Brave** on your Android tablet or smartphone.
2. Tap `(⋮)` $\to$ **"Install app"** or **"Add to Home screen"**.
3. Runs in standalone fullscreen with direct hardware audio input.

### Mode B: Termux Linux Field Environment (OTG Audio & CAT)
For direct USB OTG connections to radios (Digirig, Icom IC-705, Xiegu G90):
```bash
pkg update && pkg install -y git curl python nodejs
git clone https://github.com/themantas1994/z-30.git
cd z-30
chmod +x install_android_termux.sh
./install_android_termux.sh
z30
```

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
