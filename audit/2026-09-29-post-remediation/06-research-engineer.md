# Research-engineer review: F-11 (per-frame outcomes) and F-14 (results routing)

**Commit reviewed:** `38e43c677d91875dad8291fba2f275b19968e712` (branch `claude/nice-archimedes-epwg4o`, PR #46). I worked in a detached worktree at `/tmp/claude-0/review-re` with `CARGO_TARGET_DIR=/tmp/claude-0/review-re-target`. Nothing in `/home/user/z-30` was edited, and nothing was written under the real `research/results/`.

All measurements here are software simulation; nothing was measured on real hardware. No radio, PTT or sound card was involved.

## Verdicts

| Row | Verdict | In one line |
|---|---|---|
| **F-11** per-frame outcomes and `paired_mcnemar.py` | **VERIFIED**, with one Medium follow-up | Pairing works end to end; the files are identical at 1 and 2 threads; every mismatch I tried is refused (exit 2); the McNemar, Holm, pooled and crossing figures match my hand arithmetic. §2a's "replicates 0–4" design can't be run with this tool (finding 1). |
| **F-14** results routing | **VERIFIED** | A replicate goes to `<commit>/replicates/rN`. An exploratory run goes to `exploratory/<commit>`. A dirty run goes to `unpublished/…`. Writes into a published directory are refused, and the published file was byte-identical afterwards. The only bypass is a symlink (finding 5), and the summariser then refuses the mixed directory. |

## Commands and outputs

**Build**
```
cargo +1.95 build --release --locked -p z30-cli   -> Finished release in 3m01s
z30 --version  -> commit: 38e43c677d91 (no -dirty), rustc 1.95.0
```

**Tests**
```
python3 -m pytest research/tests -q                                -> 28 passed in 3.12s
cargo +1.95 test --release --locked -p z30-cli -- suite            -> 11 passed (suite::tests::*, incl.
    replicates_and_exploratory_runs_are_routed_away_from_the_published_file,
    nothing_overwrites_a_published_result, a_dirty_build_never_gets_the_published_directory,
    replicates_share_no_frame_with_each_other_or_the_published_run)
cargo +1.95 test --release --locked -p z30-cli --test suite_output -> 3 passed
```

**End-to-end run.** Exploratory: 20 frames per point, below 200. AWGN, suite seed 20260830, replicate 0. Simulation.
```
RAYON_NUM_THREADS=2 z30 --benchmark awgn --frames 20 --per-frame --out .../out-a  -> awgn.json (exploratory, 28 s)
RAYON_NUM_THREADS=1 z30 --benchmark awgn --frames 20 --per-frame --out .../out-b  -> awgn.json (exploratory, 52 s)
cmp out-a/awgn.frames.jsonl out-b/awgn.frames.jsonl  -> IDENTICAL-across-thread-counts
python3 research/paired_mcnemar.py out-a/... out-b/... --bootstrap 2000 --bootstrap-seed 7
  NOTE: the baseline is EXPLORATORY ... NOTE: the candidate is EXPLORATORY
  9 points, b = c = 0 everywhere; pooled n 180, p = 1; crossing -22.9 both, delta 0.0, 95% [0.000, 0.000]; exit 0
```

**Refusal tests.** Each is a mutated copy of `out-b`, paired against `out-a`. All exit 2.
```
drop one frame      -> the frame sets differ: 1 only in the baseline
header suite_seed   -> headers differ in suite_seed
header replicate    -> headers differ in replicate
frames_per_point    -> headers differ in frames_per_point
instrument_sha256   -> headers differ in instrument_sha256
dirty candidate     -> built from a dirty tree; pass --allow-dirty   (with the flag: exit 0, "candidate is DIRTY")
condition / x       -> frame (...): condition differs / x differs
duplicate frame     -> recorded twice
one frame's seed    -> the frame sets differ: 1 only in the baseline, 1 only in the candidate
no header / 2 hdrs  -> no header line / a second header
benchmark           -> headers differ in benchmark
```

**Statistic checked by hand.** I made a synthetic candidate: point 4 (−23 dB) gains 7 frames and loses 1; point 5 (−22.5 dB) gains 5.
```
4  AWGN -23.0 dB  20   9  15  1  7   0.0703   0.562
5  AWGN -22.5 dB  20  14  19  0  5   0.0625   0.562
pooled: n 180, b 1 : c 12, exact two-sided p = 0.00342
crossing awgn: baseline -22.9, candidate -23.25, delta -0.350; paired bootstrap 95% [-0.719, -0.033]
```
- **Exact McNemar.** b=1, c=7: 2·(C(8,0)+C(8,1))/2⁸ = 18/256 = 0.0703125 ✓. b=0, c=5: 2/32 = 0.0625 ✓. b=1, c=12: 2·14/8192 = 0.003418 ✓. b=2, c=9: 2·67/2048 = 0.06543 ✓. b=c=3 is capped at 1 ✓.
- **Holm, m=9.** 0.0625×9 = 0.5625 and 0.0703×8 = 0.5625, so after the running max both are 0.5625 ✓. The rest are 1 ✓. Separately, `holm([.01,.04,.03,.5])` gives [0.04, 0.09, 0.09, 0.5] ✓, the textbook step-down.
- **Crossings.** Baseline: −23 + (5/25)·0.5 = −22.9 ✓. Candidate: −23.5 + (25/50)·0.5 = −23.25 ✓.

**Routing (F-14).** Run in a scratch tree `routing/` holding a fake published `research/results/38e43c677d91/awgn.json` (sha256 b4e08399…).
```
snr --replicate 1                       -> research/results/38e43c677d91/replicates/r1/snr.json (replicate)
snr --frames 5                          -> research/results/exploratory/38e43c677d91/snr.json (exploratory)
snr --frames 5 --out research/results/38e43c677d91                          -> refusing ... exploratory
snr --frames 5 --replicate 1 --out research/results/38e43c677d91/replicates/r1 -> refusing ... exploratory
snr --frames 5 --overwrite --out ./research/../research/results/38e43c677d91 -> refusing ... exploratory
awgn.json sha256 afterwards: b4e08399... (unchanged)
.gitignore ignores /research/results/exploratory/ and /research/results/unpublished/
```
The `exploratory` and `unpublished` directory names can never be mistaken for a commit directory (`is_commit_dir` accepts only hex, `suite.rs:158`).

## Findings

1. **Medium: §2a's replicate set can't be paired with this tool.** `docs/research-process.md:101-104` vs `research/paired_mcnemar.py:76,91`.
   - §2a suggests pre-registering "replicates 0–4, 1000 frames per point".
   - `check_headers` requires the same `replicate` on both sides, and `read_frames` refuses a second header. So the tool can only give five separate 200-frame McNemar tests, not the pooled 1000-frame test and bootstrap that §2a describes.
   - Failure scenario: an experimenter follows §2a and either reports five underpowered tests or hand-merges the files. Hand-merging loses the fail-closed checks.
   - The only route the tool supports is `--frames 1000` at replicate 0, and that has the trap in finding 8.
   - Fix one or the other: let the tool accept several matched replicate pairs (refusing any mismatch in each), or change §2a's example. §2a is not yet in force (board pending), so this blocks §2a, not the F-11 fix.

2. **Low–Medium: the Holm family is every point in the file, not the pre-registered points.** `paired_mcnemar.py:200`.
   - There is no way to restrict the analysis to the proposal's points (e.g. §2a's "awgn −24…−22 dB", 5 of the 9 suite points).
   - Adding hypotheses never lowers Holm-adjusted p-values, so the error is conservative. But it is not the statistic the rule names, and it can turn an "accept" into a "reject".
   - Until a points option exists, recompute Holm over the pre-registered points from `--json`'s per-point `mcnemar_exact_p`.

3. **Low: busy-benchmark pairs are clustered.** `crates/z30-cli/src/suite.rs:812-818`.
   - `busy` writes one record per (slot, station), and the K stations share one slot's audio and decoder run.
   - McNemar assumes independent pairs, so busy p-values come out too small.
   - A busy result should be reported as clustered, or as a per-slot test.

4. **Low: false decodes are not summarised by the pairing tool.** `paired_mcnemar.py:115-121`; `suite.rs:944-946`.
   - Only `correct` is paired. For `false`, `correct` means the slot stayed silent, so a candidate that adds a false decode to a slot that already had one is invisible to McNemar.
   - The per-frame `false_decodes` field is written but ignored.
   - The results note's "false decodes first" has to come from the aggregate `false.json` and its Clopper–Pearson bound, not from this tool.

5. **Low: a symlink bypasses the routing.** `suite.rs:163-196` (`lexical_absolute` / `published_tree` do not resolve symlinks).
   - Demonstrated: `ln -s research/results/38e43c677d91 link; z30 --benchmark timing --frames 2 --per-frame --out link`. This wrote an exploratory `timing.json` and `timing.frames.jsonl` into the published commit directory.
   - It cannot overwrite a published `.json`, because `is_published_file` reads the target.
   - A `*.frames.jsonl` there could be replaced with `--overwrite` when its `.json` is absent: `check_writable` protects `.jsonl` only through the lexical path check, `suite.rs:244-256`.
   - Mitigation: the file says `status: exploratory`, and `summarize_suite.py --partial` then refuses with "status differs (awgn=published, timing=exploratory)".
   - Fix: canonicalise the existing ancestor before the check.

6. **Low: malformed input is not always refused.** `paired_mcnemar.py:79-84,111,175-187`.
   - `"correct": "false"` (a string) counts as success: demonstrated, pooled went from 0:0 to b 0 : c 1.
   - A missing `correct` crashes with `KeyError` (exit 1, a traceback) instead of a refusal (exit 2).
   - `--json --allow-dirty` crashes with `ValueError`.
   - `--bootstrap=N` is silently ignored.
   - Per-point frame counts are not checked against the header's `frames_per_point`: two files with 10 of the declared 20 per point paired without complaint.
   - Risk is low because the files are machine-written. The fix is to check `isinstance(correct, bool)`, check counts against the header, and reject unknown flags.

7. **Info: this PR's own change can't be frame-paired against its baseline.**
   - `main` (7661caa, the merge base) has no `--per-frame` and no `paired_mcnemar.py`. The first commit usable as a frame-level baseline is the merge of this PR.
   - By design, any candidate that touches an instrument file (`suite.rs`, `bench.rs`, `z30-channel`, protocol codec/crc/ldpc/symbols/gfsk) is refused on `instrument_sha256` and needs a re-baselined proposal. `z30-dsp` is correctly outside the instrument (`build_support.rs:438`).

8. **Info: an oversized published-seed run takes the published slot.** `suite.rs:130-139`.
   - A clean replicate-0 run with `--frames` ≥ the publishable size and no `--out` (e.g. `--frames 1000` for power) is `published` and lands in `research/results/<commit>/<name>.json`.
   - After that, the standard 200-frame run for that commit is refused (file exists), and `compare_results.py` refuses it against a 200-frame baseline.
   - A proposal should send such runs elsewhere with `--out`; they are then labelled `not_the_published_run`.

## Answers to the four questions

- **Can two commits be compared from the per-frame files?** Yes, when both binaries have `--per-frame` (any commit after this merges) and the same instrument hash. The pairing key (benchmark, point, frame, station, seed) is the same audio on both sides. The files are deterministic across thread counts.
- **Does the tooling refuse what it should?** Yes, for every mismatch that matters: seed, replicate, size, instrument, benchmark, frame set, condition or x, duplicates, and dirty without the flag. The gaps are malformed input (finding 6) and the symlink (finding 5).
- **Is the statistic right?** Yes. The exact binomial McNemar, the Holm step-down, the pooled test and the crossing interpolation all match hand arithmetic. The caveats are the Holm family (finding 2) and the busy clustering (finding 3).
- **Can a replicate or exploratory run land in, or replace, `research/results/<commit>/`?** Not through any path the tool sees as written. Replicates go only to that commit's own `replicates/rN/`, and published files are never replaced. A symlink can add, but not replace, a labelled exploratory file (finding 5).

## Files

- Worktree, left in place: `/tmp/claude-0/review-re`. The paired runs are in `out-a/` and `out-b/`, the synthetic mutations in `mut/`, the routing scratch tree in `routing/`, and the pairing JSON in `out-ab.json`.
- Code reviewed: `/home/user/z-30/research/paired_mcnemar.py`, `/home/user/z-30/crates/z30-cli/src/suite.rs`, `/home/user/z-30/crates/z30-cli/tests/suite_output.rs`, `/home/user/z-30/docs/research-process.md`.
