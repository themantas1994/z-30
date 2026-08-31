#!/usr/bin/env python3
"""
z-30 Transceiver CLI / GUI / Web Main Entrypoint
"""
import sys

def main():
    if "--update" in sys.argv or "-u" in sys.argv:
        from z30_dsp.updater import main as updater_main
        updater_main()
    elif "--benchmark" in sys.argv or "-b" in sys.argv:
        from z30_dsp.benchmark import run_benchmark
        run_benchmark()
    elif "--wizard" in sys.argv or "-w" in sys.argv:
        from z30_dsp.config_wizard import main as wizard_main
        wizard_main()
    elif "--sync" in sys.argv or "-s" in sys.argv:
        from z30_dsp.rf_time_sync import main as sync_main
        sync_main()
    elif "--bands" in sys.argv:
        from z30_dsp.band_manager import main as band_main
        band_main()
    elif "--tkinter" in sys.argv or "--gui-tk" in sys.argv:
        from z30_dsp.gui_tkinter import main as gui_main
        gui_main()
    else:
        # Default: Launch the full React Web DSP application in native app window mode
        try:
            from z30_dsp.web_server import main as web_main
            web_main()
        except Exception as e:
            # The Tkinter window is receive-only: no modulator, no PTT keying, no transmit
            # gate. Falling back to it with one line of console output handed an operator who
            # asked for a transceiver something that cannot key a radio, which looked exactly
            # like "the program connects but never transmits". Say so plainly instead.
            print(f"[z-30] The web transceiver could not start: {e}")
            print("[z-30] Falling back to the RECEIVE-ONLY Tkinter window.")
            print("[z-30] It cannot key a transmitter. To transmit, fix the error above and run 'z30-web'.")
            try:
                from z30_dsp.gui_tkinter import main as gui_main
                gui_main()
            except Exception as e2:
                print(f"[z-30] GUI fallback failed: {e2}. Running benchmark...")
                from z30_dsp.benchmark import run_benchmark
                run_benchmark()

if __name__ == "__main__":
    main()


