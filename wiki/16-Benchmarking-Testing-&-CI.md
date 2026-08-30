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

Seed `20260830`, 40 frames per SNR point, 2500 Hz reference bandwidth, carrier offset ±5 Hz,
timing offset ±0.5 s:

| Channel | 50% decode | 90% decode |
| :--- | :--- | :--- |
| Idealised AWGN bound (genie-aided sync — **not** an on-air figure) | -24.6 dB | -23.4 dB |
| AWGN, blind acquisition | **-21.1 dB** | **-18.0 dB** |
| CCIR *moderate* fading (1.0 ms / 0.5 Hz), blind acquisition | -18.8 dB | -14.0 dB |
| CCIR *poor* fading (2.0 ms / 1.0 Hz), blind acquisition | -15.4 dB | above -11 dB |

**3.5 dB of the bound is spent simply finding the signal.** That gap is the acquisition loss —
what it costs to *find* the signal rather than be told where it is. Any mode's genie-aided
bound is optimistic by a similar margin, which is why the two must never be compared across
that line. See
[11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) for what
this does and does not mean against FT8.

---

## 🔁 Reproducing the curves

Every run is seeded, so these are reproducible rather than anecdotal — record the seed with any
figure you publish:

```bash
# The honest curve (the default).
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40

# On a disturbed ionospheric path.
python -m z30_dsp.benchmark --mode realistic --fading moderate --min-snr -25 --max-snr -13 --frames 40

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
 -28.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 25       |   1330.7 ms |   6.19 Hz
 -27.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 17       |   1251.3 ms |   5.06 Hz
 -26.0 dB      | 40      | 0        | 1.0000    |     0.0%  |  150.0     | 3        |    281.3 ms |   3.46 Hz
 -25.0 dB      | 40      | 3        | 0.9250    |     7.5%  |  138.9     | 1        |    104.7 ms |   0.99 Hz
 -24.0 dB      | 40      | 4        | 0.9000    |    10.0%  |  138.6     | 0        |     17.8 ms |   0.32 Hz
 -23.0 dB      | 40      | 7        | 0.8250    |    17.5%  |  124.2     | 0        |     13.7 ms |   0.18 Hz
 -22.0 dB      | 40      | 13       | 0.6750    |    32.5%  |  106.3     | 0        |     13.5 ms |   0.18 Hz
 -21.0 dB      | 40      | 21       | 0.4750    |    52.5%  |   74.3     | 0        |      9.6 ms |   0.14 Hz  <-- 50% crossing interpolates to -21.1 dB
 -20.0 dB      | 40      | 27       | 0.3250    |    67.5%  |   51.1     | 0        |      7.2 ms |   0.12 Hz
 -19.0 dB      | 40      | 32       | 0.2000    |    80.0%  |   36.0     | 0        |      7.5 ms |   0.10 Hz
 -18.0 dB      | 40      | 36       | 0.1000    |    90.0%  |   19.0     | 0        |      4.4 ms |   0.09 Hz  <-- 90% crossing
 -17.0 dB      | 40      | 40       | 0.0000    |   100.0%  |    2.5     | 0        |      3.9 ms |   0.07 Hz
================================================================================================
```

The `Acq fail`, `Timing RMS` and `Freq RMS` columns report the acquisition stage's own error —
how often it landed more than half a symbol away, and how far off it was in time and frequency.
Below about -24 dB the sync pattern stops being findable at all, and that shows up in those
columns rather than being hidden inside the frame error rate.

---

## 🧪 The test suite

```bash
# Python DSP suite
pip install -r requirements.txt pytest
python -m pytest tests -v

# TypeScript: typecheck (strict mode is on) plus the codec and DSP module tests
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
| `tests/frontend.test.mjs` | The transmit gate admitting an out-of-band frequency, an unseeded benchmark PRNG, an amplitude-gated waveform, and unvalidated station config |

---

## 🤖 What CI enforces

`.github/workflows/ci.yml` runs on every push and pull request:

- **Python DSP suite** on 3.10 and 3.12, plus a wheel build-and-import check.
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
