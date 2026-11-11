// Onboarding tour state — persisted to localStorage per user.
// The tourActive flag drives ProductTour rendering; completedSteps tracks
// which of the 6 steps the user has seen so the checklist progress bar is
// accurate without a backend round-trip on cold load.

import { create } from 'zustand';

import {
  ONBOARDING_PERSISTED_VERSION,
  isTourStep,
  tourFromStored,
  tourTransition,
  type TourEvent,
  type TourState,
} from './onboarding-tour';

const STORAGE_KEY_PREFIX = 'bidstack-onboarding.v1';

export type ChecklistItem =
  | 'profile'
  | 'template'
  | 'first_lead'
  | 'first_activity'
  | 'first_email'
  | 'connect_email'
  | 'first_deal'
  | 'invite_team';

interface OnboardingState {
  // Tour
  tourActive: boolean;
  currentStepIndex: number;
  completedSteps: number[];
  dismissed: boolean;
  tourSeen: boolean;

  // Quickstart checklist
  completedChecklist: ChecklistItem[];

  // Sample data banner
  hasSampleData: boolean;

  // Template picker modal (transient — not persisted)
  templatePickerOpen: boolean;

  // Actions
  openTemplatePicker: () => void;
  closeTemplatePicker: () => void;
  startTour: () => void;
  advance: () => void;
  back: () => void;
  skipToStep: (index: number) => void;
  dismissTour: () => void;
  completeTourStep: (index: number) => void;
  markChecklistItem: (item: ChecklistItem) => void;
  setHasSampleData: (has: boolean) => void;
  hydrate: (userId: string) => void;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(userId)}`;
}

function readPersisted(userId: string): Partial<OnboardingState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<OnboardingState>;
  } catch {
    return null;
  }
}

function writePersisted(
  userId: string,
  state: Pick<OnboardingState, 'completedSteps' | 'dismissed' | 'tourSeen' | 'completedChecklist'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      storageKey(userId),
      JSON.stringify({ version: ONBOARDING_PERSISTED_VERSION, ...state }),
    );
  } catch {
    // Storage quota exceeded — non-fatal
  }
}

function persistTour(get: () => OnboardingState): void {
  const s = get();
  const allKeys = Object.keys(localStorage ?? {});
  const key = allKeys.find((k) => k.startsWith(STORAGE_KEY_PREFIX + ':'));
  if (!key) return;
  const uid = decodeURIComponent(key.slice(STORAGE_KEY_PREFIX.length + 1));
  writePersisted(uid, {
    completedSteps: s.completedSteps,
    dismissed: s.dismissed,
    tourSeen: s.tourSeen,
    completedChecklist: s.completedChecklist,
  });
}

export const useOnboardingStore = create<OnboardingState>((set, get) => {
  function apply(event: TourEvent): TourState | null {
    const current = get();
    const step = isTourStep(current.currentStepIndex) ? current.currentStepIndex : 0;
    const result = tourTransition(
      {
        phase: current.tourActive ? 'active' : 'inactive',
        step,
        completed: current.completedSteps.filter(isTourStep),
        dismissed: current.dismissed,
        seen: current.tourSeen,
      },
      event,
    );
    if (!result.ok) {
      console.warn(`[onboarding-tour] rejected: ${result.reason}`);
      return null;
    }
    set({
      tourActive: result.state.phase === 'active',
      currentStepIndex: result.state.step,
      completedSteps: result.state.completed,
      dismissed: result.state.dismissed,
      tourSeen: result.state.seen,
    });
    return result.state;
  }

  return {
  tourActive: false,
  currentStepIndex: 0,
  completedSteps: [],
  dismissed: false,
  tourSeen: false,
  completedChecklist: [],
  hasSampleData: false,
  templatePickerOpen: false,

  openTemplatePicker() {
    set({ templatePickerOpen: true });
  },
  closeTemplatePicker() {
    set({ templatePickerOpen: false });
  },

  startTour() {
    apply({ type: 'start' });
  },

  advance() {
    if (!apply({ type: 'advance' })) return;
    persistTour(get);
  },

  back() {
    apply({ type: 'back' });
  },

  skipToStep(index: number) {
    apply({ type: 'skip', step: index });
  },

  dismissTour() {
    if (!apply({ type: 'dismiss' })) return;
    persistTour(get);
  },

  completeTourStep(index: number) {
    apply({ type: 'complete', step: index });
  },

  markChecklistItem(item: ChecklistItem) {
    const { completedChecklist } = get();
    if (!completedChecklist.includes(item)) {
      const next = [...completedChecklist, item];
      set({ completedChecklist: next });
      persistTour(get);
    }
  },

  setHasSampleData(has: boolean) {
    set({ hasSampleData: has });
  },

  hydrate(userId: string) {
    const persisted = readPersisted(userId);
    const tour = tourFromStored(persisted);
    if (persisted && tour) {
      set({
        completedSteps: tour.completed,
        dismissed: tour.dismissed,
        tourSeen: tour.seen,
        completedChecklist: persisted.completedChecklist ?? [],
      });
    }
    // Tours are opt-in from Quick Start/topbar. Auto-starting on route load
    // blocks primary CRM actions behind a full-screen backdrop.
  },
};
});
