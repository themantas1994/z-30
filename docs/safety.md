# Operating safety

**This software keys real transmitters.** A defect here does not produce a stack trace. It
produces an out-of-band or stuck transmission on somebody's licence. The rule that governs
everything on this page: **if anything is uncertain, refuse to transmit.**

Every rule below has a test, and a failing test means the change is wrong, not the test
(`AGENTS.md` section 4). Test names are from `crates/z30-engine/tests/safety.rs` unless stated
otherwise.

## The transmit gate (`z30_engine::txgate::can_transmit`)

There is one check in front of every transmit path: the sequencer, manual TX and tune. It
**fails closed** and returns **every** violation, never a partial "allowed" (`g4`). It is a
port of `canTransmit()` in `src/dsp/catController.ts`, with every rule kept and some added,
each only ever adding a refusal.

| Violation | Refuses when | Test |
| :--- | :--- | :--- |
| `NoCallsign`, `PlaceholderCallsign`, `MalformedCallsign` | no call, `NOCAL`, not a callsign | `g1`, `callsign_syntax_matches_the_shared_vectors` |
| `CallsignNotRepresentable` | v1 would transmit a **different** callsign (`ZY2ABC`, `EA8/G4XYZ`, `G4XYZ/P`) | `c5` |
| `NoRegion`, `NoLicenseClass`, `ClassNotInRegion` | regulatory region and licence class not both set and consistent | `g2` |
| `FrequencyUndetermined`, `AudioOffsetOutOfRange` | dial or audio frequency unusable; tone 0 below 200 Hz or tone 15 above 2800 Hz | `g3` |
| `OutOfBand` | the **radiated** emission, dial + audio offset across the tone span widened to the measured −40 dB width (66 Hz), is not wholly inside a permitted data segment for the region and class | `g3` |
| `RigDialDisagrees` | a settled rig readback contradicts the dial being checked | `r1`, `r6` |
| `MessageNotEncodable` | the message cannot round-trip through the v1 codec | `g5` |
| `MessageNotFromStation` | the frame's sender field is not this station | `g5` |
| `PttNotConfigured` | no keying method is configured | `h1` |
| `HardwareUnavailable` | the audio output or keying line could not be opened | `h1` |

Callsign syntax is checked against the shared vectors in
`tests/vectors/callsign_vectors.json`, the same file the TypeScript and Python validators are
tested against. The band plan (`bandplan.rs`) is a port of `src/dsp/bandPlan.ts`: IARU R1–R3 and
FCC Part 97 data segments, national variations not modelled. The operator remains responsible
for their emissions.

The GUI shows the gate's verdict, with every violation and its reason, **before** a
transmission is enabled, and again at each slot. The CLI never transmits at all.

## Rig readback: refusing a contradiction, and only that

The band-plan check reasons about the dial this software commanded. Where the radio can be read
back, `RigStateTracker` (a port of WSJT-X's polling model, via `rigStateTracker.ts`) supplies
what the radio actually reports, and the gate refuses a **settled contradiction**. Three
exclusions keep it from grounding stations that work, and each has a test:

- no readback means "unverified", not "wrong" (`r2`);
- a QSY is unsettled until three polls agree (`POLLS_TO_STABILIZE`), and is not a refusal
  meanwhile (`r3`);
- a difference inside the rig's measured tuning resolution is not a refusal (`r4`).

Readings are not taken inside the 100 ms PTT settle window (`r5`).

## PTT: one keying implementation, and what releases it

- **One keying implementation.** Every path keys through `PttController::key`, which returns
  whether the hardware accepted the command. A key the hardware refused leaves nothing keyed
  (`z2`). VOX, which cannot confirm anything, reports `Unverifiable` and never "verified"; with
  no PTT configured, nothing can key (`z2b`).
- **A release drives what the key drove.** The controller holds exactly one line object, and a
  release goes to that object (`z1`). Replacing the line while keyed unkeys the old one first
  (`z1b`).
- **Halt means halt.** `HaltTx` stops the audio and unkeys. A halt that arrives between the
  transmit decision and the key abandons the transmission rather than keying it (`h2`, found and
  fixed during this rebuild).

### Four independent stuck-transmitter layers

Each defends against a different failure. Do not merge them.

1. **The engine's TX state machine** ends every frame and unkeys 50 ms after the audio.
2. **The watchdog thread** shares nothing with the engine loop except the line. It unkeys at
   `MAX_TX_SECONDS` = **40 s** (a frame is 24 s) whatever the engine is doing: a hung loop, a
   lost unkey (`p4`, `p4b`). The limit is a compile-time constant that no configuration can
   raise (`p4c`).
3. **Process exit, panic and termination signals.** A panic hook, a `Drop` guard and, in the
   GUI, a SIGINT/SIGTERM/SIGHUP (and Windows console-close) handler all call
   `emergency_release_all`, which releases every live line in the process
   (`crates/z30-engine/tests/emergency.rs`, `p5`).
4. **Hardware.** Serial RTS/DTR are dropped by the OS when the port closes, even after SIGKILL.

What no software layer can cover is SIGKILL or a power cut to the computer while a **CAT- or
CM108-keyed** radio stays powered. **Enable the radio's own transmit time-out timer.**
[hardware.md](hardware.md) has the per-method table.

## Messages: refuse, never transform

The v1 codec refuses anything it cannot carry exactly (see [protocol-v1.md](protocol-v1.md)),
and the gate checks the encoded frame again. The shipped software transmitted other stations'
callsigns, other grids and reports without their roger. vNext refuses each, with a reason.

## Time

vNext **never changes the system clock** and never derives UTC from a received signal. The
legacy RF time sync could "succeed" on noise and persist a 27 s offset (audit H4). Its offset
is deliberately not migrated, and it has no vNext counterpart. The status bar and
`z30 --diagnostics` report what the operating system says about its own synchronisation.

## No network API

The legacy runtime needed a loopback HTTP server (`web_server.py`) with a bearer token, Origin
and Host checks, because a browser cannot open a serial port. vNext is a native program and
listens on **no** port. Its only network traffic is the outbound connection to the configured
`rigctld`.

## Logged data

A logbook record holds only what was received, measured, sent, read back from the rig,
commanded, configured or entered, and each field carries that provenance. A field nothing
supplied is absent. The shipped auto-logger wrote local time as UTC and a default grid and
report when nothing had been received (audit H1). Legacy records are imported with
`legacy_import` provenance, because the import cannot tell a received value from a fabricated
one. Configured power is shown as configuration. Forward power and SWR are "not measured"
because nothing measures them.
