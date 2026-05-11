// LRU of recent search queries entered in the topbar. Persisted in
// localStorage so a tab reload doesn't wipe the user's history. Capped at
// 8 — anything older is rarely re-typed verbatim.

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-recent-searches.v1';
const CAP = 8;

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
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

interface RecentSearchStore {
  items: string[];
  push: (query: string) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentSearchStore>((set, get) => ({
  items: read(),
  push: (query) => {
    const q = query.trim();
    if (!q) return;
    // De-dupe case-insensitively: pressing Enter twice on "mantu" shouldn't
    // record two entries. Newest first.
    const filtered = get().items.filter((s) => s.toLowerCase() !== q.toLowerCase());
    const next = [q, ...filtered].slice(0, CAP);
    write(next);
    set({ items: next });
  },
  clear: () => {
    write([]);
    set({ items: [] });
  },
}));
