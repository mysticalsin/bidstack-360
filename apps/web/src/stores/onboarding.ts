// Onboarding tour state — persisted to localStorage per user.
// The tourActive flag drives ProductTour rendering; completedSteps tracks
// which of the 6 steps the user has seen so the checklist progress bar is
// accurate without a backend round-trip on cold load.

import { create } from 'zustand';

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

  // Actions
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
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Storage quota exceeded — non-fatal
  }
}

const TOTAL_STEPS = 6;

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  tourActive: false,
  currentStepIndex: 0,
  completedSteps: [],
  dismissed: false,
  tourSeen: false,
  completedChecklist: [],
  hasSampleData: false,

  startTour() {
    set({ tourActive: true, currentStepIndex: 0 });
  },

  advance() {
    const { currentStepIndex, completedSteps } = get();
    const next = currentStepIndex + 1;
    const newCompleted = completedSteps.includes(currentStepIndex)
      ? completedSteps
      : [...completedSteps, currentStepIndex];

    if (next >= TOTAL_STEPS) {
      // Tour finished
      set({
        tourActive: false,
        completedSteps: newCompleted,
        tourSeen: true,
        dismissed: false,
      });
    } else {
      set({ currentStepIndex: next, completedSteps: newCompleted });
    }

    // Persist
    const s = get();
    // userId is stored in the hydrated key — we re-read from storage to get it
    const allKeys = Object.keys(localStorage ?? {});
    const key = allKeys.find((k) => k.startsWith(STORAGE_KEY_PREFIX + ':'));
    if (key) {
      const uid = decodeURIComponent(key.slice(STORAGE_KEY_PREFIX.length + 1));
      writePersisted(uid, {
        completedSteps: s.completedSteps,
        dismissed: s.dismissed,
        tourSeen: s.tourSeen,
        completedChecklist: s.completedChecklist,
      });
    }
  },

  back() {
    const { currentStepIndex } = get();
    if (currentStepIndex > 0) {
      set({ currentStepIndex: currentStepIndex - 1 });
    }
  },

  skipToStep(index: number) {
    set({ currentStepIndex: index, tourActive: true });
  },

  dismissTour() {
    set({ tourActive: false, dismissed: true, tourSeen: true });
    const s = get();
    const allKeys = Object.keys(localStorage ?? {});
    const key = allKeys.find((k) => k.startsWith(STORAGE_KEY_PREFIX + ':'));
    if (key) {
      const uid = decodeURIComponent(key.slice(STORAGE_KEY_PREFIX.length + 1));
      writePersisted(uid, {
        completedSteps: s.completedSteps,
        dismissed: true,
        tourSeen: true,
        completedChecklist: s.completedChecklist,
      });
    }
  },

  completeTourStep(index: number) {
    const { completedSteps } = get();
    if (!completedSteps.includes(index)) {
      set({ completedSteps: [...completedSteps, index] });
    }
  },

  markChecklistItem(item: ChecklistItem) {
    const { completedChecklist } = get();
    if (!completedChecklist.includes(item)) {
      const next = [...completedChecklist, item];
      set({ completedChecklist: next });
      const allKeys = Object.keys(localStorage ?? {});
      const key = allKeys.find((k) => k.startsWith(STORAGE_KEY_PREFIX + ':'));
      if (key) {
        const uid = decodeURIComponent(key.slice(STORAGE_KEY_PREFIX.length + 1));
        const s = get();
        writePersisted(uid, {
          completedSteps: s.completedSteps,
          dismissed: s.dismissed,
          tourSeen: s.tourSeen,
          completedChecklist: next,
        });
      }
    }
  },

  setHasSampleData(has: boolean) {
    set({ hasSampleData: has });
  },

  hydrate(userId: string) {
    const persisted = readPersisted(userId);
    if (persisted) {
      set({
        completedSteps: persisted.completedSteps ?? [],
        dismissed: persisted.dismissed ?? false,
        tourSeen: persisted.tourSeen ?? false,
        completedChecklist: persisted.completedChecklist ?? [],
      });
    }
    // Auto-start tour for new users (tourSeen === false and not dismissed)
    const s = get();
    if (!s.tourSeen && !s.dismissed) {
      // Slight delay so the app shell has time to paint before overlay appears
      setTimeout(() => {
        set({ tourActive: true, currentStepIndex: 0 });
      }, 1200);
    }
  },
}));
