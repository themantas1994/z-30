//! Embeds the wheel's own provenance: the commit it was built from (`<commit>-dirty` for an
//! uncommitted tree, recomputed whenever a crate it is built from changes), rustc, profile,
//! target, RUSTFLAGS and the `Cargo.lock` hash. The paired harness records these next to the
//! checkout it runs from: its result files named the checkout twice and the wheel never, so a
//! stale or dirty wheel could produce a result labelled with the checkout's commit (2026-09-28
//! audit F-34 / QA-01). Rules shared with both binaries, in `../z30-cli/build_support.rs`.
#[path = "../z30-cli/build_support.rs"]
mod build_support;

fn main() {
    build_support::emit("z30-py", false);
}
