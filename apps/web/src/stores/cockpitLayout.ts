// Zustand store for managing the layout visibility of various cards
// inside the customer cockpit page (/accounts/:accountId).
// Mapped to localStorage so preferences survive reload.

import { create } from 'zustand';

const STORAGE_PREFIX = 'bidstack-cockpit-layout.v1';
let activeStorageKey = STORAGE_PREFIX;

export interface CockpitLayoutState {
  visibleCards: Record<string, boolean>;
}

// Catalog of user-toggleable cockpit cards. `label` drives the Customize menu;
// `group` lays them out under the column they render in. KpiRow / CommandCenter
// / PageHead are intentionally NOT here — they are the always-on account header.
export const COCKPIT_CARDS: { id: string; label: string; group: 'main' | 'side' }[] = [
  { id: 'techStack', label: 'Tech stack', group: 'main' },
  { id: 'businessSnapshot', label: 'Business snapshot', group: 'main' },
  { id: 'openIssues', label: 'Open issues', group: 'main' },
  { id: 'pipelineStage', label: 'Pipeline by stage', group: 'main' },
  { id: 'recentOpportunities', label: 'Recent opportunities', group: 'main' },
  { id: 'activityTimeline', label: 'Activity timeline', group: 'main' },
  { id: 'crossSell', label: 'Cross-sell actions', group: 'main' },
  { id: 'governance', label: 'Governance log', group: 'main' },
  { id: 'spotlightRefs', label: 'Project references', group: 'main' },
  { id: 'healthScore', label: 'Signal coverage', group: 'side' },
  { id: 'revenueEvolution', label: 'Revenue evolution', group: 'side' },
  { id: 'winLoss', label: 'Win / loss', group: 'side' },
  { id: 'infoSearchLeads', label: 'InfoSearch leads', group: 'side' },
  { id: 'kpiSidebar', label: 'KPI sidebar', group: 'side' },
  { id: 'dataTrust', label: 'Data trust', group: 'side' },
  { id: 'liveDataMesh', label: 'Live data mesh', group: 'side' },
  { id: 'keyContacts', label: 'Key contacts', group: 'side' },
  { id: 'notes', label: 'Notes', group: 'side' },
  { id: 'files', label: 'Files', group: 'side' },
  { id: 'accountIntel', label: 'Account intel', group: 'side' },
];

export const COCKPIT_DEFAULTS: CockpitLayoutState = {
  visibleCards: Object.fromEntries(COCKPIT_CARDS.map((c) => [c.id, true])),
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
