# Release notes

One file per release tag, named exactly for the tag: `docs/release-notes/v<version>.md`.

`.github/workflows/release.yml` publishes the GitHub release **from this file** (`gh release
create --notes-file`), and the publish job fails if the file is missing or if it does not state
the validation status — it greps for `protocol validated`, `hardware not validated` and `on-air
not validated`. Release notes are therefore reviewed with the code in a pull request, not typed
into a release form at publish time, and a release cannot quietly drop the thing an operator most
needs to know before keying a transmitter.

The tag must be `v` + the version in `[workspace.package]` of the root `Cargo.toml`; the build job
checks that too, so the archive names, `--version` and the tag cannot disagree.

| Tag | Notes |
| :--- | :--- |
| `v0.1.0-experimental` | [v0.1.0-experimental.md](v0.1.0-experimental.md) — the first release |
