# RF/DSP review (docs/research-process.md §3): PR #46, `claude/nice-archimedes-epwg4o`

**Commit reviewed:** `7f649071dbfd1099b04683a9ce1b8bb283e66e74`, compared with base `78db463`. The working tree was clean before and after the review. Nothing under `/home/user/z-30` was edited.

**Verdict: SOUND WITH STATED LIMITS.** The PR changes no receiver, modulator or channel algorithm. The new tests and doc corrections are mostly accurate. Five residual problems remain, listed below. Two of them hold back F-26 and F-33, and one leaves the doc half of F-41 incomplete.

## What I ran

All builds used `CARGO_TARGET_DIR=/tmp/claude-0/review-dsp-target` and toolchain `+1.95` with `--locked`. I ran no benchmark.

1. `git diff 78db463..HEAD --stat` and the full diff over `crates/z30-dsp/src`, `crates/z30-protocol/src` and `crates/z30-channel/src`.
2. `cargo +1.95 test --release --locked -p z30-dsp --test ap_production --test sic_regression -- --nocapture`
   - Result: 3/3 and 4/3+1 = 4/4 passed.
   - `ap_production` printed: "16 frames at -25..-22.75 dB: 1 plain, 10 with AP (9 by AP)".
   - `sic_regression` printed: "K = 8: 80/80 with SIC, 77/80 without".
3. `cargo +1.95 test --release --locked -p z30-engine --test gate_contract f49`: passed.
4. An exploratory probe, run outside the repo (`git archive HEAD` copied into my scratchpad, plus one extra test file).
   - It decoded the same 40 noise slots as `f26_ap_does_not_manufacture_decodes_from_noise` (seeds 900–939) and summed `PassStats::ldpc_attempts`.
   - AP off: 12 attempts.
   - AP gated at 1500 Hz (the test's config): 20 attempts. AP tried hypotheses in only **1 of 40 slots** (8 hypothesis trials).
   - AP ungated (`worked_freqs_hz = []`): 60 attempts in 7 slots.
   - No decodes in any arm.
   - Exploratory; 40 slots; not a rate.

## Check 1: source diff

The diff in those three crates touches 2 files, 4 insertions and 2 deletions:
- `crates/z30-channel/src/lib.rs:2` adds `#![forbid(unsafe_code)]`.
- `crates/z30-protocol/src/gfsk.rs:142-144` rewords the doc comment on `synthesize` from "bit-for-bit" to "within 1e-6, not bit-identical".
- `crates/z30-dsp/src` is unchanged.

**The claim holds.** No protocol constant, waveform, receiver or channel model changed, so checks 2–8 of my brief (no knowledge of the answer, the SNR definition, the channel models, waveform integrity and the rest) are not affected by this PR.

## Findings

### [Medium] F-41: docs/receiver.md still asserts the mechanism DSP-04 refuted
- **Where:** `docs/receiver.md:63-65`. The same claim sits in a code comment at `crates/z30-dsp/src/slot.rs:252-254`, which this PR leaves alone, as intended.
- **Evidence:** The heading now says the restriction's effect "has not been measured", which is correct. The first bullet still says: "Everywhere else the residual is unchanged, and a deterministic decoder would fail there exactly as it did before". DSP-04 named three reasons this is false:
  - `FrameSpectra` takes its noise bins from f0 −84…−16 Hz, so a subtraction 60–130 Hz away changes the noise and whitening estimate.
  - The spectrogram is renormalised by its global median (`sync.rs:128-132`).
  - Pass 1 truncates to `max_candidates = 50` (`slot.rs:57, 270`). A candidate ranked below 50 and more than 60 Hz from any subtraction was never tried at all, so it cannot "fail exactly as before".
- **Why it matters:** The page now contradicts itself, saying "not measured" and "would fail exactly as before" in consecutive lines. The second statement is a behavioural guarantee with no measurement behind it.
- **Fix:** Rewrite the bullet as a cost heuristic, e.g. "the residual changes most near a subtraction". Name the three exceptions or cite DSP-04. Leave the code comment for the measurement work. F-41 stays OPEN.

### [Medium] F-26: AP's "never changes or loses a decode" is tested end to end for one station only; SIC can break it across passes
- **Where:** `crates/z30-dsp/tests/ap_production.rs:51-81`; `crates/z30-dsp/src/slot.rs:262-270, 282`.
- **Evidence:**
  - Within a pass, AP cannot touch another candidate's decode: `decode_with_ap` returns the plain result first (`ap.rs:189-206`), candidates are independent, and deduplication is by `info`.
  - Across passes it can. An AP-only decode in pass 1 is subtracted, which changes the residual and widens the pass-2/3 region set (the 60 Hz rule). The extra candidates near it can push another station's candidate past the 50-candidate truncation.
  - So in a busy band, AP-on can lose, or move to a different pass, a decode that AP-off made in pass 2 or 3. The test uses one station per slot and so cannot see this.
  - In my run, the "never change or lose" assertion was exercised by **one** plain decode in 16 frames.
- **Why it matters:** The AGENTS.md §4 invariant is guaranteed per candidate, by construction. It is not guaranteed by construction for `decode_slot` with SIC. That is pre-existing, not introduced here, but F-26 is being closed on this test.
- **Fix:** Add a paired multi-station test, e.g. the `random_band` fixture from `sic_regression.rs` with one station sending the QSO frame. Either assert superset-ness there or state the limit in `ap.rs` and wiki/17. Separately, raise the plain-decode count, e.g. by adding frames at −22 dB.

### [Low] F-26: the noise test is almost vacuous, and its comment overclaims
- **Where:** `crates/z30-dsp/tests/ap_production.rs:99-115`.
- **Evidence:** In my probe, AP was attempted in 1 of 40 slots (8 hypothesis trials). Even with the frequency gate removed it reaches only 48 trials, and a stuck-open gate would still be expected to give 0 decodes. The comment says it is "a guard against a gate that stops narrowing"; it cannot detect that. It does catch a gross defect, such as accepting a hypothesis without the CRC.
- **Fix:**
  - Assert that the AP-on config makes more `ldpc_attempts` than AP off, which proves AP ran.
  - Assert that a gated config makes fewer than an ungated one, which proves the gate narrows. This is cheap and needs no rate.
  - Separately, in `f26_wrong_ap_assumptions_cannot_produce_the_assumed_call` (`:83-97`), assert that at least one decode occurred. As written it passes if nothing decodes.

### [Low] F-33: wiki/17 still uses a withdrawn channel model's result as evidence
- **Where:** `wiki/17-A-Priori-(AP)-Decoding.md:278-282`.
- **Evidence:** The row is now correctly labelled "withdrawn channel model", but the paragraph ends: "treat 2.93 dB as evidence that the effect survives fading, not as a figure of merit".
  - That figure came from the per-realisation, 1/√2-Doppler model.
  - Both of that model's errors make fading milder: no slow power variation (H-10) and 0.71× the Doppler spread (N-01).
  - "Survives fading" is exactly what such a model overstates. AGENTS.md §5 says these results are withdrawn, not downgraded.
- **Fix:** Delete the clause, or replace it with "no AP figure exists on the corrected fading model".

### [Low] F-52: a guessed mechanism is stated as fact
- **Where:** `docs/benchmarking.md`, Collisions, the parenthetical "(hop quantisation sometimes places it outside the NMS neighbourhood)".
- **Evidence:** DSP-05 reports 12/20 at ΔDT 0.08 s, both through `decode_slot` and when decoding afresh; it gives no mechanism. 0.08 s is exactly 2 hops (HOP = 240 samples = 40 ms, `sync.rs:28`). In pass 2/3 the strong station's peak has been subtracted, so the residue window (±0.1 s around the fitted DT, `slot.rs:268`) is the likelier gate, not NMS.
- **Fix:** Drop the parenthetical or mark it as unverified. Everything else in the F-52 text matches the code:
  - The residue filter is ±1.6 Hz / ±0.1 s, passes 2–3 only.
  - NMS covers ±2 bins of 0.78125 Hz = 1.56 Hz and ±2 hops = 80 ms (`sync.rs:169-177`).
  - The sic cells are df 0/5/20/50 Hz and dDT 0/0.4 s (`suite.rs:973-975`).

### [Info] Points checked and found accurate
- **F-55 (SPEC §3):** The symmetry argument is exact.
  - Any 4-bit labelling is a tone permutation of any other. Non-coherent orthogonal FSK on AWGN is invariant under tone permutation.
  - So the joint bit-LLR distribution, not only the per-bit capacity, is labelling-independent.
  - The GFSK leakage caveat (0.51% adjacent, DSP-02) and DSP-09's genie-coarse status are both stated. Nothing is sold as a threshold.
  - Minor: the `docs/benchmarking.md` "Not measured" heading says "on fading channels", while its body (correctly) adds that AWGN with GFSK has only the exploratory run.
- **F-36 / F-53 (`suite.rs:846-965, 901-917`):** I hand-checked the arithmetic and it is right.
  - `amp_for(0)/√2` on a unit cosine gives −3.01 dB.
  - The FT8-like interferers (no /√2) are at 0 dB.
  - The Clopper–Pearson bounds are 7.46e-3 for 400 slots and 1.497e-3 for 2000.
  - (1−5e-4)^2000 = 0.368.
  - The zero-event slot counts are 29 956 (to bound 1e-4) and 299 572 (to bound 1e-5).
  - 1.497e-3 × 2880 = 4.3 per day.
  - Result files are untouched.
- **F-49:**
  - Tune is `Modulator::synthesize(&[0; 75], tx_audio + 7.5 × 3.125 Hz)` (`runtime.rs:275-285`).
  - Because the symbols are constant, the GFSK frequency pulse sums to a constant (`gfsk.rs:96-113`), giving an unmodulated carrier at the span centre. It has the frame's 20 ms raised-cosine ramps and lies inside the span the gate checks.
  - `safe_level` maps NaN to 0 and clamps to 0…1. It is used by `frame_audio` (`:262`) and by Tune (`:278`).
  - Validation headroom at 6 kHz: 2800 + 23.4 + 46.9 + 10 < 3000 Hz.
- **F-76:** The test would fail on a thread-dependent result, for three reasons:
  - Rayon `par_iter` inside `install` runs on that pool.
  - `map_init(Decoder::new)` gives one `Decoder` per split on 8 threads but one for all candidates on 1 thread, so any state carried between decodes would change `iterations` or `info`.
  - Splitting depends on the pool's thread count, not the number of CPUs, so the test is not vacuous on a one-CPU runner. The 8-thread assertion is present.
- **F-24:** `docs/receiver.md:115-125` transcribes DSP-01 correctly:
  - poor: −1.71 (sd 0.26) at +10 dB, −6.34 (sd 0.68) at +20 dB, −0.52 at 0 dB;
  - moderate: −2.87 (sd 0.32) at +20 dB.
  - It is labelled exploratory, 30 frames per cell, with no committed record.
  - The mechanism (residual left by the 320 ms per-symbol fit, with coherence of about 0.32 s on poor) is consistent with a per-bin SNR of about 49 dB at +20 dB.
- **F-56:** `qso::report_for` (`qso.rs:228-230`) clamps to ±30. The meaning of a sent +30 or −30 is stated in `docs/receiver.md:128-131`, `docs/safety.md:308-312`, wiki/13 and wiki/14. The ledger cites "wiki/06/13", but wiki/06 has no such text; the correct citation is wiki/13 and wiki/14.

## Verdict per ledger row

| Row | Verdict | Evidence |
| :--- | :--- | :--- |
| F-24 | NOT VERIFIED (stays OPEN) | The doc half is accurate (`docs/receiver.md:110-125`, matches DSP-01 table and labels). No `snr_fading` benchmark exists, so the row cannot close. |
| F-26 | NOT VERIFIED | `ap_production.rs` does run AP through `decode_slot`; it passed, and 9 frames were recovered only by AP, so AP is running. The remaining gaps: (a) the row title's AP-on false-decode figure is absent, since `suite.rs` `false_decodes` uses `RxConfig::default()` only (DSP-03 fix 2); (b) the noise test exercised 8 AP trials in 40 slots (my probe); (c) the wrong-assumption test can pass vacuously; (d) the single-station test cannot see a cross-pass SIC loss. Suggest splitting the row: tests (fix b–d) and a new AP-on `false` benchmark row. |
| F-33 | NOT VERIFIED | The labels are correct: oracle receiver, exploratory, 60–80 frames, no result file, withdrawn row. But `wiki/17:281-282` still treats the withdrawn 2.93 dB as "evidence that the effect survives fading". One clause to delete. |
| F-36 | VERIFIED | `suite.rs:901-917, 952-965`. The power note and bounds are arithmetically correct. The test `a_zero_false_decode_count_reports_its_bound...` (`suite.rs:1368-1376`). `docs/benchmarking.md` False decodes section matches. |
| F-41 | NOT VERIFIED (stays OPEN) | The heading is corrected, but `docs/receiver.md:63-65` still asserts "fails exactly as before", contrary to DSP-04. The measurement is still absent. |
| F-49 | VERIFIED | `runtime.rs:251-257, 262, 275-285`. `gate_contract::f49_*` passed (run here). The `safe_level` unit test covers NaN, infinity and out-of-range values. |
| F-52 | VERIFIED (Low follow-up) | The exclusion rule matches `slot.rs:268` and `sync.rs:169-177`. DSP-05 data is labelled exploratory and the unmapped boundary is stated. The NMS parenthetical should be dropped (finding above). |
| F-53 | VERIFIED | `suite.rs:850-853, 923, 964`. −3.01 dB confirmed by hand and by `the_false_decode_labels_state_the_levels_that_were_run` (`suite.rs:1350-1366`). Signal and seeds unchanged. |
| F-54 | VERIFIED | The `docs/benchmarking.md` impairments paragraph matches `suite.rs:705-777` (post-noise, 6 kHz; the JSON title says so too). |
| F-55 | VERIFIED | SPEC §3 is exact for ideal orthogonal FSK, with the GFSK, drift and Doppler limits stated. DSP-09 is labelled genie-coarse and exploratory. No protocol change. |
| F-56 | VERIFIED (as DOCUMENTED_LIMITATION) | `qso.rs:228-230`; `docs/receiver.md:128-131`; `docs/safety.md:308-312`. Correct the ledger citation from wiki/06 to wiki/13 and wiki/14. |
| F-57 | VERIFIED | 9–16 dB (E047 9–12; `FINAL_AUDIT.md:234` H-01 11–16) appears consistently in `docs/sic.md:33-43`, `docs/benchmarking.md`, wiki/05:86, `main.rs:427`, AGENTS.md §4 and the `sic_regression.rs` header. The DSP-10 mechanism is transcribed correctly. |
| F-59 | VERIFIED | wiki/04: the Trellis gates (corr > 0 and ≤ 12) match `ldpc.rs:400-404`. OSD (min syndrome ≤ 14, 14 least-reliable of 77 bits, CRC field match, > 20 and ≤ 16) matches `ldpc.rs:431-447`. p = 2·2⁻²³ = 2.38e-7 is correct for 23:0. |
| F-61 | VERIFIED | SPEC §7 OSD condition matches `ldpc.rs:53, 431` and the BP min-syndrome tracking at `:355-390`. The SPEC §6.3 `CQ TEST` row with value 2 matches `codec.rs:68, 205, 533`. |
| F-71 | VERIFIED | `docs/benchmarking.md` "Not measured" capture/resampler/scheduler chain and input level. Software loopback rates 48 and 44.1 kHz (`loopback.rs:137`). The median normalisation exists (`sync.rs:128-132`), and scale invariance is correctly stated as expected, not measured. |
| F-76 | VERIFIED | `sic_regression.rs:122-142` uses explicit `pool(8)` and `pool(1)` and asserts 8 threads; passed here. `map_init` per-split decoders make any carried state visible. `docs/receiver.md` Determinism and `docs/sic.md` describe it correctly. |
| F-78 | NOT VERIFIED (stays OPEN) | Nothing addresses DSP-13: d_min ≤ 14 next to the OSD (≤ 16) and Trellis (≤ 12) gates is undocumented, and `z30-channel/src/lib.rs:265-271` still applies the clock stretch from the window start. |

## Relevant paths
- `/home/user/z-30/crates/z30-dsp/tests/ap_production.rs`
- `/home/user/z-30/crates/z30-dsp/tests/sic_regression.rs`
- `/home/user/z-30/crates/z30-dsp/src/slot.rs` (lines 252-270)
- `/home/user/z-30/crates/z30-engine/src/runtime.rs` (lines 251-285)
- `/home/user/z-30/crates/z30-cli/src/suite.rs` (lines 846-965, 1350-1376)
- `/home/user/z-30/docs/receiver.md` (lines 60-70, 110-131)
- `/home/user/z-30/docs/benchmarking.md`
- `/home/user/z-30/docs/sic.md`
- `/home/user/z-30/SPEC.md` (§3, §6.3, §7, §7.1)
- `/home/user/z-30/wiki/17-A-Priori-(AP)-Decoding.md` (lines 276-282)
- `/home/user/z-30/wiki/04-Forward-Error-Correction-&-LDPC.md`
- `/home/user/z-30/audit/ACTIVE_DEFECT_LEDGER.md`
- My exploratory probe, outside the repo: `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/wt/crates/z30-dsp/tests/probe_ap_noise.rs`
