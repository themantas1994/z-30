# CTO code review, focused re-review (docs/research-process.md §3): PR themantas1994/z-30#46, F-83 / F-84

**Verdict: READY FOR BOARD** for the F-83 and F-84 scope. Both earlier findings are fixed: N-1 is ledger row F-83 and N-2 is F-84. I found two new Low findings. One is in the F-08 loopback guard, which the transmit-safety auditor owns. The other is the wording of one GUI warning. Neither can key the radio.

## What was reviewed

- **Branch:** `claude/nice-archimedes-epwg4o`.
- **Head:** `7483f1780800d691db3eb4c6f92971e10689bf4d`.
- **Base:** `5e23c9bb73dd52074f8a1c53d9220f9f9d125d5b`. This is `7483f17^`, the commit my earlier report 01b was written against.
- **Diff read:** all of `git diff 5e23c9b..7483f17`: 9 files, +555/−59.
- **Commits after 7483f17 (not reviewed):** the branch has moved on to `10b1cc5`. The new commits are 4cf3021 (ledger), 2a5ec51 (F-34 harness) and 10b1cc5 (mutation run 5). They are outside this review.
- **Build location:** a detached worktree at `/tmp/claude-0/cto-rr3`, with `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target`. I have removed the worktree; I created no new target directory.
- **What I did not do:** open any hardware, edit `/home/user/z-30`, push or merge.

## Gates

All three ran on Rust 1.95 at 7483f17.

| Gate | Command | Exit code |
|---|---|---|
| fmt | `cargo +1.95 fmt --all --check` | 0 |
| clippy | `cargo +1.95 clippy --workspace --all-targets --exclude z30-py --locked -- -D warnings` | 0 |
| test | `cargo +1.95 test --workspace --exclude z30-py --release --locked` | 0 (265 passed, 0 failed, 2 ignored, 40 test binaries) |

- **Test count:** 265 is the 261 passed at 5e23c9b plus four new tests. The extra binary is `loopback_report_target`.
- **The new tests, which all passed:**
  - `report_target_tests::windows_device_names_and_namespace_paths_are_refused_and_ordinary_files_are_not`
  - `literals_and_comments_cannot_hide_code_from_the_guard`
  - `the_software_loopback_refuses_a_character_device_as_its_report_file`
  - `the_software_loopback_writes_its_report_to_a_regular_file`
- **Existing tests still passing:** `m2_shutdown_*`, `r4_shutdown_*` and all three `loopback_isolation` tests.
- **Logs:** `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/cto-rr3/{gates.txt,fmt.log,clippy.log,test.log}`.

## 1. The two earlier findings

### N-1 / F-83 (blank GUI window after an unconfirmed shutdown): FIXED

- **New screen.** When there is no runtime, `ui()` now draws a `CentralPanel` before returning (`crates/z30-gui/src/app.rs:326-341`). It shows a red heading, "z-30 stopped: PTT release not confirmed", an instruction, and the whole message log, which includes the red "PTT release NOT confirmed when the station stopped (…)" line pushed by `apply_settings`.
- **This screen appears only after an unconfirmed shutdown.** `rt` is `None` only on that path: `App::new` always sets `Some`, and `apply_settings` (app.rs:271-289) leaves it `None` only when the report is unconfirmed.
- **Closing the window.** The close guard (app.rs:315-325) now uses `is_none_or`, so with no runtime the first close is cancelled with a warning.
  - The reset at app.rs:311 needs `Some(rt)` that is `Released`. So with no runtime, `close_warned` stays set and the second close exits: the window warns once.
- **MSRV:** `is_none_or` is stable since 1.82.
- **Two gaps from 01b that remain, both Info:**
  - `on_exit` (app.rs:652-665) still prints nothing to stderr in this state, because `rt` is already `None`. The operator has seen the warning in the window, so this is acceptable.
  - The optional "Release PTT" button was not added.

### N-2 / F-84 (on the confirmed path, the report was read before the threads stopped): FIXED

- **What changed** (`crates/z30-engine/src/runtime.rs:412-449`). After the joins (431-433), `shutdown` runs `retry_release_for` again with a second 2 s window (438) and rebuilds the report from `self.ptt` (439).
  - If the line is now unconfirmed, it detaches the watchdog and returns that report (440-443).
  - Otherwise it drops `self` and joins the watchdog as before.
- **The race from 01b is closed.** In that race the control thread keys after the first read, then exits with a refused, unchecked `unkey()`. That leaves the controller `ReleasePending`, and the second read, made after every runtime thread has been joined, now sees it.
- **No extra wait when nothing is wrong.** `retry_release_for` (455-464) returns at once when the line is `Released`, and `request_release_in_background` spawns nothing in that state. The normal confirmed shutdown is therefore unchanged in time.
- **The refactor keeps the old behaviour.** The 20 ms poll, the 200 ms re-request and the `ShutdownReport` fields are as before. The unconfirmed early return at 422-430 is unchanged, so `r4_*` still covers it.
- **After an unconfirmed second read, nothing retries.** The runtime threads are already joined, and dropping `self` lets `Shared::drop` try once more, then the watchdog ends. The amended doc comment on `ShutdownReport::ptt` (runtime.rs:386-389) says exactly this ("nothing retries after that").

## 2. Blocking, panics, test changes, docs

### Blocking

- **Extra wait on the GUI thread.** The second window adds at most 2 s to `shutdown` on that thread, and only when the line ended unconfirmed after the joins.
- **The joins on the confirmed path are still unbounded.** This was N-3 in 01b and is correctly stated in `docs/safety.md:289-291`.
- **One inaccurate phrase in the docs.** docs/safety.md says the joins are safe because "the line is already released". In the N-2 race that is not strictly true: a control thread stuck in `key()`'s driver would hold `join` for as long as the driver hangs. The watchdog and the HALT flag still prevent audio from starting. The window is a few microseconds and also needs a wedged driver, so this is Info only.
- **Comment wording.** The comment "Bounded by the window alone" (runtime.rs:413) now describes only the unconfirmed path. This is Info, the same point as N-3.

### Panics

- **Runtime threads:** the new runtime code adds no `unwrap`, `expect` or indexing.
- **`is_windows_device_path`:** it uses `unwrap_or` on `rsplit` and `split`, which cannot panic.
- **`blank_non_code`:** it indexes `c[i + 3..]` and `c[i + k + 1..]`. These could panic only on malformed source, and the function runs in tests only.
- **No `unsafe` and no allocation in the audio callback:** `callback_alloc` passes, and the callback was not touched.
- **No receive-path or determinism change.**

### Test changes, each judged against AGENTS.md §4

| Test | Change | Guarantee |
|---|---|---|
| `loopback_isolation.rs` `code_of` | It used to strip `//` comments by line. It now blanks comments (nested `/* */` included), strings, raw strings and char literals, and keeps lifetimes. | Stronger: a `//` inside a string no longer hides the rest of the line, and brace literals no longer upset the `mod tests` brace count. Names inside string literals no longer match FORBIDDEN, but a string cannot reach a device, so the guarantee is equal there. |
| `non_test_code` | The same checks as before, moved into a function that returns `Err`, then `panic!` at the call site. | Equal |
| New `mod`, `#[macro_use]` and `#[path]` refusals | Added. | Stronger. One gap: they match `#[path` / `#[macro_use` exactly, so `#[ path …]` with a space would pass. That is harmless, because any `mod` outside `mod tests` is refused anyway. |
| `literals_and_comments_cannot_hide_code_from_the_guard` | New. It replays both of the confirmation review's surviving mutants as source text. | Stronger |
| `loopback_report_target.rs` | New. It runs the binary against `/dev/null` (must be refused, with empty stdout, i.e. before the test runs) and against a regular file (must be written). | Stronger; it kills the `if false` mutant |
| `report_target_tests` | New, a pure test of the name matching, so it runs on every CI OS. | Stronger |

No test was weakened. No assertion, threshold, `#[ignore]` or `cfg` was relaxed.

### Docs

- **`docs/safety.md:284-297` agrees with the code** on the second window, the unbounded joins (with the caveat above) and the new screen.
- **wiki/14:104-105** (close refused once) still holds.

### House rules

- **Commit message:** conventional (`fix(tx):`).
- **Comments:** they explain why, naming the failure (R-3, N-1, N-2, findings 1-4).
- **Artifacts and MSRV:** no build artifacts committed. `repeat_n` and `is_none_or` are within the 1.95 MSRV.

## Findings

```
[Low] N-6: the loopback guard's lexer does not recognise raw C strings (cr"..."), so code after one can be hidden from the allowlist
  where:    crates/z30-cli/tests/loopback_isolation.rs:71 (the raw-string branch only accepts `r` or `br`, and `ident_before` rejects the `r` of `cr`); :89 (the ordinary-string branch then treats `\"` as an escape)
  evidence: I copied blank_non_code and paths_in verbatim into a scratch program. For
              fn run() { let _ = cr"\"; std::net::TcpStream::connect(x); let _ = ""; }
            paths_in(blank_non_code(..)) returns [], so std::net is not seen. With br"\" in place of cr"\" it returns ["std::net::TcpStream::connect"]. The snippet compiles on rustc 1.95, edition 2021: C-string literals are stable since 1.77.
            (scratchpad/cto-rr3/lex/lex.rs and c.rs)
  why:      AGENTS §4 "Loopback never transmits"; F-08. The commit claims the guard "reads code only", and this is the same class of hole as the confirmation review's finding 3. It needs a deliberate, unusual literal, so it is Low. It belongs to F-08, not to F-83 or F-84.
  fix:      Accept an optional `c` as well as `b` before `r` in the raw-string branch (and leave c"..." to the ordinary-string branch, which already handles it). Add `cr"\"` followed by a std::net call to literals_and_comments_cannot_hide_code_from_the_guard.

[Low] N-7: once the runtime is gone, the close warning says closing "stops z-30 retrying the release", which may no longer be true
  where:    crates/z30-gui/src/app.rs:315-324 (the warning text), reached by the new is_none_or at :317
  evidence: With rt = None the runtime is already stopped. The new screen even says "z-30 stopped". After F-84's post-join path returns unconfirmed, nothing retries at all: every thread has been joined and the handle dropped. After the first-window path, only a thread wedged in the driver keeps the watchdog alive. The same message, written for the running case, claims a retry that may not exist. wiki/13:29 ("z-30 keeps retrying the release") describes the running station, not this state.
  why:      AGENTS §4 "Honest values". The operator is told something is still protecting the line when it may not be. Closing is still refused once, and the radio is still flagged as possibly keyed, so the safety effect is small.
  fix:      When rt is None, push a separate message, e.g. "z-30 has stopped and the PTT release was NOT confirmed: the radio may still be keyed. Check it; close again to exit." Optionally print the same to stderr in on_exit when rt is None.

[Info] N-8: the F-84 re-read and the F-83 screen have no test
  evidence: tx_runtime.rs is unchanged in 7483f17. Deleting the second retry_release_for and report (runtime.rs:434-443) would, by inspection, pass every test, because the race is not reproduced deterministically. The GUI has no harness; docs/safety.md:297 says so. Both fixes are verified here by reading the code only.

[Info] N-9: docs/safety.md:289-290 justifies the unbounded join with "the line is already released"; in the N-2 race a control thread stuck in key()'s driver can hold that join. runtime.rs:413 "Bounded by the window alone" holds only on the unconfirmed path (same point as N-3 in 01b).

[Info] N-10: the --out refusal is not in the operator or developer docs
  evidence: wiki/15:21-22 and docs/hardware-validation.md:43 show `--out` with no mention that devices (and, on Windows, reserved device names) are refused. docs/safety.md §"Loopback tests cannot become transmissions" (113-127) does not mention R-3. There is no contradiction, only a gap.

[Info] N-11: --audio-loopback-test checks its --out target only after the test has played through the sound card
  where:    crates/z30-cli/src/audio_loopback.rs:133 (write_report_file at the end), compared with main.rs:247 (the pre-check, which only the software loopback has)
  evidence: A device target is still refused, so this is safe; it just fails late. Not tested on Windows here: is_windows_device_path (main.rs:572-581) takes the name after the last separator, so a drive-relative "C:COM3" is not matched. Whether Win32 treats that as the device was not checked on a Windows host.
```

## Verdicts

| Row | Verdict | Evidence |
|---|---|---|
| F-83 | **VERIFIED** | `ui()` no longer returns before drawing when `rt` is `None`: it shows the red heading and the message log, including the "PTT release NOT confirmed when the station stopped" line (app.rs:326-341). The close guard warns once in that state and the second close exits (app.rs:311, 315-325). `rt` is `None` only after the unconfirmed shutdown in `apply_settings` (app.rs:271-284). docs/safety.md:294-296 agrees. Checked by reading the code only (there is no GUI harness). The N-7 wording should be fixed but does not reopen the row. |
| F-84 | **VERIFIED** | On the confirmed path, `shutdown` now re-reads the controller after every runtime thread is joined, retries for a second 2 s window, and returns the unconfirmed report if the line is not `Released` (runtime.rs:431-443). That closes the race in which a refused, unchecked `unkey()` on the control thread's way out was reported as confirmed. The unconfirmed early return is unchanged, and `r4_*` and `m2_*` pass. docs/safety.md:289-292 agrees. The fix has no deterministic test (N-8) and was checked by reading the code. |

Hardware and on-air validation are unchanged: **hardware not validated; on-air not validated.**

I removed the worktree `/tmp/claude-0/cto-rr3` (`git worktree remove`). `/home/user/z-30` is untouched.
