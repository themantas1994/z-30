//! Threads and hardware ports.
//!
//! ```text
//!  audio callback (z30-io) --SPSC ring--> AudioInput::next_block
//!  DSP thread:     RxPipeline (resample, store, clock model, scheduler) -> SlotJob
//!  decode thread:  Receiver::decode_slot (rayon inside)                 -> SlotReport
//!  rig thread:     RigControl polls (respecting the PTT settle window)   -> Reading
//!  control thread: Engine (commands, sequencing, gate) + TxScheduler     -> PTT, audio out
//!  PTT watchdog:   independent deadline on the keyed line
//! ```
//!
//! Every channel is bounded. The GUI reads `ArcSwap<EngineSnapshot>` (latest wins) and never
//! blocks the engine; the engine never waits for the GUI.

use crate::api::{AudioHealth, Command, EngineSnapshot, Event};
use crate::config::Config;
use crate::engine::{Engine, TxKind, TxPlan};
use crate::pipeline::{AudioBlock, RxPipeline};
use crate::ptt::{MonotonicClock, PttController, PttLine};
use crate::qso::QsoRecord;
use crate::rig::Reading;
use crate::slots::{slot_of, slot_start, SlotEvent, SlotJob};
use arc_swap::ArcSwap;
use crossbeam_channel::{bounded, select, tick, Receiver, Sender, TrySendError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use z30_dsp::slot::{Receiver as DspReceiver, RxConfig, SlotReport};
use z30_protocol::gfsk::Modulator;
use z30_protocol::{NUM_TONES, TONE_SPACING_HZ};

/// Audio input, fed by the device callback through a ring.
pub trait AudioInput: Send {
    /// Device sample rate.
    fn sample_rate(&self) -> u32;
    /// The next block, waiting at most `timeout`. `Ok(None)` = nothing yet; `Err` = device lost.
    fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String>;
}

/// Audio output for transmission.
pub trait AudioOutput: Send {
    /// Device sample rate.
    fn sample_rate(&self) -> u32;
    /// Output latency: time from `play` to the first sample leaving the device, seconds.
    fn latency_sec(&self) -> f64;
    /// Starts playing `samples` now.
    fn play(&mut self, samples: Vec<f32>) -> Result<(), String>;
    /// Silences the output immediately.
    fn stop(&mut self);
}

/// Rig control (CAT).
pub trait RigControl: Send {
    /// One poll.
    fn read(&mut self) -> Result<Reading, String>;
    /// Commands the dial.
    fn set_dial(&mut self, hz: u64) -> Result<(), String>;
}

/// The operating system's UTC and its synchronisation status. z-30 never sets the clock.
pub trait WallClock: Send + Sync {
    /// UTC, seconds since the epoch.
    fn utc_now(&self) -> f64;
    /// Human-readable status ("NTP synchronised", "unknown", ...).
    fn status(&self) -> String;
}

/// Where completed contacts go.
pub trait LogSink: Send {
    /// Persists one record.
    fn log(&mut self, rec: &QsoRecord) -> Result<(), String>;
}

/// PTT lead-in before audio, seconds.
pub const PTT_LEAD_SEC: f64 = 0.05;
/// PTT hang after audio, seconds.
pub const PTT_TAIL_SEC: f64 = 0.05;
/// The transmit decision (and gate check) is taken this long before the slot.
pub const PLAN_LEAD_SEC: f64 = 0.6;

/// One step of the transmit timeline.
#[derive(Clone, Debug, PartialEq)]
pub enum TxAction {
    /// Ask the engine for a plan for this slot.
    Plan(i64),
    /// Key the PTT.
    Key,
    /// Start the audio.
    StartAudio,
    /// Release PTT (the frame completed if `completed`).
    Unkey {
        /// The whole frame went out.
        completed: bool,
    },
}

/// The transmit timeline as a pure function of UTC, so it can be tested on a virtual clock.
#[derive(Clone, Debug)]
pub struct TxScheduler {
    planned_slot: Option<i64>,
    phase: TxPhase,
    output_latency: f64,
}

#[derive(Clone, Debug, PartialEq)]
enum TxPhase {
    Idle,
    Planned { slot: i64, key_at: f64, audio_at: f64, end_at: f64 },
    Keyed { slot: i64, audio_at: f64, end_at: f64 },
    Playing { slot: i64, end_at: f64 },
}

impl TxScheduler {
    /// A timeline for an output device with this latency.
    pub fn new(output_latency: f64) -> Self {
        TxScheduler { planned_slot: None, phase: TxPhase::Idle, output_latency }
    }

    /// Whether a transmission is under way.
    pub fn busy(&self) -> bool {
        self.phase != TxPhase::Idle
    }

    /// Accepts a plan for `slot` with an audio duration.
    pub fn accept(&mut self, slot: i64, duration_sec: f64) {
        let s = slot_start(slot);
        self.phase = TxPhase::Planned {
            slot,
            key_at: s - PTT_LEAD_SEC - self.output_latency,
            audio_at: s - self.output_latency,
            end_at: s + duration_sec + PTT_TAIL_SEC,
        };
    }

    /// Abandons everything (halt). The caller unkeys and stops audio.
    pub fn abort(&mut self) {
        self.phase = TxPhase::Idle;
    }

    /// What to do at `now`.
    pub fn tick(&mut self, now: f64) -> Vec<TxAction> {
        let mut out = Vec::new();
        match self.phase.clone() {
            TxPhase::Idle => {
                let next = slot_of(now) + 1;
                if slot_start(next) - now <= PLAN_LEAD_SEC && self.planned_slot != Some(next) {
                    self.planned_slot = Some(next);
                    out.push(TxAction::Plan(next));
                }
            }
            TxPhase::Planned { slot, key_at, audio_at, end_at } => {
                if now >= key_at {
                    out.push(TxAction::Key);
                    self.phase = TxPhase::Keyed { slot, audio_at, end_at };
                    return [out, self.tick(now)].concat();
                }
            }
            TxPhase::Keyed { slot, audio_at, end_at } => {
                if now >= audio_at {
                    out.push(TxAction::StartAudio);
                    self.phase = TxPhase::Playing { slot, end_at };
                    return [out, self.tick(now)].concat();
                }
            }
            TxPhase::Playing { end_at, .. } => {
                if now >= end_at {
                    out.push(TxAction::Unkey { completed: true });
                    self.phase = TxPhase::Idle;
                }
            }
        }
        out
    }
}

/// Synthesises the audio for a plan at the output rate.
pub fn tx_audio(plan: &TxPlan, rate: u32, level: f32) -> Result<Vec<f32>, String> {
    let level = level.clamp(0.0, 1.0);
    match &plan.kind {
        TxKind::Frame(enc) => {
            let m = Modulator::new(rate as f64).map_err(|e| e.to_string())?;
            let w = m.synthesize(&enc.symbols, plan.tx_audio_hz).map_err(|e| e.to_string())?;
            Ok(w.into_iter().map(|v| v * level).collect())
        }
        TxKind::Tune => {
            // Centre of the tone span, constant envelope, 20 ms ramps, one frame long.
            let f = plan.tx_audio_hz + (NUM_TONES - 1) as f64 * TONE_SPACING_HZ / 2.0;
            let n = (z30_protocol::FRAME_SEC * rate as f64) as usize;
            let ramp = (0.02 * rate as f64) as usize;
            Ok((0..n)
                .map(|i| {
                    let e = if i < ramp {
                        i as f64 / ramp as f64
                    } else if i >= n - ramp {
                        (n - i) as f64 / ramp as f64
                    } else {
                        1.0
                    };
                    ((std::f64::consts::TAU * f * i as f64 / rate as f64).sin() * e) as f32 * level
                })
                .collect())
        }
    }
}

/// Hardware and platform services the runtime needs.
pub struct RuntimeParts {
    /// Audio in.
    pub input: Box<dyn AudioInput>,
    /// Audio out.
    pub output: Box<dyn AudioOutput>,
    /// Rig control, if configured.
    pub rig: Option<Box<dyn RigControl>>,
    /// Keying line.
    pub ptt: Box<dyn PttLine>,
    /// UTC.
    pub wall: Arc<dyn WallClock>,
    /// Monotonic ms.
    pub mono: Arc<dyn MonotonicClock>,
    /// Logbook.
    pub log: Box<dyn LogSink>,
    /// Optional copy of every decoded slot (bounded; dropped when the reader is slow).
    pub slot_tap: Option<Sender<SlotCapture>>,
    /// Why transmitting is impossible with these parts (no output device, no keying line), if
    /// it is. The engine refuses every transmission while this is set.
    pub tx_unavailable: Option<String>,
}

/// A decoded slot's window and report, for `--capture-slots` and diagnostics.
pub struct SlotCapture {
    /// Slot number.
    pub slot: i64,
    /// The 27 s window at 6 kHz.
    pub samples: Vec<f32>,
    /// What the decoder made of it.
    pub report: SlotReport,
}

/// Handles for a user interface.
pub struct RuntimeHandle {
    /// Send commands.
    pub commands: Sender<Command>,
    /// Latest snapshot.
    pub snapshot: Arc<ArcSwap<EngineSnapshot>>,
    /// Events (bounded; the oldest are dropped if nobody reads).
    pub events: Receiver<Event>,
    /// Waterfall rows (bounded; dropped if nobody reads).
    pub waterfall: Receiver<Vec<f32>>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    watchdog: Option<JoinHandle<()>>,
    ptt: PttController,
}

impl RuntimeHandle {
    /// Stops every thread, releasing PTT first.
    pub fn shutdown(mut self) {
        let _ = self.ptt.unkey();
        self.stop.store(true, Ordering::SeqCst);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
        // The watchdog ends when the last controller does.
        let watchdog = self.watchdog.take();
        drop(self);
        if let Some(w) = watchdog {
            let _ = w.join();
        }
    }

    /// Emergency: unkey now, from any thread.
    pub fn emergency_unkey(&self) {
        let _ = self.ptt.unkey();
    }
}

enum Internal {
    Slot(SlotEvent),
    Decoded(i64, Box<SlotReport>, f64),
    Rig(Result<Reading, String>),
    Health(AudioHealth),
}

/// Starts the runtime.
pub fn start(config: Config, parts: RuntimeParts) -> RuntimeHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let mono = parts.mono.clone();
    let ptt = PttController::new(parts.ptt, mono.clone());
    let watchdog = ptt.spawn_watchdog(Duration::from_millis(50));
    let mut engine = Engine::new(config);
    engine.set_tx_hardware_problem(parts.tx_unavailable.clone());
    let snapshot = Arc::new(ArcSwap::from_pointee(engine.snapshot(mono.now_ms())));
    let rx_cfg = Arc::new(ArcSwap::from_pointee(engine.rx_config()));
    let (cmd_tx, cmd_rx) = bounded::<Command>(64);
    let (ev_tx, ev_rx) = bounded::<Event>(256);
    let (wf_tx, wf_rx) = bounded::<Vec<f32>>(256);
    let (int_tx, int_rx) = bounded::<Internal>(64);
    let (job_tx, job_rx) = bounded::<SlotJob>(1);
    let (dial_tx, dial_rx) = bounded::<u64>(4);
    let mut threads = Vec::new();

    // DSP thread.
    {
        let (stop, int_tx) = (stop.clone(), int_tx.clone());
        let mut input = parts.input;
        threads.push(
            std::thread::Builder::new()
                .name("z30-dsp".into())
                .spawn(move || {
                    let mut pipe = RxPipeline::new(input.sample_rate());
                    let mut running = true;
                    while !stop.load(Ordering::SeqCst) {
                        match input.next_block(Duration::from_millis(100)) {
                            Ok(Some(block)) => {
                                running = true;
                                for ev in pipe.push(&block) {
                                    match ev {
                                        SlotEvent::Ready(job) => match job_tx.try_send(job) {
                                            Ok(()) => {}
                                            Err(TrySendError::Full(job)) => {
                                                // The decoder is still on the previous slot: say so rather than queue
                                                // without bound.
                                                let _ = int_tx.try_send(Internal::Slot(SlotEvent::Missed(
                                                    job.slot,
                                                    crate::slots::MissReason::DecoderBusy,
                                                )));
                                            }
                                            Err(TrySendError::Disconnected(_)) => return,
                                        },
                                        other => {
                                            let _ = int_tx.try_send(Internal::Slot(other));
                                        }
                                    }
                                }
                                for row in pipe.take_waterfall_rows() {
                                    let _ = wf_tx.try_send(row);
                                }
                                let health = AudioHealth {
                                    input_running: true,
                                    overruns: pipe.overruns(),
                                    drift_ppm: pipe.clock().drift_ppm().filter(|_| pipe.clock().is_locked()),
                                    epoch: pipe.clock().epoch(),
                                    level_dbfs: pipe.take_level_dbfs(),
                                };
                                let _ = int_tx.try_send(Internal::Health(health));
                            }
                            Ok(None) => {}
                            Err(_) => {
                                if running {
                                    let _ = int_tx.try_send(Internal::Health(AudioHealth { input_running: false, ..Default::default() }));
                                }
                                running = false;
                                std::thread::sleep(Duration::from_millis(200));
                            }
                        }
                    }
                })
                .expect("spawn dsp"),
        );
    }

    // Decode thread.
    {
        let (stop, int_tx, wall, rx_cfg) = (stop.clone(), int_tx.clone(), parts.wall.clone(), rx_cfg.clone());
        let tap = parts.slot_tap;
        threads.push(
            std::thread::Builder::new()
                .name("z30-decode".into())
                .spawn(move || {
                    let rx = DspReceiver::new();
                    while !stop.load(Ordering::SeqCst) {
                        let Ok(job) = job_rx.recv_timeout(Duration::from_millis(200)) else { continue };
                        let cfg: RxConfig = (**rx_cfg.load()).clone();
                        // A panic in the decoder loses this slot, not the station.
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rx.decode_slot(&job.samples, &cfg)));
                        match result {
                            Ok(report) => {
                                if let Some(t) = &tap {
                                    let _ =
                                        t.try_send(SlotCapture { slot: job.slot, samples: job.samples.clone(), report: report.clone() });
                                }
                                let _ = int_tx.send(Internal::Decoded(job.slot, Box::new(report), wall.utc_now()));
                            }
                            Err(_) => {
                                let _ = int_tx.send(Internal::Slot(SlotEvent::Missed(job.slot, crate::slots::MissReason::DecoderFault)));
                            }
                        }
                    }
                })
                .expect("spawn decode"),
        );
    }

    // Rig thread.
    if let Some(mut rig) = parts.rig {
        let (stop, int_tx) = (stop.clone(), int_tx.clone());
        let period = Duration::from_millis(1000);
        threads.push(
            std::thread::Builder::new()
                .name("z30-rig".into())
                .spawn(move || {
                    while !stop.load(Ordering::SeqCst) {
                        while let Ok(hz) = dial_rx.try_recv() {
                            if let Err(e) = rig.set_dial(hz) {
                                let _ = int_tx.try_send(Internal::Rig(Err(e)));
                            }
                        }
                        let _ = int_tx.try_send(Internal::Rig(rig.read()));
                        std::thread::sleep(period);
                    }
                })
                .expect("spawn rig"),
        );
    }

    // Control thread.
    {
        let (stop, snapshot, wall, rx_cfg, ptt2) = (stop.clone(), snapshot.clone(), parts.wall.clone(), rx_cfg.clone(), ptt.clone());
        let mut output = parts.output;
        let mut log = parts.log;
        let mono2 = mono.clone();
        threads.push(
            std::thread::Builder::new()
                .name("z30-control".into())
                .spawn(move || {
                    let mut engine = engine;
                    let mut txs = TxScheduler::new(output.latency_sec());
                    let mut plan: Option<TxPlan> = None;
                    let mut audio: Option<Vec<f32>> = None;
                    let ticker = tick(Duration::from_millis(5));
                    let mut last_publish = 0u64;
                    while !stop.load(Ordering::SeqCst) {
                        let mut dirty = false;
                        select! {
                            recv(cmd_rx) -> c => if let Ok(c) = c {
                                if let Command::SetDial(hz) = c { let _ = dial_tx.try_send(hz); }
                                if engine.apply(c, mono2.now_ms()) && txs.busy() {
                                    output.stop();
                                    let _ = ptt2.unkey();
                                    engine.note_ptt(false, mono2.now_ms());
                                    if let Some(p) = plan.take() { engine.tx_finished(p.slot, false, mono2.now_ms()); }
                                    txs.abort();
                                }
                                rx_cfg.store(Arc::new(engine.rx_config()));
                                dirty = true;
                            },
                            recv(int_rx) -> m => if let Ok(m) = m {
                                match m {
                                    Internal::Slot(SlotEvent::Missed(s, r)) => engine.on_slot_missed(s, r),
                                    Internal::Slot(SlotEvent::Ready(_)) => {}
                                    Internal::Decoded(s, rep, done) => {
                                        engine.on_slot_report(s, &rep, done, mono2.now_ms());
                                        rx_cfg.store(Arc::new(engine.rx_config()));
                                    }
                                    Internal::Rig(Ok(r)) => engine.on_rig_reading(&r, mono2.now_ms()),
                                    Internal::Rig(Err(e)) => engine.on_rig_offline(&e),
                                    Internal::Health(h) => engine.set_audio_health(h),
                                }
                                dirty = true;
                            },
                            recv(ticker) -> _ => {}
                        }
                        // Transmit timeline.
                        let now = wall.utc_now();
                        for action in txs.tick(now) {
                            match action {
                                TxAction::Plan(slot) => {
                                    if let Some(p) = engine.plan_tx(slot, mono2.now_ms()) {
                                        let level = engine.config().audio.tx_level;
                                        match tx_audio(&p, output.sample_rate(), level) {
                                            Ok(a) => {
                                                txs.accept(slot, a.len() as f64 / output.sample_rate() as f64);
                                                audio = Some(a);
                                                plan = Some(p);
                                            }
                                            Err(e) => engine.tx_fault(e),
                                        }
                                    }
                                }
                                TxAction::Key => match ptt2.key() {
                                    Ok(_) => {
                                        engine.note_ptt(true, mono2.now_ms());
                                        if let Some(p) = &plan {
                                            engine.tx_started(p);
                                        }
                                    }
                                    Err(e) => {
                                        txs.abort();
                                        plan = None;
                                        audio = None;
                                        engine.tx_fault(format!("PTT failed: {e}"));
                                    }
                                },
                                TxAction::StartAudio => {
                                    if let Some(a) = audio.take() {
                                        if let Err(e) = output.play(a) {
                                            let _ = ptt2.unkey();
                                            txs.abort();
                                            if let Some(p) = plan.take() {
                                                engine.tx_finished(p.slot, false, mono2.now_ms());
                                            }
                                            engine.tx_fault(format!("audio output failed: {e}"));
                                        }
                                    }
                                }
                                TxAction::Unkey { completed } => {
                                    output.stop();
                                    let _ = ptt2.unkey();
                                    engine.note_ptt(false, mono2.now_ms());
                                    if let Some(p) = plan.take() {
                                        engine.tx_finished(p.slot, completed && !ptt2.watchdog_fired(), mono2.now_ms());
                                    }
                                }
                            }
                            dirty = true;
                        }
                        if ptt2.watchdog_fired() && txs.busy() {
                            output.stop();
                            txs.abort();
                            if let Some(p) = plan.take() {
                                engine.tx_finished(p.slot, false, mono2.now_ms());
                            }
                            engine.tx_fault("PTT watchdog released the transmitter".into());
                        }
                        for e in engine.take_events() {
                            if let Event::Logged(rec) = &e {
                                if let Err(err) = log.log(rec) {
                                    let _ = ev_tx.try_send(Event::TxFault(format!("logbook write failed: {err}")));
                                }
                            }
                            let _ = ev_tx.try_send(e);
                        }
                        let now_ms = mono2.now_ms();
                        if dirty || now_ms.saturating_sub(last_publish) >= 250 {
                            engine.set_clock_status(wall.status());
                            snapshot.store(Arc::new(engine.snapshot(now_ms)));
                            last_publish = now_ms;
                        }
                    }
                    output.stop();
                    let _ = ptt2.unkey();
                })
                .expect("spawn control"),
        );
    }
    RuntimeHandle { commands: cmd_tx, snapshot, events: ev_rx, waterfall: wf_rx, stop, threads, watchdog: Some(watchdog), ptt }
}
