#!/usr/bin/env python3
"""
z-30 Transceiver & DSP Suite - Upstream Updater CLI
===================================================
Repository: https://github.com/themantas1994/z-30

The terminal front end for `z30_dsp.git_sync`. The web UI's Update button and the
`/api/update` endpoints go through the same module, so `z30 --update` and the button do
exactly the same thing and can never disagree about whether an installation is current.

This used to compare a hardcoded `CURRENT_VERSION = "1.0.0"` against the latest GitHub
release tag, print "Your z-30 Transceiver is up to date!" whenever they matched - which was
always, because neither had changed since the repository was created - and only then, if the
comparison had somehow said otherwise, offer a `git pull`. An installation two hundred commits
behind was told it was current. See the module docstring of git_sync.py.
"""

import argparse
import sys

from z30_dsp import git_sync


def print_banner() -> None:
    print("==================================================================")
    print("      z-30 TRANSCEIVER - UPSTREAM SYNCHRONISATION                 ")
    print(f"      {git_sync.GITHUB_URL}")
    print("==================================================================")


def print_status(status: git_sync.SyncStatus) -> None:
    if not status.is_git_checkout:
        print("\nThis copy of z-30 is not a git checkout.")
        print(status.blocked_reason or "")
        return

    print(f"\nRepository:    {status.repo_dir}")
    print(f"Branch:        {status.branch}")
    print(f"Local commit:  {status.local_short}")
    print(f"Upstream:      {status.upstream_short} ({git_sync.DEFAULT_REMOTE}/{git_sync.DEFAULT_BRANCH})")

    if status.error:
        print(f"\n! {status.error}")
        print("  The figures below come from the last successful fetch and may be stale.")

    if status.behind == 0 and status.ahead == 0:
        print("\n[OK] This installation is at the tip of upstream.")
    elif status.behind:
        plural = "" if status.behind == 1 else "s"
        print(f"\n[!] {status.behind} commit{plural} behind upstream:")
        for commit in status.pending:
            print(f"      {commit.short_sha}  {commit.subject}")
        if len(status.pending) < status.behind:
            print(f"      ... and {status.behind - len(status.pending)} more")

    if status.ahead:
        print(f"\n[i] This checkout is {status.ahead} commit(s) ahead of upstream.")
    if status.dirty:
        print("[i] The working tree has uncommitted changes.")
    if status.behind and not status.can_update and status.blocked_reason:
        print(f"\nCannot update automatically: {status.blocked_reason}")


def run_updater(
    interactive: bool = True,
    check_only: bool = False,
    reinstall_python: bool = False,
    rebuild_web: bool = False,
) -> int:
    """Returns a process exit code: 0 current or updated, 1 behind or failed."""
    print_banner()
    print(f"Checking {git_sync.GITHUB_URL} ({git_sync.DEFAULT_BRANCH})...")

    status = git_sync.read_status()
    print_status(status)

    if status.behind == 0:
        return 0 if not status.error else 1
    if check_only:
        # A non-zero exit lets a cron job or a startup script act on "this box is behind"
        # without parsing any of the text above.
        return 1
    if not status.can_update:
        return 1

    if interactive:
        try:
            answer = input(f"\nFast-forward to {status.upstream_short} now? [Y/n]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return 1
        if answer not in ("", "y", "yes"):
            print("Left unchanged.")
            return 1

    print()
    result = git_sync.apply_update(
        on_log=lambda line: print(f"  {line}"),
        reinstall_python=reinstall_python,
        rebuild_web=rebuild_web,
    )
    if not result.success:
        print(f"\n[FAIL] {result.error}")
        return 1

    print(f"\n[OK] Updated to {result.to_commit[:7]}.")
    if result.restart_required:
        print("      The Python package changed - restart z-30 to run the new code.")
    if result.web_assets_changed:
        print("      The web bundle changed - reload the browser tab (or restart z-30).")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="z30 --update",
        description="Fast-forward this z-30 installation onto the upstream main branch.",
    )
    parser.add_argument(
        "-y", "--yes", action="store_true",
        help="Apply the update without asking.",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="Report how far behind upstream this installation is and change nothing. "
             "Exits non-zero when behind, so a startup script can act on it.",
    )
    parser.add_argument(
        "--reinstall", action="store_true",
        help="Also run 'pip install -e .' afterwards, for when dependencies changed.",
    )
    parser.add_argument(
        "--rebuild", action="store_true",
        help="Also run 'npm run build' afterwards. Not normally needed: the repository ships "
             "the built bundle, so a fast-forward already brings the new interface with it.",
    )
    # Tolerate the flags z30's own argv carries when it routes here.
    args, _unknown = parser.parse_known_args()

    sys.exit(
        run_updater(
            interactive=not args.yes,
            check_only=args.check,
            reinstall_python=args.reinstall,
            rebuild_web=args.rebuild,
        )
    )


if __name__ == "__main__":
    main()
