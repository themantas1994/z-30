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

/// What to say about the clock, from `timedatectl show -p NTPSynchronized --value`'s output
/// (`None` when it could not be run). "Synchronised" is said only when the operating system
/// says so; anything unrecognised is reported as unknown, never as good.
pub fn status_from_timedatectl(output: Option<&str>) -> String {
    match output.map(str::trim) {
        Some("yes") => "system clock NTP-synchronised (timedatectl)".into(),
        Some("no") => "system clock NOT synchronised (timedatectl) - decodes will show a DT offset".into(),
        _ => "system clock (synchronisation status unavailable)".into(),
    }
}

fn query_status() -> String {
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("timedatectl")
            .args(["show", "-p", "NTPSynchronized", "--value"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
        status_from_timedatectl(out.as_deref())
    }
    #[cfg(not(target_os = "linux"))]
    {
        "system clock (synchronisation status not checked on this platform)".into()
    }
}

/// The system clock as UTC seconds since the epoch. A clock set before 1970 is reported as the
/// (negative) time it says, not as 1970: every reader used `unwrap_or(0.0)`, a made-up instant
/// (post-remediation audit N-13). `QsoRecord::validate` refuses such a time either way.
pub fn system_utc() -> f64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs_f64(),
        Err(e) => -e.duration().as_secs_f64(),
    }
}

impl WallClock for SystemWallClock {
    fn utc_now(&self) -> f64 {
        system_utc()
    }

    fn status(&self) -> String {
        let mut c = self.cache.lock().unwrap_or_else(|p| p.into_inner());
        if c.0.is_none_or(|t| t.elapsed().as_secs() >= 60) {
            *c = (Some(Instant::now()), query_status());
        }
        c.1.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synchronised_is_claimed_only_when_the_os_says_so() {
        assert!(status_from_timedatectl(Some("yes\n")).contains("NTP-synchronised"));
        for other in [Some("no"), Some(""), Some("maybe"), Some("YES please"), None] {
            let s = status_from_timedatectl(other);
            assert!(!s.contains("NTP-synchronised"), "{other:?} -> {s}");
        }
    }

    #[test]
    fn utc_is_the_operating_systems_with_no_offset_applied() {
        // vNext has no RF or network time source and applies no offset of its own (the legacy
        // RF sync persisted offsets measured from noise, audit C-03).
        //
        // Bracketed by two OS readings taken around it, with 1 ms of slack for the reads
        // themselves. The old tolerance was 0.5 s - a third of the +-1.5 s DT window - and an
        // own offset of 0.3 s passed it (post-remediation audit, mutation C03-c).
        let c = SystemWallClock::default();
        let os = || SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
        for _ in 0..100 {
            let before = os();
            let t = c.utc_now();
            let after = os();
            assert!(t >= before - 1e-3 && t <= after + 1e-3, "utc_now {t} outside the OS's [{before}, {after}]");
        }
    }
}
