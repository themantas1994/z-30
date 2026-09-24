# 06. Transceiver CAT Control & PTT Wiring

> **Hardware status: nothing on this page has been tested with a real radio.** Every mechanism
> below is implemented and tested against simulated or scripted hardware only
> ([`docs/hardware.md`](../docs/hardware.md)). No radio model is "supported" in the sense of
> "known to work". Validate your own station with
> [`docs/hardware-validation.md`](../docs/hardware-validation.md), into a dummy load, before
> transmitting on the air.

z-30 controls the radio through **Hamlib's `rigctld`** and keys it by **CAT, a serial RTS/DTR
line, a CM108/CM119 GPIO, or VOX**. That is all. Split operation, direct (non-Hamlib) CAT,
Omni-Rig/Flrig/DX Lab/HRD, TCI, WinKeyer, Raspberry Pi GPIO and right-channel-tone PTT are not
implemented. The retired browser app listed "9 PTT methods" and "139 STABLE rigs"; none of those
was ever tested either, and neither claim carried over.

## Rig control: `rigctld`

Start `rigctld` for your radio yourself (z-30 does not launch it), then set its host and port in
Settings (`[rig]` in `config.toml`):

```bash
rigctld -m <hamlib model number> -r /dev/ttyUSB0 -s <baud>      # Linux
rigctld -m <hamlib model number> -r COM4 -s <baud>              # Windows
rigctl -l | grep -i <your radio>                                # find the model number
```

z-30 sends only `f` (read dial), `t` (read PTT), `m` (read mode), `F <hz>` (set dial) and, for
CAT PTT, `T 1` / `T 0`. Every command times out after 1.5 s; any reply other than `RPRT 0` is a
failure, never a success. It does not set the mode: **put the radio in USB (or its USB data
mode) yourself**. The emission is computed as dial + audio offset, i.e. USB; in LSB the transmit
gate would be checking the wrong frequency, so when `rigctld` reports a mode other than `USB` or
`PKTUSB` in a fresh reading, the gate refuses (`RigModeNotUsb`). Without rig control the mode
cannot be read and is not checked.

With no `rigctld` configured, the dial is whatever you entered and is shown as *configured; no
radio confirms it*; contacts log it as `configured`. With no dial entered at all, transmit is
refused and contacts log no frequency.

## Reading the rig back

The model is WSJT-X's (`PollingTransceiver`/`TransceiverBase`), ported to
`crates/z30-engine/src/rig.rs`: the dial the software set (and, with rig control, sent to the
radio) and the dial the radio reports are two different things, and only the reading is
knowledge. A dial change is sent to the radio with rigctld's set-frequency; only the radio's
acknowledgement of that command lets a contact log the dial as "commanded", and a fresh
reading logs it as "reported by the radio".

- The dial is polled once a second, never within 100 ms of a PTT change (some rigs cannot
  process CAT while switching).
- **A settled disagreement refuses transmission** (`RigDialDisagrees`): if three consecutive
  polls (`POLLS_TO_STABILIZE`) after a QSY still report a different dial, the band-plan check
  would be about a frequency the transmitter is not on.
- **No readback is "unverified", not "wrong".** A VOX station with no CAT link transmits under
  the other checks; the gate refuses only on positive evidence.
- **An unsettled QSY is not a disagreement**, and losing contact with the rig returns it to
  "unverified" rather than blocking it.

**Known limitation:** the tuning-resolution rules (a rig that truncates to 10/20/100 Hz is not
"wrong" by the remainder) are implemented, but the probe that *measures* a rig's resolution is
not wired into vNext yet, so the tolerance is a strict 1 Hz. A radio that quantises the dial may
therefore be refused on an odd frequency; choose a dial that is a multiple of its tuning step.

## PTT methods

| `ptt` | Keys with | Confirms keying? | Released if z-30 is killed (SIGKILL) or the computer loses power? |
| :--- | :--- | :--- | :--- |
| `none` (default) | nothing | — | — transmission is refused (`PttNotConfigured`) |
| `cat` | `rigctld` `T 1` / `T 0` on its own connection | yes: `RPRT 0` from rigctld | **no** — the radio stays keyed until its own time-out timer |
| `serial` | RTS or DTR, either polarity | yes: the OS accepted the line change | yes — the OS drops RTS/DTR when the port closes |
| `cm108` | CM108/CM119 GPIO 1–8 over USB HID (build feature, included in releases) | yes: the HID write succeeded | **no** — the GPIO holds its state |
| `vox` | the transmit audio itself | **no**, and says so | yes — the audio stops |

"Confirms" means the hardware or daemon accepted the command, not that the radio is
transmitting. **If you key by CAT or CM108, enable the radio's transmit time-out timer**: z-30's
watchdog (40 s, independent thread), panic hook and signal handlers release PTT on a crash,
hang or normal exit, but nothing in software can after SIGKILL or a power cut. WSJT-X has the
same limitation.

A serial PTT port is opened once and held for the whole session, so opening it cannot itself
key a radio, and the OS releases it when the process ends. On Linux you need to be in the port's
group (`dialout` / `uucp`); CM108 needs access to the hidraw node (a udev rule; see
[`docs/troubleshooting.md`](../docs/troubleshooting.md)).

## The transmit gate

Every transmission — sequencer, manual and tune — passes one check first, and it fails closed:
callsign (set, not the placeholder, one v1 carries exactly), region and licence class, the
radiated emission inside a permitted data segment at its measured −40 dB width, the radio not
contradicting the dial, the whole frame reading back as the exact message, a PTT method
configured and the transmit hardware open. See [13](13-Operating-Safety-Compliance-&-Security.md).

## Wiring notes that do not depend on software

- Keep audio levels low enough that the radio's ALC never moves: ALC action distorts a
  constant-envelope signal and widens it.
- USB audio codecs built into modern radios need the radio's own "USB audio" input selected for
  data modes.
- Serial RTS/DTR PTT needs an interface with a transistor or optocoupler on that line; a bare
  USB-serial adapter does not key a radio by itself.
