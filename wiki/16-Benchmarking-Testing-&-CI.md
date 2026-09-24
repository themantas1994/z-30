# 16. Benchmarking, Testing & CI

How z-30's performance figures are produced, what they are, and what the test suites and CI
enforce. The developer-level account, with every table, is
[`docs/benchmarking.md`](../docs/benchmarking.md).

> **Every figure on this page is software simulation.** No radio, sound card or RF path was
> involved. Real-radio validation: not yet performed
> ([`docs/hardware-validation.md`](../docs/hardware-validation.md)).

## The instrument is the receiver you run

Every figure comes from `z30 --benchmark suite`: the shipped `z30` binary synthesises audio
with `z30-channel`, hands it to **`decode_slot` with its default configuration** — the same
function the station calls on every slot — and only then compares the decodes with what was
transmitted. The receiver is given only the audio; the harness keeps the ground truth. There
is no benchmark-only decoder, no benchmark flag inside the receiver, and no second receive path
to measure.

Each benchmark writes one JSON file to `research/results/<commit>/` recording the commit, build
profile, compiler, OS and CPU, sample rate, channel model, SNR definition, seed, frame count,
carrier/DT/frequency/drift distributions, the decoder configuration, the success and
false-decode criteria and the confidence method. `research/summarize_suite.py` renders them as
`SUMMARY.md`; the documentation's tables are pasted from its output, never retyped. A binary
built from a dirty tree prints a warning that its results cannot be tied to a commit.

**Definitions used throughout.** SNR is the frame's signal power over the noise power in
2500 Hz (SPEC §10). Success is a decode whose 63 payload bits equal the transmitted ones. A
false decode is a CRC-valid decode of anything not transmitted. Intervals are Wilson 95%;
paired comparisons use the exact two-sided McNemar test; a zero count is bounded with the exact
one-sided Clopper–Pearson 95% limit. Suite seed 20260830; each frame's generator is seeded from
the seed, the benchmark, the point and the frame index, so any single frame can be regenerated.

## The measured set

Results: [`research/results/672cef9b3cdb/`](../research/results/672cef9b3cdb/SUMMARY.md), from the release
binary built at `672cef9`. Nine of the ten benchmarks are identical to the first run at `d8983ee`
(the receiver did not change); fading changed because its channel model was corrected. 200 frames per
point unless stated. Blind placement: tone 0 uniform over 210–2740 Hz, DT uniform over ±1.4 s,
random carrier phase and payload.

| Benchmark | Result |
| :--- | :--- |
| AWGN, single station | **50% at −23.03 dB [−23.13, −22.89]; 90% at −22.06 dB [−22.15, −21.80]**; 0 false decodes |
| Reported SNR, −22…+30 dB | bias within ±0.25 dB at every point; beyond +30 dB the display shows `>+30` |
| Linear drift across the frame, −22 dB | 92.5% at 0 Hz; ~79% at ±4 Hz; 58.5% at ±5 Hz; ~3% at ±8 Hz |
| Timing (DT), −20 dB | 100% to ±1.5 s; 3.5% / 11.5% at +1.6 / −1.6 s; 0% at ±2.0 s |
| Sound-card clock error, −20 dB | ≥ 99.5% to ±5000 ppm; 72.5% / 81.5% at +10000 / −10000 ppm |
| Audio impairments, −20 dB | 100% through clipping at 1× RMS, 8-bit quantisation, 0.5 s and 2 s dropouts; **36.5%** with 200 impulses at 50× RMS |
| Busy band, random overlapping placement | K = 40 at −20…0 dB: 98.8% [98.2, 99.2]; K = 20 at −22…−16 dB: 97.6%; 0 false decodes |
| False decodes, no z-30 frame present | 0 in 2000 slots (white noise, CW carriers, 16-FSK without Costas, FT8-like 8-FSK, impulses); 95% upper bound 1.5 × 10⁻³ per slot |
| Two-station collisions, SIC on vs off | weak station (−18 dB, 3–20 dB below) decoded 100/100 with SIC in every cell except exact co-location (0/100 in both arms); single pass loses it at 5–20 Hz; p ≤ 1.2 × 10⁻¹⁰ where the arms differ; 0 false, 0 duplicates in 2400 trials |
| Watterson fading (ensemble-normalised; Doppler = 2σ of the power spectrum) | 50% at −20.94 / −21.37 / −20.88 dB on ITU-R F.1487 good / moderate / poor (average SNR); slow-fading tail on good (96% at −14 dB); **high-latitude moderate (10 Hz Doppler): 0 of 800 frames from −20 to +10 dB**. The earlier −20.79 / −21.31 / −21.07 dB came from a model running at 1/√2 of the labelled Doppler and are withdrawn |

Not measured: any real recording, any hardware, any on-air path; collisions of three or more
stations as a function of power difference; FT8 on the same channels.

## Reproducing

```bash
cargo build --release -p z30-cli
./target/release/z30 --benchmark suite                        # every benchmark, full size
./target/release/z30 --benchmark awgn --frames 200            # one benchmark
./target/release/z30 --benchmark suite --frames 20 --out /tmp/x   # quick, marked exploratory
python3 research/summarize_suite.py research/results/<commit> --write
```

A run on the same commit reproduces every decode count exactly (latency will differ: it is
wall-clock time measured while other slots decode concurrently, and is indicative only; the
controlled latency benchmark is `z30 --benchmark perf`). Fewer than 100 frames per point is
marked exploratory in the JSON. The full suite takes a few hours on 4 cores.

## Before you publish a number

1. It comes from a result file under `research/results/`, produced by a clean build of a
   commit, and you cite the file.
2. It carries its conditions: implementation, "simulation", channel, SNR reference, frames,
   seed, success criterion, interval, and "not measured on real radio hardware".
3. A comparison between two receivers or settings is **paired** (same audio, both arms) and
   quotes the exact McNemar p-value. Two independent sweeps differenced cannot resolve a
   fraction of a dB.
4. Against FT8, quote the airtime (24.0 s vs 12.64 s), the message bits (63 vs 77), the
   Eb/N0 per message bit and the fading result with it — all or none
   ([11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md)).
5. Nothing is moved — seed, frame count, SNR range, criterion — to make a result come out a
   particular way, and no run is discarded for being unfavourable.

## Tests

| Suite | Command | What it covers |
| :--- | :--- | :--- |
| Rust workspace | `cargo test --workspace --exclude z30-py --release` | golden vectors from the frozen oracle; protocol round trip of every grid, report and sampled callsign; the transmit gate and PTT fail-closed rules; the live runtime decoding a slot only from its complete window (virtual sound card and clock); QSO logging with missing values and non-UTC time zones; SNR accuracy (and no estimate, not a floor, from silence); SIC; a sensitivity regression floor at −22 dB; migration idempotence and each legacy writer's defaults; dial-frequency provenance through the engine and the runtime; every kind of corrupted frame refused by the round trip and by the transmit gate, and the transmitted audio decoding back to the verified frame; the Watterson model's measured Doppler spread; the software loopback through the resampler, and that it contains no audio/PTT/rig code |
| Python oracle Doppler | `cd legacy/python-oracle && python -m pytest tests/test_watterson_doppler.py` | the oracle's fading model has its labelled Doppler spread |
| Formatting and lints | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` | |
| Python oracle (non-production) | `cd legacy/python-oracle && python -m pytest tests` | the reference implementation, and that its source still matches `FROZEN.sha256` |
| Golden vectors | `python reference/golden/generate.py --check` | the oracle still produces `fixtures/golden/` byte for byte |
| Retired browser runtime (reference only) | `cd legacy/browser-runtime && npm ci && npm run test` | the codec vectors, its transmit-gate regressions, and that its retired features stay retired |

## What CI enforces

- **`rust.yml`** — formatting, clippy, tests (debug and release) on Linux, Windows and macOS;
  the release binaries with CM108 PTT; `--version` names the commit and features; no real
  callsign in a binary; a CLI decode round trip; a message v1 cannot carry is refused; the
  **declared MSRV (1.95) builds, passes clippy -D warnings and passes the tests**; every suite benchmark runs through the shipped
  binary at exploratory size and records its provenance; the golden vectors reproduce; the
  paired oracle-vs-`decode_slot` harness runs.
- **`ci.yml`** — the oracle on Python 3.10–3.13 including its freeze check, the retired
  browser runtime's reference tests, a dependency audit, and hygiene: no build artefacts, no
  `web_dist`, no launcher or installer for the retired runtime, one lockfile per package
  manager.
- **`release.yml`** — on a version tag: tests on each platform, builds `z30` and `z30-gui`
  with CM108, writes `BUILDINFO.txt` from `--version`, refuses a dirty or mismatched build, and
  publishes archives with checksums.

## History

The earlier Python benchmark (`--mode realistic` / `ideal`, the in-browser Monte Carlo
engine, `--ap`, `--compare-demod`) measured the retired oracle receiver. Its findings — the
coherence-weight defect, the browser engine's analytic receive path, the four-schedule cascade
— are recorded in the git history of this page up to commit `224b2fc` and in
[`docs/benchmarking.md`](../docs/benchmarking.md#history). Its figures describe a receiver
nobody installs any more and are not quoted as z-30's performance.
