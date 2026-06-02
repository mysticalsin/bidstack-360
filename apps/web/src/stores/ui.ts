// UI-state store. Holds preferences that the app remembers across
// sessions but that don't belong on the server (theme has its own store
// in stores/theme.ts; this one covers everything else).

import { create } from 'zustand';
import { startTransition } from 'react';

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

function writeLater(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  const persist = () => write(state);
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(persist, { timeout: 1_000 });
    return;
  }
  globalThis.setTimeout(persist, 0);
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
    writeLater({ sidebarCollapsed: next, collapsedSections: get().collapsedSections });
    startTransition(() => set({ sidebarCollapsed: next }));
  },
  setSidebarCollapsed: (v) => {
    writeLater({ sidebarCollapsed: v, collapsedSections: get().collapsedSections });
    startTransition(() => set({ sidebarCollapsed: v }));
  },
  toggleSection: (key) => {
    const current = get().collapsedSections;
    const next = { ...current, [key]: !current[key] };
    writeLater({ sidebarCollapsed: get().sidebarCollapsed, collapsedSections: next });
    startTransition(() => set({ collapsedSections: next }));
  },
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  toggleMobileNav: () => set({ mobileNavOpen: !get().mobileNavOpen }),
}));
