#!/usr/bin/env python3
"""Transmit-safety mutation run, v3: v2's mutants re-targeted at the post-review code, plus one
mutant per fix made for the post-remediation code review (M-1, M-2, L-1, L-3, L-4, L-5).

v2 (kept unchanged as the evidence of runs 1 and 2) was the run for the 2026-09-28 remediation
(Phase 1). Four v2 patterns no longer match the reviewed code (N3-level, RT-haltptt, RT-haltstop,
WALL-block) and are re-targeted here with the same intent.

Re-targets every mutation of audit/2026-09-28-agent-team-review/evidence/tx-mutation/mutate_tx.py
(same IDs, same intent) at the remediated code, and adds one mutation per guarantee the
remediation introduced. One mutation at a time in a separate worktree, the targeted test
binaries, restored after each. A mutation whose pattern is not found is reported NOT APPLIED
(never silently skipped); one that does not compile is INVALID.

Usage: W=<worktree> CARGO_TARGET_DIR=<dir> MUT_OUT=<json> python3 mutate_tx_v3.py [IDs...]
"""
import json, os, subprocess, sys, time

W = os.environ["W"]
ENV = dict(os.environ, CARGO_TERM_COLOR="never", CARGO_BUILD_JOBS=os.environ.get("CARGO_BUILD_JOBS", "3"))

WALL = "crates/z30-io/src/wallclock.rs"
CODEC = "crates/z30-protocol/src/codec.rs"
GATE = "crates/z30-engine/src/txgate.rs"
BAND = "crates/z30-engine/src/bandplan.rs"
ENGINE = "crates/z30-engine/src/engine.rs"
RT = "crates/z30-engine/src/runtime.rs"
PTT = "crates/z30-engine/src/ptt.rs"
RIG = "crates/z30-engine/src/rig.rs"
SLOTS = "crates/z30-engine/src/slots.rs"
QSO = "crates/z30-engine/src/qso.rs"
DEMOD = "crates/z30-dsp/src/demod.rs"
LOOP = "crates/z30-cli/src/loopback.rs"
ALOOP = "crates/z30-cli/src/audio_loopback.rs"
MIG = "crates/z30-io/src/migrate.rs"
AUDIO = "crates/z30-io/src/audio.rs"
CM108 = "crates/z30-io/src/cm108.rs"
RIGCTLD = "crates/z30-io/src/rigctld.rs"

def e(test):
    return ["-p", "z30-engine", "--test", test]
SAFETY, EMERG, DIALP, QSOL = e("safety"), e("emergency"), e("dial_provenance"), e("qso_logging")
PTTR, PTTP, TXRT, GC, CLK, LIVE, VCLK = e("ptt_release"), e("ptt_panic"), e("tx_runtime"), e("gate_contract"), e("clock_step"), e("live_runtime"), e("virtual_clock")
ENGLIB = ["-p", "z30-engine", "--lib"]
PROTO = ["-p", "z30-protocol"]
IOLIB = ["-p", "z30-io", "--lib"]
IOCM = ["-p", "z30-io", "--lib", "--features", "cm108"]
IOALLOC = ["-p", "z30-io", "--test", "callback_alloc"]
LOGINT = ["-p", "z30-io", "--test", "logbook_integrity"]
CLIALL = ["-p", "z30-cli"]
SNR = ["-p", "z30-dsp", "--test", "snr_accuracy"]

T_GATE = [SAFETY, GC, ENGLIB, DIALP]
T_PTT = [SAFETY, EMERG, PTTR, PTTP, ENGLIB]
T_RT = [TXRT, SAFETY, DIALP, LIVE]
T_TXAUDIO = [SAFETY, GC, CLIALL]
T_LOG = [QSOL, GC, ENGLIB, LOGINT, IOLIB, DIALP]

M = [
 # ---- re-check of the post-remediation audit's survivors (unchanged code)
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
 # ---- the gate (F-05, F-07, F-22)
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
  "        if !commanded_hz.is_finite() || !self.is_stable() {", "        if !commanded_hz.is_finite() {", T_GATE),
 ("G-res", "tuning resolution ignored (1 Hz tolerance)", RIG,
  "    let (below, above) = resolution_error_bounds_hz(r);", "    let (below, above) = { let _ = r; (0.0, 0.0) };", T_GATE),
 ("G-nan", "NaN transmit level not refused", GATE,
  "    if hw.tx_level.is_nan() || hw.tx_level > 1.0 {", "    if hw.tx_level > 1.0 {", T_GATE),
 ("G-over", "transmit level above full scale not refused", GATE,
  "    if hw.tx_level.is_nan() || hw.tx_level > 1.0 {", "    if hw.tx_level.is_nan() {", T_GATE),
 ("G-hwptt", "PTT not configured not refused", GATE,
  "    if *hw.ptt == PttConfig::None {", "    if false {", T_GATE),
 ("G-hwopen", "unavailable TX hardware not refused", GATE,
  "    for p in hw.problems {", "    for p in hw.problems.iter().take(0) {", T_GATE),
 ("G-relpend", "an unconfirmed PTT release not refused by the gate", GATE,
  "    if let Some(why) = hw.ptt_release_unconfirmed {", "    if let Some(why) = hw.ptt_release_unconfirmed.filter(|_| false) {", T_GATE + [TXRT]),
 ("G-dialref", "a refused dial not refused by the gate", GATE,
  "    if let Some(hz) = hw.dial_refused {", "    if let Some(hz) = hw.dial_refused.filter(|_| false) {", T_GATE),
 ("G-plan", "plan_tx trusts only the violation list (a frame request with no frame passes)", ENGINE,
  "        if !perm.allowed {\n            self.tx_enabled = false;", "        if !perm.violations.is_empty() {\n            self.tx_enabled = false;", T_GATE),
 ("G-halt", "halt commands no longer abandon a planned transmission", ENGINE,
  "    fn halt_tx(&mut self) -> bool {\n        true", "    fn halt_tx(&mut self) -> bool {\n        false", T_GATE + [TXRT]),
 ("G-hwprob", "the engine hands the gate no hardware problems (output fault ignored)", ENGINE,
  "        let problems = self.hardware_problems();", "        let problems: Vec<String> = Vec::new();", T_GATE + [TXRT]),
 # ---- band plan (F-02)
 ("B-6m", "US 6 m data segment starts at 50.0 MHz (CW-only sub-band cleared)", BAND,
  'seg!("6m", 50_100_000, 54_000_000, US_ALL),', 'seg!("6m", 50_000_000, 54_000_000, US_ALL),', [ENGLIB, GC]),
 ("B-2m", "US 2 m data segment starts at 144.0 MHz", BAND,
  'seg!("2m", 144_100_000, 148_000_000, US_ALL),', 'seg!("2m", 144_000_000, 148_000_000, US_ALL),', [ENGLIB, GC]),
 ("B-60c", "US 60 m channel centring not enforced (anywhere inside the 2.8 kHz)", BAND,
  "            && s.channel_centre_hz.is_none_or(|c| (freq_hz - c as f64).abs() <= US_60M_CENTRE_TOLERANCE_HZ)",
  "            && s.channel_centre_hz.is_none_or(|_| true)", [ENGLIB, GC]),
 # ---- what is verified is what is transmitted (F-03, F-07, F-49)
 ("N3-sym", "tx_audio modulates the verified frame with one data symbol changed", RT,
  "    let w = m.synthesize(frame.symbols(), tx_audio_hz).map_err(|e| e.to_string())?;",
  "    let mut s = *frame.symbols(); s[z30_protocol::DATA_POSITIONS[20]] ^= 1; let w = m.synthesize(&s, tx_audio_hz).map_err(|e| e.to_string())?;", T_TXAUDIO),
 ("N3-freq", "tx_audio transmits 50 Hz above the frequency the gate checked", RT,
  "        TxKind::Frame(frame) => frame_audio(frame, plan.tx_audio_hz(), rate, plan.tx_level()),",
  "        TxKind::Frame(frame) => frame_audio(frame, plan.tx_audio_hz() + 50.0, rate, plan.tx_level()),", T_TXAUDIO),
 ("N3-level", "frame_audio no longer limits the level to full scale", RT,
  "    if level.is_nan() {\n        0.0\n    } else {\n        level.clamp(0.0, 1.0)\n    }", "    if level.is_nan() {\n        0.0\n    } else {\n        level.max(0.0)\n    }", T_TXAUDIO),
 ("N3-plvl", "tx_audio uses a fixed level instead of the level the gate checked", RT,
  "        TxKind::Frame(frame) => frame_audio(frame, plan.tx_audio_hz(), rate, plan.tx_level()),",
  "        TxKind::Frame(frame) => frame_audio(frame, plan.tx_audio_hz(), rate, 0.25),", T_TXAUDIO),
 ("TUNE-lin", "Tune generated as a hand-made sine outside the modulator", RT,
  "            let w = m.synthesize(&[0u8; TOTAL_SYMBOLS], centre).map_err(|e| e.to_string())?;",
  "            let w: Vec<f32> = { let _ = &m; (0..m.frame_len()).map(|i| (std::f64::consts::TAU * centre * i as f64 / rate as f64).sin() as f32).collect() };", [GC, SAFETY]),
 # ---- PTT (F-01, F-06, F-15, F-44)
 ("P-max", "MAX_TX_SECONDS raised to 400", PTT, "pub const MAX_TX_SECONDS: u64 = 40;", "pub const MAX_TX_SECONDS: u64 = 400;", T_PTT),
 ("P-hook", "panic hook no longer releases PTT", PTT, "        emergency_release_all();\n        prev(info);", "        prev(info);", T_PTT),
 ("P-drop", "Drop of a keyed controller does not release", PTT,
  "            let line = self.line.get_mut().unwrap_or_else(|p| p.into_inner());\n            let _ = Shared::drive(line, false);",
  "            let _line = self.line.get_mut().unwrap_or_else(|p| p.into_inner());", T_PTT),
 ("P-emerg", "emergency_release_all releases nothing", PTT,
  "        all &= s.release_bounded(ReleaseCause::Emergency, EMERGENCY_LOCK_WAIT_MS);", "        let _ = &s;", T_PTT),
 ("P-keyfail", "a refused key is not released", PTT,
  "            let _ = s.release_locked(&mut line, ReleaseCause::Emergency);\n            return r.and(", "            return r.and(", T_PTT),
 ("P-wdcmp", "watchdog fires one tick late (> instead of >=)", PTT,
  "            KEYED if now >= s.deadline_ms.load(Ordering::SeqCst) => {", "            KEYED if now > s.deadline_ms.load(Ordering::SeqCst) => {", T_PTT),
 ("P-wdthread", "watchdog thread never ticks", PTT, "                c.watchdog_tick();", "                let _ = &c;", T_PTT),
 ("P-clamp", "with_limit no longer clamps the limit to MAX_TX_SECONDS", PTT,
  "            limit_ms: limit_ms.min(MAX_TX_SECONDS * 1000),", "            limit_ms,", T_PTT),
 ("P-relflag", "F-01 regression: a failed release is recorded as released", PTT,
  "            Err(e) => {\n                self.state.store(RELEASE_PENDING, Ordering::SeqCst);",
  "            Err(e) => {\n                self.state.store(RELEASED, Ordering::SeqCst);", T_PTT + [TXRT]),
 ("P-retry", "the watchdog no longer retries an unconfirmed release", PTT,
  "                        let _ = s.release_locked(&mut line, ReleaseCause::Retry);", "                        let _ = &line;", T_PTT + [TXRT]),
 ("P-rekey", "a line whose release is unconfirmed can be keyed again", PTT,
  "            Err(KEYED) => {}\n            Err(_) => {", "            Err(_) if true => {}\n            Err(_) => {", T_PTT),
 ("P-rearm", "F-44 regression: every key re-arms the watchdog deadline", PTT,
  "            Err(KEYED) => {}", "            Err(KEYED) => s.deadline_ms.store(now + s.limit_ms, Ordering::SeqCst),", T_PTT),
 ("P-unwind", "F-15 regression: a driver panic is not caught", PTT,
  "        let r = catch_unwind(AssertUnwindSafe(|| line.set(keyed)));", "        let r: Result<_, ()> = Ok(line.set(keyed));", T_PTT),
 ("P-wdblock", "the watchdog blocks on the line instead of try_lock", PTT,
  "            KEYED if now >= s.deadline_ms.load(Ordering::SeqCst) => {\n                s.watchdog_fired.store(true, Ordering::SeqCst);\n                s.watchdog_unreported.store(true, Ordering::SeqCst);\n                s.mark_release_pending();\n                if let Some(mut line) = s.try_lock_line() {",
  "            KEYED if now >= s.deadline_ms.load(Ordering::SeqCst) => {\n                s.watchdog_fired.store(true, Ordering::SeqCst);\n                s.watchdog_unreported.store(true, Ordering::SeqCst);\n                s.mark_release_pending();\n                if let Some(mut line) = Some(s.lock_line()) {", T_PTT + [TXRT]),
 ("P-drivewait", "the emergency path waits for a line the current thread is driving", PTT,
  "        let wait_ms = if this_thread_is_driving() { 0 } else { wait_ms };", "        let wait_ms = if this_thread_is_driving() { 60_000 } else { wait_ms };", T_PTT),
 # ---- runtime: the production control loop (F-04, F-16, F-17, F-19, F-18, F-45, F-46, F-47)
 ("RT-halt", "runtime ignores the engine's halt while planned/keyed", RT,
  "                                if halt {\n                                    control.abort(", "                                if false && halt {\n                                    control.abort(", T_RT),
 ("RT-haltflag", "HALT's flag is never acted on by the control loop", RT,
  "        if !self.halt.swap(false, Ordering::SeqCst) {", "        if true || !self.halt.swap(false, Ordering::SeqCst) {", T_RT),
 ("RT-haltptt", "HALT does not release the PTT itself (waits for the control thread)", RT,
  "            stop();\n        }\n        self.ptt.request_release_in_background();\n    }", "            stop();\n        }\n    }", T_RT),
 ("RT-haltstop", "HALT does not silence the output itself", RT,
  "        if let Some(stop) = current_stopper(&self.stopper) {\n            stop();\n        }", "        if let Some(stop) = current_stopper(&self.stopper) {\n            let _ = stop;\n        }", T_RT),
 ("RT-wd", "runtime ignores a watchdog release (audio keeps playing, TX not faulted)", RT,
  "        if self.ptt.take_watchdog_release() {", "        if false && self.ptt.take_watchdog_release() {", T_RT),
 ("RT-keyfail", "a refused key still plays the audio", RT,
  "                    Err(e) => {\n                        self.txs.abort();\n                        self.audio = None;",
  "                    Err(e) => {", T_RT),
 ("RT-unkey", "end of frame stops audio but does not unkey", RT,
  "        let released = if keyed { self.ptt.unkey() } else { Ok(crate::ptt::PttAck::Confirmed) };",
  "        let released: Result<crate::ptt::PttAck, crate::ptt::PttError> = Ok(crate::ptt::PttAck::Confirmed);", T_RT),
 ("RT-relfault", "an unconfirmed release is not reported or refused by the runtime", RT,
  "            Err(e) => self.release_failed(&e.0),", "            Err(_e) => {}", T_RT),
 ("RT-outfail", "an output failure while keyed is ignored", RT,
  "        match self.output.failure() {", "        match None::<String> {", T_RT),
 ("RT-playstop", "a failed play leaves the partial frame queued", RT,
  "    fn finish(&mut self, outcome: TxOutcome) {\n        self.output.stop();", "    fn finish(&mut self, outcome: TxOutcome) {", T_RT),
 ("RT-lateend", "F-17 regression: the frame's end fixed before the audio actually starts", RT,
  "                        self.phase = TxPhase::Playing { end_at: now + self.output_latency + duration + PTT_TAIL_SEC };",
  "                        self.phase = TxPhase::Playing { end_at: audio_at + self.output_latency + duration + PTT_TAIL_SEC };", T_RT),
 ("RT-latekey", "a key far past its time is still sent", RT,
  "                    if now - key_at > MAX_KEY_LATENESS_SEC {", "                    if now - key_at > 1e9 {", T_RT),
 ("RT-latestart", "audio far past its time is still started", RT,
  "                    if now - audio_at > MAX_START_LATENESS_SEC {", "                    if now - audio_at > 1e9 {", T_RT),
 ("RT-partial", "a frame the device did not finish is reported complete", RT,
  "                        (TxOutcome::Complete, Some(q)) if q > 0 => TxOutcome::Partial(format!(", "                        (TxOutcome::Complete, Some(q)) if q > usize::MAX - 1 => TxOutcome::Partial(format!(", T_RT),
 ("RT-settle", "the rig thread polls inside the PTT settle window", RT,
  "        if !Self::cat_allowed(now_ms, last_ptt_change_ms) {\n            return false;\n        }", "", T_RT),
 ("RT-pollint", "the rig thread ignores poll_interval_ms", RT,
  "        RigPollSchedule { interval_ms: poll_interval_ms.max(MIN_POLL_INTERVAL_MS), next_ms: None }",
  "        RigPollSchedule { interval_ms: { let _ = poll_interval_ms; 1000 }, next_ms: None }", T_RT),
 ("RT-midtx", "a rig contradiction during a frame does not stop it", RT,
  "                    if !v.is_empty() {\n                        let why", "                    if false && !v.is_empty() {\n                        let why", T_RT + [GC]),
 ("RT-lat", "F-47 regression: output latency not read at plan time", RT,
  "                            self.txs.set_output_latency(self.output.latency_sec());", "", T_RT),
 ("RT-outcome", "only-Complete-advances regression: any outcome advances the QSO", ENGINE,
  "        if *outcome == TxOutcome::Complete && was_frame {", "        if was_frame {", T_RT + [GC]),
 ("RT-logpersist", "Event::Logged emitted before the logbook wrote the contact", ENGINE,
  "                            Ok(()) => self.events.push(Event::ContactComplete(rec)),", "                            Ok(()) => self.events.push(Event::Logged(rec)),", T_LOG + [TXRT]),
 # ---- rig readback (F-18, F-45)
 ("RIG-stale", "a mode the poll did not read is re-dated as fresh", RIG,
  "        if self.online && Self::fresh(self.mode_ms, now_ms) {", "        if self.has_fresh_reading(now_ms) {", T_GATE),
 ("RIG-refused", "a refused set-frequency is not a refusal", ENGINE,
  "                    self.dial_refused = Some(hz);", "", T_GATE),
 # ---- clock step (F-48)
 ("CLK-step", "a clock step is not detected (the receiver goes silent)", SLOTS,
  "        let next = if now_slot + 1 < next || now_slot > next + 1 {", "        let next = if false {", [CLK, LIVE, VCLK]),
 # ---- loopback isolation (F-08)
 ("LOOP-b", "audio loopback refusal lets VOX through", ALOOP,
  "if cfg.ptt != PttConfig::None {", "if !matches!(cfg.ptt, PttConfig::None | PttConfig::Vox) {", [CLIALL]),
 ("LOOP-e", "software loopback reaches the sound-card test via crate:: (unreachable at run time)", LOOP,
  "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n",
  "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n    if std::env::var_os(\"Z30_MUTANT_NEVER_SET_7f3a\").is_some() { let _ = crate::audio_loopback::run(&z30_engine::config::Config::default(), true, None); }\n", [CLIALL]),
 # ---- logged values (N-05, F-09)
 ("DIAL-a", "a configured dial is logged as commanded", ENGINE,
  "(None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Configured)),", "(None, Some(d)) => Some(Sourced::new(d as f64, Provenance::Commanded)),", T_LOG),
 ("PWR-a", "configured TX power logged as measured", ENGINE,
  "configured_tx_power_w.map(|p| Sourced::new(p, Provenance::Configured));", "configured_tx_power_w.map(|p| Sourced::new(p, Provenance::Measured));", T_LOG),
 ("LOG-p", "validate accepts a record with no partner", QSO,
  "if self.call.trim().is_empty() {", "if false && self.call.trim().is_empty() {", T_LOG),
 # ---- migration (F-21) and device selection (F-43), io (F-17, F-19)
 ("MIG-level", "migration writes a transmit level of 0.5", MIG, "    cfg.audio.tx_level = 0.0;", "    cfg.audio.tx_level = 0.5;", [IOLIB]),
 ("MIG-call", "migration imports the legacy default callsign", MIG,
  "        Some(c) if is_legacy_default_call(c) => rep.fields.push(", "        Some(c) if false && is_legacy_default_call(c) => rep.fields.push(", [IOLIB]),
 ("MIG-ptt", "migration imports the legacy default PTT method", MIG,
  "        Some(m) if ptt_is_default => rep.fields.push(", "        Some(m) if false && ptt_is_default => rep.fields.push(", [IOLIB]),
 ("MIG-dial", "migration imports the legacy default dial", MIG,
  "        Some(d) if d == TK_DEFAULT_DIAL_HZ => rep.fields.push(", "        Some(d) if false && d == TK_DEFAULT_DIAL_HZ => rep.fields.push(", [IOLIB]),
 ("DEV-first", "an ambiguous audio name resolves to the first match", AUDIO,
  "        [one] => Ok(*one),\n        [] => Err(format!(\"no audio device matching", "        [one, ..] => Ok(*one),\n        [] => Err(format!(\"no audio device matching", [IOLIB]),
 ("CM-first", "an empty CM108 path takes the first of several devices", CM108,
  "        [one] => Ok(one.clone()),", "        [one, ..] => Ok(one.clone()),", [IOCM]),
 ("OUT-err", "the output error callback discards the error", AUDIO,
  "        self.failed.store(true, Ordering::SeqCst);", "        let _ = &self.failed;", [IOLIB]),
 ("OUT-alloc", "the playback callback allocates", AUDIO,
  "        self.shared.latency_ns.store(latency_ns, Ordering::Relaxed);", "        self.shared.latency_ns.store(std::hint::black_box(vec![latency_ns]).len() as u64, Ordering::Relaxed);", [IOALLOC]),
 ("CAT-lazy", "CAT PTT connects lazily at the first key", RIGCTLD,
  "        let mut r = Rigctld::new(host, port);\n        r.connect()?;", "        let r = Rigctld::new(host, port);", [IOLIB]),
 ("WALL-block", "the clock status query runs on the caller's thread", WALL,
  "        if c.refreshing.is_none() && c.checked.is_none_or(|t| t.elapsed() >= self.refresh_after) {",
  "        if c.checked.is_none_or(|t| t.elapsed() >= self.refresh_after) {\n            *c = Cache { checked: Some(Instant::now()), text: (self.query)(), refreshing: None };\n        }\n        if false {", [IOLIB]),
 # ---- post-remediation code review fixes (v3)
 ("RV-M1", "M-1: the HALT stop is not refreshed after an output recovery", RT,
  "                    *self.stopper.lock().unwrap_or_else(|p| p.into_inner()) = self.output.stopper();\n", "", T_RT),
 ("RV-M2-retry", "M-2: shutdown tries the release once and gives up", RT,
  "        while self.ptt.state() != PttState::Released && t0.elapsed() < Duration::from_millis(SHUTDOWN_RELEASE_WAIT_MS) {",
  "        while false && t0.elapsed() < Duration::from_millis(SHUTDOWN_RELEASE_WAIT_MS) {", T_RT),
 ("RV-M2-report", "M-2: shutdown reports the line released whatever its state", RT,
  "            ptt: self.ptt.state(),\n", "            ptt: PttState::Released,\n", T_RT),
 ("RV-M2-cat", "M-2: CAT PTT does not command a release when it is opened", RIGCTLD,
  "        ptt.set(false).map_err(|e| format!(\"rigctld at {host}:{port} did not accept the release at start-up: {}\", e.0))?;\n", "", [IOLIB]),
 ("RV-L1", "L-1: HALT drives the release on the calling thread", RT,
  "        self.ptt.request_release_in_background();\n    }\n\n    /// Emergency", "        self.ptt.request_release_now();\n    }\n\n    /// Emergency", T_RT),
 ("RV-L3", "L-3: the applied level passes NaN through", RT,
  "    if level.is_nan() {\n        0.0\n    } else {", "    if false {\n        0.0\n    } else {", [ENGLIB]),
 ("RV-L4", "L-4: an unanswered clock-status query keeps the old answer as current", WALL,
  "            Some(since) if since.elapsed() >= self.stale_after => {", "            Some(since) if false && since.elapsed() >= self.stale_after => {", [IOLIB]),
 ("RV-L5-disarm", "L-5: a clock step leaves transmission armed", ENGINE,
  "        if self.tx_enabled || self.tune_pending {\n            self.tx_enabled = false;\n            self.tune_pending = false;\n            self.events.push(Event::TxFault(format!(",
  "        if false {\n            self.tx_enabled = false;\n            self.tune_pending = false;\n            self.events.push(Event::TxFault(format!(", [GC, TXRT]),
 ("RV-L5-abort", "L-5: a clock step does not abort a frame in progress", RT,
  "                self.abort(\"the system clock stepped\");\n", "", T_RT),
]

def run(t):
    return subprocess.run(["cargo", "+1.95", "test", "--locked", "--release"] + t, cwd=W, env=ENV, capture_output=True, text=True)

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
            results.append({"id": mid, "mutation": desc, "file": path, "result": "NOT APPLIED"})
            continue
        line = src[:src.index(old)].count("\n") + 1
        open(p, "w").write(src.replace(old, new, 1))
        t0 = time.time(); failed = []; comp = False
        for t in tests:
            try:
                r = subprocess.run(["cargo", "+1.95", "test", "--locked", "--release"] + t, cwd=W, env=ENV, capture_output=True, text=True, timeout=900)
            except subprocess.TimeoutExpired:
                failed.append(" ".join(t) + " (TIMEOUT: hung)")
                continue
            if r.returncode != 0:
                if "error[E" in r.stderr or "could not compile" in r.stderr:
                    comp = True; failed.append(" ".join(t) + " (COMPILE ERROR)"); print(r.stderr[-2500:])
                else:
                    failed.append(" ".join(t) + ": " + ", ".join(failed_names(r)))
                break  # killed: one failing binary is enough
        v = "INVALID (compile error)" if comp else ("KILLED" if failed else "SURVIVED")
        print(f"{mid} {path}:{line} [{desc}] {v} ({time.time()-t0:.0f} s) {failed}", flush=True)
        results.append({"id": mid, "mutation": desc, "file": f"{path}:{line}", "occurrences": n, "result": v, "failing": failed,
                        "tests_run": [" ".join(t) for t in tests]})
        restore()
        json.dump({"commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=W, capture_output=True, text=True).stdout.strip(),
                   "toolchain": "rustc 1.95.0, cargo test --release --locked",
                   "mutations": results}, open(out, "w"), indent=2)

if __name__ == "__main__":
    main()
