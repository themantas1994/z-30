//! Commands in, events and immutable snapshots out. The GUI and CLI own no radio state: they
//! send `Command`s and render `EngineSnapshot`s.

use crate::config::Config;
use crate::qso::{QsoRecord, QsoState};
use crate::rig::RigSnapshot;
use crate::slots::MissReason;
use crate::txgate::Violation;
use std::sync::Arc;

/// What a user interface can ask for.
#[derive(Clone, Debug)]
pub enum Command {
    /// Replace the configuration (validated; TX halts while keyed state is re-evaluated).
    UpdateConfig(Box<Config>),
    /// Set the dial (commanded; the rig tracker verifies it).
    SetDial(u64),
    /// Set the receive and transmit tone-0 audio frequencies.
    SetAudioFrequencies {
        /// RX, Hz.
        rx_hz: f64,
        /// TX, Hz.
        tx_hz: f64,
    },
    /// Start calling CQ in our slots.
    CallCq,
    /// Answer the decode with this id.
    Answer(u64),
    /// Enable transmission in our slots (the sequencer's message is sent).
    EnableTx(bool),
    /// Stop transmitting now (unkeys immediately) and disarm.
    HaltTx,
    /// Transmit an unmodulated carrier for tuning, in the next slot, for at most one frame.
    Tune,
    /// Clear the QSO in progress.
    ResetQso,
}

/// One decode as the UI shows it.
#[derive(Clone, Debug)]
pub struct DecodeRow {
    /// Unique id (for `Command::Answer`).
    pub id: u64,
    /// Slot number.
    pub slot: i64,
    /// Message text; unrepresentable fields are shown as such.
    pub text: String,
    /// SNR in 2500 Hz, dB (measured).
    pub snr_db: Option<f64>,
    /// DT, s.
    pub dt_sec: f64,
    /// Tone-0 audio frequency, Hz.
    pub freq_hz: f64,
    /// Drift across the frame, Hz.
    pub drift_hz: f64,
    /// AP type (0 = none). Shown as `a1`..`a6`, never hidden.
    pub ap_type: u8,
    /// SIC pass.
    pub pass: u8,
    /// Addressed exactly to us.
    pub to_me: bool,
    /// A CQ.
    pub is_cq: bool,
    /// The full decode.
    pub decode: z30_dsp::slot::Decode,
}

/// Transmitter state for display.
#[derive(Clone, Debug, PartialEq)]
pub enum TxStatus {
    /// Not transmitting, not armed.
    Idle,
    /// Armed; will transmit in our next slot if the gate allows.
    Armed,
    /// Keyed.
    Transmitting {
        /// What.
        text: String,
        /// Slot.
        slot: i64,
    },
}

/// Audio health.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AudioHealth {
    /// Input device running.
    pub input_running: bool,
    /// Samples lost (ring overruns), cumulative.
    pub overruns: u64,
    /// Estimated sound-card clock error, ppm.
    pub drift_ppm: Option<f64>,
    /// Audio epoch (increments on each discontinuity).
    pub epoch: u32,
    /// RMS input level, dBFS.
    pub level_dbfs: Option<f64>,
}

/// Decoder performance for the diagnostics view.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DecodeStats {
    /// Slots decoded.
    pub slots: u64,
    /// Slots missed (with reasons counted by `missed_*`).
    pub missed: u64,
    /// Last slot's decode time, ms.
    pub last_ms: f64,
    /// Worst decode time, ms.
    pub max_ms: f64,
    /// Latest time after the slot boundary a decode finished, s.
    pub last_done_after_slot_sec: f64,
}

/// Everything a UI renders. Immutable; the engine publishes a new one on every change.
#[derive(Clone, Debug)]
pub struct EngineSnapshot {
    /// Current configuration.
    pub config: Arc<Config>,
    /// Recent decodes, newest last (bounded).
    pub decodes: Vec<DecodeRow>,
    /// QSO sequencer state (None when no representable callsign is configured).
    pub qso: Option<QsoState>,
    /// Transmitter.
    pub tx: TxStatus,
    /// The message that would be sent next, if armed.
    pub next_tx_text: Option<String>,
    /// Why the gate would refuse right now (empty = would allow).
    pub tx_blockers: Vec<String>,
    /// Rig readback.
    pub rig: RigSnapshot,
    /// Dial this software commanded.
    pub commanded_dial_hz: u64,
    /// Audio.
    pub audio: AudioHealth,
    /// Decoder.
    pub stats: DecodeStats,
    /// System clock status as reported by the OS (never adjusted by z-30).
    pub clock_status: String,
    /// Median DT of recent decodes, s: a receive-derived hint of this station's clock error.
    pub dt_median_sec: Option<f64>,
}

/// Something that happened, for logs and notifications.
#[derive(Clone, Debug)]
pub enum Event {
    /// A slot was decoded.
    SlotDecoded {
        /// Slot.
        slot: i64,
        /// Decodes.
        count: usize,
        /// Time spent, ms.
        elapsed_ms: f64,
    },
    /// A slot could not be decoded.
    SlotMissed(i64, MissReason),
    /// Transmission refused by the gate.
    TxRefused(Vec<Violation>),
    /// Keyed.
    TxStarted {
        /// Slot.
        slot: i64,
        /// Text.
        text: String,
    },
    /// Unkeyed.
    TxFinished {
        /// Slot.
        slot: i64,
    },
    /// Keying or audio failed; transmitter released.
    TxFault(String),
    /// The PTT watchdog released a stuck transmitter.
    WatchdogReleased,
    /// QSO state changed.
    Qso(QsoState),
    /// The sequencer's watchdog stopped TX.
    SequencerWatchdog(u32),
    /// A contact to log.
    Logged(Box<QsoRecord>),
    /// Rig status changed.
    Rig(String),
    /// Audio status changed.
    Audio(String),
}

/// How a reported SNR is displayed: the value inside the range its accuracy has been measured
/// over (z30-dsp `SNR_VALIDATED_MIN_DB..=SNR_VALIDATED_MAX_DB`), a bound outside it, and
/// "--" when there was no signal estimate. Never a floor or a default shown as a number.
pub fn snr_text(snr_db: Option<f64>) -> String {
    use z30_dsp::demod::{SNR_VALIDATED_MAX_DB, SNR_VALIDATED_MIN_DB};
    match snr_db {
        None => "--".into(),
        Some(v) if v < SNR_VALIDATED_MIN_DB => format!("<{SNR_VALIDATED_MIN_DB:+.0}"),
        Some(v) if v > SNR_VALIDATED_MAX_DB => format!(">{SNR_VALIDATED_MAX_DB:+.0}"),
        Some(v) => format!("{v:+.1}"),
    }
}

#[cfg(test)]
mod snr_text_tests {
    use super::snr_text;

    #[test]
    fn unmeasured_and_out_of_range_values_are_not_shown_as_measurements() {
        assert_eq!(snr_text(None), "--");
        assert_eq!(snr_text(Some(-7.26)), "-7.3");
        assert_eq!(snr_text(Some(-26.0)), "<-22");
        assert_eq!(snr_text(Some(41.0)), ">+30");
    }
}
