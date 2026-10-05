# QA verification of F-34 (paired-harness provenance) at 7483f17

**Verdict: F-34 VERIFIED at 7483f17.** I built the wheel from a clean tree, then from a tree dirtied in `crates/z30-dsp`, and ran the paired harness each time. Both the wheel and the result file record the wheel's commit, dirty state, diff hash and rustc. They also record the checkout. Every dirty or mismatched case came out `not_the_published_run` with a specific reason for each problem; the clean case came out `attributable`. The checkout is no longer recorded twice: the old top-level `git` key is gone and the checkout appears once, under `provenance.checkout`.

No hardware was involved. I never touched `/home/user/z-30` except for `git worktree add` and `git worktree remove`.

**Setup**
- Worktree: `git worktree add --detach /tmp/claude-0/qa-f34 7483f17`. `git status --porcelain` was empty and HEAD was 7483f1780800d691db3eb4c6f92971e10689bf4d.
- Build: `RUSTUP_TOOLCHAIN=1.95` (the MSRV; this host's default `stable` is 1.94.1) and `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target`.
- Venv: `/tmp/claude-0/mvenv` (Python 3.11.15, numpy 2.2.6, scipy 1.15.3, maturin 1.15.0).

**How CI's harness job builds and runs it** (`.github/workflows/rust.yml`, job `harness`)
- It runs `cd crates/z30-py && maturin build --release -o ../../wheels`, then `pip install ../../wheels/z30-*.whl`.
- Then it runs `python research/paired_receiver.py --min-snr -20 --max-snr -20 --frames 4 --workers 2 --out smoke.json`.
- It checks only `vnext==4`, `oracle==4` and `vnext_false==0`. I reproduced exactly this setup, adding only `--locked`.

**Runs and the fields I observed** (every run gave 4/4 vNext, 4/4 oracle and 0 false decodes, so CI's checks pass)

0. **Wheel already in the venv, before I rebuilt anything.** It was a leftover from an earlier build, b37a969 dirty.
   - `provenance.checkout` = `"7483f1780800"`
   - `wheel.commit` = `"b37a969ab3dc-dirty"`, `wheel.dirty_diff_sha256` = `"79cc924df825"`, `wheel.rustc` = `"rustc 1.95.0 (59807616e 2026-04-14)"`
   - `status` = `"not_the_published_run"`
   - `status_reasons` = `["wheel b37a969ab3dc-dirty", "wheel built from b37a969ab3dc-dirty, harness at 7483f1780800"]`
   - So a stale wheel from a different commit is now caught.

1. **Clean wheel from the clean worktree.**
   - `z30.build_info()` = `{commit: "7483f1780800", dirty_diff_sha256: "", rustc: "rustc 1.95.0 (59807616e 2026-04-14)", profile: "release", target: "x86_64-unknown-linux-gnu", rustflags: "", cargo_lock_sha256: "77ff31e623f222c34872c80dc37693b80efe02de02a9cfff08d039fdac744a83", built: "2026-10-05T19:05:32Z"}`
   - Result: `checkout` = `"7483f1780800"`, `status` = `"attributable"`, `status_reasons` = `[]`. The summary has no `git` key.

2. **Dirty tree.** I appended `// QA F-34 dirty-tree probe (comment only)` to `crates/z30-dsp/src/sync.rs`, then rebuilt and reinstalled.
   - The build recompiled z30-dsp and z30-py, so the build script did rerun.
   - My own `git diff HEAD --binary | sha256sum` gave `5a83055648e9`.
   - Result: `checkout` = `"7483f1780800-dirty"`, `wheel.commit` = `"7483f1780800-dirty"`, `wheel.dirty_diff_sha256` = `"5a83055648e9"`, which matches my independent hash.
   - `status` = `"not_the_published_run"`, `status_reasons` = `["checkout 7483f1780800-dirty", "wheel 7483f1780800-dirty"]`

3. **Source reverted (`git checkout --`, tree clean), dirty wheel still installed.**
   - `checkout` = `"7483f1780800"`, `wheel.commit` = `"7483f1780800-dirty"` (diff `5a83055648e9`)
   - `status` = `"not_the_published_run"`, `status_reasons` = `["wheel 7483f1780800-dirty"]`
   - A dirty wheel run from a clean checkout is flagged on the wheel alone, which is exactly the failure F-34 describes.

4. **Rebuilt after the revert.** z30-dsp recompiled.
   - `wheel.commit` = `"7483f1780800"`, `dirty_diff_sha256` = `""`, `built` = `"2026-10-05T19:07:32Z"`
   - `status` = `"attributable"`, `status_reasons` = `[]`. The label goes back to clean.

**Findings (none of these block F-34)**
- **Low: CI never checks the provenance.** The `harness` job asserts only the decode counts. If `build_info` regressed, or provenance were missing, CI would stay green. The ledger row's "CI's paired-harness job runs it on every push" is true, but that job does not test F-34. A suggested assertion: `s["provenance"]["wheel"]["commit"] == s["provenance"]["checkout"]` and `status == "attributable"`.
- **Info: target features not exposed.** `build_info()` leaves out `Z30_BUILD_TARGET_FEATURES`, even though `build_support::emit` produces it. The ledger asks for commit, dirty state and rustc, which are all present.
- **Info: two cases not exercised.** I did not test a wheel built before `build_info` existed (the `"unknown (wheel predates build_info)"` branch). I also did not test an untracked new file under `crates/` as the only dirtiness.
- **Info: the venv's wheel has changed.** `/tmp/claude-0/mvenv` now holds the clean 7483f17 wheel from run 4, where before it held the b37a969-dirty one.
- **Info: the main checkout moved while I worked.** `/home/user/z-30` is now at HEAD 4cf3021 with ` M crates/z30-cli/src/loopback.rs`. I did not make either change; something else did, during my run. My verification is of 7483f17.

**Cleanup**
- I removed `/tmp/claude-0/qa-f34` with `git worktree remove`.
- Evidence is kept in `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/f34/`: `run0_stale_wheel.json`, `run1_clean.json`, `run2_dirty_both.json`, `run3_dirty_wheel_clean_checkout.json`, `run4_reverted.json`, plus the wheels in `wheels-clean/`, `wheels-dirty/` and `wheels-reverted/`. The `wheels-dirty/` one is labelled dirty and must not be used for real runs.

**Commands to rerun** (with `S=<scratch>/f34`; each run's result was then read with `json.load`, looking at `['provenance']`)
```
git worktree add --detach /tmp/claude-0/qa-f34 7483f17
cd /tmp/claude-0/qa-f34/crates/z30-py && RUSTUP_TOOLCHAIN=1.95 CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target PATH=/tmp/claude-0/mvenv/bin:$PATH maturin build --release --locked -o $S/wheels-clean
/tmp/claude-0/mvenv/bin/pip install --force-reinstall --no-deps $S/wheels-clean/z30-*.whl
cd /tmp/claude-0/qa-f34 && /tmp/claude-0/mvenv/bin/python research/paired_receiver.py --min-snr -20 --max-snr -20 --frames 4 --workers 2 --out $S/run1_clean.json
echo "// QA F-34 dirty-tree probe (comment only)" >> crates/z30-dsp/src/sync.rs   # then the same build (-o $S/wheels-dirty), install and run -> run2
git checkout -- crates/z30-dsp/src/sync.rs                                       # run again with no rebuild -> run3; rebuild -> run4
git worktree remove /tmp/claude-0/qa-f34
```
