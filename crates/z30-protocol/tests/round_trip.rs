//! Every message v1 can carry goes out exactly as requested, and everything else is refused -
//! never transmitted as something else (2026-09-24 audit, C-06).
//!
//! The legacy packer turned FN42 into RE78, JO01 into FN20, ZY2ABC into 24BWE, G4XYZ/P into
//! EY6ACQ and R-12 into -12, and transmitted the result. The property enforced here is the
//! one a receiving station depends on: `encode(m)` either fails, or produces symbols that a
//! receiver reads back - parity, CRC, fields and text - as exactly `m`.

use z30_protocol::codec::{CallField, Callsign, CodecError, Extra, Grid4, Message};

fn round_trips(m: &Message) {
    let enc = m.encode().unwrap_or_else(|e| panic!("{m}: {e}"));
    enc.verify_round_trip().unwrap_or_else(|e| panic!("{m}: {e}"));
    assert_eq!(&Message::parse(&m.to_string()).unwrap(), m);
}

fn all_squares() -> impl Iterator<Item = String> {
    (b'A'..=b'R').flat_map(|a| (b'A'..=b'R').flat_map(move |b| (0..100).map(move |n| format!("{}{}{:02}", a as char, b as char, n))))
}

#[test]
fn every_maidenhead_square_is_sent_exactly_or_refused() {
    let from = Callsign::new("K1ABC").unwrap();
    let (mut sent, mut refused) = (0, 0);
    for sq in all_squares() {
        let g = Grid4::new(&sq).unwrap();
        match Message::cq(from.clone(), &g) {
            Ok(m) => {
                round_trips(&m);
                assert_eq!(m.extra, Extra::Grid(g.clone()));
                sent += 1;
            }
            Err(e) => {
                assert_eq!(e, CodecError::GridNotInTable(sq.clone()));
                // ...and text that names it is refused the same way.
                assert!(Message::parse(&format!("CQ K1ABC {sq}")).is_err());
                refused += 1;
            }
        }
    }
    assert_eq!(sent, 63, "the v1 table has 63 squares");
    assert_eq!(sent + refused, 18 * 18 * 100);
}

#[test]
fn every_report_and_acknowledgement() {
    let (to, from) = (Callsign::new("G4XYZ").unwrap(), Callsign::new("K1ABC").unwrap());
    for db in -30..=30 {
        round_trips(&Message::directed(to.clone(), from.clone(), Extra::report(db).unwrap()).unwrap());
    }
    for db in [-99, -31, 31, 99] {
        assert!(Extra::report(db).is_err());
        assert!(Message::parse(&format!("G4XYZ K1ABC {db:+}")).is_err());
    }
    for e in [Extra::Rrr, Extra::SeventyThree, Extra::Rr73] {
        round_trips(&Message::directed(to.clone(), from.clone(), e).unwrap());
    }
    for text in ["G4XYZ K1ABC R-12", "G4XYZ K1ABC R+05", "G4XYZ K1ABC TU", "G4XYZ K1ABC 5NN"] {
        assert!(Message::parse(text).is_err(), "{text}");
    }
}

#[test]
fn cq_forms_and_qrz() {
    let g = Grid4::new("IO91").unwrap();
    let from = Callsign::new("G4XYZ").unwrap();
    for to in [CallField::Cq, CallField::CqDx, CallField::CqTest, CallField::Qrz] {
        let m = Message { to: to.clone(), from: from.clone(), extra: Extra::grid(&g).unwrap() };
        round_trips(&m);
    }
    // A CQ carries a grid and nothing else.
    let bad = Message { to: CallField::Cq, from, extra: Extra::report(-10).unwrap() };
    assert!(bad.encode().is_err());
}

#[test]
fn hand_built_out_of_range_fields_are_refused_not_panicked_on() {
    let from = Callsign::new("K1ABC").unwrap();
    let off_table = Message { to: CallField::Cq, from: from.clone(), extra: Extra::Grid(Grid4::new("FN42").unwrap()) };
    assert_eq!(off_table.encode().unwrap_err(), CodecError::GridNotInTable("FN42".into()));
    let loud = Message { to: CallField::Call(Callsign::new("G4XYZ").unwrap()), from, extra: Extra::Report(45) };
    assert!(matches!(loud.encode(), Err(CodecError::BadReport(_))));
}

#[test]
fn the_audit_substitutions_are_all_refused() {
    // E029: each of these went out as a different call, grid or report.
    for text in [
        "CQ ZY2ABC GG66",
        "CQ EA8/G4XYZ IO91",
        "CQ G4XYZ/P IO91",
        "CQ K1ABC FN42",
        "CQ G4XYZ JO01",
        "CQ K1ABC EM12",
        "CQ PY2XX GG66",
        "ZY2ABC K1ABC -10",
        "K1ABC G4XYZ R-12",
        "K1ABC G4XYZ -31",
    ] {
        assert!(Message::parse(text).is_err(), "{text} must be refused");
    }
}

/// A small deterministic generator (no dependency): the callsign space has ~2.4e8 members.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % n
    }
}

#[test]
fn sampled_callsign_space_partner_and_own_calls() {
    const PREFIX: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const LETTERS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut r = Lcg(20260924);
    let grid = Extra::grid(&Grid4::new("FN31").unwrap()).unwrap();
    let (mut ok, mut refused) = (0, 0);
    for _ in 0..40_000 {
        let plen = 1 + r.next(2) as usize;
        let slen = 1 + r.next(3) as usize;
        let mut c = String::new();
        for _ in 0..plen {
            c.push(PREFIX[r.next(36) as usize] as char);
        }
        c.push((b'0' + r.next(10) as u8) as char);
        for _ in 0..slen {
            c.push(LETTERS[r.next(26) as usize] as char);
        }
        match Callsign::new(&c) {
            Ok(call) => {
                assert_eq!(call.as_str(), c, "normalised to something else");
                // As the partner (to) and as ourselves (from).
                let other = Callsign::new("K1ABC").unwrap();
                round_trips(&Message::directed(call.clone(), other.clone(), grid.clone()).unwrap());
                round_trips(&Message::directed(other, call, Extra::report(-15).unwrap()).unwrap());
                ok += 1;
            }
            Err(CodecError::CallsignOutOfRange(_) | CodecError::NotStandardCallsign(_) | CodecError::PlaceholderCallsign) => refused += 1,
            Err(e) => panic!("{c}: unexpected {e}"),
        }
    }
    assert!(ok > 30_000 && refused > 0, "{ok} carried, {refused} refused");
}
