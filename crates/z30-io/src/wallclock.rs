//! The system's UTC and what the operating system says about its synchronisation.
//!
//! z-30 vNext never changes the system clock and never applies an offset derived from RF: the
//! legacy RF time sync could "succeed" on pure noise and persist a 27 s offset (audit H4). The
//! status shown is the operating system's own, and "not checked" where there is no cheap,
//! reliable way to ask.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use z30_engine::runtime::WallClock;

/// UTC from `SystemTime`, with a cached OS synchronisation status.
///
/// The status is refreshed on a thread of its own and `status()` only reads the cache: it used
/// to run `timedatectl` (a D-Bus call with no timeout) on the engine's control thread once a
/// minute, which could stall the transmit timeline and HALT (2026-09-28 audit F-16).
pub struct SystemWallClock {
    cache: Arc<Mutex<Cache>>,
    query: fn() -> String,
    refresh_after: Duration,
    stale_after: Duration,
}

struct Cache {
    checked: Option<Instant>,
    text: String,
    /// When the query still outstanding was started.
    refreshing: Option<Instant>,
}

/// A query that has not answered for this long makes the status "unknown" instead of showing
/// the last answer as current: a hung `timedatectl` left an old "NTP-synchronised" on screen
/// for ever, with no age (post-remediation review L-4).
pub const STATUS_QUERY_STALE_AFTER: Duration = Duration::from_secs(30);

/// What `status()` says before the first query has answered.
pub const STATUS_NOT_YET_CHECKED: &str = "system clock (synchronisation status not yet checked)";

impl Default for SystemWallClock {
    fn default() -> Self {
        Self::with_query(query_status)
    }
}

impl SystemWallClock {
    /// A clock whose status comes from `query` (tests inject a slow one).
    pub fn with_query(query: fn() -> String) -> Self {
        Self::with_query_and_intervals(query, Duration::from_secs(60), STATUS_QUERY_STALE_AFTER)
    }

    /// As `with_query`, re-asking after `refresh_after` and calling an unanswered query stale
    /// after `stale_after` (tests shorten both).
    pub fn with_query_and_intervals(query: fn() -> String, refresh_after: Duration, stale_after: Duration) -> Self {
        SystemWallClock {
            cache: Arc::new(Mutex::new(Cache { checked: None, text: STATUS_NOT_YET_CHECKED.into(), refreshing: None })),
            query,
            refresh_after,
            stale_after,
        }
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
        if c.refreshing.is_none() && c.checked.is_none_or(|t| t.elapsed() >= self.refresh_after) {
            c.refreshing = Some(Instant::now());
            let (cache, query) = (self.cache.clone(), self.query);
            let spawned = std::thread::Builder::new().name("z30-clock-status".into()).spawn(move || {
                let text = query();
                let mut c = cache.lock().unwrap_or_else(|p| p.into_inner());
                *c = Cache { checked: Some(Instant::now()), text, refreshing: None };
            });
            if spawned.is_err() {
                c.refreshing = None;
            }
        }
        match c.refreshing {
            Some(since) if since.elapsed() >= self.stale_after => {
                format!("system clock (synchronisation status unknown: the OS has not answered for {} s)", since.elapsed().as_secs())
            }
            _ => c.text.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn synchronised_is_claimed_only_when_the_os_says_so() {
        assert!(status_from_timedatectl(Some("yes\n")).contains("NTP-synchronised"));
        for other in [Some("no"), Some(""), Some("maybe"), Some("YES please"), None] {
            let s = status_from_timedatectl(other);
            assert!(!s.contains("NTP-synchronised"), "{other:?} -> {s}");
        }
    }

    #[test]
    fn f16_the_status_never_blocks_on_the_os_query() {
        fn slow() -> String {
            std::thread::sleep(std::time::Duration::from_millis(500));
            "system clock NTP-synchronised (timedatectl)".into()
        }
        let c = SystemWallClock::with_query(slow);
        let t = Instant::now();
        assert_eq!(c.status(), STATUS_NOT_YET_CHECKED, "nothing is claimed before the OS answered");
        assert_eq!(c.status(), STATUS_NOT_YET_CHECKED);
        assert!(t.elapsed().as_millis() < 100, "status() waited {:?} for the query", t.elapsed());
        let t = Instant::now();
        while c.status() == STATUS_NOT_YET_CHECKED && t.elapsed().as_secs() < 5 {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(c.status().contains("NTP-synchronised"));
    }

    #[test]
    fn l4_a_query_that_stops_answering_turns_an_old_synchronised_into_unknown() {
        static CALLS: AtomicUsize = AtomicUsize::new(0);
        fn first_answers_then_hangs() -> String {
            if CALLS.fetch_add(1, Ordering::SeqCst) > 0 {
                std::thread::sleep(Duration::from_secs(3));
            }
            "system clock NTP-synchronised (timedatectl)".into()
        }
        let c = SystemWallClock::with_query_and_intervals(first_answers_then_hangs, Duration::ZERO, Duration::from_millis(200));
        let t = Instant::now();
        while !c.status().contains("NTP-synchronised") {
            assert!(t.elapsed().as_secs() < 5, "the first query never answered");
            std::thread::sleep(Duration::from_millis(5));
        }
        // The next status starts the second query, which hangs; once it is overdue the old
        // answer is no longer shown as current.
        let t = Instant::now();
        loop {
            let s = c.status();
            if s.contains("unknown") {
                assert!(!s.contains("NTP-synchronised"), "{s}");
                break;
            }
            assert!(t.elapsed().as_secs() < 2, "still showing {s:?} with the query overdue");
            std::thread::sleep(Duration::from_millis(20));
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
