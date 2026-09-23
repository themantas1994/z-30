//! Port of z30_dsp/benchmark.py `demodulate_mfsk_llrs` (non-coherent receiver, the shipped
//! RECEIVER_PILOT_COHERENCE = 0) for the language PoC.
//!
//! Same mathematics - per-symbol 16-tone quadrature correlators, Rician ln I0 metric scaled by
//! the pilot-derived amplitude and the supplied sigma, exact log-MAP bit demapping, +/-25 clip -
//! but with the 16 tone references tabulated once per call instead of recomputed for every
//! symbol, which is legitimate because the tone spacing is exactly 1/T and the Python reference
//! uses a window-local time base.

pub const SYNC_POS: [usize; 21] = [0, 1, 2, 7, 8, 9, 17, 18, 19, 27, 28, 29, 37, 38, 39, 47, 48, 49, 72, 73, 74];
pub const SYNC_TONES: [usize; 21] = [3, 11, 7, 14, 2, 9, 5, 12, 1, 15, 6, 10, 4, 8, 13, 0, 9, 3, 14, 6, 11];

/// Cephes/NumPy `i0` (numpy.lib._function_base_impl._i0_1/_i0_2).
fn chbevl(x: f64, c: &[f64]) -> f64 {
    let mut b0 = c[0];
    let mut b1 = 0.0;
    let mut b2 = 0.0;
    for &ci in &c[1..] { b2 = b1; b1 = b0; b0 = x * b1 - b2 + ci; }
    0.5 * (b0 - b2)
}
const I0_A: [f64; 30] = [
    -4.41534164647933937950E-18, 3.33079451882223809783E-17, -2.43127984654795469359E-16,
    1.71539128555513303061E-15, -1.16853328779934516808E-14, 7.67618549860493561688E-14,
    -4.85644678311192946090E-13, 2.95505266312963983461E-12, -1.72682629144155570723E-11,
    9.67580903537323691224E-11, -5.18979560163526290666E-10, 2.65982372468238665035E-9,
    -1.30002500998624804212E-8, 6.04699502254191894932E-8, -2.67079385394061173391E-7,
    1.11738753912010371815E-6, -4.41673835845875056359E-6, 1.64484480707288970893E-5,
    -5.75419501008210370398E-5, 1.88502885095841655729E-4, -5.76375574538582365885E-4,
    1.63947561694133579842E-3, -4.32430999505057594430E-3, 1.05464603945949983183E-2,
    -2.37374148058994688156E-2, 4.93052842396707084878E-2, -9.49010970480476444210E-2,
    1.71620901522208775349E-1, -3.04682672343198398683E-1, 6.76795274409476084995E-1,
];
const I0_B: [f64; 25] = [
    -7.23318048787475395456E-18, -4.83050448594418207126E-18, 4.46562142029675999901E-17,
    3.46122286769746109310E-17, -2.82762398051658348494E-16, -3.42548561967721913462E-16,
    1.77256013305652638360E-15, 3.81168066935262242075E-15, -9.55484669882830764870E-15,
    -4.15056934728722208663E-14, 1.54008621752140982691E-14, 3.85277838274214270114E-13,
    7.18012445138366623367E-13, -1.79417853150680611778E-12, -1.32158118404477131188E-11,
    -3.14991652796324136454E-11, 1.18891471078464383424E-11, 4.94060238822496958910E-10,
    3.39623202570838634515E-9, 2.26666899049817806459E-8, 2.04891858946906374183E-7,
    2.89137052083475648297E-6, 6.88975834691682398426E-5, 3.36911647825569408990E-3,
    8.04490411014108831608E-1,
];
fn i0(x: f64) -> f64 {
    let x = x.abs();
    if x <= 8.0 { x.exp() * chbevl(x / 2.0 - 2.0, &I0_A) } else { x.exp() * chbevl(32.0 / x - 2.0, &I0_B) / x.sqrt() }
}

fn log_sum_exp(v: &[f64]) -> f64 {
    let m = v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    m + v.iter().map(|x| (x - m).exp()).sum::<f64>().ln()
}

pub struct Demod { nsps: usize, cos_t: Vec<f64>, sin_t: Vec<f64>, fs: f64 }

impl Demod {
    pub fn new(fs: f64) -> Self { let nsps = (fs * 0.320) as usize; Demod { nsps, cos_t: vec![], sin_t: vec![], fs } }

    fn tables(&mut self, f0: f64) {
        // 16 tone references over one symbol, window-local time base (as the reference does).
        let n = self.nsps;
        self.cos_t.resize(16 * n, 0.0);
        self.sin_t.resize(16 * n, 0.0);
        for t in 0..16 {
            let f = f0 + t as f64 * 3.125;
            for k in 0..n {
                let ph = 2.0 * std::f64::consts::PI * f * (k as f64 / self.fs);
                self.cos_t[t * n + k] = ph.cos();
                self.sin_t[t * n + k] = ph.sin();
            }
        }
    }

    #[inline]
    fn corr(&self, seg: &[f32], tone: usize) -> (f64, f64) {
        let n = self.nsps;
        let (c, s) = (&self.cos_t[tone * n..(tone + 1) * n], &self.sin_t[tone * n..(tone + 1) * n]);
        let (mut ac, mut as_) = (0.0f64, 0.0f64);
        for k in 0..n { let x = seg[k] as f64; ac += x * c[k]; as_ += x * s[k]; }
        (ac, as_)
    }

    pub fn demodulate(&mut self, wave: &[f32], sigma: f64, f0: f64, start: usize) -> [f32; 216] {
        self.tables(f0);
        let n = self.nsps;
        let seg_at = |sym: usize| &wave[start + sym * n..start + (sym + 1) * n];
        let mut amp_sum = 0.0;
        for (p, &pos) in SYNC_POS.iter().enumerate() {
            let (c, s) = self.corr(seg_at(pos), SYNC_TONES[p]);
            amp_sum += (c * c + s * s).sqrt() / (n as f64 / 2.0);
        }
        let quad = (sigma * sigma * n as f64 / 2.0).max(1e-12);
        let est_amp = (amp_sum / 21.0).max(0.01);
        let s_corr = (est_amp * n as f64 / 2.0) / quad;
        let mut llr = [0.0f32; 216];
        let mut d = 0;
        let mut likes = [0.0f64; 16];
        for sym in 0..75 {
            if SYNC_POS.contains(&sym) { continue; }
            let seg = seg_at(sym);
            for t in 0..16 {
                let (c, s) = self.corr(seg, t);
                let z = (c * c + s * s).sqrt() * s_corr;
                likes[t] = if z > 15.0 { z - 0.5 * (2.0 * std::f64::consts::PI * z).max(1.0).ln() } else { i0(z).max(1e-12).ln() };
            }
            for bit in 0..4 {
                let mask = 1usize << (3 - bit);
                let mut l0 = [0.0f64; 8];
                let mut l1 = [0.0f64; 8];
                let (mut a, mut b) = (0, 0);
                for t in 0..16 { if t & mask == 0 { l0[a] = likes[t]; a += 1 } else { l1[b] = likes[t]; b += 1 } }
                llr[d * 4 + bit] = (log_sum_exp(&l0) - log_sum_exp(&l1)).clamp(-25.0, 25.0) as f32;
            }
            d += 1;
        }
        llr
    }
}
