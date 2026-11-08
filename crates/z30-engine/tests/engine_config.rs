//! The engine enforces its own configuration rules; none of this relies on the GUI.
//!
//! - `UpdateConfig` is checked in full before anything changes (`Config::validate`). A refused
//!   update leaves the configuration and the dial as they were and says why
//!   (`Event::ConfigRejected`). It used to be applied unchecked, although documented as validated.
//! - PTT, rig and audio settings take effect only when a runtime opens the hardware, so an update
//!   changing them is refused while the transmitter is keyed, its release is unconfirmed, or a
//!   transmission is under way (and, through the runtime, while a station runs:
//!   `runtime_settings.rs`). The gate would otherwise approve against settings other than the
//!   ones the station holds.
//! - `[rig] poll_interval_ms` stays within `MIN_POLL_INTERVAL_MS..=MAX_POLL_INTERVAL_MS`: brought
//!   to the nearer bound when a configuration is read, refused outside it in an update, clamped
//!   where the rig thread schedules polls, and scheduled without arithmetic that can overflow.
//! - A decode whose DT is not a number does not panic the control thread when the snapshot's
//!   median is taken (it sorted with `partial_cmp().unwrap()`).
#![allow(clippy::field_reassign_with_default)]

use z30_dsp::ldpc::DecodeMethod;
use z30_dsp::slot::{Decode, SlotReport};
use z30_engine::api::{Command, Event, TxOutcome};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig, SerialLine};
use z30_engine::engine::Engine;
use z30_engine::rig::{DEFAULT_POLL_INTERVAL_MS, READING_STALE_AFTER_MS};
use z30_engine::runtime::{RigPollSchedule, MAX_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS};
use z30_engine::slots::slot_start;
use z30_protocol::codec::Message;

const SLOT: i64 = 60_000_000; // even: this station's slot

fn config() -> Config {
    let mut c = Config::default();
    c.station.callsign = "K1ABC".into();
    c.station.grid = "FN31".into();
    c.station.region = Some(Region::Us);
    c.station.license_class = Some(LicenseClass::UsGeneral);
    c.ptt = PttConfig::Vox;
    c.audio.tx_level = 0.5;
    c.operating.dial_hz = Some(14_076_000);
    c.operating.tx_audio_hz = 1500.0;
    c
}

fn serial() -> PttConfig {
    PttConfig::Serial { port: "/dev/ttyUSB0".into(), line: SerialLine::Rts, active_high: true }
}

fn rejections(e: &mut Engine) -> Vec<String> {
    e.take_events().into_iter().filter_map(|ev| if let Event::ConfigRejected(why) = ev { Some(why) } else { None }).collect()
}

type Change = (&'static str, fn(&mut Config));

/// Every section a runtime opens hardware from.
const HARDWARE_CHANGES: [Change; 5] = [
    ("PTT method", |c| c.ptt = serial()),
    ("rigctld host", |c| c.rig.rigctld_host = "localhost".into()),
    ("rig poll interval", |c| c.rig.poll_interval_ms = 2_000),
    ("output device", |c| c.audio.output_device = Some("USB Audio CODEC".into())),
    ("transmit level", |c| c.audio.tx_level = 0.75),
];

// ---------------------------------------------------------------------------- UpdateConfig

#[test]
fn a_valid_update_is_applied_on_an_idle_engine_and_ends_any_planned_transmission() {
    let mut e = Engine::new(config());
    let mut c = config();
    c.station.callsign = "G4XYZ".into();
    c.ptt = serial();
    c.rig.poll_interval_ms = 2_000;
    c.audio.tx_level = 0.25;
    c.operating.dial_hz = Some(7_074_000);
    assert!(e.apply(Command::UpdateConfig(Box::new(c.clone())), 0), "an applied update halts: the gate approved the old configuration");
    assert_eq!(**e.config(), c);
    assert_eq!(e.take_dial_command(), Some(7_074_000));
    assert!(rejections(&mut e).is_empty());
}

#[test]
fn an_invalid_update_is_refused_whole_and_changes_nothing() {
    let invalid: [Change; 11] = [
        ("tx_level NaN", |c| c.audio.tx_level = f32::NAN),
        ("tx_level above full scale", |c| c.audio.tx_level = 1.5),
        ("tx_level negative", |c| c.audio.tx_level = -0.1),
        ("tx audio NaN", |c| c.operating.tx_audio_hz = f64::NAN),
        ("rx audio infinite", |c| c.operating.rx_audio_hz = f64::INFINITY),
        ("power NaN", |c| c.station.configured_tx_power_w = Some(f64::NAN)),
        ("power zero", |c| c.station.configured_tx_power_w = Some(0.0)),
        ("poll interval zero", |c| c.rig.poll_interval_ms = 0),
        ("poll interval below the minimum", |c| c.rig.poll_interval_ms = MIN_POLL_INTERVAL_MS - 1),
        ("poll interval above the maximum", |c| c.rig.poll_interval_ms = MAX_POLL_INTERVAL_MS + 1),
        ("poll interval u64::MAX", |c| c.rig.poll_interval_ms = u64::MAX),
    ];
    for (name, spoil) in invalid {
        let before = config();
        let mut e = Engine::new(before.clone());
        let mut c = config();
        // Valid changes alongside the invalid one: none of them may be applied either.
        c.station.callsign = "G4XYZ".into();
        c.operating.dial_hz = Some(7_074_000);
        spoil(&mut c);
        assert!(!e.apply(Command::UpdateConfig(Box::new(c)), 0), "{name}: a refused update changes nothing, so it ends nothing");
        assert_eq!(**e.config(), before, "{name}: partly applied");
        assert_eq!(e.dial_hz(), Some(14_076_000), "{name}");
        assert_eq!(e.take_dial_command(), None, "{name}: the refused dial was to be sent to the radio");
        let r = rejections(&mut e);
        assert_eq!(r.len(), 1, "{name}: {r:?}");
    }
}

#[test]
fn an_unconfigured_installation_is_a_valid_configuration_the_gate_then_refuses() {
    assert_eq!(Config::default().validate(), Ok(()));
    assert_eq!(config().validate(), Ok(()));
}

/// A state the engine is put in, and how it leaves it.
type EngineState = (&'static str, fn(&mut Engine), fn(&mut Engine));

/// The engine in each state in which the line may be on the air, and how that state ends.
const KEYED_STATES: [EngineState; 3] = [
    ("keyed", |e| e.note_ptt(true, 0), |e| e.note_ptt(false, 1)),
    (
        "release unconfirmed",
        |e| e.set_ptt_release_unconfirmed(Some("rigctld: timed out (test)".into())),
        |e| e.set_ptt_release_unconfirmed(None),
    ),
    (
        "transmitting",
        |e| {
            e.apply(Command::CallCq, 0);
            let p = e.plan_tx(SLOT, 0).expect("the gate allows this station");
            e.tx_started(&p);
        },
        |e| e.tx_finished(SLOT, &TxOutcome::Aborted("test".into()), 0),
    ),
];

#[test]
fn ptt_rig_and_audio_changes_are_refused_while_the_line_may_be_on_the_air() {
    for (state, enter, leave) in KEYED_STATES {
        for (name, change) in HARDWARE_CHANGES {
            let before = config();
            let mut e = Engine::new(before.clone());
            enter(&mut e);
            let _ = e.take_events();
            let mut c = config();
            change(&mut c);
            assert!(!e.apply(Command::UpdateConfig(Box::new(c.clone())), 0), "{state}, {name}");
            assert_eq!(**e.config(), before, "{state}: the {name} change was applied");
            assert_eq!(rejections(&mut e).len(), 1, "{state}, {name}: not reported");
            // Once the line is released the same update applies.
            leave(&mut e);
            assert!(e.apply(Command::UpdateConfig(Box::new(c.clone())), 0), "{state}, {name}");
            assert_eq!(**e.config(), c, "{state}, {name}: not applied once released");
        }
    }
}

#[test]
fn other_changes_while_keyed_are_applied_and_end_the_transmission() {
    let mut e = Engine::new(config());
    e.note_ptt(true, 0);
    let mut c = config();
    c.station.callsign = "G4XYZ".into();
    c.operating.tx_audio_hz = 1600.0;
    assert!(e.apply(Command::UpdateConfig(Box::new(c.clone())), 0), "an applied update ends the keyed transmission");
    assert_eq!(**e.config(), c);
}

// ---------------------------------------------------------------------- rig poll interval

#[test]
fn the_poll_interval_bounds_follow_from_the_rig_reading_stale_limit() {
    // Pinned as numbers, as the runtime tests derive their timings from them.
    assert_eq!(MIN_POLL_INTERVAL_MS, 250);
    assert_eq!(MAX_POLL_INTERVAL_MS, 3_000);
    // Two polls inside the time a reading vouches for the rig.
    assert_eq!(MAX_POLL_INTERVAL_MS * 2, READING_STALE_AFTER_MS);
    assert_eq!(DEFAULT_POLL_INTERVAL_MS, 1_000, "the default is unchanged");
}

fn read_poll_interval(value: &str) -> Result<u64, serde_json::Error> {
    serde_json::from_str::<Config>(&format!(r#"{{"rig": {{"poll_interval_ms": {value}}}}}"#)).map(|c| c.rig.poll_interval_ms)
}

#[test]
fn a_configuration_files_poll_interval_is_brought_within_bounds_when_read() {
    for (value, want) in [
        ("0", MIN_POLL_INTERVAL_MS),
        ("249", MIN_POLL_INTERVAL_MS),
        ("250", 250),
        ("1000", 1_000),
        ("3000", 3_000),
        ("3001", MAX_POLL_INTERVAL_MS),
        ("9223372036854775807", MAX_POLL_INTERVAL_MS),  // the largest TOML integer
        ("18446744073709551615", MAX_POLL_INTERVAL_MS), // u64::MAX
    ] {
        assert_eq!(read_poll_interval(value).unwrap(), want, "{value}");
    }
    // Absent: the default, as before.
    assert_eq!(
        serde_json::from_str::<Config>(r#"{"rig": {"rigctld_port": 4533}}"#).unwrap().rig.poll_interval_ms,
        DEFAULT_POLL_INTERVAL_MS
    );
    assert_eq!(serde_json::from_str::<Config>("{}").unwrap().rig.poll_interval_ms, DEFAULT_POLL_INTERVAL_MS);
    // Malformed: refused, not guessed.
    for value in ["-1", "1.5", "\"fast\"", "null", "18446744073709551616"] {
        assert!(read_poll_interval(value).is_err(), "{value} was read as an interval");
    }
    // What is read is what is written back.
    let c = serde_json::from_str::<Config>(&serde_json::to_string(&config()).unwrap()).unwrap();
    assert_eq!(c, config());
}

#[test]
fn validate_accepts_exactly_the_poll_interval_bounds() {
    for (ms, ok) in [
        (0, false),
        (MIN_POLL_INTERVAL_MS - 1, false),
        (MIN_POLL_INTERVAL_MS, true),
        (DEFAULT_POLL_INTERVAL_MS, true),
        (MAX_POLL_INTERVAL_MS, true),
        (MAX_POLL_INTERVAL_MS + 1, false),
        (u64::MAX, false),
    ] {
        let mut c = config();
        c.rig.poll_interval_ms = ms;
        assert_eq!(c.validate().is_ok(), ok, "{ms}: {:?}", c.validate());
    }
}

#[test]
fn the_rig_schedule_clamps_the_interval_and_never_overflows() {
    for (ms, want) in [
        (0, MIN_POLL_INTERVAL_MS),
        (MIN_POLL_INTERVAL_MS - 1, MIN_POLL_INTERVAL_MS),
        (MIN_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS),
        (DEFAULT_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
        (MAX_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS),
        (MAX_POLL_INTERVAL_MS + 1, MAX_POLL_INTERVAL_MS),
        (u64::MAX, MAX_POLL_INTERVAL_MS),
    ] {
        assert_eq!(RigPollSchedule::new(ms).interval_ms(), want, "{ms}");
    }
    // u64::MAX used to schedule the next poll at now + u64::MAX.
    let mut s = RigPollSchedule::new(u64::MAX);
    assert!(s.poll_now(1_000, u64::MAX));
    assert!(!s.poll_now(1_000 + MAX_POLL_INTERVAL_MS - 1, u64::MAX));
    assert!(s.poll_now(1_000 + MAX_POLL_INTERVAL_MS, u64::MAX), "a huge interval still polls at the maximum");
    // A clock at the end of its range: no overflow, and no poll on every pass.
    let mut s = RigPollSchedule::new(MAX_POLL_INTERVAL_MS);
    assert!(s.poll_now(u64::MAX - 1, u64::MAX));
    assert!(!s.poll_now(u64::MAX - 1, u64::MAX));
    // Normal polling is unchanged.
    let mut s = RigPollSchedule::new(DEFAULT_POLL_INTERVAL_MS);
    let polls: Vec<u64> = (0..=5_000).step_by(5).filter(|&t| s.poll_now(t, u64::MAX)).collect();
    assert_eq!(polls, vec![0, 1_000, 2_000, 3_000, 4_000, 5_000]);
}

// --------------------------------------------------------------------- snapshot DT median

fn decode(dt_sec: f64) -> Decode {
    let enc = Message::parse("CQ K1ABC FN31").unwrap().encode().unwrap();
    Decode {
        message: z30_protocol::codec::unpack_info(&enc.info).unwrap(),
        info: enc.info,
        snr_db: Some(-12.0),
        dt_sec,
        freq_hz: 1200.0,
        drift_hz: 0.0,
        sync: 5.0,
        iterations: 3,
        method: DecodeMethod::BeliefPropagation(1),
        ap_type: 0,
        pass: 1,
    }
}

fn snapshot_median(dts: &[f64]) -> Option<f64> {
    let mut e = Engine::new(config());
    let report = SlotReport { decodes: dts.iter().map(|&dt| decode(dt)).collect(), ..Default::default() };
    e.on_slot_report(SLOT - 1, &report, slot_start(SLOT - 1) + 26.0, 0);
    e.snapshot(0).dt_median_sec
}

#[test]
fn a_decode_whose_dt_is_not_a_number_does_not_stop_the_snapshot() {
    // The median is of the DTs that are numbers.
    let dts = [0.1, f64::NAN, -0.2, 0.3, -f64::NAN, 0.0, f64::INFINITY, 0.2, f64::NEG_INFINITY];
    assert_eq!(snapshot_median(&dts), Some(0.1));
    // Fewer than five numbers: no median, as with fewer than five decodes.
    assert_eq!(snapshot_median(&[f64::NAN; 8]), None);
    assert_eq!(snapshot_median(&[0.1, 0.2, f64::NAN, 0.3, 0.4]), None);
    // Unchanged for ordinary DTs.
    assert_eq!(snapshot_median(&[0.5, -0.1, 0.2, 0.0, 0.3]), Some(0.2));
}
