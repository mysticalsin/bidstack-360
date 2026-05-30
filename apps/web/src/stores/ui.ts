// UI-state store. Holds preferences that the app remembers across
// sessions but that don't belong on the server (theme has its own store
// in stores/theme.ts; this one covers everything else).

import { create } from 'zustand';

const STORAGE_KEY = 'bidstack-ui.v1';

interface PersistedState {
  sidebarCollapsed: boolean;
  /** Per-section collapsed state in the sidebar, keyed by NavSection.key.
   *  Absent key = expanded (the default), so a new section ships expanded. */
  collapsedSections: Record<string, boolean>;
}

function read(): PersistedState {
  if (typeof window === 'undefined') return { sidebarCollapsed: false, collapsedSections: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sidebarCollapsed: false, collapsedSections: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      collapsedSections:
        parsed.collapsedSections && typeof parsed.collapsedSections === 'object'
          ? parsed.collapsedSections
          : {},
    };
  } catch {
    return { sidebarCollapsed: false, collapsedSections: {} };
  }
}

function write(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private-mode block — preference loss is acceptable */
  }
}

interface UiStore extends PersistedState {
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSection: (key: string) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  toggleMobileNav: () => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  ...read(),
  mobileNavOpen: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    write({ sidebarCollapsed: next, collapsedSections: get().collapsedSections });
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (v) => {
    write({ sidebarCollapsed: v, collapsedSections: get().collapsedSections });
    set({ sidebarCollapsed: v });
  },
  toggleSection: (key) => {
    const current = get().collapsedSections;
    const next = { ...current, [key]: !current[key] };
    write({ sidebarCollapsed: get().sidebarCollapsed, collapsedSections: next });
    set({ collapsedSections: next });
  },
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  toggleMobileNav: () => set({ mobileNavOpen: !get().mobileNavOpen }),
}));
