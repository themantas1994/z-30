# Development

## Toolchain

- **Rust:** the workspace's `rust-version` is 1.82. `z30-gui` needs **1.95** because egui/eframe
  0.36 does. CI uses current stable.
- **Linux system libraries** (the GUI and audio): `libasound2-dev libudev-dev libxkbcommon-dev
  libwayland-dev libx11-dev libxcursor-dev libxrandr-dev libxi-dev libgl1-mesa-dev`.
- **Python 3.9+** with `requirements.txt`, for the oracle, the golden generator and `research/`.
  `maturin` builds the bindings.
- **Node**, for the TypeScript golden check and the legacy app's suites.

## Build and run

```bash
cargo build --release -p z30-cli -p z30-gui       # add --features cm108 for CM108 PTT
./target/release/z30 --help
./target/release/z30 --devices
./target/release/z30 --migrate                    # import the legacy config and logbook
./target/release/z30 --receive --capture-slots slots/
./target/release/z30 --decode slots/<slot>.wav
./target/release/z30-gui
```

Configuration lives in `config.toml`, in `$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30`.
That is the directory the legacy app used, so migration finds its files. The logbook is
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
| Channel | `z30-dsp/tests/channel_scenarios.rs` | `decode_slot` on seeded bands ([receiver.md](receiver.md)) |
| Safety | `z30-engine/tests/safety.rs`, `emergency.rs` | every transmit-path rule ([safety.md](safety.md)) |
| Virtual clock | `z30-engine/tests/virtual_clock.rs` | 24 h soak and a closed-loop QSO ([synchronization.md](synchronization.md)) |
| Real-time | `z30-io/tests/callback_alloc.rs` | the capture callback never allocates ([audio.md](audio.md)) |
| Units | `src/**` `#[cfg(test)]` | resampler, clock, rig rules, logbook, migration, ADIF, SIC interpolation, … |

## Golden vectors

`fixtures/golden/` is generated from the frozen oracle and committed:

```bash
python reference/golden/generate.py            # regenerate
python reference/golden/generate.py --check    # CI: byte-identical or fail
npx tsx reference/golden/generate_messages.mts --check
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

## CI (`.github/workflows/rust.yml`)

On Linux, Windows and macOS: fmt, clippy with warnings as errors, debug and release tests, release
binaries, a check that each binary reports the commit it was built from (and not a dirty tree),
a benchmark smoke run, and a CLI encode → decode round trip. Artefacts are uploaded per OS.

Separately:

- the golden vectors are regenerated from both oracles and compared byte for byte;
- the bindings are built, and a small paired oracle-vs-vNext run drives the shipped
  `decode_slot`.

The legacy workflow (`ci.yml`) still runs the Python and TypeScript suites unchanged.

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
