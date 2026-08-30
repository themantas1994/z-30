#!/usr/bin/env bash
# ==============================================================================
# z-30 Transceiver - Automated Installation Script for Arch Linux & Manjaro
# Compatible with Arch Linux, Manjaro, EndeavourOS, Garuda Linux, and CachyOS
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

# Sanity check: this script must be run from inside the z-30 project directory (the one
# containing package.json and pyproject.toml), not from $HOME or anywhere else - otherwise
# later steps fail with confusing errors (npm looking for package.json in the wrong place,
# `python -m build` finding no pyproject.toml) far from their actual cause.
if [ ! -f "package.json" ] || [ ! -f "pyproject.toml" ]; then
    echo -e "${RED}[ERROR] This script must be run from inside the z-30 project directory.${NC}"
    echo "Expected to find 'package.json' and 'pyproject.toml' in the current directory: $(pwd)"
    echo ""
    echo "Fix: cd into the folder you cloned/extracted z-30 into, then re-run this script, e.g.:"
    echo "  cd ~/z-30   # or wherever you extracted/cloned it"
    echo "  ./install_arch.sh"
    exit 1
fi

echo -e "${YELLOW}[1/4] Installing official dependencies via pacman...${NC}"
sudo pacman -Syu --needed --noconfirm \
    python \
    python-pip \
    python-setuptools \
    python-build \
    python-installer \
    python-wheel \
    python-numpy \
    python-scipy \
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

# Install sounddevice inside the venv (uses pacman-provided portaudio & cffi)
pip install --upgrade sounddevice

if command -v npm &> /dev/null; then
  echo -e "${YELLOW}[3/4] Compiling React Web DSP interface bundle...${NC}"
  # Non-fatal (package install below doesn't depend on this succeeding), but a real failure is
  # now printed loudly instead of silently discarded by a blanket `|| true`.
  if npm install --silent && npm run build; then
    mkdir -p "$HOME/.z30/web_dist"
    cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
    mkdir -p z30_dsp/web_dist
    cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
  else
    echo -e "${RED}[WARN] Web UI build failed (see npm output above) - continuing without it. Re-run 'npm run build' manually from this directory once the error is fixed.${NC}"
  fi
fi

# Build and install z-30 package (including web bundle)
python -m build --wheel --no-isolation
pip install dist/*.whl --force-reinstall

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
