# Research-process review — the research record and the benchmark instrument

> Produced by the `research-engineer` agent (`.claude/agents/research-engineer.md`), 2026-09-28.
> Evidence for the board, not a board decision. Review only: no candidate change exists, so no
> paired suite was run; the receiver and the repository were not modified.

**Repository:** themantas1994/z-30 at `caf1a9a` (branch `claude/fervent-cray-riehln`, identical to `main`)
**Role:** research engineer (docs/research-process.md §1–2).
**Date:** 2026-09-28
**All of this is software simulation. No radio, sound card or RF path was involved, and nothing was keyed.**

Method: read docs/research-process.md, docs/benchmarking.md, AGENTS.md §4–5,
VNEXT_IMPLEMENTATION_PLAN.md, research/results/README.md, every file under research/results/,
research/paired_receiver.py, research/summarize_suite.py, crates/z30-cli/src/{suite.rs,bench.rs,build.rs,main.rs},
the CI benchmark jobs, and the audit items. Figures were recomputed from the result JSON. Four
small exploratory commands ran with the prebuilt HEAD binary (`z30 0.9.0`, commit
`caf1a9a1959a`, clean, rustc 1.95.0, release). The machine was shared and loaded, with load
average 9–19 on 4 CPUs.

---

## 0. Summary

- **None of the existing results was produced under the research process.** The process was merged on 2026-09-26 (`3374f9f`), and every result is from 2026-09-23/24. The VNEXT plan's gates G2.2–G2.7 are the nearest thing to a pre-registered rule. They set sample sizes and targets, but no effect size or margin.
- **The published suite at `672cef9b3cdb/` holds up.** It has clean provenance and Wilson/Clopper–Pearson intervals. Its SUMMARY.md regenerates byte-identical. `compare_results.py` d8983ee→672cef9 still reports nine benchmarks IDENTICAL and fading DIFFERENT. The pooled AWGN replicate figure reproduces from the JSON to the last digit.
- **The instrument cannot yet support the process it is meant to serve:**
  - **RES-01:** no per-frame outcomes are recorded, so a McNemar test between two commits cannot be computed.
  - **RES-02:** the candidate branch compiles its own instrument.
  - **RES-03:** `build.rs` can label a binary built from modified source as a clean commit. Demonstrated below.
  - **RES-04:** a replicate run silently overwrites the published-seed file, and the summary does not flag it. Demonstrated below.
- **Loose results carry weak or no provenance.** `perf_k.txt` has no commit and was never re-measured after the receiver changed at `d8983ee`. Its p99 over 20 slots is the maximum. Every `*.log` file the corrective audit cites as evidence was dropped by `.gitignore`.

---

## 1. The research record

Legend for the compliance column: **Rule** = pre-registered decision rule; **Pair** = paired baseline from the same commit family; **McN** = exact McNemar where it compares; **CI** = Wilson / crossing / Clopper–Pearson intervals; **≥200** = at least 200 frames behind each crossing; **F+P** = false-decode and perf runs on both sides; **Prov** = clean-tree provenance in the file.

| Item | What it claims | Process compliance | Gaps |
| :--- | :--- | :--- | :--- |
| `research/results/672cef9b3cdb/` (10 JSON + SUMMARY.md) | The current published suite. AWGN 50% at −23.03 dB [−23.13, −22.89] and 90% at −22.06 dB [−22.15, −21.80], 200 frames/point, seed 20260830. Plus snr, drift, timing, clock, impair, busy, false, sic and fading (corrected Doppler). | **Rule:** no (predates the process; G2.2/G2.4/G2.6 give sizes only). **Pair:** not a comparison. Against d8983ee it is a same-seed reproduction: re-verified today, 9 IDENTICAL and fading DIFFERENT (65 fields), which is expected because the channel model changed. **McN:** n/a, except sic, which is paired in one binary. **CI:** yes; a zero false count carries the Clopper–Pearson bound 1.50e-3 per slot. **≥200:** yes for awgn and fading. snr (100/point) and sic (100/cell) are not crossings: allowed by process §2, but exploratory by the 200-per-point brief. **F+P:** false yes; **perf never run at this commit**. **Prov:** clean `672cef9b3cdb`, rustc 1.98.1, Xeon @ 2.10 GHz, 4 rayon threads, RxConfig Debug string. SUMMARY.md regenerates byte-identical. | No perf at this commit. No per-frame outcomes (RES-01). docs/benchmarking.md re-formats the drift, timing, clock and impair tables by hand (latency column dropped, drift turned into a matrix, timing into prose), so they are not literally "pasted". Every drift, timing, clock and impair percentage was spot-checked against the JSON and all match. |
| `research/results/d8983eeef66e/` | The first suite. Fading is withdrawn (1/√2 Doppler, N-01). | Same as above. `seed.published_seed` is absent (older schema). | **SUMMARY.md has no withdrawal marker**; only README.md says so. **Regenerating it with the current summarizer changes one line**: the fading header becomes "Delay / Doppler spread (2 sigma)". That label is false for the withdrawn model, which ran at spread/√2. |
| `research/results/18fbd78d8fb8/` (awgn.json replicate 0 plus `awgn_replicates/replicate-1…10`) | Run-to-run sd of the 50% point is 0.048 dB. Pooled over 2200 frames/point: 50% at −23.00 dB [−23.04, −22.96], 90% at −22.09 dB [−22.12, −22.05]. | **Rule:** none needed (variance study, not a comparison). All ten replicates are reported, and the flawed `--seed` runs are kept and labelled. **CI:** yes. **≥200:** yes. **Prov:** clean `18fbd78d8fb8` (replicates_binary_version.txt). Replicate 0 counts equal `672cef9b3cdb/awgn.json` (re-verified). | **Recomputed from the JSON:** replicates 1–10 span −23.067 to −22.930 dB. Pooled 50% −23.003 [−23.039, −22.963], 90% −22.087 [−22.122, −22.052]: this matches. **But sd 0.048 dB is over 11 runs** (published + 10; `awgn_replicate_analysis.json` has `n_runs: 11`). Over the ten replicates alone it is 0.0496 dB (90%: 0.0715, quoted as 0.068). docs/benchmarking.md:85–87 and AGENTS.md §5 both say "ten". **No SUMMARY.md exists in this directory**, and the pooled figure quoted in AGENTS.md §5 comes from `audit/…/analyse_awgn.py`, not from `research/` tooling. |
| `awgn_paired_200.{txt,json}` (loose, top level) | Oracle vs vNext on the same buffers. vNext 50% −23.01 [−23.18, −22.86], oracle −22.92 [−23.07, −22.79]. Discordant 34 : 17, McNemar p = 0.024. "vNext not worse." | **Rule:** G2.2 says "paired non-inferiority at 200 frames/point" but **sets no non-inferiority margin**. p = 0.024 is a two-sided superiority test, so "not worse" is descriptive, not the outcome of a non-inferiority test. **Pair:** yes (same audio). **McN:** yes, pooled over 12 points. **CI:** yes. **≥200:** yes. **F+P:** false counted per arm (0/0). Latency is indicative only (4 worker processes). No perf comparison. **Prov:** weak (next column). | **The commit disagrees between the two files:** the txt header says `@ 83b1b70`, the JSON `"git"` says `73ce0f9`. `_git()` reads the *checkout's* HEAD at start (paired_receiver.py:136) and again at the end (:177), and HEAD moved during the 1099 s run. Neither records the commit the `z30` wheel was built from (`z30.version()` returns only "0.9.0"), a dirty flag, rustc or RxConfig. The receiver has changed since: at `d8983ee`, `slot.rs` now places the SIC start with a replica fit. The README argues this cannot move single-station frames; that is plausible but has not been re-measured. The oracle arm is genie-windowed (documented). |
| `whitening_ab_200.{txt,json}` (loose) | Whitening on vs off: 0 discordant of 1000, p = 1, "costs nothing on AWGN". | **Rule:** none (no gate). **Pair:** yes, one binary with an RxConfig override. **McN:** yes. **CI:** yes. **≥200:** yes. **F+P:** false yes (0); CPU cost of whitening not measured. **Prov:** txt `@ 73ce0f9` vs JSON `0ab6cf0` (same defect). | AWGN is the channel least able to show a per-tone interference whitener's effect. The result is correctly scoped ("on AWGN"), but "costs nothing" can be read as CPU, which was not measured. There is no busy-band or CW A/B, which is the whitener's purpose. |
| `false_decodes_2000.txt` (loose) | Gate off: 0 false decodes in 133,911 LDPC attempts (Clopper–Pearson 95% upper bound 2.24e-5 per attempt). Production: 0 in 2000 slots (1.50e-3 per slot). | **Rule:** G2.4 ("≥100k noise candidates with an interval"): met (100,000 candidates). **CI:** the bound is correct (recomputed 2.2371e-5). **Prov:** **none in the file** (no commit, toolchain or CPU). By git history it is at or before `2f6519c`. | White noise only; the gate-off run has no CW, FSK or impulse content. The per-attempt bound treats attempts within a slot as independent, so the per-slot bound is the defensible figure. **Exploratory reproduction at HEAD** (below): the first 200 slots give exactly the file's first progress line, 13,413 attempts and 0 false, so the gate-off path is unchanged for those slots. |
| `perf_k.txt` (loose) | K = 50: p99 863 ms on 4 threads (meets < 1 s), 2525 ms on 1 thread (misses ≤ 2 s, inside the 4.5 s budget). Presented in docs as the current G2.7 status. | **Rule:** G2.7 target only. **Pair / F+P:** one side only. **CI:** none. **Prov:** **none in the file**. By git history it is `83b1b70`; README gives the host as "Xeon @ 2.80 GHz", not the suite's 2.10 GHz host. | **p99 over 20 slots is the maximum**: p99 == max in all 8 rows, because `pct()` returns index ceil(0.99·20) = 20. **Not re-measured since `d8983ee`**, which added a least-squares replica fit per decode (`placed_replica`, LS SNR) and so plausibly changed CPU and allocations per slot. The docs still present these figures as current. |
| OSD fixed vs legacy (G2.3), docs/ldpc.md:75–78 and benchmarking.md:336 | 4000 frames, 3004 BP failures, 7 recovered by each rule, 0 discordant. | **Pair:** yes by description. **McN:** implied p = 1. | **No result file** in research/results or audit/ (grep). Reproducible only through `screen_osd_pool` / `OSD_POOL_INDICES` in reference/golden/generate.py, with no recorded output. |
| `audit/2026-09-24-corrective-remediation/evidence/benchmark_provenance/` | A deliberately weakened decoder (LDPC 45 → 5 iterations) moves the benchmark. | Correctly labelled: exploratory (50 frames) and dirty (`672cef9b3cdb-dirty`). | This is a good control. Proposal P1 reuses it. |
| Evidence logs cited by the corrective audit | `suite_run.log`, `pipeline.log`, `replicates*.log`, `awgn_replicate_*.log`, `awgn_seed_*.log`, `evidence/final/release_artifact_checks.log`, `evidence/baseline/mutation_survivors_baseline.log` (19 distinct `.log` names across audit/) | Not applicable. | **None of them is in the repository.** `git ls-files audit \| grep -c '\.log$'` returns 0, and `git check-ignore` points to `.gitignore:6 *.log`. The evidence index (`evidence/README.md`) and FINAL_AUDIT.md cite files that do not exist. |
| Loose files at the `research/results/` root generally | "Earlier instruments" | Not applicable. | Outside any `<commit>/` directory. No machine-readable provenance for perf and false-decodes. Two different commit hashes per paired file. They should move to `research/results/legacy-instruments/<commit>/` with a provenance note, and the existing files should not be edited. |

Exploratory runs (HEAD binary `caf1a9a1959a`, clean, rustc 1.95.0; loaded machine; **all exploratory; simulation; not measured on real hardware**):
- `z30 --benchmark false-decodes --frames 200`, white noise, seeds 0xF00D+s:
  - gate off: 0 false in 13,413 LDPC attempts (95% upper bound 2.23e-4 per attempt), identical to the first line of `false_decodes_2000.txt`;
  - production: 0 false in 200 slots (114 LDPC attempts; 95% upper bound 1.49e-2 per slot).
- `z30 --benchmark perf --frames 5` at load average 17–19:
  - K = 50, 4 threads: max 4336 ms; K = 50, 1 thread: max 4001 ms.
  - Allocations per slot, 1 thread: 3026 / 4422 / 7169 / 14413 at K = 1/5/20/50, against 2903 / 4105 / 5790 / 10440 in perf_k.txt.
  - The slot sets differ (these 5 slots are a subset of the 20), and latency under this load is meaningless. **Nothing is concluded from this.** It only shows why a paired perf run at `83b1b70` vs HEAD on identical slots is needed.
- `z30 --benchmark awgn --frames 20 --replicate 1`: used as the RES-04 demonstration.

---

## 2. Instrument findings

### RES-01: No per-frame outcomes, so a paired comparison across two commits cannot be computed. **High**
- **Where:** `crates/z30-cli/src/suite.rs:250–266` (`point_json` aggregates), `:779–781` (only aggregates are written). There is no per-frame output anywhere in the suite.
- **Evidence:** research-process §2 requires "candidate and baseline decode the same audio; report the exact two-sided McNemar p-value over the discordant frames". The suite's frames are seed-identical across commits, but only per-point counts are kept, so the discordant frames are lost. The only paired tools are:
  - `sic`, which pairs two RxConfigs inside one binary (`:657–668`);
  - `paired_receiver.py --arm-b`, which can toggle only the knobs `z30-py` exposes (`crates/z30-py/src/lib.rs:40–80`).
  So any change to receiver *code* cannot be paired with repository tools.
- **Fix:**
  - Write `<name>.frames.json` next to each JSON: per point, per frame index, the success bit, the false count and the decode method.
  - Add `research/pair_results.py <baseline_dir> <candidate_dir>`. It refuses to pair unless the seeds, frame counts and instrument identity (RES-02) match, and reports per-point and pooled discordant counts, the exact McNemar p-value, and a paired frame-bootstrap CI of each crossing delta.

### RES-02: The candidate measures itself with its own instrument. **High**
- **Where:** the whole harness is compiled from the candidate's tree:
  - SNR grids: suite.rs:288, 314, 349–350, 368, 384, 500, 644–646, 699–703;
  - placement: :203–208;
  - success and false criteria: :192–199;
  - seed rule: :211–213;
  - default sizes: :751–760;
  - channel: `z30-channel`, including Watterson and noise;
  - waveform: `z30_protocol::gfsk::Modulator`.
  The provenance (`:130–150`) records no identity for any of these.
- **Evidence:** a branch that edits `suite.rs` (for example, one SNR point or the placement range) produces a JSON that differs from the baseline in no field that names the instrument. Only a reviewer reading the diff would notice. `compare_results.py` ignores `channel` and `seed` (`IGNORE`, compare_results.py:8).
- **Fix:**
  - `build.rs` embeds the git blob/tree ids of `crates/z30-cli/src/suite.rs`, `crates/z30-channel/`, `crates/z30-protocol/src/gfsk.rs` and `Cargo.lock` as `provenance.instrument`.
  - `pair_results.py` refuses mismatched instruments.
  - CI labels any PR that touches those paths as an instrument change, which needs its own proposal and a re-baseline.

### RES-03: `build.rs` can label a binary built from modified source as a clean commit. **High**
- **Where:** `crates/z30-cli/build.rs:15–16` (dirty check), `:33–34` (the only rerun triggers are `.git/HEAD` and `.git/index`).
- **Evidence:** reproduced with a toy workspace using the same `build.rs` logic:
  - The index had settled after several builds. An **unstaged edit in a dependency crate** (the analogue of `z30-dsp`) was then made and the workspace rebuilt.
  - Cargo recompiled the crate and relinked, but did not rerun the build script. The binary printed `69eade09ecc8 answer=3`: the clean commit label, with the changed behaviour, while `git status` showed ` M crates/dsp/src/lib.rs`.
  - In a `git worktree`, `.git` is a file, so both trigger paths are missing and the script reruns on every build. The label was correct there: `69eade09ecc8-dirty answer=4`.
- **Consequence:** the in-place commands in AGENTS.md §6 and research-process §2 ("Reproduce") are exposed. A tweaked receiver writes its results into `research/results/<clean commit>/` (default_out, suite.rs:167–169) with no `-dirty`, and the warning at suite.rs:741–743 never fires.
- **Fix:**
  - Emit `cargo:rerun-if-changed` for the `crates/` directories and `Cargo.lock` (Cargo checks directories recursively), or embed a hash of `git diff HEAD`.
  - `suite::run` refuses to write into an existing `research/results/<commit>/<name>.json`.
  - `suite::run` refuses the default results path when the commit ends in `-dirty`.

> **Consolidation note.** The CTO review ("Build provenance", in `01-code-review-cto.md`)
> reported the opposite result from its own replica: an unstaged edit after a clean build *was*
> marked `-dirty`. The two experiments differ in whether the index had settled before the edit.
> See the consolidated audit (`README.md`, conflict C-1) for the tie-break.

### RES-04: Replicate and exploratory runs overwrite the published-seed file, and the summary hides it. **Medium-High**
- **Where:** suite.rs:744 (`out` or `default_out()`, whatever the replicate), `:780` (`std::fs::write`, silent overwrite); summarize_suite.py:57–61 (renders only the seed *number*; ignores `not_the_published_run`, `published_seed`, `exploratory`, `rayon_threads` and `decoder_config`).
- **Evidence:** `z30 --benchmark awgn --frames 20 --replicate 1` (run in scratch) wrote `research/results/caf1a9a1959a/awgn.json`, the same path the published-seed run uses. `summarize_suite.py` on it produced a normal-looking table headed "seed 281474996971486". `grep -ci 'exploratory|replicate|not the published'` on the summary returns **0**, although the JSON carries both markers.
  - A candidate could run replicates 1…n, keep the best and regenerate SUMMARY.md. The only visible trace would be a 15-digit seed.
  - The process does not require the replicate range to be pre-registered, or every replicate run to be reported.
- **Fix:**
  - Default replicate output to `research/results/<commit>/replicate-<r>/`.
  - Refuse to overwrite existing results.
  - The summarizer prints a banner for `not_the_published_run`, `exploratory` and `-dirty`.
  - research-process §1 requires the replicate range in the proposal, and §2 requires every replicate run to be reported.

### RES-05: The exploratory threshold disagrees with the process. **Medium**
- **Where:** suite.rs:776–778 marks a run exploratory only when `--frames` < 100. research-process §2 and AGENTS.md §5 put the line at 200 per crossing, and the research-engineer brief at 200 per point.
- **Evidence:** `--benchmark awgn --frames 150` writes an unmarked JSON with a 50% crossing.
- **Fix:** mark crossing benchmarks (awgn, fading) exploratory below 200, and state each benchmark's publishable size in the JSON.

### RES-06: The perf benchmark writes nothing machine-readable, and its p99 is the maximum. **Medium**
- **Where:** bench.rs:53–109 (stdout only, no provenance), `:187` (default 20 slots), `:33–36` (`pct`). `--out` and `--replicate` are silently ignored for perf, false-decodes and sweep (`:185–191`).
- **Evidence:** in `perf_k.txt`, p99 == max in all 8 rows. Nothing records the commit, CPU, rustc or machine load, yet the process asks for p50/p95/p99 on both sides "on the same idle machine".
- **Fix:**
  - Write `perf.json` with the suite's provenance plus the load average and CPU governor at start and end.
  - Use at least 100 slots per K, or report p99 as "n/a (n = 20)".
  - Pair baseline and candidate on identical slots, with per-slot CPU differences and a bootstrap CI.

### RES-07: The false-decode benchmark has too little power for acceptance-affecting changes. **Medium**
- **Where:** the suite's `false` (suite.rs:597–638), 5 × 400 slots. The high-power gate-off instrument (bench.rs:136–166) is text-only, white-noise only, and not part of the process.
- **Evidence:**
  - The pooled bound is 1.5e-3 false decodes per slot, which is about 4.3 per day of continuous monitoring at 2880 slots/day.
  - A candidate with a true rate of 5e-4 per slot shows zero false decodes in 2000 slots with probability e^−1 ≈ 37%.
  - A false decode can drive the auto-sequencer into a transmission.
- **Fix:** any proposal that changes acceptance (OSD, AP, sync or fine-sync thresholds, `max_candidates`) pre-registers a gate-off per-attempt run, including structured interference, with a fixed number of attempts and a bound. Its decision rule includes that bound.

### RES-08: `upper95` underflows for large counts and understates the Clopper–Pearson bound. **Low-Medium**
- **Where:** bench.rs:113–134. `(1-p)^n` underflows once n·p ≳ 745.
- **Evidence:** compared with a log-domain reference:
  - k = 800, n = 1e5 gives 7.42e-3 (true value 8.48e-3);
  - k = 2000, n = 1e4 gives 0.072 (true value 0.207, which is *below the point estimate* 0.2).
  - Every published value has k = 0 and is exact, so no published figure is affected.
  - The only test covers k = 0 (bench.rs:197–200).
- **Fix:** sum in the log domain or use the regularised incomplete beta, and add a test with k > 0 and large n. The function is used by `busy` and `false`.

### RES-09: The provenance cannot support exact reproduction across machines. **Medium**
- **Where:** suite.rs:130–150 records no RUSTFLAGS/target-cpu, no Cargo.lock hash and no CPU SIMD features.
- **Evidence:** rustfft 6.4.1 `FftPlanner::new()` picks AVX, SSE or NEON at runtime:
  - `z30-dsp` baseband.rs:51–52, demod.rs:42, sync.rs:61;
  - `z30-channel` lib.rs:162.
  Float rounding can therefore differ between AVX hosts, non-AVX hosts and arm64 (macOS CI). Near threshold, that can flip frames. The determinism tests cover thread count, not instruction set. Process §3 treats any difference as a finding. This host has avx2, avx512f and fma. **Not tested here.**
- **Fix:** record `is_x86_feature_detected!` for avx, avx2 and fma, the arch, `CARGO_ENCODED_RUSTFLAGS` and the Cargo.lock sha256. Run one cross-ISA reproduction (awgn `--frames 20` on the macOS arm64 runner against x86) to find out whether exactness holds.

### RES-10: `compare_results.py` and the summarizer do not check completeness. **Medium**
- **Where:** compare_results.py:37 (iterates only the *new* directory's files), `:8` (ignores `seed`); summarize_suite.py:19–24 and each `if doc:` (a missing benchmark is skipped silently).
- **Evidence:** a candidate directory that omits `fading` is neither compared nor flagged. A seed or replicate mismatch is not reported as such; only the differing counts show it.
- **Fix:** require all ten benchmarks, compare `seed`, `frames_per_point` and the instrument identity explicitly, and fail loudly on a missing file.

### RES-11: The paired-harness provenance is unreliable. **Medium**
- **Where:** research/paired_receiver.py:98–102, 136, 177; crates/z30-py/src/lib.rs:156–158 (`version()` returns only `CARGO_PKG_VERSION`).
- **Evidence:** both loose paired results carry two different commits (83b1b70/73ce0f9 and 73ce0f9/0ab6cf0). The wheel's own commit, dirty state and toolchain are never recorded. This is currently the only A/B tool for RxConfig knobs.
- **Fix:** have `z30-py` expose `Z30_BUILD_COMMIT` and rustc (reusing `build.rs`), read the commit once at start, and refuse to run from a dirty wheel.

### RES-12: Record hygiene. **Low**
1. `18fbd78d8fb8/` has no SUMMARY.md, and the pooled figure is computed outside `research/`.
2. `d8983eeef66e/SUMMARY.md` has no withdrawal marker, and regenerating it mislabels the withdrawn Doppler column as "2 sigma".
3. The sd "over ten replicates" is actually over 11 runs.
4. Results sit loose at the `research/results/` root.
5. The G2.3 OSD result has no file.

- **Fix:** add a `WITHDRAWN` registry that the summarizer reads, a summarizer mode for replicate sets, and a legacy-instruments directory. Do not edit any existing JSON.

### RES-13: Cited audit evidence is missing because of `*.log` in `.gitignore`. **Medium**
- **Where:** `.gitignore:6`.
- **Evidence:** 19 distinct `.log` names are cited across audit/, and 0 are tracked.
- **Fix:** add `!audit/**/*.log`, and state in each evidence README which logs were lost.

### RES-14: The seed field layout has no bounds check. **Low**
- **Where:** suite.rs:211–213. The frame index occupies bits 0–19, the point bits 20–39 and the benchmark bits 40–47.
- **Evidence:** `--frames` > 1,048,576 would give frame 2^20+i of point p the same seed as frame i of point p^1. The disjointness test (`:820–836`) covers ≤ 400 frames, ≤ 40 points and benchmarks 1–10.
- **Fix:** assert frames < 2^20 in `run()`, and extend the test to any new benchmark id.

### RES-15: No benchmark varies input level or includes the capture/resampler path. **Low (Info)**
- **Where:** every benchmark feeds σ = 1 noise at 6 kHz straight into `decode_slot` (definitions, suite.rs:155; N-12).
- **Evidence:** a change keyed, even accidentally, to absolute level would pass the whole suite. sync.rs:128–132 normalises by the median, so the current receiver is probably scale-invariant. Not verified.
- **Fix:** add ×1e−3 and ×1e3 scale points to `impair`, and a 48 kHz → resampler → 6 kHz point.

### RES-16: The decision-rule template has no statistic for a crossing delta. **Medium (process)**
- **Where:** research-process.md §1. Its example claim is in dB ("moves by ≥ 0.2 dB"), but the prescribed test (McNemar) is on rates. The per-curve interpolated Wilson interval says little about the difference between two strongly correlated paired curves.
- **Power, from the pooled 2200-frame curve:**
  - The slope at 50% is about 54 percentage points per dB (21.7% at −23.5 dB, 75.8% at −22.5 dB).
  - A one-directional 0.2 dB shift gives about 22 discordant frames of 200 (p ≈ 5e-7).
  - A 0.05 dB shift gives about 5 of 200 (p ≈ 0.06), so it needs about 1000 frames per point, obtained with pre-registered `--replicate` runs.
- **Recommendation:**
  - Primary endpoint: pooled McNemar over pre-registered points (−24…−22 dB).
  - Effect size: paired frame-bootstrap 95% CI of the crossing delta.
  - Collateral check: per-benchmark pooled McNemar with Holm correction across the ten benchmarks.
  - A "moved" benchmark is any discordance at all, since the pairing is deterministic.

**Checked and sound:**
- Replicate seeds are disjoint by construction: bits 48–63, replicate 0 = published, and a test enforces it.
- `decode_slot` takes `&self` with no interior mutability, and the receiver has no wall-clock deadline (timing is recorded in stats only). Results cannot depend on scheduling.
- `RxConfig::default()` equals the station default (z30-engine config.rs:174).
- Wilson, exact McNemar and the k = 0 Clopper–Pearson bound are correct, and each has a test.
- CI asserts the provenance fields on a 3-frame suite run.
- The fading and awgn SNR grids, frame counts and per-benchmark seeds are fixed in code. They are only as fixed as the candidate's own `suite.rs` (RES-02).

---

## 3. Draft proposals (§1 format; drafts for this report only, not filed)

### P1: Per-frame outcomes and a pairing tool (prerequisite; source: this review, RES-01/02/04)
- **Claim:** at the same receiver, adding per-frame output and instrument identity changes no aggregate.
  - `compare_results.py` against a `caf1a9a` baseline reports all ten benchmarks IDENTICAL.
  - A self-pairing of the baseline gives 0 discordant frames at every point.
  - The tool detects a planted change.
- **Class:** tooling (instrument). No receiver change.
- **Benchmarks:**
  - Full `z30 --benchmark suite` at default sizes on both sides, plus `false` and `perf`.
  - A planted-change check: the existing `benchmark_provenance` mutant (LDPC 45 → 5 iterations), built dirty and never published, on `awgn` at 200 frames/point.
- **Decision rule (fixed now):** accept only if all of the following hold:
  - (a) ten benchmarks IDENTICAL;
  - (b) for every point, the per-frame file's totals equal the JSON counts exactly;
  - (c) self-pair discordant = 0 at every point of every benchmark;
  - (d) mutant vs baseline pooled AWGN McNemar p < 0.01, with the discordance favouring the baseline;
  - (e) `pair_results.py` refuses to pair when the seed, frame count or instrument identity differ (three negative tests).

  Any failure rejects.
- **Costs to watch:** result size (about 2 KB of bits per 1800-frame benchmark). Harness wall time within 5%. Receiver CPU and allocations are unchanged by construction, and perf is shown on identical slots.
- **Safety surface:** none. It touches `z30-cli` benchmark code and `research/` only. Not txgate, PTT, the transmit path, the audio callback or `unsafe`. `loopback_isolation.rs` is unaffected.

### P2: Gray vs natural-binary labelling loss (audit L-05)
- **Claim:** the paired difference in 50% crossing, Δ = (natural − Gray), under identical noise, channel realisation, payload and placement with genie timing and frequency. It is reported as a **bound on a labelling delta**, never as a threshold, and no z-30-vs-FT8 delta is derived from it.
  - Prior (DSP): with ideal non-coherent orthogonal 16-FSK in AWGN, all 15 wrong tones are equidistant, so labelling should not matter.
  - Adjacent-tone errors dominate under residual frequency error, drift, GFSK adjacent-tone leakage and Doppler, and that is where Gray labelling can help.
- **Class:** tooling/research. It informs a possible §6 protocol decision and changes nothing in v1. The Gray arm lives in a research-only harness outside the release build. It permutes tone labels between z30-dsp's per-tone metrics and bit LLRs, and applies the inverse permutation to symbols before calling the production `Modulator`. No second demodulator in `crates/` and no production path that emits Gray frames.
- **Benchmarks:** 1000 frames per point (replicates 0–4 × 200, pre-registered). The points:
  - AWGN at −24.0 / −23.5 / −23.0 / −22.5 / −22.0 dB;
  - drift ±4 Hz at −22 and −20 dB;
  - Watterson moderate and poor at −22 / −20 / −18 dB.
- **Decision rule (fixed now):**
  - AWGN: "no material labelling loss" if the 95% paired-bootstrap CI of Δ lies within ±0.10 dB.
  - Drift and each fading preset: "Gray gains" if the pooled McNemar two-sided p < 0.01 in Gray's favour **and** the CI's lower bound on Δ is > 0; "no material loss" if the CI lies within ±0.10 dB.
  - Anything else is inconclusive and reported as such.
  - No result authorises a protocol change without §6 and an operator decision.
- **Costs to watch:** none to production. Research CPU is about 2 × points × frames decodes. Golden vectors must stay unchanged (`generate.py --check`).
- **Safety surface:** none if the permutation stays in the harness. `z30-protocol/tests/frame_integrity.rs` and `safety.rs` n3 guard that the transmit path accepts only a `VerifiedFrame`, so a Gray-labelled frame cannot reach it.

### P3: SNR estimate under replica mismatch (audit N-08)
The post-remediation audit measured, at +20 dB (60 frames each):
- phase noise 5°/symbol: −0.49 dB (−2.88 dB at +30 dB);
- Watterson moderate: −1.92 dB;
- Watterson poor: −4.42 dB.

The validated −22…+30 dB range holds only for AWGN.

- **Stage A (tooling):** add mismatch points to `snr`:
  - conditions: random-walk phase noise 2° and 5° rms per symbol, Watterson moderate and poor, drift ±3 Hz;
  - true SNR −20 / −10 / 0 / +10 / +20 / +30 dB;
  - 200 frames/point;
  - new point indices only, so the existing `snr` points stay IDENTICAL.
- **Stage B claim (receiver):** at +20 dB, for 5° phase noise, moderate and poor:
  - |bias| ≤ 1.0 dB, with the 95% t-interval of the bias inside ±1.0 dB;
  - where that fails, the frame is reported as a bound, not a number.

  AWGN `snr` bias changes by ≤ 0.05 dB at every point from −22 to +30 dB, and the `None` rate on AWGN is unchanged.
- **Class:** Stage A tooling, Stage B receiver-only.
- **Benchmarks:** full suite on both sides, plus the Stage A points, `false` and `perf`.
- **Decision rule (fixed now):**
  - Accept only if:
    1. decode counts in all ten benchmarks are IDENTICAL (SNR is post-decode; any change in what decodes rejects the change, to be re-proposed as a decoding change);
    2. the mismatch criteria are met;
    3. the AWGN criterion is met.
  - Reject if any AWGN point's |bias| exceeds 0.30 dB (the current validated standard).
- **Costs to watch:** CPU per decode and allocations (paired perf at K = 50); `None` rate.
- **Safety surface:** the value is sent over the air as the report (`qso::report_for`). Guards:
  - `snr_accuracy.rs`;
  - the `None` → no-report tests (LOG-d);
  - the display bounds `SNR_VALIDATED_MIN_DB` and `SNR_VALIDATED_MAX_DB`;
  - a DSP-level `None` test (currently missing, N-08), to be added first.

  No txgate, PTT or audio-callback code.

### P4: Where the Doppler cliff lies (fading at 10 Hz; audit §32.I)
Only 1 Hz (decodes; 50% at −20.88 dB on "poor") and 10 Hz (0 of 800 frames) are measured. "No decode above the tone spacing" is an inference.

- **Claim:** characterisation, with the receiver untouched. On a two-path Watterson channel with 2 ms delay and the corrected spread, find the Doppler (2σ) at which the decode rate at −5 dB average SNR crosses 50%, with interpolated Wilson bounds.
- **Class:** tooling (new `doppler` benchmark, id 11 in seed bits 40–47; extend the disjointness test to b = 11).
- **Benchmarks:**
  - Doppler 1 / 2 / 3 / 4 / 5 / 6 / 8 / 10 Hz × SNR −15 / −5 / +5 dB, 200 frames/point;
  - the full suite on both sides;
  - `--frames 20` at `RAYON_NUM_THREADS` 1 and 4 for determinism.
- **Decision rule (fixed now), accept the instrument only if:**
  - (a) the ten existing benchmarks are IDENTICAL;
  - (b) the thread-count runs are identical;
  - (c) the anchor checks hold:
    - 1 Hz at −15 dB has a Wilson lower bound ≥ 90% (fading.json "poor" is 100% at −16 and −14 dB);
    - 10 Hz decodes ≤ 1 of 600 frames (high-latitude moderate: 0 of 800; its delay is 3 ms).
  - Otherwise reject and investigate.
  - The cliff location is reported whatever it is.
  - Any later receiver proposal (for example multi-bin non-coherent energy combining or half-symbol FFT segmentation) is judged on this benchmark. Its claim would be the boundary moving by ≥ 1 Hz, pooled McNemar p < 0.01 over the 3–6 Hz points, the AWGN 50% delta CI upper bound ≤ +0.05 dB, and a gate-off false bound no worse.
- **Costs to watch:** suite runtime (+24 points); nothing in the receiver.
- **Safety surface:** none.

*Not drafted: M-08* (PTT held after SIGKILL or power loss). It is an engine/safety design change, an out-of-process PTT supervisor, with no simulated figure to move. It belongs to the tx-safety auditor and the operator's R-series kill test on hardware, which this role cannot run.

---

## 4. Not checked

- **No published result was reproduced** here. The full suite and publishable-size benchmarks were not run (QA's role; other agents were running `awgn` and `fading` at the same time).
- `paired_receiver.py` was not run: no `z30` wheel is installed, and none was built.
- **Perf on an idle machine was not measured** (load average 9–19 during this review). The HEAD perf figures above are exploratory and not comparable.
- **Cross-ISA reproducibility** (RES-09) and **input-scale invariance** (RES-15) were not tested.
- The G2.3 OSD pool was not re-screened.
- The legacy oracle tests and golden checks were not run.
- `z30-channel` internals were not audited beyond the RNG seeding; the post-remediation audit's SNR-normalisation agreement was relied on.
- The independent audit harness was not re-run.
- The FT8 comparison was not reproduced (it is published data, not measured here).

Scratch artefacts (outside the checkout, not committed): the exploratory AWGN replicate log and
JSON, the false-decodes and perf log, and the `build.rs` reproduction workspace.
