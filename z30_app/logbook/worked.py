"""Worked-before tracking."""

from __future__ import annotations

import json
from pathlib import Path


class WorkedTracker:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._data: dict = {"calls": {}, "grids": {}, "dxcc": {}, "bands": {}}
        self.load()

    def load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path, encoding="utf-8") as fh:
                    self._data = json.load(fh)
            except (json.JSONDecodeError, OSError):
                self._data = {"calls": {}, "grids": {}, "dxcc": {}, "bands": {}}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self._data, fh, indent=2)

    def _key(self, call: str, band: str, mode: str) -> str:
        return f"{call.upper()}|{band}|{mode.upper()}"

    def is_worked(self, call: str, band: str = "", mode: str = "Z30") -> bool:
        call = call.upper()
        if call in self._data.get("calls", {}):
            return True
        if band:
            return self._key(call, band, mode) in self._data.get("bands", {})
        return False

    def is_grid_worked(self, grid: str) -> bool:
        return grid.upper() in self._data.get("grids", {})

    def is_dxcc_worked(self, dxcc: int) -> bool:
        return str(dxcc) in self._data.get("dxcc", {})

    def record(self, call: str, grid: str = "", band: str = "", mode: str = "Z30", dxcc: int = 0) -> None:
        call = call.upper()
        self._data.setdefault("calls", {})[call] = True
        if grid:
            self._data.setdefault("grids", {})[grid.upper()] = True
        if dxcc:
            self._data.setdefault("dxcc", {})[str(dxcc)] = True
        if band:
            self._data.setdefault("bands", {})[self._key(call, band, mode)] = True
        self.save()
