//! z-30 protocol, version 1.
//!
//! Everything that defines what goes on the air and nothing else: the frame, the Costas array,
//! the CRC, the LDPC code, the message codec and the GFSK waveform. No audio, no files, no
//! clocks, no logging. `SPEC.md` at the repository root is the prose form of this crate, and
//! `fixtures/golden/` pins it against the frozen Python/TypeScript oracle.
//!
//! Changing anything here is a protocol break: every station on the air stops decoding you.
#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod codec;
pub mod crc;
pub mod gfsk;
pub mod ldpc;
pub mod symbols;

/// Wire-format version implemented by this crate. v1 is frozen (SPEC.md).
pub const PROTOCOL_VERSION: u8 = 1;

/// Tones in the alphabet.
pub const NUM_TONES: usize = 16;
/// Tone spacing, Hz. Exactly 1 / symbol duration, so the tones are orthogonal.
pub const TONE_SPACING_HZ: f64 = 3.125;
/// Symbol duration, seconds.
pub const SYMBOL_SEC: f64 = 0.320;
/// Symbols per frame: 21 sync + 54 data.
pub const TOTAL_SYMBOLS: usize = 75;
/// Data symbols per frame.
pub const DATA_SYMBOLS: usize = 54;
/// Sync (Costas array) symbols per frame.
pub const SYNC_SYMBOLS: usize = 21;
/// Frame duration, seconds.
pub const FRAME_SEC: f64 = 24.0;
/// Slot duration, seconds. Slot `n` starts at `30 n` seconds since the Unix epoch (UTC).
pub const SLOT_SEC: f64 = 30.0;
/// Receivers search this far either side of the slot boundary for the frame start.
pub const DT_SEARCH_SEC: f64 = 1.5;
/// Nominal occupied bandwidth used by the band-edge check, Hz.
pub const OCCUPIED_BANDWIDTH_HZ: f64 = 50.0;

/// Symbol indices carrying the Costas array.
pub const SYNC_POSITIONS: [usize; SYNC_SYMBOLS] = [0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29, 37, 38, 39, 47, 48, 49, 72, 73, 74];
/// Tone transmitted at each of `SYNC_POSITIONS`, in the same order.
pub const SYNC_TONES: [u8; SYNC_SYMBOLS] = [3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10, 4, 8, 13, 0, 9, 3, 14, 6, 11];

/// Codeword length.
pub const N: usize = 216;
/// Information bits (payload + CRC).
pub const K: usize = 77;
/// Parity checks.
pub const M: usize = N - K;
/// Payload bits carried by one frame.
pub const PAYLOAD_BITS: usize = 63;
/// CRC bits.
pub const CRC_BITS: usize = 14;

/// The callsign an unconfigured station holds. Never transmitted, never asserted by AP.
pub const PLACEHOLDER_CALLSIGN: &str = "NOCAL";

/// Whether symbol index `i` carries a sync tone.
pub const fn is_sync_position(i: usize) -> bool {
    let mut k = 0;
    while k < SYNC_SYMBOLS {
        if SYNC_POSITIONS[k] == i {
            return true;
        }
        k += 1;
    }
    false
}

/// The 54 data-symbol positions, in transmission order.
pub const DATA_POSITIONS: [usize; DATA_SYMBOLS] = {
    let mut out = [0usize; DATA_SYMBOLS];
    let mut d = 0;
    let mut i = 0;
    while i < TOTAL_SYMBOLS {
        if !is_sync_position(i) {
            out[d] = i;
            d += 1;
        }
        i += 1;
    }
    out
};

/// Samples per symbol at `sample_rate_hz`, computed exactly as the reference does
/// (`int(fs * 0.320)`).
pub fn samples_per_symbol(sample_rate_hz: f64) -> usize {
    (sample_rate_hz * SYMBOL_SEC) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_arithmetic() {
        assert_eq!(SYNC_SYMBOLS + DATA_SYMBOLS, TOTAL_SYMBOLS);
        assert_eq!(DATA_SYMBOLS * 4, N);
        assert_eq!(PAYLOAD_BITS + CRC_BITS, K);
        assert!((TOTAL_SYMBOLS as f64 * SYMBOL_SEC - FRAME_SEC).abs() < 1e-12);
        assert!((TONE_SPACING_HZ * SYMBOL_SEC - 1.0).abs() < 1e-12);
        assert_eq!(DATA_POSITIONS[0], 3);
        assert_eq!(DATA_POSITIONS[DATA_SYMBOLS - 1], 71);
    }

    #[test]
    fn costas_pattern_is_the_frozen_one() {
        // Pinned in SPEC.md section 2; changing it is a protocol break.
        let tones: Vec<u8> = SYNC_TONES.to_vec();
        assert_eq!(tones, vec![3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10, 4, 8, 13, 0, 9, 3, 14, 6, 11]);
    }

    #[test]
    fn nsps_matches_reference_truncation() {
        assert_eq!(samples_per_symbol(6000.0), 1920);
        assert_eq!(samples_per_symbol(12000.0), 3840);
        assert_eq!(samples_per_symbol(44100.0), 14112);
        assert_eq!(samples_per_symbol(48000.0), 15360);
    }
}
