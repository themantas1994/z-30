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
No. The protocol is validated (an independent implementation reproduces it bit for bit) and the
receiver is measured in seeded software simulation. No radio, audio interface, PTT interface or
RF path has been used, and there is no on-air recording. See
[`docs/hardware-validation.md`](../docs/hardware-validation.md) for how that will be done.

### How sensitive is it compared with FT8?
In AWGN simulation, about 2 dB deeper at the 50% point — bought with 1.9× the airtime and 14
fewer message bits; per message bit it needs about 1.6 dB **more** energy than FT8. On a
high-latitude (10 Hz Doppler) path it does not decode at all. The figures, their conditions and
sources are on [11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) and
[16](16-Benchmarking-Testing-&-CI.md). None is an on-air measurement.

### How many stations fit in the passband?
A frame occupies about 50 Hz (99%) and 66 Hz (−40 dB), and the receiver searches 200–2800 Hz.
Stations do not need separate frequencies: in simulation, 40 stations placed at random
(overlapping) positions decoded at the rate shown on [16](16-Benchmarking-Testing-&-CI.md), with
no false decodes. That is a simulation of a busy band, not a measurement of one.

### What does "pass 2" or "pass 3" on a decode mean?
The station was found after SIC removed stronger stations decoded in an earlier pass
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
callsign / region / licence class / PTT method set; the emission would fall outside a permitted
data segment (move the audio offset or dial); `rigctld` reports a different dial than the one
commanded (re-send the frequency or check the radio).

**The radio does not key.**
- `cat`: is `rigctld` started with the right `-P` PTT option for your interface? A reply other
  than `RPRT 0` is reported as a failure.
- `serial`: correct port and RTS vs DTR? Polarity (`active high`) inverted?
- `cm108`: was the program built with CM108 support (`z30 --version` → `features: cm108`)? Does
  your user have access to the hidraw device?
- On Linux, serial ports need the `dialout` (Debian/Ubuntu) or `uucp` (Arch) group.

**ALC moves / wide signal.** Lower the TX level (Settings → Audio) until the radio's ALC shows
nothing. z-30's waveform has a constant envelope; ALC action distorts it.

**The GUI will not start on Linux.** It needs the X11 or Wayland libraries. On a headless
machine use `z30 --receive`.
