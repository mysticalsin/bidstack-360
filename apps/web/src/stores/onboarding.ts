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
  // Off until this person turns it on. The nav item is not a default.
  quickStartVisible: boolean;

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
  setQuickStartVisible: (visible: boolean) => void;
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
  state: Pick<
    OnboardingState,
    'completedSteps' | 'dismissed' | 'tourSeen' | 'completedChecklist' | 'quickStartVisible'
  >,
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Storage quota exceeded — non-fatal
  }
}

const TOTAL_STEPS = 6;

function persistOnboarding(state: OnboardingState): void {
  if (typeof localStorage === 'undefined') return;
  const key = Object.keys(localStorage).find((k) => k.startsWith(STORAGE_KEY_PREFIX + ':'));
  if (!key) return;
  const uid = decodeURIComponent(key.slice(STORAGE_KEY_PREFIX.length + 1));
  writePersisted(uid, {
    completedSteps: state.completedSteps,
    dismissed: state.dismissed,
    tourSeen: state.tourSeen,
    completedChecklist: state.completedChecklist,
    quickStartVisible: state.quickStartVisible,
  });
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  tourActive: false,
  currentStepIndex: 0,
  completedSteps: [],
  dismissed: false,
  tourSeen: false,
  completedChecklist: [],
  quickStartVisible: false,
  hasSampleData: false,
  templatePickerOpen: false,

  openTemplatePicker() {
    set({ templatePickerOpen: true });
  },
  closeTemplatePicker() {
    set({ templatePickerOpen: false });
  },

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

    persistOnboarding(get());
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
    persistOnboarding(get());
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
      persistOnboarding(get());
    }
  },

  setQuickStartVisible(visible: boolean) {
    set({ quickStartVisible: visible });
    persistOnboarding(get());
  },

  setHasSampleData(has: boolean) {
    set({ hasSampleData: has });
  },

  hydrate(userId: string) {
    const persisted = readPersisted(userId);
    set({
      completedSteps: persisted?.completedSteps ?? [],
      dismissed: persisted?.dismissed ?? false,
      tourSeen: persisted?.tourSeen ?? false,
      completedChecklist: persisted?.completedChecklist ?? [],
      // Missing means hidden. Older saved sessions did not store this flag.
      quickStartVisible: persisted?.quickStartVisible ?? false,
      tourActive: false,
    });
    // Tours are opt-in from Quick Start/topbar. Auto-starting on route load
    // blocks primary CRM actions behind a full-screen backdrop.
  },
}));
