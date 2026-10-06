# AGENTS.md

Operating guide for coding agents working on z-30. It says how to change this repository safely.
It does not explain the project: the wiki does that. Read this before your first edit.

**Documentation roles.** [`SPEC.md`](SPEC.md) is the normative protocol. [`docs/`](docs/README.md)
describes the code in `crates/`. [`wiki/`](wiki/Home.md) is the operator and technical reference.
`README.md` is the public front page. A contradiction between them is a bug: the source code
and tests win over prose, and a controlled, seeded benchmark result wins over everything.

## 1. Project identity

z-30 is an experimental amateur-radio digital mode and the software for it. A 63-bit message plus
CRC-14 (77 bits) is LDPC-encoded (216, 77) and sent as a 24 s, ~50 Hz-wide, continuous-phase
16-GFSK frame in a 30 s UTC slot. The receiver (`decode_slot`) searches 200–2800 Hz and ±1.5 s
blind, demodulates non-coherently, decodes with four BP schedules plus a corrected OSD, and runs
up to three least-squares SIC passes.

**The software keys real transmitters.** A defect can cause an out-of-band, misidentified or
stuck transmission on somebody's licence. Section 4 is not optional.

**Validation state, to be stated honestly wherever it is mentioned:** protocol validated;
software simulation validated; **hardware not validated; on-air not validated.** Never write
anything that implies a radio, sound card or RF path has been used.

## 2. Architecture and layout

Rust is the only implementation. There is no Python, browser or other fallback runtime.

```
crates/
  z30-protocol/  constants, Costas pattern, CRC-14, LDPC encoder, message codec, GFSK modulator. Pure.
  z30-dsp/       receiver; slot.rs `decode_slot` is the one receive entry point. Pure, no I/O.
  z30-engine/    clock, slot scheduler, pipeline, runtime threads, QSO sequencer, txgate, rig, ptt,
                 bandplan, config
  z30-io/        cpal audio, rigctld, serial/CM108 PTT, SQLite+ADIF logbook, migration, paths, OS clock
  z30-cli/       `z30`: receive-only station, decode, encode, diagnostics, loopback tests, benchmark suite
  z30-gui/       `z30-gui` (egui): renders snapshots, sends commands, runs no DSP
  z30-channel/   seeded channel models (AWGN, drift, Watterson, ...). Tests and benchmarks only
SPEC.md  docs/  wiki/  README.md
fixtures/golden/, tests/vectors/   FROZEN known-answer data; hash-pinned by FROZEN.sha256
research/        stdlib-only Python result tools + research/results/<commit>/ (machine-generated, never hand-edited)
hardware-validation/   hardware test procedure and records (none yet)
audit/           HISTORICAL reports and evidence; not current guidance; never rewritten
packaging/linux/  .github/workflows/{rust,ci,release}.yml
```

Where to start: transmit → `z30-engine/src/{txgate,ptt,runtime}.rs`, `docs/safety.md`; receiver →
`z30-dsp/src/slot.rs`, `docs/receiver.md`; waveform/codec → `z30-protocol/src/`, `SPEC.md`;
rig/PTT hardware → `z30-io/src/{rigctld,serial_ptt,cm108}.rs`, `docs/hardware.md`; benchmarks →
`z30-cli/src/suite.rs`, `docs/benchmarking.md`.

## 3. Frozen and generated files: never edit by hand

| File | Why | Check |
| :--- | :--- | :--- |
| `fixtures/golden/*`, `tests/vectors/*.json` | Frozen. Their generators were deleted and cannot be rerun. | `sha256sum --check --strict FROZEN.sha256` in each directory (CI job `hygiene`) |
| `research/results/<commit>/*.json` | Produced by `z30 --benchmark suite` from a clean tree at that commit | provenance fields inside each file |
| `research/results/<commit>/SUMMARY.md` | `python research/summarize_suite.py research/results/<commit> --write` | regenerate, never edit |
| `Cargo.lock` | cargo | `--locked` builds; RustSec audit in CI |

If a golden test fails, the Rust code is wrong, not the fixture.

## 4. Invariants (each has tests; a failing one means the change is wrong)

Rationale and test names: [`docs/safety.md`](docs/safety.md). Do not weaken or edit a safety test to
pass it; change the code or explain in the PR why the guarantee still holds.

**Transmit**
- `txgate::can_transmit` is the only gate in front of every transmit path (sequencer, manual TX,
  tune). It fails closed and returns every violation. Never add a path around it; never return
  `allowed: true` on a partial check. Readback only ever adds refusals.
- The transmit path takes only a `codec::VerifiedFrame`, constructible only through
  `EncodedMessage::verify`. What is verified is what is transmitted; never re-encode, never accept
  bare symbols.
- A PTT release is confirmed or pending (`PttController`: Keyed → ReleasePending → Released). An
  unconfirmed release is retried, refuses transmission and is reported. One keying
  implementation; a release drives what the key drove.
- HALT never waits and is the last word: an arming command sent before the latest HALT is
  dropped. Shutdown retries an unconfirmed release for a bounded time and reports the result.
- Only a `Complete` transmission advances a QSO or is logged. `MAX_TX_SECONDS = 40`. Keep the
  timeline, watchdog thread, panic/signal handlers and OS release as separate layers.
- rigctld PTT uses its own connection, never queued behind polls.
- No default callsign, region, class, PTT, dial or transmit level. A new install cannot transmit.
- `z30 --loopback-test` never transmits (forbidden `unsafe`, clippy disallow lists in
  `crates/z30-cli/clippy.toml`, `loopback_isolation.rs`); its report goes only to a file.
  `--audio-loopback-test` refuses any PTT or rig configuration.

**Messages:** refuse, never transform. The codec refuses anything v1 cannot carry exactly
(non-standard calls, `ZV`–`ZZ` prefixes, grids outside the 63-square table, reports outside
−30…+30, `R`-reports).

**Honest values.** Every displayed, logged or reported value is measured, derived from
measurements, labelled configuration or simulation, or explicitly unavailable; never a plausible
default.
- `Decode::snr_db` is `Option` (`None` shows as `--` and sends no report). Validated range
  −22…+30 dB (`tests/snr_accuracy.rs`); outside it, show a bound. Do not derive noise from the
  received spectrum's own off-tone bins.
- No per-decode confidence without a calibrated derivation.
- `PassStats::suppression_db` is a fit-residual ratio, not physical suppression; never quote it
  as how much of a station was removed.
- Log records carry per-field provenance; absent stays absent; times are UTC from slot numbers.
  The logged dial claims only its evidence: `reported_by_rig`, `commanded`, `configured` or absent.
- Configured TX power is configuration; forward power and SWR are "not measured".

**Time:** z-30 never sets the system clock, has no RF or network time source, and says
"synchronised" only when the OS does.

**Live scheduling:** a slot is decoded when, and only when, the sample store holds its whole
window [slot − 1.5 s, slot + 25.5 s], decided in sample time, never by a timer.

**One receiver, one modulator.** `decode_slot` is the only receive path (GUI, CLI, `--decode` and
benchmarks all call it); `gfsk::Modulator` is the only waveform generator (transmit, SIC replica,
SNR replica, tests). No second demodulator, no benchmark-aware code in the receive path, no
receiver constants in a benchmark.

**Signal and protocol constants:** continuous phase, constant envelope, one 20 ms raised-cosine
ramp at each end of the frame. CRC-14 (0x2443, init 0x2757, MSB-first), the LDPC table, Costas
positions/tones and the natural binary symbol map are protocol constants; changing one is a
protocol break needing an operator decision and a version change.

**Determinism:** `decode_slot` is a pure function of input and configuration, identical at any
thread count. LDPC dither derives from the LLRs. No unseeded RNG on the receive path. Benchmarks
seed every frame from (suite seed, benchmark, point, frame).

**AP decoding:** never runs first; per candidate it may add decodes, never change or lose one.
Always labelled `a1`…`a6`. Gates only narrow; an empty mask decodes bit-identically; CRC bits are
never asserted. Off by default.

**Fading model:** Watterson taps are normalised to unit ensemble power (not per realisation).
`doppler_hz` is the ITU-R F.1487 2σ spread of the Doppler power spectrum; the tap amplitude
response is its square root. Both were once wrong; `z30-channel` spectral tests catch it.

## 5. DSP and performance rules

- Receive-path code is deterministic, allocation-conscious and panic-free on arbitrary input.
- **The audio callback does not allocate** (`z30-io/tests/callback_alloc.rs`).
- A change meant to move a measured figure (sensitivity, false decodes, collisions, latency) goes
  through [`docs/research-process.md`](docs/research-process.md): proposal with a decision rule
  fixed in advance, then a paired baseline-versus-candidate experiment. Run
  `z30 --benchmark perf` for latency, CPU and allocation claims.
- Never move thresholds, seeds, frame counts, SNR ranges or exit conditions toward an outcome.
- Numerical changes in `z30-dsp` that alter any decode need the golden, SIC and channel tests plus
  a paired comparison, not just a unit test.

## 6. Published numbers

Full rules: [`docs/benchmarking.md`](docs/benchmarking.md#reporting-rules). In short:
- A figure comes from `z30 --benchmark suite` (or another `decode_slot` benchmark) built from a
  clean tree; the file in `research/results/<commit>/` is the authority. Never retype from memory.
- Quote implementation, channel, SNR definition (2500 Hz, SPEC §10), frames, seed, success
  criterion, interval, and that it is simulation. At least 200 frames per point for a published
  crossing; below that is exploratory.
- Compare two configurations paired, with the exact McNemar p-value.
- FT8 comparisons are quoted in full or not at all. Withdrawn figures stay withdrawn.
- Current AWGN figure: 50% at −23.03 dB [−23.13, −22.89], 90% at −22.06 dB
  [−22.15, −21.80] (`research/results/672cef9b3cdb/awgn.json`; 200 frames, seed 20260830, Wilson
  95%, blind acquisition; simulation).

## 7. Commands

```bash
cargo build --release -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --release
./target/release/z30 --loopback-test        # software round trip; opens no device
./target/release/z30 --benchmark suite      # ~1 h on 4 cores; only for publishing figures
python research/summarize_suite.py research/results/<commit> --write
python -m pytest research/tests -q
(cd fixtures/golden && sha256sum --check --strict FROZEN.sha256)
(cd tests/vectors && sha256sum --check --strict FROZEN.sha256)
```

MSRV is Rust 1.95; CI runs clippy `-D warnings` and tests on it. Linux needs the ALSA, udev and
X11/Wayland development packages.

## 8. What to run for what

| You changed | Run at least |
| :--- | :--- |
| anything in `crates/` | fmt, clippy, `cargo test --workspace --release` |
| `z30-engine` txgate / ptt / runtime / rig / bandplan / config, `z30-io` rig or PTT, codec | the above, and read `docs/safety.md`; the `safety`, `emergency`, `ptt_*`, `gate_contract`, `tx_runtime` and `frame_integrity` tests must pass untouched |
| `z30-dsp`, modulator, channel | the above plus golden and regression tests; a paired benchmark if a decode changes |
| `z30-cli/src/suite.rs`, `research/` | `python -m pytest research/tests -q`, `suite_output` tests |
| docs only | link and path check (section 10); no build needed |

## 9. Change workflow

1. Read the relevant source, tests and `docs/` page before editing. Implementation beats prose.
2. Reproduce a bug with a failing test first; fix; keep the regression test.
3. Keep the diff minimal and in scope. No speculative refactors, no new abstraction layers, no
   compatibility shims or fallbacks: a failure is reported, not worked around.
4. Update the docs that describe the behaviour you changed, in the same change.
5. Run the checks in section 8, then re-read your own diff for anything CI or a reviewer would
   reject.

**Dependencies.** Add one only when the standard library or an existing dependency cannot do the
job. Check the licence (the project is MIT), keep `Cargo.lock` committed, build with `--locked`,
and make sure the RustSec audit in CI still passes. `z30-protocol`, `z30-dsp` and `z30-engine`
stay `#![forbid(unsafe_code)]`. No Python or JS/TS outside `research/` and `audit/` (CI refuses
it), and no package-manager files for the deleted stacks.

**Git.** Conventional commits (`feat(dsp):`, `fix(engine):`, `docs(wiki):`). Never commit
`target/`, `dist/`, bytecode, a real `.env` or a personal config. Benchmark output not from the
published run goes to the git-ignored `research/results/exploratory/` or `unpublished/`. PR
descriptions state what changed, why, and what was run. Nothing here approves or merges; keys a
radio; or marks hardware or on-air validation done.

## 10. Documentation rules

- README is the public introduction and quick start; the wiki is the complete human reference;
  `docs/` describes the code; this file says how to work. Do not copy explanations between them;
  link instead.
- Write plainly, as a maintainer would. No marketing language, no superlatives, no unmeasured
  claims. Comments and docs say why, usually by naming the failure they prevent.
- Never document what does not exist; never imply hardware or on-air validation.
- After changing paths, commands or flags, grep the docs for the old names and fix every hit.
- `audit/` is history. Do not edit it, and do not cite it as current guidance.
- Keep AI/agent-tool references out of README, wiki, docs, comments and metadata. This file is the
  only place for them.

## 11. Definition of done

- [ ] Builds on 1.95; fmt and clippy clean; the tests for what you touched pass
- [ ] No safety test, golden fixture or published result edited to make something pass
- [ ] No invariant in section 4 weakened; no new transmit path, receive path or waveform generator
- [ ] New behaviour has a test; new numbers have a result file
- [ ] Docs that describe the change are updated and their links resolve
- [ ] Validation state still reads: hardware not validated, on-air not validated
