import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}

const CHORD_ROUTES: Record<string, string> = {
  d: '/dashboard',
  o: '/opportunities',
  p: '/pipeline',
  c: '/contacts',
  t: '/tasks',
  r: '/reports',
  s: '/settings',
};

const CHORD_TIMEOUT_MS = 1200;

// Listens for `?` (toggle help) and `G` chord navigation when the user is
// not focused inside an input/textarea/contenteditable.
export function useKeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let chordTimer: ReturnType<typeof setTimeout> | null = null;
    let chordActive = false;

    const clearChord = () => {
      chordActive = false;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      // Always allow Esc to close the help dialog (redundant with Radix but
      // ensures the React state stays in sync when focus is outside the dialog).
      if (e.key === 'Escape') {
        setHelpOpen(false);
        clearChord();
        return;
      }

      // Skip shortcuts while the user is typing in a form field.
      if (isTypingTarget(e.target)) return;

      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setHelpOpen((o) => !o);
        clearChord();
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        chordActive = true;
        if (chordTimer) clearTimeout(chordTimer);
        chordTimer = setTimeout(() => {
          chordActive = false;
          chordTimer = null;
        }, CHORD_TIMEOUT_MS);
        return;
      }

      if (chordActive) {
        const route = CHORD_ROUTES[key];
        if (route) {
          e.preventDefault();
          navigate(route);
        }
        clearChord();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, [navigate]);

  return { helpOpen, setHelpOpen };
}
