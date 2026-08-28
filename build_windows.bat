@echo off
REM ==============================================================================
REM z-30 Transceiver - Windows Standalone .EXE PyInstaller Build Script
REM ==============================================================================

TITLE z-30 PyInstaller Executable Builder
COLOR 0B

echo ==============================================================
echo   Building z-30 Standalone Windows Binary (z30-transceiver.exe)
echo ==============================================================

pip install pyinstaller numpy scipy sounddevice pyaudio pyserial

echo Compiling frontend assets if npm is installed...
WHERE npm >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    call npm run build
)

echo Running PyInstaller...
pyinstaller --noconfirm --onedir --windowed ^
    --name "z30-transceiver" ^
    --add-data "config.json;." ^
    --add-data "band_manager.py;." ^
    --add-data "rf_time_sync.py;." ^
    --hidden-import "numpy" ^
    --hidden-import "scipy" ^
    --hidden-import "sounddevice" ^
    --hidden-import "pyserial" ^
    z30_dsp/main.py

echo Build completed in dist\z30-transceiver\z30-transceiver.exe
pause
