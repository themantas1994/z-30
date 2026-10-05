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
