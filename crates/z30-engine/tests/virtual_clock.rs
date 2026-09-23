//! The live receive path on a virtual clock (audit I.9 item 5; directive section 32).
//!
//! These are the tests that would have caught C1 (decode triggered before its window exists),
//! H5 (sample-to-UTC anchored once, drift ignored) and H8 (slot timing on UI timers): audio is
//! fed through the real `RxPipeline` - resampler, store, clock model, scheduler - from a
//! simulated sound card whose clock is wrong, whose timestamps jitter, and which drops samples,
//! and every slot must come out exactly once, aligned to UTC.

use z30_channel::stretch;
use z30_dsp::slot::Receiver;
use z30_engine::api::{Command, Event};
use z30_engine::bandplan::{LicenseClass, Region};
use z30_engine::config::{Config, PttConfig};
use z30_engine::engine::{Engine, TxKind};
use z30_engine::pipeline::{AudioBlock, RxPipeline};
use z30_engine::runtime::{TxAction, TxScheduler};
use z30_engine::slots::{slot_start, SlotEvent};
use z30_protocol::codec::Message;
use z30_protocol::gfsk::Modulator;

/// A simulated sound card: rate error, timestamp jitter, blocks.
struct Card {
    nominal: f64,
    ppm: f64,
    t0: f64,
    next: u64,
    block: usize,
    jitter_state: u64,
}

impl Card {
    fn true_utc(&self, index: f64) -> f64 {
        self.t0 + index / (self.nominal * (1.0 + self.ppm * 1e-6))
    }

    fn jitter(&mut self) -> f64 {
        self.jitter_state = self.jitter_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.jitter_state >> 40) as f64 / (1u64 << 24) as f64 - 0.5) * 0.006 // +-3 ms
    }

    fn block(&mut self, samples: Vec<f32>) -> AudioBlock {
        let first = self.next;
        self.next += samples.len() as u64;
        let capture_utc = self.true_utc(first as f64) + self.jitter();
        AudioBlock { first_index: first, samples, capture_utc }
    }
}

#[test]
fn soak_24_hours_every_slot_once_aligned_to_utc_through_drift_jitter_and_a_dropout() {
    let fs = 6000.0;
    // Start a few seconds into a slot, like a station switched on at a random moment.
    let mut card = Card { nominal: fs, ppm: 150.0, t0: 1_790_000_007.3, next: 0, block: 600, jitter_state: 7 };
    let mut pipe = RxPipeline::new(fs as u32);
    let total_sec = 24.0 * 3600.0;
    let total = (total_sec * fs * (1.0 + 150e-6)) as u64;
    let dropout_at = total / 2;
    let mut ready = Vec::new();
    let mut missed = Vec::new();
    let mut worst = 0.0f64;
    let zeros = vec![0.0f32; card.block];
    while card.next < total {
        if card.next >= dropout_at && card.next < dropout_at + card.block as u64 {
            // The device drops 2 s of audio (an overrun): the adapter reports the gap by index.
            card.next += (2.0 * fs) as u64;
        }
        let b = card.block(zeros.clone());
        for ev in pipe.push(&b) {
            match ev {
                SlotEvent::Ready(job) => {
                    assert_eq!(job.samples.len(), 162_000, "slot {}: window length", job.slot);
                    // The window must start where UTC says it does, on the TRUE device clock.
                    let err = card.true_utc(job.first_index as f64) - job.window_start_utc;
                    worst = worst.max(err.abs());
                    assert!(err.abs() < 0.010, "slot {}: window misaligned by {:.1} ms", job.slot, err * 1e3);
                    // ...and it may only be emitted once the whole window has been captured.
                    let captured_until = card.true_utc(card.next as f64);
                    assert!(captured_until >= slot_start(job.slot) + 25.5 - 0.01, "slot {} emitted before its window was complete (C1)", job.slot);
                    ready.push(job.slot);
                }
                SlotEvent::Missed(s, r) => missed.push((s, r)),
            }
        }
    }
    // Every slot exactly once, in order, apart from the first partial one and the ones the
    // dropout genuinely broke - and those are reported, not silent.
    for w in ready.windows(2) {
        assert!(w[1] > w[0], "slots out of order or repeated: {w:?}");
    }
    let first = *ready.first().unwrap();
    let last = *ready.last().unwrap();
    let accounted = ready.len() + missed.iter().filter(|(s, _)| *s >= first && *s <= last).count();
    assert_eq!(accounted as i64, last - first + 1, "a slot vanished without being reported");
    assert!(ready.len() >= 2870, "{} slots decoded of ~2880", ready.len());
    assert!(missed.len() <= 3, "{missed:?}");
    let drift = pipe.clock().drift_ppm().unwrap();
    assert!((drift - 150.0).abs() < 5.0, "estimated drift {drift} ppm");
    eprintln!("24 h: {} slots, {} missed ({:?}), worst alignment {:.2} ms, drift estimate {:.1} ppm", ready.len(), missed.len(), missed, worst * 1e3, drift);
}

/// The partner station: answers whatever we sent last, like a real operator's sequencer would.
fn partner_reply(ours: &str) -> Option<String> {
    let t: Vec<&str> = ours.split_whitespace().collect();
    if t.len() != 3 || t[0] != "K1ABC" {
        return None;
    }
    Some(match t[2] {
        "IO91" => "G4XYZ K1ABC -07".into(),
        "73" => return None,
        _ if t[2].starts_with('+') || t[2].starts_with('-') => "G4XYZ K1ABC RR73".into(),
        _ => return None,
    })
}

#[test]
fn closed_loop_qso_through_the_real_pipeline_decoder_gate_sequencer_and_logger() {
    let dev_rate = 48_000.0;
    let ppm = -120.0;
    let mut card = Card { nominal: dev_rate, ppm, t0: 1_790_000_000.0 - 12.0, next: 0, block: 4800, jitter_state: 3 };
    let mut pipe = RxPipeline::new(dev_rate as u32);
    let rx = Receiver::new();
    let modulator = Modulator::new(dev_rate).unwrap();

    let mut cfg = Config::default();
    cfg.station.callsign = "G4XYZ".into();
    cfg.station.grid = "IO91wm".into();
    cfg.station.region = Some(Region::IaruR1);
    cfg.station.license_class = Some(LicenseClass::Full);
    cfg.ptt = PttConfig::Vox;
    cfg.operating.dial_hz = 14_076_000;
    cfg.operating.tx_audio_hz = 1400.0;
    let mut engine = Engine::new(cfg);
    let mut txs = TxScheduler::new(0.0);
    let mono = |utc: f64| ((utc - 1_700_000_000.0) * 1000.0) as u64;

    // What the partner sends in each (even) slot. Slot parity: the partner calls CQ in even slots.
    let first_slot = 59_666_667i64; // 1_790_000_010 / 30 rounded up
    let mut partner: Vec<(i64, String)> = Vec::new();
    partner.push((first_slot, "CQ K1ABC FN31".into()));
    let partner_dt = 0.27;
    let partner_f0 = 1100.0;
    let partner_snr = -14.0;

    let mut logged = None;
    let mut transmitted: Vec<(i64, String)> = Vec::new();
    let mut decoded_slots = Vec::new();
    let end_utc = slot_start(first_slot + 8);
    let true_rate = dev_rate * (1.0 + ppm * 1e-6);
    let total = ((end_utc - card.t0) * true_rate) as usize + card.block;
    // The whole run's audio: noise now, frames added as the partner decides them (always well
    // before the samples are consumed, as on the air).
    let mut audio = vec![0.0f32; total];
    let noise_sigma = (0.5 / (10f64.powf(partner_snr / 10.0) * 5000.0 / dev_rate)).sqrt();
    let mut noise_state = 99u64;
    for v in audio.iter_mut() {
        noise_state = noise_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let u1 = ((noise_state >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
        noise_state = noise_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let u2 = ((noise_state >> 11) as f64) / (1u64 << 53) as f64;
        *v = (noise_sigma * (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()) as f32;
    }
    let card_t0 = card.t0;
    let add_frame = |audio: &mut Vec<f32>, slot: i64, text: &str| {
        let enc = Message::parse(text).unwrap().encode().unwrap();
        let wave: Vec<f64> = modulator.synthesize(&enc.symbols, partner_f0).unwrap().iter().map(|&v| v as f64).collect();
        // The partner's sound card is exact; ours runs `ppm` off, so we record a stretch.
        let recorded = stretch(&wave, 1.0 + ppm * 1e-6);
        let start = ((slot_start(slot) + partner_dt - card_t0) * true_rate).round() as usize;
        for (i, v) in recorded.iter().enumerate() {
            if start + i < audio.len() {
                audio[start + i] += *v as f32;
            }
        }
    };
    for (slot, text) in &partner {
        add_frame(&mut audio, *slot, text);
    }
    while (card.next as usize) + card.block <= total && card.true_utc(card.next as f64) < end_utc {
        let from = card.next as usize;
        let samples: Vec<f32> = audio[from..from + card.block].to_vec();
        let b = card.block(samples);
        let now = card.true_utc(card.next as f64);
        for ev in pipe.push(&b) {
            match ev {
                SlotEvent::Ready(job) => {
                    let report = rx.decode_slot(&job.samples, &engine.rx_config());
                    decoded_slots.push(job.slot);
                    if job.slot == first_slot {
                        let d = report.decodes.iter().find(|d| d.message.to_string() == "CQ K1ABC FN31").expect("the CQ decodes");
                        assert!((d.dt_sec - partner_dt).abs() < 0.02, "DT {:.3} s vs true {partner_dt} s (H5)", d.dt_sec);
                        assert!((d.freq_hz - partner_f0 * (1.0 - ppm * 1e-6)).abs() < 0.3, "freq {}", d.freq_hz);
                    }
                    engine.on_slot_report(job.slot, &report, now, mono(now));
                    if job.slot == first_slot {
                        let id = engine.snapshot(mono(now)).decodes.iter().find(|r| r.is_cq).unwrap().id;
                        engine.apply(Command::Answer(id), mono(now));
                    }
                }
                SlotEvent::Missed(s, r) => {
                    assert!(s < first_slot, "slot {s} missed: {r:?}");
                }
            }
        }
        for action in txs.tick(now) {
            match action {
                TxAction::Plan(slot) => {
                    if let Some(plan) = engine.plan_tx(slot, mono(now)) {
                        assert!(!engine.config().operating.tx_slot.matches(first_slot), "we answer in the other slot");
                        assert!(matches!(plan.kind, TxKind::Frame(_)));
                        txs.accept(slot, 24.0);
                        engine.tx_started(&plan);
                        transmitted.push((slot, plan.text.clone()));
                        if let Some(reply) = partner_reply(&plan.text) {
                            add_frame(&mut audio, slot + 1, &reply);
                        }
                    }
                }
                TxAction::Unkey { completed } => {
                    let slot = transmitted.last().unwrap().0;
                    engine.tx_finished(slot, completed, mono(now));
                }
                _ => {}
            }
        }
        for e in engine.take_events() {
            match e {
                Event::Logged(rec) => logged = Some(rec),
                Event::TxRefused(v) => panic!("TX refused: {v:?}"),
                _ => {}
            }
        }
    }
    let texts: Vec<&str> = transmitted.iter().map(|(_, t)| t.as_str()).collect();
    assert_eq!(texts.len(), 3, "{transmitted:?}");
    assert_eq!(texts[0], "K1ABC G4XYZ IO91");
    assert!(texts[1].starts_with("K1ABC G4XYZ -1"), "the roger report carries our measurement: {}", texts[1]);
    assert_eq!(texts[2], "K1ABC G4XYZ 73");
    let rec = logged.expect("the QSO was logged");
    assert_eq!(rec.call, "K1ABC");
    assert_eq!(rec.grid.as_ref().map(|g| g.value.as_str()), Some("FN31"));
    assert_eq!(rec.rst_rcvd.as_ref().map(|r| r.value), Some(-7));
    let sent = rec.rst_sent.as_ref().unwrap().value;
    assert!((sent as f64 - partner_snr).abs() <= 2.0, "our report {sent} vs true {partner_snr}");
    assert_eq!(rec.start_utc, slot_start(first_slot));
    assert!(rec.end_utc > rec.start_utc && rec.end_utc - rec.start_utc < 6.0 * 30.0);
    // Every slot from the first complete one on was decoded, none twice.
    for w in decoded_slots.windows(2) {
        assert_eq!(w[1], w[0] + 1);
    }
}
