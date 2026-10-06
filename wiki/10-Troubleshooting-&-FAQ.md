# 10. Troubleshooting & FAQ

The developer-level troubleshooting reference is
[`docs/troubleshooting.md`](../docs/troubleshooting.md). Start every diagnosis with:

```bash
z30 --diagnostics
```

It prints the configuration in use, the operating system's clock status, the PTT method and
whether it could be opened, whether `rigctld` answers and what it reports, the audio devices,
and every reason the transmit gate would refuse to transmit.

## FAQ

### Has z-30 been tested on the air?
No. The protocol is validated against the frozen reference oracle: the Rust implementation
reproduces its golden vectors (codec, CRC, LDPC encoder and symbol map bit for bit, the waveform
within 1e-6 per sample), checked in CI. The receiver is measured in seeded software simulation. No radio, audio interface, PTT interface or
RF path has been used, and there is no on-air recording. See
[`docs/hardware-validation.md`](../docs/hardware-validation.md) for how that will be done.

### How sensitive is it compared with FT8?
All of it or none of it: in AWGN simulation (vNext `decode_slot`, 50% at −23.03 dB), about 2 dB
deeper than FT8's published −21 dB (a simulation figure from Franke, Somerville & Taylor, QEX
2020, conditions not identical), bought with 1.9× the airtime and 14 fewer message bits; **per
message bit z-30 needs about 1.6 dB more Eb/N0 than FT8** (6.8 vs 5.1 dB); and on ITU-R F.1487
high-latitude moderate (10 Hz Doppler) z-30 does not decode at any SNR. FT8 **does** recover
collisions (WSJT-X runs three passes with subtraction). The figures, their conditions and
sources are on [11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) and
[16](16-Benchmarking-Testing-&-CI.md). None is an on-air measurement.

### How many stations fit in the passband?
A frame occupies about 50 Hz (99%) and 66 Hz (−40 dB), and the receiver searches 200–2800 Hz.
Stations do not need separate frequencies: in simulation, 40 stations placed at random
(overlapping) positions decoded at the rate shown on [16](16-Benchmarking-Testing-&-CI.md), with
no false decodes. That is a simulation of a busy band, not a measurement of one.

### How do I know a station was found by interference cancellation?
Neither the GUI's decode list nor the CLI's decode line shows it. The pass that found each decode
(1, 2 or 3; 2 and 3 are after SIC removed stronger stations) is recorded in the `"pass"` field of
the report JSON that `z30 --receive --capture-slots DIR` writes for every slot
([05](05-Successive-Interference-Cancellation-(SIC).md)).

### What does `a1`…`a6` mean?
The frame decoded only with a priori information about the QSO in progress (off by default;
[17](17-A-Priori-(AP)-Decoding.md)). It is a weaker claim than a decode without help.

### Why is the SNR shown as `<-22` or `>+30`, or `--`?
The SNR estimator's accuracy has been measured from −22 to +30 dB; outside that the display
shows a bound, not a number. `--` means there was no positive signal estimate: nothing was
measured, so nothing is shown.

### Why does z-30 refuse my callsign or grid?
v1 carries only standard callsigns (1–2 character prefix, digit, 1–3 letters; not `ZV`–`ZZ`
prefixes) and only the 63 grid squares in its table. Rather than transmit something else, it
refuses. There is no portable (`/P`) or compound call support in v1.

## Common problems

**No decodes.**
- Radio in **USB** (or USB data mode), IF filter open to at least 2.8 kHz.
- `z30 --devices`: is the right input selected? The GUI's status line shows the input level in
  dBFS and whether audio is running.
- Clock: the median DT in the status line. A consistent offset near ±1.5 s means the computer
  clock is wrong; beyond ±1.5 s nothing decodes ([07](07-RF-Time-Synchronization-Engine.md)).
- `slot N missed: BeforeEpoch` right after start or after an audio dropout is normal: that slot's
  window started before audio did.

**The transmit gate refuses.** Read the reasons: each names the condition. Common ones: no
callsign / region / licence class / PTT method / dial set (also after `z30 --migrate`, which
writes no transmit level and skips the old apps' defaults); transmit level 0; the emission
would fall outside a permitted segment (move the audio offset or dial; on US 60 m the emission
must be centred within 50 Hz of a channel centre); `rigctld` reports a different dial than the
one set, even by a few hertz (the tolerance is a strict 1 Hz; re-send the frequency or check the
radio); the radio refused the dial; the radio reports a mode other than USB/PKTUSB; the audio
output failed (retried every 5 s); a PTT release was not confirmed (**check the radio**: it may
still be transmitting).

**"TX ended incomplete, not counted as sent".** The transmission was cut short, started more
than 0.5 s late, failed, or was stopped by the watchdog. It does not advance the QSO and is not
logged. Faults and halts also disarm TX; re-enable it when the cause is fixed.

**"NOT LOGGED" or a red "CONTACTS ARE NOT BEING LOGGED" banner.** The logbook could not write
the contact, or could not be opened at start; the message gives the reason (disk, permissions,
a locked file). Nothing is kept in memory in its place.

**The radio does not key.**
- `cat`: is `rigctld` started with the right `-P` PTT option for your interface, and was it
  running when the station started (the PTT connection is opened then)? A reply other than
  `RPRT 0` is reported as a failure.
- `serial`: correct port and RTS vs DTR? Polarity (`active high`) inverted?
- `cm108`: was the program built with CM108 support (`z30 --version` → `features: cm108`)? Does
  your user have access to the hidraw device? With more than one C-Media device attached, set
  the device path; an empty path is refused then.
- On Linux, serial ports need the `dialout` (Debian/Ubuntu) or `uucp` (Arch) group.

**ALC moves / wide signal.** Lower the TX level (Settings → Audio) until the radio's ALC shows
nothing. z-30's waveform has a constant envelope; ALC action distorts it.

**The GUI will not start on Linux.** It needs the X11 or Wayland libraries. On a headless
machine use `z30 --receive`.
