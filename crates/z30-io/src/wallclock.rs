//! The system's UTC and what the operating system says about its synchronisation.
//!
//! z-30 vNext never changes the system clock and never applies an offset derived from RF: the
//! legacy RF time sync could "succeed" on pure noise and persist a 27 s offset (audit H4). The
//! status shown is the operating system's own, and "not checked" where there is no cheap,
//! reliable way to ask.

use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use z30_engine::runtime::WallClock;

/// UTC from `SystemTime`, with a cached OS synchronisation status.
pub struct SystemWallClock {
    cache: Mutex<(Option<Instant>, String)>,
}

impl Default for SystemWallClock {
    fn default() -> Self {
        SystemWallClock { cache: Mutex::new((None, String::new())) }
    }
}

fn query_status() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = std::process::Command::new("timedatectl").args(["show", "-p", "NTPSynchronized", "--value"]).output() {
            match String::from_utf8_lossy(&out.stdout).trim() {
                "yes" => return "system clock NTP-synchronised (timedatectl)".into(),
                "no" => return "system clock NOT synchronised (timedatectl) - decodes will show a DT offset".into(),
                _ => {}
            }
        }
        "system clock (synchronisation status unavailable)".into()
    }
    #[cfg(not(target_os = "linux"))]
    {
        "system clock (synchronisation status not checked on this platform)".into()
    }
}

impl WallClock for SystemWallClock {
    fn utc_now(&self) -> f64 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
    }

    fn status(&self) -> String {
        let mut c = self.cache.lock().unwrap_or_else(|p| p.into_inner());
        if c.0.is_none_or(|t| t.elapsed().as_secs() >= 60) {
            *c = (Some(Instant::now()), query_status());
        }
        c.1.clone()
    }
}
