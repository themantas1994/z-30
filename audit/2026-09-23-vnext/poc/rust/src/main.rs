mod demod;
mod ldpc;
mod table;

use std::fs;
use std::time::Instant;

fn stats(v: &mut Vec<f64>) -> String {
    if v.is_empty() { return "n=0".into(); }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = v.iter().sum::<f64>() / v.len() as f64;
    let p = |q: f64| v[((q * v.len() as f64) as usize).min(v.len() - 1)];
    format!("n={} mean={:.4}ms p50={:.4}ms p99={:.4}ms max={:.4}ms", v.len(), mean, p(0.5), p(0.99), v[v.len() - 1])
}

fn main() {
    let dir = std::env::args().nth(1).expect("corpus dir");
    // ---------------------------------------------------------------- LDPC corpus
    let raw = fs::read(format!("{dir}/corpus.bin")).unwrap();
    let llrs: Vec<f32> = raw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let refs: Vec<(bool, usize, String)> = fs::read_to_string(format!("{dir}/corpus_ref.tsv")).unwrap()
        .lines().map(|l| { let f: Vec<&str> = l.split('\t').collect(); (f[0] == "1", f[1].parse().unwrap(), f[2].to_string()) }).collect();
    let n_frames = llrs.len() / 216;
    assert_eq!(n_frames, refs.len());
    let mut dec = ldpc::Decoder::new();
    let (mut same_success, mut same_info, mut same_iters) = (0, 0, 0);
    let mut t_ok = vec![]; let mut t_fail = vec![];
    let mut mismatches = vec![];
    for f in 0..n_frames {
        let mut v = [0f32; 216];
        v.copy_from_slice(&llrs[f * 216..(f + 1) * 216]);
        // Timed over repeated runs so a sub-microsecond decode is still resolved.
        let reps = 20;
        let t0 = Instant::now();
        let mut r = dec.decode(&v);
        for _ in 1..reps { r = dec.decode(&v); }
        let ms = t0.elapsed().as_secs_f64() * 1000.0 / reps as f64;
        if r.success { t_ok.push(ms) } else { t_fail.push(ms) }
        let (rs, ri, ref info) = refs[f];
        let bits: String = r.info.iter().map(|b| if *b == 1 { '1' } else { '0' }).collect();
        if r.success == rs { same_success += 1; }
        if bits == *info { same_info += 1; }
        if r.iterations == ri { same_iters += 1; }
        if r.success != rs || bits != *info || r.iterations != ri { mismatches.push((f, rs, r.success, ri, r.iterations)); }
    }
    println!("RUST LDPC  frames={n_frames}  same_success={same_success} same_info_bits={same_info} same_iterations={same_iters}");
    println!("  mismatches (frame, ref_ok, rust_ok, ref_iters, rust_iters): {:?}", &mismatches[..mismatches.len().min(12)]);
    println!("  decode (success): {}", stats(&mut t_ok));
    println!("  decode (failure, all 4 schedules + OSD): {}", stats(&mut t_fail));

    // ---------------------------------------------------------------- demodulator
    let wraw = fs::read(format!("{dir}/demod_wave.bin")).unwrap();
    let wave: Vec<f32> = wraw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let meta: Vec<f64> = fs::read_to_string(format!("{dir}/demod_meta.txt")).unwrap().split_whitespace().map(|s| s.parse().unwrap()).collect();
    let (fs_hz, sigma, f0, start) = (meta[0], meta[1], meta[2], meta[3] as usize);
    let praw = fs::read(format!("{dir}/demod_llr_py.bin")).unwrap();
    let py: Vec<f32> = praw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let mut dm = demod::Demod::new(fs_hz);
    let out = dm.demodulate(&wave, sigma, f0, start);
    let maxdiff = out.iter().zip(py.iter()).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
    let mut td = vec![];
    for _ in 0..50 { let t0 = Instant::now(); let _ = dm.demodulate(&wave, sigma, f0, start); td.push(t0.elapsed().as_secs_f64() * 1000.0); }
    println!("RUST DEMOD fs={fs_hz}  max|LLR_rust - LLR_python| = {maxdiff:.3e}   {}", stats(&mut td));
}
