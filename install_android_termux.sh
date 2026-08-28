#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# z-30 Transceiver - Android Termux Field Radio Deployment Script
# ==============================================================================
set -e

echo "[1/4] Updating Termux repositories and installing packages..."
pkg update -y
pkg install -y python python-numpy python-scipy clang fftw libportaudio termux-api nodejs git
pip install --upgrade pip setuptools wheel
pip install sounddevice pyserial requests

echo "[2/4] Building React Web UI Bundle..."
if command -v npm &> /dev/null; then
  npm install --silent || true
  npm run build || true
  mkdir -p "$HOME/.z30/web_dist"
  cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
  mkdir -p z30_dsp/web_dist
  cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
fi

pip install -e .

mkdir -p "$HOME/bin"
cat << 'EOF' > "$HOME/bin/z30"
#!/data/data/com.termux/files/usr/bin/bash
python3 -c "import sys; from z30_dsp.main import main; main()" "$@"
EOF
chmod +x "$HOME/bin/z30"

echo "================================================================"
echo "  Android Termux installation complete!                         "
echo "  Run 'z30' to start the transceiver web interface.            "
echo "================================================================"
