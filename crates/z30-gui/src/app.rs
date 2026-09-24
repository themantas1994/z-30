//! The application window.

use crate::waterfall::{Waterfall, SPAN_HZ};
use egui::{Color32, RichText};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use z30_engine::api::{Command, EngineSnapshot, Event, TxStatus};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig, SerialLine, TxSlot};
use z30_engine::pipeline::AudioBlock;
use z30_engine::ptt::{NoPtt, SystemMonotonic};
use z30_engine::runtime::{self, AudioInput, AudioOutput, RuntimeHandle, RuntimeParts};
use z30_io::paths;

/// Input used when no device can be opened: reports the failure instead of pretending.
struct NoInput(String);

impl AudioInput for NoInput {
    fn sample_rate(&self) -> u32 {
        48_000
    }
    fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String> {
        std::thread::sleep(timeout);
        Err(self.0.clone())
    }
}

/// Output used when no device can be opened: every transmission fails (and is reported).
struct NoOutput(String);

impl AudioOutput for NoOutput {
    fn sample_rate(&self) -> u32 {
        48_000
    }
    fn latency_sec(&self) -> f64 {
        0.0
    }
    fn play(&mut self, _s: Vec<f32>) -> Result<(), String> {
        Err(self.0.clone())
    }
    fn stop(&mut self) {}
}

struct StartReport {
    notes: Vec<String>,
}

fn start_runtime(cfg: &Config) -> (RuntimeHandle, StartReport) {
    let mut notes = Vec::new();
    let mut tx_problems: Vec<String> = Vec::new();
    let input: Box<dyn AudioInput> = match z30_io::audio::CpalInput::open(cfg.audio.input_device.as_deref()) {
        Ok(i) => Box::new(i),
        Err(e) => {
            notes.push(format!("Audio input unavailable: {e}"));
            Box::new(NoInput(e))
        }
    };
    let output: Box<dyn AudioOutput> = match z30_io::audio::CpalOutput::open(cfg.audio.output_device.as_deref()) {
        Ok(o) => Box::new(o),
        Err(e) => {
            notes.push(format!("Audio output unavailable (transmit impossible): {e}"));
            tx_problems.push(format!("audio output: {e}"));
            Box::new(NoOutput(e))
        }
    };
    let ptt = z30_io::open_ptt(cfg).unwrap_or_else(|e| {
        notes.push(format!("PTT unavailable (transmit impossible): {e}"));
        tx_problems.push(format!("PTT: {e}"));
        Box::new(NoPtt)
    });
    let rig: Option<Box<dyn z30_engine::runtime::RigControl>> = (!cfg.rig.rigctld_host.is_empty())
        .then(|| Box::new(z30_io::rigctld::Rigctld::new(&cfg.rig.rigctld_host, cfg.rig.rigctld_port)) as _);
    let _ = std::fs::create_dir_all(paths::data_dir());
    let log: Box<dyn z30_engine::runtime::LogSink> = match z30_io::logbook::Logbook::open(&paths::logbook_path()) {
        Ok(l) => Box::new(l),
        Err(e) => {
            notes.push(format!("Logbook unavailable: {e}"));
            Box::new(z30_io::logbook::Logbook::in_memory().expect("in-memory sqlite"))
        }
    };
    let h = runtime::start(
        cfg.clone(),
        RuntimeParts {
            input,
            output,
            rig,
            ptt,
            wall: Arc::new(z30_io::wallclock::SystemWallClock::default()),
            mono: Arc::new(SystemMonotonic::default()),
            log,
            slot_tap: None,
            tx_unavailable: (!tx_problems.is_empty()).then(|| tx_problems.join("; ")),
        },
    );
    (h, StartReport { notes })
}

/// The window's state. Nothing here is authoritative: the engine's snapshot is.
pub struct App {
    rt: Option<RuntimeHandle>,
    config_path: std::path::PathBuf,
    draft: Config,
    show_settings: bool,
    show_log: bool,
    show_diag: bool,
    messages: Vec<(String, Color32)>,
    waterfall: Waterfall,
    devices: (Vec<String>, Vec<String>),
    serial_ports: Vec<String>,
    log_rows: Vec<z30_engine::qso::QsoRecord>,
    frame_ms: f64,
    worst_frame_ms: f64,
}

impl App {
    /// Loads the configuration (running the legacy migration on first start) and starts the
    /// engine.
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        let config_path = paths::config_path();
        let mut messages = Vec::new();
        if !config_path.exists() {
            let (cfg, rep) = z30_io::migrate::migrate_config(&paths::data_dir());
            if !rep.sources.is_empty() {
                let _ = paths::save_config(&config_path, &cfg);
                if !paths::logbook_path().exists() {
                    if let Ok(mut book) = z30_io::logbook::Logbook::open(&paths::logbook_path()) {
                        let mut rep2 = rep.clone();
                        z30_io::migrate::migrate_logbook(&paths::data_dir(), &mut book, &mut rep2);
                        messages
                            .push((format!("Imported {} logbook entries from the legacy app.", rep2.log_imported), Color32::LIGHT_BLUE));
                    }
                }
                for line in rep.text().lines() {
                    messages.push((format!("migration: {line}"), Color32::LIGHT_BLUE));
                }
            }
        }
        let cfg = paths::load_config(&config_path).unwrap_or_else(|e| {
            messages.push((
                format!("Configuration unreadable ({e}); using defaults - transmit is refused until it is fixed."),
                Color32::YELLOW,
            ));
            Config::default()
        });
        let (rt, rep) = start_runtime(&cfg);
        messages.extend(rep.notes.into_iter().map(|n| (n, Color32::YELLOW)));
        App {
            rt: Some(rt),
            config_path,
            draft: cfg,
            show_settings: false,
            show_log: false,
            show_diag: false,
            messages,
            waterfall: Waterfall::new(),
            devices: z30_io::audio::list_devices(),
            serial_ports: z30_io::serial_ptt::SerialPtt::list(),
            log_rows: Vec::new(),
            frame_ms: 0.0,
            worst_frame_ms: 0.0,
        }
    }

    fn send(&mut self, c: Command) {
        if let Some(rt) = &self.rt {
            if rt.commands.try_send(c).is_err() {
                self.messages.push(("Engine busy; command not sent.".into(), Color32::YELLOW));
            }
        }
    }

    fn snapshot(&self) -> Option<Arc<EngineSnapshot>> {
        self.rt.as_ref().map(|rt| rt.snapshot.load_full())
    }

    fn drain(&mut self) {
        let Some(rt) = &self.rt else { return };
        while let Ok(row) = rt.waterfall.try_recv() {
            self.waterfall.push(&row);
        }
        let mut new = Vec::new();
        while let Ok(e) = rt.events.try_recv() {
            new.push(e);
        }
        for e in new {
            let (text, color) = match e {
                Event::TxRefused(v) => (
                    format!("TX refused: {}", v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(" | ")),
                    Color32::from_rgb(255, 120, 90),
                ),
                Event::TxStarted { text, .. } => (format!("TX: {text}"), Color32::from_rgb(255, 170, 60)),
                Event::TxFault(s) => (format!("TX fault: {s}"), Color32::RED),
                Event::WatchdogReleased => ("PTT watchdog released the transmitter".into(), Color32::RED),
                Event::SequencerWatchdog(n) => (format!("Stopped after {n} transmissions without an answer"), Color32::YELLOW),
                Event::Logged(r) => (
                    format!(
                        "Logged {} ({} - {})",
                        r.call,
                        r.grid.as_ref().map(|g| g.value.clone()).unwrap_or("no grid".into()),
                        r.rst_rcvd.as_ref().map(|v| format!("{:+03}", v.value)).unwrap_or("no report".into())
                    ),
                    Color32::LIGHT_GREEN,
                ),
                Event::SlotMissed(s, why) => (format!("Slot {s} not decoded: {why:?}"), Color32::YELLOW),
                Event::Rig(s) | Event::Audio(s) => (s, Color32::GRAY),
                Event::Qso(s) => (format!("QSO: {s:?}"), Color32::GRAY),
                _ => continue,
            };
            self.messages.push((text, color));
        }
        let n = self.messages.len();
        if n > 300 {
            self.messages.drain(..n - 300);
        }
    }

    fn apply_settings(&mut self) {
        if let Err(e) = paths::save_config(&self.config_path, &self.draft) {
            self.messages.push((format!("Could not save settings: {e}"), Color32::RED));
            return;
        }
        let Some(snap) = self.snapshot() else { return };
        let old = snap.config.as_ref().clone();
        let hardware_changed = old.audio != self.draft.audio || old.ptt != self.draft.ptt || old.rig != self.draft.rig;
        if hardware_changed {
            // New devices or keying line: restart the runtime. Shutdown unkeys first.
            if let Some(rt) = self.rt.take() {
                rt.shutdown();
            }
            let (rt, rep) = start_runtime(&self.draft);
            self.messages.extend(rep.notes.into_iter().map(|n| (n, Color32::YELLOW)));
            self.rt = Some(rt);
        } else {
            let c = Box::new(self.draft.clone());
            self.send(Command::UpdateConfig(c));
        }
        self.messages.push(("Settings saved.".into(), Color32::LIGHT_GREEN));
    }
}

fn utc_now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let t0 = Instant::now();
        let ctx = ui.ctx().clone();
        self.drain();
        let Some(snap) = self.snapshot() else { return };
        let now = utc_now();
        let (date, time) = z30_io::logbook::utc_parts(now);
        let slot = z30_engine::slots::slot_of(now);
        let in_slot = now - z30_engine::slots::slot_start(slot);

        egui::Panel::top("top").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading(
                    RichText::new(if snap.config.station.callsign.is_empty() {
                        "z-30 (no callsign)"
                    } else {
                        &snap.config.station.callsign
                    })
                    .strong(),
                );
                ui.separator();
                ui.monospace(format!("{} {}:{}:{} UTC", date, &time[..2], &time[2..4], &time[4..6]));
                ui.add(egui::ProgressBar::new((in_slot / 30.0) as f32).desired_width(160.0).text(format!(
                    "{} slot {:.1} s",
                    if slot % 2 == 0 { "even" } else { "odd" },
                    in_slot
                )));
                ui.separator();
                let rig = &snap.rig;
                let dial = format!("{:.6} MHz", snap.commanded_dial_hz as f64 / 1e6);
                match rig.reported_dial_hz {
                    Some(r) if rig.online && (r - snap.commanded_dial_hz as f64).abs() < 2.0 => {
                        ui.label(RichText::new(format!("{dial} (radio agrees)")).color(Color32::LIGHT_GREEN))
                    }
                    Some(r) if rig.online => {
                        ui.label(RichText::new(format!("{dial} commanded, radio reports {:.6}", r / 1e6)).color(Color32::YELLOW))
                    }
                    _ => ui.label(format!("{dial} (not verified)")),
                };
                ui.separator();
                let (txt, col) = match &snap.tx {
                    TxStatus::Idle => ("RX".to_string(), Color32::GRAY),
                    TxStatus::Armed => ("TX armed".to_string(), Color32::YELLOW),
                    TxStatus::Transmitting { text, .. } => (format!("TX  {text}"), Color32::from_rgb(255, 90, 60)),
                };
                ui.label(RichText::new(txt).strong().color(col));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Diagnostics").clicked() {
                        self.show_diag = !self.show_diag;
                    }
                    if ui.button("Logbook").clicked() {
                        self.show_log = !self.show_log;
                        if self.show_log {
                            self.log_rows =
                                z30_io::logbook::Logbook::open(&paths::logbook_path()).and_then(|b| b.all()).unwrap_or_default();
                        }
                    }
                    if ui.button("Settings").clicked() {
                        self.draft = snap.config.as_ref().clone();
                        self.devices = z30_io::audio::list_devices();
                        self.serial_ports = z30_io::serial_ptt::SerialPtt::list();
                        self.show_settings = true;
                    }
                });
            });
        });

        egui::Panel::bottom("status").show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                let a = &snap.audio;
                ui.label(if a.input_running {
                    RichText::new("audio in: running")
                } else {
                    RichText::new("audio in: STOPPED").color(Color32::RED)
                });
                if let Some(l) = a.level_dbfs {
                    ui.label(format!("level {l:.0} dBFS"));
                }
                ui.label(format!("overruns {}", a.overruns));
                ui.label(match a.drift_ppm {
                    Some(p) => format!("sound-card clock {p:+.0} ppm"),
                    None => "sound-card clock: measuring".into(),
                });
                ui.separator();
                let s = &snap.stats;
                ui.label(format!(
                    "decode {:.0} ms (max {:.0}), done at slot+{:.1} s, {} missed",
                    s.last_ms, s.max_ms, s.last_done_after_slot_sec, s.missed
                ));
                if let Some(dt) = snap.dt_median_sec {
                    ui.label(format!("median DT {dt:+.2} s"));
                }
                ui.separator();
                ui.label(&snap.clock_status);
            });
        });

        egui::Panel::right("qso").default_size(330.0).show(ui, |ui| {
            ui.heading("QSO");
            match &snap.qso {
                Some(q) => ui.label(format!("{q:?}")),
                None => ui.label(RichText::new("Set a callsign z-30 v1 can carry to operate.").color(Color32::YELLOW)),
            };
            if let Some(t) = &snap.next_tx_text {
                ui.label(RichText::new(format!("next: {t}")).monospace());
            }
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if ui.button("Call CQ").clicked() {
                    self.send(Command::CallCq);
                }
                let enabled = !matches!(snap.tx, TxStatus::Idle);
                if ui.selectable_label(enabled, "Enable TX").clicked() {
                    self.send(Command::EnableTx(!enabled));
                }
                if ui.button("Tune").clicked() {
                    self.send(Command::Tune);
                }
            });
            if ui
                .add(
                    egui::Button::new(RichText::new("HALT TX").strong().color(Color32::WHITE))
                        .fill(Color32::from_rgb(160, 30, 30))
                        .min_size([300.0, 34.0].into()),
                )
                .clicked()
            {
                self.send(Command::HaltTx);
            }
            if ui.button("Reset QSO").clicked() {
                self.send(Command::ResetQso);
            }
            ui.add_space(6.0);
            if snap.tx_blockers.is_empty() {
                ui.label(RichText::new("Transmit gate: clear").color(Color32::LIGHT_GREEN));
            } else {
                ui.label(RichText::new("Transmit gate would refuse:").color(Color32::from_rgb(255, 120, 90)));
                for b in &snap.tx_blockers {
                    ui.label(RichText::new(format!("- {b}")).small());
                }
            }
            ui.separator();
            egui::ScrollArea::vertical().stick_to_bottom(true).show(ui, |ui| {
                for (m, c) in &self.messages {
                    ui.label(RichText::new(m).color(*c).small());
                }
            });
        });

        egui::CentralPanel::default().show(ui, |ui| {
            // Waterfall with RX/TX markers; a click sets both (shift-click: TX only).
            let tex = self.waterfall.texture(&ctx).clone();
            let w = ui.available_width();
            let (rect, resp) = ui.allocate_exact_size(egui::vec2(w, 200.0), egui::Sense::click());
            ui.painter().image(tex.id(), rect, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
            let x_of = |hz: f64| rect.left() + (hz as f32 / SPAN_HZ) * rect.width();
            let span = 46.875;
            let op = &snap.config.operating;
            ui.painter().rect_stroke(
                egui::Rect::from_x_y_ranges(x_of(op.rx_audio_hz)..=x_of(op.rx_audio_hz + span), rect.y_range()),
                0.0,
                (1.5, Color32::GREEN),
                egui::StrokeKind::Inside,
            );
            ui.painter().rect_stroke(
                egui::Rect::from_x_y_ranges(x_of(op.tx_audio_hz)..=x_of(op.tx_audio_hz + span), rect.y_range()),
                0.0,
                (1.5, Color32::RED),
                egui::StrokeKind::Inside,
            );
            if let Some(pos) = resp.interact_pointer_pos() {
                if resp.clicked() {
                    let hz = (((pos.x - rect.left()) / rect.width()) * SPAN_HZ) as f64;
                    let shift = ui.input(|i| i.modifiers.shift);
                    self.send(Command::SetAudioFrequencies { rx_hz: if shift { op.rx_audio_hz } else { hz }, tx_hz: hz });
                }
            }
            ui.add_space(4.0);
            ui.label(RichText::new("Band activity (double-click a CQ to answer)").strong());
            egui::ScrollArea::vertical().stick_to_bottom(true).show(ui, |ui| {
                egui::Grid::new("decodes").striped(true).num_columns(6).show(ui, |ui| {
                    for h in ["UTC", "dB", "DT", "Hz", "Message", ""] {
                        ui.label(RichText::new(h).strong());
                    }
                    ui.end_row();
                    for r in snap.decodes.iter().rev().take(200).rev() {
                        let (_, t) = z30_io::logbook::utc_parts(z30_engine::slots::slot_start(r.slot));
                        ui.monospace(&t);
                        ui.monospace(format!("{:+4.0}", r.snr_db));
                        ui.monospace(format!("{:+.1}", r.dt_sec));
                        ui.monospace(format!("{:.0}", r.freq_hz));
                        let color = if r.to_me {
                            Color32::from_rgb(255, 110, 110)
                        } else if r.is_cq {
                            Color32::LIGHT_GREEN
                        } else {
                            ui.visuals().text_color()
                        };
                        let resp = ui.add(egui::Label::new(RichText::new(&r.text).monospace().color(color)).sense(egui::Sense::click()));
                        if resp.double_clicked() && r.is_cq {
                            self.send(Command::Answer(r.id));
                        }
                        // AP-assisted decodes are labelled, never hidden (AGENTS.md section 4).
                        ui.monospace(if r.ap_type > 0 { format!("a{}", r.ap_type) } else { String::new() });
                        ui.end_row();
                    }
                });
            });
        });

        if self.show_settings {
            let mut open = true;
            let mut apply = false;
            egui::Window::new("Settings").open(&mut open).default_width(520.0).show(&ctx, |ui| {
                apply = settings_ui(ui, &mut self.draft, &self.devices, &self.serial_ports);
            });
            if apply {
                self.apply_settings();
            }
            self.show_settings = open && !apply;
        }
        if self.show_log {
            let mut open = true;
            egui::Window::new("Logbook").open(&mut open).default_width(760.0).show(&ctx, |ui| {
                if ui.button("Export ADIF").clicked() {
                    let path = paths::data_dir().join("export.adi");
                    let res = z30_io::logbook::Logbook::open(&paths::logbook_path())
                        .and_then(|b| b.export_adif())
                        .and_then(|t| std::fs::write(&path, t).map_err(|e| e.to_string()));
                    self.messages.push(match res {
                        Ok(()) => (format!("ADIF written to {}", path.display()), Color32::LIGHT_GREEN),
                        Err(e) => (format!("ADIF export failed: {e}"), Color32::RED),
                    });
                }
                egui::ScrollArea::vertical().show(ui, |ui| {
                    egui::Grid::new("log").striped(true).show(ui, |ui| {
                        for h in ["UTC", "Call", "Grid", "Sent", "Rcvd", "MHz", "Notes"] {
                            ui.label(RichText::new(h).strong());
                        }
                        ui.end_row();
                        for r in &self.log_rows {
                            let (d, t) = z30_io::logbook::utc_parts(r.start_utc);
                            ui.monospace(format!("{d} {t}"));
                            ui.monospace(&r.call);
                            ui.monospace(r.grid.as_ref().map(|g| g.value.clone()).unwrap_or_else(|| "-".into()));
                            ui.monospace(r.rst_sent.as_ref().map(|v| format!("{:+03}", v.value)).unwrap_or_else(|| "-".into()));
                            ui.monospace(r.rst_rcvd.as_ref().map(|v| format!("{:+03}", v.value)).unwrap_or_else(|| "-".into()));
                            ui.monospace(format!("{:.6}", (r.dial_hz.value + r.tx_audio_hz) / 1e6));
                            ui.label(
                                RichText::new(format!("freq {:?}{}", r.dial_hz.source, if r.ap_assisted { ", AP" } else { "" })).small(),
                            );
                            ui.end_row();
                        }
                    });
                });
            });
            self.show_log = open;
        }
        if self.show_diag {
            let mut open = true;
            egui::Window::new("Diagnostics").open(&mut open).show(&ctx, |ui| {
                ui.label(format!(
                    "z30 {} ({}) - protocol v{}",
                    env!("CARGO_PKG_VERSION"),
                    env!("Z30_BUILD_COMMIT"),
                    z30_protocol::PROTOCOL_VERSION
                ));
                ui.label(format!("config: {}", self.config_path.display()));
                ui.label(format!("GUI frame time {:.2} ms (worst {:.2} ms)", self.frame_ms, self.worst_frame_ms));
                ui.label(format!(
                    "slots decoded {}, missed {}, last decode {:.0} ms, worst {:.0} ms",
                    snap.stats.slots, snap.stats.missed, snap.stats.last_ms, snap.stats.max_ms
                ));
                ui.label(format!("rig: {:?}", snap.rig));
                ui.label(format!("audio: {:?}", snap.audio));
                ui.label(format!(
                    "configured TX power: {} (configuration, not a measurement)",
                    snap.config.station.configured_tx_power_w.map(|p| format!("{p} W")).unwrap_or("not set".into())
                ));
                ui.label("Forward power / SWR: not measured");
            });
            self.show_diag = open;
        }

        let dt = t0.elapsed().as_secs_f64() * 1e3;
        self.frame_ms = 0.9 * self.frame_ms + 0.1 * dt;
        self.worst_frame_ms = self.worst_frame_ms.max(dt);
        ctx.request_repaint_after(Duration::from_millis(16));
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        if let Some(rt) = self.rt.take() {
            rt.shutdown();
        }
    }
}

/// The settings form. Returns true when Apply was pressed. Validation is the codec's and the
/// gate's own: the form shows what they will say.
fn settings_ui(ui: &mut egui::Ui, c: &mut Config, devices: &(Vec<String>, Vec<String>), ports: &[String]) -> bool {
    ui.heading("Station");
    egui::Grid::new("station").num_columns(2).show(ui, |ui| {
        ui.label("Callsign");
        ui.text_edit_singleline(&mut c.station.callsign);
        ui.end_row();
        ui.label("");
        let call = c.station.callsign.trim();
        match z30_protocol::codec::Callsign::new(call) {
            Ok(_) => ui.label(RichText::new("z-30 v1 can carry this callsign").color(Color32::LIGHT_GREEN).small()),
            Err(e) if !call.is_empty() => ui.label(RichText::new(e.to_string()).color(Color32::YELLOW).small()),
            Err(_) => ui.label(""),
        };
        ui.end_row();
        ui.label("Grid");
        ui.text_edit_singleline(&mut c.station.grid);
        ui.end_row();
        ui.label("");
        let g = c.station.grid.trim();
        match z30_protocol::codec::Grid4::new(&g[..g.len().min(4)]) {
            Ok(sq) if sq.v1_code().is_some() => {
                ui.label(RichText::new(format!("{sq} is in the v1 grid table")).color(Color32::LIGHT_GREEN).small())
            }
            Ok(sq) => ui.label(
                RichText::new(format!(
                    "{sq} is not in the 63-entry v1 grid table: CQ and grid replies will be refused (reports and 73 still work)"
                ))
                .color(Color32::YELLOW)
                .small(),
            ),
            Err(_) => ui.label(""),
        };
        ui.end_row();
        ui.label("Region");
        egui::ComboBox::from_id_salt("region").selected_text(c.station.region.map(|r| r.display_name()).unwrap_or("not set")).show_ui(
            ui,
            |ui| {
                for r in [Region::Us, Region::IaruR1, Region::IaruR2, Region::IaruR3] {
                    ui.selectable_value(&mut c.station.region, Some(r), r.display_name());
                }
            },
        );
        ui.end_row();
        ui.label("Licence class");
        egui::ComboBox::from_id_salt("class")
            .selected_text(c.station.license_class.map(|l| format!("{l:?}")).unwrap_or("not set".into()))
            .show_ui(ui, |ui| {
                let classes: Vec<LicenseClass> = c.station.region.map(|r| r.license_classes().to_vec()).unwrap_or_default();
                for l in classes {
                    ui.selectable_value(&mut c.station.license_class, Some(l), format!("{l:?}"));
                }
            });
        ui.end_row();
        ui.label("TX power you set (W)");
        let mut p = c.station.configured_tx_power_w.unwrap_or(0.0);
        if ui.add(egui::DragValue::new(&mut p).range(0.0..=1500.0)).changed() {
            c.station.configured_tx_power_w = Some(p);
        }
        ui.end_row();
    });
    ui.separator();
    ui.heading("Operating");
    egui::Grid::new("op").num_columns(2).show(ui, |ui| {
        ui.label("Dial (Hz, USB)");
        ui.add(egui::DragValue::new(&mut c.operating.dial_hz).speed(100.0));
        ui.end_row();
        ui.label("TX audio (tone 0, Hz)");
        ui.add(egui::DragValue::new(&mut c.operating.tx_audio_hz).range(200.0..=2750.0));
        ui.end_row();
        ui.label("TX slot");
        ui.horizontal(|ui| {
            ui.radio_value(&mut c.operating.tx_slot, TxSlot::Even, "even (:00)");
            ui.radio_value(&mut c.operating.tx_slot, TxSlot::Odd, "odd (:30)");
        });
        ui.end_row();
        ui.label("Auto-sequence / auto-log");
        ui.horizontal(|ui| {
            ui.checkbox(&mut c.operating.auto_sequence, "sequence");
            ui.checkbox(&mut c.operating.auto_log, "log");
        });
        ui.end_row();
        ui.label("Stop after unanswered TX");
        ui.add(egui::DragValue::new(&mut c.operating.watchdog_cycles).range(1..=30));
        ui.end_row();
    });
    ui.separator();
    ui.heading("Audio");
    for (label, list, slot) in [("Input", &devices.0, &mut c.audio.input_device), ("Output", &devices.1, &mut c.audio.output_device)] {
        ui.horizontal(|ui| {
            ui.label(label);
            egui::ComboBox::from_id_salt(label).width(360.0).selected_text(slot.clone().unwrap_or("system default".into())).show_ui(
                ui,
                |ui| {
                    ui.selectable_value(slot, None, "system default");
                    for d in list {
                        ui.selectable_value(slot, Some(d.clone()), d);
                    }
                },
            );
        });
    }
    ui.horizontal(|ui| {
        ui.label("TX level");
        ui.add(egui::Slider::new(&mut c.audio.tx_level, 0.0..=1.0));
    });
    ui.separator();
    ui.heading("Rig and PTT");
    ui.horizontal(|ui| {
        ui.label("rigctld host");
        ui.text_edit_singleline(&mut c.rig.rigctld_host);
        ui.label("port");
        ui.add(egui::DragValue::new(&mut c.rig.rigctld_port));
    });
    let kind = match &c.ptt {
        PttConfig::None => 0,
        PttConfig::Vox => 1,
        PttConfig::Cat => 2,
        PttConfig::Serial { .. } => 3,
        PttConfig::Cm108 { .. } => 4,
    };
    let mut k = kind;
    ui.horizontal(|ui| {
        ui.label("PTT");
        for (i, n) in ["none", "VOX", "CAT (rigctld)", "RTS/DTR", "CM108"].iter().enumerate() {
            ui.radio_value(&mut k, i, *n);
        }
    });
    if k != kind {
        c.ptt = match k {
            1 => PttConfig::Vox,
            2 => PttConfig::Cat,
            3 => PttConfig::Serial { port: ports.first().cloned().unwrap_or_default(), line: SerialLine::Rts, active_high: true },
            4 => PttConfig::Cm108 { device: String::new(), pin: 3, active_high: true },
            _ => PttConfig::None,
        };
    }
    match &mut c.ptt {
        PttConfig::Serial { port, line, active_high } => {
            ui.horizontal(|ui| {
                egui::ComboBox::from_id_salt("port").selected_text(port.clone()).show_ui(ui, |ui| {
                    for p in ports {
                        ui.selectable_value(port, p.clone(), p);
                    }
                });
                ui.radio_value(line, SerialLine::Rts, "RTS");
                ui.radio_value(line, SerialLine::Dtr, "DTR");
                ui.checkbox(active_high, "active high");
            });
        }
        PttConfig::Cm108 { pin, active_high, .. } => {
            ui.horizontal(|ui| {
                ui.label("GPIO");
                ui.add(egui::DragValue::new(pin).range(1..=8));
                ui.checkbox(active_high, "active high");
                ui.label(
                    RichText::new("Enable the radio's TX time-out: a CM108 GPIO stays set if the computer crashes.")
                        .small()
                        .color(Color32::YELLOW),
                );
            });
        }
        _ => {}
    }
    ui.separator();
    ui.heading("Receiver");
    ui.checkbox(&mut c.receiver.ap_enabled, "A priori decoding (decodes it recovers are marked a1-a6)");
    ui.horizontal(|ui| {
        ui.label("Drift search (Hz)");
        ui.add(egui::DragValue::new(&mut c.receiver.max_drift_hz).range(0.0..=8.0));
        ui.label("Passes (SIC)");
        ui.add(egui::DragValue::new(&mut c.receiver.passes).range(1..=3));
    });
    ui.separator();
    ui.button("Apply and save").clicked()
}
