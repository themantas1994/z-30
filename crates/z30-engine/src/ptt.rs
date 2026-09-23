//! PTT: one keying implementation, and the stuck-transmitter defences around it.
//!
//! Carried over from the TypeScript transmit path (AGENTS.md section 4), in native form:
//!
//! - **One keying implementation.** Every transmit path keys through `PttController::key`, which
//!   returns whether the hardware accepted the command. A line that cannot confirm anything
//!   (VOX) says so in its `PttAck` rather than reporting "verified".
//! - **A release drives what the key drove.** The controller holds exactly one line; a release
//!   goes to that object. Replacing the line while keyed unkeys the old one first.
//! - **Three independent stuck-transmitter layers,** each defending a different failure:
//!   1. the engine's own TX state machine ends every frame and unkeys;
//!   2. a watchdog thread, sharing nothing with the engine loop but the line, unkeys at
//!      `MAX_TX_SECONDS` whatever the engine is doing (a hung engine, a lost unkey);
//!   3. process-exit and panic release (`emergency_release_all`, a Drop guard and a panic hook
//!      installed by the application), for the process going away while keyed.
//!
//!   What none of them can cover - SIGKILL, a power cut - is covered only by hardware:
//!   serial RTS/DTR drop when the port closes; a CM108 GPIO does NOT, so a CM108 station
//!   should have the radio's own transmit time-out enabled. `docs/safety.md` says so.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

/// Hard ceiling on one keyed period, seconds. A frame is 24 s.
pub const MAX_TX_SECONDS: u64 = 40;

/// What the hardware confirmed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PttAck {
    /// The line/rig accepted the command.
    Confirmed,
    /// Nothing to confirm: the method has no feedback (VOX). Never reported as verified.
    Unverifiable,
}

/// A keying failure. The line may or may not have changed; callers treat it as not keyed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PttError(pub String);

impl std::fmt::Display for PttError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PttError {}

/// A keying line. Implemented in `z30-io` (serial, CM108, rigctld, VOX) and by test fakes.
pub trait PttLine: Send {
    /// Drives the line. Must return promptly (adapters use timeouts).
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError>;
    /// Human description ("RTS on /dev/ttyUSB0, active high").
    fn describe(&self) -> String;
}

/// Monotonic milliseconds, injectable for tests.
pub trait MonotonicClock: Send + Sync {
    /// Milliseconds since an arbitrary fixed origin.
    fn now_ms(&self) -> u64;
}

/// The real monotonic clock.
pub struct SystemMonotonic(std::time::Instant);

impl Default for SystemMonotonic {
    fn default() -> Self {
        SystemMonotonic(std::time::Instant::now())
    }
}

impl MonotonicClock for SystemMonotonic {
    fn now_ms(&self) -> u64 {
        self.0.elapsed().as_millis() as u64
    }
}

/// Why the line was released.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReleaseCause {
    /// Normal end of transmission.
    Normal,
    /// The watchdog's deadline passed.
    Watchdog,
    /// Emergency (exit, panic, fault).
    Emergency,
}

struct Shared {
    line: Mutex<Box<dyn PttLine>>,
    keyed: AtomicBool,
    deadline_ms: AtomicU64,
    watchdog_fired: AtomicBool,
    limit_ms: u64,
}

impl Shared {
    fn release(&self, cause: ReleaseCause) -> Result<PttAck, PttError> {
        // The flag drops first so no one believes the station is keyed while the line is being
        // released; if the release fails the flag is still false, which is the safe belief for
        // the scheduler (it will not start audio) and the error goes to the caller.
        self.keyed.store(false, Ordering::SeqCst);
        if cause == ReleaseCause::Watchdog {
            self.watchdog_fired.store(true, Ordering::SeqCst);
        }
        let mut line = self.line.lock().unwrap_or_else(|p| p.into_inner());
        line.set(false)
    }
}

fn registry() -> &'static Mutex<Vec<Weak<Shared>>> {
    static R: OnceLock<Mutex<Vec<Weak<Shared>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Vec::new()))
}

/// Releases every live PTT line in the process. For the panic hook and signal handlers.
pub fn emergency_release_all() {
    let list = registry().lock().unwrap_or_else(|p| p.into_inner());
    for w in list.iter() {
        if let Some(s) = w.upgrade() {
            let _ = s.release(ReleaseCause::Emergency);
        }
    }
}

/// Installs a panic hook that releases every PTT line before the default hook runs. Call once
/// at application start.
pub fn install_panic_release() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        emergency_release_all();
        prev(info);
    }));
}

/// The keying controller. Cheap to clone; clones share the line.
#[derive(Clone)]
pub struct PttController {
    shared: Arc<Shared>,
    clock: Arc<dyn MonotonicClock>,
}

impl PttController {
    /// A controller with the production limit.
    pub fn new(line: Box<dyn PttLine>, clock: Arc<dyn MonotonicClock>) -> Self {
        Self::with_limit(line, clock, MAX_TX_SECONDS * 1000)
    }

    /// A controller with a shorter limit (tests only use this; the limit can never be raised
    /// above MAX_TX_SECONDS).
    pub fn with_limit(line: Box<dyn PttLine>, clock: Arc<dyn MonotonicClock>, limit_ms: u64) -> Self {
        let shared = Arc::new(Shared {
            line: Mutex::new(line),
            keyed: AtomicBool::new(false),
            deadline_ms: AtomicU64::new(u64::MAX),
            watchdog_fired: AtomicBool::new(false),
            limit_ms: limit_ms.min(MAX_TX_SECONDS * 1000),
        });
        registry().lock().unwrap_or_else(|p| p.into_inner()).push(Arc::downgrade(&shared));
        PttController { shared, clock }
    }

    /// Keys the transmitter. The watchdog deadline is armed BEFORE the line is driven, so a
    /// failure inside the driver still leaves a deadline that will unkey.
    pub fn key(&self) -> Result<PttAck, PttError> {
        let now = self.clock.now_ms();
        self.shared.deadline_ms.store(now + self.shared.limit_ms, Ordering::SeqCst);
        self.shared.watchdog_fired.store(false, Ordering::SeqCst);
        self.shared.keyed.store(true, Ordering::SeqCst);
        let r = {
            let mut line = self.shared.line.lock().unwrap_or_else(|p| p.into_inner());
            line.set(true)
        };
        if r.is_err() {
            // A key that never reached the hardware must not leave anything believing it is
            // keyed - and the release is still sent, in case the line half-changed.
            let _ = self.shared.release(ReleaseCause::Emergency);
            self.shared.deadline_ms.store(u64::MAX, Ordering::SeqCst);
        }
        r
    }

    /// Releases the line the key drove.
    pub fn unkey(&self) -> Result<PttAck, PttError> {
        self.shared.deadline_ms.store(u64::MAX, Ordering::SeqCst);
        self.shared.release(ReleaseCause::Normal)
    }

    /// Whether the controller believes the line is keyed.
    pub fn is_keyed(&self) -> bool {
        self.shared.keyed.load(Ordering::SeqCst)
    }

    /// Whether the watchdog released the line since the last key.
    pub fn watchdog_fired(&self) -> bool {
        self.shared.watchdog_fired.load(Ordering::SeqCst)
    }

    /// One watchdog check at the current time: releases the line if keyed past the deadline.
    /// The watchdog thread calls this; tests call it with a virtual clock.
    pub fn watchdog_tick(&self) -> bool {
        let now = self.clock.now_ms();
        if self.is_keyed() && now >= self.shared.deadline_ms.load(Ordering::SeqCst) {
            let _ = self.shared.release(ReleaseCause::Watchdog);
            return true;
        }
        false
    }

    /// Starts the watchdog thread. It holds only a weak reference, so it ends with the
    /// controller. Independent of the engine loop by construction.
    pub fn spawn_watchdog(&self, period: Duration) -> std::thread::JoinHandle<()> {
        let weak = Arc::downgrade(&self.shared);
        let clock = self.clock.clone();
        std::thread::Builder::new()
            .name("z30-ptt-watchdog".into())
            .spawn(move || loop {
                std::thread::sleep(period);
                let Some(shared) = weak.upgrade() else { return };
                let c = PttController { shared, clock: clock.clone() };
                c.watchdog_tick();
            })
            .expect("spawn watchdog")
    }

    /// Replaces the keying line. Unkeys the old line first if keyed, so a configuration change
    /// can never strand a keyed transmitter on a line nobody will release.
    pub fn replace_line(&self, new_line: Box<dyn PttLine>) -> Result<(), PttError> {
        if self.is_keyed() {
            self.unkey()?;
        }
        let mut line = self.shared.line.lock().unwrap_or_else(|p| p.into_inner());
        let _ = line.set(false);
        *line = new_line;
        Ok(())
    }

    /// Description of the current line.
    pub fn describe(&self) -> String {
        self.shared.line.lock().unwrap_or_else(|p| p.into_inner()).describe()
    }
}

impl Drop for Shared {
    fn drop(&mut self) {
        if self.keyed.load(Ordering::SeqCst) {
            let line = self.line.get_mut().unwrap_or_else(|p| p.into_inner());
            let _ = line.set(false);
        }
    }
}

/// A line that refuses everything: what an unconfigured station has. Transmit is refused
/// before it is reached; if it is reached anyway, keying fails.
pub struct NoPtt;

impl PttLine for NoPtt {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        if keyed {
            Err(PttError("no PTT method is configured".into()))
        } else {
            Ok(PttAck::Confirmed)
        }
    }

    fn describe(&self) -> String {
        "no PTT configured".into()
    }
}

/// VOX: the audio carrier keys the radio. Nothing can be confirmed.
pub struct VoxPtt;

impl PttLine for VoxPtt {
    fn set(&mut self, _keyed: bool) -> Result<PttAck, PttError> {
        Ok(PttAck::Unverifiable)
    }

    fn describe(&self) -> String {
        "VOX (radio keys on audio; not verifiable)".into()
    }
}
