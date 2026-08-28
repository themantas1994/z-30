#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# z-30 Transceiver - Android Termux One-Line Setup & Field Radio Deployment
# Supports: Android 8.0 - 15+ (Termux F-Droid / GitHub release)
# Enables portable field operations (SOTA/POTA) with USB OTG audio cards & radios
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Transceiver - Android Termux Field Radio Deployment    ${NC}"
echo -e "${CYAN}==============================================================${NC}"

echo -e "${YELLOW}[1/4] Updating Termux packages and installing dependencies...${NC}"
pkg update -y
pkg install -y \
    python \
    python-numpy \
    python-scipy \
    clang \
    fftw \
    libportaudio \
    termux-api \
    nodejs \
    git \
    termux-tools

echo -e "${YELLOW}[2/4] Installing Python DSP & audio communication libraries...${NC}"
pip install --upgrade pip
pip install sounddevice pyserial requests

# Optional: compile web build
if [ -f "package.json" ]; then
    echo -e "${YELLOW}[3/4] Building web transceiver user interface...${NC}"
    npm install --silent || true
    npm run build || true
fi

echo -e "${YELLOW}[4/4] Creating Termux launcher shortcut (~/bin/z30)...${NC}"
mkdir -p "$HOME/bin"
cat << 'EOF' > "$HOME/bin/z30"
#!/data/data/com.termux/files/usr/bin/bash
echo "Starting z-30 DSP Transceiver engine on Android..."
# Launch local lightweight server for browser UI
if [ -d "dist" ]; then
    echo "Serving Web DSP at http://localhost:3000"
    termux-open-url "http://localhost:3000" &
    python3 -m http.server 3000 --directory dist
else
    python3 -c "import sys; from z30_dsp.main import main; main()" "$@"
fi
EOF
chmod +x "$HOME/bin/z30"

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}  ANDROID DEPLOYMENT COMPLETE!                                ${NC}"
echo -e "${GREEN}  Run 'z30' to start the transceiver on your Android device.  ${NC}"
echo -e "${GREEN}  You can also install z-30 as a standalone PWA via Chrome.   ${NC}"
echo -e "${GREEN}==============================================================${NC}"
