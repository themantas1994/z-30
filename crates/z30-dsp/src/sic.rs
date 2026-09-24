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

/// Samples per gain-estimation block. The gain g(t) is a low-pass quantity (the tracking window
/// is 0.4 s), so it is estimated on 20-sample (3.3 ms) blocks and interpolated linearly: the
/// same least-squares estimate at a fraction of the memory traffic of doing it per sample.
const BLOCK: usize = 20;

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
    /// Block-rate low-pass of |c|^2 / 2 (the least-squares denominator).
    den: Vec<f64>,
}

fn replica(modulator: &Modulator, symbols: &[u8; TOTAL_SYMBOLS], f0_hz: f64, drift_hz: f64, wb: usize) -> Replica {
    let (re, im) = modulator.analytic(symbols, f0_hz, drift_hz, 0.0);
    let c: Vec<Complex64> = re.iter().zip(&im).map(|(&a, &b)| Complex64::new(a, b)).collect();
    let blocks: Vec<Complex64> = c.chunks(BLOCK).map(|ch| Complex64::new(ch.iter().map(|z| z.norm_sqr() / 2.0).sum(), 0.0)).collect();
    let den = triangle(&blocks, wb).iter().map(|z| z.re).collect();
    Replica { c, den }
}

/// The replica indices `i` whose sample `start + i` lies inside `x`.
#[inline]
fn span(x_len: usize, n: usize, start: i64) -> std::ops::Range<usize> {
    let lo = (-start).clamp(0, n as i64) as usize;
    let hi = (x_len as i64 - start).clamp(lo as i64, n as i64) as usize;
    lo..hi
}

/// Least-squares gain per block for the replica placed at `start` in `x` (outside `x` = 0).
fn gains(x: &[f32], rep: &Replica, start: i64, wb: usize) -> Vec<Complex64> {
    let n = rep.c.len();
    let inside = span(x.len(), n, start);
    let blocks: Vec<Complex64> = (0..n.div_ceil(BLOCK))
        .map(|b| {
            let lo = (b * BLOCK).max(inside.start);
            let hi = ((b + 1) * BLOCK).min(n).min(inside.end);
            let mut acc = Complex64::new(0.0, 0.0);
            for i in lo..hi.max(lo) {
                acc += rep.c[i].conj() * x[(start + i as i64) as usize] as f64;
            }
            acc
        })
        .collect();
    let num = triangle(&blocks, wb);
    num.iter().zip(&rep.den).map(|(n, &d)| if d > 1e-9 { n / d } else { Complex64::new(0.0, 0.0) }).collect()
}

/// Calls `f(j, v)` for every sample `j = start + i` inside `x`, with `v = Re(g(i) c[i])` and g(i)
/// the block gains linearly interpolated between block centres (held flat before the first and
/// after the last). The interpolation is walked incrementally, one segment between adjacent
/// centres at a time, because this loop is most of what a subtraction costs.
#[inline]
fn for_each_fitted(x_len: usize, rep: &Replica, g: &[Complex64], start: i64, mut f: impl FnMut(usize, f64)) {
    let n = rep.c.len();
    let inside = span(x_len, n, start);
    let half = BLOCK / 2;
    // Segment k covers [k B + B/2, (k+1) B + B/2): from centre k towards centre k+1. Segment -1
    // (the head) and the last one hold the end gains.
    let mut seg_lo = 0usize;
    for k in 0..=g.len() {
        let seg_hi = if k < g.len() { (k * BLOCK + half).min(n) } else { n };
        let (mut gi, d) = if k == 0 {
            (g[0], Complex64::new(0.0, 0.0))
        } else if k == g.len() {
            (g[k - 1], Complex64::new(0.0, 0.0))
        } else {
            let d = (g[k] - g[k - 1]) / BLOCK as f64;
            // Centre k-1 sits at sample (k-1) B + (B-1)/2; the segment's first sample is half a
            // sample past the midpoint of that and the next.
            (g[k - 1] + d * (seg_lo as f64 - ((k - 1) * BLOCK) as f64 - (BLOCK as f64 - 1.0) / 2.0), d)
        };
        let lo = seg_lo.max(inside.start);
        if lo > seg_lo {
            gi += d * (lo - seg_lo) as f64;
        }
        for i in lo..seg_hi.min(inside.end) {
            let c = rep.c[i];
            f((start + i as i64) as usize, gi.re * c.re - gi.im * c.im);
            gi += d;
        }
        seg_lo = seg_hi;
        if seg_lo >= n {
            break;
        }
    }
}

/// Residual energy over the replica's span after removing the fitted component, without
/// materialising anything.
fn residual_energy(x: &[f32], rep: &Replica, start: i64, wb: usize) -> f64 {
    let g = gains(x, rep, start, wb);
    let mut resid = 0.0;
    for_each_fitted(x.len(), rep, &g, start, |j, v| {
        let r = x[j] as f64 - v;
        resid += r * r;
    });
    resid
}

/// Subtracts the fitted component from `x` in place; returns its energy.
fn subtract_fitted(x: &mut [f32], rep: &Replica, start: i64, wb: usize) -> f64 {
    let g = gains(x, rep, start, wb);
    let mut energy = 0.0;
    for_each_fitted(x.len(), rep, &g, start, |j, v| {
        energy += v * v;
        x[j] -= v as f32;
    });
    energy
}

/// Energy of the component a fit would find in `x` (used to measure what is left).
fn fitted_energy(x: &[f32], rep: &Replica, start: i64, wb: usize) -> f64 {
    let g = gains(x, rep, start, wb);
    let mut energy = 0.0;
    for_each_fitted(x.len(), rep, &g, start, |_, v| energy += v * v);
    energy
}

/// A decoded frame to remove, and where the timing search put it.
pub struct Planned {
    rep: Replica,
    wb: usize,
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
    // Two boxcars of half the window each make the triangular tracking window.
    let wb = (((params.window_sec * modulator.sample_rate()) / 2.0 / BLOCK as f64) as usize) | 1;
    let rep = replica(modulator, symbols, f0_hz, drift_hz, wb);
    // Timing by descent on the residual energy, starting from the fine-sync estimate (already
    // interpolated to a fraction of the 5 ms baseband grid): steps of 2 samples while that
    // improves, then +-1. Typically five fits instead of a 13-point scan, and bounded by
    // `timing_search` whatever the residual looks like.
    let energy = |e: i64| residual_energy(residual, &rep, start + e, wb);
    let mut best = (energy(0), 0i64);
    for step in [2i64, 1] {
        loop {
            let mut moved = false;
            for e in [best.1 - step, best.1 + step] {
                if e.abs() > params.timing_search {
                    continue;
                }
                let r = energy(e);
                if r < best.0 {
                    best = (r, e);
                    moved = true;
                }
            }
            if !moved {
                break;
            }
        }
    }
    Planned { rep, wb, offset: best.1, start }
}

/// The cheap half: fits the gain on the current residual at the planned timing and subtracts.
pub fn apply(residual: &mut [f32], p: &Planned) -> Subtraction {
    let at = p.start + p.offset;
    let before = subtract_fitted(residual, &p.rep, at, p.wb);
    let after = fitted_energy(residual, &p.rep, at, p.wb).max(1e-30);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The segment walk must reproduce the per-sample interpolation it replaced exactly (to
    /// rounding), including at both ends and with the replica hanging off either edge of `x`.
    #[test]
    fn incremental_interpolation_matches_direct() {
        let n: usize = 1003;
        let c: Vec<Complex64> = (0..n).map(|i| Complex64::from_polar(1.0, i as f64 * 0.37)).collect();
        let rep = Replica { c, den: vec![] };
        let g: Vec<Complex64> = (0..n.div_ceil(BLOCK)).map(|b| Complex64::new((b as f64 * 0.7).sin(), (b as f64 * 0.3).cos())).collect();
        let direct = |i: usize| {
            let pos = (i as f64 + 0.5) / BLOCK as f64 - 0.5;
            let gi = if pos <= 0.0 {
                g[0]
            } else {
                let k = pos.floor() as usize;
                if k + 1 >= g.len() {
                    g[g.len() - 1]
                } else {
                    g[k] * (1.0 - (pos - k as f64)) + g[k + 1] * (pos - k as f64)
                }
            };
            (gi * rep.c[i]).re
        };
        for (x_len, start) in [(n, 0i64), (5000, 700), (600, -150), (900, 200), (n, -2000), (100, 400)] {
            let mut seen = Vec::new();
            for_each_fitted(x_len, &rep, &g, start, |j, v| seen.push((j, v)));
            let want: Vec<usize> = (0..n).filter(|&i| (0..x_len as i64).contains(&(start + i as i64))).collect();
            assert_eq!(seen.len(), want.len(), "x_len {x_len} start {start}");
            for (&(j, v), &i) in seen.iter().zip(&want) {
                assert_eq!(j as i64, start + i as i64);
                assert!((v - direct(i)).abs() < 1e-12, "i {i}: {v} vs {}", direct(i));
            }
        }
    }
}
