"""Configuration load/save/import/export."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

from z30_app.config.defaults import default_config
from z30_app.config.validators import validate_config
from z30_app.stability.exceptions import ConfigError
from z30_app.stability.logging_setup import get_logger

logger = get_logger(__name__)


def _deep_merge(base: dict, overlay: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in overlay.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class ConfigManager:
    def __init__(self, config_path: str | Path | None = None):
        self.config_path = Path(config_path or os.environ.get("Z30_CONFIG", "z30_config.json"))
        self._config = default_config()
        self._loaded = False
        self._errors: list[str] = []

    @property
    def config(self) -> dict:
        return self._config

    @property
    def errors(self) -> list[str]:
        return self._errors

    @property
    def loaded_ok(self) -> bool:
        return self._loaded and not self._errors

    def load(self) -> dict:
        defaults = default_config()
        self._errors = []
        if self.config_path.exists():
            try:
                with open(self.config_path, encoding="utf-8") as fh:
                    raw = json.load(fh)
                if not isinstance(raw, dict):
                    raise ConfigError("Configuration root must be a JSON object")
                self._config = _deep_merge(defaults, raw)
                self._sync_legacy_keys()
                self._loaded = True
                logger.info("Loaded configuration from %s", self.config_path)
            except json.JSONDecodeError as exc:
                self._errors.append(f"JSON parse error: {exc}")
                self._config = defaults
                logger.error("Invalid JSON in %s: %s", self.config_path, exc)
            except OSError as exc:
                self._errors.append(f"Cannot read config: {exc}")
                self._config = defaults
                logger.error("Cannot read config %s: %s", self.config_path, exc)
        else:
            self._config = defaults
            self._loaded = True
            logger.info("Using default configuration (no file at %s)", self.config_path)

        validation = validate_config(self._config)
        self._errors.extend(validation)
        return self._config

    def _sync_legacy_keys(self) -> None:
        g = self._config.setdefault("general", {})
        g["callsign"] = g.get("callsign") or self._config.get("callsign", "N0CALL")
        g["locator"] = g.get("locator") or self._config.get("locator", "FN20")
        self._config["callsign"] = g["callsign"]
        self._config["locator"] = g["locator"]

        audio = self._config.setdefault("audio", {})
        if audio.get("input_device") is None:
            audio["input_device"] = self._config.get("audio_in")
        if audio.get("output_device") is None:
            audio["output_device"] = self._config.get("audio_out")
        self._config["audio_in"] = audio.get("input_device")
        self._config["audio_out"] = audio.get("output_device")

        radio = self._config.setdefault("radio", {})
        radio.setdefault("connection_type", self._config.get("rig_connection_type", "Network (rigctld)"))
        radio.setdefault("model", self._config.get("radio_model", "3073 - Icom IC-7300"))
        radio.setdefault("host", self._config.get("radio_host", "127.0.0.1"))
        radio.setdefault("port", int(self._config.get("radio_port", 4532)))

    def save(self, config: dict | None = None) -> None:
        data = config or self._config
        errors = validate_config(data)
        if errors:
            raise ConfigError("; ".join(errors))
        self._sync_legacy_keys()
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
        self._config = data
        logger.info("Saved configuration to %s", self.config_path)

    def export_to(self, path: str | Path) -> None:
        path = Path(path)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self._config, fh, indent=2, sort_keys=True)
        logger.info("Exported configuration to %s", path)

    def import_from(self, path: str | Path) -> dict:
        path = Path(path)
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            raise ConfigError("Imported configuration must be a JSON object")
        merged = _deep_merge(default_config(), raw)
        errors = validate_config(merged)
        if errors:
            raise ConfigError("; ".join(errors))
        self._config = merged
        self._sync_legacy_keys()
        self.save()
        return self._config

    def restore_defaults(self) -> dict:
        self._config = default_config()
        self.save()
        return self._config

    def get(self, key: str, default: Any = None) -> Any:
        if key in self._config:
            return self._config[key]
        for section in self._config.values():
            if isinstance(section, dict) and key in section:
                return section[key]
        return default
