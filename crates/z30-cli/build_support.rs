//! Build provenance shared by the `z30` and `z30-gui` build scripts (each includes this file
//! with `#[path]`), and unit-tested from `z30-cli` (`main.rs` includes it under `cfg(test)`).
//!
//! A binary names the commit it was built from, and says `-dirty` when the tree it was built
//! from was not that commit. The first version of this code asked Cargo to rerun the build
//! script only when `.git/HEAD` or `.git/index` changed. An unstaged edit in a dependency crate
//! changes neither, so Cargo recompiled the edited crate, relinked the binary and kept the old,
//! clean label: a modified receiver could publish under a clean commit (audit 2026-09-28,
//! RES-03 / F-13; `audit/2026-09-28-agent-team-review/evidence/c1-buildrs-tiebreak/`). The
//! script now reruns whenever any source directory of any workspace crate the binary is built
//! from changes (Cargo scans a directory recursively), and whenever the lock file, the workspace
//! manifest or the checked-out commit changes.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

/// Runs git in `dir`; `None` when git is missing or fails.
pub fn git(dir: &Path, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git").current_dir(dir).args(args).output().ok().filter(|o| o.status.success()).map(|o| o.stdout)
}

fn git_text(dir: &Path, args: &[&str]) -> Option<String> {
    git(dir, args).map(|b| String::from_utf8_lossy(&b).trim().to_string())
}

/// What the build knows about the source it was built from.
pub struct Source {
    /// Short commit, or "unknown" when git cannot say.
    pub commit: String,
    /// Tracked changes anywhere in the tree, or untracked files among the crate sources.
    pub dirty: bool,
    /// sha256 (12 hex) of `git diff HEAD --binary` plus every untracked crate source, when dirty.
    pub diff_sha256: Option<String>,
}

/// The commit label every artefact reports: `<commit>` or `<commit>-dirty`.
pub fn label(s: &Source) -> String {
    format!("{}{}", s.commit, if s.dirty { "-dirty" } else { "" })
}

pub fn source(root: &Path) -> Source {
    let commit = git_text(root, &["rev-parse", "--short=12", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let tracked = git_text(root, &["status", "--porcelain", "--untracked-files=no"]);
    // An untracked file under crates/ can be compiled in (`include_str!`, a new `src/bin/`)
    // without any tracked file changing; it is not the commit either.
    let untracked = git_text(root, &["ls-files", "--others", "--exclude-standard", "--", "crates", "Cargo.toml", "Cargo.lock"]);
    let dirty = tracked.as_deref().is_some_and(|s| !s.is_empty()) || untracked.as_deref().is_some_and(|s| !s.is_empty());
    let diff_sha256 = dirty.then(|| {
        let mut bytes = git(root, &["diff", "HEAD", "--binary"]).unwrap_or_default();
        for path in untracked.as_deref().unwrap_or("").lines().filter(|l| !l.is_empty()) {
            bytes.extend_from_slice(b"\0untracked\0");
            bytes.extend_from_slice(path.as_bytes());
            bytes.push(0);
            bytes.extend_from_slice(&std::fs::read(root.join(path)).unwrap_or_default());
        }
        hex(&sha256(&bytes))[..12].to_string()
    });
    Source { commit, dirty, diff_sha256 }
}

/// The workspace member directories (relative to `root`) that `package` is built from, read from
/// `Cargo.lock`: the package itself and every path dependency, transitively. `None` if the lock
/// file cannot be read or a member's directory is not where the workspace keeps it
/// (`crates/<name>`), in which case the caller watches all of `crates/`.
pub fn member_closure(root: &Path, package: &str) -> Option<Vec<String>> {
    let lock = std::fs::read_to_string(root.join("Cargo.lock")).ok()?;
    let pkgs = parse_lock(&lock);
    let mut todo = vec![package.to_string()];
    let mut seen: Vec<String> = Vec::new();
    while let Some(name) = todo.pop() {
        if seen.contains(&name) {
            continue;
        }
        let p = pkgs.iter().find(|p| p.name == name && p.source.is_none())?;
        seen.push(name.clone());
        for d in &p.deps {
            if pkgs.iter().any(|q| q.name == d.0 && q.source.is_none()) {
                todo.push(d.0.clone());
            }
        }
    }
    seen.sort();
    let dirs: Vec<String> = seen.iter().map(|n| format!("crates/{n}")).collect();
    dirs.iter().all(|d| root.join(d).join("Cargo.toml").is_file()).then_some(dirs)
}

/// A `[[package]]` of Cargo.lock: name, version, source (None for a workspace member) and its
/// dependencies as (name, optional version).
pub struct LockPackage {
    pub name: String,
    pub version: String,
    pub source: Option<String>,
    pub deps: Vec<(String, Option<String>)>,
}

pub fn parse_lock(text: &str) -> Vec<LockPackage> {
    let mut out: Vec<LockPackage> = Vec::new();
    let mut in_deps = false;
    let unquote = |s: &str| s.trim().trim_end_matches(',').trim().trim_matches('"').to_string();
    for line in text.lines() {
        let t = line.trim();
        if t == "[[package]]" {
            out.push(LockPackage { name: String::new(), version: String::new(), source: None, deps: Vec::new() });
            in_deps = false;
            continue;
        }
        let Some(p) = out.last_mut() else { continue };
        if in_deps {
            if t.starts_with(']') {
                in_deps = false;
            } else if !t.is_empty() {
                let d = unquote(t);
                let mut it = d.split_whitespace();
                let name = it.next().unwrap_or("").to_string();
                p.deps.push((name, it.next().map(str::to_string)));
            }
            continue;
        }
        if let Some(v) = t.strip_prefix("name = ") {
            p.name = unquote(v);
        } else if let Some(v) = t.strip_prefix("version = ") {
            p.version = unquote(v);
        } else if let Some(v) = t.strip_prefix("source = ") {
            p.source = Some(unquote(v));
        } else if let Some(v) = t.strip_prefix("dependencies = [") {
            // Either a one-line list or the start of a multi-line one.
            if let Some(inner) = v.strip_suffix(']') {
                for d in inner.split(',').map(unquote).filter(|d| !d.is_empty()) {
                    let mut it = d.split_whitespace();
                    let name = it.next().unwrap_or("").to_string();
                    p.deps.push((name, it.next().map(str::to_string)));
                }
            } else {
                in_deps = true;
            }
        }
    }
    out
}

/// The external (registry) packages in the dependency closure of `package`, as "name version",
/// sorted: what a lock-file change would have to touch to change that package's inputs.
pub fn external_closure(lock: &str, package: &str) -> Vec<String> {
    let pkgs = parse_lock(lock);
    let mut todo = vec![(package.to_string(), None::<String>)];
    let mut seen: Vec<(String, String)> = Vec::new();
    while let Some((name, version)) = todo.pop() {
        for p in pkgs.iter().filter(|p| p.name == name && version.as_ref().is_none_or(|v| *v == p.version)) {
            if seen.iter().any(|s| s.0 == p.name && s.1 == p.version) {
                continue;
            }
            seen.push((p.name.clone(), p.version.clone()));
            todo.extend(p.deps.iter().cloned());
        }
    }
    let mut out: Vec<String> = seen
        .into_iter()
        .filter(|(n, v)| pkgs.iter().any(|p| &p.name == n && &p.version == v && p.source.is_some()))
        .map(|(n, v)| format!("{n} {v}"))
        .collect();
    out.sort();
    out
}

/// The files that make up the benchmark instrument, relative to the workspace root: the harness
/// (`suite.rs`, `bench.rs`), the channel models, and the whole of `z30-protocol`, which encodes
/// the test frames (codec, CRC, LDPC, symbol map) and modulates them. A candidate that edits any
/// of these measures itself with a different instrument (RES-02). Only the modulator was hashed
/// at first, so an encoder edit changed the frames without changing the identity (post-remediation
/// QA-B). `main.rs` is left out on purpose: it only parses options and dispatches, and what it
/// passes on (benchmark, seed, replicate, frames, `RxConfig`) is recorded in every result and
/// checked separately; hashing it would make every CLI edit refuse a comparison.
pub fn instrument_files(root: &Path) -> Vec<String> {
    let mut files = vec!["crates/z30-cli/src/suite.rs".to_string(), "crates/z30-cli/src/bench.rs".to_string()];
    for krate in ["z30-channel", "z30-protocol"] {
        files.push(format!("crates/{krate}/Cargo.toml"));
        let mut src = Vec::new();
        walk(&root.join("crates").join(krate).join("src"), &mut src);
        let mut src: Vec<String> =
            src.iter().filter_map(|p| p.strip_prefix(root).ok()).map(|p| p.to_string_lossy().replace('\\', "/")).collect();
        src.sort();
        files.extend(src);
    }
    files
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else {
            out.push(p);
        }
    }
}

/// sha256 of a text file's content with CRLF read as LF, so a Windows checkout (autocrlf) and a
/// Unix one of the same commit agree. "missing" if it cannot be read.
pub fn file_sha256(path: &Path) -> String {
    match std::fs::read(path) {
        Ok(b) => hex(&sha256(&lf(&b))),
        Err(_) => "missing".into(),
    }
}

pub fn lf(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len());
    for (i, &c) in b.iter().enumerate() {
        if !(c == b'\r' && b.get(i + 1) == Some(&b'\n')) {
            out.push(c);
        }
    }
    out
}

/// Emits every `cargo:` line both binaries need. `instrument`: also embed the benchmark
/// instrument's identity (z30-cli only).
pub fn emit(package: &str, instrument: bool) {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let root = manifest.join("..").join("..");
    let root = root.canonicalize().unwrap_or(root);
    let src = source(&root);
    println!("cargo:rustc-env=Z30_BUILD_COMMIT={}", label(&src));
    println!("cargo:rustc-env=Z30_BUILD_DIRTY_DIFF_SHA256={}", src.diff_sha256.as_deref().unwrap_or(""));
    // SOURCE_DATE_EPOCH (reproducible builds) wins; otherwise the time of this build.
    let epoch = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0));
    println!("cargo:rustc-env=Z30_BUILD_DATE={}", iso_utc(epoch));
    println!("cargo:rustc-env=Z30_BUILD_TARGET={}", std::env::var("TARGET").unwrap_or_else(|_| "unknown".into()));
    println!("cargo:rustc-env=Z30_BUILD_PROFILE={}", std::env::var("PROFILE").unwrap_or_else(|_| "unknown".into()));
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let rustc_version = Command::new(rustc)
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=Z30_BUILD_RUSTC={rustc_version}");
    // rustfft picks its SIMD kernels at run time, and -C target-cpu / target-feature change code
    // generation: both can change floating-point results (RES-09). Record what was asked for.
    let flags = std::env::var("CARGO_ENCODED_RUSTFLAGS").unwrap_or_default().replace('\x1f', " ");
    println!("cargo:rustc-env=Z30_BUILD_RUSTFLAGS={}", flags.trim());
    println!("cargo:rustc-env=Z30_BUILD_TARGET_FEATURES={}", std::env::var("CARGO_CFG_TARGET_FEATURE").unwrap_or_default());
    let lock = std::fs::read(root.join("Cargo.lock")).unwrap_or_default();
    println!("cargo:rustc-env=Z30_BUILD_CARGO_LOCK_SHA256={}", if lock.is_empty() { "missing".into() } else { hex(&sha256(&lf(&lock))) });
    if instrument {
        let files = instrument_files(&root);
        let per_file: Vec<String> = files.iter().map(|f| format!("{f}={}", file_sha256(&root.join(f)))).collect();
        let deps = external_closure(&String::from_utf8_lossy(&lock), "z30-channel");
        let mut id = per_file.join("\n");
        id.push_str("\nlock:");
        id.push_str(&deps.join(","));
        println!("cargo:rustc-env=Z30_BUILD_INSTRUMENT_SHA256={}", hex(&sha256(id.as_bytes())));
        println!("cargo:rustc-env=Z30_BUILD_INSTRUMENT_FILES={}", per_file.join(";"));
        println!("cargo:rustc-env=Z30_BUILD_INSTRUMENT_LOCK={}", deps.join(","));
    }

    // Rerun triggers. A path Cargo cannot find counts as changed, so each missing one only makes
    // the script rerun more often, never less.
    match member_closure(&root, package) {
        Some(dirs) => dirs.iter().for_each(|d| println!("cargo:rerun-if-changed={}", root.join(d).display())),
        None => println!("cargo:rerun-if-changed={}", root.join("crates").display()),
    }
    for f in ["Cargo.toml", "Cargo.lock", ".cargo/config.toml", ".cargo/config"] {
        if root.join(f).exists() {
            println!("cargo:rerun-if-changed={}", root.join(f).display());
        }
    }
    // The checked-out commit: HEAD, the branch it points to (loose or packed) and the index.
    // `--git-path` resolves these in a worktree too, where `.git` is a file.
    let git_path = |p: &str| {
        git_text(&root, &["rev-parse", "--git-path", p]).map(|s| if Path::new(&s).is_absolute() { PathBuf::from(s) } else { root.join(s) })
    };
    for p in ["HEAD", "index"] {
        if let Some(path) = git_path(p) {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    if let Some(r) = git_text(&root, &["symbolic-ref", "-q", "HEAD"]) {
        match git_path(&r) {
            Some(loose) if loose.exists() => println!("cargo:rerun-if-changed={}", loose.display()),
            _ => {
                if let Some(packed) = git_path("packed-refs") {
                    println!("cargo:rerun-if-changed={}", packed.display());
                }
            }
        }
    }
    for v in ["SOURCE_DATE_EPOCH", "RUSTFLAGS", "CARGO_BUILD_RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"] {
        println!("cargo:rerun-if-env-changed={v}");
    }
}

/// Unix seconds as `YYYY-MM-DDTHH:MM:SSZ` (days-from-civil, no dependencies).
pub fn iso_utc(t: i64) -> String {
    let days = t.div_euclid(86_400);
    let sod = t.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", sod / 3600, (sod / 60) % 60, sod % 60)
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|v| format!("{v:02x}")).collect()
}

/// SHA-256 (FIPS 180-4). Build scripts take no dependencies here, so the hash is written out;
/// `tests` pins it to the FIPS examples.
pub fn sha256(msg: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
        0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
        0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
        0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
        0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut data = msg.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&((msg.len() as u64).wrapping_mul(8)).to_be_bytes());
    // `data` is padded to a multiple of 64 bytes above, so `as_chunks` leaves no remainder.
    for block in data.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for (i, c) in block.as_chunks::<4>().0.iter().enumerate() {
            w[i] = u32::from_be_bytes(*c);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_the_fips_180_examples() {
        assert_eq!(hex(&sha256(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(hex(&sha256(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            hex(&sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(hex(&sha256(&vec![b'a'; 1_000_000])), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }

    #[test]
    fn crlf_and_lf_checkouts_hash_alike() {
        assert_eq!(lf(b"a\r\nb\r\n"), b"a\nb\n");
        assert_eq!(lf(b"a\rb"), b"a\rb");
    }

    #[test]
    fn the_z30_binary_is_rebuilt_from_every_workspace_crate_it_depends_on() {
        // The label is only as good as the rerun triggers: every workspace crate z30 links must
        // be watched, or an edit there relinks the binary under the old label (F-13).
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dirs = member_closure(&root, "z30-cli").expect("Cargo.lock names every member");
        for d in ["crates/z30-cli", "crates/z30-dsp", "crates/z30-protocol", "crates/z30-channel", "crates/z30-engine", "crates/z30-io"] {
            assert!(dirs.iter().any(|x| x == d), "{d} not watched: {dirs:?}");
        }
        assert!(!dirs.iter().any(|x| x == "crates/z30-gui"), "{dirs:?}");
    }

    #[test]
    fn the_lock_parser_reads_both_dependency_list_forms() {
        let lock = "[[package]]\nname = \"a\"\nversion = \"1.0.0\"\ndependencies = [\n \"b\",\n \"c 2.0.0\",\n]\n\n[[package]]\nname = \"b\"\nversion = \"0.1.0\"\nsource = \"registry+x\"\ndependencies = [\"c 2.0.0\"]\n\n[[package]]\nname = \"c\"\nversion = \"2.0.0\"\nsource = \"registry+x\"\n\n[[package]]\nname = \"c\"\nversion = \"3.0.0\"\nsource = \"registry+x\"\n";
        let p = parse_lock(lock);
        assert_eq!(p.len(), 4);
        assert_eq!(p[0].deps, vec![("b".to_string(), None), ("c".to_string(), Some("2.0.0".to_string()))]);
        assert_eq!(external_closure(lock, "a"), vec!["b 0.1.0".to_string(), "c 2.0.0".to_string()]);
    }

    #[test]
    fn the_instrument_covers_the_frame_encoder_as_well_as_the_modulator() {
        // QA-B: an edit to the codec, CRC, LDPC encoder or symbol map changes the test frames,
        // so it must change the instrument identity, not only an edit to gfsk.rs.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let root = root.canonicalize().unwrap();
        let files = instrument_files(&root);
        for f in [
            "crates/z30-cli/src/suite.rs",
            "crates/z30-cli/src/bench.rs",
            "crates/z30-channel/src/lib.rs",
            "crates/z30-protocol/src/codec.rs",
            "crates/z30-protocol/src/crc.rs",
            "crates/z30-protocol/src/ldpc.rs",
            "crates/z30-protocol/src/symbols.rs",
            "crates/z30-protocol/src/gfsk.rs",
        ] {
            assert!(files.iter().any(|x| x == f), "{f} not in the instrument: {files:?}");
        }
        assert!(files.iter().all(|f| file_sha256(&root.join(f)) != "missing"), "{files:?}");
        assert!(!files.iter().any(|f| f.ends_with("main.rs") || f.contains("z30-dsp")), "{files:?}");
    }

    #[test]
    fn a_dirty_label_says_so() {
        let s = Source { commit: "0123456789ab".into(), dirty: true, diff_sha256: Some("x".into()) };
        assert_eq!(label(&s), "0123456789ab-dirty");
    }
}
