import subprocess, os, time
W=os.environ["W"]; ENV=dict(os.environ, CARGO_TERM_COLOR="never", CARGO_BUILD_JOBS="3")
RT="crates/z30-engine/src/runtime.rs"; TF="crates/z30-engine/tests/tx_runtime.rs"
TEST='''
#[test]
fn audit_probe_a_clock_step_between_plan_and_key_abandons_the_plan() {
    let mut st = Station::start();
    st.send(Command::CallCq);
    st.time.set_utc(slot_start(SLOT) - 0.55);
    st.wait("the plan", |s| s.out.st.lock().unwrap().latency_queries > 0);
    let at = slot_start(SLOT) - 0.5;
    let n = RATE as usize / 10;
    let block = |first: u64, utc: f64| AudioBlock { first_index: first, samples: vec![0.0; n], capture_utc: utc };
    {
        let mut q = st.audio_in.0.lock().unwrap();
        q.push_back(block(0, at));
        q.push_back(block(n as u64, at + 0.1 - 120.0));
    }
    st.wait("the step", |s| s.events.iter().any(|e| matches!(e, Event::ClockStepped { .. })));
    st.settle();
    for t in [slot_start(SLOT) - PTT_LEAD_SEC, slot_start(SLOT) + 0.1, slot_start(SLOT) + 1.0] {
        st.time.set_utc(t);
        st.settle();
    }
    assert!(st.line.keys().is_empty(), "keyed a plan accepted before the clock step: {:?}", st.line.changes());
}
'''
MUT=("                self.abort(\"the system clock stepped\");","                if self.txs.keyed() { self.abort(\"the system clock stepped\"); }")
def run(label, mutate):
    subprocess.run(["git","checkout","--","."],cwd=W,check=True)
    p=os.path.join(W,TF); open(p,"a").write(TEST)
    if mutate:
        q=os.path.join(W,RT); s=open(q).read(); assert s.count(MUT[0])==1; open(q,"w").write(s.replace(MUT[0],MUT[1],1))
    r=subprocess.run(["cargo","+1.95","test","--locked","--release","-p","z30-engine","--test","tx_runtime","audit_probe"],cwd=W,env=ENV,capture_output=True,text=True,timeout=900)
    res=[l for l in r.stdout.splitlines() if l.startswith("test ") or l.startswith("test result")]
    print(label, "rc", r.returncode, res, flush=True)
    if r.returncode!=0: print(r.stdout[-1500:], r.stderr[-1500:] if "error[" in r.stderr else "")
    subprocess.run(["git","checkout","--","."],cwd=W,check=True)
run("PROBE2 unmutated", False)
run("PROBE2 with A-CLK-keyedonly", True)
