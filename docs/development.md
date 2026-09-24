# Development

## Toolchain

- **Rust 1.95 or newer.** The workspace's `rust-version` is 1.95 (egui/eframe 0.36 needs it),
  and CI's `msrv` job builds and tests the whole workspace on exactly the version `Cargo.toml`
  declares, as well as on current stable. It used to declare 1.82, which could not build the GUI
  (2026-09-24 audit, H-08).
- **Linux system libraries** (the GUI and audio): `libasound2-dev libudev-dev libxkbcommon-dev
  libwayland-dev libx11-dev libxcursor-dev libxrandr-dev libxi-dev libgl1-mesa-dev`.
- **Python 3.10+** with `legacy/python-oracle/requirements.txt`, only for the frozen oracle, the
  golden generator and `research/`. `maturin` builds the bindings. The application needs no
  Python.
- **Node 22**, only for the TypeScript golden check and the retired browser runtime's reference
  tests (`legacy/browser-runtime`). The application needs no Node.

## Build and run

```bash
cargo build --release -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
./target/release/z30 --help
./target/release/z30 --devices
./target/release/z30 --migrate                    # import the legacy config and logbook
./target/release/z30 --receive --capture-slots slots/
./target/release/z30 --decode slots/<slot>.wav
./target/release/z30-gui
```

Configuration lives in `config.toml`, in `$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30`.
That is the directory the retired browser/Python app used, so migration finds its files. The logbook is
`logbook.sqlite` in the same place.

## Tests

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings
cargo test --workspace --exclude z30-py            # debug
cargo test --workspace --exclude z30-py --release  # what CI also runs; the DSP tests are much faster here
```

| Suite | Where | What |
| :--- | :--- | :--- |
| Golden | `z30-protocol/tests/golden.rs`, `z30-dsp/tests/golden_ldpc.rs`, `golden_demod.rs` | parity with the frozen oracle ([protocol-v1.md](protocol-v1.md), [ldpc.md](ldpc.md), [demodulation.md](demodulation.md)) |
| Property | `z30-protocol/tests/properties.rs` | codec round-trip and refusal over generated inputs |
| Round trip | `z30-protocol/tests/round_trip.rs` | every square, report and 40,000 sampled callsigns: sent exactly or refused |
| Channel | `z30-dsp/tests/channel_scenarios.rs` | `decode_slot` on seeded bands ([receiver.md](receiver.md)) |
| Sensitivity | `z30-dsp/tests/sensitivity_regression.rs` | 100 blind frames at −22 dB, ≥ 84 decoded: sized to catch a 0.5 dB loss |
| Measurement | `z30-dsp/tests/snr_accuracy.rs` | reported SNR and DT against the truth, −22 to +30 dB |
| SIC | `z30-dsp/tests/sic_regression.rs` | energy never rises, no decode from an empty subtraction, SIC on/off paired, thread-count determinism |
| Safety | `z30-engine/tests/safety.rs`, `emergency.rs` | every transmit-path rule, including the whole-frame round trip ([safety.md](safety.md)) |
| Live runtime | `z30-engine/tests/live_runtime.rs` | `runtime::start` on a virtual sound card: nothing decodes before the window closes; the decoded window is sample-exact |
| QSO / log | `z30-engine/tests/qso_logging.rs`, `z30-io/tests/logbook_integrity.rs` | only received/measured fields, UTC in any time zone, incomplete exchanges log nothing |
| Virtual clock | `z30-engine/tests/virtual_clock.rs` | 24 h soak and a closed-loop QSO ([synchronization.md](synchronization.md)) |
| Real-time | `z30-io/tests/callback_alloc.rs` | the capture callback never allocates ([audio.md](audio.md)) |
| Units | `src/**` `#[cfg(test)]` | resampler, clock, rig rules, logbook, migration, ADIF, SIC interpolation, … |

## Golden vectors

`fixtures/golden/` is generated from the frozen oracle and committed:

```bash
pip install -r legacy/python-oracle/requirements.txt
python reference/golden/generate.py            # regenerate
python reference/golden/generate.py --check    # CI: byte-identical or fail
(cd legacy/browser-runtime && npm ci)
npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts --check
```

Never edit a vector by hand. If the Rust side disagrees with a vector, the Rust side is wrong,
unless the oracle itself is the defect, as it was for OSD (M1). In that case the oracle's
behaviour stays in the vectors, a test-only transcription of it proves the rest of the decoder
exact, and the deviation is documented in `SPEC.md`.

## Research harness

```bash
(cd crates/z30-py && maturin build --release) && pip install --force-reinstall target/wheels/z30-*.whl
python research/paired_receiver.py --min-snr -28 --max-snr -17 --frames 200 --workers 4 --out out.json
python research/paired_receiver.py ... --vnext-only --arm-b '{"whiten": false}'   # A/B a receiver change
```

The harness calls `z30.Receiver.decode_slot`, the function the station runs, on buffers the
oracle's own benchmark produces. See [benchmarking.md](benchmarking.md) for the rules.

## Benchmarks

```bash
cargo build --release -p z30-cli
./target/release/z30 --benchmark suite          # all ten, ~1 h on 4 cores; writes research/results/<commit>/
./target/release/z30 --benchmark awgn --frames 20 --out /tmp/try   # one benchmark, exploratory size
```

Build from a clean tree: the results name the binary's commit, and a `-dirty` commit cannot be
tied to source. See [benchmarking.md](benchmarking.md).

## CI

`.github/workflows/rust.yml`, the production application, on Linux, Windows and macOS: fmt,
clippy with warnings as errors, debug and release tests, release binaries with CM108, a check
that each binary reports the commit it was built from (not a dirty tree) and its CM108 feature,
a scan of the release binaries for the old W1AW default, a CLI encode → decode round trip and a
refusal check. Then: the whole workspace on the declared MSRV; the benchmark suite at
exploratory size with a provenance check on every result file; the golden vectors regenerated
from both oracles and compared byte for byte; and a paired oracle-vs-vNext run through the
bindings.

`.github/workflows/ci.yml`: the Python oracle's tests on the Python versions it declares, the
retired browser runtime's reference tests, a pip-audit, and the hygiene checks that keep the
retired runtime, the web bundle and the old installers out of the tree.

`.github/workflows/release.yml`: per-platform release archives from a `v*` tag
([install.md](install.md)).

## House rules for the workspace

`AGENTS.md` applies in full. The ones that bite most often here:

- **`z30-protocol` changes are protocol changes.** Constants, the Costas array, CRC, LDPC and
  codec need an operator decision and a version change, not a commit.
- **One receiver, one modulator.** Do not add a second demodulator "for benchmarking", or a
  second waveform "for SIC". `decode_slot` and `Modulator` are the only ones.
- **The receiver's constants live beside the receiver** (`RECEIVER_PILOT_COHERENCE` in
  `demod.rs`), never in a benchmark.
- **Pure functions of their input.** The LDPC dither is derived from the LLRs, and
  `decode_slot` is identical at any thread count. Do not add an unseeded RNG anywhere on the
  receive path.
- **Safety tests are not edited to pass.** If one fails, the change is wrong, or the pull request
  explains why the guarantee still holds.
- **The audio callback does not allocate.** `callback_alloc.rs` will tell you.
- **Numbers need provenance.** A figure in `docs/` names its file in `research/results/`, with
  seed, frame count, channel and interval.
- Conventional commits (`feat(dsp):`, `fix(engine):`, `docs:`).
- Keep `unsafe` out: `z30-protocol`, `z30-dsp` and `z30-engine` are `#![forbid(unsafe_code)]`.
