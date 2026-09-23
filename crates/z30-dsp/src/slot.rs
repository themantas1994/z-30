//! `decode_slot`: the receiver's single entry point. The desktop engine, the CLI and the Python
//! research harness (through `z30-py`) all call this function, so the receiver that is
//! benchmarked is the receiver that ships by construction rather than by policy.

use crate::ap::{build_ladder, decode_with_ap, ApContext};
use crate::baseband::{Plans, SlotSpectrum, BB_DECIMATION, SLOT_SAMPLES, SLOT_ZERO_INDEX};
use crate::demod::{FrameSpectra, SymbolFft};
use crate::ldpc::{DecodeMethod, Decoder};
use crate::sic::{subtract, SicParams};
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
    /// SNR in 2500 Hz, measured on the decoded frame's own tones.
    pub snr_db: f64,
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
    /// Decodes of a message already decoded in an earlier pass or candidate (dropped).
    pub duplicates: usize,
    /// Suppression achieved on each subtraction of this pass, dB.
    pub suppression_db: Vec<f64>,
    /// Wall-clock time of the pass.
    pub elapsed_ms: f64,
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

    fn try_candidate(&self, spec: &SlotSpectrum, cand: &Candidate, cfg: &RxConfig, pass: u8, dec: &mut Decoder) -> Option<Attempt> {
        let (bb, centre) = spec.baseband(&self.plans, cand.f0_hz);
        let coarse = ((SLOT_ZERO_INDEX as f64 + cand.dt_sec * DSP_RATE_HZ) / BB_DECIMATION as f64).round() as usize;
        let (zero, drifted) = fine_sync(&bb, &self.tones, coarse, cfg.max_drift_hz);
        let zero_spectra = FrameSpectra::new(&bb, &self.symfft, &zero);
        let bin_noise = 2.0 * zero_spectra.noise_sigma2() * z30_protocol::SYNC_SYMBOLS as f64;
        let best_metric = drifted.map_or(zero.metric, |d| d.metric.max(zero.metric));
        if best_metric / bin_noise < cfg.min_fine_sync {
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
            if !r.result.success {
                continue;
            }
            let Some(message) = unpack_info(&r.result.info) else { continue };
            let cw = encode_info(&r.result.info);
            let symbols = codeword_to_symbols(&cw);
            let start_sample = (sync.start * BB_DECIMATION) as i64;
            return Some(Attempt {
                decode: Decode {
                    message,
                    info: r.result.info,
                    snr_db: spectra.snr_db(&symbols),
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
        let mut residual = samples.to_vec();
        // Regions subtracted in the previous pass: (f0, start). Later passes only look there,
        // because everywhere else the residual is unchanged and a deterministic decoder would
        // fail on it exactly as before.
        let mut changed: Option<Vec<(f64, i64)>> = None;
        for pass in 1..=cfg.passes.clamp(1, 3) {
            let t_pass = Instant::now();
            let spec = SlotSpectrum::new(&self.plans, &residual);
            let sg = Spectrogram::new(&residual, cfg.band_lo_hz, cfg.band_hi_hz);
            let mut cands = sg.candidates(cfg.sync_threshold, usize::MAX, cfg.band_lo_hz, cfg.band_hi_hz);
            if let Some(regions) = &changed {
                // A frame lasts 24 of the window's 27 s, so a subtraction changes the residual at
                // every DT; only frequency decides whether a candidate can have changed.
                cands.retain(|c| regions.iter().any(|&(f, _)| (c.f0_hz - f).abs() < 60.0));
            }
            cands.truncate(cfg.max_candidates);
            let attempts = self.run_candidates(&spec, &cands, cfg, pass);
            let mut stats = PassStats { candidates: cands.len(), ..Default::default() };
            let mut new: Vec<Attempt> = Vec::new();
            for a in attempts.into_iter().flatten() {
                let dup = report.decodes.iter().chain(new.iter().map(|n| &n.decode)).any(|d| d.info == a.decode.info);
                if dup {
                    stats.duplicates += 1;
                } else {
                    new.push(a);
                }
            }
            let mut regions = Vec::new();
            if pass < cfg.passes {
                for a in &new {
                    let s = subtract(&mut residual, &self.modulator, &a.symbols, a.f0_abs, a.decode.drift_hz, a.start_sample, &cfg.sic);
                    stats.suppression_db.push(s.suppression_db);
                    regions.push((a.f0_abs, a.start_sample));
                }
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

    #[cfg(feature = "parallel")]
    fn run_candidates(&self, spec: &SlotSpectrum, cands: &[Candidate], cfg: &RxConfig, pass: u8) -> Vec<Option<Attempt>> {
        use rayon::prelude::*;
        // Order is preserved by collect(), and each candidate is a pure function of its input, so
        // the report is identical at any thread count.
        cands.par_iter().map_init(Decoder::new, |dec, c| self.try_candidate(spec, c, cfg, pass, dec)).collect()
    }

    #[cfg(not(feature = "parallel"))]
    fn run_candidates(&self, spec: &SlotSpectrum, cands: &[Candidate], cfg: &RxConfig, pass: u8) -> Vec<Option<Attempt>> {
        let mut dec = Decoder::new();
        cands.iter().map(|c| self.try_candidate(spec, c, cfg, pass, &mut dec)).collect()
    }
}

/// Convenience wrapper: builds a `Receiver` and decodes one slot.
pub fn decode_slot(samples: &[f32], cfg: &RxConfig) -> SlotReport {
    Receiver::new().decode_slot(samples, cfg)
}
