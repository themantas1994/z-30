# rf-dsp-reviewer re-review: F-26, F-33 (with F-41 and F-52 checked as landed)

**Commit:** fix in `cf247a0`, on branch `claude/nice-archimedes-epwg4o`. HEAD is `b6a1f32`. `cf247a0` is an ancestor of HEAD, and no later commit touches `crates/z30-dsp`, `docs/ldpc.md`, `docs/receiver.md`, `docs/benchmarking.md` or wiki/17. Read-only: I edited nothing in the repository.

## What I ran

1. `cargo +1.95 test --release --locked -p z30-dsp --test ap_production -- --nocapture` with `CARGO_TARGET_DIR=/tmp/claude-0/review-dsp-target`. All 4 tests passed. The tests' own exploratory output:
   - noise, 40 slots: LDPC attempts were 12 with AP off, 20 with AP gated and 60 with AP ungated.
   - 24 frames: 8 plain decodes, 18 with AP, 10 of them by AP.
   - busy band, 8 bands: 44 plain decodes, 47 with AP.
2. A scratch probe in my scratchpad, outside the repo (`/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/probe`). It uses path dependencies on the crates and copies the busy-band test exactly. For both arms it prints each decode's pass and `ap_type`, and each pass's candidate count. This is exploratory: 8 bands.

## Findings

**[Medium] F-26: the busy-band test never reaches the cross-pass path it was added to test, so "tested" overstates it**
- **Where:** `crates/z30-dsp/tests/ap_production.rs:145-182`. The claim it backs is at `crates/z30-dsp/src/ap.rs:8`, `docs/ldpc.md:95` and `wiki/17-A-Priori-(AP)-Decoding.md:149-152` ("found none in 8 seeded six-station bands (44 plain decodes)").
- **Evidence from the probe, over the 8 bands:**
  - All 40 decodes of the five other stations are pass 1 with `ap_type` 0, in both arms. Pass 1 sees the same audio and the same candidate set in both arms, so these are protected by construction.
  - The other 4 plain decodes are the QSO station itself in pass 2 (bands 2, 3, 6 and 7). AP made no decode in pass 1 of any band, so pass 2's input is identical in both arms. These are protected by construction too.
  - The 3 AP-only decodes are all `a3`, in pass 2 (bands 0, 1 and 4). Each only starts an extra pass 3 in the AP arm, which can only add decodes.
  - So none of the 44 plain decodes was at risk. The hazard is an AP-only decode in pass *k* that gets subtracted and then displaces another station's plain decode in pass > *k*. This test never produces that case.
  - The hazard is real here: pass 1 and pass 2 each hit the 50-candidate truncation in every band (candidate counts [50, 50, …]).
- **Why it matters:** The new wording in all three files has the right structure: by construction per candidate, not guaranteed across passes. But "tested" and "found none (44 plain decodes)" read as evidence about the cross-pass case. There is none.
- **Fix, either of:**
  - (a) Make the test reach the path, and assert that it did. That needs at least one band with an AP-only decode in pass 1, plus a plain decode of a *different* station in pass ≥ 2 within 60 Hz of it. For example, put the QSO station clear of the −8 dB station at 1460 Hz so AP recovers it in pass 1. Then add a weak station near F0 that only comes out after a strong neighbour is subtracted.
  - (b) Change the three statements to say the cross-pass case is **not guaranteed and not yet exercised by any test**, and drop "found none … 44 plain decodes" as evidence.

  Either one closes the row.

**The other F-26 items check out:**
- The noise test is no longer vacuous. `gated > off` (20 > 12) proves AP ran, and `ungated > gated` (60 > 20) proves the gate narrows. A gate stuck open would give 60 = 60 and fail the test; a gate stuck closed would give 12 = 12 and fail it.
- The wrong-assumption test asserts `decoded > 0` (`:110`).
- The never-change-or-lose check now has 8 plain decodes against a floor of 4 (`:88`).
- The per-candidate "by construction" claim holds: `decode_with_ap` returns the plain result first (`ap.rs:191-196`). The `Decoder` keeps only scratch buffers, and the thread-count determinism tests cover that.
- The AP-on false-decode benchmark is correctly split out as F-80.

**[Low, not blocking] F-33: one unsupported mechanism in the replacement text**
- **Where:** `wiki/17-A-Priori-(AP)-Decoding.md:281-284`.
- **Problem:** "which is exactly what would flatter AP" claims something without evidence. Milder fading flatters the claim that AP's gain *survives* fading. Whether it inflates or shrinks the size of the 2.93 dB shift is not established.
- **What is accurate:** the facts (H-10 no slow power variation; N-01 0.707×, quoted as 0.71×, the labelled Doppler spread) and the conclusion ("withdrawn, not evidence of anything; no AP figure exists on the corrected fading model").
- **Suggested wording:** "which flatters any claim that AP's gain survives fading".

## Follow-ups confirmed landed (rows not re-reviewed)

- **F-41:** `docs/receiver.md:63-68`. The pass-2/3 bullet is now a heuristic and names DSP-04's three exceptions: whitening noise bins at f0 −84…−16 Hz, the global median renormalisation, and the 50-candidate cut. Code comment `slot.rs:252-254` is unchanged, as intended. The row stays OPEN pending measurement.
- **F-52:** `docs/benchmarking.md:303-305`. The NMS parenthetical is replaced: it says DSP-05 gives no mechanism, notes that 0.08 s is two 40 ms hops and lies inside the ±0.1 s residue window, and says which gate decides it is not known. This is accurate.

## Verdicts

| Row | Verdict | Evidence |
| :-- | :-- | :-- |
| F-26 | **NOT VERIFIED** | Three of the four test items are now non-vacuous: `ap_production.rs:88`, `:110`, and `:141-142` (attempts 12 / 20 / 60). But the busy-band test (`:145-182`) never puts a plain decode at risk. In the probe, all 44 plain decodes were pass 1 or followed no AP decode, and every AP decode was in pass 2. So "tested … not guaranteed" at `ap.rs:8`, `docs/ldpc.md:95` and `wiki/17:149-152` overstates the evidence. Fix (a) or (b) above closes it. |
| F-33 | **VERIFIED** (Low note) | `wiki/17:281-284` no longer uses the 2.93 dB figure as evidence, and it says no AP figure exists on the corrected fading model. The only unsupported part is the clause "exactly what would flatter AP". |
