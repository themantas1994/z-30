# Removal plan — 2026-10-06

Derived from `INVENTORY.md`. Each phase is one coherent commit series on one branch, and each
item states what replaces the guarantee it carried, if it carried one. Git history keeps every
removed file: the last commit that contains all of them is `acfce5e`.

## Phase B — legacy stacks

| Remove | Replacement for what it guaranteed |
| :--- | :--- |
| `legacy/browser-runtime/` (66 files, npm lock file) | none needed: no production consumer. `messages.json` stays as a frozen fixture |
| `legacy/python-oracle/` (25 files) | the golden fixtures it generated (kept, hash-pinned) and the Rust tests in `INVENTORY.md` §3 |
| `legacy/README.md` | — |
| `crates/z30-py/` and with it `pyo3`, `maturin` metadata | none: research-only bindings for the oracle harness |
| `reference/golden/` (both generators) | `fixtures/golden/FROZEN.sha256`, checked in CI: the fixtures can no longer be regenerated, so the check is that they do not change |
| `research/paired_receiver.py` | the paired result it produced stays in `research/results/` as evidence |
| CI: `oracle`, `legacy-browser`, `dependency-audit` (ci.yml); `golden`, `harness` (rust.yml) | `hygiene` gains the fixture hash check; the RustSec job loses its two `pyo3` ignores |
| Dependabot `pip` entry | — |
| every `--exclude z30-py` in CI and docs | — |
| `wiki/08-Web-&-PWA-Architecture.md` | — (its history is in the audits) |

Added in the same phase, so no guarantee is lost:
- Rust tests on `tests/vectors/{crc14,dither,callsign_pack}_vectors.json`.
- `crates/z30-dsp/tests/modulator_spectrum.rs`: the oracle's spectrum budgets (99 % ≤ 52 Hz,
  −40 dB ≤ 72 Hz, a per-symbol-gated reference must exceed 2 × 72 Hz, ramps, tone at symbol centre,
  finite and normalised), on the production modulator.
- `fixtures/golden/FROZEN.sha256` over all 19 fixture files (`MANIFEST.json` never covered
  `messages.json`).

Moved, not deleted: `VNEXT_IMPLEMENTATION_PLAN.md` → `audit/2026-09-23-vnext/VNEXT_IMPLEMENTATION_PLAN.md`
(a historical record, referenced from AGENTS.md and SPEC.md).

PR #48 becomes moot. PR #49: drop `pyo3` (the crate is gone); `rand*` and `toml` stay at their
current versions here (see `INVENTORY.md` §6).

## Phase C — dependencies

Remove the unused declarations in `INVENTORY.md` §1, make `rayon` a plain dependency of
`z30-dsp` (the `parallel` feature is never off), use `rtrb.workspace = true`, regenerate
`Cargo.lock` with `cargo update --workspace` (no version changes), then run check, clippy and
test.

## Phase D — dead code

Delete the unreferenced items in `INVENTORY.md` §1 and `examples/smoke.rs`, except the two
inside the benchmark instrument's hashed files (see there): no file under
`crates/z30-{protocol,channel}/{Cargo.toml,src}` changes in this cleanup, so the instrument
identity stays that of the published results. The two that
touch transmit-adjacent files (`RigStateTracker::note_requested_mode`/`commanded_mode`,
`RuntimeHandle::emergency_unkey`) remove only code nothing calls and change no state machine;
they are still reviewed by `tx-safety-auditor`.

## Phase E — simplification

Only where the measurement or the compiler shows something redundant; no algorithmic change and
nothing in the transmit state machine.

## Phase F — performance

Measure `decode_slot` per stage (`examples/stages.rs`, `z30 --benchmark perf`) and allocations,
change only a measured hot spot, prove the receiver bit-identical (golden tests, determinism
tests, a seeded suite subset compared with `compare_results.py`). Results in `PERFORMANCE.md`.

## Phase G — CI and build

Measure check, clippy, test and release build before and after (`measure.sh`). Remove the
obsolete jobs above.

## Phase H — documentation

Rewrite the current-state documents (`README.md`, `SPEC.md`, `AGENTS.md`, `docs/`, `wiki/`, agent
prompts) so nothing describes the removed stacks as present. Audit reports are not edited.

## Explicitly retained

| Kept | Why |
| :--- | :--- |
| `research/*.py` (five stdlib-only tools) and `research/tests/` | they are the current research process (`docs/research-process.md` §2, §7), fail closed and are tested; nothing in the Cargo graph depends on them. A Rust port is possible but changes the measurement instrument and its byte-for-byte `SUMMARY.md` regeneration; it should be its own reviewed pull request, not part of a deletion |
| `fixtures/golden/*`, `tests/vectors/*` | known answers produced by an independent implementation; that independence is the reason to keep them after the implementation is gone |
| `crates/z30-io/src/migrate.rs` | `z30 --migrate` imports an operator's settings and logbook from the retired app, and PR #46's migration-safety tests cover it. It reads files, not code, so it does not depend on the deleted stacks |
| `z30-channel` | used by the suite and by tests; not on the receive path |
| `audit/**` | historical record |
