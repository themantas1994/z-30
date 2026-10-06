//! A release is not a release until the hardware confirms it.
//!
//! 2026-09-28 audit F-01 (TX-01 = CTO-01): `PttController` marked the line unkeyed
//! BEFORE driving it, so a release the hardware refused (a rigctld `T 0` that timed out, a CM108
//! HID write error) left the controller, the watchdog and Drop all believing the transmitter was
//! released while the radio stayed keyed until its own time-out timer. F-44 (TX-15): a second
//! `key()` re-armed the watchdog deadline, so the watchdog bounded the time since the last key,
//! not the keyed period.
//!
//! These tests drive fake lines only. If one fails, the change is wrong - do not edit the test.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use z30_engine::ptt::*;

#[derive(Clone, Default)]
struct VirtualClock(Arc<AtomicU64>);

impl VirtualClock {
    fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}

impl MonotonicClock for VirtualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// A line with a physical state, whose next `fail_releases` releases fail without changing it.
#[derive(Clone, Default)]
struct FlakyLine {
    hardware_keyed: Arc<Mutex<bool>>,
    fail_releases: Arc<AtomicUsize>,
    log: Arc<Mutex<Vec<bool>>>,
}

impl PttLine for FlakyLine {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.log.lock().unwrap().push(keyed);
        if !keyed && self.fail_releases.load(Ordering::SeqCst) > 0 {
            self.fail_releases.fetch_sub(1, Ordering::SeqCst);
            return Err(PttError("rigctld: timed out".into()));
        }
        *self.hardware_keyed.lock().unwrap() = keyed;
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        "flaky".into()
    }
}

fn hw(l: &FlakyLine) -> bool {
    *l.hardware_keyed.lock().unwrap()
}

#[test]
fn f01_a_failed_release_leaves_the_line_possibly_keyed_and_the_watchdog_retries_it() {
    let line = FlakyLine::default();
    let clock = VirtualClock::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(clock.clone()));
    ptt.key().unwrap();
    assert!(hw(&line));
    line.fail_releases.store(2, Ordering::SeqCst);

    // The release the hardware refused is reported, and nothing believes the line released.
    assert!(ptt.unkey().is_err());
    assert!(hw(&line), "the fake hardware is still keyed");
    assert!(ptt.is_keyed(), "a release the hardware did not confirm must leave the line 'possibly keyed' (F-01)");
    assert_eq!(ptt.state(), PttState::ReleasePending);
    assert_eq!(ptt.release_failures(), 1);
    assert!(ptt.last_release_error().unwrap().contains("timed out"));

    // The watchdog retries at once, not at the 40 s deadline: its first retry fails too...
    clock.advance(50);
    ptt.watchdog_tick();
    assert!(hw(&line) && ptt.is_keyed());
    assert_eq!(ptt.release_failures(), 2);
    // ...and the next one reaches the hardware.
    clock.advance(50);
    ptt.watchdog_tick();
    assert!(!hw(&line), "the watchdog retried the release until the hardware confirmed it");
    assert!(!ptt.is_keyed());
    assert_eq!(ptt.state(), PttState::Released);
}

#[test]
fn f01_a_line_that_cannot_confirm_a_release_cannot_be_keyed_again() {
    let line = FlakyLine::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(VirtualClock::default()));
    ptt.key().unwrap();
    line.fail_releases.store(1_000, Ordering::SeqCst);
    assert!(ptt.unkey().is_err());
    let keys_before = line.log.lock().unwrap().iter().filter(|k| **k).count();
    let e = ptt.key().expect_err("keying on top of an unconfirmed release must be refused");
    assert!(e.0.contains("previous release was not confirmed"), "the operator is told why: {e}");
    let keys_after = line.log.lock().unwrap().iter().filter(|k| **k).count();
    assert_eq!(keys_before, keys_after, "the refused key never reached the line");
}

#[test]
fn f01_the_background_watchdog_thread_retries_a_failed_release_on_its_own() {
    let line = FlakyLine::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(SystemMonotonic::default()));
    let _wd = ptt.spawn_watchdog(std::time::Duration::from_millis(5));
    ptt.key().unwrap();
    line.fail_releases.store(3, Ordering::SeqCst);
    assert!(ptt.unkey().is_err());
    let t0 = std::time::Instant::now();
    while hw(&line) && t0.elapsed() < std::time::Duration::from_secs(5) {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(!hw(&line), "the watchdog thread never released the line");
    assert!(!ptt.is_keyed());
    assert_eq!(ptt.release_failures(), 3, "three injected failures: one from unkey, two from the watchdog's retries, then success");
}

#[test]
fn f01_drop_releases_a_line_whose_release_is_unconfirmed() {
    let line = FlakyLine::default();
    {
        let ptt = PttController::new(Box::new(line.clone()), Arc::new(VirtualClock::default()));
        ptt.key().unwrap();
        line.fail_releases.store(1, Ordering::SeqCst);
        assert!(ptt.unkey().is_err());
        assert!(hw(&line));
    }
    assert!(!hw(&line), "dropping the controller drives the release again");
}

#[test]
fn f44_a_second_key_does_not_re_arm_the_watchdog() {
    let line = FlakyLine::default();
    let clock = VirtualClock::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(clock.clone()));
    ptt.key().unwrap();
    clock.advance(35_000);
    ptt.key().unwrap();
    clock.advance(MAX_TX_SECONDS * 1000 - 35_000);
    assert!(ptt.watchdog_tick(), "the deadline runs from the first key of the keyed period, not the last");
    assert!(!hw(&line));
    assert!(ptt.watchdog_fired());
}

#[test]
fn f06_the_transmit_time_limit_is_forty_seconds() {
    // P-max: the p4 tests are written relative to the constant, so raising it passed them.
    assert_eq!(MAX_TX_SECONDS, 40);
    let line = FlakyLine::default();
    let clock = VirtualClock::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(clock.clone()));
    ptt.key().unwrap();
    clock.advance(39_999);
    assert!(!ptt.watchdog_tick());
    clock.advance(1);
    assert!(ptt.watchdog_tick());
    assert!(!hw(&line));
}

#[test]
fn f46_a_watchdog_release_is_reported_once_whatever_the_timeline_was_doing() {
    let line = FlakyLine::default();
    let clock = VirtualClock::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(clock.clone()));
    ptt.key().unwrap();
    clock.advance(MAX_TX_SECONDS * 1000);
    assert!(ptt.watchdog_tick());
    assert!(ptt.take_watchdog_release(), "reported");
    assert!(!ptt.take_watchdog_release(), "reported once");
}

fn within(d: Duration, f: impl Fn() -> bool) -> bool {
    let t0 = Instant::now();
    while t0.elapsed() < d {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    f()
}

#[test]
fn f16_a_halt_while_the_driver_is_busy_never_blocks_and_the_line_held_by_a_slow_driver_is_left_pending_and_the_watchdog_releases_it() {
    // The emergency path never waits longer than its bound, and what it could not reach it
    // leaves ReleasePending for the watchdog, which does reach it once the driver returns.
    let slow_hw = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(Mutex::new(()));
    struct Slow {
        hw: Arc<AtomicBool>,
        gate: Arc<Mutex<()>>,
    }
    impl PttLine for Slow {
        fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
            if keyed {
                let _g = self.gate.lock().unwrap(); // blocks while the test holds the gate
            }
            self.hw.store(keyed, Ordering::SeqCst);
            Ok(PttAck::Confirmed)
        }
        fn describe(&self) -> String {
            "slow".into()
        }
    }
    let held = gate.lock().unwrap();
    let ptt = PttController::new(Box::new(Slow { hw: slow_hw.clone(), gate: gate.clone() }), Arc::new(SystemMonotonic::default()));
    let _wd = ptt.spawn_watchdog(Duration::from_millis(5));
    let p = ptt.clone();
    let keyer = std::thread::spawn(move || p.key());
    assert!(within(Duration::from_secs(2), || ptt.state() == PttState::Keyed));
    // HALT arrives while the driver is stuck inside set(true): it must return at once.
    let t0 = Instant::now();
    assert!(!ptt.request_release_now(), "the line is busy; the release cannot be confirmed yet");
    assert!(t0.elapsed() < Duration::from_millis(200), "request_release_now blocked for {:?}", t0.elapsed());
    assert_eq!(ptt.state(), PttState::ReleasePending);
    drop(held); // the driver returns from set(true)...
    assert!(keyer.join().unwrap().is_err(), "a key that raced a halt is reported as not sent");
    // ...and the line it just keyed is released, by the keying thread or the watchdog.
    assert!(within(Duration::from_secs(2), || !slow_hw.load(Ordering::SeqCst)));
    assert_eq!(ptt.state(), PttState::Released);
}

#[test]
fn f15_the_watchdog_never_blocks_on_a_line_another_thread_is_driving() {
    // The deadline passes while another thread is stuck inside the driver (a hung CAT write).
    // The watchdog must return at once and leave the release pending, not wait on the line
    // (mutation P-wdblock); the stuck thread releases the line when its driver returns.
    struct Stuck {
        hw: Arc<AtomicBool>,
        gate: Arc<Mutex<()>>,
    }
    impl PttLine for Stuck {
        fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
            if keyed {
                let _g = self.gate.lock().unwrap();
            }
            self.hw.store(keyed, Ordering::SeqCst);
            Ok(PttAck::Confirmed)
        }
        fn describe(&self) -> String {
            "stuck".into()
        }
    }
    let hw = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(Mutex::new(()));
    let clock = VirtualClock::default();
    let ptt = PttController::new(Box::new(Stuck { hw: hw.clone(), gate: gate.clone() }), Arc::new(clock.clone()));
    ptt.key().unwrap();
    let held = gate.lock().unwrap();
    let p = ptt.clone();
    let rekey = std::thread::spawn(move || p.key()); // blocks inside set(true), holding the line
    std::thread::sleep(Duration::from_millis(50));
    clock.advance(MAX_TX_SECONDS * 1000);
    let t0 = Instant::now();
    let (tx, rx) = std::sync::mpsc::channel();
    let p = ptt.clone();
    std::thread::spawn(move || {
        let _ = tx.send(p.watchdog_tick());
    });
    let fired = rx.recv_timeout(Duration::from_secs(2)).expect("the watchdog blocked on a line another thread is driving");
    assert!(fired && t0.elapsed() < Duration::from_millis(500));
    assert_eq!(ptt.state(), PttState::ReleasePending);
    drop(held);
    assert!(rekey.join().unwrap().is_err(), "the key that raced the watchdog is reported as not sent");
    assert!(within(Duration::from_secs(2), || !hw.load(Ordering::SeqCst)));
    assert_eq!(ptt.state(), PttState::Released);
}

/// A line whose key blocks until the test lets it finish, so the test can act while a key is in
/// its driver.
#[derive(Clone, Default)]
struct GatedLine {
    log: Arc<Mutex<Vec<bool>>>,
    hardware_keyed: Arc<Mutex<bool>>,
    in_key: Arc<AtomicBool>,
    go: Arc<AtomicBool>,
}

impl PttLine for GatedLine {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.log.lock().unwrap().push(keyed);
        if keyed {
            self.in_key.store(true, Ordering::SeqCst);
            while !self.go.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        *self.hardware_keyed.lock().unwrap() = keyed;
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        "gated".into()
    }
}

// CTO re-review N-2 / F-84: a control thread past its HALT check could key after shutdown had
// read the line released. `close` (called by shutdown before its HALT) refuses any later key.
#[test]
fn f84_a_closed_controller_never_drives_a_key() {
    let line = FlakyLine::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(VirtualClock::default()));
    ptt.close();
    assert!(ptt.key().is_err(), "a closed controller keyed");
    assert!(!line.log.lock().unwrap().contains(&true), "the line was driven keyed: {:?}", line.log.lock().unwrap());
    assert!(!hw(&line));
    assert_eq!(ptt.state(), PttState::Released);
}

#[test]
fn f84_a_key_in_its_driver_when_the_controller_closes_is_released_before_it_returns() {
    let line = GatedLine::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(VirtualClock::default()));
    let p2 = ptt.clone();
    let keyer = std::thread::spawn(move || p2.key());
    let t0 = Instant::now();
    while !line.in_key.load(Ordering::SeqCst) {
        assert!(t0.elapsed() < Duration::from_secs(5), "the key never reached the line");
        std::thread::sleep(Duration::from_millis(1));
    }
    ptt.close();
    line.go.store(true, Ordering::SeqCst);
    assert!(keyer.join().unwrap().is_err(), "a key that finished after close reported success");
    assert!(!*line.hardware_keyed.lock().unwrap(), "left keyed: {:?}", line.log.lock().unwrap());
    assert_eq!(ptt.state(), PttState::Released);
}
