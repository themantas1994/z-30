# 2026-09-24 audit remediation — vNext migration

This directory is the evidence for the remediation of `Z30_FULL_AUDIT_2026-09-24.md`
(audited commit `224b2fc`). It records what was changed, what was re-measured, what was
retested, and what is still untested.

**Hardware status: real-radio validation has not yet been performed.** No radio, sound card,
audio interface, PTT interface, RF path, GPS/PPS or on-air recording was available. Every
performance figure here is software simulation through the production receiver. Where a fix
is to code that drives hardware, its status says so ("FIXED — NOT HARDWARE VALIDATED").

## What changed, in one paragraph

z-30 is now one application: the Rust workspace in `crates/`, shipped as `z30` (command-line
station and toolbox) and `z30-gui` (desktop station). They share one receiver (`decode_slot`),
one engine, one transmit gate and one logbook. The browser/Python runtime that was the
installed product at `224b2fc` has been moved to `legacy/`. Its protocol code remains as a
frozen, non-production oracle for golden vectors, and its browser code remains as a reference
test target. No installer, release artefact or entry point reaches either. The vNext defects
the audit found have been fixed: SNR saturation (M-07), per-realisation fading normalisation
(H-10), whole-message round-trip checking at the transmit gate (C-06), QSO record validation
(C-05) and the MSRV (H-08). Each fix has a regression test. The benchmarks were re-run through
the shipped binary into machine-readable result files, and the documentation was rewritten
from them.

## Files

| File | Contents |
| :--- | :--- |
| [FINAL_AUDIT.md](FINAL_AUDIT.md) | **The audit.** Every finding: original finding, root cause, files changed, fix, regression test, test result, evidence, remaining limitation, status. The environment, commands and counts. The final term search and its classification |
| [FIXES.md](FIXES.md) | The same findings, one line each |
| [TEST_RESULTS.md](TEST_RESULTS.md) | Every suite run for this remediation, with counts, toolchains, failures and skips |
| [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md) | The re-run benchmarks, with seeds, sample counts and the audit's figures beside them |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The production graph, and what sits outside it |
| [MIGRATION.md](MIGRATION.md) | Where the repository's files went, and what `z30 --migrate` does for an operator |
| [LEGACY_STATUS.md](LEGACY_STATUS.md) | Every legacy component and what happened to it |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Everything that is still not done, not measured or not possible |

## Status summary

Counts over the 35 findings in sections 39–42 of the audit (6 critical, 10 high, 12 medium, 7 low):

| Status | Count | Findings |
| :--- | ---: | :--- |
| FIXED | 27 | C-02–C-06, H-01, H-03, H-04, H-08, H-09, H-10, M-01–M-07, M-09–M-12, L-01–L-04, L-06 |
| FIXED — NOT HARDWARE VALIDATED | 2 | C-01, H-05 |
| PARTIALLY FIXED | 3 | H-06, H-07, L-07 |
| NOT FIXED | 3 | H-02 (needs equipment), M-08 (not fixable in software; documented), L-05 (a protocol property; unmeasured) |
| NOT TESTED | 0 | |

Nothing here is a claim that z-30 is ready for use on the air. The hardware procedure in
[`docs/hardware-validation.md`](../../docs/hardware-validation.md) has not been carried out.
