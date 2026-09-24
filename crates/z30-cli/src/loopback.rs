//! `z30 --loopback-test`: audio loopback validation on real hardware (docs/hardware-validation.md
//! test A1). A known frame is played through the configured output device at a slot boundary,
//! recorded through the configured input device by the production receive pipeline
//! (`RxPipeline`: resampler, sample clock, slot scheduler) and decoded by `decode_slot`.
//!
//! What it measures - from the recording, nothing assumed:
//!
//! - whether the frame decoded, and anything else that decoded (a false decode on a cable);
//! - DT against the slot boundary, and against the instant this program predicted the first
//!   sample would leave the output (play call + the device's reported output latency) - the
//!   second is the audio chain's own timing error;
//! - frequency error, reported SNR, the sound card's clock error as the sample-clock model
//!   estimated it;
//! - the recorded frame's 99% and -40 dB occupied bandwidth (Welch, stated parameters);
//! - the peak level (clipping).
//!
//! It keys nothing. It refuses to run without `--confirm-no-transmitter`, because a radio on VOX
//! connected to the output WOULD transmit this audio. The result file says `source:
//! hardware-loopback` and carries the binary's provenance; it is evidence only for the devices
//! and cable it names.

use rustfft::num_complex::Complex32;
use rustfft::FftPlanner;
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};
use z30_dsp::slot::{Receiver, RxConfig, SlotReport};
use z30_engine::pipeline::RxPipeline;
use z30_engine::runtime::{AudioInput, AudioOutput, WallClock};
use z30_engine::slots::{slot_of, slot_start, SlotEvent};
use z30_protocol::codec::Message;
use z30_protocol::gfsk::Modulator;

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
    let want = expected.encode().expect("the test message encodes").info;
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

/// Runs the test on the configured devices.
pub fn run(cfg: &z30_engine::config::Config, confirmed: bool, out: Option<&Path>) -> Result<(), String> {
    if !confirmed {
        return Err("--loopback-test plays a z-30 frame through the output device. A radio on VOX connected to it WOULD transmit. \
             Connect the output to the input with a cable (or a second sound card), with no transmitter in the path, \
             and run again with --confirm-no-transmitter."
            .into());
    }
    let mut input = z30_io::audio::CpalInput::open(cfg.audio.input_device.as_deref())?;
    let mut output = z30_io::audio::CpalOutput::open(cfg.audio.output_device.as_deref())?;
    let wall = z30_io::wallclock::SystemWallClock::default();
    let msg = Message::parse(TEST_MESSAGE).map_err(|e| e.to_string())?;
    let enc = msg.encode().map_err(|e| e.to_string())?;
    let level = cfg.audio.tx_level.clamp(0.05, 1.0);
    let audio: Vec<f32> = Modulator::new(output.sample_rate() as f64)
        .map_err(|e| e.to_string())?
        .synthesize(&enc.symbols, TEST_F0_HZ)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|v| v * level)
        .collect();
    let mut pipe = RxPipeline::new(input.sample_rate());
    let rx = Receiver::new();
    // The slot after next, so the clock model has time to lock and the window starts after the
    // stream did.
    let target = slot_of(wall.utc_now()) + 2;
    eprintln!(
        "loopback: input {} Hz, output {} Hz; sending \"{TEST_MESSAGE}\" at tone 0 = {TEST_F0_HZ} Hz in the slot starting {:.0} (~{:.0} s)",
        input.sample_rate(),
        output.sample_rate(),
        slot_start(target),
        slot_start(target) - wall.utc_now()
    );
    let mut played_at: Option<(f64, f64)> = None; // (utc of the play call, reported output latency)
    let deadline = Instant::now() + Duration::from_secs(95);
    while Instant::now() < deadline {
        let now = wall.utc_now();
        if played_at.is_none() && now >= slot_start(target) - output.latency_sec() - 0.005 {
            let latency = output.latency_sec();
            output.play(audio.clone())?;
            played_at = Some((wall.utc_now(), latency));
        }
        let Some(block) = input.next_block(Duration::from_millis(5))? else { continue };
        for ev in pipe.push(&block) {
            match ev {
                SlotEvent::Ready(job) if job.slot == target => {
                    let rep = rx.decode_slot(&job.samples, &RxConfig::default());
                    let (play_utc, latency) = played_at.ok_or("the frame was never played")?;
                    let predicted_dt = play_utc + latency - slot_start(target);
                    let mut v = analyse(&job.samples, &rep, &msg, predicted_dt);
                    v["source"] = json!("hardware-loopback");
                    v["message"] = json!(TEST_MESSAGE);
                    v["predicted_dt_sec"] = json!(predicted_dt);
                    v["output_latency_reported_sec"] = json!(latency);
                    v["sample_clock_ppm"] = json!(pipe.clock().drift_ppm());
                    v["input_overruns"] = json!(pipe.overruns());
                    v["devices"] = json!({ "input": cfg.audio.input_device.clone().unwrap_or("system default".into()),
                        "output": cfg.audio.output_device.clone().unwrap_or("system default".into()),
                        "input_rate_hz": input.sample_rate(), "output_rate_hz": output.sample_rate(), "tx_level": level });
                    v["clock"] = json!(wall.status());
                    v["binary"] = json!(crate::version_text());
                    let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
                    println!("{text}");
                    if let Some(p) = out {
                        std::fs::write(p, &text).map_err(|e| format!("{}: {e}", p.display()))?;
                    }
                    output.stop();
                    return if v["pass"].as_bool() == Some(true) {
                        Ok(())
                    } else {
                        Err("loopback test FAILED (see the criteria above)".into())
                    };
                }
                SlotEvent::Missed(s, why) if s == target => return Err(format!("the test slot was not captured: {why:?}")),
                _ => {}
            }
        }
    }
    output.stop();
    Err("timed out waiting for the test slot's window".into())
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
    fn it_will_not_play_audio_without_the_confirmation() {
        let err = run(&z30_engine::config::Config::default(), false, None).unwrap_err();
        assert!(err.contains("VOX"));
    }
}
