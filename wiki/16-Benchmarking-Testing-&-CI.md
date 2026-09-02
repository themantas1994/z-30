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

## 📐 The standard this benchmark follows

z-30's numbers are only worth anything if they mean the same thing as everybody else's, so the
method here is not invented. It is the one the modes z-30 gets compared against already use,
and every piece of it is written down somewhere checkable:

| Convention | What it means here | Where it comes from |
| :--- | :--- | :--- |
| **Sensitivity is the SNR in a 2500 Hz reference noise bandwidth at which decode probability reaches 50%** | Every threshold on this page. `decode_threshold_interval_db(results, 50.0)` | WSJT-X publishes each of its modes this way, and it is the only reason an FT8 figure and a z-30 figure can sit in the same column |
| **Measured by Monte Carlo simulation through the decoder that ships, not a model of it** | `benchmark.py` calls `demodulate_mfsk_llrs` and `Z30LdpcCodec.decode_min_sum` - the same functions `sic_decoder.py` calls on live audio | WSJT-X generates test signals with `ft8sim` and runs the shipped decoder over them. A benchmark that reimplements the receiver measures the reimplementation |
| **Channels: AWGN, plus named ITU-R F.1487 ionospheric conditions** | `--fading none / moderate / poor / high-moderate` | [Recommendation ITU-R F.1487](https://www.itu.int/rec/R-REC-F.1487-0-200005-I/en), "Testing of HF modems ... using ionospheric channel simulators". WSJT-X's own sensitivity tables report AWGN, **mid-latitude disturbed** and **high-latitude moderate** |
| **Published sensitivity excludes a priori information** | The sweep runs `decode_min_sum`; the ladder is a separate instrument, `--ap`, reported separately in [17](17-A-Priori-(AP)-Decoding.md) | WSJT-X's tables give "no AP" and "max AP" as two different numbers and never blend them |
| **A simulated error rate is quoted with a confidence interval** | Every decode percentage carries its 95% Wilson score interval, and every crossing carries the band those intervals imply | Standard practice in Monte Carlo error-rate estimation for communications systems; the same thing MATLAB's `berconfint` exists to produce |
| **Reproducible from a stated seed** | `--seed`, default `20260830`, printed in every header | This project's own rule ([`AGENTS.md` §5](../AGENTS.md#5-honest-numbers)), and the reason any of the above can be rechecked |

Two of those were adopted rather than merely restated, and both changed what gets published:

- **The high-latitude moderate channel was not being swept at all.** z-30's three fading presets
  were labelled "CCIR good / moderate / poor" and are, in fact, the whole *mid-latitude* row of
  ITU-R F.1487 and nothing else. Sweeping only that row publishes a mode's best case and calls
  it the set — and it is exactly the row on which a long, narrow mode looks best. The
  high-latitude moderate result is now in the table below, and it is not flattering.
- **The frame counts were too small to support the figures being quoted from them.** 40 frames
  puts a ±15-point interval on a decode rate, which is most of a dB on the crossing. The
  published set is now measured at 200 frames per point, and `PUBLISHABLE_FRAMES_PER_POINT`
  makes the benchmark say so when a run is below that.

---

## 📉 The measured set

Seed `20260830`, **200 frames per point**, 2500 Hz reference bandwidth, carrier offset ±5 Hz,
timing offset ±0.5 s. Every figure is the interpolated crossing, and the bracket after it is
where that crossing falls on the most optimistic and most pessimistic curve the points' 95%
Wilson intervals allow:

| Channel | 50% decode | 90% decode |
| :--- | :--- | :--- |
| Idealised AWGN bound (genie-aided sync — **not** an on-air figure) | -24.58 dB [-24.69, -24.48] | -23.48 dB [-23.71, -23.26] |
| **AWGN, blind acquisition** | **-22.92 dB [-23.07, -22.79]** | **-22.09 dB [-22.16, -22.01]** |
| ITU-R F.1487 mid-latitude moderate (1.0 ms / 0.5 Hz) | -21.35 dB [-21.54, -21.15] | -19.16 dB [-19.41, -18.68] |
| ITU-R F.1487 mid-latitude disturbed (2.0 ms / 1.0 Hz) | -21.10 dB [-21.30, -20.89] | -19.21 dB [-19.80, -18.67] |
| ITU-R F.1487 high-latitude moderate (3.0 ms / 10 Hz) | **never reached — 3 decodes in 1,400 frames from -10 to +20 dB** | — |

**1.66 dB of the bound is spent simply finding the signal.** That gap is the acquisition loss —
what it costs to *find* the signal rather than be told where it is. Any mode's genie-aided
bound is optimistic by a similar margin, which is why the two must never be compared across
that line. See
[11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) for what
this does and does not mean against FT8.

**Across all 11,000 swept frames — the four channels above and the high-latitude one — there were no false decodes** — no
frame where the LDPC decoder converged, the CRC-14 passed, and the payload was one that had
never been transmitted. That is the number that matters for a mode which writes what it decodes
into a logbook, and it is now a column in every sweep rather than something folded into the
frame error rate.

### The two mid-latitude presets still do not separate

They differ by 0.25 dB at the 50% point, in the expected direction — but their intervals
overlap ([-21.54, -21.15] against [-21.30, -20.89]), so **200 frames per point does not
separate them either**, and neither does the 90% point, whose intervals overlap almost
completely.

This corrects what this page said when the same comparison was run at 100 frames: that the 50%
points were inseparable but the 90% points "do separate, in the expected direction, by 0.5 dB".
At 200 frames per point that is the wrong way round, which is what a ±10-point interval on a
decode rate does to a conclusion drawn from a point estimate. The honest statement is that
these two channels are not distinguishable by this mode at this sample size, at either level.

The curves also **cross**: the disturbed preset is worse at -22 and -21 dB (19.5% against 27.5%,
53.5% against 62.0%) and better at -20 dB and above (84.5% against 77.0%). Pooled over -18 and
-17 dB the moderate preset takes 391/400 against the disturbed preset's 397/400 — intervals
[95.8, 98.8] and [97.8, 99.7], which overlap, so that ordering is not established either.

What can be said without measuring anything is arithmetic from the preset parameters, and it is
offered as arithmetic rather than as a mechanism: a 1.0 ms and a 2.0 ms delay spread give
coherence bandwidths of roughly 160 Hz and 80 Hz, both far wider than z-30's 50 Hz occupied
bandwidth, so neither preset is frequency-selective across this signal. That leaves Doppler
spread as the only parameter the waveform can see, and 0.5 Hz against 1.0 Hz is a fade
correlation time of roughly 2 s against 1 s — both far shorter than the 24 s frame, so both
give the frame some time diversity and the faster one gives more. **Whether that is why the
curves cross has not been measured, and nothing here claims it.** It is a question for a paired
run of the kind [`--compare-demod`](#-the-paired-instruments---ap-and---compare-demod) is,
not for this paragraph.

### The channel z-30 cannot use

**On ITU-R F.1487 high-latitude moderate, z-30 decoded 3 frames out of 1,400 — swept from
-10 dB to +20 dB in 5 dB steps, 200 frames per point.** Two of those were at -10 dB, one at
+20 dB, and every point in between returned 0/200. Pooled, 3/1400 is a decode rate whose 95%
Wilson interval is **[0.07%, 0.63%]**, and it does not improve with signal level: 30 dB of extra
SNR buys nothing, which is what distinguishes "this channel destroys the waveform" from "this
channel costs some dB". This is the first time the channel has been swept at all, and the
result is the reason it needed to be:
the three presets this project shipped for years are the whole *mid-latitude* row of ITU-R
F.1487 and nothing harder, and that row is exactly where a long, narrow mode looks best.

Acquisition is not what fails. The Costas search still finds the frame — 0 acquisition
failures, ~20 ms timing RMS, the same numbers it produces on AWGN 30 dB lower. The data symbols
are what fail, and the arithmetic says why: this preset's 10 Hz Doppler spread is wider than
z-30's entire 3.125 Hz tone spacing, so a transmitted tone lands energy in its neighbours and
the orthogonality the matched filters depend on is gone. That is not an assertion — it is
measured off the produced samples by
`tests/test_channel_acquisition.py::test_high_latitude_moderate_spreads_a_tone_across_the_tone_spacing`,
which recovers the imposed spread from the faded waveform's own spectrum and checks it against
`Z30Config.tone_spacing_hz`.

**This is the other half of the sensitivity claim, and it belongs beside it.** The 24-second
frame and the 3.125 Hz tone spacing are one design decision: the long, narrow symbol is what
buys the AWGN depth, and it is the same thing that loses the channel when the ionosphere moves
faster than the symbol does. FT8's 0.16 s symbols and 6.25 Hz spacing make the opposite trade,
which is why WSJT-X publishes this channel and why z-30 now does too.

---

## 🔁 Reproducing the curves

Every run is seeded, so these are reproducible rather than anecdotal — record the seed with any
figure you publish:

```bash
# The honest curve: AWGN, blind acquisition. This is the headline figure.
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 200 --workers 0

# The ITU-R F.1487 mid-latitude row, on a disturbed ionospheric path.
python -m z30_dsp.benchmark --mode realistic --fading moderate --min-snr -24 --max-snr -17 --frames 200 --workers 0
python -m z30_dsp.benchmark --mode realistic --fading poor     --min-snr -24 --max-snr -17 --frames 200 --workers 0

# ITU-R F.1487 high-latitude moderate. Swept far above where the mode has any hope, because
# the result is that there is no SNR at which it decodes - see the table above.
python -m z30_dsp.benchmark --mode realistic --fading high-moderate --min-snr -10 --max-snr 20 --step 5 --frames 200 --workers 0

# The genie-aided bound, for comparison only.
python -m z30_dsp.benchmark --mode ideal --min-snr -30 --max-snr -20 --frames 200 --workers 0
```

`--frames 200` is not decoration. It is `PUBLISHABLE_FRAMES_PER_POINT`, and below it the
benchmark prints an `EXPLORATORY RUN` notice: a decode rate is a binomial proportion, and at
40 frames its 95% interval is ±15 points, which is most of a dB on the crossing. A 20-frame run
is still the right tool for "did I break the decoder" — it is publishing its crossing as a
sensitivity figure that is not honest.

Any of these takes `--workers N` to spread the decoding over processes without changing what it
measures — see [`--workers`](#-workers-the-same-curve-in-less-time) below.

Sample output from the AWGN command above, verbatim:

```
================================================================================================
  z-30 DECODE THRESHOLD (blind acquisition through the real receive chain)
  Carrier offset +/-5.0 Hz | timing offset +/-0.50 s | fading: No fading (AWGN only) (0.0 ms / 0.0 Hz)
  The receiver is given only audio: it finds the frame and estimates the noise itself.
  200 frames/point | Sample Rate: 6000 Hz | Iteration cap: 45 + 40 + 35 + 30 = 150 over 4 schedules | Seed: 20260830
  Decode % is a proportion from 200 frames; the bracket is its 95% Wilson score interval.
================================================================================================
SNR (2500Hz)   | Frames  | Success  | FER       | Decode % (95% CI)     | Avg Iters  | Acq fail | Timing RMS  | Freq RMS
----------------------------------------------------------------------------------------------------------------
 -28.0 dB      | 200     | 0        | 1.0000    |   0.0% [ 0.0-  1.9]   |  150.0     | 52       |    283.3 ms |   4.56 Hz
 -27.0 dB      | 200     | 0        | 1.0000    |   0.0% [ 0.0-  1.9]   |  150.0     | 19       |    195.8 ms |   2.75 Hz
 -26.0 dB      | 200     | 0        | 1.0000    |   0.0% [ 0.0-  1.9]   |  150.0     | 9        |    159.9 ms |   1.72 Hz
 -25.0 dB      | 200     | 1        | 0.9950    |   0.5% [ 0.1-  2.8]   |  149.3     | 2        |     56.1 ms |   1.28 Hz
 -24.0 dB      | 200     | 17       | 0.9150    |   8.5% [ 5.4- 13.2]   |  139.2     | 0        |     19.8 ms |   0.25 Hz
 -23.0 dB      | 200     | 92       | 0.5400    |  46.0% [39.2- 52.9]   |   85.9     | 0        |     12.4 ms |   0.20 Hz
 -22.0 dB      | 200     | 189      | 0.0550    |  94.5% [90.4- 96.9]   |   15.1     | 0        |      8.6 ms |   0.17 Hz
 -21.0 dB      | 200     | 199      | 0.0050    |  99.5% [97.2- 99.9]   |    2.3     | 0        |      8.6 ms |   0.15 Hz
 -20.0 dB      | 200     | 200      | 0.0000    | 100.0% [98.1-100.0]   |    1.0     | 0        |      7.3 ms |   0.12 Hz
 -19.0 dB      | 200     | 200      | 0.0000    | 100.0% [98.1-100.0]   |    1.0     | 0        |      6.4 ms |   0.11 Hz
 -18.0 dB      | 200     | 200      | 0.0000    | 100.0% [98.1-100.0]   |    1.0     | 0        |      4.8 ms |   0.11 Hz
 -17.0 dB      | 200     | 200      | 0.0000    | 100.0% [98.1-100.0]   |    1.0     | 0        |      3.9 ms |   0.08 Hz
================================================================================================
  False decodes across the sweep: 0 of 2400 frames (CRC-14 valid, payload never transmitted).
  decode threshold (50% frame decode, blind acquisition): -22.92 dB [-23.07, -22.79] (2500 Hz reference bandwidth), seed 20260830, 200 frames/point
  90% frame decode: -22.09 dB [-22.16, -22.01] (2500 Hz reference bandwidth), seed 20260830, 200 frames/point
================================================================================================
```

The bracket after each decode percentage is that point's 95% Wilson score interval, and the
bracket after each crossing is where 50% (or 90%) falls on the most optimistic and the most
pessimistic curve those intervals allow. It is computed from the same counts the table prints,
so a reader can redo it by hand rather than take it on trust.

**`False decodes` is a safety column, not a statistic.** It counts frames where the LDPC
decoder converged, the CRC-14 checked out, and the payload was one that was never transmitted —
which is to say, frames the shipped software would display and write to a logbook as a contact
with a station that never called. Nothing distinguishes them from a real decode at the
receiver, so the sweep counts them separately rather than folding them into the FER. Across
2400 AWGN frames from -28 to -17 dB there were none; the 14-bit CRC's 2⁻¹⁴ is doing its job.

The `Acq fail`, `Timing RMS` and `Freq RMS` columns report the acquisition stage's own error —
how often it landed more than half a symbol away, and how far off it was in time and frequency.
Below about -24 dB the sync pattern stops being findable at all, and that shows up in those
columns rather than being hidden inside the frame error rate.

---

## 🧵 `--workers`: the same curve, in less time

A sweep is embarrassingly parallel and takes a long time, so `benchmark.py` can spread frame
decoding across processes:

```bash
# One process per CPU. --workers 1 (the default) is the serial path, unchanged.
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40 --workers 0
```

**`--workers` changes wall-clock time and nothing else.** The curve is identical at every worker
count, bit for bit, at the same seed — the same successes, the same FER, the same average
iterations, the same acquisition RMS columns, the same interpolated threshold. That is a
stronger guarantee than "it also runs fast", and it is the only guarantee that lets a
published figure be reproduced on a machine with a different core count than the one that
measured it.

### Why it is identical, and what was not done to achieve it

The sweep draws every random value it needs — payload bits, the Watterson tap processes, the
carrier and timing offsets, the AWGN — from **one** `np.random.Generator`, consumed strictly in
call order. That shared state is the whole obstacle to running frames concurrently.

The obvious fix is to give each frame its own generator seeded from
`(master_seed, snr_index, frame_index)`. It parallelises everything — and it draws different
numbers, so it produces a **different curve at the same seed**. Every threshold on this page
would have to be re-measured, and the retraction history at the top of it says what that is
worth. Speed is not a reason to move a published figure.

What was done instead is to split the frame loop along the generator:

| Stage | Where it runs | Touches the PRNG |
| :--- | :--- | :--- |
| Payload, waveform synthesis, fading, carrier and timing offsets, AWGN (`_prepare_frame`) | Main process, in frame order | **Yes** — in exactly the order the serial loop always used |
| Acquisition, demodulation, LDPC decode, CRC and payload check (`decode_prepared_frame`) | Any worker, in any order | No |

The receive half is a pure function of the buffer it is handed. It already had to be:
`decode_min_sum` derives its dither seed from the LLRs (`ldpc.dither_seed_from_llrs`) precisely
so that a decode does not depend on when it happens. Results come back keyed by frame index and
are reduced in index order, never in completion order, so a busy machine cannot change a count.

This leaves the PRNG-consuming half serial, which caps the achievable speedup. Measured on this
code at 6000 Hz in realistic mode, that half is **3.1% of a frame's wall clock** — payload 0.0%,
waveform synthesis 0.3%, fading and offsets 2.7%, noise 0.1% — against **96.9%** for
acquisition, demodulation and decode. The Amdahl ceiling is therefore about **32×**, well past
any core count this runs on, so the cap costs nothing in practice.

### Measured

The reference AWGN command, run at two worker counts on a 4-core machine, seed `20260830`.
This comparison was made at 40 frames per point, when that was the published sample size; it is
a wall-clock and identical-curve measurement, so the sample size is not what it is testing and
it has not been redone at 200:

```
python -m z30_dsp.benchmark --mode realistic --fading none --min-snr -28 --max-snr -17 --frames 40 --workers {1,4}
```

| Workers | Wall clock | 50% crossing | 90% crossing | Curve |
| ---: | ---: | ---: | ---: | :--- |
| 1 (serial) | 660.6 s | -23.09 dB | -21.67 dB | reference |
| 4 | 271.5 s (**2.43×**) | -23.09 dB | -21.67 dB | identical in every field, at every SNR point |

Both runs reproduce the sample output above row for row — 22 successes at -23.0 dB, 77.6 average
iterations, 13.7 ms timing RMS, 0.18 Hz frequency RMS — so the published thresholds are the same
numbers they were before this existed, produced by both paths.

A second, tighter comparison across three worker counts, at -24 to -21 dB where successes,
failures and the full four-schedule decode cascade are all exercised:

| Workers | Wall clock | Curve |
| ---: | ---: | :--- |
| pre-change code, serial | 53.7 s | reference |
| 1 (serial) | 52.9 s | identical, every field |
| 2 | 32.4 s (1.63×) | identical, every field |
| 4 | 21.0 s (2.52×) | identical, every field |

So the refactor itself neither moved a number nor cost measurable time, and the speedup on four
cores is roughly 2.4-2.5× rather than 4× — process startup, pickling a ~0.7 MB buffer per frame
and the serial 3.1% together account for the rest. That is the go/no-go answer at the documented
defaults: worth having, and not the 4× a core count alone would suggest.

Two practical notes:

- With `--workers` above 1, the per-point **`elapsed_sec` is wall clock across the pool**, not
  serial CPU time. The run prints a line saying so. Do not read it as a per-frame cost.
- If NumPy is linked against a threaded BLAS, a process pool can oversubscribe the CPUs. On this
  code it makes little difference either way — the receive chain's hot loops are FFTs and short
  dot products rather than large matrix products. Three frames through the full chain, with
  `OMP_NUM_THREADS`/`OPENBLAS_NUM_THREADS`/`MKL_NUM_THREADS` unset, set to 1 and set to 4, gave a
  **byte-identical** SHA-256 over the LLRs, the decoded bits and the acquisition results in all
  three cases, at 6.02 s / 5.43 s / 5.66 s. Nothing in the benchmark touches those variables —
  setting them would be a numerical change disguised as a performance knob — so if a future
  change does start hitting threaded BLAS, set them in the environment before the run.

### What is not parallelised, and why

- **The three SIC passes.** Sequential by construction: pass 2 reads pass 1's residual.
- **The candidates within one SIC pass.** These *look* independent, but
  `Z30SicMultiSignalDecoder.process_buffer` subtracts each successful decode from
  `residual_buffer` **inside** the candidate loop, so a later candidate in the same pass is
  demodulated against a buffer an earlier one has already changed. Measured on a two-signal
  composite (carriers at 700 Hz and 940 Hz, the second at 0.6 of the first's amplitude — 240 Hz
  apart, so no spectral overlap at all between two 50 Hz signals), cancelling the first candidate
  moved the second candidate's noise-sigma estimate from 0.921 to 0.627,
  because `_estimate_llrs` takes that estimate from the whole buffer's median absolute
  deviation. Parallelising against a frozen start-of-pass residual is therefore a **change to
  what the decoder does**, not just to how fast it does it, and it needs the paired measurement
  AGENTS.md §5 requires before it can land. (Whether that sigma shift changes any decoded bit is
  itself unmeasured: at the SNRs probed, every LLR was already at the ±25 clip, which hides the
  difference. That is a question for a benchmark, not for this paragraph.)
- **`decode_min_sum` across frames.** The opportunity there is running many decodes at once. A
  single 216-bit decode is a different question, and one this page used to answer wrongly — see
  [below](#-what-a-decode-actually-costs).
- **Anything reachable from the transmit path.** `canTransmit()`, `setPtt()`, `withCatLock()`,
  `RigStateTracker` and the GPIO watchdog are already concurrent in exactly the ways they need
  to be, and are out of scope. See
  [13. Operating Safety, Compliance & Security](13-Operating-Safety-Compliance-&-Security.md).

The browser benchmark (`src/dsp/monteCarloEngine.ts`) still runs on the main JS thread. Moving
it into a Worker is the same problem with a different mechanism and has not been done.

---

## ⏱️ What a decode actually costs

A sweep's wall clock is dominated by frames that **fail**. A frame that converges leaves the
decoder in single-digit iterations; a frame below threshold runs all four schedules to their caps
— 150 iterations — and pays for every one of them. Profiled on this code at 6000 Hz, one
`decode_min_sum` call on a frame at -26 dB took **1.64 s**, against 2.6 ms for a frame at -22 dB
that converged on the first iteration.

Where that 1.64 s went is not where the shape of the code suggests. Measured per sweep, median of
12 sweeps over 3 real frames:

| Schedule | Cap | Cost per sweep, as it stood | Share of a full cascade |
| :--- | ---: | ---: | ---: |
| 1 — normalized min-sum | 45 | 2.00 ms | 6% |
| 2 — log-domain sum-product (box-plus) | 40 | **33.04 ms** | **86%** |
| 3 — normalized min-sum, reverse | 35 | 2.02 ms | 5% |
| 4 — dithered normalized min-sum | 30 | 2.01 ms | 4% |

**Schedule 2 was 86% of the cost of a failing decode**, at 16× the per-sweep cost of a min-sum
schedule. It is the only schedule that evaluates `_box_plus` — 5,838 times per sweep, each call
two NumPy scalar `exp`/`log1p` dispatches — and a NumPy call on one number costs about what a
call on seven numbers costs. So the fold was rewritten to step its *d* leave-one-out folds as *d*
lanes together, paying the transcendentals once per step instead of once per (edge, step) pair:
**33.04 ms → 16.63 ms per sweep (1.99×)**, and a full failing cascade **1.64 s → 0.92 s (1.77×)**.

**Nothing about the result moved, and that is the point of the change rather than a caveat on
it.** Three seeded sweeps — AWGN blind-acquisition, the genie-aided bound, and ITU mid-latitude
moderate fading — were run before and after and compared field by field: **145 fields across 11 SNR points,
all identical**, successes, FER, average iterations and the acquisition RMS columns alike.
`tests/test_ldpc_vectorized_equivalence.py` holds the line going forward by pinning the sweep
against a transcription of the scalar one, bit for bit on float32 state rather than "same decodes
on the frames we tried".

Three things were tried and **rejected on measurement**, and are recorded because each looks like
the obvious next step:

| Idea | Why not |
| :--- | :--- |
| Vectorise the min-sum edge loop the same way | **Slower**: 3.8 ms against 2.1 ms per sweep. At a check degree of 6 or 7, a ufunc dispatch costs more than the scalar arithmetic it replaces. Vectorising wins in schedule 2 because it removes `exp`/`log1p` *calls*, not because arrays are involved. |
| Update all 139 checks from one snapshot | That is the *flooding* schedule, not the layered one both codebases specify. It converges differently — a different decoder, and every threshold on this page would need re-measuring. Nor is there an order-preserving way to group checks: the dual-diagonal parity structure puts checks *p* and *p+1* on a shared parity bit, so consecutive checks always conflict. |
| Forward/backward cumulative leave-one-out in the fold | The standard O(d) trick, but it folds the suffix from the right, and box-plus is not associative in floating point. A few ULP away is a different decoder. The lane-parallel form keeps each lane's fold order exactly. |

The practical value is headroom rather than sensitivity. A slot gives 4.5 s for decode and SIC
([03](03-DSP-&-Physical-Layer-Specification.md)), and `sic_decoder.py` will try up to
`SIC_MAX_CANDIDATES` (16) candidates on each of three passes with no wall-clock guard, so the
cost of a candidate that *fails* to decode is what bounds how many can be tried. This does not
make z-30 decode anything it could not decode before; it buys back time that could be spent
trying more.

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
| `RECEIVER_PILOT_COHERENCE` | 0.0 | Purely non-coherent demodulation, which is what z-30's receiver is specified to be. `ideal` mode keeps the pilot-adaptive weight, because it is handed perfect timing. It is declared in `src/dsp/realReceiver.ts` and in `z30_dsp/benchmark.py` — **beside each language's demodulator, not in its benchmark** — and `monteCarloEngine.ts` imports it. It used to be declared here, in the benchmark, and [that is how the on-air decoders came to be running a different one](#-a-benchmark-challenging-the-code-the-receiver-measured-was-not-the-receiver-that-shipped). |

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
> took that point 3–0. The full per-point table is in the `RECEIVER_PILOT_COHERENCE` comment in
> `z30_dsp/benchmark.py`.
>
> **Follow-up (2026-09-02):** that correction fixed the Python *benchmark* and stopped there.
> The two on-air decoders went on applying the semi-coherent term for another two days, because
> nothing compared a benchmark against a decoder — only benchmarks against each other. Re-measured
> at 100 frames per point, the same effect is 1.77 dB on AWGN (p = 2.9 × 10⁻³⁶) and very much
> larger on a fading path (p = 5 × 10⁻¹¹⁹). See
> [A benchmark challenging the code](#-a-benchmark-challenging-the-code-the-receiver-measured-was-not-the-receiver-that-shipped).

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

## 🔧 A benchmark challenging the code: the receiver measured was not the receiver that shipped

The [worked example](#-a-worked-example-a-benchmark-challenging-the-wiki) below is a benchmark
correcting the *wiki*. This one is a benchmark correcting the *decoder*, and it is the more
important of the two, because for months the published threshold on this page described a
receiver that had never decoded a frame off the air.

### What was wrong

`demodulate_mfsk_llrs` takes a `pilot_coherence` weight: how much of each tone's likelihood
comes from a coherent projection onto the nearest Costas pilot's measured phase, and how much
from the non-coherent envelope. There were two live values of it in the shipped software at
once, and no test over either:

| Code path | What it did | What it is |
| :--- | :--- | :--- |
| `benchmark.py`, `realistic` mode | passed `0.0` | the reference instrument |
| `monteCarloEngine.ts`, `realistic` mode | passed `0.0` | the in-app benchmark |
| `sic_decoder.py` `_estimate_llrs` | took the parameter's default, which was the pilot-distance-adaptive 0.35–0.85 | **decodes real audio** |
| `realReceiver.ts` `demodulateReal` | hardcoded that same adaptive weight | **decodes real audio** |

The two benchmarks agreed with each other exactly, which is what made it invisible: the
cross-language parity test compared benchmark against benchmark. Nothing compared either
against the decoder. The constant was even named `REALISTIC_PILOT_COHERENCE` — after a
benchmark mode, which is precisely the thinking that let a receiver parameter live in a
benchmark.

### What it cost, measured

`python -m z30_dsp.benchmark --compare-demod` puts every frame through the channel once,
acquires it once, and then demodulates it **twice** — once at each weight — and decodes both.
Both arms therefore see the identical channel realisation, the identical acquisition and the
identical noise, so the frame-to-frame scatter that would otherwise bury an effect of a dB
cancels out of the comparison completely. The statistic is the count of frames where the two
arms disagreed, tested with the exact two-sided McNemar test (`mcnemar_exact_p`).

**AWGN, blind acquisition, seed `20260830`, 100 frames per point:**

| SNR | non-coherent (0.0) | semi-coherent (0.35–0.85) | non-coh only | semi only | acq timing RMS |
| :--- | ---: | ---: | ---: | ---: | ---: |
| −25 dB | 1/100 | 1/100 | 1 | 1 | 19.8 ms |
| −24 dB | 4/100 | 13/100 | 3 | **12** | 18.2 ms |
| −23 dB | 51/100 | 18/100 | 41 | 8 | 14.8 ms |
| −22 dB | 93/100 | 35/100 | 58 | 0 | 12.0 ms |
| −21 dB | 100/100 | 55/100 | 45 | 0 | 8.7 ms |
| −20 dB | 100/100 | 76/100 | 24 | 0 | 6.9 ms |
| −19 dB | 100/100 | 78/100 | 22 | 0 | 5.9 ms |

Pooled over the 700 frames: **194 discordant pairs won by the non-coherent receiver against 21
by the semi-coherent one, exact two-sided McNemar p = 2.9 × 10⁻³⁶** — far past the ≥99%
confidence [`AGENTS.md` §5](../AGENTS.md#5-honest-numbers) requires of a result that changes
shipped code. The 50% crossings are **−23.02 dB [−23.21, −22.81]** against **−21.25 dB
[−21.73, −20.78]**, 95% Wilson bands that do not overlap. **The shipped receiver was 1.77 dB
worse than the one every published figure described.**

The −24 dB row is recorded rather than dropped, and it goes the other way. Both arms are under
15% there — below the SNR at which the Costas pattern is reliably findable at all, which is not
an SNR a station operates at.

**On a fading path it was not a 1.77 dB question.** The same comparison on ITU-R F.1487
mid-latitude disturbed (`--fading poor`), 100 frames per point over −24 to −17 dB:

| | non-coherent | semi-coherent |
| :--- | ---: | ---: |
| Frames decoded, 800 total | **460** | 66 |
| Decode rate at −17 dB | 99% | 30% |
| Discordant pairs | **394** | 0 |

**p = 5 × 10⁻¹¹⁹**, and the semi-coherent arm never reaches 50% anywhere in the swept range. A
pilot phase reference does not survive a channel that is rotating it, which is the condition
the mode exists to work in.

### The mechanism, confirmed rather than assumed

The obvious objection is that a coherent term ought to help — that is the whole point of one.
It does, and the same instrument shows exactly when. Run with perfect symbol timing handed to
the demodulator (`--compare-demod --mode ideal`, 100 frames per point, −27 to −22 dB), the
result **reverses completely**: 136 discordant pairs to 1 *for* the semi-coherent arm,
p = 1.6 × 10⁻³⁹, 50% crossings **−24.58 dB** against −23.29 dB.

So the coherent term is worth **+1.29 dB when the phase reference is exact**, and costs
**−1.77 dB when the receiver has to find the frame itself** — because residual timing error
`dt` rotates a tone at `f` by `2πf·dt` relative to the pilot it is projected onto, and the
projection then subtracts signal instead of adding it. At the 6–20 ms of residual timing error
blind acquisition actually leaves, and at a 1250 Hz carrier, that is many whole cycles: the
"coherent" term is being measured against a phase that is, for practical purposes, random.

This is also why `--mode ideal` **keeps** the adaptive weight and passes it explicitly. It is a
genie-aided bound, and the genie includes the phase reference.

### What changed

- `demodulate_mfsk_llrs`'s default is now `RECEIVER_PILOT_COHERENCE` (0.0), so
  `sic_decoder._estimate_llrs`, which takes the default, gets the measured receiver.
- `realReceiver.ts`'s `demodulateReal` reads the same constant instead of recomputing a weight.
- The constant lives in `realReceiver.ts` and `benchmark.py` — **beside the receiver** — and
  `monteCarloEngine.ts` imports it rather than declaring its own. A benchmark that owns the
  receiver's parameters can be perfectly self-consistent while measuring software nobody runs.
- `tests/test_cross_language_parity.py::test_the_benchmark_demodulates_like_the_receiver_that_ships`
  asserts all three: that the constant is declared beside the shipped demodulator, that the
  Python default equals it, and that `demodulateReal` applies it rather than a locally computed
  weight. It fails if either half of the old code comes back.

**No published threshold moved because of this change.** The benchmark was already measuring
the non-coherent receiver; what changed is that the software now *is* that receiver. That is
the whole point: a sensitivity figure is a claim about the program someone downloads.

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
| `tests/test_benchmark_parallel.py` | `--workers` becoming more than a wall-clock knob. Asserts the sweep produces an identical curve on one process and on several, that frame generation is unaffected by the batch size frames are dispatched in, that the receive chain is a pure function of its input and leaves that input alone, and that results are filed by frame index rather than by the order an executor hands them back — driven by an executor that deliberately returns them backwards, because `concurrent.futures.map` re-imposes input order and would hide the bug |
| `tests/test_ldpc_vectorized_equivalence.py` | The decoder's check-node sweep being optimised into a *different* decoder. Pins the shipped sweep against a transcription of the scalar one **bit for bit** — `np.array_equal` on the float32 LLR and message state after each of six consecutive sweeps, for all four schedules, on real frames from -19 to -26 dB — plus a full-cascade comparison covering the hard-decision, CRC-field and parity-accumulation paths rewritten alongside it. A speed change that moves a decoded bit is a change to the published thresholds, and this is what makes that impossible to do by accident |
| `tests/test_sic_candidate_detection.py` | The SIC candidate detector inventing carriers out of noise, and the two languages' detectors diverging again. The raw-bin detector this replaced produced ~52 spurious candidates per frame from pure noise |
| `tests/test_git_sync.py` | The updater doing anything other than a fast-forward — a self-update that could discard an operator's local changes or move the checkout to an unrelated history |
| `tests/test_updater_cli.py` | The layer above that engine: `run_updater` turning a `SyncStatus` into the wrong exit code, so a startup script never notices the box is behind or reports failure forever on a current one — and an interrupted prompt or a closed stdin being read as consent to update |
| `tests/test_band_manager.py` | Band-preset persistence, dial-to-band detection across every shipped preset, and `tune_radio()` reporting success when the rig took the QSY but refused the mode change |
| `tests/test_ap_decode.py` and `tests/apDecode.test.mjs` | A priori decoding reaching further than it should. That an asserted bit survives every iteration even when the whole frame argues against it; that the AP LLR's sign convention is z-30's and not WSJT-X's (getting it backwards asserts every bit inverted and fails silently and totally); that a hypothesis naming other stations is *never* accepted; that AP cannot lose a frame the ordinary decoder found; that a callsign which does not survive the 28-bit packing produces no hypothesis; that the frequency gate fires at both edges of `AP_FREQ_WINDOW_HZ`; and that an empty mask decodes bit-identically to no mask, so every published threshold above still describes the shipped decoder. See [17. A Priori (AP) Decoding](17-A-Priori-(AP)-Decoding.md) |
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
- **Benchmark smoke test**: a short seeded sweep in both modes, run three times — twice
  serially and once across two worker processes — asserting an identical curve every time. The
  first two catch non-determinism in the channel/acquisition path, which would otherwise only
  surface when someone tried to reproduce a published curve. The third catches a sweep that
  reduces its counts in worker-completion order rather than in frame order, which would satisfy
  the run-to-run check on an idle CI runner and drift on a busy machine.
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

## 🎯 The paired instruments: `--ap` and `--compare-demod`

Neither of these sweeps a curve. Both run a **paired comparison**, and pairing is the whole
method: an effect of a fraction of a dB is smaller than the frame-to-frame scatter of a sweep,
so two independent runs differenced leave the reader unable to tell a real effect from the
noise in the measurement. Paired, the statistic is the count of frames where the two arms
disagreed, tested with the exact two-sided McNemar test (`mcnemar_exact_p`, computed from
`math.comb` so a reader can recompute it by hand rather than trusting a library version).

| | What is held identical | What differs | Where the result is |
| :--- | :--- | :--- | :--- |
| `--ap` | the channel, the acquisition **and the demodulation** - both arms decode the same 216 LLRs | the QSO-state hypothesis ladder behind the decoder | [17. A Priori (AP) Decoding](17-A-Priori-(AP)-Decoding.md) |
| `--compare-demod` | the channel, the noise draw and the acquisition | the demodulator's coherent-term weight - both arms are then decoded separately | [the section above](#-a-benchmark-challenging-the-code-the-receiver-measured-was-not-the-receiver-that-shipped) |

Both are serial by construction: parallelising a pair would spread its two arms across
processes for no change to the result and one more place for them to diverge.

`--ap` demodulates **once** and decodes the resulting LLR vector twice, so its two arms see
bit-identical channel evidence and the ladder is the only difference between them.
`--compare-demod` cannot do that - the demodulator is the thing under test - so it shares
everything up to and including the acquisition result and diverges from there. Its population
is the ordinary random-payload sweep; `--ap`'s is a modelled band, half the QSO the receiver is
in and half foreign traffic, because a hypothesis ladder's worth depends entirely on how much
of the band it describes.

It is the same method the four-schedule cascade was established with in the worked example
above, and the same method that established the demodulator result before it.

---

## ✅ Before you publish a number

1. Run the benchmark seeded, and quote the seed, frame count, mode and channel alongside the
   figure. At least `PUBLISHABLE_FRAMES_PER_POINT` (200) frames per point - the benchmark
   prints an EXPLORATORY RUN notice below that, and a crossing from fewer is uncertain by more
   than most changes worth measuring.
2. Quote the interval, not just the crossing. Every table on this page carries one.
3. Never compare a `--mode ideal` figure with another mode's published on-air threshold.
4. Comparing two decoders? Pair them (`--ap`, `--compare-demod`) and report the exact McNemar
   p-value. Two sweeps differenced is not a comparison at this effect size.
5. If a DSP change moves the threshold, update **every** place the figure appears: this page,
   [03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md),
   [11. Physics & Comparative Analysis](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md),
   the pull request checklist in
   [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md),
   `Home.md`, the `Z30_SPECS` sensitivity constants in `src/dsp/z30Constants.ts`, and the
   summary line in the repository `README.md`.
6. Regenerate the in-app copy afterwards (`npm run generate:wiki`), or CI will fail.
