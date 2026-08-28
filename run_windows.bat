@echo off
TITLE z-30 Digital Mode Transceiver (Windows)
COLOR 0A

echo ================================================================
echo       z-30 Transceiver & DSP Suite (Windows Launcher)
echo ================================================================

IF NOT EXIST "%USERPROFILE%\.z30-venv" (
    echo Initializing Python virtual environment...
    python -m venv "%USERPROFILE%\.z30-venv"
)
call "%USERPROFILE%\.z30-venv\Scripts\activate.bat"

echo Checking Python dependencies...
python -m pip install --upgrade pip setuptools wheel
python -m pip install numpy scipy sounddevice pyaudio pyserial cffi requests windows-curses

WHERE npm >nul 2>nul
IF %ERRORLEVEL% EQU 0 (
    IF NOT EXIST "dist\index.html" (
        echo Compiling React Web DSP interface...
        call npm install
        call npm run build
    )
)

echo Starting z-30 Transceiver in native window mode...
python -c "import sys; from z30_dsp.main import main; main()" %*
pause
