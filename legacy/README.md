# legacy/ — not the z-30 application

Everything under this directory is **outside the production path**. Nothing an operator
installs or launches uses it, no release artefact contains it, and nothing in `crates/` depends
on it. The z-30 application is the Rust workspace in [`crates/`](../crates) — the `z30`
command-line station and the `z30-gui` desktop application (see the [README](../README.md)).

| Directory | What it is | Why it is kept | What it is never used for |
| :--- | :--- | :--- | :--- |
| [`python-oracle/`](python-oracle/README.md) | The original Python implementation of the v1 protocol and its reference receiver, **frozen** (sources pinned by hash) | It generates the golden vectors the Rust implementation is tested against, bit for bit, and it is the paired reference in `research/` | Live audio, decoding for an operator, SIC, transmitting, PTT, time sync, any fallback |
| [`browser-runtime/`](browser-runtime/README.md) | The retired React/TypeScript browser transceiver that the README used to install | Its TypeScript codec is the reference for whole-message packing (`fixtures/golden/messages.json`), and the 2026-09-23 / 2026-09-24 audit probes reproduce their findings against it | Anything an operator runs: it is not built, served, packaged or maintained |

## What was removed rather than kept

The retired Python application — `web_server.py` (local HTTP server and rigctld relay),
`main.py` (the `z30` launcher with its Tk and benchmark fallbacks), `gui.py`/`gui_tkinter.py`,
`config_wizard.py`, `station_settings.py`, `band_manager.py`, `auto_logger.py`,
`rf_time_sync.py` (the RF time sync that reported success on noise, audit C-03), `git_sync.py`,
`updater.py`, `paths.py`, the committed `web_dist/` bundle (63 commits stale, default callsign
W1AW, audit C-04), the installers (`install_*.sh`, `run_windows.bat`, `build_*`, `PKGBUILD`,
`z30.spec`) and their tests — was deleted, not moved. None of it is reference material: the
vNext migration (`z30 --migrate`) reads its configuration and logbook files directly, and the
code itself is recoverable from the last commit that contained it,
`224b2fc58a6572adac4686b6858bbba741591339` (`git show 224b2fc:z30_dsp/web_server.py`).

See [`audit/2026-09-24-vnext-remediation/LEGACY_STATUS.md`](../audit/2026-09-24-vnext-remediation/LEGACY_STATUS.md)
for the full inventory.
