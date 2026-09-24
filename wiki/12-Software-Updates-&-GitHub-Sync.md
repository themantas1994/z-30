# 12. Software Updates & Releases

> The in-app updater and `z30 --update` (which fast-forwarded a git checkout of the retired
> browser/Python runtime) are gone with that runtime. This page kept its old file name so links
> still work.

## How to update

- **Release archives:** download the new archive for your platform, verify it against
  `SHA256SUMS`, replace the two binaries. `z30 --version` confirms the commit and build.
- **From source:**
  ```bash
  git pull
  cargo install --locked --path crates/z30-cli --features cm108
  cargo install --locked --path crates/z30-gui --features cm108
  ```

Your configuration (`config.toml`) and logbook (`logbook.sqlite`) live in the data directory
(`$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30`) and are not touched by an update.

## No automatic update check

z-30 makes no network request at startup and does not check for updates. The retired app ran a
GitHub update check 2.5 s after every launch with no opt-out, and loaded Google Fonts on every
launch (audit M-04); neither exists any more. The only network connection z-30 makes is to the
`rigctld` you configure.

## Knowing what you run

```text
$ z30 --version
z30 0.9.0 (z-30 vNext, Rust)
commit:       <12-character commit>
built:        <UTC date> with <rustc version>
target:       x86_64-unknown-linux-gnu
architecture: x86_64 (linux)
profile:      release
features:     cm108 (CM108/CM119 GPIO PTT)
protocol:     v1
runtime:      native; no Python, Node or browser component
```

A binary built from uncommitted changes says `-dirty` after the commit. Benchmark results
record the same fields, so a published figure can be tied to the exact binary that produced it.
