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
in `AGENTS.md` section 4, where the benchmark and the on-air decoder had different
demodulators for months.

## One modulator

`z30_protocol::gfsk::Modulator` produces the transmitted waveform, the SIC replica and the
test channels' signals. The audit found the shipped SIC subtracting a waveform the transmitter
no longer sent (C3). With one modulator that cannot recur.
`gfsk::tests::the_analytic_replica_is_the_transmitted_waveform` pins the replica to the
transmitted samples within 1e-6.

## Threads (`z30_engine::runtime`)

```
audio callback (z30-io)  --SPSC ring (rtrb)-->  AudioInput::next_block
DSP thread       RxPipeline: resample to 6 kHz, file by absolute sample index,
                 clock model, scheduler, waterfall rows            -> SlotJob
decode thread    Receiver::decode_slot (rayon inside)              -> SlotReport
rig thread       RigControl polls, respecting the PTT settle window -> Reading
control thread   Engine (commands, sequencing, gate) + TxScheduler -> PTT, audio out
PTT watchdog     independent deadline on the keyed line
```

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
[synchronization.md](synchronization.md#the-slot-clock).

## Legacy runtime

The browser app (`src/`), `z30_dsp/web_server.py`, the Tk tools and RF time sync are still in
the repository and still tested by the old CI. Retiring them is an operator decision, taken
after the side-by-side run in Phase 5 (`VNEXT_IMPLEMENTATION_PLAN.md`). The Python modules
`z30_dsp/{modem,ldpc,message_codec,acquisition,channel,ap_decode,benchmark}.py` are the frozen
oracle: golden vectors are generated from them, and `research/paired_receiver.py` measures
vNext against them.
