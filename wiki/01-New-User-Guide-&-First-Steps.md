# 01. New User Guide & First Steps

z-30 is an **experimental** weak-signal digital mode for amateur radio and the software that
operates it: `z30-gui` (the desktop station) and `z30` (the command-line station and toolbox),
both native programs built from the Rust workspace in `crates/`.

> **Before anything else: what has and has not been validated.**
>
> | State | Status |
> | :--- | :--- |
> | Protocol validated | **Yes** — an independent re-implementation from `SPEC.md` reproduces the encoder bit for bit |
> | Software simulation validated | **Yes** — the receiver's performance is measured through its production entry point in seeded simulation ([16](16-Benchmarking-Testing-&-CI.md)) |
> | Hardware validated | **No** — no radio, audio interface or PTT interface has been used with z-30 |
> | On-air validated | **No** — no z-30 frame has been decoded over a real radio path |
>
> Nobody else runs z-30: there is no interoperability with FT8/WSJT-X or any other program.

## 1. Install

See [`docs/install.md`](../docs/install.md). In short: download the release archive for your
platform (when one exists) or build from source with Rust 1.95+:

```bash
cargo install --locked --path crates/z30-cli --features cm108
cargo install --locked --path crates/z30-gui --features cm108
z30 --version
```

z-30 needs no Python, Node or browser, and it has no fallback: if something cannot start, it
says what and stops.

## 2. Check the machine

```bash
z30 --diagnostics
```

prints the configuration file in use, the operating system's clock status, the PTT method, the
rigctld connection, the audio devices and — most importantly — every reason the transmit gate
would refuse to transmit right now. On a new installation that list is long, on purpose.

**The clock.** z-30 frames start on 30-second UTC boundaries and the receiver tolerates a total
timing error of **±1.5 s** (both stations' clocks, both sound cards, propagation). z-30 reads the
operating-system clock and never sets it. Keep the computer on UTC with NTP (or GPS with
`chrony` + `gpsd` in the field). See [07](07-RF-Time-Synchronization-Engine.md).

## 3. Receive first

Connect the radio's audio output to the computer, set the radio to **USB** (or its USB data
mode) on a z-30 frequency, and start `z30-gui`. Or, headless:

```bash
z30 --devices                        # find your audio input
z30 --receive                        # receive-only station; Ctrl-C to stop
z30 --receive --capture-slots slots/ # also keep every slot's audio (WAV) and decode report (JSON)
```

Decodes show UTC, SNR (dB in 2500 Hz), DT (s), audio frequency (Hz) and the message. An `a1`…`a6`
tag means the frame was completed with a priori information ([17](17-A-Priori-(AP)-Decoding.md)).
An SNR shown as `<-22` or `>+30` is outside the range the estimator has been measured over; `--`
means there was no signal estimate.

## 4. Configure the station before transmitting

In **Settings**: your callsign, grid, regulatory region and licence class, the audio devices,
rigctld (optional but recommended — see [06](06-Transceiver-CAT-Control-&-PTT-Wiring.md)) and a
PTT method. There is **no default callsign**, region, licence class or PTT method, and the gate
refuses to transmit until all are set. It also refuses:

- a callsign z-30 v1 cannot carry exactly (portable `/P`, compound calls, prefixes ZV–ZZ, 3-character prefixes);
- a grid square outside the 63-square v1 table (for CQ and grid replies);
- any emission that would fall outside a permitted data segment for your region and class;
- any frequency the radio contradicts, when rigctld can read it back.

## 5. Transmit — into a dummy load first

Nothing about z-30's transmit path has been tested on a radio. Before the first on-air
transmission: key into a dummy load (Tune), confirm the radio keys and unkeys, confirm the
radio's ALC stays at zero, and have another receiver confirm a clean ~50 Hz-wide signal. The
procedure is [`docs/hardware-validation.md`](../docs/hardware-validation.md). **Enable your
radio's own TX time-out timer** if you key by CAT or CM108: nothing in software can unkey those
after the computer crashes.

## 6. Making a contact

1. Double-click a CQ in the decode list to answer it, or press **Call CQ**.
2. With auto-sequence on, the sequencer advances only on messages addressed exactly to you, from
   the station you are working, of the type the exchange expects.
3. v1 has no roger bit: a report sent in reply to a report *is* the roger, by its place in the
   sequence. The software never shows an `R` it did not send.
4. When the exchange completes, the contact is logged with exactly what was received, sent and
   measured — a field nothing supplied is left empty ([14](14-User-Interface-&-Operation-Reference.md)).

## 7. Coming from the old browser/Python z-30

Run `z30 --migrate` once. It imports your callsign, grid, licence data, rig and PTT settings and
your logbook, and tells you exactly what it did not import and why. The old program is retired;
see [08](08-Web-&-PWA-Architecture.md).
