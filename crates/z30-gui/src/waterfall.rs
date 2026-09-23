//! The waterfall: rows of dB from the engine's DSP thread become a scrolling texture. One texture
//! upload per frame, no DSP here beyond colouring.

use egui::{Color32, ColorImage, TextureHandle, TextureOptions};

/// Displayed width in pixels (0..3000 Hz).
pub const WIDTH: usize = 1024;
/// Rows kept.
pub const HEIGHT: usize = 240;
/// Hz covered by the display.
pub const SPAN_HZ: f32 = 3000.0;

/// Scrolling image state.
pub struct Waterfall {
    pixels: Vec<Color32>,
    texture: Option<TextureHandle>,
    floor_db: f32,
    dirty: bool,
}

fn palette(x: f32) -> Color32 {
    // Dark blue -> cyan -> yellow -> white.
    let x = x.clamp(0.0, 1.0);
    let (r, g, b) = if x < 0.33 {
        let t = x / 0.33;
        (0.0, 0.2 * t, 0.25 + 0.55 * t)
    } else if x < 0.66 {
        let t = (x - 0.33) / 0.33;
        (t, 0.2 + 0.8 * t, 0.8 - 0.6 * t)
    } else {
        let t = (x - 0.66) / 0.34;
        (1.0, 1.0, 0.2 + 0.8 * t)
    };
    Color32::from_rgb((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8)
}

impl Waterfall {
    /// Empty.
    pub fn new() -> Self {
        Waterfall { pixels: vec![Color32::BLACK; WIDTH * HEIGHT], texture: None, floor_db: f32::NAN, dirty: true }
    }

    /// Adds one engine row (dB per 1.46 Hz bin from 0 Hz, 2048 bins = 0..3000 Hz).
    pub fn push(&mut self, row: &[f32]) {
        let bins = row.len().max(1);
        let per_px = bins as f32 * (SPAN_HZ / 3000.0) / WIDTH as f32;
        let mut line = vec![0.0f32; WIDTH];
        for (x, v) in line.iter_mut().enumerate() {
            let a = (x as f32 * per_px) as usize;
            let b = (((x + 1) as f32 * per_px) as usize).clamp(a + 1, bins);
            *v = row[a.min(bins - 1)..b].iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        }
        // Track the noise floor slowly so the display neither blooms nor fades.
        let mut sorted = line.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = sorted[WIDTH / 2];
        self.floor_db = if self.floor_db.is_nan() { median } else { 0.95 * self.floor_db + 0.05 * median };
        self.pixels.copy_within(0..WIDTH * (HEIGHT - 1), WIDTH);
        for (x, v) in line.iter().enumerate() {
            self.pixels[x] = palette((v - self.floor_db + 3.0) / 30.0);
        }
        self.dirty = true;
    }

    /// The texture, uploaded if anything changed since the last frame.
    pub fn texture(&mut self, ctx: &egui::Context) -> &TextureHandle {
        let image = || ColorImage::new([WIDTH, HEIGHT], self.pixels.clone());
        match &mut self.texture {
            Some(t) if self.dirty => t.set(image(), TextureOptions::LINEAR),
            Some(_) => {}
            None => self.texture = Some(ctx.load_texture("waterfall", image(), TextureOptions::LINEAR)),
        }
        self.dirty = false;
        self.texture.as_ref().unwrap()
    }
}
