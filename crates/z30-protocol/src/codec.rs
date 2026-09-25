//! v1 message codec (SPEC.md section 6).
//!
//! The rule this module exists to enforce: **a message that cannot round-trip through the codec
//! exactly is never encoded.** The shipped TypeScript packer accepted anything and transmitted
//! whatever its lossy paths produced - another station's callsign (C5), another grid (H2), a
//! report without its roger (H3), free text as callsign fields (M6). Here every constructor
//! validates, every refusal says why, and `Message::encode` re-decodes its own output before
//! handing it over.
//!
//! On receive the rule runs the other way: a field value that is not the canonical encoding of
//! anything is reported as unrepresentable, never rendered as a plausible callsign or grid.

use crate::crc::{bits_to_u64, info_crc_ok};
use crate::ldpc::{encode_info, info_from_payload};
use crate::symbols::codeword_to_symbols;
use crate::{K, N, PAYLOAD_BITS, PLACEHOLDER_CALLSIGN, TOTAL_SYMBOLS};
use std::fmt;

/// Why a message, callsign, grid or report cannot be carried by v1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecError {
    /// Not a callsign of the standard `[1-2 prefix][digit][1-3 letters]` form.
    NotStandardCallsign(String),
    /// Standard form, but the packed value wraps past 2^28 (prefixes from `ZV` upward).
    CallsignOutOfRange(String),
    /// The unconfigured placeholder; transmitting it would be transmitting nobody's callsign.
    PlaceholderCallsign,
    /// Not a 4-character Maidenhead square.
    MalformedGrid(String),
    /// A valid square that is not in the 63-entry v1 grid table.
    GridNotInTable(String),
    /// A report outside -30..=+30 dB, or not a number.
    BadReport(String),
    /// `R-12` style: v1 has no roger bit.
    RogerNotRepresentable(String),
    /// Text that is not one of the message forms v1 carries.
    Unparseable(String),
    /// Encoding produced bits that do not decode to the requested message. Cannot happen for a
    /// validated message; checked anyway because the consequence would be a wrong emission.
    RoundTripFailed(String),
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use CodecError::*;
        match self {
            NotStandardCallsign(c) => write!(f, "\"{c}\" is not a callsign z-30 v1 can carry: v1 carries only a 1-2 character prefix, one digit and a 1-3 letter suffix (no /P, no compound or 3-character prefixes)"),
            CallsignOutOfRange(c) => write!(f, "\"{c}\" cannot be carried by z-30 v1: prefixes from ZV upward overflow the 28-bit field and would be transmitted as a different callsign"),
            PlaceholderCallsign => write!(f, "the callsign is still the placeholder {PLACEHOLDER_CALLSIGN}; set your own callsign"),
            MalformedGrid(g) => write!(f, "\"{g}\" is not a 4-character Maidenhead square"),
            GridNotInTable(g) => write!(f, "grid {g} is not in the 63-entry z-30 v1 grid table, so v1 cannot transmit it (the old software sent a different grid instead)"),
            BadReport(r) => write!(f, "\"{r}\" is not a signal report v1 can carry (-30 to +30 dB)"),
            RogerNotRepresentable(r) => write!(f, "\"{r}\": z-30 v1 has no roger flag; a report sent in reply to a report carries the roger by its place in the sequence"),
            Unparseable(t) => write!(f, "\"{t}\" is not a z-30 v1 message (CQ <call> <grid> | <to> <from> <grid|report|RRR|73|RR73>)"),
            RoundTripFailed(t) => write!(f, "internal error: \"{t}\" did not survive its own round trip; refusing to transmit it"),
        }
    }
}

impl std::error::Error for CodecError {}

// ---------------------------------------------------------------------------------------------
// 28-bit call field
// ---------------------------------------------------------------------------------------------

const TOKEN_CQ: u32 = 0;
const TOKEN_CQ_DX: u32 = 1;
const TOKEN_CQ_TEST: u32 = 2;
const TOKEN_QRZ: u32 = 3;
const CALL_OFFSET: u64 = 100;
const MASK28: u64 = (1 << 28) - 1;

fn p_val(c: u8) -> u64 {
    match c {
        b' ' => 0,
        b'0'..=b'9' => (c - b'0') as u64 + 1,
        _ => (c - b'A') as u64 + 11,
    }
}

fn s_val(c: u8) -> u64 {
    if c == b' ' {
        0
    } else {
        (c - b'A') as u64 + 1
    }
}

fn p_char(v: u64) -> Option<char> {
    match v {
        0 => None,
        1..=10 => Some((b'0' + (v - 1) as u8) as char),
        _ => Some((b'A' + (v - 11) as u8) as char),
    }
}

fn s_char(v: u64) -> Option<char> {
    if v == 0 {
        None
    } else {
        Some((b'A' + (v - 1) as u8) as char)
    }
}

/// Splits a standard callsign into (prefix, digit, suffix) using the reference's regex
/// `^([A-Z0-9]{1,2})([0-9])([A-Z]{1,3})$` (greedy prefix, as a regex engine would).
fn split_standard(call: &str) -> Option<(&str, u8, &str)> {
    let b = call.as_bytes();
    if !(3..=6).contains(&b.len()) || !b.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return None;
    }
    // Suffix: the trailing run of letters, 1-3 long; the character before it is the digit.
    let suffix_len = b.iter().rev().take_while(|c| c.is_ascii_uppercase()).count();
    if !(1..=3).contains(&suffix_len) {
        return None;
    }
    let digit_idx = b.len() - suffix_len - 1;
    if digit_idx == 0 || digit_idx > 2 || !b[digit_idx].is_ascii_digit() {
        return None;
    }
    Some((&call[..digit_idx], b[digit_idx] - b'0', &call[digit_idx + 1..]))
}

/// A callsign v1 can carry exactly. Construction is the validation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Callsign(String);

impl Callsign {
    /// Validates and normalises (trim, upper-case). Refuses anything that would not come back
    /// unchanged from the 28-bit field.
    pub fn new(text: &str) -> Result<Self, CodecError> {
        let call = text.trim().to_ascii_uppercase();
        if call == PLACEHOLDER_CALLSIGN {
            return Err(CodecError::PlaceholderCallsign);
        }
        let (prefix, digit, suffix) = split_standard(&call).ok_or_else(|| CodecError::NotStandardCallsign(call.clone()))?;
        let pb = prefix.as_bytes();
        let (p0, p1) = if pb.len() == 1 { (b' ', pb[0]) } else { (pb[0], pb[1]) };
        let sb = suffix.as_bytes();
        let s = |i: usize| if i < sb.len() { sb[i] } else { b' ' };
        let packed = (p_val(p0) * 37 + p_val(p1)) * 196_830
            + digit as u64 * 19_683
            + s_val(s(0)) * 729
            + s_val(s(1)) * 27
            + s_val(s(2))
            + CALL_OFFSET;
        if packed > MASK28 {
            return Err(CodecError::CallsignOutOfRange(call));
        }
        let me = Callsign(call);
        // Defence in depth: the arithmetic above is the whole rule, and this proves it.
        if unpack_call_value(packed as u32) != CallField::Call(me.clone()) {
            return Err(CodecError::NotStandardCallsign(me.0));
        }
        Ok(me)
    }

    /// The callsign text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The 28-bit field value.
    pub fn packed(&self) -> u32 {
        let (prefix, digit, suffix) = split_standard(&self.0).expect("validated at construction");
        let pb = prefix.as_bytes();
        let (p0, p1) = if pb.len() == 1 { (b' ', pb[0]) } else { (pb[0], pb[1]) };
        let sb = suffix.as_bytes();
        let s = |i: usize| if i < sb.len() { sb[i] } else { b' ' };
        ((p_val(p0) * 37 + p_val(p1)) * 196_830 + digit as u64 * 19_683 + s_val(s(0)) * 729 + s_val(s(1)) * 27 + s_val(s(2)) + CALL_OFFSET)
            as u32
    }
}

impl fmt::Display for Callsign {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a received 28-bit field holds.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CallField {
    /// `CQ`
    Cq,
    /// `CQ DX`
    CqDx,
    /// `CQ TEST`
    CqTest,
    /// `QRZ`
    Qrz,
    /// A callsign, canonically encoded.
    Call(Callsign),
    /// A value that is not the canonical encoding of any token or callsign: an old
    /// transmitter's lossy base-37 fallback, or garbage. Never shown as a callsign.
    Unrepresentable(u32),
}

impl CallField {
    /// The 28-bit value.
    pub fn packed(&self) -> u32 {
        match self {
            CallField::Cq => TOKEN_CQ,
            CallField::CqDx => TOKEN_CQ_DX,
            CallField::CqTest => TOKEN_CQ_TEST,
            CallField::Qrz => TOKEN_QRZ,
            CallField::Call(c) => c.packed(),
            CallField::Unrepresentable(v) => *v,
        }
    }

    /// The callsign, if this field is one.
    pub fn call(&self) -> Option<&Callsign> {
        match self {
            CallField::Call(c) => Some(c),
            _ => None,
        }
    }
}

impl fmt::Display for CallField {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CallField::Cq => f.write_str("CQ"),
            CallField::CqDx => f.write_str("CQ DX"),
            CallField::CqTest => f.write_str("CQ TEST"),
            CallField::Qrz => f.write_str("QRZ"),
            CallField::Call(c) => write!(f, "{c}"),
            CallField::Unrepresentable(v) => write!(f, "<?{v:07X}>"),
        }
    }
}

/// Decodes a 28-bit field. Values that do not re-encode to themselves are `Unrepresentable`.
pub fn unpack_call_value(v: u32) -> CallField {
    match v {
        TOKEN_CQ => return CallField::Cq,
        TOKEN_CQ_DX => return CallField::CqDx,
        TOKEN_CQ_TEST => return CallField::CqTest,
        TOKEN_QRZ => return CallField::Qrz,
        _ => {}
    }
    let v64 = v as u64 & MASK28;
    if v64 < CALL_OFFSET {
        return CallField::Unrepresentable(v);
    }
    let val = v64 - CALL_OFFSET;
    let s = val % 19_683;
    let rem = val / 19_683;
    let digit = rem % 10;
    let p = rem / 10;
    if p >= 37 * 37 {
        return CallField::Unrepresentable(v);
    }
    // Canonical form only: the prefix may be padded on the left, the suffix on the right, and
    // nowhere else. Anything else decodes to a string that re-encodes to a different value.
    let (pa, pb) = (p / 37, p % 37);
    let (sa, sb, sc) = (s / 729, (s % 729) / 27, s % 27);
    // A one-character prefix is padded on the left (pa = 0), never on the right, so the second
    // prefix position must hold a character. This read `pb != 0 && !(pa != 0 && pb == 0)`, the
    // same predicate, which Rust 1.95's deny-by-default `overly_complex_bool_expr` rejects:
    // clippy failed on the declared MSRV (2026-09-24 post-remediation audit, N-02).
    let canonical_prefix = pb != 0;
    let canonical_suffix = sa != 0 && !(sb == 0 && sc != 0);
    if !canonical_prefix || !canonical_suffix {
        return CallField::Unrepresentable(v);
    }
    let mut text = String::new();
    text.extend(p_char(pa));
    text.extend(p_char(pb));
    text.push((b'0' + digit as u8) as char);
    text.extend(s_char(sa));
    text.extend(s_char(sb));
    text.extend(s_char(sc));
    match split_standard(&text) {
        Some((prefix, _, _)) if prefix.len() == (pa != 0) as usize + 1 => CallField::Call(Callsign(text)),
        _ => CallField::Unrepresentable(v),
    }
}

// ---------------------------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------------------------

/// The 63-entry v1 grid table (SPEC.md 6.2). Code = 64 + index.
pub const GRID_TABLE: [&str; 63] = [
    "FN31", "FN20", "FN30", "FM19", "FM29", "EM00", "EM10", "EM29", "EM79", "EL98", "EL89", "DM79", "DM04", "DM13", "CM87", "CM97", "CN87",
    "CN88", "IO91", "IO82", "IO92", "IO93", "JO21", "JO31", "JO22", "JO32", "JN88", "JN58", "JN48", "JN65", "PM95", "PM85", "PM74", "QM05",
    "QM06", "QF22", "QF56", "QF57", "RE78", "GG87", "GF05", "FF49", "KG46", "KF29", "OL93", "NL18", "OF78", "NF48", "PF95", "KO85", "KO94",
    "KP04", "KP15", "KP20", "KN87", "KN99", "KM17", "KM68", "KL78", "BL11", "BK29", "AJ81", "AH21",
];

/// A 4-character Maidenhead square, syntactically valid (not necessarily in the v1 table).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Grid4(String);

impl Grid4 {
    /// Validates `[A-R][A-R][0-9][0-9]` (upper-cased). A 6-character locator is refused here;
    /// the caller decides whether sending its square is what the operator meant.
    pub fn new(text: &str) -> Result<Self, CodecError> {
        let g = text.trim().to_ascii_uppercase();
        let b = g.as_bytes();
        let ok = b.len() == 4
            && (b'A'..=b'R').contains(&b[0])
            && (b'A'..=b'R').contains(&b[1])
            && b[2].is_ascii_digit()
            && b[3].is_ascii_digit();
        if ok {
            Ok(Grid4(g))
        } else {
            Err(CodecError::MalformedGrid(g))
        }
    }

    /// The square's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The v1 extra-field code, if the table carries this square.
    pub fn v1_code(&self) -> Option<u8> {
        GRID_TABLE.iter().position(|&g| g == self.0).map(|i| 64 + i as u8)
    }
}

impl fmt::Display for Grid4 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// ---------------------------------------------------------------------------------------------
// 7-bit extra field
// ---------------------------------------------------------------------------------------------

/// What the 7-bit extra field holds.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Extra {
    /// Signal report, dB, -30..=30.
    Report(i8),
    /// `RRR`
    Rrr,
    /// `73`
    SeventyThree,
    /// `RR73`
    Rr73,
    /// A grid from the v1 table.
    Grid(Grid4),
    /// Code 127: unassigned in v1. Only ever produced by decoding.
    Unassigned,
}

impl Extra {
    /// A report, refused outside the range v1 carries (the old packer clamped).
    pub fn report(db: i32) -> Result<Self, CodecError> {
        if (-30..=30).contains(&db) {
            Ok(Extra::Report(db as i8))
        } else {
            Err(CodecError::BadReport(db.to_string()))
        }
    }

    /// A grid, refused unless it is in the v1 table (the old packer hashed it onto the table).
    pub fn grid(g: &Grid4) -> Result<Self, CodecError> {
        g.v1_code().map(|_| Extra::Grid(g.clone())).ok_or_else(|| CodecError::GridNotInTable(g.0.clone()))
    }

    /// The 7-bit code.
    pub fn code(&self) -> u8 {
        match self {
            Extra::Report(db) => (*db as i16 + 30) as u8,
            Extra::Rrr => 61,
            Extra::SeventyThree => 62,
            Extra::Rr73 => 63,
            Extra::Grid(g) => g.v1_code().expect("validated at construction"),
            Extra::Unassigned => 127,
        }
    }

    /// Decodes a 7-bit code.
    pub fn from_code(code: u8) -> Extra {
        match code & 0x7F {
            c @ 0..=60 => Extra::Report(c as i8 - 30),
            61 => Extra::Rrr,
            62 => Extra::SeventyThree,
            63 => Extra::Rr73,
            127 => Extra::Unassigned,
            c => Extra::Grid(Grid4(GRID_TABLE[(c - 64) as usize].to_string())),
        }
    }
}

impl fmt::Display for Extra {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Extra::Report(db) => write!(f, "{}{:02}", if *db >= 0 { '+' } else { '-' }, db.unsigned_abs()),
            Extra::Rrr => f.write_str("RRR"),
            Extra::SeventyThree => f.write_str("73"),
            Extra::Rr73 => f.write_str("RR73"),
            Extra::Grid(g) => write!(f, "{g}"),
            Extra::Unassigned => f.write_str("<?127>"),
        }
    }
}

fn parse_extra(tok: &str) -> Result<Extra, CodecError> {
    match tok {
        "RRR" => return Ok(Extra::Rrr),
        "73" => return Ok(Extra::SeventyThree),
        "RR73" => return Ok(Extra::Rr73),
        _ => {}
    }
    if (tok.starts_with("R-") || tok.starts_with("R+")) && tok[1..].parse::<i32>().is_ok() {
        return Err(CodecError::RogerNotRepresentable(tok.to_string()));
    }
    let first = tok.as_bytes().first().copied().unwrap_or(b' ');
    if first == b'-' || first == b'+' || first.is_ascii_digit() {
        let v: i32 = tok.parse().map_err(|_| CodecError::BadReport(tok.to_string()))?;
        return Extra::report(v).map_err(|_| CodecError::BadReport(tok.to_string()));
    }
    if tok.len() == 4 {
        let g = Grid4::new(tok)?;
        return Extra::grid(&g);
    }
    Err(CodecError::Unparseable(tok.to_string()))
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

/// A 63-bit payload as its three fields, exactly as received. May hold unrepresentable values.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DecodedMessage {
    /// Field 1 (bits 0-27).
    pub to: CallField,
    /// Field 2 (bits 28-55).
    pub from: CallField,
    /// Field 3 (bits 56-62).
    pub extra: Extra,
}

impl DecodedMessage {
    /// Whether every field is the canonical encoding of something v1 defines and the result is
    /// a message form v1 would encode.
    pub fn to_message(&self) -> Option<Message> {
        let from = self.from.call()?.clone();
        let msg = Message { to: self.to.clone(), from, extra: self.extra.clone() };
        msg.validate().ok()?;
        Some(msg)
    }

    /// Whether the message is addressed to `call` - exact match, not a substring (the shipped
    /// `isMyCall` matched K1AB inside K1ABC, audit M7).
    pub fn is_addressed_to(&self, call: &Callsign) -> bool {
        self.to.call() == Some(call)
    }
}

impl fmt::Display for DecodedMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} {}", self.to, self.from, self.extra)
    }
}

/// A message v1 can carry exactly.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Message {
    /// Addressee: a callsign or a token.
    pub to: CallField,
    /// Sender.
    pub from: Callsign,
    /// Grid, report or acknowledgement.
    pub extra: Extra,
}

/// A message encoded into its bits and channel symbols, NOT yet proven to read back as itself.
///
/// This is a candidate, not something that can be transmitted: nothing in the transmit path
/// accepts it. `verify` turns it into a [`VerifiedFrame`], which is the only thing the
/// transmitter modulates. The fields are public so that a test (or an auditor) can build a
/// corrupted candidate and watch the verification refuse it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedMessage {
    /// The message.
    pub message: Message,
    /// 77 information bits.
    pub info: [u8; K],
    /// 216 codeword bits.
    pub codeword: [u8; N],
    /// 75 channel symbols.
    pub symbols: [u8; TOTAL_SYMBOLS],
}

impl Message {
    /// `CQ <from> <grid>`.
    pub fn cq(from: Callsign, grid: &Grid4) -> Result<Self, CodecError> {
        Ok(Message { to: CallField::Cq, from, extra: Extra::grid(grid)? })
    }

    /// `<to> <from> <extra>`.
    pub fn directed(to: Callsign, from: Callsign, extra: Extra) -> Result<Self, CodecError> {
        let m = Message { to: CallField::Call(to), from, extra };
        m.validate()?;
        Ok(m)
    }

    fn validate(&self) -> Result<(), CodecError> {
        match (&self.to, &self.extra) {
            (CallField::Unrepresentable(v), _) => Err(CodecError::Unparseable(format!("<?{v:07X}>"))),
            (_, Extra::Unassigned) => Err(CodecError::Unparseable("<?127>".into())),
            // The enum's variants are public, so a caller can build these without going through
            // `Extra::grid` / `Extra::report`; refuse them here rather than panic in `code()` on
            // the way to the transmitter.
            (_, Extra::Grid(g)) if g.v1_code().is_none() => Err(CodecError::GridNotInTable(g.to_string())),
            (_, Extra::Report(db)) if !(-30..=30).contains(db) => Err(CodecError::BadReport(db.to_string())),
            // A CQ carries a grid; the reference unpacker renders any other extra on a CQ as a
            // grid, so anything else would be displayed as something that was not sent.
            (CallField::Cq | CallField::CqDx | CallField::CqTest, e) if !matches!(e, Extra::Grid(_)) => {
                Err(CodecError::Unparseable(format!("{} {} {}", self.to, self.from, self.extra)))
            }
            _ => Ok(()),
        }
    }

    /// Parses operator text. Accepts exactly the forms in SPEC.md 6.3 and refuses the rest with
    /// the reason.
    pub fn parse(text: &str) -> Result<Self, CodecError> {
        let upper = text.trim().to_ascii_uppercase();
        let toks: Vec<&str> = upper.split_whitespace().collect();
        let (to, rest): (CallField, &[&str]) = match toks.as_slice() {
            ["CQ", "DX", rest @ ..] => (CallField::CqDx, rest),
            ["CQ", "TEST", rest @ ..] => (CallField::CqTest, rest),
            ["CQ", rest @ ..] => (CallField::Cq, rest),
            ["QRZ", rest @ ..] => (CallField::Qrz, rest),
            [to, rest @ ..] => (CallField::Call(Callsign::new(to)?), rest),
            [] => return Err(CodecError::Unparseable(upper)),
        };
        let [from, extra] = rest else { return Err(CodecError::Unparseable(upper)) };
        let m = Message { to, from: Callsign::new(from)?, extra: parse_extra(extra)? };
        m.validate()?;
        Ok(m)
    }

    /// The 63 payload bits.
    pub fn payload(&self) -> [u8; PAYLOAD_BITS] {
        let mut out = [0u8; PAYLOAD_BITS];
        let put = |out: &mut [u8], off: usize, width: usize, v: u64| {
            for i in 0..width {
                out[off + i] = ((v >> (width - 1 - i)) & 1) as u8;
            }
        };
        put(&mut out, 0, 28, self.to.packed() as u64);
        put(&mut out, 28, 28, self.from.packed() as u64);
        put(&mut out, 56, 7, self.extra.code() as u64);
        out
    }

    /// Payload, CRC, LDPC codeword and channel symbols, for a message that passes `validate`.
    /// The result is an unverified candidate; [`Message::frame`] is encode-then-verify, and is
    /// what anything that emits a waveform calls.
    ///
    /// This used to re-decode its own payload here as well. That comparison is now made by
    /// `EncodedMessage::verify_round_trip`, from the channel symbols rather than from the
    /// payload, on every frame that can reach a transmitter - so a second, weaker copy of it
    /// here could be deleted without any test noticing (2026-09-24 post-remediation audit,
    /// mutation C06-c), which is what an unprotected safety check looks like.
    pub fn encode(&self) -> Result<EncodedMessage, CodecError> {
        self.validate()?;
        let info = info_from_payload(&self.payload());
        let codeword = encode_info(&info);
        Ok(EncodedMessage { message: self.clone(), info, codeword, symbols: codeword_to_symbols(&codeword) })
    }

    /// Encodes and verifies: the frame a transmitter may modulate, or the reason there is none.
    pub fn frame(&self) -> Result<VerifiedFrame, CodecError> {
        self.encode()?.verify()
    }
}

impl EncodedMessage {
    /// Proves the emission says what it claims, the way a receiver would read it: the 75
    /// channel symbols carry the Costas pattern, their data symbols demap to a codeword that
    /// satisfies every parity check, its systematic bits pass the CRC and unpack to exactly
    /// `self.message`, and the message's own text parses back to the same message. The
    /// transmit gate runs this on every frame (2026-09-24 audit, C-06: the legacy packer
    /// transmitted FN42 as RE78 and replied to ZY2ABC as 24BWE, and its gate checked only the
    /// station's own callsign).
    ///
    /// Finally the frame is rebuilt from the message alone and must be identical, symbol for
    /// symbol, to the one being checked: a frame that decodes correctly but is not the one v1
    /// defines for this message (a stale or foreign codeword that happens to share its fields)
    /// is refused too.
    pub fn verify_round_trip(&self) -> Result<(), CodecError> {
        let fail = || CodecError::RoundTripFailed(self.message.to_string());
        if crate::SYNC_POSITIONS.iter().zip(crate::SYNC_TONES.iter()).any(|(&p, &t)| self.symbols[p] != t) {
            return Err(fail());
        }
        if self.symbols.iter().any(|&t| t as usize >= crate::NUM_TONES) {
            return Err(fail());
        }
        let cw = crate::symbols::symbols_to_codeword(&self.symbols);
        if cw != self.codeword || cw[..K] != self.info || crate::ldpc::syndrome_weight(&cw) != 0 {
            return Err(fail());
        }
        let decoded = unpack_info(&cw[..K]).ok_or_else(fail)?;
        if decoded.to_message().as_ref() != Some(&self.message) {
            return Err(fail());
        }
        if Message::parse(&self.message.to_string()).as_ref() != Ok(&self.message) {
            return Err(fail());
        }
        let canonical = codeword_to_symbols(&encode_info(&info_from_payload(&self.message.payload())));
        if canonical != self.symbols {
            return Err(fail());
        }
        Ok(())
    }

    /// Proves the round trip and returns the frame as transmittable. Consumes the candidate, so
    /// what was checked is what is sent: the verified frame cannot be changed afterwards.
    pub fn verify(self) -> Result<VerifiedFrame, CodecError> {
        self.verify_round_trip()?;
        Ok(VerifiedFrame(self))
    }
}

/// A frame that has passed [`EncodedMessage::verify_round_trip`]: its 75 symbols carry the
/// Costas pattern, demap to a codeword with a zero syndrome whose CRC passes and whose fields
/// unpack to exactly `message()`, and are the symbols v1 defines for that message.
///
/// The transmit path accepts only this type (`z30_engine::txgate::Permission::frame`,
/// `z30_engine::engine::TxKind::Frame`), and the only way to make one is `verify`. So a
/// transmission of an unverified frame is not a missing `if`, it does not compile - and a
/// `verify_round_trip` that stopped checking is caught by the corrupted-frame tests
/// (`tests/round_trip.rs`, and z30-engine's `tests/safety.rs` through the transmit gate).
/// Before this type existed, three mutations that switched the round trip off survived the
/// whole test suite (2026-09-24 post-remediation audit, C06-a/b/c).
///
/// ```compile_fail
/// // There is no way to build a VerifiedFrame outside this module without verifying.
/// let m = z30_protocol::codec::Message::parse("CQ K1ABC FN31").unwrap();
/// let f = z30_protocol::codec::VerifiedFrame(m.encode().unwrap());
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedFrame(EncodedMessage);

impl VerifiedFrame {
    /// The message the frame carries.
    pub fn message(&self) -> &Message {
        &self.0.message
    }

    /// The 75 channel symbols, Costas included, in transmission order.
    pub fn symbols(&self) -> &[u8; TOTAL_SYMBOLS] {
        &self.0.symbols
    }

    /// The whole verified encoding (read-only).
    pub fn encoded(&self) -> &EncodedMessage {
        &self.0
    }
}

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} {}", self.to, self.from, self.extra)
    }
}

/// Splits a 63-bit payload into its fields.
pub fn unpack_payload(payload: &[u8]) -> DecodedMessage {
    DecodedMessage {
        to: unpack_call_value(bits_to_u64(&payload[0..28]) as u32),
        from: unpack_call_value(bits_to_u64(&payload[28..56]) as u32),
        extra: Extra::from_code(bits_to_u64(&payload[56..63]) as u8),
    }
}

/// Unpacks 77 information bits, or `None` if the CRC does not match.
pub fn unpack_info(info: &[u8]) -> Option<DecodedMessage> {
    info_crc_ok(info).then(|| unpack_payload(&info[..PAYLOAD_BITS]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_c5_callsigns_are_refused() {
        assert!(matches!(Callsign::new("ZY2ABC"), Err(CodecError::CallsignOutOfRange(_))));
        assert!(matches!(Callsign::new("ZV1A"), Err(CodecError::CallsignOutOfRange(_))));
        assert!(Callsign::new("ZU1AB").is_ok());
        assert!(matches!(Callsign::new("G4XYZ/P"), Err(CodecError::NotStandardCallsign(_))));
        assert!(matches!(Callsign::new("EA8/G4XYZ"), Err(CodecError::NotStandardCallsign(_))));
        assert!(matches!(Callsign::new("3DA0XYZ"), Err(CodecError::NotStandardCallsign(_))));
        assert!(matches!(Callsign::new("K1ABCD"), Err(CodecError::NotStandardCallsign(_))));
        assert!(matches!(Callsign::new("NOCAL"), Err(CodecError::PlaceholderCallsign)));
    }

    #[test]
    fn audit_h2_h3_m6_are_refused_not_transformed() {
        assert!(matches!(Message::parse("CQ W1AW FN42"), Err(CodecError::GridNotInTable(_))));
        assert!(matches!(Message::parse("K1ABC W1AW R-12"), Err(CodecError::RogerNotRepresentable(_))));
        assert!(matches!(Message::parse("K1ABC W1AW -35"), Err(CodecError::BadReport(_))));
        assert!(Message::parse("K1ABC W1AW HELLO").is_err());
        assert!(Message::parse("K1ABC W1AW").is_err());
        assert!(Message::parse("W1AW").is_err());
        assert!(Message::parse("CQ W1AW").is_err());
        assert!(Message::parse("K1ABC W1AW -X").is_err());
    }

    #[test]
    fn exhaustive_canonical_decode_round_trip() {
        // Every 28-bit value either decodes to a token/callsign that re-encodes to exactly that
        // value, or is reported unrepresentable. Sampled with a stride that visits every
        // residue class of the suffix, digit and prefix positions.
        let mut v: u64 = 0;
        let mut calls = 0usize;
        while v <= MASK28 {
            match unpack_call_value(v as u32) {
                CallField::Call(c) => {
                    calls += 1;
                    assert_eq!(c.packed() as u64, v);
                    assert_eq!(Callsign::new(c.as_str()).unwrap(), c);
                }
                CallField::Unrepresentable(x) => assert_eq!(x as u64, v),
                t => assert_eq!(t.packed() as u64, v),
            }
            v += 7919;
        }
        assert!(calls > 1000);
    }

    #[test]
    fn display_is_canonical() {
        assert_eq!(Message::parse("k1abc w1aw 5").unwrap().to_string(), "K1ABC W1AW +05");
        assert_eq!(Message::parse("K1ABC W1AW -05").unwrap().to_string(), "K1ABC W1AW -05");
        assert_eq!(Message::parse("CQ DX G4XYZ IO91").unwrap().to_string(), "CQ DX G4XYZ IO91");
    }
}
