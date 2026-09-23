//! Non-coherent 16-FSK demodulation: the reference's mathematics (SPEC.md section 8) on FFT
//! symbol spectra.
//!
//! Per symbol, the dechirped 200 Hz baseband is transformed with a 64-point FFT: bins 0..15 are
//! the 16 tone correlators (the tone spacing is exactly one bin), bins well outside the signal
//! give an unbiased noise estimate. The metric is the exact Rician one, ln I0(|r| a / sigma^2),
//! with the reference's pilot-mean amplitude estimate and Log-MAP bit demapping. The coherence
//! weight is zero: RECEIVER_PILOT_COHERENCE, declared here beside the demodulator because it
//! is the receiver's constant (AGENTS.md section 4), not a benchmark's.

use crate::baseband::BB_NSPS;
use crate::ldpc::Llrs;
use crate::math::{demap16, ln_i0_metric};
use crate::sync::{derotation, FineSync};
use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use std::sync::Arc;
use z30_protocol::{DATA_POSITIONS, N, NUM_TONES, SYNC_POSITIONS, SYNC_TONES, TONE_SPACING_HZ, TOTAL_SYMBOLS};

/// Weight of the coherent term: zero. Measured paired in the reference: the pilot-aided term
/// costs 1.77 dB when the receiver finds its own timing (p = 2.9e-36).
pub const RECEIVER_PILOT_COHERENCE: f64 = 0.0;

/// 64-point FFT bins used for the noise estimate: +62.5..+84.4 Hz and -84.4..-15.6 Hz relative
/// to tone 0, i.e. inside the flat part of the baseband filter and at least 5 bins from any tone.
const NOISE_BINS: [std::ops::Range<usize>; 2] = [20..28, 37..60];

/// A 64-point FFT plan.
pub struct SymbolFft {
    fft: Arc<dyn Fft<f32>>,
}

impl Default for SymbolFft {
    fn default() -> Self {
        Self::new()
    }
}

impl SymbolFft {
    /// Plans it.
    pub fn new() -> Self {
        SymbolFft { fft: FftPlanner::<f32>::new().plan_fft_forward(BB_NSPS) }
    }
}

/// The 75 x 64 symbol spectra of one candidate frame.
pub struct FrameSpectra {
    /// spectra[sym * 64 + bin]
    pub bins: Vec<Complex32>,
}

impl FrameSpectra {
    /// Dechirps and transforms every symbol of the frame described by `sync`.
    pub fn new(bb: &[Complex32], fft: &SymbolFft, sync: &FineSync) -> Self {
        let mut bins = vec![Complex32::new(0.0, 0.0); TOTAL_SYMBOLS * BB_NSPS];
        for s in 0..TOTAL_SYMBOLS {
            let base = sync.start + s * BB_NSPS;
            let out = &mut bins[s * BB_NSPS..(s + 1) * BB_NSPS];
            for m in 0..BB_NSPS {
                out[m] = bb[base + m] * derotation((s * BB_NSPS + m) as f64, sync.df_hz, sync.drift_hz);
            }
            fft.fft.process(out);
        }
        FrameSpectra { bins }
    }

    #[inline]
    fn tone(&self, sym: usize, t: usize) -> Complex32 {
        self.bins[sym * BB_NSPS + t]
    }

    /// Per-dimension noise variance of one bin, from the median of the out-of-signal bins
    /// (|n|^2 is exponential with mean 2 sigma^2; its median is 2 sigma^2 ln 2). A median, so
    /// another station in part of those bins does not inflate it.
    pub fn noise_sigma2(&self) -> f64 {
        let mut v: Vec<f32> = Vec::with_capacity(TOTAL_SYMBOLS * 31);
        for s in 0..TOTAL_SYMBOLS {
            for r in NOISE_BINS.iter() {
                for b in r.clone() {
                    v.push(self.bins[s * BB_NSPS + b].norm_sqr());
                }
            }
        }
        let mid = v.len() / 2;
        let med = *v.select_nth_unstable_by(mid, |a, b| a.partial_cmp(b).unwrap()).1 as f64;
        (med / (2.0 * std::f64::consts::LN_2)).max(1e-30)
    }

    /// Mean sync-tone correlator magnitude (the reference's amplitude estimate).
    pub fn pilot_amplitude(&self) -> f64 {
        let s: f64 = SYNC_POSITIONS.iter().zip(SYNC_TONES.iter()).map(|(&p, &t)| self.tone(p, t as usize).norm() as f64).sum();
        s / SYNC_POSITIONS.len() as f64
    }

    /// Channel LLRs for the 216 coded bits.
    pub fn llrs(&self) -> Llrs {
        self.llrs_with(false)
    }

    /// Per-tone noise variance: the global estimate, raised for any tone bin whose median energy
    /// across the frame is well above it. A frame occupies each tone in only ~1/16 of its
    /// symbols, so a tone's median is the noise in that bin - unless something stationary sits
    /// there (a carrier, a birdie, another station's steady tone), which is exactly what should
    /// be discounted.
    pub fn tone_sigma2(&self) -> [f64; NUM_TONES] {
        let sigma2 = self.noise_sigma2();
        let mut out = [sigma2; NUM_TONES];
        let mut col = [0.0f32; TOTAL_SYMBOLS];
        for (t, o) in out.iter_mut().enumerate() {
            for (s, c) in col.iter_mut().enumerate() {
                *c = self.tone(s, t).norm_sqr();
            }
            let med = *col.select_nth_unstable_by(TOTAL_SYMBOLS / 2, |a, b| a.partial_cmp(b).unwrap()).1 as f64;
            let est = med / (2.0 * std::f64::consts::LN_2);
            // 2x the global estimate is ~6 standard deviations of a 75-symbol median on pure
            // noise: only real stationary interference crosses it.
            if est > 2.0 * sigma2 {
                *o = est;
            }
        }
        out
    }

    /// Channel LLRs, optionally with per-tone interference whitening. With per-tone noise
    /// variances the exact non-coherent metric is `ln I0(a |r_k| / s_k^2) - a^2 / (2 s_k^2)`;
    /// with equal variances the second term is common to all tones and drops out, which is the
    /// reference metric exactly.
    pub fn llrs_with(&self, whiten: bool) -> Llrs {
        let sigma2 = self.noise_sigma2();
        let amp = self.pilot_amplitude().max(1e-30);
        let tone_s2 = if whiten { self.tone_sigma2() } else { [sigma2; NUM_TONES] };
        let mut out = [0.0f32; N];
        let mut likes = [0.0f64; NUM_TONES];
        for (d, &pos) in DATA_POSITIONS.iter().enumerate() {
            for (t, l) in likes.iter_mut().enumerate() {
                let s2 = tone_s2[t];
                let z = self.tone(pos, t).norm() as f64 * amp / s2;
                *l = ln_i0_metric(z) - amp * amp / (2.0 * s2) + amp * amp / (2.0 * sigma2);
            }
            out[d * 4..d * 4 + 4].copy_from_slice(&demap16(&likes));
        }
        out
    }

    /// SNR in the 2500 Hz reference bandwidth, measured on the frame's own tones once they are
    /// known (after a successful decode): signal energy per symbol in its tone bin, less the
    /// noise, over the noise in one 3.125 Hz bin, rescaled to 2500 Hz. Clamped to -40 dB when
    /// the estimate is not positive; that is a floor, not a measurement.
    pub fn snr_db(&self, symbols: &[u8; TOTAL_SYMBOLS]) -> f64 {
        let n_bin = 2.0 * self.noise_sigma2();
        let e: f64 = (0..TOTAL_SYMBOLS).map(|s| self.tone(s, symbols[s] as usize).norm_sqr() as f64).sum::<f64>() / TOTAL_SYMBOLS as f64;
        let s = e - n_bin;
        if s <= 0.0 {
            return -40.0;
        }
        (10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10()).max(-40.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coherence_weight_is_the_shipped_zero() {
        assert_eq!(RECEIVER_PILOT_COHERENCE, 0.0);
    }
}
