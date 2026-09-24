//! The LDPC cascade and the AP ladder against the frozen oracle, bit for bit.
//!
//! The oracle's OSD is the tautological one (SPEC.md 7.1). Production uses the corrected rule,
//! so to prove the rest of the decoder is exact this file carries a transcription of the legacy
//! OSD - test code only, never shipped - and composes it with the production BP stage.

use serde_json::Value;
use std::path::PathBuf;
use z30_dsp::ap::{apply_hypothesis, build_hypothesis, build_ladder, hypothesis_holds, ApContext, ApHypothesis, ApStage};
use z30_dsp::ldpc::{correlation, dither_vector, ApMask, BpFailure, BpOutcome, Decoder, Llrs};
use z30_protocol::codec::Callsign;
use z30_protocol::crc::{crc14, crc_bits};
use z30_protocol::ldpc::encode_info;
use z30_protocol::{K, N, PAYLOAD_BITS};

fn golden(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/golden").join(name)
}

fn load(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(golden(name)).unwrap()).unwrap()
}

fn read_llrs(name: &str) -> Vec<Llrs> {
    let raw: Vec<f32> =
        std::fs::read(golden(name)).unwrap().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    raw.chunks_exact(N).map(|c| c.try_into().unwrap()).collect()
}

fn bits_str(b: &[u8]) -> String {
    b.iter().map(|&x| (b'0' + x) as char).collect()
}

/// `ldpc.py`'s OSD, transcribed: flips payload bits, RECOMPUTES the CRC, accepts on correlation.
fn legacy_osd(f: &BpFailure, input: &Llrs, pinned: Option<&ApMask>) -> Option<[u8; K]> {
    if f.min_syndrome > 14 {
        return None;
    }
    let mut ranked: Vec<usize> = (0..PAYLOAD_BITS).filter(|&i| pinned.is_none_or(|p| !p[i])).collect();
    ranked.sort_by(|&a, &b| f.best_total[a].abs().partial_cmp(&f.best_total[b].abs()).unwrap());
    let test = &ranked[..ranked.len().min(14)];
    let base: [u8; PAYLOAD_BITS] = f.best_cw[..PAYLOAD_BITS].try_into().unwrap();
    let mut best: Option<[u8; N]> = None;
    let mut max_corr = 0.0f64;
    let mut eval = |pl: &[u8; PAYLOAD_BITS]| {
        let mut info = [0u8; K];
        info[..PAYLOAD_BITS].copy_from_slice(pl);
        info[PAYLOAD_BITS..].copy_from_slice(&crc_bits(crc14(pl)));
        let cw = encode_info(&info);
        let corr = correlation(&cw, input) as f64;
        let diff = (0..N).filter(|&i| cw[i] != f.best_cw[i]).count();
        if corr > 20.0 && corr > max_corr && diff <= 16 {
            max_corr = corr;
            best = Some(cw);
        }
    };
    eval(&base);
    for i in 0..test.len() {
        let mut c = base;
        c[test[i]] ^= 1;
        eval(&c);
    }
    for i in 0..test.len() {
        for j in (i + 1)..test.len() {
            let mut c = base;
            c[test[i]] ^= 1;
            c[test[j]] ^= 1;
            eval(&c);
        }
    }
    best.map(|cw| cw[..K].try_into().unwrap())
}

/// The oracle's `decode_min_sum`: production BP + legacy OSD. (success, info, iterations)
fn reference_decode(dec: &mut Decoder, llr: &Llrs, pinned: Option<&ApMask>) -> (bool, [u8; K], usize) {
    match dec.decode_bp(llr, pinned) {
        BpOutcome::Success(r) => (true, r.info, r.iterations),
        BpOutcome::Failure(f) => match legacy_osd(&f, llr, pinned) {
            Some(info) => (true, info, f.iterations),
            None => (false, f.best_cw[..K].try_into().unwrap(), f.iterations),
        },
    }
}

#[test]
fn dither_matches_the_oracle() {
    for v in load("dither.json")["vectors"].as_array().unwrap() {
        let llr: Vec<f32> = v["llr"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
        let d = dither_vector(&llr.try_into().unwrap());
        for (a, b) in d.iter().zip(v["dither"].as_array().unwrap()) {
            assert_eq!(*a, b.as_f64().unwrap());
        }
    }
}

#[test]
fn ldpc_cascade_is_bit_exact_on_the_corpus() {
    let doc = load("ldpc_corpus.json");
    let llrs = read_llrs(doc["llr_file"].as_str().unwrap());
    let frames = doc["frames"].as_array().unwrap();
    assert_eq!(llrs.len(), frames.len());
    let mut dec = Decoder::new();
    let (mut bp_ok, mut osd_ok, mut fail) = (0, 0, 0);
    for (i, (llr, f)) in llrs.iter().zip(frames).enumerate() {
        let (ok, info, iters) = reference_decode(&mut dec, llr, None);
        assert_eq!(ok, f["success"].as_bool().unwrap(), "frame {i}: verdict");
        assert_eq!(bits_str(&info), f["info"].as_str().unwrap(), "frame {i}: information bits");
        assert_eq!(iters as u64, f["iterations"].as_u64().unwrap(), "frame {i}: iterations");
        match (ok, iters) {
            (true, 150) => osd_ok += 1,
            (true, _) => bp_ok += 1,
            _ => fail += 1,
        }
    }
    assert!(bp_ok > 100 && fail > 100, "bp {bp_ok}, osd {osd_ok}, fail {fail}");
    eprintln!("corpus: {} frames bit-exact (BP {bp_ok}, legacy-OSD {osd_ok}, failed {fail})", frames.len());
}

#[test]
fn legacy_osd_path_is_bit_exact_and_the_fixed_rule_agrees_on_it() {
    // The main corpus never reaches OSD (it rescues ~1 frame in 500); this one exists for it.
    let doc = load("osd_corpus.json");
    let llrs = read_llrs(doc["llr_file"].as_str().unwrap());
    let mut dec = Decoder::new();
    let mut osd_used = 0;
    for (i, (llr, f)) in llrs.iter().zip(doc["frames"].as_array().unwrap()).enumerate() {
        let (ok, info, iters) = reference_decode(&mut dec, llr, None);
        assert_eq!(ok, f["success"].as_bool().unwrap(), "frame {i}");
        assert_eq!(bits_str(&info), f["info"].as_str().unwrap(), "frame {i}");
        assert_eq!(iters as u64, f["iterations"].as_u64().unwrap(), "frame {i}");
        osd_used += (ok && iters == 150) as usize;
        let prod = dec.decode(llr, None);
        if prod.success {
            assert_eq!(bits_str(&prod.info), f["info"].as_str().unwrap(), "frame {i}: corrected OSD disagrees");
        }
    }
    assert!(osd_used > 0);
}

#[test]
fn production_decoder_never_accepts_a_crc_failure_and_agrees_with_bp() {
    let doc = load("ldpc_corpus.json");
    let llrs = read_llrs(doc["llr_file"].as_str().unwrap());
    let mut dec = Decoder::new();
    for (llr, f) in llrs.iter().zip(doc["frames"].as_array().unwrap()) {
        let r = dec.decode(llr, None);
        if r.success {
            assert!(z30_protocol::crc::info_crc_ok(&r.info));
        }
        // Where the oracle succeeded without OSD, production must give the identical answer.
        if f["success"].as_bool().unwrap() && f["iterations"].as_u64().unwrap() < 150 {
            assert!(r.success);
            assert_eq!(bits_str(&r.info), f["info"].as_str().unwrap());
            assert_eq!(r.iterations as u64, f["iterations"].as_u64().unwrap());
        }
    }
}

#[test]
fn an_empty_ap_mask_decodes_bit_identically_to_no_mask() {
    // AGENTS.md section 4: an AP-less decode must stay bit-identical - same bits, same
    // iteration count, same syndrome - or every published threshold describes another decoder.
    let doc = load("ldpc_corpus.json");
    let llrs = read_llrs(doc["llr_file"].as_str().unwrap());
    let mut dec = Decoder::new();
    let empty: ApMask = [false; N];
    for (i, llr) in llrs.iter().enumerate() {
        let a = dec.decode(llr, None);
        let b = dec.decode(llr, Some(&empty));
        assert_eq!(
            (a.success, a.info, a.iterations, a.method, a.min_syndrome),
            (b.success, b.info, b.iterations, b.method, b.min_syndrome),
            "frame {i}"
        );
    }
}

fn to_bits(s: &str) -> Vec<u8> {
    s.bytes().map(|b| b - b'0').collect()
}

#[test]
fn ap_ladders_match_the_oracle() {
    let doc = load("ap.json");
    for l in doc["ladders"].as_array().unwrap() {
        let stage = ApStage::from_reference_name(l["stage"].as_str().unwrap());
        let my = Callsign::new(l["my_call"].as_str().unwrap()).ok();
        let dx = Callsign::new(l["dx_call"].as_str().unwrap()).ok();
        let got: Vec<ApHypothesis> = match stage {
            Some(stage) => build_ladder(&ApContext { stage, my_call: my, dx_call: dx, worked_freqs_hz: vec![] }, None),
            None => vec![],
        };
        let want = l["hypotheses"].as_array().unwrap();
        assert_eq!(got.len(), want.len(), "{l}");
        for (g, w) in got.iter().zip(want) {
            assert_eq!(g.ap_type as u64, w["ap_type"].as_u64().unwrap());
            assert_eq!(g.mask.iter().map(|&b| b as u8).collect::<Vec<_>>(), to_bits(w["mask"].as_str().unwrap()));
            assert_eq!(g.bits.to_vec(), to_bits(w["bits"].as_str().unwrap()));
        }
    }
}

#[test]
fn ap_decode_is_bit_exact_on_the_corpus() {
    let doc = load("ap.json");
    let llrs = read_llrs(doc["llr_file"].as_str().unwrap());
    let mut dec = Decoder::new();
    let mut ap_hits = 0;
    for (i, (llr, f)) in llrs.iter().zip(doc["frames"].as_array().unwrap()).enumerate() {
        let ctx = ApContext {
            stage: ApStage::from_reference_name(f["stage"].as_str().unwrap()).unwrap(),
            my_call: Callsign::new(f["my_call"].as_str().unwrap()).ok(),
            dx_call: Callsign::new(f["dx_call"].as_str().unwrap()).ok(),
            worked_freqs_hz: vec![],
        };
        let hyps = build_ladder(&ctx, None);
        // decode_with_ap, with the reference decoder inside it.
        let (mut ok, mut info, mut iters) = reference_decode(&mut dec, llr, None);
        let mut ap_type = 0u8;
        let mut tried = 0usize;
        if !ok {
            let plain_info = info;
            for (t, h) in hyps.iter().enumerate() {
                tried = t + 1;
                let ap_llr = apply_hypothesis(llr, h);
                let mut pinned = [false; N];
                pinned[..PAYLOAD_BITS].copy_from_slice(&h.mask);
                let (o, inf, it) = reference_decode(&mut dec, &ap_llr, Some(&pinned));
                iters += it;
                if o && hypothesis_holds(&inf, h) {
                    ok = true;
                    info = inf;
                    ap_type = h.ap_type;
                    break;
                }
            }
            if !ok {
                info = plain_info;
            }
        }
        assert_eq!(ok, f["success"].as_bool().unwrap(), "frame {i}");
        assert_eq!(bits_str(&info), f["info"].as_str().unwrap(), "frame {i}");
        assert_eq!(iters as u64, f["iterations"].as_u64().unwrap(), "frame {i}");
        assert_eq!(ap_type as u64, f["ap_type"].as_u64().unwrap(), "frame {i}");
        assert_eq!(tried as u64, f["hypotheses_tried"].as_u64().unwrap(), "frame {i}");
        ap_hits += (ap_type > 0) as usize;
    }
    assert!(ap_hits > 0, "the AP corpus never exercised a hypothesis");
    let _ = build_hypothesis(1, None, None);
}

/// Screening helper for reference/golden/generate.py's OSD corpus: prints the indices of a pool
/// of LLR vectors on which BP fails and either OSD rule succeeds. Run with
/// `Z30_POOL=<file.f32> cargo test -p z30-dsp --test golden_ldpc screen_osd_pool -- --ignored --nocapture`.
#[test]
#[ignore]
fn screen_osd_pool() {
    let path = std::env::var("Z30_POOL").expect("Z30_POOL");
    let raw: Vec<f32> = std::fs::read(path).unwrap().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let mut dec = Decoder::new();
    let (mut legacy, mut fixed, mut both, mut failures) = (vec![], vec![], 0, 0);
    for (i, c) in raw.chunks_exact(N).enumerate() {
        let llr: Llrs = c.try_into().unwrap();
        if let BpOutcome::Failure(f) = dec.decode_bp(&llr, None) {
            failures += 1;
            let l = legacy_osd(&f, &llr, None).is_some();
            let n = Decoder::osd(&f, &llr, None).is_some();
            if l {
                legacy.push(i)
            }
            if n {
                fixed.push(i)
            }
            both += (l && n) as usize;
        }
    }
    println!("pool {} bp_failures {failures} legacy_osd {} fixed_osd {} both {both}", raw.len() / N, legacy.len(), fixed.len());
    println!("LEGACY {:?}", legacy);
    println!("FIXED {:?}", fixed);
}
