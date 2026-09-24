# Codebase cleanup & dedup audit — 2026-09-01

Scope: the whole tree — `z30_dsp/` (~8,500 lines) and `src/` (~39,000 lines) — for dead code,
duplicated logic, and irregularities/bugs surfaced along the way. `AGENTS.md` and the `wiki/`
were read first and treated as the specification; Section 4's invariants (transmit safety, CRC/
LDPC constants, determinism, single-source-of-truth rules) gated every change below.

**This is a review document plus the fixes it justified.** Every finding was verified by reading
the actual code (and, where practical, tracing every call site) before anything was changed.
Two categories below: fixed in this pass, and documented for a human decision because fixing
them either touches a pinned test, needs empirical verification against real hardware, or
changes established public API surface beyond what a cleanup pass should decide alone.

The full test suite (204 Python tests, 353 TypeScript checks, `npm run lint`, `npm run
check:generated`, `npm run build`) passes after every change in this file.

---

## Summary — fixed in this pass

| # | Area | Finding |
| :-- | :--- | :--- |
| 1 | Python | `benchmark.py`: dead `run_self_test`/`main` aliases, never imported anywhere |
| 2 | Python | `benchmark.py`/`sic_decoder.py`: identical codeword→symbol packing + Costas interleave duplicated; extracted to `modem.codeword_to_symbols()` |
| 3 | Python | `benchmark.py`: two return values from `generate_random_frame()` unpacked and never used (ruff's F841 doesn't catch tuple-unpack targets) |
| 4 | Python | `rf_time_sync.py`: `CatTuner.tune()` reported success regardless of rigctld's actual `RPRT` reply |
| 5 | Python | `auto_logger.py`/`station_settings.py`: Maidenhead grid→lat/lon duplicated with diverging precision (one ignores the 6-character subsquare) |
| 6 | Python | `rf_time_sync.py`: `DCF77Decoder`/`GenericLFDecoder` reported hardcoded fake `snr_db` (8.2 / 6.8) instead of a measurement |
| 7 | Python | `band_manager.py`: dead observer-pattern infrastructure (`register_listener`/`_notify_listeners`), zero registrants anywhere |
| 8 | TypeScript | `localServerApi.ts`: unused `getServerStatus()`/`ServerStatus` |
| 9 | TypeScript | `hamlibCatalog.ts`: unused `getRigById()` |
| 10 | TypeScript | `SpecsModal.tsx`: sensitivity figures hand-retyped instead of importing `Z30_SPECS` (the exact failure mode AGENTS.md names for this file) |
| 11 | TypeScript | `realReceiver.ts`: `refineBaseFreq`'s 16-tone search duplicated inline inside `refineTimingAndFreq`'s `scanGrid` |

## Summary — documented, not fixed

| # | Area | Finding | Why left alone |
| :-- | :--- | :--- | :--- |
| 12 | TypeScript | Two independent CRC-14 implementations (`z30Codec.ts` vs `ldpcCodec.ts`) | Consolidating breaks the pinned `test_crc_constants_match` parity test — see below |
| 13 | Python | `ldpc.py`: `encode()`'s parity loop duplicates `reaccumulate_ira_codeword()` | Inside the pinned (216,77) LDPC codec; self-flagged, needs bit-for-bit verification before touching |
| 14 | Python | rigctld client hand-rolled 4 times across `band_manager.py`, `web_server.py`, `config_wizard.py`, `rf_time_sync.py` | Different call surfaces/error handling per caller; a real consolidation is a deliberate refactor, not a cleanup-pass side effect |
| 15 | Python | `sic_decoder.py`: `process_buffer()` (and its unused `base_dial_hz` param) unreachable from any current entry point | Documented top-level public API for the SIC decoder, not leftover cruft |
| 16 | Python | `sic_decoder.py`: `DecodedCarrier.dt_sec` hardcoded to `0.0` | Real gap, but nothing currently consumes `process_buffer()`'s output |
| 17 | Python | `rf_time_sync.py`: `DSPUtils.estimate_carrier_snr`'s `bw_hz` parameter accepted but never used | Fixing it changes computed SNR feeding `has_carrier` gating on real RF hardware; needs empirical verification, not a cleanup-pass call |
| 18 | Python | `config_wizard.py`: PTT wiring-test path keys real hardware outside the browser's `canTransmit()` gate | Flagged for awareness only — it's the Python setup wizard's own hardware self-test, independently hardened (confirmation dialog, 3 s auto-release, `finally`-block release) |
| 19 | TypeScript | `ldpcCodec.ts`: `Z30LdpcEngine.encode()` unreachable from production code, exercised only by `tests/crc14.test.mjs` | The self-check (encoder satisfies its own parity-check matrix) has real regression value; removing it means editing a protected test |
| 20 | TypeScript | `z30Constants.ts`: `Z30_SPECS.SNR_THRESHOLD_RAYLEIGH` still unread by any UI | Legitimate wiki-sourced spec value, just not wired to a component yet — not leftover cruft |
| 21 | TypeScript | `SpecsModal.tsx`: idealised-bound 90% figure (`-23.4 dB`) has no backing constant | No `SNR_THRESHOLD_90_IDEAL` exists in `Z30_SPECS`; adding one is a feature addition, out of scope here |
| 22 | TypeScript | `qsoLogger.ts`: SQL-dump export manually escapes quotes per field | Low confidence as a real issue — client-side generator of a downloadable `.sql` file, not a live query |
| 23 | Python | `acquisition.py`: `Acquisition.found` property unused by any Python caller | Its own docstring documents `found` as the intended way to read the result, and it's the twin of `MonteCarloEngine`'s `.found`, which the browser does use (tested in `tests/frontend.test.mjs`) |

Also checked and confirmed **not** an issue: decorative `Math.random()` in `RfTimeSyncModal.tsx`
(canvas animation jitter only, doesn't feed the real decode path); every `setPtt` call site
routes through `canTransmit()`; no second keying implementation; no wildcard CORS; no unseeded
PRNG anywhere in the DSP/benchmark path; every component prop is destructured and used (the
`RigControlPanel`/`QsoController` bug class AGENTS.md names has not regressed).

---

## Fixed

### 1 — dead aliases in `benchmark.py`

`z30_dsp/benchmark.py:535-536` (before fix):

```python
run_self_test = run_benchmark
main = run_benchmark
```

Neither name is imported or called anywhere in the repo. `main.py` imports `run_benchmark`
directly, and no `pyproject.toml` entry point references `z30_dsp.benchmark:main`. Removed both.

### 2 — duplicated frame-symbol packing

`benchmark.generate_random_frame()` and `sic_decoder.Z30SicMultiSignalDecoder._recover_symbols()`
each carried an identical ~25-line loop: pack a 216-bit LDPC codeword into 54 4-bit tones, then
interleave with the 21 Costas sync tones at `cfg.sync_positions`. `_recover_symbols`'s own
docstring already said it was "mirroring `z30_dsp.benchmark.generate_random_frame`'s assembly" —
acknowledged duplication, not accidental. Extracted to `modem.codeword_to_symbols()`; both call
sites now call it. Covered by the existing `tests/test_ldpc_codec.py`,
`tests/test_channel_acquisition.py` and `tests/test_cross_language_parity.py` (all still pass).

### 3 — unused unpacked variables in `benchmark.py`

`generate_random_frame()`'s 4-tuple return is a real, tested contract (both `tests/
test_ldpc_codec.py` and `tests/test_channel_acquisition.py` unpack it with `_`-prefixed names
for the elements they don't use). `benchmark.py`'s own inner loop at the one production call
site unpacked all four as if all were used, but `codeword` and `data_symbols` were never
referenced afterward — ruff's `F841` (part of the pinned `E4,E7,E9,F` rule set) does not flag
unused tuple-unpack targets, so this was invisible to CI. Renamed to `_codeword`/`_data_symbols`
to match the convention the tests already use. No behavior change.

### 4 — `CatTuner.tune()` silently ignoring rigctld's refusal

`z30_dsp/rf_time_sync.py`, `CatTuner.tune()` (before fix) sent `F <freq>` and `M <mode>
<passband>` to rigctld and returned `True` as long as `recv()` didn't raise — never checking
whether rigctld actually accepted the command. `band_manager.HamlibCatClient._accepted()`'s own
docstring documents fixing precisely this bug class elsewhere in the codebase ("An empty reply
used to count as success here... silence is neither, and it is the one case where the caller
most needs to be told"), but the fix was never applied to `CatTuner`. A rig that refused the
retune (wrong VFO, busy, unsupported mode/passband) was reported as tuned. Added a `CatTuner.
_accepted()` mirroring the existing pattern and made `tune()` check both replies. Not
transmit-safety-relevant (this is the RX-only time-sync tuning path), but a real correctness bug
that could leave `RFTimeSyncThread` dwelling and decoding against the wrong frequency while
believing it had moved. The caller already discards `tune()`'s return value and independently
validates via `validate_pre_carrier()`, so this fix changes no control flow — only what's logged
and what a future caller sees.

### 5 — Maidenhead grid precision diverging between two implementations

`auto_logger.calculate_maidenhead_distance()` carried its own inline grid-to-lat/lon parser that
only handled the 4-character grid square and always resolved to its center, ignoring characters
5-6 even when a caller supplied a 6-character grid. `station_settings.SettingsManager.
maidenhead_to_latlon()` is the more precise implementation — it resolves the 6-character
subsquare when present — and is already the one the setup wizard uses for its grid preview. Net
effect before the fix: a logged QSO's `distance_km`/`azimuth_deg` was coarser than the wizard's
own preview even when both stations reported 6-character grids. `auto_logger.py` now imports and
calls `SettingsManager.maidenhead_to_latlon()` instead of carrying a second copy of the formula.
No test pinned an exact distance value, so this is a precision improvement, not a behavior break.

### 6 — fake hardcoded SNR in two of six time-station decoders

`DCF77Decoder.process_dwell_stream()` and `GenericLFDecoder.process_dwell_stream()` (covering
MSF, WWVB and JJY) returned literal `snr_db=8.2` / `snr_db=6.8` in their `TimeSyncResult` instead
of a measurement — unlike `WWVDecoder`/`CHUDecoder`, which compute a real SNR via `DSPUtils.
estimate_carrier_snr()` and floor it. The operator-facing "SNR" for four of the six supported
stations was fake. Not gating logic — `validate_pre_carrier()` (which does gate) already computes
a real SNR independently and was untouched — this only affects the informational field reported
after a successful dwell. Fixed by measuring off the same 1 kHz baseband representation of the
carrier that each decoder's own `validate_pre_carrier()` already uses, floored the same way
WWV/CHU are.

### 7 — dead observer-pattern infrastructure in `band_manager.py`

`BandManager.register_listener()`, `_notify_listeners()` and the `on_band_change_listeners` list
were wired through five mutation points (`set_band_frequency`, `reset_to_defaults`,
`reset_band_to_default`, `select_band`, `sync_from_radio`) but nothing anywhere in the
repository — not `gui.py`, not `gui_tkinter.py`, not any test — ever calls `register_listener()`.
The list was permanently empty and every `_notify_listeners()` call was a no-op loop over
nothing. Removed the method pair, the list, the five call sites, and the now-unused `List`
import.

### 8, 9 — unused exports in `localServerApi.ts` / `hamlibCatalog.ts`

`getServerStatus()`/`ServerStatus` (calls `/api/status`, which the server exposes, but nothing
in `src/` ever calls it) and `getRigById()` (every real rig lookup goes through `getRigByName()`
instead) had zero callers anywhere in the tree. Removed both.

### 10 — `SpecsModal.tsx` retyping sensitivity figures instead of importing them

`z30Constants.ts`'s `Z30_SPECS.SNR_THRESHOLD_AWGN`/`SNR_THRESHOLD_90_AWGN`/
`SNR_IDEAL_BOUND_AWGN` were defined (with a comment noting the placeholder values they replaced
"held for years... because nothing reads them") but genuinely unread anywhere in `src/` — the
fix that added the constants was never finished. `SpecsModal.tsx` prints these exact figures in
five places as literal JSX text without importing `Z30_SPECS` at all — precisely the failure mode
AGENTS.md section 4 names this file for by name ("`SpecsModal` said 'up to 50 iterations' for
years while both codecs stopped at 45"); that instance was fixed (the file does correctly import
`LDPC_MAX_ITERATIONS`), but the sensitivity figures were never migrated. Wired all five sites to
`Z30_SPECS`, which resolves the dead-constant finding and the retyped-literal finding together.

### 11 — `refineBaseFreq` duplicated inline in `refineTimingAndFreq`

`realReceiver.ts`'s exported `refineBaseFreq()` (search all 16 tone offsets by pilot amplitude,
keep the max) had zero callers — the real acquisition path, `refineTimingAndFreq`'s inline
`scanGrid` helper, carried an identical copy of the same loop instead of calling it. Replaced the
inline loop with a call to `refineBaseFreq()` followed by one `pilotAmplitude()` call to recover
the amplitude for the joint dt/frequency comparison — mathematically identical to the inline
version (the amplitude at `refineBaseFreq`'s chosen frequency is exactly the max the inner loop
would have kept), verified by the full `npm run test:ts` suite passing unchanged (353/353).

---

## Documented, not fixed

### 12 — two CRC-14 implementations in TypeScript (attempted, reverted)

`z30Codec.ts::computeCrc14()` (used by the real TX pack path and `monteCarloEngine.ts`) and
`ldpcCodec.ts::Z30LdpcEngine.computeCrc14()` (used internally by `decodeMinSum()`'s CRC checks)
are two independent hand-written copies of the same register/init/poly math. They agree
numerically today, checked against the shared `tests/vectors/crc14_vectors.json` KAT vectors,
but `ldpcCodec.ts`'s copy hardcodes `Math.min(63, bits.length)` while `z30Codec.ts`'s iterates
the full array unconditionally — a latent divergence if either is ever called with a
differently-shaped input. `tests/crc14.test.mjs` only imports and exercises the `ldpcCodec.ts`
copy, never `z30Codec.ts`'s.

This was fixed and then reverted in this session: making `Z30LdpcEngine.computeCrc14` delegate
to `z30Codec.ts`'s implementation is behavior-preserving (verified against all 15 shared KAT
vectors and the full `npm run test:ts` suite), but it breaks
`tests/test_cross_language_parity.py::test_crc_constants_match`, which greps `src/dsp/
ldpcCodec.ts` specifically for the literal `const poly = 0x2443` / `let crc = 0x2757` as its
TypeScript-side half of the Python/TypeScript CRC parity pin. AGENTS.md section 4 lists CRC-14
under "Signal integrity" as protected, and its own house rule is explicit: "If a change makes
one of these tests fail, the change is wrong — do not edit the test to match." A real fix here
needs the parity test updated deliberately (e.g. to check the constant's presence in whichever
file the reader considers canonical, or in both) as part of the same reviewed change — not as an
automated cleanup-pass side effect. Left both copies in place with a comment on
`Z30LdpcEngine.computeCrc14` explaining why.

### 13 — `ldpc.py`: `encode()` duplicates `reaccumulate_ira_codeword()`

`Z30LdpcCodec.encode()`'s parity-accumulation loop is line-for-line identical logic to
`reaccumulate_ira_codeword()` elsewhere in the same file — `encode()` could call the latter
instead of re-implementing it. Inside the pinned (216, 77) LDPC codec, which AGENTS.md calls a
protocol break to get wrong. Not touched: the duplication is real, but confirming a refactor
changes nothing requires bit-for-bit verification of codeword construction ordering between the
two call sites, which is a deliberate, focused change, not a cleanup-pass judgment call.

### 14 — rigctld TCP client hand-rolled four times

`band_manager.HamlibCatClient` (persistent socket), `web_server.RigctlRelay.send()` (one-shot),
`config_wizard.rigctld_command()` (one-shot, near-identical to `RigctlRelay.send()`), and
`rf_time_sync.CatTuner` (persistent socket) each independently implement "connect, send command,
read until trailing newline or timeout." Real duplication, but each serves a different subsystem
with different call surfaces and error handling (web API relay vs. Tk wizard vs. band CLI vs.
time-sync engine). Consolidating is worthwhile but is a larger, riskier refactor that deserves
its own focused change and testing, not a fold-in during a broad cleanup pass.

### 15, 16 — `sic_decoder.py`: `process_buffer()` unreachable, `dt_sec` never computed

`Z30SicMultiSignalDecoder.process_buffer()` — the SIC pipeline's public entry point, and
transitively the only caller of most of the class's private helpers — is not called from any
current entry point (`z30_dsp/`, `tests/`, `scripts/`); nothing exercises it end-to-end today.
Its module docstring documents it as the pipeline's real interface, most plausibly intended for
a future CLI/offline-decode tool, so it was not deleted as leftover cruft. Its `base_dial_hz`
parameter (default `14074000`) is accepted but never read in the method body — `DecodedCarrier.
freq_hz` is always the audio offset alone. Separately, `DecodedCarrier.dt_sec` is a real
dataclass field but is hardcoded to `0.0` at its only construction site, never computed from the
actual SIC decode (contrast with `freq_hz`, which is refined to sub-0.01 Hz). Both are genuine
gaps worth completing when `process_buffer()` gets a real caller, but low-risk to leave as-is
today since nothing currently consumes its output.

### 17 — `estimate_carrier_snr`'s `bw_hz` parameter is accepted but unused

`DSPUtils.estimate_carrier_snr(samples, sample_rate, center_freq_hz, bw_hz=50.0)` in
`rf_time_sync.py` is called with station-specific bandwidths (20/30/40/100 Hz) from every
`validate_pre_carrier()` implementation, but the noise-reference offset inside the function is
hardcoded to `±250.0 Hz` regardless of `bw_hz`. Every call site believes it's tuning the
measurement bandwidth to the station's actual subcarrier width; none of them are. Real bug, but
fixing it changes the computed SNR value at every station, which feeds the `has_carrier`
threshold decisions gating real RF hardware acquisition. Verifying what the corrected noise-floor
value should actually produce at each station's real bandwidth needs measurement against real
captures, which is outside what a code-cleanup pass should decide unilaterally.

### 18 — Python setup wizard's PTT test keys hardware outside the TypeScript gate

`config_wizard.py`'s `Step3RadioCatPage._key_ptt`/`_ptt_worker`/`_release_ptt` send a real `T 1`/
RTS/DTR keying command directly to rigctld or a serial port. This is the Tk setup wizard's own
hardware self-test, written in Python — it is not, and was never meant to be, a caller of the
browser's `canTransmit()`/`setPtt()` (that gate is TypeScript, and AGENTS.md section 4 describes
it as the gate in front of the browser's transmit paths). It is not dead code, and it is not a
duplicate of the removed `HamlibCatClient.set_ptt()` (that removal's comment explicitly names
this test as the sanctioned way to key hardware for a wiring check). On its own terms it looks
carefully hardened: an explicit `askokcancel` confirmation naming the risk, a 3-second
auto-release, and release logic in a `finally` block with polarity-aware level handling. Flagged
here only so this path's existence and scope are on record — not proposing any change.

### 19 — `Z30LdpcEngine.encode()` unreachable from production TypeScript

`ldpcCodec.ts::Z30LdpcEngine.encode()` (the dual-diagonal accumulation loop over
`Z30_CHECK_TO_INFO`) has zero callers in `src/` — the app's real encode path is exclusively
`z30Codec.ts::encodeLdpc216_77` + `computeCrc14`. `tests/crc14.test.mjs` does call `engine.
encode()`, to verify the encoder satisfies its own parity-check matrix (mirroring what
`tests/test_ldpc_codec.py` asserts on the Python side). That self-check has real regression
value independent of whether the app calls this exact method, and removing the method means
editing a protected test — left in place.

### 20, 21 — sensitivity constants/UI gaps

`Z30_SPECS.SNR_THRESHOLD_RAYLEIGH` (-21.3 dB, moderate-fading threshold from wiki/16) is defined
but not displayed anywhere in the UI yet — a legitimate spec value waiting for a UI consumer, not
leftover cruft, so left in place rather than removed for being currently unread. Conversely,
`SpecsModal.tsx`'s idealised-bound 90% figure (`-23.4 dB`) has no backing constant at all — only
the 50% ideal bound (`SNR_IDEAL_BOUND_AWGN`) is defined in `Z30_SPECS`. Left as a literal; adding
a new constant is a feature addition beyond what this cleanup pass should decide.

### 22 — `qsoLogger.ts` SQL export escaping

The raw SQL-dump generator (`qsoLogger.ts` around line 650) manually escapes single quotes on
every interpolated field rather than using parameterized queries. Low confidence this is a real
issue: it's a client-side generator of a downloadable `.sql` text file, not a live query against
a database, so it isn't an injection vector in the traditional sense today. Worth a second look
only if this export path is ever wired to something that executes the output directly.

### 23 — `Acquisition.found` unused in Python

`acquisition.py`'s `Acquisition.found` property (`sync_score_db > 0.0`) is never read by any
Python caller — `benchmark.py` computes acquisition failure inline against ground truth (the
synthetic frame's known true start sample) instead, since the benchmark can do that and a real
receiver can't. But `acquire_frame()`'s own docstring documents `found` as the way to interpret
its return value ("Returns an `Acquisition`. `found` is False when nothing in the search space
stands out from the noise floor..."), and it mirrors `MonteCarloEngine`'s `.found` in TypeScript,
which the browser acquisition path does use and `tests/frontend.test.mjs` does test. Left in
place as documented API, not dead code in the leftover-cruft sense.
