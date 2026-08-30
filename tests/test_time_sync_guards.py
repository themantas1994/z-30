"""
Guards on the RF time-sync path and the user data directory.

An RF time station is an unauthenticated broadcast: anyone with a transmitter can put a
WWV-shaped signal on the air, and a marginal decode can produce a wrong timestamp with no
adversary involved at all. Handing that timestamp to the operating system moves the machine's
clock arbitrarily, and TLS validity, log timestamps, cron and every other application on the
host move with it. So the default is that z-30 keeps the correction to itself.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from z30_dsp import paths
from z30_dsp.rf_time_sync import MAX_OS_CLOCK_STEP_SEC, TimeSyncSettingsManager


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("Z30_HOME", str(tmp_path))
    monkeypatch.delenv(TimeSyncSettingsManager.ENABLE_ENV_VAR, raising=False)
    yield tmp_path


def now_plus(seconds: float) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


# -- the default is off ----------------------------------------------------

def test_clock_setting_is_disabled_by_default():
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is False


def test_refuses_when_not_allowed():
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(now_plus(1.0), allow=False, confirmed=True)
    assert applied is False
    assert "disabled" in reason.lower()
    assert "app_time_offset_ms" in reason


def test_refuses_when_not_confirmed():
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(now_plus(1.0), allow=True, confirmed=False)
    assert applied is False
    assert "confirm" in reason.lower()


# -- the sanity bound ------------------------------------------------------

@pytest.mark.parametrize("offset_sec", [MAX_OS_CLOCK_STEP_SEC + 60, -(MAX_OS_CLOCK_STEP_SEC + 60), 86400, -86400])
def test_refuses_a_step_beyond_the_sanity_bound(offset_sec):
    """
    A misdecode - or a deliberately transmitted spoof, trivial on an open channel - must not be
    able to move the clock arbitrarily. Genuine drift is milliseconds to seconds.
    """
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(
        now_plus(offset_sec), allow=True, confirmed=True
    )
    assert applied is False
    assert "sanity bound" in reason
    assert "spoof" in reason


def test_the_bound_is_configurable_but_still_enforced():
    applied, reason = TimeSyncSettingsManager.try_set_os_system_time(
        now_plus(30.0), allow=True, confirmed=True, max_step_sec=5.0
    )
    assert applied is False
    assert "5s sanity bound" in reason


def test_never_returns_a_bare_boolean():
    """Every outcome carries a reason, so a refusal cannot be mistaken for silence."""
    result = TimeSyncSettingsManager.try_set_os_system_time(now_plus(1.0), allow=False)
    assert isinstance(result, tuple) and len(result) == 2
    assert isinstance(result[0], bool) and isinstance(result[1], str) and result[1]


# -- opting in -------------------------------------------------------------

def test_enabled_by_config_file(isolated_home):
    config = isolated_home / "config.json"
    config.write_text(json.dumps({"allow_set_system_clock": True}), encoding="utf-8")
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is True


def test_enabled_by_environment_variable(monkeypatch):
    monkeypatch.setenv(TimeSyncSettingsManager.ENABLE_ENV_VAR, "true")
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is True


def test_a_malformed_config_fails_closed(isolated_home):
    (isolated_home / "config.json").write_text("{ not json", encoding="utf-8")
    assert TimeSyncSettingsManager.is_os_clock_setting_enabled() is False


# -- the internal offset, which is what actually gets used -----------------

def test_offset_round_trips_through_the_user_config(isolated_home):
    assert TimeSyncSettingsManager.update_app_time_offset(-25.5) is True
    assert TimeSyncSettingsManager.get_app_time_offset() == pytest.approx(-25.5)

    stored = json.loads((isolated_home / "config.json").read_text(encoding="utf-8"))
    assert stored["app_time_offset_ms"] == pytest.approx(-25.5)
    assert "last_time_sync_utc" in stored


def test_offset_defaults_to_zero_when_no_config_exists():
    assert TimeSyncSettingsManager.get_app_time_offset() == 0.0


# -- user data paths -------------------------------------------------------

def test_config_resolves_under_the_user_data_directory(isolated_home):
    """
    The default used to be the bare relative string "config.json", so the file landed wherever
    the app happened to be launched from and a second launch elsewhere silently started from
    defaults.
    """
    assert os.path.isabs(paths.default_config_path())
    assert paths.default_config_path().startswith(str(isolated_home))


def test_xdg_config_home_is_honoured(tmp_path, monkeypatch):
    monkeypatch.delenv("Z30_HOME", raising=False)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    assert paths.default_config_path() == str(tmp_path / "xdg" / "z30" / "config.json")


def test_every_user_file_lives_in_one_directory(isolated_home):
    for path in (
        paths.default_config_path(),
        paths.logbook_json_path(),
        paths.logbook_adif_path(),
        paths.station_config_path(),
    ):
        assert os.path.dirname(path) == str(isolated_home)
