# 02. Developer Setup & Contributing

z-30 is one application: the Rust workspace in `crates/`. The full developer reference is
[`docs/development.md`](../docs/development.md) and [`docs/architecture.md`](../docs/architecture.md);
this page is the orientation.

## Repository layout

```text
crates/                     THE APPLICATION (Rust)
  z30-protocol              v1 constants, Costas pattern, CRC-14, LDPC encoder, message codec, GFSK modulator
  z30-dsp                   the receiver: decode_slot (acquisition, demodulation, LDPC, AP, SIC)
  z30-engine                slot clock, scheduler, QSO sequencer, transmit gate, rig tracker, PTT safety
  z30-io                    cpal audio, rigctld, serial/CM108 PTT, SQLite + ADIF logbook, migration
  z30-cli                   `z30`: receive-only station, decode, encode, diagnostics, benchmark suite
  z30-gui                   `z30-gui`: the desktop station (egui)
  z30-channel               seeded channel models for tests and benchmarks (never in the receive path)
docs/                       developer documentation of crates/ (describes the code as it is)
wiki/                       operator documentation (this wiki)
SPEC.md                     the normative v1 protocol specification
fixtures/golden/            golden vectors from the deleted oracle: FROZEN, hash-pinned, never hand-edited
research/                   result tools (summarise, compare, pair; stdlib Python) and every published result file
tests/vectors/              shared known-answer vectors (CRC, callsigns, dither), asserted by Rust tests
audit/                      the audits and the remediation evidence (historical)
hardware-validation/        records of hardware tests (none yet)
```

Rust is the only implementation. The frozen Python oracle, the retired browser transceiver, the
generators of the golden vectors and the Python bindings of `decode_slot` were deleted in the
2026-10-06 cleanup ([audit](../audit/2026-10-06-codebase-cleanup/REMOVAL_PLAN.md); recoverable
from commit `acfce5e`). What they established about the Rust code stays as data: the golden
vectors, which can no longer be regenerated and are pinned by `fixtures/golden/FROZEN.sha256`,
and the shared vectors in `tests/vectors/`.

## Build and test

```bash
# Rust 1.95+, plus on Linux: libasound2-dev libudev-dev and the X11/Wayland dev packages
cargo build --release -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --release
```

The research tools and the frozen fixtures, only when you touch them:

```bash
python -m pip install pytest && python -m pytest research/tests -q   # Python 3.11+, stdlib otherwise
(cd fixtures/golden && sha256sum --check --strict FROZEN.sha256)
```

## Contribution rules

`AGENTS.md` at the repository root is the working context for human and AI contributors. The
rules that matter most:

- **One receiver, one modulator.** `decode_slot` and `z30_protocol::gfsk::Modulator` are the
  only ones. No second demodulator "for benchmarking"; no receive path may know it is being
  benchmarked.
- **Protocol constants are not code style.** CRC, LDPC table, Costas pattern, symbol map and
  codec are frozen by `SPEC.md` and the golden vectors; changing one is a protocol break.
- **Safety tests are not edited to pass.** If `crates/z30-engine/tests/safety.rs` fails, the
  change is wrong or the pull request explains why the guarantee still holds.
- **No invented values.** A displayed or logged value is measured, computed from measurements,
  labelled configuration, labelled simulation, or shown as unavailable. Never a plausible
  default.
- **Numbers need provenance.** A figure in documentation names its result file in
  `research/results/<commit>/`, its seed, frame count, channel and interval, and says it is a
  simulation until hardware says otherwise.
- **The golden vectors are frozen.** Their generator is gone, so `fixtures/golden/` is never
  edited or regenerated; CI checks every byte against `fixtures/golden/FROZEN.sha256`. If a
  golden test fails, the Rust side is wrong. Where the oracle itself was the defect (OSD, SPEC
  §7.1; the packer's silent transformations, SPEC §6), the vectors keep the oracle's behaviour
  and the tests encode the documented deviation.
- Conventional commits: `feat(dsp):`, `fix(engine):`, `docs(wiki):`.

## Documentation

- `SPEC.md` is normative for the protocol.
- `docs/` describes the code in `crates/`; `wiki/` is operator documentation. They must agree;
  a contradiction is a bug to fix, not a preference to choose between.
- A benchmark or test result that contradicts documentation wins, once it is a controlled,
  seeded, paired measurement with a stated confidence figure; the documentation is then fixed.
- The wiki is plain markdown in the repository, edited by pull request. The retired browser
  app's in-app copy of the wiki was deleted with it.
