# Troubleshooting

Start with `z30 --diagnostics`. It reports the configuration file in use, the clock's
synchronisation status, the transmit gate's verdict with every reason, the PTT method, rig
control and audio devices, without keying anything:

```
z30 0.9.0 (<commit>) (protocol v1)
config:   ~/.z30/config.toml (not found: defaults, transmit refused)
clock:    system clock (synchronisation status unavailable)
transmit gate: would REFUSE:
  - No callsign is configured. Enter your callsign in Settings before transmitting.
  - No regulatory region is configured.
  - No licence class is configured.
  - No PTT method is configured (Settings: PTT).
PTT:      no PTT configured (not keyed by diagnostics)
rig:      no rigctld configured (dial unverified; the readback check does not apply)
```

The version line names the commit the binary was built from. `-dirty` means it was built from
uncommitted changes. Mention both when reporting a problem.

## Nothing decodes

| Check | How |
| :--- | :--- |
| Is audio arriving? | The GUI status bar shows whether input is running, its level, overruns, epoch and sound-card drift; the waterfall should show band noise. |
| Right device? | `z30 --devices`; set `[audio] input_device` to a substring of its name. |
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
- **PTT not configured / hardware unavailable**: configure a PTT method, and check that its
  port or device opens (below).

## rigctld

- `rigctld 127.0.0.1:4532: connection refused`: `rigctld` is not running, or is on another
  port. Start it with your rig model, for example `rigctld -m <model> -r /dev/ttyUSB0`.
- `rigctld refused "F 14074000": RPRT -N`: the radio rejected the command. vNext treats that
  as a failure, never as success.
- Timeouts are 1.5 s per operation. A slow radio that times out on every poll leaves the dial
  "unverified", which does not refuse transmission. Only a settled contradiction does.

## Serial and CM108 PTT

- **Linux permissions**: add the user to the group that owns the port (`dialout` on
  Debian/Ubuntu, `uucp` on Arch), then log in again.
- **CM108** needs a build with `--features cm108`. On Linux the user needs read/write
  access to the device's `hidraw` node, usually through a udev rule matching vendor `0d8c`.
- **Polarity**: `active_high = false` keys by releasing the line. If the radio transmits when
  z-30 starts, the polarity is inverted. Stop and fix it before going further.

## GUI will not start (Linux)

eframe needs a display and GL: X11 (`libx11`, `libxcursor`, `libxrandr`, `libxi`) or Wayland
(`libwayland`, `libxkbcommon`), plus `libgl1`. On a headless box, use `z30` (the CLI), which
needs none of them.

## Migration

`z30 --migrate` reads the legacy `station_config.json`, `config.json`, `logbook.json` and
`logbook.adi` and never modifies them. It prints one line per field: migrated, migrated with a
change (and why), or not migrated (and why). If `config.toml` already exists it stops, unless
`--force` is given. Imported log fields carry `legacy_import` provenance on purpose (see
[safety.md](safety.md#logged-data)).

The legacy RF time-sync offset (`appTimeOffsetMs`) is deliberately **not** migrated.
