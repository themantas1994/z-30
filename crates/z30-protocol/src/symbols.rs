//! Codeword <-> channel symbols: 4 bits per data symbol, natural binary, MSB first, interleaved
//! with the 21 Costas symbols.

use crate::{DATA_POSITIONS, DATA_SYMBOLS, N, SYNC_POSITIONS, SYNC_TONES, TOTAL_SYMBOLS};

/// The 75 tones of a frame for a 216-bit codeword.
pub fn codeword_to_symbols(cw: &[u8]) -> [u8; TOTAL_SYMBOLS] {
    assert!(cw.len() >= N);
    let mut out = [0u8; TOTAL_SYMBOLS];
    for (k, &pos) in SYNC_POSITIONS.iter().enumerate() {
        out[pos] = SYNC_TONES[k];
    }
    for (s, &pos) in DATA_POSITIONS.iter().enumerate() {
        let b = &cw[4 * s..4 * s + 4];
        out[pos] = (b[0] & 1) << 3 | (b[1] & 1) << 2 | (b[2] & 1) << 1 | (b[3] & 1);
    }
    out
}

/// The 216 codeword bits a frame's data symbols carry (the inverse of the data half of
/// `codeword_to_symbols`).
pub fn symbols_to_codeword(symbols: &[u8; TOTAL_SYMBOLS]) -> [u8; N] {
    let mut cw = [0u8; N];
    for s in 0..DATA_SYMBOLS {
        let t = symbols[DATA_POSITIONS[s]];
        for b in 0..4 {
            cw[4 * s + b] = (t >> (3 - b)) & 1;
        }
    }
    cw
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let cw: Vec<u8> = (0..N).map(|i| ((i * 31 + 7) % 3 == 0) as u8).collect();
        let s = codeword_to_symbols(&cw);
        assert_eq!(symbols_to_codeword(&s).to_vec(), cw);
        for (k, &p) in SYNC_POSITIONS.iter().enumerate() {
            assert_eq!(s[p], SYNC_TONES[k]);
        }
    }
}
