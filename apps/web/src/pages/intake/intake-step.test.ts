import { describe, expect, it } from 'vitest';

import { INTAKE_STEPS, intakeTransition, intakeUnlocked, type IntakeEvent, type IntakeStep } from './intake-step';

const EVENTS: IntakeEvent[] = [
  { type: 'next' },
  { type: 'back' },
  { type: 'settle' },
  { type: 'reset' },
  ...INTAKE_STEPS.map((to): IntakeEvent => ({ type: 'jump', to })),
];

function legal(step: IntakeStep, event: IntakeEvent, persistedReview: boolean): boolean {
  if (event.type === 'settle' || event.type === 'reset') return true;
  if (event.type === 'next') return step !== 'publish';
  if (event.type === 'back') return step !== 'receive';
  const reached = INTAKE_STEPS.indexOf(step);
  return INTAKE_STEPS.indexOf(event.to) <= intakeUnlocked(reached, persistedReview);
}

describe('intake stepper transitions', () => {
  it('accepts exactly the legal pairs, with and without a persisted extraction', () => {
    for (const persistedReview of [false, true]) {
      for (const step of INTAKE_STEPS) {
        for (const event of EVENTS) {
          const reached = INTAKE_STEPS.indexOf(step);
          const result = intakeTransition({ step, reached }, event, persistedReview);
          expect(result.ok, `${step} ${event.type} persisted=${persistedReview}`).toBe(
            legal(step, event, persistedReview),
          );
        }
      }
    }
  });

  it('refuses a jump to publish before it has been reached', () => {
    const result = intakeTransition({ step: 'receive', reached: 0 }, { type: 'jump', to: 'publish' }, false);
    expect(result.ok).toBe(false);
  });

  it('allows review after reload when an extraction already finished', () => {
    // WHY: reached is session state, so a reload would lock review again
    // even though the account already has the extraction.
    expect(intakeUnlocked(0, true)).toBe(2);
    const result = intakeTransition({ step: 'receive', reached: 0 }, { type: 'jump', to: 'review' }, true);
    expect(result).toEqual({ ok: true, state: { step: 'review', reached: 2 } });
  });

  it('sends a settled extraction to review from whichever step is showing', () => {
    const result = intakeTransition({ step: 'receive', reached: 1 }, { type: 'settle' }, false);
    expect(result).toEqual({ ok: true, state: { step: 'review', reached: 2 } });
  });

  it('reset returns to receive and forgets how far the session got', () => {
    const result = intakeTransition({ step: 'publish', reached: 3 }, { type: 'reset' }, false);
    expect(result).toEqual({ ok: true, state: { step: 'receive', reached: 0 } });
  });
});
