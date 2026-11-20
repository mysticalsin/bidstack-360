// Store + global hotkey for the Jarvis panel. Kept out of JarvisPanel.tsx so
// that file exports components only (Vite fast refresh).

import { useEffect } from 'react';
import { create } from 'zustand';

interface JarvisStore {
  open: boolean;
  /** Prompt handed over by the palette; the panel sends it once on open. */
  draft: string;
  openJarvis: (prompt?: string) => void;
  close: () => void;
  toggle: () => void;
  clearDraft: () => void;
}

export const useJarvisStore = create<JarvisStore>((set) => ({
  open: false,
  draft: '',
  openJarvis: (prompt) => set({ open: true, draft: prompt?.trim() ?? '' }),
  close: () => set({ open: false, draft: '' }),
  toggle: () => set((s) => ({ open: !s.open, draft: '' })),
  clearDraft: () => set({ draft: '' }),
}));

/** Cmd+J (macOS) or Ctrl+J toggles Jarvis from anywhere, including fields. */
export function useJarvisHotkey(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'j') return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      useJarvisStore.getState().toggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
