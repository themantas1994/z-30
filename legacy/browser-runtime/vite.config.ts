import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {execFileSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

/**
 * The commit this bundle was built from, stamped in at build time.
 *
 * z-30 tracks upstream by commit, not by version, so "which commit am I running" is the
 * question the whole update mechanism turns on. It used to be answered by a hand-maintained
 * `CURRENT_COMMIT_SHA` constant in src/dsp/updateEngine.ts, which meant the answer was only
 * ever as fresh as the last person to remember to edit it - and it had gone stale, so the
 * update check compared upstream against a commit from several releases earlier.
 *
 * Read from git here so it cannot drift. A build from a tarball with no git present stamps
 * 'unknown', and the update UI says the local commit is unknown rather than asserting a wrong
 * one: when the app is served by the native z-30 server it asks that server for the real HEAD
 * anyway, and this value is only the fallback for a bundle served from static hosting.
 */
function buildCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Stamps a per-build identifier into the service worker's cache name.
 *
 * `public/sw.js` is copied verbatim by Vite (that is the point of public/), so it cannot use
 * an import or an `import.meta.env` value. Rewriting the emitted copy after the bundle is
 * written is the one hook that reaches it. Without this the cache name is a constant and a
 * new deploy never invalidates the old one - see the comment at the top of public/sw.js.
 */
function swBuildIdPlugin(): Plugin {
  return {
    name: 'z30-sw-build-id',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir || path.resolve(__dirname, 'dist');
      const swPath = path.join(outDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;
      const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const source = fs.readFileSync(swPath, 'utf8');
      fs.writeFileSync(swPath, source.replace(/__Z30_BUILD_ID__/g, buildId), 'utf8');
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), swBuildIdPlugin()],
    define: {
      __Z30_BUILD_COMMIT__: JSON.stringify(buildCommitSha()),
      __Z30_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
