# AGENTS.md — working context for coding assistants

Context for LLM-based coding tools (Claude Code, Copilot, Cursor, Aider, …) and for humans who
want the shape of this repository on one page. Read this before your first edit.

**Documentation authority:** the markdown under [`wiki/`](wiki/Home.md) is this project's source
of truth. `README.md` is a front page and links into it. If you learn something here that
contradicts a wiki page, the wiki page wins — and the contradiction is a bug worth fixing.

---

## 1. What z-30 is

An experimental amateur radio digital mode and the software that operates it. A 77-bit QSO
exchange is packed, CRC-14 protected, LDPC-encoded, and transmitted as a 24-second,
50 Hz-wide, continuous-phase 16-tone FSK frame inside a 30-second UTC slot. The receiver
acquires with a 21-symbol Costas pattern, demodulates non-coherently, decodes with min-sum
belief propagation, and runs up to three passes of successive interference cancellation to pull
apart colliding stations.

**This software keys real transmitters.** A defect here does not produce a stack trace; it
produces an out-of-band or stuck transmission on somebody's licence. Section 4 is not optional.

---

## 2. Repository map

```
README.md                  Front page. Introduces and links; holds no reference material.
AGENTS.md                  This file.
wiki/                      THE DOCUMENTATION. Source of truth. Also served inside the app.

z30_dsp/                   Native Python 3 DSP package (NumPy/SciPy).
  main.py                  CLI/GUI entry router behind the `z30` command.
  modem.py                 16-MFSK continuous-phase modulator/demodulator (GFSK BT=2.0).
  ldpc.py                  IRA-LDPC (216, 77) encoder, min-sum decoder, CRC-14. Also the AP
                           mask path: `decode_min_sum(..., ap_mask=)` pins asserted bits.
  ap_decode.py             A priori decoding: the hypothesis ladder ported from WSJT-X's
                           ft8b.f90, the gates, and decode_with_ap(). Twin of
                           src/dsp/apDecode.ts. See wiki/17.
  message_codec.py         The Python twin of the CALLSIGN half of z30Codec.ts - 28-bit packing
                           only. The grid table stays in TypeScript on purpose: nothing here
                           reads a grid, and a second copy is a second place to drift.
  acquisition.py           Blind frame acquisition from the Costas pattern.
  channel.py               AWGN and Watterson fading channel models (seeded).
  sic_decoder.py           3-pass successive interference cancellation.
  benchmark.py             Monte Carlo decode-threshold sweeps. Every number comes from here.
  rf_time_sync.py          FIR matched-filter time-station receiver (WWV/WWVH/WWVB/CHU/DCF77/
                           MSF/JJY). Six stations, not five - wiki/07 and both implementations
                           include WWVB.
  station_settings.py      StationConfig + SettingsManager: the config schema, the callsign and
                           grid validation rules, and JSON persistence. Split out of
                           config_wizard.py, which imports Tk at module scope and so cannot be
                           imported at all on a headless box - which put the rules the setup
                           wizard enforces beyond the reach of the test suite.
  web_server.py            Loopback HTTP server: token-authed hardware API, rigctld relay, GPIO.
  paths.py                 Per-user data dir resolution ($Z30_HOME, XDG, ~/.z30).
  auto_logger.py           ADIF 3.1.4 logbook.
  band_manager.py, config_wizard.py, gui.py, gui_tkinter.py, updater.py
  web_dist/                Committed pre-built web bundle shipped in the wheel.

src/                       Web transceiver (React 19 + TypeScript + Vite + Tailwind 4).
  dsp/                     Pure logic, no DOM. The TypeScript twin of z30_dsp.
    z30Waveform.ts         Twin of modem.py.
    z30Codec.ts            63-bit Radix-37/27 packing + CRC-14. Twin of the codec half of ldpc.py.
    ldpcCodec.ts           Twin of the LDPC half of ldpc.py.
    sicDecoder.ts          Twin of sic_decoder.py.
    apDecode.ts            Twin of ap_decode.py. Builds its asserted bits by packing a real
                           message through packZ30Message and reading them back, which is
                           WSJT-X's ft8apset exactly - the assertion cannot describe a frame
                           the transmitter would not produce.
    catController.ts       Hamlib/serial CAT, PTT keying, and canTransmit() — the transmit gate.
    bandPlan.ts            IARU R1-R3 + FCC Part 97 segments and licence privileges.
    localServerApi.ts      Token-authenticated client for web_server.py.
    rigStateTracker.ts     Closed-loop rig state: what was commanded vs what the radio reports.
                           A port of WSJT-X's PollingTransceiver/TransceiverBase model, with its
                           polls-to-stabilize rule and its measured tuning-resolution codes.
                           Transport-free and DOM-free on purpose, so the rules are testable
                           without a radio.
    audioEngine.ts, qsoEngine.ts, qsoLogger.ts, rfTimeSyncEngine.ts, stationConfigStore.ts,
    seededRandom.ts, z30Constants.ts, hamlibCatalog.ts, timeUtils.ts, monteCarloEngine.ts,
    realReceiver.ts, updateEngine.ts, ratProtocols.ts
    gridSquare.ts          Maidenhead validation and lat/lon decoding. THE one implementation -
                           there were four, and only the bounds-checked one survived.
    monteCarloEngine.ts    Browser Monte Carlo. Two measurement modes, mirroring the Python
                           benchmark's --mode; see section 5.
  components/              UI. WaterfallDisplay.tsx is the 60 FPS canvas; the rest are panels
                           and modals. Keep DSP out of these files.
  data/                    GENERATED — see section 3.

tests/                     pytest + node (tsx) suites. See wiki/16.
  transmitPath.test.mjs    Regression guards for defects that are invisible without a radio
                           attached: a PTT release that drops a different pin than the key
                           drove, a "Test PTT" that reports success without addressing the
                           hardware, and the raw rigctl console keying without the gate.
  test_config_wizard.py    The Python wizard's callsign/grid rules, driven by the same vectors
                           the TypeScript side asserts (tests/vectors/callsign_vectors.json).
  rigReadback.test.mjs     The closed-loop rig state rules: that a settled rig reporting a
                           different dial blocks transmit, and - just as important - that an
                           unverifiable rig, an unsettled QSY and a rig's own tuning resolution
                           do not.
  test_ap_decode.py, apDecode.test.mjs
                           A priori decoding. Both halves assert the same things from opposite
                           sides: that a pinned bit survives every iteration, that a hypothesis
                           naming other stations is never accepted, that AP cannot lose a frame
                           the ordinary decoder found, and that an empty mask decodes
                           bit-identically to no mask - which is what keeps every published
                           threshold describing the shipped decoder.
  test_benchmark_parallel.py
                           That `benchmark.py --workers N` is a wall-clock knob and nothing
                           else: the same curve at every worker count, at every batch size, and
                           whatever order results come back in. Also that the receive chain
                           `decode_prepared_frame` runs is a pure function of its input, which
                           is the property a worker pool rests on.
scripts/                   Build-time generators for src/data/.
public/                    PWA assets copied verbatim (sw.js, manifest, icons).
```

---

## 3. Generated files — never edit by hand

| File | Generated from | Command |
| :--- | :--- | :--- |
| `src/data/wikiArticles.ts` | `wiki/*.md` | `npm run generate:wiki` |
| `src/data/pythonSource.ts` | `z30_dsp/*.py` | `npm run generate:python-source` |

`npm run build` runs both first; `npm run check:generated` (and CI) fails if either is stale.
The browser cannot read the repository, so the in-app wiki viewer and Python source viewer need
these as strings. Both were once hand-copied snapshots and both drifted — the in-app wiki kept
showing retracted sensitivity claims for months after the markdown was corrected.

**Adding a wiki page** means: write `wiki/NN-Title.md`, register it in the `ARTICLES` array in
`scripts/generate_wiki_articles.mjs` (id, file, slug, title, category, description, tags), add it
to `wiki/Home.md` and `wiki/_Sidebar.md`, then regenerate. `slug` values are in-app routing keys
and `category` must be one of the five values in the `WikiArticle` union — do not invent a sixth.

---

## 4. Invariants you must not break

These have tests. If a change makes one of these tests fail, the change is wrong — do not edit
the test to match. Full rationale: [`wiki/13`](wiki/13-Operating-Safety-Compliance-&-Security.md).

**Transmit safety**
- `canTransmit()` in `src/dsp/catController.ts` is the single gate in front of every transmit
  path (sequencer, manual TX, tune, **and the raw rigctl console's `T 1` / `\set_ptt 1`**). It
  **fails closed** and returns every violation. Never add a transmit path that bypasses it;
  never make it return `allowed: true` on a partial check. The console reaches the gate through
  `RawConsoleTransmitContext`, which the caller supplies; with no context supplied it refuses to
  key at all rather than defaulting to permitting.
- **One keying implementation.** `setPtt()` is it. It returns whether the hardware actually
  accepted the command, and `testPttKey()` is a thin wrapper around it rather than a second
  implementation - four of nine methods in the old parallel implementation only wrote to the
  command log and returned "verified" for hardware they never addressed.
- **A release must drive what the key drove.** `setPtt(false, ...)` with no options falls back
  to the keying context, not to the hardcoded pin/host defaults. Releasing GPIO 3 on a station
  keyed on GPIO 4 leaves it transmitting, and CM108 and TCI have no server-side dead-man switch
  behind them to catch it. `tests/transmitPath.test.mjs` is the guard.
- It validates: a real, non-placeholder callsign; a configured regulatory region *and* licence
  class; and **dial frequency + audio offset** inside a permitted data segment. The audio offset
  is not optional — the radiated frequency is not the dial frequency.
- **Where the radio can be read back, the gate checks its dial against the radio's.** Every
  condition above reasons about the dial this software *commanded*: `currentFreqHz` is assigned
  from `setFreqHz()`'s argument before a byte reaches the wire and is never revised, so a refused
  `set_freq`, a hand-turned VFO or a radio switched off mid-session left the band-plan check
  validating a frequency the transmitter was not on. `RigStateTracker` (a port of WSJT-X's
  polling model) supplies the other half, and `canTransmit()` refuses a settled contradiction.
  It must go on adding refusals only: **no readback is "unverified", not "wrong"**, and neither
  an unsettled QSY (WSJT-X's `polls_to_stabilize`, three polls) nor a difference inside the rig's
  measured tuning resolution is a refusal. Weakening any of those three exclusions grounds
  stations that are working correctly, which is how a safety check ends up switched off by its
  operator. `tests/rigReadback.test.mjs` guards both directions.
- `MAX_TX_SECONDS = 40` (a frame is 24 s). The browser timer, the server-side GPIO dead-man
  switch (~500 ms keepalive, ~2 s drop) and the `atexit`/`SIGTERM` pin release are three
  *independent* layers. Do not collapse them into one; each defends a different failure.
- **rigctld traffic is serialised, and PTT deliberately is not.** `withCatLock()` in
  `catController.ts` orders frequency/mode writes against readback polls and against
  `probeRigResolution()`, which holds it for its whole run - otherwise a poll reads the probe's
  throwaway test frequency and reports it as a settled disagreement. `sendRigPtt` bypasses the
  queue on purpose: an unkey queued behind a slow read is a transmitter still radiating. Do not
  "tidy" PTT into the queue.
- **A long-running CAT operation may not clobber a QSY that lands under it.** `setFreqHz`,
  `setBandByName` and the readback-adoption path bump `dialCommandEpoch`; `probeRigResolution`
  captures it and skips its restore when it changed. Restoring unconditionally put the radio
  back on the pre-QSY dial and told the tracker that dial was commanded, so the readback check
  compared the old dial against a rig on the old dial, found agreement, and let the band-plan
  check go on validating the new one - reopening the exact hole `RigStateTracker` was added to
  close. `tests/rigProbeAndWatchdog.test.mjs` guards it.

**Local API**
- Every `/api/` request in `z30_dsp/web_server.py` requires all of: the per-start bearer token
  (`X-Z30-Token`, **header only** - never re-add the `?token=` query fallback, which leaks a
  live credential into browser history, `Referer` and request logs), an absent-or-exact
  `Origin`, and a `Host` naming this server's own loopback address and port. Binding to
  loopback is not authentication.
- No wildcard `Access-Control-Allow-Origin`, ever. Only the single configured BCM pin is
  drivable. The rigctld relay talks only to loopback daemons.

**System clock**
- Stepping the host clock stays opt-in, confirmed, bounded, and refused when NTP owns the clock.
  The default is to keep the correction internally as `app_time_offset_ms`.
- **Two bounds, not one**: 5 minutes per step *and* `MAX_OS_CLOCK_CUMULATIVE_SEC` (15 min) of
  total absolute movement per 24 h window, ledgered in `os_clock_steps`. The per-step bound is
  measured against the clock as it stands at that moment, so on its own it bounds nothing over
  time - repeated compliant steps walk the clock as far as an attacker likes. Removing the
  cumulative bound restores that.
- Confirmation is **per decode wherever a caller can ask**. A callback-less caller is the
  headless service path, where the explicit opt-in is the consent; do not make that the default
  for a caller that has a UI.

**Signal integrity**
- The waveform is continuous-phase with a **constant envelope**; the only amplitude shaping is
  one 20 ms raised-cosine ramp at each end of the frame. Per-symbol amplitude gating is
  amplitude keying at 3.125 baud and splatters — `tests/test_modem_spectrum.py` asserts both the
  99% and -40 dB occupied bandwidth budgets and asserts the gated waveform fails them.
- CRC-14: register constant `0x2443` (g(x) = x^14 + x^13 + x^10 + x^6 + x + 1, x^14 implicit),
  init `0x2757`, MSB-first. LDPC is IRA (216, 77), rate ≈ 0.356, dual-diagonal parity, degree-5
  girth-6 connection table. Costas positions and tones are fixed. Changing any of these is a
  protocol break: every station on the air stops decoding you.

**Determinism**
- Benchmarks and channel models run off seeded PRNGs (`seededRandom.ts`,
  `z30_dsp/channel.py`). CI runs the same seeded sweep twice and asserts identical results.
  `Math.random()` and unseeded `np.random` do not belong anywhere in that path. This includes
  the browser engine's random carrier and timing offsets.
- This has now been broken twice in the same shape - the LDPC dither, then `addCalibratedAwgn`,
  which fed unseeded noise into the Experimental Testing self-test and from there into the real
  `demodulateReal` -> `decodeMinSum` chain. The fix both times was to make the function a pure
  function of its input by deriving the seed from that input (`ditherSeedFromLlrs`,
  `awgnSeedFromWaveform`), because threading a seed only fixes the caller that has one. Prefer
  that pattern over adding a seed parameter and hoping every caller passes it.
  `tests/dspDeterminism.test.mjs` asserts byte-identical output across runs *and* measures the
  noise's variance and Gaussian shape off the samples, so "deterministic" cannot be satisfied
  by returning a constant.
- **Determinism has to survive a worker count, not just a rerun.** `benchmark.py --workers N`
  spreads frame *decoding* over processes, and the curve it produces is identical at every N.
  It is identical because the split is drawn along the PRNG: `_prepare_frame` consumes the one
  shared generator, in the original order, on the main process, and `decode_prepared_frame`
  consumes nothing and is a pure function of the buffer handed to it. Deriving a per-frame seed
  instead - the obvious design - parallelises more and draws different numbers, which moves
  every published threshold in wiki/16 for a wall-clock gain. Do not take that trade. Results
  are filed by frame index and reduced in index order, never in completion order.
  `tests/test_benchmark_parallel.py` and the CI benchmark smoke test both assert it.

**A priori decoding**
- AP asserts message bits the receiver did not measure, so it is the one place in this decoder
  where an assumption can become a logged QSO. Three rules keep that honest, and
  `tests/test_ap_decode.py` / `tests/apDecode.test.mjs` guard all three.
- **AP never runs first.** `decode_with_ap` attempts the ordinary decode and returns it
  untouched when it succeeds. AP may add decodes; it may not change or lose one. Reordering
  those two steps would make every published threshold in wiki/16 a measurement of a different
  decoder.
- **A frame recovered by AP is labelled.** `apType` travels out to `DecodedSignal` and the
  activity log shows `a1`…`a6`. WSJT-X prints its `iaptype` for the same reason: a frame that
  only closed because the receiver assumed your callsign was in it is a weaker claim than one
  that closed without help. Do not drop the tag to tidy a UI.
- **The gates only ever narrow.** The callsign round-trip check (WSJT-X's `ft8apset`
  `msg.eq.msgchk`), the `AP_FREQ_WINDOW_HZ = 75` window on types 3+ (its `napwid`), and AP being
  off by default all exist because each hypothesis is another 2^-14 roll of the CRC dice.
  Loosening one raises the false-accept rate of a mode that keys real transmitters.
- An AP-less decode must stay **bit-identical**: `decode_min_sum(llr)` and
  `decode_min_sum(llr, ap_mask=zeros)` produce the same bits, the same iteration count and the
  same syndrome. The mask must never reach the 14 CRC bits either - the CRC is the only thing
  testing the hypothesis, and asserting it would make every hypothesis "succeed".

**One source of truth per rule**
- `isValidCallsign()` in `src/dsp/bandPlan.ts` is the only callsign validator in TypeScript, and
  `z30_dsp/station_settings.py` carries the same pattern. Shared cases live in
  `tests/vectors/callsign_vectors.json` and are asserted from both languages. Three looser
  copies used to disagree with the gate, so the setup wizard blessed callsigns that could not
  transmit. Same story for `src/dsp/gridSquare.ts` and Maidenhead decoding.
- UI prose quotes constants, it does not retype them - `LDPC_MAX_ITERATIONS`, `Z30_LDPC_PARAMS`,
  `Z30_SPECS`. SpecsModal said "up to 50 iterations" for years while both codecs stopped at 45,
  and Settings printed FT8's `(174, 91)` as z-30's code.

**Cross-language parity**
- `z30_dsp/*.py` and `src/dsp/*.ts` implement one specification twice. A change to the codec,
  the LDPC code, the waveform or the Costas pattern must land in **both**, in the same commit.
  `tests/test_cross_language_parity.py` and `tests/crc14.test.mjs` check them against shared
  vectors in `tests/vectors/crc14_vectors.json`.
- That test now also pins the Costas pattern itself (`SYNC_POSITIONS`/`SYNC_TONES` - which
  AGENTS.md calls protocol-breaking to change, and which previously agreed only because nobody
  had edited one copy), the OSD-2/Chase acceptance thresholds, `LDPC_MAX_ITERATIONS`, and the
  SIC candidate-detection constants. Agreement by inspection is not a guarantee; add the pin
  when you add the constant.

---

## 5. Honest numbers

The project has already had to retract a sensitivity claim, and the retraction is documented in
the code and the wiki on purpose. Follow the same standard:

- **`--mode realistic`** (random carrier and timing offsets, blind acquisition, non-coherent
  demodulation, receiver estimates its own noise floor) produces a **decode threshold**:
  -23.1 dB at 50%, -21.7 dB at 90% on AWGN, 2500 Hz reference. This is the only figure
  comparable with other modes' published numbers. It is **2.1 dB deeper than FT8's -21.0 dB,
  bought with 2.8 dB more airtime (24.0 s against 12.64 s) and 14 fewer message bits** - quote
  both halves or neither.
- **`--mode ideal`** (exact noise sigma, carrier and timing handed to the demodulator) produces
  a **genie-aided bound**: -24.6 dB. Never compare it with another mode's on-air figure. The
  1.5 dB gap is acquisition loss.
- Quote the seed, the frame count and the mode with any figure. Default seed: `20260830`.
- **`z30_dsp/benchmark.py` is the reference instrument.** The in-app benchmark
  (`src/dsp/monteCarloEngine.ts`, Station Settings -> 5. Experimental Testing) runs the same two
  modes, defaults to `realistic` too, and now models the same receiver: `SLOT_SEARCH_MARGIN_SEC`
  and `REALISTIC_PILOT_COHERENCE` are shared constants, pinned across the two languages by
  `tests/test_cross_language_parity.py`. The two land 0.1 dB apart on the AWGN threshold at the
  same seed. It used to read 1.8 dB more optimistic, which `wiki/16` blamed on a narrower timing
  window; measured paired, the timing window accounted for none of it and the Python side's
  semi-coherent demodulator term accounted for all of it. Agreement is still not authority: use
  the browser engine to see which way a change moved the curve, and confirm with a seeded Python
  run before any number reaches documentation.
  [`wiki/16`](wiki/16-Benchmarking-Testing-&-CI.md) has the side-by-side table.
- **The SIC collision figures were withdrawn on 2026-09-01.** `wiki/05` carried a table of
  decode rates (98.7 / 95.2 / 91.4 / 84.6 %) at four collision differentials, `wiki/11` claimed
  recovery "down to -31.5 dB" and a residual decode floor of "-25.0 / -24.0 dB". None came from
  any instrument here: `benchmark.py` has no collision or SIC mode at all. Restoring any of them
  needs that mode built first, then a seeded sweep quoted with seed, frame count, channel model
  and a checkable confidence figure. Until then the collision performance is **not measured** -
  say that, rather than picking a plausible number.
- **The word "threshold" is reserved for `realistic`.** No UI string, comment or document may
  call an `ideal`-mode result a threshold, and nothing may compute a z-30-vs-other-mode delta
  from one. A "Gain vs FT8" tile that subtracted a bound from FT8's on-air figure is how the
  withdrawn "+4.0 dB advantage" claim came back into the app after the wiki had retracted it.
- If a DSP change moves the threshold, update every place it appears: `wiki/16`, `wiki/03`,
  `wiki/11`, the PR checklist in `wiki/02`, `wiki/Home.md`, and the README's at-a-glance table.

**Benchmarks and test suites are the only challengers of the wiki.**

- A benchmark or test result is allowed to overturn a wiki claim — that is what they are for.
  `wiki/16` used to state that the Python decoder ran a single min-sum schedule while the browser
  ran three; a seeded, paired benchmark showed both languages have always run the same
  four-schedule cascade, and that the cascade decodes strictly more frames than the
  single-schedule design the wiki described. The wiki was wrong and got fixed — see
  [`wiki/16`](wiki/16-Benchmarking-Testing-&-CI.md#-a-worked-example-a-benchmark-challenging-the-wiki)
  for the worked example. But a result only earns that authority once it clears **greater than
  95% confidence that it is comparable to a real-world application** — a controlled, paired
  comparison at a realistic operating point (an SNR the mode actually has to work at, a
  configuration a station would actually run), not a single anecdotal pass or a synthetic case
  that flatters one side. Quote the method, the seed and the sample size next to the confidence
  figure, the same way section 5 already requires for a sensitivity number.
- Nothing may alter a benchmark or a test suite to manufacture a result. No moving a threshold,
  seed, sample size, SNR range, iteration cap, or exit condition to make an outcome come out a
  particular way, and no cherry-picking a favourable run and discarding the rest. Because
  benchmarks and test suites are the *only* sanctioned way to challenge the wiki, gaming one is
  equivalent to forging the project's own source of truth. Any benchmark or test-suite result
  used to justify changing the wiki, the code, or a published figure must clear **99% or greater
  confidence that it is comparable to real-world behaviour** before anyone treats it as settled —
  state that confidence figure (an exact p-value, a confidence interval — something a reader can
  check, not an adjective) alongside the result.

Do not add marketing superlatives to documentation. This project's comments and docs explain
*why* something is the way it is, usually by naming the failure it prevents — match that voice.

---

## 6. Commands

```bash
# Python
pip install -r requirements.txt pytest
python -m pytest tests -v
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40
# Same curve, spread over processes. --workers 0 means one per CPU; the default is 1 (serial).
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40 --workers 0
# Paired a priori comparison: every frame decoded twice off one demodulation, exact McNemar test.
python -m z30_dsp.benchmark --ap --mode realistic --fading none --min-snr -26.5 --max-snr -21.5 --frames 80

# TypeScript / web
npm ci
npm run lint          # tsc --noEmit, strict + noUnusedLocals
npm run test:ts       # tests/crc14.test.mjs and tests/frontend.test.mjs via tsx
npm run generate      # refresh src/data/*.ts after editing wiki/ or z30_dsp/
npm run check:generated
npm run build         # generate + vite build
npm run dev           # Vite dev server on :3000

# Run the app
python -m z30_dsp.main        # web transceiver
z30 --wizard | --sync | --bands | --tkinter | --benchmark
```

CI (`.github/workflows/ci.yml`) runs the Python suite on 3.10 and 3.12, a wheel build-and-import
check, the seeded benchmark reproducibility check, `check:generated`, typecheck, TS tests, the
production build, a PWA asset check, and hygiene checks (LICENSE present, no tracked build
artifacts or bytecode, exactly one lockfile).

---

## 7. House rules

- **Python 3.9 is the floor.** No `match`, no PEP 604 `X | Y` annotations at runtime, no
  `dict[str, int]` builtins in annotations without `from __future__ import annotations`.
  Runtime dependencies are NumPy, SciPy, sounddevice, pyserial, cffi, requests — adding one is a
  decision, not a convenience.
- **TypeScript is strict**, with `noUnusedLocals` **and `noUnusedParameters`**. Keep DSP logic in
  `src/dsp/` (no DOM), UI in `src/components/`. Note that tsc does **not** flag a prop that is
  declared and never destructured, so an interface can accumulate callbacks that cannot possibly
  fire - `RigControlPanel` rendered a read-only faceplate for months with five working handlers
  wired to it from `App.tsx`, and `QsoController` carried seven. If you add a prop, destructure
  it and use it in the same commit.
- **Comments explain why, not what.** The existing ones frequently name the bug they prevent;
  when you fix something subtle, leave that kind of note behind.
- **Conventional commits**: `feat(dsp):`, `fix(cat):`, `docs(wiki):`. Branches:
  `feature/…`, `fix/…`, `docs/…`.
- **Never commit**: build artifacts, `__pycache__`, a second lockfile, a real `.env`, or a
  personal `~/.z30/config.json`. CI rejects the first three.
- **Do not "fix" a failing safety test by weakening it.** Explain in the pull request why the
  guarantee still holds, or change the code instead.
- **Documentation edits go in `wiki/`**, not the README, and are regenerated into
  `src/data/wikiArticles.ts` in the same commit.

---

## 8. Where to look first

| Task | Start at |
| :--- | :--- |
| Anything touching transmit | `src/dsp/catController.ts`, `src/dsp/bandPlan.ts`, [`wiki/13`](wiki/13-Operating-Safety-Compliance-&-Security.md) |
| Waveform or demodulation | `z30_dsp/modem.py`, `src/dsp/z30Waveform.ts`, [`wiki/03`](wiki/03-DSP-&-Physical-Layer-Specification.md) |
| Codec, CRC or LDPC | `z30_dsp/ldpc.py`, `src/dsp/z30Codec.ts`, `src/dsp/ldpcCodec.ts`, [`wiki/04`](wiki/04-Forward-Error-Correction-&-LDPC.md) |
| Collision handling | `z30_dsp/sic_decoder.py`, `src/dsp/sicDecoder.ts`, [`wiki/05`](wiki/05-Successive-Interference-Cancellation-(SIC).md) |
| A priori (AP) decoding | `z30_dsp/ap_decode.py`, `src/dsp/apDecode.ts`, [`wiki/17`](wiki/17-A-Priori-(AP)-Decoding.md) |
| Rig, CAT or PTT hardware | `src/dsp/catController.ts`, `src/dsp/hamlibCatalog.ts`, [`wiki/06`](wiki/06-Transceiver-CAT-Control-&-PTT-Wiring.md) |
| Local server or hardware API | `z30_dsp/web_server.py`, `src/dsp/localServerApi.ts`, [`wiki/13`](wiki/13-Operating-Safety-Compliance-&-Security.md) |
| UI behaviour | `src/App.tsx`, `src/components/`, [`wiki/14`](wiki/14-User-Interface-&-Operation-Reference.md) |
| Packaging or installers | `pyproject.toml`, `PKGBUILD`, `install_*.sh`, [`wiki/09`](wiki/09-Cross-Platform-Build-&-Packaging.md) |
| Benchmarks, tests, CI | `z30_dsp/benchmark.py`, `src/dsp/monteCarloEngine.ts`, `tests/`, [`wiki/16`](wiki/16-Benchmarking-Testing-&-CI.md) |
| Callsign / grid validation | `src/dsp/bandPlan.ts`, `src/dsp/gridSquare.ts`, `z30_dsp/station_settings.py`, `tests/vectors/callsign_vectors.json` |
| Logbook and exports | `src/dsp/qsoLogger.ts`, `src/components/LogbookModal.tsx`, [`wiki/14`](wiki/14-User-Interface-&-Operation-Reference.md) |
