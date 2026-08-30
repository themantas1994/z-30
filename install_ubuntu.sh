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

# Sanity check: this script must be run from inside the z-30 project directory (the one
# containing package.json and pyproject.toml), not from $HOME or anywhere else. Running it
# from the wrong directory previously failed silently and confusingly deep into the script
# (`npm ERR! enoent ... open '/home/<user>/package.json'`), and - because the npm failure was
# never checked - the script would then skip installing the z30_dsp Python package entirely,
# surfacing later as an unrelated-looking `ModuleNotFoundError: No module named 'z30_dsp'`.
if [ ! -f "package.json" ] || [ ! -f "pyproject.toml" ]; then
  echo -e "\033[0;31m[ERROR] This script must be run from inside the z-30 project directory.\033[0m"
  echo "Expected to find 'package.json' and 'pyproject.toml' in the current directory: $(pwd)"
  echo ""
  echo "Fix: cd into the folder you cloned/extracted z-30 into, then re-run this script, e.g.:"
  echo "  cd ~/z-30   # or wherever you extracted/cloned it"
  echo "  ./install_ubuntu.sh"
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  python3 python3-pip python3-venv python3-tk python3-dev \
  build-essential libportaudio2 portaudio19-dev libasound2-dev \
  libhamlib-utils libhamlib-dev curl git

# Ubuntu/Debian's default 'apt install nodejs' package is far too old for this project's
# toolchain (Vite 6 requires Node.js 20.19+/22.12+): Ubuntu 20.04 ships Node 10.x, 22.04 ships
# 12.22.9, and even 24.04 only ships 18.x. Installing it that way breaks `npm run build` below.
# Install a current Node.js LTS from NodeSource instead, regardless of Ubuntu release.
if ! command -v node &> /dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo -e "${YELLOW}Installing a current Node.js LTS from NodeSource (apt's default 'nodejs' package is too old for this project)...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo -e "${GREEN}Found Node.js $(node --version), already recent enough - skipping NodeSource install.${NC}"
fi

mkdir -p "$HOME/.z30"
python3 -m venv "$HOME/.z30-env"
source "$HOME/.z30-env/bin/activate"

pip install --upgrade pip setuptools wheel build
pip install numpy scipy sounddevice pyaudio pyserial cffi requests

web_build_ok=0
if command -v npm &> /dev/null; then
  echo -e "${YELLOW}Compiling React Web DSP interface bundle...${NC}"
  # Non-fatal by design (the CLI/DSP tools below must still install even if this fails), but
  # unlike the old `|| true`, a real failure here is printed loudly rather than hidden - a
  # silent failure here is exactly what caused the web UI to go missing without explanation.
  if npm install --silent && npm run build; then
    web_build_ok=1
  else
    echo -e "\033[0;31m[WARN] Web UI build failed (see npm output above) - continuing without it. The z-30 CLI/DSP tools will still install; re-run 'npm run build' manually from this directory once the error is fixed.\033[0m"
  fi
  if [ "$web_build_ok" -eq 1 ]; then
    mkdir -p "$HOME/.z30/web_dist"
    cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
    mkdir -p z30_dsp/web_dist
    cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
  fi
else
  echo -e "${YELLOW}[WARN] npm still not available after install attempt - the app will run without a bundled web UI.${NC}"
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
