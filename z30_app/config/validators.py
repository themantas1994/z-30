"""Configuration validation."""

from __future__ import annotations

from z30_app.constants import FREQ_MAX_HZ, FREQ_MIN_HZ, WATERFALL_PALETTES
from z30_app.stability.exceptions import ConfigError


def _validate_freq(value, name: str) -> int:
    try:
        freq = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{name} must be an integer Hz value") from exc
    if not FREQ_MIN_HZ <= freq <= FREQ_MAX_HZ:
        raise ConfigError(f"{name} must be between {FREQ_MIN_HZ} and {FREQ_MAX_HZ} Hz")
    return freq


def _validate_float(value, name: str, low: float, high: float) -> float:
    try:
        val = float(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{name} must be a number") from exc
    if not low <= val <= high:
        raise ConfigError(f"{name} must be between {low} and {high}")
    return val


def _validate_port(value, name: str) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{name} must be an integer port") from exc
    if not 1 <= port <= 65535:
        raise ConfigError(f"{name} must be between 1 and 65535")
    return port


def validate_config(config: dict) -> list[str]:
    """Validate config; returns list of error messages (empty if valid)."""
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(msg)

    try:
        general = config.get("general", {})
        call = str(general.get("callsign", config.get("callsign", ""))).strip().upper()
        if not call or len(call) > 12:
            err("Callsign must be 1-12 characters")
        grid = str(general.get("locator", config.get("locator", ""))).strip().upper()
        if len(grid) not in (0, 4, 6):
            err("Locator must be 4 or 6 characters")

        audio = config.get("audio", {})
        _validate_float(audio.get("input_gain", 1.0), "Input gain", 0.0, 10.0)
        _validate_float(audio.get("output_gain", 1.0), "Output gain", 0.0, 10.0)

        radio = config.get("radio", {})
        _validate_port(radio.get("port", config.get("radio_port", 4532)), "Radio port")

        decoder = config.get("decoder", {})
        _validate_float(decoder.get("snr_threshold", 8.0), "SNR threshold", -30.0, 40.0)
        if int(decoder.get("sic_iterations", 5)) < 1:
            err("SIC iterations must be >= 1")

        wf = config.get("waterfall", {})
        if wf.get("palette") not in WATERFALL_PALETTES:
            err(f"Waterfall palette must be one of {WATERFALL_PALETTES}")
        _validate_float(wf.get("gain", 1.0), "Waterfall gain", 0.1, 10.0)
        _validate_float(wf.get("contrast", 1.0), "Waterfall contrast", 0.1, 10.0)

        freqs = config.get("frequencies", {})
        _validate_freq(freqs.get("rx_freq", 1500), "RX frequency")
        _validate_freq(freqs.get("tx_freq", 1500), "TX frequency")
    except ConfigError as exc:
        errors.append(str(exc))

    return errors
