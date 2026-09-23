//! Continuous-phase, constant-envelope GFSK (BT = 2.0) modulator. SPEC.md section 1.
//!
//! One implementation, used for three things that must agree: the transmitter, the SIC replica
//! (the audit found the shipped SIC subtracting an obsolete per-symbol-ramped waveform that the
//! transmitter had stopped sending, C3), and the test channels.
//!
//! The float64 accumulation order in `instantaneous_frequency` is the reference's
//! (`Z30Modulator.instantaneous_frequency`); changing it moves the output in the last bits.

use crate::{NUM_TONES, SYMBOL_SEC, TONE_SPACING_HZ, TOTAL_SYMBOLS};

/// Gaussian bandwidth-time product.
pub const GFSK_BT: f64 = 2.0;
/// Raised-cosine ramp at each end of the frame, seconds. Never per symbol.
pub const FRAME_RAMP_SEC: f64 = 0.020;

/// Errors a caller can make; each would otherwise be a malformed emission.
#[derive(Debug, Clone, PartialEq)]
pub enum ModulatorError {
    /// `fs * 0.320` is not a positive whole number of samples.
    BadSampleRate(f64),
    /// A symbol outside 0..=15.
    BadSymbol(u8),
    /// Base frequency not positive, or the top tone at or above Nyquist.
    BadFrequency(f64),
}

impl std::fmt::Display for ModulatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModulatorError::BadSampleRate(fs) => write!(f, "sample rate {fs} Hz does not give a whole number of samples per 320 ms symbol"),
            ModulatorError::BadSymbol(s) => write!(f, "symbol {s} is outside 0..=15"),
            ModulatorError::BadFrequency(hz) => write!(f, "base frequency {hz} Hz is not usable at this sample rate"),
        }
    }
}

impl std::error::Error for ModulatorError {}

/// The Gaussian-smoothed rectangular frequency pulse, three symbols long.
pub fn frequency_pulse(bt: f64, nsps: usize) -> Vec<f64> {
    let c = std::f64::consts::PI * (2.0 / std::f64::consts::LN_2).sqrt();
    (0..3 * nsps)
        .map(|n| {
            let t = (n as f64 - 1.5 * nsps as f64) / nsps as f64;
            0.5 * (libm::erf(c * bt * (t + 0.5)) - libm::erf(c * bt * (t - 0.5)))
        })
        .collect()
}

/// A modulator for one sample rate.
#[derive(Clone, Debug)]
pub struct Modulator {
    fs: f64,
    nsps: usize,
    pulse: Vec<f64>,
}

impl Modulator {
    /// A modulator at `sample_rate_hz`. The rate must give a whole number of samples per symbol
    /// (6000, 8000, 11025, 12000, 16000, 22050, 24000, 44100, 48000, 96000 ... all do).
    pub fn new(sample_rate_hz: f64) -> Result<Self, ModulatorError> {
        let exact = sample_rate_hz * SYMBOL_SEC;
        if !sample_rate_hz.is_finite() || sample_rate_hz <= 0.0 || (exact - exact.round()).abs() > 1e-6 || exact.round() < 16.0 {
            return Err(ModulatorError::BadSampleRate(sample_rate_hz));
        }
        let nsps = crate::samples_per_symbol(sample_rate_hz);
        Ok(Modulator { fs: sample_rate_hz, nsps, pulse: frequency_pulse(GFSK_BT, nsps) })
    }

    /// Sample rate, Hz.
    pub fn sample_rate(&self) -> f64 {
        self.fs
    }

    /// Samples per symbol.
    pub fn nsps(&self) -> usize {
        self.nsps
    }

    /// Samples in a frame.
    pub fn frame_len(&self) -> usize {
        self.nsps * TOTAL_SYMBOLS
    }

    fn validate(&self, symbols: &[u8; TOTAL_SYMBOLS], f0: f64) -> Result<(), ModulatorError> {
        if let Some(&s) = symbols.iter().find(|&&s| s as usize >= NUM_TONES) {
            return Err(ModulatorError::BadSymbol(s));
        }
        let top = f0 + (NUM_TONES - 1) as f64 * TONE_SPACING_HZ + 10.0;
        if !f0.is_finite() || f0 <= 0.0 || top >= self.fs / 2.0 {
            return Err(ModulatorError::BadFrequency(f0));
        }
        Ok(())
    }

    /// Instantaneous frequency in Hz for every sample of the frame (SPEC.md 1.2).
    pub fn instantaneous_frequency(&self, symbols: &[u8; TOTAL_SYMBOLS], f0: f64) -> Vec<f64> {
        let nsps = self.nsps;
        let nsym = TOTAL_SYMBOLS;
        let freqs: Vec<f64> = symbols.iter().map(|&t| f0 + t as f64 * TONE_SPACING_HZ).collect();
        let mut ext = vec![0.0f64; (nsym + 2) * nsps];
        for (i, e) in ext[..2 * nsps].iter_mut().enumerate() {
            *e += freqs[0] * self.pulse[nsps + i];
        }
        for (j, &fj) in freqs.iter().enumerate() {
            let start = j * nsps;
            for (i, &p) in self.pulse.iter().enumerate() {
                ext[start + i] += fj * p;
            }
        }
        for (i, e) in ext[(nsym + 1) * nsps..].iter_mut().enumerate() {
            *e += freqs[nsym - 1] * self.pulse[i];
        }
        ext[nsps..(nsym + 1) * nsps].to_vec()
    }

    /// Unity envelope with one raised-cosine ramp at each end.
    pub fn envelope(&self, n: usize) -> Vec<f64> {
        let mut env = vec![1.0f64; n];
        let ramp_len = ((FRAME_RAMP_SEC * self.fs) as usize).min(n / 2);
        for i in 0..ramp_len {
            let r = 0.5 * (1.0 - (std::f64::consts::PI * i as f64 / ramp_len as f64).cos());
            env[i] = r;
            env[n - 1 - i] = r;
        }
        env
    }

    /// Carrier phase in radians for every sample: `2 pi cumsum(f) / fs`.
    pub fn phase(&self, symbols: &[u8; TOTAL_SYMBOLS], f0: f64) -> Vec<f64> {
        let f = self.instantaneous_frequency(symbols, f0);
        let mut acc = 0.0f64;
        f.iter()
            .map(|&x| {
                acc += x;
                2.0 * std::f64::consts::PI * acc / self.fs
            })
            .collect()
    }

    /// The transmitted frame: float32, peak-normalised to 1.0. Bit-for-bit the reference's
    /// algorithm (SPEC.md 1.3); equal to it within 1e-6.
    pub fn synthesize(&self, symbols: &[u8; TOTAL_SYMBOLS], f0: f64) -> Result<Vec<f32>, ModulatorError> {
        self.validate(symbols, f0)?;
        let phase = self.phase(symbols, f0);
        let env = self.envelope(phase.len());
        let w: Vec<f64> = phase.iter().zip(&env).map(|(p, e)| p.sin() * e).collect();
        let peak = w.iter().fold(0.0f64, |m, &x| m.max(x.abs()));
        if peak < 1e-9 {
            return Err(ModulatorError::BadFrequency(f0));
        }
        Ok(w.iter().map(|&x| (x / peak) as f32).collect())
    }

    /// Complex analytic replica `env(t) exp(j phase(t))`, with an optional linear frequency
    /// drift (`drift_hz` total across the frame, zero at mid-frame) and a fractional start
    /// offset in samples. Used by SIC and the fine-sync reference; unnormalised (peak ~1).
    pub fn analytic(&self, symbols: &[u8; TOTAL_SYMBOLS], f0: f64, drift_hz: f64, frac_delay: f64) -> (Vec<f64>, Vec<f64>) {
        let f = self.instantaneous_frequency(symbols, f0);
        let n = f.len();
        let env = self.envelope(n);
        let frame_sec = n as f64 / self.fs;
        let mut re = Vec::with_capacity(n);
        let mut im = Vec::with_capacity(n);
        let mut acc = 0.0f64;
        for i in 0..n {
            // Sample i is taken at time (i - frac_delay)/fs relative to the frame start.
            let t = (i as f64 - frac_delay) / self.fs;
            let drift = drift_hz * (t / frame_sec - 0.5);
            acc += f[i] + drift;
            // Integrate to the delayed sample instant: subtract the fraction of this sample's
            // frequency that the delay shifts out.
            let ph = 2.0 * std::f64::consts::PI * (acc - frac_delay * (f[i] + drift)) / self.fs;
            re.push(env[i] * ph.cos());
            im.push(env[i] * ph.sin());
        }
        (re, im)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulses_sum_to_one_in_the_interior() {
        let nsps = 64;
        let p = frequency_pulse(GFSK_BT, nsps);
        for i in 0..nsps {
            let s = p[i] + p[i + nsps] + p[i + 2 * nsps];
            assert!((s - 1.0).abs() < 1e-9, "sample {i}: {s}");
        }
    }

    #[test]
    fn constant_envelope_between_the_ramps() {
        let m = Modulator::new(6000.0).unwrap();
        let symbols = [5u8; TOTAL_SYMBOLS];
        let (re, im) = m.analytic(&symbols, 1000.0, 0.0, 0.0);
        let r = (FRAME_RAMP_SEC * 6000.0) as usize;
        for i in r..re.len() - r {
            let a = (re[i] * re[i] + im[i] * im[i]).sqrt();
            assert!((a - 1.0).abs() < 1e-12);
        }
    }

    #[test]
    fn refuses_what_would_be_a_malformed_emission() {
        assert!(Modulator::new(6001.0).is_err());
        let m = Modulator::new(6000.0).unwrap();
        let mut s = [0u8; TOTAL_SYMBOLS];
        assert!(m.synthesize(&s, 0.0).is_err());
        assert!(m.synthesize(&s, 2990.0).is_err());
        s[3] = 16;
        assert!(m.synthesize(&s, 1000.0).is_err());
    }
}
