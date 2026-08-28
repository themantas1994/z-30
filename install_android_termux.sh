#!/data/data/com.termux/files/usr/bin/bash
# z-30 Transceiver - Android Termux Field Radio Deployment
set -e

pkg update -y
pkg install -y python python-numpy python-scipy clang fftw libportaudio termux-api nodejs git
pip install --upgrade pip
pip install sounddevice pyserial requests

mkdir -p "$HOME/bin"
cat << 'EOF' > "$HOME/bin/z30"
#!/data/data/com.termux/files/usr/bin/bash
python3 -c "import sys; from z30_dsp.main import main; main()" "$@"
EOF
chmod +x "$HOME/bin/z30"

echo "Android Termux installation complete. Run 'z30' to start transceiver."
