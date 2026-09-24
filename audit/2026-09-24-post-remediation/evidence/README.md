# Evidence for FINAL_AUDIT.md

Everything here was produced by this audit against `themantas1994/z-30` at `84033d4531b3`. No hardware was involved.

| Path | What |
| :--- | :--- |
| `harness/` | The independent verification harness (Rust). It depends on a z-30 checkout via path dependencies; adjust `Cargo.toml` to point at yours. Modes: `awgn`, `snr`, `mismatch`, `nosig`, `watterson`, `sic`, `roundtrip`. Its own seeds (base `0x5EED_A0D1_0924`, ChaCha20); it does not use `z30-channel` except to measure the Watterson model itself and in the Watterson part of `mismatch` |
| `scripts/mutate.py` | The mutation run: 28 mutations applied one at a time in a separate git worktree (`mut/` next to the script), with the guarding tests run and the file restored after each |
| `scripts/py_watterson.py` | Measures the frozen Python oracle's Watterson model (run from `legacy/python-oracle`) |
| `results/audit_*.json` | Harness outputs |
| `results/py_watterson.json` | Oracle channel measurements |
| `results/mutation_results.json` | Per-mutation verdicts and the tests that failed |
| `results/repro_awgn_head.json`, `repro_fading_head.json` | `z30 --benchmark awgn|fading` re-run from HEAD built with rustc 1.95.0; identical point by point to `research/results/d8983eeef66e/` |
| `logs/` | Harness console output, mutation log, the 1.95.0 test summary (139 passed / 0 failed / 1 ignored), test names, and the 1.95.0 clippy failure |
