//! z-30 desktop GUI.
//!
//! Renders `EngineSnapshot`s and sends `Command`s. It owns no radio state and runs no DSP; the
//! engine's threads keep running whatever the window does, and nothing here waits on them.

mod app;
mod waterfall;

fn main() -> eframe::Result {
    z30_engine::ptt::install_panic_release();
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_title("z-30").with_inner_size([1280.0, 820.0]).with_min_inner_size([900.0, 600.0]),
        ..Default::default()
    };
    eframe::run_native("z-30", options, Box::new(|cc| Ok(Box::new(app::App::new(cc)))))
}
