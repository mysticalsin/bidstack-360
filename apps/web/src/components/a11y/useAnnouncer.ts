// Zustand store + imperative helper for the global aria-live announcer.
// Split from LiveAnnouncer.tsx so the component module exports only the
// component (fast-refresh requirement).

import { create } from 'zustand';

interface AnnouncerStore {
  message: string;
  /** Bump on every announce so the same string fires twice in a row. */
  tick: number;
  announce: (message: string) => void;
}

export const useAnnouncer = create<AnnouncerStore>((set, get) => ({
  message: '',
  tick: 0,
  announce: (message) => set({ message, tick: get().tick + 1 }),
}));

/** Imperative helper — easier than the hook for one-shot announcements. */
export function announceStageChange(message: string): void {
  useAnnouncer.getState().announce(message);
}
