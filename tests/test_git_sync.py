"""
Guards on the upstream updater.

The update mechanism reads and writes the operator's own checkout of the software that keys
their transmitter, from a button in a web UI. Two things therefore have to hold, and both are
asserted here against real git repositories rather than mocks - a mocked `git` proves only that
the mock behaves as expected:

  * it reports the truth about how far behind upstream an installation is (the previous
    version compared a hardcoded "1.0.0" against the newest release tag and so answered "up to
    date" no matter how far behind the checkout was);
  * it never destroys local work. Fast-forward only: an installation with uncommitted changes
    or with commits of its own is refused, not overwritten.
"""

import os
import subprocess

import pytest

from z30_dsp import git_sync


def git(repo, *args):
    subprocess.run(
        ["git"] + list(args),
        cwd=repo,
        check=True,
        capture_output=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )


def commit(repo, filename, text, message):
    (repo / filename).write_text(text, encoding="utf-8")
    git(repo, "add", filename)
    git(repo, "commit", "-m", message)


@pytest.fixture
def upstream_and_clone(tmp_path):
    """An upstream repository with one commit, and a clone of it that tracks origin/main."""
    upstream = tmp_path / "upstream"
    upstream.mkdir()
    git(upstream, "init", "--initial-branch=main")
    git(upstream, "config", "user.email", "test@example.invalid")
    git(upstream, "config", "user.name", "Test")
    commit(upstream, "README.md", "one\n", "first")

    clone = tmp_path / "clone"
    subprocess.run(
        ["git", "clone", str(upstream), str(clone)], check=True, capture_output=True
    )
    git(clone, "config", "user.email", "test@example.invalid")
    git(clone, "config", "user.name", "Test")
    return upstream, clone


# -- reporting the truth ----------------------------------------------------

def test_a_current_checkout_reports_up_to_date(upstream_and_clone):
    _upstream, clone = upstream_and_clone
    status = git_sync.read_status(repo_dir=str(clone))

    assert status.is_git_checkout is True
    assert status.behind == 0
    assert status.ahead == 0
    assert status.up_to_date is True
    assert status.can_update is False  # nothing to do, not "blocked"
    assert status.blocked_reason is None


def test_commits_behind_are_counted_and_listed(upstream_and_clone):
    upstream, clone = upstream_and_clone
    commit(upstream, "a.txt", "a\n", "add a")
    commit(upstream, "b.txt", "b\n", "add b")

    status = git_sync.read_status(repo_dir=str(clone))

    assert status.behind == 2
    assert status.up_to_date is False
    assert status.can_update is True
    assert [c.subject for c in status.pending] == ["add b", "add a"]
    assert all(len(c.short_sha) == 7 for c in status.pending)


def test_a_commit_subject_survives_intact(upstream_and_clone):
    """
    Commit subjects are parsed out of `git log` output and rendered in the UI.

    Split on a unit separator rather than anything a human might type, so a subject containing
    the delimiter does not silently lose the rest of the line - or worse, shift the author and
    date fields along by one.
    """
    upstream, clone = upstream_and_clone
    subject = "fix(cat): don't drop PTT | pipe, tab\tand: colon"
    commit(upstream, "c.txt", "c\n", subject)

    status = git_sync.read_status(repo_dir=str(clone))
    assert [c.subject for c in status.pending] == [subject]


def test_a_non_git_directory_is_reported_rather_than_guessed(tmp_path):
    plain = tmp_path / "wheel-install"
    plain.mkdir()
    status = git_sync.read_status(repo_dir=str(plain))

    assert status.is_git_checkout is False
    assert status.can_update is False
    assert status.blocked_reason and "not a git checkout" in status.blocked_reason


# -- never destroying local work --------------------------------------------

def test_uncommitted_changes_block_the_update(upstream_and_clone):
    """A station that has patched its own copy is not something a button gets to overwrite."""
    upstream, clone = upstream_and_clone
    commit(upstream, "a.txt", "a\n", "add a")
    (clone / "README.md").write_text("locally modified\n", encoding="utf-8")

    status = git_sync.read_status(repo_dir=str(clone))
    assert status.dirty is True
    assert status.behind == 1
    assert status.can_update is False
    assert "uncommitted changes" in (status.blocked_reason or "")

    result = git_sync.apply_update(repo_dir=str(clone))
    assert result.success is False
    # The edit is still there, and HEAD did not move.
    assert (clone / "README.md").read_text(encoding="utf-8") == "locally modified\n"


def test_local_commits_block_the_update_rather_than_being_merged_away(upstream_and_clone):
    upstream, clone = upstream_and_clone
    commit(upstream, "a.txt", "a\n", "upstream work")
    commit(clone, "mine.txt", "mine\n", "my own patch")

    status = git_sync.read_status(repo_dir=str(clone))
    assert status.ahead == 1
    assert status.behind == 1
    assert status.can_update is False
    assert "fast-forwarded" in (status.blocked_reason or "")

    before = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=clone, capture_output=True, check=True
    ).stdout
    result = git_sync.apply_update(repo_dir=str(clone))
    assert result.success is False
    after = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=clone, capture_output=True, check=True
    ).stdout
    assert before == after, "a diverged checkout must not be moved"
    assert (clone / "mine.txt").is_file()


# -- applying the update ----------------------------------------------------

def test_apply_fast_forwards_and_reports_what_changed(upstream_and_clone):
    upstream, clone = upstream_and_clone
    (upstream / "z30_dsp").mkdir()
    commit(upstream, "z30_dsp/thing.py", "x = 1\n", "change the python package")

    result = git_sync.apply_update(repo_dir=str(clone))

    assert result.success is True
    assert result.from_commit != result.to_commit
    assert result.restart_required is True, "a change under z30_dsp/ makes the running process stale"
    assert (clone / "z30_dsp" / "thing.py").is_file()
    assert git_sync.read_status(repo_dir=str(clone)).behind == 0


def test_apply_flags_a_changed_web_bundle_so_the_browser_reloads(upstream_and_clone):
    """
    The repository ships its built bundle, so a fast-forward alone brings the new interface.

    The browser will keep serving the previously cached one until the caches are purged, which
    is indistinguishable from an update that did nothing - so the result has to say when the
    served assets moved.
    """
    upstream, clone = upstream_and_clone
    (upstream / "z30_dsp" / "web_dist").mkdir(parents=True)
    commit(upstream, "z30_dsp/web_dist/index.html", "<html></html>\n", "rebuild the bundle")

    result = git_sync.apply_update(repo_dir=str(clone))
    assert result.success is True
    assert result.web_assets_changed is True


def test_applying_with_nothing_to_do_succeeds_quietly(upstream_and_clone):
    _upstream, clone = upstream_and_clone
    result = git_sync.apply_update(repo_dir=str(clone))
    assert result.success is True
    assert any("Nothing to do" in line for line in result.log)


def test_no_git_command_is_ever_built_by_string_interpolation():
    """
    Every git invocation is an argument list, never a shell string.

    Commit subjects, branch names and remote URLs all flow through this module, and all three
    are attacker-influenceable on a repository anyone can open a pull request against.
    """
    source = (
        os.path.join(os.path.dirname(__file__), "..", "z30_dsp", "git_sync.py")
    )
    with open(source, "r", encoding="utf-8") as handle:
        text = handle.read()
    assert "shell=True" not in text
    assert "os.system" not in text
    assert "os.popen" not in text
