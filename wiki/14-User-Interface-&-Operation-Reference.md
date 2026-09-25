# 14. User Interface & Operation Reference

`z30-gui` is the desktop station (egui, `crates/z30-gui`). It renders the engine's state and
sends it commands; it owns no radio state and runs no DSP. The engine's threads keep receiving,
sequencing and watching PTT whatever the window is doing.

> The GUI has been built and tested for its logic, not operated with a radio or sound card
> (see [01](01-New-User-Guide-&-First-Steps.md)).

## Layout

**Top bar.** Your callsign (or "z-30 (no callsign)"); the UTC time from the operating system;
the slot progress bar (even/odd, seconds into the slot); the dial — "(radio reports it)" when
`rigctld` reports the same dial, "set, radio reports …" when it does not, "(commanded, not read
back)" when the radio acknowledged a set-frequency but cannot be read, "(configured; no radio
confirms it)" otherwise, and "dial not set" when there is none (transmit is then refused); the TX state (RX / TX armed / TX and the message being sent);
buttons for **Settings**, **Logbook** and **Diagnostics**.

**Waterfall.** 0–3 kHz of the received audio. The green box is the receive frequency, the red
box the transmit frequency (each the width of the 16-tone span). Click to set both; shift-click
to set only the transmit frequency.

**Band activity.** One row per decode: UTC (of the slot), SNR in dB (2500 Hz reference), DT in
seconds, tone-0 frequency in Hz, the message, and `a1`…`a6` when a priori information completed
the frame. CQs are green, messages addressed to you red. Double-click a CQ to answer it.

- **SNR** is shown as a number from −22 to +30 dB, the range over which its accuracy has been
  measured; outside it as `<-22` / `>+30`; `--` when there was no signal estimate.
- A field of a received message that is not the valid encoding of anything is shown as
  unrepresentable (`<?…>`), never as a plausible callsign or grid.
- There is **no confidence column**: the decoder has no calibrated per-decode confidence, and
  none is invented. (The retired app showed the constant 99 on every decode.)
- Every row is a reception by this receiver. There is no self-test or synthetic-signal mode.

**QSO panel.** The sequencer state, the next message to be sent, **Call CQ**, **Enable TX**,
**Tune** (one unmodulated carrier at the centre of the tone span, at most one frame long),
**HALT TX** (stops audio and unkeys immediately, and abandons a transmission that was about to
start), **Reset QSO**, and the transmit gate's verdict: "clear", or every reason it would refuse.
Messages from the engine (refusals, faults, rig and audio events, logged contacts) scroll below.

**Status bar.** Audio input running or stopped, input level (dBFS), overruns, the sound card's
clock error as the sample-clock model estimates it ("measuring" until it has enough data), the
last decode time and when it finished relative to the slot, missed slots, the median DT of
recent decodes (a clock-error hint), and the operating system's clock status.

## QSO sequencing

With auto-sequence on, the sequencer advances only on a message addressed **exactly** to your
callsign (not a substring), from the station being worked (or, while calling CQ, from whoever
answers), and of the type the current state expects. Anything else repeats the current message.

```text
A: CQ A GRID       B: A B GRID       A: B A -12
B: A B -08  (a report in reply to a report is the roger, by sequence: v1 has no roger bit)
A: B A RR73        B: A B 73
```

The report is your receiver's measurement of the other station. With no signal estimate, no
report message is sent. After `watchdog_cycles` transmissions without progress (default 6)
transmission stops.

## Settings

| Section | Fields |
| :--- | :--- |
| Station | callsign (checked live: whether v1 can carry it), grid (whether its square is in the v1 table), region, licence class, the TX power you set on the radio (configuration, never shown or logged as a measurement) |
| Operating | dial (Hz, USB), TX audio frequency, TX slot, auto-sequence, auto-log, the no-progress watchdog |
| Audio | input and output device, TX level |
| Rig and PTT | `rigctld` host and port; PTT method (none, VOX, CAT, serial RTS/DTR with polarity, CM108 GPIO and polarity) |
| Receiver | a priori decoding (off by default), drift search range, SIC passes |

**Apply and save** writes `config.toml`. Changing the configuration while transmitting ends the
transmission: the gate approved the old configuration, not the new one.

## Logbook

Completed contacts, with **Export ADIF** (written to the data directory as `export.adi`).
Fields that were not received or measured are empty; the frequency is labelled with where it
came from (reported by the radio, commanded and acknowledged, or configured) or shown as `-`
when unknown; power is labelled as configured. Forward power and SWR are "not measured" — nothing
in z-30 measures them. See [13](13-Operating-Safety-Compliance-&-Security.md#the-logbook-records-only-what-happened).

## Diagnostics

Build (version, commit), configuration path, GUI frame time, the rig tracker's state, audio
health, the transmit gate's verdict, and "Forward power / SWR: not measured".

## What the retired app had that z-30 does not

Band manager presets, auto-reply priority strategies, Cabrillo export, an in-app wiki and
Python source viewer, a rig console, a Hamlib catalogue, RF time sync, a self-test signal
generator, a Monte Carlo benchmark panel and an update button. Several of those displayed
fabricated values and were among the reasons it was retired ([08](08-Web-&-PWA-Architecture.md)).
