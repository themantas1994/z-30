//! Hamlib `rigctld` over TCP: dial readback and control (`RigControl`), and CAT PTT (`PttLine`).
//!
//! Two separate connections, deliberately: the poller's reads must never queue a PTT release
//! behind them (AGENTS.md: "an unkey queued behind a slow read is a transmitter still
//! radiating"). Every socket operation has a timeout, so neither can hang the engine or the
//! watchdog. A command whose reply is not `RPRT 0` is a failure, never a success.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use z30_engine::ptt::{PttAck, PttError, PttLine};
use z30_engine::rig::Reading;
use z30_engine::runtime::RigControl;

const TIMEOUT: Duration = Duration::from_millis(1500);

/// A rigctld connection that reconnects on demand.
pub struct Rigctld {
    addr: String,
    conn: Option<(TcpStream, BufReader<TcpStream>)>,
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
        let r = BufReader::new(s.try_clone().map_err(|e| e.to_string())?);
        self.conn = Some((s, r));
        Ok(())
    }

    /// Sends one command and reads `lines` reply lines. Any error drops the connection.
    pub fn command(&mut self, cmd: &str, lines: usize) -> Result<Vec<String>, String> {
        self.connect()?;
        let result = (|| {
            let (w, r) = self.conn.as_mut().unwrap();
            w.write_all(format!("{cmd}\n").as_bytes()).map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for _ in 0..lines {
                let mut line = String::new();
                if r.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                    return Err("rigctld closed the connection".to_string());
                }
                let line = line.trim().to_string();
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

impl PttLine for RigctldPtt {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        self.0.command(if keyed { "T 1" } else { "T 0" }, 1).map(|_| PttAck::Confirmed).map_err(PttError)
    }

    fn describe(&self) -> String {
        format!("CAT PTT via rigctld at {}", self.0.addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

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
}
