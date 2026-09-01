"""
z-30 Asynchronous Amateur Radio QSO Logging Engine
=================================================
Features:
- Thread-safe non-blocking queue (queue.Queue) with dedicated background worker thread
- Automatic ADIF 3.1.4 standard compliance (LoTW, eQSL, ClubLog compatible)
- SQLite3 durable relational database with schema indexes
- RFC 4180 CSV export
- Maidenhead Great-Circle distance (km) and bearing (deg) geometric calculation
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import math
import os
import queue
import sqlite3
import threading
from typing import Any, Optional, Tuple

try:
    from .station_settings import PLACEHOLDER_CALLSIGN
except ImportError:  # pragma: no cover - direct script execution, not package import
    from z30_dsp.station_settings import PLACEHOLDER_CALLSIGN

@dataclass
class QsoLogRecord:
    callsign: str
    grid: str
    band: str
    freq_mhz: float
    rst_sent: str
    rst_rcvd: str
    mode: str = "z-30"
    submode: str = "16-MFSK"
    utc_date: Optional[str] = None  # YYYYMMDD
    utc_time: Optional[str] = None  # HHMMSS
    distance_km: int = 0
    azimuth_deg: int = 0
    tx_power_watts: int = 50
    notes: str = "z-30 16-MFSK LDPC"

def calculate_maidenhead_distance(grid1: str, grid2: str) -> Tuple[int, int]:
    """Calculates Great-Circle distance in km and initial bearing in degrees."""
    def parse_grid(g: str) -> Optional[Tuple[float, float]]:
        g = g.strip().upper()
        if len(g) < 4:
            return None
        lon = (ord(g[0]) - ord('A')) * 20 - 180 + int(g[2]) * 2 + 1
        lat = (ord(g[1]) - ord('A')) * 10 - 90 + int(g[3]) * 1 + 0.5
        return math.radians(lat), math.radians(lon)

    p1 = parse_grid(grid1)
    p2 = parse_grid(grid2)
    if not p1 or not p2:
        return 0, 0

    lat1, lon1 = p1
    lat2, lon2 = p2
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    # Haversine formula
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    dist_km = int(6371 * c)

    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    bearing_deg = int((math.degrees(math.atan2(y, x)) + 360) % 360)

    return dist_km, bearing_deg

class AsyncQsoLogger:
    """
    Thread-safe asynchronous QSO logging daemon.
    Guarantees audio real-time loops are never blocked by disk or database I/O.
    """

    def __init__(
        self,
        my_call: str = PLACEHOLDER_CALLSIGN,
        my_grid: str = "FN31",
        db_path: str = "z30_logbook.db",
        adif_path: str = "z30_station.adi"
    ) -> None:
        self.my_call = my_call.upper()
        self.my_grid = my_grid.upper()
        self.db_path = db_path
        self.adif_path = adif_path
        
        self.queue: queue.Queue[Optional[QsoLogRecord]] = queue.Queue()
        self._init_db()
        
        # Start background worker daemon
        self.worker = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker.start()

    def _init_db(self) -> None:
        """Initializes SQLite table schema with optimized indices."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS qso_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    utc_date TEXT NOT NULL,
                    utc_time TEXT NOT NULL,
                    callsign TEXT NOT NULL,
                    grid TEXT,
                    band TEXT NOT NULL,
                    freq_mhz REAL NOT NULL,
                    mode TEXT DEFAULT 'z-30',
                    submode TEXT DEFAULT '16-MFSK',
                    rst_sent TEXT,
                    rst_rcvd TEXT,
                    distance_km INTEGER,
                    azimuth_deg INTEGER,
                    tx_power_watts INTEGER,
                    my_call TEXT,
                    my_grid TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_call ON qso_records(callsign)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_date ON qso_records(utc_date)')
            conn.commit()

    def log_qso_async(self, record: QsoLogRecord) -> None:
        """Enqueues a QSO record for asynchronous non-blocking storage."""
        now = datetime.now(timezone.utc)
        if not record.utc_date:
            record.utc_date = now.strftime("%Y%m%d")
        if not record.utc_time:
            record.utc_time = now.strftime("%H%M%S")

        # Compute Maidenhead geometry
        if record.grid and self.my_grid:
            dist, az = calculate_maidenhead_distance(self.my_grid, record.grid)
            record.distance_km = dist
            record.azimuth_deg = az

        self.queue.put(record)

    def _worker_loop(self) -> None:
        """Background thread worker processing queued QSOs."""
        while True:
            record = self.queue.get()
            if record is None:
                break

            try:
                self._write_sqlite(record)
                self._append_adif(record)
            except Exception as ex:
                print(f"[AsyncQsoLogger] Error writing QSO log: {ex}")
            finally:
                self.queue.task_done()

    def _write_sqlite(self, record: QsoLogRecord) -> None:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO qso_records (
                    utc_date, utc_time, callsign, grid, band, freq_mhz,
                    mode, submode, rst_sent, rst_rcvd, distance_km, azimuth_deg,
                    tx_power_watts, my_call, my_grid, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                record.utc_date, record.utc_time, record.callsign.upper(), record.grid.upper(),
                record.band, record.freq_mhz, record.mode, record.submode,
                record.rst_sent, record.rst_rcvd, record.distance_km, record.azimuth_deg,
                record.tx_power_watts, self.my_call, self.my_grid, record.notes
            ))
            conn.commit()

    @staticmethod
    def _adif_field(tag: str, value: Any) -> str:
        """
        One ADIF `<TAG:length>value` field, with the length in **bytes**, not characters.

        ADIF counts the octets of the field's data. Python's `len()` on a str counts code
        points, so any non-ASCII character in a name, a QTH or a comment - an accented callsign
        holder's name, a "über" in a note - declared a length shorter than the bytes that
        followed it, and a strict parser resynchronised mid-field and lost the rest of the
        record. `qsoLogger.ts` fixed exactly this on the web-UI side; the legacy Tk path kept
        the bug because the two never shared code.
        """
        text = "" if value is None else str(value)
        return f"<{tag}:{len(text.encode('utf-8'))}>{text}"

    def _append_adif(self, record: QsoLogRecord) -> None:
        """Appends record in standard ADIF 3.1.4 format."""
        file_exists = os.path.exists(self.adif_path)
        with open(self.adif_path, "a", encoding="utf-8") as f:
            if not file_exists:
                # Real newlines. These were "\\n" inside ordinary (non-raw) f-strings, so every
                # header line and every <EOR> wrote the two characters backslash-n and the whole
                # log came out as one physical line - which ADIF readers reject outright.
                f.write("ADIF Export from z-30 DSP Transceiver Suite\n")
                f.write("<ADIF_VER:5>3.1.4\n<PROGRAMID:4>z-30\n<EOH>\n\n")

            fields = [
                self._adif_field("CALL", record.callsign),
                self._adif_field("QSO_DATE", record.utc_date),
                self._adif_field("TIME_ON", record.utc_time),
                self._adif_field("BAND", record.band),
                self._adif_field("FREQ", record.freq_mhz),
                self._adif_field("MODE", record.mode),
                self._adif_field("SUBMODE", record.submode),
                self._adif_field("RST_SENT", record.rst_sent),
                self._adif_field("RST_RCVD", record.rst_rcvd),
                self._adif_field("GRIDSQUARE", record.grid),
                self._adif_field("OPERATOR", self.my_call),
                self._adif_field("MY_GRIDSQUARE", self.my_grid),
                self._adif_field("DISTANCE", record.distance_km),
                self._adif_field("COMMENT", record.notes),
            ]
            f.write(" ".join(fields) + " <EOR>\n")
