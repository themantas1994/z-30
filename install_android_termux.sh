#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# z-30 Transceiver - Android Termux Field Radio Deployment Script
# ==============================================================================
set -e

# Sanity check: this script must be run from inside the z-30 project directory (the one
# containing package.json and pyproject.toml), not from $HOME or anywhere else - otherwise
# later steps fail with confusing errors far from their actual cause (e.g. npm looking for
# package.json in the wrong place, `pip install -e .` finding no pyproject.toml).
if [ ! -f "package.json" ] || [ ! -f "pyproject.toml" ]; then
  echo "[ERROR] This script must be run from inside the z-30 project directory."
  echo "Expected to find 'package.json' and 'pyproject.toml' in the current directory: $(pwd)"
  echo ""
  echo "Fix: cd into the folder you cloned/extracted z-30 into, then re-run this script, e.g.:"
  echo "  cd ~/z-30   # or wherever you extracted/cloned it"
  echo "  ./install_android_termux.sh"
  exit 1
fi

echo "[1/4] Updating Termux repositories and installing packages..."
pkg update -y
# NOTE: the package is "libportaudio2" in the Termux repo, not "libportaudio" (which does not
# exist there and would make this whole `pkg install` line fail).
pkg install -y python python-numpy python-scipy clang fftw libportaudio2 termux-api nodejs git
pip install --upgrade pip setuptools wheel
pip install sounddevice pyserial requests

# KNOWN LIMITATION (not something this script can fix): sounddevice/PortAudio have no reliable
# access to Android's audio devices from inside Termux - device lists commonly come back empty
# even with libportaudio2 installed and Termux:API microphone permission granted, because
# Android does not expose raw ALSA/PortAudio-compatible hardware to Termux's Linux userspace.
# Real-time RX/TX audio capture in the z-30 app is therefore not expected to work reliably on
# Android; this script installs what it can, but treat Android as CLI/DSP-only (benchmark,
# rf_time_sync, band_manager) rather than a full transceiver until Termux/Android gain proper
# audio device access for third-party apps.

echo "[2/4] Building React Web UI Bundle..."
if command -v npm &> /dev/null; then
  # Non-fatal (package install below doesn't depend on this succeeding), but a real failure is
  # now printed loudly instead of silently discarded by a blanket `|| true`.
  if npm install --silent && npm run build; then
    mkdir -p "$HOME/.z30/web_dist"
    cp -r dist/* "$HOME/.z30/web_dist/" 2>/dev/null || true
    mkdir -p z30_dsp/web_dist
    cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
  else
    echo "[WARN] Web UI build failed (see npm output above) - continuing without it. Re-run 'npm run build' manually from this directory once the error is fixed."
  fi
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
