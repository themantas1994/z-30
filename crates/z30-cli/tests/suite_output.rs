//! What `z30 --benchmark <name>` writes, through the shipped binary: the status and provenance
//! every result carries, the per-frame record that lets two commits be paired, and the refusals
//! that keep a replicate, exploratory or dirty run from replacing a published result (audit
//! 2026-09-28 F-11, F-12, F-13, F-14, F-32, F-37).

// clippy.toml's disallowed lists are for src/loopback.rs alone (it forbids them); tests run
// the binary and use temporary files.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("z30-suite-output-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn z30(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_z30")).current_dir(dir).args(args).output().unwrap()
}

fn read(p: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

#[test]
fn an_exploratory_run_says_so_records_its_instrument_and_pairs_frame_by_frame() {
    let d = scratch("expl");
    let o = z30(&d, &["--benchmark", "awgn", "--frames", "2", "--per-frame", "--out", "out"]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let v = read(&d.join("out/awgn.json"));
    let dirty = v["provenance"]["git_commit"].as_str().unwrap().ends_with("-dirty");
    assert_eq!(v["status"], if dirty { "dirty" } else { "exploratory" });
    assert!(v["exploratory"].is_string() || dirty, "the CI smoke job reads this marker");
    assert_eq!(v["publishable_size"], 200);
    let p = &v["provenance"];
    for k in
        ["rustc", "target", "cpu", "rustflags", "cargo_lock_sha256", "isa_features_detected", "target_features_compiled", "decoder_config"]
    {
        assert!(!p[k].is_null(), "provenance.{k} missing");
    }
    assert_eq!(p["instrument"]["sha256"].as_str().unwrap().len(), 64);
    assert_eq!(p["cargo_lock_sha256"].as_str().unwrap().len(), 64);
    let files = p["instrument"]["files"].as_object().unwrap();
    assert!(files.contains_key("crates/z30-cli/src/suite.rs") && files.contains_key("crates/z30-protocol/src/gfsk.rs"));
    assert!(files.values().all(|h| h.as_str().unwrap().len() == 64), "every instrument file was found and hashed");
    #[cfg(target_arch = "x86_64")]
    assert!(p["isa_features_detected"]["sse2"].as_bool().unwrap());

    // The per-frame file: a header naming the same instrument and seed, then one record per
    // frame whose totals are the JSON's counts.
    let text = std::fs::read_to_string(d.join("out/awgn.frames.jsonl")).unwrap();
    let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0]["kind"], "header");
    assert_eq!(lines[0]["instrument_sha256"], p["instrument"]["sha256"]);
    assert_eq!(lines[0]["suite_seed"], v["seed"]["suite_seed"]);
    let frames = &lines[1..];
    let points = v["points"].as_array().unwrap();
    assert_eq!(frames.len(), points.len() * 2);
    for (i, pt) in points.iter().enumerate() {
        let recs: Vec<&Value> = frames.iter().filter(|r| r["point"] == i).collect();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs.iter().filter(|r| r["correct"] == true).count() as u64, pt["decoded"].as_u64().unwrap());
        assert_eq!(recs.iter().map(|r| r["false_decodes"].as_u64().unwrap()).sum::<u64>(), pt["false_decodes"].as_u64().unwrap());
        assert!(recs.iter().all(|r| r["condition"] == pt["label"] && r["x"] == pt["param"]));
    }
    // The seed in each record is the one the frame was generated from: point p, frame i.
    let base = v["seed"]["suite_seed"].as_u64().unwrap();
    for r in frames {
        let (pt, i) = (r["point"].as_u64().unwrap(), r["frame"].as_u64().unwrap());
        assert_eq!(r["seed"].as_u64().unwrap(), base ^ (1 << 40) ^ (pt << 20) ^ i);
    }

    // A second run into the same place is refused, then allowed with --overwrite (not published).
    let again = z30(&d, &["--benchmark", "awgn", "--frames", "2", "--out", "out"]);
    assert!(!again.status.success());
    assert!(String::from_utf8_lossy(&again.stderr).contains("--overwrite"));
    let forced = z30(&d, &["--benchmark", "awgn", "--frames", "2", "--out", "out", "--overwrite"]);
    assert!(forced.status.success(), "{}", String::from_utf8_lossy(&forced.stderr));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn a_replicate_or_exploratory_run_cannot_replace_a_published_result() {
    let d = scratch("pub");
    // A stand-in for a committed result directory of this binary's commit.
    let v = z30(&d, &["--version"]);
    let label = String::from_utf8_lossy(&v.stdout).lines().find_map(|l| l.strip_prefix("commit:").map(|s| s.trim().to_string())).unwrap();
    let commit = label.trim_end_matches("-dirty").to_string();
    let published = d.join("research/results").join(&commit);
    std::fs::create_dir_all(&published).unwrap();
    let original = format!(r#"{{"benchmark":"awgn","provenance":{{"git_commit":"{commit}"}},"points":[]}}"#);
    std::fs::write(published.join("awgn.json"), &original).unwrap();

    for args in [
        vec!["--benchmark", "awgn", "--frames", "2", "--replicate", "1", "--out", published.to_str().unwrap()],
        vec!["--benchmark", "awgn", "--frames", "2", "--out", published.to_str().unwrap(), "--overwrite"],
        vec!["--benchmark", "awgn", "--frames", "200", "--out", published.to_str().unwrap(), "--overwrite"],
    ] {
        let o = z30(&d, &args);
        assert!(!o.status.success(), "{args:?} was allowed");
        assert!(String::from_utf8_lossy(&o.stderr).contains("refusing"), "{}", String::from_utf8_lossy(&o.stderr));
    }
    assert_eq!(std::fs::read_to_string(published.join("awgn.json")).unwrap(), original, "the published file is untouched");

    // With no --out, an exploratory run goes to its own labelled directory, not over the file.
    let o = z30(&d, &["--benchmark", "awgn", "--frames", "1", "--replicate", "4"]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let expected = if label.ends_with("-dirty") {
        std::fs::read_dir(d.join("research/results/unpublished")).unwrap().next().unwrap().unwrap().path().join("replicates/r4/awgn.json")
    } else {
        d.join("research/results/exploratory").join(&commit).join("replicates/r4/awgn.json")
    };
    let r = read(&expected);
    assert!(r["status"] == "exploratory" || r["status"] == "dirty", "{}", r["status"]);
    assert!(r["not_the_published_run"].is_string());
    assert_eq!(std::fs::read_to_string(published.join("awgn.json")).unwrap(), original);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn terminal_only_benchmarks_refuse_options_they_would_ignore() {
    let d = scratch("perf");
    let o = z30(&d, &["--benchmark", "perf", "--frames", "1", "--out", "x"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("apply to suite benchmarks"));
    let _ = std::fs::remove_dir_all(&d);
}
