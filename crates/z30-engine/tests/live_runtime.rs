//! The live receive path through the production runtime's own threads (`runtime::start`):
//! audio callback ring -> DSP thread (pipeline, clock model, scheduler) -> decode thread
//! (`decode_slot`) -> control thread (engine) -> snapshot. Only the sound card and the wall
//! clock are virtual.
//!
//! This is the regression test for the 2026-09-24 audit's C-01: the legacy app triggered its
//! decode from a UI timer at slot + 24.0 s for a window that ends at slot + 25.5 s, found no
//! audio there, and never retried. Here the virtual sound card delivers audio up to
//! slot + 25.0 s and then stalls, and the test asserts that nothing is decoded while the window
//! is incomplete; then it delivers the rest and asserts the slot is decoded from exactly the
//! samples of [slot - 1.5 s, slot + 25.5 s] - including two frames placed at the extreme DTs,
//! whose first and last seconds are the parts an early or misaligned window loses.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use z30_channel::{random_station, rng, synthesize, Band};
use z30_engine::api::Event;
use z30_engine::config::Config;
use z30_engine::pipeline::AudioBlock;
use z30_engine::ptt::{NoPtt, SystemMonotonic};
use z30_engine::qso::QsoRecord;
use z30_engine::runtime::{self, AudioInput, AudioOutput, LogSink, RuntimeParts, SlotCapture, WallClock};
use z30_engine::slots::slot_start;

const FS: f64 = 6000.0;

/// A sound card that plays back a prepared buffer, block by block, but never past `limit`.
struct VirtualCard {
    audio: Arc<Vec<f32>>,
    pos: usize,
    block: usize,
    t0: f64,
    limit: Arc<AtomicUsize>,
    delivered: Arc<AtomicUsize>,
}

impl AudioInput for VirtualCard {
    fn sample_rate(&self) -> u32 {
        FS as u32
    }

    fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String> {
        let end = (self.pos + self.block).min(self.audio.len());
        if end <= self.pos || end > self.limit.load(Ordering::SeqCst) {
            std::thread::sleep(timeout.min(Duration::from_millis(5)));
            return Ok(None);
        }
        let b = AudioBlock {
            first_index: self.pos as u64,
            samples: self.audio[self.pos..end].to_vec(),
            capture_utc: self.t0 + self.pos as f64 / FS,
        };
        self.pos = end;
        self.delivered.store(end, Ordering::SeqCst);
        Ok(Some(b))
    }
}

/// UTC as the sound card's timeline says: the instant of the last sample delivered.
struct VirtualWall {
    t0: f64,
    delivered: Arc<AtomicUsize>,
}

impl WallClock for VirtualWall {
    fn utc_now(&self) -> f64 {
        self.t0 + self.delivered.load(Ordering::SeqCst) as f64 / FS
    }
    fn status(&self) -> String {
        "virtual clock (test)".into()
    }
}

struct Silent;
impl AudioOutput for Silent {
    fn sample_rate(&self) -> u32 {
        48_000
    }
    fn latency_sec(&self) -> f64 {
        0.0
    }
    fn play(&mut self, _: Vec<f32>) -> Result<(), String> {
        Err("receive-only test".into())
    }
    fn stop(&mut self) {}
}

struct NoLog;
impl LogSink for NoLog {
    fn log(&mut self, _: &QsoRecord) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn c01_a_slot_is_decoded_only_from_its_complete_window_through_the_production_runtime() {
    let slot: i64 = 59_666_700;
    let s0 = slot_start(slot);
    // The station is switched on 10 s before the slot boundary.
    let t0 = s0 - 10.0;

    // The slot window as the channel model builds it: [slot - 1.5 s, slot + 25.5 s], two frames
    // at the DT extremes the receiver searches, at -16 dB each.
    let mut r = rng(4242);
    let (late_payload, mut late) = random_station(&mut r, 800.0, 1.4, -16.0);
    late.phase_rad = 0.3;
    let (early_payload, early) = random_station(&mut r, 1900.0, -1.4, -16.0);
    let window = synthesize(&Band { stations: vec![late, early], noise: true, ..Default::default() }, &mut rng(99));
    let noise = synthesize(&Band { noise: true, ..Default::default() }, &mut rng(100));
    // Audio: 8.5 s of noise, the window, 4 s of noise.
    let lead = (8.5 * FS) as usize;
    let mut audio = noise[..lead].to_vec();
    audio.extend_from_slice(&window);
    audio.extend_from_slice(&noise[lead..lead + (4.0 * FS) as usize]);
    let audio = Arc::new(audio);
    let window_first = lead; // index of slot - 1.5 s
    let window_end = window_first + window.len(); // index of slot + 25.5 s

    let limit = Arc::new(AtomicUsize::new(((s0 + 25.0 - t0) * FS) as usize));
    let delivered = Arc::new(AtomicUsize::new(0));
    let card = VirtualCard { audio: audio.clone(), pos: 0, block: 600, t0, limit: limit.clone(), delivered: delivered.clone() };
    let (tap_tx, tap_rx) = crossbeam_channel::bounded::<SlotCapture>(4);
    let mut cfg = Config::default();
    cfg.operating.auto_sequence = false;
    let handle = runtime::start(
        cfg,
        RuntimeParts {
            input: Box::new(card),
            output: Box::new(Silent),
            rig: None,
            ptt: Box::new(NoPtt),
            wall: Arc::new(VirtualWall { t0, delivered: delivered.clone() }),
            mono: Arc::new(SystemMonotonic::default()),
            log: Box::new(NoLog),
            slot_tap: Some(tap_tx),
            tx_unavailable: Some("receive-only test".into()),
        },
    );

    // Phase 1: audio up to slot + 25.0 s, then the card stalls. The window is 0.5 s short of
    // complete; nothing may be decoded from it, however long we wait.
    let stall_start = Instant::now();
    while stall_start.elapsed() < Duration::from_millis(1500) {
        while let Ok(ev) = handle.events.try_recv() {
            if let Event::SlotDecoded { slot: s, .. } = ev {
                assert_ne!(s, slot, "slot {slot} decoded before its window was complete (C-01)");
            }
        }
        assert!(tap_rx.try_recv().map(|c| c.slot != slot).unwrap_or(true), "slot window handed to the decoder early (C-01)");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(delivered.load(Ordering::SeqCst), limit.load(Ordering::SeqCst), "the card should be stalled at slot + 25.0 s");
    assert!(delivered.load(Ordering::SeqCst) < window_end);

    // Phase 2: the rest of the audio. The slot must now be decoded, once.
    limit.store(audio.len(), Ordering::SeqCst);
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut capture = None;
    let mut decoded_events = 0;
    while Instant::now() < deadline && (capture.is_none() || decoded_events == 0) {
        while let Ok(ev) = handle.events.try_recv() {
            if let Event::SlotDecoded { slot: s, .. } = ev {
                if s == slot {
                    decoded_events += 1;
                }
            }
        }
        while let Ok(c) = tap_rx.try_recv() {
            if c.slot == slot {
                capture = Some(c);
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let capture = capture.expect("the slot was never decoded after its window completed");
    assert_eq!(decoded_events, 1);

    // The decoder saw exactly [slot - 1.5 s, slot + 25.5 s] of what the card delivered.
    assert_eq!(capture.samples.len(), 162_000);
    assert!(capture.samples[..] == audio[window_first..window_end], "the decoded window is not the slot's own audio");

    // Both extreme-DT frames decode, with the timing and frequency they were sent at.
    let snap = handle.snapshot.load();
    for (payload, dt, f0) in [(late_payload, 1.4, 800.0), (early_payload, -1.4, 1900.0)] {
        let row =
            snap.decodes.iter().find(|d| d.slot == slot && d.decode.info[..63] == payload).unwrap_or_else(|| {
                panic!("frame at DT {dt:+} s not decoded: {:?}", snap.decodes.iter().map(|d| &d.text).collect::<Vec<_>>())
            });
        assert!((row.dt_sec - dt).abs() < 0.02, "DT {:.3} vs {dt}", row.dt_sec);
        assert!((row.freq_hz - f0).abs() < 0.5, "f {:.2} vs {f0}", row.freq_hz);
        let snr = row.snr_db.expect("measured");
        assert!((snr + 16.0).abs() < 1.5, "SNR {snr:.1} vs -16");
    }
    assert_eq!(snap.decodes.iter().filter(|d| d.slot == slot).count(), 2, "no duplicate or false decodes");
    // The decode finished after the window closed, on the card's own timeline.
    assert!(snap.stats.last_done_after_slot_sec >= 25.5 - 1e-6, "decode done at slot + {:.2} s", snap.stats.last_done_after_slot_sec);
    handle.shutdown();
}
