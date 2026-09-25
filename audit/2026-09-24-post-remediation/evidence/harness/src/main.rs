//! Independent verification harness for the 2026-09-24 post-remediation audit.
//!
//! Deliberately NOT the project's benchmark harness (crates/z30-cli/src/suite.rs) and, except
//! for the Watterson checks (which measure z30-channel itself), NOT the project's channel model
//! (z30-channel). Signals are built here from the transmitter (z30_protocol::gfsk::Modulator,
//! the thing being received) and noise from an independent generator (ChaCha20, own seeds).
//! The receiver under test is z30_dsp::slot::Receiver::decode_slot with RxConfig::default().
//! Ground truth never reaches the receiver: it is handed only the 162 000-sample window.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;
use rand_distr::{Distribution, StandardNormal};
use rayon::prelude::*;
use rustfft::num_complex::Complex64;
use rustfft::FftPlanner;
use serde_json::{json, Value};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};
use z30_protocol::gfsk::Modulator;
use z30_protocol::ldpc::{encode_info, encode_payload};
use z30_protocol::symbols::codeword_to_symbols;

const FS: f64 = 6000.0;
const WIN: usize = 162_000;
const ZERO: usize = 9_000;
/// Independent of the project's suite seed (20260830).
const SEED_BASE: u64 = 0x5EED_A0D1_0924;

fn rng(bench: u64, p: u64, i: u64) -> ChaCha20Rng {
    ChaCha20Rng::seed_from_u64(SEED_BASE ^ (bench << 48) ^ (p << 32) ^ i)
}

#[derive(Clone)]
struct Tx {
    payload: [u8; 63],
    symbols: [u8; 75],
    f0: f64,
    dt: f64,
    phase: f64,
}

fn random_tx(r: &mut ChaCha20Rng, dt_max: f64) -> Tx {
    let mut payload = [0u8; 63];
    payload.iter_mut().for_each(|b| *b = r.gen_range(0..2));
    let symbols = codeword_to_symbols(&encode_payload(&payload));
    let f0 = r.gen_range(210.0..2740.0);
    let dt = if dt_max > 0.0 { r.gen_range(-dt_max..dt_max) } else { 0.0 };
    let phase = r.gen_range(0.0..std::f64::consts::TAU);
    Tx { payload, symbols, f0, dt, phase }
}

/// The frame as a real passband waveform placed in a 162 000-sample window, scaled so that its
/// power over its own 24 s duration is 10^(snr/10) times the noise power in 2500 Hz of unit-
/// variance real white noise at 6 kHz (SPEC.md section 10: N_2500 = 2500 / 3000).
fn render(m: &Modulator, tx: &Tx, snr_db: f64) -> Vec<f64> {
    let start = ZERO as f64 + tx.dt * FS;
    let si = start.floor() as i64;
    let (re, im) = m.analytic(&tx.symbols, tx.f0, 0.0, start - si as f64);
    let (c, s) = (tx.phase.cos(), tx.phase.sin());
    let w: Vec<f64> = re.iter().zip(&im).map(|(a, b)| a * c - b * s).collect();
    let p = w.iter().map(|v| v * v).sum::<f64>() / w.len() as f64;
    let amp = (10f64.powf(snr_db / 10.0) * (2500.0 / 3000.0) / p).sqrt();
    let mut out = vec![0.0; WIN];
    for (i, v) in w.iter().enumerate() {
        let j = si + i as i64;
        if j >= 0 && (j as usize) < WIN {
            out[j as usize] = amp * v;
        }
    }
    out
}

fn noise(r: &mut ChaCha20Rng) -> Vec<f64> {
    (0..WIN).map(|_| StandardNormal.sample(r)).collect()
}

fn to_f32(x: &[f64]) -> Vec<f32> {
    x.iter().map(|&v| v as f32).collect()
}

fn found(rep: &SlotReport, p: &[u8; 63]) -> bool {
    rep.decodes.iter().any(|d| d.info[..63] == *p)
}

fn wilson(k: usize, n: usize) -> (f64, f64) {
    let (k, n, z) = (k as f64, n as f64, 1.959_964);
    let p = k / n;
    let den = 1.0 + z * z / n;
    let c = (p + z * z / (2.0 * n)) / den;
    let h = z * (p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt() / den;
    (100.0 * (c - h).max(0.0), 100.0 * (c + h).min(1.0))
}

fn crossing(pts: &[(f64, f64)], target: f64) -> Option<f64> {
    pts.windows(2).find_map(|w| {
        let ((x0, y0), (x1, y1)) = (w[0], w[1]);
        ((y0 - target) * (y1 - target) <= 0.0 && y0 != y1).then(|| x0 + (target - y0) * (x1 - x0) / (y1 - y0))
    })
}

fn mean_sd(v: &[f64]) -> (f64, f64) {
    if v.is_empty() {
        return (f64::NAN, f64::NAN);
    }
    let m = v.iter().sum::<f64>() / v.len() as f64;
    let sd = if v.len() > 1 { (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len() - 1) as f64).sqrt() } else { f64::NAN };
    (m, sd)
}

// ------------------------------------------------------------------------------ AWGN

fn awgn(frames: usize) -> Value {
    let snrs = [-25.0, -24.5, -24.0, -23.5, -23.0, -22.5, -22.0, -21.5, -21.0, -20.0];
    let mut pts = Vec::new();
    let mut rows = Vec::new();
    for (p, &snr) in snrs.iter().enumerate() {
        let res: Vec<(bool, usize)> = (0..frames)
            .into_par_iter()
            .map_init(|| (Receiver::new(), Modulator::new(FS).unwrap()), |(rx, m), i| {
                let mut r = rng(1, p as u64, i as u64);
                let tx = random_tx(&mut r, 1.4);
                let s = render(m, &tx, snr);
                let n = noise(&mut r);
                let x: Vec<f64> = s.iter().zip(&n).map(|(a, b)| a + b).collect();
                let rep = rx.decode_slot(&to_f32(&x), &RxConfig::default());
                let f = rep.decodes.iter().filter(|d| d.info[..63] != tx.payload).count();
                (found(&rep, &tx.payload), f)
            })
            .collect();
        let k = res.iter().filter(|v| v.0).count();
        let f: usize = res.iter().map(|v| v.1).sum();
        let (lo, hi) = wilson(k, frames);
        println!("AWGN {snr:+5.1} dB: {k:4}/{frames} = {:5.1}% [{lo:5.1},{hi:5.1}]  false {f}", 100.0 * k as f64 / frames as f64);
        pts.push((snr, 100.0 * k as f64 / frames as f64));
        rows.push(json!({"snr_db": snr, "decoded": k, "frames": frames, "wilson95": [lo, hi], "false_decodes": f}));
    }
    let c50 = crossing(&pts, 50.0);
    let c90 = crossing(&pts, 90.0);
    println!("AWGN crossing 50% {c50:?}  90% {c90:?}");
    json!({"points": rows, "crossing_50pct_db": c50, "crossing_90pct_db": c90})
}

// ------------------------------------------------------------------------------ SNR accuracy

fn snr_sweep(frames: usize) -> Value {
    let snrs = [-30.0, -28.0, -26.0, -24.0, -23.0, -22.0, -20.0, -15.0, -10.0, -5.0, 0.0, 5.0, 10.0, 20.0, 30.0, 40.0, 50.0];
    let mut rows = Vec::new();
    for (p, &snr) in snrs.iter().enumerate() {
        let res: Vec<(bool, Option<f64>, usize)> = (0..frames)
            .into_par_iter()
            .map_init(|| (Receiver::new(), Modulator::new(FS).unwrap()), |(rx, m), i| {
                let mut r = rng(2, p as u64, i as u64);
                let tx = random_tx(&mut r, 1.4);
                let s = render(m, &tx, snr);
                let n = noise(&mut r);
                let x: Vec<f64> = s.iter().zip(&n).map(|(a, b)| a + b).collect();
                let rep = rx.decode_slot(&to_f32(&x), &RxConfig::default());
                let d = rep.decodes.iter().find(|d| d.info[..63] == tx.payload);
                let f = rep.decodes.iter().filter(|d| d.info[..63] != tx.payload).count();
                (d.is_some(), d.and_then(|d| d.snr_db), f)
            })
            .collect();
        let k = res.iter().filter(|v| v.0).count();
        let meas: Vec<f64> = res.iter().filter_map(|v| v.1).collect();
        let none = res.iter().filter(|v| v.0 && v.1.is_none()).count();
        let err: Vec<f64> = meas.iter().map(|m| m - snr).collect();
        let (b, sd) = mean_sd(&err);
        let mn = meas.iter().cloned().fold(f64::INFINITY, f64::min);
        let mx = meas.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let f: usize = res.iter().map(|v| v.2).sum();
        println!(
            "SNR true {snr:+5.1}: decoded {k:3}/{frames} measured {} none {none} bias {b:+.3} sd {sd:.3} min {mn:+.2} max {mx:+.2} false {f}",
            meas.len()
        );
        rows.push(json!({"true_snr_db": snr, "decoded": k, "frames": frames, "measured": meas.len(), "not_measured": none,
            "bias_db": b, "sd_db": sd, "min_measured_db": mn, "max_measured_db": mx, "false_decodes": f}));
    }
    json!({"points": rows})
}

/// SNR estimate robustness when the received waveform is NOT exactly the replica: slow carrier
/// phase noise (random walk) and a fading channel (z30-channel's Watterson, used as-is).
fn snr_mismatch(frames: usize) -> Value {
    let mut rows = Vec::new();
    for (p, &(label, snr, pn_deg)) in
        [("phase-noise 2 deg/sym rms", 20.0, 2.0), ("phase-noise 2 deg/sym rms", 30.0, 2.0), ("phase-noise 5 deg/sym rms", 20.0, 5.0), ("phase-noise 5 deg/sym rms", 30.0, 5.0), ("phase-noise 5 deg/sym rms", 0.0, 5.0), ("phase-noise 5 deg/sym rms", -15.0, 5.0)]
            .iter()
            .enumerate()
    {
        let res: Vec<(bool, Option<f64>)> = (0..frames)
            .into_par_iter()
            .map_init(|| (Receiver::new(), Modulator::new(FS).unwrap()), |(rx, m), i| {
                let mut r = rng(3, p as u64, i as u64);
                let tx = random_tx(&mut r, 1.4);
                // Build analytic, apply random-walk phase, take real part.
                let start = ZERO as f64 + tx.dt * FS;
                let si = start.floor() as i64;
                let (re, im) = m.analytic(&tx.symbols, tx.f0, 0.0, start - si as f64);
                let step = ((pn_deg as f64).to_radians()) / (1920f64).sqrt();
                let mut ph = tx.phase;
                let w: Vec<f64> = re
                    .iter()
                    .zip(&im)
                    .map(|(a, b)| {
                        let g: f64 = StandardNormal.sample(&mut r);
                        ph += step * g;
                        a * ph.cos() - b * ph.sin()
                    })
                    .collect();
                let pw = w.iter().map(|v| v * v).sum::<f64>() / w.len() as f64;
                let amp = (10f64.powf(snr / 10.0) * (2500.0 / 3000.0) / pw).sqrt();
                let mut x = noise(&mut r);
                for (k, v) in w.iter().enumerate() {
                    let j = si + k as i64;
                    if j >= 0 && (j as usize) < WIN {
                        x[j as usize] += amp * v;
                    }
                }
                let rep = rx.decode_slot(&to_f32(&x), &RxConfig::default());
                let d = rep.decodes.iter().find(|d| d.info[..63] == tx.payload);
                (d.is_some(), d.and_then(|d| d.snr_db))
            })
            .collect();
        let k = res.iter().filter(|v| v.0).count();
        let err: Vec<f64> = res.iter().filter_map(|v| v.1.map(|m| m - snr)).collect();
        let (b, sd) = mean_sd(&err);
        println!("mismatch {label} @ {snr:+.0} dB: decoded {k}/{frames} bias {b:+.2} sd {sd:.2}");
        rows.push(json!({"condition": label, "true_snr_db": snr, "decoded": k, "frames": frames, "bias_db": b, "sd_db": sd}));
    }
    // Watterson (z30-channel) at average SNR; per-frame true SNR is not known exactly here, so
    // the comparison is against the frame's own realised SNR, measured from the faded signal.
    for (p, &(preset, snr)) in [("moderate", 10.0), ("moderate", 20.0), ("poor", 20.0)].iter().enumerate() {
        let w = z30_channel::Watterson::preset(preset).unwrap();
        let res: Vec<(bool, Option<f64>, f64)> = (0..frames)
            .into_par_iter()
            .map_init(Receiver::new, |rx, i| {
                let mut r = z30_channel::rng(0xFADE_0000 + (p as u64) * 100_000 + i as u64);
                let (pl, mut st) = z30_channel::random_station(&mut r, 1000.0 + (i % 17) as f64 * 97.0, 0.3, snr);
                st.fading = Some(w);
                // Same generator state for the clean and the noisy copy: realise once, noise-free.
                let clean = z30_channel::synthesize(&z30_channel::Band { stations: vec![st], noise: false, ..Default::default() }, &mut r.clone());
                let p_sig = clean[ZERO + 1800..ZERO + 144_000].iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / (144_000.0 - 1800.0);
                let realised = 10.0 * (p_sig / (5000.0 / 6000.0)).log10();
                let mut nr = rng(4, p as u64, i as u64);
                let x: Vec<f32> = clean.iter().map(|&v| { let g: f64 = StandardNormal.sample(&mut nr); v + g as f32 }).collect::<Vec<f32>>();
                let rep = rx.decode_slot(&x, &RxConfig::default());
                let d = rep.decodes.iter().find(|d| d.info[..63] == pl);
                (d.is_some(), d.and_then(|d| d.snr_db), realised)
            })
            .collect();
        let k = res.iter().filter(|v| v.0).count();
        let err: Vec<f64> = res.iter().filter_map(|v| v.1.map(|m| m - v.2)).collect();
        let (b, sd) = mean_sd(&err);
        println!("mismatch Watterson {preset} avg {snr:+.0} dB: decoded {k}/{frames}; measured - realised: bias {b:+.2} sd {sd:.2}");
        rows.push(json!({"condition": format!("Watterson {preset}"), "average_snr_db": snr, "decoded": k, "frames": frames,
            "bias_vs_realised_db": b, "sd_db": sd}));
    }
    json!({"points": rows})
}

// ------------------------------------------------------------------------------ no signal / invalid

fn nosig(slots: usize) -> Value {
    let kinds = ["white noise", "silence (all zeros)", "uniform random audio +-1", "Costas-correct frame, random data symbols, 0 dB",
        "LDPC-valid codeword with random (wrong) CRC, 0 dB", "valid synthetic frame, -10 dB (positive control)"];
    let mut rows = Vec::new();
    for (p, name) in kinds.iter().enumerate() {
        let res: Vec<(usize, bool, Option<f64>)> = (0..slots)
            .into_par_iter()
            .map_init(|| (Receiver::new(), Modulator::new(FS).unwrap()), |(rx, m), i| {
                let mut r = rng(5, p as u64, i as u64);
                let mut ctl = None;
                let x: Vec<f64> = match p {
                    0 => noise(&mut r),
                    1 => vec![0.0; WIN],
                    2 => (0..WIN).map(|_| r.gen_range(-1.0..1.0)).collect(),
                    3 | 4 => {
                        let mut tx = random_tx(&mut r, 1.4);
                        if p == 3 {
                            for d in z30_protocol::DATA_POSITIONS {
                                tx.symbols[d] = r.gen_range(0..16);
                            }
                        } else {
                            let mut info = [0u8; 77];
                            info.iter_mut().for_each(|b| *b = r.gen_range(0..2));
                            if z30_protocol::codec::unpack_info(&info).is_some() {
                                info[76] ^= 1; // make sure the CRC is wrong
                            }
                            tx.symbols = codeword_to_symbols(&encode_info(&info));
                        }
                        let s = render(m, &tx, 0.0);
                        let n = noise(&mut r);
                        s.iter().zip(&n).map(|(a, b)| a + b).collect()
                    }
                    _ => {
                        let tx = random_tx(&mut r, 1.4);
                        ctl = Some(tx.payload);
                        let s = render(m, &tx, -10.0);
                        let n = noise(&mut r);
                        s.iter().zip(&n).map(|(a, b)| a + b).collect()
                    }
                };
                let rep = rx.decode_slot(&to_f32(&x), &RxConfig::default());
                match ctl {
                    Some(pl) => {
                        let d = rep.decodes.iter().find(|d| d.info[..63] == pl);
                        (rep.decodes.iter().filter(|d| d.info[..63] != pl).count(), d.is_some(), d.and_then(|d| d.snr_db))
                    }
                    None => (rep.decodes.len(), false, None),
                }
            })
            .collect();
        let f: usize = res.iter().map(|v| v.0).sum();
        let ok = res.iter().filter(|v| v.1).count();
        let snrs: Vec<f64> = res.iter().filter_map(|v| v.2).collect();
        let (b, sd) = mean_sd(&snrs);
        println!("{name:>55}: {slots} slots, unexpected decodes {f}, control decoded {ok}, mean snr {b:.2} sd {sd:.2}");
        rows.push(json!({"input": name, "slots": slots, "unexpected_decodes": f, "control_decoded": ok, "control_snr_mean": b, "control_snr_sd": sd}));
    }
    json!({"points": rows})
}

// ------------------------------------------------------------------------------ Watterson

fn analytic(x: &[f32]) -> Vec<Complex64> {
    let n = x.len();
    let mut p = FftPlanner::<f64>::new();
    let mut b: Vec<Complex64> = x.iter().map(|&v| Complex64::new(v as f64, 0.0)).collect();
    p.plan_fft_forward(n).process(&mut b);
    for (k, v) in b.iter_mut().enumerate() {
        if k == 0 || (n % 2 == 0 && k == n / 2) {
        } else if k < n / 2 + (n % 2) {
            *v *= 2.0;
        } else {
            *v = Complex64::new(0.0, 0.0);
        }
    }
    p.plan_fft_inverse(n).process(&mut b);
    b.iter().map(|z| z / n as f64).collect()
}

fn watterson(reals: usize) -> Value {
    let mut out = serde_json::Map::new();
    for (preset, lags) in [("good", [2.0, 4.0]), ("moderate", [0.4, 0.8]), ("poor", [0.2, 0.4]), ("high-moderate", [0.02, 0.04])] {
        let w = z30_channel::Watterson::preset(preset).unwrap();
        // A constant tone (all symbols 0) through the channel, noise-free, next to the same tone
        // unfaded: their analytic ratio is the channel's complex gain g(t).
        let lo = ZERO + 3000;
        let hi = ZERO + 141_000;
        let per: Vec<(f64, Complex64, [Complex64; 2], f64, f64)> = (0..reals)
            .into_par_iter()
            .map(|i| {
                let mk = |fading| z30_channel::Station { symbols: [0u8; 75], f0_hz: 1000.0, dt_sec: 0.0, snr_db: 0.0, drift_hz: 0.0, phase_rad: 0.0, fading };
                let y = z30_channel::synthesize(&z30_channel::Band { stations: vec![mk(Some(w))], noise: false, ..Default::default() }, &mut z30_channel::rng(0xA0D1_0000 + i as u64));
                let c = z30_channel::synthesize(&z30_channel::Band { stations: vec![mk(None)], noise: false, ..Default::default() }, &mut z30_channel::rng(1));
                let (ya, ca) = (analytic(&y), analytic(&c));
                let g: Vec<Complex64> = (lo..hi).map(|t| ya[t] / ca[t]).collect();
                let pw = (lo..hi).map(|t| ya[t].norm_sqr()).sum::<f64>() / (lo..hi).map(|t| ca[t].norm_sqr()).sum::<f64>();
                let mut acs = [Complex64::new(0.0, 0.0); 2];
                for (k, &lag) in lags.iter().enumerate() {
                    let l = (lag * FS) as usize;
                    let mut a = Complex64::new(0.0, 0.0);
                    for t in 0..g.len() - l {
                        a += g[t] * g[t + l].conj();
                    }
                    acs[k] = a / (g.len() - l) as f64;
                }
                let g2 = g.iter().map(|z| z.norm_sqr()).sum::<f64>() / g.len() as f64;
                (pw, g[g.len() / 2], acs, g2, 0.0)
            })
            .collect();
        let powers: Vec<f64> = per.iter().map(|v| v.0).collect();
        let (m, sd) = mean_sd(&powers);
        let mut sorted = powers.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let deep = powers.iter().filter(|&&p| p < 0.1).count() as f64 / powers.len() as f64;
        let taps: Vec<Complex64> = per.iter().map(|v| v.1).collect();
        let t2: Vec<f64> = taps.iter().map(|z| z.norm_sqr()).collect();
        let (tm, _) = mean_sd(&t2);
        let (rem, resd) = mean_sd(&taps.iter().map(|z| z.re).collect::<Vec<_>>());
        let (imm, imsd) = mean_sd(&taps.iter().map(|z| z.im).collect::<Vec<_>>());
        let tap_deep = t2.iter().filter(|&&v| v < 0.1).count() as f64 / t2.len() as f64;
        let r0: f64 = per.iter().map(|v| v.3).sum::<f64>() / per.len() as f64;
        let mut spreads = Vec::new();
        for (k, &lag) in lags.iter().enumerate() {
            let a: Complex64 = per.iter().map(|v| v.2[k]).sum::<Complex64>() / per.len() as f64;
            let rho = a.norm() / r0;
            // Gaussian Doppler PSD with standard deviation s has autocorrelation exp(-2 pi^2 s^2 tau^2).
            let s = (-rho.ln()).sqrt() / (std::f64::consts::SQRT_2 * std::f64::consts::PI * lag);
            spreads.push(json!({"lag_s": lag, "rho": rho, "psd_sigma_hz": s, "two_sigma_spread_hz": 2.0 * s}));
        }
        println!(
            "Watterson {preset:>13} (nominal 2-sigma spread {} Hz): frame power mean {m:.3} sd {sd:.3} cv {:.3} p10 {:.3} p50 {:.3} p90 {:.3} P(<-10 dB) {deep:.3} | tap |g|^2 mean {tm:.3} re {rem:+.3}/{resd:.3} im {imm:+.3}/{imsd:.3} P(|g|^2<0.1) {tap_deep:.3} | spreads {}",
            w.doppler_hz,
            sd / m,
            sorted[sorted.len() / 10],
            sorted[sorted.len() / 2],
            sorted[sorted.len() * 9 / 10],
            spreads.iter().map(|s| format!("{:.3}", s["two_sigma_spread_hz"].as_f64().unwrap())).collect::<Vec<_>>().join("/")
        );
        out.insert(
            preset.into(),
            json!({"nominal_doppler_spread_hz": w.doppler_hz, "delay_ms": w.delay_ms, "realisations": reals,
                "frame_power": {"mean": m, "sd": sd, "cv": sd / m, "p10": sorted[sorted.len()/10], "p50": sorted[sorted.len()/2], "p90": sorted[sorted.len()*9/10], "frac_below_minus10db": deep},
                "tap_midframe": {"mean_abs2": tm, "re_mean": rem, "re_sd": resd, "im_mean": imm, "im_sd": imsd, "frac_abs2_below_0.1": tap_deep},
                "measured_spread": spreads}),
        );
    }
    Value::Object(out)
}

// ------------------------------------------------------------------------------ SIC

fn sic(trials: usize) -> Value {
    let mut rows = Vec::new();
    let weak_snr = -18.0;
    let mut p = 0u64;
    for dpow in [10.0, 20.0] {
        for df in [0.0, 5.0, 20.0] {
            for ddt in [0.0, 0.4] {
                let res: Vec<(bool, bool, bool, usize, Option<f64>, Option<f64>, bool)> = (0..trials)
                    .into_par_iter()
                    .map_init(|| (Receiver::new(), Modulator::new(FS).unwrap()), |(rx, m), i| {
                        let mut r = rng(6, p, i as u64);
                        let mut strong = random_tx(&mut r, 0.0);
                        strong.f0 = r.gen_range(300.0..2500.0);
                        strong.dt = r.gen_range(-1.0..0.6);
                        let mut weak = random_tx(&mut r, 0.0);
                        weak.f0 = strong.f0 + df;
                        weak.dt = strong.dt + ddt;
                        let s = render(m, &strong, weak_snr + dpow);
                        let wv = render(m, &weak, weak_snr);
                        let n = noise(&mut r);
                        let x: Vec<f64> = (0..WIN).map(|k| s[k] + wv[k] + n[k]).collect();
                        let xf = to_f32(&x);
                        let on = rx.decode_slot(&xf, &RxConfig::default());
                        let off = rx.decode_slot(&xf, &RxConfig { passes: 1, ..Default::default() });
                        let fals = on.decodes.iter().chain(off.decodes.iter()).filter(|d| d.info[..63] != strong.payload && d.info[..63] != weak.payload).count();
                        // Physical suppression of the strong station by the production subtraction,
                        // measured against the known strong waveform (not the receiver's own metric).
                        let (mut phys, mut reported, mut modified) = (None, None, false);
                        if let Some(d) = off.decodes.iter().find(|d| d.info[..63] == strong.payload) {
                            let sym = codeword_to_symbols(&encode_info(&d.info));
                            let start = (ZERO as f64 + d.dt_sec * FS).round() as i64;
                            let mut resid = xf.clone();
                            let sub = z30_dsp::sic::subtract(&mut resid, m, &sym, d.freq_hz, d.drift_hz, start, &z30_dsp::sic::SicParams::default());
                            modified = resid.iter().zip(&xf).any(|(a, b)| a != b);
                            let es: f64 = s.iter().map(|v| v * v).sum();
                            let left: f64 = (0..WIN).map(|k| (resid[k] as f64 - wv[k] - n[k]).powi(2)).sum();
                            phys = Some(10.0 * (es / left).log10());
                            reported = Some(sub.suppression_db);
                        }
                        (found(&on, &strong.payload), found(&on, &weak.payload), found(&off, &weak.payload), fals, phys, reported, modified)
                    })
                    .collect();
                let won = res.iter().filter(|v| v.1).count();
                let woff = res.iter().filter(|v| v.2).count();
                let st = res.iter().filter(|v| v.0).count();
                let f: usize = res.iter().map(|v| v.3).sum();
                let phys: Vec<f64> = res.iter().filter_map(|v| v.4).collect();
                let rep: Vec<f64> = res.iter().filter_map(|v| v.5).collect();
                let modified = res.iter().filter(|v| v.6).count();
                let (pm, psd) = mean_sd(&phys);
                let (rm, _) = mean_sd(&rep);
                println!(
                    "SIC dP {dpow:+.0} df {df:4.1} dDT {ddt:.1}: strong {st}/{trials}; weak with SIC {won}, without {woff}; false {f}; physical suppression {pm:.1} dB (sd {psd:.1}, n {}); receiver-reported {rm:.1} dB; residual modified in {modified}",
                    phys.len()
                );
                rows.push(json!({"power_difference_db": dpow, "df_hz": df, "ddt_s": ddt, "trials": trials, "strong_decoded": st,
                    "weak_with_sic": won, "weak_without_sic": woff, "false_decodes": f,
                    "physical_suppression_db_mean": pm, "physical_suppression_db_sd": psd, "reported_suppression_db_mean": rm,
                    "residual_modified": modified, "n_subtractions": phys.len()}));
                p += 1;
            }
        }
    }
    json!({"points": rows})
}

// ------------------------------------------------------------------------------ TX round trip

/// Negative tests of `EncodedMessage::verify_round_trip` that the repository does not contain:
/// every corruption of a valid encoding must be refused.
fn roundtrip() -> Value {
    use z30_protocol::codec::{EncodedMessage, Message};
    use z30_protocol::ldpc::info_from_payload;
    let base = Message::parse("G4XYZ K1ABC -12").unwrap().encode().unwrap();
    assert!(base.verify_round_trip().is_ok());
    let mut cases: Vec<(String, EncodedMessage)> = Vec::new();
    // 1. one data symbol changed (symbols no longer match the stored codeword)
    for &d in &z30_protocol::DATA_POSITIONS[..5] {
        let mut e = base.clone();
        e.symbols[d] = (e.symbols[d] + 1) % 16;
        cases.push((format!("data symbol {d} +1"), e));
    }
    // 2. a Costas symbol changed
    let mut e = base.clone();
    e.symbols[z30_protocol::SYNC_POSITIONS[4]] ^= 1;
    cases.push(("sync symbol changed".into(), e));
    // 3. a tone value out of range
    let mut e = base.clone();
    e.symbols[z30_protocol::DATA_POSITIONS[0]] = 16;
    cases.push(("tone 16".into(), e));
    // 4. corrupted CRC: flip a CRC bit, re-encode LDPC so the frame is a valid codeword
    let mut info = base.info;
    info[70] ^= 1;
    let cw = encode_info(&info);
    let mut e = base.clone();
    e.info = info;
    e.codeword = cw;
    e.symbols = codeword_to_symbols(&cw);
    cases.push(("CRC bit flipped, LDPC re-encoded (valid codeword, bad CRC)".into(), e));
    // 5. altered payload with a correct CRC and LDPC: a valid frame of a DIFFERENT message
    let other = Message::parse("G4XYZ K1ABC -13").unwrap();
    let info2 = info_from_payload(&other.payload());
    let cw2 = encode_info(&info2);
    let mut e = base.clone();
    e.info = info2;
    e.codeword = cw2;
    e.symbols = codeword_to_symbols(&cw2);
    cases.push(("payload altered to -13 with valid CRC and LDPC, message still says -12".into(), e));
    // 6. codeword parity bit flipped, symbols recomputed from it (syndrome non-zero)
    let mut cw3 = base.codeword;
    cw3[200] ^= 1;
    let mut e = base.clone();
    e.codeword = cw3;
    e.symbols = codeword_to_symbols(&cw3);
    cases.push(("parity bit flipped, symbols consistent with it".into(), e));
    // 7. partner callsign swapped in the payload (FN42->RE78 style substitution, at symbol level)
    let sub = Message::parse("G4XYY K1ABC -12").unwrap();
    let info4 = info_from_payload(&sub.payload());
    let cw4 = encode_info(&info4);
    let mut e = base.clone();
    e.info = info4;
    e.codeword = cw4;
    e.symbols = codeword_to_symbols(&cw4);
    cases.push(("partner call altered at symbol level (G4XYZ -> G4XYY)".into(), e));
    // 8. the stored message altered but the frame left as sent
    let mut e = base.clone();
    e.message = Message::parse("G4XYZ K1ABC -11").unwrap();
    cases.push(("message field altered, frame unchanged".into(), e));
    let mut rows = Vec::new();
    let mut all_refused = true;
    for (name, e) in cases {
        let r = e.verify_round_trip();
        all_refused &= r.is_err();
        println!("verify_round_trip [{name}]: {}", if r.is_err() { "REFUSED" } else { "ACCEPTED (!)" });
        rows.push(json!({"case": name, "refused": r.is_err(), "error": r.err().map(|e| e.to_string())}));
    }
    // Messages the encoder must refuse (the transmit gate's first line).
    let mut enc_rows = Vec::new();
    for t in ["CQ K1ABC FN42", "ZY2ABC K1ABC -10", "CQ K1ABC/P FN31", "G4XYZ K1ABC R-12", "G4XYZ K1ABC -31", "G4XYZ K1ABC +31",
        "CQ NOCAL FN31", "CQ K1ABC", "G4XYZ K1ABC HELLO", "TNX K1ABC 73", "CQ K1ABC -10", "EA8/G4XYZ K1ABC 73", "CQ 3DA0XYZ FN31"] {
        let r = Message::parse(t).and_then(|m| m.encode());
        println!("encode [{t}]: {}", match &r { Ok(e) => format!("ENCODED as {}", e.message), Err(e) => format!("refused: {e}") });
        enc_rows.push(json!({"message": t, "refused": r.is_err()}));
    }
    json!({"verify_round_trip_negative_cases": rows, "all_refused": all_refused, "encoder_refusals": enc_rows})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let what = args.get(1).map(String::as_str).unwrap_or("all");
    let n: Option<usize> = args.get(2).and_then(|s| s.parse().ok());
    let t = std::time::Instant::now();
    let v = match what {
        "awgn" => awgn(n.unwrap_or(200)),
        "snr" => snr_sweep(n.unwrap_or(100)),
        "mismatch" => snr_mismatch(n.unwrap_or(60)),
        "nosig" => nosig(n.unwrap_or(200)),
        "watterson" => watterson(n.unwrap_or(400)),
        "sic" => sic(n.unwrap_or(50)),
        "roundtrip" => roundtrip(),
        _ => panic!("unknown"),
    };
    let out = json!({"what": what, "seed_base": format!("{SEED_BASE:#x}"), "elapsed_s": t.elapsed().as_secs_f64(), "result": v,
        "receiver": "z30_dsp::slot::Receiver::decode_slot, RxConfig::default()", "note": "independent audit harness; software simulation only"});
    let path = format!("audit_{what}.json");
    std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap()).unwrap();
    eprintln!("wrote {path} in {:.0} s", t.elapsed().as_secs_f64());
}
