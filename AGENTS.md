# AGENTS.md — working context for coding assistants

Context for LLM-based coding tools (Claude Code, Copilot, Cursor, Aider, …) and for humans who
want the shape of this repository on one page. Read this before your first edit.

**Documentation authority.** [`SPEC.md`](SPEC.md) is the normative protocol text.
[`docs/`](docs/README.md) describes the application code in `crates/` as it is.
[`wiki/`](wiki/Home.md) is the operator documentation. `README.md` is a front page. They must
agree; a contradiction between any two is a bug to fix. A controlled, seeded benchmark or test
result outranks all prose (section 5).

---

## 1. What z-30 is

An experimental amateur radio digital mode and the software that operates it. A **63-bit
message** (two 28-bit call fields and a 7-bit extra field) plus a 14-bit CRC — 77 information
bits — is LDPC-encoded (216, 77) and transmitted as a 24-second, ~50 Hz-wide, continuous-phase
16-GFSK frame inside a 30-second UTC slot. The receiver (`decode_slot`) acquires blind across
200–2800 Hz and ±1.5 s with a 21-symbol sync pattern, demodulates non-coherently, decodes with a
four-schedule belief-propagation cascade and a corrected OSD, and runs up to three passes of
least-squares successive interference cancellation.

**The application is the Rust workspace in `crates/`** — `z30-gui` (desktop station) and `z30`
(command-line station and toolbox). There is no other runtime and no fallback. `legacy/` holds a
frozen Python protocol oracle and a retired browser runtime, neither of which anything in
`crates/` uses.

**This software keys real transmitters.** A defect here does not produce a stack trace; it
produces an out-of-band, misidentified or stuck transmission on somebody's licence. Section 4 is
not optional.

**Validation state — keep it stated honestly everywhere:** protocol validated; software
simulation validated; **hardware not validated; on-air not validated.** Nothing has been run
against a real radio, sound card or RF path. Do not write anything that implies otherwise.

---

## 2. Repository map

```
crates/                      THE APPLICATION
  z30-protocol/              constants, Costas pattern, CRC-14, LDPC (216,77) encoder, message codec
                             (refuses what v1 cannot carry exactly), GFSK modulator. Pure.
  z30-dsp/                   the receiver. slot.rs: decode_slot, THE one receive entry point.
                             baseband.rs, sync.rs, demod.rs (+ SNR/DT measurement), ldpc.rs,
                             ap.rs, sic.rs, resample.rs. Pure: no I/O.
  z30-engine/                clock.rs (sample clock), slots.rs (scheduler), pipeline.rs, runtime.rs
                             (threads), engine.rs, qso.rs (sequencer + provenance-tagged records),
                             txgate.rs (the transmit gate), rig.rs, ptt.rs, bandplan.rs, config.rs.
  z30-io/                    cpal audio, rigctld, serial RTS/DTR, CM108 (feature), SQLite+ADIF
                             logbook, migration from the legacy app, paths, OS clock status.
  z30-cli/                   `z30`: receive-only station, decode, encode, diagnostics, migrate,
                             ADIF, --loopback-test, --benchmark (suite.rs: every published figure).
  z30-gui/                   `z30-gui` (egui). Renders snapshots, sends commands, runs no DSP.
  z30-channel/               seeded channel models (AWGN, drift, clock error, Watterson, CW, bands).
                             Test/benchmark tooling only; never in the receive path.
  z30-py/                    PyO3 bindings of decode_slot for research/ only. Never shipped.
SPEC.md                      normative v1 protocol, derived from the oracle, pinned by fixtures/golden/
docs/                        developer docs for crates/ (install, architecture, receiver, safety,
                             benchmarking, hardware, hardware-validation, ...)
wiki/                        operator docs
fixtures/golden/             golden vectors. Generated; NEVER edited by hand.
reference/golden/            their generators (Python oracle; TS codec for messages.json)
research/                    paired_receiver.py (oracle vs decode_slot), summarize_suite.py,
                             results/<commit>/ (machine-readable results; never hand-edited)
tests/vectors/               shared known-answer vectors (CRC, callsigns, dither)
hardware-validation/         records of hardware tests (none yet)
packaging/linux/             desktop entry and icon
legacy/python-oracle/        FROZEN Python oracle (sources pinned by FROZEN.sha256). Non-production.
legacy/browser-runtime/      RETIRED browser transceiver. Reference only; not built or shipped.
audit/                       audits and remediation evidence
VNEXT_IMPLEMENTATION_PLAN.md the rebuild plan and the operator decisions it recorded
```

---

## 3. Generated and frozen files — never edit by hand

| File | Produced by | Check |
| :--- | :--- | :--- |
| `fixtures/golden/*` | `python reference/golden/generate.py` (oracle); `messages.json` by `reference/golden/generate_messages.mts` (legacy TS codec) | `--check` modes, CI job `golden` |
| `research/results/<commit>/*.json` | `z30 --benchmark suite` built from that commit, clean tree | provenance fields; never edited |
| `research/results/<commit>/SUMMARY.md` | `python research/summarize_suite.py research/results/<commit> --write` | regenerate, do not edit |
| `legacy/python-oracle/z30_dsp/*.py` | frozen | `FROZEN.sha256` + `test_oracle_is_frozen.py`; a deliberate change updates the manifest in the same commit, with the reason |
| `legacy/browser-runtime/src/data/*.ts` | frozen snapshots of the retired app's in-app wiki / source viewer | not regenerated; the wiki no longer feeds the retired app |

---

## 4. Invariants you must not break

These have tests. If a change makes one of these tests fail, the change is wrong — do not edit
the test to match. Full rationale: [`docs/safety.md`](docs/safety.md).

**Transmit safety** (`crates/z30-engine/tests/safety.rs`, `emergency.rs`)
- `txgate::can_transmit` is the single gate in front of every transmit path (sequencer, manual
  TX, tune). It **fails closed** and returns every violation. Never add a transmit path that
  bypasses it; never make it return `allowed: true` on a partial check.
- It validates: a real, non-placeholder callsign v1 carries exactly; region and licence class;
  the **radiated** emission (dial + audio offset across the tone span, at the measured −40 dB
  width) inside a permitted data segment; the radio's settled readback not contradicting the
  dial; **the whole encoded frame reading back as exactly the requested message** (symbols,
  parity, CRC, fields, text — partner call, grid and report included; audit C-06); the frame
  sent from this station; a PTT method configured and the transmit hardware open.
- **Readback only adds refusals.** No readback is "unverified", not "wrong"; an unsettled QSY
  (three polls) and a difference inside the rig's tuning resolution are not refusals.
- **One keying implementation** (`PttController`), which reports whether the hardware accepted
  the command; **a release drives what the key drove**; a halt between plan and key abandons the
  transmission.
- `MAX_TX_SECONDS = 40` (a frame is 24 s). The transmit timeline, the independent watchdog
  thread, the panic/signal handlers and the OS's release of serial lines are separate layers.
  Do not collapse them.
- rigctld PTT runs on its own connection, never queued behind polls.
- **No default callsign, region, class or PTT.** A new install cannot transmit
  (`config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`); CI scans release
  binaries for the old W1AW default.

**Messages: refuse, never transform** (`crates/z30-protocol/tests/round_trip.rs`, `codec.rs`)
- The codec refuses anything v1 cannot carry exactly: non-standard calls, `ZV`–`ZZ` prefixes,
  grids outside the 63-square table, reports outside −30…+30, `R`-reports. `encode` proves its
  own round trip; `EncodedMessage::verify_round_trip` proves it from the symbols.

**Honest values** (see also section 5)
- Every displayed, logged or reported value is measured, computed from measurements, labelled
  configuration, labelled simulation, or explicitly unavailable. Never a plausible default.
- `Decode::snr_db` is `Option`: `None` is shown as `--` and sends no report. The estimate is
  validated from `SNR_VALIDATED_MIN_DB` (−22) to `SNR_VALIDATED_MAX_DB` (+30) dB by
  `tests/snr_accuracy.rs`; outside that it is displayed as a bound. Do not reintroduce an
  estimator whose noise comes from the received spectrum's own off-tone bins (it saturated at
  +6.6 dB, audit M-07).
- There is **no per-decode confidence**. Do not add one without a calibrated derivation.
- `PassStats::suppression_db` is the receiver's own fit-residual ratio, **not** physical
  suppression (it overstates by ~10 dB). Never quote it as how much of a station was removed.
- Log records carry per-field provenance; absent fields stay absent; `QsoRecord::validate`
  refuses records with no partner or no plausible UTC time; times are UTC from slot numbers.
- Configured TX power is configuration. Forward power and SWR are "not measured".

**Time** (`crates/z30-io/src/wallclock.rs`)
- z-30 never sets the system clock, applies no offset of its own, and has no RF or network time
  source. Status says "synchronised" only when the OS says so. Never add a time source that can
  report success without a decoded, validated reference.

**Live scheduling** (`crates/z30-engine/tests/live_runtime.rs`, `virtual_clock.rs`)
- A slot is decoded when, and only when, the sample store holds its whole window
  [slot − 1.5 s, slot + 25.5 s], decided in sample time, never by a timer. The live-runtime test
  stalls audio 0.5 s short of the window and must see nothing decoded (audit C-01).

**Signal integrity** (`z30-protocol` tests, golden waveforms)
- Continuous phase, constant envelope; the only amplitude shaping is one 20 ms raised-cosine ramp
  at each end of the frame. Per-symbol amplitude gating is amplitude keying at 3.125 baud.
- CRC-14 (0x2443, init 0x2757, MSB-first), LDPC (216,77) table, Costas positions/tones, natural
  binary symbol map: **protocol constants**. Changing any is a protocol break.

**One receiver, one modulator**
- `decode_slot` is the only receive path: the GUI, the CLI station, `--decode`, the benchmark
  suite and the research bindings all call it. Never add a second demodulator, a benchmark-only
  decoder, or anything in the receive path that knows it is being benchmarked or knows the
  expected answer. Receiver constants live beside the receiver (`RECEIVER_PILOT_COHERENCE` in
  `demod.rs`), never in a benchmark.
- `z30_protocol::gfsk::Modulator` is the only waveform generator: transmit, SIC replica, SNR
  replica, test signals.

**Determinism**
- `decode_slot` is a pure function of its input and configuration: identical at any thread count
  (`sic_regression.rs`, `channel_scenarios.rs`). The LDPC dither is derived from the LLRs. No
  unseeded RNG anywhere on the receive path.
- Benchmarks seed every frame from (suite seed, benchmark, point, frame): results do not depend
  on scheduling.

**A priori decoding** (`golden_ldpc.rs`, `ap.rs`)
- AP never runs first; it may add decodes, never change or lose one. An AP-assisted decode is
  labelled `a1`…`a6` everywhere it is shown. The gates only narrow. An empty mask decodes
  bit-identically; the CRC bits are never asserted. AP is off by default.

**Fading model**
- Watterson taps are normalised to unit **ensemble** power (both `z30-channel` and the oracle's
  `channel.py`). Per-realisation normalisation deleted slow-fading power variation and made
  fading results optimistic (audit H-10); do not restore it.

---

## 5. Honest numbers

The project has retracted sensitivity claims before, and the retractions are documented on
purpose. Every published figure follows these rules:

- **It comes from `z30 --benchmark suite`** (or another benchmark that calls `decode_slot`),
  built from a clean tree, and the result file under `research/results/<commit>/` is the
  authority. Tables in docs are pasted from `research/summarize_suite.py` output, not retyped.
- **Quote the implementation, the measurement type, the channel, the SNR definition (2500 Hz,
  SPEC §10), the sample count, the seed, the success criterion, the interval, and that it is a
  simulation with no hardware involved.** A bare "−23 dB" is not a z-30 figure.
- Current AWGN figure (`research/results/d8983eeef66e/awgn.json`): **vNext `decode_slot`, 50%
  decode at −23.03 dB [−23.13, −22.89], 90% at −22.06 dB [−22.15, −21.80]**, blind acquisition
  (tone 0 uniform 210–2740 Hz, DT uniform ±1.4 s, random phase and payload), AWGN, 200 frames
  per point, suite seed 20260830, Wilson 95%. **Simulation; not measured on real hardware.**
- **Against FT8, quote all of it or none of it:** about 2 dB deeper than FT8's published −21 dB
  (a simulation figure from Franke, Somerville & Taylor, QEX 2020, conditions not identical),
  bought with 1.9× the airtime and 14 fewer message bits; **per message bit z-30 needs about
  1.6 dB more Eb/N0 than FT8** (6.8 vs 5.1 dB); and on ITU-R F.1487 high-latitude moderate (10 Hz Doppler) z-30
  does not decode at any SNR. FT8 **does** recover collisions (WSJT-X runs three passes with
  subtraction); never write otherwise.
- **Fading figures** come only from the ensemble-normalised model; results from the old
  per-realisation model (including the retired "−21.4 dB mid-latitude") are withdrawn.
- **Busy-band figures state the placement** (random, overlapping) and the SNR range.
- **The oracle's figures are the oracle's.** `legacy/python-oracle` results describe that
  reference receiver, never "z-30" or "the decoder that ships".
- The legacy browser receiver never achieved any published figure (audit C-01/C-02).
- Minimum 200 frames per point behind a published sensitivity crossing; fewer is exploratory and
  the suite marks it so.
- **Comparing two decoders or two configurations? Pair them** on the same audio and report the
  exact McNemar p-value over the discordant frames (the `sic` benchmark does).
- **The word "threshold"** is for blind-acquisition results through `decode_slot`. A
  genie-aided result is a bound, and nothing may compute a z-30-vs-other-mode delta from one.
- **Collision performance** is what `z30 --benchmark sic` measured (two stations, AWGN,
  simulation). The legacy collision table (98.7/95.2/91.4/84.6 %) stays withdrawn.

**Benchmarks and tests are the only challengers of the documentation.** A result overturns a
documented claim once it is a controlled, seeded, paired (where it compares) measurement at a
realistic operating point with a stated confidence figure (an exact p-value or interval, not an
adjective) — ≥ 95% to challenge, ≥ 99% before it is treated as settled. Nothing may alter a
benchmark or test to manufacture a result: no moving thresholds, seeds, sample sizes, SNR ranges
or exit conditions toward an outcome, no cherry-picking runs.

Do not add marketing superlatives. Comments and docs explain *why* something is the way it is,
usually by naming the failure it prevents — match that voice.

---

## 6. Commands

```bash
# The application
cargo build --release -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
cargo fmt --all --check
cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings
cargo test --workspace --exclude z30-py --release
./target/release/z30 --version
./target/release/z30 --benchmark suite                 # ~1 h on 4 cores; writes research/results/<commit>/
python research/summarize_suite.py research/results/<commit> --write

# Reference code (only when touching what it guards)
pip install -r legacy/python-oracle/requirements.txt pytest
(cd legacy/python-oracle && python -m pytest tests -q)
python reference/golden/generate.py --check
(cd legacy/browser-runtime && npm ci && npm run lint && npm run test:ts)
npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts --check
```

CI: `.github/workflows/rust.yml` (the application on Linux/Windows/macOS, the declared MSRV,
the benchmark suite's provenance, golden vectors, the paired harness), `ci.yml` (oracle tests,
legacy reference tests, repository hygiene and the production/legacy separation) and
`release.yml` (release archives).

---

## 7. House rules

- **Rust MSRV is 1.95** (`Cargo.toml`), checked by CI. `z30-protocol`, `z30-dsp` and
  `z30-engine` are `#![forbid(unsafe_code)]`. Clippy warnings are errors.
- **Nothing in `crates/` may depend on `legacy/`**, and no fallback to anything else may be
  added: a failure is reported, not worked around.
- **The audio callback does not allocate** (`z30-io/tests/callback_alloc.rs`).
- **Comments explain why, not what.** When you fix something subtle, leave the note naming the
  failure it prevents.
- **Conventional commits**: `feat(dsp):`, `fix(engine):`, `docs(wiki):`.
- **Never commit**: build artifacts (`target/`, `dist/`, `node_modules/`), bytecode, a real
  `.env`, a personal config. CI rejects the retired runtime's files if they reappear.
- **Do not "fix" a failing safety test by weakening it.** Change the code, or explain in the pull
  request why the guarantee still holds.
- **Python is not part of the application.** The oracle is frozen; research scripts may use it
  and must label its results as the oracle's.

---

## 8. Where to look first

| Task | Start at |
| :--- | :--- |
| Anything touching transmit | `crates/z30-engine/src/txgate.rs`, `ptt.rs`, `runtime.rs`, `docs/safety.md` |
| Receiver behaviour | `crates/z30-dsp/src/slot.rs`, `docs/receiver.md` |
| Waveform | `crates/z30-protocol/src/gfsk.rs`, `SPEC.md` |
| Codec, CRC, LDPC | `crates/z30-protocol/src/{codec,crc,ldpc}.rs`, `crates/z30-dsp/src/ldpc.rs`, `docs/ldpc.md` |
| SIC | `crates/z30-dsp/src/sic.rs`, `docs/sic.md` |
| AP | `crates/z30-dsp/src/ap.rs`, `wiki/17` |
| Slot timing, clock | `crates/z30-engine/src/{clock,slots,pipeline}.rs`, `docs/synchronization.md` |
| Rig, CAT, PTT hardware | `crates/z30-io/src/{rigctld,serial_ptt,cm108}.rs`, `docs/hardware.md` |
| Logbook, migration | `crates/z30-io/src/{logbook,migrate}.rs`, `crates/z30-engine/src/qso.rs` |
| GUI | `crates/z30-gui/src/app.rs`, `wiki/14` |
| Benchmarks | `crates/z30-cli/src/suite.rs`, `docs/benchmarking.md`, `research/` |
| Packaging, releases | `.github/workflows/release.yml`, `docs/install.md` |
| Hardware validation | `docs/hardware-validation.md`, `crates/z30-cli/src/loopback.rs` |
