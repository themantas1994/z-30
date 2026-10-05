//! Threads and hardware ports.
//!
//! ```text
//!  audio callback (z30-io) --SPSC ring--> AudioInput::next_block
//!  DSP thread:     RxPipeline (resample, store, clock model, scheduler) -> SlotJob
//!  decode thread:  Receiver::decode_slot (rayon inside)                 -> SlotReport
//!  rig thread:     RigControl polls (poll_interval_ms, PTT settle window)-> Reading
//!  control thread: Engine (commands, sequencing, gate) + TxScheduler     -> PTT, audio out
//!  log thread:     LogSink (SQLite)                                     -> Logged / LogFailed
//!  PTT watchdog:   independent deadline on the keyed line; retries an unconfirmed release
//!  HALT:           RuntimeHandle::halt, from the UI thread: output stop + PTT release + flag
//! ```
//!
//! Every channel is bounded. The GUI reads `ArcSwap<EngineSnapshot>` (latest wins) and never
//! blocks the engine; the engine never waits for the GUI.

use crate::api::{AudioHealth, Command, EngineSnapshot, Event, TxOutcome};
use crate::config::Config;
use crate::engine::{Engine, TxKind, TxPlan};
use crate::pipeline::{AudioBlock, RxPipeline};
use crate::ptt::{MonotonicClock, PttController, PttLine, PttState};
use crate::qso::QsoRecord;
use crate::rig::Reading;
use crate::rig::PTT_SETTLE_MS;
use crate::slots::{slot_of, slot_start, SlotEvent, SlotJob};
use arc_swap::ArcSwap;
use crossbeam_channel::{bounded, select, tick, Receiver, Sender, TrySendError};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use z30_dsp::slot::{Receiver as DspReceiver, RxConfig, SlotReport};
use z30_protocol::codec::VerifiedFrame;
use z30_protocol::gfsk::Modulator;
use z30_protocol::{NUM_TONES, TONE_SPACING_HZ, TOTAL_SYMBOLS};

/// Audio input, fed by the device callback through a ring.
pub trait AudioInput: Send {
    /// Device sample rate.
    fn sample_rate(&self) -> u32;
    /// The next block, waiting at most `timeout`. `Ok(None)` = nothing yet; `Err` = device lost.
    fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String>;
}

/// A stop that any thread can call without the output itself (for HALT).
pub type OutputStopper = Arc<dyn Fn() + Send + Sync>;

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
    /// Samples accepted by `play` that the device has not taken yet (None = cannot tell). A
    /// frame whose samples are still queued when its time is up was not all transmitted.
    fn queued_samples(&self) -> Option<usize> {
        None
    }
    /// A device error reported since the output was opened or last recovered. While there is
    /// one, nothing is transmitted.
    fn failure(&self) -> Option<String> {
        None
    }
    /// Reopens the device after a failure.
    fn recover(&mut self) -> Result<(), String> {
        Err("this output cannot be reopened; restart the station".into())
    }
    /// A stop callable from any thread, for HALT (None = only `stop` exists). It need only stay
    /// valid until the next successful `recover`: the runtime asks again after each one.
    fn stopper(&self) -> Option<OutputStopper> {
        None
    }
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
/// A key this much later than planned is not sent: the slot is abandoned. The control loop
/// ticks every 5 ms; a key this late means it stalled or the clock stepped.
pub const MAX_KEY_LATENESS_SEC: f64 = 0.5;
/// Audio that would start this much later than planned is not started; the transmission is
/// abandoned. Up to this, the whole frame is still played (its end is set from the actual start,
/// so nothing is cut), arriving this much late in the receivers' +-1.5 s DT search.
pub const MAX_START_LATENESS_SEC: f64 = 0.5;
/// Shortest rig poll interval honoured, ms: `poll_interval_ms` below this is raised to it.
pub const MIN_POLL_INTERVAL_MS: u64 = 250;
/// How often a failed audio output is reopened while idle, ms.
pub const OUTPUT_RECOVERY_INTERVAL_MS: u64 = 5_000;

/// One step of the transmit timeline.
#[derive(Clone, Debug, PartialEq)]
pub enum TxAction {
    /// Ask the engine for a plan for this slot.
    Plan(i64),
    /// Key the PTT.
    Key,
    /// Start the audio.
    StartAudio,
    /// Release PTT, with what the timeline knows about the outcome (the runtime can only make it
    /// worse: a still-queued output is `Partial`, a watchdog release `WatchdogAborted`).
    Unkey {
        /// The outcome as far as the timeline knows.
        outcome: TxOutcome,
    },
    /// The planned transmission is abandoned before anything was keyed.
    Abandon(String),
}

/// The transmit timeline as a pure function of UTC, so it can be tested on a virtual clock.
///
/// The end of the frame is fixed when the audio actually starts, not at plan time: with a fixed
/// end a key that took 300 ms cut the last 300 ms of the frame and still reported it completed
/// (2026-09-28 audit F-17). A key or an audio start later than its tolerance abandons the slot
/// instead, and `Key` and `StartAudio` are never emitted in the same tick, so `StartAudio` is
/// decided at the time the key actually returned, not the time before it was sent.
#[derive(Clone, Debug)]
pub struct TxScheduler {
    planned_slot: Option<i64>,
    phase: TxPhase,
    output_latency: f64,
}

#[derive(Clone, Debug, PartialEq)]
enum TxPhase {
    Idle,
    Planned { key_at: f64, audio_at: f64, duration: f64 },
    Keyed { audio_at: f64, duration: f64 },
    Playing { end_at: f64 },
}

impl TxScheduler {
    /// A timeline for an output device with this latency.
    pub fn new(output_latency: f64) -> Self {
        TxScheduler { planned_slot: None, phase: TxPhase::Idle, output_latency }
    }

    /// The output latency to plan with, seconds, measured when the plan is made (F-47: it used
    /// to be read once when the control thread started, before any output callback had run,
    /// and was therefore almost always zero).
    pub fn set_output_latency(&mut self, sec: f64) {
        self.output_latency = if sec.is_finite() { sec.clamp(0.0, 1.0) } else { 0.0 };
    }

    /// The latency the next plan uses, seconds.
    pub fn output_latency(&self) -> f64 {
        self.output_latency
    }

    /// Whether a transmission is under way.
    pub fn busy(&self) -> bool {
        self.phase != TxPhase::Idle
    }

    /// Whether the transmitter has been keyed for the current transmission.
    pub fn keyed(&self) -> bool {
        matches!(self.phase, TxPhase::Keyed { .. } | TxPhase::Playing { .. })
    }

    /// Accepts a plan for `slot` with an audio duration.
    pub fn accept(&mut self, slot: i64, duration_sec: f64) {
        let s = slot_start(slot);
        self.phase =
            TxPhase::Planned { key_at: s - PTT_LEAD_SEC - self.output_latency, audio_at: s - self.output_latency, duration: duration_sec };
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
            TxPhase::Planned { key_at, audio_at, duration } => {
                if now >= key_at {
                    if now - key_at > MAX_KEY_LATENESS_SEC {
                        self.phase = TxPhase::Idle;
                        out.push(TxAction::Abandon(format!("the key was due {:.2} s earlier; the slot is abandoned", now - key_at)));
                    } else {
                        self.phase = TxPhase::Keyed { audio_at, duration };
                        out.push(TxAction::Key);
                    }
                }
            }
            TxPhase::Keyed { audio_at, duration } => {
                if now >= audio_at {
                    if now - audio_at > MAX_START_LATENESS_SEC {
                        self.phase = TxPhase::Idle;
                        out.push(TxAction::Unkey {
                            outcome: TxOutcome::Aborted(format!(
                                "the audio could not start until {:.2} s after its time (a slow key?); nothing was sent",
                                now - audio_at
                            )),
                        });
                    } else {
                        self.phase = TxPhase::Playing { end_at: now + self.output_latency + duration + PTT_TAIL_SEC };
                        out.push(TxAction::StartAudio);
                    }
                }
            }
            TxPhase::Playing { end_at } => {
                if now >= end_at {
                    out.push(TxAction::Unkey { outcome: TxOutcome::Complete });
                    self.phase = TxPhase::Idle;
                }
            }
        }
        out
    }
}

/// The level actually applied: 0..=1, and NaN as silence. `f32::clamp` passes NaN through, so
/// the Tune path's bare clamp was no second line at all for it (post-remediation review L-3).
fn safe_level(level: f32) -> f32 {
    if level.is_nan() {
        0.0
    } else {
        level.clamp(0.0, 1.0)
    }
}

/// Synthesises a verified frame at the output rate: the gate's frame, modulated by the one
/// modulator, scaled by `level` (clamped to 0..=1 as a second line behind the gate, which refuses
/// anything else).
pub fn frame_audio(frame: &VerifiedFrame, tx_audio_hz: f64, rate: u32, level: f32) -> Result<Vec<f32>, String> {
    let level = safe_level(level);
    let m = Modulator::new(rate as f64).map_err(|e| e.to_string())?;
    let w = m.synthesize(frame.symbols(), tx_audio_hz).map_err(|e| e.to_string())?;
    Ok(w.into_iter().map(|v| v * level).collect())
}

/// Synthesises the audio for a plan at the output rate, at the level and frequency the gate
/// checked (both carried in the plan; nothing is re-read from the configuration).
///
/// Tune is generated by the same `gfsk::Modulator` as a frame: a constant symbol at the centre
/// of the tone span, which is an unmodulated carrier with the frame's raised-cosine ramps. It
/// used to be a hand-made sine with linear ramps, a second waveform generator (F-49).
pub fn tx_audio(plan: &TxPlan, rate: u32) -> Result<Vec<f32>, String> {
    match plan.kind() {
        TxKind::Frame(frame) => frame_audio(frame, plan.tx_audio_hz(), rate, plan.tx_level()),
        TxKind::Tune => {
            let level = safe_level(plan.tx_level());
            let centre = plan.tx_audio_hz() + (NUM_TONES - 1) as f64 * TONE_SPACING_HZ / 2.0;
            let m = Modulator::new(rate as f64).map_err(|e| e.to_string())?;
            let w = m.synthesize(&[0u8; TOTAL_SYMBOLS], centre).map_err(|e| e.to_string())?;
            Ok(w.into_iter().map(|v| v * level).collect())
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

/// The output's current HALT stop. A recovered output is a new stream: a stop taken once at start
/// flushed the dead one, so after any glitch HALT no longer silenced the live output from the
/// calling thread (post-remediation review M-1). The control thread replaces it after each
/// recovery; the lock is held only to swap or clone an `Arc`, never across a call.
type StopperSlot = Arc<Mutex<Option<OutputStopper>>>;

fn current_stopper(slot: &StopperSlot) -> Option<OutputStopper> {
    slot.lock().unwrap_or_else(|p| p.into_inner()).clone()
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
    halt: Arc<AtomicBool>,
    stopper: StopperSlot,
    threads: Vec<JoinHandle<()>>,
    watchdog: Option<JoinHandle<()>>,
    ptt: PttController,
}

/// How long `shutdown` keeps retrying a release the hardware has not confirmed, at 20 ms
/// intervals, before it gives up and says so.
pub const SHUTDOWN_RELEASE_WAIT_MS: u64 = 2_000;

/// What `shutdown` could confirm about the keying line before the controller went away.
#[must_use = "an unconfirmed PTT release must be shown to the operator"]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShutdownReport {
    /// The controller's state when the runtime stopped: anything but `Released` means the
    /// radio may still be keyed and nothing in this runtime is retrying any more.
    pub ptt: PttState,
    /// Releases the hardware refused over the runtime's life.
    pub release_failures: u64,
    /// The last refusal, if any.
    pub last_release_error: Option<String>,
}

impl ShutdownReport {
    /// Whether the line was confirmed released.
    pub fn release_confirmed(&self) -> bool {
        self.ptt == PttState::Released
    }
}

impl RuntimeHandle {
    /// Stops every thread, releasing PTT first.
    ///
    /// A release the hardware refuses is retried for up to `SHUTDOWN_RELEASE_WAIT_MS`; the report
    /// says whether it was confirmed. It used to try once, discard the result and drop the
    /// controller, so restarting the runtime for a new PTT or rig setting (the natural reaction
    /// to "release NOT confirmed") or closing the window abandoned a pending release with nothing
    /// shown, and the new runtime started `Released` (post-remediation review M-2). Callers
    /// should not shut down while `ptt_state()` is not `Released` unless the operator insists.
    pub fn shutdown(mut self) -> ShutdownReport {
        self.halt();
        let _ = self.ptt.unkey();
        let t0 = std::time::Instant::now();
        while self.ptt.state() != PttState::Released && t0.elapsed() < Duration::from_millis(SHUTDOWN_RELEASE_WAIT_MS) {
            std::thread::sleep(Duration::from_millis(20));
            let _ = self.ptt.unkey();
        }
        let report = ShutdownReport {
            ptt: self.ptt.state(),
            release_failures: self.ptt.release_failures(),
            last_release_error: self.ptt.last_release_error(),
        };
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
        report
    }

    /// HALT: stop transmitting now, from any thread, without waiting for anything.
    ///
    /// It silences the output and asks for the PTT release directly, the release driven on its
    /// own short-lived thread (neither waits: not for a lock, and not for the driver's I/O; a line
    /// another thread is driving is left `ReleasePending` for that thread and the watchdog), and
    /// raises a flag the control thread acts on at its next tick to disarm and abandon the
    /// transmission. It does not go through the command queue: the GUI's HALT used to be a
    /// `try_send` on the bounded command channel, so a control thread blocked in `timedatectl`,
    /// SQLite or a slow key could leave it queued or dropped ("Engine busy") while the
    /// transmitter stayed keyed (2026-09-28 audit F-16).
    pub fn halt(&self) {
        self.halt.store(true, Ordering::SeqCst);
        if let Some(stop) = current_stopper(&self.stopper) {
            stop();
        }
        self.ptt.request_release_in_background();
    }

    /// Emergency: unkey now, from any thread (the PTT half of `halt`, without disarming).
    pub fn emergency_unkey(&self) {
        self.ptt.request_release_in_background();
    }

    /// What the controller knows about the keying line.
    pub fn ptt_state(&self) -> PttState {
        self.ptt.state()
    }
}

enum Internal {
    Slot(SlotEvent),
    Decoded(i64, Box<SlotReport>, f64),
    Rig(Result<Reading, String>),
    /// The radio's answer to a set-frequency command.
    DialSet(u64, Result<(), String>),
    Health(AudioHealth),
}

/// When the rig thread may poll: every `interval_ms`, never inside the PTT settle window after
/// a PTT change (WSJT-X's rule: some rigs cannot process CAT while switching). A poll that falls
/// due inside the window waits for its end. The rig thread used to poll on a fixed 1000 ms,
/// ignoring both the window and `poll_interval_ms` (F-18).
#[derive(Clone, Debug)]
pub struct RigPollSchedule {
    interval_ms: u64,
    next_ms: Option<u64>,
}

impl RigPollSchedule {
    /// A schedule for `poll_interval_ms` (raised to `MIN_POLL_INTERVAL_MS`).
    pub fn new(poll_interval_ms: u64) -> Self {
        RigPollSchedule { interval_ms: poll_interval_ms.max(MIN_POLL_INTERVAL_MS), next_ms: None }
    }

    /// The interval in use, ms.
    pub fn interval_ms(&self) -> u64 {
        self.interval_ms
    }

    /// Whether CAT traffic may go out now, given the last PTT change (`u64::MAX` = none yet).
    pub fn cat_allowed(now_ms: u64, last_ptt_change_ms: u64) -> bool {
        last_ptt_change_ms == u64::MAX || now_ms < last_ptt_change_ms || now_ms - last_ptt_change_ms >= PTT_SETTLE_MS
    }

    /// Whether to poll now; if so, the next poll is scheduled.
    pub fn poll_now(&mut self, now_ms: u64, last_ptt_change_ms: u64) -> bool {
        if !Self::cat_allowed(now_ms, last_ptt_change_ms) {
            return false;
        }
        if self.next_ms.is_none_or(|t| now_ms >= t) {
            self.next_ms = Some(now_ms + self.interval_ms);
            return true;
        }
        false
    }
}

/// Starts the runtime.
pub fn start(config: Config, parts: RuntimeParts) -> RuntimeHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let halt = Arc::new(AtomicBool::new(false));
    let mono = parts.mono.clone();
    let ptt = PttController::new(parts.ptt, mono.clone());
    let watchdog = ptt.spawn_watchdog(Duration::from_millis(50));
    let poll_interval_ms = config.rig.poll_interval_ms;
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
    let (log_tx, log_rx) = bounded::<Box<QsoRecord>>(16);
    // The last PTT change on the monotonic clock, for the rig thread's settle window.
    let ptt_changed_ms = Arc::new(AtomicU64::new(u64::MAX));
    let stopper: StopperSlot = Arc::new(Mutex::new(parts.output.stopper()));
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

    // Rig thread: polls at the configured interval and never inside the PTT settle window. A
    // set-frequency command obeys the same window (it is CAT traffic too).
    if let Some(mut rig) = parts.rig {
        let (stop, int_tx, mono, ptt_changed_ms) = (stop.clone(), int_tx.clone(), mono.clone(), ptt_changed_ms.clone());
        threads.push(
            std::thread::Builder::new()
                .name("z30-rig".into())
                .spawn(move || {
                    let mut schedule = RigPollSchedule::new(poll_interval_ms);
                    let mut pending_dial: Option<u64> = None;
                    while !stop.load(Ordering::SeqCst) {
                        while let Ok(hz) = dial_rx.try_recv() {
                            pending_dial = Some(hz);
                        }
                        let changed = ptt_changed_ms.load(Ordering::SeqCst);
                        if let Some(hz) = pending_dial {
                            if RigPollSchedule::cat_allowed(mono.now_ms(), changed) {
                                pending_dial = None;
                                // The answer goes back to the engine either way: only an
                                // acknowledged command makes the logged dial "commanded" (N-05).
                                let _ = int_tx.send(Internal::DialSet(hz, rig.set_dial(hz)));
                            }
                        }
                        if schedule.poll_now(mono.now_ms(), ptt_changed_ms.load(Ordering::SeqCst)) {
                            let _ = int_tx.try_send(Internal::Rig(rig.read()));
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                })
                .expect("spawn rig"),
        );
    }

    // Logbook thread: SQLite never runs on the control thread, and a contact is reported
    // "Logged" only after the logbook said it was written (F-16, F-20).
    {
        let mut log = parts.log;
        let ev_tx = ev_tx.clone();
        threads.push(
            std::thread::Builder::new()
                .name("z30-log".into())
                .spawn(move || {
                    for rec in log_rx.iter() {
                        let ev = match log.log(&rec) {
                            Ok(()) => Event::Logged(rec),
                            Err(error) => Event::LogFailed { call: rec.call.clone(), error },
                        };
                        // Not dropped when the queue is momentarily full: a lost "not logged" is
                        // a contact the operator believes is in the book.
                        let _ = ev_tx.send_timeout(ev, Duration::from_secs(2));
                    }
                })
                .expect("spawn log"),
        );
    }

    // Control thread.
    {
        let mut control = Control {
            engine,
            txs: TxScheduler::new(0.0),
            plan: None,
            audio: None,
            output: parts.output,
            ptt: ptt.clone(),
            mono: mono.clone(),
            halt: halt.clone(),
            stopper: stopper.clone(),
            ptt_changed_ms,
            release_unconfirmed: false,
            release_failures_reported: 0,
            output_failed: false,
            last_recovery_ms: 0,
        };
        let (stop, snapshot, wall, rx_cfg) = (stop.clone(), snapshot.clone(), parts.wall.clone(), rx_cfg.clone());
        threads.push(
            std::thread::Builder::new()
                .name("z30-control".into())
                .spawn(move || {
                    let ticker = tick(Duration::from_millis(5));
                    let mut last_publish = 0u64;
                    while !stop.load(Ordering::SeqCst) {
                        let mut dirty = control.check_halt();
                        select! {
                            recv(cmd_rx) -> c => if let Ok(c) = c {
                                let halt = control.engine.apply(c, control.now_ms());
                                // A dial the operator set goes to the radio, if there is rig control
                                // (without it the channel has no receiver and this does nothing).
                                if let Some(hz) = control.engine.take_dial_command() { let _ = dial_tx.try_send(hz); }
                                if halt {
                                    control.abort("the transmission was halted, disarmed or its configuration changed");
                                }
                                rx_cfg.store(Arc::new(control.engine.rx_config()));
                                dirty = true;
                            },
                            recv(int_rx) -> m => if let Ok(m) = m {
                                control.on_internal(m, &rx_cfg);
                                dirty = true;
                            },
                            recv(ticker) -> _ => {}
                        }
                        dirty |= control.check_halt();
                        dirty |= control.check_hardware();
                        let now = wall.utc_now();
                        for action in control.txs.tick(now) {
                            control.act(action);
                            dirty = true;
                        }
                        for e in control.engine.take_events() {
                            if let Event::ContactComplete(rec) = &e {
                                if let Err(err) = log_tx.try_send(rec.clone()) {
                                    let _ = ev_tx.try_send(Event::LogFailed {
                                        call: rec.call.clone(),
                                        error: format!("the logbook writer is not keeping up: {err}"),
                                    });
                                }
                            }
                            let _ = ev_tx.try_send(e);
                        }
                        let now_ms = control.now_ms();
                        if dirty || now_ms.saturating_sub(last_publish) >= 250 {
                            // Cached by the clock adapter; never a blocking query here.
                            control.engine.set_clock_status(wall.status());
                            snapshot.store(Arc::new(control.engine.snapshot(now_ms)));
                            last_publish = now_ms;
                        }
                    }
                    control.output.stop();
                    let _ = control.ptt.unkey();
                })
                .expect("spawn control"),
        );
    }
    RuntimeHandle {
        commands: cmd_tx,
        snapshot,
        events: ev_rx,
        waterfall: wf_rx,
        stop,
        halt,
        stopper,
        threads,
        watchdog: Some(watchdog),
        ptt,
    }
}

/// The control thread's state: the engine, the transmit timeline and the transmit hardware.
struct Control {
    engine: Engine,
    txs: TxScheduler,
    plan: Option<TxPlan>,
    audio: Option<Vec<f32>>,
    output: Box<dyn AudioOutput>,
    ptt: PttController,
    mono: Arc<dyn MonotonicClock>,
    halt: Arc<AtomicBool>,
    stopper: StopperSlot,
    ptt_changed_ms: Arc<AtomicU64>,
    /// Whether the engine has been told a release is unconfirmed.
    release_unconfirmed: bool,
    /// `PttController::release_failures` already reported to the operator.
    release_failures_reported: u64,
    output_failed: bool,
    last_recovery_ms: u64,
}

impl Control {
    fn now_ms(&self) -> u64 {
        self.mono.now_ms()
    }

    fn note_ptt(&mut self, keyed: bool) {
        let now = self.now_ms();
        self.engine.note_ptt(keyed, now);
        self.ptt_changed_ms.store(now, Ordering::SeqCst);
    }

    /// HALT from the handle: disarm and abandon whatever is planned or keyed.
    fn check_halt(&mut self) -> bool {
        if !self.halt.swap(false, Ordering::SeqCst) {
            return false;
        }
        let now = self.now_ms();
        self.engine.apply(Command::HaltTx, now);
        self.abort("halted by the operator");
        true
    }

    /// Ends the transmission in progress, if any, with `Aborted(reason)`.
    fn abort(&mut self, reason: &str) {
        if self.txs.busy() || self.plan.is_some() {
            self.finish(TxOutcome::Aborted(reason.into()));
        } else {
            self.output.stop();
        }
    }

    /// Stops the audio, releases PTT (and says so if the hardware did not confirm it), and
    /// reports the outcome. The engine records PTT as released only on a confirmed release.
    fn finish(&mut self, outcome: TxOutcome) {
        self.output.stop();
        // The timeline has already gone idle when it emits `Unkey`, so the controller's own state
        // is asked as well: anything that may be keyed is released.
        let keyed = self.txs.keyed() || self.ptt.is_keyed();
        self.txs.abort();
        self.audio = None;
        let released = if keyed { self.ptt.unkey() } else { Ok(crate::ptt::PttAck::Confirmed) };
        if let Some(p) = self.plan.take() {
            let now = self.now_ms();
            self.engine.tx_finished(p.slot(), &outcome, now);
        }
        match released {
            Ok(_) => {
                if keyed {
                    self.note_ptt(false);
                }
            }
            Err(e) => self.release_failed(&e.0),
        }
    }

    fn release_failed(&mut self, why: &str) {
        self.release_unconfirmed = true;
        self.release_failures_reported = self.ptt.release_failures();
        self.engine.set_ptt_release_unconfirmed(Some(why.to_string()));
        self.engine.tx_fault(format!(
            "PTT release NOT confirmed by the hardware ({why}): the transmitter may still be keyed. z-30 keeps retrying the release and refuses to transmit until it is confirmed; check the radio."
        ));
    }

    /// Hardware state the control thread must act on whatever the timeline is doing: an
    /// unconfirmed or newly confirmed PTT release, a watchdog release, an output failure.
    fn check_hardware(&mut self) -> bool {
        let mut dirty = false;
        match self.ptt.state() {
            PttState::ReleasePending if !self.release_unconfirmed => {
                let why = self.ptt.last_release_error().unwrap_or_else(|| "a release was requested and is not yet confirmed".into());
                self.release_failed(&why);
                dirty = true;
            }
            // Refused releases the watchdog already confirmed on a retry before this loop saw the
            // pending state: still reported, once, never lost to the timing.
            PttState::Released if !self.release_unconfirmed && self.ptt.release_failures() > self.release_failures_reported => {
                let failures = self.ptt.release_failures();
                self.release_failures_reported = failures;
                let why = self.ptt.last_release_error().unwrap_or_default();
                self.engine.tx_fault(format!("a PTT release was refused by the hardware ({why}) and confirmed on a retry"));
                self.engine.push_event(Event::PttReleaseConfirmed { failures });
                dirty = true;
            }
            PttState::Released if self.release_unconfirmed => {
                self.release_unconfirmed = false;
                self.release_failures_reported = self.ptt.release_failures();
                self.engine.set_ptt_release_unconfirmed(None);
                self.note_ptt(false);
                self.engine.push_event(Event::PttReleaseConfirmed { failures: self.ptt.release_failures() });
                dirty = true;
            }
            _ => {}
        }
        if self.ptt.take_watchdog_release() {
            self.engine.push_event(Event::WatchdogReleased);
            if self.txs.busy() || self.plan.is_some() {
                self.finish(TxOutcome::WatchdogAborted);
            }
            self.engine.tx_fault("the PTT watchdog released the transmitter at the transmit time limit".into());
            dirty = true;
        }
        match self.output.failure() {
            Some(f) if !self.output_failed => {
                self.output_failed = true;
                self.last_recovery_ms = self.now_ms();
                self.engine.set_output_fault(Some(format!("audio output failed: {f}")));
                self.engine.push_event(Event::Audio(format!("audio output failed: {f}; transmission refused until it recovers")));
                if self.txs.busy() || self.plan.is_some() {
                    self.finish(TxOutcome::Failed(format!("audio output failed while transmitting: {f}")));
                    self.engine.tx_fault(format!("audio output failed while transmitting: {f}"));
                }
                dirty = true;
            }
            Some(_) if !self.txs.busy() && self.now_ms().saturating_sub(self.last_recovery_ms) >= OUTPUT_RECOVERY_INTERVAL_MS => {
                self.last_recovery_ms = self.now_ms();
                if self.output.recover().is_ok() && self.output.failure().is_none() {
                    *self.stopper.lock().unwrap_or_else(|p| p.into_inner()) = self.output.stopper();
                    self.output_failed = false;
                    self.engine.set_output_fault(None);
                    self.engine.push_event(Event::Audio("audio output reopened".into()));
                    dirty = true;
                }
            }
            None if self.output_failed => {
                self.output_failed = false;
                self.engine.set_output_fault(None);
                self.engine.push_event(Event::Audio("audio output recovered".into()));
                dirty = true;
            }
            _ => {}
        }
        dirty
    }

    fn on_internal(&mut self, m: Internal, rx_cfg: &ArcSwap<RxConfig>) {
        let now = self.now_ms();
        match m {
            Internal::Slot(SlotEvent::Missed(s, r)) => self.engine.on_slot_missed(s, r),
            Internal::Slot(SlotEvent::ClockStepped { from, to }) => {
                self.engine.on_clock_stepped(from, to);
                // A frame in progress is timed on the clock that just jumped (review L-5).
                self.abort("the system clock stepped");
            }
            Internal::Slot(SlotEvent::Ready(_)) => {}
            Internal::Decoded(s, rep, done) => {
                self.engine.on_slot_report(s, &rep, done, now);
                rx_cfg.store(Arc::new(self.engine.rx_config()));
            }
            Internal::Rig(Ok(r)) => {
                self.engine.on_rig_reading(&r, now);
                // The radio can contradict the checked emission during the frame, too (F-45).
                if let Some(p) = &self.plan {
                    let v = self.engine.tx_still_permitted(p, now);
                    if !v.is_empty() {
                        let why = v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(" | ");
                        self.finish(TxOutcome::Aborted(format!("the radio contradicted the checked emission: {why}")));
                        self.engine.tx_fault(format!("transmission stopped: {why}"));
                    }
                }
            }
            Internal::Rig(Err(e)) => self.engine.on_rig_offline(&e),
            Internal::DialSet(hz, r) => self.engine.on_dial_command_result(hz, r),
            Internal::Health(h) => self.engine.set_audio_health(h),
        }
    }

    fn act(&mut self, action: TxAction) {
        match action {
            TxAction::Plan(slot) => {
                let now = self.now_ms();
                if let Some(p) = self.engine.plan_tx(slot, now) {
                    let rate = self.output.sample_rate();
                    match tx_audio(&p, rate) {
                        Ok(a) => {
                            self.txs.set_output_latency(self.output.latency_sec());
                            self.txs.accept(slot, a.len() as f64 / rate as f64);
                            self.audio = Some(a);
                            self.plan = Some(p);
                        }
                        Err(e) => self.engine.tx_fault(e),
                    }
                }
            }
            TxAction::Key => {
                if self.halt.load(Ordering::SeqCst) {
                    return; // the next tick's check_halt abandons it
                }
                match self.ptt.key() {
                    Ok(_) => {
                        self.note_ptt(true);
                        if self.halt.load(Ordering::SeqCst) {
                            return; // keyed as HALT arrived: the next check_halt releases it
                        }
                        if let Some(p) = &self.plan {
                            self.engine.tx_started(p);
                        }
                    }
                    Err(e) => {
                        self.txs.abort();
                        self.audio = None;
                        if let Some(p) = self.plan.take() {
                            let now = self.now_ms();
                            self.engine.tx_finished(p.slot(), &TxOutcome::Failed(format!("PTT failed: {e}")), now);
                        }
                        self.engine.tx_fault(format!("PTT failed: {e}"));
                    }
                }
            }
            TxAction::StartAudio => {
                if self.halt.load(Ordering::SeqCst) {
                    return;
                }
                if let Some(a) = self.audio.take() {
                    if let Err(e) = self.output.play(a) {
                        // `finish` stops the output, so a partly queued frame is flushed rather
                        // than left to play unkeyed (F-19).
                        self.finish(TxOutcome::Failed(format!("audio output failed: {e}")));
                        self.engine.tx_fault(format!("audio output failed: {e}"));
                    }
                }
            }
            TxAction::Unkey { outcome } => {
                let outcome = if self.ptt.watchdog_fired() {
                    TxOutcome::WatchdogAborted
                } else {
                    match (outcome, self.output.queued_samples()) {
                        (TxOutcome::Complete, Some(q)) if q > 0 => TxOutcome::Partial(format!(
                            "{:.3} s of the frame had not been played when its time ran out",
                            q as f64 / self.output.sample_rate() as f64
                        )),
                        (o, _) => o,
                    }
                };
                self.finish(outcome);
            }
            TxAction::Abandon(reason) => {
                self.audio = None;
                if let Some(p) = self.plan.take() {
                    let now = self.now_ms();
                    self.engine.tx_finished(p.slot(), &TxOutcome::Aborted(reason), now);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::safe_level;

    #[test]
    fn the_applied_level_is_within_full_scale_and_nan_is_silence_on_both_paths() {
        // Frame and Tune both scale by `safe_level` (review L-3: Tune's bare clamp passed NaN).
        assert_eq!(safe_level(f32::NAN), 0.0);
        assert_eq!(safe_level(f32::INFINITY), 1.0);
        assert_eq!(safe_level(5.0), 1.0);
        assert_eq!(safe_level(-1.0), 0.0);
        assert_eq!(safe_level(0.25), 0.25);
    }
}
