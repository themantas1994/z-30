#!/usr/bin/env bash
# Conflict C-1 tie-break: does crates/z30-cli/build.rs mark a binary built from a tree with an
# UNSTAGED edit in a dependency crate as "-dirty"? (CTO review said yes; RES-03 said no.)
# Builds a two-crate toy workspace whose binary crate uses the repository's real build.rs,
# then edits the dependency without staging it and rebuilds. Run from the repository root.
set -euo pipefail
REPO=$(pwd)
D=$(mktemp -d)
mkdir -p "$D/crates/app/src" "$D/crates/dsp/src"
cd "$D"
printf '[workspace]\nmembers=["crates/*"]\nresolver="2"\n' > Cargo.toml
printf '[package]\nname="dsp"\nversion="0.1.0"\nedition="2021"\n' > crates/dsp/Cargo.toml
echo 'pub fn answer()->u32{3}' > crates/dsp/src/lib.rs
printf '[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n[dependencies]\ndsp={path="../dsp"}\n' > crates/app/Cargo.toml
cp "$REPO/crates/z30-cli/build.rs" crates/app/build.rs      # the real build script, unchanged
echo 'fn main(){println!("{} answer={}", env!("Z30_BUILD_COMMIT"), dsp::answer());}' > crates/app/src/main.rs
echo target > .gitignore
git init -q && git add -A && git -c user.email=a@b -c user.name=t commit -qm init
export CARGO_TARGET_DIR="$D/target"
for _ in 1 2 3; do cargo +1.95 run -q -p app 2>/dev/null; done
echo "--- unstaged edit in dsp, no git command in between"
echo 'pub fn answer()->u32{4}' > crates/dsp/src/lib.rs
cargo +1.95 run -q -p app 2>/dev/null
cargo +1.95 run -q -p app 2>/dev/null
echo "--- after running git status"
git status --short
cargo +1.95 run -q -p app 2>/dev/null
