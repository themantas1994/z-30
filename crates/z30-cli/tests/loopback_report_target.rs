//! `--out` for the loopback tests is written only to a file. Opening a serial tty asserts DTR and
//! RTS, so `z30 --loopback-test --out /dev/ttyUSB0` keyed a serial-PTT radio from a test that must
//! not be able to (transmit-safety re-review R-3). The refusal had no test, and replacing it with
//! `if false` passed every test (confirmation re-review, finding 1). `/dev/null` is a character
//! device like a tty, and harmless to open, so it stands in for one here.

#[cfg(unix)]
#[test]
fn the_software_loopback_refuses_a_character_device_as_its_report_file() {
    let out =
        std::process::Command::new(env!("CARGO_BIN_EXE_z30")).args(["--loopback-test", "--out", "/dev/null"]).output().expect("run z30");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "z30 accepted /dev/null as a report file; stderr: {stderr}");
    assert!(stderr.contains("/dev/null: not a regular file"), "unexpected refusal: {stderr}");
    // Refused before the test runs, so nothing was printed as a report either.
    assert!(out.stdout.is_empty(), "the loopback ran before the target was checked");
}

#[test]
fn the_software_loopback_writes_its_report_to_a_regular_file() {
    let dir = std::env::temp_dir().join(format!("z30-loopback-report-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("report.txt");
    let out =
        std::process::Command::new(env!("CARGO_BIN_EXE_z30")).arg("--loopback-test").arg("--out").arg(&path).output().expect("run z30");
    let written = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(out.status.success(), "the software loopback failed: {}", String::from_utf8_lossy(&out.stderr));
    assert!(!written.is_empty(), "no report was written to a regular file");
}
