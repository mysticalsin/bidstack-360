// The contacts peek is a snapshot of one row. Search, sort, and a refresh
// replace the visible list. The card and the highlight have to follow that
// person, or close when the list no longer has them.
import type { Contact } from '@bidstack/shared';

export function contactPeekAfterListChange(input: {
  previousItems: readonly Contact[];
  nextItems: readonly Contact[];
  cursorIdx: number;
  quickLook: Contact | null;
}): { cursorIdx: number; quickLook: Contact | null } {
  const highlighted = input.cursorIdx >= 0 ? (input.previousItems[input.cursorIdx] ?? null) : null;
  // An open card is the person on screen. A closed card follows the highlight.
  const previous = input.quickLook ?? highlighted;
  if (!previous) return { cursorIdx: -1, quickLook: null };
  const nextIndex = input.nextItems.findIndex((row) => row.id === previous.id);
  const row = nextIndex >= 0 ? input.nextItems[nextIndex] : undefined;
  if (!row) return { cursorIdx: -1, quickLook: null };
  return {
    cursorIdx: nextIndex,
    quickLook: input.quickLook ? row : null,
  };
}
