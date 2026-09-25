//! `z30 --audio-loopback-test`: hardware validation test A1 (docs/hardware-validation.md). A
//! known frame is played through the configured OUTPUT SOUND CARD at a slot boundary, recorded
//! through the configured input device by the production receive pipeline (`RxPipeline`:
//! resampler, sample clock, slot scheduler) and decoded by `decode_slot`. The analysis is the
//! software loopback's (`loopback::analyse`).
//!
//! This plays real audio out of a real device, and nothing in software can see what that
//! device is wired to. The transmit gate is not in front of it, because it is not a
//! transmission: it must never become one. So it refuses to run
//!
//! - without `--confirm-no-transmitter` (the operator's statement that the output is looped
//!   back by cable, with no radio in the path), and
//! - when the configuration it runs with has ANY way to key a transmitter: a PTT method (VOX
//!   included - a VOX radio keys on this very audio) or rig control. Such a configuration
//!   describes a station with a radio attached; run it with a configuration for the loopback
//!   rig instead (`--config`).
//!
//! Before 2026-09-24 this was `--loopback-test` and checked only the confirmation flag, so a
//! station configured for VOX could radiate `CQ Q0TST FN31` with no callsign or band-plan
//! check (post-remediation audit, N-04). It keys nothing itself. The result file says
//! `source: hardware-loopback` and carries the binary's provenance; it is evidence only for the
//! devices and cable it names.

use crate::loopback::{analyse, TEST_F0_HZ, TEST_MESSAGE};
use serde_json::json;
use std::path::Path;
use std::time::{Duration, Instant};
use z30_dsp::slot::{Receiver, RxConfig};
use z30_engine::config::{Config, PttConfig};
use z30_engine::pipeline::RxPipeline;
use z30_engine::runtime::{AudioInput, AudioOutput, WallClock};
use z30_engine::slots::{slot_of, slot_start, SlotEvent};
use z30_protocol::codec::Message;
use z30_protocol::gfsk::Modulator;

/// Why this configuration must not play test audio, if it must not. Checked before any device
/// is opened.
pub fn refusal(cfg: &Config, confirmed: bool) -> Option<String> {
    if !confirmed {
        return Some(
            "--audio-loopback-test plays a z-30 frame through the output sound card. A radio on VOX connected to it WOULD transmit. \
             Connect the output to the input with a cable (or a second sound card), with no transmitter in the path, \
             and run again with --confirm-no-transmitter. (The software-only test, --loopback-test, needs none of this.)"
                .into(),
        );
    }
    let mut why = Vec::new();
    if cfg.ptt != PttConfig::None {
        why.push(format!(
            "a PTT method is configured ({}): this configuration keys a transmitter{}",
            match &cfg.ptt {
                PttConfig::None => "none",
                PttConfig::Vox => "VOX",
                PttConfig::Cat => "CAT",
                PttConfig::Serial { .. } => "serial RTS/DTR",
                PttConfig::Cm108 { .. } => "CM108 GPIO",
            },
            if cfg.ptt == PttConfig::Vox { ", and a VOX radio keys on exactly this audio" } else { "" }
        ));
    }
    if !cfg.rig.rigctld_host.trim().is_empty() {
        why.push(format!("rig control is configured (rigctld at {}): a radio is attached to this station", cfg.rig.rigctld_host));
    }
    (!why.is_empty()).then(|| {
        format!(
            "--audio-loopback-test refuses to play audio with this configuration: {}. Use a configuration for the loopback setup with PTT = none and no rig control (--config <file>).",
            why.join("; ")
        )
    })
}

/// Runs the test on the configured devices.
pub fn run(cfg: &Config, confirmed: bool, out: Option<&Path>) -> Result<(), String> {
    if let Some(why) = refusal(cfg, confirmed) {
        return Err(why);
    }
    let mut input = z30_io::audio::CpalInput::open(cfg.audio.input_device.as_deref())?;
    let mut output = z30_io::audio::CpalOutput::open(cfg.audio.output_device.as_deref())?;
    let wall = z30_io::wallclock::SystemWallClock::default();
    let msg = Message::parse(TEST_MESSAGE).map_err(|e| e.to_string())?;
    let frame = msg.frame().map_err(|e| e.to_string())?;
    let level = cfg.audio.tx_level.clamp(0.05, 1.0);
    let audio: Vec<f32> = Modulator::new(output.sample_rate() as f64)
        .map_err(|e| e.to_string())?
        .synthesize(frame.symbols(), TEST_F0_HZ)
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
    use z30_engine::config::SerialLine;

    #[test]
    fn it_will_not_play_audio_without_the_confirmation() {
        let err = run(&Config::default(), false, None).unwrap_err();
        assert!(err.contains("VOX") && err.contains("--confirm-no-transmitter"));
    }

    #[test]
    fn it_refuses_every_configuration_that_can_key_a_transmitter_before_opening_a_device() {
        // Post-remediation audit N-04: with VOX configured the old test played the frame
        // anyway. Each of these must be refused by `refusal`, i.e. before any device is opened,
        // confirmation or not.
        let serial = PttConfig::Serial { port: "/dev/ttyUSB0".into(), line: SerialLine::Rts, active_high: true };
        let cm108 = PttConfig::Cm108 { device: String::new(), pin: 3, active_high: true };
        for (name, ptt) in [("VOX", PttConfig::Vox), ("CAT", PttConfig::Cat), ("serial", serial), ("CM108", cm108)] {
            let cfg = Config { ptt, ..Default::default() };
            let why = refusal(&cfg, true).unwrap_or_else(|| panic!("{name}: allowed"));
            assert!(why.contains("PTT method"), "{name}: {why}");
            let err = run(&cfg, true, None).unwrap_err();
            assert_eq!(err, why, "{name}: run must stop at the refusal, not at a device");
        }
        let cfg =
            Config { rig: z30_engine::config::RigConfig { rigctld_host: "localhost".into(), ..Default::default() }, ..Default::default() };
        let why = refusal(&cfg, true).expect("rig control configured");
        assert!(why.contains("rig control"));
        assert_eq!(run(&cfg, true, None).unwrap_err(), why);
        // No PTT and no rig control, confirmed: this is the only configuration it runs with.
        assert_eq!(refusal(&Config::default(), true), None);
    }
}
