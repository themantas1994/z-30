# Fixes, finding by finding

One line of cause, fix, test and status for each finding in `Z30_FULL_AUDIT_2026-09-24.md`
(audited commit `224b2fc`). The full nine-part record for each finding (root cause, files,
fix, regression test, test result, evidence, remaining limitation, status) is in
[FINAL_AUDIT.md](FINAL_AUDIT.md). Statuses use only the five allowed values.

"Legacy" means the browser/Python runtime that was the installed product at `224b2fc`. It no
longer ships: it was moved to `legacy/` and no installer, release artefact or entry point
reaches it ([LEGACY_STATUS.md](LEGACY_STATUS.md)). Where a legacy defect was also neutralised in
the retained source, that is stated, because the source can still be run by hand.

## Critical

| ID | Finding | Fix | Regression test | Status |
| :--- | :--- | :--- | :--- | :--- |
| C-01 | The installed (legacy) receiver did not decode live audio at its trigger | vNext is the only application. Its runtime decodes a slot only once the complete window (slot + 25.5 s) has arrived, through `decode_slot` | `z30-engine/tests/live_runtime.rs::c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime` (virtual card and wall clock; mutation-checked: decoding from a window that ends early makes it fail) | FIXED — NOT HARDWARE VALIDATED |
| C-02 | −22.9 dB presented as the sensitivity of "the decoder that ships" | Every sensitivity figure now names implementation, simulation, channel, SNR reference, frames, seed, success criterion, interval and "not measured on hardware", from the new vNext result files | the CI benchmark-suite job regenerates the JSON; figures are pasted from `research/summarize_suite.py` | FIXED |
| C-03 | Legacy RF time sync reported success from noise/simulator and persisted offsets | Production has no RF or network time sync: it reads the OS clock and reports only what the OS says about its synchronisation. The legacy engine and network query now always fail and contact nothing | `z30-io` `wallclock::tests::synchronised_is_claimed_only_when_the_os_says_so`, `utc_is_the_operating_systems_with_no_offset_applied`; `legacy/browser-runtime/tests/rfTimeSyncRetired.test.mjs` (noise, empty audio, simulator audio, network; mutation-checked) | FIXED |
| C-04 | Stale committed `web_dist` defaulting to W1AW | `web_dist` deleted. vNext has no default callsign ("not set", TX refused). CI scans release binaries for W1AW | `config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`; `safety.rs::g1_…`; `rust.yml` "No real callsign ships in a binary" | FIXED |
| C-05 | Legacy auto-logger fabricated QSO fields | vNext records only decoded/measured values; `QsoRecord::validate` refuses a record with no partner or a pre-2020 time; the logbook stores UTC seconds; migration drops the legacy defaults (FN31/−16). The legacy auto-logger was also corrected (UTC, no defaults) | `z30-engine/tests/qso_logging.rs` (4), `z30-io/tests/logbook_integrity.rs` (4, including a non-UTC `TZ`), `migrate::tests::the_legacy_auto_loggers_defaults_and_runtime_state_are_not_migrated` | FIXED |
| C-06 | Legacy packer sent a different grid; gate checked only our own call | vNext TX gate checks `EncodedMessage::verify_round_trip` (symbols → Costas → codeword → syndrome → CRC → fields → text) against the whole message. The legacy gate was given the same rule | `z30-protocol/tests/round_trip.rs` (6: all 32 400 grids, all reports/acks, sampled call space, the audit's substitutions), `safety.rs::g6_the_whole_frame_is_checked_partner_call_grid_and_report_not_just_our_call`, `transmitPath.test.mjs` C-06 group | FIXED |

## High

| ID | Finding | Fix | Regression test | Status |
| :--- | :--- | :--- | :--- | :--- |
| H-01 | Legacy SIC not physical; duplicates | Legacy SIC unreachable from any shipped program. vNext LS-SIC, measured against the truth | `z30-dsp/tests/sic_regression.rs` (4), `channel_scenarios.rs` SIC scenario, paired `sic.json` sweep | FIXED |
| H-02 | No real-world validation | Cannot be fixed without equipment. A repeatable procedure and `z30 --loopback-test` were added; nothing is claimed | `loopback::tests` (3, software only) | NOT FIXED |
| H-03 | Self-test shown as real decodes; fake collision | Legacy self-test labelled `SYNTHETIC TEST` with `source: synthetic`; the non-colliding SIC preset removed. vNext has no injected decodes | `legacy/browser-runtime/tests/legacyLabels.test.mjs` (decode labelling) | FIXED |
| H-04 | False wiki facts (FT8 no SIC, Gray, Kaiser, phase tracking, RF sync precision) | Wiki rewritten against the code | review; the final term search in FINAL_AUDIT.md | FIXED |
| H-05 | Legacy decode on the UI thread | Legacy retired. vNext decodes on a dedicated thread; the GUI only reads snapshots | code review: `runtime.rs` spawns the decode thread; the GUI renders snapshots. Not measured on a real display | FIXED — NOT HARDWARE VALIDATED |
| H-06 | Hard ±1.5 s window, no trustworthy time source | The window is a protocol property; now measured (`timing.json`) and documented. OS clock status reported honestly; nothing claims synchronisation it did not observe | `wallclock` tests; `timing.json` | PARTIALLY FIXED |
| H-07 | Compatibility well below WSJT-X; docs implied broad support | Every rig/platform/PTT claim now says "implemented, not tested with hardware"; the Hamlib catalogue claims were removed. The gap itself remains | review | PARTIALLY FIXED |
| H-08 | MSRV 1.82 did not build; CM108 absent from artefacts | `rust-version = "1.95"` workspace-wide; CI `msrv` job builds and tests on 1.95; release builds with `cm108` and checks `BUILDINFO.txt` says so | `rust.yml` msrv job; local 1.95 build (TEST_RESULTS.md) | FIXED |
| H-09 | Legacy OSD CRC check tautological | Legacy decoder not in production. vNext OSD fixed (earlier remediation, audit M1) | `golden_ldpc.rs::legacy_osd_path_is_bit_exact_and_the_fixed_rule_agrees_on_it`; `false.json` | FIXED |
| H-10 | Watterson normalised per realisation (optimistic) | Rust and Python both normalise over the ensemble; fading re-run at 200 frames/point | `z30-channel::tests::watterson_preserves_power_over_the_ensemble_and_not_per_frame`; `tests/test_channel_acquisition.py` ensemble tests; `fading.json` | FIXED |

## Medium

| ID | Finding | Fix | Regression test | Status |
| :--- | :--- | :--- | :--- | :--- |
| M-01 | Legacy rigctl console fabricated rig state | Console answers `RPRT -11` (not available) instead of invented state | `transmitPath.test.mjs` console group | FIXED |
| M-02 | 139 rigs "STABLE", runtime date | All entries `UNTESTED`; no generated date | `legacyLabels.test.mjs` (catalogue) | FIXED |
| M-03 | Constant confidence 99 | Field removed from the legacy decode; vNext never had one | `legacyLabels.test.mjs` | FIXED |
| M-04 | Update check and Google Fonts on every launch | Both removed from the legacy app. vNext opens no network connection except to the configured `rigctld` | code search (FINAL_AUDIT.md) | FIXED |
| M-05 | Network time sync: spurious precision, TZ parse | Retired; always fails, contacts nothing | `rfTimeSyncRetired.test.mjs` | FIXED |
| M-06 | Busy-band benchmark used non-overlapping placement | `busy` benchmark places stations uniformly at random, overlapping | `busy.json` | FIXED |
| M-07 | vNext SNR saturated near +6.6 dB; wrong reports sent | Least-squares replica fit with residual noise estimate and replica placement; validated −22…+30 dB; outside it the display shows a bound and no report is derived from an unmeasured value | `snr_accuracy.rs` (2), `qso_logging.rs::no_measured_snr_means_no_report_is_sent_and_none_is_logged`, `snr.json` | FIXED |
| M-08 | CAT/CM108 PTT not released on SIGKILL/power loss | Not fixable in software; documented with the radio's TOT as the defence. The in-process watchdog is tested | `safety.rs::p4_…` (watchdog) | NOT FIXED |
| M-09 | "77-bit QSO exchange" wording | Corrected to 63 message bits everywhere | final term search | FIXED |
| M-10 | Scenario tests could not see sub-dB regressions | `sensitivity_regression.rs`: ≥ 84/100 at −22 dB blind (measured 93) | itself | FIXED |
| M-11 | Legacy resampler aliases | Not in production; vNext uses its own resampler (measured by the audit, E020) | `z30-dsp` `resample::tests` (3) | FIXED |
| M-12 | FWD power showed the configuration | vNext shows "configured TX power (configuration, not a measurement)" and "Forward power / SWR: not measured"; legacy labels it "set (not measured)" | review | FIXED |

## Low

| ID | Finding | Fix | Regression test | Status |
| :--- | :--- | :--- | :--- | :--- |
| L-01 | Launcher fell back to Tk, then to a benchmark | Launcher deleted; `z30`/`z30-gui` report the failure and exit | `ci.yml` hygiene (no launcher, installer or `z30_dsp/` tracked) | FIXED |
| L-02 | `./dist` from the CWD could override the app | `locate_web_dist` and the web server deleted; vNext serves nothing | `ci.yml` hygiene (no `web_dist`, no `dist/`) | FIXED |
| L-03 | Wiki 05 stale −23.1/−21.7 dB | Removed | final term search | FIXED |
| L-04 | CI Python 3.10/3.12 vs a 3.9 floor | Oracle declares `>=3.10`; CI runs 3.10–3.13 | `ci.yml` | FIXED |
| L-05 | Natural-binary mapping; loss unmeasured | Protocol property; changing it breaks v1. Documented; still unmeasured | — | NOT FIXED |
| L-06 | −40 dB bandwidth depends on RBW | Figures quoted with Welch 8192-point, 0.73 Hz bins | `loopback::tests` | FIXED |
| L-07 | LSB not modelled | USB assumption stated in the README, wiki 06/13 and docs; the gate still assumes USB | — | PARTIALLY FIXED |
