//! The transmit gate: the single check in front of every transmit path (sequencer, manual TX,
//! tune). A port of `canTransmit()` in `src/dsp/catController.ts`, with its rules kept and three
//! added (each only ever adds a refusal):
//!
//! - the callsign must be one v1 can carry exactly (audit C5);
//! - the frame to be sent must encode and round-trip, and must be sent FROM this station;
//! - the emission is checked at its measured -40 dB width around the real tone span, not as a
//!   50 Hz block centred on tone 0.
//!
//! It fails closed and returns every violation, never a partial `allowed`.

use crate::bandplan::{find_permitted_segment, is_valid_callsign, nearest_permitted_segment};
use crate::config::StationConfig;
use crate::rig::{DialDisagreement, RigStateTracker};
use std::fmt;
use z30_protocol::codec::{CallField, Callsign, CodecError, Message};
use z30_protocol::{NUM_TONES, PLACEHOLDER_CALLSIGN, TONE_SPACING_HZ};

/// -40 dB occupied bandwidth of the GFSK frame, Hz (tests/test_modem_spectrum.py measures 66).
pub const OCCUPIED_40DB_HZ: f64 = 66.0;
/// Lowest tone-0 audio frequency the transmitter will use.
pub const MIN_TX_AUDIO_HZ: f64 = 200.0;
/// Highest tone-15 audio frequency the transmitter will use.
pub const MAX_TX_AUDIO_TOP_HZ: f64 = 2800.0;

/// One reason not to transmit.
#[derive(Clone, Debug, PartialEq)]
pub enum Violation {
    /// No callsign.
    NoCallsign,
    /// The shipped placeholder.
    PlaceholderCallsign,
    /// Structurally invalid.
    MalformedCallsign(String),
    /// Valid, but v1 would transmit a different callsign.
    CallsignNotRepresentable(String, CodecError),
    /// No region.
    NoRegion,
    /// No licence class.
    NoLicenseClass,
    /// Class not valid in region.
    ClassNotInRegion,
    /// Dial or audio frequency unusable.
    FrequencyUndetermined,
    /// Audio offset outside the transmitter's range.
    AudioOffsetOutOfRange(f64),
    /// Emission outside every permitted segment.
    OutOfBand {
        /// Lower emission edge, Hz.
        low_hz: f64,
        /// Upper emission edge, Hz.
        high_hz: f64,
        /// Nearest permitted segment and distance.
        nearest: Option<(String, f64)>,
    },
    /// The radio reports a different dial than the one checked.
    RigDialDisagrees(DialDisagreement),
    /// The message cannot be carried exactly.
    MessageNotEncodable(CodecError),
    /// The message's sender field is not this station.
    MessageNotFromStation(String),
}

impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use Violation::*;
        match self {
            NoCallsign => write!(f, "No callsign is configured. Enter your callsign in Settings before transmitting."),
            PlaceholderCallsign => write!(f, "The callsign is still the placeholder {PLACEHOLDER_CALLSIGN}. Set your own callsign - transmitting under another station's call is not yours to do."),
            MalformedCallsign(c) => write!(f, "\"{c}\" is not a syntactically valid amateur callsign."),
            CallsignNotRepresentable(c, e) => write!(f, "\"{c}\" cannot be transmitted by z-30 v1 without becoming a different callsign: {e}"),
            NoRegion => write!(f, "No regulatory region is configured."),
            NoLicenseClass => write!(f, "No licence class is configured."),
            ClassNotInRegion => write!(f, "The licence class does not apply in the configured region."),
            FrequencyUndetermined => write!(f, "The transmit frequency could not be determined from the dial frequency and audio offset."),
            AudioOffsetOutOfRange(hz) => write!(f, "Transmit audio frequency {hz:.0} Hz is outside {MIN_TX_AUDIO_HZ:.0}-{MAX_TX_AUDIO_TOP_HZ:.0} Hz."),
            OutOfBand { low_hz, high_hz, nearest } => {
                write!(f, "{:.6}-{:.6} MHz is not inside any data segment available to this licence.", low_hz / 1e6, high_hz / 1e6)?;
                if let Some((band, d)) = nearest {
                    if *d == 0.0 {
                        write!(f, " The emission straddles the edge of {band}.")
                    } else {
                        write!(f, " The nearest permitted segment is {band}, {:.1} kHz away.", d / 1e3)
                    }
                } else {
                    Ok(())
                }
            }
            RigDialDisagrees(d) => write!(
                f,
                "The radio reports its dial at {:.6} MHz, but this transmission was checked against {:.6} MHz ({:.3} kHz away). Re-send the frequency, or check rig control.",
                d.reported_hz / 1e6,
                d.commanded_hz / 1e6,
                d.error_hz / 1e3
            ),
            MessageNotEncodable(e) => write!(f, "The message cannot be sent: {e}"),
            MessageNotFromStation(c) => write!(f, "The message is sent from {c}, not from this station's callsign."),
        }
    }
}

/// The gate's answer.
#[derive(Clone, Debug, PartialEq)]
pub struct Permission {
    /// True only if every condition passed.
    pub allowed: bool,
    /// Every failed condition, in check order.
    pub violations: Vec<Violation>,
    /// Centre of the emission, Hz, when computable.
    pub tx_centre_hz: Option<f64>,
    /// Permitted segment containing it.
    pub segment: Option<&'static str>,
}

/// What is about to be transmitted.
pub struct TxRequest<'a> {
    /// Station identity and licence.
    pub station: &'a StationConfig,
    /// The dial this software commanded, Hz.
    pub dial_hz: f64,
    /// Tone-0 audio frequency, Hz.
    pub tx_audio_hz: f64,
    /// The frame, or None for a tune carrier (at tone 0... the whole span is checked anyway).
    pub message: Option<&'a Message>,
}

/// Runs every check. `now_ms` is the rig tracker's clock.
pub fn can_transmit(req: &TxRequest<'_>, rig: &RigStateTracker, now_ms: u64) -> Permission {
    let mut v = Vec::new();
    let call = req.station.callsign.trim().to_ascii_uppercase();
    let mut my_call: Option<Callsign> = None;
    if call.is_empty() {
        v.push(Violation::NoCallsign);
    } else if call == PLACEHOLDER_CALLSIGN {
        v.push(Violation::PlaceholderCallsign);
    } else if !is_valid_callsign(&call) {
        v.push(Violation::MalformedCallsign(call.clone()));
    } else {
        match Callsign::new(&call) {
            Ok(c) => my_call = Some(c),
            Err(e) => v.push(Violation::CallsignNotRepresentable(call.clone(), e)),
        }
    }

    let (region, class) = (req.station.region, req.station.license_class);
    if region.is_none() {
        v.push(Violation::NoRegion);
    }
    match (region, class) {
        (_, None) => v.push(Violation::NoLicenseClass),
        (Some(r), Some(c)) if !r.license_classes().contains(&c) => v.push(Violation::ClassNotInRegion),
        _ => {}
    }

    let mut tx_centre = None;
    let mut segment = None;
    let span = (NUM_TONES - 1) as f64 * TONE_SPACING_HZ;
    if !req.dial_hz.is_finite() || req.dial_hz <= 0.0 || !req.tx_audio_hz.is_finite() {
        v.push(Violation::FrequencyUndetermined);
    } else {
        if req.tx_audio_hz < MIN_TX_AUDIO_HZ || req.tx_audio_hz + span > MAX_TX_AUDIO_TOP_HZ {
            v.push(Violation::AudioOffsetOutOfRange(req.tx_audio_hz));
        }
        let centre = req.dial_hz + req.tx_audio_hz + span / 2.0;
        tx_centre = Some(centre);
        if let (Some(r), Some(c)) = (region, class) {
            match find_permitted_segment(r, c, centre, OCCUPIED_40DB_HZ) {
                Some(s) => segment = Some(s.band),
                None => v.push(Violation::OutOfBand {
                    low_hz: centre - OCCUPIED_40DB_HZ / 2.0,
                    high_hz: centre + OCCUPIED_40DB_HZ / 2.0,
                    nearest: nearest_permitted_segment(r, c, centre).map(|(s, d)| (format!("{} {:.3}-{:.3} MHz", s.band, s.start_hz as f64 / 1e6, s.end_hz as f64 / 1e6), d)),
                }),
            }
        }
    }

    // What the radio says, when it can be asked. Adds refusals only on positive evidence.
    if let Some(d) = rig.dial_disagreement(req.dial_hz, now_ms) {
        v.push(Violation::RigDialDisagrees(d));
    }

    if let Some(m) = req.message {
        if let Err(e) = m.encode() {
            v.push(Violation::MessageNotEncodable(e));
        }
        if my_call.as_ref() != Some(&m.from) {
            v.push(Violation::MessageNotFromStation(m.from.to_string()));
        }
        if let CallField::Unrepresentable(_) = m.to {
            v.push(Violation::MessageNotEncodable(CodecError::Unparseable(m.to_string())));
        }
    }

    Permission { allowed: v.is_empty(), violations: v, tx_centre_hz: tx_centre, segment }
}
