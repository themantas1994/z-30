import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

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
