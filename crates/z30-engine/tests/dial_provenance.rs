//! The logged dial frequency claims no more than the evidence for it (2026-09-24
//! post-remediation audit, N-05 / C-05).
//!
//! The audit found a station with no rig control logging every contact at the configured - by
//! default 14.076 MHz - dial, tagged "commanded", although nothing had been commanded and there
//! was no radio to command. These drive complete contacts through the engine (and, at the end,
//! through the real runtime threads with a scripted radio) and check the dial's provenance in
//! each situation: nothing known, configured only, commanded and acknowledged, reported by the
//! radio, a command the radio refused, a stale reading, an acknowledgement for an old dial.
#![allow(clippy::field_reassign_with_default)]

use z30_dsp::ldpc::DecodeMethod;
use z30_dsp::slot::{Decode, SlotReport};
use z30_engine::api::{Command, Event};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig};
use z30_engine::engine::Engine;
use z30_engine::qso::{Provenance, QsoRecord, Sourced};
use z30_engine::rig::{Reading, READING_STALE_AFTER_MS};
use z30_engine::slots::slot_start;
use z30_engine::txgate::Violation;
use z30_protocol::codec::Message;

const SLOT: i64 = 59_666_801; // odd: the partner's slot; ours are even

fn decode(text: &str) -> Decode {
    let enc = Message::parse(text).unwrap().encode().unwrap();
    Decode {
        message: z30_protocol::codec::unpack_info(&enc.info).unwrap(),
        info: enc.info,
        snr_db: Some(-12.0),
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

fn config(dial: Option<u64>) -> Config {
    let mut cfg = Config::default();
    cfg.station.callsign = "G4XYZ".into();
    cfg.station.grid = "IO91wm".into();
    cfg.station.region = Some(Region::IaruR1);
    cfg.station.license_class = Some(LicenseClass::Full);
    cfg.ptt = PttConfig::Vox;
    cfg.audio.tx_level = 0.5;
    cfg.operating.tx_audio_hz = 1400.0;
    cfg.operating.dial_hz = dial;
    cfg
}

/// A complete contact: we call CQ, K1ABC answers, reports are exchanged, we send RR73. Returns
/// the logged record, or None if nothing was logged. `before_log` runs just before the last
/// transmission ends (where the record is made), with the engine and that moment's time.
fn contact(e: &mut Engine, now_ms: u64, before_log: impl FnOnce(&mut Engine)) -> Option<QsoRecord> {
    e.apply(Command::CallCq, now_ms);
    let rep = |text: &str| SlotReport { decodes: vec![decode(text)], ..Default::default() };
    e.on_slot_report(SLOT, &rep("G4XYZ K1ABC FN31"), slot_start(SLOT) + 26.0, now_ms);
    if let Some(p) = e.plan_tx(SLOT + 1, now_ms) {
        e.tx_started(&p);
        e.tx_finished(SLOT + 1, true, now_ms);
    }
    e.on_slot_report(SLOT + 2, &rep("G4XYZ K1ABC -08"), slot_start(SLOT + 2) + 26.0, now_ms);
    let _ = e.take_events();
    let rr73 = e.plan_tx(SLOT + 3, now_ms);
    if let Some(p) = &rr73 {
        e.tx_started(p);
    }
    before_log(e);
    e.tx_finished(SLOT + 3, true, now_ms);
    e.take_events().into_iter().find_map(|ev| if let Event::Logged(r) = ev { Some(*r) } else { None })
}

#[test]
fn p1_no_dial_and_no_radio_logs_no_frequency_and_refuses_to_transmit() {
    // With no dial there is no emission to check, so the contact cannot even be transmitted;
    // the record the sequencer would make carries no frequency and no band.
    let mut e = Engine::new(config(None));
    e.apply(Command::CallCq, 0);
    assert!(e.plan_tx(SLOT + 1, 0).is_none());
    assert!(e.take_events().iter().any(|ev| matches!(ev, Event::TxRefused(v) if v.contains(&Violation::FrequencyUndetermined))));
    assert_eq!(e.snapshot(0).dial_hz, None);
    // A partner-closed exchange (they send 73 after our roger report) is logged without our
    // transmitting: its dial must be absent, not a default.
    let mut e = Engine::new(config(None));
    e.apply(Command::CallCq, 0);
    let rep = |text: &str| SlotReport { decodes: vec![decode(text)], ..Default::default() };
    e.on_slot_report(SLOT, &rep("G4XYZ K1ABC -05"), slot_start(SLOT) + 26.0, 0);
    e.on_slot_report(SLOT + 2, &rep("G4XYZ K1ABC 73"), slot_start(SLOT + 2) + 26.0, 0);
    let rec = e.take_events().into_iter().find_map(|ev| if let Event::Logged(r) = ev { Some(*r) } else { None }).expect("logged");
    assert_eq!(rec.dial_hz, None);
    assert_eq!(rec.band, None);
    assert_eq!(rec.tx_audio_hz, None, "we never transmitted in this exchange");
}

#[test]
fn p2_a_configured_dial_with_no_radio_is_logged_as_configuration_not_as_commanded() {
    let rec = contact(&mut Engine::new(config(Some(14_076_000))), 0, |_| {}).expect("logged");
    assert_eq!(rec.dial_hz, Some(Sourced::new(14_076_000.0, Provenance::Configured)));
    assert_eq!(rec.tx_audio_hz, Some(1400.0), "the audio offset we actually transmitted at");
    assert_eq!(rec.band.as_deref(), Some("20m"));
}

#[test]
fn p3_an_acknowledged_command_is_commanded() {
    let mut e = Engine::new(config(None));
    e.apply(Command::SetDial(7_076_000), 0);
    assert_eq!(e.take_dial_command(), Some(7_076_000), "the new dial is sent to the radio");
    assert!(!e.dial_commanded(), "not commanded until the radio says it took it");
    e.on_dial_command_result(7_076_000, Ok(()));
    assert!(e.dial_commanded());
    let rec = contact(&mut e, 0, |_| {}).expect("logged");
    assert_eq!(rec.dial_hz, Some(Sourced::new(7_076_000.0, Provenance::Commanded)));
    assert_eq!(rec.band.as_deref(), Some("40m"));
}

#[test]
fn p4_a_fresh_radio_reading_is_reported_by_rig_with_the_radios_value() {
    let mut e = Engine::new(config(Some(14_076_000)));
    let t = 1_000_000u64;
    let rec = contact(&mut e, t, |e| e.on_rig_reading(&Reading { dial_hz: Some(14_076_010.0), ptt: None, mode: Some("USB".into()) }, t))
        .expect("logged");
    assert_eq!(rec.dial_hz, Some(Sourced::new(14_076_010.0, Provenance::ReportedByRig)), "the radio's value, not ours");
}

#[test]
fn p5_a_command_the_radio_refused_is_not_commanded() {
    let mut e = Engine::new(config(None));
    e.apply(Command::SetDial(7_076_000), 0);
    let _ = e.take_dial_command();
    e.on_dial_command_result(7_076_000, Err("RPRT -1".into()));
    assert!(!e.dial_commanded());
    assert!(e.take_events().iter().any(|ev| matches!(ev, Event::Rig(m) if m.contains("did not accept"))));
    let rec = contact(&mut e, 0, |_| {}).expect("logged");
    assert_eq!(rec.dial_hz, Some(Sourced::new(7_076_000.0, Provenance::Configured)));
}

#[test]
fn p6_stale_readings_old_acknowledgements_and_defaults_are_not_evidence() {
    // A reading older than READING_STALE_AFTER_MS vouches for nothing.
    let mut e = Engine::new(config(Some(14_076_000)));
    e.on_rig_reading(&Reading { dial_hz: Some(14_076_000.0), ..Default::default() }, 0);
    let later = READING_STALE_AFTER_MS + 1;
    let rec = contact(&mut e, later, |_| {}).expect("logged");
    assert_eq!(rec.dial_hz.map(|d| d.source), Some(Provenance::Configured));
    // An acknowledgement for a dial the operator has since changed does not make the new one
    // commanded, and changing the dial withdraws "commanded" from the old one.
    let mut e = Engine::new(config(None));
    e.apply(Command::SetDial(7_076_000), 0);
    e.on_dial_command_result(7_076_000, Ok(()));
    assert!(e.dial_commanded());
    let mut c = config(Some(14_076_000));
    c.station = e.config().station.clone();
    e.apply(Command::UpdateConfig(Box::new(c)), 0);
    assert!(!e.dial_commanded(), "a new dial is not commanded by the old command");
    e.on_dial_command_result(7_076_000, Ok(()));
    assert!(!e.dial_commanded(), "a late acknowledgement of the old dial");
    // An unchanged dial in a configuration update is not sent to the radio again.
    let _ = e.take_dial_command();
    e.apply(Command::UpdateConfig(Box::new(config(Some(14_076_000)))), 0);
    assert_eq!(e.take_dial_command(), None);
    // And the default configuration has no dial to fabricate one from.
    assert_eq!(Config::default().operating.dial_hz, None);
}

// ----------------------------------------------------------- the real runtime, scripted radio

mod runtime_path {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use z30_engine::pipeline::AudioBlock;
    use z30_engine::ptt::{NoPtt, SystemMonotonic};
    use z30_engine::runtime::{self, AudioInput, AudioOutput, LogSink, RigControl, RuntimeParts, WallClock};

    struct NoAudio;
    impl AudioInput for NoAudio {
        fn sample_rate(&self) -> u32 {
            6000
        }
        fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String> {
            std::thread::sleep(timeout);
            Ok(None)
        }
    }
    struct Silent;
    impl AudioOutput for Silent {
        fn sample_rate(&self) -> u32 {
            48_000
        }
        fn latency_sec(&self) -> f64 {
            0.0
        }
        fn play(&mut self, _: Vec<f32>) -> Result<(), String> {
            Err("test".into())
        }
        fn stop(&mut self) {}
    }
    struct NoLog;
    impl LogSink for NoLog {
        fn log(&mut self, _: &QsoRecord) -> Result<(), String> {
            Ok(())
        }
    }
    struct Wall;
    impl WallClock for Wall {
        fn utc_now(&self) -> f64 {
            1_790_000_000.0
        }
        fn status(&self) -> String {
            "test".into()
        }
    }
    /// A radio that records set-frequency commands and answers them as scripted; it never
    /// reports a dial, so only the command's acknowledgement can make the dial "commanded".
    struct ScriptedRig {
        accept: bool,
        commands: Arc<Mutex<Vec<u64>>>,
    }
    impl RigControl for ScriptedRig {
        fn read(&mut self) -> Result<Reading, String> {
            Err("no readback in this test".into())
        }
        fn set_dial(&mut self, hz: u64) -> Result<(), String> {
            self.commands.lock().unwrap().push(hz);
            if self.accept {
                Ok(())
            } else {
                Err("RPRT -9".into())
            }
        }
    }

    fn run(rig: Option<ScriptedRig>) -> (bool, Option<u64>) {
        let handle = runtime::start(
            config(Some(14_076_000)),
            RuntimeParts {
                input: Box::new(NoAudio),
                output: Box::new(Silent),
                rig: rig.map(|r| Box::new(r) as Box<dyn RigControl>),
                ptt: Box::new(NoPtt),
                wall: Arc::new(Wall),
                mono: Arc::new(SystemMonotonic::default()),
                log: Box::new(NoLog),
                slot_tap: None,
                tx_unavailable: Some("test".into()),
            },
        );
        // At start the configured dial is configuration: nothing has been sent.
        assert!(!handle.snapshot.load().dial_commanded);
        handle.commands.send(Command::SetDial(7_076_000)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && !handle.snapshot.load().dial_commanded {
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(300));
        let snap = handle.snapshot.load();
        let out = (snap.dial_commanded, snap.dial_hz);
        handle.shutdown();
        out
    }

    #[test]
    fn p7_through_the_runtime_only_an_acknowledged_set_frequency_is_commanded() {
        let commands = Arc::new(Mutex::new(Vec::new()));
        assert_eq!(run(Some(ScriptedRig { accept: true, commands: commands.clone() })), (true, Some(7_076_000)));
        assert_eq!(*commands.lock().unwrap(), vec![7_076_000], "the operator's dial went to the radio, once");
        let refused = Arc::new(Mutex::new(Vec::new()));
        assert_eq!(run(Some(ScriptedRig { accept: false, commands: refused.clone() })), (false, Some(7_076_000)));
        assert_eq!(*refused.lock().unwrap(), vec![7_076_000]);
        // No rig control at all: nothing to command, so never commanded.
        assert_eq!(run(None), (false, Some(7_076_000)));
    }
}
