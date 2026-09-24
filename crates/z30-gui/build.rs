//! Embeds what a release artefact needs to identify itself (`--version`): the commit it was
//! built from (and whether the tree was dirty), the build date, the target triple and the
//! profile. The audit's C6 was a shipped bundle 49 commits stale that nothing noticed; a binary
//! that names its commit can be checked against the commit it claims to be.
fn main() {
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    let commit = git(&["rev-parse", "--short=12", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain", "--untracked-files=no"]).map(|s| !s.is_empty()).unwrap_or(false);
    println!("cargo:rustc-env=Z30_BUILD_COMMIT={commit}{}", if dirty { "-dirty" } else { "" });
    // SOURCE_DATE_EPOCH (reproducible builds) wins; otherwise the time of this build.
    let epoch = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0));
    println!("cargo:rustc-env=Z30_BUILD_DATE={}", iso_utc(epoch));
    println!("cargo:rustc-env=Z30_BUILD_TARGET={}", std::env::var("TARGET").unwrap_or_else(|_| "unknown".into()));
    println!("cargo:rustc-env=Z30_BUILD_PROFILE={}", std::env::var("PROFILE").unwrap_or_else(|_| "unknown".into()));
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let rustc_version = std::process::Command::new(rustc)
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=Z30_BUILD_RUSTC={rustc_version}");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/index");
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
}

/// Unix seconds as `YYYY-MM-DDTHH:MM:SSZ` (days-from-civil, no dependencies).
fn iso_utc(t: i64) -> String {
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
