# Measured results

Raw, machine-readable outputs of the benchmark instruments. Every figure in `README.md`,
`docs/` and `wiki/` that comes from here cites the file. Nothing here is edited by hand. All of
it is software simulation: no radio, sound card or RF path was involved.

## The benchmark suite: `<commit>/`

`z30 --benchmark suite` writes one JSON file per benchmark to `research/results/<commit>/`,
named after the commit of the binary that produced it. Each file records the commit, build
profile, compiler, target, OS, CPU, the receiver entry point (`decode_slot`) and its full
configuration, the channel, the placement distributions, the seed rule, the definitions and the
per-point results. `python3 research/summarize_suite.py <dir> --write` renders `SUMMARY.md`
beside them.

| Directory | Binary | Contents |
| :--- | :--- | :--- |
| [`18fbd78d8fb8/`](18fbd78d8fb8/) | release build of `18fbd78`, rustc 1.98.1, x86_64 Linux, 4 logical CPUs | `awgn.json` (replicate 0 = the published seed; identical to `672cef9b3cdb/awgn.json`) and `awgn_replicates/replicate-1` … `replicate-10`: the AWGN benchmark on ten disjoint sets of frames (`--replicate`), to measure the run-to-run spread of the crossing; each says it is not the published run. `18fbd78` changes only the harness's replicate seeding, not the receiver |
| [`672cef9b3cdb/`](672cef9b3cdb/SUMMARY.md) | release build of `672cef9` (corrective remediation), rustc 1.98.1, x86_64 Linux, 4 logical CPUs | **current.** The whole suite at publishable size, suite seed 20260830 |
| [`d8983eeef66e/`](d8983eeef66e/SUMMARY.md) | release build of `d8983ee`, rustc 1.98.1, x86_64 Linux, 4 logical CPUs | the first suite run: `awgn`, `snr`, `drift`, `timing`, `clock`, `impair`, `busy`, `false`, `sic`, `fading` (200 frames per point; 100 for `snr` and per `sic` cell; 400 slots per `false` kind); suite seed 20260830. **Its `fading.json` is withdrawn**: the channel model then ran every Watterson preset at 1/√2 of its labelled Doppler spread (post-remediation audit N-01). The other nine files are reproduced identically by `672cef9b3cdb/` |

Command: `cargo build --release -p z30-cli && ./target/release/z30 --benchmark suite`.
The receiver (`z30-dsp`, and the protocol's modulator, LDPC, CRC and symbol map) is unchanged
from `d8983ee` to `672cef9`; `z30-channel`'s Watterson model changed at `b75f773` (N-01), which
is why only `fading` differs between the two directories.

### Status, destinations and notes on the committed results (2026-09-28)

Results written from 2026-09-28 carry a `status` and the instrument identity, and `z30` writes
only a `published` result (clean build, suite seed, at least the benchmark's publishable size)
to `<commit>/`; replicates go to `<commit>/replicates/r<N>/`, exploratory runs to
`exploratory/<commit>/` and dirty builds to `unpublished/<commit>-dirty-<diff>/` (the last two
are ignored by version control). See [docs/benchmarking.md](../../docs/benchmarking.md). The
committed files above predate this and are **not edited**; the research scripts classify them
from the markers they carry:

- **Frame policy (F-32).** The exploratory line moved from "below 100 frames" to "below the
  benchmark's publishable size" (200 per point behind every crossing). Every committed suite
  result was run at its benchmark's default size, which is its publishable size, so **none
  changes status**: `672cef9b3cdb/` and `d8983eeef66e/` read as published (the latter's
  `fading.json` stays withdrawn, as above), `18fbd78d8fb8/awgn.json` as published, its
  `awgn_replicates/` as replicates.
- **`false.json`'s 16-FSK row (DSP-07 / F-53).** In `672cef9b3cdb/false.json` and
  `d8983eeef66e/false.json` (and their `SUMMARY.md`) the row "8 random 16-FSK signals without
  the Costas pattern, 0 dB" ran at **−3 dB** per interferer; the harness has always generated
  it that way. The suite now labels it −3 dB. Signal and seeds are unchanged, so the counts
  reproduce; `research/compare_results.py` reports the relabel as a note, not a difference.
- **Instrument identity.** These files carry none, so comparing against them needs
  `compare_results.py --legacy-provenance`, whose output says the instrument was not checked.

## Earlier instruments (top level)

Measured before the suite existed; each is kept with the commit it was measured at.

Host for these runs: 4 vCPU Intel Xeon @ 2.80 GHz, 16 GB, Linux 6.18, Python 3.11.15,
NumPy 2.2.6; Rust 1.94.1 (awgn_paired_200) and 1.98.1 (the rest). 1.94.1 is below the MSRV declared
later (1.95); that run predates the declaration and its wheel's compiler cannot be checked from the
file, which records no wheel provenance (QA-06 / F-79, and F-34). The oracle harness imported
the Python oracle, then at `legacy/python-oracle/`.

**The paired harness was removed after `acfce5e`.** `research/paired_receiver.py`, the Python
oracle it compared against and the `z30-py` bindings it loaded were deleted in the 2026-10-06
cleanup (`audit/2026-10-06-codebase-cleanup/`); `acfce5e` is the last commit that contains them. The two
`paired_receiver.py` commands below can be run only from a checkout of that commit. The result
files are unchanged and stay as evidence of what was measured; nothing about them is withdrawn.

| File | What | Command |
| :--- | :--- | :--- |
| `awgn_paired_200.txt` / `.json` | AWGN decode rate, oracle (windowed) vs vNext `decode_slot` (blind), paired on the same buffers (oracle `--mode realistic` producer: carrier ±5 Hz, timing ±0.5 s), seed 20260830, 200 frames/point, -28..-17 dB | `python research/paired_receiver.py --min-snr -28 --max-snr -17 --frames 200 --workers 4 --out research/results/awgn_paired_200.json` |
| `whitening_ab_200.txt` / `.json` | Per-tone interference whitening on (A) vs off (B), same buffers, AWGN, 200 frames/point, -25..-21 dB: 0 discordant of 1000 | `python research/paired_receiver.py --min-snr -25 --max-snr -21 --frames 200 --workers 4 --vnext-only --arm-b '{"whiten": false}' --out research/results/whitening_ab_200.json` |
| `perf_k.txt` | `decode_slot` latency p50/p95/p99/max, throughput, process CPU and heap allocations per slot at K = 1, 5, 20, 50 stations, 20 seeded slots each, 4 threads and 1, on an idle host | `z30 --benchmark perf --frames 20` |
| `false_decodes_2000.txt` | 2000 noise-only slots: 0 false decodes in 133,911 LDPC attempts with the fine-sync gate off (exact 95% upper bound 2.24e-5 per attempt); 0 in 2000 slots with the production config | `z30 --benchmark false-decodes --frames 2000` |

Status of these files (2026-09-28 agent-team audit, record hygiene; the files themselves are
not edited):

- **`perf_k.txt` is historical, not current (F-35).** It was measured before the replica fit
  of `d8983ee`, so the receiver it timed is not today's. With 20 slots per row its "p99" is the
  maximum, it embeds no provenance of its own, and its 4-thread allocation column is not a
  deterministic measurement (heap allocations under rayon depend on work stealing; QA-07 could
  not reproduce it, while the single-thread column reproduced exactly). No performance figure
  may be quoted as current until `z30 --benchmark perf` is re-run on an idle host.
- **`false_decodes_2000.txt`** embeds no provenance either (QA-02); its counts reproduced
  exactly at `caf1a9a` (05-qa-reproduction.md).
- **Loose files at this level (F-73).** These predate per-commit directories; they stay here
  because committed documents cite these paths. New results go only under `<commit>/`. The
  G2.3 OSD study cited in the corrective audit has no result file here: that figure is
  unbacked by a file and must not be quoted as a measurement.
- **`d8983eeef66e/SUMMARY.md` (F-65)** was generated by an earlier `summarize_suite.py`: its
  fading-table header reads "Delay / Doppler" where the current script writes "Delay / Doppler
  spread (2 sigma)"; no number differs. It is deliberately not regenerated (its `fading.json`
  is withdrawn, above, and regenerating would rewrite a historical record). Treat that file's
  fading table as withdrawn.
- **`18fbd78d8fb8/SUMMARY.md` (F-67)** was generated on 2026-09-28 with
  `python3 research/summarize_suite.py research/results/18fbd78d8fb8 --partial --write`; it
  covers only `awgn.json` (the directory holds no other benchmark) and says so. The pooled
  figure over 2200 frames per point (AGENTS.md §5) is computed from the replicate files by
  `audit/2026-09-24-corrective-remediation/evidence/awgn_investigation/analyse_awgn.py` (output
  `awgn_replicate_analysis.json`, key `pooled`); no script in `research/` produces it yet.

Provenance notes:

- `awgn_paired_200`: first measured with the wheel built from the tree that became `f180122`
  (header `8be9e00`, the HEAD the harness read when it started). Re-run at `83b1b70`, after the
  fine-sync interpolation, whitening and SIC changes, with a clean wheel built from that commit:
  every point reproduced frame for frame, so the crossings and the McNemar result are unchanged.
  The file now holds the `83b1b70` run. The oracle arm reproduces
  the published `--mode realistic` table frame for frame (-22.92 dB [-23.07, -22.79]). Later
  changes to SIC cannot move it: every frame holds one station, SIC runs only after a decode,
  and a decode is already counted.
- `whitening_ab_200`: re-run with the `83b1b70` wheel (header `73ce0f9`; `decode_slot` is
  unchanged between the two): identical to the first run, 0 discordant of 1000. Its per-point
  counts differ from `awgn_paired_200` at the same SNR (18 against 23 at -24 dB) because the
  harness consumes one generator across the sweep in order, so a sweep starting at -25 dB draws
  different frames from one starting at -28 dB. Compare arms within a file, never counts across
  files.
- The `git` field inside `awgn_paired_200.json` (`73ce0f9`) and `whitening_ab_200.json`
  (`0ab6cf0`) disagrees with the commit in each `.txt` header (`83b1b70`, `73ce0f9`) and with the
  notes above: the harness read `HEAD` when it wrote the file, and `HEAD` had moved while the run
  was in progress (post-remediation QA-C). The wheel's commit is the one in the `.txt` header.
  The paired harness later recorded the wheel's own build provenance (F-34), so a run made
  with it from then until its removal could not disagree this way; these two files are left as
  they were written.
- `perf_k`: measured after the SIC fit rewrite (block gains walked incrementally between block
  centres). The same bands decoded 1000/1000 at K = 50 before and after it, and the SIC
  suppression scenario in `crates/z30-dsp/tests/channel_scenarios.rs` reports identical figures.
  Against the audit's targets: K = 50 p99 on 4 threads is 863 ms (target < 1 s, met); on one
  thread it is 2525 ms (target <= 2 s, **not met**; the real-time budget of 4.5 s is). Of the
  single-thread time at K = 50, pass-1 SIC is ~0.86 s (46 subtractions) and fine sync of the
  candidates of passes 2 and 3 ~0.8 s.
