//! Successive interference cancellation by least squares.
//!
//! The shipped SIC subtracted `amp * replica` where the replica was the obsolete per-symbol-
//! ramped waveform and the carrier phase was assumed zero; measured, it *added* 2.6 dB of the
//! station's power on average and later passes re-decoded the same station (audit C3). This one:
//!
//! 1. regenerates the exact transmitted GFSK waveform with the one modulator in `z30-protocol`,
//!    at the decoded symbols, frequency and drift;
//! 2. estimates a slowly varying complex gain g(t) - amplitude, carrier phase, residual
//!    frequency and fading - by least squares over a sliding window: for a real received
//!    x = Re(g c) + n with analytic replica c, `x c* = g |c|^2 / 2 + (a term at twice the
//!    carrier)`, so a low-pass of `x c*` divided by a low-pass of `|c|^2 / 2` is the LS estimate
//!    of g (WSJT-X's `subtractft8` construction);
//! 3. refines timing to one sample (0.17 ms at 6 kHz) by minimising the residual energy;
//! 4. subtracts Re(g c) and measures what is left of the component.

use rustfft::num_complex::Complex64;
use z30_protocol::gfsk::Modulator;
use z30_protocol::TOTAL_SYMBOLS;

/// Tuning of the subtraction.
#[derive(Clone, Copy, Debug)]
pub struct SicParams {
    /// Length of the triangular gain-tracking window, seconds. Shorter tracks faster fading;
    /// longer averages more noise out of the gain estimate.
    pub window_sec: f64,
    /// Timing search half-width around the fine-sync estimate, samples at 6 kHz.
    pub timing_search: i64,
}

impl Default for SicParams {
    fn default() -> Self {
        SicParams { window_sec: 0.4, timing_search: 16 }
    }
}

/// What one subtraction did.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Subtraction {
    /// Energy of the fitted component before subtraction.
    pub component_before: f64,
    /// Energy of the same component fitted again to the residual.
    pub component_after: f64,
    /// `10 log10(before / after)`. Positive = removed.
    pub suppression_db: f64,
    /// Timing correction chosen by the search, samples.
    pub timing_offset: i64,
}

/// Centred moving average of length `w` (odd) over complex data, zero outside.
fn boxcar(x: &[Complex64], w: usize) -> Vec<Complex64> {
    let n = x.len();
    let h = w / 2;
    let mut prefix = vec![Complex64::new(0.0, 0.0); n + 1];
    for i in 0..n {
        prefix[i + 1] = prefix[i] + x[i];
    }
    (0..n)
        .map(|i| {
            let lo = i.saturating_sub(h);
            let hi = (i + h + 1).min(n);
            prefix[hi] - prefix[lo]
        })
        .collect()
}

fn triangle(x: &[Complex64], w: usize) -> Vec<Complex64> {
    boxcar(&boxcar(x, w), w)
}

struct Replica {
    c: Vec<Complex64>,
    den: Vec<f64>,
}

fn replica(modulator: &Modulator, symbols: &[u8; TOTAL_SYMBOLS], f0_hz: f64, drift_hz: f64, w: usize) -> Replica {
    let (re, im) = modulator.analytic(symbols, f0_hz, drift_hz, 0.0);
    let c: Vec<Complex64> = re.iter().zip(&im).map(|(&a, &b)| Complex64::new(a, b)).collect();
    let mag: Vec<Complex64> = c.iter().map(|z| Complex64::new(z.norm_sqr() / 2.0, 0.0)).collect();
    let den = triangle(&mag, w).iter().map(|z| z.re).collect();
    Replica { c, den }
}

/// Fitted component Re(g c) for the replica placed at `start` in `x` (samples outside `x` are
/// treated as zero). Returns the component and the residual energy it leaves over its span.
fn fit(x: &[f32], rep: &Replica, start: i64, w: usize) -> (Vec<f64>, f64) {
    let n = rep.c.len();
    let prod: Vec<Complex64> = (0..n)
        .map(|i| {
            let j = start + i as i64;
            let xv = if j >= 0 && (j as usize) < x.len() { x[j as usize] as f64 } else { 0.0 };
            rep.c[i].conj() * xv
        })
        .collect();
    let num = triangle(&prod, w);
    let mut comp = vec![0.0f64; n];
    let mut resid = 0.0f64;
    for i in 0..n {
        let g = if rep.den[i] > 1e-9 { num[i] / rep.den[i] } else { Complex64::new(0.0, 0.0) };
        comp[i] = (g * rep.c[i]).re;
        let j = start + i as i64;
        if j >= 0 && (j as usize) < x.len() {
            let r = x[j as usize] as f64 - comp[i];
            resid += r * r;
        }
    }
    (comp, resid)
}

/// A decoded frame to remove, and where the timing search put it.
pub struct Planned {
    rep: Replica,
    w: usize,
    /// Timing correction chosen, samples.
    pub offset: i64,
    start: i64,
}

/// The expensive half of a subtraction: builds the replica and searches timing against
/// `residual` without modifying it. Independent per decode, so a pass can plan every decode in
/// parallel and then apply them in order.
pub fn plan(
    residual: &[f32],
    modulator: &Modulator,
    symbols: &[u8; TOTAL_SYMBOLS],
    f0_hz: f64,
    drift_hz: f64,
    start: i64,
    params: &SicParams,
) -> Planned {
    let w = (((params.window_sec * modulator.sample_rate()) / 2.0) as usize) | 1;
    let rep = replica(modulator, symbols, f0_hz, drift_hz, w);
    // Coarse-to-fine timing: every 4 samples across the window, then +-1, +-2 around the best.
    let mut best = (f64::INFINITY, 0i64);
    let probe = |e: i64, best: &mut (f64, i64)| {
        let (_, r) = fit(residual, &rep, start + e, w);
        if r < best.0 {
            *best = (r, e);
        }
    };
    let mut e = -params.timing_search;
    while e <= params.timing_search {
        probe(e, &mut best);
        e += 4;
    }
    let centre = best.1;
    for d in [-2, -1, 1, 2] {
        probe(centre + d, &mut best);
    }
    Planned { rep, w, offset: best.1, start }
}

/// The cheap half: fits the gain on the current residual at the planned timing and subtracts.
pub fn apply(residual: &mut [f32], p: &Planned) -> Subtraction {
    let at = p.start + p.offset;
    let (comp, _) = fit(residual, &p.rep, at, p.w);
    let before: f64 = comp.iter().map(|v| v * v).sum();
    for (i, v) in comp.iter().enumerate() {
        let j = at + i as i64;
        if j >= 0 && (j as usize) < residual.len() {
            residual[j as usize] -= *v as f32;
        }
    }
    let (after_comp, _) = fit(residual, &p.rep, at, p.w);
    let after: f64 = after_comp.iter().map(|v| v * v).sum::<f64>().max(1e-30);
    Subtraction {
        component_before: before,
        component_after: after,
        suppression_db: 10.0 * (before / after).log10(),
        timing_offset: p.offset,
    }
}

/// Subtracts one decoded frame from `residual` (6 kHz samples) in place.
///
/// `start` is the fine-sync estimate of the frame's first sample in `residual`; `f0_hz` the
/// absolute tone-0 frequency; `drift_hz` the total linear drift across the frame.
pub fn subtract(
    residual: &mut [f32],
    modulator: &Modulator,
    symbols: &[u8; TOTAL_SYMBOLS],
    f0_hz: f64,
    drift_hz: f64,
    start: i64,
    params: &SicParams,
) -> Subtraction {
    let p = plan(residual, modulator, symbols, f0_hz, drift_hz, start, params);
    apply(residual, &p)
}
