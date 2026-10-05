## rf-dsp-reviewer confirmation: F-26 option (b)

**Commit:** `d7bbbc2` ("docs(dsp): AP's cross-pass "never loses a decode" is untested, not tested"). The hash `4d8b5c5` you gave does not exist in this repository. `d7bbbc2` is an ancestor of HEAD `37505c2`, and no later commit touches `crates/z30-dsp`, `docs/ldpc.md` or wiki/17. I only read files; I ran no tests or benchmarks.

**F-26: VERIFIED.** Each of the four places now says what my re-review asked for in option (b): the guarantee holds per candidate by construction, and across SIC passes it is not guaranteed and no test exercises it. The "found none … 44 plain decodes" evidence claim has been removed. I found no remaining copy of it in `crates/z30-dsp`, `docs/` or `wiki/`.
- `/home/user/z-30/crates/z30-dsp/src/ap.rs:5-10` says "Across SIC passes it is NOT guaranteed and not yet exercised by any test". It gives the mechanism (subtraction plus the 50-candidate cut) and says the busy-band test never produces that case.
- `/home/user/z-30/docs/ldpc.md:92-96` says "**not guaranteed and not yet exercised by any test**", and calls the busy-band test "a regression guard that never puts a plain decode at risk".
- `/home/user/z-30/wiki/17-A-Priori-(AP)-Decoding.md:149-153` says "**not guaranteed, and no test has exercised it yet**", and says the busy-band test "is evidence of nothing here".
- `/home/user/z-30/crates/z30-dsp/tests/ap_production.rs:147-152` (the comment on `f26_in_a_busy_band_ap_never_loses_a_decode_the_plain_decoder_made`) calls the test a regression guard and says it does NOT exercise the cross-pass hazard: every AP decode lands in pass 2. It ends "That case is untested and not guaranteed".

**F-33 Low note: fixed.** `/home/user/z-30/wiki/17-A-Priori-(AP)-Decoding.md:283` now reads "which flatters any claim that AP's gain survives fading", the wording I suggested.

**[Low, non-blocking, not part of F-26's fix]** Two other places still state the AP rule without the cross-pass limit:
- `/home/user/z-30/AGENTS.md:208` (the invariants section)
- `/home/user/z-30/wiki/04-Forward-Error-Correction-&-LDPC.md:181`

Both can be read per candidate; wiki/04 explicitly so ("on a frame that has already failed every schedule"). Adding "per candidate" or a pointer to wiki/17 would keep the docs consistent. This is for docs-honesty-auditor to decide; it does not reopen F-26.