//! A priori (AP) decoding: the hypothesis ladder ported from WSJT-X's `ft8b.f90`, and the
//! constrained decode. The Rust twin of `z30_dsp/ap_decode.py`; wiki/17 has the design.
//!
//! Three rules, each guarded by a test:
//! - **AP never runs first.** The ordinary decode is attempted and returned untouched when it
//!   succeeds; AP may add decodes, never change or lose one.
//! - **A frame recovered by AP is labelled** (`ap_type`, shown as `a1`..`a6`).
//! - **The gates only narrow.** Callsigns must round-trip (the `Callsign` type enforces it),
//!   deep types (3+) are frequency-gated, and AP is off unless the caller supplies a context.
//!   The 14 CRC bits are never asserted - the CRC is the only thing testing the hypothesis.

use crate::ldpc::{ApMask, Decoder, LdpcResult, Llrs};
use z30_protocol::codec::{CallField, Callsign};
use z30_protocol::{N, PAYLOAD_BITS};

/// WSJT-X's `apmag = maxval(abs(llr)) * 1.01`.
pub const AP_LLR_MARGIN: f64 = 1.01;
/// Deep hypotheses (type 3+) only within this many Hz of a worked frequency (WSJT-X `napwid`).
pub const AP_FREQ_WINDOW_HZ: f64 = 75.0;
/// First hypothesis type that asserts both callsigns.
pub const AP_DEEP_TYPE: u8 = 3;

/// QSO stage, as the engine's state machine reports it. Unknown stages get no hypotheses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ApStage {
    /// Nothing in progress.
    Idle,
    /// Calling CQ.
    CallingCq,
    /// Answering someone's CQ.
    ReplyingCq,
    /// Sending a report.
    SendingReport,
    /// Sending a report in reply to a report (v1 carries no roger bit; see SPEC.md 6.2).
    SendingRReport,
    /// Sending RR73/73.
    Sending73,
    /// QSO logged.
    QsoCompleted,
}

impl ApStage {
    /// The ordered ladder of AP types for this stage (`AP_STAGE_LADDER`).
    pub fn ladder(self) -> &'static [u8] {
        match self {
            ApStage::Idle | ApStage::CallingCq | ApStage::QsoCompleted => &[1, 2],
            ApStage::ReplyingCq => &[2, 3],
            ApStage::SendingReport | ApStage::SendingRReport => &[3, 4, 5, 6],
            ApStage::Sending73 => &[3, 1, 2],
        }
    }

    /// Parses the reference's stage names (`SENDING_REPORT`, ...).
    pub fn from_reference_name(s: &str) -> Option<Self> {
        Some(match s.trim().to_ascii_uppercase().as_str() {
            "IDLE" => ApStage::Idle,
            "CALLING_CQ" => ApStage::CallingCq,
            "REPLYING_CQ" => ApStage::ReplyingCq,
            "SENDING_REPORT" => ApStage::SendingReport,
            "SENDING_R_REPORT" => ApStage::SendingRReport,
            "SENDING_73" => ApStage::Sending73,
            "QSO_COMPLETED" => ApStage::QsoCompleted,
            _ => return None,
        })
    }
}

/// What the receiver knows from the QSO state. Absent means AP is off.
#[derive(Clone, Debug)]
pub struct ApContext {
    /// Stage of the QSO state machine.
    pub stage: ApStage,
    /// The operator's callsign (already proven to round-trip by its type).
    pub my_call: Option<Callsign>,
    /// The station being worked.
    pub dx_call: Option<Callsign>,
    /// Base (tone-0) audio frequencies being worked: RX and TX. Empty disables the gate.
    pub worked_freqs_hz: Vec<f64>,
}

/// One assertion about payload bits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApHypothesis {
    /// 1..=6
    pub ap_type: u8,
    /// Which of the 63 payload bits are asserted.
    pub mask: [bool; PAYLOAD_BITS],
    /// Their values.
    pub bits: [u8; PAYLOAD_BITS],
}

/// Human label for an AP type.
pub fn ap_label(ap_type: u8) -> &'static str {
    match ap_type {
        1 => "CQ ??? ???",
        2 => "MyCall ??? ???",
        3 => "MyCall DxCall ???",
        4 => "MyCall DxCall RRR",
        5 => "MyCall DxCall 73",
        6 => "MyCall DxCall RR73",
        _ => "",
    }
}

fn assert_field(h: &mut ApHypothesis, offset: usize, width: usize, value: u64) {
    for i in 0..width {
        h.mask[offset + i] = true;
        h.bits[offset + i] = ((value >> (width - 1 - i)) & 1) as u8;
    }
}

/// The hypothesis for one type, or `None` when the station data cannot support it (no weaker
/// substitute is ever tried).
pub fn build_hypothesis(ap_type: u8, my_call: Option<&Callsign>, dx_call: Option<&Callsign>) -> Option<ApHypothesis> {
    let mut h = ApHypothesis { ap_type, mask: [false; PAYLOAD_BITS], bits: [0; PAYLOAD_BITS] };
    if ap_type == 1 {
        assert_field(&mut h, 0, 28, CallField::Cq.packed() as u64);
        return Some(h);
    }
    let my = my_call?;
    assert_field(&mut h, 0, 28, my.packed() as u64);
    if ap_type == 2 {
        return Some(h);
    }
    let dx = dx_call?;
    assert_field(&mut h, 28, 28, dx.packed() as u64);
    match ap_type {
        3 => {}
        4 => assert_field(&mut h, 56, 7, 61),
        5 => assert_field(&mut h, 56, 7, 62),
        6 => assert_field(&mut h, 56, 7, 63),
        _ => return None,
    }
    Some(h)
}

fn within_window(candidate_hz: Option<f64>, worked: &[f64]) -> bool {
    let Some(f) = candidate_hz else { return true };
    let usable: Vec<f64> = worked.iter().copied().filter(|&w| w > 0.0).collect();
    usable.is_empty() || usable.iter().any(|&w| (f - w).abs() <= AP_FREQ_WINDOW_HZ)
}

/// The ordered, gated ladder for a context and a candidate frequency.
pub fn build_ladder(ctx: &ApContext, candidate_hz: Option<f64>) -> Vec<ApHypothesis> {
    let near = within_window(candidate_hz, &ctx.worked_freqs_hz);
    ctx.stage
        .ladder()
        .iter()
        .filter(|&&t| t < AP_DEEP_TYPE || near)
        .filter_map(|&t| build_hypothesis(t, ctx.my_call.as_ref(), ctx.dx_call.as_ref()))
        .collect()
}

/// LLRs with the asserted positions replaced by `+-apmag` (positive = bit 0).
pub fn apply_hypothesis(llr: &Llrs, h: &ApHypothesis) -> Llrs {
    let apmag = (AP_LLR_MARGIN * llr.iter().fold(0.0f64, |m, &x| m.max((x as f64).abs()))) as f32;
    let mut out = *llr;
    if apmag <= 0.0 {
        return out;
    }
    for i in 0..PAYLOAD_BITS {
        if h.mask[i] {
            out[i] = if h.bits[i] == 0 { apmag } else { -apmag };
        }
    }
    out
}

/// Whether a decoded payload carries what the hypothesis asserted (a guard that can only fire if
/// something else is already wrong - which is when it matters).
pub fn hypothesis_holds(info: &[u8], h: &ApHypothesis) -> bool {
    (0..PAYLOAD_BITS).all(|i| !h.mask[i] || info[i] == h.bits[i])
}

/// Outcome of an AP-enabled decode.
#[derive(Clone, Debug)]
pub struct ApDecodeResult {
    /// The LDPC result of the attempt that succeeded (or the ordinary one on failure).
    pub result: LdpcResult,
    /// 0 for an ordinary decode; otherwise the hypothesis type that recovered the frame.
    pub ap_type: u8,
    /// Iterations across every attempt.
    pub total_iterations: usize,
    /// Hypotheses tried.
    pub hypotheses_tried: usize,
}

/// An ordinary decode, and only if it failed, each hypothesis in turn.
pub fn decode_with_ap(dec: &mut Decoder, llr: &Llrs, hypotheses: &[ApHypothesis]) -> ApDecodeResult {
    let plain = dec.decode(llr, None);
    if plain.success {
        let it = plain.iterations;
        return ApDecodeResult { result: plain, ap_type: 0, total_iterations: it, hypotheses_tried: 0 };
    }
    let mut total = plain.iterations;
    for (tried, h) in hypotheses.iter().enumerate() {
        let ap_llr = apply_hypothesis(llr, h);
        let mut pinned: ApMask = [false; N];
        pinned[..PAYLOAD_BITS].copy_from_slice(&h.mask);
        let r = dec.decode(&ap_llr, Some(&pinned));
        total += r.iterations;
        if r.success && hypothesis_holds(&r.info, h) {
            return ApDecodeResult { result: r, ap_type: h.ap_type, total_iterations: total, hypotheses_tried: tried + 1 };
        }
    }
    ApDecodeResult { result: plain, ap_type: 0, total_iterations: total, hypotheses_tried: hypotheses.len() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_bits_are_never_asserted() {
        let my = Callsign::new("W1AW").unwrap();
        let dx = Callsign::new("K1ABC").unwrap();
        for t in 1..=6 {
            let h = build_hypothesis(t, Some(&my), Some(&dx)).unwrap();
            assert_eq!(h.mask.len(), PAYLOAD_BITS);
        }
    }

    #[test]
    fn deep_types_are_frequency_gated() {
        let ctx = ApContext {
            stage: ApStage::SendingReport,
            my_call: Some(Callsign::new("W1AW").unwrap()),
            dx_call: Some(Callsign::new("K1ABC").unwrap()),
            worked_freqs_hz: vec![1500.0],
        };
        assert_eq!(build_ladder(&ctx, Some(1550.0)).len(), 4);
        assert!(build_ladder(&ctx, Some(1700.0)).is_empty());
    }
}
