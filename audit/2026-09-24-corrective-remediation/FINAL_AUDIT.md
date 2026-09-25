# Z-30 corrective remediation — final audit

| | |
| :--- | :--- |
| Repository | `themantas1994/z-30`, branch `claude/z30-corrective-remediation-q55wib` |
| Code commit audited | **`672cef9b3cdb`**: the application and receiver as fixed, which built every published result and was mutation-tested. One later code commit, **`18fbd78`**, changes only the benchmark harness's replicate seeding (`z30-cli` `suite.rs`/`bench.rs`/`main.rs`, §D); the replicates were run from it. Everything after `18fbd78` is results, documentation and this audit (`git diff 672cef9 HEAD -- crates legacy/python-oracle/z30_dsp` lists only `z30-cli/src/{suite,bench,main}.rs`, the `18fbd78` harness change; fmt and clippy `-D warnings` on 1.95.0 and 1.98.1 and the `z30-cli` tests were re-run at the results commit `54afcbf`: `evidence/final/head_gates_after_18fbd78.txt`) |
| Baseline | `130796f` = `main` `0a4d8a9` + the post-remediation audit ([BASELINE.md](BASELINE.md)) |
| Previous audits | `audit/2026-09-24-post-remediation/FINAL_AUDIT.md` (at `84033d4`), `audit/2026-09-24-vnext-remediation/FINAL_AUDIT.md`; the original `Z30_FULL_AUDIT_2026-09-24.md` is not in the repository (its 35 findings are known from those two) |
| Date | 2026-09-24 |
| Compilers | rustc 1.95.0 (declared MSRV) and 1.98.1 (stable); Python 3.11.15, NumPy 2.2.6, SciPy 1.15.3, pytest 9.1.1, ruff 0.16.5 |
| OS / CPU | Ubuntu 24.04.4 LTS, Linux 6.18.44 x86_64 (container); Intel Xeon @ 2.10 GHz, 4 logical CPUs, 15 GB |
| Hardware | **None.** No radio, sound card, audio interface, PTT interface, RF path or GPS/PPS. **Nothing here is hardware validation.** |

**Statuses used:** VERIFIED FIXED, VERIFIED FIXED — NOT HARDWARE VALIDATED, PARTIALLY FIXED,
NOT FIXED, NOT TESTED, NOT APPLICABLE. No overall score is given.

**How to read the evidence.** Every claim cites a command that was run and its output under
[`evidence/`](evidence/). "Test" means a test in the repository that fails if the defect
returns; where that has been demonstrated by mutation, the mutation ID is given
([§G](#g-mutation-testing)). The code was written by the same author as this audit: the
safeguards against self-certification are the mutation run (the tests are shown to fail on the
defect, not just to pass on the fix), the post-remediation audit's own scripts and harness
re-run unchanged against the corrected code, and bit-for-bit comparison of every benchmark with
the previously published results.

---

## 1. Summary

1. **Rust vNext is still the only production application.** The release binaries' dependency
   graph contains only the `z30-*` crates and third-party Rust crates; `pyo3` is reachable only
   from the non-shipped `z30-py`; nothing in `crates/` references `legacy/`
   (`evidence/final/dependency_graph.txt`). The release binaries were scanned directly: no `W1AW`, no retired browser/Python strings, no Python runtime, `ldd` shows only libasound, libudev, libcap, libgcc_s, libm, libc (§2; `z30` sha256 ba6a95d129b1fdd5…).
2. **A: TX round-trip gate.** The transmit path now accepts only a `VerifiedFrame`, which only
   `EncodedMessage::verify` can construct, and transmits the gate's own object. Every
   corruption kind is refused by the protocol and by the gate itself. **The mutations that
   disabled the round trip are now killed** (C06-a, C06-b; also C06-b2, b3, b6, d, e). Five
   single checks inside the round trip survive alone because each is redundant with another, and
   every pair of them is killed (C06-p1…p4). C06-c is not applicable: the weaker duplicate check
   it removed was itself deleted.
3. **B: loopback.** `--loopback-test` is a software loopback with no audio device, PTT or rig
   code in it; the sound-card test is `--audio-loopback-test` and refuses any configuration with
   a PTT method (VOX included) or rig control, before opening a device. **Loopback cannot reach
   PTT, CAT or a configured VOX path.** It cannot detect a VOX radio wired to a sound card that a
   PTT-less configuration drives; that is what `--confirm-no-transmitter` states
   (NOT HARDWARE VALIDATED).
4. **C: Watterson.** The audit's √2 finding was **confirmed** (both implementations applied the
   power-spectrum formula as the amplitude response) and **fixed in both**. The corrected spread
   is measured by new tests that fail on the old model, and by the post-remediation audit's own
   script: 0.1002 / 0.502 / 0.999 / 9.99 Hz for 0.1 / 0.5 / 1 / 10 Hz. **All fading results were
   regenerated**: 50% at −20.94 / −21.37 / −20.88 dB (good / moderate / poor), none on
   high-latitude moderate. The old −20.79 / −21.31 / −21.07 dB are withdrawn. "poor" is worse
   than before.
5. **D: AWGN.** The published −23.03 dB reproduces bit for bit at the corrected commit. Ten independent replicates put the 50% point's run-to-run standard deviation at 0.048 dB (range −23.07 … −22.93); the audit's −22.94 dB is 1.3 standard deviations from the 11-run mean and three of the suite's own replicates land at −22.93 to −22.94. The difference is **sampling variability**; no methodological or implementation difference exists (each measurement reproduces exactly from its own frames; the SNR normalisations agree to 0.00001 dB). Pooled over 2200 frames per point: **−23.00 dB [−23.04, −22.96]** (50%), −22.09 dB (90%). A flaw in the first replicate attempt (its seeds reused the published frames) was found by this analysis and fixed (`18fbd78`).
6. **E: C-05.** The dial has no default; the log says `reported_by_rig`, `commanded` (only for
   a radio-acknowledged set-frequency), `configured`, or nothing. The seven cases required are
   tested through the engine and the real runtime; old logbooks are migrated downward
   (`commanded` → `configured`). The whole record and the legacy migration were audited for
   similar leaks; the ten further ones in the §E table were fixed.
7. **F: MSRV 1.95** is now genuinely supported by the full gate set: fmt, clippy `-D warnings`,
   the release test suite and both release builds pass on 1.95.0 (166 passed, 0 failed, 2 ignored; clippy clean), and CI's
   msrv job now runs clippy.
8. **G: mutation testing.** The post-remediation audit's 28: **27 killed, 1 not applicable**. At baseline they were 22 killed and 6 surviving. That audit's text says "23 of 28", but its own result file shows 22 killed, 6 surviving: C03-c, C06-a, C06-b, C06-c, LOG-c, SNR-e. With this remediation's own: 54 single mutations, 48 killed, 5 surviving (all redundant layers of the round trip, each covered by a killed pair), 1 not applicable; 4 pairs, 4 killed (§G).
9. **Remaining (not fixed, with reasons in §6):** H-02 (hardware validation), M-08 (PTT after
   SIGKILL/power loss), L-05 (Gray-mapping loss), H-06 and H-07 (partially), the SNR estimate's
   bias on non-ideal signals (N-08, documented), and N-15 (development-only Python dependency of
   `cargo build --workspace`).

---

## 2. Test results at the audited commit

All commands are the repository's own, run at `672cef9` with a clean tree
(`evidence/gates-final-1.98.1/`, `evidence/gates-final-1.95.0/`).

| Command | 1.98.1 (stable) | 1.95.0 (MSRV) |
| :--- | :--- | :--- |
| `cargo fmt --all --check` | pass | pass |
| `cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings` | pass | **pass** |
| `cargo test --workspace --exclude z30-py --release --locked` | **166 passed, 0 failed, 2 ignored** | **166 passed, 0 failed, 2 ignored** |
| `cargo build --release --locked -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108` | pass | pass |
| `cargo build --workspace --release --locked` | pass (Python present, for `z30-py`) | pass (Python present) |

The two ignored tests are `golden_ldpc::screen_osd_pool` (a manual helper that needs
`Z30_POOL`, ignored at baseline too) and `z30-channel`'s `explore_spread_estimator_scatter`
(the exploratory run that the Doppler test's tolerances are derived from, ~2 min). Baseline was
139 passed / 0 failed / 1 ignored; the 27 new tests are listed in the sections below.

| Other check | Result | Evidence |
| :--- | :--- | :--- |
| Oracle tests (`legacy/python-oracle`, `python -m pytest tests -q`) | **152 passed** (148 at baseline + 4 Doppler tests) | `evidence/final/oracle_pytest.txt` |
| Oracle lint (`ruff check z30_dsp tests`, ruff 0.16.5 as CI pins) | all checks passed | `evidence/final/oracle_ruff.txt` |
| Golden vectors (`python reference/golden/generate.py --check`) | all 18 files byte for byte | `evidence/final/golden_check.txt` |
| Oracle freeze (`test_oracle_is_frozen.py`) | pass; `FROZEN.sha256` updated for `channel.py` in the same commit as the change, with the reason | `b75f773` |
| Research scripts lint | not a CI gate; `ruff check research/*.py` reports 10 findings at baseline and after (none introduced here); left as found | — |
| Release binaries | **38 of 38 checks pass** on the release configuration (`-p z30-cli -p z30-gui --features cm108`, `672cef9b3cdb`, clean, rustc 1.98.1): identity and provenance of both binaries; no W1AW, retired-runtime, Python or legacy status strings; `ldd` shows no Python/Node; encode → decode; four refused messages write nothing; a recording without a start time is not dated 1970; `--loopback-test` passes in software and opens no device; `--audio-loopback-test` refuses VOX and rig-control configurations before any device and requires the confirmation; a fresh install is refused for all six reasons; a legacy z-30 ADIF loses its importer's defaults and exports no invented FREQ; the benchmark entry points record commit, `decode_slot`, seed and the Doppler definition. A first run reported 2 failures that were errors in the check script (an expected slot time and a text match), kept as `release_artifact_checks_run1_script_errors.log`; the corrected script's run is `release_artifact_checks.log` | `evidence/final/release_artifact_checks.log` |
| Dependency graph | production binaries depend on no Python/Node crate; no `legacy/` path in `crates/` | `evidence/final/dependency_graph.txt` |

---

## A. TX round-trip gate (post-remediation N-03, C06-a/b/c)

**Trace (every production TX entry point).** The runtime's control thread is the only code that
keys a line or plays transmit audio: `TxScheduler::tick` → `Engine::plan_tx(slot)` →
`txgate::can_transmit` → `runtime::tx_audio(plan)` → `PttController::key` →
`AudioOutput::play`. `plan_tx` serves sequenced frames (from `CallCq` and `Answer`) and the tune
carrier; there is no other TX command. The CLI station (`--receive`) is built with `NoPtt`, a
`Silent` output and `tx_unavailable`. No feature, `cfg` or configuration field alters any of
this; release and test builds compile the same code (`#[cfg(test)]` appears only on test
modules). Paths that produce a waveform without keying: `--encode` (a WAV file) and the two
loopback tests (§B).

**Where each step happens:** message → fields (`Message::validate`, `payload`) → info bits +
CRC-14 (`ldpc::info_from_payload`) → codeword (`ldpc::encode_info`) → 75 symbols with the
Costas groups (`symbols::codeword_to_symbols`) = `EncodedMessage`. Verification
(`EncodedMessage::verify_round_trip`): Costas positions and tones → tone range → demap to a
codeword, equal to the carried codeword **and** its info bits equal to the carried info →
syndrome 0 → CRC → unpack fields → equal to the message → the message's text parses back to it
→ **the frame rebuilt from the message alone is identical, symbol for symbol** (new).

**Fix (structural).**

- `VerifiedFrame` (z30-protocol) has a private field; its only constructor is
  `EncodedMessage::verify(self)`, which runs the round trip and consumes the candidate. A
  `compile_fail` doctest shows it cannot be built otherwise (it runs in the test suite: "codec::
  VerifiedFrame (line 640) - compile fail ... ok").
- `Permission::frame: Option<VerifiedFrame>`; `allowed` requires it for a message request as well
  as an empty violation list. `plan_tx` puts **that object** in the plan
  (`TxKind::Frame(Box<VerifiedFrame>)`) instead of re-encoding; `tx_audio` modulates only it.
- `Message::encode` lost its internal payload re-decode (the audit's C06-c target). That check
  was a weaker copy of the one `verify` makes from the symbols. The property ("the frame decodes
  to this message") is now guarded inside the round trip by the decoded-fields comparison and by
  the canonical rebuild; removing either alone survives (C06-b8, C06-b9), removing both is killed
  (C06-p3).
- `--encode` and `z30-py`'s `encode_message` also go through `Message::frame` (encode + verify).

**Tests (all pass at `672cef9`).**

| Required case | Test |
| :--- | :--- |
| valid frame accepted, identical to the encoder's | `z30-protocol/tests/frame_integrity.rs::a_valid_frame_is_accepted…` |
| one-symbol corruption (3 positions, 3 messages) | `frame_integrity.rs::every_kind_of_corrupted_frame_is_refused`; through the gate: `safety.rs::n3_the_gate_refuses_every_corrupted_frame…` |
| Costas corruption | same (3 positions) |
| payload corruption with valid CRC and LDPC | same |
| codeword (field) corruption; parity corruption with consistent symbols | same |
| CRC corruption with a re-encoded, valid LDPC codeword | same |
| field corruption (message/sender/partner field with the frame unchanged) | same |
| altered symbol ordering (swap; whole-frame reversal) | same |
| altered symbol count / frame length | impossible by type: symbols are `[u8; 75]` everywhere, including `Modulator::synthesize`; the transmitted audio's length is asserted to be exactly one frame (`safety.rs::n3_the_transmitted_audio_is_the_verified_frame…`) |
| a valid frame of a different message | `safety.rs::n3_a_valid_frame_of_a_different_message_is_refused` (`FrameNotForMessage`) |
| production TX path depends on it | `n3_the_transmitted_audio…`: sequencer → `plan_tx` → gate → plan → `tx_audio` → `decode_slot` decodes the audio back to exactly the message and info bits of the frame the gate verified |
| alternate TX entry (tune) still gated | `n3_tune_and_sequenced_frames_go_through_the_same_gate` |
| the audit's independent corruption cases | `audit/2026-09-24-post-remediation/evidence/harness` `roundtrip` mode, rebuilt against `672cef9` unchanged: every case **REFUSED** (`evidence/independent_harness/roundtrip_log.txt`) |

Two further refusals were added in the gate: a fresh rig reading of a non-USB mode (L-07,
`safety.rs::l7_…`) and a zero transmit level (N-09, `n9_…`).

**Mutation result.** C06-a (`verify_round_trip` always `Ok`) **KILLED**; C06-b (the frame made transmittable without the round trip) **KILLED**; C06-b2 (gate accepts another message's frame), C06-b3 (round-trip failure not reported), C06-b6 (carried codeword/info not compared) **KILLED**; C06-d, C06-e **KILLED**. C06-b4/b5/b7/b8/b9 survive singly as redundant layers and are **KILLED in pairs** (C06-p1…p4). C06-c is not applicable (its check was removed as a duplicate). The post-remediation audit's three round-trip survivors are resolved.

---

## B. Loopback TX safety (post-remediation N-04)

**Trace at baseline:** `z30 --loopback-test` → `loopback::run` → `CpalOutput::open(configured
output device)` → `play(frame audio)`, guarded only by `--confirm-no-transmitter`. No PTT line,
no rigctld. The route to RF was the audio itself: a station's configured output device is the
radio's audio input, and a radio on VOX (or keyed by its data input) radiates it. Reproduced:
with only `[ptt] method = "vox"` configured, the test went on to open the sound card
(`evidence/baseline/n04_loopback_with_vox.txt`).

**Design now.**

- `z30 --loopback-test` = **software loopback**: `Message::frame` → `VerifiedFrame` →
  `runtime::tx_audio` → a `Vec<f32>` → `RxPipeline` (resampler, sample clock, scheduler) at 48 and
  44.1 kHz → `decode_slot`, with seeded noise at +20 dB (decode, DT, frequency, SNR) and without
  noise (occupied bandwidth). It reads no configuration, needs no confirmation, and
  `src/loopback.rs` contains no audio device, PTT, rig-control or `z30-io` code.
- `z30 --audio-loopback-test` = the sound-card test (hardware validation A1), separately named. It
  keys nothing and refuses, **before opening any device**, unless `--confirm-no-transmitter`
  is given and the configuration has no PTT method (VOX included) and no rig control.

**Tests.** `crates/z30-cli/tests/loopback_isolation.rs` (the software loopback's source contains
none of `z30_io`, `cpal`, `CpalOutput`, `AudioOutput`, `AudioInput`, `PttLine`,
`PttController`, `open_ptt`, `VoxPtt`, `Rigctld`, `RigControl`, `runtime::start`, `SerialPtt`,
`Cm108`; `main.rs` routes `--loopback-test` to it and has one entry to the hardware test);
`audio_loopback::tests` (VOX, CAT, serial, CM108 and rig control each refused, and `run` stops at
the refusal itself, not at a device); `loopback::tests::the_software_loopback_decodes_through_
the_resampler_at_both_device_rates` (decodes at both rates, DT within 20 ms, frequency within
0.5 Hz, SNR within 1 dB of the SNR set; bandwidth 50.5 / 65.9 Hz). Release binary: see §2.

**Mutation result.** LOOP-a (the software loopback opens the sound card), LOOP-b (the refusal lets VOX through), LOOP-c (the refusal ignored), LOOP-d (`--loopback-test` routed to the sound-card test): all **KILLED**.

**Answer: can loopback reach physical TX/PTT/VOX?** `--loopback-test`: **no**, it has no code
path to any output. `--audio-loopback-test`: it cannot key PTT or CAT (it has neither) and
refuses to run for any configuration that names a PTT method, VOX included, or a radio. Only
a radio on VOX physically wired to the sound card of a configuration that says there is no
radio could still transmit its audio; software cannot see that wiring.
**NOT HARDWARE VALIDATED.**

---

## C. Watterson model (post-remediation N-01)

**Investigation.** Both implementations define `doppler_hz` as "the 2-sigma width of the
Gaussian tap spectrum" and set σ = doppler_hz / 2, then multiply the tap's spectrum by
exp(−½(f/σ)²) (Rust `z30-channel/src/lib.rs` `fade`; Python `channel.py`
`apply_watterson_fading`). That is the **amplitude** response; the tap's power spectrum is its
square, exp(−(f/σ)²) = exp(−½(f/(σ/√2))²), with standard deviation σ/√2. The two
implementations were identical in this and in their normalisation (both consistent with the
filter). ITU-R F.1487 (and CCIR 549, after Watterson et al.) quote the frequency spread as the
2σ width of the Doppler **power** spectrum. So the audit's finding is **confirmed**: every
preset ran at 1/√2 of its label. Baseline measurement with the audit's own script:
0.0716 / 0.355 / 0.708 / 7.07 Hz for 0.1 / 0.5 / 1 / 10 Hz (`evidence/baseline/py_watterson_baseline.json`).

**Definition now** (on `z30_channel::Watterson`, in `channel.py`, in `fading.json`, SPEC §10,
docs/benchmarking.md): `doppler_hz = 2σ_D`, σ_D the standard deviation of the tap's Gaussian
Doppler power spectral density S(f) = exp(−f²/(2σ_D²)) / (√(2π)σ_D), two-sided, centred on
0 Hz; units Hz; tap autocorrelation ρ(τ) = exp(−2π²σ_D²τ²). **Corrected formula:** amplitude
response H(f) = √S(f) ∝ exp(−f²/(4σ_D²)); ensemble normalisation Σ|H_k|² computed from the same
power response. Commit `b75f773`, both implementations, `FROZEN.sha256` updated with the reason.

**Tests** (fail on the old model; all pass):

| Test | What | Tolerance and why |
| :--- | :--- | :--- |
| `z30-channel::watterson_power_spectrum_has_the_labelled_2_sigma_spread` | deterministic: 2σ of \|H\|² on a 24 s, 6 kHz FFT grid, each preset | 0.5% (grid error is far smaller; the defect is −29.3%) |
| `z30-channel::generated_taps_have_the_labelled_doppler_spread` | statistical: 200 realisations per preset through `fade`, 2σ by periodogram second moment **and** by autocorrelation inversion at ρ = e^−½; ensemble power | 6% good, 3% others: six independent 200-realisation batches scattered by at most 2.34% (good, whose σ_D is only 1.2 FFT bins) and 1.76% (others) (`explore_spread_estimator_scatter`), so ≈ 4× the observed scatter; the defect sits ≈ 20 scatter-widths outside |
| `z30-channel::watterson_preserves_power_over_the_ensemble_and_not_per_frame` | ensemble mean power; frame-power CV against its exact value sqrt(Σ\|H\|⁴)/Σ\|H\|² for circularly generated taps | 25%; measured within 5% for every preset. Its old "good: cv > 0.5" bound held only for the defective, slower channel (theory 0.58; corrected 0.49) and would have failed the correct model: the bound was replaced by the theoretical value, which also still catches per-frame normalisation (cv = 0) |
| oracle `tests/test_watterson_doppler.py` (4 presets) | statistical, 150 realisations through `apply_watterson_fading`, periodogram of the recovered gain; ensemble power | 7% good, 4% others: four independent batches scattered ≤ 2.14% / ≤ 1.71% |

**Independent check.** The post-remediation audit's `py_watterson.py`, unchanged, on the
corrected oracle: **0.1002 / 0.502 / 0.999 / 9.99 Hz** (`evidence/py_watterson_after_fix.json`).
Its harness `watterson` mode on the corrected Rust model: **0.097 / 0.096** (two lags), **0.498 / 0.498**, **1.000 / 1.000**, **9.980 / 9.979 Hz** for 0.1 / 0.5 / 1 / 10 Hz, ensemble power and deep-fade fraction as before (`evidence/independent_harness/audit_watterson.json`; at baseline the same harness measured 0.066 / 0.353 / 0.706 / 7.064 Hz).
Rust/Python agreement: both implement the same S(f) and pass the same measurement at the same
tolerances; the two independent measurements agree with each other and with the labels to
within 4% for "good" and 0.5% for the other presets. The "good" preset (σ_D = 0.05 Hz, about 1.2 FFT bins of a 24 s frame) is where these estimators scatter most: at baseline the audit's harness read 0.066 Hz against the 0.0707 Hz its own analysis expected, 7% low.

**Regenerated results** (`research/results/672cef9b3cdb/fading.json`, the production `z30`
binary at `672cef9`, clean tree, release profile, rustc 1.98.1, x86_64 Linux, Intel Xeon
2.10 GHz × 4, 6 kHz, blind placement, average SNR in 2500 Hz, suite seed 20260830, 200 frames per
point, success = decoded payload equal to the transmitted one, false decode = any other CRC-valid
decode, `RxConfig::default()`, command `z30 --benchmark suite`, started 2026-09-24T21:08:25Z):

| Preset (delay / 2σ Doppler) | 50% corrected | 50% withdrawn (1/√2 model) |
| :--- | :--- | :--- |
| good (0.5 ms / 0.1 Hz) | −20.94 dB [−21.33, −20.55] | −20.79 |
| moderate (1 ms / 0.5 Hz) | −21.37 dB [−21.63, −21.12] | −21.31 |
| poor (2 ms / 1 Hz) | −20.88 dB [−21.09, −20.68] | −21.07 |
| high-latitude moderate (3 ms / 10 Hz) | no decode, 0 of 800 frames, −20…+10 dB | same |

0 false decodes in 5000 fading frames. Updated: README, wiki 11 (the FT8 comparison's fading rows
and text), wiki 16, docs/benchmarking.md, AGENTS.md §5, research/results/README.md, SPEC §10.
The FT8 comparison has no FT8 fading figure to recompute (it was and remains [N]). No plot exists
in the repository for these results.

---

## D. AWGN discrepancy (−22.94 vs −23.03 dB)

**Question.** The suite published 50% at −23.03 dB [−23.13, −22.89] and 90% at −22.06 dB; the
post-remediation audit's independent harness measured −22.94 dB and −22.06 dB. Is the 0.09 dB a
methodological or implementation difference, or sampling?

**What differs between the two measurements** (the harness source is in the audit's evidence):

| Candidate cause | Finding | Evidence |
| :--- | :--- | :--- |
| binary / compiler / receiver version | none: the published run reproduces bit for bit at `672cef9` (and at `18fbd78`), and the audit's harness, rebuilt against `672cef9`, reproduces **its own** run exactly (same counts, −22.94 / −22.06 dB). Each figure is a deterministic property of its frames | `research/results/672cef9b3cdb/awgn.json`, `18fbd78d8fb8/awgn.json`, `evidence/independent_harness/audit_awgn.json` |
| SNR normalisation (reference frame power vs each frame's own power) | identical to < 0.00001 dB over 2000 random frames | `evidence/awgn_investigation/powercheck_output.txt` |
| placement (tone 0, DT, phase, payload) | same distributions (uniform 210–2740 Hz, ±1.4 s, 0–2π, random 63 bits) | both sources |
| noise generator | ChaCha8 (`z30-channel`) vs ChaCha20 (harness), both N(0, 1): different frames, same statistics | — |
| seed / frames | different seeds, 200 frames per point each | — |
| SNR grid and interpolation | the same crossing method; the harness adds −24.5 and −21.5 dB points, which do not bracket 50% or 90% | `analyse_awgn.py` re-implements the crossing and checks it against the suite's own value |
| confidence interval | both Wilson 95%; the difference is inside both intervals | — |
| acquisition behaviour | same receiver, `RxConfig::default()` in both | — |

**Repetitions.** Ten further AWGN runs of the suite, each on 200 frames per point that no other
run shares (`--replicate 1…10`, from a clean build of `18fbd78`; a first attempt with a
`--seed` option turned out to reuse the published frames and was discarded, see below):

| Run | 50% (dB) | 90% (dB) |
| :--- | ---: | ---: |
| published (replicate 0) | −23.035 | −22.061 |
| replicate 1 | −22.934 | −22.096 |
| replicate 2 | −23.019 | −22.133 |
| replicate 3 | −23.010 | −22.043 |
| replicate 4 | −23.049 | −22.122 |
| replicate 5 | −22.985 | −22.073 |
| replicate 6 | −22.944 | −22.160 |
| replicate 7 | −22.930 | −22.092 |
| replicate 8 | −23.009 | −21.909 |
| replicate 9 | −23.044 | −22.130 |
| replicate 10 | −23.067 | −22.042 |
| **11 runs** | **mean −23.002, sd 0.048**, range −23.067 … −22.930 | mean −22.078, sd 0.068 |
| **pooled, 2200 frames per point** | **−23.00 dB [−23.04, −22.96]** | **−22.09 dB [−22.12, −22.05]** |
| the audit's harness | −22.939 (z = +1.3 against the run-to-run sd) | −22.059 |

Per SNR point, pooled suite against the audit (exact two-sided Fisher): −24.0 dB 148/2200 vs
18/200, p = 0.24; −23.5 dB 478/2200 vs 50/200, p = 0.29; −23.0 dB 1104/2200 vs 93/200, p = 0.34;
−22.5 dB p = 0.80; −22.0 dB p = 0.57. (Against the single published run the −23.5 dB point gives
p = 0.048, one of eight comparisons, not significant after correcting for them.)

**Explanation.** The difference is **sampling variability of a 200-frame-per-point measurement**.
The crossing's run-to-run standard deviation is 0.048 dB, three of the suite's own ten replicates
land at −22.93 to −22.94 dB, and the audit's value is 1.3 standard deviations from the mean of 11
runs; the published value is 0.7 standard deviations on the other side. No methodological or
implementation difference was found: every candidate above was checked and each measurement
reproduces exactly from its own frames. **Both −23.03 and −22.94 dB are valid 200-frame estimates
of the same quantity; the better-supported value is the pooled −23.00 dB [−23.04, −22.96]**.
The published figure is kept as the suite's published-seed result (the project's rule: figures
come from the suite file), and the documentation now states the replicate spread and the pooled
value beside it. Nothing about the result moved the decision: it was fixed before the replicates
ran that the headline stays the suite's figure and the spread is added whatever it was.

**A defect found and fixed along the way.** The first replicate attempt (`--seed 1…10` at
`672cef9`) gave seven identical crossings (−23.000 dB) and three identical ones (−23.017 dB): an
sd of 0.012 dB, impossible for 200-frame points. `frame_seed` XORs the frame index into the low
bits of the base seed, so small seeds only permuted the published frames. Fixed in `18fbd78`
(`--replicate r`, base `20260830 ^ (r << 48)`, with a test that fails on the old scheme; the
published seed is unaffected). The flawed outputs are kept, labelled, in
`evidence/awgn_investigation/flawed_seed_replicates_672cef9/` and were used for nothing.

Evidence: `evidence/awgn_investigation/awgn_replicate_analysis.json` (from `analyse_awgn.py`),
`research/results/18fbd78d8fb8/`.

---

## E. C-05 — logbook provenance (post-remediation N-05, N-06)

**Model.** `Provenance` now reads, for a dial: `ReportedByRig` (a fresh CAT reading, the radio's
own value; stored `reported_by_rig`, old `rig_verified` read as it), `Commanded` (z-30 sent a
set-frequency for exactly this value **and the radio acknowledged it**), `Configured` (the
operator's setting), and absent (`dial_hz: Option<Sourced<f64>>`) — Unknown is absence, as for
every other field. `OperatingConfig::dial_hz` is `Option<u64>` with **no default**. The engine
keeps the dial and a `dial_commanded` flag set only by `on_dial_command_result(hz, Ok)` for the
current dial; the runtime now forwards the operator's dial changes to rig control and returns
the radio's answer.

**Tests** (`crates/z30-engine/tests/dial_provenance.rs`, all pass):

| Required | Test | Result |
| :--- | :--- | :--- |
| 1. no rig information → unknown | `p1_…` | dial absent, band absent; the gate refuses (`FrequencyUndetermined`) |
| 2. configured only → configured | `p2_…` | `Configured` |
| 3. command sent and acknowledged → commanded | `p3_…` | `Commanded` |
| 4. rig reports → reported-by-rig | `p4_…` | `ReportedByRig` with the radio's value |
| 5. command fails → not commanded | `p5_…` | `Configured`, and a rig event says the radio refused |
| 6. stale / default not treated as actual | `p6_…` | stale reading → `Configured`; late acknowledgement of an old dial → not commanded; no default dial exists |
| through the real runtime threads | `runtime_path::p7_…` | a scripted rig: acknowledged → commanded; refused → not; no rig → not |
| 7. legacy FN31 / −16 stay unknown | `z30-io` `migrate::tests::the_legacy_auto_loggers_defaults…`, `each_legacy_writers_defaults_stay_unknown_and_only_those` | dropped and reported |

Existing logbooks: `logbook::tests::a_version_1_logbook_is_migrated_without_upgrading_any_claim`
— schema v2 on open; `commanded` → `configured`, 0 Hz → absent. Reproduced baseline defect:
`evidence/baseline/n05_probe_output.txt` (14 076 000 Hz tagged `Commanded` with no rig).

**Whole-model audit for similar leaks — found and fixed:**

| Leak | Fix |
| :--- | :--- |
| `tx_audio_hz` was the *configured* audio offset at logging time | the offset of the last frame actually transmitted; absent if none |
| legacy auto-logger "frequency" (configured dial **plus receive audio offset**) imported as the dial | dropped, reported |
| legacy manual form: grid defaulted to FN31, frequency = the band's default dial; both kept | dropped by entry origin (`manual-` id), reported |
| legacy ADIF importer's −15 reports and 14.076 MHz fallback kept | dropped by entry origin (`import-` id, or a `PROGRAMID z-30` ADIF file), reported |
| legacy missing frequency imported as 0 Hz; `tx_audio_hz` as 0 | absent |
| out-of-range legacy reports clamped to ±99 (changed into a value) | dropped, reported |
| `rst_rcvd` absence untested (LOG-c) | record-builder test `qso::tests::the_record_holds_no_report…` |
| GUI showed an unreadable logbook as empty; unset power as "0 W" | error shown; "not set" |
| a recording decoded without `--start-utc` printed and captured as 1970-01-01 | "window N (UTC unknown)"; captures `slot`/`window_start_utc` null |
| `utc_now()` → 0.0 (1970) before the epoch, in four readers (N-13) | one `wallclock::system_utc()` returning the true (negative) value |

The repository-wide term search is in §7.

**Mutation result.** DIAL-a (configured logged as commanded), DIAL-b (a refused command counted), DIAL-c (the 14.076 MHz default restored), DIAL-d (a changed dial keeps "commanded"), DIAL-e (v1 migration keeps `commanded`), DIAL-f (legacy dial-plus-offset kept), DIAL-g (a stale reading counted): all **KILLED**; LOG-a…f all **KILLED** (LOG-c survived at baseline).

---

## F. MSRV

Option A was taken: 1.95 is made genuinely supported, because 1.95 is also what the GUI
dependency (egui/eframe 0.36) needs, so raising the MSRV would not have been truthful either.
The only failure was `clippy::overly_complex_bool_expr` (deny by default in 1.95, not in 1.98) on
`pb != 0 && !(pa != 0 && pb == 0)`, which is the predicate `pb != 0`; the canonical-decode test
over the whole 28-bit space (`exhaustive_canonical_decode_round_trip`) still passes. CI's `msrv`
job now runs `cargo clippy … -D warnings` (with the CM108 feature) as well as build and test,
reading the version from `Cargo.toml`.

Result on rustc 1.95.0 at `672cef9`: `cargo fmt --all --check` pass; `cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings` **pass** (it failed at baseline); `cargo test --workspace --exclude z30-py --release --locked` **166 passed, 0 failed, 2 ignored**, the same as stable, the `compile_fail` doctest included; the CM108 release build and `cargo build --workspace --release` pass (`evidence/gates-final-1.95.0/`). The
dev-worktree check also ran clippy on 1.95.0 with `--features z30-cli/cm108,z30-gui/cm108`:
clean. `rust-version = "1.95"` in `Cargo.toml`, README badge, docs/install.md, docs/development.md,
wiki 02/09/16 and AGENTS.md now say the same thing.

---

## G. Mutation testing

Script: `evidence/scripts/mutate_corrective.py` — the post-remediation audit's 28 mutations
(patterns updated only where the code they target moved, marked `audit*`), plus 26 single and
4 pair mutations for this remediation's fixes. Each mutation is applied in a separate worktree at
`672cef9`, the guarding tests are run (`cargo test --locked`, the workspace test profile,
opt-level 3), and the file is restored; every test group was first shown to pass unmutated. Full
results: `evidence/mutation/mutation_results.json` / `mutation_log.txt` (singles) and
`mutation_results_pairs.json` / `mutation_log_pairs.txt` (pairs).

| ID | Origin | Area | Mutation | Result | Killed by (first test group) / classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| C01-a | audit | C-01 | window shortened by 0.5 s (ends at slot + 25.0 s) | **KILLED** | -p z30-engine --test live_runtime: c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime |
| C01-b | audit | C-01 | decode triggered 0.5 s early; missing tail zero-padded (the legacy defect) | **KILLED** | -p z30-engine --test live_runtime: c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime |
| C01-c | audit | C-01 | slot boundary shifted by +100 ms | **KILLED** | -p z30-engine --test live_runtime: c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime |
| C01-d | audit | C-01 | slot boundary shifted by +5 ms (30 samples) | **KILLED** | -p z30-engine --test live_runtime: c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime |
| C01-e | audit | C-01 | final 0.1 s of the window zeroed | **KILLED** | -p z30-engine --test live_runtime: c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime |
| C03-a | audit | C-03 | 'synchronised' claimed when timedatectl could not be run | **KILLED** | -p z30-io --lib: wallclock::tests::synchronised_is_claimed_only_when_the_os_says_so |
| C03-b | audit* | C-03 | an own time offset of +0.7 s applied to UTC | **KILLED** | -p z30-io --lib: wallclock::tests::utc_is_the_operating_systems_with_no_offset_applied |
| C03-c | audit* | C-03 | an own time offset of +0.3 s applied to UTC | **KILLED** | -p z30-io --lib: wallclock::tests::utc_is_the_operating_systems_with_no_offset_applied |
| C03-d | new | C-03 | an own time offset of +0.01 s applied to UTC | **KILLED** | -p z30-io --lib: wallclock::tests::utc_is_the_operating_systems_with_no_offset_applied |
| C06-a | audit | C-06 | verify_round_trip always succeeds | **KILLED** | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-b | audit* | C-06 | the frame is made transmittable without the round trip (verify() ignores it) | **KILLED** | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-b2 | new | C-06 | the gate hands out a verified frame of a different message | **KILLED** | -p z30-engine --test safety: n3_a_valid_frame_of_a_different_message_is_refused |
| C06-b3 | new | C-06 | a failed round trip is not reported as a violation | **KILLED** | -p z30-engine --test safety: g6_the_whole_frame_is_checked_partner_call_grid_and_report_not_just_our_call, n3_the_gate_refuses_every_corrupted_fram... |
| C06-b4 | new | C-06 | 'allowed' no longer requires the verified frame (second fail-closed guard removed) | **SURVIVED** | SAFE (equivalent): every path that leaves no frame also pushes a violation, so this second guard is unreachable alone; with C06-b3 it matters, and C06-p4 is KILLED |
| C06-b5 | new | C-06 | the round trip no longer checks the Costas symbols | **SURVIVED** | SAFE (redundant): Costas corruption is still refused, by the canonical re-encoding comparison (the demapper ignores sync positions); C06-p1 (both removed) is KILLED |
| C06-b6 | new | C-06 | the round trip no longer compares the carried codeword/info with the symbols | **KILLED** | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-b7 | new | C-06 | the round trip no longer checks the syndrome | **SURVIVED** | SAFE (redundant): a parity-inconsistent frame is still refused by the canonical re-encoding comparison; C06-p2 is KILLED |
| C06-b8 | new | C-06 | the round trip no longer compares the decoded fields with the message | **SURVIVED** | SAFE (redundant): a frame decoding to another message is still refused by the canonical re-encoding comparison; C06-p3 is KILLED |
| C06-b9 | new | C-06 | the round trip's canonical re-encoding comparison removed | **SURVIVED** | SAFE (redundant): the canonical re-encoding is implied by the other checks (a zero-syndrome systematic codeword is fixed by its info bits, and those by the message); C06-p1/p2/p3 are KILLED |
| C06-c | audit* | C-06 | (audit: encoder's payload round-trip check removed) - that check was deleted as a weaker duplicate of verify's; see C06-b8 | **NOT APPLICABLE** | NOT APPLICABLE: the audit's target (encode's payload re-decode) was deleted as a weaker duplicate of the round trip; the same property is C06-b8/C06-p3 |
| C06-d | audit | C-06 | gate no longer checks the frame is sent from this station | **KILLED** | -p z30-engine --test safety: g5_the_frame_must_encode_and_be_sent_from_this_station |
| C06-e | audit | C-06 | encoder hashes an off-table grid onto the table (legacy FN42->RE78), round-trip checks intact | **KILLED** | -p z30-protocol: codec::tests::audit_h2_h3_m6_are_refused_not_transformed |
| TXG-mode | new | L-07 | the gate ignores a radio reporting LSB/FM/AM/CW | **KILLED** | -p z30-engine --test safety: l7_a_radio_reporting_a_mode_other_than_usb_is_refused_and_only_while_fresh |
| TXG-level | new | N-09 | the gate keys with a zero transmit level | **KILLED** | -p z30-engine --test safety: n9_a_zero_transmit_level_is_refused |
| LOOP-a | new | N-04 | the software loopback opens the output sound card | **KILLED** | -p z30-cli: the_software_loopback_has_no_audio_device_ptt_or_rig_control_in_it |
| LOOP-b | new | N-04 | the audio loopback refusal lets VOX through | **KILLED** | -p z30-cli: audio_loopback::tests::it_refuses_every_configuration_that_can_key_a_transmitter_before_opening_a_device |
| LOOP-c | new | N-04 | the audio loopback ignores its refusal | **KILLED** | -p z30-cli: audio_loopback::tests::it_will_not_play_audio_without_the_confirmation, audio_loopback::tests::it_refuses_every_configuration_that_can_... |
| LOOP-d | new | N-04 | --loopback-test runs the sound-card test | **KILLED** | -p z30-cli: the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag |
| WAT-a | new | N-01 | Rust: the 1/sqrt 2 defect re-introduced (amplitude response = power spectrum) | **KILLED** | -p z30-channel: tests::watterson_power_spectrum_has_the_labelled_2_sigma_spread, tests::generated_taps_have_the_labelled_doppler_spread, tests::wat... |
| WAT-b | new | N-01 | Rust: sigma_D defined as spread / (2 sqrt 2) | **KILLED** | -p z30-channel: tests::watterson_power_spectrum_has_the_labelled_2_sigma_spread, tests::generated_taps_have_the_labelled_doppler_spread |
| WAT-c | new | N-01 | Rust: sigma_D defined as spread (1-sigma convention) | **KILLED** | -p z30-channel: tests::watterson_power_spectrum_has_the_labelled_2_sigma_spread, tests::generated_taps_have_the_labelled_doppler_spread |
| WAT-py | new | N-01 | oracle: the 1/sqrt 2 defect re-introduced | **KILLED** | PY tests/test_watterson_doppler.py: tests/test_watterson_doppler.py::test_generated_taps_have_the_labelled_doppler_spread[good-0.07], tests/test_wa... |
| LOG-a | audit | C-05 | QsoRecord::validate always accepts | **KILLED** | -p z30-engine --test qso_logging: a_record_without_a_partner_or_a_real_utc_time_is_refused |
| LOG-b | audit | C-05 | missing grid logged as FN31 | **KILLED** | -p z30-engine --test qso_logging: a_contact_with_no_grid_received_logs_no_grid_and_real_utc |
| LOG-c | audit | C-05 | missing received report logged as -16 | **KILLED** | -p z30-engine --lib: qso::tests::the_record_holds_no_report_that_was_not_received_or_sent |
| LOG-d | audit | C-05/M-07 | unmeasured SNR produces a -16 report | **KILLED** | -p z30-engine --test qso_logging: no_measured_snr_means_no_report_is_sent_and_none_is_logged |
| LOG-e | audit | C-05 | UTC shifted by +1 h (local time written as UTC) | **KILLED** | -p z30-io --test logbook_integrity: utc_in_the_log_does_not_depend_on_the_local_time_zone |
| LOG-f | audit | C-05 | validate accepts start times before 2020 | **KILLED** | -p z30-engine --test qso_logging: a_record_without_a_partner_or_a_real_utc_time_is_refused |
| DIAL-a | new | N-05 | a configured dial is logged as commanded | **KILLED** | -p z30-engine --test dial_provenance: p5_a_command_the_radio_refused_is_not_commanded, p2_a_configured_dial_with_no_radio_is_logged_as_configuratio... |
| DIAL-b | new | N-05 | any answer from the radio (even a refusal) counts as commanded | **KILLED** | -p z30-engine --test dial_provenance: p5_a_command_the_radio_refused_is_not_commanded, runtime_path::p7_through_the_runtime_only_an_acknowledged_se... |
| DIAL-c | new | N-05 | the 14.076 MHz default dial re-introduced | **KILLED** | -p z30-engine --test dial_provenance: p6_stale_readings_old_acknowledgements_and_defaults_are_not_evidence |
| DIAL-d | new | N-05 | changing the dial keeps the old dial's 'commanded' | **KILLED** | -p z30-engine --test dial_provenance: p6_stale_readings_old_acknowledgements_and_defaults_are_not_evidence |
| DIAL-e | new | N-05 | the v1 logbook migration keeps 'commanded' | **KILLED** | -p z30-io --lib: logbook::tests::a_version_1_logbook_is_migrated_without_upgrading_any_claim |
| DIAL-f | new | N-05 | migration keeps the legacy auto-logger's dial-plus-offset frequency | **KILLED** | -p z30-io --lib: migrate::tests::each_legacy_writers_defaults_stay_unknown_and_only_those, migrate::tests::the_legacy_auto_loggers_defaults_and_run... |
| DIAL-g | new | N-05 | a stale rig reading is logged as reported by the rig | **KILLED** | -p z30-engine --test dial_provenance: p6_stale_readings_old_acknowledgements_and_defaults_are_not_evidence |
| SIC-a | audit | SIC | subtraction computes but does not modify the residual | **KILLED** | -p z30-dsp --test sic_regression: a_subtraction_never_adds_energy_and_removes_what_the_station_contributed |
| SIC-b | audit | SIC | only half of the fitted component subtracted | **KILLED** | -p z30-dsp --test sic_regression: a_subtraction_never_adds_energy_and_removes_what_the_station_contributed |
| SIC-c | audit | SIC | the station's span is zeroed instead of subtracted | **KILLED** | -p z30-dsp --test sic_regression: subtracting_a_frame_that_is_not_there_removes_only_the_noise_projection_and_creates_nothing, a_subtraction_never_... |
| SNR-a | audit | M-07 | noise taken from the received off-tone bins (the audited saturating estimator) | **KILLED** | -p z30-dsp --test snr_accuracy: an_estimate_is_never_reported_above_the_strongest_signal_measured, reported_snr_tracks_the_true_snr_from_threshold_... |
| SNR-b | audit | M-07 | SNR clipped at +6.6 dB | **KILLED** | -p z30-dsp --test snr_accuracy: an_estimate_is_never_reported_above_the_strongest_signal_measured, reported_snr_tracks_the_true_snr_from_threshold_... |
| SNR-c | audit | M-07 | SNR is a constant -16 dB | **KILLED** | -p z30-dsp --test snr_accuracy: no_signal_is_no_estimate_never_a_floor_value, an_estimate_is_never_reported_above_the_strongest_signal_measured, re... |
| SNR-d | audit | M-07 | LS-projection noise bias correction removed | **KILLED** | -p z30-dsp --test snr_accuracy: reported_snr_tracks_the_true_snr_from_threshold_to_plus_30_db |
| SNR-e | audit | M-07 | no-estimate case floored to -30 dB instead of None | **KILLED** | -p z30-dsp --test snr_accuracy: no_signal_is_no_estimate_never_a_floor_value |
| SNR-f | audit | M-07 | SNR biased by +1.0 dB | **KILLED** | -p z30-dsp --test snr_accuracy: reported_snr_tracks_the_true_snr_from_threshold_to_plus_30_db |
| C06-p1 | new | C-06 | PAIR: Costas check AND canonical re-encoding comparison removed | **KILLED** | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-p2 | new | C-06 | PAIR: syndrome check AND canonical re-encoding comparison removed | **KILLED** | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-p3 | new | C-06 | PAIR: decoded-fields comparison AND canonical re-encoding comparison removed | **KILLED** | -p z30-protocol: every_kind_of_corrupted_frame_is_refused |
| C06-p4 | new | C-06 | PAIR: a failed round trip not reported AND 'allowed' not requiring the frame | **KILLED** | -p z30-engine --test safety: g6_the_whole_frame_is_checked_partner_call_grid_and_report_not_just_our_call, n3_the_gate_refuses_every_corrupted_fram... |


**The post-remediation audit's 28 mutations: 27 KILLED, 1 NOT APPLICABLE** (C06-c: the check it removed no longer exists). At baseline they were 22 killed and 6 surviving; that audit's own `mutation_results.json` shows 22/6, although its text says "23 of 28". Every baseline survivor that still applies (C03-c, C06-a, C06-b, LOG-c, SNR-e) is now killed. **All 54 single mutations: 48 KILLED, 5 SURVIVED, 1 NOT APPLICABLE; 4 pair mutations: 4 KILLED.** The five survivors are all single checks inside the round-trip verification, each redundant with another check that the tests do exercise; removing both members of each pair is killed, so the property is protected (§G). Run at `672cef9b3cdb`, rustc 1.98.1, test profile.

**Survivors, classified** (none is a real test gap; none is a tool limitation or false positive):

- C06-b4, C06-b5, C06-b7, C06-b8, C06-b9 — SAFE: redundant defence in depth inside `verify_round_trip` / the gate, each shown by a KILLED pair (C06-p1…p4). A single redundant check surviving is the expected outcome of layering; had a *pair* survived, the property would have been unprotected.
- C06-c — NOT APPLICABLE (see the table).

Baseline for comparison: `evidence/baseline/mutation_survivors_baseline.log` (the same six mutations surviving at `130796f`). The first attempt of this run used `cargo test --release`; it was stopped after its baseline groups because the release profile's LTO made each mutant's rebuild several minutes, and restarted with the workspace test profile (opt-level 3, no LTO), as the post-remediation audit's script did. No mutant result from the stopped attempt was discarded: it had produced none.

---

## 3. Benchmark provenance (§11 of the brief)

- **Call graph:** `z30 --benchmark suite` → `suite::run` → `run_point` → `z30_channel::synthesize`
  (ground truth stays in the harness) → `z30_dsp::slot::Receiver::decode_slot(&window,
  &RxConfig::default())` → `score` compares payloads afterwards. The GUI and CLI stations call
  the same `decode_slot` with `Config::rx_config()`, whose defaults equal `RxConfig::default()`.
  `z30-dsp/src` has no `cfg` besides the bit-identical `parallel` feature, reads no environment
  variable, and has no access to the truth; `--replicate r` changes only the harness's frame
  generator (suite seed 20260830 ^ (r << 48), not the receiver) and is recorded in each result
  (`seed.suite_seed`, `seed.replicate`, `seed.published_seed`, and `not_the_published_run` for
  r ≥ 1). The `--seed` option it replaced was removed (§D).
- **Unchanged receiver:** `git diff 130796f 672cef9 -- crates/z30-dsp/src crates/z30-protocol/src/{gfsk,ldpc,crc,symbols}.rs`
  is empty. Nine benchmarks at `672cef9` equal the published `d8983eeef66e` results in every
  count, rate, interval and error statistic (`evidence/scripts/compare_results.py`; only
  latency, which is wall-clock, differs). Fading differs because its channel was corrected.
- **The benchmark follows the decoder:** the production decoder was deliberately weakened in a separate worktree (`LDPC_MAX_ITERATIONS` 45 → 5, `evidence/benchmark_provenance/decoder_mutation.diff`), `z30` rebuilt, and `--benchmark awgn --frames 50` run on the same seeded frames with the real and the mutated binary. The mutant decoded fewer frames at every non-saturated point (211 against 228 of 450; 22/50 against 28/50 at −23 dB), its 50% point moved from −23.10 to −22.86 dB, and it labelled itself `672cef9b3cdb-dirty` and warned that its results are not publishable (`evidence/benchmark_provenance/`). The benchmark measures whatever decoder is built; it has no copy of its own
- No result file was edited by hand; `SUMMARY.md` was regenerated with `summarize_suite.py
  --write`.

---

## 4. Findings of `Z30_FULL_AUDIT_2026-09-24.md`

"HW?" = hardware needed to close.

| ID | Original finding | Status now | Evidence / test | Commit / file | Remaining limitation | HW? |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| C-01 | Installed receiver did not decode live audio | VERIFIED FIXED — NOT HARDWARE VALIDATED | `live_runtime::c01_…`, `virtual_clock` soak; C01-a…e all killed | unchanged since `d8983ee` | real device timing and the resampler in the live runtime not measured with a sound card (the software loopback now drives the resampler + scheduler at 48/44.1 kHz) | yes |
| C-02 | −22.9 dB presented as the shipped decoder's sensitivity | VERIFIED FIXED (simulation) | `research/results/672cef9b3cdb/awgn.json` = `d8983eeef66e/awgn.json` point for point; §D | — | simulation only; FT8 figure published, not reproduced | no |
| C-03 | RF time sync succeeded on noise, persisted offsets | VERIFIED FIXED | no RF/network time source; `wallclock::tests` now brackets `utc_now` between two OS readings; C03-a/b/c/d all killed (C03-c survived at baseline) | `a37c4f2` `wallclock.rs` | — | no |
| C-04 | Stale bundle defaulting to W1AW | VERIFIED FIXED | `config::tests::a_new_installation…` (now also: no dial, level 0); release binaries: 0 `W1AW` (§2) | — | — | no |
| C-05 | Auto-logger fabricated QSO fields | VERIFIED FIXED | §E; `dial_provenance.rs` (7), `qso_logging.rs`, `logbook_integrity.rs`, `migrate::tests`, `logbook::tests`; LOG-a…f, DIAL-a…g all killed | `a37c4f2` `engine.rs`, `qso.rs`, `logbook.rs`, `migrate.rs`, `config.rs` | legacy imports cannot recover what the legacy app never recorded (times, dials); values that could be its defaults are dropped | no |
| C-06 | Packer substituted calls/grids; gate checked own call only | VERIFIED FIXED | §A; `frame_integrity.rs`, `safety.rs` g5/g6/n3; C06-a…e, b2…b9 see §A/§G | `46e73cf`, `a37c4f2` | — | no |
| H-01 | Legacy SIC not physical; duplicates | VERIFIED FIXED (simulation) | `sic.json` identical to `d8983eeef66e`; SIC-a/b/c all killed | — | real collisions unmeasured | no |
| H-02 | No real-world validation | **NOT FIXED** | `hardware-validation/results/` empty | — | needs the equipment in §8 | **yes** |
| H-03 | Self-test shown as real decodes | VERIFIED FIXED | no injection path in engine/GUI; synthetic signals only behind `--benchmark` / `--loopback-test`, which write JSON marked `software-loopback` / simulation | — | — | no |
| H-04 | False wiki facts | VERIFIED FIXED | the post-remediation N-01/N-10/N-11 document errors corrected (§5); term search §7 | docs commit | — | no |
| H-05 | Legacy decode on the UI thread | VERIFIED FIXED — NOT HARDWARE VALIDATED | `runtime.rs` decode thread | — | GUI frame rate on a real display unmeasured | yes (display) |
| H-06 | Hard ±1.5 s window, no time source | PARTIALLY FIXED | documented and measured (`timing.json`) | — | not changed here: a DT-median clock correction would be an own time offset, which the project's invariant (AGENTS.md §4, Time) forbids without a decoded, validated reference; designing one is outside this task | partly |
| H-07 | Compatibility far below WSJT-X | PARTIALLY FIXED | documentation says implemented, not tested with a radio | — | feature gap (no split, rigctld only) not addressed | yes |
| H-08 | MSRV did not build; CM108 absent | VERIFIED FIXED | §F: build, clippy, tests on 1.95.0; CM108 release build; CI msrv job runs clippy | `46e73cf` | release workflow has never run on a tag | no |
| H-09 | Legacy OSD CRC tautological | VERIFIED FIXED | `golden_ldpc.rs`; `false.json` identical (0 false in 2000 slots) | — | — | no |
| H-10 | Watterson normalised per realisation | VERIFIED FIXED | §C; ensemble-power and frame-power-CV test against theory | `b75f773` | — | no |
| M-01 | rigctl console fabricated rig state | VERIFIED FIXED | no console; `--diagnostics` prints only rigctld's replies | — | — | no |
| M-02 | Catalogue "STABLE", runtime date | VERIFIED FIXED | not in binaries (§2) | — | — | no |
| M-03 | Constant confidence 99 | VERIFIED FIXED | no confidence field; not in binaries | — | — | no |
| M-04 | Network traffic at start-up | VERIFIED FIXED | the only socket is the configured rigctld | — | — | no |
| M-05 | Network time sync | VERIFIED FIXED | no network time code | — | — | no |
| M-06 | Busy band non-overlapping | VERIFIED FIXED | `busy.json` identical; random overlapping placement | — | simulation | no |
| M-07 | vNext SNR saturated | VERIFIED FIXED (AWGN simulation) | `snr.json` identical; `snr_accuracy.rs` incl. the new no-signal test; SNR-a…f all killed (SNR-e survived at baseline) | `a37c4f2` (test) | bias on non-ideal signals (N-08), not real audio | yes (real audio) |
| M-08 | CAT/CM108 PTT not released on SIGKILL/power loss | **NOT FIXED** | in-process layers tested (p4, p4b, p4c, p5) | — | power loss is not solvable in software; an out-of-process PTT supervisor for SIGKILL is a design change outside this task; the radio's TX time-out is the defence (documented) | **yes** |
| M-09 | "77-bit exchange" wording | VERIFIED FIXED | withdrawn phrase only | — | — | no |
| M-10 | Scenario tests too weak | VERIFIED FIXED | `sensitivity_regression.rs`; §3 benchmark follows a decoder mutation | — | — | no |
| M-11 | Legacy resampler aliases | VERIFIED FIXED | `resample::tests`; now also in the software loopback at 48 / 44.1 kHz | `672cef9` | not in any published benchmark figure | no |
| M-12 | FWD power displayed the configuration | VERIFIED FIXED | "configuration, not a measurement"; unset power now shown as not set | `a37c4f2` `app.rs` | — | no |
| L-01 | Launcher fallbacks | VERIFIED FIXED | no launcher | — | — | no |
| L-02 | `./dist` override | VERIFIED FIXED | nothing served | — | — | no |
| L-03 | Stale −23.1/−21.7 dB | VERIFIED FIXED | absent (term search) | — | — | no |
| L-04 | CI Python versions vs floor | VERIFIED FIXED | `ci.yml` 3.10–3.13 | — | CI run not observed here | no |
| L-05 | Natural-binary mapping, loss unmeasured | **NOT FIXED** | — | — | measurable in simulation without breaking v1, but it needs a second (Gray) demapper built only for research; not done in this task | no |
| L-06 | −40 dB bandwidth depends on RBW | VERIFIED FIXED | Welch parameters stated; software loopback measures 50.5 / 65.9 Hz after the resampler | — | transmitter/ALC effect unmeasured | yes |
| L-07 | LSB not modelled | PARTIALLY FIXED | the gate refuses a fresh rig reading of any mode but USB/PKTUSB (`safety.rs::l7_…`, TXG-mode killed) | `a37c4f2` `txgate.rs` | without rig control the mode cannot be known and is not checked | yes |


## 5. Findings of the post-remediation audit

| ID | Finding | Status now | Evidence / test | Commit | Remaining |
| :--- | :--- | :--- | :--- | :--- | :--- |
| N-01 | Watterson Doppler 1/√2 of nominal (Rust and oracle) | VERIFIED FIXED (simulation) | §C | `b75f773` | own channel model only |
| N-02 | clippy fails on MSRV 1.95 | VERIFIED FIXED | §F | `46e73cf` | — |
| N-03 | Round-trip layer unprotected; re-encoded frame transmitted | VERIFIED FIXED | §A | `46e73cf`, `a37c4f2` | — |
| N-04 | `--loopback-test` bypasses the gate; VOX not refused | VERIFIED FIXED — NOT HARDWARE VALIDATED | §B | `672cef9` | a VOX radio wired to a PTT-less configuration's sound card cannot be detected |
| N-05 | Default dial logged as "commanded" | VERIFIED FIXED | §E | `a37c4f2` | — |
| N-06 | No test that a missing received report stays missing | VERIFIED FIXED | `qso::tests::the_record_holds_no_report…`; LOG-c killed | `a37c4f2` | — |
| N-07 | Wall-clock test tolerated a 0.5 s offset | VERIFIED FIXED | bracketing test; C03-c and a 10 ms C03-d both killed | `a37c4f2` | — |
| N-08 | SNR: `None` untested; high-SNR bias on non-ideal signals; reports below −22 dB | PARTIALLY FIXED | `no_signal_is_no_estimate…` (SNR-e killed); bias and the report rule documented (docs/receiver.md) | `a37c4f2` | the estimator's bias under phase noise and fading is documented, not corrected; the audit's fading figures for it predate N-01 |
| N-09 | Default `tx_level = 0` keys with silence | VERIFIED FIXED | `TxAudioLevelZero`; `safety.rs::n9_…`; TXG-level killed | `a37c4f2` | — |
| N-10 | wiki 11 "3 × 7" | VERIFIED FIXED | now "7 groups of 3" with positions | docs | — |
| N-11 | "Independent re-implementation (E007)" unverifiable | VERIFIED FIXED | claims restated as golden-vector parity (checked in CI), E007 named as external and not in the repository | docs | — |
| N-12 | No benchmark covers capture/resampler/scheduler | PARTIALLY FIXED | the software loopback runs `RxPipeline` at 48 and 44.1 kHz in a test and from the release binary | `672cef9` | no *published* benchmark figure goes through it |
| N-13 | `utc_now()` falls back to 1970 | VERIFIED FIXED | `wallclock::system_utc` used by every reader | `a37c4f2` | — |
| N-14 | `z30-gui --version` lacks compiler/runtime | VERIFIED FIXED | release check (§2) | `a37c4f2` | — |
| N-15 | `cargo build --workspace` needs Python | NOT FIXED | documented | — | development build only (`z30-py`); production builds need none (§2) |
| — | AWGN −22.94 vs −23.03 dB | investigated | §D | — | — |


## 6. What remains, and why

- **H-02 — hardware validation: NOT FIXED.** It needs a sound card and loopback cable (A1–A4),
  an HF transceiver with rigctld, each PTT interface, a dummy load, a power/SWR meter and a
  second receiver (R1–R6, kill tests, emission check), and for on-air work two licensed stations
  with disciplined clocks. None was available. Everything in this audit is software and
  simulation.
- **M-08 — PTT after SIGKILL or power loss: NOT FIXED.** Power loss cannot be handled by the
  computer. SIGKILL could be partly covered by a separate supervisor process that releases CAT
  or CM108 PTT when the application dies; that is a new component with its own failure modes,
  not a correction, and was not started here. The radio's own TX time-out timer remains the
  defence, as documented in docs/safety.md and wiki 13.
- **L-05 — Gray-mapping loss: NOT FIXED.** Measuring it needs a research-only alternative
  demapper run paired with the production one; v1 itself cannot change. Not attempted.
- **H-06 — PARTIALLY FIXED.** Unchanged. A correction derived from decoded DTs would be an
  offset applied by z-30 itself, which the project deliberately forbids without a validated
  reference; a designed, labelled mechanism is future work, not a defect fix.
- **H-07 — PARTIALLY FIXED.** A feature gap (split, direct rig drivers, interoperability tests),
  not a defect.
- **L-07 — PARTIALLY FIXED.** With rig control a non-USB mode is refused; without it the mode is
  unknowable to software.
- **N-04 — NOT HARDWARE VALIDATED.** See §B for the one case software cannot see.
- **N-08 — PARTIALLY FIXED.** The no-estimate case is tested; the estimate's high-SNR bias on
  non-exact replicas is documented with the audit's measurements, not corrected (it would need a
  new estimator and a new validation; M-07's rule is not to change the estimator without one).
- **N-12 — PARTIALLY FIXED.** The capture-side chain is exercised by the software loopback and
  its test; no published sensitivity figure passes through it.
- **N-15 — NOT FIXED** (development only).
- **Found in this audit, not fixed:** `suite.rs` records `logical_cpus: 0` when the platform
  cannot report its CPU count (`available_parallelism().unwrap_or(0)`); it recorded 4 here. A
  harness provenance field, not a measurement; left unchanged so that `672cef9` stays the code
  commit every result names. The research scripts' 10 ruff findings (not a CI gate) were left
  as found.

## 7. Repository-wide search for fabricated or unsupported values

`evidence/scripts/term_search.py` lists every production-code occurrence (test modules
excluded) of W1AW, FN31, −16, 14.076, N0CALL, NOCAL, fake, simulat*, synthetic, mock, dummy,
placeholder, hardcod*, confidence, accuracy, sensitivity, expected, golden, `unwrap_or(0`,
`unwrap_or_default`, Doppler, SNR and benchmark (`evidence/final/term_search.tsv`, 229
lines). Classification:

| Occurrence (production code) | Where | Classification |
| :--- | :--- | :--- |
| `FN31` … (63 squares) | `z30-protocol/src/codec.rs` `GRID_TABLE` | protocol-defined (SPEC §6.2) |
| `NOCAL`, `N0CALL` | `z30-protocol` `PLACEHOLDER_CALLSIGN`, `txgate.rs`, `migrate.rs` `PLACEHOLDERS` | placeholder **detectors**: the gate refuses, migration skips |
| `FN31`, `-16`, `-15`, `14_076_000` and the 13 legacy band dials | `z30-io/src/migrate.rs` `LEGACY_*` | legacy-default **detectors**: used only to drop those values from entries the legacy writers produced (§E), each drop reported |
| `CQ Q0TST FN31` | `z30-cli/src/loopback.rs` `TEST_MESSAGE` (and its mention in `audio_loopback.rs`) | explicit synthetic test signal; Q0 is not an issued prefix; never logged or shown as a decode |
| `CQ K1ABC FN31` | `main.rs` help text, a `compile_fail` doctest | documentation / test |
| `-16` | `suite.rs` benchmark SNR grids; `math.rs` `…E-16` | benchmark configuration; mathematical constants |
| `14_076_000` | `z30-gui/src/app.rs` (dial "set" checkbox) | UI prefill shown when the operator ticks "set"; it becomes `Configured` by that action and is never logged as anything stronger |
| `unwrap_or(0.0)` | `logbook.rs` / `app.rs` FREQ with no audio offset | the dial alone; ADIF provenance says `dial_only` |
| `unwrap_or(0.0)` | `audio.rs` output ring underflow | silence is the correct output when no transmit audio is queued |
| `unwrap_or(0.95 nyq)` | `resample.rs` | design parameter (passband default) |
| `unwrap_or(0.0)` | `app.rs` power "set" checkbox | UI prefill; configuration by the operator's action |
| `unwrap_or(0)` | `suite.rs` `logical_cpus` | **potential fabricated provenance value** (0 if the platform cannot say); recorded 4 on this host; listed in §6 |
| `unwrap_or_default()` | `logbook.rs` provenance column | a value with no stored source is read as `legacy_import`, the weakest source |
| `unwrap_or_default()` | `qso.rs` partner call | an empty call, which `QsoRecord::validate` refuses |
| `unwrap_or_default()` | device/port lists, AP ladder, GUI class list, migration entry list, `z30-py` | empty lists when there is nothing; not presented as measurements |
| "confidence" | `main.rs` capture JSON comment | states that no per-decode confidence is reported |
| "fake", "simulat*", "synthetic", "golden", "expected", "accuracy", "sensitivity" | module docs, error texts, benchmark titles, migration's "skipped: synthetic/self-test state" | documentation / labelled simulation |
| Doppler, SNR, benchmark | channel model, receiver, suite | reviewed: the Doppler definition is the corrected one everywhere (§C); SNR is `Option` end to end |


Documents: README, SPEC, AGENTS.md, docs/ and wiki/ were searched for the withdrawn fading
figures, "sigma = spread/2", "3 × 7", "E007", "independent re-implementation", `--loopback-test`
and "commanded"/"rig_verified"; every hit was corrected or now says the figure is withdrawn.

## 8. Hardware validation

**NOT HARDWARE VALIDATED**, all of it. No radio, sound card, audio interface, PTT interface, RF
path, GPS/PPS or on-air recording was used. `hardware-validation/results/` is still empty. The
equipment and procedure needed are unchanged from the post-remediation audit's §22 and
`docs/hardware-validation.md` (A1 is now `--audio-loopback-test`). The distinction kept in every
document: software tests and simulation (this work); reference-model validation (golden-vector
parity with the frozen oracle); hardware validation (none); on-air validation (none).

## 9. Reproducing

```bash
git checkout 672cef9b3cdb
cargo build --release --locked -p z30-cli && ./target/release/z30 --benchmark suite   # ~55 min on 4 cores
git checkout 18fbd78 && cargo build --release --locked -p z30-cli
./target/release/z30 --benchmark awgn --out research/results/18fbd78d8fb8          # replicate 0 = published
for r in $(seq 1 10); do ./target/release/z30 --benchmark awgn --replicate $r --out research/results/18fbd78d8fb8/awgn_replicates/replicate-$r; done
python3 audit/2026-09-24-corrective-remediation/evidence/awgn_investigation/analyse_awgn.py . 672cef9b3cdb 18fbd78d8fb8
W=<worktree at 672cef9> CARGO_TARGET_DIR=<dir> MUT_OUT=out.json python3 audit/2026-09-24-corrective-remediation/evidence/scripts/mutate_corrective.py
bash audit/2026-09-24-corrective-remediation/evidence/scripts/release_artifact_checks.sh <release dir> . out.log
(cd legacy/python-oracle && python3 ../../audit/2026-09-24-post-remediation/evidence/scripts/py_watterson.py out.json)
```
