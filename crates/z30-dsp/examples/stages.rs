//! Per-stage timing of decode_slot on a busy band: `cargo run --release -p z30-dsp --example stages -- <K> <threads>`
use z30_channel::{random_station, rng, synthesize, Band};
use z30_dsp::slot::{Receiver, RxConfig};
fn main() {
    let a: Vec<usize> = std::env::args().skip(1).map(|x| x.parse().unwrap()).collect();
    let (k, threads) = (a[0], a[1]);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().unwrap();
    let rx = Receiver::new();
    let mut r = rng(5);
    let stations = (0..k)
        .map(|j| random_station(&mut r, 220.0 + j as f64 * 2500.0 / k as f64, -1.2 + (j as f64 * 0.37) % 2.4, -20.0 + (j % 21) as f64).1)
        .collect();
    let x = synthesize(&Band { stations, noise: true, ..Default::default() }, &mut rng(9));
    for _ in 0..2 {
        let rep = pool.install(|| rx.decode_slot(&x, &RxConfig::default()));
        println!("total {:.0} ms, {} decodes", rep.elapsed_ms, rep.decodes.len());
        for (i, p) in rep.passes.iter().enumerate() {
            println!(
                "  pass {}: {:.0} ms = spectra {:.0} + candidates {:.0} ({} cands, {} LDPC, {} new, {} dup) + SIC {:.0}",
                i + 1,
                p.elapsed_ms,
                p.spectra_ms,
                p.candidates_ms,
                p.candidates,
                p.ldpc_attempts,
                p.decoded,
                p.duplicates,
                p.sic_ms
            );
        }
    }
}
