@echo off
setlocal enabledelayedexpansion

TITLE z-30 Digital Mode Transceiver (Windows)
COLOR 0A

echo ================================================================
echo       z-30 Transceiver ^& DSP Suite (Windows Launcher)
echo ================================================================
echo.

REM -----------------------------------------------------------------
REM Step 1: Detect working Python 3.9+ installation
REM -----------------------------------------------------------------
set "PYTHON_EXE="

REM Test if existing venv python is already available and functional
if exist "%USERPROFILE%\.z30-venv\Scripts\python.exe" (
    "%USERPROFILE%\.z30-venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
    if !errorlevel! EQU 0 (
        set "PYTHON_EXE=%USERPROFILE%\.z30-venv\Scripts\python.exe"
        goto :python_found
    )
)

REM Test standard Windows Python Launcher (py -3)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=py -3"
    goto :create_venv
)

REM Test standard python in PATH
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=python"
    goto :create_venv
)

REM Test python3 in PATH
python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if %errorlevel% EQU 0 (
    set "PYTHON_BOOTSTRAP=python3"
    goto :create_venv
)

REM Scan common Windows Python installation directories
for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
    "%ProgramFiles%\Python313\python.exe"
    "%ProgramFiles%\Python312\python.exe"
    "%ProgramFiles%\Python311\python.exe"
    "%ProgramFiles%\Python310\python.exe"
    "%ProgramFiles%\Python39\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
    "C:\Python310\python.exe"
    "C:\Python39\python.exe"
) do (
    if exist "%%~P" (
        "%%~P" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
        if !errorlevel! EQU 0 (
            set "PYTHON_BOOTSTRAP=%%~P"
            goto :create_venv
        )
    )
)

REM -----------------------------------------------------------------
REM If no Python found, display clear instructions
REM -----------------------------------------------------------------
COLOR 0C
echo [ERROR] Python 3.9+ was not found on your Windows system!
echo.
echo ================================================================
echo                     HOW TO FIX THIS:
echo ================================================================
echo.
echo Option 1 (Recommended - Official Python Installer):
echo   1. Download Python 3.11 or 3.12 from:
echo      https://www.python.org/downloads/
echo   2. Run the installer and CRITICALLY check the box:
echo      [X] "Add python.exe to PATH" (at the bottom of installer)
echo   3. Click "Install Now", then relaunch this run_windows.bat script.
echo.
echo Option 2 (Windows Terminal / Winget):
echo   Open Command Prompt or PowerShell and run:
echo      winget install Python.Python.3.11
echo.
echo Option 3 (Fix Windows Store alias issue):
echo   If you already installed Python, Windows may be intercepting it:
echo   Go to: Windows Settings ^> Apps ^> Advanced app settings ^> App execution aliases
echo   Turn OFF the toggles for "python.exe" and "python3.exe".
echo.
echo ================================================================
echo.
pause
exit /b 1

REM -----------------------------------------------------------------
REM Step 2: Initialize / Activate Virtual Environment
REM -----------------------------------------------------------------
:create_venv
if not exist "%USERPROFILE%\.z30-venv" (
    echo [INFO] Initializing Python virtual environment at "%USERPROFILE%\.z30-venv"...
    %PYTHON_BOOTSTRAP% -m venv "%USERPROFILE%\.z30-venv"
    if !errorlevel! NEQ 0 (
        echo [WARN] Failed to create venv with default parameters. Retrying with --without-pip...
        %PYTHON_BOOTSTRAP% -m venv "%USERPROFILE%\.z30-venv" --without-pip
    )
)

set "PYTHON_EXE=%USERPROFILE%\.z30-venv\Scripts\python.exe"

:python_found
if not exist "%PYTHON_EXE%" (
    echo [ERROR] Virtual environment python executable not found at:
    echo "%PYTHON_EXE%"
    pause
    exit /b 1
)

echo [OK] Using Python environment: %PYTHON_EXE%
echo.

REM -----------------------------------------------------------------
REM Step 3: Check & Install Python Dependencies
REM -----------------------------------------------------------------
echo [INFO] Verifying and updating Python DSP dependencies...
"%PYTHON_EXE%" -m pip install --upgrade pip setuptools wheel --quiet >nul 2>nul
"%PYTHON_EXE%" -m pip install numpy scipy sounddevice pyserial cffi requests windows-curses --quiet

if %errorlevel% NEQ 0 (
    echo [WARN] Attempting dependency installation with verbose output...
    "%PYTHON_EXE%" -m pip install numpy scipy sounddevice pyserial requests
)

REM -----------------------------------------------------------------
REM Step 4: Check & Build Web DSP Assets if needed
REM -----------------------------------------------------------------
where npm >nul 2>nul
if %errorlevel% EQU 0 (
    if not exist "dist\index.html" (
        echo [INFO] Building Web DSP user interface assets...
        call npm install --silent
        call npm run build
    )
)

REM -----------------------------------------------------------------
REM Step 5: Launch Transceiver
REM -----------------------------------------------------------------
echo.
echo ================================================================
echo        Starting z-30 Digital Transceiver ^& DSP Engine...
echo ================================================================
echo.

"%PYTHON_EXE%" -c "import sys; from z30_dsp.main import main; main()" %*

if %errorlevel% NEQ 0 (
    echo.
    echo [INFO] Transceiver exited with code %errorlevel%.
)

pause
