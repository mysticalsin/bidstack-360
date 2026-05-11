// Confetti store split out from Confetti.tsx so the component module
// exports only the component (fast-refresh requirement).

import { create } from 'zustand';

interface ConfettiStore {
  bursts: number[];
  fire: () => void;
}

export const useConfetti = create<ConfettiStore>((set, get) => ({
  bursts: [],
  fire: () => {
    // Math.random is fine in a store action (not render). Combined with
    // Date.now() so multiple bursts in the same millisecond don't collide.
    const id = Date.now() + Math.random();
    set({ bursts: [...get().bursts, id] });
    // Auto-clean burst entries after 2.2s — the longest particle lifetime.
    window.setTimeout(() => {
      set({ bursts: get().bursts.filter((b) => b !== id) });
    }, 2200);
  },
}));
