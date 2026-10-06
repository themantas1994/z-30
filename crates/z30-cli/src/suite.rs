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
//!   code only; nothing here reads a previous result (it only checks, before writing, whether
//!   the file it would replace is a published one).
//! - Every result says what it is (`status`): `published`, `replicate`, `exploratory`, `dirty`
//!   or `not_the_published_run`, and only a clean, full-size, published-seed run goes to
//!   `research/results/<commit>/`. Nothing overwrites a published result (audit F-13, F-14).

use crate::bench::upper95;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use z30_channel::{rng, synthesize, Band, ChannelRng, Station, Watterson, FS, SLOT_ZERO_INDEX};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};
use z30_protocol::gfsk::Modulator;

/// Base seed of the suite: the project's published seed, 2026-08-30.
pub const SUITE_SEED: u64 = 20_260_830;

/// The base seed of this run: `replicate_seed(r)` for `--replicate r`, `SUITE_SEED` (= replicate
/// 0) otherwise. A replicate is for measuring the sampling variability of a published figure:
/// the same conditions on frames none of which any other replicate, or the published run, uses.
/// Its results record the seed and say they are not the published run. It changes only which
/// random frames the harness generates - never the receiver.
static RUN_SEED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(SUITE_SEED);

/// Base seed of replicate `r`: the published seed with `r` in bits 48-63.
///
/// `frame_seed` puts the frame index in bits 0-19, the point in 20-39 and the benchmark in
/// 40-47, all combined by XOR. The first version of `--seed` took the base seed from the user
/// directly, and small seeds (1..10) only flipped low bits of the frame index: seeds 1-7
/// regenerated exactly the published 200 frames per point in another order, and 8-10 nearly so.
/// Ten "independent" AWGN replicates were therefore the same measurement ten times (found by
/// their identical crossings; `tests::replicates_share_no_frame_with_each_other_or_the_published_run`
/// now fails on that). Bits 48-63 are used by nothing else, so every replicate is a different
/// set of ChaCha8 streams.
pub fn replicate_seed(r: u16) -> u64 {
    SUITE_SEED ^ ((r as u64) << 48)
}

fn run_seed() -> u64 {
    RUN_SEED.load(std::sync::atomic::Ordering::Relaxed)
}

const BENCHMARKS: [&str; 10] = ["awgn", "snr", "drift", "timing", "clock", "impair", "busy", "false", "sic", "fading"];

/// Frames per point behind any sensitivity crossing (`docs/benchmarking.md`, research-process
/// section 2). The suite used to mark a run exploratory only below 100, so a 150-frame AWGN
/// crossing was written unmarked (audit DOC-08 / RES-05 / F-32).
pub const CROSSING_MIN_FRAMES: usize = 200;

/// The size each benchmark is published at (frames per point; slots per point for `busy` and
/// `false`; trials per cell for `sic`), which is also its default. Below it a run is
/// exploratory. `awgn` and `fading` carry the crossings, so they are held to
/// `CROSSING_MIN_FRAMES`; `snr` (error statistics) and `sic` (paired McNemar per cell) are not
/// crossings and were published at 100.
pub fn publishable_size(name: &str) -> usize {
    match name {
        "awgn" | "fading" => CROSSING_MIN_FRAMES,
        "drift" | "timing" | "clock" | "impair" => 200,
        "snr" | "sic" => 100,
        "busy" => 50,
        "false" => 400,
        _ => usize::MAX,
    }
}

/// How `--benchmark` was asked to run.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub frames: Option<usize>,
    pub out: Option<PathBuf>,
    pub replicate: Option<u16>,
    pub per_frame: bool,
    pub overwrite: bool,
}

/// What a result file is. Only `Published` may live at `research/results/<commit>/<name>.json`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Clean build, published seed (replicate 0), at least the publishable size, written to
    /// `research/results/<commit>/`. Publication itself still needs the board (research-process
    /// section 4).
    Published,
    /// Clean, full size, replicate r >= 1: a different set of frames, for sampling variability.
    Replicate,
    /// Below the benchmark's publishable size.
    Exploratory,
    /// Built from a tree that is not its commit (or from no known commit).
    Dirty,
    /// Would be `Published`, but was written somewhere else (`--out`): a reproduction, not the
    /// record.
    NotThePublishedRun,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Published => "published",
            Status::Replicate => "replicate",
            Status::Exploratory => "exploratory",
            Status::Dirty => "dirty",
            Status::NotThePublishedRun => "not_the_published_run",
        }
    }
}

/// A binary whose label is `<commit>` (not `-dirty`, not `unknown`).
fn build_is_clean(label: &str) -> bool {
    !label.ends_with("-dirty") && label != "unknown"
}

/// The status a run has before its destination is considered. Dirty outranks everything: a
/// modified instrument or receiver makes the size and seed irrelevant.
pub fn intrinsic_status(clean: bool, frames: usize, publishable: usize, replicate: u16) -> Status {
    if !clean {
        Status::Dirty
    } else if frames < publishable {
        Status::Exploratory
    } else if replicate != 0 {
        Status::Replicate
    } else {
        Status::Published
    }
}

/// Where a run goes when `--out` is not given. Only a published run lands in
/// `research/results/<commit>/`; the others go to labelled places beside it, and the
/// `exploratory/` and `unpublished/` trees are git-ignored so they cannot be committed as if
/// they were the record.
pub fn default_dir(status: Status, label: &str, diff: &str, replicate: u16) -> PathBuf {
    let base = PathBuf::from("research").join("results");
    let rep = |p: PathBuf| if replicate == 0 { p } else { p.join("replicates").join(format!("r{replicate}")) };
    match status {
        Status::Published | Status::NotThePublishedRun => base.join(label),
        Status::Replicate => base.join(label).join("replicates").join(format!("r{replicate}")),
        Status::Exploratory => rep(base.join("exploratory").join(label)),
        Status::Dirty => rep(base.join("unpublished").join(format!("{label}-{}", if diff.is_empty() { "nodiff" } else { diff }))),
    }
}

/// A commit directory name as the suite writes it: 7-40 lowercase hex, optionally `-dirty`.
fn is_commit_dir(s: &str) -> bool {
    let h = s.strip_suffix("-dirty").unwrap_or(s);
    (7..=40).contains(&h.len()) && h.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// `dir` made absolute against the working directory and normalised lexically (`..` removed),
/// so `./research/../research/results/x` is recognised as what it is.
fn lexical_absolute(dir: &Path) -> PathBuf {
    let joined = if dir.is_absolute() { dir.to_path_buf() } else { std::env::current_dir().unwrap_or_default().join(dir) };
    let mut out = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// If `dir` is inside a published commit directory (`research/results/<commit>/...`): that
/// directory's name and the components below it.
pub fn published_tree(dir: &Path) -> Option<(String, Vec<String>)> {
    let abs = lexical_absolute(dir);
    let parts: Vec<String> = abs
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    (0..parts.len().saturating_sub(2))
        .find(|&i| parts[i] == "research" && parts[i + 1] == "results" && is_commit_dir(&parts[i + 2]))
        .map(|i| (parts[i + 2].clone(), parts[i + 3..].to_vec()))
}

/// Status and directory of one benchmark's result. `Err` when the destination is one this run
/// may not write to: a published commit directory accepts only that commit's own published
/// run at its top and its own replicate r in `replicates/r<r>/`.
pub fn destination(name: &str, frames: usize, opts: &Options, label: &str, diff: &str) -> Result<(Status, PathBuf), String> {
    let replicate = opts.replicate.unwrap_or(0);
    let intrinsic = intrinsic_status(build_is_clean(label), frames, publishable_size(name), replicate);
    let Some(dir) = &opts.out else {
        return Ok((intrinsic, default_dir(intrinsic, label, diff, replicate)));
    };
    if let Some((commit, below)) = published_tree(dir) {
        let allowed = match intrinsic {
            Status::Published => commit == label && below.is_empty(),
            Status::Replicate => commit == label && below == ["replicates".to_string(), format!("r{replicate}")],
            _ => false,
        };
        if !allowed {
            return Err(format!(
                "refusing to write a {} {name} result into {}: research/results/<commit>/ holds only that commit's published run and its replicates/r<N>/ (write elsewhere with --out, or omit --out for the labelled default)",
                intrinsic.as_str(),
                dir.display()
            ));
        }
        return Ok((intrinsic, dir.clone()));
    }
    let status = if intrinsic == Status::Published { Status::NotThePublishedRun } else { intrinsic };
    Ok((status, dir.clone()))
}

/// Whether an existing result file must be kept whatever the flags say: a published result
/// (by its `status`, or for files written before `status` existed, by having none of the
/// markers a non-published run carried), or anything that cannot be read as a result.
pub fn is_published_file(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else { return true };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return true };
    match v.get("status").and_then(Value::as_str) {
        Some(s) => s == "published",
        None => {
            v.get("exploratory").is_none()
                && v.get("not_the_published_run").is_none()
                && v["provenance"]["git_commit"].as_str().is_some_and(build_is_clean)
        }
    }
}

/// Refuses to replace a file that exists, unless `overwrite` is given and the file is neither a
/// published result nor anywhere inside a published commit directory. The first `--replicate`
/// wrote over the published `awgn.json` and nothing said so (audit RES-04 / F-14).
pub fn check_writable(path: &Path, overwrite: bool) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let json = path.extension().is_some_and(|e| e == "json");
    if published_tree(path.parent().unwrap_or(Path::new("."))).is_some() || (json && is_published_file(path)) {
        return Err(format!("refusing to overwrite {}: it is a published result or part of a published results directory", path.display()));
    }
    if !overwrite {
        return Err(format!("{} exists; pass --overwrite to replace it (it is not a published result)", path.display()));
    }
    Ok(())
}

// ------------------------------------------------------------------------------ per-frame log

/// Per-frame outcomes, collected only with `--per-frame`. Aggregates alone cannot be paired
/// between two commits: the discordant frames are lost (audit RES-01 / F-11). Each benchmark's
/// records are in point and frame order (rayon's `collect` keeps index order), so the file is
/// identical at any thread count.
static PER_FRAME: AtomicBool = AtomicBool::new(false);
static FRAMES: Mutex<Vec<Value>> = Mutex::new(Vec::new());

fn log_frame(record: Value) {
    if PER_FRAME.load(Ordering::Relaxed) {
        FRAMES.lock().unwrap_or_else(|e| e.into_inner()).push(record);
    }
}

fn take_frames() -> Vec<Value> {
    std::mem::take(&mut *FRAMES.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Records every single-station frame of point `p`. `x` is the value along the benchmark's rate
/// curve (SNR in dB) where the benchmark has one; `curve` names the curve (fading preset).
fn log_point(bench: &str, id: u64, p: usize, condition: &str, x: Option<f64>, curve: Option<&str>, v: &[Outcome]) {
    if !PER_FRAME.load(Ordering::Relaxed) {
        return;
    }
    for (i, o) in v.iter().enumerate() {
        log_frame(json!({ "kind": "frame", "benchmark": bench, "point": p, "frame": i, "seed": frame_seed(id, p, i),
            "condition": condition, "x": x, "curve": curve,
            "decoded": o.decoded_any, "correct": o.ok, "false_decodes": o.false_decodes }));
    }
}

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
        "git_dirty": !build_is_clean(env!("Z30_BUILD_COMMIT")),
        "git_diff_sha256": Some(env!("Z30_BUILD_DIRTY_DIFF_SHA256")).filter(|s| !s.is_empty()),
        "rustflags": env!("Z30_BUILD_RUSTFLAGS"),
        "target_features_compiled": env!("Z30_BUILD_TARGET_FEATURES").split(',').filter(|s| !s.is_empty()).collect::<Vec<_>>(),
        "isa_features_detected": isa_features(),
        "cargo_lock_sha256": env!("Z30_BUILD_CARGO_LOCK_SHA256"),
        "instrument": instrument(),
    })
}

/// The identity of the measuring instrument, as built: a candidate branch compiles its own
/// harness, channel and modulator, and without this nothing in its result names which one it
/// used (audit RES-02 / F-12). Two results are comparable only if these agree.
pub fn instrument() -> Value {
    let files: serde_json::Map<String, Value> =
        env!("Z30_BUILD_INSTRUMENT_FILES").split(';').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (k.to_string(), json!(v))).collect();
    json!({
        "sha256": env!("Z30_BUILD_INSTRUMENT_SHA256"),
        "definition": "sha256 over the LF-normalised sha256 of each file below (path=hash, one per line) and the resolved external dependencies of z30-channel from Cargo.lock; computed by the build script from the tree the binary was compiled from",
        "files": files,
        "channel_dependencies": env!("Z30_BUILD_INSTRUMENT_LOCK").split(',').filter(|s| !s.is_empty()).collect::<Vec<_>>(),
    })
}

/// The instruction-set features this machine offers, detected at run time. rustfft chooses
/// its SIMD kernels from these, which can change floating-point rounding and so, near a
/// threshold, which frames decode (audit RES-09 / F-37); exact reproduction is claimed only
/// between machines that agree here.
fn isa_features() -> Value {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        macro_rules! detect {
            ($($f:tt),*) => { json!({ $($f: std::arch::is_x86_feature_detected!($f)),* }) };
        }
        detect!("sse2", "sse3", "ssse3", "sse4.1", "sse4.2", "popcnt", "avx", "avx2", "fma", "bmi2", "avx512f")
    }
    #[cfg(target_arch = "aarch64")]
    {
        macro_rules! detect {
            ($($f:tt),*) => { json!({ $($f: std::arch::is_aarch64_feature_detected!($f)),* }) };
        }
        detect!("neon", "fp16", "sve")
    }
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64", target_arch = "aarch64")))]
    {
        json!("not detected on this architecture")
    }
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

fn now_utc() -> String {
    let t = z30_io::wallclock::system_utc();
    let (d, tm) = z30_io::logbook::utc_parts(t);
    format!("{}-{}-{}T{}:{}:{}Z", &d[..4], &d[4..6], &d[6..], &tm[..2], &tm[2..4], &tm[4..])
}

// ------------------------------------------------------------------------------ trials

/// What happened to one single-station slot.
#[derive(Clone, Debug, Default)]
struct Outcome {
    ok: bool,
    /// The receiver emitted at least one decode (right or wrong).
    decoded_any: bool,
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
    let f0 = r.random_range(210.0..2740.0);
    let dt = if dt_max > 0.0 { r.random_range(-dt_max..dt_max) } else { 0.0 };
    z30_channel::random_station(r, f0, dt, snr)
}

/// Seed of frame `i` of point `p` of a benchmark.
fn frame_seed(bench: u64, p: usize, i: usize) -> u64 {
    run_seed() ^ (bench << 40) ^ ((p as u64) << 20) ^ i as u64
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
                decoded_any: !rep.decodes.is_empty(),
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
        log_point("awgn", 1, p, pj["label"].as_str().unwrap_or(""), Some(snr), None, &v);
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
        log_point("snr", 2, p, pj["label"].as_str().unwrap_or(""), Some(snr), None, &v);
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
            log_point("drift", 3, p, pj["label"].as_str().unwrap_or(""), None, None, &v);
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
        log_point("timing", 4, p, pj["label"].as_str().unwrap_or(""), None, None, &v);
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
                    decoded_any: !rep.decodes.is_empty(),
                    false_decodes,
                    dups_dropped,
                    dups_emitted,
                    ms: t.elapsed().as_secs_f64() * 1e3,
                    ..Default::default()
                }
            })
            .collect();
        let pj = point_json(&format!("clock {ppm:+.0} ppm @ -20 dB"), json!(ppm), &v);
        log_point("clock", 5, p, pj["label"].as_str().unwrap_or(""), None, None, &v);
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
                        let at = r.random_range(0..x.len());
                        let sign = if r.random_bool(0.5) { 1.0 } else { -1.0 };
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
        log_point("impair", 6, p, pj["label"].as_str().unwrap_or(""), None, None, &v);
        eprintln!("{}", line(&pj));
        points.push(pj);
    }
    json!({ "benchmark": "impair", "title": "Audio impairments applied to the 6 kHz slot after noise (i.e. after resampling, not at the device rate)",
        "channel": "AWGN, -20 dB", "placement": "as awgn", "frames_per_point": frames, "points": points })
}

/// One busy-band slot: stations found, stations sent, false decodes, duplicates dropped and
/// emitted, decode ms, and which stations were found (for the per-frame record).
type BusySlot = (usize, usize, usize, usize, usize, f64, Vec<bool>);

fn busy(slots: usize) -> Value {
    use rand::Rng;
    let mut points = Vec::new();
    let configs: [(usize, f64, f64); 5] = [(5, -20.0, 0.0), (10, -20.0, 0.0), (20, -20.0, 0.0), (40, -20.0, 0.0), (20, -22.0, -16.0)];
    for (p, &(k, lo, hi)) in configs.iter().enumerate() {
        let per_slot: Vec<BusySlot> = (0..slots)
            .into_par_iter()
            .map_init(Receiver::new, |rx, i| {
                let mut r = rng(frame_seed(7, p, i));
                let mut stations = Vec::new();
                let mut payloads = Vec::new();
                for _ in 0..k {
                    let snr = r.random_range(lo..hi);
                    let (pl, st) = blind_station(&mut r, snr, 1.4);
                    stations.push(st);
                    payloads.push(pl);
                }
                let x = synthesize(&Band { stations, noise: true, ..Default::default() }, &mut r);
                let t = Instant::now();
                let rep = rx.decode_slot(&x, &RxConfig::default());
                let ms = t.elapsed().as_secs_f64() * 1e3;
                let (found, f, dd, de) = score(&rep, &payloads);
                let hits = payloads.iter().map(|pl| rep.decodes.iter().any(|d| d.info[..63] == *pl)).collect();
                (found, k, f, dd, de, ms, hits)
            })
            .collect();
        let label = format!("K = {k}, {lo:+.0}..{hi:+.0} dB");
        for (i, s) in per_slot.iter().enumerate() {
            // One record per station: the pairing unit is (slot, station).
            for (j, hit) in s.6.iter().enumerate() {
                log_frame(json!({ "kind": "frame", "benchmark": "busy", "point": p, "frame": i, "station": j,
                    "seed": frame_seed(7, p, i), "condition": label, "x": null, "curve": null,
                    "decoded": *hit, "correct": *hit, "slot_false_decodes": s.2 }));
            }
        }
        let found: usize = per_slot.iter().map(|s| s.0).sum();
        let total: usize = per_slot.iter().map(|s| s.1).sum();
        let (wl, wh) = wilson(found, total);
        let ms: Vec<f64> = per_slot.iter().map(|s| s.5).collect();
        let pj = json!({
            "label": label,
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
        // 8 random 16-FSK signals, 3.125 Hz spacing, 0.32 s symbols, NO Costas pattern, each at
        // -3 dB: `amp_for(0.0)` is the amplitude of a 0 dB real sinusoid, and the extra 1/sqrt 2
        // on the unit-amplitude real part halves the power. It was labelled 0 dB until the
        // 2026-09-28 audit (DSP-07 / F-53); the signal is unchanged, so the published counts stay
        // reproducible, and the label now says what was run.
        1 => {
            let m = Modulator::new(FS).unwrap();
            for _ in 0..8 {
                let mut sym = [0u8; 75];
                sym.iter_mut().for_each(|s| *s = r.random_range(0..16));
                let (re, _) = m.analytic(&sym, r.random_range(210.0..2740.0), 0.0, 0.0);
                let start = r.random_range(0..n - re.len());
                let a = amp_for(0.0) as f32 / 2f32.sqrt();
                for (i, v) in re.iter().enumerate() {
                    x[start + i] += a * *v as f32;
                }
            }
        }
        // 8 FT8-like 8-FSK signals: 6.25 Hz spacing, 0.16 s symbols, 79 symbols, continuous phase, 0 dB.
        2 => {
            for _ in 0..8 {
                let f0 = r.random_range(210.0..2740.0);
                let start = r.random_range(0..n - 79 * 960);
                let a = amp_for(0.0) as f32;
                let mut ph = r.random_range(0.0..std::f64::consts::TAU);
                for s in 0..79 {
                    let f = f0 + 6.25 * r.random_range(0..8) as f64;
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
                let at = r.random_range(0..n);
                let a = r.random_range(-40.0f32..40.0);
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

/// What a false-decode count can and cannot exclude (audit RES-07 / F-36). A zero count is
/// reported as its one-sided 95% upper bound, never as "none".
pub fn power_note(false_decodes: u64, slots: u64) -> Value {
    let bound = upper95(false_decodes, slots);
    // Slots needed to bound a rate r with zero events: n >= ln(0.05) / ln(1 - r).
    let needed = |r: f64| ((0.05f64).ln() / (-r).ln_1p()).ceil() as u64;
    json!({
        "upper95_per_slot": bound,
        "per_day_at_upper95": bound * 2880.0,
        "p_zero_if_true_rate_is_upper95_over_3": (-(slots as f64) * bound / 3.0).exp(),
        "slots_for_zero_to_bound_1e-4_per_slot": needed(1e-4),
        "slots_for_zero_to_bound_1e-5_per_slot": needed(1e-5),
        "note": format!(
            "{false_decodes} false decodes in {slots} slots bounds the per-slot rate below {bound:.2e} (95%, one-sided), i.e. {:.1} per day of continuous monitoring (2880 slots). A true rate a third of that bound still gives zero in {slots} slots with probability {:.0}%, so this run cannot tell such a receiver from a perfect one; a change that affects acceptance needs its own, larger, pre-registered false-decode run",
            bound * 2880.0,
            100.0 * (-(slots as f64) * bound / 3.0).exp()
        ),
    })
}

fn false_decodes(slots: usize) -> Value {
    let kinds: [(&str, usize); 5] = [
        ("white noise only", 0),
        ("20 CW carriers, -10..+20 dB", 4),
        ("8 random 16-FSK signals without the Costas pattern, -3 dB each", 1),
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
                let cw = if kind == 4 {
                    (0..20).map(|_| (r.random_range(200.0..2800.0), r.random_range(-10.0..20.0))).collect()
                } else {
                    vec![]
                };
                let mut x = synthesize(&Band { cw, noise: true, ..Default::default() }, &mut r);
                interference(kind, &mut r, &mut x);
                let rep = rx.decode_slot(&x, &RxConfig::default());
                (rep.decodes.len(), rep.passes.iter().map(|p| p.ldpc_attempts).sum())
            })
            .collect();
        for (i, v) in per.iter().enumerate() {
            // Every decode is false here, so "correct" means the slot stayed silent.
            log_frame(json!({ "kind": "frame", "benchmark": "false", "point": p, "frame": i, "seed": frame_seed(8, p, i),
                "condition": name, "x": null, "curve": null, "decoded": v.0 > 0, "correct": v.0 == 0, "false_decodes": v.0 }));
        }
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
        "interferer_levels": "SNR per interferer in 2500 Hz as for a z-30 frame: CW carriers uniform -10..+20 dB; random 16-FSK -3 dB each (labelled 0 dB before 2026-09-28, audit DSP-07: the signal was always -3 dB); FT8-like 0 dB each; impulses up to 40 sigma",
        "power": power_note(all_false, all_slots),
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
                        let f = r.random_range(300.0..2600.0 - df);
                        let dt = r.random_range(-1.0..0.6);
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
                let label = format!("dP {dpow:+.0} dB, df {df:.0} Hz, dDT {ddt:.1} s");
                for (i, v) in res.iter().enumerate() {
                    // "correct" is the weak station with SIC (the production configuration); the
                    // single-pass arm and the strong station ride along for pairing.
                    log_frame(json!({ "kind": "frame", "benchmark": "sic", "point": p, "frame": i, "seed": frame_seed(9, p, i),
                        "condition": label, "x": null, "curve": null, "decoded": v.0 || v.1, "correct": v.1,
                        "weak_without_sic": v.2, "strong_with_sic": v.0, "false_decodes": v.3 }));
                }
                let weak_on = res.iter().filter(|v| v.1).count();
                let weak_off = res.iter().filter(|v| v.2).count();
                let b = res.iter().filter(|v| v.1 && !v.2).count();
                let c = res.iter().filter(|v| !v.1 && v.2).count();
                let pj = json!({
                    "label": label,
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
            log_point("fading", 10, p, pj["label"].as_str().unwrap_or(""), Some(snr), Some(preset), &v);
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
        "channel": "z30_channel::Watterson: two independent equal-power paths separated by delay_ms; each tap a complex Gaussian process whose Doppler POWER spectrum is Gaussian with standard deviation sigma_D = doppler_hz / 2 (doppler_hz is the ITU-R F.1487 2-sigma spread; tap autocorrelation exp(-2 pi^2 sigma_D^2 tau^2)), generated by shaping white noise with the amplitude response exp(-f^2 / (4 sigma_D^2)); normalised to unit ENSEMBLE power (per-frame power varies as the fading does; audit H-10)",
        "doppler_definition": "doppler_hz = 2 sigma_D, sigma_D the standard deviation of the tap's Gaussian Doppler power spectral density (two-sided, centred on 0 Hz)",
        "doppler_fix": "Before 2026-09-24 (post-remediation audit N-01) the amplitude response was exp(-f^2 / (2 sigma_D^2)), so the simulated spread was doppler_hz / sqrt 2; results from that model are withdrawn",
        "placement": "as awgn", "frames_per_point": frames, "points": points, "presets": crossings })
}

/// Entry point for suite benchmarks.
pub fn run(what: &str, opts: &Options) -> Result<(), String> {
    let replicate = opts.replicate.unwrap_or(0);
    RUN_SEED.store(replicate_seed(replicate), std::sync::atomic::Ordering::Relaxed);
    PER_FRAME.store(opts.per_frame, Ordering::Relaxed);
    let names: Vec<&str> = if what == "suite" {
        BENCHMARKS.to_vec()
    } else if BENCHMARKS.contains(&what) {
        vec![what]
    } else {
        return Err(format!("unknown benchmark \"{what}\" (perf, false-decodes, sweep, suite, {})", BENCHMARKS.join(", ")));
    };
    // frame_seed keeps the frame index in bits 0-19: past 2^20 frames, frame 2^20 + i of point
    // p would reuse frame i of point p ^ 1 (audit RES-14).
    if opts.frames.is_some_and(|f| f >= 1 << 20) {
        return Err("--frames must be below 1048576 (the frame index has 20 bits in the seed)".into());
    }
    let label = env!("Z30_BUILD_COMMIT");
    let diff = env!("Z30_BUILD_DIRTY_DIFF_SHA256");
    if !build_is_clean(label) {
        eprintln!(
            "WARNING: this binary was built from a dirty tree ({label}); its results cannot be tied to a commit and are not publishable."
        );
    }
    // Every destination is decided and checked before the first frame is decoded: an hour of
    // compute must not end in a refusal, and a refusal must not come after a partial write.
    let mut plan = Vec::new();
    for &name in &names {
        let frames = opts.frames.unwrap_or(publishable_size(name));
        let (status, dir) = destination(name, frames, opts, label, diff)?;
        check_writable(&dir.join(format!("{name}.json")), opts.overwrite)?;
        if opts.per_frame {
            check_writable(&dir.join(format!("{name}.frames.jsonl")), opts.overwrite)?;
        }
        plan.push((name, frames, status, dir));
    }
    for (name, frames, status, dir) in plan {
        std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let started = now_utc();
        let t = Instant::now();
        eprintln!("== {name} ({}) ==", status.as_str());
        take_frames();
        let mut v = match name {
            "awgn" => awgn(frames),
            "snr" => snr_accuracy(frames),
            "drift" => drift(frames),
            "timing" => timing(frames),
            "clock" => clock(frames),
            "impair" => impair(frames),
            "busy" => busy(frames),
            "false" => false_decodes(frames),
            "sic" => sic(frames),
            "fading" => fading(frames),
            _ => unreachable!(),
        };
        v["provenance"] = provenance(&started);
        v["provenance"]["elapsed_s"] = json!(t.elapsed().as_secs_f64());
        v["definitions"] = definitions();
        v["seed"] = json!({ "suite_seed": run_seed(), "published_seed": run_seed() == SUITE_SEED,
            "replicate": replicate,
            "per_frame": "suite_seed ^ (benchmark << 40) ^ (point << 20) ^ frame, ChaCha8 (z30_channel::rng); replicate r: suite_seed = 20260830 ^ (r << 48)" });
        let reasons = status_reasons(status, frames, publishable_size(name), replicate);
        v["status"] = json!(status.as_str());
        v["status_reasons"] = json!(reasons);
        v["publishable_size"] = json!(publishable_size(name));
        v["frames_policy"] = json!(format!(
            "a sensitivity crossing needs at least {CROSSING_MIN_FRAMES} frames per point (docs/benchmarking.md); a benchmark below its publishable size is exploratory"
        ));
        if run_seed() != SUITE_SEED {
            v["not_the_published_run"] = json!(format!(
                "replicate {replicate} (suite seed {}), not the published seed {SUITE_SEED}: for measuring sampling variability",
                run_seed()
            ));
        } else if status != Status::Published {
            v["not_the_published_run"] = json!(format!("status {}: {}", status.as_str(), reasons.join("; ")));
        }
        if status == Status::Exploratory {
            v["exploratory"] = json!(format!(
                "fewer than {} per point (this benchmark's publishable size): exploratory, not publishable",
                publishable_size(name)
            ));
        }
        let path = dir.join(format!("{name}.json"));
        if opts.per_frame {
            let fpath = dir.join(format!("{name}.frames.jsonl"));
            let header = json!({ "kind": "header", "benchmark": name, "status": status.as_str(),
                "git_commit": label, "instrument_sha256": env!("Z30_BUILD_INSTRUMENT_SHA256"),
                "suite_seed": run_seed(), "replicate": replicate, "frames_per_point": frames,
                "result_file": format!("{name}.json"),
                "fields": "point, frame (index within the point), station (busy only), seed (the frame's generator seed), condition (the point's label), x (value along the rate curve, where there is one), curve (fading preset), decoded (any decode), correct (the benchmark's success criterion; for false: no decode)" });
            let mut text = serde_json::to_string(&header).map_err(|e| e.to_string())?;
            text.push('\n');
            for r in take_frames() {
                text.push_str(&serde_json::to_string(&r).map_err(|e| e.to_string())?);
                text.push('\n');
            }
            std::fs::write(&fpath, text).map_err(|e| format!("{}: {e}", fpath.display()))?;
            v["per_frame_file"] = json!(format!("{name}.frames.jsonl"));
            eprintln!("-> {}", fpath.display());
        }
        std::fs::write(&path, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        eprintln!("-> {} ({}, {:.0} s)", path.display(), status.as_str(), t.elapsed().as_secs_f64());
    }
    Ok(())
}

/// Why a result has the status it has, in words a reader of the JSON can check.
fn status_reasons(status: Status, frames: usize, publishable: usize, replicate: u16) -> Vec<String> {
    let mut r = Vec::new();
    if !build_is_clean(env!("Z30_BUILD_COMMIT")) {
        r.push(format!("built from a tree that is not its commit ({})", env!("Z30_BUILD_COMMIT")));
    }
    if frames < publishable {
        r.push(format!("{frames} per point, below the publishable {publishable}"));
    }
    if replicate != 0 {
        r.push(format!("replicate {replicate}, not the published seed"));
    }
    if status == Status::NotThePublishedRun {
        r.push("written outside research/results/<commit>/ (--out)".into());
    }
    if r.is_empty() {
        r.push("clean build, published seed, publishable size, research/results/<commit>/".into());
    }
    r
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
    fn replicates_share_no_frame_with_each_other_or_the_published_run() {
        // Every benchmark, point and frame index the suite uses, for the published run and 20
        // replicates: no frame seed may repeat. The first `--seed` failed this (seed 1 gave the
        // published frames permuted).
        let mut seen = std::collections::HashSet::new();
        for r in 0..=20u16 {
            let base = replicate_seed(r);
            for b in 1..=10u64 {
                for p in 0..40usize {
                    for i in 0..400usize {
                        assert!(seen.insert(base ^ (b << 40) ^ ((p as u64) << 20) ^ i as u64), "replicate {r} reuses a frame");
                    }
                }
            }
        }
        assert_eq!(replicate_seed(0), SUITE_SEED, "replicate 0 is the published run");
    }

    fn opts(out: Option<&str>, replicate: u16) -> Options {
        Options { out: out.map(PathBuf::from), replicate: Some(replicate), ..Default::default() }
    }

    #[test]
    fn a_crossing_below_200_frames_per_point_is_exploratory() {
        // F-32: the suite used to mark only runs below 100 frames; 150 wrote an unmarked crossing.
        assert_eq!(publishable_size("awgn"), 200);
        assert_eq!(publishable_size("fading"), 200);
        assert_eq!(intrinsic_status(true, 150, publishable_size("awgn"), 0), Status::Exploratory);
        assert_eq!(intrinsic_status(true, 199, publishable_size("fading"), 0), Status::Exploratory);
        assert_eq!(intrinsic_status(true, 200, publishable_size("awgn"), 0), Status::Published);
        // Every benchmark's default is its publishable size, so a default run is never exploratory.
        for b in BENCHMARKS {
            assert!(publishable_size(b) < usize::MAX, "{b}");
            assert_eq!(intrinsic_status(true, publishable_size(b), publishable_size(b), 0), Status::Published, "{b}");
        }
    }

    #[test]
    fn a_dirty_build_never_gets_the_published_directory() {
        // F-13: a dirty build is `dirty` whatever its size or seed, and its default destination is
        // outside research/results/<commit>/.
        let (s, dir) = destination("awgn", 200, &opts(None, 0), "0123456789ab-dirty", "abcdef012345").unwrap();
        assert_eq!(s, Status::Dirty);
        assert_eq!(dir, PathBuf::from("research/results/unpublished/0123456789ab-dirty-abcdef012345"));
        assert!(published_tree(&dir).is_none());
        let (s, _) = destination("awgn", 200, &opts(None, 0), "unknown", "").unwrap();
        assert_eq!(s, Status::Dirty, "a binary that cannot name its commit is not publishable");
        // Pointing --out at the published directory, of this commit or the clean one, is refused.
        for out in ["research/results/0123456789ab", "research/results/0123456789ab-dirty", "x/research/results/0123456789ab/replicates/r1"]
        {
            assert!(destination("awgn", 200, &opts(Some(out), 0), "0123456789ab-dirty", "d").is_err(), "{out}");
        }
    }

    #[test]
    fn replicates_and_exploratory_runs_are_routed_away_from_the_published_file() {
        // F-14: `--replicate 1` used to write research/results/<commit>/awgn.json.
        let c = "0123456789ab";
        let (s, dir) = destination("awgn", 200, &opts(None, 3), c, "").unwrap();
        assert_eq!((s, dir), (Status::Replicate, PathBuf::from("research/results/0123456789ab/replicates/r3")));
        let (s, dir) = destination("awgn", 20, &opts(None, 0), c, "").unwrap();
        assert_eq!((s, dir), (Status::Exploratory, PathBuf::from("research/results/exploratory/0123456789ab")));
        let (s, dir) = destination("awgn", 20, &opts(None, 2), c, "").unwrap();
        assert_eq!((s, dir), (Status::Exploratory, PathBuf::from("research/results/exploratory/0123456789ab/replicates/r2")));
        let (s, dir) = destination("awgn", 200, &opts(None, 0), c, "").unwrap();
        assert_eq!((s, dir), (Status::Published, PathBuf::from("research/results/0123456789ab")));
        // Explicit --out: the published directory takes only what the default would put there.
        assert!(destination("awgn", 200, &opts(Some("research/results/0123456789ab"), 1), c, "").is_err());
        assert!(destination("awgn", 20, &opts(Some("research/results/0123456789ab"), 0), c, "").is_err());
        assert!(destination("awgn", 200, &opts(Some("research/results/fedcba987654"), 0), c, "").is_err(), "another commit's directory");
        assert!(destination("awgn", 200, &opts(Some("research/results/0123456789ab/replicates/r2"), 1), c, "").is_err());
        assert_eq!(
            destination("awgn", 200, &opts(Some("research/results/0123456789ab/replicates/r1"), 1), c, "").unwrap().0,
            Status::Replicate
        );
        assert_eq!(destination("awgn", 200, &opts(Some("./research/x/../results/0123456789ab"), 0), c, "").unwrap().0, Status::Published);
        // Elsewhere, a would-be published run says it is not the published run.
        assert_eq!(destination("awgn", 200, &opts(Some("/tmp/qa"), 0), c, "").unwrap().0, Status::NotThePublishedRun);
    }

    #[test]
    fn nothing_overwrites_a_published_result() {
        let root = std::env::temp_dir().join(format!("z30-suite-overwrite-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let scratch = root.join("scratch");
        let published = root.join("research/results/0123456789ab");
        std::fs::create_dir_all(&scratch).unwrap();
        std::fs::create_dir_all(&published).unwrap();
        let write = |p: &Path, v: Value| std::fs::write(p, serde_json::to_string(&v).unwrap()).unwrap();
        let clean = json!({ "provenance": { "git_commit": "0123456789ab" } });

        // A missing file is always writable.
        assert!(check_writable(&scratch.join("awgn.json"), false).is_ok());
        // An existing non-published file needs --overwrite.
        write(&scratch.join("awgn.json"), json!({ "status": "exploratory", "provenance": { "git_commit": "0123456789ab" } }));
        assert!(check_writable(&scratch.join("awgn.json"), false).is_err());
        assert!(check_writable(&scratch.join("awgn.json"), true).is_ok());
        // A published file - by status, or by the old schema's lack of markers - never.
        write(&scratch.join("snr.json"), json!({ "status": "published" }));
        write(&scratch.join("drift.json"), clean.clone());
        std::fs::write(scratch.join("junk.json"), "not json").unwrap();
        for f in ["snr.json", "drift.json", "junk.json"] {
            assert!(check_writable(&scratch.join(f), true).is_err(), "{f}");
        }
        // Old-schema non-published files are recognised by their markers.
        write(
            &scratch.join("timing.json"),
            json!({ "not_the_published_run": "replicate 1", "provenance": { "git_commit": "0123456789ab" } }),
        );
        write(&scratch.join("clock.json"), json!({ "provenance": { "git_commit": "0123456789ab-dirty" } }));
        assert!(check_writable(&scratch.join("timing.json"), true).is_ok());
        assert!(check_writable(&scratch.join("clock.json"), true).is_ok());
        // Nothing inside a published commit directory is replaced, whatever it says it is.
        write(&published.join("awgn.json"), json!({ "status": "exploratory" }));
        std::fs::write(published.join("awgn.frames.jsonl"), "{}\n").unwrap();
        assert!(check_writable(&published.join("awgn.json"), true).is_err());
        assert!(check_writable(&published.join("awgn.frames.jsonl"), true).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_false_decode_labels_state_the_levels_that_were_run() {
        // DSP-07 / F-53: the random 16-FSK interferers are -3 dB (amp_for(0) / sqrt 2 on a unit
        // cosine). Check the arithmetic the label now states, not only the label.
        let m = Modulator::new(FS).unwrap();
        let sym = [5u8; 75];
        let (re, _) = m.analytic(&sym, 1000.0, 0.0, 0.0);
        let amp = (2.0 * 5000.0 / FS).sqrt() / 2f64.sqrt();
        let mid = &re[re.len() / 4..3 * re.len() / 4];
        let power = mid.iter().map(|v| (amp * *v).powi(2)).sum::<f64>() / mid.len() as f64;
        let snr_db = 10.0 * (power / (5000.0 / FS)).log10();
        assert!((snr_db + 3.01).abs() < 0.05, "{snr_db}");
        let v = false_decodes(0);
        let labels: Vec<&str> = v["points"].as_array().unwrap().iter().map(|p| p["label"].as_str().unwrap()).collect();
        assert!(labels.iter().any(|l| l.contains("16-FSK") && l.contains("-3 dB")), "{labels:?}");
        assert!(!labels.iter().any(|l| l.contains("16-FSK") && l.contains(" 0 dB")), "{labels:?}");
    }

    #[test]
    fn a_zero_false_decode_count_reports_its_bound_and_what_it_cannot_exclude() {
        let n = power_note(0, 2000);
        let b = n["upper95_per_slot"].as_f64().unwrap();
        assert!((b - 1.4967e-3).abs() < 1e-6, "{b}");
        // A receiver three times better than the bound still shows zero in 2000 slots ~37% of the time.
        assert!((n["p_zero_if_true_rate_is_upper95_over_3"].as_f64().unwrap() - 0.368).abs() < 0.01);
        assert_eq!(n["slots_for_zero_to_bound_1e-4_per_slot"].as_u64().unwrap(), 29_956);
        assert!(!n["note"].as_str().unwrap().contains("none"));
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
