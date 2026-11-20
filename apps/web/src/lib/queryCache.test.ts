import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_FINGERPRINT_EVENT,
  clearPersistedCache,
  hydrateCache,
  persistCache,
  watchAuthForCacheClear,
} from './queryCache';

const CACHE_KEY = 'bidstack-rq-cache';

describe('queryCache', () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearPersistedCache();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists org dashboard cache entries', () => {
    const queryClient = new QueryClient();
    persistCache(queryClient);

    queryClient.setQueryData(['crm-dashboard', 'default'], { generatedAt: '2026-06-01' });

    const hydratedClient = new QueryClient();
    hydrateCache(hydratedClient);

    expect(hydratedClient.getQueryData(['crm-dashboard', 'default'])).toEqual({
      generatedAt: '2026-06-01',
    });
  });

  it('does not persist account cockpit snapshots because Apollo freshness must refetch', () => {
    const queryClient = new QueryClient();
    persistCache(queryClient);

    queryClient.setQueryData(['crm-dashboard', 'account-123'], {
      cockpit: { kpis: [{ label: 'Apollo sync', detail: 'company data pending' }] },
    });

    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored[JSON.stringify(['crm-dashboard', 'account-123'])]).toBeUndefined();

    const hydratedClient = new QueryClient();
    hydrateCache(hydratedClient);

    expect(hydratedClient.getQueryData(['crm-dashboard', 'account-123'])).toBeUndefined();
  });

  it('hydrates persisted data with its original updatedAt timestamp', () => {
    const cachedAt = new Date('2026-06-16T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(cachedAt);

    const queryClient = new QueryClient();
    persistCache(queryClient);
    queryClient.setQueryData(['crm-dashboard', 'default'], { generatedAt: cachedAt.toISOString() });

    vi.setSystemTime(new Date('2026-06-16T10:30:00.000Z'));
    const hydratedClient = new QueryClient();
    hydrateCache(hydratedClient);

    const query = hydratedClient.getQueryCache().find({ queryKey: ['crm-dashboard', 'default'] });
    expect(query?.state.dataUpdatedAt).toBe(cachedAt.getTime());
  });

  it('does not persist the tasks badge across reload', () => {
    // WHY: the nav badge is overdue count. A reload that restores 7 while the
    // list is already 8 keeps the discrepancy until the stale window ends.
    const queryClient = new QueryClient();
    persistCache(queryClient);
    queryClient.setQueryData(['tasks', 'summary'], { total: 8, open: 8, overdue: 7, dueSoon: 0 });

    const hydratedClient = new QueryClient();
    hydrateCache(hydratedClient);

    expect(hydratedClient.getQueryData(['tasks', 'summary'])).toBeUndefined();
  });

  it('does not hydrate live control-plane status snapshots', () => {
    const queryClient = new QueryClient();
    persistCache(queryClient);

    queryClient.setQueryData(['serum', 'status'], { enabled: false });

    const hydratedClient = new QueryClient();
    hydrateCache(hydratedClient);

    expect(hydratedClient.getQueryData(['serum', 'status'])).toBeUndefined();
  });

  it('does not persist auth, admin, integration, or credential snapshots', () => {
    const blockedKeys: unknown[][] = [
      ['me', 'capabilities'],
      ['users'],
      ['user-roles', 'user-1'],
      ['roles'],
      ['permissions'],
      ['api-keys'],
      ['agent-provider-credentials'],
      ['dust:credentials'],
      ['dust:status'],
      ['crm-connectors'],
      ['crm-provider-health'],
      ['user-integrations-status'],
    ];
    const queryClient = new QueryClient();
    persistCache(queryClient);

    blockedKeys.forEach((key) => {
      queryClient.setQueryData(key, { stale: true });
    });

    const hydratedClient = new QueryClient();
    hydrateCache(hydratedClient);

    blockedKeys.forEach((key) => {
      expect(hydratedClient.getQueryData(key)).toBeUndefined();
    });
  });

  it('clears user-scoped cache when the auth identity changes in the same tab', () => {
    localStorage.setItem('bidstack:session', 'user-a');
    const queryClient = new QueryClient();
    queryClient.setQueryData(['accounts'], [{ id: 'account-a' }]);

    const unsubscribe = watchAuthForCacheClear(queryClient);

    localStorage.setItem('bidstack:session', 'user-b');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'bidstack:session',
        oldValue: 'user-a',
        newValue: 'user-b',
        storageArea: localStorage,
      }),
    );

    expect(queryClient.getQueryData(['accounts'])).toBeUndefined();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    unsubscribe();
  });

  it('refetches a query that was in flight when the first sign-in writes the session marker', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unsubscribe = watchAuthForCacheClear(queryClient);
    let calls = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['crm-dashboard', 'acct-1'],
      queryFn: ({ signal }) =>
        new Promise<string>((resolve, reject) => {
          calls += 1;
          const n = calls;
          const timer = setTimeout(() => resolve(`snapshot-${n}`), 5);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    });
    const stopObserving = observer.subscribe(() => {});
    try {
      localStorage.setItem('bidstack:session', 'cf-access:user-a');
      window.dispatchEvent(new Event(AUTH_FINGERPRINT_EVENT));

      await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe('snapshot-2'));
      expect(observer.getCurrentResult().isLoading).toBe(false);
    } finally {
      stopObserving();
      unsubscribe();
    }
  });

  it('clears user-scoped cache when demo identity changes without a new session marker', () => {
    localStorage.setItem('bidstack:session', 'demo');
    localStorage.setItem('bidstack:demo-email', 'first-demo@bidstack.local');
    const queryClient = new QueryClient();
    queryClient.setQueryData(['accounts'], [{ id: 'first-demo-account' }]);

    const unsubscribe = watchAuthForCacheClear(queryClient);

    localStorage.setItem('bidstack:demo-email', 'second-demo@bidstack.local');
    window.dispatchEvent(new Event(AUTH_FINGERPRINT_EVENT));

    expect(queryClient.getQueryData(['accounts'])).toBeUndefined();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    unsubscribe();
  });

  it('clears user-scoped cache when the stub role changes without a new session marker', () => {
    localStorage.setItem('bidstack:session', 'stub');
    localStorage.setItem('bidstack:stub-role', 'admin');
    const queryClient = new QueryClient();
    queryClient.setQueryData(['settings-summary'], { canWrite: true });

    const unsubscribe = watchAuthForCacheClear(queryClient);

    localStorage.setItem('bidstack:stub-role', 'viewer');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'bidstack:stub-role',
        oldValue: 'admin',
        newValue: 'viewer',
        storageArea: localStorage,
      }),
    );

    expect(queryClient.getQueryData(['settings-summary'])).toBeUndefined();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    unsubscribe();
  });
});
