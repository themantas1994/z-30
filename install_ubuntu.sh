#!/usr/bin/env bash
# z-30 Transceiver - Automated Build & Installation Script for Ubuntu & Debian
set -e

sudo apt-get update
sudo apt-get install -y \\
  python3 python3-pip python3-venv python3-tk python3-dev \\
  build-essential libportaudio2 portaudio19-dev libasound2-dev \\
  libhamlib-utils libhamlib-dev nodejs npm curl git

mkdir -p "$HOME/.z30"
python3 -m venv "$HOME/.z30-env"
source "$HOME/.z30-env/bin/activate"

pip install --upgrade pip setuptools wheel
pip install numpy scipy sounddevice pyaudio pyserial cffi requests

echo "z-30 Transceiver installed successfully on Ubuntu/Debian."
