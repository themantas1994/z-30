//! Adapters between the z-30 engine and the machine: audio devices, WAV files, rigctld, serial
//! and CM108 PTT, the logbook, paths, configuration, legacy migration and the system clock.
//! Everything platform-specific lives here, behind the traits in `z30_engine::runtime` and
//! `z30_engine::ptt`.

pub mod audio;
#[cfg(feature = "cm108")]
pub mod cm108;
pub mod logbook;
pub mod migrate;
pub mod paths;
pub mod rigctld;
pub mod serial_ptt;
pub mod wallclock;
pub mod wav;

use z30_engine::config::{Config, PttConfig};
use z30_engine::ptt::{NoPtt, PttLine, VoxPtt};

/// Builds the keying line the configuration names. Anything that cannot be opened is an error;
/// the caller falls back to `NoPtt`, which refuses to key.
pub fn open_ptt(cfg: &Config) -> Result<Box<dyn PttLine>, String> {
    match &cfg.ptt {
        PttConfig::None => Ok(Box::new(NoPtt)),
        PttConfig::Vox => Ok(Box::new(VoxPtt)),
        PttConfig::Cat => {
            if cfg.rig.rigctld_host.is_empty() {
                return Err("CAT PTT needs rigctld configured".into());
            }
            Ok(Box::new(rigctld::RigctldPtt(rigctld::Rigctld::new(&cfg.rig.rigctld_host, cfg.rig.rigctld_port))))
        }
        PttConfig::Serial { port, line, active_high } => Ok(Box::new(serial_ptt::SerialPtt::open(port, *line, *active_high)?)),
        #[cfg(feature = "cm108")]
        PttConfig::Cm108 { device, pin, active_high } => Ok(Box::new(cm108::Cm108Ptt::open(device, *pin, *active_high)?)),
        #[cfg(not(feature = "cm108"))]
        PttConfig::Cm108 { .. } => Err("this build has no CM108 support (build with --features cm108)".into()),
    }
}
