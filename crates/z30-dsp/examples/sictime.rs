//! Micro-timing of the SIC building blocks.
use std::time::Instant;
use z30_protocol::gfsk::Modulator;
fn main() {
    let m = Modulator::new(6000.0).unwrap();
    let sym = [3u8; 75];
    let t = Instant::now();
    for _ in 0..10 {
        let _ = m.instantaneous_frequency(&sym, 1000.0);
    }
    println!("instantaneous_frequency {:.2} ms", t.elapsed().as_secs_f64() * 100.0);
    let t = Instant::now();
    for _ in 0..10 {
        let _ = m.analytic(&sym, 1000.0, 0.0, 0.0);
    }
    println!("analytic {:.2} ms", t.elapsed().as_secs_f64() * 100.0);
    let mut x = vec![0.1f32; 162_000];
    let t = Instant::now();
    let p = z30_dsp::sic::plan(&x, &m, &sym, 1000.0, 0.0, 9000, &Default::default());
    println!("plan {:.2} ms", t.elapsed().as_secs_f64() * 1e3);
    let t = Instant::now();
    let _ = z30_dsp::sic::apply(&mut x, &p);
    println!("apply {:.2} ms", t.elapsed().as_secs_f64() * 1e3);
}
