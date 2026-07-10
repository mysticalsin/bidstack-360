import { create } from 'zustand';

import { ACCENT_STORAGE_KEY, applyAccent, getStoredAccent, type AccentId } from '@/lib/accent';

interface AccentStore {
  accent: AccentId;
  setAccent: (id: AccentId) => void;
}

// Persisted brand accent. Applying writes CSS variable overrides onto <html>
// (see lib/accent) and mirrors the choice to localStorage so it survives a
// refresh. Kept separate from the light/dark theme store — the two compose.
export const useAccentStore = create<AccentStore>((set) => ({
  accent: getStoredAccent(),
  setAccent: (id) => {
    applyAccent(id);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    set({ accent: id });
  },
}));
