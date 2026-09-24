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
  z30-py                    Python bindings of decode_slot, for research/ only (never shipped)
docs/                       developer documentation of crates/ (describes the code as it is)
wiki/                       operator documentation (this wiki)
SPEC.md                     the normative v1 protocol specification
fixtures/golden/            golden vectors generated from the frozen oracle (never hand-edited)
reference/golden/           the generators that produce them
research/                   paired oracle-vs-production harness and every published result file
tests/vectors/              shared known-answer vectors (CRC, callsigns, dither)
legacy/python-oracle/       FROZEN Python reference implementation - not production
legacy/browser-runtime/     RETIRED browser transceiver - reference only, never built or shipped
audit/                      the audits and this remediation's evidence
hardware-validation/        records of hardware tests (none yet)
```

Nothing in `crates/` depends on `legacy/`; the dependency runs the other way, through golden
vectors and paired comparisons.

## Build and test

```bash
# Rust 1.95+, plus on Linux: libasound2-dev libudev-dev and the X11/Wayland dev packages
cargo build --release -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
cargo fmt --all --check
cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings
cargo test --workspace --exclude z30-py --release
```

Reference code, only when you touch what it guards:

```bash
pip install -r legacy/python-oracle/requirements.txt pytest
(cd legacy/python-oracle && python -m pytest tests -q)
python reference/golden/generate.py --check
(cd legacy/browser-runtime && npm ci && npm run lint && npm run test:ts)
npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts --check
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
- **The oracle is frozen.** Changing `legacy/python-oracle/z30_dsp` means updating
  `FROZEN.sha256` in the same commit and saying why.
- Conventional commits: `feat(dsp):`, `fix(engine):`, `docs(wiki):`.

## Documentation

- `SPEC.md` is normative for the protocol.
- `docs/` describes the code in `crates/`; `wiki/` is operator documentation. They must agree;
  a contradiction is a bug to fix, not a preference to choose between.
- A benchmark or test result that contradicts documentation wins, once it is a controlled,
  seeded, paired measurement with a stated confidence figure; the documentation is then fixed.
- The wiki is plain markdown in the repository, edited by pull request. The retired browser
  app's in-app copy of the wiki is frozen and no longer regenerated.
