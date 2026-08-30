# -*- mode: python ; coding: utf-8 -*-
# PyInstaller Spec for z-30 Digital Mode Transceiver
#
# NOTE: build_windows.bat does NOT use this spec file - it invokes PyInstaller directly via
# CLI args against z30_dsp/main.py. This spec is provided as the reusable, "proper" PyInstaller
# entry point (`pyinstaller z30.spec`) and must be kept consistent with it: same real launcher
# entry point and the same real hidden-import module names.

import os

block_cipher = None

a = Analysis(
    ['z30_dsp/main.py'],
    pathex=[os.path.abspath('.')],
    binaries=[],
    # band_manager / rf_time_sync / config_wizard live inside the z30_dsp package and are
    # collected as ordinary imports; they used to also exist as drifted root-level copies that
    # were bundled here as data files. config.json is per-user runtime state written to the
    # user data directory, not something to bake into the executable.
    datas=[
        ('z30_dsp/web_dist', 'z30_dsp/web_dist'),
    ],
    hiddenimports=[
        'numpy',
        'scipy',
        'scipy.signal',
        'scipy.fft',
        'sounddevice',
        'serial',
        'serial.tools.list_ports',
        'cffi',
        'requests',
        'tkinter',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='z30-transceiver',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='public/icon-512.svg'
)
