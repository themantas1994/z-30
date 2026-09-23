//! Amateur band plan and transmit privileges: which frequencies this station may put a data
//! emission on, given its regulatory region and licence class. A port of `src/dsp/bandPlan.ts`
//! (the data behind the transmit gate), with the same scope limits: data segments only,
//! national variations not modelled, and the operator remains responsible for their emissions.

use serde::{Deserialize, Serialize};

/// Regulatory framework the operator is licensed under.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Region {
    /// IARU Region 1: Europe, Africa, Middle East, northern Asia.
    IaruR1,
    /// IARU Region 2: the Americas (non-US licence).
    IaruR2,
    /// IARU Region 3: Asia-Pacific.
    IaruR3,
    /// United States, FCC Part 97.
    Us,
}

/// Licence class.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LicenseClass {
    /// Full privileges of a general amateur licence in an IARU region.
    Full,
    /// US Amateur Extra.
    UsExtra,
    /// US Advanced.
    UsAdvanced,
    /// US General.
    UsGeneral,
    /// US Technician.
    UsTechnician,
}

impl Region {
    /// Parses the TypeScript identifiers (`IARU_R1`, `US`, ...).
    pub fn from_legacy(s: &str) -> Option<Region> {
        Some(match s {
            "IARU_R1" => Region::IaruR1,
            "IARU_R2" => Region::IaruR2,
            "IARU_R3" => Region::IaruR3,
            "US" => Region::Us,
            _ => return None,
        })
    }

    /// Display name.
    pub fn display_name(self) -> &'static str {
        match self {
            Region::IaruR1 => "IARU Region 1 (Europe / Africa / Middle East)",
            Region::IaruR2 => "IARU Region 2 (Americas, non-US licence)",
            Region::IaruR3 => "IARU Region 3 (Asia / Pacific)",
            Region::Us => "United States (FCC Part 97)",
        }
    }

    /// Licence classes that apply in this region.
    pub fn license_classes(self) -> &'static [LicenseClass] {
        match self {
            Region::Us => &[LicenseClass::UsExtra, LicenseClass::UsAdvanced, LicenseClass::UsGeneral, LicenseClass::UsTechnician],
            _ => &[LicenseClass::Full],
        }
    }

    /// When the region's table was last checked against the regulator's published allocation.
    pub fn verified_on(self) -> &'static str {
        "2026-08-30"
    }
}

impl LicenseClass {
    /// Parses the TypeScript identifiers (`FULL`, `US_EXTRA`, ...).
    pub fn from_legacy(s: &str) -> Option<LicenseClass> {
        Some(match s {
            "FULL" => LicenseClass::Full,
            "US_EXTRA" => LicenseClass::UsExtra,
            "US_ADVANCED" => LicenseClass::UsAdvanced,
            "US_GENERAL" => LicenseClass::UsGeneral,
            "US_TECHNICIAN" => LicenseClass::UsTechnician,
            _ => return None,
        })
    }
}

/// A data-mode segment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    /// Band label.
    pub band: &'static str,
    /// Inclusive lower edge, Hz.
    pub start_hz: u64,
    /// Inclusive upper edge, Hz.
    pub end_hz: u64,
    /// Classes that may use it.
    pub classes: &'static [LicenseClass],
}

use LicenseClass::*;
const FULL: &[LicenseClass] = &[Full];
const US_ALL: &[LicenseClass] = &[UsExtra, UsAdvanced, UsGeneral, UsTechnician];
const US_HF: &[LicenseClass] = &[UsExtra, UsAdvanced, UsGeneral];
const US_EX: &[LicenseClass] = &[UsExtra];
const US_AG: &[LicenseClass] = &[UsAdvanced, UsGeneral];

macro_rules! seg {
    ($b:expr, $s:expr, $e:expr, $c:expr) => {
        Segment { band: $b, start_hz: $s, end_hz: $e, classes: $c }
    };
}

const R1: &[Segment] = &[
    seg!("160m", 1_810_000, 2_000_000, FULL),
    seg!("80m", 3_500_000, 3_800_000, FULL),
    seg!("60m", 5_351_500, 5_366_500, FULL),
    seg!("40m", 7_000_000, 7_200_000, FULL),
    seg!("30m", 10_100_000, 10_150_000, FULL),
    seg!("20m", 14_000_000, 14_350_000, FULL),
    seg!("17m", 18_068_000, 18_168_000, FULL),
    seg!("15m", 21_000_000, 21_450_000, FULL),
    seg!("12m", 24_890_000, 24_990_000, FULL),
    seg!("10m", 28_000_000, 29_700_000, FULL),
    seg!("6m", 50_000_000, 52_000_000, FULL),
    seg!("2m", 144_000_000, 146_000_000, FULL),
    seg!("70cm", 430_000_000, 440_000_000, FULL),
];

const R2: &[Segment] = &[
    seg!("160m", 1_800_000, 2_000_000, FULL),
    seg!("80m", 3_500_000, 4_000_000, FULL),
    seg!("60m", 5_351_500, 5_366_500, FULL),
    seg!("40m", 7_000_000, 7_300_000, FULL),
    seg!("30m", 10_100_000, 10_150_000, FULL),
    seg!("20m", 14_000_000, 14_350_000, FULL),
    seg!("17m", 18_068_000, 18_168_000, FULL),
    seg!("15m", 21_000_000, 21_450_000, FULL),
    seg!("12m", 24_890_000, 24_990_000, FULL),
    seg!("10m", 28_000_000, 29_700_000, FULL),
    seg!("6m", 50_000_000, 54_000_000, FULL),
    seg!("2m", 144_000_000, 148_000_000, FULL),
    seg!("70cm", 430_000_000, 450_000_000, FULL),
];

const R3: &[Segment] = &[
    seg!("160m", 1_800_000, 2_000_000, FULL),
    seg!("80m", 3_500_000, 3_900_000, FULL),
    seg!("60m", 5_351_500, 5_366_500, FULL),
    seg!("40m", 7_000_000, 7_200_000, FULL),
    seg!("30m", 10_100_000, 10_150_000, FULL),
    seg!("20m", 14_000_000, 14_350_000, FULL),
    seg!("17m", 18_068_000, 18_168_000, FULL),
    seg!("15m", 21_000_000, 21_450_000, FULL),
    seg!("12m", 24_890_000, 24_990_000, FULL),
    seg!("10m", 28_000_000, 29_700_000, FULL),
    seg!("6m", 50_000_000, 54_000_000, FULL),
    seg!("2m", 144_000_000, 148_000_000, FULL),
    seg!("70cm", 430_000_000, 440_000_000, FULL),
];

const US: &[Segment] = &[
    seg!("160m", 1_800_000, 2_000_000, US_HF),
    seg!("80m", 3_500_000, 3_600_000, US_EX),
    seg!("80m", 3_525_000, 3_600_000, US_AG),
    seg!("60m", 5_332_000, 5_405_000, US_HF),
    seg!("40m", 7_000_000, 7_125_000, US_EX),
    seg!("40m", 7_025_000, 7_125_000, US_AG),
    seg!("30m", 10_100_000, 10_150_000, US_HF),
    seg!("20m", 14_000_000, 14_150_000, US_EX),
    seg!("20m", 14_025_000, 14_150_000, US_AG),
    seg!("17m", 18_068_000, 18_110_000, US_HF),
    seg!("15m", 21_000_000, 21_200_000, US_EX),
    seg!("15m", 21_025_000, 21_200_000, US_AG),
    seg!("12m", 24_890_000, 24_930_000, US_HF),
    seg!("10m", 28_000_000, 28_300_000, US_ALL),
    seg!("6m", 50_000_000, 54_000_000, US_ALL),
    seg!("2m", 144_000_000, 148_000_000, US_ALL),
    seg!("70cm", 420_000_000, 450_000_000, US_ALL),
];

/// The data segments of a region.
pub fn segments(region: Region) -> &'static [Segment] {
    match region {
        Region::IaruR1 => R1,
        Region::IaruR2 => R2,
        Region::IaruR3 => R3,
        Region::Us => US,
    }
}

/// The segment that contains the whole emission `[f - bw/2, f + bw/2]`, if any. Checked against
/// the emission's edges, not its centre: a 50 Hz signal centred 10 Hz inside a band edge is
/// radiating out of band.
pub fn find_permitted_segment(region: Region, class: LicenseClass, freq_hz: f64, bandwidth_hz: f64) -> Option<Segment> {
    let half = bandwidth_hz.max(0.0) / 2.0;
    let (lo, hi) = (freq_hz - half, freq_hz + half);
    segments(region).iter().copied().find(|s| lo >= s.start_hz as f64 && hi <= s.end_hz as f64 && s.classes.contains(&class))
}

/// The nearest permitted segment and the distance to it, so a refusal can say how far out the
/// station is.
pub fn nearest_permitted_segment(region: Region, class: LicenseClass, freq_hz: f64) -> Option<(Segment, f64)> {
    segments(region)
        .iter()
        .filter(|s| s.classes.contains(&class))
        .map(|s| {
            let d = if freq_hz < s.start_hz as f64 {
                s.start_hz as f64 - freq_hz
            } else if freq_hz > s.end_hz as f64 {
                freq_hz - s.end_hz as f64
            } else {
                0.0
            };
            (*s, d)
        })
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
}

/// Structural callsign validation, the rule `isValidCallsign` in bandPlan.ts and
/// `station_settings.py` share (`tests/vectors/callsign_vectors.json`):
/// `^(?:[A-Z0-9]{1,3}/)?[A-Z0-9]{1,3}\d[A-Z]{1,4}(?:/[A-Z0-9]{1,4})?$` with a letter in the
/// first `/`-separated part. Structural only: whether v1 can carry it is a separate question
/// (`z30_protocol::codec::Callsign::new`), and the transmit gate asks both.
pub fn is_valid_callsign(call: &str) -> bool {
    let t = call.trim().to_ascii_uppercase();
    if t.is_empty() {
        return false;
    }
    let first_part = t.split('/').next().unwrap_or(&t);
    if !first_part.bytes().any(|b| b.is_ascii_uppercase()) {
        return false;
    }
    let alnum =
        |s: &str, lo: usize, hi: usize| (lo..=hi).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let parts: Vec<&str> = t.split('/').collect();
    let (prefix, core, suffix) = match parts.len() {
        1 => (None, parts[0], None),
        2 => {
            // Either PREFIX/CORE or CORE/SUFFIX; the regex accepts whichever parse matches.
            if core_ok(parts[1]) && alnum(parts[0], 1, 3) {
                (Some(parts[0]), parts[1], None)
            } else {
                (None, parts[0], Some(parts[1]))
            }
        }
        3 => (Some(parts[0]), parts[1], Some(parts[2])),
        _ => return false,
    };
    prefix.is_none_or(|p| alnum(p, 1, 3)) && core_ok(core) && suffix.is_none_or(|s| alnum(s, 1, 4))
}

/// `[A-Z0-9]{1,3}\d[A-Z]{1,4}` - tried at every split, as a backtracking regex would.
fn core_ok(core: &str) -> bool {
    let b = core.as_bytes();
    let suffix_len = b.iter().rev().take_while(|c| c.is_ascii_uppercase()).count();
    for sl in 1..=suffix_len.min(4) {
        if b.len() < sl + 2 {
            continue;
        }
        let digit_idx = b.len() - sl - 1;
        if !b[digit_idx].is_ascii_digit() {
            continue;
        }
        let pre = &b[..digit_idx];
        if (1..=3).contains(&pre.len()) && pre.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_not_centres() {
        // 14.074 MHz dial + 1500 Hz audio is well inside 20 m.
        assert!(find_permitted_segment(Region::IaruR1, LicenseClass::Full, 14_075_500.0, 50.0).is_some());
        // Centre 10 Hz inside the upper edge of 20 m in R1: half the emission is outside.
        assert!(find_permitted_segment(Region::IaruR1, LicenseClass::Full, 14_349_990.0, 50.0).is_none());
        // US General: 14.000-14.025 is Extra-only.
        assert!(find_permitted_segment(Region::Us, LicenseClass::UsGeneral, 14_010_000.0, 50.0).is_none());
        assert!(find_permitted_segment(Region::Us, LicenseClass::UsExtra, 14_010_000.0, 50.0).is_some());
        // US Technician has no 20 m data privileges.
        assert!(find_permitted_segment(Region::Us, LicenseClass::UsTechnician, 14_076_000.0, 50.0).is_none());
    }

    #[test]
    fn nearest_segment_reports_distance() {
        let (s, d) = nearest_permitted_segment(Region::IaruR1, LicenseClass::Full, 14_400_000.0).unwrap();
        assert_eq!(s.band, "20m");
        assert_eq!(d, 50_000.0);
    }
}
