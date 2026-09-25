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
port of `canTransmit()` from the retired browser runtime
(`legacy/browser-runtime/src/dsp/catController.ts`), with every rule kept and some added, each
only ever adding a refusal.

| Violation | Refuses when | Test |
| :--- | :--- | :--- |
| `NoCallsign`, `PlaceholderCallsign`, `MalformedCallsign` | no call, `NOCAL`, not a callsign | `g1`, `callsign_syntax_matches_the_shared_vectors` |
| `CallsignNotRepresentable` | v1 would transmit a **different** callsign (`ZY2ABC`, `EA8/G4XYZ`, `G4XYZ/P`) | `c5` |
| `NoRegion`, `NoLicenseClass`, `ClassNotInRegion` | regulatory region and licence class not both set and consistent | `g2` |
| `FrequencyUndetermined`, `AudioOffsetOutOfRange` | dial or audio frequency unusable; tone 0 below 200 Hz or tone 15 above 2800 Hz | `g3` |
| `OutOfBand` | the **radiated** emission, dial + audio offset across the tone span widened to the measured −40 dB width (66 Hz), is not wholly inside a permitted data segment for the region and class | `g3` |
| `RigDialDisagrees` | a settled rig readback contradicts the dial being checked | `r1`, `r6` |
| `RigModeNotUsb` | a fresh rig reading reports a mode other than `USB`/`PKTUSB` (the emission check assumes USB; audit L-07) | `l7` |
| `MessageNotEncodable` | the whole frame does not read back as the requested message: encoded, then symbols → Costas check → codeword (and the info bits it carries) → every parity check → CRC → fields → text, and finally the frame rebuilt from the message alone must be identical symbol for symbol. Partner callsign, grid and report included, not just our own call (audit C-06); a hand-built off-table grid or out-of-range report is refused, not panicked on | `g5`, `g6`, `n3_the_gate_refuses_every_corrupted_frame…`, `z30-protocol/tests/{round_trip,frame_integrity}.rs` |
| `FrameNotForMessage` | the frame offered is a valid frame of a *different* message | `n3_a_valid_frame_of_a_different_message_is_refused` |
| `MessageNotFromStation` | the frame's sender field is not this station | `g5` |
| `PttNotConfigured` | no keying method is configured | `h1` |
| `HardwareUnavailable` | the audio output or keying line could not be opened | `h1` |
| `TxAudioLevelZero` | the transmit level is 0 (a new installation's), which would key the radio with no signal (audit N-09) | `n9` |

### What is verified is what is transmitted

The round trip is not a check the transmit path *may* call; it is the only way to obtain
something the transmit path accepts. `EncodedMessage::verify` is the sole constructor of
`z30_protocol::codec::VerifiedFrame` (a private field; a `compile_fail` doctest pins that). The
gate returns that object in `Permission::frame`, `plan_tx` puts it in the plan
(`TxKind::Frame(Box<VerifiedFrame>)`), and `runtime::tx_audio` modulates it and nothing else.
Before 2026-09-24 the gate verified one encoding, `plan_tx` transmitted a second one, and three
mutations that switched the round trip off survived the whole test suite (post-remediation audit
N-03, C06-a/b/c). Now every kind of corrupted frame is shown to the gate itself
(`can_transmit_encoded`) and refused, and the audio of a planned frame is decoded by
`decode_slot` back to the message (`n3_the_transmitted_audio_is_the_verified_frame…`). Symbol
count and frame length are fixed by type (`[u8; 75]`) and checked on the audio. `z30 --encode`
also writes only verified frames, because a WAV file can be played into a radio.

Callsign syntax is checked against the shared vectors in
`tests/vectors/callsign_vectors.json`, the same file the TypeScript and Python validators are
tested against. The band plan (`bandplan.rs`) is a port of the legacy `bandPlan.ts`: IARU R1–R3
and FCC Part 97 data segments, national variations not modelled. The operator remains
responsible for their emissions.

**USB is assumed.** The emission is computed as dial + audio offset, which is upper sideband.
When rig control reads the radio's mode and the reading is fresh, any mode other than `USB` or
`PKTUSB` is refused (`RigModeNotUsb`, audit L-07). Without rig control the mode cannot be known
and is not checked: operate in USB (or the radio's USB data mode).

**No real callsign is a default.** A new installation has an empty callsign, no region, no
licence class, no PTT method, no dial frequency and a transmit level of 0, and the gate refuses
until all are set (`config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`). The retired browser
bundle defaulted to the real station W1AW (audit C-04); CI scans the release binaries for it.

The GUI shows the gate's verdict, with every violation and its reason, **before** a
transmission is enabled, and again at each slot. The CLI never transmits at all.

## Loopback tests cannot become transmissions

`z30 --loopback-test` is a **software** loopback: the frame goes from the transmit synthesis to
the receive chain as samples in memory. The code that runs it has no audio output, PTT line or
rig control in it, and `crates/z30-cli/tests/loopback_isolation.rs` fails if one is added or if
the flag is routed to the sound-card test. Until 2026-09-24 this flag played the frame through
the configured sound card with no transmit gate in front of it, so a VOX radio on that output
would have radiated it (post-remediation audit N-04).

The sound-card test (hardware validation A1) is the separately named `--audio-loopback-test`.
It keys nothing. Because nothing in software can see what an audio output is wired to, it
refuses, before opening any device, unless `--confirm-no-transmitter` is given **and** the
configuration it runs with has no PTT method (VOX included) and no rig control
(`audio_loopback::tests`). A radio on VOX wired to a sound card that a *PTT-less* configuration
drives is outside what software can detect: that is what the confirmation states.

## Rig readback: refusing a contradiction, and only that

The band-plan check reasons about the operator's dial (there is no default; with none set the
gate refuses, `FrequencyUndetermined`). Where the radio can be read
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
and the gate reads the encoded frame back again before every transmission. The retired software
transmitted other stations' callsigns, other grids and reports without their roger. z-30
refuses each, with a reason, and transmits nothing in its place.

## Reports sent

The report in a `-NN` message is this receiver's measurement of the other station
(`qso::report_for`), rounded and limited to v1's −30…+30 dB. The SNR estimate behind it is
measured against the truth from −22 to +30 dB ([receiver.md](receiver.md#reported-snr-dt-and-frequency));
the previous estimator saturated near +6.6 dB, so a +20 dB station was sent "+07" (audit M-07).
When there is no signal estimate at all, no report message is sent.

## Time

z-30 **never changes the system clock**, applies no offset of its own and never derives UTC
from a received signal. The legacy RF time sync could "succeed" on noise and persist a 27–30 s
offset (audits H4 / C-03). Its offset is deliberately not migrated, and it has no counterpart.
The status bar and `z30 --diagnostics` report what the operating system says about its own
synchronisation, and never claim "synchronised" when it cannot be asked.

## No network API

The retired runtime needed a loopback HTTP server (`web_server.py`, now deleted) with a bearer
token, Origin and Host checks, because a browser cannot open a serial port; it also served
`./dist` from the working directory first (audit L-02). z-30 is a native program: it listens on
**no** port, serves no files, and makes no network request at startup. Its only network
traffic is the outbound connection to the configured `rigctld`.

## Logged data

A logbook record holds only what was received, measured, sent, reported by the radio,
commanded, configured or entered, and each field carries that provenance. A field nothing
supplied is absent.

The dial frequency, in particular, claims no more than its evidence (post-remediation audit
N-05, where a default 14.076 MHz reached the log tagged "commanded" on a station with no rig
control; `crates/z30-engine/tests/dial_provenance.rs`):

| Logged as | Only when |
| :--- | :--- |
| `reported_by_rig` | a CAT reading from the radio, fresh (≤ 6 s) when the contact is logged; the radio's own value |
| `commanded` | z-30 sent the radio a set-frequency for exactly this dial **and the radio acknowledged it**, but no fresh reading confirms it |
| `configured` | the operator's setting, which nothing has sent to or read from a radio |
| absent | no dial is set and no radio reported one |

A refused set-frequency, an acknowledgement for a dial the operator has since changed, and a
stale reading are none of these stronger things. Logbooks written before this change are
migrated on open: their `commanded` becomes `configured` (every such value was the operator's
setting; whether it ever reached a radio was not recorded), and 0 Hz placeholders become absent. The retired auto-logger wrote local time as UTC and a default grid and
report when nothing had been received (audits H1 / C-05). A record with no partner callsign or
no plausible UTC time is refused by `QsoRecord::validate`, in the engine and again by the
logbook. Legacy records are imported with `legacy_import` provenance, because the import cannot
tell a received value from a fabricated one. Each legacy writer's defaults are dropped from the
entries it wrote (identified by the legacy entry id): the auto-logger's grid FN31, report −16
and "frequency" (its configured dial plus the receive audio offset, not a dial); the manual
form's FN31 and band default dial; the legacy ADIF importer's −15 reports and 14.076 MHz. Every
drop is listed in the migration report. Configured power is shown as configuration. Forward power and SWR are "not measured"
because nothing measures them.
