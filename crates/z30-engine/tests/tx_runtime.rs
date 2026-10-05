//! The production transmit loop, through `runtime::start` and its own threads.
//!
//! 2026-09-28 audit F-04 (TX-04): every `runtime::start` test ran with `tx_unavailable` set, so
//! the transmit wiring in the control loop was untested and the mutations RT-halt, RT-wd,
//! RT-keyfail and RT-unkey survived. Here the station is configured and can transmit; only the
//! parts are fake: a recording PTT line, a recording audio output whose device "consumes"
//! samples on the virtual clock, a fake rig, a log sink, and a wall/monotonic clock the test
//! moves. Every step waits on an observable effect (a line change, a `play`, an event) with a
//! generous real-time timeout, never on a fixed sleep being long enough.
//!
//! Fake parts only; nothing here can reach a radio. If one of these fails, the change is wrong
//! - do not edit the test.
#![allow(clippy::field_reassign_with_default)]

use crossbeam_channel::Receiver;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use z30_engine::api::{Command, Event, TxOutcome};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig};
use z30_engine::pipeline::AudioBlock;
use z30_engine::ptt::{MonotonicClock, PttAck, PttError, PttLine, PttState, MAX_TX_SECONDS};
use z30_engine::qso::QsoRecord;
use z30_engine::rig::{Reading, PTT_SETTLE_MS};
use z30_engine::runtime::{
    self, AudioInput, AudioOutput, LogSink, OutputStopper, RigControl, RigPollSchedule, RuntimeHandle, RuntimeParts, WallClock,
    MIN_POLL_INTERVAL_MS, PTT_LEAD_SEC, SHUTDOWN_RELEASE_WAIT_MS,
};
use z30_engine::slots::slot_start;

const RATE: u32 = 6000;
/// An even slot (the station transmits in even slots) far from the epoch.
const SLOT: i64 = 60_000_000;

// ------------------------------------------------------------------------------- virtual time

/// Virtual time in microseconds since `T0`; wall = T0 + t, mono = t in ms.
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
    fn utc(&self) -> f64 {
        t0() + self.0.load(Ordering::SeqCst) as f64 * 1e-6
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
        self.utc()
    }
    fn status(&self) -> String {
        "virtual clock (test)".into()
    }
}

// ------------------------------------------------------------------------------------ fakes

/// No audio, unless a test queues blocks (to make the receive timeline see a clock step).
#[derive(Clone, Default)]
struct AudioIn(Arc<Mutex<std::collections::VecDeque<AudioBlock>>>);
impl AudioInput for AudioIn {
    fn sample_rate(&self) -> u32 {
        RATE
    }
    fn next_block(&mut self, _t: Duration) -> Result<Option<AudioBlock>, String> {
        if let Some(b) = self.0.lock().unwrap().pop_front() {
            return Ok(Some(b));
        }
        std::thread::sleep(Duration::from_millis(5));
        Ok(None)
    }
}

/// A keying line with a physical state, recording (virtual ms, keyed) for every change.
#[derive(Clone, Default)]
struct Line {
    time: Time,
    hw: Arc<AtomicBool>,
    log: Arc<Mutex<Vec<(u64, bool)>>>,
    fail_keys: Arc<AtomicUsize>,
    fail_releases: Arc<AtomicUsize>,
    /// A key takes this long (the virtual clock moves while the driver runs: a slow CAT key).
    key_takes_ms: Arc<AtomicU64>,
    /// While held by the test, `set(true)` blocks (a hung driver on the control thread).
    key_gate: Arc<Mutex<()>>,
    /// A release takes this long in real time (rigctld waiting out its timeouts).
    release_takes_real_ms: Arc<AtomicU64>,
}

impl PttLine for Line {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        if keyed {
            let _g = self.key_gate.lock().unwrap_or_else(|p| p.into_inner());
            self.time.add_ms(self.key_takes_ms.load(Ordering::SeqCst));
            if self.fail_keys.load(Ordering::SeqCst) > 0 {
                self.fail_keys.fetch_sub(1, Ordering::SeqCst);
                return Err(PttError("the interface refused the key (test)".into()));
            }
        } else if self.release_takes_real_ms.load(Ordering::SeqCst) > 0 {
            std::thread::sleep(Duration::from_millis(self.release_takes_real_ms.load(Ordering::SeqCst)));
        }
        if !keyed && self.fail_releases.load(Ordering::SeqCst) > 0 {
            self.fail_releases.fetch_sub(1, Ordering::SeqCst);
            return Err(PttError("rigctld: timed out (test)".into()));
        }
        self.hw.store(keyed, Ordering::SeqCst);
        self.log.lock().unwrap().push((self.time.ms(), keyed));
        Ok(PttAck::Confirmed)
    }
    fn describe(&self) -> String {
        "test line".into()
    }
}

impl Line {
    fn keys(&self) -> Vec<u64> {
        self.log.lock().unwrap().iter().filter(|(_, k)| *k).map(|(t, _)| *t).collect()
    }
    fn changes(&self) -> Vec<(u64, bool)> {
        self.log.lock().unwrap().clone()
    }
    fn keyed(&self) -> bool {
        self.hw.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
struct OutState {
    plays: Vec<(u64, usize)>,
    stops: Vec<u64>,
    /// Samples of the current frame and when it was queued (virtual ms).
    current: Option<(u64, usize)>,
    failure: Option<String>,
    fail_play: bool,
    recover_ok: bool,
    stall: bool,
    latency_queries: usize,
    samples: Vec<f32>,
}

/// An output whose device takes samples at RATE on the virtual clock (unless stalled).
#[derive(Clone)]
struct Out {
    time: Time,
    st: Arc<Mutex<OutState>>,
    /// While held by the test, `play` blocks (the control thread stuck in the output driver).
    play_gate: Arc<Mutex<()>>,
    stopped_from_any_thread: Arc<AtomicUsize>,
    /// Bumped by each successful `recover`: like a reopened cpal stream, a stop taken from an
    /// earlier generation reaches a dead stream and silences nothing (review M-1).
    generation: Arc<AtomicUsize>,
}

impl Out {
    fn new(time: &Time) -> Self {
        Out {
            time: time.clone(),
            st: Arc::default(),
            play_gate: Arc::default(),
            stopped_from_any_thread: Arc::default(),
            generation: Arc::default(),
        }
    }
    fn plays(&self) -> Vec<(u64, usize)> {
        self.st.lock().unwrap().plays.clone()
    }
    fn stops(&self) -> Vec<u64> {
        self.st.lock().unwrap().stops.clone()
    }
}

impl AudioOutput for Out {
    fn sample_rate(&self) -> u32 {
        RATE
    }
    fn latency_sec(&self) -> f64 {
        self.st.lock().unwrap().latency_queries += 1;
        0.0
    }
    fn play(&mut self, samples: Vec<f32>) -> Result<(), String> {
        let _g = self.play_gate.lock().unwrap_or_else(|p| p.into_inner());
        let mut st = self.st.lock().unwrap();
        let now = self.time.ms();
        st.plays.push((now, samples.len()));
        if st.fail_play {
            // A partial push, as the real ring can do: part of the frame is queued.
            st.current = Some((now, samples.len() / 2));
            return Err("output ring full (test)".into());
        }
        st.current = Some((now, samples.len()));
        st.samples = samples;
        Ok(())
    }
    fn stop(&mut self) {
        let mut st = self.st.lock().unwrap();
        st.stops.push(self.time.ms());
        st.current = None;
    }
    fn queued_samples(&self) -> Option<usize> {
        let st = self.st.lock().unwrap();
        Some(match st.current {
            None => 0,
            Some((_, n)) if st.stall => n,
            Some((at, n)) => n.saturating_sub((self.time.ms().saturating_sub(at) as usize) * RATE as usize / 1000),
        })
    }
    fn failure(&self) -> Option<String> {
        self.st.lock().unwrap().failure.clone()
    }
    fn recover(&mut self) -> Result<(), String> {
        let mut st = self.st.lock().unwrap();
        if st.recover_ok {
            st.failure = None;
            self.generation.fetch_add(1, Ordering::SeqCst);
            Ok(())
        } else {
            Err("still unplugged (test)".into())
        }
    }
    fn stopper(&self) -> Option<OutputStopper> {
        let (st, n, time) = (self.st.clone(), self.stopped_from_any_thread.clone(), self.time.clone());
        let (generation, mine) = (self.generation.clone(), self.generation.load(Ordering::SeqCst));
        Some(Arc::new(move || {
            if generation.load(Ordering::SeqCst) != mine {
                return; // the stream this stop belonged to was replaced
            }
            n.fetch_add(1, Ordering::SeqCst);
            // Never blocks on the output's own lock for long: the test's lock is only held briefly.
            let mut st = st.lock().unwrap();
            st.stops.push(time.ms());
            st.current = None;
        }))
    }
}

/// A rig that is on the dial, in USB, and records when it was read (virtual ms).
#[derive(Clone)]
struct Rig {
    time: Time,
    reads: Arc<Mutex<Vec<u64>>>,
    dial: Arc<AtomicU64>,
}

impl RigControl for Rig {
    fn read(&mut self) -> Result<Reading, String> {
        self.reads.lock().unwrap().push(self.time.ms());
        Ok(Reading { dial_hz: Some(self.dial.load(Ordering::SeqCst) as f64), ptt: None, mode: Some("USB".into()) })
    }
    fn set_dial(&mut self, _hz: u64) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Clone, Default)]
struct Book(Arc<Mutex<Vec<QsoRecord>>>);
impl LogSink for Book {
    fn log(&mut self, rec: &QsoRecord) -> Result<(), String> {
        self.0.lock().unwrap().push(rec.clone());
        Ok(())
    }
}

// --------------------------------------------------------------------------------- station

fn config() -> Config {
    let mut c = Config::default();
    c.station.callsign = "K1ABC".into();
    c.station.grid = "FN31".into();
    c.station.region = Some(Region::Us);
    c.station.license_class = Some(LicenseClass::UsGeneral);
    c.ptt = PttConfig::Vox; // the configured method; the line itself is the fake below
    c.audio.tx_level = 0.5;
    c.operating.dial_hz = Some(14_076_000);
    c.operating.tx_audio_hz = 1500.0;
    c
}

struct Station {
    time: Time,
    line: Line,
    out: Out,
    rig_reads: Arc<Mutex<Vec<u64>>>,
    rig_dial: Arc<AtomicU64>,
    rt: Option<RuntimeHandle>,
    events: Vec<Event>,
    audio_in: AudioIn,
}

impl Station {
    fn start_with(cfg: Config, with_rig: bool) -> Station {
        let time = Time::default();
        let line = Line { time: time.clone(), ..Default::default() };
        let out = Out::new(&time);
        let rig_reads = Arc::new(Mutex::new(Vec::new()));
        let rig_dial = Arc::new(AtomicU64::new(14_076_000));
        let rig: Option<Box<dyn RigControl>> =
            with_rig.then(|| Box::new(Rig { time: time.clone(), reads: rig_reads.clone(), dial: rig_dial.clone() }) as Box<dyn RigControl>);
        let audio_in = AudioIn::default();
        let rt = runtime::start(
            cfg,
            RuntimeParts {
                input: Box::new(audio_in.clone()),
                output: Box::new(out.clone()),
                rig,
                ptt: Box::new(line.clone()),
                wall: Arc::new(time.clone()),
                mono: Arc::new(time.clone()),
                log: Box::new(Book::default()),
                slot_tap: None,
                tx_unavailable: None,
            },
        );
        Station { time, line, out, rig_reads, rig_dial, rt: Some(rt), events: Vec::new(), audio_in }
    }

    fn start() -> Station {
        Self::start_with(config(), false)
    }

    fn rt(&self) -> &RuntimeHandle {
        self.rt.as_ref().unwrap()
    }

    fn send(&self, c: Command) {
        let arm = matches!(c, Command::CallCq);
        self.rt().commands.send(c).unwrap();
        if arm {
            // The plan is decided once per slot; a CQ the control thread has not processed yet
            // when the clock enters the plan window is (correctly) not planned for that slot.
            let t = Instant::now();
            while self.rt().snapshot.load().tx == z30_engine::api::TxStatus::Idle && t.elapsed() < Duration::from_secs(10) {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }

    fn drain(&mut self) {
        let rx: Receiver<Event> = self.rt().events.clone();
        while let Ok(e) = rx.try_recv() {
            self.events.push(e);
        }
    }

    /// Waits (real time, bounded) until `f` holds, draining events meanwhile.
    fn wait(&mut self, what: &str, f: impl Fn(&Station) -> bool) {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(10) {
            self.drain();
            if f(self) {
                return;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        let snap = self.rt().snapshot.load();
        let lq = self.out.st.lock().unwrap().latency_queries;
        let reads = self.rig_reads.lock().unwrap().clone();
        eprintln!(
            "DEBUG t={:.3} lq={lq} line={:?} plays={:?} reads={reads:?}",
            self.time.utc() - slot_start(SLOT),
            self.line.changes(),
            self.out.plays()
        );
        panic!("timed out waiting for: {what}; tx {:?}; blockers {:?}; events so far: {:?}", snap.tx, snap.tx_blockers, self.events);
    }

    /// Lets the control thread run a few dozen ticks at the current virtual time.
    fn settle(&mut self) {
        std::thread::sleep(Duration::from_millis(150));
        self.drain();
    }

    fn outcome(&self, slot: i64) -> Option<TxOutcome> {
        self.events.iter().find_map(|e| match e {
            Event::TxFinished { slot: s, outcome } if *s == slot => Some(outcome.clone()),
            _ => None,
        })
    }

    fn blockers(&self) -> Vec<String> {
        self.rt().snapshot.load().tx_blockers.clone()
    }

    fn faults(&self) -> Vec<String> {
        self.events.iter().filter_map(|e| if let Event::TxFault(s) = e { Some(s.clone()) } else { None }).collect()
    }

    /// Arms CQ and brings the timeline to the key of `slot`; returns when the line is keyed.
    fn key_slot(&mut self, slot: i64) {
        let q0 = self.out.st.lock().unwrap().latency_queries;
        self.time.set_utc(slot_start(slot) - 0.55);
        self.wait("the plan for the slot", |s| s.out.st.lock().unwrap().latency_queries > q0);
        let keys = self.line.keys().len();
        self.time.set_utc(slot_start(slot) - PTT_LEAD_SEC);
        self.wait("the key", |s| s.line.keys().len() > keys);
    }

    /// From a keyed slot, starts the audio; returns when `play` was called.
    fn start_audio(&mut self, slot: i64) {
        let n = self.out.plays().len();
        self.time.set_utc(slot_start(slot));
        self.wait("play", |s| s.out.plays().len() > n);
    }
}

impl Drop for Station {
    fn drop(&mut self) {
        if let Some(rt) = self.rt.take() {
            // Not asserted here: a failing test is already unwinding through this.
            let _ = rt.shutdown();
        }
    }
}

fn frame_ms() -> u64 {
    (z30_protocol::FRAME_SEC * 1000.0).round() as u64
}

// ----------------------------------------------------------------------------------- tests

#[test]
fn rt_a_frame_is_keyed_played_whole_and_released_in_that_order_and_reported_complete() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    let (play_at, n) = st.out.plays()[0];
    assert_eq!(n, RATE as usize * 24, "one whole frame at the output rate");
    st.time.set_utc(slot_start(SLOT) + 24.2);
    st.wait("the release", |s| !s.line.keyed());
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert_eq!(st.outcome(SLOT), Some(TxOutcome::Complete));
    let ch = st.line.changes();
    assert_eq!(ch.iter().map(|c| c.1).collect::<Vec<_>>(), vec![true, false], "{ch:?}");
    let (key_at, unkey_at) = (ch[0].0, ch[1].0);
    assert!(key_at <= play_at && play_at < unkey_at);
    assert!(unkey_at - play_at >= frame_ms(), "the release came {} ms after the audio started", unkey_at - play_at);
    assert!(st.out.stops().iter().any(|&t| t >= play_at + frame_ms()), "the output is stopped at the end of the frame");
    assert!(st.events.iter().any(|e| matches!(e, Event::TxStarted { slot, .. } if *slot == SLOT)));
}

#[test]
fn rt_halt_between_plan_and_key_abandons_the_transmission_and_disarms() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    st.rt().halt();
    st.settle();
    for t in [slot_start(SLOT) - PTT_LEAD_SEC, slot_start(SLOT), slot_start(SLOT) + 30.0, slot_start(SLOT + 2) + 1.0] {
        st.time.set_utc(t);
        st.settle();
    }
    assert!(st.line.keys().is_empty(), "keyed after HALT: {:?}", st.line.changes());
    assert!(st.out.plays().is_empty());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(_))), "{:?}", st.events);
}

#[test]
fn rt_halt_while_keyed_stops_the_audio_releases_the_line_at_once_and_disarms() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.time.set_utc(slot_start(SLOT) + 5.0);
    st.settle();
    let t = Instant::now();
    st.rt().halt();
    assert!(t.elapsed() < Duration::from_millis(100), "halt() blocked for {:?}", t.elapsed());
    st.wait("the release after HALT", |s| !s.line.keyed());
    assert!(st.out.stopped_from_any_thread.load(Ordering::SeqCst) >= 1, "HALT silences the output itself");
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(_))));
    // Disarmed: the next slot of ours is not keyed.
    st.time.set_utc(slot_start(SLOT + 2) + 1.0);
    st.settle();
    assert_eq!(st.line.keys().len(), 1, "{:?}", st.line.changes());
}

#[test]
fn rt_halt_does_not_wait_for_a_slow_release_driver() {
    // Review L-1: HALT drove the release on the calling (GUI) thread, so a rigctld waiting out
    // its timeouts froze the window, HALT button included, during an emergency.
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.time.set_utc(slot_start(SLOT) + 5.0);
    st.settle();
    st.line.release_takes_real_ms.store(600, Ordering::SeqCst);
    let t = Instant::now();
    st.rt().halt();
    assert!(t.elapsed() < Duration::from_millis(100), "halt() waited {:?} for the driver", t.elapsed());
    assert!(st.out.stopped_from_any_thread.load(Ordering::SeqCst) >= 1, "the output is still silenced synchronously");
    st.wait("the release, driven elsewhere", |s| !s.line.keyed());
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(_))));
}

#[test]
fn rt_halt_is_not_delayed_by_a_blocked_control_thread() {
    // The control thread is stuck inside the PTT driver's set(true). HALT must still return at
    // once, and the line the driver keys when it finally returns must be released, with no audio.
    let mut st = Station::start();
    let gate = st.line.key_gate.clone();
    let held = gate.lock().unwrap();
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    st.time.set_utc(slot_start(SLOT) - PTT_LEAD_SEC);
    st.wait("the control thread entering the key", |s| s.rt().ptt_state() == PttState::Keyed);
    // The command queue is not the path: fill it while the control thread is blocked.
    for _ in 0..64 {
        let _ = st.rt().commands.try_send(Command::SetAudioFrequencies { rx_hz: 1500.0, tx_hz: 1500.0 });
    }
    let t = Instant::now();
    st.rt().halt();
    assert!(t.elapsed() < Duration::from_millis(100), "halt() blocked for {:?} behind the control thread", t.elapsed());
    assert!(st.out.stopped_from_any_thread.load(Ordering::SeqCst) >= 1);
    drop(held); // the driver returns, having keyed the (fake) hardware
    st.wait("the release of the line the late driver keyed", |s| {
        s.rt().ptt_state() == PttState::Released && s.line.changes().last().map(|c| c.1) == Some(false)
    });
    st.time.set_utc(slot_start(SLOT) + 1.0);
    st.settle();
    st.time.set_utc(slot_start(SLOT) + 30.0);
    st.settle();
    assert!(st.out.plays().is_empty(), "audio was started after HALT");
    assert!(!st.line.keyed());
}

#[test]
fn rt_the_watchdog_releases_a_stuck_transmission_and_the_runtime_reports_it() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    let key_ms = st.line.keys()[0];
    // The control thread gets stuck in the output driver while keyed.
    let gate = st.out.play_gate.clone();
    let held = gate.lock().unwrap();
    st.time.set_utc(slot_start(SLOT));
    st.settle();
    st.time.set_utc(t0() + (key_ms + MAX_TX_SECONDS * 1000) as f64 / 1000.0 + 0.01);
    st.wait("the watchdog's release", |s| !s.line.keyed());
    drop(held);
    st.wait("the runtime's report", |s| s.outcome(SLOT).is_some());
    assert_eq!(st.outcome(SLOT), Some(TxOutcome::WatchdogAborted));
    assert!(st.events.iter().any(|e| matches!(e, Event::WatchdogReleased)));
    assert!(st.faults().iter().any(|f| f.contains("watchdog")), "{:?}", st.faults());
    assert!(!st.out.stops().is_empty(), "the audio is stopped after a watchdog release");
    // Disarmed.
    st.time.set_utc(slot_start(SLOT + 2) + 1.0);
    st.settle();
    assert_eq!(st.line.keys().len(), 1);
}

#[test]
fn rt_a_refused_key_plays_nothing_and_is_reported_failed() {
    let mut st = Station::start();
    st.line.fail_keys.store(1, Ordering::SeqCst);
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    st.time.set_utc(slot_start(SLOT) - PTT_LEAD_SEC);
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Failed(_))), "{:?}", st.outcome(SLOT));
    assert!(st.faults().iter().any(|f| f.contains("PTT failed")));
    // Exactly at the audio time, and then through the frame: a jump well past it would be
    // abandoned as a late start anyway and hide audio started after a refused key (the
    // mutation RT-keyfail survived an earlier version of this test that way).
    for t in [slot_start(SLOT), slot_start(SLOT) + 0.2, slot_start(SLOT) + 12.0] {
        st.time.set_utc(t);
        st.settle();
    }
    assert!(st.out.plays().is_empty(), "audio played after a refused key");
    assert!(!st.line.keyed());
}

#[test]
fn rt_an_unconfirmed_release_is_reported_blocks_transmission_and_is_retried_until_confirmed() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.line.fail_releases.store(3, Ordering::SeqCst);
    st.time.set_utc(slot_start(SLOT) + 24.2);
    st.wait("the release fault", |s| s.faults().iter().any(|f| f.contains("NOT confirmed")));
    // While unconfirmed the gate refuses; the watchdog thread keeps retrying (every 50 ms real).
    st.wait("the retried release", |s| !s.line.keyed());
    st.wait("the confirmation", |s| s.events.iter().any(|e| matches!(e, Event::PttReleaseConfirmed { .. })));
    st.settle();
    // Reported once: the watchdog's refused retries are not reported again after the release
    // was confirmed.
    assert_eq!(st.events.iter().filter(|e| matches!(e, Event::PttReleaseConfirmed { .. })).count(), 1, "{:?}", st.events);
    assert_eq!(st.faults().iter().filter(|f| f.contains("confirmed on a retry")).count(), 0, "{:?}", st.faults());
    assert!(!st.blockers().iter().any(|b| b.contains("not confirmed")), "{:?}", st.blockers());
    // The frame was played whole before the release was attempted.
    assert_eq!(st.outcome(SLOT), Some(TxOutcome::Complete));
}

#[test]
fn rt_an_unconfirmed_release_is_a_gate_refusal_while_it_lasts() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.line.fail_releases.store(usize::MAX, Ordering::SeqCst);
    st.time.set_utc(slot_start(SLOT) + 24.2);
    st.wait("the refusal", |s| s.blockers().iter().any(|b| b.contains("not confirmed by the hardware")));
    assert!(st.line.keyed(), "the fake hardware is still keyed");
    assert_eq!(st.rt().ptt_state(), PttState::ReleasePending);
    // No new transmission while the old one may still be on the air.
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT + 2) + 1.0);
    st.settle();
    assert_eq!(st.line.keys().len(), 1);
    st.line.fail_releases.store(0, Ordering::SeqCst);
    st.wait("the release", |s| !s.line.keyed());
}

#[test]
fn rt_an_output_failure_while_keyed_stops_releases_refuses_and_recovers() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.time.set_utc(slot_start(SLOT) + 3.0);
    st.out.st.lock().unwrap().failure = Some("device unplugged (test)".into());
    st.wait("the release after the output failed", |s| !s.line.keyed());
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Failed(ref w)) if w.contains("unplugged")), "{:?}", st.outcome(SLOT));
    assert!(!st.out.stops().is_empty());
    st.wait("the refusal", |s| s.blockers().iter().any(|b| b.contains("audio output failed")));
    // It does not recover while the device is still gone...
    st.time.add_ms(6_000);
    st.settle();
    assert!(st.blockers().iter().any(|b| b.contains("audio output failed")));
    // ...and does once it can be reopened; the station can transmit again.
    st.out.st.lock().unwrap().recover_ok = true;
    st.time.add_ms(6_000);
    st.wait("the recovery", |s| s.events.iter().any(|e| matches!(e, Event::Audio(m) if m.contains("reopened"))));
    st.settle();
    assert!(!st.blockers().iter().any(|b| b.contains("audio output")), "{:?}", st.blockers());
    st.send(Command::CallCq);
    st.key_slot(SLOT + 4);
    st.start_audio(SLOT + 4);
    assert_eq!(st.out.plays().len(), 2);
}

#[test]
fn rt_halt_after_an_output_recovery_still_silences_the_live_output_from_the_calling_thread() {
    // Review M-1: a recovered output is a new stream. A stop taken once at start-up flushed the
    // dead one, so after a single glitch HALT left the frame playing (and a VOX radio keyed)
    // until the control thread got round to it.
    let mut st = Station::start();
    st.out.st.lock().unwrap().failure = Some("device unplugged (test)".into());
    st.wait("the refusal", |s| s.blockers().iter().any(|b| b.contains("audio output failed")));
    st.out.st.lock().unwrap().recover_ok = true;
    st.time.add_ms(6_000);
    st.wait("the recovery", |s| s.events.iter().any(|e| matches!(e, Event::Audio(m) if m.contains("reopened"))));
    assert_eq!(st.out.generation.load(Ordering::SeqCst), 1);
    st.settle();
    st.send(Command::CallCq);
    st.key_slot(SLOT + 2);
    st.start_audio(SLOT + 2);
    st.time.set_utc(slot_start(SLOT + 2) + 5.0);
    st.settle();
    let before = st.out.stopped_from_any_thread.load(Ordering::SeqCst);
    st.rt().halt();
    // Synchronously, inside halt(): not at the control thread's next tick.
    assert!(
        st.out.stopped_from_any_thread.load(Ordering::SeqCst) > before,
        "HALT flushed the stream that was replaced, not the one playing"
    );
    st.wait("the outcome", |s| s.outcome(SLOT + 2).is_some());
    assert!(matches!(st.outcome(SLOT + 2), Some(TxOutcome::Aborted(_))));
}

#[test]
fn m2_shutdown_retries_an_unconfirmed_release_and_says_so_when_it_stays_unconfirmed() {
    // Review M-2: shutdown used to try the release once, discard the result and drop the
    // controller, so a settings change or closing the window abandoned a pending release.
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.line.fail_releases.store(3, Ordering::SeqCst);
    let report = st.rt.take().unwrap().shutdown();
    assert!(report.release_confirmed(), "three refusals are retried within the shutdown window: {report:?}");
    assert!(report.release_failures >= 3, "{report:?}");
    assert!(!st.line.keyed());

    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.line.fail_releases.store(usize::MAX, Ordering::SeqCst);
    let t = Instant::now();
    let report = st.rt.take().unwrap().shutdown();
    assert!(t.elapsed() < Duration::from_millis(SHUTDOWN_RELEASE_WAIT_MS + 2_000), "bounded: {:?}", t.elapsed());
    assert_eq!(report.ptt, PttState::ReleasePending, "{report:?}");
    assert!(!report.release_confirmed() && report.release_failures > 0 && report.last_release_error.is_some(), "{report:?}");
    assert!(st.line.keyed(), "the fake hardware is still keyed, and the report says so");
}

#[test]
fn l5_a_clock_step_during_a_transmission_aborts_it_and_disarms() {
    // Review L-5: the frame's end is timed on the wall clock, so a backward step mid-frame held
    // the line keyed with the audio finished until the 40 s watchdog, and the step was only a
    // message. Now the transmission is aborted and the station disarmed.
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.time.set_utc(slot_start(SLOT) + 5.0);
    st.settle();
    let at = slot_start(SLOT) + 5.0;
    let n = RATE as usize / 10;
    let block = |first: u64, utc: f64| AudioBlock { first_index: first, samples: vec![0.0; n], capture_utc: utc };
    {
        let mut q = st.audio_in.0.lock().unwrap();
        q.push_back(block(0, at));
        q.push_back(block(n as u64, at + 0.1 - 120.0));
    }
    st.wait("the step", |s| s.events.iter().any(|e| matches!(e, Event::ClockStepped { .. })));
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(ref r)) if r.contains("clock")), "{:?}", st.outcome(SLOT));
    st.wait("the release", |s| !s.line.keyed());
    assert!(st.faults().iter().any(|f| f.contains("clock stepped")), "{:?}", st.faults());
    st.time.set_utc(slot_start(SLOT + 2) + 1.0);
    st.settle();
    assert_eq!(st.line.keys().len(), 1, "keyed again after the step: {:?}", st.line.changes());
}

#[test]
fn rt_a_failed_play_flushes_the_partial_frame_and_releases() {
    let mut st = Station::start();
    st.out.st.lock().unwrap().fail_play = true;
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.time.set_utc(slot_start(SLOT));
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Failed(_))));
    assert_eq!(st.out.queued_samples(), Some(0), "the partly queued frame is flushed, not left to play unkeyed");
    assert!(!st.line.keyed());
}

#[test]
fn rt_a_slow_key_still_sends_the_whole_frame() {
    // The CTO-04 probe: the key returns 300 ms late. The frame's end is fixed from the actual
    // audio start, so all 24 s are played and the outcome is honest.
    let mut st = Station::start();
    st.line.key_takes_ms.store(300, Ordering::SeqCst);
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    // The key moved the clock past the audio time, so the control thread may already have
    // started the audio by now: wait for the first play, not for one more than now.
    st.time.add_ms(5);
    st.wait("play", |s| !s.out.plays().is_empty());
    let (play_at, _) = st.out.plays()[0];
    st.time.set_utc(slot_start(SLOT) + 24.2);
    st.settle();
    assert!(st.line.keyed(), "released before the whole frame could have played");
    st.time.set_utc(slot_start(SLOT) + 24.5);
    st.wait("the release", |s| !s.line.keyed());
    let unkey_at = st.line.changes().last().unwrap().0;
    assert!(unkey_at - play_at >= frame_ms(), "{} ms", unkey_at - play_at);
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert_eq!(st.outcome(SLOT), Some(TxOutcome::Complete));
}

#[test]
fn rt_a_key_too_slow_for_the_slot_abandons_it_without_audio() {
    let mut st = Station::start();
    st.line.key_takes_ms.store(800, Ordering::SeqCst);
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.time.add_ms(5);
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(ref w)) if w.contains("could not start")), "{:?}", st.outcome(SLOT));
    assert!(st.out.plays().is_empty());
    assert!(!st.line.keyed());
}

#[test]
fn rt_a_stalled_control_loop_does_not_key_late() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    // The loop next runs 1.1 s later (a stall, a clock step): past the key's tolerance.
    st.time.set_utc(slot_start(SLOT) + 0.6);
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(_))));
    assert!(st.line.keys().is_empty());
}

#[test]
fn rt_a_frame_the_device_did_not_finish_is_partial_not_complete() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.out.st.lock().unwrap().stall = true;
    st.time.set_utc(slot_start(SLOT) + 24.2);
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Partial(_))), "{:?}", st.outcome(SLOT));
    assert!(!st.line.keyed());
}

#[test]
fn rt_after_a_refused_key_the_station_can_transmit_again_when_rearmed() {
    let mut st = Station::start();
    st.line.fail_keys.store(1, Ordering::SeqCst);
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    st.time.set_utc(slot_start(SLOT) - PTT_LEAD_SEC);
    st.wait("the failure", |s| s.outcome(SLOT).is_some());
    st.send(Command::CallCq);
    st.key_slot(SLOT + 2);
    st.start_audio(SLOT + 2);
    st.time.set_utc(slot_start(SLOT + 2) + 24.2);
    st.wait("the outcome", |s| s.outcome(SLOT + 2).is_some());
    assert_eq!(st.outcome(SLOT + 2), Some(TxOutcome::Complete));
}

// ---------------------------------------------------------------------------- rig polling

#[test]
fn f18_the_poll_schedule_honours_the_interval_and_the_ptt_settle_window() {
    let mut s = RigPollSchedule::new(1000);
    assert!(s.poll_now(0, u64::MAX));
    assert!(!s.poll_now(999, u64::MAX));
    assert!(s.poll_now(1000, u64::MAX));
    // Due at 2000, but PTT changed at 1950: nothing until 2050, then the poll goes out.
    assert!(!s.poll_now(2000, 1950));
    assert!(!s.poll_now(2049, 1950));
    assert!(s.poll_now(1950 + PTT_SETTLE_MS, 1950));
    assert!(!RigPollSchedule::cat_allowed(5001, 5000));
    assert!(RigPollSchedule::cat_allowed(5000 + PTT_SETTLE_MS, 5000));
    assert_eq!(RigPollSchedule::new(10).interval_ms(), MIN_POLL_INTERVAL_MS);
}

fn count_polls(interval_ms: u64) -> usize {
    let mut cfg = config();
    cfg.rig.rigctld_host = "test".into();
    cfg.rig.poll_interval_ms = interval_ms;
    let st = Station::start_with(cfg, true);
    // 10 s of virtual time in 20 ms steps.
    for _ in 0..500 {
        st.time.add_ms(20);
        std::thread::sleep(Duration::from_millis(2));
    }
    let n = st.rig_reads.lock().unwrap().len();
    drop(st);
    n
}

#[test]
fn f18_the_rig_thread_polls_at_the_configured_interval() {
    let (a, b) = (count_polls(1000), count_polls(2000));
    assert!((8..=11).contains(&a), "{a} polls in 10 s at 1000 ms");
    assert!((4..=6).contains(&b), "{b} polls in 10 s at 2000 ms: poll_interval_ms is honoured");
}

#[test]
fn f18_no_poll_starts_inside_the_ptt_settle_window_during_a_transmission() {
    let mut cfg = config();
    cfg.rig.rigctld_host = "test".into();
    cfg.rig.poll_interval_ms = MIN_POLL_INTERVAL_MS;
    let mut st = Station::start_with(cfg, true);
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    // Walk through the frame in 10 ms steps so polls fall due everywhere, the windows included.
    let end = slot_start(SLOT) + 24.3;
    while st.time.utc() < end {
        st.time.add_ms(10);
        std::thread::sleep(Duration::from_millis(1));
    }
    st.wait("the release", |s| !s.line.keyed());
    st.time.add_ms(500);
    st.settle();
    let reads = st.rig_reads.lock().unwrap().clone();
    assert!(reads.len() > 20, "{} polls", reads.len());
    for (p, _) in st.line.changes() {
        // One 10 ms step of slack: a poll decided just before the change can start at its instant.
        let inside: Vec<u64> = reads.iter().copied().filter(|&r| r > p + 10 && r < p + PTT_SETTLE_MS).collect();
        assert!(inside.is_empty(), "polls {inside:?} started inside the settle window after the PTT change at {p}");
    }
}

#[test]
fn rt_a_configuration_change_or_queued_halt_while_keyed_ends_the_transmission() {
    // The engine's own halts (HaltTx, EnableTx(false), a new configuration) arrive through the
    // command queue; the runtime must end a keyed transmission on them (mutation RT-halt: the
    // HALT button's direct path was tested, this one was not).
    for cmd in [Command::HaltTx, Command::EnableTx(false), Command::UpdateConfig(Box::new(config()))] {
        let mut st = Station::start();
        st.send(Command::CallCq);
        st.key_slot(SLOT);
        st.start_audio(SLOT);
        st.time.set_utc(slot_start(SLOT) + 3.0);
        st.settle();
        let name = format!("{cmd:?}").chars().take(20).collect::<String>();
        st.send(cmd);
        st.wait(&format!("the release after {name}"), |s| !s.line.keyed());
        st.wait("the outcome", |s| s.outcome(SLOT).is_some());
        assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(_))), "{name}: {:?}", st.outcome(SLOT));
    }
}

#[test]
fn rt_halt_releases_the_ptt_even_while_the_control_thread_is_stuck_in_the_output() {
    // F-16: the control thread is blocked inside the audio output while keyed. HALT must release
    // the line itself, not wait for the control thread (mutation RT-haltptt).
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    let gate = st.out.play_gate.clone();
    let held = gate.lock().unwrap();
    st.time.set_utc(slot_start(SLOT));
    st.settle(); // the control thread is now inside play(), blocked
    assert!(st.line.keyed());
    st.rt().halt();
    st.wait("the release while the control thread is blocked", |s| !s.line.keyed());
    assert!(st.out.stopped_from_any_thread.load(Ordering::SeqCst) >= 1);
    drop(held);
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(_))), "{:?}", st.outcome(SLOT));
    st.time.set_utc(slot_start(SLOT + 2) + 1.0);
    st.settle();
    assert_eq!(st.line.keys().len(), 1, "disarmed");
}

#[test]
fn rt_a_radio_that_moves_off_the_checked_dial_mid_frame_stops_the_transmission() {
    // F-45: the gate checks the dial at plan time; a VFO turned during the frame must end it
    // (mutation RT-midtx).
    let mut cfg = config();
    cfg.rig.rigctld_host = "test".into();
    cfg.rig.poll_interval_ms = MIN_POLL_INTERVAL_MS;
    let mut st = Station::start_with(cfg, true);
    st.send(Command::CallCq);
    st.key_slot(SLOT);
    st.start_audio(SLOT);
    st.rig_dial.store(14_080_000, Ordering::SeqCst);
    // Enough polls, outside the settle window, for the reading to settle as a contradiction.
    for _ in 0..40 {
        st.time.add_ms(100);
        std::thread::sleep(Duration::from_millis(3));
    }
    st.wait("the release", |s| !s.line.keyed());
    st.wait("the outcome", |s| s.outcome(SLOT).is_some());
    assert!(matches!(st.outcome(SLOT), Some(TxOutcome::Aborted(ref w)) if w.contains("contradicted")), "{:?}", st.outcome(SLOT));
    assert!(st.faults().iter().any(|f| f.contains("transmission stopped")), "{:?}", st.faults());
}
