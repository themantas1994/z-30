#!/usr/bin/env python3
"""Mutation checks for the 2026-09-24 corrective remediation.

The post-remediation audit's 28 mutations (evidence/scripts/mutate.py there), with the patterns
updated where the code they break moved, plus mutations for every defect this remediation
fixed. Each mutation breaks one piece of production logic in a separate git worktree (never the
checkout being committed), runs the tests that claim to guard it, records whether they FAIL
(KILLED: the tests protect the logic) or PASS (SURVIVED), and restores the file.

Usage: W=<worktree> CARGO_TARGET_DIR=<dir> MUT_OUT=<json> python3 mutate_corrective.py [IDs...]
"""
import json, os, subprocess, sys, time

W = os.environ["W"]
ENV = dict(os.environ, CARGO_TERM_COLOR="never")
ORACLE = os.path.join(W, "legacy", "python-oracle")

SLOTS = "crates/z30-engine/src/slots.rs"
WALL = "crates/z30-io/src/wallclock.rs"
CODEC = "crates/z30-protocol/src/codec.rs"
GATE = "crates/z30-engine/src/txgate.rs"
ENGINE = "crates/z30-engine/src/engine.rs"
CONFIG = "crates/z30-engine/src/config.rs"
QSO = "crates/z30-engine/src/qso.rs"
LOGB = "crates/z30-io/src/logbook.rs"
MIGR = "crates/z30-io/src/migrate.rs"
SIC = "crates/z30-dsp/src/sic.rs"
DEMOD = "crates/z30-dsp/src/demod.rs"
CHAN = "crates/z30-channel/src/lib.rs"
PYCHAN = "legacy/python-oracle/z30_dsp/channel.py"
LOOP = "crates/z30-cli/src/loopback.rs"
ALOOP = "crates/z30-cli/src/audio_loopback.rs"
MAIN = "crates/z30-cli/src/main.rs"

T_C01 = [["-p", "z30-engine", "--test", "live_runtime"], ["-p", "z30-engine", "--test", "virtual_clock"]]
T_C03 = [["-p", "z30-io", "--lib"]]
T_C06 = [["-p", "z30-protocol"], ["-p", "z30-engine", "--test", "safety"]]
T_LOG = [["-p", "z30-engine", "--test", "qso_logging"], ["-p", "z30-engine", "--lib"], ["-p", "z30-io", "--test", "logbook_integrity"],
         ["-p", "z30-io", "--lib"], ["-p", "z30-engine", "--test", "virtual_clock"]]
T_DIAL = [["-p", "z30-engine", "--test", "dial_provenance"], ["-p", "z30-engine", "--lib"], ["-p", "z30-io", "--lib"]]
T_SIC = [["-p", "z30-dsp", "--test", "sic_regression"], ["-p", "z30-dsp", "--test", "channel_scenarios"]]
T_SNR = [["-p", "z30-dsp", "--test", "snr_accuracy"], ["-p", "z30-engine", "--test", "qso_logging"]]
T_TXG = [["-p", "z30-engine", "--test", "safety"]]
T_LOOP = [["-p", "z30-cli"]]
T_WAT = [["-p", "z30-channel"]]
T_PYWAT = [["PY", "tests/test_watterson_doppler.py"]]

A = "audit"      # the post-remediation audit's mutation, pattern unchanged
U = "audit*"     # the audit's mutation, pattern updated to the moved code
N = "new"        # added by this remediation

M = [
    # id, origin, area, description, file, old, new, tests[, extra replacements]
    ("C01-a", A, "C-01", "window shortened by 0.5 s (ends at slot + 25.0 s)", SLOTS,
     "pub const WINDOW_END_SEC: f64 = FRAME_SEC + DT_SEARCH_SEC;", "pub const WINDOW_END_SEC: f64 = FRAME_SEC + DT_SEARCH_SEC - 0.5;", T_C01),
    ("C01-b", A, "C-01", "decode triggered 0.5 s early; missing tail zero-padded (the legacy defect)", SLOTS,
     "if end > store.end() as f64 {", "if end - 3000.0 > store.end() as f64 {", T_C01,
     [("match store.read(first as u64, window_len) {",
       "match store.read(first as u64, window_len - 3000).map(|mut v| { v.resize(window_len, 0.0); v }) {")]),
    ("C01-c", A, "C-01", "slot boundary shifted by +100 ms", SLOTS,
     "let t0 = slot_start(slot) + WINDOW_START_SEC;", "let t0 = slot_start(slot) + WINDOW_START_SEC + 0.1;", T_C01),
    ("C01-d", A, "C-01", "slot boundary shifted by +5 ms (30 samples)", SLOTS,
     "let t0 = slot_start(slot) + WINDOW_START_SEC;", "let t0 = slot_start(slot) + WINDOW_START_SEC + 0.005;", T_C01),
    ("C01-e", A, "C-01", "final 0.1 s of the window zeroed", SLOTS,
     "Some(samples) => out.push(SlotEvent::Ready(SlotJob { slot, first_index: first as u64, samples, window_start_utc: t0 })),",
     "Some(mut samples) => { let n = samples.len(); samples[n - 600..].fill(0.0); out.push(SlotEvent::Ready(SlotJob { slot, first_index: first as u64, samples, window_start_utc: t0 })) }",
     T_C01),
    ("C03-a", A, "C-03", "'synchronised' claimed when timedatectl could not be run", WALL,
     'Some("yes") => "system clock NTP-synchronised (timedatectl)".into(),',
     'Some("yes") | None => "system clock NTP-synchronised (timedatectl)".into(),', T_C03),
    ("C03-b", U, "C-03", "an own time offset of +0.7 s applied to UTC", WALL,
     "Ok(d) => d.as_secs_f64(),", "Ok(d) => d.as_secs_f64() + 0.7,", T_C03),
    ("C03-c", U, "C-03", "an own time offset of +0.3 s applied to UTC", WALL,
     "Ok(d) => d.as_secs_f64(),", "Ok(d) => d.as_secs_f64() + 0.3,", T_C03),
    ("C03-d", N, "C-03", "an own time offset of +0.01 s applied to UTC", WALL,
     "Ok(d) => d.as_secs_f64(),", "Ok(d) => d.as_secs_f64() + 0.01,", T_C03),
    ("C06-a", A, "C-06", "verify_round_trip always succeeds", CODEC,
     "let fail = || CodecError::RoundTripFailed(self.message.to_string());",
     "if true { return Ok(()); }\n        let fail = || CodecError::RoundTripFailed(self.message.to_string());", T_C06),
    ("C06-b", U, "C-06", "the frame is made transmittable without the round trip (verify() ignores it)", CODEC,
     "        self.verify_round_trip()?;\n        Ok(VerifiedFrame(self))", "        let _ = self.verify_round_trip();\n        Ok(VerifiedFrame(self))", T_C06),
    ("C06-b2", N, "C-06", "the gate hands out a verified frame of a different message", GATE,
     "Ok(f) if f.message() == m => frame = Some(f),", "Ok(f) => frame = Some(f),", T_C06),
    ("C06-b3", N, "C-06", "a failed round trip is not reported as a violation", GATE,
     "Err(e) => v.push(Violation::MessageNotEncodable(e)),", "Err(_) => {}", T_C06),
    ("C06-b4", N, "C-06", "'allowed' no longer requires the verified frame (second fail-closed guard removed)", GATE,
     "let allowed = v.is_empty() && frame.is_some() == req.message.is_some();", "let allowed = v.is_empty();", T_C06),
    ("C06-b5", N, "C-06", "the round trip no longer checks the Costas symbols", CODEC,
     "if crate::SYNC_POSITIONS.iter().zip(crate::SYNC_TONES.iter()).any(|(&p, &t)| self.symbols[p] != t) {",
     "if false && crate::SYNC_POSITIONS.iter().zip(crate::SYNC_TONES.iter()).any(|(&p, &t)| self.symbols[p] != t) {", T_C06),
    ("C06-b6", N, "C-06", "the round trip no longer compares the carried codeword/info with the symbols", CODEC,
     "if cw != self.codeword || cw[..K] != self.info || crate::ldpc::syndrome_weight(&cw) != 0 {",
     "if crate::ldpc::syndrome_weight(&cw) != 0 {", T_C06),
    ("C06-b7", N, "C-06", "the round trip no longer checks the syndrome", CODEC,
     "if cw != self.codeword || cw[..K] != self.info || crate::ldpc::syndrome_weight(&cw) != 0 {",
     "if cw != self.codeword || cw[..K] != self.info {", T_C06),
    ("C06-b8", N, "C-06", "the round trip no longer compares the decoded fields with the message", CODEC,
     "if decoded.to_message().as_ref() != Some(&self.message) {", "if decoded.to_message().is_none() {", T_C06),
    ("C06-b9", N, "C-06", "the round trip's canonical re-encoding comparison removed", CODEC,
     "if canonical != self.symbols {", "if false && canonical != self.symbols {", T_C06),
    # Pairs: each single round-trip check above that survives is redundant with another; these
    # show which one, by removing both. If a pair survives, the property itself is unprotected.
    ("C06-p1", N, "C-06", "PAIR: Costas check AND canonical re-encoding comparison removed", CODEC,
     "if crate::SYNC_POSITIONS.iter().zip(crate::SYNC_TONES.iter()).any(|(&p, &t)| self.symbols[p] != t) {",
     "if false && crate::SYNC_POSITIONS.iter().zip(crate::SYNC_TONES.iter()).any(|(&p, &t)| self.symbols[p] != t) {", T_C06,
     [("if canonical != self.symbols {", "if false && canonical != self.symbols {")]),
    ("C06-p2", N, "C-06", "PAIR: syndrome check AND canonical re-encoding comparison removed", CODEC,
     "if cw != self.codeword || cw[..K] != self.info || crate::ldpc::syndrome_weight(&cw) != 0 {",
     "if cw != self.codeword || cw[..K] != self.info {", T_C06,
     [("if canonical != self.symbols {", "if false && canonical != self.symbols {")]),
    ("C06-p3", N, "C-06", "PAIR: decoded-fields comparison AND canonical re-encoding comparison removed", CODEC,
     "if decoded.to_message().as_ref() != Some(&self.message) {", "if decoded.to_message().is_none() {", T_C06,
     [("if canonical != self.symbols {", "if false && canonical != self.symbols {")]),
    ("C06-p4", N, "C-06", "PAIR: a failed round trip not reported AND 'allowed' not requiring the frame", GATE,
     "Err(e) => v.push(Violation::MessageNotEncodable(e)),", "Err(_) => {}", T_C06,
     [("let allowed = v.is_empty() && frame.is_some() == req.message.is_some();", "let allowed = v.is_empty();")]),
    ("C06-c", U, "C-06", "(audit: encoder's payload round-trip check removed) - that check was deleted as a weaker duplicate of verify's; see C06-b8", CODEC,
     "@@NOT-APPLICABLE@@", "", T_C06),
    ("C06-d", A, "C-06", "gate no longer checks the frame is sent from this station", GATE,
     "if my_call.as_ref() != Some(&m.from) {", "if false && my_call.as_ref() != Some(&m.from) {", T_C06),
    ("C06-e", A, "C-06", "encoder hashes an off-table grid onto the table (legacy FN42->RE78), round-trip checks intact", CODEC,
     "g.v1_code().map(|_| Extra::Grid(g.clone())).ok_or_else(|| CodecError::GridNotInTable(g.0.clone()))",
     "Ok(Extra::Grid(g.clone()))", T_C06,
     [('Extra::Grid(g) => g.v1_code().expect("validated at construction"),', "Extra::Grid(g) => g.v1_code().unwrap_or(64),"),
      ("(_, Extra::Grid(g)) if g.v1_code().is_none() =>", "(_, Extra::Grid(g)) if false && g.v1_code().is_none() =>")]),
    ("TXG-mode", N, "L-07", "the gate ignores a radio reporting LSB/FM/AM/CW", GATE,
     "if !USB_MODES.contains(&mode.trim().to_ascii_uppercase().as_str()) {", "if false {", T_TXG),
    ("TXG-level", N, "N-09", "the gate keys with a zero transmit level", ENGINE,
     "if self.config.audio.tx_level.is_nan() || self.config.audio.tx_level <= 0.0 {", "if false {", T_TXG),
    ("LOOP-a", N, "N-04", "the software loopback opens the output sound card", LOOP,
     "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {",
     "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n    let _ = z30_io::audio::CpalOutput::open(None);", T_LOOP),
    ("LOOP-b", N, "N-04", "the audio loopback refusal lets VOX through", ALOOP,
     "if cfg.ptt != PttConfig::None {", "if !matches!(cfg.ptt, PttConfig::None | PttConfig::Vox) {", T_LOOP),
    ("LOOP-c", N, "N-04", "the audio loopback ignores its refusal", ALOOP,
     "if let Some(why) = refusal(cfg, confirmed) {", "if let Some(why) = refusal(cfg, confirmed).filter(|_| false) {", T_LOOP),
    ("LOOP-d", N, "N-04", "--loopback-test runs the sound-card test", MAIN,
     "return loopback::run(cli.out.as_deref());",
     "return audio_loopback::run(&paths::load_config(config_path)?, true, cli.out.as_deref());", T_LOOP),
    ("WAT-a", N, "N-01", "Rust: the 1/sqrt 2 defect re-introduced (amplitude response = power spectrum)", CHAN,
     "    doppler_power_response(f_hz, doppler_hz).sqrt()", "    doppler_power_response(f_hz, doppler_hz)", T_WAT),
    ("WAT-b", N, "N-01", "Rust: sigma_D defined as spread / (2 sqrt 2)", CHAN,
     "    doppler_hz / 2.0\n}", "    doppler_hz / 2.0 / std::f64::consts::SQRT_2\n}", T_WAT),
    ("WAT-c", N, "N-01", "Rust: sigma_D defined as spread (1-sigma convention)", CHAN,
     "    doppler_hz / 2.0\n}", "    doppler_hz\n}", T_WAT),
    ("WAT-py", N, "N-01", "oracle: the 1/sqrt 2 defect re-introduced", PYCHAN,
     "shape = np.exp(-0.25 * (freqs / sigma_d) ** 2)", "shape = np.exp(-0.5 * (freqs / sigma_d) ** 2)", T_PYWAT),
    ("LOG-a", A, "C-05", "QsoRecord::validate always accepts", QSO,
     "if self.call.trim().is_empty() {", "if true { return Ok(()); }\n        if self.call.trim().is_empty() {", T_LOG),
    ("LOG-b", A, "C-05", "missing grid logged as FN31", QSO,
     "grid: self.dx.grid.as_ref().map(|g| Sourced::new(g.to_string(), Provenance::Received)),",
     'grid: Some(self.dx.grid.as_ref().map(|g| Sourced::new(g.to_string(), Provenance::Received)).unwrap_or(Sourced::new("FN31".into(), Provenance::Received))),',
     T_LOG),
    ("LOG-c", A, "C-05", "missing received report logged as -16", QSO,
     "rst_rcvd: self.dx.rst_rcvd.map(|r| Sourced::new(r, Provenance::Received)),",
     "rst_rcvd: Some(Sourced::new(self.dx.rst_rcvd.unwrap_or(-16), Provenance::Received)),", T_LOG),
    ("LOG-d", A, "C-05/M-07", "unmeasured SNR produces a -16 report", QSO,
     "snr_db.filter(|v| v.is_finite()).map(|v| v.round().clamp(-30.0, 30.0) as i8)",
     "snr_db.filter(|v| v.is_finite()).map(|v| v.round().clamp(-30.0, 30.0) as i8).or(Some(-16))", T_LOG),
    ("LOG-e", A, "C-05", "UTC shifted by +1 h (local time written as UTC)", LOGB,
     "let secs = t.floor() as i64;", "let secs = t.floor() as i64 + 3600;", T_LOG),
    ("LOG-f", A, "C-05", "validate accepts start times before 2020", QSO,
     "if !self.start_utc.is_finite() || self.start_utc < EARLIEST_QSO_UTC {", "if !self.start_utc.is_finite() {", T_LOG),
    ("DIAL-a", N, "N-05", "a configured dial is logged as commanded", ENGINE,
     "(None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Configured)),", "(None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Commanded)),", T_DIAL),
    ("DIAL-b", N, "N-05", "any answer from the radio (even a refusal) counts as commanded", ENGINE,
     "Ok(()) if self.dial == Some(hz) => self.dial_commanded = true,", "_ if self.dial == Some(hz) => self.dial_commanded = true,", T_DIAL),
    ("DIAL-c", N, "N-05", "the 14.076 MHz default dial re-introduced", CONFIG,
     "            dial_hz: None,\n", "            dial_hz: Some(14_076_000),\n", T_DIAL),
    ("DIAL-d", N, "N-05", "changing the dial keeps the old dial's 'commanded'", ENGINE,
     "            self.dial = dial;\n            self.dial_commanded = false;", "            self.dial = dial;", T_DIAL),
    ("DIAL-e", N, "N-05", "the v1 logbook migration keeps 'commanded'", LOGB,
     "WHEN 'commanded' THEN 'configured'", "WHEN 'commanded' THEN 'commanded'", T_DIAL),
    ("DIAL-f", N, "N-05", "migration keeps the legacy auto-logger's dial-plus-offset frequency", MIGR,
     "if let Some(f) = dial.take() {", "if let Some(f) = dial.clone() {", T_DIAL),
    ("DIAL-g", N, "N-05", "a stale rig reading is logged as reported by the rig", "crates/z30-engine/src/rig.rs",
     "    pub fn verified_dial_hz(&self, now_ms: u64) -> Option<f64> {\n        if self.has_fresh_reading(now_ms) {",
     "    pub fn verified_dial_hz(&self, now_ms: u64) -> Option<f64> {\n        if self.online || self.has_fresh_reading(now_ms) {", T_DIAL),
    ("SIC-a", A, "SIC", "subtraction computes but does not modify the residual", SIC,
     "        energy += v * v;\n        x[j] -= v as f32;", "        energy += v * v;\n        let _ = &x[j];", T_SIC),
    ("SIC-b", A, "SIC", "only half of the fitted component subtracted", SIC,
     "        energy += v * v;\n        x[j] -= v as f32;", "        energy += v * v;\n        x[j] -= 0.5 * v as f32;", T_SIC),
    ("SIC-c", A, "SIC", "the station's span is zeroed instead of subtracted", SIC,
     "        energy += v * v;\n        x[j] -= v as f32;", "        energy += v * v;\n        x[j] = 0.0;", T_SIC),
    ("SNR-a", A, "M-07", "noise taken from the received off-tone bins (the audited saturating estimator)", DEMOD,
     "resid.push((y[b] - g * r[b]).norm_sqr());", "resid.push(y[b].norm_sqr());", T_SNR),
    ("SNR-b", A, "M-07", "SNR clipped at +6.6 dB", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "(s > 0.0).then(|| (10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10()).min(6.6))", T_SNR),
    ("SNR-c", A, "M-07", "SNR is a constant -16 dB", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "{ let _ = s; Some(-16.0) }", T_SNR),
    ("SNR-d", A, "M-07", "LS-projection noise bias correction removed", DEMOD,
     "let s = (s_sum - n_bin * bias_sum) / TOTAL_SYMBOLS as f64;", "let s = { let _ = bias_sum; s_sum / TOTAL_SYMBOLS as f64 };", T_SNR),
    ("SNR-e", A, "M-07", "no-estimate case floored to -30 dB instead of None", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "Some(if s > 0.0 { 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10() } else { -30.0 })", T_SNR),
    ("SNR-f", A, "M-07", "SNR biased by +1.0 dB", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "(s > 0.0).then(|| 1.0 + 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())", T_SNR),
]


def run(t):
    if t[0] == "PY":
        return subprocess.run([sys.executable, "-m", "pytest", "-q", t[1]], cwd=ORACLE, env=ENV, capture_output=True, text=True)
    # The workspace test profile (opt-level 3, no LTO): the audit's own choice, and a fraction of the
    # release profile's rebuild time per mutant.
    return subprocess.run(["cargo", "+stable", "test", "--locked"] + t, cwd=W, env=ENV, capture_output=True, text=True)


def restore():
    subprocess.run(["git", "checkout", "--", "."], cwd=W, check=True)


def failed_names(r, t):
    if t[0] == "PY":
        return [l.split()[1] for l in r.stdout.splitlines() if l.startswith("FAILED ")]
    return [l.split()[1] for l in r.stdout.splitlines() if l.startswith("test ") and l.rstrip().endswith("FAILED")]


def main():
    only = set(sys.argv[1:])
    results = []
    restore()
    groups = []
    for m in M:
        if (not only or m[0] in only) and m[7] not in groups:
            groups.append(m[7])
    base_ok = {}
    for g in groups:
        rs = [run(t) for t in g]
        ok = all(r.returncode == 0 for r in rs)
        base_ok[" | ".join(" ".join(t) for t in g)] = ok
        print("baseline", [" ".join(t) for t in g], "PASS" if ok else "FAIL", flush=True)
        if not ok:
            for r in rs:
                print(r.stdout[-2000:], r.stderr[-2000:])
            sys.exit("a test group fails unmutated: mutation results would be meaningless")
    for m in M:
        mid, origin, area, desc, path, old, new, tests = m[:8]
        extra = m[8] if len(m) > 8 else []
        if only and mid not in only:
            continue
        if old == "@@NOT-APPLICABLE@@":
            print(f"{mid} [{area}] {desc}: NOT APPLICABLE", flush=True)
            results.append({"id": mid, "origin": origin, "area": area, "mutation": desc, "result": "NOT APPLICABLE"})
            continue
        restore()
        p = os.path.join(W, path)
        src = open(p).read()
        applied = old in src
        src = src.replace(old, new, 1)
        for o, n in extra:
            applied &= o in src
            src = src.replace(o, n, 1)
        if not applied:
            print(mid, "PATTERN NOT FOUND", flush=True)
            results.append({"id": mid, "origin": origin, "area": area, "mutation": desc, "result": "NOT APPLIED (pattern not found)"})
            continue
        open(p, "w").write(src)
        t0 = time.time()
        failed_in = []
        compile_error = False
        for t in tests:
            r = run(t)
            if r.returncode != 0:
                if t[0] != "PY" and ("error[E" in r.stderr or "could not compile" in r.stderr):
                    compile_error = True
                    failed_in.append(" ".join(t) + " (COMPILE ERROR)")
                    print(r.stderr[-3000:])
                else:
                    failed_in.append(" ".join(t) + ": " + ", ".join(failed_names(r, t)))
        verdict = "INVALID (compile error)" if compile_error else ("KILLED" if failed_in else "SURVIVED")
        print(f"{mid} [{area}] {desc}: {verdict} ({time.time() - t0:.0f} s) {failed_in}", flush=True)
        results.append({"id": mid, "origin": origin, "area": area, "mutation": desc, "file": path, "result": verdict,
                        "failing_tests": failed_in, "tests_run": [" ".join(t) for t in tests]})
        restore()
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=W, capture_output=True, text=True).stdout.strip()
    rustc = subprocess.run(["rustc", "+stable", "--version"], capture_output=True, text=True).stdout.strip()
    json.dump({"commit": commit, "rustc": rustc, "baseline": base_ok, "mutations": results},
              open(os.environ.get("MUT_OUT", "mutation_results.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
