import { useCallback, useState } from 'react';

const STORAGE_SLOT = 'polo.companies.columns.v1';

function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_SLOT);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/** Hidden Companies list columns, persisted per browser. */
export function useColumnVisibility() {
  const [hidden, setHidden] = useState<Set<string>>(readHidden);
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(STORAGE_SLOT, JSON.stringify([...next]));
      } catch {
        /* storage full or blocked: visibility still applies for this visit */
      }
      return next;
    });
  }, []);
  const isVisible = useCallback((key: string) => !hidden.has(key), [hidden]);
  return { isVisible, toggle };
}
