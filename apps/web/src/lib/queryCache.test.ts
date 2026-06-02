import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import { hydrateCache, persistCache } from './queryCache';

const CACHE_KEY = 'bidstack-rq-cache';

describe('queryCache', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
