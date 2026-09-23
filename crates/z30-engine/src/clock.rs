//! Sample clock <-> UTC.
//!
//! The sample counter is the master clock (audit I.1). The shipped app mapped samples to UTC
//! with one `Date.now()` taken at capture start, never re-anchored and blind to device latency
//! and sound-card drift (H5): 100 ppm is 0.36 s an hour, so after a few hours frames leave the
//! +-1.5 s search. Here UTC is a *model fitted to* the sample counter: every audio callback
//! contributes an observation (absolute sample index of the callback's first sample, the
//! system's UTC estimate of when that sample was captured), and a least-squares line over a
//! sliding window gives both the offset and the device's true rate. Callback timestamp jitter
//! averages out; drift is tracked, not accumulated.
//!
//! Discontinuities (device restart, overrun, a jump in the system clock) start a new epoch: the
//! fit restarts, and nothing before the epoch is mixed with anything after it.

use std::collections::VecDeque;

/// One observation: sample `index` was captured at `utc` (seconds since the Unix epoch).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Observation {
    /// Absolute sample index (in the stream's own samples).
    pub index: u64,
    /// UTC seconds.
    pub utc: f64,
}

/// A drift-tracking linear fit `utc = t0 + (index - n0) * period`.
#[derive(Clone, Debug)]
pub struct SampleClock {
    nominal_rate: f64,
    window: VecDeque<Observation>,
    window_sec: f64,
    epoch: u32,
    epoch_start_index: u64,
    fit: Option<(f64, f64, u64)>, // (t0, period, n0)
    /// Largest residual (s) accepted before an observation is treated as a discontinuity.
    jump_tolerance_sec: f64,
}

impl SampleClock {
    /// A clock for a stream at `nominal_rate` samples per second.
    pub fn new(nominal_rate: f64) -> Self {
        SampleClock {
            nominal_rate,
            window: VecDeque::new(),
            window_sec: 120.0,
            epoch: 0,
            epoch_start_index: 0,
            fit: None,
            jump_tolerance_sec: 0.25,
        }
    }

    /// Current epoch (incremented at every discontinuity).
    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// First sample index of the current epoch.
    pub fn epoch_start_index(&self) -> u64 {
        self.epoch_start_index
    }

    /// Starts a new epoch at `index` (device restart, overrun, explicit discontinuity).
    pub fn new_epoch(&mut self, index: u64) {
        self.epoch += 1;
        self.epoch_start_index = index;
        self.window.clear();
        self.fit = None;
    }

    /// Adds an observation. Returns true if it was a discontinuity (and started a new epoch).
    pub fn observe(&mut self, o: Observation) -> bool {
        if let Some(predicted) = self.utc_at(o.index) {
            if (predicted - o.utc).abs() > self.jump_tolerance_sec {
                self.new_epoch(o.index);
                self.window.push_back(o);
                self.refit();
                return true;
            }
        }
        self.window.push_back(o);
        while let (Some(first), Some(last)) = (self.window.front(), self.window.back()) {
            if last.utc - first.utc > self.window_sec && self.window.len() > 2 {
                self.window.pop_front();
            } else {
                break;
            }
        }
        self.refit();
        false
    }

    fn refit(&mut self) {
        let n = self.window.len();
        if n == 0 {
            self.fit = None;
            return;
        }
        let n0 = self.window[0].index;
        let t0 = self.window[0].utc;
        if n < 8 || (self.window[n - 1].utc - t0) < 2.0 {
            // Too short to estimate the rate: nominal rate, offset averaged over what we have.
            let period = 1.0 / self.nominal_rate;
            let off = self.window.iter().map(|o| o.utc - t0 - (o.index - n0) as f64 * period).sum::<f64>() / n as f64;
            self.fit = Some((t0 + off, period, n0));
            return;
        }
        // Least squares on (x = index - n0, y = utc - t0), centred for conditioning.
        let xs: Vec<f64> = self.window.iter().map(|o| (o.index - n0) as f64).collect();
        let ys: Vec<f64> = self.window.iter().map(|o| o.utc - t0).collect();
        let mx = xs.iter().sum::<f64>() / n as f64;
        let my = ys.iter().sum::<f64>() / n as f64;
        let (mut sxy, mut sxx) = (0.0, 0.0);
        for i in 0..n {
            sxy += (xs[i] - mx) * (ys[i] - my);
            sxx += (xs[i] - mx) * (xs[i] - mx);
        }
        let mut period = if sxx > 0.0 { sxy / sxx } else { 1.0 / self.nominal_rate };
        // A sound card more than 1% off nominal is not drift, it is a wrong rate; clamp so one
        // bad window cannot throw the model away.
        let nominal = 1.0 / self.nominal_rate;
        period = period.clamp(nominal * 0.99, nominal * 1.01);
        self.fit = Some((t0 + my - period * mx, period, n0));
    }

    /// UTC of sample `index`, if the clock has any observation in this epoch.
    pub fn utc_at(&self, index: u64) -> Option<f64> {
        let (t0, period, n0) = self.fit?;
        Some(t0 + (index as f64 - n0 as f64) * period)
    }

    /// Sample index (fractional) at UTC `t`.
    pub fn index_at(&self, t: f64) -> Option<f64> {
        let (t0, period, n0) = self.fit?;
        Some(n0 as f64 + (t - t0) / period)
    }

    /// Estimated rate error of the device, ppm (positive = device runs fast).
    pub fn drift_ppm(&self) -> Option<f64> {
        let (_, period, _) = self.fit?;
        Some((1.0 / (period * self.nominal_rate) - 1.0) * 1e6)
    }

    /// Whether the fit is based on enough data to estimate the rate.
    pub fn is_locked(&self) -> bool {
        self.window.len() >= 8 && self.window.back().zip(self.window.front()).is_some_and(|(b, f)| b.utc - f.utc >= 2.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_a_drifting_device_with_jittery_timestamps() {
        let fs = 6000.0;
        let ppm = 180.0;
        let true_rate = fs * (1.0 + ppm * 1e-6);
        let mut c = SampleClock::new(fs);
        let t_start = 1_700_000_000.0;
        let mut state = 1u64;
        for k in 0..3600u64 {
            let idx = k * 600; // a callback every 0.1 s of samples
            let true_t = t_start + idx as f64 / true_rate;
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            let jitter = ((state >> 40) as f64 / (1u64 << 24) as f64 - 0.5) * 0.004; // +-2 ms
            c.observe(Observation { index: idx, utc: true_t + jitter });
        }
        let idx = 3600 * 600;
        let err = c.utc_at(idx).unwrap() - (t_start + idx as f64 / true_rate);
        assert!(err.abs() < 0.002, "{err}");
        assert!((c.drift_ppm().unwrap() - ppm).abs() < 5.0, "{:?}", c.drift_ppm());
    }

    #[test]
    fn a_jump_starts_a_new_epoch() {
        let mut c = SampleClock::new(6000.0);
        for k in 0..20u64 {
            c.observe(Observation { index: k * 600, utc: 100.0 + k as f64 * 0.1 });
        }
        assert!(c.observe(Observation { index: 20 * 600, utc: 105.0 }));
        assert_eq!(c.epoch(), 1);
        assert_eq!(c.epoch_start_index(), 12_000);
    }
}
