// Global one-deep undo for the last destructive action. Any feature that
// performs a delete or other irreversible mutation can `pushUndo` with a
// callback that re-creates the deleted record. ⌘Z (or Ctrl+Z) outside of
// an editable field invokes the most recent entry.
//
// We intentionally keep this *one deep*. A real undo stack is a much
// larger surface (collaboration conflicts, partial-rollback semantics,
// audit-log invariants). One-deep undo gives the user the "oh no" rescue
// they actually want without inviting those edge cases.

import { useEffect } from 'react';
import { create } from 'zustand';

interface UndoEntry {
  /** Short label shown in confirmation toast / a11y announcement. */
  label: string;
  /** The action that reverses what the user just did. */
  run: () => void;
  /** Auto-expires after this many ms. Defaults to 30s. */
  ttl?: number;
  /** When the entry was pushed (set internally). */
  pushedAt: number;
}

interface UndoStore {
  last: UndoEntry | null;
  push: (entry: Omit<UndoEntry, 'pushedAt'>) => void;
  consume: () => UndoEntry | null;
  clear: () => void;
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  last: null,
  push: (entry) => {
    set({ last: { ...entry, pushedAt: Date.now() } });
  },
  consume: () => {
    const last = get().last;
    if (!last) return null;
    const ttl = last.ttl ?? 30_000;
    if (Date.now() - last.pushedAt > ttl) {
      set({ last: null });
      return null;
    }
    set({ last: null });
    return last;
  },
  clear: () => set({ last: null }),
}));

/** Imperative API — easier to call from event handlers than the hook. */
export function pushUndo(label: string, run: () => void, ttl?: number): void {
  useUndoStore.getState().push({ label, run, ...(ttl !== undefined ? { ttl } : {}) });
}

export function useGlobalUndoHotkey(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘Z / Ctrl+Z. Skip Shift+⌘Z (redo, which we don't support yet —
      // letting the native handler run keeps text-field redo working).
      if (e.key !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if (inField) return;
      const entry = useUndoStore.getState().consume();
      if (!entry) return;
      e.preventDefault();
      entry.run();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
