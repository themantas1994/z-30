#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Build & Installation Script for Ubuntu & Debian
# Compatible with Ubuntu 20.04/22.04/24.04, Debian 11/12, Linux Mint, and Pop!_OS
# ==============================================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Transceiver & DSP Suite - Ubuntu/Debian Installer        ${NC}"
echo -e "${CYAN}==============================================================${NC}"

sudo apt-get update
sudo apt-get install -y \
  python3 python3-pip python3-venv python3-tk python3-dev \
  build-essential libportaudio2 portaudio19-dev libasound2-dev \
  libhamlib-utils libhamlib-dev nodejs npm curl git

mkdir -p "$HOME/.z30"
python3 -m venv "$HOME/.z30-env"
source "$HOME/.z30-env/bin/activate"

pip install --upgrade pip setuptools wheel build
pip install numpy scipy sounddevice pyaudio pyserial cffi requests

if command -v npm &> /dev/null; then
  echo -e "${YELLOW}Compiling React Web DSP interface bundle...${NC}"
  npm install --silent || true
  npm run build || true
  mkdir -p "$HOME/.z30/web_dist"
  cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
  mkdir -p z30_dsp/web_dist
  cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
fi

python3 -m pip install -e .

mkdir -p "$HOME/.local/bin"
cat << 'EOF' > "$HOME/.local/bin/z30"
#!/usr/bin/env bash
source "$HOME/.z30-env/bin/activate"
python3 -c "import sys; from z30_dsp.main import main; main()" "$@"
EOF
chmod +x "$HOME/.local/bin/z30"

mkdir -p "$HOME/.local/share/applications"
cat << EOF > "$HOME/.local/share/applications/z30.desktop"
[Desktop Entry]
Name=z-30 Digital Transceiver
Comment=16-MFSK Amateur Radio Digital Mode Transceiver & DSP Suite
Exec=$HOME/.local/bin/z30
Icon=radio
Terminal=false
Type=Application
Categories=HamRadio;AudioVideo;Network;
EOF

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Transceiver installed successfully on Ubuntu/Debian!     ${NC}"
echo -e "${GREEN}  Run 'z30' or launch 'z-30 Digital Transceiver' from your menu.${NC}"
echo -e "${GREEN}==============================================================${NC}"
