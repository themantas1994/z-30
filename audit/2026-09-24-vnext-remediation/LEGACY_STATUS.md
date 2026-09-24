# Legacy status — every legacy component and what happened to it

Legend: **Frozen reference** — kept unchanged (pinned), used only to generate or check reference
data. **Retired reference** — kept, not built or shipped, used only to reproduce findings and
reference vectors. **Deleted** — removed from the tree; recoverable from
`224b2fc58a6572adac4686b6858bbba741591339`.

## Python (`z30_dsp/` at 224b2fc)

| Module | Status | Location now | Reason |
| :--- | :--- | :--- | :--- |
| `modem.py`, `ldpc.py`, `message_codec.py`, `ap_decode.py`, `acquisition.py`, `benchmark.py` | Frozen reference | `legacy/python-oracle/z30_dsp/` | generate `fixtures/golden/`; the paired reference receiver in `research/` |
| `channel.py` | Frozen reference, one deliberate change | same | Watterson ensemble normalisation (H-10); recorded in the oracle README and `FROZEN.sha256` |
| `sic_decoder.py` | Frozen reference (unreachable) | same | its candidate-detection constants are pinned by the parity tests; the old SIC design it holds is not used anywhere |
| `__init__.py` | Frozen reference (docstring changed to say non-production) | same | |
| `web_server.py` | **Deleted** | — | local HTTP server + rigctld relay for the browser runtime; no longer needed (C-01/C-04 context) |
| `main.py` | **Deleted** | — | the `z30` launcher that fell back to Tk and then to a benchmark (L-01) |
| `gui.py`, `gui_tkinter.py` | **Deleted** | — | receive-only Tk shell |
| `config_wizard.py`, `station_settings.py` | **Deleted** | — | legacy setup; `z30 --migrate` reads their files |
| `rf_time_sync.py` | **Deleted** | — | reported success from noise and persisted offsets (C-03) |
| `auto_logger.py` | **Deleted** | — | legacy logger |
| `band_manager.py`, `paths.py`, `git_sync.py`, `updater.py` | **Deleted** | — | legacy runtime utilities |
| `web_dist/` | **Deleted** | — | 63 commits stale, default callsign W1AW (C-04) |
| tests of the deleted modules (`test_web_server_api.py`, `test_time_sync_guards.py`, `test_config_wizard.py`, `test_band_manager.py`, `test_git_sync.py`, `test_updater_cli.py`, `test_legacy_logger_and_config.py`) | **Deleted** with their modules | — | |
| oracle tests | kept | `legacy/python-oracle/tests/` | plus `test_oracle_is_frozen.py` |

## TypeScript browser runtime (`src/` at 224b2fc)

Moved whole to `legacy/browser-runtime/` — **Retired reference**. No `dev`/`build`/`preview`
script; CI checks none is reintroduced. The in-app data generators (`scripts/`) are deleted; the
generated `src/data/*.ts` are frozen snapshots.

| Component | Status | Change after retirement |
| :--- | :--- | :--- |
| `realReceiver.ts` (live receiver, C-01/C-02) | unchanged | none — it is why the runtime was retired |
| `sicDecoder.ts` (legacy SIC, H-01; self-test path) | `confidence: 99` removed (M-03); self-test decodes marked `synthetic` and labelled `SYNTHETIC TEST:` (H-03) | |
| `audioEngine.ts` | `SIC_COLLISION` preset removed (H-03) | |
| `rfTimeSyncEngine.ts` | RF and network sync always fail, store nothing (C-03, M-05) | |
| `qsoEngine.ts` | auto-log writes UTC, no FN31/−16/EM00 defaults (C-05) | |
| `catController.ts` | `canTransmit` checks the whole message round trip (C-06); rig console no longer invents VFO/state (M-01) | |
| `hamlibCatalog.ts` | all entries `UNTESTED`; unverified metadata removed (M-02) | |
| `App.tsx`, `QsoController.tsx`, `index.html` | no startup update check or Google Fonts (M-04); power labelled "set (not measured)" (M-12) | |
| `SpecsModal.tsx` | no longer claims −22.9 dB for this receiver (C-02) | |
| `monteCarloEngine.ts` | unchanged; not reachable from anything shipped | |
| `z30Codec.ts` | unchanged | reference for `fixtures/golden/messages.json` |
| TS tests | kept, paths updated; console tests now assert the honest answers; C-06 gate test added | |
| `public/`, `index.html`, `vite.config.ts` | kept as part of the snapshot | not built |

## Installers and packaging

| File | Status |
| :--- | :--- |
| `install_ubuntu.sh`, `install_arch.sh`, `install_android_termux.sh`, `run_windows.bat`, `build_windows.bat`, `build_all_platforms.py/.sh` | **Deleted** (installed the retired runtime) |
| `PKGBUILD`, `z30.spec` (PyInstaller), root `pyproject.toml`, root `requirements.txt` | **Deleted** / moved to the oracle (`requirements.txt`, trimmed to NumPy + SciPy) |
| `updater.py` (root), `.env.example`, `metadata.json`, `assets/.aistudio` | **Deleted** / moved with the browser runtime |
| `z30.desktop` | **Rewritten** as `packaging/linux/z30-gui.desktop` (launches `z30-gui`) |
| `CLEANUP-DEDUP-AUDIT.md` | moved to `audit/2026-09-01-cleanup/README.md` (historical) |

## Legacy PTT methods not carried into vNext

`AUDIO_TONE_RIGHT`, `RASPBERRY_PI_GPIO`, `TCI_NETWORK`, `WINKEYER`: never tested on hardware in
the legacy app; not implemented in vNext; migration reports each as skipped with the reason and
the gate refuses until a supported method is set.

## Can the retired code still reach an operator?

No: nothing installs, builds, serves or launches it; the application has no fallback; the
release archives are checked to contain only the two Rust binaries and documentation; CI fails if
the retired runtime's files reappear in the production tree. A developer can still run the
retired app's reference tests (`npm run test:ts`) and the oracle's (`pytest`).
