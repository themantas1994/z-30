# -*- mode: python ; coding: utf-8 -*-
# PyInstaller Spec for z-30 Digital Mode Transceiver

block_cipher = None

a = Analysis(
    ['config_wizard.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('config.json', '.'),
        ('band_manager.py', '.'),
        ('rf_time_sync.py', '.'),
    ],
    hiddenimports=[
        'numpy',
        'scipy',
        'scipy.signal',
        'scipy.fft',
        'sounddevice',
        'pyserial',
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
    icon='icon-512.svg'
)
