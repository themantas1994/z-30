// Baseline probe (not committed): what dial does a completed contact log with no rig control?
use z30_dsp::slot::{Decode, SlotReport};
use z30_engine::api::{Command, Event};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig};
use z30_engine::engine::Engine;
use z30_engine::slots::slot_start;
use z30_protocol::codec::{unpack_info, Message};

fn decode(text: &str, snr: Option<f64>) -> Decode {
    let m = Message::parse(text).unwrap();
    let enc = m.encode().unwrap();
    Decode { message: unpack_info(&enc.info).unwrap(), info: enc.info, snr_db: snr, dt_sec: 0.1, freq_hz: 1500.0, drift_hz: 0.0, sync: 5.0, iterations: 3, ap_type: 0, pass: 1, method: z30_dsp::ldpc::DecodeMethod::BeliefPropagation(1) }
}

#[test]
fn probe() {
    let mut cfg = Config::default();
    cfg.station.callsign = "G4XYZ".into();
    cfg.station.grid = "IO91wm".into();
    cfg.station.region = Some(Region::IaruR1);
    cfg.station.license_class = Some(LicenseClass::Full);
    cfg.ptt = PttConfig::Vox;
    println!("Config::default().operating.dial_hz = {}", Config::default().operating.dial_hz);
    let mut e = Engine::new(cfg);
    e.apply(Command::CallCq, 0);
    let s = 60_000_001i64;
    let rep = |d: Decode| SlotReport { decodes: vec![d], ..Default::default() };
    e.on_slot_report(s, &rep(decode("G4XYZ K1ABC FN31", Some(-14.2))), slot_start(s) + 26.0, 0);
    e.on_slot_report(s + 2, &rep(decode("G4XYZ K1ABC -08", Some(-12.0))), slot_start(s + 2) + 26.0, 0);
    let _ = e.take_events();
    let plan = e.plan_tx(s + 3, 0).expect("RR73 planned");
    println!("planned: {}", plan.text);
    e.tx_started(&plan);
    e.tx_finished(s + 3, true, 0);
    for ev in e.take_events() {
        if let Event::Logged(r) = ev {
            println!("logged with no rig control and the default dial: dial_hz = {:?}", r.dial_hz);
        }
    }
}
