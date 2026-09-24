<div align="center">

# z-30

**An experimental weak-signal digital mode for amateur radio, and the native software that
operates it.**

16-tone GFSK · 30 s UTC slots · 24 s frames · ~50 Hz wide · 63-bit messages · LDPC (216, 77) ·
least-squares interference cancellation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust 1.95+](https://img.shields.io/badge/rust-1.95%2B-orange.svg)](docs/install.md)
[![Status](https://img.shields.io/badge/status-experimental-red.svg)](#current-state)
[![Hardware](https://img.shields.io/badge/real--radio%20validation-not%20yet%20performed-lightgrey.svg)](docs/hardware-validation.md)

[Install](docs/install.md) · [First steps](wiki/01-New-User-Guide-&-First-Steps.md) ·
[Before you transmit](wiki/13-Operating-Safety-Compliance-&-Security.md) ·
[Protocol](SPEC.md) · [Measurements](docs/benchmarking.md) · [Wiki](wiki/Home.md) ·
[Developer docs](docs/README.md)

</div>

---

## Architecture

**z-30 vNext — Rust production runtime.** z-30 is two native programs built from one Rust
workspace (`crates/`):

- **`z30-gui`** — the desktop station: waterfall, decodes, QSO sequencing, transmit gate,
  logbook.
- **`z30`** — the command-line station and toolbox: receive-only live station, decoding and
  encoding recordings, diagnostics, migration from the old version, the benchmark suite. It
  never transmits.

Both use the same receiver (`decode_slot`), the same engine and the same transmit gate. Neither
needs Python, Node or a browser, and neither falls back to anything else: if the audio device,
the PTT line or rig control cannot be opened, the program says so and stops.

The earlier browser/Python application is **retired**. Its Python protocol code survives as a
frozen, non-production reference in [`legacy/`](legacy/README.md); nothing an operator installs
uses it.

## Current state

| | Status |
| :--- | :--- |
| **Protocol validated** | **Yes.** An independent re-implementation written from [`SPEC.md`](SPEC.md) alone reproduces the CRC, LDPC encoder, symbol map and waveform bit for bit. |
| **Software simulation validated** | **Yes.** The receiver is measured through its production entry point in seeded simulation (AWGN, drift, timing, clock error, impairments, busy bands, collisions, fading, false decodes) — [measurements](docs/benchmarking.md). |
| **Hardware validated** | **No.** Real-radio validation: **not yet performed.** No radio, audio interface or PTT interface has been used with z-30. |
| **On-air validated** | **No.** No z-30 frame has been decoded over a real radio path. No other software speaks z-30. |

z-30 is experimental. Passing tests does not make it production-ready, and nothing here should be
read as a claim that it works on the air until the [hardware validation
procedure](docs/hardware-validation.md) has been carried out and recorded.

## Sensitivity — what was measured, and how

> **vNext `decode_slot`: 50% decode at −23.03 dB [−23.13, −22.89], 90% at −22.06 dB
> [−22.15, −21.80].** AWGN simulation; SNR in a 2500 Hz reference bandwidth (SPEC §10); blind
> acquisition (tone 0 uniform over 210–2740 Hz, DT uniform over ±1.4 s, random carrier phase,
> random payload); success = the decoded 63 payload bits equal the transmitted ones; 200 frames
> per SNR point; suite seed 20260830; Wilson 95% intervals; 0 false decodes in the sweep.
> Source: [`research/results/d8983eeef66e/awgn.json`](research/results/d8983eeef66e/awgn.json).
> **Not measured on real radio hardware.**

Against FT8, all of it or none of it:

- **Sensitivity:** about 2 dB deeper than FT8's published −21 dB — a simulation figure (Franke,
  Somerville & Taylor, *QEX* 2020, as cited by the FT8 Wikipedia article), whose exact
  conditions are not identical to these. No FT8 decoder was run on the same channel.
- **Cost:** z-30 transmits for 24.0 s against FT8's 12.64 s (2.8 dB more energy) and carries 63
  message bits against FT8's 77. **Per message bit it needs about 1.6 dB more Eb/N0 than FT8**
  (6.8 dB against 5.1 dB).
- **Fading:** on ITU-R F.1487 high-latitude moderate (3 ms / 10 Hz Doppler) z-30 **does not
  decode at any SNR**: the Doppler spread is wider than the 3.125 Hz tone spacing. On slower
  fading paths see @@FADING_README@@.
- **Collisions:** both modes subtract decoded signals and decode again; WSJT-X's FT8 decoder
  runs three passes with subtraction. z-30's measured collision behaviour (simulation, two
  stations, paired SIC on/off) is in [docs/benchmarking.md](docs/benchmarking.md#collisions-sic-on-versus-off).

Full comparison and sources: [wiki/11](wiki/11-Physics-&-Comparative-Analysis-z30-vs-FT8.md).

## At a glance

| | |
| :--- | :--- |
| Modulation | 16-GFSK, continuous phase, BT 2.0, constant envelope, 3.125 Hz tone spacing, 320 ms symbols |
| Occupied bandwidth (audio waveform) | ≈ 49–50 Hz (99%), ≈ 66 Hz (−40 dB); Welch, 0.73 Hz bins; transmitter and ALC effects not measured |
| Frame | 75 symbols (54 data + 21 sync), 24.0 s, in a 30 s UTC slot |
| Message | **63 bits**: two 28-bit call fields + a 7-bit grid/report/acknowledgement; + CRC-14 = 77 information bits |
| FEC | IRA-LDPC (216, 77), rate 0.356; four BP schedules + corrected OSD |
| Receiver | blind search 200–2800 Hz, DT ±1.5 s (hard edge), linear drift to ±4 Hz; up to 3 SIC passes |
| Messages v1 cannot carry | portable/compound calls, `ZV`–`ZZ` prefixes, grids outside a 63-square table, roger reports, free text — **refused, never transmitted as something else** |
| Rig control / PTT | `rigctld` (Hamlib); PTT by CAT, serial RTS/DTR, CM108 GPIO or VOX — implemented, **none tested with a radio** |
| Time | the operating system's UTC clock (keep it within a few tenths of a second: NTP or GPS); z-30 never sets it |
| Platforms | Linux, Windows, macOS — built and tested in CI; **not operated with a sound card or radio** |

## Install

From a release archive (none published yet), or from source with Rust 1.95+:

```bash
git clone https://github.com/themantas1994/z-30.git && cd z-30
cargo install --locked --path crates/z30-cli --features cm108
cargo install --locked --path crates/z30-gui --features cm108
z30 --version        # commit, build date, target, features
z30 --diagnostics    # clock status, PTT, rigctld, audio devices, transmit-gate verdict
z30-gui
```

Linux needs the ALSA, udev and X11/Wayland development packages; details, release archives and
desktop integration are in **[docs/install.md](docs/install.md)**. Coming from the old
browser/Python z-30? Run `z30 --migrate` once ([what it imports and what it deliberately does
not](docs/troubleshooting.md#migration)).

## Before you transmit

- Set your callsign, grid, region, licence class and PTT method. There are **no defaults** for
  any of them, and the transmit gate refuses until all are set.
- The gate refuses any emission outside a permitted data segment for your licence (checked at
  the radiated frequency, not the dial), any frequency your radio contradicts, and any message
  that would not go out exactly as shown.
- Key into a dummy load first, keep ALC at zero, check the signal on another receiver, and
  enable your radio's transmit time-out if you key by CAT or CM108.
- See [wiki/13](wiki/13-Operating-Safety-Compliance-&-Security.md).

## Limitations

The full list is [audit/2026-09-24-vnext-remediation/KNOWN_LIMITATIONS.md](audit/2026-09-24-vnext-remediation/KNOWN_LIMITATIONS.md).
The ones that matter first: no hardware or on-air validation; no interoperability with any other
software; a ±1.5 s timing window with no built-in time source; no decoding on high-Doppler paths;
rig control only through an external `rigctld`; no split operation; USB assumed; CAT/CM108 PTT
not released if the computer loses power (the radio's time-out is the defence); a small message
vocabulary (63 grids, no roger bit, no portable calls).

## Documentation

| Where | What |
| :--- | :--- |
| [`SPEC.md`](SPEC.md) | the normative v1 protocol specification |
| [`docs/`](docs/README.md) | how the code works: architecture, receiver, synchronisation, demodulation, LDPC, SIC, audio, hardware, safety, benchmarking, install, hardware validation |
| [`wiki/`](wiki/Home.md) | operator documentation |
| [`research/results/`](research/results) | every published measurement, machine-readable, with provenance |
| [`audit/`](audit) | independent audits and the evidence for this remediation |
| [`AGENTS.md`](AGENTS.md) | working context and invariants for contributors and coding assistants |

## Contributing

See [wiki/02](wiki/02-Developer-Setup-&-Contributing.md) and [`AGENTS.md`](AGENTS.md). In short:
`cargo fmt`, `cargo clippy -- -D warnings`, `cargo test --workspace --exclude z30-py --release`;
safety tests are never weakened to pass; every number needs a result file.

## Licence

MIT — see [LICENSE](LICENSE).
