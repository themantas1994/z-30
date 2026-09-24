# Flawed AWGN "replicates" (kept as the record of a defect; not evidence of anything else)

These ten runs were made with `z30 --benchmark awgn --seed N` (N = 1..10) from the release build of
`672cef9`. They are **not independent replicates**. `frame_seed` is
`base ^ (benchmark << 40) ^ (point << 20) ^ frame`, and a small `base` only flips low bits of the
frame index: seeds 1-7 regenerated exactly the published run's 200 frames per point in another
order (all seven give the published run's per-point counts permuted, hence the identical
crossing −23.000 dB), and seeds 8-10 nearly so (−23.017 dB). `analysis_of_flawed_replicates.json`
is the analysis that exposed it (run-to-run sd 0.012 dB, impossible for 200-frame points).

Fixed in `18fbd78` (`--replicate r`, base seed `20260830 ^ (r << 48)`, with a test that fails on
this scheme). The valid replicates are in `research/results/18fbd78d8fb8/awgn_replicates/`. No
figure anywhere was taken from these files.
