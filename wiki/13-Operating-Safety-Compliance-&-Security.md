# 13. Operating Safety, Compliance & Security

z-30 keys real transmitters. A defect here does not produce an error message; it produces an
out-of-band, wrongly identified or stuck transmission on somebody's licence. Every rule on this
page has a test behind it (`crates/z30-engine/tests/safety.rs` unless stated), and the full
engineering reference is [`docs/safety.md`](../docs/safety.md).

> **None of this has been exercised against a real radio.** The rules are tested against
> simulated lines and scripted `rigctld` servers. Transmit into a dummy load first and follow
> [`docs/hardware-validation.md`](../docs/hardware-validation.md).

## The transmit gate

Every transmission — the sequencer, manual TX and tune — passes one check,
`z30_engine::txgate::can_transmit`. It **fails closed** and reports **every** violation, never a
partial "allowed". The GUI shows its verdict before you enable TX and again at every slot.

| Refuses when | Why |
| :--- | :--- |
| no callsign, the `NOCAL` placeholder, or a malformed callsign | an unidentified transmission, or one under someone else's call |
| a callsign v1 would transmit as a **different** callsign (`ZY2ABC`, `G4XYZ/P`, `EA8/G4XYZ`) | the 28-bit field cannot carry it; sending it would identify as another station |
| no regulatory region or licence class, or a class not valid in the region | band edges and privileges cannot be guessed |
| the **radiated** emission — dial + audio offset, across the tone span, at the measured −40 dB width (66 Hz) — is not wholly inside a permitted data segment | the radiated frequency is not the dial frequency |
| tone 0 below 200 Hz or tone 15 above 2800 Hz | outside the audio range the transmitter uses |
| the radio, read back through `rigctld`, has settled on a different dial | the band-plan check was about a frequency the transmitter is not on |
| the frame does not read back — symbols, parity, CRC, every field, text — as exactly the requested message | never transmit a different partner call, grid or report than the one shown (audit C-06) |
| the frame is not sent from this station's callsign | |
| no PTT method configured, or the audio output / keying line could not be opened | a gate that passes a station that cannot key is uncertainty reported as permission |

**No readback is "unverified", not "wrong":** a station without `rigctld` transmits under the
other checks. An unsettled QSY and a difference inside the rig's tuning resolution are not
refusals either. (The probe that measures a rig's resolution is not wired in yet, so the
tolerance is currently a strict 1 Hz; see [06](06-Transceiver-CAT-Control-&-PTT-Wiring.md).)

**No default callsign.** A new installation has no callsign, region, licence class or PTT
method, and the gate refuses until all are set. The retired browser app shipped the real station
W1AW as its default (audit C-04); CI now scans every release binary for it.

**USB only.** The emission is computed as dial + audio (upper sideband). z-30 does not set the
radio's mode; operating in LSB would put the signal somewhere the gate did not check.

The band plans (IARU Regions 1–3 and FCC Part 97 data segments) are compile-time data, not
configuration. National variations are not modelled: the gate catches a mistuned dial or wrong
band, it does not replace knowing your licence conditions.

## PTT: one keying implementation, and what releases it

- Every path keys through one controller, which reports whether the hardware accepted the
  command. A key the hardware refused leaves nothing keyed. VOX, which cannot confirm keying,
  says so and never reports "verified".
- A release goes to exactly the line the key drove.
- **Halt means halt**: a halt between the transmit decision and the key abandons the
  transmission instead of keying it.

Four independent layers stop a stuck transmitter; each covers a different failure:

| Layer | Covers |
| :--- | :--- |
| The transmit timeline unkeys at the end of the frame | normal operation |
| A watchdog thread unkeys at `MAX_TX_SECONDS` = 40 s (a frame is 24 s), independent of the engine and the GUI; the limit is a compile-time constant | a hung engine or GUI |
| A panic hook and SIGINT/SIGTERM/SIGHUP / console-close handlers release every line | crashes and normal termination |
| The operating system drops RTS/DTR when the serial port closes | even SIGKILL, for serial PTT |

**CAT- and CM108-keyed radios are not released after SIGKILL or a power cut to the computer**:
nothing in software runs then. Enable the radio's own transmit time-out timer. WSJT-X has the
same limitation.

## Time

z-30 never changes the system clock, applies no offset of its own, and has no RF or network time
source. It reports the operating system's own synchronisation status and never claims
"synchronised" when it cannot ask. The legacy RF time sync reported success on noise and
persisted the result (audit C-03); it is gone, and its offsets are never migrated
([07](07-RF-Time-Synchronization-Engine.md)).

## The logbook records only what happened

A log record holds what was received, measured, sent, read back from the rig, commanded,
configured or entered — and each field says which. A field nothing supplied is left empty:

- no grid received → no grid logged (the retired logger wrote `FN31`);
- no report received → none logged (it wrote `-16`);
- no distance field at all (it computed one from the default grid `EM00`);
- times are UTC, computed from slot numbers, independent of the computer's time zone (it wrote
  local time labelled UTC);
- the dial is marked `rig_verified` only when the radio confirmed it, otherwise `commanded`;
- power is the power you *configured*, labelled as configuration; forward power and SWR are "not
  measured" because nothing measures them.

A record with no partner callsign or no plausible UTC time is refused, not written. ADIF exports
carry the provenance in `APP_Z30_PROVENANCE`. Imported legacy records are marked `legacy_import`,
and on entries the old auto-logger wrote, its default grid and report are dropped because they
cannot be told apart from its fabrications (`crates/z30-io/tests/logbook_integrity.rs`,
`crates/z30-engine/tests/qso_logging.rs`).

## Reports you send

The report in your `-NN` message is this receiver's measurement of the other station, rounded
and limited to v1's −30…+30 dB. The estimator is measured against the truth from −22 to +30 dB
([16](16-Benchmarking-Testing-&-CI.md)); its predecessor saturated near +6.6 dB and sent a +20 dB
station "+07" (audit M-07). With no signal estimate, no report is sent.

## No network service, no startup traffic

z-30 is a native program. It listens on no port, serves no files, needs no token, makes no
network request at startup and checks for no updates. Its only network connection is the
outbound one to the `rigctld` you configure. (The retired runtime ran a loopback HTTP server
with token, Origin and Host checks, contacted GitHub and Google Fonts at every launch, and
served `./dist` from the working directory; all deleted.)

## What is still on you

- Your licence conditions, national band plan and identification rules.
- A clean signal: keep ALC at zero; check the spectrum on another receiver before operating.
- The radio's own TX time-out timer, for CAT and CM108 keying.
- A correct clock (±1.5 s total budget).
- Validating your own hardware before the first on-air transmission.
