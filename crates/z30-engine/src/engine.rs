//! The engine's control logic: configuration, QSO sequencing, the transmit decision, rig state,
//! decode history and snapshots. Deterministic: time is always passed in, so the same code runs
//! under the real clock (`runtime.rs`) and under the virtual clock of the soak tests.
//!
//! The engine owns every piece of authoritative state; user interfaces only send commands.

use crate::api::{AudioHealth, Command, DecodeRow, DecodeStats, EngineSnapshot, Event, TxStatus};
use crate::bandplan::find_permitted_segment;
use crate::config::{Config, TxSlot};
use crate::qso::{Provenance, QsoNote, Sequencer, Sourced};
use crate::rig::{Reading, RigStateTracker};
use crate::slots::{slot_start, MissReason};
use crate::txgate::{can_transmit, TxRequest, OCCUPIED_40DB_HZ};
use std::collections::VecDeque;
use std::sync::Arc;
use z30_dsp::ap::ApContext;
use z30_dsp::slot::{RxConfig, SlotReport};
use z30_protocol::codec::{CallField, Callsign, EncodedMessage};

/// Decodes kept for display.
pub const DECODE_HISTORY: usize = 500;

/// What to transmit in a slot.
#[derive(Clone, Debug)]
pub enum TxKind {
    /// A frame.
    Frame(Box<EncodedMessage>),
    /// An unmodulated carrier at the TX audio frequency, for tuning (one frame long at most).
    Tune,
}

/// A transmission the gate has approved.
#[derive(Clone, Debug)]
pub struct TxPlan {
    /// Slot.
    pub slot: i64,
    /// What.
    pub kind: TxKind,
    /// Tone-0 audio frequency, Hz.
    pub tx_audio_hz: f64,
    /// Display text.
    pub text: String,
}

/// The engine.
pub struct Engine {
    config: Arc<Config>,
    seq: Option<Sequencer>,
    rig: RigStateTracker,
    commanded_dial: u64,
    tx_enabled: bool,
    tune_pending: bool,
    active_tx: Option<(i64, String)>,
    decodes: VecDeque<DecodeRow>,
    next_id: u64,
    stats: DecodeStats,
    audio: AudioHealth,
    events: Vec<Event>,
    clock_status: String,
}

impl Engine {
    /// An engine with this configuration.
    pub fn new(config: Config) -> Self {
        let mut e = Engine {
            commanded_dial: config.operating.dial_hz,
            config: Arc::new(config),
            seq: None,
            rig: RigStateTracker::new(),
            tx_enabled: false,
            tune_pending: false,
            active_tx: None,
            decodes: VecDeque::new(),
            next_id: 1,
            stats: DecodeStats::default(),
            audio: AudioHealth::default(),
            events: Vec::new(),
            clock_status: "unknown".into(),
        };
        e.rebuild_sequencer();
        e.rig.note_requested_dial(e.commanded_dial as f64);
        e
    }

    fn rebuild_sequencer(&mut self) {
        self.seq = Callsign::new(&self.config.station.callsign)
            .ok()
            .map(|c| Sequencer::new(c, &self.config.station.grid, self.config.operating.watchdog_cycles));
    }

    /// Current configuration.
    pub fn config(&self) -> &Arc<Config> {
        &self.config
    }

    /// Events since the last call.
    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    /// Rig tracker (for the runtime's poll scheduling).
    pub fn rig(&self) -> &RigStateTracker {
        &self.rig
    }

    /// The dial this software commanded.
    pub fn commanded_dial(&self) -> u64 {
        self.commanded_dial
    }

    /// Whether a transmission is in progress.
    pub fn transmitting(&self) -> bool {
        self.active_tx.is_some()
    }

    /// Applies a command. Returns true if the runtime must unkey immediately.
    pub fn apply(&mut self, cmd: Command, now_ms: u64) -> bool {
        match cmd {
            Command::UpdateConfig(c) => {
                let dial_changed = c.operating.dial_hz != self.config.operating.dial_hz;
                self.config = Arc::new(*c);
                self.rebuild_sequencer();
                if dial_changed {
                    self.commanded_dial = self.config.operating.dial_hz;
                    self.rig.note_requested_dial(self.commanded_dial as f64);
                }
                // A configuration change while keyed ends the transmission: the gate approved
                // the old configuration, not this one.
                return self.halt_tx();
            }
            Command::SetDial(hz) => {
                self.commanded_dial = hz;
                self.rig.note_requested_dial(hz as f64);
                let mut c = (*self.config).clone();
                c.operating.dial_hz = hz;
                self.config = Arc::new(c);
                return self.halt_tx();
            }
            Command::SetAudioFrequencies { rx_hz, tx_hz } => {
                let mut c = (*self.config).clone();
                c.operating.rx_audio_hz = rx_hz;
                c.operating.tx_audio_hz = tx_hz;
                self.config = Arc::new(c);
            }
            Command::CallCq => match self.seq.as_mut().map(|s| s.call_cq()) {
                Some(Ok(())) => self.tx_enabled = true,
                Some(Err(e)) => self.events.push(Event::TxRefused(vec![crate::txgate::Violation::MessageNotEncodable(e)])),
                None => self.events.push(Event::TxRefused(self.blockers_now(now_ms))),
            },
            Command::Answer(id) => {
                if let Some(row) = self.decodes.iter().find(|r| r.id == id).cloned() {
                    if let Some(seq) = self.seq.as_mut() {
                        match seq.answer(&row.decode, row.slot) {
                            Ok(()) => {
                                // Answer in the other slot, on their frequency unless held.
                                let mut c = (*self.config).clone();
                                c.operating.tx_slot = if row.slot.rem_euclid(2) == 0 { TxSlot::Odd } else { TxSlot::Even };
                                c.operating.rx_audio_hz = row.freq_hz;
                                self.config = Arc::new(c);
                                self.tx_enabled = true;
                            }
                            Err(e) => self.events.push(Event::TxRefused(vec![crate::txgate::Violation::MessageNotEncodable(e)])),
                        }
                    }
                }
            }
            Command::EnableTx(on) => {
                self.tx_enabled = on;
                if !on {
                    return self.halt_tx();
                }
            }
            Command::HaltTx => {
                self.tx_enabled = false;
                self.tune_pending = false;
                return self.halt_tx();
            }
            Command::Tune => self.tune_pending = true,
            Command::ResetQso => {
                if let Some(s) = self.seq.as_mut() {
                    s.halt();
                }
                self.tx_enabled = false;
                return self.halt_tx();
            }
        }
        false
    }

    fn halt_tx(&mut self) -> bool {
        self.active_tx.is_some()
    }

    /// The receiver configuration for the next slot, including the AP context when enabled.
    pub fn rx_config(&self) -> RxConfig {
        let mut rx = self.config.rx_config();
        if self.config.receiver.ap_enabled {
            if let Some(seq) = &self.seq {
                rx.ap = Some(ApContext {
                    stage: seq.state().ap_stage(),
                    my_call: Some(seq.my_call().clone()),
                    dx_call: seq.state().dx().cloned(),
                    worked_freqs_hz: vec![self.config.operating.rx_audio_hz, self.config.operating.tx_audio_hz],
                });
            }
        }
        rx
    }

    /// A decoded slot.
    pub fn on_slot_report(&mut self, slot: i64, report: &SlotReport, done_utc: f64, now_ms: u64) {
        let my = self.seq.as_ref().map(|s| s.my_call().clone());
        for d in &report.decodes {
            let row = DecodeRow {
                id: self.next_id,
                slot,
                text: d.message.to_string(),
                snr_db: d.snr_db,
                dt_sec: d.dt_sec,
                freq_hz: d.freq_hz,
                drift_hz: d.drift_hz,
                ap_type: d.ap_type,
                pass: d.pass,
                to_me: my.as_ref().is_some_and(|m| d.message.is_addressed_to(m)),
                is_cq: matches!(d.message.to, CallField::Cq | CallField::CqDx | CallField::CqTest),
                decode: d.clone(),
            };
            self.next_id += 1;
            self.decodes.push_back(row);
            while self.decodes.len() > DECODE_HISTORY {
                self.decodes.pop_front();
            }
        }
        self.stats.slots += 1;
        self.stats.last_ms = report.elapsed_ms;
        self.stats.max_ms = self.stats.max_ms.max(report.elapsed_ms);
        self.stats.last_done_after_slot_sec = done_utc - slot_start(slot);
        self.events.push(Event::SlotDecoded { slot, count: report.decodes.len(), elapsed_ms: report.elapsed_ms });
        if self.config.operating.auto_sequence {
            if let Some(seq) = self.seq.as_mut() {
                let notes = seq.on_decodes(&report.decodes, slot);
                self.handle_notes(notes, now_ms);
            }
        }
    }

    /// A slot that could not be decoded.
    pub fn on_slot_missed(&mut self, slot: i64, reason: MissReason) {
        self.stats.missed += 1;
        self.events.push(Event::SlotMissed(slot, reason));
    }

    fn handle_notes(&mut self, notes: Vec<QsoNote>, now_ms: u64) {
        for n in notes {
            match n {
                QsoNote::Advanced(s) => self.events.push(Event::Qso(s)),
                QsoNote::WatchdogHalted(k) => {
                    self.tx_enabled = false;
                    self.events.push(Event::SequencerWatchdog(k));
                }
                QsoNote::Complete(mut rec) => {
                    // The radio's own reading when it is fresh and agrees; otherwise the commanded
                    // dial, labelled as commanded.
                    let dial = self.commanded_dial as f64;
                    let verified = self.rig.verified_dial_hz(now_ms).filter(|&r| crate::rig::dial_agrees(dial, r, self.rig.resolution()));
                    rec.dial_hz = match verified {
                        Some(r) => Sourced::new(r, Provenance::RigVerified),
                        None => Sourced::new(dial, Provenance::Commanded),
                    };
                    rec.tx_audio_hz = self.config.operating.tx_audio_hz;
                    rec.band = self.config.station.region.zip(self.config.station.license_class).and_then(|(r, c)| {
                        find_permitted_segment(r, c, rec.dial_hz.value + rec.tx_audio_hz + 23.4, OCCUPIED_40DB_HZ)
                            .map(|s| s.band.to_string())
                    });
                    rec.tx_power_w = self.config.station.configured_tx_power_w.map(|p| Sourced::new(p, Provenance::Configured));
                    if self.config.operating.auto_log {
                        self.events.push(Event::Logged(rec));
                    }
                }
            }
        }
    }

    /// A rig poll answered.
    pub fn on_rig_reading(&mut self, r: &Reading, now_ms: u64) {
        let was = self.rig.is_online();
        self.rig.observe(r, now_ms);
        if !was {
            self.events.push(Event::Rig("rig control established".into()));
        }
    }

    /// A rig poll failed.
    pub fn on_rig_offline(&mut self, reason: &str) {
        if self.rig.is_online() {
            self.events.push(Event::Rig(format!("rig control lost: {reason}")));
        }
        self.rig.go_offline(reason);
    }

    /// Records a PTT command for the rig's settle window.
    pub fn note_ptt(&mut self, keyed: bool, now_ms: u64) {
        self.rig.note_requested_ptt(keyed, now_ms);
    }

    /// Audio status from the runtime.
    pub fn set_audio_health(&mut self, h: AudioHealth) {
        self.audio = h;
    }

    /// OS clock status text from the runtime.
    pub fn set_clock_status(&mut self, s: String) {
        self.clock_status = s;
    }

    fn blockers_now(&self, now_ms: u64) -> Vec<crate::txgate::Violation> {
        let msg = self.seq.as_ref().and_then(|s| s.next_message());
        can_transmit(
            &TxRequest {
                station: &self.config.station,
                dial_hz: self.commanded_dial as f64,
                tx_audio_hz: self.config.operating.tx_audio_hz,
                message: msg.as_ref(),
            },
            &self.rig,
            now_ms,
        )
        .violations
    }

    /// Decides what, if anything, to transmit in `slot`. Runs the gate; a refusal is an event
    /// and disarms TX. Never returns a plan the gate did not approve.
    pub fn plan_tx(&mut self, slot: i64, now_ms: u64) -> Option<TxPlan> {
        if self.active_tx.is_some() {
            return None;
        }
        let tune = self.tune_pending;
        if !tune && (!self.tx_enabled || !self.config.operating.tx_slot.matches(slot)) {
            return None;
        }
        let msg = if tune { None } else { self.seq.as_ref().and_then(|s| s.next_message()) };
        if !tune && msg.is_none() {
            return None;
        }
        let perm = can_transmit(
            &TxRequest {
                station: &self.config.station,
                dial_hz: self.commanded_dial as f64,
                tx_audio_hz: self.config.operating.tx_audio_hz,
                message: msg.as_ref(),
            },
            &self.rig,
            now_ms,
        );
        if !perm.allowed {
            self.tx_enabled = false;
            self.tune_pending = false;
            self.events.push(Event::TxRefused(perm.violations));
            return None;
        }
        let tx_audio_hz = self.config.operating.tx_audio_hz;
        if tune {
            self.tune_pending = false;
            return Some(TxPlan { slot, kind: TxKind::Tune, tx_audio_hz, text: "TUNE".into() });
        }
        let msg = msg?;
        match msg.encode() {
            Ok(enc) => Some(TxPlan { slot, text: msg.to_string(), kind: TxKind::Frame(Box::new(enc)), tx_audio_hz }),
            Err(e) => {
                self.tx_enabled = false;
                self.events.push(Event::TxRefused(vec![crate::txgate::Violation::MessageNotEncodable(e)]));
                None
            }
        }
    }

    /// The runtime keyed and started audio for `plan`.
    pub fn tx_started(&mut self, plan: &TxPlan) {
        self.active_tx = Some((plan.slot, plan.text.clone()));
        self.events.push(Event::TxStarted { slot: plan.slot, text: plan.text.clone() });
    }

    /// The transmission ended. `completed` = the whole frame went out.
    pub fn tx_finished(&mut self, slot: i64, completed: bool, now_ms: u64) {
        let was_frame = self.active_tx.as_ref().is_some_and(|(_, t)| t != "TUNE");
        self.active_tx = None;
        self.events.push(Event::TxFinished { slot });
        if completed && was_frame {
            if let Some(seq) = self.seq.as_mut() {
                let notes = seq.on_transmitted(slot);
                self.handle_notes(notes, now_ms);
            }
        }
    }

    /// A keying or audio fault during TX.
    pub fn tx_fault(&mut self, what: String) {
        self.tx_enabled = false;
        self.active_tx = None;
        self.events.push(Event::TxFault(what));
    }

    /// The immutable view for user interfaces.
    pub fn snapshot(&self, now_ms: u64) -> EngineSnapshot {
        let mut dts: Vec<f64> = self.decodes.iter().rev().take(30).map(|d| d.dt_sec).collect();
        dts.sort_by(|a, b| a.partial_cmp(b).unwrap());
        EngineSnapshot {
            config: self.config.clone(),
            decodes: self.decodes.iter().cloned().collect(),
            qso: self.seq.as_ref().map(|s| s.state().clone()),
            tx: match &self.active_tx {
                Some((slot, text)) => TxStatus::Transmitting { text: text.clone(), slot: *slot },
                None if self.tx_enabled || self.tune_pending => TxStatus::Armed,
                None => TxStatus::Idle,
            },
            next_tx_text: self.seq.as_ref().and_then(|s| s.next_message()).map(|m| m.to_string()),
            tx_blockers: self.blockers_now(now_ms).iter().map(|v| v.to_string()).collect(),
            rig: self.rig.snapshot(),
            commanded_dial_hz: self.commanded_dial,
            audio: self.audio.clone(),
            stats: self.stats.clone(),
            clock_status: self.clock_status.clone(),
            dt_median_sec: (dts.len() >= 5).then(|| dts[dts.len() / 2]),
        }
    }
}
