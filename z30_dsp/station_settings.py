"""
z-30 station configuration schema, validation, and JSON persistence.

Split out of `config_wizard.py` so that the validation rules can be imported - and tested -
without Tkinter. `config_wizard` imports Tk at module scope and subclasses `ttk.Frame` at class
definition time, so importing it at all requires a Tk build; on a headless box, in CI, or in a
minimal container there is none. That put the callsign rules that the setup wizard enforces
beyond the reach of the test suite, which is precisely how they drifted away from the browser
transmit gate in the first place.

Nothing here touches a GUI or a radio. `config_wizard` re-exports both names, so existing
imports keep working.
"""

from dataclasses import dataclass, asdict, field
import json
import os
import sys
import re
from typing import Optional, Tuple


@dataclass
class StationConfig:
    """Complete persistent configuration schema for the z-30 transceiver."""
    # Operator Information
    callsign: str = "N0CALL"
    grid: str = "AA00aa"
    operator_name: str = ""
    qth_description: str = ""

    # Audio Device Configuration
    audio_input_device: str = "Default Audio Input"
    audio_input_index: int = -1
    audio_output_device: str = "Default Audio Output"
    audio_output_index: int = -1
    sample_rate_hz: int = 12000  # Native z-30 sample rate (12 kHz)
    audio_channels: int = 1      # 1 = Mono (Left), 2 = Stereo

    # Radio & CAT Control Configuration
    cat_method: str = "Hamlib"  # "Hamlib", "Direct Serial", "None"
    rig_model_name: str = "Icom IC-7300 (USB Audio/CAT)"
    rig_model_id: int = 3073
    serial_port: str = "COM3" if sys.platform == "win32" else "/dev/ttyUSB0"
    baud_rate: int = 19200
    data_bits: int = 8
    stop_bits: int = 1
    handshake: str = "None"     # "None", "Hardware (RTS/CTS)", "Software (XON/XOFF)"
    
    # Network Rigctld CAT
    net_cat_host: str = "127.0.0.1"
    net_cat_port: int = 4532

    # PTT Control Configuration
    ptt_method: str = "CAT Command"  # "CAT Command", "RTS Pin", "DTR Pin", "VOX"
    ptt_port: str = ""               # Optional separate port if different from CAT
    ptt_polarity: str = "ACTIVE_HIGH" # "ACTIVE_HIGH" (1=ON) or "ACTIVE_LOW" (0=ON)

    # Operational Defaults
    tx_power_watts: int = 50
    dial_freq_hz: int = 14074000
    tx_audio_freq_hz: int = 1250
    rx_audio_freq_hz: int = 1250
    split_tx: bool = False
    tx_slot: str = "EVEN"            # "EVEN", "ODD", "MANUAL"
    config_version: str = "1.0.0"


class SettingsManager:
    """
    Manages loading, validating, caching, and persisting configuration data
    to a local `config.json` file with full backward compatibility and fallbacks.
    """
    DEFAULT_CONFIG_PATH = "config.json"

    # ITU International Callsign Regex - the SAME pattern as isValidCallsign() in
    # src/dsp/bandPlan.ts, which is what the browser transmit gate enforces.
    #
    # This used to be the looser `[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}` form the two React modals
    # also carried, so three implementations agreed with each other and disagreed with the one
    # that actually decides whether a station may key up: the wizard accepted "W1" and "K1A2"
    # (which the gate refuses at slot start, because a suffix must contain letters) and rejected
    # "DL/W1AW" (which the gate permits, because portable prefixes are real). A setup wizard
    # that blesses a callsign the transmit gate will refuse is worse than no check.
    #
    # Shared cases live in tests/vectors/callsign_vectors.json and are asserted from both
    # languages.
    CALLSIGN_REGEX = re.compile(
        r"^(?:[A-Z0-9]{1,3}/)?[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(?:/[A-Z0-9]{1,4})?$",
        re.IGNORECASE
    )

    # Maidenhead Grid Square (4 or 6 characters: AA00 or AA00aa)
    GRID_REGEX = re.compile(
        r"^[A-R]{2}[0-9]{2}([A-X]{2})?$",
        re.IGNORECASE
    )

    def __init__(self, config_path: Optional[str] = None) -> None:
        self.config_path = config_path or self.DEFAULT_CONFIG_PATH
        self.current_config = StationConfig()

    @classmethod
    def validate_callsign(cls, callsign: str) -> Tuple[bool, str]:
        """Validates callsign string format against ITU specifications."""
        cleaned = callsign.strip().upper()
        if not cleaned:
            return False, "Callsign cannot be blank."
        # Upper bound matches the widest string the shared regex can accept
        # (3-char portable prefix + 3 + digit + 4 + 4-char suffix, with two slashes).
        if len(cleaned) < 3 or len(cleaned) > 17:
            return False, "Callsign length must be between 3 and 17 characters."
        if not cls.CALLSIGN_REGEX.match(cleaned):
            return False, "Invalid ITU callsign format (e.g. W1AW, K3LR, DL1ABC, JA1ZLO/1)."
        # The TypeScript gate additionally requires a letter in the base prefix, so that a
        # digits-only prefix cannot pass. Kept in step deliberately.
        if not re.search(r"[A-Z]", cleaned.split("/")[0] or cleaned):
            return False, "Invalid ITU callsign format (the prefix must contain a letter)."
        return True, "Valid ITU Callsign"

    @classmethod
    def validate_grid(cls, grid: str) -> Tuple[bool, str]:
        """Validates 4 or 6 character Maidenhead Locator square."""
        cleaned = grid.strip()
        if not cleaned:
            return False, "Grid square cannot be blank."
        if len(cleaned) not in (4, 6):
            return False, "Grid must be 4 characters (e.g. FN31) or 6 characters (e.g. FN31pr)."
        if not cls.GRID_REGEX.match(cleaned):
            return False, "Invalid Maidenhead format (Field: A-R, Square: 0-9, Sub: a-x)."
        return True, "Valid Maidenhead Grid"

    @classmethod
    def maidenhead_to_latlon(cls, grid: str) -> Optional[Tuple[float, float]]:
        """Converts Maidenhead grid to approximate Center Latitude/Longitude."""
        g = grid.strip().upper()
        if len(g) < 4:
            return None
        try:
            lon = (ord(g[0]) - ord('A')) * 20 - 180 + int(g[2]) * 2
            lat = (ord(g[1]) - ord('A')) * 10 - 90 + int(g[3]) * 1
            if len(g) >= 6:
                lon += (ord(g[4]) - ord('A') + 0.5) * (5.0 / 60.0)
                lat += (ord(g[5]) - ord('A') + 0.5) * (2.5 / 60.0)
            else:
                lon += 1.0
                lat += 0.5
            return lat, lon
        except Exception:
            return None

    def has_valid_config_file(self) -> bool:
        """Checks if a valid, non-corrupted config.json exists on disk."""
        if not os.path.isfile(self.config_path):
            return False
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            call_ok, _ = self.validate_callsign(data.get("callsign", ""))
            grid_ok, _ = self.validate_grid(data.get("grid", ""))
            return call_ok and grid_ok and data.get("callsign") != "N0CALL"
        except Exception:
            return False

    def load_config(self) -> StationConfig:
        """Loads configuration from JSON file or returns default configuration."""
        if os.path.isfile(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                # Filter unknown keys to prevent crashes across version updates
                valid_keys = {f.name for f in StationConfig.__dataclass_fields__.values()}
                filtered = {k: v for k, v in data.items() if k in valid_keys}
                self.current_config = StationConfig(**filtered)
                return self.current_config
            except Exception as ex:
                print(f"[SettingsManager] Error loading {self.config_path}: {ex}. Using defaults.")

        self.current_config = StationConfig()
        return self.current_config

    def save_config(self, config: Optional[StationConfig] = None) -> bool:
        """Persists station configuration to JSON file."""
        cfg_to_save = config or self.current_config
        try:
            data = asdict(cfg_to_save)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            self.current_config = cfg_to_save
            return True
        except Exception as ex:
            print(f"[SettingsManager] Failed to write {self.config_path}: {ex}")
            return False
