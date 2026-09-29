//! Embeds what a release artefact needs to identify itself (`--version`, every benchmark result):
//! the commit it was built from and whether the tree was dirty (with a hash of the difference),
//! the build date, target, profile, compiler, RUSTFLAGS, target features, the `Cargo.lock` hash
//! and the identity of the benchmark instrument. The audit's C6 was a shipped bundle 49 commits
//! stale that nothing noticed; a binary that names its commit can be checked against the commit
//! it claims to be - but only if the label is recomputed whenever the source changes, which
//! `build_support.rs` explains (F-13).
#[path = "build_support.rs"]
mod build_support;

fn main() {
    build_support::emit("z30-cli", true);
}
