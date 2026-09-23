//! Configuration model. Persisted as TOML by `z30-io`; validated here.
//!
//! Protocol constants are not configuration (they live in `z30-protocol`); safety limits are
//! not configuration either (compile-time constants in `ptt.rs`), so nothing here can raise
//! them at runtime.

use crate::bandplan::{LicenseClass, Region};
use serde::{Deserialize, Serialize};

/// Which slots this station transmits in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TxSlot {
    /// Slots starting at second 0 of the minute.
    #[default]
    Even,
    /// Slots starting at second 30.
    Odd,
}

impl TxSlot {
    /// Whether slot `n` (seconds since epoch / 30) is ours.
    pub fn matches(self, slot: i64) -> bool {
        (slot.rem_euclid(2) == 0) == (self == TxSlot::Even)
    }
}

/// Station identity and licence. The default is unconfigured, which the gate refuses.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct StationConfig {
    /// Operator callsign. Empty = unconfigured (transmit refused).
    pub callsign: String,
    /// Maidenhead locator (4 or 6 characters). v1 transmits its 4-character square, and only if
    /// that square is in the v1 grid table.
    pub grid: String,
    /// Regulatory region. None = transmit refused.
    pub region: Option<Region>,
    /// Licence class. None = transmit refused.
    pub license_class: Option<LicenseClass>,
    /// The power the operator has SET on the radio, W. Configuration, never displayed or logged
    /// as a measurement (audit M13).
    pub configured_tx_power_w: Option<f64>,
}

/// How PTT is keyed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum PttConfig {
    /// Not configured: transmit refused.
    #[default]
    None,
    /// The radio keys on audio. Nothing to verify; the audio carrier is the key.
    Vox,
    /// CAT via rigctld (`T 1` / `T 0`).
    Cat,
    /// A serial control line.
    Serial {
        /// Port name.
        port: String,
        /// `rts` or `dtr`.
        line: SerialLine,
        /// Whether asserting the line keys (active high) or releasing it does.
        active_high: bool,
    },
    /// C-Media CM108/CM119 GPIO over HID.
    Cm108 {
        /// HID device path (empty = first CM108 found).
        device: String,
        /// GPIO number (1-8).
        pin: u8,
        /// Polarity.
        active_high: bool,
    },
}

/// RTS or DTR.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SerialLine {
    /// Request To Send.
    Rts,
    /// Data Terminal Ready.
    Dtr,
}

/// Rig control.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RigConfig {
    /// rigctld host; empty = no CAT (dial unverified, readback check does not apply).
    pub rigctld_host: String,
    /// rigctld port.
    pub rigctld_port: u16,
    /// Poll interval, ms.
    pub poll_interval_ms: u64,
}

impl Default for RigConfig {
    fn default() -> Self {
        RigConfig { rigctld_host: String::new(), rigctld_port: 4532, poll_interval_ms: crate::rig::DEFAULT_POLL_INTERVAL_MS }
    }
}

/// Audio devices.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AudioConfig {
    /// Input device name (None = system default).
    pub input_device: Option<String>,
    /// Output device name (None = system default).
    pub output_device: Option<String>,
    /// TX drive level, 0..1 of full scale.
    pub tx_level: f32,
}

/// Operating frequencies and sequencing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OperatingConfig {
    /// Dial frequency, Hz (USB).
    pub dial_hz: u64,
    /// Receive tone-0 audio frequency, Hz (the "worked" frequency AP gates on).
    pub rx_audio_hz: f64,
    /// Transmit tone-0 audio frequency, Hz.
    pub tx_audio_hz: f64,
    /// Our transmit slot parity.
    pub tx_slot: TxSlot,
    /// Advance the QSO automatically.
    pub auto_sequence: bool,
    /// Stop transmitting after this many consecutive transmissions without progress.
    pub watchdog_cycles: u32,
    /// Log a completed QSO automatically (only received/measured fields; see `qso.rs`).
    pub auto_log: bool,
}

impl Default for OperatingConfig {
    fn default() -> Self {
        OperatingConfig {
            dial_hz: 14_076_000,
            rx_audio_hz: 1250.0,
            tx_audio_hz: 1250.0,
            tx_slot: TxSlot::Even,
            auto_sequence: true,
            watchdog_cycles: 6,
            auto_log: true,
        }
    }
}

/// Receiver tuning (advanced).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReceiverConfig {
    /// Lowest audio frequency searched.
    pub band_lo_hz: f64,
    /// Highest audio frequency searched.
    pub band_hi_hz: f64,
    /// Candidates per pass.
    pub max_candidates: usize,
    /// Decode passes (1 = no SIC).
    pub passes: u8,
    /// Drift search, Hz across the frame.
    pub max_drift_hz: f64,
    /// A priori decoding. Off by default: every hypothesis is another 2^-14 roll of the CRC.
    pub ap_enabled: bool,
}

impl Default for ReceiverConfig {
    fn default() -> Self {
        let d = z30_dsp::slot::RxConfig::default();
        ReceiverConfig {
            band_lo_hz: d.band_lo_hz,
            band_hi_hz: d.band_hi_hz,
            max_candidates: d.max_candidates,
            passes: d.passes,
            max_drift_hz: d.max_drift_hz,
            ap_enabled: false,
        }
    }
}

/// Everything.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    /// Identity and licence.
    pub station: StationConfig,
    /// Frequencies and sequencing.
    pub operating: OperatingConfig,
    /// Keying.
    pub ptt: PttConfig,
    /// CAT.
    pub rig: RigConfig,
    /// Audio.
    pub audio: AudioConfig,
    /// Receiver.
    pub receiver: ReceiverConfig,
}

impl Config {
    /// The receiver configuration for `decode_slot`.
    pub fn rx_config(&self) -> z30_dsp::slot::RxConfig {
        z30_dsp::slot::RxConfig {
            band_lo_hz: self.receiver.band_lo_hz,
            band_hi_hz: self.receiver.band_hi_hz,
            max_candidates: self.receiver.max_candidates,
            passes: self.receiver.passes,
            max_drift_hz: self.receiver.max_drift_hz,
            ..Default::default()
        }
    }
}
