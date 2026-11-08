import { useSyncExternalStore } from 'react';

/** From this width the sidebar rail is shown; below it the nav is a drawer.
 *  Mirrors the `56rem` media blocks around `.app-shell` in index.css. */
export const SHELL_WIDE_QUERY = '(min-width: 56rem)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(SHELL_WIDE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(SHELL_WIDE_QUERY).matches;
}

/** True when the viewport is at least 56rem wide (sidebar rail shown). */
export function useIsWideShell(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
