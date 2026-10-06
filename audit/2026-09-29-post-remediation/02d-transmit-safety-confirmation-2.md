# Transmit-safety confirmation re-review of 7483f17 (F-08, F-83/N-1, F-84/N-2)

**Commit audited:** `7483f1780800` (PR #46, branch `claude/nice-archimedes-epwg4o`). I only read `/home/user/z-30`.
- Mutants ran in a new detached worktree, `/tmp/claude-0/mut-v6`, with `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target` and `cargo +1.95 test --release --locked`.
- The worktree was restored and checked clean after every mutant, and has now been removed (`git worktree remove`).
- Nothing touched hardware. Every network payload sat in a branch that never runs (`if runs.len() == usize::MAX`) and named TEST-NET `192.0.2.1:9`.
- **The branch moved while I worked:** 10b1cc5 (run-5 evidence), then 4fa7b62 ("guard reads raw C strings…", CTO 01c). I re-ran the relevant survivors at 4fa7b62 so you can see what still holds at the tip.

**Verdict: FINDINGS.**
- What now works: the device refusal for the software loopback is tested; the earlier brace-literal and `//`-in-string mutants are killed; and `mod`, `#[path]`, spaced `#[macro_use]`, `cfg` tricks, byte strings, escapes, nested comments, lifetimes and raw identifiers are all handled.
- **F-08 stays NOT VERIFIED.**
  - The hardware loopback's report-target refusal has no test. Its mutants survive at 7483f17 and at 4fa7b62.
  - The allowlist can still be bypassed in rustfmt-stable ways (`extern crate std as Std`, and a `macro_rules!` metavariable inside a path). Both survive at 4fa7b62.
  - At 7483f17 a raw C string (`cr#"…"#`) threw the lexer out of step and hid code. 4fa7b62 fixes this.
- **F-84:** the change is correct by inspection and safe (it cannot key and cannot hang without bound), but it has no test. Both N-2 mutants survive, so it is **NOT VERIFIED** on the auditor's mutation rule.

Validation state is unchanged: **hardware not validated; on-air not validated.**

## What I ran
- **Guarding tests at 7483f17, all passing:**
  - `z30-cli`: `loopback_isolation` 5, `loopback_report_target` 2, bin unit tests 26 (including `report_target_tests`).
  - `z30-engine`: `safety` 29, `emergency` 1, `dial_provenance` 7, `tx_runtime` 28, `gate_contract` 15, `ptt_release` 9, `ptt_exit_latch` 1. `live_runtime` also passed inside every N-mutant run.
  - `z30-protocol`: `frame_integrity` 2, `round_trip` 6.
  - `z30-io`: `callback_alloc` 2.
- **Mutants:** 23 at 7483f17 and 7 at 4fa7b62.
  - CLI mutants ran `-p z30-cli --bin z30 --test loopback_isolation --test loopback_report_target`.
  - Shutdown mutants ran the eight `z30-engine` test binaries listed above.
  - Every SURVIVED mutant was confirmed in its log to have compiled and run every test.
- **rustfmt check:** I ran `rustfmt +1.95` with the repo's `rustfmt.toml` over the surviving bypasses, to see which of them CI's `cargo fmt --check` would rewrite into a form the guard catches.

## Mutation table

| Mutant | 7483f17 | 4fa7b62 | Killing test / note |
|---|---|---|---|
| G1 `let _a = cr#"x"y"#; <std::net connect>; let _b = cr#"p"q"#;` in `run()` | **SURVIVED** | KILLED | `the_software_loopback_reaches_only_an_allowlist_of_crates_and_items` at the tip (N-6 fix) |
| G14 `const D: &CStr = cr#"x"y"#;` last in `mod tests`, then a non-test `fn side_tail(){ cr#"q"r"#; std::net… }` after it, called from `run()` (finding 2's shape) | **SURVIVED** | KILLED | allowlist test at the tip |
| G3 `extern crate std as Std;` plus `Std::net::TcpStream::connect(..)` | **SURVIVED** | **SURVIVED** | none; rustfmt leaves it as is |
| G4 `macro_rules! via { ($M:ident) => { std::$M::TcpStream::connect(..) } }` plus `via!(net)` | **SURVIVED** | **SURVIVED** | none; rustfmt leaves it as is |
| G2 `if … { use std::{net as Net}; Net::TcpStream::connect(..) }` on one line | **SURVIVED** | not re-run (logic unchanged) | none; rustfmt rewrites it to `use std::net as Net;` on its own line, which is caught |
| G5 `std :: net :: TcpStream :: connect(..)` (spaced) | **SURVIVED** | not re-run | none; rustfmt removes the spaces |
| G6 `include ! ("loopback_side_inc.rs");` (space before `!`) | **SURVIVED** | not re-run | none; rustfmt rewrites it to `include!` |
| G7 `r#std::net::…` raw identifier | KILLED | – | allowlist test |
| G8 `b"\"//"` then `std::net` on the same line | KILLED | – | allowlist test |
| G9 `/* a /* b */ c */` then `std::net` | KILLED | – | allowlist test |
| G10 lifetimes `'a`, chars `'\''` and `'"'` around `std::net` | KILLED | – | allowlist test |
| G11 `#[cfg(not(test))] fn side_nt(){std::net…}` | KILLED | – | allowlist test |
| G12 `#[cfg(any(test, not(test)))] mod side_any {…}` | KILLED | – | allowlist test (`mod` check, line 307) |
| G13 `# [macro_use] # [path = "loopback_side_mod.rs"] mod side_mod;` plus `go_side!()` | KILLED | – | allowlist test (`mod` check) |
| B1 Unix device check replaced by `if false` | KILLED | – | `the_software_loopback_refuses_a_character_device_as_its_report_file` |
| B2 early `check_report_target` removed from `--loopback-test` | KILLED | – | same test (its stdout-empty assertion) |
| B3 `check_report_target` returns `Ok(())` | KILLED | – | same test |
| B4 `write_report_file` skips `check_report_target` | **SURVIVED** | **SURVIVED** | none (finding 1) |
| B5 `audio_loopback.rs` back to plain `std::fs::write` | **SURVIVED** | **SURVIVED** | none (finding 1) |
| B9 (tip only) 4fa7b62's new early check in `audio_loopback::run` removed | – | **SURVIVED** | none (finding 1) |
| B6 `is_windows_device_path` returns false | KILLED | – | `report_target_tests::windows_device_names_and_namespace_paths_are_refused_and_ordinary_files_are_not` |
| B7 `#[cfg(windows)]` call to `is_windows_device_path` removed | **SURVIVED** (Linux) | – | none; on Windows CI only clippy's dead-code lint would catch it (finding 4) |
| N1 post-join `retry_release_for` + re-read + early return removed (reverts F-84) | **SURVIVED** | – | none (finding 5) |
| N2 post-join re-read kept, its retry window removed | **SURVIVED** | – | none (finding 5) |

The run-5 evidence cited in the F-08 ledger row ("all killed") re-ran only my previous 02c mutants. None of its mutants touched the hardware loopback's writer or the bypass classes above.

## Findings

**1. High (by the rule that a surviving mutant means an untested guarantee; the hazard behind it is the Low R-3). The hardware loopback's `--out` refusal has no test.**
- Where:
  - `crates/z30-cli/src/audio_loopback.rs:133` (the report write; at 7483f17 it runs before `output.stop()`)
  - `crates/z30-cli/src/main.rs:540-543` (`write_report_file`)
  - at 4fa7b62, also `audio_loopback.rs:77-81`
- Mutants B4, B5 and B9 survive. The commit's "the hardware loopback's report goes through the same writer" rests on inspection only. The CLI source assertion checks main.rs only.
- Sequence: an edit restores `std::fs::write` in audio_loopback.rs, or drops the check from the writer. Then `z30 --audio-loopback-test --confirm-no-transmitter --out /dev/ttyUSB0` runs with a PTT = none configuration while a serial-PTT interface is physically on ttyUSB0. Opening the tty asserts DTR/RTS and keys a radio whose audio input may be that same sound card. Every test passes.
- Fix:
  - Check `--out` **before** `refusal()` (in main.rs, before `audio_loopback::run`, as the software loopback now does).
  - Add a behaviour test: `z30 --audio-loopback-test --out /dev/null --config <temp file with a PTT method configured>`, without `--confirm-no-transmitter`, expecting `/dev/null: not a regular file`.
  - Why that order: if the check is removed, `refusal()` still stops the run before any device is opened, and the message changes, so the test fails safely. At 4fa7b62 the check comes after `refusal()`, so this test could not tell the two apart.
  - Also assert in `loopback_isolation.rs` that `audio_loopback.rs` contains no `std::fs`.

**2. Medium. The allowlist is bypassed by `extern crate … as Upper` and by a macro metavariable in a path (G3, G4). Both survive at 4fa7b62 and are rustfmt-stable.**
- Where: `crates/z30-cli/tests/loopback_isolation.rs:319-334`.
  - Any path rooted at an uppercase identifier passes as a "local type" (line 331).
  - `paths_in` splits at `$`, so `std::$M::TcpStream` yields a dropped `std::` and an uppercase-rooted `M::TcpStream::connect`.
  - `extern crate` is not refused. `extern crate std as Std;` compiles in a non-root module; only the `#[macro_use]` form is root-only (E0468).
- Sequence: a one-line edit to loopback.rs, `Std::net::TcpStream::connect(rigctld)` and then `T 1`, keys a CAT radio from `--loopback-test`. Every test and `cargo fmt --check` pass.
- Fix:
  - Minimum: refuse `extern crate`, `macro_rules!` and `$` in loopback.rs. Admit an uppercase root only if it is declared in the file or imported by a checked `use`.
  - Robust: parse with `syn` (dev-dependency) and walk every path, use tree, macro and extern crate.
  - Alternatively: move the software loopback to its own crate with clippy `disallowed-types`/`disallowed-methods` for `std::net`, `std::fs`, `std::process` and `std::os`. Those lints resolve names semantically, so aliases and macros do not hide anything.

**3. Medium at 7483f17, fixed at 4fa7b62. A raw C string threw the lexer out of step (G1, G14).**
- Where: `loopback_isolation.rs:70-76` at 7483f17. `cr` was not a raw-string prefix, so `cr#"x"y"#` opened a pseudo-string that hid real code.
- G1 hid a `std::net` call inside `run()`. G14 hid an entire non-test function placed after `mod tests` (the 02c finding-2 attack).
- 4fa7b62's N-6 change kills both. No action is left beyond keeping its new test.

**4. Low. Four smaller gaps.**
- (a) G2, G5 and G6 survive the guard. Only CI's `cargo fmt --check` normalises them:
  - `use` is only seen at the start of a line (`use_paths`, lines 241-251);
  - paths are split by whitespace (`paths_in`);
  - `include !` with a space evades `contains("include!")` (line 337).
  - The fix in finding 2 covers all three. Or: join `ident :: ident` across whitespace, find `use` as a token, and match `include\s*!`.
- (b) The Windows refusal call in `check_report_target` (`main.rs:559-564`) has no test on any platform. B7 survives on Linux. On windows-latest, deleting the call is caught only by clippy's dead-code lint, and `let _ = is_windows_device_path(..)` would pass even that. Fix: a `#[cfg(windows)]` behaviour test, `--loopback-test --out NUL`.
- (c) By name, `\??\`-prefixed NT paths whose last component is not a reserved name (e.g. `\??\GLOBALROOT\Device\Serial0`) are not refused. This is exotic; refusing a `\??\` prefix would close it.

**5. Low (a survivor on the F-84 fix). The post-join re-read is untested (N1, N2 survive).**
- The ledger says so too: "none deterministic". A revert passes CI.
- Fix: make the race impossible rather than only reported. `shutdown` would set a controller-scoped "no more keys" latch before `halt()`, checked by `key()` at the same three points as `NO_MORE_KEYS` (`ptt.rs:336-370`). A unit test can pin the latch deterministically, and the re-read stays as defence in depth. Alternatively, add a test-only fault-injection point between the HALT check (`runtime.rs:1031`) and `ptt.key()`.

**6. Info. My judgement of N-2 for transmit safety** (`crates/z30-engine/src/runtime.rs:431-443`).
- **Can it key? No.** `retry_release_for` only calls `request_release_in_background`. After the joins, no runtime thread exists that can call `key()`; background release threads only release.
- **Can the report be wrong? Only in the safe direction.** A background release can confirm after the second read, in which case the report says unconfirmed while the line is in fact released.
- **Can it hang?** It adds at most one 2 s window. Two residual points, both pre-existing in kind and reachable only through the race:
  - (i) **The confirmed-path join can still hang with the line possibly keyed.** If the racing key's `set(true)` wedges after the first read said `Released`, `join` on the control thread never returns and no report is shown. Fix: poll `JoinHandle::is_finished()` within a bound, and treat a control thread that has not finished as unconfirmed.
  - (ii) **The release can be driven on the GUI thread.** On the new unconfirmed-after-join path, the handle usually holds the last `Arc<Shared>`. `return report` then runs `Shared::drop` (`ptt.rs:496-502`), which drives `set(false)` on the calling (GUI) thread. That contradicts the comment "the line is never driven on this thread". It is bounded by one driver call and is a release. Fix: hand the last controller clone to a short-lived thread before returning.

**7. Info. N-1 / F-83, by inspection** (`crates/z30-gui/src/app.rs:314-341`).
- `rt` is `None` only after `take()` on an unconfirmed shutdown in `apply_settings`, or in `on_exit`. `start_runtime` always returns a handle.
- So the "PTT release not confirmed" panel is truthful. No runtime can be started from it, so nothing can key. The close warning fires once, and a second close exits.
- At 7483f17 the close text ("closing now stops z-30 retrying") overclaimed when there was no runtime. 4fa7b62 (N-7) corrects it.

## Verdict table

| Ledger item | Verdict | Evidence |
|---|---|---|
| **F-08** (loopback cannot reach a transmitter) | **NOT VERIFIED** | Killed: B1, B2, B3, B6, G7-G13, and the earlier 02c mutants (run 5). At 4fa7b62, G1 and G14 are killed as well. **Surviving at 4fa7b62:** B4, B5 and B9 (hardware loopback `--out` refusal untested, finding 1), and G3 and G4 (rustfmt-stable allowlist bypasses, finding 2). The loopback code itself is still isolated: no device, file-system, network or process path exists in loopback.rs. To close: the safe-order `--audio-loopback-test --out /dev/null` test, plus a guard that refuses `extern crate`, `macro_rules!`/`$` and unbound uppercase roots (or a `syn`- or clippy-based check). |
| **F-84** (shutdown report after the threads stop) | **NOT VERIFIED** (correct by inspection; untested) | The change cannot key, adds at most 2 s, and can only err towards "unconfirmed" (finding 6). N1 and N2 both SURVIVED; there is no deterministic test. To close: a controller-scoped key latch set by `shutdown` with a unit test, or a fault-injection test, or an explicit board decision to accept inspection for this Low race. |
| **F-83** (GUI with no runtime) | not mine to verify (`cto-code-reviewer`) | By inspection it is safe and truthful (finding 7). The text overclaim is corrected at 4fa7b62. |

## Files
- Code:
  - `/home/user/z-30/crates/z30-cli/tests/loopback_isolation.rs`
  - `/home/user/z-30/crates/z30-cli/tests/loopback_report_target.rs`
  - `/home/user/z-30/crates/z30-cli/src/main.rs`
  - `/home/user/z-30/crates/z30-cli/src/audio_loopback.rs`
  - `/home/user/z-30/crates/z30-engine/src/runtime.rs`
  - `/home/user/z-30/crates/z30-engine/src/ptt.rs`
  - `/home/user/z-30/crates/z30-gui/src/app.rs`
- Mutation evidence, all in `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/v6/`:
  - harness: `mut_v6.py` (`W=<worktree> CARGO_TARGET_DIR=… MUT_OUT=<json> python3 mut_v6.py [IDs]`)
  - results: `results.json` (7483f17) and `results_tip.json` (4fa7b62)
  - per-mutant `*.log` files. The logs for G1, G14, G3, G4, B4 and B5 were overwritten by the tip run; their 7483f17 verdicts are kept in `results.json`.
- My old worktree from the 02c run, `/tmp/claude-0/mut-v5` (at df45d56, clean), is still registered. Remove it with `git worktree remove /tmp/claude-0/mut-v5` if no one needs it.
