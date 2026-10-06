# Hardware

`crates/z30-io`: `rigctld.rs`, `serial_ptt.rs`, `cm108.rs`, and `open_ptt` in `lib.rs`. The
rules each adapter must obey are in `z30_engine::ptt` and `z30_engine::rig`; this page says what
each piece of hardware can and cannot guarantee. **None of the adapters has been exercised
against a physical radio.** See "Verification status" at the end.

## Rig control: Hamlib `rigctld`

z-30 talks to the radio through `rigctld` over TCP (`[rig] rigctld_host`, usually
`127.0.0.1`; port 4532 by default). An empty host means no rig control, and then the dial is
unverified rather than assumed. It uses
Hamlib's own rig model and serial settings rather than reimplementing CAT.

- **Readback** (`RigControl::read`): `f` (dial), `t` (PTT state), `m` (mode). The rig thread
  polls every `[rig] poll_interval_ms` (1000 ms by default; a smaller value is raised to 250 ms,
  `MIN_POLL_INTERVAL_MS`) and starts no CAT traffic, poll or set-frequency, within the 100 ms
  PTT settle window after a PTT change. Each field has its own freshness, so a failed `m` query
  does not make an old mode count as fresh. The readings feed `RigStateTracker`, a port of
  WSJT-X's polling model: three polls to stabilise after a QSY, and a tolerance set by the rig's
  tuning resolution. **The resolution is never measured in production** (the probe is not wired
  in), so the tolerance is a strict 1 Hz: a radio that quantises the dial can be refused on a
  dial that is not a multiple of its tuning step. See [safety.md](safety.md#rig-readback-refusing-a-contradiction-and-only-that)
  for how a settled disagreement refuses transmission.
- **QSY** (`F <hz>`). A refused set-frequency refuses transmission (`RigRefusedDial`) until a
  reading confirms the dial.
- **CAT PTT** (`T 1` / `T 0`) runs on a **separate connection** from the poller. An unkey
  queued behind a slow read is a transmitter still radiating (docs/safety.md). The PTT
  connection is opened when the line is created, at start-up, not at the first key: a `rigctld`
  that is not running is reported then, as a transmit hardware problem that refuses
  transmission, rather than as a failed key in the middle of a slot. A connection lost later is
  re-established on demand.
- Every socket operation has a 1.5 s timeout, and a reply other than `RPRT 0` is a failure,
  never a success. Any error drops the connection, and the next command reconnects.

## PTT methods

| `ptt` | Keys with | Confirms keying? | Released if the process dies? |
| :--- | :--- | :--- | :--- |
| `none` (default) | nothing | — | — (transmit is refused: `PttNotConfigured`) |
| `cat` | rigctld `T 1`/`T 0` | yes: `RPRT 0` | **no**: the radio stays keyed until its own time-out |
| `serial` | RTS or DTR, either polarity | yes: the OS accepted the line change | **yes**: the OS drops RTS/DTR when the port closes, even after SIGKILL |
| `cm108` | CM108/CM119 GPIO 1–8 over HID | yes: the HID write succeeded | **no**: a CM108 GPIO holds its state |
| `vox` | the transmit audio itself | **no**: says so (`PttAck::Unverifiable`) | yes: the audio stops |

What "confirms" means: the hardware or daemon accepted the command. It does not mean the
radio is transmitting. Only the rig's own PTT readback (`t`, where the radio supports it) says
that. The same applies to a release: z-30 counts the line as released only when the release is
confirmed. A release the hardware refused leaves the line "possibly keyed", raises a TX fault,
refuses every transmission and is retried every 50 ms by the watchdog until it is confirmed
([safety.md](safety.md#ptt-one-keying-implementation-and-what-releases-it)). VOX confirms
nothing, so for VOX this can never report a failure, and the watchdog cannot release anything:
the audio queued for one frame is the bound.

**CM108 and CAT stations should enable the radio's own transmit time-out timer.** The software
layers in [safety.md](safety.md) cover a hung engine, a lost or refused unkey, a panic and a
normal exit. Nothing in software can release a CM108 GPIO or a CAT-keyed radio after SIGKILL or a
power cut to the computer.

**CM108 is a build feature.** `hidapi` is compiled in only with `--features cm108`
(`cargo build --release -p z30-gui --features cm108`). A build without it refuses a `cm108`
configuration with a message saying so; it never falls back to something else. The release
archives and the CI release builds **include** it, and `--version` says whether a binary does
(`features: cm108`).

## Migrated PTT methods

`z30 --migrate` carries over `CAT`, `RTS`, `DTR`, `VOX` and `CM108_GPIO` from the legacy
configuration, with two exceptions. A method equal to the legacy app's own default (the web UI's
`CAT`, the Tk wizard's `CAT Command`) is **not** imported: the legacy apps saved every field,
defaults included, so a saved default cannot be told apart from a choice, and PTT stays
unconfigured. A CM108 configuration with no recorded GPIO pin is skipped rather than given the
default pin 3. A CM108 configuration that is migrated has no device path (the legacy app
recorded none), so it keys only if exactly one C-Media device is present (below)
(`migrate::tests::f21_legacy_defaults_are_not_migrated_into_a_transmit_capable_station`).

The retired legacy app also offered **`AUDIO_TONE_RIGHT`, `RASPBERRY_PI_GPIO`, `TCI_NETWORK`
and `WINKEYER`**. z-30 does not implement these. Migration reports each as not migrated, with
the reason, and the gate refuses to transmit until a supported method is configured. It never
guesses a substitute. None of the four was ever tested on hardware in the legacy app either.

## Serial ports and devices

`z30 --devices` lists audio devices and serial ports. The serial PTT port is opened once and
held for the life of the station. That is what makes the OS release RTS/DTR when the process
goes away, and it avoids a reopen racing a key.

**Opening a serial port may briefly key the radio.** `SerialPtt::open` opens the port and then
drives the configured line to its released state. Between those two steps the line is in
whatever state the OS and the USB-serial driver give a freshly opened port, and many assert DTR
and RTS on open. With a PTT interface on that line, that can be a short key-up **when `z30-gui`
starts** (and whenever an audio, PTT or rig settings change restarts the station) **and during
`z30 --diagnostics`**, which opens the configured PTT line to report whether it works. Its
duration has not been measured on any hardware. Check it on a dummy load
([hardware-validation.md](hardware-validation.md), R8) before connecting an antenna.

**Choosing devices.** A configured audio device name must match a device's name exactly (case
ignored) or be a substring of exactly one device's name; a name that matches several is an
error that lists them, not the first one found. A CM108 device path left empty is accepted only
when exactly one C-Media device is present; with two or more (a USB headset and a radio
interface is common) the error lists their paths. Both used to take the first match and could
drive the wrong interface (2026-09-28 audit F-43; `audio::tests::f43_an_ambiguous_device_name_is_refused_not_resolved_to_the_first_match`,
`cm108::tests::f43_no_cm108_device_is_guessed_when_there_is_more_than_one`). `z30 --diagnostics`
prints `audio in:` and `audio out:` lines naming the device each direction would use, or why
none can be chosen.

On Linux the user needs access to the port (usually the `dialout` or `uucp` group). For CM108
they need access to the hidraw node, usually through a udev rule. See
[troubleshooting.md](troubleshooting.md).

## Verification status

**Real-radio validation: not yet performed.** No radio model, interface or PTT method below has
been operated with z-30. "Supported" in this repository means "implemented and tested against
simulated or scripted hardware", never "tested with a radio". The framework for doing it is in
[hardware-validation.md](hardware-validation.md).

| Item | Verified how | On hardware |
| :--- | :--- | :--- |
| rigctld protocol, refusal handling, separate PTT connection | unit test against a scripted TCP server | not yet |
| Readback rules (settle, resolution, unverified vs wrong) | `crates/z30-engine/tests/safety.rs` r1–r6 (resolution with an injected value only; production uses 1 Hz) | not yet |
| Rig poll interval and settle window in the rig thread | `tx_runtime.rs` `f18_…` with a scripted rig | not yet |
| Serial RTS/DTR | builds on three OSes | not yet |
| Serial port open: state of DTR/RTS before the line is driven released | nothing: depends on the OS and driver | not yet (R8) |
| CM108 HID report layout | Direwolf's documented layout | not yet |
| Device selection refuses an ambiguous audio name or CM108 path | unit tests (`f43_…`) on name lists | not yet |
| Watchdog unkeys at `MAX_TX_SECONDS`, and retries a refused release | `p4`, `p4b`, `p4c`, `ptt_release.rs` with fake lines | not yet |
| Transmit loop: HALT, late key, output failure, unconfirmed release | `tx_runtime.rs` with a fake line, output and clock | not yet |
| Audio timing (DT ≈ 0 at a remote station) | virtual clock only | not yet |

Before operating on the air, the closing check of any installation is to key into a dummy load
with a known-good receiver watching, and confirm DT ≈ 0 and a clean spectrum.
