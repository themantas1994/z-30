#!/usr/bin/env python3
"""Compares the resolved dependency closure of a crate between two `Cargo.lock` files.

Why this exists: `docs/research-process.md` section 7 lets a dependency update skip the
experiment only when the benchmark suite is left bit-identical, and requires the pull request to
*show* it. The direct proof is to run `z30 --benchmark suite` on both commits and compare with
`research/compare_results.py`. That takes about
an hour of compute per commit and it cannot run at all when the candidate does not build.

This script proves the *precondition* instead, and only that: if no crate in the resolved closure
of `z30-cli` (the binary that runs the suite) changes name, version or source, then the suite
binary is built from an identical set of inputs and no measured figure can move. It is a
sufficient proof of "the suite cannot have changed". It is NOT a substitute for
`compare_results.py` when the closure *does* change — then the suite must actually be run.

Usage:
    lock_closure.py <old Cargo.lock> <new Cargo.lock> [root-crate ...]

Roots default to `z30-cli` (the suite binary) and `z30-dsp` (the receiver). Exit status is 0 when
every root's closure is unchanged, 1 when any root's closure differs.

Get the two lock files without checking out either branch:
    git show <base>:Cargo.lock > /tmp/base.lock
    git show <head>:Cargo.lock > /tmp/head.lock
"""

import sys
import tomllib

DEFAULT_ROOTS = ["z30-cli", "z30-dsp"]


def load(path):
    """Returns {(name, version): package} and {name: [versions]} from a Cargo.lock."""
    with open(path, "rb") as fh:
        lock = tomllib.load(fh)
    by_key, by_name = {}, {}
    for pkg in lock["package"]:
        by_key[(pkg["name"], pkg["version"])] = pkg
        by_name.setdefault(pkg["name"], []).append(pkg["version"])
    return by_key, by_name


def resolve(dep, by_key, by_name):
    """A Cargo.lock dependency string is "name", "name version" or "name version (source)".
    The version is present exactly when the lock holds more than one version of that name."""
    parts = dep.split()
    name = parts[0]
    if len(parts) > 1:
        return (name, parts[1])
    versions = by_name.get(name)
    if not versions:
        return None  # an optional dependency that this resolution did not select
    if len(versions) != 1:
        raise SystemExit(f"ambiguous dependency {dep!r}: {name} resolved to {versions}")
    return (name, versions[0])


def closure(root, by_key, by_name):
    """Every (name, version, source) reachable from root, root included."""
    versions = by_name.get(root)
    if not versions:
        raise SystemExit(f"{root} is not in the lock file")
    seen, stack = set(), [(root, v) for v in versions]
    while stack:
        key = stack.pop()
        if key in seen:
            continue
        seen.add(key)
        pkg = by_key.get(key)
        if pkg is None:
            raise SystemExit(f"{key} is referenced but not in the lock file")
        for dep in pkg.get("dependencies", []):
            nxt = resolve(dep, by_key, by_name)
            if nxt is not None:
                stack.append(nxt)
    return {(n, v, by_key[(n, v)].get("source", "workspace")) for n, v in seen}


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    old_path, new_path = argv[1], argv[2]
    roots = argv[3:] or DEFAULT_ROOTS
    old = load(old_path)
    new = load(new_path)

    print(f"old: {old_path}  ({len(old[0])} resolved packages)")
    print(f"new: {new_path}  ({len(new[0])} resolved packages)")

    differed = False
    in_roots = set()  # every (name, version) any root reaches, on either side
    for root in roots:
        a = closure(root, *old)
        b = closure(root, *new)
        in_roots |= {(n, v) for n, v, _ in a | b}
        removed, added = sorted(a - b), sorted(b - a)
        if not removed and not added:
            print(f"\n{root}: closure IDENTICAL ({len(a)} crates, name+version+source)")
            continue
        differed = True
        print(f"\n{root}: closure DIFFERENT ({len(a)} -> {len(b)} crates)")
        for n, v, _ in removed:
            print(f"    - {n} {v}")
        for n, v, _ in added:
            print(f"    + {n} {v}")

    # Show the rest of the update too, so a reader sees the whole change and not only the part
    # that reaches the roots. What is listed here is what keeps an IDENTICAL verdict from being
    # vacuous: the lock really did change, just nowhere the suite can see.
    elsewhere = sorted((set(new[0]) ^ set(old[0])) - in_roots)
    if elsewhere:
        print("\nchanged elsewhere in the lock file (outside every root closure above):")
        for n, v in elsewhere:
            print(f"    {'+' if (n, v) in new[0] else '-'} {n} {v}")

    print(
        "\nVERDICT: every root closure is unchanged; the suite binary is built from an identical\n"
        "set of crates, so no benchmark figure can move. This is the section 7 precondition only."
        if not differed
        else "\nVERDICT: a root closure changed. Section 7 does not apply on this evidence; run\n"
        "`z30 --benchmark suite` on both commits and compare with compare_results.py."
    )
    return 0 if not differed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
