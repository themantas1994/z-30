#!/usr/bin/env bash
# F-13 / F-14 / F-53 check on a scratch clone of the real repository (never the working tree,
# never research/results/ of the checkout).
#
# 1. Build z30 at the checked-out commit: the label is clean.
# 2. Plant an unstaged comment in crates/z30-dsp/src/slot.rs of the CLONE and rebuild: the
#    label must become <commit>-dirty with a diff hash; a default suite run must go to
#    research/results/unpublished/, and --out research/results/<commit> must be refused.
# 3. Revert: the label is clean again.
# 4. Identity smoke: build 78db463 (before the remediation) and run the whole suite at 3
#    frames per point with both binaries; compare_results.py must find every benchmark
#    IDENTICAL (the false.json relabel appears only as a note): the remediation changed what
#    is recorded, not what is measured. 3 frames is exploratory by construction.
#
# Run from the repository root:  bash audit/2026-09-28-remediation/evidence/research-instrument/f13_f14_real_repo.sh
set -euo pipefail
REPO=$(pwd)
HEAD_REV=$(git rev-parse HEAD)
OLD_REV=78db463
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT
git clone -q "$REPO" "$D/src"
cd "$D/src"
git checkout -q "$HEAD_REV"
export CARGO_TARGET_DIR="$D/target-new"
build() { cargo +1.95 build -q --release --locked -p z30-cli -j 3 2>/dev/null; }
Z="$CARGO_TARGET_DIR/release/z30"

echo "=== 1. clean build at $(git rev-parse --short=12 HEAD)"
build
"$Z" --version | grep -E '^(commit|dirty diff):'

echo "=== 2. unstaged comment planted in crates/z30-dsp/src/slot.rs (scratch clone only)"
echo '// planted by f13_f14_real_repo.sh' >> crates/z30-dsp/src/slot.rs
git status --short
build
"$Z" --version | grep -E '^(commit|dirty diff):'
echo "--- default destination of a dirty run (awgn, 1 frame per point):"
"$Z" --benchmark awgn --frames 1 2>&1 | grep -E '^(->|WARNING|==)'
python3 -c "import json,glob; f=glob.glob('research/results/unpublished/*/awgn.json')[0]; d=json.load(open(f)); print(f, '| status', d['status'], '|', d['status_reasons'])"
COMMIT=$(git rev-parse --short=12 HEAD)
echo "--- --out research/results/$COMMIT with the dirty binary:"
"$Z" --benchmark awgn --frames 200 --out "research/results/$COMMIT" 2>&1 | tail -1 || true
ls "research/results/$COMMIT" 2>/dev/null || echo "(research/results/$COMMIT was not created)"

echo "=== 3. edit reverted"
git checkout -q -- crates/z30-dsp/src/slot.rs
rm -rf research/results/unpublished
build
"$Z" --version | grep -E '^(commit|dirty diff):'

echo "=== 4. identity smoke: suite at 3 frames, $OLD_REV vs $(git rev-parse --short=12 HEAD)"
"$Z" --benchmark suite --frames 3 --out "$D/new" 2>/dev/null
git checkout -q "$OLD_REV"
export CARGO_TARGET_DIR="$D/target-old"
build
"$CARGO_TARGET_DIR/release/z30" --version | grep -E '^commit:'
"$CARGO_TARGET_DIR/release/z30" --benchmark suite --frames 3 --out "$D/old" 2>/dev/null
cd "$REPO"
set +e
python3 research/compare_results.py "$D/old" "$D/new" --legacy-provenance
echo "compare_results.py exit status: $?"
