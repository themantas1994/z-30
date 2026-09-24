//! The receive pipeline between the audio callback's ring and the decoder: resample to the DSP
//! rate, file samples by absolute sample index, keep the sample-clock model, and ask the
//! scheduler for complete slot windows. Also produces waterfall rows. No threads, no I/O: the
//! runtime drives it from its DSP thread, the tests drive it directly.

use crate::clock::{Observation, SampleClock};
use crate::slots::{SlotEvent, SlotScheduler, SlotStore};
use realfft_lite::Waterfall;
use z30_dsp::resample::Resampler;
use z30_dsp::DSP_RATE_HZ;

/// A block of device samples as the audio adapter delivers it.
#[derive(Clone, Debug)]
pub struct AudioBlock {
    /// Device sample index of `samples[0]` since the stream started (the adapter counts every
    /// sample the device produced, including any it had to drop).
    pub first_index: u64,
    /// Mono samples at the device rate.
    pub samples: Vec<f32>,
    /// The system's UTC estimate of when `samples[0]` was captured (callback time minus the
    /// device's reported input latency), seconds since the epoch.
    pub capture_utc: f64,
}

/// Store capacity: 70 s at the DSP rate - two full slot windows plus scheduling slack.
pub const STORE_SECONDS: f64 = 70.0;

/// The pipeline.
pub struct RxPipeline {
    in_rate: u32,
    resampler: Option<Resampler>,
    resampled: Vec<f32>,
    clock: SampleClock,
    store: SlotStore,
    scheduler: SlotScheduler,
    expected_next: Option<u64>,
    /// Device index that DSP index `dsp_origin` corresponds to (reset at each epoch).
    device_origin: u64,
    dsp_origin: u64,
    overruns: u64,
    waterfall: Waterfall,
    level_acc: (f64, usize),
}

impl RxPipeline {
    /// A pipeline for a device at `in_rate` Hz.
    pub fn new(in_rate: u32) -> Self {
        RxPipeline {
            in_rate,
            resampler: Self::make_resampler(in_rate),
            resampled: Vec::new(),
            clock: SampleClock::new(DSP_RATE_HZ),
            store: SlotStore::new((STORE_SECONDS * DSP_RATE_HZ) as usize),
            scheduler: SlotScheduler::new(DSP_RATE_HZ),
            expected_next: None,
            device_origin: 0,
            dsp_origin: 0,
            overruns: 0,
            waterfall: Waterfall::new(),
            level_acc: (0.0, 0),
        }
    }

    fn make_resampler(in_rate: u32) -> Option<Resampler> {
        (in_rate != DSP_RATE_HZ as u32).then(|| Resampler::new(in_rate, DSP_RATE_HZ as u32, Some(2850.0)))
    }

    /// The clock model.
    pub fn clock(&self) -> &SampleClock {
        &self.clock
    }

    /// Device samples lost, cumulative.
    pub fn overruns(&self) -> u64 {
        self.overruns
    }

    /// Mean-square input level since the last call, dBFS.
    pub fn take_level_dbfs(&mut self) -> Option<f64> {
        let (s, n) = std::mem::take(&mut self.level_acc);
        (n > 0).then(|| 10.0 * (s / n as f64).max(1e-12).log10())
    }

    /// Waterfall rows produced since the last call (dB, 1.46 Hz bins from 0 Hz).
    pub fn take_waterfall_rows(&mut self) -> Vec<Vec<f32>> {
        self.waterfall.take_rows()
    }

    /// Feeds one block; returns the slots it completed.
    pub fn push(&mut self, block: &AudioBlock) -> Vec<SlotEvent> {
        if let Some(exp) = self.expected_next {
            if block.first_index != exp {
                // Samples were dropped (or the stream restarted): a discontinuity. Start a new
                // epoch so no slot window spans the gap, and restart the resampler so its state
                // does not smear audio from before the gap into after it.
                self.overruns += block.first_index.saturating_sub(exp);
                let gap_dsp = (block.first_index.saturating_sub(exp) as f64 / self.in_rate as f64 * DSP_RATE_HZ).round() as u64;
                let new_dsp = self.store.end() + gap_dsp;
                self.store.skip_to(new_dsp);
                self.resampler = Self::make_resampler(self.in_rate);
                self.device_origin = block.first_index;
                self.dsp_origin = new_dsp;
                self.clock.new_epoch(new_dsp);
            }
        }
        self.expected_next = Some(block.first_index + block.samples.len() as u64);
        for &v in &block.samples {
            self.level_acc.0 += (v as f64) * (v as f64);
        }
        self.level_acc.1 += block.samples.len();

        let dsp_first = self.store.end();
        self.resampled.clear();
        match self.resampler.as_mut() {
            Some(r) => r.process(&block.samples, &mut self.resampled),
            None => self.resampled.extend_from_slice(&block.samples),
        }
        // UTC of the first new DSP sample: the device index it is centred on, placed relative
        // to this block's capture time at the nominal device rate (the fit absorbs the drift).
        let (ratio, delay) = self.resampler.as_ref().map_or((1.0, 0.0), |r| (r.ratio(), r.input_delay()));
        let device_pos = self.device_origin as f64 + (dsp_first - self.dsp_origin) as f64 * ratio + delay;
        let utc = block.capture_utc + (device_pos - block.first_index as f64) / self.in_rate as f64;
        if !self.resampled.is_empty() {
            self.clock.observe(Observation { index: dsp_first, utc });
        }
        self.store.push(&self.resampled);
        self.waterfall.push(&self.resampled);
        self.scheduler.poll(&self.clock, &self.store)
    }
}

/// A small waterfall front end over the DSP-rate stream.
mod realfft_lite {
    use rustfft::num_complex::Complex32;
    use rustfft::{Fft, FftPlanner};
    use std::sync::Arc;

    const N: usize = 4096;
    const HOP: usize = 1500;
    /// Rows kept if nobody takes them (the GUI takes them every frame).
    const MAX_PENDING: usize = 64;

    pub struct Waterfall {
        fft: Arc<dyn Fft<f32>>,
        window: Vec<f32>,
        buf: Vec<f32>,
        rows: Vec<Vec<f32>>,
    }

    impl Waterfall {
        pub fn new() -> Self {
            let window = (0..N).map(|i| (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / N as f64).cos()) as f32).collect();
            Waterfall { fft: FftPlanner::new().plan_fft_forward(N), window, buf: Vec::new(), rows: Vec::new() }
        }

        pub fn push(&mut self, x: &[f32]) {
            self.buf.extend_from_slice(x);
            while self.buf.len() >= N {
                let mut c: Vec<Complex32> = self.buf[..N].iter().zip(&self.window).map(|(&v, &w)| Complex32::new(v * w, 0.0)).collect();
                self.fft.process(&mut c);
                let row = c[..N / 2].iter().map(|z| 10.0 * (z.norm_sqr() + 1e-20).log10()).collect();
                if self.rows.len() < MAX_PENDING {
                    self.rows.push(row);
                }
                self.buf.drain(..HOP);
            }
        }

        pub fn take_rows(&mut self) -> Vec<Vec<f32>> {
            std::mem::take(&mut self.rows)
        }
    }
}
