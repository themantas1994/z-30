# Whole-project review by the agent team — 2026-09-28

A review of the repository at **`caf1a9a`** (`main` when the review started) by all seven
review agents in [`.claude/agents/`](../../.claude/agents/), each in its
[`docs/research-process.md`](../../docs/research-process.md) role. It is **evidence for the
board, not a board decision.** No board decision has been made or recorded here; the board is
the licensed operator who owns this repository. Nothing in this directory changes code, tests,
documentation, results or golden vectors.

**Validation state: protocol validated; software simulation validated; hardware not validated;
on-air not validated.** No agent opened a radio, sound-card output, PTT line, CM108 device,
serial port or rigctld. Nothing was keyed. All measurements here are software simulation.

## Reports

| File | Agent | Verdict | Findings |
| :--- | :--- | :--- | :--- |
| [01-code-review-cto.md](01-code-review-cto.md) | `cto-code-reviewer` | **Ready after fixes.** fmt and clippy clean on 1.95; 167 tests pass, 0 fail, 2 ignored | CTO-01…17 (1 High, 7 Medium) |
| [02-transmit-safety.md](02-transmit-safety.md) | `tx-safety-auditor` | **Findings.** 37 mutants: 23 killed, 14 survive; the five earlier survivors are now killed | TX-01…22 (9 High) |
| [03-dsp-review.md](03-dsp-review.md) | `rf-dsp-reviewer` | **Sound with stated limits** | DSP-01…13 |
| [04-docs-honesty.md](04-docs-honesty.md) | `docs-honesty-auditor` | No hardware/on-air implication; no withdrawn figure quoted as current | DOC-01…34 (1 High, 9 Medium) |
| [05-qa-reproduction.md](05-qa-reproduction.md) | `qa-reproducer` | **Partially reproduced; every rerun count matches exactly** | QA-01…07 (provenance and wording only) |
| [06-research-record.md](06-research-record.md) | `research-engineer` | No existing result was produced under the research process; the instrument cannot yet support it | RES-01…16; draft proposals P1–P4 |
| [07-board-packet.md](07-board-packet.md) | `ceo-board-liaison` | Blocker checklists and one de-duplicated list, F-01…F-79 (13 High, 27 Medium) | — |

Evidence: [`evidence/tx-mutation/`](evidence/tx-mutation/) (mutation script, results, log,
probe), [`evidence/qa-reproduction/`](evidence/qa-reproduction/) (QA's reproduced JSON — QA
output, not published results), [`evidence/c1-buildrs-tiebreak/`](evidence/c1-buildrs-tiebreak/)
(conflict C-1). Logs are kept as `.txt` because `.gitignore` drops `*.log` (RES-13).

## Headline

- **The published figures stand.** Rebuilt from clean worktrees with rustc 1.95.0, every rerun count is bit-identical to the published rustc 1.98.1 runs. That covers AWGN at `672cef9` and `caf1a9a` (50% at −23.03 dB [−23.13, −22.89], 90% at −22.06 dB [−22.15, −21.80]; blind acquisition, AWGN, 2500 Hz SNR, 200 frames per point, suite seed 20260830, Wilson 95%; simulation), all 25 fading points, replicate 7 and `false_decodes_2000.txt` (05).
- **The receiver is sound, with stated limits** (03). There is one blind receive path, the SNR definition is correct, and the Watterson model is correct. But the SNR estimate reads 1.7–6.3 dB low on the corrected fast-fading channels (DSP-01, exploratory), and the production AP path has no test and no false-decode figure (DSP-03).
- **The transmit path must be fixed before any hardware test.**
  - A failed PTT release is never retried and nobody is told; the radio can stay keyed (TX-01 = CTO-01).
  - The US band plan clears data in the 6 m and 2 m CW-only sub-bands and off-channel on 60 m (TX-02).
  - `z30 --migrate` writes `tx_level = 0.5` and can import the old W1AW default (TX-13 = DOC-02).
  - 13 transmit guarantees are not pinned by any test (TX-03…09).
  - The CTO sets CTO-01…04 as the gate before a dummy-load test.
- **The benchmark instrument can mislabel a result.** `build.rs` labels a binary built with an unstaged edit as a clean commit (RES-03, confirmed by C-1 below). A replicate run silently overwrites the published file (RES-04). And no per-frame outcomes exist, so two commits cannot be paired (RES-01).
- **The documentation contradicts the code in places.** Examples: wiki/15's new-install config (DOC-01), `docs/demodulation.md`'s retired SNR estimator (DOC-04), and incomplete FT8 comparisons (DOC-06).

The full list, with the blockers for this PR, for any dummy-load test, for the release tag and
for the next published figure, is in [07-board-packet.md](07-board-packet.md) §0.

## Conflict C-1 — `build.rs` dirty detection

The CTO review's "Build provenance" bullet said an unstaged edit after a clean build is marked
`-dirty`. RES-03 said it is not. The coordinator broke the tie with
[`evidence/c1-buildrs-tiebreak/run.sh`](evidence/c1-buildrs-tiebreak/run.sh), which copies the
real `crates/z30-cli/build.rs` into a two-crate toy workspace.

After an unstaged edit in the dependency crate, the binary runs the edited code (`answer=4`) but
prints the clean commit label, before and after `git status`
([output](evidence/c1-buildrs-tiebreak/output.txt)). Cargo recompiles the edited crate, but the
build script's only rerun triggers are `.git/HEAD` and `.git/index`, so the label is never
recomputed. **RES-03 stands; the CTO bullet is overturned.**

Severity: where two reports rate one issue differently (e.g. CTO-04 Medium, TX-14 Low), the
board packet carries the higher rating.

## Changes on `main` during the review

`main` moved from `caf1a9a` to **`207caac`** while the review ran:
- PR #43 added the lock-closure proof and a research-process §7 addendum;
- PR #42 prepared release `v0.1.0-experimental`: the version, `release.yml`, install docs and release notes.

No `crates/` source changed, so every code finding holds at `207caac`. The board packet (§3)
checked the two findings that change could touch:
- **CTO-08 (retired macOS runner) is resolved at `207caac`.**
- **DOC-18 still holds.**

The release notes added by #42 were not reviewed by any agent. The packet notes three lines that
repeat findings here (07 §0 C2).

**`main`'s CI has been red since `207caac`.** The paired-harness job fails because maturin
rejects the workspace version `0.1.0-experimental`, which `crates/z30-py` inherits, as not
PEP 440. The coordinator reproduced this with maturin 1.15.0 and verified a patch: `z30-py`
gets its own `version = "0.1.0-dev.0"`. The patch is proposed in a comment on the audit PR
([#45](https://github.com/themantas1994/z-30/pull/45)), not pushed. The same job therefore fails
on that PR's merge ref, although the PR changes only `audit/`.

## What this review did not cover

Everything hardware-dependent (including M-08, PTT held after SIGKILL). The changes on `main`
after `caf1a9a`, beyond the checks above. GitHub CI runs themselves, and Windows and macOS back
ends. The oracle's Python tests and golden-vector regeneration. The paired-harness results, the
other eight `672cef9b3cdb` benchmarks, nine of ten replicates, and latency on an idle host.
Cross-ISA reproducibility. Detail in [07-board-packet.md](07-board-packet.md) §7 and in each
report's "Not checked" section.

## Method

- **Toolchain:** rustc/cargo 1.95.0 (the declared MSRV). The container's default stable, 1.94.1, is below the MSRV.
- **Setup:** `libasound2-dev` and `libudev-dev` installed. The release binaries (with `cm108`) and release test binaries were built once, then shared read-only.
- **Checkout untouched:** every agent was read-only on the checkout. Mutations, reproductions and experiments ran in separate git worktrees or out-of-tree crates under the session scratchpad, all since removed. Nothing was written to `research/results/`.
- **How the reports were produced:** the six role agents ran in parallel on a shared 4-CPU host. The board liaison ran last, over their reports. Each report is the agent's own text, lightly formatted, with cross-references added by the coordinator where marked.
