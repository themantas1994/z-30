//! Configuration rules and the shutdown order, through `runtime::start` and its own threads.
//!
//! - A running station refuses an update that changes its PTT, rig or audio settings: the runtime
//!   opened that hardware from the settings it started with, so the gate would otherwise approve
//!   against a PTT method other than the line the station holds. The rest of an update applies.
//! - A station started with an unbounded `poll_interval_ms` still polls the rig at
//!   `MAX_POLL_INTERVAL_MS` (it scheduled the next poll at now + u64::MAX and never polled again).
//! - Shutdown releases the PTT without waiting for a rig thread stuck in a CAT read.
//!
//! Fake parts only; nothing here can reach a radio. Time is virtual, as in `tx_runtime.rs`; every
//! step waits on an observable effect with a generous real-time bound.
#![allow(clippy::field_reassign_with_default)]

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use z30_engine::api::{Command, Event, TxStatus};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig, SerialLine};
use z30_engine::pipeline::AudioBlock;
use z30_engine::ptt::{MonotonicClock, PttAck, PttError, PttLine};
use z30_engine::qso::QsoRecord;
use z30_engine::rig::Reading;
use z30_engine::runtime::{
    self, AudioInput, AudioOutput, LogSink, RigControl, RuntimeHandle, RuntimeParts, WallClock, MAX_POLL_INTERVAL_MS, PTT_LEAD_SEC,
};
use z30_engine::slots::slot_start;
use z30_engine::txgate::Violation;

const RATE: u32 = 6000;
/// An even slot (the station transmits in even slots) far from the epoch.
const SLOT: i64 = 60_000_000;

/// Virtual time in microseconds since `t0()`; wall = t0 + t, mono = t in ms.
#[derive(Clone, Default)]
struct Time(Arc<AtomicU64>);

fn t0() -> f64 {
    slot_start(SLOT) - 5.0
}

impl Time {
    fn set_utc(&self, utc: f64) {
        let us = ((utc - t0()) * 1e6).round().max(0.0) as u64;
        self.0.fetch_max(us, Ordering::SeqCst);
    }
    fn add_ms(&self, ms: u64) {
        self.0.fetch_add(ms * 1000, Ordering::SeqCst);
    }
    fn ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst) / 1000
    }
}

impl MonotonicClock for Time {
    fn now_ms(&self) -> u64 {
        self.ms()
    }
}

impl WallClock for Time {
    fn utc_now(&self) -> f64 {
        t0() + self.0.load(Ordering::SeqCst) as f64 * 1e-6
    }
    fn status(&self) -> String {
        "virtual clock (test)".into()
    }
}

struct NoAudio;

impl AudioInput for NoAudio {
    fn sample_rate(&self) -> u32 {
        RATE
    }
    fn next_block(&mut self, _t: Duration) -> Result<Option<AudioBlock>, String> {
        std::thread::sleep(Duration::from_millis(5));
        Ok(None)
    }
}

/// An output that accepts everything; `latency_sec` is asked once per plan.
#[derive(Clone, Default)]
struct Out {
    plans: Arc<AtomicUsize>,
}

impl AudioOutput for Out {
    fn sample_rate(&self) -> u32 {
        RATE
    }
    fn latency_sec(&self) -> f64 {
        self.plans.fetch_add(1, Ordering::SeqCst);
        0.0
    }
    fn play(&mut self, _samples: Vec<f32>) -> Result<(), String> {
        Ok(())
    }
    fn stop(&mut self) {}
}

/// A keying line that keys whenever it is told to: only the gate stands between it and the air.
#[derive(Clone, Default)]
struct Line {
    on_air: Arc<AtomicBool>,
    keys: Arc<AtomicUsize>,
}

impl Line {
    fn on_air(&self) -> bool {
        self.on_air.load(Ordering::SeqCst)
    }
}

impl PttLine for Line {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        if keyed {
            self.keys.fetch_add(1, Ordering::SeqCst);
        }
        self.on_air.store(keyed, Ordering::SeqCst);
        Ok(PttAck::Confirmed)
    }
    fn describe(&self) -> String {
        "test line".into()
    }
}

/// A rig on the dial in USB. While the test holds `stuck`, a read blocks (a hung CAT exchange).
#[derive(Clone, Default)]
struct Rig {
    time: Time,
    reads: Arc<Mutex<Vec<u64>>>,
    stuck: Arc<Mutex<()>>,
}

impl RigControl for Rig {
    fn read(&mut self) -> Result<Reading, String> {
        let _g = self.stuck.lock().unwrap_or_else(|p| p.into_inner());
        self.reads.lock().unwrap().push(self.time.ms());
        Ok(Reading { dial_hz: Some(14_076_000.0), ptt: None, mode: Some("USB".into()) })
    }
    fn set_dial(&mut self, _hz: u64) -> Result<(), String> {
        Ok(())
    }
}

struct Book;

impl LogSink for Book {
    fn log(&mut self, _rec: &QsoRecord) -> Result<(), String> {
        Ok(())
    }
}

fn config() -> Config {
    let mut c = Config::default();
    c.station.callsign = "K1ABC".into();
    c.station.grid = "FN31".into();
    c.station.region = Some(Region::Us);
    c.station.license_class = Some(LicenseClass::UsGeneral);
    c.ptt = PttConfig::Vox; // the configured method; the line itself is the fake above
    c.audio.tx_level = 0.5;
    c.operating.dial_hz = Some(14_076_000);
    c.operating.tx_audio_hz = 1500.0;
    c
}

fn serial() -> PttConfig {
    PttConfig::Serial { port: "/dev/ttyUSB0".into(), line: SerialLine::Rts, active_high: true }
}

fn wait_until(what: &str, f: impl Fn() -> bool) {
    let t = Instant::now();
    while !f() {
        assert!(t.elapsed() < Duration::from_secs(10), "timed out waiting for: {what}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

struct Station {
    time: Time,
    line: Line,
    out: Out,
    rt: Option<RuntimeHandle>,
    events: Vec<Event>,
}

impl Station {
    fn start(cfg: Config, rig: Option<Rig>) -> Station {
        let time = rig.as_ref().map(|r| r.time.clone()).unwrap_or_default();
        let (line, out) = (Line::default(), Out::default());
        let rt = runtime::start(
            cfg,
            RuntimeParts {
                input: Box::new(NoAudio),
                output: Box::new(out.clone()),
                rig: rig.map(|r| Box::new(r) as Box<dyn RigControl>),
                ptt: Box::new(line.clone()),
                wall: Arc::new(time.clone()),
                mono: Arc::new(time.clone()),
                log: Box::new(Book),
                slot_tap: None,
                tx_unavailable: None,
            },
        );
        Station { time, line, out, rt: Some(rt), events: Vec::new() }
    }

    fn rt(&self) -> &RuntimeHandle {
        self.rt.as_ref().unwrap()
    }

    fn config(&self) -> Config {
        (*self.rt().snapshot.load().config).clone()
    }

    fn drain(&mut self) {
        let rx = self.rt().events.clone();
        while let Ok(e) = rx.try_recv() {
            self.events.push(e);
        }
    }

    fn rejections(&self) -> usize {
        self.events.iter().filter(|e| matches!(e, Event::ConfigRejected(_))).count()
    }

    /// Sends an update and waits until the control thread has answered it: refused (an event)
    /// or applied (the snapshot shows it).
    fn update(&mut self, c: Config) -> bool {
        let before = self.rejections();
        self.rt().commands.send(Command::UpdateConfig(Box::new(c.clone()))).unwrap();
        let t = Instant::now();
        loop {
            self.drain();
            if self.rejections() > before {
                return false;
            }
            if self.config() == c {
                return true;
            }
            assert!(t.elapsed() < Duration::from_secs(10), "the update was never answered");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// Waits, draining events, until one satisfies `f`.
    fn wait_event(&mut self, what: &str, f: impl Fn(&Event) -> bool) {
        let t = Instant::now();
        while !self.events.iter().any(&f) {
            assert!(t.elapsed() < Duration::from_secs(10), "timed out waiting for: {what}; events: {:?}", self.events);
            std::thread::sleep(Duration::from_millis(2));
            self.drain();
        }
    }

    fn arm_cq(&self) {
        self.rt().commands.send(Command::CallCq).unwrap();
        wait_until("CQ armed", || self.rt().snapshot.load().tx != TxStatus::Idle);
    }

    /// Brings the armed station to the plan of `slot`, then to its key time.
    fn to_key_time(&self, slot: i64) {
        let plans = self.out.plans.load(Ordering::SeqCst);
        self.time.set_utc(slot_start(slot) - 0.55);
        wait_until("the plan for the slot", || self.out.plans.load(Ordering::SeqCst) > plans);
        self.time.set_utc(slot_start(slot) - PTT_LEAD_SEC);
    }
}

// ------------------------------------------------------------------- configuration updates

type Change = (&'static str, fn(&mut Config));

#[test]
fn a_running_station_refuses_ptt_rig_and_audio_changes_and_applies_the_rest() {
    let mut st = Station::start(config(), None);
    let changes: [Change; 4] = [
        ("PTT method", |c| c.ptt = serial()),
        ("rig control", |c| c.rig.rigctld_host = "localhost".into()),
        ("output device", |c| c.audio.output_device = Some("USB Audio CODEC".into())),
        ("transmit level", |c| c.audio.tx_level = 0.75),
    ];
    for (name, change) in changes {
        let mut c = config();
        change(&mut c);
        assert!(!st.update(c), "the {name} change was applied to a running station");
        assert_eq!(st.config(), config(), "{name}");
    }
    let mut c = config();
    c.station.callsign = "G4XYZ".into();
    c.operating.tx_audio_hz = 1600.0;
    assert!(st.update(c.clone()), "an update that leaves the hardware settings alone applies");
    assert_eq!(st.config(), c);
    assert!(st.rt.take().unwrap().shutdown().release_confirmed());
}

#[test]
fn the_gate_never_approves_against_a_ptt_method_other_than_the_one_the_station_opened() {
    // Started with no PTT method. Its line keys whatever it is told (a fake), so only the gate
    // stands between an update that names a PTT method and the air.
    let mut started = config();
    started.ptt = PttConfig::None;
    let mut st = Station::start(started, None);
    assert!(!st.update(config()), "a PTT method was applied to a station that opened none");
    assert_eq!(st.config().ptt, PttConfig::None);
    st.arm_cq();
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait_event(
        "the gate's refusal for the PTT method the station holds",
        |e| matches!(e, Event::TxRefused(v) if v.contains(&Violation::PttNotConfigured)),
    );
    st.time.set_utc(slot_start(SLOT) + 1.0);
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(st.line.keys.load(Ordering::SeqCst), 0, "the line was keyed");
    assert!(st.rt.take().unwrap().shutdown().release_confirmed());
}

#[test]
fn a_hardware_change_while_keyed_is_refused_the_key_drove_line_is_released_and_a_restart_applies_it() {
    let mut st = Station::start(config(), None);
    st.arm_cq();
    st.to_key_time(SLOT);
    wait_until("the key", || st.line.on_air());
    let mut c = config();
    c.ptt = serial();
    assert!(!st.update(c.clone()), "a PTT change was applied while keyed");
    assert_eq!(st.config().ptt, PttConfig::Vox);
    assert!(st.line.on_air(), "a refused update changes nothing, so it ends nothing");
    // Shutdown releases the line the key drove; the new settings take effect when a runtime
    // opens the hardware again.
    let report = st.rt.take().unwrap().shutdown();
    assert!(report.release_confirmed(), "{report:?}");
    assert!(!st.line.on_air());
    let mut st2 = Station::start(c.clone(), None);
    assert_eq!(st2.config(), c);
    assert!(st2.rt.take().unwrap().shutdown().release_confirmed());
}

// ---------------------------------------------------------------------- rig poll interval

#[test]
fn a_station_started_with_an_unbounded_poll_interval_still_polls_at_the_maximum() {
    let mut c = config();
    c.rig.rigctld_host = "test".into();
    c.rig.poll_interval_ms = u64::MAX;
    let rig = Rig::default();
    let mut st = Station::start(c, Some(rig.clone()));
    // 10 s of virtual time in 20 ms steps: polls at about 0, 3, 6 and 9 s.
    for _ in 0..500 {
        st.time.add_ms(20);
        std::thread::sleep(Duration::from_millis(2));
    }
    let reads = rig.reads.lock().unwrap().clone();
    assert!((3..=5).contains(&reads.len()), "{} polls in 10 s ({reads:?}) at a {MAX_POLL_INTERVAL_MS} ms maximum", reads.len());
    assert!(st.rt.take().unwrap().shutdown().release_confirmed());
}

// ------------------------------------------------------------------------- shutdown order

#[test]
fn shutdown_releases_the_ptt_without_waiting_for_a_rig_thread_stuck_in_a_cat_read() {
    let mut c = config();
    c.rig.rigctld_host = "test".into();
    let rig = Rig::default();
    // The rig thread's first read blocks until the end of the test: a hung CAT exchange. With no
    // reading the dial is unverified, not wrong, so the station still transmits.
    let stuck = rig.stuck.clone();
    let held = stuck.lock().unwrap();
    let mut st = Station::start(c, Some(rig));
    st.arm_cq();
    st.to_key_time(SLOT);
    wait_until("the key", || st.line.on_air());
    let rt = st.rt.take().unwrap();
    let (done, returned) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
        let report = rt.shutdown();
        let _ = done.send(());
        report
    });
    wait_until("the PTT release while the rig thread is stuck", || !st.line.on_air());
    assert!(returned.try_recv().is_err(), "shutdown returned without joining the rig thread");
    drop(held);
    let report = shutdown.join().unwrap();
    assert!(report.release_confirmed(), "{report:?}");
    assert!(!st.line.on_air());
}
