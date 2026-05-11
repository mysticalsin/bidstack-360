// Client-side ordering of tasks. The server's Task schema has no `order`
// field — manual ordering is purely a personal-view preference for now,
// so we persist it in localStorage keyed by task id. When a server-side
// order column ships, the comparator can switch over without touching
// the UI surface.

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-task-order.v1';

interface PersistedShape {
  /** Map task id → ordinal. Lower = earlier in the list. */
  order: Record<string, number>;
}

function read(): PersistedShape {
  if (typeof window === 'undefined') return { order: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.order && typeof parsed.order === 'object') {
      return { order: parsed.order as Record<string, number> };
    }
    return { order: {} };
  } catch {
    return { order: {} };
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

interface TaskOrderStore extends PersistedShape {
  /** Set the full ordinal map at once (called after a drag-reorder). */
  setOrder: (ids: string[]) => void;
  /** Read ordinal for a given task id; falls back to Infinity (= bottom). */
  ordinalOf: (id: string) => number;
}

export const useTaskOrder = create<TaskOrderStore>((set, get) => ({
  ...read(),
  setOrder: (ids) => {
    const order: Record<string, number> = {};
    ids.forEach((id, i) => {
      order[id] = i;
    });
    write({ order });
    set({ order });
  },
  ordinalOf: (id) => {
    const o = get().order[id];
    return typeof o === 'number' ? o : Number.POSITIVE_INFINITY;
  },
}));
