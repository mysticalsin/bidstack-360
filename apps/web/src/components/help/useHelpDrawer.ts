// Tiny store + global hotkey for the help drawer. Lives in its own file so
// HelpDrawer.tsx stays a pure component module (Vite's fast-refresh only
// hot-reloads correctly when a file exports components and nothing else).

import { useEffect } from 'react';
import { create } from 'zustand';

interface HelpStore {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useHelpDrawer = create<HelpStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

// `?` global open. We listen on keydown rather than keypress so it works
// across keyboard layouts where Shift+/ is required for `?`.
export function useHelpDrawerHotkey(): void {
  const setOpen = useHelpDrawer((s) => s.setOpen);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if (inField) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setOpen]);
}
