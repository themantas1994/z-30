"""
The legacy Tk-path ADIF writer, and atomic station-config persistence.

Both defects here were invisible to the test suite because the web UI has its own, correct
implementation of the same jobs (`qsoLogger.ts`, `web_server.OperatorStore`) and only those were
covered. The Python paths behind `gui_tkinter.py` and the setup wizard carried:

  * an ADIF writer whose newlines were `"\\n"` inside ordinary f-strings, so it emitted the two
    characters backslash-n and every record ran together on one physical line, and
  * `<TAG:len>` prefixes counting characters rather than UTF-8 bytes, which under-declares the
    length of any field containing a non-ASCII character and desynchronises a strict parser for
    the rest of the record, and
  * a config save that wrote JSON straight to the live path, so a crash mid-write truncated it -
    and `load_config` falls back to defaults on a parse error, silently emptying the operator's
    callsign, grid, region and licence class.

Every assertion below parses what was actually written rather than comparing against a recorded
string.
"""

import json
import os
import re

import pytest

from z30_dsp.auto_logger import QsoLogRecord, AsyncQsoLogger
from z30_dsp.station_settings import SettingsManager, StationConfig


# ------------------------------------------------------------------ ADIF writer

@pytest.fixture
def logger(tmp_path):
    return AsyncQsoLogger(
        my_call="W1AW",
        my_grid="FN31",
        db_path=str(tmp_path / "log.db"),
        adif_path=str(tmp_path / "log.adi"),
    )


def a_record(**overrides) -> QsoLogRecord:
    fields = dict(
        callsign="K1ABC",
        grid="FN42",
        band="20m",
        freq_mhz=14.076,
        rst_sent="-15",
        rst_rcvd="-17",
        utc_date="20260901",
        utc_time="120000",
    )
    fields.update(overrides)
    return QsoLogRecord(**fields)


def test_adif_uses_real_newlines(logger, tmp_path):
    """The header, and each record, must end a physical line - not print a literal backslash-n."""
    logger._append_adif(a_record())
    text = (tmp_path / "log.adi").read_text(encoding="utf-8")

    assert "\\n" not in text, "the writer emitted a literal backslash-n instead of a newline"
    assert text.count("\n") >= 4, "the header and record did not produce separate lines"
    assert text.rstrip().endswith("<EOR>"), text[-40:]


def test_adif_header_is_written_once(logger, tmp_path):
    logger._append_adif(a_record())
    logger._append_adif(a_record(callsign="K2DEF"))
    text = (tmp_path / "log.adi").read_text(encoding="utf-8")
    assert text.count("<EOH>") == 1
    assert text.count("<EOR>") == 2


@pytest.mark.parametrize(
    "notes",
    [
        "plain ascii note",
        "Grüße aus München",       # 2-byte UTF-8
        "京都からこんにちは",         # 3-byte UTF-8
        "signal was 👍 all round",  # 4-byte UTF-8
    ],
)
def test_adif_field_lengths_are_utf8_bytes(logger, tmp_path, notes):
    """
    Every declared length must equal the UTF-8 byte length of the value that follows it.

    Checked by re-parsing the file the writer produced, for every field in it - so the test
    verifies the format's own invariant rather than restating the implementation.
    """
    logger._append_adif(a_record(notes=notes))
    text = (tmp_path / "log.adi").read_text(encoding="utf-8")
    record = text.split("<EOH>")[-1]

    fields = re.findall(r"<([A-Z_]+):(\d+)>([^<]*)", record)
    assert fields, "no ADIF fields were parsed back out of the record"

    for tag, declared, value in fields:
        # ADIF counts BYTES, so the declared length is applied to the encoded form. The writer
        # joins fields with a single space, so whatever follows the declared byte count is the
        # separator, not data.
        declared = int(declared)
        encoded = value.encode("utf-8")
        assert len(encoded) >= declared, (
            f"<{tag}:{declared}> declares more bytes than the {len(encoded)} that follow it"
        )
        data, remainder = encoded[:declared], encoded[declared:]
        assert remainder in (b"", b" "), (
            f"<{tag}:{declared}> does not delimit its value: {remainder!r} trails it, so a "
            f"parser reading {declared} bytes would resynchronise mid-record"
        )
        # A byte count that splits a multi-byte character is the exact corruption this guards.
        data.decode("utf-8")

    assert notes in text


def test_adif_records_carry_the_data_they_were_given(logger, tmp_path):
    logger._append_adif(a_record(callsign="VK3XYZ", grid="QF22"))
    text = (tmp_path / "log.adi").read_text(encoding="utf-8")
    assert "<CALL:6>VK3XYZ" in text
    assert "<GRIDSQUARE:4>QF22" in text
    assert "<OPERATOR:4>W1AW" in text


# ------------------------------------------------------------------ atomic config save

def test_save_config_leaves_no_temp_file_behind(tmp_path):
    path = str(tmp_path / "config.json")
    manager = SettingsManager(config_path=path)
    assert manager.save_config(StationConfig(callsign="K1ABC", grid="FN42"))
    assert os.path.exists(path)
    assert not os.path.exists(f"{path}.tmp"), "the temporary file survived a successful save"
    leftovers = [p for p in os.listdir(tmp_path) if p.endswith(".tmp")]
    assert not leftovers, leftovers


def test_saved_config_round_trips(tmp_path):
    path = str(tmp_path / "config.json")
    SettingsManager(config_path=path).save_config(
        StationConfig(callsign="K1ABC", grid="FN42")
    )
    reloaded = SettingsManager(config_path=path).load_config()
    assert reloaded.callsign == "K1ABC"
    assert reloaded.grid == "FN42"
    with open(path, "r", encoding="utf-8") as handle:
        json.load(handle)  # must be complete, parseable JSON


def test_an_existing_config_survives_a_failed_save(tmp_path, monkeypatch):
    """
    The point of writing to a temporary file first: a save that dies part-way must leave the
    previous configuration intact rather than truncating it. `load_config` falls back to
    defaults on a parse error, so a truncated file loses the operator's callsign silently - and
    an empty callsign is refused by the transmit gate at the next slot.
    """
    path = str(tmp_path / "config.json")
    manager = SettingsManager(config_path=path)
    assert manager.save_config(StationConfig(callsign="K1ABC", grid="FN42"))
    before = open(path, "r", encoding="utf-8").read()

    real_replace = os.replace

    def explode(src, dst):
        raise OSError("simulated crash between write and rename")

    monkeypatch.setattr(os, "replace", explode)
    assert manager.save_config(StationConfig(callsign="W9XYZ", grid="EN52")) is False
    monkeypatch.setattr(os, "replace", real_replace)

    after = open(path, "r", encoding="utf-8").read()
    assert after == before, "a failed save modified the live config file"
    assert SettingsManager(config_path=path).load_config().callsign == "K1ABC"
    assert not os.path.exists(f"{path}.tmp"), "the partial file was left behind"
