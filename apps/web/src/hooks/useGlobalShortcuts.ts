// App-wide keyboard shortcuts. Listed in the help drawer; documented here
// for discoverability inline with the implementation.
//
//   ⌘/Ctrl + /         Focus the topbar search
//   g d                Go to /dashboard
//   g o                Go to /opportunities
//   g p                Go to /pipeline
//   g c                Go to /contacts
//   g t                Go to /tasks
//   g s                Go to /settings
//   g r                Go to /reports
//   g a                Go to /accounts
//   g f                Go to search
//
// Vim-style two-key chords work by remembering that `g` was pressed within
// the last ~900ms (the time a user typically pauses before the next key).
// All shortcuts no-op while the user is typing in a field so we don't
// hijack their input.

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const CHORD_WINDOW_MS = 900;

const CHORD_TARGETS: Record<string, string> = {
  d: '/dashboard',
  o: '/opportunities',
  p: '/pipeline',
  c: '/contacts',
  t: '/tasks',
  s: '/settings',
  r: '/reports/list',
  a: '/accounts',
  f: '/search',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  // Refs (not state) so the chord pendency doesn't trigger re-renders.
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘/Ctrl + / → focus the topbar search. We look up by id to keep the
      // hook decoupled from the Topbar component.
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        const input = document.getElementById('tb-search-input') as HTMLInputElement | null;
        input?.focus();
        input?.select();
        return;
      }
      // Chord nav is only for plain keypresses outside any input.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const now = Date.now();
      // Start of a chord: just heard `g`. Don't preventDefault — `g` is
      // safe to ignore on the page.
      if (e.key === 'g') {
        pendingG.current = now;
        return;
      }
      // Second key of a chord, if within the window. The targets table
      // contains *lowercase* second keys; we match against e.key directly.
      if (pendingG.current && now - pendingG.current < CHORD_WINDOW_MS) {
        const route = CHORD_TARGETS[e.key];
        pendingG.current = null;
        if (route) {
          e.preventDefault();
          navigate(route);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
