//! The engine's control logic: configuration, QSO sequencing, the transmit decision, rig state,
//! decode history and snapshots. Deterministic: time is always passed in, so the same code runs
//! under the real clock (`runtime.rs`) and under the virtual clock of the soak tests.
//!
//! The engine owns every piece of authoritative state; user interfaces only send commands.

use crate::api::{AudioHealth, Command, DecodeRow, DecodeStats, EngineSnapshot, Event, TxOutcome, TxStatus};
use crate::bandplan::find_permitted_segment;
use crate::config::{Config, TxSlot};
use crate::qso::{Provenance, QsoNote, Sequencer, Sourced};
use crate::rig::{dial_agrees, Reading, RigStateTracker};
use crate::slots::{slot_start, MissReason};
use crate::txgate::{can_transmit, TxHardware, TxRequest, Violation, OCCUPIED_40DB_HZ, USB_MODES};
use std::collections::VecDeque;
use std::sync::Arc;
use z30_dsp::ap::ApContext;
use z30_dsp::slot::{RxConfig, SlotReport};
use z30_protocol::codec::{CallField, Callsign, VerifiedFrame};

/// Decodes kept for display.
pub const DECODE_HISTORY: usize = 500;

/// What to transmit in a slot.
#[derive(Clone, Debug)]
pub enum TxKind {
    /// A frame. Only the gate can supply one: `VerifiedFrame` has no constructor but
    /// `EncodedMessage::verify`, and `plan_tx` takes it from `Permission::frame`.
    Frame(Box<VerifiedFrame>),
    /// An unmodulated carrier at the TX audio frequency, for tuning (one frame long at most).
    Tune,
}

/// A transmission the gate has approved: the single object that carries everything the gate
/// checked - the verified frame, the audio frequency, the level, the dial and the emission -
/// from `plan_tx` to the transmitter. Only `Engine::plan_tx` can build one (its fields are
/// private and it has no public constructor), and the runtime reads the level and frequency
/// from it rather than from the configuration, so nothing critical is recomputed between the
/// gate and the air (2026-09-28 audit F-03/F-22, TX-21).
#[derive(Clone, Debug)]
pub struct TxPlan {
    slot: i64,
    kind: TxKind,
    tx_audio_hz: f64,
    tx_level: f32,
    dial_hz: u64,
    emission_centre_hz: f64,
    segment: &'static str,
    text: String,
}

impl TxPlan {
    /// Slot.
    pub fn slot(&self) -> i64 {
        self.slot
    }
    /// What.
    pub fn kind(&self) -> &TxKind {
        &self.kind
    }
    /// Tone-0 audio frequency the gate checked, Hz.
    pub fn tx_audio_hz(&self) -> f64 {
        self.tx_audio_hz
    }
    /// Transmit level the gate checked, (0, 1].
    pub fn tx_level(&self) -> f32 {
        self.tx_level
    }
    /// Dial the gate checked the emission at, Hz.
    pub fn dial_hz(&self) -> u64 {
        self.dial_hz
    }
    /// Centre of the radiated emission the gate checked, Hz.
    pub fn emission_centre_hz(&self) -> f64 {
        self.emission_centre_hz
    }
    /// Band-plan segment the gate found the emission in.
    pub fn segment(&self) -> &'static str {
        self.segment
    }
    /// Display text.
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// The engine.
pub struct Engine {
    config: Arc<Config>,
    seq: Option<Sequencer>,
    rig: RigStateTracker,
    /// The operator's dial (configuration or `SetDial`), if any.
    dial: Option<u64>,
    /// True only after the radio acknowledged a set-frequency command for exactly `dial`.
    dial_commanded: bool,
    /// A dial the runtime should send to the radio (set when the operator changes it).
    dial_to_command: Option<u64>,
    /// Tone-0 audio offset of the last frame this station transmitted, Hz.
    last_tx_audio_hz: Option<f64>,
    tx_enabled: bool,
    tune_pending: bool,
    active_tx: Option<(i64, String)>,
    decodes: VecDeque<DecodeRow>,
    next_id: u64,
    stats: DecodeStats,
    audio: AudioHealth,
    events: Vec<Event>,
    clock_status: String,
    tx_hardware_problem: Option<String>,
    /// The audio output reported a failure and has not recovered.
    output_fault: Option<String>,
    /// A PTT release the hardware has not confirmed.
    ptt_release_unconfirmed: Option<String>,
    /// The radio refused a set-frequency for the current dial and nothing has confirmed it.
    dial_refused: Option<u64>,
}

impl Engine {
    /// An engine with this configuration.
    pub fn new(config: Config) -> Self {
        let mut e = Engine {
            dial: config.operating.dial_hz,
            dial_commanded: false,
            dial_to_command: None,
            last_tx_audio_hz: None,
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
            tx_hardware_problem: None,
            output_fault: None,
            ptt_release_unconfirmed: None,
            dial_refused: None,
        };
        e.rebuild_sequencer();
        if let Some(d) = e.dial {
            e.rig.note_requested_dial(d as f64);
        }
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

    /// The operator's dial, Hz, if set.
    pub fn dial_hz(&self) -> Option<u64> {
        self.dial
    }

    /// Whether the radio acknowledged a set-frequency command for the current dial.
    pub fn dial_commanded(&self) -> bool {
        self.dial_commanded
    }

    /// The dial to send to the radio, once, after the operator changed it. The runtime calls
    /// this after every command and forwards it to rig control, if there is any.
    pub fn take_dial_command(&mut self) -> Option<u64> {
        self.dial_to_command.take()
    }

    /// The radio answered a set-frequency command for `hz`. Only an acknowledgement of the dial
    /// that is still current makes it "commanded"; a failure, or an answer for a dial the
    /// operator has since changed, leaves it configuration.
    pub fn on_dial_command_result(&mut self, hz: u64, result: Result<(), String>) {
        match result {
            Ok(()) if self.dial == Some(hz) => self.dial_commanded = true,
            Ok(()) => {}
            Err(e) => {
                if self.dial == Some(hz) {
                    self.dial_commanded = false;
                    // Positive evidence that the radio is not where the gate would check: refuse
                    // until a reading confirms the dial (F-45; it used to be no refusal at all
                    // while the tracker waited out the settle count).
                    self.dial_refused = Some(hz);
                }
                self.events.push(Event::Rig(format!("the radio did not accept the dial {:.6} MHz: {e}", hz as f64 / 1e6)));
            }
        }
    }

    fn set_dial(&mut self, dial: Option<u64>) {
        if dial != self.dial {
            self.dial = dial;
            self.dial_commanded = false;
            self.dial_refused = None;
            self.dial_to_command = dial;
            if let Some(d) = dial {
                self.rig.note_requested_dial(d as f64);
            }
        }
    }

    /// Whether a transmission is in progress.
    pub fn transmitting(&self) -> bool {
        self.active_tx.is_some()
    }

    /// Applies a command. Returns true if the runtime must abandon any planned or keyed
    /// transmission immediately.
    pub fn apply(&mut self, cmd: Command, now_ms: u64) -> bool {
        match cmd {
            Command::UpdateConfig(c) => {
                let dial = c.operating.dial_hz;
                self.config = Arc::new(*c);
                self.rebuild_sequencer();
                self.set_dial(dial);
                // A configuration change while keyed ends the transmission: the gate approved
                // the old configuration, not this one.
                return self.halt_tx();
            }
            Command::SetDial(hz) => {
                let mut c = (*self.config).clone();
                c.operating.dial_hz = Some(hz);
                self.config = Arc::new(c);
                // Sent again even if unchanged: the operator asked for it to be commanded.
                self.dial = None;
                self.set_dial(Some(hz));
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
                Some(Err(e)) => self.events.push(Event::TxRefused(vec![Violation::MessageNotEncodable(e)])),
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
                            Err(e) => self.events.push(Event::TxRefused(vec![Violation::MessageNotEncodable(e)])),
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

    /// Every command that calls this must stop a transmission that is planned as well as one
    /// that is keyed: a halt that lands between the plan and the key would otherwise key anyway.
    fn halt_tx(&mut self) -> bool {
        true
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

    /// The system clock stepped: the receive timeline was re-seated from slot `from` to `to`
    /// (F-48: a backward step used to suspend decoding silently for the length of the step).
    pub fn on_clock_stepped(&mut self, from: i64, to: i64) {
        self.events.push(Event::ClockStepped { from_slot: from, to_slot: to });
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
                    // The strongest claim the evidence supports, and no stronger (N-05): what the
                    // radio reports in a fresh reading; else a dial the radio acknowledged being
                    // told; else the operator's setting, labelled as configuration; else nothing.
                    rec.dial_hz = match (self.rig.verified_dial_hz(now_ms), self.dial) {
                        (Some(r), _) => Some(Sourced::new(r, Provenance::ReportedByRig)),
                        (None, Some(d)) if self.dial_commanded => Some(Sourced::new(d as f64, Provenance::Commanded)),
                        (None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Configured)),
                        (None, None) => None,
                    };
                    rec.tx_audio_hz = self.last_tx_audio_hz;
                    let centre_offset = self.last_tx_audio_hz.unwrap_or(self.config.operating.tx_audio_hz)
                        + (z30_protocol::NUM_TONES - 1) as f64 * z30_protocol::TONE_SPACING_HZ / 2.0;
                    rec.band = match (&rec.dial_hz, self.config.station.region, self.config.station.license_class) {
                        (Some(d), Some(r), Some(c)) => {
                            find_permitted_segment(r, c, d.value + centre_offset, OCCUPIED_40DB_HZ).map(|s| s.band.to_string())
                        }
                        _ => None,
                    };
                    rec.tx_power_w = self.config.station.configured_tx_power_w.map(|p| Sourced::new(p, Provenance::Configured));
                    if self.config.operating.auto_log {
                        match rec.validate() {
                            Ok(()) => self.events.push(Event::ContactComplete(rec)),
                            Err(why) => self.events.push(Event::TxFault(format!("contact not logged: {why}"))),
                        }
                    }
                }
            }
        }
    }

    /// A rig poll answered.
    pub fn on_rig_reading(&mut self, r: &Reading, now_ms: u64) {
        let was = self.rig.is_online();
        self.rig.observe(r, now_ms);
        if let (Some(refused), Some(reported)) = (self.dial_refused, self.rig.verified_dial_hz(now_ms)) {
            if dial_agrees(refused as f64, reported, self.rig.resolution()) {
                self.dial_refused = None;
            }
        }
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

    /// Records that the transmit hardware could not be opened (None = it was). While set, every
    /// transmission is refused: a gate that passes a station that cannot key is uncertainty
    /// reported as permission.
    pub fn set_tx_hardware_problem(&mut self, problem: Option<String>) {
        self.tx_hardware_problem = problem;
    }

    /// The audio output failed (Some) or recovered (None). While set, transmission is refused.
    pub fn set_output_fault(&mut self, fault: Option<String>) {
        self.output_fault = fault;
    }

    /// A PTT release the hardware has not confirmed (Some), or confirmed (None). While set,
    /// transmission is refused: the transmitter may still be keyed.
    pub fn set_ptt_release_unconfirmed(&mut self, why: Option<String>) {
        self.ptt_release_unconfirmed = why;
    }

    fn hardware_problems(&self) -> Vec<String> {
        self.tx_hardware_problem.iter().chain(self.output_fault.iter()).cloned().collect()
    }

    /// The gate's verdict on sending `msg` (None = tune) now.
    fn gate(&self, msg: Option<&z30_protocol::codec::Message>, now_ms: u64) -> crate::txgate::Permission {
        let problems = self.hardware_problems();
        let hardware = TxHardware {
            ptt: &self.config.ptt,
            problems: &problems,
            tx_level: self.config.audio.tx_level,
            ptt_release_unconfirmed: self.ptt_release_unconfirmed.as_deref(),
            dial_refused: self.dial_refused,
        };
        can_transmit(
            &TxRequest {
                station: &self.config.station,
                // No dial set: NaN, which the gate refuses as an undetermined frequency.
                dial_hz: self.dial.map_or(f64::NAN, |d| d as f64),
                tx_audio_hz: self.config.operating.tx_audio_hz,
                message: msg,
                hardware: &hardware,
            },
            &self.rig,
            now_ms,
        )
    }

    fn blockers_now(&self, now_ms: u64) -> Vec<Violation> {
        let msg = self.seq.as_ref().and_then(|s| s.next_message());
        self.gate(msg.as_ref(), now_ms).violations
    }

    /// Re-checks, while a transmission is under way, what the radio can contradict: a settled
    /// dial disagreement or a fresh non-USB mode in the latest reading. The gate checked these at
    /// plan time only, so a VFO turned during a frame went unnoticed for 24 s (F-45). Only
    /// positive evidence refuses, as at plan time.
    pub fn tx_still_permitted(&self, plan: &TxPlan, now_ms: u64) -> Vec<Violation> {
        let mut v = Vec::new();
        if let Some(d) = self.rig.dial_disagreement(plan.dial_hz as f64, now_ms) {
            v.push(Violation::RigDialDisagrees(d));
        }
        if let Some(mode) = self.rig.fresh_reported_mode(now_ms) {
            if !USB_MODES.contains(&mode.trim().to_ascii_uppercase().as_str()) {
                v.push(Violation::RigModeNotUsb(mode.to_string()));
            }
        }
        v
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
        let mut perm = self.gate(msg.as_ref(), now_ms);
        if !perm.allowed && perm.violations.is_empty() {
            // Refused with nothing to say is still refused: a frame request with no verified frame.
            perm.violations.push(Violation::FrameNotForMessage);
        }
        if !perm.allowed {
            self.tx_enabled = false;
            self.tune_pending = false;
            self.events.push(Event::TxRefused(perm.violations));
            return None;
        }
        // Everything below is what the gate just checked, carried in the plan as checked.
        let (Some(dial_hz), Some(centre), Some(segment)) = (self.dial, perm.tx_centre_hz, perm.segment) else {
            self.tx_enabled = false;
            self.tune_pending = false;
            self.events.push(Event::TxRefused(vec![Violation::FrequencyUndetermined]));
            return None;
        };
        let (tx_audio_hz, tx_level) = (self.config.operating.tx_audio_hz, self.config.audio.tx_level);
        let plan = |kind, text| TxPlan { slot, kind, tx_audio_hz, tx_level, dial_hz, emission_centre_hz: centre, segment, text };
        if tune {
            self.tune_pending = false;
            return Some(plan(TxKind::Tune, "TUNE".into()));
        }
        // The frame the gate verified, not a fresh encoding: what was checked is what is sent.
        match perm.frame.take() {
            Some(frame) => {
                let text = frame.message().to_string();
                Some(plan(TxKind::Frame(Box::new(frame)), text))
            }
            None => {
                self.tx_enabled = false;
                self.events.push(Event::TxRefused(vec![Violation::FrameNotForMessage]));
                None
            }
        }
    }

    /// The runtime keyed and started audio for `plan`.
    pub fn tx_started(&mut self, plan: &TxPlan) {
        self.active_tx = Some((plan.slot, plan.text.clone()));
        if matches!(plan.kind, TxKind::Frame(_)) {
            self.last_tx_audio_hz = Some(plan.tx_audio_hz);
        }
        self.events.push(Event::TxStarted { slot: plan.slot, text: plan.text.clone() });
    }

    /// The transmission ended, with this outcome. Only a `Complete` frame advances the QSO (and
    /// so can be logged): a frame that was cut short, halted, failed or ended by the watchdog did
    /// not put the whole message on the air (F-17: a late key used to truncate the frame and still
    /// report it completed, logging a 73/RR73 that was not fully sent).
    pub fn tx_finished(&mut self, slot: i64, outcome: &TxOutcome, now_ms: u64) {
        let was_frame = self.active_tx.as_ref().is_some_and(|(_, t)| t != "TUNE");
        self.active_tx = None;
        self.events.push(Event::TxFinished { slot, outcome: outcome.clone() });
        if *outcome == TxOutcome::Complete && was_frame {
            if let Some(seq) = self.seq.as_mut() {
                let notes = seq.on_transmitted(slot);
                self.handle_notes(notes, now_ms);
            }
        }
    }

    /// Queues an event from the runtime (hardware state the engine does not observe itself).
    pub fn push_event(&mut self, e: Event) {
        self.events.push(e);
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
            dial_hz: self.dial,
            dial_commanded: self.dial_commanded,
            audio: self.audio.clone(),
            stats: self.stats.clone(),
            clock_status: self.clock_status.clone(),
            dt_median_sec: (dts.len() >= 5).then(|| dts[dts.len() / 2]),
        }
    }
}
