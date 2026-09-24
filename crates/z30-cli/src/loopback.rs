//! `z30 --loopback-test`: the SOFTWARE loopback. A known frame goes through the production
//! transmit synthesis (`Message::frame` -> the gate's `VerifiedFrame` type -> `runtime::tx_audio`),
//! is handed as device-rate samples (48 kHz and 44.1 kHz) to the production receive pipeline
//! (`RxPipeline`: resampler, sample clock, slot scheduler) and decoded by `decode_slot`. The
//! "cable" is a `Vec<f32>` in memory.
//!
//! What it measures - from the received window, nothing assumed:
//!
//! - whether the frame decoded, and anything else that decoded (a false decode);
//! - DT against the slot boundary, and against the instant the frame was placed;
//! - frequency error, reported SNR against the SNR the noise was added at, the sample-clock
//!   model's estimate;
//! - the received frame's 99% and -40 dB occupied bandwidth (Welch, stated parameters);
//! - the peak level (clipping).
//!
//! It cannot reach a transmitter. This module has no audio output, no PTT line, no rig
//! control and no `z30-io` in it at all - not a check that could be skipped, but nothing to
//! call - and `tests/loopback_isolation.rs` fails the build's tests if any of them is added.
//! The previous `--loopback-test` played the frame through the configured sound card with no
//! transmit gate in front of it, so a radio on VOX would have radiated it with no callsign or
//! band-plan check (2026-09-24 post-remediation audit, N-04). Playing audio through a real
//! sound card is now the separately named `--audio-loopback-test` (`audio_loopback.rs`), which
//! refuses to run with any PTT method or rig control configured.
//!
//! The result says `source: software-loopback`. It is software evidence about the transmit
//! synthesis and receive chain, not about any sound card, cable or radio: NOT HARDWARE VALIDATED.

use rand::Rng;
use rustfft::num_complex::Complex32;
use rustfft::FftPlanner;
use serde_json::{json, Value};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};
use z30_engine::engine::{TxKind, TxPlan};
use z30_engine::pipeline::{AudioBlock, RxPipeline};
use z30_engine::slots::{slot_start, SlotEvent};
use z30_protocol::codec::Message;

/// Tone-0 frequency the test frame is sent at.
pub const TEST_F0_HZ: f64 = 1500.0;
/// Message sent. Q0TST has the standard form v1 carries but a Q prefix, which the ITU never
/// allocates as a station callsign (the Q series is reserved for Q codes): the test frame cannot
/// be anyone's identification, even if it were radiated by mistake.
pub const TEST_MESSAGE: &str = "CQ Q0TST FN31";
/// Welch parameters for the bandwidth measurement (2026-09-24 audit, L-06: a -40 dB bandwidth
/// depends on the resolution bandwidth, so it is quoted with it).
pub const WELCH_NPERSEG: usize = 8192;
/// Welch hop (50% overlap).
pub const WELCH_HOP: usize = 4096;

/// Occupied bandwidth of `x` (6 kHz) around a z-30 frame with tone 0 at `f0`: (99% power
/// bandwidth, -40 dB bandwidth) in Hz, from a Hann-windowed Welch PSD, `WELCH_NPERSEG` points
/// with 50% overlap, over f0 - 150 Hz .. f0 + 200 Hz.
pub fn occupied_bandwidth(x: &[f32], f0: f64) -> (f64, f64) {
    let n = WELCH_NPERSEG;
    let fs = z30_dsp::DSP_RATE_HZ;
    let fft = FftPlanner::<f32>::new().plan_fft_forward(n);
    let win: Vec<f32> = (0..n).map(|i| (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos()) as f32).collect();
    let mut psd = vec![0.0f64; n / 2];
    let mut segs = 0;
    let mut start = 0;
    while start + n <= x.len() {
        let mut buf: Vec<Complex32> = x[start..start + n].iter().zip(&win).map(|(&v, &w)| Complex32::new(v * w, 0.0)).collect();
        fft.process(&mut buf);
        for (p, z) in psd.iter_mut().zip(&buf[..n / 2]) {
            *p += z.norm_sqr() as f64;
        }
        segs += 1;
        start += WELCH_HOP;
    }
    if segs == 0 {
        return (f64::NAN, f64::NAN);
    }
    let bin = |f: f64| ((f / fs * n as f64).round() as usize).min(n / 2 - 1);
    let (lo, hi) = (bin(f0 - 150.0), bin(f0 + 200.0));
    let band = &psd[lo..=hi];
    let total: f64 = band.iter().sum();
    let mut acc = 0.0;
    let (mut a, mut b) = (0, band.len() - 1);
    for (i, p) in band.iter().enumerate() {
        acc += p;
        if acc >= 0.005 * total {
            a = i;
            break;
        }
    }
    acc = 0.0;
    for (i, p) in band.iter().enumerate().rev() {
        acc += p;
        if acc >= 0.005 * total {
            b = i;
            break;
        }
    }
    let peak = band.iter().cloned().fold(0.0f64, f64::max);
    let above: Vec<usize> = band.iter().enumerate().filter(|(_, &p)| p >= peak * 1e-4).map(|(i, _)| i).collect();
    let df = fs / n as f64;
    let bw40 = match (above.first(), above.last()) {
        (Some(&x0), Some(&x1)) => (x1 - x0 + 1) as f64 * df,
        _ => f64::NAN,
    };
    ((b - a + 1) as f64 * df, bw40)
}

/// Analyses one recorded slot window. Pure, so it is tested without a sound card.
pub fn analyse(window: &[f32], report: &SlotReport, expected: &Message, predicted_dt_sec: f64) -> Value {
    let want = expected.frame().expect("the test message encodes and verifies").encoded().info;
    let hit = report.decodes.iter().find(|d| d.info == want);
    let others: Vec<String> = report.decodes.iter().filter(|d| d.info != want).map(|d| d.message.to_string()).collect();
    let frame = &window[z30_dsp::baseband::SLOT_ZERO_INDEX + 3_000..z30_dsp::baseband::SLOT_ZERO_INDEX + 141_000];
    let (bw99, bw40) = occupied_bandwidth(frame, TEST_F0_HZ);
    let peak = window.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    json!({
        "decoded": hit.is_some(),
        "other_decodes": others,
        "dt_sec": hit.map(|d| d.dt_sec),
        "dt_minus_prediction_ms": hit.map(|d| (d.dt_sec - predicted_dt_sec) * 1e3),
        "freq_hz": hit.map(|d| d.freq_hz),
        "freq_error_hz": hit.map(|d| d.freq_hz - TEST_F0_HZ),
        "snr_db": hit.and_then(|d| d.snr_db),
        "occupied_bandwidth_hz": { "p99": bw99, "minus_40_db": bw40,
            "method": format!("Welch PSD, Hann, {WELCH_NPERSEG} points at 6 kHz ({:.2} Hz bins), 50% overlap, over tone 0 - 150 Hz .. tone 0 + 200 Hz of the recorded frame", z30_dsp::DSP_RATE_HZ / WELCH_NPERSEG as f64) },
        "peak_level_dbfs": 20.0 * (peak.max(1e-9) as f64).log10(),
        "clipping_suspected": peak >= 0.999,
        "criteria": {
            "decoded": "the frame decodes and nothing else does",
            "timing": "|dt_minus_prediction_ms| <= 50",
            "frequency": "|freq_error_hz| <= 1.0",
            "bandwidth": "p99 <= 55 Hz and minus_40_db <= 80 Hz (the waveform alone measures ~49 / ~66 Hz)",
        },
        "pass": hit.is_some() && others.is_empty()
            && hit.is_some_and(|d| ((d.dt_sec - predicted_dt_sec) * 1e3).abs() <= 50.0 && (d.freq_hz - TEST_F0_HZ).abs() <= 1.0)
            && bw99 <= 55.0 && bw40 <= 80.0,
    })
}

/// Device rates the software loopback runs at: the two a sound card is most likely to use, so
/// the resampler in front of the receiver is exercised in both of its non-trivial ratios.
pub const SOFTWARE_RATES_HZ: [u32; 2] = [48_000, 44_100];
/// SNR (2500 Hz, SPEC.md section 10) of the white noise added in the software cable for the
/// decode, timing, frequency and SNR measurement: inside the SNR estimate's validated range.
pub const SOFTWARE_SNR_DB: f64 = 20.0;
/// Seed of that noise.
pub const SOFTWARE_NOISE_SEED: u64 = 20_260_924;

/// One software loopback at device rate `rate`, with white noise at `snr_db` (2500 Hz) or none.
/// Returns the analysis (`loopback::analyse`) with the run's own `pass`:
///
/// - with noise: the frame decodes, nothing else does, |DT| <= 20 ms, |f error| <= 0.5 Hz and
///   the reported SNR is within 1 dB of the SNR the noise was added at;
/// - without noise: the frame decodes and the occupied bandwidth at the receiver's 6 kHz input
///   (after the transmit synthesis and the resampler) is p99 <= 55 Hz, -40 dB <= 80 Hz. A noise
///   floor would hide the -40 dB edge (at +20 dB it is ~37 dB below the peak bin), so the
///   bandwidth is measured on the clean chain.
pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {
    let msg = Message::parse(TEST_MESSAGE).map_err(|e| e.to_string())?;
    let frame = msg.frame().map_err(|e| e.to_string())?;
    let plan = TxPlan { slot: 0, kind: TxKind::Frame(Box::new(frame)), tx_audio_hz: TEST_F0_HZ, text: TEST_MESSAGE.into() };
    let level = 0.5f32;
    let tx = z30_engine::runtime::tx_audio(&plan, rate, level)?;
    // A slot far from the epoch, the stream starting 10 s before it, the frame at DT = 0.
    let slot = 60_000_000i64;
    let t0 = slot_start(slot) - 10.0;
    let fs = rate as f64;
    let at = (10.0 * fs) as usize;
    let total = at + (27.0 * fs) as usize;
    let mut cable = vec![0.0f32; total];
    let seed = SOFTWARE_NOISE_SEED ^ rate as u64;
    if let Some(snr) = snr_db {
        // Noise sigma for `snr`: frame power over noise power in 2500 Hz.
        let p_sig = tx.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / tx.len() as f64;
        let sigma = (p_sig / (10f64.powf(snr / 10.0) * 5000.0 / fs)).sqrt();
        let mut r = z30_channel::rng(seed);
        cable.iter_mut().for_each(|c| *c = (gauss(&mut r) * sigma) as f32);
    }
    for (c, &v) in cable[at..].iter_mut().zip(&tx) {
        *c += v;
    }
    let mut pipe = RxPipeline::new(rate);
    let rx = Receiver::new();
    let block = 1024usize;
    let mut i = 0usize;
    while i < total {
        let n = block.min(total - i);
        let b = AudioBlock { first_index: i as u64, samples: cable[i..i + n].to_vec(), capture_utc: t0 + i as f64 / fs };
        for ev in pipe.push(&b) {
            match ev {
                SlotEvent::Ready(job) if job.slot == slot => {
                    let rep = rx.decode_slot(&job.samples, &RxConfig::default());
                    let mut v = analyse(&job.samples, &rep, &msg, 0.0);
                    let decoded = v["decoded"].as_bool() == Some(true) && v["other_decodes"].as_array().is_some_and(|o| o.is_empty());
                    let pass = match snr_db {
                        Some(snr) => {
                            let snr_err = v["snr_db"].as_f64().map(|s| s - snr);
                            v["snr_error_db"] = json!(snr_err);
                            decoded
                                && v["dt_sec"].as_f64().is_some_and(|d| d.abs() <= 0.020)
                                && v["freq_error_hz"].as_f64().is_some_and(|f| f.abs() <= 0.5)
                                && snr_err.is_some_and(|e| e.abs() <= 1.0)
                        }
                        None => {
                            let bw = &v["occupied_bandwidth_hz"];
                            decoded
                                && bw["p99"].as_f64().is_some_and(|b| b <= 55.0)
                                && bw["minus_40_db"].as_f64().is_some_and(|b| b <= 80.0)
                        }
                    };
                    v["criteria"] = json!(match snr_db {
                        Some(_) => "decodes, nothing else does, |DT| <= 20 ms, |f error| <= 0.5 Hz, |SNR error| <= 1 dB",
                        None => "decodes; occupied bandwidth p99 <= 55 Hz and -40 dB <= 80 Hz (the waveform alone measures ~49 / ~66 Hz)",
                    });
                    v["pass"] = json!(pass);
                    v["source"] = json!("software-loopback");
                    v["hardware_involved"] = json!(false);
                    v["message"] = json!(TEST_MESSAGE);
                    v["device_rate_hz"] = json!(rate);
                    v["noise"] = match snr_db {
                        Some(snr) => json!({ "snr_db_2500hz": snr, "seed": seed, "generator": "ChaCha8 (z30_channel::rng), Box-Muller" }),
                        None => json!("none"),
                    };
                    v["sample_clock_ppm"] = json!(pipe.clock().drift_ppm());
                    v["path"] = json!("Message::frame -> VerifiedFrame -> runtime::tx_audio -> (memory) -> RxPipeline (resampler, sample clock, slot scheduler) -> decode_slot");
                    return Ok(v);
                }
                SlotEvent::Missed(s, why) if s == slot => return Err(format!("the test slot was not scheduled: {why:?}")),
                _ => {}
            }
        }
        i += n;
    }
    Err("the receive pipeline never produced the test slot's window".into())
}

/// Standard normal deviate (Box-Muller).
fn gauss(r: &mut z30_channel::ChannelRng) -> f64 {
    let u1: f64 = r.gen_range(f64::MIN_POSITIVE..1.0);
    let u2: f64 = r.gen_range(0.0..1.0);
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

/// `z30 --loopback-test`: the software loopback at every rate in `SOFTWARE_RATES_HZ`.
pub fn run(out: Option<&std::path::Path>) -> Result<(), String> {
    let mut runs = Vec::new();
    for rate in SOFTWARE_RATES_HZ {
        runs.push(software_loopback(rate, Some(SOFTWARE_SNR_DB))?);
        runs.push(software_loopback(rate, None)?);
    }
    let pass = runs.iter().all(|v| v["pass"].as_bool() == Some(true));
    let v = json!({
        "test": "software loopback (no audio device, no PTT, no rig control; cannot transmit)",
        "hardware_validation": "NOT HARDWARE VALIDATED: this exercises the software transmit synthesis and receive chain only",
        "binary": crate::version_text(),
        "runs": runs,
        "pass": pass,
    });
    let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    println!("{text}");
    if let Some(p) = out {
        std::fs::write(p, &text).map_err(|e| format!("{}: {e}", p.display()))?;
    }
    if pass {
        Ok(())
    } else {
        Err("software loopback FAILED (see the criteria above)".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use z30_channel::{rng, synthesize, Band, Station};

    #[test]
    fn a_clean_loopback_recording_passes_and_measures_the_waveforms_bandwidth() {
        let msg = Message::parse(TEST_MESSAGE).unwrap();
        let enc = msg.encode().unwrap();
        let st =
            Station { symbols: enc.symbols, f0_hz: TEST_F0_HZ, dt_sec: 0.012, snr_db: 45.0, drift_hz: 0.0, phase_rad: 0.4, fading: None };
        let x = synthesize(&Band { stations: vec![st], noise: true, ..Default::default() }, &mut rng(5));
        let rep = Receiver::new().decode_slot(&x, &RxConfig::default());
        let v = analyse(&x, &rep, &msg, 0.010);
        eprintln!("{v:#}");
        assert_eq!(v["decoded"], true);
        assert!(v["dt_minus_prediction_ms"].as_f64().unwrap().abs() < 5.0);
        let bw99 = v["occupied_bandwidth_hz"]["p99"].as_f64().unwrap();
        let bw40 = v["occupied_bandwidth_hz"]["minus_40_db"].as_f64().unwrap();
        assert!((44.0..55.0).contains(&bw99), "99% bandwidth {bw99}");
        assert!((55.0..80.0).contains(&bw40), "-40 dB bandwidth {bw40}");
        assert_eq!(v["pass"], true);
    }

    #[test]
    fn a_recording_without_the_frame_fails() {
        let msg = Message::parse(TEST_MESSAGE).unwrap();
        let x = synthesize(&Band { noise: true, ..Default::default() }, &mut rng(6));
        let rep = Receiver::new().decode_slot(&x, &RxConfig::default());
        let v = analyse(&x, &rep, &msg, 0.0);
        assert_eq!(v["decoded"], false);
        assert_eq!(v["pass"], false);
    }

    #[test]
    fn the_software_loopback_decodes_through_the_resampler_at_both_device_rates() {
        // The production transmit synthesis into the production receive chain at 48 and
        // 44.1 kHz: the resampler, sample clock and scheduler that no published benchmark
        // passes through (post-remediation audit N-12) are in this path.
        for rate in SOFTWARE_RATES_HZ {
            let v = software_loopback(rate, Some(SOFTWARE_SNR_DB)).unwrap();
            eprintln!("{rate}: {v:#}");
            assert_eq!(v["source"], "software-loopback");
            assert_eq!(v["hardware_involved"], false);
            assert_eq!(v["decoded"], true, "{rate} Hz");
            assert!(v["other_decodes"].as_array().unwrap().is_empty());
            assert!(v["dt_sec"].as_f64().unwrap().abs() < 0.02, "{rate} Hz: DT {}", v["dt_sec"]);
            assert!(v["freq_error_hz"].as_f64().unwrap().abs() < 0.5, "{rate} Hz");
            assert!(v["snr_error_db"].as_f64().unwrap().abs() < 1.0, "{rate} Hz: SNR {}", v["snr_db"]);
            assert_eq!(v["pass"], true, "{rate} Hz");
            let clean = software_loopback(rate, None).unwrap();
            eprintln!("{rate} clean: {}", clean["occupied_bandwidth_hz"]);
            assert_eq!(clean["pass"], true, "{rate} Hz clean: {}", clean["occupied_bandwidth_hz"]);
        }
    }
}
