#![allow(clippy::needless_range_loop)]
//! Seeded, deterministic channel models for testing and benchmarking the receiver.
//!
//! Test tooling only: nothing in the receive path depends on this crate. Every function takes
//! an explicit generator, so the same seed gives the same band on every platform (ChaCha8 is
//! specified bit-for-bit, unlike a platform RNG).
//!
//! SNR convention (SPEC.md section 10): signal power over noise power in 2500 Hz, for real white
//! noise of per-sample variance sigma^2 at rate fs: `SNR = P / (sigma^2 * 5000 / fs)`.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rand_distr::{Distribution, StandardNormal};
use rustfft::num_complex::Complex64;
use rustfft::FftPlanner;
use z30_protocol::gfsk::Modulator;
use z30_protocol::ldpc::encode_payload;
use z30_protocol::symbols::codeword_to_symbols;
use z30_protocol::{PAYLOAD_BITS, TOTAL_SYMBOLS};

/// The generator used throughout.
pub type ChannelRng = ChaCha8Rng;

/// A generator from a seed.
pub fn rng(seed: u64) -> ChannelRng {
    ChaCha8Rng::seed_from_u64(seed)
}

/// Sample rate of the synthesised slots (the receiver's DSP rate).
pub const FS: f64 = 6000.0;
/// Slot window length in samples ([slot - 1.5 s, slot + 25.5 s]).
pub const SLOT_SAMPLES: usize = 162_000;
/// Index of the slot boundary within the window.
pub const SLOT_ZERO_INDEX: usize = 9_000;

/// A random 63-bit payload and the 75 symbols that carry it.
pub fn random_frame(rng: &mut ChannelRng) -> ([u8; PAYLOAD_BITS], [u8; TOTAL_SYMBOLS]) {
    let mut payload = [0u8; PAYLOAD_BITS];
    for b in payload.iter_mut() {
        *b = rng.gen_range(0..2);
    }
    let symbols = codeword_to_symbols(&encode_payload(&payload));
    (payload, symbols)
}

/// ITU-R F.1487 conditions (the reference's `WATTERSON_PRESETS`): two independently fading
/// paths of equal average power, a differential delay between them, and a Doppler spread.
///
/// **Doppler spread, defined.** Each path's complex tap `g(t)` is a zero-mean complex Gaussian
/// process whose Doppler POWER spectral density is a Gaussian centred on 0 Hz,
///
/// ```text
///   S(f) = exp(-f^2 / (2 sigma_D^2)) / (sqrt(2 pi) sigma_D),     sigma_D = doppler_hz / 2,
/// ```
///
/// i.e. `doppler_hz` is the two-sided "2-sigma" frequency spread `2 sigma_D` of the power
/// spectrum, the convention of ITU-R F.1487 / CCIR Report 549 (Watterson, Juroshek & Bensema
/// 1970). Equivalently the tap's normalised autocorrelation is
/// `rho(tau) = exp(-2 pi^2 sigma_D^2 tau^2)`. Units: Hz; `doppler_hz = 0.5` means
/// `sigma_D = 0.25 Hz`.
///
/// **How it is generated** (`fade`): white complex Gaussian noise is shaped in the frequency
/// domain by the AMPLITUDE response `H(f) = sqrt(S(f)) ~ exp(-f^2 / (4 sigma_D^2))`, so that
/// `|H(f)|^2` is the power spectrum above, then normalised to unit ensemble power.
///
/// Until 2026-09-24 both this crate and the oracle applied `exp(-f^2 / (2 sigma_D^2))` as the
/// amplitude response. Its square, the power spectrum, then had standard deviation
/// `sigma_D / sqrt 2`: every preset ran at 1/sqrt 2 of its labelled Doppler spread ("moderate
/// 0.5 Hz" measured 0.353 Hz, "high-latitude moderate 10 Hz" 7.07 Hz; post-remediation audit
/// N-01), and the fading figures published from it described slower channels than they named.
/// `tests::watterson_power_spectrum_has_the_labelled_2_sigma_spread` and
/// `tests::generated_taps_have_the_labelled_doppler_spread` fail on that defect.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Watterson {
    /// Differential delay between the two paths, ms.
    pub delay_ms: f64,
    /// Doppler spread: twice the standard deviation of the tap's Gaussian Doppler POWER
    /// spectrum (the ITU-R F.1487 "2-sigma" spread), Hz. See the type's documentation.
    pub doppler_hz: f64,
}

/// Standard deviation of the Doppler power spectrum for a spread of `doppler_hz` (2 sigma).
pub fn doppler_sigma_hz(doppler_hz: f64) -> f64 {
    doppler_hz / 2.0
}

/// The tap filter's power response `|H(f)|^2 = exp(-f^2 / (2 sigma_D^2))` (unnormalised).
pub fn doppler_power_response(f_hz: f64, doppler_hz: f64) -> f64 {
    let sigma = doppler_sigma_hz(doppler_hz).max(1e-6);
    (-0.5 * (f_hz / sigma).powi(2)).exp()
}

/// The tap filter's amplitude response `H(f) = sqrt(|H(f)|^2) = exp(-f^2 / (4 sigma_D^2))`.
pub fn doppler_amplitude_response(f_hz: f64, doppler_hz: f64) -> f64 {
    doppler_power_response(f_hz, doppler_hz).sqrt()
}

impl Watterson {
    /// Named presets, by the reference's keys.
    pub fn preset(name: &str) -> Option<Watterson> {
        Some(match name {
            "good" => Watterson { delay_ms: 0.5, doppler_hz: 0.1 },
            "moderate" => Watterson { delay_ms: 1.0, doppler_hz: 0.5 },
            "poor" => Watterson { delay_ms: 2.0, doppler_hz: 1.0 },
            "high-moderate" => Watterson { delay_ms: 3.0, doppler_hz: 10.0 },
            _ => return None,
        })
    }
}

/// One transmitting station as the receiver hears it.
#[derive(Clone, Debug)]
pub struct Station {
    /// The 75 channel symbols.
    pub symbols: [u8; TOTAL_SYMBOLS],
    /// Tone-0 frequency, Hz.
    pub f0_hz: f64,
    /// Frame start relative to the slot boundary, seconds.
    pub dt_sec: f64,
    /// SNR in 2500 Hz.
    pub snr_db: f64,
    /// Total linear carrier drift across the frame, Hz (zero at mid-frame).
    pub drift_hz: f64,
    /// Carrier phase, radians.
    pub phase_rad: f64,
    /// Fading, if any.
    pub fading: Option<Watterson>,
}

/// A slot's worth of band.
#[derive(Clone, Debug, Default)]
pub struct Band {
    /// Stations.
    pub stations: Vec<Station>,
    /// CW carriers: (frequency Hz, SNR in 2500 Hz).
    pub cw: Vec<(f64, f64)>,
    /// Receiver sample-clock error, ppm (positive = the sound card runs fast).
    pub rx_clock_ppm: f64,
    /// Whether to add noise (sigma = 1).
    pub noise: bool,
}

/// Mean power of a real unit-peak z-30 frame (measured once; the ramps make it slightly < 0.5).
pub fn unit_frame_power(m: &Modulator) -> f64 {
    let (re, _) = m.analytic(&[0u8; TOTAL_SYMBOLS], 1000.0, 0.0, 0.0);
    re.iter().map(|v| v * v).sum::<f64>() / re.len() as f64
}

/// Noise sigma that puts a signal of power `p` at `snr_db` (2500 Hz reference).
pub fn sigma_for(p: f64, snr_db: f64, fs: f64) -> f64 {
    (p / (10f64.powf(snr_db / 10.0) * 5000.0 / fs)).sqrt()
}

/// Frequency of FFT bin `i` of `n` at rate `fs`, Hz (negative above n/2).
fn bin_freq(i: usize, n: usize, fs: f64) -> f64 {
    let k = if i <= n / 2 { i as f64 } else { i as f64 - n as f64 };
    k * fs / n as f64
}

fn fade(sig: &mut [Complex64], w: &Watterson, fs: f64, rng: &mut ChannelRng) {
    let n = sig.len();
    let mut planner = FftPlanner::<f64>::new();
    let fwd = planner.plan_fft_forward(n);
    let inv = planner.plan_fft_inverse(n);
    let mut tap = || {
        let mut t: Vec<Complex64> = (0..n)
            .map(|_| {
                let a: f64 = StandardNormal.sample(rng);
                let b: f64 = StandardNormal.sample(rng);
                Complex64::new(a, b) / 2f64.sqrt()
            })
            .collect();
        fwd.process(&mut t);
        // The AMPLITUDE response: its square is the Doppler power spectrum (see `Watterson`).
        for (i, v) in t.iter_mut().enumerate() {
            *v *= doppler_amplitude_response(bin_freq(i, n, fs), w.doppler_hz);
        }
        inv.process(&mut t);
        // Normalise to unit ENSEMBLE power: with unit-variance complex white input and rustfft's
        // unnormalised transforms, E|t|^2 = n * sum_k |H_k|^2 - a constant of the filter, not of
        // this realisation. Dividing by each realisation's own measured power (as this did until
        // the 2026-09-24 audit, H-10) forced every frame to average exactly the requested SNR,
        // which deletes the frame-to-frame Rayleigh power variation that is the dominant
        // impairment when the Doppler spread is small against 1/24 s: the "good" preset measured
        // 87% at -20 dB that way against 53% with the variation kept.
        let h2: f64 = (0..n).map(|i| doppler_power_response(bin_freq(i, n, fs), w.doppler_hz)).sum();
        let scale = (n as f64 * h2).sqrt();
        if scale > 0.0 {
            for v in t.iter_mut() {
                *v /= scale;
            }
        }
        t
    };
    let a = tap();
    let delay = (w.delay_ms * 1e-3 * fs).round() as usize;
    if delay > 0 {
        let b = tap();
        let orig = sig.to_vec();
        for i in 0..n {
            let delayed = if i >= delay { orig[i - delay] } else { Complex64::new(0.0, 0.0) };
            sig[i] = (orig[i] * a[i] + delayed * b[i]) / 2f64.sqrt();
        }
    } else {
        for i in 0..n {
            sig[i] *= a[i];
        }
    }
}

/// Band-limited time stretch by `factor` (FFT resampling): what a receiver whose sample clock
/// runs `factor` times fast records - every frequency scaled by 1/factor, every duration by
/// factor.
pub fn stretch(x: &[f64], factor: f64) -> Vec<f64> {
    let n = x.len();
    let m = (n as f64 * factor).round() as usize;
    if m == n {
        return x.to_vec();
    }
    let mut planner = FftPlanner::<f64>::new();
    let mut buf: Vec<Complex64> = x.iter().map(|&v| Complex64::new(v, 0.0)).collect();
    planner.plan_fft_forward(n).process(&mut buf);
    let mut out = vec![Complex64::new(0.0, 0.0); m];
    let half = n.min(m) / 2;
    for i in 0..half {
        out[i] = buf[i];
        out[m - 1 - i] = buf[n - 1 - i];
    }
    planner.plan_fft_inverse(m).process(&mut out);
    out.iter().map(|z| z.re / n as f64).collect()
}

/// Synthesises one slot window at 6 kHz.
pub fn synthesize(band: &Band, rng: &mut ChannelRng) -> Vec<f32> {
    let m = Modulator::new(FS).expect("6 kHz");
    let p_unit = unit_frame_power(&m);
    let noise_var_2500 = 5000.0 / FS; // sigma = 1
    let mut acc = vec![0.0f64; SLOT_SAMPLES];
    for st in &band.stations {
        let amp = (10f64.powf(st.snr_db / 10.0) * noise_var_2500 / p_unit).sqrt();
        let start = SLOT_ZERO_INDEX as f64 + st.dt_sec * FS;
        let si = start.floor() as i64;
        // Integer placement plus a fractional delay inside the waveform itself.
        let (re, im) = m.analytic(&st.symbols, st.f0_hz, st.drift_hz, start - si as f64);
        let rot = Complex64::from_polar(1.0, st.phase_rad);
        let mut c: Vec<Complex64> = re.iter().zip(&im).map(|(&a, &b)| Complex64::new(a, b) * rot).collect();
        if let Some(w) = &st.fading {
            fade(&mut c, w, FS, rng);
        }
        for (i, z) in c.iter().enumerate() {
            let j = si + i as i64;
            if j >= 0 && (j as usize) < SLOT_SAMPLES {
                acc[j as usize] += amp * z.re;
            }
        }
    }
    for &(f, snr) in &band.cw {
        let a = (2.0 * 10f64.powf(snr / 10.0) * noise_var_2500).sqrt();
        let ph: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
        for (n, v) in acc.iter_mut().enumerate() {
            *v += a * (std::f64::consts::TAU * f * n as f64 / FS + ph).cos();
        }
    }
    if band.rx_clock_ppm != 0.0 {
        let stretched = stretch(&acc, 1.0 + band.rx_clock_ppm * 1e-6);
        // Keep the slot boundary where the receiver believes it is: the error accumulates from
        // there, which is how a free-running sound card behaves between clock corrections.
        acc = vec![0.0; SLOT_SAMPLES];
        let n = stretched.len().min(SLOT_SAMPLES);
        acc[..n].copy_from_slice(&stretched[..n]);
    }
    if band.noise {
        for v in acc.iter_mut() {
            let g: f64 = StandardNormal.sample(rng);
            *v += g;
        }
    }
    acc.iter().map(|&v| v as f32).collect()
}

/// A station with random payload and the given placement; returns its payload too.
pub fn random_station(rng: &mut ChannelRng, f0_hz: f64, dt_sec: f64, snr_db: f64) -> ([u8; PAYLOAD_BITS], Station) {
    let (payload, symbols) = random_frame(rng);
    let phase_rad = rng.gen_range(0.0..std::f64::consts::TAU);
    (payload, Station { symbols, f0_hz, dt_sec, snr_db, drift_hz: 0.0, phase_rad, fading: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic() {
        let band = Band { stations: vec![random_station(&mut rng(1), 1000.0, 0.2, -10.0).1], noise: true, ..Default::default() };
        assert_eq!(synthesize(&band, &mut rng(7)), synthesize(&band, &mut rng(7)));
    }

    #[test]
    fn snr_is_calibrated() {
        // Signal alone vs noise alone, measured in 2500 Hz.
        let (_, st) = random_station(&mut rng(2), 1000.0, 0.0, 0.0);
        let sig = synthesize(&Band { stations: vec![st], noise: false, ..Default::default() }, &mut rng(3));
        let frame = &sig[SLOT_ZERO_INDEX..SLOT_ZERO_INDEX + 144_000];
        let p: f64 = frame.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / frame.len() as f64;
        let noise_2500 = 5000.0 / FS;
        let snr = 10.0 * (p / noise_2500).log10();
        assert!(snr.abs() < 0.05, "{snr}");
    }

    /// Power of a unit-amplitude carrier through `fade`, over one realisation.
    fn faded_power(w: &Watterson, seed: u64) -> f64 {
        let n = 144_000;
        let mut c: Vec<Complex64> = (0..n).map(|i| Complex64::from_polar(1.0, i as f64 * 0.3)).collect();
        fade(&mut c, w, FS, &mut rng(seed));
        c.iter().map(|z| z.norm_sqr()).sum::<f64>() / n as f64
    }

    #[test]
    fn watterson_preserves_power_over_the_ensemble_and_not_per_frame() {
        // H-10: each realisation used to be scaled to exactly unit power, which removed the slow
        // fading a 24 s frame actually experiences. Over many frames the average must be the
        // requested power; frame to frame, the power must vary as much as this channel's
        // Doppler spectrum says it does.
        for name in ["good", "moderate", "poor", "high-moderate"] {
            let w = Watterson::preset(name).unwrap();
            let p: Vec<f64> = (0..300).map(|s| faded_power(&w, 1_000 + s)).collect();
            let mean = p.iter().sum::<f64>() / p.len() as f64;
            let cv = (p.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / p.len() as f64).sqrt() / mean;
            // 300 realisations: the ensemble mean is within a few percent of 1 for every preset.
            assert!((mean - 1.0).abs() < 0.15, "{name}: ensemble mean power {mean:.3}");
            // The taps are shaped circularly over the frame, so a frame's power is a weighted sum
            // of independent exponential bin powers and its coefficient of variation is exactly
            // sqrt(sum |H_k|^4) / sum |H_k|^2. Per-frame normalisation makes it 0. This bound used
            // to be "cv > 0.5" for "good", a number that held only for the 1/sqrt 2-slow channel
            // of audit N-01 (theory 0.58; the corrected 0.1 Hz channel's is 0.49).
            let n = 144_000;
            let pk: Vec<f64> = (0..n).map(|i| doppler_power_response(bin_freq(i, n, FS), w.doppler_hz)).collect();
            let theory = pk.iter().map(|p| p * p).sum::<f64>().sqrt() / pk.iter().sum::<f64>();
            assert!((cv / theory - 1.0).abs() < 0.25, "{name}: frame-power cv {cv:.3}, theory {theory:.3} (per-frame normalisation?)");
            eprintln!("{name}: frame-power cv {cv:.3}, theory {theory:.3}");
        }
    }

    /// 2-sigma spread of the tap Doppler spectrum from `m` realisations, by two methods: the
    /// second moment of the ensemble-averaged periodogram, and the ensemble autocorrelation at
    /// `lag_s` inverted through rho = exp(-2 pi^2 sigma^2 tau^2). Also the ensemble tap power.
    /// The input is a constant carrier (all ones), so `fade`'s output IS the channel gain g(t).
    fn measured_spread(w: &Watterson, m: usize, seed0: u64, lag_s: f64) -> (f64, f64, f64) {
        let n = 144_000;
        let mut planner = FftPlanner::<f64>::new();
        let fwd = planner.plan_fft_forward(n);
        let mut psd = vec![0.0f64; n];
        let (mut ac, mut p0) = (Complex64::new(0.0, 0.0), 0.0f64);
        let l = (lag_s * FS).round() as usize;
        for k in 0..m {
            let mut g = vec![Complex64::new(1.0, 0.0); n];
            fade(&mut g, w, FS, &mut rng(seed0 + k as u64));
            // Skip the first `delay` samples, where the second path has not started.
            let start = (w.delay_ms * 1e-3 * FS).round() as usize;
            for t in start..n - l {
                ac += g[t + l] * g[t].conj();
                p0 += g[t].norm_sqr();
            }
            fwd.process(&mut g);
            for (p, z) in psd.iter_mut().zip(&g) {
                *p += z.norm_sqr();
            }
        }
        let (mut s0, mut s2) = (0.0, 0.0);
        for (i, p) in psd.iter().enumerate() {
            let f = bin_freq(i, n, FS);
            // The spectrum beyond 8 sigma is numerically zero; excluding it keeps the float
            // floor of the FFT out of the second moment.
            if f.abs() <= 4.0 * w.doppler_hz.max(0.05) {
                s0 += p;
                s2 += f * f * p;
            }
        }
        let rho = ac.norm() / p0;
        let from_ac = 2.0 * (-rho.ln()).sqrt() / (std::f64::consts::SQRT_2 * std::f64::consts::PI * lag_s);
        let power = psd.iter().sum::<f64>() / (n as f64 * n as f64 * m as f64);
        (2.0 * (s2 / s0).sqrt(), from_ac, power)
    }

    /// The autocorrelation lag at which rho = exp(-1/2) for the labelled spread: a lag where
    /// the correct and the 1/sqrt 2 spread give clearly different correlations (0.61 vs 0.78).
    fn half_lag(doppler_hz: f64) -> f64 {
        let sigma = doppler_sigma_hz(doppler_hz);
        1.0 / (2.0 * std::f64::consts::PI * sigma)
    }

    #[test]
    #[ignore = "exploratory, ~2 min: the estimator scatter the tolerances above are derived from"]
    fn explore_spread_estimator_scatter() {
        for name in ["good", "moderate", "poor", "high-moderate"] {
            let w = Watterson::preset(name).unwrap();
            for b in 0..6u64 {
                let (psd, ac, p) = measured_spread(&w, 200, 7_000_000 + 1_000 * b, half_lag(w.doppler_hz));
                eprintln!(
                    "{name} batch {b}: psd {:.4} ({:+.2}%) ac {:.4} ({:+.2}%) power {p:.3}",
                    psd,
                    100.0 * (psd / w.doppler_hz - 1.0),
                    ac,
                    100.0 * (ac / w.doppler_hz - 1.0)
                );
            }
        }
    }

    #[test]
    fn watterson_power_spectrum_has_the_labelled_2_sigma_spread() {
        // Deterministic: the filter's own power response |H(f)|^2 on the FFT grid of a 24 s
        // frame at 6 kHz must have standard deviation doppler_hz / 2 (ITU-R F.1487 "2-sigma").
        // The pre-2026-09-24 filter gives doppler_hz / (2 sqrt 2): 29.3% low, far outside 0.5%.
        let n = 144_000;
        for name in ["good", "moderate", "poor", "high-moderate"] {
            let w = Watterson::preset(name).unwrap();
            let (mut s0, mut s2) = (0.0, 0.0);
            for i in 0..n {
                let f = bin_freq(i, n, FS);
                let p = doppler_amplitude_response(f, w.doppler_hz).powi(2);
                s0 += p;
                s2 += f * f * p;
            }
            let two_sigma = 2.0 * (s2 / s0).sqrt();
            assert!((two_sigma / w.doppler_hz - 1.0).abs() < 0.005, "{name}: 2 sigma {two_sigma:.4} Hz vs labelled {} Hz", w.doppler_hz);
            // The amplitude response is the square root of the power response, not the power
            // response itself (the N-01 defect applied exp(-f^2/(2 sigma^2)) as the amplitude).
            let f = doppler_sigma_hz(w.doppler_hz);
            assert!((doppler_amplitude_response(f, w.doppler_hz) - (-0.25f64).exp()).abs() < 1e-12);
        }
    }

    #[test]
    fn generated_taps_have_the_labelled_doppler_spread() {
        // Statistical: 200 realisations of each preset's channel gain, measured two ways. On
        // six independent 200-realisation batches per preset (explore_spread_estimator_scatter)
        // both estimates stayed within 2.4% of the labelled spread for "good" (0.1 Hz: about
        // 1.2 FFT bins of 1/24 Hz, so the fewest independent samples) and within 1.8% for the
        // others; the tolerances are about four times that scatter, and the 1/sqrt 2 defect
        // (-29.3%) is some twenty standard deviations outside them.
        for (name, tol) in [("good", 0.06), ("moderate", 0.03), ("poor", 0.03), ("high-moderate", 0.03)] {
            let w = Watterson::preset(name).unwrap();
            let (psd, ac, power) = measured_spread(&w, 200, 5_000_000, half_lag(w.doppler_hz));
            for (method, v) in [("periodogram", psd), ("autocorrelation", ac)] {
                assert!((v / w.doppler_hz - 1.0).abs() < tol, "{name}: {method} 2-sigma spread {v:.4} Hz vs labelled {} Hz", w.doppler_hz);
            }
            // Ensemble power stays 1 (H-10), measured on the same taps.
            assert!((power - 1.0).abs() < 0.1, "{name}: ensemble power {power:.3}");
        }
    }

    #[test]
    fn stretch_scales_frequency() {
        let x: Vec<f64> = (0..60_000).map(|n| (std::f64::consts::TAU * 1000.0 * n as f64 / FS).cos()).collect();
        let y = stretch(&x, 1.001);
        // Zero crossings per second drop by 0.1%.
        let zc = |v: &[f64]| v.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        let a = zc(&x[..54_000]) as f64;
        let b = zc(&y[..54_000]) as f64;
        assert!(((a - b) / a - 0.001).abs() < 3e-4, "{a} {b}");
    }
}
