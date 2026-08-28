#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Installation Script for Arch Linux & Manjaro
# Compatible with Arch Linux, Manjaro, EndeavourOS, and Garuda Linux
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Transceiver & DSP Suite - Arch Linux Installer          ${NC}"
echo -e "${CYAN}==============================================================${NC}"

# Check for pacman
if ! command -v pacman &> /dev/null; then
    echo -e "${RED}[ERROR] Pacman package manager not found. This script requires Arch Linux or an Arch-based distribution.${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/4] Installing dependencies via pacman...${NC}"
sudo pacman -Syu --needed --noconfirm \
    python \
    python-pip \
    python-setuptools \
    python-build \
    python-installer \
    python-wheel \
    python-numpy \
    python-scipy \
    python-sounddevice \
    python-pyserial \
    python-cffi \
    python-requests \
    portaudio \
    hamlib \
    tk \
    nodejs \
    npm \
    git \
    base-devel

echo -e "${YELLOW}[2/4] Setting up Python virtual environment with system site-packages...${NC}"
mkdir -p "$HOME/.z30"
python -m venv "$HOME/.z30-env" --system-site-packages
source "$HOME/.z30-env/bin/activate"

# Build and install wheel cleanly
python -m build --wheel --no-isolation
pip install --no-deps dist/*.whl --force-reinstall

if command -v npm &> /dev/null; then
  echo -e "${YELLOW}[3/4] Compiling web DSP interface bundle...${NC}"
  npm install --silent || true
  npm run build || true
fi

echo -e "${YELLOW}[4/4] Registering binary launcher and desktop menu entry...${NC}"
mkdir -p "$HOME/.local/bin"
cat << 'EOF' > "$HOME/.local/bin/z30"
#!/usr/bin/env bash
source "$HOME/.z30-env/bin/activate"
python -c "import sys; from z30_dsp.main import main; main()" "$@"
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
echo -e "${GREEN}  Arch Linux installation complete!                            ${NC}"
echo -e "${GREEN}  Run 'z30' or launch 'z-30 Digital Transceiver' from your menu.${NC}"
echo -e "${GREEN}  Repository: https://github.com/themantas1994/z-30            ${NC}"
echo -e "${GREEN}==============================================================${NC}"
