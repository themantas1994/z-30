# Active remediation history: PRs #1–#45

| | |
| :--- | :--- |
| Generated | 2026-09-28 |
| Base commit | `78db463` (merge of PR #45; 144 commits in `git log`) |
| Method | Local git history (`git log --merges`, `git log <merge>^1..<merge>^2`, `git show --stat`, commit messages) and the audit records under `audit/`. GitHub PR metadata (titles, merge state, and the closing comments on #37 and #40) was read through the GitHub API. Local git is authoritative. |
| Scope | Every PR number from #1 to #45. 43 were merged; #37 and #40 were closed without merging. |
| Validation state | **Protocol validated; software simulation validated; hardware not validated; on-air not validated.** Nothing in this history involved a radio, sound card, PTT line or RF path. |

**Purpose.** This file is here so that fixed bugs are not rediscovered and rejected approaches
do not come back without anyone noticing. It records history only. Where it and `AGENTS.md`,
`SPEC.md`, `docs/` or a test disagree, those sources are authoritative.

**Dates.** Dates are the git author date of the merge commit. GitHub's UTC `merged_at` is one
day earlier for #4 (2026-08-30), #23 and #24 (2026-09-01), and #38, #39 and #41 (2026-09-25).

**Finding-ID namespaces.** Several audits reuse the same IDs, so check the source before
quoting one.
- `Z30-0xx`: the 2026-08-30 code audit of `29cfe1f`. That report is not in the repository.
- `A1…D7`: the "systems audit" closed in #14. Its `C1…C6` are **not** the vNext `C1…C6`. That report is not in the repository.
- `C1…C6`, `H1…H10`, `M1…M13`, `L1…L6`: the 2026-09-23 vNext audit, `audit/2026-09-23-vnext/README.md` §H.
- `C-01…C-06`, `H-01…H-10`, `M-01…M-12`, `L-01…L-07`: the 35 findings of `Z30_FULL_AUDIT_2026-09-24.md`. That file is **not in the repository or its history** (`audit/2026-09-24-corrective-remediation/BASELINE.md:29`). Its findings are known from `audit/2026-09-24-vnext-remediation/FIXES.md`.
- `N-01…N-15`: the post-remediation audit, `audit/2026-09-24-post-remediation/FINAL_AUDIT.md` §25.
- `CTO-`, `TX-`, `DSP-`, `DOC-`, `QA-`, `RES-`, `F-01…F-79`: the 2026-09-28 agent-team review, `audit/2026-09-28-agent-team-review/`.

---

## Engineering stages

**Browser/Python era, #1–#31 (2026-08-30 to 2026-09-03).** The product was a React/TypeScript
browser transceiver served by a local Python web server, with Python DSP, Tk GUIs and
installers. This era produced the lasting rules:
- one fail-closed `canTransmit` gate (#1, #2);
- continuous-phase GFSK with no per-symbol gating (#1);
- honest-number rules (#1, #2, #6, #8, #29, #30);
- readback that only adds refusals (#12);
- no real-station default callsign (#20);
- AP decoding that never runs first (#28).

None of that code runs today.

**vNext audit and rebuild, #32–#34 (2026-09-23 to 2026-09-24).**
- #32 audited the runtime and found it did not work as a weak-signal receiver (C1–C6). It recommended a Rust rebuild.
- #33 built the Rust workspace in `crates/` with golden parity against the Python oracle.
- #34 remediated the external 2026-09-24 audit and retired the browser/Python runtime to `legacy/`. From #34 on, `crates/` is the only application.

**Post-remediation audit and corrective remediation, #38–#39 (2026-09-26).**
- #38 independently verified #34 and found N-01…N-15, including the 1/√2 Doppler error, the re-encoding after the gate, loopback bypassing the gate, and default-dial provenance.
- #39 fixed them: `VerifiedFrame`, a software-only loopback, corrected Doppler, dial provenance, and disjoint replicates.

**Research process and later work (2026-09-26 to 2026-09-28).**
- Research process: #41.
- Release preparation, `v0.1.0-experimental` (prepared, not published): #42.
- Lock-closure proof for dependency bumps: #43.
- Review-agent team: #44.
- The 2026-09-28 agent-team review, which recorded open findings and no board decision: #45.
- Dependabot PRs: #13, #15–#19, #35 and #36 were merged. #37 and #40 were closed unmerged.

---

## Rejected or retired approaches that must not return

Each entry names what was rejected, the PR that removed it, and where the repository records
that it was rejected. Every citation was checked against the tree at `78db463`.

### Transmit path

1. **Per-symbol amplitude gating, or a fresh oscillator per symbol.** This is amplitude keying at 3.125 baud, with 225 Hz at −40 dB against 66 Hz for the correct waveform.
   - Removed in #1.
   - Recorded in `AGENTS.md` §4 "Signal integrity" and `legacy/python-oracle/tests/test_modem_spectrum.py::test_legacy_per_symbol_gating_fails_the_budget`.
   - The SIC replica built from the gated waveform was also wrong (vNext C3, `docs/sic.md:9`).
2. **A transmit path that bypasses the single gate, or a second keying implementation.** Examples: `testPttKey`'s own nine methods that reported "verified" without hardware (#5), the Python `HamlibCatClient.set_ptt()` removed in #10, and the raw console `T 1` before #5.
   - Recorded in `AGENTS.md` §4: "One keying implementation (`PttController`), which reports whether the hardware accepted the command".
3. **An unkey sent to a different line or host than the key.** Example: release on GPIO 3 after keying GPIO 4 (#5).
   - Recorded in `AGENTS.md` §4: "a release drives what the key drove".
4. **A gate that checks only the station's own callsign, or only the centre frequency.**
   - #2 made the band check cover the whole emission (Z30-006).
   - C-06 (#34) made the whole frame round-trip.
   - Recorded in `AGENTS.md` §4; tests `crates/z30-engine/tests/safety.rs::g6_the_whole_frame_is_checked_partner_call_grid_and_report_not_just_our_call` and `crates/z30-protocol/tests/round_trip.rs`.
5. **Transmitting a re-encoding after the gate** (N-03). The transmit path accepts only a `VerifiedFrame`.
   - Fixed in #39 (`46e73cf`, `a37c4f2`).
   - Recorded in `AGENTS.md` §4; `crates/z30-protocol/tests/frame_integrity.rs`; `safety.rs::n3_*`.
6. **Silently transforming a message the codec cannot carry.** This covers:
   - ZV–ZZ wrap, compound or portable calls sent as a different call (vNext C5, fixed first in `legacy` by #33 `8be9e00`);
   - the grid table hashing FN42 to RE78 (H2);
   - a lost roger bit (H3);
   - free text coerced into fields (M6).

   The policy is "refuse, never transform", recorded in `AGENTS.md` §4, `SPEC.md` and `round_trip.rs::the_audit_substitutions_are_all_refused`.
7. **A shipped default callsign, especially a real station's (W1AW).**
   - #20 replaced W1AW with the placeholder NOCAL.
   - The stale bundle still shipped W1AW (vNext C6 / C-04). #34 deleted it and removed any default.
   - Guarded by `AGENTS.md` §4; `crates/z30-engine/src/config.rs::a_new_installation_is_unconfigured_and_cannot_transmit`; the W1AW scans in `.github/workflows/rust.yml:66` and `release.yml:127` (the second added in #42).
   - **Open:** TX-13 = DOC-02. `z30 --migrate` can still import the old W1AW default and writes `tx_level = 0.5`.
8. **A default dial, or logging a configured or default dial as "commanded" or measured.** Instances: the FT8 14.074 MHz default removed in #31, and the 14.076 MHz "commanded" default (N-05).
   - Fixed in #39 `a37c4f2`.
   - Recorded in `AGENTS.md` §4; `crates/z30-engine/tests/dial_provenance.rs`.
9. **Loopback that can reach a transmitter.** `--loopback-test` played its frame through the sound card, past the gate (N-04).
   - Fixed in #39 `672cef9`.
   - Recorded in `AGENTS.md` §4; `crates/z30-cli/tests/loopback_isolation.rs`.
10. **rigctld PTT queued behind polls** (systems audit A3, #14).
    - Recorded in `AGENTS.md` §4: "rigctld PTT runs on its own connection".
11. **Open-loop trust of the commanded dial** (#12). The same PR also rejected the over-correction, a gate that refuses when there is no readback.
    - Recorded in `AGENTS.md` §4: "Readback only adds refusals".
12. **Fabricated rig and power state.** Examples: fake SWR, and forward watts copied from the configuration.
    - Removed in #1; M13 / M-12.
    - Also the rigctl console that invented VFO state (M-01) and a catalogue labelled "STABLE" (M-02).
    - Recorded in `AGENTS.md` §4 "Honest values": forward power and SWR are "not measured".

### Receiver and benchmarks

13. **Timer-based slot decoding** (vNext C1 / C-01). The decode fired at 24.0 s for a window that ends at 25.5 s.
    - Recorded in `AGENTS.md` §4 "Live scheduling"; `crates/z30-engine/tests/live_runtime.rs::c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime`.
14. **The legacy front end: an energy candidate detector and 3.125 Hz grid snapping** (C2 / C-02). It reached 50% at about −14.9 dB, against a published −22.9 dB.
    - Recorded in `audit/2026-09-23-vnext/README.md` §H, `legacy/browser-runtime/README.md:45` and `wiki/08`.
15. **Any second receiver or benchmark-only decoder.** Examples:
    - the browser benchmark's analytic `MATCHED_FILTER_CORRELATOR_BANK` path, fake "Rayleigh" gains, an AWGN-labelled `CO_CHANNEL_QRM` option and a "Shannon" decode-probability curve (#30);
    - three different Costas front ends (#29 `72362e5`).

    Recorded in `AGENTS.md` §4 "One receiver, one modulator"; banned-name check in `legacy/python-oracle/tests/test_cross_language_parity.py:496`.
16. **A receiver parameter kept in a benchmark, or a semi-coherent pilot term in the blind receiver.**
    - The benchmark measured one weight while the on-air decoder used another. That decoder was 1.77 dB worse on AWGN (#8 `21feaf7`, #29 `e5d795f`).
    - Recorded in `AGENTS.md` §4 ("`RECEIVER_PILOT_COHERENCE` in `demod.rs`"), `SPEC.md:243` and `test_cross_language_parity.py::test_the_benchmark_demodulates_like_the_receiver_that_ships`.
17. **Comparing a genie-aided bound with another mode's real-world figure.** This produced the "+4.0 dB advantage over FT8", the 2.5× ERP claim and the UI "Gain vs FT8" tile.
    - Withdrawn in #1, #5 and #8.
    - Recorded in `wiki/11` §7 and `AGENTS.md` §5 (the word "threshold").
18. **The legacy SIC collision table (98.7/95.2/91.4/84.6 %), "−27.5 dB" and "−31.5 dB", and "FT8 has no collision recovery".**
    - Retracted in #14 (D2) and #21.
    - Recorded in `AGENTS.md` §5 and `wiki/11` §7.
19. **Invented SIC diagnostics.** The residual floor came from an arithmetic progression, `-14.2 - (pass - 1) * 14.3` (#21).
    - Recorded in `legacy/browser-runtime/src/dsp/realReceiver.ts:162` and `legacy/browser-runtime/tests/dspDeterminism.test.mjs:215`; the principle is `AGENTS.md` §4 "Honest values".
    - In vNext, `PassStats::suppression_db` must not be quoted as physical suppression, because it overstates by about 10 dB (`AGENTS.md` §4, `docs/sic.md:36`).
20. **An SNR estimator whose noise comes from the received spectrum's off-tone bins** (M-07). It saturated near +6.6 dB.
    - Fixed in #34 `d8983ee`.
    - Recorded in `AGENTS.md` §4; `crates/z30-dsp/tests/snr_accuracy.rs`.
    - Also rejected: a floor value in place of `None` (N-08 / SNR-e), guarded by `snr_accuracy.rs::no_signal_is_no_estimate_never_a_floor_value`.
    - **Open:** DOC-04. `docs/demodulation.md` still describes the retired estimator.
21. **A per-decode confidence, such as the constant 99** (vNext M5 / M-03).
    - Recorded in `AGENTS.md` §4: "There is no per-decode confidence".
22. **The OSD's tautological CRC and syndrome check** (M1 / H-09).
    - Fixed in #33.
    - Guarded by `crates/z30-dsp/tests/golden_ldpc.rs::legacy_osd_path_is_bit_exact_and_the_fixed_rule_agrees_on_it`.
23. **Unseeded RNG on a receive or benchmark path.** Example: `addCalibratedAwgn` on `Math.random()` (systems audit B1, #14).
    - Recorded in `AGENTS.md` §4 "Determinism".
24. **AP running first, AP on by default, or AP-assisted decodes left unlabelled** (#28).
    - Recorded in `AGENTS.md` §4 "A priori decoding".
    - **Open:** DSP-03. The production AP path has no test and no false-decode figure.

### Channel model and published figures

25. **Watterson taps normalised per realisation** (H-10). This made fading results optimistic. The retired "−21.4 dB mid-latitude" figure came from this model.
    - Fixed in #34 `d8983ee`.
    - Recorded in `AGENTS.md` §4 and §5; `crates/z30-channel/src/lib.rs::watterson_preserves_power_over_the_ensemble_and_not_per_frame`; `docs/benchmarking.md:295`.
26. **The power-spectrum formula used as the amplitude response** (N-01). Every preset ran at 1/√2 of its labelled Doppler spread, so the figures −20.79 / −21.31 / −21.07 dB are withdrawn.
    - Fixed in #39 `b75f773`.
    - Recorded in `AGENTS.md` §4 and §5; `z30-channel` tests `watterson_power_spectrum_has_the_labelled_2_sigma_spread` and `generated_taps_have_the_labelled_doppler_spread`; `legacy/python-oracle/tests/test_watterson_doppler.py`; `docs/benchmarking.md` withdrawn column.
27. **Suite replicates taken with small base seeds (`--seed`).** Seeds 1–7 regenerated the published frames.
    - Replaced by `--replicate` in #39 `18fbd78`.
    - Recorded in `AGENTS.md` §5; `crates/z30-cli/src/suite.rs::replicates_share_no_frame_with_each_other_or_the_published_run`.
28. **Crossings from fewer than 200 frames per point published as figures.** The earlier 40-frame figures were superseded in #29.
    - Recorded in `AGENTS.md` §5.
29. **Figures quoted from superseded instruments.** Examples:
    - "−21.1 dB" (#2, superseded by #8);
    - "−23.1 / −21.7 dB" (L-03);
    - "−22.9 dB" presented as the shipped receiver's figure (C-02);
    - "z-30 is level with FT8" (#2).

    Recorded in `wiki/11` §7 and `FIXES.md` L-03 / C-02.

### Time, logging and runtime

30. **Any RF or network time source, or setting the OS clock.**
    - #1 made setting the OS clock from off-air audio opt-in and bounded.
    - H4 / C-03 found RF time sync "succeeding" on noise, so #34 retired it.
    - Recorded in `AGENTS.md` §4 "Time"; `docs/safety.md:149`; `wiki/07`; `legacy/browser-runtime/tests/rfTimeSyncRetired.test.mjs`.
31. **Auto-log fabrication.** Local time was logged as UTC, and default FN31 / −16 values were written (vNext H1 / C-05).
    - Recorded in `AGENTS.md` §4 (`QsoRecord::validate`); `crates/z30-io/src/migrate.rs` drops these legacy defaults on import.
32. **A 1970 fallback for an unknown time** (N-13).
    - #39 added `wallclock::system_utc` and the "UTC unknown" labelling.
33. **Decoding on the UI thread** (C4 / H-05) **and relying on main-thread timers** (H8).
    - vNext decodes on its own thread and the GUI renders snapshots (`AGENTS.md` §2).

### Runtime and process

34. **The browser/Python runtime itself.** This includes the local web server and its API, the Tk GUIs, the launcher's fallback to Tk and then to a benchmark (L-01), the in-app git updater (#8), the committed `web_dist` bundle (C6 / C-04), and the installers.
    - Retired in #34 `17c3e8e`.
    - Recorded in `AGENTS.md` §1 and §7 ("no fallback"), `wiki/08`, `wiki/12`, and the `ci.yml` hygiene job.
    - Also rejected with it: the `?token=` query-string credential fallback (systems audit C3, #14; `web_server.py` was deleted in #34).
35. **Anything in `crates/` depending on `legacy/`.**
    - Recorded in `AGENTS.md` §7; the `ci.yml` separation guard.
36. **A routine dependency bump that moves the RNG crates** (`rand`, `rand_chacha`, `rand_distr`). These generate every seeded channel realisation, so moving them is a research-process §2 change, not a §7 one.
    - Rejected with #37.
    - Recorded in `research/lock_closure.py`, `docs/research-process.md` §7, and the closing comment on #37.
    - **Open:** `.github/dependabot.yml` still groups all cargo crates (`patterns: ["*"]`), as the #37 comment warned.

**Not ported, rather than rejected.** The legacy app also offered the right-channel audio PTT
tone (#25), Raspberry Pi GPIO, TCI and WinKeyer keying, and direct-serial Kenwood, Yaesu and
CI-V CAT (#10). vNext does not implement any of these. CAT goes only through `rigctld`, and
`--migrate` reports these methods as not migrated (`docs/hardware.md:56`). None of them was
ever tested on hardware.

---

## PR index

| PR | Title (GitHub) | Merge | Date | Merged | In production today |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | Address the code audit: transmitter containment, TX safety, local API auth, honest claims | `6eea1be` | 2026-08-30 | yes | no (legacy) |
| 2 | Measure z-30's real decode threshold, and gate transmit on the whole emission | `83d6e77` | 2026-08-30 | yes | no (legacy) |
| 3 | docs: make the wiki the source of truth and the README a front page | `46d2e58` | 2026-08-30 | yes | AGENTS.md/CLAUDE.md yes, rewritten |
| 4 | refactor(ui): give the Monte Carlo benchmark a single home in Settings | `c0641ad` | 2026-08-31 | yes | no (legacy) |
| 5 | fix(ui): close the 21 findings from the UI and frontend audit | `970d882` | 2026-08-31 | yes | no (legacy) |
| 6 | docs(wiki): correct the LDPC decoder schedule count, backed by a benchmark | `f341c6a` | 2026-08-31 | yes | AGENTS §5 rule yes |
| 7 | docs: sync README with logbook exports and the LDPC decoder correction | `cf06ee7` | 2026-08-31 | yes | no (text superseded) |
| 8 | Fix the audit findings, unify the benchmark engines, and rebuild the updater | `4d4fc44` | 2026-08-31 | yes | no (legacy) |
| 9 | fix(sync): stop a missing PortAudio from crashing on Android, and correct the Android guide | `305be54` | 2026-08-31 | yes | no (legacy) |
| 10 | fix(cat): real-world CAT and PTT keying — 16 audit findings fixed | `f04390d` | 2026-08-31 | yes | no (legacy) |
| 11 | docs: retire the PTT/CAT audit, and record its two open gaps in the wiki | `9662432` | 2026-09-01 | yes | no (legacy) |
| 12 | feat(cat): port WSJT-X's closed-loop rig state model, so the gate checks the radio | `17926fd` | 2026-09-01 | yes | concept ported (#33) |
| 13 | build(deps): bump requests … 2.33.0 (dependabot) | `d8edded` | 2026-09-01 | yes | no |
| 14 | fix: close the 27 findings of the z-30 systems audit | `87ee46a` | 2026-09-01 | yes | no (legacy) |
| 15 | chore(ci): bump actions/checkout from 4 to 7 | `ec277b2` | 2026-09-01 | yes | CI only (v7 in use) |
| 16 | chore(ci): bump actions/setup-node from 4 to 7 | `c43e15c` | 2026-09-01 | yes | CI only (v7 in use) |
| 17 | chore(ci): bump actions/setup-python from 5 to 7 | `dbb7bf5` | 2026-09-01 | yes | CI only (v7 in use) |
| 18 | chore(deps): bump the python-runtime group with 3 updates | `708e983` | 2026-09-01 | yes | no |
| 19 | chore(deps): bump the frontend group with 6 updates | `27dc83d` | 2026-09-01 | yes | no (legacy) |
| 20 | fix(config): ship NOCAL as the placeholder callsign, not a real station | `394319b` | 2026-09-01 | yes | no (superseded) |
| 21 | fix(dsp): replace invented SIC diagnostics with real measurements | `57c0e0e` | 2026-09-01 | yes | no (legacy) |
| 22 | Codebase cleanup: dedup shared logic, remove dead code, fix bugs found along the way | `9e0431f` | 2026-09-01 | yes | no (legacy) |
| 23 | docs(readme): improve SEO and readability for new users | `6d602fe` | 2026-09-02 | yes | no (README rewritten) |
| 24 | docs(readme): fix quickstart command from z-30 to z30 | `be62ee2` | 2026-09-02 | yes | no (README rewritten) |
| 25 | fix(audio): refuse right-channel PTT tone on mono-only output devices | `b1cb88b` | 2026-09-02 | yes | no (method not ported) |
| 26 | feat(dsp): parallelise the benchmark sweep without moving the curve | `209e88d` | 2026-09-02 | yes | no (oracle only) |
| 27 | perf(dsp): halve the cost of a failing LDPC decode, bit-identically | `d7e5fcd` | 2026-09-02 | yes | no (oracle only) |
| 28 | feat(dsp): a priori (AP) decoding, ported from WSJT-X | `d8e3cde` | 2026-09-02 | yes | concept ported (#33) |
| 29 | Make the benchmark measure the decoder that ships, and publish the set … | `d2e922c` | 2026-09-03 | yes | rules yes; code legacy |
| 30 | fix(dsp): the browser benchmark measured a model, not the shipped receiver | `ae26d00` | 2026-09-03 | yes | no (legacy) |
| 31 | fix(logbook): stop defaulting to FT8's dial frequency instead of z-30's own | `7661caa` | 2026-09-03 | yes | no (superseded) |
| 32 | docs(audit): vNext technical audit, measurements and rebuild plan | `c83bef0` | 2026-09-23 | yes | audit record |
| 33 | z-30 vNext: Rust protocol, receiver, engine and tooling | `224b2fc` | 2026-09-24 | yes | **yes** |
| 34 | vNext as the only runtime: 2026-09-24 audit remediation | `84033d4` | 2026-09-24 | yes | **yes** |
| 35 | chore(ci): bump actions/upload-artifact from 5 to 7 | `0a4d8a9` | 2026-09-24 | yes | CI only (v7 in use) |
| 36 | chore(ci): bump actions/download-artifact from 5 to 8 | `76ebc46` | 2026-09-24 | yes | CI only (v8 in use) |
| 37 | chore(deps): bump the rust group with 5 updates | — | closed 2026-09-26 | **no** | n/a |
| 38 | docs(audit): independent post-remediation verification audit | `4d2140e` | 2026-09-26 | yes | audit record |
| 39 | Corrective remediation of the post-remediation audit findings | `01a3bd4` | 2026-09-26 | yes | **yes** |
| 40 | chore(deps): bump pyo3 from 0.25.1 to 0.29.0 | — | closed 2026-09-26 | **no** | n/a |
| 41 | docs: research process for changes reaching main | `0d40199` | 2026-09-26 | yes | yes (process) |
| 42 | First release: v0.1.0-experimental (prepared, NOT published) | `207caac` | 2026-09-28 | yes | yes (version, release.yml) |
| 43 | chore(research): lock-closure proof for section 7 dependency updates | `fe8f246` | 2026-09-28 | yes | yes (process tool) |
| 44 | docs: agent team for the research-process review roles | `caf1a9a` | 2026-09-28 | yes | yes (tooling) |
| 45 | docs(audit): 2026-09-28 whole-project review by the agent team | `78db463` | 2026-09-28 | yes | audit record |

"Legacy" means the code was moved to `legacy/` or deleted by #34 (`17c3e8e`). It is neither
built nor shipped, and it can be recovered from `224b2fc`.

---

## Per-PR entries

### #1 — Address the code audit: transmitter containment, TX safety, local API auth, honest claims
- **Merge:** `6eea1be`, 2026-08-30. Commits `998a82f`, `c699317`.
- **Purpose:** Worked through the audit of the initial upload `29cfe1f`: waveform integrity, transmit safety, local API attack surface, durability and packaging. Withdrew the FT8 sensitivity comparison.
- **Important files:** `z30_dsp/modem.py`, `src/dsp/z30Waveform.ts`, `src/dsp/bandPlan.ts`, `z30_dsp/web_server.py`, `z30_dsp/rf_time_sync.py`, `z30_dsp/benchmark.py`, `.github/workflows/ci.yml`, `tests/`.
- **Decisions:**
  - Continuous-phase, constant-envelope GFSK with one raised-cosine ramp per frame. Per-symbol gating removed from both transmitters and from the Monte Carlo engine's third modulator copy.
  - A single fail-closed `canTransmit()` gate.
  - A `MAX_TX` timer, a GPIO dead-man switch and signal handlers.
  - Per-run bearer token and origin/Host checks on `/api/*`.
  - Setting the OS clock from off-air audio made opt-in.
  - Fake SWR and forward power and `rigctlSimulator.ts` deleted.
  - Benchmark relabelled as a genie-aided bound. The "+4.0 dB over FT8" / ERP claims withdrawn.
  - Generated in-app wiki and Python source copies, with a CI staleness check.
- **Tests added:** `tests/test_modem_spectrum.py`, `test_ldpc_codec.py`, `test_cross_language_parity.py`, `test_time_sync_guards.py`, `test_web_server_api.py`, `crc14.test.mjs`, `frontend.test.mjs`, `tests/vectors/crc14_vectors.json` (62 pytest in total).
- **Audit findings:** the audit of `29cfe1f` (IDs `Z30-0xx`; report not in the repository).
- **In production:** No. The waveform rule survives as `AGENTS.md` §4 and `z30_protocol::gfsk`.
- **Later modified or invalidated by:**
  - #2 replaced the bound as the headline with a blind-acquisition measurement.
  - #14 bounded cumulative clock steps.
  - #34 retired the runtime, including the OS-clock setting.
- **Current status:** Retired. The rules it introduced (constant envelope, single gate, no fabricated SWR) are live invariants.

### #2 — Measure z-30's real decode threshold, and gate transmit on the whole emission
- **Merge:** `83d6e77`, 2026-08-30. Commit `2cc9b98`.
- **Purpose:** Added a blind-acquisition benchmark mode and a Watterson channel. Made the band-plan check cover both edges of the emission.
- **Important files:** `z30_dsp/channel.py`, `z30_dsp/acquisition.py`, `z30_dsp/benchmark.py` (`--mode realistic`), `src/dsp/bandPlan.ts`.
- **Decisions:**
  - `findPermittedSegment()` takes a bandwidth and checks both edges.
  - The published figure is the blind one: −21.1 dB, 40 frames per point.
  - QC-LDPC / Rate-1/3 wording corrected to IRA R=0.356. CRC undetected-error figure set to 2^-14.
- **Tests added:** `tests/test_channel_acquisition.py` (17 tests, including `test_acquisition_uses_only_the_audio`); band-edge cases in `frontend.test.mjs`; CI seeded reproducibility smoke test.
- **Audit findings:** Z30-025, Z30-006, Z30-026, Z30-027.
- **In production:** No. The whole-emission check survives in `txgate.rs` (the −40 dB emission edges).
- **Later modified or invalidated by:**
  - #8 found the −21.1 dB figure wrong (a demodulator term), re-measured at −23.1 dB.
  - #29 republished at 200 frames.
  - #34 H-10 replaced per-realisation normalisation in `channel.py`, and #39 N-01 corrected its Doppler.
- **Current status:** The figures are withdrawn (`wiki/11` §7). `channel.py` survives, corrected, in the frozen oracle.

### #3 — docs: make the wiki the source of truth and the README a front page
- **Merge:** `46d2e58`, 2026-08-30. Commit `297d1f0`.
- **Purpose:** Moved reference material from a 50 KB README into the wiki. Created `AGENTS.md` and a `CLAUDE.md` that imports it.
- **Important files:** `AGENTS.md`, `CLAUDE.md`, `README.md`, `wiki/13`–`wiki/16`, `scripts/generate_wiki_articles.mjs`.
- **Decisions:**
  - One authoritative document set.
  - Corrected wiki/11's retracted −25.0 dB, wiki/03's shaping description, and the CRC generator comment (0x0805 → 0x2443).
- **Tests added:** None.
- **Audit findings:** None named.
- **In production:** `AGENTS.md` and `CLAUDE.md` yes, heavily rewritten since. The wiki pages have been rewritten.
- **Later modified or invalidated by:** #33 and #34 redefined authority: `SPEC.md` is normative, `docs/` covers the code and `wiki/` is operator documentation.
- **Current status:** `AGENTS.md` / `CLAUDE.md` in force. The documentation hierarchy has been superseded.

### #4 — refactor(ui): give the Monte Carlo benchmark a single home in Settings
- **Merge:** `c0641ad`, 2026-08-31. Commit `a4f0cae`.
- **Purpose:** Removed duplicate entry points to the benchmark modal and added the genie-aided caveat to it.
- **Important files:** `src/components/StationSettingsModal.tsx`, `Header.tsx`, `SpecsModal.tsx`, `MonteCarloBenchmarkModal.tsx`.
- **Decisions:** The benchmark card sits outside the experimental unlock gate, because it never touches the sound card, CAT or PTT.
- **Tests added:** None.
- **Audit findings:** None named.
- **In production:** No.
- **Later modified or invalidated by:** #30 rewrote the engine. #34 retired it.
- **Current status:** Retired.

### #5 — fix(ui): close the 21 findings from the UI and frontend audit
- **Merge:** `970d882`, 2026-08-31. Commit `3deebce`.
- **Purpose:** Fixed critical transmit-path defects, benchmark honesty problems, and dead or duplicated code.
- **Important files:** `src/dsp/catController.ts`, `src/App.tsx`, `src/dsp/monteCarloEngine.ts`, `src/components/SpecsModal.tsx`, `src/dsp/gridSquare.ts`, `z30_dsp/station_settings.py`.
- **Decisions:**
  - `setPtt()` releases on the keying context. A GPIO 4 key was being released on GPIO 3.
  - `testPttKey()` wraps `setPtt()` and reports whether the hardware accepted the command.
  - The raw console `T 1` goes through `canTransmit()`.
  - A realistic benchmark mode was added to the browser engine.
  - The "Gain vs FT8" tile was removed.
  - One callsign validator, with shared vectors.
  - The gate also runs at arm time.
- **Tests added:** `tests/transmitPath.test.mjs` (23 checks), `tests/test_config_wizard.py`, `tests/vectors/callsign_vectors.json`, new checks in `frontend.test.mjs`.
- **Audit findings:** the UI/frontend audit's 21 findings (report not in the repository).
- **In production:** No. "A release drives what the key drove" and "one keying implementation" are `AGENTS.md` §4 invariants implemented in `PttController`.
- **Later modified or invalidated by:**
  - #10 found `setPtt`'s CAT branch still reporting success on no write.
  - #8 and #29 later showed the browser engine's pilot handling and its "1.8 dB optimistic" note were wrong.
  - #34 retired the code.
- **Current status:** Retired. Its invariants are live.

### #6 — docs(wiki): correct the LDPC decoder schedule count, backed by a benchmark
- **Merge:** `f341c6a`, 2026-08-31. Commit `100b50a`.
- **Purpose:** The wiki said the Python decoder ran one min-sum schedule. Both decoders ran the same four-schedule cascade.
- **Important files:** `wiki/04`, `wiki/16`, `AGENTS.md`.
- **Decisions:**
  - A paired benchmark supported the correction: 240 frames, 23/23 discordant pairs to the cascade, exact McNemar p ≈ 4e-7.
  - Added the rule that only a benchmark or test may overturn a documented claim, at ≥95% confidence to challenge and ≥99% to settle, and that no benchmark may be altered to manufacture a result.
- **Tests added:** None. It was a one-off paired measurement.
- **Audit findings:** None named.
- **In production:** The `AGENTS.md` §5 rule is in force. The four-schedule cascade is the vNext decoder (`crates/z30-dsp/src/ldpc.rs`, bit-exact with the oracle per #33).
- **Later modified or invalidated by:** #14 D1 removed the leftover single-alpha formula from wiki/11. #8 `34a0f80` removed the "alpha = 0.75" UI text.
- **Current status:** In force as a rule.

### #7 — docs: sync README with logbook exports and the LDPC decoder correction
- **Merge:** `cf06ee7`, 2026-08-31. Commit `e846766`.
- **Purpose:** Brought the README in line with the logbook exporters and #6.
- **Important files:** `README.md`.
- **Decisions:** None beyond keeping the documents in sync.
- **Tests added:** None.
- **Audit findings:** None.
- **In production:** No. The README has been rewritten.
- **Later modified or invalidated by:** #34 rewrote the README.
- **Current status:** Superseded.

### #8 — Fix the audit findings, unify the benchmark engines, and rebuild the updater
- **Merge:** `4d4fc44`, 2026-08-31. Commits `21feaf7`, `0a835bf`, `ee919ce`, `d41aefd`, `34a0f80`.
- **Purpose:** The Python and browser benchmarks disagreed by 1.8 dB. The PR found the cause and re-measured the threshold. It also rebuilt the updater and fixed config paths.
- **Important files:** `z30_dsp/benchmark.py`, `src/dsp/monteCarloEngine.ts`, `z30_dsp/git_sync.py`, `z30_dsp/updater.py`, `src/components/UpdateModal.tsx`, `z30_dsp/station_settings.py`, `z30_dsp/band_manager.py`, `src/dsp/z30Constants.ts`.
- **Decisions:**
  - The gap came from the demodulator's semi-coherent pilot term, not the timing search width. Paired: 55:4 discordant, p = 1.7e-12.
  - Pinned `SLOT_SEARCH_MARGIN_SEC` and `REALISTIC_PILOT_COHERENCE` across both languages.
  - Re-measured: −23.1 dB blind AWGN at 40 frames per point.
  - Removed `FT8_COMPARISON_GAIN_DB = 4.0`.
  - The updater became a fast-forward-only git sync, refused while PTT is keyed.
  - All `config.json` writers go through `paths.py`.
- **Tests added:** `tests/test_git_sync.py`; cross-language dither and schedule pinning in `test_cross_language_parity.py` and `tests/vectors/dither_vectors.json`; `test_time_sync_guards.py` and `test_web_server_api.py` extended.
- **Audit findings:** "audit findings 2, 4, 5" (report not in the repository).
- **In production:** No.
- **Later modified or invalidated by:**
  - #29 `e5d795f` found the on-air decoder still used the pilot term and renamed the constant `RECEIVER_PILOT_COHERENCE`.
  - #29 also republished figures at 200 frames.
  - #34 deleted the updater, git sync and web server.
- **Current status:** Retired. The rule that receiver constants live beside the receiver is live (`AGENTS.md` §4).

### #9 — fix(sync): stop a missing PortAudio from crashing on Android, and correct the Android guide
- **Merge:** `305be54`, 2026-08-31. Commit `a43f7a3`.
- **Purpose:** An `OSError` from PortAudio crashed the RF-sync fallback on Termux. The Android guide overstated OTG audio support.
- **Important files:** `z30_dsp/rf_time_sync.py`, `install_android_termux.sh`, `wiki/09`, `README.md`.
- **Decisions:**
  - Catch the error broadly when probing for audio.
  - Try PortAudio package names one at a time.
  - Document that Termux has no audio and that the PWA needs a secure context.
- **Tests added:** Regression cases in `tests/test_time_sync_guards.py`.
- **Audit findings:** None named.
- **In production:** No. RF sync and the installers are gone. vNext documents no Android build.
- **Later modified or invalidated by:** #34 deleted `rf_time_sync.py` (C-03) and the installers.
- **Current status:** Retired.

### #10 — fix(cat): real-world CAT and PTT keying — 16 audit findings fixed
- **Merge:** `f04390d`, 2026-08-31. Commits `564c4b0` (audit report), `e5cbd76` (fixes).
- **Purpose:** An operator reported that the app connected and then never keyed. The PR fixed all 16 findings of the PTT/CAT audit.
- **Important files:** `PTT-CAT-AUDIT.md` (deleted in #11), `src/dsp/catController.ts`, `src/dsp/ratProtocols.ts`, `src/App.tsx`, `z30_dsp/web_server.py`, `z30_dsp/config_wizard.py`.
- **Decisions:**
  - Rig commands report whether anything was written.
  - The rigctld relay parses `RPRT`.
  - Yaesu has its own protocol family, on a model allowlist.
  - CM108 applies polarity.
  - The GPIO dead-man switch works in transmitter state, not pin level.
  - Opening a serial port leaves PTT released.
  - Separate keying port.
  - The ungated `set_ptt()` was removed.
- **Tests added:** `transmitPath.test.mjs` (47 → 92 checks); seven cases in `test_web_server_api.py`.
- **Audit findings:** PTT/CAT audit findings 1–16 (report removed in #11; recoverable from `564c4b0`).
- **In production:** No. vNext does CAT only through `rigctld`, and direct Yaesu/Kenwood/CI-V CAT was not ported (`docs/hardware.md`). The principle that a refused command is a failure lives in `crates/z30-io/src/rigctld.rs`.
- **Later modified or invalidated by:** #11 retired the report. #34 retired the code.
- **Current status:** Retired. The principle is live.

### #11 — docs: retire the PTT/CAT audit, and record its two open gaps in the wiki
- **Merge:** `9662432`, 2026-09-01. Commit `ab94b45`.
- **Purpose:** Verified all 16 findings from #10 as fixed and deleted `PTT-CAT-AUDIT.md`. Recorded its open gaps in the wiki. Rebuilt the stale `web_dist`.
- **Important files:** `wiki/06`, `wiki/13`, `z30_dsp/web_dist/`.
- **Decisions:**
  - A direct-serial CAT test confirms the write, not the radio's answer.
  - Wiring tests deliberately skip `canTransmit`.
- **Tests added:** None.
- **Audit findings:** #10's audit.
- **In production:** No.
- **Later modified or invalidated by:** #32 found the committed `web_dist` stale again, 49 commits behind and still defaulting to W1AW (C6). #34 deleted it.
- **Current status:** Retired.

### #12 — feat(cat): port WSJT-X's closed-loop rig state model, so the gate checks the radio
- **Merge:** `17926fd`, 2026-09-01. Commit `7de849c`.
- **Purpose:** The gate trusted the commanded dial. This PR added a polled readback, so a settled contradiction from the radio becomes a refusal.
- **Important files:** `src/dsp/rigStateTracker.ts`, `src/dsp/catController.ts`, `wiki/06`, `wiki/13`, `AGENTS.md`.
- **Decisions:**
  - Refuse only on a settled contradiction.
  - No readback is "unverified".
  - Allow three polls of QSY grace.
  - Use the measured tuning resolution.
  - A 100 ms Tx/Rx settle window.
  - Losing CAT does not unkey the transmitter.
- **Tests added:** `tests/rigReadback.test.mjs` (46 checks).
- **Audit findings:** None named. It came from a WSJT-X comparison.
- **In production:** Concept yes. `RigStateTracker` was ported to `crates/z30-engine/src/rig.rs` in #33 (`f76ca76`). The TS code is legacy.
- **Later modified or invalidated by:**
  - #14 A1/A2 fixed a probe-restore race.
  - #39 added a refusal on a fresh non-USB mode reading (L-07).
- **Current status:** Live in vNext as "Readback only adds refusals" (`AGENTS.md` §4).

### #13 — build(deps): bump requests from 2.32.4 to 2.33.0 (dependabot)
- **Merge:** `d8edded`, 2026-09-01. Commit `8140f71`.
- **Purpose:** Dependency bump in `requirements.txt`, the same fix #14 made for PYSEC-2026-2275.
- **Important files:** `requirements.txt`.
- **Decisions:** None.
- **Tests added:** None.
- **Audit findings:** PYSEC-2026-2275, as cited in #14.
- **In production:** No. `requests` was dropped with the Python app (M10); the oracle needs only NumPy and SciPy.
- **Later modified or invalidated by:** #18, then #34.
- **Current status:** Obsolete.

### #14 — fix: close the 27 findings of the z-30 systems audit
- **Merge:** `87ee46a`, 2026-09-01. Commits `6a16b8e`, `766f624`, `bfeea7e`.
- **Purpose:** Closed the cross-subsystem audit: transmit safety (A), DSP determinism and parity (B), server/config/logging (C), and docs/CI (D). Added CI jobs and fixed what they found.
- **Important files:** `src/dsp/catController.ts`, `src/dsp/realReceiver.ts`, `z30_dsp/sic_decoder.py`, `z30_dsp/rf_time_sync.py`, `z30_dsp/web_server.py`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `pyproject.toml`.
- **Decisions:**
  - A1/A2: the rig-resolution probe's restore is guarded by a dial epoch.
  - A3: rigctld traffic is serialised, but PTT bypasses the lock.
  - B1: unseeded AWGN in the SIC self-test was seeded from its input.
  - B2: one SIC candidate detector.
  - C2: cumulative OS-clock movement bounded per 24 h.
  - C3: `?token=` query-string auth removed.
  - C6: atomic config save.
  - D2: SIC collision figures (the 98.7…% table, −27.5 / −31.5 dB) retracted as "not measured".
  - Windows `SO_EXCLUSIVEADDRUSE`.
  - Ruff, pip-audit, npm audit, Dependabot and a packaging smoke job added.
- **Tests added:** `tests/rigProbeAndWatchdog.test.mjs`, `tests/dspDeterminism.test.mjs`, `tests/test_band_manager.py`, `tests/test_legacy_logger_and_config.py`, `tests/test_sic_candidate_detection.py`, `tests/test_updater_cli.py`, parity-test extensions.
- **Audit findings:** systems audit A1–A8, B1–B6, C1–C6, D1–D7. These are not the vNext IDs; the report is not in the repository.
- **In production:** No. Surviving invariants: PTT on its own rigctld connection, no unseeded RNG on the receive path, the collision table stays withdrawn.
- **Later modified or invalidated by:** #34 deleted the server, clock-setting and SIC code. `.github/dependabot.yml` was reworked for cargo, the oracle and actions.
- **Current status:** Retired. Its rules are live in `AGENTS.md` §4 and §5.

### #15 — chore(ci): bump actions/checkout from 4 to 7
- **Merge:** `ec277b2`, 2026-09-01. Dependabot.
- **Purpose, files, decisions:** `.github/workflows/ci.yml` action version only.
- **Tests / findings:** None.
- **In production:** CI only. `actions/checkout@v7` is used across the current workflows.
- **Later modified:** No.
- **Current status:** In use.

### #16 — chore(ci): bump actions/setup-node from 4 to 7
- **Merge:** `c43e15c`, 2026-09-01. Dependabot. Same as #15 for `setup-node`.
- **In production:** CI only. `@v7` in `ci.yml` for the legacy reference tests.
- **Later modified:** No.
- **Current status:** In use.

### #17 — chore(ci): bump actions/setup-python from 5 to 7
- **Merge:** `dbb7bf5`, 2026-09-01. Dependabot. Same as #15 for `setup-python`.
- **In production:** CI only. `@v7` in use.
- **Later modified:** No.
- **Current status:** In use.

### #18 — chore(deps): bump the python-runtime group with 3 updates
- **Merge:** `708e983`, 2026-09-01. Dependabot.
- **Purpose:** Bumped sounddevice 0.5.6, cffi 2.1.1 and requests 2.34.2 in `requirements.txt`.
- **Tests / findings:** None.
- **In production:** No. The Python application was deleted in #34, and the oracle's requirements are trimmed to NumPy and SciPy.
- **Current status:** Obsolete.

### #19 — chore(deps): bump the frontend group with 6 updates
- **Merge:** `27dc83d`, 2026-09-01. Dependabot.
- **Purpose:** Bumped vite 8, typescript 7, @vitejs/plugin-react 6, lucide-react 1, @types/node 26 and esbuild 0.28 in `package.json` and `package-lock.json`.
- **Tests / findings:** None.
- **In production:** No. The browser runtime is retired, and Dependabot deliberately no longer tracks it (`.github/dependabot.yml` comment).
- **Current status:** Frozen in `legacy/browser-runtime`.

### #20 — fix(config): ship NOCAL as the placeholder callsign, not a real station
- **Merge:** `394319b`, 2026-09-01. Commit `c9ff06c`.
- **Purpose:** The shipped default callsign and operator identity were W1AW, a real station.
- **Important files:** `src/dsp/z30Constants.ts` (`PLACEHOLDER_CALLSIGN`), `z30_dsp/station_settings.py`, `src/dsp/catController.ts`, `src/dsp/qsoLogger.ts`, `src/dsp/z30Codec.ts`.
- **Decisions:**
  - NOCAL contains no digit, so it also fails `isValidCallsign()`.
  - The gate checks for the placeholder before checking syntax.
  - N0CALL is kept as an "unconfigured" marker.
- **Tests added:** Placeholder checks in `transmitPath.test.mjs` and `test_config_wizard.py`; `callsign_vectors.json` entry.
- **Audit findings:** None named.
- **In production:** No.
- **Later modified or invalidated by:**
  - #32 C6: the committed `web_dist` bundle never received this fix and still shipped W1AW.
  - #34 went further: vNext has **no** default callsign, and CI scans binaries for W1AW (C-04).
- **Current status:** Superseded by "no default callsign" (`AGENTS.md` §4). **Open:** TX-13 = DOC-02, where `--migrate` can import the old W1AW default.

### #21 — fix(dsp): replace invented SIC diagnostics with real measurements
- **Merge:** `57c0e0e`, 2026-09-01. Commit `e89b99b`.
- **Purpose:** `residualPowerDb` came from a hardcoded progression, `-14.2 - (pass-1)*14.3`. The Specs modal also still quoted the withdrawn "−31.5 dB".
- **Important files:** `src/dsp/realReceiver.ts`, `src/dsp/sicDecoder.ts`, `src/components/SpecsModal.tsx`, `z30_dsp/web_server.py`.
- **Decisions:**
  - Measure the noise floor from the residual buffer, and return null when there is no buffer.
  - Remove the `?token=` docstring.
  - `GpioBridge.release_all()` reports a failed release as a failure.
- **Tests added:** `tests/dspDeterminism.test.mjs`, measurement guards that no constant can satisfy.
- **Audit findings:** None named. Internal AGENTS.md audit.
- **In production:** No.
- **Later modified or invalidated by:**
  - #32 C3 found the legacy SIC itself anti-cancelling.
  - #33 replaced it with least-squares SIC.
  - #34 retired it (H-01).
- **Current status:** Retired. The rejection of invented diagnostics is live.

### #22 — Codebase cleanup: dedup shared logic, remove dead code, fix bugs found along the way
- **Merge:** `9e0431f`, 2026-09-01. Commit `b76b166`.
- **Purpose:** Removed dead code and duplication across `z30_dsp/` and `src/`, and fixed bugs found along the way.
- **Important files:** `CLEANUP-DEDUP-AUDIT.md` (moved to `audit/2026-09-01-cleanup/README.md` by #34), `z30_dsp/modem.py`, `z30_dsp/rf_time_sync.py`, `z30_dsp/auto_logger.py`.
- **Decisions:**
  - `CatTuner.tune()` honours `RPRT`.
  - Hardcoded fake SNR removed from the DCF77 and LF decoders.
  - Grid precision fixed.
  - The TS CRC-14 dedup was **reverted** because it broke a pinned parity test ("the change is wrong, not the test").
- **Tests added:** None. The suite stayed green.
- **Audit findings:** Cleanup audit #1–#23 (`audit/2026-09-01-cleanup/README.md`).
- **In production:** No.
- **Later modified or invalidated by:** #34 retired the code. The audit file is kept as a record.
- **Current status:** Retired. The record is at `audit/2026-09-01-cleanup/README.md`.

### #23 — docs(readme): improve SEO and readability for new users
- **Merge:** `6d602fe`, 2026-09-02. Commit `0232226`.
- **Purpose:** Restructured the README for readability without changing any figure.
- **Important files:** `README.md`.
- **Tests / findings:** None.
- **In production:** No. The README was rewritten in #34.
- **Current status:** Superseded.

### #24 — docs(readme): fix quickstart command from z-30 to z30
- **Merge:** `be62ee2`, 2026-09-02. Commit `395e69a`.
- **Purpose:** The installed command was `z30`, not `z-30`.
- **Important files:** `README.md`.
- **Tests / findings:** None.
- **In production:** No. The command is still `z30`, now the Rust CLI.
- **Current status:** Superseded.

### #25 — fix(audio): refuse right-channel PTT tone on mono-only output devices
- **Merge:** `b1cb88b`, 2026-09-02. Commit `79ca657`.
- **Purpose:** On a mono device the downmix let the continuous keying tone swamp the data, so the radio transmitted a fixed tone.
- **Important files:** `src/dsp/audioEngine.ts` (`supportsStereoOutput()`).
- **Decisions:** Fail closed when `maxChannelCount < 2`, and request stereo explicitly.
- **Tests added:** `tests/audioChannelSafety.test.mjs`.
- **Audit findings:** None named.
- **In production:** No. The `AUDIO_TONE_RIGHT` PTT method is not implemented in vNext (`docs/hardware.md:56`).
- **Later modified or invalidated by:** #32 C6: the stale bundle lacked this guard. #34 retired it.
- **Current status:** Retired. The method is not ported.

### #26 — feat(dsp): parallelise the benchmark sweep without moving the curve
- **Merge:** `209e88d`, 2026-09-02. Commit `d4b6fdd`.
- **Purpose:** Added `benchmark.py --workers N`.
- **Important files:** `z30_dsp/benchmark.py`, `wiki/16`, `.github/workflows/ci.yml`.
- **Decisions:**
  - The random draws stay serial on the main process (`_prepare_frame`); decoding is a pure function (`decode_prepared_frame`).
  - Results are reduced in index order.
  - A per-frame seed scheme was rejected because it would move the published curve.
- **Tests added:** `tests/test_benchmark_parallel.py` (now in `legacy/python-oracle/tests/`).
- **Audit findings:** None.
- **In production:** No. This is the oracle benchmark.
- **Later modified or invalidated by:** #34's `z30 --benchmark suite` seeds every frame from (suite seed, benchmark, point, frame), the scheme #26 declined for the oracle (`AGENTS.md` §4 "Determinism").
- **Current status:** Frozen in the oracle.

### #27 — perf(dsp): halve the cost of a failing LDPC decode, bit-identically
- **Merge:** `d7e5fcd`, 2026-09-02. Commit `b34fe53`.
- **Purpose:** Vectorised the sum-product schedule's leave-one-out fold. A failing cascade went from 1.64 s to 0.92 s, bit-identically.
- **Important files:** `z30_dsp/ldpc.py`.
- **Decisions:** Three extensions were rejected on measurement:
  - vectorising the min-sum edge loop, which was slower;
  - a single-snapshot sweep, which is the flooding schedule and a different decoder;
  - a forward/backward fold, which box-plus associativity does not survive.

  These are recorded in `legacy/python-oracle/z30_dsp/ldpc.py:575`.
- **Tests added:** `tests/test_ldpc_vectorized_equivalence.py`.
- **Audit findings:** None.
- **In production:** No. This is the oracle decoder. vNext's Rust cascade is bit-exact with it (#33).
- **Later modified or invalidated by:** #32's PoC showed Rust at 7 ms against Python at 522 ms per failing decode (H10), which motivated the rebuild.
- **Current status:** Frozen in the oracle.

### #28 — feat(dsp): a priori (AP) decoding, ported from WSJT-X
- **Merge:** `d8e3cde`, 2026-09-02. Commits `d3081f9`, `78208aa`, `5e19597`.
- **Purpose:** When the ordinary decode fails, retry with QSO-implied bits asserted, and let the CRC arbitrate.
- **Important files:** `z30_dsp/ap_decode.py`, `src/dsp/apDecode.ts`, `z30_dsp/message_codec.py`, `z30_dsp/ldpc.py`, `wiki/17`.
- **Decisions:**
  - AP never runs first.
  - Asserted bits are pinned, not biased.
  - `apmag` scales with the frame.
  - Deep hypotheses are frequency-gated.
  - Off by default.
  - Decodes labelled `a1`…`a6`.
  - Measured by paired sweeps, with explicit notes that this is not a new threshold and not a false-accept measurement.
  - Fixed a live packer bug: every "73" was sent as a +30 dB report.
- **Tests added:** `tests/test_ap_decode.py`, `tests/apDecode.test.mjs`, `tests/vectors/callsign_pack_vectors.json`, parity additions.
- **Audit findings:** None named.
- **In production:** Concept yes: `crates/z30-dsp/src/ap.rs` (#33), golden-pinned (`fixtures/golden/ap.json`, `golden_ldpc.rs`). The Python and TS code is legacy.
- **Later modified or invalidated by:**
  - #33 ported it.
  - DSP-03 (#45): the production AP path has no test and no false-decode measurement, and wiki/17's measurements are the oracle's and predate the H-10 and N-01 channel fixes.
- **Current status:** Live and off by default. **Open:** DSP-03.

### #29 — Make the benchmark measure the decoder that ships, and publish the set to the standard everyone else uses
- **Merge:** `d2e922c`, 2026-09-03. Commits `e5d795f`, `105813e`, `2121e84`, `e443c8a`, `72362e5`, `143ba29`, `d033ad1`.
- **Purpose:** The on-air decoders still used the pilot-adaptive weight while both benchmarks used 0. The PR aligned the receiver and republished every figure at 200 frames with intervals.
- **Important files:** `z30_dsp/benchmark.py` (`--compare-demod`), `z30_dsp/sic_decoder.py`, `src/dsp/realReceiver.ts`, `src/dsp/z30Constants.ts`, `wiki/16`, `wiki/11`, `README.md`, `AGENTS.md`.
- **Decisions:**
  - `RECEIVER_PILOT_COHERENCE` lives beside the demodulator.
  - Paired result: AWGN 194:21 discordant, p = 2.9e-36; the shipped receiver had been 1.77 dB worse.
  - Wilson intervals, `PUBLISHABLE_FRAMES_PER_POINT = 200`, and false decodes counted separately.
  - ITU-R F.1487 preset names adopted, and the high-latitude moderate channel added (no decode at any SNR).
  - FT8 delta computed from constants.
  - Stated that the benchmark's acquisition front end is not the station's (three front ends).
- **Tests added:** `test_the_benchmark_demodulates_like_the_receiver_that_ships` (`test_cross_language_parity.py:404`); Doppler-spread tests in `test_channel_acquisition.py` (`test_each_preset_imposes_the_doppler_spread_it_names`, `test_high_latitude_moderate_spreads_a_tone_across_the_tone_spacing`).
- **Audit findings:** None named. It was a self-found defect.
- **In production:** The rules are live: 200 frames, Wilson intervals, receiver constants beside the receiver, and the high-latitude moderate figure quoted alongside. The code is legacy.
- **Later modified or invalidated by:**
  - #32 H6/C2: the benchmarks still did not exercise the shipped front end, which reached only about −14.9 dB, and the −22.92 dB figure described the reference receiver (C-02).
  - #34 replaced all figures with `decode_slot` results.
- **Current status:** Figures superseded. Method live (`AGENTS.md` §5).

### #30 — fix(dsp): the browser benchmark measured a model, not the shipped receiver
- **Merge:** `ae26d00`, 2026-09-03. Commit `e0c78ef`.
- **Purpose:** The browser engine's default `MATCHED_FILTER_CORRELATOR_BANK` path never synthesised a waveform. The PR also removed several related fabrications.
- **Important files:** `src/dsp/monteCarloEngine.ts`, `src/components/MonteCarloBenchmarkModal.tsx`, `z30_dsp/benchmark.py`, `z30_dsp/ldpc.py`.
- **Decisions:**
  - Removed the analytic path. It decoded 334/600 against the physical chain's 148/600 (Fisher p = 3.7e-28) and was the source of the "−25.28 dB" browser bound.
  - Removed fake "Rayleigh" gains, an AWGN-labelled `CO_CHANNEL_QRM`, a fake Shannon curve, the iteration-cap knob, and filled-in BER for unacquired frames.
  - Fixed PEP 604 annotations that broke Python 3.9 imports.
  - Unified the crossing rule.
  - Pinned `WILSON_Z_95`.
- **Tests added:** `test_cross_language_parity.py` additions, including the banned-names check at line 496; `frontend.test.mjs` additions.
- **Audit findings:** None named. Verification pass.
- **In production:** No.
- **Later modified or invalidated by:** #34 retired the browser engine. `AGENTS.md` §4 forbids a benchmark-only decoder.
- **Current status:** Retired. The rejection is live.

### #31 — fix(logbook): stop defaulting to FT8's dial frequency instead of z-30's own
- **Merge:** `7661caa`, 2026-09-03. Commit `0c6fdf9`.
- **Purpose:** Manual logs and several fallbacks used FT8's 14.074 MHz dial. The PR changed them to z-30's 14.076 MHz and derived bands from `HAM_BANDS`. It also factored out `apTag()`.
- **Important files:** `src/components/LogbookModal.tsx`, `src/dsp/qsoLogger.ts`, `z30_dsp/station_settings.py`, `src/dsp/apDecode.ts`.
- **Decisions:** A single band table.
- **Tests added:** None. The existing suite passed.
- **Audit findings:** None named.
- **In production:** No.
- **Later modified or invalidated by:** #39 (N-05) removed *any* default dial. The 14.076 MHz default had been logged as "commanded". The legacy importer's 14.076 MHz is dropped on migration.
- **Current status:** Superseded by "no default dial" (`AGENTS.md` §4).

### #32 — docs(audit): vNext technical audit, measurements and rebuild plan
- **Merge:** `c83bef0`, 2026-09-23. Commit `57ca3dd`.
- **Purpose:** A full audit of the browser/Python product with seeded probes and a language proof of concept. It recommended rebuilding around one Rust core. No code changed.
- **Important files:** `audit/2026-09-23-vnext/README.md`, `probes/`, `poc/`, `results/`.
- **Decisions:**
  - Rebuild in Rust.
  - Keep the protocol, the Python code as a frozen oracle, the benchmark method and the safety rules.
  - PoC: the Rust LDPC was bit-exact on 280/280 frames, 7.0 ms against 522 ms in Python.
- **Tests added:** None. Probes and results are under `audit/2026-09-23-vnext/`.
- **Audit findings raised:**
  - Critical: C1 timer decode; C2 front end at about −14.9 dB; C3 anti-cancelling SIC; C4 main-thread decode; C5 unrepresentable callsigns; C6 stale `web_dist` with W1AW.
  - High: H1–H10.
  - Medium: M1–M13.
  - Low: L1–L6.
- **In production:** Audit record.
- **Later modified or invalidated by:** Acted on by #33 and #34 (see `audit/2026-09-24-vnext-remediation/`).
- **Current status:** Closed as a record.

### #33 — z-30 vNext: Rust protocol, receiver, engine and tooling (rebuild per the 2026-09-23 audit)
- **Merge:** `224b2fc`, 2026-09-24. Commits `8be9e00`, `f180122`, `f76ca76`, `44f3157`, `2f6519c`, `83b1b70`, `1236588`, `1c48066`, `73ce0f9`, `0ab6cf0`, `6a46a95`.
- **Purpose:** Built the Rust workspace:
  - `z30-protocol`, `z30-dsp` (`decode_slot`), `z30-channel` and `z30-py`;
  - `z30-engine`: sample clock, scheduler, TxGate, `RigStateTracker`, `PttController` and watchdog;
  - `z30-io`: cpal, rigctld, RTS/DTR, CM108, SQLite and ADIF, migration;
  - the `z30` CLI and the `z30-gui` egui app.

  It also added `SPEC.md`, golden vectors, the `docs/` set and `rust.yml`.
- **Important files:** `crates/*`, `SPEC.md`, `fixtures/golden/*`, `reference/golden/*`, `research/paired_receiver.py`, `docs/*`, `VNEXT_IMPLEMENTATION_PLAN.md`, `.github/workflows/rust.yml`.
- **Decisions:**
  - A strict v1 codec that refuses what it cannot carry (C5, H2, H3, M6).
  - Corrected OSD (M1).
  - A slot is decoded only once its whole [slot − 1.5 s, slot + 25.5 s] window exists, in sample time (C1, H5).
  - The TxGate adds representability, message-from-station and −40 dB emission-edge checks.
  - A halt between plan and key abandons the transmission.
  - PTT released on SIGINT, SIGTERM, SIGHUP and console close.
  - Per-tone interference whitening; paired A/B gave 0/1000 discordant.
  - Least-squares SIC.
  - Legacy TS gate also refuses non-round-tripping callsigns (`8be9e00`).
  - Measured paired against the oracle: −23.01 dB against −22.92 dB, McNemar p = 0.024. Non-inferior, not superior at 99%.
- **Tests added:**
  - `z30-protocol`: `tests/golden.rs`, `properties.rs`.
  - `z30-dsp`: `tests/golden_ldpc.rs`, `golden_demod.rs`, `channel_scenarios.rs`.
  - `z30-engine`: `tests/safety.rs` (includes `h2_a_halt_between_plan_and_key_abandons_the_transmission`), `emergency.rs`, `virtual_clock.rs`.
  - `z30-io`: `tests/callback_alloc.rs`.
- **Audit findings:** Named in the commit messages: vNext C1, C5, H2, H3, H5, H9, M1, M6, and C6 through the CI check that binaries name a clean HEAD. Not named but replaced by the rebuild (confirmed as fixed only in #34's `FIXES.md` as H-01 / H-05): C3 SIC and C4 main-thread decode.
- **In production:** **Yes.** This is the application.
- **Later modified or invalidated by:**
  - #34: SNR estimator (M-07), DT bias, fading normalisation (H-10), whole-frame round trip (C-06), MSRV (H-08), legacy retirement.
  - #39: `VerifiedFrame` (N-03), loopback (N-04), dial (N-05), Doppler (N-01).
  - Its own research results (`awgn_paired_200`, `whitening_ab_200`) remain as "earlier instruments" (`docs/benchmarking.md`).
- **Current status:** Production, as amended by #34 and #39.

### #34 — vNext as the only runtime: 2026-09-24 audit remediation
- **Merge:** `84033d4`, 2026-09-24. Commits `d8983ee`, `17c3e8e`, `5ab1421`, `dedd4e0`, `f98a24a`, `8f16d43`, `a9a64fa`.
- **Purpose:** Remediated the external 2026-09-24 audit (35 findings). Retired the browser/Python runtime to `legacy/`. Published the benchmark suite results.
- **Important files:**
  - `crates/z30-dsp/src/demod.rs` (SNR/DT), `crates/z30-channel/src/lib.rs`, `crates/z30-protocol/src/codec.rs`, `crates/z30-engine/src/{qso,txgate,config}.rs`, `crates/z30-io/src/{migrate,wallclock}.rs`;
  - `crates/z30-cli/src/{suite,loopback}.rs`;
  - `legacy/`, `research/results/d8983eeef66e/`, `research/summarize_suite.py`, `audit/2026-09-24-vnext-remediation/`, `.github/workflows/{ci,rust,release}.yml`.
- **Decisions:**
  - M-07: SNR measured against the residual of a least-squares replica fit; `None` when there is no signal.
  - H-10: Watterson ensemble normalisation.
  - C-06: whole-frame round trip at the gate.
  - C-05: `QsoRecord::validate`.
  - H-08: MSRV 1.95.
  - `z30 --benchmark suite`.
  - The Python app, `web_dist` (C-04), installers and launcher deleted. The oracle frozen by hash, with no entry points.
  - Legacy fabrications neutralised in the retained source: C-03, C-05, C-06, M-01…M-04, M-12, H-03.
- **Tests added:**
  - `z30-dsp`: `tests/snr_accuracy.rs`, `sic_regression.rs`, `sensitivity_regression.rs` (M-10, ≥84/100 at −22 dB).
  - `z30-engine`: `tests/live_runtime.rs` (C-01), `qso_logging.rs`.
  - `z30-io`: `tests/logbook_integrity.rs`.
  - `z30-protocol`: `tests/round_trip.rs`.
  - Oracle: `legacy/python-oracle/tests/test_oracle_is_frozen.py`.
  - Legacy: `legacy/browser-runtime/tests/{rfTimeSyncRetired,legacyLabels}.test.mjs`.
  - Config: `config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`.
- **Audit findings:** C-01…C-06, H-01…H-10, M-01…M-12, L-01…L-07 (`FIXES.md`). Still NOT FIXED at the time: H-02 (no hardware validation), M-08 (PTT after SIGKILL or power loss) and L-05 (natural-binary mapping loss unmeasured). PARTIALLY FIXED: H-06, H-07, L-07.
- **In production:** **Yes.**
- **Later modified or invalidated by:**
  - #38 found `d8983eeef66e/fading.json` used a 1/√2 Doppler (N-01).
  - #39 withdrew those fading figures (−20.79 / −21.31 / −21.07 dB), fixed the loopback (N-04), stopped the TX re-encoding (N-03) and fixed the dial default (N-05).
  - The AWGN figures are unchanged at `672cef9b3cdb`.
- **Current status:** Production.

### #35 — chore(ci): bump actions/upload-artifact from 5 to 7
- **Merge:** `0a4d8a9`, 2026-09-24. Dependabot. `release.yml`.
- **Tests / findings:** None.
- **In production:** CI only. `@v7` in use.
- **Current status:** In use.

### #36 — chore(ci): bump actions/download-artifact from 5 to 8
- **Merge:** `76ebc46`, 2026-09-24. Dependabot. `release.yml`.
- **Tests / findings:** None.
- **In production:** CI only. `@v8` in use.
- **Current status:** In use.

### #37 — chore(deps): bump the rust group with 5 updates — NOT MERGED
- **State:** Closed without merging on 2026-09-26 (GitHub). No merge commit exists locally.
- **Purpose:** A Dependabot grouped cargo bump: rand 0.9, rand_chacha 0.9, rand_distr 0.6, toml 1.1, pyo3 0.29.
- **Decision (owner's closing comment):** Closed to be split.
  - It does not compile: `rand_distr` 0.6 needs `rand` 0.10 while the manifest pins 0.9.
  - `research/lock_closure.py` exits 1, because the RNG crates behind every seeded channel realisation change.
  - It bundled a §7-eligible bump with a §2-class one.
  - The plan is to split into toml, pyo3, and an RNG change that needs its own proposal, paired experiment and board decision.
- **Tests / findings:** None.
- **In production:** No.
- **Later:** #43 used it as the failing example for `lock_closure.py`. `.github/dependabot.yml` still groups all cargo crates.
- **Current status:** Rejected in this form. No replacement PR had been merged by `78db463`.

### #38 — docs(audit): independent post-remediation verification audit
- **Merge:** `4d2140e`, 2026-09-26. Commit `130796f`.
- **Purpose:** Independently verified #34 at `84033d4`, with its own harness, mutation tests, an oracle channel measurement, and MSRV 1.95 logs. No production code changed.
- **Important files:** `audit/2026-09-24-post-remediation/FINAL_AUDIT.md`, `evidence/` (harness, `scripts/mutate.py`, `py_watterson.py`, results, logs).
- **Decisions:** Findings only.
- **Tests added:** None in the tree. The evidence harness and mutation script are kept under `evidence/`.
- **Audit findings raised:**
  - N-01 Doppler at 1/√2 of its label.
  - N-02 clippy failing on 1.95.
  - N-03 round trip untested; `plan_tx` re-encodes. Mutations C06-a/b/c survived.
  - N-04 loopback bypasses the gate.
  - N-05 default dial logged as "commanded".
  - N-06 to N-15, lower severity.
  - Re-rated M-08 and L-07.
- **In production:** Audit record.
- **Later modified or invalidated by:** #39 addressed N-01…N-09, N-13 and N-14 (see #39).
- **Current status:** Closed as a record.

### #39 — Corrective remediation of the post-remediation audit findings (TX frame, loopback, Watterson, dial provenance, MSRV)
- **Merge:** `01a3bd4`, 2026-09-26. Commits `46e73cf`, `b75f773`, `a37c4f2`, `672cef9`, `18fbd78`, `6f4ceed`, `54afcbf`, `50a7757`.
- **Purpose:** Fixed #38's findings, regenerated the suite results, and measured the spread of the AWGN figure.
- **Important files:** `crates/z30-protocol/src/codec.rs` (`VerifiedFrame`), `crates/z30-engine/src/{txgate,engine,qso,runtime}.rs`, `crates/z30-channel/src/lib.rs`, `legacy/python-oracle/z30_dsp/channel.py` (and `FROZEN.sha256`), `crates/z30-cli/src/{loopback,audio_loopback,suite}.rs`, `crates/z30-io/src/{logbook,migrate,wallclock}.rs`, `research/results/672cef9b3cdb/`, `research/results/18fbd78d8fb8/`, `audit/2026-09-24-corrective-remediation/`.
- **Decisions:**
  - N-03: only `EncodedMessage::verify` can construct a `VerifiedFrame`, and `plan_tx` sends the gate's object.
  - New refusals: a fresh non-USB mode reading (L-07) and a zero transmit level (N-09).
  - N-01: amplitude response exp(−f²/(4σ_D²)), σ_D = doppler/2.
  - N-04: `--loopback-test` runs in memory; `--audio-loopback-test` refuses any PTT or rig configuration.
  - N-05: no default dial. Provenance is `reported_by_rig`, `commanded`, `configured` or absent. Logbook schema v2 migrates `commanded` to `configured`.
  - `--replicate` replaced small-seed replicates.
  - N-02: clippy on the MSRV in CI.
  - N-13: 1970 is reported as such. N-14: GUI `--version`.
  - Published: fading −20.94 / −21.37 / −20.88 dB; AWGN sd 0.048 dB over 11 runs; pooled −23.00 dB [−23.04, −22.96].
- **Tests added:**
  - `z30-protocol`: `tests/frame_integrity.rs` (plus a compile_fail doctest).
  - `z30-engine`: `safety.rs` `n3_*`, `tests/dial_provenance.rs`.
  - `z30-cli`: `tests/loopback_isolation.rs`, `suite.rs::replicates_share_no_frame_with_each_other_or_the_published_run`.
  - `z30-channel`: `watterson_power_spectrum_has_the_labelled_2_sigma_spread`, `generated_taps_have_the_labelled_doppler_spread`.
  - `z30-dsp`: `snr_accuracy.rs::no_signal_is_no_estimate_never_a_floor_value` (N-08).
  - Oracle: `legacy/python-oracle/tests/test_watterson_doppler.py`.
- **Audit findings:** N-01…N-09, N-10 and N-11 (documentation), N-13, N-14, L-07 (partially), C-05 (extended).
- **In production:** **Yes.**
- **Later modified or invalidated by:** #45's review found open issues in the same areas. TX-01: a failed PTT release is never retried. TX-02: US band-plan CW-only sub-bands. TX-13 / DOC-02: `--migrate` writes `tx_level = 0.5`. RES-03: build provenance. RES-04: a replicate run can overwrite the published file.
- **Current status:** Production. The published figures reproduce bit-for-bit (QA, #45).

### #40 — chore(deps): bump pyo3 from 0.25.1 to 0.29.0 — NOT MERGED
- **State:** Closed without merging on 2026-09-26 (GitHub). No merge commit exists locally.
- **Purpose:** A Dependabot bump of pyo3, confined to the unshipped `crates/z30-py`.
- **Decision (owner's closing comment):** "closed, to be replaced — not rejected on merit".
  - The §7 lock-closure proof holds.
  - The paired oracle-against-production CI job failed because a source migration is needed in `crates/z30-py/src/lib.rs`, which Dependabot cannot write.
  - The replacement is to carry the migration and the closure proof.
  - The RustSec advisories mentioned were not confirmed against the repository's alerts.
- **Tests / findings:** None.
- **In production:** No. `crates/z30-py/Cargo.toml` still pins `pyo3 = "0.25"` at `78db463`.
- **Later:** #43 used it as the passing example for `lock_closure.py`.
- **Current status:** Open need. No replacement merged.

### #41 — docs: research process for changes reaching main
- **Merge:** `0d40199`, 2026-09-26. Commit `3374f9f`.
- **Purpose:** Defined how a change reaches `main`: proposal; paired experiment against the main baseline (same seeds, Wilson intervals, McNemar, false-decode rate, CPU cost); code, DSP and QA review; explicit board acceptance; then merge. Protocol changes have extra requirements.
- **Important files:** `docs/research-process.md`, `docs/README.md`.
- **Decisions:** No change lands without an explicit board decision. The board is the licensed operator.
- **Tests added:** None.
- **Audit findings:** None.
- **In production:** Yes, as process.
- **Later modified or invalidated by:** #43 added a §7 addendum. #44 added agents for its roles. #45 (RES-01) found the instrument cannot yet pair two commits, because there are no per-frame outcomes.
- **Current status:** In force.

### #42 — First release: v0.1.0-experimental (prepared, NOT published)
- **Merge:** `207caac`, 2026-09-28. Commits `2e3559e`, `4f6bb01`, `6607b1e`.
- **Purpose:** Versioned the workspace `0.1.0-experimental` and fixed a release workflow that could never have produced a release. Added release notes.
- **Important files:** `Cargo.toml`, `Cargo.lock`, `.github/workflows/release.yml`, `docs/release-notes/v0.1.0-experimental.md`, `docs/install.md`, `wiki/09`.
- **Decisions:**
  - macOS 15 runners.
  - `workflow_dispatch` / PR dry run, with publishing only on `refs/tags/v*`.
  - The tag must equal the workspace version.
  - Desktop entry and icon shipped in the Linux archive.
  - W1AW scan of the **packaged** binaries on every platform.
  - The packaged `z30` runs `--loopback-test` and the fresh-install test.
  - Publishing refuses notes that do not state the validation status.
- **Tests added:** CI steps in `release.yml` (packaged-binary W1AW scan, loopback and fresh-install smoke).
- **Audit findings:** C-04 (extended to packaged binaries). CTO-08 (retired macOS runner) was resolved by this PR, per the #45 board packet.
- **In production:** Yes: version and release workflow. **Not published:** no tag or release exists.
- **Later modified or invalidated by:** #45 recorded that `main`'s paired-harness CI job has been red since `207caac`. maturin rejects `0.1.0-experimental`, which `crates/z30-py` inherits (`version.workspace = true`), as not PEP 440. A patch (`z30-py` version `0.1.0-dev.0`) was proposed in a PR #45 comment and is not applied at `78db463`. The release notes were not reviewed by any agent (07 §0 C2).
- **Current status:** Prepared, unpublished. CI red on the paired-harness job.

### #43 — chore(research): lock-closure proof for section 7 dependency updates
- **Merge:** `fe8f246`, 2026-09-28. Commit `66b87d4`.
- **Purpose:** Proves from `Cargo.lock` alone that a dependency update leaves the suite's inputs identical, so no measured figure can move.
- **Important files:** `research/lock_closure.py`, `docs/research-process.md` §7.
- **Decisions:**
  - The proof works in one direction only. A changed closure means the full §2 process.
  - `rand`, `rand_chacha` and `rand_distr` are always §2-class.
  - "A §7 change whose CI is red does not land."
- **Tests added:** None in the suite. It was verified against #40 (exit 0) and #37 (exit 1).
- **Audit findings:** None.
- **In production:** Yes, as a process tool.
- **Later modified or invalidated by:** None.
- **Current status:** In force.

### #44 — docs: agent team for the research-process review roles
- **Merge:** `caf1a9a`, 2026-09-28. Commit `a6130e5`.
- **Purpose:** Added seven Claude Code subagents, one per review role.
- **Important files:** `.claude/agents/{research-engineer,cto-code-reviewer,rf-dsp-reviewer,qa-reproducer,tx-safety-auditor,docs-honesty-auditor,ceo-board-liaison}.md`, `AGENTS.md` §9.
- **Decisions:**
  - Each agent defers to `AGENTS.md` and `docs/research-process.md` and does not restate figures.
  - No agent merges, approves, records a board decision or keys a radio.
  - QA reruns write to a scratch `--out`, so the published results are never overwritten.
- **Tests added:** None.
- **Audit findings:** None.
- **In production:** Yes, as tooling.
- **Later modified or invalidated by:** #45 was the team's first run.
- **Current status:** In force.

### #45 — docs(audit): 2026-09-28 whole-project review by the agent team
- **Merge:** `78db463`, 2026-09-28. Commits `571f2b6`, `4cbf074`, `f45fe7f`, `a4239da`, `1304eae`, `0da49e8`.
- **Purpose:** Whole-project review at `caf1a9a` by all seven agents. It is evidence for the board, and **no board decision is recorded**.
- **Important files:** `audit/2026-09-28-agent-team-review/{01…07,README}.md`, `evidence/{tx-mutation,qa-reproduction,c1-buildrs-tiebreak}/`.
- **Decisions:** Findings only. Conflict C-1 was resolved: RES-03 stands, because `build.rs` labels a binary built from an unstaged edit as clean.
- **Tests added:** None in the tree. The mutation script and probe are under `evidence/tx-mutation/`.
- **Audit findings raised:** F-01…F-79 (13 High), de-duplicated from CTO-01…17, TX-01…22, DSP-01…13, DOC-01…34, QA-01…07 and RES-01…16. Headlines:
  - The published figures reproduce bit-for-bit on rustc 1.95.
  - TX-01 = CTO-01: a failed PTT release is never retried.
  - TX-02: the US band plan admits data in the 6 m and 2 m CW-only sub-bands and off-channel on 60 m.
  - TX-13 = DOC-02: `--migrate` writes `tx_level = 0.5` and can import W1AW.
  - 14 of 37 transmit mutants survive. The five earlier survivors are now killed.
  - DSP-01: SNR reads 1.7–6.3 dB low on fast fading.
  - DSP-03: AP has no production test.
  - RES-01: no per-frame outcomes. RES-03: build provenance. RES-04: a replicate overwrites the published file.
  - DOC-01: wiki/15 shows a default dial and TX level. DOC-04: `docs/demodulation.md` describes the retired SNR estimator.
  - `main` CI is red (see #42).
- **In production:** Audit record.
- **Later modified or invalidated by:** None at `78db463`.
- **Current status:** Open. The findings are unaddressed at `78db463`, and B1 (F-01 = TX-01) is among the blockers before any dummy-load test (`07-board-packet.md` §0 B).

---

## Not determined

- The reports of the `29cfe1f` code audit (#1, #2), the UI/frontend audit (#5), the "audit findings 2, 4, 5" of #8, and the systems audit (#14) are not in the repository. Their finding texts are known only from the commit messages quoted above.
- `Z30_FULL_AUDIT_2026-09-24.md` (the input to #34) is not in the repository or its history.
- Whether the four open Dependabot alerts mentioned in the #40 comment correspond to the pyo3 advisories: stated as unconfirmed by the owner, and not checked here.
