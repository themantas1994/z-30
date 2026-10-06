# Third transmit-safety confirmation of 2e06ca6 (code as of ceab48d): F-08 and F-84

**Commit audited:** `2e06ca6` (PR #46, branch `claude/nice-archimedes-epwg4o`). The code is as of `ceab48d`; `2e06ca6` adds only evidence and the ledger. I only read `/home/user/z-30`.
- Mutants ran in a new detached worktree, `/tmp/claude-0/mut-v7`, with `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target` and `cargo +1.95 test --release --locked`. No new target directory was created.
- The worktree was restored and confirmed clean (`git status --porcelain` empty) after every mutant, and has now been removed (`git worktree remove`).
- Nothing touched hardware:
  - every network payload sat in `if runs.len() == usize::MAX { … }`, which never runs, and named TEST-NET `192.0.2.1:9`;
  - file payloads named `/dev/null`;
  - process payloads (`rigctl`) sat in the same branch that never runs.

**Verdict: FINDINGS.**
- **F-08 stays NOT VERIFIED.** The syn guard is a real improvement: every 02d class it was built for is now refused, and so are type aliases, nested fns, `macro_rules!` in a fn body, leading `::` and raw identifiers. But its scan of macro token streams loses a path's prefix whenever `::` is followed by `<`, `{` or `*`. Five one-line edits that reach `std::net`, `std::fs` or `std::process` from `--loopback-test` pass every test, `cargo fmt --check` and `clippy -D warnings`.
- **F-84: the latch is correct, cannot key and cannot block.** But the shutdown call site is untested (N0 survives again). Run 6 says no test can stage the race. That is true, but a test does not need to stage it: the wiring can be tested directly. I wrote such a test in the mutant worktree. It passes on the real code and kills N0. Until it, or an equivalent, lands, F-84 is **NOT VERIFIED** under the mutation rule.

Validation state is unchanged: **hardware not validated; on-air not validated.**

## What I ran
- **Guarding tests at 2e06ca6, all passing:**
  - `z30-cli`: bin unit tests 27, `loopback_isolation` 5, `loopback_report_target` 3.
  - `z30-engine`: `safety` 29, `emergency` 1, `dial_provenance` 7, `ptt_release` 11, `tx_runtime` 28, `gate_contract` 15, `ptt_exit_latch` 1.
  - `z30-protocol`: `frame_integrity` 2, `round_trip` 6.
  - `z30-io`: `callback_alloc` 2.
- **Mutants: 26** (25 run against the code, plus one control run of my proposed test).
  - CLI mutants ran `-p z30-cli --bin z30 --test loopback_isolation --test loopback_report_target`.
  - Engine mutants ran `-p z30-engine --lib --test ptt_release --test tx_runtime --test safety --test emergency`.
  - Every SURVIVED mutant compiled, and its log shows every test binary ran.
- **CI's gates on the survivors:**
  - `rustfmt +1.95` with the repo's `rustfmt.toml` changes only line layout, never the tokens the guard reads.
  - `cargo +1.95 clippy -p z30-cli --all-targets -- -D warnings` is clean on S1–S5 and B5b.
- **Old classes not rebuilt as mutants this round:** 02d G1–G6, G12 and G13. All are encoded in `every_way_round_the_allowlist_a_review_found_is_refused`, which passes at 2e06ca6 (so the guard refuses them), and run 6 killed G1–G6 as real mutants. G7–G11 and G14 were rebuilt.

## Mutation table

| Mutant (in loopback.rs unless stated) | Result | Killing test / note |
|---|---|---|
| **S1** `format!("{:?}", std::net::TcpStream::connect::<&str>("192.0.2.1:9"))` | **SURVIVED** | none; fmt- and clippy-clean (finding 1) |
| **S2** `format!("{}", { use std::net::{Shutdown, TcpStream as Vec}; let _s: Option<Shutdown> = None; Vec::connect(..).is_ok() })` | **SURVIVED** | none; fmt- and clippy-clean |
| **S3** same, with `use std::net::{Shutdown, TcpStream}` and `<TcpStream>::connect(..)`, no rename | **SURVIVED** | none; fmt- and clippy-clean |
| **S4** `format!("{:?}", { use std::fs::*; write("/dev/null", "") })`: the R-3 tty-open hazard | **SURVIVED** | none; fmt- and clippy-clean |
| **S5** `format!("{:?}", std::process::Command::new::<&str>("rigctl").arg("T").arg("1").status())` | **SURVIVED** | none; fmt- and clippy-clean |
| S6 `fn crossbeam_channel() {}` plus `crossbeam_channel::bounded::<u8>(1)`: a value item makes any crate root "bound" | SURVIVED | none; no transmitter is reachable this way today (finding 3a) |
| S9 `#[cfg_attr(all(), doc = include_str!("/dev/null"))]`: attribute token lists are not visited | SURVIVED | tests pass; clippy failed here only because the file was empty. Compile time only (finding 3c) |
| S11 `macro_rules!` inside a fn body | KILLED | `the_software_loopback_reaches_only_an_allowlist_of_crates_and_items` |
| S13 `::std::net::TcpStream::connect` | KILLED | allowlist test |
| S15 `type Side = std::net::TcpStream;` | KILLED | allowlist test |
| S16 nested `fn inner() { use std::net::TcpStream; … }` | KILLED | allowlist test |
| G7 `r#std::net::…` | KILLED | allowlist test |
| G8 `b"\"//"` then `std::net` on the same line | KILLED | allowlist test |
| G9 nested block comment, then `std::net` | KILLED | allowlist test |
| G10 lifetimes and `'\''` / `'"'` around `std::net` | KILLED | allowlist test |
| G11 `#[cfg(not(test))] fn side_nt` | KILLED | allowlist test |
| G14 `cr#"…"#` const in `mod tests`, then a non-test fn after it | KILLED | allowlist test ("last item must be mod tests") |
| B4 `write_report_file` skips `check_report_target` | KILLED | `report_target_tests::the_report_writer_refuses_a_character_device_by_itself` |
| B5 `audio_loopback.rs` uses plain `std::fs::write` | KILLED | `the_cli_runs_the_software_loopback_for_…` (source assertion) |
| B5b `audio_loopback.rs` writes through `use std::{fs::File, io::Write}; File::create(p)…`, with `crate::write_report_file` kept in a branch that never runs | SURVIVED | none; main.rs's early check still refuses devices (finding 3b) |
| B9 the early `--out` check for the hardware loopback removed (main.rs:259-264) | KILLED | `the_hardware_loopback_refuses_a_character_device_as_its_report_file_before_anything_else` |
| **N0** `shutdown` no longer calls `self.ptt.close()` (runtime.rs:420) | **SURVIVED** | none at 2e06ca6 (finding 2) |
| N0K-control: the proposed test added, code unmutated | passes | `runtime::tests::f84_shutdown_closes_the_controller_before_its_halt ... ok` |
| N0K: N0 plus the proposed test | **KILLED** | `runtime::tests::f84_shutdown_closes_the_controller_before_its_halt` |
| N3 `key()` drops the `closed` check before the drive (ptt.rs:362) | KILLED | `ptt_release::f84_a_closed_controller_never_drives_a_key` |
| N4 `key()` drops the `closed` check after the drive (ptt.rs:367) | KILLED | `ptt_release::f84_a_key_in_its_driver_when_the_controller_closes_is_released_before_it_returns` |

## Findings

**1. Medium (blocks F-08). The guard's macro-token scan loses a path's prefix after `::<`, `::{` and `::*`, and a `<T>::` qualified path reads as a single segment. S1–S5 survive every test, rustfmt and clippy.**
- Where: `crates/z30-cli/tests/loopback_isolation.rs:214-250` (`Guard::tokens`).
  - When an ident is followed by `::`, the scanner skips ahead (line 225) and expects another ident.
  - If the next token is a `Punct` (`<`, `*`) or a `Group` (`{…}`), lines 234-243 clear the run **without pushing it**. So `std::net::TcpStream::connect::<&str>` is never checked, and neither is `std::fs::*` or `std::net::{…}`.
  - The group's contents are then checked alone, as single identifiers, which always pass (`check` returns true for fewer than two segments).
  - A name bound by that hidden `use` is either single-segment (`write`, `<TcpStream>`, where `>` breaks the run), or renamed to a prelude root that `check` admits (`Vec`, line 262).
  - Paths outside macros are fine: syn's `visit_path` and `use_tree` see them whole.
- Sequence: one edit to `loopback.rs` reconnects the software loopback to a radio. Any of these works:
  - `format!("{:?}", { use std::fs::*; write("/dev/ttyUSB0", "") })` opens the tty, which asserts DTR/RTS and keys a serial-PTT radio (R-3);
  - `std::net::TcpStream::connect::<&str>(rigctld)` followed by `T 1` keys a CAT radio;
  - `std::process::Command::new::<&str>("rigctl")` runs rigctl.

  Then `z30 --loopback-test` keys a transmitter. Every test, `cargo fmt --check` and `clippy -D warnings` stay green. The deny-list sees none of these names.
- Today's `loopback.rs` is clean. I checked by hand: its macros carry only `json!`/`format!` values and `z30_dsp::DSP_RATE_HZ`. So this is a regression detector that does not detect, not a present defect, the same standing as 02d finding 2.
- Fix, minimum:
  - In `tokens()`, when `ident ::` is followed by anything but an ident, push the run so far (`std::net::TcpStream::connect`, `std::fs`, `std::net`), so it is checked.
  - Refuse the `use` keyword inside macro tokens, and refuse `>` followed by `::`.
  - Add S1–S5 to `every_way_round_the_allowlist_a_review_found_is_refused`.
- Fix, better:
  - Parse the allowlisted macros' arguments with syn: the format/print/assert/vec/matches family as `Punctuated<Expr, Token![,]>` (after the format string), visited by the same `Guard`, and refuse what does not parse.
  - Hold `json!` to the strict token rules above.
- Fix, robust (fifth round of text- or syntax-level bypasses):
  - Move the software loopback into its own crate whose `Cargo.toml` has no `z30-io`/`cpal`, with a guard on that dependency list.
  - Add clippy `disallowed-methods`/`disallowed-types` for the entry points of `std::net`, `std::fs`, `std::process` and `std::os`. Those lints resolve names semantically, so aliases, globs and macros cannot hide a call.

**2. High by the mutation rule (hazard Low). N0 survives, but it can be killed deterministically, so "no test can stage the race" does not justify it.**
- Where: `crates/z30-engine/src/runtime.rs:420`. Deleting `self.ptt.close();` reverts F-84's latch with every test green.
- The latch itself is pinned (N3 and N4 are killed). Only the wiring is untested, and testing the wiring needs no race.
- Killing test, demonstrated: it passes at 2e06ca6 (N0K-control) and fails under N0. It goes in `runtime.rs`'s `#[cfg(test)] mod tests`, with minimal fakes for `AudioInput`, `AudioOutput`, `WallClock` and `LogSink`, plus a `PttLine` that records any `set(true)`; `tx_unavailable` is set. The load-bearing part:
  ```rust
  let mut h = start(Config::default(), RuntimeParts { /* fakes; ptt: Box::new(Line(keyed.clone())) */ });
  let ptt = h.ptt.clone();
  let wd = h.watchdog.take(); // the clone keeps the watchdog alive; joined below instead
  assert!(h.shutdown().release_confirmed());
  assert!(ptt.key().is_err(), "shutdown left its controller able to key");
  assert!(!keyed.load(Ordering::SeqCst), "the line was keyed after shutdown");
  drop(ptt);
  if let Some(w) = wd { let _ = w.join(); }
  ```
  The full text is in `scratchpad/v7/mut_v7.py` (`N0K_TEST`). The watchdog handle must be taken first: with a clone alive, shutdown's confirmed path would join a watchdog that never ends. `NO_MORE_KEYS` is set only in the separate `ptt_exit_latch` binary, so this assertion is not vacuous.
- Is the survivor acceptable as it stands? **No.** The hazard is a Low race, but a one-line deletion silently reverts the fix, and a 40-line deterministic test closes it. Add it (or an equivalent, e.g. a `pub(crate) fn is_closed()` asserted after shutdown).

**3. Low. Three smaller gaps.**
- (a) **A value item makes any crate root "bound"** (S6). `fn crossbeam_channel() {}` (or a lowercase `const`/`static`) puts the name in `bound` (`loopback_isolation.rs:327-335`, used at line 262). But fns and consts live in the value namespace, so `crossbeam_channel::…` still resolves to the crate. Today z30-cli's other dependencies (clap, ctrlc, crossbeam-channel, rayon) reach no transmitter, and `z30_io`/`cpal` are caught by the deny-list's substring match, so nothing is reachable this way. Fix: bind only type-namespace items (struct, enum, type, trait) and checked `use` names as path roots.
- (b) **The hardware loopback's writer is held only by a text assertion** (B5b). `use std::{fs::File, …}; File::create(p)` contains neither `std::fs` nor `fs::write`. The early check in main.rs:259-264 (B9, killed) still refuses devices, so the hazard needs a second edit, and that second edit is caught. Fix (optional): assert that `audio_loopback.rs` contains no `fs` path segment at all, or apply the syn guard to it with its own allowlist.
- (c) **Attribute token lists are not visited** (S9). `visit_attribute` checks only `path` and `macro_use`; a `cfg_attr(…)` list's tokens (`include_str!`, `doc = …`) are never seen. This runs only at compile time, on the build machine. Fix: refuse `cfg_attr` in `loopback.rs`, or run `tokens()` over `Meta::List` contents.

**4. Info. My judgement of the F-84 latch** (`ptt.rs:357-372`, `runtime.rs:412-465`).
- **SeqCst argument (correct).** Every write to `state` and `closed` is SeqCst.
  - In `key()`: the CAS RELEASED→KEYED (or an already-KEYED state), then the line lock, then `state == KEYED`, then a load of `closed`.
  - If that load reads `false`, it precedes `close()`'s store in the single total order. So the CAS precedes it too, and every later read of the state by shutdown (`halt`, `retry_release_for`, `report`) sees KEYED or a later state.
  - That later state can only be a release confirmed under the line lock. The key holds the lock until after its post-drive check, which re-reads `closed` and releases if it is now set.
  - If the load reads `true`, the key is refused and the line is never driven true.
  - Consequences:
    - A key that starts after `close` cannot key.
    - A key that started before it is seen by shutdown, which then takes the unconfirmed path.
    - A refused key's transient KEYED state can only make the report err toward "not confirmed".
    - On the confirmed path no key can be wedged in `set(true)`, which also closes 02d finding 6(i).
- **Blocking and deadlock: none.** `close()` is one atomic store with no lock. The new checks in `key()` run under the line lock `key()` already holds, and `release_locked` is the existing pattern there.
- **`drop_elsewhere`: correct.** `RuntimeHandle` has no `Drop` impl, so `drop(self)` only detaches handles and closes channels. The last controller is dropped on `z30-ptt-last-drop`, which closes 02d finding 6(ii). One residue: if `spawn` fails, the closure is dropped inside `spawn` on the caller's thread, which drives one release there. That is rare, bounded by one driver call, and it is a release. On the unconfirmed path a wedged control thread usually still holds a clone, so the last drop happens there anyway.
- **Doc nit:** `docs/safety.md:297` says the confirmed-path join can wait on "a control thread stuck in a key's driver". With the latch, that thread can only be in a refused key's release driver. The text overstates the delay, which is the safe direction.

## Verdict table

| Ledger item | Verdict | Evidence |
|---|---|---|
| **F-08** (loopback cannot reach a transmitter) | **NOT VERIFIED** | Killed: B4, B5, B9, G7–G11, G14, S11, S13, S15, S16. G1–G6, G12 and G13 are refused by the encoded attack list (and were run-6 mutants). **SURVIVED:** S1–S5, rustfmt- and clippy-stable macro-token bypasses reaching `std::net`, `std::fs` and `std::process` (finding 1). Low gaps S6, S9 and B5b (finding 3). The report-target half of F-08 (finding 1 of 02d) is now tested and closed. To close: fix `tokens()` (or parse macro arguments with syn, or use a separate crate with clippy disallowed lists) and add S1–S5 to the attack list. |
| **F-84** (shutdown report vs a racing key) | **NOT VERIFIED** (correct and safe by inspection; the latch is pinned; the call site is untested) | N3 and N4 KILLED by `ptt_release::f84_*`. N0 SURVIVED. N0K demonstrates a deterministic test that kills N0 and passes on the real code. To close: land that test (finding 2). No board waiver is needed, since the test is cheap. |

## Files
- Code:
  - `/home/user/z-30/crates/z30-cli/tests/loopback_isolation.rs` (lines 214-250, 262, 292, 327-335)
  - `/home/user/z-30/crates/z30-cli/src/main.rs` (lines 247, 259-264, 550)
  - `/home/user/z-30/crates/z30-cli/src/audio_loopback.rs` (line 133)
  - `/home/user/z-30/crates/z30-engine/src/ptt.rs` (lines 357-372, 389-397)
  - `/home/user/z-30/crates/z30-engine/src/runtime.rs` (lines 412-465)
  - `/home/user/z-30/docs/safety.md` (line 297)
- Mutation evidence, all in `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/v7/`:
  - harness: `mut_v7.py` (`W=<worktree> CARGO_TARGET_DIR=… MUT_OUT=<json> python3 mut_v7.py [IDs]`; includes the N0K test text)
  - results: `results.json`
  - logs: per-mutant `*.log`, and `clippy_*.log` from `clippy_survivors.py`
  - rustfmt check copies: `fmt/`
- Worktree `/tmp/claude-0/mut-v7` has been removed. An older detached worktree, `…/scratchpad/mutwt` (at 55a606c), is still registered. It is not from this run, and I left it alone.
