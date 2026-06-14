"""DXCC and grid square utilities."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass


@dataclass
class DxccInfo:
    call: str
    country: str
    dxcc: int
    cq_zone: int
    itu_zone: int
    continent: str


# Compact DXCC prefix table (extendable)
PREFIX_MAP = [
    ("CR", "Portugal", 272, 14, 37, "EU"),
    ("CT", "Portugal", 272, 14, 37, "EU"),
    ("CU", "Portugal", 272, 14, 37, "EU"),
    ("K", "United States", 291, 3, 4, "NA"),
    ("W", "United States", 291, 3, 4, "NA"),
    ("G", "England", 223, 14, 27, "EU"),
    ("DL", "Germany", 230, 14, 28, "EU"),
    ("F", "France", 227, 14, 27, "EU"),
    ("JA", "Japan", 339, 25, 45, "AS"),
    ("VK", "Australia", 150, 30, 60, "OC"),
    ("ZL", "New Zealand", 170, 32, 60, "OC"),
    ("PY", "Brazil", 108, 11, 12, "SA"),
    ("EA", "Spain", 281, 14, 37, "EU"),
    ("I", "Italy", 248, 15, 28, "EU"),
    ("OH", "Finland", 224, 15, 18, "EU"),
    ("SM", "Sweden", 284, 14, 18, "EU"),
    ("LA", "Norway", 266, 14, 18, "EU"),
]


def _grid_to_latlon(grid: str) -> tuple[float, float] | None:
    grid = grid.strip().upper()
    if len(grid) < 4:
        return None
    try:
        lon = (ord(grid[0]) - ord("A")) * 20 - 180
        lat = (ord(grid[1]) - ord("A")) * 10 - 90
        lon += int(grid[2]) * 2
        lat += int(grid[3]) * 1
        if len(grid) >= 6:
            lon += (ord(grid[4]) - ord("A")) * (2 / 24) + 1 / 24
            lat += (ord(grid[5]) - ord("A")) * (1 / 24) + 0.5 / 24
        else:
            lon += 1
            lat += 0.5
        return lat, lon
    except (ValueError, IndexError):
        return None


def distance_km(grid_a: str, grid_b: str) -> float | None:
    a = _grid_to_latlon(grid_a)
    b = _grid_to_latlon(grid_b)
    if not a or not b:
        return None
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(grid_a: str, grid_b: str) -> float | None:
    a = _grid_to_latlon(grid_a)
    b = _grid_to_latlon(grid_b)
    if not a or not b:
        return None
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    brng = math.degrees(math.atan2(x, y))
    return (brng + 360) % 360


def lookup_call(call: str) -> DxccInfo:
    call = call.strip().upper()
    call = re.sub(r"/.*$", "", call)
    for prefix_len in (4, 3, 2, 1):
        prefix = call[:prefix_len]
        for pfx, country, dxcc, cq, itu, cont in PREFIX_MAP:
            if call.startswith(pfx):
                return DxccInfo(call, country, dxcc, cq, itu, cont)
        if prefix:
            continue
    return DxccInfo(call, "Unknown", 0, 0, 0, "UN")
