# Retired browser runtime — frozen reference, do not operate

> **Do not use this to operate a station.** It is the browser/PWA transceiver z-30 used to
> install by default. The 2026-09-23 and 2026-09-24 audits found that it does not decode live
> audio (its decode fired before its audio window existed, and its candidate detector found
> 0 of 40 frames at −22 dB and at −18 dB), that its "SIC" duplicated decodes instead of
> removing stations, and that it fabricated time-sync results, logbook fields and rig state.
> The z-30 application is the Rust workspace in [`crates/`](../../crates).

## Status

- **Not built, served, installed or packaged.** `package.json` has no `dev`, `build` or
  `preview` script, the Python server that served it is deleted, and no workflow builds it.
- **Not maintained.** It is kept at its last state plus the changes listed below.
- **Tested only as a reference**: `npm run lint` (typecheck) and `npm run test:ts`
  (codec vectors, the transmit-gate regression tests it was the source of, determinism).

## Why it is kept

1. `src/dsp/z30Codec.ts` is the reference for whole-message packing:
   [`reference/golden/generate_messages.mts`](../../reference/golden/generate_messages.mts)
   reproduces `fixtures/golden/messages.json` from it, including which messages it packs
   lossily (`round_trips: false`) — exactly the messages vNext refuses.
2. The audit probes in [`audit/2026-09-23-vnext/probes/`](../../audit/2026-09-23-vnext/probes)
   reproduce the defects that retired it.

## Changes made after retirement (2026-09-24)

So that nobody who does run it is given fabricated data:

| Finding | Change |
| :--- | :--- |
| C-03 RF time sync reported success from noise and persisted offsets | `RfTimeSyncEngine.demodulateTimeSignal` and `NetworkTimeSync` always fail and store nothing |
| C-05 auto-logger wrote local time as UTC, FN31/−16 defaults, distance from EM00 | UTC time; absent grid/report stay empty; distance only from two known grids |
| C-06 the gate checked only the station's own callsign | `canTransmit` refuses any message that does not unpack to exactly the requested text |
| M-03 `confidence: 99` on every decode | field removed; decodes carry `source` instead |
| H-03 self-test decodes looked like receptions; "SIC collision" preset never collided | self-test decodes are prefixed `SYNTHETIC TEST:`; the collision preset is removed |
| M-01 rig console answered `VFOA` / "Icom READY" without asking the radio | answers `RPRT -11` (not available) |
| M-02 Hamlib catalogue marked all 139 rigs `STABLE` and dated itself today | every entry `UNTESTED`; unverified metadata removed |
| M-12 configured power shown as forward power | labelled "set (not measured)" |
| M-04 GitHub update check and Google Fonts on every launch | removed |
| C-02 Specs panel presented −22.9 dB as this receiver's sensitivity | states it is not this receiver's |

Not fixed, because they are the reasons it was retired rather than bugs to repair: the live
decode scheduling (C-01), the energy candidate detector (C-02), the non-cancelling SIC (H-01),
the synchronous UI-thread decoder (H-05), the tautological OSD check (H-09), the aliasing
resampler (M-11).

## Running its reference tests

```bash
cd legacy/browser-runtime
npm ci
npm run lint
npm run test:ts
```
