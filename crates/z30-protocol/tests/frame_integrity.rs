//! The symbol-level round trip refuses every corrupted frame, and a frame can only become
//! transmittable (`VerifiedFrame`) by passing it.
//!
//! The 2026-09-24 post-remediation audit found that `EncodedMessage::verify_round_trip` could
//! be made to return `Ok` for everything - or not be called at all - without a single test
//! failing (mutations C06-a/b/c): every test built its frames with the real encoder, so the
//! check was never shown a bad one. These tests build bad ones on purpose, one kind of
//! corruption at a time, each of which a transmitter must not send. z30-engine's
//! `tests/safety.rs` feeds the same kinds through the transmit gate itself.

use z30_protocol::codec::{Callsign, EncodedMessage, Extra, Message};
use z30_protocol::crc::info_crc_ok;
use z30_protocol::ldpc::{encode_info, info_from_payload};
use z30_protocol::symbols::codeword_to_symbols;
use z30_protocol::{DATA_POSITIONS, K, NUM_TONES, SYNC_POSITIONS};

fn msg(text: &str) -> Message {
    Message::parse(text).unwrap()
}

/// Rebuilds codeword and symbols from `info` (as a transmitter with a consistent but wrong
/// encoder would), keeping `message` as the claim.
fn consistent(message: Message, info: [u8; K]) -> EncodedMessage {
    let codeword = encode_info(&info);
    EncodedMessage { message, info, codeword, symbols: codeword_to_symbols(&codeword) }
}

/// Every kind of corruption, named, for one message. Each must be refused.
fn corruptions(m: &Message) -> Vec<(String, EncodedMessage)> {
    let good = m.encode().unwrap();
    let mut out = Vec::new();
    // One channel symbol changed, at several data positions.
    for &p in &[DATA_POSITIONS[0], DATA_POSITIONS[17], DATA_POSITIONS[53]] {
        let mut e = good.clone();
        e.symbols[p] = (e.symbols[p] + 1) % NUM_TONES as u8;
        out.push((format!("data symbol {p} changed"), e));
    }
    // A Costas symbol changed.
    for &p in &[SYNC_POSITIONS[0], SYNC_POSITIONS[10], SYNC_POSITIONS[20]] {
        let mut e = good.clone();
        e.symbols[p] = (e.symbols[p] + 5) % NUM_TONES as u8;
        out.push((format!("Costas symbol {p} changed"), e));
    }
    // A tone the modulator does not have.
    let mut e = good.clone();
    e.symbols[DATA_POSITIONS[5]] = NUM_TONES as u8;
    out.push(("tone 16".into(), e));
    // Symbol order: two data symbols that differ, swapped.
    let (a, b) = (0..DATA_POSITIONS.len())
        .flat_map(|i| (i + 1..DATA_POSITIONS.len()).map(move |j| (i, j)))
        .map(|(i, j)| (DATA_POSITIONS[i], DATA_POSITIONS[j]))
        .find(|&(i, j)| good.symbols[i] != good.symbols[j])
        .unwrap();
    let mut e = good.clone();
    e.symbols.swap(a, b);
    out.push((format!("data symbols {a} and {b} swapped"), e));
    // The whole frame reversed (Costas groups included).
    let mut e = good.clone();
    e.symbols.reverse();
    out.push(("symbol order reversed".into(), e));
    // The codeword field disagrees with the symbols (symbols untouched).
    let mut e = good.clone();
    e.codeword[100] ^= 1;
    out.push(("codeword bit 100 flipped, symbols unchanged".into(), e));
    // The info field disagrees with the codeword.
    let mut e = good.clone();
    e.info[3] ^= 1;
    out.push(("info bit 3 flipped, codeword unchanged".into(), e));
    // A parity bit flipped and the symbols made to match it: a non-codeword on the air.
    let mut e = good.clone();
    e.codeword[K + 7] ^= 1;
    e.symbols = codeword_to_symbols(&e.codeword);
    out.push(("parity bit flipped, symbols consistent".into(), e));
    // A CRC bit flipped, then a valid LDPC codeword built around it: parity passes, CRC fails.
    let mut info = good.info;
    info[70] ^= 1;
    assert!(!info_crc_ok(&info));
    out.push(("CRC bit flipped, LDPC re-encoded".into(), consistent(m.clone(), info)));
    // The payload changed with a correct CRC and LDPC: a perfect frame of a DIFFERENT message.
    let mut payload = m.payload();
    payload[40] ^= 1;
    out.push(("payload bit flipped, CRC and LDPC recomputed".into(), consistent(m.clone(), info_from_payload(&payload))));
    // The message field altered, the frame unchanged: the frame says something else.
    let mut e = good.clone();
    e.message.extra = if e.message.extra == Extra::Rr73 { Extra::Rrr } else { Extra::Rr73 };
    out.push(("message field altered, frame unchanged".into(), e));
    let mut e = good.clone();
    e.message.from = Callsign::new("W9XYZ").unwrap();
    out.push(("sender field altered, frame unchanged".into(), e));
    // Another valid message's whole frame under this message's name.
    let other = msg("G4XYZ K1ABC 73").encode().unwrap();
    let mut e = other;
    e.message = m.clone();
    if e.symbols != good.symbols {
        out.push(("another message's frame".into(), e));
    }
    out
}

#[test]
fn a_valid_frame_is_accepted_and_is_exactly_the_encoders() {
    for text in ["CQ K1ABC FN31", "G4XYZ K1ABC -10", "K1ABC G4XYZ RR73", "CQ DX VK2ABC QF56"] {
        let m = msg(text);
        let enc = m.encode().unwrap();
        let f = enc.clone().verify().unwrap_or_else(|e| panic!("{text}: {e}"));
        assert_eq!(f.message(), &m);
        assert_eq!(f.symbols(), &enc.symbols);
        assert_eq!(m.frame().unwrap().symbols(), &enc.symbols);
    }
}

#[test]
fn every_kind_of_corrupted_frame_is_refused() {
    let mut n = 0;
    for text in ["CQ K1ABC FN31", "G4XYZ K1ABC -10", "K1ABC G4XYZ RR73"] {
        let m = msg(text);
        for (what, e) in corruptions(&m) {
            assert!(e.verify_round_trip().is_err(), "{text}: {what} passed the round trip");
            assert!(e.verify().is_err(), "{text}: {what} became a VerifiedFrame");
            n += 1;
        }
    }
    assert!(n >= 45, "{n} corruptions checked");
}
