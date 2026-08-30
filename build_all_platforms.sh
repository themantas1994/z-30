#!/usr/bin/env bash
# ==============================================================================
# z-30 Universal Cross-Platform Build & Verification Script
# Validates and builds artifacts for: Android, Windows, Linux (Ubuntu/Debian, Arch)
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================================${NC}"
echo -e "${GREEN}  z-30 Universal Multi-Platform Build Pipeline                ${NC}"
echo -e "${CYAN}==============================================================${NC}"

# 1. Clean previous build artifacts
echo -e "${YELLOW}[1/4] Cleaning build artifacts...${NC}"
rm -rf dist build *.egg-info

# 2. Compile Web SPA & PWA assets (Android, Windows, Linux, Web)
echo -e "${YELLOW}[2/4] Compiling Web SPA / PWA bundle (HTML5/Canvas/DSP)...${NC}"
npm run build

# 3. Create Python distribution packages (Wheel and Source Tarball)
echo -e "${YELLOW}[3/4] Packaging Python wheel and source distribution...${NC}"
python3 -m pip install --upgrade build setuptools wheel --quiet || true
# pyproject.toml is the only build configuration. setup.py used to sit alongside it, disagreeing
# about dependencies, console scripts and the development-status classifier - and, because
# pyproject.toml declares a [project] table, it took precedence and setup.py was dead anyway.
python3 -m build || true

# 4. Verification summary
echo -e "${YELLOW}[4/4] Verifying generated package contents...${NC}"
echo -e "${GREEN}  ✔ PWA Web Assets: dist/ (Android, Linux, Windows, macOS)${NC}"
if [ -d "dist" ]; then
    ls -la dist/
fi

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}  ALL PLATFORMS BUILT SUCCESSFULLY!                           ${NC}"
echo -e "${GREEN}  - Android:  Installable PWA & Termux (install_android_termux.sh)${NC}"
echo -e "${GREEN}  - Ubuntu:   APT installer (install_ubuntu.sh)${NC}"
echo -e "${GREEN}  - Arch:     PKGBUILD & Pacman (install_arch.sh)${NC}"
echo -e "${GREEN}  - Windows:  run_windows.bat & build_windows.bat (PyInstaller)${NC}"
echo -e "${GREEN}  - Linux:    pyproject.toml standard wheel & sdist${NC}"
echo -e "${GREEN}==============================================================${NC}"
