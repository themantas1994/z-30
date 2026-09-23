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

/// ITU-R F.1487 conditions (the reference's `WATTERSON_PRESETS`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Watterson {
    /// Differential delay between the two paths, ms.
    pub delay_ms: f64,
    /// Doppler spread (2-sigma width of the Gaussian tap spectrum), Hz.
    pub doppler_hz: f64,
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
        let sigma_f = (w.doppler_hz / 2.0).max(1e-6);
        for (i, v) in t.iter_mut().enumerate() {
            let f = if i <= n / 2 { i as f64 } else { i as f64 - n as f64 } * fs / n as f64;
            *v *= (-0.5 * (f / sigma_f).powi(2)).exp();
        }
        inv.process(&mut t);
        let p = t.iter().map(|z| z.norm_sqr()).sum::<f64>() / n as f64;
        if p > 0.0 {
            for v in t.iter_mut() {
                *v /= p.sqrt();
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
