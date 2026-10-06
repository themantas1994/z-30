# Final remediation audit: the 2026-09-28 agent-team review (F-01…F-84)

| | |
| :--- | :--- |
| Repository | themantas1994/z-30, branch `claude/nice-archimedes-epwg4o`, PR themantas1994/z-30#46 |
| Base (audited code) | `78db463` |
| Final head | `7a4e0c0` (code; this audit and the PR description are added on top of it, with no code change) |
| Written | 2026-10-06 |
| Ledger | [`audit/ACTIVE_DEFECT_LEDGER.md`](../ACTIVE_DEFECT_LEDGER.md) (one row per finding, never deleted) |
| Review reports | this directory: `01*` code review, `02*` transmit safety, `03*` DSP, `04` docs honesty, `05*` QA reproduction, `06` research engineer (§5) |

**Validation state: protocol validated; software simulation validated; hardware not validated;
on-air not validated.** Nothing in this remediation was run against a real radio, sound card, PTT
interface, serial port, CM108 device or rigctld. Every transmit-path test uses fake lines, fake
audio devices and virtual clocks. **This audit is evidence for the board. It is not board
acceptance, not a release decision and not permission to key a transmitter.**

## 1. Executive summary

The 2026-09-28 agent-team review found 79 defects (F-01…F-79) at `78db463`. The independent
reviews of the remediation added five more: F-80 (split out of F-26 by the DSP review), F-81 (a
transmit-path residual of the clock-step fix, from the transmit-safety audit's D-3), F-82
(research-tool follow-ups from the research-engineer review), and F-83 and F-84 (two Low reporting
gaps from the CTO re-review). The work followed the brief's phases:

1. **Reproduce before fixing.** F-01 (a failed PTT release believed released), F-15 (a panic in a
   line driver deadlocking the panic hook, watchdog and signal handler) and F-17 (a late key
   truncating the frame to 23.75 of 24.00 s and reporting it complete) were reproduced
   dynamically on `78db463`, as was F-44 (a second key re-arming the watchdog). F-16 (HALT through
   a bounded, droppable queue) and F-19 (output errors swallowed; a failed play left the partial
   frame queued) were established from the code at `78db463`, not run (§4).
2. **Transmit safety (Phase 1)**: F-01…F-09, F-15…F-19, F-21, F-22, F-43…F-46 fixed with
   regression tests, F-02 implemented to the stricter reading pending a board decision.
3. **Runtime (Phase 2)**: F-20, F-47, F-48, F-49.
4. **Research instrument (Phase 3)**: F-11…F-14, F-32, F-34…F-40, F-42, F-53, F-74.
5. **DSP (Phase 4)**: investigation and documentation only. **No receiver, modulator or channel
   algorithm changed** (confirmed by the DSP review: the only source changes in those crates are a
   `forbid(unsafe_code)` attribute and a doc comment).
6. **Documentation (Phase 5)** and **independent re-audit on the new commits (Phase 6)** by five
   review roles, re-run on each fix until the reviewer verified it. The reviews found real defects
   in the remediation itself: in the transmit path, HALT flushing a dead output after a recovery,
   a pending release dropped on shutdown, exit and SIGTERM, a command queued before HALT re-arming
   the station after it (the auditor's probe keyed a TUNE), shutdown hanging behind a wedged
   driver, a stopping station that could still key in a race (F-84), and a loopback guard got
   round in five successive review rounds until it was made semantic (clippy's resolved-name lists,
   forbidden in `loopback.rs`) with a parsed allowlist beside it; and survivors cited as evidence. Each was fixed
   with a test that fails on the unfixed code, and the transmit-path ones were mutation-tested (§5,
   §6).

Ledger status at the final head:

| Status | Rows |
| :--- | ---: |
| `VERIFIED` | 69 |
| `DOCUMENTED_LIMITATION` | 5 |
| `BOARD_DECISION` | 4 |
| `OPEN` | 6 |
| total | 84 |

`VERIFIED` is set only by the reviewer named in the row, citing a committed report; a row with two
reviewers is `VERIFIED` only when both have said so. No row is `FIXED_PENDING_REVIEW` at the final
head: every fix was re-reviewed until its reviewer verified it.

**What this remediation does not establish:** hardware or on-air behaviour of anything; the
regulatory reading of the US band plan (F-02, board); the FT8 comparison's framing (F-25, F-30,
board); the decision statistic for crossings (F-40, board); the SNR estimate on fading channels
(F-24), the pass-2/3 restriction's effect (F-41), the code-distance notes (F-78) and an AP-on
false-decode benchmark (F-80), all still open; and F-81, a Low transmit-path residual: a small
backward clock step during a frame, or a dropped clock-step event, can hold the line keyed until
the 40 s watchdog releases it. **No release is proposed.**

## 2. Defect closure table

Generated from the ledger rows; the ledger has each row's root cause, owner, reviewer, regression
test and evidence.

| ID | Severity | Finding | Status | Commit |
| :--- | :--- | :--- | :--- | :--- |
| F-01 | High | A failed PTT release is never retried or reported; controller and watchdog believe the line released | `VERIFIED` | 09693e7, 8bd126d, d159e6d, df45d56 |
| F-02 | High | US band plan clears data in CW-only 50.0-50.1 / 144.0-144.1 MHz and off-channel 60 m | `BOARD_DECISION` | 8bd126d |
| F-03 | High | 'Verified = transmitted' tested only as far as the FEC corrects (N3-sym survives) | `VERIFIED` | 8bd126d |
| F-04 | High | Production transmit loop (runtime::start) untested: RT-halt, RT-wd, RT-keyfail, RT-unkey survive | `VERIFIED` | 8bd126d |
| F-05 | High | Gate emission-edge arithmetic not pinned (G-bw, G-centre, G-top survive) | `VERIFIED` | 8bd126d |
| F-06 | High | MAX_TX_SECONDS=40 not pinned (P-max); panic-hook layer untested (P-hook) | `VERIFIED` | 09693e7 |
| F-07 | High | NaN level refusal and <=1.0 level clamp untested (G-nan, N3-level); config accepts nan | `VERIFIED` | 8bd126d |
| F-08 | High | Loopback-isolation guard is a textual deny-list that LOOP-e bypasses | `VERIFIED` | 8bd126d, d159e6d, df45d56, 7483f17, 4fa7b62, 3cbdb8a, ceab48d, 6ebb127 |
| F-09 | High (test gap) | Configured power provenance not pinned (PWR-a) | `VERIFIED` | 8bd126d |
| F-10 | High | wiki/15 shows a new install with dial and tx_level 0.5 and says --migrate writes it | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-11 | High | No per-frame outcomes recorded; paired McNemar between commits impossible | `VERIFIED` | fd877d4 (merge of remediation/research-instrument) |
| F-12 | High | Instrument identity not in provenance | `VERIFIED` | fd877d4 |
| F-13 | High | build.rs labels a binary with an unstaged dependency edit as the clean commit | `VERIFIED` | fd877d4 |
| F-14 | Medium | Replicate/exploratory run overwrites the published-seed result file | `VERIFIED` | fd877d4 |
| F-15 | Medium | Panic inside PttLine::set deadlocks panic hook, watchdog and signal handler | `VERIFIED` | 09693e7 |
| F-16 | Medium | HALT goes through a bounded droppable channel; GUI never calls emergency_unkey; control thread does blockin... | `VERIFIED` | 8bd126d, d159e6d, df45d56 |
| F-17 | Medium | Late key truncates the frame (23.80/24.00 s) and reports it completed; incomplete 73/RR73 can be logged | `VERIFIED` | 8bd126d |
| F-18 | Medium | Rig thread ignores the PTT settle window and poll_interval_ms; failed mode query leaves a stale mode counte... | `VERIFIED` | 8bd126d |
| F-19 | Medium | Output device errors swallowed; failed play leaves partial frame queued; no output-callback allocation test | `VERIFIED` | 8bd126d |
| F-20 | Medium | GUI falls back to an in-memory logbook and still says 'Logged' | `VERIFIED` | 8bd126d |
| F-21 | Medium | --migrate writes tx_level=0.5 and imports W1AW and legacy-default PTT/dial | `VERIFIED` | 8bd126d, d159e6d |
| F-22 | Medium | can_transmit returns allowed:true without PTT/hardware/level checks (added only in plan_tx) | `VERIFIED` | 8bd126d |
| F-23 | Medium | Release workflow targets retired macos-13 | `VERIFIED` | 4f6bb01 |
| F-24 | Medium | SNR estimate reads low on corrected Watterson channels; docs/receiver.md figures predate N-01 | `OPEN` | 4eed968 |
| F-25 | Medium | FT8 comparison compares receivers/conditions, not modulations | `BOARD_DECISION` | — |
| F-26 | Medium | Production AP path (decode_with_ap + corrected OSD) untested; no AP-on false-decode figure | `VERIFIED` | cbf3c75, cf247a0, d7bbbc2 |
| F-27 | Medium | Tuning-resolution exemption documented as working; production never measures resolution (strict 1 Hz) | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-28 | Medium | docs/demodulation.md §SNR describes the retired estimator | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-29 | Medium | Wiki says decodes labelled 'pass 2/3'; GUI/CLI do not show it | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-30 | Medium | wiki FT8 comparisons do not quote 'all of it' | `BOARD_DECISION` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-31 | Medium | wiki/10 presents the E007 re-implementation as protocol validation | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-32 | Medium | Suite exploratory threshold 100 frames vs documented 200 | `VERIFIED` | fd877d4 |
| F-33 | Medium | wiki/17 oracle AP figures presented as z-30's, unlabelled 60-80-frame points | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-34 | Medium | Paired-harness files record checkout HEAD twice, never wheel commit/dirty/rustc | `VERIFIED` | 9df2ca5 |
| F-35 | Medium | perf_k.txt predates replica fit and is presented as current | `DOCUMENTED_LIMITATION` | 4717b4b |
| F-36 | Medium | False-decode benchmark (2000 slots) lacks power for acceptance-changing proposals | `VERIFIED` | fd877d4 |
| F-37 | Medium | Provenance cannot support exact reproduction across ISAs | `VERIFIED` | fd877d4 |
| F-38 | Medium | compare_results.py / summarizer do not check completeness | `VERIFIED` | fd877d4 |
| F-39 | Medium | 19 cited audit .log files dropped by .gitignore | `DOCUMENTED_LIMITATION` | fd877d4 |
| F-40 | Medium | Research decision template has no crossing-delta statistic | `BOARD_DECISION` | fd877d4 |
| F-41 | Low-Medium | Pass-2/3 candidate restriction documented as 'result unchanged', never measured | `OPEN` | — |
| F-42 | Low-Medium | upper95 underflows for large k·n | `VERIFIED` | fd877d4 |
| F-43 | Low | Device selection can drive the wrong interface (first C-Media, first substring audio match, DTR/RTS on seri... | `VERIFIED` | 8bd126d, d159e6d |
| F-44 | Low | key() re-arms the watchdog deadline | `VERIFIED` | 09693e7 |
| F-45 | Low | Rig readback checked only at plan time; refused set-frequency not a refusal while settling | `VERIFIED` | 8bd126d |
| F-46 | Low | Watchdog does nothing for VOX; WatchdogReleased/Audio events dead; watchdog release unreported unless busy | `VERIFIED` | 8bd126d |
| F-47 | Low | Output-latency compensation racy and usually zero | `VERIFIED` | 8bd126d |
| F-48 | Low | Backward clock step silently suspends decoding (150 s gap) | `VERIFIED` | 8bd126d |
| F-49 | Low | Tune carrier generated outside gfsk::Modulator with a linear ramp | `VERIFIED` | 8bd126d |
| F-50 | Low | No advisory scan of the production Rust tree; actions pinned by tag; pyo3 Dependabot failure | `VERIFIED` | 6d382a2 |
| F-51 | Low | Clippy and npm commands in README and wiki/16 differ from CI | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-52 | Low | SIC co-location boundary unstated | `VERIFIED` | 4eed968 |
| F-53 | Low | false.json '0 dB' random-FSK interferers are at -3 dB | `VERIFIED` | fd877d4 |
| F-54 | Low | Impairments applied at 6 kHz after resampling; docs do not say so | `VERIFIED` | 4eed968 |
| F-55 | Low | L-05 (Gray mapping) closable for AWGN by symmetry; fading exploratory | `VERIFIED` | 4eed968 |
| F-56 | Low | Out-of-range SNR sent as a number (clamped +30 means >= +30) | `DOCUMENTED_LIMITATION` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-57 | Low | suppression_db overstatement range incomplete | `VERIFIED` | 4eed968 |
| F-58 | Low | wiki/17 describes retired app's AP setting and placeholder | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-59 | Low | wiki/04 trellis stop rule and OSD gates misstated; p-value box wrong | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-60 | Low | docs/ldpc.md says logbook does not record AP use; it does | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-61 | Low | SPEC omits 'OSD only if min syndrome <= 14' and CQ TEST | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-62 | Low | 'Bit for bit' applied to the waveform (tolerance 1e-6), also in release notes | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-63 | Low | Stale/unsupported statements (diagnostics sample, suite runtime, wiki/16 '200 frames') | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-64 | Low | Figures missing conditions or a source | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-65 | Low | d8983eeef66e/SUMMARY.md header differs from script; no withdrawn marker | `DOCUMENTED_LIMITATION` | 4717b4b |
| F-66 | Low | sd 0.048 dB is over 11 runs, not 'ten replicates' | `VERIFIED` | 4717b4b; 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-67 | Low | 18fbd78d8fb8/ has no SUMMARY.md; pooled figure computed outside research/ | `VERIFIED` | 4717b4b |
| F-68 | Low | Wording: 'on-air decoder' for legacy; 'threshold' for the oracle | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-69 | Low | Broken anchor, backspace bytes in wiki/04 formula, sidebar links | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-70 | Low | README 'full list' of limitations stale | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-71 | Low | Capture->resampler->scheduler chain in no benchmark; no input-level variation | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-72 | Low | Docs tables reformatted, not literally pasted | `VERIFIED` | 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-73 | Low | Loose result files at research/results/ root; G2.3 OSD result has no file | `DOCUMENTED_LIMITATION` | 4717b4b |
| F-74 | Low | Seed field layout has no bounds check (> 2^20 frames) | `VERIFIED` | 748cf31 (merged fd877d4); docs 10fcadb, 22954f5, 6319cdf, 702d10b (merged 523928e) |
| F-75 | Info | TxPlan constructible without the gate (no bypass today) | `VERIFIED` | 8bd126d |
| F-76 | Info | Thread-count determinism test vacuous on 1 CPU; docs cite wrong test | `VERIFIED` | 478c353 |
| F-77 | Info | Counting global allocator in shipped z30; io/gui/channel lack forbid(unsafe_code) | `VERIFIED` | d6a3544 |
| F-78 | Info | Code d_min <= 14 near OSD and trellis gates; clock stretch applied from window start | `OPEN` | — |
| F-79 | Info | README credits awgn_paired_200 to rustc 1.94.1, below MSRV | `VERIFIED` | 4717b4b |
| F-80 | Medium | No AP-on false-decode benchmark: the false benchmark runs RxConfig::default() (AP off) only, so AP's cost i... | `OPEN` | — |
| F-81 | Low | L-5 residual: the frame's end is timed on the wall clock, a backward step smaller than about a slot is not ... | `OPEN` | — |
| F-82 | Medium | Research-tool follow-ups: paired_mcnemar.py pairs one replicate at a time and uses every point as the Holm ... | `OPEN` | — |
| F-83 | Low | After an unconfirmed shutdown in apply_settings, the GUI drew an empty window: the red 'release NOT confirm... | `VERIFIED` | 7483f17 |
| F-84 | Low | On the confirmed path, ShutdownReport was read before the threads stopped, so a refused final unkey on the ... | `VERIFIED` | 7483f17, 3cbdb8a, 6ebb127 |

## 3. Commands and results

All on Linux x86_64, rustc 1.95.0 (the declared MSRV) unless stated; `--locked` throughout.

| Check | Command | Base `78db463` | Final head |
| :--- | :--- | :--- | :--- |
| Format | `cargo +1.95 fmt --all --check` | clean (`evidence/baseline/fmt.txt`) | clean |
| Lint | `cargo +1.95 clippy --workspace --all-targets --exclude z30-py --locked -- -D warnings` | clean (`evidence/baseline/clippy.txt`) | clean |
| Lint, CM108 | as above with `--features z30-cli/cm108,z30-gui/cm108` | — | clean |
| Lint, stable | `cargo +1.98 clippy …` (CI's stable toolchain) | — | clean |
| Tests | `cargo +1.95 test --workspace --exclude z30-py --release --locked` | 167 passed, 0 failed, 2 ignored (`evidence/baseline/test.txt`) | **270 passed, 0 failed, 2 ignored** (40 test binaries, at `7a4e0c0`) |
| CM108 unit tests | `cargo +1.95 test -p z30-io --features cm108 --lib --release --locked cm108` | not run by CI | 2 passed; now a CI step (review L-2) |
| Research tools | `python -m pytest research/tests -q` | — | 29 passed |
| CI | GitHub Actions on the PR head | — | green on `7a4e0c0`: all 25 checks that run passed (publishing a release is skipped on a pull request). On earlier heads, jobs a runner cancelled before any step ran, and one oracle job killed by its runner (exit 143) on a commit that changed only `audit/`, were re-run once; no test failure was re-run. |

The two ignored tests are the same at both ends (`explore_spread_estimator_scatter`,
`golden_ldpc::screen_osd_pool`), both pre-existing. Paths are relative to
`audit/2026-09-28-remediation/`.

## 4. Reproduction of the top-5 hazards on `78db463`

| Finding | How | Observation | Fixed by / regression test |
| :--- | :--- | :--- | :--- |
| F-01 failed release | probe test on fake lines (`evidence/reproduction/`) | `unkey` returned `Err`, controller said not keyed, hardware still keyed; an hour later the watchdog had done nothing | `09693e7`; `ptt_release::f01_*`, `tx_runtime::rt_an_unconfirmed_release_*`, `m2_shutdown_*` |
| F-15 panic in `set` | probe | the keying thread never returned; the watchdog believed the line released while it stayed keyed; a later `PttController::new` blocked for ever (the combined run had to be killed) | `09693e7`; `ptt_panic::f15_*`, `ptt_release::f15_*` |
| F-16 HALT blocked | code at `78db463` | `app.rs:383` HALT is `self.send(Command::HaltTx)`, a `try_send` on the bounded command queue; `timedatectl` and SQLite ran on the control thread | `8bd126d`, `ea6dd69`; `tx_runtime::rt_halt_*` (5) |
| F-17 late key | probe | 23.75 of 24.00 s played, reported `completed: true` | `8bd126d`; `tx_runtime::rt_a_slow_key_*`, `rt_a_key_too_slow_*`, `rt_a_stalled_control_loop_*`, `rt_a_frame_the_device_did_not_finish_is_partial_not_complete` |
| F-19 output failure | code at `78db463` | `audio.rs:255` output error callback `\|_err\| {}`; `runtime.rs:503-510` a failed `play` unkeyed but never stopped the output, leaving the partial frame queued | `8bd126d`; `tx_runtime::rt_an_output_failure_*`, `rt_a_failed_play_*`, `audio::tests::f19_*` |

F-16 and F-19 were not run before the fix; the statement above is what the code did, with the
lines cited.

## 5. Independent reviews (Phase 6)

Each review role ran read-only on a fixed commit; reports are saved verbatim in this directory.

| Report | Role | Commit | Verdict | Findings and disposition |
| :--- | :--- | :--- | :--- | :--- |
| `05-qa-reproduction.md` | qa-reproducer | `a49d655` | **REPRODUCED** | Rebuilt clean; `awgn` and `false` reproduce `research/results/672cef9b3cdb/` exactly, point by point, both crossings and intervals; the published files untouched, every write into them refused. QA-A (compare tool could not certify a reproduction) and QA-B (instrument hash missed the frame encoder) fixed in `b81a8ea`; QA-C noted in `research/results/README.md`. F-34 not verified (no maturin on the host). |
| `04-docs-honesty.md` | docs-honesty-auditor | `ee42ae6` | 13 findings (2 Medium) | No hardware or on-air implication, no withdrawn figure re-published; transmit behaviour in the docs matches the code. All 13 fixed in `3fbf952`. |
| `01-code-review-cto.md` | cto-code-reviewer | `ee42ae6` | **READY AFTER FIXES** | No blocker; no safety test weakened. M-1 (HALT flushed a dead output after a recovery), M-2 (a pending release abandoned on shutdown, settings change, exit and SIGTERM), M-3 (surviving mutants cited as evidence), L-1…L-5, I-1, I-2: fixed in `ea6dd69` and `7f64907` with tests; L-6 (PR size) is the board's to weigh. |
| `03-dsp-review.md` | rf-dsp-reviewer | `7f64907` | **SOUND WITH STATED LIMITS** | No receiver/modulator/channel change. F-41 wording, F-26 test gaps, F-33 and F-52 wording: fixed in `cf247a0`; the AP-on false-decode benchmark split out as F-80 (OPEN). |
| `02-transmit-safety.md` | tx-safety-auditor | `c164dd0` | **FINDINGS** | D-1 (a command queued before HALT re-armed the station; its probe keyed a TUNE), D-2 (a key racing the signal handler's release outlived the process), D-4 (shutdown could hang behind a wedged driver), D-5, D-6, T-1 (the loopback allowlist admitted all of `std`) and four High test gaps (T-2…T-4 and its own surviving mutants): fixed in `d159e6d` with tests; its 24 mutants joined run 4 (§6). |
| `02b-transmit-safety-re-review.md` | tx-safety-auditor | `6015d86` | **FINDINGS** | F-21, F-43 VERIFIED; F-01 stays VERIFIED. R-1 (the Answer drop unpinned), R-2 (a test-only item hid the rest of `loopback.rs` from the allowlist), R-3 (the loopback could write its report to a tty), R-4 (shutdown still drove the line on the caller): fixed in `df45d56`. |
| `03b-dsp-re-review.md`, `03c-dsp-confirmation.md` | rf-dsp-reviewer | `b6a1f32`, `d7bbbc2` | F-26, F-33 **VERIFIED** (03c) | 03b showed the busy-band AP test never puts a plain decode at risk, so "AP never loses a decode across SIC passes" was untested: the docs now say it holds per candidate and is not guaranteed across passes (`d7bbbc2`). |
| `06-research-engineer.md` | research-engineer | `38e43c6` | F-11, F-14 **VERIFIED** | Paired per-frame outcomes and results routing work end to end; the limits of `paired_mcnemar.py` against research-process §2a and a symlink bypass of the published-directory check recorded as F-82 (OPEN). |
| `01b-code-review-cto-re-review.md` | cto-code-reviewer | `5e23c9b` | **READY FOR BOARD** (F-01, F-16 scope) | F-01 and F-16 VERIFIED; M-1, M-2, M-3, L-1 closed; no test weakened; 261 passed. N-1 (the GUI hid the unconfirmed-shutdown warning) and N-2 (the confirmed-path report read before the threads stopped) recorded as F-83, F-84 and fixed in `7483f17`. |
| `02c-transmit-safety-confirmation.md` | tx-safety-auditor | `df45d56` | **FINDINGS** | F-16 VERIFIED (R-1 pinned, R-4 mutants killed, no D-1 bypass). F-08 NOT VERIFIED: the device refusal untested, brace literals and `//` in strings could hide code from the guard, Windows unprotected: fixed in `7483f17` (§6.4). |
| `05b-qa-f34-paired-harness.md` | qa-reproducer | `7483f17` | F-34 **VERIFIED** | Wheel built clean and dirty with maturin; wheel and result record commit, dirty-diff hash (matched independently) and rustc; dirty, mismatched and stale wheels are `not_the_published_run` with reasons. Its Low finding (CI asserted only the counts) fixed in `2a5ec51`: the harness job now asserts the provenance. |
| `01c-code-review-cto-f83-f84.md` | cto-code-reviewer | `7483f17` | **READY FOR BOARD** (F-83, F-84 scope); F-83, F-84 **VERIFIED** | 265 passed; no test weakened. N-6 (raw C strings fooled the guard's lexer), N-7 (the close warning claimed retries after the runtime had stopped), N-9…N-11 (docs, a late `--out` check): fixed in `4fa7b62`. |
| `02d-transmit-safety-confirmation-2.md` | tx-safety-auditor | `7483f17` | **FINDINGS**; F-08, F-84 NOT VERIFIED | The hardware loopback's `--out` refusal untested; the text allowlist bypassed by `extern crate std as Std` and a macro metavariable (rustfmt-stable); F-84's re-read untested. Fixed in `3cbdb8a`: the guard parses `loopback.rs` with `syn`; `--out` checked before the hardware loopback's refusals, with behaviour and unit tests; `PttController::close` makes the F-84 race impossible (§6.5). |
| `02e-transmit-safety-confirmation-3.md` | tx-safety-auditor | `2e06ca6` | **FINDINGS**; F-08, F-84 NOT VERIFIED | The syn guard refused every earlier class, but its scan of macro tokens lost a path's prefix after `::<`, `::{`, `::*` (S1–S5 reached `std::net`, `std::fs`, `std::process` from inside `format!`); Low S6, S9, B5b. The F-84 latch judged correct, unable to key or block; only its call site untested, with a killing test supplied. Fixed in `6ebb127`, the auditor's test landed; run 7 (§6.6). |
| `02f-transmit-safety-confirmation-4.md` | tx-safety-auditor | `3ac5e9c` | F-84 **VERIFIED**; F-08 NOT VERIFIED (review incomplete) | Every 02e finding closed and its mutant killed (sampled independently). Its fresh bypass search was not carried out, so F-08 stayed open; it recommended semantic enforcement over another syntax round. Added in `6003522`: `loopback.rs` forbids clippy's disallowed lists (`crates/z30-cli/clippy.toml`). |
| `02g-transmit-safety-confirmation-5.md` | tx-safety-auditor | `39bfac2` | F-08 **VERIFIED** | A fresh bypass search (macros, aliases, globs, traits, closures, function pointers, impls, generics): 20 valid mutants, none past both layers. Medium findings: three ways of switching the clippy layer off passed the test; clippy alone does not cover crate-local calls, path-opening `z30_io` functions or FFI. Fixed in `7a4e0c0`: the forbid set, the whole list and the absence of any other clippy configuration are pinned (each switch-off killed); `unsafe_code` forbidden; the list extended; the docs call both layers required. |

Fixes made after a review were checked by reverting each one and confirming its new test fails
(M-1, M-2, L-1, L-5 runtime abort, I-2, the AP gate assertion), then by the mutation run (§6).
A row a fix touched after its review went back to `FIXED_PENDING_REVIEW` until the reviewer
re-reviewed it; none remains in that state at the final head (§11).

## 6. Mutation testing

### 6.1 Summary

Run 4: 119 mutants at `d159e6d`: 111 killed, 8 survived. Of the survivors, 5 are equivalent (A-BG-skippending, A-CHK-pending, CAT-lazy, G-plan, RT-relfault); 2 were untested pins since killed (A-B60-tol, A-LATE-start); 1 remains a Low survivor (A-SH-nohalt). 0 not applied or invalid.

History: run 1 (`mutate_tx_v2.py`, 82 mutants at `8a98bbc`) killed 74; the 8 survivors were
re-run at `55a606c` after killing tests were added (6 killed); G-plan and RT-relfault re-run at
`a49d655` still survived. Run 3 (`mutate_tx_v3.py`, 91 at `ea6dd69`) re-targets four v2 patterns
the reviewed code no longer matches (same intent) and adds nine for the code-review fixes. Run 4
(`mutate_tx_v4.py`, 119 at `d159e6d`) adds the transmit-safety auditor's own 24 mutants and four
for its fixes. The code after `d159e6d` (shutdown's R-4 rewrite, the loopback guard) was mutated by
the auditor in its re-reviews and by runs 5–7 (§6.4–§6.6). All files are in `evidence/tx-mutation/` with a
README.

### 6.2 Equivalent survivors

- **G-plan** (`engine.rs`): `!perm.allowed` → `!perm.violations.is_empty()`. The preceding lines
  push `FrameNotForMessage` whenever the gate refuses with no violation, and `txgate.rs` allows
  only with none, so the two conditions agree at that line.
- **RT-relfault** (`runtime.rs`): `finish` no longer reports an unconfirmed release itself.
  `check_hardware` reports the `ReleasePending` state one control-loop pass later (or the
  refused-then-confirmed path does, `b667625`): one loop pass of latency, which no test can
  observe without being a timing test.
- **CAT-lazy** (`rigctld.rs`): the explicit `connect()` removed from `RigctldPtt::connect`. Since
  review M-2 the constructor sends `T 0` at once, which connects on demand: the connection still
  exists before the first key and an absent rigctld is still a start-up error; only the error's
  wording differs.
- **A-BG-skippending** (`ptt.rs`): the background release skips a line already pending. The
  watchdog retries a pending release every 50 ms, so the line is released either way.
- **A-CHK-pending** (`runtime.rs`): the mirror of RT-relfault (`check_hardware` no longer reports
  `ReleasePending`, and `finish` still does). The auditor's A-COMBO mutant removes both and is
  killed.
- **A-SH-nohalt** (`runtime.rs`, a Low survivor, not equivalent): shutdown's own `halt()` removed.
  It matters only when the control thread is stuck; otherwise the control thread's exit stops the
  output and unkeys. No test holds the control thread stuck through a shutdown.

### 6.3 Every mutant of run 4

| ID | Mutation | Site | Result | Killed by |
| :--- | :--- | :--- | :--- | :--- |
| C03-c | own +0.3 s offset applied to UTC | `crates/z30-io/src/wallclock.rs:96` | KILLED | -p z30-io --lib: wallclock::tests::utc_is_the_operating_systems_with_no_offset_applied |
| C06-a | verify_round_trip always Ok | `crates/z30-protocol/src/codec.rs:595` | KILLED | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-b | verify() makes a VerifiedFrame without the round trip | `crates/z30-protocol/src/codec.rs:623` | KILLED | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| LOG-c | missing received report logged as -16 | `crates/z30-engine/src/qso.rs:414` | KILLED | -p z30-engine --lib: qso::tests::the_record_holds_no_report_that_was_not_received_or_sent |
| SNR-e | no-estimate SNR floored to -30 dB instead of None | `crates/z30-dsp/src/demod.rs:203` | KILLED | -p z30-dsp --test snr_accuracy: no_signal_is_no_estimate_never_a_floor_value |
| G-bw | emission checked at 0 Hz width instead of the measured -40 dB width | `crates/z30-engine/src/txgate.rs:241` | KILLED | -p z30-engine --test gate_contract: f02_the_gate_refuses_us_cw_only_sub_bands_and_off_channel_60m, f05_the_emission_is_checked_at_its_66_hz_width_a... |
| G-centre | emission centred on tone 0 (tone span ignored) | `crates/z30-engine/src/txgate.rs:238` | KILLED | -p z30-engine --test gate_contract: f02_the_gate_refuses_us_cw_only_sub_bands_and_off_channel_60m, f05_the_emission_is_checked_at_its_66_hz_width_a... |
| G-top | upper audio limit checks tone 0 instead of tone 15 | `crates/z30-engine/src/txgate.rs:235` | KILLED | -p z30-engine --test gate_contract: f05_the_top_tone_must_stay_below_the_audio_ceiling |
| G-lsb | emission computed as lower sideband | `crates/z30-engine/src/txgate.rs:238` | KILLED | -p z30-engine --test safety: g3_the_radiated_emission_not_the_dial_is_checked_at_its_edges |
| G-region | missing region not refused | `crates/z30-engine/src/txgate.rs:220` | KILLED | -p z30-engine --test safety: g2_region_and_class_are_required_and_must_match, g4_fails_closed_and_reports_every_violation |
| G-stable | an unsettled QSY counts as a contradiction | `crates/z30-engine/src/rig.rs:291` | KILLED | -p z30-engine --test safety: r3_an_unsettled_qsy_is_not_a_refusal |
| G-res | tuning resolution ignored (1 Hz tolerance) | `crates/z30-engine/src/rig.rs:50` | KILLED | -p z30-engine --test safety: r4_measured_tuning_resolution |
| G-nan | NaN transmit level not refused | `crates/z30-engine/src/txgate.rs:282` | KILLED | -p z30-engine --test gate_contract: f07_a_nan_level_or_one_above_full_scale_is_refused_not_clamped, f22_the_plan_carries_exactly_what_the_gate_checked |
| G-over | transmit level above full scale not refused | `crates/z30-engine/src/txgate.rs:282` | KILLED | -p z30-engine --test gate_contract: f07_a_nan_level_or_one_above_full_scale_is_refused_not_clamped |
| G-hwptt | PTT not configured not refused | `crates/z30-engine/src/txgate.rs:267` | KILLED | -p z30-engine --test safety: h1_no_ptt_method_or_unavailable_tx_hardware_refuses_before_keying |
| G-hwopen | unavailable TX hardware not refused | `crates/z30-engine/src/txgate.rs:270` | KILLED | -p z30-engine --test safety: h1_no_ptt_method_or_unavailable_tx_hardware_refuses_before_keying |
| G-relpend | an unconfirmed PTT release not refused by the gate | `crates/z30-engine/src/txgate.rs:273` | KILLED | -p z30-engine --test gate_contract: f22_can_transmit_itself_refuses_missing_or_uncertain_hardware |
| G-dialref | a refused dial not refused by the gate | `crates/z30-engine/src/txgate.rs:276` | KILLED | -p z30-engine --test gate_contract: f22_can_transmit_itself_refuses_missing_or_uncertain_hardware |
| G-plan | plan_tx trusts only the violation list (a frame request with no frame passes) | `crates/z30-engine/src/engine.rs:541` | SURVIVED, equivalent (§6.2) | — |
| G-halt | halt commands no longer abandon a planned transmission | `crates/z30-engine/src/engine.rs:298` | KILLED | -p z30-engine --test safety: h2_a_halt_between_plan_and_key_abandons_the_transmission |
| G-hwprob | the engine hands the gate no hardware problems (output fault ignored) | `crates/z30-engine/src/engine.rs:478` | KILLED | -p z30-engine --test safety: h1_no_ptt_method_or_unavailable_tx_hardware_refuses_before_keying |
| B-6m | US 6 m data segment starts at 50.0 MHz (CW-only sub-band cleared) | `crates/z30-engine/src/bandplan.rs:215` | KILLED | -p z30-engine --lib: bandplan::tests::f02_us_cw_only_sub_bands_and_off_channel_60m_are_refused |
| B-2m | US 2 m data segment starts at 144.0 MHz | `crates/z30-engine/src/bandplan.rs:216` | KILLED | -p z30-engine --lib: bandplan::tests::f02_us_cw_only_sub_bands_and_off_channel_60m_are_refused |
| B-60c | US 60 m channel centring not enforced (anywhere inside the 2.8 kHz) | `crates/z30-engine/src/bandplan.rs:240` | KILLED | -p z30-engine --lib: bandplan::tests::f02_us_cw_only_sub_bands_and_off_channel_60m_are_refused |
| N3-sym | tx_audio modulates the verified frame with one data symbol changed | `crates/z30-engine/src/runtime.rs:265` | KILLED | -p z30-engine --test safety: n3_the_transmitted_audio_is_the_verified_frame_and_decodes_as_the_message |
| N3-freq | tx_audio transmits 50 Hz above the frequency the gate checked | `crates/z30-engine/src/runtime.rs:277` | KILLED | -p z30-engine --test safety: n3_the_transmitted_audio_is_the_verified_frame_and_decodes_as_the_message |
| N3-level | frame_audio no longer limits the level to full scale | `crates/z30-engine/src/runtime.rs:252` | KILLED | -p z30-engine --test gate_contract: f07_the_synthesised_frame_never_exceeds_full_scale |
| N3-plvl | tx_audio uses a fixed level instead of the level the gate checked | `crates/z30-engine/src/runtime.rs:277` | KILLED | -p z30-engine --test safety: n3_the_transmitted_audio_is_the_verified_frame_and_decodes_as_the_message |
| TUNE-lin | Tune generated as a hand-made sine outside the modulator | `crates/z30-engine/src/runtime.rs:282` | KILLED | -p z30-engine --test gate_contract: f49_tune_is_the_one_modulators_unmodulated_carrier_at_the_span_centre |
| P-max | MAX_TX_SECONDS raised to 400 | `crates/z30-engine/src/ptt.rs:43` | KILLED | -p z30-engine --test ptt_release: f06_the_transmit_time_limit_is_forty_seconds |
| P-hook | panic hook no longer releases PTT | `crates/z30-engine/src/ptt.rs:294` | KILLED | -p z30-engine --test ptt_panic: f06_the_panic_hook_releases_a_keyed_line_when_another_thread_panics |
| P-drop | Drop of a keyed controller does not release | `crates/z30-engine/src/ptt.rs:507` | KILLED | -p z30-engine --test emergency: p5_emergency_release_and_drop_release_a_keyed_line |
| P-emerg | emergency_release_all releases nothing | `crates/z30-engine/src/ptt.rs:284` | KILLED | -p z30-engine --test emergency: p5_emergency_release_and_drop_release_a_keyed_line |
| P-keyfail | a refused key is not released | `crates/z30-engine/src/ptt.rs:365` | KILLED | -p z30-engine --test safety: z2_a_key_the_hardware_refused_leaves_nothing_keyed |
| P-wdcmp | watchdog fires one tick late (> instead of >=) | `crates/z30-engine/src/ptt.rs:448` | KILLED | -p z30-engine --test safety: p4_the_watchdog_unkeys_at_the_hardware_after_max_tx_seconds, p4c_the_limit_can_never_be_raised |
| P-wdthread | watchdog thread never ticks | `crates/z30-engine/src/ptt.rs:480` | KILLED | -p z30-engine --test safety: p4b_the_watchdog_thread_works_without_the_engine |
| P-clamp | with_limit no longer clamps the limit to MAX_TX_SECONDS | `crates/z30-engine/src/ptt.rs:323` | KILLED | -p z30-engine --test safety: p4c_the_limit_can_never_be_raised |
| P-relflag | F-01 regression: a failed release is recorded as released | `crates/z30-engine/src/ptt.rs:204` | KILLED | -p z30-engine --test ptt_release: f01_drop_releases_a_line_whose_release_is_unconfirmed, f01_a_line_that_cannot_confirm_a_release_cannot_be_keyed_a... |
| P-retry | the watchdog no longer retries an unconfirmed release | `crates/z30-engine/src/ptt.rs:460` | KILLED | -p z30-engine --test ptt_release: f01_a_failed_release_leaves_the_line_possibly_keyed_and_the_watchdog_retries_it, f01_the_background_watchdog_thre... |
| P-rekey | a line whose release is unconfirmed can be keyed again | `crates/z30-engine/src/ptt.rs:344` | KILLED | -p z30-engine --test ptt_release: f01_a_line_that_cannot_confirm_a_release_cannot_be_keyed_again |
| P-rearm | F-44 regression: every key re-arms the watchdog deadline | `crates/z30-engine/src/ptt.rs:344` | KILLED | -p z30-engine --test ptt_release: f44_a_second_key_does_not_re_arm_the_watchdog |
| P-unwind | F-15 regression: a driver panic is not caught | `crates/z30-engine/src/ptt.rs:165` | KILLED | -p z30-engine --test ptt_panic: f15_a_panic_inside_set_true_is_released_and_nothing_deadlocks |
| P-wdblock | the watchdog blocks on the line instead of try_lock | `crates/z30-engine/src/ptt.rs:448` | KILLED | -p z30-engine --test ptt_release: f15_the_watchdog_never_blocks_on_a_line_another_thread_is_driving |
| P-drivewait | the emergency path waits for a line the current thread is driving | `crates/z30-engine/src/ptt.rs:235` | KILLED | -p z30-engine --test ptt_panic: f15_a_panic_inside_set_true_is_released_and_nothing_deadlocks |
| RT-halt | runtime ignores the engine's halt while planned/keyed | `crates/z30-engine/src/runtime.rs:729` | KILLED | -p z30-engine --test tx_runtime: rt_a_configuration_change_or_queued_halt_while_keyed_ends_the_transmission |
| RT-haltflag | HALT's flag is never acted on by the control loop | `crates/z30-engine/src/runtime.rs:823` | KILLED | -p z30-engine --test tx_runtime: rt_halt_between_plan_and_key_abandons_the_transmission_and_disarms, d1_a_command_queued_before_halt_does_not_rearm... |
| RT-haltptt | HALT does not release the PTT itself (waits for the control thread) | `crates/z30-engine/src/runtime.rs:454` | KILLED | -p z30-engine --test tx_runtime: rt_halt_releases_the_ptt_even_while_the_control_thread_is_stuck_in_the_output |
| RT-haltstop | HALT does not silence the output itself | `crates/z30-engine/src/runtime.rs:453` | KILLED | -p z30-engine --test tx_runtime: rt_halt_after_an_output_recovery_still_silences_the_live_output_from_the_calling_thread, rt_halt_is_not_delayed_by... |
| RT-wd | runtime ignores a watchdog release (audio keeps playing, TX not faulted) | `crates/z30-engine/src/runtime.rs:904` | KILLED | -p z30-engine --test tx_runtime: rt_the_watchdog_releases_a_stuck_transmission_and_the_runtime_reports_it |
| RT-keyfail | a refused key still plays the audio | `crates/z30-engine/src/runtime.rs:1008` | KILLED | -p z30-engine --test tx_runtime: rt_a_refused_key_plays_nothing_and_is_reported_failed |
| RT-unkey | end of frame stops audio but does not unkey | `crates/z30-engine/src/runtime.rs:850` | KILLED | -p z30-engine --test tx_runtime: rt_a_failed_play_flushes_the_partial_frame_and_releases, l5_a_clock_step_during_a_transmission_aborts_it_and_disar... |
| RT-relfault | an unconfirmed release is not reported or refused by the runtime | `crates/z30-engine/src/runtime.rs:861` | SURVIVED, equivalent (§6.2) | — |
| RT-outfail | an output failure while keyed is ignored | `crates/z30-engine/src/runtime.rs:912` | KILLED | -p z30-engine --test tx_runtime: rt_an_output_failure_while_keyed_stops_releases_refuses_and_recovers, rt_halt_after_an_output_recovery_still_silen... |
| RT-playstop | a failed play leaves the partial frame queued | `crates/z30-engine/src/runtime.rs:843` | KILLED | -p z30-engine --test tx_runtime: rt_a_failed_play_flushes_the_partial_frame_and_releases, rt_a_frame_is_keyed_played_whole_and_released_in_that_ord... |
| RT-lateend | F-17 regression: the frame's end fixed before the audio actually starts | `crates/z30-engine/src/runtime.rs:233` | KILLED | -p z30-engine --test tx_runtime: rt_a_slow_key_still_sends_the_whole_frame |
| RT-latekey | a key far past its time is still sent | `crates/z30-engine/src/runtime.rs:213` | KILLED | -p z30-engine --test tx_runtime: rt_a_stalled_control_loop_does_not_key_late |
| RT-latestart | audio far past its time is still started | `crates/z30-engine/src/runtime.rs:224` | KILLED | -p z30-engine --test tx_runtime: rt_a_key_too_slow_for_the_slot_abandons_it_without_audio |
| RT-partial | a frame the device did not finish is reported complete | `crates/z30-engine/src/runtime.rs:1037` | KILLED | -p z30-engine --test tx_runtime: rt_a_frame_the_device_did_not_finish_is_partial_not_complete |
| RT-settle | the rig thread polls inside the PTT settle window | `crates/z30-engine/src/runtime.rs:507` | KILLED | -p z30-engine --test tx_runtime: f18_the_poll_schedule_honours_the_interval_and_the_ptt_settle_window |
| RT-pollint | the rig thread ignores poll_interval_ms | `crates/z30-engine/src/runtime.rs:492` | KILLED | -p z30-engine --test tx_runtime: f18_the_poll_schedule_honours_the_interval_and_the_ptt_settle_window, f18_the_rig_thread_polls_at_the_configured_i... |
| RT-midtx | a rig contradiction during a frame does not stop it | `crates/z30-engine/src/runtime.rs:964` | KILLED | -p z30-engine --test tx_runtime: rt_a_radio_that_moves_off_the_checked_dial_mid_frame_stops_the_transmission |
| RT-lat | F-47 regression: output latency not read at plan time | `crates/z30-engine/src/runtime.rs:985` | KILLED | -p z30-engine --test tx_runtime: d1_a_command_queued_before_halt_does_not_rearm_the_station_after_it, l5_a_clock_step_during_a_transmission_aborts_... |
| RT-outcome | only-Complete-advances regression: any outcome advances the QSO | `crates/z30-engine/src/engine.rs:591` | KILLED | -p z30-engine --test gate_contract: f17_only_a_complete_closing_frame_completes_and_logs_the_contact |
| RT-logpersist | Event::Logged emitted before the logbook wrote the contact | `crates/z30-engine/src/engine.rs:408` | KILLED | -p z30-engine --test gate_contract: f17_only_a_complete_closing_frame_completes_and_logs_the_contact, f09_configured_power_is_logged_as_configurati... |
| RIG-stale | a mode the poll did not read is re-dated as fresh | `crates/z30-engine/src/rig.rs:280` | KILLED | -p z30-engine --test gate_contract: f18_a_mode_the_poll_did_not_read_is_not_re_dated_as_fresh |
| RIG-refused | a refused set-frequency is not a refusal | `crates/z30-engine/src/engine.rs:199` | KILLED | -p z30-engine --test dial_provenance: p5_a_command_the_radio_refused_is_not_commanded |
| CLK-step | a clock step is not detected (the receiver goes silent) | `crates/z30-engine/src/slots.rs:161` | KILLED | -p z30-engine --test clock_step: f48_a_backward_step_is_reported_and_decoding_resumes, f48_a_forward_step_is_reported_and_decoding_resumes |
| LOOP-b | audio loopback refusal lets VOX through | `crates/z30-cli/src/audio_loopback.rs:48` | KILLED | -p z30-cli: audio_loopback::tests::it_refuses_every_configuration_that_can_key_a_transmitter_before_opening_a_device |
| LOOP-e | software loopback reaches the sound-card test via crate:: (unreachable at run time) | `crates/z30-cli/src/loopback.rs:153` | KILLED | -p z30-cli: the_software_loopback_reaches_only_an_allowlist_of_crates_and_items, the_software_loopback_has_no_audio_device_ptt_or_rig_control_in_it |
| DIAL-a | a configured dial is logged as commanded | `crates/z30-engine/src/engine.rs:393` | KILLED | -p z30-engine --test dial_provenance: p2_a_configured_dial_with_no_radio_is_logged_as_configuration_not_as_commanded, p5_a_command_the_radio_refuse... |
| PWR-a | configured TX power logged as measured | `crates/z30-engine/src/engine.rs:405` | KILLED | -p z30-engine --test gate_contract: f09_configured_power_is_logged_as_configuration_never_as_measured |
| LOG-p | validate accepts a record with no partner | `crates/z30-engine/src/qso.rs:173` | KILLED | -p z30-engine --test qso_logging: a_record_without_a_partner_or_a_real_utc_time_is_refused |
| MIG-level | migration writes a transmit level of 0.5 | `crates/z30-io/src/migrate.rs:415` | KILLED | -p z30-io --lib: migrate::tests::f21_legacy_defaults_are_not_migrated_into_a_transmit_capable_station |
| MIG-call | migration imports the legacy default callsign | `crates/z30-io/src/migrate.rs:197` | KILLED | -p z30-io --lib: migrate::tests::f21_legacy_defaults_are_not_migrated_into_a_transmit_capable_station |
| MIG-ptt | migration imports the legacy default PTT method | `crates/z30-io/src/migrate.rs:334` | KILLED | -p z30-io --lib: migrate::tests::f21_a_tk_only_install_and_a_cm108_without_a_pin_bring_no_invented_settings, migrate::tests::f21_legacy_defaults_ar... |
| MIG-dial | migration imports the legacy default dial | `crates/z30-io/src/migrate.rs:264` | KILLED | -p z30-io --lib: migrate::tests::f21_a_tk_only_install_and_a_cm108_without_a_pin_bring_no_invented_settings, migrate::tests::f21_legacy_defaults_ar... |
| DEV-first | an ambiguous audio name resolves to the first match | `crates/z30-io/src/audio.rs:165` | KILLED | -p z30-io --lib: audio::tests::f43_an_ambiguous_device_name_is_refused_not_resolved_to_the_first_match |
| CM-first | an empty CM108 path takes the first of several devices | `crates/z30-io/src/cm108.rs:55` | KILLED | -p z30-io --lib --features cm108: cm108::tests::f43_no_cm108_device_is_guessed_when_there_is_more_than_one |
| OUT-err | the output error callback discards the error | `crates/z30-io/src/audio.rs:280` | KILLED | -p z30-io --lib: audio::tests::f19_an_output_error_is_recorded_and_a_flush_empties_the_ring |
| OUT-alloc | the playback callback allocates | `crates/z30-io/src/audio.rs:313` | KILLED | -p z30-io --test callback_alloc: the_playback_callback_never_allocates_and_plays_what_was_queued |
| CAT-lazy | CAT PTT connects lazily at the first key | `crates/z30-io/src/rigctld.rs:94` | SURVIVED, equivalent (§6.2) | — |
| WALL-block | the clock status query runs on the caller's thread | `crates/z30-io/src/wallclock.rs:108` | KILLED | -p z30-io --lib: wallclock::tests::f16_the_status_never_blocks_on_the_os_query, wallclock::tests::l4_a_query_that_stops_answering_turns_an_old_sync... |
| RV-M1 | M-1: the HALT stop is not refreshed after an output recovery | `crates/z30-engine/src/runtime.rs:927` | KILLED | -p z30-engine --test tx_runtime: rt_halt_after_an_output_recovery_still_silences_the_live_output_from_the_calling_thread |
| RV-M2-retry | M-2: shutdown tries the release once and gives up | `crates/z30-engine/src/runtime.rs:417` | KILLED | -p z30-engine --test tx_runtime: m2_shutdown_retries_an_unconfirmed_release_and_says_so_when_it_stays_unconfirmed |
| RV-M2-report | M-2: shutdown reports the line released whatever its state | `crates/z30-engine/src/runtime.rs:422` | KILLED | -p z30-engine --test tx_runtime: m2_shutdown_retries_an_unconfirmed_release_and_says_so_when_it_stays_unconfirmed |
| RV-M2-cat | M-2: CAT PTT does not command a release when it is opened | `crates/z30-io/src/rigctld.rs:100` | KILLED | -p z30-io --lib: rigctld::tests::d6_only_rprt_0_confirms_a_cat_key_or_release, rigctld::tests::f17_the_cat_ptt_connection_is_open_and_released_befo... |
| RV-L1 | L-1: HALT drives the release on the calling thread | `crates/z30-engine/src/runtime.rs:456` | KILLED | -p z30-engine --test tx_runtime: rt_halt_does_not_wait_for_a_slow_release_driver |
| RV-L3 | L-3: the applied level passes NaN through | `crates/z30-engine/src/runtime.rs:252` | KILLED | -p z30-engine --lib: runtime::tests::the_applied_level_is_within_full_scale_and_nan_is_silence_on_both_paths |
| RV-L4 | L-4: an unanswered clock-status query keeps the old answer as current | `crates/z30-io/src/wallclock.rs:121` | KILLED | -p z30-io --lib: wallclock::tests::l4_a_query_that_stops_answering_turns_an_old_synchronised_into_unknown |
| RV-L5-disarm | L-5: a clock step leaves transmission armed | `crates/z30-engine/src/engine.rs:326` | KILLED | -p z30-engine --test gate_contract: l5_a_clock_step_disarms_transmission_until_the_operator_arms_again |
| RV-L5-abort | L-5: a clock step does not abort a frame in progress | `crates/z30-engine/src/runtime.rs:952` | KILLED | -p z30-engine --test tx_runtime: t2_a_clock_step_between_plan_and_key_abandons_the_plan, l5_a_clock_step_during_a_transmission_aborts_it_and_disarms |
| A-SH-nohalt | shutdown does not halt (no output stop, no disarm) before releasing (tx-safety audit) | `crates/z30-engine/src/runtime.rs:411` | SURVIVED (Low, §6.2) | — |
| A-SH-confirmed | ShutdownReport::release_confirmed treats ReleasePending as confirmed (tx-safety audit) | `crates/z30-engine/src/runtime.rs:397` | KILLED | -p z30-engine --test tx_runtime: m2_shutdown_retries_an_unconfirmed_release_and_says_so_when_it_stays_unconfirmed |
| A-SH-loop | shutdown stops retrying once the line is ReleasePending (retries only while Keyed) (tx-safety audit) | `crates/z30-engine/src/runtime.rs:417` | KILLED | -p z30-engine --test tx_runtime: m2_shutdown_retries_an_unconfirmed_release_and_says_so_when_it_stays_unconfirmed |
| A-CAT-ignore | rigctld PTT: a refused T 0 at open is ignored (line returned as working) (tx-safety audit) | `crates/z30-io/src/rigctld.rs:100` | KILLED | -p z30-io --lib: rigctld::tests::m2_a_rigctld_that_refuses_the_start_up_release_is_not_a_working_ptt |
| A-BG-skippending | HALT's background release skips a line already ReleasePending (tx-safety audit) | `crates/z30-engine/src/ptt.rs:396` | SURVIVED, equivalent (§6.2) | — |
| A-BG-noop | HALT's background release thread drives nothing (tx-safety audit) | `crates/z30-engine/src/ptt.rs:402` | KILLED | -p z30-engine --test tx_runtime: rt_halt_releases_the_ptt_even_while_the_control_thread_is_stuck_in_the_output |
| A-BD-nomark | release_bounded does not mark ReleasePending before trying the line (tx-safety audit) | `crates/z30-engine/src/ptt.rs:234` | KILLED | -p z30-engine --test ptt_release: f16_a_halt_while_the_driver_is_busy_never_blocks_and_the_line_held_by_a_slow_driver_is_left_pending_and_the_watch... |
| A-STOP-stale | M-1: stopper taken from the dead stream (before recover) is installed (tx-safety audit) | `crates/z30-engine/src/runtime.rs:926` | KILLED | -p z30-engine --test tx_runtime: rt_halt_after_an_output_recovery_still_silences_the_live_output_from_the_calling_thread |
| A-CLK-tune | L-5: a clock step leaves a pending Tune armed (tx-safety audit) | `crates/z30-engine/src/engine.rs:327` | KILLED | -p z30-engine --test gate_contract: l5_a_clock_step_disarms_transmission_until_the_operator_arms_again |
| A-CLK-keyedonly | L-5: a clock step aborts only a keyed transmission, not an accepted plan (tx-safety audit) | `crates/z30-engine/src/runtime.rs:952` | KILLED | -p z30-engine --test tx_runtime: t2_a_clock_step_between_plan_and_key_abandons_the_plan |
| A-ABORT-keyedonly | halt/abort ends only a keyed transmission (a planned one survives check_halt) (tx-safety audit) | `crates/z30-engine/src/runtime.rs:834` | KILLED | -p z30-engine --test tx_runtime: rt_halt_between_plan_and_key_abandons_the_transmission_and_disarms, t2_a_clock_step_between_plan_and_key_abandons_... |
| A-LOG-nonfailed | F-17: Partial/Aborted/WatchdogAborted advance the QSO (only Failed does not) (tx-safety audit) | `crates/z30-engine/src/engine.rs:591` | KILLED | -p z30-engine --test gate_contract: f17_only_a_complete_closing_frame_completes_and_logs_the_contact |
| A-LOG-tune | a completed TUNE advances the QSO like a frame (tx-safety audit) | `crates/z30-engine/src/engine.rs:588` | KILLED | -p z30-engine --test gate_contract: t3_a_completed_tune_in_place_of_the_rr73_does_not_complete_the_contact |
| A-CHK-pending | check_hardware never reports a ReleasePending line (only finish does) (tx-safety audit) | `crates/z30-engine/src/runtime.rs:879` | SURVIVED, equivalent (§6.2) | — |
| A-LATE-key | MAX_KEY_LATENESS_SEC 0.5 -> 1.0 (tx-safety audit) | `crates/z30-engine/src/runtime.rs:109` | KILLED | -p z30-engine --test tx_runtime: rt_a_stalled_control_loop_does_not_key_late |
| A-LATE-start | MAX_START_LATENESS_SEC 0.5 -> 0.7 (tx-safety audit) | `crates/z30-engine/src/runtime.rs:113` | SURVIVED at d159e6d (lib tests not in its list); pinned in 6433a48, KILLED by runtime::tests::the_key_and_audio_start_lateness_limits_are_half_a_second | — |
| A-B60-tol | US 60 m centre tolerance 50 -> 59 Hz (tx-safety audit) | `crates/z30-engine/src/bandplan.rs:123` | SURVIVED at d159e6d; pinned in 6433a48, re-run KILLED by bandplan::tests::f02_* | — |
| A-B60-table | US 60 m channel 5358.5 kHz moved to 5357.0 kHz in the table only (tx-safety audit) | `crates/z30-engine/src/bandplan.rs:202` | KILLED | -p z30-engine --lib: bandplan::tests::f02_us_cw_only_sub_bands_and_off_channel_60m_are_refused |
| A-MIG-tkpower | migration imports the Tk wizard's default 50 W as configured power (tx-safety audit) | `crates/z30-io/src/migrate.rs:246` | KILLED | -p z30-io --lib: migrate::tests::f21_a_tk_only_install_and_a_cm108_without_a_pin_bring_no_invented_settings |
| A-MIG-tkptt | migration imports the Tk wizard's default 'CAT Command' PTT (tx-safety audit) | `crates/z30-io/src/migrate.rs:322` | KILLED | -p z30-io --lib: migrate::tests::f21_a_tk_only_install_and_a_cm108_without_a_pin_bring_no_invented_settings |
| A-MIG-cm108pin | migration invents GPIO 3 for a CM108 config with no pin (tx-safety audit) | `crates/z30-io/src/migrate.rs:353` | KILLED | -p z30-io --lib: migrate::tests::f21_a_tk_only_install_and_a_cm108_without_a_pin_bring_no_invented_settings |
| A-MIG-dev | migration takes 'Default System Audio Device' as a device name (tx-safety audit) | `crates/z30-io/src/migrate.rs:375` | KILLED | -p z30-io --lib: migrate::tests::f21_legacy_defaults_are_not_migrated_into_a_transmit_capable_station |
| A-DEV-dupexact | two devices with the same exact name resolve to the first (tx-safety audit) | `crates/z30-io/src/audio.rs:163` | KILLED | -p z30-io --lib: audio::tests::f43_an_ambiguous_device_name_is_refused_not_resolved_to_the_first_match |
| A-LOOP-std | software loopback reaches rigctld via std::net (never executed: env-gated) (tx-safety audit) | `crates/z30-cli/src/loopback.rs:153` | KILLED | -p z30-cli --test loopback_isolation: the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| RV2-D1 | D-1: an arming command sent before HALT is applied after it | `crates/z30-engine/src/runtime.rs:721` | KILLED | -p z30-engine --test tx_runtime: d1_a_command_queued_before_halt_does_not_rearm_the_station_after_it |
| RV2-D1-stamp | D-1: halt() does not advance the epoch | `crates/z30-engine/src/runtime.rs:451` | KILLED | -p z30-engine --test tx_runtime: d1_a_command_queued_before_halt_does_not_rearm_the_station_after_it |
| RV2-D2 | D-2: the exit latch does not stop a key | `crates/z30-engine/src/ptt.rs:357` | KILLED | -p z30-engine --test ptt_exit_latch: d2_after_the_exit_latch_no_line_is_keyed |
| RV2-D6 | D-6: any reply confirms a CAT key or release | `crates/z30-io/src/rigctld.rs:112` | KILLED | -p z30-io --lib: rigctld::tests::d6_only_rprt_0_confirms_a_cat_key_or_release |

### 6.4 Run 5: the F-08 confirmation mutants at `7483f17`

The transmit-safety confirmation's surviving F-08 mutants, re-run against the fix
(`evidence/tx-mutation/mut_f08.py`, `run5_f08_at_7483f17.json`):

| Mutant | Result |
| :--- | :--- |
| F08-dev-iffalse | KILLED by the_software_loopback_refuses_a_character_device_as_its_report_file |
| F08-dev-earlycheck-removed | KILLED by the_software_loopback_refuses_a_character_device_as_its_report_file |
| F08-brace-literals | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| F08-url-slashes | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| F08-mod-decl | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| F08-macro-use | BUILD-FAIL (invalid mutant: E0468, a macro-loading extern crate must be at the crate root; the only form that compiles in loopback.rs, #[macro_use] on a mod, is refused with F08-mod-decl) |
| F08-block-comment-hide | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |

### 6.5 Run 6: the second confirmation's surviving mutants at `3cbdb8a`

`evidence/tx-mutation/mut_f08b.py`, `run6_02d_at_3cbdb8a.json`. N0 is the one survivor: no test can
hold a control thread between its HALT check and `key()`, so the call to `close` in `shutdown` is
checked by reading the code; the latch's own checks in `key()` are pinned by `ptt_release::f84_*`
(each removal killed), and shutdown's post-join re-read stays behind it.

| Mutant | Result |
| :--- | :--- |
| G3-extern-crate-as | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G4-macro-metavar | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G2-rename-in-block | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G5-spaced | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G6-include-space | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items (as include_str !; the first form, include ! of the file itself, did not compile) |
| G1-cr-raw | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| B4-writer-skips-check | KILLED by report_target_tests::the_report_writer_refuses_a_character_device_by_itself |
| B5-hw-plain-fs-write | KILLED by the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag |
| B9-hw-early-check-removed | KILLED by the_hardware_loopback_refuses_a_character_device_as_its_report_file_before_anything_else |
| N0-shutdown-no-close | SURVIVED (Low): shutdown's call to PttController::close removed. No test can hold a control thread between its HALT check and key(); the latch's checks in key() are pinned by ptt_release::f84_*, the call site is by inspection, and the post-join re-read stays behind it. |

### 6.6 Run 7: the auditor's own 02e harness at `6ebb127`

`evidence/tx-mutation/mut_v7_auditor.py` (the auditor's harness, unchanged), `run7_02e_at_6ebb127.json`:
32 mutants, 30 killed, 2 invalid as placed, none survived.

| Mutant | Result |
| :--- | :--- |
| G1 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G2 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G3 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G4 | INVALID (does not compile: the macro_rules! is placed after its use in run(); the compiling form was killed in run 6 and is a case in every_way_round_the_allowlist_a_review_found_is_refused) |
| G5 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G6 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G7 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G8 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G9 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G10 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G11 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G12 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| G13 | INVALID (does not compile here; refused as a case in every_way_round_the_allowlist_a_review_found_is_refused) |
| G14 | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S1-turbofish-in-macro | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S2-use-group-rename-in-macro | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S3-use-group-qself-in-macro | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S4-glob-fs-write-in-macro | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S5-turbofish-process-in-macro | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S6-value-item-named-as-crate | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S9-cfg_attr-tokens | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S11-macro_rules-in-fn | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S13-leading-colons | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S15-type-alias | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| S16-nested-fn-use | KILLED by the_software_loopback_reaches_only_an_allowlist_of_crates_and_items |
| B4 | KILLED by report_target_tests::the_report_writer_refuses_a_character_device_by_itself |
| B5 | KILLED by the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag |
| B5b | KILLED by the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag |
| B9 | KILLED by the_hardware_loopback_refuses_a_character_device_as_its_report_file_before_anything_else |
| N0 | KILLED by runtime::tests::f84_shutdown_closes_the_controller_before_its_halt |
| N3-key-ignores-closed-first-check | KILLED by runtime::tests::f84_shutdown_closes_the_controller_before_its_halt |
| N4-key-ignores-closed-after-drive | KILLED by f84_a_key_in_its_driver_when_the_controller_closes_is_released_before_it_returns |

## 7. Benchmark integrity

- **No figure was produced or changed by this remediation.** No file under `research/results/`
  was edited; the only additions are `18fbd78d8fb8/SUMMARY.md` (generated by
  `summarize_suite.py --partial`, with its not-the-published-run banner) and README notes.
- **The published AWGN and false-decode results reproduce exactly** on the remediated code
  (QA, §5), so the instrument changes did not move the receiver's measurements.
- **Instrument (F-11…F-14, F-32, F-36…F-38, F-42, F-74):** every result carries a `status`
  (`published`, `replicate`, `exploratory`, `dirty`, `not_the_published_run`), its instrument
  identity (now covering all of `z30-protocol`, review QA-B), the dirty-diff hash, ISA and target
  features, `RUSTFLAGS` and the `Cargo.lock` hash; non-published runs go to labelled directories
  and a published file is never replaced; a build with any uncommitted change in a crate it uses
  is `<commit>-dirty` (F-13, probed by the CTO and the QA reviewer); `--per-frame` outcomes and
  `paired_mcnemar.py` make paired comparisons between commits possible; `compare_results.py`
  refuses incomparable results and, with `--reproduction`, certifies a rerun of a published
  result (QA-A).
- **Replicate spread (F-66):** 0.0482 dB over the 11 runs, 0.0496 dB over the ten replicates,
  recomputed independently by the QA reviewer; the pooled 2200-frame crossing is
  −23.0032 [−23.0394, −22.9632] dB, from `awgn_replicate_analysis.json`.
- **Not done:** the other eight suite benchmarks were not re-run; the latency table is marked
  historical (F-35) until `z30 --benchmark perf` is re-run on an idle host; the paired-harness
  provenance fix (F-34) is exercised by CI's paired-harness job but was not run by the QA reviewer
  (no maturin on its host).

## 8. DSP

No receiver, modulator or channel-model algorithm changed (Phase 4 was investigation only, as
the brief requires without a pre-registered experiment). What changed:

- **Tests:** AP through the production receiver (`ap_production.rs`: AP adds decodes and never
  changes or loses one, single-station and in eight six-station bands; wrong assumptions cannot
  produce the assumed call; on noise AP makes no decode, demonstrably runs, and its frequency gate
  demonstrably narrows it); the thread-count determinism test now compares explicit 8- and
  1-thread pools.
- **Tune** is now generated by `gfsk::Modulator` (F-49), with NaN levels silenced on both paths.
- **Documentation corrected** for DSP-01 (SNR bias on corrected fading, exploratory, labelled),
  DSP-04 (pass-2/3 restriction effect unmeasured), DSP-05 (the SIC exclusion rule), DSP-08
  (impairments at 6 kHz), DSP-09 (labelling symmetry for ideal orthogonal FSK) and DSP-10
  (`suppression_db` overstates by 9–16 dB, not a constant).
- **Open:** F-24 (no `snr_fading` benchmark), F-41 (the pass-2/3 restriction's effect is
  unmeasured), F-78 (code distance near the OSD and Trellis gates; the clock stretch applied from
  the window start), F-80 (no AP-on false-decode benchmark). AP is off by default.

## 9. Protocol

Unchanged. CRC-14, the LDPC (216, 77) table, the Costas pattern, the symbol map, the message codec
and the waveform are byte-for-byte as at `78db463`: the CI golden-vector job reproduces
`fixtures/golden/` from the frozen oracle on every push, and `z30-protocol/src` differs only in one
doc comment ("within 1e-6", F-62). SPEC.md changed only in text that describes existing behaviour
(§3 labelling symmetry, §6.3 `CQ TEST`, §7 the OSD condition): no wire-format change.

## 10. Transmit safety

What the transmit path now guarantees, each with tests and mutants (§6) behind it:

- **One gate contract (F-22, F-75).** `can_transmit` checks the hardware too (PTT configured and
  open, no hardware problem, a level in (0, 1], no unconfirmed release, no refused dial), and
  `plan_tx` produces a sealed `TxPlan` carrying exactly what was checked. The transmit path still
  accepts only a `VerifiedFrame`, and the transmitted audio is compared sample for sample with the
  verified frame's synthesis (F-03).
- **A release is confirmed or pending (F-01, F-15, F-44, F-46).** Keyed → ReleasePending →
  Released; drivers run under `catch_unwind`; the watchdog uses `try_lock` and retries a pending
  release; the deadline is armed once; an unconfirmed release refuses transmission and is
  reported until confirmed.
- **A pending release is never dropped (review M-2, audit D-2, D-4, re-review R-4, F-84).**
  `shutdown` retries for up to 2 s and returns a `#[must_use]` `ShutdownReport`. It never drives the
  line on the calling thread, and when the release is unconfirmed it does not wait for the
  runtime's threads, one of which may be wedged in the driver; when it is confirmed it joins them
  and reads the line again. The GUI refuses a hardware settings change while keyed or pending,
  does not restart after an unconfirmed shutdown (and shows why, F-83), and refuses the first close
  of the window. The signal handler first latches the process against any further key, then
  retries for about a second and reports failure. CAT PTT, like serial and CM108, is released when
  opened.
- **HALT never waits, and is the last word (F-16, review M-1, L-1, audit D-1).** It silences the
  current output (re-read after every recovery), requests the release on its own short-lived
  thread, and raises a flag the control thread acts on. Every command carries the HALT epoch it was
  sent in; an arming command (Call CQ, Answer, Enable TX, Tune) sent before the latest HALT is
  dropped, not applied after it.
- **Only a complete frame counts (F-17).** Outcomes `Complete`, `Partial`, `Aborted`, `Failed`,
  `WatchdogAborted`; the frame's end is set when its audio actually starts; a key or start more
  than 0.5 s late abandons the slot; only `Complete` advances the QSO or logs a contact.
- **Output failure (F-19)** stops, releases, refuses and recovers; **rig readback (F-18, F-45)**
  honours the poll interval and PTT settle window, tracks freshness per field, refuses after a
  refused set-frequency and stops a frame the radio moves off; **a clock step (F-48, review L-5)**
  re-seats the receiver, disarms transmission and aborts a frame in progress.
- **Band plan (F-02):** US 6 m/2 m data from 50.1/144.1 MHz; 60 m as the five channels with the
  emission centred within ±50 Hz — the stricter reading, which can only refuse more, until the
  board confirms the reading of 47 CFR 97.305(c)/97.303(h). IARU regions are whole-band
  allocations; the data sub-band is the operator's.
- **No defaults (F-21):** migration writes no transmit level and treats the legacy apps' default
  call, PTT method and dial as unknown; a new or migrated installation cannot transmit until
  configured.
- **Device ambiguity (F-43):** an audio name or empty CM108 path matching more than one device is
  refused, not resolved to the first.
- **Loopback isolation (F-08):** two layers. Semantic: `src/loopback.rs` carries
  `#![forbid(clippy::disallowed_methods, clippy::disallowed_types)]` and
  `crates/z30-cli/clippy.toml` lists the network, file system, processes, audio devices, PTT and
  the live runtime. Clippy resolves names, so no alias, glob, macro or trait call reaches them; CI
  runs clippy with `-D warnings` on every platform; `forbid` cannot be lifted (an inner `allow` is
  `E0453`). Syntactic, as a second layer: an allowlist of what the file may
  name, checked by parsing `src/loopback.rs` as Rust (`syn`), and required, not a backup: clippy
  sees only calls made in that file, so this is what refuses the crate's other functions and every
  `z30_io` item. It also pins the forbid set (with `unsafe_code`), the whole `clippy.toml` list and
  the absence of any other clippy configuration. The parse covers every path, `use` tree, macro
  invocation and its tokens, attribute and item outside a final `#[cfg(test)] mod tests`. `std`
  only by listed sub-path (no file system, network or process; T-1); no `extern crate`, item
  macros, `mod`, renamed or glob imports, `$`, unlisted macros, or uppercase roots the file
  neither declares nor imports. It replaced a text scanner that four review rounds got round
  (I-2, R-2, 02c, 02d); every bypass found is a test case. Both loopback tests write their report
  only to a file: `--out` is checked before anything else runs, and a device (a tty asserts DTR/RTS
  when opened; Windows device names and namespace paths) is refused (R-3, 02c, 02d).

- **A stopping station never keys (F-84).** `shutdown` closes the controller before its HALT;
  `key()` refuses on a closed controller under the line lock after its state goes `KEYED`, and
  releases a key that was in its driver when the controller closed. An unconfirmed shutdown drops
  the last controller on a short-lived thread, not the caller's.

Open on the transmit path: **F-81** (Low): a backward clock step smaller than about a slot during a
frame, or a dropped `ClockStepped`, can hold the line keyed until the independent 40 s watchdog
releases it (§11). The watchdog bounds it; nothing shortens it yet.

What the reviews could not establish and no test covers: the GUI's behaviour (no GUI test
harness; checked by inspection), the call to `close` in `shutdown` (run 6 N0; no test can stage
the race it closes), and anything about real drivers: every line, device and rigctld in these
tests is a fake.

## 11. Remaining limitations, board decisions and open items

**Board decisions** (only the licensed operator can make them): F-02 (the US band-plan reading),
F-25 and F-30 (the FT8 comparison's framing; the wording follows AGENTS.md §5 exactly), F-40 (the
crossing-delta statistic in research-process.md §2a binds only if accepted), M-08 (whether the
radio's own time-out timer is accepted as the last layer for CAT and CM108 after SIGKILL or power
loss), and the PR's size (review L-6: the board may accept per area).

**Open:** F-24, F-41, F-78, F-80 (§8); **F-81** (transmit path, Low: the frame's end is timed on
the wall clock; a backward step smaller than about a slot is not a `ClockStepped`, and that event
is sent by `try_send` and can be dropped while the control thread stalls, so a step during a frame
can hold the line keyed until the 40 s watchdog releases it); F-82 (research-tool follow-ups: `paired_mcnemar.py` cannot run research-process §2a's pooled replicate design, busy-band pairs are clustered, false decodes are not paired, a symlink in `--out` bypasses the published-directory check).

**Documented limitations:** F-35 (historical latency table), F-39 (cited logs never committed),
F-56 (v1 sends a clamped report, not a bound), F-65 (an old SUMMARY header), F-73 (loose result
files). Also: the watchdog can do nothing for VOX (the bound is the finite queued audio); the
GUI's M-2 behaviour is checked by inspection only (there is no GUI test harness); pyo3 0.25.1 in
the research-only bindings carries two advisories ignored in CI with the reason (F-50 residual);
GitHub Actions are pinned by tag, not SHA.

**Pending review at the final head:** none.

## 12. Hardware status: NOT VALIDATED

No part of z-30 has been run against a real radio, sound card, PTT interface, serial port, CM108
device or rigctld, and nothing has been transmitted. The pre-test checklist
([`hardware-validation/PRETEST_CHECKLIST.md`](../../hardware-validation/PRETEST_CHECKLIST.md)) is
**NOT READY**: it lists what must be shown before the board decides whether a dummy-load test may
proceed (proposed tests R9–R12: HALT, output failure, an unconfirmed release, late key; R8: the
serial DTR/RTS state at port open), and only the board's recorded decision authorises one.

**Validation state: protocol validated; software simulation validated; hardware not validated;
on-air not validated.**
