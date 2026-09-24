# 07. Time Synchronisation

> **The RF time synchronisation engine has been removed.** This page kept its old file name so
> links still work. What z-30 does about time now is below.

## Why it was removed

The legacy RF time sync (`rf_time_sync.py`, `rfTimeSyncEngine.ts`) claimed to set the clock from
WWV/WWVH/CHU/DCF77/MSF/WWVB/JJY "with sub-millisecond precision". The 2026-09-23 and 2026-09-24
audits found (C-03, F-01) that it never decoded a time code at all:

- its "RF timestamp" was the computer's own clock rounded to the minute — it measured the clock
  against itself;
- it reported success unconditionally once a crude pre-check passed, and the pre-check passed on
  pure noise (20 of 20 noise dwells "succeeded");
- its SNR was floored (`max(snr, 6.5)` and similar) and its confidence was a constant;
- with no audio device it silently used its own simulator, reported
  `SYNC OK … Offset: +29666.24 ms`, and **persisted that offset**, which could then step the OS
  clock.

The sample output this page used to show (correlation 0.942, ±0.8 ms) was not a measurement
either. Nothing of it remains in z-30. The retired browser snapshot's copy now always fails and
stores nothing. The network time query ("atomic UTC, sub-millisecond" from one HTTP round trip,
and a time-zone parsing error) is removed too.

## What z-30 does

- It uses the **operating system's UTC clock** and never changes it or applies an offset of its
  own.
- It reports the operating system's own synchronisation status: on Linux,
  "NTP-synchronised" only when `timedatectl` says so, "NOT synchronised" when it says not,
  "unavailable" when it cannot be asked; on Windows and macOS, "not checked". It never says
  "OK" by default.
- The GUI shows the **median DT** of recent decodes: a clock that is off shows up as every
  station appearing early or late by the same amount. It is a diagnostic hint, not a correction.
- `z30 --migrate` never imports a legacy clock offset.

## What you need to do

The receiver's timing window is **±1.5 s in total**, shared by the other station's clock, your
clock, both sound cards' latency and the propagation delay. Measured through `decode_slot`,
frames decode at ±1.5 s and essentially never at ±1.6 s ([16](16-Benchmarking-Testing-&-CI.md)).
Keep the computer within a few tenths of a second of UTC:

- **At home:** the operating system's NTP client (`systemd-timesyncd`, `chrony`, Windows Time,
  macOS time server). Check `timedatectl` / `w32tm /query /status`.
- **In the field, without Internet:** a GPS receiver with `gpsd` + `chrony` (PPS if available).
  z-30 does not manage this and has not been tested with it.

WSJT-X asks for the same thing (clock within ±1 s of UTC); its FT8 receiver searches a wider
window (about ±2.5 s) than z-30's ±1.5 s.
