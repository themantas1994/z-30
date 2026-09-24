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

## Earlier instruments (top level)

Measured before the suite existed; each is kept with the commit it was measured at.

Host for these runs: 4 vCPU Intel Xeon @ 2.80 GHz, 16 GB, Linux 6.18, Python 3.11.15,
NumPy 2.2.6; Rust 1.94.1 (awgn_paired_200) and 1.98.1 (the rest). The oracle harness imported
the Python oracle, now at `legacy/python-oracle/`.

| File | What | Command |
| :--- | :--- | :--- |
| `awgn_paired_200.txt` / `.json` | AWGN decode threshold, oracle vs vNext `decode_slot`, paired on the same buffers, seed 20260830, 200 frames/point, -28..-17 dB | `python research/paired_receiver.py --min-snr -28 --max-snr -17 --frames 200 --workers 4 --out research/results/awgn_paired_200.json` |
| `whitening_ab_200.txt` / `.json` | Per-tone interference whitening on (A) vs off (B), same buffers, AWGN, 200 frames/point, -25..-21 dB: 0 discordant of 1000 | `python research/paired_receiver.py --min-snr -25 --max-snr -21 --frames 200 --workers 4 --vnext-only --arm-b '{"whiten": false}' --out research/results/whitening_ab_200.json` |
| `perf_k.txt` | `decode_slot` latency p50/p95/p99/max, throughput, process CPU and heap allocations per slot at K = 1, 5, 20, 50 stations, 20 seeded slots each, 4 threads and 1, on an idle host | `z30 --benchmark perf --frames 20` |
| `false_decodes_2000.txt` | 2000 noise-only slots: 0 false decodes in 133,911 LDPC attempts with the fine-sync gate off (exact 95% upper bound 2.24e-5 per attempt); 0 in 2000 slots with the production config | `z30 --benchmark false-decodes --frames 2000` |

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
- `perf_k`: measured after the SIC fit rewrite (block gains walked incrementally between block
  centres). The same bands decoded 1000/1000 at K = 50 before and after it, and the SIC
  suppression scenario in `crates/z30-dsp/tests/channel_scenarios.rs` reports identical figures.
  Against the audit's targets: K = 50 p99 on 4 threads is 863 ms (target < 1 s, met); on one
  thread it is 2525 ms (target <= 2 s, **not met**; the real-time budget of 4.5 s is). Of the
  single-thread time at K = 50, pass-1 SIC is ~0.86 s (46 subtractions) and fine sync of the
  candidates of passes 2 and 3 ~0.8 s.
