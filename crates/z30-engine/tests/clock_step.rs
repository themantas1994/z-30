//! System clock steps and the receive timeline, through the production `RxPipeline`.
//!
//! 2026-09-28 audit F-48 (CTO-10): after the OS clock stepped back 120 s, the slot scheduler
//! kept waiting for a slot 120 s in the future and emitted nothing - no `Ready`, no `Missed` -
//! for 150 s of audio. A step is now reported (`SlotEvent::ClockStepped`) and the scheduler is
//! re-seated on the new clock; small corrections and slews are absorbed as before.

use z30_engine::pipeline::{AudioBlock, RxPipeline};
use z30_engine::slots::{slot_start, SlotEvent};

const FS: f64 = 6000.0;
const BLOCK: usize = 600;

/// What the pipeline emitted, with the audio time (s since the stream started) of each event.
#[derive(Default, Debug)]
struct Seen {
    ready: Vec<(f64, i64)>,
    missed: Vec<(f64, i64)>,
    stepped: Vec<(f64, i64, i64)>,
}

/// Runs `seconds` of silence whose capture time is `t0 + audio_t + offset(audio_t)`.
fn run(seconds: f64, offset: impl Fn(f64) -> f64) -> Seen {
    let t0 = slot_start(60_000_000) - 10.0;
    let mut pipe = RxPipeline::new(FS as u32);
    let mut seen = Seen::default();
    let zeros = vec![0.0f32; BLOCK];
    let mut idx = 0u64;
    while (idx as f64) / FS < seconds {
        let at = idx as f64 / FS;
        let block = AudioBlock { first_index: idx, samples: zeros.clone(), capture_utc: t0 + at + offset(at) };
        for ev in pipe.push(&block) {
            match ev {
                SlotEvent::Ready(j) => seen.ready.push((at, j.slot)),
                SlotEvent::Missed(s, _) => seen.missed.push((at, s)),
                SlotEvent::ClockStepped { from, to } => seen.stepped.push((at, from, to)),
            }
        }
        idx += BLOCK as u64;
    }
    seen
}

/// The longest stretch of audio after `from` s with no event of any kind.
fn longest_silence(seen: &Seen, from: f64, to: f64) -> f64 {
    let mut t: Vec<f64> = seen
        .ready
        .iter()
        .map(|e| e.0)
        .chain(seen.missed.iter().map(|e| e.0))
        .chain(seen.stepped.iter().map(|e| e.0))
        .filter(|&x| x >= from)
        .collect();
    t.push(from);
    t.push(to);
    t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    t.windows(2).map(|w| w[1] - w[0]).fold(0.0, f64::max)
}

#[test]
fn f48_a_backward_step_is_reported_and_decoding_resumes() {
    let seen = run(420.0, |t| if t < 200.0 { 0.0 } else { -120.0 });
    let steps: Vec<_> = seen.stepped.iter().filter(|s| s.0 >= 200.0).collect();
    assert_eq!(steps.len(), 1, "{:?}", seen.stepped);
    let (at, from, to) = *steps[0];
    assert!(at < 201.0, "reported {at:.1} s into the audio, the step was at 200 s");
    assert_eq!(from - to, 4, "120 s back is four slots: {from} -> {to}");
    // No silent gap: at most a slot and a window between events (the old gap was 150 s).
    let gap = longest_silence(&seen, 200.0, 420.0);
    assert!(gap <= 31.0, "{gap:.1} s of silence after the step");
    // The new epoch starts at 200 s of audio = t0 + 80 s on the new clock; the next window
    // starting after it opens at t0 + 98.5 s (slot boundary t0 + 100 s, minus 1.5 s) and closes
    // 27 s later, at 245.5 s of audio. Decoding resumes there, re-decoding the slots that came
    // round again.
    let first = seen.ready.iter().find(|r| r.0 > 200.0).expect("decoding resumed");
    assert!((first.0 - 245.5).abs() < 0.2, "first decode after the step at {:.1} s", first.0);
    assert_eq!(first.1, to + 1);
}

#[test]
fn f48_a_forward_step_is_reported_and_decoding_resumes() {
    let seen = run(420.0, |t| if t < 200.0 { 0.0 } else { 120.0 });
    let steps: Vec<_> = seen.stepped.iter().filter(|s| s.0 >= 200.0).collect();
    assert_eq!(steps.len(), 1, "{:?}", seen.stepped);
    assert_eq!(steps[0].2 - steps[0].1, 4);
    assert!(longest_silence(&seen, 200.0, 420.0) <= 31.0);
    // The skipped slots are not reported one by one (a large step does not flood the UI).
    assert!(seen.missed.iter().filter(|m| m.0 >= 200.0).count() <= 2, "{:?}", seen.missed);
}

#[test]
fn f48_small_and_sub_slot_corrections_are_not_clock_steps() {
    // A 0.1 s step (below the clock model's jump tolerance) and a slow slew are absorbed.
    for (name, seen) in [("0.1 s step", run(300.0, |t| if t < 150.0 { 0.0 } else { 0.1 })), ("500 ppm slew", run(300.0, |t| t * 500e-6))] {
        assert!(seen.stepped.is_empty(), "{name}: {:?}", seen.stepped);
        assert!(seen.missed.iter().all(|m| m.0 < 30.0), "{name}: slots missed after start-up: {:?}", seen.missed);
        for w in seen.ready.windows(2) {
            assert_eq!(w[1].1, w[0].1 + 1, "{name}: every slot decoded once, in order");
        }
    }
    // A 2 s step (an NTP step inside the slot): a new clock epoch, at most the slot straddling it
    // missed, no clock step reported and nothing silent.
    let seen = run(300.0, |t| if t < 150.0 { 0.0 } else { 2.0 });
    assert!(seen.stepped.is_empty(), "{:?}", seen.stepped);
    assert!(seen.missed.iter().filter(|m| m.0 >= 150.0).count() <= 1, "{:?}", seen.missed);
    assert!(longest_silence(&seen, 150.0, 300.0) <= 31.0);
}
