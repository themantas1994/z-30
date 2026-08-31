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
# These are hard requirements: z30_dsp/modem.py and z30_dsp/channel.py import numpy and scipy at
# module scope, so failing here must stop the install rather than leave a half-working DSP.
pkg install -y python python-numpy python-scipy clang fftw termux-api nodejs git

# PortAudio is deliberately NOT on the line above, for two reasons.
#
# First, it is optional here - see the KNOWN LIMITATION below; it cannot carry audio on Android
# either way. Second, which name resolves depends on the Termux repo the device is pointed at,
# and this script cannot know that in advance. A name that does not resolve makes `pkg install`
# exit non-zero, and under `set -e` that aborted the entire installation at step 1 over a library
# the operator does not actually need. So each candidate is tried on its own and none of them can
# take the install down with it.
portaudio_pkg=""
for candidate in portaudio libportaudio2 libportaudio; do
  if pkg install -y "$candidate" >/dev/null 2>&1; then
    portaudio_pkg="$candidate"
    break
  fi
done
if [ -n "$portaudio_pkg" ]; then
  echo "[INFO] PortAudio installed from Termux package '$portaudio_pkg'."
else
  echo "[INFO] No PortAudio package resolved in this Termux repo - continuing without it."
  echo "       Audio capture does not work under Termux regardless (see the notes below)."
fi

pip install --upgrade pip setuptools wheel
# Pinned versions - see requirements.txt. numpy and scipy come from the Termux packages above
# (building them from source under Termux is impractical), so they are excluded here.
grep -vE '^(numpy|scipy)==' requirements.txt | pip install -r /dev/stdin

# KNOWN LIMITATION (not something this script can fix): sounddevice/PortAudio have no access to
# Android's audio devices from inside Termux. PortAudio binds neither of the host APIs Android
# offers (OpenSL ES, AAudio), the Termux build has ALSA and JACK compiled out, and Android does
# not expose raw ALSA-compatible hardware to Termux's Linux userspace in the first place - so
# device lists come back empty no matter what is plugged into the USB OTG port and regardless of
# whether Termux:API microphone permission was granted.
#
# Real-time RX/TX audio therefore does NOT work on Android under Termux, and neither does a USB
# OTG audio interface such as a Digirig. This script installs what it can, but treat Android as
# CLI/DSP-only (benchmark, rf_time_sync, band_manager) rather than a full transceiver until
# Termux/Android gain proper audio device access for third-party apps. For on-air audio on
# Android, use the PWA (wiki/09 section 4, Mode A) instead of Termux.
#
# Note that pip still installs sounddevice above (it is in requirements.txt). Importing it
# without a loadable PortAudio raises OSError, not ImportError - z30_dsp/rf_time_sync.py catches
# both, so `z30 --sync` falls back to its synthetic simulator here instead of crashing.

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
