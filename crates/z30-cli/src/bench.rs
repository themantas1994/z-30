//! `z30 --benchmark`: measured, never projected (directive section 33).
//!
//! - `perf`: `decode_slot` on seeded bands of K = 1, 5, 20 and 50 stations - latency p50, p95,
//!   p99 and max; throughput; process CPU time; heap allocations per slot - on all cores and on
//!   one.
//! - `false-decodes`: noise-only slots with the fine-sync gate disabled, so every candidate
//!   reaches the LDPC decoder: false accepts per LDPC attempt with an exact 95% upper bound.
//!   Also the production configuration's rate on the same slots.
//! - `sweep`: a quick Rust-native AWGN sensitivity sweep on `z30-channel` bands (exploratory).
//!
//! The publishable measurements are `suite.rs` (`--benchmark suite`).

use std::time::Instant;
use z30_channel::{random_station, rng, synthesize, Band};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};

/// Process CPU seconds (user + system), where the platform can say.
pub(crate) fn cpu_seconds() -> Option<f64> {
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
///
/// The tail used to be summed from `(1 - p)^n` upwards in linear space. For k > 0 and large
/// n·p that first term underflows to 0.0, every later term is built from it, and the tail reads
/// 0: the bisection then settled far below the true bound - k = 2000 of n = 10 000 gave 0.072
/// against a true 0.207, below the point estimate 0.2 (audit RES-08 / F-42). The terms are now
/// summed in the log domain. k = 0 keeps the closed form it always had (it cannot underflow into
/// a wrong answer: a vanishing tail is the right one), so every published bound, all of which
/// have k = 0, is reproduced to the last bit.
pub(crate) fn upper95(k: u64, n: u64) -> f64 {
    if k >= n {
        return 1.0;
    }
    let tail = |p: f64| -> f64 {
        // P(X <= k | n, p)
        if k == 0 {
            return (1.0 - p).powf(n as f64);
        }
        if p <= 0.0 {
            return 1.0;
        }
        let (ln_p, ln_q) = (p.ln(), (-p).ln_1p());
        // ln of term i = ln C(n, i) + i ln p + (n - i) ln(1 - p), accumulated term to term.
        let mut ln_term = n as f64 * ln_q;
        let mut terms = Vec::with_capacity(k as usize + 1);
        terms.push(ln_term);
        for i in 0..k {
            ln_term += ((n - i) as f64).ln() - ((i + 1) as f64).ln() + ln_p - ln_q;
            terms.push(ln_term);
        }
        let max = terms.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        if !max.is_finite() {
            return 0.0;
        }
        (max + terms.iter().map(|t| (t - max).exp()).sum::<f64>().ln()).exp().min(1.0)
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
pub fn run(what: &str, opts: &crate::suite::Options) -> Result<(), String> {
    if matches!(what, "perf" | "false-decodes" | "sweep") {
        // These print to the terminal and write no result file; accepting the suite's options
        // and silently ignoring them made a run look like something it was not (RES-06).
        if opts.out.is_some() || opts.replicate.is_some() || opts.per_frame || opts.overwrite {
            return Err(format!("--out, --replicate, --per-frame and --overwrite apply to suite benchmarks, not to \"{what}\""));
        }
    }
    match what {
        "perf" => perf(opts.frames.unwrap_or(20)),
        "false-decodes" => false_decodes(opts.frames.unwrap_or(20)),
        "sweep" => sweep(opts.frames.unwrap_or(20)),
        other => crate::suite::run(other, opts),
    }
}

#[cfg(test)]
mod tests {
    use super::upper95;

    #[test]
    fn upper_bound_matches_the_rule_of_three() {
        let u = upper95(0, 100_000);
        assert!((u - 3.0 / 100_000.0).abs() < 1e-6, "{u}");
    }

    /// k = 0 has the closed form 1 - 0.05^(1/n), for any n. The k = 0 path keeps `(1 - p)^n`
    /// so published bounds reproduce bit for bit; rounding 1 - p costs it about n·ε relative
    /// (1.4e-9 at n = 1e9), far below the three figures any bound is quoted to.
    #[test]
    fn upper_bound_with_no_events_matches_the_closed_form_at_large_n() {
        for n in [10u64, 400, 2000, 133_911, 10_000_000, 1_000_000_000] {
            let exact = -((0.05f64).ln() / n as f64).exp_m1();
            let u = upper95(0, n);
            let tol = if n <= 200_000 { 1e-10 } else { 1e-7 };
            assert!((u / exact - 1.0).abs() < tol, "n = {n}: {u:e} vs {exact:e}");
        }
        // The published values (672cef9b3cdb/false.json and busy.json), to the last bit.
        assert_eq!(upper95(0, 400), 7.461355528799618e-3);
        assert_eq!(upper95(0, 2000), 1.4967448951883067e-3);
        assert_eq!(upper95(0, 50), 5.8155079116972326e-2);
        assert_eq!(upper95(0, 133_911), 2.2370819162953474e-5);
    }

    /// k > 0 against exact Clopper-Pearson bounds computed independently (mpmath, 30 digits,
    /// exact binomial tail). The linear-space sum returned 7.42e-3 and 0.072 for the middle two
    /// (audit RES-08): the second is below its own point estimate.
    #[test]
    fn upper_bound_with_events_matches_clopper_pearson_where_the_tail_used_to_underflow() {
        for (k, n, exact) in [
            (1u64, 10u64, 0.394_163_302_436_505),
            (800, 100_000, 8.479_096_956_109_85e-3),
            (2000, 10_000, 0.206_693_706_934_26),
            (5, 1_000_000, 1.051_300_592_939_87e-5),
        ] {
            let u = upper95(k, n);
            assert!((u / exact - 1.0).abs() < 1e-9, "k = {k}, n = {n}: {u:e} vs {exact:e}");
            assert!(u > k as f64 / n as f64, "the bound lies above the point estimate");
        }
        assert_eq!(upper95(7, 7), 1.0);
    }
}
