# z-30: a weak-signal digital mode for amateur radio

z-30 is an experimental HF digital mode for amateur radio, together with the open-source
software that sends and receives it. It is built for the same job as FT8 and similar weak-signal
modes: short, structured contacts between stations on very noisy or crowded bands. It trades
airtime for sensitivity. A frame is 24 seconds long inside a 30-second UTC slot and about 50 Hz
wide, and in simulation the receiver decodes it about 2 dB below where FT8's published figure
sits.

The software is a single Rust workspace. It builds two programs: **`z30-gui`**, a desktop
station with a waterfall, decode list, QSO sequencing and logbook, and **`z30`**, a
command-line station and toolbox that can receive, decode and encode recordings, run
diagnostics and run the benchmark suite. `z30` never transmits.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust 1.95+](https://img.shields.io/badge/rust-1.95%2B-orange.svg)](docs/install.md)
[![Status: experimental](https://img.shields.io/badge/status-experimental-red.svg)](#project-status)
[![Real-radio validation: not yet performed](https://img.shields.io/badge/real--radio%20validation-not%20yet%20performed-lightgrey.svg)](docs/hardware-validation.md)

## Project status

| | |
| :--- | :--- |
| Protocol | Validated. The Rust implementation reproduces the frozen golden vectors (CRC, LDPC encoder, symbol map and codec bit for bit; the GFSK waveform within 1e-6 per sample). See [`fixtures/golden/`](fixtures/golden/) and [`SPEC.md`](SPEC.md). |
| Software simulation | Validated. The receiver is measured through its production entry point in seeded simulation: [measurements](docs/benchmarking.md). |
| Hardware | **Not validated.** No radio, sound card or PTT interface has been used with z-30. |
| On air | **Not validated.** No z-30 frame has been decoded over a real radio path, and no other software speaks z-30. |

Treat it as a research project. Passing tests does not make it ready for the air. The
[hardware validation procedure](docs/hardware-validation.md) has to be carried out and recorded
first, and until then the first transmission belongs on a dummy load.

## How the mode works

A message carries 63 bits: two 28-bit callsign fields and a 7-bit field for a grid square,
signal report or acknowledgement. A 14-bit CRC brings that to 77 information bits, which an
(216, 77) LDPC code expands to 216 coded bits. Those are sent as 54 data symbols and a 21-symbol
synchronisation pattern: 75 symbols of 320 ms each, 16-tone continuous-phase GFSK with 3.125 Hz
tone spacing. The result is a constant-envelope signal about 50 Hz wide that any SSB transmitter
can send from a sound card.

The receiver (`decode_slot`) has no frequency or timing hint. It searches 200–2800 Hz and
±1.5 s of timing for the synchronisation pattern, demodulates non-coherently, and decodes with
four belief-propagation schedules followed by an ordered-statistics fallback. After each
successful decode it subtracts the signal by least-squares fitting and searches the residual, for
up to three passes of successive interference cancellation, so a strong station does not hide a
weak one. Optional a priori decoding can complete a frame when part of the message is already
known; it is off by default and every such decode is labelled.

The message vocabulary is deliberately small. Portable and compound callsigns, free text and
grids outside a 63-square table cannot be sent. The encoder refuses them instead of sending
something different from what you typed.

| | |
| :--- | :--- |
| Modulation | 16-GFSK, continuous phase, constant envelope, 3.125 Hz tone spacing, 320 ms symbols |
| Occupied bandwidth | about 50 Hz (99%) |
| Frame | 75 symbols (54 data, 21 sync), 24.0 s, in a 30 s UTC slot |
| Message | 63 bits plus CRC-14, LDPC (216, 77), rate 0.356 |
| Receiver search | 200–2800 Hz, ±1.5 s timing, linear drift to ±4 Hz |
| Rig control | Hamlib `rigctld`; PTT by CAT, serial RTS/DTR, CM108 GPIO or VOX |
| Time | the operating system's UTC clock; z-30 never sets it |
| Platforms | Linux, Windows and macOS; built and tested in CI |

## Sensitivity: what was measured

> Seeded AWGN simulation through `decode_slot`: **50% of frames decode at −23.03 dB
> [−23.13, −22.89] and 90% at −22.06 dB [−22.15, −21.80]**, with SNR in a 2500 Hz reference
> bandwidth. Acquisition was blind (tone 0 uniform over 210–2740 Hz, timing uniform over
> ±1.4 s, random phase and payload). Success means the decoded 63 payload bits equal the
> transmitted ones; 200 frames per point; suite seed 20260830; Wilson 95% intervals. Source:
> [`research/results/672cef9b3cdb/awgn.json`](research/results/672cef9b3cdb/awgn.json).
> **Simulation only; nothing here was measured on a radio.**

The comparison with FT8 has to be read whole. z-30 is about 2 dB deeper than FT8's published
−21 dB, which is itself a simulation figure from different conditions. It pays for that with
1.9 times the airtime and 14 fewer message bits, and per message bit it needs about 1.6 dB more
Eb/N0 than FT8. On the ITU-R F.1487 high-latitude moderate fading channel (10 Hz Doppler) it
does not decode at any SNR, because the Doppler spread is wider than the tone spacing. FT8 also
recovers collisions by subtracting decoded signals, as z-30 does. Fading, collision and
false-decode results, with their conditions, are in [docs/benchmarking.md](docs/benchmarking.md);
the comparison itself is in [wiki/11](wiki/11-Physics-&-Comparative-Analysis-z30-vs-FT8.md).

## Install

Release archives are not published yet. Build from source with Rust 1.95 or newer. On Linux you
also need the ALSA, udev and X11/Wayland development packages
([details](docs/install.md)).

```bash
git clone https://github.com/themantas1994/z-30.git && cd z-30
cargo install --locked --path crates/z30-cli --features cm108
cargo install --locked --path crates/z30-gui --features cm108
z30 --version
```

`--features cm108` adds CM108/CM119 sound-card GPIO keying and can be left out.

## Run

```bash
z30 --diagnostics            # clock status, PTT, rigctld, audio devices, transmit-gate verdict
z30 --devices                # audio input/output devices and serial ports
z30 --receive                # receive-only station; Ctrl-C to stop
z30 --decode recording.wav   # decode a recording
z30 --encode "CQ K1ABC FN31" --wav cq.wav     # write a frame to a WAV file
z30-gui                      # the desktop station
```

Receive first. Put the radio in USB (or its USB data mode), feed its audio to the computer, and
watch decodes appear at the start of each slot. [wiki/01](wiki/01-New-User-Guide-&-First-Steps.md)
walks through a first session, and [wiki/15](wiki/15-Command-Line-Tools-&-Configuration.md)
lists every command.

### Audio, rig control and configuration

z-30 uses the system audio devices through cpal and resamples to its internal 6 kHz rate, so any
common sample rate works ([docs/audio.md](docs/audio.md)). For CAT control it talks to a
[Hamlib](https://hamlib.github.io/) `rigctld` that you start yourself; PTT can also come from a
serial RTS/DTR line, a CM108 GPIO pin or VOX ([wiki/06](wiki/06-Transceiver-CAT-Control-&-PTT-Wiring.md)).

Settings live in `config.toml` under `$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30`.
A new installation has no callsign, region, licence class, PTT method, dial frequency or
transmit level, and **the transmit gate refuses to transmit until all of them are set.** The
clock matters too: keep the computer on UTC with NTP or GPS. The receiver tolerates ±1.5 s in
total ([wiki/07](wiki/07-RF-Time-Synchronization-Engine.md)).

## Before you transmit

The gate checks the radiated frequency, not the dial, against the permitted segments for your
region and licence class. It also refuses a frequency your radio contradicts, a message that
would not go out exactly as shown, and any transmission while a PTT release is unconfirmed or
the audio output has failed. Beyond that:

- Key into a dummy load first, keep ALC at zero, and check the signal on a second receiver.
- Enable your radio's own transmit time-out if you key by CAT or CM108.
- With serial RTS/DTR PTT, expect that opening the port may briefly key the line.

The full list is in [wiki/13](wiki/13-Operating-Safety-Compliance-&-Security.md) and the
mechanisms behind it are in [docs/safety.md](docs/safety.md).

## Limitations

- No hardware or on-air validation, and no interoperability with any other software.
- A ±1.5 s timing window and no built-in time source.
- No decoding on high-Doppler paths.
- Rig control only through an external `rigctld`; no split operation; USB assumed.
- CAT and CM108 PTT are not released if the computer loses power; the radio's own time-out is
  the defence.
- A small vocabulary: 63 grid squares, no roger bit, no portable calls.
- The reported SNR reads low on signals with phase noise or fading, and no published figure
  covers the capture, resampler and scheduler chain ([what is not
  measured](docs/benchmarking.md#not-measured)).

## Testing and benchmarks

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --release
z30 --loopback-test          # in-memory transmit/receive round trip; opens no device
z30 --benchmark suite        # every published measurement; about an hour on four cores
```

The benchmark suite calls the same `decode_slot` the stations use and writes JSON with build
provenance under `research/results/<commit>/`. Methodology, conditions and reporting rules are
in [docs/benchmarking.md](docs/benchmarking.md).

## Documentation

| Where | What |
| :--- | :--- |
| [`wiki/`](wiki/Home.md) | the technical and operating documentation |
| [`docs/`](docs/README.md) | how the code works: architecture, receiver, LDPC, SIC, audio, hardware, safety, benchmarking |
| [`SPEC.md`](SPEC.md) | the normative v1 protocol specification |
| [`research/results/`](research/results) | every published measurement, machine-readable |
| [`audit/`](audit) | historical audits and remediation evidence |

## Contributing

Pull requests are welcome. Run the three checks above before you open one. Safety tests are
never weakened to make a change pass, and every published number needs a result file behind it.
[wiki/02](wiki/02-Developer-Setup-&-Contributing.md) and
[docs/development.md](docs/development.md) describe the workspace and the house rules.

If you used the earlier browser/Python version of z-30, `z30 --migrate` imports its
configuration and logbook once ([what it does and does not import](docs/troubleshooting.md#migration)).

## Licence

MIT. See [LICENSE](LICENSE).
