/* global self, caches, URL, fetch, Response */

const CACHE_NAME = 'bidstack-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];
const STATIC_CACHE_MATCH_OPTIONS = { ignoreVary: true };
const CRITICAL_MANIFEST_KEYS = ['index.html', 'src/pages/DashboardPage.tsx'];

function fetchAndCache(request, cache) {
  return fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  });
}

async function cacheUrl(cache, url) {
  const response = await fetch(url, { cache: 'reload' });
  if (response && response.status === 200) {
    await cache.put(url, response.clone());
  }
}

function addManifestAsset(urls, value) {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }

  urls.add(`/${value.replace(/^\/+/, '')}`);
}

async function cacheViteManifestAssets(cache) {
  try {
    const response = await fetch('/.vite/manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const manifest = await response.json();
    const urls = new Set();

    Object.values(manifest).forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      addManifestAsset(urls, entry.file);
      (entry.css || []).forEach((asset) => addManifestAsset(urls, asset));
      (entry.assets || []).forEach((asset) => addManifestAsset(urls, asset));
    });

    await Promise.allSettled([...urls].map((url) => cacheUrl(cache, url)));
  } catch {
    // The page-side app-shell warmer still covers servers that do not expose
    // Vite's manifest file.
  }
}

function collectManifestAssetUrls(manifest, keys) {
  const urls = new Set();
  const visited = new Set();

  function visit(key) {
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const entry = manifest[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }

    addManifestAsset(urls, entry.file);
    (entry.css || []).forEach((asset) => addManifestAsset(urls, asset));
    (entry.assets || []).forEach((asset) => addManifestAsset(urls, asset));
    (entry.imports || []).forEach((importKey) => visit(importKey));
  }

  keys.forEach((key) => visit(key));
  return urls;
}

async function cacheCriticalManifestAssets(cache) {
  try {
    const response = await fetch('/.vite/manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const manifest = await response.json();
    const urls = collectManifestAssetUrls(manifest, CRITICAL_MANIFEST_KEYS);

    await Promise.allSettled([...urls].map((url) => cacheUrl(cache, url)));
  } catch {
    // Critical assets are also warmed by the page when Cache Storage is available.
  }
}

// Install: cache shell assets.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await Promise.allSettled(STATIC_ASSETS.map((url) => cacheUrl(cache, url)));
        await cacheCriticalManifestAssets(cache);
        cacheViteManifestAssets(cache);
      })
      .then(() => self.skipWaiting()),
  );
});

// Activate: clean up old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch: network-first for data, cache-first for static assets.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests.
  if (request.method !== 'GET') {
    return;
  }

  // SPA navigation: network-first, cached app shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) =>
          fetchAndCache(request, cache).catch(() =>
            cache
              .match(request, STATIC_CACHE_MATCH_OPTIONS)
              .then((cached) => cached || cache.match('/index.html', STATIC_CACHE_MATCH_OPTIONS)),
          ),
        ),
    );
    return;
  }

  // API calls: network-first. Stale CRM data can show unavailable booking
  // slots, wrong permissions, or outdated financial state.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/trpc/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetchAndCache(request, cache).catch(() =>
          cache.match(request).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: 'Offline', message: 'Network unavailable' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }),
          ),
        ),
      ),
    );
    return;
  }

  // Static assets: cache-first, fallback to network.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request, STATIC_CACHE_MATCH_OPTIONS).then((cached) => {
        if (cached) {
          // Refresh cache in background.
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
            })
            .catch(() => {});
          return cached;
        }

        return fetchAndCache(request, cache);
      }),
    ),
  );
});
