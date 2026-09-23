//! The (216, 77) LDPC decoder: the reference's four-schedule layered cascade, bit-exact, and the
//! corrected OSD (SPEC.md section 7).
//!
//! Bit-exactness means: same success verdict, same 77 information bits and the same cumulative
//! iteration count as `Z30LdpcCodec.decode_min_sum` on every vector of the golden corpus. The
//! float32 semantics that requires (NumPy 2 / NEP 50) were established by the audit PoC and are
//! transcribed here: every message and belief is f32; Python-float constants are rounded to f32
//! before use; `1 - damping` is formed in f64 and then rounded; the dither is added in f64 and
//! rounded; correlations use NumPy's pairwise f32 summation.
//!
//! The decoder owns its scratch and allocates nothing per decode after construction, so one
//! `Decoder` per worker thread is the intended use. It is a pure function of its input: the
//! schedule-4 dither is derived from the LLRs themselves.

use z30_protocol::crc::{bits_to_u64, crc14};
use z30_protocol::ldpc::{check_vars, encode_info, CHECK_TO_INFO};
use z30_protocol::{K, M, N, PAYLOAD_BITS};

/// Channel LLRs for one codeword. Positive means bit 0.
pub type Llrs = [f32; N];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Nms,
    Spa,
    Dither,
}

struct Schedule {
    mode: Mode,
    alpha: f64,
    beta: f64,
    damping: f64,
    reverse: bool,
    iters: usize,
}

/// The cascade. `DECODE_SCHEDULES` in `z30_dsp/ldpc.py`.
const SCHEDULES: [Schedule; 4] = [
    Schedule { mode: Mode::Nms, alpha: 0.82, beta: 0.08, damping: 0.88, reverse: false, iters: 45 },
    Schedule { mode: Mode::Spa, alpha: 0.95, beta: 0.00, damping: 0.85, reverse: false, iters: 40 },
    Schedule { mode: Mode::Nms, alpha: 0.74, beta: 0.04, damping: 0.90, reverse: true, iters: 35 },
    Schedule { mode: Mode::Dither, alpha: 0.80, beta: 0.06, damping: 0.85, reverse: false, iters: 30 },
];

/// Iteration cap of schedule 1 (`LDPC_MAX_ITERATIONS` in the reference).
pub const LDPC_MAX_ITERATIONS: usize = 45;
/// Total iterations of a cascade that never converges.
pub const CASCADE_ITERATIONS: usize = 45 + 40 + 35 + 30;
/// Peak-to-peak dither of schedule 4.
pub const DITHER_AMPLITUDE: f64 = 0.45;
/// OSD runs only when BP got this close (minimum syndrome weight).
pub const OSD_MAX_SYNDROME: usize = 14;
/// OSD flips up to two of this many least reliable information bits.
pub const OSD_TEST_BITS: usize = 14;
/// OSD acceptance: correlation with the channel LLRs must exceed this...
pub const OSD_MIN_CORRELATION: f64 = 20.0;
/// ...and the candidate may differ from the BP decision in at most this many bits.
pub const OSD_MAX_DISTANCE: usize = 16;

/// How a successful decode got there.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeMethod {
    /// The channel hard decision was already a codeword with a matching CRC.
    HardDecision,
    /// Belief propagation converged (zero syndrome, CRC match) in this schedule (1-4).
    BeliefPropagation(u8),
    /// The payload CRC matched and the re-encoded codeword passed the trellis test.
    Trellis(u8),
    /// Ordered-statistics post-processing, with this many bit flips (0-2).
    Osd(u8),
}

/// A decode's outcome.
#[derive(Clone, Debug)]
pub struct LdpcResult {
    /// Whether a CRC-valid information block was found.
    pub success: bool,
    /// The 77 information bits (the best BP hard decision on failure).
    pub info: [u8; K],
    /// Belief-propagation iterations, cumulative across schedules (1 for a hard-decision hit).
    pub iterations: usize,
    /// How it succeeded.
    pub method: Option<DecodeMethod>,
    /// Smallest syndrome weight BP reached (0 on BP success).
    pub min_syndrome: usize,
}

/// The state BP leaves behind when it fails; the input to OSD.
#[derive(Clone, Debug)]
pub struct BpFailure {
    /// Best (lowest-syndrome) hard decision.
    pub best_cw: [u8; N],
    /// Beliefs at that iteration.
    pub best_total: [f32; N],
    /// Its syndrome weight.
    pub min_syndrome: usize,
    /// Iterations spent.
    pub iterations: usize,
}

/// Result of the belief-propagation stage alone.
#[derive(Clone, Debug)]
pub enum BpOutcome {
    /// Converged.
    Success(LdpcResult),
    /// Did not converge.
    Failure(BpFailure),
}

/// Positions whose LLR is an assertion (a priori), not a measurement. Pinned bits keep their
/// input belief for every iteration and are never OSD flip candidates.
pub type ApMask = [bool; N];

/// Layered decoder with owned scratch.
pub struct Decoder {
    edge_var: Vec<u16>,
    edge_lo: [u16; M + 1],
    msgs: Vec<f32>,
    total: [f32; N],
    hard: [u8; N],
    vals: [f32; 8],
    acc: [f32; 8],
    aux: [f32; 8],
    newm: [f32; 8],
}

impl Default for Decoder {
    fn default() -> Self {
        Self::new()
    }
}

/// Numpy's pairwise float32 summation (`numpy/_core/src/umath/loops_utils.h.src`).
fn pairwise_sum(a: &[f32]) -> f32 {
    let n = a.len();
    if n < 8 {
        let mut res = 0.0f32;
        for &x in a {
            res += x;
        }
        res
    } else if n <= 128 {
        let mut r = [0.0f32; 8];
        r.copy_from_slice(&a[..8]);
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise_sum(&a[..n2]) + pairwise_sum(&a[n2..])
    }
}

/// `sum((1 - 2 cw) * llr)` in the reference's precision and order.
pub fn correlation(cw: &[u8; N], llr: &Llrs) -> f32 {
    let mut prod = [0.0f32; N];
    for i in 0..N {
        prod[i] = if cw[i] == 0 { llr[i] } else { -llr[i] };
    }
    pairwise_sum(&prod)
}

/// The schedule-4 perturbation: mulberry32 seeded by FNV-1a over 1/64-LLR quanta.
pub fn dither_vector(llr: &Llrs) -> [f64; N] {
    let mut h: u32 = 0x811C_9DC5;
    for &v in llr.iter() {
        let q = ((v as f64) * 64.0 + 0.5).floor() as i64 as u32;
        for shift in [0u32, 8, 16, 24] {
            h ^= (q >> shift) & 0xFF;
            h = h.wrapping_mul(0x0100_0193);
        }
    }
    let mut state = if h == 0 { 0x9E37_79B9u32 } else { h };
    let mut out = [0.0f64; N];
    for o in out.iter_mut() {
        state = state.wrapping_add(0x6D2B_79F5);
        let mut t = state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        let unit = ((t ^ (t >> 14)) as f64) / 4_294_967_296.0;
        *o = (unit - 0.5) * DITHER_AMPLITUDE;
    }
    out
}

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

fn crc_matches(bits: &[u8]) -> bool {
    crc14(&bits[..PAYLOAD_BITS]) as u64 == bits_to_u64(&bits[PAYLOAD_BITS..K])
}

fn info_of(cw: &[u8; N]) -> [u8; K] {
    let mut info = [0u8; K];
    info.copy_from_slice(&cw[..K]);
    info
}

impl Decoder {
    /// Builds the edge tables once.
    pub fn new() -> Self {
        let mut edge_var = Vec::with_capacity(M * 7);
        let mut edge_lo = [0u16; M + 1];
        for c in 0..M {
            edge_lo[c] = edge_var.len() as u16;
            edge_var.extend(check_vars(c).into_iter().map(|v| v as u16));
        }
        edge_lo[M] = edge_var.len() as u16;
        let n_edges = edge_var.len();
        Decoder {
            edge_var,
            edge_lo,
            msgs: vec![0.0; n_edges],
            total: [0.0; N],
            hard: [0; N],
            vals: [0.0; 8],
            acc: [0.0; 8],
            aux: [0.0; 8],
            newm: [0.0; 8],
        }
    }

    fn syndrome_weight(&self, cw: &[u8; N]) -> usize {
        let mut w = 0;
        for c in 0..M {
            let (lo, hi) = (self.edge_lo[c] as usize, self.edge_lo[c + 1] as usize);
            let mut s = 0u8;
            for e in lo..hi {
                s ^= cw[self.edge_var[e] as usize];
            }
            w += s as usize;
        }
        w
    }

    fn spa_messages(&mut self, d: usize, alpha: f32) {
        let (vals, acc, aux) = (&self.vals, &mut self.acc, &mut self.aux);
        for a in acc[..d].iter_mut() {
            *a = 0.0;
        }
        for j in 0..d {
            let y = vals[j];
            if j == 0 {
                for a in acc[1..d].iter_mut() {
                    *a = y;
                }
                continue;
            }
            for i in 0..d {
                aux[i] = box_plus(acc[i], y);
            }
            if j == 1 {
                acc[2..d].copy_from_slice(&aux[2..d]);
                acc[0] = y;
            } else {
                for i in 0..d {
                    if i != j {
                        acc[i] = aux[i];
                    }
                }
            }
        }
        for i in 0..d {
            self.newm[i] = (acc[i] * alpha).clamp(-20.0, 20.0);
        }
    }

    fn sweep(&mut self, s: &Schedule, pinned: Option<&ApMask>) {
        let alpha = s.alpha as f32;
        let beta = s.beta as f32;
        let c_old = (1.0f64 - s.damping) as f32;
        let c_new = s.damping as f32;
        let spa = s.mode == Mode::Spa;
        for idx in 0..M {
            let c = if s.reverse { M - 1 - idx } else { idx };
            let lo = self.edge_lo[c] as usize;
            let d = self.edge_lo[c + 1] as usize - lo;
            let (mut min1, mut min2) = (999_999.0f32, 999_999.0f32);
            let mut min1_idx = usize::MAX;
            let mut prod_sign = 1.0f32;
            for i in 0..d {
                let v = self.edge_var[lo + i] as usize;
                let val = self.total[v] - self.msgs[lo + i];
                self.vals[i] = val;
                prod_sign *= if val >= 0.0 { 1.0 } else { -1.0 };
                let mag = val.abs();
                if mag < min1 {
                    min2 = min1;
                    min1 = mag;
                    min1_idx = i;
                } else if mag < min2 {
                    min2 = mag;
                }
            }
            if spa {
                self.spa_messages(d, alpha);
            }
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
                if pinned.is_none_or(|p| !p[v]) {
                    self.total[v] += diff;
                }
            }
        }
    }

    /// The belief-propagation cascade alone (reference-exact, including the trellis exit).
    pub fn decode_bp(&mut self, input: &Llrs, pinned: Option<&ApMask>) -> BpOutcome {
        let pinned = pinned.filter(|p| p.iter().any(|&b| b));
        for i in 0..N {
            self.hard[i] = (input[i] < 0.0) as u8;
        }
        if crc_matches(&self.hard) && self.syndrome_weight(&self.hard) == 0 {
            return BpOutcome::Success(LdpcResult {
                success: true,
                info: info_of(&self.hard),
                iterations: 1,
                method: Some(DecodeMethod::HardDecision),
                min_syndrome: 0,
            });
        }
        let mut min_syn = 999usize;
        let mut total_iters = 0usize;
        let mut best_cw = [0u8; N];
        let mut best_total = *input;
        for (si, s) in SCHEDULES.iter().enumerate() {
            let sched_no = si as u8 + 1;
            self.total = *input;
            if s.mode == Mode::Dither {
                let dv = dither_vector(input);
                for i in 0..N {
                    self.total[i] = ((self.total[i] as f64) + dv[i]) as f32;
                }
                if let Some(p) = pinned {
                    for i in 0..N {
                        if p[i] {
                            self.total[i] = input[i];
                        }
                    }
                }
            }
            for m in self.msgs.iter_mut() {
                *m = 0.0;
            }
            for _ in 0..s.iters.min(LDPC_MAX_ITERATIONS) {
                total_iters += 1;
                self.sweep(s, pinned);
                for i in 0..N {
                    self.hard[i] = (self.total[i] < 0.0) as u8;
                }
                let w = self.syndrome_weight(&self.hard);
                if w < min_syn {
                    min_syn = w;
                    best_cw = self.hard;
                    best_total = self.total;
                }
                let crc_ok = crc_matches(&self.hard);
                if w == 0 && crc_ok {
                    return BpOutcome::Success(LdpcResult {
                        success: true,
                        info: info_of(&self.hard),
                        iterations: total_iters,
                        method: Some(DecodeMethod::BeliefPropagation(sched_no)),
                        min_syndrome: 0,
                    });
                }
                if crc_ok {
                    let ira = encode_info(&self.hard[..K]);
                    let corr = correlation(&ira, input);
                    let diff = (0..N).filter(|&i| ira[i] != self.hard[i]).count();
                    if corr > 0.0 && diff <= 12 {
                        return BpOutcome::Success(LdpcResult {
                            success: true,
                            info: info_of(&self.hard),
                            iterations: total_iters,
                            method: Some(DecodeMethod::Trellis(sched_no)),
                            min_syndrome: w,
                        });
                    }
                }
            }
            if min_syn == 0 && crc_matches(&best_cw) {
                return BpOutcome::Success(LdpcResult {
                    success: true,
                    info: info_of(&best_cw),
                    iterations: total_iters,
                    method: Some(DecodeMethod::BeliefPropagation(sched_no)),
                    min_syndrome: 0,
                });
            }
        }
        BpOutcome::Failure(BpFailure { best_cw, best_total, min_syndrome: min_syn, iterations: total_iters })
    }

    /// The corrected OSD (SPEC.md 7.1): flips among the 14 least reliable of all 77
    /// information bits and accepts only a candidate whose CRC field matches its payload.
    pub fn osd(fail: &BpFailure, input: &Llrs, pinned: Option<&ApMask>) -> Option<([u8; K], u8)> {
        if fail.min_syndrome > OSD_MAX_SYNDROME {
            return None;
        }
        let mut ranked: Vec<usize> = (0..K).filter(|&i| pinned.is_none_or(|p| !p[i])).collect();
        ranked.sort_by(|&a, &b| fail.best_total[a].abs().partial_cmp(&fail.best_total[b].abs()).unwrap_or(std::cmp::Ordering::Equal));
        let test = &ranked[..ranked.len().min(OSD_TEST_BITS)];
        let base: [u8; K] = info_of(&fail.best_cw);
        let mut best: Option<([u8; K], u8)> = None;
        let mut max_corr = 0.0f64;
        let mut eval = |cand: &[u8; K], order: u8| {
            if !crc_matches(cand) {
                return;
            }
            let cw = encode_info(cand);
            let corr = correlation(&cw, input) as f64;
            let diff = (0..N).filter(|&i| cw[i] != fail.best_cw[i]).count();
            if corr > OSD_MIN_CORRELATION && corr > max_corr && diff <= OSD_MAX_DISTANCE {
                max_corr = corr;
                best = Some((*cand, order));
            }
        };
        eval(&base, 0);
        for i in 0..test.len() {
            let mut c1 = base;
            c1[test[i]] ^= 1;
            eval(&c1, 1);
        }
        for i in 0..test.len() {
            for j in (i + 1)..test.len() {
                let mut c2 = base;
                c2[test[i]] ^= 1;
                c2[test[j]] ^= 1;
                eval(&c2, 2);
            }
        }
        best
    }

    /// Full decode: the BP cascade, then the corrected OSD.
    pub fn decode(&mut self, input: &Llrs, pinned: Option<&ApMask>) -> LdpcResult {
        match self.decode_bp(input, pinned) {
            BpOutcome::Success(r) => r,
            BpOutcome::Failure(f) => match Self::osd(&f, input, pinned) {
                Some((info, order)) => LdpcResult {
                    success: true,
                    info,
                    iterations: f.iterations,
                    method: Some(DecodeMethod::Osd(order)),
                    min_syndrome: f.min_syndrome,
                },
                None => LdpcResult {
                    success: false,
                    info: info_of(&f.best_cw),
                    iterations: f.iterations,
                    method: None,
                    min_syndrome: f.min_syndrome,
                },
            },
        }
    }
}

// Silence an unused-import warning when CHECK_TO_INFO is only used through check_vars.
const _: usize = CHECK_TO_INFO.len();

#[cfg(test)]
mod tests {
    use super::*;
    use z30_protocol::ldpc::encode_payload;

    fn clean_llrs(cw: &[u8; N], mag: f32) -> Llrs {
        let mut l = [0f32; N];
        for i in 0..N {
            l[i] = if cw[i] == 0 { mag } else { -mag };
        }
        l
    }

    #[test]
    fn clean_codeword_decodes_from_the_hard_decision() {
        let payload: Vec<u8> = (0..63).map(|i| (i % 3 == 0) as u8).collect();
        let cw = encode_payload(&payload);
        let r = Decoder::new().decode(&clean_llrs(&cw, 4.0), None);
        assert!(r.success);
        assert_eq!(r.method, Some(DecodeMethod::HardDecision));
        assert_eq!(&r.info[..63], &payload[..]);
    }

    #[test]
    fn corrects_errors_by_belief_propagation() {
        let payload: Vec<u8> = (0..63).map(|i| (i % 5 == 1) as u8).collect();
        let cw = encode_payload(&payload);
        let mut l = clean_llrs(&cw, 2.0);
        for &i in &[3usize, 40, 77, 100, 150, 200] {
            l[i] = -l[i] * 0.5;
        }
        let r = Decoder::new().decode(&l, None);
        assert!(r.success);
        assert_eq!(&r.info[..63], &payload[..]);
    }

    #[test]
    fn noise_does_not_decode_and_is_deterministic() {
        let mut dec = Decoder::new();
        let mut state = 12345u64;
        for _ in 0..5 {
            let mut l = [0f32; N];
            for x in l.iter_mut() {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                *x = ((state >> 33) as f32 / (1u64 << 31) as f32 - 0.5) * 4.0;
            }
            let a = dec.decode(&l, None);
            let b = dec.decode(&l, None);
            assert_eq!(a.success, b.success);
            assert_eq!(a.info, b.info);
            assert_eq!(a.iterations, b.iterations);
        }
    }
}
