//! Python bindings. The research harness in `research/` imports `z30` and calls
//! `decode_slot` - the same function the desktop engine and the CLI call - so a figure the
//! harness measures is a figure about the shipped receiver. Development tooling only.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyList};
use z30_dsp::ap::{ApContext, ApStage};
use z30_dsp::ldpc::Decoder;
use z30_dsp::slot::{Receiver, RxConfig};
use z30_protocol::codec::{Callsign, Message};

fn bits(b: &[u8]) -> String {
    b.iter().map(|&x| (b'0' + x) as char).collect()
}

fn f32s(buf: &[u8]) -> PyResult<Vec<f32>> {
    if buf.len() % 4 != 0 {
        return Err(PyValueError::new_err("sample buffer length is not a multiple of 4 (expected float32 little-endian)"));
    }
    Ok(buf.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

/// A reusable receiver (FFT plans are built once).
#[pyclass(name = "Receiver")]
struct PyReceiver {
    rx: Receiver,
}

#[pymethods]
impl PyReceiver {
    #[new]
    fn new() -> Self {
        PyReceiver { rx: Receiver::new() }
    }

    /// Decodes one 27 s slot window at 6 kHz, passed as float32 little-endian bytes
    /// (`numpy_array.astype('<f4').tobytes()`). Keyword arguments override RxConfig defaults.
    #[pyo3(signature = (samples, *, band_lo_hz=None, band_hi_hz=None, max_candidates=None, sync_threshold=None, passes=None,
                        max_drift_hz=None, min_fine_sync=None, drift_gain=None, whiten=None, ap_stage=None, my_call=None, dx_call=None, worked_freqs_hz=None))]
    #[allow(clippy::too_many_arguments)]
    fn decode_slot<'py>(
        &self,
        py: Python<'py>,
        samples: &Bound<'py, PyBytes>,
        band_lo_hz: Option<f64>,
        band_hi_hz: Option<f64>,
        max_candidates: Option<usize>,
        sync_threshold: Option<f64>,
        passes: Option<u8>,
        max_drift_hz: Option<f64>,
        min_fine_sync: Option<f64>,
        drift_gain: Option<f64>,
        whiten: Option<bool>,
        ap_stage: Option<String>,
        my_call: Option<String>,
        dx_call: Option<String>,
        worked_freqs_hz: Option<Vec<f64>>,
    ) -> PyResult<Bound<'py, PyDict>> {
        let x = f32s(samples.as_bytes())?;
        if x.len() != z30_dsp::baseband::SLOT_SAMPLES {
            return Err(PyValueError::new_err(format!("a slot window is {} samples, got {}", z30_dsp::baseband::SLOT_SAMPLES, x.len())));
        }
        let mut cfg = RxConfig::default();
        if let Some(v) = band_lo_hz {
            cfg.band_lo_hz = v
        }
        if let Some(v) = band_hi_hz {
            cfg.band_hi_hz = v
        }
        if let Some(v) = max_candidates {
            cfg.max_candidates = v
        }
        if let Some(v) = sync_threshold {
            cfg.sync_threshold = v
        }
        if let Some(v) = passes {
            cfg.passes = v
        }
        if let Some(v) = max_drift_hz {
            cfg.max_drift_hz = v
        }
        if let Some(v) = min_fine_sync {
            cfg.min_fine_sync = v
        }
        if let Some(v) = drift_gain {
            cfg.drift_gain = v
        }
        if let Some(v) = whiten {
            cfg.whiten = v
        }
        if let Some(stage) = ap_stage {
            let stage = ApStage::from_reference_name(&stage).ok_or_else(|| PyValueError::new_err(format!("unknown AP stage {stage}")))?;
            cfg.ap = Some(ApContext {
                stage,
                my_call: my_call.as_deref().and_then(|c| Callsign::new(c).ok()),
                dx_call: dx_call.as_deref().and_then(|c| Callsign::new(c).ok()),
                worked_freqs_hz: worked_freqs_hz.unwrap_or_default(),
            });
        }
        let report = py.allow_threads(|| self.rx.decode_slot(&x, &cfg));
        let out = PyDict::new(py);
        let decodes = PyList::empty(py);
        for d in &report.decodes {
            let e = PyDict::new(py);
            e.set_item("info", bits(&d.info))?;
            e.set_item("payload", bits(&d.info[..63]))?;
            e.set_item("message", d.message.to_string())?;
            e.set_item("snr_db", d.snr_db)?;
            e.set_item("dt_sec", d.dt_sec)?;
            e.set_item("freq_hz", d.freq_hz)?;
            e.set_item("drift_hz", d.drift_hz)?;
            e.set_item("sync", d.sync)?;
            e.set_item("iterations", d.iterations)?;
            e.set_item("method", format!("{:?}", d.method))?;
            e.set_item("ap_type", d.ap_type)?;
            e.set_item("pass", d.pass)?;
            decodes.append(e)?;
        }
        out.set_item("decodes", decodes)?;
        let passes = PyList::empty(py);
        for p in &report.passes {
            let e = PyDict::new(py);
            e.set_item("candidates", p.candidates)?;
            e.set_item("decoded", p.decoded)?;
            e.set_item("duplicates", p.duplicates)?;
            e.set_item("suppression_db", p.suppression_db.clone())?;
            e.set_item("elapsed_ms", p.elapsed_ms)?;
            passes.append(e)?;
        }
        out.set_item("passes", passes)?;
        out.set_item("elapsed_ms", report.elapsed_ms)?;
        Ok(out)
    }
}

/// LDPC decode of 216 float32 LLRs (bytes). Returns (success, info bits, iterations, method).
#[pyfunction]
fn ldpc_decode(llrs: &Bound<'_, PyBytes>) -> PyResult<(bool, String, usize, String)> {
    let v = f32s(llrs.as_bytes())?;
    let l: [f32; 216] = v.try_into().map_err(|_| PyValueError::new_err("216 LLRs expected"))?;
    let r = Decoder::new().decode(&l, None);
    Ok((r.success, bits(&r.info), r.iterations, format!("{:?}", r.method)))
}

/// Encodes operator text. Raises ValueError with the reason when v1 cannot carry it exactly.
#[pyfunction]
fn encode_message(text: &str) -> PyResult<(String, String, Vec<u8>)> {
    let m = Message::parse(text).map_err(|e| PyValueError::new_err(e.to_string()))?;
    let enc = m.encode().map_err(|e| PyValueError::new_err(e.to_string()))?;
    Ok((m.to_string(), bits(&enc.info), enc.symbols.to_vec()))
}

/// The crate version (for the provenance line every published figure carries).
#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[pymodule]
fn z30(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyReceiver>()?;
    m.add_function(wrap_pyfunction!(ldpc_decode, m)?)?;
    m.add_function(wrap_pyfunction!(encode_message, m)?)?;
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add("SLOT_SAMPLES", z30_dsp::baseband::SLOT_SAMPLES)?;
    m.add("SLOT_ZERO_INDEX", z30_dsp::baseband::SLOT_ZERO_INDEX)?;
    m.add("DSP_RATE_HZ", z30_dsp::DSP_RATE_HZ)?;
    Ok(())
}
