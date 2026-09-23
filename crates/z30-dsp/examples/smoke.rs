use z30_channel::*;
use z30_dsp::slot::{Receiver, RxConfig};
fn main() {
    let rx = Receiver::new();
    let args: Vec<f64> = std::env::args().skip(1).map(|a| a.parse().unwrap()).collect();
    let snr = args.first().copied().unwrap_or(-10.0);
    let n = args.get(1).copied().unwrap_or(10.0) as u64;
    let drift = args.get(2).copied().unwrap_or(0.0);
    let mut ok = 0;
    let mut t = 0.0;
    for seed in 0..n {
        let mut r = rng(seed);
        let (payload, mut st) = random_station(&mut r, 1250.0 + seed as f64 * 13.7 % 500.0, (seed as f64 * 0.37) % 2.8 - 1.4, snr);
        st.drift_hz = drift;
        let band = Band { stations: vec![st.clone()], noise: true, ..Default::default() };
        let slot = synthesize(&band, &mut r);
        let rep = rx.decode_slot(&slot, &RxConfig::default());
        t += rep.elapsed_ms;
        let hit = rep.decodes.iter().any(|d| d.info[..63] == payload);
        ok += hit as u32;
        if seed < 3 || !hit {
            println!(
                "seed {seed}: f0 {:.2} dt {:.3} -> {} decodes {:?} passes {:?}",
                st.f0_hz,
                st.dt_sec,
                rep.decodes.len(),
                rep.decodes.iter().map(|d| (d.freq_hz, d.dt_sec, d.snr_db, d.drift_hz, d.iterations)).collect::<Vec<_>>(),
                rep.passes.iter().map(|p| (p.candidates, p.decoded, p.duplicates, p.elapsed_ms as u32)).collect::<Vec<_>>()
            );
        }
    }
    println!("snr {snr}: {ok}/{n}, mean {:.0} ms/slot", t / n as f64);
}
