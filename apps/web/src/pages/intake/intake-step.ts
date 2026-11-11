// Intake stepper. The page owns extraction, toasts, and the selected documents.
// This function only decides which step is showing.

export const INTAKE_STEPS = ['receive', 'extract', 'review', 'publish'] as const;

export type IntakeStep = (typeof INTAKE_STEPS)[number];

export type IntakeState = { step: IntakeStep; reached: number };

export type IntakeEvent =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'jump'; to: IntakeStep }
  | { type: 'settle' }
  | { type: 'reset' };

export type IntakeResult = { ok: true; state: IntakeState } | { ok: false; reason: string };

const NEXT: Partial<Record<IntakeStep, IntakeStep>> = {
  receive: 'extract',
  extract: 'review',
  review: 'publish',
};

const BACK: Partial<Record<IntakeStep, IntakeStep>> = {
  extract: 'receive',
  review: 'extract',
  publish: 'review',
};

export function intakeIndex(step: IntakeStep): number {
  return INTAKE_STEPS.indexOf(step);
}

/** Review stays reachable after reload once the account has a finished extraction. */
export function intakeUnlocked(reached: number, persistedReview: boolean): number {
  return Math.max(reached, persistedReview ? intakeIndex('review') : 0);
}

function go(state: IntakeState, step: IntakeStep): IntakeState {
  return { step, reached: Math.max(state.reached, intakeIndex(step)) };
}

export function intakeTransition(
  state: IntakeState,
  event: IntakeEvent,
  persistedReview: boolean,
): IntakeResult {
  switch (event.type) {
    case 'next': {
      const to = NEXT[state.step];
      if (!to) return { ok: false, reason: `next from ${state.step}` };
      return { ok: true, state: go(state, to) };
    }
    case 'back': {
      const to = BACK[state.step];
      if (!to) return { ok: false, reason: `back from ${state.step}` };
      return { ok: true, state: go(state, to) };
    }
    case 'jump': {
      const target = intakeIndex(event.to);
      if (target > intakeUnlocked(state.reached, persistedReview)) {
        return { ok: false, reason: `jump to ${event.to} past ${state.reached}` };
      }
      return { ok: true, state: go(state, event.to) };
    }
    case 'settle':
      return { ok: true, state: go(state, 'review') };
    case 'reset':
      return { ok: true, state: { step: 'receive', reached: 0 } };
    default:
      return { ok: false, reason: 'unknown event' };
  }
}
