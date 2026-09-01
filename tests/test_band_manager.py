"""
Band presets and the CAT tuning wrapper.

`band_manager.py` had only incidental coverage - two assertions embedded in
`test_time_sync_guards.py`. That was enough to miss a defect in the one function here that
talks to a radio: `tune_radio` computed the result of the CAT mode-set command and then
returned only the frequency result, so a rig that accepted the QSY and refused the mode change
reported a fully successful tune.

The CAT client is substituted throughout; nothing here opens a socket.
"""

import json
import os

import pytest

from z30_dsp.band_manager import BandManager


class FakeCat:
    """A rigctld stand-in that records what it was asked and answers as configured."""

    def __init__(self, freq_ok=True, mode_ok=True, reported_freq=None):
        self.freq_ok = freq_ok
        self.mode_ok = mode_ok
        self.reported_freq = reported_freq
        self.calls = []

    def set_frequency(self, freq_hz):
        self.calls.append(("set_frequency", freq_hz))
        return self.freq_ok

    def set_mode(self, mode="PKTUSB", passband_hz=3000):
        self.calls.append(("set_mode", mode, passband_hz))
        return self.mode_ok

    def get_frequency(self):
        self.calls.append(("get_frequency",))
        return self.reported_freq


@pytest.fixture
def manager(tmp_path):
    def build(cat):
        return BandManager(config_path=str(tmp_path / "bands.json"), hamlib_client=cat)

    return build


# --------------------------------------------------------------- tune_radio honesty

def test_tune_radio_succeeds_only_when_both_commands_did(manager):
    cat = FakeCat(freq_ok=True, mode_ok=True)
    assert manager(cat).tune_radio(14_076_000) is True
    assert ("set_frequency", 14_076_000) in cat.calls
    assert any(call[0] == "set_mode" for call in cat.calls)


def test_tune_radio_reports_failure_when_the_mode_change_is_refused(manager):
    """
    The defect this file was written for. A rig on the right frequency in the wrong mode is not
    a tuned rig, and reporting success left the caller with nothing to log or act on.
    """
    cat = FakeCat(freq_ok=True, mode_ok=False)
    assert manager(cat).tune_radio(14_076_000) is False


def test_tune_radio_reports_failure_when_the_qsy_is_refused(manager):
    cat = FakeCat(freq_ok=False, mode_ok=True)
    assert manager(cat).tune_radio(14_076_000) is False


# --------------------------------------------------------------- band detection

def test_detect_band_round_trips_every_shipped_preset(manager):
    """
    Every band's own dial frequency must detect as that band. Driven off the manager's own
    preset table rather than a retyped list, so adding a band extends the test automatically.
    """
    bm = manager(FakeCat())
    for band_name in bm.bands:
        freq = bm.get_frequency(band_name)
        assert bm.detect_band(freq) == band_name, (
            f"{band_name}'s own dial {freq} Hz detected as {bm.detect_band(freq)}"
        )


def test_detect_band_rejects_a_frequency_outside_every_band(manager):
    bm = manager(FakeCat())
    # Well clear of any amateur allocation the table carries.
    assert bm.detect_band(5_000) is None
    assert bm.detect_band(900_000_000) is None


def test_sync_from_radio_adopts_what_the_rig_reports(manager):
    bm = manager(FakeCat(reported_freq=7_074_000))
    assert bm.sync_from_radio() == 7_074_000
    assert bm.active_frequency_hz == 7_074_000
    assert bm.detect_band(7_074_000) == bm.active_band


def test_sync_from_radio_changes_nothing_when_the_rig_cannot_be_read(manager):
    bm = manager(FakeCat(reported_freq=None))
    before_freq = bm.active_frequency_hz
    before_band = bm.active_band
    assert bm.sync_from_radio() is None
    assert bm.active_frequency_hz == before_freq
    assert bm.active_band == before_band


# --------------------------------------------------------------- persistence

def test_a_custom_dial_survives_a_reload(manager, tmp_path):
    path = str(tmp_path / "bands.json")
    first = BandManager(config_path=path, hamlib_client=FakeCat())
    band = next(iter(first.bands))
    first.set_frequency(band, 14_078_500, persist=True)

    reloaded = BandManager(config_path=path, hamlib_client=FakeCat())
    assert reloaded.get_frequency(band) == 14_078_500


def test_the_persisted_file_is_valid_json(manager, tmp_path):
    path = str(tmp_path / "bands.json")
    bm = BandManager(config_path=path, hamlib_client=FakeCat())
    bm.save_config()
    assert os.path.exists(path)
    with open(path, "r", encoding="utf-8") as handle:
        json.load(handle)
