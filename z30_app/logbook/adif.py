"""ADIF logbook."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class LogEntry:
    date: str
    time: str
    call: str
    grid: str
    band: str
    mode: str
    snr: float
    distance_km: float | None
    message: str


class AdifLogger:
    def __init__(self, filename: str | Path):
        self.filename = Path(filename)
        self.entries: list[LogEntry] = []
        self._ensure_header()
        self.load()

    def _ensure_header(self) -> None:
        if not self.filename.exists():
            self.filename.parent.mkdir(parents=True, exist_ok=True)
            with open(self.filename, "w", encoding="utf-8") as fh:
                fh.write("Z-30 Digital Mode Log\n<ADIF_VER:5>3.1.4\n<PROGRAMID:6>Z-30\n<EOH>\n\n")

    def load(self) -> None:
        if not self.filename.exists():
            return
        text = self.filename.read_text(encoding="utf-8", errors="replace")
        records = re.split(r"<EOR>", text, flags=re.IGNORECASE)
        for rec in records:
            if "<CALL:" not in rec.upper():
                continue
            fields = dict(re.findall(r"<(\w+):(\d+)>([^\n<]*)", rec, flags=re.IGNORECASE))
            self.entries.append(
                LogEntry(
                    date=fields.get("QSO_DATE", ""),
                    time=fields.get("TIME_ON", ""),
                    call=fields.get("CALL", ""),
                    grid=fields.get("GRIDSQUARE", ""),
                    band=fields.get("BAND", ""),
                    mode=fields.get("MODE", "Z30"),
                    snr=float(fields.get("RST_RCVD", "0") or 0),
                    distance_km=None,
                    message=fields.get("COMMENT", ""),
                )
            )

    def add_qso(self, entry: LogEntry) -> None:
        self.entries.append(entry)
        with open(self.filename, "a", encoding="utf-8") as fh:
            fh.write(
                f"<CALL:{len(entry.call)}>{entry.call} "
                f"<QSO_DATE:8>{entry.date} "
                f"<TIME_ON:6>{entry.time} "
                f"<MODE:{len(entry.mode)}>{entry.mode} "
                f"<BAND:{len(entry.band)}>{entry.band} "
                f"<GRIDSQUARE:{len(entry.grid)}>{entry.grid} "
                f"<RST_RCVD:{len(str(entry.snr))}>{entry.snr} "
                f"<COMMENT:{len(entry.message)}>{entry.message} "
                f"<EOR>\n"
            )

    def search(self, query: str) -> list[LogEntry]:
        q = query.upper()
        return [e for e in self.entries if q in e.call.upper() or q in e.message.upper()]

    def export_adif(self, path: str | Path) -> None:
        path = Path(path)
        path.write_text(self.filename.read_text(encoding="utf-8"), encoding="utf-8")

    def import_adif(self, path: str | Path) -> int:
        src = Path(path).read_text(encoding="utf-8", errors="replace")
        before = len(self.entries)
        with open(self.filename, "a", encoding="utf-8") as fh:
            fh.write(src)
        self.load()
        return len(self.entries) - before

    @staticmethod
    def now_fields() -> tuple[str, str]:
        now = datetime.now(timezone.utc)
        return now.strftime("%Y%m%d"), now.strftime("%H%M%S")
