//! Native audio through cpal (ALSA - which PipeWire and PulseAudio serve on Linux - WASAPI on
//! Windows, CoreAudio on macOS).
//!
//! The capture callback does three things and returns: copies channel 0 into a lock-free SPSC
//! ring, pushes one (first sample index, count, capture UTC) stamp into a second ring, and bumps
//! atomic counters. No allocation, no lock, no logging, no DSP (audit E; directive section 15).
//! `InputCallbackState::on_data` is that body, separated so a test can run it under a counting
//! allocator. The DSP thread drains the rings through `AudioInput::next_block`.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use z30_engine::pipeline::AudioBlock;
use z30_engine::runtime::{AudioInput, AudioOutput};

/// Seconds of capture the ring holds before it overruns.
pub const INPUT_RING_SECONDS: usize = 20;

/// One callback's stamp.
#[derive(Clone, Copy, Debug)]
pub struct Stamp {
    /// Device frame index of the first frame written.
    pub first_index: u64,
    /// Frames written.
    pub count: u32,
    /// UTC of the first frame's capture.
    pub capture_utc: f64,
}

/// The capture callback's state. Everything is preallocated.
pub struct InputCallbackState {
    samples: rtrb::Producer<f32>,
    stamps: rtrb::Producer<Stamp>,
    channels: usize,
    next_index: u64,
    overruns: Arc<AtomicU64>,
    callbacks: Arc<AtomicU64>,
}

/// The consumer side.
pub struct InputRings {
    samples: rtrb::Consumer<f32>,
    stamps: rtrb::Consumer<Stamp>,
}

/// Counters shared with the application.
#[derive(Clone, Default)]
pub struct InputCounters {
    /// Frames dropped because the ring was full.
    pub overruns: Arc<AtomicU64>,
    /// Callbacks received.
    pub callbacks: Arc<AtomicU64>,
}

/// Builds the callback state and its consumer for `rate` Hz and `channels` channels.
pub fn input_rings(rate: u32, channels: usize) -> (InputCallbackState, InputRings, InputCounters) {
    let (sp, sc) = rtrb::RingBuffer::new(rate as usize * INPUT_RING_SECONDS);
    let (tp, tc) = rtrb::RingBuffer::new(8192);
    let counters = InputCounters::default();
    (
        InputCallbackState {
            samples: sp,
            stamps: tp,
            channels: channels.max(1),
            next_index: 0,
            overruns: counters.overruns.clone(),
            callbacks: counters.callbacks.clone(),
        },
        InputRings { samples: sc, stamps: tc },
        counters,
    )
}

impl InputCallbackState {
    /// The real-time body. `data` is interleaved; channel 0 is taken.
    #[inline]
    pub fn on_data(&mut self, data: &[f32], capture_utc: f64) {
        let frames = data.len() / self.channels;
        let first = self.next_index;
        self.next_index += frames as u64;
        self.callbacks.fetch_add(1, Ordering::Relaxed);
        // All-or-nothing per callback, so every sample in the ring has a stamp and a gap is a
        // gap in the stamps' indices, which the pipeline turns into a new clock epoch.
        if self.stamps.slots() == 0 || self.samples.slots() < frames {
            self.overruns.fetch_add(frames as u64, Ordering::Relaxed);
            return;
        }
        if let Ok(chunk) = self.samples.write_chunk_uninit(frames) {
            chunk.fill_from_iter(data.chunks_exact(self.channels).map(|f| f[0]));
        }
        let _ = self.stamps.push(Stamp { first_index: first, count: frames as u32, capture_utc });
    }
}

fn utc_now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

impl InputRings {
    /// Drains whole callbacks into one block of at most `max_frames` (or one callback, if a
    /// single callback is larger), stopping at any gap so a block is always contiguous.
    pub fn take_block(&mut self, max_frames: usize) -> Option<AudioBlock> {
        let first = *self.stamps.peek().ok()?;
        let mut block =
            AudioBlock { first_index: first.first_index, samples: Vec::with_capacity(max_frames), capture_utc: first.capture_utc };
        while let Ok(s) = self.stamps.peek() {
            let s = *s;
            let contiguous = s.first_index == block.first_index + block.samples.len() as u64;
            let fits = block.samples.is_empty() || block.samples.len() + s.count as usize <= max_frames;
            if !contiguous || !fits {
                break;
            }
            let _ = self.stamps.pop();
            if let Ok(chunk) = self.samples.read_chunk(s.count as usize) {
                let (a, b) = chunk.as_slices();
                block.samples.extend_from_slice(a);
                block.samples.extend_from_slice(b);
                chunk.commit_all();
            }
        }
        Some(block)
    }
}

/// A capture device.
pub struct CpalInput {
    _stream: cpal::Stream,
    rings: InputRings,
    rate: u32,
    failed: Arc<AtomicBool>,
    /// Counters.
    pub counters: InputCounters,
}

/// Names of the input and output devices of the default host.
pub fn list_devices() -> (Vec<String>, Vec<String>) {
    let host = cpal::default_host();
    let name = |d: &cpal::Device| d.description().map(|x| x.to_string()).unwrap_or_else(|_| d.to_string());
    let ins = host.input_devices().map(|it| it.map(|d| name(&d)).collect()).unwrap_or_default();
    let outs = host.output_devices().map(|it| it.map(|d| name(&d)).collect()).unwrap_or_default();
    (ins, outs)
}

fn find_device(input: bool, wanted: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    let Some(w) = wanted.filter(|w| !w.is_empty()) else {
        return if input { host.default_input_device() } else { host.default_output_device() }
            .ok_or_else(|| "no default audio device".to_string());
    };
    let devices: Vec<cpal::Device> = if input { host.input_devices() } else { host.output_devices() }.map_err(|e| e.to_string())?.collect();
    let w = w.to_lowercase();
    devices
        .into_iter()
        .find(|d| d.description().map(|x| x.to_string()).unwrap_or_else(|_| d.to_string()).to_lowercase().contains(&w))
        .ok_or_else(|| format!("no audio device matching \"{w}\""))
}

impl CpalInput {
    /// Opens `device` (substring match; None = default) at its default rate, f32 samples.
    pub fn open(device: Option<&str>) -> Result<Self, String> {
        let dev = find_device(true, device)?;
        let supported = dev.default_input_config().map_err(|e| e.to_string())?;
        let rate = supported.sample_rate();
        let channels = supported.channels() as usize;
        let config: cpal::StreamConfig = supported.into();
        let (mut state, rings, counters) = input_rings(rate, channels);
        let failed = Arc::new(AtomicBool::new(false));
        let f2 = failed.clone();
        let stream = dev
            .build_input_stream::<f32, _, _>(
                config,
                move |data: &[f32], info: &cpal::InputCallbackInfo| {
                    let ts = info.timestamp();
                    let latency = ts.callback.duration_since(ts.capture).as_secs_f64();
                    state.on_data(data, utc_now() - latency);
                },
                move |_err| f2.store(true, Ordering::SeqCst),
                None,
            )
            .map_err(|e| format!("cannot open input (f32 at {rate} Hz): {e}"))?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(CpalInput { _stream: stream, rings, rate, failed, counters })
    }
}

impl AudioInput for CpalInput {
    fn sample_rate(&self) -> u32 {
        self.rate
    }

    fn next_block(&mut self, timeout: Duration) -> Result<Option<AudioBlock>, String> {
        if self.failed.load(Ordering::SeqCst) {
            return Err("audio input device reported an error".into());
        }
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Some(b) = self.rings.take_block(self.rate as usize / 10) {
                return Ok(Some(b));
            }
            if std::time::Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

/// Playback state shared with the output callback.
struct OutputShared {
    flush: AtomicBool,
    latency_ns: AtomicU64,
}

/// A playback device.
pub struct CpalOutput {
    _stream: cpal::Stream,
    producer: rtrb::Producer<f32>,
    shared: Arc<OutputShared>,
    rate: u32,
}

impl CpalOutput {
    /// Opens `device` (substring; None = default).
    pub fn open(device: Option<&str>) -> Result<Self, String> {
        let dev = find_device(false, device)?;
        let supported = dev.default_output_config().map_err(|e| e.to_string())?;
        let rate = supported.sample_rate();
        let channels = supported.channels() as usize;
        let config: cpal::StreamConfig = supported.into();
        // A whole frame plus margin at the device rate: `play` never blocks.
        let (producer, mut consumer) = rtrb::RingBuffer::<f32>::new(rate as usize * 30);
        let shared = Arc::new(OutputShared { flush: AtomicBool::new(false), latency_ns: AtomicU64::new(0) });
        let s2 = shared.clone();
        let stream = dev
            .build_output_stream::<f32, _, _>(
                config,
                move |out: &mut [f32], info: &cpal::OutputCallbackInfo| {
                    let ts = info.timestamp();
                    s2.latency_ns.store(ts.playback.duration_since(ts.callback).as_nanos() as u64, Ordering::Relaxed);
                    if s2.flush.swap(false, Ordering::AcqRel) {
                        let n = consumer.slots();
                        if let Ok(c) = consumer.read_chunk(n) {
                            c.commit_all();
                        }
                    }
                    for frame in out.chunks_exact_mut(channels) {
                        // The same sample on every channel: the radio's input is mono.
                        let v = consumer.pop().unwrap_or(0.0);
                        for s in frame.iter_mut() {
                            *s = v;
                        }
                    }
                },
                |_err| {},
                None,
            )
            .map_err(|e| format!("cannot open output (f32 at {rate} Hz): {e}"))?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(CpalOutput { _stream: stream, producer, shared, rate })
    }
}

impl AudioOutput for CpalOutput {
    fn sample_rate(&self) -> u32 {
        self.rate
    }

    fn latency_sec(&self) -> f64 {
        self.shared.latency_ns.load(Ordering::Relaxed) as f64 * 1e-9
    }

    fn play(&mut self, samples: Vec<f32>) -> Result<(), String> {
        let (_, rest) = self.producer.push_partial_slice(&samples);
        if rest.is_empty() {
            Ok(())
        } else {
            Err("output ring full".into())
        }
    }

    fn stop(&mut self) {
        self.shared.flush.store(true, Ordering::Release);
    }
}
