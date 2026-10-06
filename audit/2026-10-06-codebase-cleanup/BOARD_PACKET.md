# Board packet: PR #50, production-only cleanup (2026-10-06)

Prepared by `ceo-board-liaison` for the board (the licensed operator). **This is not a board
decision.** No board decision is recorded anywhere: when this was written, PR #50 had no GitHub
reviews and no comments, and it was open and unmerged (`gh api .../pulls/50`, `.../issues/50/comments`).

| | |
| :--- | :--- |
| PR | themantas1994/z-30 #50, branch `ccr-13769fa3-5om9hs` |
| Head (the commit a decision applies to) | `88f4ddb4acbe7c6dcaaa1d3490da873b633ef255` |
| Base | `main` at `acfce5e5d1e29ae295cdfe05487718cac31fb795` |
| Class | tooling-docs (deletions, dependency declarations, CI, docs), plus one receiver-internal refactor (`624fa9b`) that is claimed bit-identical, so it falls under research-process §7. **Not a protocol change.** |
| Validation state | unchanged: protocol validated, software simulation validated, **hardware not validated, on-air not validated**. Nothing here involved a radio, sound card or RF path. |

## Blockers (read first)

**B1. CI on the exact head is not complete.** Owner: author, then CTO.
When this was written, the following were finished and passing on `88f4ddb`: hygiene (which
includes both frozen-hash checks), research tools, cargo audit, and CodeQL for python, js-ts and
actions. These were still running: `rust.yml` (Linux, Windows and macOS, MSRV, benchmark
provenance), the `release.yml` dry run (4 targets) and CodeQL rust. The CodeQL summary check shows
`neutral` only because its rust analysis was still running ("1 configuration not found").
On `251d7d2` every check passed (verified through the API). The only non-`audit/` diff from
`251d7d2` to `88f4ddb` is the removal of `serde` from `z30-io` (`Cargo.toml` and `Cargo.lock`).
This is a **condition, not a finding**: a decision on `88f4ddb` needs every check on that commit
green. If any check is red, the PR does not land (§7, last line).

Conditions that do not change the evidence but should be met before the board decides:

- [ ] **C1. The reviews are not recorded on the PR.** Owner: author. PR #50 has zero GitHub
  reviews and zero comments. The verdicts exist only as the author's summary in
  `FINAL_REPORT.md` §7–§8 and in the commit messages. Apart from QA's logs in `evidence/qa/`, the
  reviewers' own reports, with severity and `file:line`, are not in the tree. §3 requires the
  reviews to be "recorded on it". Fix: post each reviewer's report on PR #50, or commit it.
- [ ] **C2. No reviewer has confirmed the fixes.** Every finding was fixed by the author. No
  reviewer re-ran on the fixing commit (§4: a review is stale for anything changed after it).
  - [ ] `docs-honesty-auditor`: confirm `cbbcb8b`, **and audit `251d7d2`'s edits to `AGENTS.md`
    and `docs/research-process.md` §6/§7**. These are process text and no docs audit has seen them.
    This is the most material gap.
  - [ ] `research-engineer`: confirm `251d7d2`.
  - [ ] `rf-dsp-reviewer`: confirm `0bcf07e` (test-only changes).
  - [ ] `cto-code-reviewer`: confirm `88f4ddb`. This one is trivial. My spot check found no
    `serde::` use in `crates/z30-io/src`, only `serde_json`.
- [ ] **C3. The PR description is stale.** Owner: author. It still says "Performance, build/CI
  tuning and the final review are still to come" and that the docs "still await
  docs-honesty-auditor review". Update it to the current head, and link `FINAL_REPORT.md` and this
  packet.

## 1. Summary: what the board is asked to accept

The board is asked to accept these changes at `88f4ddb`:

- Delete the Python protocol oracle, the retired browser runtime, the PyO3 bindings
  (`crates/z30-py`, `pyo3`), the golden generators, `research/paired_receiver.py`, wiki page 08 and
  five CI jobs. All of it is recoverable from `acfce5e`.
- Replace every guarantee that only Python or TypeScript asserted with Rust tests
  (`INVENTORY.md` §3).
- Freeze `fixtures/golden` and `tests/vectors` byte for byte (`FROZEN.sha256`, checked in CI).
- Drop unused dependency declarations, the never-disabled `z30-dsp/parallel` feature and
  uncalled code.
- Land one `decode_slot` optimisation (`624fa9b`, replica waveform built once per decode), shown
  bit-identical. CPU per slot at K = 20–50 falls 27–43 %; this is indicative, not a published figure.
- Cut CI to one run per commit, with no triple release-profile test.
- Ship no dependency debug info in dev/test builds.
- Amend `docs/research-process.md` §6 (where a future protocol version's independent generator
  and vectors go) and §7 (`rand*` bumps are instrument changes; `toml` takes the §7 route).

Nothing changes in `crates/z30-cli`, the release profile, the shipped binaries' dependency graph
(393 crates), the benchmark instrument identity (`424e6f03…be90` at base and head), any published
figure, or any transmit-safety test.

## 2. Proposal and decision rule

- There is no proposal issue: PR #50 links none. That is acceptable for a §7 change.
- The rule for the one receiver-touching change was written before the run:
  `REMOVAL_PLAN.md` Phase F (commit `08b2edb`, 06:49 UTC) says "change only a measured hot spot,
  prove the receiver bit-identical (golden tests, determinism tests, a seeded suite subset compared
  with `compare_results.py`)". `624fa9b` was committed at 07:44 UTC.
- **Flag:** the size of the suite subset was not fixed in advance. It became 20 frames per point
  (decision b).
- The CPU-saving size had no pre-registered rule. It is labelled indicative and unpublished
  (`PERFORMANCE.md` §2).

## 3. Results note

**Not required (§7)**: no measured figure can move. The evidence that the suite is unchanged:

- `compare_results.py` on `acfce5e` against `624fa9b`, whole suite, 20 frames per point, suite seed
  20260830, `status: exploratory`, clean builds. All ten benchmarks are IDENTICAL, exit 0
  (`evidence/compare_results.txt`; result files in `evidence/suite-acfce5e/` and
  `evidence/suite-624fa9b/`).
- QA reproduced the same comparison independently on `acfce5e` against `4bd6811` at 10 and at 20
  frames per point: IDENTICAL (`evidence/qa/qa-suite20-compare.log`).
- A raw-bit harness covered every field of every decode and every SIC pass statistic, over 42
  seeded bands with K = 1…50 (669 decodes). The output is identical, SHA-256 `eb411a27…e7c2` before
  and after (`evidence/bitcheck.rs`, `bitcheck-output.{txt,sha256}`).
- Instrument identity `424e6f0385e112e48a2adbcda5456e62fbad5995be73d3624982f5b8e0e0be90` is the
  same at base and head. I checked independently that the hashed sources
  (`crates/z30-{protocol,channel}/{src,Cargo.toml}`) have no diff from `acfce5e` to `88f4ddb`.
- Performance is a simulation on a shared 4-vCPU VM, one author run plus QA's two alternating runs
  with 10–20 slots per K. Result: −27 % to −43 % CPU per slot at K = 20–50, and −1 % to −8 % at
  K = 1 (within noise). Decoded and found counts are identical. Indicative only; not a figure.

## 4. Reviews

| Role | Agent | Verdict | Commit reviewed | Open items | Fix commit (spot-checked) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Code | `cto-code-reviewer` | APPROVE-RECOMMEND | `251d7d2` | none open; fix not reviewer-confirmed (C2) | M `tests/vectors` unpinned → `251d7d2` adds `tests/vectors/FROZEN.sha256`, checked by `ci.yml` hygiene ✔. L unused `serde` in `z30-io` → `88f4ddb` ✔. L empty §8 → `88f4ddb` ✔ |
| DSP | `rf-dsp-reviewer` | sound | `624fa9b`, spectrum port, `parallel` removal | none open; not re-run (C2) | 4 L → `0bcf07e`: envelope check in `modulator_spectrum.rs`, every-field determinism in `sic_regression.rs`, `PERFORMANCE.md` per-thread and unattributed share ✔. No receiver source changed after `624fa9b` (verified) |
| QA reproduction | `qa-reproducer` | identity, suite, new tests and frozen checks REPRODUCED; perf direction reproduced, size not (−29 % against the claimed −43 % at K = 20, 4 threads) | `4bd6811` | none: the claim was restated as a range | `88f4ddb` restates `PERFORMANCE.md` §2 and `FINAL_REPORT.md` §4; logs in `evidence/qa/` ✔. Since `4bd6811`, no receiver or instrument file changed |
| Research | `research-engineer` | every research-process step runs at head; no result changed | branch at `4bd6811` (inferred from fix order) | none open; not re-run (C2) | 4 M + 4 L → `251d7d2`: evidence committed, §6 generator path with CI `--check`, rand/toml routing, `tests/vectors` frozen, subdirectory completeness, `test_lock_closure.py`, stale pointers ✔ (matched against the file list) |
| Transmit safety | `tx-safety-auditor` | no findings | the transmit-adjacent removals (`2856fa6`), safety tests, CI | none | Not stale: `crates/z30-engine`, `crates/z30-io/src` and `crates/z30-cli` have no diff since `2856fa6` (verified) |
| Docs honesty | `docs-honesty-auditor` | 9 findings (3 M, 6 L) | `b003e20` | not re-run on `cbbcb8b` or on `251d7d2`'s process-text edits (C2) | `cbbcb8b` touches the 12 files the findings name ✔ |

Other independent checks made for this packet:

- No test under `crates/z30-engine`, `z30-io` or `z30-cli` changed.
- Test changes are confined to `z30-dsp` and `z30-protocol`, and they add or strengthen tests.
  The one test removed, `golden_ldpc.rs::screen_osd_pool`, was an `#[ignore]`d screening helper
  for the deleted generator and asserted nothing.
- The `z30-engine` diff is 21 deleted lines: `Region::verified_on`, `note_requested_mode` with the
  field it wrote, and `emergency_unkey`. Nothing was added.

## 5. Protocol change?

**No.**

- `SPEC.md` edits only rewrite references to deleted files. The title is still "version 1".
- `PROTOCOL_VERSION` and the workspace version are unchanged.
- The data in `fixtures/golden` is byte-identical; only `FROZEN.sha256` was added.
- The `tests/vectors` data is identical. Only the `_comment` keys changed, which I checked by
  comparing the JSON with those keys removed.
- No §6 checklist applies.

## 6. Merge contents (§5)

- **Result directories:** the 20-frame exploratory suites for both commits are in
  `evidence/suite-{acfce5e,624fa9b}/`. `research/results/<commit>/` takes only published-size
  clean runs, so nothing lands there. If the board asks for 200 frames (decision b), those runs
  provide the result directories.
- **Figures:** no published figure moves. There is nothing to paste from `SUMMARY.md` and nothing
  to withdraw. The `docs/benchmarking.md` perf table stays marked historical.
- **Docs, wiki and SPEC** were updated in `b003e20`, `cbbcb8b` and `251d7d2`.

## 7. Decisions the board must make explicitly

- [ ] **(a) Delete the Python oracle as the independent reference implementation.**
  - Cost: a future protocol change has no in-tree cross-check, and the v1 golden vectors can no
    longer be regenerated, only kept (frozen and hash-pinned).
  - Mitigation: research-process §6 as amended here. A v2 generator independent of `crates/`
    goes under `research/golden/` with pinned requirements, its vectors go in
    `fixtures/golden/v2/` with their own `FROZEN.sha256`, and CI runs a `--check` that regenerates
    them. Recoverable from `acfce5e`.
- [ ] **(b) Bit-identity of `624fa9b` at exploratory size:** accept 20 frames per point plus the
  669-decode raw-bit harness and QA's 10- and 20-frame reproductions, or ask for `--frames 200` on
  both commits (about 1 h each on 4 cores). Note that identity is a deterministic property: the
  frame count bounds how much input was exercised, not a confidence level.
- [ ] **(c) Release-profile tests leave ordinary PRs on Windows and macOS.** They still run on
  Linux (MSRV job) on every PR, and on all platforms in `release.yml`. `release.yml` runs at tag
  time and on PRs that touch `Cargo.toml`, `Cargo.lock`, `packaging/`, `docs/install.md`,
  `docs/release-notes/` or `release.yml`; this PR triggers it. The dev/test profile tests still
  run on all three platforms. `tx-safety-auditor`: informational, no guarantee lost.
- [ ] **(d) Dependabot PRs.** Close **#48**: it bumps `source-map-js` in the deleted
  `legacy/browser-runtime` and is dead. **Split #49**:
  - `rand`/`rand_chacha`/`rand_distr` change the instrument identity. They need their own
    proposal, `suite`/`false`/`perf` on both commits and a deliberate re-baseline (§5, §7).
  - `toml` goes by the §7 route (`lock_closure.py`, then suite IDENTICAL).
  - `pyo3` is moot.

  Closing or splitting is the operator's action on GitHub.
- [ ] **(e) Process text.** Accepting this PR adopts the amended `docs/research-process.md` §6
  (v2 generator and vector location, CI `--check`) and §7 (`rand*` against `toml` routing). This
  is separate from §2a, which is still pending its own acceptance and is not changed here.

## 8. Deferred work (FINAL_REPORT §6)

- Delete `sigma_for` and `OCCUPIED_BANDWIDTH_HZ`, merge `percentile` with `pct`, and drop `bench.rs`
  `sweep`. All are in instrument-hashed files, so they wait for the next deliberate instrument
  change.
- Port `research/*.py` to Rust: that changes the instrument and the `SUMMARY.md` regeneration, so
  it needs its own reviewed PR.
- A cheaper `ln_1p(exp(x))` in the LDPC check node (12–16 % of decode time) changes the decoder's
  arithmetic. It is a receiver change and goes through the research process.
- `rand*` bumps from #49: instrument change, own proposal, re-baseline.
- `toml` 1 from #49: §7 route, split from `rand*`.
- Close PR #48 (moot).
- Release profile (`lto`, `codegen-units = 1`, `debug = 1`): unchanged, no measured problem.
- Runtime locks, channels and traits: unchanged, no measured contention, and they belong to the
  safety runtime.
- Per-slot allocations: unchanged, no measured problem; the audio callback is already
  allocation-free by test.
- Merge the MSRV job's CM108 step into the featured test run: not measured, left alone.

## 9. Question for the board

Does the board accept, reject, or request more evidence on PR #50 at commit
`88f4ddb4acbe7c6dcaaa1d3490da873b633ef255`, with any acceptance conditional on every CI check on
that commit finishing green, and with explicit answers to decisions (a)–(e)?

---

## Addendum by the implementer (not part of the liaison's packet; no board decision)

What was done about the packet's conditions after it was written:

- **C2, confirmation reviews.** Each reviewer re-ran on its fixes:
  - `rf-dsp-reviewer` on `0bcf07e`: all four earlier findings FIXED; one new low (the envelope
    test had no negative control), fixed in `05064c8`.
  - `docs-honesty-auditor` on `cbbcb8b` and on the later process text (`251d7d2`, `88f4ddb`):
    8 of 9 FIXED, the ninth stale again; new findings, the medium one being that `serde` is inside
    the instrument's recorded `channel_dependencies` (so research-process §7's "a `serde` bump is
    outside the instrument" was wrong, and a `toml` bump is outside it only if it moves no `serde`
    version). All fixed in `d51cb94`. This changes the wording of decision (d): `toml` takes the
    §7 route only if it moves nothing in the instrument's dependency list.
  - `research-engineer` on `251d7d2`/`88f4ddb`/`d51cb94`: every earlier finding FIXED; one new
    low (the frozen-file check was one level deep and skipped dotfiles), fixed in the commit
    after `d51cb94`.
  - `cto-code-reviewer`'s two lows were the `serde` line and FINAL_REPORT §8; the liaison
    spot-checked the first, and clippy and the `z30-io` tests pass.
- **C1, review records.** `FINAL_REPORT.md` §8 states where each full report is and that the
  reports themselves are not kept in the tree; each fixing commit names the reviewer and the
  findings.
- **C3, PR description.** Rewritten for the final head.
- **B1, CI.** A macOS job on `00d5528` failed before compiling anything (DNS: `Could not resolve
  host: index.crates.io`); explained on the PR. The decision applies to the final head, whose CI
  must be green.
