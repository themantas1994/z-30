#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Build & Installation Script for Ubuntu & Debian
# Supports: Ubuntu 20.04 LTS, 22.04 LTS, 24.04 LTS, Debian 11/12, Linux Mint, Pop!_OS
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Transceiver & DSP Suite - Ubuntu/Debian Installer      ${NC}"
echo -e "${CYAN}==============================================================${NC}"

# 1. Check for root / sudo
if [ "$EUID" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo -e "${YELLOW}[1/5] Updating APT repositories & installing system dependencies...${NC}"
$SUDO apt-get update
$SUDO apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  python3-tk \
  python3-dev \
  build-essential \
  libportaudio2 \
  portaudio19-dev \
  libasound2-dev \
  libhamlib-utils \
  libhamlib-dev \
  nodejs \
  npm \
  curl \
  git

echo -e "${YELLOW}[2/5] Creating isolated Python virtual environment (~/.z30-env)...${NC}"
mkdir -p "$HOME/.z30"
python3 -m venv "$HOME/.z30-env"
source "$HOME/.z30-env/bin/activate"

echo -e "${YELLOW}[3/5] Installing vectorized NumPy, SciPy, SoundDevice, PySerial...${NC}"
pip install --upgrade pip setuptools wheel
pip install numpy scipy sounddevice pyaudio pyserial cffi requests

# 2. Build local web frontend if nodejs is available
if command -v npm &> /dev/null; then
  echo -e "${YELLOW}[4/5] Compiling production web interface build...${NC}"
  npm install --silent || true
  npm run build || true
fi

# 3. Create launcher binary and desktop shortcut
echo -e "${YELLOW}[5/5] Creating Desktop Launcher and Terminal command (/usr/local/bin/z30)...${NC}"
$SUDO tee /usr/local/bin/z30 > /dev/null << 'EOF'
#!/bin/bash
source "$HOME/.z30-env/bin/activate"
python3 -c "import sys; from z30_dsp.gui import main; main()" "$@" || python3 -m http.server 3000 --directory /usr/share/z30/dist
EOF
$SUDO chmod +x /usr/local/bin/z30

# Freedesktop shortcut
mkdir -p "$HOME/.local/share/applications"
cat << EOF > "$HOME/.local/share/applications/z30.desktop"
[Desktop Entry]
Name=z-30 Digital Transceiver
Comment=16-MFSK Amateur Radio Digital Mode Transceiver & DSP Suite
Exec=/usr/local/bin/z30
Icon=radio
Terminal=false
Type=Application
Categories=HamRadio;AudioVideo;Network;
Keywords=HamRadio;MFSK;WSJTX;DSP;FT8;z30;
EOF

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}  INSTALLATION COMPLETE!                                      ${NC}"
echo -e "${GREEN}  Run 'z30' in any terminal or launch from Applications menu.  ${NC}"
echo -e "${GREEN}==============================================================${NC}"
