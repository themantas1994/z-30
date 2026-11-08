//! WAV files: reading recordings for offline decoding, writing captured slots and TX audio, and
//! an `AudioInput` that plays a recording into the runtime on a virtual clock.

use std::path::Path;
use std::time::Duration;
use z30_engine::pipeline::AudioBlock;
use z30_engine::runtime::AudioInput;

/// Reads a WAV as mono f32 (channel 0) and its sample rate.
///
/// Refused, with the file named: a float sample in any channel that is NaN or infinite (it is not
/// audio, and one of them made the decoder's spectra NaN), a sample rate of 0 Hz (hound accepts
/// it when the byte rate is 0 too; at 0 Hz the resampler's step is 0, so it would never advance
/// and its output would grow without bound), integer
/// samples wider than 32 bits (WAVE_FORMAT_EXTENSIBLE's valid-bits field replaces the checked
/// sample size, and the scale overflowed on it), and sample data that ends early. Finite float
/// samples are returned unchanged, beyond full scale included.
pub fn read_mono(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let ctx = |e: String| format!("{}: {e}", path.display());
    let mut r = hound::WavReader::open(path).map_err(|e| ctx(e.to_string()))?;
    let spec = r.spec();
    if spec.sample_rate == 0 {
        return Err(ctx("the header gives a sample rate of 0 Hz".into()));
    }
    // hound refuses a file with no channels.
    let ch = spec.channels as usize;
    let total = r.len();
    // hound reports data that ends early as a plain I/O error ("Failed to read enough bytes."),
    // so where reading stopped is what says the file is short.
    let read_error = |i: usize, e: hound::Error| match e {
        hound::Error::IoError(e) => {
            format!("reading stopped at sample {i} of the {total} its header gives ({e}): the file is truncated or damaged")
        }
        e => format!("sample {i}: {e}"),
    };
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r
            .samples::<f32>()
            .enumerate()
            .map(|(i, s)| match s {
                Ok(v) if v.is_finite() => Ok(v),
                Ok(v) => Err(format!("sample {} of channel {} is {v}: a float WAV must hold finite samples", i / ch, i % ch)),
                Err(e) => Err(read_error(i, e)),
            })
            .collect::<Result<_, _>>()
            .map_err(ctx)?,
        hound::SampleFormat::Int => {
            if !(1..=32).contains(&spec.bits_per_sample) {
                return Err(ctx(format!("{}-bit integer samples are not supported", spec.bits_per_sample)));
            }
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>()
                .enumerate()
                .map(|(i, s)| s.map(|v| v as f32 * scale).map_err(|e| read_error(i, e)))
                .collect::<Result<_, _>>()
                .map_err(ctx)?
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A file in the temporary directory, removed when dropped.
    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            Temp(std::env::temp_dir().join(format!("z30-wav-{}-{tag}.wav", std::process::id())))
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn write_float(path: &Path, channels: u16, samples: &[f32]) {
        let spec = hound::WavSpec { channels, sample_rate: 6000, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for &s in samples {
            w.write_sample(s).unwrap();
        }
        w.finalize().unwrap();
    }

    fn write_int(path: &Path, channels: u16, bits: u16, samples: &[i32]) {
        let spec = hound::WavSpec { channels, sample_rate: 48_000, bits_per_sample: bits, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for &s in samples {
            w.write_sample(s).unwrap();
        }
        w.finalize().unwrap();
    }

    /// The 16 bytes every fmt chunk starts with (PCMWAVEFORMAT).
    fn fmt_chunk(tag: u16, channels: u16, rate: u32, bits: u16) -> Vec<u8> {
        let align = channels * bits / 8;
        let mut f = Vec::new();
        f.extend_from_slice(&tag.to_le_bytes());
        f.extend_from_slice(&channels.to_le_bytes());
        f.extend_from_slice(&rate.to_le_bytes());
        f.extend_from_slice(&(rate * align as u32).to_le_bytes());
        f.extend_from_slice(&align.to_le_bytes());
        f.extend_from_slice(&bits.to_le_bytes());
        f
    }

    /// A WAV assembled byte by byte, for headers hound's writer never produces.
    fn write_raw(path: &Path, fmt: &[u8], data: &[u8]) {
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&((4 + 8 + fmt.len() + 8 + data.len()) as u32).to_le_bytes());
        v.extend_from_slice(b"WAVE");
        v.extend_from_slice(b"fmt ");
        v.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
        v.extend_from_slice(fmt);
        v.extend_from_slice(b"data");
        v.extend_from_slice(&(data.len() as u32).to_le_bytes());
        v.extend_from_slice(data);
        std::fs::write(path, v).unwrap();
    }

    #[test]
    fn a_float_sample_that_is_nan_or_infinite_is_refused_naming_the_file_and_the_sample() {
        for (bad, shown) in [(f32::NAN, "NaN"), (f32::INFINITY, "inf"), (f32::NEG_INFINITY, "-inf")] {
            let f = Temp::new(&format!("nonfinite{shown}"));
            let mut x = vec![0.25f32; 100];
            x[37] = bad;
            write_float(&f.0, 1, &x);
            let err = read_mono(&f.0).expect_err("a non-finite float sample was accepted");
            assert!(err.starts_with(&f.0.display().to_string()), "the error does not name the file: {err}");
            assert!(err.contains(&format!("sample 37 of channel 0 is {shown}")), "{err}");
        }
    }

    #[test]
    fn a_non_finite_sample_is_refused_in_a_channel_that_is_not_decoded_too() {
        // The file is not audio whichever channel holds it; decoding channel 0 of it anyway would
        // treat a corrupt recording as a good one.
        let f = Temp::new("nonfinite-stereo");
        let mut x = vec![0.25f32; 2 * 100];
        x[2 * 10 + 1] = f32::NAN;
        write_float(&f.0, 2, &x);
        let err = read_mono(&f.0).expect_err("a NaN in channel 1 was accepted");
        assert!(err.contains("sample 10 of channel 1 is NaN"), "{err}");
    }

    #[test]
    fn finite_float_samples_are_read_bit_for_bit_beyond_full_scale_included() {
        let x = [0.0f32, -0.0, 0.5, -1.0, 1.0, 1.5, -3.25, f32::MAX, f32::MIN, f32::MIN_POSITIVE, 1e-45];
        let bits = |v: &[f32]| v.iter().map(|s| s.to_bits()).collect::<Vec<_>>();
        let f = Temp::new("finite-mono");
        write_float(&f.0, 1, &x);
        let (got, rate) = read_mono(&f.0).unwrap();
        assert_eq!((bits(&got), rate), (bits(&x), 6000));
        // Stereo: channel 0 is the one returned.
        let f = Temp::new("finite-stereo");
        write_float(&f.0, 2, &x.iter().flat_map(|&v| [v, 9.0]).collect::<Vec<_>>());
        assert_eq!(bits(&read_mono(&f.0).unwrap().0), bits(&x));
    }

    #[test]
    fn integer_files_of_every_supported_depth_read_at_full_scale() {
        for bits in [8u16, 16, 24, 32] {
            let full = 1i64 << (bits - 1);
            let vals: Vec<i32> = [-full, -full / 2, -1, 0, 1, full / 2, full - 1].iter().map(|&v| v as i32).collect();
            let want: Vec<f32> = vals.iter().map(|&v| v as f32 / full as f32).collect();
            for channels in [1u16, 2] {
                let f = Temp::new(&format!("int{bits}-{channels}ch"));
                let interleaved: Vec<i32> = vals.iter().flat_map(|&v| [v, -1].into_iter().take(channels as usize)).collect();
                write_int(&f.0, channels, bits, &interleaved);
                let (got, rate) = read_mono(&f.0).unwrap();
                assert_eq!((&got, rate), (&want, 48_000), "{bits}-bit, {channels} channel(s)");
                assert!(got.iter().all(|v| v.is_finite() && v.abs() <= 1.0), "{bits}-bit: {got:?}");
            }
        }
    }

    #[test]
    fn sample_data_that_ends_early_is_an_error_naming_the_file() {
        for (tag, float) in [("trunc-float", true), ("trunc-int16", false)] {
            let f = Temp::new(tag);
            if float {
                write_float(&f.0, 1, &[0.5; 100]);
            } else {
                write_int(&f.0, 1, 16, &[1000; 100]);
            }
            let file = std::fs::OpenOptions::new().write(true).open(&f.0).unwrap();
            let len = file.metadata().unwrap().len();
            file.set_len(len - 6).unwrap();
            drop(file);
            let err = read_mono(&f.0).expect_err("a truncated file was read");
            assert!(err.starts_with(&f.0.display().to_string()), "the error does not name the file: {err}");
            assert!(err.contains("of the 100 its header gives") && err.contains("truncated"), "{tag}: {err}");
        }
    }

    #[test]
    fn a_header_with_a_sample_rate_of_zero_is_refused() {
        // hound accepts it when the byte rate is 0 as well; the resampler then never advanced.
        let f = Temp::new("rate0");
        write_raw(&f.0, &fmt_chunk(1, 1, 0, 16), &[0u8; 20]);
        let err = read_mono(&f.0).expect_err("a 0 Hz file was accepted");
        assert!(err.starts_with(&f.0.display().to_string()) && err.contains("sample rate of 0 Hz"), "{err}");
    }

    #[test]
    fn integer_samples_wider_than_32_bits_are_refused_not_panicked_on() {
        // WAVE_FORMAT_EXTENSIBLE: hound checks the 32-bit container, then takes the valid-bits
        // field as the sample size, so 100 reaches the reader; the full-scale shift overflowed.
        const KSDATAFORMAT_SUBTYPE_PCM: [u8; 16] = [0x01, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71];
        let mut fmt = fmt_chunk(0xfffe, 1, 6000, 32);
        fmt.extend_from_slice(&22u16.to_le_bytes()); // cbSize
        fmt.extend_from_slice(&100u16.to_le_bytes()); // wValidBitsPerSample
        fmt.extend_from_slice(&4u32.to_le_bytes()); // dwChannelMask
        fmt.extend_from_slice(&KSDATAFORMAT_SUBTYPE_PCM);
        let f = Temp::new("int100");
        write_raw(&f.0, &fmt, &[0u8; 40]);
        let err = read_mono(&f.0).expect_err("100-bit samples were accepted");
        assert!(err.contains("100-bit integer samples are not supported"), "{err}");
    }
}
