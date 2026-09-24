# 08. The retired browser runtime (formerly "Web & PWA Architecture")

> **Retired.** z-30 used to install a browser/PWA transceiver (React + TypeScript) served by a
> local Python web server. It is no longer installed, built, served or maintained. The z-30
> application is the native Rust program described everywhere else in this wiki.

## Why it was retired

The 2026-09-23 and 2026-09-24 audits measured it and found that the installed receiver did not
work as a weak-signal receiver:

| Finding | What happened |
| :--- | :--- |
| C-01 | The live decode fired at slot + 24.0 s for an audio window that ends at + 25.5 s, found no audio, and never retried |
| C-02 | Its energy-based candidate detector found **0 of 40** frames at −22 dB and at −18 dB; the published sensitivity came from a different (reference) receiver |
| H-01 | Its "SIC" subtracted a replica with no carrier-phase estimate, added power on average, and produced duplicate decodes |
| C-03 | RF time sync reported success from noise and persisted the offset |
| C-04 | The bundle a wheel install served was 63 commits stale and defaulted to the real callsign W1AW |
| C-05 | The auto-logger wrote local time as UTC and invented grids and reports |
| C-06 | The packer transmitted a different grid (FN42 as RE78) or partner callsign (ZY2ABC as 24BWE) than the one typed |
| H-05 | Decoding ran synchronously on the UI thread |

Its local HTTP API (bearer token, Origin and Host checks) was sound as far as the audit tested
it; that server is deleted along with the rest of the Python application.

## Where it is now

`legacy/browser-runtime/` holds a frozen snapshot, kept only because its TypeScript codec is the
reference for whole-message packing (`fixtures/golden/messages.json`) and so the audits'
probes can reproduce their findings. It has no build script. After retirement its fabricated
outputs were neutralised (time sync always fails, the logger writes UTC and nothing invented,
the gate refuses messages that do not round-trip, synthetic self-test decodes are labelled);
the receiver defects that retired it were deliberately not repaired. Details:
[`legacy/browser-runtime/README.md`](../legacy/browser-runtime/README.md).

The committed `web_dist/` bundle, the Python server, the Tk tools and the installers are
deleted; they can be recovered from commit `224b2fc` for historical comparison only.
