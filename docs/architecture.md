# Architecture

## Crates

```
crates/
  z30-protocol   What goes on the air, and nothing else. Constants, Costas array, CRC-14,
                 LDPC (216,77) code and encoder, v1 message codec, symbol mapping, GFSK modulator.
                 #![forbid(unsafe_code)], no I/O.
  z30-dsp        The receiver. decode_slot(samples, config) -> SlotReport. Resampler, slot FFT,
                 spectrogram, Costas search, fine sync, demodulator, LDPC cascade + OSD, AP, SIC.
                 Pure: no devices, files, clocks or logging; rayon inside decode_slot only.
  z30-channel    Test tooling: seeded AWGN, Watterson fading, drift, ppm, CW, K-station bands.
                 Nothing on the receive path depends on it.
  z30-engine     The station, with no OS I/O: sample clock <-> UTC, slot store and scheduler,
                 receive pipeline, transmit gate, band plan, rig readback, PTT controller and
                 watchdog, QSO sequencer, log-record provenance, configuration model,
                 Command -> Engine -> Event / EngineSnapshot. Every port is a trait.
  z30-io         The adapters: cpal audio, WAV, rigctld, serial RTS/DTR, CM108 (feature),
                 SQLite + ADIF logbook, paths, TOML config, legacy migration, system clock.
  z30-cli        The headless `z30` binary. Receive-only by construction.
  z30-gui        The egui/eframe desktop binary `z30-gui`.
  z30-py         PyO3 bindings for research/ (not shipped to operators).
```

Dependency direction: `z30-protocol` <- `z30-dsp` <- `z30-engine` <- `z30-io` <- (`z30-cli`,
`z30-gui`). `z30-channel` is used by tests, the CLI benchmark and `z30-py`. The crate graph
enforces the direction: the DSP cannot open a device, and the engine cannot touch a file.

## One receiver

`z30_dsp::slot::Receiver::decode_slot` is the only receive entry point. The engine's decode
thread, `z30 --decode`, `z30 --benchmark` and the Python research harness (through `z30-py`)
all call it with the same `RxConfig` defaults. A figure measured by any of them is a figure
about the receiver an operator runs. That is the structural answer to the failure recorded
in `AGENTS.md` section 4, where the benchmark and the live-receive decoder had different
demodulators for months.

## One modulator

`z30_protocol::gfsk::Modulator` produces the transmitted waveform, the SIC replica and the
test channels' signals. The audit found the shipped SIC subtracting a waveform the transmitter
no longer sent (C3). With one modulator that cannot recur. Tune is the same modulator's frame
with one constant symbol at the centre of the tone span (`runtime::tx_audio`); it used to be a
separately generated sine with linear ramps (2026-09-28 audit F-49), the one exception, now
gone (`gate_contract.rs::f49_tune_is_the_one_modulators_unmodulated_carrier_at_the_span_centre`).
`gfsk::tests::the_analytic_replica_is_the_transmitted_waveform` pins the replica to the
transmitted samples within 1e-6.

## Threads (`z30_engine::runtime`)

```
audio callback (z30-io)  --SPSC ring (rtrb)-->  AudioInput::next_block
DSP thread       RxPipeline: resample to 6 kHz, file by absolute sample index,
                 clock model, scheduler, waterfall rows            -> SlotJob
decode thread    Receiver::decode_slot (rayon inside)              -> SlotReport
rig thread       RigControl polls every poll_interval_ms, never inside
                 the PTT settle window                              -> Reading
control thread   Engine (commands, sequencing, gate) + TxScheduler -> PTT, audio out
log thread       LogSink (SQLite)                                   -> Logged / LogFailed
PTT watchdog     independent deadline on the keyed line; retries an unconfirmed release
clock status     the OS synchronisation query (timedatectl), cached
HALT             RuntimeHandle::halt, on the caller's thread: output stop + PTT release + flag
```

Nothing that can block for long runs on the control thread: the SQLite logbook has its own
thread, and the OS clock-status query runs on a thread of its own and is read from a cache. The
GUI's HALT does not go through the command queue at all (see [safety.md](safety.md#ptt-one-keying-implementation-and-what-releases-it)).

Every channel is bounded. A full decode queue reports the slot as missed with
`MissReason::DecoderBusy`; it never blocks the DSP thread. The audio callback copies,
stamps and counts; it never allocates or locks, and a test enforces that (see
[audio.md](audio.md)).

## Commands in, snapshots out (`z30_engine::api`)

User interfaces own no radio state. They send `Command`s: `UpdateConfig`, `SetDial`,
`SetAudioFrequencies`, `CallCq`, `Answer`, `EnableTx`, `HaltTx`, `Tune`, `ResetQso` and the
rest of the enum. They render the latest `EngineSnapshot`, published through `ArcSwap`
(latest wins) and consumed from a bounded event channel. The GUI never blocks the engine, and
the engine never waits for the GUI. A frozen window cannot hold a transmitter keyed: the
engine's own state machine, the watchdog thread and process-exit release are all independent
of it (see [safety.md](safety.md)).

## Time

The audio sample counter is the master clock. UTC is a model fitted to it: a least-squares line
over a 120 s sliding window of (sample index, capture UTC) observations. A slot is decoded when
the store holds every sample of its window, not when a UI timer fires. See
[synchronization.md](synchronization.md#the-slot-clock-z30-engine-clockrs-slotsrs-pipeliners).

## What is not part of this graph

z-30's production application is the graph above and nothing else. There is no fallback path:
if audio, rig control or PTT cannot be opened, the program reports the failure and does not
start something else in its place. The GUI keeps receiving if it can, and refuses to transmit
(`HardwareUnavailable`) while the output or keying line is unavailable; a logbook that cannot be opened is a persistent
red banner and every contact is reported "not logged", never kept in memory in its place.

`legacy/` holds, outside it:

- `legacy/python-oracle/`: the frozen Python implementation of v1 and its reference receiver.
  Golden vectors are generated from it and `research/paired_receiver.py` measures
  `decode_slot` against it. No crate depends on it; it has no entry points.
- `legacy/browser-runtime/`: the retired browser/PWA transceiver, kept as a reference (its
  TypeScript codec defines `fixtures/golden/messages.json`) and for reproducing the audits'
  findings. Not built, served or installed.

```text
legacy/python-oracle --golden vectors--> fixtures/golden --tests--> crates/
legacy/python-oracle <--paired comparison (research/, via z30-py bindings)--> decode_slot
```

Never the other way round: nothing in `crates/` reads, calls or falls back to anything in
`legacy/`. See [`legacy/README.md`](../legacy/README.md).
