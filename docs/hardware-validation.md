# Hardware validation

**Status: none of the tests on this page has been performed.** No radio, audio interface, PTT
interface, RF path or on-air recording has been used with z-30 (vNext or legacy). Everything the
rest of the documentation calls "measured" was measured in software simulation. This page is
the procedure for changing that, so that the results are repeatable and comparable, and so that
a pass is recorded with the same provenance a simulation result carries.

Rules:

- **A test that was not run is `NOT PERFORMED`**, never inferred from a neighbouring test, from a
  simulation or from another program's behaviour on the same radio.
- **Record every run, pass or fail**, under `hardware-validation/results/<YYYY-MM-DD>-<station>/`
  with the record fields below. A failure is information; deleting it is falsifying the record.
- **Name the exact equipment**: radio model and firmware, interface, cable, sound card, OS,
  `z30 --version` output.
- **Dummy load for every keyed test** until R1–R6 pass on that radio.

## Record fields (every test)

```json
{
  "test": "A1 | A2 | R1 ... | O1",
  "date_utc": "2026-10-01T12:00:00Z",
  "operator": "callsign of the person who ran it",
  "binary": "full `z30 --version` output",
  "os": "e.g. Debian 13, kernel 6.12, PipeWire 1.2",
  "radio": "model, firmware (or none)",
  "interface": "e.g. SignaLink USB, Digirig Mobile, rig's internal USB codec",
  "ptt": "cat | serial rts/dtr | cm108 | vox",
  "load": "dummy load model / antenna (never antenna before R1-R6 pass)",
  "procedure_deviations": "anything done differently from this page",
  "result": "PASS | FAIL | INCONCLUSIVE",
  "measurements": { },
  "evidence": ["files in this directory: JSON from z30, WAV captures, photos of meters, logs"]
}
```

## A — audio path, no radio

| ID | Test | How | Pass criterion |
| :--- | :--- | :--- | :--- |
| A1 | Loopback decode, timing, frequency, bandwidth | Cable from the output to the input of the same (or a second) sound card, **no transmitter in the path**. `z30 --loopback-test --confirm-no-transmitter --out a1.json`, 10 runs | decoded, nothing else decoded; `\|dt_minus_prediction_ms\|` ≤ 50; `\|freq_error_hz\|` ≤ 1.0; 99% BW ≤ 55 Hz, −40 dB BW ≤ 80 Hz (Welch, 8192 points at 6 kHz); no clipping |
| A2 | Sample-clock behaviour over hours | Loopback as A1, repeated every 10 min for 4 h (script around `--loopback-test`); record `sample_clock_ppm` and DT | DT drift < 10 ms over 4 h; ppm estimate stable within ±5 ppm |
| A3 | Device rates | A1 at 44.1 kHz and 48 kHz input and output (set in the OS mixer) | as A1 |
| A4 | Device loss | During a `z30 --receive` run, unplug the USB audio device for 10 s and replug | the missed slots are reported (`slot N missed: BeforeEpoch`), reception resumes, no crash |

`--loopback-test` plays audio only; it keys nothing. It still refuses to run without
`--confirm-no-transmitter`, because a radio on VOX connected to that output would transmit.

## R — radio into a dummy load

Set up rigctld for the radio (`rigctld -m <model> -r <port> -s <baud>`), configure z-30 with the
radio's real licence data, and connect a dummy load rated for the radio's full power with a
power meter in line.

| ID | Test | How | Pass criterion |
| :--- | :--- | :--- | :--- |
| R1 | CAT frequency and readback | Set a dial in `z30-gui`; read the radio's display; turn the VFO by hand 1 kHz | display matches; the GUI shows the radio's reported dial; after the hand QSY the gate refuses with `RigDialDisagrees` within 3 polls |
| R2 | PTT keys and releases, per method | For each configured method (CAT, RTS, DTR, CM108, VOX): Tune from the GUI | power meter shows RF only while the GUI shows TX; RF stops within 200 ms of the end of the tune |
| R3 | Watchdog | Needs a transmission longer than `MAX_TX_SECONDS` = 40 s, which no release build can make (a frame and a tune are 24 s). Until a dedicated test build exists this is covered only by `safety.rs` p4/p4b/p4c with a simulated line: **not testable on hardware yet** | PTT released at 40 s by the watchdog, independent of the GUI |
| R4 | TX inhibit | Clear the licence class; try to transmit | refused before keying; no RF |
| R5 | Unexpected disconnect | Unplug the CAT/PTT USB cable mid-transmission | record what the radio does; z-30 reports a fault and stops; note whether the radio stays keyed |
| R6 | Kill during TX | `kill -9` the GUI mid-transmission, per PTT method | record the outcome. Expected from the design ([hardware.md](hardware.md)): serial RTS/DTR released by the OS; VOX stops with the audio; **CAT and CM108 stay keyed until the radio's own time-out timer** — which must therefore be enabled |
| R7 | Transmitted spectrum | Record the radio's output through an attenuator with an SDR, or monitor with a second receiver | 99% BW ≤ 55 Hz, no spurious products above −40 dBc beyond ±100 Hz; ALC not driven (set drive so ALC stays at zero) |

## O — over the air

Only after A1–A4 and R1–R7 pass on that radio.

| ID | Test | How | Pass criterion / what to report |
| :--- | :--- | :--- | :--- |
| O1 | Two-station decode over a real path | Station B receives with `z30 --receive --capture-slots slots/`; station A transmits a known sequence | decode rate and false decodes over ≥ 200 slots; DT distribution; SNR reports against the other station's |
| O2 | Received-SNR agreement | Both stations report each other | report pairs; no claim of accuracy without a reference receiver |
| O3 | Recording corpus | Keep every captured slot (WAV + JSON) | becomes the real-audio false-decode and regression corpus the audit asked for |

## What a pass allows the documentation to say

A pass of a test on a named radio and interface lets the documentation say exactly that: "A1–R7
passed with <radio> via <interface>, <date>, record <path>". It does not extend to other radios,
interfaces or operating systems. Until then the only permitted statement is the one at the top
of this page.
