# Documentation and honest-numbers audit — z-30 at `caf1a9a`

> Produced by the `docs-honesty-auditor` agent (`.claude/agents/docs-honesty-auditor.md`), 2026-09-28.
> Evidence for the board, not a board decision. Read-only on the checkout.

**Verdict: 34 findings** (High 1, Medium 9, Low 23, Info 1). No document says or implies that
z-30 has been validated on hardware or on the air. No withdrawn figure is quoted as current.
Every suite figure checked matches its result file. The problems are: docs that contradict the
code, FT8 comparisons that are incomplete, oracle figures that are not clearly labelled as the
oracle's, and statements that have gone stale.

## Header

| | |
| :--- | :--- |
| Commit | `caf1a9a1959a` (branch `claude/fervent-cray-riehln`, same as `main`); working tree clean before and after the audit |
| Scope | `SPEC.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, all of `docs/` (16 files), all of `wiki/` (20 files), `hardware-validation/README.md`, `research/results/README.md`, `.claude/agents/*.md` (7). All of these were checked against `crates/`, `research/results/{672cef9b3cdb,d8983eeef66e,18fbd78d8fb8}/`, the top-level result files, and the documentation findings of `audit/2026-09-24-post-remediation/FINAL_AUDIT.md` and `audit/2026-09-24-corrective-remediation/FINAL_AUDIT.md` |
| Tools run | `git`, `grep`/`rg` sweeps (dB figures, hardware/on-air wording, "threshold", superlatives, "confidence", "suppression") |
| | `python3 research/summarize_suite.py <dir>` without `--write`, for all three suite directories, diffed against the committed `SUMMARY.md` |
| | A Python relative-link and anchor checker, and a checker that quoted file paths exist |
| | Identifier greps for every test, function, type, constant and flag name quoted in the docs |
| | Python recomputation of: replicate statistics, pooled crossing, McNemar p-values, Eb/N0, Shannon rows, Costas coincidence |
| | `./target/release/z30 --help`, `--version`, `--diagnostics` (scratch `Z30_HOME`), `--migrate` (empty scratch `Z30_HOME`), `--loopback-test` (in memory, `--out` to scratch), `--encode` (to a scratch WAV); `./target/release/z30-gui --version` |
| Not run | the test suite, the benchmark suite, the GUI (no display); nothing that opens an audio output, PTT or rigctld |

---

## Findings

### DOC-01 [High] wiki/15 shows a new installation with a default dial and TX level, and says `--migrate` writes exactly that. Both claims are false.

- **wiki/15-Command-Line-Tools-&-Configuration.md:47-48, 59, 78:**
  - "A new installation's configuration (this is exactly what `z30 --migrate` writes when there is nothing to migrate)"
  - `dial_hz = 14076000       # USB dial frequency`
  - `tx_level = 0.5`
- **Code:**
  - `crates/z30-engine/src/config.rs:125` has `dial_hz: Option<u64>`; the test at `config.rs:235` asserts `dial_hz == None` and `tx_level == 0.0` ("No dial either (N-05)", "And no transmit level (N-09)").
  - `z30 --migrate` on an empty data directory at HEAD writes **no** `dial_hz` line, and writes `tx_level = 0.5`.
  - `z30 --diagnostics` with no config refuses on both "no dial frequency is set" and "The transmit audio level is 0".
- **Other docs:** `AGENTS.md:128` ("No default callsign, region, class, PTT, dial or transmit level"); `docs/safety.md:61-63`; `wiki/13:91`.
- **Authority:** code.
- **Proposed replacement for lines 47-49 and the block:**
  > "What `z30 --migrate` writes when there is nothing to migrate. There is no `dial_hz` line: with no dial set, transmit is refused (`FrequencyUndetermined`). A configuration the GUI saves without migration has `tx_level = 0.0`, which the gate refuses (`TxAudioLevelZero`); `--migrate` writes 0.5 (see DOC-02)."
  - Delete the `dial_hz = 14076000` line, or replace it with `# dial_hz = 14076000   # absent: transmit refused; set your own dial`.

### DOC-02 [Medium] `z30 --migrate` always sets a transmit level, which contradicts the §4 invariant "no default … transmit level".

- **Code:** `crates/z30-io/src/migrate.rs:337-338` sets `cfg.audio.tx_level = 0.5;` whether or not there are legacy files. This is the config a first-time user gets if they run `--migrate`, as README:117 and wiki/01 §7 tell them to.
- **Docs:**
  - `AGENTS.md:128`: "No default callsign, region, class, PTT, dial or transmit level. A new install cannot transmit"
  - `docs/safety.md:61-63`: "A new installation has … a transmit level of 0"
  - `docs/safety.md:33` (`TxAudioLevelZero`: "a new installation's")
- **Authority:** code, against the `AGENTS.md` §4 invariant. The post-remediation audit's N-09 was scoped to a "new (non-migrated) install", so this gap was never closed.
- **Proposed:**
  - Preferred: change the code so `migrate` carries over a legacy level only if one exists and otherwise leaves 0.0. Route this to `tx-safety-auditor`.
  - If the code stays, amend `AGENTS.md:128` and `docs/safety.md:61-63` to: "…a transmit level of 0 (a configuration written by `z30 --migrate` sets 0.5, the level vNext starts from; the gate still refuses until callsign, region, class, dial and PTT are set)".

### DOC-03 [Medium] The rig tuning-resolution exemption is documented as working, but nothing in production ever measures a resolution.

- **Docs that say it works:**
  - `AGENTS.md:119-120`: "a difference inside the rig's tuning resolution are not refusals"
  - `docs/safety.md:90-96`: "Three exclusions keep it from grounding stations that work … a difference inside the rig's measured tuning resolution is not a refusal (`r4`)"
  - `docs/hardware.md:17-18`: "…and the rig's measured tuning resolution"
- **Docs that say the opposite:**
  - `wiki/06:58-61`: "the probe that *measures* a rig's resolution is not wired into vNext yet, so the tolerance is a strict 1 Hz"
  - `wiki/13:75-77`, `KNOWN_LIMITATIONS.md:51`
- **Code:** `RigStateTracker::set_resolution` (`rig.rs:136`) is called only from `crates/z30-engine/tests/safety.rs:247`. Production resolution stays 0, i.e. 1 Hz.
- **Authority:** code.
- **Proposed:**
  - Add to `docs/safety.md:96` and `docs/hardware.md:18`: "(implemented and tested with an injected resolution; the probe that measures a real rig's resolution is not wired in, so the tolerance is currently a strict 1 Hz: see wiki/06)".
  - Add the same parenthesis to `AGENTS.md:120`.

### DOC-04 [Medium] docs/demodulation.md "SNR" describes the retired estimator and a −40 dB floor.

- **docs/demodulation.md:84-89:** "The SNR is the mean energy in the transmitted tone's bin, less the noise, over the noise in one 3.125 Hz bin … A non-positive estimate reports −40 dB, which is a floor, not a measurement."
- **Code:** `crates/z30-dsp/src/demod.rs:167-204` fits a per-symbol least-squares replica and takes the noise from the residual after the replica is removed. It returns `Option`: a non-positive estimate gives `None`, never a floor.
- **Other docs:** `docs/receiver.md:96-108` is correct; `AGENTS.md:139-144` forbids exactly the estimator and floor described here.
- **Authority:** code.
- **Proposed replacement for §SNR:**
  > "After a successful decode, the decoded frame's noise-free replica is placed on the received symbol spectra and fitted per symbol by least squares (`FrameSpectra::snr_db`). S is the fitted replica's per-symbol energy less its noise projection. n_bin is the median energy per 3.125 Hz bin of the off-signal bins of the residual after the replica is removed. SNR = 10 log10(S/n_bin) − 10 log10(2500/3.125). A non-positive estimate is `None` (shown `--`, no report sent), never a floor. Validated range and caveats: [receiver.md](receiver.md#reported-snr-dt-and-frequency)."

### DOC-05 [Medium] The wiki says decodes are labelled "pass 2" / "pass 3". Neither the GUI nor the CLI shows the pass.

- **Wiki:**
  - `wiki/05-…(SIC).md:15`: "decodes (shown as "pass 2")"
  - `wiki/05:29-30`: "Stations decoded in a later pass are labelled `pass 2` / `pass 3` in the decode list."
  - `wiki/10:35-37`: FAQ "What does "pass 2" or "pass 3" on a decode mean?"
- **Code:**
  - GUI band activity has exactly six columns: `"UTC", "dB", "DT", "Hz", "Message", ""` (AP tag) (`crates/z30-gui/src/app.rs:437-459`).
  - The CLI decode line (`crates/z30-cli/src/main.rs:294`) has no pass either.
  - `pass` appears only in `--capture-slots` JSON (`main.rs:371`).
- **Authority:** code.
- **Proposed:**
  - wiki/05:15: replace `(shown as "pass 2")` with `(pass 2)`.
  - wiki/05:29-30: "The pass that found each decode is recorded in the `--capture-slots` JSON (`"pass"`). The GUI and the CLI decode line do not show it."
  - wiki/10:35-37: delete the FAQ, or reword it as "How do I know SIC found a station? The `pass` field of the `--capture-slots` report JSON."

### DOC-06 [Medium] Two FT8 comparisons do not quote "all of it" (AGENTS §5).

- **AGENTS.md:224-229** requires: depth (with "conditions not identical"), 1.9× airtime, 14 fewer bits, Eb/N0 per bit (6.8 vs 5.1 dB), high-latitude no-decode, and **FT8 does recover collisions**.
- **wiki/Home.md:31-35:**
  - Missing the collisions sentence.
  - Missing the Eb/N0 values.
  - Missing "conditions not identical". "Published (simulation)" is present.
- **wiki/10-Troubleshooting-&-FAQ.md:23-27:**
  - Missing FT8's −21 dB figure and its source/conditions.
  - Missing the Eb/N0 values.
  - Missing the collisions sentence.
- **Also:** `wiki/16:82-84`, restating the rule, leaves out the collisions clause and "conditions not identical".
- **Complete versions exist:** README:70-85 and wiki/11 (checked).
- **Authority:** AGENTS §5.
- **Proposed text to append to Home.md:34 and to wiki/10:26:**
  > "(Franke, Somerville & Taylor, QEX 2020, a simulation figure whose conditions are not identical to these; per message bit 6.8 dB Eb/N0 for z-30 against 5.1 dB for FT8.) FT8 also recovers collisions: WSJT-X runs three decoding passes with subtraction."
  - wiki/16:82-84: add "the published FT8 figure's source and non-identical conditions, and that FT8 also subtracts and re-decodes (three passes)".

### DOC-07 [Medium] wiki/10 still presents the unverifiable E007 re-implementation as the protocol's validation (post-remediation N-11 not fully fixed).

- **wiki/10-Troubleshooting-&-FAQ.md:17:** "The protocol is validated (an independent implementation reproduces it bit for bit)"
- **README.md:48, wiki/Home.md:11, wiki/01:11** say the correct thing: validation is golden-vector parity with the frozen oracle, and E007 is external and not in this repository.
- The corrective audit (§5 N-11, §7) marks N-11 "VERIFIED FIXED". Its term search looked for "independent re-implementation", which this phrasing does not contain.
- **Authority:** corrective audit N-11; README.
- **Proposed:** "No. The protocol is validated against the frozen reference oracle: the Rust implementation reproduces its golden vectors, checked in CI. The receiver is measured in seeded software simulation. No radio…"

### DOC-08 [Medium] "Fewer than 200 frames per point is exploratory and the suite marks it so": the suite marks below 100.

- **Docs saying 200:**
  - `AGENTS.md:238-239`: "Minimum 200 frames per point behind a published sensitivity crossing; fewer is exploratory and the suite marks it so."
  - The same 200 rule in `docs/research-process.md:57-58`, `.claude/agents/research-engineer.md:37`, `.claude/agents/rf-dsp-reviewer.md:53`.
- **Code:** `crates/z30-cli/src/suite.rs:776-778` marks `exploratory` only when `--frames < 100`.
- **Docs matching the code:** `docs/benchmarking.md:49`, `wiki/16:70-71`.
- **Authority:** code.
- **Proposed:**
  - Either change the suite to mark `< 200` for crossing benchmarks, or
  - Amend AGENTS:238-239 to: "Minimum 200 frames per point behind a published sensitivity crossing; fewer is exploratory and must be labelled so (the suite itself marks only runs under 100 frames per point)". Apply the same wording in research-process.md:57-58.

### DOC-09 [Medium] wiki/17 oracle AP figures: parts of the page present them as z-30's, misstate AGENTS §5, and rest on sub-200-frame points with no result file.

- **Good:** wiki/17:18-25 labels the figures as the oracle's.
- **Problems:**
  - `:266` "that is the number to quote".
  - `:279-281` offers an unattributed quotable sentence: "AP recovers frames the ordinary decoder loses, and … moves the 50% point by 1.8–1.9 dB on AWGN".
  - `:308-311`: "`AGENTS.md` §5 sets the bar … at ≥99% confidence that it is comparable to real-world behaviour … it runs the real receive chain". AGENTS §5 actually sets ≥95%/≥99% on a *stated confidence figure* for a result that challenges docs. The chain measured was the oracle's, not the shipped one.
  - `:246-248, :262-264, :283`: the crossings come from 60-80 frames per point (about 40 in-QSO) and are not labelled exploratory.
  - No file under `research/results/` holds these sweeps.
- **Checked:** the McNemar p-values (1.4e-45, 3.7e-40, 4.0e-28), 1,840 frames and 27 rows are arithmetically correct.
- **Authority:** AGENTS §5 ("the oracle's figures are the oracle's"; minimum 200 frames; results must come from a result file).
- **Proposed:**
  - :266: "…and that is the oracle's figure; it has not been measured through `decode_slot`."
  - :279-281: "*"On the frozen oracle's reference receiver, in simulation, AP recovered frames the ordinary decoder lost, and for the frames it describes moved the 50% point by 1.8–1.9 dB on AWGN (exploratory: about 40 in-QSO frames per point; not re-measured through `decode_slot`)"*".
  - :308-314: "Paired at the LLR vector; exact two-sided McNemar p = 1.4 × 10⁻⁴⁵ over 150 discordant pairs. Instrument: the oracle's `realistic` mode (blind acquisition and noise estimation in the reference receiver), not the shipped `decode_slot`. No result file under `research/results/` holds these sweeps."

### DOC-10 [Low] wiki/17 describes the retired app's AP setting and placeholder callsign.

- **wiki/17:204-205:** "`apDecodeEnabled` in Station Settings → Automation is unchecked on first launch." That setting exists only in `legacy/browser-runtime/src/types/z30.ts:122`.
- **vNext:**
  - config key `[receiver] ap_enabled` (`config.rs:169`; wiki/15:86);
  - GUI **Settings → Receiver** checkbox "A priori decoding" (`app.rs:740-741`; wiki/14:70).
- **wiki/17:176-178:** "the placeholder … is what Station Settings holds before the operator has entered anything". A vNext new installation has an **empty** callsign (`config.rs` test; `AGENTS.md:128`).
- **Proposed:**
  - "It is also why **AP is off by default**: `ap_enabled = false` in `[receiver]` (GUI: Settings → Receiver → A priori decoding)."
  - "The placeholder callsign (`NOCAL`) is refused for a different reason: it round-trips, but it is a placeholder, not knowledge."

### DOC-11 [Low] wiki/04 misstates the trellis stopping rule and the OSD gates, against SPEC §7/§7.1.

- **wiki/04:149-153:** the trellis check "re-derive[s] the 139 parity bits … and checked against the syndrome".
  - SPEC §7 says: the payload CRC matches the received CRC field **and** the re-encoded codeword has correlation > 0 with the LLRs **and** differs from the hard decision in ≤ 12 bits. Code: `ldpc.rs:404`.
- **wiki/04:156-162:** "accepted only if its CRC field matches the **received** CRC bits as well as its own payload … the legacy OSD's only real test was the syndrome … union bound … *before the fine-sync gate and the CRC-field match*".
  - SPEC §7.1 / docs/ldpc.md: the CRC field may itself be flipped (it is among the 77 ranked bits). The candidate's CRC field must equal the CRC of its payload. The legacy gates were correlation > 20 and distance ≤ 16. The union bound is the probability of a random CRC pass, *before the correlation and distance gates*.
- **Authority:** SPEC.
- **Proposed:**
  - Step 5: "…if the payload CRC matches the received CRC field, the information bits are re-encoded and accepted when that codeword correlates positively with the channel LLRs and differs from the hard decision in ≤ 12 bits (SPEC §7)."
  - Step 7: "…OSD (only when BP reached syndrome weight ≤ 14) flips up to two of the 14 least reliable of all 77 information bits, and accepts a candidate only if its CRC field equals the CRC of its payload, then applies the correlation > 20 and distance ≤ 16 gates. The legacy OSD recomputed the CRC from the flipped payload, so its CRC check compared a CRC with itself (M1). The union bound on a random CRC pass is 106 × 2⁻¹⁴ ≈ 6.5 × 10⁻³ per invocation before the correlation and distance gates."

### DOC-12 [Low] wiki/04's 2026-08-31 correction box: the p-value does not match its own test, and it reads a p-value as confidence.

- **wiki/04:102-103:** "23 of 23 disagreements … (exact McNemar test, p ≈ 4×10⁻⁷, i.e. **>99.9999% confidence**)".
  - Exact two-sided McNemar for 23:0 is 2·2⁻²³ = **2.4×10⁻⁷**.
  - A p-value is not a confidence.
  - No result file exists. This is an oracle-era measurement of the oracle's decoders.
- **Proposed:** "(exact two-sided McNemar p = 2.4 × 10⁻⁷, measured on the oracle's decoders in 2026-08; no result file is kept)."

### DOC-13 [Low] docs/ldpc.md says the logbook does not record AP use. It does.

- **docs/ldpc.md:95-97:** "(The logbook does not yet carry the tag … not stored per record. Listed in [benchmarking.md](benchmarking.md#not-measured).)"
- **Code:**
  - `QsoRecord::ap_assisted` (`qso.rs:158`, set at 277/325/332/344);
  - the SQLite column `ap_assisted` (`logbook.rs:62`);
  - ADIF `APP_Z30_PROVENANCE` carries `AP=1` (`logbook.rs:328-330`);
  - the GUI logbook shows ", AP" (`app.rs:508`).
  - benchmarking.md's "Not measured" list does not mention it.
- **Authority:** code.
- **Proposed:** "(The logbook records per contact whether any message of the exchange was AP-assisted (`QsoRecord::ap_assisted`, ADIF `APP_Z30_PROVENANCE` `AP=1`), not which type.)"

### DOC-14 [Low] SPEC (normative) leaves out the condition under which OSD runs.

- **SPEC.md:214-230** (§7, §7.1) never states that OSD runs only when BP's minimum syndrome weight is ≤ 14.
- Both implementations enforce it: `legacy/python-oracle/z30_dsp/ldpc.py:785` (`if min_syndrome_weight <= 14`) and `crates/z30-dsp/src/ldpc.rs:53, 431` (`OSD_MAX_SYNDROME`). docs/ldpc.md:67 states it.
- An implementation written from SPEC alone would run OSD on every failure, which changes the false-accept exposure.
- **Proposed** (add to §7.1, both paragraphs): "OSD is invoked only when the best BP iterate's syndrome weight is ≤ 14."

### DOC-15 [Low] SPEC §6.3 omits `CQ TEST`, which the codec encodes.

- **SPEC.md:169-177** lists `CQ` and `CQ DX` only.
- **Code:** `codec.rs:533` parses `["CQ", "TEST", …]`. `z30 --encode "CQ TEST K1ABC FN31"` succeeds at HEAD.
- **Proposed** row: `| CQ TEST <call> <grid> | 2 | call | grid |`

### DOC-16 [Low] "Bit for bit" / "bit-exact" is applied to the waveform, whose tolerance is 1e-6.

- **Docs:**
  - `README.md:48`: "reproduces … golden vectors - CRC, LDPC encoder, symbol map, codec and waveform - bit for bit"
  - `wiki/Home.md:11`, `wiki/01:11`: "golden vectors bit for bit"
  - `wiki/03:40-41`: "It is bit-exact with the frozen Python oracle on the golden waveforms"
- **Authority:** SPEC §1.3 and §11 (≤ 1e-6); `crates/z30-protocol/tests/golden.rs:145` (`worst <= 1e-6`); `docs/protocol-v1.md:32`.
- **Proposed:** "…CRC, LDPC encoder, symbol map and codec bit for bit, and the waveform within 1e-6…". wiki/03: "It matches the frozen Python oracle's golden waveforms at 6, 12 and 48 kHz within 1e-6."

### DOC-17 [Low] Replicate statistics: the sd is attributed to the wrong set of runs, and the figures do not trace to `research/results`.

- **Docs:**
  - `docs/benchmarking.md:86-88`: "Ten further runs … ranged from −23.07 to −22.93 dB, mean −23.00, **standard deviation 0.048 dB** (90%: sd 0.068 dB)"
  - `AGENTS.md:220`: "run-to-run sd over ten disjoint replicates is 0.048 dB"
- **Recomputed from `research/results/18fbd78d8fb8/`:**
  - 0.048 / 0.068 are over **11** runs (published + 10). The ten replicates alone give sd **0.050** (50%) and **0.072** (90%).
  - `audit/…/awgn_replicate_analysis.json` says `"n_runs": 11`.
  - The pooled −23.00 [−23.04, −22.96] and −22.09 [−22.12, −22.05] are correct.
  - These statistics are produced by `audit/…/analyse_awgn.py`, not by `summarize_suite.py`. `18fbd78d8fb8/` has no `SUMMARY.md`, and the docs do not cite the analysis file.
- **Proposed:**
  - "Over the published run and ten disjoint replicates (11 runs), the 50% point ranged −23.07 to −22.93 dB, mean −23.00, sd 0.048 dB (90%: sd 0.068 dB) (`audit/2026-09-24-corrective-remediation/evidence/awgn_investigation/awgn_replicate_analysis.json`)."
  - Same in AGENTS:220.
  - Generate `SUMMARY.md` for `18fbd78d8fb8/`.

### DOC-18 [Low] troubleshooting.md's sample `--diagnostics` output is stale.

- **docs/troubleshooting.md:8-18:**
  - shows `z30 0.9.0 (<commit>) (protocol v1)`;
  - lists four refusals;
  - has no `data dir:` or `audio:` lines.
- **HEAD output:**
  - the full `--version` block;
  - `data dir:` and `audio:` lines;
  - **six** refusals, including "The transmit frequency could not be determined: no dial frequency is set…" and "The transmit audio level is 0 (Settings: TX level)…".
- **Authority:** code (binary output).
- **Proposed:** paste the current output (commit line elided) with all six refusals.

### DOC-19 [Low] The `suppression_db` overstatement range is incomplete.

- **Docs:** `AGENTS.md:147` "~10 dB"; `docs/benchmarking.md:226`, `docs/sic.md:37`, `wiki/05:85` "9–12 dB".
- The post-remediation audit (FINAL_AUDIT §11, H-01 row) measured it **11–16 dB** ("reads 30–41 dB, overstating by 11–16 dB").
- **Proposed:** "…overstating the true suppression by 9–16 dB (original audit E047: 9–12 dB; post-remediation audit §11: 11–16 dB)". AGENTS:147: "(it overstates by 9–16 dB)".

### DOC-20 [Low] Suite runtime.

- **wiki/16:71:** "The full suite takes a few hours on 4 cores."
- `AGENTS.md:268` and `docs/development.md:92` say "~1 h". The `elapsed_s` values in `672cef9b3cdb/*.json` sum to **53 min**.
- **Proposed:** "about an hour on 4 cores (53 min for `672cef9b3cdb`)".

### DOC-21 [Low] The clippy command in two places differs from AGENTS/CI.

- `README.md:154` (`cargo clippy -- -D warnings`) and `wiki/16:94` (`cargo clippy --workspace --all-targets -- -D warnings`) omit `--exclude z30-py`.
- The workspace is virtual (`members = ["crates/*"]`), so these commands lint `z30-py`, which needs a Python interpreter (N-15).
- `AGENTS.md` §6, `docs/development.md:39` and `rust.yml:46` all use `--exclude z30-py`.
- **Proposed:** `cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings` in both places.

### DOC-22 [Low] Some figures are missing conditions.

- **wiki/03:113:** "tone 0 anywhere from 200 Hz to 2753 Hz" is listed under *Measured tolerances*, but the suite placed tone 0 uniformly over **210–2740 Hz** (`awgn.json` placement). 200–2753 is the search range, not what was measured.
- **wiki/03:116:** "±3000 ppm costs nothing measurable" gives no SNR or frame count. It is 200/200 at −20 dB (`clock.json`), and the result extends to ±5000 ppm (≥ 99.5%).
- **wiki/Home.md:29-31:** the 90% figure has no interval; the success criterion and "Wilson 95%" are missing.
- **Proposed:**
  - wiki/03: "tone 0 placed uniformly over 210–2740 Hz (the search covers 200 Hz to where tone 15 reaches 2800 Hz)" and "±5000 ppm: ≥ 99.5% at −20 dB (200 frames per point, `clock.json`)".
  - Home: "…90% at −22.06 dB [−22.15, −21.80]; success = the 63 payload bits equal the transmitted ones; Wilson 95% intervals".

### DOC-23 [Low] The occupied-bandwidth figure has no result file and is slightly narrower than what the code reports.

- **Docs:** `README.md:92` and `wiki/03:16`: "≈ 49–50 Hz (99%)". `loopback.rs` criteria text says "~49 / ~66 Hz".
- **HEAD:** `z30 --loopback-test` reports `p99` **50.54 Hz** (all three runs) and −40 dB 65.9–66.7 Hz. The unit test only asserts 44–55 Hz and 55–80 Hz. Nothing under `research/results/` records it.
- **Proposed:** "≈ 50.5 Hz (99%), ≈ 66 Hz (−40 dB), from `z30 --loopback-test` (software, ideal waveform)". Commit a loopback JSON under `research/results/<commit>/` and cite it.

### DOC-24 [Low] README's fading line: missing conditions, and one number looks like the withdrawn figure.

- **README.md:80:** "50% at about −21 dB … (−20.9 / −21.4 / −20.9 dB)". It has no frame count, seed, interval or result file, and "−21.4 dB" (moderate, −21.37 rounded) reads like the withdrawn "−21.4 dB mid-latitude".
- **Proposed:** "(good −20.94 [−21.33, −20.55], moderate −21.37 [−21.63, −21.12], poor −20.88 [−21.09, −20.68] dB; 200 frames per point, seed 20260830, Wilson 95%; `research/results/672cef9b3cdb/fading.json`)".

### DOC-25 [Low] docs/README.md claims every figure names a `research/results` file. Several do not.

- **docs/README.md:5-7:** "every figure they quote names the file in `research/results/` it came from".
- **Counter-examples:**
  - `docs/receiver.md:110-120` (post-remediation audit harness);
  - `docs/sic.md:50-51` (test output 31.4…39.1 dB);
  - `docs/synchronization.md:112` (soak test: 2879 slots, 0.35 ms, 150.7 ppm);
  - `docs/demodulation.md:50-52` (oracle, `benchmark.py`) and `:78-80` (`golden_demod.rs` output).
- **Proposed:** "…names its source: a file in `research/results/`, a named test, or audit evidence, and says whether it was measured in simulation or on hardware (so far: always simulation)".

### DOC-26 [Low] Wording that could suggest on-air use or broader testing, plus two uses of "threshold" for the oracle.

- **"on-air decoder" for the legacy live-receive decoders:** `docs/architecture.md:36`, `docs/benchmarking.md:367`. `docs/hardware-validation.md:3-4` says no radio was ever used with vNext **or legacy**.
- **docs/hardware.md:5-6:** "None of the adapters has been exercised against a physical radio *in this repository's CI*". The qualifier implies testing elsewhere; `:73` says none at all.
- **"Threshold" used for the oracle:**
  - `docs/benchmarking.md:367`: "The published threshold described a receiver nobody ran"
  - `research/results/README.md:37`: "AWGN decode threshold, oracle vs vNext". The oracle arm is windowed: it was told the carrier and timing.
- **Proposed:**
  - "live-receive decoder(s)".
  - "None of the adapters has been exercised against a physical radio."
  - "The published figure described…".
  - "AWGN 50%/90% decode crossings, oracle (windowed) vs vNext `decode_slot` (blind), paired…".

### DOC-27 [Low] wiki/16 "200 frames per point unless stated" does not hold for the SNR row.

- **wiki/16:38-39** says so, but row `:45` (Reported SNR) is **100** frames per point (`snr.json`) and does not say so. Busy is 50 slots per point.
- **Proposed** row text: "100 frames per point: bias within ±0.25 dB at every point from −22 to +30 dB…".

### DOC-28 [Low] Broken anchor.

- **docs/architecture.md:79:** `synchronization.md#the-slot-clock`. The heading is "The slot clock (`z30-engine`: `clock.rs`, `slots.rs`, `pipeline.rs`)", whose anchor is `#the-slot-clock-z30-engine-clockrs-slotsrs-pipeliners`.
- **Proposed:** fix the link, or shorten the heading to "The slot clock".

### DOC-29 [Low] wiki/04 formula contains control characters.

- **wiki/04:25:** the bytes are `0x08 i g (`, a literal backspace where `\big(` was intended (twice). The formula renders broken.
- **Proposed:** `$$N = \big( (p \cdot 37 + p') \cdot 10 + d \big) \cdot 27^3 + (s_0 \cdot 27^2 + s_1 \cdot 27 + s_2) + 100$$`

### DOC-30 [Low] Sidebar links do not resolve inside the repository.

- **wiki/_Sidebar.md:1, 8-32:** GitHub-Wiki-style targets (`Home`, `01-New-User-Guide-&-First-Steps`, no `.md`). They do not resolve in the repository tree.
- Home.md:66-69 says the wiki is "markdown files under `wiki/` in the repository"; every other page uses `.md` links.
- **Proposed:** use `.md` targets, or state that `_Sidebar.md`/`_Footer.md` are for a published GitHub Wiki only.

### DOC-31 [Low] README's "full list" of limitations is stale.

- **README.md:133** calls `audit/2026-09-24-vnext-remediation/KNOWN_LIMITATIONS.md` "The full list". That file was last changed at `f98a24a`, before the post-remediation and corrective audits. It lacks:
  - N-04's residual (a VOX radio on a PTT-less config's sound card cannot be detected);
  - N-08 (SNR bias on non-ideal signals);
  - N-12 (no published figure goes through the capture/resampler/scheduler chain);
  - N-15.
- Its fading line was written against the now-withdrawn run. Its numbers happen to match the corrected ones.
- **Proposed:** move a maintained list into `docs/` (or update that file). Add N-04, N-08, N-12 and N-15 residuals, and date it.

### DOC-32 [Low] benchmarking.md "Not measured" omits the capture/resampler/scheduler chain (N-12).

- **docs/benchmarking.md:381-397.** Every suite figure injects 6 kHz audio directly into `decode_slot`. The corrective audit lists N-12 as PARTIALLY FIXED: "no *published* benchmark figure goes through it".
- **Proposed bullet:** "**The capture → resampler → sample clock → scheduler chain.** Suite audio is synthesised at 6 kHz and handed to `decode_slot` directly; only the software loopback (`z30 --loopback-test`) exercises the chain, and no published figure comes from it."

### DOC-33 [Low] The docs' tables are reformatted, not "pasted" from `SUMMARY.md`.

- `docs/benchmarking.md:50-51` ("the tables below are pasted from it") and `AGENTS.md` §5 say docs tables are pasted from `summarize_suite.py` output. Some are not:
  - the AWGN table (labels, Unicode minus, latency column dropped);
  - the drift matrix (`:133-136`);
  - the fading crossing table with its "Withdrawn" column;
  - wiki/05's SIC matrix and wiki/11's fading matrix.
- Every value in these tables was checked against the JSON: all correct. The provenance statement is still inaccurate.
- **Proposed:** extend `summarize_suite.py` to emit these views, or reword to "tables are generated from, or checked value by value against, `SUMMARY.md`".

### DOC-34 [Info] The withdrawn directory's `SUMMARY.md` no longer matches the script and carries no withdrawn marker.

- **research/results/d8983eeef66e/SUMMARY.md:218** has header `| Preset | Delay / Doppler | 50% crossing |`. The current script emits "Delay / Doppler spread (2 sigma)".
- Regenerating would mislabel the withdrawn run, which ran at 1/√2 of the 2σ spread, so leaving it is correct.
- The file's own fading section has no "withdrawn" marker. Only `research/results/README.md` says so.
- **Proposed:** record this exception in `AGENTS.md` §3. Add a `WITHDRAWN.md` in `d8983eeef66e/` pointing to N-01.

---

## Claims verified as correct

**Suite results match their files, and the summaries match the script.**
- The regenerated `SUMMARY.md` for `672cef9b3cdb` is byte-identical to the committed one.
- Every figure in `docs/benchmarking.md` matches `672cef9b3cdb` JSON: AWGN, SNR, timing, drift, clock, impair, busy, false, SIC (all 24 cells and p-values), and the fading points and crossings.
- The nine non-fading benchmarks are identical between `672cef9` and `d8983ee`.
- The withdrawn values −20.79 / −21.31 / −21.07 and "poor −22 dB 27.0%" match `d8983eeef66e/fading.json`.

**Headline and derived figures.**
- AWGN −23.03 [−23.13, −22.89] / −22.06 [−22.15, −21.80]; seed 20260830; 200 frames; blind placement 210–2740 Hz, ±1.4 s.
- Pooled −23.00 [−23.04, −22.96] and 90% −22.09 [−22.12, −22.05], recomputed from the 11 runs.
- Fading costs 1.7–2.2 dB against AWGN.
- FT8 arithmetic: Eb/N0 6.76 / 5.13 dB (Δ 1.63); airtime 1.90× (2.78 dB); Shannon rows −31.38 / −27.72 and distances 8.35 / 6.72 dB.
- Costas pattern: at most 3 coincidences for any non-zero shift (wiki/03, E011).
- Earlier instruments: `awgn_paired_200` (−23.01 / −22.92, 34:17, p = 0.024), `whitening_ab_200` (0 of 1000), `false_decodes_2000` (133,911 attempts, 2.24e-5), `perf_k` table.

**The seed rule** (`suite_seed ^ (b<<40) ^ (p<<20) ^ frame`; replicate `^ (r<<48)`) matches `suite.rs`, and the definitions table matches `definitions()`.

**Constants and interfaces match `SPEC.md` and the docs.**
- Constants: M = 16, 3.125 Hz, 0.320 s, 75/54/21, Costas positions and tones, CRC 0x2443 / 0x2757, (216, 77).
- LDPC: schedule table, 150 iterations, trellis ≤ 12, dither 0.45, OSD 14 / 20 / 16 / 106, LLR clip ±25.
- Timing and receiver: `RECEIVER_PILOT_COHERENCE = 0`, window [−1.5, +25.5] s.
- `RxConfig` defaults, SIC defaults (0.4 s, ±16, 20-sample blocks), `MAX_TX_SECONDS = 40`, `SNR_VALIDATED_*` −22 / +30.
- Rig and I/O: polls 3, PTT settle 100 ms, reading stale after 6 s, rigctld timeout 1.5 s, port 4532, 70 s store, 20 s input ring, 30 s output ring, 120 s clock window, NMS 1.6 Hz / 80 ms, passes 2 and 3 within 60 Hz and ±1.6 Hz / ±0.1 s.

**Names quoted in prose exist:**
- every test name in docs/safety.md, receiver.md, ldpc.md, sic.md and development.md;
- every `Violation` variant and `CodecError` variant;
- `MissReason` variants and quoted functions and types;
- every CLI flag in the docs;
- config keys and enum spellings in wiki/15, except `dial_hz`/`tx_level` (DOC-01);
- GUI strings in wiki/14 (dial labels, "Apply and save", `export.adi`, shift-click behaviour, "measuring", Tune = one frame at the span centre, config change halts TX).

**Links:** all relative markdown links resolve except DOC-28 and the sidebar (DOC-30).

**Validation state.** Protocol, simulation, "hardware: not validated" and "on-air: not validated" are stated consistently in README, Home, wiki/01/03/06/09/13/14/16, docs/install, hardware, hardware-validation and benchmarking. `hardware-validation/results/` is empty. No marketing superlatives were found. No per-decode confidence is claimed anywhere.

**Withdrawn figures** (legacy collision table, −31.5 / −27.5 dB, −21.4 mid-latitude, −24.58 genie-aided, +4.0 dB, 1/√2 fading) appear only as explicitly withdrawn history.

**Post-remediation documentation findings:** N-01 (docs, result file and oracle docstring), N-10, N-14 (`z30-gui --version` is complete) and N-08 (bias documented in receiver.md) are fixed. N-11 is fixed everywhere except wiki/10 (DOC-07).

---

## Not checked

- Test and soak outputs quoted in prose. The tests were not run, so these were not reproduced:
  - `virtual_clock.rs` (2879 slots, 0.35 ms, 150.7 ppm);
  - `golden_demod.rs` (215/216, 0.998, 0.9995, 6.5%);
  - `channel_scenarios` SIC suppressions (31.4…39.1 dB);
  - `sictime` timings.
- Figures from audits or the oracle era:
  - M-07 figures, E013, E047, E051, the legacy 1.77 / 1.29 dB, wiki/04's 240-frame study;
  - all AP sweep counts in wiki/17 beyond arithmetic consistency (e.g. "1,266 frames");
  - the post-remediation harness figures in docs/receiver.md.
- External FT8/WSJT-X claims: −21 dB (QEX 2020), ±2.5 s DT search, `napwid`, "since v1.8".
- GUI rendering and behaviour beyond reading `crates/z30-gui/src/app.rs`, since there is no display.
- Beyond the steps listed above, the contents of `ci.yml` and `release.yml`; Windows and macOS behaviour; `legacy/**/README.md`; `VNEXT_IMPLEMENTATION_PLAN.md` beyond the §8 reference; audit files other than the two FINAL_AUDITs and the evidence files named above.
- Benchmark reproduction. No suite or perf run was made; that is `qa-reproducer`'s job.
