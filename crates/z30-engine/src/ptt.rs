//! PTT: one keying implementation, and the stuck-transmitter defences around it.
//!
//! Carried over from the TypeScript transmit path (docs/safety.md), in native form:
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
//! - **A keyed state always carries its own watchdog deadline.** State and deadline are one
//!   atomic word, changed together. As two atomics, a release stored `Released` and then cleared
//!   the deadline in a second store, so a key armed between the two had its deadline wiped and
//!   that transmission ran with no watchdog; and the watchdog acted on whatever was keyed when it
//!   got to it, so a tick that read an expired period could release the next one.
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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// The controller's state and the keyed period's watchdog deadline share one word: the state in
/// the top two bits, the deadline (monotonic ms) below. A thread that sees `Keyed` sees the
/// deadline the key that made it armed, never none and never an earlier period's.
const STATE_SHIFT: u32 = 62;
/// The latest deadline the word holds, ms (about 146 million years of monotonic time). A key
/// whose deadline would be later gets this one, which is earlier: never later than now + limit.
const DEADLINE_MAX: u64 = (1 << STATE_SHIFT) - 1;
/// `Released`; the deadline bits are unused while released.
const RELEASED_WORD: u64 = (RELEASED as u64) << STATE_SHIFT;

fn pack(state: u8, deadline_ms: u64) -> u64 {
    ((state as u64) << STATE_SHIFT) | (deadline_ms & DEADLINE_MAX)
}

fn state_bits(word: u64) -> u8 {
    (word >> STATE_SHIFT) as u8
}

fn deadline_bits(word: u64) -> u64 {
    word & DEADLINE_MAX
}

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
    /// State and watchdog deadline, packed by `pack`.
    status: AtomicU64,
    watchdog_fired: AtomicBool,
    /// Set by the watchdog when it fires; cleared by `take_watchdog_release`.
    watchdog_unreported: AtomicBool,
    release_failures: AtomicU64,
    last_release_error: Mutex<Option<String>>,
    limit_ms: u64,
    /// Set by `PttController::close`: this controller never keys again.
    closed: AtomicBool,
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

    fn state(&self) -> u8 {
        state_bits(self.status.load(Ordering::SeqCst))
    }

    fn mark_release_pending(&self) {
        // Released stays released (nothing to undo); anything else may be on the air.
        let _ = self
            .status
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |w| (state_bits(w) == KEYED).then(|| pack(RELEASE_PENDING, deadline_bits(w))));
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
                // `Released` and the cleared deadline in one store. Only the holder of the line
                // takes the word out of `ReleasePending`, so nothing else changed it since the
                // mark above, except a key armed meanwhile on a line that was already released:
                // that key is left alone, and drives its line after this release, under the lock.
                let _ = self.status.try_update(Ordering::SeqCst, Ordering::SeqCst, |w| (state_bits(w) != KEYED).then_some(RELEASED_WORD));
                #[cfg(test)]
                hooks::reach(hooks::Point::ReleasePublished);
            }
            Err(e) => {
                self.status.store(pack(RELEASE_PENDING, 0), Ordering::SeqCst);
                self.release_failures.fetch_add(1, Ordering::SeqCst);
                *self.last_release_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(e.0.clone());
            }
        }
        r
    }

    /// A release that waits for the line (normal and replacement paths).
    fn release(&self, cause: ReleaseCause) -> Result<PttAck, PttError> {
        if self.state() == RELEASED {
            return Ok(PttAck::Confirmed);
        }
        self.mark_release_pending();
        let mut line = self.lock_line();
        if self.state() == RELEASED {
            // Another thread confirmed it while this one waited.
            return Ok(PttAck::Confirmed);
        }
        self.release_locked(&mut line, cause)
    }

    /// A release that never waits more than `wait_ms` for the line, and not at all when the
    /// current thread may be the one holding it. If the line cannot be reached the state is
    /// left `ReleasePending`, which the watchdog retries.
    fn release_bounded(&self, cause: ReleaseCause, wait_ms: u64) -> bool {
        if self.state() == RELEASED {
            return true;
        }
        self.mark_release_pending();
        let wait_ms = if this_thread_is_driving() { 0 } else { wait_ms };
        let t0 = std::time::Instant::now();
        loop {
            if let Some(mut line) = self.try_lock_line() {
                if self.state() == RELEASED {
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
            status: AtomicU64::new(RELEASED_WORD),
            watchdog_fired: AtomicBool::new(false),
            watchdog_unreported: AtomicBool::new(false),
            release_failures: AtomicU64::new(0),
            last_release_error: Mutex::new(None),
            limit_ms: limit_ms.min(MAX_TX_SECONDS * 1000),
            closed: AtomicBool::new(false),
        });
        registry().lock().unwrap_or_else(|p| p.into_inner()).push(Arc::downgrade(&shared));
        PttController { shared, clock }
    }

    /// Keys the transmitter. The watchdog deadline is armed BEFORE the line is driven, so a
    /// failure inside the driver still leaves a deadline that will unkey; it is armed in the
    /// same atomic step as the keyed state, so no thread sees one without the other; and it is
    /// armed only on the released -> keyed transition, so keying an already keyed line cannot
    /// extend the keyed period past `MAX_TX_SECONDS` (F-44: a second key used to re-arm it).
    ///
    /// Refused, without touching the line, while a previous release is unconfirmed: a line
    /// that may already be keyed is not keyed again (F-01).
    pub fn key(&self) -> Result<PttAck, PttError> {
        let s = &self.shared;
        let now = self.clock.now_ms();
        // Saturating and capped to what the word holds: a clock near the end of its range gives
        // an earlier deadline, never a later one, a wrapped one or an overflow panic.
        let armed = pack(KEYED, now.saturating_add(s.limit_ms).min(DEADLINE_MAX));
        match s.status.try_update(Ordering::SeqCst, Ordering::SeqCst, |w| (state_bits(w) == RELEASED).then_some(armed)) {
            Ok(_) => s.watchdog_fired.store(false, Ordering::SeqCst),
            Err(w) if state_bits(w) == KEYED => {}
            Err(_) => {
                return Err(PttError(format!(
                    "refusing to key: the previous release was not confirmed by the hardware ({})",
                    self.last_release_error().unwrap_or_else(|| "no reason recorded".into())
                )))
            }
        }
        #[cfg(test)]
        hooks::reach(hooks::Point::KeyArmed);
        let mut line = s.lock_line();
        if s.state() != KEYED {
            // Released (watchdog, halt, emergency) while this thread waited for the line.
            return Err(PttError("the transmitter was released before the key was sent".into()));
        }
        // Read after the state went KEYED (SeqCst), so a `close` either is seen here or happened
        // after the KEYED store, where the closer's own read of the state sees it.
        if NO_MORE_KEYS.load(Ordering::SeqCst) || s.closed.load(Ordering::SeqCst) {
            let _ = s.release_locked(&mut line, ReleaseCause::Emergency);
            return Err(PttError("refusing to key: the process is exiting or the station is stopping".into()));
        }
        let r = Shared::drive(&mut line, true);
        if r.is_err() || s.state() != KEYED || NO_MORE_KEYS.load(Ordering::SeqCst) || s.closed.load(Ordering::SeqCst) {
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

    /// This controller never keys again; releases still work. `RuntimeHandle::shutdown` calls it
    /// before its HALT: a control thread that passed its HALT check just before the flag rose
    /// could otherwise key after shutdown had read the line released, and its unchecked unkey on
    /// the way out could leave the line keyed under a "confirmed" report (CTO re-review N-2,
    /// F-84). With the latch the key is refused, or it landed before shutdown's read, which then
    /// waits for its release.
    pub fn close(&self) {
        self.shared.closed.store(true, Ordering::SeqCst);
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
        state_of(self.shared.state())
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
        let word = s.status.load(Ordering::SeqCst);
        match state_bits(word) {
            KEYED if now >= deadline_bits(word) => {
                #[cfg(test)]
                hooks::reach(hooks::Point::WatchdogDecided);
                // Only the keyed period whose deadline was read: if it has been released and
                // another keyed since, the word differs and the new period keeps its own
                // deadline. Marking whatever was keyed by now released the next transmission on
                // the previous one's deadline.
                let pending = pack(RELEASE_PENDING, deadline_bits(word));
                if s.status.compare_exchange(word, pending, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                    return false;
                }
                s.watchdog_fired.store(true, Ordering::SeqCst);
                s.watchdog_unreported.store(true, Ordering::SeqCst);
                if let Some(mut line) = s.try_lock_line() {
                    let _ = s.release_locked(&mut line, ReleaseCause::Watchdog);
                }
                true
            }
            RELEASE_PENDING => {
                if let Some(mut line) = s.try_lock_line() {
                    if s.state() == RELEASE_PENDING {
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
        if state_bits(*self.status.get_mut()) != RELEASED {
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

/// Pause points inside the state machine, for the unit tests below: each runs a closure the test
/// set on the current thread, once, so that another action lands exactly where a race needs it.
/// Test builds only.
#[cfg(test)]
mod hooks {
    use std::cell::RefCell;

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) enum Point {
        /// `key` has armed (state and deadline published) and has not yet taken the line.
        KeyArmed,
        /// `release_locked` has published a confirmed release and still holds the line.
        ReleasePublished,
        /// `watchdog_tick` has read a keyed period past its deadline and not yet acted on it.
        WatchdogDecided,
    }

    type Hook = (Point, Box<dyn FnOnce()>);

    thread_local! {
        static HOOK: RefCell<Option<Hook>> = const { RefCell::new(None) };
    }

    /// Runs `f` the next time this thread reaches `at`.
    pub(super) fn on_next(at: Point, f: impl FnOnce() + 'static) {
        HOOK.with(|h| *h.borrow_mut() = Some((at, Box::new(f))));
    }

    pub(super) fn reach(at: Point) {
        let hook = HOOK.try_with(|h| {
            let mut h = h.borrow_mut();
            if h.as_ref().is_some_and(|(p, _)| *p == at) {
                h.take().map(|(_, f)| f)
            } else {
                None
            }
        });
        if let Ok(Some(f)) = hook {
            f();
        }
    }
}

#[cfg(test)]
mod tests {
    //! A key racing the releases that run on other threads (normal end, HALT, the watchdog's
    //! retry and deadline), each driven to the exact interleaving with the pause points in
    //! `hooks`. The invariant: no transmission is keyed without its own watchdog deadline, no
    //! earlier period's deadline judges it, and no release decided for an earlier period ends it.
    //! `tests/ptt_race_stress.rs` runs the same races without pauses.
    use super::hooks::{on_next, Point};
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    const LIMIT_MS: u64 = 1_000;

    #[derive(Clone, Default)]
    struct Clock(Arc<AtomicU64>);

    impl Clock {
        fn set(&self, ms: u64) {
            self.0.store(ms, Ordering::SeqCst);
        }
    }

    impl MonotonicClock for Clock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    /// A line with a physical state; its next `refuse_releases` releases fail and change nothing.
    #[derive(Clone, Default)]
    struct Line {
        on_air: Arc<AtomicBool>,
        refuse_releases: Arc<AtomicU64>,
    }

    impl Line {
        fn on_air(&self) -> bool {
            self.on_air.load(Ordering::SeqCst)
        }
    }

    impl PttLine for Line {
        fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
            if !keyed && self.refuse_releases.load(Ordering::SeqCst) > 0 {
                self.refuse_releases.fetch_sub(1, Ordering::SeqCst);
                return Err(PttError("release refused (test)".into()));
            }
            self.on_air.store(keyed, Ordering::SeqCst);
            Ok(PttAck::Confirmed)
        }

        fn describe(&self) -> String {
            "test line".into()
        }
    }

    fn controller() -> (PttController, Line, Clock) {
        let (line, clock) = (Line::default(), Clock::default());
        let ptt = PttController::with_limit(Box::new(line.clone()), Arc::new(clock.clone()), LIMIT_MS);
        (ptt, line, clock)
    }

    fn wait_for(what: &str, f: impl Fn() -> bool) {
        let t0 = Instant::now();
        while !f() {
            assert!(t0.elapsed() < Duration::from_secs(10), "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    /// Runs `release` on one thread and, the moment that release is published while it still
    /// holds the line, `key()` on another (the control thread keying the next slot): the key
    /// arms, then waits for the line. Returns what the key returned.
    fn key_as_a_release_is_published(
        ptt: &PttController,
        release: impl FnOnce(&PttController) + Send + 'static,
    ) -> Result<PttAck, PttError> {
        let (go, wait) = mpsc::channel::<()>();
        let p = ptt.clone();
        let keyer = std::thread::spawn(move || match wait.recv() {
            Ok(()) => p.key(),
            Err(_) => Err(PttError("the release was never published".into())),
        });
        let p = ptt.clone();
        let releaser = std::thread::spawn(move || {
            let watch = p.clone();
            on_next(Point::ReleasePublished, move || {
                let _ = go.send(());
                wait_for("the key to arm", || watch.state() == PttState::Keyed);
                // Time for the key to finish arming and block on the line: with state and
                // deadline in two stores, the release's second store came after this point.
                std::thread::sleep(Duration::from_millis(50));
            });
            release(&p);
        });
        releaser.join().expect("the releasing thread panicked");
        keyer.join().expect("the keying thread panicked")
    }

    /// The transmission keyed at `keyed_at` is released by the watchdog at its own deadline, and
    /// not before.
    fn has_its_own_deadline(ptt: &PttController, line: &Line, clock: &Clock, keyed_at: u64) {
        clock.set(keyed_at + LIMIT_MS - 1);
        assert!(!ptt.watchdog_tick(), "released before its own deadline");
        assert!(line.on_air());
        clock.set(keyed_at + LIMIT_MS);
        assert!(ptt.watchdog_tick(), "the transmission was keyed with no watchdog deadline");
        assert!(!line.on_air(), "the watchdog did not release the line");
        assert_eq!(ptt.state(), PttState::Released);
    }

    #[test]
    fn a_key_armed_as_a_normal_release_completes_keeps_its_own_watchdog_deadline() {
        let (ptt, line, clock) = controller();
        ptt.key().unwrap();
        clock.set(100);
        let r = key_as_a_release_is_published(&ptt, |p| assert!(p.unkey().is_ok()));
        assert!(r.is_ok(), "the next key was refused: {r:?}");
        assert!(line.on_air());
        assert_eq!(ptt.state(), PttState::Keyed);
        has_its_own_deadline(&ptt, &line, &clock, 100);
    }

    #[test]
    fn a_key_armed_as_a_halt_release_completes_keeps_its_own_watchdog_deadline() {
        let (ptt, line, clock) = controller();
        ptt.key().unwrap();
        clock.set(100);
        let r = key_as_a_release_is_published(&ptt, |p| assert!(p.request_release_now()));
        assert!(r.is_ok(), "the next key was refused: {r:?}");
        assert!(line.on_air());
        has_its_own_deadline(&ptt, &line, &clock, 100);
    }

    #[test]
    fn a_key_armed_as_the_watchdog_confirms_a_refused_release_keeps_its_own_watchdog_deadline() {
        let (ptt, line, clock) = controller();
        ptt.key().unwrap();
        line.refuse_releases.store(1, Ordering::SeqCst);
        assert!(ptt.unkey().is_err());
        assert_eq!(ptt.state(), PttState::ReleasePending);
        clock.set(100);
        // The watchdog's retry is the release that completes.
        let r = key_as_a_release_is_published(&ptt, |p| assert!(!p.watchdog_tick()));
        assert!(r.is_ok(), "the next key was refused: {r:?}");
        assert!(line.on_air());
        assert_eq!(ptt.release_failures(), 1);
        has_its_own_deadline(&ptt, &line, &clock, 100);
    }

    #[test]
    fn a_watchdog_tick_that_read_an_expired_period_never_releases_the_next_one() {
        let (ptt, line, clock) = controller();
        ptt.key().unwrap();
        clock.set(LIMIT_MS);
        let p = ptt.clone();
        // The tick has read the period as expired; before it acts, that period ends normally
        // and the next slot is keyed. On this thread: the tick holds nothing at that point.
        on_next(Point::WatchdogDecided, move || {
            p.unkey().unwrap();
            p.key().unwrap();
        });
        assert!(!ptt.watchdog_tick(), "the tick acted on a period that had already ended");
        assert!(line.on_air(), "the next transmission was released on the previous one's deadline");
        assert_eq!(ptt.state(), PttState::Keyed);
        assert!(!ptt.watchdog_fired());
        assert!(!ptt.take_watchdog_release(), "a watchdog release was reported that did not happen");
        has_its_own_deadline(&ptt, &line, &clock, LIMIT_MS);
    }

    #[test]
    fn a_deadline_armed_by_a_key_that_raced_a_halt_never_judges_the_next_key() {
        let (ptt, line, clock) = controller();
        clock.set(100);
        let p = ptt.clone();
        // HALT between the key arming and the key reaching the line.
        on_next(Point::KeyArmed, move || assert!(p.request_release_now()));
        assert!(ptt.key().is_err(), "a key released before it was sent says so");
        assert!(!line.on_air(), "a key released before it was sent reached the line");
        assert_eq!(ptt.state(), PttState::Released);
        // Well past that key's deadline (100 + LIMIT_MS), the next key; a watchdog tick lands
        // between its arming and its drive.
        let rekey_at = 100 + 2 * LIMIT_MS;
        clock.set(rekey_at);
        let (p, fired) = (ptt.clone(), Arc::new(AtomicBool::new(false)));
        let f = fired.clone();
        on_next(Point::KeyArmed, move || f.store(p.watchdog_tick(), Ordering::SeqCst));
        let r = ptt.key();
        assert!(!fired.load(Ordering::SeqCst), "the watchdog judged the new key by an earlier key's deadline");
        assert!(r.is_ok(), "the new key was released before it was sent: {r:?}");
        assert!(line.on_air());
        has_its_own_deadline(&ptt, &line, &clock, rekey_at);
    }

    #[test]
    fn a_clock_at_the_end_of_its_range_arms_an_earlier_deadline_not_none_and_not_a_panic() {
        let (ptt, line, clock) = controller();
        clock.set(u64::MAX - 10);
        ptt.key().unwrap();
        assert!(ptt.watchdog_tick(), "a deadline past the end of the clock never fires");
        assert!(!line.on_air());
    }
}
