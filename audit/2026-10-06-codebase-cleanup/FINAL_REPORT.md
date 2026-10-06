# Production-only cleanup — final report (2026-10-06)

Branch `ccr-13769fa3-5om9hs`, pull request #50, from `main` at `acfce5e` (the merge of PR #46).
Method and evidence: `INVENTORY.md` (Phase A), `REMOVAL_PLAN.md`, `PERFORMANCE.md` (Phase F),
the scripts beside them (`measure.sh`, `metrics.sh`, `deps.sh`). Nothing here involved a radio,
a sound card or an RF path. Validation state is unchanged: protocol validated, software
simulation validated, **hardware not validated, on-air not validated**.

## 1. What changed

| Phase | Commits | Summary |
| :--- | :--- | :--- |
| A | `08b2edb` | inventory, oracle property table, removal plan |
| B | `e6cdfdd` | deleted `legacy/browser-runtime`, `legacy/python-oracle`, `crates/z30-py` (and `pyo3`), `reference/golden`, `research/paired_receiver.py`, wiki page 08, five CI jobs, the Dependabot `pip` entry; added Rust tests for every guarantee only Python/TS carried; pinned `fixtures/golden` with `FROZEN.sha256` |
| C | `397e120` | removed unused dependency declarations and the never-disabled `z30-dsp/parallel` feature |
| D | `2856fa6` | removed code nothing calls (two items deliberately kept: they are inside the benchmark instrument's hashed files) |
| E | — | reviewed; nothing further to simplify outside safety-critical or instrument-hashed code (§6) |
| F | `624fa9b`, `0bcf07e` | one measured optimisation in `decode_slot`, bit-identical (`PERFORMANCE.md`) |
| G | `822c8f5`, `b68f4db` | CI runs once per commit, no triple release-profile test run, prebuilt cargo-audit; no dependency debug info in dev/test builds |
| H | `b003e20`, `cbbcb8b` | current-state docs updated; documentation review findings fixed |

## 2. Metrics, before (`acfce5e`) and after (this branch)

| Metric | Before | After | Notes |
| :--- | ---: | ---: | :--- |
| Tracked files | 586 | 494 | |
| Total repository text LOC | 160 498 | 101 685 | excludes `.f32`, images, `Cargo.lock` |
| Rust files under `crates/` | 86 | 85 | |
| Rust LOC under `crates/` | 22 907 | 22 902 | −198 `z30-py`, about −100 dead code, +278 net test lines that replace oracle-only guarantees |
| Workspace crates | 8 | 7 | `z30-py` gone |
| `Cargo.lock` packages | 455 | 446 | the `pyo3` chain |
| External crates, whole workspace, all edge kinds | 414 | 405 | |
| External crates, shipped binaries (`z30` + `z30-gui`, CM108, all targets) | 393 | 393 | unchanged: `pyo3` was never in them, and the removed declarations named crates still used elsewhere |
| Direct external dependencies (unique names) | 25 | 24 | `pyo3` |
| Duplicate crate versions | 80 | 81 | `cargo tree -d` line count; not changed by this work in any meaningful way |
| Cargo features declared | 7 | 3 | left: `cm108` ×3 |
| Build scripts | 3 | 2 | `z30-py/build.rs` |
| `#[test]` functions | 274 | 282 | |
| CI jobs (all workflows) | 13 | 8 | |
| Python files, all / outside `audit/` | 57 / 32 | 34 / 9 | the 9 are the stdlib research tools and their tests |
| JS/TS files, all / outside `audit/` | 67 / 57 | 10 / 0 | the 10 are audit evidence |
| Files under `legacy/` | 92 | 0 | |
| Release binary size, unstripped / stripped (`z30`) | 58.1 / 8.47 MB | 58.1 / 8.47 MB | `debug = 1` in release, unchanged |
| Release binary size, unstripped / stripped (`z30-gui`) | 111.7 / 17.80 MB | 111.7 / 17.80 MB | |

## 3. Build, test and CI time

Local: 4 vCPU VM, rustc 1.97.0, clean target directory per command (`measure.sh`;
`evidence/timings-acfce5e.txt`, `evidence/timings-cbbcb8b.txt`, `evidence/ab-build-timings.txt`).
The "before" commands exclude `z30-py`, as CI and `AGENTS.md` did.

| Command | Before | After | |
| :--- | ---: | ---: | :--- |
| `cargo check --workspace --all-targets`, clean (A/B, two runs each) | 145.8 / 144.4 s | 144.9 / 143.4 s | no change: the deleted crate was never in these commands |
| `cargo clippy … -D warnings` after check | 4.8 s | 5.3 s | noise |
| `cargo check`, incremental after touching `slot.rs` | 1.1 s | 1.4 s | noise |
| `cargo test --no-run`, dev/test profile, clean (A/B, two runs each) | 509 / 527 s | 433 / 456 s | −14 %, from `b68f4db` (no dependency debug info); `target/` 5.7 → 4.0 GB |
| `cargo test`, dev/test profile, run | 204 s | 216 s | single runs; within VM noise |
| `cargo build --release` of both binaries with CM108, clean | 233 s | 247 s | single runs; release profile unchanged |
| `cargo test --release --no-run`, clean | 290 s | 292 s | |
| `cargo test --release`, run | 180 s | 169 s | |

GitHub Actions, the push to `main` at `acfce5e` against the pull-request run at `cbbcb8b`
(both with warm `rust-cache`; one run each, so indicative):

| Workflow | Before: wall / summed job time | After: wall / summed job time |
| :--- | ---: | ---: |
| `rust.yml` | 29.3 min / ~104 job-min (7 jobs) | 11.8 min / ~40 job-min (5 jobs) |
| `ci.yml` | 3.3 min / ~16 job-min (9 jobs) | 0.4 min / <1 job-min (3 jobs) |
| Runs per push to a pull-request branch | 2 of each (`push` + `pull_request`) | 1 of each |

Where the time went: the five deleted jobs (golden regeneration 7.3, paired harness 1.1, four
oracle Python versions ~11.6, browser runtime 1.2, pip audit 0.3 job-min), the workspace job's
second, release-profile test pass (9–12 min on each of three platforms), and building
cargo-audit from source (2.7 min). Release-profile tests still run on Linux in the MSRV job on
every pull request, and on every platform in `release.yml` before anything is packaged; on a
pull request that does not touch the release files, Windows and macOS see them only at tag time
(tx-safety-auditor: informational, no guarantee lost).

## 4. Runtime performance

`decode_slot`, `z30 --benchmark perf --frames 20`, CPU per slot (`evidence/perf-acfce5e.txt`,
`evidence/perf-cbbcb8b.txt`, and QA's independent alternating runs in `evidence/qa/`): −27 % to
−43 % at K = 20 and K = 50 across both measurements and thread counts; small at K = 1 (−1 to
−8 %, within noise). Decoded and found counts identical. Few runs, 10–20 slots per K, shared VM,
simulation: indicative, not a published figure. The whole suite at exploratory size is IDENTICAL between
`acfce5e` and `624fa9b` under `compare_results.py`, with the same instrument identity. Details,
the profile and what was tried and not kept: `PERFORMANCE.md`.

## 5. What guarantees moved where

Every property of the deleted oracle is in `INVENTORY.md` §3 with its replacement. New Rust
tests: `z30-protocol/tests/shared_vectors.rs` (CRC-14 and callsign-packing known answers),
`z30-dsp/tests/golden_ldpc.rs::dither_matches_the_shared_vector`,
`z30-dsp/tests/modulator_spectrum.rs` (99 % and −40 dB budgets, the gated reference that must
fail them, ramps, tone at symbol centre, constant envelope between the ramps), and a stronger
thread-count determinism key in `sic_regression.rs`. The golden fixtures are frozen and every
byte is checked in CI. No safety test was changed (`git diff acfce5e -- crates/*/tests` touches
only `z30-dsp` and `z30-protocol` test files, adding or strengthening).

The benchmark instrument identity is unchanged:
`424e6f0385e112e48a2adbcda5456e62fbad5995be73d3624982f5b8e0e0be90` at `acfce5e` and at the
head, so every published result stays comparable without a new baseline.

## 6. Deliberately not done, with the reason

| Item | Why not now |
| :--- | :--- |
| Delete `z30_channel::sigma_for`, `z30_protocol::OCCUPIED_BANDWIDTH_HZ`; merge `suite.rs::percentile` with `bench.rs::pct`; drop `bench.rs`'s exploratory `sweep` | dead or duplicate, but inside the instrument's hashed files: changing them changes the instrument identity and blocks comparison with the published results. Do them together in the next deliberate instrument change |
| Port `research/*.py` to Rust | active, documented, stdlib-only, fail closed, outside the Cargo graph; a port changes the measurement instrument and its byte-for-byte `SUMMARY.md` regeneration, so it needs its own reviewed pull request |
| A cheaper `ln_1p(exp(x))` in the LDPC check node (12–16 % of decode time) | changes the decoder's arithmetic: breaks golden bit-exactness and moves every figure; a receiver change for the research process |
| `rand` 0.9 / `rand_chacha` 0.9 / `rand_distr` 0.6 (PR #49) | they are dependencies of `z30-channel`, so they are part of the benchmark instrument's identity: a bump is an instrument change, which `compare_results.py` and `paired_mcnemar.py` refuse to compare across. It needs its own proposal, `suite`/`false`/`perf` on both commits and a deliberate re-baseline (`docs/research-process.md` §5 and §7), not a routine merge |
| `toml` 1 (PR #49) | in `z30-cli`'s closure through `z30-io` and, as long as it moves no version in the instrument's recorded `channel_dependencies` (which include `serde`), outside the instrument: then the §7 route applies (`lock_closure.py` will report the closure change; run the suite on both commits and show `compare_results.py` IDENTICAL). If the bump moves `serde`, it is an instrument change like `rand`. Better split from the `rand` bumps. `pyo3` from #49 is moot (removed) |
| PR #48 (`source-map-js` in `legacy/browser-runtime`) | moot: the subsystem is deleted. It should be closed, not merged |
| Release profile (`lto = "thin"`, `codegen-units = 1`, `debug = 1`) | it built every published figure's binary; `debug = 1` keeps backtraces from an experimental radio program useful. No measured problem |
| Locks, channels and traits in the runtime | every trait has 3–16 implementations (hardware plus test fakes); the locks are the transmit-safety runtime's. No measured contention |
| Allocations per slot | no measured latency or CPU problem traces to them; the audio callback is already allocation-free by test |
| Merge the MSRV job's separate CM108 step into one featured test run | not measured; left as it is |

## 7. Reviews

Implemented by this session; reviewed independently, routed per area:

| Reviewer | Scope | Result |
| :--- | :--- | :--- |
| `documentation-remediation-engineer` | implemented the doc update (`b003e20`) | — |
| `docs-honesty-auditor` | `b003e20` | 9 findings (3 medium, 6 low), all fixed in `cbbcb8b` |
| `tx-safety-auditor` | the two transmit-adjacent removals, safety tests, CI change | no findings |
| `rf-dsp-reviewer` | `624fa9b`, the `parallel` removal, the spectrum port, `PERFORMANCE.md` | sound; 4 low, fixed in `0bcf07e` |
| final round | see §8 | |

## 8. Final review round

Where the reviews are: each reviewer's full report (severity, `file:line`, evidence) was
delivered in the implementing session and is summarised here; the reports themselves are not
kept in the tree (`audit/EVIDENCE_POLICY.md`: an audit says when evidence is not kept). What is
kept: QA's raw logs (`evidence/qa/`), every finding's disposition in the commit that fixed it
(`git log acfce5e..` — each fixing commit names the reviewer and lists the findings), and the
board packet (`BOARD_PACKET.md`).

Head at the end of the round: `251d7d2` plus `serde` removed from `z30-io` (the CTO's low
finding), in the commit that adds this section. CI on `251d7d2` completed with no failed check
suite (rust.yml on Linux, Windows, macOS and MSRV; ci.yml; release.yml dry run).

| Reviewer | Verdict | Findings and disposition |
| :--- | :--- | :--- |
| `cto-code-reviewer` | APPROVE-RECOMMEND for the board | Medium: `tests/vectors` not pinned — fixed in `251d7d2`. Low: unused `serde` in `z30-io` — removed. Low: this section was empty — filled. Nothing obsolete left outside `audit/`; no production capability removed; CI has no silent pass; the lock file is consistent; release binaries and instrument unaffected by the profile change |
| `qa-reproducer` | instrument identity, suite IDENTICAL (10 and 20 frames per point, `acfce5e` vs `4bd6811`), new tests, frozen checks: REPRODUCED. Performance: direction reproduced, size not at K = 20 / 4 threads | the claim restated as a range across both measurements (§4, `PERFORMANCE.md` §2); QA's logs in `evidence/qa/`. The first QA run was cut off by an API limit after its runs finished; a second QA agent assessed those artefacts |
| `research-engineer` | every research-process step runs at head; no result changed | 4 medium, 4 low — all fixed in `251d7d2` (evidence committed, §6 generator path with CI `--check`, rand vs toml routing, frozen `tests/vectors`, subdirectory completeness, `lock_closure.py` test, stale pointers) |
| `tx-safety-auditor` | no findings | the two transmit-adjacent removals were unreachable from any TX, HALT, watchdog, panic, signal or shutdown path; §4 tests unchanged and passing. Not re-run for the later commits: none touched transmit code |
| `rf-dsp-reviewer` | sound | 4 low, fixed in `0bcf07e`. Not re-run: no receiver change after `624fa9b` |
| `docs-honesty-auditor` | 9 findings | all fixed in `cbbcb8b`. The later doc edits (`251d7d2`) came from the research and CTO reviews |
| `ceo-board-liaison` | see the board packet | |

The final team's questions:

- **Is anything obsolete still present?** Outside `audit/` (kept as history), no (CTO). The dead
  items left inside the benchmark instrument's hashed files are listed in §6 with the reason.
- **Did deletion remove a required production capability?** No: `crates/z30-cli`
  has no diff at all; `z30-gui` and `z30-io` changed only in `Cargo.toml` (CTO).
- **Did a safety invariant disappear?** No (tx-safety-auditor; safety tests byte-identical).
- **Did performance improve?** `decode_slot` CPU per slot −27…−43 % at K = 20–50 (simulated
  seeded bands, shared 4-vCPU VM, 10–20 slots per K, two measurements; §4), output identical on
  the 42-band bit-check and the exploratory-size suite (QA reproduced direction and identity).
  Indicative, not a published figure.
- **Did compile/test time improve?** Locally, clean dev/test builds −14 % (dependency debug info);
  `cargo check` unchanged. CI: `rust.yml` 29 → 12 min wall, ~104 → ~40 job-minutes; `ci.yml`
  3.3 → 0.4 min; one run per push instead of two (single runs, indicative).
- **Did dependency count decrease?** Workspace graph 414 → 405 crates; the shipped binaries'
  graph is unchanged (393).
- **Did complexity decrease?** 92 legacy files and two implementation stacks gone; 7 crates
  instead of 8; 3 Cargo features instead of 7; 8 CI jobs instead of 13; no Python outside the
  research tools, no JS/TS outside audit evidence.
- **Is the production architecture easier to understand?** CTO: yes.
