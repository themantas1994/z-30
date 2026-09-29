//! Guarantees of the transmit gate and the transmit plan that no test pinned before the
//! 2026-09-28 agent-team audit: the emission-edge arithmetic (F-05: G-bw, G-centre, G-top), the
//! transmit level (F-07: G-nan, N3-level), configured power provenance (F-09: PWR-a), the gate
//! as one contract that includes the hardware (F-22), the corrected US band plan at the gate
//! (F-02), only a complete frame advancing the QSO (F-17), Tune through the one modulator
//! (F-49), and a refused dial or a mid-frame contradiction as refusals (F-45).
//!
//! If one of these fails, the change is wrong - do not edit the test.
#![allow(clippy::field_reassign_with_default)]

use z30_dsp::ldpc::DecodeMethod;
use z30_dsp::slot::{Decode, SlotReport};
use z30_engine::api::{Command, Event, TxOutcome};
use z30_engine::bandplan::{LicenseClass, Region, US_60M_CHANNEL_CENTRES_HZ};
use z30_engine::config::{Config, PttConfig, StationConfig};
use z30_engine::engine::{Engine, TxKind};
use z30_engine::qso::{Provenance, Sourced};
use z30_engine::rig::{Reading, RigStateTracker, POLLS_TO_STABILIZE};
use z30_engine::slots::slot_start;
use z30_engine::txgate::{can_transmit, Permission, TxHardware, TxRequest, Violation, MAX_TX_AUDIO_TOP_HZ, OCCUPIED_40DB_HZ};
use z30_protocol::codec::Message;
use z30_protocol::{NUM_TONES, TONE_SPACING_HZ};

const SPAN: f64 = (NUM_TONES - 1) as f64 * TONE_SPACING_HZ;
const HALF: f64 = OCCUPIED_40DB_HZ / 2.0;

const HW: TxHardware<'static> =
    TxHardware { ptt: &PttConfig::Vox, problems: &[], tx_level: 0.5, ptt_release_unconfirmed: None, dial_refused: None };

fn station(region: Region, class: LicenseClass) -> StationConfig {
    StationConfig {
        callsign: "K1ABC".into(),
        grid: "FN31".into(),
        region: Some(region),
        license_class: Some(class),
        configured_tx_power_w: None,
    }
}

fn gate_hw(st: &StationConfig, dial: f64, audio: f64, hw: &TxHardware<'_>) -> Permission {
    can_transmit(&TxRequest { station: st, dial_hz: dial, tx_audio_hz: audio, message: None, hardware: hw }, &RigStateTracker::new(), 0)
}

fn gate(st: &StationConfig, dial: f64, audio: f64) -> Permission {
    gate_hw(st, dial, audio, &HW)
}

fn out_of_band(p: &Permission) -> bool {
    p.violations.iter().any(|v| matches!(v, Violation::OutOfBand { .. }))
}

/// The dial that puts the emission's centre at `centre` with tone 0 at `audio`.
fn dial_for_centre(centre: f64, audio: f64) -> f64 {
    centre - audio - SPAN / 2.0
}

// ----------------------------------------------------------------------- F-05: emission edges

#[test]
fn f05_the_emission_is_checked_at_its_66_hz_width_around_the_tone_span_centre() {
    // R1 20 m ends at 14.350 MHz. An emission centre 20 Hz inside the edge radiates 13 Hz past
    // it (G-bw: a 0 Hz width would pass it); 40 Hz inside is clear.
    let st = station(Region::IaruR1, LicenseClass::Full);
    let edge = 14_350_000.0;
    assert!(out_of_band(&gate(&st, dial_for_centre(edge - 20.0, 1500.0), 1500.0)), "centre 20 Hz inside the edge");
    assert!(gate(&st, dial_for_centre(edge - 40.0, 1500.0), 1500.0).allowed, "centre 40 Hz inside the edge");
    assert!(gate(&st, dial_for_centre(edge - HALF, 1500.0), 1500.0).allowed, "upper emission edge exactly on the band edge");
    assert!(out_of_band(&gate(&st, dial_for_centre(edge - HALF + 1.0, 1500.0), 1500.0)), "1 Hz over");
    // Lower edge, 14.000 MHz, the same way.
    assert!(gate(&st, dial_for_centre(14_000_000.0 + HALF, 1500.0), 1500.0).allowed);
    assert!(out_of_band(&gate(&st, dial_for_centre(14_000_000.0 + HALF - 1.0, 1500.0), 1500.0)));
    // G-centre: the centre is tone 0 + half the span, not tone 0. A dial whose TONE 0 is 40 Hz
    // inside the upper edge has its tone-span centre ~ 16 Hz past it: refused.
    let d = edge - 40.0 - 1500.0;
    assert!(out_of_band(&gate(&st, d, 1500.0)), "tone 0 inside, the emission's centre outside");
}

#[test]
fn f05_the_top_tone_must_stay_below_the_audio_ceiling() {
    // G-top: tone 15 (not tone 0) is held below MAX_TX_AUDIO_TOP_HZ.
    let st = station(Region::IaruR1, LicenseClass::Full);
    let limit = MAX_TX_AUDIO_TOP_HZ - SPAN;
    let offset = |p: &Permission| p.violations.iter().any(|v| matches!(v, Violation::AudioOffsetOutOfRange(_)));
    assert!(offset(&gate(&st, 14_074_000.0, 2760.0)), "tone 15 at {} Hz", 2760.0 + SPAN);
    assert!(!offset(&gate(&st, 14_074_000.0, 2750.0)), "tone 15 at {} Hz", 2750.0 + SPAN);
    assert!(!offset(&gate(&st, 14_074_000.0, limit)), "tone 15 exactly at the ceiling");
    assert!(offset(&gate(&st, 14_074_000.0, limit + 0.01)));
}

// ------------------------------------------------------------------- F-02: US band plan

#[test]
fn f02_the_gate_refuses_us_cw_only_sub_bands_and_off_channel_60m() {
    let st = station(Region::Us, LicenseClass::UsGeneral);
    // TX-02's probe dials, 1500 Hz audio: all were allowed.
    for dial in [50_050_000.0, 144_050_000.0, 5_366_000.0, 5_338_000.0] {
        assert!(out_of_band(&gate(&st, dial, 1500.0)), "{dial}");
    }
    // Legal centre, illegal emission: centre on 50.1 MHz, lower half in the CW-only segment.
    assert!(out_of_band(&gate(&st, dial_for_centre(50_100_000.0, 1500.0), 1500.0)));
    // Just inside: allowed.
    assert!(gate(&st, dial_for_centre(50_100_000.0 + HALF, 1500.0), 1500.0).allowed);
    assert!(gate(&st, dial_for_centre(144_100_000.0 + HALF, 1500.0), 1500.0).allowed);
    // 60 m: the dial that centres the emission on each channel passes; 60 Hz off does not.
    for c in US_60M_CHANNEL_CENTRES_HZ {
        let c = c as f64;
        assert!(gate(&st, dial_for_centre(c, 1500.0), 1500.0).allowed, "{c}");
        assert!(out_of_band(&gate(&st, dial_for_centre(c + 60.0, 1500.0), 1500.0)), "{c} + 60 Hz");
        assert!(out_of_band(&gate(&st, dial_for_centre(c - 60.0, 1500.0), 1500.0)), "{c} - 60 Hz");
    }
    // The usual USB-dial habit (dial 1.5 kHz below the channel, tone 0 at 1500 Hz) is 23 Hz off
    // centre, inside the tolerance.
    assert!(gate(&st, 5_332_000.0 - 1_500.0, 1500.0).allowed);
}

// --------------------------------------------------------------- F-07: the transmit level

#[test]
fn f07_a_nan_level_or_one_above_full_scale_is_refused_not_clamped() {
    let st = station(Region::IaruR1, LicenseClass::Full);
    for (level, want) in [
        (f32::NAN, Violation::TxAudioLevelOutOfRange(f32::NAN)),
        (1.01, Violation::TxAudioLevelOutOfRange(1.01)),
        (5.0, Violation::TxAudioLevelOutOfRange(5.0)),
        (0.0, Violation::TxAudioLevelZero),
        (-0.5, Violation::TxAudioLevelZero),
    ] {
        let hw = TxHardware { tx_level: level, ..HW };
        let p = gate_hw(&st, 14_074_000.0, 1500.0, &hw);
        assert!(!p.allowed, "{level}");
        let found = p.violations.iter().any(|v| match (v, &want) {
            (Violation::TxAudioLevelOutOfRange(a), Violation::TxAudioLevelOutOfRange(b)) => a.to_bits() == b.to_bits(),
            (a, b) => a == b,
        });
        assert!(found, "{level}: {:?}", p.violations);
    }
    assert!(gate_hw(&st, 14_074_000.0, 1500.0, &TxHardware { tx_level: 1.0, ..HW }).allowed, "full scale is a level");
}

#[test]
fn f07_the_synthesised_frame_never_exceeds_full_scale() {
    // N3-level: the second line behind the gate. Even a level of 5 or NaN handed straight to the
    // synthesis cannot produce samples beyond +-1.
    let m = Message::parse("CQ K1ABC FN31").unwrap();
    let frame = m.frame().unwrap();
    for level in [5.0f32, 1.0, f32::INFINITY] {
        let a = z30_engine::runtime::frame_audio(&frame, 1500.0, 6000, level).unwrap();
        let peak = a.iter().fold(0.0f32, |p, v| p.max(v.abs()));
        assert!(peak <= 1.0 && peak > 0.99, "level {level}: peak {peak}");
    }
    let a = z30_engine::runtime::frame_audio(&frame, 1500.0, 6000, f32::NAN).unwrap();
    assert!(a.iter().all(|v| *v == 0.0), "a NaN level produces silence, never NaN samples");
}

// ------------------------------------------------------------------ F-22: one gate contract

#[test]
fn f22_can_transmit_itself_refuses_missing_or_uncertain_hardware() {
    let st = station(Region::IaruR1, LicenseClass::Full);
    let ok = gate(&st, 14_074_000.0, 1500.0);
    assert!(ok.allowed && ok.violations.is_empty());
    let problems = ["audio output: no device".to_string()];
    for (hw, want) in [
        (TxHardware { ptt: &PttConfig::None, ..HW }, Violation::PttNotConfigured),
        (TxHardware { problems: &problems, ..HW }, Violation::HardwareUnavailable(problems[0].clone())),
        (TxHardware { ptt_release_unconfirmed: Some("T 0 timed out"), ..HW }, Violation::PttReleaseUnconfirmed("T 0 timed out".into())),
        (TxHardware { dial_refused: Some(14_074_000), ..HW }, Violation::RigRefusedDial(14_074_000)),
    ] {
        let p = gate_hw(&st, 14_074_000.0, 1500.0, &hw);
        assert!(!p.allowed, "allowed with {want:?}");
        assert!(p.violations.contains(&want), "{:?}", p.violations);
    }
    // Every violation is reported, not the first.
    let hw =
        TxHardware { ptt: &PttConfig::None, problems: &problems, tx_level: 0.0, ptt_release_unconfirmed: Some("x"), dial_refused: None };
    assert_eq!(gate_hw(&st, 14_074_000.0, 1500.0, &hw).violations.len(), 4);
}

// ------------------------------------------------------------------- engine-level contract

fn config() -> Config {
    let mut c = Config::default();
    c.station = station(Region::IaruR1, LicenseClass::Full);
    c.ptt = PttConfig::Vox;
    c.audio.tx_level = 0.5;
    c.operating.dial_hz = Some(14_074_000);
    c.operating.tx_audio_hz = 1500.0;
    c
}

fn decode(text: &str) -> Decode {
    let enc = Message::parse(text).unwrap().encode().unwrap();
    Decode {
        message: z30_protocol::codec::unpack_info(&enc.info).unwrap(),
        info: enc.info,
        snr_db: Some(-10.0),
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

const SLOT: i64 = 59_666_801; // odd: the partner's slot; ours are even

/// CQ, an answer with a grid, our report, their roger report: we are about to send RR73 in
/// SLOT + 3. Returns the planned RR73 (already started).
fn up_to_rr73(e: &mut Engine) {
    e.apply(Command::CallCq, 0);
    let rep = |t: &str| SlotReport { decodes: vec![decode(t)], ..Default::default() };
    e.on_slot_report(SLOT, &rep("K1ABC G4XYZ IO91"), slot_start(SLOT) + 26.0, 0);
    let p = e.plan_tx(SLOT + 1, 0).expect("report");
    e.tx_started(&p);
    e.tx_finished(SLOT + 1, &TxOutcome::Complete, 0);
    e.on_slot_report(SLOT + 2, &rep("K1ABC G4XYZ -08"), slot_start(SLOT + 2) + 26.0, 0);
    let p = e.plan_tx(SLOT + 3, 0).expect("RR73");
    assert_eq!(p.text(), "G4XYZ K1ABC RR73");
    e.tx_started(&p);
    let _ = e.take_events();
}

#[test]
fn f17_only_a_complete_closing_frame_completes_and_logs_the_contact() {
    for outcome in [
        TxOutcome::Partial("0.3 s not played".into()),
        TxOutcome::Aborted("halted".into()),
        TxOutcome::Failed("audio".into()),
        TxOutcome::WatchdogAborted,
    ] {
        let mut e = Engine::new(config());
        up_to_rr73(&mut e);
        e.tx_finished(SLOT + 3, &outcome, 0);
        let ev = e.take_events();
        assert!(!ev.iter().any(|x| matches!(x, Event::ContactComplete(_))), "{outcome:?} completed the contact: {ev:?}");
        assert!(ev.iter().any(|x| matches!(x, Event::TxFinished { outcome: o, .. } if *o == outcome)));
    }
    let mut e = Engine::new(config());
    up_to_rr73(&mut e);
    e.tx_finished(SLOT + 3, &TxOutcome::Complete, 0);
    assert!(e.take_events().iter().any(|x| matches!(x, Event::ContactComplete(_))));
}

#[test]
fn f09_configured_power_is_logged_as_configuration_never_as_measured() {
    let mut cfg = config();
    cfg.station.configured_tx_power_w = Some(25.0);
    let mut e = Engine::new(cfg);
    up_to_rr73(&mut e);
    e.tx_finished(SLOT + 3, &TxOutcome::Complete, 0);
    let rec = e.take_events().into_iter().find_map(|x| if let Event::ContactComplete(r) = x { Some(*r) } else { None }).unwrap();
    assert_eq!(rec.tx_power_w, Some(Sourced::new(25.0, Provenance::Configured)));
    // And none at all when none is configured: no default power.
    let mut e = Engine::new(config());
    up_to_rr73(&mut e);
    e.tx_finished(SLOT + 3, &TxOutcome::Complete, 0);
    let rec = e.take_events().into_iter().find_map(|x| if let Event::ContactComplete(r) = x { Some(*r) } else { None }).unwrap();
    assert_eq!(rec.tx_power_w, None);
}

#[test]
fn f22_the_plan_carries_exactly_what_the_gate_checked() {
    let mut e = Engine::new(config());
    e.apply(Command::CallCq, 0);
    let p = e.plan_tx(2, 0).unwrap();
    assert_eq!((p.dial_hz(), p.tx_audio_hz(), p.tx_level(), p.segment()), (14_074_000, 1500.0, 0.5, "20m"));
    assert_eq!(p.emission_centre_hz(), 14_074_000.0 + 1500.0 + SPAN / 2.0);
    // A new installation's level of 0 is refused by the engine's gate, not only by a later check.
    let mut cfg = config();
    cfg.audio.tx_level = f32::NAN;
    let mut e = Engine::new(cfg);
    e.apply(Command::CallCq, 0);
    assert!(e.plan_tx(2, 0).is_none());
    assert!(e
        .take_events()
        .iter()
        .any(|x| matches!(x, Event::TxRefused(v) if v.iter().any(|v| matches!(v, Violation::TxAudioLevelOutOfRange(_))))));
}

#[test]
fn f49_tune_is_the_one_modulators_unmodulated_carrier_at_the_span_centre() {
    let mut e = Engine::new(config());
    e.apply(Command::Tune, 0);
    let p = e.plan_tx(2, 0).unwrap();
    assert!(matches!(p.kind(), TxKind::Tune));
    let rate = 6000;
    let a = z30_engine::runtime::tx_audio(&p, rate).unwrap();
    let m = z30_protocol::gfsk::Modulator::new(rate as f64).unwrap();
    let expected: Vec<f32> =
        m.synthesize(&[0u8; z30_protocol::TOTAL_SYMBOLS], 1500.0 + SPAN / 2.0).unwrap().iter().map(|v| v * 0.5).collect();
    assert!(a == expected, "Tune is not the modulator's constant-symbol frame");
    // Raised-cosine ramp, not linear: a quarter of the way into the 20 ms ramp the envelope is
    // 0.146 (1 - cos(pi/4))/2, where a linear ramp would be 0.25.
    let env = m.envelope(a.len());
    let q = (0.005 * rate as f64) as usize;
    assert!((env[q] - 0.5 * (1.0 - (std::f64::consts::PI / 4.0).cos())).abs() < 1e-9);
}

#[test]
fn f45_a_radio_that_contradicts_the_dial_mid_frame_is_reported() {
    let mut e = Engine::new(config());
    e.apply(Command::CallCq, 0);
    let p = e.plan_tx(2, 0).unwrap();
    assert!(e.tx_still_permitted(&p, 0).is_empty(), "no reading: no contradiction");
    let t = 1_000_000;
    for i in 0..POLLS_TO_STABILIZE as u64 {
        e.on_rig_reading(&Reading { dial_hz: Some(14_074_000.0), ptt: None, mode: Some("USB".into()) }, t + i);
    }
    assert!(e.tx_still_permitted(&p, t + 10).is_empty());
    // The operator turns the VFO during the frame.
    for i in 0..POLLS_TO_STABILIZE as u64 {
        e.on_rig_reading(&Reading { dial_hz: Some(14_080_000.0), ptt: None, mode: Some("USB".into()) }, t + 100 + i);
    }
    assert!(e.tx_still_permitted(&p, t + 200).iter().any(|v| matches!(v, Violation::RigDialDisagrees(_))));
    // Or switches to LSB.
    e.on_rig_reading(&Reading { dial_hz: Some(14_074_000.0), ptt: None, mode: Some("LSB".into()) }, t + 300);
    assert!(e.tx_still_permitted(&p, t + 301).iter().any(|v| matches!(v, Violation::RigModeNotUsb(_))));
}

#[test]
fn f18_a_mode_the_poll_did_not_read_is_not_re_dated_as_fresh() {
    let mut r = RigStateTracker::new();
    r.observe(&Reading { dial_hz: Some(14_074_000.0), ptt: None, mode: Some("LSB".into()) }, 0);
    // Every later poll reads the dial but fails the `m` query.
    for t in (1000..=10_000).step_by(1000) {
        r.observe(&Reading { dial_hz: Some(14_074_000.0), ptt: None, mode: None }, t);
    }
    assert!(r.has_fresh_reading(10_000));
    assert_eq!(r.fresh_reported_mode(10_000), None, "the LSB reading is 10 s old; it vouches for nothing");
    assert_eq!(r.fresh_reported_mode(5_000), Some("LSB"));
}
