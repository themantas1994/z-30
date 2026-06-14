"""Global exception handling and crash reporting."""

from __future__ import annotations

import sys
import traceback
import tkinter as tk
from tkinter import messagebox
from typing import Callable

from z30_app.stability.logging_setup import get_logger

logger = get_logger(__name__)


class Z30Error(Exception):
    """Base application error."""


class ConfigError(Z30Error):
    """Configuration load/save/validation error."""


class AudioError(Z30Error):
    """Audio subsystem error."""


class RigError(Z30Error):
    """Rig control error."""


class DSPError(Z30Error):
    """DSP/modem error."""


def install_exception_handlers(root: tk.Tk, on_fatal: Callable[[], None] | None = None) -> None:
    """Install Tk thread and sys excepthook handlers."""

    def _report(title: str, exc: BaseException) -> None:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        logger.critical("%s\n%s", title, tb)
        try:
            messagebox.showerror(title, f"{exc}\n\nSee log for details.", parent=root)
        except tk.TclError:
            pass

    def sys_hook(exc_type, exc, tb_obj):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc, tb_obj)
            return
        full = "".join(traceback.format_exception(exc_type, exc, tb_obj))
        logger.critical("Uncaught exception:\n%s", full)
        try:
            if root.winfo_exists():
                messagebox.showerror("Z-30 Error", str(exc), parent=root)
        except Exception:
            pass

    sys.excepthook = sys_hook

    def tk_callback_exception(exc_type, exc, tb_obj):
        full = "".join(traceback.format_exception(exc_type, exc, tb_obj))
        logger.error("Tk callback exception:\n%s", full)
        try:
            messagebox.showerror("Z-30 Error", str(exc), parent=root)
        except tk.TclError:
            pass

    root.report_callback_exception = tk_callback_exception  # type: ignore[method-assign]

    def on_close():
        logger.info("Application shutdown requested")
        if on_fatal:
            on_fatal()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
