# Codebase inventory — 2026-10-06 (Phase A)

Starting point: `main` at `acfce5e` (merge of PR #46). Nothing was modified to produce this file.
Every tracked path is classified under exactly one of: PRODUCTION, PRODUCTION TEST, PRODUCTION
TOOLING, RESEARCH TOOL, HISTORICAL RECORD, OBSOLETE, UNKNOWN. Paths are grouped where every file
in the group has the same classification and the same reason. No path was left UNKNOWN.

Baseline metrics (`metrics.sh`, `deps.sh` in this directory; timings in `PERFORMANCE.md`):

| Metric | `acfce5e` |
| :--- | ---: |
| Tracked files | 586 |
| Rust files under `crates/` / LOC | 86 / 22 907 |
| Python files (all / outside `audit/`) | 57 / 32 |
| JS/TS files (all / outside `audit/`) | 67 / 57 |
| Files under `legacy/` | 92 |
| Workspace crates | 8 |
| `Cargo.lock` packages | 455 |
| External crates, whole workspace (normal+build+dev, all targets) | 414 |
| CI jobs (`.github/workflows/*.yml`) | 13 |

## 1. Rust workspace (`crates/`)

| Path | Classification | Who needs it |
| :--- | :--- | :--- |
| `crates/z30-protocol/src/*` | PRODUCTION | constants, CRC-14, LDPC encoder, codec, `VerifiedFrame`, GFSK modulator; every binary |
| `crates/z30-dsp/src/*` | PRODUCTION | `decode_slot`, the only receiver; both binaries and the suite |
| `crates/z30-engine/src/*` | PRODUCTION | runtime, TX gate, PTT, rig, sequencer, band plan, config |
| `crates/z30-io/src/*` | PRODUCTION | audio, rigctld, serial/CM108 PTT, logbook, migration from the retired app (`z30 --migrate`, PR #46 migration safety), paths, OS clock status |
| `crates/z30-gui/src/*`, `build.rs` | PRODUCTION / PRODUCTION TOOLING | `z30-gui`; `build.rs` embeds provenance |
| `crates/z30-cli/src/{main,loopback,audio_loopback}.rs` | PRODUCTION | `z30` station, decode/encode, migrate, ADIF, loopback tests |
| `crates/z30-cli/src/{suite,bench}.rs` | PRODUCTION TOOLING | `z30 --benchmark`: the instrument behind every published figure |
| `crates/z30-cli/{build.rs,build_support.rs,clippy.toml}` | PRODUCTION TOOLING | build provenance (F-13); loopback isolation lint layer (N-04) |
| `crates/z30-channel/src/lib.rs` | PRODUCTION TOOLING | seeded channel models for tests and the suite; never on the receive path |
| `crates/*/tests/*.rs`, in-crate `#[cfg(test)]` | PRODUCTION TEST | safety, protocol, golden, regression, property, runtime, determinism |
| `crates/z30-dsp/examples/stages.rs` | PRODUCTION TOOLING | per-stage timing of `decode_slot` (used for Phase F) |
| `crates/z30-dsp/examples/syncstats.rs` | PRODUCTION TOOLING | the measurement behind `RxConfig::min_fine_sync` / `drift_gain` |
| `crates/z30-dsp/examples/sictime.rs` | PRODUCTION TOOLING | SIC micro-timing quoted in `docs/sic.md` |
| `crates/z30-dsp/examples/ldpcbench.rs` | PRODUCTION TOOLING | LDPC decoder timing on the golden corpus (no other tool times the decoder alone) |
| `crates/z30-dsp/examples/smoke.rs` | OBSOLETE | an ad-hoc AWGN success counter: a strict subset of `z30 --benchmark awgn`, referenced nowhere |
| `crates/z30-py/*` | OBSOLETE | PyO3 bindings used only by `research/paired_receiver.py` (oracle vs `decode_slot`); never shipped; sole reason `pyo3` (with two ignored RustSec advisories) is in `Cargo.lock` |

### Dead code found by static analysis (no reference anywhere in the workspace)

`z30_dsp::ap::ap_label`, `z30_dsp::baseband::SLOT_WINDOW_SEC`,
`z30_dsp::ldpc::CASCADE_ITERATIONS`, `z30_dsp::resample::rate_supports_symbols`,
`z30_dsp::sync::ToneTable::correlate`, `z30_dsp::sync::c64`, `z30_engine::bandplan::Region::verified_on`,
`z30_engine::rig::RigStateTracker::note_requested_mode` (and the write-only field `commanded_mode` it
feeds), `z30_engine::runtime::RuntimeHandle::emergency_unkey` (no caller; HALT is `halt`).

Also unreferenced, but **kept on purpose**: `z30_channel::sigma_for` and
`z30_protocol::OCCUPIED_BANDWIDTH_HZ` (whose comment says it is "used by the band-edge check";
the gate uses the measured −40 dB width). Every file under `crates/z30-protocol/{Cargo.toml,src}`
and `crates/z30-channel/{Cargo.toml,src}` is hashed into the benchmark instrument identity
(`crates/z30-cli/build_support.rs::instrument_files`), and `compare_results.py` /
`paired_mcnemar.py` refuse to compare results across an instrument change ("an instrument
change needs its own proposal and a re-baselined baseline"). Deleting two dead lines is not
worth breaking comparability with the published results, so they go with the next deliberate
instrument change. This cleanup leaves the instrument identity at
`424e6f0385e112e48a2adbcda5456e62fbad5995be73d3624982f5b8e0e0be90`, the same as `acfce5e`.

Public items reached only from tests (kept: they are test hooks into real code, e.g.
`RigStateTracker::set_resolution` is how F-27's tolerance is tested): `ApStage::from_reference_name`,
`demod::llrs`, `US_60M_CHANNEL_CENTRES_HZ`, `ptt::replace_line`, `rig::{describe_resolution,
set_resolution, in_ptt_settle_window, has_fresh_reading}`, `Logbook::in_memory`,
`Modulator::frame_len`, `CRC_BITS`.

### Declared dependencies with no use (verified by grep; confirmed by compiling without them)

| Crate | Dependency | Kind |
| :--- | :--- | :--- |
| `z30-io` | `z30-dsp` | normal |
| `z30-io` | `z30-channel` | dev |
| `z30-gui` | `z30-dsp`, `arc-swap`, `crossbeam-channel` | normal |
| `z30-engine` | `toml` | dev |
| `z30-py` | `pyo3` | normal (goes with the crate) |

`[workspace.dependencies] rtrb` is declared while `z30-io` pins `rtrb = "0.4"` itself.

### Cargo features

| Feature | Enables | Production needs it? |
| :--- | :--- | :--- |
| `z30-io/cm108`, `z30-cli/cm108`, `z30-gui/cm108` | CM108 GPIO PTT (`hidapi`) | yes: the release configuration |
| `z30-dsp/parallel` (default) | rayon in `decode_slot` | always on: no crate ever disables it, so the `cfg(not(feature = "parallel"))` code is unreachable in every build |
| `z30-py/extension-module` | maturin | no (crate removed) |

## 2. Legacy stacks

| Path | Files | Classification | Evidence |
| :--- | ---: | :--- | :--- |
| `legacy/browser-runtime/` | 66 (47 757 lines incl. `package-lock.json`) | OBSOLETE | nothing in `crates/` uses it; not built or shipped. Its only remaining consumers were the CI jobs `legacy-browser` and `golden` (the `messages.json` regeneration check) and Dependabot PR #48 |
| `legacy/python-oracle/` | 25 (7 677 lines) | OBSOLETE | nothing in `crates/` uses it. Consumers: `reference/golden/generate.py`, `research/paired_receiver.py`, CI jobs `oracle`, `dependency-audit`, `golden`, `harness`, and Dependabot (`pip`). Every property it proves is listed in section 3 with its replacement |
| `legacy/README.md` | 1 | OBSOLETE | describes the two directories above |
| `reference/golden/generate.py` | 1 | OBSOLETE | regenerates `fixtures/golden/*` from the oracle |
| `reference/golden/generate_messages.mts` | 1 | OBSOLETE | regenerates `messages.json` from the TS codec |
| `research/paired_receiver.py` | 1 | OBSOLETE | oracle-vs-`decode_slot` harness (needs the oracle and `z30-py`); its results stay as evidence |

## 3. What the Python oracle proves, and what replaces it

| Property | Oracle implementation | Production implementation | Rust coverage | Replacement |
| :--- | :--- | :--- | :--- | :--- |
| CRC-14, LDPC encode, Costas/symbol map are the v1 constants | `ldpc.py`, `message_codec.py` | `z30-protocol` | `golden.rs::crc_ldpc_and_symbols_are_bit_exact` on `codec.json` | fixtures stay (frozen, hash-pinned by `MANIFEST.json`) |
| CRC-14 known answers | `tests/generate_crc_vectors.py` → `tests/vectors/crc14_vectors.json` | `crc::crc14` | none (only Python/TS read the file) | **new** Rust test on `crc14_vectors.json` |
| Dither is a pure function of the LLRs | `ldpc.dither_vector` | `ldpc::dither_vector` | `golden_ldpc.rs::dither_matches_the_oracle` (`dither.json`) | fixtures stay; **new** Rust test on `tests/vectors/dither_vectors.json` (was Python/TS only) |
| 28-bit callsign packing | `message_codec.py` | `codec::Callsign` | `golden.rs` on `callsigns.json` | fixtures stay; **new** Rust test on `tests/vectors/callsign_pack_vectors.json` (was Python/TS only) |
| Whole-message packing | TS codec → `messages.json` | `codec::Message` | `golden.rs::whole_messages_*`, `grid_table_*` | fixture stays |
| GFSK waveform shape (pulse, ramps, tones) | `modem.py` | `gfsk::Modulator` | `golden.rs::gfsk_pulse_and_waveforms_match_within_tolerance`, `gfsk.rs` unit tests | fixtures stay |
| 99 % and −40 dB bandwidth budgets; per-symbol gating fails them; ramps; tone at symbol centre; finite and normalised | `test_modem_spectrum.py` | `gfsk::Modulator` | partial: one noisy loopback frame (`loopback.rs`), constant envelope (`gfsk.rs`) | **new** `z30-dsp/tests/modulator_spectrum.rs` (in z30-dsp because an FFT dev-dependency in z30-protocol would change the instrument identity, see §1): the same budgets, the same failing gated reference, on noiseless random frames |
| Demodulator LLRs | `acquisition.py` | `demod.rs` | `golden_demod.rs` | fixtures stay |
| BP cascade + OSD bit-exactness | `ldpc.py` | `z30_dsp::ldpc` | `golden_ldpc.rs` (corpus, OSD corpus, legacy-OSD transcription) | fixtures stay |
| AP ladders and AP decode | `ap_decode.py` | `ap.rs` | `golden_ldpc.rs::ap_*`, `ap_production.rs` | fixtures stay |
| Watterson Doppler spread | `channel.py`, `test_watterson_doppler.py` | `z30-channel` | `generated_taps_have_the_labelled_doppler_spread`, `watterson_power_spectrum_has_the_labelled_2_sigma_spread` | already covered |
| SIC candidate detection, acquisition, benchmark determinism | `sic_decoder.py`, `acquisition.py`, `benchmark.py` | `sic.rs`, `sync.rs`, `suite.rs` | `sic_regression.rs`, `channel_scenarios.rs`, suite tests | properties of the oracle's own receiver; the shipped receiver has its own |
| Python and TS agree | `test_cross_language_parity.py` | — | — | both implementations are deleted; the vectors they shared are now asserted by Rust (rows above) |
| The oracle is frozen | `FROZEN.sha256`, `test_oracle_is_frozen.py` | — | — | the oracle is gone; the fixtures it produced are pinned by `fixtures/golden/MANIFEST.json`, now checked in CI |
| A reference receiver to compare `decode_slot` against | `paired_receiver.py` + `z30-py` | — | — | the comparison was made and published (`research/results/awgn_paired_200.*`, kept). The research process compares baseline and candidate `decode_slot` builds (`suite`, `paired_mcnemar.py`), which needs no second receiver |

Conclusion: every guarantee the oracle gives the production code is carried by the golden
fixtures it already produced, which stay, plus three Rust tests on shared vectors that only
Python and TypeScript were reading, plus the ported spectrum budgets. The oracle itself adds no
check on production code. It is a second implementation that can diverge from the first, and
it can be recovered from `acfce5e`.

## 4. Research tooling (`research/`)

| Path | Classification | Why |
| :--- | :--- | :--- |
| `research/summarize_suite.py`, `suite_results.py` | RESEARCH TOOL | renders `SUMMARY.md` from suite JSON (AGENTS.md §3, `docs/research-process.md`); its test regenerates the published `672cef9b3cdb/SUMMARY.md` byte for byte |
| `research/compare_results.py`, `paired_mcnemar.py` | RESEARCH TOOL | fail-closed comparison and exact McNemar test that `docs/research-process.md` §2 requires |
| `research/lock_closure.py` | RESEARCH TOOL | `docs/research-process.md` §7: shows that a dependency update leaves the suite binary's inputs unchanged |
| `research/tests/*` | PRODUCTION TEST (of research tools) | fail-closed behaviour of the four tools above |
| `research/results/**` | HISTORICAL RECORD | published results; never edited |

All five scripts use only the standard library (`tomllib` for `lock_closure.py`). They are not
part of any binary or of the Cargo graph. Porting them to Rust would change the measurement
instrument and should be a separate, reviewed change (see `REMOVAL_PLAN.md`).

## 5. Everything else

| Path | Classification | Notes |
| :--- | :--- | :--- |
| `fixtures/golden/*` | PRODUCTION TEST | read by `golden.rs`, `golden_demod.rs`, `golden_ldpc.rs`, `ldpcbench`. `MANIFEST.json` holds their SHA-256 |
| `tests/vectors/callsign_vectors.json` | PRODUCTION TEST | `safety.rs::callsign_syntax_matches_the_shared_vectors` |
| `tests/vectors/{crc14,dither,callsign_pack}_vectors.json` | PRODUCTION TEST | only Python and TS read them today; Rust consumers added in Phase B |
| `SPEC.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, `docs/**`, `wiki/**` (except below) | PRODUCTION (documentation) | updated in Phase H |
| `wiki/08-Web-&-PWA-Architecture.md` | OBSOLETE | the whole page describes the retired browser runtime and where it is kept |
| `VNEXT_IMPLEMENTATION_PLAN.md` | HISTORICAL RECORD | the rebuild plan and the operator decisions it recorded; belongs under `audit/` |
| `audit/**` (including its `.py`, `.mts`, the excluded `poc/rust` crate) | HISTORICAL RECORD | evidence; kept unchanged |
| `hardware-validation/**` | PRODUCTION (validation records) | checklist and an empty results directory |
| `packaging/linux/*` | PRODUCTION TOOLING | desktop entry and icon used by `release.yml` |
| `.claude/agents/*` | PRODUCTION TOOLING | the review and implementation agents (AGENTS.md §9) |
| `.github/workflows/rust.yml` jobs `workspace`, `msrv`, `benchmark-suite` | PRODUCTION TOOLING | build, test, MSRV, suite provenance |
| `.github/workflows/rust.yml` jobs `golden`, `harness` | OBSOLETE | regenerate fixtures from the oracle/TS codec; drive the oracle harness |
| `.github/workflows/ci.yml` jobs `oracle`, `legacy-browser`, `dependency-audit` | OBSOLETE | test and audit the deleted stacks |
| `.github/workflows/ci.yml` jobs `rust-advisories`, `hygiene`, `research-tools` | PRODUCTION TOOLING | `rust-advisories` keeps its two pyo3 ignores only while `pyo3` is in the lock file |
| `.github/workflows/release.yml` | PRODUCTION TOOLING | release archives (one `--exclude z30-py` to drop) |
| `.github/dependabot.yml` | PRODUCTION TOOLING | its `pip` entry for `/legacy/python-oracle` is OBSOLETE |
| `Cargo.toml`, `Cargo.lock`, `rustfmt.toml`, `.gitignore` | PRODUCTION TOOLING | `.gitignore` carries Node/Python patterns that only the retired stacks needed |

## 6. Open dependency pull requests

| PR | What | Assessment |
| :--- | :--- | :--- |
| #48 | `source-map-js` in `legacy/browser-runtime` | Dead code. Deleting the subsystem makes it moot; it should be closed, not merged |
| #49 (supersedes #47) | `rand` 0.9, `rand_chacha` 0.9, `rand_distr` 0.6, `toml` 1, `syn` 3, `pyo3` 0.29 | `pyo3` is removed rather than upgraded. `rand*` drive every seeded channel and benchmark frame: a major version changes the random streams and therefore every published figure, so under `docs/research-process.md` §7 it needs the suite run on both commits. That is not part of this cleanup |
