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
  ldpc.py                  IRA-LDPC (216, 77) encoder, min-sum decoder, CRC-14.
  acquisition.py           Blind frame acquisition from the Costas pattern.
  channel.py               AWGN and Watterson fading channel models (seeded).
  sic_decoder.py           3-pass successive interference cancellation.
  benchmark.py             Monte Carlo decode-threshold sweeps. Every number comes from here.
  rf_time_sync.py          FIR matched-filter time-station receiver (WWV/CHU/DCF77/MSF/JJY).
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
    catController.ts       Hamlib/serial CAT, PTT keying, and canTransmit() — the transmit gate.
    bandPlan.ts            IARU R1-R3 + FCC Part 97 segments and licence privileges.
    localServerApi.ts      Token-authenticated client for web_server.py.
    audioEngine.ts, qsoEngine.ts, qsoLogger.ts, rfTimeSyncEngine.ts, stationConfigStore.ts,
    seededRandom.ts, z30Constants.ts, hamlibCatalog.ts, timeUtils.ts, monteCarloEngine.ts,
    realReceiver.ts, updateEngine.ts, ratProtocols.ts
  components/              UI. WaterfallDisplay.tsx is the 60 FPS canvas; the rest are panels
                           and modals. Keep DSP out of these files.
  data/                    GENERATED — see section 3.

tests/                     pytest + node (tsx) suites. See wiki/16.
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
  path (sequencer, manual TX, tune). It **fails closed** and returns every violation. Never add
  a transmit path that bypasses it; never make it return `allowed: true` on a partial check.
- It validates: a real, non-placeholder callsign; a configured regulatory region *and* licence
  class; and **dial frequency + audio offset** inside a permitted data segment. The audio offset
  is not optional — the radiated frequency is not the dial frequency.
- `MAX_TX_SECONDS = 40` (a frame is 24 s). The browser timer, the server-side GPIO dead-man
  switch (~500 ms keepalive, ~2 s drop) and the `atexit`/`SIGTERM` pin release are three
  *independent* layers. Do not collapse them into one; each defends a different failure.

**Local API**
- Every `/api/` request in `z30_dsp/web_server.py` requires all of: the per-start bearer token
  (`X-Z30-Token`), an absent-or-exact `Origin`, and a `Host` naming this server's own loopback
  address and port. Binding to loopback is not authentication.
- No wildcard `Access-Control-Allow-Origin`, ever. Only the single configured BCM pin is
  drivable. The rigctld relay talks only to loopback daemons.

**System clock**
- Stepping the host clock stays opt-in, confirmed, bounded to 5 minutes, and refused when NTP
  owns the clock. The default is to keep the correction internally as `app_time_offset_ms`.

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
  `Math.random()` and unseeded `np.random` do not belong anywhere in that path.

**Cross-language parity**
- `z30_dsp/*.py` and `src/dsp/*.ts` implement one specification twice. A change to the codec,
  the LDPC code, the waveform or the Costas pattern must land in **both**, in the same commit.
  `tests/test_cross_language_parity.py` and `tests/crc14.test.mjs` check them against shared
  vectors in `tests/vectors/crc14_vectors.json`.

---

## 5. Honest numbers

The project has already had to retract a sensitivity claim, and the retraction is documented in
the code and the wiki on purpose. Follow the same standard:

- **`--mode realistic`** (random carrier and timing offsets, blind acquisition, receiver
  estimates its own noise floor) produces a **decode threshold**: -21.1 dB at 50%, -18.0 dB at
  90% on AWGN, 2500 Hz reference. This is the only figure comparable with other modes' published
  numbers, and it puts z-30 **level with FT8, not ahead of it**.
- **`--mode ideal`** (exact noise sigma, carrier and timing handed to the demodulator) produces
  a **genie-aided bound**: -24.6 dB. Never compare it with another mode's on-air figure. The
  3.5 dB gap is acquisition loss.
- Quote the seed, the frame count and the mode with any figure. Default seed: `20260830`.
- If a DSP change moves the threshold, update every place it appears: `wiki/16`, `wiki/03`,
  `wiki/11`, the PR checklist in `wiki/02`, `wiki/Home.md`, and the README's at-a-glance table.

Do not add marketing superlatives to documentation. This project's comments and docs explain
*why* something is the way it is, usually by naming the failure it prevents — match that voice.

---

## 6. Commands

```bash
# Python
pip install -r requirements.txt pytest
python -m pytest tests -v
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40

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
- **TypeScript is strict**, with `noUnusedLocals`. Keep DSP logic in `src/dsp/` (no DOM), UI in
  `src/components/`.
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
| Rig, CAT or PTT hardware | `src/dsp/catController.ts`, `src/dsp/hamlibCatalog.ts`, [`wiki/06`](wiki/06-Transceiver-CAT-Control-&-PTT-Wiring.md) |
| Local server or hardware API | `z30_dsp/web_server.py`, `src/dsp/localServerApi.ts`, [`wiki/13`](wiki/13-Operating-Safety-Compliance-&-Security.md) |
| UI behaviour | `src/App.tsx`, `src/components/`, [`wiki/14`](wiki/14-User-Interface-&-Operation-Reference.md) |
| Packaging or installers | `pyproject.toml`, `PKGBUILD`, `install_*.sh`, [`wiki/09`](wiki/09-Cross-Platform-Build-&-Packaging.md) |
| Benchmarks, tests, CI | `z30_dsp/benchmark.py`, `tests/`, [`wiki/16`](wiki/16-Benchmarking-Testing-&-CI.md) |
