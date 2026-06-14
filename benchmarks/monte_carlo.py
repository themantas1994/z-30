"""Monte Carlo BER/FER benchmark for Z-30 modem."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from z30_app.dsp.modem import Z30AdvancedModem


def awgn_channel(signal: np.ndarray, snr_db: float) -> np.ndarray:
    power = np.mean(np.abs(signal) ** 2)
    snr = 10 ** (snr_db / 10)
    noise_power = power / max(snr, 1e-12)
    noise = np.sqrt(noise_power / 2) * (np.random.randn(*signal.shape) + 1j * np.random.randn(*signal.shape))
    return signal + noise


def run_benchmark(snr_points: list[float], frames_per_snr: int = 20) -> dict:
    modem = Z30AdvancedModem()
    payload_text = "CQ TEST FN20"
    bits = modem.string_to_bits(payload_text)

    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "frames_per_snr": frames_per_snr, "results": []}

    for snr_db in snr_points:
        bit_errors = 0
        frame_errors = 0
        false_decodes = 0
        total_bits = 0

        for _ in range(frames_per_snr):
            tx = modem.modulate(bits, 1500.0)
            pad = np.zeros(int(modem.fs * 0.5), dtype=complex)
            frame = np.concatenate([pad, tx, pad])
            rx = awgn_channel(frame, snr_db)
            rx_audio = np.real(rx)

            decodes = modem.sic_decode_loop(rx_audio)
            total_bits += len(bits)
            if not decodes:
                frame_errors += 1
                bit_errors += len(bits)
                continue

            msg = decodes[0].message.upper()
            if "TEST" not in msg and "CQ" not in msg:
                false_decodes += 1
            if msg != payload_text.upper()[: len(msg.rstrip())]:
                frame_errors += 1

        fer = frame_errors / frames_per_snr
        ber = bit_errors / max(total_bits, 1)
        fdr = false_decodes / frames_per_snr
        report["results"].append({"snr_db": snr_db, "ber": ber, "fer": fer, "false_decode_rate": fdr})

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Z-30 Monte Carlo benchmark")
    parser.add_argument("--frames", type=int, default=10)
    parser.add_argument("--output", type=str, default="benchmark_report.json")
    args = parser.parse_args()

    snr_points = [0, -5, -10, -15, -20, -25]
    report = run_benchmark(snr_points, frames_per_snr=args.frames)
    out = Path(args.output)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Report saved to {out}")


if __name__ == "__main__":
    main()
