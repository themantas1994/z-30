# 09. Cross-Platform Build & Packaging

z-30 is two native programs, `z30` and `z30-gui`, built from the Rust workspace. The install
procedure is [`docs/install.md`](../docs/install.md); this page states what each platform's
support actually rests on.

## Platform status

| Platform | Evidence | Status |
| :--- | :--- | :--- |
| Linux x86-64 (Debian/Ubuntu, Arch) | CI builds and runs the full test suite on `ubuntu-latest`, on stable and on the declared minimum Rust (1.95); release archive built on Ubuntu 22.04 | **Builds and passes tests in CI. Not operated with a sound card or radio.** |
| Windows 10/11 x86-64 | CI builds and tests on `windows-latest`; release archive | **Builds and passes tests in CI. Not operated with a sound card or radio.** |
| macOS (Apple Silicon, Intel) | CI builds and tests on `macos-latest`; release archives built on `macos-15` (arm64) and `macos-15-intel` (x86-64) | **Builds and passes tests in CI. Not operated with a sound card or radio.** |
| Wayland / X11 / PipeWire / ALSA / PulseAudio | egui/winit support both display servers; cpal uses ALSA (PipeWire and PulseAudio through their ALSA plugins) | **Not tested** |
| Raspberry Pi / ARM Linux | nothing | **Not tested.** A source build may work on 64-bit Raspberry Pi OS; nobody has tried |
| Android | nothing | **Not supported.** |

## Release archives

`.github/workflows/release.yml` builds, from a `v*` tag, one archive per platform
(x86-64 Linux, x86-64 Windows, Apple Silicon and Intel macOS). Each is tested on its platform
before packaging, built with `SOURCE_DATE_EPOCH` set to the commit time and with CM108 PTT, and
contains exactly `z30`, `z30-gui`, `README.md`, `LICENSE`, `INSTALL.md` and `BUILDINFO.txt` —
plus, on Linux, `z30-gui.desktop` and `z30.svg`, because someone who downloaded an archive has no
`packaging/linux/` to install them from.

The workflow fails if anything else is in the archive, if `--version` does not name the tagged
commit, if the tree was dirty, if the tag is not `v` + the version in `[workspace.package]`, if
the retired `W1AW` default callsign is in either **packaged** binary, if the packaged `z30` cannot
decode its own frame through `--loopback-test` on that platform, or — in the publish job — if
`docs/release-notes/<tag>.md` is missing or does not state the validation status (protocol
validated, hardware not validated, on-air not validated). Releases are marked pre-release.

The same build and packaging jobs also run on `workflow_dispatch` and on a pull request that
touches the release path (`release.yml`, `Cargo.toml`, `Cargo.lock`, `packaging/**`,
`docs/install.md`, `docs/release-notes/**`). That is a **dry run**: it produces the archives as
workflow artefacts, and the publish job is skipped because it is gated on a `v*` tag. It exists so
the release path can be exercised without the one irreversible step — pushing the tag.

Binaries are not code-signed or notarised.

## What is not provided

- No distribution packages (`.deb`, AUR, Homebrew, MSI) and no Python component.
- No automatic updates ([12](12-Software-Updates-&-GitHub-Sync.md)).

## Building

```bash
cargo build --release --locked -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
./target/release/z30 --version
```

Rust 1.95 or newer; on Linux the ALSA, udev and X11/Wayland development packages listed in
`docs/install.md`. `--version` names the commit, build date, compiler, target, architecture,
profile and whether CM108 support is compiled in.
