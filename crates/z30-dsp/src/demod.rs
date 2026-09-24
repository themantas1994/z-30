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

    /// SNR in the 2500 Hz reference bandwidth (SPEC.md section 10), measured on the decoded
    /// frame once its symbols are known.
    ///
    /// `replica` is the noise-free frame at the decoded symbols, placed where fine sync put it,
    /// in these same symbol spectra (`replica_spectra`). Per symbol, a least-squares complex
    /// gain `g_s` fits the replica to the received spectrum over the signal's own bins; then
    ///
    /// - signal energy per symbol `S = mean_s |g_s|^2 ||R_s||^2 - n_bin` (the LS projection
    ///   carries one complex dimension of noise, whose expected energy is `n_bin`),
    /// - noise energy per 3.125 Hz bin `n_bin` from the off-signal bins of the RESIDUAL
    ///   `Y_s - g_s R_s` (median, so another station there does not inflate it),
    /// - `SNR = 10 log10(S / n_bin) - 10 log10(2500 / 3.125)`.
    ///
    /// The residual is what makes this valid for strong signals. The previous estimator took
    /// the noise from the off-tone bins of the received spectrum itself, and for a strong
    /// signal those bins hold the frame's own GFSK sidelobes: it read +10 dB as +5.4 and
    /// saturated near +6.6 dB (2026-09-24 audit, M-07), and the QSO engine sent reports
    /// derived from it. The accuracy is measured, not assumed:
    /// `tests/snr_accuracy.rs` asserts it over `SNR_VALIDATED_MIN_DB..=SNR_VALIDATED_MAX_DB`.
    ///
    /// Returns `None` when the signal estimate is not positive: that is not a measurement, and
    /// a floor value would be reported as one.
    pub fn snr_db(&self, replica: &[Complex32]) -> Option<f64> {
        assert_eq!(replica.len(), self.bins.len(), "replica spectra cover the same 75 x 64 bins");
        let mut resid: Vec<f32> = Vec::with_capacity(TOTAL_SYMBOLS * 31);
        let mut s_sum = 0.0f64;
        let mut bias_sum = 0.0f64;
        for s in 0..TOTAL_SYMBOLS {
            let y = &self.bins[s * BB_NSPS..(s + 1) * BB_NSPS];
            let r = &replica[s * BB_NSPS..(s + 1) * BB_NSPS];
            let (mut num, mut den_fit) = (Complex32::new(0.0, 0.0), 0.0f64);
            for b in FIT_BINS.iter().flat_map(|r| r.clone()) {
                num += r[b].conj() * y[b];
                den_fit += r[b].norm_sqr() as f64;
            }
            let den_all: f64 = r.iter().map(|z| z.norm_sqr() as f64).sum();
            if den_fit <= 0.0 {
                // The replica has no energy in this window (the frame hangs off the slot).
                for rg in NOISE_BINS.iter() {
                    for b in rg.clone() {
                        resid.push(y[b].norm_sqr());
                    }
                }
                continue;
            }
            let g = num / den_fit as f32;
            s_sum += g.norm_sqr() as f64 * den_all;
            bias_sum += den_all / den_fit;
            for rg in NOISE_BINS.iter() {
                for b in rg.clone() {
                    resid.push((y[b] - g * r[b]).norm_sqr());
                }
            }
        }
        let mid = resid.len() / 2;
        let med = *resid.select_nth_unstable_by(mid, |a, b| a.partial_cmp(b).unwrap()).1 as f64;
        let n_bin = (med / std::f64::consts::LN_2).max(1e-30);
        let s = (s_sum - n_bin * bias_sum) / TOTAL_SYMBOLS as f64;
        (s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())
    }
}

impl FrameSpectra {
    /// Energy left over the fit and noise bins after the per-symbol least-squares replica fit
    /// that `snr_db` makes. Smooth in the replica's placement, so it can be minimised to put
    /// the replica where the frame really is.
    pub fn fit_residual_energy(&self, replica: &[Complex32]) -> f64 {
        let mut e = 0.0f64;
        for s in 0..TOTAL_SYMBOLS {
            let y = &self.bins[s * BB_NSPS..(s + 1) * BB_NSPS];
            let r = &replica[s * BB_NSPS..(s + 1) * BB_NSPS];
            let (mut num, mut den) = (Complex32::new(0.0, 0.0), 0.0f32);
            for b in FIT_BINS.iter().flat_map(|r| r.clone()) {
                num += r[b].conj() * y[b];
                den += r[b].norm_sqr();
            }
            let g = if den > 0.0 { num / den } else { Complex32::new(0.0, 0.0) };
            for b in FIT_BINS.iter().chain(NOISE_BINS.iter()).flat_map(|r| r.clone()) {
                e += (y[b] - g * r[b]).norm_sqr() as f64;
            }
        }
        e
    }
}

/// The replica for `snr_db` and the offset it was placed at, by least squares: starting from
/// fine sync's timing, the 6 kHz offset that minimises the fitted residual (descent in steps of
/// 4, 2, 1 samples, bounded to +-`MAX_REPLICA_SHIFT`). Fine sync's timing carries a bias of a few ms (the audit
/// measured +2.8 ms), and a replica that far off leaves the frame's tone transitions in the
/// residual, which caps the measurable SNR near +15 dB.
pub fn placed_replica(
    spectra: &FrameSpectra,
    fft: &SymbolFft,
    modulator_6k: &z30_protocol::gfsk::Modulator,
    symbols: &[u8; TOTAL_SYMBOLS],
    offset_6k: i64,
) -> (Vec<Complex32>, i64) {
    let eval = |off: i64| {
        let r = replica_spectra(fft, modulator_6k, symbols, off);
        (spectra.fit_residual_energy(&r), r)
    };
    let (mut best_e, mut best_r) = eval(offset_6k);
    let mut best_off = offset_6k;
    for step in [4i64, 2, 1] {
        loop {
            let mut moved = false;
            for cand in [best_off - step, best_off + step] {
                if (cand - offset_6k).abs() > MAX_REPLICA_SHIFT {
                    continue;
                }
                let (e, r) = eval(cand);
                if e < best_e {
                    (best_e, best_r, best_off, moved) = (e, r, cand, true);
                }
            }
            if !moved {
                break;
            }
        }
    }
    (best_r, best_off)
}

/// Largest correction `placed_replica` applies to fine sync's timing, 6 kHz samples (5 ms).
pub const MAX_REPLICA_SHIFT: i64 = 30;

/// Bins the per-symbol replica gain is fitted over: the 16 tones and two guard bins each side
/// (-6.25..+53.1 Hz from tone 0), where nearly all of a frame's energy is.
const FIT_BINS: [std::ops::Range<usize>; 2] = [0..18, 62..64];

/// The lower edge of the range over which `FrameSpectra::snr_db` has been measured against the
/// truth (tests/snr_accuracy.rs: bias within +-0.6 dB, spread within 0.8 dB). Below it frames
/// rarely decode and the estimate has not been characterised.
pub const SNR_VALIDATED_MIN_DB: f64 = -22.0;
/// The upper edge of that range. +30 dB is also the largest report v1 can carry.
pub const SNR_VALIDATED_MAX_DB: f64 = 30.0;

/// The decoded frame, noise-free, in the demodulator's symbol spectra: the same 64-point
/// transform on the same 200 Hz symbol grid as `FrameSpectra::new`, after the same
/// derotation (so tone k sits on bin k). `offset_6k` is where the frame really starts relative
/// to the grid's first symbol, in 6 kHz samples (fine sync's sub-sample timing; the demodulator
/// keeps its windows on the integer grid). Synthesised at 6 kHz from the one modulator and
/// sampled every 30th sample, so the GFSK transitions sit where the transmitter put them.
pub fn replica_spectra(
    fft: &SymbolFft,
    modulator_6k: &z30_protocol::gfsk::Modulator,
    symbols: &[u8; TOTAL_SYMBOLS],
    offset_6k: i64,
) -> Vec<Complex32> {
    let fs = modulator_6k.sample_rate();
    let decim = (fs / crate::baseband::BB_RATE_HZ).round() as i64;
    let f = modulator_6k.instantaneous_frequency(symbols, 0.0);
    let env = modulator_6k.envelope(f.len());
    let mut phase = Vec::with_capacity(f.len());
    let mut acc = 0.0f64;
    for &x in &f {
        acc += x;
        if acc >= fs {
            acc -= fs;
        }
        phase.push(2.0 * std::f64::consts::PI * acc / fs);
    }
    let mut bins = vec![Complex32::new(0.0, 0.0); TOTAL_SYMBOLS * BB_NSPS];
    for (m, b) in bins.iter_mut().enumerate() {
        let i = m as i64 * decim - offset_6k;
        if i >= 0 && (i as usize) < phase.len() {
            let (sn, cs) = phase[i as usize].sin_cos();
            *b = Complex32::new((env[i as usize] * cs) as f32, (env[i as usize] * sn) as f32);
        }
    }
    for s in 0..TOTAL_SYMBOLS {
        fft.fft.process(&mut bins[s * BB_NSPS..(s + 1) * BB_NSPS]);
    }
    bins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coherence_weight_is_the_shipped_zero() {
        assert_eq!(RECEIVER_PILOT_COHERENCE, 0.0);
    }
}
