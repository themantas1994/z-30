//! `decode_slot`: the receiver's single entry point. The desktop engine, the CLI station and the
//! benchmark suite all call this function, so the receiver that is benchmarked is the receiver
//! that ships by construction rather than by policy.

use crate::ap::{build_ladder, decode_with_ap, ApContext};
use crate::baseband::{Plans, SlotSpectrum, BB_DECIMATION, SLOT_SAMPLES, SLOT_ZERO_INDEX};
use crate::demod::{placed_replica, FrameSpectra, SymbolFft};
use crate::ldpc::{DecodeMethod, Decoder};
use crate::sic::{self, SicParams};
use crate::sync::{fine_sync, Candidate, Spectrogram, ToneTable};
use crate::DSP_RATE_HZ;
use std::time::Instant;
use z30_protocol::codec::{unpack_info, DecodedMessage};
use z30_protocol::gfsk::Modulator;
use z30_protocol::ldpc::encode_info;
use z30_protocol::symbols::codeword_to_symbols;
use z30_protocol::{K, TOTAL_SYMBOLS};

/// Receiver configuration. Defaults are the benchmark-validated ones.
#[derive(Clone, Debug)]
pub struct RxConfig {
    /// Lowest audio frequency searched, Hz (tone 0 may not be below it).
    pub band_lo_hz: f64,
    /// Highest audio frequency searched, Hz (tone 15 may not be above it).
    pub band_hi_hz: f64,
    /// Candidates decoded per pass, strongest first.
    pub max_candidates: usize,
    /// Minimum normalised Costas sync metric for a candidate (about 1.0 on noise).
    pub sync_threshold: f64,
    /// Decode passes: 1 disables SIC; up to 3.
    pub passes: u8,
    /// Largest total linear drift across the frame searched, Hz. 0 disables the drift search.
    pub max_drift_hz: f64,
    /// The drift hypothesis is decoded (after the zero-drift one fails) only if its sync metric
    /// exceeds the zero-drift metric by this factor. On zero-drift frames and on noise the
    /// drift search's best is within a few percent of the zero-drift metric (it is the maximum
    /// over more hypotheses); a real 2-4 Hz drift raises it 5-40%.
    pub drift_gain: f64,
    /// Minimum fine-sync metric - mean sync-tone energy over the noise energy of one tone bin -
    /// before a candidate is handed to the LDPC decoder. Noise candidates score about 2 to 2.7;
    /// frames at -24 dB (below the decode threshold) score 3 to 5. A failing LDPC cascade costs
    /// ~12 ms, so this is where the receiver's time goes on a quiet band.
    pub min_fine_sync: f64,
    /// Per-tone interference whitening in the demodulator (see `FrameSpectra::tone_sigma2`).
    pub whiten: bool,
    /// A priori decoding context. `None` (the default) is the ordinary decoder.
    pub ap: Option<ApContext>,
    /// SIC tuning.
    pub sic: SicParams,
}

impl Default for RxConfig {
    fn default() -> Self {
        RxConfig {
            band_lo_hz: 200.0,
            band_hi_hz: 2800.0,
            max_candidates: 50,
            sync_threshold: 1.5,
            passes: 3,
            max_drift_hz: 4.0,
            drift_gain: 1.05,
            min_fine_sync: 2.5,
            whiten: true,
            ap: None,
            sic: SicParams::default(),
        }
    }
}

/// One decoded frame.
#[derive(Clone, Debug)]
pub struct Decode {
    /// The message as received (fields may be unrepresentable; see `z30_protocol::codec`).
    pub message: DecodedMessage,
    /// The 77 information bits.
    pub info: [u8; K],
    /// SNR in 2500 Hz, measured on the decoded frame against the noise left when its own
    /// replica is removed (`FrameSpectra::snr_db`). `None` = no positive signal estimate: not
    /// measured, and never replaced by a floor value.
    pub snr_db: Option<f64>,
    /// Frame start relative to the slot boundary, seconds.
    pub dt_sec: f64,
    /// Tone-0 audio frequency, Hz.
    pub freq_hz: f64,
    /// Total linear drift across the frame, Hz (0 when the zero-drift hypothesis decoded).
    pub drift_hz: f64,
    /// Normalised coarse sync metric.
    pub sync: f64,
    /// LDPC iterations (cumulative over AP attempts).
    pub iterations: usize,
    /// How the LDPC stage succeeded.
    pub method: DecodeMethod,
    /// 0 = ordinary; 1..6 = recovered by that AP hypothesis (label it, never hide it).
    pub ap_type: u8,
    /// SIC pass that found it (1-based).
    pub pass: u8,
}

/// Per-pass statistics.
#[derive(Clone, Debug, Default)]
pub struct PassStats {
    /// Candidates attempted.
    pub candidates: usize,
    /// New decodes.
    pub decoded: usize,
    /// LDPC decodes run (every sync hypothesis and every AP hypothesis counts one).
    pub ldpc_attempts: usize,
    /// Decodes of a message already decoded in an earlier pass or candidate (dropped).
    pub duplicates: usize,
    /// Suppression achieved on each subtraction of this pass, dB.
    pub suppression_db: Vec<f64>,
    /// Wall-clock time of the pass.
    pub elapsed_ms: f64,
    /// Of which: slot FFT and spectrogram, ms.
    pub spectra_ms: f64,
    /// Of which: candidates (fine sync, demodulation, LDPC, AP), ms.
    pub candidates_ms: f64,
    /// Of which: SIC, ms.
    pub sic_ms: f64,
}

/// Everything decode_slot learned about one slot.
#[derive(Clone, Debug, Default)]
pub struct SlotReport {
    /// Unique decodes, in the order found.
    pub decodes: Vec<Decode>,
    /// One entry per pass run.
    pub passes: Vec<PassStats>,
    /// Total wall-clock time.
    pub elapsed_ms: f64,
    /// Samples of the window that were NaN or infinite. Such a sample is not a measurement, and
    /// one of them turns every bin of the slot FFT into NaN, so each was decoded as 0.0 - the
    /// value the slot store gives audio it does not have. Non-zero means the audio source
    /// delivered garbage for that many samples.
    pub non_finite_samples: usize,
}

/// Reusable per-thread resources: FFT plans, modulator, tone table. Building these is the only
/// allocation-heavy work; a `Receiver` can decode any number of slots.
pub struct Receiver {
    plans: Plans,
    tones: ToneTable,
    symfft: SymbolFft,
    modulator: Modulator,
}

impl Default for Receiver {
    fn default() -> Self {
        Self::new()
    }
}

struct Attempt {
    decode: Decode,
    symbols: [u8; TOTAL_SYMBOLS],
    start_sample: i64,
    f0_abs: f64,
}

impl Receiver {
    /// Plans everything once.
    pub fn new() -> Self {
        Receiver {
            plans: Plans::new(),
            tones: ToneTable::new(),
            symfft: SymbolFft::new(),
            modulator: Modulator::new(DSP_RATE_HZ).expect("6 kHz is valid"),
        }
    }

    fn try_candidate(
        &self,
        spec: &SlotSpectrum,
        cand: &Candidate,
        cfg: &RxConfig,
        pass: u8,
        dec: &mut Decoder,
    ) -> (Option<Attempt>, usize) {
        let mut attempts = 0usize;
        let r = self.try_candidate_inner(spec, cand, cfg, pass, dec, &mut attempts);
        (r, attempts)
    }

    fn try_candidate_inner(
        &self,
        spec: &SlotSpectrum,
        cand: &Candidate,
        cfg: &RxConfig,
        pass: u8,
        dec: &mut Decoder,
        attempts: &mut usize,
    ) -> Option<Attempt> {
        let (bb, centre) = spec.baseband(&self.plans, cand.f0_hz);
        let coarse = ((SLOT_ZERO_INDEX as f64 + cand.dt_sec * DSP_RATE_HZ) / BB_DECIMATION as f64).round() as usize;
        let (zero, drifted) = fine_sync(&bb, &self.tones, coarse, cfg.max_drift_hz);
        let zero_spectra = FrameSpectra::new(&bb, &self.symfft, &zero);
        let bin_noise = 2.0 * zero_spectra.noise_sigma2() * z30_protocol::SYNC_SYMBOLS as f64;
        let best_metric = drifted.map_or(zero.metric, |d| d.metric.max(zero.metric));
        // Refuses a metric that is not a number too: finite samples large enough to overflow the
        // f32 spectra leave NaN here, which `<` alone would let through to the LDPC decoder.
        let fine = best_metric / bin_noise;
        if fine.is_nan() || fine < cfg.min_fine_sync {
            return None;
        }
        let mut hypotheses = vec![(zero, Some(zero_spectra))];
        if let Some(d) = drifted {
            // A different hypothesis, clearly better: worth one more decode. The CRC arbitrates.
            if d.drift_hz != 0.0 && d.metric > cfg.drift_gain * zero.metric {
                hypotheses.push((d, None));
            }
        }
        for (sync, spectra) in hypotheses {
            let spectra = spectra.unwrap_or_else(|| FrameSpectra::new(&bb, &self.symfft, &sync));
            let llr = spectra.llrs_with(cfg.whiten);
            let f0_abs = centre + sync.df_hz;
            let hyps = cfg.ap.as_ref().map(|ctx| build_ladder(ctx, Some(f0_abs))).unwrap_or_default();
            let r = decode_with_ap(dec, &llr, &hyps);
            *attempts += 1 + r.hypotheses_tried;
            if !r.result.success {
                continue;
            }
            let Some(message) = unpack_info(&r.result.info) else { continue };
            let cw = encode_info(&r.result.info);
            let symbols = codeword_to_symbols(&cw);
            // Fine sync's timing, then the replica fit's: the whole decoded frame placed by least
            // squares, to one 6 kHz sample. Fine sync alone reads about 2.9 ms late (the audit's
            // +2.8 ms DT bias); the fit is what the reported DT and the SIC start from.
            let grid = (sync.start * BB_DECIMATION) as i64;
            let coarse_start = ((sync.start as f64 + sync.frac) * BB_DECIMATION as f64).round() as i64;
            let (replica, offset) = placed_replica(&spectra, &self.symfft, &self.modulator, &symbols, coarse_start - grid);
            let start_sample = grid + offset;
            return Some(Attempt {
                decode: Decode {
                    message,
                    info: r.result.info,
                    snr_db: spectra.snr_db(&replica),
                    dt_sec: (start_sample as f64 - SLOT_ZERO_INDEX as f64) / DSP_RATE_HZ,
                    freq_hz: f0_abs,
                    drift_hz: sync.drift_hz,
                    sync: cand.sync,
                    iterations: r.total_iterations,
                    method: r.result.method.expect("success has a method"),
                    ap_type: r.ap_type,
                    pass,
                },
                symbols,
                start_sample,
                f0_abs,
            });
        }
        None
    }

    /// Decodes one slot. `samples` is the 27 s window [slot - 1.5 s, slot + 25.5 s] at 6 kHz.
    pub fn decode_slot(&self, samples: &[f32], cfg: &RxConfig) -> SlotReport {
        assert_eq!(samples.len(), SLOT_SAMPLES, "decode_slot takes the 27 s slot window at 6 kHz");
        let t_all = Instant::now();
        let mut report = SlotReport::default();
        // Silence for what is not a number: it adds no energy, no tone and no timing, so every
        // decode still comes from real samples and must pass the LDPC code and the CRC. Rejecting
        // the window instead would discard 27 s of good audio for one bad sample; clamping an
        // infinity to full scale would inject a broadband impulse into every bin.
        let mut non_finite = 0usize;
        let mut residual: Vec<f32> = samples
            .iter()
            .map(|&v| {
                if v.is_finite() {
                    v
                } else {
                    non_finite += 1;
                    0.0
                }
            })
            .collect();
        report.non_finite_samples = non_finite;
        // Regions subtracted in the previous pass: (f0, start). Later passes only look there,
        // because everywhere else the residual is unchanged and a deterministic decoder would
        // fail on it exactly as before.
        let mut changed: Option<Vec<(f64, i64)>> = None;
        for pass in 1..=cfg.passes.clamp(1, 3) {
            let t_pass = Instant::now();
            let spec = SlotSpectrum::new(&self.plans, &residual);
            let sg = Spectrogram::new(&residual, cfg.band_lo_hz, cfg.band_hi_hz);
            let mut cands = sg.candidates(cfg.sync_threshold, usize::MAX, cfg.band_lo_hz, cfg.band_hi_hz);
            let spectra_ms = t_pass.elapsed().as_secs_f64() * 1e3;
            if let Some(regions) = &changed {
                // A frame lasts 24 of the window's 27 s, so a subtraction changes the residual at
                // every DT; only frequency decides whether a candidate can have changed.
                cands.retain(|c| regions.iter().any(|&(f, _)| (c.f0_hz - f).abs() < 60.0));
                // What is left exactly where a decoded station was is that station's residue: it
                // can only decode as the station already decoded.
                cands.retain(|c| !report.decodes.iter().any(|d| (c.f0_hz - d.freq_hz).abs() <= 1.6 && (c.dt_sec - d.dt_sec).abs() <= 0.1));
            }
            cands.truncate(cfg.max_candidates);
            let t_cand = Instant::now();
            let attempts = self.run_candidates(&spec, &cands, cfg, pass);
            let mut stats = PassStats {
                candidates: cands.len(),
                spectra_ms,
                candidates_ms: t_cand.elapsed().as_secs_f64() * 1e3,
                ..Default::default()
            };
            stats.ldpc_attempts = attempts.iter().map(|a| a.1).sum();
            let mut new: Vec<Attempt> = Vec::new();
            for a in attempts.into_iter().filter_map(|a| a.0) {
                let dup = report.decodes.iter().chain(new.iter().map(|n| &n.decode)).any(|d| d.info == a.decode.info);
                if dup {
                    stats.duplicates += 1;
                } else {
                    new.push(a);
                }
            }
            let mut regions = Vec::new();
            if pass < cfg.passes {
                let t_sic = Instant::now();
                // Timing searches in parallel against this pass's residual; fits and
                // subtractions in decode order, each on what the previous one left.
                let plans = self.plan_subtractions(&residual, &new, cfg);
                for (a, p) in new.iter().zip(&plans) {
                    let s = sic::apply(&mut residual, p);
                    stats.suppression_db.push(s.suppression_db);
                    regions.push((a.f0_abs, a.start_sample));
                }
                stats.sic_ms = t_sic.elapsed().as_secs_f64() * 1e3;
            }
            stats.decoded = new.len();
            report.decodes.extend(new.into_iter().map(|a| a.decode));
            stats.elapsed_ms = t_pass.elapsed().as_secs_f64() * 1e3;
            report.passes.push(stats);
            if regions.is_empty() {
                break;
            }
            changed = Some(regions);
        }
        report.elapsed_ms = t_all.elapsed().as_secs_f64() * 1e3;
        report
    }

    fn plan_subtractions(&self, residual: &[f32], new: &[Attempt], cfg: &RxConfig) -> Vec<sic::Planned> {
        use rayon::prelude::*;
        new.par_iter()
            .map(|a| sic::plan(residual, &self.modulator, &a.symbols, a.f0_abs, a.decode.drift_hz, a.start_sample, &cfg.sic))
            .collect()
    }

    fn run_candidates(&self, spec: &SlotSpectrum, cands: &[Candidate], cfg: &RxConfig, pass: u8) -> Vec<(Option<Attempt>, usize)> {
        use rayon::prelude::*;
        // Order is preserved by collect(), and each candidate is a pure function of its input, so
        // the report is identical at any thread count.
        cands.par_iter().map_init(Decoder::new, |dec, c| self.try_candidate(spec, c, cfg, pass, dec)).collect()
    }
}

/// Convenience wrapper: builds a `Receiver` and decodes one slot.
pub fn decode_slot(samples: &[f32], cfg: &RxConfig) -> SlotReport {
    Receiver::new().decode_slot(samples, cfg)
}

#[cfg(test)]
mod tests {
    //! Input the receiver must survive (AGENTS.md section 5: panic-free on arbitrary input). One
    //! NaN sample made every bin of the slot FFT NaN, and the noise median's
    //! `partial_cmp().unwrap()` (demod.rs) then panicked the decoder; finite samples whose power
    //! overflows f32 panicked the coarse search's median (sync.rs) the same way.
    use super::*;
    use crate::baseband::SLOT_SAMPLES;
    use z30_channel::{random_station, rng, synthesize, Band};
    use z30_protocol::PAYLOAD_BITS;

    const BAD: [f32; 3] = [f32::NAN, f32::INFINITY, f32::NEG_INFINITY];

    /// One station at -10 dB in noise: far enough above threshold that a few samples of silence
    /// cannot cost the decode.
    fn one_station() -> (Vec<f32>, [u8; PAYLOAD_BITS]) {
        let (payload, st) = random_station(&mut rng(4242), 1210.0, 0.2, -10.0);
        (synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(4243)), payload)
    }

    fn decoded(rep: &SlotReport, payload: &[u8; PAYLOAD_BITS]) -> bool {
        rep.decodes.iter().any(|d| d.info[..PAYLOAD_BITS] == payload[..])
    }

    /// What each decode reports, bit for bit.
    type Fingerprint = (Vec<u8>, Option<u64>, u64, u64, u64, u8);

    fn fingerprint(rep: &SlotReport) -> Vec<Fingerprint> {
        rep.decodes
            .iter()
            .map(|d| (d.info.to_vec(), d.snr_db.map(f64::to_bits), d.dt_sec.to_bits(), d.freq_hz.to_bits(), d.drift_hz.to_bits(), d.pass))
            .collect()
    }

    #[test]
    fn a_nan_or_infinite_sample_at_the_window_start_middle_or_end_neither_panics_nor_costs_the_decode() {
        let rx = Receiver::new();
        let (x, payload) = one_station();
        for at in [0, SLOT_SAMPLES / 2, SLOT_SAMPLES - 1] {
            for bad in BAD {
                let mut y = x.clone();
                y[at] = bad;
                let rep = rx.decode_slot(&y, &RxConfig::default());
                assert!(decoded(&rep, &payload), "{bad} at {at}: the station was lost");
                assert_eq!(rep.non_finite_samples, 1, "{bad} at {at}");
            }
        }
    }

    #[test]
    fn non_finite_samples_are_decoded_exactly_as_silence_and_counted() {
        let rx = Receiver::new();
        let (x, payload) = one_station();
        // 50 ms inside the frame, every kind mixed.
        let burst = 60_000..60_300;
        let (mut bad, mut silent) = (x.clone(), x);
        for (k, i) in burst.clone().enumerate() {
            bad[i] = BAD[k % 3];
            silent[i] = 0.0;
        }
        let a = rx.decode_slot(&bad, &RxConfig::default());
        let b = rx.decode_slot(&silent, &RxConfig::default());
        assert!(decoded(&a, &payload));
        assert_eq!(fingerprint(&a), fingerprint(&b));
        assert_eq!((a.non_finite_samples, b.non_finite_samples), (burst.len(), 0));
    }

    #[test]
    fn the_receiver_carries_on_after_a_corrupt_window_and_decodes_the_next_one_unchanged() {
        let (x, payload) = one_station();
        let fresh = Receiver::new().decode_slot(&x, &RxConfig::default());
        let rx = Receiver::new();
        // One NaN: the coarse search still finds candidates, so the demodulator meets the NaN
        // spectra (scattering many bad samples zeroes the whole sync map and never gets there).
        let mut y = x.clone();
        y[SLOT_SAMPLES / 2] = f32::NAN;
        let _ = rx.decode_slot(&y, &RxConfig::default());
        let next = rx.decode_slot(&x, &RxConfig::default());
        assert!(decoded(&next, &payload));
        assert_eq!(fingerprint(&next), fingerprint(&fresh));
    }

    #[test]
    fn a_window_of_nothing_but_nan_decodes_nothing_and_says_so() {
        let rep = Receiver::new().decode_slot(&vec![f32::NAN; SLOT_SAMPLES], &RxConfig::default());
        assert!(rep.decodes.is_empty());
        assert_eq!(rep.non_finite_samples, SLOT_SAMPLES);
    }

    #[test]
    fn a_silent_window_decodes_nothing() {
        let rep = Receiver::new().decode_slot(&vec![0.0; SLOT_SAMPLES], &RxConfig::default());
        assert!(rep.decodes.is_empty());
        assert_eq!(rep.non_finite_samples, 0);
    }

    #[test]
    fn finite_samples_too_large_for_the_f32_spectra_do_not_panic() {
        // Finite, so nothing is replaced, but the spectra overflow to infinity and NaN inside:
        // every ordering and gate on the way has to hold up anyway.
        let rx = Receiver::new();
        let (x, _) = one_station();
        for scale in [1e20f64, 1e30, 1e300] {
            let y: Vec<f32> = x.iter().map(|&v| (v as f64 * scale).clamp(f32::MIN as f64, f32::MAX as f64) as f32).collect();
            let rep = rx.decode_slot(&y, &RxConfig::default());
            assert_eq!(rep.non_finite_samples, 0, "scale {scale}");
        }
    }

    // A window of the wrong length is a caller's bug, not input: decoded, it would put DT = 0 in
    // the wrong place. It is refused loudly, never decoded misaligned.
    #[test]
    #[should_panic(expected = "decode_slot takes the 27 s slot window at 6 kHz")]
    fn an_empty_window_is_refused_as_the_wrong_length() {
        Receiver::new().decode_slot(&[], &RxConfig::default());
    }

    #[test]
    #[should_panic(expected = "decode_slot takes the 27 s slot window at 6 kHz")]
    fn a_short_window_is_refused_as_the_wrong_length() {
        Receiver::new().decode_slot(&vec![0.0; SLOT_SAMPLES - 1], &RxConfig::default());
    }
}
