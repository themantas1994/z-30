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
    /// Log entries not imported again because an earlier migration already did (idempotence).
    pub log_already_present: usize,
    /// Legacy values dropped from imported entries, with reasons.
    pub log_fields_dropped: Vec<String>,
    /// Files read.
    pub sources: Vec<String>,
}

impl Report {
    /// Human-readable text: what was imported, what was imported with a change, and what was
    /// deliberately not carried over, each with its reason.
    pub fn text(&self) -> String {
        let mut s = String::new();
        s.push_str(&format!(
            "Read: {}\n",
            if self.sources.is_empty() { "(no legacy files found)".into() } else { self.sources.join(", ") }
        ));
        let section = |s: &mut String, title: &str, lines: Vec<String>| {
            if !lines.is_empty() {
                s.push_str(title);
                s.push('\n');
                for l in lines {
                    s.push_str(&format!("  {l}\n"));
                }
            }
        };
        section(
            &mut s,
            "Imported:",
            self.fields.iter().filter_map(|f| if let Outcome::Migrated(n) = f { Some(n.clone()) } else { None }).collect(),
        );
        section(
            &mut s,
            "Imported with a change:",
            self.fields.iter().filter_map(|f| if let Outcome::Changed(n, w) = f { Some(format!("{n}: {w}")) } else { None }).collect(),
        );
        section(
            &mut s,
            "Skipped:",
            self.fields.iter().filter_map(|f| if let Outcome::Skipped(n, w) = f { Some(format!("{n}: {w}")) } else { None }).collect(),
        );
        s.push_str(&format!(
            "Logbook: {} imported (fields marked legacy_import), {} already present, {} skipped\n",
            self.log_imported,
            self.log_already_present,
            self.log_skipped.len()
        ));
        for r in &self.log_skipped {
            s.push_str(&format!("  skipped: {r}\n"));
        }
        for r in &self.log_fields_dropped {
            s.push_str(&format!("  dropped: {r}\n"));
        }
        s
    }
}

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty())
}

const PLACEHOLDERS: [&str; 2] = ["NOCAL", "N0CALL"];

/// How the legacy auto-logger began the notes of every entry it wrote.
const LEGACY_AUTOLOG_NOTE: &str = "z-30 16-MFSK LDPC";
/// The grid it logged when none had been received.
const LEGACY_DEFAULT_GRID: &str = "FN31";
/// The received report it logged when none had been received.
const LEGACY_DEFAULT_RST_RCVD: i8 = -16;
/// The report the legacy ADIF importer (qsoLogger.ts) filled in for a record without one.
const LEGACY_IMPORT_DEFAULT_RST: i8 = -15;
/// The legacy app's per-band default dials (z30Constants.ts HAM_BANDS). Its manual-entry form
/// logged the selected band's default dial as the contact's frequency, and its ADIF importer and
/// exporter used the 20 m one (14.076 MHz) for a record without a frequency: on an entry those
/// wrote, a frequency equal to one of these is a default, not a measurement.
const LEGACY_BAND_DEFAULT_DIALS_HZ: [u64; 13] = [
    1_842_000,
    3_576_000,
    5_359_000,
    7_076_000,
    10_139_000,
    14_076_000,
    18_102_000,
    21_076_000,
    24_917_000,
    28_076_000,
    50_316_000,
    144_176_000,
    432_176_000,
];

/// Which part of the legacy app wrote a logbook.json entry, from its `id` (and, for entries
/// that predate ids, the auto-logger's note).
#[derive(Clone, Copy, Debug, PartialEq)]
enum LegacyOrigin {
    /// `log-*` / the auto-logger note: qsoEngine.ts.
    AutoLogger,
    /// `manual-*`: the logbook's manual-entry form.
    ManualForm,
    /// `import-*`: the legacy app's own ADIF importer.
    AdifImporter,
    /// No id: cannot be told.
    Unknown,
}

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
        // Configuration: the operator's setting in the old app, nothing a radio confirmed.
        cfg.operating.dial_hz = Some(d);
        rep.fields.push(Outcome::Migrated(format!("dial = {d} Hz (configuration)")));
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
    let polarity_high = str_of(&web, "pttPolarity").or_else(|| str_of(&tk, "ptt_polarity")).is_none_or(|p| p != "ACTIVE_LOW");
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
            "legacy RF time offset".into(),
            "an RF-time-sync offset is never carried over: the old sync could \"succeed\" on noise (audit H4); vNext uses the system clock and shows its NTP status".into(),
        ));
    }
    for (keys, what, why) in [
        (
            &["selfTestEnabled", "experimentalUnlocked", "selfTestPreset", "injectTestSignal"][..],
            "synthetic/self-test state",
            "the legacy self-test injected simulated decodes into the live list; vNext has no such mode",
        ),
        (
            &["rfSyncStation", "rfSyncLastResult", "lastSyncOffsetMs", "networkTimeOffsetMs"][..],
            "legacy time-sync results",
            "measurements the legacy time sync could fabricate (audit C-03); never carried over",
        ),
        (
            &["theme", "waterfallPalette", "pwaInstalled", "uiLayout", "updateChannel", "lastUpdateCheck"][..],
            "browser UI settings",
            "settings of the retired browser interface, with no vNext equivalent",
        ),
    ] {
        let found: Vec<&str> = keys.iter().copied().filter(|k| web.get(*k).is_some() || tk.get(*k).is_some()).collect();
        if !found.is_empty() {
            rep.fields.push(Outcome::Skipped(what.into(), format!("{why} ({})", found.join(", "))));
        }
    }
    // Configuration, not a measurement: the TX drive level vNext starts from.
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
            // Out of range is not a report; it used to be clamped to +-99, i.e. changed.
            .filter(|v| (-99.0..=99.0).contains(v))
            .map(|v| Sourced::new(v.round() as i8, Provenance::LegacyImport))
    };
    // Which code wrote the entry decides which of its values can be defaults. On such an entry
    // a value equal to that code's default cannot be told apart from the fabrication, so it is
    // dropped: an absent field is honest, a possibly-invented one is not (audit C-05, N-05).
    //
    // - The auto-logger (qsoEngine.ts) filled a missing grid with FN31 and a missing received
    //   report with -16, logged the computer's LOCAL time labelled UTC, and logged as its
    //   frequency the configured dial PLUS the receive audio offset: neither a dial nor
    //   anything a radio reported.
    // - The manual form defaulted the grid to FN31 when left empty, took its frequency from
    //   the band's default dial, and also logged local time as UTC.
    // - The legacy ADIF importer filled missing reports with -15 and a missing frequency with
    //   14.076 MHz.
    let id = str_of(e, "id").unwrap_or("");
    let origin = if id.starts_with("log-") || str_of(e, "notes").is_some_and(|n| n.starts_with(LEGACY_AUTOLOG_NOTE)) {
        LegacyOrigin::AutoLogger
    } else if id.starts_with("manual-") {
        LegacyOrigin::ManualForm
    } else if id.starts_with("import-") {
        LegacyOrigin::AdifImporter
    } else {
        LegacyOrigin::Unknown
    };
    let mut grid = str_of(e, "grid").map(|g| li(g.to_string()));
    let mut rst_rcvd = rpt("rstRcvd");
    let mut rst_sent = rpt("rstSent");
    let freq_hz = e.get("freqMhz").and_then(|v| v.as_f64()).filter(|f| f.is_finite() && *f > 0.0).map(|f| (f * 1e6).round());
    let mut dial = freq_hz.map(li_f);
    let dropped = |what: String, rep: &mut Report| rep.log_fields_dropped.push(format!("{call} {date} {time}: {what}"));
    let default_grid = grid.as_ref().is_some_and(|g| g.value.eq_ignore_ascii_case(LEGACY_DEFAULT_GRID));
    let band_default_freq = freq_hz.is_some_and(|f| LEGACY_BAND_DEFAULT_DIALS_HZ.contains(&(f as u64)));
    for k in ["rstRcvd", "rstSent"] {
        if let Some(v) = str_of(e, k).and_then(|s| s.trim_start_matches('R').parse::<f64>().ok()).filter(|v| !(-99.0..=99.0).contains(v)) {
            dropped(format!("{k} {v} (not a signal report)"), rep);
        }
    }
    match origin {
        LegacyOrigin::AutoLogger => {
            if default_grid {
                grid = None;
                dropped(format!("grid {LEGACY_DEFAULT_GRID} (the legacy auto-logger's default when no grid was received)"), rep);
            }
            if rst_rcvd.as_ref().is_some_and(|r| r.value == LEGACY_DEFAULT_RST_RCVD) {
                rst_rcvd = None;
                dropped(format!("received report {LEGACY_DEFAULT_RST_RCVD} (the legacy auto-logger's default)"), rep);
            }
            if let Some(f) = dial.take() {
                dropped(
                    format!("frequency {:.6} MHz (the legacy auto-logger's configured dial plus receive audio offset: not a dial, and not read from a radio)", f.value / 1e6),
                    rep,
                );
            }
        }
        LegacyOrigin::ManualForm => {
            if default_grid {
                grid = None;
                dropped(format!("grid {LEGACY_DEFAULT_GRID} (the legacy manual form's default for an empty grid)"), rep);
            }
            if band_default_freq {
                dial = None;
                dropped("frequency (the legacy manual form's default dial for the band)".into(), rep);
            }
        }
        LegacyOrigin::AdifImporter => {
            for (name, r) in [("received", &mut rst_rcvd), ("sent", &mut rst_sent)] {
                if r.as_ref().is_some_and(|v| v.value == LEGACY_IMPORT_DEFAULT_RST) {
                    *r = None;
                    dropped(format!("{name} report {LEGACY_IMPORT_DEFAULT_RST} (the legacy ADIF importer's default)"), rep);
                }
            }
            if freq_hz == Some(14_076_000.0) {
                dial = None;
                dropped("frequency 14.076000 MHz (the legacy ADIF importer's default)".into(), rep);
            }
        }
        LegacyOrigin::Unknown => {}
    }
    let comment = match origin {
        LegacyOrigin::AutoLogger => {
            "imported from the legacy z-30 auto-logger: its time was the computer's LOCAL time labelled UTC, its frequency was not a dial, and its default grid/report were dropped on import (audit C-05); verify before uploading"
        }
        LegacyOrigin::ManualForm => {
            "imported from the legacy z-30 manual entry form: its time was the computer's LOCAL time labelled UTC, and its default grid/frequency were dropped on import (audit C-05); verify before uploading"
        }
        LegacyOrigin::AdifImporter => {
            "imported from the legacy z-30 logbook, which had imported it from ADIF filling missing reports and frequency with defaults (dropped here); verify before uploading"
        }
        LegacyOrigin::Unknown => {
            "imported from the legacy z-30 logbook, whose auto-logger could write local time as UTC and default grid/report values (audit C-05); verify before uploading"
        }
    };
    Some(QsoRecord {
        call,
        grid,
        rst_sent,
        rst_rcvd,
        start_utc: t,
        end_utc: t,
        dial_hz: dial,
        tx_audio_hz: None,
        band: str_of(e, "band").map(str::to_string),
        my_call: str_of(e, "myCall").unwrap_or("").to_string(),
        my_grid: str_of(e, "myGrid").map(str::to_string),
        tx_power_w: e.get("txPowerWatts").and_then(|v| v.as_f64()).map(|p| Sourced::new(p, Provenance::LegacyImport)),
        ap_assisted: false,
        comment: comment.into(),
    })
}

fn li_f(v: f64) -> Sourced<f64> {
    Sourced::new(v, Provenance::LegacyImport)
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
                insert_once(book, &r, rep);
            }
        }
        return;
    }
    if let Ok(text) = std::fs::read_to_string(dir.join("logbook.adi")) {
        rep.sources.push("logbook.adi".into());
        import_adif(&text, book, rep);
    }
}

/// Imports ADIF text (from the legacy app or elsewhere), marking every field legacy. A file the
/// legacy z-30 app exported (`PROGRAMID` z-30) gets that app's default rules: its exporter
/// wrote 14.076 MHz for an entry with no frequency, and its entries may have come from its ADIF
/// importer's -15 defaults or, when the comment carries the auto-logger's note, its auto-logger.
pub fn import_adif(text: &str, book: &mut Logbook, rep: &mut Report) {
    let header = text.find("<EOH>").or_else(|| text.find("<eoh>")).map_or("", |i| &text[..i]);
    let legacy_export = header.to_ascii_lowercase().contains("<programid:4>z-30");
    for f in parse_adif(text) {
        let e = serde_json::json!({
            "id": if legacy_export { "import-legacy-export" } else { "" },
            "notes": f.get("COMMENT"),
            "callsign": f.get("CALL"), "utcDate": f.get("QSO_DATE"), "utcTime": f.get("TIME_ON"),
            "grid": f.get("GRIDSQUARE"), "rstSent": f.get("RST_SENT"), "rstRcvd": f.get("RST_RCVD"),
            "freqMhz": f.get("FREQ").and_then(|s| s.parse::<f64>().ok()), "band": f.get("BAND"),
            "myCall": f.get("STATION_CALLSIGN"), "myGrid": f.get("MY_GRIDSQUARE"),
        });
        if let Some(r) = legacy_record(&e, rep) {
            insert_once(book, &r, rep);
        }
    }
}

/// Inserts a legacy record unless an identical contact (call, start time, frequency) is already
/// in the book, so running the migration twice imports nothing the second time.
fn insert_once(book: &mut Logbook, r: &QsoRecord, rep: &mut Report) {
    match book.contains_contact(&r.call, r.start_utc, r.dial_hz.as_ref().map(|d| d.value)) {
        Ok(true) => rep.log_already_present += 1,
        Ok(false) => match book.insert(r) {
            Ok(_) => rep.log_imported += 1,
            Err(err) => rep.log_skipped.push(format!("{}: {err}", r.call)),
        },
        Err(err) => rep.log_skipped.push(format!("{}: {err}", r.call)),
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
        assert!(rep.fields.iter().any(|f| matches!(f, Outcome::Changed(n, _) if n == "callsign")));
        assert!(rep.fields.iter().any(|f| matches!(f, Outcome::Changed(n, _) if n == "grid")));
        assert_eq!(cfg.ptt, PttConfig::Serial { port: "/dev/ttyUSB1".into(), line: SerialLine::Rts, active_high: false });
        assert_eq!(cfg.rig.rigctld_port, 4532);
        assert!(rep.fields.iter().any(|f| matches!(f, Outcome::Skipped(n, _) if n == "legacy RF time offset")));
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

    #[test]
    fn running_the_migration_twice_changes_nothing_the_second_time() {
        let dir = std::env::temp_dir().join(format!("z30-mig-twice-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("station_config.json"), r#"{"myCall":"G4XYZ","myGrid":"IO91wm","pttMethod":"VOX"}"#).unwrap();
        std::fs::write(
            dir.join("logbook.json"),
            r#"[{"callsign":"K1ABC","utcDate":"2026-09-01","utcTime":"13:52:00","grid":"FN42","rstSent":"-10","rstRcvd":"-12","freqMhz":14.0775},
                {"callsign":"W1AW","utcDate":"2026-09-02","utcTime":"10:00:00","freqMhz":14.0775}]"#,
        )
        .unwrap();
        let mut book = Logbook::in_memory().unwrap();
        let (cfg1, mut rep1) = migrate_config(&dir);
        migrate_logbook(&dir, &mut book, &mut rep1);
        let (cfg2, mut rep2) = migrate_config(&dir);
        migrate_logbook(&dir, &mut book, &mut rep2);
        assert_eq!(cfg1, cfg2, "the configuration is a pure function of the legacy files");
        assert_eq!((rep1.log_imported, rep1.log_already_present), (2, 0));
        assert_eq!((rep2.log_imported, rep2.log_already_present), (0, 2), "{}", rep2.text());
        assert_eq!(book.all().unwrap().len(), 2, "no duplicates");
        assert!(rep2.text().contains("Imported:") && rep2.text().contains("already present"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_legacy_auto_loggers_defaults_and_runtime_state_are_not_migrated() {
        let dir = std::env::temp_dir().join(format!("z30-mig-defaults-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("station_config.json"),
            r#"{"myCall":"G4XYZ","appTimeOffsetMs":29666.24,"selfTestEnabled":true,"theme":"dark","lastSyncOffsetMs":12}"#,
        )
        .unwrap();
        // Auto-logged: FN31 and -16 are exactly the defaults it wrote when nothing was received.
        std::fs::write(
            dir.join("logbook.json"),
            r#"[{"callsign":"K1ABC","utcDate":"2026-09-24","utcTime":"18:05:27","grid":"FN31","rstSent":"-09","rstRcvd":"-16",
                 "freqMhz":14.0775,"notes":"z-30 16-MFSK LDPC / SIC Pass 1","distanceKm":2625},
                {"callsign":"W1AW","utcDate":"2026-09-24","utcTime":"19:00:00","grid":"FN31","rstRcvd":"-16","freqMhz":14.0775}]"#,
        )
        .unwrap();
        let (cfg, mut rep) = migrate_config(&dir);
        assert_eq!(cfg.station.callsign, "G4XYZ");
        let skipped: Vec<&str> =
            rep.fields.iter().filter_map(|f| if let Outcome::Skipped(n, _) = f { Some(n.as_str()) } else { None }).collect();
        for s in ["legacy RF time offset", "synthetic/self-test state", "legacy time-sync results", "browser UI settings"] {
            assert!(skipped.contains(&s), "{s} not reported as skipped: {skipped:?}");
        }
        let mut book = Logbook::in_memory().unwrap();
        migrate_logbook(&dir, &mut book, &mut rep);
        let all = book.all().unwrap();
        let auto = all.iter().find(|r| r.call == "K1ABC").unwrap();
        assert_eq!(auto.grid, None, "FN31 on an auto-logged entry is indistinguishable from the fabricated default");
        assert_eq!(auto.rst_rcvd, None);
        assert_eq!(auto.rst_sent.as_ref().map(|r| r.value), Some(-9), "the report it sent is a real value");
        assert!(auto.comment.contains("LOCAL time"));
        // An entry that does not say what wrote it keeps its values (marked legacy_import).
        let manual = all.iter().find(|r| r.call == "W1AW").unwrap();
        assert_eq!(manual.grid.as_ref().map(|g| g.value.as_str()), Some("FN31"));
        // The auto-logger's frequency was the configured dial plus the receive offset: dropped.
        assert_eq!(auto.dial_hz, None);
        assert_eq!(auto.tx_audio_hz, None);
        assert_eq!(rep.log_fields_dropped.len(), 3, "{:?}", rep.log_fields_dropped);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn each_legacy_writers_defaults_stay_unknown_and_only_those() {
        // C-05 / N-05: by the id the legacy app gave each entry, the manual form's FN31 and band
        // default dial, and the ADIF importer's -15 reports and 14.076 MHz, are dropped. The same
        // values on an entry written by something else are kept.
        let dir = std::env::temp_dir().join(format!("z30-mig-origin-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("logbook.json"),
            r#"[{"id":"manual-1790000000","callsign":"K1ABC","utcDate":"2026-09-20","utcTime":"10:00:00","grid":"FN31","rstSent":"-10","rstRcvd":"-12","freqMhz":7.076,"band":"40m"},
                {"id":"manual-1790000100","callsign":"K2ABC","utcDate":"2026-09-20","utcTime":"10:05:00","grid":"FN20","rstSent":"-10","rstRcvd":"-12","freqMhz":7.0781,"band":"40m"},
                {"id":"import-1790000200-ab12","callsign":"K3ABC","utcDate":"2026-09-20","utcTime":"10:10:00","grid":"FN31","rstSent":"-15","rstRcvd":"-15","freqMhz":14.076},
                {"id":"import-1790000300-cd34","callsign":"K4ABC","utcDate":"2026-09-20","utcTime":"10:15:00","rstSent":"-07","rstRcvd":"-15","freqMhz":14.0786},
                {"id":"log-1790000400","callsign":"K5ABC","utcDate":"2026-09-20","utcTime":"10:20:00","grid":"EM12","rstSent":"-03","rstRcvd":"-16","freqMhz":14.0776,"notes":"z-30 16-MFSK LDPC / SIC Pass 1"},
                {"callsign":"K6ABC","utcDate":"2026-09-20","utcTime":"10:25:00","rstRcvd":"-150","freqMhz":14.076}]"#,
        )
        .unwrap();
        let mut rep = Report::default();
        let mut book = Logbook::in_memory().unwrap();
        migrate_logbook(&dir, &mut book, &mut rep);
        let all = book.all().unwrap();
        let get = |c: &str| all.iter().find(|r| r.call == c).unwrap().clone();
        let li = |v: f64| Some(Sourced::new(v, Provenance::LegacyImport));
        // Manual form: FN31 and the band's default dial are its defaults.
        let r = get("K1ABC");
        assert_eq!((r.grid.clone(), r.dial_hz.clone()), (None, None));
        assert_eq!(r.rst_rcvd.map(|v| v.value), Some(-12));
        assert_eq!(r.band.as_deref(), Some("40m"));
        let r = get("K2ABC");
        assert_eq!(r.grid.map(|g| g.value), Some("FN20".into()));
        assert_eq!(r.dial_hz, li(7_078_100.0));
        // ADIF importer: -15 and 14.076 MHz are its defaults; FN31 is not.
        let r = get("K3ABC");
        assert_eq!((r.rst_sent.clone(), r.rst_rcvd.clone(), r.dial_hz.clone()), (None, None, None));
        assert_eq!(r.grid.map(|g| g.value), Some("FN31".into()));
        let r = get("K4ABC");
        assert_eq!((r.rst_sent.map(|v| v.value), r.rst_rcvd), (Some(-7), None));
        assert_eq!(r.dial_hz, li(14_078_600.0));
        // Auto-logger: -16 and its dial-plus-offset frequency; a received grid is kept.
        let r = get("K5ABC");
        assert_eq!((r.rst_rcvd, r.dial_hz), (None, None));
        assert_eq!(r.grid.map(|g| g.value), Some("EM12".into()));
        // Unknown writer: kept - except a report outside +-99 dB, which is not a report (it
        // used to be clamped to -99, i.e. changed into one).
        let r = get("K6ABC");
        assert_eq!(r.dial_hz, li(14_076_000.0));
        assert_eq!(r.rst_rcvd, None);
        assert_eq!(rep.log_fields_dropped.len(), 9, "{:#?}", rep.log_fields_dropped);
        std::fs::remove_dir_all(dir).ok();
    }
}
