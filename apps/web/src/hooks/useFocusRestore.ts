// Capture-and-restore for programmatic dialog opens. Radix already
// restores focus to the trigger element when a dialog closes — but only
// when a trigger exists. Opens driven by keyboard shortcut (⌘E),
// command palette, or quick-add menu have no trigger, so focus lands on
// <body> when the dialog closes and j/k navigation feels lost.
//
// Usage: call `useFocusRestore(open)` from any component that owns an
// open-state prop. On the false→true edge it snapshots
// `document.activeElement`; on true→false it restores focus to whatever
// was active at open time (if it's still in the DOM).

import { useEffect, useRef } from 'react';

export function useFocusRestore(open: boolean): void {
  const captured = useRef<HTMLElement | null>(null);
  // Track previous open state so we only act on transitions.
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      // Just opened — snapshot the element that had focus.
      captured.current = (document.activeElement as HTMLElement | null) ?? null;
    } else if (!open && wasOpen.current) {
      // Just closed — restore. Wait a frame so Radix's own focus
      // management runs first and we land on top of it.
      const el = captured.current;
      captured.current = null;
      if (el && document.contains(el)) {
        requestAnimationFrame(() => el.focus());
      }
    }
    wasOpen.current = open;
  }, [open]);
}
