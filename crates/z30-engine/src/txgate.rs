//! The transmit gate: the single check in front of every transmit path (sequencer, manual TX,
//! tune). A port of `canTransmit()` in `src/dsp/catController.ts`, with its rules kept and three
//! added (each only ever adds a refusal):
//!
//! - the callsign must be one v1 can carry exactly (audit C5);
//! - the frame to be sent must encode, must read back - symbols, parity, CRC, fields and text -
//!   as exactly the message requested (partner callsign and grid included), and must be sent
//!   FROM this station. The verified frame is handed out in the `Permission` and is the only
//!   thing the transmitter modulates (`TxKind::Frame` holds a `VerifiedFrame`, which only
//!   `EncodedMessage::verify` can create), so a frame nobody verified cannot be transmitted;
//! - a radio that reports an operating mode other than USB is refused: the emission check
//!   assumes the audio is transmitted as upper sideband (2026-09-24 audit, L-07);
//! - the emission is checked at its measured -40 dB width around the real tone span, not as a
//!   50 Hz block centred on tone 0.
//!
//! It fails closed and returns every violation, never a partial `allowed`.

use crate::bandplan::{find_permitted_segment, is_valid_callsign, nearest_permitted_segment};
use crate::config::StationConfig;
use crate::rig::{DialDisagreement, RigStateTracker};
use std::fmt;
use z30_protocol::codec::{CallField, Callsign, CodecError, EncodedMessage, Message, VerifiedFrame};
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
    /// The radio reports an operating mode in which the emission would not be the one checked.
    RigModeNotUsb(String),
    /// The frame offered for transmission is not the frame of the requested message.
    FrameNotForMessage,
    /// The message cannot be carried exactly.
    MessageNotEncodable(CodecError),
    /// The message's sender field is not this station.
    MessageNotFromStation(String),
    /// No keying method is configured.
    PttNotConfigured,
    /// The transmit hardware (audio output, keying line) could not be opened.
    HardwareUnavailable(String),
    /// The transmit audio level is zero: the transmitter would be keyed with no signal.
    TxAudioLevelZero,
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
            FrequencyUndetermined => write!(f, "The transmit frequency could not be determined: no dial frequency is set (Settings: dial), or the dial or audio offset is not a usable number."),
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
            RigModeNotUsb(m) => write!(f, "The radio reports mode {m}. z-30 checks its emission as upper sideband (USB or PKTUSB); in any other mode the frequencies radiated are not the ones checked. Set the radio to USB."),
            FrameNotForMessage => write!(f, "internal error: the frame offered for transmission is not the requested message's; refusing to transmit it"),
            MessageNotEncodable(e) => write!(f, "The message cannot be sent: {e}"),
            MessageNotFromStation(c) => write!(f, "The message is sent from {c}, not from this station's callsign."),
            PttNotConfigured => write!(f, "No PTT method is configured (Settings: PTT)."),
            HardwareUnavailable(why) => write!(f, "Transmit hardware unavailable: {why}"),
            TxAudioLevelZero => write!(f, "The transmit audio level is 0 (Settings: TX level): the radio would be keyed with no signal."),
        }
    }
}

/// The gate's answer.
#[derive(Clone, Debug, PartialEq)]
pub struct Permission {
    /// True only if every condition passed and, for a frame, the verified frame is present.
    pub allowed: bool,
    /// The frame that passed the round trip, for a message request that was allowed. This, not
    /// a re-encoding, is what the transmitter sends: before it existed `plan_tx` encoded the
    /// message a second time after the gate had passed (2026-09-24 post-remediation audit,
    /// N-03), so what was verified and what was keyed were two different objects.
    pub frame: Option<VerifiedFrame>,
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
    /// The dial the emission is checked at, Hz (NaN when none is set: refused).
    pub dial_hz: f64,
    /// Tone-0 audio frequency, Hz.
    pub tx_audio_hz: f64,
    /// The frame, or None for a tune carrier (at tone 0... the whole span is checked anyway).
    pub message: Option<&'a Message>,
}

/// Upper-sideband mode names as Hamlib reports them. The emission is dial + audio only in these.
pub const USB_MODES: [&str; 2] = ["USB", "PKTUSB"];

/// Runs every check. `now_ms` is the rig tracker's clock. For a message, the frame checked is
/// `Message::encode`'s, and it is returned in `Permission::frame` when allowed.
pub fn can_transmit(req: &TxRequest<'_>, rig: &RigStateTracker, now_ms: u64) -> Permission {
    can_transmit_encoded(req, req.message.map(Message::encode), rig, now_ms)
}

/// The gate for an already-encoded candidate frame: `can_transmit` with the encoding step
/// taken out, so a test can hand the gate a frame the real encoder would never produce and
/// see it refused. `candidate` must be the encoding of `req.message` (None for a tune).
pub fn can_transmit_encoded(
    req: &TxRequest<'_>,
    candidate: Option<Result<EncodedMessage, CodecError>>,
    rig: &RigStateTracker,
    now_ms: u64,
) -> Permission {
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
                    nearest: nearest_permitted_segment(r, c, centre)
                        .map(|(s, d)| (format!("{} {:.3}-{:.3} MHz", s.band, s.start_hz as f64 / 1e6, s.end_hz as f64 / 1e6), d)),
                }),
            }
        }
    }

    // What the radio says, when it can be asked. Adds refusals only on positive evidence.
    if let Some(d) = rig.dial_disagreement(req.dial_hz, now_ms) {
        v.push(Violation::RigDialDisagrees(d));
    }

    if let Some(mode) = rig.fresh_reported_mode(now_ms) {
        if !USB_MODES.contains(&mode.trim().to_ascii_uppercase().as_str()) {
            v.push(Violation::RigModeNotUsb(mode.to_string()));
        }
    }

    let mut frame = None;
    match (req.message, candidate) {
        (None, None) => {}
        (None, Some(_)) => v.push(Violation::FrameNotForMessage),
        (Some(m), candidate) => {
            // The whole frame, not just our callsign: read back symbol by symbol as a receiver
            // would. A frame that does not come back as this exact message - partner call,
            // grid, report and all - is refused (audit C-06), and only a frame that does is
            // handed on to be transmitted.
            match candidate.unwrap_or_else(|| m.encode()).and_then(EncodedMessage::verify) {
                Ok(f) if f.message() == m => frame = Some(f),
                Ok(_) => v.push(Violation::FrameNotForMessage),
                Err(e) => v.push(Violation::MessageNotEncodable(e)),
            }
        }
    }

    if let Some(m) = req.message {
        if my_call.as_ref() != Some(&m.from) {
            v.push(Violation::MessageNotFromStation(m.from.to_string()));
        }
        if let CallField::Unrepresentable(_) = m.to {
            v.push(Violation::MessageNotEncodable(CodecError::Unparseable(m.to_string())));
        }
    }

    // Fails closed twice: a violation refuses, and so does a message request with no verified
    // frame, whatever the list says.
    let allowed = v.is_empty() && frame.is_some() == req.message.is_some();
    Permission { allowed, frame: frame.filter(|_| allowed), violations: v, tx_centre_hz: tx_centre, segment }
}
