//! Costas-array synchronisation: a multi-candidate coarse search over the whole passband, then a
//! fine search of timing, frequency and linear frequency drift per candidate.
//!
//! Coarse: `acquisition.py`'s metric (the sum of power at the 21 known sync tones), extended from
//! one global peak to every local maximum, as WSJT-X's `sync8` does, and normalised against the
//! power in all 16 tone bins at the same instants - so band noise shape, a strong neighbour or a
//! CW carrier raise the denominator along with the numerator. The audit measured that searching
//! the whole passband with this metric loses nothing against the benchmark's +-12 Hz window
//! (200 paired frames, 0 discordant).
//!
//! Fine: on the 200 Hz complex baseband, the same 21-symbol metric evaluated on a grid of
//! (dt, df, drift). Drift is the audit's H9: at -22 dB, 2 Hz of drift across the frame cost
//! 10 of 37 decodes and 4 Hz cost all but one, because nothing modelled it.
//!
//! There is no carrier loop and no symbol-timing loop. This is non-coherent FSK with 320 ms
//! symbols; frame timing comes from the Costas array once per frame (audit section C.4).

use crate::baseband::{BB_NSPS, BB_RATE_HZ, SLOT_SAMPLES, SLOT_ZERO_INDEX};
use crate::DSP_NSPS;
use realfft::RealFftPlanner;
use rustfft::num_complex::{Complex32, Complex64};
use z30_protocol::{DT_SEARCH_SEC, FRAME_SEC, NUM_TONES, SYNC_POSITIONS, SYNC_TONES, TONE_SPACING_HZ, TOTAL_SYMBOLS};

/// Spectrogram hops per symbol (40 ms at 6 kHz).
pub const TIME_OVERSAMPLE: usize = 8;
/// Spectrogram bins per tone spacing (0.78 Hz).
pub const FREQ_OVERSAMPLE: usize = 4;
const HOP: usize = DSP_NSPS / TIME_OVERSAMPLE;
const NFFT: usize = DSP_NSPS * FREQ_OVERSAMPLE;

/// A coarse candidate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidate {
    /// Frame start relative to the slot boundary, seconds.
    pub dt_sec: f64,
    /// Base (tone-0) frequency, Hz.
    pub f0_hz: f64,
    /// Normalised sync metric (about 1 on noise).
    pub sync: f64,
}

/// The symbol-rate power spectrogram of a slot, restricted to the search band.
pub struct Spectrogram {
    /// power[row * width + col]
    power: Vec<f32>,
    rows: usize,
    width: usize,
    /// Absolute FFT bin of column 0.
    col0: usize,
}

impl Spectrogram {
    /// Hann-windowed, zero-padded 4x, hop 1/8 symbol, over `[lo_hz, hi_hz]`.
    pub fn new(samples: &[f32], lo_hz: f64, hi_hz: f64) -> Self {
        assert_eq!(samples.len(), SLOT_SAMPLES);
        let bin_hz = crate::DSP_RATE_HZ / NFFT as f64;
        let col0 = (lo_hz / bin_hz).floor().max(0.0) as usize;
        let col1 = ((hi_hz / bin_hz).ceil() as usize).min(NFFT / 2);
        let width = col1 - col0;
        let rows = (SLOT_SAMPLES - DSP_NSPS) / HOP + 1;
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(NFFT);
        let window: Vec<f32> =
            (0..DSP_NSPS).map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / DSP_NSPS as f64).cos()) as f32).collect();
        let mut input = fft.make_input_vec();
        let mut out = fft.make_output_vec();
        let mut power = vec![0.0f32; rows * width];
        for r in 0..rows {
            let s = r * HOP;
            for i in 0..DSP_NSPS {
                input[i] = samples[s + i] * window[i];
            }
            for v in input[DSP_NSPS..].iter_mut() {
                *v = 0.0;
            }
            fft.process(&mut input, &mut out).expect("fixed size");
            let row = &mut power[r * width..(r + 1) * width];
            for (c, p) in row.iter_mut().enumerate() {
                *p = out[col0 + c].norm_sqr();
            }
        }
        Spectrogram { power, rows, width, col0 }
    }

    fn bin_hz() -> f64 {
        crate::DSP_RATE_HZ / NFFT as f64
    }

    /// Candidates, strongest first, deterministic order, at most `max`.
    pub fn candidates(&self, threshold: f64, max: usize, lo_hz: f64, hi_hz: f64) -> Vec<Candidate> {
        let span = (NUM_TONES - 1) * FREQ_OVERSAMPLE;
        if self.width <= span + 2 {
            return vec![];
        }
        // Frame starts from DT = -1.5 s to +1.5 s, in hops.
        let zero_row = SLOT_ZERO_INDEX / HOP;
        let dt_rows = (DT_SEARCH_SEC * crate::DSP_RATE_HZ / HOP as f64).round() as usize;
        let t_lo = zero_row.saturating_sub(dt_rows);
        let last_sync_row = SYNC_POSITIONS[SYNC_POSITIONS.len() - 1] * TIME_OVERSAMPLE;
        let t_hi = (zero_row + dt_rows).min(self.rows - 1 - last_sync_row);
        let cols = self.width - span;
        let ntimes = t_hi - t_lo + 1;

        // Per-row sum of the 16 tone bins starting at each column (the local reference).
        let mut tone_sum = vec![0.0f32; self.rows * cols];
        for r in 0..self.rows {
            let row = &self.power[r * self.width..(r + 1) * self.width];
            for c in 0..cols {
                let mut s = 0.0f32;
                for j in 0..NUM_TONES {
                    s += row[c + j * FREQ_OVERSAMPLE];
                }
                tone_sum[r * cols + c] = s;
            }
        }
        let mut map = vec![0.0f32; ntimes * cols];
        for ti in 0..ntimes {
            let t = t_lo + ti;
            for c in 0..cols {
                let (mut num, mut den) = (0.0f32, 0.0f32);
                for (k, &pos) in SYNC_POSITIONS.iter().enumerate() {
                    let r = t + pos * TIME_OVERSAMPLE;
                    num += self.power[r * self.width + c + SYNC_TONES[k] as usize * FREQ_OVERSAMPLE];
                    den += tone_sum[r * cols + c];
                }
                map[ti * cols + c] = if den > 0.0 { num * NUM_TONES as f32 / den } else { 0.0 };
            }
        }
        // Normalise by the median so the threshold means the same thing on any band.
        let mut sorted = map.clone();
        let mid = sorted.len() / 2;
        let median = *sorted.select_nth_unstable_by(mid, |a, b| a.partial_cmp(b).unwrap()).1;
        let norm = if median > 0.0 { 1.0 / median } else { 1.0 };

        let bin_hz = Self::bin_hz();
        let mut peaks: Vec<(f32, usize, usize)> = Vec::new();
        for ti in 0..ntimes {
            for c in 0..cols {
                let v = map[ti * cols + c];
                if (v * norm) as f64 <= threshold {
                    continue;
                }
                let f0 = (self.col0 + c) as f64 * bin_hz;
                if f0 < lo_hz || f0 + (NUM_TONES - 1) as f64 * TONE_SPACING_HZ > hi_hz {
                    continue;
                }
                let mut is_max = true;
                'n: for dti in -1i64..=1 {
                    for dc in -1i64..=1 {
                        if dti == 0 && dc == 0 {
                            continue;
                        }
                        let (a, b) = (ti as i64 + dti, c as i64 + dc);
                        if a >= 0 && b >= 0 && (a as usize) < ntimes && (b as usize) < cols {
                            let w = map[a as usize * cols + b as usize];
                            // Ties broken towards the lower index so plateaus yield one peak.
                            if w > v || (w == v && (a, b) < (ti as i64, c as i64)) {
                                is_max = false;
                                break 'n;
                            }
                        }
                    }
                }
                if is_max {
                    peaks.push((v * norm, ti, c));
                }
            }
        }
        peaks.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        // Non-maximum suppression: within 2 bins (1.6 Hz) and 2 hops (80 ms) keep the strongest.
        let mut out: Vec<(usize, usize, f32)> = Vec::new();
        for (v, ti, c) in peaks {
            if out.len() >= max {
                break;
            }
            if out.iter().any(|&(t2, c2, _)| t2.abs_diff(ti) <= 2 && c2.abs_diff(c) <= 2) {
                continue;
            }
            out.push((ti, c, v));
        }
        out.into_iter()
            .map(|(ti, c, v)| Candidate {
                dt_sec: ((t_lo + ti) as f64 * HOP as f64 - SLOT_ZERO_INDEX as f64) / crate::DSP_RATE_HZ,
                f0_hz: (self.col0 + c) as f64 * bin_hz,
                sync: v as f64,
            })
            .collect()
    }
}

/// Twiddles for the 16 tone bins of a 64-sample symbol: `tw[tone][m] = exp(-j 2 pi tone m / 64)`.
pub struct ToneTable {
    pub(crate) tw: Vec<Complex32>,
}

impl Default for ToneTable {
    fn default() -> Self {
        Self::new()
    }
}

impl ToneTable {
    /// Builds the table.
    pub fn new() -> Self {
        let mut tw = Vec::with_capacity(NUM_TONES * BB_NSPS);
        for t in 0..NUM_TONES {
            for m in 0..BB_NSPS {
                let ph = -2.0 * std::f64::consts::PI * (t * m) as f64 / BB_NSPS as f64;
                tw.push(Complex32::new(ph.cos() as f32, ph.sin() as f32));
            }
        }
        ToneTable { tw }
    }

    /// Correlation of 64 samples with tone `t`.
    #[inline]
    pub fn correlate(&self, x: &[Complex32], t: usize) -> Complex32 {
        let w = &self.tw[t * BB_NSPS..(t + 1) * BB_NSPS];
        let mut acc = Complex32::new(0.0, 0.0);
        for m in 0..BB_NSPS {
            acc += x[m] * w[m];
        }
        acc
    }
}

/// Frequency-and-drift correction for baseband sample `j` of a frame (j = 0 at frame start):
/// `exp(-j 2 pi (df t + drift (t^2 / (2T) - t / 2)))`, the instantaneous offset being
/// `df + drift (t/T - 1/2)`: total `drift` Hz across the frame, zero at mid-frame.
#[inline]
pub fn derotation(j: f64, df_hz: f64, drift_hz: f64) -> Complex32 {
    let t = j / BB_RATE_HZ;
    let ph = -2.0 * std::f64::consts::PI * (df_hz * t + drift_hz * (t * t / (2.0 * FRAME_SEC) - t / 2.0));
    Complex32::new(ph.cos() as f32, ph.sin() as f32)
}

/// A fine-sync hypothesis and its metric.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FineSync {
    /// Frame start in baseband samples (index into the slot baseband).
    pub start: usize,
    /// Frequency offset from the baseband centre, Hz.
    pub df_hz: f64,
    /// Total linear drift across the frame, Hz.
    pub drift_hz: f64,
    /// Sum of sync-tone energies.
    pub metric: f64,
}

/// A uniform grid: `first + i * step` for `i in 0..count`.
#[derive(Clone, Copy)]
struct Grid {
    first: f64,
    step: f64,
    count: usize,
}

impl Grid {
    fn around(centre: f64, step: f64, half: i64) -> Grid {
        Grid { first: centre - half as f64 * step, step, count: (2 * half + 1) as usize }
    }

    fn at(&self, i: usize) -> f64 {
        self.first + i as f64 * self.step
    }
}

const SYNC_LEN: usize = z30_protocol::SYNC_SYMBOLS * BB_NSPS;

/// Correlator weights for one (df, drift): tone twiddle times derotation, per sync sample.
fn weights(tones: &ToneTable, df: f64, drift: f64, out: &mut [Complex32]) {
    for (k, &pos) in SYNC_POSITIONS.iter().enumerate() {
        for m in 0..BB_NSPS {
            out[k * BB_NSPS + m] = derotation((pos * BB_NSPS + m) as f64, df, drift) * tones.tw[SYNC_TONES[k] as usize * BB_NSPS + m];
        }
    }
}

/// `exp(-j 2 pi step t)` or `exp(-j 2 pi step q(t))` per sync sample: the factor that moves a
/// weight table one grid step, so a sweep costs one complex multiply per sample instead of a
/// sincos.
fn step_factors(step: f64, drift: bool) -> Vec<Complex32> {
    let mut out = vec![Complex32::new(0.0, 0.0); SYNC_LEN];
    for (k, &pos) in SYNC_POSITIONS.iter().enumerate() {
        for m in 0..BB_NSPS {
            out[k * BB_NSPS + m] =
                if drift { derotation((pos * BB_NSPS + m) as f64, 0.0, step) } else { derotation((pos * BB_NSPS + m) as f64, step, 0.0) };
        }
    }
    out
}

fn search(bb: &[Complex32], tones: &ToneTable, starts: std::ops::RangeInclusive<usize>, dfs: Grid, drifts: Grid) -> Option<FineSync> {
    let limit = bb.len().checked_sub(TOTAL_SYMBOLS * BB_NSPS)?;
    let df_step = step_factors(dfs.step, false);
    let mut w = vec![Complex32::new(0.0, 0.0); SYNC_LEN];
    let mut best: Option<FineSync> = None;
    for di in 0..drifts.count {
        let drift = drifts.at(di);
        weights(tones, dfs.first, drift, &mut w);
        for fi in 0..dfs.count {
            let df = dfs.at(fi);
            if fi > 0 {
                // Re-anchor every 8 steps so f32 rounding cannot accumulate.
                if fi % 8 == 0 {
                    weights(tones, df, drift, &mut w);
                } else {
                    for (x, s) in w.iter_mut().zip(&df_step) {
                        *x *= *s;
                    }
                }
            }
            for s in starts.clone() {
                if s > limit {
                    continue;
                }
                let mut metric = 0.0f64;
                for (k, &pos) in SYNC_POSITIONS.iter().enumerate() {
                    let x = &bb[s + pos * BB_NSPS..s + pos * BB_NSPS + BB_NSPS];
                    let wk = &w[k * BB_NSPS..(k + 1) * BB_NSPS];
                    let mut acc = Complex32::new(0.0, 0.0);
                    for m in 0..BB_NSPS {
                        acc += x[m] * wk[m];
                    }
                    metric += acc.norm_sqr() as f64;
                }
                if best.map_or(true, |b| metric > b.metric) {
                    best = Some(FineSync { start: s, df_hz: df, drift_hz: drift, metric });
                }
            }
        }
    }
    best
}

/// Fine search around a coarse candidate. Returns the best zero-drift hypothesis and, when
/// `max_drift_hz > 0`, the best hypothesis over drift in [-max, +max] (which may be the same).
pub fn fine_sync(bb: &[Complex32], tones: &ToneTable, coarse_start: usize, max_drift_hz: f64) -> (FineSync, Option<FineSync>) {
    let none = Grid { first: 0.0, step: 0.5, count: 1 };
    // Stage 1: +-8 samples (+-40 ms, one coarse hop) and +-0.8 Hz in 0.1 Hz, no drift.
    let lo = coarse_start.saturating_sub(8);
    let s1 = search(bb, tones, lo..=coarse_start + 8, Grid::around(0.0, 0.1, 8), none).expect("window fits the slot");
    // Stage 2: 0.02 Hz refinement.
    let zero = search(bb, tones, s1.start.saturating_sub(1)..=s1.start + 1, Grid::around(s1.df_hz, 0.02, 5), none).unwrap_or(s1);
    if max_drift_hz <= 0.0 {
        return (zero, None);
    }
    // Stage 3: drift in 0.5 Hz steps, frequency +-0.3 Hz, timing +-2 samples.
    let steps = (max_drift_hz / 0.5).round() as i64;
    let d =
        search(bb, tones, zero.start.saturating_sub(2)..=zero.start + 2, Grid::around(zero.df_hz, 0.1, 3), Grid::around(0.0, 0.5, steps))
            .unwrap_or(zero);
    // Stage 4: refine drift and frequency together.
    let d = search(bb, tones, d.start..=d.start, Grid::around(d.df_hz, 0.03, 3), Grid::around(d.drift_hz, 0.2, 2)).unwrap_or(d);
    (zero, Some(d))
}

/// Complex64 helper for callers that accumulate in double precision.
pub fn c64(c: Complex32) -> Complex64 {
    Complex64::new(c.re as f64, c.im as f64)
}
