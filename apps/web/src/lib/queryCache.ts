import type { QueryClient } from '@tanstack/react-query';

const CACHE_KEY = 'bidstack-rq-cache';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface PersistedEntry {
  state: unknown;
  timestamp: number;
}

function isQueryKeySerializable(key: unknown[]): boolean {
  // Only persist simple query keys (strings, numbers, booleans).
  // Skip queries that contain functions, DOM nodes, etc.
  return key.every(
    (k) =>
      typeof k === 'string' ||
      typeof k === 'number' ||
      typeof k === 'boolean' ||
      k === null ||
      k === undefined,
  );
}

export function persistCache(queryClient: QueryClient): void {
  const cache = queryClient.getQueryCache();
  cache.subscribe((event) => {
    if (event.type !== 'updated' || event.query.state.status !== 'success') return;
    // Only persist GET queries (queries, not mutations)
    const queryKey = event.query.queryKey;
    if (!Array.isArray(queryKey) || !isQueryKeySerializable(queryKey)) return;

    try {
      const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<
        string,
        PersistedEntry
      >;
      stored[JSON.stringify(queryKey)] = {
        state: event.query.state,
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
    } catch {
      // localStorage can throw (quota exceeded, private mode, etc.)
      // Silently ignore — the cache is a performance optimization, not correctness.
    }
  });
}

export function hydrateCache(queryClient: QueryClient): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, PersistedEntry>;
    const now = Date.now();

    for (const [keyStr, entry] of Object.entries(stored)) {
      if (now - entry.timestamp > MAX_AGE_MS) continue;
      const queryKey = JSON.parse(keyStr) as unknown[];
      queryClient.setQueryData(queryKey, (entry.state as { data?: unknown }).data);
    }
  } catch {
    // If localStorage is corrupted, clear it and start fresh.
    localStorage.removeItem(CACHE_KEY);
  }
}

export function clearPersistedCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/** Subscribe to auth state changes and clear the cache on logout. */
export function watchAuthForCacheClear(queryClient: QueryClient): () => void {
  const handler = () => {
    const wasSignedIn = sessionStorage.getItem('bidstack:signed-in');
    const isSignedIn = Boolean(localStorage.getItem('bidstack:session'));
    if (wasSignedIn && !isSignedIn) {
      clearPersistedCache();
      queryClient.clear();
    }
    sessionStorage.setItem('bidstack:signed-in', String(isSignedIn));
  };

  // Check immediately and on storage changes
  handler();
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
