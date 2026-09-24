# Z-30 post-remediation independent verification audit

| | |
| :--- | :--- |
| Audited repository | `themantas1994/z-30` (public), default branch head **`84033d4531b3`** (merge of PR #34) |
| Later commits | Up to `0a4d8a9` (at the time of filing), `main` gained only two Dependabot bumps of `actions/upload-artifact` / `actions/download-artifact` in `release.yml`. No audited code changed |
| Previous audited commit | `224b2fc58a6572adac4686b6858bbba741591339` |
| Remediation commits examined | `d8983ee` (vNext fixes), `17c3e8e` (legacy separation), `dedd4e0` (oracle test fixes), and the documentation and result commits `5ab1421`, `f98a24a`, `8f16d43`, `a9a64fa` |
| Audit date | 2026-09-24 |
| Environment | Linux 6.18.44 x86_64 (Ubuntu 24.04 container), 4 logical CPUs. rustc **1.95.0** (the declared MSRV) and **1.98.1** (stable). Python 3.11 with NumPy 2.2.6 / SciPy 1.15.3, used only to measure the frozen oracle's channel model |
| Hardware | **None.** No radio, sound card, audio interface, PTT interface, RF path, GPS/PPS or on-air recording was used. **No hardware validation was performed.** |
| Production code | **Not modified.** Mutation tests ran in a separate git worktree, and every mutant was reverted. |

**Status vocabulary** (the only statuses used here): VERIFIED FIXED, VERIFIED FIXED — NOT HARDWARE VALIDATED, PARTIALLY FIXED, NOT FIXED, NOT TESTED, NOT APPLICABLE.

**Limit on independence.** The original report `Z30_FULL_AUDIT_2026-09-24.md` is not in the z-30 repository or its history. Its 35 finding IDs and titles are taken from the remediation's own record (`audit/2026-09-24-vnext-remediation/FINAL_AUDIT.md`). Each one was then checked against the code, not against that record. Evidence the original audit cites only by label (for example "E007") could not be inspected.

All evidence produced by this audit is in [`evidence/`](evidence/): the independent harness source, the mutation script, every result file and the test logs. See section 16 for how to re-run them.

---

## 1. Executive summary

1. **One production application.** The Rust workspace in `crates/` (`z30`, `z30-gui`) is the only thing built, packaged or started. No Rust code launches, imports or falls back to Python, Node, a browser or `legacy/`. The binaries dynamically link only libc, libm, libgcc_s, libasound, and with the CM108 feature libudev and libcap. They contain no `W1AW` and no `web_dist`. They build with no Python or Node on the PATH.
2. **The published benchmarks are genuine.** They reproduce **bit for bit** from the shipped `z30` binary, rebuilt at HEAD with a different compiler (1.95.0 instead of 1.98.1): every AWGN point and all 25 fading points. The receiver crates are byte-identical between `d8983ee` and HEAD. The decoder has no benchmark or test mode and never sees ground truth.
3. **An independent reproduction agrees.** It used this audit's own harness, noise generator and seeds, not the project's channel crate. AWGN came out at 50% = **−22.94 dB** and 90% = **−22.06 dB**, against the claimed −23.03 / −22.06 dB. Both are inside the claimed interval.
4. **SNR (M-07) is fixed for AWGN.** From −22 to +30 dB the measured bias is ≤ 0.30 dB and the sd ≤ 0.40 dB. It stays `Option` all the way from the decoder to the QSO report. **The estimate is not robust to replica mismatch**, though. With 5°/symbol phase noise it reads 2.9 dB low at +30 dB. On the Watterson "poor" channel it reads 4.4 dB low at +20 dB. The "validated −22…+30 dB" range applies only to an exact-replica AWGN signal.
5. **SIC is real.** It modifies the residual. Measured against the known waveform it removes 18.6–19.5 dB of a +10 dB station and 28.6–29.6 dB of a +20 dB station. With SIC the weak station decodes in 100% of trials whenever the two stations differ in frequency or timing, and in 0% without SIC. No false decodes.
6. **New defect — the Watterson channel (Rust and oracle) runs at 1/√2 of its labelled Doppler spread.** "moderate 0.5 Hz" is measured at 0.353 Hz, and "high-latitude 10 Hz" at 7.06 Hz. Ensemble normalisation (H-10) is correct. The fading figures are genuine simulations, but of channels slower than the ITU-R F.1487 presets they are labelled as.
7. **Transmit fails closed.** Every corrupted frame this audit constructed (symbol, Costas, tone, CRC, payload, parity, partner call, message) is refused by `verify_round_trip`, and every unsupported message is refused by the encoder. However, **three mutations that disable the symbol-level round trip survive the test suite (C06-a/b/c)**. That layer has no negative regression test. Also, the frame actually transmitted is a second encoding, not the object that was verified.
8. **The MSRV claim is only partly true.** The workspace builds and passes its tests on 1.95.0: **139 passed, 0 failed, 1 ignored**, reproduced. **`cargo clippy -D warnings` fails on 1.95.0** because of a deny-by-default lint (`codec.rs:259`). It is clean on stable. CI runs clippy only on stable.
9. **Mutation testing: 23 of 28 mutations killed.** The five survivors are C03-c (a 0.3 s clock offset), C06-a/b/c (the round-trip layer), LOG-c (a fabricated −16 received report) and SNR-e (a −30 dB floor instead of `None`). Each marks a real gap in regression protection.
10. **Other new findings:** `--loopback-test` plays audio past the transmit gate, so with VOX configured it can key a radio. A default dial of 14.076 MHz can reach the log as "commanded" frequency when there is no CAT. The rig-reported mode is read but never gated (L-07). Two documentation inaccuracies.
11. **Findings still open from the original audit:** H-02 (no hardware validation), M-08 (PTT after SIGKILL / power loss), L-05 (Gray-mapping loss unmeasured) remain NOT FIXED. H-06, H-07 and L-07 are PARTIALLY FIXED. C-05 is re-classified **PARTIALLY FIXED**: the logged frequency can be a default.

---

## 2. Repository / architecture verification

| Area | Location | Production? |
| :--- | :--- | :--- |
| GUI entry point | `crates/z30-gui/src/main.rs` → `app.rs::start_runtime` → `z30_engine::runtime::start` | yes |
| CLI entry point | `crates/z30-cli/src/main.rs` (`--receive`, `--decode`, `--encode`, `--diagnostics`, `--migrate`, `--loopback-test`, `--benchmark`, ADIF) | yes, receive-only by design |
| Audio capture | `z30-io/src/audio.rs` (cpal → SPSC ring → `AudioInput::next_block`) | yes |
| DSP | `z30-dsp` (`resample.rs`, `baseband.rs`, `sync.rs`, `demod.rs`, `ldpc.rs`, `ap.rs`, `sic.rs`, `slot.rs::decode_slot`) | yes |
| Protocol | `z30-protocol` (constants, CRC-14, LDPC encoder, codec, GFSK modulator) | yes |
| Engine / QSO / TX gate | `z30-engine` (`pipeline.rs`, `slots.rs`, `runtime.rs`, `engine.rs`, `qso.rs`, `txgate.rs`, `ptt.rs`, `rig.rs`) | yes |
| PTT / CAT | `z30-io`: `rigctld.rs` (CAT and CAT PTT over TCP), `serial_ptt.rs`, `cm108.rs` (feature `cm108`), `VoxPtt` | yes |
| Logging | `z30-io/src/logbook.rs` (SQLite + ADIF), `migrate.rs` | yes |
| Benchmarking | `z30-cli/src/suite.rs`, `bench.rs`. They link `z30-channel` into `z30` and are reachable only through `--benchmark` | shipped in the binary, isolated from live paths |
| Python bindings | `crates/z30-py` (PyO3). A workspace member, **not** in any release artefact | research only |
| Python oracle | `legacy/python-oracle` (frozen; `FROZEN.sha256`) | no |
| Browser runtime / TypeScript | `legacy/browser-runtime` (no build/dev/start scripts; CI enforces this) | no |
| Research scripts | `research/paired_receiver.py`, `summarize_suite.py` | no |

The following searches were run over `crates/` for `Command::new`, `std::process`, `python`, `node`, `npm`, `libloading`, `dlopen`, `extern "C"`, `web_dist`, `legacy/`, `.py`, `.ts`, `http://`, `TcpStream`, `TcpListener`, `UdpSocket` and `env::var`. They found only:

- `timedatectl` (`wallclock.rs:37`, reads the OS sync status);
- `git` and `rustc` in `build.rs` (build time only);
- `TcpStream::connect_timeout` to the configured rigctld (`rigctld.rs:34`);
- `Z30_HOME` / `XDG_CONFIG_HOME` / `HOME` path lookup (`paths.rs`).

There are **no** subprocess, FFI, path-based or configuration-based routes to any legacy runtime.

## 3. Production dependency graph

```
z30-gui (egui/eframe)                       z30 (clap CLI; receive-only)
   │ Command / ArcSwap<EngineSnapshot>         │  --receive / --decode / --loopback-test
   ▼                                           ▼
z30_engine::runtime::start ─ threads: dsp │ decode │ rig │ control │ PTT watchdog
   │
   ├─ audio:   z30_io::audio::CpalInput ─ring→ RxPipeline::push
   │           (Resampler → SlotStore → SampleClock → SlotScheduler.poll)
   ├─ decoder: SlotEvent::Ready(job) → Receiver::decode_slot(job.samples, cfg.rx_config())
   │           (baseband → Costas sync → FrameSpectra/LLRs → LDPC+OSD → AP → LS-SIC; snr_db: Option)
   ├─ QSO:     Engine::on_slot_report → Sequencer::on_decodes → QsoNote::Complete
   ├─ logging: QsoRecord::validate → Event::Logged → LogSink (z30_io::logbook::Logbook::insert → validate)
   └─ TX:      TxScheduler::tick → Engine::plan_tx → txgate::can_transmit
               (callsign, licence, band plan, rig readback, Message::encode + EncodedMessage::verify_round_trip,
                from-station, PTT/hardware) → tx_audio (gfsk::Modulator) → PttController::key → AudioOutput::play
IO: z30_io::{rigctld, serial_ptt, cm108 (feature), VoxPtt, wallclock, paths, logbook, migrate}
Protocol: z30_protocol (codec, crc, ldpc, symbols, gfsk) — used by dsp, engine, io
```

The production path is **Rust GUI/CLI → Rust engine → Rust DSP → Rust protocol → Rust IO**. There is no edge to Python, Node, a browser, legacy TypeScript or a legacy decoder.

## 4. Legacy separation verification

| Question | Answer | Evidence |
| :--- | :--- | :--- |
| Can the Rust application launch legacy code? | **No** | No process spawn apart from `timedatectl`. No reference to `legacy/` in any crate |
| Can a production configuration cause it? | **No** | `Config` has no runtime, path or fallback field (`config.rs`) |
| Can the Rust decoder call the Python oracle? | **No** | `z30-dsp` depends only on `z30-protocol`, `rustfft`, `realfft`, `rayon` |
| Can a Rust failure trigger a legacy fallback? | **No** | A failed device or PTT opens `NoInput`/`NoOutput`/`NoPtt` and refuses TX (`app.rs:48–93`). A decoder panic is `MissReason::DecoderFault` (`runtime.rs:376–386`) |
| Are legacy binaries in release packages? | **No** | `release.yml` asserts that the archive contains exactly `z30`, `z30-gui`, `README.md`, `LICENSE`, `INSTALL.md`, `BUILDINFO.txt`. The workflow has **never run on a tag** (no release exists), so this was verified by reading the workflow, not by inspecting an artefact |
| Are legacy files in installers? | **No installer exists.** The only packaging file is `packaging/linux/z30-gui.desktop` (`Exec=z30-gui`) |
| Does the production build depend on Node? | **No** | Built with no `node`/`npm` on the PATH (§20) |
| Does the production build depend on Python? | **No** for `-p z30-cli -p z30-gui`, which built with no Python on the PATH. **Yes for `cargo build --workspace`**: `z30-py`'s PyO3 build script fails with "no Python 3.x interpreter found" (§20). This is a development-build dependency only, not a runtime one |

## 5. C-01 verification — live slot scheduling

**Code path (live):** `CpalInput` → `RxPipeline::push` → `SlotScheduler::poll` (`slots.rs:124–160`). A slot is emitted only when `first + window_len <= store.end()`, i.e. when every sample of [slot − 1.5 s, slot + 25.5 s] is in the store, decided in **sample time**. The window is copied by absolute index. It then goes through `job_tx` (capacity 1) → the decode thread → `decode_slot`.

**The test runs the live path.** `live_runtime.rs::c01_…` calls the production `runtime::start` with its real threads, pipeline and scheduler. Only the sound card and wall clock are virtual. It asserts:

- nothing is decoded while audio is stalled at slot + 25.0 s;
- the decoded window equals `audio[slot−1.5 s .. slot+25.5 s]` sample for sample;
- frames at DT ±1.4 s decode with correct DT (±20 ms), frequency (±0.5 Hz) and SNR.

The virtual card runs at 6 kHz, so **the resampler is not exercised by this test**. It is covered by `resample::tests` separately.

**Mutation results** (§23):

| Mutation | Result |
| :--- | :--- |
| C01-a window ends 0.5 s early | KILLED (`live_runtime`, `soak_24_hours…`, `closed_loop_qso…`) |
| C01-b decode 0.5 s early, tail zero-padded (the legacy defect) | KILLED |
| C01-c slot boundary +100 ms | KILLED |
| C01-d slot boundary +5 ms (30 samples) | KILLED |
| C01-e final 0.1 s of the window zeroed | KILLED |

**Status: VERIFIED FIXED — NOT HARDWARE VALIDATED.** Real driver timing, buffer sizes, rate error and device-rate resampling in the live loop have not been exercised with a sound card.

## 6. C-02 verification — sensitivity of the shipped decoder

The only z-30 sensitivity quoted in README, AGENTS.md, docs and wiki is `decode_slot`'s, from `research/results/d8983eeef66e/awgn.json`. It always carries its qualifiers (AWGN simulation, 2500 Hz, blind acquisition, 200 frames, seed, Wilson interval, "not measured on real radio hardware").

- **Reproduced exactly** from the shipped binary (§16).
- **Reproduced independently** within 0.09 dB (§16).
- Oracle figures appear only as history (docs/benchmarking.md §"retired", wiki 17).

**Status: VERIFIED FIXED** (as a simulation figure). The fading figures quoted next to it are affected by N-01.

## 7. C-03 verification — RF/network time synchronisation

- Production (`crates/`) has **no** RF or network time source. The terms "SYNC OK", "confidence", `success=True` and `max(snr` have no occurrence in `crates/` or in either binary (`strings`).
- The only time mechanisms are `SystemWallClock::utc_now` (OS UTC, no offset) and `status_from_timedatectl`. The latter says "NTP-synchronised" **only** for the exact output `yes`, and otherwise "NOT synchronised" or "status unavailable". On Windows and macOS it says "not checked".
- The fresh-install run printed `clock: system clock (synchronisation status unavailable)`.
- The GUI's `dt_median_sec` is labelled a diagnostic and applies no correction. Migration skips "legacy RF time offset".

**Inputs tested.** None of these can manufacture a synchronisation result, because no code path turns audio into time: pure noise, silence, random audio, invalid signals (Costas-correct with random data; LDPC-valid with a wrong CRC) and a synthetic valid frame, 200 slots each. They produced **0 unexpected decodes**; the positive control decoded 200/200 (§16, `audit_nosig.json`).

**Time sources available now:** OS system clock (UTC, NTP status via timedatectl on Linux) — yes. External clock (NTP/GPS) — via the OS only. Measured RF synchronisation — **none**. Synthetic — none. Unknown — reported as "status unavailable / not checked".

**Mutations:**

- C03-a ("synchronised" when timedatectl is absent) — KILLED.
- C03-b (+0.7 s own offset) — KILLED.
- **C03-c (+0.3 s own offset) — SURVIVED.** `utc_is_the_operating_systems_with_no_offset_applied` tolerates 0.5 s, a third of the ±1.5 s DT window (N-07).

`utc_now()` returns `0.0` if the clock reads before 1970 (`wallclock.rs:53`). That is a fabricated fallback, but `QsoRecord::validate` rejects it downstream (N-13).

**Status: VERIFIED FIXED** (a regression-test tolerance gap is recorded as N-07).

## 8. C-04 verification — stale bundle, W1AW default

- `web_dist/`, `web_server.py`, the launcher and the installers are gone from the tree. CI hygiene rejects them.
- `Config::default()` has an empty callsign and no region, class or PTT, and the gate refuses all of them. The fresh-install diagnostics printed four refusals.
- **The release binaries were scanned directly** (`strings`), not just the source: `W1AW` 0, `N0CALL` 0, `web_dist` 0, `index.html` 0. `FN31`/`EM00` occur only in the 63-entry grid table, and FN31 also in the loopback test message `CQ Q0TST FN31`. `NOCAL` is the placeholder constant the gate refuses.

**Status: VERIFIED FIXED.**

## 9. C-05 verification — QSO logging

**Trace:** `Decode` → `Sequencer::on_decodes` (addressed exactly to us, from the station being worked, the expected type) → `QsoRecord` with per-field `Provenance` → `Engine::handle_notes` (sets dial / tx_audio / band / power) → `QsoRecord::validate` → `Logbook::insert` (validates again) → ADIF with `APP_Z30_PROVENANCE`.

| Case | Result |
| :--- | :--- |
| no callsign | `validate` refuses ("no partner callsign"); tested; mutation LOG-a KILLED |
| no grid | stays `None` in SQLite and ADIF; tested; LOG-b (FN31 default) KILLED |
| no RST (not measured) | `report_for(None) = None`, so no report is sent or logged; tested; LOG-d KILLED |
| no RST received | stays `None` in code, **but no test covers it**: LOG-c (−16 default) **SURVIVED** (N-06) |
| invalid grid | the codec refuses off-table grids; `Extra::from_code` can only produce table grids |
| missing timestamp / pre-2020 | refused; LOG-f KILLED |
| partial decode (unrepresentable call field) | `from.call()` is `None`, so it is ignored by the sequencer |
| synthetic decode | there is no synthetic injection path in the engine or GUI (grep; §14) |
| **missing frequency** | **Not handled.** `QsoRecord.dial_hz` is not optional. Without CAT the engine logs `commanded_dial`, which is the configured `dial_hz`, defaulting to **14 076 000 Hz**, tagged `commanded` even though nothing was commanded. A station that never set its dial logs 14.076 MHz (N-05) |
| UTC under a non-UTC zone | `utc_parts` is pure arithmetic on Unix seconds and never reads TZ. Tested under several TZ values; LOG-e (+1 h) KILLED |

Legacy import: `FN31` / `−16` are dropped from auto-logged entries, which also drops genuine values (documented). Imported RST is silently clamped to ±99 (`migrate.rs:317`, tagged `legacy_import`).

**Status: PARTIALLY FIXED.** Every fabrication the original audit named is fixed and (except `rst_rcvd`) mutation-protected. A default dial frequency can still reach the log labelled as "commanded".

## 10. C-06 verification — TX safety

**Complete path:** `TxScheduler::tick` → `Engine::plan_tx` → `txgate::can_transmit`:

- `Message::encode()` (`validate` + payload→message round trip);
- `EncodedMessage::verify_round_trip()`: Costas symbols → tone range → `symbols_to_codeword == codeword` → syndrome 0 → CRC → `to_message == message` → text re-parses;
- `from == my_call`;
- then `hardware_violations`.

Only after all of that: `tx_audio` → `PttController::key` → `output.play`.

A halt, a configuration change or a dial change between plan and key aborts (`h2_…` test).

**Other paths that can put audio out or key:**

- `z30` CLI `--receive`: uses `NoPtt` and a `Silent` output, and sets `tx_unavailable`. It cannot key.
- **`z30 --loopback-test` calls `CpalOutput::play` directly, with no gate** (`loopback.rs:171`). It keys no PTT line, but with a VOX radio on the output it transmits `CQ Q0TST FN31` with no callsign or band-plan check. Its only protection is the `--confirm-no-transmitter` flag, and it does not refuse when the configuration says `ptt = vox` (N-04).

**Independent negative tests** (`evidence/harness`, `roundtrip` mode) — every case is **REFUSED**:

- a data symbol changed (5 positions);
- a Costas symbol changed;
- tone 16;
- a CRC bit flipped with the LDPC re-encoded (valid codeword, bad CRC);
- the payload altered with a valid CRC and LDPC;
- a parity bit flipped with the symbols made consistent;
- the partner call altered at symbol level;
- the message field altered with the frame unchanged.

The encoder refuses `FN42`, `ZY2ABC`, `/P`, `R-12`, ±31, `NOCAL`, missing fields, free text, `CQ … −10`, compound calls and 3-character prefixes. Nothing is substituted.

**Mutation results:**

| Mutation | Result |
| :--- | :--- |
| C06-a `verify_round_trip` always `Ok` | **SURVIVED** (also confirmed by hand: 23 + 6 tests still pass) |
| C06-b gate no longer calls `verify_round_trip` | **SURVIVED** |
| C06-c encoder payload round-trip check removed | **SURVIVED** |
| C06-d from-station check removed | KILLED (`g5`) |
| C06-e legacy grid hashing (FN42→RE78) re-introduced | KILLED (`audit_h2_h3_m6…`, `g6`) |

The substitution defect is guarded by `validate()` and its tests. The whole symbol-level round-trip layer that C-06's remediation added **has no test that fails when it is disabled** (N-03). In addition, `plan_tx` (`engine.rs:396`) calls `msg.encode()` again after the gate has passed. The frame keyed is a second encoding, not the object `verify_round_trip` checked. That is harmless while `encode` is deterministic, but it is structurally weaker than claimed.

**Status: VERIFIED FIXED** for the audited defect (substitution, own-call-only gate). The regression-protection gap is N-03. TX does fail closed.

## 11. High findings

| ID | Verification | Status |
| :--- | :--- | :--- |
| H-01 SIC | Production LS-SIC (`sic.rs`) modifies the residual in place (`subtract_fitted`). Independent physical measurement against the known strong waveform: 18.6–19.5 dB (dP +10) and 28.6–29.6 dB (dP +20) removed; 14.1 / 24.0 dB when the stations are exactly co-located. Weak station: 50/50 with SIC and 0/50 without in every separated cell; 0/50 both ways when co-located; 0 false decodes (`audit_sic.json`). The receiver's own `suppression_db` reads 30–41 dB, overstating by 11–16 dB, as documented. Mutations SIC-a/b/c KILLED | VERIFIED FIXED (simulation) |
| H-02 no real-world validation | `hardware-validation/results/` holds only `.gitkeep`. The procedure exists (`docs/hardware-validation.md`) | NOT FIXED (equipment required, §22) |
| H-03 self-test shown as decodes | No injection path in `z30-engine`/`z30-gui` (grep). Synthetic signals exist only behind `--benchmark` / `--loopback-test`, which write JSON, never the live list. The legacy label test was not re-run here | VERIFIED FIXED |
| H-04 false wiki facts | The named claims are withdrawn (wiki 11 §7, wiki 05/07). **New inaccuracies found:** the fading channel description (N-01) and "21 Costas symbols (3 × 7)" for z-30, whose sync is 7 groups of 3 (N-10) | VERIFIED FIXED (named items); new doc findings N-01, N-10 |
| H-05 decode on UI thread | `runtime.rs` spawns `z30-decode`; the GUI only loads `ArcSwap` snapshots | VERIFIED FIXED — NOT HARDWARE VALIDATED (GUI on a real display not measured) |
| H-06 hard ±1.5 s window, no time source | Documented and measured (timing.json). No built-in time source. **A software mitigation exists and is not implemented:** a DT offset measured from real decodes (the GUI already computes `dt_median_sec`) could correct the slot timing, or the receiver window could be widened. The stated reason is only partly correct | PARTIALLY FIXED |
| H-07 compatibility gap | Documentation now says "implemented, not tested with a radio". The gap itself (no split, only external rigctld, no interoperability) remains | PARTIALLY FIXED |
| H-08 MSRV / CM108 | Workspace **builds and tests on 1.95.0** (139/0/1). **`cargo +1.95.0 clippy -D warnings` fails** (N-02). CM108 compiles and links in the release configuration (`features: cm108`), and `PttConfig::Cm108` → `open_ptt` → `Cm108Ptt::open` is reachable. The release workflow has never run | VERIFIED FIXED (build); N-02 open |
| H-09 tautological OSD | vNext OSD requires a CRC match on the candidate, positive correlation and a distance gate (`ldpc.rs`). `golden_ldpc` tests pass. 0 false decodes in 1 200 noise/invalid slots here | VERIFIED FIXED |
| H-10 per-realisation normalisation | Verified mathematically (Rust `fade`: scale √(n·Σ\|H_k\|²) = √E\|t\|², independent of realisation; Python: `mean(shape²)` with `ifft`'s 1/n) and numerically (§13). **But see N-01** (Doppler spread 1/√2 of nominal) | VERIFIED FIXED (normalisation); N-01 open |

## 12. Medium findings

| ID | Verification | Status |
| :--- | :--- | :--- |
| M-01 rigctl console fabricated state | Production has no console. `--diagnostics` prints only what rigctld returned. Legacy fix not re-run | VERIFIED FIXED |
| M-02 catalogue "STABLE" | Production ships no catalogue ("STABLE" absent from binaries) | VERIFIED FIXED |
| M-03 constant confidence 99 | `Decode` has no confidence field. "confidence" is absent from both binaries | VERIFIED FIXED |
| M-04 network traffic at start-up | The only socket is the rigctld client. The GUI binary's URL strings are library error messages or shader comments; dbus is local IPC | VERIFIED FIXED |
| M-05 network time sync | No network time code in production | VERIFIED FIXED |
| M-06 busy-band placement | `suite.rs::busy` draws frequency and DT uniformly and allows overlaps | VERIFIED FIXED |
| M-07 SNR saturation | See §17.1. Accurate for AWGN −22…+30 dB. Mutations SNR-a/b/c/d/f KILLED; **SNR-e (a −30 dB floor instead of `None`) SURVIVED** (N-08). Not robust to replica mismatch (N-08) | VERIFIED FIXED (AWGN); limitation N-08 |
| M-08 PTT after SIGKILL / power loss | Power loss cannot be solved in software. **SIGKILL of the z-30 process could be partially mitigated** by a separate supervisor process that sends `T 0` to rigctld, or releases the CM108 GPIO, when its parent dies. Not implemented. The in-process watchdog and signal handlers are tested (p4, p4b, p4c, p5) | NOT FIXED (stated reason partly correct) |
| M-09 "77-bit exchange" | Occurs only in SPEC.md/wiki 04 as a withdrawn phrase | VERIFIED FIXED |
| M-10 weak scenario tests | `sensitivity_regression.rs` (≥ 84/100 at −22 dB). Passes on 1.95. Not mutation-tested in this audit | VERIFIED FIXED |
| M-11 aliasing resampler | Polyphase Kaiser resampler with tests. **No published benchmark passes through it** (benchmarks inject 6 kHz directly; N-12) | VERIFIED FIXED |
| M-12 FWD power from config | `app.rs:520–523`: "configuration, not a measurement"; "Forward power / SWR: not measured" | VERIFIED FIXED |

## 13. Low findings

| ID | Verification | Status |
| :--- | :--- | :--- |
| L-01 launcher fallbacks | No launcher. Both binaries exit with an error | VERIFIED FIXED |
| L-02 `./dist` override | Nothing is served; no `TcpListener` outside tests | VERIFIED FIXED |
| L-03 stale −23.1/−21.7 dB | Absent from docs and wiki | VERIFIED FIXED |
| L-04 Python CI matrix | `ci.yml` runs 3.10–3.13 and `pyproject.toml` requires ≥ 3.10 (configuration inspected; CI run not observed) | VERIFIED FIXED |
| L-05 natural-binary mapping | The mapping is normative (SPEC §5), so changing it breaks v1: the reason is correct. **The loss is measurable in software without breaking v1**, and still has not been measured | NOT FIXED |
| L-06 −40 dB bandwidth method | Quoted with the Welch method and bin width. `loopback::tests` reproduces ≈ 50 / 66 Hz | VERIFIED FIXED |
| L-07 LSB not modelled | The gate assumes USB. **rigctld already reports the mode** (`Reading::mode`; `RigStateTracker::reported_mode`) but the gate ignores it, so a software refusal on LSB is available and not implemented | PARTIALLY FIXED |

## 14. Fake / fabricated value audit

Searched in `crates/` (non-test code), with the call path for each hit:

| Value | File:line | Call path / runtime effect | Classification |
| :--- | :--- | :--- | :--- |
| `FN31`, `EM00` | `z30-protocol/src/codec.rs:283` | v1 grid table (`Extra::from_code`) | legitimate protocol |
| `FN31` | `z30-io/src/migrate.rs:105` | `LEGACY_DEFAULT_GRID`, used to **drop** the legacy default | legitimate |
| `FN31` | `z30-cli/src/loopback.rs:39` | loopback test frame `CQ Q0TST FN31` (Q0 is not an issued prefix) | legitimate test signal, but see N-04 |
| `-16` | `migrate.rs:107` | `LEGACY_DEFAULT_RST_RCVD`, used to drop the legacy default | legitimate |
| `-16` | `suite.rs:475,675–677` | benchmark SNR grid | legitimate benchmark |
| `99`, `99.0` | `migrate.rs:317` (clamp ±99), `clock.rs:122` (0.99 rate bound), `bench.rs:97` (p99) | legacy RST clamp, rate sanity bound, percentile | legitimate (the clamp silently alters out-of-range legacy data; low) |
| `success: true` | `z30-dsp/src/ldpc.rs:348,393,406,417,475` | set only after `crc_matches && syndrome == 0` or the OSD CRC/correlation/distance gates | legitimate |
| `W1AW` | `#[cfg(test)]` modules only (`codec.rs`, `ap.rs`, `migrate.rs`) | test inputs; absent from binaries | legitimate test |
| `confidence`, `STABLE`, `SYNC OK` | none in `crates/` or the binaries | — | — |
| `14_076_000` | `config.rs:140` default `dial_hz` | can reach the log as `FREQ`, provenance `commanded` (N-05) | **potential fabricated production value** |
| `tx_level` default `0.0` | `config.rs:114` (derived `Default`) | a new install that saves settings without touching the slider keys the PTT with silent audio (N-09) | configuration default, functional issue |
| `0.0` | `wallclock.rs:53` `unwrap_or(0.0)` | UTC 1970 if the clock precedes the epoch; blocked by `validate` | potential fabricated value, contained (N-13) |
| `dial_hz: 0.0, tx_audio_hz: 0.0` | `qso.rs:399–400` | placeholders overwritten by `Engine::handle_notes` before logging | legitimate (always overwritten) |

## 15. Benchmark integrity

- **Command → harness → receiver:** `z30 --benchmark suite` → `suite.rs::run` → `run_point` → `z30_channel::synthesize` (ground truth stays in the harness) → `Receiver::decode_slot(&x, &RxConfig::default())` → `score()` compares payloads afterwards. The GUI and CLI live paths call the same `Receiver::decode_slot`, with `Config::rx_config()`, whose defaults equal `RxConfig::default()` (AP off).
- **No test or benchmark mode in the decoder.** `z30-dsp/src` has no `cfg` other than the `parallel` feature (bit-identical; tested), no `env::var`, and no reference to truth, fixtures or the oracle. `decode_slot(samples, cfg)` has no other input.
- **Results generated, not copied.** Rebuilding `z30` at HEAD with rustc 1.95.0 and running `--benchmark awgn` and `--benchmark fading` reproduced **every** decoded count and false-decode count, and both crossings, of `awgn.json` (9 points) and `fading.json` (25 points) exactly (`evidence/results/repro_awgn_head.json`, `repro_fading_head.json`).
- **Metadata:** every JSON in `research/results/d8983eeef66e/` names `git_commit = d8983eeef66e` (clean), `rustc 1.98.1`, profile `release`, built 2026-09-24T02:52:21Z (32 s after the commit), `suite_seed = 20260830`. Frame counts are 200 (AWGN, drift, timing, clock, impair, fading), 100 (snr, sic), 50 slots (busy), 400 slots × 5 (false). No result is marked exploratory.
- `z30-dsp`, `z30-protocol`, `z30-channel`, `suite.rs` and `bench.rs` are unchanged from `d8983ee` to HEAD (`git diff --stat`), so the results describe the shipped receiver.
- **Caveat (N-12):** the benchmarks inject 6 kHz windows straight into `decode_slot`. The capture, resampler and scheduler path is not part of any published figure.

## 16. Independent benchmark reproduction

Harness: `evidence/harness/src/main.rs`. Signal = the production transmitter (`gfsk::Modulator::analytic`), real part at a random phase, placed at a fractional DT. Power is measured over the frame's own 24 s. Noise is ChaCha20 N(0, 1), seed base `0x5EED_A0D1_0924`, which is independent of the suite's ChaCha8 seed 20260830 and does not use `z30-channel`. Receiver: `decode_slot`, `RxConfig::default()`.

**AWGN (200 frames/point):**

| SNR (dB) | −25 | −24.5 | −24 | −23.5 | −23 | −22.5 | −22 | −21.5 | −21 | −20 |
| :--- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| decoded % | 0.5 | 0.5 | 9.0 | 25.0 | 46.5 | 75.0 | 92.0 | 100 | 100 | 100 |

| | Claimed | Independently reproduced | Difference | Explanation |
| :--- | --: | --: | --: | :--- |
| 50% | −23.03 dB [−23.13, −22.89] | **−22.94 dB** | +0.09 dB | inside the claimed interval; sampling error of 200-frame points (e.g. 46.5% vs 52.5% at −23 dB) |
| 90% | −22.06 dB [−22.15, −21.80] | **−22.06 dB** | 0.00 dB | — |
| false decodes | 0 | 0 in 2 000 frames | — | — |

The shipped binary reproduced the published file exactly (§15).

**Fading.** The published −20.79 / −21.31 / −21.07 dB and 0 of 800 frames for high-latitude moderate were reproduced exactly from the shipped binary, so they are genuinely produced by the ensemble-normalised model in the code. They are **software simulation** only, and (N-01) the simulated Doppler spreads are 0.071 / 0.354 / 0.707 / 7.07 Hz, not the labelled 0.1 / 0.5 / 1 / 10 Hz.

**Re-run:**

```
cargo build --release --manifest-path evidence/harness/Cargo.toml   # path deps point at a z-30 checkout
z30-audit awgn|snr|nosig|watterson|sic|mismatch|roundtrip
```

## 17. Protocol verification

### 17.1 SNR (M-07)

- **Estimator:** a per-symbol least-squares complex gain *g_s* of the decoded frame's replica over bins 0–17 and 62–63 of the 64-point symbol spectra. Signal S = mean_s(|g_s|²·‖R_s‖²) − n_bin·Σ(‖R_s‖²/‖R_s‖²_fit), which removes the expected LS-projection noise.
- **Noise:** the median of |Y − gR|² over bins 20–27 and 37–59, divided by ln 2 (the exponential median → mean). That residual is **independent of the fit bins**: the bins are disjoint, and white noise is independent across FFT bins.
- **Unbiased in AWGN** (measured below).
- **Data-aided:** it uses the *decoded* symbols, i.e. the receiver's own CRC-checked decision, never the transmitted truth. That is usable on unknown signals, but only after a successful decode, and a false decode would give a wrong SNR.
- **`Option` end to end:** `Decode::snr_db` → `DecodeRow` → `api::snr_text` ("--", "<-22", ">+30") → `qso::report_for(Option)` (None ⇒ no report message, no `rst_sent`) → capture JSON. **No default reaches QSO reporting** (LOG-d KILLED).

Independent sweep (100 blind frames per point):

| True SNR (dB) | Decoded | Measured − true: bias (dB) | sd (dB) | Range measured (dB) |
| --: | --: | --: | --: | :--- |
| −30 | 0 | — | — | — |
| −28 | 0 | — | — | — |
| −26 | 0 | — | — | — |
| −24 | 7 | +0.41 | 0.46 | −24.12…−22.68 |
| −23 | 40 | +0.17 | 0.42 | −23.60…−21.97 |
| −22 | 92 | +0.04 | 0.40 | −22.76…−21.00 |
| −20 | 100 | −0.02 | 0.30 | −20.74…−19.26 |
| −15 | 100 | −0.00 | 0.18 | −15.41…−14.60 |
| −10 | 100 | +0.02 | 0.15 | −10.37…−9.64 |
| −5 | 100 | −0.00 | 0.14 | −5.34…−4.66 |
| 0 | 100 | −0.02 | 0.13 | −0.40…+0.44 |
| +5 | 100 | −0.05 | 0.12 | +4.64…+5.35 |
| +10 | 100 | −0.07 | 0.12 | +9.62…+10.21 |
| +20 | 100 | −0.10 | 0.13 | +19.48…+20.18 |
| +30 | 100 | −0.30 | 0.27 | +28.44…+30.12 |
| +40 | 100 | −1.74 | 1.69 | +32.10…+40.01 |
| +50 | 100 | −6.57 | 4.03 | +34.36…+49.83 |

There is no hidden clip: values above +30 are real estimates, and the display turns them into ">+30". **Soft saturation starts above +30 dB even on AWGN.** Near threshold the bias is positive (+0.4 dB at −24 dB) because only the frames that happened to be stronger decoded.

**Robustness to a non-exact replica** (60 frames each, `audit_mismatch.json`):

| Condition | Result |
| :--- | :--- |
| random-walk phase noise, 2°/symbol rms | −0.17 dB at +20 dB, −0.90 dB at +30 dB |
| random-walk phase noise, 5°/symbol rms | −0.49 dB at +20 dB, −2.88 dB at +30 dB; unbiased at 0 and −15 dB |
| Watterson, measured against each frame's realised SNR | moderate: −0.36 dB at +10 dB, −1.92 dB at +20 dB; poor: −4.42 dB at +20 dB |

→ Reliable where it matters for reports (≤ +10 dB). **Above ~+15 dB the estimator re-saturates on any real-world mismatch** (N-08).

### 17.2 Watterson model (H-10, N-01)

Measured on the Rust `z30_channel` (400 realisations) and on the Python oracle (300 realisations) with a constant tone. Tap *g(t)* = faded analytic / clean analytic. The Doppler spread comes from the autocorrelation at two lags, using ρ(τ) = exp(−2π²σ²τ²).

| Preset (nominal 2σ) | Frame power mean | Frame power CV | Tap E\|g\|² | Re/Im sd | P(\|g\|² < 0.1) | Measured 2σ spread (Rust / Python) |
| :--- | --: | --: | --: | :--- | --: | :--- |
| good (0.1 Hz) | 1.075 | 0.63 | 1.055 | 0.72 / 0.73 | 0.080 | **0.066 / 0.072 Hz** |
| moderate (0.5 Hz) | 1.006 | 0.27 | 1.005 | 0.68 / 0.74 | 0.117 | **0.353 / 0.355 Hz** |
| poor (1 Hz) | 1.001 | 0.18 | 1.006 | 0.68 / 0.74 | 0.105 | **0.706 / 0.708 Hz** |
| high-moderate (10 Hz) | 1.004 | 0.06 | 0.999 | 0.71 / 0.70 | 0.098 | **7.064 / 7.07 Hz** |

- **Ensemble normalisation: correct.** The mean is ≈ 1. Realisation-to-realisation power variation survives, with CV 0.63 for the slow channel against 0 under per-frame normalisation. The taps are complex Gaussian (Re/Im sd ≈ 0.707; P(\|g\|² < 0.1) ≈ 1 − e^{−0.1} = 0.095).
- **Doppler spread: wrong by 1/√2 in both implementations.** Both apply the *amplitude* shaping exp(−½(f/σ_f)²) with σ_f = spread/2. The resulting power spectrum exp(−(f/σ_f)²) has standard deviation σ_f/√2, so 2σ = spread/√2.
- The Python docstring (`channel.py:130`) says the **power** spectrum has σ = spread/2, and so do `fading.json` ("sigma = spread / 2") and wiki 11. That contradicts the implementation.

### 17.3 Other protocol points

- Round-trip and refusal behaviour: §10.
- The golden vectors pass (`golden.rs`, `golden_ldpc.rs`, `golden_demod.rs`).
- The flagged `codec.rs:259` expression `pb != 0 && !(pa != 0 && pb == 0)` is logically just `pb != 0`. It has no behavioural effect; `exhaustive_canonical_decode_round_trip` passes.

## 18. FT8 comparison verification

Checked against `wiki/11`, README and SPEC. Every row carries an evidence class ([M]/[D]/[P]/[N]).

| Quantity | Check |
| :--- | :--- |
| Eb/N0 per message bit | z-30: −23.03 + 10·log₁₀(2500·24.0/63) = −23.03 + 29.79 = **6.76 dB**. FT8: −21.0 + 10·log₁₀(2500·12.64/77) = −21.0 + 26.13 = **5.13 dB**. Difference **1.63 dB**, correctly derived from the documented parameters (24.0 s, 63 bits; 12.64 s, 77 bits; the 50% points) |
| Extra energy | 10·log₁₀(24/12.64) = 2.78 dB ✓ |
| Shannon lines | −1.59 − 29.79 = −31.38 dB ✓; −1.59 − 26.13 = −27.72 dB ✓; distances 8.35 / 6.72 dB ✓ |
| z-30 frame parameters | 75 symbols × 0.32 s = 24.0 s ✓; 54 data + 21 sync ✓; LDPC (216, 77) ✓ |

Inconsistencies found:

- **N-10:** "Sync: 21 Costas symbols (3 × 7)" for z-30. SPEC §2 and `SYNC_POSITIONS` define 7 groups of 3 (0–2, 7–9, 17–19, 27–29, 37–39, 47–49, 72–74).
- **N-01:** the fading rows name ITU-R F.1487 Doppler spreads the simulator does not produce.
- The occupied-bandwidth row is tagged "[M] (`z30 --loopback-test`)", but it was measured by `loopback::tests` on a synthetic recording. No loopback test has been run on hardware.

The methodology was not altered and no ranking is offered.

## 19. Build / MSRV verification

Clean target directories were used for each toolchain.

| Command | rustc 1.95.0 (declared MSRV) | rustc 1.98.1 (stable) |
| :--- | :--- | :--- |
| `cargo fmt --all --check` | pass | pass |
| `cargo clippy --workspace --all-targets --exclude z30-py -- -D warnings` | **FAIL**: `clippy::overly_complex_bool_expr` (deny-by-default) at `crates/z30-protocol/src/codec.rs:259` | pass |
| `cargo test --workspace --exclude z30-py --release` | **139 passed, 0 failed, 1 ignored** (`golden_ldpc::screen_osd_pool`, a manual helper needing `Z30_POOL`) | not re-run |
| `cargo build --workspace --release` | pass (with a Python interpreter present); **fails without one** (z30-py) | — |
| release config `-p z30-cli -p z30-gui --features …cm108` | pass, also with no Python or Node on the PATH | — |

- **Declaration consistency:** `Cargo.toml` `rust-version = "1.95"` (workspace-inherited by all 8 crates); CI `msrv` job reads it from `Cargo.toml`; README badge "1.95+", docs/install.md "Rust 1.95 or newer". These are consistent. The CI `msrv` job runs build and test but **not clippy**, which is why N-02 went unnoticed. README's contributor instructions (`cargo clippy -- -D warnings`) fail on the declared MSRV.
- **Test names inspected** (`evidence/logs/test_names_1.95.txt`). They exercise the important production paths: the live runtime through `runtime::start`, the 24 h virtual-clock soak, a closed-loop QSO through pipeline, decoder, gate, sequencer and logger, the transmit gate (g1–g6, h1–h2, r1–r6, p4–p5, z1–z2), the logbook/ADIF, SNR accuracy, SIC, and the golden vectors.
- **Gaps:** there is no negative round-trip test (N-03), no `rst_rcvd` absence test (N-06), no `snr_db = None` test at the DSP level (N-08), and no test covering the resampler inside the live runtime (N-12).

## 20. Release artefact verification

- **`--version`** (the 1.95 cm108 build of HEAD):
  - `z30`: version 0.9.0, `commit: 84033d4531b3`, build date, `rustc 1.95.0`, target, arch, profile, `features: cm108 (CM108/CM119 GPIO PTT)`, protocol v1, "no Python, Node or browser component". The commit matches `git rev-parse --short=12 HEAD`; the tree is clean.
  - `z30-gui`: the same fields **except the compiler and runtime lines** (N-14).
- **Dependencies (`ldd`):** `z30` and `z30-gui` link libasound, libgcc_s, libm, libc, and with CM108 also libudev and libcap. No libpython, no Node. `z30-gui` loads GL/X11/Wayland at runtime through winit/glow (not visible in `ldd`), which is expected for a native GUI.
- **Strings:** see §8. The only `.py` string is `gdb_load_rust_pretty_printers.py` (a debuginfo section; `debug = 1` in the release profile), which is never executed. No `web_dist`, `index.html`, `python`, `node_modules` or `timeapi`.
- **No release has been published.** The release workflow has never run, so the archive layout and `BUILDINFO.txt` are verified only by reading the workflow.

## 21. Documentation verification

| Topic | Verdict |
| :--- | :--- |
| Architecture | README, AGENTS.md, docs/architecture.md, wiki and code agree: Rust only, no fallback |
| Sensitivity | Consistent and qualified everywhere (`−23.03 [−23.13, −22.89]`, simulation). Oracle numbers appear only as history |
| FT8 comparison | Arithmetic correct; N-01 and N-10 inconsistencies |
| Hardware status | Consistent: "not yet performed" in README, wiki 01/06/09/10/13/Home, docs/hardware*.md, the release notes template and the `.desktop` comment. **No document contradicts "no hardware validation was performed"** |
| Supported platforms | wiki 09 "builds and passes tests in CI" (CI runs not observed by this audit) — consistent with the workflows |
| Protocol behaviour | SPEC ↔ code consistent. wiki 11 "3 × 7" (N-10) |
| SIC | docs/sic.md and wiki 05 match the measurements. `suppression_db` is labelled internal |
| SNR | "validated −22…+30 dB" is accurate for AWGN only. KNOWN_LIMITATIONS says "not validated on fading or real audio" — correct, and this audit quantifies the high-SNR bias (N-08) |
| Time synchronisation | Consistent (wiki 07, docs/synchronization.md) |
| Rig / PTT support | "implemented, none tested with a radio" — consistent. `loopback-test` doc says "keys nothing": true for PTT lines, but VOX (N-04) |
| Fading channel | **Incorrect:** "Gaussian Doppler spectrum (sigma = spread/2)" (`fading.json`, oracle docstring, wiki 11 source text) vs implementation (N-01) |
| "Protocol validated: Yes — independent re-implementation from SPEC.md" | The cited evidence (E007) is **not in the repository**, so it is unverifiable here (N-11). The Rust ↔ oracle golden-vector parity *is* verifiable and passes |

**Hardware-claim classification** of every occurrence of tested / validated / real radio / on-air / hardware / CM108 / CAT / PTT in README, docs and wiki:

| State | What falls in it |
| :--- | :--- |
| software tested | the protocol, receiver, gate, logbook, scheduler (simulation) |
| hardware framework implemented | cpal audio, rigctld CAT/PTT, serial RTS/DTR, CM108, VOX, `--loopback-test` |
| hardware tested | none |
| on-air tested | none |

No document places anything in the last two states.

## 22. Hardware validation status

**No hardware validation has occurred.** `hardware-validation/results/` is empty (`.gitkeep`). This audit used no hardware either.

**H-02 — exact equipment required:**

- **Audio loopback (A1–A4):**
  - a USB audio interface (or two sound cards), with a line-level loopback cable and, if needed, an attenuator;
  - one interface at 44.1 kHz and one at 48 kHz;
  - an NTP-disciplined host.
- **Radio into a dummy load (R1–R6):**
  - an HF SSB transceiver supported by Hamlib `rigctld` (model number, firmware);
  - its CAT cable or USB-CAT, and a data interface (e.g. the rig's internal USB codec, a SignaLink or a Digirig);
  - for PTT coverage: a USB-serial adapter with RTS/DTR keying, a CM108/CM119 interface with GPIO wired to PTT, and a rig with VOX;
  - a non-inductive dummy load rated for full power;
  - an in-line RF power/SWR meter;
  - a second receiver or SDR to observe the emission (bandwidth, frequency, spurs).
- **Kill test:** the same setup, with the radio's TX time-out configured.
- **On-air (O-series):** an antenna, a licensed operator, a second z-30 station (a second radio plus computer), and GPS/PPS or NTP time on both.

## 23. Remaining limitations

**Hardware:** everything in §22.

**Protocol limitations:**

- 63-bit messages with no roger bit;
- only 63 grid squares, and standard callsigns only;
- reports limited to −30…+30 dB;
- natural-binary mapping (loss unmeasured, L-05);
- a hard ±1.5 s DT window;
- no decode when the Doppler spread exceeds 3.125 Hz;
- no version field.

**Software limitations:**

- the SNR estimate is biased low above ~+15 dB on non-ideal signals (N-08);
- the fading simulations run at 1/√2 of their labelled Doppler (N-01);
- no built-in time source;
- USB assumed;
- external rigctld only;
- CAT/CM108 stay keyed after SIGKILL or power loss (M-08);
- the tuning-resolution probe is not wired in;
- no split operation;
- legacy import cannot recover times.

## 24. Regression risk

| Area | Protection | Risk |
| :--- | :--- | :--- |
| C-01 scheduling | 5/5 mutations killed; live runtime test | low (hardware timing untested) |
| C-03 time | 2/3 killed; a 0.3 s own offset survives | low–medium |
| C-05 logging | 5/6 killed; `rst_rcvd` fabrication survives; frequency provenance untested | medium |
| C-06 TX round trip | 2/5 killed; **round-trip layer unprotected** | **medium–high** |
| SIC | 3/3 killed | low |
| SNR | 5/6 killed; `None` → floor survives | low–medium |
| Channel model | the ensemble test passes, but it cannot detect N-01 (no spectral test) | medium |
| MSRV | build and test covered in CI; clippy on the MSRV not covered | low |
| Loopback / VOX | no guard | medium |

## 25. Final finding matrix

"HW?" = hardware required to close the finding.

| ID | Original finding | Current status | Evidence | Regression test | HW? | Remaining risk |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| C-01 | Installed receiver did not decode live audio | VERIFIED FIXED — NOT HARDWARE VALIDATED | §5; mutations C01-a–e killed | `live_runtime::c01_…`, `virtual_clock` soak | yes | real-device timing, resampler in the loop |
| C-02 | −22.9 dB presented as the shipped decoder's sensitivity | VERIFIED FIXED | §6, §15, §16 (exact + independent reproduction) | CI benchmark provenance job | no (sim) | fading labels (N-01) |
| C-03 | RF time sync succeeded on noise, persisted offsets | VERIFIED FIXED | §7; no RF/net sync; 0 decodes on noise/invalid | `wallclock::tests` (C03-c survives) | no | 0.5 s test tolerance (N-07) |
| C-04 | Stale bundle defaulting to W1AW | VERIFIED FIXED | §8; binary `strings` scan | `config::tests::a_new_installation…`, CI strings step | no | none |
| C-05 | Auto-logger fabricated QSO fields | **PARTIALLY FIXED** | §9 | `qso_logging.rs`, `logbook_integrity.rs` (LOG-c survives) | no | default dial logged as "commanded" (N-05); `rst_rcvd` untested (N-06) |
| C-06 | Packer substituted grids/calls; gate checked own call only | VERIFIED FIXED | §10; all 12 corruptions and 13 unsupported messages refused | `round_trip.rs`, `safety.rs` g5/g6 (C06-a/b/c survive) | no | round-trip layer untested (N-03); loopback/VOX (N-04) |
| H-01 | Legacy SIC not physical; duplicate decodes | VERIFIED FIXED | §11; 18.6–29.6 dB physical suppression | `sic_regression.rs`, `channel_scenarios.rs` | no (sim) | real collisions unmeasured |
| H-02 | No real-world validation | NOT FIXED | §22; results dir empty | none possible in software | **yes** | all hardware behaviour |
| H-03 | Self-test shown as real decodes | VERIFIED FIXED | §11, §14 | review; legacy label test (not re-run) | no | none in production |
| H-04 | False wiki facts | VERIFIED FIXED | §11, §21 | review only | no | new doc errors N-01, N-10 |
| H-05 | Legacy decode on UI thread | VERIFIED FIXED — NOT HARDWARE VALIDATED | `runtime.rs` decode thread | `live_runtime` (indirect) | yes (display) | GUI frame rate unmeasured |
| H-06 | Hard ±1.5 s window, no time source | PARTIALLY FIXED | §11 | `timing.json`, wallclock tests | partly (GPS/PPS) | DT-based correction possible, not done |
| H-07 | Compatibility far below WSJT-X | PARTIALLY FIXED | §11 | review | yes | feature gap |
| H-08 | MSRV did not build; CM108 absent | VERIFIED FIXED | §19, §20 | CI `msrv` job | no | clippy fails on 1.95 (N-02); release never run |
| H-09 | Legacy OSD CRC tautological | VERIFIED FIXED | §11; 0 false decodes | `golden_ldpc.rs` | no | none |
| H-10 | Watterson normalised per realisation | VERIFIED FIXED | §17.2 | `watterson_preserves_power_over_the_ensemble…` | no | Doppler 1/√2 (N-01) |
| M-01 | rigctl console fabricated rig state | VERIFIED FIXED | no console in production | legacy test (not re-run) | no | none |
| M-02 | Catalogue "STABLE", runtime date | VERIFIED FIXED | no catalogue; not in binaries | legacy test (not re-run) | no | none |
| M-03 | Constant confidence 99 | VERIFIED FIXED | no field; not in binaries | review | no | none |
| M-04 | Network traffic at start-up | VERIFIED FIXED | rigctld is the only socket | review | no | none |
| M-05 | Network time sync precision / TZ bug | VERIFIED FIXED | no network time code | legacy test (not re-run) | no | none |
| M-06 | Busy band non-overlapping | VERIFIED FIXED | `suite.rs::busy` | `random_overlapping_bands…` | no | sim only |
| M-07 | vNext SNR saturated | VERIFIED FIXED | §17.1 (AWGN −22…+30: \|bias\| ≤ 0.30 dB) | `snr_accuracy.rs` (SNR-e survives) | yes (real audio) | high-SNR bias on non-ideal signals (N-08) |
| M-08 | CAT/CM108 PTT not released on SIGKILL/power loss | NOT FIXED | §12 | p4/p4b/p4c/p5 (in-process only) | yes (R-series kill test) | radio TOT is the only defence |
| M-09 | "77-bit exchange" wording | VERIFIED FIXED | grep | review | no | none |
| M-10 | Scenario tests too weak | VERIFIED FIXED | `sensitivity_regression.rs` passes | itself | no | single point |
| M-11 | Legacy resampler aliases | VERIFIED FIXED | `resample::tests` | same | no | not in any benchmark (N-12) |
| M-12 | FWD power displayed the configuration | VERIFIED FIXED | `app.rs:520–523` | review | no | none |
| L-01 | Launcher fell back to Tk / benchmark | VERIFIED FIXED | no launcher | CI hygiene | no | none |
| L-02 | `./dist` override | VERIFIED FIXED | no server | CI hygiene | no | none |
| L-03 | Stale −23.1/−21.7 dB | VERIFIED FIXED | grep | review | no | none |
| L-04 | CI Python versions vs floor | VERIFIED FIXED | `ci.yml`, `pyproject.toml` | CI matrix | no | none |
| L-05 | Natural-binary mapping, loss unmeasured | NOT FIXED | SPEC §5 | none | no | loss unknown; measurable in simulation |
| L-06 | −40 dB bandwidth depends on RBW | VERIFIED FIXED | Welch parameters stated | `loopback::tests` | yes (TX/ALC) | transmitter effect unmeasured |
| L-07 | LSB not modelled | PARTIALLY FIXED | §13; mode read but not gated | none | no | wrong-sideband TX |

**New findings from this audit:**

| ID | Severity | Finding | Location |
| :--- | :--- | :--- | :--- |
| N-01 | Medium | Watterson Doppler spread is 1/√2 of nominal in Rust and Python. Docs, JSON and docstring claim σ = spread/2 of the power spectrum. The fading results are labelled as ITU-R F.1487 presets they do not simulate | `z30-channel/src/lib.rs:125–128`, `legacy/python-oracle/z30_dsp/channel.py:152–155` |
| N-02 | Medium | `cargo clippy -D warnings` fails on the declared MSRV 1.95.0 (deny-by-default lint). CI does not run clippy on the MSRV | `z30-protocol/src/codec.rs:259`, `.github/workflows/rust.yml` |
| N-03 | Medium | The symbol-level round-trip check has no negative test (mutations C06-a/b/c survive). `plan_tx` transmits a re-encoding, not the verified object | `txgate.rs:196–201`, `engine.rs:396` |
| N-04 | Medium | `--loopback-test` plays audio past the transmit gate. With a VOX radio it transmits with no callsign or band-plan check, and it does not refuse `ptt = vox` | `z30-cli/src/loopback.rs:136–172` |
| N-05 | Low–Medium | The logged frequency can be the default configured dial (14.076 MHz), tagged `commanded`, with no CAT | `engine.rs:269–274`, `config.rs:140` |
| N-06 | Low | No test that a missing received report stays missing (LOG-c survives) | `qso_logging.rs` |
| N-07 | Low | The wall-clock test tolerates a 0.5 s own offset (C03-c survives) | `wallclock.rs` tests |
| N-08 | Low | SNR: no DSP test for `None` (SNR-e survives). High-SNR low bias under phase noise and fading (−2.9 to −4.4 dB). Reports below −22 dB are sent as numbers while the display shows "<-22" | `demod.rs:203`, `qso.rs::report_for`, `api.rs::snr_text` |
| N-09 | Low | Default `tx_level = 0.0`: a new (non-migrated) install keys the transmitter with silent audio until the slider is moved | `config.rs:114` |
| N-10 | Low | wiki 11: z-30 sync "3 × 7" should be 7 × 3 | `wiki/11…:30` |
| N-11 | Low | "Protocol validated — independent re-implementation (E007)": the evidence is not in the repository | README:48, wiki Home/01/03/04/10 |
| N-12 | Info | No published benchmark covers the capture / resampler / scheduler chain. The C-01 live test runs at the 6 kHz device rate | `suite.rs`, `live_runtime.rs` |
| N-13 | Low | `utc_now()` falls back to 0.0 (1970); contained by `validate` | `wallclock.rs:53` |
| N-14 | Low | `z30-gui --version` lacks the compiler and runtime lines that docs/install.md says `--version` prints | `z30-gui/src/main.rs:12` |
| N-15 | Info | `cargo build --workspace` needs a Python interpreter (z30-py / PyO3). Production builds do not | `crates/z30-py` |

## 26. Recommended next actions

1. **N-01:** make the *power* spectrum's standard deviation spread/2. The amplitude filter should be exp(−¼(f/σ_p)²) with σ_p = spread/2, which is equivalent to setting σ_f = spread/√2 in the existing exp(−½(f/σ_f)²). Fix the normalisation sum to match. Add a spectral test (the autocorrelation method of §17.2). Re-run `fading` and re-label the published figures.
2. **N-03:**
   - add negative `verify_round_trip` tests (the 12 cases in `evidence/harness`, `roundtrip` mode);
   - add a gate test whose encoder is forced to fail the round trip;
   - pass the verified `EncodedMessage` from `can_transmit` into `TxPlan` instead of re-encoding.
3. **N-02:** simplify `codec.rs:259` to `pb != 0` and add `cargo clippy` to the CI `msrv` job.
4. **N-04:** make `--loopback-test` refuse when `cfg.ptt == Vox` (and whenever a rigctld is configured), or route it through the gate.
5. **N-05:** store `dial_hz` as `Option`/`Configured` when no rig control has confirmed or commanded it. Have the engine label it `configured`, not `commanded`.
6. **N-06, N-07, N-08:**
   - assert `rst_rcvd == None` when no report was received;
   - tighten the wall-clock tolerance to ≤ 10 ms;
   - add a DSP test that a zero signal estimate returns `None`;
   - document the high-SNR bias on non-ideal signals.
7. **L-07:** refuse transmission when rigctld reports `LSB`/`PKTLSB`.
8. **H-06:** consider an explicit, labelled DT-median correction measured from real decodes.
9. **M-08:** consider an out-of-process PTT supervisor for CAT/CM108.
10. **L-05:** measure the Gray-mapping loss in simulation. That does not require changing v1.
11. **J — the actionable hardware / on-air test plan**, in order, each recorded under `hardware-validation/results/`:
    1. **A1** loopback decode, ×10 runs: |DT error| ≤ 50 ms, |Δf| ≤ 1 Hz, bandwidth 99% ≤ 55 Hz / −40 dB ≤ 80 Hz.
    2. **A2** 4 h clock stability.
    3. **A3** 44.1 and 48 kHz devices.
    4. **A4** device unplug/replug, verifying that the capture → resampler → scheduler chain (N-12) reports missed slots and recovers.
    5. **R1** CAT set and readback, plus a hand-QSY refusal.
    6. **R2** each PTT method (CAT, RTS, DTR, CM108, VOX) into a dummy load with a power meter: RF only while TX, released ≤ 200 ms.
    7. **R3–R6** time-out, TX inhibit, rigctld disconnect while keyed.
    8. **Kill test:** SIGTERM and SIGKILL during TX for each method, recording which ones stay keyed (M-08).
    9. **Emission check** on a second receiver/SDR: occupied bandwidth at the RF output with ALC at zero, frequency accuracy, no spurs (L-06).
    10. **SNR calibration** against a calibrated noise source or a reference decoder on recorded audio, at −20…+20 dB (N-08).
    11. **Off-air recordings** (FT8, RTTY, speech, QRN) through `--capture-slots` for the false-decode rate.
    12. **O-series:** two z-30 stations, GPS/NTP time on both, a dummy load first, then an antenna under a licensed operator, logging decode rate, DT and SNR against the other station's report.

---

## 32. Final verdict

- **A. Is Rust vNext now the sole production application?** **YES.**
- **B. Is Python fully separated from production?** **YES.** It is absent from the runtime and from the production build. It is required only by the non-shipped `z30-py` crate when running `cargo build --workspace` (N-15).
- **C. Is the production decoder free from fabricated runtime measurements?** **YES** for the decoder. SNR, DT and frequency are measured, `snr_db` is `Option`, and there is no confidence field. Outside the decoder, the logged dial frequency can be a configuration default labelled "commanded" (N-05).
- **D. Do production benchmarks exercise the real vNext receiver?** **YES.** It is the same `decode_slot`, with no test mode, and the results were reproduced bit for bit from the shipped binary. They do not exercise the capture or resampler chain (N-12).
- **E. Does TX fail closed when a complete message cannot be verified?** **YES.** Every corrupted or unsupported frame tested was refused. The round-trip layer lacks regression tests (N-03), and `--loopback-test` can drive a VOX radio outside the gate (N-04).
- **F. Does logging preserve unknown values rather than fabricate them?** **NO, not completely.** Grid, reports, partner and time are preserved as unknown. Frequency cannot be unknown, and the configured or default dial is logged as "commanded" (N-05).
- **G. Has hardware validation occurred?** **NO.**
- **H. Remaining software defects from the original audit:**
  - C-05 (frequency provenance);
  - H-06 and L-07 (software mitigations available, not implemented);
  - M-08 (partial mitigation available);
  - H-07 (feature gap).

  New ones: N-01 to N-09 and N-13 to N-15 above.
- **I. Remaining protocol limitations:**
  - L-05 natural-binary mapping (loss unmeasured);
  - 63-bit messages with no roger bit;
  - 63-grid table and standard calls only;
  - ±30 dB reports;
  - a hard ±1.5 s window;
  - no decoding with Doppler spread above the 3.125 Hz tone spacing;
  - no version field.
- **J. Work remaining before real hardware / on-air validation:** fix N-03, N-04 and N-05 first, because they touch the transmit and log path. Then carry out §26 item 11 in order (A1–A4, R1–R6 and the kill tests into a dummy load, the emission check, SNR calibration, off-air recordings, then the O-series).
