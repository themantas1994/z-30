#!/usr/bin/env python3
"""
Exports golden vectors from the frozen Python oracle (z30_dsp/) into fixtures/golden/.

    python reference/golden/generate.py            # writes fixtures/golden/*
    python reference/golden/generate.py --check    # regenerates into a temp dir and compares

Every vector is seeded, so a regeneration reproduces the committed files byte for byte; the
`--check` mode is what CI runs to prove it. The Rust workspace reads these files and must
reproduce them - bit-exactly where SPEC.md says bit-exact, within the stated tolerance where it
does not.

Regenerating to make a failing Rust test pass defeats the point. The oracle is frozen; if it
has to change, that is a protocol decision recorded in SPEC.md, and the vectors change with it
in the same commit.
"""

import argparse
import filecmp
import hashlib
import json
import os
import sys
import tempfile
from multiprocessing import Pool

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402

from z30_dsp.ap_decode import AP_STAGE_LADDER, build_ap_hypotheses, decode_with_ap  # noqa: E402
from z30_dsp.benchmark import (  # noqa: E402
    add_calibrated_awgn,
    ap_scenario_payload,
    demodulate_mfsk_llrs,
    generate_random_frame,
)
from z30_dsp.ldpc import Z30LdpcCodec, dither_vector  # noqa: E402
from z30_dsp.message_codec import (  # noqa: E402
    callsign_round_trips,
    decode_callsign28,
    encode_callsign28,
)
from z30_dsp.modem import Z30Config, Z30Modulator, codeword_to_symbols, gfsk_frequency_pulse  # noqa: E402

DEFAULT_OUT = os.path.join(ROOT, "fixtures", "golden")

#: LDPC corpus: frames per SNR point and the SNR points. Chosen to straddle the genie-aided
#: threshold so the corpus exercises every schedule, the trellis early exit and OSD.
CORPUS_SNRS = (-27.0, -26.0, -25.0, -24.5, -24.0, -23.5, -23.0, -22.0, -21.0)
CORPUS_FRAMES_PER_SNR = 60
CORPUS_SEED = 20260923


def _bits(a):
    return "".join(str(int(b)) for b in a)


def _write_f32(path, arr):
    np.asarray(arr, dtype="<f4").tofile(path)


def codec_vectors():
    """CRC, LDPC encode and symbol mapping for random and structured payloads."""
    codec = Z30LdpcCodec()
    cfg = Z30Config()
    rng = np.random.default_rng(1)
    payloads = [[0] * 63, [1] * 63, [i % 2 for i in range(63)]]
    payloads += [[int(b) for b in rng.integers(0, 2, 63)] for _ in range(61)]
    out = []
    for p in payloads:
        cw = codec.encode(p)
        out.append({
            "payload": _bits(p),
            "crc14": int(codec.compute_crc14(p)),
            "codeword": _bits(cw),
            "symbols": [int(s) for s in codeword_to_symbols(cw, cfg)],
        })
    return {"_comment": "Oracle: z30_dsp.ldpc.Z30LdpcCodec.encode + modem.codeword_to_symbols",
            "vectors": out}


def callsign_vectors():
    """The oracle's 28-bit packing, including the lossy paths vNext must refuse."""
    calls = [
        "CQ", "CQ DX", "CQ TEST", "QRZ", "W1AW", "K1ABC", "G4XYZ", "VK2ABC", "JA1XYZ", "9A1AA",
        "2E0ABC", "M0ABC", "ZS6ABC", "ZU1AB", "ZV1ABC", "ZY2ABC", "ZZ9ZZZ", "3DA0XYZ", "G4XYZ/P",
        "EA8/G4XYZ", "NOCAL", "A1A", "AA0AAA", "Z9Z", "1A1AA", "K1ABCD", "W1", "",
    ]
    rng = np.random.default_rng(2)
    alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    alnum = alpha + "0123456789"
    for _ in range(200):
        prefix = "".join(alnum[int(rng.integers(0, 36))] for _ in range(int(rng.integers(1, 3))))
        suffix = "".join(alpha[int(rng.integers(0, 26))] for _ in range(int(rng.integers(1, 4))))
        calls.append(f"{prefix}{int(rng.integers(0, 10))}{suffix}")
    out = []
    for c in calls:
        packed = encode_callsign28(c)
        out.append({
            "call": c,
            "packed": int(packed),
            "unpacked": decode_callsign28(packed),
            "round_trips": bool(callsign_round_trips(c)),
        })
    return {"_comment": "Oracle: z30_dsp.message_codec encode_callsign28 / decode_callsign28 / "
                        "callsign_round_trips", "vectors": out}


def waveform_vectors(out_dir):
    """GFSK frames. Full frames at 6 kHz; every 97th sample at 12 and 48 kHz."""
    codec = Z30LdpcCodec()
    meta = []
    rng = np.random.default_rng(3)
    cases = [(6000, 1250.0, "full"), (6000, 537.3, "full"), (12000, 1250.0, "sub97"),
             (48000, 2003.125, "sub97")]
    for i, (fs, f0, kind) in enumerate(cases):
        cfg = Z30Config(sample_rate_hz=fs)
        payload, cw, _ds, syms = generate_random_frame(codec, cfg, rng)
        wave = Z30Modulator(cfg).synthesize_frame(syms, base_audio_freq_hz=f0)
        name = f"waveform_{i}.f32"
        _write_f32(os.path.join(out_dir, name), wave if kind == "full" else wave[::97])
        meta.append({"file": name, "sample_rate_hz": fs, "base_freq_hz": f0, "stride": 1 if kind == "full" else 97,
                     "total_samples": int(wave.size), "symbols": [int(s) for s in syms]})
    pulse = gfsk_frequency_pulse(2.0, 32)
    return {"_comment": "Oracle: z30_dsp.modem.Z30Modulator.synthesize_frame (float32 output)",
            "frames": meta, "gfsk_pulse_bt2_nsps32": [float(v) for v in pulse]}


def demod_vectors(out_dir):
    """One noisy frame at 6 kHz with non-integer carrier and non-zero start, and its LLRs."""
    codec = Z30LdpcCodec()
    cfg = Z30Config(sample_rate_hz=6000)
    rng = np.random.default_rng(4)
    _p, _cw, _ds, syms = generate_random_frame(codec, cfg, rng)
    wave = Z30Modulator(cfg).synthesize_frame(syms, base_audio_freq_hz=1250.37)
    start = 1234
    buf = np.zeros(wave.size + 2 * start, dtype=np.float32)
    buf[start:start + wave.size] = wave
    noisy, sigma = add_calibrated_awgn(buf, -19.0, cfg.sample_rate_hz, rng, float(np.mean(wave ** 2)))
    noisy = noisy.astype("<f4")
    llr = demodulate_mfsk_llrs(noisy, cfg, sigma, audio_center_hz=1250.37, start_sample=start)
    _write_f32(os.path.join(out_dir, "demod_wave.f32"), noisy)
    _write_f32(os.path.join(out_dir, "demod_llr.f32"), llr)
    return {"_comment": "Oracle: z30_dsp.benchmark.demodulate_mfsk_llrs (RECEIVER_PILOT_COHERENCE)",
            "wave": "demod_wave.f32", "llr": "demod_llr.f32", "sample_rate_hz": 6000,
            "sigma": float(sigma), "base_freq_hz": 1250.37, "start_sample": start}


def _decode_one(llr):
    codec = Z30LdpcCodec()
    ok, info, iters = codec.decode_min_sum(np.asarray(llr, dtype=np.float32))
    return bool(ok), _bits(info[:77]), int(iters)


def ldpc_corpus(out_dir, workers):
    """Channel LLRs from the oracle demodulator at known timing, and the oracle's verdicts."""
    codec = Z30LdpcCodec()
    cfg = Z30Config(sample_rate_hz=6000)
    mod = Z30Modulator(cfg)
    rng = np.random.default_rng(CORPUS_SEED)
    llrs, payloads, snrs = [], [], []
    for snr in CORPUS_SNRS:
        for _ in range(CORPUS_FRAMES_PER_SNR):
            payload, _cw, _ds, syms = generate_random_frame(codec, cfg, rng)
            wave = mod.synthesize_frame(syms, base_audio_freq_hz=1250.0)
            noisy, sigma = add_calibrated_awgn(wave, snr, cfg.sample_rate_hz, rng)
            llrs.append(np.asarray(demodulate_mfsk_llrs(noisy, cfg, sigma, 1250.0, 0), dtype=np.float32))
            payloads.append(_bits(payload))
            snrs.append(snr)
    with Pool(workers) as pool:
        verdicts = pool.map(_decode_one, llrs)
    _write_f32(os.path.join(out_dir, "ldpc_corpus_llr.f32"), np.stack(llrs))
    frames = [{"snr_db": s, "payload": p, "success": v[0], "info": v[1], "iterations": v[2]}
              for s, p, v in zip(snrs, payloads, verdicts)]
    return {"_comment": "Oracle: Z30LdpcCodec.decode_min_sum on demodulate_mfsk_llrs output. "
                        "success with iterations == 150 means OSD (or the trellis exit on the last "
                        "iteration); see SPEC.md section 7.",
            "llr_file": "ldpc_corpus_llr.f32", "seed": CORPUS_SEED, "frames": frames}


#: The OSD corpus. OSD rescues roughly 1 in 500 near-threshold frames, so the main corpus above
#: never reaches it. These are the pool indices at which the Rust port found BP failing and OSD
#: succeeding (`screen_osd_pool` in crates/z30-dsp/tests/golden_ldpc.rs, run over a 16 x 250 pool
#: drawn exactly as `_osd_pool_chunk` draws it). The screen only chooses WHICH frames to export;
#: every verdict below comes from the oracle, so a bad screen costs coverage, never correctness.
OSD_POOL_CHUNK = 250
OSD_POOL_INDICES = (335, 661, 940, 1796, 2443, 2573, 3470)


def _osd_pool_chunk(chunk):
    cfg = Z30Config(sample_rate_hz=6000)
    mod = Z30Modulator(cfg)
    codec = Z30LdpcCodec()
    rng = np.random.default_rng(1000 + chunk)
    out = []
    for i in range(OSD_POOL_CHUNK):
        snr = -24.5 + 0.5 * (i % 4)
        _p, _c, _d, syms = generate_random_frame(codec, cfg, rng)
        noisy, sigma = add_calibrated_awgn(mod.synthesize_frame(syms, 1250.0), snr, 6000, rng)
        out.append(np.asarray(demodulate_mfsk_llrs(noisy, cfg, sigma, 1250.0, 0), dtype=np.float32))
    return chunk, out


def osd_corpus(out_dir, workers):
    chunks = sorted({i // OSD_POOL_CHUNK for i in OSD_POOL_INDICES})
    with Pool(workers) as pool:
        pools = dict(pool.map(_osd_pool_chunk, chunks))
        llrs = [pools[i // OSD_POOL_CHUNK][i % OSD_POOL_CHUNK] for i in OSD_POOL_INDICES]
        verdicts = pool.map(_decode_one, llrs)
    _write_f32(os.path.join(out_dir, "osd_corpus_llr.f32"), np.stack(llrs))
    frames = [{"pool_index": i, "success": v[0], "info": v[1], "iterations": v[2]}
              for i, v in zip(OSD_POOL_INDICES, verdicts)]
    return {"_comment": "Oracle verdicts on frames where BP fails and the reference OSD decides.",
            "llr_file": "osd_corpus_llr.f32", "frames": frames}


def _ap_one(args):
    llr, stage, my_call, dx_call = args
    codec = Z30LdpcCodec()
    hyps = build_ap_hypotheses(stage, my_call, dx_call)
    r = decode_with_ap(codec, np.asarray(llr, dtype=np.float32), hyps)
    return bool(r.success), _bits(r.info_bits[:77]), int(r.iterations), int(r.ap_type), int(r.hypotheses_tried)


def ap_vectors(out_dir, workers):
    """Hypothesis masks per stage, and decode_with_ap verdicts on real QSO-message frames."""
    stages = sorted(AP_STAGE_LADDER)
    ladders = []
    for stage in stages + ["UNKNOWN_STAGE"]:
        for my_call, dx_call in (("W1AW", "K1ABC"), ("W1AW", ""), ("G4XYZ/P", "K1ABC"), ("NOCAL", "K1ABC")):
            hyps = build_ap_hypotheses(stage, my_call, dx_call)
            ladders.append({"stage": stage, "my_call": my_call, "dx_call": dx_call,
                            "hypotheses": [{"ap_type": h.ap_type, "mask": _bits(h.mask), "bits": _bits(h.bits)}
                                           for h in hyps]})
    codec = Z30LdpcCodec()
    cfg = Z30Config(sample_rate_hz=6000)
    mod = Z30Modulator(cfg)
    rng = np.random.default_rng(5)
    llrs, jobs, payloads = [], [], []
    for snr in (-26.0, -25.0, -24.5, -24.0):
        for _ in range(20):
            payload, in_qso = ap_scenario_payload(rng)
            _p, _cw, _ds, syms = generate_random_frame(codec, cfg, rng, payload)
            wave = mod.synthesize_frame(syms, base_audio_freq_hz=1250.0)
            noisy, sigma = add_calibrated_awgn(wave, snr, cfg.sample_rate_hz, rng)
            llr = np.asarray(demodulate_mfsk_llrs(noisy, cfg, sigma, 1250.0, 0), dtype=np.float32)
            llrs.append(llr)
            jobs.append((llr, "SENDING_REPORT", "W1AW", "K1ABC"))
            payloads.append((_bits(payload), bool(in_qso), snr))
    with Pool(workers) as pool:
        verdicts = pool.map(_ap_one, jobs)
    _write_f32(os.path.join(out_dir, "ap_corpus_llr.f32"), np.stack(llrs))
    frames = [{"snr_db": s, "payload": p, "in_qso": q, "stage": "SENDING_REPORT", "my_call": "W1AW",
               "dx_call": "K1ABC", "success": v[0], "info": v[1], "iterations": v[2], "ap_type": v[3],
               "hypotheses_tried": v[4]} for (p, q, s), v in zip(payloads, verdicts)]
    return {"_comment": "Oracle: z30_dsp.ap_decode.build_ap_hypotheses / decode_with_ap",
            "ladders": ladders, "llr_file": "ap_corpus_llr.f32", "frames": frames}


def dither_vectors():
    rng = np.random.default_rng(6)
    out = []
    for _ in range(4):
        llr = rng.normal(0, 6, 216).astype(np.float32)
        out.append({"llr": [float(v) for v in llr], "dither": [float(v) for v in dither_vector(llr, 216)]})
    return {"_comment": "Oracle: z30_dsp.ldpc.dither_vector", "vectors": out}


def generate(out_dir, workers):
    os.makedirs(out_dir, exist_ok=True)
    docs = {
        "codec.json": codec_vectors(),
        "callsigns.json": callsign_vectors(),
        "waveform.json": waveform_vectors(out_dir),
        "demod.json": demod_vectors(out_dir),
        "dither.json": dither_vectors(),
        "ldpc_corpus.json": ldpc_corpus(out_dir, workers),
        "osd_corpus.json": osd_corpus(out_dir, workers),
        "ap.json": ap_vectors(out_dir, workers),
    }
    for name, doc in docs.items():
        with open(os.path.join(out_dir, name), "w") as f:
            json.dump(doc, f, indent=1, sort_keys=True)
            f.write("\n")
    manifest = {}
    for name in sorted(os.listdir(out_dir)):
        # messages.json comes from the TypeScript oracle (generate_messages.mts), not from here.
        if name in ("MANIFEST.json", "messages.json"):
            continue
        with open(os.path.join(out_dir, name), "rb") as f:
            manifest[name] = hashlib.sha256(f.read()).hexdigest()
    with open(os.path.join(out_dir, "MANIFEST.json"), "w") as f:
        json.dump({"generator": "reference/golden/generate.py", "numpy": np.__version__,
                   "sha256": manifest}, f, indent=1, sort_keys=True)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--check", action="store_true", help="regenerate into a temp dir and compare")
    args = ap.parse_args()
    if not args.check:
        generate(args.out, args.workers)
        print(f"golden vectors written to {args.out}")
        return
    with tempfile.TemporaryDirectory() as tmp:
        generate(tmp, args.workers)
        names = sorted(os.listdir(tmp))
        bad = [n for n in names if not (os.path.exists(os.path.join(args.out, n))
                                        and os.path.exists(os.path.join(tmp, n))
                                        and filecmp.cmp(os.path.join(tmp, n), os.path.join(args.out, n), shallow=False))]
        if bad:
            print("golden vectors differ from a fresh oracle run:", ", ".join(bad))
            sys.exit(1)
        print(f"all {len(names)} golden files reproduce byte for byte")


if __name__ == "__main__":
    main()
