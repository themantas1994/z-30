use std::time::Instant;
use z30_dsp::ldpc::*;
fn main() {
    let raw: Vec<f32> = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/golden/ldpc_corpus_llr.f32"))
        .unwrap()
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let mut dec = Decoder::new();
    let (mut tf, mut nf, mut ts, mut ns) = (0.0, 0, 0.0, 0);
    for c in raw.chunks_exact(216) {
        let l: Llrs = c.try_into().unwrap();
        let t = Instant::now();
        let r = dec.decode(&l, None);
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
