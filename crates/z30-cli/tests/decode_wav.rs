//! `z30 --decode` on a float WAV holding NaN or infinity: refused with the file and the sample
//! named, not panicked on. Such a sample used to reach the decoder, whose noise medians panicked.

// clippy.toml's disallowed lists are for src/loopback.rs alone (it forbids them); tests run the
// binary and write temporary files.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use z30_dsp::baseband::{SLOT_SAMPLES, SLOT_ZERO_INDEX};

/// A frame at DT = 0 in light noise, as the 27 s, 6 kHz window `--decode` takes as one slot.
fn slot_window() -> Vec<f32> {
    let frame = z30_protocol::codec::Message::parse("CQ K1ABC FN31").unwrap().frame().unwrap();
    let wave = z30_protocol::gfsk::Modulator::new(6000.0).unwrap().synthesize(frame.symbols(), 1500.0).unwrap();
    let mut state = 20_261_107u64;
    let mut x: Vec<f32> = (0..SLOT_SAMPLES)
        .map(|_| {
            state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            ((state >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 0.05
        })
        .collect();
    for (v, w) in x[SLOT_ZERO_INDEX..].iter_mut().zip(&wave) {
        *v += 0.5 * w;
    }
    x
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("z30-decode-wav-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn decode(dir: &Path, wav: &Path) -> Output {
    // A configuration file that does not exist: the defaults, and nothing of the user's is read.
    Command::new(env!("CARGO_BIN_EXE_z30"))
        .arg("--config")
        .arg(dir.join("no-such-config.toml"))
        .arg("--decode")
        .arg(wav)
        .output()
        .expect("run z30")
}

#[test]
fn a_float_wav_holding_nan_or_infinity_is_refused_cleanly_not_panicked_on() {
    let dir = scratch("nonfinite");
    let x = slot_window();
    // The control: the same recording, finite, decodes.
    let good = dir.join("good.wav");
    z30_io::wav::write_mono(&good, &x, 6000).unwrap();
    let out = decode(&dir, &good);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success() && stdout.contains("CQ K1ABC FN31"),
        "the finite control did not decode: {stdout} {}",
        String::from_utf8_lossy(&out.stderr)
    );
    for (bad, shown) in [(f32::NAN, "NaN"), (f32::INFINITY, "inf"), (f32::NEG_INFINITY, "-inf")] {
        let mut y = x.clone();
        y[SLOT_ZERO_INDEX + 500] = bad; // inside the frame
        let wav = dir.join(format!("bad{shown}.wav"));
        z30_io::wav::write_mono(&wav, &y, 6000).unwrap();
        let out = decode(&dir, &wav);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(!stderr.contains("panicked"), "{shown}: z30 panicked: {stderr}");
        assert_eq!(out.status.code(), Some(1), "{shown}: {stderr}");
        assert!(stderr.contains(&wav.display().to_string()), "{shown}: the file is not named: {stderr}");
        assert!(stderr.contains(&format!("sample {} of channel 0 is {shown}", SLOT_ZERO_INDEX + 500)), "{shown}: {stderr}");
        assert!(out.stdout.is_empty(), "{shown}: decoded anyway: {}", String::from_utf8_lossy(&out.stdout));
    }
    let _ = std::fs::remove_dir_all(&dir);
}
