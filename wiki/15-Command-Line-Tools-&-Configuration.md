# 15. Command-Line Tools & Configuration

## `z30` — the command-line station and toolbox

`z30` **never transmits**: it has no PTT and no audio output path to a radio. The one command
that plays audio, `--audio-loopback-test`, is for a cable loopback: it refuses to run without
`--confirm-no-transmitter`, and refuses any configuration with a PTT method (VOX included) or
rig control. `--loopback-test` plays nothing; it is a software loopback in memory.

| Command | What it does |
| :--- | :--- |
| `z30 --version` | version, exact commit, build date and compiler, target and architecture, profile, compiled-in features, protocol version |
| `z30 --diagnostics` | configuration file, OS clock status, PTT method and whether it opens, `rigctld` reachability and readings, audio devices, and every reason the transmit gate would refuse |
| `z30 --devices` | audio input/output devices and serial ports |
| `z30 --receive [--capture-slots DIR]` | a live receive-only station on the configured input; with `--capture-slots`, every slot's 27 s window (WAV, 6 kHz) and decode report (JSON, `source: live-audio`) |
| `z30 --decode FILE.wav [--start-utc T]` | decode a recording (any rate; resampled to 6 kHz); a 27 s 6 kHz file from `--capture-slots` is decoded as one slot. Without `--start-utc` the recording's time is unknown and decodes are labelled `window N (UTC unknown)`, not given a date |
| `z30 --encode "CQ K1ABC FN31" --wav out.wav [--f0 1500] [--rate 48000]` | write a frame to a WAV file; refuses a message v1 cannot carry exactly, and writes only a frame that passed the same round-trip verification as a transmission |
| `z30 --migrate [--force]` | import the retired app's configuration and logbook ([01](01-New-User-Guide-&-First-Steps.md#7-coming-from-the-old-browserpython-z-30)) |
| `z30 --export-adif FILE` / `--import-adif FILE` | ADIF 3.1.4 export; import marks every field `legacy_import` |
| `z30 --loopback-test [--out lb.json]` | software loopback: a known frame through the transmit synthesis and the receive chain (resampler, clock, scheduler, `decode_slot`) at 48 and 44.1 kHz, in memory; opens no device, cannot transmit |
| `z30 --config loopback.toml --audio-loopback-test --confirm-no-transmitter [--out a1.json]` | hardware validation test A1 through a real sound card and cable ([`docs/hardware-validation.md`](../docs/hardware-validation.md)); refuses configurations with PTT or rig control |
| `z30 --benchmark suite [--replicate N]` | every published measurement, through `decode_slot`, JSON with provenance ([16](16-Benchmarking-Testing-&-CI.md)); `--replicate N` (N ≥ 1) re-runs on frames no other replicate or the published run uses, to measure sampling variability (marked as not the published run) |
| `z30 --benchmark perf` | decode latency, CPU and allocations at K = 1, 5, 20, 50 stations |

The printed decode line is `YYYYMMDD HHMMSS  SNR dB  DT s  frequency Hz  message [aN]`
(`window N (UTC unknown)` in place of the date and time for a recording with no start time).

## `z30-gui` — the desktop station

See [14](14-User-Interface-&-Operation-Reference.md). `z30-gui --version` prints the same build
information as `z30 --version`.

## Where files live

`$Z30_HOME` if set, else `$XDG_CONFIG_HOME/z30`, else `~/.z30` (on Windows `~` is
`%USERPROFILE%`). This is the directory the retired app used, so `--migrate` finds its files.

| File | Contents |
| :--- | :--- |
| `config.toml` | the configuration below |
| `logbook.sqlite` | the logbook, with per-field provenance |

`z30 --config PATH` uses another configuration file.

## `config.toml`

A new installation's configuration (this is exactly what `z30 --migrate` writes when there is
nothing to migrate):

```toml
[station]
callsign = ""            # empty: transmit refused
grid = ""                # 4 or 6 characters; v1 sends the 4-character square if it is in the table
# region = "IARU_R1"     # IARU_R1 | IARU_R2 | IARU_R3 | US; absent: transmit refused
# license_class = "FULL" # FULL | US_EXTRA | US_ADVANCED | US_GENERAL | US_TECHNICIAN; absent: refused
# configured_tx_power_w = 25.0   # what you set on the radio; logged as configuration, never as a measurement

[operating]
dial_hz = 14076000       # USB dial frequency
rx_audio_hz = 1250.0
tx_audio_hz = 1250.0     # tone 0; tone 15 is 46.9 Hz above
tx_slot = "even"         # even = :00, odd = :30
auto_sequence = true
watchdog_cycles = 6      # stop after this many transmissions without progress
auto_log = true          # log completed contacts (only received/measured fields)

[ptt]
method = "none"          # none | vox | cat | serial | cm108 (serial: port, line = "rts"/"dtr", active_high; cm108: device, pin, active_high)

[rig]
rigctld_host = ""        # empty: no rig control (dial unverified)
rigctld_port = 4532
poll_interval_ms = 1000

[audio]
# input_device = "USB Audio CODEC"    # substring of the device name; absent = system default
# output_device = "USB Audio CODEC"
tx_level = 0.5           # 0..1 of full scale

[receiver]
band_lo_hz = 200.0
band_hi_hz = 2800.0
max_candidates = 50
passes = 3               # 1 disables SIC
max_drift_hz = 4.0
ap_enabled = false       # a priori decoding; decodes it recovers are labelled a1-a6
```

Safety limits (the 40 s PTT watchdog, the band plans) are compile-time constants, not
configuration: nothing in this file can raise them.

## Environment variables

| Variable | Effect |
| :--- | :--- |
| `Z30_HOME` | the data directory |
| `XDG_CONFIG_HOME` | `$XDG_CONFIG_HOME/z30` when `Z30_HOME` is unset |
| `RAYON_NUM_THREADS` | threads the decoder uses (default: one per CPU) |
| `SOURCE_DATE_EPOCH` | at build time: the build date recorded in `--version` (reproducible builds) |

There is no longer a local web server, a `.env` file or a system-clock-step option: z-30 never
changes the system clock.
