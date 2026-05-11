// Named bookmarks of a page's query-string state. The user names a
// combo of filter/sort/search and recalls it from a small picker. Stored
// in localStorage, namespaced per surface ("tasks", "contacts", …) so
// adding views to other pages is a one-line addition.
//
// Why query-string only? Every page that surfaces filters already encodes
// its state into the URL — saving views is "save this URL with a name."
// That keeps the scope tiny and avoids server-side persistence.

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-saved-views.v1';
const CAP_PER_SURFACE = 12;

export interface SavedView {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

interface PersistedShape {
  [surface: string]: SavedView[];
}

function read(): PersistedShape {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PersistedShape) : {};
  } catch {
    return {};
  }
}

function write(state: PersistedShape): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — fine to drop */
  }
}

interface SavedViewsStore {
  views: PersistedShape;
  save: (surface: string, name: string, query: string) => SavedView;
  remove: (surface: string, id: string) => void;
}

export const useSavedViews = create<SavedViewsStore>((set, get) => ({
  views: read(),
  save: (surface, name, query) => {
    const id = `${surface}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const view: SavedView = { id, name, query, createdAt: new Date().toISOString() };
    const existing = get().views[surface] ?? [];
    // Replace if a view with the same (trimmed, lowercase) name exists —
    // matches what users expect from "save" rather than stacking dupes.
    const filtered = existing.filter((v) => v.name.toLowerCase() !== name.toLowerCase());
    const next = [view, ...filtered].slice(0, CAP_PER_SURFACE);
    const all = { ...get().views, [surface]: next };
    write(all);
    set({ views: all });
    return view;
  },
  remove: (surface, id) => {
    const existing = get().views[surface] ?? [];
    const next = existing.filter((v) => v.id !== id);
    const all = { ...get().views, [surface]: next };
    write(all);
    set({ views: all });
  },
}));
