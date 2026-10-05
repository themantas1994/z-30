import subprocess, os, time
W=os.environ["W"]; ENV=dict(os.environ, CARGO_TERM_COLOR="never", CARGO_BUILD_JOBS="3")
RT="crates/z30-engine/src/runtime.rs"
edits=[("            Err(e) => self.release_failed(&e.0),","            Err(_e) => {}"),
       ("            PttState::ReleasePending if !self.release_unconfirmed => {","            PttState::ReleasePending if false => {")]
subprocess.run(["git","checkout","--","."],cwd=W,check=True)
p=os.path.join(W,RT); s=open(p).read()
for o,n in edits:
    assert s.count(o)==1,o; s=s.replace(o,n,1)
open(p,"w").write(s)
t0=time.time()
for t in [["-p","z30-engine","--test","tx_runtime"],["-p","z30-engine","--test","ptt_release"]]:
    r=subprocess.run(["cargo","+1.95","test","--locked","--release"]+t,cwd=W,env=ENV,capture_output=True,text=True,timeout=900)
    fails=[l.split()[1] for l in r.stdout.splitlines() if l.startswith("test ") and l.rstrip().endswith("FAILED")]
    print("A-COMBO-relreport (RT-relfault + A-CHK-pending)", " ".join(t), "rc",r.returncode, fails, f"{time.time()-t0:.0f}s", flush=True)
    if r.returncode!=0: break
subprocess.run(["git","checkout","--","."],cwd=W,check=True)
