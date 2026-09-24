//! Where z-30 keeps its files, and the TOML configuration store.
//!
//! The same directory the legacy app used, so migration finds its data and an operator finds
//! theirs: `$Z30_HOME`, else `$XDG_CONFIG_HOME/z30`, else `~/.z30` (every platform; on Windows
//! `~` is `%USERPROFILE%`).

use std::path::{Path, PathBuf};
use z30_engine::config::Config;

/// The data directory (created on demand by the writers, not here).
pub fn data_dir() -> PathBuf {
    if let Some(h) = std::env::var_os("Z30_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(h);
    }
    if let Some(x) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(x).join("z30");
    }
    home().join(".z30")
}

fn home() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
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

/// Saves a configuration atomically (write to a temporary file, then rename).
pub fn save_config(path: &Path, cfg: &Config) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = toml::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
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
}
