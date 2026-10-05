//! `z30`: the headless z-30 station and toolbox.
//!
//! Receive-only by design: this binary never keys a transmitter. Transmitting is done from the
//! GUI, where the operator sees the gate's verdict before every transmission.

mod audio_loopback;
mod bench;
mod loopback;
mod suite;

// The build script's provenance code, compiled here only so its unit tests run with the crate's.
#[cfg(test)]
#[path = "../build_support.rs"]
mod build_support;

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
    /// suite benchmark's own publishable size otherwise). A suite run below its benchmark's
    /// publishable size (200 frames per point for every crossing) is exploratory.
    #[arg(long)]
    frames: Option<usize>,
    /// Suite replicate number (default 0: the published seed 20260830). Replicate r >= 1 runs
    /// the same conditions on frames no other replicate uses, to measure a figure's sampling
    /// variability; its results say they are not the published run.
    #[arg(long)]
    replicate: Option<u16>,
    /// Output directory for suite results, or the JSON file for --loopback-test /
    /// --audio-loopback-test. Suite default: research/results/<commit>/ for a clean,
    /// full-size, published-seed run; <commit>/replicates/r<N>/, exploratory/<commit>/ or
    /// unpublished/<commit>-dirty-<diff>/ under research/results/ otherwise.
    #[arg(long, value_name = "DIR")]
    out: Option<PathBuf>,
    /// Suite: also write <benchmark>.frames.jsonl, one line per frame (point, frame index,
    /// seed, condition, outcome), so two commits can be paired frame by frame.
    #[arg(long)]
    per_frame: bool,
    /// Suite: replace existing result files that are not published results. A published
    /// result is never overwritten.
    #[arg(long)]
    overwrite: bool,
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
    /// Software loopback: a known frame through the production transmit synthesis and the
    /// production receive chain (resampler, clock, scheduler, decode_slot) at 48 and 44.1 kHz,
    /// entirely in memory. Opens no audio device, PTT line or rig control, so it cannot
    /// transmit. Reports decode, DT, frequency, SNR and occupied bandwidth as JSON.
    #[arg(long)]
    loopback_test: bool,
    /// Hardware validation A1 (docs/hardware-validation.md): play a known frame through the
    /// configured OUTPUT SOUND CARD, record it through the configured input, and analyse it as
    /// --loopback-test does. Keys nothing. Requires --confirm-no-transmitter, and refuses to run
    /// with any PTT method (VOX included) or rig control configured.
    #[arg(long)]
    audio_loopback_test: bool,
    /// For --audio-loopback-test: confirms the output is looped back by cable with no
    /// transmitter (or VOX radio) in the path.
    #[arg(long)]
    confirm_no_transmitter: bool,
    /// Import ADIF into the logbook (fields marked legacy_import).
    #[arg(long, value_name = "FILE")]
    import_adif: Option<PathBuf>,
}

/// What this binary is: every field a release artefact must carry (version, commit, build
/// date, target platform and architecture, profile, optional features, protocol).
pub(crate) fn version_text() -> String {
    let diff = env!("Z30_BUILD_DIRTY_DIFF_SHA256");
    let mut text = format!(
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
    );
    if !diff.is_empty() {
        // Which uncommitted difference a -dirty binary was built from (sha256 of the tracked
        // diff against HEAD plus untracked crate sources), so two dirty builds can be told apart.
        text.push_str(&format!("\ndirty diff:   sha256 {diff}"));
    }
    text
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
        // Verified like a transmitted frame: a WAV can be played into a radio.
        let frame = m.frame().map_err(|e| e.to_string())?;
        let w = z30_protocol::gfsk::Modulator::new(cli.rate as f64)
            .map_err(|e| e.to_string())?
            .synthesize(frame.symbols(), cli.f0)
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
        let opts = suite::Options {
            frames: cli.frames,
            out: cli.out.clone(),
            replicate: cli.replicate,
            per_frame: cli.per_frame,
            overwrite: cli.overwrite,
        };
        return bench::run(what, &opts);
    }
    if cli.loopback_test {
        // No configuration is read: nothing in it could matter to a test that touches no device.
        if let Some(p) = cli.out.as_deref() {
            check_report_target(p)?;
        }
        let (text, pass) = loopback::run()?;
        println!("{text}");
        if let Some(p) = cli.out.as_deref() {
            write_report_file(p, &text)?;
        }
        return if pass { Ok(()) } else { Err("software loopback FAILED (see the criteria above)".into()) };
    }
    // A device as the hardware loopback's report target is refused before anything else: before
    // its refusals and before it opens a device, so the test plays nothing only to fail at the
    // end (CTO re-review N-11), and a test of the refusal cannot reach a sound card if the check
    // is removed - the run then stops at the refusals instead (transmit-safety 02d finding 1).
    if cli.audio_loopback_test {
        if let Some(p) = cli.out.as_deref() {
            check_report_target(p)?;
        }
    }
    let cfg = paths::load_config(config_path)?;
    if cli.diagnostics {
        return diagnostics(&cfg, config_path);
    }
    if cli.audio_loopback_test {
        return audio_loopback::run(&cfg, cli.confirm_no_transmitter, cli.out.as_deref());
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
    // The status is queried on a thread of its own; give the OS a few seconds to answer.
    let t = std::time::Instant::now();
    while wall.status() == z30_io::wallclock::STATUS_NOT_YET_CHECKED && t.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(20));
    }
    println!("clock:    {}", wall.status());
    let engine = z30_engine::engine::Engine::new(cfg.clone());
    let snap = engine.snapshot(0);
    if snap.tx_blockers.is_empty() {
        // The gate checks the hardware too; diagnostics open no audio device or keying line, so
        // a device that cannot be opened shows up only when the station starts.
        println!(
            "transmit gate: would allow (callsign, licence, band plan, PTT method, level; devices are checked when the station opens them)"
        );
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
    // The device each direction would actually use; an ambiguous name is an error here too.
    for (label, input, wanted) in
        [("audio in: ", true, cfg.audio.input_device.as_deref()), ("audio out:", false, cfg.audio.output_device.as_deref())]
    {
        match z30_io::audio::resolve_device_name(input, wanted) {
            Ok(name) => println!("{label} {name}{}", if wanted.is_none() { " (system default)" } else { "" }),
            Err(e) => println!("{label} unavailable: {e}"),
        }
    }
    Ok(())
}

/// `when`: the slot, if its UTC is known; otherwise the recording's window index. A recording
/// decoded without `--start-utc` has no time, and used to be printed as 1970-01-01 00:00:00.
fn print_decode(when: Result<i64, usize>, d: &z30_dsp::slot::Decode) {
    let label = match when {
        Ok(slot) => {
            let (date, time) = z30_io::logbook::utc_parts(z30_engine::slots::slot_start(slot));
            format!("{date} {time}")
        }
        Err(i) => format!("window {i:<3} (UTC unknown)"),
    };
    let ap = if d.ap_type > 0 { format!(" a{}", d.ap_type) } else { String::new() };
    println!("{label}  {:>5} dB  DT {:+5.2}  {:7.1} Hz  {}{ap}", z30_engine::api::snr_text(d.snr_db), d.dt_sec, d.freq_hz, d.message);
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
        rep.decodes.iter().for_each(|d| print_decode(Err(0), d));
        eprintln!("{} decodes in {:.0} ms", rep.decodes.len(), rep.elapsed_ms);
        return Ok(());
    }
    // A recording on the slot grid: pad 1.5 s in front so slot n's window is complete. With no
    // start time the recording is assumed to start at a slot boundary, and its slots have no UTC.
    let (first_slot, offset_sec) = match start_utc {
        Some(t0) => {
            let s = z30_engine::slots::slot_of(t0 - 1e-6) + 1;
            (s, z30_engine::slots::slot_start(s) - t0)
        }
        None => (0, 0.0),
    };
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
        let when = if start_utc.is_some() { Ok(slot) } else { Err((slot - first_slot) as usize) };
        rep.decodes.iter().for_each(|d| print_decode(when, d));
        total += rep.decodes.len();
        if let Some(dir) = capture {
            capture_slot(dir, when, &win, &rep, "recording")?;
        }
        slot += 1;
    }
    eprintln!("{total} decodes in {} slot(s)", slot - first_slot);
    Ok(())
}

fn capture_slot(dir: &Path, when: Result<i64, usize>, window: &[f32], rep: &z30_dsp::slot::SlotReport, source: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let base = match when {
        Ok(slot) => {
            let (d, t) = z30_io::logbook::utc_parts(z30_engine::slots::slot_start(slot));
            dir.join(format!("z30_{d}_{t}"))
        }
        Err(i) => dir.join(format!("z30_window_{i:04}")),
    };
    z30_io::wav::write_mono(&base.with_extension("wav"), window, 6000)?;
    let json = serde_json::json!({
        // Absent (null) when the recording's start time was not given: not 1970.
        "slot": when.ok(), "window_start_utc": when.ok().map(|s| z30_engine::slots::slot_start(s) - 1.5), "rate_hz": 6000,
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
        // AGENTS.md §4: the per-pass figure is not physical suppression; the file says so itself.
        "suppression_db_note": "receiver-internal fit ratio, not physical suppression (overstates it by 9-16 dB)",
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
                        print_decode(Ok(row.slot), &row.decode);
                        shown = row.id;
                    }
                    eprintln!("-- slot {slot}: {count} decodes, {elapsed_ms:.0} ms");
                }
                Event::SlotMissed(slot, why) => eprintln!("-- slot {slot} missed: {why:?}"),
                Event::Audio(s) | Event::Rig(s) => eprintln!("-- {s}"),
                Event::ClockStepped { from_slot, to_slot } => eprintln!(
                    "-- the system clock stepped {:+} s: the receiver moved from slot {from_slot} to slot {to_slot}",
                    (to_slot - from_slot) * 30
                ),
                _ => {}
            }
        }
        while handle.waterfall.try_recv().is_ok() {}
        if let Some(dir) = &capture {
            while let Ok(c) = tap_rx.try_recv() {
                if let Err(e) = capture_slot(dir, Ok(c.slot), &c.samples, &c.report, "live-audio") {
                    eprintln!("-- capture failed: {e}");
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let report = handle.shutdown();
    if !report.release_confirmed() {
        eprintln!("-- PTT release NOT confirmed at shutdown ({:?}): the radio may still be keyed", report.ptt);
    }
    Ok(())
}

/// Writes a loopback test's report, only to a file. A device is refused, judged without
/// opening it: on Linux, opening a serial tty asserts DTR and RTS, and on Windows opening a COM
/// port usually raises DTR, so `--out /dev/ttyUSB0` or `--out COM3` would briefly key a
/// serial-PTT radio from a test that must not be able to (transmit-safety re-review R-3, and its
/// confirmation's finding 4 for Windows).
pub(crate) fn write_report_file(p: &Path, text: &str) -> Result<(), String> {
    check_report_target(p)?;
    std::fs::write(p, text).map_err(|e| format!("{}: {e}", p.display()))
}

/// Refuses a report target that is not, or could not become, a regular file. Called before the
/// test runs as well, so a wrong `--out` fails at once rather than after the test.
pub(crate) fn check_report_target(p: &Path) -> Result<(), String> {
    let refuse = || Err(format!("{}: not a regular file; the loopback report is written only to a file", p.display()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        if let Ok(m) = std::fs::metadata(p) {
            let t = m.file_type();
            if t.is_char_device() || t.is_block_device() || t.is_fifo() || t.is_socket() {
                return refuse();
            }
        }
    }
    #[cfg(windows)]
    {
        if is_windows_device_path(&p.to_string_lossy()) {
            return refuse();
        }
    }
    Ok(())
}

/// A Win32 device namespace path (`\\.\COM3`, `\\?\...`) or a reserved DOS device name (`COM3`,
/// `nul.json`, `dir\LPT1.txt`): Windows opens the device for these, whatever the directory or
/// extension. `metadata` cannot be trusted to say so, so the name decides.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_windows_device_path(s: &str) -> bool {
    if s.starts_with("\\\\.\\") || s.starts_with("\\\\?\\") || s.starts_with("\\??\\") || s.starts_with("//./") || s.starts_with("//?/") {
        return true;
    }
    let name = s.rsplit(['\\', '/']).next().unwrap_or(s);
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches([' ', ':']).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || ["COM", "LPT"].iter().any(|d| {
            stem.strip_prefix(d)
                .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "\u{b9}" | "\u{b2}" | "\u{b3}"))
        })
}

#[cfg(test)]
mod report_target_tests {
    use super::{is_windows_device_path, write_report_file};

    // The writer refuses a device itself, not only through the early checks in front of it: a
    // later caller that forgets them is still refused (transmit-safety 02d, mutant B4).
    // `/dev/null` is a character device like a tty, and harmless if the refusal is ever lost.
    #[cfg(unix)]
    #[test]
    fn the_report_writer_refuses_a_character_device_by_itself() {
        let e = write_report_file(std::path::Path::new("/dev/null"), "report").unwrap_err();
        assert!(e.contains("not a regular file"), "{e}");
    }

    // Pure name test, so it runs on every CI platform, not only on Windows where it is used.
    #[test]
    fn windows_device_names_and_namespace_paths_are_refused_and_ordinary_files_are_not() {
        for d in [
            "COM3",
            "com1",
            "LPT2",
            "NUL",
            "nul.json",
            "CON",
            "AUX.txt",
            r"C:\tmp\COM4.json",
            "out/COM9",
            r"\\.\COM12",
            r"\??\GLOBALROOT\Device\Serial0",
            r"\\?\C:\x",
            "//./COM3",
            "COM3:",
        ] {
            assert!(is_windows_device_path(d), "{d} must be refused");
        }
        for f in ["report.json", "COM10x.json", "COMMIT.json", r"C:\tmp\loopback.json", "console.json", "LPT.json", "/tmp/com.json"] {
            assert!(!is_windows_device_path(f), "{f} is an ordinary file name");
        }
    }
}
