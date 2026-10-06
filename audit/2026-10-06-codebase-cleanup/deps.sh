#!/bin/bash
# Dependency surface: unique external crates (name+version) by edge kind.
u() { cargo tree --offline --locked "$@" --prefix none --no-dedupe 2>/dev/null | grep -v '^z30' | sed 's/ (.*//; s/ (\*)//' | sort -u | grep -c . ; }
echo "external crates, whole workspace, all kinds:   $(u --workspace -e normal,build,dev --target all)"
echo "external crates, whole workspace, normal+build: $(u --workspace -e normal,build --target all)"
echo "external crates, shipped binaries (z30-cli+z30-gui, cm108, normal+build, all targets): $(u -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108 -e normal,build --target all)"
echo "external crates, shipped binaries, linux host only: $(u -p z30-cli -p z30-gui --features z30-cli/cm108,z30-gui/cm108 -e normal,build)"
echo "direct external deps (declared in crates/*/Cargo.toml, unique names): $(cat crates/*/Cargo.toml | sed -n '/dependencies\]/,/^\[/p' | grep -E '^[a-z0-9_-]+ *(=|\.)' | grep -v '^z30' | sed -E 's/[ .=].*//' | sort -u | wc -l)"
echo "duplicate crate versions (workspace): $(cargo tree --offline --locked --workspace -d --target all -e normal,build,dev 2>/dev/null | grep -cE '^[a-z]')"
