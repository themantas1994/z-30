#!/bin/bash
# Usage: measure.sh <git-rev> <label> [exclude-py]
# Clean-tree timings of the developer and CI commands, each with a fresh target dir.
set -u
REV=$1; LABEL=$2; EXCL=${3:-}
SP=${SP:-$(mktemp -d)}
WT=$SP/wt-$LABEL
OUT=$SP/timings-$LABEL.txt
rm -rf $WT; git -C /home/user/z-30 worktree add -f --detach $WT $REV >/dev/null 2>&1
cd $WT
cargo fetch --locked >/dev/null 2>&1
t() { local name=$1; shift; local s=$(date +%s.%N); "$@" > $SP/log-$LABEL-$name.txt 2>&1; local rc=$?; local e=$(date +%s.%N); printf "%-14s rc=%d %8.1f s   %s\n" "$name" $rc $(echo "$e - $s" | bc) "$*" >> $OUT; }
: > $OUT
echo "rev $(git rev-parse --short=12 HEAD) nproc $(nproc) $(rustc --version)" >> $OUT
export CARGO_TARGET_DIR=$WT/target-a
t check-clean  cargo check --workspace --all-targets --locked $EXCL
t clippy-warm  cargo clippy --workspace --all-targets --locked $EXCL -- -D warnings
touch crates/z30-dsp/src/slot.rs
t check-incr   cargo check --workspace --all-targets --locked $EXCL
export CARGO_TARGET_DIR=$WT/target-b
t test-dev-build cargo test --workspace --locked $EXCL --no-run
t test-dev-run   cargo test --workspace --locked $EXCL
export CARGO_TARGET_DIR=$WT/target-c
t release-bin-clean cargo build --release --locked -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
t test-rel-build cargo test --workspace --release --locked $EXCL --no-run
t test-rel-run   cargo test --workspace --release --locked $EXCL
ls -l target-c/release/z30 target-c/release/z30-gui | awk '{print "size", $5, $9}' >> $OUT
strip -o $SP/z30s target-c/release/z30 && strip -o $SP/z30gs target-c/release/z30-gui && ls -l /tmp/z30s $SP/z30gs | awk '{print "stripped", $5, $9}' >> $OUT
target-c/release/z30 --benchmark perf --frames 20 > $SP/perf-$LABEL.txt 2>&1
echo done >> $OUT
