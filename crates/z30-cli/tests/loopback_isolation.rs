//! `z30 --loopback-test` cannot reach a transmitter, because the code that runs it has nothing
//! it could reach one with.
//!
//! The 2026-09-24 post-remediation audit (N-04) found that `--loopback-test` played its frame
//! through the configured sound card past the transmit gate, so a radio on VOX would have
//! radiated it. The software loopback now lives in `src/loopback.rs` and works on samples in
//! memory. This test reads that file's code (comments excluded) and fails if anything that can
//! produce sound, key a line or talk to a rig appears in it - the edit that would reconnect the
//! loopback to a radio. The hardware test is `src/audio_loopback.rs`, which refuses any
//! configuration with a PTT method or rig control (its own unit tests).

const FORBIDDEN: [&str; 15] = [
    "audio_loopback",
    "z30_io",
    "cpal",
    "CpalOutput",
    "AudioOutput",
    "AudioInput",
    "PttLine",
    "PttController",
    "open_ptt",
    "VoxPtt",
    "Rigctld",
    "RigControl",
    "runtime::start",
    "SerialPtt",
    "Cm108",
];

fn code_of(path: &str) -> String {
    let src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap();
    src.lines()
        .map(|l| match l.find("//") {
            Some(i) => &l[..i],
            None => l,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn the_software_loopback_has_no_audio_device_ptt_or_rig_control_in_it() {
    let code = code_of("src/loopback.rs");
    assert!(code.contains("fn software_loopback"), "the software loopback moved; update this guard with it");
    for f in FORBIDDEN {
        assert!(
            !code.contains(f),
            "src/loopback.rs uses `{f}`: the software loopback must not be able to reach audio hardware, PTT or a rig"
        );
    }
}

/// Every path the software loopback's (non-test) code names, as `root::a::b` strings.
fn paths_in(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let flush = |cur: &mut String, out: &mut Vec<String>| {
        let t = cur.trim_matches(':').to_string();
        if t.contains("::") {
            out.push(t);
        }
        cur.clear();
    };
    // String literals are text, not paths (the report names its pipeline in one).
    let (mut in_str, mut escaped) = (false, false);
    for c in code.chars() {
        if in_str {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            flush(&mut cur, &mut out);
            in_str = true;
            continue;
        }
        if c.is_ascii_alphanumeric() || c == '_' || c == ':' {
            cur.push(c);
        } else {
            flush(&mut cur, &mut out);
        }
    }
    flush(&mut cur, &mut out);
    out
}

/// Every path a `use` declaration brings in, with grouped imports expanded:
/// `use a::{b::{c}, d as e};` gives `a::b::c` and `a::d`. Without this, `paths_in` saw only
/// `a::` before the brace, so `use z30_engine::{runtime::{start}};` and a bare `start(...)` passed
/// the allowlist (post-remediation review I-2).
fn use_paths(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    for chunk in code.split(';') {
        let Some(start) = chunk.lines().position(|l| {
            let t = l.trim_start();
            t.starts_with("use ") || t.starts_with("pub use ") || t.starts_with("pub(crate) use ")
        }) else {
            continue;
        };
        let stmt: String = chunk.lines().skip(start).collect::<Vec<_>>().join(" ");
        let tree = stmt.trim().trim_start_matches("pub(crate) ").trim_start_matches("pub ").trim_start_matches("use ");
        expand_use("", &tree.split_whitespace().collect::<Vec<_>>().join(" "), &mut out);
    }
    out
}

fn expand_use(prefix: &str, tree: &str, out: &mut Vec<String>) {
    let tree = tree.trim();
    match tree.find('{') {
        Some(open) => {
            let close = tree.rfind('}').expect("unbalanced braces in a use declaration");
            let head = format!("{prefix}{}", tree[..open].trim());
            let (mut depth, mut from) = (0, open + 1);
            for (i, c) in tree.char_indices().take(close).skip(open + 1) {
                match c {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    ',' if depth == 0 => {
                        expand_use(&head, &tree[from..i], out);
                        from = i + 1;
                    }
                    _ => {}
                }
            }
            expand_use(&head, &tree[from..close], out);
        }
        None if !tree.is_empty() => {
            let name = tree.split(" as ").next().unwrap().trim();
            let full = format!("{prefix}{name}");
            out.push(full.strip_suffix("::self").unwrap_or(&full).to_string());
        }
        None => {}
    }
}

#[test]
fn grouped_imports_are_expanded_before_the_allowlist_sees_them() {
    let code = "use z30_engine::{runtime::{start}};\nuse a::b::{c, d::{e, f as g}, self};\nfn x() {\n    use std::fmt::Write;\n}";
    let p = use_paths(code);
    for want in ["z30_engine::runtime::start", "a::b::c", "a::b::d::e", "a::b::d::f", "a::b", "std::fmt::Write"] {
        assert!(p.iter().any(|x| x == want), "{want} missing from {p:?}");
    }
}

#[test]
fn the_software_loopback_reaches_only_an_allowlist_of_crates_and_items() {
    // 2026-09-28 audit F-08 (TX-08): the deny-list above missed `crate::audio_loopback::run`, a
    // one-line edit that would play the frame through the sound card (mutation LOOP-e). This
    // guard is an allowlist instead: anything the loopback names outside it fails, whatever it
    // is called. Adding to the list is a change the transmit-safety review must see.
    let full = code_of("src/loopback.rs");
    let code = full.split("#[cfg(test)]").next().unwrap();
    const ROOTS: [&str; 8] = ["std", "rand", "rustfft", "serde_json", "z30_dsp", "z30_protocol", "z30_channel", "z30_engine"];
    const ENGINE: [&str; 3] = ["z30_engine::pipeline", "z30_engine::slots", "z30_engine::runtime::frame_audio"];
    const CRATE: [&str; 1] = ["crate::version_text"];
    for p in paths_in(code).into_iter().chain(use_paths(code)) {
        let root = p.split("::").next().unwrap();
        let ok = match root {
            "crate" => CRATE.contains(&p.as_str()),
            "super" | "self" => false,
            "z30_engine" => ENGINE.iter().any(|a| p == *a || p.starts_with(&format!("{a}::"))),
            r if ROOTS.contains(&r) => true,
            // Primitive types' associated items (`f64::NAN`, `usize::MAX`).
            "f32" | "f64" | "u8" | "u16" | "u32" | "u64" | "usize" | "i8" | "i16" | "i32" | "i64" | "isize" | "char" | "str" => true,
            // Paths rooted at a local type or enum (`SlotEvent::Ready`, `Message::parse`) are
            // names already imported through a checked `use`.
            r => r.chars().next().is_some_and(|c| c.is_ascii_uppercase()),
        };
        assert!(ok, "src/loopback.rs names `{p}`, which is outside the allowlist of what the software loopback may reach");
    }
    // The allowlist check itself must see the imports (it would pass vacuously on an empty file).
    assert!(paths_in(code).iter().any(|p| p == "z30_engine::runtime::frame_audio"));
    assert!(use_paths(code).iter().any(|p| p == "z30_engine::pipeline::RxPipeline"), "{:?}", use_paths(code));
}

#[test]
fn the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag() {
    let main = code_of("src/main.rs");
    assert!(main.contains("return loopback::run(cli.out.as_deref());"), "--loopback-test must run the software loopback");
    assert!(main.contains("audio_loopback::run(&cfg, cli.confirm_no_transmitter"), "--audio-loopback-test must pass through its refusals");
    assert_eq!(main.matches("audio_loopback::run(").count(), 1, "the hardware loopback has exactly one entry point");
}
