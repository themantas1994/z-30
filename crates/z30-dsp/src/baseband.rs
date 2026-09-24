//! One FFT per slot, and cheap per-candidate complex baseband from it.
//!
//! The slot window is 27 s at 6 kHz = 162 000 samples. Its spectrum is computed once (per SIC
//! pass). For a candidate at base frequency f0 the receiver needs only +-100 Hz around it, so it
//! copies 5400 bins centred on f0, tapers the band edges, and inverse-transforms them: complex
//! baseband at exactly 200 Hz, where one 320 ms symbol is 64 samples and tone k sits on bin k of
//! a 64-point DFT. That is WSJT-X's `ft8_downsample` idea, and it replaces the shipped
//! receiver's per-sample, per-tone, per-hypothesis trigonometry (317 ms per candidate, audit
//! section D) with one 5400-point IFFT (tens of microseconds).

use realfft::{RealFftPlanner, RealToComplex};
use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use std::sync::Arc;

/// Slot window length in seconds: [slot - 1.5 s, slot + 25.5 s].
pub const SLOT_WINDOW_SEC: f64 = 27.0;
/// Samples in a slot window at the DSP rate.
pub const SLOT_SAMPLES: usize = 162_000;
/// Slot-buffer index of DT = 0 (the slot boundary).
pub const SLOT_ZERO_INDEX: usize = 9_000;
/// Baseband sample rate.
pub const BB_RATE_HZ: f64 = 200.0;
/// Decimation from the DSP rate to baseband.
pub const BB_DECIMATION: usize = 30;
/// Baseband samples in a slot.
pub const BB_SAMPLES: usize = SLOT_SAMPLES / BB_DECIMATION;
/// Baseband samples per symbol.
pub const BB_NSPS: usize = 64;
/// Half-width of the flat part of the extraction filter, Hz.
pub const BB_FLAT_HZ: f64 = 85.0;
/// Half-width of the extracted band, Hz (the Nyquist of the baseband).
pub const BB_HALF_HZ: f64 = 100.0;

/// FFT plans, built once and shared by every slot and candidate.
pub struct Plans {
    forward: Arc<dyn RealToComplex<f32>>,
    inverse_bb: Arc<dyn Fft<f32>>,
    taper: Vec<f32>,
}

impl Default for Plans {
    fn default() -> Self {
        Self::new()
    }
}

impl Plans {
    /// Plans the slot FFT and the baseband IFFT.
    pub fn new() -> Self {
        let forward = RealFftPlanner::<f32>::new().plan_fft_forward(SLOT_SAMPLES);
        let inverse_bb = FftPlanner::<f32>::new().plan_fft_inverse(BB_SAMPLES);
        let df = crate::DSP_RATE_HZ / SLOT_SAMPLES as f64;
        let half = BB_SAMPLES / 2;
        // Taper over signed bin offset: flat to BB_FLAT_HZ, raised cosine to zero at BB_HALF_HZ.
        let taper = (0..BB_SAMPLES)
            .map(|i| {
                let off = if i < half { i as f64 } else { i as f64 - BB_SAMPLES as f64 };
                let f = (off * df).abs();
                if f <= BB_FLAT_HZ {
                    1.0
                } else if f >= BB_HALF_HZ {
                    0.0
                } else {
                    let x = (f - BB_FLAT_HZ) / (BB_HALF_HZ - BB_FLAT_HZ);
                    (0.5 * (1.0 + (std::f64::consts::PI * x).cos())) as f32
                }
            })
            .collect();
        Plans { forward, inverse_bb, taper }
    }
}

/// The spectrum of one slot window (or of a SIC residual).
pub struct SlotSpectrum {
    bins: Vec<Complex32>,
}

impl SlotSpectrum {
    /// Transforms a slot window. `samples.len()` must be `SLOT_SAMPLES`.
    pub fn new(plans: &Plans, samples: &[f32]) -> Self {
        assert_eq!(samples.len(), SLOT_SAMPLES, "a slot window is 27 s at 6 kHz");
        let mut input = samples.to_vec();
        let mut bins = plans.forward.make_output_vec();
        plans.forward.process(&mut input, &mut bins).expect("sizes fixed at plan time");
        SlotSpectrum { bins }
    }

    /// Bin spacing, Hz.
    pub fn bin_hz() -> f64 {
        crate::DSP_RATE_HZ / SLOT_SAMPLES as f64
    }

    /// Complex baseband at 200 Hz centred on `centre_hz` (which becomes 0 Hz), covering the whole
    /// slot. Returns the samples and the exact frequency that was put at 0 Hz (the centre rounded
    /// to a bin; the caller corrects the remainder).
    pub fn baseband(&self, plans: &Plans, centre_hz: f64) -> (Vec<Complex32>, f64) {
        let df = Self::bin_hz();
        let kc = (centre_hz / df).round() as i64;
        let half = (BB_SAMPLES / 2) as i64;
        let mut buf = vec![Complex32::new(0.0, 0.0); BB_SAMPLES];
        let scale = 1.0 / SLOT_SAMPLES as f32;
        for (i, b) in buf.iter_mut().enumerate() {
            let off = if (i as i64) < half { i as i64 } else { i as i64 - BB_SAMPLES as i64 };
            let k = kc + off;
            if k >= 0 && (k as usize) < self.bins.len() {
                *b = self.bins[k as usize] * (plans.taper[i] * scale);
            }
        }
        plans.inverse_bb.process(&mut buf);
        (buf, kc as f64 * df)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lands_on_the_expected_baseband_frequency_and_amplitude() {
        let plans = Plans::new();
        let f = 1234.5f64;
        let x: Vec<f32> = (0..SLOT_SAMPLES).map(|n| (2.0 * std::f64::consts::PI * f * n as f64 / 6000.0).cos() as f32).collect();
        let spec = SlotSpectrum::new(&plans, &x);
        let (bb, centre) = spec.baseband(&plans, 1220.0);
        // A cosine of amplitude 1 appears as a complex exponential of amplitude 1/2.
        let mid = &bb[1000..4000];
        let mean_mag: f32 = mid.iter().map(|c| c.norm()).sum::<f32>() / mid.len() as f32;
        assert!((mean_mag - 0.5).abs() < 0.01, "{mean_mag}");
        // Phase advances at (f - centre) Hz per second.
        let rot = (mid[1] * mid[0].conj()).arg() as f64;
        let measured = rot * BB_RATE_HZ / (2.0 * std::f64::consts::PI);
        assert!((measured - (f - centre)).abs() < 0.01, "{measured} vs {}", f - centre);
    }
}
