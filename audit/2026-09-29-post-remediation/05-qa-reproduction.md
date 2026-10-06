# QA reproduction: PR themantas1994/z-30#46 (`claude/nice-archimedes-epwg4o`)

Reviewer role: `qa-reproducer` (docs/research-process.md §3). Evidence for the board; not a board decision.
Date: 2026-09-29. Base `78db463`, head `ee42ae6`. Built and run at `a49d655`, whose code is identical to
`ee42ae6` (`git diff --stat a49d655 ee42ae6` touches only AGENTS.md, SPEC.md, the ledger, docs/, wiki/05 and one
comment line in `crates/z30-dsp/tests/sic_regression.rs`).

## Verdict

**REPRODUCED** for everything asked: `awgn` and `false` built from the head (`a49d6558e1da`, clean, rustc 1.95.0)
reproduce the published `research/results/672cef9b3cdb/awgn.json` and `false.json` exactly, every point, with the
published suite seed 20260830 and the published sizes (200 frames/point, 400 slots/kind).

What was **not** reproduced in this review (not requested): the other eight benchmarks (`snr`, `drift`, `timing`,
`clock`, `impair`, `busy`, `sic`, `fading`), and a rebuild of the base `78db463`.

| Benchmark x commit | `a49d655` (= `ee42ae6` code) vs published `672cef9b3cdb` |
| :--- | :--- |
| awgn | IDENTICAL (9/9 points; both crossings and their intervals bit-identical) |
| false | IDENTICAL (5/5 kinds, pooled; `ldpc_attempts` identical). Only the 16-FSK row's label changed, `0 dB` -> `-3 dB each` (F-53, intended) |
| snr, drift, timing, clock, impair, busy, sic, fading | NOT RUN |
| any benchmark at base `78db463` | NOT RUN |

## Findings

| # | Severity | Finding |
| :--- | :--- | :--- |
| QA-A | Medium | The head's `research/compare_results.py` **refuses to compare a QA reproduction with the published result it reproduces.** `compare_results.py research/results/672cef9b3cdb <scratch>/qa-head awgn --legacy-provenance` exits 2: `refused: awgn: status differs ('published' vs 'not_the_published_run')`. A run written with `--out` (which `.claude/agents/qa-reproducer.md` step 3 requires, so that the published files are not overwritten) is always `not_the_published_run`, and a published file is always `published`. The two statuses differ only in where the file was written. As a result, QA cannot certify a reproduction with the fail-closed tool that docs/research-process.md §3/§5 and docs/benchmarking.md name. QA has to fall back to the 2026-09-24 audit script, which checks neither seed, frames nor status, or to a bespoke comparer (used here). Suggested fix: treat `published` and `not_the_published_run` as equal in the status check, or add an explicit `--reproduction` mode. Also point the QA agent's step 4 at the head script. |
| QA-B | Low | Instrument scope (F-12). The hashed instrument is `suite.rs`, `bench.rs`, `z30-channel/{Cargo.toml,src/**}` and `z30-protocol/src/gfsk.rs`, plus z30-channel's external lock closure. It does not include the files that build the transmitted test frames besides the modulator: the `z30-protocol` encoder (codec, CRC, LDPC tables, Costas/symbol map), `z30-cli/src/main.rs` (flag -> `Options`) and z30-cli's own `rand` use in `busy`. The closure does include z30-channel's dev-dependencies (`proptest`, `tempfile`, `rusty-fork`, ...), so bumping a test-only crate changes the instrument hash and makes `compare_results.py` refuse. Neither affects the present result. |
| QA-C | Info | Pre-existing, not introduced by this PR. The `git` field of `awgn_paired_200.json` reads `73ce0f9` and that of `whitening_ab_200.json` reads `0ab6cf0`, while their `.txt` headers and `research/results/README.md` say `83b1b70` / `73ce0f9`. This is the F-34 "checkout HEAD read twice" symptom: HEAD moved during those runs. The README does not say that the JSON field names a different commit. |
| QA-D | Info | The main checkout `/home/user/z-30` moved during this review (HEAD `a25d5a9`, via `da090fa` and `3fbf952`, with uncommitted edits by other agents). Since `ee42ae6`, those commits change code only in `crates/z30-cli/src/loopback.rs` (criteria text) and `main.rs` (`capture_slot` note). Neither file is part of the benchmark instrument. This report covers `a49d655`/`ee42ae6` only. |

No difference was found in any receiver measurement.

## 1. Reproduction of awgn and false (head build)

Build (clean worktree `/tmp/claude-0/review-qa/head` at `a49d6558e1dab0c37028ddc88c0323f8b839aa4a`, `git status --porcelain` empty):

```bash
S=/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad
cd /tmp/claude-0/review-qa/head
CARGO_TARGET_DIR=$S/target-head cargo +1.95 build --release --locked -p z30-cli    # 3 m 40 s
$S/target-head/release/z30 --version    # commit: a49d6558e1da (not -dirty); rustc 1.95.0 (59807616e 2026-04-14)
$S/target-head/release/z30 --benchmark awgn  --out $S/qa-head     # 534 s (host shared with other agents' builds)
$S/target-head/release/z30 --benchmark false --out $S/qa-head     # 945 s
```

The seed and sizes were not passed. The defaults are the suite seed and the published sizes, and the run files
record `suite_seed 20260830`, `replicate 0`, 200 frames/point and 400 slots/kind, the same as the published files.

Written to `$S/qa-head/awgn.json` and `$S/qa-head/false.json`, both `status: not_the_published_run`
(`status_reasons: ["written outside research/results/<commit>/ (--out)"]`). The published files were not touched.
Their sha256 before and after were `074fbebd…9e32` (awgn) and `27d922e1…f608` (false), in both `/home/user/z-30` and the worktree.

Comparison with `$S/qa_compare.py`. It ignores only `latency_ms`/`*_ms`, `provenance`, `definitions`, the seed text
and the fields the new schema adds. Labels are reported separately. Everything else must be bit-identical.

### awgn: published (`672cef9b3cdb`, rustc 1.98.1) vs reproduced (`a49d6558e1da`, rustc 1.95.0)

| SNR | decoded pub / rep | false | dups dropped | dups emitted | Wilson 95% | |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| -26.0 | 0 / 0 of 200 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -25.0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -24.0 | 12 / 12 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -23.5 | 33 / 33 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -23.0 | 105 / 105 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -22.5 | 144 / 144 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -22.0 | 185 / 185 | 0 / 0 | 2 / 2 | 0 / 0 | bit-identical | IDENTICAL |
| -21.0 | 200 / 200 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |
| -20.0 | 200 / 200 | 0 / 0 | 0 / 0 | 0 / 0 | bit-identical | IDENTICAL |

`crossing_50pct_db` = {at -23.03472222222222, interval [-23.125644236706247, -22.888880932672524]} and
`crossing_90pct_db` = {at -22.0609756097561, interval [-22.153137546546663, -21.801937251582093]}, equal (Python
`==`) on both sides. It also matches the earlier QA attempt's run (`/tmp/claude-0/review-qa/qa-head/awgn.json`,
completed, exit 0, 698 s), which is IDENTICAL too.

### false: published vs reproduced

| Kind | slots | false decodes pub / rep | LDPC attempts pub / rep | upper95/slot | |
| :--- | :--- | :--- | :--- | :--- | :--- |
| white noise only | 400 | 0 / 0 | 250 / 250 | 0.007461355528799618 both | IDENTICAL |
| 20 CW carriers, -10..+20 dB | 400 | 0 / 0 | 2394 / 2394 | same | IDENTICAL |
| 8 random 16-FSK, no Costas (label `0 dB` -> `-3 dB each`) | 400 | 0 / 0 | 25976 / 25976 | same | IDENTICAL (label only) |
| 8 FT8-like 8-FSK, 0 dB | 400 | 0 / 0 | 27536 / 27536 | same | IDENTICAL |
| 500 impulses up to 40 sigma | 400 | 0 / 0 | 331 / 331 | same | IDENTICAL |
| pooled | 2000 | 0 / 0 | | 0.0014967448951883067 both | IDENTICAL |

The new `power` block reads: upper95 1.4967e-3/slot, 4.31/day, P(zero | rate = bound/3) = 0.3687, 29 956 slots to
bound 1e-4, 299 572 slots to bound 1e-5. I checked each by hand: exp(-2000·1.4967e-3/3) = 0.3687, and
ceil(ln 0.05 / ln(1-1e-4)) = 29 956.

### Tool output

- `research/compare_results.py 672cef9b3cdb $S/qa-head awgn --legacy-provenance` -> `refused: awgn: status differs ('published' vs 'not_the_published_run')`, exit 2 (finding QA-A).
- `audit/2026-09-24-corrective-remediation/evidence/scripts/compare_results.py 672cef9b3cdb $S/qa-head awgn` -> 5 "differences", all new schema fields (`frames_policy`, `not_the_published_run`, `publishable_size`, `status`, `status_reasons`), with no measured field among them.
- `research/compare_results.py /tmp/claude-0/review-qa/qa-head $S/qa-head awgn` (two head runs) -> `awgn: IDENTICAL`, exit 0.

### Summaries

`python3 research/summarize_suite.py $S/qa-head --partial` (not written into any results directory) prints the
NOT THE PUBLISHED RUN banner. Its AWGN and False-decode tables equal those in
`research/results/672cef9b3cdb/SUMMARY.md` row by row once the latency column is removed. The one difference is the
16-FSK label. Crossings: -23.03 [-23.13, -22.89] and -22.06 [-22.15, -21.80]. Doc figures checked against the
files: AGENTS.md §5 and docs/benchmarking.md quote the same AWGN numbers. The docs/benchmarking.md false-decode
table (250 / 2394 / 25 976 / 27 536 / 331; 7.46e-3; pooled 1.50e-3; 4.3/day) matches `false.json`.

Regenerating the committed summaries with the head script to stdout: `672cef9b3cdb` and `18fbd78d8fb8` (`--partial`)
are byte-identical to the committed `SUMMARY.md`. `d8983eeef66e` differs in the fading header line only
(`Delay / Doppler` vs `Delay / Doppler spread (2 sigma)`), as research/results/README.md says for F-65.

## 2. Receiver, protocol and channel untouched

`git diff --name-status 78db463 ee42ae6 -- crates/z30-dsp crates/z30-protocol crates/z30-channel`:

```
M crates/z30-channel/src/lib.rs          +#![forbid(unsafe_code)]  (attribute only)
A crates/z30-dsp/tests/ap_production.rs  (test)
M crates/z30-dsp/tests/sic_regression.rs (test: explicit 8- and 1-thread pools; comment)
M crates/z30-protocol/src/gfsk.rs        doc comment on synthesize() only
```

Not strictly "tests only". Two non-test source files changed, but the changes are a crate-level lint attribute and a
doc comment, with no code change. `Cargo.lock` changes only the `z30-py` version string. `bench.rs` changes
`upper95` for k > 0 only (k = 0 keeps the closed form; the published bounds are bit-identical, confirmed above).
The awgn/false reproduction confirms empirically that the receive path is unchanged.

## 3. research tests

```bash
cd /tmp/claude-0/review-qa/head && PYTHONDONTWRITEBYTECODE=1 python3 -m pytest research/tests -q -p no:cacheprovider
# 26 passed in 3.74s   (Python 3.11.15, pytest 9.1.1)
```

Also `CARGO_TARGET_DIR=$S/target-head cargo +1.95 test --release --locked -p z30-cli`: 24 + 3 + 3 passed, including
`suite::tests::{a_crossing_below_200_frames_per_point_is_exploratory, a_dirty_build_never_gets_the_published_directory,
replicates_and_exploratory_runs_are_routed_away_from_the_published_file, nothing_overwrites_a_published_result,
the_false_decode_labels_state_the_levels_that_were_run, a_zero_false_decode_count_reports_its_bound_and_what_it_cannot_exclude}`,
`bench::tests::upper_bound_*` (3), `build_support::tests::*` (5), `suite_output.rs` (3). The worktree stayed clean.

## 4. Provenance of the new results (`$S/qa-head/{awgn,false}.json`)

| Field | Value |
| :--- | :--- |
| git_commit | `a49d6558e1da` |
| git_dirty / git_diff_sha256 | `false` / `null` |
| rustc | `rustc 1.95.0 (59807616e 2026-04-14)` (the published run used 1.98.1; counts identical anyway) |
| build_profile, target | release, x86_64-unknown-linux-gnu |
| rustflags | `""` |
| target_features_compiled | fxsr, sse, sse2 |
| isa_features_detected | sse2..sse4.2, popcnt, avx, avx2, fma, bmi2, avx512f all true |
| cargo_lock_sha256 | `77ff31e6…4a83`, equal to `sha256sum Cargo.lock` |
| instrument.sha256 | `92730328f58b78de890d1296956d52359c311d9634c6190bf2874e6c142aa4ae`. Recomputed independently from `sha256sum` of the 5 files plus `lock:` + dependency list: match |
| decoder_config (RxConfig) | string-identical to the published files |
| definitions, placement, channel | identical to the published awgn.json |
| cpu / threads | Intel Xeon @ 2.10GHz, 4 logical, rayon 4 (same CPU model string as published) |
| seed | suite_seed 20260830, published_seed true, replicate 0 |

## 5. Ledger rows

Rows naming `qa-reproducer`, plus those the caller listed. "VERIFIED" here is this reviewer's evidence. Setting the ledger status is the named reviewer's act, and the board's where noted.

| ID | Named reviewer | Verdict | Evidence |
| :--- | :--- | :--- | :--- |
| F-11 | qa-reproducer, research-engineer | VERIFIED | `--per-frame` at 20 frames: the `awgn.frames.jsonl` from 4 threads and from `RAYON_NUM_THREADS=1` are byte-identical (`cmp`). Per-point sums of `correct` equal the aggregate `decoded` (180 frames). The header carries commit, instrument, seed and size. `paired_mcnemar.py` pairs a-vs-b (pooled b 0 : c 0, p = 1, exit 0) and refuses 20-vs-10 frames (`headers differ in frames_per_point`, exit 2) |
| F-12 | qa-reproducer | VERIFIED (observation QA-B) | Instrument sha256 and per-file hashes recomputed independently and matching. See QA-B for scope |
| F-13 | cto-code-reviewer, qa-reproducer | VERIFIED | Scratch worktree at a49d655, same target dir, sequence: clean -> `a49d6558e1da`; unstaged edit in `crates/z30-dsp/src/slot.rs` -> `a49d6558e1da-dirty` (a run went to `research/results/unpublished/a49d6558e1da-dirty-39a10116bdec/awgn.json`, status `dirty`); revert -> clean; untracked `crates/z30-dsp/src/f13_probe.rs` -> `-dirty`; removed -> clean. Worktree removed afterwards |
| F-14 | research-engineer (caller asked QA too) | VERIFIED | Against a scratch copy of the published dir: `--out research/results/672cef9b3cdb` (published, `--overwrite`, `--replicate 1`, `x/../` lexical, absolute) are all refused before decoding, exit 1. `--out <symlink to the copy> --overwrite` is refused by the published-file check. Copy sha256 unchanged. Defaults from a scratch cwd: `--frames 2` -> `research/results/exploratory/a49d6558e1da/`; `--frames 2 --replicate 1` -> `exploratory/a49d6558e1da/replicates/r1/`; full size -> `research/results/a49d6558e1da/`, and with `--replicate 1` -> `a49d6558e1da/replicates/r1/` (both probed through the refusal message on a pre-existing file). Rerunning without `--overwrite` is refused. I did not point `--out` at the real `research/results/672cef9b3cdb` (the sandbox blocked it); the check was done on the copy |
| F-32 | docs-honesty-auditor (caller asked QA too) | VERIFIED | `publishable_size` 200 for awgn/fading. The exploratory file says `2 per point, below the publishable 200`. Unit test `a_crossing_below_200_frames_per_point_is_exploratory` passes. The committed `672cef9b3cdb` summary regenerates byte-identically, with no banner |
| F-34 | qa-reproducer | NOT VERIFIED | Not exercised: this host has no `maturin` and no `numpy`, so the `z30-py` wheel and `paired_receiver.py` could not run. Code read only (`build_info()`, `_provenance()` flag a dirty or mismatched wheel/checkout). See QA-C for the pre-existing record |
| F-35 | qa-reproducer | Documented limitation, text VERIFIED | research/results/README.md at ee42ae6 marks `perf_k.txt` as historical. Nothing re-measured; the limitation stands |
| F-36 | rf-dsp-reviewer (caller asked QA too) | VERIFIED | `false.json` `power` block present, and the numbers check by hand (section 1) |
| F-37 | qa-reproducer | VERIFIED | `rustflags`, `target_features_compiled`, `isa_features_detected`, `cargo_lock_sha256` present and correct (section 4) |
| F-38 | qa-reproducer | VERIFIED (see QA-A) | `compare_results.py` refuses: a missing benchmark (`snr: missing`, exit 2), different frames (`20 vs 10`, exit 2), different status (QA-A). `summarize_suite.py` without `--partial` refuses a partial directory (exit 2). The fail-closed checks work. QA-A is a gap in how they apply to a reproduction |
| F-42 | qa-reproducer | VERIFIED | The unit tests pass. The four k > 0 references (1/10 0.394163302436505, 800/1e5 8.47909695610985e-3, 2000/1e4 0.20669370693426, 5/1e6 1.05130059293987e-5) were recomputed with mpmath (40 digits, exact tail, bisection) and agree to ~1e-15. The k = 0 published bounds (n = 400, 2000, 50, 133 911) agree with 1 - 0.05^(1/n). The reproduced false.json bounds are bit-identical to the published ones |
| F-53 | rf-dsp-reviewer (caller asked QA too) | VERIFIED | Label now `-3 dB each`. Signal unchanged: the row's `ldpc_attempts` 25976 and 0 false decodes are identical to the published run. The unit test checks the -3.01 dB arithmetic |
| F-65 | qa-reproducer | Documented limitation, text VERIFIED | The regenerated summary differs only in the fading header line, as documented |
| F-66 | qa-reproducer | VERIFIED | Recomputed from `672cef9b3cdb/awgn.json` and `18fbd78d8fb8/awgn_replicates/replicate-{1..10}/awgn.json` (section 6) |
| F-67 | qa-reproducer | VERIFIED (residual noted) | `18fbd78d8fb8/SUMMARY.md` regenerates byte-identically with `--partial`. The pooled 2200-frame figure is still computed outside `research/`, as the row says; I recomputed it (section 6) |
| F-73 | qa-reproducer | Documented limitation, text VERIFIED | README note present at ee42ae6 |
| F-74 | qa-reproducer | VERIFIED | `z30 --benchmark awgn --frames 1048576 --out $S/never` -> `--frames must be below 1048576 (the frame index has 20 bits in the seed)`, exit 1, nothing created |
| F-79 | qa-reproducer | VERIFIED | research/results/README.md at ee42ae6 (lines 56-58) credits `awgn_paired_200` to Rust 1.94.1, below the later MSRV, and does not re-attribute it |

## 6. Replicate spread (F-66) and pooled figure

50% crossings: published run -23.03472; replicates 1-10: -22.93382, -23.01887, -23.01042, -23.04930, -22.98529,
-22.94366, -22.92982, -23.00926, -23.04386, -23.06716.

| Statistic | Recomputed | Claimed |
| :--- | :--- | :--- |
| sample sd (n-1), 11 runs | 0.048221 dB | 0.048 dB |
| sample sd (n-1), 10 replicates | 0.049556 dB | 0.0496 dB |
| range / mean of 11 | -23.067 .. -22.930 / -23.0024 | -23.07 .. -22.93 / -23.00 |
| pooled 2200/point, 50% | -23.0032 [-23.0394, -22.9632] | -23.00 [-23.04, -22.96] |
| pooled 2200/point, 90% | -22.0873 [-22.1215, -22.0520] | -22.09 [-22.12, -22.05] |

For reference, the population sd (n) values are 0.0460 (11 runs) and 0.0470 (10 replicates); the claims use n-1.
`18fbd78d8fb8/awgn.json` has the same per-point counts as `672cef9b3cdb/awgn.json`.

## Cleanup

The scratch worktree `$S/wt-f13` was removed (`git worktree remove`). `/tmp/claude-0/review-qa/{base,head}` were
provided by the caller and left in place; `head` is clean (only git-ignored `__pycache__`). No file under any
`research/results/` in `/home/user/z-30` or the worktrees was written, moved or edited.
