"""
z-30 Upstream Synchronisation
=============================

Answers one question - "is this installation running the current upstream commit, and if not,
bring it there" - for the CLI updater, the local server's /api/update endpoints, and the web
UI's Update button, all from one implementation.

Commits, not versions
---------------------
z-30 is not released on a version cadence; it is developed on `main`, and an installation is
either at the tip of `main` or some number of commits behind it. The previous updater compared
a hardcoded `CURRENT_VERSION = "1.0.0"` against the newest GitHub release tag and against the
`version` field of the upstream package.json. Both of those had been 1.0.0 for the life of the
repository, so `has_update` was False no matter how far behind the checkout actually was, and
the one thing the operator wanted to know - "am I running the current code" - was the one thing
it could not answer. Worse, the version string had to be bumped by hand, so the mechanism was
only ever as correct as the last person to remember.

`git` already tracks exactly this, exactly correctly. `git fetch` followed by a count of the
commits between HEAD and origin/main is the whole answer, needs no release to be cut, no
version string to be maintained, and no GitHub API token or rate limit.

What "apply" is allowed to do
-----------------------------
Fast-forward only. `git merge --ff-only` either advances HEAD to the upstream commit or fails
without touching anything. It cannot invent a merge commit, cannot leave a conflicted tree
behind, and cannot destroy a local change - and if it refuses, the install has genuinely
diverged and wants a human, not an automated retry with a bigger hammer. `git pull` (the old
updater's choice) merges, and `git reset --hard` would silently discard the operator's own
edits to their own station's code.

Anything uncommitted in the working tree blocks the update for the same reason: a station that
has patched its own copy is not something an Update button gets to overwrite.

This module runs git with argument lists and never through a shell, so nothing derived from a
remote branch name or commit message is ever interpreted as a command.
"""

from dataclasses import dataclass, field, asdict
import os
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

#: Upstream this installation tracks. z-30 has no release channels: there is `main`, and there
#: is however far behind `main` you are.
DEFAULT_REMOTE = "origin"
DEFAULT_BRANCH = "main"

GITHUB_REPO = "themantas1994/z-30"
GITHUB_URL = f"https://github.com/{GITHUB_REPO}"

#: Ceilings on each git invocation. A fetch talks to the network, so it gets the long one; the
#: local queries are all sub-second in a healthy repository and a multi-second answer means
#: something is wrong (an index lock held by another process, a filesystem stall) that the UI
#: should be told about rather than hang on.
NETWORK_TIMEOUT_SEC = 45.0
LOCAL_TIMEOUT_SEC = 15.0
#: A dependency install or a bundle rebuild is genuinely slow on a Raspberry Pi.
BUILD_TIMEOUT_SEC = 900.0


@dataclass
class PendingCommit:
    """One upstream commit this installation does not have yet."""
    sha: str
    short_sha: str
    subject: str
    author: str
    date: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SyncStatus:
    """Where this installation sits relative to upstream `main`."""
    #: False when z-30 is running from a wheel or a source copy with no .git - a pip or
    #: package-manager install, which updates through its own package manager, not through us.
    is_git_checkout: bool = False
    repo_dir: Optional[str] = None
    branch: str = ""
    local_commit: str = ""
    upstream_commit: str = ""
    #: Commits upstream has that this checkout does not, and vice versa.
    behind: int = 0
    ahead: int = 0
    #: Uncommitted changes in the working tree. Blocks an automatic update.
    dirty: bool = False
    pending: List[PendingCommit] = field(default_factory=list)
    #: True when the fetch succeeded and there is nothing to pull.
    up_to_date: bool = False
    #: True when `apply_update` would run: a clean git checkout that is behind upstream.
    can_update: bool = False
    #: Why it cannot, when can_update is False and the operator would otherwise wonder.
    blocked_reason: Optional[str] = None
    #: Set when the check itself failed (no network, no remote, git missing).
    error: Optional[str] = None
    checked_at: str = ""
    remote_url: str = GITHUB_URL

    @property
    def local_short(self) -> str:
        return self.local_commit[:7]

    @property
    def upstream_short(self) -> str:
        return self.upstream_commit[:7]

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["pending"] = [c.to_dict() for c in self.pending]
        data["local_short"] = self.local_short
        data["upstream_short"] = self.upstream_short
        return data


def _run_git(
    args: List[str],
    cwd: str,
    timeout: float = LOCAL_TIMEOUT_SEC,
) -> Tuple[int, str, str]:
    """
    Runs one git command and returns (returncode, stdout, stderr), all decoded and stripped.

    Never uses a shell, so a branch name or a commit subject cannot become a command. A missing
    git binary or a timeout is reported as a non-zero return rather than raising, because every
    caller here wants to turn a failure into a message for the operator.
    """
    try:
        completed = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            timeout=timeout,
            # Environment hardening: never stop for credentials or an editor. An update that
            # silently blocks on a password prompt looks exactly like a hung application.
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"},
        )
    except subprocess.TimeoutExpired:
        return 124, "", f"git {' '.join(args)} timed out after {timeout:.0f}s"
    except OSError as exc:
        return 127, "", f"git is not available: {exc}"
    return (
        completed.returncode,
        completed.stdout.decode("utf-8", "replace").strip(),
        completed.stderr.decode("utf-8", "replace").strip(),
    )


def repo_root(start: Optional[str] = None) -> Optional[str]:
    """
    The git working tree containing the installed package, or None if there isn't one.

    None is the normal answer for a pip or AUR install: those are updated by their package
    manager and the Update button says so rather than pretending it can pull.
    """
    base = start or os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if not os.path.isdir(base):
        return None
    code, out, _err = _run_git(["rev-parse", "--show-toplevel"], cwd=base)
    if code != 0 or not out:
        return None
    return os.path.abspath(out)


def _parse_commits(raw: str) -> List[PendingCommit]:
    commits: List[PendingCommit] = []
    for line in raw.splitlines():
        # %x1f is the ASCII unit separator: commit subjects contain every printable character,
        # so splitting them on anything a human might type loses fields.
        parts = line.split("\x1f")
        if len(parts) != 4:
            continue
        sha, subject, author, date = parts
        commits.append(
            PendingCommit(
                sha=sha,
                short_sha=sha[:7],
                subject=subject,
                author=author,
                date=date,
            )
        )
    return commits


def read_status(
    repo_dir: Optional[str] = None,
    remote: str = DEFAULT_REMOTE,
    branch: str = DEFAULT_BRANCH,
    fetch: bool = True,
) -> SyncStatus:
    """
    Reports how far behind upstream this installation is.

    `fetch=False` answers from whatever the last fetch left in the remote-tracking ref, which is
    what a fast page load wants; the default contacts the network.
    """
    status = SyncStatus(checked_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    # Resolved through repo_root() even when the caller named a directory: a supplied path is
    # a hint about where to look, not an assertion that a repository is there. Taking it at
    # face value reported a wheel install as a git checkout and then failed confusingly two
    # commands later.
    root = repo_root(start=repo_dir) if repo_dir else repo_root()
    if root is None:
        status.blocked_reason = (
            "This copy of z-30 is not a git checkout, so there is nothing to fast-forward. "
            "Installs from pip or a distribution package update through that package manager."
        )
        return status

    status.is_git_checkout = True
    status.repo_dir = root

    code, out, err = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root)
    status.branch = out if code == 0 else ""

    code, out, err = _run_git(["rev-parse", "HEAD"], cwd=root)
    if code != 0:
        status.error = err or "Could not read the current commit."
        return status
    status.local_commit = out

    if fetch:
        code, _out, err = _run_git(
            ["fetch", "--quiet", remote, branch], cwd=root, timeout=NETWORK_TIMEOUT_SEC
        )
        if code != 0:
            # A failed fetch is not fatal: report what the last one left behind, and say why
            # the figure may be stale rather than silently showing "up to date" while offline.
            status.error = err or f"Could not reach {remote}/{branch}."

    code, out, err = _run_git(["rev-parse", f"{remote}/{branch}"], cwd=root)
    if code != 0:
        status.error = status.error or err or f"No remote-tracking ref for {remote}/{branch}."
        return status
    status.upstream_commit = out

    code, out, _err = _run_git(["status", "--porcelain", "--untracked-files=no"], cwd=root)
    status.dirty = bool(out.strip()) if code == 0 else False

    code, out, _err = _run_git(
        ["rev-list", "--left-right", "--count", f"HEAD...{remote}/{branch}"], cwd=root
    )
    if code == 0 and out:
        parts = out.split()
        if len(parts) == 2:
            status.ahead = int(parts[0])
            status.behind = int(parts[1])

    if status.behind:
        code, out, _err = _run_git(
            [
                "log",
                "--no-merges",
                "--max-count=25",
                "--pretty=format:%H%x1f%s%x1f%an%x1f%aI",
                f"HEAD..{remote}/{branch}",
            ],
            cwd=root,
        )
        if code == 0:
            status.pending = _parse_commits(out)

    status.up_to_date = status.behind == 0 and status.error is None
    status.can_update, status.blocked_reason = _update_eligibility(status)
    return status


def _update_eligibility(status: SyncStatus) -> Tuple[bool, Optional[str]]:
    """Whether `apply_update` would do anything, and the reason when it would not."""
    if not status.is_git_checkout:
        return False, status.blocked_reason
    if status.behind == 0:
        return False, None
    if status.dirty:
        return False, (
            "The working tree has uncommitted changes. z-30 will not overwrite local edits to "
            "your own station's code - commit or stash them, then update."
        )
    if status.ahead:
        return False, (
            f"This checkout has {status.ahead} commit(s) upstream does not, so it cannot be "
            "fast-forwarded. Merge or rebase it by hand."
        )
    return True, None


@dataclass
class UpdateResult:
    """Outcome of an update attempt, including the log the operator sees."""
    success: bool = False
    from_commit: str = ""
    to_commit: str = ""
    log: List[str] = field(default_factory=list)
    error: Optional[str] = None
    #: True when the served web bundle changed, so the browser must purge caches and reload.
    web_assets_changed: bool = False
    #: True when the Python package changed, so the running process is now stale.
    restart_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


#: Paths whose change means the running process is serving or executing stale code.
WEB_ASSET_PREFIXES = ("z30_dsp/web_dist/", "dist/", "public/", "src/", "index.html")
PYTHON_PREFIXES = ("z30_dsp/", "pyproject.toml", "requirements.txt")


def apply_update(
    repo_dir: Optional[str] = None,
    remote: str = DEFAULT_REMOTE,
    branch: str = DEFAULT_BRANCH,
    on_log: Optional[Callable[[str], None]] = None,
    reinstall_python: bool = False,
    rebuild_web: bool = False,
) -> UpdateResult:
    """
    Fast-forwards this checkout onto upstream and reports what changed.

    Deliberately does no rebuilding by default. The repository commits its built web bundle
    (`z30_dsp/web_dist/`), which is the whole reason the Update button can work at all on a
    station with no Node toolchain: once the fast-forward lands, the new UI is already on disk
    and the browser only has to purge its caches and reload. `reinstall_python` and
    `rebuild_web` are there for a developer checkout that wants the source rebuilt too, and
    each is reported separately so a failed optional step does not read as a failed update.
    """
    result = UpdateResult()
    lines: List[str] = []

    def log(message: str) -> None:
        lines.append(message)
        if on_log is not None:
            on_log(message)

    status = read_status(repo_dir=repo_dir, remote=remote, branch=branch, fetch=True)
    result.from_commit = status.local_commit
    result.log = lines

    if not status.is_git_checkout:
        result.error = status.blocked_reason
        log(result.error or "Not a git checkout.")
        return result
    if status.error and status.behind == 0:
        result.error = status.error
        log(f"Could not reach upstream: {status.error}")
        return result
    if status.behind == 0:
        result.success = True
        result.to_commit = status.local_commit
        log(f"Already at {remote}/{branch} ({status.local_short}). Nothing to do.")
        return result
    if not status.can_update:
        result.error = status.blocked_reason or "This checkout cannot be fast-forwarded."
        log(result.error)
        return result

    root = status.repo_dir or "."
    log(f"Fast-forwarding {status.local_short} -> {status.upstream_short} "
        f"({status.behind} commit(s) from {remote}/{branch}).")

    code, _out, err = _run_git(
        ["merge", "--ff-only", f"{remote}/{branch}"], cwd=root, timeout=NETWORK_TIMEOUT_SEC
    )
    if code != 0:
        result.error = err or "git merge --ff-only failed."
        log(f"Update refused: {result.error}")
        return result

    code, new_head, _err = _run_git(["rev-parse", "HEAD"], cwd=root)
    result.to_commit = new_head if code == 0 else status.upstream_commit
    log(f"Now at {result.to_commit[:7]}.")

    code, changed, _err = _run_git(
        ["diff", "--name-only", result.from_commit, result.to_commit], cwd=root
    )
    changed_paths = changed.splitlines() if code == 0 else []
    result.web_assets_changed = any(
        p.startswith(WEB_ASSET_PREFIXES) for p in changed_paths
    )
    result.restart_required = any(p.startswith(PYTHON_PREFIXES) for p in changed_paths)
    log(f"{len(changed_paths)} file(s) changed.")

    if reinstall_python:
        log("Refreshing the Python package (pip install -e .)...")
        ok, message = _run_build_step(
            [sys.executable, "-m", "pip", "install", "-e", "."], root
        )
        log(message)
        if not ok:
            # An optional step. The fast-forward already succeeded and reverting it would be a
            # far more destructive act than leaving the operator to run pip themselves.
            log("The code is updated; only the dependency refresh failed.")

    if rebuild_web:
        log("Rebuilding the web bundle (npm run build)...")
        ok, message = _run_build_step(["npm", "run", "build"], root)
        log(message)
        if ok:
            result.web_assets_changed = True

    result.success = True
    return result


def _run_build_step(argv: List[str], cwd: str) -> Tuple[bool, str]:
    """Runs one optional post-update build command, never through a shell."""
    try:
        completed = subprocess.run(
            argv, cwd=cwd, capture_output=True, timeout=BUILD_TIMEOUT_SEC
        )
    except subprocess.TimeoutExpired:
        return False, f"{argv[0]} timed out after {BUILD_TIMEOUT_SEC:.0f}s."
    except OSError as exc:
        return False, f"{argv[0]} could not be run: {exc}"
    if completed.returncode != 0:
        tail = completed.stderr.decode("utf-8", "replace").strip().splitlines()[-4:]
        return False, f"{argv[0]} failed: " + " / ".join(tail)
    return True, f"{argv[0]} completed."
