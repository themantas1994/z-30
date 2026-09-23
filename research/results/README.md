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
