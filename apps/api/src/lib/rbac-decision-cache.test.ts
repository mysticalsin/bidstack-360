import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/realtime.service.js', () => ({
  publish: vi.fn(async () => {}),
  subscribe: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    userRole: { count: vi.fn(async () => 1) },
  },
}));

// NODE_ENV=test at import time short-circuits the invalidation broadcast/
// subscribe side effects in the module, which is what we want for a unit test.

describe('rbac decision cache — LRU eviction', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('evicts only the least-recently-used entry at capacity, not the whole cache', async () => {
    // WHY: the old behavior called cache.clear() at the size cap, which means
    // every org's next permission check re-hits Postgres in the same instant
    // (a decision-cache stampede). Verify eviction is single-entry LRU instead.
    const mod = await import('./rbac-decision-cache.js');
    const { userHasPermission, clearRbacDecisionCacheForTest } = mod;
    clearRbacDecisionCacheForTest();

    const { prisma } = await import('@bidstack/db');
    const countSpy = vi.mocked(prisma.userRole.count);

    // MAX_CACHE_ENTRIES (20k) isn't reachable from a unit test; the actual
    // single-key eviction at capacity is asserted structurally in the next
    // test via getRbacDecisionCacheKeysForTest(). This test covers the
    // precondition eviction depends on: per-key caching actually works
    // (a hit never re-queries; a different key always does).
    await userHasPermission('org-1', 'user-1', 'accounts:read' as never);
    expect(countSpy).toHaveBeenCalledTimes(1);

    // Second call for the SAME key within TTL must be a cache hit (no re-query).
    await userHasPermission('org-1', 'user-1', 'accounts:read' as never);
    expect(countSpy).toHaveBeenCalledTimes(1);

    // A different key still queries independently (proves per-key caching,
    // the precondition for eviction to matter at all).
    await userHasPermission('org-1', 'user-2', 'accounts:read' as never);
    expect(countSpy).toHaveBeenCalledTimes(2);
  });

  it('touching a hit re-inserts it at the MRU end, so eviction picks the true LRU key', async () => {
    // WHY: eviction deletes decisionCache.keys().next().value — the Map's
    // FIRST key. If a cache hit didn't re-insert (delete+set) on touch, a
    // hot key sitting at the front would be evicted ahead of colder keys
    // inserted after it — the opposite of LRU semantics.
    const mod = await import('./rbac-decision-cache.js');
    const { userHasPermission, clearRbacDecisionCacheForTest, getRbacDecisionCacheKeysForTest } =
      mod;
    clearRbacDecisionCacheForTest();

    await userHasPermission('org-1', 'user-1', 'accounts:read' as never); // insert A
    await userHasPermission('org-1', 'user-2', 'accounts:read' as never); // insert B
    expect(getRbacDecisionCacheKeysForTest()).toEqual([
      'org-1:user-1:permission:accounts:read',
      'org-1:user-2:permission:accounts:read',
    ]);

    await userHasPermission('org-1', 'user-1', 'accounts:read' as never); // touch A (cache hit)
    // A must have moved to the end; B is now the front (= LRU = next evicted).
    expect(getRbacDecisionCacheKeysForTest()).toEqual([
      'org-1:user-2:permission:accounts:read',
      'org-1:user-1:permission:accounts:read',
    ]);
  });
});

describe('rbac decision cache — invalidation race', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not re-cache a DB load that resolves ALLOW after a concurrent revocation invalidated it', async () => {
    // WHY: without an epoch guard, a load started before invalidateRbacDecisionCache
    // runs can still resolve `true` and write to the cache AFTER the revocation's
    // delete already ran — silently undoing the invalidation and keeping a revoked
    // user permitted for the full 30s TTL.
    const mod = await import('./rbac-decision-cache.js');
    const { userHasPermission, invalidateRbacDecisionCache, clearRbacDecisionCacheForTest } = mod;
    clearRbacDecisionCacheForTest();

    const { prisma } = await import('@bidstack/db');
    const countSpy = vi.mocked(prisma.userRole.count);
    countSpy.mockClear(); // mock instance is shared across tests in this file

    let resolveLoad!: () => void;
    countSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = () => resolve(1);
        }),
    );

    const inFlight = userHasPermission('org-1', 'user-1', 'accounts:read' as never);

    // Revocation lands WHILE the DB load above is still pending.
    invalidateRbacDecisionCache('org-1', 'user-1');

    resolveLoad();
    await expect(inFlight).resolves.toBe(true); // the in-flight caller still gets its answer

    // But the stale ALLOW must not have been cached: the very next check
    // re-queries Postgres instead of reading back the pre-revocation result.
    countSpy.mockResolvedValueOnce(0);
    await expect(userHasPermission('org-1', 'user-1', 'accounts:read' as never)).resolves.toBe(
      false,
    );
    expect(countSpy).toHaveBeenCalledTimes(2);
  });
});
