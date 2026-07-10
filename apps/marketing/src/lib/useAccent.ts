import { useCallback, useEffect, useState } from 'react';

import { ACCENT_STORAGE_KEY, applyAccent, getStoredAccent, type AccentId } from '@/lib/accent';

// Marketing-side accent hook (mirrors useTheme). Applies the accent as inline
// CSS variable overrides, persists to the shared `polo-accent` key, and keeps
// tabs in sync via the storage event.
export function useAccent(): { accent: AccentId; setAccent: (id: AccentId) => void } {
  const [accent, setAccentState] = useState<AccentId>(getStoredAccent);

  const setAccent = useCallback((id: AccentId) => {
    setAccentState(id);
    applyAccent(id);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACCENT_STORAGE_KEY) {
        const next = getStoredAccent();
        setAccentState(next);
        applyAccent(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { accent, setAccent };
}
