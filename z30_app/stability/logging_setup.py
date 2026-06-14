"""Application logging configuration."""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path


def get_log_dir() -> Path:
    base = Path(os.environ.get("Z30_DATA_DIR", Path.home() / ".z30"))
    log_dir = base / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger("z30")
    if logger.handlers:
        return logger

    logger.setLevel(level)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(formatter)
    logger.addHandler(console)

    log_file = get_log_dir() / f"z30_{datetime.now(timezone.utc).strftime('%Y%m%d')}.log"
    file_handler = RotatingFileHandler(log_file, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def get_logger(name: str | None = None) -> logging.Logger:
    return logging.getLogger(name or "z30")
