//! `z30`: the headless z-30 station and toolbox.
//!
//! Receive-only by design: this binary never keys a transmitter. Transmitting is done from the
//! GUI, where the operator sees the gate's verdict before every transmission.

mod bench;
mod loopback;
mod suite;

use clap::Parser;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use z30_dsp::resample::Resampler;
use z30_dsp::slot::Receiver;
use z30_engine::api::Event;
use z30_engine::ptt::{NoPtt, SystemMonotonic};
use z30_engine::runtime::{self, AudioOutput, RuntimeParts, WallClock};
use z30_io::logbook::Logbook;
use z30_io::paths;

/// A counting allocator, so `--benchmark` can report allocations per decode.
struct Counting;
static ALLOCS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: std::alloc::Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        unsafe { std::alloc::System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(p, l) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

pub(crate) fn allocations() -> u64 {
    ALLOCS.load(std::sync::atomic::Ordering::Relaxed)
}

#[derive(Parser, Debug)]
#[command(
    name = "z30",
    disable_version_flag = true,
    about = "z-30 vNext: headless receiver, decoder, benchmark and diagnostics (never transmits)"
)]
struct Cli {
    /// Print the version, the commit and build this binary came from, and exit.
    #[arg(short = 'V', long)]
    version: bool,
    /// Configuration file (default: the z-30 data directory's config.toml).
    #[arg(long, value_name = "PATH")]
    config: Option<PathBuf>,
    /// List audio devices and serial ports.
    #[arg(long)]
    devices: bool,
    /// Run a live receive-only station on the configured audio input.
    #[arg(long)]
    receive: bool,
    /// Decode a recording. A 27 s window at 6 kHz (as --capture-slots writes) is decoded as one
    /// slot; anything else is assumed to start at a slot boundary unless --start-utc says when.
    #[arg(long, value_name = "WAV")]
    decode: Option<PathBuf>,
    /// UTC (Unix seconds) of the recording's first sample, for --decode.
    #[arg(long)]
    start_utc: Option<f64>,
    /// Write each received slot window (WAV) and its report (JSON) to this directory.
    #[arg(long, value_name = "DIR")]
    capture_slots: Option<PathBuf>,
    /// Benchmarks, all through decode_slot: perf (latency/CPU/allocations at K = 1, 5, 20, 50),
    /// false-decodes, sweep, and the measurement suite - `suite` runs all of awgn, drift,
    /// timing, clock, impair, snr, busy, false, sic, fading and writes JSON with provenance.
    #[arg(long, value_name = "WHAT", num_args = 0..=1, default_missing_value = "perf")]
    benchmark: Option<String>,
    /// Frames/slots per point for --benchmark (default: 20 for perf/false-decodes/sweep; each
    /// suite benchmark's own publishable size otherwise).
    #[arg(long)]
    frames: Option<usize>,
    /// Output directory for suite results (default: research/results/<commit>), or the JSON
    /// file for --loopback-test.
    #[arg(long, value_name = "DIR")]
    out: Option<PathBuf>,
    /// Report configuration, clock, audio, rig and transmit-gate status.
    #[arg(long)]
    diagnostics: bool,
    /// Import the legacy z-30 configuration and logbook (never modifies them).
    #[arg(long)]
    migrate: bool,
    /// With --migrate: replace an existing config.toml.
    #[arg(long)]
    force: bool,
    /// Encode a message to a WAV file (does not transmit): --encode "CQ K1ABC FN31" --wav out.wav
    #[arg(long, value_name = "MESSAGE")]
    encode: Option<String>,
    /// Output WAV for --encode.
    #[arg(long, value_name = "WAV")]
    wav: Option<PathBuf>,
    /// Tone-0 audio frequency for --encode, Hz.
    #[arg(long, default_value_t = 1500.0)]
    f0: f64,
    /// Sample rate for --encode.
    #[arg(long, default_value_t = 48_000)]
    rate: u32,
    /// Export the logbook as ADIF.
    #[arg(long, value_name = "FILE")]
    export_adif: Option<PathBuf>,
    /// Hardware validation A1 (docs/hardware-validation.md): play a known frame through the
    /// configured output, record it through the configured input and the production receive
    /// path, and report decode, DT, frequency, SNR, clock error and occupied bandwidth as JSON.
    /// Keys nothing; requires --confirm-no-transmitter.
    #[arg(long)]
    loopback_test: bool,
    /// Confirms the audio output is looped back by cable with no transmitter (or VOX radio) in
    /// the path.
    #[arg(long)]
    confirm_no_transmitter: bool,
    /// Import ADIF into the logbook (fields marked legacy_import).
    #[arg(long, value_name = "FILE")]
    import_adif: Option<PathBuf>,
}

/// What this binary is: every field a release artefact must carry (version, commit, build
/// date, target platform and architecture, profile, optional features, protocol).
pub(crate) fn version_text() -> String {
    format!(
        "z30 {} (z-30 vNext, Rust)\ncommit:       {}\nbuilt:        {} with {}\ntarget:       {}\narchitecture: {} ({})\nprofile:      {}\nfeatures:     {}\nprotocol:     v{}\nruntime:      native; no Python, Node or browser component",
        env!("CARGO_PKG_VERSION"),
        env!("Z30_BUILD_COMMIT"),
        env!("Z30_BUILD_DATE"),
        env!("Z30_BUILD_RUSTC"),
        env!("Z30_BUILD_TARGET"),
        std::env::consts::ARCH,
        std::env::consts::OS,
        env!("Z30_BUILD_PROFILE"),
        if cfg!(feature = "cm108") { "cm108 (CM108/CM119 GPIO PTT)" } else { "none (CM108 GPIO PTT not built in)" },
        z30_protocol::PROTOCOL_VERSION,
    )
}

fn main() {
    z30_engine::ptt::install_panic_release();
    let cli = Cli::parse();
    if cli.version {
        println!("{}", version_text());
        return;
    }
    let config_path = cli.config.clone().unwrap_or_else(paths::config_path);
    let result = run(&cli, &config_path);
    if let Err(e) = result {
        eprintln!("z30: {e}");
        std::process::exit(1);
    }
}

fn run(cli: &Cli, config_path: &Path) -> Result<(), String> {
    if cli.devices {
        let (ins, outs) = z30_io::audio::list_devices();
        println!("Audio inputs:");
        ins.iter().for_each(|d| println!("  {d}"));
        println!("Audio outputs:");
        outs.iter().for_each(|d| println!("  {d}"));
        println!("Serial ports:");
        z30_io::serial_ptt::SerialPtt::list().iter().for_each(|p| println!("  {p}"));
        return Ok(());
    }
    if cli.migrate {
        return migrate(config_path, cli.force);
    }
    if let Some(msg) = &cli.encode {
        let out = cli.wav.as_ref().ok_or("--encode needs --wav <file>")?;
        let m = z30_protocol::codec::Message::parse(msg).map_err(|e| e.to_string())?;
        let enc = m.encode().map_err(|e| e.to_string())?;
        let w = z30_protocol::gfsk::Modulator::new(cli.rate as f64)
            .map_err(|e| e.to_string())?
            .synthesize(&enc.symbols, cli.f0)
            .map_err(|e| e.to_string())?;
        z30_io::wav::write_mono(out, &w, cli.rate)?;
        println!("{m}  ->  {} ({} samples at {} Hz, tone 0 at {} Hz)", out.display(), w.len(), cli.rate, cli.f0);
        return Ok(());
    }
    if let Some(path) = &cli.export_adif {
        let book = Logbook::open(&paths::logbook_path())?;
        std::fs::write(path, book.export_adif()?).map_err(|e| e.to_string())?;
        println!("exported {} records to {}", book.all()?.len(), path.display());
        return Ok(());
    }
    if let Some(path) = &cli.import_adif {
        std::fs::create_dir_all(paths::data_dir()).map_err(|e| e.to_string())?;
        let mut book = Logbook::open(&paths::logbook_path())?;
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut rep = z30_io::migrate::Report::default();
        z30_io::migrate::import_adif(&text, &mut book, &mut rep);
        print!("{}", rep.text());
        return Ok(());
    }
    if let Some(what) = &cli.benchmark {
        return bench::run(what, cli.frames, cli.out.as_deref());
    }
    let cfg = paths::load_config(config_path)?;
    if cli.diagnostics {
        return diagnostics(&cfg, config_path);
    }
    if cli.loopback_test {
        return loopback::run(&cfg, cli.confirm_no_transmitter, cli.out.as_deref());
    }
    if let Some(wav) = &cli.decode {
        return decode_wav(wav, cli.start_utc, &cfg, cli.capture_slots.as_deref());
    }
    if cli.receive {
        return receive(cfg, cli.capture_slots.clone());
    }
    Err("nothing to do; see --help".into())
}

fn migrate(config_path: &Path, force: bool) -> Result<(), String> {
    let dir = paths::data_dir();
    let (cfg, mut rep) = z30_io::migrate::migrate_config(&dir);
    if config_path.exists() && !force {
        println!("{} exists; not replaced (use --force). Proposed configuration below.", config_path.display());
    } else {
        paths::save_config(config_path, &cfg)?;
        println!("wrote {}", config_path.display());
    }
    // Idempotent: a contact already in the vNext logbook is not imported again.
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut book = Logbook::open(&paths::logbook_path())?;
    z30_io::migrate::migrate_logbook(&dir, &mut book, &mut rep);
    print!("{}", rep.text());
    Ok(())
}

fn diagnostics(cfg: &z30_engine::config::Config, config_path: &Path) -> Result<(), String> {
    println!("{}", version_text());
    println!("config:   {}{}", config_path.display(), if config_path.exists() { "" } else { " (not found: defaults, transmit refused)" });
    println!("data dir: {}", paths::data_dir().display());
    let wall = z30_io::wallclock::SystemWallClock::default();
    println!("clock:    {}", wall.status());
    let engine = z30_engine::engine::Engine::new(cfg.clone());
    let snap = engine.snapshot(0);
    if snap.tx_blockers.is_empty() {
        println!("transmit gate: would allow (callsign, licence, band plan)");
    } else {
        println!("transmit gate: would REFUSE:");
        snap.tx_blockers.iter().for_each(|b| println!("  - {b}"));
    }
    match z30_io::open_ptt(cfg) {
        Ok(p) => println!("PTT:      {} (not keyed by diagnostics)", p.describe()),
        Err(e) => println!("PTT:      unavailable: {e}"),
    }
    if cfg.rig.rigctld_host.is_empty() {
        println!("rig:      no rigctld configured (dial unverified; the readback check does not apply)");
    } else {
        let mut rig = z30_io::rigctld::Rigctld::new(&cfg.rig.rigctld_host, cfg.rig.rigctld_port);
        match z30_engine::runtime::RigControl::read(&mut rig) {
            Ok(r) => println!("rig:      rigctld answers: dial {:?} Hz, PTT {:?}, mode {:?}", r.dial_hz, r.ptt, r.mode),
            Err(e) => println!("rig:      rigctld at {}:{} not reachable: {e}", cfg.rig.rigctld_host, cfg.rig.rigctld_port),
        }
    }
    let (ins, outs) = z30_io::audio::list_devices();
    println!("audio:    {} inputs, {} outputs (see --devices)", ins.len(), outs.len());
    Ok(())
}

fn print_decode(slot: i64, d: &z30_dsp::slot::Decode) {
    let (date, time) = z30_io::logbook::utc_parts(z30_engine::slots::slot_start(slot));
    let ap = if d.ap_type > 0 { format!(" a{}", d.ap_type) } else { String::new() };
    println!("{date} {time}  {:>5} dB  DT {:+5.2}  {:7.1} Hz  {}{ap}", z30_engine::api::snr_text(d.snr_db), d.dt_sec, d.freq_hz, d.message);
}

fn decode_wav(path: &Path, start_utc: Option<f64>, cfg: &z30_engine::config::Config, capture: Option<&Path>) -> Result<(), String> {
    let (samples, rate) = z30_io::wav::read_mono(path)?;
    let x: Vec<f32> = if rate == 6000 {
        samples
    } else {
        let mut r = Resampler::new(rate, 6000, Some(2850.0));
        let mut out = Vec::new();
        r.process(&samples, &mut out);
        // Remove the filter's delay so sample 0 still means the file's first instant.
        let skip = (-r.input_delay() / r.ratio()).round().max(0.0) as usize;
        out.drain(..skip.min(out.len()));
        out
    };
    let rx = Receiver::new();
    let rx_cfg = cfg.rx_config();
    let window = z30_dsp::baseband::SLOT_SAMPLES;
    if x.len() == window && start_utc.is_none() {
        let rep = rx.decode_slot(&x, &rx_cfg);
        rep.decodes.iter().for_each(|d| print_decode(0, d));
        eprintln!("{} decodes in {:.0} ms", rep.decodes.len(), rep.elapsed_ms);
        return Ok(());
    }
    // A recording on the slot grid: pad 1.5 s in front so slot n's window is complete.
    let t0 = start_utc.unwrap_or(0.0);
    let first_slot = z30_engine::slots::slot_of(t0 - 1e-6) + 1;
    let first_slot = if start_utc.is_none() { 0 } else { first_slot };
    let offset_sec = if start_utc.is_none() { 0.0 } else { z30_engine::slots::slot_start(first_slot) - t0 };
    let mut slot = first_slot;
    let mut total = 0;
    loop {
        let start = ((offset_sec - 1.5) * 6000.0 + (slot - first_slot) as f64 * 180_000.0).round() as i64;
        // Decode while a whole frame at DT = 0 fits in the recording; the rest of the window
        // (the +-1.5 s search margin) is zero-padded where the recording ends.
        if start + 9_000 + 144_000 > x.len() as i64 + 3_000 {
            break;
        }
        let win: Vec<f32> = (0..window as i64)
            .map(|i| if start + i >= 0 && ((start + i) as usize) < x.len() { x[(start + i) as usize] } else { 0.0 })
            .collect();
        let rep = rx.decode_slot(&win, &rx_cfg);
        let label = if start_utc.is_some() { slot } else { 0 };
        rep.decodes.iter().for_each(|d| print_decode(label, d));
        total += rep.decodes.len();
        if let Some(dir) = capture {
            capture_slot(dir, slot, &win, &rep, "recording")?;
        }
        slot += 1;
    }
    eprintln!("{total} decodes in {} slot(s)", slot - first_slot);
    Ok(())
}

fn capture_slot(dir: &Path, slot: i64, window: &[f32], rep: &z30_dsp::slot::SlotReport, source: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let (d, t) = z30_io::logbook::utc_parts(z30_engine::slots::slot_start(slot));
    let base = dir.join(format!("z30_{d}_{t}"));
    z30_io::wav::write_mono(&base.with_extension("wav"), window, 6000)?;
    let json = serde_json::json!({
        "slot": slot, "window_start_utc": z30_engine::slots::slot_start(slot) - 1.5, "rate_hz": 6000,
        // Where the samples came from: "live-audio" (a sound card) or "recording" (a WAV file).
        "source": source, "receiver": format!("z30 {}", env!("Z30_BUILD_COMMIT")),
        "elapsed_ms": rep.elapsed_ms,
        "decodes": rep.decodes.iter().map(|d| serde_json::json!({
            "message": d.message.to_string(), "snr_db": d.snr_db, "dt_sec": d.dt_sec, "freq_hz": d.freq_hz,
            "drift_hz": d.drift_hz, "iterations": d.iterations, "ap_type": d.ap_type, "pass": d.pass,
            // No per-decode confidence is reported: the decoder has no calibrated one. The CRC
            // passed; `method`, `iterations` and `ap_type` say how.
            "method": format!("{:?}", d.method),
        })).collect::<Vec<_>>(),
        "passes": rep.passes.iter().map(|p| serde_json::json!({"candidates": p.candidates, "decoded": p.decoded,
            "duplicates": p.duplicates, "suppression_db": p.suppression_db, "elapsed_ms": p.elapsed_ms})).collect::<Vec<_>>(),
    });
    std::fs::write(base.with_extension("json"), serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())
}

/// No audio output: the CLI never transmits.
struct Silent;

impl AudioOutput for Silent {
    fn sample_rate(&self) -> u32 {
        48_000
    }
    fn latency_sec(&self) -> f64 {
        0.0
    }
    fn play(&mut self, _samples: Vec<f32>) -> Result<(), String> {
        Err("the command-line station is receive-only".into())
    }
    fn stop(&mut self) {}
}

struct NoLog;

impl z30_engine::runtime::LogSink for NoLog {
    fn log(&mut self, _rec: &z30_engine::qso::QsoRecord) -> Result<(), String> {
        Ok(())
    }
}

fn receive(cfg: z30_engine::config::Config, capture: Option<PathBuf>) -> Result<(), String> {
    let input = z30_io::audio::CpalInput::open(cfg.audio.input_device.as_deref())?;
    println!(
        "receiving on {} Hz input; Ctrl-C to stop (this station never transmits)",
        z30_engine::runtime::AudioInput::sample_rate(&input)
    );
    let rig: Option<Box<dyn z30_engine::runtime::RigControl>> = (!cfg.rig.rigctld_host.is_empty())
        .then(|| Box::new(z30_io::rigctld::Rigctld::new(&cfg.rig.rigctld_host, cfg.rig.rigctld_port)) as _);
    let mut rx_only = cfg.clone();
    rx_only.operating.auto_sequence = false;
    let (tap_tx, tap_rx) = crossbeam_channel::bounded::<runtime::SlotCapture>(4);
    let handle = runtime::start(
        rx_only,
        RuntimeParts {
            input: Box::new(input),
            output: Box::new(Silent),
            rig,
            ptt: Box::new(NoPtt),
            wall: Arc::new(z30_io::wallclock::SystemWallClock::default()),
            mono: Arc::new(SystemMonotonic::default()),
            log: Box::new(NoLog),
            slot_tap: capture.as_ref().map(|_| tap_tx),
            tx_unavailable: Some("the command-line station is receive-only".into()),
        },
    );
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let s2 = stop.clone();
    ctrlc::set_handler(move || {
        z30_engine::ptt::emergency_release_all();
        s2.store(true, std::sync::atomic::Ordering::SeqCst);
    })
    .map_err(|e| e.to_string())?;
    let mut shown = 0u64;
    while !stop.load(std::sync::atomic::Ordering::SeqCst) {
        while let Ok(ev) = handle.events.try_recv() {
            match ev {
                Event::SlotDecoded { slot, count, elapsed_ms } => {
                    let snap = handle.snapshot.load();
                    let last = shown;
                    for row in snap.decodes.iter().filter(|r| r.id > last) {
                        print_decode(row.slot, &row.decode);
                        shown = row.id;
                    }
                    eprintln!("-- slot {slot}: {count} decodes, {elapsed_ms:.0} ms");
                }
                Event::SlotMissed(slot, why) => eprintln!("-- slot {slot} missed: {why:?}"),
                Event::Audio(s) | Event::Rig(s) => eprintln!("-- {s}"),
                _ => {}
            }
        }
        while handle.waterfall.try_recv().is_ok() {}
        if let Some(dir) = &capture {
            while let Ok(c) = tap_rx.try_recv() {
                if let Err(e) = capture_slot(dir, c.slot, &c.samples, &c.report, "live-audio") {
                    eprintln!("-- capture failed: {e}");
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    handle.shutdown();
    Ok(())
}
