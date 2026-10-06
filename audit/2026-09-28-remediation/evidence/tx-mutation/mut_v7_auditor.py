#!/usr/bin/env python3
"""02e transmit-safety mutants at 2e06ca6. W=<worktree> CARGO_TARGET_DIR=<dir> MUT_OUT=<json> python3 mut_v7.py [IDs]
Every network payload sits in `if runs.len() == usize::MAX` (never runs) and names TEST-NET 192.0.2.1:9;
file payloads name /dev/null. Nothing opens hardware."""
import json, os, re, subprocess, sys
W = os.environ["W"]; OUT = os.environ["MUT_OUT"]
LB = "crates/z30-cli/src/loopback.rs"; MAIN = "crates/z30-cli/src/main.rs"
HW = "crates/z30-cli/src/audio_loopback.rs"; RT = "crates/z30-engine/src/runtime.rs"
RUN_A = "    let mut runs = Vec::new();\n"
TOP_A = "#[cfg(test)]\nmod tests {"
NET = 'std::net::TcpStream::connect("192.0.2.1:9")'
def run_(body): return (LB, RUN_A, RUN_A + "    if runs.len() == usize::MAX {\n        " + body + "\n    }\n")
def top(items): return (LB, TOP_A, items + "\n" + TOP_A)
CLI = ["-p", "z30-cli", "--bin", "z30", "--test", "loopback_isolation", "--test", "loopback_report_target"]
ENG = ["-p", "z30-engine", "--lib", "--test", "ptt_release", "--test", "tx_runtime", "--test", "safety", "--test", "emergency"]
N0K_TEST = r'''
    #[test]
    fn f84_shutdown_closes_the_controller_before_its_halt() {
        use super::*;
        use crate::ptt::{PttAck, PttError, SystemMonotonic};
        struct In;
        impl AudioInput for In {
            fn sample_rate(&self) -> u32 { 48_000 }
            fn next_block(&mut self, t: Duration) -> Result<Option<AudioBlock>, String> {
                std::thread::sleep(t.min(Duration::from_millis(5)));
                Ok(None)
            }
        }
        struct Out;
        impl AudioOutput for Out {
            fn sample_rate(&self) -> u32 { 48_000 }
            fn latency_sec(&self) -> f64 { 0.0 }
            fn play(&mut self, _: Vec<f32>) -> Result<(), String> { Ok(()) }
            fn stop(&mut self) {}
        }
        struct Line(Arc<AtomicBool>);
        impl PttLine for Line {
            fn set(&mut self, k: bool) -> Result<PttAck, PttError> {
                if k { self.0.store(true, Ordering::SeqCst); }
                Ok(PttAck::Confirmed)
            }
            fn describe(&self) -> String { "test".into() }
        }
        struct Wall;
        impl WallClock for Wall {
            fn utc_now(&self) -> f64 { 1.0e9 }
            fn status(&self) -> String { "test".into() }
        }
        struct Book;
        impl LogSink for Book {
            fn log(&mut self, _: &QsoRecord) -> Result<(), String> { Ok(()) }
        }
        let keyed = Arc::new(AtomicBool::new(false));
        let mut h = start(Config::default(), RuntimeParts {
            input: Box::new(In), output: Box::new(Out), rig: None, ptt: Box::new(Line(keyed.clone())),
            wall: Arc::new(Wall), mono: Arc::new(SystemMonotonic::default()), log: Box::new(Book),
            slot_tap: None, tx_unavailable: Some("test parts".into()),
        });
        let ptt = h.ptt.clone();
        let wd = h.watchdog.take(); // the clone keeps the watchdog alive; joined below instead
        assert!(h.shutdown().release_confirmed());
        assert!(ptt.key().is_err(), "shutdown left its controller able to key");
        assert!(!keyed.load(Ordering::SeqCst), "the line was keyed after shutdown");
        drop(ptt);
        if let Some(w) = wd { let _ = w.join(); }
    }
'''
RT_TESTS_A = "mod tests {\n    use super::safe_level;\n"
M = {
 # --- re-run of 02d G-classes against the syn guard ---
 "G1": [run_('let _a = cr#"x"y"#; let _ = ' + NET + '; let _b = cr#"p"q"#;')],
 "G2": [run_('if true { use std::{net as Net}; let _ = Net::TcpStream::connect("192.0.2.1:9"); }')],
 "G3": [top("extern crate std as Std;"), run_('let _ = Std::net::TcpStream::connect("192.0.2.1:9");')],
 "G4": [top('macro_rules! via { ($M:ident) => { std::$M::TcpStream::connect("192.0.2.1:9") } }'), run_("let _ = via!(net);")],
 "G5": [run_('let _ = std :: net :: TcpStream :: connect("192.0.2.1:9");')],
 "G6": [run_('let _ = include_str ! ("loopback.rs");')],
 "G7": [run_('let _ = r#std::net::TcpStream::connect("192.0.2.1:9");')],
 "G8": [run_('let _q = b"\\"//"; let _ = ' + NET + ';')],
 "G9": [run_('/* a /* b */ c */ let _ = ' + NET + ';')],
 "G10": [top("fn side_lt<'a>(s: &'a str) -> char { let _c = '\\''; let _d = '\"'; let _ = std::net::TcpStream::connect(s); 'x' }"), run_('let _ = side_lt("192.0.2.1:9");')],
 "G11": [top("#[cfg(not(test))]\nfn side_nt() { let _ = " + NET + "; }"), run_("#[cfg(not(test))]\n        side_nt();")],
 "G12": [top("#[cfg(any(test, not(test)))]\nmod side_any { pub fn x() { let _ = " + NET + "; } }"), run_("side_any::x();")],
 "G13": [top('#[macro_use]\n#[path = "loopback_side_mod.rs"]\nmod side_mod;'), run_("go_side!();"),
         ("crates/z30-cli/src/loopback_side_mod.rs", None, 'macro_rules! go_side { () => { let _ = std::net::TcpStream::connect("192.0.2.1:9"); } }\n')],
 "G14": [(LB, "mod tests {\n", 'mod tests {\n    const _D: &std::ffi::CStr = cr#"x"y"#;\n'), run_("side_tail();"),
         (LB, "@EOF", 'fn side_tail() { let _ = cr#"q"r"#; let _ = ' + NET + '; }\n')],
 # --- new attacks on the syn guard ---
 "S1-turbofish-in-macro": [run_('let _ = format!("{:?}", std::net::TcpStream::connect::<&str>("192.0.2.1:9"));')],
 "S2-use-group-rename-in-macro": [run_('let _ = format!("{}", { use std::net::{Shutdown, TcpStream as Vec}; let _s: Option<Shutdown> = None; Vec::connect("192.0.2.1:9").is_ok() });')],
 "S3-use-group-qself-in-macro": [run_('let _ = format!("{}", { use std::net::{Shutdown, TcpStream}; let _s: Option<Shutdown> = None; <TcpStream>::connect("192.0.2.1:9").is_ok() });')],
 "S4-glob-fs-write-in-macro": [run_('let _ = format!("{:?}", { use std::fs::*; write("/dev/null", "") });')],
 "S5-turbofish-process-in-macro": [run_('let _ = format!("{:?}", std::process::Command::new::<&str>("rigctl").arg("T").arg("1").status());')],
 "S6-value-item-named-as-crate": [top("fn crossbeam_channel() {}"), run_("crossbeam_channel(); let _ = crossbeam_channel::bounded::<u8>(1);")],
 "S9-cfg_attr-tokens": [top('#[cfg_attr(all(), doc = include_str!("/dev/null"))]\nfn side_doc() {}'), run_("side_doc();")],
 "S11-macro_rules-in-fn": [run_('macro_rules! m { () => { ' + NET + ' } } let _ = m!();')],
 "S13-leading-colons": [run_('let _ = ::std::net::TcpStream::connect("192.0.2.1:9");')],
 "S15-type-alias": [top("type Side = std::net::TcpStream;"), run_('let _ = Side::connect("192.0.2.1:9");')],
 "S16-nested-fn-use": [run_('fn inner() { use std::net::TcpStream; let _ = TcpStream::connect("192.0.2.1:9"); } inner();')],
 # --- report-target layers ---
 "B4": [(MAIN, "    check_report_target(p)?;\n    std::fs::write(p, text)", "    std::fs::write(p, text)")],
 "B5": [(HW, "crate::write_report_file(p, &text)?;", "std::fs::write(p, &text).map_err(|e| e.to_string())?;")],
 "B5b": [(HW, "crate::write_report_file(p, &text)?;", 'if p.as_os_str().is_empty() { crate::write_report_file(p, &text)?; } else { use std::{fs::File, io::Write}; File::create(p).and_then(|mut f| f.write_all(text.as_bytes())).map_err(|e| e.to_string())?; }')],
 "B9": [(MAIN, "    if cli.audio_loopback_test {\n        if let Some(p) = cli.out.as_deref() {\n            check_report_target(p)?;\n        }\n    }\n", "")],
 # --- F-84 ---
 "N0": [(RT, "        self.ptt.close();\n        self.halt();", "        self.halt();")],
 "N0K-with-wiring-test": [(RT, "        self.ptt.close();\n        self.halt();", "        self.halt();"), (RT, RT_TESTS_A, RT_TESTS_A + N0K_TEST)],
 "N0K-control": [(RT, RT_TESTS_A, RT_TESTS_A + N0K_TEST)],
 "N3-key-ignores-closed-first-check": [("crates/z30-engine/src/ptt.rs", "if NO_MORE_KEYS.load(Ordering::SeqCst) || s.closed.load(Ordering::SeqCst) {", "if NO_MORE_KEYS.load(Ordering::SeqCst) {")],
 "N4-key-ignores-closed-after-drive": [("crates/z30-engine/src/ptt.rs", "|| NO_MORE_KEYS.load(Ordering::SeqCst) || s.closed.load(Ordering::SeqCst) {", "|| NO_MORE_KEYS.load(Ordering::SeqCst) {")],
}
def apply(edits):
    for f, old, new in edits:
        p = os.path.join(W, f)
        if old is None:
            open(p, "w").write(new); continue
        s = open(p).read()
        if old == "@EOF":
            s = s + new
        else:
            assert s.count(old) == 1, (f, old, s.count(old))
            s = s.replace(old, new)
        open(p, "w").write(s)
def restore():
    subprocess.run(["git", "-C", W, "checkout", "--", "."], check=True)
    subprocess.run(["git", "-C", W, "clean", "-fdq", "crates/"], check=True)
    st = subprocess.run(["git", "-C", W, "status", "--porcelain"], capture_output=True, text=True).stdout
    assert st.strip() == "", st
res = json.load(open(OUT)) if os.path.exists(OUT) else {}
ids = sys.argv[1:] or list(M)
logdir = os.path.dirname(os.path.abspath(OUT))
for mid in ids:
    restore(); apply(M[mid])
    pkg = ENG if any(e[0].startswith("crates/z30-engine") for e in M[mid]) else CLI
    r = subprocess.run(["cargo", "+1.95", "test", "--release", "--locked"] + pkg, cwd=W, capture_output=True, text=True, timeout=3000)
    log = r.stdout + r.stderr
    open(os.path.join(logdir, f"{mid}.log"), "w").write(log)
    if "could not compile" in log or re.search(r"^error(\[E\d+\])?:", log, re.M) and "test result" not in log:
        v = "INVALID (does not compile)"
    else:
        failed = sorted(set(re.findall(r"^    (\S+)$", log, re.M)) | set(re.findall(r"^test (\S+) \.\.\. FAILED", log, re.M)))
        nres = len(re.findall(r"^test result:", log, re.M))
        v = ("KILLED by " + ", ".join(failed)) if (r.returncode != 0 and failed) else ("SURVIVED (%d test binaries ran)" % nres if r.returncode == 0 else "FAILED-OTHER rc=%d" % r.returncode)
    res[mid] = v; print(mid, "->", v, flush=True)
    json.dump(res, open(OUT, "w"), indent=1)
restore()
