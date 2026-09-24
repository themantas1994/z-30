//! Process-wide emergency release. Its own test binary because `emergency_release_all` releases
//! every line in the process, which would interfere with the other safety tests.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use z30_engine::ptt::*;

#[derive(Clone, Default)]
struct VirtualClock(Arc<AtomicU64>);

impl MonotonicClock for VirtualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct RecordingLine {
    name: &'static str,
    log: Arc<Mutex<Vec<(&'static str, bool)>>>,
}

impl PttLine for RecordingLine {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.log.lock().unwrap().push((self.name, keyed));
        Ok(PttAck::Confirmed)
    }

    fn describe(&self) -> String {
        self.name.into()
    }
}

fn line(name: &'static str, log: &Arc<Mutex<Vec<(&'static str, bool)>>>) -> Box<dyn PttLine> {
    Box::new(RecordingLine { name, log: log.clone() })
}

#[test]
fn p5_emergency_release_and_drop_release_a_keyed_line() {
    let log = Arc::new(Mutex::new(Vec::new()));
    {
        let ptt = PttController::new(line("emergency", &log), Arc::new(VirtualClock::default()));
        ptt.key().unwrap();
        emergency_release_all();
        assert!(!ptt.is_keyed());
        ptt.key().unwrap();
    } // dropped while keyed
    let l = log.lock().unwrap().clone();
    assert_eq!(l.last(), Some(&("emergency", false)), "{l:?}");
}
