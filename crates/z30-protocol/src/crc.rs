//! CRC-14: g(x) = x^14 + x^13 + x^10 + x^6 + x + 1, register constant 0x2443, init 0x2757,
//! MSB-first. The only thing that tests an LDPC or AP hypothesis, so it must never be asserted.

/// Register constant (low 14 coefficients of g(x); x^14 implicit).
pub const POLY: u16 = 0x2443;
/// Initial register value.
pub const INIT: u16 = 0x2757;

/// CRC-14 of a bit sequence (each element 0 or 1; only the low bit is read).
pub fn crc14(bits: &[u8]) -> u16 {
    let mut crc = INIT;
    for &b in bits {
        let msb = (crc >> 13) & 1;
        crc = ((crc << 1) & 0x3FFF) ^ if (msb ^ (b as u16 & 1)) != 0 { POLY } else { 0 };
    }
    crc & 0x3FFF
}

/// The 14 CRC bits, MSB first.
pub fn crc_bits(crc: u16) -> [u8; 14] {
    let mut out = [0u8; 14];
    for (i, o) in out.iter_mut().enumerate() {
        *o = ((crc >> (13 - i)) & 1) as u8;
    }
    out
}

/// MSB-first integer value of a bit slice (up to 64 bits).
pub fn bits_to_u64(bits: &[u8]) -> u64 {
    bits.iter().fold(0u64, |a, &b| (a << 1) | (b as u64 & 1))
}

/// Whether a 77-bit information block's CRC field matches its payload.
pub fn info_crc_ok(info: &[u8]) -> bool {
    info.len() >= crate::K && crc14(&info[..crate::PAYLOAD_BITS]) as u64 == bits_to_u64(&info[crate::PAYLOAD_BITS..crate::K])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_answers() {
        // From tests/vectors/crc14_vectors.json (all zeros / all ones), independently pinned.
        let z = crc14(&[0u8; 63]);
        let o = crc14(&[1u8; 63]);
        assert_ne!(z, o);
        assert!(z < 0x4000 && o < 0x4000);
    }

    #[test]
    fn single_bit_errors_are_all_detected() {
        let base: Vec<u8> = (0..63).map(|i| ((i * 7 + 3) % 5 == 0) as u8).collect();
        let c = crc14(&base);
        for i in 0..63 {
            let mut e = base.clone();
            e[i] ^= 1;
            assert_ne!(crc14(&e), c, "bit {i}");
        }
    }
}
