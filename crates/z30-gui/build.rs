//! Embeds what a release artefact needs to identify itself (`--version`, the About panel): the
//! commit it was built from (and whether the tree was dirty), the build date, the target triple
//! and the profile. The rules, and why the label is recomputed whenever any crate the binary is
//! built from changes (F-13), are in `../z30-cli/build_support.rs`, which both binaries share.
#[path = "../z30-cli/build_support.rs"]
mod build_support;

fn main() {
    build_support::emit("z30-gui", false);
}
