#!/usr/bin/env python3
"""Mutation checks for the post-remediation audit.

Each mutation deliberately breaks one piece of production logic in a separate git worktree
(never the audited checkout), runs the regression tests that claim to guard it, records whether
they FAIL (mutation killed = the tests protect the logic) or PASS (mutation survived = the tests
do not protect it), and restores the file.
"""
import json, os, subprocess, sys, time

S = os.path.dirname(os.path.abspath(__file__))
W = "/home/user/mut-wt"
ENV = dict(os.environ, CARGO_TARGET_DIR="/home/user/tgt-mut", CARGO_TERM_COLOR="never")

SLOTS = "crates/z30-engine/src/slots.rs"
WALL = "crates/z30-io/src/wallclock.rs"
CODEC = "crates/z30-protocol/src/codec.rs"
GATE = "crates/z30-engine/src/txgate.rs"
QSO = "crates/z30-engine/src/qso.rs"
LOGB = "crates/z30-io/src/logbook.rs"
SIC = "crates/z30-dsp/src/sic.rs"
DEMOD = "crates/z30-dsp/src/demod.rs"

T_C01 = [["-p", "z30-engine", "--test", "live_runtime"], ["-p", "z30-engine", "--test", "virtual_clock"]]
T_C03 = [["-p", "z30-io", "--lib"]]
T_C06 = [["-p", "z30-protocol"], ["-p", "z30-engine", "--test", "safety"]]
T_LOG = [["-p", "z30-engine", "--test", "qso_logging"], ["-p", "z30-io", "--test", "logbook_integrity"], ["-p", "z30-io", "--lib"],
         ["-p", "z30-engine", "--test", "virtual_clock"]]
T_SIC = [["-p", "z30-dsp", "--test", "sic_regression"], ["-p", "z30-dsp", "--test", "channel_scenarios"]]
T_SNR = [["-p", "z30-dsp", "--test", "snr_accuracy"], ["-p", "z30-engine", "--test", "qso_logging"]]

M = [
    # id, area, description, file, old, new, tests
    ("C01-a", "C-01", "window shortened by 0.5 s (ends at slot + 25.0 s)", SLOTS,
     "pub const WINDOW_END_SEC: f64 = FRAME_SEC + DT_SEARCH_SEC;", "pub const WINDOW_END_SEC: f64 = FRAME_SEC + DT_SEARCH_SEC - 0.5;", T_C01),
    ("C01-b", "C-01", "decode triggered 0.5 s early; missing tail zero-padded (the legacy defect)", SLOTS,
     "if end > store.end() as f64 {", "if end - 3000.0 > store.end() as f64 {", T_C01,
     [("match store.read(first as u64, window_len) {",
       "match store.read(first as u64, window_len - 3000).map(|mut v| { v.resize(window_len, 0.0); v }) {")]),
    ("C01-c", "C-01", "slot boundary shifted by +100 ms", SLOTS,
     "let t0 = slot_start(slot) + WINDOW_START_SEC;", "let t0 = slot_start(slot) + WINDOW_START_SEC + 0.1;", T_C01),
    ("C01-d", "C-01", "slot boundary shifted by +5 ms (30 samples)", SLOTS,
     "let t0 = slot_start(slot) + WINDOW_START_SEC;", "let t0 = slot_start(slot) + WINDOW_START_SEC + 0.005;", T_C01),
    ("C01-e", "C-01", "final 0.1 s of the window zeroed", SLOTS,
     "Some(samples) => out.push(SlotEvent::Ready(SlotJob { slot, first_index: first as u64, samples, window_start_utc: t0 })),",
     "Some(mut samples) => { let n = samples.len(); samples[n - 600..].fill(0.0); out.push(SlotEvent::Ready(SlotJob { slot, first_index: first as u64, samples, window_start_utc: t0 })) }",
     T_C01),
    ("C03-a", "C-03", "'synchronised' claimed when timedatectl could not be run", WALL,
     'Some("yes") => "system clock NTP-synchronised (timedatectl)".into(),',
     'Some("yes") | None => "system clock NTP-synchronised (timedatectl)".into(),', T_C03),
    ("C03-b", "C-03", "an own time offset of +0.7 s applied to UTC", WALL,
     "map(|d| d.as_secs_f64()).unwrap_or(0.0)", "map(|d| d.as_secs_f64() + 0.7).unwrap_or(0.0)", T_C03),
    ("C03-c", "C-03", "an own time offset of +0.3 s applied to UTC", WALL,
     "map(|d| d.as_secs_f64()).unwrap_or(0.0)", "map(|d| d.as_secs_f64() + 0.3).unwrap_or(0.0)", T_C03),
    ("C06-a", "C-06", "verify_round_trip always succeeds", CODEC,
     "let fail = || CodecError::RoundTripFailed(self.message.to_string());",
     "if true { return Ok(()); }\n        let fail = || CodecError::RoundTripFailed(self.message.to_string());", T_C06),
    ("C06-b", "C-06", "transmit gate no longer calls verify_round_trip", GATE,
     "if let Err(e) = enc.verify_round_trip() {", "if let Err(e) = { let _ = &enc; Ok::<(), CodecError>(()) } {", T_C06),
    ("C06-c", "C-06", "encoder's payload round-trip check removed", CODEC,
     "if unpack_payload(&payload).to_message().as_ref() != Some(self) {", "if false && unpack_payload(&payload).to_message().as_ref() != Some(self) {", T_C06),
    ("C06-d", "C-06", "gate no longer checks the frame is sent from this station", GATE,
     "if my_call.as_ref() != Some(&m.from) {", "if false && my_call.as_ref() != Some(&m.from) {", T_C06),
    ("C06-e", "C-06", "encoder hashes an off-table grid onto the table (legacy FN42->RE78), round-trip checks intact", CODEC,
     "g.v1_code().map(|_| Extra::Grid(g.clone())).ok_or_else(|| CodecError::GridNotInTable(g.0.clone()))",
     "Ok(Extra::Grid(g.clone()))", T_C06,
     [('Extra::Grid(g) => g.v1_code().expect("validated at construction"),', "Extra::Grid(g) => g.v1_code().unwrap_or(64),"),
      ("(_, Extra::Grid(g)) if g.v1_code().is_none() =>", "(_, Extra::Grid(g)) if false && g.v1_code().is_none() =>")]),
    ("LOG-a", "C-05", "QsoRecord::validate always accepts", QSO,
     "if self.call.trim().is_empty() {", "if true { return Ok(()); }\n        if self.call.trim().is_empty() {", T_LOG),
    ("LOG-b", "C-05", "missing grid logged as FN31", QSO,
     "grid: self.dx.grid.as_ref().map(|g| Sourced::new(g.to_string(), Provenance::Received)),",
     'grid: Some(self.dx.grid.as_ref().map(|g| Sourced::new(g.to_string(), Provenance::Received)).unwrap_or(Sourced::new("FN31".into(), Provenance::Received))),',
     T_LOG),
    ("LOG-c", "C-05", "missing received report logged as -16", QSO,
     "rst_rcvd: self.dx.rst_rcvd.map(|r| Sourced::new(r, Provenance::Received)),",
     "rst_rcvd: Some(Sourced::new(self.dx.rst_rcvd.unwrap_or(-16), Provenance::Received)),", T_LOG),
    ("LOG-d", "C-05/M-07", "unmeasured SNR produces a -16 report", QSO,
     "snr_db.filter(|v| v.is_finite()).map(|v| v.round().clamp(-30.0, 30.0) as i8)",
     "snr_db.filter(|v| v.is_finite()).map(|v| v.round().clamp(-30.0, 30.0) as i8).or(Some(-16))", T_LOG),
    ("LOG-e", "C-05", "UTC shifted by +1 h (local time written as UTC)", LOGB,
     "let secs = t.floor() as i64;", "let secs = t.floor() as i64 + 3600;", T_LOG),
    ("LOG-f", "C-05", "validate accepts start times before 2020", QSO,
     "if !self.start_utc.is_finite() || self.start_utc < EARLIEST_QSO_UTC {", "if !self.start_utc.is_finite() {", T_LOG),
    ("SIC-a", "SIC", "subtraction computes but does not modify the residual", SIC,
     "        energy += v * v;\n        x[j] -= v as f32;", "        energy += v * v;\n        let _ = &x[j];", T_SIC),
    ("SIC-b", "SIC", "only half of the fitted component subtracted", SIC,
     "        energy += v * v;\n        x[j] -= v as f32;", "        energy += v * v;\n        x[j] -= 0.5 * v as f32;", T_SIC),
    ("SIC-c", "SIC", "the station's span is zeroed instead of subtracted", SIC,
     "        energy += v * v;\n        x[j] -= v as f32;", "        energy += v * v;\n        x[j] = 0.0;", T_SIC),
    ("SNR-a", "M-07", "noise taken from the received off-tone bins (the audited saturating estimator)", DEMOD,
     "resid.push((y[b] - g * r[b]).norm_sqr());", "resid.push(y[b].norm_sqr());", T_SNR),
    ("SNR-b", "M-07", "SNR clipped at +6.6 dB", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "(s > 0.0).then(|| (10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10()).min(6.6))", T_SNR),
    ("SNR-c", "M-07", "SNR is a constant -16 dB", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "{ let _ = s; Some(-16.0) }", T_SNR),
    ("SNR-d", "M-07", "LS-projection noise bias correction removed", DEMOD,
     "let s = (s_sum - n_bin * bias_sum) / TOTAL_SYMBOLS as f64;", "let s = { let _ = bias_sum; s_sum / TOTAL_SYMBOLS as f64 };", T_SNR),
    ("SNR-e", "M-07", "no-estimate case floored to -30 dB instead of None", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "Some(if s > 0.0 { 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10() } else { -30.0 })", T_SNR),
    ("SNR-f", "M-07", "SNR biased by +1.0 dB", DEMOD,
     "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
     "(s > 0.0).then(|| 1.0 + 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())", T_SNR),
]


def run(args):
    return subprocess.run(["cargo", "+stable", "test", "--locked"] + args, cwd=W, env=ENV, capture_output=True, text=True)


def restore():
    subprocess.run(["git", "checkout", "--", "."], cwd=W, check=True)


def main():
    only = set(sys.argv[1:])
    results = []
    restore()
    # Baseline: every test group passes unmutated, under the same load.
    groups = {tuple(map(tuple, t)) for m in M for t in [m[6]]}
    base_ok = {}
    for g in groups:
        ok = all(run(list(t)).returncode == 0 for t in g)
        base_ok[g] = ok
        print("baseline", [" ".join(t) for t in g], "PASS" if ok else "FAIL", flush=True)
    for m in M:
        mid, area, desc, path, old, new, tests = m[:7]
        extra = m[7] if len(m) > 7 else []
        if only and mid not in only:
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
            results.append({"id": mid, "area": area, "mutation": desc, "result": "NOT APPLIED"})
            continue
        open(p, "w").write(src)
        t0 = time.time()
        failed_in = []
        compile_error = False
        for t in tests:
            r = run(t)
            if r.returncode != 0:
                if "error[E" in r.stderr or "could not compile" in r.stderr:
                    compile_error = True
                    failed_in.append(" ".join(t) + " (COMPILE ERROR)")
                    print(r.stderr[-3000:])
                else:
                    names = [l.split()[1] for l in r.stdout.splitlines() if l.startswith("test ") and l.rstrip().endswith("FAILED")]
                    failed_in.append(" ".join(t) + ": " + ", ".join(names))
        verdict = "INVALID (compile error)" if compile_error else ("KILLED" if failed_in else "SURVIVED")
        print(f"{mid} [{area}] {desc}: {verdict} ({time.time() - t0:.0f} s) {failed_in}", flush=True)
        results.append({"id": mid, "area": area, "mutation": desc, "file": path, "result": verdict, "failing_tests": failed_in,
                        "tests_run": [" ".join(t) for t in tests]})
        restore()
    json.dump({"baseline": {" | ".join(" ".join(t) for t in g): ok for g, ok in base_ok.items()}, "mutations": results},
              open(os.environ.get("MUT_OUT", os.path.join(S, "mutation_results.json")), "w"), indent=2)


if __name__ == "__main__":
    main()
