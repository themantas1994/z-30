//! The production demodulator against the oracle's (`benchmark.demodulate_mfsk_llrs`) on the
//! golden frame: one noisy frame at 6 kHz, -19 dB, a non-integer carrier and a non-zero start.
//!
//! The two are not expected to be bit-identical: the oracle correlates directly at 6 kHz and is
//! handed the true noise sigma, while production correlates on the FFT of a 200 Hz baseband and
//! estimates its own noise. What must hold is that they are the same demodulator: the same
//! decisions, LLRs that are the same up to a noise-estimate scale, and the same decode.

use rustfft::num_complex::Complex32;
use serde_json::Value;
use std::path::PathBuf;
use z30_dsp::baseband::{Plans, SlotSpectrum, BB_DECIMATION, SLOT_SAMPLES, SLOT_ZERO_INDEX};
use z30_dsp::demod::{FrameSpectra, SymbolFft};
use z30_dsp::ldpc::{Decoder, Llrs};
use z30_dsp::sync::FineSync;
use z30_protocol::N;

fn golden(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/golden").join(name)
}

fn f32s(name: &str) -> Vec<f32> {
    std::fs::read(golden(name)).unwrap().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

fn production_llrs() -> (Llrs, Llrs) {
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(golden("demod.json")).unwrap()).unwrap();
    let wave = f32s(doc["wave"].as_str().unwrap());
    let oracle: Llrs = f32s(doc["llr"].as_str().unwrap()).try_into().unwrap();
    let start = doc["start_sample"].as_u64().unwrap() as usize;
    let f0 = doc["base_freq_hz"].as_f64().unwrap();
    // Put the frame's first sample on the slot boundary of a 27 s window.
    let mut slot = vec![0.0f32; SLOT_SAMPLES];
    for (i, &x) in wave.iter().enumerate() {
        let j = SLOT_ZERO_INDEX as i64 - start as i64 + i as i64;
        if (0..SLOT_SAMPLES as i64).contains(&j) {
            slot[j as usize] = x;
        }
    }
    let plans = Plans::new();
    let spec = SlotSpectrum::new(&plans, &slot);
    let (bb, centre): (Vec<Complex32>, f64) = spec.baseband(&plans, f0);
    // The timing and frequency the oracle was handed, so this compares demodulators and not
    // synchronisers.
    let sync = FineSync { start: SLOT_ZERO_INDEX / BB_DECIMATION, df_hz: f0 - centre, drift_hz: 0.0, metric: 0.0, frac: 0.0 };
    let spectra = FrameSpectra::new(&bb, &SymbolFft::new(), &sync);
    (spectra.llrs_with(false), oracle)
}

#[test]
fn the_fft_demodulator_is_the_reference_demodulator() {
    let (prod, oracle) = production_llrs();
    let agree = prod.iter().zip(&oracle).filter(|(a, b)| (**a > 0.0) == (**b > 0.0)).count();
    let (mut sab, mut saa, mut sbb) = (0.0f64, 0.0f64, 0.0f64);
    for (&a, &b) in prod.iter().zip(&oracle) {
        sab += a as f64 * b as f64;
        saa += (a as f64).powi(2);
        sbb += (b as f64).powi(2);
    }
    let corr = sab / (saa * sbb).sqrt();
    // Least-squares scale that maps production onto the oracle (the noise-estimate ratio), and
    // what is left after it.
    let k = sab / saa;
    let resid = prod.iter().zip(&oracle).map(|(&a, &b)| (k * a as f64 - b as f64).powi(2)).sum::<f64>();
    let rel = (resid / sbb).sqrt();
    eprintln!("hard decisions agree {agree}/{N}; LLR correlation {corr:.5}; scale {k:.4}; relative residual {rel:.4}");
    assert!(agree >= N - 2, "hard decisions agree on only {agree}/{N}");
    assert!(corr > 0.99, "LLR correlation {corr}");
    assert!((0.8..1.25).contains(&k), "noise-estimate scale {k}");
}

#[test]
fn both_demodulators_lead_to_the_same_decode() {
    let (prod, oracle) = production_llrs();
    let mut dec = Decoder::new();
    let a = dec.decode(&prod, None);
    let b = dec.decode(&oracle, None);
    assert!(a.success && b.success);
    assert_eq!(a.info, b.info);
}
