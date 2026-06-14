"""Message parsing helpers."""

from __future__ import annotations

import re


CALL_RE = re.compile(r"[A-Z0-9/]{1,12}")


def extract_call_grid(message: str) -> tuple[str, str]:
    parts = message.upper().split()
    if not parts:
        return "", ""
    if parts[0] == "CQ":
        call = parts[1] if len(parts) > 1 else ""
        grid = parts[2] if len(parts) > 2 else ""
        return call, grid
    call = parts[0]
    grid = ""
    for p in parts[1:]:
        if len(p) in (4, 6) and p[0].isalpha():
            grid = p
            break
    return call, grid


def message_category(message: str, my_call: str) -> str:
    msg = message.upper().strip()
    if msg.startswith("CQ"):
        return "cq"
    if "RR73" in msg:
        return "rr73"
    if msg.endswith("73") and not msg.endswith("RR73"):
        return "73"
    if my_call.upper() in msg.split():
        return "directed"
    return "default"
