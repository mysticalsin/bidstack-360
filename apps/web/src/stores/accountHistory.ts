// Tracks two pieces of per-user, per-account state that don't belong on
// the server:
//
//   - `recents`  — MRU list of accounts the user has visited (LRU eviction,
//                  cap = 8 so the sidebar can show top 5 plus headroom)
//   - `favorites` — accounts the user has starred for quick access
//
// Both persist to localStorage so a refresh or new tab restores them. We
// keep slug + displayName per entry so the sidebar can render labels
// without re-fetching the account.

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-account-history.v1';
const RECENTS_CAP = 8;

export interface AccountEntry {
  slug: string;
  name: string;
  visitedAt: string;
}

interface PersistedState {
  recents: AccountEntry[];
  favorites: AccountEntry[];
}

function read(): PersistedState {
  if (typeof window === 'undefined') return { recents: [], favorites: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { recents: [], favorites: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      recents: Array.isArray(parsed.recents) ? parsed.recents.filter(isEntry) : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter(isEntry) : [],
    };
  } catch {
    return { recents: [], favorites: [] };
  }
}

function isEntry(value: unknown): value is AccountEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AccountEntry>;
  return (
    typeof v.slug === 'string' && typeof v.name === 'string' && typeof v.visitedAt === 'string'
  );
}

function write(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private-mode — preference loss is acceptable here */
  }
}

interface AccountHistoryStore extends PersistedState {
  visit: (slug: string, name: string) => void;
  toggleFavorite: (slug: string, name: string) => void;
  isFavorite: (slug: string) => boolean;
}

export const useAccountHistory = create<AccountHistoryStore>((set, get) => ({
  ...read(),
  visit: (slug, name) => {
    const visitedAt = new Date().toISOString();
    const filtered = get().recents.filter((r) => r.slug !== slug);
    // Newest first — sidebar reads from the head of the array.
    const next = [{ slug, name, visitedAt }, ...filtered].slice(0, RECENTS_CAP);
    const persisted = { recents: next, favorites: get().favorites };
    write(persisted);
    set({ recents: next });
  },
  toggleFavorite: (slug, name) => {
    const existing = get().favorites;
    const has = existing.some((f) => f.slug === slug);
    const next = has
      ? existing.filter((f) => f.slug !== slug)
      : [...existing, { slug, name, visitedAt: new Date().toISOString() }];
    const persisted = { recents: get().recents, favorites: next };
    write(persisted);
    set({ favorites: next });
  },
  isFavorite: (slug) => get().favorites.some((f) => f.slug === slug),
}));
