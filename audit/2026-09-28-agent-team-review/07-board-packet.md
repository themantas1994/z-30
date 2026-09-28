# Board packet — whole-project audit of z-30 at `caf1a9a`

> Produced by the `ceo-board-liaison` agent (`.claude/agents/ceo-board-liaison.md`), 2026-09-28.
> Evidence for the board, not a board decision. **No board decision has been made or recorded.**
> Nothing here accepts, rejects, merges, approves or keys anything. The board is the human
> licensed operator who owns this repository.

| | |
| :--- | :--- |
| Subject | The repository at **`caf1a9a1959a`** (`main` when the audit started). There is no candidate change |
| Pull request | [#45](https://github.com/themantas1994/z-30/pull/45), branch `claude/fervent-cray-riehln`, head **`1304eae`** when this was written. This file adds one more commit. Base is `caf1a9a`. It adds files under `audit/` only (`git diff --name-only caf1a9a 1304eae` lists only `audit/`) |
| `main` now | **`207caac`**. PRs #43 and #42 merged after `caf1a9a`: 12 files changed, none of them `crates/` source (see §3) |
| Class | tooling-docs (an audit record): research-process §7. Needs no experiment, but §3–§5 still apply |
| Board statements found | None. PR #45 has 0 reviews, 0 review comments and one issue comment (the coordinator's CI diagnosis, §3). None of it is a board decision |

---

## 0. Blockers — read first

Owners: **author** (whoever implements the fix), **CTO** (`cto-code-reviewer`), **RF engineer**
(`rf-dsp-reviewer`), **QA** (`qa-reproducer`), `tx-safety-auditor`, `docs-honesty-auditor`,
`research-engineer`, **coordinator** (the agent maintaining PR #45) and **board**.
"(report)" means a report sets the item as a gate. "(liaison)" means this packet proposes it
for the board to confirm or strike.

### A. PR #45 itself, before the board can decide on it

- [x] **A1 — Dangling reference.** *Done by the coordinator: [README.md](README.md) now exists and records C-1.* TX-14's severity note and RES-03's consolidation note both cite a consolidated `README.md` for this audit, and conflict C-1. That file does not exist in `audit/2026-09-28-agent-team-review/`. Either add it or point both notes at this packet. — *coordinator*
- [x] **A2 — The C-1 tie-break evidence was not in the repository.** *Done by the coordinator: [evidence/c1-buildrs-tiebreak/](evidence/c1-buildrs-tiebreak/) (script and output; re-run once more with the same result).* This packet records the coordinator's result (§3), but the toy-workspace run is not committed. Commit its script and output under `evidence/`, or say explicitly that it is not kept. — *coordinator*
- [ ] **A3 — CI.** Checks on `1304eae` were still running at the time of writing. The coordinator has reproduced the paired-harness job failing on the merge ref, because it fails on `main` (§3). Under research-process §7 as amended in #43, "a section 7 change whose CI is red does not land". The fix belongs on `main` in its own PR (the `z30-py` version patch in the PR #45 comment, not yet pushed). — *author, CTO review*
- [x] **A4 — PR description was stale.** *Done by the coordinator with the commit that adds this file.* It still says "in progress", with five reports "running". — *coordinator*
- [ ] **A5 — Review of PR #45 as a change.** None is recorded on the PR. The six reports are its content, not reviews of it. The board decides whether a docs-only audit record needs §3 reviews. If it does, they would come from the CTO (`cto-code-reviewer`) and `docs-honesty-auditor`. — *board*
- [ ] **A6 — Head commit.** Acceptance applies to the head that carries this file (§4). Any later push makes this packet stale for the changed part. — *board*

### B. Before any hardware (dummy-load) test

Only the licensed board operator runs such a test, following `docs/hardware-validation.md`.
Nothing below schedules or requests one.

- [ ] **B1 — F-01 (TX-01 = CTO-01).** A failed release must stay "possibly keyed". The watchdog must retry it, it must surface as a `TxFault`, and a test must use a line whose release fails. (report: CTO) — *author; verified by tx-safety-auditor and CTO*
- [ ] **B2 — F-15 (CTO-02 = TX-11).** A panic inside `PttLine::set` must not deadlock the hook, the watchdog or the signal handler. Add a panicking-line test. (report: CTO) — *author; tx-safety-auditor*
- [ ] **B3 — F-16 (CTO-03 = TX-10).** HALT must call `emergency_unkey` directly and must never be dropped. `timedatectl` must come off the control thread. (report: CTO) — *author; CTO*
- [ ] **B4 — F-17 (CTO-04 = TX-14).** Abandon a late key, or report it `completed = false`. Do not log an incomplete closing message. Open the CAT PTT connection when the line is created. (report: CTO) — *author; CTO*
- [ ] **B5 — F-19 (CTO-06 = TX-16 + TX-17).** An output-device failure while keyed must lead to unkey plus `TxFault`. A `play` error must lead to `stop()`. (liaison) — *author; CTO*
- [ ] **B6 — F-04 (TX-04).** Add a `runtime::start` transmit-loop test with fake PTT and audio. B1–B5 cannot be shown fixed without it. RT-halt, RT-wd, RT-keyfail and RT-unkey must be killed. (liaison) — *author; tx-safety-auditor*
- [ ] **B7 — Pin the untested invariants.** F-03, F-05, F-06, F-07, F-08 and F-09 (TX-03, 05, 06, 07, 08, 09). The survivors N3-sym, G-bw, G-centre, G-top, P-max, P-hook, G-nan, N3-level, LOOP-e and PWR-a must all be killed on a re-run of `evidence/tx-mutation/mutate_tx.py`. (liaison) — *author; tx-safety-auditor*
- [ ] **B8 — F-21 (TX-13 = DOC-02).** Migration must not write `tx_level = 0.5` and must not import W1AW. F-10 (DOC-01) must be corrected with it. (liaison) — *author; tx-safety-auditor, docs-honesty-auditor*
- [ ] **B9 — F-02 (TX-02).** Split US 6 m and 2 m at 50.1 and 144.1 MHz, and model 60 m as channels. The board confirms the regulatory reading against the current 47 CFR 97, as TX-02 itself asks. At the latest this is needed before any on-air test; it is listed here so a dummy-load run exercises the corrected gate. (liaison) — *author; tx-safety-auditor; board*
- [ ] **B10 — F-43 (TX-20 = CTO-12).** Refuse an ambiguous CM108 or audio-device match. Document how serial open behaves on DTR/RTS in `docs/hardware.md` and in the validation procedure. (liaison) — *author; docs-honesty-auditor*
- [ ] **B11 — F-18 (CTO-05 = TX-19) and F-27 (DOC-03).** The rig poller must honour the settle window and `poll_interval_ms`, or the five texts must be corrected. Fix the stale mode. Tell the operator in the docs that the readback tolerance is a strict 1 Hz, because no resolution probe is wired in. (liaison) — *author; CTO, docs-honesty-auditor*
- [ ] **B12 — `main` CI green, including the paired harness (§3).** (liaison) — *author; CTO*
- [ ] **B13 — One named commit carrying B1–B12.** The code review and the transmit-safety audit are re-run on that commit. The reviews here are of `caf1a9a` and are stale for anything changed since. (report: research-process §4) — *CTO, tx-safety-auditor*
- [ ] **B14 — The board's explicit decision, recorded on a PR, that a dummy-load test may proceed on that commit.** It includes whether M-08 (PTT held after SIGKILL or power loss; carried open, CTO table) is acceptable with the radio's own time-out timer as the last layer. — *board*

### C. Before the `v0.1.0-experimental` tag is cut (it ships a transmit-capable `z30-gui`)

- [ ] **C1 —** The board decides whether the tag waits for B1–B11. No tag exists yet (`git tag -l` is empty). The dry run built all four targets (see F-23). — *board*
- [ ] **C2 —** The release notes (`docs/release-notes/v0.1.0-experimental.md`, added after `caf1a9a`) have not been reviewed by any agent. From reading them here:
  - line 11 repeats DOC-16's "waveform … bit for bit";
  - lines 23–25 say a fresh installation has no transmit level, which is true without migration but not after `--migrate` (DOC-02 / TX-13);
  - line 84 carries the FT8 per-bit sentence that DSP-02 disputes.

  Route to docs-honesty-auditor. — *docs-honesty-auditor, author*

### D. Before the next published figure

- [ ] **D1 — F-13 (RES-03).** `build.rs` must mark an unstaged edit `-dirty`, and the suite must refuse the default results path when the build is dirty. Verify with a planted edit. — *author; CTO, QA*
- [ ] **D2 — F-14 (RES-04).** A replicate or exploratory run must never overwrite `research/results/<commit>/<name>.json`, and the summarizer must print a banner for `not_the_published_run`, `exploratory` or `-dirty`. — *author; research-engineer*
- [ ] **D3 — F-32 (DOC-08 = RES-05).** Mark crossings below 200 frames per point as exploratory, or correct AGENTS §5 and research-process §2. — *author; docs-honesty-auditor*
- [ ] **D4 — F-38 (RES-10).** `compare_results.py` and `summarize_suite.py` must fail on a missing benchmark and must compare `seed`, `frames_per_point` and instrument identity. — *author*
- [ ] **D5 — For any figure that claims a change between commits.** RES-01 and RES-02 must be in place (draft P1, whose decision rule is fixed in 06 §3), and the crossing-delta statistic must be settled (F-40, RES-16: a process change). — *research-engineer, author; board for the process*
- [ ] **D6 — B12**, plus the provenance fix in F-34 (QA-01 = RES-11) before any new `paired_receiver.py` result. — *author*
- [ ] **D7 — F-37 (RES-09).** Record the ISA features, RUSTFLAGS and the `Cargo.lock` hash in the provenance before exact reproduction is claimed across machines. — *author; QA*
- [ ] **D8 — Independent reproduction at the new commit.** Both commits rebuilt; counts identical. — *QA*
- [ ] **D9 — Figure-specific holds:**
  - perf is not quoted as current until re-measured on an idle host (F-35);
  - no fading SNR-accuracy claim is made, and `docs/receiver.md`'s pre-N-01 numbers are marked stale (F-24);
  - no AP figure is published until there is a production-OSD AP test and an AP-on false-decode run (F-26, F-33);
  - acceptance-changing proposals pre-register a gate-off false-decode bound; fix the `false.json` label and `upper95` (F-36, F-53, F-42);
  - the FT8 comparison: AGENTS §5 mandates the "1.6 dB more Eb/N0 per bit" sentence and DSP-02 disputes its framing, so only the board can change that wording (F-25, F-30).

  — *RF engineer, author; board for the §5 wording*
- [ ] **D10 — Record hygiene before these are cited again:** F-66 (DOC-17 = QA-05), F-67 (QA-04), F-65 (DOC-34 = QA-03), F-39 (RES-13). — *author; docs-honesty-auditor*
- [ ] **D11 — The board explicitly accepts the PR that carries the figure (research-process §4).** — *board*

---

## 1. Summary

- **Scope.** Six role reports audited `caf1a9a`: all of `crates/`, the workflows, `SPEC.md`, `docs/`, `wiki/`, `research/` and the published results. No change is proposed. The record adds only `audit/` files.
- **Headline:**
  - **Published figures:** every count that was rerun reproduced exactly (QA). The AWGN and fading figures stand.
  - **Receiver:** sound, with stated limits (DSP).
  - **Transmit path:** the CTO says CTO-01…04 must be fixed before any hardware test. Of 13 High findings in total, 9 are transmit-safety: a stuck-keyed failure mode, a US band plan that clears CW-only and off-channel dials, and 13 guarantees no test pins. There are also 2 benchmark-instrument defects that let a modified receiver publish under a clean commit label, or overwrite a published file.
- **Protocol change?** No. DOC-14 (SPEC omits the OSD condition) and DOC-15 (SPEC omits `CQ TEST`) are text corrections describing what both implementations already do. No report proposes a §6 change. P2 (Gray labelling) explicitly authorises none.
- **Results note:** not required (§7: documentation only). The suite is unchanged: `git diff caf1a9a 1304eae -- crates research` is empty. QA's rebuilt counts are bit-identical to `672cef9b3cdb/` and `18fbd78d8fb8/`.
- **Merge contents (§5):** not applicable. No figure moves and no `research/results/` directory is added. The JSON under `evidence/qa-reproduction/` is QA output, not a published result (05, header).
- **Proposals.** None is filed. 06 §3 drafts P1–P4, each with a decision rule written before any run. They are drafts in a report, not §1 proposals.

## 2. Reviews: verdict and commit reviewed

| Report | Agent | Verdict | Commit reviewed | Open findings |
| :--- | :--- | :--- | :--- | :--- |
| [01](01-code-review-cto.md) | `cto-code-reviewer` (Code, §3) | **READY AFTER FIXES**. Gates green on 1.95: fmt, clippy (both feature sets), 167 tests passed / 0 failed / 2 ignored | `caf1a9a` | CTO-01…17 (1 High, 7 Medium). Its "Build provenance" bullet is **overturned** (C-1, §3) |
| [02](02-transmit-safety.md) | `tx-safety-auditor` | **FINDINGS**: 22 (9 High, 5 Medium, 6 Low, 2 Info). 37 mutants: 23 killed, **14 survived**. All five survivors from the post-remediation audit are now killed | `caf1a9a` (checkout at `4cbf074`, `audit/` only) | TX-01…22 |
| [03](03-dsp-review.md) | `rf-dsp-reviewer` (DSP, §3) | **SOUND WITH STATED LIMITS**. All of its own runs are exploratory | `caf1a9a` (checkout at `4cbf074`; `crates/` diff empty) | DSP-01…13 |
| [04](04-docs-honesty.md) | `docs-honesty-auditor` | **34 findings** (1 High, 9 Medium, 23 Low, 1 Info). No hardware or on-air implication; no withdrawn figure quoted as current | `caf1a9a` | DOC-01…34 |
| [05](05-qa-reproduction.md) | `qa-reproducer` (QA, §3) | **PARTIALLY REPRODUCED**. Every rerun count, interval and crossing matches exactly | `caf1a9a`; plus builds of `672cef9`, `83b1b70`, `2f6519c` | QA-01…07 |
| [06](06-research-record.md) | `research-engineer` | Research record review. No existing result was produced under the research process (merged `3374f9f`, 2026-09-26) | `caf1a9a` | RES-01…16; drafts P1–P4 |

- **Missing:** none. All six requested roles reported. De-duplicated, they give 79 entries: 13 High, 27 Medium (one resolved at `207caac`), 34 Low-Medium/Low and 5 Info.
- **Not reviewed by any agent:** the 12 files `main` gained after `caf1a9a` (§7 below).

## 3. Facts established outside the reports (from the coordinator, checked here where possible)

- **C-1 — RES-03 stands; the CTO's "Build provenance" bullet is overturned.** The coordinator ran a tie-break with the real `build.rs` in a toy workspace. After an unstaged edit in a dependency crate, the binary ran the new code (`answer=4`) but printed the clean commit label, even after `git status`. The evidence is now in [evidence/c1-buildrs-tiebreak/](evidence/c1-buildrs-tiebreak/) (A2).
- **`main` moved during the audit.** PR #43 (`research/lock_closure.py`, research-process §7) and PR #42 (release `v0.1.0-experimental`) took `main` from `caf1a9a` to `207caac`. `git diff --stat caf1a9a origin/main` shows 12 files and no `crates/` source; `Cargo.toml` and `Cargo.lock` change only the version. **Every code finding therefore holds unchanged at `207caac`.** Two findings were checked against that diff:
  - **CTO-08 is resolved at `207caac`.** Commit `4f6bb01` moved to `macos-15` / `macos-15-intel`. Release dry run [36276432878](https://github.com/themantas1994/z-30/actions/runs/36276432878), at `6607b1e`, built all four targets green on those runners. `publish` was skipped because no tag exists and has never run. No agent reviewed that change.
  - **DOC-18 still holds at `207caac`.** `docs/troubleshooting.md` changed only its version line, to `0.1.0-experimental`. It still lists four refusals where the binary gives six, and still lacks the `data dir:` and `audio:` lines.
- **`main` CI is red since `207caac`** ([job 108860715266](https://github.com/themantas1994/z-30/actions/runs/36401634810/job/108860715266)).
  - The failing job is "Paired oracle-vs-production harness drives the shipped decode_slot".
  - Cause: unpinned maturin (1.15.0) rejects `0.1.0-experimental`, which `z30-py` inherits, as not PEP 440.
  - The coordinator reproduced it and verified a patch (`version = "0.1.0-dev.0"` in `crates/z30-py/Cargo.toml`). The patch is posted as a PR #45 comment and not pushed.
  - Checked here: the same job had already failed twice on PR #42's own head `6607b1e` before #42 was merged (2026-09-28T09:08:46Z).
- **Observed here, in no report:**
  - At `207caac`, GitHub's Dependabot security-update job for `pyo3` in `/crates/z30-py` failed ("failed to find a workspace root"). The advisory range it was acting on is `< 0.29.0`, and `Cargo.lock` has `pyo3 0.25.1`, both at `caf1a9a` and at `207caac`.
  - `z30-py` is research-only and never shipped. The advisory's content was not examined. This belongs with F-50 (CTO-13). — *CTO*

## 4. Open findings, de-duplicated and ranked by severity

- **Merging.** Duplicates are merged, and every source ID is named.
- **Severity.** Where two reports rate one issue differently, the higher rating is used and noted.
- **Status at `207caac`.** Unchanged unless the entry says otherwise: no `crates/` source changed.

### High (13)

| # | Finding | Sources |
| :--- | :--- | :--- |
| F-01 | A failed PTT release is never retried or reported. The controller and watchdog believe the line is released, so the radio can stay keyed until its own time-out timer. Shown by probe | **TX-01 = CTO-01** |
| F-02 | The US band plan clears data emissions in CW-only 50.0–50.1 and 144.0–144.1 MHz and off-channel on 60 m (5.366, 5.338 MHz shown by probe). The IARU tables are whole-band, not data segments | TX-02 |
| F-03 | "Verified = transmitted" is tested only as far as the FEC corrects: N3-sym survives | TX-03 |
| F-04 | The production transmit loop in `runtime.rs` is untested: RT-halt, RT-wd, RT-keyfail and RT-unkey survive | TX-04 |
| F-05 | The gate's emission-edge arithmetic is not pinned: G-bw, G-centre and G-top survive | TX-05 |
| F-06 | `MAX_TX_SECONDS = 40` is not pinned (P-max), and the panic-hook layer is untested (P-hook) | TX-06 |
| F-07 | The NaN refusal and the ≤ 1.0 transmit-level clamp are untested (G-nan, N3-level). `config.toml` accepts `nan` | TX-07 |
| F-08 | The loopback-isolation guard is a textual deny-list that LOOP-e bypasses | TX-08 |
| F-09 | The provenance of configured power is not pinned (PWR-a) | TX-09 (High, test gap) |
| F-10 | wiki/15 shows a new install with `dial_hz = 14076000` and `tx_level = 0.5`, and says `--migrate` writes exactly that. Both claims are false | DOC-01; code side is F-21 |
| F-11 | No per-frame outcomes are recorded, so a paired McNemar between two commits cannot be computed | RES-01 |
| F-12 | The candidate compiles its own instrument (SNR grids, placement, criteria, channel, modulator), and the provenance does not identify it | RES-02 |
| F-13 | `build.rs` labels a binary built with an unstaged edit in a dependency crate as a clean commit | **RES-03** (C-1 resolved in its favour; the CTO's "Build provenance" bullet is overturned). QA's provenance note relies on it |

### Medium (27, one resolved at `207caac`)

| # | Finding | Sources |
| :--- | :--- | :--- |
| F-14 | A replicate or exploratory run silently overwrites the published-seed file, and the summary hides it (demonstrated) | RES-04 (Medium-High) |
| F-15 | A panic inside `PttLine::set` deadlocks the panic hook, the watchdog and the signal handler (probe; exposure latent) | **CTO-02 = TX-11** |
| F-16 | HALT goes through a bounded, droppable channel, and the GUI never calls `emergency_unkey`. The control thread does blocking I/O (`timedatectl` with no timeout, the key, SQLite) | **CTO-03 = TX-10** |
| F-17 | A late key truncates the frame (probe: 23.80 of 24.00 s) and still reports it `completed`. A 73/RR73 can then be logged as complete | **CTO-04 (Medium) = TX-14 (Low)**; Medium used |
| F-18 | The rig thread ignores the PTT settle window and `poll_interval_ms`, contrary to five texts. A failed mode query leaves a stale mode counted as fresh | **CTO-05 (Medium) = TX-19 (Low)**; Medium used |
| F-19 | Output-device errors are swallowed (`\|_err\| {}`). A failed `play` leaves a partial frame queued with no `stop()`. The output callback has no allocation test | **CTO-06 (Medium) = TX-16 (Low) + TX-17 (Low)**; Medium used |
| F-20 | The GUI falls back to an in-memory logbook and still says "Logged" | CTO-07 |
| F-21 | `--migrate` always writes `tx_level = 0.5` and imports any non-`NOCAL` call, including the legacy default W1AW, with PTT, dial, region and class | **TX-13 = DOC-02** |
| F-22 | `can_transmit` returns `allowed: true` without the PTT, hardware and level checks, which are added only in `plan_tx` | TX-12 |
| F-23 | The release workflow targets retired `macos-13` | CTO-08. **Resolved at `207caac`** (§3); publish is still unexercised |
| F-24 | The SNR estimate reads low on the corrected Watterson channels (poor: −1.7 dB at +10 dB, −6.3 dB at +20 dB; exploratory). `docs/receiver.md` figures predate N-01 | DSP-01 (with N-08; draft P3) |
| F-25 | The FT8 comparison compares receivers and conditions, not modulations. At CM capacity z-30 is 0.4 dB better per bit; FT8's −21 dB sits 0.18 dB from its own CM limit | DSP-02 |
| F-26 | The production AP path (`decode_with_ap` plus the corrected OSD) has no test and no AP-on false-decode figure. Migration can enable AP. wiki/17's fading row comes from withdrawn channel models and is unlabelled | DSP-03 (overlaps F-33) |
| F-27 | The tuning-resolution exemption is documented as working; production never measures a resolution (strict 1 Hz) | DOC-03 |
| F-28 | `docs/demodulation.md` §SNR describes the retired estimator and a −40 dB floor | **DOC-04** (confirmed by DSP) |
| F-29 | The wiki says decodes are labelled "pass 2/3"; neither the GUI nor the CLI shows it | DOC-05 |
| F-30 | wiki/Home, wiki/10 and wiki/16 FT8 comparisons do not quote "all of it" (AGENTS §5) | DOC-06 |
| F-31 | wiki/10 still presents the external E007 re-implementation as the protocol's validation (N-11 residual) | DOC-07 |
| F-32 | The suite marks runs exploratory below 100 frames; AGENTS §5, research-process §2 and two agent briefs say 200 | **DOC-08 = RES-05** |
| F-33 | wiki/17 oracle AP figures are partly presented as z-30's, misstate AGENTS §5, and rest on unlabelled 60–80-frame points with no result file | DOC-09 (overlaps F-26) |
| F-34 | Paired-harness files record the checkout HEAD twice (two different commits per run) and never the wheel's commit, dirty state or rustc | **QA-01 = RES-11** |
| F-35 | `perf_k.txt` predates the replica fit (`d8983ee`) and is still presented as current. Its p99 over 20 slots is the maximum. It has no embedded provenance (nor has `false_decodes_2000.txt`). Its 4-thread allocation column is not deterministic | **RES-06 (Medium) = DSP-06 (Low) + QA-02 (Low–Medium) + QA-07 (Info)**; Medium used |
| F-36 | The suite's false-decode benchmark (2000 slots) lacks the power for acceptance-changing proposals | RES-07 |
| F-37 | The provenance cannot support exact reproduction across ISAs (rustfft runtime SIMD) | RES-09 |
| F-38 | `compare_results.py` and the summarizer do not check completeness | RES-10 |
| F-39 | 19 audit `.log` evidence files cited by the corrective audit are dropped by `.gitignore` | RES-13 |
| F-40 | The research-process decision template has no statistic for a crossing delta | RES-16 (process) |

### Low-Medium and Low

| # | Finding | Sources |
| :--- | :--- | :--- |
| F-41 | The pass-2/3 candidate restriction is documented as "result unchanged" but was never measured | DSP-04 (Low-Medium) |
| F-42 | `upper95` underflows for large k·n. No published value is affected | RES-08 (Low-Medium) |
| F-43 | Device selection can drive the wrong interface: first C-Media device on an empty path, first substring audio match, and an unmeasured DTR/RTS blip on serial open | **TX-20 = CTO-12** |
| F-44 | `key()` re-arms the watchdog deadline (latent) | TX-15 |
| F-45 | Rig readback is checked only at plan time; a refused set-frequency is not a refusal while settling | TX-18 |
| F-46 | The watchdog does nothing for VOX; `WatchdogReleased` and `Audio` events are dead; a watchdog release is unreported unless the timeline is busy | **CTO-14 (Low) = TX-22 (Info)**; Low used |
| F-47 | Output-latency compensation is racy and usually zero | CTO-09 |
| F-48 | A backward clock step silently suspends decoding (150 s gap by probe) | CTO-10 |
| F-49 | The Tune carrier is generated outside `gfsk::Modulator`, with a linear ramp | CTO-11 |
| F-50 | No advisory scan of the production Rust tree; actions pinned by tag. Also the pyo3 Dependabot failure (§3) | CTO-13 (+ liaison observation) |
| F-51 | Clippy and npm commands in README and wiki/16 differ from CI | **CTO-15 = DOC-21** |
| F-52 | SIC co-location boundary unstated (confirmed mechanism; exploratory boundary data) | DSP-05 |
| F-53 | `false.json`'s "0 dB" random-FSK interferers are at −3 dB | DSP-07 |
| F-54 | Impairments are applied at 6 kHz after resampling; the docs do not say so | DSP-08 |
| F-55 | L-05 can be closed for AWGN by symmetry; exploratory fading data shows no effect | DSP-09 (draft P2) |
| F-56 | An out-of-range SNR is sent as a number (a clamped +30 means "≥ +30") | DSP-11 |
| F-57 | `suppression_db` overstatement range incomplete (9–16 dB); the mechanism is the projector's non-idempotence | **DOC-19 (Low) + DSP-10 (Info)**; Low used |
| F-58 | wiki/17 describes the retired app's AP setting and placeholder callsign | DOC-10 |
| F-59 | wiki/04: trellis stop rule and OSD gates misstated against SPEC; the p-value box is wrong (2.4e-7) and read as confidence | DOC-11, DOC-12 |
| F-60 | `docs/ldpc.md` says the logbook does not record AP use; it does | DOC-13 |
| F-61 | SPEC omits "OSD only if min syndrome ≤ 14" and `CQ TEST` | **DOC-14** (confirmed by DSP), DOC-15 |
| F-62 | "Bit for bit" applied to the waveform (tolerance 1e-6). **Also at `207caac` in the release notes, line 11** | DOC-16 (+ liaison observation) |
| F-63 | Stale or unsupported statements: diagnostics sample (**still holds at `207caac`**, §3); suite runtime; wiki/16's "200 frames" for the SNR row | DOC-18, DOC-20, DOC-27 |
| F-64 | Figures missing conditions or a source: tone range and ppm (wiki/03), Home 90% interval, occupied bandwidth with no result file, README fading line, the docs/README "every figure names a file" claim | DOC-22, DOC-23, DOC-24, DOC-25 |
| F-65 | `d8983eeef66e/SUMMARY.md` header differs from the script and has no withdrawn marker (correctly not regenerated) | **DOC-34 (Info) = QA-03 (Low) = RES-12.2 (Low)**; Low used |
| F-66 | The sd 0.048 dB is over 11 runs, not "ten replicates" (0.0496 over ten) | **DOC-17 = QA-05 = RES-12.3** |
| F-67 | `18fbd78d8fb8/` has no `SUMMARY.md`; the pooled figure is computed outside `research/` | **QA-04 = RES-12.1** |
| F-68 | Wording: "on-air decoder" for legacy; "in this repository's CI"; "threshold" used for the oracle | DOC-26 |
| F-69 | Broken anchor, backspace bytes in the wiki/04 formula, sidebar links | DOC-28, DOC-29, DOC-30 |
| F-70 | README's "full list" of limitations is stale (lacks N-04 residual, N-08, N-12, N-15) | DOC-31 |
| F-71 | The capture → resampler → scheduler chain is in no benchmark and absent from "Not measured"; no input-level variation | **DOC-32 (Low) + RES-15 (Low/Info)**; Low used |
| F-72 | Docs tables are reformatted, not literally "pasted"; every value checks | DOC-33 (+ 06 §1, first row) |
| F-73 | Record hygiene: loose result files at the `research/results/` root; the G2.3 OSD result has no file | RES-12.4, RES-12.5 |
| F-74 | Seed field layout has no bounds check (> 2^20 frames) | RES-14 |

### Info

| # | Finding | Sources |
| :--- | :--- | :--- |
| F-75 | `TxPlan` is constructible without the gate (no bypass today) | TX-21 |
| F-76 | The thread-count determinism test is vacuous on 1 CPU, and `docs/receiver.md` cites the wrong test for it | **CTO-16 + DSP-12** |
| F-77 | Counting `#[global_allocator]` in the shipped `z30`; `z30-io`, `z30-gui` and `z30-channel` do not declare `forbid(unsafe_code)` | CTO-17 |
| F-78 | Code d_min ≤ 14 near the OSD and trellis gates; clock stretch applied from the window start | DSP-13 |
| F-79 | README credits `awgn_paired_200` to rustc 1.94.1, below the MSRV | QA-06 |

**Carried open from earlier audits** (CTO table), each also a limit on what is claimed:
- **N-15:** `cargo build --workspace` needs Python. The CI failure in §3 is a sibling issue.
- **H-02:** hardware validation.
- **M-08:** PTT after SIGKILL.
- **L-05:** see F-55.
- **N-08:** see F-24.
- **N-12:** see F-71.
- **H-06, H-07, L-07:** partial.

**Coverage check.** Every source ID maps to an entry above: CTO-01…17, TX-01…22, DSP-01…13,
DOC-01…34, QA-01…07 and RES-01…16 (RES-12's five parts separately).

## 5. Verified and holds (at `caf1a9a`)

**Build and tests**
- MSRV 1.95 gates are green: fmt, clippy with and without cm108, and 167 tests passing (01).
- Oracle `FROZEN.sha256` holds 9/9 (01).

**Transmit gate and transmit path (02, 01)**
- `can_transmit` is the only gate in front of the sequencer, manual TX and Tune. It collects every violation and has a double fail-closed guard. F-22 is the exception.
- `VerifiedFrame` has a single constructor plus a compile-fail doctest.
- The C-06 whole-frame round trip is killed by two tests.
- A release drives what the key drove.
- `--audio-loopback-test` refuses VOX, PTT and rig before opening any device.
- `QsoRecord::validate` holds.
- Dial provenance (N-05) holds.
- The input audio callback is allocation-free, and tested.
- rigctld PTT runs on its own connection with timeouts.
- A new installation (without migration) cannot transmit.
- 23 of 37 mutants are killed, including all five earlier survivors.

**Earlier audit items (01)**
- N-01, N-02, N-03, N-04 (software), N-05, N-06, N-07, N-09, N-13 and N-14 hold at HEAD.

**Receiver (03)**
- There is one blind receive path, and nothing in it can see the truth.
- The SNR definition (SPEC §10) is correct in both the channel model and the estimator. The estimator is not the M-07 one.
- Watterson ensemble normalisation and the N-01 2σ Doppler are correct.
- Modulator phase and envelope, plus the Costas, CRC and LDPC constants, are unchanged.
- The AWGN crossing is 0.6 dB from its waveform BICM limit, which is plausible, with no sign of truth leakage.
- Determinism holds: seeds are a bijection, and the dither comes from the LLRs.

**Published figures (05, 04, 06)**
- Rerun counts are bit-identical:
  - AWGN at `672cef9` and at `caf1a9a`: −23.03 [−23.13, −22.89] / −22.06 [−22.15, −21.80];
  - all 25 fading points, crossings −20.94 / −21.37 / −20.88, with no decode on high-latitude moderate;
  - replicate 7;
  - `false_decodes_2000.txt` in full;
  - the `perf_k.txt` counts and single-thread allocations.
- The results are identical across rustc 1.98.1 and 1.95.0.
- The pooled figure reproduces: −23.00 [−23.04, −22.96].
- `672cef9b3cdb/SUMMARY.md` regenerates byte-identical.
- Every suite figure in the docs matches its JSON.
- Withdrawn figures appear only as history.
- No document implies hardware or on-air validation.

## 6. Validation state

**Protocol validated. Software simulation validated. Hardware not validated. On-air not
validated.**
- No agent opened a radio, sound-card output, PTT line, CM108 device, serial port or rigctld. **Nothing was keyed.**
- `--audio-loopback-test` was not run.
- The only PTT behaviour exercised was on fake lines in throwaway probes and worktrees.
- `hardware-validation/results/` is empty.

## 7. What the reviews did not cover

**`main` after `caf1a9a`**
- Nobody reviewed the `207caac` changes: `release.yml` rework, the release notes, `install.md`, `research/lock_closure.py`, the research-process §7 addendum, wiki/09 and wiki/12. This packet only checked CTO-08, DOC-18 and the notes lines cited in C2.

**Hardware**
- Everything hardware-dependent: serial RTS/DTR timing, CM108 GPIO, rigctld against a real radio, cpal latency and error reporting, VOX, the emitted spectrum, and M-08.

**CI and platforms**
- GitHub CI runs themselves (only the workflows were read). Windows and macOS back ends.
- The per-OS coverage of the ctrlc signal handling.

**Reference code**
- `reference/golden/generate.py --check`, the oracle's pytest, `test_watterson_doppler.py`, and the legacy npm tests. NumPy and Node were not installed.

**Benchmarks not reproduced**
- `awgn_paired_200` and `whitening_ab_200` (no maturin or numpy).
- The eight other `672cef9b3cdb` benchmarks. They are cross-checked only as identical between two published runs.
- Replicates 1–6 and 8–10.
- The full suite as one job.
- Latency, throughput and CPU (host load 9–19).

**Untested properties**
- Cross-ISA reproducibility (RES-09) and input-scale invariance (RES-15).
- Gated AP false-accept through `decode_slot`.
- DSP mutation testing (relied on the corrective audit §G).
- Pair mutations of the redundant round-trip checks.

**Out of scope or not examined**
- The GUI on a real display. `z30-py` and a `cargo build --workspace` including it.
- Non-US band-plan detail.
- External FT8/WSJT-X claims.
- Oracle-era and audit-era figures quoted in prose (M-07, E013, E047, E051, wiki/04's 240-frame study, the wiki/17 sweep counts beyond arithmetic).

## 8. Question for the board

Does the board accept, reject, or request more evidence on PR #45 — at the head commit that
adds this file on top of `1304eae` (audit record only; subject `caf1a9a`) — as the evidence of
record for this audit, with blocker lists §0 B and §0 D as the gates before any dummy-load test
and before the next published figure?
