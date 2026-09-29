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
| the **radiated** emission — dial + audio offset, across the tone span, at the measured −40 dB width (66 Hz) — is not wholly inside a permitted segment (US: a data segment, or on 60 m a channel; IARU regions: an amateur band, see below) | the radiated frequency is not the dial frequency |
| tone 0 below 200 Hz or tone 15 above 2800 Hz | outside the audio range the transmitter uses |
| the radio, read back through `rigctld`, has settled on a different dial | the band-plan check was about a frequency the transmitter is not on |
| the frame does not read back — symbols, parity, CRC, every field, text — as exactly the requested message | never transmit a different partner call, grid or report than the one shown (audit C-06) |
| the frame is not sent from this station's callsign | |
| no PTT method configured, or the audio output / keying line could not be opened or has failed since | a gate that passes a station that cannot key is uncertainty reported as permission |
| the last PTT release was not confirmed by the hardware | the transmitter may still be keyed; z-30 keeps retrying the release |
| the radio refused the last set-frequency, and has not reported the dial since | the frequency the emission would be on is unknown |
| a transmit level of 0, or one that is not a number or is above full scale | 0 keys a silent transmitter; above full scale clips and radiates wider than the emission checked |

**No readback is "unverified", not "wrong":** a station without `rigctld` transmits under the
other checks. An unsettled QSY is not a refusal either. A difference inside the rig's tuning
resolution would not be, but the probe that measures a rig's resolution is not wired in, so
**the tolerance is a strict 1 Hz**: a radio that quantises its dial can be refused on a
frequency that is not a multiple of its tuning step
([06](06-Transceiver-CAT-Control-&-PTT-Wiring.md#reading-the-rig-back)). The radio is also
watched during a frame: a settled dial contradiction or a non-USB mode read while transmitting
stops the transmission and raises a TX fault.

**No default callsign.** A new installation has no callsign, region, licence class, PTT
method, dial or transmit level, and the gate refuses until all are set. The retired browser app
shipped the real station W1AW as its default (audit C-04); CI now scans every release binary for
it. `z30 --migrate` invents nothing either: it writes no transmit level, and does not import a
legacy app's own defaults (that callsign, the default PTT method, dial or power), because the
old apps saved them whether or not you chose them. A migrated station cannot transmit until you
set a transmit level and whatever else the gate lists.

**USB only.** The emission is computed as dial + audio (upper sideband). z-30 does not set the
radio's mode; operating in LSB would put the signal somewhere the gate did not check. When rig
control reads the radio's mode, a fresh reading of anything but `USB`/`PKTUSB` is refused;
without rig control the mode cannot be checked.

**What is checked is what is sent.** The frame the gate verifies (symbols, parity, CRC, fields,
text, and a symbol-for-symbol rebuild from the message) is the very object the transmitter
modulates: nothing else can be transmitted, by construction (`VerifiedFrame`; post-remediation
audit N-03). A transmit level of 0 is refused, as is a missing dial frequency.

**Loopback tests do not transmit.** `z30 --loopback-test` runs entirely in memory. The sound-card
test, `z30 --audio-loopback-test`, needs `--confirm-no-transmitter` and refuses any configuration
with a PTT method (VOX included) or rig control (post-remediation audit N-04).

The band plans are compile-time data, not configuration, and the two kinds are different:

- **US (FCC Part 97): data segments per licence class.** 6 m data starts at 50.1 MHz and 2 m at
  144.1 MHz (50.0–50.1 and 144.0–144.1 MHz are CW-only). **60 m is five channels** (centres
  5332, 5348, 5358.5, 5373 and 5405 kHz): the emission must be centred within 50 Hz of a channel
  centre and lie inside the 2.8 kHz channel. That is the stricter of two readings of the rule;
  which one applies is a **board decision not yet made**, and until then the stricter one is
  enforced because it can only refuse more.
- **IARU Regions 1–3: whole amateur bands, not data sub-bands.** The IARU band plans are
  recommendations that differ by country, and none is modelled. The gate checks only that the
  emission is inside an amateur band; keeping it in your national data segment is up to you.

National variations are not modelled: the gate catches a mistuned dial or wrong band, it does
not replace knowing your licence conditions.

## PTT: one keying implementation, and what releases it

- Every path keys through one controller, which reports whether the hardware accepted the
  command. A key the hardware refused leaves nothing keyed. VOX, which cannot confirm keying,
  says so and never reports "verified".
- A release goes to exactly the line the key drove.
- **A release counts only when the hardware confirms it.** If the radio or interface does not
  confirm an unkey (a `rigctld` timeout, a CM108 write error), z-30 treats the transmitter as
  possibly still keyed: it shows a TX fault, refuses to transmit, retries the release every
  50 ms, and tells you when a release is finally confirmed. **Check the radio when you see it.**
- **Halt means halt**: the HALT button stops the audio and asks for the PTT release at once,
  from the window's own thread, without waiting for the engine; a halt between the transmit
  decision and the key abandons the transmission instead of keying it.
- **Only a complete frame counts.** A transmission that was cut short, started too late, failed
  or was stopped by the watchdog is reported as such and never advances the QSO or logs a
  contact. A key or an audio start more than 0.5 s late abandons the slot instead of sending a
  truncated frame.
- **A failed audio output stops the transmission**, releases PTT and refuses further
  transmissions until the device reopens (retried every 5 s while idle).

Four independent layers stop a stuck transmitter; each covers a different failure:

| Layer | Covers |
| :--- | :--- |
| The transmit timeline unkeys at the end of the frame | normal operation |
| A watchdog thread releases the line at `MAX_TX_SECONDS` = 40 s (a frame is 24 s), independent of the engine and the GUI, and retries an unconfirmed release until it is confirmed; the limit is a compile-time constant; its release is always reported | a hung engine or GUI, a lost unkey |
| A panic hook and SIGINT/SIGTERM/SIGHUP / console-close handlers release every line | crashes and normal termination |
| The operating system drops RTS/DTR when the serial port closes | even SIGKILL, for serial PTT |

**VOX is outside the watchdog.** With VOX there is no line to release; what bounds a VOX
transmission, if the engine hangs, is only the audio queued for it (one 24 s frame).

**Opening a serial PTT port may key the radio briefly.** Between opening the port and driving
the line released, many USB-serial drivers assert DTR/RTS. That can happen when `z30-gui`
starts or restarts the station, and during `z30 --diagnostics`. It has not been measured; check
it into a dummy load (test R8 of [`docs/hardware-validation.md`](../docs/hardware-validation.md)).

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

A log record holds what was received, measured, sent, reported by the radio, commanded,
configured or entered — and each field says which. A field nothing supplied is left empty:

- no grid received → no grid logged (the retired logger wrote `FN31`);
- no report received → none logged (it wrote `-16`);
- no distance field at all (it computed one from the default grid `EM00`);
- times are UTC, computed from slot numbers, independent of the computer's time zone (it wrote
  local time labelled UTC);
- the dial is `reported_by_rig` when a fresh CAT reading gave it (the radio's value), `commanded`
  only when z-30 sent the radio that exact frequency **and the radio acknowledged it**,
  `configured` when it is only your setting, and absent when there is none. There is no default
  dial: until 2026-09-24 a default 14.076 MHz could be logged as "commanded" on a station with
  no rig control (post-remediation audit N-05);
- power is the power you *configured*, labelled as configuration; forward power and SWR are "not
  measured" because nothing measures them.

A record with no partner callsign or no plausible UTC time is refused, not written. ADIF exports
carry the provenance in `APP_Z30_PROVENANCE`. Imported legacy records are marked `legacy_import`,
and each legacy writer's own defaults are dropped from the entries it wrote because they cannot
be told apart from its fabrications: the auto-logger's FN31, −16 and dial-plus-audio-offset
"frequency", the manual form's FN31 and band default dial, the legacy importer's −15 and
14.076 MHz (`crates/z30-io/tests/logbook_integrity.rs`, `crates/z30-engine/tests/qso_logging.rs`,
`crates/z30-engine/tests/dial_provenance.rs`, `z30-io` `migrate::tests`).

## Reports you send

The report in your `-NN` message is this receiver's measurement of the other station, rounded
and limited to v1's −30…+30 dB. The estimator is measured against the truth from −22 to +30 dB
([16](16-Benchmarking-Testing-&-CI.md)); its predecessor saturated near +6.6 dB and sent a +20 dB
station "+07" (audit M-07). With no signal estimate, no report is sent.

v1 carries a plain number, so the limits are not visible in what you send: **`+30` means "+30 dB
or stronger"**, and **`-30` means "−30 dB or weaker"**. Anything below −22 dB (down to −30) is
sent as the rounded estimate although it is outside the validated range, where the display
shows `<-22`. The logbook records the report exactly as sent.

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
