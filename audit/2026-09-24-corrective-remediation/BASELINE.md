# Corrective remediation — baseline

This file records the repository as it was **before** any change in this remediation, and
which findings of the post-remediation audit reproduce on it. Nothing here was edited
after the fixes were written. Every figure below was produced by a command that was run,
and its output is in [`evidence/baseline/`](evidence/baseline/).

## Repository and environment

| | |
| :--- | :--- |
| Repository | `themantas1994/z-30` |
| Baseline commit | **`130796f76bb04602ca31b212d51f7e67849c5315`**. This is `main` at `0a4d8a9` plus the post-remediation audit commit (`audit/2026-09-24-post-remediation/`, documentation only), merged fast-forward into the working branch `claude/z30-corrective-remediation-q55wib`. |
| Audit's commit | `84033d4`. From `84033d4` to `0a4d8a9`, `main` changed only two GitHub Actions version bumps in `release.yml`. No Rust, Python or documentation source changed. |
| Date | 2026-09-24 |
| OS | Linux 6.18.44 x86_64 (Ubuntu 24.04 container) |
| CPU | Intel Xeon @ 2.10 GHz, 4 logical CPUs; 15 GB RAM |
| Toolchains | rustc/cargo **1.95.0** (the declared MSRV, installed with rustup for this run) and **1.98.1** (stable). The container's preinstalled stable was 1.94.1, which is *below* the MSRV, so it was updated. |
| Python | 3.11.15, NumPy 2.2.6, SciPy 1.15.3, pytest 9.1.1, ruff 0.16.5 (the CI pin) |
| Hardware | **None.** No radio, sound card, PTT interface or RF path. The container has no ALSA card. |

## Documents read before any change

- `audit/2026-09-24-post-remediation/FINAL_AUDIT.md` and all of its `evidence/` (harness source, mutation script, logs, results).
- `audit/2026-09-24-vnext-remediation/*` (the remediation's own record, which lists the 35 findings of `Z30_FULL_AUDIT_2026-09-24.md`).
- `README.md`, `SPEC.md`, `AGENTS.md`, `docs/` and `wiki/` (those parts that concern fading, loopback, logging, MSRV and TX safety).
- The workspace `Cargo.toml`, `.github/workflows/{rust,ci,release}.yml`, and `crates/z30-cli/src/{suite,bench,loopback,main}.rs`.

**`Z30_FULL_AUDIT_2026-09-24.md` itself is not in the repository or its history.** The
post-remediation audit said the same. Its finding IDs and titles are taken from the two audits
that are in the repository.

## Quality gates at baseline

The repository's own commands were run in the order CI runs them, with a separate target
directory per toolchain (`evidence/baseline/gates-1.95.0/`, `gates-1.98.1/`):

| Command | 1.95.0 (MSRV) | 1.98.1 (stable) |
| :--- | :--- | :--- |
| `cargo fmt --all --check` | pass | pass |
| `cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings` | **FAIL**: `clippy::overly_complex_bool_expr` (deny by default) at `crates/z30-protocol/src/codec.rs:259` | pass |
| `cargo test --workspace --exclude z30-py --release --locked` | **139 passed, 0 failed, 1 ignored** | **139 passed, 0 failed, 1 ignored** |
| `cargo build --release --locked -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108` | pass | pass |
| `cargo build --workspace --release --locked` | pass (Python present) | pass |

Other baseline checks:

| Check | Result | Evidence |
| :--- | :--- | :--- |
| Oracle tests `python -m pytest tests -q` (legacy/python-oracle) | 148 passed | `oracle_pytest.txt` |
| Oracle lint `ruff check z30_dsp tests` (ruff 0.16.5) | all checks passed | `oracle_ruff.txt` |
| Golden vectors `python reference/golden/generate.py --check` | all 18 files reproduce byte for byte | `golden_check.txt` |
| Release binary `z30 --version`, `strings` scan for `W1AW` and `web_dist`, and `ldd` | commit `130796f76bb0`; 0 `W1AW`; 0 `web_dist`; links only libasound, libgcc_s, libm, libc | `binary_baseline.txt` |

## Reproduction of the audit's findings

| Finding | Reproduced? | How | Evidence |
| :--- | :--- | :--- | :--- |
| **N-01** Watterson Doppler is 1/√2 of nominal | **Yes (oracle).** The audit's own script `py_watterson.py`, run on the frozen oracle, measured 2σ spreads of **0.0716 / 0.355 / 0.708 / 7.07 Hz** for the nominal 0.1 / 0.5 / 1 / 10 Hz. Each ratio is 0.707. The Rust side was confirmed by reading `z30-channel/src/lib.rs:125-128`: the amplitude filter is `exp(-0.5 (f/σ)²)` with σ = spread/2, so the power spectrum has standard deviation σ/√2. After the fix, the same measurement by the corrected tests is in the final audit | `py_watterson_baseline.json` |
| **N-02** clippy fails on 1.95.0 | **Yes** | table above | `gates-1.95.0/clippy.txt` |
| **N-03** round-trip layer unprotected (C06-a/b/c survive) | **Yes.** All three mutations survive | the audit's `mutate.py`, adapted only in its paths (worktree `/home/user/mut-wt`, same mutations and tests) | `mutation_survivors_baseline.log`, `.json` |
| **N-04** `--loopback-test` bypasses the gate; VOX not refused | **Yes.** With a configuration of only `[ptt] method = "vox"` and `--confirm-no-transmitter`, the test went on to open the output sound card. It stopped only because this container has no ALSA device ("The requested audio device is not available") | `z30 --config vox.toml --loopback-test --confirm-no-transmitter` | `n04_loopback_with_vox.txt` |
| **N-05** default dial logged as "commanded" | **Yes.** A probe drove a complete contact through `Engine` with no rig control and the default configuration dial. The log record was `dial_hz = Sourced { value: 14076000.0, source: Commanded }`, although no command was ever sent | temporary test in the mutation worktree (deleted afterwards); source kept | `n05_probe.rs`, `n05_probe_output.txt` |
| **N-06** LOG-c survives | **Yes** | mutation run | `mutation_survivors_baseline.log` |
| **N-07** C03-c survives | **Yes** | mutation run | same |
| **N-08** SNR-e survives | **Yes** | mutation run | same |
| AWGN −22.94 vs −23.03 dB | Investigated after the fix, on the corrected commit (the receiver is unchanged) | see the final audit | — |

Mutation baseline (the survivors only; the audit's 22 killed mutants (its text says 23; its own `mutation_results.json` has 22 killed, 6 surviving) were not re-run at
baseline, but all 28 are re-run after the fix):

```
C03-c [C-03] an own time offset of +0.3 s applied to UTC: SURVIVED
C06-a [C-06] verify_round_trip always succeeds: SURVIVED
C06-b [C-06] transmit gate no longer calls verify_round_trip: SURVIVED
C06-c [C-06] encoder's payload round-trip check removed: SURVIVED
LOG-c [C-05] missing received report logged as -16: SURVIVED
SNR-e [M-07] no-estimate case floored to -30 dB instead of None: SURVIVED
```

Every test group the mutations use passed unmutated in the same run (the `baseline ... PASS`
lines of the log).

## Trace notes taken at baseline (before any change)

- **TX entry points.** There is one transmit path in production: `runtime` control thread → `TxScheduler` → `Engine::plan_tx` → `txgate::can_transmit` → `runtime::tx_audio` → `PttController::key` → `AudioOutput::play`. It covers sequenced frames (from `CallCq`/`Answer`) and the tune carrier. `can_transmit` encoded and verified the message, but then **`plan_tx` encoded it a second time** and transmitted that second object. `EncodedMessage` had public fields and nothing required a verified value. No feature flag, `cfg` or configuration field disables any of it. Other paths that produce a waveform: `z30 --encode` (writes a WAV file; it did not verify) and `z30 --loopback-test` (**plays through the configured sound card with no gate**). The CLI `--receive` path has `NoPtt`, a `Silent` output and `tx_unavailable`.
- **Loopback → RF.** `loopback::run` → `CpalOutput::open(cfg.audio.output_device)` → `play`. It keys no PTT line and has no rigctld. But the configured output device of a station is normally the radio's audio input, and a radio on VOX (or any radio whose data input keys it) radiates it.
- **Watterson.** Rust `z30-channel::fade` and oracle `channel.py::apply_watterson_fading` apply the same amplitude filter, `exp(-½(f/σ_f)²)` with σ_f = D/2. Their normalisation is consistent with that filter, and both document the result as "power spectrum σ = D/2", which the filter does not give.
- **Dial provenance.** `Engine::new` set `commanded_dial = config.operating.dial_hz`, which defaulted to 14 076 000. The GUI never sends `SetDial`; it changes the dial with `UpdateConfig`, so with the GUI no dial was ever commanded to a radio. The engine logged the value as `Commanded` whenever there was no fresh, agreeing readback. `runtime` ignored the result of `set_dial` except as a generic rig error. Legacy migration wrote `freqMhz` (the legacy auto-logger's *dial + receive audio offset*) into `dial_hz`, and `0 Hz` when it was missing.
