# Audio

`crates/z30-io/src/audio.rs` (devices), `crates/z30-dsp/src/resample.rs` (rate conversion),
`crates/z30-engine/src/pipeline.rs` (the receive path to the decoder).

## Devices

cpal gives native audio on each OS: ALSA on Linux (which PipeWire and PulseAudio also serve),
WASAPI on Windows, CoreAudio on macOS. `z30 --devices` lists input and output devices and
serial ports. A device is chosen by a substring of its name; none means the system default.
Streams open at the device's **default** configuration with **f32** samples. A device that
cannot provide f32 at its default configuration fails to open, and the error says so (see
[troubleshooting.md](troubleshooting.md)). Capture takes channel 0 of an interleaved stream.
Playback writes the same sample to every channel, because the radio's input is mono.

## The capture callback never allocates

The callback (`InputCallbackState::on_data`) does three things and returns:

1. copies channel 0 into a lock-free SPSC ring (`rtrb`, 20 s at the device rate);
2. pushes one stamp (first frame index, frame count, capture UTC) into a second ring;
3. bumps atomic counters.

It takes no lock, does no logging and runs no DSP. The capture UTC is the system clock at the
callback, less the latency cpal reports between capture and callback. If either ring lacks
room for the whole callback, the callback writes nothing and counts the frames as an overrun.
All-or-nothing keeps every sample in the ring stamped, and makes a drop visible downstream as
a gap in the stamps' frame indices. The pipeline turns that gap into a zero-filled hole and a
new clock epoch; it is never spliced over.

`crates/z30-io/tests/callback_alloc.rs` runs that body under a counting global allocator. It
asserts **zero allocations** across callbacks, and that an overrun is reported as a gap. The
`z30 --benchmark perf` counter reports allocations *per decoded slot*. Those happen on the
decode thread, which may allocate; the audio thread may not.

## Rate conversion

The shipped receiver used an 8-tap moving average plus linear interpolation. That filter was
only 3.9 dB down at the new Nyquist, and it folded 3–9 kHz sound-card noise into the z-30
band (audit M2).

`Resampler` is a streaming rational L/M polyphase resampler. Its Kaiser-windowed sinc prototype
is designed for **≥ 80 dB** stopband, with the transition band at the edge of the output band,
so aliases land above the z-30 passband
(`passes_the_band_and_rejects_aliases` asserts that a 4.5 kHz tone, which would alias onto
1.5 kHz, arrives at least 70 dB down from 48 and 44.1 kHz). It accepts any device rate: 48 000, 44 100 (L/M =
20/147), 96 000, and so on. Over a long stream, the output count is exactly
`in × out / in_rate` to within one sample.

`input_delay()` gives the input instant that output sample 0 represents, which is
−1 − (N−1)/(2L) input samples for an N-tap prototype. The pipeline uses it so that every 6 kHz
sample is dated at the moment it represents, not at the moment it left the filter. The
clock-model and soak tests depend on this (see [synchronization.md](synchronization.md)).

## The receive pipeline (`RxPipeline`, on the DSP thread)

```
AudioInput::next_block  (contiguous frames + stamp)
  -> clock model observation (frame index, capture UTC)
  -> resample to 6 kHz
  -> SlotStore: 70 s ring addressed by absolute 6 kHz sample index
  -> scheduler: a slot window [slot-1.5 s, slot+25.5 s] is ready when every sample is stored
  -> SlotJob to the decode thread (bounded; a full queue is a reported DecoderBusy miss)
  -> waterfall rows to the GUI (bounded; dropped if the GUI is behind)
```

The DSP thread waits for at most one tenth of a second of audio at a time. It never blocks on
the decoder or the GUI.

## Transmit audio

`tx_audio` synthesises the frame at the **output device's** rate through the one modulator:
constant envelope, a 20 ms ramp at each end, peak-normalised, scaled by the configured level.
It pushes it into a 30 s SPSC ring the output callback drains, so `play` never blocks. `stop`
(on halt, or at the end of a frame) flushes the ring from inside the callback.

The transmit timeline is a pure function of UTC (`TxScheduler`):

- plan and gate check 0.6 s before the slot;
- key 50 ms before the audio;
- audio timed to leave the device at the slot boundary, allowing for the output latency the
  device reported when the station started;
- unkey 50 ms after the frame.

This has been verified under the virtual clock. On real hardware it is not yet verified: the
latency cpal reports differs between drivers, and the closing check of any installation is a
received frame showing DT ≈ 0 at another station.
