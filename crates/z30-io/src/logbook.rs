//! The logbook: SQLite storage with per-field provenance, ADIF 3.1.4 export and import.
//!
//! Replaces the browser logbook, whose auto-logger wrote local time as UTC and a default grid,
//! report and distance when nothing had been received (audit H1). A record here holds exactly
//! what `z30_engine::qso::QsoRecord` holds - absent fields stay absent - and each value keeps
//! the provenance the engine gave it.
//!
//! ADIF has no z-30 mode. Records are written as `MODE=MFSK` with the application field
//! `APP_Z30_MODE=Z30`; `SUBMODE` is not written because ADIF's submode list does not contain
//! z-30 and inventing an enumeration value would make the file invalid.

use rusqlite::{params, Connection};
use z30_engine::qso::{Provenance, QsoRecord, Sourced};
use z30_engine::runtime::LogSink;

/// A SQLite logbook.
pub struct Logbook {
    db: Connection,
}

fn prov_str(p: Provenance) -> &'static str {
    match p {
        Provenance::Received => "received",
        Provenance::Measured => "measured",
        Provenance::Sent => "sent",
        Provenance::RigVerified => "rig_verified",
        Provenance::Commanded => "commanded",
        Provenance::Configured => "configured",
        Provenance::LegacyImport => "legacy_import",
        Provenance::Manual => "manual",
    }
}

fn prov_parse(s: &str) -> Provenance {
    match s {
        "received" => Provenance::Received,
        "measured" => Provenance::Measured,
        "sent" => Provenance::Sent,
        "rig_verified" => Provenance::RigVerified,
        "commanded" => Provenance::Commanded,
        "configured" => Provenance::Configured,
        "manual" => Provenance::Manual,
        _ => Provenance::LegacyImport,
    }
}

impl Logbook {
    /// Opens (creating if needed) the logbook at `path`.
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        Self::init(db)
    }

    /// An in-memory logbook (tests, dry runs).
    pub fn in_memory() -> Result<Self, String> {
        Self::init(Connection::open_in_memory().map_err(|e| e.to_string())?)
    }

    fn init(db: Connection) -> Result<Self, String> {
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS qso (
               id INTEGER PRIMARY KEY,
               call TEXT NOT NULL,
               grid TEXT, grid_src TEXT,
               rst_sent INTEGER, rst_sent_src TEXT,
               rst_rcvd INTEGER, rst_rcvd_src TEXT,
               start_utc REAL NOT NULL, end_utc REAL NOT NULL,
               dial_hz REAL NOT NULL, dial_src TEXT NOT NULL,
               tx_audio_hz REAL NOT NULL,
               band TEXT,
               my_call TEXT NOT NULL, my_grid TEXT,
               tx_power_w REAL, tx_power_src TEXT,
               ap_assisted INTEGER NOT NULL,
               comment TEXT NOT NULL DEFAULT ''
             );
             CREATE INDEX IF NOT EXISTS qso_call ON qso(call);
             CREATE INDEX IF NOT EXISTS qso_start ON qso(start_utc);",
        )
        .map_err(|e| e.to_string())?;
        Ok(Logbook { db })
    }

    /// Inserts a record. Refuses one that describes no contact (`QsoRecord::validate`).
    pub fn insert(&mut self, r: &QsoRecord) -> Result<i64, String> {
        r.validate()?;
        self.db
            .execute(
                "INSERT INTO qso (call, grid, grid_src, rst_sent, rst_sent_src, rst_rcvd, rst_rcvd_src, start_utc, end_utc,
                                  dial_hz, dial_src, tx_audio_hz, band, my_call, my_grid, tx_power_w, tx_power_src, ap_assisted, comment)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                params![
                    r.call,
                    r.grid.as_ref().map(|g| g.value.clone()),
                    r.grid.as_ref().map(|g| prov_str(g.source)),
                    r.rst_sent.as_ref().map(|v| v.value as i64),
                    r.rst_sent.as_ref().map(|v| prov_str(v.source)),
                    r.rst_rcvd.as_ref().map(|v| v.value as i64),
                    r.rst_rcvd.as_ref().map(|v| prov_str(v.source)),
                    r.start_utc,
                    r.end_utc,
                    r.dial_hz.value,
                    prov_str(r.dial_hz.source),
                    r.tx_audio_hz,
                    r.band,
                    r.my_call,
                    r.my_grid,
                    r.tx_power_w.as_ref().map(|v| v.value),
                    r.tx_power_w.as_ref().map(|v| prov_str(v.source)),
                    r.ap_assisted as i64,
                    r.comment,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.db.last_insert_rowid())
    }

    /// All records, oldest first.
    pub fn all(&self) -> Result<Vec<QsoRecord>, String> {
        let mut st = self
            .db
            .prepare(
                "SELECT call, grid, grid_src, rst_sent, rst_sent_src, rst_rcvd, rst_rcvd_src, start_utc, end_utc, dial_hz, dial_src,
                        tx_audio_hz, band, my_call, my_grid, tx_power_w, tx_power_src, ap_assisted, comment FROM qso ORDER BY start_utc, id",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |row| {
                let src =
                    |i: usize| -> rusqlite::Result<Provenance> { Ok(prov_parse(&row.get::<_, Option<String>>(i)?.unwrap_or_default())) };
                Ok(QsoRecord {
                    call: row.get(0)?,
                    grid: row.get::<_, Option<String>>(1)?.map(|g| Sourced::new(g, Provenance::Received)).map(|mut g| {
                        g.source = src(2).unwrap_or(Provenance::LegacyImport);
                        g
                    }),
                    rst_sent: row.get::<_, Option<i64>>(3)?.map(|v| Sourced::new(v as i8, src(4).unwrap_or(Provenance::LegacyImport))),
                    rst_rcvd: row.get::<_, Option<i64>>(5)?.map(|v| Sourced::new(v as i8, src(6).unwrap_or(Provenance::LegacyImport))),
                    start_utc: row.get(7)?,
                    end_utc: row.get(8)?,
                    dial_hz: Sourced::new(row.get(9)?, src(10)?),
                    tx_audio_hz: row.get(11)?,
                    band: row.get(12)?,
                    my_call: row.get(13)?,
                    my_grid: row.get(14)?,
                    tx_power_w: row.get::<_, Option<f64>>(15)?.map(|v| Sourced::new(v, src(16).unwrap_or(Provenance::Configured))),
                    ap_assisted: row.get::<_, i64>(17)? != 0,
                    comment: row.get(18)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Whether a contact with this callsign, start time and dial frequency is already logged.
    pub fn contains_contact(&self, call: &str, start_utc: f64, dial_hz: f64) -> Result<bool, String> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM qso WHERE call = ?1 AND abs(start_utc - ?2) < 0.5 AND abs(dial_hz - ?3) < 1.0)",
                params![call, start_utc, dial_hz],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())
    }

    /// The whole log as ADIF.
    pub fn export_adif(&self) -> Result<String, String> {
        Ok(to_adif(&self.all()?))
    }
}

impl LogSink for Logbook {
    fn log(&mut self, rec: &QsoRecord) -> Result<(), String> {
        self.insert(rec).map(|_| ())
    }
}

/// Days-from-civil (Howard Hinnant's algorithm): UTC date and time strings for a Unix time.
pub fn utc_parts(t: f64) -> (String, String) {
    let secs = t.floor() as i64;
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (format!("{y:04}{m:02}{d:02}"), format!("{:02}{:02}{:02}", sod / 3600, (sod / 60) % 60, sod % 60))
}

/// Inverse of `utc_parts` (YYYYMMDD, HHMMSS or HHMM).
pub fn parse_utc(date: &str, time: &str) -> Option<f64> {
    let d: String = date.chars().filter(|c| c.is_ascii_digit()).collect();
    let t: String = time.chars().filter(|c| c.is_ascii_digit()).collect();
    if d.len() != 8 || !(t.len() == 4 || t.len() == 6) {
        return None;
    }
    let (y, m, dd): (i64, i64, i64) = (d[..4].parse().ok()?, d[4..6].parse().ok()?, d[6..8].parse().ok()?);
    let (hh, mm): (i64, i64) = (t[..2].parse().ok()?, t[2..4].parse().ok()?);
    let ss: i64 = if t.len() == 6 { t[4..6].parse().ok()? } else { 0 };
    if !(1..=12).contains(&m) || !(1..=31).contains(&dd) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + dd - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86_400 + hh * 3600 + mm * 60 + ss) as f64)
}

fn field(out: &mut String, name: &str, value: &str) {
    if !value.is_empty() {
        out.push_str(&format!("<{}:{}>{} ", name, value.len(), value));
    }
}

/// ADIF 3.1.4 for records. Provenance travels in `APP_Z30_PROVENANCE` so an importer that
/// understands it can tell a received grid from a legacy one.
pub fn to_adif(records: &[QsoRecord]) -> String {
    let mut out = String::from("z-30 vNext logbook export\n<ADIF_VER:5>3.1.4 <PROGRAMID:5>z30vN <EOH>\n");
    for r in records {
        let (d0, t0) = utc_parts(r.start_utc);
        let (d1, t1) = utc_parts(r.end_utc);
        field(&mut out, "CALL", &r.call);
        field(&mut out, "QSO_DATE", &d0);
        field(&mut out, "TIME_ON", &t0);
        field(&mut out, "QSO_DATE_OFF", &d1);
        field(&mut out, "TIME_OFF", &t1);
        field(&mut out, "MODE", "MFSK");
        field(&mut out, "APP_Z30_MODE", "Z30");
        if let Some(b) = &r.band {
            field(&mut out, "BAND", &b.to_ascii_lowercase());
        }
        field(&mut out, "FREQ", &format!("{:.6}", (r.dial_hz.value + r.tx_audio_hz) / 1e6));
        if let Some(g) = &r.grid {
            field(&mut out, "GRIDSQUARE", &g.value);
        }
        if let Some(v) = &r.rst_sent {
            field(&mut out, "RST_SENT", &format!("{:+03}", v.value));
        }
        if let Some(v) = &r.rst_rcvd {
            field(&mut out, "RST_RCVD", &format!("{:+03}", v.value));
        }
        field(&mut out, "STATION_CALLSIGN", &r.my_call);
        if let Some(g) = &r.my_grid {
            field(&mut out, "MY_GRIDSQUARE", g);
        }
        if let Some(p) = &r.tx_power_w {
            field(&mut out, "TX_PWR", &format!("{}", p.value));
        }
        let mut prov = vec![format!("FREQ={}", prov_str(r.dial_hz.source))];
        if let Some(g) = &r.grid {
            prov.push(format!("GRIDSQUARE={}", prov_str(g.source)));
        }
        if let Some(v) = &r.rst_rcvd {
            prov.push(format!("RST_RCVD={}", prov_str(v.source)));
        }
        if let Some(v) = &r.rst_sent {
            prov.push(format!("RST_SENT={}", prov_str(v.source)));
        }
        if let Some(p) = &r.tx_power_w {
            prov.push(format!("TX_PWR={}", prov_str(p.source)));
        }
        if r.ap_assisted {
            prov.push("AP=1".into());
        }
        field(&mut out, "APP_Z30_PROVENANCE", &prov.join(";"));
        field(&mut out, "COMMENT", &r.comment);
        out.push_str("<EOR>\n");
    }
    out
}

/// Parses ADIF into field maps (upper-case names), one per record.
pub fn parse_adif(text: &str) -> Vec<std::collections::HashMap<String, String>> {
    let mut records = Vec::new();
    let body = match text.find("<EOH>").or_else(|| text.find("<eoh>")) {
        Some(i) => &text[i + 5..],
        None if text.trim_start().starts_with('<') => text,
        None => return records,
    };
    let mut cur = std::collections::HashMap::new();
    let b = body.as_bytes();
    let mut i = 0;
    while let Some(off) = body[i..].find('<') {
        let start = i + off + 1;
        let Some(end_off) = body[start..].find('>') else { break };
        let tag = &body[start..start + end_off];
        i = start + end_off + 1;
        let mut parts = tag.split(':');
        let name = parts.next().unwrap_or("").to_ascii_uppercase();
        if name == "EOR" {
            records.push(std::mem::take(&mut cur));
            continue;
        }
        let Some(len) = parts.next().and_then(|l| l.parse::<usize>().ok()) else { continue };
        let end = (i + len).min(b.len());
        // ADIF lengths are in bytes; the value may not be valid UTF-8 at arbitrary cuts.
        let value = String::from_utf8_lossy(&b[i..end]).into_owned();
        cur.insert(name, value);
        i = end;
    }
    records
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec() -> QsoRecord {
        QsoRecord {
            call: "K1ABC".into(),
            grid: Some(Sourced::new("FN31".into(), Provenance::Received)),
            rst_sent: Some(Sourced::new(-14, Provenance::Sent)),
            rst_rcvd: None,
            start_utc: 1_790_000_010.0,
            end_utc: 1_790_000_184.0,
            dial_hz: Sourced::new(14_076_000.0, Provenance::RigVerified),
            tx_audio_hz: 1400.0,
            band: Some("20m".into()),
            my_call: "G4XYZ".into(),
            my_grid: Some("IO91".into()),
            tx_power_w: Some(Sourced::new(25.0, Provenance::Configured)),
            ap_assisted: false,
            comment: String::new(),
        }
    }

    #[test]
    fn utc_is_utc() {
        // 2026-09-21T14:13:30Z = 1790000010 (checked with Python datetime).
        assert_eq!(utc_parts(1_790_000_010.0), ("20260921".into(), "141330".into()));
        assert_eq!(parse_utc("20260921", "141330"), Some(1_790_000_010.0));
        assert_eq!(utc_parts(0.0), ("19700101".into(), "000000".into()));
    }

    #[test]
    fn sqlite_round_trip_keeps_absent_fields_absent_and_provenance() {
        let mut lb = Logbook::in_memory().unwrap();
        lb.insert(&rec()).unwrap();
        let all = lb.all().unwrap();
        assert_eq!(all, vec![rec()]);
        assert!(all[0].rst_rcvd.is_none(), "nothing received means nothing logged");
    }

    #[test]
    fn adif_carries_only_what_exists() {
        let a = to_adif(&[rec()]);
        assert!(a.contains("<CALL:5>K1ABC"));
        assert!(a.contains("<QSO_DATE:8>20260921"));
        assert!(a.contains("<GRIDSQUARE:4>FN31"));
        assert!(!a.contains("RST_RCVD:"), "no report was received, so none is written");
        assert!(a.contains("<MODE:4>MFSK"));
        let parsed = parse_adif(&a);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["CALL"], "K1ABC");
        assert_eq!(parsed[0]["FREQ"], "14.077400");
    }
}
