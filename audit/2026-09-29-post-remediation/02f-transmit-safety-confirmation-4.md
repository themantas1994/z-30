# Fourth transmit-safety confirmation of 3ac5e9c (code as of 6ebb127): F-08 and F-84

**Verdict:** I found no transmit-safety problems in what I ran. Every 02e finding is fixed, and each one's mutant is now killed. **But I did not do part (b), the fresh attempt to get round the guard** (explained below). So:
- **F-84: VERIFIED.**
- **F-08: NOT VERIFIED.** This is not because a mutant survived. It is because the open-ended review you asked for was not carried out.

Validation state is unchanged: **hardware not validated; on-air not validated.**

## How I ran it
- **Read-only on `/home/user/z-30`.** Mutants ran in a new detached worktree, `/tmp/claude-0/mut-v9` at 3ac5e9c, with `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target` and `cargo +1.95 test --release --locked`. No new target directory was created.
- **The harness is the one committed as evidence**, `audit/2026-09-28-remediation/evidence/tx-mutation/mut_v7_auditor.py`. I checked with `diff` that it is byte-identical to my own 02e harness (`scratchpad/v7/mut_v7.py`). I ran a copy of it from the scratchpad with `python3 -I`.
- **Clean-up:**
  - The harness restores the tree after every mutant, and `git status --porcelain` was empty after the run.
  - The worktree has been removed (`git worktree remove`).
  - The older `scratchpad/mutwt` worktree (55a606c) is not mine, and I left it alone.
- **Nothing touched hardware.**
  - Network payloads sit in the harness's `if runs.len() == usize::MAX` branch, which never runs, and name `192.0.2.1:9`.
  - File payloads name `/dev/null`.
  - The N0 test uses fake audio and a fake PTT line.

## (a) Independent check of run 7 (a sample of 9)

| Mutant | Result | Killing test |
|---|---|---|
| S1 turbofish in a macro (`std::net`) | KILLED | `the_software_loopback_reaches_only_an_allowlist_of_crates_and_items` |
| S2 renamed group import in a macro block | KILLED | same |
| S3 group import plus `<T>::` in a macro block | KILLED | same |
| S4 `use std::fs::*` in a macro block | KILLED | same |
| S5 `std::process` with a turbofish in a macro | KILLED | same |
| S6 a value item named like a crate | KILLED | same |
| S9 `cfg_attr` hiding `include_str!` | KILLED | same |
| B5b `audio_loopback.rs` writes through `std::{fs::File}` | KILLED | `the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag` |
| N0 `shutdown` no longer calls `self.ptt.close()` | KILLED | `runtime::tests::f84_shutdown_closes_the_controller_before_its_halt` |

This matches `run7_02e_at_6ebb127.json` on every mutant I sampled. Raw output is in `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/v9/` (`sample.out`, `sample.json`).

**Guarding tests on the unmutated tree at 3ac5e9c: all pass.**
- `z30-engine`: lib 11 (it includes the new f84 test, which I ran by name and saw pass), `safety` 29, `emergency` 1, `dial_provenance` 7, `ptt_release` 11, `tx_runtime` 28, `gate_contract` 15, `ptt_exit_latch` 1.
- `z30-protocol`: `frame_integrity` 2, `round_trip` 6.
- `z30-cli`: bin 27, `loopback_isolation` 5, `loopback_report_target` 3.
- `z30-io`: `callback_alloc` 2.

## Code check of the 6ebb127 fixes
- **`Guard::tokens`** (`crates/z30-cli/tests/loopback_isolation.rs:219-270`) now matches the 02e fix I asked for:
  - `::` is refused unless it sits between two names. That covers `::<`, `::{`, `::*` and `<T>::`.
  - `use`, `extern` and `mod` are refused inside macro tokens, and so is `$`.
  - Every run of path segments is flushed and checked.
- **Path roots** (`:349-357`): only struct, enum, type and trait names bind one, which closes S6.
- **`cfg_attr`** is refused (`:318`), which closes S9.
- **`audio_loopback.rs`** is now parsed, and it fails on any `fs`, `net`, `process`, `File` or `OpenOptions` segment (`:445-453`), which closes B5b.
- S1–S6 and S9 are now in `every_way_round_the_allowlist_a_review_found_is_refused` (`:415-421`).
- The `docs/safety.md` nit (lines 296-302) is fixed. The text now describes the latch and the confirmed-path join as they are.

## (b) Fresh attempt to get round the guard: not done
A safety classifier stopped my response while I was working on this step. Per that instruction I did not go on to write new bypass constructions. I have no KILLED or SURVIVED results for the forms you listed (`matches!` patterns, `write!` targets, `json!` method chains, closures, associated-type projections, imported-trait methods, `impl Trait for` blocks, `const` blocks, nested macros, string-concatenating macros).

This is a gap in this confirmation, not a clean result.

Two ways to close it:
1. Have another reviewer run that bounded exercise.
2. Better, and recommended in 02e finding 1: make the guarantee semantic, so it no longer depends on a syntax-level allowlist that has now needed five rounds. Either:
   - put the software loopback in its own crate with no `z30-io`/`cpal` dependency, and guard its `Cargo.toml`; or
   - add clippy `disallowed-methods`/`disallowed-types` for the entry points of `std::net`, `std::fs`, `std::process` and `std::os`, applied to `loopback.rs`. These lints resolve names, so aliases, globs, macros and trait dispatch cannot hide a call.

Either one would make further token-level searching unnecessary.

Today's `loopback.rs` passes the guard, as the unmutated run shows. As in 02d and 02e, the open question is how strong the regression detector is, not a defect present now.

## Verdict table

| Ledger item | Verdict | Evidence |
|---|---|---|
| **F-84** (shutdown report vs a racing key) | **VERIFIED** | N0 is KILLED by `runtime::tests::f84_shutdown_closes_the_controller_before_its_halt`, which runs and passes on the real code. N3 and N4 were already killed by `ptt_release::f84_*` (02e, and run 7). The latch is SeqCst-correct and cannot block (02e finding 4, unchanged). The docs are corrected. |
| **F-08** (the loopback cannot reach a transmitter) | **NOT VERIFIED** (no survivor; review incomplete) | All 02e findings are closed: S1–S6, S9 and B5b are KILLED, and the guard code matches the requested fix. The fresh bypass attempt in (b) was not performed. To close: a bounded new-bypass review, or the semantic enforcement above. |

## Files
- `/home/user/z-30/crates/z30-cli/tests/loopback_isolation.rs` (lines 219-270, 318, 349-357, 415-421, 445-453)
- `/home/user/z-30/crates/z30-engine/src/runtime.rs` (the f84 test in `mod tests`)
- `/home/user/z-30/docs/safety.md` (lines 296-302)
- `/home/user/z-30/audit/2026-09-28-remediation/evidence/tx-mutation/mut_v7_auditor.py` and `run7_02e_at_6ebb127.json`
- Sample evidence: `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/v9/`

I wrote no report file into the repository. Filing this as `02f` is up to you.
