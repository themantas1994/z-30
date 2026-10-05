//! Native audio through cpal (ALSA - which PipeWire and PulseAudio serve on Linux - WASAPI on
//! Windows, CoreAudio on macOS).
//!
//! The capture callback does three things and returns: copies channel 0 into a lock-free SPSC
//! ring, pushes one (first sample index, count, capture UTC) stamp into a second ring, and bumps
//! atomic counters. No allocation, no lock, no logging, no DSP (audit E; directive section 15).
//! `InputCallbackState::on_data` is that body, separated so a test can run it under a counting
//! allocator. The DSP thread drains the rings through `AudioInput::next_block`.
//!
//! The playback callback likewise only pops from a lock-free ring and writes the device buffer;
//! its body is `OutputCallbackState::on_data`, under the same allocation test. A device error on
//! the output is recorded and surfaced through `AudioOutput::failure`, so the runtime stops the
//! transmission and refuses the next one; it used to be discarded (`|_err| {}`), and a dead
//! output keyed the radio with no audio every slot (2026-09-28 audit F-19).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use z30_engine::pipeline::AudioBlock;
use z30_engine::runtime::{AudioInput, AudioOutput, OutputStopper};

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
    crate::wallclock::system_utc()
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
    name: String,
}

/// Names of the input and output devices of the default host.
pub fn list_devices() -> (Vec<String>, Vec<String>) {
    let host = cpal::default_host();
    let name = |d: &cpal::Device| d.description().map(|x| x.to_string()).unwrap_or_else(|_| d.to_string());
    let ins = host.input_devices().map(|it| it.map(|d| name(&d)).collect()).unwrap_or_default();
    let outs = host.output_devices().map(|it| it.map(|d| name(&d)).collect()).unwrap_or_default();
    (ins, outs)
}

/// Which of `names` the configured `wanted` selects: an exact (case-insensitive) name match,
/// else the one and only name containing it. Two or more candidates is an error naming them, not
/// the first one found: with two interfaces attached (a radio and a headset, two radios) the
/// first substring match fed the wrong one (2026-09-28 audit F-43).
pub fn select_device(names: &[String], wanted: &str) -> Result<usize, String> {
    let w = wanted.trim().to_lowercase();
    let exact: Vec<usize> = (0..names.len()).filter(|&i| names[i].trim().to_lowercase() == w).collect();
    if exact.len() == 1 {
        return Ok(exact[0]);
    }
    let partial: Vec<usize> = (0..names.len()).filter(|&i| names[i].to_lowercase().contains(&w)).collect();
    let candidates = if exact.len() > 1 { exact } else { partial };
    match candidates.as_slice() {
        [one] => Ok(*one),
        [] => Err(format!("no audio device matching \"{wanted}\"")),
        many => Err(format!(
            "\"{wanted}\" matches {} audio devices ({}); set the full name of the one to use",
            many.len(),
            many.iter().map(|&i| format!("\"{}\"", names[i])).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn device_name(d: &cpal::Device) -> String {
    d.description().map(|x| x.to_string()).unwrap_or_else(|_| d.to_string())
}

fn find_device(input: bool, wanted: Option<&str>) -> Result<(cpal::Device, String), String> {
    let host = cpal::default_host();
    let Some(w) = wanted.filter(|w| !w.is_empty()) else {
        let d = if input { host.default_input_device() } else { host.default_output_device() }
            .ok_or_else(|| "no default audio device".to_string())?;
        let name = device_name(&d);
        return Ok((d, name));
    };
    let devices: Vec<cpal::Device> = if input { host.input_devices() } else { host.output_devices() }.map_err(|e| e.to_string())?.collect();
    let names: Vec<String> = devices.iter().map(device_name).collect();
    let i = select_device(&names, w)?;
    let name = names[i].clone();
    Ok((devices.into_iter().nth(i).expect("index from the same list"), name))
}

/// The name of the device the configured `wanted` selects (the default device when None),
/// without opening it: for diagnostics, so the operator sees which interface would be used.
pub fn resolve_device_name(input: bool, wanted: Option<&str>) -> Result<String, String> {
    find_device(input, wanted).map(|(_, name)| name)
}

impl CpalInput {
    /// Opens `device` (substring match; None = default) at its default rate, f32 samples.
    pub fn open(device: Option<&str>) -> Result<Self, String> {
        let (dev, name) = find_device(true, device)?;
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
        Ok(CpalInput { _stream: stream, rings, rate, failed, counters, name })
    }

    /// The device actually opened (for diagnostics).
    pub fn device_name(&self) -> &str {
        &self.name
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

/// Playback state shared with the output callback and with any thread that must stop it.
pub struct OutputShared {
    flush: AtomicBool,
    latency_ns: AtomicU64,
    failed: AtomicBool,
    error: Mutex<Option<String>>,
}

impl OutputShared {
    fn new() -> Self {
        OutputShared {
            flush: AtomicBool::new(false),
            latency_ns: AtomicU64::new(0),
            failed: AtomicBool::new(false),
            error: Mutex::new(None),
        }
    }

    /// Asks the callback to discard everything queued at its next run. Lock-free; any thread.
    pub fn request_flush(&self) {
        self.flush.store(true, Ordering::Release);
    }

    /// Records a device error (from cpal's error callback, not the data callback).
    pub fn record_error(&self, e: String) {
        self.failed.store(true, Ordering::SeqCst);
        if let Ok(mut g) = self.error.try_lock() {
            g.get_or_insert(e);
        }
    }

    fn failure(&self) -> Option<String> {
        self.failed
            .load(Ordering::SeqCst)
            .then(|| self.error.lock().ok().and_then(|g| g.clone()).unwrap_or_else(|| "the audio output device reported an error".into()))
    }
}

/// The playback callback's state: a ring consumer and the shared flags. Everything is
/// preallocated; `on_data` is the whole real-time body.
pub struct OutputCallbackState {
    consumer: rtrb::Consumer<f32>,
    shared: Arc<OutputShared>,
    channels: usize,
}

/// Builds the playback ring: the producer `play` pushes into, the callback state, and the flags.
pub fn output_ring(capacity: usize, channels: usize) -> (rtrb::Producer<f32>, OutputCallbackState, Arc<OutputShared>) {
    let (producer, consumer) = rtrb::RingBuffer::<f32>::new(capacity);
    let shared = Arc::new(OutputShared::new());
    (producer, OutputCallbackState { consumer, shared: shared.clone(), channels: channels.max(1) }, shared)
}

impl OutputCallbackState {
    /// The real-time body: honour a flush, then fill `out` (interleaved) from the ring, the same
    /// sample on every channel (the radio's input is mono), silence when the ring is empty.
    #[inline]
    pub fn on_data(&mut self, out: &mut [f32], latency_ns: u64) {
        self.shared.latency_ns.store(latency_ns, Ordering::Relaxed);
        if self.shared.flush.swap(false, Ordering::AcqRel) {
            let n = self.consumer.slots();
            if let Ok(c) = self.consumer.read_chunk(n) {
                c.commit_all();
            }
        }
        for frame in out.chunks_exact_mut(self.channels) {
            let v = self.consumer.pop().unwrap_or(0.0);
            for s in frame.iter_mut() {
                *s = v;
            }
        }
    }
}

/// A playback device.
pub struct CpalOutput {
    _stream: cpal::Stream,
    producer: rtrb::Producer<f32>,
    shared: Arc<OutputShared>,
    rate: u32,
    /// The configured name (None = system default), for `recover`.
    wanted: Option<String>,
    name: String,
}

impl CpalOutput {
    /// Opens `device` (exact name, or a substring only one device matches; None = default).
    pub fn open(device: Option<&str>) -> Result<Self, String> {
        let (dev, name) = find_device(false, device)?;
        let supported = dev.default_output_config().map_err(|e| e.to_string())?;
        let rate = supported.sample_rate();
        let channels = supported.channels() as usize;
        let config: cpal::StreamConfig = supported.into();
        // A whole frame plus margin at the device rate: `play` never blocks.
        let (producer, mut state, shared) = output_ring(rate as usize * 30, channels);
        let s2 = shared.clone();
        let stream = dev
            .build_output_stream::<f32, _, _>(
                config,
                move |out: &mut [f32], info: &cpal::OutputCallbackInfo| {
                    let ts = info.timestamp();
                    state.on_data(out, ts.playback.duration_since(ts.callback).as_nanos() as u64);
                },
                move |err| s2.record_error(err.to_string()),
                None,
            )
            .map_err(|e| format!("cannot open output (f32 at {rate} Hz): {e}"))?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(CpalOutput { _stream: stream, producer, shared, rate, wanted: device.map(str::to_string), name })
    }

    /// The device actually opened (for diagnostics).
    pub fn device_name(&self) -> &str {
        &self.name
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
        self.shared.request_flush();
    }

    fn queued_samples(&self) -> Option<usize> {
        Some(self.producer.buffer().capacity() - self.producer.slots())
    }

    fn failure(&self) -> Option<String> {
        self.shared.failure()
    }

    fn recover(&mut self) -> Result<(), String> {
        let fresh = CpalOutput::open(self.wanted.as_deref())?;
        if fresh.rate != self.rate {
            // The runtime synthesised for the old rate; a different rate is a different device.
            return Err(format!("the output reopened at {} Hz, not {} Hz; restart the station", fresh.rate, self.rate));
        }
        *self = fresh;
        Ok(())
    }

    fn stopper(&self) -> Option<OutputStopper> {
        let shared = self.shared.clone();
        Some(Arc::new(move || shared.request_flush()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f43_an_ambiguous_device_name_is_refused_not_resolved_to_the_first_match() {
        let names: Vec<String> =
            ["USB Audio CODEC (radio 1)", "USB Audio CODEC (radio 2)", "Built-in Audio", "USB Audio"].map(String::from).to_vec();
        let e = select_device(&names, "codec").unwrap_err();
        assert!(e.contains("matches 2") && e.contains("radio 1") && e.contains("radio 2"), "{e}");
        assert_eq!(select_device(&names, "radio 2"), Ok(1));
        assert_eq!(select_device(&names, "built-in"), Ok(2));
        // An exact name wins even when it is a substring of others.
        assert_eq!(select_device(&names, "usb audio"), Ok(3));
        assert!(select_device(&names, "nothing").unwrap_err().contains("no audio device"));
        // Two identical interfaces (two of the same USB codec is common) share one exact name:
        // that is ambiguous too, not "the first" (transmit-safety audit T-4).
        let twins: Vec<String> = ["USB Audio CODEC", "USB Audio CODEC", "Built-in Audio"].map(String::from).to_vec();
        let e = select_device(&twins, "usb audio codec").unwrap_err();
        assert!(e.contains("matches 2"), "{e}");
    }

    #[test]
    fn f19_an_output_error_is_recorded_and_a_flush_empties_the_ring() {
        let (mut prod, mut cb, shared) = output_ring(1000, 2);
        assert_eq!(shared.failure(), None);
        let _ = prod.push_partial_slice(&[0.5; 600]);
        shared.request_flush();
        let mut out = [1.0f32; 8];
        cb.on_data(&mut out, 0);
        assert!(out.iter().all(|v| *v == 0.0), "flushed: silence, not the queued frame");
        assert_eq!(prod.slots(), 1000);
        shared.record_error("device unplugged".into());
        assert_eq!(shared.failure().as_deref(), Some("device unplugged"));
    }
}
