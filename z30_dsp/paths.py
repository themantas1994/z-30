"""
z-30 User Data & Configuration Paths
====================================

Every file z-30 writes on behalf of the operator - the clock-offset calibration, the QSO
logbook, the station configuration - lives in one per-user directory resolved here.

Previously the config path defaulted to the bare relative string "config.json", so the file
landed in whatever directory the app happened to be launched from: starting z-30 from the
desktop and from a terminal in the source tree gave two different configs, and the second
launch silently came up with defaults. A repository-relative path also meant a personal
calibration file could be committed by accident.

Resolution order:
  1. $Z30_HOME, if set (explicit override, mainly for tests and packaging).
  2. $XDG_CONFIG_HOME/z30, if XDG_CONFIG_HOME is set (Linux/BSD desktop convention).
  3. ~/.z30 (the historical location, and the fallback everywhere else).
"""

import os
from pathlib import Path

APP_DIR_NAME = "z30"


def user_data_dir() -> Path:
    """Returns the per-user z-30 data directory, creating it if necessary."""
    override = os.environ.get("Z30_HOME")
    if override:
        base = Path(override).expanduser()
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg).expanduser() / APP_DIR_NAME if xdg else Path.home() / ".z30"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError:
        # A read-only or otherwise unwritable home is not fatal on its own; callers that
        # actually write will surface the failure with the real filename attached.
        pass
    return base


def user_data_file(filename: str) -> Path:
    """Returns the absolute path of `filename` inside the per-user z-30 data directory."""
    return user_data_dir() / filename


def default_config_path() -> str:
    """Absolute path of config.json (clock offset and last sync timestamp)."""
    return str(user_data_file("config.json"))


def logbook_json_path() -> str:
    """Absolute path of the JSON logbook the web UI persists through the local server."""
    return str(user_data_file("logbook.json"))


def logbook_adif_path() -> str:
    """Absolute path of the ADIF mirror written alongside the JSON logbook."""
    return str(user_data_file("logbook.adi"))


def station_config_path() -> str:
    """Absolute path of the persisted station configuration."""
    return str(user_data_file("station_config.json"))
