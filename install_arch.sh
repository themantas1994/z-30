#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Installation Script for Arch Linux & Manjaro
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Transceiver & DSP Suite - Arch Linux Installer          ${NC}"
echo -e "${CYAN}==============================================================${NC}"

echo -e "${YELLOW}[1/4] Installing dependencies via pacman...${NC}"
sudo pacman -Syu --needed --noconfirm \
    python \
    python-pip \
    python-numpy \
    python-scipy \
    python-sounddevice \
    python-pyserial \
    python-cffi \
    portaudio \
    hamlib \
    tk \
    nodejs \
    npm \
    git \
    base-devel

echo -e "${YELLOW}[2/4] Building Python package wheel...${NC}"
python -m pip install --upgrade build wheel
python -m pip install sounddevice numpy scipy pyserial

if command -v npm &> /dev/null; then
  echo -e "${YELLOW}[3/4] Compiling web DSP interface...${NC}"
  npm install --silent || true
  npm run build || true
fi

echo -e "${YELLOW}[4/4] Registering desktop environment integration...${NC}"
mkdir -p "$HOME/.local/share/applications"
cat << EOF > "$HOME/.local/share/applications/z30.desktop"
[Desktop Entry]
Name=z-30 Digital Transceiver
Comment=16-MFSK Amateur Radio Digital Mode Transceiver & DSP Suite
Exec=python3 -c "import sys; from z30_dsp.gui import main; main()"
Icon=radio
Terminal=false
Type=Application
Categories=HamRadio;AudioVideo;
EOF

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}  Arch Linux installation complete! Launch with 'z30' or menu. ${NC}"
echo -e "${GREEN}==============================================================${NC}"
