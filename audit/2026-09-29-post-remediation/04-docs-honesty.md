# Docs-honesty audit: PR #46, branch `claude/nice-archimedes-epwg4o`, head ee42ae6 against base 78db463

**Verdict: 13 FINDINGS.** 2 Medium, 1 Low-Medium, 8 Low, 2 Info.

None of them implies hardware validation or re-publishes a withdrawn figure. The transmit behaviour in the docs matches the code. The findings are internal contradictions left by 4eed968 and by the documentation pass, plus a few stale sentences.

**The report file was not written.** My operating rules forbid writing report or findings `.md` files, and that overrides the request for `/tmp/claude-0/reviews/04-docs-honesty.md`. The full report is below; it can be saved verbatim.

## Method
- **Scope:** `git diff 78db463..ee42ae6 -- '*.md'`, covering the in-scope files you listed. Commit 4eed968 was read against `audit/2026-09-24-post-remediation/FINAL_AUDIT.md:234` (the H-01 row) and `audit/2026-09-28-agent-team-review/03-dsp-review.md` (DSP-01, DSP-04, DSP-05, DSP-09, DSP-10).
- **Transmit claims:** each one was checked in code at file:line (`ptt.rs`, `runtime.rs`, `api.rs`, `engine.rs`, `txgate.rs`, `bandplan.rs`, `migrate.rs`, `audio.rs`, `cm108.rs`, `slots.rs`, `rig.rs`, `ldpc.rs`, `slot.rs`, `sync.rs`, `sic.rs`, `demod.rs`, GUI `app.rs`, CLI `main.rs`).
- **Figures:** every figure table was recomputed from `research/results/672cef9b3cdb/*.json` (awgn, snr, drift, timing, clock, impair, busy, false, sic, fading). The run-to-run sd (0.0482 over 11 runs, 0.0496 over the ten replicates) and the pooled crossings were recomputed from `18fbd78d8fb8/` and `audit/…/awgn_replicate_analysis.json`. The false-decode bounds and power figures were recomputed too. All match.
- **Name and link checks:** a script extracted every backticked test, function and constant name in the changed docs and grepped it in `crates/`, `research/`, `legacy/` and `.github/`. Only statuses, file names and names truncated with "…" failed to match, and the full names exist. A second script resolved every relative link and anchor; all resolve.
- **Binary run:** `target/release/z30` is built at 0362aef, and since then only the comment in `sic_regression.rs` has changed in `crates/`. I ran it in a scratch `Z30_HOME` with `--migrate`, `--diagnostics` and `--loopback-test` (in memory, no device, no PTT). The outputs match the wiki/15 config block, the troubleshooting diagnostics sample, and the 50.5 Hz / 65.9–66.7 Hz bandwidth.
- **Sweeps:** the dB sweep and the on-air sweep found nothing that implies a radio, sound card, RF path or on-air contact. The validation-state sentence is stated correctly wherever it appears.

## Checks with no finding
- **Transmit behaviour matches the code:**
  - PTT `Keyed → ReleasePending → Released` (`ptt.rs:10-17, 300-425`), with the watchdog at 50 ms (`runtime.rs:427`).
  - HALT: `RuntimeHandle::halt` at `runtime.rs:354-360`, and the GUI calls it at `app.rs:427`.
  - `TxOutcome` (`api.rs:217-235`). Only `Complete` logs (`engine.rs:580`).
  - Lateness limits of 0.5 s (`runtime.rs:108-112, 210-235`).
  - Output failure and recovery every 5 s (`runtime.rs:116, 806-835, 906-916`).
  - Mid-frame dial or mode contradiction (`engine.rs:498-509`, `runtime.rs:846-856`).
  - US band plan: 50.1 / 144.1 MHz and the five 60 m channels at ±50 Hz (`bandplan.rs:123-126, 196-217, 233-241`).
  - Migration: no tx_level and no legacy defaults (`migrate.rs:128-133, 244-272, 354, 374, 413-415`).
  - Device ambiguity (`audio.rs:156-173`, `cm108.rs:44-60`).
  - Clock-step event and its display (`slots.rs:128-165`, `app.rs:217`, `main.rs:501`), apart from finding 9.
  - Poll interval and settle window (`runtime.rs:114, 536-566`; `rig.rs:12`).
- **Withdrawn figures:** −21.4 dB, −20.79 / −21.31 / −21.07 dB and 98.7 / 95.2 / 91.4 / 84.6 % appear only as withdrawn history.
- **FT8 comparison:** complete, all-or-nothing, in README:71-84, wiki/Home:35-40, wiki/10:24-30, wiki/16:91-96 and the release notes (lines 82-91).
- **Oracle labelling:** wiki/17's AP sweeps are labelled as the oracle's, exploratory, with the fading row marked withdrawn.
- **suppression_db range (F-57):** 9–16 dB is supported. E047 gives 9–12 dB; FINAL_AUDIT.md:234 says "overstating by 11–16 dB"; DSP-10 gives the mechanism (`sic.rs:53, 240-249`). The range is stated the same way in AGENTS:159, sic.md:36-43, benchmarking.md:299-300, wiki/05:85-87 and `sic_regression.rs:10`.
- **Impairments at 6 kHz (F-54):** correct. `impair.json`'s own title already says "after resampling".

## Findings

**1. Medium: the residue filter is described as both harmless and as hiding stations.**
- Location: `docs/receiver.md:60-67`. Wrong text: "two restrictions that change the cost without changing the result: … a candidate sitting on a decoded station's own residue (±1.6 Hz, ±0.1 s) is skipped. It could only decode as the station already decoded."
- Contradicts the text 4eed968 added in `docs/benchmarking.md:290-294` ("a second station that close to a decoded one is unreachable") and `docs/sic.md:92-94`.
- Authority: code, `slot.rs:262-268`. The filter drops any candidate in that window, whichever station it is. Also DSP-04, and ledger F-41 (OPEN): the effect was never measured.
- Proposed text: "Passes 2 and 3 search again, with two restrictions that reduce the cost; their effect on decodes has not been measured (2026-09-28 audit DSP-04, F-41): … a candidate within ±1.6 Hz and ±0.1 s of a decoded station is skipped as that station's residue. A different station that close is therefore not retried in passes 2 and 3 ([sic.md](sic.md))."

**2. Medium: the historical performance table is presented as current.**
- Location: `docs/benchmarking.md:413-432`, the "Performance (gate G2.7)" table taken from `perf_k.txt`. Wrong text: "K = 50 on 4 threads: p99 863 ms, under the < 1 s target …". Line 481 repeats it: "Single-thread K = 50 latency misses its target (above)".
- Contradicts `research/results/README.md` (added in this PR, F-35): "perf_k.txt is historical, not current … measured before the replica fit of d8983ee … its 'p99' is the maximum … No performance figure may be quoted as current until `z30 --benchmark perf` is re-run".
- Authority: `research/results/README.md`, DSP-06 (measured at 83b1b70, before `placed_replica` existed), and ledger row F-35, which names `docs/benchmarking.md` but only the README was changed.
- Proposed: put this banner directly above the table: "**Historical, not current (F-35).** Measured at `83b1b70`, before the replica fit every decode now runs (`d8983ee`); 20 slots per row, so 'p99' is the maximum; the 4-thread allocation column is not deterministic; no provenance in the file. No latency figure is current until `z30 --benchmark perf` is re-run on an idle host." Change line 481 to: "Single-thread K = 50 latency: last measured before the replica fit (historical); not re-measured."

**3. Low-Medium: "unreachable" is stronger than the evidence (4eed968, F-52).**
- Locations: `docs/benchmarking.md:290-297` ("a second station that close to a decoded one is unreachable") and `docs/sic.md:92-94` ("so a station that close is unreachable").
- Authority: code and DSP-05.
  - The residue filter applies only in passes 2 and 3 (`slot.rs:262-268`).
  - Pass-1 NMS suppresses peaks within ≤2 hops (80 ms) and ≤2 bins (`sync.rs:169-176`), which is narrower than the filter's 0.1 s.
  - DSP-05's own data: at ΔDT 0.08 s the weak station decoded "12/20 both ways", i.e. through `decode_slot` too. The page quotes that 12/20 only as the fresh re-decode.
- Proposed (benchmarking.md): "Separately, by design: in passes 2 and 3 a candidate within 1.6 Hz and 0.1 s of a decoded station is dropped as its residue (`slot.rs`), and in every pass acquisition keeps only the strongest peak within 2 bins (1.6 Hz) and 2 hops (80 ms) (`sync.rs`). A second station inside that NMS neighbourhood of a stronger one is never a candidate, and one inside the residue window that pass 1 missed is never retried. DSP-05 (exploratory, 20 trials per cell, weak at −18 dB, no result file) … decoded it at 0.08 s in 12/20 trials, through `decode_slot` as well as afresh, where hop quantisation sometimes places it outside the NMS neighbourhood."
- Proposed (sic.md:92-94): "…is discarded in passes 2 and 3 as its residue, so a station that close is not retried after pass 1 …"

**4. Low: a stale "no SUMMARY.md" sentence.**
- Location: `docs/benchmarking.md:138-139`. Wrong text: "`18fbd78d8fb8/` has no `SUMMARY.md` (audit F-67, open)."
- Authority: `research/results/18fbd78d8fb8/SUMMARY.md` exists (added in this PR); `research/results/README.md:88-92`; ledger F-67 is FIXED_PENDING_REVIEW.
- Proposed: "`18fbd78d8fb8/SUMMARY.md` (generated with `--partial`; awgn only, NOT-THE-PUBLISHED-RUN banner) does not contain these statistics."

**5. Low: two provenance statements for the pooled figure disagree.**
- Location: `research/results/README.md:90-92`. Wrong text: "computed from the replicate files by hand in the corrective audit; no script in `research/` produces it yet".
- Contradicts `docs/benchmarking.md:135-138` ("by `…/analyse_awgn.py` (`awgn_replicate_analysis.json` beside it)").
- `AGENTS.md:233-234` cites `research/results/18fbd78d8fb8/` for the pooled −23.00 dB, but no JSON value there holds it.
- Authority: `audit/2026-09-24-corrective-remediation/evidence/awgn_investigation/awgn_replicate_analysis.json`, key `pooled.crossings.50` = −23.0032 [−23.0394, −22.9632].
- Proposed (README): "computed by `audit/2026-09-24-corrective-remediation/evidence/awgn_investigation/analyse_awgn.py` (output `awgn_replicate_analysis.json`, key `pooled`); no script in `research/` produces it yet."
- Proposed (AGENTS): "(`research/results/18fbd78d8fb8/` replicates; computed in `audit/…/awgn_replicate_analysis.json`)".

**6. Low: the SPEC §3 Gray paragraph overstates the AWGN claim (4eed968, F-55).**
- Location: `SPEC.md:83-89`. Wrong text: "On AWGN the labelling costs nothing by construction". The same paragraph then says a difference "could only come from non-orthogonality (GFSK leakage …)", and GFSK leakage is present on AWGN. `docs/benchmarking.md:478-480` repeats the absolute claim: "On AWGN the labelling is irrelevant by symmetry".
- Authority: DSP-09 (the symmetry holds for *orthogonal* FSK) and DSP-02 (3.75% of symbol energy leaks, 0.51% into adjacent bins). DSP-09's exploratory AWGN −23 dB row was Gray 88 vs natural 74, p = 0.13.
- The trailing "(audit L-05)" attributes the exploratory run to L-05; it is DSP-09's.
- Proposed (SPEC): "For ideal orthogonal non-coherent 16-FSK on AWGN the labelling costs nothing by construction: the channel is invariant under any permutation of the tone indices, so every labelling has the same bit-LLR distribution and BICM capacity (2026-09-28 audit DSP-09, confirmed by Monte Carlo). z-30's GFSK is not exactly orthogonal (DSP-02: 0.51% of symbol energy in adjacent bins), and residual frequency error, drift and Doppler also break the symmetry, so a small difference is not excluded; the only paired run (DSP-09: exploratory, genie-coarse, 150 frames per condition, AWGN and fading) found none significant. L-05 remains open for fading."
- Proposed (benchmarking.md): "On AWGN the loss is zero for ideal orthogonal FSK by symmetry (SPEC §3); …"

**7. Low: exploratory figures are quoted without full conditions or committed evidence.**
- Location: `docs/receiver.md:110-121` (DSP-01: "poor 1.7 dB low at +10 dB and 6.3 dB low at +20 dB …"). The implementation, the seed and any interval or sd are missing.
- In the same paragraph, line 114 "Below about +10 dB it stayed within 0.5 dB" is left unqualified. DSP-01 on the corrected model: poor −0.52 dB at 0 dB, moderate −0.55 dB at +10 dB.
- `docs/benchmarking.md:294-297` (DSP-05) likewise gives no seed or implementation.
- Authority: AGENTS §5 (conditions) and `audit/EVIDENCE_POLICY.md`. `audit/2026-09-28-agent-team-review/evidence/` holds no DSP-01, DSP-05 or DSP-09 script or output.
- Proposed (receiver.md), replacing the parenthesis: "(DSP-01: exploratory, `decode_slot` with `RxConfig::default()`, blind placement, 30 frames per cell, error against each frame's realised SNR in 2500 Hz; mean error with sd 0.26 / 0.68 / 0.32 dB; no seed, script or result file committed, the audit report is the only record)". Change line 114 to "Below about +10 dB it stayed within 0.5 dB on that (pre-N-01) model."

**8. Low: stale description of the thread-count test.**
- Location: `docs/sic.md:82`. Wrong text: "a 20-station band gives a bit-identical report on 1 thread and on the pool".
- Authority: `sic_regression.rs:124-142`: explicit 1- and 8-thread pools, comparing payload, pass, iterations and the DT/frequency/SNR bits. `docs/receiver.md:135-140` already says this.
- Proposed: "a 20-station band gives the same decodes (payload, pass, iterations; bit-identical DT, frequency and SNR) on an explicit one-thread and an explicit eight-thread pool (F-76)".

**9. Low: the clock-step condition leaves out a case the code allows.**
- Location: `docs/synchronization.md:103-105`. Wrong text: "A step large enough that the clock no longer reads the slot the scheduler is waiting for, or the one before it, re-seats the scheduler".
- Authority: `slots.rs:158-165`. The scheduler re-seats only if `now_slot + 1 < next || now_slot > next + 1`, so `next + 1` is also tolerated.
- Proposed: "A step that puts the clock more than one slot before or after the slot the scheduler is waiting for re-seats the scheduler …"

**10. Low: "AP is off by default" leaves out migration.**
- Location: `wiki/17-A-Priori-(AP)-Decoding.md:205-207` ("**AP is off by default**: `ap_enabled = false` …"). `docs/troubleshooting.md:142-173` (what migration imports) is also silent on it.
- Authority: `migrate.rs:293-296` copies the legacy `apDecodeEnabled` into `receiver.ap_enabled`. DSP-03, fix item 5.
- Proposed (wiki/17): "AP is off in a new installation …; `z30 --migrate` carries over the retired app's AP setting (`apDecodeEnabled`) and lists it under Imported, so check Settings → Receiver after migrating."
- Proposed (troubleshooting.md): add the same sentence to the Migration section.

**11. Low: the pre-test checklist's status for F-02 contradicts the ledger.**
- Location: `hardware-validation/PRETEST_CHECKLIST.md:17`, item 1 "(F-01…F-09 …)" marked **FIXED, PENDING REVIEW**. That range includes F-02.
- Authority: `audit/ACTIVE_DEFECT_LEDGER.md:37` has F-02 as BOARD_DECISION, as does the checklist's own item 5.
- Proposed: "(F-01, F-03…F-09, …; F-02 is item 5)".

**12. Info: the loopback's criteria string is out of date.**
- Location: `crates/z30-cli/src/loopback.rs:127, 209` says "(the waveform alone measures ~49 / ~66 Hz)".
- The binary itself measures p99 50.54 Hz and −40 dB 65.92–66.65 Hz, and wiki/03:16 and README:93 now say ≈ 50.5 Hz.
- Proposed: "~50.5 / ~66 Hz".

**13. Info: capture JSON carries an unlabelled `suppression_db`.**
- Location: `crates/z30-cli/src/main.rs:425`. The capture JSON that wiki/10:39-43 now points operators to (for `"pass"`) carries per-pass `"suppression_db"` with no label. `suite.rs:1029` attaches a note for the same quantity.
- Authority: AGENTS §4.
- Proposed: add `"suppression_db_note": "receiver-internal fit ratio, not physical suppression (overstates by 9–16 dB)"`, or document the field in wiki/15.

## Commit 4eed968: summary
- **F-57:** correct; sources verified.
- **F-54:** correct.
- **F-24:** the DSP-01 figures are copied correctly (poor 1.71 / 6.34 dB, moderate 2.87 dB), but conditions are missing (finding 7).
- **F-55:** overstated for AWGN (finding 6).
- **F-52:** overstated (finding 3), and it contradicts receiver.md (finding 1).

## Ledger rows naming docs-honesty-auditor

| Row | Verdict | Evidence |
| :--- | :--- | :--- |
| F-10 | VERIFIED | wiki/15 toml block is identical to `z30 --migrate` output (0362aef binary) in an empty dir; migrate.rs:413-415 |
| F-18 (doc half) | VERIFIED | safety.md:149-156, hardware.md:16-24, wiki/06, architecture.md:57-58 vs runtime.rs:114, 536-566; rig.rs:10-12 |
| F-21 (doc half) | VERIFIED | troubleshooting.md:152-173, safety.md:99-108, hardware.md:69-75, install.md:128-131 vs migrate.rs:128-133, 244-272, 354, 374, 413-415 (AP omission is finding 10, outside F-21's scope) |
| F-27 | VERIFIED | safety.md:140-146, wiki/06, hardware.md:21-24; `set_resolution` defined at rig.rs:143, no production caller |
| F-28 | VERIFIED | demodulation.md:84-102 vs demod.rs:167-204 |
| F-29 | VERIFIED | wiki/10:39-43, wiki/05; main.rs:333-343 (no pass printed), main.rs:419 (`"pass"` in capture JSON); GUI shows no pass |
| F-30 | Wording VERIFIED (status stays BOARD_DECISION) | wiki/Home:35-40, wiki/10:24-30, wiki/16:91-96 match AGENTS §5 |
| F-31 | VERIFIED | wiki/10:17-20; E007 appears elsewhere only hedged (README:49, Home:11, wiki/01:11, wiki/03:42-44) |
| F-32 | VERIFIED | suite.rs:65-81; AGENTS:251; research-process.md:57; benchmarking.md:71-80; wiki/16:73-75 |
| F-33 (docs half) | VERIFIED | wiki/17:244-250, 256, 272-276, 289-294, 320-328 |
| F-39 | VERIFIED (limitation) | .gitignore:27; audit/EVIDENCE_POLICY.md |
| F-43 (doc half) | VERIFIED | audio.md:10-14, hardware.md:88-105, wiki/06, troubleshooting.md:126-128 vs audio.rs:156-173, cm108.rs:44-60, 85 |
| F-51 | VERIFIED | README:170, wiki/16:107, 110 vs rust.yml:46, ci.yml:89-93 |
| F-58 | VERIFIED (see finding 10) | wiki/17:176-179, 205-207 vs app.rs:785-786, protocol lib.rs:60 |
| F-59 | VERIFIED | wiki/04 steps 5 and 7 vs ldpc.rs:400-410, 430-449; p = 2·2⁻²³ ≈ 2.4e-7 |
| F-60 | VERIFIED | ldpc.md:95-97 vs logbook.rs:62, 328-331; app.rs:553 |
| F-61 | VERIFIED | SPEC §7 and §6.3 vs ldpc.rs:53, 431; oracle ldpc.py:785; codec.rs:68, 533 |
| F-62 | VERIFIED | README:49, release notes:11, Home:11, wiki/01:11, wiki/03:40-42, wiki/10:18; golden.rs:145 (≤ 1e-6) |
| F-63 | VERIFIED | troubleshooting diagnostics sample matches binary output; wiki/16:79-80 "53 minutes" = sum of elapsed_s, 53.25 min |
| F-64 | VERIFIED | README:81 vs fading.json presets; Home:29-33; wiki/03:110-122 vs timing/drift/clock JSON |
| F-68 | VERIFIED | no "on-air decoder" / "published threshold" left (grep) |
| F-69 | VERIFIED | no control bytes in wiki/docs; architecture.md:90 anchor resolves; Home:75-76 |
| F-70 | VERIFIED | README:137-154 |
| F-72 | VERIFIED | every table (AWGN, SNR, drift, busy, false, fading) re-checked against the JSON; finding 4 is prose, not a table |

**Rows owned by other reviewers that my findings touch:**
- **F-35** (qa-reproducer): the docs half is not done (finding 2). It should not be moved to VERIFIED on the strength of `research/results/README.md` alone.
- **F-52** (rf-dsp-reviewer): findings 1 and 3.
- **F-55** (rf-dsp-reviewer): finding 6.
- **F-24** (rf-dsp-reviewer): finding 7.
- **F-67** (qa-reproducer): finding 4.

## Files
- /home/user/z-30/docs/receiver.md
- /home/user/z-30/docs/benchmarking.md
- /home/user/z-30/docs/sic.md
- /home/user/z-30/docs/synchronization.md
- /home/user/z-30/SPEC.md
- /home/user/z-30/AGENTS.md
- /home/user/z-30/research/results/README.md
- /home/user/z-30/wiki/17-A-Priori-(AP)-Decoding.md
- /home/user/z-30/docs/troubleshooting.md
- /home/user/z-30/hardware-validation/PRETEST_CHECKLIST.md
- /home/user/z-30/audit/ACTIVE_DEFECT_LEDGER.md
- /home/user/z-30/crates/z30-cli/src/loopback.rs
- /home/user/z-30/crates/z30-cli/src/main.rs
