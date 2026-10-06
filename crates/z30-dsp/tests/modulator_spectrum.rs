//! Occupied-bandwidth budgets of the transmitted waveform.
//!
//! z-30's premise is a 50 Hz signal; a mode this narrow that splatters is a worse neighbour than
//! the wideband modes it means to improve on. These budgets were the acceptance test of the
//! transmitter fix that removed per-symbol amplitude gating, and lived in the retired Python
//! oracle (`test_modem_spectrum.py`, removed in the 2026-10-06 cleanup) while the production
//! modulator was only checked against it sample by sample (`golden.rs`) and on one noisy frame
//! (`z30-cli` loopback). They are asserted here on the production `Modulator`, with the same
//! budgets, the same measurement (Welch, Hann, 2^15 points, 50 % overlap, mean removed per
//! segment; unscaled and without the one-sided x2, which peak-relative widths and cumulative
//! fractions do not need) and the same construction of the deliberately broken reference waveform
//! that must fail them - so the test shows it can tell the difference rather than merely passing.
//! The payloads are seeded here (splitmix64), not the oracle's NumPy draws, so the oracle's
//! recorded widths (the gated waveform's "over 200 Hz") describe other frames.
//!
//! It lives in z30-dsp rather than beside the modulator because it needs an FFT, and adding a
//! dev-dependency to z30-protocol's Cargo.toml would change the benchmark instrument identity
//! (crates/z30-cli/build_support.rs `instrument_files`), which refuses every comparison with the
//! published results until a new baseline is run.
//!
//! Software correctness is necessary, not sufficient: the sound card and the rig's ALC still
//! have to be measured before going on the air (docs/hardware-validation.md).

use rustfft::num_complex::Complex64;
use rustfft::FftPlanner;
use z30_protocol::gfsk::Modulator;
use z30_protocol::gfsk::FRAME_RAMP_SEC;
use z30_protocol::{NUM_TONES, TONE_SPACING_HZ, TOTAL_SYMBOLS};

/// ITU-style 99 % occupied bandwidth budget: the tones span 15 x 3.125 = 46.875 Hz, so this is
/// tight with a little measurement headroom.
const OCCUPIED_BW_99_BUDGET_HZ: f64 = 52.0;
/// -40 dB bandwidth budget: the shoulders two orders of magnitude down, which is what a
/// neighbour 50 Hz away hears.
const BANDWIDTH_40DB_BUDGET_HZ: f64 = 72.0;
const FS: f64 = 12_000.0;
const F0: f64 = 1250.0;
/// Welch: Hann, 2^15 points, 50 % overlap (resolution bandwidth 0.37 Hz at 12 kHz). A -40 dB
/// width depends on the resolution bandwidth, so it is fixed here (2026-09-24 audit, L-06).
const NPERSEG: usize = 1 << 15;

/// Deterministic symbols from a seed (splitmix64); the budgets must hold for any payload.
fn symbols(seed: u64) -> [u8; TOTAL_SYMBOLS] {
    let mut s = seed;
    std::array::from_fn(|_| {
        s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = s;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) % NUM_TONES as u64) as u8
    })
}

/// One-sided Welch power spectrum (unscaled: only ratios are used).
fn psd(x: &[f64]) -> Vec<f64> {
    let fft = FftPlanner::<f64>::new().plan_fft_forward(NPERSEG);
    let win: Vec<f64> = (0..NPERSEG).map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / NPERSEG as f64).cos()).collect();
    let mut out = vec![0.0; NPERSEG / 2 + 1];
    let mut start = 0;
    while start + NPERSEG <= x.len() {
        let seg = &x[start..start + NPERSEG];
        let mean = seg.iter().sum::<f64>() / NPERSEG as f64;
        let mut buf: Vec<Complex64> = seg.iter().zip(&win).map(|(&v, &w)| Complex64::new((v - mean) * w, 0.0)).collect();
        fft.process(&mut buf);
        for (p, z) in out.iter_mut().zip(&buf) {
            *p += z.norm_sqr();
        }
        start += NPERSEG / 2;
    }
    out
}

fn bin_hz() -> f64 {
    FS / NPERSEG as f64
}

/// Width of the band in which the PSD stays above `floor_db` relative to its peak.
fn bandwidth_at_floor(x: &[f64], floor_db: f64) -> f64 {
    let p = psd(x);
    let peak = p.iter().cloned().fold(0.0, f64::max);
    let above: Vec<usize> = (0..p.len()).filter(|&i| 10.0 * (p[i] / peak + 1e-30).log10() >= floor_db).collect();
    (above[above.len() - 1] - above[0]) as f64 * bin_hz()
}

/// ITU-R SM.328 occupied bandwidth: the band holding 99 % of the mean power.
fn occupied_bandwidth_99(x: &[f64]) -> f64 {
    let p = psd(x);
    let total: f64 = p.iter().sum();
    let mut acc = 0.0;
    let (mut lo, mut hi) = (None, None);
    for (i, v) in p.iter().enumerate() {
        acc += v;
        if lo.is_none() && acc / total >= 0.005 {
            lo = Some(i);
        }
        if hi.is_none() && acc / total >= 0.995 {
            hi = Some(i);
        }
    }
    (hi.unwrap() - lo.unwrap()) as f64 * bin_hz()
}

fn transmitted(seed: u64) -> Vec<f64> {
    let m = Modulator::new(FS).unwrap();
    m.synthesize(&symbols(seed), F0).unwrap().iter().map(|&v| v as f64).collect()
}

/// The pre-fix waveform: a continuous phase accumulator, but an 8 ms raised-cosine ramp on EVERY
/// symbol, taking the envelope to zero 3.125 times a second - amplitude keying at the symbol
/// rate laid over the tones. Its -40 dB bandwidth was over 200 Hz.
fn per_symbol_gated(seed: u64) -> Vec<f64> {
    let sps = (FS * 0.32) as usize;
    let ramp_len = (0.008 * FS) as usize;
    let ramp: Vec<f64> = (0..ramp_len).map(|i| 0.5 * (1.0 - (std::f64::consts::PI * i as f64 / ramp_len as f64).cos())).collect();
    let mut env = vec![1.0; sps];
    for i in 0..ramp_len {
        env[i] = ramp[i];
        env[sps - 1 - i] = ramp[i];
    }
    let mut out = Vec::with_capacity(TOTAL_SYMBOLS * sps);
    let mut phase = 0.0f64;
    for &tone in symbols(seed).iter() {
        let f = F0 + tone as f64 * TONE_SPACING_HZ;
        let mut last = 0.0;
        for (i, e) in env.iter().enumerate() {
            last = std::f64::consts::TAU * f * (i as f64 / FS) + phase;
            out.push(last.sin() * e);
        }
        phase = (last + std::f64::consts::TAU * f / FS) % std::f64::consts::TAU;
    }
    let peak = out.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    out.iter().map(|v| v / peak).collect()
}

const SEEDS: [u64; 3] = [20_260_830, 20_260_831, 20_260_832];

#[test]
fn occupied_bandwidth_is_within_budget() {
    for seed in SEEDS {
        let bw = occupied_bandwidth_99(&transmitted(seed));
        assert!(bw <= OCCUPIED_BW_99_BUDGET_HZ, "seed {seed}: 99% bandwidth {bw:.1} Hz exceeds {OCCUPIED_BW_99_BUDGET_HZ} Hz");
    }
}

#[test]
fn minus_40_db_bandwidth_is_within_budget() {
    for seed in SEEDS {
        let bw = bandwidth_at_floor(&transmitted(seed), -40.0);
        assert!(bw <= BANDWIDTH_40DB_BUDGET_HZ, "seed {seed}: -40 dB bandwidth {bw:.1} Hz exceeds {BANDWIDTH_40DB_BUDGET_HZ} Hz");
    }
}

#[test]
fn the_per_symbol_gated_waveform_fails_the_budget() {
    let bw = bandwidth_at_floor(&per_symbol_gated(SEEDS[0]), -40.0);
    assert!(
        bw > 2.0 * BANDWIDTH_40DB_BUDGET_HZ,
        "the gated reference measured only {bw:.1} Hz, so this measurement can no longer detect the defect it exists to detect"
    );
}

#[test]
fn frame_edges_are_ramped_and_the_output_is_finite_and_normalised() {
    let w = transmitted(SEEDS[0]);
    // A hard switch-on is a key click.
    assert!(w[0].abs() < 1e-3, "{}", w[0]);
    assert!(w[w.len() - 1].abs() < 1e-2, "{}", w[w.len() - 1]);
    assert!(w.iter().all(|v| v.is_finite()));
    let peak = w.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    assert!((0.99..=1.0).contains(&peak), "{peak}");
}

/// GFSK smoothing moves the frequency between tones without moving where it lands.
#[test]
fn instantaneous_frequency_hits_each_tone_at_the_symbol_centre() {
    let m = Modulator::new(FS).unwrap();
    let s = symbols(SEEDS[0] + 7);
    let f = m.instantaneous_frequency(&s, F0);
    let sps = m.nsps();
    for (i, &tone) in s.iter().enumerate() {
        let want = F0 + tone as f64 * TONE_SPACING_HZ;
        let got = f[i * sps + sps / 2];
        assert!((got - want).abs() < 0.5, "symbol {i}: {got:.2} Hz at the centre, expected {want:.2} Hz");
    }
}

/// No per-symbol amplitude gating: away from the one ramp at each end, the transmitted
/// waveform's envelope (its analytic-signal magnitude) never dips. This is the property that keeps
/// the sidebands where they belong. `gfsk.rs` checks the envelope function and ties `synthesize`
/// to `analytic`; this checks `synthesize` itself, on random payloads, as the oracle did.
#[test]
fn the_envelope_is_constant_between_the_frame_edge_ramps() {
    for seed in SEEDS {
        let w = transmitted(seed);
        let n = w.len();
        // Hilbert transform: keep DC and Nyquist, double the positive frequencies, drop the rest.
        let mut buf: Vec<Complex64> = w.iter().map(|&v| Complex64::new(v, 0.0)).collect();
        let mut planner = FftPlanner::<f64>::new();
        planner.plan_fft_forward(n).process(&mut buf);
        for (k, z) in buf.iter_mut().enumerate() {
            if k > 0 && k < n / 2 {
                *z *= 2.0;
            } else if k > n / 2 {
                *z = Complex64::new(0.0, 0.0);
            }
        }
        planner.plan_fft_inverse(n).process(&mut buf);
        let ramp = (FRAME_RAMP_SEC * FS) as usize;
        let interior = &buf[2 * ramp..n - 2 * ramp];
        // The transform rings at the edges of the interval by construction; skip 2 % each side.
        let edge = interior.len() / 50;
        for z in &interior[edge..interior.len() - edge] {
            let a = z.norm() / n as f64;
            assert!((0.9..1.1).contains(&a), "seed {seed}: envelope {a:.3} inside the frame");
        }
    }
}
