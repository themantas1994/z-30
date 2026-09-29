# Audit evidence policy

Evidence cited by an audit is committed with the audit, or the audit says it is not kept. A
citation of a file that is not in the repository is a defect in the record.

## What is kept, and where

- Everything an audit cites as evidence lives under `audit/<date>-<name>/evidence/`: scripts,
  their output, result JSON, logs and probe sources.
- **Logs are evidence there.** `.gitignore` ignores `*.log` everywhere (build and tool noise), and
  re-includes `audit/**/evidence/**/*.log` with a negated rule. Plain-text output (`.txt`, `.tsv`,
  `.json`) was never ignored. The negation is deliberately narrow: a `.log` anywhere else is
  still ignored, and no other ignore rule was removed.
- Before citing a file, check that it is tracked: `git ls-files --error-unmatch <path>`. A
  file git ignores produces no warning when the audit is committed; that is how the logs below
  were lost.
- Output of a benchmark run for an audit is evidence, not a published result: it goes under the
  audit's `evidence/`, never into `research/results/<commit>/` (`z30` refuses that for anything
  but the published run itself; `research/results/exploratory/` and `unpublished/` are ignored).
- Evidence is never edited after the fact. A correction is a new file that names the old one.

## Logs cited by the 2026-09-24 corrective audit that are not in the repository

Found by the 2026-09-28 research-record review (RES-13 / F-39): the corrective audit cites
these logs, and `*.log` in `.gitignore` kept every one of them out of the commit. **They cannot
be recreated** - they recorded runs on a machine and at a time that no longer exist - and
**nothing here replaces them**. Where the same information survives in a tracked file, that file
is named; otherwise the claim rests on the audit's prose alone.

| Cited as | Cited in | Surviving tracked evidence |
| :--- | :--- | :--- |
| `evidence/pipeline.log` | `2026-09-24-corrective-remediation/evidence/README.md` | `evidence/scripts/pipeline.sh`, `suite_binary_version.txt`; the suite's own output is `research/results/672cef9b3cdb/` |
| `evidence/suite_run.log` | same | as above |
| `evidence/replicates*.log` (a glob; the number of files is not recorded) | same | `replicates_binary_version.txt`; the replicate results are `research/results/18fbd78d8fb8/awgn_replicates/` |
| `evidence/awgn_replicate_*.log` (a glob, presumably one per replicate) | same | as above |
| `evidence/awgn_seed_*.log` (a glob) | same | `evidence/awgn_investigation/flawed_seed_replicates_672cef9/` (the JSON results) |
| `evidence/final/release_artifact_checks.log` | `FINAL_AUDIT.md` (release binaries row) | `evidence/scripts/release_artifact_checks.sh` (the script only) |
| `evidence/final/release_artifact_checks_run1_script_errors.log` | same | none |
| `evidence/baseline/mutation_survivors_baseline.log` | `BASELINE.md` (N-03, N-06, N-07, N-08 rows), `FINAL_AUDIT.md` | `evidence/baseline/mutation_survivors_baseline.json` |

The review counted 19 distinct `.log` names across `audit/`; three of the rows above are globs
whose expansion was never recorded, so this table lists the names as they are cited rather than
a file count. `out.log`, `s.log` and `E/*.log` in `evidence/scripts/` and in `FINAL_AUDIT.md`'s
command listing are placeholders in commands, not cited evidence.

The evidence READMEs of that audit are not edited (evidence is not rewritten after the fact);
this file is the record that the logs are missing.
