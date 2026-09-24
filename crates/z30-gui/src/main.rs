//! z-30 desktop GUI.
//!
//! Renders `EngineSnapshot`s and sends `Command`s. It owns no radio state and runs no DSP; the
//! engine's threads keep running whatever the window does, and nothing here waits on them.

mod app;
mod waterfall;

fn main() -> eframe::Result {
    z30_engine::ptt::install_panic_release();
    // A termination signal ends the process without running a single destructor, so without
    // this a CAT- or CM108-keyed radio would be left transmitting until its own time-out (a
    // serial RTS/DTR line is dropped by the OS; nothing else is). The handler runs on its own
    // thread, not in signal context, so taking the PTT registry's lock is safe.
    if let Err(e) = ctrlc::set_handler(|| {
        z30_engine::ptt::emergency_release_all();
        std::process::exit(143);
    }) {
        eprintln!("z-30: could not install the termination handler ({e}); PTT is still released on panic, on exit and by the watchdog");
    }
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_title("z-30").with_inner_size([1280.0, 820.0]).with_min_inner_size([900.0, 600.0]),
        ..Default::default()
    };
    eframe::run_native("z-30", options, Box::new(|cc| Ok(Box::new(app::App::new(cc)))))
}
