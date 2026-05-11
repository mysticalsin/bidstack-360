// Apple convention: ⌘. ("Command-period") cancels the current modal flow.
// Radix dialogs already listen for Escape document-wide, so when ⌘. is
// pressed we synthesize an Escape keydown the same listeners will see —
// no need to wire a callback into every open dialog.
//
// Why dispatch rather than fire a callback? Modal opens are scattered
// across components (Radix Dialog, HoverCard, Tooltip, ConfirmHost, the
// help drawer, etc). A single dispatch unifies them under the existing
// Escape semantics, and any future modal that listens to Escape gets the
// ⌘. shortcut for free.

import { useEffect } from 'react';

export function useCmdDotClose(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only the meta-period combo. We don't intercept plain `.` so it
      // remains typeable in any field.
      if (e.key !== '.') return;
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      // Synthesize an Escape so Radix and any other Escape-listening
      // surface treat this as a normal cancel. Bubbles + cancelable so
      // matching handlers see it identically to a real keypress.
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
