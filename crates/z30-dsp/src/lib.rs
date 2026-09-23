//! z-30 receiver. Pure: takes buffers and configuration, returns data. No audio devices, files,
//! clocks, threads of its own (beyond an optional rayon pool) or logging.
//!
//! The chain, per slot (`slot::decode_slot`):
//!
//! ```text
//! slot buffer (6 kHz, [slot-1.5 s, slot+25.5 s])
//!   -> one real FFT of the whole slot                         (baseband.rs)
//!   -> symbol-rate spectrogram, Costas sync map, candidates   (sync.rs)
//!   -> per candidate: complex baseband at 200 Hz, fine dt/f/drift search (baseband.rs, sync.rs)
//!   -> 16 x 75 symbol spectra, noise estimate, Log-MAP LLRs   (demod.rs)
//!   -> LDPC cascade + corrected OSD, CRC, optional AP         (ldpc.rs, ap.rs)
//!   -> least-squares SIC of every decode, repeat              (sic.rs)
//! ```
#![forbid(unsafe_code)]

pub mod ap;
pub mod baseband;
pub mod demod;
pub mod ldpc;
pub mod math;
pub mod resample;
pub mod sic;
pub mod slot;
pub mod sync;

/// The receiver's internal sample rate. Everything the DSP sees has been resampled to this.
pub const DSP_RATE_HZ: f64 = 6000.0;
/// Samples per symbol at the DSP rate.
pub const DSP_NSPS: usize = 1920;
