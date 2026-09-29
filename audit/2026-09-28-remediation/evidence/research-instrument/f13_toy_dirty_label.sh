#!/usr/bin/env bash
# F-13 (RES-03 / C-1) reproduction and regression, in a toy workspace like the C-1 tie-break
# (audit/2026-09-28-agent-team-review/evidence/c1-buildrs-tiebreak/run.sh).
#
# A two-crate workspace: `app` (a binary that prints its commit label and dsp::answer()) and
# `dsp` (its dependency). It is built three times clean, then `dsp` is edited WITHOUT staging
# and rebuilt, with no git command in between. Run twice: once with the build script z-30 had
# at 78db463 (before the fix), once with the fixed one (crates/z30-cli/build.rs +
# build_support.rs at the checked-out commit). Before the fix the edited binary prints the
# clean label; after it, "-dirty", and the label goes back to clean when the edit is reverted.
#
# Run from the repository root:  bash audit/2026-09-28-remediation/evidence/research-instrument/f13_toy_dirty_label.sh
set -euo pipefail
REPO=$(pwd)
OLD_REV=78db463

toy() {  # $1 = label, $2 = "old" | "new"
  local D
  D=$(mktemp -d)
  mkdir -p "$D/crates/app/src" "$D/crates/dsp/src"
  cd "$D"
  printf '[workspace]\nmembers=["crates/*"]\nresolver="2"\n' > Cargo.toml
  printf '[package]\nname="dsp"\nversion="0.1.0"\nedition="2021"\n' > crates/dsp/Cargo.toml
  echo 'pub fn answer()->u32{3}' > crates/dsp/src/lib.rs
  printf '[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n[dependencies]\ndsp={path="../dsp"}\n' > crates/app/Cargo.toml
  if [ "$2" = old ]; then
    git -C "$REPO" show "$OLD_REV:crates/z30-cli/build.rs" > crates/app/build.rs
  else
    cp "$REPO/crates/z30-cli/build_support.rs" crates/app/build_support.rs
    # The real build.rs, with the package name and instrument flag of this toy.
    sed -e 's/emit("z30-cli", true)/emit("app", false)/' "$REPO/crates/z30-cli/build.rs" > crates/app/build.rs
  fi
  echo 'fn main(){println!("{} answer={}", env!("Z30_BUILD_COMMIT"), dsp::answer());}' > crates/app/src/main.rs
  echo target > .gitignore
  cargo +1.95 generate-lockfile -q
  git init -q && git add -A && git -c user.email=a@b -c user.name=t commit -qm init
  export CARGO_TARGET_DIR="$D/target"
  echo "=== $1"
  for _ in 1 2 3; do cargo +1.95 run -q -p app 2>/dev/null; done
  echo "--- unstaged edit in dsp (answer 3 -> 4), no git command in between"
  echo 'pub fn answer()->u32{4}' > crates/dsp/src/lib.rs
  cargo +1.95 run -q -p app 2>/dev/null
  cargo +1.95 run -q -p app 2>/dev/null
  echo "--- git status says:"
  git status --short
  cargo +1.95 run -q -p app 2>/dev/null
  echo "--- edit reverted"
  echo 'pub fn answer()->u32{3}' > crates/dsp/src/lib.rs
  cargo +1.95 run -q -p app 2>/dev/null
  echo "--- edit committed"
  echo 'pub fn answer()->u32{4}' > crates/dsp/src/lib.rs
  git -c user.email=a@b -c user.name=t commit -qam edit
  cargo +1.95 run -q -p app 2>/dev/null
  cd "$REPO"
  rm -rf "$D"
}

toy "BEFORE the fix: build.rs at $OLD_REV" old
toy "AFTER the fix: build.rs + build_support.rs at $(git rev-parse --short=12 HEAD)" new
