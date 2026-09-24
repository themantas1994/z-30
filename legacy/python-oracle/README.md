# z-30 Python protocol oracle — frozen, non-production

> **This is not the z-30 application.** It does not receive radio audio, decode for an
> operator, subtract interference, encode or key a transmission, keep time, or run as a
> fallback when something else fails. The z-30 application is the Rust workspace in
> [`crates/`](../../crates) — the `z30` and `z30-gui` binaries. Nothing an operator installs or
> launches imports this package.

## Why it exists

z-30 v1 was first implemented here, in Python, and the protocol ([`SPEC.md`](../../SPEC.md))
was written down from this code. The Rust implementation in `crates/` was then built and tested
**against** it: bit-for-bit on the CRC-14, the LDPC encoder, the symbol mapping, the GFSK
waveform and the LDPC decoder's verdict and iteration count on a recorded corpus. Keeping the
original, unchanged, is what makes that comparison mean something. If the Rust code drifts, the
golden vectors this package produces say so.

It also holds the reference receiver (`benchmark.py`, `acquisition.py`) whose AWGN threshold
the Rust receiver was compared with, paired, frame for frame
(`research/paired_receiver.py`, `research/results/awgn_paired_200.*`).

## What is frozen

Every file in `z30_dsp/` is pinned by SHA-256 in [`FROZEN.sha256`](FROZEN.sha256), and
[`tests/test_oracle_is_frozen.py`](tests/test_oracle_is_frozen.py) fails if one changes. Changing
the oracle means changing that manifest in the same commit and saying why in the commit message,
after checking whether the golden vectors moved (they must not, unless the protocol changed —
which is a protocol break, see SPEC.md).

Deliberate changes since the freeze began (2026-09-24):

| Date | File | Change | Golden vectors affected |
| :--- | :--- | :--- | :--- |
| 2026-09-24 | `channel.py` | Watterson taps normalised to unit **ensemble** power instead of per realisation (audit H-10: per-realisation normalisation deleted slow-fading power variation and made fading results optimistic) | none (no golden vector uses the fading model) |
| 2026-09-24 | `__init__.py`, `benchmark.py` | Docstrings only: the package is labelled non-production; the reference receiver's partly assisted acquisition window and FT8's −21 dB being a simulation figure are stated | none |

## What it may be used for

- generating and checking the golden vectors in [`fixtures/golden/`](../../fixtures/golden)
  ([`reference/golden/generate.py`](../../reference/golden/generate.py));
- independent validation of the Rust implementation (parity tests, paired comparisons);
- research and offline analysis (`python -m z30_dsp.benchmark ...`), with results labelled as
  the **oracle's reference receiver in simulation**;
- reproducing the historical figures the project published before vNext.

## What it must never be used for

- receiving live radio audio or decoding for an operator;
- successive interference cancellation in any receive path (`sic_decoder.py` is the old SIC
  design the 2026-09-23 audit found adds power instead of removing it; it is kept only because
  its candidate-detection constants are pinned by the parity tests, and nothing reaches it);
- encoding or transmitting anything, or controlling PTT;
- time synchronisation of any kind;
- a fallback for the Rust application — there is none, by design;
- producing a sensitivity figure described as z-30's. z-30's published figures come from the
  production receiver through `z30 --benchmark suite` (see
  [`docs/benchmarking.md`](../../docs/benchmarking.md)).

## Generating the golden vectors

```bash
pip install -r legacy/python-oracle/requirements.txt
python reference/golden/generate.py          # write fixtures/golden/ (+ MANIFEST.json)
python reference/golden/generate.py --check  # CI: regenerate and compare byte for byte
```

`fixtures/golden/messages.json` (whole-message packing) comes from the legacy TypeScript codec
instead, because the grid table and message tokenizer only ever existed there:
`npx --prefix legacy/browser-runtime tsx reference/golden/generate_messages.mts --check`.

## How parity with Rust is verified

| What | Where |
| :--- | :--- |
| CRC-14, LDPC encoder, symbol map, GFSK waveform (6/12/48 kHz) against the golden vectors | `crates/z30-protocol/tests/golden.rs` |
| LDPC decoder verdict, information bits and iteration count on the recorded LLR corpus | `crates/z30-dsp/tests/golden_ldpc.rs` |
| Demodulator hard decisions and LLR correlation on a golden frame | `crates/z30-dsp/tests/golden_demod.rs` |
| Oracle receiver vs production `decode_slot` on identical buffers, exact McNemar test | `research/paired_receiver.py` (CI smoke run: `.github/workflows/rust.yml`, job `harness`) |
| Golden vectors reproduce from this package | `python reference/golden/generate.py --check` (CI job `golden`) |

## Running its tests

```bash
cd legacy/python-oracle
pip install -r requirements.txt pytest
python -m pytest tests -q
```
