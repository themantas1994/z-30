//! The exit latch. Its own test binary because `refuse_further_keys` is process-wide and has no
//! way back: in any other binary it would refuse every later test's keys.
//!
//! Transmit-safety audit D-2: SIGTERM at the start of a slot ran `emergency_release_all`, which
//! found the line released and returned; the control thread's key for that slot then keyed the
//! line before `process::exit` completed, and rigctld or a CM108 GPIO kept the radio keyed until
//! its own time-out. Fake lines only.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use z30_engine::ptt::*;

#[derive(Clone, Default)]
struct Line {
    hw: Arc<AtomicBool>,
    keys: Arc<AtomicUsize>,
}

impl PttLine for Line {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        if keyed {
            self.keys.fetch_add(1, Ordering::SeqCst);
        }
        self.hw.store(keyed, Ordering::SeqCst);
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        "test line".into()
    }
}

#[test]
fn d2_after_the_exit_latch_no_line_is_keyed() {
    let line = Line::default();
    let ptt = PttController::new(Box::new(line.clone()), Arc::new(SystemMonotonic::default()));
    // Before the latch a key works, and is released.
    ptt.key().unwrap();
    assert!(line.hw.load(Ordering::SeqCst));
    ptt.unkey().unwrap();
    refuse_further_keys();
    assert!(emergency_release_all());
    let e = ptt.key().unwrap_err();
    assert!(e.0.contains("exiting"), "{}", e.0);
    assert_eq!(line.keys.load(Ordering::SeqCst), 1, "the line was driven keyed after the latch");
    assert!(!line.hw.load(Ordering::SeqCst));
    assert_eq!(ptt.state(), PttState::Released);
}
