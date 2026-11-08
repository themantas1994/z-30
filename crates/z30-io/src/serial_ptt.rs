//! RTS/DTR PTT on a serial port (Digirig, FTDI cables, many interfaces).
//!
//! The port is opened once and held: RTS and DTR are dropped by the OS when the port closes, so
//! the process going away - even by SIGKILL - releases the line. That is the hardware layer
//! beneath the three software ones in `z30_engine::ptt`.

use z30_engine::config::SerialLine;
use z30_engine::ptt::{PttAck, PttError, PttLine};

/// A serial control line.
pub struct SerialPtt {
    port: Box<dyn serialport::SerialPort>,
    name: String,
    line: SerialLine,
    active_high: bool,
}

impl SerialPtt {
    /// Opens `port` and drives the line to its released state. An empty port name (what the
    /// settings hold when no port was listed) is refused before anything is opened.
    pub fn open(port: &str, line: SerialLine, active_high: bool) -> Result<Self, String> {
        if port.trim().is_empty() {
            return Err("serial PTT has no port configured".into());
        }
        let p = serialport::new(port, 9600)
            .timeout(std::time::Duration::from_millis(500))
            .open()
            .map_err(|e| format!("cannot open {port}: {e}"))?;
        Self::from_port(p, port, line, active_high)
    }

    /// Takes an opened port and drives the line released. A port that refuses that is not a
    /// working PTT: it is closed again (dropped) and the error returned.
    fn from_port(port: Box<dyn serialport::SerialPort>, name: &str, line: SerialLine, active_high: bool) -> Result<Self, String> {
        let mut s = SerialPtt { port, name: name.into(), line, active_high };
        s.set(false).map_err(|e| e.0)?;
        Ok(s)
    }

    /// Available serial ports.
    pub fn list() -> Vec<String> {
        serialport::available_ports().map(|v| v.into_iter().map(|p| p.port_name).collect()).unwrap_or_default()
    }
}

impl PttLine for SerialPtt {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        let level = keyed == self.active_high;
        let r = match self.line {
            SerialLine::Rts => self.port.write_request_to_send(level),
            SerialLine::Dtr => self.port.write_data_terminal_ready(level),
        };
        r.map(|_| PttAck::Confirmed).map_err(|e| PttError(format!("{} on {}: {e}", self.describe(), self.name)))
    }

    fn describe(&self) -> String {
        format!("{:?} on {} ({})", self.line, self.name, if self.active_high { "active high" } else { "active low" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serialport::{ClearBuffer, DataBits, ErrorKind, FlowControl, Parity, StopBits};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use z30_engine::ptt::{PttController, PttState, SystemMonotonic};

    /// What the fake port saw, in order.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Ev {
        Rts(bool),
        Dtr(bool),
        /// The port handle was dropped: the OS would close it and drop RTS/DTR.
        Closed,
    }

    #[derive(Default)]
    struct Wire {
        events: Vec<Ev>,
        /// Every control-line write fails with this (`NoDevice`: the adapter was unplugged).
        fail_all: Option<ErrorKind>,
        /// Only writes of this level fail.
        fail_level: Option<bool>,
    }

    /// A serial port with no hardware behind it: records control-line writes and fails on demand.
    struct FakePort(Arc<Mutex<Wire>>);

    fn fake() -> (Box<dyn serialport::SerialPort>, Arc<Mutex<Wire>>) {
        let w = Arc::new(Mutex::new(Wire::default()));
        (Box::new(FakePort(w.clone())), w)
    }

    fn events(w: &Arc<Mutex<Wire>>) -> Vec<Ev> {
        w.lock().unwrap().events.clone()
    }

    impl FakePort {
        fn drive(&mut self, ev: Ev, level: bool) -> serialport::Result<()> {
            let mut w = self.0.lock().unwrap();
            if let Some(kind) = w.fail_all {
                return Err(serialport::Error::new(kind, "device disconnected"));
            }
            if w.fail_level == Some(level) {
                return Err(serialport::Error::new(ErrorKind::Io(std::io::ErrorKind::Other), "the driver refused the line change"));
            }
            w.events.push(ev);
            Ok(())
        }
    }

    impl Drop for FakePort {
        fn drop(&mut self) {
            self.0.lock().unwrap().events.push(Ev::Closed);
        }
    }

    impl std::io::Read for FakePort {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }

    impl std::io::Write for FakePort {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn unsupported<T>() -> serialport::Result<T> {
        Err(serialport::Error::new(ErrorKind::Unknown, "not used by SerialPtt"))
    }

    impl serialport::SerialPort for FakePort {
        fn name(&self) -> Option<String> {
            Some("fake".into())
        }
        fn baud_rate(&self) -> serialport::Result<u32> {
            Ok(9600)
        }
        fn data_bits(&self) -> serialport::Result<DataBits> {
            Ok(DataBits::Eight)
        }
        fn flow_control(&self) -> serialport::Result<FlowControl> {
            Ok(FlowControl::None)
        }
        fn parity(&self) -> serialport::Result<Parity> {
            Ok(Parity::None)
        }
        fn stop_bits(&self) -> serialport::Result<StopBits> {
            Ok(StopBits::One)
        }
        fn timeout(&self) -> Duration {
            Duration::from_millis(500)
        }
        fn set_baud_rate(&mut self, _: u32) -> serialport::Result<()> {
            unsupported()
        }
        fn set_data_bits(&mut self, _: DataBits) -> serialport::Result<()> {
            unsupported()
        }
        fn set_flow_control(&mut self, _: FlowControl) -> serialport::Result<()> {
            unsupported()
        }
        fn set_parity(&mut self, _: Parity) -> serialport::Result<()> {
            unsupported()
        }
        fn set_stop_bits(&mut self, _: StopBits) -> serialport::Result<()> {
            unsupported()
        }
        fn set_timeout(&mut self, _: Duration) -> serialport::Result<()> {
            unsupported()
        }
        fn write_request_to_send(&mut self, level: bool) -> serialport::Result<()> {
            self.drive(Ev::Rts(level), level)
        }
        fn write_data_terminal_ready(&mut self, level: bool) -> serialport::Result<()> {
            self.drive(Ev::Dtr(level), level)
        }
        fn read_clear_to_send(&mut self) -> serialport::Result<bool> {
            unsupported()
        }
        fn read_data_set_ready(&mut self) -> serialport::Result<bool> {
            unsupported()
        }
        fn read_ring_indicator(&mut self) -> serialport::Result<bool> {
            unsupported()
        }
        fn read_carrier_detect(&mut self) -> serialport::Result<bool> {
            unsupported()
        }
        fn bytes_to_read(&self) -> serialport::Result<u32> {
            Ok(0)
        }
        fn bytes_to_write(&self) -> serialport::Result<u32> {
            Ok(0)
        }
        fn clear(&self, _: ClearBuffer) -> serialport::Result<()> {
            Ok(())
        }
        fn try_clone(&self) -> serialport::Result<Box<dyn serialport::SerialPort>> {
            unsupported()
        }
        fn set_break(&self) -> serialport::Result<()> {
            unsupported()
        }
        fn clear_break(&self) -> serialport::Result<()> {
            unsupported()
        }
    }

    #[test]
    fn the_configured_line_is_released_at_open_then_keyed_and_released_at_the_configured_level() {
        for (line, active_high, keyed, released) in [
            (SerialLine::Rts, true, Ev::Rts(true), Ev::Rts(false)),
            (SerialLine::Rts, false, Ev::Rts(false), Ev::Rts(true)),
            (SerialLine::Dtr, true, Ev::Dtr(true), Ev::Dtr(false)),
            (SerialLine::Dtr, false, Ev::Dtr(false), Ev::Dtr(true)),
        ] {
            let (port, wire) = fake();
            let mut ptt = SerialPtt::from_port(port, "/dev/ttyFAKE0", line, active_high).unwrap();
            assert_eq!(events(&wire), vec![released], "{line:?} active_high={active_high}: released at open, before any key");
            assert_eq!(ptt.set(true).unwrap(), PttAck::Confirmed);
            assert_eq!(ptt.set(false).unwrap(), PttAck::Confirmed);
            // Only the configured line is ever driven.
            assert_eq!(events(&wire), vec![released, keyed, released], "{line:?} active_high={active_high}");
            assert!(ptt.describe().contains("/dev/ttyFAKE0"));
        }
    }

    #[test]
    fn a_port_that_refuses_the_release_at_open_is_not_a_working_ptt() {
        let (port, wire) = fake();
        wire.lock().unwrap().fail_level = Some(false);
        let e = SerialPtt::from_port(port, "/dev/ttyFAKE0", SerialLine::Rts, true).err().expect("an unreleased line is an error");
        assert!(e.contains("/dev/ttyFAKE0") && e.contains("refused"), "{e}");
        assert_eq!(events(&wire), vec![Ev::Closed], "the port is closed again, never keyed");
    }

    #[test]
    fn a_failed_line_write_is_an_error_not_a_confirmation() {
        let (port, wire) = fake();
        let mut ptt = SerialPtt::from_port(port, "COM7", SerialLine::Dtr, true).unwrap();
        wire.lock().unwrap().fail_level = Some(true);
        let e = ptt.set(true).unwrap_err();
        assert!(e.0.contains("COM7") && e.0.contains("refused the line change"), "{}", e.0);
        assert_eq!(events(&wire), vec![Ev::Dtr(false)], "the failed key was not recorded as driven");
    }

    #[test]
    fn a_disconnected_port_fails_every_command() {
        let (port, wire) = fake();
        let mut ptt = SerialPtt::from_port(port, "/dev/ttyUSB9", SerialLine::Rts, true).unwrap();
        wire.lock().unwrap().fail_all = Some(ErrorKind::NoDevice);
        assert!(ptt.set(true).unwrap_err().0.contains("device disconnected"));
        assert!(ptt.set(false).unwrap_err().0.contains("device disconnected"), "a release on a vanished port is not confirmed");
    }

    #[test]
    fn an_invalid_port_configuration_is_refused_without_driving_any_port() {
        let e = SerialPtt::open("", SerialLine::Rts, true).err().expect("an empty port name is refused");
        assert!(e.contains("no port configured"), "{e}");
        let e = SerialPtt::open("   ", SerialLine::Dtr, false).err().expect("a blank port name is refused");
        assert!(e.contains("no port configured"), "{e}");
        // A device that does not exist: the OS refuses the open, so nothing is driven.
        let missing = std::env::temp_dir().join(format!("z30-no-such-port-{}", std::process::id())).join("ttyNONE");
        let missing = missing.to_string_lossy().into_owned();
        let e = SerialPtt::open(&missing, SerialLine::Rts, true).err().expect("a missing device is refused");
        assert!(e.starts_with(&format!("cannot open {missing}")), "{e}");
        // Through the factory the station uses: an error, so the caller keeps NoPtt.
        let cfg = z30_engine::config::Config {
            ptt: z30_engine::config::PttConfig::Serial { port: String::new(), line: SerialLine::Rts, active_high: true },
            ..Default::default()
        };
        assert!(crate::open_ptt(&cfg).err().expect("no line from an empty port").contains("no port configured"));
    }

    #[test]
    fn dropping_the_line_closes_the_port() {
        let (port, wire) = fake();
        let ptt = SerialPtt::from_port(port, "/dev/ttyFAKE0", SerialLine::Rts, true).unwrap();
        drop(ptt);
        assert_eq!(events(&wire), vec![Ev::Rts(false), Ev::Closed]);
    }

    #[test]
    fn a_controller_dropped_while_keyed_releases_the_line_before_closing_the_port() {
        let (port, wire) = fake();
        let line = SerialPtt::from_port(port, "/dev/ttyFAKE0", SerialLine::Rts, true).unwrap();
        let c = PttController::new(Box::new(line), Arc::new(SystemMonotonic::default()));
        c.key().unwrap();
        drop(c);
        assert_eq!(events(&wire), vec![Ev::Rts(false), Ev::Rts(true), Ev::Rts(false), Ev::Closed]);
    }

    #[test]
    fn a_release_lost_mid_transmission_stays_pending_refuses_keys_and_is_retried() {
        let (port, wire) = fake();
        let line = SerialPtt::from_port(port, "/dev/ttyUSB0", SerialLine::Rts, true).unwrap();
        let c = PttController::new(Box::new(line), Arc::new(SystemMonotonic::default()));
        assert_eq!(c.key().unwrap(), PttAck::Confirmed);
        // The adapter is unplugged while keyed: the release is not confirmed.
        wire.lock().unwrap().fail_all = Some(ErrorKind::NoDevice);
        assert!(c.unkey().is_err());
        assert_eq!(c.state(), PttState::ReleasePending);
        assert_eq!(c.release_failures(), 1);
        assert!(c.last_release_error().unwrap().contains("/dev/ttyUSB0"));
        // No key while the release is unconfirmed, and the refused key never reaches the port.
        assert!(c.key().is_err());
        assert_eq!(events(&wire), vec![Ev::Rts(false), Ev::Rts(true)]);
        // The port answers again: the watchdog's retry confirms the release.
        wire.lock().unwrap().fail_all = None;
        c.watchdog_tick();
        assert_eq!(c.state(), PttState::Released);
        assert_eq!(events(&wire), vec![Ev::Rts(false), Ev::Rts(true), Ev::Rts(false)]);
    }

    #[test]
    fn a_key_that_fails_still_sends_the_release() {
        let (port, wire) = fake();
        let line = SerialPtt::from_port(port, "/dev/ttyUSB0", SerialLine::Dtr, false).unwrap();
        let c = PttController::new(Box::new(line), Arc::new(SystemMonotonic::default()));
        // Active low: keying drops DTR. That write fails; the line may have half-changed.
        wire.lock().unwrap().fail_level = Some(false);
        assert!(c.key().is_err());
        assert_eq!(c.state(), PttState::Released, "the release after the failed key was confirmed");
        assert_eq!(events(&wire), vec![Ev::Dtr(true), Ev::Dtr(true)], "released at open, then released again after the failed key");
    }
}
