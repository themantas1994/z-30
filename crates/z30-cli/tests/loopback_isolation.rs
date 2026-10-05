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
    blank_non_code(&std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap())
}

/// The source with the contents of comments, string literals and char literals replaced by
/// spaces (newlines kept), so every check below sees code only. Scanning raw text let a `//`
/// inside a string hide the rest of its line from both lists, and a `'{'` and a `'}'` throw the
/// brace count that decides where `mod tests` ends (transmit-safety confirmation, findings 2-3).
fn blank_non_code(src: &str) -> String {
    let c: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let blank = |out: &mut String, ch: char| out.push(if ch == '\n' { '\n' } else { ' ' });
    let mut i = 0;
    while i < c.len() {
        let at = |k: usize| c.get(i + k).copied();
        if c[i] == '/' && at(1) == Some('/') {
            while i < c.len() && c[i] != '\n' {
                blank(&mut out, c[i]);
                i += 1;
            }
        } else if c[i] == '/' && at(1) == Some('*') {
            // Block comments nest in Rust.
            let mut depth = 0;
            while i < c.len() {
                if c[i] == '/' && c.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if c[i] == '*' && c.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    blank(&mut out, c[i]);
                    i += 1;
                }
            }
        } else if (c[i] == 'r' || ((c[i] == 'b' || c[i] == 'c') && at(1) == Some('r'))) && {
            // Raw string: r"..", r#".."#, br#".."#, cr#".."#. The prefix must start a token, not
            // end a name. Without `cr`, `cr"\"` read as an ordinary string whose `\"` escaped
            // its own end, hiding the rest of the line (CTO re-review N-6).
            let k = if c[i] == 'r' { 0 } else { 1 };
            let hashes = c[i + k + 1..].iter().take_while(|&&h| h == '#').count();
            let ident_before = i > 0 && (c[i - 1].is_alphanumeric() || c[i - 1] == '_');
            !ident_before && c.get(i + k + 1 + hashes) == Some(&'"')
        } {
            let k = if c[i] == 'r' { 0 } else { 1 };
            let hashes = c[i + k + 1..].iter().take_while(|&&h| h == '#').count();
            let open = k + 1 + hashes + 1;
            out.extend(&c[i..i + open]);
            i += open;
            let close: String = std::iter::once('"').chain(std::iter::repeat_n('#', hashes)).collect();
            while i < c.len() && !c[i..].iter().collect::<String>().starts_with(&close) {
                blank(&mut out, c[i]);
                i += 1;
            }
            out.push_str(&close);
            i += close.chars().count();
        } else if c[i] == '"' {
            out.push('"');
            i += 1;
            while i < c.len() && c[i] != '"' {
                if c[i] == '\\' && i + 1 < c.len() {
                    blank(&mut out, c[i]);
                    i += 1;
                }
                blank(&mut out, c[i]);
                i += 1;
            }
            out.push('"');
            i += 1;
        } else if c[i] == '\'' {
            // A char literal ('x', '\n', '\u{7f}'), or a lifetime or label ('a, 'outer:), which
            // is code and kept.
            let len = if at(1) == Some('\\') {
                c[i + 3..].iter().position(|&x| x == '\'').map(|p| p + 4)
            } else if at(2) == Some('\'') {
                Some(3)
            } else {
                None
            };
            match len {
                Some(n) => {
                    out.push('\'');
                    for _ in 1..n - 1 {
                        out.push(' ');
                    }
                    out.push('\'');
                    i += n;
                }
                None => {
                    out.push('\'');
                    i += 1;
                }
            }
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    out
}

#[test]
fn literals_and_comments_cannot_hide_code_from_the_guard() {
    // Both of the confirmation re-review's surviving mutants, as source text.
    let url = blank_non_code("let _u = \"http://\"; let _ = std::net::TcpStream::connect(x);");
    assert!(paths_in(&url).iter().any(|p| p == "std::net::TcpStream::connect"), "{url}");
    // Raw strings of every prefix end at their own closing quote, backslash or not (CTO N-6).
    for prefix in ["r", "br", "cr"] {
        let raw = blank_non_code(&format!("let _ = {prefix}\"\\\"; std::net::TcpStream::connect(x); let _ = \"\";"));
        assert!(paths_in(&raw).iter().any(|p| p == "std::net::TcpStream::connect"), "{prefix}: {raw}");
    }
    let braces = "fn run() { side() }\n#[cfg(test)]\nmod tests { fn a() { let _ = '{'; } }\nfn side() { let _ = '}'; std::net::x(); }\n";
    assert!(non_test_code(&blank_non_code(braces)).is_err(), "code after `mod tests` passed as part of it");
    // Comments go, code survives, lifetimes are code.
    let mixed = blank_non_code("/* a /* nested */ std::net::x */ fn f<'a>(s: &'a str) -> char { let _ = r#\"}\"#; '\\'' } // std::process");
    assert!(!mixed.contains("std::net") && !mixed.contains("std::process"), "{mixed}");
    assert_eq!((mixed.matches('{').count(), mixed.matches('}').count()), (1, 1), "{mixed}");
    assert!(mixed.contains("fn f<'a>(s: &'a str) -> char"), "{mixed}");
}

/// The code compiled outside tests: everything before the single `#[cfg(test)]`, which must
/// introduce a `mod tests` running to the end of the file.
fn non_test_code(full: &str) -> Result<&str, String> {
    // Exactly one test-only item, `mod tests`, running to the end of the file. Splitting at the
    // first `#[cfg(test)]` let any test-only item placed earlier hide everything after it (`run()`
    // included) from every check below (transmit-safety re-review R-2).
    if full.matches("#[cfg(test)]").count() != 1 {
        return Err("src/loopback.rs: exactly one #[cfg(test)], the final `mod tests`".into());
    }
    let (code, tests) = full.split_once("#[cfg(test)]").unwrap();
    let tests = tests.trim_start();
    if !tests.starts_with("mod tests {") {
        return Err("the only #[cfg(test)] item must be `mod tests`".into());
    }
    let mut depth = 0i32;
    let mut closed_at = None;
    for (i, ch) in tests.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    closed_at = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let closed_at = closed_at.ok_or("`mod tests` is not closed")?;
    if !tests[closed_at + 1..].trim().is_empty() {
        return Err("`mod tests` must run to the end of src/loopback.rs: nothing may follow it unchecked".into());
    }
    Ok(code)
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
    let code = non_test_code(&full).unwrap_or_else(|e| panic!("{e}"));
    // Source the checks below cannot see: a `mod m;` loads src/loopback/m.rs, and `#[macro_use]`
    // brings its macros in unqualified; `#[path]` points a module anywhere (confirmation re-review,
    // finding 2). `mod tests` is the only module, and it is cfg(test).
    for m in ["#[macro_use", "#[path", "#![macro_use"] {
        assert!(!full.contains(m), "src/loopback.rs uses `{m}`, which can bring in code the allowlist cannot see");
    }
    assert!(
        !code.split(|c: char| !(c.is_alphanumeric() || c == '_')).any(|w| w == "mod"),
        "src/loopback.rs declares a module outside `mod tests`: its source would not be checked"
    );
    const ROOTS: [&str; 7] = ["rand", "rustfft", "serde_json", "z30_dsp", "z30_protocol", "z30_channel", "z30_engine"];
    // `std` by sub-path, not whole: all of `std` admitted `std::net` (a TCP `T 1` to rigctld),
    // `std::process` (`rigctl`, `aplay`) and `std::fs` on a tty, which asserts DTR/RTS when opened
    // (transmit-safety audit T-1). No file-system access at all: main.rs writes the report
    // (re-review R-3).
    const STD: [&str; 7] = ["std::f64", "std::f32", "std::collections", "std::time", "std::fmt", "std::iter", "std::cmp"];
    const ENGINE: [&str; 3] = ["z30_engine::pipeline", "z30_engine::slots", "z30_engine::runtime::frame_audio"];
    const CRATE: [&str; 1] = ["crate::version_text"];
    for p in paths_in(code).into_iter().chain(use_paths(code)) {
        let root = p.split("::").next().unwrap();
        let ok = match root {
            "crate" => CRATE.contains(&p.as_str()),
            "std" => STD.iter().any(|a| p == *a || p.starts_with(&format!("{a}::"))),
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
    // Source pulled in by macro is invisible to the path checks: refused outright.
    for m in ["include!", "include_str!", "include_bytes!"] {
        assert!(!code.contains(m), "src/loopback.rs uses `{m}`, which can bring in code the allowlist cannot see");
    }
    // The allowlist check itself must see the imports (it would pass vacuously on an empty file).
    assert!(paths_in(code).iter().any(|p| p == "z30_engine::runtime::frame_audio"));
    assert!(use_paths(code).iter().any(|p| p == "z30_engine::pipeline::RxPipeline"), "{:?}", use_paths(code));
}

#[test]
fn the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag() {
    let main = code_of("src/main.rs");
    // The report is written by main.rs (refusing devices), not by the loopback (re-review R-3).
    assert!(main.contains("let (text, pass) = loopback::run()?;"), "--loopback-test must run the software loopback");
    assert!(main.contains("write_report_file(p, &text)"), "the loopback report is written through the device-refusing writer");
    assert!(main.contains("audio_loopback::run(&cfg, cli.confirm_no_transmitter"), "--audio-loopback-test must pass through its refusals");
    assert_eq!(main.matches("audio_loopback::run(").count(), 1, "the hardware loopback has exactly one entry point");
}
