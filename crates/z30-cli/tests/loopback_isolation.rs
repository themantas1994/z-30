//! `z30 --loopback-test` cannot reach a transmitter, because the code that runs it has nothing
//! it could reach one with.
//!
//! The 2026-09-24 post-remediation audit (N-04) found that `--loopback-test` played its frame
//! through the configured sound card past the transmit gate, so a radio on VOX would have
//! radiated it. The software loopback now lives in `src/loopback.rs` and works on samples in
//! memory. This test reads that file's code (comments excluded) and fails if anything that can
//! produce sound, key a line or talk to a rig appears in it - the edit that would reconnect the
//! loopback to a radio. The hardware test is `src/audio_loopback.rs`, which refuses any
//! configuration with a PTT method or rig control (its own unit tests).

const FORBIDDEN: [&str; 14] = [
    "z30_io",
    "cpal",
    "CpalOutput",
    "AudioOutput",
    "AudioInput",
    "PttLine",
    "PttController",
    "open_ptt",
    "VoxPtt",
    "Rigctld",
    "RigControl",
    "runtime::start",
    "SerialPtt",
    "Cm108",
];

fn code_of(path: &str) -> String {
    let src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap();
    src.lines()
        .map(|l| match l.find("//") {
            Some(i) => &l[..i],
            None => l,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn the_software_loopback_has_no_audio_device_ptt_or_rig_control_in_it() {
    let code = code_of("src/loopback.rs");
    assert!(code.contains("fn software_loopback"), "the software loopback moved; update this guard with it");
    for f in FORBIDDEN {
        assert!(
            !code.contains(f),
            "src/loopback.rs uses `{f}`: the software loopback must not be able to reach audio hardware, PTT or a rig"
        );
    }
}

#[test]
fn the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag() {
    let main = code_of("src/main.rs");
    assert!(main.contains("return loopback::run(cli.out.as_deref());"), "--loopback-test must run the software loopback");
    assert!(main.contains("audio_loopback::run(&cfg, cli.confirm_no_transmitter"), "--audio-loopback-test must pass through its refusals");
    assert_eq!(main.matches("audio_loopback::run(").count(), 1, "the hardware loopback has exactly one entry point");
}
