// Bit-identity harness for 624fa9b (audit/2026-10-06-codebase-cleanup/PERFORMANCE.md §2).
// Dumps every decode_slot output field as raw bits over 42 seeded bands. To rerun: copy to
// crates/z30-dsp/examples/zz_bitcheck.rs on each commit, then
//   cargo run --release --locked -p z30-dsp --example zz_bitcheck > out-<commit>.txt
// and compare the two files byte for byte. bitcheck-output.txt is the output (identical on the
// commit before 624fa9b and on 624fa9b; both hashes in bitcheck-output.sha256).
use z30_channel::{random_station, rng, synthesize, Band};
use z30_dsp::slot::{Receiver, RxConfig};
fn main() {
    let rx = Receiver::new();
    for &k in &[1usize, 2, 5, 12, 20, 35, 50] {
        for s in 0..6u64 {
            let mut r = rng(100 * k as u64 + s);
            let stations = (0..k)
                .map(|j| random_station(&mut r, 220.0 + j as f64 * 2500.0 / k as f64, -1.2 + ((j as f64 * 0.37 + s as f64 * 0.11) % 2.4), -24.0 + ((j * 7 + s as usize) % 26) as f64).1)
                .collect();
            let x = synthesize(&Band { stations, noise: true, ..Default::default() }, &mut rng(7 + s));
            let rep = rx.decode_slot(&x, &RxConfig::default());
            println!("K{k} s{s} n{}", rep.decodes.len());
            for d in &rep.decodes {
                println!("  {:?} {} {:x} {:x} {:?} {:x} {:x} {} {:?} {} {}", d.info, d.message, d.dt_sec.to_bits(), d.freq_hz.to_bits(), d.snr_db.map(f64::to_bits), d.drift_hz.to_bits(), d.sync.to_bits(), d.iterations, d.method, d.ap_type, d.pass);
            }
            for p in &rep.passes {
                println!("  pass c{} d{} l{} dup{} {:?}", p.candidates, p.decoded, p.ldpc_attempts, p.duplicates, p.suppression_db.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
            }
        }
    }
}
