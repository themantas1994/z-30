# CTO code review — whole-project audit of z-30 at `caf1a9a`

> Produced by the `cto-code-reviewer` agent (`.claude/agents/cto-code-reviewer.md`), 2026-09-28.
> Evidence for the board, not a board decision. Read-only on the checkout.

**Verdict: READY AFTER FIXES.** All gates pass. One High and seven Medium findings are in the
transmit, halt and logging paths. CTO-01 to CTO-04 should be fixed before any hardware
(dummy-load) test.

| | |
| :--- | :--- |
| Repository | `themantas1994/z-30`, branch `claude/fervent-cray-riehln` = `main`, HEAD **`caf1a9a`** (merge of PR #44) |
| Scope | All of `crates/` and `.github/workflows/`, checked against `AGENTS.md` and `docs/research-process.md` §3. This is not a PR diff review |
| Toolchains | `rustc 1.95.0 (59807616e 2026-04-14)` / `cargo 1.95.0` (the declared MSRV), used for every gate. The environment's `stable` is **1.94.1, below the MSRV**; it is noted as context only |
| Hardware | **None.** No radio, sound card, PTT interface or RF path. Nothing here is hardware-validated |
| Repository | Not modified. Probes ran in throwaway crates in the session scratchpad (`cto/pttprobe/src/main.rs`, path dependency on `crates/z30-engine`, separate `CARGO_TARGET_DIR`) |

## Gates

| Gate | Command | Exit | Result |
| :--- | :--- | :--- | :--- |
| Format | `cargo +1.95 fmt --all --check` | **0** | clean |
| Clippy (CI command) | `cargo +1.95 clippy --workspace --all-targets --exclude z30-py -- -D warnings` | **0** | clean |
| Clippy, release features (as the CI `msrv` job) | `… --locked --features z30-cli/cm108,z30-gui/cm108 -- -D warnings` | **0** | clean |
| Clippy on stable 1.94.1 | same command, `+stable` | **101** | refused before compiling: "`z30-*`/`egui*`@… requires rustc 1.95". This is an environment fact, not a repository defect |
| Tests | `cargo +1.95 test --workspace --exclude z30-py --release --locked` | **0** | **167 passed, 0 failed, 2 ignored** in 31 test binaries (lib, integration and doc tests). Ignored: `golden_ldpc::screen_osd_pool` (manual, needs `Z30_POOL`) and `explore_spread_estimator_scatter` (marked exploratory, about 2 min) |
| Oracle freeze | `sha256sum -c FROZEN.sha256` in `legacy/python-oracle/z30_dsp` | 0 | 9 of 9 files match |
| Golden regeneration | `python reference/golden/generate.py --check` | **NOT RUN** | NumPy is not installed and the agent was told not to install anything. The Rust golden tests (`golden.rs`, `golden_ldpc.rs`, `golden_demod.rs`) pass |
| GitHub CI on Linux/Windows/macOS | — | **NOT OBSERVED** | Only the workflows were read |

---

## Findings (most severe first)

### CTO-01 [High] A failed PTT release is never retried or reported, and the watchdog then believes the line is released
- **Where:** `crates/z30-engine/src/ptt.rs:98-108` (`Shared::release`), `ptt.rs:201-208` (`watchdog_tick`), `crates/z30-engine/src/runtime.rs:445, 504, 515, 548` (`let _ = ptt2.unkey();`), `runtime.rs:446, 516` (`engine.note_ptt(false, …)` whatever the result).
- **Evidence:**
  - `release` sets `keyed = false` *before* calling `line.set(false)`. The comment calls that "the safe belief for the scheduler".
  - `watchdog_tick` acts only `if self.is_keyed()`.
  - Every caller in the runtime discards the unkey `Result`, and the engine records PTT as released anyway.
  - The test fake `RecordingLine` (`tests/safety.rs:47-61`) can only fail a *key*, never a release, so no test covers this.
  - **Probe** (a line whose first `set(false)` fails, as a 1.5 s rigctld `T 0` timeout would, `rigctld.rs:15`): `unkey result: Err; controller is_keyed=false; hardware keyed=true`, and one hour later `watchdog_tick fired=false; hardware keyed=true`.
- **Why it matters:** This is the stuck-transmitter case the §4 layers exist for. `docs/safety.md:118-121` says the watchdog covers "a lost unkey". It does not, and the operator sees neither a fault nor a keyed state. For CAT (rigctld keeps the rig keyed) and CM108, the radio's own time-out is the only defence left.
- **Fix:**
  - Keep a `release_pending` state (or leave `keyed` true) until a release returns `Ok`.
  - Have the watchdog retry the release on every tick while it is pending, whatever the deadline.
  - Report every failed unkey as `TxFault`. Do not `note_ptt(false)` until it is confirmed.
  - Add a safety test with a line whose release fails N times.

### CTO-02 [Medium] A panic inside `PttLine::set` deadlocks the panic hook and the watchdog, leaving the line keyed
- **Where:** `ptt.rs:128-134` (hook → `emergency_release_all`), `ptt.rs:117-124`, `ptt.rs:106` and `ptt.rs:170-173` (the line mutex is held across `line.set(true)`).
- **Evidence:**
  - The panic hook runs before unwinding, so the panicking thread still holds the `line` guard.
  - `release` then calls `self.line.lock()` on the same non-reentrant `Mutex`, and the thread blocks for ever.
  - The watchdog blocks on the same mutex.
  - **Probe** (driver panics after driving the line, limit 200 ms, watchdog every 10 ms): `1.5 s after a panic inside set(true): hardware keyed=true`. The default panic message was never printed, which shows the hook never returned.
- **Why it matters:** All three software layers (§4, "separate layers. Do not collapse them") collapse onto one mutex. None of today's adapters panics visibly, but `serialport` and `hidapi` are third-party code.
- **Fix:** In `emergency_release_all` (and the watchdog), use `try_lock` with a bounded retry instead of `lock`. After unwinding drops the guard, the watchdog can then release at its deadline. Add a test with a panicking line.

### CTO-03 [Medium] HALT TX and the transmit timeline depend on a control thread that does blocking I/O; the GUI never uses the direct unkey
- **Where:**
  - `runtime.rs:541-543` → `wallclock.rs:64-70` → `wallclock.rs:34-49`: `timedatectl` is spawned with `Command::output()` and no timeout, once a minute, on the control thread.
  - `runtime.rs:487` (`ptt2.key()`; rigctld connect + write + read can take up to 3 × 1.5 s, plus DNS in `to_socket_addrs`).
  - `runtime.rs:534` (SQLite write).
  - `crates/z30-gui/src/app.rs:381-384` (HALT only calls `self.send(Command::HaltTx)`, i.e. `try_send` on a bounded(64) channel, `app.rs:162-167`, and drops it with "Engine busy" when the channel is full).
  - `runtime.rs:272-275` (`RuntimeHandle::emergency_unkey`, "from any thread") has no caller in the GUI.
- **Why it matters:** `wiki/14:37` says HALT "stops audio and unkeys immediately". While the control thread is blocked (a `timedatectl` D-Bus call can wait up to systemd's 25 s default), a halt does nothing, and keying and unkeying are delayed.
- **Fix:**
  - Move the `timedatectl` query to its own thread (or give it a timeout) and hand the cached text to the control thread.
  - Make HALT call `rt.emergency_unkey()` directly as well as sending `HaltTx` (audio stop still needs the control thread).
  - Never drop a HALT because the queue is full.

### CTO-04 [Medium] A slow key truncates the frame, and the transmission is still recorded as complete
- **Where:** `runtime.rs:126-134` (`end_at = slot_start + duration + tail`, fixed at plan time), `runtime.rs:159-165`, `runtime.rs:487-518`, `rigctld.rs:29-41, 83-86` (the CAT PTT connection is opened lazily, on the first key).
- **Evidence:**
  - `Key` runs synchronously. If it takes longer than `PTT_LEAD_SEC` (50 ms), `StartAudio` runs late.
  - `Unkey` still fires at the original `end_at`, calls `output.stop()` (which flushes the tail) and reports `completed: true`.
  - Probe on the public `TxScheduler`, with the key returning 300 ms late: `[Unkey { completed: true }]  audio played 23.80 of 24.00 s`.
  - A rigctld `T 1` round trip of 100–300 ms, or the first-use TCP connect, is enough to trigger it.
- **Why it matters:** It cuts the final Costas group, and the sequencer advances on a transmission that was not complete. That breaks the honest-values rule.
- **Fix:**
  - Set `end_at` from the actual audio start (`now + duration + tail`) when `StartAudio` executes, still capped by the watchdog.
  - Report `completed` only if the whole buffer was queued.
  - Open the CAT PTT connection when the line is created, not at the first key.

### CTO-05 [Medium] The rig thread ignores the PTT settle window and `poll_interval_ms`, though the docs say otherwise
- **Where:** `runtime.rs:398-417` (it polls every hard-coded `1000` ms and has no access to engine state). `rig.rs:170-178` (`in_ptt_settle_window`) is called only by `tests/safety.rs::r5`. `config.rs:96` (`poll_interval_ms`) is read nowhere.
- **Evidence:** These documents say polling avoids the settle window, which the code does not do:
  - `docs/safety.md:98` "Readings are not taken inside the 100 ms PTT settle window (`r5`)";
  - `docs/hardware.md:16` "not during the 100 ms PTT settle window";
  - `wiki/06:48` "never within 100 ms of a PTT change";
  - `runtime.rs:7` "respecting the PTT settle window";
  - `wiki/15:73` documents `poll_interval_ms`.

  `r5` tests only the tracker's arithmetic.
- **Why it matters:** This is a doc/code disagreement on CAT traffic around keying. Rigs that cannot process CAT while switching are the reason the rule exists.
- **Fix:** Either publish the settle deadline (an atomic `ptt_changed_at`) to the rig thread and use `poll_interval_ms`, or correct all five texts. Add a runtime-level test.

### CTO-06 [Medium] Output-device errors are swallowed, and the output callback has no allocation test
- **Where:** `crates/z30-io/src/audio.rs:255` (the output error callback `|_err| {}`; compare the input's `failed` flag, `audio.rs:168-178, 193-195`), `audio.rs:273-280` (`play` pushes a partial slice and then returns `Err`), `runtime.rs:503-510` (on a play failure it unkeys but never calls `output.stop()`), `crates/z30-io/tests/callback_alloc.rs` (covers only `InputCallbackState::on_data`).
- **Why it matters:**
  - If the output sound card fails during a frame, the radio stays keyed carrying silence until `end_at`.
  - The engine records `completed: true`, and the operator is told nothing.
  - A partial frame left in the ring after a failed `play` is not flushed.
  - "The audio callback does not allocate" (§7) is tested for input only.
- **Fix:**
  - Add a `failed` flag to `CpalOutput`, surface it through `AudioOutput`, and have the control thread check it while keyed (unkey plus `TxFault`).
  - Call `output.stop()` on a `play` error.
  - Factor the output callback body out, as was done for input, and put it under the counting-allocator test.

### CTO-07 [Medium] The GUI falls back to an in-memory logbook when the real one cannot be opened
- **Where:** `crates/z30-gui/src/app.rs:74-80`.
- **Evidence:** `Logbook::open` fails → `Logbook::in_memory().expect(…)` plus one start-up note. Later contacts still produce green "Logged …" messages (`app.rs:193-201`) and are lost at exit.
- **Why it matters:** §7 says "no fallback … a failure is reported, not worked around". "Logged" claims persistence that does not exist.
- **Fix:** Pass a `LogSink` that returns `Err("logbook unavailable: …")`, so every `Event::Logged` becomes a visible "not logged" fault, or disable auto-log with a persistent banner.

### CTO-08 [Medium] The release workflow targets a retired runner, so no release could be published
- **Where:** `.github/workflows/release.yml:35` (`os: macos-13`), `release.yml:84` (`publish` `needs: build`).
- **Evidence:** The current `actions/runner-images` README (fetched 2026-09-28) lists no macOS 13 image, and marks macOS 14 as deprecated. The `x86_64-apple-darwin` leg therefore cannot get a runner. Because `publish` needs the whole matrix, no release would be created. The workflow has never run (per the post-remediation audit, §20). Not verified by pushing a tag.
- **Fix:** Build x86_64 macOS on `macos-15-intel` (or cross-compile on arm64), move the arm64 build off the deprecated `macos-14`, and do a `workflow_dispatch` dry run.

### CTO-09 [Low] Output-latency compensation is racy and usually zero
- **Where:** `runtime.rs:430` (`TxScheduler::new(output.latency_sec())`, read once when the control thread starts); `audio.rs:233, 240` (`latency_ns` starts at 0 and is written only inside the output callback).
- **Why it matters:**
  - The control thread starts microseconds to milliseconds after `stream.play()`. Usually no callback has run yet, so the compensation is 0, and it is never updated.
  - `docs/audio.md:80-81` says audio is timed "allowing for the output latency the device reported".
  - The DT error is tens to hundreds of ms, inside the ±1.5 s window but not what is documented.
- **Fix:** Read `latency_sec()` at plan time (`TxScheduler::accept`), or wait for the first callback before starting the timeline. Otherwise document that no compensation is applied.

### CTO-10 [Low] A backward system-clock step silently suspends decoding
- **Where:** `crates/z30-engine/src/slots.rs:143, 167` (`next_slot` only ever advances and is not reset at a new epoch); `clock.rs:72-79` (a jump starts a new epoch).
- **Evidence:** Probe through the public `RxPipeline` at 6 kHz, OS clock stepped −120 s at audio t = 200 s: slots are Ready every 30 s up to t = 185.4 s. Then **nothing (no `Ready`, no `Missed`) until t = 335.4 s**.
- **Why it matters:** "Never silently dropped" (`slots.rs:6-8`). An NTP step is outside z-30's control, but the gap should be visible. By reading only: the TX timeline (`runtime.rs:146-150`) would also re-plan slot numbers it has already used.
- **Fix:** On a new epoch whose UTC is behind `next_slot`, emit `Missed(…, ClockStepped)`, or re-seat `next_slot` and report it.

### CTO-11 [Low] The Tune carrier is generated outside `gfsk::Modulator`
- **Where:** `runtime.rs:186-203`.
- **Why it matters:** §4 says `z30_protocol::gfsk::Modulator` is "the only waveform generator: transmit, …", and `docs/architecture.md` "One modulator" says the same. Tune is transmitted, with its own sine and a *linear* 20 ms ramp, not the raised cosine. It is gated like a frame (`n3_tune_…` passes), so this is an invariant and documentation deviation, not a gate bypass.
- **Fix:** Generate Tune through the Modulator (for example a constant-symbol frame at the centre tone), or state the exception in AGENTS §4 and in `architecture.md`.

### CTO-12 [Low] CM108 with an empty device path keys the first C-Media HID device found
- **Where:** `crates/z30-io/src/cm108.rs:28-29`.
- **Why it matters:** With two C-Media devices attached (a USB headset plus the radio interface is common), `set` returns `Confirmed` for a GPIO on the wrong device. The acknowledgement is then not evidence that the radio was keyed.
- **Fix:** Refuse an empty path when more than one C-Media device is present, and show the chosen path in `describe()` and the diagnostics.

### CTO-13 [Low] No advisory scan of the production Rust dependency tree
- **Where:** `.github/workflows/ci.yml:100-110`: `pip-audit` runs for the non-shipped oracle only. `wiki/16` says CI runs "a dependency audit" without saying it is the oracle's. Dependabot updates cargo dependencies monthly but does not fail on advisories.
- **Why it matters:** The shipped binaries bundle SQLite (`rusqlite` `bundled`), hidapi, cpal and eframe (455 packages in `Cargo.lock`). Actions are pinned by tag, and the MSRV job uses `dtolnay/rust-toolchain@master`.
- **Fix:** Add `cargo audit` or `cargo deny check advisories` over `Cargo.lock`. Pin third-party actions by SHA.

### CTO-14 [Low] Dead event variants, and a watchdog release that can go unreported
- **Where:** `crates/z30-engine/src/api.rs:178` (`Event::WatchdogReleased`) and `api.rs:188` (`Event::Audio`) are never constructed. The GUI renders them (`app.rs:191, 203`). A watchdog release is reported only as `TxFault`, and only `if … txs.busy()` (`runtime.rs:524-531`).
- **Fix:** Emit `WatchdogReleased` whenever `watchdog_fired()` goes from false to true, whatever the timeline state, and remove `Audio` or use it for device errors (see CTO-06).

### CTO-15 [Low] Minor documentation disagreements
- `wiki/16:94` gives `cargo clippy --workspace --all-targets -- -D warnings`. That is not what CI runs (`--exclude z30-py`), and it fails without a Python interpreter (N-15).
- The same table gives `npm run test` for the legacy runtime; CI runs `npm run test:ts`.
- **Fix:** Paste the CI commands.

### CTO-16 [Info] The thread-count determinism test can be vacuous
- **Where:** `crates/z30-dsp/tests/sic_regression.rs:124-137` compares the *global* rayon pool against a 1-thread pool. On a 1-CPU runner both are one thread.
- **Fix:** Build an explicit `num_threads(8)` pool for the "many" side.

### CTO-17 [Info] Unsafe outside the forbidden crates
- The shipped `z30` binary carries a counting `#[global_allocator]` (`crates/z30-cli/src/main.rs:23-38`, `unsafe impl GlobalAlloc` delegating to `System`), used by `--benchmark perf`. It is correct and small, but it is a benchmark instrument in the production binary.
- `z30-io`, `z30-gui` and `z30-channel` contain no `unsafe` but do not declare `#![forbid(unsafe_code)]`.
- None of this breaks AGENTS §7, which requires the forbid only for protocol, dsp and engine.

---

## Status at HEAD of earlier audit findings

The corrective-remediation audit (`audit/2026-09-24-corrective-remediation/FINAL_AUDIT.md`) claimed to close most of the post-remediation findings. Status checked at `caf1a9a`:

| ID | Claimed | At HEAD (evidence) |
| :--- | :--- | :--- |
| N-01 Watterson Doppler 1/√2 | fixed | **Holds.** `watterson_power_spectrum_has_the_labelled_2_sigma_spread` and `generated_taps_have_the_labelled_doppler_spread` pass. The `FROZEN.sha256` update for `channel.py` in `b75f773` gives its reason |
| N-02 clippy fails on 1.95 | fixed | **Holds.** Clippy on 1.95 exits 0 with and without cm108, and the `msrv` job now runs clippy (`rust.yml:108-112`) |
| N-03 round trip untested; re-encoded frame sent | fixed | **Holds.** `VerifiedFrame(EncodedMessage)` has a private field (`codec.rs:646`) and a compile-fail doctest. `TxKind::Frame(Box<VerifiedFrame>)` comes from `Permission::frame` (`engine.rs:460-461`). The `n3_*` tests and `frame_integrity.rs` pass. `play()` has only two callers: the gated runtime and the refusing audio loopback |
| N-04 loopback past the gate / VOX | fixed, not HW-validated | **Holds** in software: `loopback_isolation.rs` and `audio_loopback::refusal` (`audio_loopback.rs:38-72`) |
| N-05 default dial logged as "commanded" | fixed | **Holds.** No default dial (`config.rs` `dial_hz: None`); `engine.rs:319-324`; the 7 `dial_provenance` tests pass |
| N-06 `rst_rcvd` absence | fixed | Holds (`qso::tests::the_record_holds_no_report…`) |
| N-07 wall-clock 0.5 s tolerance | fixed | Holds (a 1 ms bracketing test, `wallclock.rs:89-101`) |
| N-08 SNR None / high-SNR bias | partial | Unchanged: `no_signal_is_no_estimate…` passes; the bias is documented, not corrected |
| N-09 `tx_level = 0` | fixed | Holds (`TxAudioLevelZero`, `n9_…`) |
| N-12 capture chain not benchmarked | partial | Unchanged |
| N-13 1970 fallback | fixed | Holds (`wallclock::system_utc`) |
| N-14 GUI `--version` | fixed | Holds (`z30-gui/src/main.rs:10-27`) |
| N-15 `cargo build --workspace` needs Python | **open** | Still open (z30-py is a workspace member) |
| H-02 hardware validation, M-08 PTT after SIGKILL, L-05 Gray-mapping loss | **not fixed** | Unchanged |
| H-06, H-07, L-07 | partial | Unchanged. L-07's mode refusal (`txgate.rs:226-230`, `l7_…`) passes |

---

## Checked and found sound
- **Gate:** `txgate::can_transmit` collects every violation and fails closed twice (`txgate.rs:258-261`). `plan_tx` adds the hardware violations and refuses an empty-but-disallowed result (`engine.rs:443-453`). Tune goes through the same gate.
- **Halt and configuration changes:**
  - `UpdateConfig`, `SetDial`, `EnableTx(false)`, `HaltTx` and `ResetQso` all abandon a planned or keyed transmission (`engine.rs:171-240`, `runtime.rs:443-449`).
  - A GUI hardware change restarts the runtime after `shutdown()`, which unkeys first.
  - `replace_line` releases the old line.
- **PTT basics:**
  - `MAX_TX_SECONDS = 40` is a constant, and `with_limit` clamps to it.
  - The watchdog is its own thread holding a `Weak`.
  - The panic hook is installed in both binaries; the GUI has a SIGINT/SIGTERM/SIGHUP and console-close handler.
  - Serial RTS/DTR are dropped when the OS closes the port.
  - (CTO-01 and CTO-02 are the exceptions.)
- **Separate CAT PTT connection:** `RigctldPtt` has its own `Rigctld`, separate from the poller, and every socket operation has a timeout (`rigctld.rs`).
- **Capture callback:** it does not allocate or lock (`callback_alloc.rs` passes). `utc_now()` in the closure is `SystemTime::now()` arithmetic.
- **Decoder isolation:** decoder panics are caught per slot (`runtime.rs:378`), and every inter-thread channel is bounded.
- **Determinism:**
  - `z30-dsp` and `z30-protocol` contain no RNG, `HashMap`, `env::var` or global state; `Instant` is used only for `elapsed_ms`.
  - Rayon `collect()` keeps order, and the LDPC `Decoder` resets its state per schedule (`ldpc.rs:359-376`).
  - The `HashSet`s in `suite.rs` are insert-only.
- **Unsafe:** `#![forbid(unsafe_code)]` is present in protocol, dsp and engine. The only `unsafe` in the workspace is the two counting allocators (the `callback_alloc` test and the `z30` binary).
- **No dependency on `legacy/`:** no crate references `legacy/` or includes files from it. The `z30-dsp` and `z30-engine` dependency trees are as documented. Tests read only `fixtures/golden` and `tests/vectors`.
- **Frozen and golden files:** the oracle files match `FROZEN.sha256`. The only oracle change since `f180122` (`b75f773`) updated the manifest with a reason and left `fixtures/golden/` untouched.
- **Build provenance:** `build.rs` embeds commit and dirty state. Checked in a replica that an unstaged edit after a clean build *is* marked `-dirty`: the build script's own `git status` rewrites `.git/index`, so the script reruns on every build.
  > **Overturned (conflict C-1).** A tie-break with the real `build.rs` shows an unstaged edit in a
  > dependency crate is *not* marked `-dirty`: see RES-03 and [README.md](README.md#conflict-c-1--buildrs-dirty-detection).
- **CI against AGENTS §6:** `rust.yml` runs fmt, clippy, debug and release tests on three OSes (stable); the MSRV build, clippy and tests (read from `Cargo.toml`); a W1AW strings scan; the CLI round trip and refusals; suite provenance; golden vectors; and the paired harness. `ci.yml` covers the oracle, legacy tests and hygiene.
- **MSRV:** everything builds, lints and tests on 1.95.0.

## Not checked
- GitHub Actions runs themselves (Windows and macOS were not built here), and whether the pinned action tags (`checkout@v7`, `setup-python@v7`, …) exist: the GitHub API did not answer.
- `reference/golden/generate.py --check`, the oracle's pytest, and the legacy npm tests (no NumPy or Node dependencies installed).
- Benchmark reproduction (the QA reproducer's role) and mutation testing beyond the four probes above.
- `z30-py`, and a `cargo build --workspace` including it.
- GUI rendering and behaviour on a real display. CM108 and serial drivers against real devices. Every hardware-dependent behaviour, including real cpal latency and error reporting.
