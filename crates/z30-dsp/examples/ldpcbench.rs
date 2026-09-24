use std::time::Instant;
use z30_dsp::ldpc::*;
fn main() {
    let raw: Vec<f32> = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/golden/ldpc_corpus_llr.f32"))
        .unwrap()
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let mut dec = Decoder::new();
    let (mut tf, mut nf, mut ts, mut ns) = (0.0, 0, 0.0, 0);
    for l in raw.as_chunks::<216>().0 {
        let t = Instant::now();
        let r = dec.decode(l, None);
        let e = t.elapsed().as_secs_f64() * 1e3;
        if r.success {
            ts += e;
            ns += 1
        } else {
            tf += e;
            nf += 1
        }
    }
    println!("fail {:.2} ms (n={nf}), success {:.3} ms (n={ns})", tf / nf as f64, ts / ns as f64);
}
