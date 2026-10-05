//! PTT: one keying implementation, and the stuck-transmitter defences around it.
//!
//! Carried over from the TypeScript transmit path (AGENTS.md section 4), in native form:
//!
//! - **One keying implementation.** Every transmit path keys through `PttController::key`, which
//!   returns whether the hardware accepted the command. A line that cannot confirm anything
//!   (VOX) says so in its `PttAck` rather than reporting "verified".
//! - **A release drives what the key drove.** The controller holds exactly one line; a release
//!   goes to that object. Replacing the line while keyed unkeys the old one first.
//! - **A release is not a release until the hardware confirms it.** The line is `Keyed` ->
//!   `ReleasePending` -> `Released`, and only a confirmed `set(false)` makes the last step. A
//!   release the hardware refused (a rigctld `T 0` that timed out, a CM108 HID write error)
//!   leaves the line "possibly keyed": `is_keyed()` stays true, the watchdog retries the release
//!   on every tick until one is confirmed, every failure is counted and kept for the operator,
//!   and a new key is refused. Before this the flag dropped first, so a refused release left the
//!   controller, the watchdog and Drop all believing the radio was released while it stayed
//!   keyed until its own time-out timer (2026-09-28 audit F-01).
//! - **Three independent stuck-transmitter layers,** each defending a different failure:
//!   1. the engine's own TX state machine ends every frame and unkeys;
//!   2. a watchdog thread, sharing nothing with the engine loop but the line, unkeys at
//!      `MAX_TX_SECONDS` whatever the engine is doing (a hung engine, a lost unkey) and retries
//!      an unconfirmed release;
//!   3. process-exit and panic release (`emergency_release_all`, a Drop guard and a panic hook
//!      installed by the application), for the process going away while keyed.
//!
//!   None of them may wait on a lock that a panicking or hung thread can hold: a line driver is
//!   always called inside `catch_unwind`, the watchdog only ever `try_lock`s the line, and the
//!   emergency path never blocks on a line the current thread is already driving. A panic inside
//!   `PttLine::set` used to deadlock the panic hook, the watchdog and the signal handler on the
//!   line mutex the panicking thread still held (F-15).
//!
//!   What none of them can cover - SIGKILL, a power cut - is covered only by hardware:
//!   serial RTS/DTR drop when the port closes; a CM108 GPIO does NOT, so a CM108 station
//!   should have the radio's own transmit time-out enabled. `docs/safety.md` says so.

use std::cell::Cell;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError, Weak};
use std::time::Duration;

/// Hard ceiling on one keyed period, seconds. A frame is 24 s.
pub const MAX_TX_SECONDS: u64 = 40;

/// How long the emergency path waits for a line another thread is driving, per line. A line
/// driver must return promptly (adapters use 1.5 s timeouts), so this is enough for a slow
/// release to finish and still bounded if a driver hangs.
pub const EMERGENCY_LOCK_WAIT_MS: u64 = 2_000;

/// What the hardware confirmed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PttAck {
    /// The line/rig accepted the command.
    Confirmed,
    /// Nothing to confirm: the method has no feedback (VOX). Never reported as verified.
    Unverifiable,
}

/// A keying failure. The line may or may not have changed.
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
    /// Emergency (exit, panic, fault, halt).
    Emergency,
    /// A retry of a release the hardware had not confirmed.
    Retry,
}

/// What the controller knows about the line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PttState {
    /// A release was confirmed by the hardware (or the line was never keyed).
    Released,
    /// A key was sent (and possibly confirmed).
    Keyed,
    /// A release was asked for and has not been confirmed: the transmitter may still be keyed.
    ReleasePending,
}

const RELEASED: u8 = 0;
const KEYED: u8 = 1;
const RELEASE_PENDING: u8 = 2;

fn state_of(v: u8) -> PttState {
    match v {
        RELEASED => PttState::Released,
        KEYED => PttState::Keyed,
        _ => PttState::ReleasePending,
    }
}

thread_local! {
    /// Set while this thread is inside a line driver, so the panic hook (which runs on the
    /// panicking thread before unwinding releases anything) knows not to wait for a line lock
    /// this very thread may hold.
    static DRIVING: Cell<bool> = const { Cell::new(false) };
}

fn this_thread_is_driving() -> bool {
    DRIVING.try_with(|d| d.get()).unwrap_or(true)
}

struct Shared {
    line: Mutex<Box<dyn PttLine>>,
    state: AtomicU8,
    deadline_ms: AtomicU64,
    watchdog_fired: AtomicBool,
    /// Set by the watchdog when it fires; cleared by `take_watchdog_release`.
    watchdog_unreported: AtomicBool,
    release_failures: AtomicU64,
    last_release_error: Mutex<Option<String>>,
    limit_ms: u64,
}

impl Shared {
    /// Calls the driver with the line lock held, turning a panic inside it into an error: a
    /// panic must not leave the lock held by an unwound frame, and must not escape into the
    /// scheduler as anything but "the hardware did not confirm".
    fn drive(line: &mut Box<dyn PttLine>, keyed: bool) -> Result<PttAck, PttError> {
        let was = DRIVING.try_with(|d| d.replace(true)).unwrap_or(false);
        let r = catch_unwind(AssertUnwindSafe(|| line.set(keyed)));
        let _ = DRIVING.try_with(|d| d.set(was));
        match r {
            Ok(r) => r,
            Err(_) => Err(PttError(format!("the {} line driver panicked", if keyed { "key" } else { "release" }))),
        }
    }

    fn lock_line(&self) -> MutexGuard<'_, Box<dyn PttLine>> {
        self.line.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn try_lock_line(&self) -> Option<MutexGuard<'_, Box<dyn PttLine>>> {
        match self.line.try_lock() {
            Ok(g) => Some(g),
            Err(TryLockError::Poisoned(p)) => Some(p.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        }
    }

    fn mark_release_pending(&self) {
        // Released stays released (nothing to undo); anything else may be on the air.
        let _ = self.state.compare_exchange(KEYED, RELEASE_PENDING, Ordering::SeqCst, Ordering::SeqCst);
    }

    /// Drives a release on a line the caller holds and records the outcome. Only a confirmed
    /// release moves the state to `Released`.
    fn release_locked(&self, line: &mut Box<dyn PttLine>, cause: ReleaseCause) -> Result<PttAck, PttError> {
        if cause == ReleaseCause::Watchdog {
            self.watchdog_fired.store(true, Ordering::SeqCst);
            self.watchdog_unreported.store(true, Ordering::SeqCst);
        }
        self.mark_release_pending();
        let r = Self::drive(line, false);
        match &r {
            Ok(_) => {
                self.state.store(RELEASED, Ordering::SeqCst);
                self.deadline_ms.store(u64::MAX, Ordering::SeqCst);
            }
            Err(e) => {
                self.state.store(RELEASE_PENDING, Ordering::SeqCst);
                self.release_failures.fetch_add(1, Ordering::SeqCst);
                *self.last_release_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(e.0.clone());
            }
        }
        r
    }

    /// A release that waits for the line (normal and replacement paths).
    fn release(&self, cause: ReleaseCause) -> Result<PttAck, PttError> {
        if self.state.load(Ordering::SeqCst) == RELEASED {
            return Ok(PttAck::Confirmed);
        }
        self.mark_release_pending();
        let mut line = self.lock_line();
        if self.state.load(Ordering::SeqCst) == RELEASED {
            // Another thread confirmed it while this one waited.
            return Ok(PttAck::Confirmed);
        }
        self.release_locked(&mut line, cause)
    }

    /// A release that never waits more than `wait_ms` for the line, and not at all when the
    /// current thread may be the one holding it. If the line cannot be reached the state is
    /// left `ReleasePending`, which the watchdog retries.
    fn release_bounded(&self, cause: ReleaseCause, wait_ms: u64) -> bool {
        if self.state.load(Ordering::SeqCst) == RELEASED {
            return true;
        }
        self.mark_release_pending();
        let wait_ms = if this_thread_is_driving() { 0 } else { wait_ms };
        let t0 = std::time::Instant::now();
        loop {
            if let Some(mut line) = self.try_lock_line() {
                if self.state.load(Ordering::SeqCst) == RELEASED {
                    return true;
                }
                return self.release_locked(&mut line, cause).is_ok();
            }
            if t0.elapsed() >= Duration::from_millis(wait_ms) {
                return false;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

fn registry() -> &'static Mutex<Vec<Weak<Shared>>> {
    static R: OnceLock<Mutex<Vec<Weak<Shared>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Vec::new()))
}

/// Set by `refuse_further_keys`: from then on no line in the process may be keyed.
static NO_MORE_KEYS: AtomicBool = AtomicBool::new(false);

/// For the exit and signal paths, before they release everything: a `key()` racing them (the
/// control thread's key for a slot that starts as SIGTERM arrives) would otherwise key the line
/// after the release confirmed and just before the process exits, leaving a CAT or CM108 radio
/// keyed until its own time-out (transmit-safety audit D-2). A key already in its driver when
/// this is set releases again as soon as the driver returns. There is no way back: it is for a
/// process that is about to end.
pub fn refuse_further_keys() {
    NO_MORE_KEYS.store(true, Ordering::SeqCst);
}

/// Releases every live PTT line in the process. For the panic hook and signal handlers.
///
/// The registry lock is held only to copy the list, never across a line driver, and each line
/// is reached with a bounded wait (none at all for a line the calling thread may be driving), so
/// this cannot deadlock on a panicking or hung driver. A line it could not reach is left
/// `ReleasePending` for the watchdog. Returns whether every line confirmed its release.
pub fn emergency_release_all() -> bool {
    let lines: Vec<Arc<Shared>> = {
        let mut list = registry().lock().unwrap_or_else(|p| p.into_inner());
        list.retain(|w| w.strong_count() > 0);
        list.iter().filter_map(Weak::upgrade).collect()
    };
    let mut all = true;
    for s in lines {
        all &= s.release_bounded(ReleaseCause::Emergency, EMERGENCY_LOCK_WAIT_MS);
    }
    all
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
            state: AtomicU8::new(RELEASED),
            deadline_ms: AtomicU64::new(u64::MAX),
            watchdog_fired: AtomicBool::new(false),
            watchdog_unreported: AtomicBool::new(false),
            release_failures: AtomicU64::new(0),
            last_release_error: Mutex::new(None),
            limit_ms: limit_ms.min(MAX_TX_SECONDS * 1000),
        });
        registry().lock().unwrap_or_else(|p| p.into_inner()).push(Arc::downgrade(&shared));
        PttController { shared, clock }
    }

    /// Keys the transmitter. The watchdog deadline is armed BEFORE the line is driven, so a
    /// failure inside the driver still leaves a deadline that will unkey; and it is armed only
    /// on the released -> keyed transition, so keying an already keyed line cannot extend the
    /// keyed period past `MAX_TX_SECONDS` (F-44: a second key used to re-arm it).
    ///
    /// Refused, without touching the line, while a previous release is unconfirmed: a line
    /// that may already be keyed is not keyed again (F-01).
    pub fn key(&self) -> Result<PttAck, PttError> {
        let s = &self.shared;
        let now = self.clock.now_ms();
        match s.state.compare_exchange(RELEASED, KEYED, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => {
                s.deadline_ms.store(now + s.limit_ms, Ordering::SeqCst);
                s.watchdog_fired.store(false, Ordering::SeqCst);
            }
            Err(KEYED) => {}
            Err(_) => {
                return Err(PttError(format!(
                    "refusing to key: the previous release was not confirmed by the hardware ({})",
                    self.last_release_error().unwrap_or_else(|| "no reason recorded".into())
                )))
            }
        }
        let mut line = s.lock_line();
        if s.state.load(Ordering::SeqCst) != KEYED {
            // Released (watchdog, halt, emergency) while this thread waited for the line.
            return Err(PttError("the transmitter was released before the key was sent".into()));
        }
        if NO_MORE_KEYS.load(Ordering::SeqCst) {
            let _ = s.release_locked(&mut line, ReleaseCause::Emergency);
            return Err(PttError("refusing to key: the process is exiting".into()));
        }
        let r = Shared::drive(&mut line, true);
        if r.is_err() || s.state.load(Ordering::SeqCst) != KEYED || NO_MORE_KEYS.load(Ordering::SeqCst) {
            // A key that never reached the hardware, or one that raced a halt: the release is
            // sent in case the line half-changed, and must itself be confirmed.
            let _ = s.release_locked(&mut line, ReleaseCause::Emergency);
            return r.and(Err(PttError("the transmitter was released while the key was being sent".into())));
        }
        r
    }

    /// Releases the line the key drove. `Err` means the hardware did not confirm it: the line
    /// stays "possibly keyed" and the watchdog keeps retrying.
    pub fn unkey(&self) -> Result<PttAck, PttError> {
        self.shared.release(ReleaseCause::Normal)
    }

    /// Asks for a release from any thread without ever blocking: tries the line once, and if
    /// another thread is driving it, leaves it `ReleasePending` for that thread's own check and
    /// the watchdog (50 ms). For HALT: it must not wait behind a hung control thread.
    pub fn request_release_now(&self) -> bool {
        self.shared.release_bounded(ReleaseCause::Emergency, 0)
    }

    /// A release that waits at most `wait_ms` for a line another thread holds (none at all for one
    /// the current thread is driving); if it cannot get the line it leaves `ReleasePending` for the
    /// watchdog. Returns whether the line was confirmed released. For shutdown, which must not
    /// hang behind a wedged driver (transmit-safety audit D-4).
    pub fn release_within(&self, wait_ms: u64) -> bool {
        self.shared.release_bounded(ReleaseCause::Normal, wait_ms)
    }

    /// HALT's release: `request_release_now` on a short-lived thread, so the caller never waits
    /// for the driver's I/O either. On the GUI thread a hung rigctld held the window, HALT button
    /// and all, for its timeouts (post-remediation review L-1). The state changes exactly as with
    /// `request_release_now`; if no thread can be started the release is driven here instead.
    pub fn request_release_in_background(&self) {
        if self.state() == PttState::Released {
            return;
        }
        let me = self.clone();
        let spawned = std::thread::Builder::new().name("z30-ptt-release".into()).spawn(move || {
            me.request_release_now();
        });
        if spawned.is_err() {
            self.request_release_now();
        }
    }

    /// Whether the transmitter may be keyed: keyed, or a release not yet confirmed.
    pub fn is_keyed(&self) -> bool {
        self.state() != PttState::Released
    }

    /// The controller's state.
    pub fn state(&self) -> PttState {
        state_of(self.shared.state.load(Ordering::SeqCst))
    }

    /// Releases the hardware refused, since the controller was created.
    pub fn release_failures(&self) -> u64 {
        self.shared.release_failures.load(Ordering::SeqCst)
    }

    /// The last release failure's reason.
    pub fn last_release_error(&self) -> Option<String> {
        self.shared.last_release_error.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// Whether the watchdog released the line since the last key.
    pub fn watchdog_fired(&self) -> bool {
        self.shared.watchdog_fired.load(Ordering::SeqCst)
    }

    /// True once per watchdog release: for the runtime to report it whatever its timeline was
    /// doing (F-46: a watchdog release used to be reported only while a frame was busy).
    pub fn take_watchdog_release(&self) -> bool {
        self.shared.watchdog_unreported.swap(false, Ordering::SeqCst)
    }

    /// One watchdog check at the current time: releases the line if keyed past the deadline,
    /// and retries an unconfirmed release whatever the deadline. Never blocks on the line: if
    /// another thread is driving it, the check is repeated on the next tick. Returns true when
    /// the deadline fired.
    pub fn watchdog_tick(&self) -> bool {
        let s = &self.shared;
        let now = self.clock.now_ms();
        match s.state.load(Ordering::SeqCst) {
            KEYED if now >= s.deadline_ms.load(Ordering::SeqCst) => {
                s.watchdog_fired.store(true, Ordering::SeqCst);
                s.watchdog_unreported.store(true, Ordering::SeqCst);
                s.mark_release_pending();
                if let Some(mut line) = s.try_lock_line() {
                    let _ = s.release_locked(&mut line, ReleaseCause::Watchdog);
                }
                true
            }
            RELEASE_PENDING => {
                if let Some(mut line) = s.try_lock_line() {
                    if s.state.load(Ordering::SeqCst) == RELEASE_PENDING {
                        let _ = s.release_locked(&mut line, ReleaseCause::Retry);
                    }
                }
                false
            }
            _ => false,
        }
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
    /// can never strand a keyed transmitter on a line nobody will release; if the old line
    /// cannot confirm its release it is kept (and retried) and the replacement is refused.
    pub fn replace_line(&self, new_line: Box<dyn PttLine>) -> Result<(), PttError> {
        if self.is_keyed() {
            self.unkey()?;
        }
        let mut line = self.shared.lock_line();
        let _ = Shared::drive(&mut line, false);
        *line = new_line;
        Ok(())
    }

    /// Description of the current line.
    pub fn describe(&self) -> String {
        self.shared.lock_line().describe()
    }
}

impl Drop for Shared {
    fn drop(&mut self) {
        if *self.state.get_mut() != RELEASED {
            let line = self.line.get_mut().unwrap_or_else(|p| p.into_inner());
            let _ = Shared::drive(line, false);
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
