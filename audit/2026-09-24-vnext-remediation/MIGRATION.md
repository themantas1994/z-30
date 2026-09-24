# Migration

## Repository migration (what moved where)

See [LEGACY_STATUS.md](LEGACY_STATUS.md) for the per-file inventory and
[ARCHITECTURE.md](ARCHITECTURE.md) for the result. In one line: the Rust workspace is the only
application; the Python protocol code is a frozen oracle under `legacy/python-oracle`; the
browser runtime is an unbuilt reference under `legacy/browser-runtime`; the Python application,
the web bundle and the installers are deleted.

## Operator migration: `z30 --migrate`

Implementation: `crates/z30-io/src/migrate.rs`; entry points `z30 --migrate [--force]` and the
GUI's first start (when no `config.toml` exists). Reads, never writes or deletes:
`station_config.json` (web UI), `config.json` (Tk wizard), `logbook.json`, `logbook.adi`, in the
same data directory the legacy app used.

### What is imported

| Legacy field | vNext | Note |
| :--- | :--- | :--- |
| callsign (`myCall` / `callsign`) | `station.callsign` | placeholders `NOCAL`/`N0CALL` skipped; a call v1 cannot carry is imported but reported (transmit refused) |
| grid (`myGrid` / `grid`) | `station.grid` | wizard placeholder `AA00aa` skipped; a square outside the v1 table is imported but reported |
| region, licence class | `station.region`, `station.license_class` | |
| TX power | `station.configured_tx_power_w` | as configuration, never as a measurement |
| dial, TX/RX audio, TX slot, auto-sequence, watchdog cycles, AP enabled | `operating.*`, `receiver.ap_enabled` | |
| rigctld host/port (Hamlib CAT) | `rig.*` | Direct Serial CAT is skipped (vNext uses rigctld) |
| PTT CAT / RTS / DTR / VOX / CM108 | `ptt` | port and polarity carried; other methods skipped |
| audio device names | `audio.input_device` / `output_device` | reported as "check it in Settings" (browser ids are not device names) |
| logbook entries | `logbook.sqlite` | every field `legacy_import`; see below |

### What is never imported

| Legacy data | Why |
| :--- | :--- |
| RF time-sync offset (`appTimeOffsetMs`, `app_time_offset_ms`) and stored sync results | the RF sync could report success on noise (C-03) |
| self-test / synthetic-signal state | synthetic decodes must never become live state (H-03) |
| browser UI settings | no equivalent |
| on auto-logged entries, the grid `FN31` and received report `-16` | exactly the legacy auto-logger's defaults for "nothing received" (C-05); indistinguishable from fabrication, so dropped |

Auto-logged entries' times were local time labelled UTC; that cannot be recovered, and the
imported comment says so. Entries whose date/time cannot be parsed are skipped and listed.

### Idempotence

- The configuration is a pure function of the legacy files; `config.toml` is not overwritten
  without `--force`.
- A contact already in the vNext logbook (same call, start time within 0.5 s, dial within 1 Hz)
  is not imported again; the report counts it as "already present".

### The report

```text
Read: station_config.json, logbook.json
Imported:
  callsign = G4XYZ
  ...
Imported with a change:
  tx power: 50 W kept as CONFIGURED power; it is never shown as measured (audit M13)
  ...
Skipped:
  legacy RF time offset: an RF-time-sync offset is never carried over ...
  synthetic/self-test state: ...
Logbook: 1 imported (fields marked legacy_import), 0 already present, 0 skipped
  dropped: K1ABC 2026-09-24 18:05:27: grid FN31 (the legacy auto-logger's default when no grid was received)
```

### Tests

`crates/z30-io/src/migrate.rs`:
`migrates_the_web_config_and_reports_every_decision`,
`running_the_migration_twice_changes_nothing_the_second_time`,
`the_legacy_auto_loggers_defaults_and_runtime_state_are_not_migrated`.
All pass (see [TEST_RESULTS.md](TEST_RESULTS.md)). **Not tested on a real legacy installation**:
the inputs are the legacy file formats as the legacy code wrote them.
