// Zustand store for managing the layout visibility of various cards
// inside the customer cockpit page (/accounts/:accountId).
// Mapped to localStorage so preferences survive reload.

import { create } from 'zustand';

const STORAGE_PREFIX = 'bidstack-cockpit-layout.v1';
let activeStorageKey = STORAGE_PREFIX;

export interface CockpitLayoutState {
  visibleCards: Record<string, boolean>;
}

export const COCKPIT_DEFAULTS: CockpitLayoutState = {
  visibleCards: {
    businessSnapshot: true,
    openIssues: true,
    pipelineStage: true,
    recentOpportunities: true,
    activityTimeline: true,
    healthScore: true,
    kpiSidebar: true,
    keyContacts: true,
    notes: true,
    files: true,
    accountIntel: true,
  },
};

function storageKeyForUser(userId: string | null): string {
  return userId ? `${STORAGE_PREFIX}:${encodeURIComponent(userId)}` : STORAGE_PREFIX;
}

function parsePersisted(raw: string | null): CockpitLayoutState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CockpitLayoutState>;
    return {
      visibleCards: {
        ...COCKPIT_DEFAULTS.visibleCards,
        ...(parsed.visibleCards ?? {}),
      },
    };
  } catch {
    return null;
  }
}

function read(key = activeStorageKey): CockpitLayoutState {
  if (typeof window === 'undefined') return COCKPIT_DEFAULTS;
  return parsePersisted(localStorage.getItem(key)) ?? COCKPIT_DEFAULTS;
}

function write(state: CockpitLayoutState, key = activeStorageKey): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore quota limits */
  }
}

interface CockpitLayoutStore extends CockpitLayoutState {
  toggleCard: (cardId: string) => void;
  setCardVisible: (cardId: string, visible: boolean) => void;
  resetLayout: () => void;
  scopeToUser: (userId: string | null) => void;
}

const initial = read();

export const useCockpitLayout = create<CockpitLayoutStore>((set, get) => ({
  ...initial,
  toggleCard: (cardId) => {
    const nextCards = {
      ...get().visibleCards,
      [cardId]: !get().visibleCards[cardId],
    };
    const nextState = { visibleCards: nextCards };
    write(nextState);
    set(nextState);
  },
  setCardVisible: (cardId, visible) => {
    const nextCards = {
      ...get().visibleCards,
      [cardId]: visible,
    };
    const nextState = { visibleCards: nextCards };
    write(nextState);
    set(nextState);
  },
  resetLayout: () => {
    write(COCKPIT_DEFAULTS);
    set(COCKPIT_DEFAULTS);
  },
  scopeToUser: (userId) => {
    const nextKey = storageKeyForUser(userId);
    if (nextKey === activeStorageKey) return;
    activeStorageKey = nextKey;
    const next = read(nextKey);
    write(next, nextKey);
    set(next);
  },
}));
