"""02d mutants re-run against the syn guard, the reordered --out check and the close latch."""
import subprocess, sys, json
R = "/home/user/z-30"
LB = "crates/z30-cli/src/loopback.rs"; MAIN = "crates/z30-cli/src/main.rs"; HW = "crates/z30-cli/src/audio_loopback.rs"; RT = "crates/z30-engine/src/runtime.rs"
RUN_FN = "pub fn run() -> Result<(String, bool), String> {"
NET = 'if usize::MAX == 0 { let _ = std::net::TcpStream::connect("192.0.2.1:9"); }'
def ins(extra, before="use rand::Rng;"):
    return lambda s: s.replace(before, extra + "\n" + before, 1)
def body(extra):
    return lambda s: s.replace(RUN_FN, RUN_FN + "\n    " + extra, 1)
CLI = ["-p", "z30-cli", "--bin", "z30", "--test", "loopback_isolation", "--test", "loopback_report_target"]
ENG = ["-p", "z30-engine", "--test", "ptt_release", "--test", "tx_runtime"]
M = [
 ("G3-extern-crate-as", LB, lambda s: body('if usize::MAX == 0 { let _ = Std::net::TcpStream::connect("192.0.2.1:9"); }')(ins("extern crate std as Std;")(s)), CLI),
 ("G4-macro-metavar", LB, lambda s: body("if usize::MAX == 0 { let _ = via!(net); }")(ins('macro_rules! via { ($M:ident) => { std::$M::TcpStream::connect("192.0.2.1:9") } }')(s)), CLI),
 ("G2-rename-in-block", LB, body('if usize::MAX == 0 { use std::{net as Net}; let _ = Net::TcpStream::connect("192.0.2.1:9"); }'), CLI),
 ("G5-spaced", LB, body('if usize::MAX == 0 { let _ = std :: net :: TcpStream :: connect("192.0.2.1:9"); }'), CLI),
 ("G6-include-space", LB, body('if usize::MAX == 0 { let _ = include_str ! ("loopback.rs"); }'), CLI),
 ("G1-cr-raw", LB, body('let _a = cr#"x"y"#; ' + NET + ' let _b = cr#"p"q"#;'), CLI),
 ("B4-writer-skips-check", MAIN, lambda s: s.replace("    check_report_target(p)?;\n    std::fs::write(p, text)", "    std::fs::write(p, text)", 1), CLI),
 ("B5-hw-plain-fs-write", HW, lambda s: s.replace("crate::write_report_file(p, &text)?;", 'std::fs::write(p, &text).map_err(|e| format!("{}: {e}", p.display()))?;', 1), CLI),
 ("B9-hw-early-check-removed", MAIN, lambda s: s.replace("    if cli.audio_loopback_test {\n        if let Some(p) = cli.out.as_deref() {\n            check_report_target(p)?;\n        }\n    }\n", "", 1), CLI),
 ("N0-shutdown-no-close", RT, lambda s: s.replace("        self.ptt.close();\n        self.halt();", "        self.halt();", 1), ENG),
]
ONLY = sys.argv[2:]
res = []
for name, f, mut, args in [m for m in M if not ONLY or m[0] in ONLY]:
    p = f"{R}/{f}"; orig = open(p).read(); new = mut(orig)
    if new == orig:
        res.append((name, "PATTERN-NOT-FOUND")); print(name, "PATTERN-NOT-FOUND", flush=True); continue
    open(p, "w").write(new)
    try:
        r = subprocess.run(["cargo", "+1.95", "test", "--release", "--locked"] + args, cwd=R, capture_output=True, text=True, timeout=2400)
        out = r.stdout + r.stderr
        if r.returncode == 0: v = "SURVIVED"
        elif "error[" in out or "could not compile" in out: v = "BUILD-FAIL"
        else:
            failed = sorted({l.split()[1] for l in out.splitlines() if l.startswith("test ") and l.endswith("FAILED")})
            v = "KILLED by " + ", ".join(failed)
    finally:
        open(p, "w").write(orig)
    res.append((name, v)); print(name, v, flush=True)
json.dump(res, open(sys.argv[1], "w"), indent=1)
