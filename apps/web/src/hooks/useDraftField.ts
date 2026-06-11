// Controlled-input draft buffer for server-backed fields.
//
// The problem this solves: binding an <input value={server.value}> directly to
// a debounced mutation means that when the debounced save fires mid-typing, the
// query refetch snaps `server.value` back and overwrites the characters the
// user has typed since. The field appears to "eat" keystrokes.
//
// This hook keeps a LOCAL draft while the field is focused (so typing is never
// interrupted), commits on blur, and only re-syncs from the server value when
// the field is NOT focused — so an external update still lands, but never on
// top of in-flight typing.

import { useEffect, useRef, useState } from 'react';

export interface DraftFieldBinding<T> {
  value: T;
  onChange: (next: T) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export function useDraftField<T>(serverValue: T, commit: (next: T) => void): DraftFieldBinding<T> {
  const [draft, setDraft] = useState<T>(serverValue);
  const focusedRef = useRef(false);

  // Re-sync from the server ONLY while unfocused. While the user is typing,
  // the local draft is the source of truth and external updates are deferred.
  useEffect(() => {
    if (!focusedRef.current) setDraft(serverValue);
  }, [serverValue]);

  return {
    value: draft,
    onChange: (next: T) => setDraft(next),
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      if (draft !== serverValue) commit(draft);
    },
  };
}
