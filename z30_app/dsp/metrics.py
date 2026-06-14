"""DSP runtime metrics."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DSPMetrics:
    noise_floor_db: float = -120.0
    sync_score: float = 0.0
    decode_count: int = 0
    crc_failures: int = 0
    sic_layers: int = 0
    sic_iterations: int = 0
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    last_snr: float = 0.0

    def reset_cycle(self) -> None:
        self.decode_count = 0
        self.crc_failures = 0
        self.sic_layers = 0
