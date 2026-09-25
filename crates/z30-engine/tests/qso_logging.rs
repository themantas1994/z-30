//! What a completed contact puts in the log, and what it never does (2026-09-24 audit, C-05).
//!
//! The legacy auto-logger wrote local time labelled UTC, the grid FN31 when none was received,
//! the report -16 when none was received, and a distance computed from the default grid EM00.
//! These drive the vNext sequencer through complete and incomplete exchanges and check every
//! field of the record against what was actually received, sent and measured.
#![allow(clippy::field_reassign_with_default)]

use z30_dsp::ldpc::DecodeMethod;
use z30_dsp::slot::Decode;
use z30_dsp::slot::SlotReport;
use z30_engine::api::{Command, Event};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig};
use z30_engine::engine::Engine;
use z30_engine::qso::{Provenance, QsoNote, QsoRecord, Sequencer, Sourced};
use z30_engine::slots::slot_start;
use z30_protocol::codec::{Callsign, Message};

fn decode(text: &str, snr: Option<f64>) -> Decode {
    let m = Message::parse(text).unwrap();
    let enc = m.encode().unwrap();
    Decode {
        message: z30_protocol::codec::unpack_info(&enc.info).unwrap(),
        info: enc.info,
        snr_db: snr,
        dt_sec: 0.1,
        freq_hz: 1200.0,
        drift_hz: 0.0,
        sync: 5.0,
        iterations: 3,
        method: DecodeMethod::BeliefPropagation(1),
        ap_type: 0,
        pass: 1,
    }
}

const SLOT: i64 = 59_666_800; // 2026-09-21

fn complete(notes: Vec<QsoNote>) -> Option<QsoRecord> {
    notes.into_iter().find_map(|n| if let QsoNote::Complete(r) = n { Some(*r) } else { None })
}

#[test]
fn a_contact_with_no_grid_received_logs_no_grid_and_real_utc() {
    // They answered our CQ with a report (skipping the grid): there is no grid to log.
    let mut seq = Sequencer::new(Callsign::new("G4XYZ").unwrap(), "IO91wm", 6);
    seq.call_cq().unwrap();
    seq.on_decodes(&[decode("G4XYZ K1ABC -12", Some(-9.6))], SLOT);
    assert_eq!(seq.next_message().unwrap().to_string(), "K1ABC G4XYZ -10", "our report is our measurement of them");
    seq.on_transmitted(SLOT + 1);
    let notes = seq.on_decodes(&[decode("G4XYZ K1ABC 73", Some(-11.0))], SLOT + 2);
    let rec = complete(notes).expect("they signed: the contact is complete");
    assert_eq!(rec.call, "K1ABC");
    assert_eq!(rec.grid, None, "no grid was received, so none is logged (legacy: FN31)");
    assert_eq!(rec.rst_rcvd, Some(Sourced::new(-12, Provenance::Received)));
    assert_eq!(rec.rst_sent, Some(Sourced::new(-10, Provenance::Sent)));
    assert_eq!(rec.start_utc, slot_start(SLOT));
    assert!(rec.validate().is_ok());
}

#[test]
fn no_measured_snr_means_no_report_is_sent_and_none_is_logged() {
    let mut seq = Sequencer::new(Callsign::new("G4XYZ").unwrap(), "IO91wm", 6);
    seq.call_cq().unwrap();
    seq.on_decodes(&[decode("G4XYZ K1ABC FN31", None)], SLOT);
    // Answered, but with no signal estimate there is no report to send - and no default.
    assert_eq!(seq.next_message(), None);
}

#[test]
fn an_exchange_that_never_completes_logs_nothing() {
    let mut cfg = Config::default();
    cfg.station.callsign = "G4XYZ".into();
    cfg.station.grid = "IO91wm".into();
    cfg.station.region = Some(Region::IaruR1);
    cfg.station.license_class = Some(LicenseClass::Full);
    cfg.ptt = PttConfig::Vox;
    let mut e = Engine::new(cfg);
    e.apply(Command::CallCq, 0);
    let report = |d: Decode| SlotReport { decodes: vec![d], ..Default::default() };
    e.on_slot_report(SLOT, &report(decode("G4XYZ K1ABC FN31", Some(-14.2))), slot_start(SLOT) + 26.0, 0);
    // Incomplete, garbled and unrelated traffic: none of it completes a contact.
    e.on_slot_report(SLOT + 2, &report(decode("G4XYZ W1AW -05", Some(-3.0))), slot_start(SLOT + 2) + 26.0, 0);
    e.on_slot_report(SLOT + 4, &report(decode("K1AB G4XYZ 73", Some(-3.0))), slot_start(SLOT + 4) + 26.0, 0);
    e.on_slot_report(SLOT + 6, &report(decode("CQ K1ABC FN31", Some(-3.0))), slot_start(SLOT + 6) + 26.0, 0);
    assert!(!e.take_events().iter().any(|ev| matches!(ev, Event::Logged(_))), "nothing completed, nothing logged");
}

#[test]
fn a_record_without_a_partner_or_a_real_utc_time_is_refused() {
    let good = QsoRecord {
        call: "K1ABC".into(),
        grid: None,
        rst_sent: None,
        rst_rcvd: None,
        start_utc: slot_start(SLOT),
        end_utc: slot_start(SLOT) + 84.0,
        dial_hz: Some(Sourced::new(14_076_000.0, Provenance::Commanded)),
        tx_audio_hz: Some(1200.0),
        band: None,
        my_call: "G4XYZ".into(),
        my_grid: None,
        tx_power_w: None,
        ap_assisted: false,
        comment: String::new(),
    };
    assert!(good.validate().is_ok());
    let mut no_call = good.clone();
    no_call.call = String::new();
    assert!(no_call.validate().is_err());
    // Seconds-of-day or a local time mistaken for an epoch time, not a UTC instant.
    let mut not_utc = good.clone();
    not_utc.start_utc = 18.0 * 3600.0 + 5.0 * 60.0;
    assert!(not_utc.validate().is_err());
    let mut backwards = good;
    backwards.end_utc = backwards.start_utc - 1.0;
    assert!(backwards.validate().is_err());
}
