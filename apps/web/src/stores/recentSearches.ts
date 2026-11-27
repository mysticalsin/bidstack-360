// LRU of recent search queries entered in the topbar. Persisted in
// localStorage so a tab reload doesn't wipe the user's history. Capped at
// 8 — anything older is rarely re-typed verbatim.

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-recent-searches.v1';
const CAP = 8;

export type RecentSearchStatus = 'ready' | 'failed';

export interface RecentSearchSnapshot {
  items: string[];
  /** `failed` means the stored list was not read. It is not an empty history. */
  status: RecentSearchStatus;
}

/**
 * The stored recent-search list, or a failed read. A missing key is an empty
 * history that arrived. A thrown read, corrupt JSON, or a non-array payload
 * has not arrived: callers must not present that as "no recent searches".
 * No `window` (module init outside a browser) is not a failed browser read.
 */
export function readRecentSearches(): RecentSearchSnapshot {
  if (typeof window === 'undefined') return { items: [], status: 'ready' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return { items: [], status: 'ready' };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], status: 'failed' };
    return {
      items: parsed.filter((s): s is string => typeof s === 'string'),
      status: 'ready',
    };
  } catch {
    return { items: [], status: 'failed' };
  }
}

function write(items: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota — fine to drop */
  }
}

interface RecentSearchStore extends RecentSearchSnapshot {
  push: (query: string) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentSearchStore>((set, get) => ({
  ...readRecentSearches(),
  push: (query) => {
    const q = query.trim();
    if (!q) return;
    // De-dupe case-insensitively: pressing Enter twice on "mantu" shouldn't
    // record two entries. Newest first. A new query is in memory even if the
    // previous read failed, so the history is ready from this point.
    const filtered = get().items.filter((s) => s.toLowerCase() !== q.toLowerCase());
    const next = [q, ...filtered].slice(0, CAP);
    write(next);
    set({ items: next, status: 'ready' });
  },
  clear: () => {
    write([]);
    set({ items: [], status: 'ready' });
  },
}));
