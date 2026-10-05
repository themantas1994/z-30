# Transmit-safety mutation evidence

| File | What |
| :--- | :--- |
| `mutate_tx_v2.py` | Harness for runs 1–2: the 2026-09-28 audit's mutants re-targeted at the remediation, plus one per new guarantee (82). Kept unchanged as the evidence of those runs. |
| `run1_at_8a98bbc.json`, `.log.txt` | Run 1, 82 mutants at `8a98bbc`: 74 killed, 8 survived. |
| `run2_survivors_at_55a606c.log.txt` | The 8 survivors after the killing tests were added: 6 killed; G-plan and RT-relfault survived. |
| `final.json` | The result of every v2 mutant after runs 1–2. |
| `run3_survivors_at_a49d655.*` | G-plan and RT-relfault re-run after `b667625`: still survive. |
| `mutate_tx_v3.py` | Harness for run 3: v2's 82 (four patterns re-targeted at the post-review code, same intent) plus nine mutants for the post-remediation code-review fixes (RV-*). |
| `run3_v3_at_ea6dd69.json`, `.log.txt` | **Run 3, all 91 at `ea6dd69`: 88 killed, 3 survived.** The run was stopped twice by the session's background time limit and resumed (the harness skips finished mutants and restores the tree before each); the log is the three parts concatenated. |

| `mutate_tx_v4.py` | Harness for run 4: v3's 91, the tx-safety auditor's 24 (`audit/2026-09-29-post-remediation/evidence/tx-safety-audit/mut_audit.py`; A-SH-nohalt and RT-halt re-targeted, same intent) and four for that audit's fixes (RV2-*). |
| `run4_v4_at_d159e6d.json`, `.log.txt` | **Run 4, all 119 at `d159e6d`: 111 killed, 8 survived** (resumed after the background time limit, as run 3). Five survivors are equivalent (below, plus A-BG-skippending: the watchdog retries a pending release every 50 ms; A-CHK-pending: the mirror of RT-relfault, killed together with it in the auditor's A-COMBO). Three were Low untested pins: A-B60-tol and A-LATE-start are pinned as numbers in `6433a48` (A-B60-tol re-run: KILLED by `bandplan::tests::f02_*`; A-LATE-start: KILLED by `runtime::tests::the_key_and_audio_start_lateness_limits_are_half_a_second`, which is in the engine's lib tests that run 4's list for that mutant did not include; the list now does). **A-SH-nohalt** remains a Low survivor: shutdown's own halt matters only when the control thread is stuck, and the control thread's exit stops the output and unkeys otherwise. |
| `mut_f08.py`, `run5_f08_at_7483f17.json`, `.log.txt` | **Run 5, the transmit-safety confirmation's F-08 mutants (02c) against the fix at `7483f17`: 6 killed, 1 invalid** (the `#[macro_use] extern crate` form does not compile outside the crate root; its compiling form, on a `mod`, is the killed F08-mod-decl). The device-refusal mutants are killed by `loopback_report_target`, the guard bypasses by the allowlist test. |
| `mut_f08b.py`, `run6_02d_at_3cbdb8a.json`, `.log.txt` | **Run 6, the second transmit-safety confirmation's surviving mutants (02d) against `3cbdb8a`: 10 mutants, 9 killed, 1 survived.** The syn-based guard kills every allowlist bypass (extern crate as, macro metavariable, renamed import in a block, spacing, `include_str !`, raw C strings); the device-refusal mutants are killed by the writer's unit test, the hardware loopback's behaviour test and the source assertion. **N0** (shutdown no longer calls `PttController::close`) survives: no test can stage the race; the latch's own checks are pinned by `ptt_release::f84_*`. |

The three survivors of run 3, each judged equivalent (no test can observe the difference):

- **G-plan** (`engine.rs`): `if !perm.allowed` → `if !perm.violations.is_empty()`. The lines above
  push `FrameNotForMessage` whenever the gate refuses with no violation, and `txgate.rs` sets
  `allowed` only when the violations are empty, so the two conditions agree at that line.
- **RT-relfault** (`runtime.rs`): the direct report of an unconfirmed release in `finish` removed.
  `check_hardware` reports the `ReleasePending` state one control-loop pass later, or, if a
  watchdog retry already confirmed it, the refused-then-confirmed path does (`b667625`). The
  difference is one loop pass of latency.
- **CAT-lazy** (`rigctld.rs`): the explicit `connect()` in `RigctldPtt::connect` removed. Since
  review M-2 the constructor commands `T 0` at once, which connects on demand, so the connection
  still exists before the first key and an absent rigctld is still an error at start-up; only the
  error's wording differs.

Code after `ea6dd69` up to the final head changes no transmit code (z30-dsp tests and doc comments,
docs, audit files).
