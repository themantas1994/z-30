import subprocess, os
W=os.environ["W"]; ENV=dict(os.environ, CARGO_TERM_COLOR="never", CARGO_BUILD_JOBS="3")
EN="crates/z30-engine/src/engine.rs"; TF="crates/z30-engine/tests/gate_contract.rs"
TEST='''
#[test]
fn audit_probe_a_completed_tune_in_place_of_rr73_does_not_complete_the_contact() {
    let mut e = Engine::new(config());
    e.apply(Command::CallCq, 0);
    let rep = |t: &str| SlotReport { decodes: vec![decode(t)], ..Default::default() };
    e.on_slot_report(SLOT, &rep("K1ABC G4XYZ IO91"), slot_start(SLOT) + 26.0, 0);
    let p = e.plan_tx(SLOT + 1, 0).expect("report");
    e.tx_started(&p);
    e.tx_finished(SLOT + 1, &TxOutcome::Complete, 0);
    e.on_slot_report(SLOT + 2, &rep("K1ABC G4XYZ -08"), slot_start(SLOT + 2) + 26.0, 0);
    e.apply(Command::Tune, 0);
    let p = e.plan_tx(SLOT + 3, 0).expect("tune");
    assert!(matches!(p.kind(), TxKind::Tune));
    e.tx_started(&p);
    let _ = e.take_events();
    e.tx_finished(SLOT + 3, &TxOutcome::Complete, 0);
    assert!(!e.take_events().iter().any(|x| matches!(x, Event::ContactComplete(_))), "a TUNE completed the contact");
}
'''
MUT=('        let was_frame = self.active_tx.as_ref().is_some_and(|(_, t)| t != "TUNE");','        let was_frame = self.active_tx.as_ref().is_some();')
def run(label, mutate):
    subprocess.run(["git","checkout","--","."],cwd=W,check=True)
    open(os.path.join(W,TF),"a").write(TEST)
    if mutate:
        q=os.path.join(W,EN); s=open(q).read(); assert s.count(MUT[0])==1; open(q,"w").write(s.replace(MUT[0],MUT[1],1))
    r=subprocess.run(["cargo","+1.95","test","--locked","--release","-p","z30-engine","--test","gate_contract","audit_probe"],cwd=W,env=ENV,capture_output=True,text=True,timeout=900)
    res=[l for l in r.stdout.splitlines() if l.startswith("test ") or l.startswith("test result")]
    print(label,"rc",r.returncode,res,flush=True)
    if r.returncode!=0 and "error[" in r.stderr: print(r.stderr[-2000:])
    subprocess.run(["git","checkout","--","."],cwd=W,check=True)
run("PROBE3 unmutated", False)
run("PROBE3 with A-LOG-tune", True)
