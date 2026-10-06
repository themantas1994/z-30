# z-30 Wiki

Technical and operating documentation for **z-30**, an experimental weak-signal digital mode
for amateur radio, and for the two programs that operate it: **`z30-gui`**, the desktop
station, and **`z30`**, the command-line station and toolbox. Both are built from the Rust
workspace in `crates/`. If you only want to know what z-30 is and how to install it, start with
the [README](../README.md).

> **Status.** The protocol and the receiver are validated in software simulation. Nothing has
> been validated on hardware or on the air: no radio, sound card or PTT interface has been used
> with z-30, and no other software speaks it. Transmit into a dummy load first.

These pages agree with [`SPEC.md`](../SPEC.md) (the normative protocol) and
[`docs/`](../docs/README.md) (how the code works). Where they disagree, that is a bug, and a
seeded, paired benchmark result outranks all of them.

## What z-30 is

A 63-bit message (two callsigns and a grid, report or acknowledgement) is protected by a 14-bit
CRC and a rate-0.356 LDPC code, and sent as a 24-second, 50 Hz-wide, continuous-phase 16-tone
GFSK frame inside a 30-second UTC slot. The receiver searches the whole 200–2800 Hz passband
blind and subtracts each decoded station to find weaker ones underneath.

In seeded AWGN simulation through the production receiver (2500 Hz reference bandwidth, blind
acquisition over 210–2740 Hz and ±1.4 s, 200 frames per point, seed 20260830, Wilson 95%
intervals, `research/results/672cef9b3cdb/awgn.json`), 50% of frames decode at −23.03 dB
[−23.13, −22.89] and 90% at −22.06 dB [−22.15, −21.80]. The comparison with FT8 must be read
whole: z-30 is about 2 dB deeper than FT8's published figure, with 1.9 times the airtime and 14
fewer message bits, about 1.6 dB more Eb/N0 per message bit, and no decoding on strongly
Doppler-spread paths. Conditions and sources: [16](16-Benchmarking-Testing-&-CI.md) and
[11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md).

## Pages

### Operating
- [01. New User Guide & First Steps](01-New-User-Guide-&-First-Steps.md)
- [13. Operating Safety, Compliance & Security](13-Operating-Safety-Compliance-&-Security.md)
- [14. User Interface & Operation Reference](14-User-Interface-&-Operation-Reference.md)
- [06. Transceiver CAT Control & PTT Wiring](06-Transceiver-CAT-Control-&-PTT-Wiring.md)
- [07. Time Synchronisation](07-RF-Time-Synchronization-Engine.md)
- [10. Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md)
- [15. Command-Line Tools & Configuration](15-Command-Line-Tools-&-Configuration.md)

### Protocol & DSP
- [03. DSP & Physical Layer Specification](03-DSP-&-Physical-Layer-Specification.md)
- [04. Forward Error Correction & LDPC](04-Forward-Error-Correction-&-LDPC.md)
- [05. Successive Interference Cancellation (SIC)](05-Successive-Interference-Cancellation-(SIC).md)
- [17. A Priori (AP) Decoding](17-A-Priori-(AP)-Decoding.md)
- [11. Physics & Comparative Analysis: z-30 vs FT8](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md)

### Building, testing, releases
- [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md)
- [09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md)
- [12. Software Updates & Releases](12-Software-Updates-&-GitHub-Sync.md)
- [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md)

## Maintaining this wiki

The pages are markdown files under `wiki/`, edited by pull request. Figures come from result
files under `research/results/`, reformatted from `research/summarize_suite.py` output, never
retyped from memory. `_Sidebar.md` and `_Footer.md` use GitHub Wiki page names without `.md`,
so they work only in a published GitHub Wiki, not when browsing the repository.

- **Repository:** <https://github.com/themantas1994/z-30>
- **Licence:** [MIT](../LICENSE)
