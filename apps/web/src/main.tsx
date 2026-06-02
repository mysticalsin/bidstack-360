import './index.css';
// i18n must be imported before App so the i18next instance is bootstrapped
// before any component that calls useTranslation() renders.
import './i18n';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { browserTracingIntegration } from '@sentry/browser';

import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { logVitalsToConsole, reportWebVitals } from '@/lib/web-vitals';
import { persistCache, hydrateCache, watchAuthForCacheClear } from '@/lib/queryCache';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  const initSentry = () => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || '@bidstack/web@0.1.0',
      integrations: [browserTracingIntegration()],
      tracesSampleRate: 1.0,
    });
  };
  if (typeof window !== 'undefined') {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => initSentry());
    } else {
      setTimeout(initSentry, 50);
    }
  } else {
    initSentry();
  }
}

// Boot the Web Vitals observer once at app load. In dev/preview we log each
// metric to the console; in production this is where you'd send the metric
// to your analytics backend (Vercel Analytics, Datadog RUM, etc.).
reportWebVitals(logVitalsToConsole);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once for transient 5xx / network errors; don't retry on 4xx
      // (user error — retrying won't fix anything and wastes a roundtrip).
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        if (error instanceof ApiError) {
          return error.status >= 500 || error.status === 0;
        }
        return true;
      },
      refetchOnWindowFocus: false,
      staleTime: 120_000, // 2 minutes (up from 30s)
      gcTime: 600_000, // 10 minutes
    },
    mutations: {
      // Mutations retry exactly once on a 5xx/network drop. 4xx surfaces
      // immediately so the optimistic rollback fires without delay.
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false;
        if (error instanceof ApiError) {
          return error.status >= 500 || error.status === 0;
        }
        return true;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});

// Hydrate React Query cache from localStorage on boot, then persist
// successful query results back to localStorage.
hydrateCache(queryClient);
persistCache(queryClient);
watchAuthForCacheClear(queryClient);

window.addEventListener('unhandledrejection', (event) => {
  if (import.meta.env.DEV) {
    console.error('[unhandledrejection]', event.reason);
  }
  Sentry.captureException(event.reason);
});

window.addEventListener('error', (event) => {
  Sentry.captureException(event.error);
});

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const authMode = import.meta.env.VITE_AUTH_MODE;

if (!clerkKey && authMode === 'clerk') {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is missing while VITE_AUTH_MODE=clerk.');
}

const APP_SHELL_CACHE_NAME = 'bidstack-v1';
type ViteManifestEntry = {
  file?: string;
  css?: string[];
  assets?: string[];
  imports?: string[];
};
type ViteManifest = Record<string, ViteManifestEntry>;

const CRITICAL_ROUTE_MANIFEST_KEYS: Array<{ pattern: RegExp; keys: string[] }> = [
  { pattern: /^\/dashboard(?:\/|$)/, keys: ['src/pages/DashboardPage.tsx'] },
];

const collectAppShellAssetPaths = () => {
  const paths = new Set<string>(['/', '/index.html', '/manifest.json']);

  const addSameOriginPath = (assetUrl: string | null) => {
    if (!assetUrl) return;
    const parsed = new URL(assetUrl, window.location.href);
    if (parsed.origin === window.location.origin) {
      paths.add(`${parsed.pathname}${parsed.search}`);
    }
  };

  document
    .querySelectorAll<HTMLScriptElement>('script[src]')
    .forEach((script) => addSameOriginPath(script.getAttribute('src')));

  document
    .querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"][href], link[rel="modulepreload"][href], link[rel="preload"][href]',
    )
    .forEach((link) => addSameOriginPath(link.getAttribute('href')));

  return [...paths];
};

const addManifestAssetPath = (paths: Set<string>, assetPath?: string) => {
  if (!assetPath) return;
  paths.add(`/${assetPath.replace(/^\/+/, '')}`);
};

const collectManifestAssetPaths = (manifest: ViteManifest, keys: string[]) => {
  const paths = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);

    const entry = manifest[key];
    if (!entry) return;

    addManifestAssetPath(paths, entry.file);
    entry.css?.forEach((asset) => addManifestAssetPath(paths, asset));
    entry.assets?.forEach((asset) => addManifestAssetPath(paths, asset));
    entry.imports?.forEach((importKey) => visit(importKey));
  };

  keys.forEach((key) => visit(key));
  return [...paths];
};

const criticalManifestKeysForCurrentRoute = () => [
  'index.html',
  ...CRITICAL_ROUTE_MANIFEST_KEYS.flatMap((route) =>
    route.pattern.test(window.location.pathname) ? route.keys : [],
  ),
];

const warmViteManifestCache = async (cache: Cache) => {
  const response = await fetch('/.vite/manifest.json', { cache: 'no-store' });
  if (!response.ok) return;

  const manifest = (await response.json()) as ViteManifest;
  const paths = collectManifestAssetPaths(manifest, criticalManifestKeysForCurrentRoute());
  await Promise.allSettled(paths.map((path) => cacheAppShellPath(cache, path)));
};

const cacheAppShellPath = async (cache: Cache, path: string) => {
  const response = await fetch(path, { cache: 'reload' });
  if (response.ok) {
    await cache.put(path, response.clone());
  }
};

const warmAppShellCache = async () => {
  if (!('caches' in window)) return;

  const cache = await window.caches.open(APP_SHELL_CACHE_NAME);
  await Promise.allSettled(
    collectAppShellAssetPaths().map((path) => cacheAppShellPath(cache, path)),
  );
  await warmViteManifestCache(cache);
};

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerServiceWorker = () => {
    void warmAppShellCache().catch((error) => Sentry.captureException(error));
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => warmAppShellCache())
      .catch((error) => Sentry.captureException(error));
  };

  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker, { once: true });
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <AuthProvider publishableKey={clerkKey}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
);
