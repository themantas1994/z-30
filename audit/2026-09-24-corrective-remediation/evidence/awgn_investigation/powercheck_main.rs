// Compares the two SNR normalisations: the suite's (z30_channel::unit_frame_power, a reference
// frame of all-zero symbols at 1000 Hz) and the post-remediation audit harness's (each frame's
// own real-part power, at its own f0, phase and fractional delay). Prints the dB difference.
use rand::Rng;
use z30_protocol::gfsk::Modulator;
fn main() {
    let m = Modulator::new(6000.0).unwrap();
    let p_unit = z30_channel::unit_frame_power(&m);
    let mut r = z30_channel::rng(12345);
    let mut d = Vec::new();
    for _ in 0..2000 {
        let f0: f64 = r.gen_range(210.0..2740.0);
        let (_, st) = z30_channel::random_station(&mut r, f0, 0.0, 0.0);
        let frac: f64 = r.gen_range(0.0..1.0);
        let (re, im) = m.analytic(&st.symbols, st.f0_hz, 0.0, frac);
        let (c, s) = (st.phase_rad.cos(), st.phase_rad.sin());
        let w: Vec<f64> = re.iter().zip(&im).map(|(a, b)| a * c - b * s).collect();
        let p = w.iter().map(|v| v * v).sum::<f64>() / w.len() as f64;
        d.push(10.0 * (p / p_unit).log10());
    }
    let mean = d.iter().sum::<f64>() / d.len() as f64;
    let (lo, hi) = d.iter().fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x)));
    println!("own-frame power vs unit_frame_power over 2000 random frames: mean {mean:+.5} dB, min {lo:+.5}, max {hi:+.5}");
}
