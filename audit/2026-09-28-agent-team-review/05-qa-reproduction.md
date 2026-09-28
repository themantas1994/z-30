# QA reproduction — published benchmark results, z-30 at `caf1a9a`

> Produced by the `qa-reproducer` agent (`.claude/agents/qa-reproducer.md`), 2026-09-28.
> Evidence for the board, not a board decision. All builds and runs were in clean detached
> worktrees outside the checkout; `research/results/` was never written. The reproduced JSON
> files are kept as evidence under [`evidence/qa-reproduction/`](evidence/qa-reproduction/)
> (they are QA outputs, not published results).

**Verdict: PARTIALLY REPRODUCED.** Five things were not rerun: `awgn_paired_200` and
`whitening_ab_200` (they need the PyO3 wheel and the oracle, and numpy/maturin were not
installed), replicates 1–6 and 8–10, the eight non-AWGN/fading benchmarks of the
`672cef9b3cdb` suite, and the latency and throughput figures in `perf_k.txt`.

**Everything that was rerun matches the published files exactly.** That covers every decode
count, false decode, duplicate, Wilson interval and crossing. The exceptions are wall-clock
fields only, which are not receiver measurements. The findings below are about provenance and
wording. None of them is a difference in a count.

All of this is software simulation. No radio, sound card, PTT or rig was touched, and
`--audio-loopback-test` was not run.

## Header

| Item | Value |
| :--- | :--- |
| Repository HEAD at start | `caf1a9a` (identical to `main` at the time). By the end the checkout was at `a4239da`; the commits in between add only `audit/` files. `git diff caf1a9a a4239da -- research crates` is empty |
| Commits built (clean detached worktrees, `git status --porcelain` empty) | `672cef9b3cdb` (published suite), `caf1a9a1959a` (HEAD; crates identical to `18fbd78`), `83b1b7050f4a` (`perf_k.txt`), `2f6519cdaae5` (`false_decodes_2000.txt`) |
| Toolchain | `cargo +1.95`, rustc 1.95.0 (59807616e 2026-04-14), `--release --locked -p z30-cli`, no features. The published files say rustc 1.98.1 |
| `--version` of each build | `commit: 672cef9b3cdb`; `commit: caf1a9a1959a`; `0.9.0 (83b1b7050f4a)`; `0.9.0 (2f6519cdaae5)`. None says `-dirty` |
| CPU | Intel(R) Xeon(R) Processor @ 2.10GHz, 4 logical CPUs — the same model string as in the published provenance. The host was shared with other agents (load average up to 16 during the morning runs) |
| Scratch root | the session scratchpad's `qa/` directory (`$S` below) |

**Commands, exactly as run.** Each benchmark ran from inside its own worktree, and every suite
run used `--out` into scratch.

```bash
cd /home/user/z-30
git worktree add --detach $S/wt-672cef9 672cef9b3cdb
git worktree add --detach $S/wt-caf1a9a caf1a9a
git worktree add --detach $S/wt-83b1b70 83b1b70
git worktree add --detach $S/wt-2f6519c 2f6519c
CARGO_TARGET_DIR=$S/target-<c> cargo +1.95 build --release --locked -p z30-cli --manifest-path $S/wt-<c>/Cargo.toml
#   build times: 672cef9 3m15s, caf1a9a 4m08s, 83b1b70 6m20s, 2f6519c 6m25s

cd $S/wt-672cef9 && $S/target-672cef9/release/z30 --benchmark awgn   --out $S/qa-672cef9     # 7m19s  (08:44:20-08:51:39Z)
cd $S/wt-672cef9 && $S/target-672cef9/release/z30 --benchmark fading --out $S/qa-672cef9     # 30m39s (08:51:56-09:22:35Z)
cd $S/wt-caf1a9a && $S/target-caf1a9a/release/z30 --benchmark awgn   --out $S/qa-caf1a9a     # 11m39s (08:48:27-09:00:06Z)
cd $S/wt-caf1a9a && $S/target-caf1a9a/release/z30 --benchmark awgn --replicate 7 --out $S/qa-caf1a9a-rep7   # 11m48s
cd $S/wt-83b1b70 && $S/target-83b1b70/release/z30 --benchmark perf --frames 20                # 4m25s
cd $S/wt-2f6519c && $S/target-2f6519c/release/z30 --benchmark false-decodes --frames 200       # 4m40s
cd $S/wt-caf1a9a && $S/target-caf1a9a/release/z30 --benchmark false-decodes --frames 200       # 1m11s
cd $S/wt-2f6519c && $S/target-2f6519c/release/z30 --benchmark false-decodes --frames 2000      # 11m10s (19:39:07-19:50:17Z)

python3 audit/2026-09-24-corrective-remediation/evidence/scripts/compare_results.py <published dir> <qa dir> <bench>
python3 research/summarize_suite.py research/results/<commit>      # no --write, for 672cef9b3cdb, d8983eeef66e, 18fbd78d8fb8
python3 research/summarize_suite.py $S/qa-672cef9                  # no --write
git worktree remove --force $S/wt-{2f6519c,672cef9,83b1b70,caf1a9a}; git worktree prune
```

- **Benchmark wall time:** about 38 minutes in the morning session (runs overlapped) and about 12 minutes in the evening session, roughly 50 minutes in total. The builds took another ~20 minutes.
- **Seeds:** no base seed was passed anywhere. The `672cef9` and HEAD runs used the suite default 20260830. The replicate run used `--replicate 7` (seed 20260830 ^ (7<<48) = 1970324857235422).

## Which crates changed between the commits

- **`672cef9b3cdb` → `caf1a9a`:** `git diff --stat … -- crates/z30-dsp crates/z30-protocol crates/z30-channel crates/z30-cli/src/suite.rs` shows only `crates/z30-cli/src/suite.rs` (+44/−8): the replicate seeding (`--seed` became `--replicate`, `replicate_seed(r) = SUITE_SEED ^ (r<<48)`), plus `bench.rs` and `main.rs` argument plumbing. The receiver, modulator, codec and channel are unchanged.
- **`18fbd78` → `caf1a9a`:** no change under `crates/`, `Cargo.toml` or `Cargo.lock`, so the HEAD build also stands in for the `18fbd78` binary.
- **`d8983ee` → `672cef9`:** changes `z30-channel/src/lib.rs` (the Watterson N-01 fix), `z30-protocol/src/codec.rs` (the `VerifiedFrame` work), `suite.rs` (the seed option), plus tests. `z30-dsp/src` is unchanged.

## AWGN — `672cef9b3cdb/awgn.json` (200 frames per point, seed 20260830)

| SNR (dB) | Published decoded / false / dups dropped / emitted | QA @672cef9 (rustc 1.95) | QA @caf1a9a (rustc 1.95) | Result |
| :--- | :--- | :--- | :--- | :--- |
| −26.0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | MATCH |
| −25.0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | MATCH |
| −24.0 | 12 / 0 / 0 / 0 | 12 / 0 / 0 / 0 | 12 / 0 / 0 / 0 | MATCH |
| −23.5 | 33 / 0 / 0 / 0 | 33 / 0 / 0 / 0 | 33 / 0 / 0 / 0 | MATCH |
| −23.0 | 105 / 0 / 0 / 0 | 105 / 0 / 0 / 0 | 105 / 0 / 0 / 0 | MATCH |
| −22.5 | 144 / 0 / 0 / 0 | 144 / 0 / 0 / 0 | 144 / 0 / 0 / 0 | MATCH |
| −22.0 | 185 / 0 / 2 / 0 | 185 / 0 / 2 / 0 | 185 / 0 / 2 / 0 | MATCH |
| −21.0 | 200 / 0 / 0 / 0 | 200 / 0 / 0 / 0 | 200 / 0 / 0 / 0 | MATCH |
| −20.0 | 200 / 0 / 0 / 0 | 200 / 0 / 0 / 0 | 200 / 0 / 0 / 0 | MATCH |
| 50% crossing | −23.03472222222222 [−23.125644236706247, −22.888880932672524] | bit-identical | bit-identical | MATCH |
| 90% crossing | −22.0609756097561 [−22.153137546546663, −21.801937251582093] | bit-identical | bit-identical | MATCH |

`compare_results.py` printed `awgn: IDENTICAL` for each of these comparisons:
- published `672cef9b3cdb` against QA@672cef9;
- published `d8983eeef66e` against QA@672cef9, which confirms "identical to `d8983eeef66e`";
- published `672cef9b3cdb` against QA@caf1a9a;
- published `18fbd78d8fb8/awgn.json` against QA@caf1a9a;
- QA@672cef9 against QA@caf1a9a.

Across published files, `d8983eeef66e` against `672cef9b3cdb` is IDENTICAL for 9 of the 10
benchmarks. Only `fading` differs (65 fields), which is expected: N-01 fixed the channel
between those commits, and the old `d8983eeef66e/fading.json` is withdrawn.

## Fading — `672cef9b3cdb/fading.json` (200 frames per point, seed 20260830); all 25 points rerun at `672cef9`

| Preset | SNR points (dB) | Published decoded | QA decoded | False (pub / QA) | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| good | −24, −22, −20, −18, −16, −14, −10 | 17, 64, 132, 175, 184, 192, 199 | 17, 64, 132, 175, 184, 192, 199 | 0 / 0 at every point | MATCH (7/7) |
| moderate | −24, −22, −20, −18, −16, −14, −10 | 6, 69, 167, 197, 200, 200, 200 | 6, 69, 167, 197, 200, 200, 200 | 0 / 0 | MATCH (7/7) |
| poor | −24, −22, −20, −18, −16, −14, −10 | 1, 37, 150, 197, 200, 200, 200 | 1, 37, 150, 197, 200, 200, 200 | 0 / 0 | MATCH (7/7) |
| high-latitude moderate | −20, −10, 0, +10 | 0, 0, 0, 0 | 0, 0, 0, 0 | 0 / 0 | MATCH (4/4) |

The 50% crossings are bit-identical, and the `presets` objects compare equal:
- good −20.941176470588236 [−21.32759954718262, −20.552492692310008]
- moderate −21.367346938775512 [−21.62828515135358, −21.1211537667925]
- poor −20.884955752212388 [−21.08831828563158, −20.677146409326028]
- high-latitude moderate: none

Duplicates dropped and emitted, percent and `wilson95` are identical at every point.
`compare_results.py`: `fading: IDENTICAL`.

A script checked the docs tables against `fading.json`. All 25 rows of the fading table in
`docs/benchmarking.md` match. The wiki/11 fading table and the 50% crossings quoted in
`docs/benchmarking.md`, wiki/11 and wiki/16 match `SUMMARY.md`.

## Replicate spot-check — `18fbd78d8fb8/awgn_replicates/replicate-7/awgn.json` (HEAD build, `--replicate 7`)

| SNR (dB) | −26 | −25 | −24 | −23.5 | −23 | −22.5 | −22 | −21 | −20 |
| :--- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Published decoded (dups dropped) | 0 | 0 | 9 (1) | 52 (1) | 92 | 149 | 187 | 200 (1) | 200 |
| QA decoded (dups dropped) | 0 | 0 | 9 (1) | 52 (1) | 92 | 149 | 187 | 200 (1) | 200 |
| Result | MATCH | MATCH | MATCH | MATCH | MATCH | MATCH | MATCH | MATCH | MATCH |

- **Crossings:** 50% at −22.92982456140351, 90% at −22.092105263157894, identical to the published file.
- **Seed block:** identical, including `suite_seed` 1970324857235422, `replicate` 7 and `published_seed` false. The `not_the_published_run` text is also identical.
- **`compare_results.py`:** IDENTICAL.

**Pooled and spread figures, recomputed from the 11 published files** (replicate 0 plus
replicates 1–10), using a re-implementation of `suite.rs::crossing` and `wilson`. Each file's
own crossing was checked against it to 1e-12.
- Pooled over 2200 frames per point: 50% at −23.0032 [−23.0394, −22.9632] and 90% at −22.0873 [−22.1215, −22.0520]. This matches the published −23.00 [−23.04, −22.96] and −22.09 [−22.12, −22.05].
- Across the 11 runs the 50% crossing has mean −23.0024 and sd 0.0482, range −23.0672 to −22.9298. The 90% crossing has sd 0.0681.
- Across the ten replicates alone, the 50% crossing has mean −22.9991 and **sd 0.0496**. See QA-05.

## Loose files

**`perf_k.txt`**, rerun at `83b1b70` with `--frames 20`:

| K / threads | Published decoded, found | QA decoded, found | Published alloc/slot | QA alloc/slot | Result |
| :--- | :--- | :--- | --: | --: | :--- |
| 1 / 4 | 20, 20/20 | 20, 20/20 | 20501 | 20389 | counts MATCH, alloc DIFFER |
| 1 / 1 | 20, 20/20 | 20, 20/20 | 2903 | 2903 | MATCH |
| 5 / 4 | 100, 100/100 | 100, 100/100 | 27387 | 27177 | counts MATCH, alloc DIFFER |
| 5 / 1 | 100, 100/100 | 100, 100/100 | 4105 | 4105 | MATCH |
| 20 / 4 | 400, 400/400 | 400, 400/400 | 29240 | 28694 | counts MATCH, alloc DIFFER |
| 20 / 1 | 400, 400/400 | 400, 400/400 | 5790 | 5790 | MATCH |
| 50 / 4 | 1000, 1000/1000 | 1000, 1000/1000 | 43480 | 43690 | counts MATCH, alloc DIFFER |
| 50 / 1 | 1000, 1000/1000 | 1000, 1000/1000 | 10440 | 10440 | MATCH |

- **Latency, throughput and CPU s/slot:** not reproducible on this shared, loaded host, so they were not compared. On the loaded host, K = 50 on 4 threads had p99 2846 ms against the published 863 ms. Treat that number as a symptom of the load, not as evidence against the published figure.
- **Allocations with 4 threads:** they vary with rayon scheduling (QA-07). The single-thread allocation counts reproduce exactly.

**`false_decodes_2000.txt`**, rerun at `2f6519c` with `--frames 2000`:
- **All counts identical.** That includes every 200-slot checkpoint (13413, 26770, …, 133911 LDPC attempts, 0 false each), 100000 candidates, gate off 0 in 133911 (upper bound 2.24e-5), and production 0 in 1130 attempts (upper bound per slot 1.50e-3). A `diff` with the timings stripped is empty.
- **HEAD check:** the 200-slot prefix at HEAD gives the same 13413 gate-off attempts and 114 production attempts, 0 false. That was checked only for the first 200 slots.

**`awgn_paired_200` and `whitening_ab_200`:** not rerun (see "Not reproduced"). Their provenance was checked; see QA-01.

## Provenance checks

| File | `git_commit` | Dirty | rustc | Seed | `RxConfig` | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 672cef9b3cdb/*.json (10 files) | 672cef9b3cdb | no `-dirty` suffix | 1.98.1 | suite_seed 20260830, published_seed true | default; identical string in the QA build | OK. QA provenance differs only in `built`, `started_utc`, `elapsed_s`, `rustc` |
| 18fbd78d8fb8/awgn.json | 18fbd78d8fb8 | clean | 1.98.1 | 20260830, replicate 0 | default | OK |
| 18fbd78d8fb8/…/replicate-1..10 | 18fbd78d8fb8 | clean | 1.98.1 | 20260830 ^ (r<<48) for each r (checked), published_seed false, `not_the_published_run` present | default | OK |
| d8983eeef66e/*.json | d8983eeef66e | clean | 1.98.1 | 20260830 (older seed block without `published_seed`) | default | OK. `fading.json` is correctly marked withdrawn in the README |
| awgn_paired_200.{txt,json} | txt `@ 83b1b70`, json `git: 73ce0f9` | not recorded | not recorded (README says 1.94.1) | 20260830 | `rx_overrides {}` | **Inconsistent (QA-01)** |
| whitening_ab_200.{txt,json} | txt `@ 73ce0f9`, json `git: 0ab6cf0` | not recorded | not recorded | 20260830 | arm B `{"whiten": false}` | **Inconsistent (QA-01)** |
| perf_k.txt, false_decodes_2000.txt | not recorded in the files | not recorded | not recorded | fixed in code (`rng(7+i)`, `rng(0xF00D+s)`) | default | **No embedded provenance (QA-02)** |

> Note on "no `-dirty` suffix": RES-03 (research record) shows `build.rs` can omit `-dirty`
> for an unstaged edit in a dependency crate, so the suffix's absence is weaker evidence than it
> looks. The bit-identical reproduction from clean worktrees is the stronger evidence here.

**Toolchain:** the published files were built with rustc 1.98.1 and the QA builds with rustc
1.95.0 (MSRV). Every count, rate, interval and crossing checked is bit-identical across the two
compilers. This is positive evidence for the determinism invariant (on one ISA; see RES-09).

## SUMMARY.md checks

- **`672cef9b3cdb`:** the regenerated summary is byte-identical to the committed `SUMMARY.md`. The summary regenerated from the QA run (awgn and fading only) matches the committed AWGN and fading sections line for line, ignoring only the provenance line and the latency column. The `docs/benchmarking.md` AWGN table matches all 9 rows.
- **`d8983eeef66e`:** differs by one line; see QA-03.
- **`18fbd78d8fb8`:** has no committed `SUMMARY.md`; see QA-04.

## Findings

- **QA-01 (Medium, provenance).** The paired-harness files record the checkout HEAD at run time, not the commit of the wheel under test, and the same run records two different commits.
  - `awgn_paired_200.txt` header: `vNext 0.9.0 @ 83b1b70`; `awgn_paired_200.json` `.git`: `"73ce0f9"`.
  - `whitening_ab_200.txt` header: `vNext 0.9.0 @ 73ce0f9`; `whitening_ab_200.json` `.git`: `"0ab6cf0"`.
  - Cause: `research/paired_receiver.py` calls `_git()` (`git rev-parse --short HEAD` of the checkout) once for the header (line 136) and again for the summary (line 177). Commits landed during the ~18-minute runs.
  - Neither file records the wheel's commit (`z30_version` is only `"0.9.0"`), a dirty flag or the rustc version. The attribution to `83b1b70` rests on README prose only. By contrast, the suite's JSON is self-certifying on this point. (Same as RES-11.)
- **QA-02 (Low–Medium, provenance).** `perf_k.txt` and `false_decodes_2000.txt` contain no commit, toolchain, dirty flag or seed. Each was committed in the commit it is attributed to (`83b1b70` and `2f6519c`), so the producing binary was built from a pre-commit tree that cannot be verified. The QA rerun at those commits reproduces every count exactly (all false-decode figures, the perf decode/found counts and single-thread allocations), so the figures do belong to those commits' code. The README table does not name the commits for these two files; it says only "kept with the commit it was measured at".
- **QA-03 (Low).** The committed `research/results/d8983eeef66e/SUMMARY.md` is not what the current `summarize_suite.py` produces. Line 218 reads `| Preset | Delay / Doppler | 50% crossing |`; regeneration gives `| Preset | Delay / Doppler spread (2 sigma) | 50% crossing |`. The header changed in `b75f773`. No number differs. (Same as DOC-34 / RES-12.)
- **QA-04 (Low).** `research/results/18fbd78d8fb8/` has no `SUMMARY.md`. AGENTS.md §3 lists one per `research/results/<commit>/`, although the README describes this directory only as JSON. `summarize_suite.py` runs on it without error.
- **QA-05 (Low, wording).** The 0.048 dB standard deviation is the sd over **11** runs (the published run plus 10 replicates). Over the ten replicates alone it is 0.0496 dB. `AGENTS.md` §5 ("Its run-to-run sd over ten disjoint replicates is 0.048 dB") and `docs/benchmarking.md` lines 85–88 attribute the 11-run sd to the ten replicates. `audit/2026-09-24-corrective-remediation/FINAL_AUDIT.md` line 294 labels it correctly ("11 runs … sd 0.048"). README.md line 66 says "0.05 dB", which holds under either definition. (Same as DOC-17.)
- **QA-06 (Info).** The README credits `awgn_paired_200` to rustc 1.94.1, which is below the declared MSRV of 1.95. That was probably the toolchain before the MSRV was declared; it cannot be checked (QA-01).
- **QA-07 (Info).** In `perf_k.txt`, the 4-thread `alloc/sl` column does not reproduce: 20501/27387/29240/43480 published against 20389/27177/28694/43690 in QA. Heap allocations under rayon depend on work-stealing, so this column is not a deterministic measurement. The file should say so, or report only the single-thread allocations, which reproduce exactly (2903/4105/5790/10440).

## Not reproduced, and why

- **`awgn_paired_200` and `whitening_ab_200`:** these need numpy, maturin, a z30-py wheel built at `83b1b70` and the frozen oracle. numpy and maturin were not installed, and the ~18-minute run (1098 s on an idle host) would have pushed past the 60–90 minute budget. Provenance only (QA-01).
- **`672cef9b3cdb`, other benchmarks:** `snr`, `drift`, `timing`, `clock`, `impair`, `busy`, `false` and `sic` were not rerun (together about 40 minutes on an idle host). They are only cross-checked as IDENTICAL between the published `d8983eeef66e` and `672cef9b3cdb` files. That shows two published runs agree; it is not an independent rebuild.
- **Replicates:** replicates 1–6 and 8–10 were not rerun, and the full `z30 --benchmark suite` was not run as one job.
- **`perf_k.txt`:** the latency, throughput and CPU figures were not reproducible on the shared, loaded host.
- **Fading at HEAD:** not run. The receiver and channel crates are identical to `672cef9`, and HEAD AWGN is identical.

## Cleanup

All four worktrees were removed with `git worktree remove --force` and pruned. `git worktree
list` shows only the main checkout, and `git status --porcelain` in it was empty.
