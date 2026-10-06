//! The capture callback body allocates nothing, locks nothing and loses nothing it reports as
//! kept (directive section 15; audit Phase 3 gate 2). A counting global allocator watches it.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::Ordering;

struct Counting;

thread_local! {
    /// Allocations made by this thread. The callback body runs on the measuring thread, so this
    /// counts every allocation it makes and none of the test harness's (whose output for a
    /// finished test, on another thread, made the process-wide count flaky once a second test
    /// ran in this binary). Const-initialised with no destructor: using it cannot allocate.
    static MINE: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn my_allocs() -> usize {
    MINE.with(|c| c.get())
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let _ = MINE.try_with(|c| c.set(c.get() + 1));
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
    let before = my_allocs();
    for k in 0..1000 {
        cb.on_data(&data, 1.0 + k as f64 * 0.01);
    }
    let during = my_allocs() - before;
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

#[test]
fn the_playback_callback_never_allocates_and_plays_what_was_queued() {
    // 2026-09-28 audit F-19 / TX-17: only the capture callback was under this test.
    let (mut producer, mut cb, shared) = z30_io::audio::output_ring(48_000, 2);
    let frame: Vec<f32> = (0..24_000).map(|i| (i % 7) as f32 * 0.1).collect();
    let _ = producer.push_partial_slice(&frame);
    let mut out = vec![0.0f32; 960]; // 480 stereo frames
    let before = my_allocs();
    for k in 0..100 {
        cb.on_data(&mut out, k);
        if k == 60 {
            shared.request_flush();
        }
    }
    let during = my_allocs() - before;
    assert_eq!(during, 0, "the playback path allocated {during} times");
    // After the flush the ring is empty and the device gets silence.
    assert!(out.iter().all(|v| *v == 0.0));
    let (mut producer, mut cb, _) = z30_io::audio::output_ring(100, 2);
    let _ = producer.push_partial_slice(&[0.25, 0.5]);
    let mut out = [9.0f32; 6];
    cb.on_data(&mut out, 0);
    assert_eq!(out, [0.25, 0.25, 0.5, 0.5, 0.0, 0.0], "mono on every channel, then silence");
}
