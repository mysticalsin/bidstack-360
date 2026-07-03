// Minimal dark-mode hook for the marketing site.
// Mirrors apps/web's bidstack-theme localStorage key so visitors who toggle
// dark mode here see the same theme when they land in-app.

import { useEffect, useState, useCallback } from 'react';

import { reapplyAccent } from '@/lib/accent';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bidstack-theme';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  // Inline script in index.html has already applied data-theme by the time
  // React mounts — trust that value to avoid a flash.
  const fromDom = document.documentElement.dataset.theme as Theme | undefined;
  if (fromDom === 'light' || fromDom === 'dark') return fromDom;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* SSR / locked-down browser — fall through */
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      // Accent primaries differ per theme — re-derive for the new theme.
      reapplyAccent();
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Keep multiple tabs in sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue);
        document.documentElement.dataset.theme = e.newValue;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { theme, toggle, setTheme };
}
