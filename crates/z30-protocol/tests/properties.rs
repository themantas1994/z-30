//! Property tests over the accepted message space (directive section 21, audit C5/H2/H3).
//!
//! accepted -> exact round trip; unrepresentable -> refused. Never a silent transformation.

use proptest::prelude::*;
use z30_protocol::codec::{unpack_info, unpack_payload, CallField, Callsign, CodecError, Extra, Grid4, Message, GRID_TABLE};

fn alnum() -> impl Strategy<Value = char> {
    prop::sample::select(('A'..='Z').chain('0'..='9').collect::<Vec<_>>())
}

fn letter() -> impl Strategy<Value = char> {
    prop::sample::select(('A'..='Z').collect::<Vec<_>>())
}

/// Every string of the standard shape, including the ones v1 must refuse (ZV-ZZ).
fn standard_shape() -> impl Strategy<Value = String> {
    (prop::collection::vec(alnum(), 1..=2), 0u8..10, prop::collection::vec(letter(), 1..=3)).prop_map(|(p, d, s)| {
        let mut out: String = p.into_iter().collect();
        out.push((b'0' + d) as char);
        out.extend(s);
        out
    })
}

/// Legal-looking amateur callsigns v1 cannot carry.
fn unusual_calls() -> impl Strategy<Value = String> {
    prop_oneof![
        standard_shape().prop_map(|c| format!("{c}/P")),
        standard_shape().prop_map(|c| format!("{c}/MM")),
        standard_shape().prop_map(|c| format!("EA8/{c}")),
        (prop::collection::vec(alnum(), 3..=4), 0u8..10, prop::collection::vec(letter(), 1..=3)).prop_map(|(p, d, s)| format!(
            "{}{}{}",
            p.into_iter().collect::<String>(),
            d,
            s.into_iter().collect::<String>()
        )),
        // Four-letter suffixes (legal in several administrations, e.g. special-event calls).
        (prop::collection::vec(alnum(), 1..=2), 0u8..10, prop::collection::vec(letter(), 4..=4)).prop_map(|(p, d, s)| format!(
            "{}{}{}",
            p.into_iter().collect::<String>(),
            d,
            s.into_iter().collect::<String>()
        )),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 4000, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn standard_calls_round_trip_or_are_refused_for_the_documented_reason(call in standard_shape()) {
        match Callsign::new(&call) {
            Ok(c) => {
                prop_assert_eq!(c.as_str(), call.as_str());
                prop_assert_eq!(z30_protocol::codec::unpack_call_value(c.packed()), CallField::Call(c.clone()));
            }
            Err(CodecError::CallsignOutOfRange(_)) => {
                // Only prefixes from ZV upward (and any two-character prefix sorting after them)
                // overflow the field.
                prop_assert!(call.as_bytes()[0] == b'Z');
            }
            Err(e) => {
                // A standard shape can still be refused if the greedy split puts the digit in the
                // prefix and leaves no digit before the suffix - e.g. "A12" has no letter suffix.
                prop_assert!(call == "NOCAL" || matches!(e, CodecError::NotStandardCallsign(_)), "{call}: {e}");
            }
        }
    }

    #[test]
    fn unusual_calls_are_refused_never_transformed(call in unusual_calls()) {
        prop_assert!(Callsign::new(&call).is_err(), "{} was accepted", call);
    }

    #[test]
    fn accepted_messages_round_trip_through_bits(
        to in standard_shape(), from in standard_shape(),
        kind in 0u8..6, report in -30i32..=30, gi in 0usize..63,
    ) {
        let (Ok(to), Ok(from)) = (Callsign::new(&to), Callsign::new(&from)) else { return Ok(()) };
        let grid = Grid4::new(GRID_TABLE[gi]).unwrap();
        let msg = match kind {
            0 => Message::cq(from, &grid).unwrap(),
            1 => Message::directed(to, from, Extra::grid(&grid).unwrap()).unwrap(),
            2 => Message::directed(to, from, Extra::report(report).unwrap()).unwrap(),
            3 => Message::directed(to, from, Extra::Rrr).unwrap(),
            4 => Message::directed(to, from, Extra::SeventyThree).unwrap(),
            _ => Message::directed(to, from, Extra::Rr73).unwrap(),
        };
        let enc = msg.encode().unwrap();
        let back = unpack_info(&enc.info).unwrap().to_message();
        prop_assert_eq!(back.as_ref(), Some(&msg));
        // ...and through its text form.
        prop_assert_eq!(Message::parse(&msg.to_string()).unwrap(), msg);
    }

    #[test]
    fn grids_outside_the_table_are_refused(a in 0u8..18, b in 0u8..18, c in 0u8..10, d in 0u8..10) {
        let g = format!("{}{}{}{}", (b'A' + a) as char, (b'A' + b) as char, c, d);
        let grid = Grid4::new(&g).unwrap();
        prop_assert_eq!(Extra::grid(&grid).is_ok(), GRID_TABLE.contains(&g.as_str()));
    }

    #[test]
    fn any_payload_decodes_without_panicking_and_canonical_messages_re_encode(bits in prop::collection::vec(0u8..2, 63)) {
        let d = unpack_payload(&bits);
        if let Some(m) = d.to_message() {
            prop_assert_eq!(m.payload().to_vec(), bits);
        }
    }
}
