//! Seeded channel scenarios through the production entry point (`decode_slot`), with pass
//! criteria from the audit (I.9 item 4). Sample sizes here are regression-sized, not
//! publication-sized: the published thresholds come from research/paired_receiver.py at
//! 200 frames per point. These catch a receiver that has stopped working.

use z30_channel::*;
use z30_dsp::sic::{subtract, SicParams};
use z30_dsp::slot::{Receiver, RxConfig};
use z30_protocol::gfsk::Modulator;

fn run(rx: &Receiver, band: &Band, seed: u64, cfg: &RxConfig) -> z30_dsp::slot::SlotReport {
    let slot = synthesize(band, &mut rng(seed));
    rx.decode_slot(&slot, cfg)
}

fn decoded(rep: &z30_dsp::slot::SlotReport, payload: &[u8; 63]) -> bool {
    rep.decodes.iter().any(|d| &d.info[..63] == payload)
}

/// Frames at `snr` spread over the band and the DT range; returns (decoded, false decodes).
fn sweep(rx: &Receiver, n: u64, snr: f64, seed0: u64, tweak: impl Fn(&mut Station, u64)) -> (u64, usize) {
    let (mut ok, mut false_decodes) = (0, 0);
    for i in 0..n {
        let mut r = rng(seed0 + i);
        let f0 = 250.0 + (i as f64 * 197.3) % 2450.0;
        let dt = -1.4 + (i as f64 * 0.731) % 2.8;
        let (payload, mut st) = random_station(&mut r, f0, dt, snr);
        tweak(&mut st, i);
        let rep = run(rx, &Band { stations: vec![st], noise: true, ..Default::default() }, 10_000 + seed0 + i, &RxConfig::default());
        ok += decoded(&rep, &payload) as u64;
        false_decodes += rep.decodes.iter().filter(|d| d.info[..63] != payload).count();
    }
    (ok, false_decodes)
}

#[test]
fn clean_plus_10_db_decodes_everything_everywhere() {
    let rx = Receiver::new();
    let (ok, f) = sweep(&rx, 12, 10.0, 100, |_, _| {});
    assert_eq!((ok, f), (12, 0));
}

#[test]
fn moderate_minus_18_db_across_band_timing_and_phase() {
    let rx = Receiver::new();
    let (ok, f) = sweep(&rx, 30, -18.0, 200, |_, _| {});
    assert_eq!(f, 0);
    assert!(ok >= 30, "{ok}/30 at -18 dB");
}

#[test]
fn weak_minus_22_db_decodes_most_frames() {
    // The paired 200-frame measurement puts -22 dB at 94.5% [90.4, 96.9]; 30 frames here only
    // guard against a collapse.
    let rx = Receiver::new();
    let (ok, f) = sweep(&rx, 30, -22.0, 300, |_, _| {});
    assert_eq!(f, 0);
    assert!(ok >= 24, "{ok}/30 at -22 dB");
}

#[test]
fn frequency_drift_up_to_4_hz_is_tracked_h9() {
    // Audit H9: with no drift model, 4 Hz of drift across the frame took -22 dB from 37/40 to
    // 1/40 through the reference receiver.
    let rx = Receiver::new();
    for drift in [2.0, -3.0, 4.0] {
        let (ok, _) = sweep(&rx, 12, -20.0, 400 + drift as u64 * 50, |s, _| s.drift_hz = drift);
        assert!(ok >= 11, "drift {drift} Hz: {ok}/12 at -20 dB");
    }
    // ...and the drift search is what does it.
    let no_drift = RxConfig { max_drift_hz: 0.0, ..Default::default() };
    let mut with = 0;
    let mut without = 0;
    for i in 0..12 {
        let mut r = rng(500 + i);
        let (p, mut st) = random_station(&mut r, 900.0 + i as f64 * 100.0, 0.1, -20.0);
        st.drift_hz = 4.0;
        let band = Band { stations: vec![st], noise: true, ..Default::default() };
        let slot = synthesize(&band, &mut rng(900 + i));
        with += decoded(&rx.decode_slot(&slot, &RxConfig::default()), &p) as u32;
        without += decoded(&rx.decode_slot(&slot, &no_drift), &p) as u32;
    }
    assert!(with >= 11 && without <= 6, "4 Hz drift: {with}/12 with the search, {without}/12 without");
}

#[test]
fn sound_card_clock_error_of_1000_ppm_costs_nothing_at_minus_18_db() {
    let rx = Receiver::new();
    for ppm in [1000.0, -1000.0] {
        let mut ok = 0;
        for i in 0..8u64 {
            let mut r = rng(600 + i);
            let (p, st) = random_station(&mut r, 1000.0 + i as f64 * 150.0, 0.2, -18.0);
            let band = Band { stations: vec![st], noise: true, rx_clock_ppm: ppm, ..Default::default() };
            ok += decoded(&run(&rx, &band, 700 + i, &RxConfig::default()), &p) as u32;
        }
        assert_eq!(ok, 8, "{ppm} ppm");
    }
}

#[test]
fn a_strong_cw_carrier_inside_the_signal_does_not_stop_the_decode() {
    let rx = Receiver::new();
    let mut ok = 0;
    for i in 0..8u64 {
        let mut r = rng(800 + i);
        let (p, st) = random_station(&mut r, 1200.0, 0.0, -16.0);
        // A carrier 10 dB above the station, in the middle of its tones.
        let band = Band { stations: vec![st], cw: vec![(1220.3, -6.0)], noise: true, ..Default::default() };
        ok += decoded(&run(&rx, &band, 810 + i, &RxConfig::default()), &p) as u32;
    }
    assert!(ok >= 7, "{ok}/8 under a CW carrier");
}

#[test]
fn a_busy_band_decodes_every_station_once_with_no_false_decodes() {
    let rx = Receiver::new();
    for (k, seed) in [(5usize, 1u64), (20, 2)] {
        let mut r = rng(seed);
        let mut stations = Vec::new();
        let mut payloads = Vec::new();
        for j in 0..k {
            // Non-overlapping frequencies, -18..0 dB, random DT.
            let f0 = 250.0 + j as f64 * (2450.0 / k as f64);
            let snr = -18.0 + (j % 7) as f64 * 3.0;
            let dt = -1.2 + (j as f64 * 0.37) % 2.4;
            let (p, st) = random_station(&mut r, f0, dt, snr);
            stations.push(st);
            payloads.push(p);
        }
        let rep = run(&rx, &Band { stations, noise: true, ..Default::default() }, 1000 + seed, &RxConfig::default());
        let found = payloads.iter().filter(|p| decoded(&rep, p)).count();
        let false_decodes = rep.decodes.iter().filter(|d| !payloads.iter().any(|p| &d.info[..63] == p)).count();
        let mut seen = std::collections::HashSet::new();
        assert!(rep.decodes.iter().all(|d| seen.insert(d.info)), "K={k}: duplicate decode");
        assert_eq!(false_decodes, 0, "K={k}");
        assert_eq!(found, k, "K={k}: {found}/{k} decoded, {:?}", rep.passes.iter().map(|p| (p.candidates, p.decoded)).collect::<Vec<_>>());
    }
}

#[test]
fn sic_suppresses_a_decoded_station_by_more_than_20_db_and_reveals_the_one_underneath() {
    let rx = Receiver::new();
    let m = Modulator::new(FS).unwrap();
    let mut suppressions = Vec::new();
    let mut revealed = 0;
    for i in 0..6u64 {
        let mut r = rng(1100 + i);
        let (ps, strong) = random_station(&mut r, 1000.0 + i as f64 * 211.0, 0.3, 10.0);
        let (pw, weak) = random_station(&mut r, 1000.0 + i as f64 * 211.0 + 20.0, -0.4, -12.0);
        // 1. Suppression, measured against the true clean waveform of the strong station.
        let clean = synthesize(&Band { stations: vec![strong.clone()], noise: false, ..Default::default() }, &mut rng(1));
        let noisy = synthesize(&Band { stations: vec![strong.clone()], noise: true, ..Default::default() }, &mut rng(1200 + i));
        let rep = rx.decode_slot(&noisy, &RxConfig { passes: 1, ..Default::default() });
        let d = rep.decodes.iter().find(|d| d.info[..63] == ps).expect("the strong station decodes");
        let cw = z30_protocol::ldpc::encode_info(&d.info);
        let symbols = z30_protocol::symbols::codeword_to_symbols(&cw);
        let mut residual = noisy.clone();
        let start = (SLOT_ZERO_INDEX as f64 + d.dt_sec * FS).round() as i64;
        subtract(&mut residual, &m, &symbols, d.freq_hz, d.drift_hz, start, &SicParams::default());
        let (mut sig, mut err) = (0.0f64, 0.0f64);
        for n in 0..noisy.len() {
            let removed = (noisy[n] - residual[n]) as f64;
            sig += (clean[n] as f64).powi(2);
            err += (clean[n] as f64 - removed).powi(2);
        }
        suppressions.push(10.0 * (sig / err).log10());
        // 2. The weak station 20 Hz away, 22 dB down, overlapping in time and frequency.
        let band = Band { stations: vec![strong, weak], noise: true, ..Default::default() };
        let rep = run(&rx, &band, 1300 + i, &RxConfig::default());
        assert!(decoded(&rep, &ps));
        let mut seen = std::collections::HashSet::new();
        assert!(rep.decodes.iter().all(|d| seen.insert(d.info)), "duplicate decode of the removed station");
        if let Some(w) = rep.decodes.iter().find(|d| d.info[..63] == pw) {
            revealed += 1;
            assert!(w.pass >= 2, "the weak station should need the subtraction");
        }
    }
    let worst = suppressions.iter().cloned().fold(f64::INFINITY, f64::min);
    eprintln!("SIC suppression at +10 dB (true-signal residual): {suppressions:.1?}");
    assert!(worst >= 20.0, "suppression {suppressions:?}");
    assert!(revealed >= 5, "weak station revealed by SIC in {revealed}/6");
}

#[test]
fn fading_is_reported_not_gated() {
    // ITU-R F.1487 mid-latitude moderate: no pass criterion until a baseline is published.
    let rx = Receiver::new();
    let mut ok = 0;
    for i in 0..6u64 {
        let mut r = rng(1400 + i);
        let (p, mut st) = random_station(&mut r, 1500.0, 0.0, -15.0);
        st.fading = Watterson::preset("moderate");
        ok +=
            decoded(&run(&rx, &Band { stations: vec![st], noise: true, ..Default::default() }, 1500 + i, &RxConfig::default()), &p) as u32;
    }
    eprintln!("Watterson moderate at -15 dB: {ok}/6 (reported, not asserted)");
}

#[test]
fn noise_only_slots_produce_no_decodes() {
    let rx = Receiver::new();
    for s in 0..6 {
        let rep = run(&rx, &Band { noise: true, ..Default::default() }, 2000 + s, &RxConfig::default());
        assert!(
            rep.decodes.is_empty(),
            "false decode on noise: {:?}",
            rep.decodes.iter().map(|d| d.message.to_string()).collect::<Vec<_>>()
        );
    }
}

#[test]
fn decode_slot_is_deterministic() {
    let rx = Receiver::new();
    let mut r = rng(77);
    let (_, st) = random_station(&mut r, 1300.0, 0.5, -21.0);
    let slot = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(78));
    let a = rx.decode_slot(&slot, &RxConfig::default());
    let b = rx.decode_slot(&slot, &RxConfig::default());
    assert_eq!(a.decodes.len(), b.decodes.len());
    for (x, y) in a.decodes.iter().zip(&b.decodes) {
        assert_eq!(
            (x.info, x.iterations, x.dt_sec.to_bits(), x.freq_hz.to_bits()),
            (y.info, y.iterations, y.dt_sec.to_bits(), y.freq_hz.to_bits())
        );
    }
}
