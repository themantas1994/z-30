"""Z-30 unit and integration tests."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from z30_app.config.manager import ConfigManager
from z30_app.config.validators import validate_config
from z30_app.dsp.crc import CRC16_CCITT
from z30_app.dsp.ldpc import OptimizedLDPCCodec
from z30_app.dsp.modem import Z30AdvancedModem
from z30_app.dxcc.lookup import distance_km, lookup_call
from z30_app.logbook.adif import AdifLogger, LogEntry
from z30_app.qso.sequencer import AutoSequencer, QSOState


class TestCRC(unittest.TestCase):
    def test_roundtrip(self):
        bits = np.array([1, 0, 1, 0, 1] * 15, dtype=np.int8)
        appended = CRC16_CCITT.append(bits)
        self.assertEqual(len(appended), len(bits) + 16)
        self.assertTrue(CRC16_CCITT.verify(appended[:75], appended[75:91]) or CRC16_CCITT.verify(bits, appended[len(bits) :]))


class TestLDPC(unittest.TestCase):
    def test_encode_decode_noiseless(self):
        codec = OptimizedLDPCCodec()
        info = np.random.default_rng(1).integers(0, 2, size=91)
        codeword = codec.encode(info)
        llrs = (1 - 2 * codeword).astype(float) * 10.0
        decoded = codec.decode_normalized_min_sum(llrs, max_iter=20)
        self.assertTrue(np.array_equal(decoded[:91], info))

    def test_offset_min_sum(self):
        codec = OptimizedLDPCCodec()
        info = np.zeros(91, dtype=np.int8)
        codeword = codec.encode(info)
        llrs = (1 - 2 * codeword).astype(float) * 8.0
        decoded = codec.decode_offset_min_sum(llrs, max_iter=20)
        self.assertTrue(np.array_equal(decoded[:91], info))


class TestModem(unittest.TestCase):
    def test_modulate_demodulate_noiseless(self):
        modem = Z30AdvancedModem(decoder_config={"snr_threshold": 0.0, "sic_iterations": 3})
        text = "CQ Z30TST IM58"
        bits = modem.string_to_bits(text)
        tx = modem.modulate(bits, 1500.0)
        pad = np.zeros(modem.fs, dtype=complex)
        rx = np.real(np.concatenate([pad, tx, pad]))
        decodes = modem.sic_decode_loop(rx)
        self.assertGreaterEqual(len(decodes), 1)
        self.assertIn("CQ", decodes[0].message.upper())

    def test_string_bits_roundtrip(self):
        modem = Z30AdvancedModem()
        bits = modem.string_to_bits("CQ TEST")
        text = modem.bits_to_string(bits)
        self.assertIn("CQ", text)


class TestConfig(unittest.TestCase):
    def test_load_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cfg.json"
            mgr = ConfigManager(path)
            mgr.load()
            mgr.config["general"]["callsign"] = "TEST"
            mgr.save()
            mgr2 = ConfigManager(path)
            mgr2.load()
            self.assertEqual(mgr2.config["general"]["callsign"], "TEST")

    def test_validation(self):
        cfg = ConfigManager().config
        self.assertEqual(validate_config(cfg), [])


class TestDXCC(unittest.TestCase):
    def test_lookup(self):
        info = lookup_call("K1ABC")
        self.assertEqual(info.country, "United States")

    def test_distance(self):
        d = distance_km("FN20", "IM58")
        self.assertIsNotNone(d)
        self.assertGreater(d, 1000)


class TestSequencer(unittest.TestCase):
    def test_cq_to_reply(self):
        seq = AutoSequencer()
        seq.set_operator("TEST", "FN20")
        seq.on_decode("CQ DXCALL IM58")
        self.assertEqual(seq.state, QSOState.REPLY)
        self.assertEqual(seq.context.dx_call, "DXCALL")


class TestLogbook(unittest.TestCase):
    def test_add_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "log.adi"
            log = AdifLogger(path)
            log.add_qso(LogEntry("20250101", "120000", "TEST", "FN20", "20M", "Z30", -12, 1000, "CQ TEST FN20"))
            self.assertEqual(len(log.entries), 1)


class TestStartupIntegration(unittest.TestCase):
    def test_imports(self):
        import z30_app
        from z30_app.gui.diagnostics import StartupDiagnostics
        from z30_app.gui.waterfall import WaterfallWidget

        self.assertTrue(hasattr(z30_app, "__version__"))
        diag = StartupDiagnostics()
        diag.check_python()
        self.assertGreater(len(diag.items), 0)


if __name__ == "__main__":
    unittest.main()
