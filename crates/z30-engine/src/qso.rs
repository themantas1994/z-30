//! QSO sequencing and the log record it produces.
//!
//! Replaces `qsoEngine.ts`, which advanced on any message addressed to the operator without
//! checking its type (H3), matched callsigns by substring (M7), and logged local time as UTC, a
//! default grid and a default report when nothing had been received (H1). Here:
//!
//! - a message moves the sequence only if it is addressed exactly to this station, comes from
//!   the station being worked (or, while calling CQ, from anyone answering), and is the message
//!   type the current state expects;
//! - v1 has no roger bit (SPEC.md 6.2), so a report sent in reply to a report carries the roger
//!   by its place in the sequence, and the software never displays an `R` it did not send;
//! - every field of the log record carries its provenance, and a field nothing measured or
//!   received is absent, not filled in.
//!
//! The standard exchange, v1 form (A calls CQ, B answers):
//!
//! ```text
//! A: CQ A GRID          B: A B GRID         A: B A -12 (report)
//! B: A B -08 (report = roger, by sequence)  A: B A RR73          B: A B 73
//! ```

use serde::{Deserialize, Serialize};
use z30_dsp::ap::ApStage;
use z30_dsp::slot::Decode;
use z30_protocol::codec::{CallField, Callsign, CodecError, Extra, Grid4, Message};

/// Where the sequence is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QsoState {
    /// Nothing in progress.
    Idle,
    /// Sending `CQ me grid`.
    CallingCq,
    /// Answered `dx`'s CQ with `dx me grid`.
    Replying(Callsign),
    /// Sending `dx me report` (they answered our CQ).
    SendingReport(Callsign),
    /// Sending `dx me report` in reply to their report - the v1 roger report.
    SendingRogerReport(Callsign),
    /// Sending `dx me RR73`.
    SendingRr73(Callsign),
    /// Sending `dx me 73`.
    Sending73(Callsign),
}

impl QsoState {
    /// The station being worked.
    pub fn dx(&self) -> Option<&Callsign> {
        match self {
            QsoState::Idle | QsoState::CallingCq => None,
            QsoState::Replying(c)
            | QsoState::SendingReport(c)
            | QsoState::SendingRogerReport(c)
            | QsoState::SendingRr73(c)
            | QsoState::Sending73(c) => Some(c),
        }
    }
}

impl QsoState {
    /// The AP ladder stage this state corresponds to.
    pub fn ap_stage(&self) -> ApStage {
        match self {
            QsoState::Idle => ApStage::Idle,
            QsoState::CallingCq => ApStage::CallingCq,
            QsoState::Replying(_) => ApStage::ReplyingCq,
            QsoState::SendingReport(_) => ApStage::SendingReport,
            QsoState::SendingRogerReport(_) => ApStage::SendingRReport,
            QsoState::SendingRr73(_) | QsoState::Sending73(_) => ApStage::Sending73,
        }
    }
}

/// Where a logged value came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    /// Decoded from the other station's transmission.
    Received,
    /// Measured by this receiver.
    Measured,
    /// Sent by this station.
    Sent,
    /// Read back from the radio.
    RigVerified,
    /// What this software commanded (the radio did not confirm it).
    Commanded,
    /// The operator's configuration (e.g. the power they set).
    Configured,
    /// Imported from a legacy logbook whose fields cannot be told apart from fabrications.
    LegacyImport,
    /// Entered by the operator.
    Manual,
}

/// A value and where it came from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sourced<T> {
    /// The value.
    pub value: T,
    /// Its provenance.
    pub source: Provenance,
}

impl<T> Sourced<T> {
    /// Tags a value.
    pub fn new(value: T, source: Provenance) -> Self {
        Sourced { value, source }
    }
}

/// A completed contact. Absent means "not received, not measured" - never a default.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QsoRecord {
    /// Their callsign (received).
    pub call: String,
    /// Their grid, if they sent one.
    pub grid: Option<Sourced<String>>,
    /// Report we sent them (our measurement of their signal), dB.
    pub rst_sent: Option<Sourced<i8>>,
    /// Report they sent us, dB.
    pub rst_rcvd: Option<Sourced<i8>>,
    /// UTC of the first slot of the exchange, seconds since the epoch.
    pub start_utc: f64,
    /// UTC of the end of the last frame of the exchange.
    pub end_utc: f64,
    /// Dial frequency, Hz, and whether the radio confirmed it.
    pub dial_hz: Sourced<f64>,
    /// Transmit tone-0 audio frequency, Hz.
    pub tx_audio_hz: f64,
    /// Band label, if the frequency is in the band plan.
    pub band: Option<String>,
    /// Our callsign.
    pub my_call: String,
    /// Our grid as configured.
    pub my_grid: Option<String>,
    /// Power the operator configured, W (configuration, not a measurement).
    pub tx_power_w: Option<Sourced<f64>>,
    /// Whether any message of the exchange was decoded with a priori information.
    pub ap_assisted: bool,
    /// Free text.
    pub comment: String,
}

/// The earliest UTC a record may carry: 2020-01-01T00:00:00Z. Anything earlier is a clock
/// that was never set, or a local time mistaken for UTC somewhere upstream, not a z-30 contact.
pub const EARLIEST_QSO_UTC: f64 = 1_577_836_800.0;

impl QsoRecord {
    /// Why this record must not be written to a logbook, if it must not. A logbook holds only
    /// contacts that happened: a real partner callsign (one v1 can carry, so one that was
    /// actually decoded or imported as such), a UTC time that is plausible, and an end that is
    /// not before the start. Absent optional fields are fine - they stay absent.
    pub fn validate(&self) -> Result<(), String> {
        if self.call.trim().is_empty() {
            return Err("no partner callsign: nothing was received from a station".into());
        }
        if !self.start_utc.is_finite() || self.start_utc < EARLIEST_QSO_UTC {
            return Err(format!("start time {} is not a plausible UTC time", self.start_utc));
        }
        if !self.end_utc.is_finite() || self.end_utc < self.start_utc {
            return Err(format!("end time {} is before the start {}", self.end_utc, self.start_utc));
        }
        // `my_call` may be empty: a legacy logbook entry does not say which callsign the station
        // used, and guessing the current one would be inventing it.
        Ok(())
    }
}

/// Something the sequencer wants the application to know.
#[derive(Clone, Debug, PartialEq)]
pub enum QsoNote {
    /// The sequence advanced.
    Advanced(QsoState),
    /// The watchdog stopped transmitting after this many transmissions without progress.
    WatchdogHalted(u32),
    /// A contact is complete and ready to log.
    Complete(Box<QsoRecord>),
}

#[derive(Clone, Debug, Default)]
struct DxInfo {
    grid: Option<Grid4>,
    rst_rcvd: Option<i8>,
    rst_sent: Option<i8>,
    last_snr: Option<f64>,
    first_slot: Option<i64>,
    ap_assisted: bool,
}

/// The sequencer.
#[derive(Clone, Debug)]
pub struct Sequencer {
    my_call: Callsign,
    my_grid: Option<Grid4>,
    state: QsoState,
    dx: DxInfo,
    tx_without_progress: u32,
    watchdog_cycles: u32,
}

/// Report value for a measured SNR: rounded, and clamped to the -30..+30 dB v1 can carry.
/// `None` when the receiver had no signal estimate: then there is no report to send, and the
/// sequencer sends nothing rather than a made-up one.
///
/// The estimate's accuracy is measured from `SNR_VALIDATED_MIN_DB` to `SNR_VALIDATED_MAX_DB`
/// (z30-dsp `tests/snr_accuracy.rs`); the upper edge is also v1's largest report, so a clamp
/// there is the protocol's limit, not the estimator's. Before that test existed the estimate
/// saturated near +6.6 dB and a +20 dB station was sent "+07" (2026-09-24 audit, M-07).
pub fn report_for(snr_db: Option<f64>) -> Option<i8> {
    snr_db.filter(|v| v.is_finite()).map(|v| v.round().clamp(-30.0, 30.0) as i8)
}

impl Sequencer {
    /// A sequencer for this station. `grid` is the configured locator; v1 sends its 4-character
    /// square only when the square is in the v1 table.
    pub fn new(my_call: Callsign, grid: &str, watchdog_cycles: u32) -> Self {
        let my_grid = grid.get(..4).and_then(|g| Grid4::new(g).ok());
        Sequencer {
            my_call,
            my_grid,
            state: QsoState::Idle,
            dx: DxInfo::default(),
            tx_without_progress: 0,
            watchdog_cycles: watchdog_cycles.max(1),
        }
    }

    /// Current state.
    pub fn state(&self) -> &QsoState {
        &self.state
    }

    /// Our callsign.
    pub fn my_call(&self) -> &Callsign {
        &self.my_call
    }

    fn grid_extra(&self) -> Result<Extra, CodecError> {
        let g = self.my_grid.as_ref().ok_or_else(|| CodecError::MalformedGrid(String::new()))?;
        Extra::grid(g)
    }

    /// Start calling CQ. Refused (with the reason) if our grid is not one v1 can send.
    pub fn call_cq(&mut self) -> Result<(), CodecError> {
        self.grid_extra()?;
        self.set(QsoState::CallingCq);
        self.dx = DxInfo::default();
        Ok(())
    }

    /// Answer a decoded CQ.
    pub fn answer(&mut self, cq: &Decode, slot: i64) -> Result<(), CodecError> {
        let from = cq.message.from.call().cloned().ok_or_else(|| CodecError::Unparseable(cq.message.to_string()))?;
        if !matches!(cq.message.to, CallField::Cq | CallField::CqDx | CallField::CqTest) {
            return Err(CodecError::Unparseable(cq.message.to_string()));
        }
        self.grid_extra()?;
        self.dx = DxInfo { last_snr: cq.snr_db, first_slot: Some(slot), ap_assisted: cq.ap_type > 0, ..Default::default() };
        if let Extra::Grid(g) = &cq.message.extra {
            self.dx.grid = Some(g.clone());
        }
        self.set(QsoState::Replying(from));
        Ok(())
    }

    /// Stop.
    pub fn halt(&mut self) {
        self.set(QsoState::Idle);
    }

    fn set(&mut self, s: QsoState) {
        self.state = s;
        self.tx_without_progress = 0;
    }

    /// The message to send in our next slot, if any.
    pub fn next_message(&self) -> Option<Message> {
        let me = self.my_call.clone();
        // No measured report means no report message: never a default value on the air.
        let rpt = || self.dx.rst_sent.and_then(|r| Extra::report(r as i32).ok());
        match &self.state {
            QsoState::Idle => None,
            QsoState::CallingCq => Message::cq(me, self.my_grid.as_ref()?).ok(),
            QsoState::Replying(dx) => Message::directed(dx.clone(), me, self.grid_extra().ok()?).ok(),
            QsoState::SendingReport(dx) | QsoState::SendingRogerReport(dx) => Message::directed(dx.clone(), me, rpt()?).ok(),
            QsoState::SendingRr73(dx) => Message::directed(dx.clone(), me, Extra::Rr73).ok(),
            QsoState::Sending73(dx) => Message::directed(dx.clone(), me, Extra::SeventyThree).ok(),
        }
    }

    /// Feeds one slot's decodes. Only messages addressed exactly to us move the sequence.
    pub fn on_decodes(&mut self, decodes: &[Decode], slot: i64) -> Vec<QsoNote> {
        let mut notes = Vec::new();
        for d in decodes {
            if !d.message.is_addressed_to(&self.my_call) {
                continue;
            }
            let Some(from) = d.message.from.call().cloned() else { continue };
            if let Some(dx) = self.state.dx() {
                if *dx != from {
                    continue;
                }
            }
            let before = self.state.clone();
            self.dx.last_snr = d.snr_db;
            self.dx.ap_assisted |= d.ap_type > 0;
            match (&self.state, &d.message.extra) {
                (QsoState::CallingCq, Extra::Grid(g)) => {
                    self.dx = DxInfo {
                        grid: Some(g.clone()),
                        last_snr: d.snr_db,
                        first_slot: Some(slot),
                        ap_assisted: d.ap_type > 0,
                        ..Default::default()
                    };
                    self.dx.rst_sent = report_for(d.snr_db);
                    self.set(QsoState::SendingReport(from));
                }
                (QsoState::CallingCq, Extra::Report(r)) => {
                    // They skipped the grid and sent a report: ours is the roger report.
                    self.dx = DxInfo {
                        rst_rcvd: Some(*r),
                        last_snr: d.snr_db,
                        first_slot: Some(slot),
                        ap_assisted: d.ap_type > 0,
                        ..Default::default()
                    };
                    self.dx.rst_sent = report_for(d.snr_db);
                    self.set(QsoState::SendingRogerReport(from));
                }
                (QsoState::SendingReport(_), Extra::Report(r)) => {
                    // Their report after ours is their roger report (v1: by sequence).
                    self.dx.rst_rcvd = Some(*r);
                    self.set(QsoState::SendingRr73(from));
                }
                (QsoState::Replying(_), Extra::Report(r)) => {
                    self.dx.rst_rcvd = Some(*r);
                    self.dx.rst_sent = report_for(d.snr_db);
                    self.set(QsoState::SendingRogerReport(from));
                }
                (QsoState::SendingRogerReport(_), Extra::Rr73 | Extra::Rrr) => {
                    self.set(QsoState::Sending73(from));
                }
                (QsoState::SendingRogerReport(_), Extra::SeventyThree) => {
                    // They have signed; the exchange is complete on both sides.
                    notes.push(QsoNote::Complete(Box::new(self.record(slot))));
                    self.set(QsoState::Idle);
                }
                (QsoState::SendingRr73(_), Extra::SeventyThree) => {
                    self.set(QsoState::Idle);
                }
                _ => {} // the wrong type for this state: repeat our message, do not advance
            }
            if self.state != before {
                notes.push(QsoNote::Advanced(self.state.clone()));
            }
        }
        notes
    }

    /// Our transmission in `slot` finished. Completes the exchange where our last message is
    /// the one that closes it, and runs the watchdog.
    pub fn on_transmitted(&mut self, slot: i64) -> Vec<QsoNote> {
        let mut notes = Vec::new();
        if self.dx.first_slot.is_none() {
            self.dx.first_slot = Some(slot);
        }
        match self.state.clone() {
            // Sending RR73 closes the exchange for us (we have their roger report); WSJT-X logs
            // at the same point. Sending 73 closes it for the answering station.
            QsoState::SendingRr73(_) | QsoState::Sending73(_) => {
                notes.push(QsoNote::Complete(Box::new(self.record(slot))));
                self.set(QsoState::Idle);
                notes.push(QsoNote::Advanced(QsoState::Idle));
                return notes;
            }
            QsoState::Idle => return notes,
            _ => {}
        }
        self.tx_without_progress += 1;
        if self.tx_without_progress >= self.watchdog_cycles {
            let n = self.tx_without_progress;
            self.set(QsoState::Idle);
            notes.push(QsoNote::WatchdogHalted(n));
        }
        notes
    }

    fn record(&self, last_slot: i64) -> QsoRecord {
        let first = self.dx.first_slot.unwrap_or(last_slot);
        QsoRecord {
            call: self.state.dx().map(|c| c.to_string()).unwrap_or_default(),
            grid: self.dx.grid.as_ref().map(|g| Sourced::new(g.to_string(), Provenance::Received)),
            rst_sent: self.dx.rst_sent.map(|r| Sourced::new(r, Provenance::Sent)),
            rst_rcvd: self.dx.rst_rcvd.map(|r| Sourced::new(r, Provenance::Received)),
            start_utc: crate::slots::slot_start(first),
            end_utc: crate::slots::slot_start(last_slot) + z30_protocol::FRAME_SEC,
            dial_hz: Sourced::new(0.0, Provenance::Commanded),
            tx_audio_hz: 0.0,
            band: None,
            my_call: self.my_call.to_string(),
            my_grid: self.my_grid.as_ref().map(|g| g.to_string()),
            tx_power_w: None,
            ap_assisted: self.dx.ap_assisted,
            comment: String::new(),
        }
    }
}
