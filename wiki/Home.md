# z-30 Wiki

z-30 is an experimental weak-signal digital mode for amateur radio, with two programs that run
it: **`z30-gui`**, the desktop station, and **`z30`**, the command-line station and toolbox. A
63-bit message is sent as a 24-second, 50 Hz-wide, 16-tone GFSK frame inside a 30-second UTC
slot, and the receiver searches 200–2800 Hz blind. This wiki is the operator and technical
reference. The [README](../README.md) is the short introduction.

It is written for licensed amateurs comfortable with a sound card, CAT control and a command
line, and for developers who want to read or extend the Rust code in `crates/`.

> **Status.** The protocol and the receiver are validated in software simulation. Nothing has
> been validated on hardware or on the air: no radio, sound card or PTT interface has been used
> with z-30, and no other software speaks it. Transmit into a dummy load first.

## Where to start

| I want to… | Read |
| :--- | :--- |
| install z-30 and run a first session | [01. New User Guide](01-New-User-Guide-&-First-Steps.md), then [09. Build & Packaging](09-Cross-Platform-Build-&-Packaging.md) for building from source |
| connect a radio, PTT and the clock | [06. CAT Control & PTT](06-Transceiver-CAT-Control-&-PTT-Wiring.md), [07. Time Synchronisation](07-RF-Time-Synchronization-Engine.md) |
| know what stops a bad transmission | [13. Operating Safety, Compliance & Security](13-Operating-Safety-Compliance-&-Security.md) (read before transmitting) |
| use the window or the command line | [14. User Interface](14-User-Interface-&-Operation-Reference.md), [15. Command-Line Tools & Configuration](15-Command-Line-Tools-&-Configuration.md) |
| fix something that does not work | [10. Troubleshooting & FAQ](10-Troubleshooting-&-FAQ.md) |
| understand the waveform and the receiver | [03. DSP & Physical Layer](03-DSP-&-Physical-Layer-Specification.md), then [04. LDPC](04-Forward-Error-Correction-&-LDPC.md), [05. SIC](05-Successive-Interference-Cancellation-(SIC).md), [17. A Priori Decoding](17-A-Priori-(AP)-Decoding.md) |
| compare z-30 with FT8 | [11. z-30 vs FT8](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) |
| see how the figures are measured, and the tests and CI | [16. Benchmarking, Testing & CI](16-Benchmarking-Testing-&-CI.md) |
| build from source and contribute | [02. Developer Setup & Contributing](02-Developer-Setup-&-Contributing.md), [12. Updates & Releases](12-Software-Updates-&-GitHub-Sync.md) |

## The one number to remember, with its conditions

In seeded AWGN simulation through the production receiver (2500 Hz reference bandwidth, blind
acquisition, 200 frames per point, seed 20260830, Wilson 95% intervals), 50% of frames decode at
−23.03 dB [−23.13, −22.89] and 90% at −22.06 dB [−22.15, −21.80]
(`research/results/672cef9b3cdb/awgn.json`). Against FT8 this has to be read whole: z-30 is about
2 dB deeper than FT8's published figure, with 1.9 times the airtime and 14 fewer message bits,
about 1.6 dB more Eb/N0 per message bit, and no decoding on strongly Doppler-spread paths. The
conditions are on [16](16-Benchmarking-Testing-&-CI.md) and
[11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md).

## All pages

**Operating:**
[01](01-New-User-Guide-&-First-Steps.md) ·
[06](06-Transceiver-CAT-Control-&-PTT-Wiring.md) ·
[07](07-RF-Time-Synchronization-Engine.md) ·
[10](10-Troubleshooting-&-FAQ.md) ·
[13](13-Operating-Safety-Compliance-&-Security.md) ·
[14](14-User-Interface-&-Operation-Reference.md) ·
[15](15-Command-Line-Tools-&-Configuration.md)

**Protocol and DSP:**
[03](03-DSP-&-Physical-Layer-Specification.md) ·
[04](04-Forward-Error-Correction-&-LDPC.md) ·
[05](05-Successive-Interference-Cancellation-(SIC).md) ·
[11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md) ·
[17](17-A-Priori-(AP)-Decoding.md)

**Building, testing, releases:**
[02](02-Developer-Setup-&-Contributing.md) ·
[09](09-Cross-Platform-Build-&-Packaging.md) ·
[12](12-Software-Updates-&-GitHub-Sync.md) ·
[16](16-Benchmarking-Testing-&-CI.md)

## How these pages relate to the rest of the repository

The normative protocol is [`SPEC.md`](../SPEC.md). [`docs/`](../docs/README.md) describes how the
code in `crates/` works. These pages agree with both; where they do not, that is a bug, the
source and tests win over prose, and a seeded, paired benchmark result outranks everything.
[`audit/`](../audit/README.md) holds historical review reports, not current guidance.

Pages are markdown files under `wiki/`, edited by pull request. Figures come from result files
under `research/results/`, never from memory. Links between pages use file names so they work
when browsing the repository; `_Sidebar.md` and `_Footer.md` use GitHub Wiki page names without
`.md`, which work only in a published GitHub Wiki.

[Repository](https://github.com/themantas1994/z-30) · [Licence: MIT](../LICENSE)
