# Transmit-safety confirmation re-review of df45d56 (R-1 to R-4)

**Commit audited:** `df45d562ac1a` (PR #46, branch `claude/nice-archimedes-epwg4o`). I only read `/home/user/z-30`. Mutants ran in `/tmp/claude-0/mut-v5` (detached at df45d56) with `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target` and `cargo +1.95 test --release --locked`. I restored the worktree after each mutant and it is clean now. Nothing touched hardware.

**Verdict: FINDINGS.** The fixes for R-1, R-3 (on Unix) and R-4 work, and I found no way around D-1. F-08 stays NOT VERIFIED for two reasons: the R-2 guard can be fooled in a new way, and the R-3 device refusal has no test.

## What I ran
- Guarding tests at df45d56, all passing:
  - `z30-engine`: `gate_contract` 15, `tx_runtime` 28, `safety` 29, `emergency` 9, `ptt_release` 1.
  - `z30-cli`: `loopback_isolation` 4.
- 9 targeted mutants (table below).
- The disk filled up partway through (other agents were building in parallel). The two runs that hit it were repeated and completed; none of the results below come from a failed build.

## Mutation table

| Mutant | Result | Killing test |
|---|---|---|
| R1: remove `Command::Answer(_)` from `arms_transmission` | KILLED | `gate_contract::r1_exactly_the_commands_that_can_lead_to_a_transmission_are_dropped_after_halt` |
| R4: always join threads, even when the release is unconfirmed | KILLED | `tx_runtime::r4_shutdown_returns_within_its_window_even_behind_a_wedged_release_driver` |
| R4: retry the release with a blocking `unkey()` on the caller | KILLED | `tx_runtime::r4_…` |
| R4: delete shutdown's background retries | SURVIVED (equivalent) | none. The watchdog retries `ReleasePending` every 50 ms throughout the window, so behaviour does not change. Not a finding. |
| R2: the earlier reviewer's bypass (late `#[cfg(test)] const` plus `std::net` in `run`) | KILLED | `the_software_loopback_reaches_only_an_allowlist_of_crates_and_items` |
| R2: `'{'` char literal inside `mod tests`, then a non-test `fn side_channel(){ let _='}'; std::net::TcpStream::connect(..) }` after it, called from `run()` | **SURVIVED** | none (finding 2) |
| Guard: `let _u = "http://"; let _ = std::net::TcpStream::connect(..);` on one line in `run()` | **SURVIVED** | none (finding 3) |
| R3: `std::fs::write("/dev/ttyUSB0", …)` inside loopback.rs | KILLED | allowlist test |
| R3: `write_report_file` device check replaced by `if false` | **SURVIVED** | none in `z30-cli` (finding 1) |

## Findings

**1. High (by the rule that a surviving mutant means an untested guarantee; the hazard behind it is the Low R-3). The R-3 device refusal has no test.**
- Where: `crates/z30-cli/src/main.rs:536-548`.
- The CLI test only checks that main.rs contains the text `write_report_file(p, &text)`. With the check gutted, `z30 --loopback-test --out /dev/ttyUSB0` opens the tty again, which asserts DTR/RTS on a serial-PTT interface. Every test still passes.
- Fix: add a Unix behaviour test that runs the binary with `--loopback-test --out /dev/null` (a character device, harmless) and expects a non-zero exit plus the "not a regular file" message.

**2. Medium. The R-2 guard is fooled by braces inside literals.**
- Where: `crates/z30-cli/tests/loopback_isolation.rs:164-182`.
- The brace counter does not recognise string or char literals. A `'{'` inside `mod tests` and a `'}'` in a later item make the counted depth reach 0 exactly at end of file. Real code after the real end of `mod tests` is then compiled into the release binary but never checked, and `run()` can call it by its bare name, which the allowlist does not flag. Shown by the surviving mutant above.
- It needs two deliberate literals, so it is less likely than the original R-2. It does contradict the commit title's "cannot be switched off".
- Fix: tokenise rather than scan text. Either use `proc-macro2`/`syn` as a dev-dependency and require the last top-level item to be the only `#[cfg(test)]` one, or strip comments, strings and chars with a small lexer before counting braces.
- Same root cause, by inspection only (not mutation-tested): `#[macro_use] mod m;` in loopback.rs loads `src/loopback/m.rs`, which is never checked, and its macros are called without a path. The guard should refuse any `mod` declaration and `#[macro_use]` in loopback.rs.

**3. Low. `code_of` cuts each line at the first `//`, even inside a string literal.**
- Where: `crates/z30-cli/tests/loopback_isolation.rs:30-38`.
- Anything after a `"…//…"` literal on the same line is hidden from both the deny-list and the allowlist (surviving mutant above). This predates df45d56. The same lexer as finding 2 fixes it.

**4. Low. R-3 only protects Unix.**
- Where: `crates/z30-cli/src/main.rs:537`. The check is `#[cfg(unix)]`.
- On Windows, `--out COM3` (or `\\.\COM3`) goes straight to `std::fs::write`. Opening a COM port usually raises DTR there too, and CI builds Windows.
- Fix: on Windows, refuse device names and `\\.\` paths, or require the target to be absent or a regular file using a metadata check that does not open it.

**5. Info.**
- (a) The doc comment on `ShutdownReport.ptt` (`crates/z30-engine/src/runtime.rs:386`) still says "nothing in this runtime is retrying any more". After R-4 that is wrong in the safe direction: on the unconfirmed path the detached control thread keeps its controller, so the watchdog keeps retrying until that thread ends.
- (b) The confirmed path still joins every thread with no time limit (`runtime.rs:441`). A rig, DSP or output thread stuck in its driver can still hang exit. The line is confirmed released, so there is no RF risk. `docs/safety.md` describes this accurately; the commit title "bounded by its window alone" overclaims.

## Your three specific questions
- **Loopback guard:** findings 2 and 3 are the remaining bypasses. R-3 removed the file system from loopback.rs.
- **D-1:** I found no bypass.
  - `CommandSender`'s fields are private, and every send stamps the current epoch (`runtime.rs:345-352`). Arming is checked against the epoch at apply time.
  - The four arming variants are now pinned by the R1 test.
  - None of the non-arming commands sets `tx_enabled` or `tune_pending` (`engine.rs:225-292`), so one sent before a HALT cannot re-arm the station after it.
- **R-4, a control thread left running after shutdown:** your reasoning holds.
  - A `key()` that is stuck in its driver finds the state no longer `KEYED` when the driver returns, drives the release itself and returns `Err` (`ptt.rs:362`). `act` then aborts the timeline. Any `StartAudio` in the same tick sees the halt flag, which is still set, and returns. The loop then exits on `stop` and calls `unkey()` again (`runtime.rs:782-783`).
  - Only the handle and the control thread hold strong references to the controller. The watchdog holds a weak one and keeps retrying until the control thread drops its clone; `Shared::drop` then drives one final release if the line is still not `Released`.
  - Re-keying needs all of: state `Released`, the halt flag clear, a plan, and a `Key` from the timeline on a later turn of the loop. Once `stop` is set there is no later turn. If the thread is stuck anywhere else, the halt flag stays set for the rest of that turn, so `act(Key)` returns early.
  - After an unconfirmed shutdown the GUI cannot start a new runtime: `rt` is `None`, `apply_settings` returns at `snapshot()` (`app.rs:251`), and the restart branch returns (`app.rs:272-283`).

## Verdict table

| Ledger item | Verdict | Evidence |
|---|---|---|
| **F-16** (HALT never waits; D-1 epoch; bounded shutdown) | **VERIFIED** | R-1 pinned: Answer mutant KILLED by `r1_*`. R-4: join-always and blocking-unkey-on-caller mutants KILLED by `r4_*`. No D-1 bypass: private epoch-stamping sender, apply-time check, non-arming commands cannot arm. The stuck `key()` path releases on return (`ptt.rs:362`, `runtime.rs:783`). Only Info items remain. |
| **F-08** (loopback cannot reach a transmitter) | **NOT VERIFIED** | The code itself is isolated: loopback.rs has no device, file-system, network or process path, and the reviewer's R-2 bypass is now KILLED. But the guard can be fooled with brace literals (finding 2, mutant SURVIVED) and the R-3 device refusal is untested (finding 1, mutant SURVIVED). To close it: the `/dev/null` behaviour test, plus a guard that tokenises and refuses `mod` declarations and `#[macro_use]`. |

Key files: `/home/user/z-30/crates/z30-cli/tests/loopback_isolation.rs`, `/home/user/z-30/crates/z30-cli/src/main.rs`, `/home/user/z-30/crates/z30-engine/src/runtime.rs`, `/home/user/z-30/crates/z30-engine/src/ptt.rs`. The mutant script is `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/mut.py`.
