//! Rational polyphase resampler, streaming. Replaces the shipped 8-tap moving average plus
//! linear interpolation, which was only -3.9 dB down at the new Nyquist and folded 3-9 kHz
//! sound-card noise into the band (audit M2).
//!
//! Kaiser-windowed sinc prototype designed for >= 80 dB stopband with the transition band
//! placed at the edge of the output band, so aliases land above the z-30 passband.

use z30_protocol::samples_per_symbol;

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

fn bessel_i0(x: f64) -> f64 {
    crate::math::i0(x)
}

/// Streaming L/M resampler.
pub struct Resampler {
    up: usize,
    down: usize,
    /// taps[phase][k]
    taps: Vec<Vec<f32>>,
    taps_per_phase: usize,
    history: Vec<f32>,
    /// Position of the next output on the upsampled grid, relative to the start of `history`.
    phase_acc: u64,
    in_rate: u64,
    out_rate: u64,
}

impl Resampler {
    /// A resampler from `in_rate` to `out_rate` Hz. `passband_hz` is the highest frequency that
    /// must survive (defaults sensibly to 95% of the smaller Nyquist).
    pub fn new(in_rate: u32, out_rate: u32, passband_hz: Option<f64>) -> Self {
        let g = gcd(in_rate as u64, out_rate as u64);
        let up = (out_rate as u64 / g) as usize;
        let down = (in_rate as u64 / g) as usize;
        let nyq = in_rate.min(out_rate) as f64 / 2.0;
        let pass = passband_hz.unwrap_or(0.95 * nyq).min(0.99 * nyq);
        // Transition band [pass, stop], symmetric about the output Nyquist, so everything that
        // folds lands above `pass`.
        let stop = 2.0 * nyq - pass;
        let hi_rate = in_rate as f64 * up as f64;
        let cutoff = 0.5 * (pass + stop.min(2.0 * nyq)) / hi_rate; // cycles per high-rate sample
        let atten = 80.0;
        let beta = 0.1102 * (atten - 8.7);
        let dw = 2.0 * std::f64::consts::PI * (stop - pass).max(1.0) / hi_rate;
        let mut n = ((atten - 8.0) / (2.285 * dw)).ceil() as usize + 1;
        n = n.div_ceil(up) * up;
        let m = (n - 1) as f64;
        let i0b = bessel_i0(beta);
        let proto: Vec<f64> = (0..n)
            .map(|i| {
                let t = i as f64 - m / 2.0;
                let sinc =
                    if t == 0.0 { 2.0 * cutoff } else { (2.0 * std::f64::consts::PI * cutoff * t).sin() / (std::f64::consts::PI * t) };
                let r = 2.0 * i as f64 / m - 1.0;
                let w = bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / i0b;
                sinc * w * up as f64
            })
            .collect();
        let taps_per_phase = n / up;
        let taps = (0..up).map(|p| (0..taps_per_phase).map(|k| proto[k * up + p] as f32).collect()).collect();
        Resampler {
            up,
            down,
            taps,
            taps_per_phase,
            history: vec![0.0; taps_per_phase],
            phase_acc: 0,
            in_rate: in_rate as u64,
            out_rate: out_rate as u64,
        }
    }

    /// Output sample `k` (counted from the first output) is centred on input sample
    /// `k * in_rate / out_rate + input_delay()`. The receiver's clock model uses this to put
    /// every resampled sample at the instant it actually represents.
    pub fn input_delay(&self) -> f64 {
        // The history starts with `taps_per_phase` zeros, so history index h is input index
        // h - tpp; output k's newest tap is history pos + tpp - 1 and the prototype's centre sits
        // (N - 1) / 2 high-rate samples behind it.
        let n = (self.taps_per_phase * self.up) as f64;
        -1.0 - (n - 1.0) / (2.0 * self.up as f64)
    }

    /// Input rate / output rate.
    pub fn ratio(&self) -> f64 {
        self.in_rate as f64 / self.out_rate as f64
    }

    /// Resamples `input`, appending to `out`. Keeps state between calls; the output sample
    /// count over a long stream is exactly `in * out_rate / in_rate` (to within one sample).
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.history.extend_from_slice(input);
        let tpp = self.taps_per_phase;
        // Output k uses high-rate index phase_acc; input index = phase_acc / up.
        loop {
            let pos = self.phase_acc / self.up as u64;
            let phase = (self.phase_acc % self.up as u64) as usize;
            let newest = pos as usize + tpp - 1;
            if newest >= self.history.len() {
                break;
            }
            let taps = &self.taps[phase];
            let mut acc = 0.0f32;
            // history[pos .. pos + tpp], newest last; taps[k] multiplies the sample k*up behind.
            for k in 0..tpp {
                acc += taps[k] * self.history[newest - k];
            }
            out.push(acc);
            self.phase_acc += self.down as u64;
        }
        // Drop consumed input, keeping the filter memory.
        let consumed = (self.phase_acc / self.up as u64) as usize;
        if consumed > 0 {
            self.history.drain(..consumed.min(self.history.len()));
            self.phase_acc -= (consumed as u64) * self.up as u64;
        }
    }
}

/// Whether `rate` gives a whole number of samples per z-30 symbol (the modulator needs it).
pub fn rate_supports_symbols(rate: f64) -> bool {
    let n = rate * 0.32;
    (n - n.round()).abs() < 1e-6 && samples_per_symbol(rate) > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: f64, f: f64, n: usize) -> Vec<f32> {
        (0..n).map(|i| (2.0 * std::f64::consts::PI * f * i as f64 / rate).sin() as f32).collect()
    }

    fn power(x: &[f32]) -> f64 {
        x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() / x.len() as f64
    }

    #[test]
    fn passes_the_band_and_rejects_aliases() {
        for &rate in &[48_000u32, 44_100, 12_000] {
            let mut r = Resampler::new(rate, 6000, Some(2850.0));
            let mut out = Vec::new();
            r.process(&tone(rate as f64, 1500.0, rate as usize), &mut out);
            let p = power(&out[2000..5000]);
            assert!((p - 0.5).abs() < 0.01, "{rate}: in-band power {p}");
            if rate > 7000 {
                // 4.5 kHz would alias to 1.5 kHz.
                let mut r = Resampler::new(rate, 6000, Some(2850.0));
                let mut out = Vec::new();
                r.process(&tone(rate as f64, 4500.0, rate as usize), &mut out);
                let p = power(&out[2000..5000]);
                assert!(p < 0.5e-7, "{rate}: alias power {p}");
            }
        }
    }

    #[test]
    fn input_delay_locates_an_impulse() {
        for &rate in &[48_000u32, 44_100, 12_000] {
            let mut r = Resampler::new(rate, 6000, Some(2850.0));
            let i0 = 50_000usize;
            let mut x = vec![0.0f32; 100_000];
            x[i0] = 1.0;
            let mut out = Vec::new();
            r.process(&x, &mut out);
            let (k, _) = out.iter().enumerate().fold((0, 0.0f32), |b, (i, &v)| if v > b.1 { (i, v) } else { b });
            let located = k as f64 * r.ratio() + r.input_delay();
            assert!((located - i0 as f64).abs() <= r.ratio(), "{rate}: {located} vs {i0}");
        }
    }

    #[test]
    fn streaming_equals_one_shot() {
        let x = tone(48_000.0, 1000.0, 48_000);
        let mut a = Resampler::new(48_000, 6000, None);
        let mut one = Vec::new();
        a.process(&x, &mut one);
        let mut b = Resampler::new(48_000, 6000, None);
        let mut many = Vec::new();
        for chunk in x.chunks(441) {
            b.process(chunk, &mut many);
        }
        assert_eq!(one, many);
    }
}
