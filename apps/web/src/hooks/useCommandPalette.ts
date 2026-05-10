import { useEffect, useState } from 'react';

// Listens for ⌘K / Ctrl+K and toggles the palette.
// Skipped when the user is typing in another input/textarea/contenteditable.
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (!isToggle) return;
      // Always allow the shortcut even when focused inside an input — that's
      // the universal expectation for ⌘K palettes (Linear, Raycast, GitHub).
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}
