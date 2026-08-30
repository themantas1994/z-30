# 🔄 Software Updates & GitHub Upstream Synchronization

The **z-30 Amateur Radio Transceiver Suite** is actively developed on GitHub at:
**[https://github.com/themantas1994/z-30](https://github.com/themantas1994/z-30)**

---

## 🌟 Update Channels

z-30 provides two upstream update channels:

1. **Stable Releases**: Official GitHub releases tagged by version (e.g. `v1.0.0`, `v1.0.1`). Recommended for field stations and daily operations.
2. **Main Branch (Nightly / Development)**: Tracks the latest bleeding-edge commits on `main` branch. Includes experimental DSP filters, new rig CAT definitions, and performance optimizations.

---

## 🖥️ 1. In-App Web GUI & PWA Updates

When running the Web UI / PWA:
1. Click the **Update** button (with the download cloud icon) in the top right navigation bar or open **Station Settings ➔ 1. Station & Operator ➔ Software Version**.
2. Click **Check Now** to query the GitHub API (`api.github.com/repos/themantas1994/z-30`).
3. If an update is detected, click **Reload / Refresh PWA**. This automatically:
   - Unregisters legacy Service Workers.
   - Clears the browser `CacheStorage` and Web Audio buffers.
   - Reloads the page with the latest compiled assets from network.

---

## ⚡ 2. Native Terminal & CLI Update Tool (`z30 --update`)

The native Python package includes an automated upstream synchronizer:

```bash
# Run the built-in updater
z30 --update

# Or run non-interactively with auto-pull
z30 --update -y
```

---

## 🐧 3. Platform Specific Terminal Commands

### Ubuntu / Debian / Raspberry Pi OS (DigiPi)
```bash
cd z-30
git pull origin main
chmod +x install_ubuntu.sh
./install_ubuntu.sh
```

### Arch Linux / Manjaro / EndeavourOS
```bash
cd z-30
git pull origin main
chmod +x install_arch.sh
./install_arch.sh
# Or rebuild AUR package:
makepkg -si
```

### Windows 10 & 11
```cmd
cd z-30
git pull origin main
run_windows.bat
```

### Android Termux (Mobile Field Radio)
```bash
cd z-30
git pull origin main
chmod +x install_android_termux.sh
./install_android_termux.sh
```

### Generic Python Pip
```bash
git pull origin main
pip install --upgrade -e .
npm install && npm run build
```
