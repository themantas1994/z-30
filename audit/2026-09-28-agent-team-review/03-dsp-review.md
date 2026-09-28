# RF/DSP review — the whole project at `caf1a9a`

> Produced by the `rf-dsp-reviewer` agent (`.claude/agents/rf-dsp-reviewer.md`), 2026-09-28.
> Evidence for the board, not a board decision. Read-only on the checkout; experiments ran in an
> out-of-tree scratch crate that calls only public production APIs.

| | |
| :--- | :--- |
| Code reviewed | `caf1a9a` (branch `claude/fervent-cray-riehln` = `main`). The working checkout had moved to `4cbf074`, which adds only `audit/` markdown; `git diff --stat caf1a9a HEAD -- crates` is empty |
| Scope | `z30-dsp` (slot, baseband, sync, demod incl. SNR/DT, ldpc, ap, sic, resample, math); `z30-protocol` (gfsk, symbols, ldpc, crc constants); `z30-channel`; `z30-cli` `suite.rs` / `bench.rs`; the published figures in README, `docs/`, `wiki/` and `research/results/`; open items from `audit/2026-09-24-post-remediation/FINAL_AUDIT.md` and the corrective remediation audit |
| Toolchain | rustc 1.95.0 (59807616e 2026-04-14), cargo 1.95.0. `./target/release/z30 --version`: commit caf1a9a1959a, release, rustc 1.95.0 |
| Repository tests run | `cargo +1.95 test --release -p z30-dsp --test golden_ldpc --test golden_demod`: 9 passed, 1 ignored (`screen_osd_pool`). `cargo +1.95 test --release -p z30-channel`: 6 passed, 1 ignored (the exploratory scatter test), including both Doppler-spread tests and the ensemble-power test |
| Own experiments | An out-of-tree scratch crate with path dependencies on the repo crates. It calls only public production APIs (`decode_slot`, `sic::subtract`, `FrameSpectra`, `fine_sync`, `Decoder`, `decode_with_ap`, `z30_channel::synthesize`). Sources and outputs stayed in the session scratchpad (`dsp/`); the repository was not modified and nothing was written to `research/results/` |
| Status of every run of its own | **Exploratory**: fewer than 200 frames per point, on a heavily loaded shared 4-CPU host (load average 13–16). None is a published figure |
| Hardware | **None.** Everything here is software simulation |

**Verdict: SOUND WITH STATED LIMITS.**

- The receive path is single and blind. Nothing in `z30-dsp` can see ground truth, and every published figure traces to `research/results/672cef9b3cdb/` with its conditions stated.
- The SNR definition is implemented correctly in both the channel model and the estimator.
- Watterson ensemble normalisation and the N-01 Doppler semantics are correct.
- The limits that need stating or measuring are:
  - the SNR estimator on the corrected fading channels (DSP-01);
  - how the FT8 comparison is framed physically (DSP-02);
  - the unmeasured production AP path, and an AP fading figure taken from withdrawn channel models (DSP-03);
  - several smaller unverified claims (DSP-04 to DSP-09).

**Cross-references to finished reviews**, confirmed and not repeated:

- **DOC-04:** `docs/demodulation.md` §SNR describes the retired estimator and a −40 dB floor; the code at `demod.rs:167–204` returns `None`.
- **DOC-19:** the `suppression_db` overstatement range. DSP-10 adds the mechanism.
- **DOC-14:** SPEC omits the OSD `min_syndrome ≤ 14` condition (`ldpc.rs:431`).
- **RES-01, RES-08, RES-09:** not re-examined.

---

## Findings

### DSP-01 [Medium] The SNR estimate reads low under the *corrected* Watterson channels, at lower SNRs than documented
- **Where:** `crates/z30-dsp/src/demod.rs:167-204` (`FrameSpectra::snr_db`); `docs/receiver.md` "What validated covers" (quotes the post-remediation audit's figures, measured before the N-01 Doppler fix).
- **Evidence (EXPLORATORY,** 30 frames per cell, blind placement, `decode_slot`, `RxConfig::default()`). Error = reported minus the frame's *realised* SNR (its own faded power over the 24 s frame, 2500 Hz reference):

  | Channel | −10 dB | 0 dB | +10 dB | +20 dB |
  | :--- | ---: | ---: | ---: | ---: |
  | AWGN control | | | −0.06 (sd 0.12) | −0.06 (sd 0.10) — agrees with `snr.json` |
  | good (0.1 Hz) | | | −0.04 (sd 0.13) | −0.30 (sd 0.16) |
  | moderate (0.5 Hz) | | −0.19 | −0.55 (sd 0.18) | −2.87 (sd 0.32, worst −3.64) |
  | poor (1 Hz) | −0.39 | −0.52 | −1.71 (sd 0.26, worst −2.50) | −6.34 (sd 0.68, worst −8.27) |

  `docs/receiver.md` says "below about +10 dB it stayed within 0.5 dB" and "poor 4.4 dB low at +20 dB". On the corrected channel, poor reads 1.7 dB low at +10 dB and 6.3 dB low at +20 dB, and moderate reads 2.9 dB low at +20 dB.
- **Why:** The bias grows in proportion to signal power, roughly 10 log10(1 + ε·S/N) with ε·S/N ≈ 3.3 at +20 dB and ≈ 0.35 at +10 dB on poor: a signal-proportional residual in the noise estimate, not a noise-limited error. The per-symbol least-squares gain fits one complex gain per 320 ms symbol. On poor the coherence time 1/(2πσ_D) is about 0.32 s, one symbol, so the unmodelled within-symbol modulation of the GFSK sidelobes stays in the residual's noise bins. At a per-bin SNR of about 49 dB (+20 dB in 2500 Hz), a residual 50 dB down is as large as the noise. Operationally, a station on a fast-fading path at +10 dB is sent a report about 2 dB low. The validated range (−22…+30 dB) holds only for an exact-replica AWGN signal, as the docs already say, but the documented magnitude is stale and too optimistic.
- **Fix:** Re-measure through `z30 --benchmark` with fading presets: add an `snr_fading` benchmark (≥ 100 frames per cell, realised SNR as the reference) and replace the pre-N-01 numbers in `docs/receiver.md`. Optionally flag the estimate as a lower bound when the fitted residual energy in the fit bins exceeds its noise expectation (a mismatch detector), which would need its own validation, per M-07.

### DSP-02 [Medium] Capacity cross-check: the AWGN figure is physically plausible; the FT8 comparison measures receivers and conditions, not the modulation
- **Where:** `wiki/11` §2 ("Distance from own Shannon limit", "Per message bit it is less energy-efficient"); README "Against FT8".
- **Evidence:** Monte Carlo, 150–200k symbols per point (MI estimate error about ±0.02 dB). Ideal CSI and timing, non-coherent orthogonal M-FSK, the receiver's own ln I₀ metric and Log-MAP demapper. Limits are for the code rate; SNR in 2500 Hz includes the sync-symbol overhead:

  | | CM limit | Single-symbol BICM limit |
  | :--- | ---: | ---: |
  | z-30 (16-FSK, 77 info bits / 54 data symbols, T = 0.32 s) | −25.26 dB | −23.86 dB |
  | FT8 (8-FSK, 91 bits / 58 symbols, T = 0.16 s) | −21.18 dB | −20.33 dB |

  - The GFSK (BT 2) matched-bin energy fraction at exact timing is 0.950, a −0.22 dB loss. 3.75% of symbol energy leaks into the other 15 tone bins, only 0.51% into the adjacent ones. That puts z-30's waveform BICM limit near −23.64 dB.
  - Measured z-30: −23.03 dB, 0.6 dB from its waveform BICM limit and 2.2 dB from its CM limit.
  - FT8's quoted −21 dB is 0.18 dB from FT8's CM limit and 0.67 dB beyond its single-symbol BICM limit.
  - At the CM limits, z-30 needs 4.53 dB Eb/N0 per message bit and FT8 4.95 dB: the modulation favours z-30 by 0.4 dB per bit.
- **Why:**
  - (a) The AWGN crossing's closeness to the BICM limit (0.6 dB) is tight but plausible at 50% frame error for n = 216: at ε = 0.5 the finite-length penalty vanishes. It gives no sign of truth leakage (the code path was checked; see "sound").
  - (b) A blind, AP-less 50% FT8 decode within 0.2 dB of the ideal-CSI CM capacity is at the ML finite-length limit with perfect sync. The published −21 dB is therefore almost certainly not a like-for-like point (AP, criterion, or SNR method). The documented "1.6 dB more Eb/N0 per bit" and "further from its own Shannon limit" describe the two figures' receivers and conditions, not a property of z-30's waveform, which is the more efficient per bit at capacity.
  - (c) Rule for future reviews: the 1.4 dB CM–BICM gap is the only large reserve left on AWGN, reachable only through multi-symbol or iterative demapping (WSJT-X ft8b uses 2- and 3-symbol non-coherent metrics for this reason; the reference measured +1.29 dB for a phase-coherent term at exact timing). A claimed AWGN gain above ~0.6 dB that does not change the demapper architecture should be treated as suspect.
- **Fix:** In `wiki/11`, add the waveform-constrained limits beside the unconstrained Shannon row. State that the FT8 figure sits at FT8's own capacity and so cannot be a like-for-like blind, AP-less 50% point. Reword "less energy-efficient per bit" as a statement about the two quoted figures, not the modes. Keep the "all of it or none" rule.

### DSP-03 [Medium] The production AP path (`decode_with_ap` + corrected OSD) has no test and no false-decode measurement; the AP fading figure comes from withdrawn channel models
- **Where:** `crates/z30-dsp/tests/golden_ldpc.rs:217,227` (the AP "bit-exact" test runs `reference_decode`, i.e. the *legacy* OSD, never `Decoder::decode`); `crates/z30-dsp/src/ldpc.rs:402-404, 445-447` (Trellis corr > 0 and OSD corr > 20 are computed on `input`, which under AP is the pinned LLR vector); `crates/z30-io/src/migrate.rs:238` (migration copies the legacy AP setting into `receiver.ap_enabled`); `wiki/17` "Measured effect" (Watterson moderate 2.93 dB, 2026-09-02).
- **Evidence:**
  - *Structure.* For AP types 4–6 all 63 payload bits are pinned. The corrected OSD's 14 "least reliable" test bits are then exactly the 14 CRC bits, so its 105 flip patterns enumerate CRC values. Under AP the correlation gate is vacuous (63 pinned ±apmag terms dominate it), so only the CRC and the distance ≤ 16 gate remain.
  - *Code weights* (exact, all patterns): of the 105 CRC-bit single/double flips, the minimum difference-codeword weight is 16 and exactly one pattern is at ≤ 16, so the distance gate admits about 1 in 16384. Type 3 (21 free info bits): minimum weight 14, 5 patterns at ≤ 16.
  - *Measured, EXPLORATORY:* 2000 noise-LLR vectors from the production front end (40 noise slots, 50 random placements each, fine sync, whitened LLRs), each AP type tried alone: 0 accepts per type, 95% Clopper–Pearson upper bound 1.8e-3 per attempt. None of these vectors passed the fine-sync gate, so the gated rate is untested here.
  - `false.json` runs with AP off, so no false-decode figure through `decode_slot` exists for AP on.
  - wiki/17's AP measurements (oracle receiver, 2026-09-02) predate both fixes of the oracle's `channel.py`: the H-10 ensemble normalisation (`d8983ee`) and the N-01 Doppler fix (`b75f773`). The "Watterson moderate 2.93 dB" row is therefore from a per-realisation, 1/√2-Doppler channel, and the page does not label it withdrawn, contrary to AGENTS.md §5.
- **Why:** AP is the one place an assumption can become a logged QSO. The analytic cost on wiki/17 (about 5 × 2⁻¹⁴ per candidate) was derived for, and bit-exact-tested against, the oracle's OSD, not the production one. The structural analysis says the production rate should be of the same order, but nothing measures it. Operators migrating a legacy config with AP on get it without opting in on this app.
- **Fix:**
  1. Add a golden test running `Decoder::decode` (production OSD) with AP masks on the AP corpus.
  2. Add a `false` benchmark variant with AP on: SendingReport ladder, empty and non-empty `worked_freqs`, the random-FSK and valid-Costas/random-data contents; ≥ 400 slots per kind.
  3. Consider computing the AP-path correlation gates on the channel LLRs, not the pinned ones.
  4. Mark wiki/17's fading row as from a withdrawn channel model, and re-measure AP through `decode_slot`, paired.
  5. Decide whether migration may enable AP.

### DSP-04 [Low-Medium] The pass-2/3 candidate restriction is documented as "changes the cost without changing the result"; it has never been measured
- **Where:** `crates/z30-dsp/src/slot.rs:262-270`; `docs/receiver.md` "Passes".
- **Evidence:** No test or benchmark compares the restriction on and off (it is not configurable). By mechanism, a subtraction does change a candidate's inputs outside the 60 Hz rule:
  - The per-candidate baseband spans f0 ± 100 Hz. `FrameSpectra`'s noise bins lie at f0 −84…−16 Hz and f0 +62…+84 Hz, so a station subtracted 60–130 Hz away changes the noise and whitening estimate.
  - The spectrogram is re-normalised by its global median.
  - Pass 1 truncates to 50 candidates, so a candidate ranked > 50 and more than 60 Hz from every subtraction is never tried in any pass.

  `busy.json` K = 40 misses 24 of 2000; whether any are due to this is unknown.
- **Why:** The claim is a behavioural guarantee, not a cost note. Its effect is probably small, but unmeasured.
- **Fix:** Either measure it (a branch that makes the restriction switchable, paired on the busy-band audio, exact McNemar), or reword to "reduces cost; its effect on decodes has not been measured".

### DSP-05 [Low] SIC co-location: the documented mechanism is confirmed; the boundary can be stated
- **Where:** `docs/benchmarking.md` and `docs/sic.md` ("Why exact co-location fails … read from the code, not separately measured"); `slot.rs:268` (residue filter, ±1.6 Hz / ±0.1 s); `sync.rs:175` (NMS, 2 bins / 2 hops).
- **Evidence (EXPLORATORY,** 20 trials per cell, weak at −18 dB): the strong station's pass-1 decode was subtracted with the production `sic::subtract`, then the residual was decoded *afresh* (no residue filter). The weak station was still never decoded at Δf = 0 / ΔDT = 0 (ΔP +10: 0/20; ΔP +3: 0/20) or at Δf = 1 Hz (0/20), so the least-squares fit absorbing the shared Costas symbols is the binding cause, as documented. Boundary data: Δf 5 Hz → 20/20 (`decode_slot` and fresh alike); ΔDT 0.08 s → 12/20 both ways.
- **Why:** Every station uses the same Costas tones at the same positions, so co-located frames share all 21 sync symbols. Separately, NMS and the residue filter make any station within about ±1.6 Hz / ±0.1 s of a decoded one unreachable by design.
- **Fix:** State the explicit exclusion rule beside the mechanism. Map the boundary at ≥ 100 trials per cell (Δf 1–5 Hz, ΔDT 0.04–0.2 s) in the `sic` benchmark.

### DSP-06 [Low] The published latency/CPU figures predate the replica fit that every decode now runs
- **Where:** `research/results/perf_k.txt` (commit `83b1b70`); `docs/benchmarking.md` "Performance (gate G2.7)"; `crates/z30-dsp/src/demod.rs:235-266` (`placed_replica`, added in `d8983ee`).
- **Evidence:** `perf_k.txt` was measured at `83b1b70`, before `d8983ee` added `placed_replica` + `snr_db`, which `decode_slot` runs for every decode (`slot.rs:222-228`). Estimate from the code: about 8 `replica_spectra` evaluations of ~1 ms each per decode, i.e. roughly +0.4 s single-threaded at K = 50 (published single-thread p99 2.53 s against the 4.5 s budget). Not measured: the host was too loaded for a meaningful latency run. The suite's own `busy.json` shows K = 40 latency p95 4.27 s and max 17.5 s under 4-way concurrency (labelled indicative only).
- **Why:** The real-time budget claim (K = 50 single-thread inside 4.5 s) describes an earlier receiver.
- **Fix:** Re-run `z30 --benchmark perf --frames 20` on an idle host at the current commit and replace the table.

### DSP-07 [Low] `false.json`'s "8 random 16-FSK signals … 0 dB" are at −3 dB
- **Where:** `crates/z30-cli/src/suite.rs:549, 559-561` (`amp_for(0.0) / √2` applied to a unit-amplitude cosine); `docs/benchmarking.md` "False decodes".
- **Evidence:** `amp_for(s)` gives a cosine of power s · 5000/6000. Dividing by √2 halves that, so the interferers are at −3.0 dB. The FT8-like interferers (same helper, no /√2) are at 0 dB, as labelled.
- **Why:** The stated condition differs from the one run. The effect on a 0-of-400 result is negligible, but the label is wrong.
- **Fix:** Relabel as −3 dB in the next suite run, or remove the /√2; do not edit result files.

### DSP-08 [Low] The impairments are applied at 6 kHz after resampling; the docs do not say so
- **Where:** `suite.rs:493` (the JSON title states it); `docs/benchmarking.md` "Audio impairments".
- **Evidence:** Clipping, 8-bit quantisation and impulses are applied to the 6 kHz noisy slot. A real clipper or ADC acts at the device rate, before the anti-alias resampler, where intermodulation products alias differently.
- **Fix:** Add "applied to the 6 kHz window after resampling, not at the device rate" to the docs.

### DSP-09 [Low] L-05 (Gray vs natural binary) can be closed for AWGN by symmetry; exploratory data shows no effect on fading
- **Where:** SPEC §3 ("loss … has not been measured"); `docs/benchmarking.md` "Not measured".
- **Evidence:** Non-coherent orthogonal 16-FSK is invariant under any permutation of the tone indices, so every labelling has the same BICM capacity and the same bit-LLR distribution. Monte Carlo confirms it: natural and Gray BICM MI agree within MC error at every Es/N0 (e.g. 1.4416 vs 1.4427 bits at 5.2 dB). Any loss can only come from non-orthogonality: GFSK leakage (only 0.5% into adjacent bins), residual frequency error or drift, and Doppler.

  Paired run (EXPLORATORY, 150 frames, genie-coarse: the true f0/DT is handed to the production fine sync; same noise and taps):

  | Condition | natural | Gray | discordant (Gray-only : natural-only) | exact McNemar p |
  | :--- | ---: | ---: | :---: | ---: |
  | AWGN −23 dB | 74 | 88 | 44 : 30 | 0.13 |
  | moderate −21.5 dB | 58 | 52 | 14 : 20 | 0.39 |
  | poor −21 dB | 63 | 73 | 22 : 12 | 0.12 |
  | poor −20 dB | 121 | 120 | 16 : 17 | 1.0 |

  No significant difference. Pairing is weak because the two arms transmit different waveforms. This is a genie-coarse **bound on a labelling delta**, not a threshold.
- **Fix:** Record the symmetry argument in SPEC §3 (the AWGN loss is zero by construction). If the fading question matters, run a ≥ 1000-frame paired sweep on poor/moderate (see research proposal P2). v1 stays unchanged either way.

### DSP-10 [Info] `suppression_db`: the mechanism behind DOC-19's 9–16 dB spread
- **Where:** `crates/z30-dsp/src/sic.rs:240-250`.
- **Evidence:** "after" is the same block-interpolated least-squares projector applied to its own residual. For an idempotent projector P, P(I − P)x = 0, so "after" measures only the projector's non-idempotence (20-sample blocks, linear gain interpolation). It is neither noise nor model error, which is why the overstatement is not a constant. Physical suppression behaves as noise-limited: about SNR + 25–27 dB for the 0.4 s triangular gain window, consistent with the test's 26–39 dB at +10 dB and the post-remediation audit's 18.6–19.5 dB at −8 dB.
- **Fix:** None required: it is already labelled internal. When quoting physical suppression, use the SNR + ~26 dB rule with its source; do not quote a single "overstates by X dB".

### DSP-11 [Low] Out-of-range SNR is transmitted as a number although it is displayed as a bound
- **Where:** `crates/z30-engine/src/qso.rs:228-230` (`report_for` rounds and clamps to ±30); `api.rs:194-202` (display "<-22" / ">+30").
- **Evidence:** Below −22 dB the rounded estimate is sent (documented in `docs/receiver.md`). Above +30 dB the clamp sends "+30", a bound encoded as a value. Under DSP-01 conditions, a +20 dB fast-fading station is sent about +14.
- **Fix:** State in the docs that reports are the estimator's value, biased low on fast fading, and that a clamped +30 means "≥ +30". Consider not sending an unvalidated report.

### DSP-12 [Info] `docs/receiver.md` cites the wrong test for thread-count determinism
- **Where:** `docs/receiver.md` "Determinism".
- **Evidence:** `channel_scenarios::decode_slot_is_deterministic` decodes twice on the same pool. The thread-count invariance is `sic_regression::a_busy_band_decodes_identically_on_one_thread_and_on_many` (1 thread vs the default pool, K = 20, comparing info, pass, iterations, DT, frequency and SNR bit for bit). (See also CTO-16: on a 1-CPU runner that test is vacuous.)
- **Fix:** Cite the latter.

### DSP-13 [Info] Code and channel details worth recording
- The (216, 77) code has codewords of weight 14 with at most 2 information bits set, so its minimum distance is at most 14. The OSD gate (≤ 16 bits from the BP decision) and the Trellis gate (≤ 12) sit near it. No effect is visible at the published operating points; relevant only to any future high-SNR error-floor claim.
- `z30_channel::synthesize` applies the clock stretch from the window's first sample (slot − 1.5 s), not from the slot boundary as the comment says. That shifts DT by up to 15 ms at 1e4 ppm; negligible.

---

## Checked and found sound

- **One receive path, no knowledge of the answer.**
  - Every receive call site calls `Receiver::decode_slot`: suite, bench, CLI `--decode`, both loopbacks, the engine runtime, and z30-py.
  - `z30-py`'s `ldpc_decode` is an LLR-only research helper, not a demodulator.
  - `z30-dsp/src` has no `cfg` other than `parallel`, no `env::`, and no path to truth.
  - The suite compares payloads only after decoding. The placement ranges (210–2740 Hz, ±1.4 s) sit inside the receiver's own operating range.
  - `RECEIVER_PILOT_COHERENCE = 0` lives in `demod.rs`.
- **SNR definition (SPEC §10).**
  - `z30_channel::synthesize` scales the signal so that P / (σ² · 5000/6000) equals the requested SNR, with σ = 1 (unit analytic amplitude, `unit_frame_power` including the ramps). CW uses a²/2 = SNR · 5000/6000. The `snr_is_calibrated` test passes.
  - The estimator's normalisation is also correct: S/n_bin is the SNR in one 3.125 Hz bin (unnormalised 64-point FFT at 200 Hz), rescaled by 10·log10(2500/3.125). The least-squares projection bias `n_bin·den_all/den_fit` is correct. The noise is taken from the residual's off-signal bins, so it is not the M-07 estimator.
  - The AWGN control reproduces `snr.json` (−0.06 dB at +10 and +20 dB).
- **Watterson model.**
  - Two independent equal-power paths, amplitude response exp(−f²/(4σ_D²)) with σ_D = `doppler_hz`/2.
  - Normalised by the ensemble constant √(n·Σ|H|²), not per realisation.
  - The circular tap generation gives a frame-power CV equal to the linear-process value to leading order (≈ 0.485 for good).
  - The spectral and ensemble tests pass at 1.95; `fading.json`'s text and `doppler_definition` match the code.
- **Modulator.** Continuous phase (cumulative phase), constant envelope between the ramps, one 20 ms raised cosine at each end (SPEC §1.3 indexing checked). The Costas positions and tones, the natural-binary map, the CRC and the LDPC constants are unchanged; the golden tests pass.
- **Synchronisation.**
  - The coarse DT span is −1.5 to +1.46 s; fine sync's ±40 ms reaches +1.5 s, consistent with `timing.json`.
  - The fine grid covers one coarse bin (±0.8 Hz) and one hop (±40 ms).
  - The fine-sync gate is correctly normalised (2σ²·21).
  - The whitening threshold of 2× is about 6 sd of a 75-sample exponential median. This matches the claim, and the whitening A/B showed 0 discordant.
- **LDPC and OSD.** The BP cascade is bit-exact against the oracle corpus. The corrected OSD requires a CRC match on the candidate's own field. An empty AP mask decodes bit-identically. AP never runs first (`decode_with_ap` returns the plain decode untouched when it succeeds), the CRC bits are never pinned, `hypothesis_holds` is re-checked, and results are labelled `a1`–`a6`.
- **SIC.**
  - The replica is the one modulator.
  - The least-squares gain uses the WSJT-X `subtractft8` construction; the 2f₀ term is about 48 dB down after the triangular window at f₀ ≥ 200 Hz.
  - Timing is found by descent.
  - Physical suppression is consistent with the noise-limited expectation (DSP-10).
  - `suppression_db` is excluded from `sic.json` and labelled internal.
- **Determinism.** Per-frame seeds are a bijection over (benchmark, point, frame); replicates use bits 48–63. Decoding is order-preserving under rayon `collect`. The dither is derived from the LLRs.
- **Published figures trace to their files.** README, AGENTS §5, docs/benchmarking.md, wiki/11, wiki/16 and wiki/Home match `672cef9b3cdb/awgn.json` (−23.035 dB [−23.126, −22.889]; 90% at −22.061 dB) and `fading.json` (−20.94 / −21.37 / −20.88 dB; none on high-latitude moderate). Provenance is a clean tree, release profile, suite seed 20260830, 200 frames per point, not exploratory. No genie-aided figure is presented as a threshold; the oracle's −24.58 dB genie figure appears only as history.
- **The crossing interval** interpolates Wilson bounds, which is an approximate inverse band. Its width of about 0.24 dB is consistent with the measured replicate sd of 0.048 dB, i.e. slightly conservative.
- **Fading physics is plausible.**
  - good: a whole frame in one Rayleigh fade gives a median loss near 1.6 dB; measured about 2.1 dB.
  - poor: coherence ≈ one symbol, so the within-symbol decorrelation loss is about 0.34 dB, plus a frame-constant pilot amplitude used under per-symbol fading — a candidate explanation for wiki/11's unexplained "poor costs most".
  - high-latitude moderate: the 10 Hz spread is wider than the 3.125 Hz tone spacing, so no decode.
- **Resampler.** Pass band 2850 Hz and stop band 3150 Hz: everything that folds lands above 2850 Hz, beyond the 2800 Hz search band. Kaiser 80 dB.

## Not checked

- **Latency and CPU at the current commit** (DSP-06): the host was too loaded to measure.
- **Mutation testing** of the DSP invariants (covered by the corrective audit §G).
- **Benchmarks not re-run here:** the full suite, `busy`, `sic`, `drift`, `clock`, `impair`. Only the small exploratory runs above were made.
- **Oracle / Python tests and `test_watterson_doppler.py`.**
- **Channel models:** Watterson against an independent simulator; CW and busy-band placement beyond reading the code.
- **Receiver paths:** the capture → resampler → scheduler chain inside published figures (N-12); the multi-threaded rayon pool on other ISAs (RES-09).
- **AP:** the gated false-accept rate through `decode_slot` (DSP-03 measured only ungated noise LLRs).
- **Anything on real audio or hardware.** There is none.
