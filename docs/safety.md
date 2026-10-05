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
| `OutOfBand` | the **radiated** emission, dial + audio offset across the tone span widened to the measured −40 dB width (66 Hz), is not wholly inside a permitted segment for the region and class (US: a data segment or, on 60 m, a channel; IARU regions: a whole-band allocation, see [the band plan](#the-band-plan-bandplanrs)) | `g3`, `gate_contract.rs::f05_…`, `f02_…` |
| `RigDialDisagrees` | a settled rig readback contradicts the dial being checked | `r1`, `r6` |
| `RigModeNotUsb` | a fresh rig reading reports a mode other than `USB`/`PKTUSB` (the emission check assumes USB; audit L-07) | `l7` |
| `MessageNotEncodable` | the whole frame does not read back as the requested message: encoded, then symbols → Costas check → codeword (and the info bits it carries) → every parity check → CRC → fields → text, and finally the frame rebuilt from the message alone must be identical symbol for symbol. Partner callsign, grid and report included, not just our own call (audit C-06); a hand-built off-table grid or out-of-range report is refused, not panicked on | `g5`, `g6`, `n3_the_gate_refuses_every_corrupted_frame…`, `z30-protocol/tests/{round_trip,frame_integrity}.rs` |
| `FrameNotForMessage` | the frame offered is a valid frame of a *different* message | `n3_a_valid_frame_of_a_different_message_is_refused` |
| `MessageNotFromStation` | the frame's sender field is not this station | `g5` |
| `PttNotConfigured` | no keying method is configured | `h1`, `gate_contract.rs::f22_can_transmit_itself_refuses_missing_or_uncertain_hardware` |
| `HardwareUnavailable` | the audio output or keying line could not be opened at start-up, or the output has failed since (a device error while running; refused until it reopens, below) | `h1`, `f22_…`, `tx_runtime.rs::rt_an_output_failure_while_keyed_stops_releases_refuses_and_recovers` |
| `PttReleaseUnconfirmed` | the last PTT release was not confirmed by the hardware: the transmitter may still be keyed (below) | `f22_…`, `tx_runtime.rs::rt_an_unconfirmed_release_is_a_gate_refusal_while_it_lasts` |
| `RigRefusedDial` | the radio refused the last set-frequency for this dial and no reading has confirmed the dial since | `f22_…` |
| `TxAudioLevelOutOfRange` | the transmit level is NaN or above 1 (full scale): refused, not clamped, because a clamped level is not the configured one and a clipped output radiates wider than the emission checked | `gate_contract.rs::f07_a_nan_level_or_one_above_full_scale_is_refused_not_clamped` |
| `TxAudioLevelZero` | the transmit level is 0 or below (a new installation's, and a migrated one's), which would key the radio with no signal (audit N-09) | `n9`, `f22_…` |

The hardware is part of the request (`TxRequest::hardware`, a `TxHardware`): the configured PTT
method, the output and keying problems the runtime has recorded, an unconfirmed release, a
refused dial and the level. Before the 2026-09-28 audit's remediation these checks were appended
by `plan_tx` after the gate had already said `allowed: true`, so any other caller that trusted `allowed` would have
keyed a station with no PTT, no output or a zero level (2026-09-28 audit F-22). The gate now
returns `allowed` only when all of it passes. The plan it produces (`TxPlan`) is sealed: only
`plan_tx` builds one, and it carries the verified frame, the dial, the audio frequency, the level,
the emission centre and the segment the gate checked. The runtime synthesises from the plan and
re-reads nothing from the configuration (`gate_contract.rs::f22_the_plan_carries_exactly_what_the_gate_checked`).

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
tested against.

### The band plan (`bandplan.rs`)

A port of the legacy `bandPlan.ts`, corrected. The two kinds of table are not the same thing:

- **US (FCC Part 97): data segments.** The segments where 47 CFR 97.305(c) authorises RTTY/data
  emissions for each licence class, not the whole band. **6 m data starts at 50.1 MHz and 2 m at
  144.1 MHz**: 50.0–50.1 and 144.0–144.1 MHz are CW-only (97.305(a),(c)), and the table used to
  clear data there (2026-09-28 audit F-02). **60 m is five channels**, not a band (97.303(h)):
  centres 5332, 5348, 5358.5, 5373 and 5405 kHz (`US_60M_CHANNEL_CENTRES_HZ`). A data emission
  must be centred within 50 Hz of a channel centre (`US_60M_CENTRE_TOLERANCE_HZ`) **and** lie
  inside that channel's 2.8 kHz. That is the stricter reading of the rule. Whether the regulations
  require "centred on" the channel or only "inside" it is a **board decision that has not been
  made** (F-02); the stricter reading is implemented until then because it can only refuse more.
  Edge tests: `bandplan::tests::f02_us_cw_only_sub_bands_and_off_channel_60m_are_refused`,
  `gate_contract.rs::f02_the_gate_refuses_us_cw_only_sub_bands_and_off_channel_60m`.
- **IARU Regions 1–3: whole-band allocations, not data sub-bands.** The IARU band plans are
  recommendations that vary by country, and none is modelled. In those regions the gate checks
  only that the emission is inside an amateur band available to the station. Keeping it inside
  the data segment your national band plan sets is **your** responsibility.
- National variations (including the US 420–430 MHz restriction near the Canadian border,
  97.303(m)) are not modelled. The operator remains responsible for their emissions.

**USB is assumed.** The emission is computed as dial + audio offset, which is upper sideband.
When rig control reads the radio's mode and the reading is fresh, any mode other than `USB` or
`PKTUSB` is refused (`RigModeNotUsb`, audit L-07). Without rig control the mode cannot be known
and is not checked: operate in USB (or the radio's USB data mode).

**No real callsign is a default.** A new installation has an empty callsign, no region, no
licence class, no PTT method, no dial frequency and a transmit level of 0, and the gate refuses
until all are set (`config::tests::a_new_installation_is_unconfigured_and_cannot_transmit`). The retired browser
bundle defaulted to the real station W1AW (audit C-04); CI scans the release binaries for it.

**Migration invents nothing either.** `z30 --migrate` (and the GUI's first start, which runs the
same import) writes **no transmit level** (it stays 0; it used to write 0.5), and does not import
the legacy bundle's default callsign, a legacy-default PTT method (the web UI's `CAT`, the Tk
wizard's `CAT Command`), the Tk wizard's default dial (14 076 000 Hz) or a default power (web
25 W, Tk 50 W): the legacy apps saved every field, defaults included, so a saved default cannot
be told apart from a choice. A CM108 configuration with no recorded GPIO pin is skipped, and the
legacy "Default System Audio Device" placeholder is not taken as a device name. Region and licence
class are migrated. A migrated station therefore cannot transmit until the operator sets a
transmit level, and anything else the gate lists (2026-09-28 audit F-21; `z30-io` `migrate::tests::f21_legacy_defaults_are_not_migrated_into_a_transmit_capable_station`,
which also runs the gate on the result).

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
- a difference inside the rig's measured tuning resolution is not a refusal (`r4`). **In
  production this exemption never applies:** the rule is implemented and tested with an injected
  resolution (`r4` calls `RigStateTracker::set_resolution`, which nothing in production calls),
  but the probe that measures a real rig's resolution is not wired in, so the tolerance is a
  strict 1 Hz. A radio that quantises the dial may therefore be refused on a dial that is not a
  multiple of its tuning step (2026-09-28 audit F-27; operator note in
  [wiki/06](../wiki/06-Transceiver-CAT-Control-&-PTT-Wiring.md#reading-the-rig-back)).

Each field of a reading (dial, PTT, mode) has its own freshness: a poll that could not read the
mode does not make an old mode count as fresh (`gate_contract.rs::f18_a_mode_the_poll_did_not_read_is_not_re_dated_as_fresh`;
it used to, audit F-18). The rig thread polls every `[rig] poll_interval_ms` (1000 ms by default,
never faster than 250 ms, `MIN_POLL_INTERVAL_MS`) and starts no CAT traffic, poll or
set-frequency, within the 100 ms PTT settle window (`PTT_SETTLE_MS`) after a PTT change
(`r5`; `tx_runtime.rs::f18_the_rig_thread_polls_at_the_configured_interval`,
`f18_no_poll_starts_inside_the_ptt_settle_window_during_a_transmission`). Before the 2026-09-28
audit's remediation the rig thread polled on a fixed 1000 ms and ignored both.

Two things beyond the gate's own check:

- **A refused set-frequency is a refusal** (`RigRefusedDial`) until a reading confirms the dial.
  It used to be no refusal at all while the tracker waited out its settle count (F-45).
- **The radio is still watched during a frame.** A settled dial contradiction or a fresh non-USB
  mode read while transmitting stops the frame: the outcome is `Aborted`, and a `TxFault` is
  raised (`gate_contract.rs::f45_a_radio_that_contradicts_the_dial_mid_frame_is_reported`,
  `tx_runtime.rs::rt_a_radio_that_moves_off_the_checked_dial_mid_frame_stops_the_transmission`).

## PTT: one keying implementation, and what releases it

- **One keying implementation.** Every path keys through `PttController::key`, which returns
  whether the hardware accepted the command. A key the hardware refused leaves nothing keyed
  (`z2`). VOX, which cannot confirm anything, reports `Unverifiable` and never "verified"; with
  no PTT configured, nothing can key (`z2b`).
- **A release drives what the key drove.** The controller holds exactly one line object, and a
  release goes to that object (`z1`). Replacing the line while keyed unkeys the old one first
  (`z1b`).
- **A release is not a release until the hardware confirms it.** The controller's line is
  `Keyed` → `ReleasePending` → `Released`, and only a confirmed release makes the last step. A
  release the hardware refused (a rigctld `T 0` that timed out, a CM108 HID write error) leaves the
  line "possibly keyed": the controller keeps reporting it keyed, the runtime raises a `TxFault`
  and refuses every new transmission (`PttReleaseUnconfirmed`), the controller refuses a new key,
  and the watchdog retries the release on every tick (50 ms) until one is confirmed, which is
  reported (`Event::PttReleaseConfirmed`). Before the 2026-09-28 audit's remediation the
  controller marked the line released *before* driving it, so a refused release left the
  controller, the watchdog and `Drop` all believing a keyed radio was released (F-01;
  `tests/ptt_release.rs`,
  `tx_runtime.rs::rt_an_unconfirmed_release_is_reported_blocks_transmission_and_is_retried_until_confirmed`).
- **No layer waits on a lock a broken driver can hold.** Every line driver runs inside
  `catch_unwind`, so a panic inside `PttLine::set` is "the hardware did not confirm", not a held
  lock. The watchdog only `try_lock`s the line. The emergency path waits at most
  `EMERGENCY_LOCK_WAIT_MS` (2 s) per line, not at all for a line the current thread is driving,
  and never holds the registry lock across a driver. A panic inside a driver used to deadlock the
  panic hook, the watchdog and the signal handler (F-15; `tests/ptt_panic.rs`).
- **The watchdog deadline is armed once per transmission**, on the released → keyed transition;
  a second `key()` does not extend it (F-44; `ptt_release.rs::f44_a_second_key_does_not_re_arm_the_watchdog`).
- **Halt means halt.** The GUI's HALT calls `RuntimeHandle::halt()` directly: it silences the
  output and requests the PTT release without blocking (a line another thread is driving is left
  `ReleasePending` for that thread and the watchdog), and raises a flag
  the control loop acts on at its next tick to disarm and abandon the transmission. It no longer
  goes through the bounded command queue, which a control thread blocked in `timedatectl`, SQLite
  or a slow key could leave full, so a HALT could be dropped while the transmitter stayed keyed
  (F-16; `tx_runtime.rs::rt_halt_is_not_delayed_by_a_blocked_control_thread`,
  `rt_halt_releases_the_ptt_even_while_the_control_thread_is_stuck_in_the_output`,
  `rt_halt_while_keyed_stops_the_audio_releases_the_line_at_once_and_disarms`,
  `ptt_release.rs::f16_a_halt_while_the_driver_is_busy_never_blocks_…`). The output it silences
  is the current one: a recovered output is a new stream, and the stop taken at start-up used to
  flush the dead one (review M-1; `rt_halt_after_an_output_recovery_still_silences_the_live_output_from_the_calling_thread`).
  The release itself is driven on a short-lived thread, so a rigctld waiting out its timeouts no
  longer freezes the window during an emergency (review L-1;
  `rt_halt_does_not_wait_for_a_slow_release_driver`). HALT is also the operator's last word:
  commands are stamped with the HALT epoch they were sent in, and an arming command (Call CQ,
  Answer, Enable TX, Tune) that was already queued behind a blocked control thread when HALT was
  pressed is dropped and reported ("… ignored: it was sent before HALT") instead of re-arming the
  station for the next slot (transmit-safety audit D-1;
  `tx_runtime::d1_a_command_queued_before_halt_does_not_rearm_the_station_after_it`). For the same reason the
  OS clock-status query (`timedatectl`) runs on a thread of its own and the SQLite logbook on a
  logbook thread, never on the control thread. The engine's own halts (`HaltTx`, `EnableTx(false)`,
  a new configuration) still arrive through the command queue and end a keyed transmission there
  (`rt_a_configuration_change_or_queued_halt_while_keyed_ends_the_transmission`). A halt that arrives between the transmit decision
  and the key abandons the transmission rather than keying it (`h2`,
  `tx_runtime.rs::rt_halt_between_plan_and_key_abandons_the_transmission_and_disarms`).

### How a transmission ends

Every transmission ends with one outcome (`api::TxOutcome`, reported as
`Event::TxFinished { slot, outcome }`): `Complete`, `Partial` (the device had not played the whole
frame when its time ran out), `Aborted` (halted, disarmed, reconfigured, too late to start, or
stopped by the radio's readback), `Failed` (the key or the audio output failed) or
`WatchdogAborted`. **Only `Complete` advances the QSO or logs a contact**
(`gate_contract.rs::f17_only_a_complete_closing_frame_completes_and_logs_the_contact`). Before the
2026-09-28 audit's remediation a key that took 300 ms cut the end of the frame and still reported
it completed, so an incomplete 73/RR73 could be logged (F-17).

- The frame's end is fixed when its audio actually starts, not at plan time, so a slow key no
  longer truncates it (`tx_runtime.rs::rt_a_slow_key_still_sends_the_whole_frame`).
- A key more than 0.5 s late (`MAX_KEY_LATENESS_SEC`) abandons the slot unkeyed; audio that could
  not start within 0.5 s of its time (`MAX_START_LATENESS_SEC`) is not started and the
  transmission is `Aborted` (`rt_a_key_too_slow_for_the_slot_abandons_it_without_audio`,
  `rt_a_stalled_control_loop_does_not_key_late`).
- CAT PTT connects to `rigctld` when the line is created, not at the first key, so a `rigctld`
  that is not running is a transmit problem reported at start-up rather than a failed key
  mid-slot (`rigctld::tests::f17_the_cat_ptt_connection_is_open_before_the_first_key`).
- The output latency used to time the audio is read when the transmission is planned. It used to
  be read once at start-up, before any output callback had run, and was almost always zero (F-47).

### Audio output failure

A device error on the audio output is recorded and surfaced. It used to be discarded, so a dead
output keyed the radio with no audio every slot (F-19). If it happens while keyed, the runtime
stops the output, releases PTT, ends the transmission `Failed` and raises a `TxFault`. While the
output is failed, transmission is refused (`HardwareUnavailable`); the runtime tries to reopen it
every 5 s while idle (`OUTPUT_RECOVERY_INTERVAL_MS`). A `play` that fails flushes whatever part of
the frame was queued rather than leaving it to play unkeyed
(`tx_runtime.rs::rt_an_output_failure_while_keyed_stops_releases_refuses_and_recovers`,
`rt_a_failed_play_flushes_the_partial_frame_and_releases`). The playback callback is under the
same no-allocation test as the capture callback
(`z30-io/tests/callback_alloc.rs::the_playback_callback_never_allocates_and_plays_what_was_queued`).

### Four independent stuck-transmitter layers

Each defends against a different failure. Do not merge them.

1. **The engine's TX state machine** ends every frame and unkeys 50 ms after the audio.
2. **The watchdog thread** shares nothing with the engine loop except the line. It releases the
   line at `MAX_TX_SECONDS` = **40 s** (a frame is 24 s) whatever the engine is doing (a hung
   loop), and it retries a lost unkey, one the hardware did not confirm, every 50 ms until the
   hardware confirms it (`p4`, `p4b`,
   `ptt_release.rs::f01_the_background_watchdog_thread_retries_a_failed_release_on_its_own`,
   `tx_runtime.rs::rt_the_watchdog_releases_a_stuck_transmission_and_the_runtime_reports_it`).
   The limit is a compile-time constant that no configuration can raise (`p4c`,
   `ptt_release.rs::f06_the_transmit_time_limit_is_forty_seconds`). A watchdog release is always
   reported (`Event::WatchdogReleased`, and the transmission ends `WatchdogAborted`), whatever the
   transmit timeline was doing (F-46). **The watchdog thread can do nothing for VOX**: releasing
   a VOX "line" changes nothing at the radio, and the only bound on a VOX transmission that does
   not depend on the control thread is the finite audio queued for it (one frame, 24 s).
3. **Process exit, panic and termination signals.** A panic hook, a `Drop` guard and, in the
   GUI, a SIGINT/SIGTERM/SIGHUP (and Windows console-close) handler all call
   `emergency_release_all`, which releases every live line in the process with a bounded wait
   (`crates/z30-engine/tests/emergency.rs`, `p5`,
   `ptt_panic.rs::f06_the_panic_hook_releases_a_keyed_line_when_another_thread_panics`). In a
   running station a line it cannot reach is left `ReleasePending` for the watchdog. On a
   termination signal the process exits next, so no watchdog will run: the GUI's handler first
   latches the process against any further key (a key racing the release would otherwise outlive
   the process; audit D-2, `ptt_exit_latch.rs`), then retries the release for about a second and
   prints "PTT release NOT confirmed before exit" if the line never confirmed (review M-2).
   Stopping the runtime (exit, or a new audio, PTT or rig setting) retries an unconfirmed release
   for up to 2 s (`SHUTDOWN_RELEASE_WAIT_MS`) and reports the outcome (`ShutdownReport`). The
   bound is real: shutdown never drives the line on the calling thread (the release and its
   retries run on short-lived threads), and when the release is not confirmed it does not wait
   for the runtime's threads, one of which may be wedged in the driver (audit D-4, re-review R-4;
   `tx_runtime::r4_shutdown_returns_within_its_window_even_behind_a_wedged_release_driver`). The GUI
   does not apply hardware settings while the line is keyed or pending, does not start a new
   runtime after an unconfirmed shutdown, and refuses the first close of the window with a warning;
   CAT PTT, like serial and CM108, commands a release when it is opened, so a new runtime never
   assumes a line it did not command (`tx_runtime.rs::m2_shutdown_retries_an_unconfirmed_release_and_says_so_when_it_stays_unconfirmed`,
   `rigctld::tests::f17_the_cat_ptt_connection_is_open_and_released_before_the_first_key`,
   `m2_a_rigctld_that_refuses_the_start_up_release_is_not_a_working_ptt`). The GUI behaviour is
   checked by inspection only (there is no GUI test harness).
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

The clamp is invisible on the air, because v1 carries a plain number: a sent `+30` means "+30 dB
or stronger" and a sent `-30` means "−30 dB or weaker". Estimates below −22 dB are outside the
validated range and are still sent as the rounded number (down to −30), while the display shows
the bound `<-22`. The logbook's `rst_sent` is the value actually sent (provenance `sent`),
not the estimate behind it (`qso::report_for`; 2026-09-28 audit F-56).

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
