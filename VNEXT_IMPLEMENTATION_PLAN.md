# z-30 vNext implementation plan

**Written:** 2026-09-23, after inspecting the repository at `c83bef0` (which merges the audit of
`7661caa`) and before changing anything. **Inputs:** `audit/2026-09-23-vnext/README.md`,
`AGENTS.md`, every test under `tests/`, the Python oracle `z30_dsp/`, the TypeScript runtime
`src/`, the audit's proof-of-concept `audit/2026-09-23-vnext/poc/`, the audit's raw results, CI
(`.github/workflows/ci.yml`) and the install/build scripts.

This document is the plan. Where it and the code disagree later, the code and its tests are the
record; this file says what was intended and why, and what was left for the operator to decide.

---

## 1. Confirmed architecture (what exists today)

Checked against the audit rather than taken from it:

| Claim in the audit | Checked how | Result |
| :--- | :--- | :--- |
| The operating transceiver is the browser app; Python is oracle + HTTP bridge | Read `App.tsx`, `sicDecoder.ts`, `web_server.py` | Confirmed |
| z-30 is non-coherent 16-FSK with a 21-symbol Costas *array*, no carrier loop | Read `modem.py`, `benchmark.demodulate_mfsk_llrs` | Confirmed. No RRC, PLL or Gardner block should exist |
| The LDPC cascade and demodulator port bit-exactly to Rust | Built and read `poc/rust` (`cargo build --release`) | Confirmed the PoC builds; the float32/NEP 50 rules are written down in `poc/rust/src/ldpc.rs` and are carried into `z30-dsp` |
| OSD's CRC/syndrome checks are tautologies (M1) | Read `ldpc.py:804-833` | Confirmed: `eval_candidate` recomputes the CRC from the candidate, and the final `compute_crc14(payload) == rcvd_crc` compares a CRC with itself |
| Callsign packer wraps ZV–ZZ modulo 2²⁸ (C5) | Arithmetic on `encodeCallsign28`: `p_val` reaches 1368, `1368·196830 + 196829 + 100 > 2²⁸` from prefix `ZV` upwards | Confirmed |
| v1 has no roger bit and a 63-entry grid table (H2, H3) | Read `z30Codec.ts` `packZ30Message`/`unpackZ30Message`, counted `COMMON_GRIDS` | Confirmed: 63 grids at codes 64–126, code 127 unassigned, `R-12` packs as `-12` |
| Decode is triggered before its window exists (C1) | `App.tsx:411` triggers at `cycleSec >= 24.0`; `sicDecoder.ts` asks for a window ending at slot + 25.5 s | Confirmed by reading; the audit's probe measured it |
| The frame starts at the UTC slot boundary; DT search ±1.5 s | `sicDecoder.ts` `MAX_DT_SEC`, `App.tsx:406` | Confirmed; the receive window is [slot − 1.5 s, slot + 25.5 s] |

One place where the audit is **not** followed literally, with the reason:

- **OSD fix scope.** The audit proposes "run OSD over the full 77-bit information set, CRC
  included, and accept only when the candidate's CRC field matches its payload". Implemented as
  written. It changes which frames OSD recovers (it can no longer "repair" CRC bits by
  recomputing them, which is what made the old check a tautology), so it is measured paired
  against the legacy rule rather than assumed harmless (§7, gate G2.3).
- **Drift search.** The audit proposes a linear fit over the seven Costas clusters. A fit on
  seven noisy per-cluster frequency estimates is unreliable at −23 dB, where each cluster has
  ~1 dB of Eₛ/N₀. vNext instead searches drift jointly with dt and frequency on the whole
  21-symbol sync metric (still only the Costas symbols), and lets the CRC arbitrate between
  the zero-drift and best-drift hypotheses. Measured, not assumed (gate G2.6).

## 2. Proposed architecture

As the audit's §I, with the directive's crate names:

```
Cargo.toml                 workspace
crates/
  z30-protocol/  PURE, #![forbid(unsafe_code)], no I/O. v1 constants, Costas pattern, CRC-14,
                 LDPC (216,77) tables + encoder, v1 message codec (strict: refuses what cannot
                 round-trip), symbol mapping, GFSK modulator at any sample rate.
  z30-dsp/       PURE. Rational polyphase resampler, slot FFT + spectrogram, Costas sync map,
                 multi-candidate search with NMS, fine dt/f/drift search, FFT-based non-coherent
                 Log-MAP demodulator, bit-exact LDPC cascade, fixed OSD, AP ladder, least-squares
                 SIC, decode_slot(&SlotBuffer, &RxConfig) -> SlotReport.
  z30-channel/   TEST TOOLING. Seeded AWGN (2500 Hz referenced), CFO, drift, DT, sound-card ppm,
                 Watterson (ITU-R F.1487 presets), CW interferer, K-station band synthesiser.
  z30-engine/    APPLICATION CORE, no OS I/O. Sample-clock <-> UTC model, slot scheduler, slot
                 store, RX pipeline and decode workers, TX scheduler, TxGate + band plan +
                 callsign rules + RigStateTracker, PTT safety (watchdog, release semantics),
                 QSO state machine, log-record provenance, config model,
                 Command -> Engine -> Event / EngineSnapshot. Traits for every port.
  z30-io/        ADAPTERS. cpal audio, WAV, rigctld client, serial RTS/DTR, CM108 HID GPIO
                 (feature), VOX, SQLite logbook + ADIF 3.1.4, paths, config TOML, migration of
                 the legacy JSON config and logbook.
  z30-cli/       Headless binary `z30`.
  z30-gui/       egui/eframe binary `z30-gui`. Renders EngineSnapshot, sends Commands.
  z30-py/        PyO3 bindings (maturin) for the research harness. Not shipped.
reference/       The oracle contract: which files are frozen, and the golden-vector generator.
fixtures/golden/ Golden vectors exported from the oracle.
research/        Python harness: paired comparisons, Wilson/McNemar, calls z30-py.
docs/            The vNext documentation set (directive §37).
```

Dependency direction is enforced by the crate graph: `z30-protocol` <- `z30-dsp` <- `z30-engine`
<- `z30-io` <- (`z30-cli`, `z30-gui`); `z30-channel` is a dev-dependency of the DSP tests and a
dependency of `z30-py` and the CLI benchmark only.

**Threading (runtime).** cpal callback → `rtrb` SPSC ring (copy + atomic counters only) → DSP
thread (resample to 6 kHz, waterfall rows, slot store indexed by sample number) → scheduler
(sample time → decode trigger) → decode worker pool (bounded queue; candidates parallel within a
SIC pass, passes sequential) → engine control thread (commands, QSO FSM, TxGate, rig polling,
log writer) → `ArcSwap<EngineSnapshot>` + bounded event channel → GUI/CLI. The PTT watchdog is
its own thread with its own deadline.

## 3. Files to retain, replace, delete

**Retain unchanged (frozen oracle and research assets):** `z30_dsp/modem.py`, `ldpc.py`,
`message_codec.py`, `acquisition.py`, `channel.py`, `ap_decode.py`, `benchmark.py`; `tests/`
(the Python and TS suites keep running in CI until cutover); `tests/vectors/*`; `audit/`;
`wiki/` (operator documentation; migrates to `docs/` at cutover).

**Retain until the Phase 5 migration gate (then delete):** `src/` (browser runtime), `index.html`,
`vite.config.ts`, `package*.json`, `public/`, `scripts/`, `z30_dsp/web_server.py`,
`z30_dsp/web_dist/`, `z30_dsp/gui*.py`, `z30_dsp/config_wizard.py`, `z30_dsp/rf_time_sync.py`,
`z30_dsp/sic_decoder.py`, `z30_dsp/git_sync.py`, `z30_dsp/updater.py`, `updater.py`,
`install_*.sh`, `build_*`, `run_windows.bat`, `z30.spec`, `PKGBUILD` (old form),
`src/dsp/monteCarloEngine.ts`.

Nothing is deleted in this change. The directive (§39) and `AGENTS.md` both require the
replacement to pass its migration gate first, and removing a user-facing runtime is an
operator-approval item (§44.5).

**New:** everything listed in §2, plus `SPEC.md`, this file, and the CI jobs for the workspace.

## 4. Migration strategy

- **Protocol:** v1 frozen bit-exact (`SPEC.md`). No wire change without operator approval.
- **Configuration:** `z30 --migrate` (and the GUI's first run) reads `station_config.json` (web
  UI) and `config.json` (Tk wizard) from the legacy directory (`$Z30_HOME`, `$XDG_CONFIG_HOME/z30`,
  `~/.z30`), writes `config.toml` beside them, and prints a per-field report: migrated,
  migrated-with-change (and why), or not migrated (and why). The legacy files are never modified
  or deleted.
- **Logbook:** `logbook.json` (preferred) or `logbook.adi` is imported into `logbook.sqlite`.
  Every imported field is marked `provenance = legacy-import`, because the audit showed the old
  auto-logger fabricated grids, reports and local-time `utcTime` (H1); the import cannot tell a
  received field from a fabricated one, and says so rather than laundering it into "received".
- **Operation:** Phase 5 runs the old and new receivers side by side on the same recordings
  before anything is retired.

## 5. Dependencies (each with its reason)

| Crate | Where | Why |
| :--- | :--- | :--- |
| `libm` | protocol | `erf` for the GFSK pulse; `std` has no stable `erf` |
| `rustfft`, `realfft` | dsp | FFTs; pure Rust, SIMD on x86/ARM |
| `rand`, `rand_chacha`, `rand_distr` | channel | seeded, portable, reproducible across platforms |
| `crossbeam-channel`, `arc-swap`, `rtrb` | engine, io | bounded channels, lock-free snapshot, SPSC audio ring |
| `serde`, `toml`, `serde_json` | engine, io | config and legacy JSON |
| `cpal` | io | native audio: ALSA/PipeWire-ALSA/JACK, WASAPI, CoreAudio |
| `hound` | io | WAV read/write |
| `serialport` | io | RTS/DTR PTT |
| `hidapi` (feature `cm108`) | io | CM108/CM119 GPIO PTT |
| `rusqlite` (bundled) | io | logbook |
| `clap` | cli | argument parsing |
| `eframe`/`egui` | gui | native GUI |
| `pyo3` | py | bindings (dev only, not shipped) |
| `proptest`, `criterion` | dev | property tests, benches |

## 6. Risks

| Risk | Mitigation |
| :--- | :--- |
| Whole-band multi-candidate search loses sensitivity vs the oracle's ±12 Hz / ±0.55 s window | Gate G2.2 is a paired non-inferiority test at 200 frames/point on identical buffers |
| Drift search raises the false-peak rate at threshold | CRC arbitrates; zero-drift hypothesis always tried first; measured (G2.6) |
| Fixed OSD recovers fewer frames than the tautological one | Measured paired (G2.3); reported either way |
| v1 cannot carry roger, most grids, compound/portable calls, ZV–ZZ | Strict codec refuses; operator decision on v2 (§8) |
| Real-time behaviour on real hardware cannot be verified in a cloud container | Virtual-clock tests prove the scheduling logic; hardware verification is listed as outstanding |
| GUI cannot be interactively verified here | Snapshot/command API tested headless; GUI builds on all three OSes in CI |
| No Windows/macOS machine here | CI matrix builds and tests on all three; hardware checks listed as outstanding |

## 7. Milestones and acceptance gates

| Phase | Deliverable | Gate (nothing proceeds on a failed gate) |
| :--- | :--- | :--- |
| 0 | Minimal fixes to the shipping product (C5 at the TS gate) | Existing suites pass plus a regression test |
| 1 | `SPEC.md`, `reference/`, `fixtures/golden/` | Generator reproducible; vectors committed |
| 2 | protocol, dsp, channel, py | **G2.1** golden parity (bit-exact codec/CRC/LDPC encode/symbols; waveform ≤1e-6; LDPC verdict + bits + iterations on the corpus). **G2.2** AWGN threshold through `decode_slot`, whole band, paired against the oracle at 200 frames/point. **G2.3** fixed-vs-legacy OSD paired. **G2.4** false decodes over ≥100k noise candidates with an interval. **G2.5** SIC ≥20 dB suppression at +10 dB, zero duplicates. **G2.6** drift 0–4 Hz recovered. **G2.7** `decode_slot` K=50 latency measured (<1 s target on 4 threads) |
| 3 | engine, io, cli | Every TS safety scenario ported and passing; virtual-clock 24 h soak with no missed or misaligned slot; zero allocations in the audio callback path under test |
| 4 | GUI | Builds on three OSes; UI never blocks on engine; waterfall at frame rate (manual check on hardware — outstanding) |
| 5 | Parallel run, beta, cutover | Operator-run; published figures re-measured through the shipped entry point |

## 8. Decisions reserved for the operator (not taken here)

1. **Protocol v2.** Not implemented. v1 is frozen and the codec refuses what v1 cannot carry.
   The trade study inputs are in `SPEC.md` §9; the measured part needs a candidate v2 LDPC code,
   which is a protocol design decision.
2. **CQ/reply from a grid outside the 63-entry v1 table.** v1 has no "no grid" code. vNext
   refuses to transmit such a message rather than sending a different grid. Assigning the unused
   code 127 as "no grid" would be a wire-format change (old receivers display it as `FN31`), so
   it is left to the operator.
3. **Retiring the browser runtime, `web_server.py`, `web_dist/`, the Tk tools, RF time sync.**
   Deferred to Phase 5.

## 9. Implementation order

1. Phase 0: C5 at the existing TS gate (small, safety-positive).
2. Phase 1: `SPEC.md`, golden generator, vectors.
3. `z30-protocol` → golden tests.
4. `z30-dsp` LDPC/AP (port PoC) → golden corpus; demod; acquisition; fine sync; SIC; `decode_slot`.
5. `z30-channel`, `z30-py`, `research/` harness → G2.x measurements.
6. `z30-engine` (clock model, scheduler, TxGate, rig tracker, PTT safety, QSO FSM) → safety
   scenarios and the virtual-clock soak.
7. `z30-io`, `z30-cli`, migration.
8. `z30-gui`.
9. CI matrix, `docs/`.
