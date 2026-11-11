import { describe, expect, it } from 'vitest';

import {
  persistedTour,
  tourFromStored,
  tourTransition,
  type TourEvent,
  type TourState,
  type TourStep,
} from './onboarding-tour';

const STEPS: TourStep[] = [0, 1, 2, 3, 4, 5];
const PHASES = ['inactive', 'active'] as const;

function state(phase: TourState['phase'], step: TourStep, extra: Partial<TourState> = {}): TourState {
  return { phase, step, completed: [], dismissed: false, seen: false, ...extra };
}

const PLAIN: TourEvent[] = [{ type: 'start' }, { type: 'advance' }, { type: 'back' }, { type: 'dismiss' }];

describe('onboarding tour transitions', () => {
  it('accepts exactly the legal pairs and rejects the rest', () => {
    for (const phase of PHASES) {
      for (const step of STEPS) {
        for (const event of PLAIN) {
          const result = tourTransition(state(phase, step), event);
          const illegal = event.type === 'back' && step === 0;
          expect(result.ok, `${phase} ${step} ${event.type}`).toBe(!illegal);
        }
        for (const target of [-1, 0, 5, 6]) {
          const skip = tourTransition(state(phase, step), { type: 'skip', step: target });
          const complete = tourTransition(state(phase, step), { type: 'complete', step: target });
          const legal = target >= 0 && target <= 5;
          expect(skip.ok, `skip ${target}`).toBe(legal);
          expect(complete.ok, `complete ${target}`).toBe(legal);
        }
      }
    }
  });

  it('refuses to leave the first step by back, and logs nothing by itself', () => {
    const result = tourTransition(state('active', 0), { type: 'back' });
    expect(result).toEqual({ ok: false, reason: 'back from the first step' });
  });

  it('finishes on the last advance and clears dismissed', () => {
    // WHY: finishing used to set dismissed false even after a dismiss-and-restart,
    // and the checklist reads that flag. The table keeps it.
    const result = tourTransition(state('active', 5, { dismissed: true }), { type: 'advance' });
    expect(result).toMatchObject({
      ok: true,
      state: { phase: 'inactive', seen: true, dismissed: false, completed: [5] },
    });
  });

  it('does not add a step twice', () => {
    const once = tourTransition(state('active', 1), { type: 'complete', step: 1 });
    expect(once.ok && once.state.completed).toEqual([1]);
    const twice = tourTransition(once.ok ? once.state : state('active', 1), { type: 'complete', step: 1 });
    expect(twice.ok && twice.state.completed).toEqual([1]);
  });

  it('round-trips a stored tour and drops a legacy non-array', () => {
    const stored = persistedTour(state('inactive', 0, { completed: [0, 2], dismissed: true, seen: true }));
    expect(tourFromStored(stored)).toEqual({ completed: [0, 2], dismissed: true, seen: true });
    // A string was previously assigned straight onto the store.
    expect(tourFromStored({ completedSteps: 'nope', dismissed: 'yes', tourSeen: 1 })).toEqual({
      completed: [],
      dismissed: false,
      seen: false,
    });
    expect(tourFromStored({ completedSteps: [0, 99, 0, -1] })).toEqual({
      completed: [0],
      dismissed: false,
      seen: false,
    });
    expect(tourFromStored(null)).toBeNull();
  });
});
