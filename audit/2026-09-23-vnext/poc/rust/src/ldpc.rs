//! Port of z30_dsp/ldpc.py `Z30LdpcCodec.decode_min_sum` for the language PoC.
//!
//! Transcribed to reproduce the Python decoder's float32 semantics under NumPy 2 (NEP 50):
//! every message and belief is f32, Python-float constants are rounded to f32 before use, the
//! damping complement (1 - damping) is formed in f64 first, the dither is added in f64 and
//! rounded, and correlations use NumPy's pairwise float32 summation order. The only intended
//! numerical difference is the float32 exp/log1p implementation (glibc here, NumPy SIMD there).
//!
//! Memory layout: one flat CSR edge array (check-major, ascending variable order, exactly as
//! np.nonzero(H) yields it), preallocated once per decoder, zero allocation inside a decode.

use crate::table::CHECK_TO_INFO;

pub const N: usize = 216;
pub const K: usize = 77;
pub const M: usize = 139;

#[derive(Clone, Copy)]
enum Mode { Nms, Spa, Dither }

struct Schedule { mode: Mode, alpha: f64, beta: f64, damping: f64, reverse: bool, iters: usize }

const SCHEDULES: [Schedule; 4] = [
    Schedule { mode: Mode::Nms, alpha: 0.82, beta: 0.08, damping: 0.88, reverse: false, iters: 45 },
    Schedule { mode: Mode::Spa, alpha: 0.95, beta: 0.00, damping: 0.85, reverse: false, iters: 40 },
    Schedule { mode: Mode::Nms, alpha: 0.74, beta: 0.04, damping: 0.90, reverse: true, iters: 35 },
    Schedule { mode: Mode::Dither, alpha: 0.80, beta: 0.06, damping: 0.85, reverse: false, iters: 30 },
];
const DITHER_AMPLITUDE: f64 = 0.45;

pub struct Decoder {
    edge_var: Vec<u16>,     // variable index of each edge
    edge_lo: [u16; M + 1],  // CSR row pointers
    info_table: [[usize; 5]; M],
    // scratch, reused across decodes
    msgs: Vec<f32>,
    total: [f32; N],
    best_total: [f32; N],
    hard: [u8; N],
    best_cw: [u8; N],
    vals: [f32; 8],
    acc: [f32; 8],
    aux: [f32; 8],
    newm: [f32; 8],
}

pub struct DecodeResult { pub success: bool, pub info: [u8; K], pub iterations: usize }

impl Decoder {
    pub fn new() -> Self {
        let mut edge_var = Vec::with_capacity(M * 7);
        let mut edge_lo = [0u16; M + 1];
        for c in 0..M {
            edge_lo[c] = edge_var.len() as u16;
            let mut vs: Vec<usize> = CHECK_TO_INFO[c].to_vec();
            vs.sort_unstable();
            if c > 0 { vs.push(K + c - 1); }
            vs.push(K + c);
            for v in vs { edge_var.push(v as u16); }
        }
        edge_lo[M] = edge_var.len() as u16;
        let n_edges = edge_var.len();
        Decoder {
            edge_var, edge_lo, info_table: CHECK_TO_INFO,
            msgs: vec![0.0; n_edges], total: [0.0; N], best_total: [0.0; N], hard: [0; N], best_cw: [0; N],
            vals: [0.0; 8], acc: [0.0; 8], aux: [0.0; 8], newm: [0.0; 8],
        }
    }

    pub fn crc14(bits: &[u8]) -> u16 {
        let mut crc: u16 = 0x2757;
        for &b in bits {
            let msb = (crc >> 13) & 1;
            crc = ((crc << 1) & 0x3FFF) ^ (if (msb ^ (b as u16 & 1)) != 0 { 0x2443 } else { 0 });
        }
        crc & 0x3FFF
    }

    fn bits_to_int(bits: &[u8]) -> u16 { bits.iter().fold(0u16, |a, &b| (a << 1) | (b as u16 & 1)) }

    fn reaccumulate(&self, info: &[u8], cw: &mut [u8; N]) {
        cw[..K].copy_from_slice(&info[..K]);
        let mut p = 0u8;
        for c in 0..M {
            let s = self.info_table[c].iter().fold(0u8, |a, &j| a ^ info[j]);
            p ^= s;
            cw[K + c] = p;
        }
    }

    fn syndrome_weight(&self, cw: &[u8; N]) -> usize {
        let mut w = 0;
        for c in 0..M {
            let (lo, hi) = (self.edge_lo[c] as usize, self.edge_lo[c + 1] as usize);
            let mut s = 0u8;
            for e in lo..hi { s ^= cw[self.edge_var[e] as usize]; }
            w += s as usize;
        }
        w
    }

    /// NumPy's pairwise float32 summation (numpy/_core/src/umath/loops_utils.h.src).
    fn pairwise_sum(a: &[f32]) -> f32 {
        let n = a.len();
        if n < 8 {
            let mut res = 0.0f32;
            for &x in a { res += x; }
            res
        } else if n <= 128 {
            let mut r = [0.0f32; 8];
            r.copy_from_slice(&a[..8]);
            let mut i = 8;
            while i < n - (n % 8) {
                for j in 0..8 { r[j] += a[i + j]; }
                i += 8;
            }
            let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
            while i < n { res += a[i]; i += 1; }
            res
        } else {
            let mut n2 = n / 2;
            n2 -= n2 % 8;
            Self::pairwise_sum(&a[..n2]) + Self::pairwise_sum(&a[n2..])
        }
    }

    fn correlation(cw: &[u8; N], llr: &[f32; N]) -> f32 {
        let mut prod = [0.0f32; N];
        for i in 0..N { prod[i] = if cw[i] == 0 { llr[i] } else { -llr[i] }; }
        Self::pairwise_sum(&prod)
    }

    fn dither_vector(llr: &[f32; N]) -> [f64; N] {
        let mut h: u32 = 0x811C9DC5;
        for &v in llr.iter() {
            let q = ((v as f64) * 64.0 + 0.5).floor() as i64 as u32;
            for shift in [0u32, 8, 16, 24] {
                h ^= (q >> shift) & 0xFF;
                h = h.wrapping_mul(0x01000193);
            }
        }
        let mut state = if h == 0 { 0x9E3779B9u32 } else { h };
        let mut out = [0.0f64; N];
        for o in out.iter_mut() {
            state = state.wrapping_add(0x6D2B79F5);
            let mut t = state;
            t = (t ^ (t >> 15)).wrapping_mul(t | 1);
            t = t ^ t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
            let unit = ((t ^ (t >> 14)) as f64) / 4294967296.0;
            *o = (unit - 0.5) * DITHER_AMPLITUDE;
        }
        out
    }

    /// `_box_plus_into` lane step: out[i] = boxplus(x[i], y) in f32.
    #[inline(always)]
    fn box_plus(x: f32, y: f32) -> f32 {
        let sign_y = if y >= 0.0 { 1.0f32 } else { -1.0f32 };
        let s = if x >= 0.0 { sign_y } else { -sign_y };
        let base = x.abs().min(y.abs()) * s;
        let a = -(x + y).abs();
        let b = -(x - y).abs();
        let ca = if a > -30.0 { a.exp().ln_1p() } else { 0.0 };
        let cb = if b > -30.0 { b.exp().ln_1p() } else { 0.0 };
        (base + ca) - cb
    }

    fn spa_messages(&mut self, d: usize, alpha: f32) {
        let (vals, acc, aux) = (&self.vals, &mut self.acc, &mut self.aux);
        for a in acc[..d].iter_mut() { *a = 0.0; }
        for j in 0..d {
            let y = vals[j];
            if j == 0 { for a in acc[1..d].iter_mut() { *a = y; } continue; }
            for i in 0..d { aux[i] = Self::box_plus(acc[i], y); }
            if j == 1 { for i in 2..d { acc[i] = aux[i]; } acc[0] = y; }
            else { for i in 0..d { if i != j { acc[i] = aux[i]; } } }
        }
        for i in 0..d { self.newm[i] = (acc[i] * alpha).clamp(-20.0, 20.0); }
    }

    fn sweep(&mut self, s: &Schedule) {
        let alpha = s.alpha as f32;
        let beta = s.beta as f32;
        let c_old = (1.0f64 - s.damping) as f32;
        let c_new = s.damping as f32;
        let spa = matches!(s.mode, Mode::Spa);
        for idx in 0..M {
            let c = if s.reverse { M - 1 - idx } else { idx };
            let lo = self.edge_lo[c] as usize;
            let d = self.edge_lo[c + 1] as usize - lo;
            let (mut min1, mut min2) = (999999.0f32, 999999.0f32);
            let mut min1_idx = usize::MAX;
            let mut prod_sign = 1.0f32;
            for i in 0..d {
                let v = self.edge_var[lo + i] as usize;
                let val = self.total[v] - self.msgs[lo + i];
                self.vals[i] = val;
                prod_sign *= if val >= 0.0 { 1.0 } else { -1.0 };
                let mag = val.abs();
                if mag < min1 { min2 = min1; min1 = mag; min1_idx = i; } else if mag < min2 { min2 = mag; }
            }
            if spa { self.spa_messages(d, alpha); }
            for i in 0..d {
                let v = self.edge_var[lo + i] as usize;
                let new_msg = if spa {
                    self.newm[i]
                } else {
                    let self_sign = if self.vals[i] >= 0.0 { 1.0f32 } else { -1.0 };
                    let min_mag = if i == min1_idx { min2 } else { min1 };
                    let m = alpha * min_mag - beta;
                    prod_sign * self_sign * if m > 0.0 { m } else { 0.0 }
                };
                let old = self.msgs[lo + i];
                let damped = c_old * old + c_new * new_msg;
                let diff = damped - old;
                self.msgs[lo + i] = damped;
                self.total[v] += diff;
            }
        }
    }

    pub fn decode(&mut self, llr_in: &[f32; N]) -> DecodeResult {
        let input = *llr_in;
        for i in 0..N { self.hard[i] = (input[i] < 0.0) as u8; }
        if Self::crc14(&self.hard[..63]) == Self::bits_to_int(&self.hard[63..77]) && self.syndrome_weight(&self.hard) == 0 {
            let mut info = [0u8; K];
            info.copy_from_slice(&self.hard[..K]);
            return DecodeResult { success: true, info, iterations: 1 };
        }
        let mut min_syn = 999usize;
        let mut total_iters = 0usize;
        self.best_cw = [0; N];
        self.best_total = input;
        let mut ira = [0u8; N];
        for s in SCHEDULES.iter() {
            self.total = input;
            if let Mode::Dither = s.mode {
                let dv = Self::dither_vector(&input);
                for i in 0..N { self.total[i] = ((self.total[i] as f64) + dv[i]) as f32; }
            }
            for m in self.msgs.iter_mut() { *m = 0.0; }
            for _ in 0..s.iters {
                total_iters += 1;
                self.sweep(s);
                for i in 0..N { self.hard[i] = (self.total[i] < 0.0) as u8; }
                let w = self.syndrome_weight(&self.hard);
                if w < min_syn {
                    min_syn = w;
                    self.best_cw = self.hard;
                    self.best_total = self.total;
                }
                let crc_calc = Self::crc14(&self.hard[..63]);
                let crc_rcvd = Self::bits_to_int(&self.hard[63..77]);
                if w == 0 && crc_calc == crc_rcvd {
                    let mut info = [0u8; K];
                    info.copy_from_slice(&self.hard[..K]);
                    return DecodeResult { success: true, info, iterations: total_iters };
                }
                if crc_calc == crc_rcvd {
                    self.reaccumulate(&self.hard.clone()[..K], &mut ira);
                    let corr = Self::correlation(&ira, &input);
                    let diff = (0..N).filter(|&i| ira[i] != self.hard[i]).count();
                    if corr > 0.0 && diff <= 12 {
                        let mut info = [0u8; K];
                        info.copy_from_slice(&self.hard[..K]);
                        return DecodeResult { success: true, info, iterations: total_iters };
                    }
                }
            }
            if min_syn == 0 && Self::crc14(&self.best_cw[..63]) == Self::bits_to_int(&self.best_cw[63..77]) {
                let mut info = [0u8; K];
                info.copy_from_slice(&self.best_cw[..K]);
                return DecodeResult { success: true, info, iterations: total_iters };
            }
        }
        // OSD-2 over the 14 least reliable payload bits (the shipped acceptance rule, CRC included).
        if min_syn <= 14 {
            let mut ranked: Vec<usize> = (0..63).collect();
            let bt = self.best_total;
            ranked.sort_by(|&a, &b| bt[a].abs().partial_cmp(&bt[b].abs()).unwrap());
            let test = &ranked[..14];
            let base: [u8; 63] = self.best_cw[..63].try_into().unwrap();
            let mut best: Option<[u8; N]> = None;
            let mut max_corr = 0.0f64;
            let mut cand = [0u8; K];
            let mut cw = [0u8; N];
            let mut eval = |this: &Self, pl: &[u8; 63], best: &mut Option<[u8; N]>, max_corr: &mut f64| {
                let crc = Self::crc14(pl);
                cand[..63].copy_from_slice(pl);
                for b in 0..14 { cand[63 + b] = ((crc >> (13 - b)) & 1) as u8; }
                this.reaccumulate(&cand, &mut cw);
                let corr = Self::correlation(&cw, &input) as f64;
                let diff = (0..N).filter(|&i| cw[i] != this.best_cw[i]).count();
                if corr > 20.0 && corr > *max_corr && diff <= 16 { *max_corr = corr; *best = Some(cw); }
            };
            eval(self, &base, &mut best, &mut max_corr);
            for i in 0..14 { let mut c1 = base; c1[test[i]] ^= 1; eval(self, &c1, &mut best, &mut max_corr); }
            for i in 0..14 { for j in (i + 1)..14 {
                let mut c2 = base; c2[test[i]] ^= 1; c2[test[j]] ^= 1; eval(self, &c2, &mut best, &mut max_corr);
            } }
            if let Some(b) = best {
                let mut info = [0u8; K];
                info.copy_from_slice(&b[..K]);
                return DecodeResult { success: true, info, iterations: total_iters };
            }
        }
        let mut info = [0u8; K];
        info.copy_from_slice(&self.best_cw[..K]);
        DecodeResult { success: false, info, iterations: total_iters }
    }
}
