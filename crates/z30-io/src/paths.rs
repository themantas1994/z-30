//! Where z-30 keeps its files, and the TOML configuration store.
//!
//! The same directory the legacy app used, so migration finds its data and an operator finds
//! theirs: `$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30` (every platform). `~` is
//! `$HOME`, else `%USERPROFILE%`, else the home directory the operating system records for the
//! account (`std::env::home_dir`: the password database on Unix, the user profile on Windows).
//! An empty or relative `XDG_CONFIG_HOME`, `HOME` or `USERPROFILE` names no directory and is
//! skipped (the XDG specification says to ignore a relative one): resolved against the current
//! directory, it put the configuration wherever the program happened to be started.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use z30_engine::config::Config;

/// The data directory (created on demand by the writers, not here), or why there is none.
pub fn try_data_dir() -> Result<PathBuf, String> {
    resolve_data_dir(|k| std::env::var_os(k), std::env::home_dir)
}

/// The data directory, for callers that cannot report an error. When `try_data_dir` finds none
/// (no usable `Z30_HOME`, `XDG_CONFIG_HOME`, `HOME` or `USERPROFILE`, and no home directory
/// recorded for the account) this is still `.z30` below the current directory, as it always was;
/// a caller that can report the error should use `try_data_dir` instead.
pub fn data_dir() -> PathBuf {
    try_data_dir().unwrap_or_else(|_| PathBuf::from(".").join(".z30"))
}

/// `try_data_dir` over an injectable environment and account home directory.
fn resolve_data_dir(var: impl Fn(&str) -> Option<OsString>, os_home: impl FnOnce() -> Option<PathBuf>) -> Result<PathBuf, String> {
    // The operator's explicit choice, used as given.
    if let Some(h) = var("Z30_HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(h));
    }
    let absolute = |v: OsString| Some(PathBuf::from(v)).filter(|p| p.is_absolute());
    if let Some(x) = var("XDG_CONFIG_HOME").and_then(absolute) {
        return Ok(x.join("z30"));
    }
    var("HOME")
        .and_then(absolute)
        .or_else(|| var("USERPROFILE").and_then(absolute))
        .or_else(|| os_home().filter(|p| p.is_absolute()))
        .map(|home| home.join(".z30"))
        .ok_or_else(|| {
            "no data directory: neither HOME nor USERPROFILE names an absolute directory and the system records no home \
             directory for this account; set Z30_HOME"
                .to_string()
        })
}

/// vNext configuration file.
pub fn config_path() -> PathBuf {
    data_dir().join("config.toml")
}

/// vNext logbook.
pub fn logbook_path() -> PathBuf {
    data_dir().join("logbook.sqlite")
}

/// Loads a configuration. A missing file is the default (unconfigured - transmit refused).
pub fn load_config(path: &Path) -> Result<Config, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => toml::from_str(&s).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Saves a configuration atomically. It is written to a new file with a name of its own beside
/// `path`, flushed to the disk, then renamed over `path`: a reader, or the next start after a
/// crash or power cut, sees the old file or the new one, never part of one, and two writers no
/// longer write into the same temporary file. The temporary file is removed if any step fails.
///
/// An existing file that is not a configuration z-30 can read (it does not parse, or cannot be
/// read) is **not replaced**, and the error says so. Loading it already reported it and refused
/// transmission; saving over it would destroy what the operator had in it and hide the problem.
/// It has to be corrected or moved away first.
pub fn save_config(path: &Path, cfg: &Config) -> Result<(), String> {
    if let Err(e) = load_config(path) {
        return Err(format!(
            "{e}; this is not a configuration z-30 can read, so it was not replaced: correct it or move it away, then save again"
        ));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let text = toml::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    replace_file(path, text.as_bytes(), |from, to| std::fs::rename(from, to))
}

/// Like [`save_config`], but for the operator's explicit `--migrate --force`: an existing file that
/// cannot be read or parsed is first moved (renamed, in the same directory) to `config.toml.bak`,
/// or `config.toml.bak.<n>` with the smallest unused `n`, so no earlier backup is overwritten; then
/// the new configuration is written atomically. Returns the backup path, or `None` when the
/// existing file was missing or valid (it is then replaced as `save_config` does, with no backup).
///
/// If the backup cannot be made, nothing is written. If the write fails after the backup, the
/// error names the backup so it can be restored.
pub fn save_config_replacing_unreadable(path: &Path, cfg: &Config) -> Result<Option<PathBuf>, String> {
    replacing_unreadable(path, cfg, |from, to| std::fs::rename(from, to))
}

fn replacing_unreadable(
    path: &Path,
    cfg: &Config,
    backup_rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<Option<PathBuf>, String> {
    let backup = if load_config(path).is_err() {
        let bak = unused_backup_name(path)?;
        backup_rename(path, &bak)
            .map_err(|e| format!("cannot back up {} to {}: {e}; nothing was written", path.display(), bak.display()))?;
        Some(bak)
    } else {
        None
    };
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            return Err(restore_hint(format!("cannot create {}: {e}", dir.display()), &backup));
        }
    }
    let text = match toml::to_string_pretty(cfg) {
        Ok(t) => t,
        Err(e) => return Err(restore_hint(e.to_string(), &backup)),
    };
    replace_file(path, text.as_bytes(), |from, to| std::fs::rename(from, to)).map_err(|e| restore_hint(e, &backup))?;
    Ok(backup)
}

fn restore_hint(e: String, backup: &Option<PathBuf>) -> String {
    match backup {
        Some(b) => format!("{e}; the previous file is saved as {}: restore it from there", b.display()),
        None => e,
    }
}

/// `<path>.bak`, else `<path>.bak.1`, `.bak.2`, ...: the first name nothing exists at.
fn unused_backup_name(path: &Path) -> Result<PathBuf, String> {
    let name = path.file_name().ok_or_else(|| format!("{}: not a file name", path.display()))?;
    let dir = path.parent().unwrap_or(Path::new(""));
    for n in 0u32..10_000 {
        let mut b = name.to_os_string();
        b.push(if n == 0 { ".bak".to_string() } else { format!(".bak.{n}") });
        let cand = dir.join(b);
        if std::fs::symlink_metadata(&cand).is_err() {
            return Ok(cand);
        }
    }
    Err(format!("{}: too many backups already exist", path.display()))
}

/// Numbers this process's temporary files; with the process id, each name is used once.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to a new temporary file in `path`'s directory, syncs it, and `rename`s it to
/// `path`. On any failure the temporary file is removed (or the error says it could not be).
fn replace_file(path: &Path, bytes: &[u8], rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>) -> Result<(), String> {
    let name = path.file_name().ok_or_else(|| format!("{}: not a file name", path.display()))?;
    let dir = path.parent().unwrap_or(Path::new(""));
    let (tmp, mut file) = create_temp(dir, name)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    // Closed before the rename: Windows will not rename a file that is open without sharing.
    drop(file);
    let result = written
        .map_err(|e| format!("cannot write {}: {e}", tmp.display()))
        .and_then(|()| rename(&tmp, path).map_err(|e| format!("cannot replace {}: {e}", path.display())));
    match result {
        Ok(()) => Ok(()),
        Err(e) => Err(match std::fs::remove_file(&tmp) {
            Ok(()) => e,
            Err(r) => format!("{e} (and the temporary file {} could not be removed: {r})", tmp.display()),
        }),
    }
}

/// Creates `<name>.<pid>-<n>.tmp` in `dir`, never opening a file that already exists: one left
/// by a killed process that had the same id is skipped, not written into.
fn create_temp(dir: &Path, name: &OsStr) -> Result<(PathBuf, File), String> {
    const ATTEMPTS: usize = 64;
    for _ in 0..ATTEMPTS {
        let mut tmp_name = name.to_os_string();
        tmp_name.push(format!(".{}-{}.tmp", std::process::id(), TEMP_SEQ.fetch_add(1, Ordering::Relaxed)));
        let tmp = dir.join(tmp_name);
        match File::options().write(true).create_new(true).open(&tmp) {
            Ok(f) => return Ok((tmp, f)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("cannot create {}: {e}", tmp.display())),
        }
    }
    Err(format!("cannot create a temporary file in {}: {ATTEMPTS} names were already taken", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use z30_engine::bandplan::{LicenseClass, Region};
    use z30_engine::config::{PttConfig, SerialLine};

    #[test]
    fn config_round_trips_through_toml() {
        let dir = std::env::temp_dir().join(format!("z30-cfg-{}", std::process::id()));
        let path = dir.join("config.toml");
        let mut c = Config::default();
        c.station.callsign = "K1ABC".into();
        c.station.region = Some(Region::Us);
        c.station.license_class = Some(LicenseClass::UsGeneral);
        c.ptt = PttConfig::Serial { port: "/dev/ttyUSB0".into(), line: SerialLine::Rts, active_high: true };
        save_config(&path, &c).unwrap();
        assert_eq!(load_config(&path).unwrap(), c);
        assert_eq!(load_config(&dir.join("missing.toml")).unwrap(), Config::default());
        std::fs::remove_dir_all(dir).ok();
    }

    /// A fresh, empty directory for one test.
    fn scratch(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("z30-cfg-{}-{test}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    fn station(call: &str) -> Config {
        let mut c = Config::default();
        c.station.callsign = call.into();
        c
    }

    #[test]
    fn concurrent_saves_all_succeed_and_leave_one_whole_file() {
        let dir = scratch("concurrent");
        let path = dir.join("config.toml");
        let calls: Vec<String> = (0..8).map(|i| format!("K{i}ABC")).collect();
        std::thread::scope(|s| {
            for call in &calls {
                let path = &path;
                s.spawn(move || {
                    for _ in 0..25 {
                        save_config(path, &station(call)).unwrap();
                    }
                });
            }
        });
        let saved = load_config(&path).unwrap();
        assert!(calls.contains(&saved.station.callsign), "{:?}", saved.station.callsign);
        assert_eq!(saved, station(&saved.station.callsign), "the file is one writer's configuration, whole");
        assert_eq!(entries(&dir), vec!["config.toml"], "no temporary file is left behind");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_failed_rename_removes_the_temporary_file_and_keeps_the_old_configuration() {
        let dir = scratch("rename-fails");
        let path = dir.join("config.toml");
        save_config(&path, &station("K1OLD")).unwrap();
        let e = replace_file(&path, b"[station]\ncallsign = \"K1NEW\"\n", |_, _| Err(std::io::Error::other("injected rename failure")))
            .unwrap_err();
        assert!(e.contains("cannot replace") && e.contains("injected rename failure"), "{e}");
        assert_eq!(entries(&dir), vec!["config.toml"], "the temporary file was removed");
        assert_eq!(load_config(&path).unwrap(), station("K1OLD"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_failed_save_leaves_no_temporary_file() {
        // The destination is a directory: the save fails, and nothing is left beside it.
        let dir = scratch("save-fails");
        let path = dir.join("config.toml");
        std::fs::create_dir(&path).unwrap();
        assert!(save_config(&path, &station("K1ABC")).is_err());
        assert_eq!(entries(&dir), vec!["config.toml"]);
        assert!(path.is_dir());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn an_unreadable_configuration_is_not_replaced() {
        let dir = scratch("invalid");
        let path = dir.join("config.toml");
        let garbage = "[station\ncallsign = \"K1ABC\"\n";
        std::fs::write(&path, garbage).unwrap();
        assert!(load_config(&path).is_err(), "the fixture must be unreadable");
        let e = save_config(&path, &Config::default()).unwrap_err();
        assert!(e.contains("not replaced") && e.contains("config.toml"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), garbage, "the operator's file is untouched");
        assert_eq!(entries(&dir), vec!["config.toml"]);
        // Once it is corrected (here: removed), saving works again.
        std::fs::remove_file(&path).unwrap();
        save_config(&path, &station("K1ABC")).unwrap();
        assert_eq!(load_config(&path).unwrap(), station("K1ABC"));
        std::fs::remove_dir_all(dir).ok();
    }

    const GARBAGE: &str = "[station\ncallsign = \"K1ABC\"\n";

    #[test]
    fn force_backs_up_an_unreadable_configuration_then_writes_the_new_one() {
        let dir = scratch("force-backup");
        let path = dir.join("config.toml");
        std::fs::write(&path, GARBAGE).unwrap();
        let bak = save_config_replacing_unreadable(&path, &station("K1NEW")).unwrap().expect("a backup was made");
        assert_eq!(bak, dir.join("config.toml.bak"));
        assert_eq!(std::fs::read(&bak).unwrap(), GARBAGE.as_bytes());
        assert_eq!(load_config(&path).unwrap(), station("K1NEW"));
        assert_eq!(entries(&dir), vec!["config.toml", "config.toml.bak"]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn force_never_overwrites_an_existing_backup() {
        let dir = scratch("force-no-overwrite");
        let path = dir.join("config.toml");
        std::fs::write(dir.join("config.toml.bak"), "first").unwrap();
        std::fs::write(&path, GARBAGE).unwrap();
        let bak = save_config_replacing_unreadable(&path, &station("K1NEW")).unwrap().unwrap();
        assert_eq!(bak, dir.join("config.toml.bak.1"));
        assert_eq!(std::fs::read_to_string(dir.join("config.toml.bak")).unwrap(), "first");
        assert_eq!(std::fs::read(&bak).unwrap(), GARBAGE.as_bytes());
        assert_eq!(load_config(&path).unwrap(), station("K1NEW"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn force_with_a_failed_backup_writes_nothing() {
        let dir = scratch("force-backup-fails");
        let path = dir.join("config.toml");
        std::fs::write(&path, GARBAGE).unwrap();
        let e = replacing_unreadable(&path, &station("K1NEW"), |_, _| Err(std::io::Error::other("injected backup failure"))).unwrap_err();
        assert!(e.contains("injected backup failure") && e.contains("nothing was written"), "{e}");
        assert_eq!(std::fs::read(&path).unwrap(), GARBAGE.as_bytes(), "the original is untouched");
        assert_eq!(entries(&dir), vec!["config.toml"], "no backup, no temporary file");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn force_on_a_valid_or_missing_configuration_makes_no_backup() {
        let dir = scratch("force-valid");
        let path = dir.join("config.toml");
        assert_eq!(save_config_replacing_unreadable(&path, &station("K1ONE")).unwrap(), None);
        assert_eq!(save_config_replacing_unreadable(&path, &station("K1TWO")).unwrap(), None);
        assert_eq!(load_config(&path).unwrap(), station("K1TWO"));
        assert_eq!(entries(&dir), vec!["config.toml"]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn force_with_a_failed_write_names_the_backup() {
        let dir = scratch("force-write-fails");
        let path = dir.join("config.toml");
        std::fs::write(&path, GARBAGE).unwrap();
        // After the backup, a directory appears at the destination, so the final rename fails.
        let target = path.clone();
        let e = replacing_unreadable(&path, &station("K1NEW"), |from, to| {
            std::fs::rename(from, to)?;
            std::fs::create_dir(&target)
        })
        .unwrap_err();
        assert!(e.contains("cannot replace") && e.contains("config.toml.bak") && e.contains("restore"), "{e}");
        assert_eq!(std::fs::read(dir.join("config.toml.bak")).unwrap(), GARBAGE.as_bytes());
        assert_eq!(entries(&dir), vec!["config.toml", "config.toml.bak"], "no temporary file left");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_data_directory_never_resolves_against_the_current_directory() {
        let base = std::env::temp_dir();
        assert!(base.is_absolute());
        let os = |s: &str| Some(OsString::from(s));
        let abs = |p: &Path| Some(p.as_os_str().to_os_string());
        let env =
            |pairs: Vec<(&'static str, Option<OsString>)>| move |k: &str| pairs.iter().find(|(n, _)| *n == k).and_then(|(_, v)| v.clone());
        let none = || None;

        // Nothing usable anywhere: an error naming the fix, not "./.z30".
        let e = resolve_data_dir(env(vec![]), none).unwrap_err();
        assert!(e.contains("Z30_HOME"), "{e}");
        let e = resolve_data_dir(env(vec![("HOME", os("")), ("USERPROFILE", os(""))]), none).unwrap_err();
        assert!(e.contains("Z30_HOME"), "empty variables name no directory: {e}");
        assert!(resolve_data_dir(env(vec![("HOME", os("relative/home"))]), none).is_err(), "a relative HOME is not used");
        assert!(resolve_data_dir(env(vec![]), || Some(PathBuf::from("relative"))).is_err());

        // HOME, then USERPROFILE, then the account's home directory, as `~`.
        let home = base.join("home");
        let profile = base.join("profile");
        let account = base.join("account");
        let both = env(vec![("HOME", abs(&home)), ("USERPROFILE", abs(&profile))]);
        assert_eq!(resolve_data_dir(both, none).unwrap(), home.join(".z30"));
        assert_eq!(resolve_data_dir(env(vec![("HOME", os("")), ("USERPROFILE", abs(&profile))]), none).unwrap(), profile.join(".z30"));
        assert_eq!(resolve_data_dir(env(vec![]), || Some(account.clone())).unwrap(), account.join(".z30"));

        // XDG_CONFIG_HOME when absolute; a relative one is ignored, as the XDG specification says.
        let xdg = base.join("xdg");
        assert_eq!(resolve_data_dir(env(vec![("XDG_CONFIG_HOME", abs(&xdg)), ("HOME", abs(&home))]), none).unwrap(), xdg.join("z30"));
        assert_eq!(resolve_data_dir(env(vec![("XDG_CONFIG_HOME", os("cfg")), ("HOME", abs(&home))]), none).unwrap(), home.join(".z30"));

        // Z30_HOME first, as given.
        let z = base.join("z30-home");
        assert_eq!(resolve_data_dir(env(vec![("Z30_HOME", abs(&z)), ("XDG_CONFIG_HOME", abs(&xdg))]), none).unwrap(), z);
    }
}
