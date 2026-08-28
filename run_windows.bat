@echo off
REM ==============================================================================
REM z-30 Transceiver - Windows 10/11 Automated Setup & Launcher Script
REM ==============================================================================

TITLE z-30 Digital Mode Transceiver (Windows)
COLOR 0A

echo ==============================================================
echo   z-30 Transceiver & DSP Suite - Windows 10/11 Environment
echo ==============================================================
echo.

REM Check Python installation
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3.9+ was not found on your PATH!
    echo Please install Python 3.9 or newer from https://www.python.org/
    echo Ensure you check the box "Add python.exe to PATH" during installation.
    pause
    exit /b 1
)

echo [1/4] Checking Python Virtual Environment...
IF NOT EXIST "%USERPROFILE%\.z30-venv" (
    echo Creating virtual environment in %USERPROFILE%\.z30-venv...
    python -m venv "%USERPROFILE%\.z30-venv"
)

call "%USERPROFILE%\.z30-venv\Scripts\activate.bat"

echo [2/4] Installing Required Python Packages (NumPy, SciPy, SoundDevice, PySerial)...
python -m pip install --upgrade pip setuptools wheel
python -m pip install numpy scipy sounddevice pyaudio pyserial cffi requests

echo [3/4] Checking Web/Node Components...
WHERE npm >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    echo Compiling web distribution...
    call npm install --silent
    call npm run build
)

echo [4/4] Launching z-30 Transceiver...
echo.
python -c "import sys; print('z-30 DSP Engine initialized successfully on Windows.'); import z30_dsp.gui; z30_dsp.gui.main()"

pause
