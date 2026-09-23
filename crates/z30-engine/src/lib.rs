//! z-30 application core.
//!
//! Commands -> Engine -> Events / immutable EngineSnapshot -> GUI/CLI. Real time runs on the
//! audio sample clock (`clock.rs`, `slots.rs`); the transmit gate (`txgate.rs`), rig readback
//! (`rig.rs`) and PTT safety (`ptt.rs`) are ported from the TypeScript transmit path with every
//! one of its tested scenarios. No OS I/O here: audio, rig, PTT and storage are traits that
//! `z30-io` implements and tests fake.
#![forbid(unsafe_code)]

pub mod api;
pub mod bandplan;
pub mod clock;
pub mod config;
pub mod engine;
pub mod pipeline;
pub mod ptt;
pub mod qso;
pub mod rig;
pub mod runtime;
pub mod slots;
pub mod txgate;
