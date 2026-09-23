use std::time::Instant;
use z30_channel::*;
use z30_dsp::baseband::*;
use z30_dsp::demod::*;
use z30_dsp::ldpc::Decoder;
use z30_dsp::sync::*;
fn main() {
    let plans = Plans::new();
    let tones = ToneTable::new();
    let sf = SymbolFft::new();
    let mut dec = Decoder::new();
    let args: Vec<f64> = std::env::args().skip(1).map(|a| a.parse().unwrap()).collect();
    let snr = args[0];
    let drift = args[1];
    let n = args[2] as u64;
    let (mut t_bb, mut t_fs, mut t_dm, mut t_ld) = (0.0, 0.0, 0.0, 0.0);
    for seed in 0..n {
        let mut r = rng(100 + seed);
        let (payload, mut st) = random_station(&mut r, 1250.0, 0.3, snr);
        st.drift_hz = drift;
        let band = Band { stations: if snr > -99.0 { vec![st] } else { vec![] }, noise: true, ..Default::default() };
        let slot = synthesize(&band, &mut r);
        let spec = SlotSpectrum::new(&plans, &slot);
        let sg = Spectrogram::new(&slot, 200.0, 2800.0);
        let cands = sg.candidates(1.5, 50, 200.0, 2800.0);
        for (ci, c) in cands.iter().enumerate() {
            let t0 = Instant::now();
            let (bb, _centre) = spec.baseband(&plans, c.f0_hz);
            let t1 = Instant::now();
            let coarse = ((SLOT_ZERO_INDEX as f64 + c.dt_sec * 6000.0) / 30.0).round() as usize;
            let (z, d) = fine_sync(&bb, &tones, coarse, 4.0);
            let t2 = Instant::now();
            let fsz = FrameSpectra::new(&bb, &sf, &z);
            let s2 = fsz.noise_sigma2();
            let llr = fsz.llrs();
            let t3 = Instant::now();
            let res = dec.decode(&llr, None);
            let t4 = Instant::now();
            t_bb += (t1 - t0).as_secs_f64();
            t_fs += (t2 - t1).as_secs_f64();
            t_dm += (t3 - t2).as_secs_f64();
            t_ld += (t4 - t3).as_secs_f64();
            let d = d.unwrap();
            let truth = (c.f0_hz - 1250.0).abs() < 2.0 && (c.dt_sec - 0.3).abs() < 0.1;
            let ok = res.success && res.info[..63] == payload;
            if truth || ci < 3 || res.success {
                println!(
                    "seed {seed} cand {ci} truth {truth} sync {:.2} zero {:.2} drift {:.2} ({:.1} Hz) ok {ok} succ {}",
                    c.sync,
                    z.metric / (21.0 * 2.0 * s2),
                    d.metric / (21.0 * 2.0 * s2),
                    d.drift_hz,
                    res.success
                );
            }
        }
    }
    println!(
        "per-candidate ms: bb {:.2} fine {:.2} demod {:.2} ldpc {:.2}",
        t_bb * 1e3 / (n as f64 * 50.0),
        t_fs * 1e3 / (n as f64 * 50.0),
        t_dm * 1e3 / (n as f64 * 50.0),
        t_ld * 1e3 / (n as f64 * 50.0)
    );
}
