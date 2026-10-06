"""F-08 confirmation mutants re-run against the new guard and report writer."""
import subprocess, sys, json, shutil
R = "/home/user/z-30"
LB = "crates/z30-cli/src/loopback.rs"
MAIN = "crates/z30-cli/src/main.rs"
RUN_FN = "pub fn run() -> Result<(String, bool), String> {"
def ins_run(extra):  # insert a statement at the top of run()
    return lambda s: s.replace(RUN_FN, RUN_FN + "\n    " + extra, 1)
def tail(extra):
    return lambda s: s.rstrip("\n") + "\n" + extra + "\n"
def tests_brace(s):
    s = s.replace("mod tests {", "mod tests {\n    fn _brace() { let _ = '{'; }", 1)
    return s.rstrip("\n") + "\nfn side_channel() { let _ = '}'; let _ = std::net::TcpStream::connect(\"127.0.0.1:4532\"); }\n"
ONLY = sys.argv[2:]
M = [
 ("F08-dev-iffalse", MAIN, lambda s: s.replace("if t.is_char_device() || t.is_block_device() || t.is_fifo() || t.is_socket() {", "if false {", 1), "loopback_report_target"),
 ("F08-dev-earlycheck-removed", MAIN, lambda s: s.replace("            check_report_target(p)?;\n        }\n        let (text, pass)", "        }\n        let (text, pass)", 1), "loopback_report_target"),
 ("F08-brace-literals", LB, lambda s: ins_run("side_channel();")(tests_brace(s)), "loopback_isolation"),
 ("F08-url-slashes", LB, ins_run('let _u = "http://"; let _ = std::net::TcpStream::connect("127.0.0.1:4532");'), "loopback_isolation"),
 ("F08-mod-decl", LB, lambda s: s.replace("use rand::Rng;", "#[allow(dead_code)]\nmod sidecar { pub fn x() {} }\nuse rand::Rng;", 1), "loopback_isolation"),
 ("F08-macro-use", LB, lambda s: s.replace("use rand::Rng;", "#[macro_use]\nextern crate serde_json;\nuse rand::Rng;", 1), "loopback_isolation"),
 ("F08-block-comment-hide", LB, ins_run('/* */ let _ = std::process::Command::new("rigctl"); /* */'), "loopback_isolation"),
]
res = []
for name, f, mut, test in [m for m in M if not ONLY or m[0] in ONLY]:
    p = f"{R}/{f}"; orig = open(p).read(); new = mut(orig)
    if new == orig:
        res.append((name, "PATTERN-NOT-FOUND")); print(name, "PATTERN-NOT-FOUND", flush=True); continue
    open(p, "w").write(new)
    try:
        r = subprocess.run(["cargo", "+1.95", "test", "--release", "--locked", "-p", "z30-cli", "--test", test], cwd=R, capture_output=True, text=True, timeout=1500)
        out = r.stdout + r.stderr
        if r.returncode == 0: v = "SURVIVED"
        elif "error[" in out or "could not compile" in out: v = "BUILD-FAIL"
        else:
            failed = [l.split()[1] for l in out.splitlines() if l.startswith("test ") and l.endswith("FAILED")]
            v = "KILLED by " + ",".join(failed)
    finally:
        open(p, "w").write(orig)
    res.append((name, v)); print(name, v, flush=True)
json.dump(res, open(sys.argv[1], "w"), indent=1)
