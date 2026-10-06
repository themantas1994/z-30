# CTO code review (docs/research-process.md §3): PR themantas1994/z-30#46

**Verdict: READY AFTER FIXES.** No Blocker. Every gate passes on Rust 1.95 and no AGENTS.md §4 safety test was weakened. Three Medium findings remain in the HALT and PTT-release paths. They affect F-01 and F-16, which this review cannot mark VERIFIED yet.

This review is evidence for the board. It is not permission to merge. Nothing was merged, pushed, approved or keyed, and no audio device, PTT line, serial port, CM108 device or rigctld was opened.

## Commit reviewed

- Base `78db463b94604dba1580e07bf6ee19903c0c7125`. `git merge-base 78db463 ee42ae6` returns 78db463.
- Head `ee42ae601cc00c4af39ac3520be6612d3d71c3cc` (branch `claude/nice-archimedes-epwg4o`), 32 commits.
- Size: `git diff --stat 78db463..ee42ae6` gives 116 files, +13 612 / −858.
- Built and tested in a detached worktree `/tmp/claude-0/review-cto` at ee42ae6, with `CARGO_TARGET_DIR=/tmp/claude-0/review-cto-target`, using `cargo 1.95.0` and `rustc 1.95.0 (59807616e 2026-04-14)`.
- **The branch moved while this review ran.** `/home/user/z-30` is now at `a25d5a9` and adds `da090fa docs(audit): re-run the two surviving transmit mutants…`, `3fbf952 docs: fix the 13 findings…` and `a25d5a9 docs(audit): docs-honesty review…`. It also has uncommitted changes that were not made by this reviewer. **None of that was reviewed.** Under research-process §4, a push after review sends the changed part back to §3.

## Commands run and results

| Gate / check | Command (in the worktree at ee42ae6) | Result |
| :--- | :--- | :--- |
| fmt | `cargo +1.95 fmt --all --check` | exit 0 |
| clippy | `cargo +1.95 clippy --workspace --all-targets --exclude z30-py -- -D warnings` | exit 0 |
| clippy, CM108 feature (as the MSRV CI job runs it) | `cargo +1.95 clippy --workspace --all-targets --exclude z30-py --locked --features z30-cli/cm108,z30-gui/cm108 -- -D warnings` | exit 0 |
| tests, release | `cargo +1.95 test --workspace --exclude z30-py --release --locked` | exit 0. 241 passed, 0 failed, 2 ignored, across 38 result lines. Both ignores already existed at 78db463: `explore_spread_estimator_scatter` and `golden_ldpc::screen_osd_pool`. This matches the author's `evidence/final-gate/test.txt` exactly. The run was done while another agent's benchmark kept the load average at 10–15. |
| tests, debug (subset) | `cargo +1.95 test --locked -p z30-engine -p z30-io` | exit 0, 124 passed. **The full debug workspace test that CI also runs (rust.yml:48) was NOT RUN** because of time. |
| flakiness | release `tx_runtime`, `ptt_release`, `ptt_panic` and `clock_step`, run 5× under load ≈ 10 | 5/5 pass |
| CM108 unit test | `cargo +1.95 test --release --locked -p z30-io --features cm108 --lib cm108` | 1 passed. CI never runs this test (finding L-1). |
| F-13 provenance probe | `cargo build --release -p z30-cli`, then `z30 --version` on a clean tree; again after appending a comment to `crates/z30-dsp/src/lib.rs` without staging it; again after reverting | `ee42ae601cc0`, then `ee42ae601cc0-dirty` with `dirty diff: sha256 960e50af6248`, then `ee42ae601cc0` |
| HALT probe | `tx_runtime` fakes copied to a scratch test, with a release driver that takes 100 ms. The test was deleted afterwards and the tree left clean. | `halt()` returned after **100.1 ms**, so HALT runs the driver on the calling thread. No spurious TxFault was seen. |
| cargo audit | `cargo-audit audit --db <scratch> --ignore RUSTSEC-2026-0176 --ignore RUSTSEC-2026-0177` | exit 0. The crates.io yanked check returned 503, which is informational only. Without the ignores: exit 1, with exactly two advisories, both against pyo3 0.25.1. z30-py uses `PyList::empty` only (no `nth`, no `new_closure`). |
| research tools | `python3 -m pytest research/tests -q` | 26 passed |
| generated SUMMARY | copied `research/results/18fbd78d8fb8` without `SUMMARY.md` to scratch, then ran `summarize_suite.py <copy> --partial --write` and compared | identical except the title line, which names the directory |
| golden / frozen | `git diff --stat 78db463..ee42ae6 -- fixtures legacy reference tests/vectors` | no changes |
| unsafe | `git diff … -- crates \| grep '^\+.*\bunsafe\b'` | only two comments. `z30-io`, `z30-gui` and `z30-channel` now `#![forbid(unsafe_code)]`. |
| dependencies | `git diff … -- Cargo.lock Cargo.toml crates/*/Cargo.toml` | only the `z30-py` version (`0.1.0-dev.0`), so the closure of z30-cli and z30-dsp is unchanged |
| Linux/Windows/macOS CI on GitHub | — | **NOT CHECKED.** No `gh` CLI was available here. |
| transmit mutation harness | — | **NOT RE-RUN.** `evidence/tx-mutation/final.json` was read instead. |

## Safety tests changed since 78db463: each one line by line against AGENTS.md §4

| Test | Change | Guarantee |
| :--- | :--- | :--- |
| `z30-engine/tests/safety.rs` | Adds a healthy-hardware `HW` constant (VOX, level 0.5) to every `TxRequest`, because the gate now checks hardware (F-22). `plan.text` and `plan.kind` become accessors. `tx_audio` no longer takes a level. `n3_the_transmitted_audio_…` gains a sample-for-sample comparison with `Modulator::synthesize(frame.symbols(), 1500)·0.5`. | **Stronger.** n3 is now sample-exact. Hardware refusals have their own tests (`gate_contract::f22_*`, `f07_*`, h1). |
| `dial_provenance.rs` | `p5` used to complete a contact straight after the radio refused the set-frequency. It now asserts that the contact is refused (F-45). It then shows that a confirming reading lifts the refusal, and that once stale the logged dial is still `Configured`, never `Commanded`. `Logged` becomes `ContactComplete`. | **Stronger.** It adds a refusal, and the N-05 assertion is kept. |
| `qso_logging.rs` | The "nothing logged" check now tests `ContactComplete`. | **Equal.** `ContactComplete` is the only input to the logbook thread, and `Event::Logged` is emitted only at runtime.rs:581, after `LogSink::log` returned `Ok`. |
| `virtual_clock.rs` | `ClockStepped` now panics in the soak and closed-loop tests. `Unkey{completed}` becomes `Unkey{outcome}`. | **Equal or stronger.** The C-01 window assertions are unchanged. |
| `z30-io/tests/callback_alloc.rs` | The allocation counter moves from process-wide to per-thread, because the harness's output thread made it flaky. A playback-callback test is added. | **Equal** for the callback, whose body runs synchronously on the measuring thread and so is counted in full. The playback test is new coverage. |
| `z30-dsp/tests/sic_regression.rs` | Uses explicit 8-thread and 1-thread pools and asserts the 8-thread pool really has 8 threads. | **Stronger.** F-76 was vacuous on a single CPU. |
| `z30-cli/tests/loopback_isolation.rs` | The deny-list gains `audio_loopback`, and an allowlist test is added. | **Stronger.** See I-2 for a limit. |
| `emergency.rs`, `live_runtime.rs`, `round_trip.rs`, `golden*.rs`, `snr_accuracy.rs` | Unchanged | — |

No `#[ignore]`, threshold, seed, `cfg` or input was moved to make a test pass. Beyond the migrate unit tests, no existing assertion was deleted. The removed lines in migrate.rs are the production code that invented `tx_level = 0.5` and imported legacy defaults.

## Findings

### [Medium] M-1: after the audio output recovers, HALT no longer silences it from the calling thread
- **where:** `crates/z30-engine/src/runtime.rs:442` (`let stopper = parts.output.stopper();`, taken once at start), `runtime.rs:354-360` (`halt`), `crates/z30-io/src/audio.rs:402-415` (`recover` does `*self = fresh`, and `stopper` captures `self.shared`).
- **evidence:** `CpalOutput::recover` replaces the whole output, including a new `Arc<OutputShared>` and a new ring. The `OutputStopper` that `RuntimeHandle` captured at start-up still points at the old `OutputShared`, whose stream has been dropped. From then on `RuntimeHandle::halt()` flushes a dead ring. The live ring is flushed only when the control thread runs `check_halt → finish → output.stop()`. The `tx_runtime` fake output's `recover` keeps the same state `Arc`, so no test can catch this.
- **why:** AGENTS §4 says "HALT never waits: silences the output … from the calling thread; nothing on the control thread may block it" (F-16). Take a VOX station (where HALT's PTT request does nothing) whose USB audio glitched once and reopened 5 s later. If the control thread later stalls during a frame, the operator's HALT leaves the frame playing, and the radio keyed by VOX, until the control thread resumes or the 24 s of queued audio run out. That is exactly the scenario F-16 was fixed for.
- **fix:** Keep the `Arc<OutputShared>` stable across `recover`: build the new stream on the existing `shared`, then clear `failed` and `error`. Alternatively, make `OutputStopper` resolve the current output through an `ArcSwap`. Add a test, or give the fake's `recover` a new state object, that recovers and then asserts `halt()` flushes the live output.

### [Medium] M-2: an unconfirmed PTT release is abandoned, unreported, on runtime shutdown (settings change, exit) and on SIGTERM
- **where:** `crates/z30-gui/src/app.rs:256-262` (`apply_settings` restarts the runtime when `audio`, `ptt` or `rig` changed) and `app.rs:593-596` (`on_exit`); `crates/z30-engine/src/runtime.rs:330-343` (`shutdown`: `let _ = self.ptt.unkey();` and the result is discarded); `ptt.rs:462` (`Drop for Shared`: one more `drive(false)`, result discarded); `crates/z30-gui/src/main.rs:35-37` (signal handler: `emergency_release_all(); std::process::exit(143)`, the `bool` it returns is ignored); `crates/z30-io/src/rigctld.rs` `RigctldPtt::connect` (sends no `T 0` at open, unlike `SerialPtt::open` and `Cm108Ptt::open`).
- **evidence:** While the controller is `ReleasePending`, pressing Apply with a changed PTT or rig setting (the natural reaction to "PTT release NOT confirmed"), or closing the window, calls `shutdown()`. It tries once, then `Drop` tries once, and the controller is discarded. The new runtime's controller starts `Released`, and for CAT PTT it never commands `T 0`, so its gate allows transmission. Nothing is shown or logged. The SIGTERM handler exits right after a release that may have failed. docs/safety.md:268-269 says "A line it cannot reach is left `ReleasePending` for the watchdog", but the process exits, so no watchdog runs.
- **why:** AGENTS §4 says "A release is confirmed or it is pending … an unconfirmed release is retried by the watchdog, refuses transmission and is reported (F-01)". On these paths it is neither retried nor reported. Example: an operator switches from CAT to serial PTT after rigctld stopped answering a `T 0`. The radio stays keyed on CAT until its own time-out timer, and z-30 shows nothing.
- **fix:** Make `shutdown()` return the final `PttState` and failures. The GUI then refuses to apply a hardware change, or to exit silently, while the state is `ReleasePending`, shows a blocking dialog and keeps retrying. In the signal handler, retry `emergency_release_all()` a bounded number of times and `eprintln!` any failure before `exit`. Have `RigctldPtt::connect` send `T 0` once connected, as the serial and CM108 lines already release at open. Correct docs/safety.md:268-269 for the signal path. Add a test that shuts down a runtime whose line refuses releases and asserts the failure is surfaced.

### [Medium] M-3: the ledger cites a mutant that survived as killing evidence for F-01 and F-04
- **where:** `audit/ACTIVE_DEFECT_LEDGER.md:36` (F-01) and `:39` (F-04) both cite `RT-relfault`; `:57` (F-22, not a CTO row) cites `G-plan`. `audit/2026-09-28-remediation/evidence/tx-mutation/final.json` records both as `"result": "SURVIVED"`.
- **evidence:** RT-relfault replaces `Err(e) => self.release_failed(&e.0)` at runtime.rs:753 with `Err(_e) => {}`. In the same control-loop iteration, `check_hardware` (runtime.rs:771) sees `ReleasePending` and reports it, so the mutant is very probably equivalent. G-plan is equivalent because of the `FrameNotForMessage` push at engine.rs:526. Neither the ledger nor the history says this.
- **why:** The ledger rules say "Evidence is … a mutation ID and its result". A row that lists a surviving mutant among its evidence misleads the board. da090fa, after the reviewed head, says it re-runs these two mutants; it was not reviewed here.
- **fix:** Record them as `SURVIVED — equivalent (check_hardware re-detects ReleasePending; plan_tx pushes FrameNotForMessage)`, or kill them with a test that observes the finish-time report specifically.

### [Low] L-1: HALT drives the PTT line on the calling (GUI) thread and blocks for the driver's I/O
- **where:** `ptt.rs:363` `request_release_now` calls `release_bounded(…, 0)`, then `release_locked`, then `drive`, which is the rigctld `T 0`. `rigctld.rs:15,29-66` gives each operation a 1.5 s timeout and reconnects on demand, with DNS resolution unbounded.
- **evidence:** The scratch probe measured `halt()` at 100.1 ms with a 100 ms driver. `rt_halt_…` asserts under 100 ms only with instantaneous fake lines. With rigctld hung, the GUI freezes for up to about 4.5 s, or longer while DNS resolves, during an emergency.
- **why:** AGENTS §4 says HALT "requests the release from the calling thread without blocking". That is true for locks but not for I/O. An operator facing a frozen HALT button may assume z-30 hung.
- **fix:** Hand the release to a dedicated always-running release thread (or wake the watchdog with a condvar) so that `halt()` returns immediately. Otherwise, state the bound in AGENTS §4 and docs/safety.md.

### [Low] L-2: the CM108 regression test for F-43 never runs in CI
- **where:** `crates/z30-io/src/cm108.rs:82-93` (`#[cfg(feature = "cm108")]` module); `.github/workflows/rust.yml:48,50,114` (every `cargo test` runs without `--features`).
- **evidence:** `f43_no_cm108_device_is_guessed_when_there_is_more_than_one` is absent from the gate log. It passes when run with `--features cm108`.
- **fix:** Add `cargo test -p z30-io --features cm108 --lib` to rust.yml on Linux. Alternatively, move `choose_cm108`, which is pure, outside the feature gate.

### [Low] L-3: the Tune path clamps a NaN level to NaN
- **where:** `runtime.rs:268`: `let level = plan.tx_level().clamp(0.0, 1.0);`. `f32::clamp(NaN)` is NaN. `frame_audio` (runtime.rs:252) handles NaN.
- **why:** The gate refuses NaN (`f07_*`), so today this cannot be reached. However, the comment at runtime.rs:249-250 calls the clamp "a second line behind the gate", and on the Tune path that second line does not exist. NaN samples sent to a device are undefined.
- **fix:** Share `frame_audio`'s NaN handling, and add the Tune case to `f07_the_synthesised_frame_never_exceeds_full_scale`.

### [Low] L-4: the clock-status cache stays at its last value for ever if the OS query hangs
- **where:** `crates/z30-io/src/wallclock.rs:90-105`.
- **evidence:** `refreshing` is set before the query thread starts and is cleared only when the query returns. A hung `timedatectl` leaves an old status, for example "NTP-synchronised", displayed with no age.
- **why:** AGENTS §4, Time: status says "synchronised" only when the OS says so. A stale answer presented as current weakens that.
- **fix:** After a timeout (for example 60 s) with no answer, show "status query not answering since …".

### [Low] L-5: `ClockStepped` is informational only; the sequencer and the transmit timeline see slot numbers again
- **where:** `engine.rs:318-322` (`on_clock_stepped` only pushes an event); `slots.rs:160-165`; `runtime.rs:232`, where the frame end is in UTC, a pre-existing behaviour.
- **evidence:** After a backward step, `on_slot_report` receives slot numbers it has already processed, and `QsoRecord` times ("UTC from slot numbers") can come out with end before start. A backward step during a frame pushes `end_at` into the future, so a CAT/CM108 line stays keyed with the audio finished until the 40 s watchdog. The TX timeline is pre-existing; the receive-side re-decode is new.
- **fix:** On `ClockStepped`, disarm transmission and reset the sequencer's slot bookkeeping. Time the frame end on the monotonic clock. Add a test.

### [Low] L-6: diff size and scope
- 116 files and +13.6k lines. The PR mixes transmit safety (8bd126d alone spans about 20 findings), the research instrument, documentation, five new agent prompts, a process change (§2a) and audit evidence, including 1.3k-line JSON files. Each part traces to a ledger row, and I found no unrelated refactor. The `TxPlan` sealing and `Engine::gate` refactor are required by F-22/F-75. Bisecting a regression in 8bd126d will still be coarse, and the board is asked to accept four areas at once.
- **fix:** The board could accept per area. Future remediation should use one commit per finding.

### [Info] I-1: `slots.rs` comment and `docs/synchronization.md:103-105` describe a narrower tolerance than the code
The code treats `now_slot ∈ [next−1, next+1]` as normal time (`slots.rs:160`). The comment and the doc say only `next−1` or `next`. A 30–59 s forward step is therefore reported as misses, not as `ClockStepped`. Align the text, or tighten to `now_slot > next`.

### [Info] I-2: the loopback allowlist can be bypassed with grouped imports
`paths_in` drops `crate::`/`z30_engine::` prefixes when they are followed by `{`. For example, `use z30_engine::{runtime::{start}};` followed by a bare `start(…)` passes both guards. Actually reaching a device still requires naming `z30_io` or `cpal`, which the deny-list catches, and `std::process::Command` is allowed. This belongs to the tx-safety-auditor.

### [Info] I-3: every cpal output error callback is treated as fatal
`audio.rs:279`. This is correct fail-safe behaviour. If a backend reports benign xruns through the error callback, each one will abort a frame and reopen the device. Check this on the dummy-load pretest (`hardware-validation/PRETEST_CHECKLIST.md`).

### Real-time paths, determinism, one receiver/modulator/gate, legacy, MSRV
- **Audio callback:** `OutputCallbackState::on_data` allocates nothing (test passes), holds no lock and does not panic (`pop().unwrap_or(0.0)`). `record_error` runs in the error callback, not the data callback, and uses `try_lock`.
- **Watchdog:** uses only `try_lock`. Drivers run under `catch_unwind`. The registry lock is never held across a driver (`ptt.rs:263-274`).
- **Control thread:** SQLite and `timedatectl` have been moved off it. `recover()` (a device open) and `unkey()` (which can wait for a driver) still run on it, which is acceptable because HALT no longer depends on it (apart from M-1). New `expect` calls exist only at thread spawn, at start-up.
- **Determinism:** `crates/z30-dsp/src` is unchanged. `sic_regression` now compares 8 threads with 1 thread. `ap_production.rs` is seeded.
- **One receiver, modulator and gate:** Tune now uses `gfsk::Modulator` (F-49). `TxPlan` is sealed, so only `plan_tx` builds one. `frame_audio` takes a `&VerifiedFrame`. The gate now includes the hardware checks (F-22). No second demodulator was added.
- **Legacy and MSRV:** no `crates/` dependency on `legacy/`, and no fallback; the GUI's in-memory logbook fallback was *removed*. MSRV 1.95 builds, lints and tests clean; `as_chunks` and `is_none_or` are stable at 1.95.
- **Commits:** all non-merge commits are conventional. No build artifacts or personal config were committed; `.claude/worktrees/` is now ignored.
- **Docs:** safety.md, architecture.md, hardware.md, synchronization.md and wiki/06/10/13/14/15 describe HALT, the release states, outcomes, poll interval, settle window, clock steps, device ambiguity and the logbook banner as the code implements them. The exceptions are noted in M-2 (signal path), L-1 ("without blocking") and I-1.

## Ledger rows naming cto-code-reviewer

| ID | Verdict | Evidence |
| :--- | :--- | :--- |
| F-01 | **NOT VERIFIED** | The runtime path is correct and tested: `ptt.rs:192-245` gives Keyed → ReleasePending → Released, with only a confirmed `set(false)` releasing. `ptt_release::f01_*` (4), `ptt_panic::*` (2) and `tx_runtime::rt_an_unconfirmed_release_*` (2) pass in the release gate and in 5 repeat runs. It is not verified because (a) the guarantee is lost on `shutdown`, GUI restart or exit, and SIGTERM (M-2), and (b) the cited evidence RT-relfault SURVIVED (M-3). |
| F-04 | **VERIFIED** | `tx_runtime.rs`: 18 tests through `runtime::start` with `tx_unavailable: None`, all passing; 5/5 repeat runs under load. final.json records RT-halt, RT-haltflag, RT-haltptt, RT-haltstop, RT-wd, RT-keyfail, RT-unkey, RT-outfail, RT-playstop, RT-lateend, RT-latekey, RT-latestart and RT-partial as KILLED (harness not re-run by me). The ledger's RT-relfault citation must be corrected (M-3). |
| F-13 | **VERIFIED** | `build_support.rs` reruns on every workspace-member source directory in the closure, plus Cargo.lock, the manifest, HEAD, the branch ref and the index. My probe gave clean `ee42ae601cc0`, then `ee42ae601cc0-dirty` (diff sha256 960e50af6248) after an unstaged z30-dsp edit, then `ee42ae601cc0` after the revert. z30-gui and z30-py use the same `emit`. |
| F-15 | **VERIFIED** | `ptt.rs:160-170`: `drive` runs under `catch_unwind` with a `DRIVING` TLS flag. `release_bounded` does not wait on a line the current thread is driving. The watchdog uses `try_lock` only. `emergency_release_all` copies the registry before driving. `ptt_panic::f15_a_panic_inside_set_true_is_released_and_nothing_deadlocks` and `ptt_release::f15_the_watchdog_never_blocks_on_a_line_another_thread_is_driving` pass. The author's reproduction on 78db463 hung. |
| F-16 | **NOT VERIFIED** | Fixed: the GUI HALT calls `rt.halt()` (app.rs:423-428), not the queue; `timedatectl` runs off-thread (`wallclock::tests::f16_*` passes); SQLite is on the log thread (runtime.rs:572-591); `rt_halt_*` (3) and `ptt_release::f16_*` pass. Not verified because HALT's output silence is lost after an output recovery (M-1), and HALT blocks the GUI for the PTT driver's I/O (L-1, measured at 100 ms with a 100 ms driver). |
| F-17 | **VERIFIED** | `TxScheduler` (runtime.rs:199-245) sets `end_at` from the actual audio start. `Key` and `StartAudio` are emitted in separate ticks. Lateness limits apply. `TxOutcome` exists, and only `Complete` advances the sequencer (engine.rs:576-586). `RigctldPtt::connect` connects at creation. Passing tests: `rt_a_slow_key_still_sends_the_whole_frame`, `rt_a_key_too_slow_*`, `rt_a_stalled_control_loop_*`, `rt_a_frame_the_device_did_not_finish_is_partial_not_complete`, `gate_contract::f17_*`, `rigctld::tests::f17_*`. Detecting `Partial` on real hardware depends on `CpalOutput::queued_samples`, which has not been validated on hardware. |
| F-18 | **VERIFIED** | `RigPollSchedule` (runtime.rs:386-419) is used by the rig thread (runtime.rs:539-567). Freshness is tracked per field (rig.rs:125-131, 262-285). `f18_*` (4) pass. |
| F-19 | **VERIFIED** (stated scope) | The error callback is recorded (audio.rs:279-285, 360). `failure()` feeds `check_hardware` (runtime.rs:804-832). A failed `play` goes through `finish`, which calls `stop()` (runtime.rs:911-916). Passing tests: `audio::tests::f19_*`, `callback_alloc::the_playback_callback_never_allocates_*`, `rt_an_output_failure_*`, `rt_a_failed_play_*`. The recovery added here introduces M-1, which is tracked under F-16. |
| F-20 | **VERIFIED** (code and runtime; GUI checked by inspection only) | The `Logbook::in_memory()` fallback is removed and replaced by `UnavailableLog` plus a persistent banner (app.rs:79-86, 357-361). `Event::Logged` is emitted only at runtime.rs:581, after `log.log()` returns `Ok`. `LogFailed` is shown in red. RT-logpersist is KILLED. There is no GUI test harness. |
| F-23 | Already `VERIFIED` (4f6bb01), not re-examined | release.yml:61-62 uses `macos-15` / `macos-15-intel`. Publishing is still unexercised. |
| F-47 | **VERIFIED** | Latency is read at plan time (runtime.rs:872, `set_output_latency` clamps it to 0..1 s and makes non-finite values 0). RT-lat is KILLED by 16 tx_runtime tests, which pass. |
| F-48 | **VERIFIED** | `SlotEvent::ClockStepped` (slots.rs:118-133, 156-165). `clock_step::f48_*` (3) pass: a ±120 s step is reported once and decoding resumes at 245.5 s; 0.1 s, 2 s and 500 ppm are not reported as steps. `virtual_clock` panics on a spurious step and still passes. Residuals: L-5, I-1. |
| F-49 | **VERIFIED** | Tune is `Modulator::synthesize(&[0; TOTAL_SYMBOLS], span centre)·level` (runtime.rs:267-273). `gate_contract::f49_*` compares sample for sample and checks the raised-cosine envelope. TUNE-lin is KILLED. Residual: L-3. |
| F-50 | **VERIFIED** (job content; GitHub run not checked) | ci.yml `rust-advisories`. Locally, with the same ignores `cargo audit` exits 0; without them it exits 1, listing exactly RUSTSEC-2026-0176/-0177 (pyo3 0.25.1, z30-py only, APIs unused). The residuals stay OPEN as the ledger says: the pyo3 ≥ 0.29 migration and SHA-pinning of actions. |
| F-77 | **VERIFIED** | `#![forbid(unsafe_code)]` in z30-io/src/lib.rs:6, z30-gui/src/main.rs:6 and z30-channel/src/lib.rs:2, and all three compile. The counting `#[global_allocator]` in z30-cli stays as the documented limitation. |

## Recommendation

**READY AFTER FIXES.** The remediation is substantial and well tested. All gates pass on 1.95, the test count matches the author's evidence exactly, the timing-sensitive transmit tests were stable under heavy load, no safety test was weakened, and the receiver, golden vectors and frozen oracle are untouched. Before the board:

1. Fix M-1, with a test. It is small: keep `OutputShared` stable across `recover`.
2. Fix M-2 (release pending across shutdown and exit, and the signal path), with a test, and correct safety.md:268-269.
3. Correct the ledger evidence for RT-relfault and G-plan (M-3). This may already be done in da090fa, which was not reviewed.

L-1 and L-2 should be fixed in this PR if cheap; L-3 to L-6 and the Info items can be tracked. The commits after ee42ae6 (da090fa, 3fbf952, a25d5a9) need their own §3 pass. Hardware and on-air validation are unchanged: **not validated**.
