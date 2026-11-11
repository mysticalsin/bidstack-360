// Product tour. Six steps. The store is the only writer; this function does no I/O.
// localStorage keeps completed steps, dismissed, and seen. It does not keep the
// step index or whether the tour is open. Key prefix bidstack-onboarding.v1.

export const TOUR_STEP_COUNT = 6;
export const ONBOARDING_PERSISTED_VERSION = 1;

export type TourStep = 0 | 1 | 2 | 3 | 4 | 5;

export type TourState = {
  phase: 'inactive' | 'active';
  step: TourStep;
  completed: TourStep[];
  dismissed: boolean;
  seen: boolean;
};

export type TourEvent =
  | { type: 'start' }
  | { type: 'advance' }
  | { type: 'back' }
  | { type: 'skip'; step: number }
  | { type: 'dismiss' }
  | { type: 'complete'; step: number };

export type TourResult = { ok: true; state: TourState } | { ok: false; reason: string };

export function isTourStep(value: number): value is TourStep {
  return Number.isInteger(value) && value >= 0 && value < TOUR_STEP_COUNT;
}

function withCompleted(state: TourState, step: TourStep): TourStep[] {
  return state.completed.includes(step) ? state.completed : [...state.completed, step];
}

export function tourTransition(state: TourState, event: TourEvent): TourResult {
  switch (event.type) {
    case 'start':
      return { ok: true, state: { ...state, phase: 'active', step: 0 } };
    case 'advance': {
      const completed = withCompleted(state, state.step);
      if (state.step + 1 >= TOUR_STEP_COUNT) {
        return {
          ok: true,
          state: { ...state, phase: 'inactive', completed, seen: true, dismissed: false },
        };
      }
      return {
        ok: true,
        state: { ...state, step: (state.step + 1) as TourStep, completed },
      };
    }
    case 'back':
      if (state.step === 0) return { ok: false, reason: 'back from the first step' };
      return { ok: true, state: { ...state, step: (state.step - 1) as TourStep } };
    case 'skip':
      if (!isTourStep(event.step)) return { ok: false, reason: `skip to ${event.step}` };
      return { ok: true, state: { ...state, phase: 'active', step: event.step } };
    case 'dismiss':
      return { ok: true, state: { ...state, phase: 'inactive', dismissed: true, seen: true } };
    case 'complete':
      if (!isTourStep(event.step)) return { ok: false, reason: `complete step ${event.step}` };
      return { ok: true, state: { ...state, completed: withCompleted(state, event.step) } };
    default:
      return { ok: false, reason: 'unknown event' };
  }
}

export type PersistedTour = {
  version: typeof ONBOARDING_PERSISTED_VERSION;
  completedSteps: TourStep[];
  dismissed: boolean;
  tourSeen: boolean;
};

/** What we write. Checklist is not part of this machine; the store adds it. */
export function persistedTour(state: TourState): PersistedTour {
  return {
    version: ONBOARDING_PERSISTED_VERSION,
    completedSteps: state.completed,
    dismissed: state.dismissed,
    tourSeen: state.seen,
  };
}

/**
 * Legacy rows have no version and may hold a non-array or an out-of-range
 * step. Those become the empty list. Unreadable input returns null so the
 * caller leaves memory alone, matching a missing key.
 */
export function tourFromStored(raw: unknown): Pick<TourState, 'completed' | 'dismissed' | 'seen'> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const completed = Array.isArray(record.completedSteps)
    ? record.completedSteps.filter((step): step is TourStep => typeof step === 'number' && isTourStep(step))
    : [];
  const unique: TourStep[] = [];
  for (const step of completed) if (!unique.includes(step)) unique.push(step);
  return {
    completed: unique,
    dismissed: record.dismissed === true,
    seen: record.tourSeen === true,
  };
}
