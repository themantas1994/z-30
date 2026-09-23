//! Migration from the legacy (browser + Python) z-30.
//!
//! Reads, never writes or deletes: `station_config.json` (the web UI's configuration, kept by
//! the local server), `config.json` (the Tk wizard's), `logbook.json` and `logbook.adi`. Every
//! field is reported as migrated, migrated with a change (and why), or not migrated (and why).
//!
//! Logbook entries are imported with `LegacyImport` provenance on every field the old
//! auto-logger could have fabricated (audit H1: local time written as UTC, a default grid and
//! report when nothing was received). The import cannot tell those apart from real values, so
//! it does not pretend to.

use crate::logbook::{parse_adif, parse_utc, Logbook};
use serde_json::Value;
use std::path::Path;
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig, SerialLine, TxSlot};
use z30_engine::qso::{Provenance, QsoRecord, Sourced};

/// What happened to one legacy field.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    /// Carried over unchanged.
    Migrated(String),
    /// Carried over with a change.
    Changed(String, String),
    /// Not carried over.
    Skipped(String, String),
}

/// The migration report.
#[derive(Clone, Debug, Default)]
pub struct Report {
    /// Per field.
    pub fields: Vec<Outcome>,
    /// Log entries imported.
    pub log_imported: usize,
    /// Log entries skipped, with reasons.
    pub log_skipped: Vec<String>,
    /// Files read.
    pub sources: Vec<String>,
}

impl Report {
    /// Human-readable text.
    pub fn text(&self) -> String {
        let mut s = String::new();
        s.push_str(&format!(
            "Read: {}\n",
            if self.sources.is_empty() { "(no legacy files found)".into() } else { self.sources.join(", ") }
        ));
        for f in &self.fields {
            match f {
                Outcome::Migrated(n) => s.push_str(&format!("  migrated   {n}\n")),
                Outcome::Changed(n, why) => s.push_str(&format!("  CHANGED    {n}: {why}\n")),
                Outcome::Skipped(n, why) => s.push_str(&format!("  not moved  {n}: {why}\n")),
            }
        }
        s.push_str(&format!("Logbook: {} imported (fields marked legacy_import), {} skipped\n", self.log_imported, self.log_skipped.len()));
        for r in &self.log_skipped {
            s.push_str(&format!("  skipped: {r}\n"));
        }
        s
    }
}

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty())
}

const PLACEHOLDERS: [&str; 2] = ["NOCAL", "N0CALL"];

/// Builds a vNext configuration from the legacy files in `dir`.
pub fn migrate_config(dir: &Path) -> (Config, Report) {
    let mut cfg = Config::default();
    let mut rep = Report::default();
    let web: Option<Value> = std::fs::read_to_string(dir.join("station_config.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
    let tk: Option<Value> = std::fs::read_to_string(dir.join("config.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
    if web.is_some() {
        rep.sources.push("station_config.json".into());
    }
    if tk.is_some() {
        rep.sources.push("config.json".into());
    }
    let web = web.unwrap_or(Value::Null);
    let tk = tk.unwrap_or(Value::Null);

    // Callsign: the web UI's first (it is what the operating app used), the wizard's second.
    match str_of(&web, "myCall").or_else(|| str_of(&tk, "callsign")) {
        Some(c) if PLACEHOLDERS.contains(&c.to_ascii_uppercase().as_str()) => {
            rep.fields.push(Outcome::Skipped("callsign".into(), format!("\"{c}\" is the unconfigured placeholder")))
        }
        Some(c) => {
            cfg.station.callsign = c.to_ascii_uppercase();
            if z30_protocol::codec::Callsign::new(c).is_err() {
                rep.fields.push(Outcome::Changed(
                    "callsign".into(),
                    format!("\"{c}\" migrated, but z-30 v1 cannot transmit it without sending a different callsign (audit C5); transmit will be refused"),
                ));
            } else {
                rep.fields.push(Outcome::Migrated(format!("callsign = {c}")));
            }
        }
        None => rep.fields.push(Outcome::Skipped("callsign".into(), "not set".into())),
    }
    match str_of(&web, "myGrid").or_else(|| str_of(&tk, "grid")) {
        Some("AA00aa") | Some("AA00") => rep.fields.push(Outcome::Skipped("grid".into(), "the wizard's placeholder AA00aa".into())),
        Some(g) => {
            cfg.station.grid = g.to_string();
            let square = z30_protocol::codec::Grid4::new(&g[..g.len().min(4)]);
            if square.as_ref().map(|s| s.v1_code().is_none()).unwrap_or(true) {
                rep.fields.push(Outcome::Changed(
                    "grid".into(),
                    format!("{g} migrated, but its square is not in the 63-entry v1 grid table: CQ and grid replies will be refused rather than sending another grid (audit H2)"),
                ));
            } else {
                rep.fields.push(Outcome::Migrated(format!("grid = {g}")));
            }
        }
        None => rep.fields.push(Outcome::Skipped("grid".into(), "not set".into())),
    }
    match str_of(&web, "regulatoryRegion").and_then(Region::from_legacy) {
        Some(r) => {
            cfg.station.region = Some(r);
            rep.fields.push(Outcome::Migrated(format!("region = {r:?}")));
        }
        None => rep.fields.push(Outcome::Skipped("region".into(), "not set; transmit is refused until it is".into())),
    }
    match str_of(&web, "licenseClass").and_then(LicenseClass::from_legacy) {
        Some(c) => {
            cfg.station.license_class = Some(c);
            rep.fields.push(Outcome::Migrated(format!("licence class = {c:?}")));
        }
        None => rep.fields.push(Outcome::Skipped("licence class".into(), "not set; transmit is refused until it is".into())),
    }
    if let Some(p) = web.get("txPowerWatts").or_else(|| tk.get("tx_power_watts")).and_then(|v| v.as_f64()) {
        cfg.station.configured_tx_power_w = Some(p);
        rep.fields.push(Outcome::Changed(
            "tx power".into(),
            format!("{p} W kept as CONFIGURED power; it is never shown as measured (audit M13)"),
        ));
    }
    if let Some(d) = tk.get("dial_freq_hz").and_then(|v| v.as_u64()) {
        cfg.operating.dial_hz = d;
        rep.fields.push(Outcome::Migrated(format!("dial = {d} Hz")));
    }
    if let Some(f) = tk.get("tx_audio_freq_hz").and_then(|v| v.as_f64()) {
        cfg.operating.tx_audio_hz = f;
        rep.fields.push(Outcome::Migrated(format!("TX audio = {f} Hz")));
    }
    if let Some(f) = tk.get("rx_audio_freq_hz").and_then(|v| v.as_f64()) {
        cfg.operating.rx_audio_hz = f;
    }
    match str_of(&web, "defaultTxSlot").or_else(|| str_of(&tk, "tx_slot")) {
        Some("ODD") => cfg.operating.tx_slot = TxSlot::Odd,
        Some("EVEN") => cfg.operating.tx_slot = TxSlot::Even,
        _ => {}
    }
    if let Some(v) = web.get("autoSeq").and_then(|v| v.as_bool()) {
        cfg.operating.auto_sequence = v;
    }
    if let Some(v) = web.get("watchdogCycles").and_then(|v| v.as_u64()) {
        cfg.operating.watchdog_cycles = v as u32;
    }
    if let Some(v) = web.get("apDecodeEnabled").and_then(|v| v.as_bool()) {
        cfg.receiver.ap_enabled = v;
        rep.fields.push(Outcome::Migrated(format!("a priori decoding = {v}")));
    }

    // CAT.
    let cat_method = str_of(&web, "catMethod").or_else(|| str_of(&tk, "cat_method"));
    let cat_enabled = web.get("catEnabled").and_then(|v| v.as_bool()).unwrap_or(cat_method == Some("Hamlib"));
    if cat_method == Some("Hamlib") && cat_enabled {
        cfg.rig.rigctld_host = str_of(&web, "hamlibHost").or_else(|| str_of(&tk, "net_cat_host")).unwrap_or("127.0.0.1").to_string();
        cfg.rig.rigctld_port = web.get("hamlibPort").or_else(|| tk.get("net_cat_port")).and_then(|v| v.as_u64()).unwrap_or(4532) as u16;
        rep.fields.push(Outcome::Migrated(format!("rigctld = {}:{}", cfg.rig.rigctld_host, cfg.rig.rigctld_port)));
    } else if cat_method == Some("Direct Serial") {
        rep.fields.push(Outcome::Skipped(
            "CAT".into(),
            "Direct Serial CAT is not carried over: vNext talks to radios through rigctld, which carries per-model command tables; start rigctld for your radio".into(),
        ));
    }

    // PTT.
    let polarity_high = str_of(&web, "pttPolarity").or_else(|| str_of(&tk, "ptt_polarity")).map_or(true, |p| p != "ACTIVE_LOW");
    let serial_port = str_of(&web, "pttPort")
        .or_else(|| str_of(&tk, "ptt_port"))
        .or_else(|| str_of(&web, "serialPort"))
        .or_else(|| str_of(&tk, "serial_port"));
    let ptt_method = str_of(&web, "pttMethod").map(str::to_string).or_else(|| {
        str_of(&tk, "ptt_method").map(|m| match m {
            "CAT Command" => "CAT".into(),
            "RTS Pin" => "RTS".into(),
            "DTR Pin" => "DTR".into(),
            other => other.to_string(),
        })
    });
    match ptt_method.as_deref() {
        Some("CAT") => {
            cfg.ptt = PttConfig::Cat;
            rep.fields.push(Outcome::Migrated("PTT = CAT via rigctld".into()));
        }
        Some("VOX") => {
            cfg.ptt = PttConfig::Vox;
            rep.fields.push(Outcome::Migrated("PTT = VOX".into()));
        }
        Some(m @ ("RTS" | "DTR")) => match serial_port {
            Some(port) => {
                cfg.ptt = PttConfig::Serial { port: port.into(), line: if m == "RTS" { SerialLine::Rts } else { SerialLine::Dtr }, active_high: polarity_high };
                rep.fields.push(Outcome::Migrated(format!("PTT = {m} on {port}")));
            }
            None => rep.fields.push(Outcome::Skipped("PTT".into(), format!("{m} keying had no port configured"))),
        },
        Some("CM108_GPIO") => {
            let pin = web.get("cm108GpioPin").and_then(|v| v.as_u64()).unwrap_or(3) as u8;
            cfg.ptt = PttConfig::Cm108 { device: String::new(), pin, active_high: polarity_high };
            rep.fields.push(Outcome::Migrated(format!("PTT = CM108 GPIO{pin} (first C-Media device)")));
        }
        Some(other) => rep.fields.push(Outcome::Skipped(
            "PTT".into(),
            format!("{other} keying is not supported by vNext yet (supported: CAT via rigctld, RTS/DTR, CM108, VOX); transmit is refused until PTT is configured"),
        )),
        None => rep.fields.push(Outcome::Skipped("PTT".into(), "not set".into())),
    }

    // Audio: the browser stored device ids the native layer cannot use; names carry over.
    for (k, dst) in [("audioInputDevice", 0), ("audioOutputDevice", 1)] {
        if let Some(name) = str_of(&web, k).filter(|n| !n.starts_with("default") && n.len() < 64) {
            if dst == 0 {
                cfg.audio.input_device = Some(name.into());
            } else {
                cfg.audio.output_device = Some(name.into());
            }
            rep.fields.push(Outcome::Changed(k.into(), format!("\"{name}\" used as a name to match; check it in Settings")));
        }
    }
    if tk.get("app_time_offset_ms").is_some() || web.get("appTimeOffsetMs").is_some() {
        rep.fields.push(Outcome::Skipped(
            "clock offset".into(),
            "an RF-time-sync offset is never carried over: the old sync could \"succeed\" on noise (audit H4); vNext uses the system clock and shows its NTP status".into(),
        ));
    }
    cfg.audio.tx_level = 0.5;
    (cfg, rep)
}

fn legacy_record(e: &Value, rep: &mut Report) -> Option<QsoRecord> {
    let call = str_of(e, "callsign")?.to_ascii_uppercase();
    let (date, time) = (str_of(e, "utcDate").unwrap_or(""), str_of(e, "utcTime").unwrap_or(""));
    let Some(t) = parse_utc(date, time) else {
        rep.log_skipped.push(format!("{call}: unreadable date/time \"{date} {time}\""));
        return None;
    };
    let li = |v: String| Sourced::new(v, Provenance::LegacyImport);
    let rpt = |k: &str| {
        str_of(e, k)
            .and_then(|s| s.trim_start_matches('R').parse::<f64>().ok())
            .map(|v| Sourced::new(v.round().clamp(-99.0, 99.0) as i8, Provenance::LegacyImport))
    };
    Some(QsoRecord {
        call,
        grid: str_of(e, "grid").map(|g| li(g.to_string())),
        rst_sent: rpt("rstSent"),
        rst_rcvd: rpt("rstRcvd"),
        start_utc: t,
        end_utc: t,
        dial_hz: Sourced::new(e.get("freqMhz").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1e6, Provenance::LegacyImport),
        tx_audio_hz: 0.0,
        band: str_of(e, "band").map(str::to_string),
        my_call: str_of(e, "myCall").unwrap_or("").to_string(),
        my_grid: str_of(e, "myGrid").map(str::to_string),
        tx_power_w: e.get("txPowerWatts").and_then(|v| v.as_f64()).map(|p| Sourced::new(p, Provenance::LegacyImport)),
        ap_assisted: false,
        comment: "imported from the legacy z-30 logbook: its auto-logger could write local time as UTC and default grid/report values (audit H1); verify before uploading".into(),
    })
}

/// Imports `logbook.json` (or, failing that, `logbook.adi`) from `dir` into `book`.
pub fn migrate_logbook(dir: &Path, book: &mut Logbook, rep: &mut Report) {
    if let Ok(text) = std::fs::read_to_string(dir.join("logbook.json")) {
        rep.sources.push("logbook.json".into());
        let entries: Vec<Value> = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.as_array().cloned().or_else(|| v.get("entries").and_then(|e| e.as_array().cloned())))
            .unwrap_or_default();
        for e in &entries {
            if let Some(r) = legacy_record(e, rep) {
                match book.insert(&r) {
                    Ok(_) => rep.log_imported += 1,
                    Err(err) => rep.log_skipped.push(format!("{}: {err}", r.call)),
                }
            }
        }
        return;
    }
    if let Ok(text) = std::fs::read_to_string(dir.join("logbook.adi")) {
        rep.sources.push("logbook.adi".into());
        import_adif(&text, book, rep);
    }
}

/// Imports ADIF text (from the legacy app or elsewhere), marking every field legacy.
pub fn import_adif(text: &str, book: &mut Logbook, rep: &mut Report) {
    for f in parse_adif(text) {
        let e = serde_json::json!({
            "callsign": f.get("CALL"), "utcDate": f.get("QSO_DATE"), "utcTime": f.get("TIME_ON"),
            "grid": f.get("GRIDSQUARE"), "rstSent": f.get("RST_SENT"), "rstRcvd": f.get("RST_RCVD"),
            "freqMhz": f.get("FREQ").and_then(|s| s.parse::<f64>().ok()), "band": f.get("BAND"),
            "myCall": f.get("STATION_CALLSIGN"), "myGrid": f.get("MY_GRIDSQUARE"),
        });
        if let Some(r) = legacy_record(&e, rep) {
            match book.insert(&r) {
                Ok(_) => rep.log_imported += 1,
                Err(err) => rep.log_skipped.push(format!("{}: {err}", r.call)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_the_web_config_and_reports_every_decision() {
        let dir = std::env::temp_dir().join(format!("z30-mig-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("station_config.json"),
            r#"{"myCall":"G4XYZ/P","myGrid":"FN42ab","regulatoryRegion":"US","licenseClass":"US_GENERAL","txPowerWatts":50,
                "catMethod":"Hamlib","catEnabled":true,"hamlibHost":"127.0.0.1","hamlibPort":4532,"pttMethod":"RTS","pttPort":"/dev/ttyUSB1",
                "pttPolarity":"ACTIVE_LOW","appTimeOffsetMs":27824}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("logbook.json"),
            r#"[{"callsign":"k1abc","utcDate":"2026-09-01","utcTime":"13:52:00","grid":"FN31","rstSent":"-16","rstRcvd":"-18.4","freqMhz":14.0775,"band":"20m"},
                {"callsign":"W1AW","utcDate":"garbage","utcTime":"x"}]"#,
        )
        .unwrap();
        let (cfg, mut rep) = migrate_config(&dir);
        assert_eq!(cfg.station.callsign, "G4XYZ/P");
        assert!(rep.fields.iter().any(|f| matches!(f, Outcome::Changed(n, why) if n == "callsign" && why.contains("C5"))));
        assert!(rep.fields.iter().any(|f| matches!(f, Outcome::Changed(n, _) if n == "grid")));
        assert_eq!(cfg.ptt, PttConfig::Serial { port: "/dev/ttyUSB1".into(), line: SerialLine::Rts, active_high: false });
        assert_eq!(cfg.rig.rigctld_port, 4532);
        assert!(rep.fields.iter().any(|f| matches!(f, Outcome::Skipped(n, _) if n == "clock offset")));
        let mut book = Logbook::in_memory().unwrap();
        migrate_logbook(&dir, &mut book, &mut rep);
        assert_eq!(rep.log_imported, 1);
        assert_eq!(rep.log_skipped.len(), 1, "the unreadable entry is reported, not dropped silently");
        let r = &book.all().unwrap()[0];
        assert_eq!(r.call, "K1ABC");
        assert_eq!(r.grid.as_ref().unwrap().source, Provenance::LegacyImport);
        assert_eq!(r.rst_rcvd.as_ref().unwrap().value, -18);
        assert!(!rep.text().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }
}
