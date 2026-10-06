//! `z30 --loopback-test` cannot reach a transmitter, because the code that runs it has nothing
//! it could reach one with.
//!
//! The 2026-09-24 post-remediation audit (N-04) found that `--loopback-test` played its frame
//! through the configured sound card past the transmit gate, so a radio on VOX would have
//! radiated it. The software loopback now lives in `src/loopback.rs` and works on samples in
//! memory. This test parses that file and fails if it names anything outside an allowlist of what
//! it may reach - the edit that would reconnect the loopback to a radio (something that can
//! produce sound, key a line or talk to a rig). The hardware test is `src/audio_loopback.rs`, which refuses any
//! configuration with a PTT method or rig control (its own unit tests).

// clippy.toml's disallowed lists are for src/loopback.rs alone (it forbids them); tests run
// the binary and use temporary files.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

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
fn the_lexer_blanks_comments_and_literals_and_keeps_code() {
    // `code_of` feeds the deny-list and the main.rs checks below; the allowlist parses Rust.
    let mixed = blank_non_code("/* a /* nested */ std::net::x */ fn f<'a>(s: &'a str) -> char { let _ = r#\"}\"#; '\\'' } // std::process");
    assert!(!mixed.contains("std::net") && !mixed.contains("std::process"), "{mixed}");
    assert_eq!((mixed.matches('{').count(), mixed.matches('}').count()), (1, 1), "{mixed}");
    assert!(mixed.contains("fn f<'a>(s: &'a str) -> char"), "{mixed}");
    for prefix in ["r", "br", "cr"] {
        let raw = blank_non_code(&format!("let _ = {prefix}\"\\\"; std::net::TcpStream::connect(x); let _ = \"\";"));
        assert!(raw.contains("std::net::TcpStream::connect"), "{prefix}: {raw}");
    }
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

// The allowlist. It parses src/loopback.rs as Rust (`syn`) and checks every path, `use` tree,
// macro invocation (and the tokens inside it), attribute and item outside the final
// `#[cfg(test)] mod tests`. It replaced a text scanner that each review got round: a test-only
// item hiding what followed it (re-review R-2), brace and string literals (02c), raw C strings,
// `extern crate std as Std`, a macro metavariable in a path, spacing and `include !` (02d).

const ROOTS: [&str; 6] = ["rand", "rustfft", "serde_json", "z30_dsp", "z30_protocol", "z30_channel"];
// `std` by sub-path, not whole: all of `std` admitted `std::net` (a TCP `T 1` to rigctld),
// `std::process` (`rigctl`, `aplay`) and `std::fs` on a tty, which asserts DTR/RTS when opened
// (transmit-safety audit T-1). No file-system access at all: main.rs writes the report (R-3).
// `core` and `alloc` are held to the same list (`core::net` exists).
const STD: [&str; 7] = ["f64", "f32", "collections", "time", "fmt", "iter", "cmp"];
const ENGINE: [&str; 3] = ["z30_engine::pipeline", "z30_engine::slots", "z30_engine::runtime::frame_audio"];
const CRATE: [&str; 1] = ["crate::version_text"];
const MACROS: [&str; 10] = ["format", "vec", "json", "println", "eprintln", "write", "writeln", "assert", "assert_eq", "matches"];
const PRIMITIVES: [&str; 14] = ["f32", "f64", "u8", "u16", "u32", "u64", "usize", "i8", "i16", "i32", "i64", "isize", "char", "str"];
// Names in scope without an import: the prelude's types and variants.
const PRELUDE: [&str; 10] = ["Self", "Vec", "String", "Option", "Some", "None", "Result", "Ok", "Err", "Box"];

#[derive(Default)]
struct Guard {
    /// Path roots the file binds: the types it declares and the names a checked `use` imports.
    /// Not functions or constants: they are values, and `fn crossbeam_channel() {}` left
    /// `crossbeam_channel::..` naming the crate (02e S6).
    bound: std::collections::HashSet<String>,
    paths: Vec<String>,
    bad: Vec<String>,
}

fn path_string(p: &syn::Path) -> String {
    p.segments.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::")
}

impl Guard {
    fn use_tree(&mut self, prefix: &str, t: &syn::UseTree) {
        let join = |a: &str, b: &str| if a.is_empty() { b.to_string() } else { format!("{a}::{b}") };
        match t {
            syn::UseTree::Path(p) => self.use_tree(&join(prefix, &p.ident.to_string()), &p.tree),
            syn::UseTree::Name(n) => {
                let name = n.ident.to_string();
                let full = if name == "self" { prefix.to_string() } else { join(prefix, &name) };
                self.bound.insert(full.rsplit("::").next().unwrap().to_string());
                self.paths.push(full);
            }
            // A renamed import is how `std::net` would come back under another name.
            syn::UseTree::Rename(r) => {
                self.bad.push(format!("`use {} as {}`: renamed imports are refused", join(prefix, &r.ident.to_string()), r.rename))
            }
            syn::UseTree::Glob(_) => self.bad.push(format!("`use {prefix}::*`: a glob brings in names nothing here checks")),
            syn::UseTree::Group(g) => g.items.iter().for_each(|i| self.use_tree(prefix, i)),
        }
    }

    /// Every `a::b` run in a macro's tokens (whitespace is not a token, so `std :: net` is
    /// `std::net`), held to rules strict enough that no path can be split: `::` only between two
    /// names, so `::<`, `::{` and `::*` are refused and `<T>::` too; no `use`; no `$`. Losing the
    /// prefix at `::<` let `std::net::TcpStream::connect::<&str>(..)` inside `format!` pass, and a
    /// `use` inside a block in a macro argument imported anything (transmit-safety 02e S1-S5).
    fn tokens(&mut self, ts: proc_macro2::TokenStream) {
        use proc_macro2::{Spacing, TokenTree};
        let toks: Vec<TokenTree> = ts.into_iter().collect();
        let is_sep = |i: usize| {
            matches!((toks.get(i), toks.get(i + 1)),
                (Some(TokenTree::Punct(a)), Some(TokenTree::Punct(b))) if a.as_char() == ':' && a.spacing() == Spacing::Joint && b.as_char() == ':')
        };
        let mut run: Vec<String> = Vec::new();
        let flush = |run: &mut Vec<String>, paths: &mut Vec<String>| {
            if run.len() > 1 {
                paths.push(run.join("::"));
            }
            run.clear();
        };
        let mut i = 0;
        while i < toks.len() {
            if is_sep(i) {
                let after_name = i > 0 && matches!(toks[i - 1], TokenTree::Ident(_));
                let before_name = matches!(toks.get(i + 2), Some(TokenTree::Ident(_)));
                if !(after_name && before_name) {
                    self.bad.push("`::` not between two names in a macro invocation (`::<`, `::{`, `::*`, `<T>::`)".into());
                }
                i += 2;
                continue;
            }
            match &toks[i] {
                TokenTree::Ident(id) => {
                    if id == "use" || id == "extern" || id == "mod" {
                        self.bad.push(format!("`{id}` inside a macro invocation"));
                    }
                    // A name not preceded by `::` starts a new path.
                    if !(i >= 2 && is_sep(i - 2)) {
                        flush(&mut run, &mut self.paths);
                    }
                    run.push(id.to_string());
                }
                TokenTree::Punct(p) => {
                    if p.as_char() == '$' {
                        self.bad.push("`$` in a macro invocation".into());
                    }
                    flush(&mut run, &mut self.paths);
                }
                TokenTree::Group(g) => {
                    flush(&mut run, &mut self.paths);
                    self.tokens(g.stream());
                }
                TokenTree::Literal(_) => flush(&mut run, &mut self.paths),
            }
            i += 1;
        }
        flush(&mut run, &mut self.paths);
    }

    fn check(&self, p: &str) -> bool {
        let segs: Vec<&str> = p.split("::").collect();
        if segs.len() < 2 {
            return true;
        }
        let under = |list: &[&str], p: &str| list.iter().any(|a| p == *a || p.starts_with(&format!("{a}::")));
        match segs[0] {
            "crate" => CRATE.contains(&p),
            "std" | "core" | "alloc" => STD.contains(&segs[1]),
            "super" | "self" => false,
            "z30_engine" => under(&ENGINE, p),
            r if ROOTS.contains(&r) || PRIMITIVES.contains(&r) => true,
            r => self.bound.contains(r) || PRELUDE.contains(&r),
        }
    }
}

impl<'ast> syn::visit::Visit<'ast> for Guard {
    fn visit_item(&mut self, i: &'ast syn::Item) {
        match i {
            syn::Item::ExternCrate(e) => self.bad.push(format!("`extern crate {}`: a crate (or `std`) under another name", e.ident)),
            syn::Item::Mod(m) => self.bad.push(format!("`mod {}`: its source is not checked", m.ident)),
            syn::Item::ForeignMod(_) => self.bad.push("an `extern` block".into()),
            syn::Item::Macro(m) => self.bad.push(format!("item macro `{}!` (macro_rules! included)", path_string(&m.mac.path))),
            syn::Item::Verbatim(_) => self.bad.push("unparsed item".into()),
            syn::Item::Use(u) => self.use_tree("", &u.tree),
            _ => {}
        }
        syn::visit::visit_item(self, i);
    }
    fn visit_path(&mut self, p: &'ast syn::Path) {
        self.paths.push(path_string(p));
        syn::visit::visit_path(self, p);
    }
    fn visit_macro(&mut self, m: &'ast syn::Macro) {
        let name = path_string(&m.path);
        if !MACROS.contains(&name.as_str()) {
            self.bad.push(format!("macro `{name}!` is not on the list (include!, env! and friends bring in what no check sees)"));
        }
        self.tokens(m.tokens.clone());
        syn::visit::visit_macro(self, m);
    }
    fn visit_attribute(&mut self, a: &'ast syn::Attribute) {
        let name = path_string(a.path());
        // `cfg_attr` hides attributes, `doc = include_str!(..)` among them, in a token list
        // nothing visits (02e S9).
        if name == "path" || name == "macro_use" || name == "cfg_attr" {
            self.bad.push(format!("`#[{name}]`"));
        }
        syn::visit::visit_attribute(self, a);
    }
}

/// Everything in `src` (a whole loopback.rs) that the software loopback must not have.
fn violations(src: &str) -> Vec<String> {
    use syn::visit::Visit;
    let file = match syn::parse_file(src) {
        Ok(f) => f,
        Err(e) => return vec![format!("does not parse: {e}")],
    };
    let mut g = Guard::default();
    // Exactly one test-only item, `mod tests`, last, under exactly `#[cfg(test)]`: anything else
    // marked for tests could hide code compiled into the release binary, and `cfg(any(test, ..))`
    // is compiled into it (R-2, 02d G12).
    let (tests, items) = match file.items.split_last() {
        Some((syn::Item::Mod(m), rest))
            if m.ident == "tests"
                && m.content.is_some()
                && m.attrs.len() == 1
                && m.attrs[0].path().is_ident("cfg")
                && m.attrs[0].parse_args::<syn::Ident>().is_ok_and(|i| i == "test") =>
        {
            (m, rest)
        }
        _ => return vec!["the last item must be `#[cfg(test)] mod tests { .. }`, and only it".into()],
    };
    let _ = tests;
    for i in items {
        match i {
            syn::Item::Struct(x) => drop(g.bound.insert(x.ident.to_string())),
            syn::Item::Enum(x) => drop(g.bound.insert(x.ident.to_string())),
            syn::Item::Type(x) => drop(g.bound.insert(x.ident.to_string())),
            syn::Item::Trait(x) => drop(g.bound.insert(x.ident.to_string())),
            _ => {}
        }
    }
    for a in &file.attrs {
        g.visit_attribute(a);
    }
    for i in items {
        g.visit_item(i);
    }
    let mut bad = std::mem::take(&mut g.bad);
    for p in &g.paths {
        if !g.check(p) {
            bad.push(format!("names `{p}`, which is outside the allowlist of what the software loopback may reach"));
        }
    }
    bad
}

#[test]
fn the_software_loopback_reaches_only_an_allowlist_of_crates_and_items() {
    // 2026-09-28 audit F-08 (TX-08): the deny-list above missed `crate::audio_loopback::run`, a
    // one-line edit that would play the frame through the sound card (mutation LOOP-e). Adding
    // to the lists above is a change the transmit-safety review must see.
    let src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/loopback.rs")).unwrap();
    let bad = violations(&src);
    assert!(bad.is_empty(), "src/loopback.rs:\n  {}", bad.join("\n  "));
    // The semantic layer: clippy resolves names, so what clippy.toml disallows cannot be reached
    // by any alias, glob, macro or trait call, and CI runs clippy with -D warnings. It holds only
    // while loopback.rs forbids those lints and clippy.toml still lists the hazards (02f).
    let file = syn::parse_file(&src).unwrap();
    let forbids = file.attrs.iter().any(|a| {
        a.path().is_ident("forbid") && {
            let t = a.meta.require_list().map(|l| l.tokens.to_string().replace(' ', "")).unwrap_or_default();
            t.contains("clippy::disallowed_methods") && t.contains("clippy::disallowed_types")
        }
    });
    assert!(forbids, "src/loopback.rs must carry #![forbid(clippy::disallowed_methods, clippy::disallowed_types)]");
    let conf = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("clippy.toml")).unwrap();
    for hazard in [
        "std::net::TcpStream",
        "std::fs::File",
        "std::fs::OpenOptions",
        "std::fs::write",
        "std::process::Command",
        "z30_io::audio::CpalOutput",
        "z30_engine::runtime::start",
    ] {
        assert!(conf.contains(&format!("\"{hazard}\"")), "clippy.toml no longer disallows {hazard}");
    }
    // The check must see the imports (it would pass vacuously on an empty file).
    let mut g = Guard::default();
    syn::visit::Visit::visit_file(&mut g, &syn::parse_file(&src).unwrap());
    for want in ["z30_engine::pipeline::RxPipeline", "z30_engine::runtime::frame_audio"] {
        assert!(g.paths.iter().any(|p| p == want), "{want} not seen");
    }
}

#[test]
fn every_way_round_the_allowlist_a_review_found_is_refused() {
    let wrap = |body: &str, after: &str| {
        format!("use z30_engine::pipeline::RxPipeline;\npub fn run() {{ {body} }}\n{after}\n#[cfg(test)]\nmod tests {{}}\n")
    };
    let net = "std::net::TcpStream::connect(\"192.0.2.1:9\");";
    let attacks = [
        ("plain", wrap(net, "")),
        ("grouped import (I-2)", wrap("start();", "use z30_engine::{runtime::{start}};")),
        ("std::fs (R-3)", wrap("std::fs::write(\"/dev/ttyUSB0\", \"\");", "")),
        ("code after mod tests (R-2, 02c)", format!("pub fn run() {{ side(); }}\n#[cfg(test)]\nmod tests {{ fn a() {{ let _ = '{{'; }} }}\nfn side() {{ let _ = '}}'; {net} }}\n")),
        ("cfg(any(test, ..)) (02d G12)", format!("pub fn run() {{}}\n#[cfg(any(test, not(test)))]\nmod tests {{ pub fn x() {{ {net} }} }}\n")),
        ("// in a string (02c)", wrap(&format!("let _u = \"http://\"; {net}"), "")),
        ("raw C string (N-6, 02d G1)", wrap(&format!("let _a = cr#\"x\"y\"#; {net} let _b = cr#\"p\"q\"#;"), "")),
        ("extern crate as (02d G3)", wrap("Std::net::TcpStream::connect(\"192.0.2.1:9\");", "extern crate std as Std;")),
        ("macro metavariable (02d G4)", wrap("via!(net);", "macro_rules! via { ($M:ident) => { std::$M::TcpStream::connect(\"192.0.2.1:9\") } }")),
        ("renamed import in a block (02d G2)", wrap("if true { use std::{net as Net}; Net::TcpStream::connect(\"192.0.2.1:9\"); }", "")),
        ("spaced path (02d G5)", wrap("std :: net :: TcpStream :: connect(\"192.0.2.1:9\");", "")),
        ("spaced path in a macro", wrap("let _ = format!(\"{:?}\", std :: net :: TcpStream :: connect(\"192.0.2.1:9\"));", "")),
        ("include ! (02d G6)", wrap("include ! (\"side.rs\");", "")),
        ("mod with #[path] (02d G13)", wrap("", "#[macro_use]\n#[path = \"side.rs\"]\nmod side;")),
        ("core::net", wrap("core::net::Ipv4Addr::LOCALHOST;", "")),
        ("unbound uppercase root", wrap("Net::TcpStream::connect(\"192.0.2.1:9\");", "")),
        ("qualified path", wrap("<std::net::TcpStream>::connect(\"192.0.2.1:9\");", "")),
        ("glob import", wrap("TcpStream::connect(\"192.0.2.1:9\");", "use std::net::*;")),
        ("audio_loopback", wrap("crate::audio_loopback::run();", "")),
        ("turbofish in a macro (02e S1)", wrap("let _ = format!(\"{:?}\", std::net::TcpStream::connect::<&str>(\"192.0.2.1:9\"));", "")),
        ("renamed group import in a macro block (02e S2)", wrap("let _ = format!(\"{}\", { use std::net::{Shutdown, TcpStream as Vec}; let _s: Option<Shutdown> = None; Vec::connect(\"192.0.2.1:9\").is_ok() });", "")),
        ("qualified path from a macro block import (02e S3)", wrap("let _ = format!(\"{}\", { use std::net::{Shutdown, TcpStream}; let _s: Option<Shutdown> = None; <TcpStream>::connect(\"192.0.2.1:9\").is_ok() });", "")),
        ("glob import in a macro block (02e S4)", wrap("let _ = format!(\"{:?}\", { use std::fs::*; write(\"/dev/null\", \"\") });", "")),
        ("process with a turbofish in a macro (02e S5)", wrap("let _ = format!(\"{:?}\", std::process::Command::new::<&str>(\"rigctl\").status());", "")),
        ("a fn binding a crate name (02e S6)", wrap("let _ = crossbeam_channel::bounded::<u8>(1);", "fn crossbeam_channel() {}")),
        ("cfg_attr (02e S9)", wrap("", "#[cfg_attr(all(), doc = include_str!(\"/dev/null\"))]\nfn side() {}")),
    ];
    for (name, src) in &attacks {
        assert!(!violations(src).is_empty(), "not refused: {name}\n{src}");
    }
    // And the guard is not refusing everything: ordinary loopback-shaped code passes.
    let ok = wrap(
        "let mut p = RxPipeline::new(48_000); let v: Vec<f64> = Vec::new(); let _ = f64::NAN; let _ = std::f64::consts::PI; let _ = format!(\"{}\", z30_dsp::DSP_RATE_HZ); let _ = Some(Thing::A);",
        "enum Thing { A }",
    );
    assert_eq!(violations(&ok), Vec::<String>::new(), "{ok}");
}

#[test]
fn the_cli_runs_the_software_loopback_for_loopback_test_and_the_hardware_one_only_for_its_own_flag() {
    let main = code_of("src/main.rs");
    // The report is written by main.rs (refusing devices), not by the loopback (re-review R-3).
    assert!(main.contains("let (text, pass) = loopback::run()?;"), "--loopback-test must run the software loopback");
    assert!(main.contains("write_report_file(p, &text)"), "the loopback report is written through the device-refusing writer");
    assert!(main.contains("audio_loopback::run(&cfg, cli.confirm_no_transmitter"), "--audio-loopback-test must pass through its refusals");
    assert_eq!(main.matches("audio_loopback::run(").count(), 1, "the hardware loopback has exactly one entry point");
    // The hardware loopback writes its report through the same device-refusing writer, and
    // `--out` is checked before its refusals and before any device opens (02d finding 1).
    // Parsed, not matched: `use std::{fs::File}` has no `std::fs` in its text (02e B5b).
    let mut g = Guard::default();
    let hw_src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/audio_loopback.rs")).unwrap();
    syn::visit::Visit::visit_file(&mut g, &syn::parse_file(&hw_src).unwrap());
    for p in &g.paths {
        assert!(
            !p.split("::").any(|s| s == "fs" || s == "net" || s == "process" || s == "File" || s == "OpenOptions"),
            "src/audio_loopback.rs names `{p}`: its report is written only through crate::write_report_file"
        );
    }
    let hw = code_of("src/audio_loopback.rs");
    assert!(
        !hw.contains("std::fs") && !hw.contains("fs::write"),
        "src/audio_loopback.rs must write its report through crate::write_report_file"
    );
    assert!(hw.contains("crate::write_report_file(p, &text)"), "the hardware loopback's report goes through the device-refusing writer");
}
