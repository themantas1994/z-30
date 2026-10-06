# 07. Time Synchronisation

> **The RF time synchronisation engine has been removed.** This page kept its old file name so
> links still work. What z-30 does about time now is below.

## What z-30 does

- It uses the **operating system's UTC clock** and never changes it or applies an offset of its
  own.
- It reports the operating system's own synchronisation status: on Linux,
  "NTP-synchronised" only when `timedatectl` says so, "NOT synchronised" when it says not,
  "unavailable" when it cannot be asked; on Windows and macOS, "not checked"; "not yet checked"
  until the first query (which runs on a thread of its own) has answered. It never says
  "OK" by default.
- The GUI shows the **median DT** of recent decodes: a clock that is off shows up as every
  station appearing early or late by the same amount. It is a diagnostic hint, not a correction.
- `z30 --migrate` never imports a legacy clock offset.
- **If the system clock jumps** by more than about a slot (a manual change, or NTP stepping a
  badly wrong clock), the receiver re-seats itself on the new time and says so: "The system clock
  stepped ±N s; the receiver moved from slot A to slot B" in the GUI, and a `--` line from
  `z30 --receive`. After a backward jump the slots that come round again are decoded again; after
  a forward jump the skipped slots are not decoded. Small corrections (a slew, or a step of a
  second or two) are absorbed without a message. Before this, a backward jump silenced the
  receiver for as long as the jump.

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
