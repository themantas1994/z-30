/**
 * Regenerates src/data/pythonSource.ts from the files it mirrors.
 *
 * The in-app "Python engineering workbench" viewer needs the source as a JavaScript string,
 * because the browser cannot read the repository. That file used to be a hand-copied snapshot:
 * 5,600 lines of literal source with no mechanism that could keep it current, and it was
 * already out of date relative to the files it claimed to show - which is worse than showing
 * nothing, since a reader has no way to tell.
 *
 * `npm run build` runs this first, so the bundled copy is always the tree that was built.
 *
 * Usage: node scripts/generate_python_source.mjs [--check]
 *   --check exits non-zero if the generated file is out of date, for CI.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outputPath = join(repoRoot, 'src', 'data', 'pythonSource.ts');

/**
 * The files the viewer offers, in display order, with the one-line description shown beside
 * each. Add an entry here to surface a new file; nothing else needs editing.
 */
const FILES = [
  ['z30_dsp/ldpc.py', 'Systematic (216, 77) Irregular Repeat-Accumulate (IRA) LDPC encoder and vectorized min-sum belief propagation decoder.'],
  ['z30_dsp/modem.py', 'Continuous-phase 16-MFSK modulator: one phase accumulator across the frame, GFSK frequency shaping, and a constant amplitude envelope.'],
  ['z30_dsp/sic_decoder.py', 'Successive Interference Cancellation multi-signal iterative extractor with FFT candidate detection and pilot-aided LLR demodulation.'],
  ['z30_dsp/channel.py', 'Propagation impairments: Watterson two-path HF fading, carrier frequency offset and symbol timing offset.'],
  ['z30_dsp/acquisition.py', 'Blind frame acquisition: Costas sync search over time and frequency, plus noise-floor estimation from the audio alone.'],
  ['z30_dsp/benchmark.py', 'Physical waveform generator, channel simulator, blind acquisition and seeded LDPC Monte Carlo benchmark (realistic and genie-aided modes).'],
  ['z30_dsp/web_server.py', 'Local HTTP server: token-authenticated hardware API, GPIO PTT dead-man switch, rigctld TCP relay, and logbook persistence.'],
  ['z30_dsp/paths.py', 'Per-user data directory resolution for the configuration, logbook and station settings.'],
  ['z30_dsp/main.py', 'Command line dispatcher routing to the web UI, the benchmark, the config wizard or RF time sync.'],
  ['z30_dsp/config_wizard.py', 'Tkinter startup configuration wizard with callsign and grid validation, audio device enumeration, and CAT/PTT hardware tests.'],
  ['z30_dsp/band_manager.py', 'Band presets, automatic CAT frequency tuning via Hamlib, and persistent frequency storage.'],
  ['z30_dsp/rf_time_sync.py', 'RF standard-time synchronizer for WWV/WWVH, CHU, DCF77, MSF, WWVB and JJY, with an opt-in and bounded OS clock step.'],
  ['z30_dsp/auto_logger.py', 'Thread-safe asynchronous QSO logging engine for ADIF 3.1.4, RFC 4180 CSV and SQLite.'],
  ['z30_dsp/gui_tkinter.py', 'Tkinter GUI with a non-blocking waterfall, selectable colormaps, and live signal tracking overlays.'],
  ['z30_dsp/updater.py', 'GitHub update engine for version comparison, git synchronization and package rebuilds.'],
  ['tests/test_ldpc_codec.py', 'Codec tests: parity-check agreement, girth-6 structure, CRC round trip and an end-to-end decode.'],
  ['tests/test_modem_spectrum.py', 'Occupied-bandwidth and constant-envelope tests - the acceptance criterion for the transmitter.'],
  ['tests/test_web_server_api.py', 'Local API security tests: token, Origin and Host checks, GPIO pin whitelisting and the dead-man switch.'],
  ['tests/test_time_sync_guards.py', 'Guards on the RF time-sync path: opt-in, confirmed, and bounded OS clock steps.'],
  ['tests/test_channel_acquisition.py', 'Channel and acquisition tests, including the guard that acquisition reads only the audio.'],
  ['pyproject.toml', 'PEP 621 package configuration: dependencies, console scripts and classifiers.'],
  ['install_ubuntu.sh', 'Ubuntu/Debian installation script with pinned dependencies and a keyring-verified Node apt source.'],
  ['install_arch.sh', 'Arch Linux installation script.'],
  ['PKGBUILD', 'Arch Linux PKGBUILD for makepkg / AUR installation.'],
  ['install_android_termux.sh', 'Android Termux field deployment script.'],
  ['run_windows.bat', 'Windows launcher with multi-path Python detection.'],
  ['build_windows.bat', 'Windows standalone .exe PyInstaller build script.'],
];

/** Escapes a source file for embedding in a TypeScript template literal. */
function escapeForTemplateLiteral(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function basename(path) {
  return path.split('/').pop();
}

function generate() {
  const entries = [];
  const missing = [];

  for (const [path, description] of FILES) {
    const absolute = join(repoRoot, path);
    if (!existsSync(absolute)) {
      missing.push(path);
      continue;
    }
    entries.push({
      filename: basename(path),
      path,
      description,
      code: readFileSync(absolute, 'utf8'),
    });
  }

  if (missing.length > 0) {
    console.warn(`[generate_python_source] Skipped files that do not exist: ${missing.join(', ')}`);
  }

  const body = entries
    .map(
      (entry) => `  {
    filename: ${JSON.stringify(entry.filename)},
    path: ${JSON.stringify(entry.path)},
    description: ${JSON.stringify(entry.description)},
    code: \`${escapeForTemplateLiteral(entry.code)}\`,
  },`
    )
    .join('\n');

  return `/**
 * Python and packaging sources for the in-app engineering workbench viewer.
 *
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:python-source
 *
 * The browser cannot read the repository, so the viewer needs these files as strings. This is
 * produced from the real files at build time; it used to be a hand-copied snapshot that had
 * already drifted from the code it claimed to show, with nothing that could keep it current.
 */

export interface PythonFile {
  /** Base name, shown in the file list. */
  filename: string;
  /** Repository-relative path. */
  path: string;
  /** One-line summary shown beside the file name. */
  description: string;
  /** Verbatim file contents. */
  code: string;
}

export const PYTHON_SOURCE_FILES: PythonFile[] = [
${body}
];
`;
}

const generated = generate();
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current !== generated) {
    console.error('src/data/pythonSource.ts is out of date. Run: npm run generate:python-source');
    process.exit(1);
  }
  console.log('src/data/pythonSource.ts is up to date.');
} else {
  writeFileSync(outputPath, generated, 'utf8');
  console.log(`Wrote ${outputPath}`);
}
