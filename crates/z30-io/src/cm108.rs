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
    /// Opens the device at `path` and releases the pin. An empty path is accepted only when
    /// exactly one C-Media device is present: with two (a USB headset and the radio interface is
    /// common) "the first one found" keyed a GPIO on the wrong device and reported it confirmed
    /// (2026-09-28 audit F-43).
    pub fn open(path: &str, pin: u8, active_high: bool) -> Result<Self, String> {
        if !(1..=8).contains(&pin) {
            return Err(format!("CM108 GPIO {pin} does not exist (1-8)"));
        }
        let api = hidapi::HidApi::new().map_err(|e| e.to_string())?;
        let paths: Vec<String> =
            api.device_list().filter(|d| d.vendor_id() == CMEDIA_VID).map(|d| d.path().to_string_lossy().into_owned()).collect();
        let chosen = choose_cm108(&paths, path)?;
        let info = api
            .device_list()
            .find(|d| d.path().to_string_lossy() == chosen)
            .ok_or_else(|| format!("CM108 device {chosen} disappeared while opening"))?;
        let dev = info.open_device(&api).map_err(|e| e.to_string())?;
        let mut s = Cm108Ptt { dev, path: info.path().to_string_lossy().into_owned(), pin, active_high };
        s.set(false).map_err(|e| e.0)?;
        Ok(s)
    }
}

/// Which C-Media HID path to use: the configured one if it is present, else the only one.
pub fn choose_cm108(present: &[String], configured: &str) -> Result<String, String> {
    if !configured.is_empty() {
        return present.iter().find(|p| *p == configured).cloned().ok_or_else(|| {
            format!(
                "CM108 device {configured} not found (present: {})",
                if present.is_empty() { "none".into() } else { present.join(", ") }
            )
        });
    }
    match present {
        [one] => Ok(one.clone()),
        [] => Err("no CM108/CM119 HID device found".into()),
        many => Err(format!(
            "{} C-Media devices are present ({}); set the device path of the radio interface in Settings",
            many.len(),
            many.join(", ")
        )),
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

#[cfg(test)]
mod tests {
    #[test]
    fn f43_no_cm108_device_is_guessed_when_there_is_more_than_one() {
        let two = vec!["/dev/hidraw1".to_string(), "/dev/hidraw4".to_string()];
        assert!(super::choose_cm108(&two, "").unwrap_err().contains("2 C-Media devices"));
        assert_eq!(super::choose_cm108(&two, "/dev/hidraw4").unwrap(), "/dev/hidraw4");
        assert!(super::choose_cm108(&two, "/dev/hidraw9").is_err());
        assert_eq!(super::choose_cm108(&two[..1], "").unwrap(), "/dev/hidraw1");
        assert!(super::choose_cm108(&[], "").is_err());
    }
}
