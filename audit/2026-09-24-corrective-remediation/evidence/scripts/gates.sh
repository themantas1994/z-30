#!/bin/bash
# Runs the repository's quality gates on one toolchain and logs each step's output and exit code.
# usage: gates.sh <toolchain> <target-dir> <log-dir>
tc=$1; td=$2; out=$3
mkdir -p "$out"
cd /home/user/z-30
export CARGO_TARGET_DIR=$td CARGO_TERM_COLOR=never
step() { name=$1; shift; echo "### $name: $*" > "$out/$name.txt"; start=$(date +%s); "$@" >> "$out/$name.txt" 2>&1; rc=$?; echo "EXIT $rc ($(( $(date +%s)-start )) s)" >> "$out/$name.txt"; echo "$name $rc" >> "$out/summary.txt"; }
: > "$out/summary.txt"
rustc +$tc --version >> "$out/summary.txt"
step fmt cargo +$tc fmt --all --check
step clippy cargo +$tc clippy --workspace --all-targets --exclude z30-py -- -D warnings
step test_release cargo +$tc test --workspace --exclude z30-py --release --locked
step build_release_cm108 cargo +$tc build --release --locked -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108
step build_workspace_release cargo +$tc build --workspace --release --locked
echo done >> "$out/summary.txt"
