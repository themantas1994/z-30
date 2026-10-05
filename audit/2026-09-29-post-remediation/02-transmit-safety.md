# Transmit-safety audit: PR #46, `claude/nice-archimedes-epwg4o`

**Verdict: FINDINGS.** I found one code defect that makes the station transmit after HALT. I also found four High test gaps: in each, a mutation that lets the station transmit (or log) when it should not survives every test. The code at c164dd0 is correct on those four by inspection; the tests just don't pin it.

Hardware is **NOT VALIDATED**. Every result below comes from fake parts in software. Nothing opened an audio device, serial port, CM108, rigctld or PTT line, and nothing was keyed.

## Commit and setup
- **Target:** c164dd0 against base 78db463.
- **Mutations ran in** `/tmp/claude-0/mut-v3` at ea6dd69. `git diff --stat ea6dd69 c164dd0 -- crates/z30-engine crates/z30-io crates/z30-cli crates/z30-gui` is empty, so the transmit code is identical.
- **Worktree:** restored with `git checkout -- .` after every mutant. It is clean at the end, and so is `/home/user/z-30`. I wrote nothing to the repository.
- **Toolchain:** `cargo +1.95 test --release --locked`, `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target`.

## Commands
1. **Baseline at ea6dd69, all pass:**
   - `-p z30-engine --test safety(29) --test emergency(1) --test dial_provenance(7) --test tx_runtime(25) --test gate_contract(13) --test ptt_release(9) --test ptt_panic(2) --test clock_step(3) --test qso_logging(4) --lib(9)`
   - `-p z30-protocol --test frame_integrity(2) --test round_trip(6)`
   - `-p z30-cli --test loopback_isolation(4)`
   - `-p z30-io --test callback_alloc(2) --lib(21)`
2. **My mutants:** `W=/tmp/claude-0/mut-v3 CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target MUT_OUT=<scratchpad>/mut.json python3 <scratchpad>/mut_audit.py <IDs>`. Same mechanics as `mutate_tx_v3.py`: one edit at a time, targeted test binaries, tree restored after each.
3. **Probes:** `probe2.py`, `probe3.py` and `combo.py` each add one test to unmodified code. Each is run once without the mutation, then once with it.
4. **Independent re-run of 5 harness mutants:** `mutate_tx_v3.py C06-b N3-sym G-relpend P-relflag RT-haltflag`. All 5 were KILLED, matching run 3: `every_kind_of_corrupted_frame_is_refused`, `f22_can_transmit_itself_refuses_missing_or_uncertain_hardware`, `n3_the_transmitted_audio_is_the_verified_frame…`, `ptt_release::f01_*`, `rt_halt_between_plan_and_key…`.

The evidence files are in the session scratchpad `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/`:
- scripts: `mut_audit.py`, `probe2.py`, `probe3.py`, `combo.py`
- logs and results: `mut.log`, `mut.json`, `probe.json`, `phase2.log`, `rerun_v3.log`, `baseline.txt`

The scratchpad is session-local. Copy these into `audit/…/evidence/` if the board needs them.

## Mutant table (24 mutants plus 1 combined, none of them in `mutate_tx_v3.py`; line numbers at ea6dd69)

| ID | Mutation | Result | Killing test / note |
|---|---|---|---|
| A-SH-nohalt | `runtime.rs:383` shutdown does not call `halt()` first | SURVIVED | Low. The control thread's own exit stops the output and unkeys. The difference only shows if the control thread is stuck. |
| A-SH-confirmed | `runtime.rs:369` `release_confirmed` treats ReleasePending as confirmed | KILLED | `tx_runtime::m2_shutdown_retries_an_unconfirmed_release_and_says_so…` |
| A-SH-loop | `runtime.rs:386` shutdown retries only while Keyed | KILLED | `m2_shutdown_retries…` |
| A-CAT-ignore | `rigctld.rs:100` a refused `T 0` at open is ignored | KILLED | `rigctld::tests::m2_a_rigctld_that_refuses_the_start_up_release_is_not_a_working_ptt` |
| A-BG-skippending | `ptt.rs:371` HALT's background release skips a ReleasePending line | SURVIVED | Equivalent: the watchdog retries ReleasePending every 50 ms. Latency only. |
| A-BG-noop | `ptt.rs:377` the background release thread drives nothing | KILLED | `rt_halt_releases_the_ptt_even_while_the_control_thread_is_stuck_in_the_output` |
| A-BD-nomark | `ptt.rs:234` `release_bounded` does not mark ReleasePending | KILLED | `ptt_release::f16_a_halt_while_the_driver_is_busy…` |
| A-STOP-stale | `runtime.rs:884` the stopper is taken from the dead stream, before `recover` | KILLED | `rt_halt_after_an_output_recovery_still_silences_the_live_output…` |
| A-CLK-tune | `engine.rs:327` a clock step leaves a pending Tune armed | KILLED | `gate_contract::l5_a_clock_step_disarms_transmission…` |
| **A-CLK-keyedonly** | `runtime.rs:910` a clock step aborts only a keyed transmission, not a plan that was accepted but not yet keyed | **SURVIVED** | Not equivalent. With it, probe2 shows a disarmed station keying (T-2). |
| A-ABORT-keyedonly | `runtime.rs:792` `abort` ends only a keyed transmission | KILLED | `rt_halt_between_plan_and_key_abandons_the_transmission_and_disarms` |
| A-LOG-nonfailed | `engine.rs:591` Partial, Aborted and WatchdogAborted advance the QSO | KILLED | `gate_contract::f17_only_a_complete_closing_frame…` |
| **A-LOG-tune** | `engine.rs:588` a completed TUNE advances the QSO like a frame | **SURVIVED** | Not equivalent. Probe3 shows a contact logged without its RR73 (T-3). |
| A-CHK-pending | `runtime.rs:837` `check_hardware` never reports ReleasePending | SURVIVED | Mirror of RT-relfault, covered by `finish`. Both together: KILLED (next row). |
| A-COMBO | RT-relfault + A-CHK-pending | KILLED | `rt_an_unconfirmed_release_is_reported…`, `rt_an_unconfirmed_release_is_a_gate_refusal…` |
| A-LATE-key | `runtime.rs:109` `MAX_KEY_LATENESS_SEC` 0.5 → 1.0 | KILLED | `rt_a_stalled_control_loop_does_not_key_late` |
| A-LATE-start | `runtime.rs:113` `MAX_START_LATENESS_SEC` 0.5 → 0.7 | SURVIVED | Low. The tests only pin it below 0.75 s; the behaviour itself is tested. |
| A-B60-tol | `bandplan.rs:123` 60 m centre tolerance 50 → 59 Hz | SURVIVED | Low. `gate_contract` tests ±60 Hz and `bandplan::tests` tests relative to the constant, so 50–59 Hz is not pinned. |
| A-B60-table | `bandplan.rs:202` channel 5358.5 → 5357.0 kHz in the table | KILLED | `bandplan::tests::f02_…` |
| A-MIG-tkpower | `migrate.rs:246` the Tk wizard's default 50 W imported as configured power | SURVIVED | T-4 |
| A-MIG-tkptt | `migrate.rs:322` the Tk default "CAT Command" PTT imported | SURVIVED | T-4 |
| A-MIG-cm108pin | `migrate.rs:353` GPIO 3 invented for a CM108 config with no pin | SURVIVED | T-4 |
| A-MIG-dev | `migrate.rs:375` "Default System Audio Device" taken as a device name | KILLED | `migrate::tests::f21_…` |
| **A-DEV-dupexact** | `audio.rs:163` two devices with the same exact name resolve to the first | **SURVIVED** | T-4. Two identical USB codecs is a common setup. |
| **A-LOOP-std** | `loopback.rs:153` the software loopback opens a TCP connection and writes `T 1` via `std::net` (env-gated, never executed) | **SURVIVED** | T-1 |

**Totals:** 24 single mutants, 13 KILLED, 11 SURVIVED. Of the survivors:
- 2 are equivalent (A-BG-skippending, A-CHK-pending; the combined mutant is killed).
- 4 are Low: A-SH-nohalt, plus three threshold or provenance pins (A-LATE-start, A-B60-tol, and A-MIG-tkpower, which is a power label with no transmit effect).
- 5 are real test gaps.

**Severity rule I used:** a surviving, non-equivalent mutant is High when the mutated code is the only thing enforcing a §4 guarantee. It is Medium when another layer still refuses until the operator acts.

## The three equivalence claims in run 3
- **G-plan: agree, strictly equivalent.** At `engine.rs:537-540` a refusal with no violations gets `FrameNotForMessage` pushed. `txgate.rs:316` sets `allowed` only when the list is empty. So at line 541, `!allowed` and `!violations.is_empty()` are the same condition.
- **RT-relfault: agree, equivalent for transmission; it differs only in when the report appears (at most one 5 ms control-loop pass later).** Three things hold:
  - The next loop pass runs `check_hardware` (`runtime.rs:703`) before `txs.tick`, so the gate sees `ptt_release_unconfirmed` before any Plan.
  - `PttController::key` refuses while ReleasePending (`ptt.rs:332`).
  - Every `finish()` that could come before a Plan in the same pass is followed by `tx_fault`, which disarms.
  
  Caveat: the mirror mutant A-CHK-pending also survives. Each reporting path covers for the other, and only both together are tested; A-COMBO is killed.
- **CAT-lazy: agree, equivalent.** `RigctldPtt::connect` now sends `ptt.set(false)`, which goes through `command()`, which calls `connect()` (`rigctld.rs:45`). The connection still exists before the first key, and an absent rigctld is still an error at start-up. Only the error text differs.

## Findings

### D-1 [High]: a command sent before HALT is applied after it and re-arms the station
- **Where:**
  - control loop: `crates/z30-engine/src/runtime.rs:683` (`check_halt` at the top), `:685-695` (command applied), `:780-788` (`check_halt`)
  - `halt()` at `:418-424` uses a flag, not the queue
  - arming commands: `engine.rs:251-255` (CallCq), `:256-272` (Answer), `:273-278` (EnableTx(true)), `:284` (Tune)
  - GUI: `crates/z30-gui/src/app.rs:184-190` (commands use `try_send` on the queue), `:465` (`rt.halt()`)
- **What happens:**
  1. The control thread is blocked, for example in a slow rigctld `T 1` (1.5 s timeouts) or in `finish`'s `unkey` waiting behind HALT's background release. This is the F-16 scenario.
  2. The operator clicks Tune, Call CQ or Answer, or toggles Enable TX on, and then presses HALT.
  3. `halt()` raises the flag at once; the arming command is already waiting in the queue.
  4. When the control thread unblocks, `check_halt` consumes the flag (disarm, abort). The `select!` then takes the queued Tune or CallCq, and the station is armed again.
  5. It transmits at the next slot.
- **Evidence:** the probe test `audit_probe_a_command_queued_before_halt_does_not_rearm_after_it`, added to unmodified `tx_runtime.rs`, **fails**. Key setup:
  ```rust
  let held = st.line.key_gate.lock().unwrap();      // control thread stuck in set(true)
  … st.wait(… ptt_state() == PttState::Keyed);
  st.rt().commands.send(Command::Tune).unwrap();     // Tune, then HALT
  st.rt().halt();
  drop(held);
  // next slot: line changes [(4950,true),(4950,false),(34950,true)],
  // events [TxFinished{Aborted("halted by the operator")}, TxStarted{slot: SLOT+1, text: "TUNE"}]
  ```
- **Invariant broken:** "HALT means halt" / HALT never waits (F-16). The station transmits after the operator's last action, which was HALT. The emission is still gate-checked and in-band.
- **Fix:** give HALT an epoch.
  - `halt()` increments an `AtomicU64`.
  - Commands are sent through a `RuntimeHandle::send` that stamps the current epoch.
  - The control loop drops arming commands (CallCq, Answer, EnableTx(true), Tune) stamped before the current epoch.
  - A minimal alternative: `check_halt` drains `cmd_rx` without blocking, discards arming commands and applies the rest.
  - Keep the probe as a regression test, covering Tune, CallCq, Answer and EnableTx(true).

### T-1 [High, test gap]: the loopback allowlist admits all of `std` (F-08, CTO I-2)
- **Where:** `crates/z30-cli/tests/loopback_isolation.rs:158`. `ROOTS` contains `"std"`, and the deny-list has no `net`, `process` or `fs`.
- **What happens:** an edit to `src/loopback.rs` such as `std::net::TcpStream::connect("…:4532")` plus `write_all(b"T 1\n")` passes all four guard tests (mutant A-LOOP-std SURVIVED). So would `std::process::Command::new("rigctl"|"aplay")`, or `std::fs::OpenOptions` on a tty (opening one asserts DTR and RTS on Linux). An obfuscated `include!(concat!("audio_", "loopback.rs"))` also evades both lists.
- **Invariant:** "Loopback never transmits". The guard is the only thing enforcing it. The grouped-import fix closed I-2's specific bypass but not the `std::process` route the CTO also named.
- **Fix:** allowlist `std` sub-paths (`std::f64`, `std::time`, `std::collections`, …). Explicitly refuse `std::net`, `std::process`, `std::fs`, `std::os` and `include!`.

### T-2 [High, test gap]: L-5 abort of a plan that was accepted but not yet keyed is untested
- **Where:** `runtime.rs:910`. Mutant A-CLK-keyedonly SURVIVED.
- **What happens if it regresses:** a clock step arrives between the plan (0.6 s before the slot) and the key. The engine disarms, but the plan already accepted would still be keyed.
- **Evidence:** probe2 (`audit_probe_a_clock_step_between_plan_and_key_abandons_the_plan`) passes on the unmodified code. Under the mutant it fails with `keyed a plan accepted before the clock step: [(4950, true)]`.
- **Fix:** add probe2 to `tx_runtime.rs`. It is a ready-made killing test.

### T-3 [High, test gap]: a completed TUNE must not advance or log a QSO
- **Where:** `engine.rs:588`. The `was_frame` check predates the diff. Mutant A-LOG-tune SURVIVED.
- **What happens if it regresses:** the operator presses Tune in the slot where the RR73 was due. The tune ends Complete and the contact is logged although the closing frame was never sent ("only a complete frame counts").
- **Evidence:** probe3 (`audit_probe_a_completed_tune_in_place_of_rr73_does_not_complete_the_contact`, in `gate_contract.rs`) passes unmodified and fails under the mutant.
- **Fix:** add probe3.

### T-4 [High / Medium, test gaps]: device ambiguity and migration defaults (F-43, F-21)
- **A-DEV-dupexact (High):** two devices with the identical name "USB Audio CODEC" are not tested. `audio.rs:163` refuses correctly today. Fix: add `["USB Audio CODEC", "USB Audio CODEC"]` with the wanted name "usb audio codec" and expect an error to `f43_…`.
- **Migration (Medium):** a later refusal still applies, because the migrated tx_level of 0 is refused until the operator sets a level. The untested paths are:
  - A-MIG-tkptt: a Tk-only legacy install whose PTT is the default "CAT Command" (`migrate.rs:322`).
  - A-MIG-cm108pin: CM108 with no `cm108GpioPin` (`:353`).
  - A-MIG-tkpower (Low): the Tk default 50 W (`:246`). This one is a provenance label only, with no transmit effect.
  
  Fix: add Tk-only and CM108-without-pin fixtures to `f21_…`.

### D-2 [Low]: emergency release does not stop a key that follows it
- **Where:** `crates/z30-gui/src/main.rs:35-47`; `ptt.rs:263-274` and `:326` (the `key()` compare-and-swap from Released).
- **What happens:**
  1. SIGTERM arrives at the start of a slot.
  2. `emergency_release_all()` finds the line Released, or confirms its release, and returns true.
  3. Before `process::exit(143)` completes, the control thread's `TxAction::Key` runs `key()`: Released → Keyed, then `T 1` or the HID write.
  4. The process exits. rigctld or the CM108 GPIO keeps the radio keyed until the radio's own time-out.
- **Likelihood:** the window is narrow (microseconds to milliseconds, once per transmission).
- **Fix:** a process-wide latch, set by the exit and signal paths before they release, that `key()` checks after its compare-and-swap (refuse, then release).

### D-3 [Low]: residual of L-5
- **Where:** `slots.rs:161` (a backward step smaller than about one slot is not a `ClockStepped`); `runtime.rs:538` (`ClockStepped` goes out by `try_send` and is dropped if the channel is full while the control thread stalls); `runtime.rs:233` (the frame's end is still in wall time).
- **What happens:** a wall-clock step backward during a frame holds the line keyed, with the audio finished, until the clock catches up. The 40 s watchdog bounds it.
- **Fix:** time `Playing.end_at` on the monotonic clock, as the CTO suggested. Send `ClockStepped` with a blocking send that has a timeout.

### D-4 [Low]: "bounded" shutdown is bounded only by driver timeouts
- **Where:** `runtime.rs:384-389` calls `unkey()`, which blocks in `lock_line()` (`ptt.rs:219`).
- **What happens:** a driver that never returns (for example a wedged HID write) blocks the GUI's `on_exit` indefinitely.
- **Fix:** use `release_bounded(…, SHUTDOWN_RELEASE_WAIT_MS)` in the retry loop.

### D-5 [Low]: the GUI's close warning fires only once per session
- **Where:** `app.rs:131`, `:308-318`. `close_warned` is never reset.
- **What happens:** the operator closes once during an ordinary keyed frame and gets the warning. A later close while a release is unconfirmed exits without warning.
- **Fix:** reset `close_warned` when `ptt_state()` returns to Released.

### D-6 [Info]: CAT PTT confirmation is too loose
- **Where:** `rigctld.rs:56,107`. Any reply line not starting with `RPRT` counts as a confirmed `T 0`/`T 1`.
- **Fix:** require exactly `RPRT 0` for PTT.

## CTO M-1 and M-2
- **M-1: closed.**
  - `runtime.rs:885` refreshes the stopper after every successful `recover`.
  - The fake output's `recover` now bumps a generation, so the old stop silences nothing, as a real reopened stream would.
  - Mutants RV-M1 (run 3) and A-STOP-stale are killed.
  - `CpalOutput::recover` replaces `self` (`audio.rs:408`) and is the only place the stream changes, so the refresh covers it. No playback runs while recovering (`!txs.busy()`).
- **M-2, engine and io parts: closed.**
  - `shutdown` retries for 2 s and returns a `#[must_use] ShutdownReport`; A-SH-confirmed, A-SH-loop and RV-M2-* are killed.
  - `RigctldPtt::connect` commands `T 0` and refuses on failure; A-CAT-ignore and RV-M2-cat are killed.
- **M-2, GUI parts: reasonable by inspection (there is no GUI test harness):**
  - `apply_settings` refuses audio, PTT and rig changes unless the line is Released (`app.rs:258`).
  - It does not restart after an unconfirmed shutdown (`:272-284`). `self.rt` then stays `None`, so Apply cannot restart it either.
  - The close guard is at `:308-318`, with the D-5 caveat.
  - `on_exit` prints the report (`:631-643`).
  - The signal handler retries 10 times and prints on failure (`main.rs:35-47`). Worst case is about 20 s if a driver holds the line, because each `emergency_release_all` waits up to 2 s.
  - Residual risks: D-2, D-4, D-5.
- **Other CTO items:**
  - **L-1 closed:** RV-L1 and A-BG-noop are killed.
  - **L-2 closed:** CI now runs `cargo test -p z30-io --features cm108 --lib … cm108` (`rust.yml:116`).
  - **L-5 partly closed:** disarm and abort exist, but see T-2 and D-3.
  - **I-2 partly closed:** see T-1.

## Per-row verdicts

| Row | Verdict | Evidence |
|---|---|---|
| F-01 | VERIFIED | P-relflag, P-retry, P-rekey (run 3; P-relflag re-run KILLED); A-BD-nomark, A-SH-loop, A-SH-confirmed, A-COMBO KILLED; RT-relfault and A-CHK-pending each equivalent alone, KILLED together |
| F-02 | VERIFIED (implementation; the regulatory reading stays BOARD_DECISION) | B-6m, B-2m, B-60c (run 3), A-B60-table KILLED; A-B60-tol survives (Low, 50–59 Hz not pinned) |
| F-03 | VERIFIED | N3-sym re-run KILLED; N3-freq, N3-plvl (run 3) |
| F-04 | VERIFIED | RT-* in run 3; RT-haltflag re-run KILLED; A-ABORT-keyedonly, A-STOP-stale, A-BG-noop KILLED. New loop gaps are tracked as D-1 and T-2. |
| F-05 | VERIFIED | G-bw, G-centre, G-top (run 3) |
| F-06 | VERIFIED | P-max, P-hook (run 3) |
| F-07 | VERIFIED | G-nan, G-over, N3-level, RV-L3 (run 3) |
| F-08 | **NOT VERIFIED** | T-1: A-LOOP-std SURVIVED |
| F-09 | VERIFIED | PWR-a (run 3) |
| F-15 | VERIFIED | P-unwind, P-wdblock, P-drivewait (run 3); `ptt_panic` passes |
| F-16 | **NOT VERIFIED** | D-1: the probe shows a TUNE transmitted after HALT. M-1 and L-1 themselves are closed. |
| F-17 | VERIFIED | RT-lateend, RT-latekey, RT-latestart, RT-partial, RT-outcome, CAT-lazy (equivalent); A-LOG-nonfailed, A-LATE-key KILLED; A-LATE-start Low pin; T-3 (Tune) is a pre-existing gap, filed separately |
| F-19 | VERIFIED | RT-outfail, RT-playstop, OUT-err, OUT-alloc (run 3); `callback_alloc` passes |
| F-21 | **NOT VERIFIED** | Code correct by inspection, but A-MIG-tkptt, A-MIG-cm108pin and A-MIG-tkpower SURVIVED (T-4) |
| F-22 | VERIFIED | G-relpend re-run KILLED; G-hwptt, G-hwopen, G-dialref, G-hwprob (run 3); G-plan equivalent |
| F-43 | **NOT VERIFIED** | A-DEV-dupexact SURVIVED (T-4). The serial DTR/RTS-on-open behaviour is still a dummy-load (hardware) item. |
| F-44 | VERIFIED | P-rearm (run 3) |
| F-45 | VERIFIED | G-dialref, RIG-refused, RT-midtx (run 3) |
| F-46 | VERIFIED | RT-wd (run 3); the VOX limitation is documented |
| F-75 | VERIFIED (inspection) | `TxPlan` fields are private to `engine.rs`, the only constructor is `plan_tx`, and only `Clone` is derived; the runtime reads level and frequency from the plan |

Hardware and on-air validation remain **NOT VALIDATED**.