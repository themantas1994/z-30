# z-30 Wiki

Operator documentation for **z-30**, an experimental weak-signal digital mode for amateur
radio, and for the software that operates it: **`z30-gui`** (desktop station) and **`z30`**
(command-line station and toolbox), native programs built from the Rust workspace in `crates/`.

> **Status**
>
> | | |
> | :--- | :--- |
> | Protocol validated | **yes, against the reference** — the Rust implementation reproduces the frozen oracle's golden vectors bit for bit (an independent re-implementation from `SPEC.md` was reported by the original audit, E007, whose evidence is not in this repository) |
> | Software simulation validated | **yes** — seeded measurements through the production receiver ([16](16-Benchmarking-Testing-&-CI.md)) |
> | Hardware validated | **no** — no radio, audio interface or PTT interface has been used |
> | On-air validated | **no** — no frame has been decoded over a real radio path; nobody else runs z-30 |
>
> **Real-radio validation: not yet performed.** Transmit into a dummy load first.

These pages agree with [`SPEC.md`](../SPEC.md) (the normative protocol) and
[`docs/`](../docs/README.md) (the developer documentation of the code). Where they disagree,
that is a bug; a seeded, paired benchmark result outranks all of them.

## What z-30 is

A 63-bit message (two callsigns and a grid, report or acknowledgement), protected by a 14-bit
CRC and a rate-0.356 LDPC code, sent as a 24-second, ~50 Hz-wide, continuous-phase 16-tone GFSK
frame in a 30-second UTC slot. The receiver searches the whole 200–2800 Hz passband blind, and
removes decoded stations (least-squares interference cancellation) to find weaker ones.

**Sensitivity, with its conditions** (vNext `decode_slot`, AWGN simulation, 2500 Hz reference,
blind acquisition over 210–2740 Hz and ±1.4 s, 200 frames per point, seed 20260830, no hardware
involved): **50% decode at −23.03 dB [−23.13, −22.89]**, 90% at −22.06 dB. That is about 2 dB
deeper than FT8's published (simulation) −21 dB, bought with 1.9× the airtime and 14 fewer
message bits — per message bit z-30 needs about 1.6 dB **more** energy — and on a high-latitude
path with 10 Hz Doppler spread z-30 does not decode at any SNR. Details and every other
condition: [16](16-Benchmarking-Testing-&-CI.md), [11](11-Physics-&-Comparative-Analysis-z30-vs-FT8.md).

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

### History
- [08. The retired browser runtime](08-Web-&-PWA-Architecture.md)

## Editing this wiki

These pages are markdown files under `wiki/` in the repository, edited by pull request. Figures
come from result files under `research/results/`, pasted from `research/summarize_suite.py`
output, never retyped. The retired browser app's in-app copy of the wiki is frozen and no longer
regenerated from these files.

- **Repository:** <https://github.com/themantas1994/z-30>
- **Licence:** [MIT](../LICENSE)
