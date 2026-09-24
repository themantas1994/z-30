# Demodulation

`crates/z30-dsp/src/baseband.rs` and `demod.rs`. The mathematics is the reference's
(`SPEC.md` section 8, `benchmark.demodulate_mfsk_llrs`). The difference is where the
correlations come from: FFTs instead of per-sample trigonometry.

## Front end: one FFT per slot, cheap baseband per candidate

The receiver works at 6 kHz; [audio.md](audio.md) covers how the device rate gets there. Per
pass, the 162 000-sample slot window is transformed once with a real FFT. For a candidate at
tone-0 frequency f0 the receiver needs only ±100 Hz around the signal. It copies the 5400 bins
centred on f0 (rounded to an FFT bin, which becomes 0 Hz), tapers the edges beyond ±85 Hz with a raised
cosine, and inverse-transforms them. The result is complex baseband at exactly **200 Hz**
(decimation 30), where one 320 ms symbol is 64 samples and tone k sits on bin k of a 64-point
DFT. This is WSJT-X's `ft8_downsample` idea. It replaces the shipped receiver's per-sample,
per-tone, per-hypothesis trigonometry, which cost 317 ms per candidate (audit section D), with
one 5400-point IFFT.

## Symbol spectra

After fine sync (see [synchronization.md](synchronization.md)), each of the 75 symbols is
de-rotated by the fine frequency and drift estimate and transformed with a 64-point FFT.
Bins 0–15 are the 16 tone correlators. Bins 20–27 and 37–59 lie inside the flat part of the
baseband filter and at least 5 bins from any tone, and they supply the noise estimate.

## Noise

The per-dimension noise variance σ² comes from the **median** of the out-of-signal bins' energy
over the whole frame: |n|² is exponential with mean 2σ², and its median is 2σ² ln 2. A median,
so a neighbouring station in part of those bins does not inflate it. The receiver estimates its
own noise floor; nothing is handed to it. This is the `realistic` condition the published
thresholds require.

## The metric

Amplitude is estimated as the mean Costas-tone correlator magnitude (the reference's pilot
mean). For every data symbol and tone the likelihood is the exact non-coherent (Rician) one:

```
L_k = ln I0( a |r_k| / σ_k² ) − a² / (2 σ_k²)
```

`ln I0` is Cephes' (NumPy's `i0`) in log form (`math.rs`). The 16 likelihoods are demapped to 4
bit LLRs by exact Log-MAP: for each bit, a numerically stable log-sum-exp over the 8 tones
where it is 1 minus the same over the 8 where it is 0, summed in NumPy's pairwise order so the
LLRs match the reference bit for bit.

**Coherence weight: zero.** `RECEIVER_PILOT_COHERENCE = 0.0` is declared in `demod.rs`, beside
the demodulator, because it is a property of the receiver and not of any benchmark (AGENTS.md
section 4). Measured paired in the reference, the pilot-aided coherent term is worth +1.29 dB
when the timing is exact and costs 1.77 dB when the receiver has to find the frame itself
(`legacy/python-oracle/z30_dsp/benchmark.py`). A test pins the value.

## Per-tone interference whitening

With one σ² for all tones, a stationary carrier sitting on tone k makes tone k look like the
transmitted tone in every symbol. The decoder then sees a confident, wrong bit pattern, which
is how a CW carrier inside the signal used to stop the decode.

`FrameSpectra::tone_sigma2` estimates a noise variance per tone bin from the median of that
bin's energy across the 75 symbols. A frame occupies each tone in only about 1/16 of its
symbols, so on a clean channel that median is noise. The per-tone estimate replaces the global
one only when it exceeds twice the global value, about six standard deviations of a 75-symbol
median on pure noise, so only real stationary interference crosses it. The metric then uses σ_k²
per tone, keeping the −a²/(2σ_k²) term. With equal variances that term is common to all tones
and drops out, so on a clean channel this is the reference metric exactly.

Measured paired on 1000 AWGN frames (200 per point, −25…−21 dB): whitening on vs off,
**0 discordant**, McNemar p = 1 (`research/results/whitening_ab_200.txt`). It costs nothing where
there is nothing to whiten. `a_strong_cw_carrier_inside_the_signal_does_not_stop_the_decode` is
the case it exists for.

## Against the reference

`crates/z30-dsp/tests/golden_demod.rs` runs the oracle's golden frame (`fixtures/golden/demod.json`:
6 kHz, −19 dB, carrier 1250.37 Hz, start sample 1234) through the production FFT path at the
timing and frequency the oracle was given. The oracle correlates directly at 6 kHz and is
handed the true σ; production estimates its own. Measured: hard decisions agree on 215 of 216
bits, LLR correlation 0.998, least-squares scale 0.9995 (the noise-estimate ratio), relative
residual 6.5%, and both LLR vectors decode to the same payload. The test asserts ≥ 214/216,
correlation > 0.99 and a scale within 0.8–1.25. The sensitivity consequence of the remaining
differences is measured end to end, paired, in [benchmarking.md](benchmarking.md).

## SNR

After a successful decode the transmitted tones are known. The SNR is the mean energy in the
transmitted tone's bin, less the noise, over the noise in one 3.125 Hz bin, rescaled to the
2500 Hz reference: `10 log10(S/N_bin) − 10 log10(2500 / 3.125)`. A non-positive estimate reports
−40 dB, which is a floor, not a measurement.
