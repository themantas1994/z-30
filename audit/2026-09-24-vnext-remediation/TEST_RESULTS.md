# Test results

Every suite run for this remediation, on the final tree, locally and in CI. Nothing was
skipped to make a suite pass. The one ignored Rust test is a manual screening helper that
needs an input file (`golden_ldpc.rs::screen_osd_pool`, `#[ignore]` since it was written).

## Environment

| | |
| :--- | :--- |
| Host | Linux 6.18.44 x86_64, Ubuntu 24.04.4 LTS, 4 logical CPUs (Intel Xeon), cloud container |
| Rust | rustc 1.98.1 (48a229cea 2026-09-01), cargo 1.98.1 (stable); rustc 1.95 (declared MSRV) |
| Python | 3.11.15, NumPy 2.2.6, SciPy 1.15.3, pytest 9.1.1, ruff 0.15.8 |
| Node | 22.22.2, npm 10.9.7 (retired browser runtime's reference tests only) |
| Hardware | **none**: no sound card, radio, PTT interface or RF path |

## Local results

| Check | Command | Result |
| :--- | :--- | :--- |
| Formatting | `cargo fmt --all --check` | clean (after `cargo fmt` fixed the new `loopback.rs`) |
| Lints | `cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings` | clean |
| Rust tests | `cargo test --workspace --exclude z30-py --release` | **139 passed, 0 failed, 1 ignored** in 28 test binaries |
| Release build | `cargo build --workspace --exclude z30-py --release` | ok |
| Release build, CM108 | `cargo build --release -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108` | ok; `--version` of both binaries reports commit, build date, rustc, target, architecture, profile, `features: cm108`, protocol v1 |
| No real callsign in binaries | `strings target/release/z30 target/release/z30-gui \| grep -cw W1AW` | 0 |
| MSRV | `cargo +1.95 build --workspace --locked` and `cargo +1.95 test --workspace --release --locked` (both `--exclude z30-py`) | ok on cargo/rustc 1.95.0: build clean; **139 passed, 0 failed, 1 ignored** (same as stable). CI job "Declared minimum Rust version builds and passes" also green on the PR head |
| Python oracle | `cd legacy/python-oracle && python -m pytest tests -q` | **148 passed**, 0 failed (after the fix in `dedd4e0`; the first run found 2 failures, see below) |
| Oracle lint | `ruff check z30_dsp tests` (oracle), `ruff check research reference` | clean |
| Golden vectors (oracle) | `python reference/golden/generate.py --check` | all 18 golden files reproduce byte for byte |
| Golden vectors (TS codec) | `npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts --check` | `messages.json` reproduces |
| Retired browser runtime | `npm run lint` (tsc strict) and `npm run test:ts` | clean; 10 test files pass (522 individual `ok` checks), including the new `rfTimeSyncRetired` and `legacyLabels` |

### Rust tests by crate

| Crate | Tests | Notable suites |
| :--- | ---: | :--- |
| z30-protocol | 34 | `golden.rs` 5, `properties.rs` 5, `round_trip.rs` 6, unit 18 |
| z30-dsp | 40 (+1 ignored) | `channel_scenarios.rs` 11, `golden_ldpc.rs` 7, `golden_demod.rs` 2, `sic_regression.rs` 4, `snr_accuracy.rs` 2, `sensitivity_regression.rs` 1, unit 13 |
| z30-engine | 37 | `safety.rs` 23, `qso_logging.rs` 4, `live_runtime.rs` 1, `virtual_clock.rs` 2, `emergency.rs` 1, unit 6 |
| z30-io | 16 | `logbook_integrity.rs` 4, `callback_alloc.rs` 1, unit 11 (migration, wall clock, logbook, rigctld) |
| z30-cli | 8 | unit: suite statistics, loopback analysis (3), version |
| z30-channel | 4 | ensemble-normalised Watterson, SNR calibration |
| z30-gui | 0 | the GUI holds no logic of its own; it is covered through `z30-engine` |
| **Total** | **139** | |

### Failures found and fixed during the remediation

| Where | What | Fix |
| :--- | :--- | :--- |
| Oracle, first run on the final tree | `test_the_python_sources_stay_importable_on_the_supported_floor`: its anti-vacuity guard needed more than 20 files; trimming the oracle left exactly 20 | The guard now requires both scanned trees with at least 8 files each; the scan is unchanged (`dedd4e0`) |
| Oracle, first run | `test_the_oracle_has_no_application_entry_points`: a comment in `pyproject.toml` contained the literal `[project.scripts]` | The comment was reworded; the test is unchanged (`dedd4e0`) |
| `cargo fmt --check` | formatting of the new `loopback.rs` | `cargo fmt` |

No test was weakened, disabled or deleted to make a suite pass.

## Mutation checks

A regression test proves something only if it fails when the defect returns. These were
re-broken on purpose and the test observed to fail:

| Test | Mutation | Result |
| :--- | :--- | :--- |
| `live_runtime.rs::c01_…` (C-01) | decode from a window ending before slot + 25.5 s | fails |
| `rfTimeSyncRetired.test.mjs` (C-03/M-05) | `RF_TIME_SYNC_RETIRED = false` | 23 checks fail |

## CI on the final pull request head

[themantas1994/z-30#34](https://github.com/themantas1994/z-30/pull/34), head `f98a24a` (the last head before the commit that completes these audit files, which changes only files under `audit/`):

| Workflow | Jobs | Result |
| :--- | :--- | :--- |
| `vNext (Rust)` | build and test on ubuntu, windows and macos (stable); declared MSRV builds and passes; benchmark suite runs through the shipped binary and records provenance; golden vectors reproduce; paired oracle-vs-production harness | all success (two runs: push and pull_request) |
| `CI` | Python oracle 3.10, 3.11, 3.12, 3.13; retired browser runtime (reference tests); dependency audit; repository hygiene and production separation | all success |
| CodeQL | actions, javascript-typescript, python, rust | all success |

## Not run

- **Any hardware test.** See FINAL_AUDIT.md, "Hardware tests not performed".
- **`z30-py`** (the research bindings) is excluded from the workspace test run, as in CI. It is
  built and exercised by the CI `harness` job (the paired oracle-vs-`decode_slot` smoke run).
- **The release workflow** runs only on a version tag; no tag was pushed. Its build step is the
  same command as the local CM108 release build above.
