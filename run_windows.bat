@echo off
TITLE z-30 Digital Mode Transceiver (Windows)
COLOR 0A

echo Checking Python virtual environment...
IF NOT EXIST "%USERPROFILE%\\.z30-venv" (
    python -m venv "%USERPROFILE%\\.z30-venv"
)
call "%USERPROFILE%\\.z30-venv\\Scripts\\activate.bat"

python -m pip install --upgrade pip setuptools wheel
python -m pip install numpy scipy sounddevice pyaudio pyserial cffi requests

python -c "import z30_dsp.gui; z30_dsp.gui.main()"
pause
