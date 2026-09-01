/**
 * Service Worker for the z-30 Digital Mode Transceiver PWA.
 *
 * Caching strategy, deliberately split by asset kind:
 *
 *   - Navigations and non-hashed assets (index.html, manifest.json, the icons) use
 *     NETWORK-FIRST. A fresh copy always wins when the server is reachable, and the cache is
 *     only a fallback for genuine offline use. A cache-first shell is what makes a PWA serve
 *     the version it first installed forever, so an operator who updates z-30 keeps running
 *     the old decoder with no way to tell.
 *   - Build-hashed bundle assets (/assets/index-<hash>.js and friends) use CACHE-FIRST. Their
 *     filenames change whenever their contents do, so a cached copy can never be stale.
 *
 * CACHE_NAME embeds BUILD_ID, which the Vite build stamps in (see the z30-sw-build-id plugin
 * in vite.config.ts). Every new build therefore gets a fresh cache and the activate handler
 * deletes every older one, so a deploy actually invalidates what came before it.
 */
const BUILD_ID = 'mthn4b7t-avt5lx';
const CACHE_NAME = `z30-pwa-${BUILD_ID}`;

// App shell entries worth having available offline after the very first load.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

// Vite emits immutable, content-hashed filenames under /assets/.
const HASHED_ASSET_RE = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Individual misses (an icon renamed, an offline first run) must not fail the whole
      // install the way cache.addAll() would.
      .then((cache) =>
        Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => undefined)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GETs are cacheable; /api/* is live local hardware state and must never be cached.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (HASHED_ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
