import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

type ServiceWorkerPolicy = {
  CACHE_NAME: string;
  NETWORK_ONLY_PATH_PREFIXES: string[];
  NETWORK_ONLY_PATH_SEGMENTS: string[];
  isNetworkOwnedUrl: (url: URL) => boolean;
};

type FetchEventLike = {
  request: {
    method: string;
    mode?: string;
    url: string;
  };
  respondWith: ReturnType<typeof vi.fn>;
};

function loadServiceWorker() {
  const listeners = new Map<string, Array<(event: FetchEventLike) => void>>();
  const self = {
    location: { origin: 'https://app.bidstack.test' },
    __BIDSTACK_SW_TEST__: true,
    addEventListener: vi.fn((event: string, listener: (event: FetchEventLike) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const caches = {
    keys: vi.fn(async () => []),
    open: vi.fn(async () => ({
      keys: vi.fn(async () => []),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    })),
    delete: vi.fn(async () => true),
  };
  const sandbox = {
    URL,
    Promise,
    self,
    caches,
    fetch: vi.fn(async () => new Response('ok', { status: 200 })),
  };
  const script = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');

  vm.runInNewContext(script, sandbox, { filename: 'public/sw.js' });

  return {
    fetchListeners: listeners.get('fetch') ?? [],
    policy: (
      self as typeof self & { __bidstackServiceWorkerPolicy: ServiceWorkerPolicy }
    ).__bidstackServiceWorkerPolicy,
  };
}

describe('service worker network ownership policy', () => {
  it('keeps app-shell caching off data, auth, webhook, export, and download routes', () => {
    const { policy } = loadServiceWorker();

    expect(policy.CACHE_NAME).toBe('bidstack-v4-network-owned-routes');
    expect(policy.NETWORK_ONLY_PATH_PREFIXES).toEqual(
      expect.arrayContaining(['/api/', '/auth/', '/oauth/', '/trpc/', '/webhooks/dust']),
    );

    for (const pathname of [
      '/api/v1/me',
      '/api/v1/files/file-1/download',
      '/auth/callback',
      '/oauth/gmail/callback',
      '/trpc/accounts.list',
      '/webhooks/dust',
      '/reports/export.csv',
    ]) {
      expect(policy.isNetworkOwnedUrl(new URL(pathname, 'https://app.bidstack.test'))).toBe(true);
    }

    for (const pathname of ['/dashboard', '/webhooks', '/assets/index-abc123.js']) {
      expect(policy.isNetworkOwnedUrl(new URL(pathname, 'https://app.bidstack.test'))).toBe(false);
    }
  });

  it('does not respondWith network-owned same-origin GET requests', () => {
    const { fetchListeners } = loadServiceWorker();
    const fetchListener = fetchListeners.at(-1);
    expect(fetchListener).toBeTypeOf('function');

    for (const url of [
      'https://app.bidstack.test/api/v1/opportunities/export',
      'https://app.bidstack.test/auth/callback',
      'https://app.bidstack.test/webhooks/dust',
      'https://app.bidstack.test/reports/export.csv',
    ]) {
      const event: FetchEventLike = {
        request: { method: 'GET', url },
        respondWith: vi.fn(),
      };
      fetchListener?.(event);
      expect(event.respondWith).not.toHaveBeenCalled();
    }
  });
});
