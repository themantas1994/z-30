//! Accuracy of the SNR and DT the receiver reports, against what the channel model put on the
//! air (SPEC.md section 10: SNR is signal power over the noise in 2500 Hz).
//!
//! The 2026-09-24 audit (E026, M-07) measured the reported SNR accurate to +-0.4 dB below
//! -6 dB, then saturating near +6.6 dB: +10 dB read 4.6 dB low, +20 dB 13.3 dB low, +40 dB
//! 33 dB low. The noise estimate was the median of off-tone bins, and for a strong signal those
//! bins hold the signal's own spectral leakage. The QSO engine sends the report it derives from
//! this value, so a +20 dB station was sent "+07". Nothing caught it: no test compared the
//! reported SNR with the truth. This one does, across the whole range v1 can report.
//!
//! Frames are placed blind (tone 0 over 250-2700 Hz, DT over +-1.4 s, random phase and payload)
//! and decoded with the production defaults.

use z30_channel::*;
use z30_dsp::demod::{SNR_VALIDATED_MAX_DB, SNR_VALIDATED_MIN_DB};
use z30_dsp::slot::{Receiver, RxConfig};

/// Measured-minus-true (SNR dB, DT ms) for the decoded frames only.
fn errors_at(snr: f64, n: u64, seed0: u64) -> Vec<(f64, f64)> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).min(8) as u64;
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            std::thread::spawn(move || {
                let rx = Receiver::new();
                let mut errs = Vec::new();
                let mut i = t;
                while i < n {
                    let mut r = rng(seed0 + i);
                    let f0 = 250.0 + (i as f64 * 197.3) % 2450.0;
                    let dt = -1.4 + (i as f64 * 0.731) % 2.8;
                    let (payload, st) = random_station(&mut r, f0, dt, snr);
                    let x = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(seed0 + 50_000 + i));
                    let rep = rx.decode_slot(&x, &RxConfig::default());
                    if let Some(d) = rep.decodes.iter().find(|d| d.info[..63] == payload) {
                        let snr_err = d.snr_db.expect("a decoded frame at this SNR has a signal estimate") - snr;
                        errs.push((snr_err, (d.dt_sec - dt) * 1e3));
                    }
                    i += threads;
                }
                errs
            })
        })
        .collect();
    handles.into_iter().flat_map(|h| h.join().unwrap()).collect()
}

fn mean_sd(v: &[f64]) -> (f64, f64) {
    let m = v.iter().sum::<f64>() / v.len() as f64;
    let sd = (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len().max(2) - 1) as f64).sqrt();
    (m, sd)
}

#[test]
fn reported_snr_tracks_the_true_snr_from_threshold_to_plus_30_db() {
    // The published validated range must be what this test checks, not something wider.
    const { assert!(SNR_VALIDATED_MIN_DB >= -24.0 && SNR_VALIDATED_MAX_DB <= 30.0) };
    let mut table = Vec::new();
    for (k, snr) in [-22.0, -20.0, -15.0, -10.0, -6.0, 0.0, 5.0, 10.0, 20.0, 30.0].into_iter().enumerate() {
        let errs = errors_at(snr, 24, 7_000 + 1_000 * k as u64);
        let (bias, sd) = mean_sd(&errs.iter().map(|e| e.0).collect::<Vec<_>>());
        let (dt_bias, dt_sd) = mean_sd(&errs.iter().map(|e| e.1).collect::<Vec<_>>());
        table.push((snr, errs.len(), bias, sd, dt_bias));
        eprintln!(
            "true {snr:+5.1} dB: n = {:2}, SNR bias {bias:+.2} dB sd {sd:.2} dB | DT bias {dt_bias:+.2} ms sd {dt_sd:.2} ms",
            errs.len()
        );
    }
    for (snr, n, bias, sd, dt_bias) in table {
        assert!(n >= 18, "true {snr} dB: only {n}/24 frames decoded");
        // An estimator that saturates fails this at +10 dB and above by several dB.
        assert!(bias.abs() <= 0.6, "true {snr:+} dB: reported SNR biased by {bias:+.2} dB (M-07)");
        assert!(sd <= 0.8, "true {snr:+} dB: reported SNR spread {sd:.2} dB");
        // Fine sync alone read 2.9 ms late at every SNR; the replica fit removed it.
        if snr >= -15.0 {
            assert!(dt_bias.abs() <= 1.0, "true {snr:+} dB: reported DT biased by {dt_bias:+.2} ms");
        }
    }
}

#[test]
fn an_estimate_is_never_reported_above_the_strongest_signal_measured() {
    // +40 dB is outside the validated range; the estimate may be anything up to the truth but
    // must not invent a stronger signal than was there, and must not collapse to a low value
    // (the defect this test file exists for read +6.6 dB).
    let errs = errors_at(40.0, 8, 99_000);
    assert_eq!(errs.len(), 8);
    for (e, _) in errs {
        assert!(e < 1.0 && e > -6.0, "+40 dB reported as {:+.1} dB", 40.0 + e);
    }
}
