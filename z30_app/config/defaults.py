"""Default configuration values."""

from __future__ import annotations

from z30_app.constants import DEFAULT_RX_FREQ, DEFAULT_TX_FREQ, RADIO_MODELS, WATERFALL_PALETTES


def default_config() -> dict:
    return {
        "general": {
            "callsign": "N0CALL",
            "locator": "FN20",
            "language": "en",
            "confirm_exit": True,
        },
        "operator": {
            "my_call": "N0CALL",
            "my_grid": "FN20",
            "dx_call": "",
            "dx_grid": "",
        },
        "audio": {
            "input_device": None,
            "output_device": None,
            "input_gain": 1.0,
            "output_gain": 1.0,
            "monitor_enabled": False,
            "agc_enabled": True,
            "record_path": "",
        },
        "radio": {
            "connection_type": "Network (rigctld)",
            "model": "3073 - Icom IC-7300",
            "host": "127.0.0.1",
            "port": 4532,
            "ptt_method": "CAT",
            "split_enabled": False,
            "track_frequency": True,
        },
        "network": {
            "rigctld_host": "127.0.0.1",
            "rigctld_port": 4532,
            "udp_enabled": False,
            "udp_port": 2237,
        },
        "decoder": {
            "sic_iterations": 5,
            "sic_layers": 3,
            "ldpc_max_iter": 30,
            "ldpc_algorithm": "normalized_min_sum",
            "ldpc_alpha": 0.8,
            "ldpc_beta": 0.5,
            "snr_threshold": 8.0,
            "early_stop": True,
        },
        "waterfall": {
            "palette": WATERFALL_PALETTES[0],
            "gain": 1.0,
            "contrast": 1.0,
            "speed": 2,
            "zoom": 1.0,
            "pan_hz": 0.0,
            "show_markers": True,
            "show_decode_labels": True,
        },
        "colors": {
            "cq": "#4caf50",
            "directed": "#ffeb3b",
            "worked": "#9e9e9e",
            "new_dxcc": "#e040fb",
            "rr73": "#2196f3",
            "73": "#00bcd4",
            "new_grid": "#ff9800",
        },
        "advanced_dsp": {
            "costas_tracking": True,
            "freq_search_step": 10.0,
            "monte_carlo_seed": 3030,
        },
        "frequencies": {
            "rx_freq": DEFAULT_RX_FREQ,
            "tx_freq": DEFAULT_TX_FREQ,
        },
        "auto_sequence": {
            "enabled": True,
            "state": "CQ",
        },
        "paths": {
            "logbook": "z30_log.adi",
            "worked_db": "z30_worked.json",
            "capture_dir": "captures",
        },
        # Legacy flat keys for backward compatibility
        "callsign": "N0CALL",
        "locator": "FN20",
        "rig_connection_type": "Network (rigctld)",
        "radio_model": "3073 - Icom IC-7300",
        "radio_host": "127.0.0.1",
        "radio_port": "4532",
        "audio_in": None,
        "audio_out": None,
    }


RADIO_MODEL_NAMES = list(RADIO_MODELS.keys())
