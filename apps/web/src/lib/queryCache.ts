import type { QueryClient } from '@tanstack/react-query';

const CACHE_KEY = 'bidstack-rq-cache';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
// Bounds that keep the persisted blob from growing without limit (the old
// implementation re-wrote the entire cache on EVERY query success and never
// evicted — unbounded growth + main-thread JSON jank, eventual quota crash).
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // ~4MB (localStorage ceiling is ~5MB)
const MAX_ENTRY_BYTES = 256 * 1024; // skip persisting any single huge query
const FLUSH_DELAY_MS = 1000; // debounce writes — coalesce bursts of successes

interface PersistedEntry {
  state: unknown;
  timestamp: number;
}

// In-memory mirror of the persisted blob. Mutated synchronously on each query
// success; written to localStorage on a trailing debounce so a burst of
// invalidations costs one serialization, not one per query.
let store: Record<string, PersistedEntry> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadStore(): Record<string, PersistedEntry> {
  if (store) return store;
  try {
    store = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, PersistedEntry>;
  } catch {
    store = {};
  }
  return store;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushStore();
  }, FLUSH_DELAY_MS);
}

function flushStore(): void {
  if (!store) return;
  const now = Date.now();
  // Drop expired entries first.
  for (const [k, entry] of Object.entries(store)) {
    if (now - entry.timestamp > MAX_AGE_MS) delete store[k];
  }
  try {
    let serialized = JSON.stringify(store);
    // Evict oldest entries until under the total byte budget.
    if (serialized.length > MAX_TOTAL_BYTES) {
      const byAge = Object.entries(store).sort((a, b) => a[1].timestamp - b[1].timestamp);
      while (serialized.length > MAX_TOTAL_BYTES && byAge.length > 0) {
        const [oldestKey] = byAge.shift()!;
        delete store[oldestKey];
        serialized = JSON.stringify(store);
      }
    }
    localStorage.setItem(CACHE_KEY, serialized);
  } catch {
    // Quota / private mode — cache is an optimization, not correctness.
  }
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

function shouldPersistQueryKey(key: unknown[]): boolean {
  // Account cockpit payloads include freshness-sensitive enrichment data
  // such as Apollo sync status. Persisting them makes refreshed pages show
  // stale company intelligence until the global React Query stale window ends.
  if (key[0] === 'crm-dashboard' && typeof key[1] === 'string' && key[1] !== 'default') {
    return false;
  }
  return true;
}

export function persistCache(queryClient: QueryClient): void {
  const cache = queryClient.getQueryCache();
  cache.subscribe((event) => {
    if (event.type !== 'updated' || event.query.state.status !== 'success') return;
    // Only persist GET queries (queries, not mutations)
    const queryKey = event.query.queryKey;
    if (!Array.isArray(queryKey) || !isQueryKeySerializable(queryKey)) return;
    if (!shouldPersistQueryKey(queryKey)) return;

    try {
      const entry: PersistedEntry = { state: event.query.state, timestamp: Date.now() };
      // Skip a single oversized payload outright — it would dominate the budget
      // and force eviction of many useful small entries.
      if (JSON.stringify(entry).length > MAX_ENTRY_BYTES) return;
      const current = loadStore();
      current[JSON.stringify(queryKey)] = entry;
      scheduleFlush();
    } catch {
      // Serialization can throw on exotic values — ignore, cache is optional.
    }
  });
}

export function hydrateCache(queryClient: QueryClient): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, PersistedEntry>;
    store = stored; // seed the in-memory mirror so later writes don't re-read
    const now = Date.now();

    for (const [keyStr, entry] of Object.entries(stored)) {
      if (now - entry.timestamp > MAX_AGE_MS) continue;
      const queryKey = JSON.parse(keyStr) as unknown[];
      if (!shouldPersistQueryKey(queryKey)) continue;
      queryClient.setQueryData(queryKey, (entry.state as { data?: unknown }).data);
    }
  } catch {
    // If localStorage is corrupted, clear it and start fresh.
    localStorage.removeItem(CACHE_KEY);
  }
}

export function clearPersistedCache(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  store = null;
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
