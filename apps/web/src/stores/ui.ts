// UI-state store. Holds preferences that the app remembers across
// sessions but that don't belong on the server (theme has its own store
// in stores/theme.ts; this one covers everything else).

import { create } from 'zustand';

import { NAV_SECTIONS } from '@/components/layout/navConfig';

const STORAGE_KEY = 'bidstack-ui.v1';

// 'home' is a single self-evident entry with no disclosure — every other
// section participates in the accordion (see setSectionCollapsed below).
const ACCORDION_SECTION_KEYS = NAV_SECTIONS.filter((s) => s.key !== 'home').map((s) => s.key);

interface PersistedState {
  sidebarCollapsed: boolean;
  /** Per-section collapsed state in the sidebar, keyed by NavSection.key.
   *  Absent key = expanded (the default), so a new section ships expanded. */
  collapsedSections: Record<string, boolean>;
}

// One-time migration for state saved before the accordion was enforced: if
// more than one section was left expanded, there's no route context here to
// pick a "correct" survivor, so drop all overrides and let each component
// fall back to its own active-route default on next render.
function normalizeCollapsedSections(sections: Record<string, boolean>): Record<string, boolean> {
  const expandedCount = ACCORDION_SECTION_KEYS.filter((k) => sections[k] === false).length;
  return expandedCount > 1 ? {} : sections;
}

function read(): PersistedState {
  if (typeof window === 'undefined') return { sidebarCollapsed: false, collapsedSections: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sidebarCollapsed: false, collapsedSections: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      collapsedSections: normalizeCollapsedSections(
        parsed.collapsedSections && typeof parsed.collapsedSections === 'object'
          ? parsed.collapsedSections
          : {},
      ),
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

function applySidebarDomState(collapsed: boolean): void {
  if (typeof document === 'undefined') return;
  if (collapsed) {
    document.documentElement.dataset.sidebarCollapsed = 'true';
    return;
  }
  delete document.documentElement.dataset.sidebarCollapsed;
}

interface UiStore extends PersistedState {
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSection: (key: string) => void;
  /** Explicit set (accordion override) — true = collapsed, false = expanded. */
  setSectionCollapsed: (key: string, collapsed: boolean) => void;
  /** Expand the section that owns the current route, collapsing every other
   *  accordion section (same write shape as the expand branch of
   *  setSectionCollapsed). */
  expandSectionForRoute: (key: string) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  toggleMobileNav: () => void;
}

const initialState = read();
applySidebarDomState(initialState.sidebarCollapsed);

export const useUiStore = create<UiStore>((set, get) => ({
  ...initialState,
  mobileNavOpen: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    applySidebarDomState(next);
    writeLater({ sidebarCollapsed: next, collapsedSections: get().collapsedSections });
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (v) => {
    applySidebarDomState(v);
    writeLater({ sidebarCollapsed: v, collapsedSections: get().collapsedSections });
    set({ sidebarCollapsed: v });
  },
  toggleSection: (key) => {
    const current = get().collapsedSections;
    const next = { ...current, [key]: !current[key] };
    writeLater({ sidebarCollapsed: get().sidebarCollapsed, collapsedSections: next });
    set({ collapsedSections: next });
  },
  // True accordion: opening a section closes every sibling. Without this,
  // independently-toggled sections each persist forever (localStorage), so
  // normal use over time leaves every section expanded at once and the rail
  // grows a scrollbar — the opposite of what the disclosure UI promises.
  setSectionCollapsed: (key, collapsed) => {
    const current = get().collapsedSections;
    const next = collapsed
      ? { ...current, [key]: true }
      : {
          ...current,
          ...Object.fromEntries(ACCORDION_SECTION_KEYS.map((k) => [k, true])),
          [key]: false,
        };
    writeLater({ sidebarCollapsed: get().sidebarCollapsed, collapsedSections: next });
    set({ collapsedSections: next });
  },
  // Navigation must always reveal the section owning the active route. A
  // persisted user collapse of an OTHER section stays a legitimate
  // preference, but the section the user just navigated into (deep link,
  // search result, back/forward) can't stay hidden behind a stale explicit
  // collapse=true recorded on a previous visit — that's the accordion
  // regression this action exists to close (one sibling-collapse click used
  // to survive every future route change until the user manually reopened
  // the group).
  expandSectionForRoute: (key) => {
    const current = get().collapsedSections;
    const next = {
      ...current,
      ...Object.fromEntries(ACCORDION_SECTION_KEYS.map((k) => [k, true])),
      [key]: false,
    };
    writeLater({ sidebarCollapsed: get().sidebarCollapsed, collapsedSections: next });
    set({ collapsedSections: next });
  },
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  toggleMobileNav: () => set({ mobileNavOpen: !get().mobileNavOpen }),
}));
