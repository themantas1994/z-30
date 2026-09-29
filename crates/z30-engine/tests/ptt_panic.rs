//! Panics while keyed. Its own test binary because it installs the process-wide panic hook.
//!
//! 2026-09-28 agent-team audit F-15 (CTO-02 = TX-11): the line mutex was held across
//! `PttLine::set`, and the panic hook runs on the panicking thread BEFORE unwinding releases
//! that guard. The hook's `emergency_release_all` then blocked on the same mutex while holding
//! the PTT registry lock, so the keying thread never returned, the watchdog (which had already
//! been told "unkeyed") did nothing, and any later `PttController::new` blocked on the registry
//! (reproduction: `audit/2026-09-28-remediation/evidence/reproduction/`). F-06 (P-hook): no test
//! installed the hook, so removing it passed CI.
//!
//! Fake lines only. If one of these fails, the change is wrong - do not edit the test.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Once};
use std::time::{Duration, Instant};
use z30_engine::ptt::*;

static HOOK: Once = Once::new();

fn install_hook_once() {
    HOOK.call_once(install_panic_release);
}

/// A line whose `set(true)` drives the (fake) hardware and then panics.
struct PanicOnKey {
    hw: Arc<AtomicBool>,
}

impl PttLine for PanicOnKey {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.hw.store(keyed, Ordering::SeqCst);
        if keyed {
            panic!("driver panic inside set(true) (test)");
        }
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        "panics on key".into()
    }
}

/// A well-behaved line.
#[derive(Clone, Default)]
struct Good {
    hw: Arc<AtomicBool>,
    sets: Arc<AtomicUsize>,
}

impl PttLine for Good {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.sets.fetch_add(1, Ordering::SeqCst);
        self.hw.store(keyed, Ordering::SeqCst);
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        "good".into()
    }
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
fn f15_a_panic_inside_set_true_is_released_and_nothing_deadlocks() {
    install_hook_once();
    let hw = Arc::new(AtomicBool::new(false));
    let ptt = PttController::with_limit(Box::new(PanicOnKey { hw: hw.clone() }), Arc::new(SystemMonotonic::default()), 200);
    let _wd = ptt.spawn_watchdog(Duration::from_millis(10));

    // The keying thread returns (with an error), rather than blocking in the panic hook.
    let p = ptt.clone();
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let r = p.key();
        let _ = tx.send(r);
    });
    let r = rx.recv_timeout(Duration::from_secs(5)).expect("the keying thread deadlocked (F-15)");
    let e = r.expect_err("a driver that panicked has not confirmed a key");
    assert!(e.0.contains("panicked"), "{e}");

    // The fake hardware was keyed by the driver before it panicked; it is released, and the
    // controller only says so because the release was confirmed.
    assert!(within(Duration::from_secs(2), || !hw.load(Ordering::SeqCst)), "the line the panicking driver keyed was never released");
    assert_eq!(ptt.state(), PttState::Released);

    // The watchdog is still operational: it answers without blocking.
    let p = ptt.clone();
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let _ = p.watchdog_tick();
        let _ = tx.send(());
    });
    rx.recv_timeout(Duration::from_secs(2)).expect("watchdog_tick blocked after a panic in the driver");

    // And the PTT registry is not held: a new controller can be created, keyed and released.
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let good = Good::default();
        let c = PttController::new(Box::new(good.clone()), Arc::new(SystemMonotonic::default()));
        let ok = c.key().is_ok() && good.hw.load(Ordering::SeqCst) && c.unkey().is_ok() && !good.hw.load(Ordering::SeqCst);
        let _ = tx.send(ok);
    });
    assert!(rx.recv_timeout(Duration::from_secs(2)).expect("PttController::new blocked on the registry"), "a new line keys and releases");
}

#[test]
fn f06_the_panic_hook_releases_a_keyed_line_when_another_thread_panics() {
    install_hook_once();
    let good = Good::default();
    let ptt = PttController::new(Box::new(good.clone()), Arc::new(SystemMonotonic::default()));
    ptt.key().unwrap();
    assert!(good.hw.load(Ordering::SeqCst));
    // No watchdog, no unkey: only the panic hook can release it.
    let _ = std::thread::spawn(|| panic!("unrelated panic while keyed (test)")).join();
    assert!(!good.hw.load(Ordering::SeqCst), "the panic hook did not release the keyed line (P-hook)");
    assert!(!ptt.is_keyed());
}
