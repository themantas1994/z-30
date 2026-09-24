//! The (216, 77) IRA LDPC code: the connection table, the parity-check structure and the
//! linear-time encoder. The decoder lives in `z30-dsp`; this is only what defines the code.

use crate::crc::{crc14, crc_bits};
use crate::{K, M, N, PAYLOAD_BITS};

/// Row `p` of H_info: the five information bits check `p` connects to. `Z30_CHECK_TO_INFO` in
/// `z30_dsp/ldpc.py`, transcribed. Degree 5, girth 6.
pub const CHECK_TO_INFO: [[u8; 5]; M] = [
    [2, 1, 3, 4, 6],
    [7, 8, 5, 10, 9],
    [11, 0, 12, 13, 14],
    [17, 16, 15, 20, 19],
    [22, 23, 21, 25, 18],
    [27, 28, 24, 30, 26],
    [29, 32, 34, 31, 36],
    [33, 38, 37, 35, 41],
    [42, 39, 44, 43, 40],
    [47, 46, 45, 48, 51],
    [52, 53, 49, 54, 55],
    [50, 57, 59, 58, 60],
    [62, 63, 61, 56, 66],
    [64, 65, 69, 68, 70],
    [72, 73, 67, 75, 71],
    [0, 1, 74, 76, 8],
    [3, 9, 12, 15, 18],
    [2, 5, 11, 19, 22],
    [7, 13, 16, 21, 24],
    [6, 10, 14, 23, 17],
    [4, 25, 26, 31, 33],
    [27, 32, 35, 40, 46],
    [29, 28, 20, 38, 43],
    [36, 30, 41, 39, 47],
    [42, 37, 48, 50, 34],
    [44, 45, 49, 57, 61],
    [53, 58, 56, 65, 51],
    [55, 59, 63, 68, 71],
    [60, 54, 66, 69, 67],
    [52, 70, 62, 74, 75],
    [73, 64, 76, 3, 10],
    [1, 5, 12, 17, 72],
    [2, 0, 7, 18, 26],
    [8, 4, 14, 19, 21],
    [11, 6, 15, 24, 29],
    [16, 9, 25, 27, 36],
    [20, 23, 31, 30, 37],
    [22, 13, 32, 28, 39],
    [34, 33, 43, 46, 49],
    [35, 45, 52, 56, 50],
    [41, 42, 53, 57, 62],
    [38, 44, 51, 55, 64],
    [40, 54, 48, 59, 70],
    [60, 47, 61, 71, 76],
    [65, 66, 74, 72, 2],
    [63, 67, 58, 3, 0],
    [68, 75, 1, 7, 11],
    [73, 69, 4, 5, 13],
    [8, 6, 16, 18, 31],
    [10, 15, 21, 28, 35],
    [12, 20, 25, 34, 40],
    [9, 19, 24, 23, 38],
    [17, 22, 26, 29, 42],
    [14, 27, 33, 45, 39],
    [36, 44, 46, 50, 62],
    [37, 32, 47, 43, 52],
    [30, 49, 48, 60, 64],
    [51, 57, 54, 63, 73],
    [41, 55, 56, 69, 74],
    [53, 61, 59, 67, 4],
    [58, 66, 68, 76, 5],
    [71, 70, 1, 10, 16],
    [65, 75, 3, 14, 20],
    [0, 9, 17, 28, 31],
    [72, 6, 13, 19, 27],
    [8, 2, 15, 25, 32],
    [12, 7, 29, 33, 23],
    [11, 18, 30, 38, 42],
    [22, 35, 36, 24, 49],
    [21, 26, 34, 44, 52],
    [37, 45, 54, 62, 58],
    [39, 46, 55, 57, 67],
    [40, 41, 51, 50, 66],
    [48, 53, 63, 72, 76],
    [43, 56, 60, 73, 70],
    [59, 47, 65, 1, 13],
    [64, 71, 74, 6, 5],
    [69, 61, 0, 75, 10],
    [3, 7, 22, 27, 31],
    [2, 9, 68, 14, 30],
    [4, 12, 16, 28, 37],
    [11, 20, 8, 26, 35],
    [15, 33, 40, 36, 55],
    [18, 24, 17, 34, 41],
    [19, 32, 44, 53, 66],
    [23, 39, 48, 56, 75],
    [29, 45, 21, 60, 63],
    [25, 38, 46, 54, 61],
    [42, 49, 47, 67, 74],
    [43, 51, 59, 72, 0],
    [57, 65, 76, 52, 4],
    [50, 68, 6, 12, 21],
    [62, 69, 1, 15, 14],
    [64, 58, 8, 22, 40],
    [71, 3, 11, 25, 28],
    [2, 73, 17, 35, 39],
    [5, 18, 70, 27, 37],
    [10, 20, 13, 36, 48],
    [9, 26, 41, 32, 49],
    [16, 30, 34, 51, 61],
    [7, 42, 46, 52, 59],
    [23, 44, 54, 65, 5],
    [19, 33, 47, 56, 57],
    [24, 45, 53, 64, 31],
    [38, 58, 71, 2, 13],
    [29, 55, 66, 73, 8],
    [60, 72, 3, 16, 62],
    [50, 63, 43, 69, 7],
    [70, 67, 6, 76, 9],
    [75, 15, 22, 34, 38],
    [68, 0, 4, 24, 39],
    [10, 74, 11, 32, 50],
    [1, 19, 25, 35, 29],
    [12, 27, 43, 48, 55],
    [18, 20, 44, 33, 58],
    [17, 30, 40, 21, 56],
    [14, 26, 37, 51, 36],
    [23, 28, 41, 52, 63],
    [31, 42, 61, 65, 12],
    [46, 64, 72, 9, 20],
    [45, 59, 69, 3, 19],
    [53, 60, 68, 10, 18],
    [49, 70, 0, 66, 21],
    [47, 62, 4, 17, 7],
    [67, 1, 23, 26, 40],
    [54, 74, 13, 15, 31],
    [73, 6, 28, 33, 53],
    [57, 71, 8, 24, 43],
    [2, 76, 27, 29, 75],
    [14, 22, 16, 41, 44],
    [25, 37, 49, 56, 72],
    [11, 34, 45, 66, 4],
    [32, 38, 5, 57, 48],
    [35, 30, 55, 62, 0],
    [42, 51, 69, 2, 21],
    [39, 50, 54, 76, 18],
    [47, 63, 64, 75, 12],
    [52, 58, 73, 1, 36],
    [59, 74, 16, 26, 39],
];

/// The parity bits for 77 information bits: `p_i = p_{i-1} XOR (XOR of row i's info bits)`.
pub fn parity(info: &[u8]) -> [u8; M] {
    debug_assert!(info.len() >= K);
    let mut out = [0u8; M];
    let mut acc = 0u8;
    for (p, row) in CHECK_TO_INFO.iter().enumerate() {
        acc ^= row.iter().fold(0u8, |a, &j| a ^ (info[j as usize] & 1));
        out[p] = acc;
    }
    out
}

/// The 216-bit codeword for 77 information bits (systematic: the first 77 bits are `info`).
pub fn encode_info(info: &[u8]) -> [u8; N] {
    let mut cw = [0u8; N];
    for i in 0..K {
        cw[i] = info[i] & 1;
    }
    cw[K..].copy_from_slice(&parity(info));
    cw
}

/// Appends the CRC to a 63-bit payload.
pub fn info_from_payload(payload: &[u8]) -> [u8; K] {
    assert!(payload.len() >= PAYLOAD_BITS, "a payload is 63 bits");
    let mut info = [0u8; K];
    for i in 0..PAYLOAD_BITS {
        info[i] = payload[i] & 1;
    }
    let crc = crc_bits(crc14(&info[..PAYLOAD_BITS]));
    info[PAYLOAD_BITS..].copy_from_slice(&crc);
    info
}

/// Payload -> CRC -> codeword. `Z30LdpcCodec.encode` in the reference.
pub fn encode_payload(payload: &[u8]) -> [u8; N] {
    encode_info(&info_from_payload(payload))
}

/// Variable indices of check `c`, in ascending order (the order `np.nonzero(H)` yields, which
/// the layered decoder's bit-exactness depends on).
pub fn check_vars(c: usize) -> Vec<usize> {
    let mut vs: Vec<usize> = CHECK_TO_INFO[c].iter().map(|&v| v as usize).collect();
    vs.sort_unstable();
    if c > 0 {
        vs.push(K + c - 1);
    }
    vs.push(K + c);
    vs
}

/// Number of unsatisfied checks.
pub fn syndrome_weight(cw: &[u8]) -> usize {
    let mut w = 0;
    let mut prev_parity = 0u8;
    for (c, row) in CHECK_TO_INFO.iter().enumerate() {
        let mut s = row.iter().fold(0u8, |a, &j| a ^ cw[j as usize]);
        s ^= cw[K + c] ^ prev_parity;
        prev_parity = cw[K + c];
        w += (s & 1) as usize;
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_codeword_has_zero_syndrome() {
        let mut state = 0x1234_5678u32;
        for _ in 0..200 {
            let payload: Vec<u8> = (0..63)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    (state & 1) as u8
                })
                .collect();
            let cw = encode_payload(&payload);
            assert_eq!(syndrome_weight(&cw), 0);
        }
    }

    #[test]
    fn table_is_degree_five_without_repeats_and_in_range() {
        for row in CHECK_TO_INFO.iter() {
            let mut r = row.to_vec();
            r.sort_unstable();
            r.dedup();
            assert_eq!(r.len(), 5);
            assert!(r.iter().all(|&v| (v as usize) < K));
        }
    }

    #[test]
    fn girth_six_no_four_cycles() {
        // Two checks sharing two information bits would form a length-4 cycle.
        for a in 0..M {
            for b in (a + 1)..M {
                let shared = CHECK_TO_INFO[a].iter().filter(|x| CHECK_TO_INFO[b].contains(x)).count();
                assert!(shared <= 1, "checks {a} and {b} share {shared} bits");
            }
        }
    }

    #[test]
    fn check_edges_total() {
        let e: usize = (0..M).map(|c| check_vars(c).len()).sum();
        assert_eq!(e, M * 5 + M + (M - 1));
    }
}
