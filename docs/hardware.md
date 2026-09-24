# Hardware

`crates/z30-io`: `rigctld.rs`, `serial_ptt.rs`, `cm108.rs`, and `open_ptt` in `lib.rs`. The
rules each adapter must obey are in `z30_engine::ptt` and `z30_engine::rig`; this page says what
each piece of hardware can and cannot guarantee. **None of the adapters has been exercised
against a physical radio in this repository's CI.** See "Verification status" at the end.

## Rig control: Hamlib `rigctld`

z-30 talks to the radio through `rigctld` over TCP (`[rig] rigctld_host`, usually
`127.0.0.1`; port 4532 by default). An empty host means no rig control, and then the dial is
unverified rather than assumed. It uses
Hamlib's own rig model and serial settings rather than reimplementing CAT.

- **Readback** (`RigControl::read`): `f` (dial), `t` (PTT state), `m` (mode). The rig thread
  polls every second, and not during the 100 ms PTT settle window. The readings feed
  `RigStateTracker`, a port of WSJT-X's polling model: three polls to stabilise after a QSY,
  and the rig's measured tuning resolution. See [safety.md](safety.md) for how a settled
  disagreement refuses transmission.
- **QSY** (`F <hz>`).
- **CAT PTT** (`T 1` / `T 0`) runs on a **separate connection** from the poller. An unkey
  queued behind a slow read is a transmitter still radiating (AGENTS.md section 4).
- Every socket operation has a 1.5 s timeout, and a reply other than `RPRT 0` is a failure,
  never a success. Any error drops the connection, and the next command reconnects.

## PTT methods

| `ptt` | Keys with | Confirms keying? | Released if the process dies? |
| :--- | :--- | :--- | :--- |
| `none` (default) | nothing | — | — (transmit is refused: `PttNotConfigured`) |
| `cat` | rigctld `T 1`/`T 0` | yes: `RPRT 0` | **no**: the radio stays keyed until its own time-out |
| `serial` | RTS or DTR, either polarity | yes: the OS accepted the line change | **yes**: the OS drops RTS/DTR when the port closes, even after SIGKILL |
| `cm108` | CM108/CM119 GPIO 1–8 over HID | yes: the HID write succeeded | **no**: a CM108 GPIO holds its state |
| `vox` | the transmit audio itself | **no**: says so (`PttAck::Unverifiable`) | yes: the audio stops |

What "confirms" means: the hardware or daemon accepted the command. It does not mean the
radio is transmitting. Only the rig's own PTT readback (`t`, where the radio supports it) says
that.

**CM108 and CAT stations should enable the radio's own transmit time-out timer.** The software
layers in [safety.md](safety.md) cover a hung engine, a lost unkey, a panic and a normal exit.
Nothing in software can release a CM108 GPIO or a CAT-keyed radio after SIGKILL or a power cut
to the computer.

**CM108 is a build feature.** `hidapi` is compiled in only with `--features cm108`
(`cargo build --release -p z30-gui --features cm108`). A build without it refuses a `cm108`
configuration with a message saying so; it never falls back to something else. The release
archives and the CI release builds **include** it, and `--version` says whether a binary does
(`features: cm108`).

## Migrated PTT methods

`z30 --migrate` carries over `CAT`, `RTS`, `DTR`, `VOX` and `CM108_GPIO` from the legacy
configuration. For CM108 it takes the configured pin and the first C-Media device found.

The retired legacy app also offered **`AUDIO_TONE_RIGHT`, `RASPBERRY_PI_GPIO`, `TCI_NETWORK`
and `WINKEYER`**. z-30 does not implement these. Migration reports each as not migrated, with
the reason, and the gate refuses to transmit until a supported method is configured. It never
guesses a substitute. None of the four was ever tested on hardware in the legacy app either.

## Serial ports and devices

`z30 --devices` lists audio devices and serial ports. The serial PTT port is opened once and
held for the life of the station. That is what makes the OS release RTS/DTR when the process
goes away, and it avoids a reopen racing a key.

On Linux the user needs access to the port (usually the `dialout` or `uucp` group). For CM108
they need access to the hidraw node, usually through a udev rule. See
[troubleshooting.md](troubleshooting.md).

## Verification status

**Real-radio validation: not yet performed.** No radio model, interface or PTT method below has
been operated with z-30. "Supported" in this repository means "implemented and tested against
simulated or scripted hardware", never "tested with a radio". The framework for doing it is in
[hardware-validation.md](hardware-validation.md).

| Item | Verified how | On hardware |
| :--- | :--- | :--- |
| rigctld protocol, refusal handling, separate PTT connection | unit test against a scripted TCP server | not yet |
| Readback rules (settle, resolution, unverified vs wrong) | `crates/z30-engine/tests/safety.rs` r1–r6 | not yet |
| Serial RTS/DTR | builds on three OSes | not yet |
| CM108 HID report layout | Direwolf's documented layout | not yet |
| Watchdog unkeys at `MAX_TX_SECONDS` | `p4`, `p4b`, `p4c` with a fake line | not yet |
| Audio timing (DT ≈ 0 at a remote station) | virtual clock only | not yet |

Before operating on the air, the closing check of any installation is to key into a dummy load
with a known-good receiver watching, and confirm DT ≈ 0 and a clean spectrum.
