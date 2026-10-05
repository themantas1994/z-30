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
    station_at(text, F0, 0.2, snr_db, seed)
}

fn station_at(text: &str, f0_hz: f64, dt_sec: f64, snr_db: f64, seed: u64) -> Station {
    let enc = Message::parse(text).unwrap().encode().unwrap();
    let phase = (seed % 628) as f64 / 100.0;
    Station { symbols: enc.symbols, f0_hz, dt_sec, snr_db, drift_hz: 0.0, phase_rad: phase, fading: None }
}

fn attempts(r: &SlotReport) -> usize {
    r.passes.iter().map(|p| p.ldpc_attempts).sum()
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
    // Frames 16..24 sit at -22/-21.5 dB, where the plain decoder succeeds, so the "never change
    // or lose" check has plain decodes to check (the first 16 gave it one; review DSP F-26).
    for k in 0..24u64 {
        let snr = if k < 16 { -25.0 + (k % 4) as f64 * 0.75 } else { -22.0 + (k % 2) as f64 * 0.5 };
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
    eprintln!("exploratory, 24 frames at -25..-21.5 dB: {plain} plain, {with_ap} with AP ({ap_only} by AP)");
    assert!(with_ap >= plain);
    assert!(plain >= 4, "too few plain decodes ({plain}) for the never-change-or-lose check to mean anything");
    assert!(ap_only > 0, "the production AP path never recovered a frame the plain decoder missed: it is not running");
}

#[test]
fn f26_wrong_ap_assumptions_cannot_produce_the_assumed_call() {
    // The receiver believes it is working G4XYZ; the station on frequency is W9XYZ. Nothing may
    // decode as coming from G4XYZ, and whatever decodes is what was sent.
    let rx = Receiver::new();
    let sent = "K1ABC W9XYZ -12";
    let mut decoded = 0;
    for k in 0..12u64 {
        let snr = -24.0 + (k % 3) as f64;
        let x = slot(vec![station(sent, snr, 300 + k)], 400 + k);
        let on = rx.decode_slot(&x, &ap("G4XYZ"));
        for t in texts(&on) {
            assert!(!t.contains("G4XYZ"), "frame {k}: AP manufactured the assumed call: {t}");
            assert_eq!(t, sent, "frame {k}");
            decoded += 1;
        }
    }
    // Not vacuous: frames did decode, and none as the assumed call.
    assert!(decoded > 0, "nothing decoded: the test checked no decode");
}

#[test]
fn f26_ap_does_not_manufacture_decodes_from_noise() {
    // Noise only, AP on with the deepest ladder (types 3-6 assert both calls): every hypothesis is
    // another roll of the CRC-14, which is why AP is off by default. 40 seeded slots; a decode
    // here is a false decode made by AP. 40 slots bound no false-decode rate; this catches a gross
    // defect (a hypothesis accepted without the CRC). That AP really ran, and that its frequency
    // gate really narrows it, is asserted from the decoder's own attempt counts: with the gate,
    // AP tried hypotheses in only a few slots, so "no decodes" alone was nearly vacuous (review
    // DSP F-26).
    let rx = Receiver::new();
    let gated = ap("W9XYZ");
    let mut ungated = ap("W9XYZ");
    ungated.ap.as_mut().unwrap().worked_freqs_hz.clear();
    let (mut off_n, mut gated_n, mut ungated_n) = (0, 0, 0);
    let mut false_decodes = Vec::new();
    for k in 0..40u64 {
        let x = slot(vec![], 900 + k);
        let off = rx.decode_slot(&x, &RxConfig::default());
        let on = rx.decode_slot(&x, &gated);
        let wide = rx.decode_slot(&x, &ungated);
        for (arm, rep) in [("gated", &on), ("ungated", &wide)] {
            false_decodes.extend(rep.decodes.iter().map(|d| (k, arm, d.message.to_string(), d.ap_type)));
        }
        assert!(off.decodes.is_empty(), "slot {k}: the plain decoder decoded noise");
        (off_n, gated_n, ungated_n) = (off_n + attempts(&off), gated_n + attempts(&on), ungated_n + attempts(&wide));
    }
    eprintln!("exploratory, 40 noise slots: LDPC attempts off {off_n}, AP gated {gated_n}, AP ungated {ungated_n}");
    assert!(false_decodes.is_empty(), "AP decoded {} frame(s) from noise: {false_decodes:?}", false_decodes.len());
    assert!(gated_n > off_n, "AP made no attempts of its own: it did not run");
    assert!(ungated_n > gated_n, "the frequency gate did not narrow AP's attempts");
}

#[test]
fn f26_in_a_busy_band_ap_never_loses_a_decode_the_plain_decoder_made() {
    // Review DSP F-26: within a pass AP cannot touch another candidate's decode, but across passes
    // it could: an AP-only decode is subtracted, which changes the residual and the pass-2/3
    // candidate set. Several stations around the QSO frequency, AP off and on over the same audio:
    // every plain decode must still be in the AP report (by payload; its pass may differ).
    let rx = Receiver::new();
    let sent = "K1ABC W9XYZ -12";
    let others = [
        ("CQ K2AAA FN31", 620.0, -0.6, -12.0),
        ("K3BBB W4CCC -10", 1180.0, 0.4, -16.0),
        ("CQ DL1ABC FN31", F0 + 25.0, -0.9, -14.0),
        ("G4DEF K5GHI -07", F0 - 40.0, 1.0, -8.0),
        ("CQ VK2XYZ QF56", 2230.0, 0.1, -19.0),
    ];
    let (mut plain_n, mut ap_n) = (0, 0);
    for k in 0..8u64 {
        let mut stations: Vec<Station> = others
            .iter()
            .enumerate()
            .map(|(i, (t, f, dt, s))| station_at(t, *f, *dt, *s + (k % 3) as f64, 500 + 10 * k + i as u64))
            .collect();
        stations.push(station(sent, -24.0 + (k % 4) as f64 * 0.5, 600 + k));
        let x = slot(stations, 700 + k);
        let off = rx.decode_slot(&x, &RxConfig::default());
        let on = rx.decode_slot(&x, &ap("W9XYZ"));
        for d in &off.decodes {
            assert!(on.decodes.iter().any(|e| e.info == d.info), "band {k}: AP lost the plain decode {} (pass {})", d.message, d.pass);
        }
        for d in on.decodes.iter().filter(|d| d.ap_type > 0) {
            assert_eq!(d.message.to_string(), sent, "band {k}: AP produced a message that was not sent");
        }
        plain_n += off.decodes.len();
        ap_n += on.decodes.len();
    }
    eprintln!("exploratory, 8 bands of 6 stations: {plain_n} plain decodes, {ap_n} with AP");
    assert!(plain_n >= 16, "too few plain decodes ({plain_n}) for the check to mean anything");
}
