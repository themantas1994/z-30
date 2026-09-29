# Troubleshooting

Start with `z30 --diagnostics`. It reports the configuration file in use, the clock's
synchronisation status, the transmit gate's verdict with every reason, the PTT method, rig
control and audio devices, without keying anything:

```
z30 0.1.0-experimental (z-30 vNext, Rust)
commit:       <commit>
built:        <UTC date> with rustc <version>
target:       x86_64-unknown-linux-gnu
architecture: x86_64 (linux)
profile:      release
features:     none (CM108 GPIO PTT not built in)
protocol:     v1
runtime:      native; no Python, Node or browser component
config:   ~/.z30/config.toml (not found: defaults, transmit refused)
data dir: ~/.z30
clock:    system clock (synchronisation status unavailable)
transmit gate: would REFUSE:
  - No callsign is configured. Enter your callsign in Settings before transmitting.
  - No regulatory region is configured.
  - No licence class is configured.
  - The transmit frequency could not be determined: no dial frequency is set (Settings: dial), or the dial or audio offset is not a usable number.
  - No PTT method is configured (Settings: PTT).
  - The transmit audio level is 0 (Settings: TX level): the radio would be keyed with no signal.
PTT:      no PTT configured (not keyed by diagnostics)
rig:      no rigctld configured (dial unverified; the readback check does not apply)
audio:    1 inputs, 1 outputs (see --devices)
audio in:  Default Audio Device (system default)
audio out: Default Audio Device (system default)
```

(Output of a `z30` built at `8a98bbc` without the `cm108` feature, run with an empty data
directory; the commit, build date and paths are elided. A release build says `features: cm108`.
The audio lines name whatever devices the machine has.)

The `commit:` line names the commit the binary was built from. `-dirty` means it was built from
uncommitted changes, and a `dirty diff:` line then identifies which. Mention both when reporting
a problem. `audio in:` / `audio out:` name the device each direction would use; a configured
name that matches several devices is reported there as an error listing them.

**`--diagnostics` opens the configured PTT line** to report whether it works; it never keys it.
With serial RTS/DTR PTT, opening the port can itself briefly assert the line before z-30 drives
it released: see [hardware.md](hardware.md#serial-ports-and-devices).

## Nothing decodes

| Check | How |
| :--- | :--- |
| Is audio arriving? | The GUI status bar shows whether input is running, its level, overruns, epoch and sound-card drift; the waterfall should show band noise. |
| Right device? | `z30 --devices`; set `[audio] input_device` to its full name, or to a part of it that no other device's name contains. `z30 --diagnostics` shows which device is used. |
| Is the clock right? | Frames must start within ±1.5 s of the slot. Check the status bar or diagnostics clock line; keep the host on NTP. vNext never adjusts the clock itself. |
| Are slots being decoded? | Missed slots are listed with their reason (below). |
| Is the signal in the band? | The search covers tone 0 from 200 Hz up to where tone 15 reaches 2800 Hz. |
| Record and replay | `z30 --receive --capture-slots dir/` writes every slot window and its report; `z30 --decode dir/<slot>.wav` decodes it again offline, with the same `decode_slot`. |

## Missed slots

| Reason | Meaning | What to do |
| :--- | :--- | :--- |
| `BeforeEpoch` | The window started before audio (re)started. | Normal for the first slot after start or a device restart. |
| `ClockUnlocked` | The sample-clock fit has fewer than ~2 s of observations. | Normal at start. |
| `Overwritten` | The window's start had left the 70 s store before it could be scheduled. | The machine stalled for tens of seconds; check load. |
| `DecoderBusy` | The previous slot was still decoding when this one became ready. | The decode took more than ~30 s: a very slow machine or a pathological band. Report it with a captured slot. |
| `DecoderFault` | The decoder panicked on this slot; it was caught and the station carried on. | A bug. Report it with the captured slot. |

## Audio device will not open

- **"cannot open input (f32 at N Hz)"**: the device's default configuration does not offer
  32-bit float samples. On Linux, select the PipeWire/PulseAudio device (`pipewire`, `pulse`
  or `default`) rather than a raw `hw:` device; they convert. A raw ALSA `hw:` device that
  offers only 16-bit is not supported yet.
- **ALSA messages on stderr** such as `Unknown PCM default` come from the ALSA library probing
  devices that do not exist on this machine. On their own they are harmless. They matter only
  when no device opens.
- **Overruns** rising steadily mean the DSP thread is not keeping up, or the machine is
  suspending the process. Each overrun is a gap and a new clock epoch, never silently spliced.

## Transmit refused

The gate lists every reason (see [safety.md](safety.md)). The ones operators meet most:

- **Callsign not representable**: v1 carries only `[1–2 prefix][digit][1–3 letters]` with
  prefixes below `ZV`. Portable, compound and `ZV`–`ZZ` calls cannot be sent, and the old
  software sent a *different* callsign instead. There is no workaround in v1.
- **Grid not in the table**: v1 has 63 grids. A CQ from any other grid is refused rather
  than sent with a different grid. What to do about it is an open protocol decision.
- **Out of band**: the check uses dial + audio offset across the whole emission (66 Hz at
  −40 dB), for your region and licence class. Moving the audio offset away from a segment edge
  usually fixes it.
- **Rig dial disagrees**: the radio reports a different dial than the one being checked, and
  the reading has settled. Someone turned the VFO, a `set_freq` was refused, or the radio is on
  another VFO. The message names both frequencies.
- **Rig dial disagrees by a few hertz**: the readback tolerance is a strict 1 Hz, because the
  probe that measures a rig's tuning resolution is not wired in. Choose a dial that is a
  multiple of the radio's tuning step.
- **The radio did not accept the dial**: the last set-frequency was refused and no reading has
  confirmed the dial since. Check rig control; the refusal clears when the radio reports the
  dial.
- **PTT not configured / hardware unavailable**: configure a PTT method, and check that its
  port or device opens (below). An audio output that failed while running is also "hardware
  unavailable" until it reopens; z-30 retries every 5 s while idle. A CAT PTT line needs
  `rigctld` running when the station starts.
- **PTT release not confirmed**: the hardware did not confirm the last release, so the
  transmitter may still be keyed. **Check the radio.** z-30 retries the release every 50 ms and
  refuses to transmit until one is confirmed, then says so.
- **Transmit level 0, or not between 0 and 1**: set the TX level in Settings (a new or migrated
  configuration has 0).

## rigctld

- `rigctld 127.0.0.1:4532: connection refused`: `rigctld` is not running, or is on another
  port. Start it with your rig model, for example `rigctld -m <model> -r /dev/ttyUSB0`. With CAT
  PTT this is a transmit problem at start-up (the PTT connection is opened then): start
  `rigctld` first, then restart the station.
- `rigctld refused "F 14074000": RPRT -N`: the radio rejected the command. vNext treats that
  as a failure, never as success.
- Timeouts are 1.5 s per operation. A slow radio that times out on every poll leaves the dial
  "unverified", which does not refuse transmission. Only a settled contradiction does.

## Serial and CM108 PTT

- **Linux permissions**: add the user to the group that owns the port (`dialout` on
  Debian/Ubuntu, `uucp` on Arch), then log in again.
- **CM108** needs a build with `--features cm108`. On Linux the user needs read/write
  access to the device's `hidraw` node, usually through a udev rule matching vendor `0d8c`. An
  empty device path works only when exactly one C-Media device is present; with more, set the
  path of the radio interface (the error lists them).
- **Polarity**: `active_high = false` keys by releasing the line. If the radio transmits and
  stays keyed when z-30 starts, the polarity is inverted. Stop and fix it before going further.
  A *brief* key-up as the station starts (or during `z30 --diagnostics`) can instead be the port
  asserting DTR/RTS when it is opened, before z-30 drives the line released; that is unmeasured
  and is test R8 of [hardware-validation.md](hardware-validation.md).

## GUI will not start (Linux)

eframe needs a display and GL: X11 (`libx11`, `libxcursor`, `libxrandr`, `libxi`) or Wayland
(`libwayland`, `libxkbcommon`), plus `libgl1`. On a headless box, use `z30` (the CLI), which
needs none of them.

## Migration

`z30 --migrate` reads the legacy `station_config.json`, `config.json`, `logbook.json` and
`logbook.adi` and never modifies them. It prints three sections - **Imported**, **Imported
with a change** (and why), **Skipped** (and why) - and a logbook line with how many contacts
were imported, already present and skipped. If `config.toml` already exists it is not
replaced unless `--force` is given. Running it again is safe: a contact already in the vNext
logbook (same call, start time and frequency) is not imported twice, and the configuration it
builds is a pure function of the legacy files.

Never migrated, whatever the legacy files say:

- the RF time-sync offset (`appTimeOffsetMs` / `app_time_offset_ms`) and any stored time-sync
  result - the old sync could report success on noise (audit C-03);
- self-test / synthetic-signal state;
- browser UI settings;
- on entries written by the old auto-logger, the grid `FN31` and received report `-16`, which
  are exactly its defaults for "nothing received" (audit C-05). Their times were local time
  labelled UTC; that cannot be undone, and the imported comment says so;
- a transmit level: the legacy apps had none to carry over, so the migrated configuration has 0
  and transmit is refused until you set one;
- values equal to a legacy app's own default, because the legacy apps saved every field whether
  or not the operator changed it: the stale bundle's default callsign (a real station's, audit
  C-04), the default PTT method (web `CAT`, Tk `CAT Command`), the Tk wizard's default dial
  (14 076 000 Hz) and the default power (web 25 W, Tk 50 W). Each is listed under **Skipped**
  with the reason;
- a CM108 configuration with no GPIO pin recorded, and the placeholder "Default System Audio
  Device" as a device name.

Region and licence class are migrated. A migrated configuration therefore cannot transmit until
you set a transmit level yourself, and whatever else the gate lists (2026-09-28 audit
F-21; `migrate::tests::f21_legacy_defaults_are_not_migrated_into_a_transmit_capable_station`).

Imported log fields carry `legacy_import` provenance on purpose (see
[safety.md](safety.md#logged-data)).
