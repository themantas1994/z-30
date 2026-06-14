"""Z-30 application entry point."""

from __future__ import annotations

import sys
import tkinter as tk
from tkinter import messagebox

from z30_app.config.manager import ConfigManager
from z30_app.gui.diagnostics import DiagnosticsWindow, StartupDiagnostics
from z30_app.gui.main_window import Z30MainWindow
from z30_app.stability.exceptions import install_exception_handlers
from z30_app.stability.logging_setup import setup_logging, get_logger

logger = get_logger(__name__)


def run(show_diagnostics: bool = True) -> int:
    setup_logging()
    logger.info("Starting Z-30 application")

    root = tk.Tk()
    root.withdraw()

    config_mgr = ConfigManager()
    diagnostics = StartupDiagnostics()
    diagnostics.run_all(root, config_mgr)

    app_holder: dict = {}

    def launch_main() -> None:
        root.deiconify()
        try:
            app_holder["app"] = Z30MainWindow(root, config_mgr)
            install_exception_handlers(root, on_fatal=lambda: app_holder.get("app") and app_holder["app"].shutdown())
            logger.info("Main window initialized")
        except Exception as exc:
            logger.exception("Failed to initialize main window")
            messagebox.showerror("Z-30 Startup Error", f"Failed to start application:\n{exc}", parent=root)
            root.destroy()

    def abort() -> None:
        root.destroy()

    if show_diagnostics:
        DiagnosticsWindow(root, diagnostics, on_continue=launch_main, on_abort=abort)
    else:
        launch_main()

    try:
        root.mainloop()
    except KeyboardInterrupt:
        pass
    finally:
        app = app_holder.get("app")
        if app:
            app.shutdown()
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
