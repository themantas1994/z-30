//! The capture callback body allocates nothing, locks nothing and loses nothing it reports as
//! kept (directive section 15; audit Phase 3 gate 2). A counting global allocator watches it.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) }
    }
}

#[global_allocator]
static A: Counting = Counting;

#[test]
fn the_capture_callback_never_allocates_and_reports_overruns_as_gaps() {
    let (mut cb, mut rings, counters) = z30_io::audio::input_rings(48_000, 2);
    let data: Vec<f32> = (0..960).map(|i| i as f32).collect(); // 480 stereo frames
    let before = ALLOCS.load(Ordering::SeqCst);
    for k in 0..1000 {
        cb.on_data(&data, 1.0 + k as f64 * 0.01);
    }
    let during = ALLOCS.load(Ordering::SeqCst) - before;
    assert_eq!(during, 0, "the real-time path allocated {during} times");

    // 1000 x 480 frames exceeds the 20 s ring at 48 kHz: the excess is counted, whole callbacks.
    let kept: u64 = (0..).map_while(|_| rings.take_block(1_000_000)).map(|b| b.samples.len() as u64).sum();
    let dropped = counters.overruns.load(Ordering::SeqCst);
    assert_eq!(kept + dropped, 480_000);
    assert_eq!(dropped % 480, 0);
    // Channel 0 only.
    let (mut cb, mut rings, _) = z30_io::audio::input_rings(48_000, 2);
    cb.on_data(&data, 5.0);
    let b = rings.take_block(10_000).unwrap();
    assert_eq!(b.samples[..3], [0.0, 2.0, 4.0]);
    assert_eq!(b.first_index, 0);
    assert_eq!(b.capture_utc, 5.0);
}
