# Transmit-safety audit — z-30 at `caf1a9a`

> Produced by the `tx-safety-auditor` agent (`.claude/agents/tx-safety-auditor.md`), 2026-09-28.
> Evidence for the board, not a board decision. Read-only on the checkout; mutations ran only in
> a separate, since-removed git worktree. Mutation results, script, log and probe:
> [`evidence/tx-mutation/`](evidence/tx-mutation/).

**Verdict: FINDINGS.** 22 findings: 9 High, 5 Medium, 6 Low, 2 Info (TX-01 … TX-22).

The station can stay keyed after a failed release, with nothing retrying and nobody told
(TX-01). The US band plan lets data emissions into frequencies Part 97 does not permit for them
(TX-02). And 14 of 37 mutations survive. Of those, 13 are real guarantees nothing tests: the
production transmit loop, "verified = transmitted" at symbol level, the emission-edge
arithmetic, `MAX_TX_SECONDS`, the panic-hook layer, the NaN and > 1 transmit levels, the
loopback-isolation guard and power provenance. The 14th (P-hook) is a layer no test drives, so
its survival is expected. **All five survivors named in the post-remediation audit are now
killed.**

## Header

| | |
| :--- | :--- |
| Code audited | `caf1a9a1959a32d4976a47a9995b5f57ed6ccf2d` (branch `claude/fervent-cray-riehln`, same as `main`). The checkout had since moved to `4cbf074`, which adds only `audit/` markdown files; no code changed |
| Toolchain | `rustc 1.95.0 (59807616e 2026-04-14)` (MSRV), `cargo +1.95` |
| Unmutated guarding tests (checkout, `--release`) | `z30-engine --test safety` 29/29, `--test emergency` 1/1, `--test dial_provenance` 7/7; `z30-protocol --test frame_integrity` 2/2, `--test round_trip` 6/6; `z30-cli --test loopback_isolation` 2/2; `z30-io --test callback_alloc` 1/1; `z30-engine --lib` 7/7 (including `config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`); `z30-cli` `audio_loopback::tests` 2/2; `z30-io` `rigctld::tests` 2/2. **All pass** |
| Mutation testing | 37 single mutations. Each ran in a separate detached worktree of `caf1a9a` with its own `CARGO_TARGET_DIR`, in the test profile (opt-level 3), one mutation at a time, restored after each. The script follows the pattern of `mutate_corrective.py`. The worktree was checked clean and then removed (`git worktree remove`). The main checkout was never modified |
| Probes | Two throw-away test files, run in the worktree and deleted before its removal (one is kept as [`evidence/tx-mutation/probe_tx.rs.txt`](evidence/tx-mutation/probe_tx.rs.txt)). They show: (a) the gate's verdicts on US 6 m, 2 m and 60 m dials; (b) a failed release is never retried; (c) a second `key()` re-arms the watchdog; (d) a panic inside `PttLine::set` deadlocks the release chain. Fake lines only |
| Hardware | **None exists here. Nothing was keyed.** No real PTT line, rigctld, serial port, CM108 device or audio output device was opened by anything run. The one mutant that references the sound-card path (LOOP-e) is guarded so it cannot run. Validation state: protocol validated; software simulation validated; **hardware not validated; on-air not validated** |

## Invariant by invariant

| Invariant (AGENTS.md §4) | Status | Evidence |
| :--- | :--- | :--- |
| `can_transmit` is the single gate in front of sequencer, manual TX and tune | HOLDS | The only production callers are `engine.rs:403` (`blockers_now`, display only) and `engine.rs:432` (`plan_tx`). The only caller of `plan_tx` is `runtime.rs:475`. Tune goes through the same call (`engine.rs:424-457`) |
| Fails closed; returns every violation; never `allowed: true` on a partial check | **GAP** (TX-12) | `txgate.rs:171-261` gathers every violation and has a double fail-closed guard at `:260`. But PTT-configured, hardware-open and non-zero-level are checked outside the gate (`engine.rs:385-399`, appended at `:443`). `can_transmit` therefore returns `allowed: true` for a station with no PTT, no output device or level 0 |
| Callsign real, non-placeholder, carried exactly | HOLDS | `txgate.rs:172-185`; g1, c5. Migration can import the old real-station default W1AW (TX-13) |
| Region and class | HOLDS | `txgate.rs:187-195`; g2 (G-region killed) |
| **Radiated** emission (dial + audio + span, 66 Hz) inside a permitted data segment | **BROKEN** (data, TX-02) / **GAP** (tests, TX-05) | The arithmetic at `txgate.rs:199-218` is right. The US table (`bandplan.rs:166,177,178`) permits CW-only sub-bands and off-channel 60 m. G-bw, G-centre and G-top survive |
| Settled readback not contradicting the dial; readback only adds refusals; unsettled QSY and in-resolution differences not refusals | HOLDS (at plan time) | `rig.rs:270-288`; r1–r6 (G-stable and G-res killed). Not re-checked during TX, and a stale mode can pass as fresh (TX-18, TX-19) |
| No fresh non-USB mode | HOLDS, with a stale-mode gap (TX-19) | `txgate.rs:226-230`; l7 |
| Whole-frame round trip (C-06) | HOLDS | `codec.rs:594-618`. C06-a and C06-b killed by `frame_integrity::every_kind_of_corrupted_frame_is_refused` and `safety::n3_…corrupted_frame…` |
| Frame from this station | HOLDS | `txgate.rs:249-252`; g5 |
| PTT configured, hardware open, non-zero level | HOLDS in `plan_tx`, outside the gate (TX-12); **GAP** for NaN level (TX-07) | `engine.rs:385-399`. G-hwptt, G-hwopen and G-plan killed; G-nan survives |
| Only `VerifiedFrame` transmitted; built only by `EncodedMessage::verify`; `plan_tx` sends the gate's object (N-03) | HOLDS (type); **GAP** (test: TX-03) | Only constructor is `codec.rs:624`; `compile_fail` doctest at `:640`; `engine.rs:460-461`; `runtime.rs:181-183`. N3-sym survives: nothing compares the transmitted symbols with the verified ones. `TxPlan` is publicly constructible without the gate (TX-21) |
| One keying implementation that reports hardware acceptance | HOLDS — NOT HARDWARE VALIDATED | Every key and release goes through `PttController` (`ptt.rs:165-187`). Adapters: `rigctld.rs:87-95`, `serial_ptt.rs:36-44`, `cm108.rs:37-48`. VOX reports `Unverifiable` |
| A release drives what the key drove | HOLDS | `ptt.rs:89-108`, `:228-236`; z1, z1b |
| **Released lines stay released** (release failure) | **BROKEN** (TX-01) | `ptt.rs:98-108`. Probe: after a failed `T 0` the controller says unkeyed, the watchdog never retries, the hardware is still keyed 10 min later and after drop |
| Halt between plan and key abandons | HOLDS in code; **GAP** (TX-04 test, TX-10 GUI path) | `engine.rs:244-246`, `runtime.rs:443-449`. RT-halt survives (h2 tests the scheduler, not the runtime). The GUI's HALT can be dropped by `try_send` (`app.rs:162-164,383`) |
| `MAX_TX_SECONDS = 40` | HOLDS in code; **GAP** in tests (TX-06) | `ptt.rs:26`. P-max (40 → 400) survives |
| Timeline, watchdog thread, panic/signal handlers and OS serial release stay separate layers | HOLDS structurally; **GAP** (TX-04, TX-06, TX-11, TX-15) | Timeline `runtime.rs:98-175`; watchdog `ptt.rs:212-224` (p4b); `emergency_release_all` `ptt.rs:117-124` (p5); GUI signals `z30-gui/src/main.rs:33-38`; serial `serial_ptt.rs:1-5`. The runtime's use of the watchdog result is untested (RT-wd). The panic hook is untested (P-hook). A panic inside `set` deadlocks three of the layers (TX-11). `key()` re-arms the deadline (TX-15) |
| rigctld PTT on its own connection, never queued behind polls | HOLDS — NOT HARDWARE VALIDATED | Separate `Rigctld` objects: `app.rs:71-72` (poller) and `z30-io/src/lib.rs:30` (PTT). 1.5 s timeouts at `rigctld.rs:15,34-36`. rigctld itself still serialises commands to the radio; that is outside z-30 |
| No default callsign, region, class, PTT, dial or TX level | HOLDS for `Config::default()`; **BROKEN via migration** (TX-13) | `config.rs:30-44,48-52,137-139,108-115`; the config test passes. `migrate.rs:338` always writes `tx_level = 0.5`. `migrate.rs:100` does not treat W1AW as a placeholder |
| `--loopback-test` has no audio output, PTT or rig | HOLDS; **GAP** in guard (TX-08) | `main.rs:214-217`, `loopback.rs`. The guard is a textual deny-list. LOOP-e (reaching `crate::audio_loopback::run`) survives |
| `--audio-loopback-test` refuses any PTT (VOX included) or rig | HOLDS | `audio_loopback.rs:38-70`, checked before any device opens (`:74-76`). LOOP-b killed |
| Logged dial claims only its evidence (N-05) | HOLDS | `engine.rs:319-324,140-162`; dial_provenance p1–p7; DIAL-a killed |
| Configured power is configuration; forward power and SWR "not measured" | HOLDS in code; **GAP** in test (TX-09) | `engine.rs:334`; GUI `app.rs:533-537`; ADIF provenance at `logbook.rs:325-327`. PWR-a (logged as `Measured`) survives |
| `QsoRecord::validate` refuses no partner or implausible UTC | HOLDS | `qso.rs:172-185`; logbook re-checks at `logbook.rs:131-132`. LOG-p and LOG-c killed |
| Audio callback does not allocate | HOLDS (input, tested); HOLDS by inspection (output, untested) | Input `audio.rs:78-93` + `callback_alloc.rs`. Output callback `audio.rs:238-254` uses only `rtrb` pop and `read_chunk`; no test covers it (TX-17) |

## Mutation table (37 mutants: 23 KILLED, 14 SURVIVED, 0 invalid)

Re-check of the post-remediation audit's survivors first. C06-c is not applicable: the check it
removed was deleted as a weaker duplicate of `verify_round_trip`'s field comparison. The
corrective remediation's own pair mutations had already shown the single round-trip checks are
redundant, so those were not re-run.

| ID | Mutation | Location | Result / killed by |
| :--- | :--- | :--- | :--- |
| C03-c | own +0.3 s offset on UTC | `z30-io/src/wallclock.rs:56` | KILLED: `wallclock::tests::utc_is_the_operating_systems_with_no_offset_applied` |
| C06-a | `verify_round_trip` always Ok | `z30-protocol/src/codec.rs:595` | KILLED: `frame_integrity::every_kind_of_corrupted_frame_is_refused`, `safety::n3_the_gate_refuses_every_corrupted_frame_and_hands_out_no_frame` |
| C06-b | `verify()` ignores the round trip | `codec.rs:623` | KILLED: same two tests |
| C06-c | (encoder payload self-check) | n/a | NOT APPLICABLE: the check no longer exists |
| LOG-c | missing received report logged as −16 | `z30-engine/src/qso.rs:414` | KILLED: `qso::tests::the_record_holds_no_report_that_was_not_received_or_sent` |
| SNR-e | no estimate floored to −30 dB | `z30-dsp/src/demod.rs:203` | KILLED: `snr_accuracy::no_signal_is_no_estimate_never_a_floor_value` |
| G-bw | emission checked at 0 Hz width, not 66 Hz | `txgate.rs:209` | **SURVIVED** |
| G-centre | emission centred on tone 0 (span ignored) | `txgate.rs:206` | **SURVIVED** |
| G-top | upper audio limit on tone 0, not tone 15 | `txgate.rs:203` | **SURVIVED** |
| G-lsb | emission computed as LSB | `txgate.rs:206` | KILLED: `g3_the_radiated_emission…` |
| G-region | no region not refused | `txgate.rs:188` | KILLED: g2, g4 |
| G-stable | unsettled QSY counts as a contradiction | `rig.rs:273` | KILLED: r3 |
| G-res | tuning resolution ignored | `rig.rs:50` | KILLED: r4 |
| G-nan | NaN TX level not refused | `engine.rs:395` | **SURVIVED** |
| G-hwptt | PTT not configured not refused | `engine.rs:387` | KILLED: h1 |
| G-hwopen | unavailable TX hardware not refused | `engine.rs:390` | KILLED: h1 |
| G-plan | `plan_tx` trusts `allowed` (drops hardware refusals) | `engine.rs:448` | KILLED: h1, n9 |
| G-halt | halt commands no longer abandon | `engine.rs:244` | KILLED: h2 |
| N3-sym | `tx_audio` modulates the verified frame with one data symbol flipped | `runtime.rs:183` | **SURVIVED** |
| N3-freq | `tx_audio` 50 Hz above the checked frequency | `runtime.rs:183` | KILLED: `loopback::tests::the_software_loopback_decodes_through_the_resampler_at_both_device_rates` |
| N3-level | `tx_audio` no longer clamps level to ≤ 1 | `runtime.rs:179` | **SURVIVED** |
| P-max | `MAX_TX_SECONDS` 40 → 400 | `ptt.rs:26` | **SURVIVED** |
| P-hook | panic hook no longer releases PTT | `ptt.rs:131` | **SURVIVED** |
| P-drop | Drop of a keyed controller does not release | `ptt.rs:247` | KILLED: `emergency::p5…` |
| P-emerg | `emergency_release_all` releases nothing | `ptt.rs:121` | KILLED: `emergency::p5…` |
| P-keyfail | a refused key is not released | `ptt.rs:177` | KILLED: z2 |
| P-wdcmp | watchdog `>=` → `>` | `ptt.rs:203` | KILLED: p4, p4c |
| P-wdthread | watchdog thread never ticks | `ptt.rs:221` | KILLED: p4b |
| P-clamp | `with_limit` no longer clamps to MAX | `ptt.rs:157` | KILLED: p4c |
| RT-halt | runtime ignores the engine's halt while planned or keyed | `runtime.rs:443` | **SURVIVED** |
| RT-wd | runtime ignores a watchdog release (audio continues, no fault) | `runtime.rs:524` | **SURVIVED** |
| RT-keyfail | a refused key still plays the audio | `runtime.rs:494` | **SURVIVED** |
| RT-unkey | end of frame stops audio but does not unkey | `runtime.rs:513` | **SURVIVED** |
| LOOP-b | audio-loopback refusal lets VOX through | `audio_loopback.rs:48` | KILLED: `audio_loopback::tests::it_refuses_every_configuration…` |
| LOOP-e | software loopback calls `crate::audio_loopback::run` (guarded so it cannot run) | `loopback.rs:154` | **SURVIVED** |
| DIAL-a | configured dial logged as commanded | `engine.rs:322` | KILLED: dial_provenance p2, p5, p6 |
| PWR-a | configured TX power logged as `Measured` | `engine.rs:334` | **SURVIVED** |
| LOG-p | `validate` accepts no partner | `qso.rs:173` | KILLED: `qso_logging::a_record_without_a_partner…`, `logbook_integrity::a_record_describing_no_contact…` |

Tests run per mutant:
- **Gate (G-\*):** safety, engine lib, dial_provenance.
- **PTT (P-\*):** safety, emergency, engine lib.
- **Runtime (RT-\*):** safety, dial_provenance, live_runtime. These are every test binary that calls `runtime::start`, plus the safety suite.
- **`tx_audio` (N3-\*):** safety and all of `z30-cli`.
- **Logging (LOG-\*, DIAL-a, PWR-a):** qso_logging, engine lib, logbook_integrity, io lib, dial_provenance.
- **Loopback (LOOP-\*):** all of `z30-cli`.
- **Others:** C03-c used io lib; C06-a/b used protocol plus safety; SNR-e used snr_accuracy plus qso_logging.

## Findings

### TX-01 — High — A failed PTT release is never retried or reported; the radio can stay keyed

Confirms CTO-01.

**Evidence.**
- `ptt.rs:98-108`: `Shared::release` sets `keyed = false` *before* `line.set(false)`.
- `ptt.rs:201-207`: `watchdog_tick` acts only while `is_keyed()`.
- `ptt.rs:244-250`: `Drop` releases only while `keyed`.
- The runtime discards every unkey result: `runtime.rs:445, 504, 515, 548`, plus `shutdown` at `:259`.
- `RigctldPtt::set` returns `Err` on any 1.5 s timeout or dropped connection (`rigctld.rs:43-66,88-90`).
- Probe: a line whose `set(false)` fails once. Result: `unkey=Err("rigctld: timed out")`, `controller_keyed=false`, `watchdog_fired_now=false` at t = 10 min, `hardware_keyed_after_10_min=true`, `hardware_keyed_after_drop=true`.

**Scenario.** A CAT-keyed station sends `T 0` at the end of a frame while rigctld is busy or restarting. The read times out, `command()` drops the connection, and `unkey()` returns `Err`. The runtime ignores it and calls `note_ptt(false)`. The GUI shows idle.
- The radio stays in transmit indefinitely. The watchdog, Drop and the next frame's logic all believe it is unkeyed.
- Any audio later routed to that output device is radiated. If the output is the system default device, that includes OS sounds.
- Only the radio's own time-out timer ends it. CM108 behaves the same way on a HID write error.

**Invariant.** Stuck-transmitter layers; "if uncertain, refuse".

**Fix.**
- Treat an unconfirmed release as "possibly keyed": keep a `release_pending` flag that the watchdog retries every tick until a release is confirmed.
- Have `Drop` and `emergency_release_all` drive `set(false)` unconditionally.
- Surface every unkey `Err` as a `TxFault` and disable TX until a release succeeds.
- Add a test with a line whose first release fails, asserting the watchdog re-sends it.

### TX-02 — High — The US band plan permits data emissions Part 97 does not authorise

**Evidence.** `bandplan.rs:177` (6 m 50.000–54.000, `US_ALL`), `:178` (2 m 144.000–148.000, `US_ALL`), `:166` (60 m as one continuous 5.332–5.405 MHz segment). The probe ran the real gate for a US General station with 1500 Hz audio:

| Dial | Result | Emission centre | Why it is wrong |
| :--- | :--- | :--- | :--- |
| 50.050 MHz | `allowed=true`, `6m` | 50.0515 MHz | 50.0–50.1 MHz is CW-only (47 CFR 97.305(c)) |
| 144.050 MHz | `allowed=true`, `2m` | 144.0515 MHz | 144.0–144.1 MHz is CW-only (97.305(c)) |
| 5.366 MHz | `allowed=true`, `60m` | 5.3675 MHz | outside the five channels and outside WRC-15's 5351.5–5366.5 kHz |
| 5.338 MHz | `allowed=true`, `60m` | 5.3395 MHz | between channels 5332 and 5348 kHz |

**Scenario.** A US operator sets one of those dials. The gate says "clear" and the station transmits a data emission where the licence does not permit it.

**Invariant.** The radiated emission must lie inside a permitted data segment.

**Fix.**
- Split the US 6 m and 2 m entries at 50.1 and 144.1 MHz.
- Model US 60 m as its channels, with the emission required inside the channel's 2.8 kHz.
- Add gate tests at those edges.
- Separately, the IARU tables are whole-band allocations, not "data segments". Either say so in `docs/safety.md` and the violation text, or narrow them.
- The 60 m statement rests on the FCC channel rules and the WRC-15 band edges; confirm against the current CFR text before changing the table.

### TX-03 — High — "What is verified is transmitted" is tested only up to what the FEC corrects

**Evidence.** Mutation N3-sym, which modulates the verified frame with one data symbol flipped (`runtime.rs:183`), survives. `n3_the_transmitted_audio_is_the_verified_frame…` (`safety.rs:516-542`) only checks the length and that `decode_slot` recovers the message. LDPC corrects the flipped symbol.

**Scenario.** A regression in `tx_audio` or the modulator's symbol mapping radiates symbols that differ from the verified frame. Every test passes, and on air weaker stations fail to decode (or mis-decode).

**Invariant.** N-03: what is verified is what is transmitted.

**Fix.** Compare the `tx_audio` output sample for sample with `Modulator::synthesize(frame.symbols(), f0) * level`. Or hard-demodulate all 75 symbols from the audio and compare them to `frame.symbols()`.

### TX-04 — High — The production transmit loop in `runtime.rs` is untested

**Evidence.** RT-halt, RT-wd, RT-keyfail and RT-unkey all survive. Every `runtime::start` test passes `tx_unavailable: Some(..)`: `live_runtime.rs:137`, `dial_provenance.rs:250`. h2 (`safety.rs:397-424`) calls `txs.abort()` itself, so it tests the engine and scheduler, not the runtime's wiring at `runtime.rs:443-449`.

**Scenario.** Any one of these edits passes CI:
- `HaltTx` no longer stops a keyed frame;
- a watchdog release leaves the audio playing and TX armed;
- a refused key still plays audio (radiated by any VOX path);
- the end of a frame no longer unkeys, leaving the watchdog at 40 s as the only release.

**Invariant.** Halt means halt; the stuck-transmitter layers.

**Fix.** A `runtime::start` test with fake transmit-capable parts:
- a recording `PttLine` and `AudioOutput`;
- a virtual or fast wall clock;
- a configured station with CQ enabled.

Assert key → play → stop → unkey ordering, halt-after-plan (no key), halt-while-keyed (stop + unkey), key-failure (no play), and a watchdog-fired abort.

### TX-05 — High — The gate's emission-edge arithmetic is not pinned

**Evidence.** G-bw (0 Hz width), G-centre (tone 0 used as the centre) and G-top (tone 15 not bounded at 2800 Hz) all survive. g3 (`safety.rs:111-124`) tests only points more than 33 Hz from an edge, and only the lower audio bound.

**Scenario.** A refactor drops the 66 Hz width or the span offset. The station then radiates up to about 56 Hz past a band edge, or past 2800 Hz audio, and every test still passes.

**Invariant.** The radiated emission at its −40 dB width lies inside a permitted segment.

**Fix.** Edge tests:
- centre 20 Hz inside an edge: refused;
- centre 40 Hz inside: allowed;
- `tx_audio_hz` = 2760 (tone 15 at 2806.9 Hz): refused;
- 2750: allowed.

### TX-06 — High — `MAX_TX_SECONDS = 40` is not pinned; the panic-hook layer is untested

**Evidence.** P-max (40 → 400) survives: p4 and p4c are written relative to the constant. P-hook (the hook no longer calls `emergency_release_all`) survives: no test installs `install_panic_release` and panics.

**Scenario.** The limit is raised by edit, or the panic layer is removed, and CI stays green.

**Invariant.** `MAX_TX_SECONDS = 40`; panic and signal handlers are a separate layer.

**Fix.**
- Add `assert_eq!(MAX_TX_SECONDS, 40)`.
- Add a separate test binary that installs the hook, keys a recording line, panics in a thread, and asserts the release.

### TX-07 — High — A NaN level and a level above full scale are not pinned

**Evidence.** G-nan survives: `engine.rs:395` refuses NaN, but no test covers it. N3-level survives: `runtime.rs:179`'s clamp to ≤ 1.0 is untested. The GUI slider limits the level to 0..1 (`app.rs:679`), but `config.toml` accepts any float, including `nan`.

**Scenario.**
- NaN level (if the check regresses): NaN samples go to the device while keyed.
- Level > 1 (if the clamp regresses): the device clips, and the emission becomes wider than the 66 Hz the gate checked.

**Fix.** Test that `tx_level = NaN` is refused with `TxAudioLevelZero`, and that `tx_audio(.., level = 5.0)` peaks at ≤ 1.0.

### TX-08 — High — The loopback-isolation guard is a textual deny-list that can be bypassed

**Evidence.** LOOP-e survives: `loopback.rs` calling `crate::audio_loopback::run(&Config::default(), true, None)` passes `loopback_isolation.rs`. `FORBIDDEN` does not include `audio_loopback`, and the guard counts calls only in `main.rs`.

**Scenario.** An edit wires `--loopback-test` to the sound-card path with the confirmation forced on. It plays through the default output with no refusal. A VOX radio on that output transmits `CQ Q0TST FN31`.

**Invariant.** Loopback never transmits (N-04).

**Fix.**
- Add `audio_loopback` and `crate::` re-exports of device code to the deny-list.
- Better, make it structural: move the software loopback into a module or crate that does not depend on `z30-io` or `cpal`, so the dependency graph enforces isolation.

### TX-09 — High (test gap) — Configured power's provenance is not pinned

**Evidence.** PWR-a (configured power logged as `Measured`, `engine.rs:334`) survives all logging and dial tests.

**Scenario.** A regression logs configured power as measured, and the ADIF export says `TX_PWR=measured`. That is a dishonest value.

**Invariant.** Configured TX power is configuration.

**Fix.** In `qso_logging.rs`, assert `rec.tx_power_w == Some(Sourced::new(p, Provenance::Configured))`.

### TX-10 — Medium — HALT goes through a bounded, droppable channel and never touches the line

Confirms CTO-03.

**Evidence.** The HALT button (`app.rs:383`) calls `send`, which uses `try_send` on a 64-slot channel (`runtime.rs:297`). If that fails, the GUI shows "Engine busy; command not sent." (`app.rs:162-166`). `RuntimeHandle::emergency_unkey` (`runtime.rs:273`) exists, but the GUI never calls it.

**Scenario.** The control thread stalls while keyed (for example a slow SQLite write at `runtime.rs:534`, or a hung `line.set`). The command channel fills, and HALT either queues or is dropped. The transmitter stays keyed until the watchdog (≤ 40 s).

**Fix.** Make HALT call `rt.emergency_unkey()` directly (and stop the output) before sending `HaltTx`. Never drop a `HaltTx`: use a dedicated `AtomicBool` halt flag that the control loop checks every tick.

### TX-11 — Medium — A panic inside `PttLine::set` deadlocks the panic hook, the watchdog and the signal handler

Confirms CTO-02 by probe.

**Evidence.** `key()` and `release` hold the line mutex while calling `set` (`ptt.rs:170-173,106-107`). The panic hook runs before unwinding, calls `emergency_release_all` (`ptt.rs:130-131`), and re-locks the same mutex on the same thread.

Probe: `set(true)` panics with the hook installed. The keying thread never returns, and a later `watchdog_tick()`/`unkey()` from another thread also never returns. The default hook's panic message never printed. The registry lock is held throughout, so `ctrlc`'s `emergency_release_all` would block too.

The production adapters have no evident panic path. Their only `unwrap` is in `rigctld.rs:47`, after a successful `connect`. The exposure is therefore latent.

**Scenario.** A driver-level panic while keying disables three software layers at once. Only hardware remains: serial drops the line on close; CAT and CM108 depend on the radio's time-out timer.

**Fix.**
- In the hook and `emergency_release_all`, use `try_lock` on each line, and fall back to a separately held "raw release" handle.
- Or catch unwinds around `line.set` inside the controller (`catch_unwind`) and treat a panic as `Err`.

### TX-12 — Medium — The gate is split: `can_transmit` returns `allowed: true` without the PTT, hardware and level checks

**Evidence.** `txgate.rs:258-261` computes `allowed` from its own checks only. `PttNotConfigured`, `HardwareUnavailable` and `TxAudioLevelZero` are added later by `Engine::hardware_violations` (`engine.rs:385-399`) in `plan_tx` (`:443`). The docs list them as the gate's violations (`docs/safety.md:31-33`).

**Scenario.** A new transmit path or tool that calls `can_transmit` and trusts `allowed` keys a station with no PTT configured, no output device, or level 0. Today the only other caller is display (`blockers_now`), which also appends the checks.

**Invariant.** One gate; never `allowed: true` on a partial check.

**Fix.** Pass the PTT method, the hardware state and the level into `TxRequest`, and check them inside `can_transmit`.

### TX-13 — Medium — Migration injects a default transmit level and can import a real station's default callsign

Confirms DOC-02 and extends it.

**Evidence.**
- `migrate.rs:338` sets `cfg.audio.tx_level = 0.5` unconditionally.
- `migrate.rs:100` treats only `NOCAL`/`N0CALL` as placeholders; `:160-173` imports any other call as "Migrated".
- Audit C-04 and the 2026-09-23 audit (C6) record that the shipped legacy bundle defaulted to the real station **W1AW**.
- The migration also carries over PTT, rig control, dial, region and class (`:193-296`).

**Scenario.** A user of the stale legacy bundle saved settings without changing the default call. `z30 --migrate` or the GUI's first start produces a config with callsign W1AW, a PTT method, a dial and level 0.5. The gate clears, and "Call CQ" transmits as W1AW at a drive level the operator never chose. That level may be enough to drive the radio's ALC into splatter wider than the 66 Hz checked.

**Invariant.** No default callsign or transmit level; no misidentified transmission.

**Fix.**
- Leave `tx_level` at 0 after migration, reported as "set the TX level" (the gate already refuses 0).
- Treat a migrated `W1AW` as a suspected legacy default: skip it with a message and require re-entry.

### TX-14 — Low — A late key sends a truncated frame and reports it complete

Confirms CTO-04 from the code.

**Evidence.** `TxScheduler::tick` (`runtime.rs:152-171`) keys and starts audio whenever `now ≥ key_at`, however late. It unkeys at the fixed `end_at` with `completed: true` (`:166-169`). The runtime then calls `tx_finished(.., completed && !watchdog_fired)` (`:518`).

**Scenario.** The control loop stalls past `key_at` (or the wall clock steps forward). The frame starts late and is cut at `end_at`, or keys and unkeys in the same tick. The sequencer advances, and for `SendingRr73`/`Sending73` a contact is **logged** although its closing message was not fully sent (`qso.rs:390-394`).

**Fix.**
- Refuse to key if `now − key_at` exceeds a small tolerance (abandon the slot).
- Pass `completed = false` whenever the audio did not start on time or was cut short.

> Severity note: CTO-04 rates this Medium; this audit rates it Low. The consolidated audit
> (`README.md`) carries the higher rating.

### TX-15 — Low — `key()` re-arms the watchdog deadline, so the watchdog bounds time since the last key, not the keyed period

**Evidence.** `ptt.rs:165-169`. Probe: key at 0 s, key again at 35 s, and at 70 s the watchdog has not fired with the line keyed. Today one plan produces one `Key` and there is always an unkey gap, so this is latent.

**Fix.** Arm the deadline only on the unkeyed → keyed transition (`compare_exchange` on `keyed`), and test it.

### TX-16 — Low — Output device errors are ignored; a failed `play` leaves partial audio queued

Confirms CTO-06.

**Evidence.**
- `audio.rs:255`: `|_err| {}` on the output stream.
- `audio.rs:274-279`: `push_partial_slice` can enqueue part of a frame and still return `Err`.
- `runtime.rs:503-510` unkeys on that error but does not call `output.stop()`.
- `tx_unavailable` is evaluated only at start-up (`app.rs:58-65`).

**Scenario.** The output device dies after start-up. Every following slot keys the radio (CAT or serial) with no audio, reports the transmission as sent, and advances the sequence. Or a partial frame remains queued and plays unkeyed, which is radiated if the path is VOX.

**Fix.**
- Record output stream errors in an atomic and turn them into `HardwareUnavailable`.
- Call `output.stop()` on a `play` error.

### TX-17 — Low — The output audio callback's no-allocation property is untested

**Evidence.** `callback_alloc.rs` exercises only `InputCallbackState::on_data`. The output closure (`audio.rs:238-254`) looks allocation-free by inspection but is not factored out or tested.

**Fix.** Factor the output body into a type the counting-allocator test can drive.

### TX-18 — Low — Rig readback is checked only at plan time, and a refused set-frequency is not a refusal while settling

**Evidence.**
- `plan_tx` runs the gate 0.6 s before the slot (`runtime.rs:80,474-485`). Rig readings during Planned, Keyed or Playing never abort (`runtime.rs:461`).
- `on_dial_command_result(Err)` (`engine.rs:144-149`) does not affect the gate. For three polls after a QSY, `dial_disagreement` returns None (`rig.rs:273`).

**Scenario.** The radio refuses a set-frequency, or the operator turns the VFO during a frame. The station transmits up to about 3 s on an unconfirmed dial, or finishes a 24 s frame at a dial the radio already reports as different.

**Fix.**
- Treat a refused set-frequency as positive evidence and refuse until a reading confirms the dial.
- While busy, re-evaluate the dial and mode checks on each fresh reading and halt on a settled contradiction.

### TX-19 — Low — A stale mode reading counts as fresh; the rig poller ignores the PTT settle window and the configured poll interval

**Evidence.**
- `rigctld.rs:75` maps a failed `m` query to `mode: None`.
- `rig.rs:184,191` then updates `last_reading_ms` but keeps the old mode, so `fresh_reported_mode` returns a mode read arbitrarily long ago.
- The rig thread (`runtime.rs:398-416`) polls on a fixed 1000 ms, ignoring `in_ptt_settle_window` and `rig.poll_interval_ms` (CTO-05).
- `docs/safety.md:98` says "Readings are not taken inside the 100 ms PTT settle window (r5)", but r5 tests only the tracker.

**Fix.**
- Clear `reported_mode` (and `reported_ptt`) when a poll omits them, or timestamp each field separately.
- Make the rig thread honour the settle window and the configured interval; test it through the runtime.

### TX-20 — Low — NOT HARDWARE VALIDATED — Device selection can drive a different interface than intended

**Evidence.**
- CM108 with an empty device path keys "the first C-Media device" (`cm108.rs:29`) (CTO-12). Migration always writes an empty device (`migrate.rs:288`).
- The audio output is chosen by first case-insensitive substring match (`audio.rs:155`).
- Opening a serial port on Linux normally asserts DTR and RTS until `SerialPtt::open` drives the line released (`serial_ptt.rs:19-26`). This is a possible key-up blip at GUI start and during `z30 --diagnostics`; it has not been measured.

**Scenario.** A two-radio station keys or feeds the wrong radio, whose dial the gate never checked.

**Fix.**
- Refuse CM108 auto-selection when more than one C-Media device is present.
- Refuse an ambiguous audio name match.
- Document the serial open behaviour in `hardware.md` and cover it in hardware validation.

### TX-21 — Info — `TxPlan` can be built without the gate

**Evidence.** `engine.rs:26-27` says "Only the gate can supply one", but `TxPlan`/`TxKind::Frame` are fully public, and `Message::frame()` yields a `VerifiedFrame` with no gate. `loopback.rs:156-158` does exactly this. Nothing in the runtime takes a plan from anywhere but `plan_tx`, so there is no bypass today.

**Fix.** Make gate approval a type too: a `GatedPlan` with a private constructor used by `plan_tx`, required by the runtime.

### TX-22 — Info — The watchdog does nothing for VOX, and `Event::WatchdogReleased` is dead

**Evidence.**
- For VOX, the watchdog's `set(false)` is a no-op. The only bound is the finite queued audio: one frame, with a 30 s ring (`audio.rs:232`).
- `Event::WatchdogReleased` (`api.rs:178`) is never emitted; the runtime emits `TxFault` instead (`runtime.rs:530`) (CTO-14).

This is consistent with `docs/hardware.md:34`. It is noted only so no one counts the watchdog as a VOX defence.

## Cross-references to the other reports

| Finding | Verdict here | Basis |
| :--- | :--- | :--- |
| CTO-01 | **Confirmed** (TX-01) | Probe |
| CTO-02 | **Confirmed** (TX-11) | Probe (deadlock observed); exposure latent |
| CTO-03 | **Confirmed** (TX-10) | Code |
| CTO-04 | **Confirmed** (TX-14) | Code; the consequence includes logging an incomplete contact |
| CTO-06 | **Confirmed and extended** (TX-16) | Code; partial `play` without `stop()` |
| DOC-02 | **Confirmed and extended** (TX-13) | Code; W1AW import |

## Not checked

- Anything on real hardware: serial RTS/DTR timing, CM108 GPIO, rigctld against a real radio, sound-card latency, VOX behaviour, emitted RF spectrum. **Nothing was keyed.**
- The ctrlc handler's actual signal coverage per OS (SIGTERM/SIGHUP via the `termination` feature; the Windows console-close event). This was read, not exercised.
- Behaviour of the Windows and macOS serial/HID back ends.
- The GUI end to end (no `z30-gui` tests were run), apart from reading `app.rs`.
- Band-plan data for regions other than the US in detail, and national variations (out of scope by design).
- `z30-py`, `legacy/` and the benchmark suite (not transmit paths).
- Clippy and fmt, and the full workspace test run (only the targeted binaries above; the CTO review ran the full suite).
- Pair mutations for the redundant round-trip checks: the corrective remediation's C06-p1…p4 were not re-run.
