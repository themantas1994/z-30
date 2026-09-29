//! The production AP path: `decode_slot` with an AP context, end to end (acquisition, the
//! production decoder cascade with its corrected OSD, `decode_with_ap`).
//!
//! 2026-09-28 audit F-26 (DSP-03): `ap.rs` was tested against the oracle's ladder and its
//! constrained decode in isolation (`golden_ldpc.rs`), but nothing ran AP through the receiver
//! the station uses, with AP off and on over the same audio, over noise, and with wrong
//! assumptions. These are regression tests of AP's rules, not a sensitivity or false-decode
//! figure: sample sizes are small and seeded, and nothing here may be quoted as a rate. A
//! figure needs a pre-registered `z30 --benchmark` run (docs/research-process.md).
//!
//! Simulation only. If one of these fails, the change is wrong - do not edit the test.

use z30_channel::{rng, synthesize, Band, Station};
use z30_dsp::ap::{ApContext, ApStage};
use z30_dsp::slot::{Decode, Receiver, RxConfig, SlotReport};
use z30_protocol::codec::{Callsign, Message};

const F0: f64 = 1500.0;

fn station(text: &str, snr_db: f64, seed: u64) -> Station {
    let enc = Message::parse(text).unwrap().encode().unwrap();
    let phase = (seed % 628) as f64 / 100.0;
    Station { symbols: enc.symbols, f0_hz: F0, dt_sec: 0.2, snr_db, drift_hz: 0.0, phase_rad: phase, fading: None }
}

fn slot(stations: Vec<Station>, seed: u64) -> Vec<f32> {
    synthesize(&Band { stations, noise: true, ..Default::default() }, &mut rng(seed))
}

fn ap(dx: &str) -> RxConfig {
    RxConfig {
        ap: Some(ApContext {
            stage: ApStage::SendingReport,
            my_call: Some(Callsign::new("K1ABC").unwrap()),
            dx_call: Some(Callsign::new(dx).unwrap()),
            worked_freqs_hz: vec![F0, F0],
        }),
        ..RxConfig::default()
    }
}

fn key(d: &Decode) -> (Vec<u8>, u8, u64, u64) {
    (d.info.to_vec(), d.pass, d.freq_hz.to_bits(), d.dt_sec.to_bits())
}

fn texts(r: &SlotReport) -> Vec<String> {
    r.decodes.iter().map(|d| d.message.to_string()).collect()
}

#[test]
fn f26_ap_adds_decodes_and_never_changes_or_loses_one_through_decode_slot() {
    // Frames of the QSO in progress around the plain decoder's limit: some decode without AP,
    // some only with it.
    let rx = Receiver::new();
    let sent = "K1ABC W9XYZ -12";
    let (mut plain, mut with_ap, mut ap_only) = (0, 0, 0);
    for k in 0..16u64 {
        let snr = -25.0 + (k % 4) as f64 * 0.75;
        let x = slot(vec![station(sent, snr, 100 + k)], 200 + k);
        let off = rx.decode_slot(&x, &RxConfig::default());
        let on = rx.decode_slot(&x, &ap("W9XYZ"));
        // Never change or lose: every plain decode is in the AP report, bit for bit.
        for d in &off.decodes {
            assert!(on.decodes.iter().any(|e| key(e) == key(d) && e.ap_type == 0), "AP changed or lost {} (frame {k})", d.message);
        }
        // Every AP decode is labelled, and is the frame that was sent.
        for d in on.decodes.iter().filter(|d| d.ap_type > 0) {
            assert!((1..=6).contains(&d.ap_type));
            assert_eq!(d.message.to_string(), sent, "frame {k}: AP produced a message that was not sent");
        }
        assert!(texts(&on).iter().all(|t| t == sent), "frame {k}: {:?}", texts(&on));
        plain += off.decodes.len();
        with_ap += on.decodes.len();
        ap_only += on.decodes.iter().filter(|d| d.ap_type > 0).count();
    }
    eprintln!("exploratory, 16 frames at -25..-22.75 dB: {plain} plain, {with_ap} with AP ({ap_only} by AP)");
    assert!(with_ap >= plain);
    assert!(ap_only > 0, "the production AP path never recovered a frame the plain decoder missed: it is not running");
}

#[test]
fn f26_wrong_ap_assumptions_cannot_produce_the_assumed_call() {
    // The receiver believes it is working G4XYZ; the station on frequency is W9XYZ. Nothing may
    // decode as coming from G4XYZ, and whatever decodes is what was sent.
    let rx = Receiver::new();
    let sent = "K1ABC W9XYZ -12";
    for k in 0..12u64 {
        let snr = -24.0 + (k % 3) as f64;
        let x = slot(vec![station(sent, snr, 300 + k)], 400 + k);
        let on = rx.decode_slot(&x, &ap("G4XYZ"));
        for t in texts(&on) {
            assert!(!t.contains("G4XYZ"), "frame {k}: AP manufactured the assumed call: {t}");
            assert_eq!(t, sent, "frame {k}");
        }
    }
}

#[test]
fn f26_ap_does_not_manufacture_decodes_from_noise() {
    // Noise only, AP on with the deepest ladder (types 3-6 assert both calls): every hypothesis is
    // another roll of the CRC-14, which is why AP is off by default. 40 seeded slots; a decode
    // here is a false decode made by AP. This bounds nothing usefully (40 slots) - it is a guard
    // against a gate that stops narrowing, not a false-decode rate.
    let rx = Receiver::new();
    let cfg = ap("W9XYZ");
    let mut false_decodes = Vec::new();
    for k in 0..40u64 {
        let x = slot(vec![], 900 + k);
        let rep = rx.decode_slot(&x, &cfg);
        false_decodes.extend(rep.decodes.iter().map(|d| (k, d.message.to_string(), d.ap_type)));
    }
    assert!(false_decodes.is_empty(), "AP decoded {} frame(s) from noise: {false_decodes:?}", false_decodes.len());
}
