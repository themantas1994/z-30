//! The known-answer vectors in `tests/vectors/` that only the retired Python and TypeScript
//! implementations used to read. Those two implementations are gone (2026-10-06 cleanup); the
//! vectors they agreed on are kept because they were produced independently of this crate, and
//! they are asserted here so the guarantee outlives the code that first checked it.

use serde_json::Value;
use std::path::PathBuf;
use z30_protocol::codec::{unpack_call_value, CallField, Callsign};
use z30_protocol::crc::crc14;

fn load(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/vectors").join(name);
    serde_json::from_str(&std::fs::read_to_string(&path).expect(name)).unwrap()
}

#[test]
fn crc14_known_answers() {
    let doc = load("crc14_vectors.json");
    assert_eq!(doc["register_constant"], "0x2443");
    assert_eq!(doc["init"], "0x2757");
    let vectors = doc["vectors"].as_array().unwrap();
    assert!(vectors.len() >= 15);
    for v in vectors {
        let payload: Vec<u8> = v["payload"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
        assert_eq!(crc14(&payload) as u64, v["crc14"].as_u64().unwrap(), "{}", v["name"]);
    }
}

/// A priori decoding asserts the 28 bits of a callsign as certain, so the packer must put every
/// call it accepts exactly where these vectors say, and must refuse every call that would not
/// come back unchanged (the retired packers' Base-37 fallback transmitted a different call).
#[test]
fn callsign_packing_known_answers() {
    let doc = load("callsign_pack_vectors.json");
    assert_eq!(doc["field_width_bits"], 28);
    let mut accepted = 0;
    for v in doc["vectors"].as_array().unwrap() {
        let call = v["call"].as_str().unwrap();
        let packed = v["packed"].as_u64().unwrap() as u32;
        let unpacked = v["unpacked"].as_str().unwrap();
        let round_trips = v["round_trips"].as_bool().unwrap();
        if matches!(call, "CQ" | "CQ DX" | "CQ TEST" | "QRZ") {
            assert_eq!(unpack_call_value(packed).to_string(), call);
            continue;
        }
        match Callsign::new(call) {
            Ok(c) => {
                accepted += 1;
                assert!(round_trips, "{call}: accepted, but the vectors say it does not round-trip");
                assert_eq!(c.packed(), packed, "{call}");
                assert_eq!(c.as_str(), unpacked, "{call}");
                assert_eq!(unpack_call_value(packed), CallField::Call(c));
            }
            Err(e) => assert!(!round_trips, "{call}: refused ({e}), but the vectors say it round-trips"),
        }
    }
    assert_eq!(accepted, 8);
}
