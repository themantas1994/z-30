"""
The updater's CLI wrapper.

`git_sync.py` - the engine that decides whether a fast-forward is safe - is covered by
`test_git_sync.py`. The layer on top of it was not covered at all, and it is the layer that
decides what an operator sees and what a startup script does: `run_updater` turns a `SyncStatus`
into an exit code, and a wrong exit code here means a cron job either never notices the box is
behind, or reports a failure forever on an installation that is perfectly current.

Nothing here touches a real repository or a network. `git_sync.read_status` and
`git_sync.apply_update` are substituted with values constructed in the test, so what is under
test is the decision logic and nothing else.
"""

from dataclasses import dataclass
from typing import Optional

import pytest

from z30_dsp import git_sync, updater


def make_status(**overrides) -> git_sync.SyncStatus:
    """A SyncStatus with the shape read_status() produces, overridden per test."""
    status = git_sync.SyncStatus()
    status.is_git_checkout = True
    status.branch = "main"
    status.local_commit = "a" * 40
    status.upstream_commit = "b" * 40
    for key, value in overrides.items():
        setattr(status, key, value)
    return status


@dataclass
class FakeUpdateResult:
    success: bool = True
    error: Optional[str] = None
    to_commit: str = "b" * 40
    restart_required: bool = False
    web_assets_changed: bool = False


@pytest.fixture
def patched(monkeypatch):
    """Captures what run_updater did, without letting it do any of it."""
    calls = {"apply": []}

    def fake_apply(**kwargs):
        calls["apply"].append(kwargs)
        return FakeUpdateResult()

    monkeypatch.setattr(git_sync, "apply_update", fake_apply)
    return calls


def test_current_installation_exits_zero(monkeypatch, patched, capsys):
    monkeypatch.setattr(git_sync, "read_status", lambda: make_status(behind=0, ahead=0))
    assert updater.run_updater(interactive=False) == 0
    assert not patched["apply"], "nothing to do, but an update was attempted"
    assert "tip of upstream" in capsys.readouterr().out


def test_behind_with_check_only_exits_nonzero_and_changes_nothing(monkeypatch, patched):
    """
    The contract --check documents: a non-zero exit lets a startup script act on "this box is
    behind" without parsing any output. It must never apply the update.
    """
    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=3, can_update=True)
    )
    assert updater.run_updater(interactive=False, check_only=True) == 1
    assert not patched["apply"], "--check applied an update"


def test_behind_and_updatable_applies_and_exits_zero(monkeypatch, patched):
    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=2, can_update=True)
    )
    assert updater.run_updater(interactive=False) == 0
    assert len(patched["apply"]) == 1, "the update was not applied"


def test_blocked_checkout_is_never_updated(monkeypatch, patched, capsys):
    """
    `can_update` False is git_sync's refusal - a dirty tree, a diverged branch, not a checkout.
    The wrapper must relay it, not second-guess it: this is the guard that stops a self-update
    discarding an operator's local changes.
    """
    monkeypatch.setattr(
        git_sync,
        "read_status",
        lambda: make_status(behind=5, can_update=False, dirty=True,
                            blocked_reason="the working tree has uncommitted changes"),
    )
    assert updater.run_updater(interactive=False) == 1
    assert not patched["apply"], "an update was applied to a checkout git_sync refused"
    assert "uncommitted changes" in capsys.readouterr().out


def test_a_failed_apply_is_reported_as_failure(monkeypatch, capsys):
    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=1, can_update=True)
    )
    monkeypatch.setattr(
        git_sync,
        "apply_update",
        lambda **kw: FakeUpdateResult(success=False, error="fast-forward refused"),
    )
    assert updater.run_updater(interactive=False) == 1
    assert "fast-forward refused" in capsys.readouterr().out


def test_interactive_decline_leaves_the_checkout_alone(monkeypatch, patched):
    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=1, can_update=True)
    )
    monkeypatch.setattr("builtins.input", lambda *_: "n")
    assert updater.run_updater(interactive=True) == 1
    assert not patched["apply"], "declining the prompt still applied the update"


@pytest.mark.parametrize("answer", ["", "y", "Y", "yes", "  YES  "])
def test_interactive_accept_forms(monkeypatch, patched, answer):
    """Empty input means yes, since the prompt reads [Y/n]."""
    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=1, can_update=True)
    )
    monkeypatch.setattr("builtins.input", lambda *_: answer)
    assert updater.run_updater(interactive=True) == 0
    assert len(patched["apply"]) == 1, f"answer {answer!r} did not apply the update"


def test_interrupting_the_prompt_is_a_refusal(monkeypatch, patched):
    """Ctrl-C or a closed stdin must not be read as consent."""
    def raise_eof(*_):
        raise EOFError

    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=1, can_update=True)
    )
    monkeypatch.setattr("builtins.input", raise_eof)
    assert updater.run_updater(interactive=True) == 1
    assert not patched["apply"]


def test_flags_are_forwarded_to_the_engine(monkeypatch, patched):
    monkeypatch.setattr(
        git_sync, "read_status", lambda: make_status(behind=1, can_update=True)
    )
    updater.run_updater(interactive=False, reinstall_python=True, rebuild_web=True)
    assert patched["apply"][0]["reinstall_python"] is True
    assert patched["apply"][0]["rebuild_web"] is True


def test_non_git_checkout_reports_and_does_not_update(monkeypatch, patched, capsys):
    monkeypatch.setattr(
        git_sync,
        "read_status",
        lambda: git_sync.SyncStatus(is_git_checkout=False,
                                    blocked_reason="installed from a wheel, not a checkout"),
    )
    assert updater.run_updater(interactive=False) == 0
    assert not patched["apply"]
    assert "not a git checkout" in capsys.readouterr().out


def test_main_tolerates_the_extra_argv_z30_routes_through_it(monkeypatch):
    """
    main() uses parse_known_args because `z30 --update` forwards the whole command line. An
    unrecognised flag must not abort the updater with argparse's exit(2).
    """
    monkeypatch.setattr(updater.sys, "argv", ["z30", "--update", "--check", "--some-other-flag"])
    monkeypatch.setattr(git_sync, "read_status", lambda: make_status(behind=1, can_update=True))
    with pytest.raises(SystemExit) as excinfo:
        updater.main()
    assert excinfo.value.code == 1, "--check while behind should exit 1, not argparse's 2"
