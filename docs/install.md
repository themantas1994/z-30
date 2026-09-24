# Installing z-30

z-30 is two native programs built from the Rust workspace in `crates/`:

| Program | What it is |
| :--- | :--- |
| `z30-gui` | The desktop station: waterfall, decodes, QSO sequencing, the transmit gate, logbook. |
| `z30` | The command-line station and toolbox: receive-only live station, decode recordings, encode test WAVs, diagnostics, migration, ADIF import/export, the benchmark suite. **It never transmits.** |

Neither needs Python, Node or a browser, and neither falls back to anything else: if a
program cannot start, it says why and stops.

> **Status.** The protocol and the receiver are validated in software simulation only. No part
> of z-30 has yet been operated with a real radio, sound card or RF path
> ([hardware.md](hardware.md)). Before you transmit, key into a dummy load with a known-good
> receiver watching.

## From a release archive

Each release (GitHub → Releases) has one archive per platform:

| Archive | Platform |
| :--- | :--- |
| `z30-<version>-x86_64-unknown-linux-gnu.tar.gz` | Linux x86-64 (glibc 2.35 or later) |
| `z30-<version>-x86_64-pc-windows-msvc.zip` | Windows 10/11 x86-64 |
| `z30-<version>-aarch64-apple-darwin.tar.gz` | macOS, Apple Silicon |
| `z30-<version>-x86_64-apple-darwin.tar.gz` | macOS, Intel |

Each contains `z30`, `z30-gui`, `README.md`, `LICENSE`, this file as `INSTALL.md`, and
`BUILDINFO.txt`, and nothing else. All are built with CM108 GPIO PTT support. Verify the
download against `SHA256SUMS`, then check what you have:

```bash
sha256sum -c SHA256SUMS --ignore-missing
./z30 --version
```

`--version` prints the version, the exact commit, the build date and compiler, the target
platform and architecture, the build profile and the optional features compiled in. It must
match `BUILDINFO.txt` and the release's commit.

Release binaries are not code-signed. On macOS the first launch needs right-click → Open (or
`xattr -d com.apple.quarantine z30 z30-gui`); on Windows, SmartScreen asks once.

No release has been published at the time of writing; until one is, build from source.

## From source

1. **Rust 1.95 or newer** ([rustup.rs](https://rustup.rs)). 1.95 is the workspace's declared
   minimum: CI builds, lints (`clippy -D warnings`) and tests it; older compilers cannot build
   the GUI.
2. **System libraries** (Linux only):
   ```bash
   # Debian / Ubuntu
   sudo apt-get install libasound2-dev libudev-dev pkg-config \
       libxkbcommon-dev libwayland-dev libx11-dev libxcursor-dev libxrandr-dev libxi-dev libgl1-mesa-dev
   # Arch
   sudo pacman -S alsa-lib systemd-libs pkgconf libxkbcommon wayland libx11 libxcursor libxrandr libxi mesa
   ```
   Windows and macOS need nothing beyond the Rust toolchain (and, on Windows, the MSVC build
   tools rustup offers to install).
3. **Build and install** into `~/.cargo/bin`:
   ```bash
   git clone https://github.com/themantas1994/z-30.git && cd z-30
   cargo install --locked --path crates/z30-cli --features cm108
   cargo install --locked --path crates/z30-gui --features cm108
   z30 --version
   ```
   Leave out `--features cm108` if you do not key with a CM108/CM119 sound-card GPIO; a build
   without it refuses a `cm108` PTT configuration and says so.

## Linux desktop entry

```bash
install -Dm644 packaging/linux/z30-gui.desktop ~/.local/share/applications/z30-gui.desktop
install -Dm644 packaging/linux/z30.svg ~/.local/share/icons/hicolor/scalable/apps/z30.svg
```

Serial PTT needs membership of the port's group (`dialout` on Debian/Ubuntu, `uucp` on Arch);
CM108 PTT needs access to the hidraw device, usually through a udev rule
([troubleshooting.md](troubleshooting.md)).

## First run

```bash
z30 --diagnostics     # configuration, OS clock status, PTT, rigctld, audio devices, transmit-gate verdict
z30 --devices         # audio devices and serial ports
z30-gui               # set callsign, grid, region, licence class, PTT, rig, audio in Settings
```

A new installation has **no callsign, region, licence class or PTT method**, and the transmit
gate refuses to transmit until all of them are set. There is no default callsign.

Keep the computer's clock on UTC with NTP or GPS (`chrony`/`gpsd`): z-30 reads the operating
system clock, never sets it, and the receiver's timing window is ±1.5 s in total
([synchronization.md](synchronization.md)).

## Coming from the old browser/Python z-30

```bash
z30 --migrate
```

reads the old `station_config.json`, `config.json`, `logbook.json` / `logbook.adi` from the same
data directory (`$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30`), never modifies them,
writes `config.toml` (only if none exists, unless `--force`) and imports the logbook into
`logbook.sqlite`. It prints what was imported, what was imported with a change and what was
skipped, and why. Running it again imports nothing twice. It never imports an RF time-sync
offset, self-test state, browser UI settings, or the old auto-logger's default grid and report
([troubleshooting.md](troubleshooting.md#migration)).

The old program itself is retired and is not installed by anything; see
[`legacy/README.md`](../legacy/README.md).
