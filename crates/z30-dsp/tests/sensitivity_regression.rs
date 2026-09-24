//! A sensitivity regression test with the power to see half a decibel.
//!
//! `channel_scenarios.rs::weak_minus_22_db_decodes_most_frames` asserts >= 24/30 at -22 dB,
//! which the 2026-09-24 audit (M-10) pointed out a 0.5 dB loss would probably pass: the true
//! rate there is ~91%, and 0.5 dB lower it is ~75%. Here, 100 blind frames at -22 dB must
//! decode >= 84:
//!
//! - receiver as measured (p ~ 0.91): P(fewer than 84) ~ 0.5%;
//! - receiver 0.5 dB worse (p ~ 0.75, the audit's -22.5 dB point): P(84 or more) ~ 2.5%.
//!
//! The frames are seeded, so for a given receiver the count is fixed; the design numbers say how
//! likely a real 0.5 dB regression is to be caught by whichever seeds these are. The published
//! threshold comes from the 200-frame benchmark (`z30 --benchmark suite`), not from this.

use z30_channel::*;
use z30_dsp::slot::{Receiver, RxConfig};

#[test]
fn minus_22_db_blind_decodes_at_least_84_of_100_with_no_false_decodes() {
    let n = 100u64;
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).min(8) as u64;
    let results: Vec<(u64, usize)> = (0..threads)
        .map(|t| {
            std::thread::spawn(move || {
                use rand::Rng;
                let rx = Receiver::new();
                let (mut ok, mut false_decodes) = (0u64, 0usize);
                let mut i = t;
                while i < n {
                    let mut r = rng(0x5E75_0000 + i);
                    let f0 = r.gen_range(210.0..2740.0);
                    let dt = r.gen_range(-1.4..1.4);
                    let (payload, st) = random_station(&mut r, f0, dt, -22.0);
                    let x = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(0x5E76_0000 + i));
                    let rep = rx.decode_slot(&x, &RxConfig::default());
                    ok += rep.decodes.iter().any(|d| d.info[..63] == payload) as u64;
                    false_decodes += rep.decodes.iter().filter(|d| d.info[..63] != payload).count();
                    i += threads;
                }
                (ok, false_decodes)
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|h| h.join().unwrap())
        .collect();
    let ok: u64 = results.iter().map(|r| r.0).sum();
    let false_decodes: usize = results.iter().map(|r| r.1).sum();
    eprintln!("-22 dB blind: {ok}/{n} decoded, {false_decodes} false");
    assert_eq!(false_decodes, 0);
    assert!(ok >= 84, "{ok}/{n} at -22 dB: the receiver has lost sensitivity (expected ~91%)");
}
