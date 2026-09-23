# Run: python audit/2026-09-23-vnext/probes/timesync_noise.py
# Probe: what does the RF time sync do on a machine where audio capture is unavailable (or on
# pure noise)? Uses the real RFTimeSyncThread with its default AudioCaptureEngine and an
# isolated config path, exactly as the dialog does, and reads back what it persisted.
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3]))
import numpy as np
from z30_dsp import rf_time_sync as rts

cfg = os.path.join(tempfile.mkdtemp(), "config.json")
eng = rts.AudioCaptureEngine(sample_rate=12000)
print("has_real_audio:", eng.has_real_audio)
done = []
t = rts.RFTimeSyncThread(station_queue=[("WWV", 10000000)], dwell_seconds=65, pre_check_seconds=5,
                         audio_engine=eng, config_path=cfg, simulate_dwell_speed=13.0,
                         on_complete_callback=done.append, allow_set_system_clock=False)
t.cat_tuner.tune = lambda *a, **k: False  # no rigctld here; the thread ignores the result anyway
start = datetime.now(timezone.utc)
t.start()
t.join(60)
print("dwell started at UTC second %.2f" % (start.second + start.microsecond / 1e6))
print("result:", done[0].summary() if done else None)
print("persisted config:", open(cfg).read() if os.path.exists(cfg) else "(none)")

# Pure noise through the WWV decoder, as a real capture on a dead band would be.
dec = rts.WWVDecoder(sample_rate=12000)
spec = rts.TIME_STATIONS["WWV"]
rng = np.random.default_rng(5)
passes = 0
succ = 0
deltas = []
for trial in range(40):
    pre = rng.normal(0, 0.05, 5 * 12000)
    has, snr = dec.validate_pre_carrier(pre, spec)
    if has:
        passes += 1
        dwell = rng.normal(0, 0.05, 65 * 12000)
        r = dec.process_dwell_stream(dwell, spec, time.monotonic(), datetime.now(timezone.utc))
        if r and r.success:
            succ += 1
            deltas.append(r.delta_ms)
print(f"pure noise: pre-check passed {passes}/40, dwell 'success' {succ}/{passes}, "
      f"example deltas (ms): {[round(d) for d in deltas[:6]]}")
