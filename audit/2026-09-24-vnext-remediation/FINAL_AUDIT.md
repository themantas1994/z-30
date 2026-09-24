# Final audit — 2026-09-24 vNext remediation

This is a re-audit of the repository after the remediation, finding by finding, against
`Z30_FULL_AUDIT_2026-09-24.md` (audited commit `224b2fc58a6572adac4686b6858bbba741591339`).
Each finding was re-examined in the final tree. It was not marked fixed from memory. For each
finding the record gives the regression test that now guards it and whether that test passes.

**Statuses** are limited to FIXED, FIXED — NOT HARDWARE VALIDATED, PARTIALLY FIXED, NOT FIXED
and NOT TESTED. **Real-radio validation has not been performed**: no radio, sound card, audio
interface, PTT interface, RF path, GPS/PPS or on-air recording was available.

## Environment

@@ENVIRONMENT@@

## Findings

### C-01 — The installed receiver did not decode live audio

1. **Original finding.** The legacy browser runtime decoded at 24.0 s and asked for a window
   ending at 25.5 s. It got `null` and did not retry. When invoked late, its energy detector
   found no candidates near threshold (0/80 at −22/−18 dB).
2. **Root cause.** The live scheduler and the buffer disagreed on when a window was complete.
   The live path also used a different receiver (`realReceiver.ts` / `sicDecoder.ts`) from
   the one that was benchmarked.
3. **Files changed.** Legacy runtime moved to `legacy/browser-runtime/` and removed from every
   install path. `crates/z30-engine/tests/live_runtime.rs` (new). The launcher, installers and
   `web_dist` were deleted (see LEGACY_STATUS.md).
4. **Fix.** The vNext runtime (`z30_engine::runtime`) is the only receiver an operator runs. It
   hands a slot to `decode_slot` only when audio up to slot + 25.5 s — the full ±1.5 s search
   window — has arrived, as measured by the capture stream's own sample count. It never
   decodes from a window that does not yet exist.
5. **Regression test.**
   `live_runtime.rs::c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime`.
   It drives the production runtime with a virtual sound card and wall clock, places frames
   at DT −1.4 s and +1.4 s at −16 dB, stalls the audio at slot + 25.0 s, and asserts that no
   decode happens until the window is complete. Both frames must then decode through
   `decode_slot` with correct SNR, DT and frequency. The test was checked against a mutation:
   decoding from a window that ends early makes it fail.
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md (z30-engine); `awgn.json` measures the same `decode_slot`.
8. **Remaining limitation.** Not run with a real sound card. Real driver timing, buffer sizes
   and rate error are simulated (`virtual_clock.rs`), not measured.
9. **Status.** **FIXED — NOT HARDWARE VALIDATED**

### C-02 — −22.9 dB presented as the sensitivity of "the decoder that ships"

1. **Original finding.** README, wiki and the in-app Specs quoted the oracle's −22.9 dB as the
   installed receiver's sensitivity.
2. **Root cause.** The figure was measured on one receiver (the oracle) and published for
   another (the legacy browser receiver). The documents carried no conditions that would have
   exposed the substitution.
3. **Files changed.** `README.md`, `AGENTS.md`, `wiki/Home.md`, wiki 01–17, `docs/*.md`,
   `research/results/README.md`, `research/summarize_suite.py` (new),
   `crates/z30-cli/src/suite.rs` (new), `research/results/d8983eeef66e/` (new).
4. **Fix.** The only sensitivity quoted is vNext `decode_slot`'s own, from `awgn.json`. It
   always carries the same qualifiers: AWGN simulation, 2500 Hz reference, blind acquisition
   (210–2740 Hz, ±1.4 s, random phase and payload), 200 frames per point, seed 20260830,
   success criterion, Wilson interval, "not measured on real radio hardware". Against FT8 it
   always comes with the airtime (24.0 s vs 12.64 s), the message bits (63 vs 77), the Eb/N0
   per message bit (6.76 vs 5.13 dB) and the fading result. The oracle's figures are labelled
   as the retired oracle's.
5. **Regression test.** The CI benchmark-suite job re-runs every benchmark through the release
   binary and checks that each JSON names the commit, receiver, seed and definitions. The
   final term search (below) checks the documents.
6. **Test result.** Suite ran to completion; the term search leaves no unqualified figure.
7. **Evidence.** `research/results/d8983eeef66e/awgn.json`; README "Sensitivity"; wiki 11 §2.
8. **Remaining limitation.** A simulation figure. The FT8 figure it is compared with is
   published, not reproduced here.
9. **Status.** **FIXED**

### C-03 — Legacy RF time sync reported success from noise and persisted offsets

1. **Original finding.** `rf_time_sync.py` / `rfTimeSyncEngine.ts` derived the "RF timestamp"
   from the system clock. They returned `success=True` unconditionally, floored the SNR with
   `max(snr, …)`, used a constant confidence and fell back silently to a simulator. The
   resulting offset (+29 666 ms from noise) was persisted and could step the OS clock.
2. **Root cause.** No time-code decoder existed; the feature had been built around its
   expected outputs.
3. **Files changed.** `z30_dsp/rf_time_sync.py` deleted.
   `legacy/browser-runtime/src/dsp/rfTimeSyncEngine.ts` retired (`RF_TIME_SYNC_RETIRED`).
   `legacy/browser-runtime/tests/rfTimeSyncRetired.test.mjs` (new).
   `crates/z30-io/src/wallclock.rs`. `crates/z30-io/src/migrate.rs` (skip list). Wiki 07.
4. **Fix.** Production has no RF or network time synchronisation. It uses the operating
   system's UTC clock and applies no offset of its own. It reports "synchronised" only when the
   OS says so (`timedatectl NTPSynchronized=yes`); otherwise it reports "unknown" or "not
   synchronised". The legacy engine and network query always fail, contact nothing, and
   return no offset, SNR or confidence. Migration never imports a legacy time offset.
5. **Regression tests.** `wallclock::tests::synchronised_is_claimed_only_when_the_os_says_so`
   and `utc_is_the_operating_systems_with_no_offset_applied`. `rfTimeSyncRetired.test.mjs`
   covers pure noise, empty audio and the simulator's own audio for all seven stations (each
   must fail with no offset), and checks that the network query fails without a request. It was
   mutation-checked: with the retirement flag cleared, 23 checks fail.
   `migrate::tests::migrates_the_web_config_and_reports_every_decision` asserts that "legacy RF
   time offset" is skipped.
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md; the term search finds `SYNC OK` and `max(snr` only in wiki 07's
   account of the defect and in the retired legacy source.
8. **Remaining limitation.** z-30 has no built-in time source. The ±1.5 s window depends on the
   OS clock (H-06).
9. **Status.** **FIXED**

### C-04 — Stale committed bundle defaulting to W1AW

1. **Original finding.** `z30_dsp/web_dist/` was 63 commits stale. Wheels served it, and it
   defaulted to the real callsign W1AW.
2. **Root cause.** A committed build artefact with no freshness check, served as a fallback.
3. **Files changed.** `z30_dsp/web_dist/` deleted, together with `web_server.py`, the root
   `pyproject.toml` and the launcher. `crates/z30-engine/src/config.rs` (test).
   `.github/workflows/rust.yml` and `ci.yml`.
4. **Fix.** Nothing is served. A new vNext installation has no callsign ("not set"), and the
   transmit gate refuses until one is configured. CI scans the release binaries for `W1AW`.
   Hygiene rejects any tracked `web_dist/`, `dist/` or the retired launcher and installers.
   `--version` names the commit a binary was built from.
5. **Regression tests.** `config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`;
   `safety.rs::g1_unconfigured_placeholder_and_malformed_callsigns_are_refused_with_the_right_reason`;
   the CI steps "No real callsign ships in a binary" and "No stale web bundle, no legacy
   launcher…".
6. **Test result.** Pass (locally: `strings` over the release binaries finds no `W1AW`).
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** None known.
9. **Status.** **FIXED**

### C-05 — The auto-logger fabricated QSO fields

1. **Original finding.** `qsoEngine.ts` logged local time as UTC, a default grid `FN31`, a
   default report `-16`, and a distance computed from a default grid `EM00`.
2. **Root cause.** Defaults were used to fill required-looking fields.
3. **Files changed.** `crates/z30-engine/src/qso.rs` (`QsoRecord::validate`,
   `EARLIEST_QSO_UTC`), `engine.rs`, `crates/z30-io/src/logbook.rs` (`insert` validates),
   `crates/z30-io/src/migrate.rs`, `crates/z30-engine/tests/qso_logging.rs` (new),
   `crates/z30-io/tests/logbook_integrity.rs` (new),
   `legacy/browser-runtime/src/dsp/qsoEngine.ts`.
4. **Fix.** A vNext record holds only what was received or measured. Every field carries its
   provenance (`Received`, `Measured`, `Configured`, `Legacy`). A missing value stays missing
   in SQLite and ADIF. Time is UTC seconds from the OS clock. `validate()` refuses a record with
   no partner or a time before 2020, and the engine reports "contact not logged" rather than
   writing it. No report is sent or logged from an SNR that was not measured. Migration drops
   `FN31` and `-16` from entries the old auto-logger wrote, because they cannot be told apart
   from its defaults.
5. **Regression tests.** `qso_logging.rs`: `a_contact_with_no_grid_received_logs_no_grid_and_real_utc`,
   `no_measured_snr_means_no_report_is_sent_and_none_is_logged`,
   `an_exchange_that_never_completes_logs_nothing`,
   `a_record_without_a_partner_or_a_real_utc_time_is_refused`. `logbook_integrity.rs`:
   `utc_in_the_log_does_not_depend_on_the_local_time_zone` (run under a non-UTC `TZ`),
   `missing_fields_stay_missing_in_sqlite_and_adif`, `a_record_describing_no_contact_is_not_written`,
   `adif_is_well_formed`. Also
   `migrate::tests::the_legacy_auto_loggers_defaults_and_runtime_state_are_not_migrated`.
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** Legacy entries imported by migration keep their local-as-UTC time,
   because the true zone is unknown. They are marked `Legacy` and noted as such.
9. **Status.** **FIXED**

### C-06 — The packer sent a different grid; the gate checked only our own call

1. **Original finding.** The legacy packer hashed an unsupported grid onto the table
   (`FN42 → RE78`), changed partner calls, and was gated only on the station's own call.
2. **Root cause.** The encoder was lossy and silent, and the gate validated the operator's
   configuration rather than the frame being sent.
3. **Files changed.** `crates/z30-protocol/src/codec.rs` (`EncodedMessage::verify_round_trip`,
   `validate()` refuses off-table grids and out-of-range reports),
   `crates/z30-engine/src/txgate.rs`, `crates/z30-protocol/tests/round_trip.rs` (new),
   `crates/z30-engine/tests/safety.rs` (g6),
   `legacy/browser-runtime/src/dsp/catController.ts` (`canTransmit(…, messageText)`).
4. **Fix.** Before keying, the gate re-derives the message from the channel symbols it is about
   to send: symbols → Costas check → codeword → syndrome → CRC → fields → text. It refuses unless
   the result equals the requested message exactly: both calls, the grid or report, and the
   acknowledgement. Unsupported input is an encode error; nothing is substituted.
5. **Regression tests.** `round_trip.rs`: `every_maidenhead_square_is_sent_exactly_or_refused`
   (all 32 400 squares: 63 sent, the rest refused), `every_report_and_acknowledgement`,
   `cq_forms_and_qrz`, `hand_built_out_of_range_fields_are_refused_not_panicked_on`,
   `the_audit_substitutions_are_all_refused`, `sampled_callsign_space_partner_and_own_calls`.
   Also `safety.rs::g6_the_whole_frame_is_checked_partner_call_grid_and_report_not_just_our_call`,
   the CI step "A message v1 cannot carry is refused", and the C-06 group in
   `transmitPath.test.mjs`.
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** v1 can carry only standard calls, 63 grids and −30…+30 dB. That is
   now refused visibly instead of altered.
9. **Status.** **FIXED**

### H-01 — Legacy SIC not physical; duplicate decodes

1. **Original finding.** `sicDecoder.ts` subtracted a stale replica with zero phase and
   produced three decodes of one station.
2. **Root cause.** The replica was not the transmitted waveform, and there was no gain fit.
3. **Files changed.** Legacy SIC is unreachable (legacy moved). vNext:
   `crates/z30-dsp/tests/sic_regression.rs` (new), `crates/z30-cli/src/suite.rs` (`sic`).
4. **Fix.** Production uses vNext LS-SIC: the exact modulator replica, a least-squares complex
   gain over 0.4 s, a timing descent, and duplicate suppression by payload.
5. **Regression tests.** `sic_regression.rs`:
   `a_subtraction_never_adds_energy_and_removes_what_the_station_contributed`,
   `subtracting_a_frame_that_is_not_there_removes_only_the_noise_projection_and_creates_nothing`,
   `random_overlapping_bands_sic_on_versus_off_paired`,
   `a_busy_band_decodes_identically_on_one_thread_and_on_many`. Also
   `channel_scenarios.rs::sic_suppresses_a_decoded_station_by_more_than_20_db_and_reveals_the_one_underneath`.
6. **Test result.** Pass.
7. **Evidence.** `sic.json` (paired sweep, below); `busy.json` (0 duplicates emitted).
8. **Remaining limitation.** Collisions are measured only in simulation.
   `PassStats::suppression_db` is a receiver-internal metric and is documented as such.
9. **Status.** **FIXED**

### H-02 — No real-world validation

1. **Original finding.** The repository held no recordings, loopback captures, on-air logs or
   hardware tests.
2. **Root cause.** No equipment was available.
3. **Files changed.** `docs/hardware-validation.md` (new), `hardware-validation/README.md`
   (new), `crates/z30-cli/src/loopback.rs` (new: `z30 --loopback-test`).
4. **Fix.** There is now a repeatable procedure for audio loopback, dummy-load RF, each PTT
   method and killing the process during TX, with a results template. The loopback command
   plays a frame into a real cable and measures decode, DT, frequency, spectrum and sample-clock
   error from the recording. It refuses to play without `--confirm-no-transmitter`.
5. **Regression tests.** `loopback::tests` (3), software only: a clean recording passes and
   measures 50.5 Hz (99%) / 65.9 Hz (−40 dB); a recording without the frame fails; there is no
   playback without confirmation.
6. **Test result.** Pass (software). **No hardware test was performed.**
7. **Evidence.** `hardware-validation/results/` is empty.
8. **Remaining limitation.** All of it: nothing has been validated on hardware.
9. **Status.** **NOT FIXED**

### H-03 — Self-test shown as real decodes; the "collision" never collided

1. **Original finding.** Synthetic self-test frames entered the decode list with their
   configured SNR/DT and no label. The `SIC_COLLISION` preset demodulated each signal from its
   own clean replica.
2. **Root cause.** A demonstration path wrote into the operational list.
3. **Files changed.** `legacy/browser-runtime/src/dsp/sicDecoder.ts`, `audioEngine.ts`,
   `realReceiver.ts`, `tests/legacyLabels.test.mjs` (new).
4. **Fix.** A legacy self-test decode now reads `SYNTHETIC TEST: …` and carries
   `source: 'synthetic-self-test'`. `SIC_COLLISION` was removed. vNext has no self-test
   injection: every row in its decode list is a reception, and synthetic testing is done only
   by the separate benchmark and loopback commands, which never feed the live list.
5. **Regression test.** `legacyLabels.test.mjs` (decode labelling).
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** None in production. The legacy source can still be run by hand.
9. **Status.** **FIXED**

### H-04 — False wiki facts

1. **Original finding.** The wiki said FT8 has no collision recovery. It described Gray
   mapping, a Kaiser filter and phase tracking that were not implemented, and claimed RF sync
   precision under 1.5 ms.
2. **Root cause.** Documentation described intentions, not code.
3. **Files changed.** Every wiki page; `docs/*.md`.
4. **Fix.** Pages were rewritten against the code, including 03 (DSP), 05 (SIC), 07 (time) and
   11 (FT8, with evidence classes and a withdrawn-claims section).
5. **Regression test.** Review, and the final term search.
6. **Test result.** The search finds each remaining occurrence only as an account of a
   withdrawn claim.
7. **Evidence.** wiki 11 §7; wiki 07.
8. **Remaining limitation.** Documentation is checked by review, not by a test.
9. **Status.** **FIXED**

### H-05 — Legacy decode ran on the UI thread

1. **Original finding.** It took 7–18 s at 10–20 stations, on the UI thread.
2. **Root cause.** A synchronous decode in a React effect.
3. **Files changed.** Legacy moved; vNext `runtime.rs` (unchanged).
4. **Fix.** vNext decodes on its own thread. The GUI renders snapshots and never blocks on a
   decode.
5. **Regression test.** None specific. `live_runtime.rs` exercises the threaded runtime.
6. **Test result.** Pass.
7. **Evidence.** Code review: `runtime.rs` spawns the decode thread.
8. **Remaining limitation.** The GUI's frame rate has not been measured on a real display.
9. **Status.** **FIXED — NOT HARDWARE VALIDATED**

### H-06 — Hard ±1.5 s window, no trustworthy time source

1. **Original finding.** The DT window is hard, and field operation depends entirely on the OS
   clock.
2. **Root cause.** It is a protocol and receiver design property.
3. **Files changed.** `crates/z30-io/src/wallclock.rs`; wiki 07; `docs/synchronization.md`;
   `timing.json`.
4. **Fix.** The window is measured (100% to ±1.5 s, 0% at ±2.0 s) and documented wherever an
   operator looks. The GUI shows the OS's own clock status and the median DT of decodes.
   Nothing claims a synchronisation it did not observe.
5. **Regression test.** `wallclock` tests; `timing.json`.
6. **Test result.** Pass.
7. **Evidence.** `timing.json`.
8. **Remaining limitation.** No built-in time source and no wider window. Widening it would
   change the receiver, and a time source would need a real decoder.
9. **Status.** **PARTIALLY FIXED**

### H-07 — Compatibility far below WSJT-X; documents implied broad support

1. **Original finding.** "139 rigs", "nine PTT methods", Raspberry Pi and platform claims were
   untested.
2. **Root cause.** The catalogue and marketing text asserted support that had not been tested.
3. **Files changed.** README, wiki 06/09/13, `docs/hardware.md`, `legacy/.../hamlibCatalog.ts`.
4. **Fix.** Every rig, PTT and platform statement now says "implemented" or "built in CI", and
   says "not tested with a radio". vNext supports rigctld, CAT, RTS/DTR, CM108 and VOX; the other
   legacy methods are listed as not ported.
5. **Regression test.** `legacyLabels.test.mjs` (catalogue); review.
6. **Test result.** Pass.
7. **Evidence.** README "At a glance".
8. **Remaining limitation.** The compatibility gap itself remains: there is no split, no
   built-in rig backends and no interoperability.
9. **Status.** **PARTIALLY FIXED**

### H-08 — MSRV did not build; CM108 absent from artefacts

1. **Original finding.** The declared 1.82 did not build the GUI, which needs 1.95. Release
   artefacts omitted CM108.
2. **Root cause.** The MSRV was declared without a CI job.
3. **Files changed.** `Cargo.toml` (`rust-version = "1.95"`), `crates/z30-gui/Cargo.toml`,
   `.github/workflows/rust.yml` (`msrv` job), `.github/workflows/release.yml`, `docs/install.md`,
   README.
4. **Fix.** One MSRV for the workspace. CI reads it from `Cargo.toml` and builds and tests on
   exactly that version. Releases build with `cm108` and check that `BUILDINFO.txt` says so.
5. **Regression test.** The CI `msrv` job; a local build and test on 1.95.0.
6. **Test result.** See TEST_RESULTS.md (1.95.0).
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** No release has been published yet, so the release workflow has
   not run on a tag.
9. **Status.** **FIXED**

### H-09 — Legacy OSD CRC check tautological

1. **Original finding.** The legacy OSD accepted its own re-encoding.
2. **Root cause.** The CRC was checked on bits the OSD had forced.
3. **Files changed.** Legacy not in production. vNext OSD was fixed in the 2026-09-23 rebuild.
4. **Fix.** Production uses the fixed OSD, which applies correlation and distance gates.
5. **Regression test.** `golden_ldpc.rs::legacy_osd_path_is_bit_exact_and_the_fixed_rule_agrees_on_it`.
6. **Test result.** Pass.
7. **Evidence.** `false.json`: 0 false decodes in 2000 slots and 56 487 LDPC attempts.
8. **Remaining limitation.** None in production.
9. **Status.** **FIXED**

### H-10 — Watterson taps normalised per realisation

1. **Original finding.** Both channel models normalised each realisation to unit power. This
   hid slow-fading power variation and made the good and moderate channels read optimistic.
2. **Root cause.** Normalisation over the frame instead of over the ensemble.
3. **Files changed.** `crates/z30-channel/src/lib.rs`, `legacy/python-oracle/z30_dsp/channel.py`
   (the one intentional change to the frozen oracle, recorded in `FROZEN.sha256`),
   `legacy/python-oracle/tests/test_channel_acquisition.py`.
4. **Fix.** Rust divides the taps by √(n·Σ|H|²) of the Doppler filter, so the ensemble mean
   power is 1. Python divides by √(mean(shape²)), which is the same. The receiver was not
   changed.
5. **Regression tests.**
   `z30-channel::tests::watterson_preserves_power_over_the_ensemble_and_not_per_frame` checks
   that the ensemble mean is ≈ 1 while individual frames vary. The Python ensemble tests in
   `test_channel_acquisition.py` check the same.
6. **Test result.** Pass.
7. **Evidence.** `fading.json`, below.
8. **Remaining limitation.** It is the project's own channel model. No independent channel
   simulator or recording was used.
9. **Status.** **FIXED**

### M-01 — Legacy rigctl console fabricated rig state

1. **Original finding.** `dump_state` always said "Icom READY", and `\get_vfo` always said `VFOA`.
2. **Root cause.** Canned replies.
3. **Files changed.** `legacy/browser-runtime/src/dsp/catController.ts`, `tests/transmitPath.test.mjs`.
4. **Fix.** The console answers `RPRT -11` (not available) instead. vNext has no such console;
   its `--diagnostics` shows only what `rigctld` returned.
5. **Regression test.** The console group in `transmitPath.test.mjs`.
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### M-02 — Hamlib catalogue "STABLE", runtime date

1. **Original finding.** 139 rigs were marked `STABLE`, `totalSupportedRigs` was 165, and
   `lastUpdated` was `new Date()`.
2. **Root cause.** The catalogue was written as marketing.
3. **Files changed.** `legacy/browser-runtime/src/dsp/hamlibCatalog.ts`, `tests/legacyLabels.test.mjs`.
4. **Fix.** Every entry is `UNTESTED`, the count comes from the array, and there are no
   generated dates. vNext ships no catalogue; it uses rigctld model numbers.
5. **Regression test.** `legacyLabels.test.mjs` (catalogue).
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### M-03 — Constant confidence 99

1. **Original finding.** Every legacy decode carried `confidence: 99`.
2. **Root cause.** A constant presented as a measurement.
3. **Files changed.** `legacy/browser-runtime/src/dsp/sicDecoder.ts`, `tests/legacyLabels.test.mjs`.
4. **Fix.** The field was removed. vNext decodes carry no confidence; the fields they do carry
   (SNR, DT, frequency, pass, AP type) are measured or derived.
5. **Regression test.** `legacyLabels.test.mjs`.
6. **Test result.** Pass.
7. **Evidence.** The term search finds `confidence: 99` only in the old audit's record and in
   the retired, now-unreachable RF-sync code.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### M-04 — Update check and Google Fonts on every launch

1. **Original finding.** Unconditional network traffic at start-up.
2. **Root cause.** Features that assumed a connection.
3. **Files changed.** `legacy/browser-runtime/src/App.tsx`, `index.html`; `z30_dsp/updater.py`
   deleted.
4. **Fix.** Both were removed from the legacy app. vNext makes no network connection except to
   the configured `rigctld` (`z30-io/src/rigctld.rs`, the only `TcpStream` in `crates/`).
5. **Regression test.** Code search, as recorded in the environment section.
6. **Test result.** One outbound connection site in `crates/`, which is rigctld.
7. **Evidence.** `grep -rn "TcpStream::connect\|reqwest\|ureq\|hyper" crates`.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### M-05 — Network time sync: spurious precision and a time-zone parse bug

1. **Original finding.** It claimed sub-millisecond precision from HTTP, and timeapi.io's time
   was parsed as local time.
2. **Root cause.** As for C-03.
3. **Files changed.** `rfTimeSyncEngine.ts`, `rfTimeSyncRetired.test.mjs`.
4. **Fix.** Retired: the query always fails and contacts nothing.
5. **Regression test.** `rfTimeSyncRetired.test.mjs` (network checks).
6. **Test result.** Pass.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### M-06 — Busy-band benchmark used non-overlapping placement

1. **Original finding.** The benchmark gave a best-case figure.
2. **Root cause.** Evenly spaced stations.
3. **Files changed.** `crates/z30-cli/src/suite.rs` (`busy`).
4. **Fix.** Stations are placed uniformly at random in frequency and DT and overlap freely. The
   placement is recorded in the JSON and stated with the figure. `perf` stays evenly spaced and
   is labelled a latency measurement.
5. **Regression test.** `sic_regression.rs::random_overlapping_bands_sic_on_versus_off_paired`.
6. **Test result.** Pass.
7. **Evidence.** `busy.json`: K = 40, 98.8% [98.2, 99.2].
8. **Remaining limitation.** Simulation only.
9. **Status.** **FIXED**

### M-07 — vNext SNR saturated near +6.6 dB

1. **Original finding.** It read 4.6 dB low at +10 dB and 13.3 dB low at +20 dB, and the QSO
   engine sent reports from it.
2. **Root cause.** The noise estimate came from the median of off-signal bins, which hold the
   signal's own GFSK leakage when the signal is strong. A +2.8 ms timing bias also left
   replica mismatch in the estimate.
3. **Files changed.** `crates/z30-dsp/src/demod.rs` (`snr_db`, `fit_residual_energy`,
   `replica_spectra`, `placed_replica`, `SNR_VALIDATED_MIN_DB/MAX_DB`), `slot.rs`, `api.rs`
   (`snr_text`), `qso.rs` (`report_for(Option<f64>)`), the GUI and the CLI,
   `crates/z30-dsp/tests/snr_accuracy.rs` (new).
4. **Fix.** The signal is estimated by a least-squares fit of the decoded frame's replica in
   the 64-point symbol spectra. The noise is estimated from the fit's residual in bins away from
   the signal. The replica's placement is refined by descent (±30 samples), which also removed
   the DT bias. `snr_db` is `None` when there is no positive estimate. The validated range is
   −22…+30 dB; outside it the display shows `<-22` or `>+30`. A report is derived only from a
   measured SNR (rounded and limited to the protocol's −30…+30); with no measurement, none is sent.
5. **Regression tests.** `snr_accuracy.rs::reported_snr_tracks_the_true_snr_from_threshold_to_plus_30_db`
   and `an_estimate_is_never_reported_above_the_strongest_signal_measured`;
   `qso_logging.rs::no_measured_snr_means_no_report_is_sent_and_none_is_logged`.
6. **Test result.** Pass.
7. **Evidence.** `snr.json`: bias −0.25 to +0.01 dB, sd ≤ 0.38 dB, from −22 to +30 dB.
8. **Remaining limitation.** Not validated outside −22…+30 dB, and not validated on fading
   channels or real audio.
9. **Status.** **FIXED**

### M-08 — CAT/CM108 PTT not released on SIGKILL or power loss

1. **Original finding.** It relies on the radio's transmit time-out.
2. **Root cause.** A process that no longer exists cannot unkey. CAT and CM108 have no
   hardware dead-man switch.
3. **Files changed.** Documentation only: `docs/safety.md`, wiki 06/13, README.
4. **Fix.** None possible in software. The operator is told to enable the radio's TOT. The
   in-process 40 s watchdog is independent of the engine and is tested.
5. **Regression test.** `safety.rs::p4_the_watchdog_unkeys_at_the_hardware_after_max_tx_seconds`,
   `p4b_the_watchdog_thread_works_without_the_engine`, `p4c_the_limit_can_never_be_raised`.
6. **Test result.** Pass. The kill-during-TX procedure (hardware-validation R-series) has not
   been performed.
7. **Evidence.** TEST_RESULTS.md.
8. **Remaining limitation.** As stated in the finding.
9. **Status.** **NOT FIXED**

### M-09 — "77-bit QSO exchange" wording

1. **Original finding.** The payload is 63 message bits.
2. **Root cause.** The code's K (77 = 63 + CRC-14) was quoted as the message size.
3. **Files changed.** `AGENTS.md`, `SPEC.md` (terminology note), README, wiki 03/04/11.
4. **Fix.** Every page says 63 message bits and 77 information bits into the code.
5. **Regression test.** The term search.
6. **Test result.** No "77-bit exchange" remains outside the old audit record.
7. **Evidence.** SPEC.md line 11.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### M-10 — Scenario tests too weak for sub-dB regressions

1. **Original finding.** Nothing in CI would notice a 0.5 dB loss.
2. **Root cause.** The tests were pass/fail at easy SNRs.
3. **Files changed.** `crates/z30-dsp/tests/sensitivity_regression.rs` (new).
4. **Fix.** 100 blind frames at −22 dB must decode at least 84 times, with no false decode.
   Today the result is 93. On the measured curve, 84% corresponds to a shift of about 0.2 dB; a
   0.5 dB regression (expected ≈ 72/100) fails with high probability.
5. **Regression test.** `minus_22_db_blind_decodes_at_least_84_of_100_with_no_false_decodes`.
6. **Test result.** Pass (93/100).
7. **Evidence.** `awgn.json` at −22 dB: 92.5%.
8. **Remaining limitation.** A single-point, 100-frame floor; shifts of a few tenths of a dB are
   caught reliably only by the benchmark suite.
9. **Status.** **FIXED**

### M-11 — Legacy resampler aliases

1. **Original finding.** It used a moving average plus linear interpolation.
2. **Root cause.** No anti-alias filter.
3. **Files changed.** Legacy not in production.
4. **Fix.** vNext's resampler is a streaming rational polyphase design with a Kaiser-windowed
   sinc prototype (≥ 80 dB stopband); the audit measured it through the production path (E020).
5. **Regression test.** `z30_dsp::resample::tests::passes_the_band_and_rejects_aliases`,
   `input_delay_locates_an_impulse`, `streaming_equals_one_shot`.
6. **Test result.** Pass.
7. **Evidence.** Audit E020.
8. **Remaining limitation.** None in production.
9. **Status.** **FIXED**

### M-12 — FWD power displayed the configuration

1. **Original finding.** `setFwdWatts(config.txPowerWatts)`.
2. **Root cause.** A configuration value was displayed where a measurement belonged.
3. **Files changed.** `legacy/.../QsoController.tsx`, `crates/z30-gui/src/app.rs`.
4. **Fix.** vNext shows "configured TX power: … (configuration, not a measurement)" and
   "Forward power / SWR: not measured". Legacy shows "set (not measured)".
5. **Regression test.** Review.
6. **Test result.** —
7. **Evidence.** `app.rs:520–523`.
8. **Remaining limitation.** z-30 reads no power or SWR meter.
9. **Status.** **FIXED**

### L-01 — The launcher fell back to Tk, then to a benchmark

1. **Original finding.** `main.py`'s fallbacks.
2. **Root cause.** It preferred showing something to reporting the failure.
3. **Files changed.** `z30_dsp/main.py`, the Tk GUIs and the installers were deleted.
4. **Fix.** `z30` and `z30-gui` report the actual failure and exit. There is no fallback path
   (`docs/architecture.md`).
5. **Regression test.** `ci.yml` hygiene rejects the launcher, Tk GUI and installers.
6. **Test result.** Pass.
7. **Evidence.** The term search: "fallback" occurs in `crates/` only as the protocol's Base-37
   callsign fallback, which is refused.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### L-02 — `./dist` in the working directory could override the app

1. **Original finding.** `locate_web_dist` preferred the working directory.
2. **Root cause.** A search path for a served bundle.
3. **Files changed.** `web_server.py` deleted.
4. **Fix.** vNext serves nothing and opens no listening socket.
5. **Regression test.** `ci.yml` hygiene.
6. **Test result.** Pass.
7. **Evidence.** No HTTP server in `crates/`; the only `TcpListener` is the scripted rigctld in
   `rigctld.rs`'s tests.
8. **Remaining limitation.** None.
9. **Status.** **FIXED**

### L-03 — Wiki 05 quoted a stale −23.1/−21.7 dB

1–4. The line was removed and wiki 05 rewritten around the measured SIC sweep.
5–6. The term search finds no −23.1 or −21.7.
7. wiki 05. 8. None.
9. **Status.** **FIXED**

### L-04 — CI tested Python 3.10/3.12 against a declared 3.9 floor

1–4. The oracle declares `requires-python >= 3.10`, and CI runs 3.10, 3.11, 3.12 and 3.13.
5–6. `ci.yml` oracle matrix. Locally: TEST_RESULTS.md.
7. `legacy/python-oracle/pyproject.toml`. 8. None.
9. **Status.** **FIXED**

### L-05 — Natural-binary symbol mapping; loss unmeasured

1. **Original finding.** Natural-binary, not Gray, mapping.
2. **Root cause.** A v1 protocol choice.
3. **Files changed.** None (documented in SPEC, wiki 03 and KNOWN_LIMITATIONS).
4. **Fix.** None. Changing it breaks v1, and the decision is reserved for the operator
   (`VNEXT_IMPLEMENTATION_PLAN.md` §8).
5–7. Not measured.
8. The loss against Gray mapping is still unmeasured.
9. **Status.** **NOT FIXED**

### L-06 — The −40 dB bandwidth depends on resolution bandwidth

1–4. Bandwidth is now quoted with its method: a Welch estimate with 8192-point segments
(0.73 Hz bins) gives 50.5 Hz (99%) and 65.9 Hz (−40 dB) for the audio waveform.
5. `loopback::tests::a_clean_loopback_recording_passes_and_measures_the_waveforms_bandwidth`.
6. Pass. 7. README "At a glance".
8. The transmitter's and ALC's effect on bandwidth is not measured.
9. **Status.** **FIXED**

### L-07 — LSB not modelled

1. **Original finding.** Both gates assume USB.
2. **Root cause.** The radiated frequency is computed as dial + audio offset.
3. **Files changed.** README, wiki 06/13, `docs/safety.md`.
4. **Fix.** The USB assumption is stated in every place an operator configures the radio. The
   gate itself still assumes USB.
5–6. None.
7. README "Limitations".
8. On LSB, the gate would check the wrong side of the dial.
9. **Status.** **PARTIALLY FIXED**

## Findings outside sections 39–42

- **vNext DT bias of +2.8 ms (audit §14.9).** Removed by the replica-placement descent
  (M-07). `snr.json` shows DT bias within ±0.5 ms at every SNR. FIXED.
- **Fabricated values F-01…F-09** are covered above: F-01 is C-03, F-02 is M-03, F-03 is H-03,
  F-04 is M-01, F-05 is M-02, F-06 is C-05, F-07 is C-04, F-08 is M-12 and F-09 is M-05.
- **Legacy PTT methods not ported** (audio tone, Raspberry Pi GPIO, TCI, WinKeyer). They are
  listed in LEGACY_STATUS.md and KNOWN_LIMITATIONS.md, not claimed.

@@BENCH_SECTION@@

@@TESTS_SECTION@@

@@SEARCH_SECTION@@

## Hardware tests not performed

None of the following has been performed. Each is specified in
[`docs/hardware-validation.md`](../../docs/hardware-validation.md):

- audio loopback through a real cable and interface (decode, DT, frequency, spectrum,
  sample-clock error);
- dummy-load RF with a real radio: CAT frequency set and readback, PTT, TX inhibit, the
  time-out, an unexpected rigctld disconnect;
- each PTT method against real hardware: CAT, serial RTS, serial DTR, CM108, VOX;
- killing the process while transmitting, for each PTT method;
- the GUI on a real display (frame rate, usability);
- any on-air reception or QSO;
- any GPS/PPS or other time reference.

## Conclusion

The production application is the Rust workspace, and nothing else is installed or started.
Its receiver is the one measured. All six critical findings are fixed, one of them (C-01)
without hardware validation. Of the remaining 29 findings, 22 are fixed, one is fixed without
hardware validation, three are partially fixed, and three are not fixed: H-02 needs equipment,
M-08 cannot be fixed in software, and L-05 is a protocol decision. Every performance figure is
software simulation. **Real-radio validation has not been performed, and nothing in this
repository should be read as a claim that z-30 works on the air.**
