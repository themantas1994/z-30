//! CM108/CM119 GPIO PTT over HID (DRA, URI, AllScan and similar interfaces).
//!
//! The HID output report is Direwolf's layout: `[report 0, 0, data, direction mask, 0]`, with
//! GPIO n at bit n-1. **A CM108 GPIO keeps its state when the process dies.** Nothing in
//! software can release it after SIGKILL or a power cut to the computer while the interface
//! stays powered; a CM108 station should enable the radio's own transmit time-out.

use z30_engine::ptt::{PttAck, PttError, PttLine};

/// A CM108 GPIO line.
pub struct Cm108Ptt {
    dev: hidapi::HidDevice,
    path: String,
    pin: u8,
    active_high: bool,
}

const CMEDIA_VID: u16 = 0x0d8c;

impl Cm108Ptt {
    /// Opens the device at `path` (empty = the first C-Media device) and releases the pin.
    pub fn open(path: &str, pin: u8, active_high: bool) -> Result<Self, String> {
        if !(1..=8).contains(&pin) {
            return Err(format!("CM108 GPIO {pin} does not exist (1-8)"));
        }
        let api = hidapi::HidApi::new().map_err(|e| e.to_string())?;
        let info = api
            .device_list()
            .find(|d| if path.is_empty() { d.vendor_id() == CMEDIA_VID } else { d.path().to_string_lossy() == path })
            .ok_or_else(|| "no CM108/CM119 HID device found".to_string())?;
        let dev = info.open_device(&api).map_err(|e| e.to_string())?;
        let mut s = Cm108Ptt { dev, path: info.path().to_string_lossy().into_owned(), pin, active_high };
        s.set(false).map_err(|e| e.0)?;
        Ok(s)
    }
}

impl PttLine for Cm108Ptt {
    fn set(&mut self, keyed: bool) -> Result<PttAck, PttError> {
        let bit = 1u8 << (self.pin - 1);
        let high = keyed == self.active_high;
        let report = [0u8, 0, if high { bit } else { 0 }, bit, 0];
        match self.dev.write(&report) {
            Ok(5) => Ok(PttAck::Confirmed),
            Ok(n) => Err(PttError(format!("CM108 accepted {n} of 5 bytes"))),
            Err(e) => Err(PttError(format!("CM108 {}: {e}", self.path))),
        }
    }

    fn describe(&self) -> String {
        format!("CM108 GPIO{} on {} ({})", self.pin, self.path, if self.active_high { "active high" } else { "active low" })
    }
}
