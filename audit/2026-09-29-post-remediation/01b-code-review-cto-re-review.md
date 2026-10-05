# CTO code review, focused re-review (docs/research-process.md §3): PR themantas1994/z-30#46, F-01 / F-16

**Verdict: READY FOR BOARD** for the F-01 and F-16 scope. All four of the original findings are closed: M-1, M-2, M-3 and L-1. Two new Low findings remain. They are narrow races, they can be tracked, and neither lets the station key.

## What was reviewed

- **Branch:** `claude/nice-archimedes-epwg4o`.
- **HEAD:** `5e23c9bb73dd52074f8a1c53d9220f9f9d125d5b`.
- **Base for this re-review:** `ee42ae6`, the commit my earlier report was written against.
- **Diff read:** `git diff ee42ae6..HEAD -- crates/` (23 files, +1062/−101), with the messages of ea6dd69, d159e6d and df45d56.
- **Supporting material:**
  - `audit/2026-09-29-post-remediation/02-transmit-safety.md` and `02b-transmit-safety-re-review.md`
  - `audit/2026-09-28-remediation/evidence/tx-mutation/README.md` (run 4 at d159e6d: 119 mutants, 111 killed)
  - the ledger rows F-01, F-04, F-16 and F-22

I did not open any hardware, edit any repository file, push or merge.

## Gates

All three ran on Rust 1.95 in a detached worktree at HEAD (`/tmp/claude-0/review-cto2/wt`).

| Gate | Command | Exit code |
|---|---|---|
| fmt | `cargo +1.95 fmt --all --check` | 0 |
| clippy | `cargo +1.95 clippy --workspace --all-targets --exclude z30-py --locked -- -D warnings` | 0 |
| test | `cargo +1.95 test --workspace --exclude z30-py --release --locked` | 0 (261 passed, 0 failed, 2 ignored, 39 test binaries) |

How the test gate was run:
- The first attempt failed with "No space left on device" while compiling libsqlite3-sys. The disk had 25 MB free, so that run proves nothing either way.
- I deleted my own partial target directory. I then pointed `CARGO_TARGET_DIR=/tmp/claude-0/review-cto2/target` at a hard-linked copy (`cp -al`) of the earlier CTO review's build cache, `/tmp/claude-0/review-cto-target`, and re-ran.
- That cache is a build cache only, so this does not change what is compiled. Because the files are hard-linked, the old cache may have been partly overwritten. The disk is now at 97% (1.2 GB free).

Every new safety test ran and passed in the test gate: `rt_halt_*` (6), `rt_halt_after_an_output_recovery_*`, `rt_halt_does_not_wait_for_a_slow_release_driver`, `m2_shutdown_*`, `r4_shutdown_*`, `d1_*`, `t2_*`, `l5_*` (2), `gate_contract::r1_*`, `ptt_exit_latch::d2_*`, and the rigctld `f17_*`, `d6_*` and `m2_a_rigctld_*` tests.

## 1. Whether the earlier findings are closed

**M-1 (HALT flushed a dead output after a recovery): CLOSED.**
- The fix: HALT's stop now lives in a shared `StopperSlot` (runtime.rs:325). The control thread replaces it right after a successful `recover()` (runtime.rs:941), and `halt()` reads the current one (runtime.rs:467).
- The new value is computed before the lock is taken (Rust evaluates the right-hand side of an assignment first), and `current_stopper` releases the lock before the stop is called. So no lock is ever held across a call.
- If a recovered stream fails again at once, the stopper is not replaced. That is safe: `output_failed` stays set and the gate refuses to transmit.
- The test's fake now behaves like cpal. Each `recover` bumps a `generation`, and a stop from an earlier generation does nothing. `rt_halt_after_an_output_recovery_still_silences_the_live_output_from_the_calling_thread` checks, inside `halt()` itself, that the live stream was stopped.

**M-2 (a pending release abandoned on shutdown, settings change, exit or SIGTERM): CLOSED**, with one residual reporting gap (N-1 below).
- **Shutdown:**
  - `shutdown()` retries the release for 2 s and returns a `#[must_use] ShutdownReport`.
  - The GUI refuses audio, PTT or rig changes while the line is keyed or pending (app.rs:258).
  - It does not restart the runtime after an unconfirmed shutdown, and refuses the first window close (app.rs:313).
  - `on_exit` and the CLI station print the report to stderr.
- **Signal handler:** it calls `refuse_further_keys()`, then retries the release about 10 times over roughly 1 s, then prints a failure.
- **CAT PTT:** `RigctldPtt::connect` now sends `T 0` and fails if that is refused.
- **docs/safety.md:283-296** describes all of this as the code does it.

**M-3 (the ledger cited a surviving mutant as evidence): CLOSED.**
- The F-01 and F-04 rows now record RT-relfault as "SURVIVED, equivalent: check_hardware re-detects ReleasePending". F-22 records G-plan as "SURVIVED, equivalent".
- The run-4 README records RT-relfault being killed together with A-CHK-pending in the auditor's A-COMBO run.

**L-1 (HALT drove the PTT line on the GUI thread): CLOSED.**
- `halt()` and `emergency_unkey()` now call `request_release_in_background()` (ptt.rs:388). The release runs on a short-lived thread; it is driven on the caller only if no thread can be spawned.
- Nothing in the GUI or CLI calls `request_release_now` or `unkey` any more.
- `rt_halt_does_not_wait_for_a_slow_release_driver` uses a 600 ms release driver and checks that `halt()` returns in under 100 ms.
- The release now becomes `ReleasePending` on the background thread rather than inside `halt()`. Every interleaving with a `key()` that is still in its driver still ends released:
  - If the background thread gets the line lock first, it releases.
  - If it does not, it marks the state pending, and `key()`'s check after the driver returns (ptt.rs:362) sends the release.

## 2. Blocking, panics and test changes

**Blocking:**
- `halt()` only bumps an atomic, swaps a flag, clones an `Arc` under a lock that is never held across a call, calls the stopper, and spawns a thread. None of this waits for I/O.
- The epoch check and the new event on the control thread allocate only off the audio callback.
- The audio callback itself is not touched (`callback_alloc` passes).
- `shutdown()` is bounded by its 2 s window only when the release is unconfirmed (see N-3).

**Panics:** nothing reachable from the control, audio or watchdog threads can panic.
- Locks recover from poisoning (`unwrap_or_else(|p| p.into_inner())`).
- A failed thread spawn is handled.
- Every new `unwrap` or `expect` is in tests or `build_support`.
- No `unsafe` was added. No new nondeterminism reaches `decode_slot`; the only DSP change is to tests and a doc comment.

**Test changes since ee42ae6, each judged against AGENTS.md §4:**

| Test | Change | Guarantee |
|---|---|---|
| `tx_runtime.rs` fakes | `NoAudioIn` became `AudioIn`, which is empty by default and so behaves the same. `release_takes_real_ms` defaults to 0. `fail_releases` is now `if !keyed && …`, the same condition as the old `else if`. `Drop` now does `let _ = rt.shutdown()`. | Equal |
| `tx_runtime.rs` `Out::generation` | A stop from before a recovery now does nothing, as with cpal. | Stronger (catches M-1) |
| `tx_runtime.rs` new tests (m2, r4, d1, t2, l5, L-1) | Added; no existing assertion was changed. | Stronger |
| `dial_provenance.rs`, `live_runtime.rs` | `handle.shutdown()` became `assert!(handle.shutdown().release_confirmed())`. | Stronger |
| `rigctld::f17_*` | Now uses the fake rigctld. It still checks that the connection opens at creation and that a missing rigctld is an error at start-up, and adds that `T 0` is sent before the first `T 1`. | Stronger |
| `loopback_isolation.rs` | `std` is admitted only by listed sub-path (no `std::fs`, `std::net` or `std::process`). Grouped imports are expanded. Exactly one `#[cfg(test)]` is allowed, a final `mod tests` that runs to the end of the file. `include!` and its variants are refused. The `main.rs` assertion follows the new call and also checks the device-refusing writer. | Stronger |
| `gate_contract.rs` | r1, t3 and l5 tests added. | Stronger |
| `ptt_exit_latch.rs` | New, in its own binary. | Stronger |
| `bandplan`, `runtime` lib tests | The 60 m tolerance and the lateness limits are now pinned as numbers. | Stronger |
| `wallclock` l4, `audio` twins, `migrate` f21 | New. | Stronger |
| `ap_production.rs` (DSP) | More frames; plain decodes must exist; AP attempt counts are asserted; a busy-band test is added. | Stronger (the DSP reviewer owns it) |
| `build_support` | The instrument identity now covers all of `z30-protocol`, and a test pins it. | Stronger |

No test was weakened.

## 3. R-4: shutdown returns without joining the threads when the release is unconfirmed

**Can a control thread that is still running key anything after `stop` is set? No.**

1. **`key()` refuses while the release is pending.** When the report is unconfirmed, the controller is in `ReleasePending`, and `key()`'s compare-and-swap from `RELEASED` (ptt.rs:338) refuses without touching the line.
2. **It only becomes `Released` again when a wedged driver returns.** That happens on whichever thread holds the line:
   - If that thread is the control thread in `key()`, the check after the driver returns sees that the state is not `KEYED`. It releases and returns `Err`, and no audio starts.
   - If the control thread was wedged anywhere else in the same loop pass as the HALT, the `halt.load` checks before Key and StartAudio (runtime.rs:1009, 1034) still see the flag, which `check_halt` has not yet cleared.
   - If `check_halt` had already run, the engine is disarmed by `HaltTx` and the plan is cleared, so no Key action can come up.
3. **Nothing new can be queued.** Arming commands queued before the HALT are dropped by their epoch. No new commands can arrive, because `shutdown(self)` consumed the handle.
4. **The loop exits before doing anything else.** It checks `stop` before `check_halt` or `select`. On exit it calls `output.stop()` and then `unkey()` (runtime.rs:782-783).

What still happens on the detached threads, all of it acceptable:
- The watchdog keeps retrying for as long as a wedged thread keeps the controller alive.
- When the last reference is dropped, `Drop for Shared` tries the release once more.
- If the line refuses promptly instead of hanging, everything stops within one tick. `ShutdownReport::ptt`'s doc comment says exactly that ("nothing in this runtime is retrying any more").
- The rig and DSP threads stop at their next check of `stop`.

**Is it acceptable for the GUI to start nothing new? Yes.** It fails closed:
- A new runtime would start a fresh controller in `Released` over a line that may be stuck.
- It would also contend with a thread that may still hold the serial or CM108 device.

The defect is in how that state is shown to the operator (N-1).

## Findings

```
[Low] N-1: after an unconfirmed shutdown in apply_settings, the GUI shows a blank window and the red "NOT confirmed" message is never rendered
  where:    crates/z30-gui/src/app.rs:271-283 (rt taken, message pushed, return with self.rt = None); app.rs:325 (`let Some(snap) = self.snapshot() else { return };` in ui())
  evidence: snapshot() is `self.rt.as_ref().map(..)`. With rt = None, ui() returns before drawing any panel, so self.messages, including the new red message, is never shown. No HALT button and no further Apply are possible (apply_settings:252 returns too). The close warning does not fire either (it requires rt to be Some), and on_exit prints nothing because rt is already None. The commit says the GUI behaviour was checked "by inspection".
  why:      AGENTS §4 / F-01: an unconfirmed release "is reported". On this path the operator sees an empty window, not the warning. Reaching it takes a race: apply_settings refuses while the line is keyed or pending, so the state has to change to keyed after that check (a key racing halt()) and the release then has to fail.
  fix:      When rt is None, still draw the message panel (move the messages panel above the snapshot early return, or draw a minimal panel). Optionally add a "Release PTT" button that calls z30_engine::ptt::emergency_release_all(), so a line kept alive by a wedged thread can still be retried from the window.

[Low] N-2: on the confirmed path the ShutdownReport is read before the threads stop, so a refused final unkey on the control thread is not reported
  where:    crates/z30-engine/src/runtime.rs:426-431 (report built, then stop set), 441-449 (joins, drop(self)), 783 (control thread exit `let _ = control.ptt.unkey();`), 1009-1012 (Key: halt.load, then ptt.key())
  evidence: Suppose the control thread passes the halt.load check at :1009 just before halt() sets the flag, and its compare-and-swap to KEYED lands after shutdown's loop has read `Released`. The report then says confirmed. The control thread keys, sees halt, and exits on `stop` with an unkey whose result is ignored. If that unkey is refused, the controller is ReleasePending while the report said Released. Shared::drop tries once more, then the watchdog ends.
  why:      F-01 "reported"; the window is a few microseconds and needs a refusing line, so this is Low.
  fix:      On the confirmed path, rebuild the report from self.ptt after the joins and before drop(self). If it is no longer Released, return that state.

[Info] N-3: df45d56's title says "shutdown is bounded by its window alone", which holds only when the release is unconfirmed
  where:    runtime.rs:441-449
  evidence: When the release is confirmed, shutdown joins the DSP, decode, rig, log and control threads with no bound: a decode in progress, rigctld's timeouts, an unbounded DNS lookup. docs/safety.md:285-288 states the bound correctly. This is not a transmit-safety issue, because the line is already released.

[Info] N-4: df45d56's shutdown rewrite has no mutation run behind it
  evidence: Run 4 was at d159e6d, before the background retries and the skipped joins. Those are covered by the m2_* and r4_* tests only. A-SH-nohalt is still recorded as a Low survivor.

[Info] N-5: gate_contract::r1_* pins the arms_transmission() list against itself
  evidence: That UpdateConfig and SetDial cannot arm a transmission follows from the code (engine.rs:227-243: both return halt_tx()), not from that test. I confirmed it by inspection.
```

## Verdicts

| Row | Verdict | Evidence |
|---|---|---|
| F-01 | **VERIFIED** | M-2 is fixed: `shutdown()` retries for 2 s and returns `ShutdownReport` (runtime.rs:380-450). GUI refusals are at app.rs:258 and 313, the stderr report at app.rs:637-647, the signal retry and exit latch at z30-gui/src/main.rs:35-48 and ptt.rs:257-268, and CAT `T 0` at open at rigctld.rs:93-101. Passing tests: `m2_shutdown_*`, `r4_shutdown_*`, `ptt_exit_latch::d2_*`, `rigctld::f17_*`, `m2_a_rigctld_*`, `d6_*`, plus the earlier `ptt_release::f01_*`, `ptt_panic::*` and `rt_an_unconfirmed_release_*`. M-3 is corrected in the ledger. No path keys after an unconfirmed shutdown (§3). N-1 and N-2 are Low reporting gaps reachable only through races, and should be tracked. |
| F-16 | **VERIFIED** | M-1 is fixed (`StopperSlot`, refreshed at runtime.rs:941; the test fails on the old code because of the generation-aware fake). L-1 is fixed (`request_release_in_background`; `rt_halt_does_not_wait_for_a_slow_release_driver`). D-1 is fixed: commands carry the HALT epoch, which halt() bumps before raising the flag, and arming commands from before it are dropped (runtime.rs:734-747; `d1_*` covers Tune, CQ and Enable TX; `r1_*` pins Answer). All six `rt_halt_*` tests pass in the release gate. HALT does no blocking I/O and takes no lock across a call. |

Hardware and on-air validation are unchanged: **not validated**.

The detached worktree is still at `/tmp/claude-0/review-cto2/wt`, registered in `/home/user/z-30/.git/worktrees`; remove it with `git worktree remove` when you are done. Logs are in `/tmp/claude-0/review-cto2/`: `gates.log` and `test2.log`.
