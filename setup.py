#!/usr/bin/env python3
"""
z-30 Digital Mode Transceiver & DSP Suite - Cross-Platform Setup Script
Compatible with: Linux (Ubuntu, Debian, Fedora, Arch), Windows 10/11, macOS, and Android (Termux)
"""

from setuptools import setup, find_packages
import sys

install_requires = [
    'numpy>=1.22.0',
    'scipy>=1.8.0',
    'sounddevice>=0.4.5',
    'pyserial>=3.5',
]

# Platform conditional dependencies
if sys.platform.startswith('win'):
    install_requires.append('windows-curses>=2.3.0')

setup(
    name='z30-transceiver',
    version='1.0.0',
    description='16-MFSK Weak-Signal Digital Mode Transceiver, LDPC-SIC Decoder, CAT Controller, and DSP Suite',
    author='z-30 Amateur Radio DSP Working Group',
    author_email='dev@z30mode.org',
    url='https://github.com/z30mode/z30-transceiver',
    packages=find_packages(),
    py_modules=['config_wizard', 'rf_time_sync', 'band_manager'],
    install_requires=install_requires,
    python_requires='>=3.9',
    entry_points={
        'console_scripts': [
            'z30=z30_dsp.main:main',
            'z30-transceiver=z30_dsp.main:main',
            'z30-wizard=config_wizard:main',
            'z30-sync=rf_time_sync:main',
            'z30-bands=band_manager:main',
        ],
    },
    classifiers=[
        'Development Status :: 5 - Production/Stable',
        'Intended Audience :: Telecommunications Industry',
        'Topic :: Communications :: Ham Radio',
        'License :: OSI Approved :: MIT License',
        'Operating System :: POSIX :: Linux',
        'Operating System :: Microsoft :: Windows',
        'Operating System :: Android',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Programming Language :: Python :: 3.11',
        'Programming Language :: Python :: 3.12',
    ],
)
