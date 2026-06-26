/* global self, caches, URL, fetch */

const CACHE_NAME = 'bidstack-v4-network-owned-routes';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];
const STATIC_CACHE_MATCH_OPTIONS = { ignoreVary: true };
const CRITICAL_MANIFEST_KEYS = ['index.html', 'src/pages/DashboardPage.tsx'];
const NETWORK_ONLY_PATH_PREFIXES = [
  '/api/',
  '/auth/',
  '/oauth/',
  '/trpc/',
  '/webhooks/dust',
];
const NETWORK_ONLY_PATH_SEGMENTS = ['/download', '/export'];

function isNetworkOwnedUrl(url) {
  const pathname = url.pathname.toLowerCase();
  return (
    NETWORK_ONLY_PATH_PREFIXES.some((path) => pathname.startsWith(path)) ||
    NETWORK_ONLY_PATH_SEGMENTS.some((segment) => pathname.includes(segment))
  );
}

function isSameOriginUrl(url) {
  return url.origin === self.location.origin;
}

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

async function purgeSensitiveCacheEntries() {
  const keys = await caches.keys();
  await Promise.all(
    keys.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      await Promise.all(
        requests.map((request) => {
          const url = new URL(request.url);
          return isNetworkOwnedUrl(url) ? cache.delete(request) : Promise.resolve(false);
        }),
      );
    }),
  );
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
      .then(() => purgeSensitiveCacheEntries())
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

  // Authenticated/data requests must stay outside the app-shell worker. The
  // browser owns auth, CORS, streaming downloads, and network errors here.
  if (isNetworkOwnedUrl(url) || !isSameOriginUrl(url)) {
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

if (self.__BIDSTACK_SW_TEST__ === true) {
  self.__bidstackServiceWorkerPolicy = {
    CACHE_NAME,
    NETWORK_ONLY_PATH_PREFIXES,
    NETWORK_ONLY_PATH_SEGMENTS,
    isNetworkOwnedUrl,
  };
}
