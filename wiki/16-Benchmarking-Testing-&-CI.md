# 16. Benchmarking, Testing & Continuous Integration

How z-30's numbers are produced, how to reproduce them, and what the test suite is defending.
**Any sensitivity figure quoted anywhere in this project must come from a seeded run of the
benchmark described here, and must say which mode produced it.**

---

## 🎲 The two benchmark modes, and why the difference matters

**`--mode realistic` (default) measures a decode threshold.** Every frame gets a random carrier
offset and a random timing offset, and optionally Watterson HF fading. The receiver is then
handed nothing but audio: it locates the frame using only the 21 Costas sync symbols
(`z30_dsp/acquisition.py`), estimates the noise floor from the spectrum itself, and decodes
from whatever it found. **This is the number that is comparable with other modes' published
on-air figures.**

**`--mode ideal` measures a genie-aided bound, which is not a threshold.** The demodulator is
handed the exact noise sigma, the exact carrier frequency and perfect symbol timing, on a clean
channel. It bounds what the code can do under ideal detection, and nothing more.

Earlier revisions of the project's documentation quoted the `ideal` number against FT8's on-air
-21 dB and concluded a "+4.0 dB link margin advantage". That comparison did not hold and has
been withdrawn. Both curves are now measured, and the gap between them is the answer to why.

---

## 📉 The measured set

Seed `20260830`, 2500 Hz reference bandwidth, carrier offset ±5 Hz, timing offset ±0.5 s:

| Channel | Frames/point | 50% decode | 90% decode |
| :--- | ---: | :--- | :--- |
| Idealised AWGN bound (genie-aided sync — **not** an on-air figure) | 40 | -24.6 dB | -23.4 dB |
| AWGN, blind acquisition | 40 | **-23.1 dB** | **-21.7 dB** |
| CCIR *moderate* fading (1.0 ms / 0.5 Hz), blind acquisition | 100 | -21.3 dB | -19.5 dB |
| CCIR *poor* fading (2.0 ms / 1.0 Hz), blind acquisition | 100 | -21.3 dB | -19.0 dB |

**1.5 dB of the bound is spent simply finding the signal.** That gap is the acquisition loss —
what it costs to *find* the signal rather than be told where it is. Any mode's genie-aided
bound is optimistic by a similar margin, which is why the two must never be compared across
that line. See
[11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) for what
this does and does not mean against FT8.

**The two fading presets are not separable at the 50% point, and the table says so rather than
printing two numbers that look different.** They were re-measured at 100 frames per point
precisely because 40 frames could not tell them apart: at -21 dB the moderate preset decoded
57/100 (Wilson 95% CI 47.2–66.3%) and the poor preset 65/100 (55.2–73.6%), intervals that
overlap across most of their range. Both interpolate to -21.3 dB. The 90% points do separate,
in the expected direction, by 0.5 dB.

Why the two presets are so close has **not** been measured and no mechanism is claimed here.
What can be said without measuring anything is arithmetic from the preset parameters: a 1.0 ms
and a 2.0 ms delay spread give coherence bandwidths of roughly 160 Hz and 80 Hz, both far wider
than z-30's 50 Hz occupied bandwidth, so neither preset is frequency-selective across this
signal. That leaves Doppler spread (0.5 vs 1.0 Hz) as the parameter that differs in a way the
waveform can see. Whether that accounts for the result is a question for a benchmark, not for
this paragraph.

---

## 🔁 Reproducing the curves

Every run is seeded, so these are reproducible rather than anecdotal — record the seed with any
figure you publish:

```bash
# The honest curve (the default).
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40

# On a disturbed ionospheric path. 100 frames, because 40 could not separate the two presets.
python -m z30_dsp.benchmark --mode realistic --fading moderate --min-snr -23 --max-snr -17 --frames 100
python -m z30_dsp.benchmark --mode realistic --fading poor     --min-snr -23 --max-snr -17 --frames 100

# The genie-aided bound, for comparison only.
python -m z30_dsp.benchmark --mode ideal --min-snr -30 --max-snr -20 --frames 40
```

Sample output from the default mode:

```
================================================================================================
  z-30 DECODE THRESHOLD (blind acquisition through the real receive chain)
  Carrier offset +/-5.0 Hz | timing offset +/-0.50 s | fading: No fading (AWGN only) (0.0 ms / 0.0 Hz)
  The receiver is given only audio: it finds the frame and estimates the noise itself.
  40 frames/point | Sample Rate: 6000 Hz | Max Iterations: 45 | Seed: 20260830
================================================================================================
SNR (2500Hz)   | Frames  | Success  | FER       | Decode %  | Avg Iters  | Acq fail | Timing RMS  | Freq RMS
------------------------------------------------------------------------------------------------
 -28.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 15       |    311.3 ms |   4.61 Hz
 -27.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 3        |    190.0 ms |   2.41 Hz
 -26.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 1        |    124.4 ms |   2.24 Hz
 -25.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 1        |    144.7 ms |   0.83 Hz
 -24.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 0        |     17.8 ms |   0.32 Hz
 -23.0 dB      | 40      | 22       | 0.4500    |    55.0%  |   77.6     | 0        |     13.7 ms |   0.18 Hz  <-- 50% crossing interpolates to -23.1 dB
 -22.0 dB      | 40      | 34       | 0.1500    |    85.0%  |   24.9     | 0        |     13.5 ms |   0.18 Hz
 -21.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.2     | 0        |      9.6 ms |   0.14 Hz  <-- 90% crossing interpolates to -21.7 dB
 -20.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.1     | 0        |      7.2 ms |   0.12 Hz
 -19.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.0     | 0        |      7.5 ms |   0.10 Hz
 -18.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.0     | 0        |      4.4 ms |   0.09 Hz
 -17.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    1.0     | 0        |      3.9 ms |   0.07 Hz
================================================================================================
```

The `Acq fail`, `Timing RMS` and `Freq RMS` columns report the acquisition stage's own error —
how often it landed more than half a symbol away, and how far off it was in time and frequency.
Below about -24 dB the sync pattern stops being findable at all, and that shows up in those
columns rather than being hidden inside the frame error rate.

---

## 🖥️ The in-app benchmark, and why it now agrees with the Python one

**Station Settings → 5. Experimental Testing → Launch Benchmark Suite** runs the same two modes
in the browser, over `src/dsp/monteCarloEngine.ts`. It has a **Measurement mode** selector, and
it defaults to `realistic` for the same reason the Python benchmark does.

In realistic mode the browser engine gives every frame a random carrier offset (±5 Hz) and
timing offset (±0.5 s), searches for the frame using only the 21 Costas symbols
(`acquireFrame`), estimates the noise floor from the audio itself (`estimateNoiseSigma`), and
counts a frame it cannot find as a failure. The `Acq Fail`, `Timing RMS` and `Freq RMS` columns
of the results table are the same diagnostics the Python table carries.

The two engines model the same receiver, and the two constants that say so are shared and
pinned by `tests/test_cross_language_parity.py`:

| Constant | Value | What it fixes |
| :--- | :--- | :--- |
| `SLOT_SEARCH_MARGIN_SEC` | 0.05 s | The timing search half-width is the station's timing uncertainty plus this margin — ±0.55 s at the default ±0.5 s offset. z-30 is slot-synchronised, so a real receiver knows where the frame should start and searches a window, not an arbitrary stream. |
| `REALISTIC_PILOT_COHERENCE` | 0.0 | Purely non-coherent demodulation, which is what z-30's receiver is specified to be. `ideal` mode keeps the pilot-adaptive weight, because it is handed perfect timing. |

Measured at seed `20260830`, 40 frames per point, AWGN:

| | Python (`z30_dsp/benchmark.py`) | Browser (`monteCarloEngine.ts`) |
| :--- | :--- | :--- |
| Genie-aided bound, 50% | -24.6 dB | ≈ -24.2 dB |
| AWGN blind acquisition, 50% | **-23.1 dB** | **-23.0 dB** |

> **Correction (2026-08-31, second revision):** this page used to publish that same row as
> **-21.1 dB** against **≈ -22.9 dB** and explain the 1.8 dB gap by saying the browser searched a
> narrower timing window. That explanation was wrong, and so was the Python figure.
>
> Both were tested paired — the identical frame, fading realisation, carrier offset, timing
> offset and noise decoded twice, changing one thing at a time:
>
> - **Timing search width** (full-stream vs slot-synchronised), 200 frames from -26 to -22 dB:
>   **zero discordant decodes**, exact two-sided McNemar p = 1. The search width accounted for
>   none of the gap.
> - **Demodulator coherent weight** (pilot-adaptive 0.35–0.85 vs zero), 160 frames from -24 to
>   -21 dB: **59 discordant pairs, 55 won by the non-coherent receiver and 4 by the
>   semi-coherent one**, exact two-sided McNemar p = 1.7×10⁻¹² — greater than 99.9999999%
>   confidence, clearing the ≥99% bar [`AGENTS.md` §5](../AGENTS.md#5-honest-numbers) sets for a
>   result that changes a published figure.
>
> The Python benchmark had been applying a pilot-aided semi-coherent term through the whole
> realistic path. Under the timing error that blind acquisition actually leaves, a few
> milliseconds rotates each tone by $2\pi f \Delta t$, so that term is measured against the wrong
> phase reference and cancels signal instead of reinforcing it. The browser engine had already
> been dropping it. **The Python benchmark was measuring a receiver worse than the one z-30
> specifies, and the published threshold was 2.0 dB pessimistic as a result.**
>
> The trade-off side is recorded rather than left out: at -24 dB, below the point where the
> Costas pattern is reliably findable, both receivers are near zero and the semi-coherent one
> took that point 3–0. The full per-point table is in the `REALISTIC_PILOT_COHERENCE` comment in
> `z30_dsp/benchmark.py`.

Both engines now run the same receiver model and land 0.1 dB apart on the threshold, which is
inside the sampling noise of 40 frames per point. **The Python benchmark is still the
reference**: it is the one CI runs, the one the seed defaults are pinned to, and the one whose
output the tables above are copied from. Use the browser engine to see which way a change moved
the curve without leaving the app; confirm with a seeded Python run before a number reaches
documentation.

One thing the browser engine is *not* free to differ on: `ideal` and `realistic` mean exactly
what they mean here. A browser run in `ideal` mode is a bound, is labelled a bound in the UI,
and the FT8 overlay is off by default and marked not-comparable when switched on.

---

## 🔬 A worked example: a benchmark challenging the wiki

This is the case the rule in [`AGENTS.md` §5](../AGENTS.md#5-honest-numbers) ("benchmarks and
test suites are the only challengers of the wiki") exists to generalise.

While auditing the mismatch corrected above, the question was: which is actually the better
decoder design - the single normalized min-sum schedule this page (wrongly) described, or the
four-schedule cascade both codebases actually ship? That is answerable, and it was answered with
a benchmark rather than an opinion:

- A faithful, from-scratch reimplementation of the single-schedule design ($\alpha = 0.75$,
  layered, forward-order, 45-iteration cap, no SPA/reverse/dither/Trellis-IRA step) was built
  from this page's own prior text.
- It was run **paired** against the real `Z30LdpcCodec.decode_min_sum` - the identical frame,
  waveform and channel noise handed to both decoders in the same trial, seeded from
  `DEFAULT_BENCHMARK_SEED` (`20260830`) - at SNR −24, −25 and −26 dB (2500 Hz reference, ideal
  synchronisation), 80 frames per point.
- Pairing turns every trial where the two decoders disagree into one vote for whichever design
  decoded that frame. Across all three points: **23 disagreements, 23 of them won by the
  cascade, 0 won by the single schedule.**

| SNR | Frames | Cascade decode % | Single-schedule decode % | Cascade-only wins | Single-only wins |
| :-- | --: | --: | --: | --: | --: |
| −24 dB | 80 | 76.2% | 65.0% | 9 | 0 |
| −25 dB | 80 | 27.5% | 15.0% | 10 | 0 |
| −26 dB | 80 | 5.0% | 0.0% | 4 | 0 |

An exact two-sided McNemar test on the pooled 23 discordant pairs (23 vs. 0) gives
**p ≈ 4×10⁻⁷ — greater than 99.9999% confidence** that the cascade decodes more frames than the
single schedule at these operating points, comfortably clearing the ≥99% bar `AGENTS.md` §5 sets
for a result that changes the wiki. The trade-off side of that same result was recorded rather
than left out: the cascade also costs 2-3× more iterations per frame near threshold (an average
of 112.6 vs 40.5 iterations at −25 dB), which matters against the 4.5 s decode-plus-SIC budget in
[03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md).

The result: the wiki was corrected (this page and
[04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md)), not the decoder.
Nobody proposed reverting the code to match old documentation once the documentation was shown to
describe the worse design.

---

## 🧪 The test suite

```bash
# Python DSP suite
pip install -r requirements.txt pytest
python -m pytest tests -v

# TypeScript: typecheck (strict mode is on, with noUnusedLocals AND noUnusedParameters) plus
# the codec, DSP module and transmit-path tests
npm ci
npm run lint
npm run test:ts

# Production web bundle (regenerates the embedded Python source and wiki articles first)
npm run build
```

What the suite covers, and why each test is there:

| Test | Guards against |
| :--- | :--- |
| `tests/test_ldpc_codec.py` | An encoder that disagrees with its own parity-check matrix, a connection table that loses its girth-6 property, a CRC that stops detecting single-bit errors |
| `tests/test_modem_spectrum.py` | A transmitter that splatters. Asserts the 99% occupied bandwidth and the -40 dB bandwidth against fixed budgets, and asserts that the old per-symbol-gated waveform **fails** them, so the test can demonstrably tell the difference |
| `tests/test_channel_acquisition.py` | A channel model or acquisition stage that stops being reproducible under a fixed seed |
| `tests/test_cross_language_parity.py` and `tests/crc14.test.mjs` | The Python and TypeScript codecs silently drifting apart — each half keeps working perfectly on its own while losing the ability to decode the other. Shared known-answer vectors live in `tests/vectors/crc14_vectors.json` |
| `tests/test_web_server_api.py` | The local API losing its token, `Origin` or `Host` checks; the GPIO pin whitelist; the PTT dead-man switch actually releasing |
| `tests/test_time_sync_guards.py` | The system clock becoming settable by default, or an unbounded step from a spoofed time signal |
| `tests/frontend.test.mjs` | The transmit gate admitting an out-of-band frequency, an unseeded benchmark PRNG, an amplitude-gated waveform, unvalidated station config, Maidenhead decoding, and the browser benchmark's acquisition stage (that it finds a displaced frame, estimates its own noise floor, refuses to "find" one in pure noise, and reproduces its offsets from the seed) |
| `tests/transmitPath.test.mjs` | The three defects that only appear with a radio attached: a PTT release that drops a different pin than the key drove, a "Test PTT" that reports success without addressing the hardware, and the raw rigctl console keying without the transmit gate. Also the rigctl verb table, where case is significant |
| `tests/test_config_wizard.py` and `tests/frontend.test.mjs` | The Python setup wizard and the browser transmit gate disagreeing about which callsigns are valid — a wizard that blesses a callsign the gate will refuse at slot start. Shared vectors in `tests/vectors/callsign_vectors.json` |
| `tests/rigReadback.test.mjs` | `RigStateTracker`, the WSJT-X-ported closed-loop rig model that `AGENTS.md` §4 names explicitly. Guards both directions: that a settled rig reporting a different dial blocks transmit, and that an unverifiable rig, an unsettled QSY and a difference inside the rig's measured tuning resolution do **not** — a check that grounds correctly-working stations is one its operator switches off |
| `tests/rigProbeAndWatchdog.test.mjs` | The CAT defects that only appear when two things happen at once, plus the timers nothing ever let run: the tuning-resolution classification table, a QSY landing mid-probe (which used to be undone on the wire while the tracker was told the pre-QSY dial), a poll reading the probe's throwaway test frequency as a fault, `pollRigOnce()` driven through the real controller rather than by poking the tracker, and the `MAX_TX_SECONDS` watchdog actually firing and unkeying the hardware |
| `tests/dspDeterminism.test.mjs` | An unseeded generator anywhere the decode path can reach — the defect class that has now recurred twice, in the LDPC dither and again in `addCalibratedAwgn`. Asserts byte-identical output across two runs, and checks the noise is still *calibrated* noise by measuring its variance and Gaussian shape off the produced samples, so "deterministic" cannot be achieved by returning a constant |
| `tests/test_sic_candidate_detection.py` | The SIC candidate detector inventing carriers out of noise, and the two languages' detectors diverging again. The raw-bin detector this replaced produced ~52 spurious candidates per frame from pure noise |
| `tests/test_git_sync.py` | The updater doing anything other than a fast-forward — a self-update that could discard an operator's local changes or move the checkout to an unrelated history |
| `tests/test_updater_cli.py` | The layer above that engine: `run_updater` turning a `SyncStatus` into the wrong exit code, so a startup script never notices the box is behind or reports failure forever on a current one — and an interrupted prompt or a closed stdin being read as consent to update |
| `tests/test_band_manager.py` | Band-preset persistence, dial-to-band detection across every shipped preset, and `tune_radio()` reporting success when the rig took the QSY but refused the mode change |
| `tests/test_legacy_logger_and_config.py` | The Python-side twins of jobs the web UI already does correctly, and which were therefore never covered: the Tk-path ADIF writer emitting a literal backslash-n instead of a newline, `<TAG:len>` prefixes counting characters instead of UTF-8 bytes, and a station-config save that could truncate `config.json` — which `load_config` then silently replaces with defaults, emptying the callsign the transmit gate needs |

---

## 🤖 What CI enforces

`.github/workflows/ci.yml` runs on every push and pull request:

- **Python DSP suite** on 3.10, 3.12 and 3.13, plus a wheel build-and-import check. Dependencies
  are installed from the pinned `requirements.txt`, not a bare `pip install numpy scipy`: CI that
  resolves different versions from the ones operators install is not testing the software they
  run, and this is a suite whose numerical behaviour depends on those versions.
- **Ruff** over `z30_dsp/`, `tests/` and `scripts/`, at a pinned version with a rule set pinned
  in `pyproject.toml` (`select = ["E4", "E7", "E9", "F"]`, `target-version = "py39"`).
  Conservative on purpose: a linter that shouts about formatting is one contributors learn to
  ignore. It earned its place immediately — the unused-variable rule found
  `band_manager.tune_radio()` discarding the CAT mode-set result.

  Both pins matter, and the first CI run proved why: an unpinned `pip install ruff` fetched
  0.16.5, whose default rule set is far wider than 0.15's, and reported 408 findings against a
  tree that was clean locally. Worse, those defaults include `UP006`/`UP035` ("use `dict`
  instead of `Dict`") — taking that advice would break the **Python 3.9 floor** in
  `AGENTS.md` §7, since builtin generics in annotations are evaluated at runtime without
  `from __future__ import annotations`. A tool whose meaning changes when it releases is not a
  check, and one that pushes code past the project's stated support floor is worse than none.
  Bump the version and the rule set deliberately, together, as with any other pin here.
- **Dependency audit**: `pip-audit` against the pinned `requirements.txt` and `npm audit` at
  high severity. Pinning exact versions is right for a DSP suite and it also means nothing
  otherwise reports when a pin picks up a known vulnerability. `.github/dependabot.yml` opens
  grouped monthly bump PRs for the same reason.
- **Packaging smoke on Windows and macOS**: the suite plus a wheel build-and-import. Every other
  job runs on `ubuntu-latest`, so a change that broke the package on the platform the project
  ships a PyInstaller build for was found by whoever installed it. This does not build
  installers — it catches path and platform-API mistakes, which is the cheap half.
- **Benchmark smoke test**: a short seeded sweep in both modes, run twice, asserting identical
  results. This catches non-determinism in the channel/acquisition path, which would otherwise
  only surface when someone tried to reproduce a published curve.
- **Generated sources are up to date** (`npm run check:generated`): `src/data/pythonSource.ts`
  and `src/data/wikiArticles.ts` are produced from the real Python files and the markdown in
  `wiki/`. Both were once hand-copied snapshots that drifted — the in-app wiki still showed
  retracted sensitivity claims long after the markdown was corrected.
- **Typecheck, TypeScript tests and the production web build.**
- **PWA assets**: `sw.js`, `manifest.json` and both icons must be present in the build, and the
  service-worker cache name must be build-stamped rather than left as the placeholder.
- **Repository hygiene**: a LICENSE file containing the MIT text, no tracked build artifacts or
  bytecode, and exactly one JavaScript lockfile.

---

## ✅ Before you publish a number

1. Run the benchmark seeded, and quote the seed, frame count and mode alongside the figure.
2. Never compare a `--mode ideal` figure with another mode's published on-air threshold.
3. If a DSP change moves the threshold, update **every** place the figure appears: this page,
   [03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md),
   [11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md),
   the pull request checklist in
   [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md),
   `Home.md`, and the summary line in the repository `README.md`.
4. Regenerate the in-app copy afterwards (`npm run generate:wiki`), or CI will fail.
