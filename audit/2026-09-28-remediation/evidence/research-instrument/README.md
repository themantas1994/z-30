# Research-instrument remediation: evidence

Branch `remediation/research-instrument`, for the 2026-09-28 agent-team review's findings
F-11, F-12, F-13, F-14, F-32, F-36, F-37, F-38, F-39, F-40, F-42 and F-53
(`audit/2026-09-28-agent-team-review/07-board-packet.md`). Software only. No radio, sound
card, PTT line or rig was opened, and nothing was keyed.

| File | What it shows |
| :--- | :--- |
| `f13_toy_dirty_label.sh`, `f13_toy_dirty_label.output.txt` | F-13 reproduced and fixed in a toy workspace, as in the C-1 tie-break. With the build script at `78db463`, an unstaged edit in a dependency crate gives a binary with the new behaviour (`answer=4`) and the clean label. With the fixed script the label is `-dirty` until the edit is reverted (clean again) or committed (new commit) |
| `f13_f14_real_repo.sh`, `f13_f14_real_repo.output.txt` | On a scratch clone of the real repository: (1) clean label; (2) after an unstaged comment in `crates/z30-dsp/src/slot.rs`, `<commit>-dirty` with a diff hash, a default run goes to `research/results/unpublished/<commit>-dirty-<diff>/` with `status: dirty`, and `--out research/results/<commit>` is refused without creating the directory; (3) revert: clean again; (4) the whole suite at 3 frames per point (exploratory) with the `78db463` binary and the remediated one: `research/compare_results.py` finds all ten benchmarks IDENTICAL. The only notes are the new fields and the relabelled 16-FSK row |

Regression tests carry the rest (all in the branch):

- `crates/z30-cli/build_support.rs` (unit tests, run with `cargo test -p z30-cli`): SHA-256
  against the FIPS 180 examples, the z30 binary watching every workspace crate it is built from,
  and the `Cargo.lock` parser.
- `crates/z30-cli/src/suite.rs`: the frame policy, routing and refusals for dirty,
  replicate and exploratory runs, the rule that nothing overwrites a published result, the
  −3 dB arithmetic behind the relabel, and the false-decode power note.
- `crates/z30-cli/src/bench.rs`: `upper95` against exact Clopper–Pearson values for k > 0 at
  large n, the k = 0 closed form, and bit-identity with every published bound.
- `crates/z30-cli/tests/suite_output.rs`, through the shipped binary: status, provenance,
  per-frame file totals and seeds, refusal to overwrite, and refusal to replace a published file.
- `research/tests/` (`python -m pytest research/tests -q`): the summariser regenerates
  `672cef9b3cdb/SUMMARY.md` byte for byte and refuses or banners everything else; the comparison
  and McNemar tools fail closed.
