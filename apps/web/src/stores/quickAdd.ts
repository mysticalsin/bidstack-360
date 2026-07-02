// Quick-add shared state — which "New …" record dialog (if any) is mounted.
//
// WHY a store instead of QuickAddMenu owning this in local useState: the
// command palette's ⌘K "Create" group needs to open the exact same
// CreateOpportunityDialog / CreateTaskDialog / ContactDialog instances the
// `N`-key quick-add menu uses, without re-implementing those forms. Lifting
// "which dialog is mounted" out of QuickAddMenu lets any trigger set it —
// QuickAddMenu.tsx stays the single place that renders the dialogs.

import { create } from 'zustand';

export type QuickAddEntity = 'opportunity' | 'task' | 'contact' | 'note';

interface QuickAddStore {
  /** The `N`-key picker list (opportunity/task/contact/note options). */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** Which create dialog is mounted; null = none. Setting this directly
   *  (bypassing the picker) is how the command palette jumps straight to a
   *  dialog. */
  pick: QuickAddEntity | null;
  setPick: (pick: QuickAddEntity | null) => void;
}

export const useQuickAddStore = create<QuickAddStore>((set) => ({
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  pick: null,
  setPick: (pick) => set({ pick }),
}));
