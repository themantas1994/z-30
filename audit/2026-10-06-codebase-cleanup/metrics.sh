#!/bin/bash
# Repository metrics for the cleanup report. Run from the repo root.
f() { git ls-files | grep -E "$1" | grep -vE "${2:-^$}" ; }
loc() { xargs -r cat 2>/dev/null | wc -l; }
echo "tracked files              $(git ls-files | wc -l)"
echo "total text LOC             $(git ls-files | grep -vE '\.(f32|png|ico|lock)$' | loc)"
echo "Rust files (crates/)       $(f '^crates/.*\.rs$' | wc -l)   LOC $(f '^crates/.*\.rs$' | loc)"
echo "Rust files (all)           $(f '\.rs$' | wc -l)"
echo "Python files (all)         $(f '\.py$' | wc -l)   LOC $(f '\.py$' | loc)"
echo "Python outside audit/      $(f '\.py$' '^audit/' | wc -l)   LOC $(f '\.py$' '^audit/' | loc)"
echo "JS/TS files (all)          $(f '\.(js|mjs|cjs|ts|tsx|mts|jsx)$' | wc -l)"
echo "JS/TS outside audit/       $(f '\.(js|mjs|cjs|ts|tsx|mts|jsx)$' '^audit/' | wc -l)"
echo "legacy/ files              $(f '^legacy/' | wc -l)"
echo "workspace crates           $(ls -d crates/*/ | wc -l)"
echo "build scripts              $(f '(^|/)build\.rs$' '^audit/' | wc -l)"
echo "Cargo features (declared)  $(for c in crates/*/Cargo.toml; do sed -n '/^\[features\]/,/^\[/p' $c | grep -cE '^[a-z0-9_-]+ *='; done | paste -sd+ | bc)"
echo "#[test] fns                $(f '^crates/.*\.rs$' | xargs grep -hcE '#\[test\]|proptest!' | paste -sd+ | bc)"
echo "CI jobs                    $(for w in .github/workflows/*.yml; do python3 -c "import sys,re;t=open('$w').read();s=t.split('\njobs:\n',1)[1];print(len(re.findall(r'^  [A-Za-z0-9_-]+:\s*$',s,re.M)))"; done | paste -sd+ | bc)"
echo "lockfile packages          $(grep -c '^\[\[package\]\]' Cargo.lock)"
