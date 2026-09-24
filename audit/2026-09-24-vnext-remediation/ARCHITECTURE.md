# Architecture after the remediation

## The production application

One implementation: the Rust workspace in `crates/`. Two binaries, `z30-gui` and `z30`, built
from it. No Python, Node, browser, web server or other runtime is involved in receiving,
transmitting, logging or keeping time, and there is no fallback path: a failure to open audio,
PTT or rig control is reported and nothing else is started.

```text
                     ┌─────────────────────────────┐        ┌──────────────────────────────┐
                     │  z30-gui (egui)             │        │  z30 (CLI)                   │
                     │  renders snapshots,         │        │  receive-only station,       │
                     │  sends commands, no DSP     │        │  decode/encode, diagnostics, │
                     └──────────────┬──────────────┘        │  migrate, loopback test,     │
                                    │                       │  benchmark suite             │
                     ┌──────────────▼──────────────┐        └───────┬──────────────────────┘
                     │  z30-engine                 │◄───────────────┘
                     │  runtime threads: DSP,      │
                     │  decode, rig, control, PTT  │
                     │  watchdog; sample clock;    │
                     │  slot scheduler; QSO FSM;   │
                     │  transmit gate; rig tracker │
                     └───┬──────────┬─────────┬────┘
                         │          │         │
          ┌──────────────▼──┐  ┌────▼──────┐  ┌▼──────────────┐
          │  z30-dsp        │  │  z30-io   │  │ z30-protocol  │
          │  decode_slot:   │  │  cpal,    │  │ codec (refuses│
          │  acquisition,   │  │  rigctld, │  │ what v1 cannot│
          │  demod, LDPC,   │  │  RTS/DTR, │  │ carry), CRC,  │
          │  AP, LS-SIC,    │  │  CM108,   │  │ LDPC encoder, │
          │  SNR/DT measure │  │  SQLite + │  │ GFSK modulator│
          └─────────────────┘  │  ADIF,    │  └───────────────┘
                               │  migration│
                               └────┬──────┘
                                    │
                             real hardware (not yet exercised)
```

Receive path, as implemented and tested end to end
(`crates/z30-engine/tests/live_runtime.rs`):

```text
audio device (cpal) → capture callback (no allocation) → SPSC ring → DSP thread:
  polyphase resampler to 6 kHz → sample store by absolute index → sample-clock model (UTC fit,
  drift) → slot scheduler (emits a slot only when [slot−1.5 s, slot+25.5 s] is complete)
→ decode thread: decode_slot = slot FFT → Costas candidate search → per-candidate baseband →
  fine dt/f/drift → symbol spectra → non-coherent Log-MAP LLRs → LDPC cascade + corrected OSD →
  CRC → (AP if enabled) → replica fit (DT, SNR) → duplicate suppression → LS-SIC → passes 2, 3
→ control thread: engine (decode history, QSO sequencer, logging with provenance)
→ snapshot → GUI / CLI
```

Transmit path:

```text
sequencer / manual / tune → engine.plan_tx (0.6 s before the slot) → can_transmit (callsign,
region/class, radiated emission in band, rig readback, whole-frame round trip, PTT configured,
hardware open) → Modulator → TxScheduler (key, audio, unkey) → PttController (one keying
implementation, watchdog at 40 s) → audio output / PTT line
```

## Outside the production graph

```text
legacy/python-oracle  ──golden vectors──►  fixtures/golden  ──tests──►  crates/
legacy/python-oracle  ◄──paired comparison (research/paired_receiver.py, via z30-py)──►  decode_slot
legacy/browser-runtime ──messages.json (whole-message packing reference)──►  fixtures/golden
```

Nothing in `crates/` imports, calls, reads or falls back to anything in `legacy/`. CI
(`ci.yml`, job `hygiene`) fails if the retired runtime's files reappear in the production tree.

## Duplication, before and after

| Function | Before (2026-09-24 audit §6) | After |
| :--- | :--- | :--- |
| Protocol encoder/decoder, LDPC, AP | Python oracle, TypeScript legacy, Rust vNext | Rust (production); Python oracle (frozen reference); TS codec (frozen reference for `messages.json`) |
| Receivers | `acquisition.py` (benchmark), `sic_decoder.py`, `realReceiver.ts` (legacy live), `decode_slot` | `decode_slot` only in any operating path; the oracle's reference receiver in research only |
| Time sync engines | Python RF sync, TS RF sync | none (OS clock); legacy TS copy fails closed |
| Setup wizards | two | none (GUI settings, `--migrate`) |
| Benchmark engines | `benchmark.py`, `monteCarloEngine.ts`, `z30 --benchmark` | `z30 --benchmark` (production); `benchmark.py` for oracle research only |
| Launchers / installers | `z30` Python launcher with Tk and benchmark fallbacks; 6 install scripts; PKGBUILD; PyInstaller | release archives of the two binaries; `cargo install` |
