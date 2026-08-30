# 15. Command-Line Tools & Configuration

Everything the `z30_dsp` package exposes from a terminal, plus where z-30 keeps its files and
which environment variables change its behaviour.

---

## 🖥️ The `z30` command

Installing the wheel (or any of the platform installers in
[09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md)) puts a single
`z30` entry point on the path. Every subcommand is also reachable as a module, which is what to
use from a source checkout without installing:

```bash
# Launch the default web DSP transceiver application window
z30
# or: python3 -m z30_dsp.main

# Monte Carlo channel simulation and decode-threshold benchmark
z30 --benchmark
# or: python3 -m z30_dsp.benchmark

# Terminal station configuration wizard
z30 --wizard
# or: python3 -m z30_dsp.config_wizard

# RF standard station time sync scanner (WWV, CHU, DCF77, MSF, WWVB, JJY)
z30 --sync
# or: python3 -m z30_dsp.rf_time_sync

# CLI band preset manager
z30 --bands
# or: python3 -m z30_dsp.band_manager

# Native zero-dependency Tkinter desktop GUI
z30 --tkinter
# or: python3 -m z30_dsp.gui_tkinter

# Check for updates and sync from GitHub
z30 --update
# or: python3 -m z30_dsp.updater
# Non-interactive auto-pull:
z30 --update -y
```

`pyproject.toml` also installs direct aliases for the same entry points, which are handy in
`.desktop` files and systemd units: `z30-transceiver`, `z30-web`, `z30-gui`, `z30-wizard`,
`z30-sync`, `z30-bands`.

---

## 📂 Where z-30 keeps your files

Resolved by `z30_dsp/paths.py`, in this order:

1. `$Z30_HOME`, if set — an explicit override, mainly for tests and packaging.
2. `$XDG_CONFIG_HOME/z30`, if `XDG_CONFIG_HOME` is set (Linux/BSD desktop convention).
3. `~/.z30` — the historical location, and the fallback everywhere else.

| File | Contents |
| :--- | :--- |
| `config.json` | Station configuration, clock calibration (`app_time_offset_ms`), CAT and PTT settings |
| `logbook.json` | The authoritative QSO log; the browser copy is only a cache |
| `logbook.adi` | ADIF 3.1.4 export written alongside the JSON log |
| `web_dist/` | An optional pre-built copy of the web GUI, searched before the packaged one |

A per-machine `config.json` is deliberately never repository-relative: an earlier version
defaulted to the bare string `"config.json"`, so the file landed wherever the app happened to
be launched from and a personal calibration file could be committed by accident.

---

## 🌱 Environment variables

| Variable | Effect |
| :--- | :--- |
| `Z30_HOME` | Overrides the per-user data directory entirely |
| `XDG_CONFIG_HOME` | Used as `$XDG_CONFIG_HOME/z30` when `Z30_HOME` is unset |
| `Z30_ALLOW_SET_SYSTEM_CLOCK=1` | Permits the opt-in, bounded, confirmed system-clock step described in [13. Operating Safety](13-Operating-Safety-Compliance-&-Security.md) |
| `DISABLE_HMR=true` | Turns off Vite HMR and file watching in development (used by automated tooling) |
| `APP_URL` | Public URL when the web UI is hosted somewhere other than the local `127.0.0.1` server; used for self-referential links only |

`.env.example` in the repository root documents anything else the build honours. Never commit a
real `.env`; `.gitignore` excludes it.

---

## 🌐 The local web server

`z30_dsp/web_server.py` serves the built web GUI and the hardware API that the browser cannot
reach on its own — serial CAT, CM108 HID, GPIO PTT and the `rigctld` relay.

- It binds `127.0.0.1` only, and every `/api/` request must carry the per-start bearer token
  plus a matching `Origin` and `Host`. Loopback is not an authentication boundary; see
  [13. Operating Safety, Compliance & Local Security](13-Operating-Safety-Compliance-&-Security.md).
- It locates the web bundle in order: `dist/` (in the working directory, then next to the
  package), the packaged `z30_dsp/web_dist/`, then `~/.z30/web_dist/` and `~/.z30/dist/`. So a
  stale `web_dist` snapshot never wins over a bundle you just built. Serving is read-only and
  never triggers a build; pass `--rebuild` to run `npm run build` in the foreground first.
- The GPIO PTT line is held by a dead-man switch: the browser re-asserts it about every 500 ms
  and the pin drops within roughly two seconds of silence.

---

## 🔄 Updating

`z30 --update` wraps the git/pip update paths for each platform. Channel-by-channel
instructions — including the PWA and Termux — are in
[12. Software Updates & GitHub Sync](12-Software-Updates-&-GitHub-Sync.md).
