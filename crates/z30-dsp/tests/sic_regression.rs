//! Successive interference cancellation, held to what it must physically do.
//!
//! `channel_scenarios.rs` measures suppression against the true clean waveform and the weak
//! station SIC reveals. These add the properties the 2026-09-24 audit asked for (section 13 of
//! the remediation brief): a subtraction never adds energy, SIC never loses or invents a
//! station on randomly overlapping bands (paired on/off over the same audio), and the
//! multi-station result does not depend on the thread count.
//!
//! `PassStats::suppression_db` is the receiver's own fit-residual ratio, not a physical
//! measurement (it overstates true suppression by ~10 dB, audit E047); nothing here asserts on
//! it. Physical suppression is always measured against the known transmitted component.

use z30_channel::*;
use z30_dsp::sic::{subtract, SicParams};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};
use z30_protocol::gfsk::Modulator;

fn energy(x: &[f32]) -> f64 {
    x.iter().map(|&v| (v as f64).powi(2)).sum()
}

fn symbols_of(info: &[u8]) -> [u8; 75] {
    z30_protocol::symbols::codeword_to_symbols(&z30_protocol::ldpc::encode_info(info))
}

#[test]
fn a_subtraction_never_adds_energy_and_removes_what_the_station_contributed() {
    let rx = Receiver::new();
    let m = Modulator::new(FS).unwrap();
    for (i, snr) in [-15.0, -8.0, 0.0, 10.0, 20.0].into_iter().enumerate() {
        let mut r = rng(3100 + i as u64);
        let (p, st) = random_station(&mut r, 400.0 + 431.0 * i as f64, -1.0 + 0.5 * i as f64, snr);
        let clean = synthesize(&Band { stations: vec![st.clone()], ..Default::default() }, &mut rng(1));
        let x = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(3200 + i as u64));
        let rep = rx.decode_slot(&x, &RxConfig { passes: 1, ..Default::default() });
        let d = rep.decodes.iter().find(|d| d.info[..63] == p).expect("decodes");
        let mut resid = x.clone();
        let start = (SLOT_ZERO_INDEX as f64 + d.dt_sec * FS).round() as i64;
        subtract(&mut resid, &m, &symbols_of(&d.info), d.freq_hz, d.drift_hz, start, &SicParams::default());
        let (before, after) = (energy(&x), energy(&resid));
        assert!(after < before, "{snr} dB: residual energy rose from {before:.0} to {after:.0}");
        // What was removed is (close to) what the station put there: the energy removed
        // matches the station's energy within 10% at every SNR where it is measurable.
        let removed = before - after;
        let station = energy(&clean);
        if snr >= -8.0 {
            assert!((removed / station - 1.0).abs() < 0.1, "{snr} dB: removed {removed:.0} of {station:.0}");
        }
    }
}

#[test]
fn subtracting_a_frame_that_is_not_there_removes_only_the_noise_projection_and_creates_nothing() {
    // A wrong subtraction is the way SIC could create a false decode: whatever it removes it
    // leaves behind as a negative image. On noise alone the least-squares fit can only remove
    // the noise's projection onto the replica - about one complex gain per 0.2 s of frame
    // (~120 complex dimensions, ~240 sigma^2, 0.15% of a 27 s slot) - and never add energy.
    let rx = Receiver::new();
    let m = Modulator::new(FS).unwrap();
    for s in 0..4u64 {
        let x = synthesize(&Band { noise: true, ..Default::default() }, &mut rng(3300 + s));
        let (_, symbols) = random_frame(&mut rng(3400 + s));
        let mut resid = x.clone();
        subtract(&mut resid, &m, &symbols, 900.0 + 300.0 * s as f64, 0.0, SLOT_ZERO_INDEX as i64, &SicParams::default());
        let change = (energy(&x) - energy(&resid)) / energy(&x);
        assert!((0.0..5e-3).contains(&change), "subtracting an absent frame changed the slot energy by {:.3}%", change * 100.0);
        let rep = rx.decode_slot(&resid, &RxConfig::default());
        assert!(rep.decodes.is_empty(), "a decode appeared in the residual of an empty subtraction");
    }
}

fn random_band(seed: u64, k: usize) -> (Band, Vec<[u8; 63]>) {
    use rand::Rng;
    let mut r = rng(seed);
    let mut stations = Vec::new();
    let mut payloads = Vec::new();
    for _ in 0..k {
        // Uniform placement: overlaps in frequency and time are allowed, as on a real band.
        let f0 = r.gen_range(210.0..2740.0);
        let dt = r.gen_range(-1.4..1.4);
        let snr = r.gen_range(-18.0..5.0);
        let (p, st) = random_station(&mut r, f0, dt, snr);
        stations.push(st);
        payloads.push(p);
    }
    (Band { stations, noise: true, ..Default::default() }, payloads)
}

fn found(rep: &SlotReport, payloads: &[[u8; 63]]) -> (usize, usize) {
    let ok = payloads.iter().filter(|p| rep.decodes.iter().any(|d| &d.info[..63] == *p)).count();
    let false_decodes = rep.decodes.iter().filter(|d| !payloads.iter().any(|p| d.info[..63] == *p)).count();
    (ok, false_decodes)
}

#[test]
fn random_overlapping_bands_sic_on_versus_off_paired() {
    let rx = Receiver::new();
    let (mut on, mut off, mut total) = (0, 0, 0);
    for s in 0..10u64 {
        let (band, payloads) = random_band(3500 + s, 8);
        let x = synthesize(&band, &mut rng(3600 + s));
        let with = rx.decode_slot(&x, &RxConfig::default());
        let without = rx.decode_slot(&x, &RxConfig { passes: 1, ..Default::default() });
        let (a, fa) = found(&with, &payloads);
        let (b, fb) = found(&without, &payloads);
        assert_eq!((fa, fb), (0, 0), "band {s}: false decodes with SIC {fa}, without {fb}");
        let mut seen = std::collections::HashSet::new();
        assert!(with.decodes.iter().all(|d| seen.insert(d.info)), "band {s}: duplicate decode with SIC");
        // Pass 1 is the same computation in both, so SIC can only add stations.
        assert!(a >= b, "band {s}: SIC lost a station ({a} with, {b} without)");
        for d in without.decodes.iter() {
            assert!(with.decodes.iter().any(|w| w.info == d.info), "band {s}: a single-pass decode vanished with SIC");
        }
        on += a;
        off += b;
        total += payloads.len();
    }
    eprintln!("random overlapping bands, K = 8: {on}/{total} with SIC, {off}/{total} without");
    assert!(on as f64 >= 0.9 * total as f64, "{on}/{total} with SIC");
}

#[cfg(feature = "parallel")]
#[test]
fn a_busy_band_decodes_identically_on_one_thread_and_on_many() {
    let rx = Receiver::new();
    let (band, _) = random_band(3700, 20);
    let x = synthesize(&band, &mut rng(3701));
    let many = rx.decode_slot(&x, &RxConfig::default());
    let one = rayon::ThreadPoolBuilder::new().num_threads(1).build().unwrap().install(|| rx.decode_slot(&x, &RxConfig::default()));
    let key = |r: &SlotReport| -> Vec<_> {
        r.decodes
            .iter()
            .map(|d| (d.info, d.pass, d.iterations, d.dt_sec.to_bits(), d.freq_hz.to_bits(), d.snr_db.map(f64::to_bits)))
            .collect()
    };
    assert!(!many.decodes.is_empty());
    assert_eq!(key(&many), key(&one));
}
