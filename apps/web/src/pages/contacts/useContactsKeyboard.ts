/**
 * useContactsKeyboard.ts — Vim-style keyboard navigation for the contacts table.
 *
 * WHY separate from ContactsPage: this hook encapsulates ~62 lines of
 * window-level keyboard wiring (pendingG ref + keydown handler) that can be
 * read and tested independently. Extracting it keeps the page component free
 * from low-level DOM event handling.
 *
 * Import DAG: zero local sibling imports — leaf node.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { Contact } from '@bidstack/shared';

export function useContactsKeyboard({
  items,
  cursorIdx,
  setCursorIdx,
  setEditTarget,
  toggleOne,
  quickLook,
  setQuickLook,
}: {
  items: ReadonlyArray<Contact>;
  cursorIdx: number;
  setCursorIdx: Dispatch<SetStateAction<number>>;
  setEditTarget: (c: Contact) => void;
  toggleOne: (id: string) => void;
  quickLook: Contact | null;
  setQuickLook: (c: Contact | null) => void;
}): void {
  // Tracks a pending `g` press for the `gg` chord (jump to top). The global
  // chord nav (gd/go/gp/…) also starts on `g`, but those second keys never
  // collide with `g` itself, so coexistence is safe.
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘E / Ctrl+E opens the edit dialog for the cursor row. Allowed
      // even when modifier keys are otherwise reserved — this is the
      // explicit "edit" shortcut.
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && cursorIdx >= 0) {
        e.preventDefault();
        const row = items[cursorIdx];
        if (row) setEditTarget(row);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || targetEl?.isContentEditable;
      if (inField) return;
      if (items.length === 0) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursorIdx((i) => Math.min(items.length - 1, i < 0 ? 0 : i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursorIdx((i) => Math.max(0, i < 0 ? 0 : i - 1));
      } else if (e.key === 'Enter' && cursorIdx >= 0) {
        e.preventDefault();
        const row = items[cursorIdx];
        if (row) setEditTarget(row);
      } else if (e.key === 'x' && cursorIdx >= 0) {
        e.preventDefault();
        const row = items[cursorIdx];
        if (row) toggleOne(row.id);
      } else if (e.key === ' ' && cursorIdx >= 0) {
        // Space = Quick Look toggle. If a peek is already open, close it.
        e.preventDefault();
        if (quickLook) {
          setQuickLook(null);
        } else {
          const row = items[cursorIdx];
          if (row) setQuickLook(row);
        }
      } else if (e.key === 'g') {
        // First or second half of `gg`. ~900ms window matches the global
        // chord-nav window for consistency.
        const now = Date.now();
        if (pendingG.current && now - pendingG.current < 900) {
          e.preventDefault();
          pendingG.current = null;
          setCursorIdx(0);
        } else {
          pendingG.current = now;
        }
      } else if (e.key === 'G') {
        // Shift+g — jump to the bottom of the visible list.
        e.preventDefault();
        setCursorIdx(items.length - 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // WHY these deps only: setCursorIdx/setEditTarget/setQuickLook are stable
    // React dispatch functions; toggleOne is a stable-value closure (captures
    // only setSelectedIds which is stable). Listing them would not change
    // re-registration frequency but would require useCallback on toggleOne
    // in the parent — a change that is out of scope for this refactor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cursorIdx, quickLook]);
}
