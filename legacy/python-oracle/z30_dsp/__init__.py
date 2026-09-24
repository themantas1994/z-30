"""
z-30 v1 protocol ORACLE - frozen reference implementation. NOT PRODUCTION SOFTWARE.

This package generates the golden vectors in fixtures/golden/ and hosts the reference receiver
the Rust implementation was validated against. It has no entry points, opens no audio device,
keys no transmitter and is not installed by anything an operator runs. The z-30 application is
the Rust workspace in crates/ (the `z30` and `z30-gui` binaries).

What it may and may not be used for: legacy/python-oracle/README.md.
"""

__version__ = "1.0.0"
__author__ = "Paulo Mantas"
__email__ = "paulomantas2009@gmail.com"
