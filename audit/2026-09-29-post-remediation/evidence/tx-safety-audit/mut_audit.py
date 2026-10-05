#!/usr/bin/env python3
"""Independent transmit-safety mutants (tx-safety-auditor, 2026-10-05), none of them in
mutate_tx_v3.py. Same mechanics as v3: one textual edit at a time in the worktree W, targeted
test binaries, `git checkout -- .` before and after each. Pattern not found -> NOT APPLIED;
compile error -> INVALID. PROBE entries add a test to the unmutated code: FAILS = defect shown."""
import json, os, subprocess, sys, time
W = os.environ["W"]
ENV = dict(os.environ, CARGO_TERM_COLOR="never", CARGO_BUILD_JOBS="3")
GATE="crates/z30-engine/src/txgate.rs"; BAND="crates/z30-engine/src/bandplan.rs"; ENGINE="crates/z30-engine/src/engine.rs"
RT="crates/z30-engine/src/runtime.rs"; PTT="crates/z30-engine/src/ptt.rs"; LOOP="crates/z30-cli/src/loopback.rs"
MIG="crates/z30-io/src/migrate.rs"; AUDIO="crates/z30-io/src/audio.rs"; RIGCTLD="crates/z30-io/src/rigctld.rs"
TXRTF="crates/z30-engine/tests/tx_runtime.rs"
def e(t): return ["-p","z30-engine","--test",t]
SAFETY,EMERG,DIALP,QSOL,PTTR,PTTP,TXRT,GC,CLK,LIVE=[e(x) for x in ["safety","emergency","dial_provenance","qso_logging","ptt_release","ptt_panic","tx_runtime","gate_contract","clock_step","live_runtime"]]
ENGLIB=["-p","z30-engine","--lib"]; IOLIB=["-p","z30-io","--lib"]; LISO=["-p","z30-cli","--test","loopback_isolation"]
T_RT=[TXRT,SAFETY,DIALP,LIVE,CLK]; T_PTT=[SAFETY,EMERG,PTTR,PTTP,ENGLIB,TXRT]; T_ENG=[GC,QSOL,SAFETY,ENGLIB,TXRT,DIALP]
PROBE_TEST = '''
#[test]
fn audit_probe_a_command_queued_before_halt_does_not_rearm_after_it() {
    let mut st = Station::start();
    let gate = st.line.key_gate.clone();
    let held = gate.lock().unwrap();
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    st.time.set_utc(slot_start(SLOT) - PTT_LEAD_SEC);
    st.wait("the control thread entering the key", |s| s.rt().ptt_state() == PttState::Keyed);
    // While the control thread is stuck in the driver: the operator presses Tune, then HALT.
    st.rt().commands.send(Command::Tune).unwrap();
    st.rt().halt();
    drop(held);
    st.wait("released", |s| s.rt().ptt_state() == PttState::Released && !s.line.keyed());
    let keys = st.line.keys().len();
    for t in [slot_start(SLOT + 1) - 0.55, slot_start(SLOT + 1) - PTT_LEAD_SEC, slot_start(SLOT + 1) + 0.1, slot_start(SLOT + 1) + 1.0] {
        st.time.set_utc(t);
        st.settle();
    }
    assert_eq!(st.line.keys().len(), keys, "keyed after HALT by a command sent before HALT: {:?} events {:?}", st.line.changes(), st.events);
}
'''
M = [
 ("A-SH-nohalt","shutdown does not halt (no output stop, no disarm) before releasing",RT,
  "        self.halt();\n        let _ = self.ptt.unkey();\n        let t0","        let _ = self.ptt.unkey();\n        let t0",T_RT),
 ("A-SH-confirmed","ShutdownReport::release_confirmed treats ReleasePending as confirmed",RT,
  "        self.ptt == PttState::Released\n","        self.ptt != PttState::Keyed\n",T_RT),
 ("A-SH-loop","shutdown stops retrying once the line is ReleasePending (retries only while Keyed)",RT,
  "        while self.ptt.state() != PttState::Released && t0","        while self.ptt.state() == PttState::Keyed && t0",T_RT),
 ("A-CAT-ignore","rigctld PTT: a refused T 0 at open is ignored (line returned as working)",RIGCTLD,
  "        ptt.set(false).map_err(|e| format!(\"rigctld at {host}:{port} did not accept the release at start-up: {}\", e.0))?;",
  "        let _ = ptt.set(false);",[IOLIB]),
 ("A-BG-skippending","HALT's background release skips a line already ReleasePending",PTT,
  "    pub fn request_release_in_background(&self) {\n        if self.state() == PttState::Released {",
  "    pub fn request_release_in_background(&self) {\n        if self.state() != PttState::Keyed {",T_PTT),
 ("A-BG-noop","HALT's background release thread drives nothing",PTT,
  "            me.request_release_now();\n","            let _ = me;\n",T_PTT),
 ("A-BD-nomark","release_bounded does not mark ReleasePending before trying the line",PTT,
  "        self.mark_release_pending();\n        let wait_ms = if this_thread_is_driving()","        let wait_ms = if this_thread_is_driving()",T_PTT),
 ("A-STOP-stale","M-1: stopper taken from the dead stream (before recover) is installed",RT,
  "                if self.output.recover().is_ok() && self.output.failure().is_none() {\n                    *self.stopper.lock().unwrap_or_else(|p| p.into_inner()) = self.output.stopper();",
  "                let stale = self.output.stopper();\n                if self.output.recover().is_ok() && self.output.failure().is_none() {\n                    *self.stopper.lock().unwrap_or_else(|p| p.into_inner()) = stale;",T_RT),
 ("A-CLK-tune","L-5: a clock step leaves a pending Tune armed",ENGINE,
  "            self.tx_enabled = false;\n            self.tune_pending = false;\n            self.events.push(Event::TxFault(format!(\n                \"transmission disarmed",
  "            self.tx_enabled = false;\n            self.events.push(Event::TxFault(format!(\n                \"transmission disarmed",[GC,CLK,TXRT,SAFETY]),
 ("A-CLK-keyedonly","L-5: a clock step aborts only a keyed transmission, not an accepted plan",RT,
  "                self.abort(\"the system clock stepped\");","                if self.txs.keyed() { self.abort(\"the system clock stepped\"); }",T_RT),
 ("A-ABORT-keyedonly","halt/abort ends only a keyed transmission (a planned one survives check_halt)",RT,
  "        if self.txs.busy() || self.plan.is_some() {\n            self.finish(TxOutcome::Aborted(reason.into()));",
  "        if self.txs.keyed() {\n            self.finish(TxOutcome::Aborted(reason.into()));",T_RT),
 ("A-LOG-nonfailed","F-17: Partial/Aborted/WatchdogAborted advance the QSO (only Failed does not)",ENGINE,
  "        if *outcome == TxOutcome::Complete && was_frame {","        if !matches!(outcome, TxOutcome::Failed(_)) && was_frame {",T_ENG),
 ("A-LOG-tune","a completed TUNE advances the QSO like a frame",ENGINE,
  "        let was_frame = self.active_tx.as_ref().is_some_and(|(_, t)| t != \"TUNE\");","        let was_frame = self.active_tx.as_ref().is_some();",T_ENG),
 ("A-CHK-pending","check_hardware never reports a ReleasePending line (only finish does)",RT,
  "            PttState::ReleasePending if !self.release_unconfirmed => {","            PttState::ReleasePending if false => {",T_RT+[PTTR]),
 ("A-LATE-key","MAX_KEY_LATENESS_SEC 0.5 -> 1.0",RT,"pub const MAX_KEY_LATENESS_SEC: f64 = 0.5;","pub const MAX_KEY_LATENESS_SEC: f64 = 1.0;",T_RT),
 ("A-LATE-start","MAX_START_LATENESS_SEC 0.5 -> 0.7",RT,"pub const MAX_START_LATENESS_SEC: f64 = 0.5;","pub const MAX_START_LATENESS_SEC: f64 = 0.7;",T_RT),
 ("A-B60-tol","US 60 m centre tolerance 50 -> 59 Hz",BAND,"pub const US_60M_CENTRE_TOLERANCE_HZ: f64 = 50.0;","pub const US_60M_CENTRE_TOLERANCE_HZ: f64 = 59.0;",[ENGLIB,GC,SAFETY]),
 ("A-B60-table","US 60 m channel 5358.5 kHz moved to 5357.0 kHz in the table only",BAND,"    chan!(5_358_500),","    chan!(5_357_000),",[ENGLIB,GC,SAFETY]),
 ("A-MIG-tkpower","migration imports the Tk wizard's default 50 W as configured power",MIG,
  "        (None, Some(p)) => Some((p, p == TK_DEFAULT_TX_POWER_W)),","        (None, Some(p)) => Some((p, false)),",[IOLIB]),
 ("A-MIG-tkptt","migration imports the Tk wizard's default 'CAT Command' PTT",MIG,
  "        (None, Some(m)) => m == TK_DEFAULT_PTT,","        (None, Some(m)) => false && m == TK_DEFAULT_PTT,",[IOLIB]),
 ("A-MIG-cm108pin","migration invents GPIO 3 for a CM108 config with no pin",MIG,
  "        Some(\"CM108_GPIO\") => match web.get(\"cm108GpioPin\").and_then(|v| v.as_u64()) {",
  "        Some(\"CM108_GPIO\") => match web.get(\"cm108GpioPin\").and_then(|v| v.as_u64()).or(Some(3)) {",[IOLIB]),
 ("A-MIG-dev","migration takes 'Default System Audio Device' as a device name",MIG,
  ".filter(|n| !n.to_ascii_lowercase().starts_with(\"default\") && n.len() < 64)",".filter(|n| n.len() < 64)",[IOLIB]),
 ("A-DEV-dupexact","two devices with the same exact name resolve to the first",AUDIO,
  "    let candidates = if exact.len() > 1 { exact } else { partial };","    let candidates = if exact.len() > 1 { vec![exact[0]] } else { partial };",[IOLIB]),
 ("A-LOOP-std","software loopback reaches rigctld via std::net (never executed: env-gated)",LOOP,
  "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n",
  "pub fn software_loopback(rate: u32, snr_db: Option<f64>) -> Result<Value, String> {\n    if std::env::var_os(\"Z30_MUTANT_NEVER_SET_7f3a\").is_some() { if let Ok(mut s) = std::net::TcpStream::connect(\"127.0.0.1:1\") { let _ = std::io::Write::write_all(&mut s, b\"T 1\\n\"); } }\n",[LISO]),
 ("PROBE-haltorder","PROBE (unmutated code + one test): a Tune queued before HALT re-arms after it",TXRTF,
  "fn frame_ms() -> u64 {","fn frame_ms() -> u64 {", [["-p","z30-engine","--test","tx_runtime","audit_probe"]]),
]
def restore(): subprocess.run(["git","checkout","--","."],cwd=W,check=True)
def failed_names(r): return [l.split()[1] for l in r.stdout.splitlines() if l.startswith("test ") and l.rstrip().endswith("FAILED")]
def main():
    only=set(sys.argv[1:]); out=os.environ["MUT_OUT"]
    results=json.load(open(out))["mutations"] if os.path.exists(out) else []
    done={r["id"] for r in results}
    for mid,desc,path,old,new,tests in M:
        if (only and mid not in only) or mid in done: continue
        restore(); p=os.path.join(W,path); src=open(p).read(); n=src.count(old)
        if n==0:
            print(mid,"PATTERN NOT FOUND",flush=True); results.append({"id":mid,"result":"NOT APPLIED"}); continue
        line=src[:src.index(old)].count("\n")+1
        src=src.replace(old,new,1)
        if mid.startswith("PROBE"): src=src+PROBE_TEST
        open(p,"w").write(src)
        t0=time.time(); failed=[]; comp=False
        for t in tests:
            try: r=subprocess.run(["cargo","+1.95","test","--locked","--release"]+t,cwd=W,env=ENV,capture_output=True,text=True,timeout=900)
            except subprocess.TimeoutExpired: failed.append(" ".join(t)+" (TIMEOUT)"); break
            if r.returncode!=0:
                if "error[E" in r.stderr or "could not compile" in r.stderr: comp=True; failed.append(" ".join(t)+" (COMPILE ERROR)"); print(r.stderr[-2000:])
                else:
                    failed.append(" ".join(t)+": "+", ".join(failed_names(r)))
                    if mid.startswith("PROBE"): print(r.stdout[-3000:])
                break
        v="INVALID" if comp else ("KILLED" if failed else "SURVIVED")
        if mid.startswith("PROBE"): v = "DEFECT SHOWN (probe test fails)" if failed and not comp else ("INVALID" if comp else "probe passes (no defect)")
        print(f"{mid} {path}:{line} [{desc}] {v} ({time.time()-t0:.0f} s) {failed}",flush=True)
        results.append({"id":mid,"mutation":desc,"file":f"{path}:{line}","result":v,"failing":failed,"tests_run":[" ".join(t) for t in tests]})
        restore()
        json.dump({"commit":subprocess.run(["git","rev-parse","HEAD"],cwd=W,capture_output=True,text=True).stdout.strip(),"toolchain":"rustc 1.95, cargo test --release --locked","mutations":results},open(out,"w"),indent=2)
main()
