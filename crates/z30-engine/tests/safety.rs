//! Transmit safety, ported scenario by scenario from the TypeScript suites
//! (tests/transmitPath.test.mjs, tests/rigReadback.test.mjs, tests/rigProbeAndWatchdog.test.mjs)
//! plus the audit's C5. If one of these fails, the change is wrong - do not edit the test.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use z30_engine::bandplan::{is_valid_callsign, LicenseClass, Region};
use z30_engine::config::StationConfig;
use z30_engine::ptt::*;
use z30_engine::rig::*;
use z30_engine::txgate::{can_transmit, TxRequest, Violation};
use z30_protocol::codec::{Callsign, Extra, Message};

// ------------------------------------------------------------------------------------ helpers

fn station(call: &str) -> StationConfig {
    StationConfig { callsign: call.into(), grid: "FN31pr".into(), region: Some(Region::Us), license_class: Some(LicenseClass::UsGeneral), configured_tx_power_w: None }
}

fn gate(st: &StationConfig, dial: f64, audio: f64, rig: &RigStateTracker, now: u64) -> z30_engine::txgate::Permission {
    can_transmit(&TxRequest { station: st, dial_hz: dial, tx_audio_hz: audio, message: None }, rig, now)
}

#[derive(Clone, Default)]
struct VirtualClock(Arc<AtomicU64>);

impl VirtualClock {
    fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}

impl MonotonicClock for VirtualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// A line that records what was driven on it, identified by `name`.
struct RecordingLine {
    name: &'static str,
    log: Arc<Mutex<Vec<(&'static str, bool)>>>,
    fail_key: bool,
}

impl PttLine for RecordingLine {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.log.lock().unwrap().push((self.name, keyed));
        if keyed && self.fail_key {
            Err(PttError("hardware refused".into()))
        } else {
            Ok(PttAck::Confirmed)
        }
    }

    fn describe(&self) -> String {
        self.name.into()
    }
}

fn line(name: &'static str, log: &Arc<Mutex<Vec<(&'static str, bool)>>>) -> Box<dyn PttLine> {
    Box::new(RecordingLine { name, log: log.clone(), fail_key: false })
}

// ------------------------------------------------------------------ G: the gate's own conditions

#[test]
fn g1_unconfigured_placeholder_and_malformed_callsigns_are_refused_with_the_right_reason() {
    let rig = RigStateTracker::new();
    assert!(gate(&station(""), 14_076_000.0, 1500.0, &rig, 0).violations.contains(&Violation::NoCallsign));
    assert!(gate(&station("NOCAL"), 14_076_000.0, 1500.0, &rig, 0).violations.contains(&Violation::PlaceholderCallsign));
    let p = gate(&station("HELLO"), 14_076_000.0, 1500.0, &rig, 0);
    assert!(matches!(p.violations[0], Violation::MalformedCallsign(_)));
    assert!(gate(&station("K1ABC"), 14_076_000.0, 1500.0, &rig, 0).allowed);
}

#[test]
fn c5_callsigns_v1_would_transmit_as_another_station_are_refused() {
    let rig = RigStateTracker::new();
    for call in ["ZY2ABC", "G4XYZ/P", "EA8/G4XYZ", "3DA0XYZ", "K1ABCD"] {
        let p = gate(&station(call), 14_076_000.0, 1500.0, &rig, 0);
        assert!(!p.allowed, "{call}");
        assert!(p.violations.iter().any(|v| matches!(v, Violation::CallsignNotRepresentable(..))), "{call}: {:?}", p.violations);
    }
    for call in ["K1ABC", "W1AW", "G4XYZ", "VK2ABC", "ZS6ABC", "ZU1AB", "9A1AA"] {
        assert!(gate(&station(call), 14_076_000.0, 1500.0, &rig, 0).allowed, "{call}");
    }
}

#[test]
fn g2_region_and_class_are_required_and_must_match() {
    let rig = RigStateTracker::new();
    let mut st = station("K1ABC");
    st.region = None;
    assert!(gate(&st, 14_076_000.0, 1500.0, &rig, 0).violations.contains(&Violation::NoRegion));
    let mut st = station("K1ABC");
    st.license_class = None;
    assert!(gate(&st, 14_076_000.0, 1500.0, &rig, 0).violations.contains(&Violation::NoLicenseClass));
    let mut st = station("K1ABC");
    st.region = Some(Region::IaruR1);
    assert!(gate(&st, 14_076_000.0, 1500.0, &rig, 0).violations.contains(&Violation::ClassNotInRegion));
}

#[test]
fn g3_the_radiated_emission_not_the_dial_is_checked_at_its_edges() {
    let rig = RigStateTracker::new();
    let st = station("K1ABC");
    // Dial inside 20 m, but dial + audio + span pushes the emission over the 14.150 edge.
    assert!(!gate(&st, 14_148_000.0, 2000.0, &rig, 0).allowed);
    assert!(gate(&st, 14_146_000.0, 1500.0, &rig, 0).allowed);
    // US General in the Extra-only bottom of 20 m.
    assert!(!gate(&st, 14_010_000.0, 1500.0, &rig, 0).allowed);
    // Audio offsets the transmitter will not use.
    assert!(gate(&st, 14_076_000.0, 100.0, &rig, 0).violations.iter().any(|v| matches!(v, Violation::AudioOffsetOutOfRange(_))));
    // No frequency at all.
    assert!(gate(&st, f64::NAN, 1500.0, &rig, 0).violations.contains(&Violation::FrequencyUndetermined));
}

#[test]
fn g4_fails_closed_and_reports_every_violation() {
    let rig = RigStateTracker::new();
    let p = gate(&StationConfig::default(), 0.0, 1500.0, &rig, 0);
    assert!(!p.allowed);
    assert!(p.violations.len() >= 4, "{:?}", p.violations);
}

#[test]
fn g5_the_frame_must_encode_and_be_sent_from_this_station() {
    let rig = RigStateTracker::new();
    let st = station("K1ABC");
    let other = Message::directed(Callsign::new("W1AW").unwrap(), Callsign::new("G4XYZ").unwrap(), Extra::Rr73).unwrap();
    let p = can_transmit(&TxRequest { station: &st, dial_hz: 14_076_000.0, tx_audio_hz: 1500.0, message: Some(&other) }, &rig, 0);
    assert!(p.violations.iter().any(|v| matches!(v, Violation::MessageNotFromStation(_))));
    let mine = Message::directed(Callsign::new("W1AW").unwrap(), Callsign::new("K1ABC").unwrap(), Extra::Rr73).unwrap();
    assert!(can_transmit(&TxRequest { station: &st, dial_hz: 14_076_000.0, tx_audio_hz: 1500.0, message: Some(&mine) }, &rig, 0).allowed);
}

#[test]
fn callsign_syntax_matches_the_shared_vectors() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/vectors/callsign_vectors.json");
    let doc: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    for v in doc["valid"].as_array().unwrap() {
        let c = v["call"].as_str().unwrap();
        assert!(is_valid_callsign(c), "{c} should be valid");
    }
    for v in doc["invalid"].as_array().unwrap() {
        let c = v["call"].as_str().unwrap();
        assert!(!is_valid_callsign(c), "{c} should be invalid");
    }
}

// ------------------------------------------------------------------------- R: rig readback

const T0: u64 = 1_000_000;

#[test]
fn r1_a_settled_rig_that_disagrees_is_reported() {
    let mut t = RigStateTracker::new();
    t.note_requested_dial(14_076_000.0);
    for i in 0..POLLS_TO_STABILIZE {
        t.observe(&Reading { dial_hz: Some(7_074_000.0), ..Default::default() }, T0 + i as u64 * 1000);
    }
    assert!(t.is_stable());
    let m = t.dial_disagreement(14_076_000.0, T0 + 3000).expect("settled disagreement");
    assert_eq!(m.reported_hz, 7_074_000.0);
    assert_eq!(m.error_hz, 7_074_000.0 - 14_076_000.0);
}

#[test]
fn r2_no_readback_is_unverified_not_wrong() {
    let mut t = RigStateTracker::new();
    assert!(t.dial_disagreement(14_076_000.0, T0).is_none());
    assert!(t.verified_dial_hz(T0).is_none());
    assert!(!t.is_online());
    t.observe(&Reading { dial_hz: Some(7_074_000.0), ..Default::default() }, T0);
    assert!(t.has_fresh_reading(T0 + 1000));
    assert!(!t.has_fresh_reading(T0 + READING_STALE_AFTER_MS + 1));
    assert!(t.dial_disagreement(14_076_000.0, T0 + READING_STALE_AFTER_MS + 1).is_none(), "a stale reading must not refuse");
    t.go_offline("relay unreachable");
    assert!(t.verified_dial_hz(T0).is_none());
    assert!(t.dial_disagreement(14_076_000.0, T0).is_none());
    assert_eq!(t.snapshot().offline_reason.as_deref(), Some("relay unreachable"));
}

#[test]
fn r3_an_unsettled_qsy_is_not_a_refusal() {
    let mut t = RigStateTracker::new();
    t.note_requested_dial(14_076_000.0);
    t.observe(&Reading { dial_hz: Some(7_074_000.0), ..Default::default() }, T0);
    assert!(!t.is_stable());
    assert!(t.dial_disagreement(14_076_000.0, T0 + 10).is_none());
    t.observe(&Reading { dial_hz: Some(14_076_000.0), ..Default::default() }, T0 + 1000);
    assert!(t.is_stable(), "arriving at the requested dial settles immediately");
    assert!(t.dial_disagreement(14_076_000.0, T0 + 2000).is_none());
}

#[test]
fn r4_measured_tuning_resolution() {
    assert_eq!(resolution_step_hz(0), 1.0);
    assert_eq!(describe_resolution(1), "10 Hz rounded");
    assert_eq!(describe_resolution(-1), "10 Hz truncated");
    assert_eq!(describe_resolution(-3), "100 Hz truncated");
    assert_eq!(resolution_error_bounds_hz(-3), (99.0, 0.0));
    assert_eq!(resolution_error_bounds_hz(3), (50.0, 50.0));
    let mut t = RigStateTracker::new();
    t.set_resolution(-3);
    t.note_requested_dial(14_076_050.0);
    t.observe(&Reading { dial_hz: Some(14_076_000.0), ..Default::default() }, T0);
    assert!(t.is_stable(), "a truncating rig that obeyed counts as settled");
    assert!(t.dial_disagreement(14_076_050.0, T0).is_none());
    // Truncation never lands high.
    assert!(!dial_agrees(14_076_000.0, 14_076_050.0, -3));
}

#[test]
fn r5_ptt_settle_window() {
    let mut t = RigStateTracker::new();
    assert!(!t.in_ptt_settle_window(T0));
    t.note_requested_ptt(true, T0);
    assert!(t.in_ptt_settle_window(T0 + 1));
    assert_eq!(t.ptt_settle_remaining_ms(T0 + 1), PTT_SETTLE_MS - 1);
    assert!(!t.in_ptt_settle_window(T0 + PTT_SETTLE_MS));
    t.note_requested_ptt(false, T0 + 5000);
    assert!(t.in_ptt_settle_window(T0 + 5001));
}

#[test]
fn r6_the_gate_refuses_a_dial_the_radio_contradicts_and_only_that() {
    let st = station("K1ABC");
    let mut t = RigStateTracker::new();
    t.note_requested_dial(14_076_000.0);
    assert!(gate(&st, 14_076_000.0, 1500.0, &t, T0).allowed, "no readback yet: allowed");
    for i in 0..POLLS_TO_STABILIZE {
        t.observe(&Reading { dial_hz: Some(7_074_000.0), ..Default::default() }, T0 + i as u64);
    }
    let p = gate(&st, 14_076_000.0, 1500.0, &t, T0 + 10);
    assert!(!p.allowed);
    assert!(p.violations.iter().any(|v| matches!(v, Violation::RigDialDisagrees(_))));
    t.go_offline("lost");
    assert!(gate(&st, 14_076_000.0, 1500.0, &t, T0 + 20).allowed, "losing contact must not ground the station");
}

// ------------------------------------------------------------------------------- Z/P: keying

#[test]
fn z1_a_release_drives_what_the_key_drove() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let clock = VirtualClock::default();
    let ptt = PttController::new(line("cm108-gpio4", &log), Arc::new(clock.clone()));
    ptt.key().unwrap();
    ptt.unkey().unwrap();
    assert_eq!(*log.lock().unwrap(), vec![("cm108-gpio4", true), ("cm108-gpio4", false)]);
}

#[test]
fn z1b_replacing_the_line_while_keyed_releases_the_old_line_first() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let ptt = PttController::new(line("old", &log), Arc::new(VirtualClock::default()));
    ptt.key().unwrap();
    ptt.replace_line(line("new", &log)).unwrap();
    let l = log.lock().unwrap().clone();
    assert_eq!(l[0], ("old", true));
    assert_eq!(l[1], ("old", false), "{l:?}");
    assert!(!ptt.is_keyed());
}

#[test]
fn z2_a_key_the_hardware_refused_leaves_nothing_keyed() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let ptt = PttController::new(Box::new(RecordingLine { name: "serial", log: log.clone(), fail_key: true }), Arc::new(VirtualClock::default()));
    assert!(ptt.key().is_err());
    assert!(!ptt.is_keyed());
    assert_eq!(log.lock().unwrap().last(), Some(&("serial", false)), "a release is still sent in case the line half-changed");
}

#[test]
fn z2b_vox_never_reports_verified_and_no_ptt_cannot_key() {
    assert_eq!(VoxPtt.set(true).unwrap(), PttAck::Unverifiable);
    assert!(NoPtt.set(true).is_err());
}

#[test]
fn p4_the_watchdog_unkeys_at_the_hardware_after_max_tx_seconds() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let clock = VirtualClock::default();
    let ptt = PttController::new(line("rts", &log), Arc::new(clock.clone()));
    ptt.key().unwrap();
    clock.advance(24_000);
    assert!(!ptt.watchdog_tick(), "a normal 24 s frame never reaches the watchdog");
    assert!(ptt.is_keyed());
    clock.advance(MAX_TX_SECONDS * 1000 - 24_000);
    assert!(ptt.watchdog_tick());
    assert!(!ptt.is_keyed());
    assert!(ptt.watchdog_fired());
    assert_eq!(log.lock().unwrap().last(), Some(&("rts", false)), "released at the hardware, not only in the app");
    assert!(z30_protocol::FRAME_SEC < MAX_TX_SECONDS as f64);
}

#[test]
fn p4b_the_watchdog_thread_works_without_the_engine() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let ptt = PttController::with_limit(line("real-time", &log), Arc::new(SystemMonotonic::default()), 150);
    let _h = ptt.spawn_watchdog(std::time::Duration::from_millis(10));
    ptt.key().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(400));
    assert!(!ptt.is_keyed(), "the watchdog thread released the line on its own");
    assert!(ptt.watchdog_fired());
}

#[test]
fn p4c_the_limit_can_never_be_raised() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let clock = VirtualClock::default();
    let ptt = PttController::with_limit(line("x", &log), Arc::new(clock.clone()), 10 * 60 * 1000);
    ptt.key().unwrap();
    clock.advance(MAX_TX_SECONDS * 1000);
    assert!(ptt.watchdog_tick(), "a 10-minute limit request is clamped to MAX_TX_SECONDS");
}

