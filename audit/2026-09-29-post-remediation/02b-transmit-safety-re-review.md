# Transmit-safety re-review: PR #46, D-1…D-6 and T-1…T-4

**Verdict: FINDINGS.** Two new High test gaps. Each comes from a mutant that survives against a guarantee the fixes claim, and neither is a defect in today's code. There are also two Low items. F-21 and F-43 are now VERIFIED, F-01 stays VERIFIED, and F-08 and F-16 stay NOT VERIFIED.

**Commit:** `6015d86` (branch `claude/nice-archimedes-epwg4o`). Mutants ran in `/tmp/claude-0/mut-v5` at `6433a48`, whose `crates/` code is the same as `6015d86`. The worktree was reset with `git checkout -- .` after every mutant and is clean.

**What I ran:** everything used `cargo +1.95 test --release --locked` with `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target`. No real PTT, rigctld, serial line or audio device was opened, and nothing was keyed. The mutant harness is in the session scratchpad (`…/scratchpad/mut.py`).
- **Guard tests, all pass:**
  - `z30-engine`: `tx_runtime`, `gate_contract`, `ptt_exit_latch`, `safety`, `emergency`, `dial_provenance`
  - `z30-io`: `--lib` (includes `d6_*`, `f43_*`, `f21_a_tk_only_*`) and `callback_alloc`
  - `z30-cli`: `loopback_isolation`
  - `z30-protocol`: `frame_integrity`, `round_trip`
- **Read:**
  - the source diff from `c164dd0` to `6015d86`
  - the control loop, `halt`, `shutdown` and `check_halt`
  - `Engine::apply` and every place that sets `tx_enabled` or `tune_pending`
  - `PttController::key` and `release_bounded`
  - both `ctrlc` handlers
  - the GUI's command senders and close guard
  - the loopback allowlist
  - run 4's JSON
- **9 extra mutants** (table below).

## Findings

### R-1 [High, test gap]: the D-1 drop of a queued `Answer` is untested (F-16)
- **Where:** `crates/z30-engine/src/api.rs:43` (`arms_transmission`). The test `tx_runtime::d1_*` loops over Tune, CallCq and EnableTx(true) only.
- **Mutant:** R5-D1-answer removes `Command::Answer(_)` from the `matches!`. It **SURVIVED** all `z30-engine` tests.
- **Failure scenario if this regresses:**
  1. The control thread is blocked in a driver.
  2. The operator double-clicks a decode (`app.rs:544`) and then presses HALT.
  3. The queued `Answer` is applied after the HALT. It sets `tx_enabled = true` and also moves `tx_slot` and `rx_audio_hz`.
  4. The station transmits in the next slot. This is the D-1 failure, through the GUI's most common arming action.
- **Today's code:** correct by inspection.
- **Fix:** add a unit test that `CallCq`, `Answer(_)`, `EnableTx(true)` and `Tune` arm, and that `EnableTx(false)`, `HaltTx`, `ResetQso`, `SetDial`, `SetAudioFrequencies` and `UpdateConfig` do not. Or add an `Answer` case to `d1_*` once the harness can inject a decode.

### R-2 [High, test gap]: any `#[cfg(test)]` item hides the rest of `loopback.rs` from the allowlist (F-08, T-1 residual)
- **Where:** `crates/z30-cli/tests/loopback_isolation.rs:157`, `full.split("#[cfg(test)]").next()`. The allowlist and the `include!` check see only the text before the **first** `#[cfg(test)]`.
- **Mutant:** R5-T1-cfgtest-late puts `#[cfg(test)] const _T: u8 = 0;` just above `pub fn run`, and inside `run` adds a never-executed `std::net::TcpStream::connect("192.0.2.1:4532")`. It **SURVIVED** all four guard tests.
- **Why the obvious variant fails:** the same edit placed above line 159 is killed, but only because the vacuity check loses sight of `frame_audio`.
- **Effect:** the T-1 fix (allowlisting `std` by sub-path, refusing `include!`) works only for code above the first test-only item. Any helper marked `#[cfg(test)]` placed below line 159 turns the guard off for `run()` and everything after it. This guard is the only thing that enforces "Loopback never transmits".
- **Fix:** require exactly one `#[cfg(test)]` in `loopback.rs`, immediately followed by `mod tests` and running to the end of the file. Assert that before splitting, or strip only that final module.

### R-3 [Low]: `std::fs::write` on any path is admitted (T-1 residual)
- **Where:** `loopback_isolation.rs` `STD` list; `crates/z30-cli/src/loopback.rs:258`.
- **Mutant:** R5-T1-fswrite adds a never-executed write to a tty-shaped path in `run`. It **SURVIVED**.
- **Why it matters:** on Linux, opening a tty asserts DTR and RTS, which is the hazard T-1 named. Today the only use is the operator's `--out` path. `z30 --loopback-test --out /dev/ttyUSB0` would briefly assert DTR/RTS on a serial PTT interface. That is contrived, but it is a transmit path from loopback.
- **Fix:** have `run` return the report text and let `main.rs` write it. Or refuse an `--out` path that is a character device.

### R-4 [Low]: D-4 is implemented, untested, and only partly bounded
- **Untested:** R5-D4-unkey (reverting `release_within` to `unkey()` at `runtime.rs:416`) **SURVIVED** all `z30-engine` tests.
- **Partly bounded:** the release wait is now bounded, but `shutdown` then joins the runtime threads at `runtime.rs:428`. A control thread wedged in a driver call that never returns (D-4's own example, a hung HID write) still hangs the GUI's exit, and the `ShutdownReport` is never shown. The line's state is unaffected.
- **Fix:**
  - Add a test with a fake line whose `set` blocks on a gate, asserting that `shutdown` returns within the window with `release_confirmed == false`.
  - Do not join, or join with a timeout, a thread still holding the line after the report is built.

### Note: the order inside `halt()` is unpinned
R5-D1-order puts the flag store before the epoch bump, with a yield between them. It **SURVIVED**. The window it opens is a race: `check_halt` consumes the flag, then a command stamped before the HALT is compared against the old epoch and applied. A deterministic test is impractical; the `// First:` comment at `runtime.rs:450` is the pin. I accept that and record it here only so it is not lost.

## D-1: checked for bypasses (no bypass found)
- **Other clones of the sender:** every `CommandSender` clone shares one `Arc<AtomicU64>`, and its raw `Sender` field is private. The GUI sends only through `rt.commands.try_send` (`app.rs:186`).
- **The engine re-arming itself:** `tx_enabled = true` appears only in `apply` for CallCq, Answer and EnableTx(true) (`engine.rs:252,266,274`), and `tune_pending = true` only for Tune. Slot reports, `Internal` messages, rig readings and clock steps never arm.
- **`UpdateConfig`, `SetDial`, `SetAudioFrequencies`:** they cannot arm. Applying them after a HALT only changes configuration, and both `UpdateConfig` and `SetDial` return `halt_tx()`.
- **Ordering:** a command dequeued before the epoch bump is cleared by the `check_halt` that follows the flag. A command stamped before the HALT and dequeued after it is dropped. A command sent after the HALT is applied; `d1_*` checks this, and R5-D1-le kills the `<=` variant.

## D-2, D-5, D-6, D-3
- **D-2:** RV2-D2 is KILLED. I traced the races between the GUI signal handler (`refuse_further_keys`, then `emergency_release_all`) and `key()` before the drive, during it and after it. In each case the line ends released, or the "NOT confirmed" message is printed. The panic hook correctly does not set the latch, and the CLI has only `NoPtt`.
- **D-5:** correct by inspection. The reset runs before the close check in the same frame. There is no test, because it is GUI code.
- **D-6:** RV2-D6 is KILLED. Only `RPRT 0` confirms, and any other reply drops the connection.
- **D-3:** open as ledger row F-81, not reviewed here.

## Mutation table (this review)

| Mutant | Result | Killing test |
|---|---|---|
| R5-D1-answer: `Answer` removed from `arms_transmission` | **SURVIVED** | none (R-1) |
| R5-D1-le: `epoch <` → `epoch <=` | KILLED | `tx_runtime` (25 tests failed, including `d1_*`) |
| R5-D1-order: flag set before epoch bump | SURVIVED | race, not deterministically testable (note above) |
| R5-D4-unkey: shutdown back to blocking `unkey()` | **SURVIVED** | none (R-4) |
| R5-T1-cfgtest: early `#[cfg(test)]` + `std::net` in `run` | KILLED | `the_software_loopback_reaches_only_an_allowlist…` (vacuity check) |
| R5-T1-cfgtest-late: `#[cfg(test)]` just above `run` + `std::net` | **SURVIVED** | none (R-2) |
| R5-T1-fswrite: `std::fs::write` to a tty-shaped path in `run` | SURVIVED | none (R-3) |
| A-COMBO: RT-relfault + A-CHK-pending (not in run 4; re-run) | KILLED | `tx_runtime` (2 tests, `rt_an_unconfirmed_release_*`) |
| A-LATE-start re-run | KILLED | `runtime::tests::the_key_and_audio_start_lateness_limits_are_half_a_second` |
| A-B60-tol re-run | KILLED | `bandplan::tests::f02_*` (engine lib) |

I agree with run 4's survivors:
- G-plan is strictly equivalent.
- RT-relfault and A-CHK-pending are each equivalent alone, and killed together (A-COMBO above).
- A-BG-skippending changes only latency, since the watchdog retries every 50 ms.
- CAT-lazy is equivalent.
- A-SH-nohalt is Low, as before.

## Verdicts

| Row | Verdict | Evidence |
|---|---|---|
| F-01 | **VERIFIED** | Run 4: P-*, A-BD-nomark, A-SH-loop, A-SH-confirmed KILLED; A-COMBO re-run KILLED at 6433a48; RV2-D2 and RV2-D6 KILLED. The D-4 change is untested (R-4, Low) but leaves the confirmed/pending state machine unchanged. |
| F-08 | **NOT VERIFIED** | T-1's own gap is closed (A-LOOP-std KILLED in run 4; `include!` refused), but R5-T1-cfgtest-late SURVIVED (R-2), so the allowlist can be turned off for `run()`. R-3 is a Low residual. |
| F-16 | **NOT VERIFIED** | The D-1 fix is correct by inspection, and RV2-D1, RV2-D1-stamp and R5-D1-le are KILLED. R5-D1-answer SURVIVED (R-1): the `Answer` drop is untested. M-1 and L-1 remain closed. |
| F-21 | **VERIFIED** | A-MIG-tkptt, A-MIG-cm108pin, A-MIG-tkpower and A-MIG-dev KILLED by `migrate::tests::f21_*` (run 4). |
| F-43 | **VERIFIED** (software) | A-DEV-dupexact and DEV-first KILLED by `audio::tests::f43_*` (run 4). Whether a serial port raises DTR/RTS when opened remains a dummy-load hardware item. |

T-2 is closed (A-CLK-keyedonly KILLED by `t2_*`), as are T-3 (A-LOG-tune KILLED by `t3_*`) and T-4 (above).

Files:
- `/home/user/z-30/crates/z30-engine/src/api.rs`
- `/home/user/z-30/crates/z30-engine/src/runtime.rs`
- `/home/user/z-30/crates/z30-cli/tests/loopback_isolation.rs`
- `/home/user/z-30/crates/z30-cli/src/loopback.rs`
- `/home/user/z-30/crates/z30-engine/tests/tx_runtime.rs`

Hardware remains NOT VALIDATED; on-air remains NOT VALIDATED.