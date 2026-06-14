"""CRC-16-CCITT for Z-30 payload integrity."""

from __future__ import annotations

import numpy as np


class CRC16_CCITT:
    POLY = 0x1021
    INIT = 0xFFFF

    @classmethod
    def calculate(cls, data_bits) -> int:
        crc = cls.INIT
        for bit in data_bits:
            crc ^= int(bit) << 15
            if crc & 0x8000:
                crc = ((crc << 1) ^ cls.POLY) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
        return crc & 0xFFFF

    @classmethod
    def append(cls, payload_bits: np.ndarray) -> np.ndarray:
        bits = np.asarray(payload_bits, dtype=np.int8).ravel()
        crc_val = cls.calculate(bits)
        crc_bits = np.array([(crc_val >> (15 - i)) & 1 for i in range(16)], dtype=np.int8)
        return np.concatenate((bits, crc_bits))

    @classmethod
    def verify(cls, payload_bits, crc_bits) -> bool:
        received = 0
        for i, bit in enumerate(crc_bits):
            received |= int(bit) << (15 - i)
        return cls.calculate(payload_bits) == received
