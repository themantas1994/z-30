//! The logbook writes what the contact record holds and nothing else, in UTC whatever the
//! machine's time zone (2026-09-24 audit, C-05: the legacy logger wrote local time as UTC).

use z30_engine::qso::{Provenance, QsoRecord, Sourced};
use z30_io::logbook::{parse_adif, to_adif, utc_parts, Logbook};

fn record(start: f64) -> QsoRecord {
    QsoRecord {
        call: "K1ABC".into(),
        grid: None,
        rst_sent: Some(Sourced::new(-9, Provenance::Sent)),
        rst_rcvd: None,
        start_utc: start,
        end_utc: start + 84.0,
        dial_hz: Sourced::new(14_076_000.0, Provenance::Commanded),
        tx_audio_hz: 1200.0,
        band: Some("20m".into()),
        my_call: "G4XYZ".into(),
        my_grid: None,
        tx_power_w: None,
        ap_assisted: false,
        comment: String::new(),
    }
}

#[test]
fn utc_in_the_log_does_not_depend_on_the_local_time_zone() {
    // 2026-09-24T01:05:30Z - the audit's reproduction was TZ=America/Los_Angeles at this time,
    // where the legacy logger wrote 18:05:27 on the UTC date.
    let t = 1_790_211_930.0;
    let want = ("20260924".to_string(), "010530".to_string());
    for tz in ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Chatham"] {
        // SAFETY (edition 2021: not unsafe): tests in this binary do not read TZ concurrently
        // except through the code under test, which must not read it at all.
        std::env::set_var("TZ", tz);
        assert_eq!(utc_parts(t), want, "TZ={tz}");
        let adif = to_adif(&[record(t)]);
        let f = &parse_adif(&adif)[0];
        assert_eq!((f["QSO_DATE"].as_str(), f["TIME_ON"].as_str()), ("20260924", "010530"), "TZ={tz}");
    }
    std::env::remove_var("TZ");
}

#[test]
fn missing_fields_stay_missing_in_sqlite_and_adif() {
    let mut lb = Logbook::in_memory().unwrap();
    let r = record(1_790_211_930.0);
    lb.insert(&r).unwrap();
    let back = &lb.all().unwrap()[0];
    assert_eq!(back.grid, None);
    assert_eq!(back.rst_rcvd, None);
    assert_eq!(back.tx_power_w, None);
    let f = &parse_adif(&lb.export_adif().unwrap())[0];
    for absent in ["GRIDSQUARE", "RST_RCVD", "TX_PWR", "DISTANCE", "MY_GRIDSQUARE"] {
        assert!(!f.contains_key(absent), "{absent} written although nothing supplied it");
    }
    assert_eq!(f["RST_SENT"], "-09");
    assert!(f["APP_Z30_PROVENANCE"].contains("FREQ=commanded"), "an unverified dial is labelled as commanded");
}

#[test]
fn a_record_describing_no_contact_is_not_written() {
    let mut lb = Logbook::in_memory().unwrap();
    let mut r = record(1_790_211_930.0);
    r.call.clear();
    assert!(lb.insert(&r).is_err());
    let mut r = record(3_600.0);
    r.call = "K1ABC".into();
    assert!(lb.insert(&r).is_err(), "1970 is not a z-30 contact time");
    assert!(lb.all().unwrap().is_empty());
}

#[test]
fn adif_is_well_formed() {
    let a = to_adif(&[record(1_790_211_930.0), record(1_790_212_930.0)]);
    assert!(a.contains("<ADIF_VER:5>3.1.4") && a.contains("<EOH>"));
    // Every length prefix matches its value's byte length.
    let body = &a[a.find("<EOH>").unwrap() + 5..];
    let mut i = 0;
    while let Some(off) = body[i..].find('<') {
        let start = i + off + 1;
        let end = start + body[start..].find('>').unwrap();
        let tag = &body[start..end];
        i = end + 1;
        if let Some((_, len)) = tag.split_once(':') {
            let len: usize = len.parse().unwrap();
            let value = &body[i..i + len];
            assert!(!value.contains('<'), "field {tag} overruns into the next tag");
            i += len;
        }
    }
    assert_eq!(parse_adif(&a).len(), 2);
}
