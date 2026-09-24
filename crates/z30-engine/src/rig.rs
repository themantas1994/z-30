//! Closed-loop rig state: what was commanded against what the radio reports. A port of
//! `src/dsp/rigStateTracker.ts`, itself a port of WSJT-X's PollingTransceiver/TransceiverBase
//! model. Transport-free and clock-injected, so every rule is testable without a radio.
//!
//! Three exclusions keep the dial check from grounding stations that work (AGENTS.md section 4):
//! no readback is "unverified", not "wrong"; an unsettled QSY (three polls) is not a refusal;
//! a difference inside the rig's measured tuning resolution is not a refusal.

/// WSJT-X's `polls_to_stabilize`.
pub const POLLS_TO_STABILIZE: u32 = 3;
/// WSJT-X sleeps this long after every PTT change before further CAT traffic.
pub const PTT_SETTLE_MS: u64 = 100;
/// A reading older than this no longer vouches for the rig.
pub const READING_STALE_AFTER_MS: u64 = 6000;
/// Default poll interval.
pub const DEFAULT_POLL_INTERVAL_MS: u64 = 1000;

/// WSJT-X's measured tuning-resolution code: 0 = 1 Hz; +-1 = 10 Hz; +-2 = 20 Hz; +-3 = 100 Hz;
/// negative = the rig truncates, positive = it rounds.
pub type Resolution = i8;

/// Step of a resolution code, Hz.
pub fn resolution_step_hz(r: Resolution) -> f64 {
    match r.abs() {
        1 => 10.0,
        2 => 20.0,
        3 => 100.0,
        _ => 1.0,
    }
}

/// (below, above) error a rig of this resolution may legitimately show.
pub fn resolution_error_bounds_hz(r: Resolution) -> (f64, f64) {
    let step = resolution_step_hz(r);
    if step == 1.0 {
        (0.0, 0.0)
    } else if r < 0 {
        // Truncation is one-sided: such a rig only ever lands low.
        (step - 1.0, 0.0)
    } else {
        (step / 2.0, step / 2.0)
    }
}

/// Whether a reported dial agrees with the commanded one within the rig's resolution (+1 Hz).
pub fn dial_agrees(commanded: f64, reported: f64, r: Resolution) -> bool {
    if !commanded.is_finite() || !reported.is_finite() {
        return false;
    }
    let (below, above) = resolution_error_bounds_hz(r);
    let err = reported - commanded;
    err <= above + 1.0 && -err <= below + 1.0
}

/// Human description of a resolution code.
pub fn describe_resolution(r: Resolution) -> String {
    let step = resolution_step_hz(r);
    if step == 1.0 {
        "1 Hz".into()
    } else {
        format!("{} Hz {}", step as u32, if r < 0 { "truncated" } else { "rounded" })
    }
}

/// One poll's answers; any field may be absent.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reading {
    /// Dial frequency, Hz.
    pub dial_hz: Option<f64>,
    /// PTT state.
    pub ptt: Option<bool>,
    /// Mode string.
    pub mode: Option<String>,
}

/// A settled, fresh contradiction between the commanded and the reported dial.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DialDisagreement {
    /// What this software commanded (and the gate checked).
    pub commanded_hz: f64,
    /// What the radio says.
    pub reported_hz: f64,
    /// reported - commanded.
    pub error_hz: f64,
    /// Age of the reading.
    pub age_ms: u64,
}

/// Snapshot for display.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RigSnapshot {
    /// Heard from recently and not declared offline.
    pub online: bool,
    /// Last reported dial.
    pub reported_dial_hz: Option<f64>,
    /// Last reported PTT.
    pub reported_ptt: Option<bool>,
    /// Last reported mode.
    pub reported_mode: Option<String>,
    /// Last commanded dial.
    pub commanded_dial_hz: Option<f64>,
    /// Retries exhausted or request matched.
    pub stable: bool,
    /// Polls left before a disagreement counts.
    pub polls_remaining: u32,
    /// Why it went offline.
    pub offline_reason: Option<String>,
    /// Tuning resolution code.
    pub resolution: Resolution,
}

/// The tracker. Times are milliseconds on any monotonic clock the caller supplies.
#[derive(Clone, Debug, Default)]
pub struct RigStateTracker {
    online: bool,
    offline_reason: Option<String>,
    commanded_dial: Option<f64>,
    commanded_ptt: Option<bool>,
    commanded_mode: Option<String>,
    reported_dial: Option<f64>,
    reported_ptt: Option<bool>,
    reported_mode: Option<String>,
    polls_remaining: u32,
    last_reading_ms: Option<u64>,
    resolution: Resolution,
    last_ptt_change_ms: Option<u64>,
}

impl RigStateTracker {
    /// A tracker that has never heard from a rig.
    pub fn new() -> Self {
        Self::default()
    }

    /// Records the measured tuning resolution.
    pub fn set_resolution(&mut self, r: Resolution) {
        self.resolution = r;
    }

    /// The resolution code.
    pub fn resolution(&self) -> Resolution {
        self.resolution
    }

    /// A dial was commanded: start the settle count if it changed.
    pub fn note_requested_dial(&mut self, hz: f64) {
        if self.commanded_dial != Some(hz) {
            self.commanded_dial = Some(hz);
            self.polls_remaining = POLLS_TO_STABILIZE;
        }
    }

    /// A mode was commanded.
    pub fn note_requested_mode(&mut self, mode: &str) {
        if self.commanded_mode.as_deref() != Some(mode) {
            self.commanded_mode = Some(mode.to_string());
            self.polls_remaining = POLLS_TO_STABILIZE;
        }
    }

    /// PTT was commanded; opens the settle window.
    pub fn note_requested_ptt(&mut self, tx: bool, now_ms: u64) {
        self.last_ptt_change_ms = Some(now_ms);
        if self.commanded_ptt != Some(tx) {
            self.commanded_ptt = Some(tx);
            self.polls_remaining = POLLS_TO_STABILIZE;
        }
    }

    /// Milliseconds left in the PTT settle window.
    pub fn ptt_settle_remaining_ms(&self, now_ms: u64) -> u64 {
        self.last_ptt_change_ms.map_or(0, |t| PTT_SETTLE_MS.saturating_sub(now_ms.saturating_sub(t)))
    }

    /// Whether CAT traffic should wait.
    pub fn in_ptt_settle_window(&self, now_ms: u64) -> bool {
        self.ptt_settle_remaining_ms(now_ms) > 0
    }

    /// One successful poll.
    pub fn observe(&mut self, r: &Reading, now_ms: u64) {
        self.online = true;
        self.offline_reason = None;
        self.last_reading_ms = Some(now_ms);
        if let Some(d) = r.dial_hz.filter(|d| d.is_finite()) {
            self.reported_dial = Some(d);
        }
        if let Some(p) = r.ptt {
            self.reported_ptt = Some(p);
        }
        if let Some(m) = r.mode.as_ref().filter(|m| !m.is_empty()) {
            self.reported_mode = Some(m.clone());
        }
        if self.polls_remaining > 0 {
            self.polls_remaining -= 1;
            if self.matches_request() {
                self.polls_remaining = 0;
            }
        }
    }

    fn matches_request(&self) -> bool {
        if let (Some(c), Some(r)) = (self.commanded_dial, self.reported_dial) {
            if !dial_agrees(c, r, self.resolution) {
                return false;
            }
        }
        if let (Some(c), Some(r)) = (self.commanded_ptt, self.reported_ptt) {
            if c != r {
                return false;
            }
        }
        true
    }

    /// Contact lost: stop vouching for the last reading.
    pub fn go_offline(&mut self, reason: &str) {
        self.online = false;
        self.offline_reason = Some(reason.to_string());
        self.reported_dial = None;
        self.reported_ptt = None;
        self.reported_mode = None;
        self.last_reading_ms = None;
        self.polls_remaining = 0;
    }

    /// Rig control stopped.
    pub fn reset(&mut self) {
        self.go_offline("rig control stopped");
        self.commanded_dial = None;
        self.commanded_ptt = None;
        self.commanded_mode = None;
        self.last_ptt_change_ms = None;
        self.resolution = 0;
    }

    /// Settled.
    pub fn is_stable(&self) -> bool {
        self.polls_remaining == 0
    }

    /// Heard from.
    pub fn is_online(&self) -> bool {
        self.online
    }

    /// A reading no older than READING_STALE_AFTER_MS.
    pub fn has_fresh_reading(&self, now_ms: u64) -> bool {
        self.online && self.last_reading_ms.is_some_and(|t| now_ms.saturating_sub(t) <= READING_STALE_AFTER_MS)
    }

    /// The dial the radio vouches for, if any.
    pub fn verified_dial_hz(&self, now_ms: u64) -> Option<f64> {
        if self.has_fresh_reading(now_ms) {
            self.reported_dial
        } else {
            None
        }
    }

    /// The operating mode the radio reported, while that report is fresh.
    pub fn fresh_reported_mode(&self, now_ms: u64) -> Option<&str> {
        if self.has_fresh_reading(now_ms) {
            self.reported_mode.as_deref()
        } else {
            None
        }
    }

    /// A settled, fresh disagreement with `commanded_hz`, or None. Only positive evidence of a
    /// mismatch is returned; everything uncertain is None.
    pub fn dial_disagreement(&self, commanded_hz: f64, now_ms: u64) -> Option<DialDisagreement> {
        if !commanded_hz.is_finite() || !self.has_fresh_reading(now_ms) || !self.is_stable() {
            return None;
        }
        let reported = self.reported_dial?;
        if dial_agrees(commanded_hz, reported, self.resolution) {
            return None;
        }
        Some(DialDisagreement {
            commanded_hz,
            reported_hz: reported,
            error_hz: reported - commanded_hz,
            age_ms: now_ms.saturating_sub(self.last_reading_ms.unwrap_or(now_ms)),
        })
    }

    /// Display snapshot.
    pub fn snapshot(&self) -> RigSnapshot {
        RigSnapshot {
            online: self.online,
            reported_dial_hz: self.reported_dial,
            reported_ptt: self.reported_ptt,
            reported_mode: self.reported_mode.clone(),
            commanded_dial_hz: self.commanded_dial,
            stable: self.is_stable(),
            polls_remaining: self.polls_remaining,
            offline_reason: self.offline_reason.clone(),
            resolution: self.resolution,
        }
    }
}
