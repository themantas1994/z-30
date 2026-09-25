# Evidence index

Every file here is the unedited output of a command that was run, or the script that ran it.
`FINAL_AUDIT.md` and `BASELINE.md` cite files by these paths.

| Path | What it is |
| :--- | :--- |
| `baseline/` | State at `130796f` before any change: gates on 1.95.0 and 1.98.1, oracle tests/lint, golden check, release-binary scan, the six baseline mutation survivors, the N-04 VOX reproduction, the N-05 probe (source and output), the oracle Doppler measurement |
| `gates-final-1.95.0/`, `gates-final-1.98.1/` | fmt, clippy, release tests and release builds on the corrected code, per toolchain |
| `final/` | oracle tests/lint, golden check, dependency graph, release-artifact checks (run 2; run 1 kept with its two script errors), term search table, gates at HEAD after `18fbd78` |
| `mutation/` | the corrective mutation run (single mutants and redundant-layer pairs): results JSON and full logs |
| `independent_harness/` | the post-remediation audit's harness re-run on the corrected code (round trip, Watterson, AWGN); its `Cargo.lock` from that run |
| `awgn_investigation/` | the −22.94 vs −23.03 dB analysis script, its output, the power checks, and the discarded `--seed` runs (labelled, used for nothing) |
| `benchmark_provenance/` | the deliberate decoder weakening and the benchmark following it |
| `scripts/` | every script used: gates, pipeline, mutation drivers, term search, result comparison, release-artifact checks |
| `pipeline.log`, `suite_run.log`, `suite_binary_version.txt` | the suite run at `672cef9` |
| `replicates*.log`, `replicates_binary_version.txt`, `awgn_replicate_*.log` | the ten AWGN replicates at `18fbd78` |
| `awgn_seed_*.log` | the flawed `--seed` attempt (see `awgn_investigation/flawed_seed_replicates_672cef9/`) |
| `py_watterson_after_fix.json` | the audit's oracle Doppler measurement after the fix |
