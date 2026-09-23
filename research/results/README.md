# Measured results

Raw outputs of the research harness. Each file names its command; every figure in `docs/` that
comes from here cites the file.

| File | What | Command |
| :--- | :--- | :--- |
| `awgn_paired_200.txt` / `.json` | AWGN decode threshold, oracle vs vNext `decode_slot`, paired, seed 20260830, 200 frames/point, -28..-17 dB | `python research/paired_receiver.py --min-snr -28 --max-snr -17 --frames 200 --workers 4 --out research/results/awgn_paired_200.json` |

Provenance notes:

- `awgn_paired_200`: the header's commit (`8be9e00`) is the HEAD the harness read when it
  started; the `z30` wheel it loaded was built from the working tree that became `f180122`, and
  `decode_slot`'s code is unchanged between that tree and `f180122`. Host: 4 vCPU Intel Xeon
  @ 2.80 GHz, Linux 6.18, Rust 1.94.1, Python 3.11.15, NumPy 2.2.6. The oracle arm reproduces the
  published `--mode realistic` table frame for frame (-22.92 dB [-23.07, -22.79]).
| `whitening_ab_200.txt` / `.json` | Per-tone interference whitening on (A) vs off (B), same buffers, AWGN, 200 frames/point, -25..-21 dB: 0 discordant of 1000 | `python research/paired_receiver.py --min-snr -25 --max-snr -21 --frames 200 --workers 4 --vnext-only --arm-b '{"whiten": false}' --out research/results/whitening_ab_200.json` |
| `perf_k.txt` | `decode_slot` latency/throughput/CPU/allocations at K = 1, 5, 20, 50, 20 slots each (first run; the GUI build shared the CPU for part of it) | `z30 --benchmark perf --frames 20` |
| `false_decodes_2000.txt` | 2000 noise-only slots: 0 false decodes in 133,911 LDPC attempts with the fine-sync gate off (exact 95% upper bound 2.24e-5 per attempt); 0 in 2000 slots with the production config | `z30 --benchmark false-decodes --frames 2000` |
