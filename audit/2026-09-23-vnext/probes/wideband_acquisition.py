# Run: python audit/2026-09-23-vnext/probes/wideband_acquisition.py
"""Paired: the benchmark's own acquisition (acquisition.acquire_frame) searched over the benchmark's
+/-12 Hz window versus the whole 200-2800 Hz passband a real receiver has to search, on the SAME
buffers. Everything after acquisition is the shipped Python chain. AWGN, blind timing (+/-0.5 s),
carrier offset +/-5 Hz, 6 kHz, the benchmark's realistic model."""
import sys
import json
from multiprocessing import Pool
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
import numpy as np
from z30_dsp.benchmark import _prepare_frame, demodulate_mfsk_llrs, RECEIVER_PILOT_COHERENCE
from z30_dsp.acquisition import acquire_frame, slot_timing_search_sec
from z30_dsp.modem import Z30Config, Z30Modulator
from z30_dsp.ldpc import Z30LdpcCodec
from z30_dsp.channel import ChannelImpairments

cfg = Z30Config(sample_rate_hz=6000)
codec = Z30LdpcCodec()
def decode(job, acq):
    llr = demodulate_mfsk_llrs(job.noisy_wave, cfg, acq.noise_sigma, audio_center_hz=acq.base_freq_hz,
                               start_sample=acq.start_sample, pilot_coherence=RECEIVER_PILOT_COHERENCE)
    ok, info, _ = codec.decode_min_sum(llr)
    return bool(ok and np.array_equal(np.asarray(info[:63]), job.payload_63))
def work(args):
    snr, seed, n = args
    rng = np.random.default_rng(seed)
    mod = Z30Modulator(cfg)
    imp = ChannelImpairments(max_freq_offset_hz=5.0, max_time_offset_sec=0.5, fading="none")
    res = []
    for i in range(n):
        job, _ts, _tf = _prepare_frame(i, snr, codec, cfg, mod, rng, "realistic", imp, 0.5)
        tw = slot_timing_search_sec(0.5)
        a_n = acquire_frame(job.noisy_wave, cfg, nominal_base_freq_hz=1250.0, freq_search_hz=12.0, time_search_sec=tw)
        a_w = acquire_frame(job.noisy_wave, cfg, nominal_base_freq_hz=1500.0, freq_search_hz=1300.0, time_search_sec=tw)
        d_n = decode(job, a_n)
        d_w = d_n if (a_w.start_sample, round(a_w.base_freq_hz, 6)) == (a_n.start_sample, round(a_n.base_freq_hz, 6)) else decode(job, a_w)
        res.append((d_n, d_w))
    return snr, res
if __name__ == "__main__":
    tasks = [(snr, 1000 * int(-snr) + k, 25) for snr in (-24.0, -23.0, -22.0, -21.0) for k in range(2)]
    with Pool(4) as p:
        out = p.map(work, tasks)
    agg = {}
    for snr, res in out:
        a = agg.setdefault(snr, [0, 0, 0, 0, 0])
        for d_n, d_w in res:
            a[0] += 1
            a[1] += d_n
            a[2] += d_w
            a[3] += (d_n and not d_w)
            a[4] += (d_w and not d_n)
    for snr in sorted(agg):
        f, n_ok, w_ok, only_n, only_w = agg[snr]
        print(json.dumps({"snr": snr, "frames": f, "narrow_12Hz_decoded": n_ok, "wholeband_decoded": w_ok,
                          "only_narrow": only_n, "only_wholeband": only_w}))
