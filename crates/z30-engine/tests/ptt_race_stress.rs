//! The key/release races without pauses, as a supplement to the deterministic interleaving tests
//! in `src/ptt.rs` (which put each action exactly in the window; this cannot). The control thread
//! keys while HALT-style releases and the watchdog's retries run on other threads, on a line that
//! refuses some releases. After every round, whatever the interleaving was, a keyed line carries
//! the deadline its own key armed - not none, not an earlier round's - and the controller and the
//! line agree. Nothing deadlocks.
//!
//! Fake lines only. If this fails, the change is wrong - do not edit the test.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Barrier};
use std::time::Duration;
use z30_engine::ptt::*;

const LIMIT_MS: u64 = 1_000;
const ROUNDS: u64 = 5_000;

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

/// Refuses every fifth release and stays keyed, as a timed-out rigctld `T 0` does.
#[derive(Clone, Default)]
struct Flaky {
    on_air: Arc<AtomicBool>,
    releases: Arc<AtomicU64>,
}

impl PttLine for Flaky {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        if !keyed && self.releases.fetch_add(1, Ordering::SeqCst) % 5 == 4 {
            return Err(PttError("release refused (test)".into()));
        }
        self.on_air.store(keyed, Ordering::SeqCst);
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        "flaky".into()
    }
}

fn rounds() {
    let line = Flaky::default();
    let clock = Clock::default();
    let ptt = PttController::with_limit(Box::new(line.clone()), Arc::new(clock.clone()), LIMIT_MS);
    for round in 0..ROUNDS {
        // Every key in a round arms at `base`, so its deadline is base + LIMIT_MS; an earlier
        // round's deadline is at least nine limits earlier and would fire at once.
        let base = round * 10 * LIMIT_MS;
        clock.set(base);
        let start = Arc::new(Barrier::new(3));
        let control = {
            let (p, b) = (ptt.clone(), start.clone());
            std::thread::spawn(move || {
                b.wait();
                for _ in 0..4 {
                    let _ = p.key();
                }
            })
        };
        let halt = {
            let (p, b) = (ptt.clone(), start.clone());
            std::thread::spawn(move || {
                b.wait();
                for _ in 0..3 {
                    let _ = p.request_release_now();
                }
            })
        };
        start.wait();
        // The watchdog thread's retries (no deadline passes during the round).
        for _ in 0..3 {
            let _ = ptt.watchdog_tick();
        }
        control.join().unwrap();
        halt.join().unwrap();

        if ptt.state() == PttState::Keyed {
            clock.set(base + LIMIT_MS - 1);
            assert!(!ptt.watchdog_tick(), "round {round}: released on an earlier round's deadline");
            clock.set(base + LIMIT_MS);
            assert!(ptt.watchdog_tick(), "round {round}: keyed with no watchdog deadline");
            let _ = ptt.take_watchdog_release();
        }
        // A refused release is retried until the line confirms one (every fifth is refused).
        for _ in 0..10 {
            if ptt.state() == PttState::Released {
                break;
            }
            let _ = ptt.watchdog_tick();
        }
        assert_eq!(ptt.state(), PttState::Released, "round {round}: the release was never confirmed");
        assert!(!line.on_air.load(Ordering::SeqCst), "round {round}: released in the controller, keyed on the line");
    }
}

#[test]
fn ptt_keys_racing_halts_and_watchdog_retries_always_carry_their_own_deadline() {
    let (done, finished) = mpsc::channel();
    std::thread::spawn(move || {
        rounds();
        let _ = done.send(());
    });
    match finished.recv_timeout(Duration::from_secs(300)) {
        Ok(()) => {}
        Err(mpsc::RecvTimeoutError::Timeout) => panic!("the key/release races deadlocked"),
        Err(mpsc::RecvTimeoutError::Disconnected) => panic!("a round failed: see its panic above"),
    }
}
