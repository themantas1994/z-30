//! `z30 --benchmark`: measured, never projected (directive section 33).
//!
//! - `perf`: `decode_slot` on seeded bands of K = 1, 5, 20 and 50 stations - latency p50, p95,
//!   p99 and max; throughput; process CPU time; heap allocations per slot - on all cores and on
//!   one.
//! - `false-decodes`: noise-only slots with the fine-sync gate disabled, so every candidate
//!   reaches the LDPC decoder: false accepts per LDPC attempt with an exact 95% upper bound.
//!   Also the production configuration's rate on the same slots.
//! - `sweep`: a quick Rust-native AWGN sensitivity sweep on `z30-channel` bands (exploratory; the
//!   published figures come from `research/paired_receiver.py`).

use std::time::Instant;
use z30_channel::{random_station, rng, synthesize, Band};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};

/// Process CPU seconds (user + system), where the platform can say.
fn cpu_seconds() -> Option<f64> {
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
        let after = stat.rsplit(')').next()?;
        let f: Vec<&str> = after.split_whitespace().collect();
        let ticks = f.get(11)?.parse::<f64>().ok()? + f.get(12)?.parse::<f64>().ok()?;
        Some(ticks / 100.0)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn pct(v: &mut [f64], q: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((q * v.len() as f64).ceil() as usize).clamp(1, v.len()) - 1]
}

fn band(k: usize, seed: u64) -> (Band, Vec<[u8; 63]>) {
    let mut r = rng(seed);
    let mut stations = Vec::new();
    let mut payloads = Vec::new();
    for j in 0..k {
        let f0 = 220.0 + j as f64 * (2500.0 / k.max(1) as f64);
        let snr = -20.0 + ((j * 7 + seed as usize) % 21) as f64;
        let dt = -1.2 + ((j as f64 * 0.37 + seed as f64 * 0.11) % 2.4);
        let (p, st) = random_station(&mut r, f0, dt, snr);
        stations.push(st);
        payloads.push(p);
    }
    (Band { stations, noise: true, ..Default::default() }, payloads)
}

fn perf(frames: usize) -> Result<(), String> {
    let rx = Receiver::new();
    let one = rayon::ThreadPoolBuilder::new().num_threads(1).build().map_err(|e| e.to_string())?;
    let cores = rayon::current_num_threads();
    println!("decode_slot performance, {frames} slots per K, seeded bands (-20..0 dB, 200-2750 Hz), {cores} threads vs 1");
    println!(
        "{:>3} {:>8} | {:>8} {:>8} {:>8} {:>8} | {:>8} {:>8} | {:>9} {:>11} {:>9}",
        "K", "threads", "p50 ms", "p95 ms", "p99 ms", "max ms", "slots/s", "cpu s/sl", "alloc/sl", "decoded", "found"
    );
    for &k in &[1usize, 5, 20, 50] {
        let slots: Vec<(Vec<f32>, Vec<[u8; 63]>)> = (0..frames)
            .map(|i| {
                let (b, p) = band(k, 1000 * k as u64 + i as u64);
                (synthesize(&b, &mut rng(7 + i as u64)), p)
            })
            .collect();
        for threads in [cores, 1] {
            let mut lat = Vec::new();
            let (mut found, mut total, mut decoded) = (0usize, 0usize, 0usize);
            let cpu0 = cpu_seconds();
            let a0 = crate::allocations();
            let t0 = Instant::now();
            for (x, payloads) in &slots {
                let t = Instant::now();
                let rep: SlotReport = if threads == 1 {
                    one.install(|| rx.decode_slot(x, &RxConfig::default()))
                } else {
                    rx.decode_slot(x, &RxConfig::default())
                };
                lat.push(t.elapsed().as_secs_f64() * 1e3);
                decoded += rep.decodes.len();
                total += payloads.len();
                found += payloads.iter().filter(|p| rep.decodes.iter().any(|d| &d.info[..63] == *p)).count();
            }
            let wall = t0.elapsed().as_secs_f64();
            let allocs = (crate::allocations() - a0) as f64 / frames as f64;
            let cpu =
                cpu_seconds().zip(cpu0).map(|(b, a)| format!("{:>8.2}", (b - a) / frames as f64)).unwrap_or_else(|| "     n/a".into());
            println!(
                "{:>3} {:>8} | {:>8.0} {:>8.0} {:>8.0} {:>8.0} | {:>8.2} {} | {:>9.0} {:>11} {:>9}",
                k,
                threads,
                pct(&mut lat, 0.5),
                pct(&mut lat, 0.95),
                pct(&mut lat, 0.99),
                pct(&mut lat, 1.0),
                frames as f64 / wall,
                cpu,
                allocs,
                decoded,
                format!("{found}/{total}")
            );
        }
    }
    println!("Budget: the window closes at slot + 25.5 s and the next slot starts at + 30 s, so a decode must finish in 4.5 s.");
    Ok(())
}

/// Exact one-sided upper 95% bound on a binomial rate with `k` events in `n` trials (Clopper-
/// Pearson), by bisection on the binomial tail.
fn upper95(k: u64, n: u64) -> f64 {
    let tail = |p: f64| -> f64 {
        // P(X <= k | n, p)
        let mut term = (1.0 - p).powf(n as f64);
        let mut sum = term;
        for i in 0..k {
            term *= (n - i) as f64 / (i + 1) as f64 * p / (1.0 - p);
            sum += term;
        }
        sum
    };
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if tail(mid) > 0.05 {
            lo = mid
        } else {
            hi = mid
        }
    }
    hi
}

fn false_decodes(slots: usize) -> Result<(), String> {
    let rx = Receiver::new();
    let open = RxConfig { min_fine_sync: 0.0, passes: 1, ..Default::default() };
    let prod = RxConfig::default();
    let (mut attempts, mut false_open, mut prod_attempts, mut false_prod, mut cands) = (0u64, 0u64, 0u64, 0u64, 0u64);
    let t0 = Instant::now();
    for s in 0..slots as u64 {
        let x = synthesize(&Band { noise: true, ..Default::default() }, &mut rng(0xF00D + s));
        let a = rx.decode_slot(&x, &open);
        attempts += a.passes.iter().map(|p| p.ldpc_attempts as u64).sum::<u64>();
        cands += a.passes.iter().map(|p| p.candidates as u64).sum::<u64>();
        false_open += a.decodes.len() as u64;
        for d in &a.decodes {
            println!("FALSE DECODE (gate off) slot {s}: {} at {:.1} Hz, {:?}", d.message, d.freq_hz, d.method);
        }
        let b = rx.decode_slot(&x, &prod);
        prod_attempts += b.passes.iter().map(|p| p.ldpc_attempts as u64).sum::<u64>();
        false_prod += b.decodes.len() as u64;
        if (s + 1) % 200 == 0 {
            eprintln!("  {} slots, {attempts} LDPC attempts, {false_open} false ({:.0} s)", s + 1, t0.elapsed().as_secs_f64());
        }
    }
    println!("noise-only slots: {slots}; candidates: {cands}");
    println!(
        "gate off (every candidate decoded): {false_open} false decodes in {attempts} LDPC attempts; rate {:.2e}, 95% upper bound {:.2e}",
        false_open as f64 / attempts.max(1) as f64,
        upper95(false_open, attempts)
    );
    println!("production config: {false_prod} false decodes in {prod_attempts} LDPC attempts over the same slots; per slot {:.2e}, 95% upper bound per slot {:.2e}", false_prod as f64 / slots as f64, upper95(false_prod, slots as u64));
    Ok(())
}

fn sweep(frames: usize) -> Result<(), String> {
    let rx = Receiver::new();
    println!("AWGN sweep through decode_slot on z30-channel bands, {frames} frames/point (exploratory unless >= 200)");
    for snr in [-26.0, -25.0, -24.0, -23.0, -22.0, -21.0, -20.0] {
        let mut ok = 0;
        for i in 0..frames as u64 {
            let mut r = rng(50_000 + i);
            let (p, st) = random_station(&mut r, 300.0 + (i as f64 * 331.7) % 2400.0, -1.4 + (i as f64 * 0.77) % 2.8, snr);
            let x = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(60_000 + i));
            ok += rx.decode_slot(&x, &RxConfig::default()).decodes.iter().any(|d| d.info[..63] == p) as usize;
        }
        println!("{snr:+6.1} dB  {ok:4}/{frames}");
    }
    Ok(())
}

/// Entry point.
pub fn run(what: &str, frames: usize) -> Result<(), String> {
    match what {
        "perf" => perf(frames),
        "false-decodes" => false_decodes(frames),
        "sweep" => sweep(frames),
        other => Err(format!("unknown benchmark \"{other}\" (perf, false-decodes, sweep)")),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn upper_bound_matches_the_rule_of_three() {
        let u = super::upper95(0, 100_000);
        assert!((u - 3.0 / 100_000.0).abs() < 1e-6, "{u}");
    }
}
