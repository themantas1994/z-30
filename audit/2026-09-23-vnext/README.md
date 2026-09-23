# z-30 vNext: technical audit, architecture review and rebuild recommendation

**Audited commit:** `7661caa` (`main`, 2026-09-03) · **Audit date:** 2026-09-23 · **Status:** the brief's
Step 8 (report). **Nothing in the product was modified.** Everything this report adds lives in
`audit/2026-09-23-vnext/`: the probes that produced each number, the language proof-of-concept,
and the raw results.

**Measurement host:** Intel Xeon @ 2.1 GHz (AVX-512), 4 vCPU, Linux 6.18. Python 3.11.15,
NumPy 2.2.6 and SciPy 1.15.3 (the pinned `requirements.txt`), Node 22.22.2, Rust 1.94.1. Numba 0.67.0
was installed only for the proof-of-concept. All timings are single-threaded wall clock on an
otherwise idle machine unless stated.

> **How to read the numbers.** Every figure below comes from a script in `probes/` or `poc/` with a
> fixed seed. The raw output is in `results/`. Where a result contradicts the wiki, the method, the
> sample size and an exact p-value sit next to it, as `AGENTS.md` §5 requires. Sample sizes of 40
> frames per point are *exploratory* by the project's own standard (`PUBLISHABLE_FRAMES_PER_POINT`
> = 200). They are used here only where the effect is several dB wide and the paired p-value
> removes any doubt about its direction.

---

## A. Executive summary

### The verdict in one paragraph

z-30 has a **sound protocol core and an excellent research culture**, wrapped around an
**operating receiver that does not work**. The waveform, the (216, 77) LDPC cascade, the
non-coherent Log-MAP demodulator, the Costas-array acquisition in `acquisition.py`, the a priori
decoder and the transmit-safety gate are mathematically correct. Most are well tested, and I
reproduced the decoder and demodulator bit for bit in two other languages. But the receive path
that actually ships (`src/dsp/realReceiver.ts`, driven from `src/App.tsx`) **never receives audio,
because the decode is triggered 1.5 s before its own window is complete**. Called at a time when the
window does exist, it **cannot see signals below about −15 dB**, about 8 dB short of the published
−22.9 dB, and its **"successive interference cancellation" adds power instead of removing it**. The
parts that work are also **implemented twice**, in Python and in TypeScript, and the two already
differ numerically. That duplication is why the benchmark keeps measuring a receiver that does not
ship. **I recommend rebuilding the runtime** (engine, receiver, hardware layer and application shell)
**around a single Rust core.** Keep the Python code as a frozen reference oracle and as the research
harness, and carry over the protocol, the test vectors, the benchmark method and the safety rules
unchanged.

### Current condition

| | |
| :--- | :--- |
| Tests | Python **288 passed** (108 s). TypeScript **469 checks passed**, `tsc --noEmit` clean, production build OK (2.0 MB single chunk). |
| What the tests cover well | Transmit safety, protocol constants, determinism, cross-language constant parity, the local API's authentication |
| What no test covers | The live receive path end to end, SIC effectiveness, multiple signals, slot timing against a clock, message-codec round trips over the real callsign/grid space, and whether the shipped bundle is current |
| Code | ~44k lines: TS DSP 13.7k, React UI 12.0k, Python 10.7k, tests 7.6k. Two full DSP implementations. Three acquisition front ends. Three callsign codecs. |

### Major strengths (keep these)

1. **The engineering standard in `AGENTS.md` and `wiki/16`.** Seeded determinism that survives a
   worker count, paired McNemar comparisons, Wilson intervals and published retractions. This is
   rarer and more valuable than any line of DSP here.
2. **Transmit safety.** A fail-closed `canTransmit()` gate, one keying implementation, a release that
   drives exactly what the key drove, three independent stuck-transmitter layers, and WSJT-X-style
   rig readback. All of it is tested (`tests/transmitPath`, `rigReadback`, `rigProbeAndWatchdog`).
3. **The protocol core is correct.** The GFSK BT = 2 constant-envelope modulator is spectrum-tested.
   The Rician ln I₀ demodulator metric with exact Log-MAP bit demapping is correct. The layered
   NMS/SPA cascade is correct, with a dither derived from the input so the decoder is a pure
   function. `acquisition.py` finds frames across the whole passband as well as it does in its
   ±12 Hz benchmark window (200 paired frames, **0** discordant).
4. **The a priori decoding design**, faithful to WSJT-X. I measured **0 false accepts in 10,000
   pure-noise ladders**.

### Major weaknesses and largest risks

| # | Severity | Finding | Evidence |
| :-- | :-- | :-- | :-- |
| C1 | **CRITICAL** | The live receiver never decodes real audio. `App.tsx` triggers at 24.0 s and asks for a window ending at 25.5 s. It gets `null` and never retries. | `probes/live_rx_trigger.mts`: 0 decodes at 24.05 s and at 25.30 s; decodes only at 25.65 s |
| C2 | **CRITICAL** | The shipped front end reaches its 50% point at about **−14.9 dB** and tops out at 65–85% even at −14 … −10 dB. The published figure is −22.9 dB. The energy candidate detector is blind below about −15 dB, and snapping candidates to a 3.125 Hz grid loses ~35% of frames it *does* find. | Paired 400 frames: 215 : 0 discordant pairs, exact McNemar p = 3.8 × 10⁻⁶⁵ |
| C3 | **CRITICAL** | SIC is anti-cancellation. The replica is the *obsolete* per-symbol-ramped waveform, and no carrier phase is estimated. After the shipped subtraction the station's in-band power is anywhere from 4.3 dB lower to 5.5 dB *higher* than before (mean: 2.6 dB higher); a least-squares fit removes 5–35 dB. Passes 2–3 then re-decode the same station. | `probes/sic_cancellation.mts`, `probes/busy_band.mts` |
| C4 | **CRITICAL** | Decoding runs synchronously on the browser main thread: 7–9 s with 10 signals and 14–18 s with 20, against a 6 s guard and a 0.5 s TX-start window | `probes/busy_band.mts` |
| C5 | **CRITICAL** | Station misidentification. The TX gate accepts callsigns that the 28-bit packer cannot carry, so they go out as other plausible callsigns: `ZY2ABC`→`24BWE` (all ZV–ZZ prefixes wrap modulo 2²⁸), `EA8/G4XYZ`→`Y43OAP`, `G4XYZ/P`→`EY6ACQ`, `3DA0XYZ`→`3W5TEK` | `probes/codec_roundtrip.mts` |
| C6 | **CRITICAL** | The committed bundle in the wheel (`z30_dsp/web_dist`) is **49 commits stale**. It lacks the fix that stopped shipping the real station **W1AW** as the default callsign, the mono-device PTT-tone guard, the receiver fix and AP. It is what `z30` serves whenever no fresh `dist/` exists: after a failed installer build, or from the wheel. | `grep` of the bundle; see §H |

The HIGH list covers logbook fabrication, a grid field that silently substitutes other grids, a lost
"roger" flag, an RF time sync that "succeeds" on noise, and more. It is in §H.

### Recommendation

**Option C: rebuild the runtime, with a protected migration** (the Decision subsection, §I and §J).

- **One Rust implementation** of the protocol and receiver. It is used by the desktop app, a
  headless CLI and (through PyO3 bindings) the existing Python benchmark harness. The benchmark then
  measures the shipped receiver *by construction*, instead of by a policy that has already failed
  three times.
- **The sample clock is master.** A native audio callback writes into a lock-free ring, and the slot
  scheduler runs on sample time. Decoding happens on worker threads, gated by a real Costas-array sync
  search. The GUI renders immutable snapshots and sends commands.
- **Language, from the proof-of-concept.** Rust reproduced the Python LDPC decoder bit for bit on 280
  of 280 frames (success, all 77 bits and the iteration count), and the demodulator's LLRs exactly. It
  runs **75× faster than the shipped Python decoder and 2.9× faster than the shipped TypeScript one**.
  Numba matches Rust within 17% but brings a 7.4 s JIT start and a reproducible cache segfault. That
  data is in §D and in the Technology section.

### Decisions I need from you before any implementation

1. **Direction.** Approve the Rust core and engine, a native GUI, Python for research only, and
   retiring the browser runtime and local HTTP server.
2. **Protocol.** Freeze the v1 wire format bit-exact, or design a v2 message format. C5, H2 and H3 are
   *wire-format* limits: a 7-bit grid/report field and no roger bit. See §J Phase 1.
3. **GUI toolkit.** `egui` (recommended) or Tauri reusing the React components. See §I.8.
4. **Scope of the first vNext release.** I recommend dropping RF time sync (use NTP plus a DT-median
   offset), deferring Android/PWA, and starting with the CAT/rigctld, RTS/DTR, VOX and CM108 PTT
   methods.
5. **Phase 0.** Whether to patch the most dangerous defects in the current codebase now (C5, C6, H1,
   C1, H4), or freeze it.

---

## 1. What z-30 actually is, checked against the brief's premises

The brief describes a Python prototype with RRC filtering, a Costas carrier loop and Gardner timing
recovery. Several of its assumptions do not match this repository, and the audit is only useful if
it corrects them first.

| Brief assumes | Repository reality | Consequence |
| :--- | :--- | :--- |
| Prototype "written primarily in Python" with audio streaming, rig control, QSO sequencing and GUI | The **operating transceiver is TypeScript/React in a browser** (`src/`): audio, receiver, TX, CAT/PTT, QSO sequencing, logbook, UI. Python (`z30_dsp/`) is a loopback HTTP server and hardware bridge, the **reference DSP used by the benchmark and tests**, and Tk utilities. `gui_tkinter.py` is a non-functional shell with no audio, no decoding and a waterfall that is never drawn. | Two DSP implementations. The one that is benchmarked is not the one that runs. |
| RRC matched filter, Costas **loop**, Gardner TED, QPSK/BPSK | **None exist, and none should.** z-30 is **non-coherent 16-FSK** (GFSK BT = 2, 3.125 Hz spacing, 0.32 s symbols). Its "Costas" is a **Costas *array***, a 21-symbol time-frequency sync pattern like FT8's, not a carrier loop. | §C.4 explains why a carrier loop and Gardner TED are the wrong tools here, with measurements. |
| Numba in use | **Not used anywhere.** Runtime deps are NumPy, SciPy, sounddevice, pyserial, cffi and requests (`requests` is imported by nothing). | The "Numba compatibility" questions are answered by the PoC instead (§D). |
| 12 kHz sample rate | 12 kHz is only the Python modem default. The benchmark runs at **6 kHz**. The browser captures at 44.1/48 kHz and decimates to **6 kHz** with a moving average and linear interpolation. | 3840 samples/symbol at 12 kHz, 1920 on the live path. §C.4 covers why that is harmless for FSK. |
| One GUI | React UI (the real one), a Tk "GUI" shell, a Tk setup wizard and a Tk RF-time-sync dialog | Four UI surfaces with overlapping configuration |

### As-is runtime architecture

```
  ┌──────────────────────────── Browser tab / --app window ─────────────────────────────┐
  │  React App.tsx  (main thread; 100 ms setInterval = slot clock, TX trigger, decode)  │
  │    ├─ audioEngine.ts: Web Audio capture (AudioWorklet → postMessage → ring buffer)  │
  │    │                  TX synthesis (z30Waveform.ts, GFSK) → AudioBufferSource       │
  │    ├─ sicDecoder.ts → realReceiver.ts: findCandidates → refineTimingAndFreq →       │
  │    │                  demodulateReal → ldpcCodec.decodeMinSum → "SIC" subtraction   │
  │    ├─ qsoEngine.ts (singleton state) ⇄ React state (copied after every mutation)    │
  │    ├─ catController.ts: canTransmit gate, setPtt; Web Serial / Web HID (Chromium)   │
  │    ├─ qsoLogger.ts: localStorage + server copy                                      │
  │    └─ monteCarloEngine.ts: a second benchmark engine inside the UI                  │
  └──────────────────────────────────┬──────────────────────────────────────────────────┘
                                     │ HTTP (token header + Origin + Host checks)
  ┌──────────────────────────────────┴────── Python z30_dsp.web_server ───────────────────┐
  │  serves web_dist/ or dist/ · /api/rigctl → rigctld TCP · /api/gpio (dead-man) · config │
  └────────────────────────────────────────────────────────────────────────────────────────┘
  Offline (not in the operating path): z30_dsp.benchmark ── acquisition.py / demodulate_mfsk_llrs /
  ldpc.py / ap_decode.py / channel.py  ·  sic_decoder.py (unreachable)  ·  rf_time_sync.py (Tk)
```

---

## 2. What was run (Step 4)

| What | Command | Result |
| :--- | :--- | :--- |
| Python suite | `python -m pytest tests -q` | **288 passed**, 107.9 s (`results/test_suite_python.txt`) |
| TypeScript typecheck | `npm run lint` | clean |
| TypeScript tests | `npm run test:ts` | **469 checks passed**, 69 s (`results/test_suite_ts.txt`) |
| Production build | `npm run build` | OK, 2.4 s; one 1,995 kB chunk (592 kB gzip) |
| Live trigger | `probes/live_rx_trigger.mts` | C1 |
| Shipped receiver threshold, paired | `probes/shipped_threshold.mts` (400 frames) | C2 |
| Frequency snapping root cause | `probes/freq_snapping.mts` | C2 |
| SIC cancellation | `probes/sic_cancellation.mts` | C3 |
| Busy-band slot cost | `probes/busy_band.mts` | C4 |
| Codec round trips | `probes/codec_roundtrip.mts` | C5, H2, H3 |
| Auto-log fields | `probes/autolog_fields.mts` | H1 |
| False decodes on noise | `probes/false_decodes.mts` (10,000 candidates, 10,000 AP ladders) | M1 |
| RF time sync on noise and without audio | `probes/timesync_noise.py` | H4 |
| Whole-band vs ±12 Hz acquisition, paired | `probes/wideband_acquisition.py` (200 frames) | §C.4 |
| Drift and sound-card clock | `probes/drift_and_clock.py` (−20 and −22 dB) | §C.4, H9 |
| Profile of the Python chain | cProfile (`results/cprofile_python_chain.txt`) | §D |
| Language PoC | `poc/` (Python, vectorised NumPy, Numba, TypeScript, Rust on one corpus) | §D, Technology |

---

## B. Architecture assessment

### What is structurally wrong

1. **One specification, two implementations, three receivers.** `z30_dsp/*.py` and `src/dsp/*.ts`
   implement the protocol twice, and parity tests pin *constants*, not behaviour. There are three
   acquisition front ends (`acquisition.py`; `sic_decoder.py`, which has no timing search at all; and
   `realReceiver.ts`). The benchmark exercises the first; the radio runs the third. `AGENTS.md`
   records two incidents of "the benchmark measured a receiver that did not ship" (the demodulator's
   coherence weight, then the browser engine's analytic receive path). `wiki/16` names the
   acquisition front end as a third gap it has not measured. C2 measures it: about 8 dB, the largest
   of the three. The TS and Python decoders are also **not numerically identical**: on
   the PoC corpus they agree on every success/failure verdict but take different iteration counts on
   3 of 280 frames, because TS computes in float64 while Python stays in float32. A policy cannot keep
   two implementations in step. Only one implementation can.
2. **Real-time work on a UI thread, clocked by UI timers.** The slot clock, the TX start and the
   decode trigger all live in one 100 ms `setInterval` in `App.tsx` (`App.tsx:390-415`). The decode
   runs synchronously inside it. The audio capture maps samples to UTC with one `Date.now()` taken at
   start (`audioEngine.ts:581`), never re-anchored and blind to device latency and sound-card clock
   drift.
3. **Two sources of truth for application state.** `qsoEngine`, `rigctl`, `audioEngine` and
   `sicDecoderEngine` are mutable module singletons, and React state is a manual copy refreshed after
   each mutation (`setQsoState(qsoEngine.getState())` at 11 call sites in `App.tsx`).
4. **The browser forces a server anyway.** A browser cannot reach rigctld, GPIO or the filesystem.
   So a Python HTTP server exists, and with it a bearer token, `Origin`/`Host` validation and a CORS
   policy. That is a whole attack surface and invariant set (`AGENTS.md` §4, "Local API") that exists
   only because the UI runs in a browser. Serial and HID keying need the Chromium-only Web Serial and
   Web HID APIs.
5. **Shipping artefacts are hand-managed.** A 1.8 MB pre-built bundle is committed and served by
   default (C6). Installers copy fresh builds over the tracked copy (`install_ubuntu.sh:87`), which
   leaves the git checkout dirty. The updater (`git_sync.py`) then fast-forwards that checkout in place.
   End users need Node.js to build the UI.
6. **Dead, shell and duplicate code.**
   - Dead: `sic_decoder.process_buffer` (unreachable).
   - Shells: `gui_tkinter.py`, whose File → "Export ADIF Logbook…" shows "ADIF export complete." and
     does nothing (`gui_tkinter.py:350`).
   - Duplicates: two RF time-sync engines (Python and TS, both inventing SNR floors and
     confidences), three callsign codecs (`z30Codec.ts`, `message_codec.py`, `sic_decoder.py`), two
     grid tables, two CRC-14s in TS, four rigctld clients in Python, two setup wizards and two
     benchmark engines.
7. **Documentation describes intended, not actual, components.**
   - `wiki/03` specifies a "128-tap Kaiser-windowed bandpass filter", "Gray-coding" and "phase
     trajectory tracking". None exists: `grep -ri kaiser` and `grep -ri gray` are empty, and symbols
     are natural binary (`modem.codeword_to_symbols`).
   - `wiki/05` specifies ML estimation of "amplitude trajectory Â(t)" and "phase trajectory φ̂(t)"
     for coherent subtraction. None is implemented (C3).
   - `wiki/03` gives the decode budget as 24.0–28.5 s. That contradicts the ±1.5 s DT search, which
     needs audio until 25.5 s, and is the design-level root cause of C1.

### Step 6: keep, refactor, replace, remove or rebuild, per subsystem

| Subsystem | Today | Decision | Why |
| :--- | :--- | :--- | :--- |
| Protocol constants (tones, timing, Costas pattern, CRC-14, LDPC H) | Python/TS twins | **KEEP** as spec, port once | Correct, pinned by tests |
| GFSK modulator | `modem.py`, `z30Waveform.ts` | **KEEP** algorithm, port | Spectrum-verified (49.8 Hz at 99%, 66 Hz at −40 dB) |
| Message codec | 3 codecs | **REPLACE** (faithful v1 port with gate fixes; v2 is your decision) | C5, H2, H3, M6 |
| Costas acquisition | `acquisition.py` (single frame) | **REBUILD** as a multi-candidate sync search on the same principle | Good sensitivity; finds one frame only |
| Live candidate detection and refinement | `findCandidates`, `refine*` | **REMOVE** | C2 |
| Demodulator (non-coherent Log-MAP) | `demodulate_mfsk_llrs`, `demodulateReal` | **KEEP** maths, **REIMPLEMENT** (FFT at a decimated rate) | Correct but 17–36× slower than needed |
| LDPC cascade + AP | `ldpc.py`/`ldpcCodec.ts`, `ap_decode.py`/`apDecode.ts` | **KEEP** (bit-exact port, proven in the PoC); fix the OSD logic (M1) | Correct and reproducible |
| SIC | `sic_decoder.py`, `realReceiver.ts` | **REBUILD** | C3 |
| Resampler | moving average + linear interpolation | **REPLACE** with a polyphase FIR | M2 |
| Audio I/O | Web Audio + AudioWorklet | **REPLACE** with native (cpal) | C1, C4, browser constraints |
| Slot clock and TX scheduler | `setInterval` + `Date.now` anchor | **REBUILD** on sample time | C1, H5, M12 |
| Transmit gate, band plan, rig readback | `catController.ts`, `bandPlan.ts`, `rigStateTracker.ts` | **KEEP** rules and test scenarios, port | The strongest code in the repository |
| PTT/CAT transports | Web Serial/HID, HTTP relay, Python GPIO bridge | **REPLACE** transport, **KEEP** semantics (one keying path, release drives what key drove, dead-man) | Removes Chromium-only APIs and the HTTP bridge |
| Local HTTP API | `web_server.py` | **REMOVE** | No browser, so no need for the token/Origin/Host surface |
| QSO sequencer | `qsoEngine.ts` | **REBUILD** as a message-type-aware state machine | H1, H3 |
| Logbook | `qsoLogger.ts`, `auto_logger.py` | **REBUILD** (ADIF + SQLite, true UTC, no fabricated fields) | H1 |
| RF time sync | `rf_time_sync.py`, `rfTimeSyncEngine.ts` | **REMOVE** from the first release; replace with NTP status and a DT-median offset | H4 |
| GUIs | React app, Tk shell, Tk wizards | **REPLACE** with one native shell over a snapshot/command API | §I.8 |
| Channel models, benchmark statistics, paired instruments | `channel.py`, `benchmark.py` | **KEEP** in Python, re-pointed at the Rust receiver | The project's best asset |
| Browser benchmark engine | `monteCarloEngine.ts` | **REMOVE** | A second receiver model |
| Updater | `git_sync.py` fast-forwards the install | **REPLACE** with release-based updates | Users should not run from a git checkout |
| Wiki | `wiki/` + generated TS | **KEEP** content; stop embedding it in the app; correct the false claims | M8, L1 |

---

## C. DSP assessment

### C.1 Per-algorithm matrix

The brief's fourteen questions, answered per component. **"PoC"** means a claim I verified by
porting the code.

| Component | Correct? | Numerically stable? | Fit for weak signals? | Cost (measured) | Vectorise / Numba? | Allocations | State | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| GFSK modulator (`modem.py`, `z30Waveform.ts`) | Yes. Pulse sums to 1 across the interior; edge symbols extended so the frequency does not sag. | Yes (bounded phase accumulator in TS) | Yes (constant envelope) | negligible | already vectorised | per frame, fine | none | KEEP |
| Coarse acquisition (`acquisition.py`) | Yes. 21-tone Costas sum on an 8×/8× oversampled spectrogram, then a direct-correlation fine grid. | Yes | Yes. Whole-band search = ±12 Hz search (0/200 discordant). | 0.17–0.6 s per frame; 55% of the Python chain | vectorised, but computes all 15,361 bins × ~675 frames to use about 60 × 30 | large (full 2-D FFT) | none | KEEP principle, REBUILD multi-candidate |
| Live candidate detector (`findCandidates`) | Mechanically yes, **wrong detector for the job**. It fires only when the strongest 3.125 Hz tone group is 6 dB over the median group, i.e. that group needs ≈ +4.8 dB SNR. A z-30 signal's strongest group sits ≈ 20 dB above its 2500 Hz SNR, so detection starts near −15 dB (measured: 6/40 at −16 dB, 39/40 at −14 dB). | Yes | **No** (C2) | 50 ms | – | FFT buffers | none | REMOVE |
| `refineBaseFreq` / `refineTimingAndFreq` | **Defective.** Searches only the 3.125 Hz group grid, but the next stage captures only ±0.78 Hz. Coarse error < 0.78 Hz: 15/15 decode; ≥ 0.78 Hz: 10/25 (`results/freq_snapping.jsonl`). | – | No | **317 ms per candidate at 6 kHz, 611 ms at 12 kHz** (per-sample `Math.cos/sin`) | trivially tabulated | per-call arrays | none | REMOVE |
| `refineFineFrequency` | Correct idea (staged phase-slope baselines); first stage aliases above ±0.78 Hz | wraps correctly | OK once within ±0.78 Hz | 7 ms | – | small | none | REBUILD into fine sync |
| Demodulator (`demodulate_mfsk_llrs`, `demodulateReal`) | **Yes.** ln I₀(\|r\|·A/σ²) is the exact non-coherent (Rician) metric for orthogonal MFSK in AWGN. The high-z asymptote is correct. Log-MAP demapping is exact. | Yes (log-sum-exp with max shift, ±25 clip) | Yes. Coherence weight 0 is right for this receiver (the repo's own paired result). | **Python 122 ms, TS 70 ms per frame @12 kHz**, vs 3.4 ms vectorised NumPy (bit-identical LLRs, PoC) and 4.0 ms scalar Rust (bit-identical, PoC) | yes: the 16 tone references are the same for every symbol, so one GEMM or FFT does the work | Python rebuilds 3840-point cos/sin arrays 1,728 times per call | none | KEEP maths, REIMPLEMENT |
| Noise σ | Whole-buffer MAD (`realReceiver.ts:540`, `sic_decoder.py:455`) | Yes | Biased upward on a busy band (strong signals inflate it) | O(N log N) sort per candidate | – | copies + sorts 144k samples | none | REPLACE with off-signal bin statistics |
| SNR report | `A²/(2σ²)`, a per-sample SNR over the full Nyquist band, **not** 2500 Hz referenced: −3.8 dB low at 12 kHz, −0.8 dB at 6 kHz | – | – | – | – | – | – | FIX (M3) |
| LDPC cascade | **Yes** (§C.2) | Yes | Yes | failing decode: **Python 522 ms**, TS 20.1 ms, Numba 8.2 ms, Rust 7.0 ms | Numba: yes, bit-exact (PoC) | TS allocates per check per iteration | per-decode scratch | KEEP, port |
| OSD-2 post-processing | **Logic defect:** the "CRC check" recomputes the CRC from the candidate being tested, and the syndrome check tests a codeword the encoder just built. Both are tautologies (M1). | – | Measured harmless on noise: 0/10,000 | ~5–10 ms Python | – | – | – | FIX |
| AP ladder | Yes; WSJT-X-faithful | – | Yes; 0/10,000 false accepts on noise ladders | +4 decodes per failing candidate (TS ladder mean 98 ms, max 515 ms) | – | – | – | KEEP |
| SIC (`sic_decoder.py`, `realReceiver.ts`) | **No** (§C.3) | – | **No** | – | – | – | – | REBUILD |
| Resampler (`resampleAudio`) | Anti-alias is an 8-tap moving average: −3.9 dB at the new 3 kHz Nyquist. Linear interpolation. | Yes | Folds 3–9 kHz sound-card noise into the band | small | – | per call | none | REPLACE (polyphase FIR) |
| RF time sync (Python) | **No** (H4) | – | – | – | – | pure-Python loops over 780k samples | thread | REMOVE / redesign |

### C.2 LDPC: dedicated review

**Representation.** The code keeps `total_llrs` (the a posteriori belief, the brief's L_q
generalised) plus one flat float32 array of check-to-variable messages (`c_to_v`, the brief's L_r)
laid out CSR-style, check-major, through `_edge_lo`/`_edge_hi`. Variable-to-check messages are formed
on the fly as `total − c_to_v`. This is the textbook **layered** representation and the most
memory-efficient one for this schedule. There are no separate `var_to_chk` arrays because none are
needed. **Keep it.** The PoC adds u16 edge indices, a fixed 972-edge SoA layout and per-decoder
scratch reused across decodes: no allocation inside the belief-propagation iterations (only the OSD
stage allocates, one 63-entry ranking vector).

**Updates.**
- Normalised offset min-sum: `sign · max(0, α·min − β)`. Correct.
- SPA box-plus: `sign·min + log1p(e^{−|x+y|}) − log1p(e^{−|x−y|})` with |·| ≥ 30 masked. Correct and
  stable.
- Damping: `(1−γ)·old + γ·new`. Correct, though unusual in a layered decoder, where it mostly slows
  convergence. **Worth a paired study, not a change.**
- Stopping: syndrome = 0 plus CRC match, and a trellis re-check when the payload CRC already matches.
  Correct. The re-check's `compute_syndrome(ira_cw)` is always 0 by construction (`ldpc.py:769`), so it
  is wasted work.

**Cost structure.** In Python the sum-product schedule was 86% of a failing decode (`wiki/16`). In
the Rust port the scalar `expf`/`log1pf` calls in the lane-ordered fold still dominate, at about
934k transcendental calls per failing decode. The fold is O(d²) on purpose, to keep bit-exactness
with the reference. An O(d) forward/backward fold is the obvious optimisation. It **moves decodes by
floating-point associativity, so it must pass a paired McNemar non-inferiority test (≥ 99%) before it
ships.** That is the project's own rule, and a correct one.

**Precision.** float32 is sufficient. The reference's semantics are subtle: NumPy 2's NEP 50 rounds
Python-float constants to float32 before use, forms `1−γ` in float64, and adds the dither in float64.
The Rust and Numba ports only matched bit for bit once those rules were transcribed exactly. They are
now written down in `poc/rust/src/ldpc.rs` and are the start of the spec.

**OSD (M1).**
- `eval_candidate` recomputes the CRC from the flipped payload and re-encodes the parity (`ldpc.py:804-813`,
  `ldpcCodec.ts:809-829`). Every candidate is therefore a valid codeword with a matching CRC by
  construction.
- The final `compute_crc14(payload) == rcvd_crc` (`ldpc.py:832`) compares a CRC with itself.
- The real acceptance test is `corr > 20 && Hamming distance ≤ 16`.
- So the "2⁻¹⁴ per candidate" false-accept bound that `wiki/04` and `wiki/17` quote is **not what the
  code implements**.
- Measured on pure noise it does no harm: **0 false decodes in 10,000 candidates** (95% upper bound
  3.0 × 10⁻⁴) and 0 in 10,000 AP ladders (`results/false_decodes.jsonl`). Real near-miss signals
  (collisions, partial frames) were not tested.
- **Fix:** run OSD over the full 77-bit information set, CRC included, and accept only when the
  candidate's CRC field matches its payload.

**Worst-case latency.** A failing decode runs all 150 iterations plus up to 106 OSD candidates.
Python: p99 602 ms. TS: p99 42 ms, max 51 ms. Rust: p99 9.2 ms. With AP, multiply by up to five.

### C.3 SIC: dedicated review (verdict: placeholder, rebuild)

| Question | `realReceiver.ts` (ships) | `sic_decoder.py` (unreachable) |
| :--- | :--- | :--- |
| Signal model assumed | A real FSK tone sequence at constant amplitude, **carrier phase 0 at the frame start** | same |
| Replica waveform | `synthesizeReplica` (`realReceiver.ts:65-98`): hard frequency steps with an **8 ms amplitude ramp on every symbol**. This is the waveform `AGENTS.md` says was removed from the transmitter because it splatters, so the replica does not match what is transmitted (GFSK). | Correct GFSK modulator |
| Symbol estimation | Re-encodes the decoded codeword. Correct. | same |
| Amplitude | Mean of 21 pilot correlator magnitudes, biased upward at low SNR | same |
| Phase | **Not estimated** | **Not estimated** |
| Timing | Integer sample from the acquisition grid, 1–6 ms error | **Frame assumed at sample 0; no timing search at all** |
| Frequency | refined (can be 1.5–2.8 Hz off; see C2) | refined |
| Subtraction | `residual -= amp · replica` (`:789`) | `residual -= amp · replica` (`:222`) |
| Measured result | Suppression (power before ÷ after) of +1.1, −1.2, −5.4, +4.3, −5.0, −5.5, −5.0, −4.1 dB. A negative value means the "cancellation" *raised* the station's power. **Mean: −2.6 dB, i.e. 2.6 dB added.** Least squares on the same frames: +5.2 to +35.1 dB (`results/sic_cancellation.jsonl`). | Analytically, random phase gives E\|1 − e^{jφ}\|² = 2, i.e. **+3 dB** on average |
| Consequence | Passes 2–3 re-decode the station that should have been removed: duplicates on 22–29 of 40 frames at −14 to −10 dB, and 14–21 duplicate decodes per slot with 20 stations. Each pass costs about as much as the first. | – |

**What a real SIC needs.**
1. Regenerate the exact GFSK waveform through the shipped modulator.
2. Refine timing to well under 1 ms.
3. Estimate a **complex** gain per block of ~1 s by least squares. That tracks phase, fading and
   residual frequency, as WSJT-X's `subtractft8` does.
4. Subtract.

Only then are pass-2 decodes meaningful. The collision benchmark the wiki withdrew needs this first.

---

### C.4 Synchronisation audit, and the receiver z-30 should have

#### Why the brief's chain is the wrong shape for z-30

The brief's target chain (matched filter → Costas loop → Gardner → frame sync → SIC → LDPC) is the
architecture of a **coherent linear-modulation** modem such as BPSK or QPSK. z-30 is **non-coherent
orthogonal 16-FSK**, and each block would be wrong:

- **Costas carrier loop.** At the decode threshold (−23 dB in 2500 Hz, so C/N₀ ≈ 11 dB-Hz),
  per-symbol Eₛ/N₀ is only ~6 dB and the symbol is 320 ms. A PLL cannot hold phase through
  ionospheric rotation across data symbols. For orthogonal MFSK, coherent detection is worth at most
  about 1 dB even when it works. The repository has measured this directly: adding a coherent term
  cost **1.77 dB** under realistic timing (p = 2.9e-36) and was only a gain with genie timing.
- **Gardner TED and interpolators.** These need zero crossings of a linear pulse train at 2–4
  samples/symbol. For FSK, frame timing comes from correlating the 21 Costas symbols, once per frame.
  Symbol timing is then fixed, because symbols are 320 ms long and sound-card clocks barely drift.
  **Measured:** clock errors of 100, 1000 and 3000 ppm cost nothing at −20 dB (40/40 each). At
  −22 dB, 1000 and 3000 ppm gave 34/40 and 35/40 against 37/40 with no error, which is within
  sampling noise (Fisher exact p = 0.48 and 0.71). Only 5000 ppm costs real decodes (24/40,
  p = 0.001). Sound cards are typically within ±100 ppm. **No timing loop is needed.**
- **RRC matched filter.** The FSK matched filter *is* the per-tone correlator (a DFT bin) over each
  symbol, which the demodulator already implements. There is no pulse-shaping filter to match.
- **What *is* needed and missing:** carrier **drift** tracking (H9). The seven Costas clusters, at
  symbols 0–2, 7–9, 17–19, 27–29, 37–39, 47–49 and 72–74, give per-cluster frequency estimates, and a
  linear fit gives the drift to de-chirp by.

**3840 samples per symbol is not an architectural problem.** It only makes a per-sample time-domain
correlator expensive, which is exactly the shipped code's mistake. Compute symbol spectra with FFTs
on a shared per-slot spectrogram for search, then decimate each candidate to a ~200 Hz complex
baseband (~64 samples per symbol) for fine sync and demodulation.

#### Recommended receive chain (per slot)

1. **Decimate** (polyphase FIR) the device stream to 6 kHz, continuously.
2. **Build the slot window** in sample time: [start − 1.5 s, start + 25.5 s].
3. **Spectrogram** over 200–3000 Hz only: 1/8-symbol hop, bins oversampled 2–8×. Computed **once per
   slot**.
4. **Costas-array sync map:** S(t, f) = Σ₂₁ P(t + posₖ, f + toneₖ), normalised by the local noise
   floor. Local maxima above a threshold calibrated on noise-only slots become candidates, with
   non-maximum suppression over 50 Hz × 0.5 s and a cap on the count. This is `acquisition.py`'s
   metric extended to many candidates, the approach of WSJT-X's `sync8`. **Measured:** the same
   metric searched over the whole passband loses nothing against its ±12 Hz window (200 paired frames
   at −24 … −21 dB, 0 discordant).
5. **Per candidate, in parallel:**
   1. Downconvert and decimate.
   2. Fine search of dt, f and drift on the Costas clusters.
   3. Compute 16 × 54 symbol energies.
   4. Estimate σ from off-signal bins.
   5. Compute the existing non-coherent Log-MAP LLRs.
   6. Run the existing LDPC cascade, bit-exact, then the CRC-14 check.
   7. Run AP when enabled, under the existing gates.
6. **SIC:** for each decode, regenerate GFSK, apply a least-squares block-wise complex gain with
   sub-ms timing, subtract, and go to step 4 on the residual (up to 3 passes).
7. **Emit a `SlotReport`.** Per decode: message, SNR referenced to 2500 Hz, dt, f, drift, sync score,
   LDPC iterations, schedule reached, OSD used, AP type and pass.

Expected sensitivity: the benchmark receiver's −22.9 dB with no penalty for searching the whole band
(measured, single-signal AWGN). Multi-signal and collision performance must be measured in Phase 2;
**today it is not measured, and this report does not claim a number.**

---

## D. Performance assessment

### D.1 Kernels: same inputs, five implementations (PoC)

Corpus: 280 LLR vectors from the shipped Python demodulator at −27 … −21 dB, seeded (`poc/make_corpus.py`).
109 decode and 171 fail. Demodulator vector: one 12 kHz frame at −20 dB.

| Kernel (mean, idle) | Python shipped | NumPy vectorised | Numba | TypeScript shipped (V8) | Rust PoC |
| :--- | ---: | ---: | ---: | ---: | ---: |
| LDPC, failing decode (all 4 schedules + OSD) | **521.9 ms** (p99 602) | – (the layered schedule is serial) | 8.2 ms (p99 9.6) | 20.1 ms (p99 42.5) | **7.0 ms** (p99 9.2) |
| LDPC, successful decode | 16.5 ms | – | 0.22 ms | 0.58 ms | **0.17 ms** |
| Demodulator, 75 symbols @ 12 kHz | 122 ms | **3.4 ms** | – | 69.5 ms | 4.0 ms (scalar, no FFT or SIMD) |
| Agreement with the Python reference | – | LLRs **bit-identical** | **280/280** success, info bits and iterations | 280/280 verdicts; **3/280 iteration counts differ** | **280/280** success, info bits and iterations; LLRs bit-identical |
| Start-up cost | – | – | **7.4 s JIT**; on-disk cache **segfaults on reload** (3 of 3) | JIT warm-up | none |

Readings:
- The shipped Python decoder is 75× slower than native. That is interpreter cost: Numba, running the
  *same* algorithm, is within 17% of Rust.
- The shipped demodulators are 17–36× slower than they need to be. That is **algorithmic**: tone
  references are recomputed per sample and per symbol. Vectorised NumPy already beats a naive Rust
  loop.
- **Language choice is not the main performance lever. Algorithm and architecture are.** Language
  decides the *other* properties: real-time safety, packaging, and having one implementation.

### D.2 Where the time goes today

- **Python chain** (cProfile, 12 kHz, `results/cprofile_python_chain.txt`): acquisition 2.2 s (55%,
  dominated by the full-band 8×-zero-padded spectrogram), LDPC 1.34 s for 2 failing frames,
  demodulation 0.45 s for 3 frames. **The Python chain cannot be a live receiver:** one failing
  candidate costs about 0.7 s against a 4.5 s budget.
- **Shipped TS chain**, per candidate: `refineTimingAndFreq` 317 ms at 6 kHz (19 dt steps × 16 tone
  offsets × 21 pilots × 1920 samples of per-sample trig), demodulation ≈ 35 ms at 6 kHz (half the measured 70 ms at 12 kHz), LDPC 20 ms
  when failing, AP up to 515 ms.
- **Whole slot through the shipped receiver** (`results/busy_band.jsonl`; stations at −20 … −5 dB,
  non-overlapping):

  | Stations on the band | Wall clock, one decode cycle | Unique correct decodes | Duplicate decodes |
  | ---: | ---: | ---: | ---: |
  | 1 | 1.05–1.49 s | 1/1 | 0–2 |
  | 5 | 2.9–4.1 s | 2/5 | 3–4 |
  | 10 | **7.1–9.1 s** | 6/10 | 10–12 |
  | 20 | **14.0–18.0 s** | 11–13/20 | 14–21 |

  The budget is 6 s at most, from frame end to the next slot, and the TX trigger only fires while
  `cycleSec < 0.5`. On a moderately busy band the synchronous decode overruns into the next slot and
  freezes the UI while it does.

### D.3 Headroom in vNext (projection, to be verified in Phase 2)

- Per candidate: sync from a shared per-slot spectrogram (≈0); decimated demodulation ≈0.5 ms; LDPC
  0.2 ms when it succeeds and ≤7 ms when it fails (bit-exact mode).
- 50 candidates × 3 passes costs ≈1.1 s on one thread and ≈0.3 s on four.
- That is **> 10× margin against the budget, *projected***. Phase 2's acceptance tests (§J) are what
  will make it a measurement.

---

## E. Concurrency and real-time assessment

**Today (browser runtime):**

| Risk | Where | Status |
| :--- | :--- | :--- |
| Decode window never complete when decode is triggered | `App.tsx:411` vs `sicDecoder.ts:191-194`, `audioEngine.ts:693` | **Measured (C1)** |
| Heavy DSP on the UI thread; slot clock, TX trigger and GPIO keepalive share that thread | `App.tsx:232`, `sicDecoder.ts:197` | **Measured: 7–18 s blocks (C4)**. The keepalive stalls while the thread is blocked, and the server's 2 s dead-man then drops PTT. That fails safe, but it can cut a transmission. |
| Sample index ↔ UTC fixed by one `Date.now()` at start | `audioEngine.ts:581, 688` | By construction: device input latency is ignored, and sound-card drift accumulates (100 ppm = 0.36 s/h). After hours, frames leave the ±1.5 s search. **Not measured on hardware.** |
| Timers in a hidden or minimised window | 100 ms `setInterval` | Chrome documents throttling hidden pages to about 1 wake-up/s, and harder after 5 minutes unless the page is audible. The capture graph's output is silent. **Unverified here: test before trusting a minimised station.** |
| TX start jitter | 100 ms tick + awaited PTT HTTP round trip + 20 ms scheduling + 20 ms lead-in | Frame starts roughly 0.05–0.6 s late. Tolerated by the ±1.5 s search, but not deterministic. |
| Audio capture | AudioWorklet → `postMessage` of 4096-sample blocks | **Good.** No sample loss while the main thread is busy, because messages queue. |

**Today (Python):**
- `ThreadingMixIn` server plus the GPIO watchdog thread under an `RLock`: sound, and it releases in
  the safe direction.
- Tk widgets updated from a background thread (`gui_tkinter.py:398`) and `after()` called from worker
  threads (wizard, time-sync dialog): works with threaded Tcl, but is formally unsafe. LOW.
- `sounddevice` is not used in the operating path at all.

**Proposed pipeline (vNext):**

```
 OS audio thread (cpal callback)          ── copy only: no lock, no alloc, no log
   └─► SPSC ring (rtrb, preallocated 60 s @ device rate) + atomic overrun counter
 DSP thread                               ── polyphase decimate → 6 kHz; waterfall rows; slot store
   └─► slot store: two 27 s windows, addressed by SAMPLE index (the master clock)
 Scheduler thread                         ── maps sample index ↔ UTC with a drift-tracking linear fit
   ├─► at slot_start + 25.5 s + margin (sample time): Arc<SlotBuffer> → decode pool
   └─► TX: prefill output ring, key PTT, start samples at an exact sample index
 Decode pool (N workers, lower priority)  ── candidates in parallel within a pass; passes sequential
   └─► SlotReport (immutable) ─► bounded channel
 Engine control thread                    ── Commands in; QSO FSM; TxGate; rig polling; log writer
   └─► EngineSnapshot (ArcSwap, latest wins) + Events (bounded, drop-oldest for UI-only events)
 GUI thread                               ── renders snapshots, sends Commands, never blocks the engine
```

Every channel is bounded. The audio ring's only failure mode is a counted overrun; the engine
reports it and carries on.

---

## F. Testing assessment

**Covered well:**
- Transmit gate and keying (a guard for each hardware method)
- Rig readback, including the tuning-resolution and settle rules
- CRC and LDPC known-answer tests and encoder self-consistency
- Waveform spectral budgets
- Seeded determinism across runs and worker counts
- Cross-language constant pins
- Local-API authentication
- Clock-step bounds
- AP gates

**Missing (each maps to a finding):**

| Missing test | Would have caught |
| :--- | :--- |
| Live path end to end on a **virtual clock**: WAV in, trigger at the app's real schedule, decodes out | C1 |
| Decode rate of the **shipped** receiver entry point vs SNR (the only `runSicMultiPass` test asserts nothing decodes from noise) | C2 |
| SIC suppression ≥ X dB on a known frame; no duplicate decode across passes | C3 |
| Wall-clock budget of a slot decode with K stations | C4 |
| Codec round trip over the callsign space the gate accepts (property test) | C5 |
| The shipped bundle's embedded commit equals `HEAD` | C6 |
| Logged fields come only from received data; `utcTime` is UTC | H1 |
| A grid round trip, or refusal to transmit what cannot round-trip | H2 |
| A time-sync decoder returns failure on noise and without audio | H4 |
| Numerical equivalence of the two decoders on a shared LLR corpus | H7 |
| Drift and sound-card-clock tolerance | H9 |

---

## G. Dependency assessment

| Dependency | Used by | Verdict (today) | vNext |
| :--- | :--- | :--- | :--- |
| numpy 2.2.6 | Python DSP, benchmark | keep | research only |
| scipy 1.15.3 | `erf` in the modulator (`math.erf` would do), `hilbert` in the channel model | move to dev-only | research only |
| sounddevice 0.5.6 (+PortAudio) | config wizard, RF time sync; **not** the operating path | – | replaced by `cpal` |
| cffi 2.1.1 | nothing directly (transitive via sounddevice) | drop from the direct list | – |
| pyserial 3.5 | config wizard | – | replaced by `serialport` |
| **requests 2.34.2** | **nothing imports it** | **remove now**: it has already needed a CVE bump (PYSEC-2026-2275) while unused | – |
| gpiozero (optional) | GPIO bridge | – | `rppal`/`gpio-cdev` behind a Linux feature flag |
| react 19, react-dom, vite 8, tailwind 4, lucide-react, recharts, TypeScript 7 | web UI; recharts only for the in-app benchmark | 0 npm advisories; 206 MB `node_modules`; end users need Node to build | retired if egui is chosen; kept (UI only) if Tauri |
| **Build/install** | installers run `npm install && npm run build` on the user's machine; `run_windows.bat:161` installs **unpinned** numpy/scipy/requests | contradicts the pinning policy | release artefacts built in CI |

**Proposed vNext dependencies.** Each justifies its presence:

| Crate | Role |
| :--- | :--- |
| `realfft`/`rustfft` | FFT |
| `cpal` | audio: ALSA/PipeWire (via its ALSA/JACK layers)/JACK, WASAPI, CoreAudio |
| `rtrb` | lock-free SPSC ring |
| `crossbeam-channel`, `arc-swap` | bounded channels, snapshots |
| `serialport` | RTS/DTR and CAT |
| `hidapi` | CM108 GPIO |
| `tungstenite` | TCI |
| `rusqlite` + own ADIF writer | logbook |
| `serde`, `toml` | config |
| `tracing` | logs outside hot paths |
| `rand_chacha` | seeded test channels |
| `eframe`/`egui` | GUI |
| `pyo3`/`maturin` | dev-only bindings |
| `criterion`, `proptest` | benches, property tests |

---

## H. Technical debt by severity

### CRITICAL

| ID | Finding | Location | Evidence |
| :-- | :-- | :-- | :-- |
| C1 | Live decode never gets audio (trigger 24.0 s, window to 25.5 s, no retry). The published decode budget (24.0–28.5 s) contradicts the ±1.5 s DT design. | `App.tsx:411`, `sicDecoder.ts:191-194`, `audioEngine.ts:693`, `wiki/03` slot table | `results/live_rx_trigger.txt` |
| C2 | Shipped receiver: 50% at ≈ −14.9 dB, and no better than 65–85% at −14 … −10 dB. Caused by the energy detector (`realReceiver.ts:46,183-210`) and 3.125 Hz grid snapping vs ±0.78 Hz fine capture (`:299-311`, `:353-378`). | `realReceiver.ts` | 400 paired frames, 215:0, p = 3.8e-65; `results/freq_snapping.jsonl` (15/15 vs 10/25) |
| C3 | SIC anti-cancellation: obsolete replica with no phase (TS); no phase or timing (Python) | `realReceiver.ts:65-98,784-789`; `sic_decoder.py:219-222,338` | `results/sic_cancellation.jsonl`, `busy_band.jsonl` |
| C4 | Synchronous main-thread decode, 7–18 s with 10–20 stations | `App.tsx:232`, `sicDecoder.ts:197` | `results/busy_band.jsonl` |
| C5 | TX gate passes callsigns the codec cannot represent, so another callsign is transmitted (ZV–ZZ wrap; compound and portable calls; 4-character prefixes) | `bandPlan.ts` `isValidCallsign`; `z30Codec.ts` `encodeCallsign28`; `message_codec.py:117,128` | `results/codec_roundtrip.txt` |
| C6 | Shipped `web_dist` is 49 commits stale: default callsign **W1AW** (a real station), no mono-device PTT-tone guard, pre-fix receiver, no AP. No CI check. | `z30_dsp/web_dist/`, `web_server.py:156-160`, installers | `grep NOCAL` → 0, `grep maxChannelCount` → 0, `.35,Math.min(.85` present |

### HIGH

| ID | Finding | Location | Evidence |
| :-- | :-- | :-- | :-- |
| H1 | Auto-log fabricates data:<ul><li>`utcTime` is **local** time (LA: 13:52 logged while UTC was 20:52)</li><li>`grid: 'FN31'` and `rstRcvd: '-16'` when nothing was received</li><li>distance computed from a *different* default (`EM00`)</li><li>decimal reports (`-18.4`)</li></ul> | `qsoEngine.ts:294,313-325` | `results/autolog_fields.txt` |
| H2 | 7-bit grid field: only 63 table grids exist. Every other grid is sent as a *different real grid* (FN42→RE78, JO01→FN20, EM12→JN48, GG66→EL89) and then displayed, logged and used by the NEAREST/FARTHEST pile-up rules. | `z30Codec.ts` `encodeGrid` | `results/codec_roundtrip.txt` |
| H3 | Roger is lost: `R-12` is received as `-12` (`z30Codec.ts:316-320`). The sequencer advances on any message addressed to me without checking its type (`qsoEngine.ts:297-335`). | codec, sequencer | `results/codec_roundtrip.txt` |
| H4 | RF time sync "succeeds" on nothing:<ul><li>with no PortAudio it silently decodes its own simulator: "SYNC OK … SNR 63.4 dB", persisting `app_time_offset_ms = +27,824` (later runs: −24,071 and −13,916; the last began its dwell at second 13.87 of the minute, so the "measured offset" is just when Start was pressed)</li><li>on pure noise, 20 of 40 pre-checks pass and 20 of 20 dwells "succeed"</li><li>the WWV decoder never reads the time code</li><li>`snr_db=max(snr,6.5)` and `confidence=0.96` are constants</li><li>the offset is persisted without confirmation and can drive an (opt-in) OS clock step</li></ul> | `rf_time_sync.py:455-464,711-725,1277` | `results/timesync_noise.txt` |
| H5 | Capture sample↔UTC anchor set once; latency and drift ignored | `audioEngine.ts:581,688` | analysis (§E) |
| H6 | Neither benchmark exercises the shipped front end (`wiki/16` concedes this), yet the app, README and wiki present −22.9 dB as the station's sensitivity | `SpecsModal`, README, `wiki/03,11,16` | C2 |
| H7 | Two DSP stacks, numerically divergent (float32 vs float64), plus the duplication listed in §B.6 | repo-wide | PoC: 3/280 iteration mismatches |
| H8 | Slot clock and TX on main-thread timers; background throttling risk | `App.tsx:390-415` | analysis; unverified |
| H9 | No carrier-drift tracking. At −22 dB, with the given total linear drift across the 24 s frame, 37/40 decode at 0 Hz, 34 at 1 Hz, 27 at 2 Hz (Fisher exact p = 0.010), **1 at 4 Hz** and **0 at 6 Hz**. The README advertises VHF and microwave use, where several Hz per 24 s is ordinary. | receiver | `results/drift_and_clock.jsonl` |
| H10 | Python chain at 0.5–0.7 s per failing candidate can never serve live | `ldpc.py`, `benchmark.py` | §D |

### MEDIUM

| ID | Finding | Location |
| :-- | :-- | :-- |
| M1 | OSD's CRC and syndrome checks are tautologies; the documented 2⁻¹⁴ bound is not what runs. 0/10,000 measured on noise. | `ldpc.py:769,804-833`, `ldpcCodec.ts:809-866` |
| M2 | Resampler aliasing (8-tap moving average + linear interpolation) | `realReceiver.ts:590-619` |
| M3 | SNR not 2500 Hz referenced; σ from whole-band MAD | `realReceiver.ts:540-553`, `sic_decoder.py:455-468` |
| M4 | Tk "GUI" is a shell with a fake "ADIF export complete"; `main.py` silently falls back to it | `gui_tkinter.py:350,398`, `main.py:27-45` |
| M5 | `confidence: 99` on every decode; the comment claims false-accept < 1e-6 | `sicDecoder.ts:110-112` |
| M6 | Free text is silently turned into callsign fields; an unparseable report becomes −12; an unknown third token becomes FN31 | `z30Codec.ts:316-335` |
| M7 | `isMyCall` is a substring match (K1AB matches K1ABC) | `sicDecoder.ts:108` |
| M8 | Wiki describes components that do not exist (Kaiser filter, Gray mapping, phase/amplitude trajectory SIC, normalised correlation) | `wiki/03`, `wiki/05` |
| M9 | Installers mutate tracked files; Windows launcher installs unpinned packages; Node.js required at install | `install_*.sh`, `run_windows.bat:161` |
| M10 | Unused or oversized dependencies (`requests`, `cffi`, `scipy`) | `requirements.txt` |
| M11 | Two disconnected clock offsets: Python persists one the web app never reads; the web app's lives in React state and resets on reload | `App.tsx:47`, `rf_time_sync.py` |
| M12 | TX start jitter 0.05–0.6 s | `App.tsx:390-406` |
| M13 | "FWD" watts echoes the configured power as if measured, the same class of issue the removed fake SWR was | `App.tsx` `setFwdWatts(config.txPowerWatts)` |

### LOW

| ID | Finding |
| :-- | :-- |
| L1 | Wiki and the whole Python source are embedded in the app bundle (886 kB) with an in-app source viewer, and CI must keep them regenerated |
| L2 | Single 2 MB JS chunk |
| L3 | Tk `after()` from worker threads |
| L4 | `process_buffer` dead API with an unused `base_dial_hz` and hardcoded `dt_sec` (already recorded by the previous audit) |
| L5 | Two CRC-14 implementations in TS (previous audit) |
| L6 | TS LDPC allocates per check per iteration (GC churn) |

---

## I. Proposed architecture

### I.1 Principles

1. **One implementation** of the protocol and the receiver.
2. **The sample clock is master.** UTC is a model fitted to it.
3. **The audio callback only copies.**
4. **Expensive stages are gated** by the Costas sync search.
5. **The domain crates do no I/O.** They take buffers and config and return data. Hardware and GUI
   sit behind traits.
6. **Transmit safety lives in the engine**, not the UI.
7. **The protocol version is explicit.**

### I.2 Directory tree

```
z30/                                  (Cargo workspace)
├── Cargo.toml
├── crates/
│   ├── z30-protocol/     PURE. Protocol v1 (bit-exact with today): constants, Costas pattern,
│   │                     message codec, CRC-14, LDPC (216,77) tables + encoder, symbol mapping,
│   │                     GFSK modulator. v2 behind a feature if approved. #![forbid(unsafe_code)],
│   │                     no dependencies.
│   ├── z30-dsp/          PURE. Resampler, spectrogram, Costas sync search, fine sync (dt/f/drift),
│   │                     demodulator, LDPC decoder (bit-exact + validated fast mode), OSD, AP, SIC,
│   │                     noise/SNR estimators, and decode_slot(&SlotBuffer, &RxConfig) -> SlotReport.
│   ├── z30-channel/      TEST TOOLING. Seeded AWGN, Watterson (ITU-R F.1487), CFO/drift/DT/clock-ppm,
│   │                     multi-station band synthesiser.
│   ├── z30-engine/       APPLICATION CORE. Slot clock, RX pipeline, TX scheduler, TxGate + band plan +
│   │                     callsign rules + RigStateTracker, QSO state machine, logbook model, config
│   │                     model, Command/Event/Snapshot API. Traits: AudioBackend, RigControl,
│   │                     PttLine, Clock, LogStore, ConfigStore.
│   ├── z30-io/           ADAPTERS. cpal audio (+ WAV file backend for tests), rigctld client,
│   │                     serial RTS/DTR + CAT, CM108 (hidapi), Linux GPIO (feature), TCI, VOX tone,
│   │                     NTP status, XDG/AppData paths, ADIF/SQLite store.
│   ├── z30-app/          GUI (egui/eframe). Renders EngineSnapshot, sends Commands. No DSP, no I/O.
│   ├── z30-cli/          Headless: run | decode <wav> | encode <msg> --wav | selftest | bench
│   └── z30-py/           PyO3 bindings (dev only, maturin): protocol + dsp + channel for research.
├── research/             Python: the benchmark harness (Wilson, McNemar, --ap, --compare-demod),
│                         re-pointed at z30-py; plots.
├── reference/            Today's z30_dsp, frozen read-only: the ORACLE for golden vectors.
├── tests/golden/         Golden vectors exported from the oracle + generators (§J Phase 1).
├── docs/                 Specification (SPEC.md, derived from code) + operator docs (today's wiki).
└── packaging/            AppImage, Flatpak, AUR PKGBUILD, MSI (WiX), macOS .app + notarisation, Pi.
```

**Why not the brief's `domain/application/infrastructure/interfaces` Python tree?** Its layering
principle is right, and the crates above *are* those layers:
- `z30-protocol` + `z30-dsp` = domain
- `z30-engine` = application
- `z30-io` = infrastructure
- `z30-app` + `z30-cli` = interfaces

In Rust, crate boundaries **enforce** the dependency direction at compile time: `z30-dsp` cannot
import an audio or serial crate because it does not depend on one. A Python package tree can only
express that as a convention. The brief's own rule ("the domain must not import sounddevice,
tkinter, pyserial, socket") is exactly the kind a package tree cannot enforce and a crate graph
enforces at compile time.

### I.3 Interfaces (sketch)

```rust
// z30-dsp: pure
pub struct SlotBuffer { pub samples: Arc<[f32]>, pub rate_hz: u32, pub first_sample: u64 }
pub struct RxConfig   { pub band_hz: (f32, f32), pub max_candidates: u16, pub sync_threshold: f32,
                        pub sic_passes: u8, pub ldpc: LdpcMode, pub ap: Option<ApContext>, pub drift_search_hz: f32 }
pub fn decode_slot(buf: &SlotBuffer, cfg: &RxConfig, scratch: &mut RxScratch) -> SlotReport;

// z30-engine: ports (implemented in z30-io and by test fakes)
pub trait AudioBackend { fn open_rx(&mut self, dev: &DeviceId, sink: rtrb::Producer<f32>) -> Result<RxStream, AudioError>;
                         fn open_tx(&mut self, dev: &DeviceId, src: rtrb::Consumer<f32>) -> Result<TxStream, AudioError>; }
pub trait RigControl: Send { fn set_dial(&mut self, hz: u64) -> Result<(), RigError>; fn read_dial(&mut self) -> Result<u64, RigError>; /* mode, split, ... */ }
pub trait PttLine: Send    { fn key(&mut self) -> Result<PttAck, PttError>; fn unkey(&mut self) -> Result<PttAck, PttError>; }
pub trait Clock            { fn utc_now(&self) -> Utc; fn ntp_status(&self) -> ClockStatus; }

pub enum Command { SetBand(Band), ArmTx(TxRequest), HaltTx, Tune(TuneRequest), SelectDecode(DecodeId), UpdateConfig(Config), .. }
pub enum Event   { SlotDecoded(Arc<SlotReport>), TxStarted(TxInfo), TxFinished(TxInfo), TxRefused(Vec<Violation>),
                   RigState(RigSnapshot), AudioStatus(AudioHealth), Fault(EngineFault), .. }
```

### I.4 Error taxonomy (brief §19)

| Class | Examples | Handling |
| :--- | :--- | :--- |
| Decode failure | no sync, LDPC fails, CRC fails | Normal. Counted in `SlotReport`, never an error. |
| Recoverable runtime | audio overrun, rigctld timeout, one invalid config field | Counted and surfaced as an Event. The engine continues. Rig becomes "unverified". TX is refused while the config is invalid. |
| Hardware failure | audio device lost, serial port gone, PTT write fails | **Unkey on every layer first**, enter `Degraded(..)`, reconnect with backoff, and never corrupt the slot store (a new stream starts a new epoch) |
| Programming error | panic in a decode worker | Caught at the pool boundary (`catch_unwind`): the slot is lost, a Fault event is raised, the engine continues. DSP crates forbid `unsafe`. |

### I.5 Observability (brief §20)

The DSP returns data; it does not log.

- **Per decode:** SNR (2500 Hz), sync score, dt, f, drift, LDPC iterations, schedule, OSD used, AP type,
  and SIC pass.
- **Per slot:** candidate count, per-stage timings, noise floor, and residual power after each SIC pass.
- **Engine counters:** audio overruns, decode latency p50/p99/max, TX start error in samples.
- **Optional:** `--capture-slots` writes each slot's WAV and report for offline replay.

### I.6 Configuration (brief §21)

| Class | Parameters | Where | Changed by |
| :--- | :--- | :--- | :--- |
| Protocol (versioned, never user-set) | tones, spacing, symbol time, frame layout, Costas pattern, LDPC H, CRC, GFSK BT, message format | `z30-protocol` constants | protocol version bump |
| Receiver tuning | band limits, sync threshold, max candidates, SIC passes, LDPC mode/caps, OSD, AP window, drift range, DT window | `RxConfig` (advanced TOML) | benchmark-validated defaults |
| Station | callsign, grid, region, licence class, power | `config.toml` via GUI | operator |
| Hardware | audio in/out, rigctld host/port, rig model, PTT method, port, polarity, pin, lead/hang | `config.toml` via GUI | operator |
| Safety limits | `MAX_TX_SECONDS`, dead-man timeouts | compile-time constants | never raised at runtime |

The brief's "RRC roll-off, Costas-loop bandwidth, timing-loop bandwidth" have no counterpart,
because those blocks should not exist (§C.4).

### I.7 How the `AGENTS.md` invariants map to vNext

Transmit safety, signal integrity, determinism, AP rules and "one source of truth" carry over
unchanged as ported tests. **"The benchmark measures the receiver that ships"** stops being a policy
and becomes structural: the Python harness calls `decode_slot` through `z30-py`. **"Local API"**
disappears with its attack surface. **"System clock"** becomes a status display, with no stepping.

### I.8 GUI review (brief §14)

- **Tkinter.** Today's Tk window is not a working GUI (§1). For a 60 fps waterfall plus dense forms,
  Tk is workable but clumsy, and it would only be kept if the product stayed in Python.
- **React.** The working UI is React, and its components are a good *behavioural* reference. But the
  components carry application logic: `App.tsx` owns the slot clock, TX and decode trigger, and
  `StationSettingsModal` is 2.3k lines.
- **Recommendation: `egui` (eframe).**
  - Immediate-mode rendering of immutable snapshots is exactly the "commands, events, immutable
    snapshots" model the brief asks for, with no second copy of state to keep in sync.
  - One language and one binary.
  - winit/wgpu run natively on Wayland (Hyprland), X11, Windows and macOS.
  - AccessKit gives screen-reader support.
  - A waterfall is one texture upload per frame.
- **Alternative: Tauri + the existing React components** (maximum UI reuse). It uses WebKitGTK on
  Linux, which has a history of rendering problems on some Wayland + NVIDIA setups. That is your
  primary environment, so **run a two-day spike on the actual CachyOS/Hyprland machine before
  choosing Tauri.**
- **Either way, the GUI is a replaceable adapter.** Build the snapshot/command API first and the
  toolkit decision stops being load-bearing.

### I.9 Testing strategy, deterministic scenarios and benchmarks (brief §15–17)

**Layers:**
1. **Unit tests** (`z30-protocol`, `z30-dsp`): codec, CRC, LDPC encode/decode, modulator, sync
   metric, demodulator, SIC primitive.
2. **Golden vectors from the oracle.**
   - Bit-exact: message → bits → CRC → codeword → symbols; LDPC verdicts, info bits and iteration
     counts (the PoC corpus is the seed of this, extended to about 5k frames).
   - Tolerance-based: waveform samples (≤ 1e-6) and LLRs (≤ 1e-4 absolute; the PoC achieved 0).
3. **Property tests:**
   - every callsign the gate accepts round-trips, or the gate refuses it (C5)
   - grid round-trip or refusal (H2)
   - `encode ∘ decode = id` on the valid space
4. **Channel scenarios** (seeded; the brief's list, each with a *measured* pass criterion):

   | Scenario | Definition | Pass criterion |
   | :--- | :--- | :--- |
   | clean | +10 dB | 100% decode |
   | moderate | −18 dB | ≥ 99% |
   | weak | −22 dB | within the oracle's paired rate |
   | frequency offset | ±50 Hz off nominal, anywhere 200–2800 Hz | no loss vs 0 Hz (paired) |
   | phase offset | random phase | no loss |
   | timing offset | ±1.4 s | no loss |
   | drift | 0–4 Hz over the frame | recovered with drift tracking |
   | clock error | ±1000 ppm | no loss |
   | interferer | CW carrier and a second z-30 station at +10 dB, 20 Hz away | weak station decodes after SIC |
   | multiple stations | K = 5, 20, 50 at −20 … 0 dB | all above threshold decode; zero duplicates; zero false decodes |
   | fading | ITU-R F.1487 presets | report, no pass/fail until a baseline exists |

5. **Engine end to end on a virtual clock:** a WAV (or a scripted multi-station band) fed through
   the real pipeline at the app's real schedule, with ±200 ppm sound-card drift, for a simulated
   24 h. This is the test that catches C1, H5 and H8.
6. **Regression tests:** one per finding in §H, named after it.
7. **Performance:** `criterion` benches for the spectrogram, sync map, fine sync, demodulator, LDPC
   (success and failure), SIC and the complete `decode_slot` (K = 1, 20, 50), reporting **throughput
   and latency p50/p99/max**. Engine tests assert zero allocations and zero locks in the audio
   callback, with an allocation counter in test builds. Measure on two reference machines (a laptop
   and a Raspberry Pi 4).

---

## Technology and language recommendation

### Candidates against the brief's criteria

This is a trade-off table, not a scoreboard. Measured cells cite §D.

| Criterion (importance) | Python + NumPy/Numba | Rust | C++ | Hybrid: Rust product + Python research | TS/browser (today, even + WASM) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| DSP throughput (Critical) | Shipped: 522 ms/failing decode. Numba 8.2 ms; vectorised demod 3.4 ms. **Adequate once compiled.** | 7.0 ms / 4.0 ms scalar, with SIMD/FFT headroom | ≈ Rust | = Rust | 20 ms / 70 ms today |
| Real-time determinism (Critical) | GIL + GC in the callback path; workable with large buffers, no guarantees | No GC; lock-free rings are idiomatic | Same as Rust, by discipline | = Rust | Timers throttled; main-thread contention |
| CPU efficiency (Critical) | good with Numba, poor without | best | best | best | medium |
| Memory safety (High) | managed | safe (forbid `unsafe` in DSP) | manual | safe | safe |
| Concurrency (High) | GIL; processes for parallelism | threads + `Send`/`Sync` checked at compile time | threads, unchecked | = Rust | workers + message passing |
| SIMD (High) | via NumPy/BLAS/Numba | auto-vectorisation; `wide`/`pulp` crates | best-in-class intrinsics | = Rust | WASM SIMD 128-bit |
| Cross-platform (Critical) | CPython everywhere; packaging is the problem | one toolchain, Win/mac/Linux/ARM targets | toolchains per OS (CMake, MSVC, Xcode) | = Rust | browser everywhere; serial/HID Chromium-only |
| Audio APIs (High) | PortAudio (mature) | cpal (ALSA, JACK, WASAPI, ASIO, CoreAudio) | PortAudio/RtAudio/JUCE | cpal | Web Audio (fixed rates, limited device control) |
| GUI integration (Medium) | PySide6 excellent; Tk weak for a waterfall | egui, Slint, iced, Tauri | Qt excellent | egui/Tauri | React excellent |
| Ham ecosystem (High) | rigctld TCP; Hamlib Python bindings uneven | rigctld TCP; Hamlib FFI possible | Hamlib native (the WSJT-X stack) | rigctld TCP | only via the HTTP relay |
| Testing (High) | pytest (excellent) | cargo test, proptest, criterion (excellent) | gtest/Catch2 | both | ad-hoc tsx runner |
| Debugging (High) | excellent | good | good | good | devtools good; real time + hardware poor |
| Developer productivity (High) | highest for research | high after the learning curve; the compiler rejects whole classes of bugs this repo has shipped (wrong types, unhandled `null`) | medium | high | high for UI |
| Packaging (High) | PyInstaller/Briefcase: 150–500 MB with NumPy/SciPy/LLVM/Qt; 7.4 s Numba JIT, cache crash reproduced | 5–20 MB native installers; `cargo-dist` | CMake + Qt deploy, heavy | = Rust (Python never ships) | Python + browser + Node at install |
| Long-term maintainability (Critical) | one language, dynamic types | one language, strong types | high complexity | **one DSP implementation** | **two DSP implementations** (status quo) |

### Answers to the ten questions

1. **Should z-30 remain primarily Python?** Not for the product. Python stays where it is strongest:
   the research harness (Monte Carlo, statistics, plots) and the frozen reference oracle.
2. **Should the DSP engine move?** Yes, to **Rust**. Rust matches C++ on throughput (PoC), is
   memory-safe, and builds native binaries for Windows, macOS and Linux (x86-64 and ARM) from one
   toolchain.
3. **Would a hybrid help?** Yes, if the hybrid *removes* duplication rather than adding a third copy:
   Rust owns every line of protocol and receiver logic, Python calls it through PyO3 for research, and
   nothing else implements the DSP. That also turns "the benchmark measures the shipped receiver"
   from a policy into a fact.
4. **Realistic performance improvement.**
   - LDPC failing decode: **522 → 7.0 ms (75×)** against Python and **20.1 → 7.0 ms (2.9×)** against
     TS.
   - Demodulation: **122/70 → 4.0 ms** against shipped Python/TS, with ≈ 1× against well-vectorised
     NumPy.
   - Whole slot: the shipped chain takes **7–18 s** for 10–20 stations. vNext is projected at
     **< 0.5 s** for 50 candidates on 4 threads, which Phase 2 acceptance must confirm.
   - **Sensitivity** (the bigger win): from ≈ −14.9 dB (shipped front end) to ≈ −22.9 dB (the
     measured Costas-sync receiver). That is algorithmic, not a language effect.
5. **Maintenance cost.**
   - Against: a new language to learn, compile times, and a three-OS CI matrix.
   - For: one implementation instead of two, an estimated 15–20k lines instead of ~44k, compiler-checked
     concurrency and nullability, and `cargo` for everything.
   - Python remains a dev-only dependency.
6. **Cross-platform implications.** Better than today:
   - The Chromium-only Web Serial/Web HID dependency and the HTTP bridge are gone.
   - cpal covers ALSA/JACK/PipeWire (through its ALSA/JACK layers), WASAPI and CoreAudio.
   - `serialport` and `hidapi` are cross-platform; GPIO is feature-gated to Linux.
   - Distribution: AppImage, Flatpak, AUR, MSI, a notarised `.app`, and an aarch64 build for the
     Raspberry Pi.
7. **The Python prototype** becomes `reference/`, frozen as the oracle that generates the golden
   vectors, and `research/` (the benchmark harness) keeps running against the new core. The Tk GUI,
   `web_server.py`, `rf_time_sync.py` and `sic_decoder.py` do not carry over.
8. **Migration difficulty: moderate.** The PoC ported the LDPC cascade and the demodulator (about 430
   lines of Rust, plus a table generated from `ldpc.py`) to **bit-exact** agreement quickly. Once the float32 semantics were written down, the port
   was mechanical. The larger effort is the engine, hardware adapters and GUI, sized in §J.
9. **Benchmarking new against current:**
   - Identical seeded corpora and scenarios, with both implementations callable from the same Python
     harness.
   - Paired McNemar at ≥ 99% for any decode-rate claim; non-inferiority against the oracle's
     receiver.
   - `criterion` benches per kernel.
   - End-to-end slot latency at p50/p99/max on busy-band scenarios, on named reference hardware.
   - False-decode rates on ≥ 100k noise candidates.
10. **Best balance.** A **Rust core and engine, a native `egui` shell, and Python kept for research
    through bindings.** A Python-only product (NumPy-vectorised DSP + Numba LDPC + PySide6) is the
    **viable fallback** if you want one language you already know. The PoC shows it meets the compute
    budget, at the cost of 7 s+ JIT starts, a fragile cache, GIL risk in the audio path, and
    installers several hundred MB larger.

### Decision (Step 6)

**Option C (rebuild the runtime), with the assets carried over.**

- **Carried over:**
  - the protocol definition (bit-exact v1, unless you choose v2)
  - the Python implementation as the oracle
  - the benchmark method and statistics
  - every safety rule and its test scenarios
  - the operator documentation
  - the UI's behaviour as the reference for the new shell
- **Rebuilt:**
  - the receiver front end, SIC, slot and timing engine, audio, hardware transports and GUI
  - the QSO sequencer and the logbook
- **Why a rebuild and not a refactor.** The brief's criteria are met on the evidence:
  - The DSP that ships contains significantly incorrect assumptions (C1–C3).
  - Concurrency cannot be made deterministic inside a browser main thread (C4, H8).
  - The architecture is fundamentally duplicated (H7).
  - Tests do not cover the receive path, so refactoring it safely would mean writing the tests first,
    which is Phase 1 anyway.
  - The clean implementation is substantially smaller.

**Cheaper alternative, stated so you can choose it knowingly.** Fix in place:
- move decoding to a Web Worker
- port `acquisition.py`'s search to TS
- replace SIC with least squares
- fix C1 and C5

That gets a working receiver in the browser in roughly weeks, not months. It leaves two DSP
implementations, browser timing, Chromium-only hardware APIs, the HTTP bridge and Node-at-install in
place.

---

## J. Migration and rebuild plan (ordered)

Sizes are relative (S ≈ days, M ≈ 1–3 weeks, L ≈ 3–6 weeks for one developer with AI assistance).
**Every phase has an exit gate. Nothing proceeds on a failed gate.**

### Phase 0: stop the bleeding in the current code (S; *only if you approve*)

Small, individually reviewable fixes, each with its regression test:
1. The TX gate refuses callsigns that do not round-trip through the packer (C5).
2. Rebuild `web_dist`, or stop serving it, and add a CI check that its embedded commit equals `HEAD`
   (C6).
3. The logbook writes true UTC and never fabricates grid or report (H1).
4. Trigger the decode after the DT window completes, with a virtual-clock test (C1).
5. RF time sync returns failure without a detected marker and never silently simulates (H4).
6. The wiki, README and Specs modal state what the *shipped* receiver achieves, citing this report's
   paired result (H6).

### Phase 1: freeze the specification and capture the oracle (M)

- `SPEC.md`, derived **from the code, not the wiki**: bit layouts, codec rules including today's edge
  cases, CRC, H, encoder, symbol mapping, Costas pattern, GFSK equations, slot timing, and the float32
  decoder semantics the PoC had to reverse-engineer.
- Golden-vector export (§I.9, layer 2) and freezing `reference/`.
- **Protocol v2 decision (yours).** A trade study, measured through the harness, of:
  - (a) v1 as-is, plus gate refusals
  - (b) v2 payload of 28 + 28 + 1 (R) + 15 (grid/report, FT8-style) + 14 CRC = 86 bits. The current
    (216, 77) code cannot carry it, so the options are a rate-0.40 code in the same 54 data symbols
    (a coding-gain cost to measure) or 60 data symbols (25.9 s TX, less decode time).
  - Recommendation: (b), decided on measured cost, **before** Phase 2 fixes the wire format.

### Phase 2: `z30-protocol`, `z30-dsp`, `z30-channel`, `z30-py` (L)

- **Port:** bit-exact against the golden vectors, in CI on 3 OSes.
- **New receiver:** the §C.4 front end, with drift tracking and least-squares SIC.
- **Research harness:** re-pointed at `decode_slot`.

**Gate:**
1. Golden parity.
2. AWGN 50% threshold through `decode_slot` searching the whole band with multiple candidates:
   non-inferior to the oracle receiver's −22.92 dB [−23.07, −22.79] at 200 frames per point, paired,
   ≥ 99%.
3. False decodes over ≥ 100k noise candidates: rate and interval reported.
4. SIC: ≥ 20 dB suppression at +10 dB and zero duplicates.
5. `decode_slot` with K = 50 in < 1 s on the reference laptop (single thread allowed up to 2 s).

### Phase 3: `z30-engine` + `z30-io` + `z30-cli` (L)

- Audio, slot clock, TX scheduler, rigctld, PTT adapters.
- The TxGate and RigStateTracker port, with **every scenario from `transmitPath`, `rigReadback` and
  `rigProbeAndWatchdog` translated to Rust tests**.
- Logbook and config, including import of existing configs and logs.

**Gate:**
1. Virtual-clock 24 h soak: no missed slot, no slot misalignment beyond 10 ms.
2. Zero allocations in the audio callback.
3. Dummy-load TX: occupied bandwidth within the existing budgets, measured off the audio output with
   the modem spectrum test's method.
4. Headless receive on a Raspberry Pi.

### Phase 4: GUI shell (M–L)

Waterfall, band activity, QSO panel, TX controls, settings, logbook and rig panel, plus accessibility
basics.

**Gate:** a scripted UI smoke test, and UI frame time under 16 ms with the waterfall running.

### Phase 5: parallel run and cutover (M)

- Receive-only shadow operation: vNext against the oracle on recorded real slots.
- A supervised on-air beta.
- Release 2.0 installers.
- Retire the browser runtime, `web_server.py`, `web_dist/`, the Tk utilities and `monteCarloEngine.ts`.
- Move `wiki/` to `docs/`.

**Gate:** the published sensitivity figures are re-measured through the shipped entry point and
quoted with seed, frame count, channel and interval.

---

## Success criteria (the brief's list)

| # | Question | Answered in |
| :-- | :--- | :--- |
| 1 | What is currently good | §A strengths; §C.1 KEEP rows; §B.6 |
| 2 | What is broken | §H CRITICAL/HIGH (C1–C6, H1–H10), each with a reproducible probe |
| 3 | What is inefficient | §D (75× LDPC, 17–36× demodulation, 317 ms per-candidate refinement, full-band FFT waste) |
| 4 | What is mathematically questionable | §C.2 OSD tautology, §C.3 SIC, C2 grid defect, M3 SNR reference, M1 |
| 5 | What should be retained | §B.6 KEEP rows; Decision |
| 6 | What should be rewritten | §B.6 REBUILD/REPLACE rows |
| 7 | Whether a full rebuild is justified | Decision: rebuild the runtime; the criteria and evidence are listed there |
| 8 | What the new architecture looks like | §I, §C.4, §E |
| 9 | How the new implementation will be tested | §I.9 |
| 10 | How we will prove it is faster and more reliable | Technology Q9; Phase 2–5 gates |

---

## Appendix: reproducing every number

```bash
pip install -r requirements.txt pytest && npm ci
python -m pytest tests -q && npm run lint && npm run test:ts          # suites
npx tsx audit/2026-09-23-vnext/probes/live_rx_trigger.mts              # C1
npx tsx audit/2026-09-23-vnext/probes/shipped_threshold.mts -24,-14 40 20260924       # C2, run as four
npx tsx audit/2026-09-23-vnext/probes/shipped_threshold.mts -22,-13 40 20260925       #   processes with
npx tsx audit/2026-09-23-vnext/probes/shipped_threshold.mts -20,-12,-10 40 20260926   #   these exact
npx tsx audit/2026-09-23-vnext/probes/shipped_threshold.mts -18,-16,-11 40 20260927   #   seeds
npx tsx audit/2026-09-23-vnext/probes/freq_snapping.mts                # C2 root cause
npx tsx audit/2026-09-23-vnext/probes/sic_cancellation.mts             # C3
npx tsx audit/2026-09-23-vnext/probes/busy_band.mts 1,5,10,20 2 99     # C4
npx tsx audit/2026-09-23-vnext/probes/codec_roundtrip.mts              # C5, H2, H3
TZ=America/Los_Angeles npx tsx audit/2026-09-23-vnext/probes/autolog_fields.mts   # H1
npx tsx audit/2026-09-23-vnext/probes/false_decodes.mts 2500 11 1      # M1 (report: seeds 11-14)
python audit/2026-09-23-vnext/probes/timesync_noise.py                 # H4
python audit/2026-09-23-vnext/probes/wideband_acquisition.py           # §C.4
python audit/2026-09-23-vnext/probes/drift_and_clock.py -22            # H9 (and -20)
# Language PoC
python audit/2026-09-23-vnext/poc/make_corpus.py /tmp/z30corpus
python audit/2026-09-23-vnext/poc/py_timing.py /tmp/z30corpus
pip install numba && python audit/2026-09-23-vnext/poc/numba_ldpc.py /tmp/z30corpus
npx tsx audit/2026-09-23-vnext/poc/ts_corpus.mts /tmp/z30corpus
(cd audit/2026-09-23-vnext/poc/rust && cargo run --release -- /tmp/z30corpus)
```

`make_corpus.py` also writes the demodulator test vector the other arms read (`demod_wave.bin`,
`demod_llr_py.bin`, `demod_meta.txt`). The binaries are not committed: re-running the script
reproduces the corpus this report used byte for byte (seeded, and checked). Raw outputs from this audit's runs are in `results/`. Two of them depend on the
wall-clock time of the run by nature: the RF-time-sync "offset" (which is the finding) and the
timings.
