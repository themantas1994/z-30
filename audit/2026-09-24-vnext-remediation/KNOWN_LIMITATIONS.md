# Known limitations after the remediation

Everything here is true of the code at the end of this remediation. None of it is hidden
elsewhere; each item is also stated where an operator would look for it.

## Validation

| Limitation | Where stated |
| :--- | :--- |
| **No hardware validation of any kind.** No radio, sound card, audio interface, PTT interface, RF path, GPS/PPS or on-air recording has been used with z-30. Every performance figure is software simulation. | README, wiki 01/06/09/13, docs/hardware.md, docs/hardware-validation.md |
| No on-air interoperability: no other software implements z-30. | README, wiki 11 |
| Windows and macOS are verified only by CI build and test. | wiki 09 |
| The GUI has not been operated on a real display for usability or frame rate. | wiki 14 |
| No release has been published; the release workflow has not run on a tag yet. | docs/install.md, wiki 09 |
| CM108 support on Windows/macOS compiles in CI only if the workflow passes there (not verified locally in this session). | docs/hardware.md |

## Protocol (by design; changing any is a protocol break)

- 63 message bits; no roger bit; 63 grid squares; standard callsigns only (no `/P`, compound,
  3-character prefixes, `ZV`–`ZZ`); reports −30…+30 dB; no free text, contest or telemetry forms.
- Natural-binary symbol mapping; the loss against Gray mapping is not measured (L-05).
- A hard ±1.5 s DT window: everything between two stations' clocks must fit in it.
- No decoding on high-Doppler paths (10 Hz spread exceeds the 3.125 Hz tone spacing).
- No version field on the air.

## Receiver (measured in simulation; figures in BENCHMARK_RESULTS.md)

- Linear drift beyond about ±4 Hz across the 24 s frame degrades decoding quickly.
- Strong impulsive noise degrades decoding (no impulse blanker).
- The SNR estimate is validated from −22 to +30 dB only; outside it a bound is displayed.
- DT and frequency accuracy degrade near threshold (DT sd ≈ 5.5 ms at −22 dB).
- Single-thread K = 50 decode latency exceeds the 2 s target (from `perf_k.txt`; within the 4.5 s
  real-time budget).
- False decodes: none observed in any run, but real non-z-30 audio (speech, music, real FT8/RTTY,
  real QRN) has not been tested — no recordings exist.
- `PassStats::suppression_db` is a receiver-internal metric, not physical suppression.
- Two stations at exactly the same frequency and DT: the weaker is never decoded, with or
  without SIC (0/100 at every power difference in `sic.json`). The boundary between that and
  5 Hz or 0.4 s apart, where SIC recovers it every time, has not been mapped.
- Fading (`fading.json`, simulation): 50% at about −21 dB on ITU-R F.1487 good/moderate/poor, 1.7–2.2 dB
  worse than AWGN; on the slowest channel a frame in a fade is lost whatever the average SNR
  (95% only at −14 dB); nothing decodes on high-latitude moderate (10 Hz Doppler).
- The AP effect has been measured only on the oracle's reference receiver, not through
  `decode_slot`.

## Station software

- Rig control only through an external `rigctld` the operator starts; no direct Hamlib linkage,
  Omni-Rig, Flrig, DX Lab or HRD; no split operation; no mode control (USB assumed; LSB not
  modelled, L-07).
- The rig tuning-resolution probe is not wired in: the readback tolerance is a strict 1 Hz, so a
  radio that quantises the dial may be refused on odd frequencies.
- CAT- and CM108-keyed radios stay keyed after SIGKILL or a power cut to the computer (the
  radio's own TX time-out is the defence; M-08, documented).
- PTT methods not implemented: audio-tone, Raspberry Pi GPIO, TCI, WinKeyer.
- No built-in time source; the OS clock must be kept on UTC by the operator (NTP / GPS).
  Windows/macOS clock status is "not checked".
- No Cabrillo export, band presets, auto-reply strategies or rig console (retired app features).
- No automatic updates, no distribution packages, unsigned binaries.
- The hardware watchdog test R3 cannot be run with a release build (no transmission exceeds 40 s).

## Migration

- Tested on synthetic legacy files in the formats the legacy code wrote, not on a real legacy
  installation.
- Auto-logged legacy entries keep their local-time-labelled-UTC times (unrecoverable), flagged in
  the comment; their FN31/−16 defaults are dropped, which also drops any genuinely received
  FN31/−16 on those entries.

## Retired code still in the repository

- `legacy/browser-runtime` still contains the defective live receiver, legacy SIC, synchronous
  UI decoder, tautological OSD and aliasing resampler (C-01, C-02, H-01, H-05, H-09, M-11). They
  are unreachable from anything built or shipped, and kept only as reference.
- `legacy/python-oracle/z30_dsp/sic_decoder.py` holds the old SIC design (unreachable).
