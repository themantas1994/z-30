#!/usr/bin/env python3
"""Transmit-safety mutation run, whole-project audit at caf1a9a. Pattern of
audit/2026-09-24-corrective-remediation/evidence/scripts/mutate_corrective.py: one mutation at a
time in a separate worktree, targeted test binaries, restore after each.
Usage: W=<worktree> CARGO_TARGET_DIR=<dir> MUT_OUT=<json> python3 mutate_tx.py [IDs...]"""
import json, os, subprocess, sys, time

W = os.environ["W"]
ENV = dict(os.environ, CARGO_TERM_COLOR="never", CARGO_BUILD_JOBS=os.environ.get("CARGO_BUILD_JOBS", "3"))

WALL = "crates/z30-io/src/wallclock.rs"
CODEC = "crates/z30-protocol/src/codec.rs"
GATE = "crates/z30-engine/src/txgate.rs"
ENGINE = "crates/z30-engine/src/engine.rs"
RT = "crates/z30-engine/src/runtime.rs"
PTT = "crates/z30-engine/src/ptt.rs"
RIG = "crates/z30-engine/src/rig.rs"
QSO = "crates/z30-engine/src/qso.rs"
DEMOD = "crates/z30-dsp/src/demod.rs"
LOOP = "crates/z30-cli/src/loopback.rs"
ALOOP = "crates/z30-cli/src/audio_loopback.rs"

SAFETY = ["-p", "z30-engine", "--test", "safety"]
EMERG = ["-p", "z30-engine", "--test", "emergency"]
DIALP = ["-p", "z30-engine", "--test", "dial_provenance"]
QSOL = ["-p", "z30-engine", "--test", "qso_logging"]
ENGLIB = ["-p", "z30-engine", "--lib"]
ENGALL = ["-p", "z30-engine", "--tests"]          # every engine test binary incl. live_runtime, virtual_clock
PROTO = ["-p", "z30-protocol"]
IOLIB = ["-p", "z30-io", "--lib"]
LOGINT = ["-p", "z30-io", "--test", "logbook_integrity"]
CLIALL = ["-p", "z30-cli"]
SNR = ["-p", "z30-dsp", "--test", "snr_accuracy"]

T_GATE = [SAFETY, ENGLIB, DIALP]
T_PTT = [SAFETY, EMERG, ENGLIB]
LIVE = ["-p", "z30-engine", "--test", "live_runtime"]
# every test binary that runs runtime::start (grep), plus the transmit-safety suite
T_RT = [SAFETY, DIALP, LIVE]
T_TXAUDIO = [SAFETY, CLIALL]
T_LOG = [QSOL, ENGLIB, LOGINT, IOLIB, DIALP]

M = [
 # ---- re-check of the post-remediation audit's survivors
 ("C03-c", "own +0.3 s offset applied to UTC", WALL, "Ok(d) => d.as_secs_f64(),", "Ok(d) => d.as_secs_f64() + 0.3,", [IOLIB]),
 ("C06-a", "verify_round_trip always Ok", CODEC,
  "let fail = || CodecError::RoundTripFailed(self.message.to_string());",
  "if true { return Ok(()); }\n        let fail = || CodecError::RoundTripFailed(self.message.to_string());", [PROTO, SAFETY]),
 ("C06-b", "verify() makes a VerifiedFrame without the round trip", CODEC,
  "        self.verify_round_trip()?;\n        Ok(VerifiedFrame(self))", "        let _ = self.verify_round_trip();\n        Ok(VerifiedFrame(self))", [PROTO, SAFETY]),
 ("LOG-c", "missing received report logged as -16", QSO,
  "rst_rcvd: self.dx.rst_rcvd.map(|r| Sourced::new(r, Provenance::Received)),",
  "rst_rcvd: Some(Sourced::new(self.dx.rst_rcvd.unwrap_or(-16), Provenance::Received)),", T_LOG),
 ("SNR-e", "no-estimate SNR floored to -30 dB instead of None", DEMOD,
  "(s > 0.0).then(|| 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10())",
  "Some(if s > 0.0 { 10.0 * (s / n_bin).log10() - 10.0 * (2500.0 / TONE_SPACING_HZ).log10() } else { -30.0 })", [SNR, QSOL]),
 # ---- the gate
 ("G-bw", "emission checked at 0 Hz width instead of the measured -40 dB width", GATE,
  "match find_permitted_segment(r, c, centre, OCCUPIED_40DB_HZ) {", "match find_permitted_segment(r, c, centre, 0.0) {", T_GATE),
 ("G-centre", "emission centred on tone 0 (tone span ignored)", GATE,
  "let centre = req.dial_hz + req.tx_audio_hz + span / 2.0;", "let centre = req.dial_hz + req.tx_audio_hz;", T_GATE),
 ("G-top", "upper audio limit checks tone 0 instead of tone 15", GATE,
  "req.tx_audio_hz + span > MAX_TX_AUDIO_TOP_HZ", "req.tx_audio_hz > MAX_TX_AUDIO_TOP_HZ", T_GATE),
 ("G-lsb", "emission computed as lower sideband", GATE,
  "let centre = req.dial_hz + req.tx_audio_hz + span / 2.0;", "let centre = req.dial_hz - req.tx_audio_hz - span / 2.0;", T_GATE),
 ("G-region", "missing region not refused", GATE,
  "    if region.is_none() {\n        v.push(Violation::NoRegion);", "    if false && region.is_none() {\n        v.push(Violation::NoRegion);", T_GATE),
 ("G-stable", "an unsettled QSY counts as a contradiction", RIG,
  "if !commanded_hz.is_finite() || !self.has_fresh_reading(now_ms) || !self.is_stable() {",
  "if !commanded_hz.is_finite() || !self.has_fresh_reading(now_ms) {", T_GATE),
 ("G-res", "tuning resolution ignored (1 Hz tolerance)", RIG,
  "    let (below, above) = resolution_error_bounds_hz(r);", "    let (below, above) = { let _ = r; (0.0, 0.0) };", T_GATE),
 ("G-nan", "NaN transmit level not refused", ENGINE,
  "if self.config.audio.tx_level.is_nan() || self.config.audio.tx_level <= 0.0 {", "if self.config.audio.tx_level <= 0.0 {", T_GATE),
 ("G-hwptt", "PTT not configured not refused", ENGINE,
  "        if self.config.ptt == crate::config::PttConfig::None {", "        if false {", T_GATE),
 ("G-hwopen", "unavailable TX hardware not refused", ENGINE,
  "        if let Some(p) = &self.tx_hardware_problem {", "        if let Some(p) = None::<&String> {", T_GATE),
 ("G-plan", "plan_tx trusts can_transmit's allowed (hardware refusals dropped)", ENGINE,
  "        if !perm.violations.is_empty() {\n            self.tx_enabled = false;", "        if !perm.allowed {\n            self.tx_enabled = false;", T_GATE),
 ("G-halt", "halt commands no longer abandon a planned transmission", ENGINE,
  "    fn halt_tx(&mut self) -> bool {\n        true", "    fn halt_tx(&mut self) -> bool {\n        false", T_GATE),
 # ---- what is verified is what is transmitted
 ("N3-sym", "tx_audio modulates the verified frame with one data symbol changed", RT,
  "let w = m.synthesize(frame.symbols(), plan.tx_audio_hz).map_err(|e| e.to_string())?;",
  "let mut s = *frame.symbols(); s[z30_protocol::DATA_POSITIONS[20]] ^= 1; let w = m.synthesize(&s, plan.tx_audio_hz).map_err(|e| e.to_string())?;", T_TXAUDIO),
 ("N3-freq", "tx_audio transmits 50 Hz above the frequency the gate checked", RT,
  "let w = m.synthesize(frame.symbols(), plan.tx_audio_hz).map_err(|e| e.to_string())?;",
  "let w = m.synthesize(frame.symbols(), plan.tx_audio_hz + 50.0).map_err(|e| e.to_string())?;", T_TXAUDIO),
 ("N3-level", "tx_audio no longer limits the level to full scale", RT,
  "    let level = level.clamp(0.0, 1.0);", "    let level = level.max(0.0);", T_TXAUDIO),
 # ---- PTT
 ("P-max", "MAX_TX_SECONDS raised to 400", PTT, "pub const MAX_TX_SECONDS: u64 = 40;", "pub const MAX_TX_SECONDS: u64 = 400;", T_PTT),
 ("P-hook", "panic hook no longer releases PTT", PTT, "        emergency_release_all();\n        prev(info);", "        prev(info);", T_PTT),
 ("P-drop", "Drop of a keyed controller does not release", PTT,
  "            let line = self.line.get_mut().unwrap_or_else(|p| p.into_inner());\n            let _ = line.set(false);",
  "            let _line = self.line.get_mut().unwrap_or_else(|p| p.into_inner());", T_PTT),
 ("P-emerg", "emergency_release_all releases nothing", PTT,
  "            let _ = s.release(ReleaseCause::Emergency);", "            let _ = &s;", T_PTT),
 ("P-keyfail", "a refused key is not released", PTT,
  "            let _ = self.shared.release(ReleaseCause::Emergency);\n            self.shared.deadline_ms", "            self.shared.deadline_ms", T_PTT),
 ("P-wdcmp", "watchdog fires one tick late (> instead of >=)", PTT,
  "if self.is_keyed() && now >= self.shared.deadline_ms.load(Ordering::SeqCst) {", "if self.is_keyed() && now > self.shared.deadline_ms.load(Ordering::SeqCst) {", T_PTT),
 ("P-wdthread", "watchdog thread never ticks", PTT, "                c.watchdog_tick();", "                let _ = &c;", T_PTT),
 ("P-clamp", "with_limit no longer clamps the limit to MAX_TX_SECONDS", PTT,
  "            limit_ms: limit_ms.min(MAX_TX_SECONDS * 1000),", "            limit_ms,", T_PTT),
 # ---- runtime (production control loop)
 ("RT-halt", "runtime ignores the engine's halt while planned/keyed", RT,
  "if halt && txs.busy() {", "if false && halt && txs.busy() {", T_RT),
 ("RT-wd", "runtime ignores a watchdog release (audio keeps playing, TX not faulted)", RT,
  "if ptt2.watchdog_fired() && txs.busy() {", "if false && ptt2.watchdog_fired() && txs.busy() {", T_RT),
 ("RT-keyfail", "a refused key still plays the audio", RT,
  "                                    Err(e) => {\n                                        txs.abort();\n                                        plan = None;\n                                        audio = None;",
  "                                    Err(e) => {", T_RT),
 ("RT-unkey", "end of frame stops audio but does not unkey", RT,
  "                                TxAction::Unkey { completed } => {\n                                    output.stop();\n                                    let _ = ptt2.unkey();",
  "                                TxAction::Unkey { completed } => {\n                                    output.stop();", T_RT),
 # ---- loopback isolation
 ("LOOP-b", "audio loopback refusal lets VOX through", ALOOP,
  "if cfg.ptt != PttConfig::None {", "if !matches!(cfg.ptt, PttConfig::None | PttConfig::Vox) {", [CLIALL]),
 ("LOOP-e", "software loopback reaches the sound-card test via crate:: (unreachable at run time)", LOOP,
  "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n",
  "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n    if std::env::var_os(\"Z30_MUTANT_NEVER_SET_7f3a\").is_some() { let _ = crate::audio_loopback::run(&z30_engine::config::Config::default(), true, None); }\n", [CLIALL]),
 # ---- logged values
 ("DIAL-a", "a configured dial is logged as commanded", ENGINE,
  "(None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Configured)),", "(None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Commanded)),", T_LOG),
 ("PWR-a", "configured TX power logged as measured", ENGINE,
  "configured_tx_power_w.map(|p| Sourced::new(p, Provenance::Configured));", "configured_tx_power_w.map(|p| Sourced::new(p, Provenance::Measured));", T_LOG),
 ("LOG-p", "validate accepts a record with no partner", QSO,
  "if self.call.trim().is_empty() {", "if false && self.call.trim().is_empty() {", T_LOG),
]

def run(t):
    return subprocess.run(["cargo", "+1.95", "test", "--locked"] + t, cwd=W, env=ENV, capture_output=True, text=True)

def restore():
    subprocess.run(["git", "checkout", "--", "."], cwd=W, check=True)

def failed_names(r):
    return [l.split()[1] for l in r.stdout.splitlines() if l.startswith("test ") and l.rstrip().endswith("FAILED")]

def main():
    only = set(sys.argv[1:])
    out = os.environ.get("MUT_OUT", "mut.json")
    results = json.load(open(out))["mutations"] if os.path.exists(out) else []
    done = {r["id"] for r in results}
    for m in M:
        mid, desc, path, old, new, tests = m
        if (only and mid not in only) or mid in done:
            continue
        restore()
        p = os.path.join(W, path)
        src = open(p).read()
        n = src.count(old)
        if n == 0:
            print(mid, "PATTERN NOT FOUND", flush=True)
            results.append({"id": mid, "mutation": desc, "file": path, "result": "NOT APPLIED"}); continue
        line = src[:src.index(old)].count("\n") + 1
        open(p, "w").write(src.replace(old, new, 1))
        t0 = time.time(); failed = []; comp = False
        for t in tests:
            r = run(t)
            if r.returncode != 0:
                if "error[E" in r.stderr or "could not compile" in r.stderr:
                    comp = True; failed.append(" ".join(t) + " (COMPILE ERROR)"); print(r.stderr[-2500:])
                else:
                    failed.append(" ".join(t) + ": " + ", ".join(failed_names(r)))
        v = "INVALID (compile error)" if comp else ("KILLED" if failed else "SURVIVED")
        print(f"{mid} {path}:{line} [{desc}] {v} ({time.time()-t0:.0f} s) {failed}", flush=True)
        results.append({"id": mid, "mutation": desc, "file": f"{path}:{line}", "occurrences": n, "result": v, "failing": failed,
                        "tests_run": [" ".join(t) for t in tests]})
        restore()
        json.dump({"commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=W, capture_output=True, text=True).stdout.strip(),
                   "mutations": results}, open(out, "w"), indent=2)

if __name__ == "__main__":
    main()
