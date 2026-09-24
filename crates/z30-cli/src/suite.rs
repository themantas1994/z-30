//! `z30 --benchmark suite`: the measurement suite behind every figure the documentation quotes.
//!
//! Rules this module keeps (2026-09-24 remediation brief, sections 16 and 24):
//!
//! - The receiver under test is `z30_dsp::slot::Receiver::decode_slot` with the production
//!   `RxConfig::default()` - the function the GUI and CLI stations call - inside the `z30`
//!   binary an operator runs. It is handed only the 27 s slot window. Ground truth (payloads,
//!   frequencies, timings) stays here, in the harness, and is only compared afterwards.
//! - Channels come from `z30-channel` (seeded ChaCha8, SPEC.md section 10 SNR). Every frame's
//!   generator is seeded from (benchmark seed, point, frame index), so results do not depend on
//!   thread count or scheduling, and any single frame can be regenerated.
//! - Every result file carries its provenance: the binary's commit and build, the machine, the
//!   channel, the SNR definition, the placement distributions, the seed, the frame count, the
//!   success and false-decode criteria, and Wilson 95% intervals. Results are written by this
//!   code only; nothing here reads a previous result.

use crate::bench::upper95;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;
use z30_channel::{rng, synthesize, Band, ChannelRng, Station, Watterson, FS, SLOT_ZERO_INDEX};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};
use z30_protocol::gfsk::Modulator;

/// Base seed of the suite: the project's published seed, 2026-08-30.
pub const SUITE_SEED: u64 = 20_260_830;

const BENCHMARKS: [&str; 10] = ["awgn", "snr", "drift", "timing", "clock", "impair", "busy", "false", "sic", "fading"];

// ------------------------------------------------------------------------------ statistics

/// Wilson score 95% interval for k of n, in percent.
pub fn wilson(k: usize, n: usize) -> (f64, f64) {
    if n == 0 {
        return (0.0, 100.0);
    }
    let (k, n, z) = (k as f64, n as f64, 1.959_963_984_540_054);
    let p = k / n;
    let den = 1.0 + z * z / n;
    let centre = (p + z * z / (2.0 * n)) / den;
    let half = z * (p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt() / den;
    (100.0 * (centre - half).max(0.0), 100.0 * (centre + half).min(1.0))
}

/// Exact two-sided McNemar p-value for `b` and `c` discordant pairs (binomial, p = 1/2).
pub fn mcnemar_exact(b: usize, c: usize) -> f64 {
    let n = b + c;
    if n == 0 {
        return 1.0;
    }
    let k = b.min(c);
    // log C(n, i) - n log 2, summed in the log domain.
    let ln_fact = |m: usize| (1..=m).map(|v| (v as f64).ln()).sum::<f64>();
    let ln_n = ln_fact(n);
    let tail: f64 = (0..=k).map(|i| (ln_n - ln_fact(i) - ln_fact(n - i) - n as f64 * std::f64::consts::LN_2).exp()).sum();
    (2.0 * tail).min(1.0)
}

fn percentile(v: &[f64], q: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s[((q * s.len() as f64).ceil() as usize).clamp(1, s.len()) - 1]
}

fn mean_sd(v: &[f64]) -> (f64, f64) {
    if v.is_empty() {
        return (f64::NAN, f64::NAN);
    }
    let m = v.iter().sum::<f64>() / v.len() as f64;
    let sd = if v.len() > 1 { (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len() - 1) as f64).sqrt() } else { f64::NAN };
    (m, sd)
}

/// Linear interpolation of where a rate curve crosses `target` percent, with the interval from
/// the same interpolation of the Wilson bounds. `None` if the points do not bracket it.
fn crossing(points: &[(f64, usize, usize)], target: f64) -> Option<Value> {
    let curve = |f: &dyn Fn(usize, usize) -> f64| -> Option<f64> {
        points.windows(2).find_map(|w| {
            let (x0, y0, x1, y1) = (w[0].0, f(w[0].1, w[0].2), w[1].0, f(w[1].1, w[1].2));
            ((y0 - target) * (y1 - target) <= 0.0 && y0 != y1).then(|| x0 + (target - y0) * (x1 - x0) / (y1 - y0))
        })
    };
    let centre = curve(&|k, n| 100.0 * k as f64 / n as f64)?;
    // The upper Wilson bound reaches the target first (at the lower x), the lower bound last.
    let lo = curve(&|k, n| wilson(k, n).1);
    let hi = curve(&|k, n| wilson(k, n).0);
    Some(
        json!({ "at": centre, "interval": [lo, hi], "method": "linear interpolation between adjacent points of the rate and of its Wilson 95% bounds" }),
    )
}

// ------------------------------------------------------------------------------ provenance

fn cpu_model() -> String {
    std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("model name")).and_then(|l| l.split(':').nth(1)).map(|v| v.trim().to_string()))
        .unwrap_or_else(|| "not available on this platform".into())
}

fn provenance(started: &str) -> Value {
    json!({
        "binary": "z30 (z30-cli), the shipped command-line station",
        "version": env!("CARGO_PKG_VERSION"),
        "git_commit": env!("Z30_BUILD_COMMIT"),
        "built": env!("Z30_BUILD_DATE"),
        "rustc": env!("Z30_BUILD_RUSTC"),
        "build_profile": env!("Z30_BUILD_PROFILE"),
        "target": env!("Z30_BUILD_TARGET"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpu": cpu_model(),
        "logical_cpus": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
        "rayon_threads": rayon::current_num_threads(),
        "started_utc": started,
        "receiver": "z30_dsp::slot::Receiver::decode_slot (the production receive entry point)",
        "decoder_config": format!("{:?}", RxConfig::default()),
        "hardware_involved": false,
        "note": "Software simulation only. No radio, sound card or RF path was involved.",
    })
}

fn definitions() -> Value {
    json!({
        "sample_rate_hz": FS,
        "snr": "SPEC.md section 10: frame signal power over the noise power in 2500 Hz; real white Gaussian noise, sigma = 1 per sample at 6 kHz, so SNR = P / (5000 / 6000)",
        "success": "a decode whose 63 payload bits equal the transmitted payload",
        "false_decode": "a CRC-valid decode whose payload was not transmitted in that slot",
        "duplicates_dropped": "decodes of an already-decoded payload that the receiver itself discarded (PassStats::duplicates)",
        "duplicates_emitted": "the same payload reported more than once in the output (must be 0)",
        "interval": "Wilson score 95% interval, percent",
        "latency": "wall-clock time of decode_slot per slot, measured while other slots were decoded concurrently on the same pool; indicative only (see `z30 --benchmark perf` for controlled latency)",
        "ground_truth": "the harness knows the transmitted payloads; the receiver is given only the 27 s window",
    })
}

/// Default output directory: research/results/<commit>.
fn default_out() -> PathBuf {
    PathBuf::from("research").join("results").join(env!("Z30_BUILD_COMMIT"))
}

fn now_utc() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let (d, tm) = z30_io::logbook::utc_parts(t);
    format!("{}-{}-{}T{}:{}:{}Z", &d[..4], &d[4..6], &d[6..], &tm[..2], &tm[2..4], &tm[4..])
}

// ------------------------------------------------------------------------------ trials

/// What happened to one single-station slot.
#[derive(Clone, Debug, Default)]
struct Outcome {
    ok: bool,
    false_decodes: usize,
    dups_dropped: usize,
    dups_emitted: usize,
    ms: f64,
    snr_measured: Option<f64>,
    dt_err_ms: Option<f64>,
    f_err_hz: Option<f64>,
}

fn score(rep: &SlotReport, payloads: &[[u8; 63]]) -> (usize, usize, usize, usize) {
    let found = payloads.iter().filter(|p| rep.decodes.iter().any(|d| d.info[..63] == **p)).count();
    let false_decodes = rep.decodes.iter().filter(|d| !payloads.iter().any(|p| d.info[..63] == *p)).count();
    let mut seen = std::collections::HashSet::new();
    let dups_emitted = rep.decodes.iter().filter(|d| !seen.insert(d.info)).count();
    let dups_dropped = rep.passes.iter().map(|p| p.duplicates).sum();
    (found, false_decodes, dups_dropped, dups_emitted)
}

/// One station placed blind: tone 0 uniform over 210-2740 Hz, DT uniform over +-dt_max s,
/// random carrier phase and payload. `tweak` sets the condition under test.
fn blind_station(r: &mut ChannelRng, snr: f64, dt_max: f64) -> ([u8; 63], Station) {
    use rand::Rng;
    let f0 = r.gen_range(210.0..2740.0);
    let dt = if dt_max > 0.0 { r.gen_range(-dt_max..dt_max) } else { 0.0 };
    z30_channel::random_station(r, f0, dt, snr)
}

/// Seed of frame `i` of point `p` of a benchmark.
fn frame_seed(bench: u64, p: usize, i: usize) -> u64 {
    SUITE_SEED ^ (bench << 40) ^ ((p as u64) << 20) ^ i as u64
}

/// Runs `frames` single-station slots in parallel. `make` builds (payload, station, extra
/// processing of the synthesised window) from the frame's generator.
fn run_point<F>(bench: u64, p: usize, frames: usize, make: F) -> Vec<Outcome>
where
    F: Fn(&mut ChannelRng) -> ([u8; 63], Station, Option<Post>) + Sync,
{
    (0..frames)
        .into_par_iter()
        .map_init(Receiver::new, |rx, i| {
            let mut r = rng(frame_seed(bench, p, i));
            let (payload, st, post) = make(&mut r);
            let truth = st.clone();
            let mut x = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut r);
            if let Some(f) = post {
                f(&mut x, &mut r);
            }
            let t = Instant::now();
            let rep = rx.decode_slot(&x, &RxConfig::default());
            let ms = t.elapsed().as_secs_f64() * 1e3;
            let (found, false_decodes, dups_dropped, dups_emitted) = score(&rep, &[payload]);
            let d = rep.decodes.iter().find(|d| d.info[..63] == payload);
            Outcome {
                ok: found == 1,
                false_decodes,
                dups_dropped,
                dups_emitted,
                ms,
                snr_measured: d.and_then(|d| d.snr_db),
                dt_err_ms: d.map(|d| (d.dt_sec - truth.dt_sec) * 1e3),
                f_err_hz: d.map(|d| d.freq_hz - truth.f0_hz),
            }
        })
        .collect()
}

fn point_json(label: &str, param: Value, v: &[Outcome]) -> Value {
    let k = v.iter().filter(|o| o.ok).count();
    let (lo, hi) = wilson(k, v.len());
    let ms: Vec<f64> = v.iter().map(|o| o.ms).collect();
    json!({
        "label": label,
        "param": param,
        "decoded": k,
        "frames": v.len(),
        "percent": 100.0 * k as f64 / v.len().max(1) as f64,
        "wilson95": [lo, hi],
        "false_decodes": v.iter().map(|o| o.false_decodes).sum::<usize>(),
        "duplicates_dropped": v.iter().map(|o| o.dups_dropped).sum::<usize>(),
        "duplicates_emitted": v.iter().map(|o| o.dups_emitted).sum::<usize>(),
        "latency_ms": { "p50": percentile(&ms, 0.5), "p95": percentile(&ms, 0.95), "max": percentile(&ms, 1.0) },
    })
}

fn line(p: &Value) -> String {
    format!(
        "{:>28}  {:>4}/{:<4} = {:5.1}%  [{:5.1}-{:5.1}]  false {}  dups dropped {} emitted {}  ms p50 {:.0} max {:.0}",
        p["label"].as_str().unwrap_or(""),
        p["decoded"],
        p["frames"],
        p["percent"].as_f64().unwrap_or(f64::NAN),
        p["wilson95"][0].as_f64().unwrap_or(f64::NAN),
        p["wilson95"][1].as_f64().unwrap_or(f64::NAN),
        p["false_decodes"],
        p["duplicates_dropped"],
        p["duplicates_emitted"],
        p["latency_ms"]["p50"].as_f64().unwrap_or(f64::NAN),
        p["latency_ms"]["max"].as_f64().unwrap_or(f64::NAN),
    )
}

// ------------------------------------------------------------------------------ benchmarks

fn awgn(frames: usize) -> Value {
    let snrs = [-26.0, -25.0, -24.0, -23.5, -23.0, -22.5, -22.0, -21.0, -20.0];
    let mut points = Vec::new();
    let mut curve = Vec::new();
    for (p, &snr) in snrs.iter().enumerate() {
        let v = run_point(1, p, frames, |r| {
            let (pl, st) = blind_station(r, snr, 1.4);
            (pl, st, None)
        });
        let pj = point_json(&format!("AWGN {snr:+.1} dB"), json!(snr), &v);
        eprintln!("{}", line(&pj));
        curve.push((snr, pj["decoded"].as_u64().unwrap() as usize, v.len()));
        points.push(pj);
    }
    json!({
        "benchmark": "awgn",
        "title": "Single-station sensitivity, AWGN, blind acquisition",
        "channel": "AWGN (z30_channel::synthesize, noise sigma = 1)",
        "placement": { "tone0_hz": "uniform 210-2740", "dt_s": "uniform -1.4..+1.4", "carrier_phase": "uniform 0-2 pi", "payload": "uniform random 63 bits", "drift_hz": 0 },
        "frames_per_point": frames,
        "points": points,
        "crossing_50pct_db": crossing(&curve, 50.0),
        "crossing_90pct_db": crossing(&curve, 90.0),
    })
}

fn snr_accuracy(frames: usize) -> Value {
    let snrs = [-25.0, -22.0, -20.0, -15.0, -10.0, -6.0, 0.0, 5.0, 10.0, 20.0, 30.0];
    let mut points = Vec::new();
    for (p, &snr) in snrs.iter().enumerate() {
        let v = run_point(2, p, frames, |r| {
            let (pl, st) = blind_station(r, snr, 1.4);
            (pl, st, None)
        });
        let errs: Vec<f64> = v.iter().filter_map(|o| o.snr_measured.map(|m| m - snr)).collect();
        let unmeasured = v.iter().filter(|o| o.ok && o.snr_measured.is_none()).count();
        let dts: Vec<f64> = v.iter().filter_map(|o| o.dt_err_ms).collect();
        let fs: Vec<f64> = v.iter().filter_map(|o| o.f_err_hz).collect();
        let (b, sd) = mean_sd(&errs);
        let (db, dsd) = mean_sd(&dts);
        let (fb, fsd) = mean_sd(&fs);
        let mut pj = point_json(&format!("true {snr:+.0} dB"), json!(snr), &v);
        pj["snr_measured"] = json!({ "n": errs.len(), "not_measured": unmeasured, "bias_db": b, "sd_db": sd,
            "min_error_db": percentile(&errs, 0.0), "max_error_db": percentile(&errs, 1.0) });
        pj["dt_error_ms"] = json!({ "n": dts.len(), "bias": db, "sd": dsd, "max_abs": dts.iter().fold(0.0f64, |m, v| m.max(v.abs())) });
        pj["freq_error_hz"] = json!({ "n": fs.len(), "bias": fb, "sd": fsd, "max_abs": fs.iter().fold(0.0f64, |m, v| m.max(v.abs())) });
        eprintln!("true {snr:+5.1} dB: decoded {}/{}  SNR bias {b:+.2} sd {sd:.2} dB | DT bias {db:+.2} sd {dsd:.2} ms | f bias {fb:+.3} sd {fsd:.3} Hz", errs.len(), v.len());
        points.push(pj);
    }
    json!({
        "benchmark": "snr",
        "title": "Accuracy of the reported SNR, DT and frequency against the truth",
        "channel": "AWGN", "placement": "as awgn",
        "frames_per_point": frames,
        "validated_range_db": [z30_dsp::demod::SNR_VALIDATED_MIN_DB, z30_dsp::demod::SNR_VALIDATED_MAX_DB],
        "points": points,
    })
}

fn drift(frames: usize) -> Value {
    let mut points = Vec::new();
    let mut p = 0;
    for snr in [-22.0, -20.0] {
        for d in [0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 4.0, -4.0, 5.0, -5.0, 6.0, -6.0, 8.0, -8.0] {
            let v = run_point(3, p, frames, |r| {
                let (pl, mut st) = blind_station(r, snr, 1.4);
                st.drift_hz = d;
                (pl, st, None)
            });
            let pj = point_json(&format!("drift {d:+.0} Hz @ {snr:+.0} dB"), json!({"drift_hz": d, "snr_db": snr}), &v);
            eprintln!("{}", line(&pj));
            points.push(pj);
            p += 1;
        }
    }
    json!({ "benchmark": "drift", "title": "Linear carrier drift across the 24 s frame (total Hz, zero at mid-frame)",
        "channel": "AWGN", "placement": "as awgn, plus the listed drift", "frames_per_point": frames, "points": points })
}

fn timing(frames: usize) -> Value {
    let mut points = Vec::new();
    for (p, dt) in [0.0, 1.0, -1.0, 1.4, -1.4, 1.5, -1.5, 1.6, -1.6, 2.0, -2.0].into_iter().enumerate() {
        let v = run_point(4, p, frames, |r| {
            let (pl, mut st) = blind_station(r, -20.0, 0.0);
            st.dt_sec = dt;
            (pl, st, None)
        });
        let pj = point_json(&format!("DT {dt:+.1} s @ -20 dB"), json!(dt), &v);
        eprintln!("{}", line(&pj));
        points.push(pj);
    }
    json!({ "benchmark": "timing", "title": "Frame start offset (DT) from the slot boundary",
        "channel": "AWGN, -20 dB", "placement": "tone 0 uniform 210-2740 Hz, DT fixed per point", "frames_per_point": frames, "points": points })
}

fn clock(frames: usize) -> Value {
    let mut points = Vec::new();
    for (p, ppm) in [0.0, 100.0, -100.0, 1000.0, -1000.0, 3000.0, -3000.0, 5000.0, -5000.0, 10000.0, -10000.0].into_iter().enumerate() {
        let v: Vec<Outcome> = (0..frames)
            .into_par_iter()
            .map_init(Receiver::new, |rx, i| {
                let mut r = rng(frame_seed(5, p, i));
                let (payload, st) = blind_station(&mut r, -20.0, 1.0);
                let x = synthesize(&Band { stations: vec![st], noise: true, rx_clock_ppm: ppm, ..Default::default() }, &mut r);
                let t = Instant::now();
                let rep = rx.decode_slot(&x, &RxConfig::default());
                let (found, false_decodes, dups_dropped, dups_emitted) = score(&rep, &[payload]);
                Outcome {
                    ok: found == 1,
                    false_decodes,
                    dups_dropped,
                    dups_emitted,
                    ms: t.elapsed().as_secs_f64() * 1e3,
                    ..Default::default()
                }
            })
            .collect();
        let pj = point_json(&format!("clock {ppm:+.0} ppm @ -20 dB"), json!(ppm), &v);
        eprintln!("{}", line(&pj));
        points.push(pj);
    }
    json!({ "benchmark": "clock", "title": "Receiver sample-clock error (the whole slot recorded by a sound card running fast or slow)",
        "channel": "AWGN, -20 dB; z30_channel band-limited time stretch of the slot from its first sample",
        "placement": "tone 0 uniform 210-2740 Hz, DT uniform +-1.0 s (so the accumulated error keeps the frame inside the window at 1%)",
        "frames_per_point": frames, "points": points })
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() as f32
}

type Post = Box<dyn Fn(&mut Vec<f32>, &mut ChannelRng)>;
/// A named impairment and how to build it (None = the unimpaired baseline).
type Impairment = (&'static str, Option<fn() -> Post>);

fn impairments() -> Vec<Impairment> {
    vec![
        ("baseline", None),
        (
            "hard clip at 3 x RMS",
            Some(|| -> Post {
                Box::new(|x, _| {
                    let c = 3.0 * rms(x);
                    x.iter_mut().for_each(|v| *v = v.clamp(-c, c));
                })
            }),
        ),
        (
            "hard clip at 1 x RMS",
            Some(|| -> Post {
                Box::new(|x, _| {
                    let c = rms(x);
                    x.iter_mut().for_each(|v| *v = v.clamp(-c, c));
                })
            }),
        ),
        (
            "8-bit quantisation, full scale 4 x RMS",
            Some(|| -> Post {
                Box::new(|x, _| {
                    let fs = 4.0 * rms(x);
                    x.iter_mut().for_each(|v| *v = ((*v / fs).clamp(-1.0, 1.0) * 127.0).round() / 127.0 * fs);
                })
            }),
        ),
        (
            "0.5 s dropout mid-frame",
            Some(|| -> Post { Box::new(|x, _| x[SLOT_ZERO_INDEX + 72_000..SLOT_ZERO_INDEX + 75_000].iter_mut().for_each(|v| *v = 0.0)) }),
        ),
        (
            "2 s dropout mid-frame",
            Some(|| -> Post { Box::new(|x, _| x[SLOT_ZERO_INDEX + 66_000..SLOT_ZERO_INDEX + 78_000].iter_mut().for_each(|v| *v = 0.0)) }),
        ),
        (
            "200 impulses at 50 x RMS",
            Some(|| -> Post {
                Box::new(|x, r| {
                    use rand::Rng;
                    let a = 50.0 * rms(x);
                    for _ in 0..200 {
                        let at = r.gen_range(0..x.len());
                        let sign = if r.gen_bool(0.5) { 1.0 } else { -1.0 };
                        // Exponentially decaying, 5 ms time constant.
                        for k in 0..180 {
                            if at + k < x.len() {
                                x[at + k] += sign * a * (-(k as f32) / 30.0).exp();
                            }
                        }
                    }
                })
            }),
        ),
    ]
}

fn impair(frames: usize) -> Value {
    let mut points = Vec::new();
    for (p, (name, post)) in impairments().into_iter().enumerate() {
        let v = run_point(6, p, frames, |r| {
            let (pl, st) = blind_station(r, -20.0, 1.4);
            (pl, st, post.map(|f| f()))
        });
        let pj = point_json(&format!("{name} @ -20 dB"), json!(name), &v);
        eprintln!("{}", line(&pj));
        points.push(pj);
    }
    json!({ "benchmark": "impair", "title": "Audio impairments applied to the 6 kHz slot after noise (i.e. after resampling, not at the device rate)",
        "channel": "AWGN, -20 dB", "placement": "as awgn", "frames_per_point": frames, "points": points })
}

fn busy(slots: usize) -> Value {
    use rand::Rng;
    let mut points = Vec::new();
    let configs: [(usize, f64, f64); 5] = [(5, -20.0, 0.0), (10, -20.0, 0.0), (20, -20.0, 0.0), (40, -20.0, 0.0), (20, -22.0, -16.0)];
    for (p, &(k, lo, hi)) in configs.iter().enumerate() {
        let per_slot: Vec<(usize, usize, usize, usize, usize, f64)> = (0..slots)
            .into_par_iter()
            .map_init(Receiver::new, |rx, i| {
                let mut r = rng(frame_seed(7, p, i));
                let mut stations = Vec::new();
                let mut payloads = Vec::new();
                for _ in 0..k {
                    let snr = r.gen_range(lo..hi);
                    let (pl, st) = blind_station(&mut r, snr, 1.4);
                    stations.push(st);
                    payloads.push(pl);
                }
                let x = synthesize(&Band { stations, noise: true, ..Default::default() }, &mut r);
                let t = Instant::now();
                let rep = rx.decode_slot(&x, &RxConfig::default());
                let ms = t.elapsed().as_secs_f64() * 1e3;
                let (found, f, dd, de) = score(&rep, &payloads);
                (found, k, f, dd, de, ms)
            })
            .collect();
        let found: usize = per_slot.iter().map(|s| s.0).sum();
        let total: usize = per_slot.iter().map(|s| s.1).sum();
        let (wl, wh) = wilson(found, total);
        let ms: Vec<f64> = per_slot.iter().map(|s| s.5).collect();
        let pj = json!({
            "label": format!("K = {k}, {lo:+.0}..{hi:+.0} dB"),
            "param": {"stations": k, "snr_db": [lo, hi]},
            "decoded": found, "frames": total, "slots": slots,
            "percent": 100.0 * found as f64 / total.max(1) as f64, "wilson95": [wl, wh],
            "false_decodes": per_slot.iter().map(|s| s.2).sum::<usize>(),
            "false_decode_upper95_per_slot": upper95(per_slot.iter().map(|s| s.2 as u64).sum(), slots as u64),
            "duplicates_dropped": per_slot.iter().map(|s| s.3).sum::<usize>(),
            "duplicates_emitted": per_slot.iter().map(|s| s.4).sum::<usize>(),
            "latency_ms": { "p50": percentile(&ms, 0.5), "p95": percentile(&ms, 0.95), "max": percentile(&ms, 1.0) },
        });
        eprintln!("{}", line(&pj));
        points.push(pj);
    }
    json!({ "benchmark": "busy", "title": "Busy band: K stations, random overlapping placement",
        "channel": "AWGN", "placement": { "tone0_hz": "uniform 210-2740 per station, overlaps allowed", "dt_s": "uniform -1.4..+1.4", "snr_db": "uniform over the listed range per station" },
        "slots_per_point": slots, "points": points })
}

/// Structured interference for the false-decode benchmark, added to sigma = 1 noise.
fn interference(kind: usize, r: &mut ChannelRng, x: &mut [f32]) {
    use rand::Rng;
    let n = x.len();
    let amp_for = |snr_db: f64| (2.0 * 10f64.powf(snr_db / 10.0) * 5000.0 / FS).sqrt();
    match kind {
        // 8 random 16-FSK signals, 3.125 Hz spacing, 0.32 s symbols, NO Costas pattern, 0 dB.
        1 => {
            let m = Modulator::new(FS).unwrap();
            for _ in 0..8 {
                let mut sym = [0u8; 75];
                sym.iter_mut().for_each(|s| *s = r.gen_range(0..16));
                let (re, _) = m.analytic(&sym, r.gen_range(210.0..2740.0), 0.0, 0.0);
                let start = r.gen_range(0..n - re.len());
                let a = amp_for(0.0) as f32 / 2f32.sqrt();
                for (i, v) in re.iter().enumerate() {
                    x[start + i] += a * *v as f32;
                }
            }
        }
        // 8 FT8-like 8-FSK signals: 6.25 Hz spacing, 0.16 s symbols, 79 symbols, continuous phase, 0 dB.
        2 => {
            for _ in 0..8 {
                let f0 = r.gen_range(210.0..2740.0);
                let start = r.gen_range(0..n - 79 * 960);
                let a = amp_for(0.0) as f32;
                let mut ph = r.gen_range(0.0..std::f64::consts::TAU);
                for s in 0..79 {
                    let f = f0 + 6.25 * r.gen_range(0..8) as f64;
                    for k in 0..960 {
                        ph += std::f64::consts::TAU * f / FS;
                        x[start + s * 960 + k] += a * ph.sin() as f32;
                    }
                }
            }
        }
        // 500 impulses, amplitude up to 40 sigma, 2 ms decay.
        3 => {
            for _ in 0..500 {
                let at = r.gen_range(0..n);
                let a = r.gen_range(-40.0f32..40.0);
                for k in 0..60 {
                    if at + k < n {
                        x[at + k] += a * (-(k as f32) / 12.0).exp();
                    }
                }
            }
        }
        _ => {}
    }
}

fn false_decodes(slots: usize) -> Value {
    let kinds: [(&str, usize); 5] = [
        ("white noise only", 0),
        ("20 CW carriers, -10..+20 dB", 4),
        ("8 random 16-FSK signals without the Costas pattern, 0 dB", 1),
        ("8 FT8-like 8-FSK signals, 0 dB", 2),
        ("500 impulses up to 40 sigma", 3),
    ];
    let mut points = Vec::new();
    let (mut all_slots, mut all_false) = (0u64, 0u64);
    for (p, (name, kind)) in kinds.into_iter().enumerate() {
        let per: Vec<(usize, usize)> = (0..slots)
            .into_par_iter()
            .map_init(Receiver::new, |rx, i| {
                use rand::Rng;
                let mut r = rng(frame_seed(8, p, i));
                let cw = if kind == 4 { (0..20).map(|_| (r.gen_range(200.0..2800.0), r.gen_range(-10.0..20.0))).collect() } else { vec![] };
                let mut x = synthesize(&Band { cw, noise: true, ..Default::default() }, &mut r);
                interference(kind, &mut r, &mut x);
                let rep = rx.decode_slot(&x, &RxConfig::default());
                (rep.decodes.len(), rep.passes.iter().map(|p| p.ldpc_attempts).sum())
            })
            .collect();
        let f: usize = per.iter().map(|v| v.0).sum();
        let attempts: usize = per.iter().map(|v| v.1).sum();
        all_slots += slots as u64;
        all_false += f as u64;
        let pj = json!({ "label": name, "slots": slots, "false_decodes": f, "ldpc_attempts": attempts,
            "upper95_per_slot": upper95(f as u64, slots as u64) });
        eprintln!(
            "{name:>60}: {f} false decodes in {slots} slots ({attempts} LDPC attempts), 95% upper bound {:.2e}/slot",
            upper95(f as u64, slots as u64)
        );
        points.push(pj);
    }
    json!({ "benchmark": "false", "title": "False decodes on slots containing no z-30 frame",
        "definition": "every decode is false: nothing was transmitted",
        "slots_per_point": slots, "points": points,
        "pooled": { "slots": all_slots, "false_decodes": all_false, "upper95_per_slot": upper95(all_false, all_slots),
            "bound": "exact one-sided Clopper-Pearson 95%" },
        "not_tested": "real recorded non-z-30 audio (speech, music, real FT8/RTTY, real QRN): no recordings exist yet" })
}

fn sic(trials: usize) -> Value {
    let mut points = Vec::new();
    let weak_snr = -18.0;
    let mut p = 0;
    for dpow in [3.0, 10.0, 20.0] {
        for df in [0.0, 5.0, 20.0, 50.0] {
            for ddt in [0.0, 0.4] {
                let res: Vec<(bool, bool, bool, usize, usize)> = (0..trials)
                    .into_par_iter()
                    .map_init(Receiver::new, |rx, i| {
                        use rand::Rng;
                        let mut r = rng(frame_seed(9, p, i));
                        let f = r.gen_range(300.0..2600.0 - df);
                        let dt = r.gen_range(-1.0..0.6);
                        let (ps, strong) = z30_channel::random_station(&mut r, f, dt, weak_snr + dpow);
                        let (pw, weak) = z30_channel::random_station(&mut r, f + df, dt + ddt, weak_snr);
                        let x = synthesize(&Band { stations: vec![strong, weak], noise: true, ..Default::default() }, &mut r);
                        let on = rx.decode_slot(&x, &RxConfig::default());
                        let off = rx.decode_slot(&x, &RxConfig { passes: 1, ..Default::default() });
                        let has = |rep: &SlotReport, pl: &[u8; 63]| rep.decodes.iter().any(|d| d.info[..63] == *pl);
                        let (_, f_on, _, de_on) = score(&on, &[ps, pw]);
                        let (_, f_off, _, _) = score(&off, &[ps, pw]);
                        (has(&on, &ps), has(&on, &pw), has(&off, &pw), f_on + f_off, de_on)
                    })
                    .collect();
                let weak_on = res.iter().filter(|v| v.1).count();
                let weak_off = res.iter().filter(|v| v.2).count();
                let b = res.iter().filter(|v| v.1 && !v.2).count();
                let c = res.iter().filter(|v| !v.1 && v.2).count();
                let pj = json!({
                    "label": format!("dP {dpow:+.0} dB, df {df:.0} Hz, dDT {ddt:.1} s"),
                    "param": { "power_difference_db": dpow, "frequency_separation_hz": df, "timing_separation_s": ddt, "weak_snr_db": weak_snr },
                    "trials": trials,
                    "strong_decoded_with_sic": res.iter().filter(|v| v.0).count(),
                    "weak_decoded_with_sic": weak_on, "weak_with_sic_wilson95": wilson(weak_on, trials),
                    "weak_decoded_without_sic": weak_off, "weak_without_sic_wilson95": wilson(weak_off, trials),
                    "discordant_sic_only": b, "discordant_single_pass_only": c, "mcnemar_exact_p": mcnemar_exact(b, c),
                    "false_decodes": res.iter().map(|v| v.3).sum::<usize>(),
                    "duplicates_emitted": res.iter().map(|v| v.4).sum::<usize>(),
                });
                eprintln!(
                    "SIC dP {dpow:+3.0} df {df:4.0} dDT {ddt:.1}: weak {weak_on}/{trials} with SIC, {weak_off}/{trials} without; discordant {b}:{c} p={:.2e}",
                    mcnemar_exact(b, c)
                );
                points.push(pj);
                p += 1;
            }
        }
    }
    json!({ "benchmark": "sic", "title": "Two-station collisions: the weaker station decoded with SIC (3 passes) and without (1 pass), paired on the same audio",
        "channel": "AWGN", "placement": "strong at tone 0 f (uniform), DT uniform -1.0..+0.6 s; weak at f + df, DT + dDT; random payloads and phases",
        "trials_per_cell": trials, "points": points,
        "note": "PassStats::suppression_db is the receiver's own fit-residual ratio, not physical suppression, and is not reported here" })
}

fn fading(frames: usize) -> Value {
    let mut points = Vec::new();
    let mut crossings = serde_json::Map::new();
    let mut p = 0;
    for (preset, snrs) in [
        ("good", &[-24.0, -22.0, -20.0, -18.0, -16.0, -14.0, -10.0][..]),
        ("moderate", &[-24.0, -22.0, -20.0, -18.0, -16.0, -14.0, -10.0][..]),
        ("poor", &[-24.0, -22.0, -20.0, -18.0, -16.0, -14.0, -10.0][..]),
        ("high-moderate", &[-20.0, -10.0, 0.0, 10.0][..]),
    ] {
        let w = Watterson::preset(preset).unwrap();
        let mut curve = Vec::new();
        for &snr in snrs {
            let v = run_point(10, p, frames, |r| {
                let (pl, mut st) = blind_station(r, snr, 1.4);
                st.fading = Some(w);
                (pl, st, None)
            });
            let pj = point_json(&format!("{preset} {snr:+.0} dB"), json!({"preset": preset, "snr_db": snr}), &v);
            eprintln!("{}", line(&pj));
            curve.push((snr, pj["decoded"].as_u64().unwrap() as usize, v.len()));
            points.push(pj);
            p += 1;
        }
        crossings.insert(
            preset.into(),
            json!({ "delay_ms": w.delay_ms, "doppler_hz": w.doppler_hz, "crossing_50pct_db": crossing(&curve, 50.0) }),
        );
    }
    json!({ "benchmark": "fading", "title": "ITU-R F.1487 two-path Watterson channels (average SNR)",
        "channel": "z30_channel::Watterson: two equal-power paths, complex Gaussian taps with a Gaussian Doppler spectrum (sigma = spread / 2), normalised to unit ENSEMBLE power (per-frame power varies as Rayleigh fading does; audit H-10)",
        "placement": "as awgn", "frames_per_point": frames, "points": points, "presets": crossings })
}

/// Entry point for suite benchmarks.
pub fn run(what: &str, frames: Option<usize>, out: Option<&Path>) -> Result<(), String> {
    let names: Vec<&str> = if what == "suite" {
        BENCHMARKS.to_vec()
    } else if BENCHMARKS.contains(&what) {
        vec![what]
    } else {
        return Err(format!("unknown benchmark \"{what}\" (perf, false-decodes, sweep, suite, {})", BENCHMARKS.join(", ")));
    };
    if env!("Z30_BUILD_COMMIT").ends_with("-dirty") {
        eprintln!("WARNING: this binary was built from a dirty tree; its results cannot be tied to a commit and are not publishable.");
    }
    let dir = out.map(Path::to_path_buf).unwrap_or_else(default_out);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for name in names {
        let started = now_utc();
        let t = Instant::now();
        eprintln!("== {name} ==");
        let mut v = match name {
            "awgn" => awgn(frames.unwrap_or(200)),
            "snr" => snr_accuracy(frames.unwrap_or(100)),
            "drift" => drift(frames.unwrap_or(200)),
            "timing" => timing(frames.unwrap_or(200)),
            "clock" => clock(frames.unwrap_or(200)),
            "impair" => impair(frames.unwrap_or(200)),
            "busy" => busy(frames.unwrap_or(50)),
            "false" => false_decodes(frames.unwrap_or(400)),
            "sic" => sic(frames.unwrap_or(100)),
            "fading" => fading(frames.unwrap_or(200)),
            _ => unreachable!(),
        };
        v["provenance"] = provenance(&started);
        v["provenance"]["elapsed_s"] = json!(t.elapsed().as_secs_f64());
        v["definitions"] = definitions();
        v["seed"] = json!({ "suite_seed": SUITE_SEED, "per_frame": "SUITE_SEED ^ (benchmark << 40) ^ (point << 20) ^ frame, ChaCha8 (z30_channel::rng)" });
        if frames.is_some_and(|f| f < 100) {
            v["exploratory"] = json!("fewer than 100 frames per point: exploratory, not publishable");
        }
        let path = dir.join(format!("{name}.json"));
        std::fs::write(&path, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        eprintln!("-> {} ({:.0} s)", path.display(), t.elapsed().as_secs_f64());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wilson_matches_a_known_value() {
        // 100/200: [43.1, 56.9] (the audit's E013 row).
        let (lo, hi) = wilson(100, 200);
        assert!((lo - 43.1).abs() < 0.05 && (hi - 56.9).abs() < 0.05, "{lo} {hi}");
        let (lo, hi) = wilson(200, 200);
        assert!((lo - 98.1).abs() < 0.05 && hi == 100.0);
    }

    #[test]
    fn mcnemar_matches_the_audit() {
        // 100:0 discordant -> 2^-99 = 1.578e-30 (audit E022).
        let p = mcnemar_exact(100, 0);
        assert!((p / 1.578e-30 - 1.0).abs() < 0.01, "{p:e}");
        assert_eq!(mcnemar_exact(0, 0), 1.0);
        assert!((mcnemar_exact(5, 5) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn crossing_interpolates_and_brackets() {
        let c = crossing(&[(-24.0, 20, 200), (-23.0, 100, 200), (-22.0, 180, 200)], 50.0).unwrap();
        assert!((c["at"].as_f64().unwrap() + 23.0).abs() < 1e-9);
        let lo = c["interval"][0].as_f64().unwrap();
        let hi = c["interval"][1].as_f64().unwrap();
        assert!(lo < -23.0 && hi > -23.0);
        assert!(crossing(&[(-24.0, 180, 200), (-23.0, 190, 200)], 50.0).is_none());
    }

    #[test]
    fn frame_seeds_do_not_collide_across_points_and_benchmarks() {
        let mut seen = std::collections::HashSet::new();
        for b in 1..=10u64 {
            for p in 0..40 {
                for i in 0..300 {
                    assert!(seen.insert(frame_seed(b, p, i)));
                }
            }
        }
    }
}
