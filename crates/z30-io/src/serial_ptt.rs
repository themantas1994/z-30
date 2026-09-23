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
    /// Opens `port` and drives the line to its released state.
    pub fn open(port: &str, line: SerialLine, active_high: bool) -> Result<Self, String> {
        let p = serialport::new(port, 9600)
            .timeout(std::time::Duration::from_millis(500))
            .open()
            .map_err(|e| format!("cannot open {port}: {e}"))?;
        let mut s = SerialPtt { port: p, name: port.into(), line, active_high };
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
