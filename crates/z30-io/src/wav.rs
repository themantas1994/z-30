//! WAV files: reading recordings for offline decoding, writing captured slots and TX audio, and
//! an `AudioInput` that plays a recording into the runtime on a virtual clock.

use std::path::Path;
use std::time::Duration;
use z30_engine::pipeline::AudioBlock;
use z30_engine::runtime::AudioInput;

/// Reads a WAV as mono f32 (channel 0) and its sample rate.
pub fn read_mono(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let mut r = hound::WavReader::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let spec = r.spec();
    let ch = spec.channels as usize;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>().map_err(|e| e.to_string())?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.map(|v| v as f32 * scale)).collect::<Result<_, _>>().map_err(|e| e.to_string())?
        }
    };
    Ok((samples.chunks_exact(ch).map(|f| f[0]).collect(), spec.sample_rate))
}

/// Writes mono f32 samples.
pub fn write_mono(path: &Path, samples: &[f32], rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| format!("{}: {e}", path.display()))?;
    for &s in samples {
        w.write_sample(s).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}

/// A recording played into the runtime, stamped as if captured from `start_utc`.
pub struct WavInput {
    samples: Vec<f32>,
    rate: u32,
    pos: usize,
    start_utc: f64,
    realtime: bool,
    started: std::time::Instant,
}

impl WavInput {
    /// A recording whose first sample was captured at `start_utc`. `realtime` paces delivery at
    /// the recording's rate; otherwise it is delivered as fast as it is consumed.
    pub fn new(samples: Vec<f32>, rate: u32, start_utc: f64, realtime: bool) -> Self {
        WavInput { samples, rate, pos: 0, start_utc, realtime, started: std::time::Instant::now() }
    }
}

impl AudioInput for WavInput {
    fn sample_rate(&self) -> u32 {
        self.rate
    }

    fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String> {
        if self.pos >= self.samples.len() {
            std::thread::sleep(timeout);
            return Ok(None);
        }
        let n = (self.rate as usize / 10).min(self.samples.len() - self.pos);
        if self.realtime {
            let due = self.pos as f64 / self.rate as f64;
            let now = self.started.elapsed().as_secs_f64();
            if due > now {
                std::thread::sleep(Duration::from_secs_f64((due - now).min(timeout.as_secs_f64())));
                return Ok(None);
            }
        }
        let block = AudioBlock {
            first_index: self.pos as u64,
            samples: self.samples[self.pos..self.pos + n].to_vec(),
            capture_utc: self.start_utc + self.pos as f64 / self.rate as f64,
        };
        self.pos += n;
        Ok(Some(block))
    }
}
