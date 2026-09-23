//! Slot arithmetic, the slot store and the decode scheduler - all in sample time.
//!
//! The shipped app triggered the decode from a 100 ms UI timer at 24.0 s into the slot and asked
//! for a window that ends at 25.5 s; the window did not exist yet, and it never retried (C1).
//! Here a slot is decoded when, and only when, the store holds every sample of its window
//! [slot - 1.5 s, slot + 25.5 s] - however late the scheduler happens to be polled - and a slot
//! whose window cannot be complete (it started before the epoch, or the store has overwritten it)
//! is reported as missed with the reason, never silently dropped.

use crate::clock::SampleClock;
use z30_protocol::{DT_SEARCH_SEC, FRAME_SEC, SLOT_SEC};

/// Seconds after the slot boundary at which the receive window ends.
pub const WINDOW_END_SEC: f64 = FRAME_SEC + DT_SEARCH_SEC;
/// Seconds before the slot boundary at which it starts.
pub const WINDOW_START_SEC: f64 = -DT_SEARCH_SEC;

/// Slot number containing UTC `t`.
pub fn slot_of(t: f64) -> i64 {
    (t / SLOT_SEC).floor() as i64
}

/// UTC of slot `n`'s boundary.
pub fn slot_start(n: i64) -> f64 {
    n as f64 * SLOT_SEC
}

/// A ring of DSP-rate samples addressed by absolute sample index.
pub struct SlotStore {
    buf: Vec<f32>,
    /// Absolute index one past the newest sample.
    end: u64,
}

impl SlotStore {
    /// A store holding `capacity` samples (at least two slot windows).
    pub fn new(capacity: usize) -> Self {
        SlotStore { buf: vec![0.0; capacity], end: 0 }
    }

    /// Absolute index one past the newest sample.
    pub fn end(&self) -> u64 {
        self.end
    }

    /// Oldest index still held.
    pub fn start(&self) -> u64 {
        self.end.saturating_sub(self.buf.len() as u64)
    }

    /// Appends samples.
    pub fn push(&mut self, x: &[f32]) {
        let cap = self.buf.len();
        for &v in x {
            self.buf[(self.end % cap as u64) as usize] = v;
            self.end += 1;
        }
    }

    /// Jumps the write position (a discontinuity: the gap is zero-filled so indices stay honest
    /// and no stale audio can be read as if it belonged to the new position).
    pub fn skip_to(&mut self, index: u64) {
        let cap = self.buf.len() as u64;
        let gap = index.saturating_sub(self.end);
        if gap >= cap {
            self.buf.fill(0.0);
            self.end = index;
        } else {
            for _ in 0..gap {
                self.buf[(self.end % cap) as usize] = 0.0;
                self.end += 1;
            }
        }
    }

    /// Copies `[from, from + len)` if every sample is held.
    pub fn read(&self, from: u64, len: usize) -> Option<Vec<f32>> {
        if from < self.start() || from + len as u64 > self.end {
            return None;
        }
        let cap = self.buf.len() as u64;
        Some((0..len as u64).map(|i| self.buf[((from + i) % cap) as usize]).collect())
    }
}

/// Why a slot was not decoded.
#[derive(Clone, Debug, PartialEq)]
pub enum MissReason {
    /// The window starts before the current audio epoch (device just started or restarted).
    BeforeEpoch,
    /// The store no longer holds the start of the window (the decode was scheduled too late).
    Overwritten,
    /// The sample clock has no fit yet.
    ClockUnlocked,
    /// The decoder was still busy with the previous slot.
    DecoderBusy,
    /// The decoder panicked on this slot (caught; the station carries on).
    DecoderFault,
}

/// A slot ready to decode.
#[derive(Clone, Debug)]
pub struct SlotJob {
    /// Slot number.
    pub slot: i64,
    /// Absolute sample index of the window's first sample.
    pub first_index: u64,
    /// The 27 s window at the DSP rate.
    pub samples: Vec<f32>,
    /// UTC the window was predicted to start at (the check the soak test makes).
    pub window_start_utc: f64,
}

/// What the scheduler decided on one poll.
#[derive(Clone, Debug)]
pub enum SlotEvent {
    /// Decode this.
    Ready(SlotJob),
    /// This slot cannot be decoded.
    Missed(i64, MissReason),
}

/// Emits each slot exactly once, when its window is complete.
pub struct SlotScheduler {
    next_slot: Option<i64>,
    rate: f64,
}

impl SlotScheduler {
    /// A scheduler for a store at `rate` samples per second.
    pub fn new(rate: f64) -> Self {
        SlotScheduler { next_slot: None, rate }
    }

    /// Checks for complete windows. Call as often as convenient; lateness never loses a slot
    /// while the store still holds it.
    pub fn poll(&mut self, clock: &SampleClock, store: &SlotStore) -> Vec<SlotEvent> {
        let mut out = Vec::new();
        let Some(newest_utc) = store.end().checked_sub(1).and_then(|i| clock.utc_at(i)) else {
            return out;
        };
        let window_len = ((WINDOW_END_SEC - WINDOW_START_SEC) * self.rate).round() as usize;
        let next = *self.next_slot.get_or_insert_with(|| slot_of(newest_utc));
        let mut slot = next;
        loop {
            let t0 = slot_start(slot) + WINDOW_START_SEC;
            let Some(first) = clock.index_at(t0) else {
                out.push(SlotEvent::Missed(slot, MissReason::ClockUnlocked));
                slot += 1;
                break;
            };
            let first = first.round();
            let end = first + window_len as f64;
            if end > store.end() as f64 {
                break; // not complete yet - the only reason to wait
            }
            if first < clock.epoch_start_index() as f64 {
                out.push(SlotEvent::Missed(slot, MissReason::BeforeEpoch));
            } else {
                match store.read(first as u64, window_len) {
                    Some(samples) => out.push(SlotEvent::Ready(SlotJob { slot, first_index: first as u64, samples, window_start_utc: t0 })),
                    None => out.push(SlotEvent::Missed(slot, MissReason::Overwritten)),
                }
            }
            slot += 1;
        }
        self.next_slot = Some(slot);
        out
    }
}
