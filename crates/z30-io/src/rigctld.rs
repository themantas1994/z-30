//! Hamlib `rigctld` over TCP: dial readback and control (`RigControl`), and CAT PTT (`PttLine`).
//!
//! Two separate connections, deliberately: the poller's reads must never queue a PTT release
//! behind them (docs/safety.md: "an unkey queued behind a slow read is a transmitter still
//! radiating"). Every socket operation has a timeout, so neither can hang the engine or the
//! watchdog. A command whose reply is not `RPRT 0` is a failure, never a success.
//!
//! A reply is read with two bounds, because the peer is only trusted to be rigctld once it has
//! answered like rigctld: each line is at most `MAX_LINE` bytes, and the whole reply must arrive
//! within `TIMEOUT` of the command. A line that is too long, is cut off by the peer closing, is
//! not text or carries control characters is an error, never a reply.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};
use z30_engine::ptt::{PttAck, PttError, PttLine};
use z30_engine::rig::Reading;
use z30_engine::runtime::RigControl;

const TIMEOUT: Duration = Duration::from_millis(1500);

/// The longest reply line accepted, its newline included. rigctld answers the commands sent here
/// (`f`, `t`, `m`, `F`, `T`) with a frequency, a PTT state, a mode name, a passband or `RPRT n`:
/// a few dozen bytes at most. Unbounded, a peer that never sent a newline made the client buffer
/// everything it sent.
pub const MAX_LINE: usize = 256;

/// The reading half of a connection. Each read gets what is left of the reply's deadline as its
/// timeout: a socket timeout alone restarts with every byte, so a peer sending a byte a second
/// held a command (a CAT release included) for as long as it kept sending.
struct ReplyReader {
    stream: TcpStream,
    deadline: Instant,
}

impl Read for ReplyReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let left = self.deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "rigctld did not finish its reply in time"));
        }
        self.stream.set_read_timeout(Some(left))?;
        self.stream.read(buf)
    }
}

/// Reads one reply line of at most `MAX_LINE` bytes and returns it trimmed. Only a line that
/// ends in a newline counts: a truncated `14074000` read as `1407` was a dial reading, and a
/// cut-off `RPRT 0` a confirmed key or release.
fn read_reply_line(r: &mut impl BufRead) -> Result<String, String> {
    let mut raw = Vec::new();
    let n = r.by_ref().take(MAX_LINE as u64).read_until(b'\n', &mut raw).map_err(|e| e.to_string())?;
    match raw.last() {
        None => return Err("rigctld closed the connection".into()),
        Some(b'\n') => {
            raw.pop();
        }
        Some(_) if n >= MAX_LINE => return Err(format!("rigctld sent a line longer than {MAX_LINE} bytes")),
        Some(_) => return Err("rigctld closed the connection in the middle of a line".into()),
    }
    if raw.last() == Some(&b'\r') {
        raw.pop();
    }
    let line = String::from_utf8(raw).map_err(|_| "rigctld sent a line that is not UTF-8 text".to_string())?;
    // A mode name is shown and logged as received; a peer must not be able to put terminal
    // escapes or NULs there.
    if line.chars().any(char::is_control) {
        return Err(format!("rigctld sent a line with control characters: {line:?}"));
    }
    Ok(line.trim().to_string())
}

/// A rigctld connection that reconnects on demand.
pub struct Rigctld {
    addr: String,
    conn: Option<(TcpStream, BufReader<ReplyReader>)>,
}

impl Rigctld {
    /// A client for `host:port` (not connected until first use).
    pub fn new(host: &str, port: u16) -> Self {
        Rigctld { addr: format!("{host}:{port}"), conn: None }
    }

    fn connect(&mut self) -> Result<(), String> {
        if self.conn.is_some() {
            return Ok(());
        }
        let sa = self.addr.to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("unresolvable rigctld address")?;
        let s = TcpStream::connect_timeout(&sa, TIMEOUT).map_err(|e| format!("rigctld {}: {e}", self.addr))?;
        s.set_read_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
        s.set_write_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
        s.set_nodelay(true).ok();
        let r = BufReader::new(ReplyReader { stream: s.try_clone().map_err(|e| e.to_string())?, deadline: Instant::now() });
        self.conn = Some((s, r));
        Ok(())
    }

    /// Sends one command and reads `lines` reply lines, all within `TIMEOUT` of the command and
    /// each at most `MAX_LINE` bytes. Any error drops the connection.
    pub fn command(&mut self, cmd: &str, lines: usize) -> Result<Vec<String>, String> {
        self.connect()?;
        let result = (|| {
            let (w, r) = self.conn.as_mut().unwrap();
            w.write_all(format!("{cmd}\n").as_bytes()).map_err(|e| e.to_string())?;
            r.get_mut().deadline = Instant::now() + TIMEOUT;
            let mut out = Vec::new();
            for _ in 0..lines {
                let line = read_reply_line(r)?;
                if line.starts_with("RPRT") && line != "RPRT 0" {
                    return Err(format!("rigctld refused \"{cmd}\": {line}"));
                }
                out.push(line);
            }
            Ok(out)
        })();
        if result.is_err() {
            self.conn = None;
        }
        result
    }
}

impl RigControl for Rigctld {
    fn read(&mut self) -> Result<Reading, String> {
        let f = self.command("f", 1)?;
        let dial = f[0].parse::<f64>().map_err(|_| format!("unexpected frequency reply \"{}\"", f[0]))?;
        let ptt = self.command("t", 1).ok().and_then(|t| t[0].parse::<u8>().ok()).map(|v| v != 0);
        let mode = self.command("m", 2).ok().map(|m| m[0].clone());
        Ok(Reading { dial_hz: Some(dial), ptt, mode })
    }

    fn set_dial(&mut self, hz: u64) -> Result<(), String> {
        self.command(&format!("F {hz}"), 1).map(|_| ())
    }
}

/// CAT PTT through rigctld (`T 1` / `T 0`), on its own connection.
pub struct RigctldPtt(pub Rigctld);

impl RigctldPtt {
    /// Connects now, when the line is created, not at the first key: a first-use TCP connect
    /// (and name resolution) inside `key()` consumed the 50 ms PTT lead and truncated the frame
    /// (2026-09-28 audit F-17). A rigctld that is not running is reported at start-up, as a
    /// transmit hardware problem, instead of as a failed key mid-slot. A connection lost later
    /// is re-established on demand, as before.
    pub fn connect(host: &str, port: u16) -> Result<Self, String> {
        let mut r = Rigctld::new(host, port);
        r.connect()?;
        // Released at open, as the serial and CM108 lines are: a runtime restarted after an
        // unconfirmed release would otherwise start `Released` without ever commanding T 0
        // (post-remediation review M-2). A refusal here is an error, not a working PTT.
        let mut ptt = RigctldPtt(r);
        ptt.set(false).map_err(|e| format!("rigctld at {host}:{port} did not accept the release at start-up: {}", e.0))?;
        Ok(ptt)
    }
}

impl PttLine for RigctldPtt {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        let cmd = if keyed { "T 1" } else { "T 0" };
        let reply = self.0.command(cmd, 1).map_err(PttError)?;
        // Only rigctld's success report confirms a key or release. Any other line (a frequency
        // left over from a poll, noise, a different protocol on that port) used to count as
        // confirmed (transmit-safety audit D-6).
        if reply.first().map(String::as_str) == Some("RPRT 0") {
            Ok(PttAck::Confirmed)
        } else {
            self.0.conn = None;
            Err(PttError(format!("rigctld answered \"{cmd}\" with {:?}, not RPRT 0", reply.first().map(String::as_str).unwrap_or(""))))
        }
    }

    fn describe(&self) -> String {
        format!("CAT PTT via rigctld at {}", self.0.addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::time::Instant;

    /// A fake rigctld: answers f/F/t/T/m like Hamlib, and refuses one frequency.
    fn fake_rigctld() -> (u16, std::thread::JoinHandle<Vec<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut w = s;
            let mut seen = Vec::new();
            let mut freq = 14_076_000u64;
            let mut ptt = 0;
            loop {
                let mut line = String::new();
                if r.read_line(&mut line).unwrap_or(0) == 0 {
                    return seen;
                }
                let cmd = line.trim().to_string();
                seen.push(cmd.clone());
                let reply = match cmd.split_whitespace().collect::<Vec<_>>().as_slice() {
                    ["f"] => format!("{freq}\n"),
                    ["F", "1"] => "RPRT -1\n".into(),
                    ["F", hz] => {
                        freq = hz.parse().unwrap();
                        "RPRT 0\n".into()
                    }
                    ["t"] => format!("{ptt}\n"),
                    ["T", v] => {
                        ptt = v.parse().unwrap();
                        "RPRT 0\n".into()
                    }
                    ["m"] => "PKTUSB\n3000\n".into(),
                    _ => "RPRT -11\n".into(),
                };
                w.write_all(reply.as_bytes()).unwrap();
            }
        });
        (port, h)
    }

    #[test]
    fn reads_sets_and_reports_refusals_as_failures() {
        let (port, h) = fake_rigctld();
        let mut rig = Rigctld::new("127.0.0.1", port);
        assert_eq!(rig.read().unwrap(), Reading { dial_hz: Some(14_076_000.0), ptt: Some(false), mode: Some("PKTUSB".into()) });
        rig.set_dial(7_074_000).unwrap();
        assert_eq!(rig.read().unwrap().dial_hz, Some(7_074_000.0));
        assert!(rig.set_dial(1).is_err(), "a refused set_freq must not report success (Z9)");
        drop(rig);
        let _ = h.join();
    }

    #[test]
    fn ptt_keys_and_releases_and_an_unreachable_daemon_fails() {
        let (port, h) = fake_rigctld();
        let mut ptt = RigctldPtt(Rigctld::new("127.0.0.1", port));
        assert_eq!(ptt.set(true).unwrap(), PttAck::Confirmed);
        assert_eq!(ptt.set(false).unwrap(), PttAck::Confirmed);
        drop(ptt);
        assert_eq!(h.join().unwrap(), vec!["T 1", "T 0"]);
        let mut dead = RigctldPtt(Rigctld::new("127.0.0.1", 1));
        assert!(dead.set(true).is_err());
    }

    #[test]
    fn f17_the_cat_ptt_connection_is_open_and_released_before_the_first_key() {
        // F-17: connected at creation, so the first key does not pay for the connection. M-2:
        // and released there, so a restarted runtime never assumes a line it did not command.
        let (port, h) = fake_rigctld();
        let mut ptt = RigctldPtt::connect("127.0.0.1", port).unwrap();
        assert!(ptt.0.conn.is_some(), "connected at creation");
        assert_eq!(ptt.set(true).unwrap(), PttAck::Confirmed);
        drop(ptt);
        assert_eq!(h.join().unwrap(), vec!["T 0", "T 1"], "T 0 at start-up, before the first key");
        assert!(RigctldPtt::connect("127.0.0.1", 1).is_err(), "no rigctld: an error at start-up, not at the first key");
    }

    #[test]
    fn d6_only_rprt_0_confirms_a_cat_key_or_release() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut w = s;
            // T 0 at open: confirmed. T 1: answered with a stray frequency line, not RPRT 0.
            for reply in ["RPRT 0\n", "14076000\n"] {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                w.write_all(reply.as_bytes()).unwrap();
            }
        });
        let mut ptt = RigctldPtt::connect("127.0.0.1", port).unwrap();
        let e = ptt.set(true).unwrap_err();
        assert!(e.0.contains("not RPRT 0"), "{}", e.0);
        h.join().unwrap();
    }

    #[test]
    fn m2_a_rigctld_that_refuses_the_start_up_release_is_not_a_working_ptt() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut w = s;
            let mut line = String::new();
            r.read_line(&mut line).unwrap();
            w.write_all(b"RPRT -9\n").unwrap();
            line
        });
        let e = RigctldPtt::connect("127.0.0.1", port).err().expect("a refused release at start-up is an error");
        assert!(e.contains("did not accept the release"), "{e}");
        assert_eq!(h.join().unwrap().trim(), "T 0");
    }

    /// A one-connection peer that runs `script` on the accepted socket (reader, writer).
    fn peer<T: Send + 'static>(
        script: impl FnOnce(BufReader<TcpStream>, TcpStream) -> T + Send + 'static,
    ) -> (u16, std::thread::JoinHandle<T>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (s, _) = l.accept().unwrap();
            script(BufReader::new(s.try_clone().unwrap()), s)
        });
        (port, h)
    }

    fn next_command(r: &mut BufReader<TcpStream>) -> String {
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        line.trim().to_string()
    }

    /// Writes `bytes` one at a time, `gap` apart; stops at the first write the client refuses.
    fn trickle(w: &mut TcpStream, bytes: &[u8], gap: Duration) {
        for b in bytes {
            if w.write_all(std::slice::from_ref(b)).is_err() {
                return;
            }
            std::thread::sleep(gap);
        }
    }

    #[test]
    fn a_reply_split_across_writes_is_read_whole() {
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "f");
            w.write_all(b"1407").unwrap();
            std::thread::sleep(Duration::from_millis(50));
            w.write_all(b"6000\r\n").unwrap();
            assert_eq!(next_command(&mut r), "m");
            w.write_all(b"PKTUSB\n30").unwrap();
            std::thread::sleep(Duration::from_millis(50));
            w.write_all(b"00\n").unwrap();
        });
        let mut rig = Rigctld::new("127.0.0.1", port);
        assert_eq!(rig.command("f", 1).unwrap(), vec!["14076000"]);
        assert_eq!(rig.command("m", 2).unwrap(), vec!["PKTUSB", "3000"]);
        h.join().unwrap();
    }

    #[test]
    fn an_empty_line_is_neither_a_frequency_nor_a_confirmation() {
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "f");
            w.write_all(b"\n").unwrap();
            assert_eq!(next_command(&mut r), "f");
            w.write_all(b"\n").unwrap();
        });
        let mut rig = Rigctld::new("127.0.0.1", port);
        assert_eq!(rig.command("f", 1).unwrap(), vec![""], "an empty line is a complete line");
        let e = rig.read().unwrap_err();
        assert!(e.contains("unexpected frequency reply"), "{e}");
        h.join().unwrap();
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "T 1");
            w.write_all(b"\n").unwrap();
        });
        let e = RigctldPtt(Rigctld::new("127.0.0.1", port)).set(true).unwrap_err();
        assert!(e.0.contains("not RPRT 0"), "{}", e.0);
        h.join().unwrap();
    }

    #[test]
    fn a_line_of_the_maximum_length_is_read_and_one_byte_longer_is_refused() {
        let longest = format!("1{}", "0".repeat(MAX_LINE - 2));
        let reply = format!("{longest}\n");
        assert_eq!(reply.len(), MAX_LINE, "the limit counts the newline");
        let (port, h) = peer(move |mut r, mut w| {
            assert_eq!(next_command(&mut r), "f");
            w.write_all(reply.as_bytes()).unwrap();
            assert_eq!(next_command(&mut r), "f");
            w.write_all(format!("1{}\n", "0".repeat(MAX_LINE - 1)).as_bytes()).unwrap();
        });
        let mut rig = Rigctld::new("127.0.0.1", port);
        assert_eq!(rig.command("f", 1).unwrap(), vec![longest]);
        let e = rig.command("f", 1).unwrap_err();
        assert!(e.contains(&format!("longer than {MAX_LINE} bytes")), "{e}");
        assert!(rig.conn.is_none(), "the connection is dropped, not left mid-line");
        h.join().unwrap();
    }

    #[test]
    fn an_endless_line_is_refused_after_max_line_bytes_without_buffering_the_rest() {
        // Up to 64 MiB without a newline. The client must give up at MAX_LINE and close, so the
        // peer's writes fail long before it has sent it all.
        const TOTAL: usize = 64 << 20;
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "f");
            w.set_write_timeout(Some(Duration::from_secs(10))).unwrap();
            let chunk = vec![b'1'; 64 << 10];
            let mut sent = 0;
            while sent < TOTAL {
                match w.write(&chunk) {
                    Ok(n) => sent += n,
                    Err(_) => break,
                }
            }
            sent
        });
        let mut rig = Rigctld::new("127.0.0.1", port);
        let e = rig.command("f", 1).unwrap_err();
        assert!(e.contains(&format!("longer than {MAX_LINE} bytes")), "{e}");
        drop(rig);
        let sent = h.join().unwrap();
        assert!(sent < TOTAL, "the client read the whole {sent}-byte line instead of stopping at {MAX_LINE}");
    }

    #[test]
    fn a_line_cut_off_by_the_peer_is_not_a_reply() {
        // A dial reading cut short used to be a dial reading: 14076000 read as 1407 Hz.
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "f");
            w.write_all(b"1407").unwrap();
        });
        let mut rig = Rigctld::new("127.0.0.1", port);
        let e = rig.read().unwrap_err();
        assert!(e.contains("in the middle of a line"), "{e}");
        h.join().unwrap();
        // And a cut-off success report used to confirm a release.
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "T 0");
            w.write_all(b"RPRT 0").unwrap();
        });
        let e = RigctldPtt(Rigctld::new("127.0.0.1", port)).set(false).unwrap_err();
        assert!(e.0.contains("in the middle of a line"), "{}", e.0);
        h.join().unwrap();
        // A peer that closes before sending anything.
        let (port, h) = peer(|mut r, _w| next_command(&mut r));
        let e = Rigctld::new("127.0.0.1", port).command("f", 1).unwrap_err();
        assert!(e.contains("closed the connection"), "{e}");
        assert_eq!(h.join().unwrap(), "f");
    }

    #[test]
    fn malformed_lines_are_refused() {
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "f");
            w.write_all(b"\xff\xfe14076000\n").unwrap();
        });
        let e = Rigctld::new("127.0.0.1", port).command("f", 1).unwrap_err();
        assert!(e.contains("UTF-8"), "{e}");
        h.join().unwrap();
        // A mode with a terminal escape in it is not a mode: read() reports none rather than
        // passing it on to the screen and the log.
        let (port, h) = peer(|mut r, mut w| {
            for reply in [&b"14076000\n"[..], b"0\n", b"PKT\x1b[2JUSB\n3000\n"] {
                next_command(&mut r);
                if w.write_all(reply).is_err() {
                    return;
                }
            }
        });
        let mut rig = Rigctld::new("127.0.0.1", port);
        assert_eq!(rig.read().unwrap(), Reading { dial_hz: Some(14_076_000.0), ptt: Some(false), mode: None });
        h.join().unwrap();
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "T 0");
            w.write_all(b"RPRT 0\0\n").unwrap();
        });
        let e = RigctldPtt(Rigctld::new("127.0.0.1", port)).set(false).unwrap_err();
        assert!(e.0.contains("control characters"), "{}", e.0);
        h.join().unwrap();
    }

    #[test]
    fn a_silent_peer_times_out() {
        let (port, h) = peer(|mut r, _w| {
            assert_eq!(next_command(&mut r), "T 0");
            // Hold the connection open, answering nothing, until the client gives up.
            let mut rest = Vec::new();
            let _ = r.read_to_end(&mut rest);
        });
        let t = Instant::now();
        assert!(RigctldPtt(Rigctld::new("127.0.0.1", port)).set(false).is_err());
        let took = t.elapsed();
        assert!(took >= TIMEOUT - Duration::from_millis(100) && took < TIMEOUT + Duration::from_secs(1), "{took:?}");
        h.join().unwrap();
    }

    #[test]
    fn a_peer_that_trickles_bytes_cannot_stretch_a_reply_past_the_timeout() {
        // A byte every 300 ms restarts a per-read timeout every time: a reader with only that
        // waits out the whole 5 s reply and then counts it as a confirmed release.
        let (port, h) = peer(|mut r, mut w| {
            assert_eq!(next_command(&mut r), "T 0");
            trickle(&mut w, b"          RPRT 0\n", Duration::from_millis(300));
        });
        let t = Instant::now();
        let r = RigctldPtt(Rigctld::new("127.0.0.1", port)).set(false);
        let took = t.elapsed();
        assert!(r.is_err(), "a reply that took {took:?} was accepted: {r:?}");
        assert!(took < TIMEOUT + Duration::from_secs(1), "{took:?}");
        h.join().unwrap();
    }
}
