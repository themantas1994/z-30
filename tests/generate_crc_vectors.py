#!/usr/bin/env python3
"""
Regenerates tests/vectors/crc14_vectors.json from the Python CRC implementation.

The vectors are the contract between the Python and TypeScript codecs. Run this only when the
CRC definition itself changes deliberately - regenerating it to make a failing test pass would
defeat the entire point of having it.
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from z30_dsp.ldpc import Z30LdpcCodec  # noqa: E402

OUTPUT = os.path.join(os.path.dirname(__file__), "vectors", "crc14_vectors.json")


def build_cases():
    cases = [
        ("all_zeros", [0] * 63),
        ("all_ones", [1] * 63),
        ("alternating_10", [(i + 1) % 2 for i in range(63)]),
        ("alternating_01", [i % 2 for i in range(63)]),
        ("single_bit_0", [1] + [0] * 62),
        ("single_bit_62", [0] * 62 + [1]),
        ("walking_byte", [1 if (i // 8) % 2 == 0 else 0 for i in range(63)]),
    ]
    rng = np.random.default_rng(20260830)
    for i in range(8):
        cases.append((f"random_{i}", [int(b) for b in rng.integers(0, 2, 63)]))
    return cases


def main() -> None:
    codec = Z30LdpcCodec()
    document = {
        "_comment": [
            "Known-answer vectors for the z-30 14-bit CRC, shared by the Python codec",
            "(z30_dsp/ldpc.py) and the TypeScript codec (src/dsp/ldpcCodec.ts).",
            "The two implementations are the two halves of a two-language protocol: if they drift,",
            "the app stops being able to decode itself, and nothing else in the tree would notice.",
            "Regenerate with: python3 tests/generate_crc_vectors.py",
        ],
        "polynomial": "g(x) = x^14 + x^13 + x^10 + x^6 + x + 1",
        "register_constant": "0x2443",
        "init": "0x2757",
        "width_bits": 14,
        "vectors": [
            {"name": name, "payload": payload, "crc14": codec.compute_crc14(np.array(payload, dtype=np.uint8))}
            for name, payload in build_cases()
        ],
    }
    with open(OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    print(f"Wrote {len(document['vectors'])} vectors to {OUTPUT}")


if __name__ == "__main__":
    main()
