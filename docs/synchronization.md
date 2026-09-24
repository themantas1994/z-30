# Synchronization

Two separate problems: finding frames inside a slot window (the Costas search), and knowing
which samples make up that window (the slot clock).

## Coarse search: every Costas candidate in the band (`sync.rs`)

The spectrogram is Hann-windowed, one symbol (1920 samples) long, zero-padded 4× (bins of
0.78 Hz, four per tone spacing) and hopped every 1/8 symbol (40 ms), over 200–2800 Hz. For
every start time from DT = −1.5 s to +1.5 s and every tone-0 column, the metric is:

```
sync(t, f) = 16 · Σ_k P(t + pos_k, f + tone_k)  /  Σ_k Σ_j P(t + pos_k, f + j)
```

This is the power at the 21 known Costas tones over the power in all 16 tone bins at the same
21 instants. The denominator is local, so band-noise shape, a strong neighbour or a CW carrier
raise both halves of the ratio instead of creating a candidate. The map is normalised by its
median, so `sync_threshold = 1.5` means the same thing on a quiet band and a busy one.

Candidates are the map's local maxima above the threshold, sorted strongest first, with ties
broken deterministically. Non-maximum suppression keeps the strongest within 2 bins (1.6 Hz)
and 2 hops (80 ms), and the list is truncated to `max_candidates` (50). This is WSJT-X's
`sync8` structure applied to `acquisition.py`'s metric. The oracle searched one global peak in
a ±12 Hz, ±0.55 s window around a carrier it was told. The audit measured whole-band search
with this metric against that window: 200 paired frames, 0 discordant.

## Fine search: dt, frequency and drift per candidate

Each candidate gets its own complex baseband at 200 Hz: 64 samples per symbol, with tone k on
bin k of a 64-point DFT (see [demodulation.md](demodulation.md)). The fine search evaluates
the same 21-symbol metric on that baseband over a staged grid:

| Stage | Timing | Frequency | Drift |
| :--- | :--- | :--- | :--- |
| 1 | ±8 samples (±40 ms, one coarse hop) | ±0.8 Hz in 0.1 Hz | 0 |
| 2 | ±1 sample | ±0.1 Hz in 0.02 Hz | 0 |
| 3 | ±2 samples | ±0.3 Hz in 0.1 Hz | −`max_drift_hz`…+`max_drift_hz` in 0.5 Hz |
| 4 | best | ±0.09 Hz in 0.03 Hz | ±0.4 Hz in 0.2 Hz |

A drift hypothesis is a linear frequency ramp across the 24 s frame, zero at mid-frame. The
search uses only the Costas symbols; data symbols are never used to decide timing.

The sub-sample timing is refined by a parabolic fit through the metric at the best sample and
its two neighbours, giving a fraction of the 5 ms baseband step. That removed a +10 ms DT bias
the integer grid had. A +2.9 ms bias remained (the 2026-09-24 audit measured +2.8 ms); after a
frame decodes, its replica is placed on the received spectra by least squares to one 6 kHz
sample, and that placement - not fine sync's - is the reported DT and the SIC's starting point
([receiver.md](receiver.md#reported-snr-dt-and-frequency)).

**Gate.** Candidates whose best fine metric is below `min_fine_sync` (2.5) times the bin noise
stop here and never reach the LDPC decoder. This gate keeps the false-decode rate where
[benchmarking.md](benchmarking.md) measures it.

**Drift is arbitrated by the CRC, not by the metric.** The zero-drift hypothesis is always
decoded first. The best drifted hypothesis is decoded as well only when it differs and its
metric beats zero-drift by `drift_gain` (1.05). The audit's H9 finding was that at −22 dB,
2 Hz of drift cost 10 of 37 decodes and 4 Hz cost all but one;
`frequency_drift_up_to_4_hz_is_tracked_h9` guards the fix.

The audit proposed a linear fit over the seven Costas clusters instead. At −23 dB each cluster
has about 1 dB of Eₛ/N₀, and a fit over seven such estimates is unreliable, so the joint
search was chosen instead (`VNEXT_IMPLEMENTATION_PLAN.md` section 1).

## No tracking loops

There is no PLL and no Gardner detector. The tone decision is non-coherent, so carrier phase
is irrelevant. Timing is fixed per frame by the Costas array, and residual frequency error
over the frame is what the drift search models. A tracking loop would add a failure mode
(losing lock at −23 dB) and fix nothing this receiver needs fixed.

## The slot clock (`z30-engine`: `clock.rs`, `slots.rs`, `pipeline.rs`)

The audio sample counter is the master clock. The shipped app took one `Date.now()` at capture
start and never re-anchored it (audit H5). At 100 ppm of sound-card error that is 0.36 s an
hour, so after a few hours frames leave the ±1.5 s search.

**Clock model.** Every audio callback contributes an observation: the absolute index of the
callback's first sample, and the UTC at which it was captured. A least-squares line over a
120 s sliding window gives both the offset and the device's true rate, which the GUI shows as
sound-card drift in ppm. Callback jitter averages out, and drift is tracked rather than
accumulated. An observation far off the line is a discontinuity: a device restart, an overrun
or a system-clock step. It starts a new *epoch*, and nothing from before an epoch is mixed
with anything after it.

**Resampler alignment.** Output sample k of the polyphase resampler represents input instant
`k · in/out + input_delay()`. The pipeline uses that to date every 6 kHz sample at the instant
it actually represents, rather than at the instant it left the filter.

**Slot store and scheduler.** 6 kHz samples are filed in a ring (70 s) by absolute sample
index. A gap reported by the audio adapter is zero-filled, so indices stay honest. Slot n's
window is [slot − 1.5 s, slot + 25.5 s] converted to sample indices through the clock model.
It is handed to the decoder when, and only when, the store holds every sample of it. That
happens 25.5 s into the slot plus the audio latency, however late the scheduler happens to be
polled.

The shipped app triggered its decode from a UI timer at 24.0 s, asking for a window that did
not exist yet, and never retried (C1). A window that cannot be complete is reported as missed
with a reason (`BeforeEpoch`, `Overwritten`, `ClockUnlocked`, `DecoderBusy`, `DecoderFault`).
It is never dropped silently.

**The 24-hour soak** (`crates/z30-engine/tests/virtual_clock.rs`) runs a virtual sound card at
+150 ppm with ±3 ms callback jitter and a 2 s dropout through the real pipeline for 24 hours of
audio. It asserts:

- every slot is emitted once, in order, or reported as missed with its reason (≤ 3, all caused
  by the dropout);
- every window is aligned to true UTC within 10 ms;
- no window is emitted before it has been captured;
- the drift estimate is within 5 ppm of the truth.

Measured: 2879 slots, worst alignment 0.35 ms, drift estimate 150.7 ppm.

The same file runs a closed-loop QSO through the pipeline, decoder, gate, sequencer and logger,
at 48 kHz with −120 ppm.

The runtime-level test `crates/z30-engine/tests/live_runtime.rs` drives the same path through
the production threads (`runtime::start`): the virtual sound card stalls 0.5 s before a slot's
window closes, and the test asserts nothing is decoded during the stall, then that the decoder
receives exactly the samples of [slot − 1.5 s, slot + 25.5 s] once the rest arrives. It fails
against a scheduler that fires early and zero-pads (checked by mutation), which is the legacy
C-01 defect.

## Timing budget

The receiver searches DT over ±1.5 s, and that window is hard: measured through
`decode_slot`, 100% of frames decode at ±1.5 s and almost none at ±1.6 s
([benchmarking.md](benchmarking.md#timing)). Everything between the transmitter's clock and
this receiver's shares it: both stations' clock errors, both sound cards' latencies and the
propagation delay. Keep the computer on UTC to well under a second.

## What the clock does not do

It never sets the system clock, never applies an offset of its own, and never derives UTC from
a received signal. There is no RF time sync and no network time query in z-30: the legacy RF
time sync reported success on pure noise and persisted a 27–30 s offset (audits H4 / C-03), and
the legacy network query called one HTTP round trip "sub-millisecond". UTC comes from the
operating system. `z30 --diagnostics` and the GUI status bar report the operating system's own
synchronisation status: "NTP-synchronised" only when `timedatectl` says so on Linux,
"unavailable" when it cannot be asked, "not checked" on Windows and macOS - never "OK" by
default (`wallclock::status_from_timedatectl`, tested). Keeping the host on NTP or GPS
(`chrony` + `gpsd`) is the operator's part; z-30 does not manage it.
